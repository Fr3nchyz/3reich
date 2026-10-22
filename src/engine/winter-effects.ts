import type { GameContext } from "./context";
import { sideInWar } from "./control";
import type { Front } from "./map";
import type { HexId } from "./hex";
import type { FrontOption, GameState, Side, Unit } from "./types";
import { RUSSIA_COUNTRY, winterInForce, WINTER_EXEMPT_OWNER } from "./winter-record";

/**
 * What the Russian Winter does to the fighting (spec 14 R10, ticket 14-12; Ref 28.0): for the whole Game Turn it is in force (both Player Turns, `winterInForce`)
 * 1. the plain "times two" of a defending Axis unit east of the original Russian border is lost, the Finns excepted (`winterDefence`, read by `attackNumbers`, so the
 *    odds shown and the battle fought are one number); the triples and the Fortress's fourfold stay;
 * 2. the Axis may not take the Offensive Option on the Eastern Front in its Player Turn (`winterBansOffensive`, read at step 3). Attrition and Defensive stay allowed.
 * The record, the roll and the Allied choice are `winter.ts`; the screens are `ui/winterCard.ts`.
 */

/**
 * Whether the defence of `defenders` in `at` loses its doubling to the winter: the winter is in force, the hex is in the map country "ussr" (the original Russian border,
 * the same hexes as the surrender rule), and at least one defender is an Axis unit that is not a Finn. A Finn alone in the hex keeps the doubling.
 * TODO(verify) V23: a hex shared by Finns and other Axis units loses the doubling as a whole (recommended reading; the manual may count unit by unit), and every Axis side's
 * units suffer it (Germans, Italians, Rumanians, Minor-Allies), not the Germans alone.
 */
export function winterDefence(ctx: GameContext, state: GameState, defenders: readonly Pick<Unit, "owner">[], at: HexId): boolean {
  if (!winterInForce(state) || ctx.map.hexes[at]?.country !== RUSSIA_COUNTRY) return false;
  return defenders.some((u) => u.owner !== WINTER_EXEMPT_OWNER && sideInWar(state, u.owner) === "axis");
}

/** Whether the winter forbids this Option now: the Axis, on the Eastern Front, the Offensive Option, in a Game Turn the winter is in force (Ref 28.0). */
export const winterBansOffensive = (state: GameState, side: Side, front: Front, option: FrontOption): boolean =>
  winterInForce(state) && side === "axis" && front === "eastern" && option === "offensive";
