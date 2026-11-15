import { Pencil, Trash } from "@langfuse/icons";
import {
  SettingsTable,
  type SettingsTableProps,
} from "@/src/components/SettingsTable/SettingsTable";
import { type PaginationBarProps } from "@/src/components/design-system/PaginationBar/PaginationBar";
import { type TableProps } from "@/src/components/design-system/table/Table";
import { createBadgeTableColumn } from "@/src/components/design-system/table/columns/createBadgeTableColumn";
import { createDateTableColumn } from "@/src/components/design-system/table/columns/createDateTableColumn";
import { createNumberTableColumn } from "@/src/components/design-system/table/columns/createNumberTableColumn";
import { createTextTableColumn } from "@/src/components/design-system/table/columns/createTextTableColumn";
import { type LangfuseColumnDef } from "@/src/components/table/types";
import { numberFormatter } from "@/src/utils/numbers";
import {
  REGISTRY_USAGE_WINDOW_DAYS,
  type RegistryModelUsage,
} from "@/src/features/model-registry/usage";
import {
  CAPABILITY_KEYS,
  CAPABILITY_LABELS,
  type RegistryModelRow,
} from "@/src/features/model-registry/validation";

const NOT_LINKED_TO_PRICING = "Link pricing";
const USAGE_DESCRIPTION =
  "Usage is read from generations that match this model's linked pricing. Link a pricing model to see it.";

/** `usage` is undefined while loading, and has no entry for unlinked models. */
function getColumns(
  usage: Record<string, RegistryModelUsage> | undefined,
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
      accessorFn: (row) => row.pricingModel?.modelName,
      id: "pricing",
      header: "Pricing",
      nullValue: "Not linked",
      size: 140,
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
      size: 120,
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
      header: `Generations, ${REGISTRY_USAGE_WINDOW_DAYS}d`,
      headerTooltip: { description: USAGE_DESCRIPTION },
      emptyValue: NOT_LINKED_TO_PRICING,
      formatter: (count) => numberFormatter(count, 0),
      size: 130,
      enableHiding: true,
      getValue: (_, { row }) => {
        if (!row.original.pricingModel) return undefined;
        if (!usage) return { type: "loading" };
        return usage[row.original.id]?.generationsInWindow ?? 0;
      },
    }),
  ];
}

export function RegistryModelsTable({
  data,
  usage,
  pagination,
  search,
  toolbarActions,
  canEdit,
  onEdit,
  onDelete,
}: {
  data: TableProps<RegistryModelRow>["data"];
  usage?: Record<string, RegistryModelUsage>;
  pagination: PaginationBarProps;
  search: { value: string; onChange: (value: string) => void };
  toolbarActions?: SettingsTableProps<RegistryModelRow>["toolbarActions"];
  canEdit: boolean;
  onEdit: (model: RegistryModelRow) => void;
  onDelete: (model: RegistryModelRow) => void;
}) {
  const noAccess = { reason: "You do not have permission to change models" };

  return (
    <SettingsTable
      tableName="modelRegistry"
      columns={getColumns(usage)}
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
