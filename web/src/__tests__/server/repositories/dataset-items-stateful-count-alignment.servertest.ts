vi.hoisted(() => {
  // STATEFUL reads with historical rows present (mixed-mode / versioned writes).
  process.env.LANGFUSE_DATASET_SERVICE_READ_FROM_VERSIONED_IMPLEMENTATION =
    "false";
  process.env.LANGFUSE_DATASET_SERVICE_WRITE_TO_VERSIONED_IMPLEMENTATION =
    "false";
});

import { prisma } from "@langfuse/shared/src/db";
import {
  countDatasetItemVariableMatches,
  createDatasetItemFilterState,
  DATASET_INPUT_STATS_SAMPLE_SIZE,
  createOrgProjectAndApiKey,
  getDatasetItemInputStats,
  getDatasetItemsCount,
} from "@langfuse/shared/src/server";
import { v4 } from "uuid";

const projectId = "7a88fb47-b4e2-43b8-a06c-a5ce950dc53a";

describe("STATEFUL getDatasetItemsCount vs countDatasetItemVariableMatches", () => {
  it("excludes superseded and deleted rows from both aggregates", async () => {
    const datasetId = v4();
    await prisma.dataset.create({
      data: { id: datasetId, name: v4(), projectId },
    });

    const currentItemId = v4();
    const supersededItemId = v4();
    const deletedItemId = v4();
    const now = new Date();
    const earlier = new Date(now.getTime() - 60_000);

    // Current ACTIVE row — should count.
    await prisma.datasetItem.create({
      data: {
        id: currentItemId,
        projectId,
        datasetId,
        status: "ACTIVE",
        input: { name: "Ada" },
        expectedOutput: "ok",
        validFrom: now,
        validTo: null,
        isDeleted: false,
      },
    });

    // Superseded historical row for another logical item — must not inflate totals.
    await prisma.datasetItem.create({
      data: {
        id: supersededItemId,
        projectId,
        datasetId,
        status: "ACTIVE",
        input: { name: "Grace" },
        expectedOutput: "ok",
        validFrom: earlier,
        validTo: now,
        isDeleted: false,
      },
    });
    await prisma.datasetItem.create({
      data: {
        id: supersededItemId,
        projectId,
        datasetId,
        status: "ACTIVE",
        input: { name: "Grace", city: "London" },
        expectedOutput: "ok",
        validFrom: now,
        validTo: null,
        isDeleted: false,
      },
    });

    // Soft-deleted current row — must not count.
    await prisma.datasetItem.create({
      data: {
        id: deletedItemId,
        projectId,
        datasetId,
        status: "ACTIVE",
        input: { name: "Deleted" },
        expectedOutput: "ok",
        validFrom: now,
        validTo: null,
        isDeleted: true,
      },
    });

    const filterState = createDatasetItemFilterState({
      datasetIds: [datasetId],
      status: "ACTIVE",
    });

    const [totalItems, variablesMap] = await Promise.all([
      getDatasetItemsCount({ projectId, filterState }),
      countDatasetItemVariableMatches({
        projectId,
        filterState,
        variables: ["name", "city"],
      }),
    ]);

    // Two current non-deleted ACTIVE rows: currentItemId + supersededItemId latest.
    expect(totalItems).toBe(2);
    expect(variablesMap).toEqual({ name: 2, city: 1 });
  });
});

describe("STATEFUL getDatasetItemInputStats", () => {
  it("reports the longest input and the items with media, current rows only", async () => {
    const { project } = await createOrgProjectAndApiKey();
    const projectId = project.id;
    const datasetId = v4();
    await prisma.dataset.create({
      data: { id: datasetId, name: v4(), projectId },
    });
    const now = new Date();
    const earlier = new Date(now.getTime() - 60_000);
    const item = (input: object, extra: object = {}) =>
      prisma.datasetItem.create({
        data: {
          id: v4(),
          projectId,
          datasetId,
          status: "ACTIVE",
          input,
          expectedOutput: "ok",
          validFrom: now,
          validTo: null,
          isDeleted: false,
          ...extra,
        },
      });

    const longText = "x".repeat(500);
    await item({ question: "short" });
    await item({ question: longText });
    await item({
      image: "@@@langfuseMedia:type=image/png|id=abc|source=bytes@@@",
    });
    await item({
      messages: [
        {
          role: "user",
          content: [{ type: "image_url", image_url: { url: "u" } }],
        },
      ],
    });
    // A superseded row with a huge input and media must not count.
    await item(
      { question: "y".repeat(5000), image: "data:image/png;base64,AAAA" },
      { validFrom: earlier, validTo: now },
    );

    const stats = await getDatasetItemInputStats({
      projectId,
      filterState: createDatasetItemFilterState({
        datasetIds: [datasetId],
        status: "ACTIVE",
      }),
    });

    expect(stats).toMatchObject({
      itemsWithMedia: 2,
      scannedItems: 4,
      sampled: false,
    });
    expect(stats?.maxInputChars).toBeGreaterThanOrEqual(longText.length);
    expect(stats?.maxInputChars).toBeLessThan(1000);
  });

  describe("on a dataset larger than the sample", () => {
    // One item more than the sample reads, all of them with media, in one statement.
    const setUp = async () => {
      const { project } = await createOrgProjectAndApiKey();
      const projectId = project.id;
      const datasetId = v4();
      await prisma.dataset.create({
        data: { id: datasetId, name: v4(), projectId },
      });
      await prisma.$executeRaw`
        INSERT INTO dataset_items (id, project_id, dataset_id, status, input, valid_from, is_deleted, created_at, updated_at)
        SELECT gen_random_uuid()::text, ${projectId}, ${datasetId}, 'ACTIVE',
               jsonb_build_object('question', repeat('lorem ipsum ', 150), 'image', 'data:image/png;base64,AAAA'),
               now(), false, now(), now()
        FROM generate_series(1, ${DATASET_INPUT_STATS_SAMPLE_SIZE + 1}) AS n`;
      return {
        projectId,
        filterState: createDatasetItemFilterState({
          datasetIds: [datasetId],
          status: "ACTIVE",
        }),
      };
    };

    it("reads only the sample and says so", async () => {
      const { projectId, filterState } = await setUp();

      const stats = await getDatasetItemInputStats({ projectId, filterState });

      expect(stats).toMatchObject({
        scannedItems: DATASET_INPUT_STATS_SAMPLE_SIZE,
        itemsWithMedia: DATASET_INPUT_STATS_SAMPLE_SIZE,
        sampled: true,
      });
    });

    it("gives up, instead of holding the database, when the statement runs too long", async () => {
      const { projectId, filterState } = await setUp();

      // 1 ms is far below what reading the sample takes.
      const stats = await getDatasetItemInputStats({
        projectId,
        filterState,
        timeoutMs: 1,
      });

      expect(stats).toBeNull();
    });
  });
});
