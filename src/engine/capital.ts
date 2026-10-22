import type { GameContext } from "./context";
import type { HexId } from "./hex";
import type { PowerId } from "./types";

/**
 * Capitals of the Major Powers (spec 14 R4; Ref 2.0, 18.1). Map facts only, so control.ts can ask which Power a hex is the capital of
 * without a loop of imports; the rules about holding it are in conquest.ts.
 */

/**
 * The Major Powers whose capital hex is on the map (Ref 18.1). The U.S.A. has none; Moscow is not a capital that conquers (R7, tickets 14-14 and 14-15).
 */
const WITH_CAPITAL: readonly PowerId[] = ["germany", "italy", "britain", "france"];

/**
 * The Major Powers that are conquered when an enemy holds their capital at the end of their own Combat Phase, as built (Ref 18.1). The U.S.A. cannot
 * be conquered (R8); the U.S.S.R. is not conquered when Moscow falls but follows its own rules (R7). France falls at the end of the Allied Combat Phase
 * (R5, ticket 14-7), with Vichy France, the halving of its units and the colony dice (conquest-france.ts).
 */
export const CONQUERED_BY_CAPITAL: readonly PowerId[] = ["germany", "italy", "britain", "france"];

const capitals = new WeakMap<GameContext, ReadonlyMap<PowerId, HexId>>();

function capitalsOf(ctx: GameContext): ReadonlyMap<PowerId, HexId> {
  let hit = capitals.get(ctx);
  if (!hit) {
    const out = new Map<PowerId, HexId>();
    for (const h of Object.values(ctx.map.hexes)) {
      const power = WITH_CAPITAL.find((p) => p === h.country);
      if (power && h.land && h.features.some((f) => f === "capital" || f === "capital-port")) out.set(power, h.id);
    }
    capitals.set(ctx, (hit = out));
  }
  return hit;
}

/** The capital hex of a Major Power that has one on the map (Germany, Italy, Britain, France), or null for any other Power. */
export const capitalOf = (ctx: GameContext, power: PowerId): HexId | null => capitalsOf(ctx).get(power) ?? null;

/** The Major Power (one of `CONQUERED_BY_CAPITAL`) whose capital this hex is, or null: the hexes whose taking is worth a warning. */
export function powerOfCapital(ctx: GameContext, hex: HexId): PowerId | null {
  for (const [power, capital] of capitalsOf(ctx)) if (capital === hex && CONQUERED_BY_CAPITAL.includes(power)) return power;
  return null;
}
