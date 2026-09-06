/** A value that a backend may return synchronously or as a promise. */
export type MaybePromise<T> = T | Promise<T>;

/**
 * The storage this wrapper writes through to. Deliberately narrow so that
 * `localStorage`, React Native's `AsyncStorage`, `expo-sqlite` wrappers and
 * hand-rolled test doubles all satisfy it without an adapter.
 */
export interface StorageBackend {
  getItem(key: string): MaybePromise<string | null | undefined>;
  setItem(key: string, value: string): MaybePromise<unknown>;
  removeItem(key: string): MaybePromise<unknown>;
}

export interface ThrottledStorageOptions {
  /**
   * Minimum gap between backend writes, in milliseconds. The first write after
   * an idle period is not delayed; everything after it is coalesced into at
   * most one backend write per interval. Default 1000.
   */
  intervalMs?: number;

  /**
   * Called when a backend write throws or rejects. Never called with a value
   * that has already been superseded by a newer write to the same key.
   *
   * Errors thrown by this callback are swallowed — a broken reporter must not
   * take down the flush loop.
   */
  onError?: (error: Error, key: string) => void;

  /**
   * Keep a failed write pending and retry it on the next flush. Default true:
   * silently dropping state is how persistence bugs become data-loss bugs. Set
   * false to discard failed writes after reporting them.
   */
  retryOnError?: boolean;
}

/**
 * Structurally compatible with zustand's `StateStorage`, so it can be passed
 * straight to `createJSONStorage` with no adapter.
 */
export interface ThrottledStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;

  /**
   * Write everything pending to the backend now and wait for it to land. Call
   * this before the app can be killed — backgrounding, navigation away, process
   * exit — or buffered state is lost.
   */
  flush(): Promise<void>;

  /** Number of keys waiting to be written. Diagnostics and tests. */
  pendingCount(): number;
}
