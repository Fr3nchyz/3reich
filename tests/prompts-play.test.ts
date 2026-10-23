import { describe, expect, it } from "vitest";
import { chooseAction, placeOf } from "../src/ai";
import * as policies from "../src/ai/policies";
import { ACCEPT_SURRENDER } from "../src/ai/surrender";
import { SIBERIAN_TAKE_ALL } from "../src/ai/siberian";
import { WINTER_POSTPONE_WHEN_ALLOWED } from "../src/ai/winter";
import type { GameContext } from "../src/engine/context";
import { legalActions, type Action } from "../src/engine/actions";
import { sideToAct } from "../src/engine/actor";
import { surrenderAsking } from "../src/engine/soviet-record";
import type { GameState, Side } from "../src/engine/types";
import { winterAsking } from "../src/engine/winter-record";
import { runGame, type Chooser } from "../scripts/selfplay/runner";
import { SCENARIOS, type ScenarioKey } from "../scripts/selfplay/scenarios";
import { computerTick, computerToMove } from "../src/ui/computerPlay";
import { createSession } from "../src/ui/session";

// Spec 14 ticket 14-19: the computer answers every new prompt (II.A, 8a, 10a), in every scenario, whoever is human, and the three policies are constants in one place.

type Kind = "winter" | "transfer" | "surrender";
interface Seen { kind: Kind; state: GameState; side: Side; action: Action }

/** The prompt a state holds, or null: II.A asks the Allies, 8a offers the Allies units, 10a asks the Axis (in whoever's Player Turn it falls). */
function promptOf(ctx: GameContext, state: GameState): Kind | null {
  if (winterAsking(state)) return "winter";
  if (surrenderAsking(state)) return "surrender";
  if (state.position?.part === "player-turn" && state.position.step === "8a" && legalActions(ctx, state).some((a) => a.type === "SIBERIAN_TRANSFER")) return "transfer";
  return null;
}
const ANSWER: Record<Kind, Action["type"]> = { winter: "CHOOSE_WINTER", transfer: "SIBERIAN_TRANSFER", surrender: "SURRENDER_ANSWER" };
const EXPECTED_SIDE: Record<Kind, Side> = { winter: "allies", transfer: "allies", surrender: "axis" };

/** A whole computer game; every prompt state is recorded with the computer's answer, and the game must never be left without a legal action. */
function play(scenario: ScenarioKey, seed: number): { seen: Seen[]; ended: string; anomalies: number } {
  const seen: Seen[] = [];
  const choose: Chooser = (ctx, state, cfg) => {
    const d = chooseAction(ctx, state, cfg); // null (no legal action) is the runner's "stuck" anomaly, counted below
    const kind = promptOf(ctx, state);
    if (kind && d) seen.push({ kind, state, side: sideToAct(state), action: d.action });
    return d;
  };
  const r = runGame({ scenario, seed, turns: "end", verify: false }, { choose });
  return { seen, ended: r.ended, anomalies: r.anomalies.length };
}

const MATRIX: [ScenarioKey, number][] = [["1939", 7], ["1942", 1], ["1944", 1], ["campaign", 1]];
const all: Seen[] = [];

describe.each(MATRIX)("a whole computer game, %s seed %i", (scenario, seed) => {
  const g = play(scenario, seed);
  all.push(...g.seen);
  it("runs to the end with no anomaly and never has an empty legal list (the runner reports a state with no action as stuck)", () => {
    expect(g.anomalies).toBe(0);
    expect(g.ended).toBe("game-over");
  });
  it("every prompt belongs to the right side and is answered by the matching action of that side", () => {
    for (const p of g.seen) {
      expect(p.side, `${p.kind} at ${placeOf(p.state)}`).toBe(EXPECTED_SIDE[p.kind]);
      expect(p.action.type).toBe(ANSWER[p.kind]);
      expect((p.action as { side: Side }).side).toBe(p.side);
    }
  });
  it("with one side human, the computer answers when the prompt is its side's and waits when it is the human's", () => {
    for (const p of g.seen) {
      for (const human of ["axis", "allies"] as const) {
        const s = Object.assign(createSession(SCENARIOS[scenario], human, seed), { state: p.state });
        const mine = p.side === human;
        expect(computerToMove(s), `${p.kind}, human ${human}`).toBe(!mine);
        if (!mine) {
          const here = placeOf(s.state);
          expect(computerTick(s, 1e9)).not.toBe("stuck");
          expect(placeOf(s.state) !== here || s.state.position !== p.state.position || s.state.units !== p.state.units, `${p.kind} answered`).toBe(true);
          if (p.kind === "winter") expect(winterAsking(s.state)).toBe(false);
          if (p.kind === "surrender") expect(surrenderAsking(s.state)).toBe(false);
        }
      }
    }
  });
});

describe("across the matrix", () => {
  it("every kind of prompt was reached at least once, so the checks above are not empty", () => {
    for (const k of ["winter", "transfer", "surrender"] as const) expect(all.filter((p) => p.kind === k).length, k).toBeGreaterThan(0);
  });
});

describe("the policies are constants in one place (src/ai/policies.ts)", () => {
  it("are the values the spec names, and the chooser modules read the same ones", () => {
    expect(policies.WINTER_POSTPONE_WHEN_ALLOWED).toBe(true);
    expect(policies.ACCEPT_SURRENDER).toBe(true);
    expect(policies.SIBERIAN_TAKE_ALL).toBe(true);
    expect(WINTER_POSTPONE_WHEN_ALLOWED).toBe(policies.WINTER_POSTPONE_WHEN_ALLOWED);
    expect(ACCEPT_SURRENDER).toBe(policies.ACCEPT_SURRENDER);
    expect(SIBERIAN_TAKE_ALL).toBe(policies.SIBERIAN_TAKE_ALL);
  });
});
