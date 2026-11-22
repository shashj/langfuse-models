import { z } from "zod";

import { prisma } from "@langfuse/shared/src/db";
import {
  convertDateToClickhouseDateTime,
  queryClickhouse,
} from "@langfuse/shared/src/server";

import {
  REGISTRY_LAST_USED_LOOKBACK_DAYS,
  REGISTRY_USAGE_WINDOW_DAYS,
  type RegistryModelUsage,
} from "@/src/features/model-registry/usage";

const UsageQueryResult = z.array(
  z.object({
    modelId: z.string(),
    lastUsed: z.coerce.date(),
    generationsInWindow: z.coerce.number(),
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
        internal_model_id AS modelId,
        MAX(start_time) AS lastUsed,
        uniqExactIf(id, start_time >= {since: DateTime64(3)}) AS generationsInWindow
      FROM observations
      WHERE project_id = {projectId: String}
        AND type = 'GENERATION'
        AND start_time >= {lookback: DateTime64(3)}
        AND internal_model_id IN ({modelIds: Array(String)})
      GROUP BY internal_model_id
    `,
  events: `
      SELECT
        model_id AS modelId,
        MAX(start_time) AS lastUsed,
        uniqExactIf(span_id, start_time >= {since: DateTime64(3)}) AS generationsInWindow
      FROM events_core
      WHERE project_id = {projectId: String}
        AND type = 'GENERATION'
        AND start_time >= {lookback: DateTime64(3)}
        AND model_id IN ({modelIds: Array(String)})
      GROUP BY model_id
    `,
};

/**
 * Generation usage per registry model, keyed by registry id.
 *
 * A registry entry is joined to observations through its pricing link: the
 * worker stores the matched pricing model on each observation as
 * `internal_model_id`. Entries without a pricing link cannot be joined and are
 * left out of the result, so callers can tell "not linked" from "no usage". Only the last
 * `REGISTRY_LAST_USED_LOOKBACK_DAYS` days are read, so `lastUsed` is null for a model with no
 * generation in that time.
 */
export async function getRegistryModelUsage(params: {
  projectId: string;
  registryModelIds: string[];
  source: RegistryUsageSource;
}): Promise<Record<string, RegistryModelUsage>> {
  const { projectId, registryModelIds, source } = params;
  if (registryModelIds.length === 0) return {};

  const entries = await prisma.registryModel.findMany({
    where: { projectId, id: { in: registryModelIds } },
    select: { id: true, pricingModelId: true },
  });
  const linked = entries.flatMap((entry) =>
    entry.pricingModelId
      ? [{ id: entry.id, pricingModelId: entry.pricingModelId }]
      : [],
  );
  if (linked.length === 0) return {};

  const day = 24 * 60 * 60 * 1000;
  const since = new Date(Date.now() - REGISTRY_USAGE_WINDOW_DAYS * day);
  const lookback = new Date(
    Date.now() - REGISTRY_LAST_USED_LOOKBACK_DAYS * day,
  );
  const rows = await queryClickhouse({
    query: USAGE_QUERY[source],
    params: {
      projectId,
      modelIds: linked.map((entry) => entry.pricingModelId),
      since: convertDateToClickhouseDateTime(since),
      lookback: convertDateToClickhouseDateTime(lookback),
    },
    tags: { route: "modelRegistry.usage", projectId },
  });

  const byPricingModelId = new Map(
    UsageQueryResult.parse(rows).map((row) => [row.modelId, row]),
  );

  return Object.fromEntries(
    linked.map(({ id, pricingModelId }) => {
      const row = byPricingModelId.get(pricingModelId);
      return [
        id,
        {
          lastUsed: row?.lastUsed ?? null,
          generationsInWindow: row?.generationsInWindow ?? 0,
        } satisfies RegistryModelUsage,
      ];
    }),
  );
}
