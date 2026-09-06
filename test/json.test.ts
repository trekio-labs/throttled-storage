import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createThrottledJSONStorage } from '../src/index.js';
import { createFakeBackend } from './helpers.js';

interface TrekState {
  distance: number;
  name: string;
}

function isSetPayload(value: unknown): value is { __set: string[] } {
  return typeof value === 'object' && value !== null && '__set' in value;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createThrottledJSONStorage', () => {
  it('writes JSON to the backend on flush', async () => {
    const backend = createFakeBackend();
    const storage = createThrottledJSONStorage<TrekState>(backend, { intervalMs: 1000 });

    await storage.setItem('trek', { state: { distance: 12, name: 'Lukla' }, version: 1 });
    await storage.flush();

    expect(backend.store.get('trek')).toBe(
      JSON.stringify({ state: { distance: 12, name: 'Lukla' }, version: 1 }),
    );
  });

  it('round-trips a value', async () => {
    const backend = createFakeBackend();
    const storage = createThrottledJSONStorage<TrekState>(backend, { intervalMs: 1000 });

    const value = { state: { distance: 12, name: 'Lukla' }, version: 2 };
    await storage.setItem('trek', value);
    await storage.flush();

    expect(await storage.getItem('trek')).toEqual(value);
  });

  it('reads back a buffered value without hitting the backend', async () => {
    const backend = createFakeBackend();
    const storage = createThrottledJSONStorage<TrekState>(backend, { intervalMs: 60_000 });

    await storage.setItem('trek', { state: { distance: 1, name: 'a' } });

    expect(await storage.getItem('trek')).toEqual({ state: { distance: 1, name: 'a' } });
    expect(backend.getCalls).toHaveLength(0);
  });

  it('coalesces a burst into one backend write', async () => {
    const backend = createFakeBackend();
    const storage = createThrottledJSONStorage<TrekState>(backend, { intervalMs: 1000 });

    for (let i = 0; i < 500; i++) {
      void storage.setItem('trek', { state: { distance: i, name: 'x' } });
    }
    await vi.runAllTimersAsync();

    expect(backend.setCalls).toHaveLength(1);
    expect(JSON.parse(backend.store.get('trek') ?? '').state.distance).toBe(499);
  });

  it('returns null for a missing key', async () => {
    const backend = createFakeBackend();
    const storage = createThrottledJSONStorage<TrekState>(backend, { intervalMs: 1000 });

    expect(await storage.getItem('absent')).toBeNull();
  });

  it('removes a key', async () => {
    const backend = createFakeBackend();
    backend.store.set('trek', '{"state":{}}');
    const storage = createThrottledJSONStorage<TrekState>(backend, { intervalMs: 1000 });

    await storage.removeItem('trek');
    await storage.flush();

    expect(backend.store.has('trek')).toBe(false);
  });

  it('honours a replacer and reviver', async () => {
    // Note: JSON.stringify calls toJSON before the replacer runs, so a Date
    // arrives already stringified. Set has no toJSON, so it reaches the
    // replacer intact.
    const backend = createFakeBackend();
    const storage = createThrottledJSONStorage<{ tags: Set<string> }>(backend, {
      intervalMs: 1000,
      replacer: (_key, value) => (value instanceof Set ? { __set: [...value] } : value),
      reviver: (_key, value) => (isSetPayload(value) ? new Set(value.__set) : value),
    });

    await storage.setItem('trek', { state: { tags: new Set(['high', 'cold']) } });
    await storage.flush();

    expect(backend.store.get('trek')).toContain('__set');

    const read = await storage.getItem('trek');
    expect(read?.state.tags).toBeInstanceOf(Set);
    expect(read?.state.tags.has('high')).toBe(true);
  });
});

describe('corrupted values', () => {
  it('resolves null instead of throwing during hydration', async () => {
    const backend = createFakeBackend();
    backend.store.set('trek', '{"state":{"distance":1'); // truncated mid-write
    const storage = createThrottledJSONStorage<TrekState>(backend, { intervalMs: 1000 });

    await expect(storage.getItem('trek')).resolves.toBeNull();
  });

  it('reports the corruption through onParseError', async () => {
    const backend = createFakeBackend();
    backend.store.set('trek', 'not json at all');
    const onParseError = vi.fn();
    const storage = createThrottledJSONStorage<TrekState>(backend, {
      intervalMs: 1000,
      onParseError,
    });

    await storage.getItem('trek');

    expect(onParseError).toHaveBeenCalledTimes(1);
    expect(onParseError.mock.calls[0]?.[0]).toBeInstanceOf(Error);
    expect(onParseError.mock.calls[0]?.[1]).toBe('trek');
  });
});
