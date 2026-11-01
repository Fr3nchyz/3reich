import { describe, expect, it } from "vitest";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { SCENARIO_1942 } from "../src/data/scenario-1942";
import { SCENARIO_1944 } from "../src/data/scenario-1944";
import { SCENARIO_CAMPAIGN } from "../src/data/scenario-campaign";
import { newGame } from "../src/engine/game";
import { fingerprint, sortedJson } from "../src/save/fingerprint";
import { MAX_ACTIONS, MAX_DEPTH, MAX_FILE_BYTES, MAX_STRING_LENGTH, STATE_VERSION } from "../src/save/format";
import type { JsonObject } from "../src/save/format";
import { readSave, snapshotHasFreshShape } from "../src/save/validate";

const scenarios = [SCENARIO_1939, SCENARIO_1942, SCENARIO_1944, SCENARIO_CAMPAIGN];
const state = (): JsonObject => JSON.parse(JSON.stringify(newGame(SCENARIO_1939, 1))) as JsonObject;
const fixture = (): JsonObject => ({
  format: 2, app: "3reich", title: "A game", savedAt: "2026-11-01T00:00:00.000Z", gameVersion: "old-build",
  stateVersion: STATE_VERSION, scenario: "1939", seed: 1, humanSide: "axis", start: { kind: "new" },
  actions: [{ type: "END_STEP", side: "axis", step: "10b" }], setupActions: 0,
  snapshot: state(), fingerprint: fingerprint(state()),
  ai: { targets: { u1: "M35" }, left: { u1: [{ hex: "M34", turn: 7756 }] } },
  logTail: ["A plain <line>"], note: "report",
});
const read = (value: unknown) => readSave(JSON.stringify(value), scenarios);

describe("spec 11 Parts A/B/H: save reader", () => {
  it("Part H: safety caps retain the specified values", () => {
    expect([MAX_FILE_BYTES, MAX_ACTIONS, MAX_STRING_LENGTH, MAX_DEPTH]).toEqual([4 * 1024 * 1024, 100_000, 200, 20]);
  });
  it("Part B: all fields round trip, optional fields may be absent, builds do not decide acceptance", () => {
    const file = fixture();
    expect(read(file)).toEqual({ ok: true, save: file });
    delete file.ai; delete file.logTail; delete file.note;
    file.humanSide = "allies"; file.seed = 0xffffffff;
    file.start = { kind: "snapshot", state: state() };
    expect(read(file)).toEqual({ ok: true, save: file });
    file.seed = 0;
    expect(read(file).ok).toBe(true);
  });
  it("Part H: ignores extra envelope, start and memory fields", () => {
    const file = fixture();
    file.extra = "ignored";
    file.start = { kind: "new", extra: true };
    file.ai = { targets: {}, left: {}, distances: {} };
    const result = read(file);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.save).not.toHaveProperty("extra");
      expect(result.save.start).toEqual({ kind: "new" });
      expect(result.save.ai).toEqual({ targets: {}, left: {} });
    }
  });
  it("Part A/H: replay input survives an unusable snapshot and a different semantic revision", () => {
    const file = fixture(); file.snapshot = {}; file.stateVersion = STATE_VERSION + 1;
    expect(read(file).ok).toBe(true);
    expect(snapshotHasFreshShape({}, SCENARIO_1939, STATE_VERSION)).toBe(false);
  });
  it("Part H: strips unknown action, unit, nation and snapshot fields", () => {
    const file = fixture();
    file.actions = [{ type: "SETUP_PLACE", owner: "germany", at: "M35",
      extra: true, unit: { type: "infantry", strength: 3, nationality: "germany", extra: true } }];
    const snapshot = file.snapshot as JsonObject;
    snapshot.extra = true;
    (snapshot.nations as JsonObject).unknown = {};
    ((snapshot.nations as JsonObject).germany as JsonObject).extra = true;
    snapshot.units = { u1: { id: "u1", owner: "germany", type: "infantry", strength: 3, at: "M35", extra: true } };
    const result = read(file);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.save.actions[0]).not.toHaveProperty("extra");
      expect(result.save.actions[0]!.unit).not.toHaveProperty("extra");
      expect(result.save.snapshot).not.toHaveProperty("extra");
      expect(result.save.snapshot.nations).not.toHaveProperty("unknown");
      expect((result.save.snapshot.nations as JsonObject).germany).not.toHaveProperty("extra");
      expect((result.save.snapshot.units as JsonObject).u1).not.toHaveProperty("extra");
    }
    file.extra = { ["x".repeat(201)]: true };
    expect(read(file).ok).toBe(false);
  });
  it.each(["format", "app", "title", "savedAt", "gameVersion", "stateVersion", "scenario", "seed", "humanSide", "start", "actions", "setupActions", "fingerprint", "snapshot"])(
    "Part B/H: requires %s", key => { const file = fixture(); delete file[key]; expect(read(file).ok).toBe(false); },
  );
  it.each([
    ["format", 0], ["app", "other"], ["title", "a".repeat(41)], ["title", 4],
    ["savedAt", "2026-02-30T00:00:00.000Z"], ["savedAt", "yesterday"], ["gameVersion", ""],
    ["stateVersion", 0], ["stateVersion", 1.5], ["seed", -1], ["seed", 0x100000000], ["seed", 1.5],
    ["seed", "1"], ["humanSide", "neutral"], ["start", { kind: "other" }], ["start", { kind: "snapshot", state: [] }],
    ["actions", {}], ["actions", [null]], ["actions", [{ type: "" }]], ["actions", [{ type: 1 }]],
    ["setupActions", 2], ["setupActions", -1], ["setupActions", 0.5], ["fingerprint", "xyz"], ["snapshot", []],
    ["ai", { targets: { u1: 4 }, left: {} }], ["ai", { targets: {}, left: { u1: [{ hex: "M35", turn: -1 }] } }],
    ["logTail", Array<string>(61).fill("line")], ["logTail", [4]], ["note", 4],
  ])("Part B/H: rejects invalid %s (%j)", (key, value) => {
    const file = fixture(); file[key] = value; expect(read(file).ok).toBe(false);
  });
  it("Part H: named errors for truncated JSON, future format, unknown scenario and legacy records", () => {
    expect(readSave("{", scenarios)).toMatchObject({ ok: false, code: "invalid", message: expect.stringContaining("incomplete") });
    expect(read({ ...fixture(), format: 3 })).toMatchObject({ code: "newer", message: expect.stringContaining("newer version") });
    expect(read({ ...fixture(), scenario: "unknown" })).toMatchObject({ code: "scenario" });
    expect(read({ ...fixture(), format: 1 })).toMatchObject({ code: "legacy" });
    expect(read({ ...fixture(), seed: "bad" })).toMatchObject({ code: "invalid", message: expect.stringContaining("'seed'") });
  });
  it.each(["__proto__", "constructor", "prototype"])("Part H: rejects forbidden %s anywhere, including ignored data", key => {
    expect(readSave(JSON.stringify(fixture()).replace('"report"', `{"${key}":{}}`), scenarios).ok).toBe(false);
    expect(readSave(`{"${key}":0}`, scenarios).ok).toBe(false);
    expect(read({ ...fixture(), extra: { [key]: {} } }).ok).toBe(false);
  });
  it("Part H: string, nesting and action caps include exact boundaries", () => {
    const file = fixture(); file.note = "x".repeat(200);
    expect(read(file).ok).toBe(true);
    file.note += "x"; expect(read(file).ok).toBe(false);
    let nested: JsonObject = {};
    for (let i = 1; i < MAX_DEPTH; i++) nested = { child: nested };
    file.note = ""; file.extra = nested;
    expect(read(file).ok).toBe(true);
    file.extra = { child: nested }; expect(read(file).ok).toBe(false);
    delete file.extra;
    file.actions = Array.from({ length: MAX_ACTIONS }, () => ({ type: "X" }));
    expect(read(file).ok).toBe(true);
    file.actions.push({ type: "X" }); expect(read(file)).toMatchObject({ code: "too-large" });
  });
  it("Part H: UTF-8 byte cap is checked before parse, including multibyte and surrogate pairs", () => {
    expect(readSave(" ".repeat(MAX_FILE_BYTES) + "{", scenarios)).toMatchObject({ code: "too-large" });
    expect(readSave("é".repeat(MAX_FILE_BYTES / 2 + 1), scenarios)).toMatchObject({ code: "too-large" });
    expect(readSave("😀".repeat(MAX_FILE_BYTES / 4 + 1), scenarios)).toMatchObject({ code: "too-large" });
    expect(readSave(" ".repeat(MAX_FILE_BYTES), scenarios)).toMatchObject({ code: "invalid" });
  });
});

describe("spec 11 Part A: fresh shape screening (not a state type assertion)", () => {
  it.each(scenarios)("Part A/I: fresh $id snapshot and JSON copy have the same shape", scenario => {
    const snapshot = JSON.parse(JSON.stringify(newGame(scenario, 1))) as JsonObject;
    expect(snapshotHasFreshShape(snapshot, scenario, STATE_VERSION)).toBe(true);
  });
  it("Part A/AER55: heterogeneous pools match fresh exemplars; malformed nested records do not", () => {
    for (const field of ["pools", "countries", "setup"]) {
      const snapshot = state();
      snapshot[field] = { broken: true };
      expect(snapshotHasFreshShape(snapshot, SCENARIO_1939, STATE_VERSION)).toBe(false);
    }
    const snapshot = state(); snapshot.setup = null;
    expect(snapshotHasFreshShape(snapshot, SCENARIO_1939, STATE_VERSION)).toBe(true);
    const pool = ((snapshot.pools as JsonObject).germany as JsonObject).forcePool as JsonObject[];
    pool[0]!.strength = "bad";
    expect(snapshotHasFreshShape(snapshot, SCENARIO_1939, STATE_VERSION)).toBe(false);
  });
  it("Part A/H: embedded separators cannot disguise missing nation fields", () => {
    const snapshot = state(); const nations = snapshot.nations as JsonObject;
    nations["britain\0france"] = nations.britain!;
    delete nations.britain; delete nations.france;
    expect(snapshotHasFreshShape(snapshot, SCENARIO_1939, STATE_VERSION)).toBe(false);
  });
  it("Part A: missing/extra top-level and nation fields, bad units, semantic versions are refused", () => {
    const snapshot = state();
    expect(snapshotHasFreshShape(snapshot, SCENARIO_1939, STATE_VERSION + 1)).toBe(false);
    delete snapshot.rngState;
    expect(snapshotHasFreshShape(snapshot, SCENARIO_1939, STATE_VERSION)).toBe(false);
    const extra = { ...state(), future: 1 };
    expect(snapshotHasFreshShape(extra, SCENARIO_1939, STATE_VERSION)).toBe(false);
    const nation = state(); (nation.nations as JsonObject).germany = {};
    expect(snapshotHasFreshShape(nation, SCENARIO_1939, STATE_VERSION)).toBe(false);
    const unit = state(); unit.units = { u1: { id: "u1", owner: "germany", type: "infantry", strength: 3, movement: 4, at: "M35" } };
    expect(snapshotHasFreshShape(unit, SCENARIO_1939, STATE_VERSION)).toBe(true);
    (unit.units.u1 as JsonObject).strength = "3";
    expect(snapshotHasFreshShape(unit, SCENARIO_1939, STATE_VERSION)).toBe(false);
    const fresh = newGame(SCENARIO_1939, 1);
    delete (fresh as unknown as JsonObject).year;
    expect(snapshotHasFreshShape(state(), SCENARIO_1939, STATE_VERSION, fresh)).toBe(false);
  });
});

describe("spec 11 Parts B/H/I: sorted-key fingerprint", () => {
  it("Part B/I: key order and JSON round trip are stable for all scenarios", () => {
    expect(sortedJson({ z: 1, a: { y: 2, b: 3 } })).toBe('{"a":{"b":3,"y":2},"z":1}');
    expect(fingerprint({ z: 1, a: 2 })).toBe(fingerprint({ a: 2, z: 1 }));
    for (const scenario of scenarios) {
      const fresh = newGame(scenario, 1);
      expect(fingerprint(fresh)).toBe(fingerprint(JSON.parse(JSON.stringify(fresh)) as JsonObject));
      expect(fingerprint(fresh)).not.toBe(fingerprint(newGame(scenario, 2)));
    }
    expect(fingerprint([1, 2])).not.toBe(fingerprint([2, 1]));
    expect(fingerprint(null)).toBe("77074ba4");
  });
  it("Part I/E3: refuses lossy non-JSON numbers, undefined and exotic objects", () => {
    for (const value of [NaN, Infinity, undefined, new Map(), new Set()]) {
      expect(() => fingerprint(value as unknown as JsonObject)).toThrow();
    }
  });
});
