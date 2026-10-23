import { describe, expect, it, vi } from "vitest";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { SCENARIO_1942 } from "../src/data/scenario-1942";
import { SCENARIO_1944 } from "../src/data/scenario-1944";
import { SCENARIO_CAMPAIGN } from "../src/data/scenario-campaign";
import { applyAction, replay, type Action } from "../src/engine/actions";
import { autoSetup } from "../src/engine/autosetup";
import { newGame } from "../src/engine/game";
import { combatOf } from "../src/engine/combat-record";
import { displaceFleets, displacementPort } from "../src/engine/naval-displace";
import { portCapacity, portsOf } from "../src/engine/naval-ports";
import type * as Rules from "../src/engine/naval-rules";
import { stackingProblem } from "../src/engine/placement";
import type { GameState, Scenario, Unit } from "../src/engine/types";
import { board, counter } from "./board";
import { ALL_OFFENSIVE, CTX, ctxFor } from "./helpers";

// Spec 12 ticket 12-4 (R2, R9; Ref 21.1, 12.4, 5.0, 33.0; decision D1 of spec 09): a fleet left alone in a taken port is displaced to the nearest friendly port
// on its Front with room, or eliminated; a port bases 36 naval factors and Malta, Suda Bay and Famagusta 9. Named hexes: K28 Wilhelmshaven, K29 Bremen, J30 Kiel,
// B29 Scapa Flow, F24 Belfast, F26 Rosyth, K21 Plymouth, L22 Southampton, N18 Brest, CC9 Oran, V38 Sevastopol, T37 Odessa, GG19 Malta, GG26 Suda Bay, GG34 Famagusta.
const fleet = (id: string, owner: Unit["owner"], at: string, strength = 9, nationality?: Unit["nationality"]): Unit => ({ ...counter(id, owner, "fleet", strength, at), ...(nationality ? { nationality } : {}) });
const place = (s: GameState, ...units: Unit[]): GameState => ({ ...s, units: { ...s.units, ...Object.fromEntries(units.map((u) => [u.id, u])) } });
const where = (ctx: typeof CTX, s: GameState, f: Unit): string | null => displacementPort(ctx, s, f, f.at);

describe("the closest port with room on the fleet's Front, by sea route (R9; N15, N16)", () => {
  it("is the nearest by sea route; equal routes go to the lowest hex id (Scapa Flow: Belfast and Rosyth are both 5 away)", () => {
    const f = fleet("f1", "britain", "B29");
    expect(where(CTX, board([f]), f)).toBe("F24");
    const p = fleet("f2", "britain", "K21");
    expect(where(CTX, board([p]), p)).toBe("L22"); // Plymouth to Southampton, 3
  });

  it("the tie goes to the lowest hex id as text, not to the port that comes first on the map (Valencia: Algiers CC12 and Oran CC9 are 5 away)", () => {
    const f = fleet("f1", "britain", "X13");
    expect(where(CTX, board([f]), f)).toBe("CC12");
  });

  it("stays on the fleet's Front even when a port of another Front is much nearer (Cadiz, Gibraltar lost: Oran is 5, Brest 16)", () => {
    const f = fleet("f1", "britain", "Z7");
    expect(where(CTX, board([f], undefined, { control: { AA7: "germany" } }), f)).toBe("N18");
    expect(where(CTX, board([f]), f)).toBe("AA7"); // with Gibraltar British it is the nearest, and serves both Fronts
  });

  it("takes only ports the fleet's side controls", () => {
    const f = fleet("f1", "germany", "K28");
    expect(where(CTX, board([f]), f)).toBe("J30"); // Kiel and Bremen are both 3 away: the lowest id
    const kielLost = board([f], undefined, { control: { J30: "britain" } });
    expect(where(CTX, kielLost, f)).toBe("K29");
  });

  it("skips a port without room for the whole counter (a 9-factor fleet needs 9 free), then takes the next", () => {
    const f = fleet("f1", "germany", "K28");
    const crowded = board([f, fleet("a", "germany", "J30", 9), fleet("b", "germany", "J30", 9), fleet("c", "germany", "J30", 9), fleet("d", "germany", "J30", 1)]);
    expect(stackingProblem(CTX, crowded, "germany", { type: "fleet", strength: 9 }, "J30")).toMatch(/would hold 37 naval factors \(limit 36\)/);
    expect(where(CTX, crowded, f)).toBe("K29");
    const tight = board([f, fleet("a", "germany", "J30", 9), fleet("b", "germany", "J30", 9), fleet("c", "germany", "J30", 9), fleet("d", "germany", "J30", 1), fleet("e", "germany", "K29", 9), fleet("g", "germany", "K29", 9), fleet("h", "germany", "K29", 9), fleet("i", "germany", "K29", 2)]);
    expect(where(CTX, tight, f)).not.toBe("J30");
    expect(where(CTX, tight, f)).not.toBe("K29");
  });

  it("a small fleet fits where a large one does not", () => {
    const small = fleet("s", "germany", "K28", 1);
    const crowded = board([small, fleet("a", "germany", "J30", 9), fleet("b", "germany", "J30", 9), fleet("c", "germany", "J30", 9), fleet("d", "germany", "J30", 1)]);
    expect(where(CTX, crowded, small)).toBe("J30");
  });

  it("is eliminated when the side holds no port on the Front with room and a route: the Black Sea never reaches the Baltic (Ref 21.1)", () => {
    const base = board([]);
    const ussr = { ...base.nations.ussr, status: "allied" as const };
    const f = fleet("f1", "ussr", "V38");
    const open = board([f], undefined, { nations: { ...base.nations, ussr } });
    expect(where(CTX, open, f)).toBe("T37"); // Odessa, 3 hexes
    const closed = board([f], undefined, { nations: { ...base.nations, ussr }, control: { T37: "germany", X43: "germany" } });
    expect(where(CTX, closed, f)).toBeNull(); // Leningrad is Eastern too, but no sea joins the two
  });

  it("a fleet in a two-Front port takes the nearest port on either Front (N37): from Kiel, Bremen at 1", () => {
    const f = fleet("f1", "germany", "J30");
    expect(where(CTX, board([f]), f)).toBe("K29");
  });

  it("a French fleet goes only to a French-controlled port, on its Front or else on any (N37)", () => {
    const f = fleet("f1", "france", "N18");
    expect(where(CTX, board([f]), f)).toBe("N19"); // Lorient
    const gone = board([f], undefined, { control: Object.fromEntries(["L24", "M21", "N18", "N19", "O19", "Q18"].map((h) => [h, "germany" as const])) });
    expect(where(CTX, gone, f)).toBe("CC9"); // Oran, 21 hexes by sea, nearer than Marseilles at 29
    const noFrench = board([f], undefined, { control: { ...gone.control, CC9: "britain", CC12: "britain", V19: "germany", X20: "germany", DD17: "germany", HH35: "germany" } });
    expect(where(CTX, noFrench, f)).toBeNull();
  });

  it("a fleet not in a port, or of a side not at war, finds nowhere to go", () => {
    expect(where(CTX, board([]), fleet("f1", "germany", "M35"))).toBeNull(); // Warsaw is no port
    expect(where(CTX, board([]), fleet("f2", "ussr", "V38"))).toBeNull(); // the U.S.S.R. is neutral in 1939
  });
});

describe("displaceFleets: one event each, in unit-id order, room counted as it fills", () => {
  it("two fleets go one after the other, the second to the next port when the first fills the nearest", () => {
    const a = fleet("u2", "germany", "K28");
    const b = fleet("u10", "germany", "K28");
    const fill = ["x1", "x2", "x3"].map((id) => fleet(id, "germany", "J30"));
    const s = place(board([]), a, b, ...fill);
    const r = displaceFleets(CTX, s, "K28", [b, a]);
    expect(r.events).toEqual([
      { type: "FLEET_DISPLACED", unitId: "u2", owner: "germany", from: "K28", to: "J30" }, // Kiel and Bremen are both 3 away: the lowest id, and it now holds 36
      { type: "FLEET_DISPLACED", unitId: "u10", owner: "germany", from: "K28", to: "K29" },
    ]);
    expect(r.state.units.u2!.at).toBe("J30");
    expect(s.units.u2!.at).toBe("K28"); // the old state is untouched
  });

  it("a fleet with nowhere to go is removed, and the event says so", () => {
    const f = fleet("f1", "germany", "M35");
    const r = displaceFleets(CTX, place(board([]), f), "M35", [f]);
    expect(r.events).toEqual([{ type: "FLEET_DISPLACED", unitId: "f1", owner: "germany", from: "M35", to: null }]);
    expect(r.state.units.f1).toBeUndefined();
  });
});

describe("a taken port in play: the sweep and the battle (decision D1)", () => {
  const at7h = (units: Unit[], extra: Partial<GameState> = {}): GameState => place({ ...board([], undefined, { activeSide: "allies", frontOptions: ALL_OFFENSIVE, position: { part: "player-turn", turn: 1, step: "7h" }, ...extra }) }, ...units);
  const brit = (id: string, at: string, strength = 3): Unit => ({ ...counter(id, "britain", "infantry", strength, at, 3) });
  const ok = (r: ReturnType<typeof applyAction>) => {
    if (!r.ok) throw new Error(r.error);
    return r;
  };
  const attack = (s: GameState, units: string[], target: string): Action => ({ type: "ATTACK", side: s.activeSide, units, target });

  it("an attack on a port holding only a fleet moves the fleet to the nearest friendly port with no roll, and the attackers may advance", () => {
    const s = at7h([brit("b1", "K27"), fleet("f1", "germany", "K28")], {});
    const r = ok(applyAction(CTX, s, attack(s, ["b1"], "K28")));
    expect(r.state.rngState).toBe(s.rngState);
    expect(r.events.filter((e) => e.type === "UNIT_ELIMINATED")).toHaveLength(0);
    expect(r.events.filter((e) => e.type === "UNITS_SWEPT")).toHaveLength(0);
    expect(r.events.find((e) => e.type === "FLEET_DISPLACED")).toEqual({ type: "FLEET_DISPLACED", unitId: "f1", owner: "germany", from: "K28", to: "J30" });
    expect(r.state.units.f1!.at).toBe("J30");
    expect(combatOf(r.state).advances).toEqual([{ to: "K28", units: ["b1"] }]);
  });

  it("the fleet leaves with the planes destroyed: air alone goes as before, the fleet is displaced", () => {
    const s = at7h([brit("b1", "K27"), fleet("f1", "germany", "K28"), counter("a1", "germany", "air", 3, "K28", 4)]);
    const r = ok(applyAction(CTX, s, attack(s, ["b1"], "K28")));
    expect(r.events.filter((e) => e.type === "UNIT_ELIMINATED").map((e) => (e as { unitId: string }).unitId)).toEqual(["a1"]);
    expect(r.state.units.f1!.at).toBe("J30");
  });

  it("when a battle removes the last ground defender the fleet is displaced too", () => {
    const base = [brit("b1", "K27", 9), brit("b2", "L27", 9), counter("g1", "germany", "infantry", 1, "K28", 3), fleet("f1", "germany", "K28")];
    let moved = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const s = at7h(base, { rngState: seed });
      const r = applyAction(CTX, s, attack(s, ["b1", "b2"], "K28"));
      if (!r.ok) throw new Error(r.error);
      const out = r.events.find((e) => e.type === "COMBAT_RESOLVED");
      if (out?.type === "COMBAT_RESOLVED" && out.outcome === "defender-eliminated") {
        moved++;
        expect(r.state.units.g1).toBeUndefined();
        expect(r.state.units.f1!.at).toBe("J30");
        expect(r.events.some((e) => e.type === "FLEET_DISPLACED")).toBe(true);
      }
    }
    expect(moved).toBeGreaterThan(0);
  });

  it("a fleet with ground defenders is not displaced while they stand", () => {
    const base = [brit("b1", "K27", 1), counter("g1", "germany", "armor", 9, "K28", 5), fleet("f1", "germany", "K28")];
    for (let seed = 1; seed <= 20; seed++) {
      const s = at7h(base, { rngState: seed });
      const r = ok(applyAction(CTX, s, attack(s, ["b1"], "K28")));
      if (r.state.units.g1) expect(r.state.units.f1!.at).toBe("K28");
    }
  });

  it("with no friendly port to go to the fleet is eliminated and the event says so", () => {
    const s = at7h([brit("b1", "K27"), fleet("f1", "germany", "K28")], { control: Object.fromEntries(["J30", "K29", "J32", "K32", "J35", "J36", "E38", "D44", "F40", "L25"].map((h) => [h, "britain" as const])) });
    const r = ok(applyAction(CTX, s, attack(s, ["b1"], "K28")));
    expect(r.events.find((e) => e.type === "FLEET_DISPLACED")).toMatchObject({ unitId: "f1", from: "K28", to: null });
    expect(r.state.units.f1).toBeUndefined();
  });

  it("FLEETS_DISPLACED_ON_CAPTURE false brings back the old sweep: the fleet is destroyed with no roll", async () => {
    vi.resetModules();
    vi.doMock("../src/engine/naval-rules", async (original) => ({ ...(await original<typeof Rules>()), FLEETS_DISPLACED_ON_CAPTURE: false }));
    try {
      const actions = await import("../src/engine/actions");
      const s = at7h([brit("b1", "K27"), fleet("f1", "germany", "K28")]);
      const r = actions.applyAction(CTX, s, attack(s, ["b1"], "K28"));
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.state.units.f1).toBeUndefined();
      expect(r.events.filter((e) => e.type === "UNIT_ELIMINATED")).toHaveLength(1);
      expect(r.events.some((e) => e.type === "FLEET_DISPLACED")).toBe(false);
    } finally {
      vi.doUnmock("../src/engine/naval-rules");
      vi.resetModules();
    }
  });
});

describe("port capacity in the stacking check (R2; Ref 21.1, 5.0, 33.0)", () => {
  const spec = (strength: number) => ({ type: "fleet" as const, strength });
  const problem = (s: GameState, hex: string, strength: number) => stackingProblem(CTX, s, "britain", spec(strength), hex);

  it("Malta, Suda Bay and Famagusta hold 9; the first 9-factor fleet fits, the next does not, and a small one fits beside a small one", () => {
    for (const hex of ["GG19", "GG26", "GG34"]) {
      expect(problem(board([]), hex, 9), hex).toBeNull();
      expect(problem(board([fleet("a", "britain", hex, 9)]), hex, 1), hex).toMatch(/would hold 10 naval factors \(limit 9\)/);
      expect(problem(board([fleet("a", "britain", hex, 6)]), hex, 3), hex).toBeNull();
      expect(problem(board([fleet("a", "britain", hex, 6)]), hex, 4), hex).toMatch(/limit 9/);
    }
  });

  it("a hex that is no port keeps the old flat 36 (whether a fleet may be there at all is suitsBase's question)", () => {
    expect(problem(board([]), "M35", 36)).toBeNull();
    expect(problem(board([fleet("a", "britain", "M35", 28)]), "M35", 9)).toBe("M35 would hold 37 naval factors (limit 36).");
  });

  it("every other port holds 36, with the same message as before", () => {
    expect(problem(board([fleet("a", "britain", "K21", 27)]), "K21", 9)).toBeNull();
    expect(problem(board([fleet("a", "britain", "K21", 28)]), "K21", 9)).toBe("K21 would hold 37 naval factors (limit 36).");
    expect(problem(board([fleet("a", "britain", "AA7", 27)]), "AA7", 9)).toBeNull(); // Gibraltar
  });
});

describe("the automatic setups respect port capacity (the Malta cap, owner decision of 2026-10-17)", () => {
  const setUp = (scenario: Scenario): { ctx: ReturnType<typeof ctxFor>; state: GameState } => {
    const ctx = ctxFor(scenario);
    const g = newGame(scenario, 1);
    return { ctx, state: replay(ctx, g, autoSetup(ctx, g)).state };
  };
  const naval = (s: GameState, hex: string): number => Object.values(s.units).filter((u) => u.type === "fleet" && u.at === hex).reduce((n, u) => n + u.strength, 0);

  for (const scenario of [SCENARIO_1939, SCENARIO_1942, SCENARIO_1944, SCENARIO_CAMPAIGN]) {
    it(`${scenario.id}: no port holds more than its capacity, and Malta no more than 9`, () => {
      const { ctx, state } = setUp(scenario);
      for (const port of portsOf(ctx)) expect(naval(state, port), `${port} in ${scenario.id}`).toBeLessThanOrEqual(portCapacity(ctx, port));
      expect(naval(state, "GG19")).toBeLessThanOrEqual(9);
    });
  }

  it("1942 and 1944 gave Malta 18 and 36 factors before; now 9 each, the rest of the fleets standing in other friendly ports", () => {
    expect(naval(setUp(SCENARIO_1942).state, "GG19")).toBe(9);
    expect(naval(setUp(SCENARIO_1944).state, "GG19")).toBe(9);
    // No fleet is lost by moving: the same 26 and 22 counters as before the cap.
    expect(Object.values(setUp(SCENARIO_1942).state.units).filter((u) => u.type === "fleet").length).toBe(26);
    expect(Object.values(setUp(SCENARIO_1944).state.units).filter((u) => u.type === "fleet").length).toBe(22);
  });
});
