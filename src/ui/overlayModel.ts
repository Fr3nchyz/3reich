import type { GameContext } from "../engine/context";
import { controlMap, sideInWar } from "../engine/control";
import { otherSide } from "../engine/game";
import type { HexId } from "../engine/hex";
import type { GameState, Side } from "../engine/types";
import { zocHexes } from "../engine/zoc";

/**
 * What the control overlay shows, worked out from the game (pure: no DOM, no drawing; mapOverlay.ts draws it).
 * Control comes from engine/control.ts (Ref 7.0) and Zones of Control from engine/zoc.ts (Ref 6.0); this file
 * only groups them for display, so it decides no rule.
 */

/** A hex's holder as shown: a side, or "neutral" for a nation that has joined neither side (a neutral Major Power, Vichy, an inactive Minor-Ally). */
export type Holder = Side | "neutral";

export interface OverlayCells {
  /** Land hexes held by each holder, in hex-id order. Land nobody holds is in none of them. */
  control: Record<Holder, HexId[]>;
  /** The hexes the side not to move exerts a Zone of Control into, in hex-id order. */
  zoc: HexId[];
  /** The side whose Zones of Control are listed: the one that does not have the move. */
  zocSide: Side;
}

const sideName = (s: Side): string => (s === "axis" ? "Axis" : "Allies");

export function overlayCells(ctx: GameContext, state: GameState): OverlayCells {
  const control: Record<Holder, HexId[]> = { axis: [], allies: [], neutral: [] };
  for (const [hex, owner] of controlMap(ctx, state)) {
    if (ctx.map.hexes[hex]?.land) control[sideInWar(state, owner) ?? "neutral"].push(hex);
  }
  for (const list of Object.values(control)) list.sort();
  const zocSide = otherSide(state.activeSide);
  return { control, zoc: [...zocHexes(ctx, state, zocSide)].sort(), zocSide };
}

/** The key to the overlay in plain words, for the side now to move. */
export function overlayLegend(cells: OverlayCells): string[] {
  const mover = otherSide(cells.zocSide);
  return [
    "Outline: who holds the hex. Dark = Axis, green = Allies, dotted = neither side yet.",
    `Red hatching: ${sideName(cells.zocSide)} Zones of Control. ${sideName(mover)} ground units entering one must stop.`,
  ];
}
