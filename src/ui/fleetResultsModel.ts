import type { GameEvent } from "../engine/actions";
import { turnKey } from "../engine/combat-record";
import type { GameContext } from "../engine/context";
import type { GameState } from "../engine/types";
import { describeEvent } from "./eventText";
import { FLEET_TEXT as T } from "./navalText";

export interface FleetResults { turn: string; lines: string[]; fresh: boolean }

/** Spec 12 D3/R12/AER89/AER91: report actual events, including sunk counters; never simulate dice for a preview. */
export function fleetResultsModel(ctx: GameContext, before: GameState, events: readonly GameEvent[]): FleetResults | null {
  if (!events.some(e => e.type === "INTERCEPTION_ATTEMPTED")) return null;
  const lines: string[] = [];
  for (const event of events) {
    if (["INTERCEPTION_ATTEMPTED", "NAVAL_COMBAT_RESOLVED", "NAVAL_LOSSES_APPLIED", "INTERCEPTION_CANCELLED", "FLEET_RETURNED"].includes(event.type)
      || (event.type === "UNIT_ELIMINATED" && before.units[event.unitId]?.type === "fleet")) {
      const line = describeEvent(event, ctx, new Set(), new Map(), before);
      if (line) lines.push(line);
    }
    if (event.type === "NAVAL_COMBAT_RESOLVED") {
      for (const side of ["interceptor", "intercepted"] as const) {
        const r = event.result[side];
        lines.push(T.roll(side, event.dice[side], r.nationalityDrm, r.advantageDrm, r.modifiedRoll, r.loss));
      }
    }
  }
  return { turn: turnKey(before), lines, fresh: true };
}
