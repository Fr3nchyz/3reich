import { AIR_COMBAT_RULES, airRollsTie, resolveAirCombat, type AirCombatResult, type AirForce } from "./air-combat";
import { applyAirLosses, type AirLossTake } from "./air-losses";
import type { HexId } from "./hex";
import { rollD6 } from "./rng";
import type { PowerId, Unit } from "./types";

/** TODO(verify) AER58: inherited counter sizes, over-loss, winner cap and survivor/tie readings.
 * Spec 09 R6/R7 (Ref 20.6, 20.44); docs/RULES.md lists each existing open reading. */
export const COUNTER_AIR_RULES = AIR_COMBAT_RULES;

export interface CounterAirInput {
  target: HexId;
  attacker: readonly Unit[];
  defender: readonly Unit[];
  /** Already-flown planes in the attacked hex: no participation, but may suffer spillover. Ref 20.44. */
  nonParticipating?: readonly Unit[];
  rngState: number;
}

/** Loss ownership is left to the caller (spec 09 R7, open question); no automatic policy here. */
export type CounterAirLossChooser = (
  side: "attacker" | "defender",
  pool: readonly Readonly<Unit>[],
  owed: number,
  participating: boolean,
) => readonly AirLossTake[];

export interface CounterAirPlanes {
  surviving: Unit[];
  eliminated: string[];
  /** Surviving planes unavailable for further missions this Game Turn (Ref 20.3, 20.44). */
  aborted: string[];
  lost: number;
}

/** Local event only: no shared event/action registration. Spec 09 C3 (Ref 20.44). */
export interface CounterAirEvent {
  type: "AIR_COMBAT_RESOLVED";
  kind: "counter-air";
  hex: HexId;
  rolls: [number, number];
  combat: AirCombatResult;
  /** Actual counter losses, including breakdown (Ref 20.6). */
  lost: { attacker: number; defender: number };
}

export interface CounterAirResult {
  attacker: CounterAirPlanes;
  defender: CounterAirPlanes;
  rngState: number;
  events: CounterAirEvent[];
}

function force(planes: readonly Unit[], extras: readonly Unit[] = []): AirForce {
  // Ref 20.44: factors and nationality modifiers count participating planes only.
  const majors: readonly string[] = ["germany", "italy", "ussr", "britain", "france", "usa"];
  return {
    factors: planes.reduce((sum, u) => sum + u.strength, 0),
    nationalities: planes.map((u) => {
      const nation = u.nationality ?? u.owner;
      return majors.includes(nation) ? nation as PowerId : "other";
    }),
    nonParticipating: extras.reduce((sum, u) => sum + u.strength, 0),
  };
}

function lose(
  pool: readonly Unit[], owed: number, side: "attacker" | "defender",
  participating: boolean, choose: CounterAirLossChooser,
): CounterAirPlanes {
  // Ref 20.6, 20.44: validate the supplied factor allocation and break counters down.
  const take = owed === 0 ? [] : choose(side, pool.map((u) => ({ ...u })), owed, participating);
  const result = applyAirLosses(pool, take, owed, COUNTER_AIR_RULES);
  if ("problem" in result) throw new RangeError(result.problem);
  const surviving: Unit[] = [];
  const eliminated: string[] = [];
  for (const u of pool) {
    const strength = result.applied.find((a) => a.id === u.id)?.remaining ?? u.strength;
    if (strength > 0) surviving.push({ ...u, strength });
    else eliminated.push(u.id);
  }
  return { surviving, eliminated, aborted: [], lost: result.lost };
}

/**
 * One already-designated counter-air exchange (Ref 20.42, 20.44; spec 09 R12).
 * Caller supplies eligibility, range/Option checks, and all based defenders split by whether
 * they have flown. Malta decline and mission/state wiring belong to later tickets.
 * Ref 20.3/20.44: `aborted` describes mission availability, not an additional combat result.
 * Malformed internal inputs/allocations throw; inputs are never changed.
 */
export function resolveCounterAir(input: CounterAirInput, choose: CounterAirLossChooser): CounterAirResult {
  const extra = input.nonParticipating ?? [];
  const all = [...input.attacker, ...input.defender, ...extra];
  if (input.attacker.length === 0 || input.defender.length + extra.length === 0) {
    throw new RangeError("Counter-air needs attackers and based defenders.");
  }
  if (new Set(all.map((u) => u.id)).size !== all.length || all.some((u) =>
    u.type !== "air" || !Number.isInteger(u.strength) || u.strength <= 0)) {
    throw new RangeError("Counter-air needs distinct positive-strength air units.");
  }
  if ([...input.defender, ...extra].some((u) => u.at !== input.target)) {
    throw new RangeError("Counter-air defenders must be in the attacked hex.");
  }
  const a = force(input.attacker);
  const d = force(input.defender, extra);
  // Spec 09 R15 / Ref 20.44: attacker die, defender die, then a third die only on a tie.
  const first = rollD6(input.rngState);
  const second = rollD6(first.state);
  const third = airRollsTie(a, d, first.roll, second.roll, COUNTER_AIR_RULES) ? rollD6(second.state) : null;
  const combat = resolveAirCombat(a, d, first.roll, second.roll, third?.roll, COUNTER_AIR_RULES);
  const apply = (side: "attacker" | "defender"): CounterAirPlanes => {
    const result = lose(input[side], combat[side].lossParticipating, side, true, choose);
    const rest = lose(side === "defender" ? extra : [], combat[side].lossNonParticipating, side, false, choose);
    return {
      surviving: [...result.surviving, ...rest.surviving],
      eliminated: [...result.eliminated, ...rest.eliminated],
      // Ref 20.3, 20.44: only participating survivors of a larger winning defender remain free.
      aborted: [...(side === "defender" && combat.defenderSurvivorsFree ? [] : result.surviving.map((u) => u.id)),
        ...rest.surviving.map((u) => u.id)],
      lost: result.lost + rest.lost,
    };
  };
  let attacker: CounterAirPlanes;
  let defender: CounterAirPlanes;
  if (combat.winner === null) {
    attacker = apply("attacker");
    defender = apply("defender");
  } else {
    const winner = combat.winner;
    const loser = winner === "attacker" ? "defender" : "attacker";
    const lost = apply(loser);
    // Ref 20.44: half of the loser's ACTUAL loss, including counter breakdown (Ref 20.6).
    const half = Math.floor(lost.lost / 2);
    const won = combat[winner];
    won.lossParticipating = Math.min(half, won.factors);
    won.lossNonParticipating = COUNTER_AIR_RULES.winnerLossReachesNonParticipants
      ? Math.min(half - won.lossParticipating, winner === "defender" ? d.nonParticipating ?? 0 : 0) : 0;
    won.lossTotal = won.lossParticipating + won.lossNonParticipating;
    const kept = apply(winner);
    attacker = winner === "attacker" ? kept : lost;
    defender = winner === "defender" ? kept : lost;
  }
  return {
    attacker, defender, rngState: third?.state ?? second.state,
    events: [{ type: "AIR_COMBAT_RESOLVED", kind: "counter-air", hex: input.target,
      rolls: [first.roll, second.roll], combat, lost: { attacker: attacker.lost, defender: defender.lost } }],
  };
}
