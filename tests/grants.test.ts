import { describe, expect, it } from "vitest";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { SCENARIO_1942 } from "../src/data/scenario-1942";
import { applyAction, legalActions, replay, type Action } from "../src/engine/actions";
import { GRANT_LIMIT, grantRoom, legalGrants } from "../src/engine/grants";
import type { GameContext } from "../src/engine/context";
import type { GameState, PowerId } from "../src/engine/types";
import { atStart, ctxFor } from "./helpers";

/** Spec 02: BRP grants at step 9a (Ref 11.71). */

const ok = (r: ReturnType<typeof applyAction>) => {
  if (!r.ok) throw new Error(r.error);
  return r;
};
const grant = (ctx: GameContext, s: GameState, from: PowerId, to: PowerId, amount: number) => applyAction(ctx, s, { type: "GRANT_BRPS", from, to, amount });

/** 1942, the Allied turn, waiting at step 9a. */
const ctx42 = ctxFor(SCENARIO_1942);
const allied42 = (): GameState => ({ ...atStart(SCENARIO_1942, 1), activeSide: "allies", position: { part: "player-turn", turn: 2, step: "9a" } });
/** 1939, the Allied turn, waiting at step 9a. */
const allied39 = (): GameState => ({ ...atStart(SCENARIO_1939, 1), activeSide: "allies", position: { part: "player-turn", turn: 2, step: "9a" } });

describe("a grant", () => {
  it("moves BRPs from the giver to the receiver, within the giver's spending limit, and says so", () => {
    const s = allied42();
    const britain = s.nations.britain.brpTotal;
    const ussr = s.nations.ussr.brpTotal;
    const r = ok(grant(ctx42, s, "britain", "ussr", 10));
    expect(r.state.nations.britain).toMatchObject({ brpTotal: britain - 10, spent: 10 });
    expect(r.state.nations.ussr.brpTotal).toBe(ussr + 10);
    expect(r.events).toEqual([
      { type: "BRPS_CHANGED", nation: "britain", delta: -10, total: britain - 10, reason: "a grant to ussr" },
      { type: "BRPS_CHANGED", nation: "ussr", delta: 10, total: ussr + 10, reason: "a grant from britain" },
      { type: "BRPS_GRANTED", from: "britain", to: "ussr", amount: 10 },
    ]);
  });

  it("is capped at 40 BRPs to one allied Major Power in a turn", () => {
    let s = allied42();
    expect(grantRoom(s, "usa", "britain")).toBe(GRANT_LIMIT);
    s = ok(grant(ctx42, s, "usa", "britain", 25)).state;
    expect(grantRoom(s, "usa", "britain")).toBe(15);
    expect(grant(ctx42, s, "usa", "britain", 16)).toMatchObject({ ok: false });
    s = ok(grant(ctx42, s, "usa", "britain", 15)).state;
    expect(grantRoom(s, "usa", "britain")).toBe(0);
    expect(grant(ctx42, s, "usa", "britain", 1)).toMatchObject({ ok: false });
  });

  it("counts the Western Allies together when it is the U.S.S.R. that receives", () => {
    let s = allied42();
    s = ok(grant(ctx42, s, "britain", "ussr", 25)).state;
    expect(grantRoom(s, "usa", "ussr")).toBe(15);
    expect(grantRoom(s, "britain", "ussr")).toBe(15);
    s = ok(grant(ctx42, s, "usa", "ussr", 15)).state;
    expect(grantRoom(s, "britain", "ussr")).toBe(0);
  });

  it("is limited by what the giver may still spend this turn, which construction also uses", () => {
    const s = allied42();
    const tight = { ...s, nations: { ...s.nations, britain: { ...s.nations.britain, spent: s.nations.britain.spendLimit - 7 } } };
    expect(grantRoom(tight, "britain", "ussr")).toBe(7);
    const over = grant(ctx42, tight, "britain", "ussr", 8);
    expect(over.ok).toBe(false);
    expect(!over.ok && over.error).toMatch(/at most 7/);
  });

  it("may not be handed back by the receiver for the rest of the game", () => {
    const s = ok(grant(ctx42, allied42(), "britain", "ussr", 10)).state;
    expect(s.noGrants).toContainEqual(["ussr", "britain"]);
    expect(grantRoom(s, "ussr", "britain")).toBe(0);
    expect(grant(ctx42, s, "ussr", "britain", 10)).toMatchObject({ ok: false });
    // ...and the block outlives the turn: a new Player Turn clears the turn's grants, not this.
    const next = { ...s, grants: [] };
    expect(grantRoom(next, "ussr", "britain")).toBe(0);
  });

  it("needs allied Major Powers on the side to move", () => {
    const s = allied42();
    expect(grantRoom(s, "britain", "germany")).toBe(0);
    expect(grantRoom(s, "germany", "italy")).toBe(0); // the Axis is not up
    expect(grantRoom(s, "britain", "britain")).toBe(0);
    expect(grant(ctx42, s, "britain", "germany", 10)).toMatchObject({ ok: false });
    expect(grant(ctx42, s, "poland" as never, "britain", 10)).toMatchObject({ ok: false });
  });

  it("is refused for the U.S.S.R. until it is at war with Germany, and for France and the U.S. before Spring 1942", () => {
    const s = allied39();
    expect(grantRoom(s, "britain", "france")).toBeGreaterThan(0);
    expect(grantRoom(s, "france", "britain")).toBe(0);
    const ussr = { ...s, nations: { ...s.nations, ussr: { ...s.nations.ussr, status: "allied" as const } } };
    expect(grantRoom(ussr, "britain", "ussr")).toBe(0);
    expect(grantRoom(ussr, "ussr", "britain")).toBe(0);
    const war = { ...ussr, wars: [...ussr.wars, ["ussr", "germany"] as [PowerId, PowerId]] };
    expect(grantRoom(war, "britain", "ussr")).toBeGreaterThan(0);
    const usa = { ...s, nations: { ...s.nations, usa: { ...s.nations.usa, status: "allied" as const } } };
    expect(grantRoom(usa, "usa", "britain")).toBe(0);
    expect(grantRoom({ ...usa, year: 1942 }, "usa", "britain")).toBeGreaterThan(0);
  });

  it("is refused outside step 9a, naming the step", () => {
    const s = { ...allied42(), position: { part: "player-turn" as const, turn: 2 as const, step: "8b" } };
    const r = grant(ctx42, s, "britain", "ussr", 10);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/BRP grants are made in step 9a.*step 8b/);
    expect(grant(ctx42, s, "britain", "ussr", 0)).toMatchObject({ ok: false });
  });

  it("is offered in steps of 10 BRPs, plus the exact room, only at 9a", () => {
    let s = allied42();
    const options = legalGrants(s).filter((g) => g.from === "britain" && g.to === "ussr").map((g) => g.amount);
    expect(options).toEqual([10, 20, 30, 40]);
    const tight = { ...s, nations: { ...s.nations, britain: { ...s.nations.britain, spent: s.nations.britain.spendLimit - 25 } } };
    expect(legalGrants(tight).filter((g) => g.from === "britain" && g.to === "ussr").map((g) => g.amount)).toEqual([10, 20, 25]);
    expect(legalActions(ctx42, s).at(-1)).toMatchObject({ type: "END_STEP", step: "9a" });
    s = { ...s, position: { part: "player-turn", turn: 2, step: "10b" } };
    expect(legalActions(ctx42, s).some((a) => a.type === "GRANT_BRPS")).toBe(false);
  });

  it("a new Player Turn clears the turn's grants and spending", () => {
    const s = ok(grant(ctx42, allied42(), "britain", "ussr", 40)).state;
    expect(grantRoom(s, "britain", "ussr")).toBe(0);
    const at10b = { ...s, position: { part: "player-turn" as const, turn: 2 as const, step: "10b" } };
    const next = ok(applyAction(ctx42, at10b, { type: "END_PLAYER_TURN", side: "allies" })).state;
    expect(next.grants).toEqual([]);
    expect(next.nations.britain.spent).toBe(0);
  });

  it("replays exactly", () => {
    const initial = allied42();
    const actions: Action[] = [
      { type: "GRANT_BRPS", from: "britain", to: "ussr", amount: 20 },
      { type: "GRANT_BRPS", from: "usa", to: "britain", amount: 30 },
    ];
    const a = replay(ctx42, initial, actions).state;
    expect(replay(ctx42, initial, actions).state).toEqual(a);
    expect(a.nations.britain.brpTotal).toBe(initial.nations.britain.brpTotal - 20 + 30);
  });
});
