import type { GameEvent } from "./action-types";
import { capitalOf, CONQUERED_BY_CAPITAL } from "./capital";
import type { GameContext } from "./context";
import { controllerOf, controllingSide } from "./control";
import { conquer, type FallPlan } from "./conquest-stages";
import type { Conquest } from "./conquest-record";
import { settleMinorConquests } from "./conquest-minor";
import { ALIGNMENT, sideOfPower } from "./war";
import type { ForceOwner, GameState, PowerId, Side } from "./types";

/**
 * A Major Power is conquered by its capital (spec 14 R4, C8; Ref 2.0, 18.1). When an enemy ground unit takes the capital the owner is warned
 * (CAPITAL_LOST, control.ts); if the capital is still lost when the owner's own Combat Phase ends (the end of step 7p of its Player Turn) the Power
 * falls: `fall()`. The stages every fall shares are `conquer` (conquest-stages.ts); minor countries, colonies and Eastern Europe (ticket 14-6, spec 15) fall
 * through `fallCountry` (conquest-minor.ts), which uses the same stages; France's Vichy and the colony dice (ticket 14-7) and Italy's surrender (ticket 14-8)
 * add their own steps to `fall()` through its `steps`.
 */

export type CapitalState = "free" | "capital-lost" | "conquered";

/** Where a Major Power stands: free, its capital lost (the other side holds it), or conquered. A Power outside `CONQUERED_BY_CAPITAL` (France until ticket 14-7), or not in the war, is free. */
export function capitalState(ctx: GameContext, state: GameState, power: PowerId): CapitalState {
  const nation = state.nations[power];
  if (!nation) return "free";
  if (nation.status === "conquered") return "conquered";
  const capital = capitalOf(ctx, power);
  const side = sideOfPower(nation);
  if (capital === null || side === null || !CONQUERED_BY_CAPITAL.includes(power)) return "free";
  const holder = controllingSide(ctx, state, capital);
  return holder !== null && holder !== side ? "capital-lost" : "free";
}

/** The Major Powers of `side` whose capital is lost now, in the order of `CONQUERED_BY_CAPITAL`: they fall if this is the end of their Combat Phase. */
export function fallingNow(ctx: GameContext, state: GameState, side: Side): PowerId[] {
  return CONQUERED_BY_CAPITAL.filter((p) => state.nations[p] && sideOfPower(state.nations[p]) === side && capitalState(ctx, state, p) === "capital-lost");
}

/** What the Power's units and land are, for a fall: the Power and its active Minor-Allies leave together. */
const withAllies = (state: GameState, who: PowerId): ForceOwner[] => [who, ...state.minorAllies.filter((m) => m.of === who && m.active).map((m) => m.owner)];

/**
 * Major Power `who` falls to `conqueror` (the owner of the unit that holds its capital): the stages of `conquer` (conquest-stages.ts, C8 steps 1 to 7) with
 * the Power's own particulars. The Power and its active Minor-Allies leave together; the land it holds in its own map country passes to the conqueror (the
 * rest becomes nobody's, V11); its status becomes "conquered" with 0 BRPs and a spending limit of 0 (the Base stays), its Minor-Allies become inactive (V33)
 * and the Conquest records the BRPs it began the scenario with (V9). The Wars list is not touched: it keeps its history.
 * `steps` are the extension points of ticket 14-7 (France's halving before, the colony dice after) and of 14-8; none is used yet.
 */
export function fall(ctx: GameContext, state: GameState, who: PowerId, conqueror: ForceOwner, how: Conquest["how"] = "capital", steps: Pick<FallPlan, "before" | "after"> = {}): { state: GameState; events: GameEvent[] } {
  const nation = state.nations[who];
  return conquer(ctx, state, {
    country: who,
    who,
    owners: withAllies(state, who),
    conqueror,
    side: sideOfPower(nation) ?? ALIGNMENT[who],
    how,
    startingBrps: ctx.scenario.nations[who].brpTotal,
    isHome: (hex, owner) => owner === who && hex.country === who,
    mark: (s) => ({
      ...s,
      nations: { ...s.nations, [who]: { ...nation, status: "conquered", brpTotal: 0, spendLimit: 0, spent: 0 } },
      minorAllies: s.minorAllies.map((m) => (m.of === who && m.active ? { ...m, active: false } : m)),
    }),
    ...steps,
  });
}

/**
 * Leaving step 7p of the active side's Player Turn (B7: `advance` calls this whatever the turn held): each of its Major Powers whose capital is still lost
 * falls, one after the other, to the owner of the unit that holds the capital; then each minor country whose capital this side holds falls to it
 * (`settleMinorConquests`, ticket 14-6, spec 14 R9). Stops as soon as one of the falls ends the game.
 */
export function settleConquests(ctx: GameContext, state: GameState): { state: GameState; events: GameEvent[] } {
  let next = state;
  const events: GameEvent[] = [];
  for (let n = 0; n < CONQUERED_BY_CAPITAL.length && next.phase === "player-turn"; n++) { // each fall takes a Power out of `fallingNow`, so there are at most as many as there are Powers
    const power = fallingNow(ctx, next, next.activeSide)[0];
    const conqueror = power === undefined ? null : controllerOf(ctx, next, capitalOf(ctx, power)!);
    if (power === undefined || conqueror === null) break;
    const done = fall(ctx, next, power, conqueror, "capital");
    next = done.state;
    events.push(...done.events);
  }
  const minors = settleMinorConquests(ctx, next);
  return { state: minors.state, events: [...events, ...minors.events] };
}
