import type { ForceOwner, Nation, PowerId } from "./types";

export const POWER_NAMES: Record<PowerId, string> = {
  germany: "Germany",
  italy: "Italy",
  ussr: "Soviet Union",
  britain: "Great Britain",
  france: "France",
  usa: "United States",
};

/** Names for every owner of a force pool, including minor countries. */
export const OWNER_NAMES: Record<ForceOwner, string> = {
  ...POWER_NAMES,
  poland: "Poland",
  "free-france": "Free France",
  "vichy-france": "Vichy France",
  finland: "Finland",
  rumania: "Rumania",
  hungary: "Hungary",
  bulgaria: "Bulgaria",
};

/** A readable name for anyone at war: an owner of forces, or a minor country by its id ("norway" becomes "Norway"). */
export const combatantName = (c: string): string => (c in OWNER_NAMES ? OWNER_NAMES[c as ForceOwner] : c.charAt(0).toUpperCase() + c.slice(1));

/** Ref 10.0: half the BRP total at the Year Start Sequence, fractions rounded down, per Player Turn. */
export function spendingLimit(nation: Nation): number {
  return nation.spendLimit;
}
