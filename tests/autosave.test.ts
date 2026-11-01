import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { newSession, type Session } from "../src/ui/session";
import { createMemoryStore } from "../src/save/memoryStore";
import type { SaveStore } from "../src/save/store";
import type { SaveFile } from "../src/save/format";
import { fingerprint } from "../src/save/fingerprint";
import { readSave } from "../src/save/validate";
import { bindAutosaveLifecycle, createAutosave, AUTOSAVE_SLOT, EARLIER_GAME_SLOT, TURN_BACKUP_SLOT } from "../src/ui/autosave";

// Spec 11 Part D: policy tests model accepted action batches; engine legality is tested separately.
function action(s: Session, side = s.humanSide): void {
  s.record.push({ type: "END_STEP", side, step: "6f" });
}
function harness(persistent = true) {
  const memory = createMemoryStore();
  const store = { ...memory, persistent, put: vi.fn((id: string, save: SaveFile) => memory.put(id, save)),
    requestPersistence: vi.fn(() => memory.requestPersistence()) };
  const onError = vi.fn();
  const autosave = createAutosave({ store, gameVersion: "0.1.0", onError,
    now: () => new Date("2026-01-01T00:00:00.000Z"), timers: { setTimeout, clearTimeout } });
  const s = newSession(SCENARIO_1939, "axis", 1);
  autosave.observe(s);
  return { autosave, s, store, onError };
}
async function entry(store: SaveStore, id = AUTOSAVE_SLOT): Promise<SaveFile | undefined> {
  const result = await store.get(id);
  if (!result.ok) throw new Error(result.code);
  return result.value as SaveFile | undefined;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("autosave policy, spec 11 Parts B/C/D/G/H", () => {
  it("Part D: no save before the first human action, including computer setup and refused taps", async () => {
    const { autosave, s, store } = harness();
    action(s, "allies"); autosave.observe(s);
    s.toast = "refused"; autosave.observe(s);
    await vi.advanceTimersByTimeAsync(6000); await autosave.flush();
    expect(store.put).not.toHaveBeenCalled();
  });

  it("Part D: debounce resets at each action and writes the latest immutable format-2 position", async () => {
    const { autosave, s, store } = harness();
    action(s); autosave.observe(s);
    await vi.advanceTimersByTimeAsync(900);
    action(s); autosave.observe(s);
    await vi.advanceTimersByTimeAsync(999);
    expect(store.put).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    const saved = (await entry(store))!;
    expect(saved.actions).toHaveLength(2);
    expect(saved.fingerprint).toBe(fingerprint(s.state));
    expect(saved.savedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(saved.seed).toBe(1);
    expect(saved.humanSide).toBe("axis");
    expect(saved.start).toEqual({ kind: "new" });
    expect(readSave(JSON.stringify(saved), [SCENARIO_1939]).ok).toBe(true);
    s.state.year++; action(s);
    expect((await entry(store))!.snapshot).toEqual(saved.snapshot);
    expect(store.put).toHaveBeenCalledTimes(1);
    expect(store.requestPersistence).toHaveBeenCalledTimes(1);
  });

  it("Part D: continuous actions flush at five seconds without waiting for silence", async () => {
    const { autosave, s, store } = harness();
    action(s); autosave.observe(s);
    for (let i = 0; i < 6; i++) { await vi.advanceTimersByTimeAsync(800); action(s); autosave.observe(s); }
    expect(store.put).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect((await entry(store))!.actions).toHaveLength(7);
    expect(store.put).toHaveBeenCalledTimes(1);
  });

  it("Part D: step changes flush immediately; 10b copies the same position to Turn backup", async () => {
    const { autosave, s, store } = harness();
    action(s); s.state.phase = "player-turn"; s.state.position = { part: "player-turn", turn: 1, step: "6f" };
    autosave.observe(s); await autosave.flush();
    expect(store.put).toHaveBeenCalledTimes(1);
    action(s); s.state.position = { part: "player-turn", turn: 1, step: "10b" };
    autosave.observe(s); await autosave.flush();
    const backup = (await entry(store, TURN_BACKUP_SLOT))!;
    expect(backup.actions).toHaveLength(2);
    expect(backup.snapshot).toEqual((await entry(store))!.snapshot);
    expect(backup.fingerprint).toBe((await entry(store))!.fingerprint);
    expect(store.requestPersistence).toHaveBeenCalledTimes(1);
  });

  it("Part D: explicit arm permits the next computer action; refused actions still write nothing", async () => {
    const { autosave, s, store } = harness();
    autosave.arm(); autosave.observe(s); await autosave.flush();
    expect(store.put).not.toHaveBeenCalled();
    action(s, "allies"); autosave.observe(s); await autosave.flush();
    expect(store.put).toHaveBeenCalledTimes(1);
  });

  it("Part D: a fresh game preserves Autosave until acted on, then rotates only once", async () => {
    const { autosave, s, store } = harness();
    action(s); autosave.observe(s); await autosave.flush();
    const old = await entry(store);
    const next = newSession(SCENARIO_1939, "axis", 2); autosave.observe(next);
    await autosave.flush(); expect(await entry(store)).toEqual(old);
    action(next); autosave.observe(next); await autosave.flush();
    expect(await entry(store, EARLIER_GAME_SLOT)).toEqual(old);
    action(next); autosave.observe(next); await autosave.flush();
    expect(await entry(store, EARLIER_GAME_SLOT)).toEqual(old);
    expect((await entry(store))!.seed).toBe(2);
  });

  it("Parts D/H: loading suppresses timers and flushes; a failed load never writes", async () => {
    const { autosave, s, store } = harness();
    action(s); autosave.observe(s); autosave.setLoading(true);
    action(s); autosave.observe(s); await autosave.flush();
    await vi.advanceTimersByTimeAsync(6000);
    autosave.setLoading(false); autosave.observe(s); await autosave.flush();
    expect(store.put).not.toHaveBeenCalled();
    action(s); autosave.observe(s); await autosave.flush();
    expect(store.put).toHaveBeenCalledTimes(1);
  });

  it("Parts D/G: watch never saves; takeover arms and retains the entire record", async () => {
    const { autosave, s, store } = harness();
    s.watch = {} as NonNullable<Session["watch"]>;
    action(s); autosave.observe(s); autosave.arm(); await autosave.flush();
    await vi.advanceTimersByTimeAsync(6000); expect(store.put).not.toHaveBeenCalled();
    s.watch = undefined; autosave.observe(s); await autosave.flush();
    expect((await entry(store))!.actions).toHaveLength(1);
  });

  it("Part C: volatile fallback disables autosave and persistence requests", async () => {
    const { autosave, s, store } = harness(false);
    action(s); autosave.observe(s); await autosave.flush();
    expect(store.put).not.toHaveBeenCalled();
    expect(store.requestPersistence).not.toHaveBeenCalled();
  });

  it("Parts D/H: quota failure retains the previous entry and reports it without stopping play", async () => {
    const { autosave, s, store, onError } = harness();
    action(s); autosave.observe(s); await autosave.flush();
    const old = await entry(store);
    vi.mocked(store.put).mockResolvedValueOnce({ ok: false, code: "quota" });
    action(s); autosave.observe(s); await autosave.flush();
    expect(await entry(store)).toEqual(old);
    expect(onError).toHaveBeenCalledWith({ ok: false, code: "quota" });
    action(s); autosave.observe(s); await autosave.flush();
    expect((await entry(store))!.actions).toHaveLength(3);
  });

  it("Part D: hide and pagehide flush; visible does not; cleanup removes both listeners", async () => {
    const { autosave, s, store } = harness();
    const doc = Object.assign(new EventTarget(), { visibilityState: "visible" as DocumentVisibilityState });
    const win = new EventTarget();
    const unbind = bindAutosaveLifecycle(autosave, doc, win);
    action(s); autosave.observe(s);
    doc.dispatchEvent(new Event("visibilitychange")); await Promise.resolve();
    expect(store.put).not.toHaveBeenCalled();
    doc.visibilityState = "hidden"; doc.dispatchEvent(new Event("visibilitychange")); await autosave.flush();
    expect(store.put).toHaveBeenCalledTimes(1);
    action(s); autosave.observe(s); win.dispatchEvent(new Event("pagehide")); await autosave.flush();
    expect(store.put).toHaveBeenCalledTimes(2);
    unbind(); action(s); autosave.observe(s);
    win.dispatchEvent(new Event("pagehide")); doc.dispatchEvent(new Event("visibilitychange"));
    await Promise.resolve(); expect(store.put).toHaveBeenCalledTimes(2);
    autosave.dispose(); await vi.advanceTimersByTimeAsync(6000);
    expect(store.put).toHaveBeenCalledTimes(2);
  });

  it("Part D: writes queue in order and capture the position before storage opens", async () => {
    const memory = createMemoryStore();
    const store = { ...memory, persistent: true };
    let open!: (store: SaveStore) => void;
    const pending = new Promise<SaveStore>(resolve => { open = resolve; });
    const autosave = createAutosave({ store: pending, gameVersion: "test", onError: vi.fn() });
    const first = newSession(SCENARIO_1939, "axis", 1); autosave.observe(first);
    action(first); autosave.observe(first); const write1 = autosave.flush();
    action(first); autosave.observe(first); const write2 = autosave.flush();
    const second = newSession(SCENARIO_1939, "allies", 2); autosave.observe(second);
    action(second); autosave.observe(second); const write3 = autosave.flush();
    first.state.year++;
    open(store); await Promise.all([write1, write2, write3]);
    expect((await entry(store))!.seed).toBe(2);
    const earlier = (await entry(store, EARLIER_GAME_SLOT))!;
    expect(earlier.actions).toHaveLength(2);
    expect(earlier.snapshot.year).not.toBe(first.state.year);
  });

  it("Parts D/H: a failed Earlier game write prevents replacing Autosave", async () => {
    const { autosave, s, store, onError } = harness();
    action(s); autosave.observe(s); await autosave.flush();
    const old = await entry(store);
    const next = newSession(SCENARIO_1939, "axis", 2); autosave.observe(next);
    vi.mocked(store.put).mockResolvedValueOnce({ ok: false, code: "quota" });
    action(next); autosave.observe(next); await autosave.flush();
    expect(await entry(store)).toEqual(old);
    expect(await entry(store, EARLIER_GAME_SLOT)).toBeUndefined();
    expect(onError).toHaveBeenCalledWith({ ok: false, code: "quota" });
  });

  it("Part D: switching games flushes pending progress; repeated redraws add no writes", async () => {
    const { autosave, s, store } = harness();
    action(s); autosave.observe(s);
    autosave.observe(newSession(SCENARIO_1939, "axis", 2));
    await autosave.flush();
    expect((await entry(store))!.seed).toBe(1);
    await vi.advanceTimersByTimeAsync(6000);
    expect(store.put).toHaveBeenCalledTimes(1);
  });

  it("Parts B/D: setup and log tail are included, persistence denial does not block later writes", async () => {
    const { autosave, s, store } = harness();
    s.record.push({ type: "SETUP_DONE", owner: "germany" });
    s.log = Array.from({ length: 65 }, (_, i) => `line ${i}`);
    autosave.observe(s); await autosave.flush();
    expect((await entry(store))!.setupActions).toBe(1);
    expect((await entry(store))!.logTail).toEqual(s.log.slice(-60));
    action(s); autosave.observe(s); await autosave.flush();
    expect(store.put).toHaveBeenCalledTimes(2);
    expect(store.requestPersistence).toHaveBeenCalledTimes(1);
  });

});
