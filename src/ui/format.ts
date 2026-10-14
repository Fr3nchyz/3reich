import type { MapHex } from "../engine/map";
import { combatantName } from "../engine/nations";
import type { GameEvent } from "../engine/action-types";
import type { GameContext } from "../engine/context";
import { OWNER_NAMES } from "../engine/nations";
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

/** "Warsaw (M35): 2 air units alone in the hex are destroyed (Poland air 1, Poland air 1)." for a sweep (ALONE_NONGROUND_DESTROYED). */
export function sweepLine(ctx: GameContext, e: Extract<GameEvent, { type: "UNITS_SWEPT" }>): string {
  const name = ctx.map.hexes[e.hex]?.name;
  const kinds = [...new Set(e.units.map((u) => u.type))];
  const what = `${e.units.length} ${kinds.length === 1 ? `${kinds[0]} unit${e.units.length === 1 ? "" : "s"}` : "air, naval or support units"}`;
  return `${name ? `${name} (${e.hex})` : e.hex}: ${what} alone in the hex ${e.units.length === 1 ? "is" : "are"} destroyed (${e.units.map((u) => `${OWNER_NAMES[u.owner]} ${u.type} ${u.strength}`).join(", ")}).`;
}
