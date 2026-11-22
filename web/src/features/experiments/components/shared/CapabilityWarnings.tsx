import { type CapabilityWarning } from "@/src/features/experiments/fns/experimentCapabilityWarnings";
import { StatusMessage } from "@/src/components/design-system/StatusMessage/StatusMessage";

/**
 * Non-blocking warnings about the chosen registry model. They never stop a run. The caller
 * renders it only when there are warnings.
 */
export function CapabilityWarnings({
  warnings,
}: {
  warnings: CapabilityWarning[];
}) {
  return (
    <div className="flex flex-col gap-2">
      {warnings.map((warning) => (
        <StatusMessage
          key={warning.code}
          level="WARNING"
          message={warning.message}
          size="compact"
        />
      ))}
    </div>
  );
}
