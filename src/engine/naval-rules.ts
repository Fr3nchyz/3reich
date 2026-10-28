import type { HexId } from "./hex";
import { NAVAL_FACTOR_STACKING_LIMIT } from "./tables";

/**
 * The numbers of the fleet rules (spec 12, part A). Every constant names its rule; the ones the rule text does not settle carry
 * TODO(verify) and are listed in spec 12 part J and docs/TODO-VERIFY.md. Pure data: no behaviour lives here.
 */

/** Naval factors one port bases (Ref 21.1, 5.0, 4.7). Same number as the setup stacking limit in tables.ts. */
export const NAVAL_PER_PORT = NAVAL_FACTOR_STACKING_LIMIT;

/** Naval factors the three small ports base (Ref 21.1, 33.0): Malta, Suda Bay (Crete) and Famagusta (Cyprus). Spec 12 R2. TODO(verify): N3 (the number and the list are from the spec's reading of Ref 21.1, not yet checked against the program). */
export const SMALL_PORT_CAPACITY = 9;

/** The three small ports: Malta, Suda Bay and Famagusta. TODO(verify): N3, whether any other small port exists. */
export const SMALL_PORT_HEXES: readonly HexId[] = ["GG19", "GG26", "GG34"];

/**
 * Hexes that hold two ports and so base twice as much (Ref 21.1: 72). The map data marks none and none exists on our map (checked in
 * spec 12), so the list is empty and every port hex counts as one port. TODO(verify): spec 12 R2, N3.
 */
export const DOUBLE_PORT_HEXES: readonly HexId[] = [];

/**
 * The playable one-hex islands (Ref 4.9), which can receive supply by sea (Ref 19.31) and be invaded (Ref 21.43). The map data has no
 * list (it joins B29 to the mainland by a crossing arrow and cuts hexsides inside Sardinia, so a guess from the data fails), so it is
 * written by hand: Malta and Scapa Flow are the two the manual names. TODO(verify): spec 12 R7, N11. Not listed, and not an exhaustive
 * list of what is left out: Corsica (X20, a port, so supply reaches it as a port anyway), Rhodes (FF30), Palma and Y16 (Majorca: a
 * port joined to its neighbour only by a sea hexside) and the small Baltic, Danish and Greek islands (F33, F39, H36, I31, I32, CC30,
 * DD29, EE28); NN26 (Egypt) is a Qattara hex, arguably no island.
 */
export const ONE_HEX_ISLANDS: readonly HexId[] = ["B29", "GG19"];

/**
 * Ground units or airbases one naval factor of a supply fleet feeds (Ref 19.31), whatever the printed factors of the unit: a 9-factor fleet
 * feeds nine counters. Spec 12 R6, R7. The capacity is the sum over all the designations that use the fleet. TODO(verify): N8, N9 (charged when named), N35 (several fleets in one designation).
 */
export const SEA_SUPPLY_UNITS_PER_FACTOR = 1;

/**
 * What happens to a fleet that is left alone in a port when the last ground defender is gone (the roll-free sweep of `ALONE_NONGROUND_DESTROYED`):
 * true, it is displaced to the nearest friendly port with room on its Front, or eliminated if there is none (Ref 21.1, spec 12 R9, decision D1 of
 * spec 09); false, it is destroyed with no roll as before. Air units and airbases keep their own rule until spec 09 ticket 09-5. TODO(verify): the
 * rule is the product owner's decision of 2026-10-15; the manual's text (Ref 21.1, 12.4) and the PC game are not yet checked (N15 to N18, N36, N37).
 */
export const FLEETS_DISPLACED_ON_CAPTURE = true;

/** Spec 12 R10, Ref 21.2: one base change per Player Turn. TODO(verify): N19, confirm the limit in the program. */
export const ONE_BASE_CHANGE_PER_TURN = true;
