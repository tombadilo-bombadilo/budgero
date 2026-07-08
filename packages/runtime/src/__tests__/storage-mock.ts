export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  clear(): void;
  key(index: number): string | null;
  readonly length: number;
}

export function createStorageMock(): StorageLike {
  const map = new Map<string, string>();

  return {
    getItem(key: string): string | null {
      const value = map.get(key);
      return value ?? null;
    },
    setItem(key: string, value: string): void {
      map.set(String(key), String(value));
    },
    removeItem(key: string): void {
      map.delete(key);
    },
    clear(): void {
      map.clear();
    },
    key(index: number): string | null {
      return Array.from(map.keys())[index] ?? null;
    },
    get length(): number {
      return map.size;
    },
  };
}
