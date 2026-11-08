import { testFeatureFlags } from "@/src/__tests__/fixtures/feature-flags";
import type { Session } from "next-auth";
import { randomUUID } from "crypto";
import { afterAll, describe, expect, it } from "vitest";
import { disconnectQueues } from "@/src/__tests__/test-utils";
import { prisma } from "@langfuse/shared/src/db";
import { appRouter } from "@/src/server/api/root";
import { createInnerTRPCContext } from "@/src/server/api/trpc";
import { createOrgProjectAndApiKey } from "@langfuse/shared/src/server";
import { PromptType } from "@langfuse/shared";

const createCaller = async (
  options: {
    existing?: {
      project: { id: string; name: string };
      org: { id: string; name: string };
    };
    projectRole?: "ADMIN" | "MEMBER";
    admin?: boolean;
  } = {},
) => {
  const { project, org } =
    options.existing ?? (await createOrgProjectAndApiKey({ plan: "Team" }));
  const session: Session = {
    expires: "1",
    user: {
      id: `user-${randomUUID()}`,
      name: "Model Registry Test User",
      canCreateOrganizations: true,
      admin: options.admin ?? true,
      organizations: [
        {
          id: org.id,
          name: org.name,
          role: "OWNER",
          plan: "cloud:team",
          cloudConfig: undefined,
          metadata: {},
          aiFeaturesEnabled: false,
          aiTelemetryEnabled: false,
          projects: [
            {
              id: project.id,
              role: options.projectRole ?? "ADMIN",
              retentionDays: 30,
              deletedAt: null,
              name: project.name,
              hasTraces: true,
              metadata: {},
              createdAt: new Date().toISOString(),
            },
          ],
        },
      ],
      featureFlags: testFeatureFlags(),
    },
    environment: {} as any,
  };

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
      defaultParams: { temperature: 0.2, max_tokens: 512 },
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
      defaultParams: { temperature: 0.2, max_tokens: 512 },
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
    const { projectId: otherProjectId, caller: otherCaller } =
      await createCaller();

    const theirs = await otherCaller.modelRegistry.upsert(
      baseModel(otherProjectId),
    );
    const theirPricing = await prisma.model.create({
      data: {
        projectId: otherProjectId,
        modelName: `pricing-${randomUUID()}`,
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
      admin: false,
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
});
