import { createSession } from "@/src/__tests__/fixtures/session-factory";
import type { Session } from "next-auth";
import { randomUUID } from "crypto";
import { afterAll, describe, expect, it } from "vitest";
import { disconnectQueues } from "@/src/__tests__/test-utils";
import { prisma } from "@langfuse/shared/src/db";
import { appRouter } from "@/src/server/api/root";
import { createInnerTRPCContext } from "@/src/server/api/trpc";
import {
  createEvent,
  createEventsCh,
  createObservation,
  createObservationsCh,
  createOrgProjectAndApiKey,
  PromptService,
  redis,
} from "@langfuse/shared/src/server";
import { PromptType } from "@langfuse/shared";

const createCaller = async (
  options: {
    existing?: {
      project: { id: string; name: string };
      org: { id: string; name: string };
    };
    projectRole?: "ADMIN" | "MEMBER";
    v4BetaEnabled?: boolean;
  } = {},
) => {
  const { project, org } =
    options.existing ?? (await createOrgProjectAndApiKey({ plan: "Team" }));
  const session: Session = createSession({
    user: {
      id: `user-${randomUUID()}`,
      name: "Model Registry Test User",
      v4BetaEnabled: options.v4BetaEnabled ?? false,
    },
    organizations: [
      {
        id: org.id,
        name: org.name,
        role: "OWNER",
        plan: "cloud:team",
        projects: [
          {
            id: project.id,
            role: options.projectRole ?? "ADMIN",
            name: project.name,
            hasTraces: true,
          },
        ],
      },
    ],
  });

  const ctx = createInnerTRPCContext({ session, headers: {} });
  return {
    project,
    org,
    projectId: project.id,
    caller: appRouter.createCaller({ ...ctx, prisma }),
  };
};

const baseModel = (projectId: string, overrides = {}) => ({
  projectId,
  provider: "openai",
  modelId: `model-${randomUUID()}`,
  displayName: "Test model",
  ...overrides,
});

describe("model registry tRPC router", () => {
  afterAll(async () => {
    await disconnectQueues();
  });

  it("creates, edits and lists a model with capabilities and default params", async () => {
    const { projectId, caller } = await createCaller();
    const input = baseModel(projectId, {
      contextWindow: 128000,
      capabilities: { tools: true, vision: false },
      defaultParams: {
        temperature: 0.2,
        max_tokens: 512,
        maxReasoningTokens: 2048,
        providerOptions: { reasoning_effort: "high" },
      },
    });

    const created = await caller.modelRegistry.upsert(input);
    const edited = await caller.modelRegistry.upsert({
      ...input,
      id: created.id,
      displayName: "Renamed",
      status: "deprecated",
    });
    expect(edited.id).toBe(created.id);

    const { models, totalCount } = await caller.modelRegistry.getAll({
      projectId,
      searchString: "",
      page: 0,
      limit: 50,
    });
    expect(totalCount).toBe(1);
    expect(models[0]).toMatchObject({
      displayName: "Renamed",
      status: "deprecated",
      contextWindow: 128000,
      capabilities: { tools: true, vision: false },
      defaultParams: {
        temperature: 0.2,
        max_tokens: 512,
        maxReasoningTokens: 2048,
        providerOptions: { reasoning_effort: "high" },
      },
      connectionAvailable: false,
    });
  });

  it("rejects a second entry for the same provider and model id", async () => {
    const { projectId, caller } = await createCaller();
    const input = baseModel(projectId);
    await caller.modelRegistry.upsert(input);

    await expect(caller.modelRegistry.upsert(input)).rejects.toThrow(
      /already registered/,
    );
  });

  it("does not expose or accept another project's data", async () => {
    const { projectId, caller } = await createCaller();
    const {
      projectId: otherProjectId,
      org: otherOrg,
      caller: otherCaller,
    } = await createCaller();

    const theirs = await otherCaller.modelRegistry.upsert(
      baseModel(otherProjectId),
    );
    const theirPricing = await prisma.model.create({
      data: {
        scope: "PROJECT",
        projectId: otherProjectId,
        modelName: `pricing-${randomUUID()}`,
        matchPattern: "x",
      },
    });
    const theirOrgPricing = await prisma.model.create({
      data: {
        scope: "ORGANIZATION",
        organizationId: otherOrg.id,
        modelName: `org-pricing-${randomUUID()}`,
        matchPattern: "x",
      },
    });

    await expect(
      caller.modelRegistry.getById({ projectId, id: theirs.id }),
    ).rejects.toThrow(/not found/i);
    await expect(
      caller.modelRegistry.delete({ projectId, id: theirs.id }),
    ).rejects.toThrow(/not found/i);
    await expect(
      caller.modelRegistry.upsert(
        baseModel(projectId, { pricingModelId: theirPricing.id }),
      ),
    ).rejects.toThrow(/pricing model not found/i);
    await expect(
      caller.modelRegistry.upsert(
        baseModel(projectId, { pricingModelId: theirOrgPricing.id }),
      ),
    ).rejects.toThrow(/pricing model not found/i);
  });

  it("treats % and _ in the search term literally", async () => {
    const { projectId, caller } = await createCaller();
    await caller.modelRegistry.upsert(
      baseModel(projectId, { modelId: "gpt-4o", displayName: "GPT 4o" }),
    );

    const search = (searchString: string) =>
      caller.modelRegistry.getAll({
        projectId,
        searchString,
        page: 0,
        limit: 50,
      });

    expect((await search("gpt")).totalCount).toBe(1);
    expect((await search("%")).totalCount).toBe(0);
    expect((await search("g_t")).totalCount).toBe(0);
  });

  it("imports models an effective connection can run, once", async () => {
    const { projectId, caller } = await createCaller();
    await prisma.llmApiKeys.create({
      data: {
        projectId,
        provider: "my-openai",
        adapter: "openai",
        secretKey: "not-a-real-secret",
        displaySecretKey: "...cret",
        customModels: ["custom-a", "custom-b"],
        withDefaultModels: false,
      },
    });

    const first = await caller.modelRegistry.importFromConnections({
      projectId,
    });
    const second = await caller.modelRegistry.importFromConnections({
      projectId,
    });
    expect(first).toEqual({ created: 2, skipped: 0 });
    expect(second).toEqual({ created: 0, skipped: 2 });

    const { models } = await caller.modelRegistry.getAll({
      projectId,
      searchString: "",
      page: 0,
      limit: 50,
    });
    expect(models.map((m) => m.modelId).sort()).toEqual([
      "custom-a",
      "custom-b",
    ]);
    expect(models.every((m) => m.connectionAvailable)).toBe(true);
  });

  it("lets a project member read the registry but not change it", async () => {
    const { project, org, caller: admin } = await createCaller();
    await admin.modelRegistry.upsert(baseModel(project.id));

    const { caller: member } = await createCaller({
      existing: { project, org },
      projectRole: "MEMBER",
    });

    const { totalCount } = await member.modelRegistry.getAll({
      projectId: project.id,
      searchString: "",
      page: 0,
      limit: 50,
    });
    expect(totalCount).toBe(1);
    await expect(
      member.modelRegistry.upsert(baseModel(project.id)),
    ).rejects.toThrow(/access/i);
  });

  it("refuses to delete a model that prompt versions use", async () => {
    const { projectId, caller } = await createCaller();
    const model = await caller.modelRegistry.upsert(baseModel(projectId));
    await caller.prompts.create({
      projectId,
      name: `uses-model-${randomUUID()}`,
      type: PromptType.Text,
      prompt: "Hello",
      labels: [],
      config: {},
      registryModelId: model.id,
    });

    await expect(
      caller.modelRegistry.delete({ projectId, id: model.id }),
    ).rejects.toThrow(/used by 1 prompt version/);
  });

  it("serves the edited model to prompts that were already cached", async () => {
    const { projectId, caller } = await createCaller();
    const model = await caller.modelRegistry.upsert(
      baseModel(projectId, { modelId: "before-edit" }),
    );
    const name = `cached-model-${randomUUID()}`;
    await caller.prompts.create({
      projectId,
      name,
      type: PromptType.Text,
      prompt: "Hello",
      labels: [],
      config: {},
      registryModelId: model.id,
    });
    const promptService = new PromptService(prisma, redis, undefined, true);
    const read = () =>
      promptService.getPrompt({
        projectId,
        promptName: name,
        label: "latest",
        version: undefined,
      });

    expect((await read())?.model?.modelId).toBe("before-edit");

    await caller.modelRegistry.upsert({
      ...baseModel(projectId, { modelId: "after-edit" }),
      id: model.id,
    });

    expect((await read())?.model?.modelId).toBe("after-edit");
  });

  it("reports generation usage through the pricing link, per project", async () => {
    const { projectId, caller } = await createCaller();
    const { projectId: otherProjectId } = await createCaller();
    const pricing = await prisma.model.create({
      data: {
        scope: "PROJECT",
        projectId,
        modelName: `pricing-${randomUUID()}`,
        matchPattern: "x",
      },
    });
    const linked = await caller.modelRegistry.upsert(
      baseModel(projectId, { pricingModelId: pricing.id }),
    );
    const unlinked = await caller.modelRegistry.upsert(baseModel(projectId));

    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    await createObservationsCh([
      createObservation({
        project_id: projectId,
        internal_model_id: pricing.id,
        start_time: now - day,
      }),
      createObservation({
        project_id: projectId,
        internal_model_id: pricing.id,
        start_time: now - 90 * day,
      }),
      // Same pricing id in another project must not be counted.
      createObservation({
        project_id: otherProjectId,
        internal_model_id: pricing.id,
        start_time: now - day,
      }),
    ]);

    const usage = await caller.modelRegistry.usage({
      projectId,
      ids: [linked.id, unlinked.id],
    });

    expect(Object.keys(usage)).toEqual([linked.id]);
    expect(usage[linked.id].generationsInWindow).toBe(1);
    expect(usage[linked.id].lastUsed?.getTime()).toBeGreaterThan(now - 2 * day);

    const found = await caller.modelRegistry.lookup({
      projectId,
      pricingModelIds: [pricing.id],
    });
    expect(found.map((row) => row.id)).toEqual([linked.id]);
  });

  it("reads usage from the events table for a v4 user and the legacy table otherwise", async () => {
    // Langfuse v4 writes generations only to the events tables, so the legacy table is empty.
    const v4 = await createCaller({ v4BetaEnabled: true });
    const legacy = await createCaller({
      existing: { project: v4.project, org: v4.org },
    });
    const projectId = v4.projectId;
    const pricing = await prisma.model.create({
      data: {
        scope: "PROJECT",
        projectId,
        modelName: `pricing-${randomUUID()}`,
        matchPattern: "x",
      },
    });
    const entry = await v4.caller.modelRegistry.upsert(
      baseModel(projectId, { pricingModelId: pricing.id }),
    );

    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    await createEventsCh([
      createEvent({
        project_id: projectId,
        model_id: pricing.id,
        start_time: now - day,
      }),
      createEvent({
        project_id: projectId,
        model_id: pricing.id,
        start_time: now - 2 * day,
      }),
      createEvent({
        project_id: projectId,
        model_id: pricing.id,
        start_time: now - 90 * day,
      }),
    ]);
    await createObservationsCh([
      createObservation({
        project_id: projectId,
        internal_model_id: pricing.id,
        start_time: now - day,
      }),
    ]);

    const fromEvents = await v4.caller.modelRegistry.usage({
      projectId,
      ids: [entry.id],
    });
    const fromObservations = await legacy.caller.modelRegistry.usage({
      projectId,
      ids: [entry.id],
    });

    expect(fromEvents[entry.id].generationsInWindow).toBe(2);
    expect(fromObservations[entry.id].generationsInWindow).toBe(1);
  });

  describe("experimentUsage", () => {
    const experimentEvent = (params: {
      projectId: string;
      experimentId: string;
      datasetId: string;
      metadata: Record<string, string>;
    }) => {
      const spanId = randomUUID();
      return createEvent({
        id: spanId,
        span_id: spanId,
        project_id: params.projectId,
        trace_id: randomUUID(),
        type: "GENERATION",
        experiment_id: params.experimentId,
        experiment_name: `experiment-${params.experimentId}`,
        experiment_dataset_id: params.datasetId,
        experiment_item_id: randomUUID(),
        experiment_item_root_span_id: spanId,
        experiment_metadata_names: Object.keys(params.metadata),
        experiment_metadata_values: Object.values(params.metadata),
        start_time: Date.now() * 1000,
      });
    };

    it("counts experiments by the stored registry id or by provider and model", async () => {
      const { projectId, caller } = await createCaller();
      const modelId = `model-${randomUUID()}`;
      const byId = await caller.modelRegistry.upsert(
        baseModel(projectId, { modelId, displayName: "By id" }),
      );
      const byPair = await caller.modelRegistry.upsert(
        baseModel(projectId, { provider: "azure", displayName: "By pair" }),
      );
      const unused = await caller.modelRegistry.upsert(baseModel(projectId));
      const datasetA = randomUUID();
      const datasetB = randomUUID();

      await createEventsCh([
        // The model id was renamed after this run: only the stored id still finds the entry.
        experimentEvent({
          projectId,
          experimentId: randomUUID(),
          datasetId: datasetA,
          metadata: {
            provider: "openai",
            model: "renamed-since",
            registry_model_id: byId.id,
          },
        }),
        experimentEvent({
          projectId,
          experimentId: randomUUID(),
          datasetId: datasetB,
          metadata: {
            provider: "openai",
            model: modelId,
            registry_model_id: byId.id,
          },
        }),
        // Started before runs stored an id.
        experimentEvent({
          projectId,
          experimentId: randomUUID(),
          datasetId: datasetA,
          metadata: { provider: "azure", model: byPair.modelId },
        }),
        // Ran on a model that is not registered.
        experimentEvent({
          projectId,
          experimentId: randomUUID(),
          datasetId: datasetA,
          metadata: { provider: "openai", model: "not-registered" },
        }),
      ]);

      const usage = await caller.modelRegistry.experimentUsage({
        projectId,
        ids: [byId.id, byPair.id, unused.id],
      });

      expect(usage[byId.id]).toMatchObject({ experiments: 2, datasets: 2 });
      expect(usage[byPair.id]).toMatchObject({ experiments: 1, datasets: 1 });
      expect(usage[unused.id]).toEqual({
        experiments: 0,
        datasets: 0,
        lastRun: null,
      });
    });

    it("does not count another project's experiments", async () => {
      const { projectId, caller } = await createCaller();
      const other = await createCaller();
      const model = await caller.modelRegistry.upsert(baseModel(projectId));

      await createEventsCh([
        experimentEvent({
          projectId: other.projectId,
          experimentId: randomUUID(),
          datasetId: randomUUID(),
          metadata: { provider: model.provider, model: model.modelId },
        }),
      ]);

      const usage = await caller.modelRegistry.experimentUsage({
        projectId,
        ids: [model.id],
      });
      expect(usage[model.id].experiments).toBe(0);
    });
  });
});
