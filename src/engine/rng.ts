/** Small deterministic PRNG (mulberry32) so games are reproducible and saveable. */
export function nextRandom(state: number): { value: number; state: number } {
  let t = (state + 0x6d2b79f5) >>> 0;
  const next = t;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return { value: ((t ^ (t >>> 14)) >>> 0) / 4294967296, state: next };
}

/** Roll one six-sided die. Returns the roll and the advanced RNG state. */
export function rollD6(state: number): { roll: number; state: number } {
  const r = nextRandom(state);
  return { roll: Math.floor(r.value * 6) + 1, state: r.state };
}
