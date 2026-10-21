import { MAP } from "../data/map";
import { applyAction, type Action, type GameEvent } from "../engine/actions";
import { AutoSetupError, autoSetupOwner } from "../engine/autosetup";
import type { GameContext } from "../engine/context";
import { newGame } from "../engine/game";
import { OWNER_NAMES, POWER_NAMES } from "../engine/nations";
import type { UnitSpec } from "../engine/placement";
import { currentSetupOwner, poolSpecs, sideOfOwner } from "../engine/setup";
import type { ForceOwner, GameState, PowerId, Scenario, Side, UnitType } from "../engine/types";
import { cap, nameOf, sideName, sweepLine } from "./format";
import { unitsWhere } from "./actionLabels";
import { actorSide, eventSide, logLine } from "./logSide";
import type { AirbasePick, AirMoveChoice } from "./airMoveTap";
import type { AirDraft } from "./airTap";
import type { AttackDraft } from "./attackDraft";
import type { ChoiceDraft } from "./choiceTap";
import type { MoveChoice } from "./moveDraft";
import type { MoveUndo } from "./moveUndo";
import { trackBattle, type BattleResult } from "./resultModel";
import { plural } from "./attackText";
import { placeName, stackSummary, unitName, unitsWithIds } from "./names";
import type { WatchInfo } from "./watchController";
import { victoryLine } from "./victoryLine";

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
  /**
   * The side of the log entries that have one, by index (logSide.ts): for the colour of a line only, never saved. An entry not in it is plain.
   * Invariant: `log` is append-only (logLine). Anything that replaces or empties it must clear this too, which resetLog does, or every mark
   * would sit on the wrong line.
   */
  logSides?: Map<number, Side>;
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
  /** The stack chosen to move at step 6f and the units ticked in it (spec 10; the yellow hexes are where the ticked units can go together), or null. Screen state, never saved. */
  moveChosen?: MoveChoice | null;
  /** The player's moves of the current step 6f, for "Take back last move" (spec 10, 10-6; moveUndo.ts). Screen state, never saved; it holds only while the game is still where the last move left it. */
  undo?: MoveUndo | null;
  /** The hex last tapped to look at (spec 07, part A): the hex card shows it. Screen state only, never saved; closing the card clears it. */
  lookedAt?: string | null;
  /** The attack being put together at step 7h (spec 07, part B): the hex and the chosen units. Screen state, never saved. */
  attack?: AttackDraft | null;
  /** The last battle of the player's own attack, for the result card (spec 07, State 3). Screen state, never saved. */
  battle?: BattleResult | null;
  /** The planes chosen at a base at step 6f (spec 09, part D1; the yellow hexes are the bases they can change to). Screen state, never saved. */
  airMove?: AirMoveChoice | null;
  /** The airbase being placed at step 6f (its places are outlined on the map). Screen state, never saved. */
  airbase?: AirbasePick | null;
  /** The ground-support card being put together at step 7b (spec 09, part D2): the hex and the planes chosen. Screen state, never saved. */
  airDraft?: AirDraft | null;
  /** The units picked for the losses of an Exchange or an advance after a battle (spec 07, State 4). Screen state, never saved. */
  choice?: ChoiceDraft | null;
  /** Whether the "Victory and objectives" card is open (spec 14, part D1), and whether it has just opened (its heading then takes the focus). Screen state, never saved. */
  objectivesOpen?: boolean;
  objectivesFresh?: boolean;
  /** An Objective hex the card asked the map to centre on; the map takes it once. Screen state, never saved. */
  mapFocus?: string | null;
  /** The result card (spec 14, part D2): set when "Look at the map" or "Read the log" put it away; `endFresh` when it has just opened. Screen state, never saved. */
  endDismissed?: boolean;
  endFresh?: boolean;
  /** Set while two computers play and the human only watches (spec 06); `humanSide` then means nothing. */
  watch?: WatchInfo;
  /** Every action applied, in order, kept for a watched game so it can be saved and replayed. */
  record?: Action[];
}

/** A new game in `scenario` with the human on `side`, with nothing set up yet. */
export function newSession(scenario: Scenario, side: Side, seed: number): Session {
  return {
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
}

/** A new game in `scenario` with the human on `side`; the computer's nations are already set up. */
export function createSession(scenario: Scenario, side: Side, seed: number): Session {
  const session = newSession(scenario, side, seed);
  computerSetup(session);
  return session;
}

/** `before` is the position the action was made in, where the counters it removes or moves are still found by id (names.ts). */
function describeEvent(e: GameEvent, ctx: GameContext, swept: ReadonlySet<string>, before: GameState): string | null {
  switch (e.type) {
    case "UNIT_PLACED":
    case "UNIT_REMOVED":
      return null;
    case "AIRBASE_PLACED":
      return `${POWER_NAMES[e.owner]} places an airbase at ${placeName(ctx.map, e.at)}.`;
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
    case "UNITS_SWEPT":
      return sweepLine(ctx, e);
    case "COMBAT_RESOLVED":
      if (e.sweep) return null; // the line of the sweep says it
      return `Attack on ${placeName(ctx.map, e.target)}: ${e.attackFactors} against ${e.defenseFactors} x${e.multiplier}; ${e.rounds.map((r) => `${r.column ?? "no"} column, ${r.roll ?? "no roll"}: ${r.result}`).join("; ")} (${e.outcome}).`;
    case "UNIT_ELIMINATED":
      if (swept.has(e.unitId)) return null;
      return `Eliminated${e.reason === "unsupplied" ? " (out of supply)" : ""}: ${before.units[e.unitId] ? unitName(before.units[e.unitId]!) : `${OWNER_NAMES[e.owner]} unit`} in ${placeName(ctx.map, e.at)}.`;
    case "LOSSES_CHOSEN":
      return `${sideName(e.side)} chooses losses: ${unitsWhere(ctx, before, e.units)}.`;
    case "UNITS_MOVED":
      return `${stackSummary(unitsWithIds(before, e.units))} move from ${placeName(ctx.map, e.from)} to ${placeName(ctx.map, e.to)}.`;
    case "AIR_STAGED":
      return `${stackSummary(unitsWithIds(before, e.units))} changed base from ${placeName(ctx.map, e.from)} to ${placeName(ctx.map, e.to)}.`;
    case "AIR_MISSION_DESIGNATED":
      return `${stackSummary(unitsWithIds(before, e.units))} fly ground support to ${placeName(ctx.map, e.target)}.`;
    case "FLEET_DESIGNATED_FOR_SUPPLY":
      return `Supply by sea from ${placeName(ctx.map, e.from)} to ${placeName(ctx.map, e.to)}, carried by ${stackSummary(unitsWithIds(before, e.fleets))}, for ${stackSummary(unitsWithIds(before, e.units))}.`;
    case "SEA_SUPPLY_LAPSED":
      return `The supply by sea from ${placeName(ctx.map, e.from)} to ${placeName(ctx.map, e.to)} no longer holds: ${e.reason}`;
    case "FLEET_DISPLACED": {
      const fleet = before.units[e.unitId];
      const name = fleet ? unitName(fleet) : `${OWNER_NAMES[e.owner]} fleet`;
      return e.to === null ? `${name} at ${placeName(ctx.map, e.from)} was eliminated: ${placeName(ctx.map, e.from)} was taken and no friendly port on its Front has room.` : `${name} moved from ${placeName(ctx.map, e.from)} to ${placeName(ctx.map, e.to)}: ${placeName(ctx.map, e.from)} was taken.`;
    }
    case "GROUND_SUPPORT_LOST":
      return `${plural(e.units.reduce((n, u) => n + u.strength, 0), "air factor")} committed to ${placeName(ctx.map, e.hex)} were lost: the hex was not attacked.`;
    case "AIR_RESHAPED": {
      const side = before.units[e.before[0]!.id];
      return `${side ? `${OWNER_NAMES[side.owner]} air` : "Air"} at ${placeName(ctx.map, e.at)}: ${e.before.map((b) => b.strength).join(" + ")} became ${e.after.map((a) => a.strength).join(" + ")} air factors.`;
    }
    case "UNITS_ADVANCED":
      return `${stackSummary(unitsWithIds(before, e.units))} advance into ${placeName(ctx.map, e.to)}.`;
    case "HEX_CONTROL_CHANGED":
      return `${nameOf(e.to)} takes control of ${e.hex}.`;
    case "OVERSTACK_ELIMINATED":
      return `${nameOf(e.owner)} loses a unit at ${e.at} to overstacking.`;
    case "GAME_OVER":
      return `The scenario ends after ${cap(e.season)} ${e.year}. ${victoryLine(e.result)}`;
  }
}

/** Applies actions in order, logging what happened; stops at the first one the rules refuse. */
export function run(s: Session, ...actions: Action[]): boolean {
  for (const action of actions) {
    const before = s.state;
    const result = applyAction(s.ctx, s.state, action);
    if (!result.ok) {
      s.toast = result.error;
      return false;
    }
    s.state = result.state;
    s.record?.push(action);
    if (!s.watch) s.battle = trackBattle(s.battle ?? null, result.events, before, s.humanSide);
    const actor = actorSide(action);
    const swept = new Set(result.events.flatMap((e) => (e.type === "UNITS_SWEPT" ? e.units.map((u) => u.id) : [])));
    for (const e of result.events) {
      const line = describeEvent(e, s.ctx, swept, before);
      if (line) logLine(s, line, eventSide(e, actor, before));
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
