import { prisma } from "../../../src/db";
import {
  calculateModelUsageCosts,
  createEventsCh,
  createObservation,
  createObservationsCh,
  createTrace,
  createTracesCh,
  findModel,
  EventRecordInsertType,
  ObservationRecordInsertType,
  TraceRecordInsertType,
} from "../../../src/server";
import type { ModelWithPrices } from "../../../src/server";
import { observationToEvent, traceToEvent } from "./event-mirror";
import { jitter, utcDayStartMs } from "./rng";
import {
  chunk,
  ScenarioContext,
  ScenarioDefinition,
  SeedError,
  SeedSummary,
} from "./types";
import { countRows, escapeLike, traceLink } from "./verify";

// ---------------------------------------------------------------------------
// Five hand-written prompts on five different models, with hand-written input
// contexts and outputs, repeated into N traces. No model provider is called:
// every text below was written by a person for this file.
//
// It exists to exercise the model registry against traces:
//  - each prompt has a registry model linked to a Langfuse-managed pricing
//    definition, so the Models page can show usage per entry;
//  - generations get their pricing link and cost from the same matching and
//    cost code ingestion uses (`findModel`, `calculateModelUsageCosts`);
//  - a share of traces runs on another model than the prompt version names
//    (the "prompt expects" link), on a dated snapshot name of the same model,
//    on a name no definition matches, or on prompt version 1 (which names no
//    model at all).
//
// Token counts are hand-set per case to stand for the full document, not
// counted from the excerpt shown.
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;
const UNMATCHED_MODEL_NAME = "acme-internal-llm-v2";

type Message = { role: "system" | "user"; content: string };

type Case = {
  key: string;
  variables: Record<string, string>;
  output: string;
  inputTokens: number;
  outputTokens: number;
};

type PromptDef = {
  name: string;
  type: "chat" | "text";
  /** chat: the system message, then the user message; text: one template */
  template: string | Message[];
  /** Pricing definition name, also the model name generations report. */
  model: string;
  registryProvider: string;
  registryDisplayName: string;
  modelParams: { temperature?: number; max_tokens?: number };
  /** Another model a run can fall back to. */
  fallbackModel: string;
  /** A dated name of `model` that should match the same pricing definition. */
  snapshotModel?: string;
  retrievalQuery: (variables: Record<string, string>) => string;
  cases: Case[];
};

const PROMPTS: PromptDef[] = [
  {
    name: "support-triage",
    type: "chat",
    template: [
      {
        role: "system",
        content:
          "You triage customer support tickets for Northwind Cloud. Reply with one line in the form `category | priority | one-sentence summary`. Categories: billing, outage, feature-request, account-access. Priorities: low, medium, high.",
      },
      {
        role: "user",
        content:
          "Ticket from {{customer}} ({{plan}} plan):\n{{ticket}}\n\nAccount notes:\n{{context}}",
      },
    ],
    model: "gpt-4o-mini",
    registryProvider: "openai",
    registryDisplayName: "GPT-4o mini",
    modelParams: { temperature: 0, max_tokens: 120 },
    fallbackModel: "gpt-4o",
    snapshotModel: "gpt-4o-mini-2024-07-18",
    retrievalQuery: (v) => `account notes for ${v.customer}`,
    cases: [
      {
        key: "billing-dispute",
        variables: {
          customer: "Dana Whitfield",
          plan: "Team",
          ticket:
            "I was charged twice for November, 480 USD each time. Please refund the duplicate.",
          context:
            "Invoices INV-20418 and INV-20431 were both issued on 2026-11-03 for the Team plan. The payment processor shows two successful charges.",
        },
        output:
          "billing | high | Customer was charged twice for November and wants the duplicate 480 USD charge refunded.",
        inputTokens: 236,
        outputTokens: 31,
      },
      {
        key: "outage-report",
        variables: {
          customer: "Priya Raman",
          plan: "Enterprise",
          ticket:
            "Our dashboards have returned 502 errors since 09:10 UTC and our on-call team cannot reach the API.",
          context:
            "The status page shows a partial incident in eu-west-1 opened at 09:04 UTC. This customer's workspace is hosted in eu-west-1.",
        },
        output:
          "outage | high | Enterprise customer in eu-west-1 is getting 502 errors, matching the open regional incident.",
        inputTokens: 229,
        outputTokens: 30,
      },
      {
        key: "feature-request",
        variables: {
          customer: "Tom Becker",
          plan: "Starter",
          ticket:
            "It would be great to export the audit log as CSV instead of only PDF.",
          context:
            "Audit log export is PDF only. CSV export is on the public roadmap for next quarter.",
        },
        output:
          "feature-request | low | Customer asks for a CSV export of the audit log, which is already on the roadmap.",
        inputTokens: 201,
        outputTokens: 28,
      },
      {
        key: "password-reset",
        variables: {
          customer: "Lena Okafor",
          plan: "Team",
          ticket:
            "I changed phones and my authenticator codes no longer work, so I am locked out.",
          context:
            "Two-factor is enforced for this workspace. The workspace admin is m.alvarez@lenaco.example. An identity check is required before a factor is reset.",
        },
        output:
          "account-access | medium | User lost their authenticator after a phone change and needs a two-factor reset after an identity check.",
        inputTokens: 244,
        outputTokens: 34,
      },
    ],
  },
  {
    name: "contract-summary",
    type: "text",
    template:
      "Summarise the contract below for a non-lawyer in at most five bullet points. Flag any clause that auto-renews, limits liability, or restricts the signer after the contract ends.\n\nContract type: {{contract_type}}\n\nContract excerpt:\n{{contract_text}}\n\nCompany playbook notes:\n{{context}}",
    model: "claude-sonnet-4-5-20250929",
    registryProvider: "anthropic",
    registryDisplayName: "Claude Sonnet 4.5",
    modelParams: { temperature: 0.2, max_tokens: 1024 },
    fallbackModel: "claude-haiku-4-5-20251001",
    retrievalQuery: (v) => `playbook for ${v.contract_type}`,
    cases: [
      {
        key: "mutual-nda",
        variables: {
          contract_type: "Mutual non-disclosure agreement",
          contract_text:
            "Each party may disclose confidential information to the other for the purpose of evaluating a possible partnership. The receiving party must protect it with the same care it uses for its own and must not use it for any other purpose. These duties last for three years from the date of the last disclosure. Residual knowledge retained in unaided memory is not restricted.",
          context:
            "Our standard is two years of confidentiality. Anything longer than three needs legal sign-off. Residuals clauses are not accepted.",
        },
        output:
          "- Both sides share confidential information only to evaluate the partnership.\n- The receiver must protect it as carefully as its own and use it for nothing else.\n- Confidentiality lasts three years after the last disclosure, one year longer than our two-year standard.\n- FLAG: a residuals clause lets people reuse what they remember, which our playbook does not accept.\n- Next step: ask legal to review the three-year term and remove the residuals clause.",
        inputTokens: 1840,
        outputTokens: 142,
      },
      {
        key: "saas-agreement",
        variables: {
          contract_type: "Software as a service agreement",
          contract_text:
            "The subscription term is twelve months and renews automatically for successive twelve-month terms unless either party gives written notice at least sixty days before the end of the current term. The provider's total liability is limited to the fees paid in the twelve months before the claim. Fees increase by up to seven percent at each renewal.",
          context:
            "Auto-renewal notice windows over thirty days must be escalated. Our approved liability cap is twenty-four months of fees. Price increases above five percent need finance approval.",
        },
        output:
          "- One-year subscription that renews automatically every year.\n- FLAG: cancelling needs written notice sixty days before the term ends, double our thirty-day limit.\n- FLAG: the provider's liability is capped at twelve months of fees, half of the twenty-four months we approve.\n- FLAG: fees can rise up to seven percent at each renewal, above the five percent that needs no finance approval.\n- Next step: escalate the notice window and the price clause before signing.",
        inputTokens: 2410,
        outputTokens: 151,
      },
      {
        key: "office-lease",
        variables: {
          contract_type: "Commercial office lease",
          contract_text:
            "The lease runs for thirty-six months from the commencement date. Base rent increases three percent each year. The tenant may end the lease early after month eighteen by paying a fee equal to three months of rent and giving ninety days' notice. The tenant must restore the premises to their original condition at the end of the lease.",
          context:
            "We prefer break options at month twelve. Restoration clauses must name a cost cap or be escalated.",
        },
        output:
          "- Three-year lease with rent rising three percent each year.\n- Early exit is possible after month eighteen for a fee of three months' rent and ninety days' notice.\n- FLAG: the break option starts at month eighteen, later than the month twelve we prefer.\n- FLAG: restoring the premises has no cost cap, so the end-of-lease bill is open-ended.\n- Next step: negotiate an earlier break and a restoration cap.",
        inputTokens: 2975,
        outputTokens: 133,
      },
      {
        key: "employment-offer",
        variables: {
          contract_type: "Employment offer letter",
          contract_text:
            "The role is full time with a base salary of 96,000 EUR per year. Either side may end the employment with ninety days' written notice. For twelve months after the employment ends, the employee may not work for a direct competitor in the same country. Inventions made during employment belong to the company.",
          context:
            "Non-compete clauses are only enforceable here when compensated. Standard notice is sixty days.",
        },
        output:
          "- Full-time role at 96,000 EUR a year.\n- Either side needs ninety days' written notice to end it, thirty days more than our standard sixty.\n- FLAG: a twelve-month non-compete bars work for a direct competitor in the same country after leaving.\n- The letter does not mention compensation for the non-compete, which our playbook says is needed for it to be enforceable.\n- Inventions made during employment belong to the company.",
        inputTokens: 1695,
        outputTokens: 128,
      },
    ],
  },
  {
    name: "sql-assistant",
    type: "chat",
    template: [
      {
        role: "system",
        content:
          "You write PostgreSQL for the analytics warehouse. Use only the tables and columns in the schema. Return one SQL query in a fenced block, then one sentence explaining it.",
      },
      {
        role: "user",
        content: "Question: {{question}}\n\nSchema:\n{{context}}",
      },
    ],
    model: "gpt-4.1",
    registryProvider: "openai",
    registryDisplayName: "GPT-4.1",
    modelParams: { temperature: 0, max_tokens: 400 },
    fallbackModel: "gpt-4o-mini",
    snapshotModel: "gpt-4.1-2025-04-14",
    retrievalQuery: (v) => `warehouse schema for: ${v.question}`,
    cases: [
      {
        key: "revenue-by-month",
        variables: {
          question: "What was our revenue per month in 2026?",
          context:
            "orders(id, user_id, created_at timestamptz, total_cents integer, status text)\nStatus values: paid, refunded, pending.",
        },
        output:
          "```sql\nSELECT date_trunc('month', created_at) AS month,\n       sum(total_cents) / 100.0 AS revenue\nFROM orders\nWHERE status = 'paid'\n  AND created_at >= '2026-01-01'\n  AND created_at < '2027-01-01'\nGROUP BY 1\nORDER BY 1;\n```\nThis sums paid orders by calendar month for 2026 and converts cents to currency units.",
        inputTokens: 318,
        outputTokens: 92,
      },
      {
        key: "churned-users",
        variables: {
          question: "How many subscribers cancelled in the last 30 days?",
          context:
            "subscriptions(id, user_id, plan text, started_at timestamptz, canceled_at timestamptz null)",
        },
        output:
          "```sql\nSELECT count(DISTINCT user_id) AS cancelled_users\nFROM subscriptions\nWHERE canceled_at >= now() - interval '30 days';\n```\nThis counts distinct users whose subscription has a cancellation time within the last 30 days.",
        inputTokens: 276,
        outputTokens: 68,
      },
      {
        key: "top-products",
        variables: {
          question: "Which five products sold the most units last quarter?",
          context:
            "products(id, name text)\norder_items(id, order_id, product_id, quantity integer)\norders(id, created_at timestamptz, status text)",
        },
        output:
          "```sql\nSELECT p.name, sum(oi.quantity) AS units\nFROM order_items oi\nJOIN orders o ON o.id = oi.order_id\nJOIN products p ON p.id = oi.product_id\nWHERE o.status = 'paid'\n  AND o.created_at >= date_trunc('quarter', now()) - interval '3 months'\n  AND o.created_at < date_trunc('quarter', now())\nGROUP BY p.name\nORDER BY units DESC\nLIMIT 5;\n```\nThis totals units from paid orders in the previous calendar quarter and keeps the top five.",
        inputTokens: 352,
        outputTokens: 118,
      },
      {
        key: "slow-query",
        variables: {
          question:
            "This query takes 14 seconds. How can I make it faster? SELECT * FROM events WHERE user_id = 4812 ORDER BY created_at DESC LIMIT 50;",
          context:
            "events(id, user_id integer, name text, created_at timestamptz) with 180 million rows\nIndexes: primary key on id only\nEXPLAIN shows a sequential scan followed by a sort.",
        },
        output:
          "```sql\nCREATE INDEX CONCURRENTLY events_user_id_created_at_idx\n  ON events (user_id, created_at DESC);\n```\nThe query filters by user and sorts by time, so a composite index on those columns lets Postgres read the newest 50 rows without scanning the table.",
        inputTokens: 391,
        outputTokens: 74,
      },
    ],
  },
  {
    name: "product-description",
    type: "text",
    template:
      "Write a product description of at most 60 words for the {{category}} listing below. Match the brand voice: {{voice}}. Use only the facts provided.\n\nProduct facts:\n{{context}}",
    model: "gemini-2.5-flash",
    registryProvider: "google-ai-studio",
    registryDisplayName: "Gemini 2.5 Flash",
    modelParams: { temperature: 0.8, max_tokens: 200 },
    fallbackModel: "gemini-2.0-flash",
    retrievalQuery: (v) => `catalogue facts for the ${v.category}`,
    cases: [
      {
        key: "daypack",
        variables: {
          category: "backpack",
          voice: "practical and friendly",
          context:
            "Trailhead 22L daypack. Recycled ripstop nylon. 15-inch laptop sleeve. Padded back panel. Weighs 640 g. Two side bottle pockets. Lifetime repair service.",
        },
        output:
          "Meet the Trailhead 22L daypack, built for ordinary days and the occasional hike. Recycled ripstop nylon keeps it light at 640 g, while the padded back panel stays comfortable. It fits a 15-inch laptop and two bottles, and our lifetime repair service means it keeps going.",
        inputTokens: 148,
        outputTokens: 62,
      },
      {
        key: "kettle",
        variables: {
          category: "kitchen appliance",
          voice: "warm and understated",
          context:
            "Alder 1.7L electric kettle. Stainless steel body. Five temperature presets. Keeps water warm for 30 minutes. Boils 1 litre in about 3 minutes. Auto shut-off.",
        },
        output:
          "The Alder 1.7L kettle makes a good cup without fuss. Choose from five temperature presets, boil a litre in about three minutes, and keep the water warm for half an hour. The stainless steel body is easy to clean, and it switches itself off when you forget.",
        inputTokens: 141,
        outputTokens: 58,
      },
      {
        key: "headphones",
        variables: {
          category: "audio",
          voice: "confident and concise",
          context:
            "Kestrel Q2 wireless headphones. Active noise cancelling. 38 hours of battery with cancelling on. USB-C charging with a 10-minute charge for 5 hours of playback. Bluetooth 5.3. Foldable.",
        },
        output:
          "Kestrel Q2 headphones cancel the noise and keep going: 38 hours of battery, or 5 hours from a 10-minute USB-C charge. Bluetooth 5.3 keeps the connection steady, and they fold flat for your bag. Press play and disappear.",
        inputTokens: 152,
        outputTokens: 49,
      },
      {
        key: "running-shoes",
        variables: {
          category: "footwear",
          voice: "energetic",
          context:
            "Strider Lite running shoe. 238 g in a men's size 9. 8 mm drop. Engineered mesh upper. Foam midsole made with 30 percent bio-based content. Reflective heel tab.",
        },
        output:
          "Light up your morning run with the Strider Lite. At 238 g with an 8 mm drop, it feels quick from the first stride. The engineered mesh upper breathes, the foam midsole is 30 percent bio-based, and the reflective heel tab keeps you seen on early starts.",
        inputTokens: 139,
        outputTokens: 56,
      },
    ],
  },
  {
    name: "code-review",
    type: "chat",
    template: [
      {
        role: "system",
        content:
          "You are a senior engineer reviewing a diff. List each defect with its severity (low, medium, high) and a one-line fix. If there is no defect, say so.",
      },
      {
        role: "user",
        content:
          "Language: {{language}}\n\nDiff:\n{{diff}}\n\nProject conventions:\n{{context}}",
      },
    ],
    model: "o3-mini",
    registryProvider: "openai",
    registryDisplayName: "o3-mini",
    modelParams: { max_tokens: 2000 },
    fallbackModel: "gpt-4.1",
    snapshotModel: "o3-mini-2025-01-31",
    retrievalQuery: (v) => `conventions for ${v.language}`,
    cases: [
      {
        key: "off-by-one",
        variables: {
          language: "Python",
          diff: "+for i in range(len(items) - 1):\n+    total += items[i].price",
          context:
            "The function is meant to total the price of every item in the cart.",
        },
        output:
          "- high: the loop stops one item early because of `len(items) - 1`, so the last item is never added. Fix: iterate with `for item in items: total += item.price`.",
        inputTokens: 262,
        outputTokens: 508,
      },
      {
        key: "sql-injection",
        variables: {
          language: "JavaScript",
          diff: '+const rows = await db.query(\n+  "SELECT * FROM users WHERE email = \'" + req.query.email + "\'"\n+);',
          context:
            "Database access goes through node-postgres. Queries must use parameters.",
        },
        output:
          "- high: the email from the query string is concatenated into the SQL, which allows SQL injection. Fix: use `db.query('SELECT * FROM users WHERE email = $1', [req.query.email])`.\n- low: `SELECT *` returns every column. Fix: select only the columns the handler uses.",
        inputTokens: 281,
        outputTokens: 612,
      },
      {
        key: "race-condition",
        variables: {
          language: "Go",
          diff: '+var hits int\n+func handler(w http.ResponseWriter, r *http.Request) {\n+    hits++\n+    fmt.Fprintf(w, "%d", hits)\n+}',
          context:
            "The HTTP server handles requests on many goroutines at once.",
        },
        output:
          "- high: `hits` is incremented from many goroutines without synchronisation, which is a data race. Fix: use `atomic.AddInt64` on an `int64`, or guard the counter with a mutex.",
        inputTokens: 274,
        outputTokens: 566,
      },
      {
        key: "n-plus-one",
        variables: {
          language: "Ruby",
          diff: "+@users = User.where(active: true)\n+@users.each do |user|\n+  puts user.posts.count\n+end",
          context:
            "This runs in a Rails controller that renders an admin page.",
        },
        output:
          "- medium: `user.posts.count` runs one query per user, an N+1 pattern. Fix: preload with `User.where(active: true).includes(:posts)` or use `left_joins(:posts).group('users.id').count`.",
        inputTokens: 268,
        outputTokens: 531,
      },
    ],
  },
];

type Shape = "own" | "fallback" | "snapshot" | "unmatched";

const SHAPE_FALLBACK_BELOW = 8;
const SHAPE_SNAPSHOT_BELOW = 15;
const SHAPE_UNMATCHED_BELOW = 18;
const VERSION_ONE_BELOW = 15;

const render = (template: string, variables: Record<string, string>) =>
  template.replace(
    /\{\{(\w+)\}\}/g,
    (match, name: string) => variables[name] ?? match,
  );

const renderMessages = (
  template: Message[],
  variables: Record<string, string>,
): Message[] =>
  template.map((message) => ({
    role: message.role,
    content: render(message.content, variables),
  }));

type PlannedTrace = {
  index: number;
  prompt: PromptDef;
  caseDef: Case;
  version: 1 | 2;
  shape: Shape;
  modelName: string;
};

const planTraces = (ctx: ScenarioContext, traces: number): PlannedTrace[] =>
  Array.from({ length: traces }, (_, index) => {
    const prompt = PROMPTS[index % PROMPTS.length];
    const caseDef =
      prompt.cases[Math.floor(index / PROMPTS.length) % prompt.cases.length];
    const version: 1 | 2 =
      jitter(ctx.seed, index * 7 + 2, 99) < VERSION_ONE_BELOW ? 1 : 2;
    const roll = jitter(ctx.seed, index * 7 + 1, 99);

    let shape: Shape = "own";
    if (version === 2) {
      if (roll < SHAPE_FALLBACK_BELOW) shape = "fallback";
      else if (roll < SHAPE_SNAPSHOT_BELOW && prompt.snapshotModel)
        shape = "snapshot";
      else if (roll >= SHAPE_SNAPSHOT_BELOW && roll < SHAPE_UNMATCHED_BELOW)
        shape = "unmatched";
    }

    const modelName = {
      own: prompt.model,
      fallback: prompt.fallbackModel,
      snapshot: prompt.snapshotModel ?? prompt.model,
      unmatched: UNMATCHED_MODEL_NAME,
    }[shape];

    return { index, prompt, caseDef, version, shape, modelName };
  });

const parseCount = (
  value: string | number | boolean,
  name: string,
  max: number,
) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) {
    throw new SeedError(
      `--${name} must be an integer between 1 and ${max}, got ${String(value)}`,
    );
  }
  return parsed;
};

const run = async (
  ctx: ScenarioContext,
  params: Record<string, string | number | boolean>,
): Promise<SeedSummary> => {
  const startedAt = Date.now();
  const traceCount = parseCount(params.traces, "traces", 50_000);
  const days = parseCount(params.days, "days", 90);
  const withV4 = params.v4 === true;
  const plan = planTraces(ctx, traceCount);
  const shapeCounts = plan.reduce<Record<string, number>>((acc, item) => {
    const key = item.version === 1 ? "promptVersion1" : item.shape;
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  const links = [
    `${ctx.baseUrl}/project/${ctx.projectId}/models`,
    `${ctx.baseUrl}/project/${ctx.projectId}/prompts`,
    `${ctx.baseUrl}/project/${ctx.projectId}/${withV4 ? "traces" : "observations"}`,
  ];
  const summary = (
    counts: Record<string, number>,
    verified: Record<string, number>,
    traceIds: string[],
    dryRun: boolean,
  ): SeedSummary => ({
    scenario: "registry-traces",
    target: "clickhouse",
    params,
    projectId: ctx.projectId,
    environment: ctx.environment,
    traceIds,
    sessionIds: [],
    counts,
    verified,
    links,
    dryRun,
    durationMs: Date.now() - startedAt,
  });

  const plannedCounts = {
    prompts: PROMPTS.length * 2,
    registryModels: PROMPTS.length,
    traces: traceCount,
    observations: traceCount * 2,
    events: withV4 ? traceCount * 3 : 0,
    ...shapeCounts,
  };
  if (ctx.dryRun) return summary(plannedCounts, {}, [], true);

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

  // Resolve every model name a generation can report through the same matcher
  // ingestion uses, so internal_model_id and cost agree with real data.
  const modelNames = [
    ...new Set(plan.map((item) => item.modelName)),
    ...PROMPTS.map((prompt) => prompt.model),
  ];
  const resolved = new Map<string, ModelWithPrices>();
  for (const modelName of modelNames) {
    resolved.set(
      modelName,
      await findModel({ projectId: ctx.projectId, model: modelName }),
    );
  }
  const missing = PROMPTS.filter(
    (prompt) => !resolved.get(prompt.model)?.model,
  ).map((prompt) => prompt.model);
  if (missing.length > 0) {
    throw new SeedError(
      `no pricing definition matches: ${missing.join(", ")}`,
      "the Langfuse-managed model definitions are missing; run the standard seed (pnpm --filter=shared run db:seed:examples) so they exist",
    );
  }

  ctx.log(
    `registering ${PROMPTS.length} registry models and ${PROMPTS.length * 2} prompt versions`,
  );
  const registryIds = new Map<string, string>();
  for (const prompt of PROMPTS) {
    const pricingModelId = resolved.get(prompt.model)?.model?.id ?? null;
    const row = await prisma.registryModel.upsert({
      where: {
        projectId_provider_modelId: {
          projectId: ctx.projectId,
          provider: prompt.registryProvider,
          modelId: prompt.model,
        },
      },
      create: {
        projectId: ctx.projectId,
        provider: prompt.registryProvider,
        modelId: prompt.model,
        displayName: prompt.registryDisplayName,
        pricingModelId,
      },
      update: { pricingModelId },
    });
    registryIds.set(prompt.name, row.id);
  }

  const promptRows = new Map<string, { id: string }>();
  for (const prompt of PROMPTS) {
    const body =
      prompt.type === "chat"
        ? (prompt.template as Message[]).map((message) => ({
            type: "chatmessage",
            role: message.role,
            content: message.content,
          }))
        : (prompt.template as string);
    for (const version of [1, 2] as const) {
      const data = {
        prompt: body,
        type: prompt.type,
        config: {},
        tags: ["seed", "registry-traces"],
        labels: version === 2 ? ["production", "latest"] : [],
        commitMessage:
          version === 1
            ? "First version, no model attached"
            : "Attach the registry model",
        registryModelId: version === 2 ? registryIds.get(prompt.name) : null,
        modelParams: version === 2 ? prompt.modelParams : undefined,
      };
      const row = await prisma.prompt.upsert({
        where: {
          projectId_name_version: {
            projectId: ctx.projectId,
            name: prompt.name,
            version,
          },
        },
        create: {
          ...data,
          projectId: ctx.projectId,
          name: prompt.name,
          version,
          createdBy: "seed",
        },
        update: data,
      });
      promptRows.set(`${prompt.name}:${version}`, row);
    }
  }

  const anchor = utcDayStartMs();
  const traces: TraceRecordInsertType[] = [];
  const observations: ObservationRecordInsertType[] = [];
  const events: EventRecordInsertType[] = [];
  const traceIds: string[] = [];
  const traceStarts: number[] = [];
  const tally = { snapshotSamePricing: 0, snapshotOtherPricing: 0 };

  for (const item of plan) {
    const { index, prompt, caseDef, version, shape, modelName } = item;
    const traceId = `${ctx.idPrefix}-t${index}`;
    traceIds.push(traceId);

    const traceStart =
      anchor -
      ((index % days) + 1) * DAY_MS +
      jitter(ctx.seed, index * 7 + 3, DAY_MS - 1);
    traceStarts.push(traceStart);
    const contextSpanMs = 80 + jitter(ctx.seed, index * 7 + 6, 220);
    const generationStart = traceStart + contextSpanMs + 20;
    const inputTokens =
      caseDef.inputTokens +
      jitter(ctx.seed, index * 7 + 5, Math.round(caseDef.inputTokens * 0.1)) -
      Math.round(caseDef.inputTokens * 0.05);
    const outputTokens =
      caseDef.outputTokens +
      jitter(ctx.seed, index * 7 + 8, Math.round(caseDef.outputTokens * 0.1)) -
      Math.round(caseDef.outputTokens * 0.05);
    const generationMs =
      500 + outputTokens * 18 + jitter(ctx.seed, index * 7 + 4, 1200);
    const firstTokenMs = 150 + jitter(ctx.seed, index * 7 + 9, 450);

    const messages =
      prompt.type === "chat"
        ? renderMessages(prompt.template as Message[], caseDef.variables)
        : null;
    const filledText =
      prompt.type === "text"
        ? render(prompt.template as string, caseDef.variables)
        : null;
    const generationInput = JSON.stringify(
      messages ?? [{ role: "user", content: filledText }],
    );

    const usage = {
      input: inputTokens,
      output: outputTokens,
      total: inputTokens + outputTokens,
    };
    const matched = resolved.get(modelName) ?? {
      model: null,
      pricingTiers: [],
    };
    const costs = calculateModelUsageCosts({
      model: matched,
      usageDetails: usage,
      attributes: { modelParameters: JSON.stringify(prompt.modelParams) },
    });
    if (shape === "snapshot") {
      if (matched.model?.id === resolved.get(prompt.model)?.model?.id) {
        tally.snapshotSamePricing += 1;
      } else {
        tally.snapshotOtherPricing += 1;
      }
    }

    const trace = createTrace({
      id: traceId,
      project_id: ctx.projectId,
      environment: ctx.environment,
      session_id: `${ctx.idPrefix}-session-${Math.floor(index / 4)}`,
      timestamp: traceStart,
      name: prompt.name,
      user_id: `user-${jitter(ctx.seed, index * 7 + 10, 39)}`,
      tags: ["seed", "registry-traces", prompt.name],
      public: false,
      bookmarked: false,
      release: null,
      version: null,
      metadata: {
        scenario: "registry-traces",
        prompt: prompt.name,
        case: caseDef.key,
      },
      input: JSON.stringify(caseDef.variables),
      output: caseDef.output,
      created_at: Date.now(),
      updated_at: Date.now(),
      event_ts: Date.now(),
    });
    traces.push(trace);

    const promptRow = promptRows.get(`${prompt.name}:${version}`);
    const retrieval = createObservation({
      id: `${traceId}-ctx`,
      trace_id: traceId,
      project_id: ctx.projectId,
      environment: ctx.environment,
      type: "SPAN",
      parent_observation_id: null,
      name: "retrieve-context",
      start_time: traceStart,
      end_time: traceStart + contextSpanMs,
      completion_start_time: null,
      level: "DEFAULT",
      status_message: null,
      input: JSON.stringify({
        query: prompt.retrievalQuery(caseDef.variables),
      }),
      output: JSON.stringify({ context: caseDef.variables.context }),
      provided_model_name: null,
      internal_model_id: null,
      usage_pricing_tier_id: null,
      usage_pricing_tier_name: null,
      provided_usage_details: {},
      usage_details: {},
      provided_cost_details: {},
      cost_details: {},
      total_cost: null,
      model_parameters: null,
      prompt_id: null,
      prompt_name: null,
      prompt_version: null,
      created_at: Date.now(),
      updated_at: Date.now(),
      event_ts: Date.now(),
    });
    const generation = createObservation({
      id: `${traceId}-gen`,
      trace_id: traceId,
      project_id: ctx.projectId,
      environment: ctx.environment,
      type: "GENERATION",
      parent_observation_id: null,
      name: `${prompt.name}-generation`,
      start_time: generationStart,
      end_time: generationStart + generationMs,
      completion_start_time: generationStart + firstTokenMs,
      level: "DEFAULT",
      status_message: null,
      input: generationInput,
      output: caseDef.output,
      provided_model_name: modelName,
      internal_model_id: costs.internal_model_id ?? null,
      usage_pricing_tier_id: costs.usage_pricing_tier_id,
      usage_pricing_tier_name: costs.usage_pricing_tier_name,
      provided_usage_details: usage,
      usage_details: usage,
      provided_cost_details: {},
      cost_details: costs.cost_details,
      total_cost: costs.total_cost ?? null,
      model_parameters: JSON.stringify(prompt.modelParams),
      prompt_id: promptRow?.id ?? null,
      prompt_name: prompt.name,
      prompt_version: version,
      created_at: Date.now(),
      updated_at: Date.now(),
      event_ts: Date.now(),
    });
    observations.push(retrieval, generation);

    if (withV4) {
      events.push(
        traceToEvent(trace),
        observationToEvent(retrieval, trace),
        observationToEvent(generation, trace),
      );
    }
  }

  ctx.log(
    `writing ${traces.length} traces, ${observations.length} observations${withV4 ? `, ${events.length} events` : ""}`,
  );
  for (const batch of chunk(traces, 500)) await createTracesCh(batch);
  for (const batch of chunk(observations, 1000))
    await createObservationsCh(batch);
  for (const batch of chunk(events, 500)) await createEventsCh(batch);

  const idPattern = `${escapeLike(ctx.idPrefix)}-t%`;
  const verified: Record<string, number> = {
    prompts: await prisma.prompt.count({
      where: {
        projectId: ctx.projectId,
        name: { in: PROMPTS.map((prompt) => prompt.name) },
      },
    }),
    registryModels: await prisma.registryModel.count({
      where: {
        projectId: ctx.projectId,
        id: { in: [...registryIds.values()] },
        pricingModelId: { not: null },
      },
    }),
    traces: await countRows(
      "traces",
      `project_id = {projectId: String} AND id LIKE {pattern: String}`,
      { projectId: ctx.projectId, pattern: idPattern },
      "uniqExact(id)",
    ),
    observations: await countRows(
      "observations",
      `project_id = {projectId: String} AND trace_id LIKE {pattern: String}`,
      { projectId: ctx.projectId, pattern: idPattern },
      "uniqExact(id)",
    ),
  };
  if (withV4) {
    verified.events = await countRows(
      "events_full",
      `project_id = {projectId: String} AND trace_id LIKE {pattern: String}`,
      { projectId: ctx.projectId, pattern: idPattern },
      "uniqExact(span_id)",
    );
  }

  if (verified.prompts < PROMPTS.length * 2) {
    throw new SeedError(
      `Readback mismatch: expected ${PROMPTS.length * 2} prompt versions, found ${verified.prompts}`,
    );
  }
  if (verified.registryModels < PROMPTS.length) {
    throw new SeedError(
      `Readback mismatch: expected ${PROMPTS.length} pricing-linked registry models, found ${verified.registryModels}`,
    );
  }
  if (verified.traces < traces.length) {
    throw new SeedError(
      `Readback mismatch: expected ${traces.length} traces, found ${verified.traces}`,
    );
  }
  if (verified.observations < observations.length) {
    throw new SeedError(
      `Readback mismatch: expected ${observations.length} observations, found ${verified.observations}`,
    );
  }
  if (withV4 && verified.events < events.length) {
    throw new SeedError(
      `Readback mismatch: expected ${events.length} events_full rows, found ${verified.events}`,
    );
  }

  const sampleLinks = plan
    .filter((item) => item.shape !== "own" || item.version === 1)
    .slice(0, 3)
    .map((item) =>
      traceLink(ctx, `${ctx.idPrefix}-t${item.index}`, traceStarts[item.index]),
    );
  return {
    ...summary({ ...plannedCounts, ...tally }, verified, traceIds, false),
    links: [...links, ...sampleLinks],
  };
};

export const registryTracesScenario: ScenarioDefinition = {
  name: "registry-traces",
  description:
    "Five hand-written prompts on five different models (each with a registry model linked to a managed pricing definition) and 1000 traces of hand-written inputs and outputs, with no model calls. A share of traces runs on another model than the prompt names, on a dated snapshot name, on a name no definition matches, or on prompt version 1, so the Models page usage, the trace model link and the prompt-expects link all have data.",
  supportsV4: true,
  flags: [
    {
      flag: "traces",
      type: "number",
      default: 1000,
      description: "number of traces to write (1 to 50000)",
    },
    {
      flag: "days",
      type: "number",
      default: 14,
      description: "spread the traces over this many past days (1 to 90)",
    },
    {
      flag: "v4",
      type: "boolean",
      default: false,
      description:
        "also mirror traces/observations into v4 events_full/events_core",
    },
  ],
  run,
};
