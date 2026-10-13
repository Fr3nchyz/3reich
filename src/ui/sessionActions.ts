import type { Action } from "../engine/actions";
import type { MapHex } from "../engine/map";
import { placementPlaces, type UnitSpec } from "../engine/placement";
import { currentSetupOwner, sideOfOwner } from "../engine/setup";
import type { ForceOwner, OffMapBox } from "../engine/types";
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
}

/** A tap on a map hex during setup: place the chosen counter there, or take the top one back. */
export function tapHex(s: Session, h: MapHex): void {
  s.toast = "";
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

/** A turn button: apply one of the legal actions that were on offer. */
export function takeAction(s: Session, action: Action): void {
  s.toast = "";
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
