import { describe, expect, it, vi } from "vitest";

import {
  readThroughUsageCache,
  type UsageCacheClient,
} from "@/src/features/model-registry/server/usageCache";

// A client that accepts a command and never answers it, as the shared client does while the
// server is down: it keeps retrying forever.
const unresponsive = (status: string): UsageCacheClient =>
  ({
    status,
    get: () => new Promise(() => {}),
    set: () => new Promise(() => {}),
  }) as unknown as UsageCacheClient;

const read = (client: UsageCacheClient, compute: () => Promise<string>) =>
  readThroughUsageCache({
    scope: "test",
    projectId: "p",
    inputs: "same",
    compute,
    client,
  });

describe("readThroughUsageCache", () => {
  it("serves a repeated read from the cache", async () => {
    const stored = new Map<string, string>();
    const client = {
      status: "ready",
      get: async (key: string) => stored.get(key) ?? null,
      set: async (key: string, value: string) => {
        stored.set(key, value);
        return "OK";
      },
    } as unknown as UsageCacheClient;
    const compute = vi.fn(async () => "computed");

    expect(await read(client, compute)).toBe("computed");
    expect(await read(client, compute)).toBe("computed");
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it("does not wait for a client that is not connected", async () => {
    const started = Date.now();

    const result = await read(
      unresponsive("reconnecting"),
      async () => "computed",
    );

    expect(result).toBe("computed");
    expect(Date.now() - started).toBeLessThan(200);
  });

  it("gives up on a connected client that does not answer, and still returns the result", async () => {
    const started = Date.now();

    const result = await read(unresponsive("ready"), async () => "computed");

    expect(result).toBe("computed");
    // One deadline for the read and one for the write, far below a stalled page.
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
