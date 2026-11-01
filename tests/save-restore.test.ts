import { describe, expect, it, vi, afterEach } from "vitest";
import * as engine from "../src/engine/actions";
import { newGame } from "../src/engine/game";
import type { GameState } from "../src/engine/types";
import { fingerprint } from "../src/save/fingerprint";
import type { JsonObject } from "../src/save/format";
import { restore, RESTORE_BUDGET_MS, RESTORE_SLICE_MS, type RestoreOptions } from "../src/save/restore";
import { CTX } from "./helpers";

const fresh = () => newGame(CTX.scenario, 1);
const json = (s: GameState): JsonObject => JSON.parse(JSON.stringify(s)) as JsonObject;
function file(overrides: JsonObject = {}) {
  return JSON.stringify({ format: 2, app: "3reich", title: "Test", savedAt: "2026-11-01T00:00:00.000Z",
    gameVersion: "old", stateVersion: 1, scenario: CTX.scenario.id, seed: 1, humanSide: "axis",
    start: { kind: "new" }, actions: [], setupActions: 0, snapshot: json(fresh()), fingerprint: fingerprint(fresh()),
    ai: { targets: {}, left: {} }, ...overrides });
}
// Spec 11 A/AER55: this fixture validator accepts only the known fresh position, never an unchecked cast.
const options = (overrides: Partial<RestoreOptions> = {}): RestoreOptions => ({
  now: () => 0, yield: async () => {}, cancelled: () => false,
  validateSnapshot: value => fingerprint(value) === fingerprint(fresh()) ? fresh() : undefined, ...overrides,
});
afterEach(() => vi.restoreAllMocks());

describe("spec 11 restore", () => {
  it("Part H: keeps specified time budgets", () => {
    expect(RESTORE_SLICE_MS).toBe(40); expect(RESTORE_BUDGET_MS).toBe(20_000);
  });
  it("Part A/B: exact replay ignores unusable snapshot/version and preserves memory and record", async () => {
    const state = fresh();
    const action = engine.legalActions(CTX, state)[0]!;
    const next = engine.applyAction(CTX, state, action);
    expect(next.ok).toBe(true); if (!next.ok) return;
    const source = file({ actions: [action], fingerprint: fingerprint(next.state), snapshot: {}, stateVersion: 2 });
    const result = await restore(source, CTX, options());
    expect(result).toMatchObject({ kind: "opened", via: "replay", state: next.state,
      save: { actions: [action], ai: { targets: {}, left: {} } } });
  });
  it("Part H: reader errors are refused data", async () => {
    expect(await restore("{", CTX, options())).toMatchObject({ kind: "refused", code: "invalid" });
    expect(await restore(file({ format: 1 }), CTX, options())).toMatchObject({ code: "legacy" });
  });
  it("Part A/B: refusal offers rescue with restarted record and explicit consent words", async () => {
    const result = await restore(file({ actions: [{ type: "unknown" }] }), CTX, options());
    expect(result).toMatchObject({ kind: "rescue", state: fresh(), save: {
      start: { kind: "snapshot", state: json(fresh()) }, actions: [], setupActions: 0,
    }, message: expect.stringContaining("rules as they are now?") });
  });
  it("Part H: refused action identifies its one-based number", async () => {
    expect(await restore(file({ actions: [{ type: "unknown" }], snapshot: {} }), CTX, options()))
      .toMatchObject({ kind: "refused", code: "action", message: expect.stringContaining("action 1 was refused") });
  });
  it("Part H: thrown action is damaged data", async () => {
    vi.spyOn(engine, "applyAction").mockImplementation(() => { throw new Error("bad"); });
    expect(await restore(file({ actions: [{ type: "unknown" }], snapshot: {} }), CTX, options()))
      .toMatchObject({ kind: "refused", code: "damaged", message: expect.stringContaining("action 1") });
  });
  it("Part A: fingerprint mismatch offers rescue even if snapshot matches its fingerprint", async () => {
    vi.spyOn(engine, "applyAction").mockReturnValue({ ok: true, state: { ...fresh(), rngState: 2 }, events: [] });
    expect(await restore(file({ actions: [{ type: "unknown" }] }), CTX, options())).toMatchObject({ kind: "rescue" });
    expect(await restore(file({ fingerprint: "00000000", snapshot: {} }), CTX, options())).toMatchObject({ code: "fingerprint" });
  });
  it("Part A/AER55: incompatible shape, rejected, throwing, and altered validation cannot rescue", async () => {
    for (const opt of [options({ validateSnapshot: () => undefined }), options({ validateSnapshot: () => { throw Error(); } }),
      options({ validateSnapshot: () => ({ ...fresh(), rngState: 2 }) })]) {
      expect(await restore(file({ fingerprint: "00000000" }), CTX, opt)).toMatchObject({ kind: "refused" });
    }
    const validateSnapshot = vi.fn(() => fresh());
    expect(await restore(file({ fingerprint: "00000000", stateVersion: 2 }), CTX, options({ validateSnapshot })))
      .toMatchObject({ kind: "refused" });
    expect(validateSnapshot).not.toHaveBeenCalled();
  });
  it("Part B: snapshot starts are validated before replay", async () => {
    expect(await restore(file({ start: { kind: "snapshot", state: json(fresh()) } }), CTX, options()))
      .toMatchObject({ kind: "opened", via: "replay" });
    expect(await restore(file({ start: { kind: "snapshot", state: {} }, snapshot: {} }), CTX, options()))
      .toMatchObject({ kind: "refused", code: "start" });
  });
  it("Part H: slices yield and report progress without losing actions", async () => {
    let time = 0;
    const progress = vi.fn(); const yieldSlice = vi.fn(async () => {});
    vi.spyOn(engine, "applyAction").mockImplementation(() => { time += 40; return { ok: true, state: fresh(), events: [] }; });
    expect(await restore(file({ actions: [{ type: "x" }, { type: "x" }, { type: "x" }] }), CTX,
      options({ now: () => time, yield: yieldSlice, progress }))).toMatchObject({ kind: "opened" });
    expect(yieldSlice).toHaveBeenCalledTimes(2);
    expect(progress.mock.calls).toEqual([[0, 3], [1, 3], [2, 3], [3, 3]]);
  });
  it("Part H: budget uses matching snapshot, offers mismatching rescue, refuses unusable snapshot", async () => {
    const now = () => { let calls = 0; return () => calls++ === 0 ? 0 : 20_000; };
    expect(await restore(file(), CTX, options({ now: now() }))).toMatchObject({ kind: "opened", via: "snapshot" });
    expect(await restore(file({ fingerprint: "00000000" }), CTX, options({ now: now() }))).toMatchObject({ kind: "rescue" });
    expect(await restore(file({ snapshot: {} }), CTX, options({ now: now() }))).toMatchObject({ code: "budget", message: "Opening took too long and was stopped." });
  });
  it("Part H: Cancel stops before work, after yielding, and after the final action", async () => {
    const apply = vi.spyOn(engine, "applyAction");
    expect(await restore(file(), CTX, options({ cancelled: () => true }))).toMatchObject({ code: "cancelled" });
    expect(apply).not.toHaveBeenCalled();
    let time = 0; let cancelled = false;
    apply.mockImplementation(() => { time += 40; return { ok: true, state: fresh(), events: [] }; });
    const opt = options({ now: () => time, cancelled: () => cancelled, yield: () => { cancelled = true; return Promise.resolve(); } });
    expect(await restore(file({ actions: [{ type: "x" }, { type: "x" }] }), CTX, opt)).toMatchObject({ code: "cancelled" });
    expect(apply).toHaveBeenCalledTimes(1);
    cancelled = false; apply.mockImplementation(() => { cancelled = true; return { ok: true, state: fresh(), events: [] }; });
    expect(await restore(file({ actions: [{ type: "x" }] }), CTX, opt)).toMatchObject({ code: "cancelled" });
  });
  it("Part H: budget includes slow final actions and time spent yielding", async () => {
    let time = 0;
    const apply = vi.spyOn(engine, "applyAction").mockImplementation(() => {
      time = 20_000; return { ok: true, state: fresh(), events: [] };
    });
    expect(await restore(file({ actions: [{ type: "x" }] }), CTX, options({ now: () => time })))
      .toMatchObject({ kind: "opened", via: "snapshot" });
    time = 0;
    apply.mockImplementation(() => { time += 40; return { ok: true, state: fresh(), events: [] }; });
    apply.mockClear();
    expect(await restore(file({ actions: [{ type: "x" }, { type: "x" }] }), CTX,
      options({ now: () => time, yield: () => { time = 20_000; return Promise.resolve(); } })))
      .toMatchObject({ kind: "opened", via: "snapshot" });
    expect(apply).toHaveBeenCalledTimes(1);
  });

});
