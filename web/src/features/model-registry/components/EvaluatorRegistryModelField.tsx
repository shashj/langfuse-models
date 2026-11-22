import { RegistryModelSelect } from "@/src/features/model-registry/components/RegistryModelSelect";
import { type RegistryModelRow } from "@/src/features/model-registry/validation";
import { api } from "@/src/utils/api";

/**
 * "Registry model" field above an evaluator's model fields. Picking an entry fills the model
 * fields, which stay editable. The field shows the entry whose provider and model the fields
 * hold, whether it was just picked or already stored on the evaluator, and "Other model" once
 * they match none. Evaluators read structured output from the judge, so entries not marked for
 * JSON mode carry a note.
 */
export function EvaluatorRegistryModelField({
  projectId,
  provider,
  model,
  picked,
  onPick,
  disabled,
}: {
  projectId: string;
  /** The provider and model the form holds now. */
  provider: string;
  model: string;
  /** The entry the user picked in this form, if any. */
  picked: RegistryModelRow | null;
  onPick: (entry: RegistryModelRow | null) => void;
  disabled?: boolean;
}) {
  const pickedMatches =
    picked !== null && picked.provider === provider && picked.modelId === model;
  const stored = api.modelRegistry.lookup.useQuery(
    { projectId, pairs: [{ provider, modelId: model }] },
    { enabled: !pickedMatches && Boolean(provider && model) },
  );
  const storedEntry = stored.data?.[0];
  const matchingEntry = pickedMatches ? picked : storedEntry;
  const matching = matchingEntry
    ? { id: matchingEntry.id, label: matchingEntry.displayName }
    : null;

  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm leading-none font-bold">Registry model</label>
      <RegistryModelSelect
        projectId={projectId}
        value={matching}
        onSelect={onPick}
        requiredCapability="jsonMode"
        disabled={disabled}
      />
      <p className="text-muted-foreground text-xs">
        Start from a model in your registry. Its connection and defaults fill
        the fields below, which you can still change.
      </p>
    </div>
  );
}
