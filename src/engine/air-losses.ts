import { AIR_COMBAT_RULES, type AirCombatRules } from "./air-combat";

/**
 * Air losses (spec 09 rules R6 and R7, Ref 20.6, 20.44), pure: how a loss of k air factors comes
 * out of counters. The sizes and the "may lose more than owed" switch are `AirCombatRules`
 * (`TODO(verify)`, docs/RULES.md).
 */

/** One air counter: an id and its air factors. */
export interface AirCounter {
  id: string;
  strength: number;
}

/**
 * Break-down (R6, Ref 20.6): removing `owed` factors from one counter leaves the largest counter
 * size not above (strength - owed), so the unit may lose more than `owed`. 0 left when the loss
 * covers it. Example from the errata: a 5 that loses 1 becomes a 3 (loses 2). Throws RangeError
 * unless both numbers are whole.
 *
 * With `rules.lossMayExceedOwed` off (a switch nobody has turned on) the unit simply keeps
 * strength - owed, whatever that is, even a size no counter has (5 - 1 = 4): the manual's
 * break-down is what the switch turns off, so no sizes are consulted.
 */
export function breakDownAirUnit(
  strength: number,
  owed: number,
  rules: AirCombatRules = AIR_COMBAT_RULES,
): { remaining: number; lost: number } {
  if (!Number.isInteger(strength) || strength < 0) throw new RangeError(`strength must be a whole number, got ${strength}`);
  if (!Number.isInteger(owed)) throw new RangeError(`owed must be a whole number, got ${owed}`);
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
 * Apply an owner's choice of air losses (R7: the owner picks, `TODO(verify)`).
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

interface Plan {
  /** Factors lost beyond those owed, summed over the units (break-down). */
  over: number;
  /** Units reduced but not eliminated. */
  broken: number;
  takes: number[];
}

/**
 * The computer's choice of air losses (spec 09 R7 option b, "fewest units broken, smallest first").
 * A policy, not a rule: `TODO(verify)` (docs/RULES.md). In order of importance: lose no more than
 * `owed` when some choice allows it (whole counters, or a counter whose break-down lands exactly);
 * break as few counters as possible (0 when whole counters add up to `owed`); then prefer the
 * smaller counters, in order of size then id. `owed` above the pool takes the whole pool.
 */
export function autoAirLosses(pool: readonly AirCounter[], owed: number, rules: AirCombatRules = AIR_COMBAT_RULES): AirLossTake[] {
  const units = [...pool].sort((x, y) => x.strength - y.strength || (x.id < y.id ? -1 : 1));
  const total = units.reduce((n, u) => n + u.strength, 0);
  const want = Math.min(Math.max(0, owed), total);
  const memo = new Map<string, Plan | null>();
  // Best way for units i.. to take exactly `left` factors; larger takes are tried first, and only a
  // strictly better plan replaces one, so the smaller counters go first among equals.
  const best = (i: number, left: number): Plan | null => {
    if (i === units.length) return left === 0 ? { over: 0, broken: 0, takes: [] } : null;
    const key = `${i}:${left}`;
    if (memo.has(key)) return memo.get(key) ?? null;
    const s = units[i]!.strength;
    let found: Plan | null = null;
    for (let t = Math.min(s, left); t >= 0; t--) {
      const rest = best(i + 1, left - t);
      if (!rest) continue;
      const partial = t > 0 && t < s;
      const cost = partial ? breakDownAirUnit(s, t, rules).lost - t : 0;
      const plan = { over: rest.over + cost, broken: rest.broken + (partial ? 1 : 0), takes: [t, ...rest.takes] };
      if (!found || plan.over < found.over || (plan.over === found.over && plan.broken < found.broken)) found = plan;
    }
    memo.set(key, found);
    return found;
  };
  const plan = best(0, want);
  if (!plan) return [];
  return units.flatMap((u, i) => (plan.takes[i]! > 0 ? [{ id: u.id, factors: plan.takes[i]! }] : []));
}
