import { describe, expect, it } from "vitest";

import { experimentCapabilityWarnings } from "@/src/features/experiments/fns/experimentCapabilityWarnings";

const capable = {
  displayName: "GPT-4o",
  capabilities: { tools: true, vision: true, jsonMode: true },
  contextWindow: 128_000,
};
const plainDataset = {
  maxInputChars: 400,
  itemsWithMedia: 0,
  scannedItems: 10,
  sampled: false,
};

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
      datasetStats: {
        maxInputChars: 400,
        itemsWithMedia: 3,
        scannedItems: 10,
        sampled: false,
      },
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
        datasetStats: {
          maxInputChars: 4000,
          itemsWithMedia: 0,
          scannedItems: 10,
          sampled: false,
        },
      }),
    ).toEqual([]);
    const [over] = warn({
      model: small,
      datasetStats: {
        maxInputChars: 4004,
        itemsWithMedia: 0,
        scannedItems: 10,
        sampled: false,
      },
    });
    expect(over.code).toBe("contextWindow");
    expect(over.message).toContain("1,001 tokens");
  });

  it("gives no length warning when the model declares no context window", () => {
    expect(
      warn({
        model: { ...capable, contextWindow: null },
        datasetStats: {
          maxInputChars: 10_000_000,
          itemsWithMedia: 0,
          scannedItems: 10,
          sampled: false,
        },
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

  it("says the figures describe the first items when the dataset was only sampled", () => {
    const [vision, context] = warn({
      model: { ...capable, capabilities: {}, contextWindow: 1000 },
      datasetStats: {
        maxInputChars: 4004,
        itemsWithMedia: 39,
        scannedItems: 2000,
        sampled: true,
      },
    });
    expect(vision.message).toContain(
      "39 items in the first 2,000 dataset items",
    );
    expect(context.message).toContain(
      "The longest item in the first 2,000 dataset items",
    );
  });
});
