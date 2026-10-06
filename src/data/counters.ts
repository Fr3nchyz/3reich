import type { ForceEntry, Nation, NationSetup, NationStatus, PowerId, Season } from "../engine/types";

/** Shorthand for a Major Power's starting figures. `total` differs from `brp` when Minor-Allies add BRPs. */
export const nation = (id: PowerId, status: NationStatus, brp: number, growthRate: number, total = brp): Nation => ({
  id,
  status,
  brpBase: brp,
  brpTotal: total,
  growthRate,
});

// Counter stacks as printed on the scenario pages: "3-4 infantry x3" is inf(3, 4, 3).
export const inf = (strength: number, movement: number, count: number): ForceEntry => ({ type: "infantry", strength, movement, count });
export const armor = (strength: number, movement: number, count: number): ForceEntry => ({ type: "armor", strength, movement, count });
export const airborne = (strength: number, movement: number, count: number): ForceEntry => ({ type: "airborne", strength, movement, count });
export const air = (strength: number, movement: number, count: number): ForceEntry => ({ type: "air", strength, movement, count });
export const fleet = (strength: number, count: number): ForceEntry => ({ type: "fleet", strength, count });
export const replacement = (count: number): ForceEntry => ({ type: "replacement", strength: 1, count });

/** Marks a build as available only "in/after" a turn: `from(1942)` for a year, `from(1942, "summer")` for a season. */
export const from = (entry: ForceEntry, year: number, season?: Season): ForceEntry => ({ ...entry, from: season ? { year, season } : { year } });
/** Marks a counter as belonging to another nation (the Italian fleet in the German pool). */
export const ofNation = (entry: ForceEntry, nationality: ForceEntry["nationality"]): ForceEntry => ({ ...entry, nationality });

/** Fills the optional parts of a nation's setup so scenario data only lists what the page prints. */
export const nationSetup = (
  s: Pick<NationSetup, "controlledAtStart" | "forcePool" | "allowableBuilds"> & Partial<NationSetup>,
): NationSetup => ({ controlledZones: [], setup: [], mayAlsoSetUpIn: [], ...s });
