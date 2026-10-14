import { controlMap, sideInWar } from "../engine/control";
import type { GameContext } from "../engine/context";
import { POWER_NAMES } from "../engine/nations";
import { sideOfOwner } from "../engine/setup";
import type { GameState, PowerId, Side } from "../engine/types";
import { cap } from "./format";

/**
 * The "End of game" summary of a watched game: BRPs per nation, counters per side, hexes controlled per side. The same
 * counting as the self-play report (scripts/selfplay/stats.ts: holdings and forces), which is a Node-side script
 * and so is not imported into the browser bundle.
 */

export interface Summary {
  brps: Partial<Record<PowerId, number>>;
  units: Record<Side, number>;
  hexes: Record<Side | "neutral", number>;
}

export function summarise(ctx: GameContext, state: GameState): Summary {
  const brps = Object.fromEntries(Object.values(state.nations).map((n) => [n.id, n.brpTotal])) as Summary["brps"];
  const units = { axis: 0, allies: 0 };
  for (const u of Object.values(state.units)) units[sideOfOwner(u.owner)]++;
  const hexes = { axis: 0, allies: 0, neutral: 0 };
  for (const owner of controlMap(ctx, state).values()) hexes[sideInWar(state, owner) ?? "neutral"]++;
  return { brps, units, hexes };
}

/** The panel's HTML. `heading` says why the game ended. */
export function summaryHtml(sum: Summary, heading: string): string {
  const nations = Object.entries(sum.brps).map(([id, n]) => `<li>${POWER_NAMES[id as PowerId]}: ${n} BRPs</li>`).join("");
  const side = (s: Side) => `<li>${cap(s)}: ${sum.units[s]} counters, ${sum.hexes[s]} hexes controlled</li>`;
  return `<section class="watch-summary" aria-label="End of game"><h2>End of game</h2><p>${heading}</p>
    <ul>${nations}</ul><ul>${side("axis")}${side("allies")}<li>Not controlled by either side: ${sum.hexes.neutral} hexes</li></ul></section>`;
}
