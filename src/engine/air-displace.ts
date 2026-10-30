import type { GameEvent } from "./action-types";
import { airBasesOf, airRoom, citiesAt, mayBaseAt, nationOf } from "./air-bases";
import { airOf } from "./air-record";
import { flightDistances } from "./air-range";
import { STAGING_RANGE } from "./air-rules";
import type { GameContext } from "./context";
import { areEnemies, controllingSide, sideInWar } from "./control";
import { hex, type HexId } from "./hex";
import { eliminateUnits } from "./losses";
import { stackingProblem } from "./placement";
import type { GameState, Unit } from "./types";

/** Ref 20.1 / Ops 5.48h; ruling 2026-10-29 Q2. TODO(verify) A2-A4: see the two rule registers. */
export const AIRBASE_CAPTURE_RULES = {
  // A2: default to the lowest-id friendly, unoccupied Russian land hex at the east edge.
  sovietEastEdge: "lowest-hex-id" as "lowest-hex-id" | "highest-hex-id",
  // A3: airbases go to the Box; whether displaced air units may follow is unverified. Default: no.
  usBoxHoldsAir: false as boolean,
  // A4: enemy-held/occupied or missing Capitals eliminate; full Capitals retain the airbase.
  unavailableCapital: null as HexId | null,
} as const;

/**
 * Spec 09 R9, part J7; TODO(verify) A5: flight-route distance, lowest hex id for ties, airbases before planes,
 * then numeric unit id (as fleet displacement). The capture hook's existing timing is retained; no owner-choice action is added.
 */
export const AIR_DISPLACEMENT_ORDER = { airbasesFirst: true, numericUnitIds: true, lowestHexIdFirst: true } as const;

/** Ref 20.1, Ops 5.48h; ruling 2026-10-29 Q2: Russian fallback when Moscow is lost. */
function sovietEastEdge(ctx: GameContext, state: GameState, base: Unit, from: HexId): HexId | null {
  const lastColumn = new Map<number, number>();
  for (const h of Object.values(ctx.map.hexes)) {
    const { q, r } = hex(h.id);
    lastColumn.set(r, Math.max(lastColumn.get(r) ?? 0, q));
  }
  const edge = Object.values(ctx.map.hexes).filter((h) => {
    if (!h.land || h.country !== "ussr" || h.id === from || controllingSide(ctx, state, h.id) !== sideInWar(state, base.owner)) return false;
    if (Object.values(state.units).some((u) => u.at === h.id && areEnemies(state, base.owner, u.owner))) return false;
    return hex(h.id).q === lastColumn.get(hex(h.id).r);
  }).map((h) => h.id).sort();
  // TODO(verify) A2: deterministic destination choice, independent of map insertion order.
  return (AIRBASE_CAPTURE_RULES.sovietEastEdge === "lowest-hex-id" ? edge[0] : edge.at(-1)) ?? AIRBASE_CAPTURE_RULES.unavailableCapital;
}

/** Ref 20.1, Ops 5.48h; ruling 2026-10-29 Q2: a full Capital still receives the airbase. */
export function airbaseCapital(ctx: GameContext, state: GameState, base: Unit, from: HexId): HexId | null {
  if (base.owner === "usa") return "us-box";
  const capital = Object.values(ctx.map.hexes).find((h) => h.country === base.owner && h.land && h.features.some((f) => f === "capital" || f === "capital-port"))?.id;
  const side = sideInWar(state, base.owner);
  const unavailable = !capital || capital === from || side === null || controllingSide(ctx, state, capital) !== side || Object.values(state.units).some((u) => u.at === capital && areEnemies(state, base.owner, u.owner));
  if (unavailable) return base.owner === "ussr" && side !== null ? sovietEastEdge(ctx, state, base, from) : AIRBASE_CAPTURE_RULES.unavailableCapital;
  return capital;
}

/** Spec 09 R9 / R3: nearest usable friendly base within eight flight hexes, with room for the entire counter (Ref 20.2, 20.1, 5.0). */
export function displacementBase(ctx: GameContext, state: GameState, plane: Unit, from: HexId): HexId | null {
  const side = sideInWar(state, plane.owner);
  if (side === null || !ctx.map.hexes[from]) return null;
  const distances = flightDistances(ctx, state, plane.owner, from, STAGING_RANGE);
  const placed = airOf(state).placed;
  const spec = { type: plane.type, strength: plane.strength, ...(plane.nationality ? { nationality: plane.nationality } : {}) };
  const bases = airBasesOf(ctx, state, side).filter((hex) => {
    if (hex === from || !distances.has(hex) || !mayBaseAt(ctx, state, plane, hex) || airRoom(ctx, state, hex) < plane.strength) return false;
    // Spec 09 R2: a new airbase on open ground serves its own nationality this Player Turn (same reading as stageProblem).
    const fresh = Object.values(state.units).find((b) => b.type === "airbase" && b.at === hex && placed.includes(b.id));
    if (fresh && citiesAt(ctx, hex) === 0 && fresh.owner !== plane.owner && fresh.owner !== nationOf(plane)) return false;
    return stackingProblem(ctx, state, plane.owner, spec, hex) === null;
  });
  bases.sort((a, b) => distances.get(a)! - distances.get(b)! || ((a < b ? -1 : 1) * (AIR_DISPLACEMENT_ORDER.lowestHexIdFirst ? 1 : -1))); // A5: fixed tie order
  // TODO(verify) A3: only U.S. air may follow a relocated U.S. airbase to the Box; default disabled.
  return bases[0] ?? (AIRBASE_CAPTURE_RULES.usBoxHoldsAir && plane.owner === "usa" && Object.values(state.units).some((u) => u.type === "airbase" && u.owner === "usa" && u.at === "us-box") ? "us-box" : null);
}

/** Spec 09 D1 / R9 / R2: relocate airbases first, then displace planes, counting capacity as it fills. No mission or staging use is charged. */
export function displaceAir(ctx: GameContext, state: GameState, from: HexId, units: readonly Unit[]): { state: GameState; events: GameEvent[] } {
  let current = state;
  const events: GameEvent[] = [];
  const air = units.filter((u) => u.type === "air" || u.type === "airbase");
  air.sort((a, b) => (AIR_DISPLACEMENT_ORDER.airbasesFirst ? Number(b.type === "airbase") - Number(a.type === "airbase") : 0) || (AIR_DISPLACEMENT_ORDER.numericUnitIds ? Number(a.id.replace(/\D/g, "")) - Number(b.id.replace(/\D/g, "")) : 0) || (a.id < b.id ? -1 : 1));
  for (const unit of air) {
    const to = unit.type === "airbase" ? airbaseCapital(ctx, current, unit, from) : displacementBase(ctx, current, unit, from);
    events.push({ type: "AIR_DISPLACED", unitId: unit.id, owner: unit.owner, from, to });
    if (to === null) {
      const lost = eliminateUnits(current, [unit.id]); // spec 17 R1: return to the pool or lose for good through the shared loss route
      current = lost.state;
      events.push(...lost.events);
    } else {
      current = { ...current, units: { ...current.units, [unit.id]: { ...unit, at: to } } };
    }
  }
  return { state: current, events };
}
