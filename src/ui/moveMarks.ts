import type { AttackMarksInput } from "./attackMarks";
import type { MoveLine } from "./moveSelection";

/**
 * What the map shows of the Move card (spec 10, ticket 10-5): pure data in, plain sets out; no DOM and no SVG here.
 * The hex the units move from gets a thick outline (in the attack-marks layer of spec 07, `from`); a ticked counter gets a gold ring and a
 * left-behind one (free to move, not ticked) a pale veil with a bar, drawn on the counters themselves (mapCounters.ts) so a ring sits over
 * the cardboard. A counter that cannot move (air, fleet, already moved) is not marked. Nothing here is a rule or changes the game.
 */

export interface UnitMarks {
  /** Ids of the units ticked to move. */
  ticked: ReadonlySet<string>;
  /** Ids of the units that could move but are not ticked: they stay and can still move later. */
  left: ReadonlySet<string>;
}

export const NO_UNIT_MARKS: UnitMarks = { ticked: new Set(), left: new Set() };

export interface MoveMarks {
  /** The chosen hex, or null. */
  from: string | null;
  units: UnitMarks;
}

export const NO_MOVE_MARKS: MoveMarks = { from: null, units: NO_UNIT_MARKS };

/** The marks of a selection (its hex and unit lines), or none when nothing is chosen. */
export function moveMarksOf(sel: { hex: string; lines: readonly Pick<MoveLine, "key" | "state">[] } | null | undefined): MoveMarks {
  if (!sel) return NO_MOVE_MARKS;
  const ids = (state: MoveLine["state"]) => new Set(sel.lines.filter((l) => l.state === state).map((l) => l.key));
  return { from: sel.hex, units: { ticked: ids("ticked"), left: ids("free") } };
}

/** The input of the marks layer for a choice: the outline of the chosen hex only. */
export const fromMarks = (m: MoveMarks): AttackMarksInput => ({ from: m.from });
