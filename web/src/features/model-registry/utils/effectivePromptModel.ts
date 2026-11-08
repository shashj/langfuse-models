import { ZodModelConfig, type ModelConfig } from "@langfuse/shared";

type EffectivePromptModel = {
  /** Name of the LLM connection that runs the model. */
  provider: string;
  model: string;
  /** The registry model's default params with the prompt version's overrides applied. */
  params: ModelConfig;
};

/**
 * The model a prompt version runs on: its registry model's provider and id,
 * and the registry's default params overridden by the version's own params.
 * Null when the version has no registry model.
 */
export function resolveEffectivePromptModel(input: {
  registryModel:
    | { provider: string; modelId: string; defaultParams?: unknown }
    | null
    | undefined;
  modelParams: unknown;
}): EffectivePromptModel | null {
  const { registryModel } = input;
  if (!registryModel) return null;

  const defaults = ZodModelConfig.safeParse(registryModel.defaultParams ?? {});
  const overrides = ZodModelConfig.safeParse(input.modelParams ?? {});

  return {
    provider: registryModel.provider,
    model: registryModel.modelId,
    params: {
      ...(defaults.success ? defaults.data : {}),
      ...(overrides.success ? overrides.data : {}),
    },
  };
}
