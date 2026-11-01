import type { SaveFile } from "./format";
import { createMemoryStore } from "./memoryStore";

// Spec 11 Parts C/H: platform failures are data; callers can keep playing.
export type StoreError = { ok: false; code: "quota" | "unavailable" };
export type StoreResult<T> = { ok: true; value: T } | StoreError;
export interface StoredSave { id: string; value: unknown }
export interface SaveStore {
  readonly persistent: boolean;
  list(): Promise<StoreResult<StoredSave[]>>;
  get(id: string): Promise<StoreResult<unknown>>;
  put(id: string, save: SaveFile): Promise<StoreResult<void>>;
  delete(id: string): Promise<StoreResult<void>>;
  requestPersistence(): Promise<StoreResult<boolean>>;
  close(): void;
}
export interface StoreOptions {
  factory?: IDBFactory;
  storage?: Pick<StorageManager, "persist">;
}
export type OpenStoreResult = { store: SaveStore; error?: StoreError };

// Spec 11 C/H: only quota exhaustion is reported as full; other failures mean unavailable.
export function storeError(error: unknown): StoreError {
  return { ok: false, code: typeof error === "object" && error !== null &&
    "name" in error && error.name === "QuotaExceededError" ? "quota" : "unavailable" };
}

// Spec 11 C: browser access is lazy and injectable; no engine or UI dependency.
export async function openSaveStore(options?: StoreOptions): Promise<OpenStoreResult> {
  let db: IDBDatabase;
  let storage: StoreOptions["storage"];
  try {
    const factory = options ? options.factory : globalThis.indexedDB;
    storage = options ? options.storage : globalThis.navigator?.storage;
    if (!factory) throw new Error("Storage unavailable");
    db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open("3reich-saves", 1);
      let settled = false;
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains("saves")) request.result.createObjectStore("saves");
      };
      request.onerror = () => reject(request.error ?? new Error("Storage open failed"));
      request.onblocked = () => { settled = true; reject(new Error("Storage blocked")); };
      request.onsuccess = () => {
        if (settled) request.result.close();
        else resolve(request.result);
      };
    });
  } catch (error) {
    return { store: createMemoryStore(), error: storeError(error) };
  }
  db.onversionchange = () => db.close();

  // Spec 11 D: success means transaction commit, never merely request success.
  const transaction = <T>(mode: IDBTransactionMode,
    run: (objectStore: IDBObjectStore, set: (value: T) => void) => void): Promise<StoreResult<T>> =>
    new Promise(resolve => {
      let tx: IDBTransaction | undefined;
      let value: T;
      try {
        tx = db.transaction("saves", mode);
        tx.oncomplete = () => resolve({ ok: true, value });
        tx.onabort = () => resolve(storeError(tx?.error));
        run(tx.objectStore("saves"), result => { value = result; });
      } catch (error) {
        if (tx) tx.abort();
        resolve(storeError(error));
      }
    });
  let persistence: Promise<StoreResult<boolean>> | undefined;
  return { store: {
    persistent: true,
    list: () => transaction("readonly", (objectStore, set) => {
      const entries: StoredSave[] = [];
      const request = objectStore.openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) { set(entries); return; }
        // Spec 11 C/H: slot keys are strings written by put; preserve unreadable values for the loader.
        entries.push({ id: cursor.key as string, value: cursor.value as unknown });
        cursor.continue();
      };
    }),
    get: id => transaction("readonly", (objectStore, set) => {
      const request = objectStore.get(id);
      request.onsuccess = () => set(request.result as unknown);
    }),
    put: (id, save) => transaction<void>("readwrite", objectStore => { objectStore.put(save, id); }),
    delete: id => transaction<void>("readwrite", objectStore => { objectStore.delete(id); }),
    // Spec 11 C: caller requests after first autosave; cache even denial/failure, never require a grant.
    requestPersistence: () => persistence ??= (async () => {
      try { return { ok: true, value: storage ? await storage.persist() : false } as const; }
      catch (error) { return storeError(error); }
    })(),
    close: () => db.close(),
  } };
}
