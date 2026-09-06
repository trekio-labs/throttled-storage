export { createThrottledStorage } from './createThrottledStorage.js';
export { createThrottledJSONStorage } from './json.js';
export { fromMMKV } from './adapters.js';

export type {
  MaybePromise,
  MMKVLike,
  StorageBackend,
  StorageValue,
  ThrottledJSONStorage,
  ThrottledJSONStorageOptions,
  ThrottledStorage,
  ThrottledStorageOptions,
} from './types.js';
