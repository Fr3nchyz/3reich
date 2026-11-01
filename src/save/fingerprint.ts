import type { GameState } from "../engine/types";
import type { Json } from "./format";

// Spec 11 Part B; TODO(verify) AER54: FNV-1a over sorted JSON UTF-16 code units; not security.
export const FINGERPRINT_ALGORITHM = "fnv1a32-utf16";
/** Spec 11 Parts B/I: array order matters, object insertion order does not. */
export function sortedJson(value: Json | GameState): string {
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value)) throw new Error("Non-JSON number");
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new Error("Non-JSON value");
    return encoded;
  }
  if (Array.isArray(value)) return `[${value.map(v => sortedJson(v)).join(",")}]`;
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    throw new Error("Non-JSON object");
  }
  return `{${Object.keys(value).sort().map(key =>
    `${JSON.stringify(key)}:${sortedJson((value as Record<string, Json>)[key]!)}`).join(",")}}`;
}

/** Spec 11 Part H: damage detection only; collisions are possible. */
export function fingerprint(state: Json | GameState): string {
  const text = sortedJson(state);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return hash.toString(16).padStart(8, "0");
}
