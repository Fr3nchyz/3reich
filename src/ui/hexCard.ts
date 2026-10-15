import { combatOf } from "../engine/combat-record";
import type { GameContext } from "../engine/context";
import { controllerOf } from "../engine/control";
import { GROUND_COMBAT_TYPES } from "../engine/attack-rules";
import { movesOf } from "../engine/move-record";
import { OWNER_NAMES } from "../engine/nations";
import type { GameState, Unit, UnitType } from "../engine/types";
import { cap } from "./format";
import { factorsOf, nationAdjective, placeName } from "./names";

/**
 * The hex card (spec 07, part A): everything the screen says about one hex when it is tapped, as plain data. It lists each counter
 * in the hex (kind, nation, factors and the notes the engine knows), the place, who holds it and its terrain basics.
 * Pure: it reads the position and decides no rule, never touches the dice, and never prints a unit id.
 */

export interface CardCounter {
  /** Stable key for the list (the unit id); never shown. */
  key: string;
  /** "3-4 German armor": the whole counter in words, for the accessible name. */
  name: string;
  /** The numbers as the counter prints them: "3-4", or "3" for a counter with a single factor. */
  factors: string;
  /** "German armor". */
  kind: string;
  /** "held by Germany" when the counter's nation is not its owner (the Italian fleet Germany holds in 1944), else null. */
  heldBy: string | null;
  /** What the engine knows about it now: "defends" or "does not defend", "moved", "has attacked", "can advance into Warsaw (M35)". */
  notes: string[];
}

export interface HexCard {
  hex: string;
  /** "Warsaw (M35)", or "Plain hex in Poland (M34)" when the hex has no printed name. */
  title: string;
  /** "Plain, Poland, Eastern Front, city, port." */
  terrain: string;
  /** "Held by Poland.", "Held by no nation.", or "" for sea. */
  holder: string;
  counters: CardCounter[];
  /** "4 counters", "1 counter" or "No counters here." */
  count: string;
}

/** A printed country id in words: "baltic-states" becomes "Baltic states". */
const countryWords = (c: string): string => cap(c.replace(/-/g, " "));

/** Whether a counter of this kind fights when it is attacked on the ground (GROUND_COMBAT_TYPES, spec 04; Replacement is TODO(verify) there). */
const defends = (type: UnitType): boolean => GROUND_COMBAT_TYPES.includes(type);

function title(ctx: GameContext, id: string): string {
  const h = ctx.map.hexes[id];
  if (!h || h.name?.trim()) return placeName(ctx.map, id);
  const kind = h.land ? `${cap(h.land)} hex` : "Sea hex";
  return `${kind}${h.country ? ` in ${countryWords(h.country)}` : ""} (${id})`;
}

function terrain(ctx: GameContext, state: GameState, id: string): string {
  const h = ctx.map.hexes[id];
  if (!h) return "";
  const parts = [h.land ? cap(h.land) : "Sea", h.land && h.sea ? "coastal" : "", h.country ? countryWords(h.country) : "", `${cap(h.front)} Front`];
  // Fortress status is read from the position, the way the defence multiplier reads it (a printed fortress that has not taken effect is not announced).
  if (state.fortresses[id] === true) parts.push(h.fortress ? `fortress (${h.fortress})` : "fortress");
  if (h.features.length) parts.push(h.features.join(", "));
  return `${parts.filter(Boolean).join(", ")}.`;
}

function holder(ctx: GameContext, state: GameState, id: string): string {
  if (!ctx.map.hexes[id]?.land) return "";
  const who = controllerOf(ctx, state, id);
  return who ? `Held by ${OWNER_NAMES[who]}.` : "Held by no nation.";
}

function counter(ctx: GameContext, state: GameState, u: Unit): CardCounter {
  const notes = [defends(u.type) ? "defends" : "does not defend"];
  if (movesOf(state).moved.includes(u.id)) notes.push("moved");
  const combat = combatOf(state);
  if (combat.attacked.includes(u.id)) notes.push("has attacked");
  for (const a of combat.advances) if (a.units.includes(u.id)) notes.push(`can advance into ${placeName(ctx.map, a.to)}`);
  const kind = `${nationAdjective(u)} ${u.type}`;
  return {
    key: u.id,
    name: `${factorsOf(u)} ${kind}`,
    factors: factorsOf(u),
    kind,
    heldBy: u.nationality && u.nationality !== u.owner ? `held by ${OWNER_NAMES[u.owner]}` : null,
    notes,
  };
}

/** The card for `hex`: its counters in the order the position lists them. An id that is not a hex of the map gives a card with no counters. */
export function hexCard(ctx: GameContext, state: GameState, hex: string): HexCard {
  const counters = Object.values(state.units).filter((u) => u.at === hex).map((u) => counter(ctx, state, u));
  return {
    hex,
    title: title(ctx, hex),
    terrain: terrain(ctx, state, hex),
    holder: holder(ctx, state, hex),
    counters,
    count: counters.length === 0 ? "No counters here." : `${counters.length} counter${counters.length === 1 ? "" : "s"}`,
  };
}
