import type { Action } from "../engine/actions";
import { controllingSide, sideInWar } from "../engine/control";
import type { GameContext } from "../engine/context";
import type { HexId } from "../engine/hex";
import { srOf } from "../engine/sr-record";
import { srDestinations, srProblem, srView, type SrSoFar, type SrView } from "../engine/sr-region";
import { srNationOf } from "../engine/sr-rules";
import type { GameState, PowerId, Unit } from "../engine/types";
import { distanceToEnemyObjective, enemyObjectives, groundDistances } from "./geo";
import { best } from "./random";
import type { AiConfig, Decision } from "./types";

/**
 * Step 9e, Strategic Redeployment. COMPUTER POLICY, not rules (spec 16 part E, ticket 16-20; Ref 11.72): the engine decides what may be
 * redeployed (`srDestinations`, `srProblem`, the allowance); this file only picks among those answers. Nation by nation, in SR_NATION_ORDER,
 * Replacements first (they move only this way, Ref 11.72), then the other ground units: a unit goes to the hex it can reach that is closest
 * to its target (the enemy-held objective it is heading for, the same notion as the mover's in move.ts and geo.ts), if that hex is at least
 * SR_MIN_GAIN hexes closer than where it stands. The engine already refuses a unit next to an enemy and a destination next to one. It never
 * empties the garrison of a capital its side holds (as the mover does). The allowance is the engine's: when a nation has none left its units
 * have no destination, and the computer goes on to the next. Only single units are sent, each costing one use of the allowance whatever its size.
 * TODO(verify) AER50: every number and order here is the computer's policy, to be tuned by play-testing; it is no rule.
 */

/** A unit goes only if the best hex it can reach is at least this many ground hexes closer to its target than the hex it stands on (AER50). 3 was tried first: Germany then sent units to the Polish front early and the Axis lost most games (see spec 16 "As built, 16-20"). */
export const SR_MIN_GAIN = 10;
/** The last non-Replacement ground unit on a capital the side holds stays (AER50; the mover's MOVE_KEEP_CAPITAL_GARRISON). */
export const SR_KEEP_CAPITAL_GARRISON = true;
/** The order in which the nations of a side use their allowances (AER50). */
export const SR_NATION_ORDER: readonly PowerId[] = ["germany", "italy", "ussr", "britain", "france", "usa"];

type Redeploy = Extract<Action, { type: "SR_UNITS" }>;

/** What a redeployment of these units would be: the hex, how many hexes nearer the target it is, and the target. */
export interface SrPlan {
  to: HexId;
  gain: number;
  target: HexId;
}

const isCapital = (ctx: GameContext, hex: HexId): boolean => {
  const f = ctx.map.hexes[hex]?.features ?? [];
  return f.includes("capital") || f.includes("capital-port");
};

/** The numbers one choice reads, found once: the view, the allowances, the enemy objectives and the distance fields already made. */
class Env {
  readonly view: SrView;
  readonly so: SrSoFar;
  readonly held: ReadonlySet<HexId>;
  private nearest = new Map<string, { dist: Map<HexId, number>; from: Map<HexId, HexId> }>();
  private fields = new Map<string, Map<HexId, number>>();
  constructor(readonly ctx: GameContext, readonly state: GameState, readonly cfg: AiConfig, readonly minGain: number) {
    this.view = srView(ctx, state);
    this.so = { used: srOf(state).used, redeployed: srOf(state).moved };
    this.held = new Set(enemyObjectives(ctx, state, state.activeSide));
  }

  /** Where the unit is heading (its remembered target while the enemy holds it, else the nearest enemy objective) and the distances to it. */
  goal(u: Unit): { target: HexId; field: Map<HexId, number> } | null {
    const kept = this.cfg.memory?.targets.get(u.id);
    let target = kept !== undefined && this.held.has(kept) && kept !== u.at ? kept : undefined;
    if (target === undefined) {
      let near = this.nearest.get(u.owner);
      if (!near) {
        const from = new Map<HexId, HexId>();
        near = { dist: distanceToEnemyObjective(this.ctx, this.state, u.owner, this.state.activeSide, from), from };
        this.nearest.set(u.owner, near);
      }
      target = near.from.get(u.at);
    }
    if (target === undefined) return null;
    const key = `${u.owner}>${target}`;
    let field = this.fields.get(key);
    if (!field) this.fields.set(key, (field = groundDistances(this.ctx, this.state, u.owner, [target])));
    return { target, field };
  }

  /** Whether sending these units away would leave a capital the side holds without a ground unit (a Replacement is no garrison). */
  stripsGarrison(units: readonly Unit[]): boolean {
    const from = units[0]!.at;
    if (!SR_KEEP_CAPITAL_GARRISON || !isCapital(this.ctx, from) || controllingSide(this.ctx, this.state, from) !== this.state.activeSide) return false;
    if (units.every((u) => u.type === "replacement")) return false;
    const gone = new Set(units.map((u) => u.id));
    return !Object.values(this.state.units).some((u) => u.at === from && u.type !== "replacement" && !gone.has(u.id) && ["infantry", "armor", "airborne"].includes(u.type) && sideInWar(this.state, u.owner) === this.state.activeSide);
  }
}

/** The best redeployment of these units (together, from one hex) by the policy, or null when none gains SR_MIN_GAIN hexes. */
function plan(env: Env, units: readonly Unit[]): SrPlan | null {
  const first = units[0]!;
  const goal = env.goal(first);
  const d0 = goal?.field.get(first.at);
  if (!goal || d0 === undefined || env.stripsGarrison(units)) return null;
  let dests: HexId[] | null = null;
  for (const u of units) {
    const d = srDestinations(env.ctx, env.state, u, env.so, env.view);
    dests = dests === null ? d : dests.filter((h) => d.includes(h));
  }
  const scored = (dests ?? []).flatMap((h) => {
    const d1 = goal.field.get(h);
    return d1 === undefined || d0 - d1 < env.minGain ? [] : [{ to: h, gain: d0 - d1 }];
  });
  const pick = best(scored, (c) => c.gain, env.cfg.seed, (c) => `${units.map((u) => u.id).join(",")}>${c.to}`);
  if (!pick || (units.length > 1 && srProblem(env.ctx, env.state, units.map((u) => u.id), pick.to, env.so, env.view) !== null)) return null;
  return { ...pick, target: goal.target };
}

/**
 * The computer's choice for these units, redeployed together ("Send toward the front", ticket 16-19): the hex it would send them to, or
 * null when the policy would not (no hex gains SR_MIN_GAIN hexes, the units are the garrison of a capital, nothing can be redeployed).
 * Reads the state only; the units must stand in one hex.
 */
export function sendTowardFront(ctx: GameContext, state: GameState, unitIds: readonly string[], cfg: AiConfig = { seed: 0 }, minGain = SR_MIN_GAIN): HexId | null {
  const units = unitIds.map((id) => state.units[id]);
  if (units.length === 0 || units.some((u) => !u || u.at !== units[0]!.at)) return null;
  return plan(new Env(ctx, state, cfg, minGain), units as Unit[])?.to ?? null;
}

/** The computer's next redeployment at 9e, or undefined when it has none to make (the caller then ends the step). */
export function chooseRedeploy(ctx: GameContext, state: GameState, cfg: AiConfig, minGain = SR_MIN_GAIN): Decision | undefined {
  const env = new Env(ctx, state, cfg, minGain);
  const rank = (u: Unit): number => SR_NATION_ORDER.indexOf(srNationOf(state, u) ?? "usa");
  const units = Object.values(state.units)
    .filter((u) => srNationOf(state, u) !== null && sideInWar(state, u.owner) === state.activeSide)
    .sort((a, b) => rank(a) - rank(b) || (a.type === "replacement" ? 0 : 1) - (b.type === "replacement" ? 0 : 1) || (a.id < b.id ? -1 : 1));
  // Nation by nation, Replacements before the rest; within a group the biggest gain first.
  const groups = new Map<string, { unit: Unit; p: SrPlan }[]>();
  for (const u of units) {
    if (srDestinations(ctx, state, u, env.so, env.view).length === 0) continue;
    const p = plan(env, [u]);
    if (p) groups.set(`${rank(u)}|${u.type === "replacement" ? 0 : 1}`, [...(groups.get(`${rank(u)}|${u.type === "replacement" ? 0 : 1}`) ?? []), { unit: u, p }]);
  }
  const key = [...groups.keys()].sort()[0];
  if (key === undefined) return undefined;
  const { unit, p } = groups.get(key)!.reduce((a, b) => (b.p.gain > a.p.gain ? b : a));
  cfg.memory?.targets.set(unit.id, p.target);
  const action: Redeploy = { type: "SR_UNITS", side: state.activeSide, units: [unit.id], to: p.to };
  const nation = srNationOf(state, unit)!;
  return { action, why: `Redeploys ${unit.type === "replacement" ? "a Replacement" : "a unit"} of ${nation} from ${unit.at} to ${p.to}, ${p.gain} hexes closer to the enemy-held objective ${p.target}.` };
}
