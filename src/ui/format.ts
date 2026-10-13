import type { MapHex } from "../engine/map";
import type { Side } from "../engine/types";

/** Small text helpers shared by the views. */

export const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);
export const sideName = (s: Side) => (s === "axis" ? "Axis" : "Allied");

/** The line shown in the hex info overlay: id, name, terrain, country, front and features. */
export const describeHex = (h: MapHex | null) => {
  if (!h) return "";
  const parts = [h.id, h.name, h.land ? cap(h.land) : "Sea", h.land && h.sea ? "coastal" : "", h.country && cap(h.country), `${cap(h.front)} Front`];
  if (h.fortress) parts.push(`fortress (${h.fortress})`);
  if (h.features.length) parts.push(h.features.join(", "));
  return parts.filter(Boolean).join(" · ");
};
