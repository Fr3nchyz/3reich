import { verdictName, type GameResult } from "../engine/victory-record";

/** The result in one line for the log and the watch panel (the result card of ticket 14-4 says more): "Allied Marginal Victory. Objectives held: Axis 24, Allies 15, nobody 3." */
export function victoryLine(r: GameResult): string {
  const o = r.objectives;
  return `${verdictName(r)}. Objectives held: Axis ${o.axis}, Allies ${o.allies}, nobody ${o.nobody}.`;
}
