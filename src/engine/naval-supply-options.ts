import { controllingSide, sideInWar } from "./control";
import type { GameContext } from "./context";
import type { HexId } from "./hex";
import { useOf, type SeaSupplyDesignation } from "./naval-record";
import { isPort, portFronts, portsOf } from "./naval-ports";
import { ONE_HEX_ISLANDS } from "./naval-rules";
import { checkDesignations, designationProblem, freeCapacity, placeFronts, portReached, sameSupplySea, supplyChainLink } from "./naval-supply";
import { byId, supplyNetwork, supplyStatus, type SupplyLine } from "./supply";
import type { ForceOwner, GameState, Side, Unit } from "./types";

/**
 * Sea supply, the questions a caller asks (spec 12 R6, R7, C4): is this port supplied, why is this designation refused, which designations would
 * save cut-off units, and along which path a named unit is supplied. They build the side's land network themselves; the checks they rely on are
 * in naval-supply.ts, which supply.ts uses. Pure queries: nothing here records a designation (naval-actions.ts does).
 */

const byHex = (a: HexId, b: HexId): number => (a < b ? -1 : a > b ? 1 : 0);

/** The designations of the state that stand for the side, in order: the valid ones, each counted against the later ones. */
const standingFor = (ctx: GameContext, state: GameState, side: Side): SeaSupplyDesignation[] =>
  checkDesignations(ctx, state, supplyNetwork(ctx, state, side)).filter((c) => c.problem === null).map((c) => c.designation);

/**
 * Whether a land supply line joins the port (or any hex) to a supply source of the side: a main source set or a special net, through hexes the side
 * controls with no enemy armor zone of control between; the hex itself may stand in a zone (Ref 19.3; N10). With an owner, only the sets that
 * serve a counter of that owner count (a French port net does not serve a British fleet). Fortress self-supply is not a line (Ref 19.2).
 */
export function portSupplied(ctx: GameContext, state: GameState, side: Side, hex: HexId, owner?: ForceOwner): boolean {
  const network = supplyNetwork(ctx, state, side);
  return owner === undefined ? network.reaches.some((r) => r.kind !== "sea" && r.next.has(hex)) : portReached(network, hex, owner);
}

/** The first rule a designation would break if it were made now, in one sentence (Ref 19.31; spec 12 R7), or null if it is valid next to the ones already recorded. */
export function seaSupplyProblem(ctx: GameContext, state: GameState, side: Side, d: SeaSupplyDesignation): string | null {
  return designationProblem(ctx, state, supplyNetwork(ctx, state, side), d, standingFor(ctx, state, side));
}

/** A designation worth proposing, and how many cut-off units it saves. */
export interface SeaSupplyOption extends SeaSupplyDesignation {
  saves: number;
}

/**
 * The designations that would save at least one cut-off unit, one per origin port and receiving place (spec 12 C2, B7), best first: most units
 * saved, then the lowest port hex, then the lowest place hex. The fleets are the fewest of that port, by id, whose free naval factors cover the
 * units; the units are the cut-off ones joined to the place by land, by id, as many as those fleets carry. Every option is valid (`seaSupplyProblem`
 * is null). Units already saved by a recorded designation, and fleets with no capacity left, are not offered again.
 */
export function seaSupplyOptions(ctx: GameContext, state: GameState, side: Side): SeaSupplyOption[] {
  const network = supplyNetwork(ctx, state, side);
  const standing = standingFor(ctx, state, side);
  const cut = supplyStatus(ctx, state, side).unsupplied; // in unit-id order; units a recorded designation feeds are not in it
  if (cut.length === 0) return [];
  const room = freeCapacity(state, standing);
  // Fleets that could carry, by port and group, in id order.
  const crews = new Map<string, Unit[]>();
  const usable: Unit[] = [];
  for (const f of Object.values(state.units).sort((a, b) => byId(a.id, b.id))) {
    const use = useOf(state, f.id);
    if (f.type !== "fleet" || sideInWar(state, f.owner) !== side || !isPort(ctx, f.at) || (use !== undefined && use !== "supply") || room(f.id) <= 0) continue;
    usable.push(f);
    if (!portReached(network, f.at, f.owner)) continue;
    const key = `${f.at}|${network.groupOf(f.owner)}`;
    crews.set(key, [...(crews.get(key) ?? []), f]);
  }
  const places = [...new Set([...portsOf(ctx), ...ONE_HEX_ISLANDS])].filter((h) => controllingSide(ctx, state, h) === side).sort(byHex);
  const out: SeaSupplyOption[] = [];
  for (const [key, crew] of crews) {
    const from = key.split("|")[0]!;
    for (const to of places) {
      if (!portFronts(ctx, from).some((f) => placeFronts(ctx, to).includes(f) && sameSupplySea(ctx, from, to, f))) continue; // one Front in common (Ref 19.31)
      const land = network.reachFrom([to]);
      const group = network.groupOf(crew[0]!.owner);
      const savable = cut.filter((id) => land.has(state.units[id]!.at) && network.groupOf(state.units[id]!.owner) === group);
      const fleets: Unit[] = [];
      let carry = 0;
      for (const f of crew) {
        if (carry >= savable.length) break;
        fleets.push(f);
        carry += room(f.id);
      }
      const units = savable.slice(0, carry);
      const d: SeaSupplyDesignation = { fleets: fleets.map((f) => f.id), from, to, units };
      if (designationProblem(ctx, state, network, d, standing) === null) out.push({ ...d, saves: units.length });
    }
  }
  const order = (a: SeaSupplyOption, b: SeaSupplyOption): number => b.saves - a.saves || byHex(a.from, b.from) || byHex(a.to, b.to)
    || byHex(a.fleets.join("|"), b.fleets.join("|"));
  // Serial legs are proposed only when no ordinary designation serves this place/group (spec 12 R7, ticket 12-8).
  const chains: SeaSupplyOption[] = [];
  for (const first of usable) {
    if (!portReached(network, first.at, first.owner)) continue;
    const group = network.groupOf(first.owner);
    for (const second of usable) {
      if (first.at === second.at || network.groupOf(second.owner) !== group) continue;
      for (const to of places) {
        if (out.some((o) => o.to === to && network.groupOf(state.units[o.fleets[0]!]!.owner) === group)) continue;
        const land = network.reachFrom([to]);
        const units = cut.filter((id) => land.has(state.units[id]!.at) && network.groupOf(state.units[id]!.owner) === group)
          .slice(0, Math.min(room(first.id), room(second.id)));
        const d: SeaSupplyDesignation = { fleets: [first.id, second.id], from: first.at, to, units };
        if (units.length > 0 && supplyChainLink(ctx, state, d) && designationProblem(ctx, state, network, d, standing) === null) chains.push({ ...d, saves: units.length });
      }
    }
  }
  return [...out.sort(order), ...chains.sort(order)];
}

/**
 * How a unit is supplied by sea: the land path from the unit to the receiving place of a valid designation that names it, with the fleets and
 * their port, or null if no valid designation names it. Does not look at land supply: ask `supplyStatus` for the line that wins.
 */
export function seaSupplyLine(ctx: GameContext, state: GameState, side: Side, unit: Unit): SupplyLine | null {
  if (!state.naval) return null;
  const network = supplyNetwork(ctx, state, side);
  const d = checkDesignations(ctx, state, network).find((c) => c.problem === null && c.designation.units.includes(unit.id))?.designation;
  if (!d) return null;
  const next = network.reachFrom([d.to]);
  const path = [unit.at];
  for (let h = next.get(unit.at) ?? null; h !== null; h = next.get(h) ?? null) path.push(h);
  return { unitId: unit.id, source: d.to, path, via: "sea", sea: { fleets: [...d.fleets], from: d.from, to: d.to } };
}
