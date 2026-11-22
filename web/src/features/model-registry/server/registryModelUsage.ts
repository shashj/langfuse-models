import { z } from "zod";

import { prisma } from "@langfuse/shared/src/db";
import {
  convertDateToClickhouseDateTime,
  queryClickhouse,
} from "@langfuse/shared/src/server";

import {
  attributeUsage,
  type UsageRow,
} from "@/src/features/model-registry/attributeUsage";
import { resolveRegistryPricing } from "@/src/features/model-registry/server/registryPricing";
import {
  alignRangeToMinutes,
  readThroughUsageCache,
} from "@/src/features/model-registry/server/usageCache";
import { type RegistryModelUsage } from "@/src/features/model-registry/usage";

const UsageQueryResult = z.array(
  z.object({
    pricingModelId: z.string(),
    providedModelName: z.string(),
    lastUsed: z.coerce.date(),
    generations: z.coerce.number(),
  }),
);

/**
 * Where generations are read from. Langfuse v4 writes them only to the events tables, so a v4
 * user must read `events_core`. The legacy `observations` table stays empty for that data.
 */
export type RegistryUsageSource = "events" | "observations";

const USAGE_QUERY: Record<RegistryUsageSource, string> = {
  observations: `
      SELECT
        internal_model_id AS pricingModelId,
        ifNull(provided_model_name, '') AS providedModelName,
        MAX(start_time) AS lastUsed,
        uniqExact(id) AS generations
      FROM observations
      WHERE project_id = {projectId: String}
        AND type = 'GENERATION'
        AND start_time >= {from: DateTime64(3)}
        AND start_time <= {to: DateTime64(3)}
        AND internal_model_id IN ({pricingModelIds: Array(String)})
      GROUP BY pricingModelId, providedModelName
    `,
  events: `
      SELECT
        model_id AS pricingModelId,
        provided_model_name AS providedModelName,
        MAX(start_time) AS lastUsed,
        uniqExact(span_id) AS generations
      FROM events_core
      WHERE project_id = {projectId: String}
        AND type = 'GENERATION'
        AND start_time >= {from: DateTime64(3)}
        AND start_time <= {to: DateTime64(3)}
        AND model_id IN ({pricingModelIds: Array(String)})
      GROUP BY pricingModelId, providedModelName
    `,
};

/**
 * Generation usage per registry model of the project, keyed by registry id.
 *
 * A registry entry is joined to generations through its pricing definition: the worker stores
 * the matched definition on each generation as `internal_model_id`. The definition is the one
 * the user picked for the entry, or else the one that matches its model id. When several entries
 * share a definition, a generation counts for the entry whose model id is its model name (see
 * `attributeUsage`). Entries without a definition are left out of the result, so callers can
 * tell "no pricing" from "no usage".
 *
 * The result covers every entry, whichever page of the Models table asked, so paging does not
 * read ClickHouse again, and is cached for a minute. Only the given time range is read, so the
 * cost follows the range, not the age of the project, and `lastUsed` is the latest generation in
 * the range, or null when there is none.
 */
export async function getRegistryModelUsage(params: {
  projectId: string;
  /** The time range the counts and the last use are read from. */
  from: Date;
  to: Date;
  source: RegistryUsageSource;
}): Promise<Record<string, RegistryModelUsage>> {
  const { projectId, source } = params;
  const { from, to } = alignRangeToMinutes(params);

  // Ordered, because the entries are part of the cache key and a different order is a miss.
  const rows = await prisma.registryModel.findMany({
    where: { projectId },
    orderBy: { id: "asc" },
    select: {
      id: true,
      modelId: true,
      pricingModel: { select: { id: true, modelName: true } },
    },
  });
  const pricing = await resolveRegistryPricing({ projectId, entries: rows });
  const entries = rows.map((row) => ({
    id: row.id,
    modelId: row.modelId,
    pricingModelId: pricing.get(row.id)?.id ?? null,
  }));

  const pricingModelIds = [
    ...new Set(entries.flatMap((entry) => entry.pricingModelId ?? [])),
  ];
  if (pricingModelIds.length === 0) return {};

  return readThroughUsageCache({
    scope: "generations",
    projectId,
    inputs: { source, from, to, entries },
    compute: async () => {
      const generations = await queryClickhouse({
        query: USAGE_QUERY[source],
        params: {
          projectId,
          pricingModelIds,
          from: convertDateToClickhouseDateTime(from),
          to: convertDateToClickhouseDateTime(to),
        },
        tags: { route: "modelRegistry.usage", projectId },
      });

      return attributeUsage({
        entries,
        rows: UsageQueryResult.parse(generations) satisfies UsageRow[],
      });
    },
  });
}
