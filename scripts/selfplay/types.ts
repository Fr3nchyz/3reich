import type { Action } from "../../src/engine/actions";
import type { GameContext } from "../../src/engine/context";
import type { GameState, PowerId } from "../../src/engine/types";
import type { ScenarioKey } from "./scenarios";

export interface RunOptions {
  scenario: ScenarioKey;
  seed: number;
  /** Game Turns to play from the start of the scenario, or "end" for the whole scenario. */
  turns: number | "end";
  /** Check every chosen action against legalActions before applying it (default true; costs a second list at some steps). */
  verify?: boolean;
  /** Most actions allowed at one step before the run is reported as not advancing (default 1000). */
  stepLimit?: number;
  /** Most actions allowed in one Game Turn (default 8000). */
  turnLimit?: number;
  /** Whether the supply effects apply (default: the shipped `SUPPLY_EFFECTS_ENABLED`); set in the game's context, `GameContext.supplyEffects`. */
  supplyEffects?: boolean;
}

export type AnomalyKind = "setup" | "stuck" | "refused" | "illegal-choice" | "exception" | "no-progress" | "turn-budget" | "negative-brp" | "overstack";

export interface Anomaly {
  kind: AnomalyKind;
  /** The Game Turn and step where it happened. */
  at: string;
  detail: string;
}

/** What one Game Turn did, from the events of its actions and the state at its end. */
export interface TurnStats {
  label: string;
  /** BRP totals at the end of the Game Turn. */
  brp: Record<PowerId, number>;
  /** BRPs spent in the Game Turn, by nation and by what they bought. */
  spent: Record<PowerId, number>;
  spentOn: { war: number; build: number; grant: number; option: number; other: number };
  wars: string[];
  built: number;
  builtList: string[];
  grants: number;
  grantAmount: number;
  moves: number;
  unitsMoved: number;
  /** Units moved by each side's Player Turn. */
  movedBy: { axis: number; allies: number };
  /** Ground units (infantry, armor, airborne) each side has on the map at the end of the Game Turn. */
  ground: { axis: number; allies: number };
  combats: { total: number; attackerEliminated: number; defenderEliminated: number; exchange: number };
  /** Attacks made by each side. */
  attacks: { axis: number; allies: number };
  lost: { axis: number; allies: number };
  /** Of the units lost, those eliminated for being out of supply at the end of their Player Turn (Ref 19.4, 11.74). */
  lostUnsupplied: { axis: number; allies: number };
  lostFactors: { axis: number; allies: number };
  hexChanges: number;
  hexes: { axis: number; allies: number; neutral: number };
  objectives: { axis: number; allies: number; neutral: number };
  units: { axis: number; allies: number };
  factors: { axis: number; allies: number };
  frontOptions: string[];
  actions: number;
  /** True when the run stopped inside this Game Turn. */
  partial: boolean;
}

export interface GameResult {
  options: Required<RunOptions>;
  ctx: GameContext;
  /** The state before setup: replay(ctx, initial, actions) gives `final`. */
  initial: GameState;
  /** Setup and play, in order. */
  actions: Action[];
  setupActions: number;
  final: GameState;
  turns: TurnStats[];
  anomalies: Anomaly[];
  ended: "game-over" | "turn-limit" | "stopped";
  runtimeMs: number;
}
