import type { GameContext } from "./context";
import type { HexId } from "./hex";
import type { Front } from "./map";
import { DOUBLE_PORT_HEXES, NAVAL_PER_PORT, ONE_HEX_ISLANDS, SMALL_PORT_CAPACITY, SMALL_PORT_HEXES } from "./naval-rules";
import { NAVAL_BASE_FEATURES } from "./terrain";

/**
 * Port facts (spec 12 R2 and R3; Ref 4.7, 4.9, 5.0, 21.1, 33.0): what a port bases, which Front it serves, which hexes are one-hex
 * islands. Pure queries on the map; no state, no actions. Routes between ports are in naval-routes.ts.
 */

/**
 * The Front each port serves (Ref 4.4, 21.1): the Front of the water it opens on, which is not always the Front of its land. Marseilles is
 * western by land and Mediterranean by water; Constanta is Mediterranean by land and Black Sea (Eastern) by water. The Baltic and the Black
 * Sea count as Eastern. Kiel (Baltic and North Sea), Gibraltar (Atlantic and Mediterranean) and Istanbul (Black Sea and Mediterranean) serve
 * two Fronts. Made once from the Front of the water next to each port and checked in tests/naval-ports.test.ts; the seven marked
 * TODO(verify) are the ones the map data does not settle (they touch water of two Fronts or none): the Front is read from the all-water
 * hexes beside the port, and the open question to Frank is P4 (spec 12), N4 in docs/TODO-VERIFY.md.
 */
export const PORT_FRONTS: Readonly<Record<HexId, readonly Front[]>> = {
  B29: ["western"], // Scapa Flow
  C33: ["western"], // Bergen
  D44: ["eastern"], // Leningrad
  E38: ["eastern"], // Stockholm
  F24: ["western"], // Belfast
  F26: ["western"], // Rosyth
  F40: ["eastern"], // Parnu
  J30: ["western", "eastern"], // Kiel
  J32: ["eastern"], // Rostock TODO(verify)
  J35: ["eastern"], // Danzig
  J36: ["eastern"], // Konigsberg
  K21: ["western"], // Plymouth
  K24: ["western"], // Harwich
  K25: ["western"], // Great Yarmouth
  K28: ["western"], // Wilhelmshaven
  K29: ["western"], // Bremen
  K32: ["eastern"], // Stettin TODO(verify)
  L22: ["western"], // Southampton
  L24: ["western"], // Calais
  L25: ["western"], // Antwerp
  M21: ["western"], // Cherbourg
  N18: ["western"], // Brest
  N19: ["western"], // Lorient
  O19: ["western"], // St. Nazaire
  Q18: ["western"], // La Rochelle
  R12: ["western"], // La Coruna TODO(verify)
  S11: ["western"], // Vigo TODO(verify)
  T37: ["eastern"], // Odessa
  U22: ["mediterranean"], // Genoa
  U25: ["mediterranean"], // Venice
  U26: ["mediterranean"], // Trieste
  V19: ["mediterranean"], // Marseilles (western by land)
  V22: ["mediterranean"], // Spezia
  V38: ["eastern"], // Sevastopol
  W22: ["mediterranean"], // Livorno
  W35: ["eastern"], // Constanta (Mediterranean by land)
  X13: ["mediterranean"], // Valencia
  X20: ["mediterranean"], // Ajaccio
  X43: ["eastern"], // Batum TODO(verify)
  Y15: ["mediterranean"], // Palma
  Z7: ["western"], // Cadiz TODO(verify)
  Z11: ["mediterranean"], // Cartagena
  Z23: ["mediterranean"], // Naples
  Z33: ["mediterranean", "eastern"], // Istanbul
  AA7: ["western", "mediterranean"], // Gibraltar
  AA19: ["mediterranean"], // Cagliari
  AA24: ["mediterranean"], // Taranto
  AA25: ["mediterranean"], // Brindisi
  AA26: ["mediterranean"], // Durazzo
  AA33: ["mediterranean"], // Izmit
  CC9: ["mediterranean"], // Oran
  CC12: ["mediterranean"], // Algiers
  CC31: ["mediterranean"], // Izmir
  DD17: ["mediterranean"], // Tunis
  DD21: ["mediterranean"], // Messina
  DD28: ["mediterranean"], // Athens
  EE37: ["mediterranean"], // Antioch
  GG19: ["mediterranean"], // Malta
  GG26: ["mediterranean"], // Suda Bay
  GG34: ["mediterranean"], // Famagusta
  HH35: ["mediterranean"], // Beirut
  II17: ["mediterranean"], // Tripoli
  JJ34: ["mediterranean"], // Haifa TODO(verify)
  KK24: ["mediterranean"], // Tobruk
  LL29: ["mediterranean"], // Alexandria
  LL31: ["mediterranean"], // Port Said
  MM30: ["mediterranean"], // Suez
};

/** Whether the hex holds a port (a city marked with an open circle, or a capital-port, Ref 4.7). */
export const isPort = (ctx: GameContext, hex: HexId): boolean => ctx.map.hexes[hex]?.features.some((f) => NAVAL_BASE_FEATURES.includes(f)) ?? false;

/** Every port on the map, in the map's order. */
export const portsOf = (ctx: GameContext): HexId[] => Object.keys(ctx.map.hexes).filter((hex) => isPort(ctx, hex));

/**
 * The naval factors the hex can base (Ref 21.1, 5.0): 36 per port, 9 for Malta, Suda Bay and Famagusta, 72 for a hex that holds two ports.
 * 0 for a hex that is no port (open sea, open ground), or off the map. Counts nothing standing there: that is the caller's subtraction.
 */
export function portCapacity(ctx: GameContext, hex: HexId): number {
  if (!isPort(ctx, hex)) return 0;
  if (SMALL_PORT_HEXES.includes(hex)) return SMALL_PORT_CAPACITY;
  return DOUBLE_PORT_HEXES.includes(hex) ? 2 * NAVAL_PER_PORT : NAVAL_PER_PORT;
}

/** The Fronts a fleet based in this port may act on (R3): one, or two for Kiel, Gibraltar and Istanbul; none for a hex that is no port. */
export const portFronts = (ctx: GameContext, hex: HexId): readonly Front[] => (isPort(ctx, hex) ? (PORT_FRONTS[hex] ?? []) : []);

/** Whether the port serves two Fronts. */
export const isTwoFrontPort = (ctx: GameContext, hex: HexId): boolean => portFronts(ctx, hex).length === 2;

/** The ports that serve this Front (a two-Front port is on both lists), in the map's order. */
export const portsOnFront = (ctx: GameContext, front: Front): HexId[] => portsOf(ctx).filter((hex) => portFronts(ctx, hex).includes(front));

/** Whether the hex is a playable one-hex island (Ref 4.9; see `ONE_HEX_ISLANDS`). */
export const isOneHexIsland = (ctx: GameContext, hex: HexId): boolean => ONE_HEX_ISLANDS.includes(hex) && ctx.map.hexes[hex]?.land != null;
