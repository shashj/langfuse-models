import { type LLMAdapter, type ModelConfig } from "@langfuse/shared";
import { getDefaultAdapterParams } from "./defaultAdapterParams";
import { type PlaygroundCache } from "../types";

/**
 * The playground's model params for a prompt's model. Starts from the
 * adapter's defaults, so that the playground sees a consistent adapter and
 * does not reset the params when the provider changes, and enables only the
 * params the prompt actually sets.
 */
export function buildPlaygroundModelParams(
  model: { provider: string; model: string; params: ModelConfig },
  adapter: LLMAdapter,
): NonNullable<NonNullable<PlaygroundCache>["modelParams"]> {
  const defaults = getDefaultAdapterParams(adapter);
  const { params } = model;

  return {
    ...defaults,
    provider: { value: model.provider, enabled: true },
    model: { value: model.model, enabled: true },
    ...(params.temperature !== undefined
      ? { temperature: { value: params.temperature, enabled: true } }
      : {}),
    ...(params.top_p !== undefined
      ? { top_p: { value: params.top_p, enabled: true } }
      : {}),
    ...(params.max_tokens !== undefined
      ? { max_tokens: { value: params.max_tokens, enabled: true } }
      : {}),
    ...(params.maxReasoningTokens !== undefined
      ? {
          maxReasoningTokens: {
            value: params.maxReasoningTokens,
            enabled: true,
          },
        }
      : {}),
    ...(params.providerOptions !== undefined
      ? { providerOptions: { value: params.providerOptions, enabled: true } }
      : {}),
  };
}
