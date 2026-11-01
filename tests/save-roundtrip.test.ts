import { expect, it, vi } from "vitest";
import { SCENARIOS, SCENARIO_KEYS } from "../scripts/selfplay/scenarios";
import { runGame } from "../scripts/selfplay/runner";
import { replay } from "../src/engine/actions";
import { newGame } from "../src/engine/game";
import { fingerprint } from "../src/save/fingerprint";
import type { SaveFile, JsonObject } from "../src/save/format";
import { readSave } from "../src/save/validate";
import { restore } from "../src/save/restore";
import { createMemoryStore } from "../src/save/memoryStore";
import { createAutosave, AUTOSAVE_SLOT, bindAutosaveLifecycle } from "../src/ui/autosave";
import { newSession, run } from "../src/ui/session";
import { ctxFor } from "./helpers";

it.fails.each(SCENARIO_KEYS)("TODO(verify) AER54 spec 11 Parts B/I E3/E4: %s two-seed short-game cuts round trip", async key => {
  const scenario = SCENARIOS[key];
  for (const seed of [1, 2]) {
    const game = runGame({ scenario: key, seed, turns: 1, verify: false });
    expect(game.actions.length).toBeGreaterThan(game.setupActions);
    for (const cut of [game.setupActions, game.setupActions + 5, game.actions.length]) {
      const session = newSession(scenario, "axis", seed);
      expect(run(session, ...game.actions.slice(0, cut))).toBe(true);
      const state = session.state;
      const save: SaveFile = { format: 2, app: "3reich", title: key,
        savedAt: "2026-11-01T00:00:00.000Z", gameVersion: "test", stateVersion: 1,
        scenario: scenario.id, seed, humanSide: "axis", start: { kind: "new" },
        actions: JSON.parse(JSON.stringify(session.record)) as JsonObject[], setupActions: game.setupActions,
        snapshot: JSON.parse(JSON.stringify(state)) as JsonObject, fingerprint: fingerprint(state) };
      const store = createMemoryStore();
      expect((await store.put("roundtrip", save)).ok).toBe(true);
      const entry = await store.get("roundtrip");
      if (!entry.ok) throw Error(entry.code);
      const source = JSON.stringify(entry.value);
      expect(readSave(source, [scenario]).ok).toBe(true);
      const opened = await restore(source, ctxFor(scenario), { now: () => 0,
        yield: async () => {}, cancelled: () => false, validateSnapshot: () => undefined });
      expect(opened.kind).toBe("opened");
      if (opened.kind !== "opened") throw Error(opened.message);
      expect(opened.via).toBe("replay");
      expect(opened.state).toEqual(state);
      expect(fingerprint(opened.state)).toBe(save.fingerprint);
      expect(replay(session.ctx, newGame(scenario, seed), session.record).state).toEqual(state);
      const reversed = Object.fromEntries(Object.entries(state).reverse());
      expect(fingerprint(reversed)).toBe(save.fingerprint);
    }
  }
});

it("spec 11 Parts D/H: real session record autosaves after debounce and hidden flush restores exactly", async () => {
  vi.useFakeTimers();
  const memory = createMemoryStore();
  const put = vi.fn<typeof memory.put>((id, save) => memory.put(id, save));
  const store = { ...memory, persistent: true, put };
  const autosave = createAutosave({ store, gameVersion: "test", onError: error => { throw Error(error.code); } });
  const session = newSession(SCENARIOS["1939"], "allies", 1);
  const doc = Object.assign(new EventTarget(), { visibilityState: "hidden" as const });
  const unbind = bindAutosaveLifecycle(autosave, doc, new EventTarget());
  try {
    autosave.observe(session);
    await vi.advanceTimersByTimeAsync(6000);
    expect(put).not.toHaveBeenCalled();
    const actions = runGame({ scenario: "1939", seed: 1, turns: 1, verify: false }).actions;
    expect(run(session, actions[0]!)).toBe(true);
    autosave.observe(session);
    await vi.advanceTimersByTimeAsync(999);
    expect(put).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(put).toHaveBeenCalledTimes(1);
    expect(run(session, actions[1]!)).toBe(true);
    autosave.observe(session);
    doc.dispatchEvent(new Event("visibilitychange"));
    await autosave.flush();
    expect(put).toHaveBeenCalledTimes(2);
    const entry = await store.get(AUTOSAVE_SLOT);
    if (!entry.ok) throw Error(entry.code);
    const result = await restore(JSON.stringify(entry.value), session.ctx, { now: () => 0,
      yield: async () => {}, cancelled: () => false, validateSnapshot: () => undefined });
    expect(result).toMatchObject({ kind: "opened", state: session.state });
  } finally { unbind(); autosave.dispose(); vi.useRealTimers(); }
});
