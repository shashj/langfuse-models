import { type Prisma } from "@langfuse/shared/src/db";
import { ZodModelConfig } from "@langfuse/shared";
import {
  RegistryModelCapabilitiesSchema,
  RegistryModelStatusSchema,
  type RegistryModelRow,
} from "@/src/features/model-registry/validation";

export const registryModelInclude = {
  pricingModel: { select: { id: true, modelName: true } },
} satisfies Prisma.RegistryModelInclude;

type RegistryModelWithPricing = Prisma.RegistryModelGetPayload<{
  include: typeof registryModelInclude;
}>;

export function toRegistryModelRow(
  row: RegistryModelWithPricing,
  connectionAvailable: boolean,
): RegistryModelRow {
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
    pricingModel: row.pricingModel,
    connectionAvailable,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
