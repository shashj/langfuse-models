// @vitest-environment node

import {
  modelFormDefaults,
  modelFormValuesFromPlayground,
  modelSubmitValues,
  NO_MODEL,
} from "./promptModelFormValues";

describe("modelSubmitValues", () => {
  it("drops typed params when the prompt has no model", () => {
    expect(
      modelSubmitValues({ registryModelId: NO_MODEL, modelTemperature: "0.5" }),
    ).toEqual({ registryModelId: null, modelParams: null });
  });

  it("sends null params when every override is blank", () => {
    expect(
      modelSubmitValues({ registryModelId: "model-1", modelTemperature: " " }),
    ).toEqual({ registryModelId: "model-1", modelParams: null });
  });

  it("sends only the overrides that were filled in, as numbers", () => {
    expect(
      modelSubmitValues({
        registryModelId: "model-1",
        modelTemperature: "0.2",
        modelMaxTokens: "512",
      }),
    ).toEqual({
      registryModelId: "model-1",
      modelParams: { temperature: 0.2, top_p: undefined, max_tokens: 512 },
    });
  });
});

describe("modelFormDefaults", () => {
  it("restores the model and params of an existing prompt version", () => {
    expect(
      modelFormDefaults({
        registryModelId: "model-1",
        modelParams: { temperature: 0.2, max_tokens: 512 },
      }),
    ).toEqual({
      registryModelId: "model-1",
      modelTemperature: "0.2",
      modelTopP: "",
      modelMaxTokens: "512",
    });
  });
});

describe("modelFormValuesFromPlayground", () => {
  it("keeps only the params the playground had enabled", () => {
    expect(
      modelFormValuesFromPlayground({
        registryModelId: "model-1",
        modelParams: {
          temperature: { value: 0.7, enabled: true },
          top_p: { value: 1, enabled: false },
          max_tokens: { value: 256, enabled: true },
        },
      }),
    ).toEqual({
      registryModelId: "model-1",
      modelTemperature: "0.7",
      modelTopP: "",
      modelMaxTokens: "256",
    });
  });

  it("leaves the form alone when the playground model is not in the registry", () => {
    expect(
      modelFormValuesFromPlayground({
        registryModelId: null,
        modelParams: { temperature: { value: 0.7, enabled: true } },
      }),
    ).toBeNull();
  });
});
