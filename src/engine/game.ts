import type { GameState, PowerId, Season } from "./types";

/** Order in which powers act within a game turn. Adjust to match the original rules. */
export const TURN_ORDER: PowerId[] = ["germany", "italy", "ussr", "britain", "france", "usa"];

export const POWER_NAMES: Record<PowerId, string> = {
  germany: "Germany",
  italy: "Italy",
  ussr: "Soviet Union",
  britain: "Great Britain",
  france: "France",
  usa: "United States",
};

const SEASONS: Season[] = ["spring", "summer", "fall", "winter"];

export function newGame(seed = Date.now() >>> 0): GameState {
  return {
    year: 1939,
    season: "fall",
    activePower: TURN_ORDER[0]!,
    regions: {},
    units: {},
    rngState: seed,
    log: ["Game started: Fall 1939."],
  };
}

/** Pass play to the next power; when everyone has acted, advance the season. */
export function endPowerTurn(state: GameState): GameState {
  const i = TURN_ORDER.indexOf(state.activePower);
  if (i < TURN_ORDER.length - 1) {
    return { ...state, activePower: TURN_ORDER[i + 1]! };
  }
  const s = SEASONS.indexOf(state.season);
  const wraps = s === SEASONS.length - 1;
  const season = SEASONS[(s + 1) % SEASONS.length]!;
  const year = wraps ? state.year + 1 : state.year;
  return {
    ...state,
    activePower: TURN_ORDER[0]!,
    season,
    year,
    log: [...state.log, `A new turn begins: ${season} ${year}.`],
  };
}
