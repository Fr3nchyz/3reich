import { expect, it, vi } from "vitest";
import { newGame } from "../src/engine/game";
import { CTX } from "./helpers";
import { fingerprint } from "../src/save/fingerprint";
import { MAX_ACTIONS, MAX_FILE_BYTES } from "../src/save/format";
import { restore } from "../src/save/restore";
import { createMemoryStore } from "../src/save/memoryStore";

const state = newGame(CTX.scenario, 1);
const file = (patch: Record<string, unknown> = {}): string => JSON.stringify({ format: 2, app: "3reich", title: "Test",
  savedAt: "2026-11-01T00:00:00.000Z", gameVersion: "old", stateVersion: 1,
  scenario: CTX.scenario.id, seed: 1, humanSide: "axis", start: { kind: "new" },
  actions: [], setupActions: 0, fingerprint: fingerprint(state), snapshot: state, ...patch });

it.each([
  ["truncated", (): string => "{", "invalid", /incomplete|not a/],
  ["future format", (): string => file({ format: 3 }), "newer", /newer version/],
  ["old record", (): string => file({ format: 1 }), "legacy", /record|format|saved game/i],
  ["unknown scenario", (): string => file({ scenario: "unknown" }), "scenario", /scenario/],
  ["wrong seed", (): string => file({ seed: "one" }), "invalid", /seed/],
  ["forbidden key", (): string => file().replace('"title":"Test"', '"__proto__":{},"title":"Test"'), "invalid", /damaged|forbidden/i],
  ["oversize", (): string => " ".repeat(MAX_FILE_BYTES + 1), "too-large", /too large/],
  ["action cap", (): string => file({ actions: Array.from({ length: MAX_ACTIONS + 1 }, () => ({ type: "x" })) }), "too-large", /too large/],
  ["deep nesting", (): string => file({ extra: Array.from({ length: 25 }).reduce<unknown>(v => [v], 0) }), "invalid", /damaged|deep/i],
  ["refused action", (): string => file({ actions: [{ type: "unknown" }], snapshot: {} }), "action", /action 1 was refused/],
  ["missing snapshot field", (): string => file({ fingerprint: "00000000", snapshot: { ...state, nations: undefined } }), "fingerprint", /no longer matches/],
] as const)("spec 11 Parts A/H/I: %s refused with words and no storage writes", async (_name, source, code, message) => {
  const store = createMemoryStore();
  const put = vi.spyOn(store, "put");
  const original = await store.list();
  const result = await restore(source(), CTX, { now: () => 0, yield: async () => {},
    cancelled: () => false, validateSnapshot: () => undefined });
  expect(result).toMatchObject({ kind: "refused", code, message: expect.stringMatching(message) });
  expect(put).not.toHaveBeenCalled();
  expect(await store.list()).toEqual(original);
});

it("spec 11 Parts A/H/I AER55: old illegal record offers consent rescue; missing fresh field refuses", async () => {
  const options = { now: () => 0, yield: async () => {}, cancelled: () => false,
    // Spec 11 A/AER55: accept only this known engine-created fixture, not arbitrary snapshots.
    validateSnapshot: (value: unknown) => fingerprint(value) === fingerprint(state) ? structuredClone(state) : undefined };
  const result = await restore(file({ actions: [{ type: "unknown" }] }), CTX, options);
  expect(result).toMatchObject({ kind: "rescue", state, save: { actions: [], setupActions: 0,
    start: { kind: "snapshot", state } }, message: expect.stringContaining("rules as they are now?") });
  const { rngState: omitted, ...oldState } = state;
  expect(omitted).toBeDefined();
  const refused = await restore(file({ actions: [{ type: "unknown" }], snapshot: oldState }), CTX, options);
  expect(refused).toMatchObject({ kind: "refused", code: "action", message: expect.stringContaining("action 1") });
});
