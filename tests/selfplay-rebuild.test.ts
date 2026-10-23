import { describe, expect, it } from "vitest";
import type { GameEvent } from "../src/engine/actions";
import type { GameState } from "../src/engine/types";
import { auditCounters, RebuildTally } from "../scripts/selfplay/rebuild";
import { gameReport, rebuildReport } from "../scripts/selfplay/report";
import { runGame } from "../scripts/selfplay/runner";
import { atStart } from "./helpers";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { counter } from "./board";

// Spec 17 ticket 17-5 (Part E): the self-play report counts returned, rebuilt and lost units from the events, and RB13 (no nation ends with more counters of a kind than its scenario
// lists) is an anomaly when broken. Each check is fed a bad state and must fire, and must stay quiet on real games.

const start = (): GameState => atStart(SCENARIO_1939, 1);
const at = "L32";


describe("the tally of the events", () => {
  const events: GameEvent[] = [
    { type: "UNIT_RETURNED_TO_POOL", unitId: "a", owner: "germany", unitType: "infantry", strength: 3, at, pool: "germany" },
    { type: "UNIT_RETURNED_TO_POOL", unitId: "b", owner: "ussr", unitType: "infantry", strength: 3, at, pool: "ussr" },
    { type: "UNIT_LOST_FOR_GOOD", unitId: "c", owner: "poland", unitType: "infantry", strength: 2, at, reason: "minor-country" },
    { type: "UNIT_LOST_FOR_GOOD", unitId: "d", owner: "poland", unitType: "air", strength: 2, at, reason: "minor-country" },
    { type: "UNIT_LOST_FOR_GOOD", unitId: "e", owner: "turkey" as "poland", unitType: "fleet", strength: 9, at, reason: "fleet-never-rebuilt" },
    { type: "UNIT_BUILT", unitId: "f", owner: "germany", unitType: "infantry", strength: 3, at, cost: 6, returned: true },
    { type: "UNIT_BUILT", unitId: "g", owner: "germany", unitType: "infantry", strength: 3, at, cost: 6 },
    { type: "UNIT_BUILT", unitId: "h", owner: "britain", unitType: "infantry", strength: 2, at, cost: 4, returned: true, pool: "free-france" },
    { type: "SIBERIAN_TRANSFER_USED", unitId: "i", unitType: "infantry", strength: 3, at, left: 3, firstUse: true },
    { type: "RUSSIA_OFFERS_SURRENDER" } as GameEvent,
  ];
  const tally = () => {
    const t = new RebuildTally();
    t.add(events, start(), start());
    return t.result();
  };
  it("counts what returned, per pool", () => {
    const n = tally().nations;
    expect(n.germany!.returned).toBe(1);
    expect(n.ussr!.returned).toBe(1);
  });
  it("counts what was lost for good, by reason", () => {
    const n = tally().nations;
    expect(n.poland!.lostForGood).toEqual({ "minor-country": 2 });
    expect((n as Record<string, { lostForGood: object }>).turkey!.lostForGood).toEqual({ "fleet-never-rebuilt": 1 });
  });
  it("counts only a returned counter as rebuilt, in the pool it came from, and the BRPs on the buyer", () => {
    const n = tally().nations;
    expect(n.germany!.rebuilt).toBe(1);
    expect(n.germany!.brps).toBe(6); // the unmarked build (g) is a new counter
    expect(n["free-france"]!.rebuilt).toBe(1);
    expect(n.britain!.brps).toBe(4);
  });
  it("counts the Siberian units taken for the U.S.S.R. and the surrender offers", () => {
    expect(tally().nations.ussr!.siberian).toBe(1);
    expect(tally().surrenderOffers).toBe(1);
  });
  it("records what each nation left unspent when the year changes, and not otherwise", () => {
    const t = new RebuildTally();
    const s = start();
    t.add([], s, s);
    t.add([], s, { ...s, year: s.year + 1 });
    const ys = t.result().yearStarts;
    expect(ys).toHaveLength(1);
    expect(ys[0]).toMatchObject({ year: s.year + 1, unspent: { germany: s.nations.germany.brpTotal } });
  });
  it("shows in the report", () => {
    const md = rebuildReport(tally());
    expect(md).toContain("| germany | 1 | 1 |");
    expect(md).toContain("minor-country 2");
    expect(md).toContain("made 1 time(s)");
  });
});

describe("RB13: no nation ends with more counters of a kind than its scenario lists", () => {
  const withUnit = (s: GameState, u: ReturnType<typeof counter>): GameState => ({ ...s, units: { ...s.units, [u.id]: u } });
  /** One counter of this kind moved from the nation's pool to the map, as it is at setup. */
  const placed = (s: GameState, owner: "germany" | "france", type: "infantry" | "air"): GameState => {
    const pool = s.pools[owner]!;
    const e = pool.forcePool.find((x) => x.type === type)!;
    const forcePool = pool.forcePool.map((x) => (x === e ? { ...x, count: x.count - 1 } : x));
    return withUnit({ ...s, pools: { ...s.pools, [owner]: { ...pool, forcePool } } }, counter("p1", owner, type, e.strength, at, 3));
  };
  it("is quiet on the start, when a counter moved to the map, and when a counter moved from the map to the pool", () => {
    const s = start();
    expect(auditCounters(s, s)).toEqual([]);
    const onMap = placed(s, "germany", "infantry");
    expect(auditCounters(s, onMap)).toEqual([]);
    const pool = onMap.pools.germany!;
    const back = { ...onMap, units: {}, pools: { ...onMap.pools, germany: { ...pool, allowableBuilds: [...pool.allowableBuilds, { type: "infantry" as const, strength: 3, count: 1, returned: true as const }] } } };
    expect(auditCounters(s, back)).toEqual([]);
  });
  it("fires for a counter that exists twice (on the map and in the pool)", () => {
    const s = start();
    const onMap = placed(s, "germany", "infantry");
    const pool = onMap.pools.germany!;
    const doubled = { ...onMap, pools: { ...onMap.pools, germany: { ...pool, allowableBuilds: [...pool.allowableBuilds, { type: "infantry" as const, strength: 3, count: 1, returned: true as const }] } } };
    expect(auditCounters(s, doubled).map((f) => f.kind)).toEqual(["counter-excess"]);
    expect(auditCounters(s, doubled)[0]!.detail).toMatch(/^germany infantry: \d+ at the end/);
  });
  it("fires for one more counter on the map", () => {
    const s = start();
    expect(auditCounters(s, withUnit(s, counter("x1", "germany", "armor", 3, at, 3))).map((f) => f.kind)).toEqual(["counter-excess"]);
  });
  it("counts air units in factors: a break-down is not an excess, one more factor is", () => {
    const s = start();
    const one = placed(s, "germany", "air"); // a 5 on the map
    const split = { ...withUnit(one, counter("p2", "germany", "air", 2, at, 4)), units: { p1: counter("p1", "germany", "air", 3, at, 4), p2: counter("p2", "germany", "air", 2, at, 4) } };
    expect(auditCounters(s, split)).toEqual([]);
    expect(auditCounters(s, withUnit(split, counter("p3", "germany", "air", 1, at, 4))).map((f) => f.kind)).toEqual(["counter-excess"]);
  });
  it("leaves airbases and bridgeheads out (no pool holds them)", () => {
    const s = start();
    expect(auditCounters(s, withUnit(s, counter("ab", "germany", "airbase", 1, at)))).toEqual([]);
  });
  it("counts a Vichy or Free French counter as French", () => {
    const s = start();
    const fr = placed(s, "france", "infantry");
    expect(auditCounters(s, { ...fr, units: { p1: { ...fr.units.p1!, owner: "vichy-france" } } })).toEqual([]);
    expect(auditCounters(s, withUnit(fr, counter("v2", "vichy-france", "infantry", 2, at, 3))).map((f) => f.detail)[0]).toMatch(/^france infantry/);
  });
  it("counts a counter by its nationality (the Italian fleet Germany holds is Italian)", () => {
    const s = start();
    const pool = s.pools.italy!;
    const e = pool.forcePool.find((x) => x.type === "fleet")!;
    const moved = withUnit({ ...s, pools: { ...s.pools, italy: { ...pool, forcePool: pool.forcePool.map((x) => (x === e ? { ...x, count: x.count - 1 } : x)) } } }, { ...counter("f1", "germany", "fleet", 9, at), nationality: "italy" });
    expect(auditCounters(s, moved)).toEqual([]);
  });
});

describe("whole games", () => {
  it("a played game has a rebuild section and no counter-excess; the same game replays to the same numbers", () => {
    const r = runGame({ scenario: "1939", seed: 1, turns: 6, verify: false });
    expect(r.anomalies.filter((a) => a.kind === "counter-excess")).toEqual([]);
    const n = r.rebuild.nations;
    expect(Object.values(n).reduce((a, x) => a + x.returned, 0)).toBeGreaterThan(0);
    expect(Object.values(n).reduce((a, x) => a + x.rebuilt, 0)).toBeGreaterThan(0);
    expect(gameReport(r)).toContain("## Lost units and rebuilds");
    expect(runGame({ scenario: "1939", seed: 1, turns: 6, verify: false }).rebuild).toEqual(r.rebuild);
  });
  it("the rebuilds counted are the UNIT_BUILT events marked returned", () => {
    const r = runGame({ scenario: "1939", seed: 2, turns: 8, verify: false });
    const built = r.turns.reduce((a, t) => a + t.built, 0);
    const rebuilt = Object.values(r.rebuild.nations).reduce((a, x) => a + x.rebuilt, 0);
    expect(rebuilt).toBeLessThanOrEqual(built);
  });
});
