import { describe, expect, it } from "vitest";
import { MAP } from "../src/data/map";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { SCENARIO_1942 } from "../src/data/scenario-1942";
import { SCENARIO_1944 } from "../src/data/scenario-1944";
import { SCENARIO_CAMPAIGN } from "../src/data/scenario-campaign";
import { chooseAction } from "../src/ai";
import { applyAction, legalActions } from "../src/engine/actions";
import { autoSetup } from "../src/engine/autosetup";
import { combatOf } from "../src/engine/combat-record";
import type { GameContext } from "../src/engine/context";
import { newGame, turnIndex } from "../src/engine/game";
import type { GameState, Scenario, Unit } from "../src/engine/types";
import { computerTick, computerToMove } from "../src/ui/computerPlay";
import { createSession } from "../src/ui/session";
import { CTX, atStart } from "./helpers";

/** The computer at step 7h (spec 04/05): it attacks only at good odds (ai-assault.test.ts) and never gets stuck there. */

const u = (id: string, owner: Unit["owner"], strength: number, at: string): Unit => ({ id, owner, type: "infantry", strength, at });
const at7h = (units: Unit[], seed: number, extra: Partial<GameState> = {}): GameState => ({
  ...atStart(SCENARIO_1939, 1), activeSide: "axis", position: { part: "player-turn", turn: 1, step: "7h" },
  units: Object.fromEntries(units.map((x) => [x.id, x])), rngState: seed, ...extra,
});
const ok = (r: ReturnType<typeof applyAction>) => { if (!r.ok) throw new Error(r.error); return r.state; };
/** Exchange 1-1 column needs a first roll of 1 or 4; this seed gives one (the test checks it). */
const EXCHANGE_SEED = (() => {
  for (let seed = 1; seed < 1000; seed++) {
    const s = at7h([u("g1", "germany", 2, "M32"), u("g2", "germany", 2, "M32"), u("p1", "poland", 2, "M33")], seed);
    if (combatOf(ok(applyAction(CTX, s, { type: "ATTACK", side: "axis", units: ["g1", "g2"], target: "M33" }))).pending) return seed;
  }
  throw new Error("no seed");
})();

describe("the computer at step 7h", () => {
  it("ends the step when attacks are legal but none is worth making (1-2 odds)", () => {
    const s = at7h([u("g1", "germany", 1, "M32"), u("p1", "poland", 2, "M33")], 1);
    expect(legalActions(CTX, s).some((a) => a.type === "ATTACK")).toBe(true);
    expect(chooseAction(CTX, s, { seed: 1 })!.action).toEqual({ type: "END_STEP", side: "axis", step: "7h" });
  });

  it("chooses the first legal set of losses when an Exchange waits for it, whichever side it is", () => {
    // 4 attack against 2x2: attackers 2+2 may lose either one (required 2): the axis chooses.
    const pending = ok(applyAction(CTX, at7h([u("g1", "germany", 2, "M32"), u("g2", "germany", 2, "M32"), u("p1", "poland", 2, "M33")], EXCHANGE_SEED), { type: "ATTACK", side: "axis", units: ["g1", "g2"], target: "M33" }));
    const d = chooseAction(CTX, pending, { seed: 1 })!;
    expect(d.action).toEqual(legalActions(CTX, pending)[0]);
    expect(d.action.type).toBe("ALLOCATE_LOSSES");
    expect(combatOf(ok(applyAction(CTX, pending, d.action))).pending).toBeNull();
  });

  it("the browser hands the choice to the computer even when the player is attacking", () => {
    const s = createSession(SCENARIO_1939, "allies", 1); // the computer plays the Axis
    // Defenders larger: 2+2 attack against 2+2 at x2, the Allies (the player) attack, the Axis chooses.
    const units = [u("p1", "poland", 2, "M32"), u("p2", "poland", 2, "M32"), u("g1", "germany", 2, "M33"), u("g2", "germany", 2, "M33")];
    let seed = 0;
    let pending: GameState | null = null;
    while (!pending && seed++ < 1000) {
      const st = at7h(units, seed, { activeSide: "allies" });
      const r = applyAction(CTX, st, { type: "ATTACK", side: "allies", units: ["p1", "p2"], target: "M33" });
      if (r.ok && combatOf(r.state).pending) pending = r.state;
    }
    expect(pending).not.toBeNull();
    s.state = pending!;
    expect(combatOf(s.state).pending!.chooser).toBe("axis");
    expect(computerToMove(s)).toBe(true);
    expect(computerTick(s)).not.toBe("stuck"); // "more": still in step 7h, but the computer is no longer the one to move
    expect(combatOf(s.state).pending).toBeNull();
    // ...and when the player is the one to choose, the computer waits.
    const mine = createSession(SCENARIO_1939, "axis", 1);
    mine.state = pending!;
    expect(computerToMove(mine)).toBe(false);
  });
});

describe("self-play with attacks made at step 7h", () => {
  const SCENARIOS: Scenario[] = [SCENARIO_1939, SCENARIO_CAMPAIGN, SCENARIO_1942, SCENARIO_1944];
  const made: number[] = [];
  for (const scenario of SCENARIOS) {
    it(`${scenario.name}: whoever is up attacks whenever it can, the computer settles Exchanges, no illegal action in 2 Game Turns`, () => {
      const ctx: GameContext = { map: MAP, scenario };
      let state = newGame(scenario, 5);
      for (const a of autoSetup(ctx, state)) state = ok(applyAction(ctx, state, a));
      const stop = turnIndex(state) + 2;
      let attacks = 0;
      for (let n = 0; state.phase === "player-turn" && turnIndex(state) < stop; n++) {
        expect(n, "no stall").toBeLessThan(5000);
        const attack = state.position?.part === "player-turn" && state.position.step === "7h" ? legalActions(ctx, state).find((a) => a.type === "ATTACK") : undefined;
        const action = attack ?? chooseAction(ctx, state, { seed: 5 })?.action;
        expect(action, "an action").toBeDefined();
        state = ok(applyAction(ctx, state, action!));
        if (attack) attacks++;
      }
      expect(turnIndex(state)).toBeGreaterThanOrEqual(stop);
      made.push(attacks);
    }, 120_000);
  }

  it("attacks were really made in at least one scenario", () => {
    expect(made.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
  });
});
