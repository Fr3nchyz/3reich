import { describe, expect, it } from "vitest";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { SCENARIO_CAMPAIGN } from "../src/data/scenario-campaign";
import { SCENARIO_1944 } from "../src/data/scenario-1944";
import { MAP } from "../src/data/map";
import { applyAction, legalActions } from "../src/engine/actions";
import type { GameEvent } from "../src/engine/action-types";
import { fall } from "../src/engine/conquest";
import { KEPT_HEX_PASSES_WHEN_FREED, keptDestination, releaseKept } from "../src/engine/conquest-kept";
import { fallCountry } from "../src/engine/conquest-minor";
import type { Conquest } from "../src/engine/conquest-record";
import { controllerOf } from "../src/engine/control";
import { advance, settle } from "../src/engine/turn";
import type { ForceOwner, GameState, Side, Unit } from "../src/engine/types";
import { board, counter } from "./board";
import { CTX, ctxFor } from "./helpers";

// Spec 14 ticket 14-25 (owner's decision of 2026-10-23, "Hex passes on when the unit leaves"; TODO(verify) V62): a hex kept at a fall under a hostile
// ground unit (V12, simplified) passes on, by the rule that would have applied at the fall, once no hostile ground unit stands there.

const BERLIN = "L31";
const WARSAW = "M35";
const BRUSSELS = "M25";
const STEP_7P = { part: "player-turn", turn: 1, step: "7p" } as const;
const AXIS_ITALY = { ...SCENARIO_1939.nations, italy: { ...SCENARIO_1939.nations.italy, status: "axis" as const } };

function at7p(side: Side, units: Unit[], tweak: Partial<GameState> = {}): GameState {
  return board(units, SCENARIO_1939, { year: 1940, season: "spring", firstSide: side, activeSide: side, position: STEP_7P, ...tweak });
}
const italian = (id: string, at: string) => counter(id, "italy", "infantry", 3, at, 3);
const british = (id: string, at: string) => counter(id, "britain", "infantry", 3, at, 3);
const without = (state: GameState, ...ids: string[]): GameState => ({ ...state, units: Object.fromEntries(Object.entries(state.units).filter(([id]) => !ids.includes(id))) });
const moved = (state: GameState, id: string, at: string): GameState => ({ ...state, units: { ...state.units, [id]: { ...state.units[id]!, at } } });
const passedEvents = (events: GameEvent[]) => events.filter((e) => e.type === "CONTROL_PASSED");

/** Germany falls to Britain (Berlin held by a British unit) with Axis Italian infantry on J29 (German land) and on Warsaw (German-held land outside Germany). */
function germanyFallen(extra: Unit[] = []): GameState {
  const s = at7p("axis", [british("b1", BERLIN), counter("g1", "germany", "infantry", 3, "L33", 3), italian("i1", "J29"), italian("i2", WARSAW), ...extra], { control: { [BERLIN]: "britain", [WARSAW]: "germany" }, nations: AXIS_ITALY });
  return fall(CTX, s, "germany", "britain").state;
}

/** Poland falls to Germany (Warsaw held by a German unit) with British infantry on M36 (Polish-held), Fall 1939. */
function polandFallen(extra: Unit[] = []): GameState {
  const s = at7p("axis", [counter("g1", "germany", "infantry", 3, WARSAW, 3), british("b1", "M36"), ...extra], { control: { [WARSAW]: "germany" }, year: 1939, season: "fall" });
  return advance(CTX, s).state;
}

describe("a Major Power's fall records the hexes it kept, with what the fall would have done to each", () => {
  it("J29 (German land under an Italian unit) would have gone to the conqueror; Warsaw (German-held, outside Germany) to nobody; both keep their control for now", () => {
    const s = germanyFallen();
    expect(controllerOf(CTX, s, "J29")).toBe("germany");
    expect(controllerOf(CTX, s, WARSAW)).toBe("germany");
    expect(s.keptHexes).toEqual({
      J29: { country: "germany", side: "allies", to: "britain", was: "germany" },
      [WARSAW]: { country: "germany", side: "allies", to: null, was: "germany" },
    });
  });
  it("a fall with no hostile ground unit on its land records nothing", () => {
    const s = fall(CTX, at7p("axis", [british("b1", BERLIN)], { control: { [BERLIN]: "britain" } }), "germany", "britain").state;
    expect(s.keptHexes).toBeUndefined();
  });
});

describe("releaseKept: the kept hex passes on once its hostile unit is gone", () => {
  it("the unit stays: nothing changes, the same state comes back", () => {
    const s = germanyFallen();
    expect(releaseKept(CTX, s)).toEqual({ state: s, events: [] });
    expect(releaseKept(CTX, s).state).toBe(s);
  });
  it("the unit leaves J29: the hex passes to the conqueror, as at the fall; Warsaw, still under its unit, stays kept", () => {
    const r = releaseKept(CTX, moved(germanyFallen(), "i1", "J28"));
    expect(controllerOf(CTX, r.state, "J29")).toBe("britain");
    expect(controllerOf(CTX, r.state, WARSAW)).toBe("germany");
    expect(Object.keys(r.state.keptHexes ?? {})).toEqual([WARSAW]);
    expect(passedEvents(r.events)).toEqual([{ type: "CONTROL_PASSED", country: "germany", to: "britain", hexes: ["J29"] }]);
  });
  it("the unit is eliminated in Warsaw: the hex becomes nobody's (V11), as at the fall; with both gone the record is removed", () => {
    const r = releaseKept(CTX, without(germanyFallen(), "i1", "i2"));
    expect(r.state.control[WARSAW]).toBeNull();
    expect(controllerOf(CTX, r.state, "J29")).toBe("britain");
    expect(r.state.keptHexes).toBeUndefined();
    expect(passedEvents(r.events)).toEqual([
      { type: "CONTROL_PASSED", country: "germany", to: "britain", hexes: ["J29"] },
      { type: "CONTROL_PASSED", country: "germany", to: null, hexes: [WARSAW] },
    ]);
  });
  it("two hostile units on the hex: one leaving is not enough; the hex passes once the second has gone too", () => {
    const s = germanyFallen([italian("i3", "J29")]);
    const one = releaseKept(CTX, moved(s, "i1", "J28"));
    expect(controllerOf(CTX, one.state, "J29")).toBe("germany");
    expect(one.events).toEqual([]);
    expect(controllerOf(CTX, releaseKept(CTX, without(one.state, "i3")).state, "J29")).toBe("britain");
  });
  it("another hostile unit takes the first one's place before the check: the hex stays kept", () => {
    const s = moved(moved(germanyFallen([italian("i3", "J28")]), "i1", "J28"), "i3", "J29");
    expect(releaseKept(CTX, s).state).toBe(s);
  });
  it("a hex someone took after the fall is not passed on: control stays with the taker and the record is dropped", () => {
    const s = germanyFallen();
    const taken = { ...without(s, "i1"), control: { ...s.control, J29: "france" as ForceOwner } };
    const r = releaseKept(CTX, taken);
    expect(controllerOf(CTX, r.state, "J29")).toBe("france");
    expect(Object.keys(r.state.keptHexes ?? {})).toEqual([WARSAW]);
    expect(r.events).toEqual([]);
  });
  it("an enemy of the conqueror left alone (an air unit) in a hex that passes to the conqueror is dealt with as at the fall", () => {
    const s = without({ ...germanyFallen(), units: { ...germanyFallen().units, ia: counter("ia", "italy", "air", 2, "J29", 4) } }, "i1");
    const r = releaseKept(CTX, s);
    expect(controllerOf(CTX, r.state, "J29")).toBe("britain");
    expect(r.state.units.ia).toBeUndefined();
    // Spec 09 R9: the captured plane has no usable base within eight hexes.
    expect(r.events).toContainEqual({ type: "AIR_DISPLACED", unitId: "ia", owner: "italy", from: "J29", to: null });
    expect(r.events.map((e) => e.type)).toContain("UNIT_ELIMINATED");
  });
  it("the constant is on (V62)", () => expect(KEPT_HEX_PASSES_WHEN_FREED).toBe(true));
});

describe("a minor country's fall (Poland to Germany)", () => {
  it("a Polish-held hex under a British unit is kept, then passes to Germany when the unit leaves", () => {
    const s = polandFallen();
    expect(controllerOf(CTX, s, "M36")).toBe("poland");
    expect(s.keptHexes?.M36).toEqual({ country: "poland", side: "axis", to: "germany", was: "poland" });
    const r = releaseKept(CTX, moved(s, "b1", "M37"));
    expect(controllerOf(CTX, r.state, "M36")).toBe("germany");
    expect(passedEvents(r.events)).toEqual([{ type: "CONTROL_PASSED", country: "poland", to: "germany", hexes: ["M36"] }]);
  });
  it("a hex of the country that nobody held, kept as nobody's under a hostile unit, passes to the conqueror when the unit leaves (Belgium, V37)", () => {
    const s0 = at7p("axis", [counter("g1", "germany", "infantry", 3, BRUSSELS, 3), british("b1", "L25")], { control: { [BRUSSELS]: "germany" }, wars: [...SCENARIO_1939.warsAtStart, ["germany", "belgium"]], year: 1939, season: "fall" });
    const s = advance(CTX, s0).state;
    expect(s.control.L25).toBeNull();
    expect(s.keptHexes?.L25).toEqual({ country: "belgium", side: "axis", to: "germany", was: null });
    expect(controllerOf(CTX, releaseKept(CTX, without(s, "b1")).state, "L25")).toBe("germany");
  });
});

describe("the owner a kept hex was to go to has fallen since (V62)", () => {
  it("Poland falls to Germany with M36 kept under a British unit; Germany then falls to Britain; when the unit leaves, M36 (outside Germany) becomes nobody's, not a conquered Germany's", () => {
    const s = polandFallen();
    const withBerlin = { ...s, units: { ...s.units, b2: british("b2", BERLIN) }, control: { ...s.control, [BERLIN]: "britain" as ForceOwner } };
    const g = fall(CTX, withBerlin, "germany", "britain").state;
    expect(g.keptHexes?.M36).toMatchObject({ to: "germany", was: "poland" });
    const r = releaseKept(CTX, moved(g, "b1", "M37"));
    expect(r.state.control.M36).toBeNull();
    expect(passedEvents(r.events)).toEqual([{ type: "CONTROL_PASSED", country: "poland", to: null, hexes: ["M36"] }]);
  });
  it("the destination changed down the chain: lone counters are swept as by the new owner's side (a German hex France held, kept at France's fall for Germany; Germany then falls to Britain)", () => {
    // Germany falls to Britain with J29 (German land) French-held; the record is the one France's fall would have left (France's conqueror Germany, Axis side)
    const s0 = at7p("axis", [british("b1", BERLIN), counter("ia", "italy", "air", 2, "J29", 4), counter("ba", "britain", "air", 2, "J29", 4)], { control: { [BERLIN]: "britain", J29: "france" }, nations: AXIS_ITALY });
    const g = fall(CTX, s0, "germany", "britain").state;
    expect(controllerOf(CTX, g, "J29")).toBe("france");
    const s = { ...g, keptHexes: { J29: { country: "france" as const, side: "axis" as const, to: "germany" as ForceOwner, was: "france" as ForceOwner } } };
    const r = releaseKept(CTX, s);
    expect(controllerOf(CTX, r.state, "J29")).toBe("britain");
    expect(passedEvents(r.events)).toEqual([{ type: "CONTROL_PASSED", country: "france", to: "britain", hexes: ["J29"] }]);
    expect(r.state.units.ia).toBeUndefined(); // the Axis air unit, an enemy of Britain, is swept
    expect(r.state.units.ba).toBeDefined(); // the British one stays
  });
  it("keptDestination follows that owner's own fall: its home land to its conqueror, other land to nobody, France's everything to its conqueror, Russia after a surrender keeps it, an owner that stands keeps it", () => {
    const at = { year: 1941, season: "spring" as const };
    const conquests: Conquest[] = [
      { country: "germany", by: "britain", side: "axis", how: "capital", at },
      { country: "france", by: "germany", side: "allies", how: "capital", at },
      { country: "ussr", by: "germany", side: "allies", how: "surrender", at },
    ];
    const s = { ...board([]), conquests };
    expect(keptDestination(CTX, s, "germany", "J29")).toBe("britain"); // German land
    expect(keptDestination(CTX, s, "germany", "M36")).toBeNull(); // Polish land
    expect(keptDestination(CTX, s, "france", "M36")).toBeNull(); // France's conqueror Germany has fallen too: M36 is not German land
    expect(keptDestination(CTX, s, "france", "J29")).toBe("britain"); // to Germany, then down the chain to Germany's conqueror
    expect(keptDestination(CTX, s, "ussr", "M36")).toBe("ussr");
    expect(keptDestination(CTX, s, "italy", "M36")).toBe("italy");
    expect(keptDestination(CTX, s, null, "M36")).toBeNull();
  });
});

describe("other kinds of fall", () => {
  it("an active Minor-Ally falls (Hungary to the U.S.S.R., 1944): a Hungarian hex under a German unit is kept, then passes to the U.S.S.R. when it leaves", () => {
    const ctx = ctxFor(SCENARIO_1944);
    const hexes = Object.values(MAP.hexes).filter((h) => h.land && h.country === "hungary").map((h) => h.id).sort();
    const hex = hexes.find((h) => !MAP.hexes[h]!.features.some((f) => f.startsWith("capital")))!;
    const s0 = board([counter("g1", "germany", "infantry", 3, hex, 3)], SCENARIO_1944, { year: 1944, season: "spring", firstSide: "allies", activeSide: "allies", position: STEP_7P });
    expect(s0.minorAllies.some((m) => m.owner === "hungary" && m.active)).toBe(true);
    const s = fallCountry(ctx, s0, { country: "hungary", conqueror: "ussr" }).state;
    expect(controllerOf(ctx, s, hex)).toBe("hungary");
    expect(s.keptHexes?.[hex]).toEqual({ country: "hungary", side: "allies", to: "ussr", was: "hungary" });
    expect(controllerOf(ctx, releaseKept(ctx, without(s, "g1")).state, hex)).toBe("ussr");
  });
});

describe("when it is looked at (V62)", () => {
  it("after every action: the step after the fall is ended with the British unit gone, and M36 passes in the same action; with the unit there it stays kept", () => {
    const s = settle(CTX, polandFallen()).state;
    const moveOn = legalActions(CTX, s).at(-1)!;
    const gone = applyAction(CTX, without(s, "b1"), moveOn);
    expect(gone.ok).toBe(true);
    if (!gone.ok) return;
    expect(controllerOf(CTX, gone.state, "M36")).toBe("germany");
    expect(gone.state.keptHexes).toBeUndefined();
    expect(passedEvents(gone.events)).toEqual([{ type: "CONTROL_PASSED", country: "poland", to: "germany", hexes: ["M36"] }]);
    const stays = applyAction(CTX, s, moveOn);
    expect(stays.ok && controllerOf(CTX, stays.state, "M36")).toBe("poland");
    expect(stays.ok && stays.state.keptHexes?.M36).toBeTruthy();
  });
  it("not once the game is over: a fall that ends the game leaves a kept hex as it is, so the final state matches the result", () => {
    // Germany has fallen with J29 kept under Italian infantry; now Italy falls too (Rome British-held at the end of the Axis Combat Phase): its units go, the game ends
    // The Campaign, which ends early when the Allies have conquered Germany and Italy (V3)
    const ctx = ctxFor(SCENARIO_CAMPAIGN);
    const nations = { ...SCENARIO_CAMPAIGN.nations, italy: { ...SCENARIO_CAMPAIGN.nations.italy, status: "axis" as const } };
    const units = [british("b1", BERLIN), italian("i1", "J29"), british("b9", "Y22")];
    const before = board(units, SCENARIO_CAMPAIGN, { year: 1940, season: "spring", firstSide: "axis", activeSide: "axis", position: STEP_7P, control: { [BERLIN]: "britain", Y22: "britain" }, nations });
    const s = fall(ctx, before, "germany", "britain").state;
    expect(s.keptHexes?.J29).toBeDefined();
    const r = applyAction(ctx, s, { type: "END_STEP", side: "axis", step: "7p" });
    expect(r.ok && r.state.phase).toBe("game-over");
    if (!r.ok) return;
    expect(r.state.units.i1).toBeUndefined();
    expect(r.state.conquests?.map((c) => c.country)).toEqual(["germany", "italy"]);
    expect(controllerOf(ctx, r.state, "J29")).toBe("germany");
    expect(r.state.keptHexes?.J29).toBeDefined();
  });
  it("at the end of the Game Turn, before the result is read: the last Game Turn's end passes the hex and then ends the game", () => {
    const s = without(germanyFallen(), "i1");
    const last = { ...s, phase: "player-turn" as const, lastTurn: { year: s.year, season: s.season }, position: { part: "player-turn" as const, turn: 2 as const, step: "10b" } };
    const r = advance(CTX, last);
    expect(controllerOf(CTX, r.state, "J29")).toBe("britain");
    const kinds = r.events.map((e) => e.type);
    expect(kinds.indexOf("CONTROL_PASSED")).toBeGreaterThanOrEqual(0);
    expect(kinds.indexOf("CONTROL_PASSED")).toBeLessThan(kinds.indexOf("GAME_OVER"));
  });
});
