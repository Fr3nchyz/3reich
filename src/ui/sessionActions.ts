import { legalActions, type Action } from "../engine/actions";
import type { MapHex } from "../engine/map";
import { placementPlaces, type UnitSpec } from "../engine/placement";
import { currentSetupOwner, sideOfOwner } from "../engine/setup";
import type { ForceOwner, OffMapBox } from "../engine/types";
import { winterKey } from "../engine/winter-record";
import { computerToMove } from "./computerPlay";
import { normaliseAirMove, tapToAirMove } from "./airMoveTap";
import { normaliseAir, tapToAir } from "./airTap";
import { normaliseAttack, tapToAttack } from "./attackTap";
import { normaliseChoice } from "./choiceTap";
import { normaliseMove, tapToMove } from "./moveTap";
import { buildKey, parseBuildKey } from "./buildView";
import { computerSetup, currentSpec, placeTheRest, run, type Session, type TapMode } from "./session";

/**
 * What each tap or click does to the session. The caller draws again afterwards. No DOM here, and
 * no rules: every change to the game goes through the engine's actions.
 */

const unitsOf = (s: Session, owner: ForceOwner) => Object.values(s.state.units).filter((u) => u.owner === owner);

/** With nothing of yours on the map there is nothing to take back, so a leftover "remove" mode falls back to "place". */
export function normaliseMode(s: Session): void {
  const owner = currentSetupOwner(s.state);
  if (s.mode === "remove" && !Object.values(s.state.units).some((u) => u.owner === owner)) s.mode = "place";
  // A chosen build is dropped once it is no longer on offer (step left, counter used up, BRPs spent).
  if (s.build && !builds(s).some((a) => buildKey({ owner: a.owner, type: a.unit.type, strength: a.unit.strength }) === buildKey(s.build!))) s.build = null;
  normaliseAttack(s);
  normaliseAir(s);
  normaliseAirMove(s);
  normaliseChoice(s);
  normaliseMove(s);
}

type Build = Extract<Action, { type: "BUILD" }>;

/** The builds on offer now (step 8b). */
export const builds = (s: Session): Build[] => (s.state.phase === "player-turn" ? legalActions(s.ctx, s.state).filter((a): a is Build => a.type === "BUILD") : []);

/** A construction chip, given as the "owner:type:strength" key on the button. */
export function pickBuild(s: Session, key: string): void {
  s.build = parseBuildKey(key);
  s.toast = "";
}

/** "Build in the U.S. Box": put the chosen build off the map. */
export function buildInBox(s: Session, box: OffMapBox): void {
  s.toast = "";
  if (s.build) run(s, { type: "BUILD", owner: s.build.owner, unit: { type: s.build.type, strength: s.build.strength }, at: box });
}

/**
 * Looking at a hex (spec 07, part A) is separate from what a tap does: it only sets `lookedAt`, which the hex card reads. It never
 * touches the stack chosen to move, the chosen build, the chosen setup counter or the game, and it is not done during setup.
 */
export function lookAt(s: Session, hex: string): void {
  if (s.state.phase !== "setup") s.lookedAt = hex;
}

/** The hex card's close button. */
export function closeLook(s: Session): void {
  s.lookedAt = null;
}

/** A tap on a map hex: it looks at the hex, and does what the step asks (move, build, place or take back a counter). */
export function tapHex(s: Session, h: MapHex): void {
  s.toast = "";
  lookAt(s, h.id);
  if (s.state.phase === "player-turn") {
    if (!computerToMove(s) && !tapToAirMove(s, h) && !tapToMove(s, h) && !tapToAttack(s, h) && !tapToAir(s, h)) tapToBuild(s, h);
    return;
  }
  const owner = currentSetupOwner(s.state);
  if (!owner || sideOfOwner(owner) !== s.humanSide) return;
  if (s.mode === "remove") {
    const top = unitsOf(s, owner).filter((u) => u.at === h.id).pop();
    if (top) run(s, { type: "SETUP_REMOVE", owner, unitId: top.id });
    else s.toast = "You have no counter there. Tap a hex that shows one of yours.";
    return;
  }
  const spec = currentSpec(s, owner);
  const places = spec ? new Set(placementPlaces(s.ctx, s.state, owner, spec)) : new Set<string>();
  if (spec && places.has(h.id)) {
    run(s, { type: "SETUP_PLACE", owner, unit: { type: spec.type, strength: spec.strength, ...(spec.nationality ? { nationality: spec.nationality } : {}) }, at: h.id });
  } else {
    s.toast = spec ? `A ${spec.strength}-factor ${spec.type} cannot go there. The yellow hexes are the places it can.` : "Nothing left to place.";
  }
}

/** A tap on a map hex at step 8b: build the chosen counter there. */
function tapToBuild(s: Session, h: MapHex): void {
  if (!s.build) return;
  const { owner, type, strength } = s.build;
  if (builds(s).some((a) => a.owner === owner && a.unit.type === type && a.unit.strength === strength && a.at === h.id)) {
    run(s, { type: "BUILD", owner, unit: { type, strength }, at: h.id });
  } else {
    s.toast = `A ${strength}-factor ${type} cannot be built there. The yellow hexes are the places it can.`;
  }
}

/** A turn button: apply one of the legal actions that were on offer. */
export function takeAction(s: Session, action: Action): void {
  s.toast = "";
  s.foldOpen = action.type === "DECLARE_WAR" || action.type === "GRANT_BRPS" || action.type === "SELECT_FRONT_OPTION";
  if (action.type !== "BUILD") s.build = null;
  s.moveChosen = null;
  s.airMove = null;
  s.airbase = null;
  if (action.type === "CHOOSE_WINTER") s.winterSeen = winterKey(s.state); // the player answered: the winter that starts needs no card
  s.undo = null; // any step button that is not a move ends what "Take back last move" can undo (spec 10, 10-6)
  run(s, action);
}

/** The "Place counters" / "Take counters back" switch. */
export function setMode(s: Session, mode: TapMode): void {
  s.mode = mode;
  s.toast = "";
}

/** A counter chip, given as the "type:strength:nationality" key on the button. */
export function pickSpec(s: Session, key: string): void {
  const [type, strength, nationality] = key.split(":");
  s.selected = { type: type as UnitSpec["type"], strength: Number(strength), ...(nationality ? { nationality: nationality as UnitSpec["nationality"] } : {}) };
  s.mode = "place";
  s.toast = "";
}

/** "Place in the U.S. Box" and the like: put the chosen counter off the map. */
export function placeInBox(s: Session, owner: ForceOwner, spec: UnitSpec | null, box: OffMapBox): void {
  if (spec) run(s, { type: "SETUP_PLACE", owner, unit: { type: spec.type, strength: spec.strength }, at: box });
}

/** "Take back the last one". */
export function undoLast(s: Session, owner: ForceOwner): void {
  const last = unitsOf(s, owner).pop();
  s.toast = "";
  if (last) run(s, { type: "SETUP_REMOVE", owner, unitId: last.id });
}

function nextCounter(s: Session): void {
  s.selected = null;
  s.mode = "place";
  computerSetup(s);
}

/** "Place the rest for me". */
export function fillRest(s: Session): void {
  s.toast = "";
  placeTheRest(s);
  const toast = s.toast;
  nextCounter(s);
  s.toast = toast;
}

/** "Done with <nation>": hand over to the next nation if the rules accept this setup. */
export function finishOwner(s: Session, owner: ForceOwner): void {
  s.toast = "";
  if (run(s, { type: "SETUP_DONE", owner })) nextCounter(s);
}
