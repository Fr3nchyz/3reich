import type { MapData } from "./map";
import type { Scenario } from "./types";

/**
 * The static data a game is played on: the map and the scenario definition. It never changes
 * during a game and is not part of GameState (which holds only what play changes), so it is
 * passed alongside the state. The engine imports no data itself; callers supply it.
 */
export interface GameContext {
  map: MapData;
  scenario: Scenario;
}
