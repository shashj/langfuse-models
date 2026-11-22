import { useState } from "react";

import { type RegistryModelRow } from "@/src/features/model-registry/validation";
import { type ModelConfig } from "@langfuse/shared";

type PresetModel = {
  selectionKey: string;
  provider: string;
  model: string;
  params?: ModelConfig;
};

/** The model fields a registry entry fills: its connection, model and default parameters. */
function toPresetModel(entry: RegistryModelRow): PresetModel {
  return {
    selectionKey: `registry:${entry.id}`,
    provider: entry.provider,
    model: entry.modelId,
    ...(entry.defaultParams ? { params: entry.defaultParams } : {}),
  };
}

/**
 * State for a form that fills its model fields from a registry entry. Pass `presetModel` to
 * `useModelParams` as `promptConfigModel`, and `picked` and `pick` to the registry model field.
 */
export function useRegistryPresetModel() {
  const [picked, setPicked] = useState<RegistryModelRow | null>(null);

  return {
    presetModel: picked ? toPresetModel(picked) : null,
    picked,
    pick: setPicked,
  };
}
