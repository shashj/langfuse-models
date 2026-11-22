import { findModelsInPostgres } from "@langfuse/shared/src/server";

import { type RegistryPricing } from "@/src/features/model-registry/validation";

type PricedEntry = {
  id: string;
  modelId: string;
  /** The definition the user picked for this entry, if any. */
  pricingModel: { id: string; modelName: string } | null;
};

/**
 * The pricing definition of each registry entry, keyed by entry id. Entries without a result have
 * no definition.
 *
 * A definition the user picked wins. Otherwise the entry gets the definition that matches its
 * model id, resolved exactly as ingestion resolves one for a generation, so the registry and the
 * generations always agree on which definition prices a model. Nothing is stored for the
 * automatic match: it follows the definitions as they change.
 */
export async function resolveRegistryPricing(params: {
  projectId: string;
  entries: readonly PricedEntry[];
}): Promise<Map<string, RegistryPricing>> {
  const result = new Map<string, RegistryPricing>();
  const unlinked: PricedEntry[] = [];

  for (const entry of params.entries) {
    if (entry.pricingModel) {
      result.set(entry.id, { ...entry.pricingModel, source: "linked" });
    } else {
      unlinked.push(entry);
    }
  }

  const matches = await findModelsInPostgres({
    projectId: params.projectId,
    models: unlinked.map((entry) => entry.modelId),
  });
  for (const entry of unlinked) {
    const match = matches.get(entry.modelId);
    if (match) result.set(entry.id, { ...match, source: "matched" });
  }

  return result;
}
