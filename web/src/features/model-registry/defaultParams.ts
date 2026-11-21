import { JSONObjectSchema, type ZodModelConfig } from "@langfuse/shared";
import type { z } from "zod";

export type RegistryDefaultParams = z.infer<typeof ZodModelConfig>;

/** The default parameters as the Edit model form holds them: everything is text while editing. */
export type DefaultParamsFields = {
  temperature: string;
  topP: string;
  maxTokens: string;
  maxReasoningTokens: string;
  /** A JSON object, such as {"reasoning_effort": "high"}. Empty means none. */
  providerOptions: string;
};

const toText = (value: number | null | undefined) =>
  value === null || value === undefined ? "" : String(value);

const toNumber = (value: string) => {
  const trimmed = value.trim();
  return trimmed === "" ? undefined : Number(trimmed);
};

export function fieldsFromDefaultParams(
  params: RegistryDefaultParams | null | undefined,
): DefaultParamsFields {
  const options = params?.providerOptions;
  return {
    temperature: toText(params?.temperature),
    topP: toText(params?.top_p),
    maxTokens: toText(params?.max_tokens),
    maxReasoningTokens: toText(params?.maxReasoningTokens),
    providerOptions:
      options && Object.keys(options).length > 0
        ? JSON.stringify(options, null, 2)
        : "",
  };
}

/** The reason `text` is not valid provider options, or null when it is empty or a JSON object. */
export function providerOptionsError(text: string): string | null {
  if (text.trim() === "") return null;
  try {
    return JSONObjectSchema.safeParse(JSON.parse(text)).success
      ? null
      : 'Enter a JSON object, for example {"reasoning_effort": "high"}';
  } catch {
    return "Enter valid JSON";
  }
}

/** The params to store, or null when nothing is set. Assumes the fields are valid. */
export function defaultParamsFromFields(
  fields: DefaultParamsFields,
): RegistryDefaultParams | null {
  const providerOptions =
    providerOptionsError(fields.providerOptions) === null &&
    fields.providerOptions.trim() !== ""
      ? JSONObjectSchema.parse(JSON.parse(fields.providerOptions))
      : undefined;
  const params: RegistryDefaultParams = {
    temperature: toNumber(fields.temperature),
    top_p: toNumber(fields.topP),
    max_tokens: toNumber(fields.maxTokens),
    maxReasoningTokens: toNumber(fields.maxReasoningTokens),
    providerOptions:
      providerOptions && Object.keys(providerOptions).length > 0
        ? providerOptions
        : undefined,
  };
  return Object.values(params).some((value) => value !== undefined)
    ? params
    : null;
}
