// Measures what coalescing actually buys, against a backend that imitates
// AsyncStorage: every write costs real time on a shared resource.
//
// Updates are spaced in real wall-clock time, because that is the whole point:
// coalescing saves nothing when updates arrive slower than the flush interval.
// The saving is roughly (update rate / flush rate), and this measures it rather
// than asserting it.
//
// Run: npm run bench

import { createThrottledJSONStorage } from '../dist/esm/index.js';

/** Cost of one AsyncStorage write, conservatively. Real devices are worse. */
const WRITE_COST_MS = 2;
/** A store touched 50x a second: sensor fixes plus derived values. */
const UPDATE_INTERVAL_MS = 20;
const DURATION_MS = 6000;
const FLUSH_INTERVAL_MS = 200;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function createCountingBackend() {
  const state = { writes: 0, bytes: 0, store: new Map() };
  return {
    state,
    async getItem(key) {
      return state.store.get(key) ?? null;
    },
    async setItem(key, value) {
      state.writes += 1;
      state.bytes += value.length;
      await sleep(WRITE_COST_MS);
      state.store.set(key, value);
    },
    async removeItem(key) {
      state.store.delete(key);
    },
  };
}

/** What zustand's persist does by default: write on every mutation. */
function createUnthrottledJSONStorage(backend) {
  return {
    getItem: async (name) => {
      const raw = await backend.getItem(name);
      return raw === null ? null : JSON.parse(raw);
    },
    setItem: (name, value) => backend.setItem(name, JSON.stringify(value)),
    removeItem: (name) => backend.removeItem(name),
    flush: async () => {},
  };
}

/** A growing track, so serialization cost rises the way it does in the field. */
function buildState(fixCount) {
  const route = [];
  for (let i = 0; i < fixCount; i++) {
    route.push({ lat: 27.7 + i * 1e-5, lon: 86.7 + i * 1e-5, alt: 2800 + i, t: i });
  }
  return { state: { route, distance: fixCount * 1.4 }, version: 1 };
}

async function run(label, storage, backendState) {
  const started = Date.now();
  let blockedMs = 0;
  let updates = 0;

  while (Date.now() - started < DURATION_MS) {
    updates += 1;
    // Time spent inside setItem is time the calling thread is not free. On
    // React Native this is the JS thread, which is why the app stalls.
    const before = process.hrtime.bigint();
    await storage.setItem('active-trek', buildState(updates));
    blockedMs += Number(process.hrtime.bigint() - before) / 1e6;

    await sleep(UPDATE_INTERVAL_MS);
  }
  await storage.flush();

  return {
    label,
    updates,
    writes: backendState.writes,
    megabytes: backendState.bytes / 1024 / 1024,
    blockedMs,
  };
}

const plainBackend = createCountingBackend();
const plain = await run(
  'zustand default',
  createUnthrottledJSONStorage(plainBackend),
  plainBackend.state,
);

const throttledBackend = createCountingBackend();
const throttled = await run(
  `throttled (${FLUSH_INTERVAL_MS}ms)`,
  createThrottledJSONStorage(throttledBackend, { intervalMs: FLUSH_INTERVAL_MS }),
  throttledBackend.state,
);

const pad = (s, n) => String(s).padEnd(n);

console.log(
  `\n${DURATION_MS / 1000}s of updates every ${UPDATE_INTERVAL_MS}ms, ` +
    `${WRITE_COST_MS}ms simulated write cost\n`,
);
console.log(
  pad('', 20) + pad('updates', 10) + pad('writes', 9) + pad('written', 11) + 'caller blocked',
);
for (const row of [plain, throttled]) {
  console.log(
    pad(row.label, 20) +
      pad(row.updates, 10) +
      pad(row.writes, 9) +
      pad(`${row.megabytes.toFixed(1)} MB`, 11) +
      `${row.blockedMs.toFixed(0)} ms`,
  );
}
console.log(
  `\nwrites: ${(plain.writes / throttled.writes).toFixed(1)}x fewer` +
    ` | bytes: ${(plain.megabytes / throttled.megabytes).toFixed(1)}x less` +
    ` | caller blocked: ${(plain.blockedMs / throttled.blockedMs).toFixed(1)}x less\n`,
);
