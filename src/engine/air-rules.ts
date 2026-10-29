import type { HexId } from "./hex";
import { AIR_FACTOR_STACKING_LIMIT } from "./tables";
import { MAX_OCEAN_AIR_STAGE_HEXES } from "./terrain";
import type { ForceOwner } from "./types";

/**
 * The numbers and switches of the air rules (spec 09, part A). Every constant names its rule; the ones the rule text does not
 * settle carry TODO(verify) and are listed in spec 09 part J. Pure data: no behaviour lives here.
 */

/** Air factors one city (a city, port, capital or objective hex) bases (Ref 20.1, 5.0, 4.7). Same number as the setup stacking limit. */
export const AIR_PER_CITY = AIR_FACTOR_STACKING_LIMIT;

/** Air factors an airbase counter adds to its hex (Ref 20.1): 5 on a plain hex, 10 on a city. */
export const AIR_PER_AIRBASE = 5;

/** Movable airbase counters each Major Power owns (Ref 20.1, 11.3). A fixed rule, so it is a constant and not in the scenario files. */
export const AIRBASES_PER_MAJOR_POWER = 3;

/**
 * Whether an airbase may be set down in the opening setup (spec 09 R2, option c: "none, some or all at setup"), before any supply line is
 * worked out. TODO(verify): the supply test is skipped at setup because the position is still being built; a placement at 6f is checked.
 */
export const AIRBASE_AT_SETUP = true;

/**
 * A Capital that holds relocated airbases still bases at most this many air factors (Ref 20.1).
 * TODO(verify): whether the cap is the Capital's own (it is built so: the base cities plus airbases, never more than 10).
 */
export const CAPITAL_AIR_MAX = 10;

/** Staging (rebasing) range in the Movement Phase, in hexes (Ref 20.2, Ops 5.45f). Same number as the ocean-crossing limit in terrain.ts. */
export const STAGING_RANGE = MAX_OCEAN_AIR_STAGE_HEXES;

/** Spec 09 D1 / R9 (Ref 20.2, 20.51): captured planes displace and airbases return to their Capital; false restores the old destruction. */
export const AIR_DISPLACED_ON_CAPTURE = true;

/**
 * An air unit stages (changes base) at most once in a Player Turn (spec 09 R4, option a; like `ONE_MOVE_PER_TURN`).
 * TODO(verify): Ref 20.2 gives the 8-hex range for the Movement Phase as a whole; whether several shorter hops are allowed is not settled.
 */
export const ONE_STAGE_PER_TURN = true;

/**
 * Whether step 7b waits for the player to commit air to Ground Support (spec 09 R8), with its buttons and notes on the screen (ticket 09-14).
 * Off, no air is ever committed and no battle changes. A test names the step in `GameContext.implementedSteps` or sets the position itself.
 */
export const AIR_MISSIONS_ENABLED = true;

/** Air factors counted in a Ground Support attack are at most this many times the ground factors attacking the hex (Ref 20.41). */
export const GS_CAP_MULTIPLE = 3;

/** A mission in the Combat Phase flies to a hex at most this many hexes from the plane's base (Ref 20.41, 20.51); `missionHexes` measures the one-way route. */
export const MISSION_RANGE = 4;

/** Airdrop range of a paratroop unit from its base (Ref 23.1). Not used before the airdrop ticket. */
export const AIRDROP_RANGE = 6;

/**
 * Hexes that hold two cities and so base 10 air factors (15 with an airbase), Ref 20.1. The map data does not mark any, so the list is
 * empty and every city hex counts as one city. TODO(verify): spec 09 R1 and open question 3 (the guess is BINMAP.BIN byte 17 bits 2 and 3).
 */
export const DOUBLE_CITY_HEXES: readonly HexId[] = [];

/**
 * The Western Allies for the base-sharing ban between them and the Russians (Ref 20.1: "Russian and Western Allied air may not use each
 * other's bases"). TODO(verify): whether Free France (which functions as British, Ref 35.0) and Poland belong; Free France is counted, Poland is not.
 */
export const WESTERN_ALLIED_OWNERS: readonly ForceOwner[] = ["britain", "france", "usa", "free-france"];

/** British and French air may not use each other's bases before this year (Ref 20.1, 26.0). */
export const ANGLO_FRENCH_BASE_BAN_UNTIL = 1942;
