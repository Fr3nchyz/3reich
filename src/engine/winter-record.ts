import type { GameEvent } from "./action-types";
import type { GameContext } from "./context";
import type { GameState, GameTurn } from "./types";

/**
 * The Russian Winter, as the game remembers it (spec 14 R10, C1; Ref 28.0, Ops 5.2). The shape and the small questions that need no other rule live here, so
 * `war.ts` (a Russian declaration in a Winter turn starts the winter at once) and `turn.ts` can read them without a cycle; the roll, the count and the
 * Allied answer are in `winter.ts`. A saved game without `GameState.winter` reads as "no winter yet" (or "over", where the scenario says the first winter is past).
 */

/** The dice and the count made at II.A, kept for the card (spec 14 D4). */
export interface WinterRoll {
  /** Four dice, in the order they were rolled. */
  dice: number[];
  total: number;
  /** The non-Finnish Axis ground units east of the original Russian border (V24). */
  axisUnits: number;
  /** True when `axisUnits` is below `total`: Russia may postpone (Ref 28.0). */
  mayPostpone: boolean;
}

export interface RussianWinter {
  /** "ahead": it has not been in force yet; "postponed": the Allies waited, so the next Winter Game Turn has it with no question; "over": it has been (or the scenario takes it as past). */
  stage: "ahead" | "postponed" | "over";
  /** The Game Turn ("1941-winter") in which the rule is in force; absent when it is not in force in any. */
  inForce?: string;
  /** The last roll made at II.A. */
  roll?: WinterRoll;
  /** True while the Allies have to answer at II.A: the game waits there (`CHOOSE_WINTER`). */
  asking: boolean;
  /** The Game Turn in which the Allies postponed. */
  postponedFrom?: GameTurn;
}

/** "1941-winter": the Game Turn a winter is in force in. */
export const winterKey = (t: GameTurn): string => `${t.year}-${t.season}`;

/** The stage the winter is at: the record's, or "over" where the scenario takes the first winter as past (1942 and 1944), else "ahead". */
export function winterStage(ctx: GameContext, state: GameState): RussianWinter["stage"] {
  return state.winter?.stage ?? (ctx.scenario.rules.some((r) => r.kind === "first-winter-past") ? "over" : "ahead");
}

/** Whether the winter rules are in force in the Game Turn now being played (both Player Turns of it). */
export const winterInForce = (state: GameState): boolean => state.winter?.inForce === winterKey(state);

/** Whether the Allies have to answer at II.A. */
export const winterAsking = (state: GameState): boolean => state.phase === "player-turn" && state.position?.part === "russian-winter" && state.winter?.asking === true;

/** The Winter Game Turn now being played; "winter" is the only season of the rule (Ref 28.0). */
export const isWinterTurn = (state: GameState): boolean => state.season === "winter";

/** The winter is in force from this Game Turn on; the record keeps the roll and the postponement it came from. */
export function startWinter(state: GameState, early = false): { state: GameState; events: GameEvent[] } {
  const w: RussianWinter = { ...state.winter, stage: "over", inForce: winterKey(state), asking: false };
  const turn: GameTurn = { year: state.year, season: state.season };
  const postponedFrom = state.winter?.postponedFrom;
  return {
    state: { ...state, winter: w },
    events: [{ type: "WINTER_STARTED", turn, ...(postponedFrom ? { postponedFrom } : {}), ...(early ? { early } : {}) }],
  };
}

/**
 * A declaration of war was just recorded. If it is the U.S.S.R. declaring on Germany in a Winter Game Turn while the winter has not been yet, that turn is the
 * first winter at once, with no roll and no postponement, even if the Axis has already played its Player Turn of it (Ref 28.0, spec 14 R10).
 * TODO(verify) V43: this reads only the U.S.S.R.'s own declaration on Germany; a German declaration on Russia in a Winter turn comes after II.A, so it starts the next winter.
 */
export function winterAfterDeclaration(ctx: GameContext, state: GameState, by: string, on: string): { state: GameState; events: GameEvent[] } {
  if (by !== "ussr" || on !== "germany" || !isWinterTurn(state) || winterStage(ctx, state) !== "ahead") return { state, events: [] };
  return startWinter(state, true);
}
