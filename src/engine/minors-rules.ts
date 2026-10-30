import { minorCapital } from "./conquest-minor";
import type { ColonyId } from "./conquest-record";
import type { GameContext } from "./context";
import type { HexId } from "./hex";
import { AIR_BASE_FEATURES } from "./terrain";
import { AXIS_MINOR_ALLIES, DEFENSELESS_MINORS, isDefenseless, MINOR_COUNTRIES } from "./minors-ids";

export { DEFENSELESS_MINORS, isDefenseless };
import type { MinorCountry } from "./types";

export { AXIS_MINOR_ALLIES, MINOR_COUNTRIES };

/** Spec 15 R9, MC9: the Axis step 2 of Summer 1941; these are facts only, not an activation hook. */
export const AXIS_MINOR_ALLY_WAKE_TURN = { year: 1941, season: "summer", side: "axis", step: "2" } as const;
/** Spec 15 R7/R13: these colonies require all their cities, rather than a minor's capital. */
export const COLONIES: readonly ColonyId[] = ["albania", "algeria", "egypt", "iraq", "lebanon-syria", "libya", "morocco", "palestine", "transjordan", "tunisia"];

/** Spec 15 R13, Ref 9.2/29.0; card readings remain TODO(verify), MC12 / spec 15 P8. Null is never a guessed zero. */
export const MINOR_VALUES = {
  finland: 10, hungary: 10, rumania: 15, bulgaria: 10, // Ref 9.2's 45 total; Bulgaria also PC README.
  denmark: 10, belgium: 15, netherlands: 10, luxembourg: 5, // Ref 9.2's 40 total.
  poland: 20, // Ref 9.2's worked example and the card.
  "eastern-europe": 25, // Ref 29.0.
  norway: 10, // TODO(verify) MC12 / P8: card only.
  sweden: 15, // TODO(verify) MC12 / P8: card only.
  yugoslavia: 20, // TODO(verify) MC12 / P8: card only.
  greece: 10, // TODO(verify) MC12 / P8: card only.
  spain: 30, // TODO(verify) MC12 / P8: card only.
  turkey: 30, // TODO(verify) MC12 / P8: card only.
  portugal: 5, // TODO(verify) MC12 / P8: card only.
  albania: 5, // TODO(verify) MC12 / P8: card only.
  algeria: 5, // TODO(verify) MC12 / P8: card only.
  morocco: 5, // TODO(verify) MC12 / P8: card only.
  tunisia: 5, // TODO(verify) MC12 / P8: card only.
  "lebanon-syria": 5, // TODO(verify) MC12 / P8: card only.
  egypt: 5, // TODO(verify) MC12 / P8: card only.
  palestine: 5, // TODO(verify) MC12 / P8: card only.
  libya: null, // TODO(verify) MC12 / P8: not read; owner must check the printed card.
  transjordan: null, // TODO(verify) MC12 / P8: not read; owner must check the printed card.
  iraq: null, // TODO(verify) MC12 / P8: not read; owner must check the printed card.
  persia: null, arabia: null, ireland: null, // Spec 15 R13: none printed; distinct from the three unread values.
} as const satisfies Readonly<Record<MinorCountry | ColonyId | "eastern-europe", number | null>>;
export type MinorValueCountry = keyof typeof MINOR_VALUES;
/** Spec 15 R13: distinguish a known blank from unread print and an unknown country. */
export const VALUE_READING: Readonly<Partial<Record<MinorValueCountry, "none-printed" | "not-read">>> = {
  persia: "none-printed", arabia: "none-printed", ireland: "none-printed",
  libya: "not-read", transjordan: "not-read", iraq: "not-read",
};
/** Undefined means unknown country; null means a known blank or unread value, never zero (R13; MC12/P8). */
export const minorValue = (country: string): number | null | undefined => Object.hasOwn(MINOR_VALUES, country) ? MINOR_VALUES[country as MinorValueCountry] : undefined;
/** The reason a known country's value is null; undefined for numeric values and unknown countries (R13). */
export const minorValueReading = (country: string): "none-printed" | "not-read" | undefined => Object.hasOwn(VALUE_READING, country) ? VALUE_READING[country as MinorValueCountry] : undefined;
/** R7, MC7: reuse the map's capital and the existing single-hex Luxembourg exception; no invented capital for Persia or Arabia. */
export const capitalOf = (ctx: GameContext, country: string): HexId | null => MINOR_COUNTRIES.includes(country as MinorCountry) ? minorCapital(ctx, country) : null;
/** R7/R13: all printed city types in the colony, from the supplied map; no unprovided scan-derived city list is guessed. */
export const colonyCities = (ctx: GameContext, country: ColonyId): HexId[] =>
  Object.values(ctx.map.hexes).filter((h) => h.land && h.country === country && h.features.some((f) => AIR_BASE_FEATURES.includes(f))).map((h) => h.id).sort();
