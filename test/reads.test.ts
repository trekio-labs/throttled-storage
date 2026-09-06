import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createThrottledStorage } from '../src/index.js';
import { createFakeBackend } from './helpers.js';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('read-your-writes', () => {
  it('returns a buffered value before it reaches the backend', async () => {
    const backend = createFakeBackend();
    const storage = createThrottledStorage(backend, { intervalMs: 60_000 });

    void storage.setItem('trek', 'buffered');

    expect(backend.store.has('trek')).toBe(false);
    expect(await storage.getItem('trek')).toBe('buffered');
  });

  it('does not touch the backend when the value is buffered', async () => {
    const backend = createFakeBackend();
    const storage = createThrottledStorage(backend, { intervalMs: 60_000 });

    void storage.setItem('trek', 'buffered');
    await storage.getItem('trek');

    expect(backend.getCalls).toHaveLength(0);
  });

  it('falls through to the backend when nothing is buffered', async () => {
    const backend = createFakeBackend();
    backend.store.set('trek', 'persisted');
    const storage = createThrottledStorage(backend, { intervalMs: 1000 });

    expect(await storage.getItem('trek')).toBe('persisted');
    expect(backend.getCalls).toEqual(['trek']);
  });

  it('returns null for a missing key', async () => {
    const backend = createFakeBackend();
    const storage = createThrottledStorage(backend, { intervalMs: 1000 });

    expect(await storage.getItem('absent')).toBeNull();
  });

  it('normalizes an undefined backend result to null', async () => {
    const storage = createThrottledStorage(
      {
        getItem: () => undefined,
        setItem: () => undefined,
        removeItem: () => undefined,
      },
      { intervalMs: 1000 },
    );

    expect(await storage.getItem('absent')).toBeNull();
  });

  it('reads the latest buffered value after repeated writes', async () => {
    const backend = createFakeBackend();
    const storage = createThrottledStorage(backend, { intervalMs: 60_000 });

    void storage.setItem('trek', 'one');
    void storage.setItem('trek', 'two');
    void storage.setItem('trek', 'three');

    expect(await storage.getItem('trek')).toBe('three');
  });
});

describe('removeItem', () => {
  it('reads as absent immediately, before the backend is touched', async () => {
    const backend = createFakeBackend();
    backend.store.set('trek', 'persisted');
    const storage = createThrottledStorage(backend, { intervalMs: 60_000 });

    void storage.removeItem('trek');

    expect(await storage.getItem('trek')).toBeNull();
    expect(backend.store.has('trek')).toBe(true);
  });

  it('reaches the backend on flush', async () => {
    const backend = createFakeBackend();
    backend.store.set('trek', 'persisted');
    const storage = createThrottledStorage(backend, { intervalMs: 1000 });

    void storage.removeItem('trek');
    await storage.flush();

    expect(backend.removeCalls).toEqual(['trek']);
    expect(backend.store.has('trek')).toBe(false);
  });

  it('is superseded by a later write to the same key', async () => {
    const backend = createFakeBackend();
    const storage = createThrottledStorage(backend, { intervalMs: 1000 });

    void storage.removeItem('trek');
    void storage.setItem('trek', 'revived');
    await storage.flush();

    expect(backend.removeCalls).toHaveLength(0);
    expect(backend.store.get('trek')).toBe('revived');
  });

  it('supersedes an earlier write to the same key', async () => {
    const backend = createFakeBackend();
    const storage = createThrottledStorage(backend, { intervalMs: 1000 });

    void storage.setItem('trek', 'doomed');
    void storage.removeItem('trek');
    await storage.flush();

    expect(backend.setCalls).toHaveLength(0);
    expect(backend.store.has('trek')).toBe(false);
  });
});
