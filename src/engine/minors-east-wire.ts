import type { GameEvent } from "./action-types";
import type { GameContext } from "./context";
import { eliminateUnits } from "./losses";
import { createEasternEurope } from "./minors-east";
import type { GameState } from "./types";

/** Spec 15 R12, ticket 15-11b: the end of the Axis Player Turn of Fall 1939 (Ref 29.0). The scenario rule `eliminate-in-zone` removes the German units still east of the
 * Partition Line (they go back to the Force Pool, spec 17), then Eastern Europe is created (Polish units east of the line are removed there). Anything else: no change.
 */
export function partitionAtTurnEnd(ctx: GameContext, state: GameState): { state: GameState; events: GameEvent[] } {
  if (state.countries?.["eastern-europe"]) return { state, events: [] };
  if (state.year !== 1939 || state.season !== "fall" || state.activeSide !== "axis") return { state, events: [] };
  let next = state;
  const events: GameEvent[] = [];
  for (const rule of ctx.scenario.rules) {
    if (rule.kind !== "eliminate-in-zone" || rule.side !== state.activeSide) continue;
    if (rule.turn.year !== state.year || rule.turn.season !== state.season) continue;
    const hexes = ctx.scenario.zones[rule.zone]?.hexes ?? [];
    const doomed = Object.values(next.units).filter((u) => u.owner === "germany" && hexes.includes(u.at)).map((u) => u.id);
    const gone = eliminateUnits(next, doomed);
    next = gone.state;
    events.push(...gone.events);
  }
  return { state: createEasternEurope(next), events };
}
