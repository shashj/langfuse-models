import type { Session } from "next-auth";
import { randomUUID } from "crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@langfuse/shared/src/db";
import { createOrgProjectAndApiKey } from "@langfuse/shared/src/server";
import { appRouter } from "@/src/server/api/root";
import { createInnerTRPCContext } from "@/src/server/api/trpc";
import { disconnectQueues } from "@/src/__tests__/test-utils";
import { createSession } from "@/src/__tests__/fixtures/session-factory";

const createCaller = async () => {
  const { project, org } = await createOrgProjectAndApiKey({ plan: "Team" });
  const session: Session = createSession({
    user: { id: `user-${randomUUID()}`, name: "Experiments Test User" },
    organizations: [
      {
        id: org.id,
        name: org.name,
        role: "OWNER",
        plan: "cloud:team",
        projects: [
          {
            id: project.id,
            role: "ADMIN",
            name: project.name,
            hasTraces: true,
          },
        ],
      },
    ],
  });
  const ctx = createInnerTRPCContext({ session, headers: {} });
  return {
    projectId: project.id,
    caller: appRouter.createCaller({ ...ctx, prisma }),
  };
};

const experimentInput = async (projectId: string) => {
  const dataset = await prisma.dataset.create({
    data: { projectId, name: `dataset-${randomUUID()}` },
  });
  const prompt = await prisma.prompt.create({
    data: {
      projectId,
      name: `prompt-${randomUUID()}`,
      version: 1,
      type: "text",
      prompt: "Answer {{input}}",
      createdBy: "test",
    },
  });
  return {
    projectId,
    name: "registry experiment",
    runName: `run-${randomUUID()}`,
    promptId: prompt.id,
    datasetId: dataset.id,
    modelConfig: {
      provider: "openai",
      model: "gpt-4o",
      modelParams: { temperature: 0 },
    },
  };
};

describe("createExperiment with a registry model", () => {
  afterAll(async () => {
    await disconnectQueues();
  });

  it("stores the registry model id on the run, and nothing when none was chosen", async () => {
    const { projectId, caller } = await createCaller();
    const entry = await caller.modelRegistry.upsert({
      projectId,
      provider: "openai",
      modelId: "gpt-4o",
      displayName: "GPT-4o",
    });

    const withEntry = await experimentInput(projectId);
    const created = await caller.experiments.createExperiment({
      ...withEntry,
      modelConfig: { ...withEntry.modelConfig, registryModelId: entry.id },
    });
    const without = await caller.experiments.createExperiment(
      await experimentInput(projectId),
    );

    const run = await prisma.datasetRuns.findUniqueOrThrow({
      where: { id_projectId: { id: created.runId, projectId } },
    });
    const plainRun = await prisma.datasetRuns.findUniqueOrThrow({
      where: { id_projectId: { id: without.runId, projectId } },
    });
    expect(run.metadata).toMatchObject({
      provider: "openai",
      model: "gpt-4o",
      registry_model_id: entry.id,
    });
    expect(plainRun.metadata).not.toHaveProperty("registry_model_id");
  });

  it("rejects a registry model from another project", async () => {
    const { projectId, caller } = await createCaller();
    const { projectId: otherProjectId, caller: otherCaller } =
      await createCaller();
    const theirs = await otherCaller.modelRegistry.upsert({
      projectId: otherProjectId,
      provider: "openai",
      modelId: "gpt-4o",
      displayName: "GPT-4o",
    });

    const input = await experimentInput(projectId);
    await expect(
      caller.experiments.createExperiment({
        ...input,
        modelConfig: { ...input.modelConfig, registryModelId: theirs.id },
      }),
    ).rejects.toThrow(/registry model not found/i);
  });
});
