import type { StorageBackend } from '../src/index.js';

export interface FakeBackend extends StorageBackend {
  readonly store: Map<string, string>;
  readonly setCalls: Array<{ key: string; value: string }>;
  readonly removeCalls: string[];
  readonly getCalls: string[];
  failNextSet: number;
  failAllSets: boolean;
  /** Resolves pending writes manually when set. */
  gate: (() => Promise<void>) | null;
}

/** An async backend that records every call, in the style of AsyncStorage. */
export function createFakeBackend(): FakeBackend {
  const backend: FakeBackend = {
    store: new Map<string, string>(),
    setCalls: [],
    removeCalls: [],
    getCalls: [],
    failNextSet: 0,
    failAllSets: false,
    gate: null,

    async getItem(key: string) {
      backend.getCalls.push(key);
      return backend.store.get(key) ?? null;
    },

    async setItem(key: string, value: string) {
      if (backend.gate) await backend.gate();
      backend.setCalls.push({ key, value });
      if (backend.failAllSets || backend.failNextSet > 0) {
        if (backend.failNextSet > 0) backend.failNextSet -= 1;
        throw new Error(`write failed for ${key}`);
      }
      backend.store.set(key, value);
    },

    async removeItem(key: string) {
      backend.removeCalls.push(key);
      backend.store.delete(key);
    },
  };

  return backend;
}

/** A synchronous backend, in the style of localStorage. */
export function createSyncBackend(): StorageBackend & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
  };
}
