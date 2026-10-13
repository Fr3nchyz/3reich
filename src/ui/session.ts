import { MAP } from "../data/map";
import { applyAction, type Action, type GameEvent } from "../engine/actions";
import { autoSetupOwner } from "../engine/autosetup";
import type { GameContext } from "../engine/context";
import { newGame } from "../engine/game";
import { OWNER_NAMES } from "../engine/nations";
import type { UnitSpec } from "../engine/placement";
import { currentSetupOwner, poolSpecs, sideOfOwner } from "../engine/setup";
import type { ForceOwner, GameState, Scenario, Side } from "../engine/types";
import { cap, sideName } from "./format";

/**
 * Everything that makes up one game being played in the browser, in one object, and the game-flow
 * helpers that work on it. No DOM here; the rules themselves stay in src/engine.
 */

/** What a tap on the map does during your setup: put the chosen counter down, or pick one up. */
export type TapMode = "place" | "remove";

/** A counter in a setup pool, with how many are left. */
export type PoolSpec = UnitSpec & { movement?: number; count: number };

export interface Session {
  ctx: GameContext;
  state: GameState;
  humanSide: Side;
  log: string[];
  /** The counter chosen to place next, if any. */
  selected: UnitSpec | null;
  mode: TapMode;
  /** The last thing the rules refused, shown under the setup panel. */
  toast: string;
  /** The nation the map was last zoomed to, so it zooms once per nation and then stays where you put it. */
  focusedOwner: ForceOwner | null;
}

/** A new game in `scenario` with the human on `side`; the computer's nations are already set up. */
export function createSession(scenario: Scenario, side: Side, seed: number): Session {
  const session: Session = {
    ctx: { map: MAP, scenario },
    state: newGame(scenario, seed),
    humanSide: side,
    log: [`${scenario.name} started. You play the ${sideName(side)} side; the computer sets up the other.`],
    selected: null,
    mode: "place",
    toast: "",
    focusedOwner: null,
  };
  computerSetup(session);
  return session;
}

function describeEvent(e: GameEvent): string | null {
  switch (e.type) {
    case "UNIT_PLACED":
    case "UNIT_REMOVED":
      return null;
    case "SETUP_OWNER_DONE":
      return `${OWNER_NAMES[e.owner]} has set up.`;
    case "SETUP_COMPLETE":
      return "Setup is complete.";
    case "INITIATIVE_DETERMINED":
      return `${cap(e.season)} ${e.year}: ${cap(e.firstSide)} take the initiative (Axis ${e.axis} BRPs, Allies ${e.allies}).`;
    case "PLAYER_TURN_STARTED":
      return `${sideName(e.side)} player turn begins.`;
    case "GAME_OVER":
      return `The scenario ends after ${cap(e.season)} ${e.year}.`;
  }
}

/** Applies actions in order, logging what happened; stops at the first one the rules refuse. */
export function run(s: Session, ...actions: Action[]): boolean {
  for (const action of actions) {
    const result = applyAction(s.ctx, s.state, action);
    if (!result.ok) {
      s.toast = result.error;
      return false;
    }
    s.state = result.state;
    for (const e of result.events) {
      const line = describeEvent(e);
      if (line) s.log.push(line);
    }
  }
  return true;
}

/** The computer sets up its nations (a placeholder for its own choices) until a nation of yours is up. */
export function computerSetup(s: Session): void {
  for (let guard = 0; guard < 20 && s.state.phase === "setup"; guard++) {
    const owner = currentSetupOwner(s.state)!;
    if (sideOfOwner(owner) === s.humanSide) break;
    run(s, ...autoSetupOwner(s.ctx, s.state));
  }
}

/** The setup owner if it is one of yours, else null: the only time the setup panel and map highlights show. */
export function yourSetupOwner(s: Session): ForceOwner | null {
  const owner = currentSetupOwner(s.state);
  return owner !== null && sideOfOwner(owner) === s.humanSide ? owner : null;
}

export const specKey = (s: Pick<UnitSpec, "type" | "strength" | "nationality">) => `${s.type}:${s.strength}:${s.nationality ?? ""}`;

/** The counter to place next: the one chosen, or else the first still in the pool. */
export function currentSpec(s: Session, owner: ForceOwner): PoolSpec | null {
  const specs = poolSpecs(s.state, owner);
  return specs.find((p) => s.selected && specKey(p) === specKey(s.selected)) ?? specs[0] ?? null;
}
