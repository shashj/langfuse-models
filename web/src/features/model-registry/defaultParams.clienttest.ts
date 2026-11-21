import { describe, expect, it } from "vitest";

import {
  defaultParamsFromFields,
  fieldsFromDefaultParams,
  providerOptionsError,
} from "@/src/features/model-registry/defaultParams";

describe("registry default params", () => {
  it("keeps reasoning settings through an edit and save", () => {
    const stored = {
      temperature: 0.2,
      maxReasoningTokens: 2048,
      providerOptions: { reasoning_effort: "high" },
    };
    expect(
      defaultParamsFromFields(fieldsFromDefaultParams(stored)),
    ).toMatchObject(stored);
  });

  it("keeps zero and negative reasoning budgets, which mean off and automatic", () => {
    const fields = fieldsFromDefaultParams(null);
    expect(
      defaultParamsFromFields({ ...fields, maxReasoningTokens: "0" })
        ?.maxReasoningTokens,
    ).toBe(0);
    expect(
      defaultParamsFromFields({ ...fields, maxReasoningTokens: "-1" })
        ?.maxReasoningTokens,
    ).toBe(-1);
  });

  it("stores nothing when every field is empty or the options are an empty object", () => {
    const fields = fieldsFromDefaultParams(null);
    expect(defaultParamsFromFields(fields)).toBeNull();
    expect(
      defaultParamsFromFields({ ...fields, providerOptions: "{}" }),
    ).toBeNull();
  });

  it("accepts only a JSON object as provider options", () => {
    expect(providerOptionsError("")).toBeNull();
    expect(providerOptionsError('{"reasoning_effort": "high"}')).toBeNull();
    expect(providerOptionsError("{not json")).toMatch(/valid JSON/);
    expect(providerOptionsError('["high"]')).toMatch(/JSON object/);
    expect(providerOptionsError('"high"')).toMatch(/JSON object/);
  });
});
