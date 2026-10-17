import type { GameEvent } from "./action-types";
import type { GameContext } from "./context";
import { resetSpending } from "./brps";
import { refreshFortresses } from "./fortress";
import { eliminateUnsupplied, recordUnsupplied } from "./supply-effects";
import { determineInitiative, initiativeTotals, nextTurn, otherSide, turnIndex } from "./game";
import { FIRST_STEP, IMPLEMENTED_STEPS, nextStepId } from "./sequence";
import type { GameState, TurnPosition } from "./types";
import { hasCombatWork } from "./attack";
import { legalBuilds } from "./construction";
import { atWarNow, resetFrontOptions } from "./frontoptions";
import { legalGrants } from "./grants";
import { hasAirWork, loseUnusedGroundSupport } from "./air-missions";
import { newAirTurn } from "./air-record";
import { AIR_MISSIONS_ENABLED } from "./air-rules";
import { hasAirMoveWork } from "./air-work";
import { hasMoveWork } from "./move-action";
import { hasSeaSupplyWork, lapsedDesignations } from "./naval-actions";
import { runYearStartSequence } from "./yearstart";
import { legalDeclarations, scheduledDeclarations } from "./war";

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
  const begun = beginPlayerTurn(ctx, { ...state, position: PLAYER_TURN_START });
  const settled = settle(ctx, begun.state);
  return { state: settled.state, events: [...begun.events, ...settled.events] };
}

/** A Player Turn begins: spending starts again from nothing, the air record is started (it keeps the control the turn began with, Ref 20.2), Fortress status is refreshed (Ref 4.8) and the scenario's own declarations of war are made (Ref 10.0, 13.0). */
function beginPlayerTurn(ctx: GameContext, state: GameState): Transition {
  return scheduledDeclarations(ctx, recordUnsupplied(ctx, refreshFortresses(ctx, resetFrontOptions(resetSpending({ ...state, air: newAirTurn(state) })))));
}

/** Moves one position on, doing what leaving the current one does (the Initiative at II.B, the Game Turn changing after the second Player Turn). */
export function advance(ctx: GameContext, state: GameState): Transition {
  const pos = state.position;
  if (!pos) throw new Error("advance: the game has no position (setup, or an old saved game).");
  switch (pos.part) {
    case "year-start": {
      const yss = runYearStartSequence(ctx, state);
      return { state: { ...yss.state, position: { part: "russian-winter" } }, events: yss.events };
    }
    case "russian-winter":
      return { state: { ...state, position: { part: "turn-order" } }, events: [] };
    case "turn-order": {
      const firstSide = determineInitiative(state);
      const began = beginPlayerTurn(ctx, { ...state, firstSide, activeSide: firstSide, position: PLAYER_TURN_START });
      return {
        state: began.state,
        events: [
          { type: "INITIATIVE_DETERMINED", year: state.year, season: state.season, firstSide, ...initiativeTotals(state) },
          { type: "PLAYER_TURN_STARTED", year: state.year, season: state.season, side: firstSide },
          ...began.events,
        ],
      };
    }
    case "player-turn": {
      const step = nextStepId(pos.step);
      if (step) {
        // Leaving 7h: ground support committed to a hex that was not attacked is lost (Ref 20.41).
        const lost = pos.step === "7h" ? loseUnusedGroundSupport(state) : { state, events: [] };
        // Leaving 6e: supply is read again, after the fleets have been named (Ref 19.1; spec 12 R8): the new list of the units cut off replaces
        // the one taken when the turn began. Nothing changes while the supply effects are off. TODO(verify) (N14, N34): the end-of-turn elimination then reads this list.
        const read = pos.step === "6e" ? recordUnsupplied(ctx, lost.state) : lost.state;
        return { state: { ...read, position: { ...pos, step } }, events: lost.events };
      }
      const lapsed = lapsedDesignations(ctx, state); // a sea supply that no longer holds is reported before the units it fed are judged
      const ended = eliminateUnsupplied(ctx, state); // Ref 19.4, 11.74: the Player Turn is over
      const next = pos.turn === 1 ? secondPlayerTurn(ctx, ended.state) : endGameTurn(ended.state);
      return { state: next.state, events: [...lapsed, ...ended.events, ...next.events] };
    }
  }
}

function secondPlayerTurn(ctx: GameContext, state: GameState): Transition {
  const side = otherSide(state.firstSide);
  const began = beginPlayerTurn(ctx, { ...state, activeSide: side, position: { part: "player-turn", turn: 2, step: FIRST_STEP } });
  return { state: began.state, events: [{ type: "PLAYER_TURN_STARTED", year: state.year, season: state.season, side }, ...began.events] };
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

/** Whether the side to move has anything to do at a step whose rules are built. */
function hasWork(ctx: GameContext, state: GameState, id: string): boolean {
  switch (id) {
    case FIRST_STEP:
      return legalDeclarations(ctx, state).length > 0;
    case "6f":
      return hasMoveWork(ctx, state) || hasAirMoveWork(ctx, state);
    case "6e":
    case "9f":
      return hasSeaSupplyWork(ctx, state);
    case "7b":
      return AIR_MISSIONS_ENABLED && hasAirWork(ctx, state);
    case "7h":
      return hasCombatWork(ctx, state);
    case "3":
      return atWarNow(state);
    case "8b":
      return legalBuilds(ctx, state).length > 0;
    case "9a":
      return legalGrants(state).length > 0;
    default:
      return true;
  }
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
    const waits = implemented.has(id) && (ctx.implementedSteps !== undefined || hasWork(ctx, state, id));
    if (state.position.part === "player-turn" && waits) break;
    const moved = advance(ctx, state);
    if (waits) flush();
    else passed.push(id);
    if (moved.events.length > 0) flush();
    events.push(...moved.events);
    state = moved.state;
  }
  flush();
  return { state, events };
}
