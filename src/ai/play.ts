import { applyAction, type GameEvent } from "../engine/actions";
import type { GameContext } from "../engine/context";
import { autoSetupOwner } from "../engine/autosetup";
import { currentSetupOwner, sideOfOwner } from "../engine/setup";
import type { GameState, Side } from "../engine/types";
import { chooseAction } from "./choose";
import type { AiConfig, Decision } from "./types";

/** Thrown if the engine refuses an action the computer took from legalActions: a bug, never expected. */
export class IllegalComputerAction extends Error {}

export interface Played {
  state: GameState;
  events: GameEvent[];
  decision: Decision;
}

/** The computer takes one action through applyAction, or null when it has none. */
export function playOne(ctx: GameContext, state: GameState, cfg: AiConfig): Played | null {
  const decision = chooseAction(ctx, state, cfg);
  if (!decision) return null;
  const result = applyAction(ctx, state, decision.action);
  if (!result.ok) throw new IllegalComputerAction(`${JSON.stringify(decision.action)}: ${result.error}`);
  return { state: result.state, events: result.events, decision };
}

/** Where the Player Turn is: the side and the step, so a caller can tell when a step has been left. */
export const placeOf = (s: GameState): string => `${s.year}-${s.season}-${s.activeSide}-${s.position?.part === "player-turn" ? `${s.position.turn}-${s.position.step}` : s.phase}`;

/** The computer plays on, one step at a time, for as long as `side` is to move; stops after `maxActions` as a safety. */
export function playSide(ctx: GameContext, state: GameState, side: Side, cfg: AiConfig, maxActions = 500): { state: GameState; decisions: Decision[] } {
  const decisions: Decision[] = [];
  let s = state;
  while (s.phase === "player-turn" && s.activeSide === side && decisions.length < maxActions) {
    const played = playOne(ctx, s, cfg);
    if (!played) break;
    s = played.state;
    decisions.push(played.decision);
  }
  return { state: s, decisions };
}

/** The computer sets up the nations of `sides` as they come up in the scenario's order, and stops at the first nation of another side. Layer 1 placeholder: the rules-legal automatic setup; TODO a front-weighted placement (spec 05). */
export function computerSetup(ctx: GameContext, state: GameState, sides: readonly Side[]): { state: GameState; events: GameEvent[] } {
  let s = state;
  const events: GameEvent[] = [];
  for (let owner = currentSetupOwner(s); owner !== null && sides.includes(sideOfOwner(owner)); owner = currentSetupOwner(s)) {
    for (const action of autoSetupOwner(ctx, s)) {
      const r = applyAction(ctx, s, action);
      if (!r.ok) throw new IllegalComputerAction(r.error);
      s = r.state;
      events.push(...r.events);
    }
  }
  return { state: s, events };
}
