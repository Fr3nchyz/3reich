import { MINOR_COUNTRY_FORCES, type MinorForces } from "./tables";
import type { ForceEntry, MinorCountry } from "./types";

/**
 * Forces of a minor country (Ref 14.0, spec 02): what the Minor Country Forces chart gives it when it
 * is attacked or activated, as counters in the same shape the scenario pages use for a force pool.
 * The chart's columns are counter pictures (tables.ts), so each column is one kind of counter.
 *
 * Not built (TODO(verify), spec 02): setting the counters up at step 2 of the Player Turn. The text
 * we have does not say who places them, where they may stand, or how stacking applies to the defender,
 * and a counter's owner cannot be a minor country that has no force pool in this game (`ForceOwner`).
 * Minor-Ally activation (Ref 17.0) and the PC rule that a declaration of war on a minor must be
 * followed that turn by a move into it or an attack on it (README rule 21.4; it needs movement and
 * combat) wait for the same reasons.
 */

type Column = { key: keyof MinorForces; entry: Omit<ForceEntry, "count"> };

/** The chart's columns, in order, as the counters they are headed by. */
const COLUMNS: readonly Column[] = [
  { key: "inf1_3", entry: { type: "infantry", strength: 1, movement: 3 } },
  { key: "inf2_3", entry: { type: "infantry", strength: 2, movement: 3 } },
  { key: "arm2_5", entry: { type: "armor", strength: 2, movement: 5 } },
  { key: "air1_4", entry: { type: "air", strength: 1, movement: 4 } },
  { key: "air2_4", entry: { type: "air", strength: 2, movement: 4 } },
  { key: "fleet2", entry: { type: "fleet", strength: 2 } },
];

/** The counters a minor country gets when attacked or activated; empty for one the chart gives nothing (Arabia, Ireland, Luxembourg, Persia, Portugal). */
export function minorForceEntries(minor: MinorCountry): ForceEntry[] {
  const forces = MINOR_COUNTRY_FORCES[minor];
  return COLUMNS.filter((c) => forces[c.key] > 0).map((c) => ({ ...c.entry, count: forces[c.key] }));
}
