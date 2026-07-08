let globalTokenGetter: (() => Promise<string | null>) | null = null;

export function setGlobalTokenGetter(getter: () => Promise<string | null>) {
  globalTokenGetter = getter;
}

export function getGlobalToken(): Promise<string | null> {
  if (!globalTokenGetter) {
    console.warn('[clerk-token-manager] Token getter not set');
    return Promise.resolve(null);
  }
  return globalTokenGetter();
}
