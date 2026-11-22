import { createHash } from "crypto";
import superjson from "superjson";
import type { Cluster, Redis } from "ioredis";

import { logger, redis } from "@langfuse/shared/src/server";

/** How long a usage result is served without asking ClickHouse again. */
const USAGE_CACHE_TTL_SECONDS = 60;
/**
 * How long a cache read or write may take before it is given up on. The shared Redis client
 * retries a command forever while the server is down, so without a deadline a dead cache would
 * stall the Models page instead of only costing it the cache.
 */
const CACHE_OPERATION_TIMEOUT_MS = 250;
const MINUTE_MS = 60_000;

/** The part of a Redis client the cache uses. */
export type UsageCacheClient = Pick<Redis | Cluster, "status" | "get" | "set">;

function withDeadline<T>(operation: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error("The cache did not answer in time")),
      CACHE_OPERATION_TIMEOUT_MS,
    );
  });
  return Promise.race([operation, deadline]).finally(() => clearTimeout(timer));
}

/**
 * The range widened to whole minutes. A relative range such as "past 30 days" has a new `from`
 * and `to` on every request, so without this no two requests could share a cached result. It is
 * widened rather than narrowed so the latest generations are never cut off.
 */
export function alignRangeToMinutes(range: { from: Date; to: Date }) {
  return {
    from: new Date(Math.floor(range.from.getTime() / MINUTE_MS) * MINUTE_MS),
    to: new Date(Math.ceil(range.to.getTime() / MINUTE_MS) * MINUTE_MS),
  };
}

/**
 * Returns the cached result for `inputs`, or computes and caches it for a minute. The key is a
 * hash of everything the result depends on besides the generations themselves, so a registry
 * edit or another range never reads a stale result. A cache that is down, not yet connected,
 * slow or unreadable is skipped: the result is then computed on every call, as without a cache.
 */
export async function readThroughUsageCache<T>(params: {
  scope: string;
  projectId: string;
  inputs: unknown;
  compute: () => Promise<T>;
  /** Overridable for tests; the shared Redis client by default. */
  client?: UsageCacheClient | null;
}): Promise<T> {
  // A client that is not connected would queue the command until it is, so it is not used.
  const candidate = params.client === undefined ? redis : params.client;
  const client = candidate?.status === "ready" ? candidate : null;
  const hash = createHash("sha256")
    .update(superjson.stringify(params.inputs))
    .digest("base64url");
  const key = `model-registry:usage:${params.scope}:${params.projectId}:${hash}`;

  try {
    const hit = client ? await withDeadline(client.get(key)) : null;
    if (hit) return superjson.parse<T>(hit);
  } catch (error) {
    logger.warn("Reading the registry usage cache failed", { error });
  }

  const value = await params.compute();

  try {
    if (client) {
      await withDeadline(
        client.set(
          key,
          superjson.stringify(value),
          "EX",
          USAGE_CACHE_TTL_SECONDS,
        ),
      );
    }
  } catch (error) {
    logger.warn("Writing the registry usage cache failed", { error });
  }
  return value;
}
