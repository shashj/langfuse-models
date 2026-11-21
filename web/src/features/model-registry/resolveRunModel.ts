/** The part of a registry entry needed to recognise it from a run's metadata. */
export type RegistryModelRef = {
  id: string;
  provider: string;
  modelId: string;
};

/**
 * The registry entry an experiment run used, or null when none matches.
 *
 * A run started from the registry stores the entry's id, which keeps pointing at the entry if the
 * entry is edited later. Runs that were started before that, or with a model picked from a
 * connection, only store `provider` and `model`, so they are matched on the entry's
 * `(provider, modelId)`. The id wins when it names an entry.
 */
export function resolveRegistryModelForRun<T extends RegistryModelRef>(
  metadata: Record<string, unknown> | null | undefined,
  entries: readonly T[],
): T | null {
  if (!metadata) return null;

  const { registry_model_id: id, provider, model } = metadata;
  if (typeof id === "string") {
    const byId = entries.find((entry) => entry.id === id);
    if (byId) return byId;
  }
  if (typeof provider === "string" && typeof model === "string") {
    return (
      entries.find(
        (entry) => entry.provider === provider && entry.modelId === model,
      ) ?? null
    );
  }
  return null;
}
