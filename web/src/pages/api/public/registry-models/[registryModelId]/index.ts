import { withMiddlewares } from "@/src/features/public-api/server/withMiddlewares";
import { createAuthedProjectAPIRoute } from "@/src/features/public-api/server/createAuthedProjectAPIRoute";
import {
  DeleteRegistryModelV1Response,
  RegistryModelV1Body,
  RegistryModelV1Query,
  RegistryModelV1Response,
} from "@/src/features/public-api/types/registry-models";
import {
  deleteRegistryModelForApi,
  getRegistryModelForApi,
  replaceRegistryModelForApi,
} from "@/src/features/model-registry/server/publicApiRegistryModelService";

export default withMiddlewares({
  GET: createAuthedProjectAPIRoute({
    name: "Get registry model",
    action: "models:read",
    isAdminApiKeyAuthAllowed: true,
    querySchema: RegistryModelV1Query,
    responseSchema: RegistryModelV1Response,
    fn: async ({ query, auth }) => {
      return await getRegistryModelForApi({
        projectId: auth.scope.projectId,
        registryModelId: query.registryModelId,
      });
    },
  }),

  PUT: createAuthedProjectAPIRoute({
    name: "Replace registry model",
    action: "models:CUD",
    isAdminApiKeyAuthAllowed: true,
    querySchema: RegistryModelV1Query,
    bodySchema: RegistryModelV1Body,
    responseSchema: RegistryModelV1Response,
    fn: async ({ query, body, auth }) => {
      return await replaceRegistryModelForApi({
        projectId: auth.scope.projectId,
        registryModelId: query.registryModelId,
        input: body,
        auditScope: auth.scope,
      });
    },
  }),

  DELETE: createAuthedProjectAPIRoute({
    name: "Delete registry model",
    action: "models:CUD",
    isAdminApiKeyAuthAllowed: true,
    querySchema: RegistryModelV1Query,
    responseSchema: DeleteRegistryModelV1Response,
    fn: async ({ query, auth }) => {
      return await deleteRegistryModelForApi({
        registryModelId: query.registryModelId,
        ...auth.scope,
      });
    },
  }),
});
