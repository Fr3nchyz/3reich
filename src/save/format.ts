/** Save data only; spec 11 Part B. No browser or restore wiring. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };
export const SAVE_FORMAT = 2;
// Spec 11 Part A; TODO(verify) AER52: initial semantic revision, exact match required for rescue.
export const STATE_VERSION = 1;
// Spec 11 Part H: caps apply to the entire input, including ignored fields.
export const MAX_FILE_BYTES = 4 * 1024 * 1024;
export const MAX_ACTIONS = 100_000;
export const MAX_STRING_LENGTH = 200;
export const MAX_DEPTH = 20;
// Spec 11 Part B; TODO(verify) AER53: ISO UTC timestamp, nonempty build, plain record memory.
export const SAVE_METADATA_POLICY = "iso-utc-record-memory";
export interface SaveFile {
  format: 2;
  app: "3reich";
  title: string;
  savedAt: string;
  gameVersion: string;
  stateVersion: number;
  scenario: string;
  seed: number;
  humanSide: "axis" | "allies";
  start: { kind: "new" } | { kind: "snapshot"; state: JsonObject };
  /** Untrusted action envelopes: only the engine can establish legality (Part H). */
  actions: JsonObject[];
  setupActions: number;
  fingerprint: string;
  /** Untrusted until a restore chooses and validates this position (Parts A/H). */
  snapshot: JsonObject;
  ai?: { targets: Record<string, string>; left: Record<string, { hex: string; turn: number }[]> };
  logTail?: string[];
  note?: string;
}
export type ReadResult = { ok: true; save: SaveFile } | {
  ok: false; code: "invalid" | "too-large" | "newer" | "scenario" | "legacy"; message: string;
};

// Spec 11 H: retain only known action fields; action legality still belongs to applyAction.
export const ACTION_FIELDS: Record<string, string> = {
  END_PLAYER_TURN: "side", END_STEP: "side step", DECLARE_WAR: "by on",
  PLACE_MINOR_FORCES: "side minor placements", SELECT_FRONT_OPTION: "side front option payer",
  BUILD: "owner pool unit at", GRANT_BRPS: "from to amount", CHOOSE_WINTER: "side postpone",
  SIBERIAN_TRANSFER: "side unit at", SURRENDER_ANSWER: "side accept", OCCUPATION_CONCEDE: "side hex",
  ATTACK: "side units target", ALLOCATE_LOSSES: "side units", ADVANCE: "side units to",
  PLACE_EXPLOITERS: "side hex units", EXPLOIT_MOVE: "side unit path", MOVE: "side units path",
  PLACE_AIRBASE: "owner at", STAGE_AIR: "side units to", SPLIT_AIR: "side unit parts", COMBINE_AIR: "side units",
  DESIGNATE_SEA_SUPPLY: "side fleets to units", DESIGNATE_AIR: "side mission units target",
  ELIMINATE_OVERSTACK: "side choices", SR_UNITS: "side units to escort", RESOLVE_ATTRITION: "side front units",
  CHOOSE_ATTRITION_LOSSES: "side units", SELECT_ATTRITION_HEX: "side hex", END_ATTRITION: "side",
  RETREAT_UNIT: "side unit to", OCCUPY_ATTRITION_HEX: "side units", SETUP_PLACE: "owner unit at",
  SETUP_REMOVE: "owner unitId", SETUP_DONE: "owner",
};
