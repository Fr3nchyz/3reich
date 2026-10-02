import type { MapData } from "../engine/map";
import data from "./map.json";

/**
 * The game map, digitised from the reference map by scripts/map/extract.py.
 * tests/map-data.test.ts checks it with validateMap and against the Reference Manual.
 */
export const MAP: MapData = data as MapData;
