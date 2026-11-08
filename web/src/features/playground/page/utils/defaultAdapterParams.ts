import { LLMAdapter, type UIModelParams } from "@langfuse/shared";

/** The playground's initial parameter state for an adapter: what each parameter defaults to and which are enabled. */
export function getDefaultAdapterParams(
  adapter: LLMAdapter,
): Omit<UIModelParams, "provider" | "model"> {
  switch (adapter) {
    // Docs: https://platform.openai.com/docs/api-reference/chat/create
    case LLMAdapter.OpenAI:
      return {
        adapter: {
          value: adapter,
          enabled: true,
        },
        temperature: { value: 0, enabled: false },
        maxTemperature: { value: 2, enabled: false },
        max_tokens: { value: 4096, enabled: false },
        top_p: { value: 1, enabled: false },
        maxReasoningTokens: { value: 0, enabled: false },
        providerOptions: { value: {}, enabled: false },
      };

    case LLMAdapter.Azure:
      return {
        adapter: {
          value: adapter,
          enabled: true,
        },
        temperature: { value: 0, enabled: false },
        maxTemperature: { value: 2, enabled: false },
        max_tokens: { value: 4096, enabled: false },
        top_p: { value: 1, enabled: false },
        maxReasoningTokens: { value: 0, enabled: false },
        providerOptions: { value: {}, enabled: false },
      };

    // Docs: https://docs.anthropic.com/claude/reference/messages_post
    case LLMAdapter.Anthropic:
      return {
        adapter: {
          value: adapter,
          enabled: true,
        },
        temperature: { value: 0, enabled: false },
        maxTemperature: { value: 1, enabled: false },
        max_tokens: { value: 4096, enabled: false },
        top_p: { value: 1, enabled: false },
        maxReasoningTokens: { value: 0, enabled: false },
        providerOptions: { value: {}, enabled: false },
      };

    case LLMAdapter.Bedrock:
      return {
        adapter: {
          value: adapter,
          enabled: true,
        },
        temperature: { value: 0, enabled: false },
        maxTemperature: { value: 1, enabled: false },
        max_tokens: { value: 4096, enabled: false },
        top_p: { value: 1, enabled: false },
        maxReasoningTokens: { value: 0, enabled: false },
        providerOptions: { value: {}, enabled: false },
      };

    case LLMAdapter.VertexAI:
      return {
        adapter: {
          value: adapter,
          enabled: true,
        },
        temperature: { value: 1, enabled: false },
        maxTemperature: { value: 2, enabled: false },
        max_tokens: { value: 4096, enabled: false },
        top_p: { value: 1, enabled: false },
        maxReasoningTokens: { value: 0, enabled: false },
        providerOptions: { value: {}, enabled: false },
      };

    case LLMAdapter.GoogleAIStudio:
      return {
        adapter: {
          value: adapter,
          enabled: true,
        },
        temperature: { value: 1, enabled: false },
        maxTemperature: { value: 2, enabled: false },
        max_tokens: { value: 4096, enabled: false },
        top_p: { value: 1, enabled: false },
        maxReasoningTokens: { value: 0, enabled: false },
        providerOptions: { value: {}, enabled: false },
      };

    case LLMAdapter.TypeSafe:
      return {
        adapter: {
          value: adapter,
          enabled: true,
        },
        temperature: { value: 0, enabled: false },
        maxTemperature: { value: 0, enabled: false },
        max_tokens: { value: 0, enabled: false },
        top_p: { value: 1, enabled: false },
        maxReasoningTokens: { value: 0, enabled: false },
        providerOptions: { value: {}, enabled: false },
      };
  }
}
