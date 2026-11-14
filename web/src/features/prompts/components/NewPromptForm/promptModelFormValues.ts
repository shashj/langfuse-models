import {
  ZodModelConfig,
  type Prompt,
  type UIModelParams,
} from "@langfuse/shared";

/** Select value meaning "this prompt version has no model". */
export const NO_MODEL = "none";

/** The model-related fields of the prompt form. Numbers stay text while editing. */
export type PromptModelFormValues = {
  registryModelId?: string;
  modelTemperature?: string;
  modelTopP?: string;
  modelMaxTokens?: string;
};

const toText = (value: number | undefined) =>
  value === undefined ? "" : String(value);

/** Initial form values for the model fields of `prompt`, or empty for a new prompt. */
export function modelFormDefaults(
  prompt?: Pick<Prompt, "registryModelId" | "modelParams"> | null,
): Required<PromptModelFormValues> {
  const params = ZodModelConfig.safeParse(prompt?.modelParams ?? {});
  const parsed = params.success ? params.data : {};

  return {
    registryModelId: prompt?.registryModelId ?? NO_MODEL,
    modelTemperature: toText(parsed.temperature),
    modelTopP: toText(parsed.top_p),
    modelMaxTokens: toText(parsed.max_tokens),
  };
}

/** The `registryModelId` and `modelParams` the create mutation expects. */
export function modelSubmitValues(values: PromptModelFormValues) {
  const registryModelId =
    !values.registryModelId || values.registryModelId === NO_MODEL
      ? null
      : values.registryModelId;
  if (!registryModelId) return { registryModelId: null, modelParams: null };

  const toNumber = (text?: string) =>
    text && text.trim() !== "" ? Number(text) : undefined;
  const params = {
    temperature: toNumber(values.modelTemperature),
    top_p: toNumber(values.modelTopP),
    max_tokens: toNumber(values.modelMaxTokens),
  };
  const hasParams = Object.values(params).some((value) => value !== undefined);

  return { registryModelId, modelParams: hasParams ? params : null };
}

/**
 * Form values for a prompt saved from the playground: the registry model the
 * playground was set to and the params it had enabled. Null when the
 * playground's model is not in the registry.
 */
export function modelFormValuesFromPlayground(
  cache:
    | {
        registryModelId?: string | null;
        modelParams?: Partial<UIModelParams>;
      }
    | null
    | undefined,
): Required<PromptModelFormValues> | null {
  if (!cache?.registryModelId) return null;

  const params = cache.modelParams;
  const enabledValue = (param?: { value: number; enabled: boolean }) =>
    param?.enabled ? param.value : undefined;

  return {
    registryModelId: cache.registryModelId,
    modelTemperature: toText(enabledValue(params?.temperature)),
    modelTopP: toText(enabledValue(params?.top_p)),
    modelMaxTokens: toText(enabledValue(params?.max_tokens)),
  };
}
