import type { Action } from "../engine/actions";
import { buildCost } from "../engine/construction";
import { distance, hex } from "../engine/hex";
import type { GameContext } from "../engine/context";
import { POWER_NAMES } from "../engine/nations";
import { atWar } from "../engine/war";
import type { GameState, UnitType } from "../engine/types";
import { plannedReserve } from "./declare";
import { best } from "./random";
import type { AiConfig, Decision } from "./types";

/**
 * Step 8b, construction. A plain priority list: the first kind on the list that the nation may
 * still build now, the biggest counter of that kind its spending limit allows (the engine lists
 * only builds within the limit), in the legal place nearest an enemy ground unit. It builds
 * until nothing is on offer, then the step ends.
 * TODO(verify): the order is the computer's own policy, to be tuned by play-testing (spec 05).
 */
export const BUILD_PRIORITY: readonly UnitType[] = ["infantry", "armor", "air", "fleet", "airborne", "replacement"];

type Build = Extract<Action, { type: "BUILD" }>;

const rank = (type: UnitType) => {
  const i = BUILD_PRIORITY.indexOf(type);
  return BUILD_PRIORITY.length - (i < 0 ? BUILD_PRIORITY.length : i);
};

/** How far a place is from the nearest unit of a nation at war with `owner`; far (99) when there is none or the place is off the map. */
function enemyDistance(ctx: GameContext, state: GameState, owner: Build["owner"], place: string): number {
  if (!ctx.map.hexes[place]) return 99;
  const here = hex(place);
  let nearest = 99;
  for (const u of Object.values(state.units)) {
    if (!ctx.map.hexes[u.at] || !atWar(state, owner, u.nationality ?? u.owner)) continue;
    nearest = Math.min(nearest, distance(here, hex(u.at)));
  }
  return nearest;
}

const keyOf = (a: Build) => `${a.owner}:${a.unit.type}:${a.unit.strength}:${a.at}`;

export function chooseBuild(ctx: GameContext, state: GameState, legal: readonly Action[], cfg: AiConfig): Decision | undefined {
  // Keep the BRPs a planned declaration of war needs (see plannedReserve): a build that would dip into them is not considered.
  const builds = legal.filter((a): a is Build => a.type === "BUILD" && state.nations[a.owner].brpTotal - (buildCost(a.unit.type, a.unit.strength) ?? 0) >= plannedReserve(state, a.owner));
  if (builds.length === 0) return undefined;
  // Kind first, then the biggest counter, then the place closest to the enemy; the weights keep each criterion ahead of the next.
  const score = (a: Build) => rank(a.unit.type) * 1_000_000 + a.unit.strength * 1_000 + (99 - enemyDistance(ctx, state, a.owner, a.at));
  const pick = best(builds, score, cfg.seed, keyOf)!;
  const near = enemyDistance(ctx, state, pick.owner, pick.at);
  const where = pick.at === "us-box" ? "in the U.S. Box" : near < 99 ? `${near} hex${near === 1 ? "" : "es"} from the nearest enemy` : "in its home territory";
  return { action: pick, why: `${POWER_NAMES[pick.owner]}: next on the build list is ${pick.unit.type}; the biggest it can pay for, ${where}.` };
}
