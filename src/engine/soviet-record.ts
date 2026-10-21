/**
 * The Free Siberian Transfer record (spec 14 C1; Ref 11.63). This module holds only what the victory tables
 * read: from the first unit taken, the tables for the Transfer apply to the end of the game (R2, R11).
 * The rest of the Russian record (Moscow and Leningrad, the surrender offer) and the transfer itself come with
 * tickets 14-14, 14-15 and 14-18.
 */
export interface SiberianRecord {
  /** True once any unit has been taken. */
  used: boolean;
  /** "1941-winter" -> units taken that Game Turn. */
  taken: Record<string, number>;
}
