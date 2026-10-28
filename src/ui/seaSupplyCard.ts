import { legalActions, type Action } from "../engine/actions";
import type { GameContext } from "../engine/context";
import { controllingSide } from "../engine/control";
import type { HexId } from "../engine/hex";
import { isPort, portCapacity, portsOf } from "../engine/naval-ports";
import { checkDesignations, freeCapacity } from "../engine/naval-supply";
import { seaSupplyOptions, seaSupplyProblem, type SeaSupplyOption } from "../engine/naval-supply-options";
import { ONE_HEX_ISLANDS } from "../engine/naval-rules";
import { sideOfOwner } from "../engine/setup";
import { byId, supplyNetwork, supplyStatus } from "../engine/supply";
import type { GameState, Side } from "../engine/types";
import { NAVAL_TEXT, navalPlaceName, navalProblemText, navalUnitName } from "./navalText";

/** Pure display data for spec 12 D1/D2/D5. Names are for display; ids occur only inside engine action payloads. No DOM or game mutations. */
type Designation = Extract<Action, { type: "DESIGNATE_SEA_SUPPLY" }>;
export interface SeaSupplyGroup { hex: HexId; place: string; units: string[]; reason: string }
export interface SeaSupplyProposal {
  fleets: string[];
  destination: string;
  explanation: string[];
  text: string;
  action: Designation;
}
export interface SeaSupplyFleet { name: string; from: string; reason: string | null; action: Designation | null }
export interface SeaSupplyCard {
  title: string;
  groups: SeaSupplyGroup[];
  proposal: SeaSupplyProposal | null;
  continue: { text: string; action: Extract<Action, { type: "END_STEP" }> | null };
}
const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((id, i) => id === b[i]);
const designations = (ctx: GameContext, state: GameState, side: Side): Designation[] => legalActions(ctx, state)
  .filter((a): a is Designation => a.type === "DESIGNATE_SEA_SUPPLY" && a.side === side);
const matching = (legal: readonly Designation[], o: SeaSupplyOption): Designation | undefined =>
  legal.find((a) => a.to === o.to && same(a.fleets, o.fleets) && same(a.units, o.units));

/** The cut-off places, preferred legal designation and legal way on, as plain data (spec 12 D1). */
export function seaSupplyCardModel(ctx: GameContext, state: GameState, side: Side): SeaSupplyCard {
  const cut = supplyStatus(ctx, state, side).unsupplied;
  const grouped = new Map<HexId, string[]>();
  for (const id of cut) {
    const u = state.units[id]!;
    grouped.set(u.at, [...(grouped.get(u.at) ?? []), navalUnitName(u)]);
  }
  const groups = [...grouped].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([hex, units]) => ({ hex, place: navalPlaceName(ctx, hex), units, reason: NAVAL_TEXT.cutOff }));
  const legal = designations(ctx, state, side);
  const option = seaSupplyOptions(ctx, state, side).find((o) => matching(legal, o));
  let proposal: SeaSupplyProposal | null = null;
  if (option) {
    const action = matching(legal, option)!;
    const fleets = option.fleets.map((id) => NAVAL_TEXT.fleetAt(navalUnitName(state.units[id]!), navalPlaceName(ctx, state.units[id]!.at)));
    const destination = navalPlaceName(ctx, option.to);
    const standing = checkDesignations(ctx, state, supplyNetwork(ctx, state, side)).filter((c) => c.problem === null).map((c) => c.designation);
    const room = freeCapacity(state, standing);
    const places = [...new Set(option.units.map((id) => state.units[id]!.at))].sort();
    proposal = { fleets, destination, text: NAVAL_TEXT.supply, action, explanation: [
      NAVAL_TEXT.carries(fleets, destination), ...places.filter((p) => p !== option.to).map((p) => NAVAL_TEXT.joined(navalPlaceName(ctx, p), destination)),
      NAVAL_TEXT.capacity(option.fleets.map(room), option.units.length), option.fleets.length === 1 ? NAVAL_TEXT.after : NAVAL_TEXT.afterMany,
    ] };
  }
  const end = legalActions(ctx, state).find((a): a is Extract<Action, { type: "END_STEP" }> => a.type === "END_STEP" && a.side === side && (a.step === "6e" || a.step === "9f"));
  return { title: NAVAL_TEXT.title(cut.length), groups, proposal, continue: { text: NAVAL_TEXT.leave, action: end ?? null } };
}

/** Every fleet of the side, with an engine-listed action or its engine refusal in words (spec 12 D1/D5). `to` selects the pocket being considered. */
export function otherFleets(ctx: GameContext, state: GameState, side: Side, to?: HexId): SeaSupplyFleet[] {
  const legal = designations(ctx, state, side), cut = supplyStatus(ctx, state, side).unsupplied;
  const network = supplyNetwork(ctx, state, side);
  const target = to ?? seaSupplyOptions(ctx, state, side)[0]?.to ?? [...new Set([...portsOf(ctx), ...ONE_HEX_ISLANDS])].sort()
    .find((h) => controllingSide(ctx, state, h) === side && cut.some((id) => network.reachFrom([h]).has(state.units[id]!.at)));
  return Object.values(state.units).filter((u) => u.type === "fleet" && sideOfOwner(u.owner) === side).sort((a, b) => byId(a.id, b.id)).map((fleet) => {
    const action = legal.find((a) => a.to === target && a.fleets.includes(fleet.id));
    let reason: string | null = null;
    if (!action) {
      if (cut.length === 0) reason = NAVAL_TEXT.noUnits;
      else if (!target) reason = NAVAL_TEXT.noDestination;
      else {
        const units = cut.filter((id) => network.reachFrom([target]).has(state.units[id]!.at));
        // This object is only an engine refusal query. Every offered action comes from the legal list above.
        const problem = seaSupplyProblem(ctx, state, side, { fleets: [fleet.id], from: fleet.at, to: target, units: units.length > 0 ? units : [cut[0]!] });
        reason = problem ? navalProblemText(state, problem) : NAVAL_TEXT.noProposal;
      }
    }
    return { name: navalUnitName(fleet), from: navalPlaceName(ctx, fleet.at), reason, action: action ?? null };
  });
}

/** Naval factors at a port against its engine capacity, or null for a non-port (spec 12 D2; Ref 21.1, 5.0). */
export function portCapacityLine(ctx: GameContext, state: GameState, hex: HexId): string | null {
  if (!isPort(ctx, hex)) return null;
  const used = Object.values(state.units).filter((u) => u.type === "fleet" && u.at === hex).reduce((n, u) => n + u.strength, 0);
  return NAVAL_TEXT.portCapacity(used, portCapacity(ctx, hex), hex === "GG19");
}
