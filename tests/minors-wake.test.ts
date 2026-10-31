import { describe, expect, it } from "vitest";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { SCENARIO_1942 } from "../src/data/scenario-1942";
import { applyAction, legalActions } from "../src/engine/actions";
import { sideToAct } from "../src/engine/actor";
import { sideInWar } from "../src/engine/control";
import { describeEvent } from "../src/ui/session";
import { MC28_WAKE_VALUE_RAISES_SPEND_LIMIT, MC29_ATTACKED_SLEEPER_WAKES_IN_1941, wakeAlly, wakeSleepers } from "../src/engine/minors-wake";
import { sleepingAlly } from "../src/engine/minors-axis";
import { minorValue } from "../src/engine/minors-rules";
import type { GameState } from "../src/engine/types";
import { board } from "./board";
import { CTX, atStart } from "./helpers";
import { at6f, inf, move, okOf } from "./helpers-move";

// Spec 15 R9 (ticket 15-8; Ref 17.0 to 17.3, 9.2; MC9): the four Axis Minor-Allies wake at step 2 of the Axis turn of Summer 1941, or earlier by Germany's Intervention.
const FOUR = ["finland", "hungary", "rumania", "bulgaria"] as const;
const place = (s: GameState) => legalActions(CTX, s).find((a) => a.type === "PLACE_MINOR_FORCES");

/** The Axis turn of Summer 1941, waiting at step 1 (declarations), with the opening position. */
function summer41(tweak: Partial<GameState> = {}, side: "axis" | "allies" = "axis"): GameState {
  const s = atStart(SCENARIO_1939, 1);
  return { ...s, year: 1941, season: "summer", activeSide: side, firstSide: side, position: { part: "player-turn", turn: 1, step: "1" }, ...tweak };
}
const leaveStep1 = (s: GameState) => okOf(applyAction(CTX, s, { type: "END_STEP", side: s.activeSide, step: "1" }));

describe("R9: the wake-up at step 2 of the Axis turn of Summer 1941", () => {
  const r = leaveStep1(summer41());
  it("all four wake once, adding exactly their values to Germany's total", () => {
    for (const c of FOUR) expect(r.state.minorAllies.find((m) => m.owner === c)).toMatchObject({ active: true, of: "germany" });
    const sum = FOUR.reduce((n, c) => n + (minorValue(c) ?? 0), 0);
    expect(sum).toBe(45);
    expect(r.state.nations.germany.brpTotal).toBe(summer41().nations.germany.brpTotal + 45);
    expect(r.events.filter((e) => e.type === "MINOR_ALLY_WOKE").map((e) => (e as { minor: string }).minor)).toEqual([...FOUR]);
    expect(r.events).toContainEqual({ type: "BRPS_CHANGED", nation: "germany", delta: 10, total: summer41().nations.germany.brpTotal + 10, reason: expect.stringContaining("finland") });
  });
  it("they fight on the Axis side at once and nobody pays a declaration", () => {
    for (const c of FOUR) expect(sideInWar(r.state, c)).toBe("axis");
    expect(r.state.nations.germany.spent).toBe(summer41().nations.germany.spent);
  });
  it("the game waits at step 2 and the Axis places each army with a unit in the capital", () => {
    expect(r.state.position).toMatchObject({ step: "2" });
    let s = r.state;
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      expect(sideToAct(s)).toBe("axis");
      const a = place(s)!;
      expect(a).toMatchObject({ side: "axis" });
      seen.push((a as { minor: string }).minor);
      const ok = okOf(applyAction(CTX, s, a));
      expect(ok.events).toContainEqual(expect.objectContaining({ type: "MINOR_FORCES_PLACED", side: "axis" }));
      s = ok.state;
      if (i < 3) expect(s.position).toMatchObject({ step: "2" });
    }
    expect(seen).toEqual(["bulgaria", "finland", "hungary", "rumania"]);
    expect(s.position).not.toMatchObject({ step: "2" });
    for (const c of FOUR) expect(Object.values(s.units).filter((u) => u.owner === c).length).toBeGreaterThan(0);
    expect(Object.values(s.units).some((u) => u.owner === "finland" && CTX.map.hexes[u.at]?.features.some((f) => f === "capital" || f === "capital-port"))).toBe(true);
  });
  it("a woken ally is no longer asleep or a Garrison target, and is not placed twice", () => {
    for (const c of FOUR) expect(sleepingAlly(r.state, c)).toBe(false);
    expect(wakeSleepers(r.state).events).toEqual([]);
    expect(wakeAlly(r.state, "finland", "intervention").events).toEqual([]);
  });
  it("the spending limit is untouched (MC28)", () => {
    expect(MC28_WAKE_VALUE_RAISES_SPEND_LIMIT).toBe(false);
    expect(r.state.nations.germany.spendLimit).toBe(summer41().nations.germany.spendLimit);
  });
  it("the log names the wake-up", () => {
    const e = r.events.find((x) => x.type === "MINOR_ALLY_WOKE")!;
    expect(describeEvent(e, CTX, new Set(), new Map(), summer41())).toMatch(/wakes as an ally/);
  });
});

describe("R9: not before Summer 1941, not on the Allied turn", () => {
  it("Spring 1941 and earlier: nothing wakes", () => {
    for (const [year, season] of [[1941, "spring"], [1940, "fall"], [1939, "summer"]] as const) {
      const r = leaveStep1(summer41({ year, season }));
      expect(r.state.minorAllies.some((m) => m.active)).toBe(false);
      expect(r.state.nations.germany.brpTotal).toBe(summer41().nations.germany.brpTotal);
    }
  });
  it("the Allied turn of Summer 1941 finds them asleep (the Allies move first); the Axis turn wakes them", () => {
    const first = leaveStep1(summer41({}, "allies"));
    expect(first.state.minorAllies.some((m) => m.active)).toBe(false);
    const second = leaveStep1(summer41({ position: { part: "player-turn", turn: 2, step: "1" } }));
    expect(second.state.minorAllies.filter((m) => m.active)).toHaveLength(4);
  });
  it("later turns wake a sleeper that was missed (Fall 1941)", () => {
    expect(leaveStep1(summer41({ season: "fall" })).state.minorAllies.filter((m) => m.active)).toHaveLength(4);
  });
  it("in 1942 the allies are already awake and nothing is added", () => {
    const s = atStart(SCENARIO_1942, 1);
    expect(wakeSleepers({ ...s, activeSide: "axis" }).events).toEqual([]);
    expect(place({ ...s, activeSide: "axis" })).toBeUndefined();
  });
});

describe("R9: who never wakes", () => {
  it("a conquered sleeper (spec 14's record) stays asleep and adds nothing", () => {
    const r = leaveStep1(summer41({ conquests: [{ country: "hungary", by: "ussr", side: "axis", how: "capital", at: { year: 1941, season: "spring" } }] }));
    expect(r.state.minorAllies.find((m) => m.owner === "hungary")!.active).toBe(false);
    expect(r.state.minorAllies.filter((m) => m.active)).toHaveLength(3);
    expect(r.state.nations.germany.brpTotal).toBe(summer41().nations.germany.brpTotal + 35);
  });
  it("a country the Axis declared on can never be an Axis ally", () => {
    const s = summer41();
    const declared = { ...s, wars: [...s.wars, ["germany", "bulgaria"] as [string, string]], countries: { ...s.countries, bulgaria: { status: "attacked" as const, attacker: "germany" as const } } } as GameState;
    const r = leaveStep1(declared);
    expect(r.state.minorAllies.find((m) => m.owner === "bulgaria")!.active).toBe(false);
    expect(r.state.nations.germany.brpTotal).toBe(s.nations.germany.brpTotal + 35);
  });
  it("wakeAlly on a country that is not a sleeping ally changes nothing", () => {
    const s = summer41();
    expect(wakeAlly(s, "yugoslavia", "summer-1941")).toEqual({ state: s, events: [] });
  });
});

describe("R9: an attacked sleeper keeps the army its declaration called up", () => {
  const attacked = (): GameState => {
    const s = summer41();
    return { ...s, wars: [...s.wars, ["britain", "finland"] as [string, string]], countries: { ...s.countries, finland: { status: "attacked", attacker: "britain" } } } as GameState;
  };
  it("wakes in Summer 1941 with no second army asked for (MC29)", () => {
    expect(MC29_ATTACKED_SLEEPER_WAKES_IN_1941).toBe(true);
    const r = leaveStep1(attacked());
    expect(r.state.minorAllies.find((m) => m.owner === "finland")!.active).toBe(true);
    expect(r.state.countries?.finland).toEqual({ status: "attacked", attacker: "britain" });
    expect(r.events).toContainEqual(expect.objectContaining({ type: "MINOR_ALLY_WOKE", minor: "finland", toPlace: false }));
  });
});

describe("R9: Germany's Intervention wakes a sleeping ally early", () => {
  const hungary = Object.values(CTX.map.hexes).filter((h) => h.country === "hungary" && h.land).map((h) => h.id);
  /** Britain declared on Hungary and has a unit inside; Hungary's one infantry was placed by the Axis. */
  const withBritish = (inside: boolean): GameState => {
    const s = at6f([inf("g1", "germany", "R30", 3, 3), inf("h1", "hungary", "R32", 2, 3), ...(inside ? [inf("b1", "britain", "R33", 3, 3)] : [])], "axis");
    return { ...s, wars: [...s.wars, ["britain", "hungary"]], countries: { ...s.countries, hungary: { status: "attacked", attacker: "britain" } } };
  };
  it("a German unit entering with a British unit inside wakes it, adds 10 and fights beside Germany", () => {
    expect(hungary).toContain("R33");
    const s = withBritish(true);
    const r = okOf(move(s, ["g1"], ["R31"]));
    expect(r.state.minorAllies.find((m) => m.owner === "hungary")!.active).toBe(true);
    expect(r.state.nations.germany.brpTotal).toBe(s.nations.germany.brpTotal + 10);
    expect(r.events).toContainEqual({ type: "MINOR_ALLY_WOKE", minor: "hungary", of: "germany", value: 10, cause: "intervention", toPlace: false });
    expect(r.events).toContainEqual({ type: "MINOR_INTERVENED", minor: "hungary", by: "germany" });
    expect(r.state.units.h1).toBeDefined(); // the army the declaration called up is kept, and not placed again
    expect(r.state.countries?.hungary?.toPlace).toBeUndefined();
  });
  it("with no British unit inside it is a Garrison: no wake-up", () => {
    const r = okOf(move(withBritish(false), ["g1"], ["R31"]));
    expect(r.state.minorAllies.find((m) => m.owner === "hungary")!.active).toBe(false);
    expect(r.events.some((e) => e.type === "MINOR_ALLY_WOKE")).toBe(false);
  });
  it("an Italian unit entering does not wake it (only Germany's Intervention does)", () => {
    const s = withBritish(true);
    const it2 = { ...s, units: { ...s.units, i1: inf("i1", "italy", "R30", 3, 3) } };
    const r = move(it2, ["i1"], ["R31"]);
    if (r.ok) expect(r.state.minorAllies.find((m) => m.owner === "hungary")!.active).toBe(false);
  });
  it("a second German entry does not wake it again", () => {
    const r = okOf(move(withBritish(true), ["g1"], ["R31"]));
    const s2 = { ...r.state, units: { ...r.state.units, g2: inf("g2", "germany", "R30", 3, 3) } };
    const again = move(s2, ["g2"], ["R31"]);
    if (again.ok) expect(again.events.some((e) => e.type === "MINOR_ALLY_WOKE")).toBe(false);
  });
});

describe("R9: a Garrison-revoked ally that wakes later is placed by the Axis", () => {
  it("record is neutral with a ban: the wake asks for a new army", () => {
    const s = summer41({ countries: { ...atStart(SCENARIO_1939, 1).countries, hungary: { status: "neutral", closedTo: ["britain"] } } });
    const r = leaveStep1(s);
    expect(r.events).toContainEqual(expect.objectContaining({ type: "MINOR_ALLY_WOKE", minor: "hungary", toPlace: true }));
    expect(r.state.countries?.hungary).toEqual({ status: "neutral", closedTo: ["britain"], toPlace: "axis" });
  });
  it("board() states with no countries record still wake (no placement is asked for without a record map)", () => {
    const b = board([], SCENARIO_1939, { countries: undefined });
    const r = wakeAlly(b, "finland", "summer-1941");
    expect(r.events[0]).toMatchObject({ type: "MINOR_ALLY_WOKE", toPlace: false });
  });
});
