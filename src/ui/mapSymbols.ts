import type { UnitType } from "../engine/types";
import { fmt } from "./mapGeometry";

/** The unit symbol drawn on a counter, in the style of the printed pieces: our own drawing, no scanned art. */

/** Draws `type` centred on (x, y) inside a box about `s` wide, in the colour `ink`. */
export function unitSymbol(type: UnitType, x: number, y: number, s: number, ink: string): string {
  const w = s * 0.62;
  const h = s * 0.34;
  const line = fmt(s * 0.07);
  const box = `<rect x="${fmt(x - w / 2)}" y="${fmt(y - h / 2)}" width="${fmt(w)}" height="${fmt(h)}" fill="none" stroke="${ink}" stroke-width="${line}"/>`;
  const cross = `<path d="M${fmt(x - w / 2)} ${fmt(y - h / 2)}L${fmt(x + w / 2)} ${fmt(y + h / 2)}M${fmt(x + w / 2)} ${fmt(y - h / 2)}L${fmt(x - w / 2)} ${fmt(y + h / 2)}" stroke="${ink}" stroke-width="${line}"/>`;
  const plane = `<path d="M${fmt(x)} ${fmt(y - h * 0.8)}L${fmt(x + w * 0.5)} ${fmt(y + h * 0.5)}L${fmt(x)} ${fmt(y + h * 0.15)}L${fmt(x - w * 0.5)} ${fmt(y + h * 0.5)}Z" fill="${ink}"/>`;
  switch (type) {
    case "infantry":
      return box + cross;
    case "armor":
      return box + `<ellipse cx="${fmt(x)}" cy="${fmt(y)}" rx="${fmt(w * 0.32)}" ry="${fmt(h * 0.3)}" fill="none" stroke="${ink}" stroke-width="${line}"/>`;
    case "airborne":
      // An infantry box under a parachute canopy.
      return box + cross + `<path d="M${fmt(x - w * 0.4)} ${fmt(y - h * 0.5)}A${fmt(w * 0.4)} ${fmt(h * 0.5)} 0 0 1 ${fmt(x + w * 0.4)} ${fmt(y - h * 0.5)}" fill="none" stroke="${ink}" stroke-width="${line}"/>`;
    case "replacement":
      return box + `<path d="M${fmt(x - w * 0.2)} ${fmt(y)}L${fmt(x + w * 0.2)} ${fmt(y)}M${fmt(x)} ${fmt(y - h * 0.3)}L${fmt(x)} ${fmt(y + h * 0.3)}" stroke="${ink}" stroke-width="${line}"/>`;
    case "air":
      return plane;
    case "airbase":
      return `<circle cx="${fmt(x)}" cy="${fmt(y)}" r="${fmt(h * 0.9)}" fill="none" stroke="${ink}" stroke-width="${line}"/>` + plane;
    case "bridgehead":
      return `<rect x="${fmt(x - w / 2)}" y="${fmt(y - h / 2)}" width="${fmt(w)}" height="${fmt(h)}" fill="none" stroke="${ink}" stroke-width="${line}" stroke-dasharray="${fmt(s * 0.1)} ${fmt(s * 0.07)}"/>`;
    case "fleet":
      return `<path d="M${fmt(x - w * 0.55)} ${fmt(y - h * 0.1)}L${fmt(x + w * 0.55)} ${fmt(y - h * 0.1)}L${fmt(x + w * 0.35)} ${fmt(y + h * 0.5)}L${fmt(x - w * 0.35)} ${fmt(y + h * 0.5)}Z" fill="${ink}"/><rect x="${fmt(x - w * 0.12)}" y="${fmt(y - h * 0.6)}" width="${fmt(w * 0.24)}" height="${fmt(h * 0.5)}" fill="${ink}"/>`;
  }
}
