import type { HexId } from "./hex";

/** Other Black Sea ports that can support Sevastopol (Ref 4.8, 19.2; spec 16 R28). TODO(verify): AER37, including Izmit. */
export const SEVASTOPOL_PORTS: readonly HexId[] = ["T37", "W35", "X43", "Z33", "AA33"];

/** First year the Axis-held West Wall becomes a fortress (Ref 4.8; spec 16 R27). TODO(verify): AER39, first Player Turn of the year. */
export const WEST_WALL_YEAR = 1944;

/** Scenarios starting in this year or later have no Maginot fortresses (Ref 4.8; spec 16 R26). */
export const MAGINOT_GONE_YEAR = 1942;
