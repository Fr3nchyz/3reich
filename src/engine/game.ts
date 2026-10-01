import type { GameState, GameTurn, Scenario, Season, Side } from "./types";

export const SEASONS: readonly Season[] = ["spring", "summer", "fall", "winter"];

export function otherSide(side: Side): Side {
  return side === "axis" ? "allies" : "axis";
}

/** Orders Game Turns: a larger index is later. */
export function turnIndex(t: GameTurn): number {
  return t.year * 4 + SEASONS.indexOf(t.season);
}

export function nextTurn(t: GameTurn): GameTurn {
  const i = SEASONS.indexOf(t.season);
  return i === SEASONS.length - 1
    ? { year: t.year + 1, season: SEASONS[0]! }
    : { year: t.year, season: SEASONS[i + 1]! };
}

/**
 * Start a game. The seed is required so every game can be replayed; the UI chooses it
 * and stores it with the save.
 */
export function newGame(scenario: Scenario, seed: number): GameState {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error(`Invalid seed: ${seed}`);
  const nations = Object.fromEntries(
    Object.entries(scenario.nations).map(([id, n]) => [id, { ...n }]),
  ) as GameState["nations"];
  return {
    scenarioId: scenario.id,
    year: scenario.start.year,
    season: scenario.start.season,
    lastTurn: { ...scenario.end },
    firstSide: scenario.firstSide,
    activeSide: scenario.firstSide,
    phase: "player-turn",
    nations,
    units: {},
    fortresses: {},
    rngState: seed,
  };
}

/**
 * BRP totals compared for the Initiative (Ref 11.1): Germany + Italy against
 * France + Britain, regardless of whether Italy is neutral; US BRPs count from the
 * Summer 1942 turn; Soviet BRPs count once the USSR is at war with Germany.
 */
export function initiativeTotals(state: GameState): { axis: number; allies: number } {
  const n = state.nations;
  const usCounts = turnIndex(state) >= turnIndex({ year: 1942, season: "summer" });
  // TODO(verify): "at war with Germany" is approximated by the USSR having joined the
  // Allies, until declarations of war are modelled (Ref 13).
  const ussrCounts = n.ussr.status === "allied";
  return {
    axis: n.germany.brpTotal + n.italy.brpTotal,
    allies: n.france.brpTotal + n.britain.brpTotal + (usCounts ? n.usa.brpTotal : 0) + (ussrCounts ? n.ussr.brpTotal : 0),
  };
}

/** Ref 11.1: the higher total takes the Initiative; on a tie the previous order stands. */
export function determineInitiative(state: GameState): Side {
  const { axis, allies } = initiativeTotals(state);
  if (axis > allies) return "axis";
  if (allies > axis) return "allies";
  return state.firstSide;
}

/**
 * Year Start Sequence, run between each Winter and Spring Game Turn (Ops 5.1):
 * strategic warfare, BRP calculation, strategic-warfare construction.
 * TODO(Ref 9.0-9.3): not implemented yet; returns the state unchanged.
 */
export function runYearStartSequence(state: GameState): GameState {
  return state;
}
