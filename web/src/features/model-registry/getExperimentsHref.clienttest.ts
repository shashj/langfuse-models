import { describe, expect, it } from "vitest";
import { decodeFiltersGeneric } from "@langfuse/shared";

import { getRegistryModelExperimentsHref } from "@/src/features/model-registry/getExperimentsHref";

// The page reads the query parameter once, then decodes the filter format.
const filtersIn = (href: string) =>
  decodeFiltersGeneric(
    new URL(href, "http://localhost").searchParams.get("filter") ?? "",
  );

describe("getRegistryModelExperimentsHref", () => {
  it("filters the experiments page on the run's provider and model", () => {
    const href = getRegistryModelExperimentsHref({
      projectId: "project-1",
      provider: "openai",
      modelId: "gpt-4o",
    });
    expect(href.startsWith("/project/project-1/experiments?filter=")).toBe(
      true,
    );
    expect(filtersIn(href)).toMatchObject([
      {
        column: "metadata",
        type: "stringObject",
        key: "provider",
        operator: "=",
        value: "openai",
      },
      {
        column: "metadata",
        type: "stringObject",
        key: "model",
        operator: "=",
        value: "gpt-4o",
      },
    ]);
  });

  it("survives model ids with separators the filter format uses", () => {
    const modelId = "anthropic.claude-3-5:v1/preview;x,y|z";
    const href = getRegistryModelExperimentsHref({
      projectId: "p",
      provider: "bedrock",
      modelId,
    });
    expect(filtersIn(href)[1]).toMatchObject({ key: "model", value: modelId });
  });
});
