import type { GameEvent } from "../engine/action-types";
import type { GameContext } from "../engine/context";
import type { GameState } from "../engine/types";
import { airMissionKey } from "./airMissionModel";
import { placeName } from "./names";
import * as T from "./airText";

export interface AirResult { title: string; lines: string[] }
export interface AirResults { key: string; cards: AirResult[] }
/** Spec 09 C3/D4/R7, AER74/93/94; spec 12 R14: use actual event rolls/losses, never reroll or infer losses from survivors. */
export function airResultModel(ctx: GameContext, events: readonly GameEvent[]): AirResult[] {
  return events.flatMap((e): AirResult[] => {
    if (e.type === "PORT_ATTACK_RESOLVED") return [{ title: T.missionResultTitle(T.MISSION_TITLES["7i"], placeName(ctx.map, e.target)),
      lines: [T.PORT_STATUS[e.status], T.portRolls(e.rolls.map(r => r.roll)), T.portLosses(e.airLost, e.navalHits, e.navalLost)] }];
    if (e.type !== "AIR_COMBAT_RESOLVED" && e.type !== "DAS_INTERCEPTED") return [];
    const { combat: c } = e;
    const loss = e.type === "AIR_COMBAT_RESOLVED" ? [e.lost.attacker, e.lost.defender] : [e.lost.interceptors, e.lost.support];
    return [{ title: T.missionResultTitle(T.MISSION_TITLES[e.type === "AIR_COMBAT_RESOLVED" ? "7c" : "7e"], placeName(ctx.map, e.hex)),
      lines: [T.missionRoll(T.AIR_ATTACKER, e.rolls[0], c.attacker.factors, c.attacker.advantageDrm, c.attacker.nationalityDrm, c.attacker.modifiedRoll),
        T.missionRoll(T.AIR_DEFENDER, e.rolls[1], c.defender.factors, c.defender.advantageDrm, c.defender.nationalityDrm, c.defender.modifiedRoll),
        T.missionWinner(c.winner), ...(c.tieRoll === null ? [] : [T.missionTie(c.tieRoll)]), T.missionLoss(loss[0]!, loss[1]!),
        ...(e.type === "DAS_INTERCEPTED" ? [T.missionContinuation(e.continuing.length)] : []), T.AUTOMATIC_AIR_LOSSES] }];
  });
}
/** Screen results last for this Player Turn, including results from more than one target/action. */
export function trackAirResults(previous: AirResults | undefined, ctx: GameContext, before: GameState, after: GameState, events: readonly GameEvent[]): AirResults | undefined {
  const key = airMissionKey(after);
  const old = previous?.key === key ? previous.cards : [];
  const cards = airMissionKey(before) === key ? [...old, ...airResultModel(ctx, events)] : [];
  return cards.length ? { key, cards } : undefined;
}
