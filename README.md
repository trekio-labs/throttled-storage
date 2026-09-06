# @trekio-labs/throttled-storage

Coalesces bursts of storage writes into one backend call per interval. Zero runtime dependencies, ESM + CJS, TypeScript types included.

Structurally compatible with zustand's `StateStorage`, so it drops into `createJSONStorage` with no adapter.

## The problem

State libraries that persist on every change call `setItem` on every mutation. That is fine when the mutation is a user action. It is not fine when the mutation is a GPS fix arriving several times a second: the serialize-and-write cost lands on whichever thread the backend uses, and on React Native that is enough to stall the app.

The failure is easy to misread. It looks like a rendering problem, because the UI is what freezes. It is not — the cost is on the **write** path, and no amount of `memo` will touch it. We chased it as a render issue three separate times before measuring where the time actually went.

```ts
// Every set() writes. At 4 Hz, that is 4 serializations and 4 disk writes
// a second, for a value nobody reads until the next launch.
persist(storeDefinition, {
  name: 'active-trek',
  storage: createJSONStorage(() => AsyncStorage),
});
```

## Install

```bash
npm install @trekio-labs/throttled-storage
```

## Measured

```
6s of updates every 20ms, 2ms simulated write cost

                    updates   writes   written    caller blocked
zustand default     131       131      0.4 MB     1925 ms
throttled (200ms)   191       37       0.2 MB     14 ms
```

Reproduce with `npm run bench`. Read the last column first: the default spent
1.9 of 6 seconds inside `setItem`, on the thread your UI runs on. That is also
why it processed *fewer* updates than the throttled run — it was too busy
writing to keep up with its own input.

Be honest about when this helps. The saving is roughly **update rate ÷ flush
interval**. A store touched twice a minute gains nothing from a 1s interval; a
store touched on every sensor reading gains a lot. If your writes are already
slower than your flush interval, you do not need this package.

## Use

```ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import { persist } from 'zustand/middleware';
import { createThrottledJSONStorage } from '@trekio-labs/throttled-storage';

const storage = createThrottledJSONStorage(AsyncStorage, {
  intervalMs: 1000,
  onError: (error, key) => reportToCrashlytics(error, { key }),
});

persist(storeDefinition, {
  name: 'active-trek',
  storage, // matches zustand's PersistStorage; no createJSONStorage needed
});
```

`createThrottledJSONStorage` keeps buffered state as an object and stringifies
once at flush time, so a burst costs one serialization rather than one per
mutation. Wrapping `createJSONStorage` around the plain `createThrottledStorage`
also works, but serializes on every write.

### With MMKV

```ts
import { MMKV } from 'react-native-mmkv';
import { createThrottledJSONStorage, fromMMKV } from '@trekio-labs/throttled-storage';

const storage = createThrottledJSONStorage(fromMMKV(new MMKV()), { intervalMs: 1000 });
```

### Corrupted values

A value that fails to parse resolves as `null` rather than throwing, so a
truncated write degrades to the store's defaults instead of breaking hydration
on launch. Pass `onParseError` to find out when it happens — without it the
corruption is silent.

```ts
const storage = createThrottledJSONStorage(AsyncStorage, {
  onParseError: (error, key) => reportToCrashlytics(error, { key }),
});
```

Then flush wherever the app can be killed:

```ts
import { AppState } from 'react-native';

AppState.addEventListener('change', (state) => {
  if (state !== 'active') void storage.flush();
});
```

It works in the browser too — `localStorage` satisfies the same interface:

```ts
const storage = createThrottledStorage(localStorage, { intervalMs: 500 });
window.addEventListener('pagehide', () => void storage.flush());
```

## Semantics

- **Buffered, last-write-wins per key.** A thousand writes to one key in a single tick become one backend call carrying the final value.
- **Leading edge, then throttled.** The first write after an idle period flushes on the next tick, so a lone change is persisted immediately rather than sitting in memory for a full interval. Writes after it wait out the remainder of the interval.
- **Reads see buffered values.** `getItem` consults the buffer before the backend, so a read after a write always returns what you just wrote — flushed or not. It does not touch the backend at all when the key is buffered.
- **Failed writes are retried, not dropped.** A backend error leaves the value buffered for the next flush and reports it through `onError`. A newer write to the same key always wins over a retry, so a retry can never resurrect a stale value.
- **Flushes are serialized.** Overlapping flushes queue rather than race, so an older batch can never land after a newer one.
- **`flush()` never rejects.** Errors go to `onError`. A persistence layer that throws into your unload handler is worse than one that reports and continues.

## API

### `createThrottledJSONStorage(backend, options?)`

Everything `createThrottledStorage` does, plus JSON encoding, shaped to match
zustand's `PersistStorage<S>`. Takes the options below plus `replacer`,
`reviver` and `onParseError`.

One `JSON.stringify` gotcha, not specific to this package: `stringify` calls a
value's own `toJSON` *before* the replacer sees it, so a `Date` arrives at your
replacer already a string. Types without `toJSON` (`Set`, `Map`) reach it intact.

### `fromMMKV(mmkv)`

Adapts `react-native-mmkv`, which names its methods `getString`/`set`/`delete`.

### `createThrottledStorage(backend, options?)`

`backend` is anything with `getItem`, `setItem` and `removeItem`. Each may be sync or async, so `localStorage`, `AsyncStorage` and test doubles all work unmodified.

| Option | Default | Meaning |
| --- | --- | --- |
| `intervalMs` | `1000` | Minimum gap between backend writes. |
| `onError` | — | `(error, key) => void`, called when a write fails. Errors it throws are swallowed. |
| `retryOnError` | `true` | Keep failed writes buffered for retry. `false` discards them after reporting. |

Returns:

| Member | Purpose |
| --- | --- |
| `getItem(key)` | Buffer first, then backend. Resolves `null` when absent. |
| `setItem(key, value)` | Buffers and schedules. Resolves immediately. |
| `removeItem(key)` | Buffers a removal and schedules. Resolves immediately. |
| `flush()` | Writes everything pending now and waits for it to land. |
| `pendingCount()` | Keys currently buffered. For diagnostics and tests. |

## What this does not do

- **It is not durable on its own.** Buffered writes live in memory. If the process dies before a flush, up to `intervalMs` of changes are lost. That is the trade you are making; call `flush()` on backgrounding and unload to bound it.
- **It does not batch across keys into one backend call.** Each key is still a separate `setItem`, written sequentially to preserve ordering. The win is in call *count* over time, not in a multi-set API.
- **It does not serialize anything.** Values in, values out. Pair it with `createJSONStorage` or your own encoder.
- **It retries indefinitely by default.** A permanently broken backend means a failing write every interval, and an `onError` call each time. Set `retryOnError: false` if you would rather drop.

## Development

```bash
npm install
npm test          # vitest
npm run typecheck # tsc --noEmit
npm run build     # ESM + CJS + .d.ts into dist/
```

## License

MIT © Trekio Labs
