import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { combatOf, turnKey } from "../src/engine/combat-record";
import type { ForceOwner, GameState, Unit, UnitType } from "../src/engine/types";
import { atStart } from "./helpers";

/** Positions for the attack preview tests (spec 07, 07-4): Axis to move at step 7h with exactly these counters on the map. */

export const unit = (id: string, owner: ForceOwner, type: UnitType, strength: number, at: string): Unit => ({ id, owner, type, strength, at });
export const GER = (id: string, at: string, strength = 3, type: UnitType = "infantry") => unit(id, "germany", type, strength, at);
export const POL = (id: string, at: string, strength = 1, type: UnitType = "infantry") => unit(id, "poland", type, strength, at);
export function at7h(units: Unit[], seed = 1, extra: Partial<GameState> = {}): GameState {
  return { ...atStart(SCENARIO_1939, 1), activeSide: "axis", position: { part: "player-turn", turn: 1, step: "7h" }, units: Object.fromEntries(units.map((u) => [u.id, u])), rngState: seed, ...extra };
}
/** The position with these units marked as having attacked, and these hexes as attacked, this Player Turn. */
export const spent = (s: GameState, attacked: string[], targets: string[] = []): GameState => ({ ...s, combat: { ...combatOf(s), turn: turnKey(s), attacked, targets } });

