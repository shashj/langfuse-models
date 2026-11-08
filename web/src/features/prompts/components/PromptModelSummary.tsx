import { ZodModelConfig } from "@langfuse/shared";
import { api } from "@/src/utils/api";

/** PromptModelSummary shows the registry model a prompt version runs on and its parameter overrides. */
export function PromptModelSummary({
  projectId,
  registryModelId,
  modelParams,
}: {
  projectId: string;
  registryModelId: string | null;
  modelParams: unknown;
}) {
  const model = api.modelRegistry.getById.useQuery(
    { projectId, id: registryModelId ?? "" },
    { enabled: Boolean(registryModelId), refetchOnWindowFocus: false },
  );

  if (!registryModelId) {
    return <SummaryRow label="Model" value="No model set" muted />;
  }
  if (model.isPending) {
    return <SummaryRow label="Model" value="Loading…" muted />;
  }
  if (model.isError) {
    return <SummaryRow label="Model" value="Model unavailable" muted />;
  }

  const params = ZodModelConfig.safeParse(modelParams ?? {});
  const overrides = params.success
    ? [
        ["Temperature", params.data.temperature],
        ["Top P", params.data.top_p],
        ["Max tokens", params.data.max_tokens],
      ].filter(([, value]) => value !== undefined)
    : [];

  return (
    <div className="flex flex-col gap-1">
      <SummaryRow
        label="Model"
        value={`${model.data.displayName} (${model.data.provider} · ${model.data.modelId})`}
      />
      {overrides.map(([label, value]) => (
        <SummaryRow
          key={label as string}
          label={label as string}
          value={String(value)}
        />
      ))}
    </div>
  );
}

function SummaryRow({
  label,
  value,
  muted = false,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div className="flex gap-2 text-sm">
      <span className="text-muted-foreground w-24 shrink-0">{label}</span>
      <span className={muted ? "text-muted-foreground" : undefined}>
        {value}
      </span>
    </div>
  );
}
