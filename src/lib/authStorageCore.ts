export interface SessionStorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

export function createSessionStorageAdapter(
  getStorage: () => SessionStorageLike | undefined,
) {
  return {
    getItem(key: string): string | null {
      try {
        return getStorage()?.getItem(key) ?? null;
      } catch {
        return null;
      }
    },
    setItem(key: string, value: string): void {
      try {
        getStorage()?.setItem(key, value);
      } catch {
        // Authentication remains in memory when browser storage is blocked.
      }
    },
    removeItem(key: string): void {
      try {
        getStorage()?.removeItem(key);
      } catch {
        // Sign-out still clears the in-memory Supabase session.
      }
    },
  };
}
