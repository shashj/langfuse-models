/* eslint-disable @typescript-eslint/no-use-before-define */
import { useMemo } from "react";
import { api } from "@/src/utils/api";
import { type UseFormReturn } from "react-hook-form";
import {
  extractVariables,
  parsePromptToolConfig,
  PromptType,
  extractPlaceholderNames,
  type PromptMessage,
  type PromptToolConfig,
  ZodModelConfig,
} from "@langfuse/shared";
import { z } from "zod/v4";
import { resolveEffectivePromptModel } from "@/src/features/model-registry/utils/effectivePromptModel";

type ExperimentPromptDataProps = {
  projectId: string;
  form: UseFormReturn<any>;
};

export type ExperimentPromptModelConfig = {
  provider?: string;
  model: string;
};

export function useExperimentPromptData({
  projectId,
  form,
}: ExperimentPromptDataProps) {
  const promptId = form.watch("promptId");

  const promptMeta = api.prompts.allPromptMeta.useQuery({
    projectId,
  });

  const expectedColumns = useMemo(() => {
    const prompt = promptMeta.data?.find((p) => p.id === promptId);
    if (!prompt) return [];

    const extractedVariables = extractVariables(
      prompt.type === PromptType.Text
        ? (prompt?.prompt?.toString() ?? "")
        : JSON.stringify(prompt?.prompt),
    );

    const promptMessages =
      prompt?.type === PromptType.Chat && Array.isArray(prompt.prompt)
        ? prompt.prompt
        : [];
    const placeholderNames = extractPlaceholderNames(
      promptMessages as PromptMessage[],
    );

    return [...extractedVariables, ...placeholderNames];
  }, [promptId, promptMeta.data]);

  const promptsByName = useMemo(
    () =>
      promptMeta.data?.reduce<
        Record<string, Array<{ version: number; id: string; labels: string[] }>>
      >((acc, prompt) => {
        if (!acc[prompt.name]) {
          acc[prompt.name] = [];
        }
        acc[prompt.name].push({
          version: prompt.version,
          id: prompt.id,
          labels: prompt.labels,
        });
        return acc;
      }, {}),
    [promptMeta.data],
  );

  // A prompt version's registry model wins. Prompts that predate it fall back
  // to the model stored in their config.
  const selectedPromptModelConfig = useMemo(() => {
    const prompt = promptMeta.data?.find((p) => p.id === promptId);
    if (!prompt) return null;

    const registryModel = resolveEffectivePromptModel({
      registryModel: prompt.registryModel,
      modelParams: prompt.modelParams,
    });
    if (registryModel) {
      return { provider: registryModel.provider, model: registryModel.model };
    }
    return getPromptModelConfig(prompt.config);
  }, [promptId, promptMeta.data]);

  const selectedPromptToolConfig: PromptToolConfig = useMemo(() => {
    const prompt = promptMeta.data?.find((p) => p.id === promptId);
    return parsePromptToolConfig(prompt?.config);
  }, [promptId, promptMeta.data]);

  return {
    expectedColumns,
    promptsByName,
    promptId,
    selectedPromptModelConfig,
    selectedPromptToolConfig,
  };
}

const PromptConfigSchema = ZodModelConfig.extend({
  provider: z.string().min(1).optional(),
  model: z.string().min(1),
});

const getPromptModelConfig = (
  config: unknown,
): ExperimentPromptModelConfig | null => {
  const parsedConfig = PromptConfigSchema.safeParse(config);

  if (!parsedConfig.success) return null;

  const { provider, model } = parsedConfig.data;
  return {
    ...(provider ? { provider } : {}),
    model,
  };
};
