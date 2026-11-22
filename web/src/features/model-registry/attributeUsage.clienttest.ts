import { describe, expect, it } from "vitest";

import {
  attributeUsage,
  type UsageEntry,
  type UsageRow,
} from "@/src/features/model-registry/attributeUsage";

const day = (n: number) => new Date(`2026-01-0${n}T00:00:00Z`);
const row = (
  providedModelName: string,
  generations: number,
  lastUsed = day(1),
  pricingModelId = "price",
): UsageRow => ({ pricingModelId, providedModelName, generations, lastUsed });

const base: UsageEntry = {
  id: "base",
  modelId: "gpt-4o",
  pricingModelId: "price",
};
const dated: UsageEntry = {
  id: "dated",
  modelId: "gpt-4o-2024-08-06",
  pricingModelId: "price",
};

describe("attributeUsage", () => {
  it("gives a generation only to the entry whose model id is its model name", () => {
    const usage = attributeUsage({
      entries: [base, dated],
      requestedIds: ["base", "dated"],
      rows: [row("gpt-4o", 10, day(2)), row("gpt-4o-2024-08-06", 3, day(5))],
    });
    expect(usage.base).toEqual({ lastUsed: day(2), generationsInWindow: 10 });
    expect(usage.dated).toEqual({ lastUsed: day(5), generationsInWindow: 3 });
  });

  it("shares generations of an unregistered variant between the entries on that definition", () => {
    const usage = attributeUsage({
      entries: [base, dated],
      requestedIds: ["base", "dated"],
      rows: [row("gpt-4o-2025-01-01", 4)],
    });
    expect(usage.base.generationsInWindow).toBe(4);
    expect(usage.dated.generationsInWindow).toBe(4);
  });

  it("counts an entry's siblings on other pages, but reports only the requested ones", () => {
    const usage = attributeUsage({
      entries: [base, dated],
      requestedIds: ["dated"],
      rows: [row("gpt-4o", 10), row("gpt-4o-2024-08-06", 3)],
    });
    expect(Object.keys(usage)).toEqual(["dated"]);
    expect(usage.dated.generationsInWindow).toBe(3);
  });

  it("leaves out an entry without a definition and reports zero for one without generations", () => {
    const unpriced: UsageEntry = {
      id: "x",
      modelId: "x",
      pricingModelId: null,
    };
    const usage = attributeUsage({
      entries: [base, unpriced],
      requestedIds: ["base", "x"],
      rows: [],
    });
    expect(usage).toEqual({
      base: { lastUsed: null, generationsInWindow: 0 },
    });
  });
});
