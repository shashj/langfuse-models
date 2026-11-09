import type { z } from "zod";

import { auditLog } from "@/src/features/audit-logs/auditLog";
import {
  removeRegistryModel,
  saveRegistryModel,
} from "@/src/features/model-registry/server/registryModelService";
import {
  RegistryModelCapabilitiesSchema,
  RegistryModelStatusSchema,
} from "@/src/features/model-registry/validation";
import type {
  GetRegistryModelsV1Query,
  RegistryModelV1Body,
  RegistryModelV1Response,
} from "@/src/features/public-api/types/registry-models";
import { LangfuseNotFoundError, ZodModelConfig } from "@langfuse/shared";
import { prisma, type RegistryModel } from "@langfuse/shared/src/db";

type AuditScope = {
  projectId: string;
  orgId: string;
  apiKeyId: string;
};

type Body = z.infer<typeof RegistryModelV1Body>;

const toApiRegistryModel = (
  row: RegistryModel,
): z.infer<typeof RegistryModelV1Response> => {
  const status = RegistryModelStatusSchema.safeParse(row.status);
  const capabilities = RegistryModelCapabilitiesSchema.safeParse(
    row.capabilities,
  );
  const defaultParams = ZodModelConfig.safeParse(row.defaultParams);

  return {
    id: row.id,
    provider: row.provider,
    modelId: row.modelId,
    displayName: row.displayName,
    description: row.description,
    status: status.success ? status.data : "active",
    contextWindow: row.contextWindow,
    maxOutputTokens: row.maxOutputTokens,
    capabilities: capabilities.success ? capabilities.data : {},
    defaultParams:
      row.defaultParams && defaultParams.success ? defaultParams.data : null,
    pricingModelId: row.pricingModelId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
};

export const listRegistryModelsForApi = async ({
  projectId,
  page,
  limit,
}: z.infer<typeof GetRegistryModelsV1Query> & { projectId: string }) => {
  const [rows, totalItems] = await Promise.all([
    prisma.registryModel.findMany({
      where: { projectId },
      orderBy: [{ provider: "asc" }, { displayName: "asc" }, { id: "asc" }],
      take: limit,
      skip: (page - 1) * limit,
    }),
    prisma.registryModel.count({ where: { projectId } }),
  ]);

  return {
    data: rows.map(toApiRegistryModel),
    meta: {
      page,
      limit,
      totalItems,
      totalPages: Math.ceil(totalItems / limit),
    },
  };
};

export const getRegistryModelForApi = async ({
  projectId,
  registryModelId,
}: {
  projectId: string;
  registryModelId: string;
}) => {
  const row = await prisma.registryModel.findFirst({
    where: { id: registryModelId, projectId },
  });
  if (!row) throw new LangfuseNotFoundError("Registry model not found");

  return toApiRegistryModel(row);
};

export const createRegistryModelForApi = async ({
  projectId,
  input,
  auditScope,
}: {
  projectId: string;
  input: Body;
  auditScope: AuditScope;
}) => {
  const { model } = await saveRegistryModel({ prisma, projectId, input });

  await auditLog({
    action: "create",
    resourceType: "registryModel",
    resourceId: model.id,
    after: model,
    ...auditScope,
  });

  return toApiRegistryModel(model);
};

/** Replaces every writable field of an existing registry model. */
export const replaceRegistryModelForApi = async ({
  projectId,
  registryModelId,
  input,
  auditScope,
}: {
  projectId: string;
  registryModelId: string;
  input: Body;
  auditScope: AuditScope;
}) => {
  const { model } = await saveRegistryModel({
    prisma,
    projectId,
    id: registryModelId,
    input,
  });

  await auditLog({
    action: "update",
    resourceType: "registryModel",
    resourceId: model.id,
    after: model,
    ...auditScope,
  });

  return toApiRegistryModel(model);
};

export const deleteRegistryModelForApi = async ({
  registryModelId,
  ...auditScope
}: AuditScope & { registryModelId: string }) => {
  const deleted = await removeRegistryModel({
    prisma,
    projectId: auditScope.projectId,
    id: registryModelId,
  });

  await auditLog({
    action: "delete",
    resourceType: "registryModel",
    resourceId: registryModelId,
    before: deleted,
    ...auditScope,
  });

  return { message: "Registry model successfully deleted" as const };
};
