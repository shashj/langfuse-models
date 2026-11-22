import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { type Session } from "next-auth";

import { LangfuseNotFoundError, type Prisma } from "@langfuse/shared";
import { escapeSqlLikePattern } from "@langfuse/shared/src/server";
import { auditLog } from "@/src/features/audit-logs/auditLog";
import { LlmConnectionService } from "@/src/features/llm-api-key/server/llmConnectionService";
import {
  registryModelInclude,
  toRegistryModelRow,
} from "@/src/features/model-registry/server/mapRegistryModel";
import { getRegistryExperimentUsage } from "@/src/features/model-registry/server/registryExperimentUsage";
import { getRegistryModelUsage } from "@/src/features/model-registry/server/registryModelUsage";
import {
  removeRegistryModel,
  saveRegistryModel,
} from "@/src/features/model-registry/server/registryModelService";
import {
  RegistryModelListInputSchema,
  UpsertRegistryModelSchema,
} from "@/src/features/model-registry/validation";
import {
  hasProjectAccess,
  throwIfNoProjectAccess,
} from "@/src/features/rbac/utils/checkProjectAccess";
import {
  createTRPCRouter,
  protectedProjectProcedure,
} from "@/src/server/api/trpc";

// Anyone who can read prompts must be able to read the registry, because a
// prompt version can reference a registry model.
const REGISTRY_READ_SCOPES = ["models:read", "prompts:read"] as const;

function throwIfCannotReadRegistry(params: {
  session: Session | null;
  projectId: string;
}) {
  const allowed = REGISTRY_READ_SCOPES.some((scope) =>
    hasProjectAccess({ ...params, scope }),
  );
  if (!allowed) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "User does not have access to this resource or action",
    });
  }
}

type ProjectOwner = {
  type: "project";
  projectId: string;
  organizationId: string;
};

/** Which `provider` + `modelId` pairs an effective LLM connection can run. */
async function getRunnableModelKeys(owner: ProjectOwner) {
  const { data } =
    await new LlmConnectionService().listEffectiveWithAvailableModels({
      owner,
    });
  const keys = new Set<string>();
  for (const connection of data) {
    for (const model of connection.availableModels) {
      keys.add(`${connection.provider}::${model}`);
    }
  }
  return { keys, connections: data };
}

const runnableKey = (provider: string, modelId: string) =>
  `${provider}::${modelId}`;

export const modelRegistryRouter = createTRPCRouter({
  getAll: protectedProjectProcedure
    .input(RegistryModelListInputSchema)
    .query(async ({ input, ctx }) => {
      throwIfCannotReadRegistry({
        session: ctx.session,
        projectId: input.projectId,
      });

      const search = escapeSqlLikePattern(input.searchString.trim());
      const where: Prisma.RegistryModelWhereInput = {
        projectId: input.projectId,
        ...(search
          ? {
              OR: [
                { displayName: { contains: search, mode: "insensitive" } },
                { modelId: { contains: search, mode: "insensitive" } },
                { provider: { contains: search, mode: "insensitive" } },
              ],
            }
          : {}),
      };

      const [rows, totalCount, runnable] = await Promise.all([
        ctx.prisma.registryModel.findMany({
          where,
          include: registryModelInclude,
          orderBy: [{ provider: "asc" }, { displayName: "asc" }],
          skip: input.page * input.limit,
          take: input.limit,
        }),
        ctx.prisma.registryModel.count({ where }),
        getRunnableModelKeys({
          type: "project",
          projectId: input.projectId,
          organizationId: ctx.session.orgId,
        }),
      ]);

      return {
        models: rows.map((row) =>
          toRegistryModelRow(
            row,
            runnable.keys.has(runnableKey(row.provider, row.modelId)),
          ),
        ),
        totalCount,
      };
    }),

  getById: protectedProjectProcedure
    .input(z.object({ projectId: z.string(), id: z.string() }))
    .query(async ({ input, ctx }) => {
      throwIfCannotReadRegistry({
        session: ctx.session,
        projectId: input.projectId,
      });

      const row = await ctx.prisma.registryModel.findFirst({
        where: { id: input.id, projectId: input.projectId },
        include: registryModelInclude,
      });
      if (!row) throw new LangfuseNotFoundError("Registry model not found");

      const runnable = await getRunnableModelKeys({
        type: "project",
        projectId: input.projectId,
        organizationId: ctx.session.orgId,
      });
      return toRegistryModelRow(
        row,
        runnable.keys.has(runnableKey(row.provider, row.modelId)),
      );
    }),

  upsert: protectedProjectProcedure
    .input(UpsertRegistryModelSchema)
    .mutation(async ({ input, ctx }) => {
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "models:CUD",
      });

      const { id, projectId, ...fields } = input;

      const { model, created } = await saveRegistryModel({
        prisma: ctx.prisma,
        projectId,
        id,
        input: fields,
      });

      await auditLog({
        session: ctx.session,
        resourceType: "registryModel",
        resourceId: model.id,
        action: created ? "create" : "update",
        after: model,
      });

      return model;
    }),

  delete: protectedProjectProcedure
    .input(z.object({ projectId: z.string(), id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "models:CUD",
      });

      const deleted = await removeRegistryModel({
        prisma: ctx.prisma,
        projectId: input.projectId,
        id: input.id,
      });

      await auditLog({
        session: ctx.session,
        resourceType: "registryModel",
        resourceId: input.id,
        action: "delete",
        before: deleted,
      });

      return deleted;
    }),

  /**
   * Registers every model an effective LLM connection can run, skipping ones
   * already in the registry.
   */
  importFromConnections: protectedProjectProcedure
    .input(z.object({ projectId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "models:CUD",
      });
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "llmApiKeys:read",
      });

      const { connections } = await getRunnableModelKeys({
        type: "project",
        projectId: input.projectId,
        organizationId: ctx.session.orgId,
      });

      const candidates = connections.flatMap((connection) =>
        connection.availableModels.map((modelId) => ({
          projectId: input.projectId,
          provider: connection.provider,
          modelId,
          displayName: modelId,
        })),
      );

      const result = await ctx.prisma.registryModel.createMany({
        data: candidates,
        skipDuplicates: true,
      });

      await auditLog({
        session: ctx.session,
        resourceType: "registryModel",
        resourceId: input.projectId,
        action: "import",
        after: { created: result.count },
      });

      return {
        created: result.count,
        skipped: candidates.length - result.count,
      };
    }),

  /**
   * Light lookup for trace views: registry entries by their own id or by the
   * pricing model that observations store as `internal_model_id`. Skips the
   * connection lookup that `getAll` and `getById` do.
   */
  lookup: protectedProjectProcedure
    .input(
      z.object({
        projectId: z.string(),
        ids: z.array(z.string()).max(100).default([]),
        pricingModelIds: z.array(z.string()).max(100).default([]),
        // Entries by `(provider, modelId)`, for runs that did not store a registry id.
        pairs: z
          .array(z.object({ provider: z.string(), modelId: z.string() }))
          .max(100)
          .default([]),
      }),
    )
    .query(async ({ input, ctx }) => {
      throwIfCannotReadRegistry({
        session: ctx.session,
        projectId: input.projectId,
      });

      const matchers: Prisma.RegistryModelWhereInput[] = [
        ...(input.ids.length > 0 ? [{ id: { in: input.ids } }] : []),
        ...(input.pricingModelIds.length > 0
          ? [{ pricingModelId: { in: input.pricingModelIds } }]
          : []),
        ...input.pairs.map(({ provider, modelId }) => ({ provider, modelId })),
      ];
      if (matchers.length === 0) return [];

      return ctx.prisma.registryModel.findMany({
        where: { projectId: input.projectId, OR: matchers },
        select: {
          id: true,
          provider: true,
          displayName: true,
          modelId: true,
          pricingModelId: true,
        },
        orderBy: [{ displayName: "asc" }, { id: "asc" }],
      });
    }),

  /**
   * Generation usage for registry entries, joined through their pricing link.
   * Entries without a pricing link are absent from the result.
   */
  usage: protectedProjectProcedure
    .input(
      z.object({
        projectId: z.string(),
        ids: z.array(z.string()).max(200),
        from: z.date(),
        to: z.date(),
      }),
    )
    .query(async ({ input, ctx }) => {
      throwIfCannotReadRegistry({
        session: ctx.session,
        projectId: input.projectId,
      });
      return getRegistryModelUsage({
        projectId: input.projectId,
        registryModelIds: input.ids,
        from: input.from,
        to: input.to,
        source: ctx.session.user?.v4BetaEnabled ? "events" : "observations",
      });
    }),

  /**
   * Experiments and datasets per registry entry in a time range, matched by the registry id an
   * experiment stored or by its provider and model.
   */
  experimentUsage: protectedProjectProcedure
    .input(
      z.object({
        projectId: z.string(),
        ids: z.array(z.string()).max(200),
        from: z.date(),
        to: z.date(),
      }),
    )
    .query(async ({ input, ctx }) => {
      throwIfCannotReadRegistry({
        session: ctx.session,
        projectId: input.projectId,
      });
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "promptExperiments:read",
      });
      return getRegistryExperimentUsage({
        projectId: input.projectId,
        registryModelIds: input.ids,
        from: input.from,
        to: input.to,
      });
    }),
});
