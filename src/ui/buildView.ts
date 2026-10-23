import type { Action } from "../engine/actions";
import { buildCost } from "../engine/construction";
import { POWER_NAMES } from "../engine/nations";
import type { ForceOwner, PowerId, UnitType } from "../engine/types";
import { counterNumber } from "./mapStyle";
import { counterIcon } from "./mapSymbols";
import { surrenderWarningHtml } from "./surrenderCard";
import type { BuildPick, Session } from "./session";

/** The construction panel of step 8b: one chip per counter a nation may build now, and the buttons for places off the map. */


export interface BuildOption extends BuildPick {
  cost: number;
  /** Every place this build may go, on the map or in a box. */
  places: string[];
}

/** "owner:type:strength", then ":returned" for a counter back in the pool and ":pool=<owner>" for another pool's counter (spec 17 R2). */
export const buildKey = (p: BuildPick) => `${p.owner}:${p.type}:${p.strength}${p.returned ? ":returned" : ""}${p.pool ? `:pool=${p.pool}` : ""}`;

export function parseBuildKey(key: string): BuildPick {
  const [owner, type, strength, ...marks] = key.split(":");
  const pool = marks.find((m) => m.startsWith("pool="))?.slice("pool=".length);
  return { owner: owner as PowerId, type: type as UnitType, strength: Number(strength), ...(marks.includes("returned") ? { returned: true as const } : {}), ...(pool ? { pool: pool as ForceOwner } : {}) };
}

/** The pick a BUILD action makes. */
export const pickOf = (a: Extract<Action, { type: "BUILD" }>): BuildPick => ({ owner: a.owner, type: a.unit.type, strength: a.unit.strength, ...(a.unit.returned ? { returned: true as const } : {}), ...(a.pool ? { pool: a.pool } : {}) });

/** The BUILD action that puts this pick at `at`. */
export const buildAction = (p: BuildPick, at: string): Extract<Action, { type: "BUILD" }> => ({
  type: "BUILD", owner: p.owner, ...(p.pool ? { pool: p.pool } : {}), unit: { type: p.type, strength: p.strength, ...(p.returned ? { returned: true as const } : {}) }, at,
});

/** The distinct builds among the legal actions, in the order they come, with their places. */
export function buildOptions(actions: readonly Action[]): BuildOption[] {
  const options = new Map<string, BuildOption>();
  for (const a of actions) {
    if (a.type !== "BUILD") continue;
    const pick = pickOf(a);
    const option = options.get(buildKey(pick)) ?? { ...pick, cost: buildCost(pick.type, pick.strength) ?? 0, places: [] };
    option.places.push(a.at);
    options.set(buildKey(pick), option);
  }
  return [...options.values()];
}

/** The numbers printed on the counter this build makes ("3-4"), from the nation's Allowable Builds. */
function numbers(s: Session, o: BuildPick): string {
  const entry = s.state.pools[o.pool ?? o.owner]?.allowableBuilds.find((e) => e.type === o.type && e.strength === o.strength && (e.returned === true) === (o.returned === true));
  return counterNumber({ strength: o.strength, ...(entry?.movement !== undefined ? { movement: entry.movement } : {}) });
}

export function buildPanel(s: Session, actions: readonly Action[]): string {
  const options = buildOptions(actions);
  if (options.length === 0) return ""; // step 8b waits only while something can be built, so the note below always has its panel
  const warning = surrenderWarningHtml(s); // the note of spec 14 D5, under the build list
  const chosen = options.find((o) => s.build && buildKey(o) === buildKey(s.build));
  const chip = (o: BuildOption) =>
    `<button data-build="${buildKey(o)}" aria-pressed="${o === chosen}">${counterIcon(o.type)} ${numbers(s, o)}<br><small>${POWER_NAMES[o.owner]} &middot; ${o.cost} BRPs</small></button>`;
  const boxes = chosen ? chosen.places.filter((p) => !s.ctx.map.hexes[p]) : [];
  const hint = !chosen
    ? "Pick a counter to build (Ref 11.6). It costs its factors times the price per factor, within this turn's spending limit."
    : boxes.length > 0
      ? "This counter is built in the U.S. Box: press the button below."
      : "Tap a yellow hex to build it there. It must be in the nation's home territory and away from enemy ground units.";
  const boxButtons = boxes.map((b) => `<button data-buildbox="${b}">Build in the ${b === "us-box" ? "U.S. Box" : b}</button>`).join("");
  return `<div class="setup build"><h2>Construction</h2><p>${hint}</p><div class="chips">${options.map(chip).join("")}</div>${boxButtons ? `<div class="actions">${boxButtons}</div>` : ""}${warning}</div>`;
}
