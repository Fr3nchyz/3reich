import { describe, expect, it } from "vitest";
import { applyAction, legalActions, type Action } from "../src/engine/actions";
import { applyGrant, legalGrants } from "../src/engine/grants";
import { srOf } from "../src/engine/sr-record";
import { srGrantCost, srLeft } from "../src/engine/sr-rules";
import { neighborIds } from "../src/engine/attack-rules";
import { hex, hexsideId } from "../src/engine/hex";
import type { GameState, PowerId, Unit } from "../src/engine/types";
import { board, counter } from "./board";
import { CTX } from "./helpers";

// Ref 11.72, 11.71; spec 16 R21/R18; TODO(verify) AER30. All counters use real map hexes; grants need no sea escort in Beta.
const british = (id: string, at = "K23") => counter(id, "britain", "infantry", 3, at, 3);
function position(units: Unit[] = [], used = 0): GameState {
  const base = board([]);
  const nations = { ...base.nations };
  for (const id of ["britain", "france", "ussr", "usa"] as const) nations[id] = { ...nations[id], status: "allied", brpTotal: 200, spendLimit: 100, spent: 0, grantedThisYear: 0 };
  const s = board(units, undefined, { year: 1942, season: "spring", activeSide: "allies", nations,
    wars: [["germany", "britain"], ["germany", "france"], ["germany", "ussr"], ["germany", "usa"]],
    position: { part: "player-turn", turn: 2, step: "9a" } });
  return { ...s, sr: { ...srOf(s), used: { britain: used }, moved: ["prior-unit"], escorted: {} } };
}
const grant = (to: PowerId, amount: number): Extract<Action, { type: "GRANT_BRPS" }> => ({ type: "GRANT_BRPS", from: "britain", to, amount });
const ok = (r: ReturnType<typeof applyAction>) => { if (!r.ok) throw new Error(r.error); return r; };
const enemy = (at: string, type: Unit["type"] = "infantry") => counter("enemy", "germany", type, 3, at, 3);

describe("grants share the giver's Strategic Redeployment allowance (R21/R18; AER30)", () => {
  it.each([[1, 1], [20, 1], [21, 2], [40, 2], [45, 3]])("%i BRPs cost %i redeployments, rounding up", (amount, cost) => {
    expect(srGrantCost(amount)).toBe(cost);
    if (amount > 40) return; // Ref 11.71's existing single-recipient 40-BRP cap still applies.
    const s = position(); const result = ok(applyGrant(CTX, s, grant("usa", amount)));
    expect(srOf(result.state).used).toEqual({ britain: cost });
    expect(srOf(result.state).moved).toEqual(["prior-unit"]);
    expect(srOf(result.state).used.usa).toBeUndefined();
  });

  it("Britain grants 45 total to two recipients and uses three of its own redeployments", () => {
    const s = position([], 4);
    const first = ok(applyGrant(CTX, s, grant("usa", 25))).state;
    const after = ok(applyGrant(CTX, first, grant("ussr", 20))).state;
    expect(after.grants.reduce((n, g) => n + g.amount, 0)).toBe(45);
    expect(srOf(after).used).toEqual({ britain: 7 });
    expect(srLeft(srOf(after).used, "britain")).toBe(0);
    expect(applyGrant(CTX, s, grant("usa", 45))).toMatchObject({ ok: false });
  });

  it("with only two left, the grants totaling 45 cannot both be made", () => {
    const first = ok(applyGrant(CTX, position([], 5), grant("usa", 25))).state;
    expect(applyGrant(CTX, first, grant("ussr", 20))).toMatchObject({ ok: false, error: expect.stringMatching(/redeployments left/) });
    expect(legalGrants(CTX, first).some((g) => g.from === "britain")).toBe(false);
    const onlyOne = position([], 6);
    expect(legalGrants(CTX, onlyOne).filter((g) => g.from === "britain" && g.to === "usa").map((g) => g.amount)).toEqual([10, 20]);
  });

  it("a refused grant leaves the BRPs and shared record unchanged", () => {
    const s = position([], 7), before = JSON.stringify(s);
    expect(applyGrant(CTX, s, grant("usa", 1))).toMatchObject({ ok: false, error: expect.stringMatching(/redeployments left/) });
    expect(JSON.stringify(s)).toBe(before);
  });

  it("unit redeployments after a grant see its reduced allowance", () => {
    const initial = position([british("b1"), british("b2")], 4);
    const after = ok(applyGrant(CTX, initial, grant("usa", 40))).state;
    const at9e: GameState = { ...after, position: { part: "player-turn", turn: 2, step: "9e" } };
    expect(applyAction(CTX, at9e, { type: "SR_UNITS", side: "allies", units: ["b1", "b2"], to: "K24" })).toMatchObject({ ok: false, error: expect.stringMatching(/needs 2/) });
    const moved = ok(applyAction(CTX, at9e, { type: "SR_UNITS", side: "allies", units: ["b1"], to: "K24" })).state;
    expect(srOf(moved).used.britain).toBe(7);
    expect(legalActions(CTX, moved).some((a) => a.type === "SR_UNITS")).toBe(false);
  });

  it("a unit redeployment can spend the last allowance, then grants are refused", () => {
    const s = position([british("b1")], 6);
    const at9e: GameState = { ...s, position: { part: "player-turn", turn: 2, step: "9e" } };
    const moved = ok(applyAction(CTX, at9e, { type: "SR_UNITS", side: "allies", units: ["b1"], to: "K24" })).state;
    expect(srOf(moved).used.britain).toBe(7);
    expect(applyGrant(CTX, moved, grant("usa", 1)).ok).toBe(false);
  });

  it("a new Player Turn gets a fresh shared allowance without clearing the old record", () => {
    const s = position([], 7);
    expect(srOf({ ...s, activeSide: "axis" }).used).toEqual({});
    const next = { ...s, season: "summer" as const };
    expect(ok(applyGrant(CTX, next, grant("usa", 20))).state.sr!.used.britain).toBe(1);
  });
});

describe("capital-to-capital grants (R21; Ref 11.72; AER30)", () => {
  it.each([["K24", /Great Britain/], ["N22", /France/]] as const)("an enemy at %s blocks the giver or receiver", (at, message) => {
    const s = position([enemy(at)]);
    expect(applyGrant(CTX, s, grant("france", 10))).toMatchObject({ ok: false, error: expect.stringMatching(message) });
    expect(legalGrants(CTX, s).some((g) => g.from === "britain" && g.to === "france")).toBe(false);
    expect(legalActions(CTX, s).some((a) => a.type === "GRANT_BRPS" && a.from === "britain" && a.to === "france")).toBe(false);
  });

  it.each(["infantry", "replacement", "air", "fleet", "airbase"] as const)("the capital block includes an enemy %s, not just ground combat units", (type) => {
    const s = position([enemy("K24", type)]);
    expect(applyGrant(CTX, s, grant("usa", 10))).toMatchObject({ ok: false, error: expect.stringMatching(/next to.*capital/) });
  });

  it("the receiving U.S.S.R. ignores an enemy next to Moscow", () => {
    const s = position([enemy("G47")]);
    expect(ok(applyGrant(CTX, s, grant("ussr", 20))).state.nations.ussr.brpTotal).toBe(220);
    expect(legalGrants(CTX, s)).toContainEqual(grant("ussr", 20));
  });

  it("the Soviet receiver's exception does not excuse an enemy next to the giver's capital", () => {
    const s = position([enemy("K24"), { ...enemy("G47"), id: "enemy2" }]);
    expect(applyGrant(CTX, s, grant("ussr", 20))).toMatchObject({ ok: false, error: expect.stringMatching(/Great Britain/) });
    expect(applyGrant(CTX, s, { type: "GRANT_BRPS", from: "ussr", to: "britain", amount: 20 }).ok).toBe(false);
  });

  it.each(["surrender", "conquest"])("the Soviet exception ends after %s", (kind) => {
    const s = position([enemy("G47")]);
    const ended: GameState = kind === "surrender" ? { ...s, soviet: { citiesTaken: {}, offer: "accepted" } }
      : { ...s, conquests: [{ country: "ussr", by: "germany", side: "allies", how: "last-unit", at: { year: s.year, season: s.season } }] };
    expect(applyGrant(CTX, ended, grant("ussr", 10))).toMatchObject({ ok: false, error: expect.stringMatching(/surrender or conquest/) });
    expect(legalGrants(CTX, ended).some((g) => g.to === "ussr")).toBe(false);
  });

  it("a future enemy and a fleet across open water do not block the capital", () => {
    const neutral = position([counter("neutral", "italy", "infantry", 3, "K24", 3)]);
    expect(applyGrant(CTX, neutral, grant("usa", 10)).ok).toBe(true);
    const water = neighborIds(CTX, "Y22").find((at) => CTX.map.hexes[at]!.sea && !CTX.map.hexsides[hexsideId(hex("Y22"), hex(at))]?.land)!;
    expect(water).toBeDefined();
    const base = position([counter("enemy-fleet", "britain", "fleet", 9, water)]);
    const axis: GameState = { ...base, activeSide: "axis", nations: { ...base.nations, italy: { ...base.nations.italy, status: "axis", brpTotal: 100, spendLimit: 100, spent: 0 } }, wars: [...base.wars, ["italy", "britain"]] };
    expect(applyGrant(CTX, axis, { type: "GRANT_BRPS", from: "italy", to: "germany", amount: 10 }).ok).toBe(true);
  });
});
