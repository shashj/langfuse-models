/**
 * The registry entry to show for a generation. Several entries can share the pricing definition a
 * generation matched, such as `gpt-4o` and a dated `gpt-4o-2024-08-06`, so prefer the one whose
 * model id is the generation's model name, and otherwise take the first.
 */
export function pickRegistryModelForGeneration<T extends { modelId: string }>(
  entries: readonly T[] | undefined,
  modelName: string | null | undefined,
): T | undefined {
  return entries?.find((entry) => entry.modelId === modelName) ?? entries?.[0];
}
