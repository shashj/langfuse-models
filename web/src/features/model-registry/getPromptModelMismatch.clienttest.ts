import { describe, expect, it } from "vitest";

import { getPromptModelMismatch } from "@/src/features/model-registry/getPromptModelMismatch";

const promptModel = {
  displayName: "GPT-4o",
  modelId: "gpt-4o",
  pricingModelId: "pricing-gpt-4o",
};

describe("getPromptModelMismatch", () => {
  it("flags a generation that matched a different pricing model", () => {
    expect(
      getPromptModelMismatch({
        promptModel,
        observation: { model: "gpt-4o-mini", internalModelId: "pricing-mini" },
      }),
    ).toEqual({ expectedModel: "GPT-4o" });
  });

  it("does not flag the same pricing model under a snapshot name", () => {
    expect(
      getPromptModelMismatch({
        promptModel,
        observation: {
          model: "gpt-4o-2024-08-06",
          internalModelId: "pricing-gpt-4o",
        },
      }),
    ).toBeNull();
  });

  it("does not flag when the model name equals the registry model id", () => {
    expect(
      getPromptModelMismatch({
        promptModel,
        observation: { model: "gpt-4o", internalModelId: "pricing-other" },
      }),
    ).toBeNull();
  });

  it("flags nothing when the models cannot be compared", () => {
    expect(
      getPromptModelMismatch({
        promptModel: { ...promptModel, pricingModelId: null },
        observation: { model: "gpt-4o-mini", internalModelId: "pricing-mini" },
      }),
    ).toBeNull();
    expect(
      getPromptModelMismatch({
        promptModel,
        observation: { model: "something-else", internalModelId: null },
      }),
    ).toBeNull();
    expect(
      getPromptModelMismatch({
        promptModel: null,
        observation: { model: "gpt-4o-mini", internalModelId: "pricing-mini" },
      }),
    ).toBeNull();
  });
});
