import { ExpandToggle } from "@/src/components/design-system/ExpandToggle/ExpandToggle";
import { buildLocalIsoDatePresentation } from "@/src/utils/dates";
import { useState } from "react";
import Link from "next/link";
import { resolveRegistryModelForRun } from "@/src/features/model-registry/resolveRunModel";
import { api } from "@/src/utils/api";
import { ExperimentMetadataSection } from "./ExperimentMetadataSection";
import { ExperimentOverviewField } from "./ExperimentOverviewField";
import { ExperimentOverviewSectionHeading } from "./ExperimentOverviewSectionHeading";

const isSafeHttpUrl = (value: string | undefined) => {
  if (!value) return false;

  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
};

type ExperimentOverviewPanelProps = {
  projectId: string;
  experiment?: {
    id: string;
    name: string;
    description: string | null;
    datasetId: string;
    datasetName?: string;
    prompts: Array<[string, number | null]>; // [prompt_name, prompt_version]
    metadata: Record<string, string>;
    startTime: Date;
  };
};

export function ExperimentOverviewPanel({
  projectId,
  experiment,
}: ExperimentOverviewPanelProps) {
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);

  const metadata = experiment?.metadata ?? {};
  const preparedStartTime = buildLocalIsoDatePresentation({
    date: experiment?.startTime,
  });
  const provider = metadata.provider;
  const model = metadata.model;
  const registryModelId = metadata.registry_model_id;
  // The registry entry the run used, if any: by the id it stored, or by its provider and model.
  const registryEntries = api.modelRegistry.lookup.useQuery(
    {
      projectId,
      ids: registryModelId ? [registryModelId] : [],
      pairs: provider && model ? [{ provider, modelId: model }] : [],
    },
    { enabled: Boolean(registryModelId || (provider && model)) },
  );
  const registryModel = resolveRegistryModelForRun(
    metadata,
    registryEntries.data ?? [],
  );
  const pullRequestUrl = metadata["langfuse.pr_url"];
  const githubJobUrl = metadata["langfuse.github_job_url"];
  const safePullRequestUrl = isSafeHttpUrl(pullRequestUrl)
    ? pullRequestUrl
    : undefined;
  const safeGithubJobUrl = isSafeHttpUrl(githubJobUrl)
    ? githubJobUrl
    : undefined;
  const additionalMetadata = { ...metadata };
  if (provider || model) {
    delete additionalMetadata.provider;
    delete additionalMetadata.model;
  }
  delete additionalMetadata.registry_model_id;
  if (safePullRequestUrl) delete additionalMetadata["langfuse.pr_url"];
  if (safeGithubJobUrl) delete additionalMetadata["langfuse.github_job_url"];
  const hasAdditionalMetadata = Object.keys(additionalMetadata).length > 0;

  // Get the first prompt name and version from the prompts array
  const [promptName, promptVersion] =
    experiment && experiment.prompts.length > 0
      ? experiment.prompts[0]
      : [null, null];

  // Check if description is long (more than 150 chars)
  const isLongDescription =
    experiment?.description && experiment.description.length > 150;
  const shouldTruncate = isLongDescription && !isDescriptionExpanded;
  const displayDescription = shouldTruncate
    ? experiment?.description?.slice(0, 150) + "..."
    : experiment?.description;

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-bold">Baseline details</h3>

      {experiment ? (
        <>
          <div>
            <ExperimentOverviewSectionHeading>
              Overview
            </ExperimentOverviewSectionHeading>
            <div className="space-y-3 text-sm">
              <ExperimentOverviewField label="Name">
                <div className="font-bold">{experiment.name}</div>
              </ExperimentOverviewField>

              {experiment.description && (
                <ExperimentOverviewField label="Description">
                  <div className="break-words">{displayDescription}</div>
                  {isLongDescription && (
                    <div>
                      <ExpandToggle
                        variant="underline"
                        expanded={isDescriptionExpanded}
                        onExpandedChange={setIsDescriptionExpanded}
                      />
                    </div>
                  )}
                </ExperimentOverviewField>
              )}

              <ExperimentOverviewField label="Dataset">
                <Link
                  href={`/project/${projectId}/datasets/${encodeURIComponent(experiment.datasetId)}`}
                  className="text-primary hover:underline"
                >
                  {experiment.datasetName || experiment.datasetId}
                </Link>
              </ExperimentOverviewField>

              {promptName && (
                <ExperimentOverviewField label="Prompt">
                  <Link
                    href={`/project/${projectId}/prompts/${encodeURIComponent(promptName)}${promptVersion !== null ? `?version=${promptVersion}` : ""}`}
                    className="text-primary hover:underline"
                  >
                    {promptName}
                    {promptVersion !== null && (
                      <span className="text-muted-foreground ml-1">
                        (v{promptVersion})
                      </span>
                    )}
                  </Link>
                </ExperimentOverviewField>
              )}

              {(provider || model) && (
                <ExperimentOverviewField label="Model">
                  <div>
                    {registryModel ? (
                      <Link
                        href={`/project/${projectId}/models?search=${encodeURIComponent(registryModel.modelId)}`}
                        className="text-primary hover:underline"
                        title="View in the model registry"
                      >
                        {registryModel.displayName}
                      </Link>
                    ) : null}
                    <span
                      className={
                        registryModel ? "text-muted-foreground ml-1" : undefined
                      }
                    >
                      {registryModel ? "(" : ""}
                      {provider && model
                        ? `${provider}/${model}`
                        : provider || model}
                      {registryModel ? ")" : ""}
                    </span>
                  </div>
                </ExperimentOverviewField>
              )}

              <ExperimentOverviewField label="Start Time">
                {preparedStartTime ? (
                  <span title={preparedStartTime.title}>
                    {preparedStartTime.display}
                  </span>
                ) : null}
              </ExperimentOverviewField>

              {safePullRequestUrl && (
                <ExperimentOverviewField label="Pull Request URL">
                  <a
                    href={safePullRequestUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary break-all hover:underline"
                  >
                    {safePullRequestUrl}
                  </a>
                </ExperimentOverviewField>
              )}

              {safeGithubJobUrl && (
                <ExperimentOverviewField label="GitHub Job URL">
                  <a
                    href={safeGithubJobUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary break-all hover:underline"
                  >
                    {safeGithubJobUrl}
                  </a>
                </ExperimentOverviewField>
              )}
            </div>
          </div>

          {hasAdditionalMetadata && (
            <ExperimentMetadataSection metadata={additionalMetadata} />
          )}
        </>
      ) : (
        <p className="text-muted-foreground text-sm">
          Select a baseline to view its details.
        </p>
      )}
    </div>
  );
}
