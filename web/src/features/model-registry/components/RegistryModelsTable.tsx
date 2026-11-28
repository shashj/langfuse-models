import { Beaker, Pencil, SquareArrowOutUpRight, Trash } from "@langfuse/icons";
import {
  TableCard,
  type TableCardProps,
} from "@/src/components/TableCard/TableCard";
import { type PaginationBarProps } from "@/src/components/design-system/PaginationBar/PaginationBar";
import { type TableProps } from "@/src/components/design-system/table/Table";
import { createBadgeTableColumn } from "@/src/components/design-system/table/columns/createBadgeTableColumn";
import { createDateTableColumn } from "@/src/components/design-system/table/columns/createDateTableColumn";
import { createNumberTableColumn } from "@/src/components/design-system/table/columns/createNumberTableColumn";
import { createTextTableColumn } from "@/src/components/design-system/table/columns/createTextTableColumn";
import { type LangfuseColumnDef } from "@/src/components/table/types";
import { numberFormatter } from "@/src/utils/numbers";
import {
  type RegistryExperimentUsage,
  type RegistryModelUsage,
} from "@/src/features/model-registry/usage";
import {
  CAPABILITY_KEYS,
  CAPABILITY_LABELS,
  type RegistryModelRow,
} from "@/src/features/model-registry/validation";

const NO_PRICING_MATCH = "No pricing match";
const USAGE_DESCRIPTION =
  "Generations in the selected time range that match this model's pricing definition. A model that no definition matches has no usage here: add one under Settings, Models.";
const PRICING_DESCRIPTION =
  "The model definition that prices this model. Langfuse matches it from the model ID, the same way it prices a generation, unless you pick one when you edit the model.";

/** The pricing definition's name, marked when Langfuse matched it rather than a user picking it. */
function getPricingLabel(row: RegistryModelRow): string | undefined {
  if (!row.pricingModel) return undefined;
  return row.pricingModel.source === "matched"
    ? `${row.pricingModel.modelName} (auto)`
    : row.pricingModel.modelName;
}

const EXPERIMENT_USAGE_DESCRIPTION =
  "Experiments in the selected time range that ran on this model. An experiment counts for the registry model it started from, or for the provider and model it ran on.";

/**
 * `usage` is undefined while loading, and has no entry for unlinked models. `experimentUsage` is
 * undefined while loading and null when experiment usage is not available.
 */
function getColumns(
  usage: Record<string, RegistryModelUsage> | undefined,
  experimentUsage: Record<string, RegistryExperimentUsage> | null | undefined,
): LangfuseColumnDef<RegistryModelRow>[] {
  return [
    createTextTableColumn<RegistryModelRow>({
      accessorKey: "displayName",
      header: "Name",
      size: 160,
    }),
    createTextTableColumn<RegistryModelRow>({
      accessorKey: "provider",
      header: "Provider",
      size: 120,
    }),
    createTextTableColumn<RegistryModelRow>({
      accessorKey: "modelId",
      header: "Model ID",
      size: 180,
    }),
    createBadgeTableColumn<RegistryModelRow>({
      accessorKey: "status",
      header: "Status",
      size: 90,
      range: "semantic",
      getBadge: (status) => ({
        value: status === "deprecated" ? "Deprecated" : "Active",
        variant: status === "deprecated" ? "warning" : "success",
      }),
    }),
    createTextTableColumn<RegistryModelRow>({
      accessorFn: (row) => row.contextWindow?.toLocaleString(),
      id: "contextWindow",
      header: "Context window",
      nullValue: "-",
      size: 120,
      enableHiding: true,
    }),
    createTextTableColumn<RegistryModelRow>({
      accessorFn: (row) =>
        CAPABILITY_KEYS.filter((key) => row.capabilities[key])
          .map((key) => CAPABILITY_LABELS[key])
          .join(", "),
      id: "capabilities",
      header: "Capabilities",
      nullValue: "-",
      size: 200,
      enableHiding: true,
    }),
    createTextTableColumn<RegistryModelRow>({
      accessorFn: getPricingLabel,
      id: "pricing",
      header: "Pricing",
      headerTooltip: { description: PRICING_DESCRIPTION },
      nullValue: NO_PRICING_MATCH,
      size: 220,
      enableHiding: true,
    }),
    // Only a usable model gets a badge. With a full catalogue most rows have no
    // connection, and a badge on each of them would drown out the ones that do.
    createBadgeTableColumn<RegistryModelRow>({
      accessorFn: (row) => (row.connectionAvailable ? "Connected" : undefined),
      id: "connection",
      header: "Connection",
      nullValue: "No connection",
      size: 120,
      range: "semantic",
      getBadge: (value) => ({ value, variant: "success" }),
    }),
    createDateTableColumn<RegistryModelRow>({
      accessorFn: () => undefined,
      id: "lastUsed",
      header: "Last used",
      headerTooltip: { description: USAGE_DESCRIPTION },
      emptyValue: "-",
      size: 160,
      enableHiding: true,
      getValue: (_, { row }) => {
        if (!row.original.pricingModel) return undefined;
        if (!usage) return { type: "loading" };
        return usage[row.original.id]?.lastUsed ?? undefined;
      },
    }),
    createNumberTableColumn<RegistryModelRow>({
      accessorFn: () => undefined,
      id: "generations",
      header: "Generations",
      headerTooltip: { description: USAGE_DESCRIPTION },
      emptyValue: NO_PRICING_MATCH,
      formatter: (count) => numberFormatter(count, 0),
      size: 130,
      enableHiding: true,
      getValue: (_, { row }) => {
        if (!row.original.pricingModel) return undefined;
        if (!usage) return { type: "loading" };
        return usage[row.original.id]?.generationsInWindow ?? 0;
      },
    }),
    createNumberTableColumn<RegistryModelRow>({
      accessorFn: () => undefined,
      id: "experiments",
      header: "Experiments",
      headerTooltip: { description: EXPERIMENT_USAGE_DESCRIPTION },
      emptyValue: "-",
      formatter: (count) => numberFormatter(count, 0),
      size: 130,
      enableHiding: true,
      getValue: (_, { row }) => {
        if (experimentUsage === null) return undefined;
        if (!experimentUsage) return { type: "loading" };
        return experimentUsage[row.original.id]?.experiments ?? 0;
      },
    }),
    createNumberTableColumn<RegistryModelRow>({
      accessorFn: () => undefined,
      id: "datasets",
      header: "Datasets",
      headerTooltip: { description: EXPERIMENT_USAGE_DESCRIPTION },
      emptyValue: "-",
      formatter: (count) => numberFormatter(count, 0),
      size: 120,
      enableHiding: true,
      getValue: (_, { row }) => {
        if (experimentUsage === null) return undefined;
        if (!experimentUsage) return { type: "loading" };
        return experimentUsage[row.original.id]?.datasets ?? 0;
      },
    }),
  ];
}

export function RegistryModelsTable({
  data,
  usage,
  experimentUsage,
  canViewExperiments,
  pagination,
  search,
  toolbarActions,
  canEdit,
  onEdit,
  onDelete,
  onViewGenerations,
  onViewExperiments,
}: {
  data: TableProps<RegistryModelRow>["data"];
  usage?: Record<string, RegistryModelUsage>;
  experimentUsage?: Record<string, RegistryExperimentUsage> | null;
  canViewExperiments: boolean;
  pagination: PaginationBarProps;
  search: { value: string; onChange: (value: string) => void };
  toolbarActions?: TableCardProps<RegistryModelRow>["toolbarActions"];
  canEdit: boolean;
  onEdit: (model: RegistryModelRow) => void;
  onDelete: (model: RegistryModelRow) => void;
  onViewGenerations: (model: RegistryModelRow) => void;
  onViewExperiments: (model: RegistryModelRow) => void;
}) {
  const noAccess = { reason: "You do not have permission to change models" };

  return (
    <TableCard
      tableName="modelRegistry"
      columns={getColumns(usage, experimentUsage)}
      columnVisibilityKey="modelRegistryColumnVisibility"
      columnOrderKey="modelRegistryColumnOrder"
      data={data}
      pagination={pagination}
      loadingRowCount={Math.min(pagination.state.pageSize, 8)}
      search={{ ...search, placeholder: "Search models" }}
      toolbarActions={toolbarActions}
      onRowClick={onEdit}
      actions={(model) => [
        {
          id: "view-generations",
          type: "item",
          title: "View generations",
          icon: SquareArrowOutUpRight,
          disabled: model.pricingModel
            ? undefined
            : { reason: "No model definition matches this model" },
          onClick: () => onViewGenerations(model),
        },
        {
          id: "view-experiments",
          type: "item",
          title: "View experiments",
          icon: Beaker,
          disabled: canViewExperiments
            ? undefined
            : { reason: "Experiments are not available for this project" },
          onClick: () => onViewExperiments(model),
        },
        {
          id: "edit",
          type: "item",
          title: "Edit model",
          icon: Pencil,
          disabled: canEdit ? undefined : noAccess,
          onClick: () => onEdit(model),
        },
        {
          id: "delete",
          type: "item",
          title: "Delete model",
          icon: Trash,
          variant: "destructive",
          disabled: canEdit ? undefined : noAccess,
          onClick: () => onDelete(model),
        },
      ]}
    />
  );
}
