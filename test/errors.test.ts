import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createThrottledStorage } from '../src/index.js';
import { createFakeBackend } from './helpers.js';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('write failures', () => {
  it('reports the error with the key that failed', async () => {
    const backend = createFakeBackend();
    const onError = vi.fn();
    const storage = createThrottledStorage(backend, { intervalMs: 1000, onError });

    backend.failNextSet = 1;
    void storage.setItem('trek', 'value');
    await storage.flush();

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[1]).toBe('trek');
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(Error);
  });

  it('keeps the value buffered instead of dropping it', async () => {
    const backend = createFakeBackend();
    const storage = createThrottledStorage(backend, { intervalMs: 1000 });

    backend.failNextSet = 1;
    void storage.setItem('trek', 'value');
    await storage.flush();

    expect(storage.pendingCount()).toBe(1);
    expect(await storage.getItem('trek')).toBe('value');
  });

  it('retries the failed write and eventually persists it', async () => {
    const backend = createFakeBackend();
    const storage = createThrottledStorage(backend, { intervalMs: 1000 });

    backend.failNextSet = 1;
    void storage.setItem('trek', 'value');
    await storage.flush();
    expect(backend.store.has('trek')).toBe(false);

    await vi.advanceTimersByTimeAsync(1100);

    expect(backend.store.get('trek')).toBe('value');
    expect(storage.pendingCount()).toBe(0);
  });

  it('does not resurrect a stale value over a newer write', async () => {
    const backend = createFakeBackend();
    const storage = createThrottledStorage(backend, { intervalMs: 1000 });

    backend.gate = () => Promise.resolve();
    backend.failNextSet = 1;

    void storage.setItem('trek', 'old');
    const flushing = storage.flush();
    // The newer value lands while the failing write is in flight.
    void storage.setItem('trek', 'new');
    await flushing;

    expect(await storage.getItem('trek')).toBe('new');

    await vi.runAllTimersAsync();
    expect(backend.store.get('trek')).toBe('new');
  });

  it('drops the value after reporting when retryOnError is false', async () => {
    const backend = createFakeBackend();
    const onError = vi.fn();
    const storage = createThrottledStorage(backend, {
      intervalMs: 1000,
      onError,
      retryOnError: false,
    });

    backend.failNextSet = 1;
    void storage.setItem('trek', 'value');
    await storage.flush();

    expect(onError).toHaveBeenCalledTimes(1);
    expect(storage.pendingCount()).toBe(0);
  });

  it('does not reject the flush caller', async () => {
    const backend = createFakeBackend();
    const storage = createThrottledStorage(backend, { intervalMs: 1000 });

    backend.failAllSets = true;
    void storage.setItem('trek', 'value');

    await expect(storage.flush()).resolves.toBeUndefined();
  });

  it('survives a throwing error reporter', async () => {
    const backend = createFakeBackend();
    const storage = createThrottledStorage(backend, {
      intervalMs: 1000,
      onError: () => {
        throw new Error('reporter exploded');
      },
    });

    backend.failNextSet = 1;
    void storage.setItem('trek', 'value');

    await expect(storage.flush()).resolves.toBeUndefined();
    expect(storage.pendingCount()).toBe(1);
  });

  it('wraps a non-Error rejection', async () => {
    const onError = vi.fn();
    const storage = createThrottledStorage(
      {
        getItem: () => null,
        setItem: () => Promise.reject('a string, not an Error'),
        removeItem: () => undefined,
      },
      { intervalMs: 1000, onError },
    );

    void storage.setItem('trek', 'value');
    await storage.flush();

    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(Error);
    expect(onError.mock.calls[0]?.[0]?.message).toBe('a string, not an Error');
  });

  it('keeps other keys writing when one key fails', async () => {
    const backend = createFakeBackend();
    const storage = createThrottledStorage(backend, { intervalMs: 1000 });

    backend.failNextSet = 1;
    void storage.setItem('broken', 'x');
    void storage.setItem('fine', 'y');
    await storage.flush();

    expect(backend.store.get('fine')).toBe('y');
    expect(storage.pendingCount()).toBe(1);
  });
});

describe('concurrent flushes', () => {
  it('serializes overlapping flushes so the newest value wins', async () => {
    const backend = createFakeBackend();
    const storage = createThrottledStorage(backend, { intervalMs: 1000 });

    let release: () => void = () => {};
    backend.gate = () =>
      new Promise<void>((resolve) => {
        release = resolve;
      });

    void storage.setItem('trek', 'first');
    const firstFlush = storage.flush();

    void storage.setItem('trek', 'second');
    const secondFlush = storage.flush();

    backend.gate = null;
    release();
    await firstFlush;
    await secondFlush;
    await vi.runAllTimersAsync();

    expect(backend.store.get('trek')).toBe('second');
    expect(backend.setCalls.at(-1)?.value).toBe('second');
  });
});
