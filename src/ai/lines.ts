import { controlAfterEntry, controllingSide, sideInWar } from "../engine/control";
import type { GameContext } from "../engine/context";
import type { HexId } from "../engine/hex";
import { SUPPLY_CHECKED_TYPES, SUPPLY_POLICY, supplyNetwork, type SupplyNetwork } from "../engine/supply";
import { supplyEffectsOn } from "../engine/supply-effects";
import { fortressSupplies } from "../engine/supply-sources";
import type { GameState, Side, Unit } from "../engine/types";
import { adjacentHexes, canCross, zocSources } from "../engine/zoc";
import type { AiConfig } from "./types";

/**
 * Where a move would leave units in supply (computer policy helpers for spec 05, "keep supply lines"; the rules are the engine's, supply.ts).
 * The engine's `supplyStatus` answers for the position as it stands; the mover needs the answer for each hex it could move to, dozens per
 * decision, so this reads the engine's own line search (`supplyNetwork`) once per position and asks, for one hex, whether a line would reach it
 * once the move has been made. Of what supply reads, a move changes only the units' new hex, which their entry may bring under their side's
 * control (`controlAfterEntry`): control of the hexes passed through and left does not change (CONTROL_ON_PASS_THROUGH is off), and a friendly
 * unit does not cancel enemy ZOC (ZOC_POLICY). So no line is lost by a move; the newly controlled hex may open a line for another cut-off unit,
 * which does not change the answer for the stack that moved. So the hex is supplied after the move when a line already reaches it, when a line reaches a neighbour
 * from which the search would step into it (same test as the engine's search: the neighbour is not in enemy ZOC unless it is a source,
 * the hexside can be crossed, and the two are not in the ZOC of the same enemy unit when the neighbour is a source), when a Fortress of the
 * side stands there (Ref 4.8, 19.2), or when it is a Major Power's capital, which supplies whoever holds it (19.2).
 * Not foreseen, so a few supplied hexes are judged cut off (never the reverse; tests/ai-lines.test.ts checks this against the engine on
 * positions of real games): a captured port that opens a special net (Libyan, Egyptian, Tunis, Beirut), and a line-length limit
 * (`SUPPLY_POLICY.maxLength` is null). Sea reaches serve only the unit ids named in a valid designation (spec 12 R7).
 */

const networks = new WeakMap<GameContext, WeakMap<GameState, Map<Side, SupplyNetwork>>>();

/** The side's supply network for this position, built once per context and position (a state is never changed in place). */
export function networkOf(ctx: GameContext, state: GameState, side: Side): SupplyNetwork {
  let byState = networks.get(ctx);
  if (!byState) networks.set(ctx, (byState = new WeakMap<GameState, Map<Side, SupplyNetwork>>()));
  let bySide = byState.get(state);
  if (!bySide) byState.set(state, (bySide = new Map<Side, SupplyNetwork>()));
  let hit = bySide.get(side);
  if (!hit) bySide.set(side, (hit = supplyNetwork(ctx, state, side)));
  return hit;
}

/** Whether a Major Power's capital stands on the hex: it supplies whichever side holds it (19.2; `supplySources`). */
const isMajorCapital = (ctx: GameContext, state: GameState, hex: HexId): boolean => {
  const h = ctx.map.hexes[hex];
  return !!h?.land && h.features.some((f) => SUPPLY_POLICY.sourceFeatures.includes(f)) && h.country !== undefined && h.country in state.nations;
};

/** Whether a unit of `owner` standing on `to` would be supplied, once `units` (which include it) have moved there. */
function unitSupplied(ctx: GameContext, state: GameState, net: SupplyNetwork, unit: Unit, to: HexId): boolean {
  const owner = unit.owner;
  if (fortressSupplies(ctx, state, net.side, { at: to, owner })) return true;
  if (isMajorCapital(ctx, state, to)) return true;
  for (const r of net.reaches) {
    if (r.kind === "sea" ? !r.units?.has(unit.id) : !r.serves(owner)) continue;
    if (r.next.has(to)) return true;
    for (const n of adjacentHexes(ctx, to)) {
      if (!r.next.has(n) || !canCross(ctx, n, to)) continue;
      const inZoc = net.zoc.has(n);
      if (inZoc && !r.sources.has(n)) continue;
      if (inZoc && net.zoc.has(to) && zocSources(ctx, state, net.side, n).some((id) => zocSources(ctx, state, net.side, to).includes(id))) continue;
      return true;
    }
  }
  return false;
}

/**
 * Whether every unit of `units` whose supply is checked (one side's, standing together or not) would be in supply right after moving to `to`, judged from `net`, the
 * side's network for the position before the move. The hex must be under the side's control once they enter it (supply.ts: a unit's own hex
 * must be friendly-controlled), and free of enemy ground units (it is, or the move is not legal).
 */
export function suppliedAfterMove(ctx: GameContext, state: GameState, net: SupplyNetwork, units: readonly Unit[], to: HexId): boolean {
  const checked = units.filter((u) => SUPPLY_CHECKED_TYPES.includes(u.type)); // replacements are not checked (supply.ts)
  if (checked.length === 0) return true;
  const side = net.side;
  const friendly = controllingSide(ctx, state, to) === side || units.some((u) => {
    const c = controlAfterEntry(ctx, state, u, to);
    return c !== null && sideInWar(state, c) === side;
  });
  if (!friendly) return false;
  return checked.every((u) => unitSupplied(ctx, state, net, u, to));
}

/**
 * Prefer supply (computer policy, spec 05, TODO(verify) by play-testing; acts only while the supply effects are on, see `supplyRulesOn`): of the
 * moves that bring a stack closer to its objective, it takes one that keeps it in supply whenever there is one, even if a move that would leave
 * it cut off gets closer, because a unit cut off when its next Player Turn begins cannot move or advance and is eliminated if still cut off at its
 * end (Ref 19.4, 11.74). Only when every such move would leave it cut off does it still make the best of them: standing still gains nothing,
 * and the move may reach a hex that a later move or a capture reconnects (a Major Power's capital supplies whoever takes it, 19.2).
 * Measured against refusing every cut-off move outright, and against allowing one onto an enemy-held objective: both lost objectives (spec 05,
 * "As built: supply-aware movement").
 */
export const MOVE_PREFER_SUPPLY = true;

/** Whether the computer's supply rules act: only while the supply effects are on in this game, and not when the caller switched them off (`AiConfig.supplyRules`). */
export const supplyRulesOn = (ctx: GameContext, cfg: AiConfig): boolean => cfg.supplyRules !== false && supplyEffectsOn(ctx);

/**
 * The candidates the mover chooses among (MOVE_PREFER_SUPPLY): those that keep the stack in supply (`suppliedAfterMove` on the position before the
 * move), or all of them when none does. `cutOff` says the second happened. Unchanged when the rules do not act.
 */
export function preferSupplied<T extends { units: readonly Unit[]; to: HexId }>(ctx: GameContext, state: GameState, candidates: readonly T[], cfg: AiConfig): { pool: readonly T[]; cutOff: boolean } {
  if (!MOVE_PREFER_SUPPLY || !supplyRulesOn(ctx, cfg) || candidates.length === 0) return { pool: candidates, cutOff: false };
  const net = networkOf(ctx, state, state.activeSide);
  const kept = candidates.filter((c) => suppliedAfterMove(ctx, state, net, c.units, c.to));
  return kept.length > 0 ? { pool: kept, cutOff: false } : { pool: candidates, cutOff: true };
}
