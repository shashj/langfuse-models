import { encodeFiltersGeneric } from "@langfuse/shared";

/**
 * Link to the generations of one registry model, opened on the table that
 * matches the user's read path. Generations are filtered by the pricing model
 * they matched (`internal_model_id`), so a registry model without a pricing
 * link has no such view. `dateRange` is the Models page time range in its URL form, so the table
 * opens on the range the counts were read from.
 */
export function getRegistryModelGenerationsHref(params: {
  projectId: string;
  pricingModelId: string;
  isV4: boolean;
  dateRange: string;
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
  return `/project/${encodeURIComponent(params.projectId)}/${table}?filter=${encodeURIComponent(filter)}&dateRange=${encodeURIComponent(params.dateRange)}`;
}
