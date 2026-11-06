import { AIR_COMBAT_RULES, airRollsTie, resolveAirCombat, type AirCombatResult, type AirForce } from "./air-combat";
import { applyAirLosses, type AirLossTake } from "./air-losses";
import { hasFlown } from "./air-record";
import { flightProblem } from "./air-range";
import type { GameContext } from "./context";
import { sideInWar } from "./control";
import type { HexId } from "./hex";
import { rollD6 } from "./rng";
import type { GameState, PowerId, Unit } from "./types";

/** Ref 20.43; Ops 5.46e: intercept at most four hexes from the base. */
export const INTERCEPTION_RANGE = 4;
/** TODO(verify) AER63: spec 09 R11 reads all but larger-winning DAS survivors as returning home. */
export const DAS_ABORT_UNLESS_LARGER_WINNER = true;
/** TODO(verify) AER64: inherit R6/R7 counter sizes, breakdown, winner cap and strict larger/win readings (Ref 20.6, 20.44). */
export const INTERCEPTION_RULES = AIR_COMBAT_RULES;

/** Caller supplies current commitments and unavailable ids for this Game Turn; no shared ledger wiring. */
export interface InterceptionRecord {
  das: Readonly<Record<HexId, readonly string[]>>;
  unavailable: readonly string[];
}

/** Ref 20.43, 20.3, 20.2; Ops 5.46e: Phasing unused air, any size, within range of committed DAS. */
export function interceptProblem(ctx: GameContext, state: GameState, record: InterceptionRecord, id: string, target: HexId): string | null {
  if (state.phase !== "player-turn" || state.position?.part !== "player-turn" || state.position.step !== "7e") return "Interception requires step 7e.";
  const support = Object.hasOwn(record.das, target) ? record.das[target]! : [];
  if (!ctx.map.hexes[target] || support.length === 0 || support.some((key) => {
    const u = Object.hasOwn(state.units, key) ? state.units[key] : undefined;
    const side = u ? sideInWar(state, u.owner) : null;
    return !u || u.type !== "air" || side === null || side === state.activeSide;
  })) return "The target must have committed enemy DAS.";
  const u = Object.hasOwn(state.units, id) ? state.units[id] : undefined;
  if (!u || u.type !== "air") return "Only an air unit on the map may intercept.";
  if (sideInWar(state, u.owner) !== state.activeSide) return "The interceptor must belong to the Phasing side.";
  if (hasFlown(state, id) || record.unavailable.includes(id)) return "The interceptor has already flown or is unavailable this Game Turn.";
  return flightProblem(ctx, state, u.owner, u.at, target, INTERCEPTION_RANGE);
}

/** Ref 20.43: eligible counters, sorted by id; no factor cap or supply test (Ref 19.3). */
export const interceptors = (ctx: GameContext, state: GameState, record: InterceptionRecord, target: HexId): string[] =>
  Object.keys(state.units).sort().filter((id) => interceptProblem(ctx, state, record, id, target) === null);

export interface InterceptionInput {
  interceptors: readonly Unit[];
  /** Already committed DAS, with each counter's original base in `at` (Ref 20.44). */
  support: readonly Unit[];
  rngState: number;
  /** Ref 20.44: explicit caller choice, used only for a larger winning DAS force. */
  continueDAS: boolean;
}

/** Ref 20.44 / spec 09 R7 open item: caller supplies allocations; no automatic loss policy. */
export type InterceptionLossChooser = (
  side: "interceptors" | "support", pool: readonly Readonly<Unit>[], owed: number,
) => readonly AirLossTake[];

export interface InterceptionPlanes {
  /** Survivors retain their original bases; continuing ids below describe the mission. */
  surviving: Unit[];
  eliminated: string[];
  /** Ref 20.44: surviving planes returning home, unavailable for further missions. */
  aborted: string[];
  lost: number;
}

export interface InterceptionResult {
  interceptors: InterceptionPlanes;
  support: InterceptionPlanes;
  /** Ref 20.44: only larger winning DAS survivors may continue, and only if chosen. */
  continuing: string[];
  /** Ref 20.3: every participant has flown, including DAS which continues. */
  flown: string[];
  combat: AirCombatResult;
  rolls: [number, number];
  rngState: number;
}

function force(planes: readonly Unit[]): AirForce {
  // Ref 20.44: participating factors and lowest nationality DRM, including lent nationality.
  const majors: readonly string[] = ["germany", "italy", "ussr", "britain", "france", "usa"];
  return { factors: planes.reduce((sum, u) => sum + u.strength, 0), nationalities: planes.map((u) => {
    const nation = u.nationality ?? u.owner;
    return majors.includes(nation) ? nation as PowerId : "other";
  }) };
}

function lose(pool: readonly Unit[], owed: number, side: "interceptors" | "support", choose: InterceptionLossChooser): InterceptionPlanes {
  // Ref 20.6, 20.44: validate allocation, then apply actual counter breakdown.
  const take = owed === 0 ? [] : choose(side, pool.map((u) => ({ ...u })), owed);
  const result = applyAirLosses(pool, take, owed, INTERCEPTION_RULES);
  if ("problem" in result) throw new RangeError(result.problem);
  const surviving: Unit[] = [];
  const eliminated: string[] = [];
  for (const u of pool) {
    const strength = result.applied.find((a) => a.id === u.id)?.remaining ?? u.strength;
    if (strength > 0) surviving.push({ ...u, strength });
    else eliminated.push(u.id);
  }
  return { surviving, eliminated, aborted: surviving.map((u) => u.id), lost: result.lost };
}

/**
 * One already-designated exchange (Ref 20.43, 20.44). Caller checks eligibility and supplies
 * committed DAS only: based non-participants are not part of this airborne exchange.
 * No state, action, mission ledger or return-base placement is changed. Malformed inputs throw.
 */
export function resolveInterception(input: InterceptionInput, choose: InterceptionLossChooser): InterceptionResult {
  const all = [...input.interceptors, ...input.support];
  if (input.interceptors.length === 0 || input.support.length === 0) throw new RangeError("Interception needs both forces.");
  if (new Set(all.map((u) => u.id)).size !== all.length || all.some((u) =>
    u.type !== "air" || !Number.isInteger(u.strength) || u.strength <= 0)) {
    throw new RangeError("Interception needs distinct positive-strength air units.");
  }
  const a = force(input.interceptors), d = force(input.support);
  // Spec 09 R15 / Ref 20.44: interceptor die, DAS die, third die only for modified ties.
  const first = rollD6(input.rngState), second = rollD6(first.state);
  const third = airRollsTie(a, d, first.roll, second.roll, INTERCEPTION_RULES) ? rollD6(second.state) : null;
  const combat = resolveAirCombat(a, d, first.roll, second.roll, third?.roll, INTERCEPTION_RULES);
  const apply = (side: "attacker" | "defender") => lose(
    side === "attacker" ? input.interceptors : input.support, combat[side].lossParticipating,
    side === "attacker" ? "interceptors" : "support", choose,
  );
  let attacker: InterceptionPlanes, defender: InterceptionPlanes;
  if (combat.winner === null) {
    attacker = apply("attacker");
    defender = apply("defender");
  } else {
    const winner = combat.winner, loser = winner === "attacker" ? "defender" : "attacker";
    const lost = apply(loser);
    // Ref 20.44, 20.6: winner owes half the ACTUAL loser loss, after breakdown, capped at participants.
    const won = combat[winner];
    won.lossParticipating = Math.min(Math.floor(lost.lost / 2), won.factors);
    won.lossTotal = won.lossParticipating;
    const kept = apply(winner);
    attacker = winner === "attacker" ? kept : lost;
    defender = winner === "defender" ? kept : lost;
  }
  // Ref 20.44 exception; spec 09 R11 provisional reading (AER63).
  const mayContinue = !DAS_ABORT_UNLESS_LARGER_WINNER || combat.defenderSurvivorsFree;
  const continuing = mayContinue && input.continueDAS ? defender.surviving.map((u) => u.id) : [];
  defender.aborted = defender.aborted.filter((id) => !continuing.includes(id));
  return { interceptors: attacker, support: defender, continuing, flown: all.map((u) => u.id),
    combat, rolls: [first.roll, second.roll], rngState: third?.state ?? second.state };
}
