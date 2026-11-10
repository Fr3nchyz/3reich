import type { GameContext } from "../engine/context";
import type { GameState, Unit } from "../engine/types";
import { placeName, unitName } from "./names";

/** Spec 12 D3/D5: fleet cards use the same names and log vocabulary as sea supply. */
export const FLEET_TEXT = {
  move: "Move a fleet", select: "Choose a fleet in port, then a destination. Confirm to sail.",
  confirm: "Confirm fleet move", cancel: "Cancel", done: "Done with fleet moves",
  intercept: "Interception", declare: "Intercept", pass: "Pass this interception round",
  breakOff: "Break off before combat", resolve: "Resolve interceptions", results: "Naval results",
  close: "Close results", automaticLosses: "Losses are allocated automatically, smaller fleets first.",
  noTargets: "No legal interception is available. Pass to finish this round.",
  target: "Target course", meeting: "Meeting point",
  answering: (side: string) => `${side} answer this interception round.`,
  at: (fleet: string, port: string) => `${fleet} at ${port}`,
  course: (fleets: string, from: string, to: string) => `${fleets}: ${from} → ${to}`,
  reach: (distance: number, needed: number[] | "automatic") => `${distance} hexes; ${needed === "automatic" ? "automatic" : `needs ${needed.join(" or ")} on a die`}`,
  roll: (side: string, die: number, nationality: number, advantage: number, modified: number, loss: number) =>
    `${side === "interceptor" ? "Interceptors" : "Intercepted force"}: die ${die}, nationality ${nationality >= 0 ? "+" : ""}${nationality}, advantage +${advantage} = ${modified}; ${loss} naval factors lost.`,
};

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

/** Spec 12 R15/D5, AER98–103: sea-air card vocabulary. */
export const SEA_AIR_TEXT = {
  title: "Air against fleets at sea", planes: "Choose planes", target: "Choose a fleet course", point: "Attack point",
  note: "Choose planes, a fleet course and an attack point, then confirm. Assigning uses their air mission immediately; dice follow naval interceptions.",
  confirm: "Confirm sea-air attack", resolve: "Resolve sea-air attacks", cancel: "Cancel selection",
  assigned: "Assigned sea-air attacks", results: "Sea-air results", close: "Close results", fleet: "Fleet course",
  noAir: "No attacking planes remain. No dice rolled.", noFleets: "No participating fleets remain. No dice rolled.",
  at: (name: string, place: string) => `${name} at ${place}`,
  course: FLEET_TEXT.course,
  chosen: (n: number) => `${n} air factors chosen`,
  assignment: (target: string, point: string, planes: string[]) => `${target}; attack at ${point}: ${planes.join(", ")}`,
  resultTitle: (side: string, target: string, point: string) => `${side}: ${target}; attack at ${point}`,
  rolls: (rolls: number[]) => `Factor dice: ${rolls.join(", ")}.`,
  losses: (air: number, hits: number, naval: number) => `Actual losses: ${air} air factors; ${hits} naval hits, ${naval} naval factors lost.`,
};
