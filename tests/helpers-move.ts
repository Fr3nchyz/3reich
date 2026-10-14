import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { applyAction, type Action } from "../src/engine/actions";
import type { GameContext } from "../src/engine/context";
import type { ForceOwner, GameState, Scenario, Unit, UnitType } from "../src/engine/types";
import { board } from "./board";
import { CTX } from "./helpers";

/** A counter printed strength-movement, e.g. `inf("u1", "germany", "L32", 3, 3)` is a 3-3. */
export const inf = (id: string, owner: ForceOwner, at: string, strength = 3, movement = 3, type: UnitType = "infantry"): Unit => ({ id, owner, type, strength, movement, at });

/** A game at step 6f of the first Player Turn with exactly these counters; `side` is to move. */
export function at6f(units: Unit[], side: "axis" | "allies" = "axis", scenario: Scenario = SCENARIO_1939, tweak: Partial<GameState> = {}): GameState {
  return board(units, scenario, { activeSide: side, firstSide: side, position: { part: "player-turn", turn: 1, step: "6f" }, ...tweak });
}

export const move = (s: GameState, units: string[], path: string[], ctx: GameContext = CTX, side: "axis" | "allies" = s.activeSide) =>
  applyAction(ctx, s, { type: "MOVE", side, units, path });

export const okOf = (r: ReturnType<typeof applyAction>) => {
  if (!r.ok) throw new Error(r.error);
  return r;
};
export const errorOf = (r: ReturnType<typeof applyAction>): string => (r.ok ? "" : r.error);
export const movesIn = (actions: Action[]) => actions.filter((a): a is Extract<Action, { type: "MOVE" }> => a.type === "MOVE");
