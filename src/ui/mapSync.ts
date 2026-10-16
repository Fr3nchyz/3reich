import { territoryOf } from "../engine/areas";
import { placementPlaces } from "../engine/placement";
import type { ForceOwner } from "../engine/types";
import type { Session, SetupView } from "./session";
import type { MapView } from "./mapView";
import { fromMarks, moveMarksOf } from "./moveMarks";
import { moveFurther, moveTargets, selectionNow } from "./moveTap";
import { shownOnMap } from "./attackSync";
import { builds } from "./sessionActions";
import { syncAttackMarks } from "./attackSync";
import type { Action } from "../engine/actions";

/** Brings the map in line with the session after each change: counters, zoom and highlights. */

/** The hexes to outline: your own counters when taking back, else where the chosen counter may go. */
function highlightedHexes(s: Session, setup: SetupView | null): string[] {
  if (!setup) {
    // Not setting up: where the stack chosen to move can go (step 6f), or the places a chosen build may go.
    if (s.moveChosen) return moveTargets(s);
    const pick = s.build;
    return pick ? builds(s).filter((a) => a.owner === pick.owner && a.unit.type === pick.type && a.unit.strength === pick.strength && s.ctx.map.hexes[a.at]).map((a) => a.at) : [];
  }
  const { owner: mine, spec } = setup;
  const onMap = (id: string) => s.ctx.map.hexes[id] !== undefined;
  if (s.mode === "remove") return Object.values(s.state.units).filter((u) => u.owner === mine && onMap(u.at)).map((u) => u.at);
  return spec ? placementPlaces(s.ctx, s.state, mine, spec).filter(onMap) : [];
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

export function syncMap(view: MapView, s: Session, setup: SetupView | null, actions?: readonly Action[]): void {
  const marks = moveMarksOf(selectionNow(s)); // spec 10, 10-5: rings on ticked counters, a dash on left-behind ones, the chosen hex outlined
  view.setUnits(Object.values(s.state.units), marks.units);
  followSetup(view, s, setup?.owner ?? null);
  view.setHighlights(highlightedHexes(s, setup), moveFurther(s));
  followChoice(view, s, shownOnMap);
  if (marks.from) view.setAttackMarks(fromMarks(marks)); // the one marks layer: at step 6f it holds the chosen hex, at step 7h the attack marks
  else if (actions) syncAttackMarks(view, s, actions);
}
