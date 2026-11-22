import { z } from "zod";
import { ZodModelConfig } from "@langfuse/shared";

export const REGISTRY_MODEL_STATUSES = ["active", "deprecated"] as const;
export const RegistryModelStatusSchema = z.enum(REGISTRY_MODEL_STATUSES);
type RegistryModelStatus = z.infer<typeof RegistryModelStatusSchema>;

export const CAPABILITY_KEYS = [
  "tools",
  "vision",
  "jsonMode",
  "reasoning",
] as const;

export type CapabilityKey = (typeof CAPABILITY_KEYS)[number];

export const CAPABILITY_LABELS: Record<CapabilityKey, string> = {
  tools: "Tool calling",
  vision: "Vision",
  jsonMode: "JSON mode",
  reasoning: "Reasoning",
};

export const RegistryModelCapabilitiesSchema = z.object({
  tools: z.boolean().optional(),
  vision: z.boolean().optional(),
  jsonMode: z.boolean().optional(),
  reasoning: z.boolean().optional(),
});
type RegistryModelCapabilities = z.infer<
  typeof RegistryModelCapabilitiesSchema
>;

export const UpsertRegistryModelSchema = z.object({
  projectId: z.string(),
  // Present when editing; absent when creating.
  id: z.string().optional(),
  provider: z.string().trim().min(1, "Provider is required"),
  modelId: z.string().trim().min(1, "Model ID is required"),
  displayName: z.string().trim().min(1, "Display name is required"),
  description: z.string().trim().nullish(),
  status: RegistryModelStatusSchema.default("active"),
  contextWindow: z.number().int().positive().nullish(),
  maxOutputTokens: z.number().int().positive().nullish(),
  capabilities: RegistryModelCapabilitiesSchema.default({}),
  defaultParams: ZodModelConfig.nullish(),
  pricingModelId: z.string().nullish(),
});

export const RegistryModelListInputSchema = z.object({
  projectId: z.string(),
  searchString: z.string().default(""),
  // Zero-based, matching the table's pagination state.
  page: z.number().int().nonnegative().default(0),
  limit: z.number().int().positive().max(200).default(50),
});

/** The model definition that prices a registry entry, and where the link comes from. */
export type RegistryPricing = {
  id: string;
  modelName: string;
  /** `linked` was picked by a user, `matched` is found from the model id. */
  source: "linked" | "matched";
};

export type RegistryModelRow = {
  id: string;
  provider: string;
  modelId: string;
  displayName: string;
  description: string | null;
  status: RegistryModelStatus;
  contextWindow: number | null;
  maxOutputTokens: number | null;
  capabilities: RegistryModelCapabilities;
  defaultParams: z.infer<typeof ZodModelConfig> | null;
  pricingModel: RegistryPricing | null;
  // True when an effective LLM connection for `provider` can run `modelId`.
  connectionAvailable: boolean;
  createdAt: Date;
  updatedAt: Date;
};
