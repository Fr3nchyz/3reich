import type { MapHex } from "../engine/map";
import { combatantName, OWNER_NAMES } from "../engine/nations";
import type { GameState, Side } from "../engine/types";

/** Small text helpers shared by the views. */

export const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);
/** A readable name for a country at war: an owner of forces, or a minor country by its id. */
export const nameOf = combatantName;
export const sideName = (s: Side) => (s === "axis" ? "Axis" : "Allied");

/** The line shown in the hex info overlay: id, name, terrain, country, front and features. */
export const describeHex = (h: MapHex | null) => {
  if (!h) return "";
  const parts = [h.id, h.name, h.land ? cap(h.land) : "Sea", h.land && h.sea ? "coastal" : "", h.country && cap(h.country), `${cap(h.front)} Front`];
  if (h.fortress) parts.push(`fortress (${h.fortress})`);
  if (h.features.length) parts.push(h.features.join(", "));
  return parts.filter(Boolean).join(" · ");
};

/** The counters in a hex, grouped, as "Units: 2 x 3-armor (Germany), 1 x 2-infantry (Italy)"; "" when it is empty. A counter of another nation than its owner shows its nationality. */
export const describeUnits = (state: GameState, hexId: string): string => {
  const counts = new Map<string, number>();
  for (const u of Object.values(state.units)) {
    if (u.at !== hexId) continue;
    const key = `${u.strength}-${u.type} (${OWNER_NAMES[u.nationality ?? u.owner]})`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts.size ? `Units: ${[...counts].map(([k, n]) => `${n} x ${k}`).join(", ")}` : "";
};
