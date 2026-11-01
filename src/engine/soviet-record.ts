import type { HexId } from "./hex";
import type { GameState } from "./types";

/**
 * The Russian records of spec 14 C1. `SiberianRecord` holds what the victory tables read: from the first unit taken (Ref 11.63), the tables for the Transfer apply
 * to the end of the game (R2, R11). `SovietRecord` holds the once-only 15s for Moscow and Leningrad (ticket 14-14, R7a); the surrender offer, the credited
 * Objectives and the Occupation Force shortfall (tickets 14-15 and 14-17) are added to it by those tickets. The Transfer itself is `siberian.ts` (ticket 14-18).
 */
export interface SiberianRecord {
  /** True once any unit has been taken. */
  used: boolean;
  /** "1941-winter" -> units taken that Game Turn. */
  taken: Record<string, number>;
  /** "1941-winter" -> how many of those were armor (the rest are infantry; the armor taken may not outnumber the infantry taken, R11). Absent reads as none. */
  armor?: Record<string, number>;
}

/** The two Russian cities whose capture by the Axis moves 15 BRPs (Ref 18.4, 9.2). */
export type SovietCity = "moscow" | "leningrad";

/**
 * Where the Russian surrender stands (spec 14 R7b to R7d): "asking" while the Axis has to answer at step 10a, then "accepted" or "refused". Absent means "none": the
 * offer is made once, whatever the answer (TODO(verify) V18).
 */
export type SurrenderOffer = "none" | "asking" | "accepted" | "refused";

export interface SovietRecord {
  /** The cities the Axis has taken at least once: the immediate 15 BRPs are paid once for each city, whatever happens to its control later (R7a). */
  citiesTaken: { moscow?: boolean; leningrad?: boolean };
  /** The Russian surrender offer (ticket 14-15); absent reads as "none". */
  offer?: SurrenderOffer;
  /** The Objectives the Allies hold for good after the surrender was accepted (R7c, R1), in hex order; the standings read them. */
  credited?: HexId[];
  /** The Game Turn ("1942-spring") of the last Occupation Force penalty: at most one a turn (ticket 14-17, R7c). */
  shortfallTurn?: string;
  /** True while the Axis must choose which Objective to hand back (step 6h or 9k, `OCCUPATION_CONCEDE`, ticket 14-17). */
  conceding?: boolean;
}

/** Where the offer stands now. */
export const surrenderOffer = (state: GameState): SurrenderOffer => state.soviet?.offer ?? "none";

/** Whether the Axis has to answer the Russian surrender offer: the game waits at step 10a of the Allied Player Turn for `SURRENDER_ANSWER`. Like `winterAsking`, it needs the position, so a state that passed 10a is not asking. */
export const surrenderAsking = (state: GameState): boolean =>
  state.phase === "player-turn" && state.position?.part === "player-turn" && state.position.step === "10a" && surrenderOffer(state) === "asking";

/** Whether the game waits for the Axis to name the Objective it hands back to Russia (the Occupation Force, steps 6h and 9k). Like `surrenderAsking`, it needs the position. */
export const occupationAsking = (state: GameState): boolean =>
  state.phase === "player-turn" && state.position?.part === "player-turn" && (state.position.step === "6h" || state.position.step === "9k") && state.soviet?.conceding === true;
