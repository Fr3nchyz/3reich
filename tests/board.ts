import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { newGame } from "../src/engine/game";
import type { ForceOwner, GameState, Scenario, Unit, UnitType } from "../src/engine/types";

/** A counter for a concrete test position (strength first, movement second, as printed). */
export const counter = (id: string, owner: ForceOwner, type: UnitType, strength: number, at: string, movement?: number): Unit => ({
  id,
  owner,
  type,
  strength,
  at,
  ...(movement !== undefined ? { movement } : {}),
});

/** A game in play (setup skipped) with exactly these counters on the map. */
export function board(units: Unit[], scenario: Scenario = SCENARIO_1939, tweak: Partial<GameState> = {}): GameState {
  return { ...newGame(scenario, 1), phase: "player-turn", setup: null, units: Object.fromEntries(units.map((u) => [u.id, u])), ...tweak };
}
