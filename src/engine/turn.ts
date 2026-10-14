import type { GameEvent } from "./action-types";
import type { GameContext } from "./context";
import { determineInitiative, initiativeTotals, nextTurn, otherSide, runYearStartSequence, turnIndex } from "./game";
import { FIRST_STEP, IMPLEMENTED_STEPS, nextStepId } from "./sequence";
import type { GameState, TurnPosition } from "./types";

/**
 * The Sequence of Play as a machine (Ops 5.0, specs/01-turn-steps.md). The state always has a
 * position; `advance` moves it one step on, doing what leaving that step does; `settle` keeps
 * moving through the steps that have no rules built yet and stops at the first one that has,
 * recording what it passed. Pure: no data is imported, the caller supplies the context.
 */

export interface Transition {
  state: GameState;
  events: GameEvent[];
}

/** More moves than a Game Turn has positions (two Player Turns of 45 steps and three game-level parts). */
const MAX_MOVES = 200;

const PLAYER_TURN_START: TurnPosition = { part: "player-turn", turn: 1, step: FIRST_STEP };

/** The id a position has on the card: "YSS", "II.A", "II.B" or the step. */
export function positionId(p: TurnPosition): string {
  switch (p.part) {
    case "year-start":
      return "YSS";
    case "russian-winter":
      return "II.A";
    case "turn-order":
      return "II.B";
    case "player-turn":
      return p.step;
  }
}

/** Play starts here when the last nation has set up: step 1 of the first Player Turn. */
export function beginPlay(ctx: GameContext, state: GameState): Transition {
  return settle(ctx, { ...state, position: PLAYER_TURN_START });
}

/** Moves one position on, doing what leaving the current one does (the Initiative at II.B, the Game Turn changing after the second Player Turn). */
export function advance(state: GameState): Transition {
  const pos = state.position;
  if (!pos) throw new Error("advance: the game has no position (setup, or an old saved game).");
  switch (pos.part) {
    case "year-start":
      return { state: { ...runYearStartSequence(state), position: { part: "russian-winter" } }, events: [] };
    case "russian-winter":
      return { state: { ...state, position: { part: "turn-order" } }, events: [] };
    case "turn-order": {
      const firstSide = determineInitiative(state);
      const next: GameState = { ...state, firstSide, activeSide: firstSide, position: PLAYER_TURN_START };
      return {
        state: next,
        events: [
          { type: "INITIATIVE_DETERMINED", year: state.year, season: state.season, firstSide, ...initiativeTotals(state) },
          { type: "PLAYER_TURN_STARTED", year: state.year, season: state.season, side: firstSide },
        ],
      };
    }
    case "player-turn": {
      const step = nextStepId(pos.step);
      if (step) return { state: { ...state, position: { ...pos, step } }, events: [] };
      return pos.turn === 1 ? secondPlayerTurn(state) : endGameTurn(state);
    }
  }
}

function secondPlayerTurn(state: GameState): Transition {
  const side = otherSide(state.firstSide);
  return {
    state: { ...state, activeSide: side, position: { part: "player-turn", turn: 2, step: FIRST_STEP } },
    events: [{ type: "PLAYER_TURN_STARTED", year: state.year, season: state.season, side }],
  };
}

/** Both Player Turns are done: the scenario ends, or the next Game Turn begins at its first part. */
function endGameTurn(state: GameState): Transition {
  if (turnIndex(state) >= turnIndex(state.lastTurn)) {
    return { state: { ...state, phase: "game-over" }, events: [{ type: "GAME_OVER", year: state.year, season: state.season }] };
  }
  const turn = nextTurn(state);
  const position: TurnPosition = turn.season === "spring" ? { part: "year-start" } : { part: "russian-winter" };
  return { state: { ...state, ...turn, position }, events: [] };
}

/**
 * Moves on until the game stands at a step that has rules built (or the scenario ends). Every
 * step passed on the way without rules is recorded in a STEPS_PASSED event, in order.
 */
export function settle(ctx: GameContext, from: GameState): Transition {
  const implemented = ctx.implementedSteps ?? IMPLEMENTED_STEPS;
  let state = from;
  const events: GameEvent[] = [];
  let passed: string[] = [];
  const flush = () => {
    if (passed.length > 0) events.push({ type: "STEPS_PASSED", steps: passed });
    passed = [];
  };
  for (let moves = 0; state.phase === "player-turn" && state.position; moves++) {
    if (moves > MAX_MOVES) throw new Error("settle: the Sequence of Play did not reach a step that waits.");
    const id = positionId(state.position);
    if (state.position.part === "player-turn" && implemented.has(id)) break;
    const moved = advance(state);
    if (implemented.has(id)) flush();
    else passed.push(id);
    if (moved.events.length > 0) flush();
    events.push(...moved.events);
    state = moved.state;
  }
  flush();
  return { state, events };
}
