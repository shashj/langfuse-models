import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { type Session } from "next-auth";

import {
  LangfuseConflictError,
  LangfuseNotFoundError,
  Prisma,
} from "@langfuse/shared";
import { escapeSqlLikePattern } from "@langfuse/shared/src/server";
import { auditLog } from "@/src/features/audit-logs/auditLog";
import { LlmConnectionService } from "@/src/features/llm-api-key/server/llmConnectionService";
import {
  registryModelInclude,
  toRegistryModelRow,
} from "@/src/features/model-registry/server/mapRegistryModel";
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

      const { id, projectId, pricingModelId, ...fields } = input;

      // A pricing model must be one of this project's models or a
      // Langfuse-managed default (null projectId). Anything else would let a
      // project link to another project's pricing.
      if (pricingModelId) {
        const pricingModel = await ctx.prisma.model.findFirst({
          where: {
            id: pricingModelId,
            OR: [{ projectId }, { projectId: null }],
          },
          select: { id: true },
        });
        if (!pricingModel) {
          throw new LangfuseNotFoundError("Pricing model not found");
        }
      }

      const data = {
        provider: fields.provider,
        modelId: fields.modelId,
        displayName: fields.displayName,
        description: fields.description ?? null,
        status: fields.status,
        contextWindow: fields.contextWindow ?? null,
        maxOutputTokens: fields.maxOutputTokens ?? null,
        capabilities: fields.capabilities,
        defaultParams: fields.defaultParams ?? Prisma.DbNull,
        pricingModelId: pricingModelId ?? null,
      };

      try {
        if (id) {
          const existing = await ctx.prisma.registryModel.findFirst({
            where: { id, projectId },
            select: { id: true },
          });
          if (!existing) {
            throw new LangfuseNotFoundError("Registry model not found");
          }
        }

        const saved = id
          ? await ctx.prisma.registryModel.update({
              where: { id },
              data,
            })
          : await ctx.prisma.registryModel.create({
              data: { ...data, projectId },
            });

        await auditLog({
          session: ctx.session,
          resourceType: "registryModel",
          resourceId: saved.id,
          action: id ? "update" : "create",
          after: saved,
        });

        return saved;
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        ) {
          throw new LangfuseConflictError(
            `${fields.modelId} is already registered for provider ${fields.provider}`,
          );
        }
        throw error;
      }
    }),

  delete: protectedProjectProcedure
    .input(z.object({ projectId: z.string(), id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "models:CUD",
      });

      const existing = await ctx.prisma.registryModel.findFirst({
        where: { id: input.id, projectId: input.projectId },
      });
      if (!existing)
        throw new LangfuseNotFoundError("Registry model not found");

      // The foreign key would null the reference out, silently leaving those
      // prompt versions without a model.
      const referencingPrompts = await ctx.prisma.prompt.count({
        where: { projectId: input.projectId, registryModelId: input.id },
      });
      if (referencingPrompts > 0) {
        throw new LangfuseConflictError(
          `This model is used by ${referencingPrompts} prompt version${referencingPrompts === 1 ? "" : "s"}. Remove it from those prompts before deleting it.`,
        );
      }

      await ctx.prisma.registryModel.delete({ where: { id: input.id } });

      await auditLog({
        session: ctx.session,
        resourceType: "registryModel",
        resourceId: input.id,
        action: "delete",
        before: existing,
      });

      return existing;
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
});
