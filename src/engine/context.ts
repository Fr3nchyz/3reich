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
  /** Steps whose rules are built (default: IMPLEMENTED_STEPS in sequence.ts, which wait only while there is something to do). A test may set it, and then every listed step waits. */
  implementedSteps?: ReadonlySet<string>;
  /** Whether the supply effects apply (Ref 19.4, 11.74, 12.21; supply-effects.ts). Absent: `SUPPLY_EFFECTS_ENABLED`, the shipped setting. Tests and the self-play runner set it to measure the effects without changing what ships. */
  supplyEffects?: boolean;
}
