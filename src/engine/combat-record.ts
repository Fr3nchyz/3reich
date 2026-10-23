import type { HexId } from "./hex";
import type { GameState, Side } from "./types";

/**
 * What ground combat has done so far in one Player Turn (step 7h, spec 04). It lives in
 * `GameState.combat` and is replaced by a fresh record when a different Player Turn asks for it
 * (the key names the Game Turn and the side), so no step has to clear it.
 */

/** An Exchange whose losses the player has to allocate (Ref 12.2): the units to choose from and how many factors must go. */
export interface PendingLosses {
  /** The side whose player chooses: the owner of the units that lose factors. */
  chooser: Side;
  target: HexId;
  /** Units that may be removed. */
  candidates: string[];
  /** Factors each candidate counts for in this Exchange (the defenders' terrain multiple is already in). */
  values: Record<string, number>;
  /** At least this many factors must be removed, with no unit removed that is not needed. */
  required: number;
  /** All the units that made the attack, to find the survivors who may advance afterwards. */
  attackers: string[];
}

/** A hex the defenders left empty, and the attackers still alive that may advance into it. */
export interface AdvanceChance {
  to: HexId;
  units: string[];
  /**
   * The battle's attackers included at least one armor unit, alive or not (Ref 12.31; spec 16 R10, AER12): an advance into `to` makes it a Breakthrough hex.
   * Absent in a chance recorded before ticket 16-9, after a sweep (the vacant-hex case, R16) and when no armor attacked.
   */
  armor?: true;
  /** The hexes the attackers stood in when they attacked (AER12), set with `armor`. */
  from?: HexId[];
}

export interface CombatRecord {
  /** "year-season-side" of the Player Turn the record belongs to. */
  turn: string;
  /** Units that have attacked this turn (each unit attacks once, PC README 14.23). */
  attacked: string[];
  /** Hexes attacked this turn. */
  targets: HexId[];
  pending: PendingLosses | null;
  advances: AdvanceChance[];
}

export const turnKey = (s: Pick<GameState, "year" | "season" | "activeSide">): string => `${s.year}-${s.season}-${s.activeSide}`;

/** The record for the Player Turn now being played: the stored one, or an empty one. */
export function combatOf(state: GameState): CombatRecord {
  const rec = state.combat;
  return rec && rec.turn === turnKey(state) ? rec : { turn: turnKey(state), attacked: [], targets: [], pending: null, advances: [] };
}

/** Whether an Exchange is waiting for its owner to choose losses. */
export const hasPendingLosses = (state: GameState): boolean => combatOf(state).pending !== null;
