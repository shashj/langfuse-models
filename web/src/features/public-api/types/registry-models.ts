import {
  paginationMetaResponseZod,
  publicApiPaginationZod,
  ZodModelConfig,
} from "@langfuse/shared";
import { z } from "zod";
import {
  RegistryModelCapabilitiesSchema,
  RegistryModelStatusSchema,
  UpsertRegistryModelSchema,
} from "@/src/features/model-registry/validation";

/**
 * Objects
 */

const APIRegistryModel = z
  .object({
    id: z.string(),
    provider: z.string(),
    modelId: z.string(),
    displayName: z.string(),
    description: z.string().nullable(),
    status: RegistryModelStatusSchema,
    contextWindow: z.number().int().nullable(),
    maxOutputTokens: z.number().int().nullable(),
    capabilities: RegistryModelCapabilitiesSchema,
    defaultParams: ZodModelConfig.nullable(),
    pricingModelId: z.string().nullable(),
    createdAt: z.coerce.date(),
    updatedAt: z.coerce.date(),
  })
  .strict();

// The writable fields. Strict, so that a misspelled field is an error rather
// than a silently ignored one.
export const RegistryModelV1Body = UpsertRegistryModelSchema.omit({
  projectId: true,
  id: true,
}).strict();

/**
 * Endpoints
 */

// GET /registry-models
export const GetRegistryModelsV1Query = z.object({
  ...publicApiPaginationZod,
});
export const GetRegistryModelsV1Response = z
  .object({
    data: z.array(APIRegistryModel),
    meta: paginationMetaResponseZod,
  })
  .strict();

// POST /registry-models, GET and PUT /registry-models/{registryModelId}
export const RegistryModelV1Response = APIRegistryModel;

// GET, PUT, DELETE /registry-models/{registryModelId}
export const RegistryModelV1Query = z.object({
  registryModelId: z.string(),
});
export const DeleteRegistryModelV1Response = z
  .object({
    message: z.literal("Registry model successfully deleted"),
  })
  .strict();
