import { afterAll, describe, expect, it } from "vitest";
import { createMocks } from "node-mocks-http";
import { type NextApiRequest, type NextApiResponse } from "next";
import { randomUUID } from "crypto";
import { prisma } from "@langfuse/shared/src/db";
import { createOrgProjectAndApiKey } from "@langfuse/shared/src/server";
import { disconnectQueues } from "@/src/__tests__/test-utils";
import registryModelsRoute from "@/src/pages/api/public/registry-models";
import registryModelRoute from "@/src/pages/api/public/registry-models/[registryModelId]";

afterAll(async () => {
  await disconnectQueues();
});

/** call invokes a registry-models route handler in-process with an API key header. */
const call = async (
  route: typeof registryModelsRoute | typeof registryModelRoute,
  params: {
    method: "GET" | "POST" | "PUT" | "DELETE";
    auth: string;
    registryModelId?: string;
    body?: Record<string, unknown>;
  },
) => {
  const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
    method: params.method,
    headers: { authorization: params.auth },
    query: params.registryModelId
      ? { registryModelId: params.registryModelId }
      : {},
    body: params.body,
  });
  await route(req, res);
  return {
    status: res.statusCode,
    json: res._getData() ? res._getJSONData() : undefined,
  };
};

const modelBody = (overrides: Record<string, unknown> = {}) => ({
  provider: "openai",
  modelId: `model-${randomUUID()}`,
  displayName: "Test model",
  ...overrides,
});

describe("public registry models API", () => {
  it("creates, reads, lists, replaces and deletes a registry model", async () => {
    const { auth } = await createOrgProjectAndApiKey();

    const created = await call(registryModelsRoute, {
      method: "POST",
      auth,
      body: modelBody({
        contextWindow: 128000,
        capabilities: { tools: true },
        defaultParams: { temperature: 0.2 },
      }),
    });
    expect(created.status).toBe(201);
    expect(created.json).toMatchObject({
      provider: "openai",
      status: "active",
      contextWindow: 128000,
      capabilities: { tools: true },
      defaultParams: { temperature: 0.2 },
      pricingModelId: null,
    });
    const registryModelId = created.json.id as string;

    const read = await call(registryModelRoute, {
      method: "GET",
      auth,
      registryModelId,
    });
    expect(read.json).toMatchObject({ id: registryModelId });

    const list = await call(registryModelsRoute, { method: "GET", auth });
    expect(list.json.meta).toMatchObject({ page: 1, totalItems: 1 });
    expect(list.json.data[0].id).toBe(registryModelId);

    const replaced = await call(registryModelRoute, {
      method: "PUT",
      auth,
      registryModelId,
      body: modelBody({
        modelId: created.json.modelId,
        displayName: "Renamed",
        status: "deprecated",
      }),
    });
    expect(replaced.status).toBe(200);
    expect(replaced.json).toMatchObject({
      id: registryModelId,
      displayName: "Renamed",
      status: "deprecated",
      // A replace sets every writable field, so omitted ones are cleared.
      contextWindow: null,
      defaultParams: null,
    });

    const deleted = await call(registryModelRoute, {
      method: "DELETE",
      auth,
      registryModelId,
    });
    expect(deleted.json).toEqual({
      message: "Registry model successfully deleted",
    });
    const gone = await call(registryModelRoute, {
      method: "GET",
      auth,
      registryModelId,
    });
    expect(gone.status).toBe(404);
  });

  it("rejects a field it does not know and a duplicate model", async () => {
    const { auth } = await createOrgProjectAndApiKey();
    const body = modelBody();

    const misspelled = await call(registryModelsRoute, {
      method: "POST",
      auth,
      body: { ...body, registryModelId: "abc" },
    });
    expect(misspelled.status).toBe(400);

    expect(
      (await call(registryModelsRoute, { method: "POST", auth, body })).status,
    ).toBe(201);
    const duplicate = await call(registryModelsRoute, {
      method: "POST",
      auth,
      body,
    });
    expect(duplicate.status).toBe(409);
  });

  it("keeps projects apart", async () => {
    const { auth } = await createOrgProjectAndApiKey();
    const { auth: otherAuth } = await createOrgProjectAndApiKey();
    const theirs = await call(registryModelsRoute, {
      method: "POST",
      auth: otherAuth,
      body: modelBody(),
    });
    const registryModelId = theirs.json.id as string;

    for (const method of ["GET", "PUT", "DELETE"] as const) {
      const res = await call(registryModelRoute, {
        method,
        auth,
        registryModelId,
        body: method === "PUT" ? modelBody() : undefined,
      });
      expect(res.status).toBe(404);
    }
    const ours = await call(registryModelsRoute, { method: "GET", auth });
    expect(ours.json.meta.totalItems).toBe(0);
  });

  it("refuses to delete a model that prompt versions use", async () => {
    const { projectId, auth } = await createOrgProjectAndApiKey();
    const created = await call(registryModelsRoute, {
      method: "POST",
      auth,
      body: modelBody(),
    });
    const registryModelId = created.json.id as string;
    await prisma.prompt.create({
      data: {
        id: randomUUID(),
        projectId,
        name: `uses-model-${randomUUID()}`,
        prompt: "Hello",
        type: "text",
        version: 1,
        labels: [],
        config: {},
        createdBy: "test",
        registryModelId,
      },
    });

    const res = await call(registryModelRoute, {
      method: "DELETE",
      auth,
      registryModelId,
    });
    expect(res.status).toBe(409);
    expect(res.json.message).toContain("used by 1 prompt version");
  });
});
