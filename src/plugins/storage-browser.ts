import type { LightkonePlugin, StorageAdapter } from "../core/types";

// Keeps the library in this browser (IndexedDB). Free and private, but only on
// this device: good for trying Lightkone out, or as an offline scratch library.

const DB = "lightkone";
const STORE = "files";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const req = fn(db.transaction(STORE, mode).objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

const encoder = new TextEncoder();

export function browserStorage(): StorageAdapter {
  return {
    async read(path) {
      const v = await tx<Uint8Array | undefined>("readonly", (s) => s.get(path));
      return v ?? null;
    },
    async write(path, data) {
      await tx("readwrite", (s) => s.put(typeof data === "string" ? encoder.encode(data) : data, path));
    },
    async list(prefix) {
      const keys = await tx<IDBValidKey[]>("readonly", (s) => s.getAllKeys());
      return keys.map(String).filter((k) => k.startsWith(prefix));
    },
    async remove(path) {
      await tx("readwrite", (s) => s.delete(path));
    },
  };
}

const plugin: LightkonePlugin = {
  id: "storage-browser",
  name: "This browser",
  storage: [
    {
      id: "browser",
      label: "This browser only",
      description: "Stored in this browser on this device. Nothing leaves it, and nothing syncs.",
      fields: [],
      create: () => browserStorage(),
    },
  ],
};
export default plugin;
