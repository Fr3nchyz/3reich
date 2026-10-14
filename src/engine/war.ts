import type { Action, ActionResult, GameEvent } from "./action-types";
import { charge, spend, spendable } from "./brps";
import type { GameContext } from "./context";
import { BRP_COSTS, MINOR_COUNTRY_FORCES } from "./tables";
import type { Combatant, GameState, Nation, PowerId, Side } from "./types";

/**
 * Wars and declarations of war (Ref 13.0, spec 02). A declaration is made at step 1 of a Player
 * Turn by a Major Power of the side taking it, and costs BRPs within that Player Turn's limit.
 *
 * Not built yet (TODO(verify), spec 02): the minor country's forces appearing when it is attacked
 * (step 2); the rule that a declaration on a minor must be followed that turn by a move into it
 * or an attack on it, or it is revoked and the BRPs lost; the 35-BRP price when a declaration on
 * a minor or colony would bring war with a Major Power; alliances (a neutral Major Power joining
 * a side).
 */

export const isMajorPower = (o: Combatant): o is PowerId => ["germany", "italy", "ussr", "britain", "france", "usa"].includes(o);

/** Whether two owners are at war. */
export function atWar(state: GameState, a: Combatant, b: Combatant): boolean {
  return state.wars.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
}

/** The side a Major Power fights on, or null while it is neutral, out of the scenario or Vichy. */
export function sideOfPower(n: Nation): Side | null {
  return n.status === "axis" ? "axis" : n.status === "allied" ? "allies" : null;
}

const costOf = (on: Combatant) => (isMajorPower(on) ? BRP_COSTS.declareWarOnMajorPower : BRP_COSTS.declareWarOnMinorCountry);

/** Who `by` may declare war on now: not already at war, not on its own side, and the scenario allows it. */
export function declarationTargets(ctx: GameContext, state: GameState, by: PowerId): Combatant[] {
  const me = state.nations[by];
  const side = sideOfPower(me);
  if (side === null || side !== state.activeSide) return [];
  const noNeutrals = ctx.scenario.rules.some((r) => r.kind === "no-war-on-neutrals");
  const targets: Combatant[] = [];
  for (const other of Object.values(state.nations)) {
    if (other.id === by || atWar(state, by, other.id) || other.status === "out" || other.status === "vichy") continue;
    const theirs = sideOfPower(other);
    if (theirs === side) continue;
    if (theirs === null && noNeutrals) continue;
    targets.push(other.id);
  }
  const minorAllies = new Set<string>(state.minorAllies.map((m) => m.owner));
  const powers = Object.keys(state.nations) as PowerId[];
  for (const minor of Object.keys(MINOR_COUNTRY_FORCES) as (keyof typeof MINOR_COUNTRY_FORCES)[]) {
    // A minor already at war with a Major Power is no neutral to attack (it fights for one side); an
    // active Minor-Ally is handled by the Minor-Ally rules.
    if (noNeutrals || minorAllies.has(minor) || powers.some((p) => atWar(state, p, minor))) continue;
    targets.push(minor);
  }
  return targets.filter((t) => costOf(t) <= spendable(me));
}

/** Every declaration the side to move may make now. */
export function legalDeclarations(ctx: GameContext, state: GameState): Action[] {
  return (Object.keys(state.nations) as PowerId[]).flatMap((by) => declarationTargets(ctx, state, by).map((on): Action => ({ type: "DECLARE_WAR", by, on })));
}

export function applyDeclaration(ctx: GameContext, state: GameState, action: Extract<Action, { type: "DECLARE_WAR" }>): ActionResult {
  const nation = state.nations[action.by];
  if (sideOfPower(nation) !== state.activeSide) return { ok: false, error: `${action.by} is not on the ${state.activeSide} side, so it cannot declare war now.` };
  if (atWar(state, action.by, action.on)) return { ok: false, error: `${action.by} is already at war with ${action.on}.` };
  if (!declarationTargets(ctx, state, action.by).includes(action.on)) {
    return { ok: false, error: `${action.by} may not declare war on ${action.on}: it is on the same side, out of the game, protected by the scenario, or beyond what ${action.by} may spend this turn.` };
  }
  const cost = costOf(action.on);
  const paid = spend(state, action.by, cost, `declaring war on ${action.on}`);
  if (!paid.ok) return paid;
  const events: GameEvent[] = [paid.event, { type: "WAR_DECLARED", by: action.by, on: action.on, cost }];
  return { ok: true, state: { ...paid.state, wars: [...paid.state.wars, [action.by, action.on]] }, events };
}

/**
 * Declarations the scenario makes by itself when a Player Turn begins (the U.S. in Spring 1942):
 * the Major Power joins its side, the war is recorded and the BRPs are charged (Ref 13.0).
 * TODO(spec 02): the U.S. units waiting in the U.S. Box then enter play.
 */
export function scheduledDeclarations(ctx: GameContext, state: GameState): { state: GameState; events: GameEvent[] } {
  let next = state;
  const events: GameEvent[] = [];
  for (const rule of ctx.scenario.rules) {
    if (rule.kind !== "automatic-declaration" || rule.side !== state.activeSide) continue;
    if (rule.turn.year !== state.year || rule.turn.season !== state.season || atWar(next, rule.by, rule.on)) continue;
    const charged = charge(next, rule.by, rule.brpCost, `declaring war on ${rule.on} (scenario rule)`);
    const joined = { ...charged.state.nations[rule.by], status: rule.side === "axis" ? ("axis" as const) : ("allied" as const) };
    next = { ...charged.state, nations: { ...charged.state.nations, [rule.by]: joined }, wars: [...charged.state.wars, [rule.by, rule.on]] };
    events.push(charged.event, { type: "WAR_DECLARED", by: rule.by, on: rule.on, cost: rule.brpCost });
  }
  return { state: next, events };
}
