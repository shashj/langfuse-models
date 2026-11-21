import { encodeFiltersGeneric } from "@langfuse/shared";

import { REGISTRY_USAGE_WINDOW_DAYS } from "@/src/features/model-registry/usage";

/**
 * Link to the generations of one registry model, opened on the table that
 * matches the user's read path. Generations are filtered by the pricing model
 * they matched (`internal_model_id`), so a registry model without a pricing
 * link has no such view. The date range matches the Models page usage window.
 */
export function getRegistryModelGenerationsHref(params: {
  projectId: string;
  pricingModelId: string;
  isV4: boolean;
}): string {
  const filter = encodeFiltersGeneric([
    {
      column: "modelId",
      type: "stringOptions",
      operator: "any of",
      value: [params.pricingModelId],
    },
  ]);
  const table = params.isV4 ? "traces" : "observations";
  return `/project/${encodeURIComponent(params.projectId)}/${table}?filter=${encodeURIComponent(filter)}&dateRange=${REGISTRY_USAGE_WINDOW_DAYS}d`;
}
