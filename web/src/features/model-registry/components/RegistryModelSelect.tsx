import { useMemo, useState } from "react";

import { AsyncSelectInput } from "@/src/components/design-system/AsyncSelectInput/AsyncSelectInput";
import { type RegistryModelRow } from "@/src/features/model-registry/validation";
import { useDebounce } from "@/src/hooks/useDebounce";
import { api } from "@/src/utils/api";

const OTHER_MODEL = "other";
const OTHER_MODEL_LABEL = "Other model (choose below)";

/**
 * Picks a model from the project's registry. The list is searched on the server, so a large
 * registry stays reachable. Choosing "Other model" returns null and leaves the caller to take
 * the model from somewhere else.
 */
export function RegistryModelSelect({
  projectId,
  value,
  onSelect,
  id,
}: {
  projectId: string;
  /** The selected entry, or null for "Other model". */
  value: { id: string; label: string } | null;
  onSelect: (entry: RegistryModelRow | null) => void;
  id?: string;
}) {
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const applyQuery = useDebounce(setQuery, 300);

  const models = api.modelRegistry.getAll.useQuery(
    { projectId, searchString: query, page: 0, limit: 100 },
    { refetchOnWindowFocus: false },
  );
  // Deprecated models stay in the registry but are not offered for new runs.
  const rows = useMemo(
    () =>
      (models.data?.models ?? []).filter((model) => model.status === "active"),
    [models.data],
  );
  const options = useMemo(
    () => [
      ...(query ? [] : [{ value: OTHER_MODEL, label: OTHER_MODEL_LABEL }]),
      ...rows.map((model) => ({
        value: model.id,
        label: model.connectionAvailable
          ? `${model.displayName} (${model.provider})`
          : `${model.displayName} (${model.provider}, no connection)`,
      })),
    ],
    [rows, query],
  );

  return (
    <AsyncSelectInput<string>
      id={id}
      value={
        value
          ? { value: value.id, label: value.label }
          : { value: OTHER_MODEL, label: OTHER_MODEL_LABEL }
      }
      onValueChange={(option) =>
        onSelect(
          option.value === OTHER_MODEL
            ? null
            : (rows.find((model) => model.id === option.value) ?? null),
        )
      }
      options={options}
      placeholder="Select a registry model"
      search={{
        placeholder: "Search registry models",
        value: search,
        onValueChange: (next) => {
          setSearch(next);
          applyQuery(next);
        },
      }}
      loading={
        models.isFetching ? { message: "Searching registry models" } : undefined
      }
    />
  );
}
