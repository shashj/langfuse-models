import { describe, expect, it } from "vitest";

import { getRegistryModelOptionLabel } from "@/src/features/model-registry/registryModelOption";

const model = {
  displayName: "GPT-4o",
  provider: "openai",
  connectionAvailable: true,
  capabilities: { jsonMode: true },
};

describe("getRegistryModelOptionLabel", () => {
  it("names the provider, and the connection when it is missing", () => {
    expect(getRegistryModelOptionLabel(model)).toBe("GPT-4o (openai)");
    expect(
      getRegistryModelOptionLabel({ ...model, connectionAvailable: false }),
    ).toBe("GPT-4o (openai, no connection)");
  });

  it("notes a missing required capability instead of hiding the entry", () => {
    expect(getRegistryModelOptionLabel(model, "jsonMode")).toBe(
      "GPT-4o (openai)",
    );
    expect(
      getRegistryModelOptionLabel({ ...model, capabilities: {} }, "jsonMode"),
    ).toBe("GPT-4o (openai, not marked for JSON mode)");
  });
});
