import type { GameEvent } from "./action-types";
import type { GameContext } from "./context";
import { resetSpending } from "./brps";
import { settleConquests } from "./conquest";
import { checkMinorDuties } from "./minors-duty";
import { releaseKept } from "./conquest-kept";
import { fortressChanges, refreshFortresses } from "./fortress";
import { eliminateUnsupplied, recordUnsupplied } from "./supply-effects";
import { settleItalySurrender } from "./conquest-italy-fall";
import { determineInitiative, initiativeTotals, nextTurn, otherSide, turnIndex } from "./game";
import { FIRST_STEP, IMPLEMENTED_STEPS, nextStepId } from "./sequence";
import type { GameState, TurnPosition } from "./types";
import { hasCombatWork } from "./attack";
import { hasExploitCombatWork, hasExploitMoveWork } from "./exploit-step";
import { hasMinorPlaceWork } from "./minors-step";
import { wakeSleepers } from "./minors-wake";
import { hasPlaceWork, lapseBreakthroughs } from "./breakthrough";
import { legalBuilds } from "./construction";
import { legalSiberian } from "./victory-actions";
import { atWarNow, resetFrontOptions } from "./frontoptions";
import { legalGrants } from "./grants";
import { hasAirWork, loseUnusedGroundSupport } from "./air-missions";
import { newAirTurn } from "./air-record";
import { AIR_MISSIONS_ENABLED } from "./air-rules";
import { hasAirMoveWork } from "./air-work";
import { hasOverstackWork } from "./overstack-action";
import { hasAttritionWork } from "./attrition-step";
import { hasSrWork } from "./sr-action";
import { hasMoveWork } from "./move-action";
import { hasSeaSupplyWork, lapsedDesignations } from "./naval-actions";
import { recordCheckpoint, evaluateVictory } from "./victory";
import { runYearStartSequence } from "./yearstart";
import { legalDeclarations, scheduledDeclarations } from "./war";
import { enterWinter } from "./winter";
import { winterAsking } from "./winter-record";
import { surrenderAsking } from "./soviet-record";
import { offerSurrender, settleSoviet } from "./soviet-surrender";

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
  const refreshed = refreshFortresses(ctx, resetFrontOptions(resetSpending({ ...state, air: newAirTurn(state) })));
  const declared = scheduledDeclarations(ctx, recordUnsupplied(ctx, refreshed));
  // Spec 16 R31: report the refresh once, at the Player Turn boundary.
  return { state: declared.state, events: [...fortressChanges(ctx, state, refreshed), ...declared.events] };
}

/** Moves one position on, doing what leaving the current one does (the Initiative at II.B, the Game Turn changing after the second Player Turn). */
export function advance(ctx: GameContext, state: GameState): Transition {
  const pos = state.position;
  if (!pos) throw new Error("advance: the game has no position (setup, or an old saved game).");
  switch (pos.part) {
    case "year-start": {
      const yss = runYearStartSequence(ctx, state);
      const entered = enterWinter(ctx, yss.state);
      return { state: entered.state, events: [...yss.events, ...entered.events] };
    }
    case "russian-winter":
      // II.A waits only while the Allies are asked whether the winter waits (CHOOSE_WINTER, spec 14 R10); `settle` stops there, so this is reached once they have answered.
      if (winterAsking(state)) throw new Error("advance: the Allies have not said whether the Russian winter waits (step II.A).");
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
      // 10a waits only while the Axis is asked about Russia's offer to surrender (SURRENDER_ANSWER); `settle` stops there, so this is reached once they have answered.
      if (surrenderAsking(state)) throw new Error("advance: the Axis have not answered Russia's offer to surrender (step 10a).");
      const step = nextStepId(pos.step);
      if (step) {
        // Leaving 7h: ground support committed to a hex that was not attacked is lost (Ref 20.41), and armor not placed into a Breakthrough hex no longer can be (spec 16 R11).
        const lost = pos.step === "7h" ? loseUnusedGroundSupport(lapseBreakthroughs(state)) : { state, events: [] };
        // Leaving 6e: supply is read again, after the fleets have been named (Ref 19.1; spec 12 R8): the new list of the units cut off replaces
        // the one taken when the turn began. Nothing changes while the supply effects are off. TODO(verify) (N14, N34): the end-of-turn elimination then reads this list.
        const read = pos.step === "6e" ? recordUnsupplied(ctx, lost.state) : lost.state;
        // Leaving 7p: the end of the side's Combat Phase. A Major Power of this side whose capital is still held by the enemy is conquered (spec 14 R4, C8).
        // This is in `advance`, so it runs however the turn got here, with or without anything to do at 7h; a conquest that decides the game ends it here.
        const fell = pos.step === "7p" ? endCombatPhase(ctx, read) : { state: read, events: [] };
        // Arriving at 10a: at the end of an Allied Player Turn Russia may offer to surrender (spec 14 R7b); the game then waits there for the Axis.
        const offered = step === "10a" ? offerSurrender(ctx, fell.state) : { state: fell.state, events: [] };
        // Leaving 1 for 2: the Axis Minor-Allies wake up in Summer 1941, before the armies of newly activated allies are set up at 2 (spec 15 R9, MC9).
        const woke = pos.step === FIRST_STEP ? wakeSleepers(ctx, { ...offered.state, position: { ...pos, step } }) : { state: { ...offered.state, position: { ...pos, step } }, events: [] };
        return { state: woke.state, events: [...lost.events, ...fell.events, ...offered.events, ...woke.events] };
      }
      const lapsed = lapsedDesignations(ctx, state); // a sea supply that no longer holds is reported before the units it fed are judged
      const eliminated = eliminateUnsupplied(ctx, state); // Ref 19.4, 11.74: the Player Turn is over
      // After a refusal, the last Russian factor inside Russia may just have gone (spec 14 R7d, V20); a conquest that decides the game ends it here.
      const russia = settleSoviet(ctx, eliminated.state);
      const ended = { state: russia.state, events: [...eliminated.events, ...russia.events] };
      if (ended.state.phase !== "player-turn") return { state: ended.state, events: [...lapsed, ...ended.events] };
      const next = pos.turn === 1 ? secondPlayerTurn(ctx, ended.state) : endGameTurn(ctx, ended.state);
      return { state: next.state, events: [...lapsed, ...ended.events, ...next.events] };
    }
  }
}

/** Leaving 7p: the Major Powers and minor countries that fall now (spec 14 R4, R9), then Italy if it surrenders (R6), then, after a refusal, Russia if its last factor inside Russia is gone (R7d). Stops as soon as a fall ends the game. */
function endCombatPhase(ctx: GameContext, state: GameState): Transition {
  const duties = checkMinorDuties(ctx, state); // Spec 15 R4, R7: the duty of a declaration on a minor is checked first (it can remove a minor's army)
  const fell = settleConquests(ctx, duties.state);
  const italy = settleItalySurrender(ctx, fell.state); // the end of the Axis Combat Phase only (spec 14 R6, ticket 14-8)
  const russia = settleSoviet(ctx, italy.state); // does nothing once a fall has ended the game
  return { state: russia.state, events: [...duties.events, ...fell.events, ...italy.events, ...russia.events] };
}

function secondPlayerTurn(ctx: GameContext, state: GameState): Transition {
  const side = otherSide(state.firstSide);
  const began = beginPlayerTurn(ctx, { ...state, activeSide: side, position: { part: "player-turn", turn: 2, step: FIRST_STEP } });
  return { state: began.state, events: [{ type: "PLAYER_TURN_STARTED", year: state.year, season: state.season, side }, ...began.events] };
}

/** Both Player Turns are done: the Campaign's checkpoint is read, then the scenario ends with its result (Ref 2.0), or the next Game Turn begins at its first part. */
function endGameTurn(ctx: GameContext, from: GameState): Transition {
  // Kept hexes whose hostile unit left during the Game Turn pass on before the checkpoint and the result read control (ticket 14-25, TODO(verify) V62).
  const freed = releaseKept(ctx, from);
  const state = recordCheckpoint(ctx, freed.state);
  if (turnIndex(state) >= turnIndex(state.lastTurn)) {
    const result = evaluateVictory(ctx, state, "end-of-play");
    return { state: { ...state, phase: "game-over", result }, events: [...freed.events, { type: "GAME_OVER", year: state.year, season: state.season, result }] };
  }
  const turn = nextTurn(state);
  // A Spring turn begins with the Year Start Sequence; any other begins at II.A, where a Winter turn looks at the Russian winter (and may roll and ask).
  if (turn.season === "spring") return { state: { ...state, ...turn, position: { part: "year-start" } }, events: freed.events };
  const winter = enterWinter(ctx, { ...state, ...turn });
  return { state: winter.state, events: [...freed.events, ...winter.events] };
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
    case "6g":
    case "9j":
      return hasOverstackWork(ctx, state);
    case "9e":
      return hasSrWork(ctx, state);
    case "7a":
    case "7p":
      return hasAttritionWork(ctx, state);
    case "7b":
      return AIR_MISSIONS_ENABLED && hasAirWork(ctx, state);
    case "7h":
      return hasCombatWork(ctx, state) || hasPlaceWork(ctx, state);
    case "7j":
      return hasExploitMoveWork(ctx, state);
    case "7o":
      return hasExploitCombatWork(ctx, state);
    case "2":
      return hasMinorPlaceWork(ctx, state);
    case "3":
      return atWarNow(state);
    case "8a":
      return legalSiberian(ctx, state).length > 0;
    case "8b":
      return legalBuilds(ctx, state).length > 0;
    case "10a":
      return surrenderAsking(state);
    case "9a":
      return legalGrants(ctx, state).length > 0;
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
    if (winterAsking(state)) break; // II.A: the game waits for the Allies' answer about the Russian winter (CHOOSE_WINTER)
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
