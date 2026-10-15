import { hex } from "../engine/hex";
import type { MapData } from "../engine/map";
import type { AttackMarksInput } from "./attackMarks";
import { attackMarkCells } from "./attackMarks";
import { fmt, hexCenter, hexCorners, points, type Point } from "./mapGeometry";

/**
 * The SVG text of the attack marks (spec 07, 07-5), drawn in <g class="attack-marks"> above the yellow highlights
 * and below the counters. Stroke widths and dashes are set in style.css with a non-scaling stroke, so they are
 * screen pixels at any zoom. Each shape is a hex shrunk toward its centre, so neighbours' marks never touch.
 */

/** How much of the hex each mark covers (the control overlay uses 0.8, the yellow highlights use 1). */
export const TARGET_INSET = 0.9;
export const ATTACKER_INSET = 0.86;
export const CHOSEN_INSET = 0.8;
/** The hex a move is chosen from (spec 10, 10-5): a thick dark outline, a little wider than the yellow hexes' inset marks. */
export const FROM_INSET = 0.92;
/** The attacker's small mark: a diamond this far below the hex centre, this big, so the gold ring has a second cue that is not its colour. */
const PIP_DROP = 7.7;
const PIP_SIZE = 1.9;

function inset(id: string, share: number): string {
  const [cx, cy] = hexCenter(hex(id));
  return points(hexCorners(cx, cy).map(([x, y]) => [cx + (x - cx) * share, cy + (y - cy) * share] as Point));
}

function pip(id: string): string {
  const [cx, cy] = hexCenter(hex(id));
  const y = cy + PIP_DROP;
  return `<path class="pip" d="M${fmt(cx)},${fmt(y - PIP_SIZE)} L${fmt(cx + PIP_SIZE)},${fmt(y)} L${fmt(cx)},${fmt(y + PIP_SIZE)} L${fmt(cx - PIP_SIZE)},${fmt(y)} Z"/>`;
}

/** The markup inside <g class="attack-marks">; empty for no marks. Dashed targets first, then attackers, then the chosen target on top. */
export function attackMarksMarkup(map: MapData, input: AttackMarksInput | null | undefined): string {
  const cells = attackMarkCells(map, input);
  let out = "";
  for (const id of cells.targets) out += `<polygon class="mk-target" data-mk-target="${id}" points="${inset(id, TARGET_INSET)}"/>`;
  for (const id of cells.attackers) {
    const pts = inset(id, ATTACKER_INSET);
    out += `<polygon class="mk-case dark" points="${pts}"/><polygon class="mk-attacker" data-mk-attacker="${id}" points="${pts}"/>${pip(id)}`;
  }
  if (cells.chosen) {
    const pts = inset(cells.chosen, CHOSEN_INSET);
    out += `<polygon class="mk-case" points="${pts}"/><polygon class="mk-chosen" data-mk-chosen="${cells.chosen}" points="${pts}"/>`;
  }
  if (cells.from) {
    const pts = inset(cells.from, FROM_INSET);
    out += `<polygon class="mk-case" points="${pts}"/><polygon class="mk-from" data-mk-from="${cells.from}" points="${pts}"/>`;
  }
  return out;
}
