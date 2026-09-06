import { createThrottledStorage } from './createThrottledStorage.js';
import type {
  StorageBackend,
  StorageValue,
  ThrottledJSONStorage,
  ThrottledJSONStorageOptions,
} from './types.js';

/**
 * The same coalescing as {@link createThrottledStorage}, with JSON encoding
 * built in, shaped to match zustand's `PersistStorage` so it can be handed to
 * `persist` directly:
 *
 * ```ts
 * persist(definition, { name: 'trek', storage: createThrottledJSONStorage(AsyncStorage) })
 * ```
 *
 * Using this instead of wrapping `createJSONStorage` around a throttled
 * `StateStorage` saves a serialize on every buffered write: state is kept as an
 * object and stringified once, when the flush actually happens. On a store
 * written per GPS fix that is the difference between serializing four times a
 * second and serializing once.
 */
export function createThrottledJSONStorage<S>(
  backend: StorageBackend,
  options: ThrottledJSONStorageOptions = {},
): ThrottledJSONStorage<S> {
  const { replacer, reviver, onParseError, ...rest } = options;
  const storage = createThrottledStorage(backend, rest);

  return {
    async getItem(name) {
      const raw = await storage.getItem(name);
      if (raw === null) return null;

      try {
        return JSON.parse(raw, reviver) as StorageValue<S>;
      } catch (error) {
        // A truncated or corrupted value would otherwise throw on boot, before
        // the app can render anything. Reporting it and falling back to the
        // store's defaults degrades instead of bricking.
        onParseError?.(error instanceof Error ? error : new Error(String(error)), name);
        return null;
      }
    },

    async setItem(name, value) {
      await storage.setItem(name, JSON.stringify(value, replacer));
    },

    async removeItem(name) {
      await storage.removeItem(name);
    },

    flush: storage.flush,
    pendingCount: storage.pendingCount,
  };
}
