import type { MMKVLike, StorageBackend } from './types.js';

/**
 * Adapts `react-native-mmkv` to the backend interface. MMKV names its methods
 * `getString`/`set`/`delete` rather than the `getItem`/`setItem`/`removeItem`
 * this package expects.
 *
 * MMKV writes are synchronous and fast, so throttling matters less than it does
 * for AsyncStorage — but "fast" is not "free" on the JS thread, and a store
 * written per sensor reading still benefits from coalescing.
 */
export function fromMMKV(mmkv: MMKVLike): StorageBackend {
  return {
    getItem: (key: string) => mmkv.getString(key) ?? null,
    setItem: (key: string, value: string) => mmkv.set(key, value),
    removeItem: (key: string) => mmkv.delete(key),
  };
}
