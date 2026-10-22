/**
 * The Russian records of spec 14 C1. `SiberianRecord` holds what the victory tables read: from the first unit taken (Ref 11.63), the tables for the Transfer apply
 * to the end of the game (R2, R11). `SovietRecord` holds the once-only 15s for Moscow and Leningrad (ticket 14-14, R7a); the surrender offer, the credited
 * Objectives and the Occupation Force shortfall (tickets 14-15 and 14-17) are added to it by those tickets. The Transfer itself comes with ticket 14-18.
 */
export interface SiberianRecord {
  /** True once any unit has been taken. */
  used: boolean;
  /** "1941-winter" -> units taken that Game Turn. */
  taken: Record<string, number>;
}

/** The two Russian cities whose capture by the Axis moves 15 BRPs (Ref 18.4, 9.2). */
export type SovietCity = "moscow" | "leningrad";

export interface SovietRecord {
  /** The cities the Axis has taken at least once: the immediate 15 BRPs are paid once for each city, whatever happens to its control later (R7a). */
  citiesTaken: { moscow?: boolean; leningrad?: boolean };
}
