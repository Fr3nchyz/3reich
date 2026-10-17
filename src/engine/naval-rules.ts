import type { HexId } from "./hex";
import { NAVAL_FACTOR_STACKING_LIMIT } from "./tables";

/**
 * The numbers of the fleet rules (spec 12, part A). Every constant names its rule; the ones the rule text does not settle carry
 * TODO(verify) and are listed in spec 12 part J and docs/TODO-VERIFY.md. Pure data: no behaviour lives here.
 */

/** Naval factors one port bases (Ref 21.1, 5.0, 4.7). Same number as the setup stacking limit in tables.ts. */
export const NAVAL_PER_PORT = NAVAL_FACTOR_STACKING_LIMIT;

/** Naval factors the three small ports base (Ref 21.1, 33.0): Malta, Suda Bay (Crete) and Famagusta (Cyprus). Spec 12 R2, N3. */
export const SMALL_PORT_CAPACITY = 9;

/** The three small ports: Malta, Suda Bay and Famagusta. */
export const SMALL_PORT_HEXES: readonly HexId[] = ["GG19", "GG26", "GG34"];

/**
 * Hexes that hold two ports and so base twice as much (Ref 21.1: 72). The map data marks none and none exists on our map (checked in
 * spec 12), so the list is empty and every port hex counts as one port. TODO(verify): spec 12 R2, N3.
 */
export const DOUBLE_PORT_HEXES: readonly HexId[] = [];

/**
 * The playable one-hex islands (Ref 4.9), which can receive supply by sea (Ref 19.31) and be invaded (Ref 21.43). The map data has no
 * list (it joins B29 to the mainland by a crossing arrow and cuts hexsides inside Sardinia, so a guess from the data fails), so it is
 * written by hand: Malta and Scapa Flow are the two the manual names. TODO(verify): spec 12 R7, N11. Not listed, though they are one
 * hex on our map: Corsica (X20, a port, so supply reaches it as a port anyway), Rhodes (FF30) and the small Baltic, Danish and Greek
 * islands (F33, F39, H36, I31, I32, CC30, DD29, EE28).
 */
export const ONE_HEX_ISLANDS: readonly HexId[] = ["B29", "GG19"];
