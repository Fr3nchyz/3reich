import { FLEET_COUNTER_SIZES } from "./naval-record";

/** TODO(verify) (N25, spec 12 R12.5): the owner chooses losses; allocation is not implemented here. */
export const NAVAL_LOSS_CHOICE = "owner";

/**
 * Spec 12 R1/R12.6 (Ref 21.51, 21.7): keep the largest representable remainder, using the fewest
 * partial counters. Sizes default to FLEET_COUNTER_SIZES (TODO(verify) N1); a different list may be
 * passed to check another counter sheet. Counters are returned largest first; sizes need not be sorted.
 * Throws RangeError unless strength/owed are nonnegative integers and sizes are positive integers.
 */
export function breakDownFleet(
  strength: number,
  owed: number,
  counterSizes: readonly number[] = FLEET_COUNTER_SIZES,
): { counters: number[]; lost: number } {
  if (!Number.isInteger(strength) || strength < 0) throw new RangeError("strength must be a nonnegative whole number");
  if (!Number.isInteger(owed) || owed < 0) throw new RangeError("owed must be a nonnegative whole number");
  if (counterSizes.some((size) => !Number.isInteger(size) || size <= 0)) throw new RangeError("counter sizes must be positive whole numbers");
  const target = Math.max(0, strength - owed);
  const sizes = [...new Set(counterSizes)].filter((size) => size <= target).sort((a, b) => b - a);
  // Spec 12 R1: dynamic programming finds the minimum counter count, including non-greedy size lists.
  const counts: number[] = Array<number>(target + 1).fill(Infinity);
  const last: number[] = Array<number>(target + 1).fill(0);
  counts[0] = 0;
  for (let total = 1; total <= target; total++) {
    for (const size of sizes) {
      if (size <= total && counts[total - size]! + 1 < counts[total]!) {
        counts[total] = counts[total - size]! + 1;
        last[total] = size;
      }
    }
  }
  // Spec 12 R1/R12.6 (N2): if an exact remainder is impossible, extra factors must be lost.
  let remaining = target;
  while (counts[remaining] === Infinity) remaining--;
  const counters: number[] = [];
  for (let total = remaining; total > 0; total -= last[total]!) counters.push(last[total]!);
  counters.sort((a, b) => b - a);
  return { counters, lost: strength - remaining };
}
