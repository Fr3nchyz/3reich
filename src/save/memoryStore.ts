import type { SaveStore } from "./store";
import { storeError } from "./store";
import type { SaveFile } from "./format";

// Spec 11 C: volatile fallback is explicit so callers can disable autosave and show the notice.
export function createMemoryStore(): SaveStore {
  const saves = new Map<string, SaveFile>();
  return {
    persistent: false,
    // Spec 11 C/H: copies match IndexedDB ownership; unreadable data is never silently removed.
    list: () => Promise.resolve({ ok: true, value: [...saves].map(([id, value]) => ({ id, value: structuredClone(value) })) }),
    get: id => Promise.resolve({ ok: true, value: structuredClone(saves.get(id)) }),
    put: (id, save) => {
      try {
        // Spec 11 D: clone before replacement, leaving the old entry on failure.
        const copy = structuredClone(save);
        saves.set(id, copy);
        return Promise.resolve({ ok: true, value: undefined });
      } catch (error) { return Promise.resolve(storeError(error)); }
    },
    delete: id => { saves.delete(id); return Promise.resolve({ ok: true, value: undefined }); },
    requestPersistence: () => Promise.resolve({ ok: true, value: false }),
    close: () => {},
  };
}
