import { MAP } from "../data/map";
import { applyAction, type Action, type GameEvent } from "../engine/actions";
import { AutoSetupError, autoSetupOwner } from "../engine/autosetup";
import type { GameContext } from "../engine/context";
import { newGame } from "../engine/game";
import { OWNER_NAMES, POWER_NAMES } from "../engine/nations";
import type { UnitSpec } from "../engine/placement";
import { currentSetupOwner, poolSpecs, sideOfOwner } from "../engine/setup";
import type { ForceOwner, GameState, PowerId, Scenario, Side, UnitType } from "../engine/types";
import { cap, nameOf, sideName } from "./format";

/**
 * Everything that makes up one game being played in the browser, in one object, and the game-flow
 * helpers that work on it. No DOM here; the rules themselves stay in src/engine.
 */

/** A safety stop for the computer's setup loop: more nations than any scenario has. */
const MAX_SETUP_OWNERS = 20;

/** What a tap on the map does during your setup: put the chosen counter down, or pick one up. */
export type TapMode = "place" | "remove";

/** A build chosen at step 8b: who builds which counter. */
export interface BuildPick {
  owner: PowerId;
  type: UnitType;
  strength: number;
}

/** A counter in a setup pool, with how many are left. */
export type PoolSpec = UnitSpec & { movement?: number; count: number };

export interface Session {
  ctx: GameContext;
  state: GameState;
  humanSide: Side;
  /** The game's seed; the computer's tie-breaks use it too, so a game replays the same. */
  seed: number;
  log: string[];
  /** The counter chosen to place next, if any. */
  selected: UnitSpec | null;
  mode: TapMode;
  /** The last thing the rules refused, shown under the setup panel. */
  toast: string;
  /** The nation the map was last zoomed to, so it zooms once per nation and then stays where you put it. */
  focusedOwner: ForceOwner | null;
  /** Whether the fold-out of declarations or grants is open: it stays open while you make several. */
  foldOpen: boolean;
  /** The counter chosen to build at step 8b (its places are outlined on the map), or null. */
  build: BuildPick | null;
  /** The hex of the stack chosen to move at step 6f (its destinations are outlined), or null. */
  moveFrom?: string | null;
}

/** A new game in `scenario` with the human on `side`; the computer's nations are already set up. */
export function createSession(scenario: Scenario, side: Side, seed: number): Session {
  const session: Session = {
    ctx: { map: MAP, scenario },
    state: newGame(scenario, seed),
    humanSide: side,
    seed,
    log: [`${scenario.name} started. You play the ${sideName(side)} side; the computer sets up the other.`],
    selected: null,
    mode: "place",
    toast: "",
    focusedOwner: null,
    foldOpen: false,
    build: null,
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
    case "STEPS_PASSED":
      return null;
    case "UNIT_BUILT":
      return `${POWER_NAMES[e.owner]} builds a ${e.strength}-factor ${e.unitType} at ${e.at} (${e.cost} BRPs).`;
    case "FRONT_OPTION_SELECTED":
      return `${sideName(e.side)} choose the ${cap(e.option)} Option on the ${cap(e.front)} Front${e.cost > 0 ? ` (${e.cost} BRPs)` : ""}.`;
    case "BRPS_GRANTED":
      return `${POWER_NAMES[e.from]} grants ${e.amount} BRPs to ${POWER_NAMES[e.to]}.`;
    case "BRPS_CHANGED":
      return `${POWER_NAMES[e.nation]}: ${e.delta} BRPs (${e.reason}), ${e.total} left.`;
    case "WAR_DECLARED":
      return `${POWER_NAMES[e.by]} declares war on ${nameOf(e.on)} (${e.cost} BRPs).`;
    case "COMBAT_RESOLVED":
      return `Attack on ${e.target}: ${e.attackFactors} against ${e.defenseFactors} x${e.multiplier}; ${e.rounds.map((r) => `${r.column ?? "no"} column, ${r.roll ?? "no roll"}: ${r.result}`).join("; ")} (${e.outcome}).`;
    case "UNIT_ELIMINATED":
      return `${OWNER_NAMES[e.owner]} unit ${e.unitId} at ${e.at} is eliminated.`;
    case "LOSSES_CHOSEN":
      return `${sideName(e.side)} chooses losses: ${e.units.join(", ")}.`;
    case "UNITS_MOVED":
      return `${e.units.join(", ")} move from ${e.from} to ${e.to}.`;
    case "UNITS_ADVANCED":
      return `${e.units.join(", ")} advance into ${e.to}.`;
    case "HEX_CONTROL_CHANGED":
      return `${nameOf(e.to)} takes control of ${e.hex}.`;
    case "OVERSTACK_ELIMINATED":
      return `${nameOf(e.owner)} loses a unit at ${e.at} to overstacking.`;
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

/**
 * Finishes the nation now up, keeping what is placed. Where the rules leave no way to finish with
 * everything kept, the automatic setup takes back the counters in the way and the toast says so;
 * if it cannot finish at all the toast says that, and nothing changes.
 */
export function placeTheRest(s: Session): boolean {
  let actions: Action[];
  try {
    actions = autoSetupOwner(s.ctx, s.state);
  } catch (e) {
    if (!(e instanceof AutoSetupError)) throw e;
    s.toast = e.message;
    return false;
  }
  const takenBack = actions.filter((a) => a.type === "SETUP_REMOVE").length;
  if (!run(s, ...actions)) return false;
  if (takenBack > 0) {
    s.toast = `To fit the rest, ${takenBack} counter${takenBack === 1 ? "" : "s"} you had placed ${takenBack === 1 ? "was" : "were"} taken back and set down somewhere else.`;
  }
  return true;
}

/** The computer sets up its nations (a placeholder for its own choices) until a nation of yours is up. */
export function computerSetup(s: Session): void {
  for (let guard = 0; guard < MAX_SETUP_OWNERS && s.state.phase === "setup"; guard++) {
    const owner = currentSetupOwner(s.state)!;
    if (sideOfOwner(owner) === s.humanSide) break;
    if (!placeTheRest(s)) break;
  }
}

export const specKey = (s: Pick<UnitSpec, "type" | "strength" | "nationality">) => `${s.type}:${s.strength}:${s.nationality ?? ""}`;

/** The counter to place next: the one chosen, or else the first still in the pool. */
export function currentSpec(s: Session, owner: ForceOwner): PoolSpec | null {
  const specs = poolSpecs(s.state, owner);
  return specs.find((p) => s.selected && specKey(p) === specKey(s.selected)) ?? specs[0] ?? null;
}

/** Your nation that is setting up, and the counter that would be placed next. */
export interface SetupView {
  owner: ForceOwner;
  spec: PoolSpec | null;
}

/** The setup view, computed once per draw and shared by the HTML, the click handlers and the map; null unless a nation of yours is setting up. */
export function setupView(s: Session): SetupView | null {
  const owner = currentSetupOwner(s.state);
  return owner !== null && sideOfOwner(owner) === s.humanSide ? { owner, spec: currentSpec(s, owner) } : null;
}
