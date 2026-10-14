import { territoryOf } from "../engine/areas";
import { placementPlaces } from "../engine/placement";
import type { ForceOwner } from "../engine/types";
import type { Session, SetupView } from "./session";
import type { MapView } from "./mapView";
import { builds } from "./sessionActions";

/** Brings the map in line with the session after each change: counters, zoom and highlights. */

/** The hexes to outline: your own counters when taking back, else where the chosen counter may go. */
function highlightedHexes(s: Session, setup: SetupView | null): string[] {
  if (!setup) {
    // Not setting up: the places a chosen build may go.
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

export function syncMap(view: MapView, s: Session, setup: SetupView | null): void {
  view.setUnits(Object.values(s.state.units));
  followSetup(view, s, setup?.owner ?? null);
  view.setHighlights(highlightedHexes(s, setup));
}
