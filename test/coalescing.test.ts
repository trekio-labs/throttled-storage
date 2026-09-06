import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createThrottledStorage } from '../src/index.js';
import { createFakeBackend, createSyncBackend } from './helpers.js';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createThrottledStorage', () => {
  it('rejects a negative or non-finite interval', () => {
    const backend = createFakeBackend();
    expect(() => createThrottledStorage(backend, { intervalMs: -1 })).toThrow(RangeError);
    expect(() => createThrottledStorage(backend, { intervalMs: NaN })).toThrow(RangeError);
  });
});

describe('write coalescing', () => {
  it('collapses a burst in one tick into a single backend write', async () => {
    const backend = createFakeBackend();
    const storage = createThrottledStorage(backend, { intervalMs: 1000 });

    // The shape of the bug this package exists for: a persisted store written
    // on every GPS fix. Unthrottled this is 1000 setItem calls.
    for (let i = 0; i < 1000; i++) {
      void storage.setItem('trek', JSON.stringify({ fix: i }));
    }

    expect(backend.setCalls).toHaveLength(0);

    await vi.runAllTimersAsync();

    expect(backend.setCalls).toHaveLength(1);
    expect(backend.store.get('trek')).toBe(JSON.stringify({ fix: 999 }));
  });

  it('writes at most once per interval under a sustained stream', async () => {
    const backend = createFakeBackend();
    const storage = createThrottledStorage(backend, { intervalMs: 1000 });

    // 50 writes spread over 5 seconds at 100ms apart.
    for (let i = 0; i < 50; i++) {
      void storage.setItem('trek', String(i));
      await vi.advanceTimersByTimeAsync(100);
    }
    await vi.runAllTimersAsync();

    // ~5 seconds at one write per second, plus the leading-edge write.
    expect(backend.setCalls.length).toBeLessThanOrEqual(7);
    expect(backend.setCalls.length).toBeGreaterThan(1);
    expect(backend.store.get('trek')).toBe('49');
  });

  it('keeps distinct keys separate', async () => {
    const backend = createFakeBackend();
    const storage = createThrottledStorage(backend, { intervalMs: 1000 });

    void storage.setItem('a', '1');
    void storage.setItem('b', '2');
    void storage.setItem('a', '3');

    await vi.runAllTimersAsync();

    expect(backend.setCalls).toHaveLength(2);
    expect(backend.store.get('a')).toBe('3');
    expect(backend.store.get('b')).toBe('2');
  });

  it('does not delay the first write after an idle period', async () => {
    const backend = createFakeBackend();
    const storage = createThrottledStorage(backend, { intervalMs: 1000 });

    void storage.setItem('trek', 'first');
    await vi.advanceTimersByTimeAsync(0);

    expect(backend.store.get('trek')).toBe('first');
  });

  it('makes a later write wait out the remainder of the interval', async () => {
    const backend = createFakeBackend();
    const storage = createThrottledStorage(backend, { intervalMs: 1000 });

    void storage.setItem('trek', 'first');
    await vi.advanceTimersByTimeAsync(0);
    void storage.setItem('trek', 'second');

    await vi.advanceTimersByTimeAsync(500);
    expect(backend.store.get('trek')).toBe('first');

    await vi.advanceTimersByTimeAsync(600);
    expect(backend.store.get('trek')).toBe('second');
  });

  it('reports how many keys are waiting', async () => {
    const backend = createFakeBackend();
    const storage = createThrottledStorage(backend, { intervalMs: 1000 });

    void storage.setItem('a', '1');
    void storage.setItem('b', '2');
    expect(storage.pendingCount()).toBe(2);

    await vi.runAllTimersAsync();
    expect(storage.pendingCount()).toBe(0);
  });

  it('works with a synchronous backend', async () => {
    const backend = createSyncBackend();
    const storage = createThrottledStorage(backend, { intervalMs: 1000 });

    void storage.setItem('a', '1');
    await vi.runAllTimersAsync();

    expect(backend.store.get('a')).toBe('1');
    expect(await storage.getItem('a')).toBe('1');
  });
});

describe('flush', () => {
  it('writes immediately without waiting for the interval', async () => {
    const backend = createFakeBackend();
    const storage = createThrottledStorage(backend, { intervalMs: 60_000 });

    void storage.setItem('trek', 'value');
    await storage.flush();

    expect(backend.store.get('trek')).toBe('value');
    expect(storage.pendingCount()).toBe(0);
  });

  it('is a no-op with nothing pending', async () => {
    const backend = createFakeBackend();
    const storage = createThrottledStorage(backend, { intervalMs: 1000 });

    await storage.flush();
    expect(backend.setCalls).toHaveLength(0);
  });

  it('cancels the scheduled write rather than duplicating it', async () => {
    const backend = createFakeBackend();
    const storage = createThrottledStorage(backend, { intervalMs: 1000 });

    void storage.setItem('trek', 'value');
    await storage.flush();
    await vi.runAllTimersAsync();

    expect(backend.setCalls).toHaveLength(1);
  });
});
