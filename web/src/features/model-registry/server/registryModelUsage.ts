import { z } from "zod";

import { prisma } from "@langfuse/shared/src/db";
import {
  convertDateToClickhouseDateTime,
  queryClickhouse,
} from "@langfuse/shared/src/server";

import {
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
 * Generation usage per registry model, keyed by registry id.
 *
 * A registry entry is joined to observations through its pricing link: the
 * worker stores the matched pricing model on each observation as
 * `internal_model_id`. Entries without a pricing link cannot be joined and are
 * left out of the result, so callers can tell "not linked" from "no usage".
 */
export async function getRegistryModelUsage(params: {
  projectId: string;
  registryModelIds: string[];
}): Promise<Record<string, RegistryModelUsage>> {
  const { projectId, registryModelIds } = params;
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

  const since = new Date(
    Date.now() - REGISTRY_USAGE_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  );
  const rows = await queryClickhouse({
    query: `
      SELECT
        internal_model_id AS modelId,
        MAX(start_time) AS lastUsed,
        uniqExactIf(id, start_time >= {since: DateTime64(3)}) AS generationsInWindow
      FROM observations
      WHERE project_id = {projectId: String}
        AND type = 'GENERATION'
        AND internal_model_id IN ({modelIds: Array(String)})
      GROUP BY internal_model_id
    `,
    params: {
      projectId,
      modelIds: linked.map((entry) => entry.pricingModelId),
      since: convertDateToClickhouseDateTime(since),
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
