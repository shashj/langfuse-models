import { prisma } from "../../../src/db";
import { LLMAdapter, supportedModels } from "../../../src/server/llm/types";
import {
  ScenarioContext,
  ScenarioDefinition,
  SeedError,
  SeedSummary,
} from "./types";

// ---------------------------------------------------------------------------
// Fills the model registry with every model Langfuse lists for its providers,
// so the Models page, the prompt form's model selector, and the playground and
// experiment pre-fill can be tried against a realistic catalogue instead of a
// handful of hand-made rows.
//
// The registry's `provider` is the name of an LLM connection. A model shows as
// "Connected" once a connection with that name exists, so rows are named after
// their adapter ("openai", "anthropic", ...), which is also what a connection
// created with the default name gets. Capabilities, context windows and prices
// are left empty: nothing in the repo states them reliably, and an invented
// value would be worse than a blank one.
//
// Re-running is safe. Rows that already exist, including ones edited by hand,
// are left as they are.
// ---------------------------------------------------------------------------

const ALL_ADAPTERS = Object.values(LLMAdapter);

const adaptersWithModels = () =>
  ALL_ADAPTERS.filter((adapter) => supportedModels[adapter].length > 0);

const parseAdapters = (value: string): LLMAdapter[] => {
  if (value === "all") return adaptersWithModels();

  const requested = value
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  const unknown = requested.filter(
    (name) => !ALL_ADAPTERS.includes(name as LLMAdapter),
  );
  if (unknown.length > 0) {
    throw new SeedError(
      `unknown adapter(s): ${unknown.join(", ")}`,
      `use "all" or a comma-separated list of: ${adaptersWithModels().join(", ")}`,
    );
  }
  return requested as LLMAdapter[];
};

type RegistryRow = {
  projectId: string;
  provider: string;
  modelId: string;
  displayName: string;
};

const plannedRows = (ctx: ScenarioContext, adapters: LLMAdapter[]) => {
  const rows = new Map<string, RegistryRow>();
  for (const adapter of adapters) {
    for (const modelId of supportedModels[adapter]) {
      rows.set(`${adapter}::${modelId}`, {
        projectId: ctx.projectId,
        provider: adapter,
        modelId,
        displayName: modelId,
      });
    }
  }
  return [...rows.values()];
};

const run = async (
  ctx: ScenarioContext,
  params: Record<string, string | number | boolean>,
): Promise<SeedSummary> => {
  const startedAt = Date.now();
  const adapters = parseAdapters(String(params.adapters));
  const rows = plannedRows(ctx, adapters);
  const link = `${ctx.baseUrl}/project/${ctx.projectId}/models`;

  const summary = (
    counts: Record<string, number>,
    verified: Record<string, number>,
    dryRun: boolean,
  ): SeedSummary => ({
    scenario: "registry-models",
    target: "postgres",
    params,
    projectId: ctx.projectId,
    environment: ctx.environment,
    traceIds: [],
    sessionIds: [],
    counts,
    verified,
    links: [link],
    dryRun,
    durationMs: Date.now() - startedAt,
  });

  if (ctx.dryRun) return summary({ registryModels: rows.length }, {}, true);

  const project = await prisma.project.findUnique({
    where: { id: ctx.projectId },
    select: { id: true },
  });
  if (!project) {
    throw new SeedError(
      `project ${ctx.projectId} does not exist`,
      "seed the example data first (pnpm --filter=shared run db:seed:examples) or pass --project <id>",
    );
  }

  ctx.log(`registering ${rows.length} models across ${adapters.join(", ")}`);
  const result = await prisma.registryModel.createMany({
    data: rows,
    skipDuplicates: true,
  });

  const present = await prisma.registryModel.count({
    where: {
      projectId: ctx.projectId,
      OR: adapters.map((adapter) => ({
        provider: adapter,
        modelId: { in: [...supportedModels[adapter]] },
      })),
    },
  });
  if (present < rows.length) {
    throw new SeedError(
      `Readback mismatch: expected ${rows.length} registry models, found ${present}`,
    );
  }

  return summary(
    {
      registryModels: rows.length,
      created: result.count,
      alreadyPresent: rows.length - result.count,
    },
    { registryModels: present },
    false,
  );
};

export const registryModelsScenario: ScenarioDefinition = {
  name: "registry-models",
  description:
    "Registers every model Langfuse lists for its providers (OpenAI, Anthropic, Vertex AI, Google AI Studio, TypeSafe) in the project's model registry, named after their adapter so they show as connected once a connection of that name exists. Existing rows are left untouched, so it is safe to re-run.",
  supportsV4: false,
  flags: [
    {
      flag: "adapters",
      type: "string",
      default: "all",
      description:
        'which providers to register: "all" or a comma-separated list such as "openai,anthropic"',
    },
  ],
  run,
};
