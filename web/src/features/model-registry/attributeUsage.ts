import { type RegistryModelUsage } from "@/src/features/model-registry/usage";

/** A registry entry and the pricing definition it resolves to, if any. */
export type UsageEntry = {
  id: string;
  modelId: string;
  pricingModelId: string | null;
};

/** Generations that matched one pricing definition under one provided model name. */
export type UsageRow = {
  pricingModelId: string;
  providedModelName: string;
  lastUsed: Date;
  generations: number;
};

/**
 * Usage per requested registry entry, from generations counted per pricing definition and
 * provided model name.
 *
 * A generation is joined to an entry through its pricing definition. Several entries can share
 * one definition, for example `gpt-4o` and a dated `gpt-4o-2024-08-06`, and a generation must not
 * count for all of them. So when one of the entries sharing the definition has the generation's
 * model name as its model id, only that entry gets it. Otherwise the generation counts for every
 * entry that shares the definition.
 *
 * Requested entries without a pricing definition are left out of the result, so callers can tell
 * "no pricing" from "no usage".
 */
export function attributeUsage(params: {
  /** Every entry of the project, so entries on other pages still take their share. */
  entries: readonly UsageEntry[];
  requestedIds: readonly string[];
  rows: readonly UsageRow[];
}): Record<string, RegistryModelUsage> {
  const requested = new Set(params.requestedIds);
  const usage: Record<string, RegistryModelUsage> = {};
  for (const entry of params.entries) {
    if (requested.has(entry.id) && entry.pricingModelId) {
      usage[entry.id] = { lastUsed: null, generationsInWindow: 0 };
    }
  }

  for (const row of params.rows) {
    const sharing = params.entries.filter(
      (entry) => entry.pricingModelId === row.pricingModelId,
    );
    const exact = sharing.filter(
      (entry) => entry.modelId === row.providedModelName,
    );
    for (const owner of exact.length > 0 ? exact : sharing) {
      const entryUsage = usage[owner.id];
      if (!entryUsage) continue;
      entryUsage.generationsInWindow += row.generations;
      if (!entryUsage.lastUsed || row.lastUsed > entryUsage.lastUsed) {
        entryUsage.lastUsed = row.lastUsed;
      }
    }
  }

  return usage;
}
