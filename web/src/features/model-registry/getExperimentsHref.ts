import { encodeFiltersGeneric } from "@langfuse/shared";

/**
 * Link to the experiments that ran on one model. An experiment records the provider and model it
 * ran on in its metadata, so the Experiments page is filtered on those two keys. Runs started
 * from the registry also store the entry's id, but the provider and model are on every run.
 */
export function getRegistryModelExperimentsHref(params: {
  projectId: string;
  provider: string;
  modelId: string;
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
  return `/project/${encodeURIComponent(params.projectId)}/experiments?filter=${encodeURIComponent(filter)}`;
}
