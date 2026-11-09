import { withMiddlewares } from "@/src/features/public-api/server/withMiddlewares";
import { createAuthedProjectAPIRoute } from "@/src/features/public-api/server/createAuthedProjectAPIRoute";
import {
  GetRegistryModelsV1Query,
  GetRegistryModelsV1Response,
  RegistryModelV1Body,
  RegistryModelV1Response,
} from "@/src/features/public-api/types/registry-models";
import {
  createRegistryModelForApi,
  listRegistryModelsForApi,
} from "@/src/features/model-registry/server/publicApiRegistryModelService";

export default withMiddlewares({
  GET: createAuthedProjectAPIRoute({
    name: "Get registry models",
    action: "models:read",
    isAdminApiKeyAuthAllowed: true,
    querySchema: GetRegistryModelsV1Query,
    responseSchema: GetRegistryModelsV1Response,
    fn: async ({ query, auth }) => {
      return await listRegistryModelsForApi({
        projectId: auth.scope.projectId,
        page: query.page,
        limit: query.limit,
      });
    },
  }),

  POST: createAuthedProjectAPIRoute({
    name: "Create registry model",
    action: "models:CUD",
    isAdminApiKeyAuthAllowed: true,
    bodySchema: RegistryModelV1Body,
    responseSchema: RegistryModelV1Response,
    successStatusCode: 201,
    fn: async ({ body, auth }) => {
      return await createRegistryModelForApi({
        projectId: auth.scope.projectId,
        input: body,
        auditScope: auth.scope,
      });
    },
  }),
});
