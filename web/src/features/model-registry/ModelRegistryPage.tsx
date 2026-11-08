import { useMemo } from "react";
import { useRouter } from "next/router";
import { Download, PlusIcon } from "@langfuse/icons";
import { StringParam, useQueryParams, withDefault } from "use-query-params";

import Page from "@/src/components/layouts/Page";
import { ConfirmationDialogController } from "@/src/components/design-system/ConfirmationDialogController/ConfirmationDialogController";
import { DialogController } from "@/src/components/design-system/DialogController/DialogController";
import { type AsyncTableData } from "@/src/components/design-system/table/Table";
import { RegistryModelsTable } from "@/src/features/model-registry/components/RegistryModelsTable";
import { UpsertRegistryModelDialog } from "@/src/features/model-registry/components/UpsertRegistryModelDialog";
import { type RegistryModelRow } from "@/src/features/model-registry/validation";
import { showSuccessToast } from "@/src/features/notifications/showSuccessToast";
import { useHasProjectAccess } from "@/src/features/rbac/utils/checkProjectAccess";
import { usePaginationState } from "@/src/hooks/usePaginationState";
import { api, reportTrpcErrorWithoutToast } from "@/src/utils/api";

/** ModelRegistryPage lists the project's registered models and manages them. */
export default function ModelRegistryPage() {
  const router = useRouter();
  const projectId = router.query.projectId as string;
  const utils = api.useUtils();

  const [paginationState, setPaginationState] = usePaginationState(0, 50, {
    page: "pageIndex",
    limit: "pageSize",
  });
  const [queryParams, setQueryParams] = useQueryParams({
    search: withDefault(StringParam, ""),
  });
  const hasWriteAccess = useHasProjectAccess({
    projectId,
    scope: "models:CUD",
  });

  const models = api.modelRegistry.getAll.useQuery(
    {
      projectId,
      searchString: queryParams.search,
      page: paginationState.pageIndex,
      limit: paginationState.pageSize,
    },
    { enabled: Boolean(projectId), refetchOnWindowFocus: false },
  );

  const deleteModel = api.modelRegistry.delete.useMutation({
    onSuccess: () => utils.modelRegistry.invalidate(),
  });
  const importModels = api.modelRegistry.importFromConnections.useMutation({
    onSuccess: async ({ created, skipped }) => {
      await utils.modelRegistry.invalidate();
      showSuccessToast({
        operation: "modelRegistry.importFromConnections",
        title: "Import complete",
        description: `Added ${created} model${created === 1 ? "" : "s"}${
          skipped > 0 ? `, ${skipped} already registered` : ""
        }.`,
      });
    },
    onError: (error) => reportTrpcErrorWithoutToast(error, "modelRegistry"),
  });

  const data = useMemo<AsyncTableData<RegistryModelRow[]>>(() => {
    if (models.isPending) return { status: "loading" };
    if (models.isError) return { status: "error", error: models.error.message };
    return { status: "success", data: models.data.models };
  }, [models.isPending, models.isError, models.error, models.data]);

  return (
    <Page
      scrollable
      headerProps={{
        title: "Models",
        help: {
          description:
            "The models your project uses, what they can do, and their default parameters. Prompts can reference a model from here.",
          href: "https://langfuse.com/docs/prompt-management/overview",
        },
      }}
    >
      <DialogController<{ model?: RegistryModelRow }>
        renderDialog={({ state, closeDialog }) => (
          <UpsertRegistryModelDialog
            projectId={projectId}
            model={state.model}
            closeDialog={closeDialog}
          />
        )}
      >
        {({ openDialog }) => (
          <ConfirmationDialogController<RegistryModelRow>
            title="Delete model?"
            text="This removes the model from the registry. Pricing and past generations are not affected."
            confirmLabel="Delete model"
            variant="destructive"
            loading={deleteModel.isPending}
            error={deleteModel.error?.message}
            onAfterDismiss={deleteModel.reset}
            onConfirm={async (model) => {
              try {
                await deleteModel.mutateAsync({ projectId, id: model.id });
              } catch (error) {
                reportTrpcErrorWithoutToast(error, "modelRegistry");
                throw error;
              }
            }}
          >
            {({ openDialog: openDeleteDialog }) => (
              <RegistryModelsTable
                data={data}
                pagination={{
                  mode: "offset",
                  totalCount: models.data?.totalCount ?? null,
                  onChange: setPaginationState,
                  state: paginationState,
                }}
                search={{
                  value: queryParams.search,
                  onChange: (search) => setQueryParams({ search }),
                }}
                canEdit={hasWriteAccess}
                onEdit={(model) => openDialog({ model })}
                onDelete={(model) => {
                  deleteModel.reset();
                  openDeleteDialog(model);
                }}
                toolbarActions={[
                  {
                    id: "import-from-connections",
                    label: "Import from connections",
                    variant: "secondary",
                    icon: <Download size="base" />,
                    hasAccess: hasWriteAccess,
                    loading: importModels.isPending,
                    onClick: () => importModels.mutate({ projectId }),
                  },
                  {
                    id: "add-model",
                    label: "Add model",
                    variant: "secondary",
                    icon: <PlusIcon size="base" />,
                    hasAccess: hasWriteAccess,
                    onClick: () => openDialog({}),
                  },
                ]}
              />
            )}
          </ConfirmationDialogController>
        )}
      </DialogController>
    </Page>
  );
}
