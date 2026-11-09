import type { z } from "zod";

import { LangfuseConflictError, LangfuseNotFoundError } from "@langfuse/shared";
import {
  Prisma,
  type PrismaClient,
  type RegistryModel,
} from "@langfuse/shared/src/db";
import { PromptService, redis } from "@langfuse/shared/src/server";
import type { UpsertRegistryModelSchema } from "@/src/features/model-registry/validation";

/** The writable fields of a registry model. */
export type RegistryModelInput = Omit<
  z.infer<typeof UpsertRegistryModelSchema>,
  "projectId" | "id"
>;

/**
 * Creates a registry model, or updates the one with `id`. Shared by the tRPC
 * router and the public API, so both enforce the same rules. Callers write
 * the audit log, because only they know who the actor is.
 */
export async function saveRegistryModel(params: {
  prisma: PrismaClient;
  projectId: string;
  id?: string;
  input: RegistryModelInput;
}): Promise<{ model: RegistryModel; created: boolean }> {
  const { prisma, projectId, id, input } = params;
  const { pricingModelId, ...fields } = input;

  // A pricing model must be one of this project's models or a
  // Langfuse-managed default (null projectId). Anything else would let a
  // project link to another project's pricing.
  if (pricingModelId) {
    const pricingModel = await prisma.model.findFirst({
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
      const existing = await prisma.registryModel.findFirst({
        where: { id, projectId },
        select: { id: true },
      });
      if (!existing) {
        throw new LangfuseNotFoundError("Registry model not found");
      }
    }

    const model = id
      ? await prisma.registryModel.update({ where: { id }, data })
      : await prisma.registryModel.create({ data: { ...data, projectId } });

    // Cached prompts carry their model's provider, id and default params.
    // A new model has no prompts yet, so only an edit can make them stale.
    if (id) {
      await new PromptService(prisma, redis).invalidateCache({ projectId });
    }

    return { model, created: !id };
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
}

/**
 * Deletes a registry model and returns the deleted row. Refuses while prompt
 * versions still use it.
 */
export async function removeRegistryModel(params: {
  prisma: PrismaClient;
  projectId: string;
  id: string;
}): Promise<RegistryModel> {
  const { prisma, projectId, id } = params;

  const existing = await prisma.registryModel.findFirst({
    where: { id, projectId },
  });
  if (!existing) throw new LangfuseNotFoundError("Registry model not found");

  // The foreign key would null the reference out, silently leaving those
  // prompt versions without a model.
  const referencingPrompts = await prisma.prompt.count({
    where: { projectId, registryModelId: id },
  });
  if (referencingPrompts > 0) {
    throw new LangfuseConflictError(
      `This model is used by ${referencingPrompts} prompt version${referencingPrompts === 1 ? "" : "s"}. Remove it from those prompts before deleting it.`,
    );
  }

  await prisma.registryModel.delete({ where: { id } });
  await new PromptService(prisma, redis).invalidateCache({ projectId });

  return existing;
}
