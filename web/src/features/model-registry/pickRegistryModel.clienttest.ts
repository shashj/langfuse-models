import { describe, expect, it } from "vitest";

import { pickRegistryModelForGeneration } from "@/src/features/model-registry/pickRegistryModel";

const base = { id: "a", modelId: "gpt-4o" };
const dated = { id: "b", modelId: "gpt-4o-2024-08-06" };

describe("pickRegistryModelForGeneration", () => {
  it("prefers the entry whose model id is the generation's model name", () => {
    expect(
      pickRegistryModelForGeneration([base, dated], "gpt-4o-2024-08-06"),
    ).toBe(dated);
  });

  it("falls back to the first entry when no model id equals the name", () => {
    expect(
      pickRegistryModelForGeneration([base, dated], "gpt-4o-2025-01-01"),
    ).toBe(base);
    expect(pickRegistryModelForGeneration([base, dated], null)).toBe(base);
  });

  it("returns nothing for no entries", () => {
    expect(pickRegistryModelForGeneration([], "gpt-4o")).toBeUndefined();
    expect(pickRegistryModelForGeneration(undefined, "gpt-4o")).toBeUndefined();
  });
});
