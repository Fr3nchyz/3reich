import type { Action } from "../engine/actions";
import type { GameContext } from "../engine/context";
import type { GameState, Unit } from "../engine/types";
import { attritionLabel } from "./attritionText";
import { nationAdjective, placeName, stackSummary, unitsWithIds } from "./names";

/**
 * The words on the Attack, Lose and Advance buttons (spec 07, part B). They name places and counters, never ids; a
 * long stack is told by kind and count instead of counter by counter; and the buttons of one list are made to read
 * differently from each other: legal actions that would do exactly the same are shown once, and any two that still
 * read alike get "(1 of 2)". focusKeep.ts finds a button again by its exact label, so a label must be unique in its list.
 */

/** A stack told counter by counter is used up to this many characters; beyond it the compact form below takes over. */
export const FULL_LABEL_LIMIT = 110;
/** The compact form names at most this many hexes in full. */
const COMPACT_HEXES = 2;

/** The units of `ids` still in the game, grouped by the hex they stand in, in order of first appearance. */
function byHex(state: Pick<GameState, "units">, ids: readonly string[]): [string, Unit[]][] {
  const groups = new Map<string, Unit[]>();
  for (const u of unitsWithIds(state, ids)) groups.set(u.at, [...(groups.get(u.at) ?? []), u]);
  return [...groups];
}

/** "5 German infantry, 2 German armor": counted by nation and kind, factors left out. */
function byKind(units: readonly Unit[]): string {
  const counts = new Map<string, number>();
  for (const u of units) counts.set(`${nationAdjective(u)} ${u.type}`, (counts.get(`${nationAdjective(u)} ${u.type}`) ?? 0) + 1);
  return [...counts].map(([k, n]) => `${n} ${k}`).join(", ");
}

/** Counters with the place each stands in; the compact form once the full one is too long. */
export function unitsWhere(ctx: Pick<GameContext, "map">, state: Pick<GameState, "units">, ids: readonly string[]): string {
  const groups = byHex(state, ids);
  if (groups.length === 0) return "no units";
  const full = groups.map(([at, us]) => `${stackSummary(us)} from ${placeName(ctx.map, at)}`).join(" and ");
  if (full.length <= FULL_LABEL_LIMIT) return full;
  const shown = groups.slice(0, COMPACT_HEXES).map(([at, us]) => `${byKind(us)} from ${placeName(ctx.map, at)}`);
  const rest = groups.slice(COMPACT_HEXES);
  const more = rest.reduce((n, [, us]) => n + us.length, 0);
  return `${shown.join(" and ")}${rest.length ? ` and ${more} more unit${more === 1 ? "" : "s"} from ${rest.length} hex${rest.length === 1 ? "" : "es"}` : ""}`;
}

/** The Attack, Lose, Advance and air-support buttons, or null for any other action. */
export function combatLabel(a: Action, ctx: GameContext, state: GameState): string | null {
  switch (a.type) {
    case "ATTACK":
      return `Attack ${placeName(ctx.map, a.target)} with ${unitsWhere(ctx, state, a.units)}`;
    case "ALLOCATE_LOSSES":
      return `Lose ${unitsWhere(ctx, state, a.units)}`;
    case "ADVANCE":
      return `Advance ${unitsWhere(ctx, state, a.units)} into ${placeName(ctx.map, a.to)}`;
    case "PLACE_EXPLOITERS": // the plain button until the Breakthrough card of ticket 16-12
      return `Move ${unitsWhere(ctx, state, a.units)} into the Breakthrough at ${placeName(ctx.map, a.hex)}`;
    case "EXPLOIT_MOVE": // the plain button until the Exploitation card of ticket 16-12
      return a.path.length === 0 ? `Hold ${unitsWhere(ctx, state, [a.unit])} in the Breakthrough` : `Exploit with ${unitsWhere(ctx, state, [a.unit])} to ${placeName(ctx.map, a.path.at(-1)!)}`;
    case "DESIGNATE_AIR": {
      const factors = unitsWithIds(state, a.units).reduce((n, u) => n + u.strength, 0);
      return `Air support for ${placeName(ctx.map, a.target)}: ${unitsWhere(ctx, state, a.units)} (${factors} air factor${factors === 1 ? "" : "s"})`;
    }
    default:
      return attritionLabel(a, ctx, state); // the plain Attrition buttons of steps 7a and 7p (ticket 16-4 wiring; the cards are 16-7)
  }
}

/** What an action does, without the ids: two actions with the same key differ only in which of identical counters they name. */
export function effectKey(a: Action, state: Pick<GameState, "units">): string {
  if (!("units" in a) || !a.units) return JSON.stringify(a);
  const counters = unitsWithIds(state, a.units).map((u) => [u.at, u.owner, u.nationality ?? "", u.type, u.strength, u.movement ?? ""].join("|")).sort();
  return JSON.stringify({ ...a, units: counters });
}

export interface Labelled {
  action: Action;
  text: string;
}

/**
 * The buttons of a list: the action and its words. An action whose effect equals an earlier one's is dropped (it would be a second
 * button with the same words doing the same thing); those that still read alike are numbered "(1 of 2)".
 */
export function labelled(actions: readonly Action[], ctx: GameContext, state: GameState, label: (a: Action) => string): Labelled[] {
  const seen = new Set<string>();
  const out: Labelled[] = [];
  for (const action of actions) {
    const key = effectKey(action, state);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ action, text: label(action) });
  }
  const total = new Map<string, number>();
  for (const l of out) total.set(l.text, (total.get(l.text) ?? 0) + 1);
  const next = new Map<string, number>();
  return out.map((l) => {
    const n = total.get(l.text)!;
    if (n === 1) return l;
    const i = (next.get(l.text) ?? 0) + 1;
    next.set(l.text, i);
    return { ...l, text: `${l.text} (${i} of ${n})` };
  });
}
