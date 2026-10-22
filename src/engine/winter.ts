import type { Action, ActionResult, GameEvent } from "./action-types";
import { isGroundCombatUnit } from "./attack-rules";
import type { GameContext } from "./context";
import { sideInWar } from "./control";
import { isGone } from "./nations";
import { rollD6 } from "./rng";
import type { GameState } from "./types";
import { atWar } from "./war";
import { isWinterTurn, startWinter, winterAsking, winterStage, type RussianWinter, type WinterRoll } from "./winter-record";

/**
 * The Russian Winter at step II.A (spec 14 R10; Ref 28.0, Ops 5.2). At the start of every Winter Game Turn the game looks at the first winter of the
 * German-Russian war: if Germany and the U.S.S.R. are at war and the winter has not been yet, four dice are rolled and the non-Finnish Axis ground units east
 * of the original Russian border are counted. With fewer units than the total of the dice the Allies may postpone the winter one year (`CHOOSE_WINTER`, the
 * only place the game waits at II.A); otherwise the winter starts at once. A postponed winter starts at the next Winter Game Turn with no roll and no
 * question. What the winter does to the fighting is ticket 14-12; the screens are 14-13.
 */

/** Dice rolled for the postponement test (Ref 28.0: four). */
export const WINTER_DICE = 4;

/** The map country east of which the Axis suffers the winter: the original Russian border (V23, the same 485 hexes as the surrender rule). */
export const RUSSIA_COUNTRY = "ussr";

/** The owner whose units the winter does not touch (Ref 28.0: the Finns). */
export const WINTER_EXEMPT_OWNER = "finland";

/** The four dice and the state of the generator after them. The one place the winter touches the dice. */
export function winterRoll(rngState: number): { dice: number[]; total: number; rngState: number } {
  const dice: number[] = [];
  let state = rngState;
  for (let i = 0; i < WINTER_DICE; i++) {
    const r = rollD6(state);
    dice.push(r.roll);
    state = r.state;
  }
  return { dice, total: dice.reduce((n, d) => n + d, 0), rngState: state };
}

/**
 * The Axis ground units (infantry, armor, airborne and replacements) standing on the map country "ussr", Finns left out. Minor-Allies' units count when the
 * Minor-Ally is active (`sideInWar`). TODO(verify) V24: which counters the program counts (recommended: every non-Finnish Axis ground-type counter).
 */
export function axisUnitsInRussia(ctx: GameContext, state: GameState): number {
  return Object.values(state.units).filter((u) => isGroundCombatUnit(u) && u.owner !== WINTER_EXEMPT_OWNER && sideInWar(state, u.owner) === "axis" && ctx.map.hexes[u.at]?.country === RUSSIA_COUNTRY).length;
}

/**
 * Whether the German-Russian war is on: Germany and the U.S.S.R. at war, neither out of the game.
 * TODO(verify) V43: only a war between Germany and the U.S.S.R. begins the winter's count; Italy or a Minor-Ally alone at war with Russia does not.
 */
export const germanRussianWar = (state: GameState): boolean =>
  atWar(state, "germany", "ussr") && !isGone(state.nations.germany) && !isGone(state.nations.ussr);

/**
 * The game arrives at II.A of a Game Turn: the position is set, and in a Winter Game Turn the winter is looked at (see the header). Called when a Game Turn
 * begins (`turn.ts`), so the roll is made once, before anything else of the turn.
 */
export function enterWinter(ctx: GameContext, from: GameState): { state: GameState; events: GameEvent[] } {
  const state: GameState = { ...from, position: { part: "russian-winter" } };
  const stage = winterStage(ctx, state);
  if (!isWinterTurn(state) || stage === "over" || !germanRussianWar(state)) return { state, events: [] };
  if (stage === "postponed") return startWinter(state);
  const rolled = winterRoll(state.rngState);
  const axisUnits = axisUnitsInRussia(ctx, state);
  const roll: WinterRoll = { dice: rolled.dice, total: rolled.total, axisUnits, mayPostpone: axisUnits < rolled.total };
  const event: GameEvent = { type: "WINTER_ROLLED", dice: roll.dice, total: roll.total, axisUnits, mayPostpone: roll.mayPostpone };
  const winter: RussianWinter = { ...state.winter, stage: "ahead", roll, asking: roll.mayPostpone };
  const rolledState: GameState = { ...state, rngState: rolled.rngState, winter };
  if (roll.mayPostpone) return { state: rolledState, events: [event] };
  const started = startWinter(rolledState);
  return { state: started.state, events: [event, ...started.events] };
}

/** What the Allies may do at II.A: wait for the next winter, or let it start now. Empty when nothing is asked. */
export function legalWinterActions(state: GameState): Action[] {
  return winterAsking(state) ? [{ type: "CHOOSE_WINTER", side: "allies", postpone: false }, { type: "CHOOSE_WINTER", side: "allies", postpone: true }] : [];
}

/** The Allies answer at II.A. The state returned is still at II.A with nothing asked; the caller moves the game on (`actions.ts`). */
export function applyChooseWinter(state: GameState, action: Extract<Action, { type: "CHOOSE_WINTER" }>): ActionResult {
  if (!winterAsking(state)) return { ok: false, error: "No question about the Russian winter is waiting." };
  if (action.side !== "allies") return { ok: false, error: `The Allies decide whether the Russian winter waits, not the ${String(action.side)} side.` };
  if (typeof action.postpone !== "boolean") return { ok: false, error: "The Russian winter either waits or starts now." };
  const winter = state.winter!;
  if (!action.postpone) {
    const started = startWinter(state);
    return { ok: true, state: started.state, events: started.events };
  }
  if (!winter.roll?.mayPostpone) return { ok: false, error: "The Russian winter may not wait: the Axis has as many units in Russia as the dice show." };
  const postponed: RussianWinter = { ...winter, stage: "postponed", asking: false, postponedFrom: { year: state.year, season: state.season } };
  return { ok: true, state: { ...state, winter: postponed }, events: [{ type: "WINTER_POSTPONED", turn: { year: state.year, season: state.season } }] };
}
