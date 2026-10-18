import type { StorageAdapter } from "./types";

// Keeps a copy of what was last read from remote storage (the library, notes
// and recently opened PDFs) so the app still opens and reads without a
// network. Writes still go straight to storage.

/** The few Cache API calls used, so tests can pass a Map instead. */
export interface ByteCache {
  get(key: string): Promise<Uint8Array | null>;
  put(key: string, data: Uint8Array): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

export const KEEP_PDFS = 25;

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
}

const noCache: ByteCache = { get: async () => null, put: async () => {}, delete: async () => {}, keys: async () => [] };

export function withOfflineCache(inner: StorageAdapter, maybeCache: ByteCache | null, keepPdfs = KEEP_PDFS): OfflineStorage {
  const cache = maybeCache ?? noCache;
  const isPdf = (p: string) => /\.pdf$/i.test(p);

  async function remember(path: string, data: Uint8Array) {
    try {
      // Re-adding moves a PDF to the end, so the oldest are dropped first.
      if (isPdf(path)) await cache.delete(path);
      await cache.put(path, data);
      if (isPdf(path)) {
        const pdfs = (await cache.keys()).filter(isPdf);
        for (const old of pdfs.slice(0, Math.max(0, pdfs.length - keepPdfs))) await cache.delete(old);
      }
    } catch {
      // A full or unavailable cache only means no offline copy.
    }
  }

  const s: OfflineStorage = {
    offline: false,
    async read(path) {
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
      await inner.write(path, data, type);
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
  };
  if (inner.remove) s.remove = (p) => inner.remove!(p).then(() => cache.delete(p).catch(() => {}));
  if (inner.seed) s.seed = () => inner.seed!().catch((e) => (offlineError(e) ? [] : Promise.reject(e)));
  if (inner.access) s.access = () => inner.access!().catch(() => "write" as const);
  if (inner.listAll) s.listAll = (p) => inner.listAll!(p);
  return s;
}
