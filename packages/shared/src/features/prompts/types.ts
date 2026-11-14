import { z } from "zod";
import type { Prompt } from "@prisma/client";
import { isoDateTime, jsonSchema, optionalJsonParam } from "../../utils/zod";
import {
  arrayOptionsFilter,
  coerceLegacyEmptyMetadataFilters,
  numberFilter,
  stringFilter,
  stringObjectFilter,
  stringOptionsFilter,
  timeFilter,
} from "../../interfaces/filters";
import {
  COMMIT_MESSAGE_MAX_LENGTH,
  PROMPT_LABEL_MAX_LENGTH,
  PROMPT_LABEL_REGEX,
  PROMPT_LABEL_REGEX_ERROR,
} from "./constants";
import {
  PromptChatMessageSchema,
  ZodModelConfig,
} from "../../server/llm/types";
import { PromptNameSchema } from "./validation";

export const SingleChatMessageSchema = PromptChatMessageSchema;
export type SingleChatMessage = z.infer<typeof SingleChatMessageSchema>;

export enum PromptType {
  Chat = "chat",

  Text = "text",
}

export const PromptLabelSchema = z
  .string()
  .min(1)
  .max(PROMPT_LABEL_MAX_LENGTH)
  .regex(PROMPT_LABEL_REGEX, PROMPT_LABEL_REGEX_ERROR);

// The model a prompt version runs on: a registry model of the project, plus
// per-version overrides of that model's default parameters.
const PromptModelInputSchema = z.object({
  registryModelId: z.string().nullish(),
  modelParams: ZodModelConfig.nullish(),
});

// What a prompt read returns for the model: the stored fields, and the model
// resolved from the registry with the effective parameters (the registry's
// defaults with the version's overrides applied).
const PromptModelResponseSchema = z.object({
  registryModelId: z.string().nullish(),
  modelParams: ZodModelConfig.nullish(),
  model: z
    .object({
      provider: z.string(),
      modelId: z.string(),
      params: ZodModelConfig,
    })
    .nullish(),
});

const BaseCreateTextPromptSchema = z.object({
  name: PromptNameSchema,
  labels: z.array(PromptLabelSchema).default([]),
  type: z.literal(PromptType.Text).optional(),
  prompt: z.string(),
  config: jsonSchema.nullable().default({}),
  tags: z.array(z.string()).nullish(),
});

const LegacyCreateTextPromptSchema = BaseCreateTextPromptSchema;

export const CreateTextPromptSchema = BaseCreateTextPromptSchema.extend({
  commitMessage: z.string().max(COMMIT_MESSAGE_MAX_LENGTH).nullish(),
  ...PromptModelInputSchema.shape,
});

const BaseCreateChatPromptSchema = z.object({
  name: PromptNameSchema,
  labels: z.array(PromptLabelSchema).default([]),
  type: z.literal(PromptType.Chat),
  prompt: z.array(PromptChatMessageSchema),
  config: jsonSchema.nullable().default({}),
  tags: z.array(z.string()).nullish(),
});

const LegacyCreateChatPromptSchema = BaseCreateChatPromptSchema;

export const CreateChatPromptSchema = BaseCreateChatPromptSchema.extend({
  commitMessage: z.string().max(COMMIT_MESSAGE_MAX_LENGTH).nullish(),
  ...PromptModelInputSchema.shape,
});

export const CreatePromptSchema = z.union([
  CreateTextPromptSchema,
  CreateChatPromptSchema,
]);

export type CreatePromptType = z.infer<typeof CreatePromptSchema>;

// TRPC route requires projectId
const CreateTextPromptTRPCSchema = CreateTextPromptSchema.extend({
  projectId: z.string(),
});
const CreateChatPromptTRPCSchema = CreateChatPromptSchema.extend({
  projectId: z.string(),
});
export const CreatePromptTRPCSchema = z.union([
  CreateTextPromptTRPCSchema,
  CreateChatPromptTRPCSchema,
]);

export type CreatePromptTRPCType = z.infer<typeof CreatePromptTRPCSchema>;

const promptFilterSchema = z.preprocess(
  coerceLegacyEmptyMetadataFilters,
  z.array(
    z.discriminatedUnion("type", [
      stringFilter.extend({ column: z.enum(["id", "name", "type"]) }),
      stringOptionsFilter.safeExtend({
        column: z.enum(["id", "name", "type"]),
      }),
      numberFilter.extend({ column: z.literal("version") }),
      timeFilter.extend({ column: z.enum(["createdAt", "updatedAt"]) }),
      arrayOptionsFilter.safeExtend({
        column: z.enum(["labels", "tags"]),
        value: z.array(z.string()).min(1),
      }),
      stringObjectFilter.extend({ column: z.literal("config") }),
    ]),
  ),
);

export const GetPromptsMetaSchema = z.object({
  name: z.string().optional(),
  version: z.coerce.number().int().nullish(),
  label: z.string().optional(),
  tag: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  fromUpdatedAt: isoDateTime({ offset: true }).nullish(),
  toUpdatedAt: isoDateTime({ offset: true }).nullish(),
  filter: optionalJsonParam(promptFilterSchema, "filter"),
});

export type GetPromptsMetaType = z.infer<typeof GetPromptsMetaSchema>;

export const GetPromptSchema = z.object({
  name: z.string().transform((v) => decodeURIComponent(v)),
  version: z.coerce.number().int().nullish(),
});

export const GetPromptByNameSchema = z.object({
  promptName: z.string(),
  version: z.coerce.number().int().nullish(),
  label: z.string().optional(),
  resolve: z
    .enum(["true", "false"])
    .nullish()
    .default("true")
    .transform((v) => v === "true"), // Optional, defaults to true for backward compatibility
});

const BaseTextPromptSchema = z.object({
  id: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
  projectId: z.string(),
  createdBy: z.string(),
  version: z.number(),
  name: z.string(),
  labels: z.array(PromptLabelSchema),
  tags: z.array(z.string()),
  type: z.literal(PromptType.Text),
  prompt: z.string(),
  config: jsonSchema,
});

const LegacyTextPromptSchema = BaseTextPromptSchema;

export const TextPromptSchema = BaseTextPromptSchema.extend({
  commitMessage: z.string().max(COMMIT_MESSAGE_MAX_LENGTH).nullish(),
  ...PromptModelResponseSchema.shape,
});

// Compared against the database row without the model columns, because the
// response schemas describe them differently (nullish, with a resolved model).
type PublicPromptColumns = Omit<Prompt, "registryModelId" | "modelParams">;

export type TextPromptType =
  z.infer<typeof TextPromptSchema> extends PublicPromptColumns
    ? z.infer<typeof TextPromptSchema>
    : never;

export const BaseChatPromptSchema = z.object({
  id: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
  projectId: z.string(),
  createdBy: z.string(),
  version: z.number(),
  name: z.string(),
  tags: z.array(z.string()),
  labels: z.array(PromptLabelSchema),
  type: z.literal(PromptType.Chat),
  prompt: z.array(PromptChatMessageSchema),
  config: jsonSchema,
});

const LegacyChatPromptSchema = BaseChatPromptSchema;

export const ChatPromptSchema = BaseChatPromptSchema.extend({
  commitMessage: z.string().max(COMMIT_MESSAGE_MAX_LENGTH).nullish(),
  ...PromptModelResponseSchema.shape,
});

export type ChatPromptType =
  z.infer<typeof ChatPromptSchema> extends PublicPromptColumns
    ? z.infer<typeof ChatPromptSchema>
    : never;

export const PromptSchema = z.union([TextPromptSchema, ChatPromptSchema]);
export type ValidatedPrompt = z.infer<typeof PromptSchema>;

// Backward compat for V1 prompts endpoint
export const LegacyCreatePromptSchema = z.union([
  LegacyCreateTextPromptSchema.extend({ isActive: z.boolean() }),
  LegacyCreateChatPromptSchema.extend({ isActive: z.boolean() }),
]);
export const LegacyPromptSchema = z.union([
  LegacyTextPromptSchema.extend({ isActive: z.boolean() }),
  LegacyChatPromptSchema.extend({ isActive: z.boolean() }),
]);
export type LegacyValidatedPrompt = z.infer<typeof LegacyPromptSchema>;
