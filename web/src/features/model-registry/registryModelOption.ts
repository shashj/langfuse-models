import {
  CAPABILITY_LABELS,
  type CapabilityKey,
  type RegistryModelRow,
} from "@/src/features/model-registry/validation";

/**
 * The text of one entry in a registry model picker. A note says when the entry cannot run
 * (no connection) or is not marked for a capability the caller needs. Entries are never hidden
 * for a missing capability: capabilities default to off, so "not marked" can also mean "never
 * filled in".
 */
export function getRegistryModelOptionLabel(
  model: Pick<
    RegistryModelRow,
    "displayName" | "provider" | "connectionAvailable" | "capabilities"
  >,
  requiredCapability?: CapabilityKey,
): string {
  const notes = [
    model.provider,
    ...(model.connectionAvailable ? [] : ["no connection"]),
    ...(requiredCapability && !model.capabilities[requiredCapability]
      ? [`not marked for ${CAPABILITY_LABELS[requiredCapability]}`]
      : []),
  ];
  return `${model.displayName} (${notes.join(", ")})`;
}
