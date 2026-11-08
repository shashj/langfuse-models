import { useMemo } from "react";
import { useFormContext } from "react-hook-form";

import { Form } from "@/src/components/design-system/Form/Form";
import { SelectInput } from "@/src/components/design-system/SelectInput/SelectInput";
import { api } from "@/src/utils/api";
import { NO_MODEL, type PromptModelFormValues } from "./promptModelFormValues";

/** PromptModelFields picks the registry model a prompt version runs on and overrides its default parameters. */
export function PromptModelFields({ projectId }: { projectId: string }) {
  const { control, watch } = useFormContext<PromptModelFormValues>();
  const selectedId = watch("registryModelId") ?? NO_MODEL;

  const registry = api.modelRegistry.getAll.useQuery(
    { projectId, searchString: "", page: 0, limit: 200 },
    { refetchOnWindowFocus: false },
  );
  const models = useMemo(() => registry.data?.models ?? [], [registry.data]);
  const selected = models.find((model) => model.id === selectedId);

  const options = useMemo(() => {
    const usable = models.filter(
      (model) => model.status === "active" || model.id === selectedId,
    );
    const known = usable.map((model) => ({
      value: model.id,
      label: `${model.displayName} (${model.provider})`,
    }));
    // The registry may be loading or unreadable. The current selection must
    // stay a valid option so that saving does not drop it.
    const unknownSelection =
      selectedId !== NO_MODEL &&
      !usable.some((model) => model.id === selectedId)
        ? [{ value: selectedId, label: "Current model" }]
        : [];

    return [
      { value: NO_MODEL, label: "No model" },
      ...unknownSelection,
      ...known,
    ];
  }, [models, selectedId]);

  const defaults = selected?.defaultParams;

  return (
    <div className="flex flex-col gap-4">
      <Form.Field
        control={control}
        name="registryModelId"
        label="Model"
        description="The model this prompt version is meant to run on. Manage models on the Models page."
      >
        {(field) => (
          <SelectInput<string>
            id={field.id}
            value={field.value ?? NO_MODEL}
            onValueChange={field.onChange}
            onBlur={field.onBlur}
            options={options}
            placeholder="Select a model"
            search={{ placeholder: "Search models" }}
            aria-describedby={field.inputDescribedById}
          />
        )}
      </Form.Field>
      {selectedId !== NO_MODEL && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Form.InputField
            control={control}
            name="modelTemperature"
            label="Temperature"
            placeholder={
              defaults?.temperature !== undefined
                ? `Default ${defaults.temperature}`
                : "Model default"
            }
            inputMode="decimal"
          />
          <Form.InputField
            control={control}
            name="modelTopP"
            label="Top P"
            placeholder={
              defaults?.top_p !== undefined
                ? `Default ${defaults.top_p}`
                : "Model default"
            }
            inputMode="decimal"
          />
          <Form.InputField
            control={control}
            name="modelMaxTokens"
            label="Max tokens"
            placeholder={
              defaults?.max_tokens !== undefined
                ? `Default ${defaults.max_tokens}`
                : "Model default"
            }
            inputMode="numeric"
          />
        </div>
      )}
    </div>
  );
}
