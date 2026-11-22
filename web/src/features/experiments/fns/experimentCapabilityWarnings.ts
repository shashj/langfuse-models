import {
  CAPABILITY_LABELS,
  type RegistryModelRow,
} from "@/src/features/model-registry/validation";

export type CapabilityWarning = {
  code: "vision" | "tools" | "jsonMode" | "contextWindow";
  message: string;
};

// A common rule of thumb for English text. The warning says "about", because the real count
// depends on the model's tokenizer.
const CHARS_PER_TOKEN = 4;

/**
 * Non-blocking warnings for running an experiment on a registry model. Capabilities default to
 * off in the registry, so a warning means "not marked as supporting it", which can also mean
 * nobody filled it in. A model with no declared context window gets no length warning.
 */
export function experimentCapabilityWarnings(params: {
  model: Pick<
    RegistryModelRow,
    "displayName" | "capabilities" | "contextWindow"
  >;
  /**
   * Facts about the dataset's inputs; undefined while they load or when they could not be read.
   * For a dataset larger than the sample they describe its first `scannedItems` items only.
   */
  datasetStats?: {
    maxInputChars: number;
    itemsWithMedia: number;
    scannedItems: number;
    sampled: boolean;
  };
  promptHasTools: boolean;
  structuredOutputEnabled: boolean;
}): CapabilityWarning[] {
  const { model, datasetStats, promptHasTools, structuredOutputEnabled } =
    params;
  const warnings: CapabilityWarning[] = [];
  // A sampled dataset is described by its first items, so the wording says so instead of
  // implying the whole dataset was read.
  const scope = datasetStats?.sampled
    ? `the first ${datasetStats.scannedItems.toLocaleString("en-US")} dataset items`
    : "the dataset";
  const notMarked = (key: keyof typeof CAPABILITY_LABELS) =>
    `${model.displayName} is not marked as supporting ${CAPABILITY_LABELS[key].toLowerCase()} in the registry`;

  if (
    datasetStats &&
    datasetStats.itemsWithMedia > 0 &&
    !model.capabilities.vision
  ) {
    warnings.push({
      code: "vision",
      message: `${datasetStats.itemsWithMedia} ${datasetStats.itemsWithMedia === 1 ? "item" : "items"} in ${scope} ${datasetStats.itemsWithMedia === 1 ? "contains" : "contain"} images or media, but ${notMarked("vision")}.`,
    });
  }
  if (promptHasTools && !model.capabilities.tools) {
    warnings.push({
      code: "tools",
      message: `The prompt defines tools, but ${notMarked("tools")}.`,
    });
  }
  if (structuredOutputEnabled && !model.capabilities.jsonMode) {
    warnings.push({
      code: "jsonMode",
      message: `Structured output is on, but ${notMarked("jsonMode")}.`,
    });
  }
  if (datasetStats && model.contextWindow) {
    const estimatedTokens = Math.ceil(
      datasetStats.maxInputChars / CHARS_PER_TOKEN,
    );
    if (estimatedTokens > model.contextWindow) {
      warnings.push({
        code: "contextWindow",
        message: `The longest item in ${scope} is about ${estimatedTokens.toLocaleString("en-US")} tokens, more than the ${model.contextWindow.toLocaleString("en-US")}-token context window of ${model.displayName}.`,
      });
    }
  }
  return warnings;
}
