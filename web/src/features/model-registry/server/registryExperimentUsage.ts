import { z } from "zod";

import { prisma } from "@langfuse/shared/src/db";
import {
  convertDateToClickhouseDateTime,
  queryClickhouse,
} from "@langfuse/shared/src/server";

import { resolveRegistryModelForRun } from "@/src/features/model-registry/resolveRunModel";
import {
  REGISTRY_USAGE_WINDOW_DAYS,
  type RegistryExperimentUsage,
} from "@/src/features/model-registry/usage";

// More experiments than this in the window are not counted. The Models page shows a count, not a
// complete list, and a project this busy is better served by the Experiments page.
const MAX_EXPERIMENTS = 20_000;

const ExperimentRows = z.array(
  z.object({
    experimentId: z.string(),
    datasetId: z.string(),
    metadata: z.record(z.string(), z.string()).default({}),
    startedAt: z.coerce.date(),
  }),
);

/**
 * Experiments per registry model, keyed by registry id.
 *
 * An experiment records the provider and model it ran on, and runs started from the registry also
 * record the entry's id. Each experiment is matched to an entry by that id, falling back to
 * `(provider, modelId)`, so experiments from before the id existed are counted too. Every
 * requested entry is in the result, with zeros when nothing ran on it.
 */
export async function getRegistryExperimentUsage(params: {
  projectId: string;
  registryModelIds: string[];
}): Promise<Record<string, RegistryExperimentUsage>> {
  const { projectId, registryModelIds } = params;
  if (registryModelIds.length === 0) return {};

  // Resolve against the whole registry, not only the requested entries, so an experiment that
  // belongs to another entry is not counted for a requested one by a looser match.
  const entries = await prisma.registryModel.findMany({
    where: { projectId },
    select: { id: true, provider: true, modelId: true },
  });

  const since = new Date(
    Date.now() - REGISTRY_USAGE_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  );
  const rows = ExperimentRows.parse(
    await queryClickhouse({
      // Every event of an experiment carries its metadata, as the Experiments page reads it.
      query: `
        SELECT
          experiment_id AS experimentId,
          any(experiment_dataset_id) AS datasetId,
          anyIf(
            mapFromArrays(experiment_metadata_names, experiment_metadata_values),
            notEmpty(experiment_metadata_names)
          ) AS metadata,
          min(start_time) AS startedAt
        FROM events_core
        WHERE project_id = {projectId: String}
          AND experiment_id != ''
          AND start_time >= {since: DateTime64(3)}
        GROUP BY experiment_id
        LIMIT {limit: UInt32}
      `,
      params: {
        projectId,
        since: convertDateToClickhouseDateTime(since),
        limit: MAX_EXPERIMENTS,
      },
      tags: { route: "modelRegistry.experimentUsage", projectId },
    }),
  );

  const datasetsByEntry = new Map<string, Set<string>>();
  const usage: Record<string, RegistryExperimentUsage> = Object.fromEntries(
    registryModelIds.map((id) => [
      id,
      { experiments: 0, datasets: 0, lastRun: null },
    ]),
  );

  for (const row of rows) {
    const entry = resolveRegistryModelForRun(row.metadata, entries);
    if (!entry || !usage[entry.id]) continue;

    const entryUsage = usage[entry.id];
    entryUsage.experiments += 1;
    if (!entryUsage.lastRun || row.startedAt > entryUsage.lastRun) {
      entryUsage.lastRun = row.startedAt;
    }
    const datasets = datasetsByEntry.get(entry.id) ?? new Set<string>();
    datasets.add(row.datasetId);
    datasetsByEntry.set(entry.id, datasets);
  }
  for (const [id, datasets] of datasetsByEntry) {
    usage[id].datasets = datasets.size;
  }

  return usage;
}
