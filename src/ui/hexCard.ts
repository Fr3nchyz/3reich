import { minorHexModel } from "./minorView";
import { airOf } from "../engine/air-record";
import { combatOf } from "../engine/combat-record";
import type { GameContext } from "../engine/context";
import { controllerOf } from "../engine/control";
import { GROUND_COMBAT_TYPES } from "../engine/attack-rules";
import { grayUntil, turnWords } from "../engine/naval-record";
import { movesOf } from "../engine/move-record";
import { OWNER_NAMES } from "../engine/nations";
import type { ForceOwner, GameState, Unit, UnitType } from "../engine/types";
import type { HexFeature, LandTerrain } from "../engine/terrain";
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

/** The map's country ids that are not an owner of forces and need more than a capital letter. */
const COUNTRY_WORDS: Readonly<Record<string, string>> = { "baltic-states": "Baltic States", "lebanon-syria": "Lebanon-Syria" };

/** A printed country id in words, the way the holder line names the same nation: "ussr" is "Soviet Union", "britain" is "Great Britain". */
export const countryName = (c: string): string => (c in OWNER_NAMES ? OWNER_NAMES[c as ForceOwner] : COUNTRY_WORDS[c] ?? cap(c));

const TERRAIN_WORDS: Readonly<Record<LandTerrain, string>> = { plain: "Plain", mountains: "Mountains", swamp: "Swamp", "qattara-depression": "Qattara Depression" };

const FEATURE_WORDS: Readonly<Record<HexFeature, string>> = { beach: "beach", city: "city", port: "port", capital: "capital", "capital-port": "capital and port", objective: "objective" };

/** Whether a counter of this kind fights when it is attacked on the ground (GROUND_COMBAT_TYPES, spec 04; Replacements defend but do not attack, Ref 12.1). */
const defends = (type: UnitType): boolean => GROUND_COMBAT_TYPES.includes(type);

function title(ctx: GameContext, id: string): string {
  const h = ctx.map.hexes[id];
  if (!h || h.name?.trim()) return placeName(ctx.map, id);
  const kind = h.land ? `${TERRAIN_WORDS[h.land]} hex` : "Sea hex";
  return `${kind}${h.country ? `, ${countryName(h.country)}` : ""} (${id})`;
}

function terrain(ctx: GameContext, state: GameState, id: string): string {
  const h = ctx.map.hexes[id];
  if (!h) return "";
  const parts = [h.land ? TERRAIN_WORDS[h.land] : "Sea", h.land && h.sea ? "coastal" : "", h.country ? countryName(h.country) : "", `${cap(h.front)} Front`];
  // Fortress status is read from the position, the way the defence multiplier reads it (a printed fortress that has not taken effect is not announced).
  if (state.fortresses[id] === true) parts.push("fortress");
  parts.push(...h.features.map((f) => FEATURE_WORDS[f]));
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
  if (u.type === "air" && airOf(state).staged.includes(u.id)) notes.push("changed base this turn");
  const gray = u.type === "fleet" ? grayUntil(state, u.id) : undefined; // spec 17 R5, RB7
  if (gray) notes.push(`Rebuilt: cannot act until ${turnWords(gray)}.`);
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
  const minor = minorHexModel(ctx, state, hex);
  const record = minor && state.countries?.[minor.minor];
  // Spec 15 R2/R3/R4/R9/R10, D3/D5: show pending declaration/placement
  // and sleeping-ally information; established wars retain the ordinary holder line.
  const lines = record?.toPlace || record?.duty ? minor?.lines ?? []
    : minor?.tint ? minor.lines.slice(-1) : [];
  return {
    hex,
    title: title(ctx, hex),
    terrain: terrain(ctx, state, hex),
    // Spec 15 R2/R9/R10 D3/D5: include minor status in the existing visible location line.
    holder: [holder(ctx, state, hex), ...lines].filter(Boolean).join(" "),
    counters,
    count: counters.length === 0 ? "No counters here." : `${counters.length} counter${counters.length === 1 ? "" : "s"}`,
  };
}
