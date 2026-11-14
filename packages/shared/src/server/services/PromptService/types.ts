import { type Prisma, type Prompt } from "../../../db";
import { type ModelConfig } from "../../llm/types";

/** The registry model fields a prompt read needs to resolve its model. */
export type PromptRegistryModel = {
  provider: string;
  modelId: string;
  defaultParams: Prisma.JsonValue | null;
};

/** A prompt row, optionally with the registry model it references. */
export type PromptWithRegistryModel = Prompt & {
  registryModel?: PromptRegistryModel | null;
};

/** The model a prompt version runs on, with its effective parameters. */
export type PromptResultModel = {
  provider: string;
  modelId: string;
  params: ModelConfig;
};

export type PromptResult = Prompt & {
  resolutionGraph: PromptGraph | null;
  /** Null when the prompt has no registry model. */
  model: PromptResultModel | null;
};

export type PromptParams = {
  projectId: string;
  promptName: string;
  resolve?: boolean;
} & (
  | { version: number; label: undefined }
  | { version: null | undefined; label: string }
);

export enum PromptServiceMetrics {
  PromptCacheHit = "prompt_cache_hit",
  PromptCacheMiss = "prompt_cache_miss",
}

export type PartialPrompt = Pick<
  Prompt,
  "id" | "prompt" | "name" | "version" | "labels"
>;

export type PromptReference = Pick<Prompt, "id" | "version" | "name">;

export type PromptGraph = {
  root: PromptReference;
  dependencies: Record<string, PromptReference[]>;
};

export type ResolvedPromptGraph = {
  graph: PromptGraph | null;
  resolvedPrompt: Prompt["prompt"];
};
