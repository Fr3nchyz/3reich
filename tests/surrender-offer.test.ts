import { describe, expect, it } from "vitest";
import { applyAction, legalActions } from "../src/engine/actions";
import { sideToAct } from "../src/engine/actor";
import { surrenderAsking } from "../src/engine/soviet-record";
import { axisFactorsInRussia, russianFactors, russianFactorsInRussia, sovietOffer, SURRENDER_FACTOR_LIMIT } from "../src/engine/soviet-surrender";
import { legalSurrenderActions } from "../src/engine/victory-actions";
import type { GameState } from "../src/engine/types";
import { settle } from "../src/engine/turn";
import { counter } from "./board";
import { CTX, ctxFor } from "./helpers";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { air, arrive, asked, at9k, eventsOf, ger, IN, many, OUT, rus, sides } from "./helpers-surrender";

// Spec 14 ticket 14-15, R7b (Ref 11.8, 18.41, Ops 5.49a): at step 10a of an Allied Player Turn, Russia at war with Germany, with fewer than 50 ground and air factors
// on the map and the Axis inside Russia at least 3 to 2 of that, offers to surrender, once. The Axis answer (SURRENDER_ANSWER). TODO(verify) V17, V18, V48 to V52.

const offered = (s: GameState) => sovietOffer(CTX, s).offered;

describe("the test of R7b: what counts as factors", () => {
  it("40 Russian against 60 Axis factors is exactly 3 to 2: Russia offers", () => {
    expect(sovietOffer(CTX, sides(40, 60))).toEqual({ russian: 40, axis: 60, offered: true });
  });
  it("59 against 40 is no offer and 60 against 40 is: the boundary is exact", () => {
    expect(offered(at9k([...many("r", "ussr", 10), ...many("g", "germany", 14, 4, IN.slice(5)), ger("x", IN[5], 3)]))).toBe(false);
    expect(offered(at9k([...many("r", "ussr", 10), ...many("g", "germany", 14, 4, IN.slice(5)), ger("x", IN[5], 4)]))).toBe(true);
  });
  it("49 Russian factors are fewer than 50, 50 are not: with the Axis far ahead only the limit decides", () => {
    const axis = many("g", "germany", 30, 4, IN.slice(5));
    expect(SURRENDER_FACTOR_LIMIT).toBe(50);
    expect(offered(at9k([...many("r", "ussr", 12), rus("one", IN[0], 1), ...axis]))).toBe(true); // 48 + 1 = 49
    expect(offered(at9k([...many("r", "ussr", 12), rus("two", IN[0], 2), ...axis]))).toBe(false); // 48 + 2 = 50
    expect(offered(at9k([...many("r", "ussr", 13), ...axis]))).toBe(false); // 52
  });
  it("air units count on both sides, and so do replacements and airborne", () => {
    const base = [...many("r", "ussr", 5, 4, IN.slice(0, 5))]; // 20
    const s = at9k([...base, air("ra", "ussr", IN[0], 6), counter("rr", "ussr", "replacement", 2, IN[1]), counter("rb", "ussr", "airborne", 2, IN[2], 4), air("ga", "germany", IN[5], 7), counter("gr", "germany", "replacement", 2, IN[6]), counter("gb", "germany", "airborne", 3, IN[7], 4)]);
    expect(russianFactors(CTX, s)).toBe(30);
    expect(axisFactorsInRussia(CTX, s)).toBe(12);
  });
  it("airbases, fleets, bridgeheads and units in boxes do not count", () => {
    const s = at9k([
      rus("a", IN[0], 4), counter("ab", "ussr", "airbase", 0, IN[1]), counter("fl", "ussr", "fleet", 5, "A47"), counter("bh", "ussr", "bridgehead", 1, IN[2]), counter("box", "ussr", "air", 9, "murmansk-box"),
      ger("g", IN[5], 4), counter("gab", "germany", "airbase", 0, IN[6]), counter("gfl", "germany", "fleet", 5, "A47"), counter("gbox", "germany", "air", 9, "murmansk-box"),
    ]);
    expect(russianFactors(CTX, s)).toBe(4);
    expect(axisFactorsInRussia(CTX, s)).toBe(4);
  });
  it("Axis factors count only inside Russia's original borders; Russian factors count wherever they stand on the map", () => {
    const s = at9k([rus("in", IN[0], 4), rus("out", OUT, 6), ger("gin", IN[5], 4), ger("gout", OUT, 9)]);
    expect(russianFactors(CTX, s)).toBe(10);
    expect(russianFactorsInRussia(CTX, s)).toBe(4);
    expect(axisFactorsInRussia(CTX, s)).toBe(4);
  });
  it("Italians and an active Minor-Ally count as Axis; Finns too; an Allied unit of another nation counts for nobody", () => {
    const base = at9k([rus("r", IN[0], 8), ger("i", IN[5], 4, "italy"), ger("f", IN[6], 4, "finland"), ger("h", IN[7], 4, "hungary"), ger("b", IN[8], 4, "britain")]);
    const s = { ...base, nations: { ...base.nations, italy: { ...base.nations.italy, status: "axis" as const } }, minorAllies: [] };
    // Finland and Hungary are Axis Minor-Allies only when active
    expect(axisFactorsInRussia(CTX, s)).toBe(4);
    const active = { ...s, minorAllies: [{ owner: "finland", of: "germany", active: true }, { owner: "hungary", of: "germany", active: true }] } as unknown as GameState;
    expect(axisFactorsInRussia(CTX, active)).toBe(12);
  });
});

describe("the test of R7b: the war and the nations", () => {
  it("no offer unless Germany and the U.S.S.R. are at war", () => {
    expect(offered(sides(40, 60, { wars: [] }))).toBe(false);
  });
  it("no offer from a U.S.S.R. that has left the game", () => {
    const s = sides(40, 60);
    expect(offered({ ...s, nations: { ...s.nations, ussr: { ...s.nations.ussr, status: "conquered" } } })).toBe(false);
    expect(offered({ ...s, nations: { ...s.nations, germany: { ...s.nations.germany, status: "conquered" } } })).toBe(false);
  });
  it("an empty board meets the test with 0 against 0 (the literal rule); the 1939 start does not, the Axis not being in Russia yet", () => {
    expect(sovietOffer(CTX, at9k([]))).toEqual({ russian: 0, axis: 0, offered: true });
    expect(offered(at9k([...many("r", "ussr", 11)]))).toBe(false); // 44 Russian factors, no Axis unit in Russia
  });
});

describe("when Russia offers: step 10a of an Allied Player Turn, once", () => {
  it("arriving at 10a with the test met: the offer is made, the record says asking, one event, and the game waits at 10a", () => {
    const r = arrive(sides(40, 60));
    expect(r.state.position).toEqual({ part: "player-turn", turn: 2, step: "10a" });
    expect(r.state.soviet).toEqual({ citiesTaken: {}, offer: "asking" });
    expect(surrenderAsking(r.state)).toBe(true);
    expect(eventsOf(r.events, "RUSSIA_OFFERS_SURRENDER")).toEqual([{ type: "RUSSIA_OFFERS_SURRENDER", russian: 40, axis: 60 }]);
  });
  it("the test not met: step 10a is passed, nothing is recorded, the game waits at 10b", () => {
    const r = arrive(sides(40, 56));
    expect(r.state.position).toEqual({ part: "player-turn", turn: 2, step: "10b" });
    expect(r.state.soviet).toBeUndefined();
    expect(eventsOf(r.events, "RUSSIA_OFFERS_SURRENDER")).toEqual([]);
    expect(r.events.some((e) => e.type === "STEPS_PASSED" && e.steps.includes("10a"))).toBe(true);
  });
  it("at the end of an Axis Player Turn there is no offer, however the factors stand", () => {
    const r = arrive(sides(40, 60, { activeSide: "axis", firstSide: "allies" }));
    expect(r.state.position).toEqual({ part: "player-turn", turn: 2, step: "10b" });
    expect(r.state.soviet).toBeUndefined();
  });
  it("the first Player Turn of a Game Turn counts too, when it is the Allies'", () => {
    const r = arrive(sides(40, 60, { firstSide: "allies", position: { part: "player-turn", turn: 1, step: "9k" } }));
    expect(surrenderAsking(r.state)).toBe(true);
  });
  it("made once: after an answer, or while it is open, a later 10a with the test still met makes none", () => {
    for (const offer of ["accepted", "refused", "asking"] as const) {
      const r = arrive(sides(40, 60, { soviet: { citiesTaken: {}, offer } }));
      expect(r.state.soviet?.offer, offer).toBe(offer);
      expect(eventsOf(r.events, "RUSSIA_OFFERS_SURRENDER"), offer).toEqual([]);
    }
  });
  it("a context that does not build step 10a makes no offer, so nothing is ever asked that nobody can be asked", () => {
    const ctx = { ...ctxFor(SCENARIO_1939), implementedSteps: new Set(["II.B", "1", "10b"]) };
    const r = settle(ctx, sides(40, 60));
    expect(r.state.position).toEqual({ part: "player-turn", turn: 2, step: "10b" });
    expect(r.state.soviet).toBeUndefined();
    expect(surrenderAsking(r.state)).toBe(false);
  });
  it("an old state without any Russian record reads as no offer yet", () => {
    const s = sides(40, 56);
    expect(s.soviet).toBeUndefined();
    expect(surrenderAsking(s)).toBe(false);
  });
});

describe("the question: who acts and what is legal (C3, C6)", () => {
  const s = asked();
  it("the Axis act, though it is the Allied Player Turn", () => {
    expect(s.activeSide).toBe("allies");
    expect(sideToAct(s)).toBe("axis");
  });
  it("the legal actions are the two answers, accepting first, and nothing else, moving on included", () => {
    expect(legalActions(CTX, s)).toEqual([{ type: "SURRENDER_ANSWER", side: "axis", accept: true }, { type: "SURRENDER_ANSWER", side: "axis", accept: false }]);
    expect(legalSurrenderActions(s)).toEqual(legalActions(CTX, s));
    expect(legalActions(CTX, s).length).toBeGreaterThan(0);
  });
  it("no question, no answer: nothing is legal as an answer and the call is refused", () => {
    const quiet = arrive(sides(40, 56)).state;
    expect(legalSurrenderActions(quiet)).toEqual([]);
    expect(legalActions(CTX, quiet).some((a) => a.type === "SURRENDER_ANSWER")).toBe(false);
    const r = applyAction(CTX, quiet, { type: "SURRENDER_ANSWER", side: "axis", accept: true });
    expect(r).toMatchObject({ ok: false });
  });
  it("while it waits, END_STEP and END_PLAYER_TURN are refused, and so is any other action, with the reason", () => {
    for (const a of [{ type: "END_STEP", side: "allies", step: "10a" }, { type: "END_PLAYER_TURN", side: "allies" }, { type: "BUILD", owner: "ussr", unit: { type: "infantry", strength: 4 }, at: "H47" }, { type: "GRANT_BRPS", from: "britain", to: "ussr", amount: 5 }, { type: "PLACE_AIRBASE", owner: "ussr", at: "H47" }, { type: "SETUP_DONE", owner: "ussr" }] as const) {
      const r = applyAction(CTX, s, a);
      expect(r.ok, JSON.stringify(a)).toBe(false);
      if (!r.ok) expect(r.error).toContain("10a");
    }
  });
  it("only the Axis answer, and the answer must be a yes or a no; bad input is refused, never thrown", () => {
    for (const a of [{ type: "SURRENDER_ANSWER", side: "allies", accept: true }, { type: "SURRENDER_ANSWER", side: "axis", accept: "yes" }, { type: "SURRENDER_ANSWER", side: "axis" }, { type: "SURRENDER_ANSWER", accept: true }, { type: "SURRENDER_ANSWER", side: null, accept: null }]) {
      const r = applyAction(CTX, s, a as never);
      expect(r.ok, JSON.stringify(a)).toBe(false);
    }
  });
  it("answering moves the game on to 10b, whatever the answer", () => {
    for (const accept of [true, false]) {
      const r = applyAction(CTX, s, { type: "SURRENDER_ANSWER", side: "axis", accept });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.state.position).toEqual({ part: "player-turn", turn: 2, step: "10b" });
    }
  });
  it("a second answer is refused: the question is closed", () => {
    const r = applyAction(CTX, s, { type: "SURRENDER_ANSWER", side: "axis", accept: false });
    if (!r.ok) throw new Error(r.error);
    expect(applyAction(CTX, r.state, { type: "SURRENDER_ANSWER", side: "axis", accept: true }).ok).toBe(false);
  });
});
