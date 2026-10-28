import { territoryOf } from "../engine/areas";
import { placementPlaces } from "../engine/placement";
import type { ForceOwner } from "../engine/types";
import type { Session, SetupView } from "./session";
import type { MapView } from "./mapView";
import { airMarks } from "./airMove";
import { airMoveNow, airYellow } from "./airMoveTap";
import { fromMarks, moveMarksOf } from "./moveMarks";
import { moveFurther, moveTargets, selectionNow } from "./moveTap";
import { redeployTargets, selectionNow as redeployNow } from "./redeployTap";
import { shownOnMap } from "./attackSync";
import { builds, siberianOffers } from "./sessionActions";
import { buildKey, pickOf } from "./buildView";
import { syncAttackMarks } from "./attackSync";
import type { Action } from "../engine/actions";

/** Brings the map in line with the session after each change: counters, zoom and highlights. */

/** The hexes to outline: your own counters when taking back, else where the chosen counter may go. */
function highlightedHexes(s: Session, setup: SetupView | null): string[] {
  if (!setup) {
    // Not setting up: where the stack chosen to move can go (step 6f), or the places a chosen build may go.
    if (s.moveChosen) return moveTargets(s);
    if (s.redeploy) return redeployTargets(s);
    if (s.airMove || s.airbase) return airYellow(s);
    const taking = s.siberian;
    if (taking) return siberianOffers(s).filter((a) => a.unit.type === taking.type && a.unit.strength === taking.strength).map((a) => a.at);
    const pick = s.build;
    return pick ? builds(s).filter((a) => buildKey(pickOf(a)) === buildKey(pick) && s.ctx.map.hexes[a.at]).map((a) => a.at) : [];
  }
  const { owner: mine, spec } = setup;
  const onMap = (id: string) => s.ctx.map.hexes[id] !== undefined;
  if (s.mode === "remove") return Object.values(s.state.units).filter((u) => u.owner === mine && onMap(u.at)).map((u) => u.at);
  return spec ? placementPlaces(s.ctx, s.state, mine, spec).filter(onMap) : [];
}

/** The pale ring of the planes card: the hexes the first ticked plane could fly a mission to, less the yellow bases; otherwise the second shade of the ground move. */
function paleHexes(s: Session): string[] {
  const card = s.airMove?.range ? airMoveNow(s) : null;
  return card ? card.range.filter((h) => !card.bases.some((b) => b.hex === h)) : moveFurther(s);
}

/** Zooms to your nation's territory once per nation, and back to the whole map when your setup is over. */
function followSetup(view: MapView, s: Session, mine: ForceOwner | null): void {
  if (mine && s.focusedOwner !== mine) {
    s.focusedOwner = mine;
    view.focus(territoryOf(s.ctx, mine).places);
  } else if (!mine && s.focusedOwner !== null) {
    s.focusedOwner = null;
    view.focus([]);
  }
}

/** Once, when a stack is chosen from the list: the map moves only if the hex or its destinations are out of sight. */
function followChoice(view: MapView, s: Session, shown: (ids: readonly string[]) => boolean): void {
  const c = s.moveChosen;
  if (!c?.focus) return;
  c.focus = false;
  const ids = [c.hex, ...moveTargets(s)];
  if (!shown(ids)) view.focus(ids);
}

/** Once, when a stack is chosen from the redeploy list: the map moves only if the hex or the places it can go are out of sight. */
function followRedeploy(view: MapView, s: Session, shown: (ids: readonly string[]) => boolean): void {
  const c = s.redeploy;
  if (!c?.focus) return;
  c.focus = false;
  const ids = [c.hex, ...redeployTargets(s)];
  if (!shown(ids)) view.focus(ids);
}

/** Once, when planes are chosen from the list: the map moves only if the base or the bases they can go to are out of sight. */
function followAir(view: MapView, s: Session, shown: (ids: readonly string[]) => boolean): void {
  const c = s.airMove;
  if (!c?.focus) return;
  c.focus = false;
  const ids = [c.hex, ...airYellow(s)];
  if (!shown(ids)) view.focus(ids);
}

export function syncMap(view: MapView, s: Session, setup: SetupView | null, actions?: readonly Action[]): void {
  const card = airMoveNow(s);
  const red = redeployNow(s);
  const marks = card ? airMarks(card) : moveMarksOf(red ? { hex: red.hex, lines: red.lines.map((l) => ({ key: l.id, state: l.ticked ? "ticked" : l.can ? "free" : "greyed" })) } : selectionNow(s)); // spec 10, 10-5: rings on ticked counters, a dash on left-behind ones, the chosen hex outlined
  view.setUnits(Object.values(s.state.units), marks.units);
  followSetup(view, s, setup?.owner ?? null);
  view.setHighlights(highlightedHexes(s, setup), paleHexes(s));
  followChoice(view, s, shownOnMap);
  followAir(view, s, shownOnMap);
  followRedeploy(view, s, shownOnMap);
  if (marks.from) view.setAttackMarks(fromMarks(marks)); // the one marks layer: at step 6f it holds the chosen hex, at step 7h the attack marks
  else if (actions) syncAttackMarks(view, s, actions);
}
