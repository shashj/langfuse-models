export const REGISTRY_USAGE_WINDOW_DAYS = 30;

export type RegistryModelUsage = {
  lastUsed: Date | null;
  generationsInWindow: number;
};
