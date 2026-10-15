import type { MapData } from "../engine/map";

/**
 * What the attack marks show (spec 07, ticket 07-5): pure data in, plain lists out; no DOM and no SVG here.
 * A target is a hex the player can attack right now, the chosen one is the target the attack card is about,
 * and an attacker hex holds units chosen (or available) to attack that target.
 */

export interface AttackMarksInput {
  /** Every hex the player can attack right now. */
  targets?: Iterable<string>;
  /** The target the attack card is open on, if any. */
  chosen?: string | null;
  /** Hexes holding units that attack the chosen target. */
  attackers?: Iterable<string>;
}

export interface AttackMarkCells {
  /** Targets other than the chosen one (it is drawn thick instead of dashed), once each, in the order given. */
  targets: string[];
  chosen: string | null;
  /** Attacker hexes, once each, in the order given; the chosen target is never one (it is the enemy's hex). */
  attackers: string[];
}

/** Hexes that are not on the map are dropped, so a stale id can never draw outside it. */
export function attackMarkCells(map: MapData, input: AttackMarksInput | null | undefined): AttackMarkCells {
  const onMap = (id: string): boolean => map.hexes[id] !== undefined;
  const chosen = input?.chosen && onMap(input.chosen) ? input.chosen : null;
  const unique = (ids: Iterable<string> | undefined): string[] => [...new Set(ids ?? [])].filter((id) => onMap(id) && id !== chosen);
  return { targets: unique(input?.targets), chosen, attackers: unique(input?.attackers) };
}
