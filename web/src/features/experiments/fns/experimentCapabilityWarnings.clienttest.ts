import { describe, expect, it } from "vitest";

import { experimentCapabilityWarnings } from "@/src/features/experiments/fns/experimentCapabilityWarnings";

const capable = {
  displayName: "GPT-4o",
  capabilities: { tools: true, vision: true, jsonMode: true },
  contextWindow: 128_000,
};
const plainDataset = { maxInputChars: 400, itemsWithMedia: 0 };

const warn = (
  overrides: Partial<Parameters<typeof experimentCapabilityWarnings>[0]>,
) =>
  experimentCapabilityWarnings({
    model: capable,
    datasetStats: plainDataset,
    promptHasTools: false,
    structuredOutputEnabled: false,
    ...overrides,
  });

describe("experimentCapabilityWarnings", () => {
  it("has nothing to say for a capable model on a plain dataset", () => {
    expect(warn({})).toEqual([]);
  });

  it("warns about each missing capability the run needs", () => {
    const bare = { ...capable, capabilities: {} };
    const codes = warn({
      model: bare,
      datasetStats: { maxInputChars: 400, itemsWithMedia: 3 },
      promptHasTools: true,
      structuredOutputEnabled: true,
    }).map((w) => w.code);
    expect(codes).toEqual(["vision", "tools", "jsonMode"]);
  });

  it("does not warn for a capability the run does not use", () => {
    expect(warn({ model: { ...capable, capabilities: {} } })).toEqual([]);
  });

  it("warns when the longest item is over the context window, and not at it", () => {
    const small = { ...capable, contextWindow: 1000 };
    expect(
      warn({
        model: small,
        datasetStats: { maxInputChars: 4000, itemsWithMedia: 0 },
      }),
    ).toEqual([]);
    const [over] = warn({
      model: small,
      datasetStats: { maxInputChars: 4004, itemsWithMedia: 0 },
    });
    expect(over.code).toBe("contextWindow");
    expect(over.message).toContain("1,001 tokens");
  });

  it("gives no length warning when the model declares no context window", () => {
    expect(
      warn({
        model: { ...capable, contextWindow: null },
        datasetStats: { maxInputChars: 10_000_000, itemsWithMedia: 0 },
      }),
    ).toEqual([]);
  });

  it("waits for the dataset facts instead of guessing", () => {
    expect(
      warn({
        datasetStats: undefined,
        model: { ...capable, capabilities: {} },
      }),
    ).toEqual([]);
  });
});
