import { createHash } from "crypto";
import superjson from "superjson";

import { logger, redis } from "@langfuse/shared/src/server";

/** How long a usage result is served without asking ClickHouse again. */
const USAGE_CACHE_TTL_SECONDS = 60;
const MINUTE_MS = 60_000;

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
 * edit or another range never reads a stale result. A cache that is down or unreadable is
 * skipped: the result is then computed on every call, as without a cache.
 */
export async function readThroughUsageCache<T>(params: {
  scope: string;
  projectId: string;
  inputs: unknown;
  compute: () => Promise<T>;
}): Promise<T> {
  const hash = createHash("sha256")
    .update(superjson.stringify(params.inputs))
    .digest("base64url");
  const key = `model-registry:usage:${params.scope}:${params.projectId}:${hash}`;

  try {
    const hit = await redis?.get(key);
    if (hit) return superjson.parse<T>(hit);
  } catch (error) {
    logger.warn("Reading the registry usage cache failed", { error });
  }

  const value = await params.compute();

  try {
    await redis?.set(
      key,
      superjson.stringify(value),
      "EX",
      USAGE_CACHE_TTL_SECONDS,
    );
  } catch (error) {
    logger.warn("Writing the registry usage cache failed", { error });
  }
  return value;
}
