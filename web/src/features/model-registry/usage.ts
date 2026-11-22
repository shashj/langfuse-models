export const REGISTRY_USAGE_WINDOW_DAYS = 30;

/**
 * How far back "Last used" looks. The generation tables are not indexed by model, so every day
 * of lookback is read in full; a bound keeps the query's cost independent of a project's age.
 * A model not used within it has no "Last used".
 */
export const REGISTRY_LAST_USED_LOOKBACK_DAYS = 90;

export type RegistryModelUsage = {
  lastUsed: Date | null;
  generationsInWindow: number;
};

export type RegistryExperimentUsage = {
  experiments: number;
  datasets: number;
  lastRun: Date | null;
};
