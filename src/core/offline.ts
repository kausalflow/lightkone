import type { StorageAdapter } from "./types";

// Keeps a copy of what was last read from remote storage (the library, notes
// and recently opened PDFs) so the app still opens and reads without a
// network. Writes still go straight to storage. PDFs chosen to keep offline
// (for a trip, say) stay until they are let go, within a size limit; the
// recently opened ones come and go on their own.

/** The few Cache API calls used, so tests can pass a Map instead. */
export interface ByteCache {
  get(key: string): Promise<Uint8Array | null>;
  put(key: string, data: Uint8Array): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

export const KEEP_PDFS = 25;

/** Choices for how much the PDFs kept offline may take, in bytes. */
export const OFFLINE_LIMITS = [500e6, 1e9, 2e9, 5e9, 10e9];
export const DEFAULT_OFFLINE_LIMIT = 2e9;
const LIMIT_KEY = "lightkone.offlineLimit";

export function offlineLimit(): number {
  try {
    const n = Number(localStorage.getItem(LIMIT_KEY));
    return OFFLINE_LIMITS.includes(n) ? n : DEFAULT_OFFLINE_LIMIT;
  } catch {
    return DEFAULT_OFFLINE_LIMIT;
  }
}

export function setOfflineLimit(n: number) {
  try {
    localStorage.setItem(LIMIT_KEY, String(n));
  } catch {
    // private window: the default applies
  }
}

/** The list of kept PDFs and their sizes, stored in the cache next to them. */
const KEPT = "__kept.json";
/** Highlights saved with no network, waiting to be written to storage. */
const PENDING = "__pending.json";
/** Files that can wait for the network: one paper's highlights, written whole by this device. */
const canWait = (path: string) => path.startsWith("lightkone/annotations/");

export interface KeepResult {
  added: number;
  /** Not found in storage, or the network failed. */
  failed: number;
  /** Stopped because the next PDF would go over the limit. */
  full: boolean;
}

export function browserCache(name = "lightkone-offline"): ByteCache | null {
  if (typeof caches === "undefined") return null;
  // Cache API keys must be URLs; these are never fetched.
  const url = (k: string) => `${location.origin}/__offline/${encodeURIComponent(k)}`;
  const open = () => caches.open(name);
  return {
    async get(k) {
      const r = await (await open()).match(url(k));
      return r ? new Uint8Array(await r.arrayBuffer()) : null;
    },
    async put(k, data) {
      await (await open()).put(url(k), new Response(data.slice()));
    },
    async delete(k) {
      await (await open()).delete(url(k));
    },
    async keys() {
      const prefix = `${location.origin}/__offline/`;
      return (await (await open()).keys()).map((r) => decodeURIComponent(r.url.slice(prefix.length)));
    },
  };
}

const offlineError = (e: unknown) => e instanceof TypeError || (globalThis.navigator && navigator.onLine === false);

export interface OfflineStorage extends StorageAdapter {
  /** True once a read was answered from the offline copy. */
  offline: boolean;
  /** PDFs kept offline on purpose, with their sizes in bytes. */
  kept(): Promise<Map<string, number>>;
  /** Download PDFs and keep them until let go, as long as the total stays within `limit` bytes. */
  keep(paths: string[], limit: number, onProgress?: (done: number, total: number) => void, signal?: AbortSignal): Promise<KeepResult>;
  /** Let kept PDFs go, freeing their space. */
  release(paths: string[]): Promise<void>;
  /** Write what was saved with no network. Returns how many files are still waiting. */
  flush(): Promise<number>;
}

const noCache: ByteCache = { get: async () => null, put: async () => {}, delete: async () => {}, keys: async () => [] };

export function withOfflineCache(inner: StorageAdapter, maybeCache: ByteCache | null, keepPdfs = KEEP_PDFS): OfflineStorage {
  const cache = maybeCache ?? noCache;
  const isPdf = (p: string) => /\.pdf$/i.test(p);
  const decoder = new TextDecoder();

  async function kept(): Promise<Map<string, number>> {
    const raw = await cache.get(KEPT).catch(() => null);
    try {
      return new Map(Object.entries(raw ? (JSON.parse(decoder.decode(raw)) as Record<string, number>) : {}));
    } catch {
      return new Map();
    }
  }
  const saveKept = (m: Map<string, number>) => cache.put(KEPT, new TextEncoder().encode(JSON.stringify(Object.fromEntries(m))));

  async function pending(): Promise<Set<string>> {
    const raw = await cache.get(PENDING).catch(() => null);
    try {
      return new Set(raw ? (JSON.parse(decoder.decode(raw)) as string[]) : []);
    } catch {
      return new Set();
    }
  }
  const savePending = (p: Set<string>) => cache.put(PENDING, new TextEncoder().encode(JSON.stringify([...p])));

  /** Write one waiting file; false when the network is still gone. */
  async function send(path: string, waiting: Set<string>): Promise<boolean> {
    const data = await cache.get(path).catch(() => null);
    try {
      if (data) await inner.write(path, data, "application/json");
    } catch (e) {
      if (offlineError(e)) return false;
      throw e;
    }
    waiting.delete(path);
    await savePending(waiting).catch(() => {});
    return true;
  }

  async function remember(path: string, data: Uint8Array) {
    try {
      // Re-adding moves a PDF to the end, so the oldest are dropped first.
      if (isPdf(path)) await cache.delete(path);
      await cache.put(path, data);
      if (isPdf(path)) {
        const pinned = await kept();
        const pdfs = (await cache.keys()).filter((k) => isPdf(k) && !pinned.has(k));
        for (const old of pdfs.slice(0, Math.max(0, pdfs.length - keepPdfs))) await cache.delete(old);
      }
    } catch {
      // A full or unavailable cache only means no offline copy.
    }
  }

  const s = {
    offline: false,
    async read(path) {
      // Highlights saved offline go out first, so the stored copy isn't older than this device's.
      if (canWait(path)) {
        const waiting = await pending();
        if (waiting.has(path) && !(await send(path, waiting).catch(() => false))) {
          s.offline = true;
          return cache.get(path);
        }
      }
      try {
        const data = await inner.read(path);
        if (data) remember(path, data);
        return data;
      } catch (e) {
        if (!offlineError(e)) throw e;
        const copy = await cache.get(path).catch(() => null);
        if (!copy) throw e;
        s.offline = true;
        return copy;
      }
    },
    async write(path, data, type) {
      try {
        await inner.write(path, data, type);
      } catch (e) {
        if (!offlineError(e) || !canWait(path)) throw e;
        await cache.put(path, typeof data === "string" ? new TextEncoder().encode(data) : data);
        const waiting = await pending();
        await savePending(waiting.add(path));
        s.offline = true;
        return;
      }
      remember(path, typeof data === "string" ? new TextEncoder().encode(data) : data);
    },
    async list(prefix) {
      try {
        return await inner.list(prefix);
      } catch (e) {
        if (!offlineError(e)) throw e;
        return [];
      }
    },
  } as OfflineStorage;
  s.kept = kept;
  s.keep = async (paths, limit, onProgress, signal) => {
    const m = await kept();
    let total = [...m.values()].reduce((a, b) => a + b, 0);
    const todo = [...new Set(paths)].filter((p) => !m.has(p));
    const result: KeepResult = { added: 0, failed: 0, full: false };
    for (const [i, path] of todo.entries()) {
      if (signal?.aborted) break;
      onProgress?.(i, todo.length);
      // A copy already here (opened recently) needs no download.
      const data = (await cache.get(path).catch(() => null)) ?? (await inner.read(path).catch(() => null));
      if (!data) {
        result.failed++;
        continue;
      }
      if (total + data.length > limit) {
        result.full = true;
        break;
      }
      try {
        await cache.put(path, data);
        m.set(path, data.length);
        await saveKept(m);
      } catch {
        // The browser refused more space.
        result.full = true;
        break;
      }
      total += data.length;
      result.added++;
    }
    onProgress?.(todo.length, todo.length);
    return result;
  };
  s.flush = async () => {
    const waiting = await pending();
    for (const path of [...waiting]) if (!(await send(path, waiting))) break;
    return waiting.size;
  };
  s.release = async (paths) => {
    const m = await kept();
    for (const p of paths) {
      if (!m.delete(p)) continue;
      await cache.delete(p).catch(() => {});
    }
    await saveKept(m).catch(() => {});
  };
  if (inner.remove) s.remove = (p) => inner.remove!(p).then(() => s.release([p])).then(() => cache.delete(p).catch(() => {}));
  if (inner.seed) s.seed = () => inner.seed!().catch((e) => (offlineError(e) ? [] : Promise.reject(e)));
  if (inner.access) s.access = () => inner.access!().catch(() => "write" as const);
  if (inner.listAll) s.listAll = (p) => inner.listAll!(p);
  return s;
}
