import { isGroundCombatUnit } from "./attack-rules";
import { isConquered } from "./conquest-record";
import type { GameContext } from "./context";
import { controllingSide, sideInWar } from "./control";
import { turnIndex } from "./game";
import { isUnitSupplied } from "./supply";
import type { GameState } from "./types";

// spec 14 R6; TODO(verify) V16: earliest surrender Game Turn.
export const V16_SURRENDER_FROM = { year: 1943, season: "spring" } as const;
// spec 14 R6; TODO(verify) V16: Italian land outside these zones is mainland.
export const V16_MAINLAND_EXCLUDES = ["sicily", "sardinia"] as const;
// spec 14 R6; TODO(verify) V16: all five countries exist on the map; all Egypt counts.
export const V16_AFRICA_COUNTRIES: readonly string[] = ["egypt", "libya", "tunisia", "algeria", "morocco"];
// spec 14 R6; TODO(verify) V16: Vichy counters are ignored; false counts them as Axis forces.
export const V16_VICHY_UNITS_IGNORED = true;
// spec 14 R6; TODO(verify) V16: Germany retains the die plus this many naval factors.
export const V16_NAVAL_BONUS = 2;
// spec 14 R6; TODO(verify) V16: mainland presence must be supplied.
export const V16_UNSUPPLIED_NOT_COUNTED = true;
// spec 14 R6; TODO(verify) V16: airborne presence cannot trigger surrender.
export const V16_AIRBORNE_EXCLUDED = true;

// spec 14 R6; TODO(verify) V16: zone hexes from src/data/islands.ts, pinned there by tests.
// Kept here because engine imports cannot depend on data, and some scenarios omit these zones.
export const V16_ISLAND_HEXES = {
  sicily: ["DD19", "DD20", "DD21", "EE19", "EE20", "EE21"],
  sardinia: ["AA18", "AA19", "Y19", "Y20", "Z19"],
  corsica: ["X20"],
} as const;

export interface ItalySurrenderTest {
  date: boolean;
  mainland: boolean;
  africaClear: boolean;
  islands: boolean;
  initiative: boolean;
  surrenders: boolean;
}

/** `alliesFirst` means the Allies moved first this Game Turn; the caller supplies it. Pure query; the caller checks phase timing (spec 14 R6). */
export function italySurrenderTest(ctx: GameContext, state: GameState, alliesFirst: boolean): ItalySurrenderTest {
  // spec 14 R6: supplied, non-airborne Allied ground forces on Italian land outside the excluded islands.
  const excluded = new Set<string>(V16_MAINLAND_EXCLUDES.flatMap((id) => V16_ISLAND_HEXES[id]));
  const units = Object.values(state.units);
  const mainland = units.some((u) => isGroundCombatUnit(u) && (!V16_AIRBORNE_EXCLUDED || u.type !== "airborne") &&
    sideInWar(state, u.owner) === "allies" && ctx.map.hexes[u.at]?.country === "italy" &&
    !!ctx.map.hexes[u.at]?.land && !excluded.has(u.at) && (!V16_UNSUPPLIED_NOT_COUNTED || isUnitSupplied(ctx, state, u.id)));
  // spec 14 R6: Axis ground, air and fleets in Africa block surrender; Vichy follows the named switch.
  const africaClear = !units.some((u) => (isGroundCombatUnit(u) || u.type === "air" || u.type === "fleet") &&
    V16_AFRICA_COUNTRIES.includes(ctx.map.hexes[u.at]?.country ?? "") &&
    (u.owner === "vichy-france" ? !V16_VICHY_UNITS_IGNORED : sideInWar(state, u.owner) === "axis"));
  // spec 14 R6: every hex of Sicily OR every hex of both Sardinia and Corsica must be Allied-held.
  const held = (id: "sicily" | "sardinia" | "corsica"): boolean => V16_ISLAND_HEXES[id].every((h) => controllingSide(ctx, state, h) === "allies");
  const islands = held("sicily") || (held("sardinia") && held("corsica"));
  // spec 14 R6: date and Initiative are independent conditions; conquest (including prior surrender) prevents another surrender.
  const date = turnIndex(state) >= turnIndex(V16_SURRENDER_FROM);
  const initiative = alliesFirst;
  const surrenders = date && mainland && africaClear && islands && initiative && !isConquered(state, "italy") && state.nations.italy.status !== "conquered";
  return { date, mainland, africaClear, islands, initiative, surrenders };
}

/** spec 14 R6 / Ref 18.2 / V16: die + 2, capped by available Italian naval factors; no dice rolled here. */
export function germanNavalShare(die: number, available: number): number {
  if (!Number.isInteger(die) || die < 1 || die > 6) throw new Error("Naval share die must be an integer from 1 to 6");
  return Math.min(die + V16_NAVAL_BONUS, available);
}

/** spec 14 R6: total Italian fleet strengths, including partial fleets. */
export function italianNavalFactors(state: GameState): number {
  return Object.values(state.units).reduce((sum, u) => sum + (u.owner === "italy" && u.type === "fleet" ? u.strength : 0), 0);
}
