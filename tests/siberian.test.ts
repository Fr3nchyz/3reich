import { describe, expect, it } from "vitest";
import { SCENARIO_1942 } from "../src/data/scenario-1942";
import { SCENARIO_1944 } from "../src/data/scenario-1944";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { SCENARIO_CAMPAIGN } from "../src/data/scenario-campaign";
import { applyAction, legalActions } from "../src/engine/actions";
import { sideToAct } from "../src/engine/actor";
import { autoSetup } from "../src/engine/autosetup";
import { newGame } from "../src/engine/game";
import { SIBERIAN_QUOTAS, siberianCities, siberianLeft, siberianOptions, siberianPool, siberianTakenNow } from "../src/engine/siberian";
import { evaluateVictory, siberianInForce, victoryTarget } from "../src/engine/victory";
import { settle } from "../src/engine/turn";
import type { ForceEntry, ForceOwner, GameState, Scenario } from "../src/engine/types";
import { legalSiberian } from "../src/engine/victory-actions";
import { counter } from "./board";
import { CTX, ctxFor } from "./helpers";
import { apply, at8a, FALL_42, GORKI, KALININ, KAZAN, KIEV, MOSCOW, PLAIN, refusal, SPRING_42, SUMMER_42, takeAll, transfer, TULA, WARSAW, WINTER_41, withPool } from "./helpers-siberian";
import { withCounts } from "./helpers-victory";

/** The Free Siberian Transfer, step 8a (spec 14 R11, ticket 14-18; Ref 11.63, Ops 5.47a). */

const inf = (strength: number, movement: number, count: number, from?: ForceEntry["from"]): ForceEntry => ({ type: "infantry", strength, movement, count, ...(from ? { from } : {}) });
const arm = (strength: number, movement: number, count: number): ForceEntry => ({ type: "armor", strength, movement, count });
const at = (s: GameState) => legalActions(CTX, s);
const transfers = (s: GameState) => at(s).filter((a) => a.type === "SIBERIAN_TRANSFER");

describe("quotas by the calendar (Ref 11.63)", () => {
  it("is four in Winter 1941, then three, two and one in 1942", () => {
    expect(SIBERIAN_QUOTAS).toEqual({ "1941-winter": 4, "1942-spring": 3, "1942-summer": 2, "1942-fall": 1 });
    expect([WINTER_41, SPRING_42, SUMMER_42, FALL_42].map((t) => siberianLeft(at8a([], {}, SCENARIO_1939, t)))).toEqual([4, 3, 2, 1]);
  });

  it("is nothing in any other Game Turn", () => {
    for (const [year, season] of [[1939, "fall"], [1941, "fall"], [1942, "winter"], [1943, "spring"], [1944, "winter"], [1945, "summer"]] as const) {
      const s = at8a([], {}, SCENARIO_1939, { year, season });
      expect(siberianLeft(s), `${season} ${year}`).toBe(0);
      expect(siberianOptions(s).entries).toEqual([]);
      expect(transfers(s)).toEqual([]);
    }
  });

  it("counts what was taken in the Game Turn, and takes the quota off it", () => {
    let s = at8a();
    expect(siberianLeft(s)).toBe(4);
    s = takeAll(s, [["infantry", 3, MOSCOW], ["infantry", 3, KAZAN]]);
    expect(siberianLeft(s)).toBe(2);
    expect(siberianTakenNow(s)).toEqual({ infantry: 2, armor: 0 });
    expect(s.siberian).toEqual({ used: true, taken: { "1941-winter": 2 }, armor: { "1941-winter": 0 } });
  });

  it("refuses the fifth unit in Winter 1941, naming the quota, and lists nothing more", () => {
    const s = takeAll(at8a(), [["infantry", 3, MOSCOW], ["infantry", 3, KAZAN], ["infantry", 3, TULA], ["infantry", 3, KIEV]]);
    expect(siberianLeft(s)).toBe(0);
    expect(transfers(s)).toEqual([]);
    expect(refusal(s, transfer("infantry", 3, GORKI))).toMatch(/all 4 units.*Winter 1941/);
  });

  it("forfeits what is not taken: the next Game Turn has its own quota, with no carry-over", () => {
    const s = takeAll(at8a(), [["infantry", 3, MOSCOW]]); // 1 of 4 taken in Winter 1941
    const next = { ...s, year: 1942, season: "spring" as const };
    expect(siberianLeft(next)).toBe(3);
    expect(siberianLeft({ ...next, season: "summer" })).toBe(2);
    expect(siberianLeft({ ...next, season: "fall" })).toBe(1);
  });

  it("refuses a unit in a Game Turn that has no Transfer, naming the years", () => {
    const s = at8a([], {}, SCENARIO_1939, { year: 1942, season: "winter" });
    expect(refusal(s, transfer("infantry", 3, MOSCOW))).toMatch(/no Free Siberian Transfer in Winter 1942.*Winter 1941 to Fall 1942/);
  });

  it("is a total of ten in the four Game Turns, nine of them before the 1939 scenario ends", () => {
    expect(Object.values(SIBERIAN_QUOTAS).reduce((a, b) => a + b)).toBe(10);
    expect(SCENARIO_1939.end).toEqual(SUMMER_42);
    const inside = Object.entries(SIBERIAN_QUOTAS).filter(([k]) => ["1941-winter", "1942-spring", "1942-summer"].includes(k));
    expect(inside.reduce((n, [, q]) => n + q, 0)).toBe(9);
    expect(SCENARIO_1942.start).toEqual(SPRING_42);
    expect(["1942-spring", "1942-summer", "1942-fall"].reduce((n, k) => n + SIBERIAN_QUOTAS[k]!, 0)).toBe(6);
  });
});

describe("the pool (V58)", () => {
  it("is the U.S.S.R.'s Allowable Builds, infantry and armor only", () => {
    const s = at8a();
    const kinds = new Set(siberianPool(s).map((e) => e.type));
    expect([...kinds].sort()).toEqual(["armor", "infantry"]);
    expect(s.pools.ussr!.allowableBuilds.some((e) => e.type === "air")).toBe(true); // the air counter is in the Allowable Builds and is not offered
    expect(transfers(s).some((a) => a.type === "SIBERIAN_TRANSFER" && (a.unit.type as string) === "air")).toBe(false);
  });

  it("takes the counter out of the pool, one at a time", () => {
    const s = at8a();
    const before = siberianPool(s).find((e) => e.type === "infantry" && e.strength === 3)!.count;
    const after = takeAll(s, [["infantry", 3, MOSCOW]]);
    expect(siberianPool(after).find((e) => e.type === "infantry" && e.strength === 3)!.count).toBe(before - 1);
  });

  it("an entry used up leaves the list, and the pool can be empty", () => {
    const s = withPool(at8a(), [inf(2, 3, 1)]);
    expect(siberianOptions(s).entries.map((e) => e.strength)).toEqual([2]);
    const t = takeAll(s, [["infantry", 2, MOSCOW]]);
    expect(t.pools.ussr!.allowableBuilds).toEqual([]);
    expect(transfers(t)).toEqual([]);
    expect(siberianPool(t)).toEqual([]);
  });

  it("an entry whose date has not come is not in the pool", () => {
    const s = withPool(at8a(), [inf(3, 3, 5, { year: 1942, season: "summer" }), inf(2, 3, 1)]);
    expect(siberianPool(s).map((e) => e.strength)).toEqual([2]);
    expect(siberianPool({ ...s, year: 1942, season: "summer" }).map((e) => e.strength)).toEqual([3, 2]);
    expect(refusal(s, transfer("infantry", 3, MOSCOW))).toMatch(/no 3-factor infantry/);
  });

  it("a counter the pool does not hold is refused with the reason", () => {
    const s = withPool(at8a(), [inf(2, 3, 1)]);
    expect(refusal(s, transfer("infantry", 3, MOSCOW))).toMatch(/Russian Force Pool has no 3-factor infantry/);
    expect(refusal(s, transfer("armor", 4, MOSCOW))).toMatch(/Russian Force Pool has no 4-factor armor/);
  });

  it("an airborne unit is refused, and so is an air unit, a fleet and a replacement", () => {
    const s = withPool(at8a(), [inf(3, 3, 3), { type: "airborne", strength: 2, movement: 3, count: 1 }, { type: "replacement", strength: 3, count: 1 }]);
    const as = (type: string, strength: number) => refusal(s, { type: "SIBERIAN_TRANSFER", side: "allies", unit: { type: type as "air", strength }, at: MOSCOW });
    expect(as("airborne", 2)).toMatch(/Airborne units cannot be taken/);
    expect(as("air", 5)).toMatch(/Only infantry and armor/);
    expect(as("fleet", 9)).toMatch(/Only infantry and armor/);
    expect(as("replacement", 3)).toMatch(/Only infantry and armor/);
    expect(transfers(s).every((a) => a.type === "SIBERIAN_TRANSFER" && a.unit.type === "infantry")).toBe(true);
    const later = takeAll(s, [["infantry", 3, MOSCOW]]); // with infantry taken, the airborne counter is still not on offer
    expect(transfers(later).every((a) => a.type === "SIBERIAN_TRANSFER" && a.unit.type === "infantry")).toBe(true);
    expect(siberianOptions(later).entries.map((e) => e.type)).toEqual(["infantry"]);
  });

  it("takes the unit for nothing: no BRP is spent or paid", () => {
    const s = at8a();
    const t = takeAll(s, [["infantry", 3, MOSCOW], ["infantry", 2, KAZAN]]);
    expect(t.nations.ussr.brpTotal).toBe(s.nations.ussr.brpTotal);
    expect(t.nations.ussr.spent).toBe(s.nations.ussr.spent);
    expect(t.nations).toEqual(s.nations);
  });

  it("the unit is a Soviet counter with the pool entry's numbers on the map in the city", () => {
    const t = apply(at8a(), transfer("infantry", 3, MOSCOW));
    const u = Object.values(t.state.units).find((x) => x.at === MOSCOW)!;
    expect(u).toMatchObject({ owner: "ussr", type: "infantry", strength: 3, movement: 3, at: MOSCOW });
    expect(t.state.nextUnitId).toBe(at8a().nextUnitId + 1);
    expect(t.events).toEqual([{ type: "SIBERIAN_TRANSFER_USED", unitId: u.id, unitType: "infantry", strength: 3, at: MOSCOW, left: 3, firstUse: true }]);
  });
});

describe("armor may not outnumber infantry (R11, V60)", () => {
  it("armor is not offered and is refused before any infantry is taken", () => {
    const s = at8a();
    expect(transfers(s).some((a) => a.type === "SIBERIAN_TRANSFER" && a.unit.type === "armor")).toBe(false);
    expect(refusal(s, transfer("armor", 3, MOSCOW))).toMatch(/Armor.*may not outnumber the infantry.*infantry first/);
  });

  it("armor is offered once as much infantry has been taken, and each armor needs its infantry", () => {
    let s = takeAll(at8a(), [["infantry", 3, MOSCOW]]);
    expect(transfers(s).some((a) => a.type === "SIBERIAN_TRANSFER" && a.unit.type === "armor")).toBe(true);
    s = takeAll(s, [["armor", 3, KAZAN]]); // 1 armor, 1 infantry
    expect(transfers(s).some((a) => a.type === "SIBERIAN_TRANSFER" && a.unit.type === "armor")).toBe(false);
    expect(refusal(s, transfer("armor", 3, TULA))).toMatch(/may not outnumber/);
    s = takeAll(s, [["infantry", 2, TULA]]);
    expect(refusal(s, transfer("armor", 3, GORKI))).toBeUndefined();
  });

  it("two infantry and two armor fill a quota of four", () => {
    const s = takeAll(at8a(), [["infantry", 3, MOSCOW], ["infantry", 2, KAZAN], ["armor", 3, TULA], ["armor", 3, GORKI]]);
    expect(siberianTakenNow(s)).toEqual({ infantry: 2, armor: 2 });
    expect(siberianLeft(s)).toBe(0);
  });

  it("is counted by Game Turn: armor taken last turn gives no right this turn", () => {
    const s = takeAll(at8a(), [["infantry", 3, MOSCOW], ["armor", 3, KAZAN]]);
    const next = { ...s, year: 1942, season: "spring" as const };
    expect(siberianTakenNow(next)).toEqual({ infantry: 0, armor: 0 });
    expect(refusal(next, transfer("armor", 3, TULA))).toMatch(/may not outnumber/);
  });

  it("with only armor in the pool nothing can be taken", () => {
    const s = withPool(at8a(), [arm(3, 5, 3)]);
    expect(siberianOptions(s).entries).toEqual([]);
    expect(transfers(s)).toEqual([]);
  });
});

describe("placement: a Russian city, held by the U.S.S.R., with a supply line to the east edge (V59)", () => {
  it("lists only Russian cities, and every one of them is a city", () => {
    const cities = siberianCities(CTX, at8a());
    expect(cities.length).toBeGreaterThan(30);
    for (const h of cities) {
      const hx = CTX.map.hexes[h]!;
      expect(hx.country, h).toBe("ussr");
      expect(hx.features.some((f) => ["city", "capital", "capital-port", "port", "objective"].includes(f)), h).toBe(true);
    }
    expect(cities).toEqual([...cities].sort());
    for (const h of [MOSCOW, KAZAN, TULA, KIEV, GORKI, KALININ]) expect(cities).toContain(h);
  });

  it("offers each pool counter in each of those cities", () => {
    const s = at8a();
    const cities = siberianCities(CTX, s);
    const kinds = siberianPool(s).filter((e) => e.type === "infantry").map((e) => e.strength).sort();
    const offered = transfers(s).filter((a) => a.type === "SIBERIAN_TRANSFER" && a.unit.type === "infantry");
    expect(offered.length).toBe(kinds.length * cities.length);
  });

  it("refuses a hex that is no city, a foreign city and an Axis-held one, each with the reason", () => {
    const s = at8a([], { control: { H47: "germany" } });
    for (const where of [PLAIN, WARSAW, MOSCOW]) expect(refusal(s, transfer("infantry", 3, where)), where).toMatch(/Russian city held by the U\.S\.S\.R\. that has a supply line to the east edge/);
    expect(siberianCities(CTX, s)).not.toContain(MOSCOW);
    expect(siberianCities(CTX, s)).toContain(KAZAN);
  });

  it("an off-map place and nonsense are refused, never thrown", () => {
    const s = at8a();
    for (const where of ["us-box", "murmansk-box", "ZZ99", "", undefined, 7, null]) {
      expect(refusal(s, transfer("infantry", 3, where as string)), String(where)).toMatch(/cannot be placed/);
    }
  });

  it("a city with no supply line to the east edge is not offered: the Axis hold the whole edge", () => {
    const edge = Object.values(CTX.map.hexes).filter((h) => /^[A-Z]\d+$/.test(h.id));
    const last = new Map<string, string>();
    for (const h of edge) { const m = /^([A-Z])(\d+)$/.exec(h.id)!; const cur = last.get(m[1]!); if (!cur || Number(m[2]) > Number(/\d+/.exec(cur)![0])) last.set(m[1]!, h.id); }
    const control: Record<string, ForceOwner> = Object.fromEntries([...last.values()].filter((h) => CTX.map.hexes[h]!.land).map((h) => [h, "germany" as const]));
    const s = at8a([], { control });
    expect(siberianCities(CTX, s)).toEqual([]);
    expect(transfers(s)).toEqual([]);
    expect(refusal(s, transfer("infantry", 3, MOSCOW))).toMatch(/supply line to the east edge/);
  });

  it("a city of the U.S.S.R. is not enough: a Russian city under another Allied Power's control is not offered", () => {
    const s = at8a([], { control: { [KAZAN]: "britain" } });
    expect(siberianCities(CTX, s)).not.toContain(KAZAN);
    expect(siberianCities(CTX, s)).toContain(GORKI);
    expect(refusal(s, transfer("infantry", 3, KAZAN))).toMatch(/cannot be placed/);
  });

  it("a city outside the U.S.S.R. is never offered, even one the U.S.S.R. holds on a supply line from the east edge", () => {
    const outside = Object.values(CTX.map.hexes).filter((h) => h.land && ["poland", "baltic-states", "rumania", "finland", "turkey"].includes(h.country ?? "")).map((h) => h.id);
    const control: Record<string, ForceOwner> = Object.fromEntries(outside.map((h) => [h, "ussr" as const]));
    const s = at8a([], { control });
    const cities = siberianCities(CTX, s);
    expect(cities).not.toContain(WARSAW);
    expect(cities.every((h) => CTX.map.hexes[h]!.country === "ussr")).toBe(true);
    expect(refusal(s, transfer("infantry", 3, WARSAW))).toMatch(/cannot be placed/);
  });

  it("an Axis ground unit standing in a city keeps it off the list", () => {
    const s = at8a([counter("g1", "germany", "infantry", 3, TULA, 3)]);
    expect(siberianCities(CTX, s)).not.toContain(TULA);
    expect(refusal(s, transfer("infantry", 3, TULA))).toMatch(/cannot be placed/);
  });

  it("the stacking limit of two ground units a hex is the engine's own: a full city is not offered", () => {
    const s = at8a([counter("r1", "ussr", "infantry", 3, MOSCOW, 3), counter("r2", "ussr", "armor", 3, MOSCOW, 5)]);
    expect(siberianCities(CTX, s)).toContain(MOSCOW); // a city on the supply line, but too full for a ground counter
    expect(transfers(s).some((a) => a.type === "SIBERIAN_TRANSFER" && a.at === MOSCOW)).toBe(false);
    expect(refusal(s, transfer("infantry", 3, MOSCOW))).toMatch(/cannot be placed/);
    expect(refusal(s, transfer("infantry", 3, KAZAN))).toBeUndefined();
  });

  it("the second counter fits, the third does not (the placement fills a city as a build does)", () => {
    let s = at8a();
    s = takeAll(s, [["infantry", 3, MOSCOW], ["infantry", 3, MOSCOW]]);
    expect(refusal(s, transfer("infantry", 3, MOSCOW))).toMatch(/cannot be placed/);
    expect(transfers(s).some((a) => a.type === "SIBERIAN_TRANSFER" && a.at === MOSCOW)).toBe(false);
  });

  it("an air unit in the city does not use up a ground place", () => {
    const s = at8a([counter("a1", "ussr", "air", 5, MOSCOW, 4), counter("r1", "ussr", "infantry", 3, MOSCOW, 3)]);
    expect(refusal(s, transfer("infantry", 3, MOSCOW))).toBeUndefined();
  });

  it("when no city can take a counter the list is empty and the step is passed, not waited at", () => {
    const full = siberianCities(CTX, at8a()).flatMap((h, i) => [counter(`f${i}a`, "ussr", "infantry", 1, h, 3), counter(`f${i}b`, "ussr", "infantry", 1, h, 3)]);
    const s = at8a(full);
    expect(transfers(s)).toEqual([]);
    expect(legalSiberian(CTX, s)).toEqual([]);
    const arrived = settle(CTX, { ...s, position: { part: "player-turn", turn: 2, step: "7p" } });
    expect(arrived.state.position).toMatchObject({ step: "8b" });
    expect(arrived.events.some((e) => e.type === "STEPS_PASSED" && e.steps.includes("8a"))).toBe(true);
  });
});

describe("who and when", () => {
  it("only the Allies, in their own Player Turn: the Axis turn at 8a lists nothing and refuses", () => {
    const s = at8a([], { activeSide: "axis" });
    expect(transfers(s)).toEqual([]);
    expect(refusal(s, transfer("infantry", 3, MOSCOW))).toMatch(/Allied Player Turn/);
    expect(refusal(at8a(), { type: "SIBERIAN_TRANSFER", side: "axis" as "allies", unit: { type: "infantry", strength: 3 }, at: MOSCOW })).toMatch(/belongs to the Allies/);
  });

  it("only at step 8a: at 8b, 7h or step 1 the action is refused, naming the step", () => {
    for (const step of ["1", "7h", "8b", "9a"]) {
      const s = at8a([], { position: { part: "player-turn", turn: 2, step } });
      expect(refusal(s, transfer("infantry", 3, MOSCOW)), step).toMatch(/Free Siberian Transfer is made in step 8a.*the game is at step/);
      expect(transfers(s), step).toEqual([]);
    }
  });

  it("not before the game is in play, not when it is over", () => {
    expect(refusal(newGame(SCENARIO_1939, 1), transfer("infantry", 3, MOSCOW))).toBeDefined();
    expect(refusal(at8a([], { phase: "game-over" }), transfer("infantry", 3, MOSCOW))).toMatch(/over/);
  });

  it("not once the U.S.S.R. has left the game", () => {
    for (const status of ["conquered", "out"] as const) {
      const s = at8a([], { nations: { ...at8a().nations, ussr: { ...at8a().nations.ussr, status } } });
      expect(transfers(s), status).toEqual([]);
      expect(refusal(s, transfer("infantry", 3, MOSCOW)), status).toMatch(/left the game/);
    }
  });

  it("a neutral Russia holds no supply line, so nothing can be placed (V59)", () => {
    const base = at8a();
    const s = { ...base, wars: base.wars.filter((w) => !w.includes("ussr")), nations: { ...base.nations, ussr: { ...base.nations.ussr, status: "neutral" as const } } };
    expect(siberianCities(CTX, s)).toEqual([]);
    expect(transfers(s)).toEqual([]);
  });

  it("no Russian war is needed besides Russia being an Allied Power (V26)", () => {
    const base = at8a();
    const s = { ...base, wars: base.wars.filter((w) => !(w.includes("ussr") && w.includes("germany"))) };
    expect(transfers(s).length).toBeGreaterThan(0);
  });

  it("malformed input is refused with a reason, never thrown", () => {
    const s = at8a();
    const bad = [
      { type: "SIBERIAN_TRANSFER" },
      { type: "SIBERIAN_TRANSFER", side: "allies" },
      { type: "SIBERIAN_TRANSFER", side: "allies", unit: null, at: MOSCOW },
      { type: "SIBERIAN_TRANSFER", side: "allies", unit: "infantry", at: MOSCOW },
      { type: "SIBERIAN_TRANSFER", side: "allies", unit: {}, at: MOSCOW },
      { type: "SIBERIAN_TRANSFER", side: "allies", unit: { type: "infantry" }, at: MOSCOW },
      { type: "SIBERIAN_TRANSFER", side: "allies", unit: { type: "infantry", strength: "3" }, at: MOSCOW },
      { type: "SIBERIAN_TRANSFER", side: "allies", unit: { type: "tank", strength: 3 }, at: MOSCOW },
      { type: "SIBERIAN_TRANSFER", side: 7, unit: { type: "infantry", strength: 3 }, at: MOSCOW },
    ];
    for (const a of bad) expect(() => applyAction(CTX, s, a as never), JSON.stringify(a)).not.toThrow();
    for (const a of bad) expect(refusal(s, a as never), JSON.stringify(a)).toBeTypeOf("string");
  });

  it("the Allies act at 8a (sideToAct), and the step is left only with END_STEP", () => {
    const s = at8a();
    expect(sideToAct(s)).toBe("allies");
    expect(at(s).filter((a) => a.type === "END_STEP")).toEqual([{ type: "END_STEP", side: "allies", step: "8a" }]);
    const left = apply(s, { type: "END_STEP", side: "allies", step: "8a" });
    expect(left.state.position).toMatchObject({ step: "8b" });
    expect(left.state.siberian).toBeUndefined(); // declining takes nothing and does not switch the tables
  });
});

describe("the step waits only while there is something to take", () => {
  const from7p = (s: GameState) => settle(CTX, { ...s, position: { part: "player-turn", turn: 2, step: "7p" } });

  it("arriving at 8a with units to take, the game waits there with the taking and the way on listed", () => {
    const r = from7p(at8a());
    expect(r.state.position).toMatchObject({ step: "8a" });
    const list = at(r.state);
    expect(list.some((a) => a.type === "SIBERIAN_TRANSFER")).toBe(true);
    expect(list[list.length - 1]).toEqual({ type: "END_STEP", side: "allies", step: "8a" });
  });

  it("the list is never empty at 8a: once the quota is used only the way on is left", () => {
    const s = takeAll(from7p(at8a()).state, [["infantry", 3, MOSCOW], ["infantry", 3, KAZAN], ["infantry", 3, TULA], ["infantry", 3, KIEV]]);
    expect(s.position).toMatchObject({ step: "8a" });
    expect(at(s)).toEqual([{ type: "END_STEP", side: "allies", step: "8a" }]);
  });

  it("a Game Turn with no Transfer passes the step as it always did", () => {
    const r = from7p(at8a([], {}, SCENARIO_1939, { year: 1941, season: "fall" }));
    expect(r.state.position).toMatchObject({ step: "8b" });
    expect(r.events.some((e) => e.type === "STEPS_PASSED" && e.steps.includes("8a"))).toBe(true);
  });

  it("the Axis turn passes it, whatever the pool holds", () => {
    const r = from7p(at8a([], { activeSide: "axis" }));
    expect(r.state.position).toMatchObject({ step: "8b" });
  });

  it("an empty pool passes it", () => {
    const r = from7p(withPool(at8a(), [{ type: "air", strength: 5, movement: 4, count: 1 }]));
    expect(r.state.position).toMatchObject({ step: "8b" });
  });
});

describe("the flag that changes the victory tables (R2, R11)", () => {
  // Objectives held as counted (the control of Moscow, Kiev and the rest is set by the helper, so some Russian cities are Axis-held; the east edge and Kazan are not).
  const withObjectives = (allies: number): GameState => at8a([], { control: { ...withCounts(SCENARIO_1939, allies, 10).control, [KAZAN]: "ussr" } });

  it("is off until a unit is taken, and declining leaves it off", () => {
    const s = at8a();
    expect(siberianInForce(s)).toBe(false);
    expect(victoryTarget(CTX, s).siberian).toBe(false);
    expect(siberianInForce(apply(s, { type: "END_STEP", side: "allies", step: "8a" }).state)).toBe(false);
  });

  it("one unit switches it for good, in the unit's own action", () => {
    const t = apply(at8a(), transfer("infantry", 3, MOSCOW));
    expect(siberianInForce(t.state)).toBe(true);
    expect(t.events[0]).toMatchObject({ firstUse: true });
    const t2 = apply(t.state, transfer("infantry", 3, KAZAN));
    expect(t2.events[0]).toMatchObject({ firstUse: false });
    expect(siberianInForce(t2.state)).toBe(true);
  });

  it("a refused action does not switch it", () => {
    const s = at8a();
    expect(refusal(s, transfer("armor", 3, MOSCOW))).toBeDefined();
    expect(refusal(s, transfer("infantry", 3, PLAIN))).toBeDefined();
    expect(siberianInForce(s)).toBe(false);
  });

  it("the Allied target goes up by one: 15 Objectives are a Marginal victory without it and a Stalemate with it (1939)", () => {
    const plain = withObjectives(15);
    expect(evaluateVictory(CTX, plain, "end-of-play")).toMatchObject({ winner: "allies", level: "marginal", siberian: false });
    const used = apply(plain, transfer("infantry", 3, KAZAN));
    expect(used.state.siberian?.used).toBe(true);
    expect(evaluateVictory(CTX, used.state, "end-of-play")).toMatchObject({ winner: null, level: null, siberian: true });
    expect(victoryTarget(CTX, used.state).table!.allies.marginal).toBe(16);
    expect(victoryTarget(CTX, plain).table!.allies.marginal).toBe(15);
    expect(evaluateVictory(CTX, apply(withObjectives(16), transfer("infantry", 3, KAZAN)).state, "end-of-play")).toMatchObject({ winner: "allies", level: "marginal", siberian: true });
  });

  it("the Axis tables are not changed (1942: Axis Marginal still at 14)", () => {
    const ctx = ctxFor(SCENARIO_1942);
    const s = { ...withCounts(SCENARIO_1942, 10, 14), siberian: { used: true, taken: { "1942-spring": 1 } } };
    expect(evaluateVictory(ctx, s, "end-of-play")).toMatchObject({ winner: "axis", level: "marginal", siberian: true });
  });

  it("the 1944 scenario is exempt: no Game Turn of it has a Transfer, and it reads Germany's fall, not Objectives", () => {
    const s = at8a([], {}, SCENARIO_1944, { year: 1944, season: "winter" });
    expect(siberianLeft(s)).toBe(0);
    expect(transfers(s)).toEqual([]);
    expect(victoryTarget(ctxFor(SCENARIO_1944), { ...s, siberian: { used: true, taken: {} } }).kind).toBe("germany-falls");
  });
});

describe("every scenario has places for the units (hazard: an empty list)", () => {
  const scenarios: [string, Scenario, typeof WINTER_41][] = [["1939", SCENARIO_1939, WINTER_41], ["campaign", SCENARIO_CAMPAIGN, WINTER_41], ["1942", SCENARIO_1942, SPRING_42]];
  for (const [name, scenario, turn] of scenarios) {
    it(`${name}: after the opening setup, in ${turn.season} ${turn.year}, the Allies can take units and many cities qualify`, () => {
      const ctx = ctxFor(scenario);
      let s = newGame(scenario, 1);
      for (const a of autoSetup(ctx, s)) {
        const r = applyAction(ctx, s, a);
        if (!r.ok) throw new Error(r.error);
        s = r.state;
      }
      const quota = SIBERIAN_QUOTAS[`${turn.year}-${turn.season}`]!;
      const forced: GameState = { ...s, year: turn.year, season: turn.season, activeSide: "allies", position: { part: "player-turn", turn: 2, step: "8a" }, nations: { ...s.nations, ussr: { ...s.nations.ussr, status: "allied" } } };
      expect(siberianLeft(forced)).toBe(quota);
      expect(siberianCities(ctx, forced).length, "cities").toBeGreaterThan(20);
      expect(legalActions(ctx, forced).filter((a) => a.type === "SIBERIAN_TRANSFER").length).toBeGreaterThan(0);
    });
  }

  it("the Campaign's pool has its late counters only from Spring 1942 (the 1939 pool is all there from the start)", () => {
    const camp = withPool(at8a([], {}, SCENARIO_CAMPAIGN), SCENARIO_CAMPAIGN.forces.ussr!.allowableBuilds.map((e) => ({ ...e })));
    expect(siberianPool(camp).every((e) => !e.from || e.from.year < 1942)).toBe(true);
    expect(siberianPool({ ...camp, year: 1942, season: "spring" }).length).toBeGreaterThanOrEqual(siberianPool(camp).length);
  });
});

describe("determinism, saves and replay", () => {
  it("the same actions give the same state, and the state is plain JSON", () => {
    const run = () => takeAll(at8a(), [["infantry", 3, MOSCOW], ["armor", 3, KAZAN]]);
    expect(run()).toEqual(run());
    const s = run();
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });

  it("a saved game without the new field, or with the old record shape (no armor count), plays on", () => {
    const old = at8a([], { siberian: { used: true, taken: { "1941-winter": 2 } } });
    expect(siberianLeft(old)).toBe(2);
    expect(siberianTakenNow(old)).toEqual({ infantry: 2, armor: 0 });
    const t = takeAll(old, [["infantry", 3, MOSCOW]]);
    expect(t.siberian).toEqual({ used: true, taken: { "1941-winter": 3 }, armor: { "1941-winter": 0 } });
    expect(at8a().siberian).toBeUndefined();
  });
});
