import { newGame } from "../engine/game";
import type { GameState, Scenario } from "../engine/types";
import { ACTION_FIELDS, MAX_ACTIONS, MAX_DEPTH, MAX_FILE_BYTES, MAX_STRING_LENGTH, SAVE_FORMAT, STATE_VERSION } from "./format";
import type { Json, JsonObject, ReadResult, SaveFile } from "./format";

const object = (v: unknown): v is JsonObject => v !== null && typeof v === "object" && !Array.isArray(v);
const integer = (v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max;
const text = (v: unknown): v is string => typeof v === "string" && v.length <= MAX_STRING_LENGTH;
function fail(field: string): never { throw new Error(field); }

/** Spec 11 Part H: scan even ignored fields, before selecting any data. */
function safeTree(value: unknown, depth = 0): asserts value is Json {
  if (depth > MAX_DEPTH) fail("nesting");
  if (typeof value === "string") { if (!text(value)) fail("string"); return; }
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (Array.isArray(value)) { value.forEach(v => safeTree(v, depth + 1)); return; }
  if (!object(value)) fail("value");
  for (const [key, child] of Object.entries(value)) {
    if (!text(key) || ["__proto__", "constructor", "prototype"].includes(key)) fail("key");
    safeTree(child, depth + 1);
  }
}

/** Spec 11 Part H: count UTF-8 bytes without a browser/Node API or allocating an encoded copy. */
function byteLength(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) bytes++;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff && text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff) {
      bytes += 4; i++;
    } else bytes += 3;
    if (bytes > MAX_FILE_BYTES) return bytes;
  }
  return bytes;
}

/** Spec 11 Parts A/B/H: parse only; no replay, storage, migration or version-based rescue. */
export function readSave(source: string, scenarios: readonly Scenario[]): ReadResult {
  if (byteLength(source) > MAX_FILE_BYTES) return { ok: false, code: "too-large", message: "This file is too large to open." };
  let input: unknown;
  try { input = JSON.parse(source) as unknown; }
  catch { return { ok: false, code: "invalid", message: "This file is not a 3Reich saved game, or it is incomplete." }; }
  try {
    safeTree(input);
    if (!object(input)) fail("save");
    if (typeof input.format === "number" && Number.isInteger(input.format) && input.format > SAVE_FORMAT) return {
      ok: false, code: "newer", message: "This save was made by a newer version. Update the game (reload the page) and try again.",
    };
    // Spec 11 Parts G/K: legacy records belong to ticket 11-9, never masquerade as format 2.
    if (input.format === 1) return { ok: false, code: "legacy", message: "This game record needs the record importer." };
    if (input.format !== SAVE_FORMAT || input.app !== "3reich") fail("format/app");
    const scenario = scenarios.find(s => s.id === input.scenario);
    if (!text(input.scenario) || !scenario) return {
      ok: false, code: "scenario", message: "This save is for a scenario this version does not have.",
    };
    if (!integer(input.seed, 0, 0xffffffff)) fail("seed");
    if (input.humanSide !== "axis" && input.humanSide !== "allies") fail("humanSide");
    if (!text(input.title) || input.title.length > 40) fail("title");
    // Spec 11 Part B; TODO(verify) AER53: canonical UTC date, not arbitrary display text.
    if (!text(input.savedAt) || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(input.savedAt)
      || !Number.isFinite(Date.parse(input.savedAt)) || new Date(input.savedAt).toISOString() !== input.savedAt) fail("savedAt");
    if (!text(input.gameVersion) || input.gameVersion.length === 0) fail("gameVersion");
    if (!integer(input.stateVersion, 1)) fail("stateVersion");
    if (!Array.isArray(input.actions)) fail("actions");
    if (input.actions.length > MAX_ACTIONS) return { ok: false, code: "too-large", message: "This file is too large to open." };
    const actions = input.actions.map(a => {
      if (!object(a) || !text(a.type) || a.type.length === 0) fail("actions");
      // Spec 11 H: action-specific fields and legality are judged by the engine during restore.
      const fields = ["type", ...(ACTION_FIELDS[a.type] ?? "").split(" ")];
      const action = Object.fromEntries(Object.entries(a).filter(([key]) => fields.includes(key)));
      if (object(action.unit)) action.unit = Object.fromEntries(Object.entries(action.unit)
        .filter(([key]) => ["type", "strength", "nationality", "returned"].includes(key)));
      if (Array.isArray(action.placements)) action.placements = action.placements.map(p => object(p)
        ? Object.fromEntries(Object.entries(p).filter(([key]) => ["type", "strength", "at"].includes(key))) : p);
      return action;
    });
    if (!integer(input.setupActions, 0, actions.length)) fail("setupActions");
    if (!text(input.fingerprint) || !/^[0-9a-f]{8}$/.test(input.fingerprint)) fail("fingerprint");
    if (!object(input.snapshot)) fail("snapshot");
    if (!object(input.start)) fail("start");
    const start: SaveFile["start"] = input.start.kind === "new" ? { kind: "new" }
      : input.start.kind === "snapshot" && object(input.start.state)
        ? { kind: "snapshot", state: cleanSnapshot(input.start.state, scenario) } : fail("start");
    const save: SaveFile = {
      format: 2, app: "3reich", title: input.title, savedAt: input.savedAt, gameVersion: input.gameVersion,
      scenario: input.scenario, seed: input.seed, humanSide: input.humanSide, stateVersion: input.stateVersion,
      start, actions, setupActions: input.setupActions, fingerprint: input.fingerprint, snapshot: cleanSnapshot(input.snapshot, scenario),
    };
    if (input.logTail !== undefined) {
      if (!Array.isArray(input.logTail) || input.logTail.length > 60 || !input.logTail.every(text)) fail("logTail");
      save.logTail = input.logTail;
    }
    if (input.note !== undefined) { if (!text(input.note)) fail("note"); save.note = input.note; }
    if (input.ai !== undefined) save.ai = memory(input.ai);
    return { ok: true, save };
  } catch (error) {
    return { ok: false, code: "invalid", message: `This saved game is damaged (the field '${error instanceof Error ? error.message : "save"}' is invalid).` };
  }
}

// Spec 11 Part B/E5; TODO(verify) AER53: caches excluded, targets/left plain records.
function memory(value: Json): NonNullable<SaveFile["ai"]> {
  if (!object(value) || !object(value.targets) || !object(value.left)) fail("ai");
  const targets: Record<string, string> = {};
  const left: NonNullable<SaveFile["ai"]>["left"] = {};
  for (const [id, hex] of Object.entries(value.targets)) { if (!text(hex)) fail("ai.targets"); targets[id] = hex; }
  for (const [id, entries] of Object.entries(value.left)) {
    if (!Array.isArray(entries)) fail("ai.left");
    left[id] = entries.map(e => {
      if (!object(e) || !text(e.hex) || !integer(e.turn)) fail("ai.left");
      return { hex: e.hex, turn: e.turn };
    });
  }
  return { targets, left };
}

// Spec 11 Part A; TODO(verify) AER55: no guessing about unrepresented optional state fields.
export const SNAPSHOT_SHAPE_POLICY = "fresh-fields-only";
/** Shape screening only, NOT a GameState type guard or engine-invariant validation.
 * Spec 11 A: caller may supply a fresh game to test a later engine shape.
 */
export function snapshotHasFreshShape(snapshot: JsonObject, scenario: Scenario, stateVersion: number,
  fresh: GameState = newGame(scenario, 0)): boolean {
  if (stateVersion !== STATE_VERSION || snapshot.scenarioId !== scenario.id) return false;
  const sameKeys = (a: JsonObject, b: object): boolean =>
    Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(key => Object.hasOwn(b, key));
  if (!sameKeys(snapshot, fresh) || !object(snapshot.nations) || !object(snapshot.units)) return false;
  if (!sameKeys(snapshot.nations, fresh.nations)) return false;
  for (const [id, nation] of Object.entries(snapshot.nations)) {
    const template = fresh.nations[id as keyof typeof fresh.nations];
    if (!object(nation) || !sameKeys(nation, template)) return false;
    for (const key of Object.keys(nation)) {
      if (typeof nation[key] !== typeof (template as unknown as JsonObject)[key]) return false;
    }
  }
  // Spec 11 A; AER55: fresh units is empty; required Unit fields come from engine/types.ts.
  const owners = [...Object.keys(fresh.nations), ...Object.keys(scenario.forces)];
  const types = ["infantry", "armor", "airborne", "replacement", "air", "fleet", "airbase", "bridgehead"];
  for (const [id, unit] of Object.entries(snapshot.units)) {
    if (!object(unit) || unit.id !== id || !text(unit.owner) || !owners.includes(unit.owner)
      || !text(unit.type) || !types.includes(unit.type) || !integer(unit.strength, 1) || !text(unit.at)) return false;
    if (Object.keys(unit).some(k => !["id", "owner", "type", "strength", "at", "movement", "nationality"].includes(k))) return false;
    if (unit.movement !== undefined && !integer(unit.movement)) return false;
    if (unit.nationality !== undefined && (!text(unit.nationality) || !owners.includes(unit.nationality))) return false;
  }
  // Spec 11 A; AER55: arrays may contain several fresh entry shapes; empty collections have no exemplar.
  const resembles = (value: Json | undefined, template: unknown): boolean => {
    if (template === null) return value === null;
    if (Array.isArray(template)) return Array.isArray(value)
      && (template.length === 0 || value.every(v => template.some(example => resembles(v, example))));
    if (typeof template !== "object") return typeof value === typeof template;
    if (!object(value) || !template) return false;
    const entries = Object.entries(template);
    return entries.length === 0 || (sameKeys(value, template)
      && entries.every(([k, v]) => resembles(value[k], v)));
  };
  for (const key of ["lastTurn", "pools", "wars", "strategicWarfare", "minorAllies", "countries", "setup"]) {
    if (key === "setup" && snapshot.setup === null) continue;
    if (key in fresh && !resembles(snapshot[key], (fresh as unknown as JsonObject)[key])) return false;
  }
  if (!object(snapshot.control) || !Object.values(snapshot.control).every(v => v === null || (text(v) && owners.includes(v)))) return false;
  if (!object(snapshot.fortresses) || !Object.values(snapshot.fortresses).every(v => typeof v === "boolean")) return false;
  for (const [key, template] of Object.entries(fresh)) {
    const value = snapshot[key];
    if (key === "setup" && value === null) continue;
    if (key === "position") {
      if (value === null) continue;
      if (!object(value) || !text(value.part)) return false;
      if (value.part === "player-turn") {
        if (!sameKeys(value, { part: "", turn: 1, step: "" }) || (value.turn !== 1 && value.turn !== 2) || !text(value.step)) return false;
      } else if (!["year-start", "russian-winter", "turn-order"].includes(value.part) || !sameKeys(value, { part: "" })) return false;
      continue;
    }
    if (template === null) { if (value !== null) return false; }
    else if (Array.isArray(template)) { if (!Array.isArray(value)) return false; }
    else if (typeof value !== typeof template || (typeof template === "object" && !object(value))) return false;
  }
  return integer(snapshot.rngState, 0, 0xffffffff) && integer(snapshot.nextUnitId, 1)
    && integer(snapshot.year) && text(snapshot.season) && ["spring", "summer", "fall", "winter"].includes(snapshot.season)
    && text(snapshot.activeSide) && ["axis", "allies"].includes(snapshot.activeSide) && text(snapshot.firstSide) && ["axis", "allies"].includes(snapshot.firstSide)
    && text(snapshot.phase) && ["setup", "player-turn", "game-over"].includes(snapshot.phase);
}

// Spec 11 H: unknown position/nation/unit fields never enter the returned save.
function cleanSnapshot(value: JsonObject, scenario: Scenario): JsonObject {
  const fresh = newGame(scenario, 0);
  const optional = "unsuppliedAtStart combat countries air airbasesPlaced airFlown naval grayFleets moves sr exploit exploited attrition conquests keptHexes winter siberian soviet victory vitalPaid result".split(" ");
  const result = Object.fromEntries(Object.entries(value).filter(([key]) => Object.hasOwn(fresh, key) || optional.includes(key)));
  if (object(result.units)) result.units = Object.fromEntries(Object.entries(result.units).map(([id, unit]) => [id,
    object(unit) ? Object.fromEntries(Object.entries(unit).filter(([k]) => ["id", "owner", "nationality", "type", "strength", "movement", "at"].includes(k))) : unit]));
  if (object(result.nations)) result.nations = Object.fromEntries(Object.entries(result.nations)
    .filter(([id]) => Object.hasOwn(fresh.nations, id)).map(([id, nation]) => [id,
      object(nation) ? Object.fromEntries(Object.entries(nation).filter(([k]) =>
        Object.hasOwn(fresh.nations[id as keyof typeof fresh.nations], k) || k === "grantedThisYear")) : nation]));
  return result;
}
