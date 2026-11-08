// @vitest-environment node

import { resolveEffectivePromptModel } from "./effectivePromptModel";

const registryModel = {
  provider: "openai",
  modelId: "gpt-4o",
  defaultParams: { temperature: 0.2, max_tokens: 1024 },
};

describe("resolveEffectivePromptModel", () => {
  it("applies the prompt's params over the registry defaults", () => {
    expect(
      resolveEffectivePromptModel({
        registryModel,
        modelParams: { temperature: 0.9 },
      }),
    ).toEqual({
      provider: "openai",
      model: "gpt-4o",
      params: { temperature: 0.9, max_tokens: 1024 },
    });
  });

  it("falls back to the registry defaults when the prompt sets no params", () => {
    expect(
      resolveEffectivePromptModel({ registryModel, modelParams: null })?.params,
    ).toEqual({ temperature: 0.2, max_tokens: 1024 });
  });

  it("is null for a prompt without a registry model", () => {
    expect(
      resolveEffectivePromptModel({ registryModel: null, modelParams: {} }),
    ).toBeNull();
  });
});
