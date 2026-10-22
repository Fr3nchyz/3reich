import type { Action, ActionResult, GameEvent } from "./action-types";
import { charge, spend, spendable } from "./brps";
import { isConquered } from "./conquest-record";
import { combatantName, isGone } from "./nations";
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

/**
 * Which side each Major Power belongs to for good, even while it is neutral (Italy in 1939, the U.S.A.
 * and the U.S.S.R. until they are attacked or declare): a Major Power never declares war on its own side.
 */
export const ALIGNMENT: Readonly<Record<PowerId, Side>> = { germany: "axis", italy: "axis", britain: "allies", france: "allies", usa: "allies", ussr: "allies" };

/** The side a Major Power fights on, or null while it is neutral, out of the scenario or Vichy. */
export function sideOfPower(n: Nation): Side | null {
  return n.status === "axis" ? "axis" : n.status === "allied" ? "allies" : null;
}

const costOf = (on: Combatant) => (isMajorPower(on) ? BRP_COSTS.declareWarOnMajorPower : BRP_COSTS.declareWarOnMinorCountry);

/** Who `by` may declare war on now: not already at war, not on its own side, and the scenario allows it. */
export function declarationTargets(ctx: GameContext, state: GameState, by: PowerId): Combatant[] {
  const me = state.nations[by];
  // A recorded action can name anyone; an unknown nation has nothing to declare (applyAction must not throw).
  if (!me) return [];
  const side = sideOfPower(me);
  if (side === null || side !== state.activeSide) return [];
  const noNeutrals = ctx.scenario.rules.some((r) => r.kind === "no-war-on-neutrals");
  const targets: Combatant[] = [];
  for (const other of Object.values(state.nations)) {
    if (other.id === by || atWar(state, by, other.id) || isGone(other) || other.status === "vichy") continue;
    if (ALIGNMENT[other.id] === side) continue;
    if (sideOfPower(other) === null && noNeutrals) continue;
    targets.push(other.id);
  }
  const minorAllies = new Set<string>(state.minorAllies.map((m) => m.owner));
  const powers = Object.keys(state.nations) as PowerId[];
  for (const minor of Object.keys(MINOR_COUNTRY_FORCES) as (keyof typeof MINOR_COUNTRY_FORCES)[]) {
    // A minor already at war with a Major Power is no neutral to attack (it fights for one side); an
    // active Minor-Ally is handled by the Minor-Ally rules.
    if (noNeutrals || minorAllies.has(minor) || isConquered(state, minor) || powers.some((p) => atWar(state, p, minor))) continue;
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
  if (!nation) return { ok: false, error: `${String(action.by)} is not a Major Power in this game.` };
  if (sideOfPower(nation) !== state.activeSide) return { ok: false, error: `${action.by} is not on the ${state.activeSide} side, so it cannot declare war now.` };
  if (atWar(state, action.by, action.on)) return { ok: false, error: `${action.by} is already at war with ${action.on}.` };
  if (!declarationTargets(ctx, state, action.by).includes(action.on)) {
    return { ok: false, error: `${action.by} may not declare war on ${action.on}: it is on the same side, out of the game, protected by the scenario, or beyond what ${action.by} may spend this turn.` };
  }
  const cost = costOf(action.on);
  const paid = spend(state, action.by, cost, `declaring war on ${combatantName(action.on)}`);
  if (!paid.ok) return paid;
  const events: GameEvent[] = [paid.event, { type: "WAR_DECLARED", by: action.by, on: action.on, cost }];
  const wars: GameState["wars"] = [...paid.state.wars, [action.by, action.on]];
  return { ok: true, state: joinsItsSide({ ...paid.state, wars }, action.on), events };
}

/**
 * A neutral Major Power that is at war has to be fighting for its own side: Italy for the Axis, the
 * U.S.A. and the U.S.S.R. for the Allies (ALIGNMENT). Anyone else is left as it is.
 * TODO(verify, spec 02): alliances for the rest (a neutral Major Power joining the other side).
 */
function joinsItsSide(state: GameState, who: Combatant): GameState {
  if (!isMajorPower(who) || state.nations[who].status !== "neutral") return state;
  const status = ALIGNMENT[who] === "axis" ? ("axis" as const) : ("allied" as const);
  return { ...state, nations: { ...state.nations, [who]: { ...state.nations[who], status } } };
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
    if (rule.turn.year !== state.year || rule.turn.season !== state.season) continue;
    // Spec 14 R4: a conquered Power is not a target and not a declarer (`declarationTargets`), so a scheduled declaration on one is not made: nothing is
    // charged and no war is recorded (the U.S. would otherwise pay 35 BRPs to declare on a Germany that is gone). TODO(verify) V35: the declarer
    // still joins its side, as if the war existed already; a declarer that is itself gone does nothing.
    if (isGone(next.nations[rule.by]) || (isMajorPower(rule.on) && isGone(next.nations[rule.on]))) {
      if (!isGone(next.nations[rule.by])) next = joinsItsSide(next, rule.by);
      continue;
    }
    // The war may exist already (Germany declared first): the Major Power still joins its side, with nothing to pay.
    if (atWar(next, rule.by, rule.on)) {
      next = joinsItsSide(next, rule.by);
      continue;
    }
    const charged = charge(next, rule.by, rule.brpCost, `declaring war on ${combatantName(rule.on)} (scenario rule)`);
    const joined = { ...charged.state.nations[rule.by], status: rule.side === "axis" ? ("axis" as const) : ("allied" as const) };
    next = { ...charged.state, nations: { ...charged.state.nations, [rule.by]: joined }, wars: [...charged.state.wars, [rule.by, rule.on]] };
    events.push(charged.event, { type: "WAR_DECLARED", by: rule.by, on: rule.on, cost: rule.brpCost });
  }
  return { state: next, events };
}
