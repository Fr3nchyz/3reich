import { expect, it } from "vitest";
import { chooseAction } from "../src/ai";
import { createMemory, exportMemory, importMemory } from "../src/ai/memory";
import { autoSetup } from "../src/engine/autosetup";
import { fingerprint } from "../src/save/fingerprint";
import { restore } from "../src/save/restore";
import { SCENARIOS, SCENARIO_KEYS } from "../scripts/selfplay/scenarios";
import { newSession, run } from "../src/ui/session";

it.fails.each(SCENARIO_KEYS)("TODO(verify) AER54 spec 11 Part I/E5: %s restored position continues with identical state hash", async key => {
  const session = newSession(SCENARIOS[key], "axis", 1);
  expect(run(session, ...autoSetup(session.ctx, session.state))).toBe(true);
  const memory = createMemory();
  for (let i = 0; i < 15; i++) {
    const choice = chooseAction(session.ctx, session.state, { seed: 1, memory });
    if (!choice) throw Error("Short game unexpectedly stopped");
    expect(run(session, choice.action)).toBe(true);
  }
  // Spec 11 B/E5: helper memory round trip is separate; AER53 envelope omits policy counters.
  const restoredMemory = importMemory(JSON.parse(JSON.stringify(exportMemory(memory))));
  const source = JSON.stringify({ format: 2, app: "3reich", title: key,
    savedAt: "2026-11-01T00:00:00.000Z", gameVersion: "test", stateVersion: 1,
    scenario: session.ctx.scenario.id, seed: 1, humanSide: "axis", start: { kind: "new" },
    actions: session.record, setupActions: session.record.filter(a => a.type.startsWith("SETUP_")).length,
    snapshot: session.state, fingerprint: fingerprint(session.state) });
  const opened = await restore(source, session.ctx, { now: () => 0, yield: async () => {},
    cancelled: () => false, validateSnapshot: () => undefined });
  if (opened.kind !== "opened") throw Error(opened.message);
  const resumed = newSession(SCENARIOS[key], "axis", 1);
  resumed.state = opened.state;
  for (let i = 0; i < 200; i++) {
    const before = chooseAction(session.ctx, session.state, { seed: 1, memory });
    const after = chooseAction(resumed.ctx, resumed.state, { seed: 1, memory: restoredMemory });
    expect(after).toEqual(before);
    if (!before || !after) break;
    expect(run(session, before.action)).toBe(true);
    expect(run(resumed, after.action)).toBe(true);
    expect(fingerprint(resumed.state)).toBe(fingerprint(session.state));
  }
  expect(resumed.state).toEqual(session.state);
});

// Spec 11 B/I, TODO(verify) AER53: SaveFile memory and SavedMemory have incompatible shapes;
// the envelope also omits quietSince/stallTurn. Source fixes are outside ticket 11-10.
it.todo("spec 11 B/I AER53: continuation imports all policy memory from the restored save envelope");
