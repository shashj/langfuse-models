import { z } from "zod";

import { prisma } from "@langfuse/shared/src/db";
import {
  convertDateToClickhouseDateTime,
  queryClickhouse,
} from "@langfuse/shared/src/server";

import { resolveRegistryModelForRun } from "@/src/features/model-registry/resolveRunModel";
import {
  alignRangeToMinutes,
  readThroughUsageCache,
} from "@/src/features/model-registry/server/usageCache";
import { type RegistryExperimentUsage } from "@/src/features/model-registry/usage";

// One row per distinct model an experiment ran on, not per experiment. An empty string means
// the run did not record that key.
const ModelGroups = z.array(
  z.object({
    provider: z.string(),
    model: z.string(),
    registryModelId: z.string(),
    experiments: z.coerce.number(),
    datasetIds: z.array(z.string()),
    lastRun: z.coerce.date(),
  }),
);

const EXPERIMENT_GROUPS_QUERY = `
  SELECT
    metadata['provider'] AS provider,
    metadata['model'] AS model,
    metadata['registry_model_id'] AS registryModelId,
    count() AS experiments,
    groupUniqArray(datasetId) AS datasetIds,
    max(startedAt) AS lastRun
  FROM (
    SELECT
      experiment_id,
      any(experiment_dataset_id) AS datasetId,
      anyIf(
        mapFromArrays(experiment_metadata_names, experiment_metadata_values),
        notEmpty(experiment_metadata_names)
      ) AS metadata,
      min(start_time) AS startedAt
    FROM events_core
    WHERE project_id = {projectId: String}
      AND experiment_id != ''
      AND start_time >= {from: DateTime64(3)}
      AND start_time <= {to: DateTime64(3)}
    GROUP BY experiment_id
  )
  GROUP BY provider, model, registryModelId
`;

type Entry = { id: string; provider: string; modelId: string };

/** Matches each recorded model group to a registry entry and adds up the counts per entry. */
function attributeExperiments(
  entries: readonly Entry[],
  groups: z.infer<typeof ModelGroups>,
): Record<string, RegistryExperimentUsage> {
  const datasetsByEntry = new Map<string, Set<string>>();
  const usage: Record<string, RegistryExperimentUsage> = Object.fromEntries(
    entries.map(({ id }) => [
      id,
      { experiments: 0, datasets: 0, lastRun: null },
    ]),
  );

  for (const group of groups) {
    const entry = resolveRegistryModelForRun(
      {
        ...(group.registryModelId && {
          registry_model_id: group.registryModelId,
        }),
        ...(group.provider && { provider: group.provider }),
        ...(group.model && { model: group.model }),
      },
      entries,
    );
    if (!entry) continue;

    const entryUsage = usage[entry.id];
    entryUsage.experiments += group.experiments;
    if (!entryUsage.lastRun || group.lastRun > entryUsage.lastRun) {
      entryUsage.lastRun = group.lastRun;
    }
    const datasets = datasetsByEntry.get(entry.id) ?? new Set<string>();
    group.datasetIds.forEach((datasetId) => datasets.add(datasetId));
    datasetsByEntry.set(entry.id, datasets);
  }
  for (const [id, datasets] of datasetsByEntry) {
    usage[id].datasets = datasets.size;
  }

  return usage;
}

/**
 * Experiments per registry model of the project, keyed by registry id.
 *
 * An experiment records the provider and model it ran on, and runs started from the registry also
 * record the entry's id. ClickHouse counts the experiments in the time range per recorded
 * `(provider, model, registry id)`, which is a handful of rows however many experiments ran. Each
 * group is then matched to an entry by that id, falling back to `(provider, modelId)`, so
 * experiments from before the id existed are counted too. Every entry is in the result, with
 * zeros when nothing ran on it.
 *
 * The result covers every entry, whichever page of the Models table asked, so paging does not
 * read ClickHouse again, and is cached for a minute.
 */
export async function getRegistryExperimentUsage(params: {
  projectId: string;
  /** The time range of the experiments to count. */
  from: Date;
  to: Date;
}): Promise<Record<string, RegistryExperimentUsage>> {
  const { projectId } = params;
  const { from, to } = alignRangeToMinutes(params);

  // Ordered, because the entries are part of the cache key and a different order is a miss.
  const entries = await prisma.registryModel.findMany({
    where: { projectId },
    orderBy: { id: "asc" },
    select: { id: true, provider: true, modelId: true },
  });
  if (entries.length === 0) return {};

  return readThroughUsageCache({
    scope: "experiments",
    projectId,
    inputs: { from, to, entries },
    compute: async () => {
      const groups = ModelGroups.parse(
        await queryClickhouse({
          // Every event of an experiment carries its metadata, as the Experiments page reads it.
          query: EXPERIMENT_GROUPS_QUERY,
          params: {
            projectId,
            from: convertDateToClickhouseDateTime(from),
            to: convertDateToClickhouseDateTime(to),
          },
          tags: { route: "modelRegistry.experimentUsage", projectId },
        }),
      );
      return attributeExperiments(entries, groups);
    },
  });
}
