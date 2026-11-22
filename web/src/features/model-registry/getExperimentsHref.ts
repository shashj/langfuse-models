import { encodeFiltersGeneric } from "@langfuse/shared";

/**
 * Link to the experiments that ran on one model. An experiment records the provider and model it
 * ran on in its metadata, so the Experiments page is filtered on those two keys. Runs started
 * from the registry also store the entry's id, but the provider and model are on every run.
 * `dateRange` is the Models page time range in its URL form, so the page opens on the range the
 * counts were read from.
 */
export function getRegistryModelExperimentsHref(params: {
  projectId: string;
  provider: string;
  modelId: string;
  dateRange: string;
}): string {
  const filter = encodeFiltersGeneric([
    {
      column: "metadata",
      type: "stringObject",
      key: "provider",
      operator: "=",
      value: params.provider,
    },
    {
      column: "metadata",
      type: "stringObject",
      key: "model",
      operator: "=",
      value: params.modelId,
    },
  ]);
  return `/project/${encodeURIComponent(params.projectId)}/experiments?filter=${encodeURIComponent(filter)}&dateRange=${encodeURIComponent(params.dateRange)}`;
}
