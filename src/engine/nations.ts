import type { Nation, NationStatus, PowerId, Side } from "./types";

export const POWER_NAMES: Record<PowerId, string> = {
  germany: "Germany",
  italy: "Italy",
  ussr: "Soviet Union",
  britain: "Great Britain",
  france: "France",
  usa: "United States",
};

/**
 * Starting economy for the Fall 1939 scenario, read from the PC game's national
 * status screen. TODO: confirm against the manual and the other scenarios.
 */
export function fall1939Nations(): Record<PowerId, Nation> {
  const n = (id: PowerId, status: NationStatus, brp: number, growthRate: number): Nation => ({
    id,
    status,
    brpBase: brp,
    brpTotal: brp,
    growthRate,
  });
  return {
    france: n("france", "allied", 85, 30),
    britain: n("britain", "allied", 125, 40),
    usa: n("usa", "neutral", 270, 60),
    ussr: n("ussr", "neutral", 90, 30),
    germany: n("germany", "axis", 150, 50),
    italy: n("italy", "axis", 75, 20),
  };
}

/** The status screen shows a spending limit of half the BRP total, rounded down. */
export function spendingLimit(nation: Nation): number {
  return Math.floor(nation.brpTotal / 2);
}

/** Total BRPs of the powers currently on a side (neutrals count for neither). */
export function sideBRPs(nations: Record<PowerId, Nation>, side: Side): number {
  const wanted: NationStatus = side === "axis" ? "axis" : "allied";
  return Object.values(nations)
    .filter((nation) => nation.status === wanted)
    .reduce((sum, nation) => sum + nation.brpTotal, 0);
}
