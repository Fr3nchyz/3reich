import { nextRandom } from "../engine/rng";

/**
 * A repeatable number in [0, 1) for a seed and a key: no state, so a choice depends only on
 * the position, the seed and what is being chosen (never on how many choices came before).
 */
export function jitter(seed: number, key: string): number {
  let h = (seed ^ 0x811c9dc5) >>> 0;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 0x01000193) >>> 0;
  return nextRandom(h).value;
}

/** The item with the highest score; ties go to the lowest jitter, then to the first. Undefined for an empty list. */
export function best<T>(items: readonly T[], score: (t: T) => number, seed: number, key: (t: T) => string): T | undefined {
  let top: T | undefined;
  let topScore = -Infinity;
  let topJitter = Infinity;
  for (const t of items) {
    const s = score(t);
    const j = jitter(seed, key(t));
    if (s > topScore || (s === topScore && j < topJitter)) {
      top = t;
      topScore = s;
      topJitter = j;
    }
  }
  return top;
}
