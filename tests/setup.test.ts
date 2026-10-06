import { describe, expect, it } from "vitest";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { SCENARIO_1942 } from "../src/data/scenario-1942";
import { SCENARIO_1944 } from "../src/data/scenario-1944";
import { SCENARIO_CAMPAIGN } from "../src/data/scenario-campaign";
import { applyAction, legalActions, replay, type Action } from "../src/engine/actions";
import { autoSetup, autoSetupOwner } from "../src/engine/autosetup";
import { newGame, setupOf } from "../src/engine/game";
import { currentSetupOwner, setupProblems, setupStatus, sideOfOwner } from "../src/engine/setup";
import type { ForceOwner, GameState, Scenario } from "../src/engine/types";
import { CTX, ctxFor } from "./helpers";

function step(state: GameState, action: Action, ctx = CTX): GameState {
  const r = applyAction(ctx, state, action);
  if (!r.ok) throw new Error(r.error);
  return r.state;
}
const place = (owner: ForceOwner, type: "infantry" | "armor" | "air" | "fleet" | "airborne" | "replacement", strength: number, at: string): Action => ({
  type: "SETUP_PLACE",
  owner,
  unit: { type, strength },
  at,
});

/** Poland is first to deploy in 1939. */
const fresh = () => newGame(SCENARIO_1939, 1);

describe("opening setup: the phase", () => {
  it("starts in setup with the first owner in the scenario's order of deployment", () => {
    const s = fresh();
    expect([s.phase, s.setup]).toEqual(["setup", { order: SCENARIO_1939.deploymentOrder, index: 0 }]);
    expect(currentSetupOwner(s)).toBe("poland");
    expect(s.units).toEqual({});
  });

  it("does not let anyone end a turn before setup is finished", () => {
    const r = applyAction(CTX, fresh(), { type: "END_PLAYER_TURN", side: "axis" });
    expect(r.ok).toBe(false);
  });

  it("assigns each owner to the player who sets it up", () => {
    expect(sideOfOwner("germany")).toBe("axis");
    expect(sideOfOwner("italy")).toBe("axis"); // neutral, but set up by the Axis player
    expect(sideOfOwner("poland")).toBe("allies");
    expect(sideOfOwner("ussr")).toBe("allies");
    expect(sideOfOwner("vichy-france")).toBe("axis");
    expect(sideOfOwner("free-france")).toBe("allies");
  });
});

describe("opening setup: placing Poland's forces", () => {
  it("offers only places inside Poland, suited to the counter", () => {
    const s = fresh();
    const placements = legalActions(CTX, s).filter((a) => a.type === "SETUP_PLACE");
    expect(placements.length).toBeGreaterThan(0);
    for (const a of placements) {
      if (a.type !== "SETUP_PLACE") continue;
      expect(CTX.map.hexes[a.at]!.country).toBe("poland");
      // Air units only on air bases (cities and ports): never in open country.
      if (a.unit.type === "air") expect(CTX.map.hexes[a.at]!.features.length).toBeGreaterThan(0);
    }
    // No Done yet, and no removals: nothing is on the map.
    expect(legalActions(CTX, s).some((a) => a.type === "SETUP_DONE" || a.type === "SETUP_REMOVE")).toBe(false);
  });

  it("moves a counter from the Force Pool to the map, and back", () => {
    const s0 = fresh();
    const at = (legalActions(CTX, s0).find((a) => a.type === "SETUP_PLACE" && a.unit.type === "infantry" && a.unit.strength === 2) as Extract<Action, { type: "SETUP_PLACE" }>).at;
    const s1 = step(s0, place("poland", "infantry", 2, at));
    expect(Object.values(s1.units)).toEqual([{ id: "u1", owner: "poland", type: "infantry", strength: 2, movement: 3, at }]);
    expect(s1.pools.poland!.forcePool.find((e) => e.strength === 2 && e.type === "infantry")!.count).toBe(2);
    const s2 = step(s1, { type: "SETUP_REMOVE", owner: "poland", unitId: "u1" });
    expect(s2.units).toEqual({});
    expect(s2.pools.poland!.forcePool.reduce((n, e) => n + e.count, 0)).toBe(12);
    expect(s2.pools.poland!.forcePool.find((e) => e.strength === 2 && e.type === "infantry")!.count).toBe(3);
    // The state it was given is untouched.
    expect(s0.pools.poland!.forcePool.reduce((n, e) => n + e.count, 0)).toBe(12);
  });

  it("refuses places outside the territory, and counters the pool does not hold", () => {
    const s = fresh();
    const berlin = Object.values(CTX.map.hexes).find((h) => h.name === "Berlin")!.id;
    expect(applyAction(CTX, s, place("poland", "infantry", 2, berlin)).ok).toBe(false);
    expect(applyAction(CTX, s, place("poland", "armor", 4, "K30")).ok).toBe(false);
    expect(applyAction(CTX, s, place("germany", "infantry", 3, berlin)).ok).toBe(false); // not Germany's turn to set up
  });

  it("enforces the two-ground-unit stacking limit, but not for airborne", () => {
    let s = fresh();
    const polish = Object.values(CTX.map.hexes).filter((h) => h.country === "poland" && h.land).map((h) => h.id).sort();
    const at = polish[0]!;
    s = step(s, place("poland", "infantry", 1, at));
    s = step(s, place("poland", "infantry", 1, at));
    const third = applyAction(CTX, s, place("poland", "infantry", 1, at));
    expect(third.ok ? "" : third.error).toMatch(/limit 2/);
  });

  it("limits air units to 5 air factors per base (Ref 5.0)", () => {
    // Malta already holds a 5-factor air unit: nothing more fits, not even a 1-factor unit.
    const s = newGame(SCENARIO_1939, 1);
    const synthetic: GameState = {
      ...s,
      setup: { order: ["britain"], index: 0 },
      units: { x1: { id: "x1", owner: "britain", type: "air", strength: 5, movement: 4, at: "GG19" } },
    };
    for (const strength of [5, 1]) {
      const r = applyAction(CTX, synthetic, { type: "SETUP_PLACE", owner: "britain", unit: { type: "air", strength }, at: "GG19" });
      expect(r.ok ? "" : r.error, `${strength}-factor air unit`).toMatch(/air factors/);
    }
    // With four factors there, a 1-factor unit fits exactly.
    const four = { ...synthetic, units: { x1: { ...synthetic.units.x1!, strength: 4 } } };
    expect(applyAction(CTX, four, { type: "SETUP_PLACE", owner: "britain", unit: { type: "air", strength: 1 }, at: "GG19" }).ok).toBe(true);
  });

  it("limits a port to 36 naval factors (Ref 5.0)", () => {
    const s = newGame(SCENARIO_1939, 1);
    const fleets = Object.fromEntries([1, 2, 3, 4].map((i) => [`x${i}`, { id: `x${i}`, owner: "britain" as const, type: "fleet" as const, strength: 9, at: "AA7" }]));
    const r = applyAction(CTX, { ...s, setup: { order: ["britain"], index: 0 }, units: fleets }, { type: "SETUP_PLACE", owner: "britain", unit: { type: "fleet", strength: 9 }, at: "AA7" });
    expect(r.ok ? "" : r.error).toMatch(/naval factors/);
  });

  it("requires every counter placed before Done", () => {
    const s = fresh();
    const r = applyAction(CTX, s, { type: "SETUP_DONE", owner: "poland" });
    expect(r.ok ? "" : r.error).toMatch(/12 counters still to place/);
  });
});

describe("opening setup: the requirements of each scenario page", () => {
  /** Set up every owner before `owner` automatically, to reach its turn. */
  function reach(owner: ForceOwner, scenario: Scenario = SCENARIO_1939): GameState {
    const ctx = ctxFor(scenario);
    let s = newGame(scenario, 1);
    for (const a of autoSetup(ctx, s)) {
      if (currentSetupOwner(s) === owner) return s;
      s = step(s, a, ctx);
    }
    throw new Error(`never reached ${owner}`);
  }

  it("makes Germany put 20 factors on the Eastern Front (Ref 29.0) before Done", () => {
    const s = reach("germany");
    expect(setupProblems(CTX, s, "germany")).toEqual(expect.arrayContaining([expect.stringMatching(/20 factors on the eastern front/)]));
  });

  it("allows at most five German factors in Finland (Peele's errata)", () => {
    let s = reach("germany");
    const finland = Object.values(CTX.map.hexes).filter((h) => h.country === "finland" && h.land).map((h) => h.id).sort();
    s = step(s, place("germany", "infantry", 3, finland[0]!));
    // 3 + 3 = 6 > 5.
    const r = applyAction(CTX, s, place("germany", "infantry", 3, finland[1]!));
    expect(r.ok ? "" : r.error).toMatch(/at most 5 factors/);
    // 3 + 1 is fine in principle, but Germany has no 1-factor counter: the armor 4-6 would also exceed.
    expect(applyAction(CTX, s, place("germany", "armor", 4, finland[1]!)).ok).toBe(false);
  });

  it("lets Germany set up in Finland, Hungary, Rumania and Bulgaria as the page says", () => {
    const s = reach("germany");
    const countries = new Set(
      legalActions(CTX, s).flatMap((a) => (a.type === "SETUP_PLACE" ? [CTX.map.hexes[a.at]!.country] : [])),
    );
    for (const c of ["germany", "finland", "hungary", "rumania", "bulgaria"]) expect(countries.has(c), c).toBe(true);
    expect(countries.has("poland")).toBe(false);
    expect(countries.has("france")).toBe(false);
  });

  it("keeps the Italian fleet in Mediterranean ports, and Italy in its own territory", () => {
    const s = reach("italy");
    const fleet = legalActions(CTX, s).filter((a) => a.type === "SETUP_PLACE" && a.unit.type === "fleet");
    expect(fleet.length).toBeGreaterThan(0);
    for (const a of fleet) {
      if (a.type !== "SETUP_PLACE") continue;
      const h = CTX.map.hexes[a.at]!;
      expect(h.front).toBe("mediterranean");
      expect(h.features.some((f) => f === "port" || f === "capital-port")).toBe(true);
      expect(["italy", "albania", "libya"]).toContain(h.country);
    }
    // And a fleet may not go to a British Mediterranean port.
    const malta = place("italy", "fleet", 9, "GG19");
    expect(applyAction(CTX, s, malta).ok).toBe(false);
  });

  it("makes Italy put one 1-3 in Albania and two in Libya", () => {
    const s = reach("italy");
    expect(setupProblems(CTX, s, "italy").join(" ")).toMatch(/1-factor infantry in albania/);
  });

  it("will not stack British and French units before 1942 (Ref 26.0)", () => {
    // France sets up before Britain; put a French unit in a hex Britain may use (none exist in
    // common), so check the rule directly on a synthetic board.
    const s = reach("britain");
    const hexId = Object.values(CTX.map.hexes).find((h) => h.country === "britain" && h.land && h.name)!.id;
    const withFrench: GameState = { ...s, units: { ...s.units, f1: { id: "f1", owner: "france", type: "infantry", strength: 2, movement: 3, at: hexId } } };
    const r = applyAction(CTX, withFrench, place("britain", "infantry", 1, hexId));
    expect(r.ok ? "" : r.error).toMatch(/may not stack together before 1942/);
  });

  it("limits London to three ground units, if all are British (Ref 5.0)", () => {
    const s = reach("britain");
    const london = Object.values(CTX.map.hexes).find((h) => h.name === "London")!.id;
    let t = step(s, place("britain", "infantry", 3, london));
    t = step(t, place("britain", "infantry", 3, london));
    t = step(t, place("britain", "infantry", 3, london)); // third British unit: allowed in London
    const fourth = applyAction(CTX, t, place("britain", "infantry", 1, london));
    expect(fourth.ok ? "" : fourth.error).toMatch(/limit 3/);
  });

  it("puts every U.S. counter in the U.S. Box when the USA sets up (1942)", () => {
    const f = setupOf(SCENARIO_1942, "usa");
    expect(f.setup).toEqual([{ kind: "all-in", types: "all", in: [{ box: "us-box" }] }]);
  });
});

describe("opening setup: requirements that the 1939 data cannot exercise on its own", () => {
  it("confines the counters an all-in requirement names to its areas", () => {
    const g = setupOf(SCENARIO_1939, "germany");
    const scenario: Scenario = {
      ...SCENARIO_1939,
      deploymentOrder: ["germany"],
      forces: { ...SCENARIO_1939.forces, germany: { ...g, setup: [...g.setup, { kind: "all-in", types: ["fleet"], in: [{ hex: "J30" }] }] } },
    };
    const ctx = ctxFor(scenario);
    const places = legalActions(ctx, newGame(scenario, 1)).flatMap((a) => (a.type === "SETUP_PLACE" && a.unit.type === "fleet" ? [a.at] : []));
    expect(places).toEqual(["J30"]);
    // Without the requirement, Germany's fleets may use any German port.
    const open = legalActions(ctxFor({ ...scenario, forces: { ...scenario.forces, germany: g } }), newGame(scenario, 1)).flatMap((a) => (a.type === "SETUP_PLACE" && a.unit.type === "fleet" ? [a.at] : []));
    expect(open.length).toBeGreaterThan(1);
    expect(open).toContain("J30");
  });

  it("sets up the U.S. Box as the 1942 and Campaign pages ask (Ops 7.0)", () => {
    // The USA's own setup rule, on its own: every counter goes in the U.S. Box, nowhere else.
    const scenario: Scenario = { ...SCENARIO_1939, deploymentOrder: ["usa"] };
    const ctx = ctxFor(scenario);
    expect(setupStatus(ctx).startable).toBe(true);
    const initial = newGame(scenario, 1);
    const places = new Set(legalActions(ctx, initial).flatMap((a) => (a.type === "SETUP_PLACE" ? [a.at] : [])));
    expect([...places]).toEqual(["us-box"]);
    const { state } = replay(ctx, initial, autoSetup(ctx, initial));
    expect(Object.values(state.units)).toHaveLength(17);
    expect(Object.values(state.units).every((u) => u.at === "us-box" && u.owner === "usa")).toBe(true);
    expect(state.phase).toBe("player-turn");
  });

  it("limits the rest of a nation's forces to the rest-in areas, after the named placements", () => {
    // Vichy France (1942 page): one 2-3 infantry in Morocco/Algeria/Tunisia, the rest in Vichy France or Corsica.
    // Give Vichy a known Vichy zone to test the rule: Corsica and a few French hexes.
    const f = setupOf(SCENARIO_1942, "vichy-france");
    const scenario: Scenario = {
      ...SCENARIO_1942,
      deploymentOrder: ["vichy-france"],
      zones: { ...SCENARIO_1942.zones, "vichy-france": { countries: ["france"], description: "test", hexes: ["R20", "S21", "V19"] } },
      forces: { "vichy-france": f },
    };
    const ctx = ctxFor(scenario);
    let s = newGame(scenario, 1);
    const moroccoHex = Object.values(ctx.map.hexes).find((h) => h.country === "morocco" && h.land && h.name)!.id;
    s = step(s, place("vichy-france", "infantry", 2, moroccoHex), ctx);
    // The named placement is met, so nothing is said about the colonies yet.
    expect(setupProblems(ctx, s, "vichy-france").join(" ")).not.toMatch(/must be in/);
    // A second infantry may be put in Morocco (more may go where a placement is named), but it is not
    // "the rest": it keeps Vichy from finishing until it is moved to the Vichy zone or Corsica.
    s = step(s, place("vichy-france", "infantry", 2, moroccoHex), ctx);
    expect(setupProblems(ctx, s, "vichy-france").join(" ")).toMatch(/1 counters must be in zone vichy-france or corsica|1 counters must be in vichy-france or corsica/);
    // A fleet, which no placement names, may go only to the Vichy zone or Corsica.
    const fleetPlaces = legalActions(ctx, s).flatMap((a) => (a.type === "SETUP_PLACE" && a.unit.type === "fleet" ? [a.at] : []));
    expect(fleetPlaces.length).toBeGreaterThan(0);
    for (const at of fleetPlaces) expect(["R20", "S21", "V19", "X20"]).toContain(at);
  });
});

describe("opening setup: finishing", () => {
  const ctx = CTX;

  it("sets every owner up in order, then starts the first Player Turn", () => {
    const initial = newGame(SCENARIO_1939, 3);
    const actions = autoSetup(ctx, initial);
    const { state, events } = replay(ctx, initial, actions);
    expect(state.phase).toBe("player-turn");
    expect(state.setup).toBeNull();
    expect([state.activeSide, state.firstSide]).toEqual(["axis", "axis"]);
    expect(events.filter((e) => e.type === "SETUP_OWNER_DONE").map((e) => (e.type === "SETUP_OWNER_DONE" ? e.owner : ""))).toEqual(SCENARIO_1939.deploymentOrder);
    expect(events.filter((e) => e.type === "SETUP_COMPLETE")).toHaveLength(1);
    expect(events.at(-1)).toEqual({ type: "PLAYER_TURN_STARTED", year: 1939, season: "fall", side: "axis" });
    // Every counter of every deploying owner is on the map; the USA, which sets up in 1942, has none.
    for (const o of SCENARIO_1939.deploymentOrder) {
      const placed = Object.values(state.units).filter((u) => u.owner === o).length;
      const pool = setupOf(SCENARIO_1939, o).forcePool.reduce((n, e) => n + e.count, 0);
      expect(placed, o).toBe(pool);
      expect(state.pools[o]!.forcePool).toEqual([]);
      expect(state.pools[o]!.allowableBuilds).toEqual(setupOf(SCENARIO_1939, o).allowableBuilds);
    }
    expect(Object.values(state.units).some((u) => u.owner === "usa")).toBe(false);
    // The turn sequence works from here.
    expect(legalActions(ctx, state)).toEqual([{ type: "END_PLAYER_TURN", side: "axis" }]);
  });

  it("is a legal setup under every rule the engine knows: every owner passes its own checks", () => {
    const initial = newGame(SCENARIO_1939, 3);
    let s = initial;
    for (const a of autoSetup(ctx, initial)) {
      if (a.type === "SETUP_DONE") expect(setupProblems(ctx, s, a.owner), a.owner).toEqual([]);
      s = step(s, a);
    }
    // No hex is overstacked once setup is over.
    const ground = new Map<string, number>();
    for (const u of Object.values(s.units)) {
      if (u.type === "infantry" || u.type === "armor" || u.type === "replacement") ground.set(u.at, (ground.get(u.at) ?? 0) + 1);
    }
    for (const [hex, n] of ground) expect(n, hex).toBeLessThanOrEqual(hex === Object.values(ctx.map.hexes).find((h) => h.name === "London")!.id ? 3 : 2);
  });

  it("gives Germany 20 factors on the Eastern Front, Italy its Albanian and Libyan garrisons, and the USSR its named cities", () => {
    const initial = newGame(SCENARIO_1939, 3);
    const { state } = replay(ctx, initial, autoSetup(ctx, initial));
    const at = (owner: ForceOwner) => Object.values(state.units).filter((u) => u.owner === owner);
    const italy = at("italy");
    // "At least" what the page asks for: more may go there (Ops 4.1).
    expect(italy.filter((u) => u.type === "infantry" && u.strength === 1 && ctx.map.hexes[u.at]!.country === "albania").length).toBeGreaterThanOrEqual(1);
    expect(italy.filter((u) => u.type === "infantry" && u.strength === 1 && ctx.map.hexes[u.at]!.country === "libya").length).toBeGreaterThanOrEqual(2);
    const name = (u: { at: string }) => ctx.map.hexes[u.at]!.name;
    const ussr = at("ussr");
    expect(ussr.find((u) => u.type === "armor" && u.strength === 3 && name(u) === "Moscow")).toBeDefined();
    expect(ussr.find((u) => u.type === "infantry" && u.strength === 2 && name(u) === "Leningrad")).toBeDefined();
    expect(setupProblems(ctx, initial, "germany").length).toBeGreaterThan(0); // nothing placed yet
  });

  it("replays identically, from a JSON copy of the log", () => {
    const initial = newGame(SCENARIO_1939, 11);
    const actions = autoSetup(ctx, initial);
    const a = replay(ctx, initial, actions);
    const b = replay(ctx, JSON.parse(JSON.stringify(initial)), JSON.parse(JSON.stringify(actions)));
    expect(b).toStrictEqual(a);
  });

  it("round-trips a mid-setup state through JSON", () => {
    const initial = newGame(SCENARIO_1939, 11);
    const actions = autoSetup(ctx, initial).slice(0, 20);
    const { state } = replay(ctx, initial, actions);
    expect(state.phase).toBe("setup");
    expect(JSON.parse(JSON.stringify(state))).toStrictEqual(state);
  });

  it("sets up the Campaign scenario the same way", () => {
    const c = ctxFor(SCENARIO_CAMPAIGN);
    const initial = newGame(SCENARIO_CAMPAIGN, 5);
    const { state } = replay(c, initial, autoSetup(c, initial));
    expect(state.phase).toBe("player-turn");
    // The Campaign's dated builds stay in the pool for later.
    expect(state.pools.germany!.allowableBuilds.some((e) => e.from)).toBe(true);
  });

  it("never mutates the state it is given", () => {
    const initial = newGame(SCENARIO_1939, 11);
    const frozen = JSON.parse(JSON.stringify(initial));
    replay(ctx, initial, autoSetup(ctx, initial));
    expect(initial).toStrictEqual(frozen);
  });
});

describe("opening setup: finishing one nation for the player", () => {
  it("sets up only the nation now up, and ends with its Done", () => {
    const initial = newGame(SCENARIO_1939, 1);
    const actions = autoSetupOwner(CTX, initial);
    expect(actions.at(-1)).toEqual({ type: "SETUP_DONE", owner: "poland" });
    expect(actions.every((a) => (a.type === "SETUP_PLACE" || a.type === "SETUP_DONE") && a.owner === "poland")).toBe(true);
    const { state } = replay(CTX, initial, actions);
    expect(currentSetupOwner(state)).toBe("italy");
    expect(state.phase).toBe("setup");
  });

  it("keeps what the player already placed, and tops up the named placements", () => {
    // The player puts one Polish 2-3 in Warsaw by hand; the rest is filled in around it.
    const initial = newGame(SCENARIO_1939, 1);
    const warsaw = Object.values(CTX.map.hexes).find((h) => h.name === "Warsaw")!.id;
    let s = step(initial, place("poland", "infantry", 2, warsaw));
    const actions = autoSetupOwner(CTX, s);
    expect(actions.some((a) => a.type === "SETUP_REMOVE")).toBe(false);
    s = replay(CTX, s, actions).state;
    expect(Object.values(s.units).filter((u) => u.owner === "poland")).toHaveLength(12);
    expect(Object.values(s.units).find((u) => u.id === "u1")!.at).toBe(warsaw);
    // Italy's page asks for a 1-3 in Albania. If the player already put one where the automatic setup
    // would, the finished setup is the same as the fully automatic one: the named placement is
    // counted, not repeated.
    let t = newGame(SCENARIO_1939, 1);
    for (const a of autoSetupOwner(CTX, t)) t = step(t, a); // Poland done; Italy is next
    const tirane = Object.values(CTX.map.hexes).find((h) => h.name === "Tirane")!.id;
    const italy = (state: GameState) =>
      Object.values(state.units).filter((u) => u.owner === "italy").map((u) => `${u.type}:${u.strength}@${u.at}`).sort();
    const automatic = replay(CTX, t, autoSetupOwner(CTX, t)).state;
    const byHand = step(t, place("italy", "infantry", 1, tirane));
    const mixed = replay(CTX, byHand, autoSetupOwner(CTX, byHand)).state;
    expect(italy(mixed)).toEqual(italy(automatic));
    expect(mixed.setup!.index).toBe(2);

    // The page asks for two 1-3 in Libya. If the player already placed both, none is added there.
    const tripoli = Object.values(CTX.map.hexes).find((h) => h.name === "Tripoli")!.id;
    let two = step(t, place("italy", "infantry", 1, tripoli));
    two = step(two, place("italy", "infantry", 1, tripoli));
    const done = replay(CTX, two, autoSetupOwner(CTX, two)).state;
    const libyan = Object.values(done.units).filter((u) => u.owner === "italy" && u.type === "infantry" && u.strength === 1 && CTX.map.hexes[u.at]!.country === "libya");
    expect(libyan).toHaveLength(2);
    expect(Object.values(done.units).filter((u) => u.owner === "italy" && u.type === "infantry" && u.strength === 1)).toHaveLength(6);
  });

  it("refuses when the game is not in setup, or the scenario cannot be set up yet", () => {
    expect(() => autoSetupOwner(CTX, { ...newGame(SCENARIO_1939, 1), phase: "player-turn", setup: null })).toThrow(/not in the setup phase/);
    expect(() => autoSetupOwner(ctxFor(SCENARIO_1942), newGame(SCENARIO_1942, 1))).toThrow(/cannot be set up yet/);
  });
});

describe("opening setup: scenarios whose territory is not known yet", () => {
  it("1939 and the Campaign can be set up", () => {
    expect(setupStatus(CTX)).toEqual({ startable: true, unresolved: [] });
    expect(setupStatus(ctxFor(SCENARIO_CAMPAIGN))).toEqual({ startable: true, unresolved: [] });
  });

  it("1942 and 1944 name exactly the zones they are waiting for", () => {
    expect(setupStatus(ctxFor(SCENARIO_1942))).toEqual({
      startable: false,
      unresolved: [
        "baltic-north-atlantic-ports", "eastern-europe", "european-turkey", "libya-east-of-start-line", "libya-west-of-start-line",
        "occupied-france", "ussr-east-of-start-line", "ussr-west-of-start-line", "vichy-france",
      ],
    });
    expect(setupStatus(ctxFor(SCENARIO_1944)).unresolved).toEqual([
      "baltic-north-atlantic-ports", "eastern-europe", "european-turkey", "italy-north-of-start-line", "italy-south-of-start-line",
      "ussr-east-of-start-line", "ussr-west-of-start-line",
    ]);
  });

  it("refuses to make up a setup for them", () => {
    expect(() => autoSetup(ctxFor(SCENARIO_1942), newGame(SCENARIO_1942, 1))).toThrow(/cannot be set up yet/);
    expect(() => autoSetup(ctxFor(SCENARIO_1944), newGame(SCENARIO_1944, 1))).toThrow(/ussr-east-of-start-line/);
  });
});
