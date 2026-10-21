import type { Season } from "../engine/types";
import { verdictName, type GameResult } from "../engine/victory-record";
import { cap } from "./format";

/** The result in one line for the log and the watch panel (the result card of ticket 14-4 says more): "Allied Marginal Victory. Objectives held: Axis 24, Allies 15, nobody 3." */
export function victoryLine(r: GameResult): string {
  const o = r.objectives;
  return `${verdictName(r)}. Objectives held: Axis ${o.axis}, Allies ${o.allies}, nobody ${o.nobody}.`;
}

/** The log line for the end of the game: "The scenario ends after Summer 1942. ..." or, when a conquest decided it (spec 14 R3, ticket 14-5), "The game ends in Spring 1945: a conquest decided it. ...". */
export function gameOverLine(season: Season, year: number, r: GameResult): string {
  return `${r.early ? `The game ends in ${cap(season)} ${year}: a conquest decided it.` : `The scenario ends after ${cap(season)} ${year}.`} ${victoryLine(r)}`;
}
