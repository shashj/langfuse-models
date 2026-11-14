import { useId, useMemo } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";

import { Dialog } from "@/src/components/design-system/Dialog/Dialog";
import { Form } from "@/src/components/design-system/Form/Form";
import { SelectInput } from "@/src/components/design-system/SelectInput/SelectInput";
import { SwitchInput } from "@/src/components/design-system/SwitchInput/SwitchInput";
import { showSuccessToast } from "@/src/features/notifications/showSuccessToast";
import {
  CAPABILITY_KEYS,
  CAPABILITY_LABELS,
  REGISTRY_MODEL_STATUSES,
  type RegistryModelRow,
} from "@/src/features/model-registry/validation";
import { api } from "@/src/utils/api";

const NO_PRICING = "none";

const CAPABILITY_DESCRIPTIONS: Record<
  (typeof CAPABILITY_KEYS)[number],
  string
> = {
  tools: "This model supports tool calling.",
  vision: "This model supports vision.",
  jsonMode: "This model supports JSON mode.",
  reasoning: "This model supports reasoning.",
};

// Numbers are kept as text while editing and converted on submit.
const optionalPositiveInt = z
  .string()
  .trim()
  .refine((v) => v === "" || /^[1-9]\d*$/.test(v), "Enter a whole number");
const optionalNumber = z
  .string()
  .trim()
  .refine((v) => v === "" || Number.isFinite(Number(v)), "Enter a number");

const FormSchema = z.object({
  provider: z.string().trim().min(1, "Provider is required"),
  modelId: z.string().trim().min(1, "Model ID is required"),
  displayName: z.string().trim().min(1, "Display name is required"),
  description: z.string(),
  status: z.enum(REGISTRY_MODEL_STATUSES),
  contextWindow: optionalPositiveInt,
  maxOutputTokens: optionalPositiveInt,
  tools: z.boolean(),
  vision: z.boolean(),
  jsonMode: z.boolean(),
  reasoning: z.boolean(),
  temperature: optionalNumber,
  topP: optionalNumber,
  maxTokens: optionalPositiveInt,
  pricingModelId: z.string(),
});
type FormValues = z.infer<typeof FormSchema>;

const toNumber = (value: string) => (value === "" ? undefined : Number(value));
const toText = (value: number | null | undefined) =>
  value === null || value === undefined ? "" : String(value);

function toFormValues(model?: RegistryModelRow): FormValues {
  return {
    provider: model?.provider ?? "",
    modelId: model?.modelId ?? "",
    displayName: model?.displayName ?? "",
    description: model?.description ?? "",
    status: model?.status ?? "active",
    contextWindow: toText(model?.contextWindow),
    maxOutputTokens: toText(model?.maxOutputTokens),
    tools: Boolean(model?.capabilities.tools),
    vision: Boolean(model?.capabilities.vision),
    jsonMode: Boolean(model?.capabilities.jsonMode),
    reasoning: Boolean(model?.capabilities.reasoning),
    temperature: toText(model?.defaultParams?.temperature),
    topP: toText(model?.defaultParams?.top_p),
    maxTokens: toText(model?.defaultParams?.max_tokens),
    pricingModelId: model?.pricingModel?.id ?? NO_PRICING,
  };
}

/** UpsertRegistryModelDialog creates a registry model, or edits `model` when given. */
export function UpsertRegistryModelDialog({
  projectId,
  model,
  closeDialog,
}: {
  projectId: string;
  model?: RegistryModelRow;
  closeDialog: () => void;
}) {
  const formId = useId();
  const utils = api.useUtils();
  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: toFormValues(model),
  });

  const pricingModels = api.models.getAll.useQuery(
    { projectId, searchString: "", page: 0, limit: 100 },
    { refetchOnWindowFocus: false },
  );
  const pricingOptions = useMemo(
    () => [
      { value: NO_PRICING, label: "Not linked" },
      ...(pricingModels.data?.models ?? []).map((pricing) => ({
        value: pricing.id,
        label: pricing.modelName,
      })),
    ],
    [pricingModels.data],
  );

  const upsert = api.modelRegistry.upsert.useMutation({
    onSuccess: async () => {
      await utils.modelRegistry.invalidate();
      showSuccessToast({
        operation: "modelRegistry.upsert",
        title: model ? "Model updated" : "Model added",
        description: "The model registry has been updated.",
      });
      closeDialog();
    },
    onError: (error) =>
      form.setError("root.server", { message: error.message }),
  });

  const submit = (values: FormValues) => {
    const defaultParams = {
      temperature: toNumber(values.temperature),
      top_p: toNumber(values.topP),
      max_tokens: toNumber(values.maxTokens),
    };
    const hasParams = Object.values(defaultParams).some((v) => v !== undefined);

    upsert.mutate({
      projectId,
      id: model?.id,
      provider: values.provider,
      modelId: values.modelId,
      displayName: values.displayName,
      description: values.description.trim() || null,
      status: values.status,
      contextWindow: toNumber(values.contextWindow) ?? null,
      maxOutputTokens: toNumber(values.maxOutputTokens) ?? null,
      capabilities: {
        tools: values.tools,
        vision: values.vision,
        jsonMode: values.jsonMode,
        reasoning: values.reasoning,
      },
      defaultParams: hasParams ? defaultParams : null,
      pricingModelId:
        values.pricingModelId === NO_PRICING ? null : values.pricingModelId,
    });
  };

  const rootError = form.formState.errors.root?.server?.message;

  return (
    <Dialog
      title={model ? "Edit model" : "Add model"}
      size="md"
      actions={[
        {
          label: model ? "Save changes" : "Add model",
          type: "submit",
          form: formId,
          loading: upsert.isPending,
          disabled: upsert.isPending,
        },
      ]}
    >
      <Dialog.Body separators="both">
        <Form
          id={formId}
          actions={[]}
          onSubmit={(event) => {
            event.stopPropagation();
            return form.handleSubmit(submit)(event);
          }}
        >
          <Form.InputField
            control={form.control}
            name="displayName"
            label="Display name"
            placeholder="e.g. GPT-4o"
          />
          <Form.InputField
            control={form.control}
            name="provider"
            label="Provider"
            description="Name of the LLM connection that runs this model."
            placeholder="e.g. openai"
          />
          <Form.InputField
            control={form.control}
            name="modelId"
            label="Model ID"
            description="The model name as the provider expects it."
            placeholder="e.g. gpt-4o"
          />
          <Form.InputField
            control={form.control}
            name="description"
            label="Description"
          />
          <Form.SelectInputField
            control={form.control}
            name="status"
            label="Status"
            placeholder="Select a status"
            options={REGISTRY_MODEL_STATUSES.map((status) => ({
              value: status,
              label: status === "active" ? "Active" : "Deprecated",
            }))}
          />
          <Form.InputField
            control={form.control}
            name="contextWindow"
            label="Context window (tokens)"
            inputMode="numeric"
          />
          <Form.InputField
            control={form.control}
            name="maxOutputTokens"
            label="Max output tokens"
            inputMode="numeric"
          />
          {CAPABILITY_KEYS.map((key) => (
            <Form.Field
              key={key}
              control={form.control}
              name={key}
              label={CAPABILITY_LABELS[key]}
            >
              {(field) => (
                <SwitchInput
                  id={field.id}
                  name={field.name}
                  checked={field.value}
                  onCheckedChange={field.onChange}
                  onBlur={field.onBlur}
                  description={CAPABILITY_DESCRIPTIONS[key]}
                  aria-describedby={field.inputDescribedById}
                />
              )}
            </Form.Field>
          ))}
          <Form.InputField
            control={form.control}
            name="temperature"
            label="Default temperature"
            inputMode="decimal"
          />
          <Form.InputField
            control={form.control}
            name="topP"
            label="Default top P"
            inputMode="decimal"
          />
          <Form.InputField
            control={form.control}
            name="maxTokens"
            label="Default max tokens"
            inputMode="numeric"
          />
          <Form.Field
            control={form.control}
            name="pricingModelId"
            label="Pricing"
            description="Link to a model definition to track cost."
          >
            {(field) => (
              <SelectInput<string>
                id={field.id}
                value={field.value}
                onValueChange={field.onChange}
                onBlur={field.onBlur}
                options={pricingOptions}
                placeholder="Select a model definition"
                search={{ placeholder: "Search model definitions" }}
                aria-describedby={field.inputDescribedById}
              />
            )}
          </Form.Field>
          {rootError && (
            <p role="alert" className="text-destructive text-sm">
              {rootError}
            </p>
          )}
        </Form>
      </Dialog.Body>
    </Dialog>
  );
}
