import type { GameContext } from "../engine/context";
import type { GameState, Unit } from "../engine/types";
import { placeName, unitName } from "./names";

/** The sea-supply card's words (spec 12 D1/D2/D5); names reuse the existing counter and place vocabulary. No rules or DOM. */
export const navalUnitName = (u: Unit): string => unitName(u, true);
export const navalPlaceName = (ctx: GameContext, at: string): string => placeName(ctx.map, at);
export const NAVAL_TEXT = {
  title: (n: number) => `${n} UNIT${n === 1 ? " IS" : "S ARE"} CUT OFF FROM SUPPLY`,
  cutOff: "No land line to a supply source.",
  supply: "Supply by sea",
  leave: "Leave them cut off, continue",
  after: "Afterwards this fleet can do nothing else this Game Turn.",
  afterMany: "Afterwards these fleets can do nothing else this Game Turn.",
  carries: (fleets: readonly string[], destination: string) => `${fleets.join(" and ")} carries supply to ${destination}.`,
  joined: (place: string, destination: string) => `${place} is joined to ${destination} by land.`,
  capacity: (room: readonly number[], needs: number) => room.length === 1 ? `It can carry ${room[0]}, needs ${needs}.`
    : `Available places by fleet: ${room.join(" and ")}; this designation needs ${needs}.`,
  fleetAt: (name: string, place: string) => `${name} at ${place}`,
  noUnits: "No cut-off unit needs sea supply.",
  noProposal: "No legal sea-supply proposal uses this fleet for this destination now.",
  noDestination: "No friendly receiving port or island is joined to the cut-off units by land.",
  portCapacity: (used: number, capacity: number, malta: boolean) => `naval factors ${used} of ${capacity}${malta ? ` (Malta: ${capacity} at most)` : ""}`,
};

/** Engine refusal strings keep their meaning; counter ids become names (spec 12 D5). Replace complete tokens, longest first. */
export function navalProblemText(state: GameState, problem: string): string {
  const ids = Object.keys(state.units).sort((a, b) => b.length - a.length);
  if (ids.length === 0) return problem;
  const escaped = ids.map((id) => id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return problem.replace(new RegExp(`(?<![\\w-])(?:${escaped.join("|")})(?![\\w-])`, "g"), (id) => navalUnitName(state.units[id]!));
}
