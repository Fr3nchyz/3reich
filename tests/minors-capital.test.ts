import { describe, expect, it } from "vitest";
import { newGame } from "../src/engine/game";
import { applyCapitalBrpsMove, capitalAnswerWindow, capitalLostProblem, type CapitalBrpsRecord } from "../src/engine/minors-capital";
import { capitalOf } from "../src/engine/minors-rules";
import type { GameState } from "../src/engine/types";
import { CTX } from "./helpers";
const capital = capitalOf(CTX, "hungary")!;
const base = (): GameState => ({ ...newGame(CTX.scenario, 1), phase: "player-turn", year: 1941, season: "summer", firstSide: "allies", activeSide: "allies", position: { part: "player-turn", turn: 1, step: "7p" }, minorAllies: [{ owner: "hungary", of: "germany", active: true }], control: { [capital]: "britain" } });
const paid: CapitalBrpsRecord = { paid: { year: 1941, amount: 10 } };
const loss = () => capitalAnswerWindow(CTX, base(), "hungary", paid).record;
const answer = (): GameState => ({ ...base(), activeSide: "axis", position: { part: "player-turn", turn: 2, step: "7p" } });
describe("spec 15 R13 / Ref 16.0 capital answer", () => {
  it("R13 limits losses to active allies and hostile controlled capitals", () => {
    expect(capitalLostProblem(CTX, base(), "hungary")).toBeNull();
    expect(capitalLostProblem(CTX, { ...base(), minorAllies: [] }, "hungary")).not.toBeNull();
    expect(capitalLostProblem(CTX, { ...base(), minorAllies: [{ owner: "hungary", of: "germany", active: false }] }, "hungary")).not.toBeNull();
    for (const holder of [null, "germany", "hungary"] as const) expect(capitalLostProblem(CTX, { ...base(), control: { [capital]: holder } }, "hungary")).not.toBeNull();
  });
  it("R13/MC20 starts on observation and waits for the owner's Combat Phase end", () => {
    expect(capitalAnswerWindow(CTX, base(), "hungary", paid).status).toBe("waiting");
    expect(loss().loss).toEqual({ owner: "germany", at: { year: 1941, season: "summer" }, answer: { year: 1941, season: "summer" } });
    expect(capitalAnswerWindow(CTX, { ...answer(), position: { part: "player-turn", turn: 2, step: "6a" } }, "hungary", loss()).status).toBe("waiting");
    expect(capitalAnswerWindow(CTX, answer(), "hungary", loss()).status).toBe("due");
  });
  it("R13/MC20 loss after the owner's turn waits through Winter to Spring", () => {
    const s = { ...base(), season: "winter" as const, firstSide: "axis" as const };
    const r = capitalAnswerWindow(CTX, s, "hungary", paid).record;
    expect(r.loss?.answer).toEqual({ year: 1942, season: "spring" });
    expect(capitalAnswerWindow(CTX, { ...answer(), season: "winter" }, "hungary", r).status).toBe("waiting");
    expect(capitalAnswerWindow(CTX, { ...answer(), year: 1942, season: "spring" }, "hungary", r).status).toBe("due");
  });
  it("R13 recapture by the owner's side clears the clock; a new loss starts fresh", () => {
    const r = capitalAnswerWindow(CTX, { ...answer(), control: { [capital]: "hungary" } }, "hungary", loss());
    expect(r.status).toBe("safe"); expect(r.record).toEqual(paid);
    expect(capitalAnswerWindow(CTX, { ...base(), season: "fall" }, "hungary", r.record).record.loss?.at.season).toBe("fall");
  });
  it("R13 transfers once, conserving BRPs with ledger events and no other changes", () => {
    const s = answer(); const snapshot = structuredClone(s); const r = loss();
    const done = applyCapitalBrpsMove(CTX, s, "hungary", r);
    expect(done.state.nations.germany).toEqual({ ...s.nations.germany, brpTotal: s.nations.germany.brpTotal - 10 });
    expect(done.state.nations.britain).toEqual({ ...s.nations.britain, brpTotal: s.nations.britain.brpTotal + 10 });
    expect(done.state).toEqual({ ...s, nations: { ...s.nations, germany: done.state.nations.germany, britain: done.state.nations.britain } });
    expect(done.events.map((e) => e.type === "BRPS_CHANGED" && [e.nation, e.delta, e.total])).toEqual([["germany", -10, done.state.nations.germany.brpTotal], ["britain", 10, done.state.nations.britain.brpTotal]]);
    expect(s).toEqual(snapshot); expect(r).toEqual(loss());
    expect(applyCapitalBrpsMove(CTX, done.state, "hungary", done.record)).toEqual({ state: done.state, events: [], record: done.record });
  });
  it("R13/MC20 uncontrolled capital preserves the clock and no position cannot expire it", () => {
    expect(capitalAnswerWindow(CTX, { ...answer(), control: { [capital]: null } }, "hungary", loss())).toEqual({ status: "waiting", record: loss() });
    expect(capitalAnswerWindow(CTX, { ...answer(), position: null }, "hungary", loss()).status).toBe("waiting");
  });
  it("R13 unpaid, previous-year and invalid payments cost nothing", () => {
    for (const payment of [undefined, { year: 1940, amount: 10 }, { year: 1941, amount: -1 }, { year: 1941, amount: 0.5 }]) {
      const s = answer(); expect(applyCapitalBrpsMove(CTX, s, "hungary", { ...loss(), paid: payment }).state).toBe(s);
    }
  });
  it("R13/MC20 caps both sides of transfer at available BRPs", () => {
    const s = answer(); s.nations = { ...s.nations, germany: { ...s.nations.germany, brpTotal: 3 } };
    const done = applyCapitalBrpsMove(CTX, s, "hungary", loss());
    expect(done.state.nations.germany.brpTotal).toBe(0); expect(done.state.nations.britain.brpTotal).toBe(s.nations.britain.brpTotal + 3);
  });
  it("R13 uses the current holder and routes an active ally to its protector", () => {
    const s: GameState = { ...answer(), minorAllies: [...answer().minorAllies, { owner: "spain", of: "britain", active: true }], control: { [capital]: "spain" } };
    expect(applyCapitalBrpsMove(CTX, s, "hungary", loss()).state.nations.britain.brpTotal).toBe(s.nations.britain.brpTotal + 10);
  });
  it("R13 has no transfer before expiry, after recapture or without an active ally", () => {
    for (const s of [base(), { ...answer(), control: { [capital]: "germany" as const } }, { ...answer(), minorAllies: [] }]) expect(applyCapitalBrpsMove(CTX, s, "hungary", loss()).state).toBe(s);
  });
});
