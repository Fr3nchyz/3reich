import { describe, expect, it } from "vitest";
import type { SaveFile } from "../src/save/format";
import { createMemoryStore } from "../src/save/memoryStore";
import { openSaveStore } from "../src/save/store";

const save = (title = "A game"): SaveFile => ({
  format: 2, app: "3reich", title, savedAt: "2026-11-01T00:00:00.000Z", gameVersion: "test",
  stateVersion: 1, scenario: "1939", seed: 1, humanSide: "axis", start: { kind: "new" },
  actions: [], setupActions: 0, snapshot: {}, fingerprint: "12345678",
});

// Spec 11 C/D/H: asynchronous factory double models request success followed by commit or abort.
function database() {
  const data = new Map<string, unknown>();
  const control = { fail: "", blocked: false, openError: false, closed: 0, created: 0, writes: 0 };
  const db = {
    objectStoreNames: { contains: () => false },
    createObjectStore: () => { control.created++; },
    close: () => { control.closed++; },
    onversionchange: undefined as (() => void) | undefined,
    transaction: (_name: string, mode: string) => {
      if (control.fail === "throw") throw new DOMException("blocked", "SecurityError");
      const pending = new Map(data);
      const tx = {
        error: null as DOMException | null,
        oncomplete: undefined as (() => void) | undefined,
        onerror: undefined as (() => void) | undefined,
        onabort: undefined as (() => void) | undefined,
        abort: () => { tx.onabort?.(); },
        objectStore: () => ({
          get: (id: string) => {
            const request = { result: structuredClone(data.get(id)), onsuccess: undefined as (() => void) | undefined };
            queueMicrotask(() => request.onsuccess?.());
            return request;
          },
          put: (value: unknown, id: string) => { control.writes++; pending.set(id, structuredClone(value)); },
          delete: (id: string) => { pending.delete(id); },
          openCursor: () => {
            const entries = [...data];
            let index = 0;
            const request = { result: null as unknown, onsuccess: undefined as (() => void) | undefined };
            const next = () => {
              const entry = entries[index++];
              request.result = entry ? { key: entry[0], value: structuredClone(entry[1]), continue: next } : null;
              request.onsuccess?.();
            };
            queueMicrotask(next);
            return request;
          },
        }),
      };
      setTimeout(() => {
        if (control.fail) {
          tx.onerror?.();
          tx.error = new DOMException("failed", control.fail);
          tx.onabort?.();
        } else {
          if (mode === "readwrite") { data.clear(); for (const [key, value] of pending) data.set(key, value); }
          tx.oncomplete?.();
        }
      }, 0);
      return tx;
    },
  };
  const factory = { open: () => {
    const request = {
      result: db, error: new DOMException("blocked", "SecurityError"),
      onupgradeneeded: undefined as (() => void) | undefined,
      onblocked: undefined as (() => void) | undefined,
      onerror: undefined as (() => void) | undefined,
      onsuccess: undefined as (() => void) | undefined,
    };
    queueMicrotask(() => {
      if (control.openError) { request.onerror?.(); return; }
      if (control.blocked) { request.onblocked?.(); request.onsuccess?.(); return; }
      request.onupgradeneeded?.(); request.onsuccess?.();
    });
    return request;
  } } as unknown as IDBFactory;
  return { factory, data, control, db };
}

for (const kind of ["memory", "indexed"] as const) {
  describe(`spec 11 C/D: ${kind} SaveStore`, () => {
    const make = async () => kind === "memory" ? createMemoryStore() : (await openSaveStore(database())).store;
    it("Part C: lists, gets, replaces and deletes independent slots", async () => {
      const store = await make();
      expect(store.persistent).toBe(kind === "indexed");
      expect(await store.list()).toEqual({ ok: true, value: [] });
      expect(await store.get("missing")).toEqual({ ok: true, value: undefined });
      expect(await store.put("auto", save())).toEqual({ ok: true, value: undefined });
      await store.put("named", save("Other"));
      await store.put("auto", save("Replaced"));
      expect(await store.get("auto")).toEqual({ ok: true, value: save("Replaced") });
      expect(await store.list()).toEqual({ ok: true, value: [
        { id: "auto", value: save("Replaced") }, { id: "named", value: save("Other") },
      ] });
      expect(await store.delete("auto")).toEqual({ ok: true, value: undefined });
      await store.delete("absent");
      expect(await store.get("auto")).toEqual({ ok: true, value: undefined });
      expect(await store.get("named")).toEqual({ ok: true, value: save("Other") });
      store.close();
    });
    it("Part C/D: copies inputs and returned data", async () => {
      const store = await make(); const input = save();
      await store.put("auto", input); input.snapshot.changed = true;
      const got = await store.get("auto");
      if (!got.ok) throw new Error("get failed");
      (got.value as SaveFile).snapshot.changed = true;
      const listed = await store.list();
      if (!listed.ok) throw new Error("list failed");
      (listed.value[0]!.value as SaveFile).title = "changed";
      expect(await store.get("auto")).toEqual({ ok: true, value: save() });
    });
  });
}

describe("spec 11 C/D/H: storage failures and persistence", () => {
  it("Part C: absent, throwing, failed and blocked factories fall back explicitly", async () => {
    const failing = database(); failing.control.openError = true;
    const blocked = database(); blocked.control.blocked = true;
    for (const options of [{}, { factory: { open() { throw new Error("denied"); } } as unknown as IDBFactory }, failing, blocked]) {
      const result = await openSaveStore(options);
      expect(result.error).toEqual({ ok: false, code: "unavailable" });
      expect(result.store.persistent).toBe(false);
      expect(await result.store.put("manual", save())).toEqual({ ok: true, value: undefined });
      expect(await result.store.get("manual")).toEqual({ ok: true, value: save() });
      expect(await result.store.requestPersistence()).toEqual({ ok: true, value: false });
    }
    expect(blocked.control.closed).toBe(1);
  });
  it("Part D/H: aborted quota replacement retains the previous entry and other slots", async () => {
    const fake = database(); const { store } = await openSaveStore(fake);
    await store.put("auto", save()); await store.put("other", save("Other"));
    fake.control.fail = "QuotaExceededError";
    expect(await store.put("auto", save("Lost"))).toEqual({ ok: false, code: "quota" });
    fake.control.fail = "";
    expect(await store.get("auto")).toEqual({ ok: true, value: save() });
    expect(await store.get("other")).toEqual({ ok: true, value: save("Other") });
  });
  it("Part C/H: transaction failures for each operation are data", async () => {
    const fake = database(); const { store } = await openSaveStore(fake);
    for (const failure of ["UnknownError", "throw"]) {
      fake.control.fail = failure;
      for (const result of [await store.list(), await store.get("a"), await store.put("a", save()), await store.delete("a")]) {
        expect(result).toEqual({ ok: false, code: "unavailable" });
      }
    }
  });
  it("Part D: memory clone failure retains the previous entry", async () => {
    const store = createMemoryStore(); await store.put("a", save());
    const broken = save(); broken.snapshot.bad = (() => {}) as unknown as string;
    expect(await store.put("a", broken)).toEqual({ ok: false, code: "unavailable" });
    expect(await store.get("a")).toEqual({ ok: true, value: save() });
  });
  it("Part H: damaged entries stay listed, retrievable and deletable alongside good ones", async () => {
    const fake = database(); fake.data.set("damaged", "not a save");
    const { store } = await openSaveStore(fake); await store.put("good", save());
    expect(await store.list()).toEqual({ ok: true, value: [
      { id: "damaged", value: "not a save" }, { id: "good", value: save() },
    ] });
    expect(await store.get("damaged")).toEqual({ ok: true, value: "not a save" });
    await store.delete("damaged");
    expect(await store.get("good")).toEqual({ ok: true, value: save() });
  });
  it("Part C: persistence is explicit, requested once, and independent of writes", async () => {
    for (const granted of [true, false, "throw"] as const) {
      const fake = database(); let calls = 0;
      const { store } = await openSaveStore({ ...fake, storage: { persist: async () => {
        calls++; if (granted === "throw") throw new Error("denied"); return granted;
      } } });
      expect(calls).toBe(0); await store.put("auto", save()); expect(calls).toBe(0);
      const results = await Promise.all([store.requestPersistence(), store.requestPersistence()]);
      expect(results).toEqual(Array(2).fill(granted === "throw" ? { ok: false, code: "unavailable" } : { ok: true, value: granted }));
      expect(calls).toBe(1);
      expect(await store.put("auto", save("Still works"))).toEqual({ ok: true, value: undefined });
    }
  });
  it("Part C: missing persistence API is harmless; connections close on request and version change", async () => {
    const fake = database(); const { store } = await openSaveStore(fake);
    expect(fake.control.created).toBe(1);
    expect(await store.requestPersistence()).toEqual({ ok: true, value: false });
    fake.db.onversionchange?.(); store.close(); expect(fake.control.closed).toBe(2);
  });
});
