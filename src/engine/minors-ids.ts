import type { MinorCountry } from "./types";

/** Leaf module: no engine imports, so control.ts can read these without an import cycle through minors-rules. */

/** Spec 15 R1, Ref 14.0: exactly the nineteen countries on the Minor Country Forces chart. */
export const MINOR_COUNTRIES: readonly MinorCountry[] = [
  "arabia", "belgium", "bulgaria", "denmark", "finland", "greece", "hungary", "ireland", "luxembourg", "netherlands",
  "norway", "persia", "poland", "portugal", "rumania", "spain", "sweden", "turkey", "yugoslavia",
];
/** Spec 15 R9, Ref 17.0–17.3: Germany's four possible Minor-Allies. */
export const AXIS_MINOR_ALLIES = ["finland", "hungary", "rumania", "bulgaria"] as const;
