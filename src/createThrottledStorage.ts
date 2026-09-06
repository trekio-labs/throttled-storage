import type {
  StorageBackend,
  ThrottledStorage,
  ThrottledStorageOptions,
} from './types.js';

/** Marks a key scheduled for removal rather than assignment. */
const REMOVE = null;

const DEFAULT_INTERVAL_MS = 1000;

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

/**
 * Wraps a storage backend so that bursts of writes collapse into at most one
 * backend call per interval.
 *
 * The problem it solves: state libraries that persist on every change call
 * `setItem` on every mutation. When the mutation is a GPS fix arriving several
 * times a second, the serialize-and-write cost lands on whichever thread the
 * backend uses, and the app stalls. Coalescing the writes fixes it; making the
 * renders cheaper does not, because the cost is on the write path.
 *
 * Semantics:
 * - Writes are buffered in memory, last-write-wins per key.
 * - The first write after an idle period flushes on the next tick. Later writes
 *   wait out the remainder of the interval. So a burst inside one tick is a
 *   single backend write, and a sustained stream is one write per interval.
 * - Reads consult the buffer first, so a read after a write always returns the
 *   value just written, flushed or not.
 * - A failed write stays buffered and is retried, unless a newer value for that
 *   key has already replaced it.
 */
export function createThrottledStorage(
  backend: StorageBackend,
  options: ThrottledStorageOptions = {},
): ThrottledStorage {
  const { intervalMs = DEFAULT_INTERVAL_MS, onError, retryOnError = true } = options;

  if (!Number.isFinite(intervalMs) || intervalMs < 0) {
    throw new RangeError('intervalMs must be a finite, non-negative number');
  }

  /** Buffered writes. A null value means "remove this key". */
  const pending = new Map<string, string | null>();

  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<void> | null = null;
  let lastFlushAt = Number.NEGATIVE_INFINITY;

  function report(error: unknown, key: string): void {
    if (!onError) return;
    try {
      onError(toError(error), key);
    } catch {
      // A throwing error reporter must not break the flush loop.
    }
  }

  function schedule(): void {
    if (timer !== null || pending.size === 0) return;

    const elapsed = Date.now() - lastFlushAt;
    const delay = elapsed >= intervalMs ? 0 : intervalMs - elapsed;

    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, delay);
  }

  async function writeBatch(batch: Map<string, string | null>): Promise<void> {
    for (const [key, value] of batch) {
      try {
        if (value === REMOVE) {
          await backend.removeItem(key);
        } else {
          await backend.setItem(key, value);
        }
      } catch (error) {
        // Re-buffer so the value is not lost, but never clobber a newer write
        // that arrived for this key while this one was in flight.
        if (retryOnError && !pending.has(key)) {
          pending.set(key, value);
        }
        report(error, key);
      }
    }
  }

  async function flush(): Promise<void> {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }

    // Serialize flushes: a second caller waits for the in-flight batch rather
    // than racing it, which would let an older value land after a newer one.
    if (inFlight) await inFlight;
    if (pending.size === 0) return;

    const batch = new Map(pending);
    pending.clear();

    inFlight = writeBatch(batch);
    try {
      await inFlight;
    } finally {
      inFlight = null;
      lastFlushAt = Date.now();
      // Anything re-buffered by a failure, or written during the flush.
      schedule();
    }
  }

  return {
    async getItem(key: string): Promise<string | null> {
      if (pending.has(key)) {
        const buffered = pending.get(key);
        return buffered === undefined ? null : buffered;
      }
      return (await backend.getItem(key)) ?? null;
    },

    async setItem(key: string, value: string): Promise<void> {
      pending.set(key, value);
      schedule();
    },

    async removeItem(key: string): Promise<void> {
      pending.set(key, REMOVE);
      schedule();
    },

    flush,

    pendingCount(): number {
      return pending.size;
    },
  };
}
