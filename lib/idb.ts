/**
 * One IndexedDB connection for the whole app.
 *
 * Both UIs kept in this repo persist their chats locally, and both used to open
 * the same database name at the same version with a *different* object store.
 * The second opener never receives `onupgradeneeded` (the version already
 * matches), so its store simply does not exist and every read throws
 * NotFoundError. Creating both stores here, at version 2, removes that trap.
 */

export const DB_NAME = "aiwish";
export const DB_VERSION = 2;

/** Store used by components/ChatApp.tsx (via lib/store.ts). */
export const CHATS_STORE = "chats";
/** Store used by the /basic UI (via app/lib/db.ts). */
export const CONVERSATIONS_STORE = "conversations";

export const ALL_STORES = [CHATS_STORE, CONVERSATIONS_STORE] as const;

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDB(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB is unavailable"));
  }
  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of ALL_STORES) {
        if (db.objectStoreNames.contains(name)) continue;
        const store = db.createObjectStore(name, { keyPath: "id" });
        store.createIndex("updatedAt", "updatedAt");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("IndexedDB upgrade blocked by another tab"));
  }).catch((err) => {
    // Let a later call retry instead of caching the rejection forever.
    dbPromise = null;
    throw err;
  });

  return dbPromise;
}

export function runTx<T>(
  storeName: string,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDB().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(storeName, mode);
        const req = run(t.objectStore(storeName));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}
