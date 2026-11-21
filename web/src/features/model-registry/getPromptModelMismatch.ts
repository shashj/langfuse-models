export type PromptRegistryModel = {
  displayName: string;
  modelId: string;
  pricingModelId: string | null;
};

/**
 * Whether a generation ran on a different model than its prompt version names.
 *
 * Observations store a model name and the pricing model it matched
 * (`internalModelId`), so the comparison goes through the registry entry's
 * pricing link. A name that merely differs from the entry's model id proves
 * nothing, since providers return dated snapshot names. When either side lacks
 * a pricing id the models cannot be told apart and nothing is flagged.
 */
export function getPromptModelMismatch(params: {
  promptModel: PromptRegistryModel | null | undefined;
  observation: { model: string | null; internalModelId: string | null };
}): { expectedModel: string } | null {
  const { promptModel, observation } = params;
  if (!promptModel) return null;
  if (observation.model === promptModel.modelId) return null;
  if (!promptModel.pricingModelId || !observation.internalModelId) return null;
  if (promptModel.pricingModelId === observation.internalModelId) return null;
  return { expectedModel: promptModel.displayName };
}
