import { describe, expect, it } from "vitest";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { SCENARIO_1942 } from "../src/data/scenario-1942";
import { SCENARIO_1944 } from "../src/data/scenario-1944";
import { applyAction, legalActions, replay, type Action } from "../src/engine/actions";
import { charge, resetSpending, spend, spendable } from "../src/engine/brps";
import { initiativeTotals } from "../src/engine/game";
import { spendingLimit } from "../src/engine/nations";
import { BRP_COSTS } from "../src/engine/tables";
import type { Combatant, GameState, PowerId } from "../src/engine/types";
import { atWar, declarationTargets, isMajorPower, sideOfPower } from "../src/engine/war";
import { CTX, atStart, ctxFor, endTurn, started } from "./helpers";

/** Spec 02, first part: the BRP ledger, the spending limit and declarations of war. */

const withNation = (s: GameState, id: PowerId, patch: Partial<GameState["nations"][PowerId]>): GameState => ({
  ...s,
  nations: { ...s.nations, [id]: { ...s.nations[id], ...patch } },
});
const declare = (s: GameState, by: PowerId, on: Combatant) =>
  applyAction(CTX, s, { type: "DECLARE_WAR", by, on });
const ok = (r: ReturnType<typeof applyAction>) => {
  if (!r.ok) throw new Error(r.error);
  return r;
};

describe("the spending limit (Ref 10.0)", () => {
  it("is half the total at the start of the year, fractions rounded down, and fixed for the year", () => {
    const s = atStart(SCENARIO_1939, 1);
    expect(Object.fromEntries(Object.values(s.nations).map((n) => [n.id, spendingLimit(n)]))).toEqual({
      france: 42, britain: 62, usa: 135, ussr: 45, germany: 75, italy: 37,
    });
    const after = ok(declare(s, "germany", "norway")).state;
    expect(after.nations.germany.brpTotal).toBe(140);
    expect(spendingLimit(after.nations.germany)).toBe(75);
  });

  it("ledger: spending lowers the total and uses up the turn's limit", () => {
    const s = atStart(SCENARIO_1939, 1);
    const r = spend(s, "germany", 30, "a test");
    expect(r.ok && r.state.nations.germany).toMatchObject({ brpTotal: 120, spent: 30 });
    expect(r.ok && r.event).toEqual({ type: "BRPS_CHANGED", nation: "germany", delta: -30, total: 120, reason: "a test" });
    expect(spendable(r.ok ? r.state.nations.germany : s.nations.germany)).toBe(45);
  });

  it("ledger: refuses an overspend with a message naming the limit, and never goes below zero", () => {
    const s = atStart(SCENARIO_1939, 1);
    const over = spend(s, "germany", 76, "a big thing");
    expect(!over.ok && over.error).toMatch(/may spend only 75 in a Player Turn/);
    const poor = withNation(s, "germany", { brpTotal: 20, spendLimit: 75 });
    expect(spend(poor, "germany", 21, "x")).toMatchObject({ ok: false });
    expect(spendable(poor.nations.germany)).toBe(20);
    expect(spend(s, "germany", -1, "x")).toMatchObject({ ok: false });
    expect(spend(s, "germany", 1.5, "x")).toMatchObject({ ok: false });
  });

  it("ledger: a charge the rules make needs no room under the limit, but stops at zero", () => {
    const s = withNation(atStart(SCENARIO_1939, 1), "germany", { spent: 75 });
    const c = charge(s, "germany", 35, "a scenario rule");
    expect(c.state.nations.germany).toMatchObject({ brpTotal: 115, spent: 75 });
    const broke = charge(withNation(s, "germany", { brpTotal: 10 }), "germany", 35, "x");
    expect(broke.state.nations.germany.brpTotal).toBe(0);
    expect(broke.event).toMatchObject({ delta: -10 });
  });

  it("starts again from nothing at each Player Turn", () => {
    const s = ok(declare(atStart(SCENARIO_1939, 1), "germany", "norway")).state;
    expect(s.nations.germany.spent).toBe(10);
    const next = ok(endTurn(CTX, s)).state; // the Allied Player Turn begins
    expect(next.activeSide).toBe("allies");
    expect(next.nations.germany.spent).toBe(0);
    expect(resetSpending(s).nations.germany.spent).toBe(0);
  });
});

describe("declarations of war (Ref 13.0)", () => {
  it("cost 10 BRPs against a minor country and 35 against a Major Power", () => {
    expect(BRP_COSTS).toMatchObject({ declareWarOnMinorCountry: 10, declareWarOnMajorPower: 35 });
    const s = atStart(SCENARIO_1939, 1);
    const minor = ok(declare(s, "germany", "norway"));
    expect(minor.state.nations.germany.brpTotal).toBe(140);
    expect(minor.events).toEqual([
      { type: "BRPS_CHANGED", nation: "germany", delta: -10, total: 140, reason: "declaring war on Norway" },
      { type: "WAR_DECLARED", by: "germany", on: "norway", cost: 10 },
    ]);
    const major = ok(declare(s, "germany", "ussr"));
    expect(major.state.nations.germany.brpTotal).toBe(115);
    expect(atWar(major.state, "germany", "ussr")).toBe(true);
    expect(atWar(major.state, "ussr", "germany")).toBe(true);
  });

  it("make the war part of the state, and count for the Initiative", () => {
    const before = atStart(SCENARIO_1939, 1);
    const s = ok(declare(before, "germany", "ussr")).state;
    expect(s.wars).toContainEqual(["germany", "ussr"]);
    // Germany paid 35 and the Soviet BRPs now count for the Allies (Ref 11.1): 210 + 90.
    expect(initiativeTotals(before)).toEqual({ axis: 225, allies: 210 });
    expect(initiativeTotals(s)).toEqual({ axis: 190, allies: 300 });
  });

  it("bring a neutral Major Power into the war on its own side", () => {
    const before = atStart(SCENARIO_1939, 1);
    const s = ok(declare(before, "germany", "ussr")).state;
    expect(before.nations.ussr.status).toBe("neutral");
    expect(s.nations.ussr.status).toBe("allied");
    expect(s.nations.usa.status).toBe("neutral");
    // Attacked by the Allies, Italy joins the Axis.
    const allied = { ...before, activeSide: "allies" as const };
    const italy = ok(applyAction(CTX, allied, { type: "DECLARE_WAR", by: "britain", on: "italy" })).state;
    expect(italy.nations.italy.status).toBe("axis");
    // A minor country has no status to change.
    expect(ok(declare(before, "germany", "norway")).state.nations).toEqual({ ...before.nations, germany: { ...before.nations.germany, brpTotal: 140, spent: 10 } });
  });

  it("leave out a Major Power that is out of the game or Vichy", () => {
    const s = atStart(SCENARIO_1939, 1);
    const out = { ...s, activeSide: "allies" as const, nations: { ...s.nations, italy: { ...s.nations.italy, status: "out" as const } } };
    expect(declarationTargets(CTX, out, "britain")).not.toContain("italy");
    const s42 = atStart(SCENARIO_1942, 1);
    expect(s42.nations.france.status).toBe("vichy");
    expect(declarationTargets(ctxFor(SCENARIO_1942), s42, "germany")).not.toContain("france");
  });

  it("are listed as legal actions at step 1 only, ahead of the move-on action", () => {
    const s = atStart(SCENARIO_1939, 1);
    const legal = legalActions(CTX, s);
    expect(legal.at(-1)).toMatchObject({ type: "END_STEP" });
    expect(legal.filter((a) => a.type === "DECLARE_WAR").length).toBeGreaterThan(10);
    expect(legalActions(CTX, started(SCENARIO_1939, 1)).some((a) => a.type === "DECLARE_WAR")).toBe(false);
  });

  it("are refused against a country already at war, a friend, or a country out of the game", () => {
    const s = atStart(SCENARIO_1939, 1);
    expect(declarationTargets(CTX, s, "germany")).not.toContain("poland"); // already at war
    expect(declarationTargets(CTX, s, "germany")).not.toContain("britain"); // already at war
    expect(declare(s, "germany", "poland").ok).toBe(false);
    expect(declare(s, "germany", "germany").ok).toBe(false);
    expect(declare(s, "britain", "france").ok).toBe(false); // not their turn: Britain is Allied, the Axis is up
  });

  it("never target a Major Power of the declarer's own alignment, neutral or not", () => {
    const s = atStart(SCENARIO_1939, 1);
    const majors = (t: Combatant[]) => t.filter(isMajorPower).sort();
    // The Axis may attack the neutral Allied powers, never Italy.
    expect(majors(declarationTargets(CTX, s, "germany"))).toEqual(["usa", "ussr"]);
    // The Allies may attack Italy, never the U.S.A. or the U.S.S.R. (their own side) or each other.
    const allied = { ...s, activeSide: "allies" as const };
    expect(majors(declarationTargets(CTX, allied, "britain"))).toEqual(["italy"]);
    expect(majors(declarationTargets(CTX, allied, "france"))).toEqual(["italy"]);
    expect(applyAction(CTX, allied, { type: "DECLARE_WAR", by: "britain", on: "usa" }).ok).toBe(false);
    expect(applyAction(CTX, s, { type: "DECLARE_WAR", by: "germany", on: "italy" }).ok).toBe(false);
  });

  it("refuse an action that names a nation that is not in the game, without throwing", () => {
    const s = atStart(SCENARIO_1939, 1);
    expect(declarationTargets(CTX, s, "poland" as never)).toEqual([]);
    const r = applyAction(CTX, s, { type: "DECLARE_WAR", by: "poland" as never, on: "germany" });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/not a Major Power/);
  });

  it("are made only by the side whose Player Turn it is, and by a Major Power that is in the war", () => {
    const s = atStart(SCENARIO_1939, 1);
    expect(declarationTargets(CTX, s, "britain")).toEqual([]);
    expect(declarationTargets(CTX, s, "italy")).toEqual([]); // neutral at the start
    expect(sideOfPower(s.nations.italy)).toBeNull();
    expect(sideOfPower(s.nations.germany)).toBe("axis");
  });

  it("leave out minor countries that already fight a Major Power, and active Minor-Allies", () => {
    const s = atStart(SCENARIO_1939, 1);
    expect(declarationTargets(CTX, s, "germany")).not.toContain("poland");
    const ctx = ctxFor(SCENARIO_1942);
    const s42 = started(SCENARIO_1942, 1);
    for (const ally of ["finland", "rumania", "hungary", "bulgaria"]) expect(declarationTargets(ctx, s42, "germany")).not.toContain(ally);
  });

  it("are refused when they would take more than the Player Turn's limit, naming the limit", () => {
    let s = atStart(SCENARIO_1939, 1);
    for (const on of ["norway", "denmark", "sweden", "belgium", "netherlands", "luxembourg", "greece"] as const) s = ok(declare(s, "germany", on)).state;
    expect(s.nations.germany).toMatchObject({ brpTotal: 80, spent: 70 });
    const r = declare(s, "germany", "turkey");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/beyond what germany may spend/);
    expect(legalActions(CTX, s).some((a) => a.type === "DECLARE_WAR")).toBe(false);
    // The same total, the next Player Turn: the limit is open again.
    const later = ok(endTurn(CTX, ok(endTurn(CTX, s)).state)).state;
    expect(later.nations.germany.spent).toBe(0);
    // (Germany is down on BRPs, so the Allies take the Initiative; give Germany the move to look at its own limit.)
    expect(declarationTargets(CTX, { ...later, activeSide: "axis" }, "germany")).toContain("turkey");
  });

  it("with the limit too low for a Major Power but enough for a minor, offer only the minors", () => {
    const s = withNation(atStart(SCENARIO_1939, 1), "germany", { spendLimit: 20 });
    const targets = declarationTargets(CTX, s, "germany");
    expect(targets.some(isMajorPower)).toBe(false);
    expect(targets).toContain("norway");
  });

  it("do not exist in a scenario that bans war on neutrals (1944)", () => {
    const ctx = ctxFor(SCENARIO_1944);
    const s = started(SCENARIO_1944, 1);
    for (const by of ["germany", "usa", "britain", "ussr"] as const) expect(declarationTargets(ctx, s, by)).toEqual([]);
  });

  it("replay reproduces BRPs and wars exactly", () => {
    const initial = atStart(SCENARIO_1939, 3);
    const actions: Action[] = [
      { type: "DECLARE_WAR", by: "germany", on: "norway" },
      { type: "DECLARE_WAR", by: "germany", on: "denmark" },
    ];
    // Then move on, step after step, until the Axis turn is over.
    let at = replay(CTX, initial, actions).state;
    while (at.activeSide === "axis") {
      const next = legalActions(CTX, at).at(-1)!;
      actions.push(next);
      at = ok(applyAction(CTX, at, next)).state;
    }
    const { state } = replay(CTX, initial, actions);
    // The Allied Player Turn has begun, so nobody has spent anything in it.
    expect(state.nations.germany).toMatchObject({ brpTotal: 130, spent: 0 });
    // Nothing entered Norway or Denmark, so both declarations were revoked leaving 7p (spec 15 R4): the wars are gone, the BRPs stay spent (brpTotal above).
    expect(state.wars.filter(([a]) => a === "germany")).toHaveLength(3);
    expect(state.countries?.norway?.status).toBe("neutral");
    expect(replay(CTX, initial, actions).state).toEqual(state);
  });
});

describe("a declaration the scenario makes by itself", () => {
  it("is made by the U.S. in the Allied Spring 1942 turn: 35 BRPs, the U.S. joins the Allies, war with Germany", () => {
    const base = started(SCENARIO_1939, 1);
    const s: GameState = { ...base, year: 1942, season: "spring", firstSide: "axis", activeSide: "axis", position: { part: "player-turn", turn: 1, step: "10b" } };
    expect(atWar(s, "usa", "germany")).toBe(false);
    const r = ok(endTurn(CTX, s));
    expect(r.state.activeSide).toBe("allies");
    expect(atWar(r.state, "usa", "germany")).toBe(true);
    expect(r.state.nations.usa).toMatchObject({ status: "allied", brpTotal: 235, spent: 0 });
    expect(r.events).toContainEqual({ type: "WAR_DECLARED", by: "usa", on: "germany", cost: 35 });
    expect(r.events).toContainEqual({ type: "BRPS_CHANGED", nation: "usa", delta: -35, total: 235, reason: "declaring war on Germany (scenario rule)" });
  });

  it("is not made on the other side's turn, a different turn, or when the war already exists", () => {
    const base = started(SCENARIO_1939, 1);
    const axisTurn: GameState = { ...base, year: 1942, season: "spring", position: { part: "player-turn", turn: 1, step: "10b" } };
    expect(atWar(axisTurn, "usa", "germany")).toBe(false);
    const summer = ok(endTurn(CTX, { ...axisTurn, season: "summer" })).state;
    expect(atWar(summer, "usa", "germany")).toBe(false);
    const already = ok(endTurn(CTX, { ...axisTurn, wars: [...axisTurn.wars, ["usa", "germany"]] })).state;
    expect(already.nations.usa.brpTotal).toBe(270);
    // Germany declared first, so there is nothing to pay; the U.S. still joins the Allies in Spring 1942.
    expect(already.nations.usa.status).toBe("allied");
  });
});
