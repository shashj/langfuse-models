import { describe, expect, it } from "vitest";

import { resolveRegistryModelForRun } from "@/src/features/model-registry/resolveRunModel";

const gpt = { id: "reg-gpt", provider: "openai", modelId: "gpt-4o" };
const claude = {
  id: "reg-claude",
  provider: "anthropic",
  modelId: "claude-sonnet-4-5",
};
const entries = [gpt, claude];

describe("resolveRegistryModelForRun", () => {
  it("matches a run that only stored provider and model", () => {
    expect(
      resolveRegistryModelForRun(
        { provider: "anthropic", model: "claude-sonnet-4-5" },
        entries,
      ),
    ).toBe(claude);
  });

  it("prefers the stored id, so an entry whose model id was edited still resolves", () => {
    const renamed = { ...gpt, modelId: "gpt-4o-2024-11-20" };
    expect(
      resolveRegistryModelForRun(
        { registry_model_id: "reg-gpt", provider: "openai", model: "gpt-4o" },
        [renamed, claude],
      ),
    ).toBe(renamed);
  });

  it("falls back to provider and model when the stored id no longer exists", () => {
    expect(
      resolveRegistryModelForRun(
        { registry_model_id: "deleted", provider: "openai", model: "gpt-4o" },
        entries,
      ),
    ).toBe(gpt);
  });

  it("returns null for a model that is not registered or has no metadata", () => {
    expect(
      resolveRegistryModelForRun(
        { provider: "openai", model: "gpt-9" },
        entries,
      ),
    ).toBeNull();
    expect(resolveRegistryModelForRun(null, entries)).toBeNull();
  });
});
