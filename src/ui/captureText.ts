import { AIR_DISPLACED_ON_CAPTURE } from "../engine/air-rules";
import { FLEETS_DISPLACED_ON_CAPTURE } from "../engine/naval-rules";
import type { Unit } from "../engine/types";
import { stackSummary } from "./names";

/** Specs 09 D1 / R9 / R2 and 12 R9: the same switches as the shared capture hook. */
export const movesOnCapture = (u: Unit): boolean =>
  (FLEETS_DISPLACED_ON_CAPTURE && u.type === "fleet") || (AIR_DISPLACED_ON_CAPTURE && (u.type === "air" || u.type === "airbase"));

/** Preview displacement by kind; no destinations or dice are chosen by the screen (spec 07). */
export function captureMovementText(units: readonly Unit[]): string {
  const words: string[] = [];
  const planes = units.filter((u) => u.type === "air");
  const bases = units.filter((u) => u.type === "airbase");
  const fleets = units.filter((u) => u.type === "fleet");
  if (planes.length) words.push(`${stackSummary(planes, true)} must leave for the nearest usable friendly base within 8 hexes with room, or be lost if there is none.`); // spec 09 R9
  if (bases.length) words.push(`${stackSummary(bases, true)} must return to their owner's Capital, or be lost if no friendly Capital is available.`); // spec 09 R2; A2-A4
  if (fleets.length) words.push(`${stackSummary(fleets, true)} must leave for the nearest friendly port with room, or be lost if there is none.`); // spec 12 R9
  return words.length ? ` ${words.join(" ")}` : "";
}
