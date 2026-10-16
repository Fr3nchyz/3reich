import { hex } from "../engine/hex";
import type { MapData } from "../engine/map";
import type { Unit } from "../engine/types";
import { COUNTER_ABOVE, COUNTER_LEFT, COUNTER_SIZE, STACK_SHOWN, STACK_STEP, stacksOnMap } from "./mapCounters";
import { fmt, hexCenter } from "./mapGeometry";
import type { UnitMarks } from "./moveMarks";

/**
 * The marks of the Move card on the counters of the chosen hex (spec 10, ticket 10-5), drawn in their own group above the whole counters layer.
 * Counters of a stack overlap (each is only STACK_STEP up and right of the one below), so a mark drawn on a counter would be hidden under the next one.
 * Instead each marked counter gets a badge in a row just below the stack: one slot per drawn counter, left to right in stack order (the lowest counter
 * is the leftmost, as it is on the map), joined to its counter's bottom edge by a thin line. No badge touches a counter, so none covers a number or a
 * symbol, and every counter of a deep stack has its own readable one. Shapes differ so colour is never the only cue: a ticked counter gets a round
 * gold ring with a tick, a left-behind one (free to move, not ticked) a flat pale dash. Pure geometry here (no DOM), the SVG text below.
 */

/** Radius of a badge, in map units (a counter is 12.4); strokes are in map units too, so they grow and shrink with the counters. */
export const BADGE_R = 2.6;
/** Distance between the centres of neighbouring slots, a little more than a badge is wide. */
export const SLOT = 5.8;
/** The gap between the lowest counter's bottom edge (and its shadow) and the top of a badge. */
const GAP = 0.9;

export interface Badge {
  /** The unit id (for the tests; never shown). */
  id: string;
  kind: "ticked" | "left";
  /** Centre of the badge. */
  x: number;
  y: number;
  /** Where the line from the badge meets the counter: the middle of its bottom edge. */
  lx: number;
  ly: number;
}

/** The badges of the marked counters among `shown` (the counters drawn for one hex, bottom first), around the hex centre (cx, cy). */
export function badgesFor(shown: readonly Pick<Unit, "id">[], cx: number, cy: number, marks: UnitMarks): Badge[] {
  const out: Badge[] = [];
  const bottom = cy - COUNTER_ABOVE + COUNTER_SIZE;
  shown.forEach((u, i) => {
    const kind = marks.ticked.has(u.id) ? "ticked" : marks.left.has(u.id) ? "left" : null;
    if (!kind) return;
    out.push({
      id: u.id,
      kind,
      x: cx + (i - (shown.length - 1) / 2) * SLOT,
      y: bottom + GAP + BADGE_R,
      lx: cx - COUNTER_LEFT + i * STACK_STEP + COUNTER_SIZE / 2,
      ly: bottom - i * STACK_STEP,
    });
  });
  return out;
}

/** The counters of a hex that are drawn, bottom first (the same slice `unitsMarkup` draws). */
export const shownOf = (stack: readonly Unit[]): Unit[] => stack.slice(-STACK_SHOWN);

function badgeMarkup(b: Badge): string {
  const [x, y] = [fmt(b.x), fmt(b.y)];
  const lead = `<line class="bd-lead" x1="${fmt(b.lx)}" y1="${fmt(b.ly)}" x2="${x}" y2="${fmt(b.y - BADGE_R)}"/>`;
  if (b.kind === "ticked") {
    const tick = `M${fmt(b.x - 1.2)},${fmt(b.y + 0.1)} L${fmt(b.x - 0.3)},${fmt(b.y + 1)} L${fmt(b.x + 1.3)},${fmt(b.y - 1)}`;
    return `<g data-mark="ticked" data-unit="${b.id}">${lead}<circle class="bd-case" cx="${x}" cy="${y}" r="${BADGE_R}"/><circle class="bd-ring" cx="${x}" cy="${y}" r="${fmt(BADGE_R - 0.75)}"/><path class="bd-tick" d="${tick}"/></g>`;
  }
  const pill = `x="${fmt(b.x - BADGE_R)}" y="${fmt(b.y - 1.1)}" width="${fmt(2 * BADGE_R)}" height="2.2" rx="1.1"`;
  return `<g data-mark="left" data-unit="${b.id}">${lead}<rect class="bd-case" ${pill}/><rect class="bd-dash" x="${fmt(b.x - BADGE_R + 0.5)}" y="${fmt(b.y - 0.6)}" width="${fmt(2 * BADGE_R - 1)}" height="1.2" rx=".6"/></g>`;
}

/** The markup inside <g class="unit-marks">: the badges of the hexes holding a marked counter; empty for no marks. */
export function unitMarksMarkup(map: MapData, units: readonly Unit[], marks: UnitMarks): string {
  if (marks.ticked.size === 0 && marks.left.size === 0) return "";
  let out = "";
  for (const [at, stack] of stacksOnMap(map, units)) {
    const [cx, cy] = hexCenter(hex(at));
    for (const b of badgesFor(shownOf(stack), cx, cy, marks)) out += badgeMarkup(b);
  }
  return out;
}
