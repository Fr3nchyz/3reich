import type { Action } from "../engine/actions";
import type { GameContext } from "../engine/context";
import type { GameState } from "../engine/types";
import { enemyDistance, enemyHexes } from "./build";
import { best } from "./random";
import type { AiConfig, Decision } from "./types";

/**
 * The computer's answer at step 8a, the Free Siberian Transfer (spec 14 part E; ticket 14-18 gives only this minimal, constant answer, so the Allied computer does not
 * leave the free units on the table; the full policy set is ticket 14-19). The Allies take everything on offer: infantry first (the engine lists armor only once the infantry
 * taken at least equal it), the biggest counter, in the Russian city nearest an Axis ground unit. A policy of the computer, not a rule: it does not weigh that the first unit
 * taken raises the Allied target by one Objective.
 * TODO(verify) V61: policy only; tune against the self-play results of ticket 14-19.
 */
export const SIBERIAN_TAKE_ALL = true;

type Transfer = Extract<Action, { type: "SIBERIAN_TRANSFER" }>;

const keyOf = (a: Transfer): string => `${a.unit.type}:${a.unit.strength}:${a.at}`;

/** The SIBERIAN_TRANSFER on the legal list the policy takes, or undefined: then the caller ends the step. */
export function chooseSiberian(ctx: GameContext, state: GameState, legal: readonly Action[], cfg: AiConfig): Decision | undefined {
  if (!SIBERIAN_TAKE_ALL) return undefined;
  const takes = legal.filter((a): a is Transfer => a.type === "SIBERIAN_TRANSFER");
  if (takes.length === 0) return undefined;
  const enemies = enemyHexes(ctx, state, "ussr");
  const near = (a: Transfer) => enemyDistance(ctx, enemies, a.at);
  const score = (a: Transfer) => (a.unit.type === "infantry" ? 1_000_000 : 0) + a.unit.strength * 1_000 + (99 - near(a));
  const pick = best(takes, score, cfg.seed, keyOf)!;
  const d = near(pick);
  return { action: pick, why: `Free Siberian Transfer: takes a ${pick.unit.strength}-factor ${pick.unit.type} from the Russian pool, into the city ${d < 99 ? `${d} hex${d === 1 ? "" : "es"} from the nearest enemy` : "of its choice"}.` };
}
