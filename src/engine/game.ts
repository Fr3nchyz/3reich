import { fall1939Nations } from "./nations";
import type { GameState, Season, Side } from "./types";

const SEASONS: Season[] = ["spring", "summer", "fall", "winter"];

export function otherSide(side: Side): Side {
  return side === "axis" ? "allies" : "axis";
}

/** The Fall 1939 scenario starts with the Allies holding the initiative. */
export function newGame(seed = Date.now() >>> 0): GameState {
  return {
    year: 1939,
    season: "fall",
    firstSide: "allies",
    activeSide: "allies",
    nations: fall1939Nations(),
    regions: {},
    units: {},
    rngState: seed,
    log: ["Game started: Fall 1939."],
  };
}

/**
 * End the active side's player turn. After the first side, the second side moves;
 * after the second side, the game turn ends and the next season begins.
 */
export function endPlayerTurn(state: GameState): GameState {
  if (state.activeSide === state.firstSide) {
    return { ...state, activeSide: otherSide(state.firstSide) };
  }
  const s = SEASONS.indexOf(state.season);
  const wraps = s === SEASONS.length - 1;
  const season = SEASONS[(s + 1) % SEASONS.length]!;
  const year = wraps ? state.year + 1 : state.year;
  return {
    ...state,
    activeSide: state.firstSide,
    season,
    year,
    log: [...state.log, `A new turn begins: ${season} ${year}.`],
  };
}
