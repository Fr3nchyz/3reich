import type { Nation, PowerId } from "./types";

export const POWER_NAMES: Record<PowerId, string> = {
  germany: "Germany",
  italy: "Italy",
  ussr: "Soviet Union",
  britain: "Great Britain",
  france: "France",
  usa: "United States",
};

/** Ref 10.0: half the BRP total, fractions rounded down, per Player Turn. */
export function spendingLimit(nation: Nation): number {
  return Math.floor(nation.brpTotal / 2);
}
