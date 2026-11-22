export type RegistryModelUsage = {
  lastUsed: Date | null;
  generationsInWindow: number;
};

export type RegistryExperimentUsage = {
  experiments: number;
  datasets: number;
  lastRun: Date | null;
};
