import type { Action, ActionResult } from "./action-types";
import { legalBuilds } from "./construction";
import type { GameContext } from "./context";
import { applyMinorRebuild, minorRebuildProblem } from "./minors-rebuild";
import type { GameState, MinorCountry } from "./types";
import { sideOfPower } from "./war";

type BuildAction = Extract<Action, { type: "BUILD" }>;

/** Whether a BUILD pool is an active-or-not Minor-Ally record (a Free French or own pool is not). */
export const isMinorAllyPool = (state: GameState, pool: unknown) => state.minorAllies.some((m) => m.owner === pool);

/**
 * Spec 15 R8/R9, ticket 15-19b (Ref 17.1, 17.3): the rebuilds of an active Minor-Ally's returned counters that the side to move may buy at step 8b.
 * One BUILD per counter and home hex; `owner` is the Major Power that pays, `pool` the minor. Which ally is active, who controls it and every limit
 * are `minorRebuildProblem`'s (15-19a).
 */
export function legalMinorRebuilds(ctx: GameContext, state: GameState): BuildAction[] {
  const out: BuildAction[] = [];
  for (const ally of state.minorAllies) {
    const entries = (state.pools[ally.owner]?.allowableBuilds ?? []).filter((e) => e.returned && e.count > 0);
    if (!ally.active || entries.length === 0 || sideOfPower(state.nations[ally.of]) !== state.activeSide) continue;
    const country = ally.owner as MinorCountry;
    const homes = Object.values(ctx.map.hexes).filter((h) => h.land && h.country === country).map((h) => h.id).sort();
    const seen = new Set<string>();
    for (const e of entries) {
      if (seen.has(`${e.type}:${e.strength}`)) continue;
      seen.add(`${e.type}:${e.strength}`);
      for (const at of homes) {
        if (minorRebuildProblem(ctx, state, state.activeSide, country, { type: e.type, strength: e.strength, at }) === null) {
          out.push({ type: "BUILD", owner: ally.of, pool: country, unit: { type: e.type, strength: e.strength, returned: true }, at });
        }
      }
    }
  }
  return out;
}

/** Every build of step 8b: a Major Power's own, and the rebuilds of its active Minor-Allies (ticket 15-19b). */
export const legalAllBuilds = (ctx: GameContext, state: GameState): BuildAction[] => [...legalBuilds(ctx, state), ...legalMinorRebuilds(ctx, state)];

/** Applies a BUILD whose pool is a Minor-Ally (spec 15 R8/R9); the payer must be the Major Power the action names. */
export function applyMinorBuild(ctx: GameContext, state: GameState, action: BuildAction): ActionResult {
  const country = action.pool as MinorCountry;
  const ally = state.minorAllies.find((m) => m.owner === country);
  if (!ally || ally.of !== action.owner) return { ok: false, error: `${action.owner} does not control ${country}, so it cannot rebuild its counters.` };
  if (action.unit.returned !== true) return { ok: false, error: "Only a counter back in the pool is rebuilt for a Minor-Ally." };
  return applyMinorRebuild(ctx, state, state.activeSide, country, { type: action.unit.type, strength: action.unit.strength, at: action.at });
}
