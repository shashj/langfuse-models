// @vitest-environment node

import { LLMAdapter } from "@langfuse/shared";
import { buildPlaygroundModelParams } from "./promptModelParams";

describe("buildPlaygroundModelParams", () => {
  it("enables only the params the prompt sets and keeps the adapter consistent", () => {
    const params = buildPlaygroundModelParams(
      {
        provider: "my-anthropic",
        model: "claude-sonnet",
        params: { temperature: 0.3, max_tokens: 512 },
      },
      LLMAdapter.Anthropic,
    );

    expect(params).toMatchObject({
      adapter: { value: LLMAdapter.Anthropic, enabled: true },
      provider: { value: "my-anthropic", enabled: true },
      model: { value: "claude-sonnet", enabled: true },
      temperature: { value: 0.3, enabled: true },
      max_tokens: { value: 512, enabled: true },
      top_p: { enabled: false },
    });
  });
});
