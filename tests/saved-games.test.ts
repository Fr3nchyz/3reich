import { describe, expect, it, vi } from "vitest";
import { newGame } from "../src/engine/game";
import type { JsonObject, SaveFile } from "../src/save/format";
import { fingerprint } from "../src/save/fingerprint";
import { createMemoryStore } from "../src/save/memoryStore";
import { createSavedGames, restoredSession, savedGameRows } from "../src/ui/savedGames";
import { CTX } from "./helpers";

function file(): SaveFile {
  const snapshot = JSON.parse(JSON.stringify(newGame(CTX.scenario, 1))) as JsonObject;
  return { format: 2, app: "3reich", title: "Named game", savedAt: "2026-11-01T00:00:00.000Z", gameVersion: "old",
    stateVersion: 1, scenario: CTX.scenario.id, seed: 1, humanSide: "allies", start: { kind: "new" },
    actions: [], setupActions: 0, snapshot, fingerprint: fingerprint(snapshot), logTail: ["Saved log"] };
}
function harness() {
  const store = createMemoryStore(), adopt = vi.fn(), loading = vi.fn();
  const games = createSavedGames({ store: Promise.resolve(store), scenarios: [CTX.scenario],
    timing: { now: () => 0, yield: () => Promise.resolve() }, adopt, loading });
  return { store, adopt, loading, games };
}
describe("spec 11 Saved games", () => {
  it("Part E/H: lists reserved slots first and preserves damaged entries independently", () => {
    const rows = savedGameRows([{ id: "named", value: file() }, { id: "earlier-game", value: file() },
      { id: "broken", value: null }, { id: "autosave", value: file() }, { id: "turn-backup", value: file() }], [CTX.scenario]);
    expect(rows.map(x => x.id)).toEqual(["autosave", "turn-backup", "earlier-game", "named", "broken"]);
    expect(rows[0]!.title).toBe("Autosave"); expect(rows[3]!.title).toBe("Named game");
    expect(rows[3]!.detail).toContain("Allies"); expect(rows[3]!.detail).toContain("1939");
    expect(rows[4]).toMatchObject({ detail: "Cannot be opened" }); expect(rows[4]!.save).toBeUndefined();
  });
  it("Part E touch flow 7: delete only after confirmation; cancel retains entry", async () => {
    const { store, games } = harness(); await store.put("named", file());
    expect(await games.delete("named", false)).toBe(false); expect(await games.list()).toHaveLength(1);
    expect(await games.delete("named", true)).toBe(true); expect(await games.list()).toEqual([]);
  });
  it("Part A/E: exact load adopts the saved side, seed, log, state and record without storage writes", async () => {
    const { store, games, adopt, loading } = harness(); const save = file(); await store.put("named", save);
    const put = vi.spyOn(store, "put"), progress = vi.fn();
    expect(await games.open("named", progress)).toMatchObject({ kind: "opened", via: "replay" });
    expect(adopt).toHaveBeenCalledWith(expect.objectContaining({ humanSide: "allies", seed: 1, state: save.snapshot, log: ["Saved log"], record: [] }), { kind: "new" });
    expect(progress).toHaveBeenCalledWith(0, 0); expect(loading.mock.calls).toEqual([[true], [false]]); expect(put).not.toHaveBeenCalled();
  });
  it("Part A/E sketch 5: validator offers rescue, never adopts until consent, and keeps older entry", async () => {
    const { store, games, adopt } = harness(); const save = file(); save.fingerprint = "00000000"; await store.put("named", save);
    expect(await games.open("named", () => {})).toMatchObject({ kind: "rescue" }); expect(adopt).not.toHaveBeenCalled();
    games.keep(); expect(games.acceptRescue()).toBe(false); expect((await games.list())[0]!.detail).toContain("Needs an older version");
    await games.open("named", () => {}); expect(games.acceptRescue()).toBe(true);
    expect(adopt).toHaveBeenCalledWith(expect.objectContaining({ record: [], state: save.snapshot }), { kind: "snapshot", state: save.snapshot });
    expect((await store.get("named"))).toEqual({ ok: true, value: save });
  });
  it("Part H: invalid invariant snapshot is refused and the current game is retained", async () => {
    const { store, games, adopt } = harness(); const save = file(); save.fingerprint = "00000000"; save.snapshot.rngState = -1;
    await store.put("bad", save); expect(await games.open("bad", () => {})).toMatchObject({ kind: "refused" }); expect(adopt).not.toHaveBeenCalled();
    expect(await games.list()).toHaveLength(1);
  });
  it("Part H: missing or damaged entry refuses without adopting or deleting", async () => {
    const { store, games, adopt } = harness(); await store.put("bad", null as unknown as SaveFile);
    expect(await games.open("absent", () => {})).toMatchObject({ kind: "refused", code: "storage" });
    expect(await games.open("bad", () => {})).toMatchObject({ kind: "refused", code: "invalid" });
    expect(adopt).not.toHaveBeenCalled(); expect(await games.list()).toHaveLength(1);
  });
  it("Part E/H: Cancel during storage read prevents adoption", async () => {
    const { store, games, adopt } = harness(); await store.put("named", file());
    const opening = games.open("named", () => {}); games.cancel();
    expect(await opening).toMatchObject({ kind: "refused", code: "cancelled" }); expect(adopt).not.toHaveBeenCalled();
  });
  it("Part A/B: exact snapshot fast path starts a fresh record at that position", () => {
    const save = file(); save.actions = [{ type: "END_STEP" }];
    const next = restoredSession({ kind: "opened", via: "snapshot", save, state: newGame(CTX.scenario, 1), message: "Opened" }, CTX.scenario);
    expect(next.session.record).toEqual([]); expect(next.start).toEqual({ kind: "snapshot", state: save.snapshot });
  });
  it("Part C/H: failed list and delete report failure without removing entries", async () => {
    const { store, games } = harness(); await store.put("named", file());
    vi.spyOn(store, "list").mockResolvedValue({ ok: false, code: "unavailable" });
    await expect(games.list()).rejects.toThrow("could not be read");
    vi.spyOn(store, "delete").mockResolvedValue({ ok: false, code: "unavailable" });
    expect(await games.delete("named", true)).toBe(false); expect((await store.get("named")).ok).toBe(true);
  });
});

it("spec 11 A/B/D: rescue, act, autosave and reopen retain the snapshot start", async () => {
  const { createAutosave } = await import("../src/ui/autosave");
  const { applyAction, legalActions } = await import("../src/engine/actions");
  const { store, games } = harness(); const save = file(); save.fingerprint = "00000000";
  await store.put("source", save);
  const result = await games.open("source", () => {});
  expect(result.kind).toBe("rescue"); if (result.kind !== "rescue") return;
  const next = restoredSession(result, CTX.scenario);
  const autosave = createAutosave({ store: { ...store, persistent: true }, gameVersion: "current", onError: () => {} });
  autosave.setStart(next.session, next.start); autosave.observe(next.session); autosave.arm();
  const action = legalActions(CTX, next.session.state)[0]!;
  const applied = applyAction(CTX, next.session.state, action); expect(applied.ok).toBe(true); if (!applied.ok) return;
  next.session.state = applied.state; next.session.record.push(action); autosave.observe(next.session); await autosave.flush(); autosave.dispose();
  const saved = await store.get("autosave"); expect(saved.ok).toBe(true);
  expect(saved).toMatchObject({ value: { start: { kind: "snapshot", state: save.snapshot }, actions: [action] } });
  expect(await games.open("autosave", () => {})).toMatchObject({ kind: "opened", via: "replay", state: applied.state });
});
