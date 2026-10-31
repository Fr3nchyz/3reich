import type { GameContext } from "./context";
import { controllerOf, sideInWar } from "./control";
import { isGroundCombatUnit } from "./attack-rules";
import type { HexId } from "./hex";
import { objectiveHexes, objectiveSide } from "./objectives";
import type { GameState, Unit } from "./types";
import { RUSSIA_COUNTRY } from "./winter";

/**
 * The Occupation Force (spec 14 R7c; Ref 18.41, Ops 5.45h), pure and not wired yet (ticket 14-17a; the steps 6h and 9k, the state flag, the SR limit and the card are 14-17b).
 * After Russia's surrender is accepted the Axis must keep 45 factors inside Russia, at least 30 of them ground. A shortfall costs 15 BRPs and one Axis-held Russian
 * Objective of the Axis' choice, handed back to Russia for good. The caller decides when the check is made and applies `applyShortfall` once per check.
 */

/** Spec 14 R7c: the factors the Axis must keep inside Russia. */
export const OCCUPATION_TOTAL = 45;
/** Spec 14 R7c: at least this many of them are ground factors. */
export const OCCUPATION_GROUND = 30;
/** Spec 14 R7c: the BRPs a shortfall costs. */
export const OCCUPATION_PENALTY = 15;

/** TODO(verify) V21: naval factors do not count (Ref 18.41: within Russia's original borders, land hexes only). With true they count toward the total (Ops 5.45h), never toward ground. */
export const V21_NAVAL_COUNTS = false;
/** TODO(verify) V21: air factors count toward the total. */
export const V21_AIR_COUNTS = true;
/** TODO(verify) V21: Germany pays the BRP penalty (its BRPs may go negative). */
export const V21_PENALTY_PAYER = "germany" as const;
/** TODO(verify) V21: airborne and replacement counters are ground (as V17 in `soviet-surrender.ts`). */
export const V21_AIRBORNE_IS_GROUND = true;
// TODO(verify) V21: once per turn is not enforced here; the caller applies `applyShortfall` once per check.

export interface OccupationCount {
  ground: number;
  air: number;
  naval: number;
  total: number;
  groundOk: boolean;
  totalOk: boolean;
  met: boolean;
}

export interface OccupationSwitches {
  navalCounts: boolean;
  /** Defaults to `V21_AIR_COUNTS`. */
  airCounts?: boolean;
  /** Defaults to `V21_AIRBORNE_IS_GROUND`; off, only infantry and armor are ground. */
  airborneIsGround?: boolean;
}

/** Same as `occupationCount` with the naval switch given, so a test can flip it. */
export function occupationCountWith(ctx: GameContext, state: GameState, opts: OccupationSwitches): OccupationCount {
  const airCounts = opts.airCounts ?? V21_AIR_COUNTS;
  const isGround = (u: Unit): boolean => ((opts.airborneIsGround ?? V21_AIRBORNE_IS_GROUND) ? isGroundCombatUnit(u) : u.type === "infantry" || u.type === "armor");
  let ground = 0;
  let air = 0;
  let naval = 0;
  // spec 14 R7c: Axis-side units (Italians and active Minor-Allies included) inside Russia's original borders.
  for (const u of Object.values(state.units)) {
    if (sideInWar(state, u.owner) !== "axis" || ctx.map.hexes[u.at]?.country !== RUSSIA_COUNTRY) continue;
    if (isGround(u)) ground += u.strength;
    else if (u.type === "air" && airCounts) air += u.strength;
    else if (u.type === "fleet") naval += u.strength;
  }
  const total = ground + air + (opts.navalCounts ? naval : 0);
  const groundOk = ground >= OCCUPATION_GROUND; // spec 14 R7c
  const totalOk = total >= OCCUPATION_TOTAL; // spec 14 R7c
  return { ground, air, naval, total, groundOk, totalOk, met: groundOk && totalOk };
}

/** Factors of Axis-side units standing inside the map country "ussr" (`sideInWar(...) === "axis"`). Pure. */
export const occupationCount = (ctx: GameContext, state: GameState): OccupationCount => occupationCountWith(ctx, state, { navalCounts: V21_NAVAL_COUNTS });

export interface OccupationShortfall {
  met: boolean;
  missingTotal: number;
  missingGround: number;
  penalty: number;
  redeployOnlyToFix: boolean;
}

/** What is missing and what it costs; `redeployOnlyToFix` is the flag for the caller's rule that the Axis may redeploy only to fix the shortage (spec 14 R7c). */
export function occupationShortfall(ctx: GameContext, state: GameState): OccupationShortfall {
  const c = occupationCount(ctx, state);
  return {
    met: c.met,
    missingTotal: Math.max(0, OCCUPATION_TOTAL - c.total),
    missingGround: Math.max(0, OCCUPATION_GROUND - c.ground),
    penalty: c.met ? 0 : OCCUPATION_PENALTY,
    redeployOnlyToFix: !c.met,
  };
}

/** Axis-held Objective hexes inside Russia that may be handed back, in hex order, excluding any already in `state.soviet?.credited` (spec 14 R7c). */
export function handBackCandidates(ctx: GameContext, state: GameState): HexId[] {
  const credited = new Set(state.soviet?.credited);
  return objectiveHexes(ctx)
    .filter((hex) => {
      if (ctx.map.hexes[hex]?.country !== RUSSIA_COUNTRY || credited.has(hex)) return false;
      const owner = controllerOf(ctx, state, hex);
      return owner !== null && objectiveSide(state, owner) === "axis";
    })
    .sort();
}

/**
 * Applies one turn's penalty (spec 14 R7c, TODO(verify) V21): Germany pays 15 (negative allowed) and `hex` (a candidate) becomes Russian-controlled and is credited
 * to the Allies for good. With candidates left and `hex` null or not a candidate nothing changes (`ok` false); with none left only the BRPs are paid.
 */
export function applyShortfall(ctx: GameContext, state: GameState, hex: HexId | null): { state: GameState; ok: boolean; penalty: number } {
  const candidates = handBackCandidates(ctx, state);
  if (candidates.length > 0 && (hex === null || !candidates.includes(hex))) return { state, ok: false, penalty: 0 };
  const payer = state.nations[V21_PENALTY_PAYER];
  const paid: GameState = { ...state, nations: { ...state.nations, [V21_PENALTY_PAYER]: { ...payer, brpTotal: payer.brpTotal - OCCUPATION_PENALTY } } };
  if (hex === null || candidates.length === 0) return { state: paid, ok: true, penalty: OCCUPATION_PENALTY };
  const soviet = { citiesTaken: {}, ...state.soviet, credited: [...(state.soviet?.credited ?? []), hex].sort() };
  return { state: { ...paid, control: { ...paid.control, [hex]: "ussr" }, soviet }, ok: true, penalty: OCCUPATION_PENALTY };
}
