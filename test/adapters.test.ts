import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createThrottledStorage, fromMMKV } from '../src/index.js';
import type { MMKVLike } from '../src/index.js';

function createFakeMMKV(): MMKVLike & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    getString: (key) => store.get(key),
    set: (key, value) => {
      store.set(key, value);
    },
    delete: (key) => {
      store.delete(key);
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('fromMMKV', () => {
  it('maps getString to getItem, returning null when absent', async () => {
    const mmkv = createFakeMMKV();
    const backend = fromMMKV(mmkv);

    expect(await backend.getItem('absent')).toBeNull();

    mmkv.store.set('trek', 'value');
    expect(await backend.getItem('trek')).toBe('value');
  });

  it('maps set and delete', async () => {
    const mmkv = createFakeMMKV();
    const backend = fromMMKV(mmkv);

    await backend.setItem('trek', 'value');
    expect(mmkv.store.get('trek')).toBe('value');

    await backend.removeItem('trek');
    expect(mmkv.store.has('trek')).toBe(false);
  });

  it('coalesces writes when wrapped', async () => {
    const mmkv = createFakeMMKV();
    const setSpy = vi.spyOn(mmkv, 'set');
    const storage = createThrottledStorage(fromMMKV(mmkv), { intervalMs: 1000 });

    for (let i = 0; i < 200; i++) {
      void storage.setItem('trek', String(i));
    }
    await vi.runAllTimersAsync();

    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(mmkv.store.get('trek')).toBe('199');
  });
});
