import { createSession } from "@/src/__tests__/fixtures/session-factory";
import type { Session } from "next-auth";
import { randomUUID } from "crypto";
import { afterAll, describe, expect, it } from "vitest";
import { disconnectQueues } from "@/src/__tests__/test-utils";
import { prisma } from "@langfuse/shared/src/db";
import { appRouter } from "@/src/server/api/root";
import { createInnerTRPCContext } from "@/src/server/api/trpc";
import {
  commandClickhouse,
  findModelsInPostgres,
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

const DAY_MS = 24 * 60 * 60 * 1000;

// A time range of the last `days` days. `to` has a margin so the clocks of this process and of
// ClickHouse need not agree to the second.
const lastDays = (days: number) => ({
  from: new Date(Date.now() - days * DAY_MS),
  to: new Date(Date.now() + 60_000),
});

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
    await caller.modelRegistry.upsert(baseModel(projectId));

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
      ...lastDays(30),
      projectId,
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

  it("reads generations only within the requested time range", async () => {
    const { projectId, caller } = await createCaller();
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
    const now = Date.now();
    await createObservationsCh([
      createObservation({
        project_id: projectId,
        internal_model_id: pricing.id,
        start_time: now - 2 * DAY_MS,
      }),
      createObservation({
        project_id: projectId,
        internal_model_id: pricing.id,
        start_time: now - 40 * DAY_MS,
      }),
    ]);

    const read = async (days: number) =>
      (
        await caller.modelRegistry.usage({
          projectId,
          ...lastDays(days),
        })
      )[linked.id];

    // Both generations are in a long range; the latest one is the last use.
    const long = await read(60);
    expect(long.generationsInWindow).toBe(2);
    expect(long.lastUsed?.getTime()).toBeGreaterThan(now - 3 * DAY_MS);
    // A shorter range leaves the older one out, and a range before both has no last use.
    expect((await read(7)).generationsInWindow).toBe(1);
    const before = await caller.modelRegistry.usage({
      projectId,
      from: new Date(now - 100 * DAY_MS),
      to: new Date(now - 50 * DAY_MS),
    });
    expect(before[linked.id]).toEqual({
      lastUsed: null,
      generationsInWindow: 0,
    });
  });

  it("reports every entry of the project, and serves a repeated read from the cache until the registry changes", async () => {
    const { projectId, caller } = await createCaller();
    const pricing = await prisma.model.create({
      data: {
        scope: "PROJECT",
        projectId,
        modelName: `pricing-${randomUUID()}`,
        matchPattern: "x",
      },
    });
    const first = await caller.modelRegistry.upsert(
      baseModel(projectId, { pricingModelId: pricing.id }),
    );
    const second = await caller.modelRegistry.upsert(
      baseModel(projectId, { pricingModelId: pricing.id }),
    );

    // Whole minutes, so the cache key does not depend on when the test runs.
    const to = new Date(Math.ceil((Date.now() + 120_000) / 60_000) * 60_000);
    const range = { from: new Date(to.getTime() - DAY_MS), to };
    const generation = (minutesAgo: number) =>
      createObservation({
        project_id: projectId,
        internal_model_id: pricing.id,
        start_time: Date.now() - minutesAgo * 60_000,
      });
    const read = async () =>
      (await caller.modelRegistry.usage({ projectId, ...range }))[first.id];

    await createObservationsCh([generation(10)]);
    const everyEntry = await caller.modelRegistry.usage({
      projectId,
      ...range,
    });
    expect(Object.keys(everyEntry).sort()).toEqual(
      [first.id, second.id].sort(),
    );
    expect(everyEntry[first.id].generationsInWindow).toBe(1);

    // A generation that arrives within the cache window is not seen by the same read...
    await createObservationsCh([generation(5)]);
    expect((await read()).generationsInWindow).toBe(1);

    // ...until the registry changes, which changes what the result depends on.
    await caller.modelRegistry.upsert(
      baseModel(projectId, { pricingModelId: pricing.id }),
    );
    expect((await read()).generationsInWindow).toBe(2);
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
      ...lastDays(30),
      projectId,
    });
    const fromObservations = await legacy.caller.modelRegistry.usage({
      ...lastDays(30),
      projectId,
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
      startTime?: number;
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
        start_time: (params.startTime ?? Date.now()) * 1000,
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
        ...lastDays(30),
        projectId,
      });

      expect(usage[byId.id]).toMatchObject({ experiments: 2, datasets: 2 });
      expect(usage[byPair.id]).toMatchObject({ experiments: 1, datasets: 1 });
      expect(usage[unused.id]).toEqual({
        experiments: 0,
        datasets: 0,
        lastRun: null,
      });
    });

    it("counts every experiment, however many there are", async () => {
      const { projectId, caller } = await createCaller();
      const model = await caller.modelRegistry.upsert(baseModel(projectId));
      // More experiments than a row-per-experiment read could return in one query.
      const experimentCount = 25_000;

      await commandClickhouse({
        query: `
          INSERT INTO events_core (
            project_id, trace_id, span_id, type, start_time, experiment_id,
            experiment_dataset_id, experiment_item_root_span_id, experiment_item_id,
            experiment_metadata_names, experiment_metadata_values
          )
          SELECT
            {projectId: String}, concat('t', toString(number)), concat('s', toString(number)),
            'GENERATION', now64(6) - toIntervalSecond(rand() % 86400),
            concat('experiment-', toString(number)), concat('dataset-', toString(number % 5)),
            concat('s', toString(number)), concat('item-', toString(number)),
            ['provider', 'model'], [{provider: String}, {modelId: String}]
          FROM numbers({count: UInt32})`,
        params: {
          projectId,
          provider: model.provider,
          modelId: model.modelId,
          count: experimentCount,
        },
      });

      const usage = await caller.modelRegistry.experimentUsage({
        ...lastDays(30),
        projectId,
      });

      expect(usage[model.id]).toMatchObject({
        experiments: experimentCount,
        datasets: 5,
      });
    });

    it("counts only the experiments in the requested time range", async () => {
      const { projectId, caller } = await createCaller();
      const model = await caller.modelRegistry.upsert(baseModel(projectId));
      const metadata = { provider: model.provider, model: model.modelId };

      await createEventsCh([
        experimentEvent({
          projectId,
          experimentId: randomUUID(),
          datasetId: randomUUID(),
          metadata,
          startTime: Date.now() - 2 * DAY_MS,
        }),
        experimentEvent({
          projectId,
          experimentId: randomUUID(),
          datasetId: randomUUID(),
          metadata,
          startTime: Date.now() - 40 * DAY_MS,
        }),
      ]);

      const read = async (days: number) =>
        (
          await caller.modelRegistry.experimentUsage({
            projectId,
            ...lastDays(days),
          })
        )[model.id].experiments;

      expect(await read(60)).toBe(2);
      expect(await read(7)).toBe(1);
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
        ...lastDays(30),
        projectId,
      });
      expect(usage[model.id].experiments).toBe(0);
    });
  });

  describe("automatic pricing", () => {
    // A definition whose pattern matches names that start with a prefix unique to the test.
    const definition = (params: {
      scope: "PROJECT" | "ORGANIZATION";
      projectId: string;
      organizationId: string;
      matchPattern: string;
    }) =>
      prisma.model.create({
        data: {
          scope: params.scope,
          ...(params.scope === "PROJECT"
            ? { projectId: params.projectId }
            : { organizationId: params.organizationId }),
          modelName: `definition-${randomUUID()}`,
          matchPattern: params.matchPattern,
        },
      });

    it("resolves a model name to the definition ingestion would use, project before organization", async () => {
      const { projectId, org } = await createCaller();
      const prefix = `probe-${randomUUID()}`;
      const projectDefinition = await definition({
        scope: "PROJECT",
        projectId,
        organizationId: org.id,
        matchPattern: `^${prefix}-a$`,
      });
      const orgDefinition = await definition({
        scope: "ORGANIZATION",
        projectId,
        organizationId: org.id,
        matchPattern: `^${prefix}-.*$`,
      });

      const matches = await findModelsInPostgres({
        projectId,
        models: [`${prefix}-a`, `${prefix}-b`, `no-match-${prefix}`],
      });

      expect(matches.get(`${prefix}-a`)?.id).toBe(projectDefinition.id);
      expect(matches.get(`${prefix}-b`)?.id).toBe(orgDefinition.id);
      expect(matches.has(`no-match-${prefix}`)).toBe(false);
    });

    it("prices an entry from its model id unless a definition is picked", async () => {
      const { projectId, org, caller } = await createCaller();
      const prefix = `auto-${randomUUID()}`;
      const matching = await definition({
        scope: "PROJECT",
        projectId,
        organizationId: org.id,
        matchPattern: `^${prefix}.*$`,
      });
      const picked = await definition({
        scope: "PROJECT",
        projectId,
        organizationId: org.id,
        matchPattern: "^never-matches-anything$",
      });
      await caller.modelRegistry.upsert(
        baseModel(projectId, {
          modelId: `${prefix}-auto`,
          displayName: "Auto",
        }),
      );
      await caller.modelRegistry.upsert(
        baseModel(projectId, {
          modelId: `${prefix}-picked`,
          displayName: "Picked",
          pricingModelId: picked.id,
        }),
      );
      await caller.modelRegistry.upsert(
        baseModel(projectId, {
          modelId: "no-definition-matches",
          displayName: "None",
        }),
      );

      const { models } = await caller.modelRegistry.getAll({
        projectId,
        searchString: "",
        page: 0,
        limit: 50,
      });
      const byName = Object.fromEntries(
        models.map((m) => [m.displayName, m.pricingModel]),
      );

      expect(byName.Auto).toMatchObject({ id: matching.id, source: "matched" });
      expect(byName.Picked).toMatchObject({ id: picked.id, source: "linked" });
      expect(byName.None).toBeNull();
    });

    it("counts a generation for the entry named like it, and finds entries by their definition", async () => {
      const { projectId, org, caller } = await createCaller();
      const prefix = `shared-${randomUUID()}`;
      const shared = await definition({
        scope: "PROJECT",
        projectId,
        organizationId: org.id,
        matchPattern: `^${prefix}.*$`,
      });
      const base = await caller.modelRegistry.upsert(
        baseModel(projectId, { modelId: prefix, displayName: "Base" }),
      );
      const dated = await caller.modelRegistry.upsert(
        baseModel(projectId, {
          modelId: `${prefix}-2024`,
          displayName: "Dated",
        }),
      );
      const now = Date.now();
      const generation = (providedModelName: string, offset: number) =>
        createObservation({
          project_id: projectId,
          internal_model_id: shared.id,
          provided_model_name: providedModelName,
          start_time: now - offset * 60_000,
        });
      await createObservationsCh([
        generation(prefix, 1),
        generation(prefix, 2),
        generation(`${prefix}-2024`, 3),
      ]);

      const usage = await caller.modelRegistry.usage({
        projectId,
        ...lastDays(1),
      });
      expect(usage[base.id].generationsInWindow).toBe(2);
      expect(usage[dated.id].generationsInWindow).toBe(1);

      const found = await caller.modelRegistry.lookup({
        projectId,
        pricingModelIds: [shared.id],
      });
      expect(found.map((entry) => entry.id).sort()).toEqual(
        [base.id, dated.id].sort(),
      );
      expect(found.every((entry) => entry.pricingModelId === shared.id)).toBe(
        true,
      );
    });
  });
});
