import { airAdvantageDrm, airNationalityDrm } from "./tables";
import type { PowerId } from "./types";

/**
 * Air combat resolver (spec 09 rule R7, Ref 20.44), pure: it takes the dice as arguments and
 * returns who loses how many air factors. It holds no state and rolls nothing; the caller rolls
 * the two dice (and the tie die) from `state.rngState` in that order (spec 09 R15) and applies
 * the result. Used by Counter-Air and by DAS Interception (tickets 09-9 and 09-10).
 *
 * "Attacker" is the side that flies in (the Phasing side); "defender" is the force it fights:
 * the planes based in the Counter-Aired hex, or the committed DAS planes.
 *
 * The two DRM charts (`airAdvantageDrm`, `airNationalityDrm`) are verified against the original
 * game (docs/GAME_DATA.md). Everything the manual leaves open is a field of `AirCombatRules`.
 */

/** A force that takes part: air factors, the nations in it, and the factors of the hex that sit out. */
export interface AirForce {
  /** Participating air factors (those that flew this mission). */
  factors: number;
  /** Nationality of every unit taking part; a mixed force uses the lowest DRM (Ref 20.44). Empty when `factors` is 0. */
  nationalities: readonly (PowerId | "other")[];
  /** Air factors in the attacked hex that did not participate (they can only be lost, R7 step 2). Default 0. */
  nonParticipating?: number;
}

/**
 * Rule switches the manual does not settle. Defaults are the reading of spec 09; each is
 * `TODO(verify)` and listed in spec 09 part J.
 */
export interface AirCombatRules {
  /**
   * TODO(verify) (part J item 4): the air counter sizes. 5, 3 and 1 are certain; 2 is probable.
   * There is no 4-factor counter, so a loss "breaks down" to the next size (R6).
   */
  counterSizes: readonly number[];
  /**
   * TODO(verify) (part J item 4): a unit that loses k factors leaves the largest counter size not
   * above (strength - k), so it may lose more than k (the errata example does). False: exactly k.
   */
  lossMayExceedOwed: boolean;
  /**
   * TODO(verify) (part J item 5): the manual does not say what happens when half the loser's loss
   * (R7 step 3) is more than the winner has participating. False: capped at its participating
   * factors. True: the rest comes out of its non-participating factors, like the loser's.
   */
  winnerLossReachesNonParticipants: boolean;
}

export const AIR_COMBAT_RULES: AirCombatRules = {
  counterSizes: [1, 2, 3, 5],
  lossMayExceedOwed: true,
  winnerLossReachesNonParticipants: false,
};

export interface AirSideResult {
  /** Participating factors, as given. */
  factors: number;
  /** +1 per factor of excess over the other side's participating factors (R7 step 1). */
  advantageDrm: number;
  /** Nationality DRM (lowest of the force); 0 for a force with no participating factors (R7 step 6). */
  nationalityDrm: number;
  /** The die plus both modifiers. */
  modifiedRoll: number;
  /** Factors this side must lose from its participating planes. */
  lossParticipating: number;
  /** Factors this side must lose from its non-participating planes in the hex. */
  lossNonParticipating: number;
  /** Sum of the two. */
  lossTotal: number;
}

export interface AirCombatResult {
  attacker: AirSideResult;
  defender: AirSideResult;
  /** The side with the higher modified roll; null on a tie. */
  winner: "attacker" | "defender" | null;
  tie: boolean;
  /** The third die, when the modified rolls tie; null otherwise. */
  tieRoll: number | null;
  /**
   * R7 step 5 exception: the defender (the Non-Phasing side) had the larger force and won, so its
   * survivors are free (Counter-Air) or may keep flying the DAS (DAS Interception). Everyone else's
   * survivors go home and fly no more this Game Turn.
   */
  defenderSurvivorsFree: boolean;
}

function checkDie(name: string, die: number): void {
  if (!Number.isInteger(die) || die < 1 || die > 6) throw new RangeError(`${name} must be a die roll 1-6, got ${die}`);
}

function checkForce(name: string, force: AirForce): void {
  const extra = force.nonParticipating ?? 0;
  if (!Number.isInteger(force.factors) || force.factors < 0) throw new RangeError(`${name} factors must be a whole number`);
  if (!Number.isInteger(extra) || extra < 0) throw new RangeError(`${name} non-participating factors must be a whole number`);
  if (force.factors > 0 && force.nationalities.length === 0) throw new RangeError(`${name} needs a nationality`);
}

/** Lowest nationality DRM of a force; a force with no participating factors has none (R7 step 6). */
export function forceNationalityDrm(force: AirForce): number {
  if (force.factors === 0 || force.nationalities.length === 0) return 0;
  return Math.min(...force.nationalities.map(airNationalityDrm));
}

/**
 * Does this pair of dice (modified) tie? The caller rolls the third die only then, to keep the
 * stream of random numbers short; passing it anyway is harmless (it is ignored).
 */
export function airRollsTie(attacker: AirForce, defender: AirForce, attackerDie: number, defenderDie: number): boolean {
  return modified(attacker, defender, attackerDie).total === modified(defender, attacker, defenderDie).total;
}

function modified(own: AirForce, other: AirForce, die: number): { advantage: number; nationality: number; total: number } {
  const advantage = airAdvantageDrm(own.factors, other.factors);
  const nationality = forceNationalityDrm(own);
  return { advantage, nationality, total: die + advantage + nationality };
}

/**
 * Resolve one air combat (R7). `tieRoll` is the third die, needed only when the modified rolls
 * tie (see `airRollsTie`); it is ignored otherwise. Throws RangeError on malformed input (a
 * programming error: the action layer checks the player's input before it gets here).
 */
export function resolveAirCombat(
  attacker: AirForce,
  defender: AirForce,
  attackerDie: number,
  defenderDie: number,
  tieRoll?: number,
  rules: AirCombatRules = AIR_COMBAT_RULES,
): AirCombatResult {
  checkForce("attacker", attacker);
  checkForce("defender", defender);
  checkDie("attacker die", attackerDie);
  checkDie("defender die", defenderDie);
  if (attacker.factors === 0 && defender.factors === 0) throw new RangeError("no air factors take part");
  const a = modified(attacker, defender, attackerDie);
  const d = modified(defender, attacker, defenderDie);
  const side = (force: AirForce, m: typeof a): AirSideResult => ({
    factors: force.factors,
    advantageDrm: m.advantage,
    nationalityDrm: m.nationality,
    modifiedRoll: m.total,
    lossParticipating: 0,
    lossNonParticipating: 0,
    lossTotal: 0,
  });
  const out: AirCombatResult = {
    attacker: side(attacker, a),
    defender: side(defender, d),
    winner: a.total === d.total ? null : a.total > d.total ? "attacker" : "defender",
    tie: a.total === d.total,
    tieRoll: null,
    defenderSurvivorsFree: false,
  };
  if (out.tie) {
    // R7 step 4: a third die; each side loses that many, never more than the smaller force has.
    // TODO(verify): "the smaller force" is read as participating factors, so a zero-factor
    // defender (R7 step 6) makes a tie cost nothing.
    if (tieRoll === undefined) throw new RangeError("the modified rolls tie: a third die is needed");
    checkDie("tie die", tieRoll);
    out.tieRoll = tieRoll;
    const each = Math.min(tieRoll, attacker.factors, defender.factors);
    out.attacker.lossParticipating = each;
    out.defender.lossParticipating = each;
  } else {
    const [loser, winner, loserForce, winnerForce] =
      out.winner === "attacker"
        ? ([out.defender, out.attacker, defender, attacker] as const)
        : ([out.attacker, out.defender, attacker, defender] as const);
    // R7 step 2: the loss is the difference of the modified rolls; planes that did not take part
    // go once the participants are gone; any rest is ignored.
    const owed = Math.abs(a.total - d.total);
    loser.lossParticipating = Math.min(owed, loserForce.factors);
    loser.lossNonParticipating = Math.min(owed - loser.lossParticipating, loserForce.nonParticipating ?? 0);
    // R7 step 3: the winner loses half (rounded down) of what the loser actually lost.
    const half = Math.floor((loser.lossParticipating + loser.lossNonParticipating) / 2);
    winner.lossParticipating = Math.min(half, winnerForce.factors);
    if (rules.winnerLossReachesNonParticipants) {
      winner.lossNonParticipating = Math.min(half - winner.lossParticipating, winnerForce.nonParticipating ?? 0);
    }
    // R7 step 5 exception: the Non-Phasing side had the larger force and won.
    out.defenderSurvivorsFree = out.winner === "defender" && defender.factors > attacker.factors;
  }
  for (const s of [out.attacker, out.defender]) s.lossTotal = s.lossParticipating + s.lossNonParticipating;
  return out;
}

/** One air counter: an id and its air factors. */
export interface AirCounter {
  id: string;
  strength: number;
}

/**
 * Break-down (R6, Ref 20.6): removing `owed` factors from one counter leaves the largest counter
 * size not above (strength - owed), so the unit may lose more than `owed`. 0 left when the loss
 * covers it. Example from the errata: a 5 that loses 1 becomes a 3 (loses 2).
 */
export function breakDownAirUnit(
  strength: number,
  owed: number,
  rules: AirCombatRules = AIR_COMBAT_RULES,
): { remaining: number; lost: number } {
  if (owed <= 0) return { remaining: strength, lost: 0 };
  if (owed >= strength) return { remaining: 0, lost: strength };
  const target = strength - owed;
  const sizes = rules.counterSizes.filter((s) => s <= target);
  const remaining = rules.lossMayExceedOwed ? Math.max(0, ...sizes) : target;
  return { remaining, lost: strength - remaining };
}

export interface AirLossTake {
  id: string;
  factors: number;
}

export interface AirLossApplied {
  id: string;
  remaining: number;
  lost: number;
}

/**
 * Apply an owner's choice of air losses (R7: the owner picks, `TODO(verify)`; part J item 5).
 * The choice must name distinct units of the pool and take exactly `owed` factors in all. Returns
 * a reason (naming the rule) or the units' results; the total lost may exceed `owed` (break-down).
 */
export function applyAirLosses(
  pool: readonly AirCounter[],
  take: readonly AirLossTake[],
  owed: number,
  rules: AirCombatRules = AIR_COMBAT_RULES,
): { problem: string } | { applied: AirLossApplied[]; lost: number } {
  const seen = new Set<string>();
  let sum = 0;
  for (const t of take) {
    const unit = pool.find((u) => u.id === t.id);
    if (!unit) return { problem: "That air unit is not among those that can be lost (Ref 20.44)." };
    if (seen.has(t.id)) return { problem: "Each air unit may be named only once (Ref 20.44)." };
    seen.add(t.id);
    if (!Number.isInteger(t.factors) || t.factors < 1 || t.factors > unit.strength) {
      return { problem: "An air unit cannot lose more factors than it has (Ref 20.44)." };
    }
    sum += t.factors;
  }
  if (sum !== owed) return { problem: `Exactly ${owed} air factors must be chosen as the loss (Ref 20.44).` };
  const applied = take.map((t) => ({ id: t.id, ...breakDownAirUnit(pool.find((u) => u.id === t.id)!.strength, t.factors, rules) }));
  return { applied, lost: applied.reduce((n, u) => n + u.lost, 0) };
}

/**
 * The computer's choice of air losses (spec 09 R7 option b): smallest units first, whole units
 * while they fit, at most one unit broken down. A policy, not a rule: `TODO(verify)` with part J
 * item 5. Returns the picks; `owed` larger than the pool takes the whole pool.
 */
export function autoAirLosses(pool: readonly AirCounter[], owed: number): AirLossTake[] {
  const sorted = [...pool].sort((x, y) => x.strength - y.strength || (x.id < y.id ? -1 : 1));
  const take: AirLossTake[] = [];
  let left = owed;
  for (const u of sorted) {
    if (left <= 0) break;
    const factors = Math.min(u.strength, left);
    take.push({ id: u.id, factors });
    left -= factors;
  }
  return take;
}
