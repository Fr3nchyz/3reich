import { describe, expect, it } from "vitest";
import { applyAction, legalActions, type Action } from "../src/engine/actions";
import { airbasePlacements } from "../src/engine/air-actions";
import { airOf, airbasesInReserve } from "../src/engine/air-record";
import { AIRBASES_PER_MAJOR_POWER } from "../src/engine/air-rules";
import { airCapacity } from "../src/engine/air-bases";
import { controlMap } from "../src/engine/control";
import { newGame } from "../src/engine/game";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import type { GameState, PowerId } from "../src/engine/types";
import { CTX } from "./helpers";
import { at6f, errorOf, inf, okOf } from "./helpers-move";

// Spec 09, ticket 09-2: placing the three movable airbases (Ref 20.1, 11.3, 11.72). Positions are the real 1939 map: Germany holds 64 hexes at the
// start, every one supplied from Berlin; Poland holds the east.

const place = (owner: PowerId, at: string): Action => ({ type: "PLACE_AIRBASE", owner, at });
const germanHexes = (s: GameState) => [...controlMap(CTX, s)].filter(([, o]) => o === "germany").map(([h]) => h).sort();
// The counters of a hand-built board take ids from u1, so new counters start at u100 as they would after a real game's setup.
const board6f = (units: Parameters<typeof at6f>[0], side: "axis" | "allies" = "axis") => at6f(units, side, SCENARIO_1939, { nextUnitId: 100 });
const base = () => board6f([inf("u1", "germany", "L32", 3, 3)]);

describe("PLACE_AIRBASE at step 6f", () => {
  it("sets a counter down, records it for this Player Turn and says so", () => {
    const s = base();
    const at = "L32";
    const r = okOf(applyAction(CTX, s, place("germany", at)));
    const u = Object.values(r.state.units).find((x) => x.type === "airbase")!;
    expect(u).toMatchObject({ owner: "germany", type: "airbase", at });
    expect(r.state.nextUnitId).toBe(s.nextUnitId + 1);
    expect(airOf(r.state).placed).toEqual([u.id]);
    expect(r.events).toEqual([{ type: "AIRBASE_PLACED", unitId: u.id, owner: "germany", at }]);
    expect(u.id).toBe("u100");
    expect(Object.keys(r.state.units).sort()).toEqual(["u1", "u100"]); // the infantry is still there
    expect(Object.keys(s.units)).toEqual(["u1"]); // the input state is untouched
  });

  it("makes the hex a base: a plain hex with an airbase holds 5 air factors (Ref 20.1)", () => {
    const s = base();
    const plain = germanHexes(s).find((h) => CTX.map.hexes[h]!.features.length === 0 && CTX.map.hexes[h]!.land)!;
    expect(airCapacity(CTX, s, plain)).toBe(0);
    expect(airCapacity(CTX, okOf(applyAction(CTX, s, place("germany", plain))).state, plain)).toBe(5);
  });

  it("three per Major Power, then none left; each Power counts its own", () => {
    let s = base();
    const hexes = germanHexes(s).slice(0, 4);
    expect(airbasesInReserve(s, "germany")).toBe(AIRBASES_PER_MAJOR_POWER);
    for (const [i, h] of hexes.slice(0, 3).entries()) {
      s = okOf(applyAction(CTX, s, place("germany", h))).state;
      expect(airbasesInReserve(s, "germany")).toBe(2 - i);
    }
    expect(errorOf(applyAction(CTX, s, place("germany", hexes[3]!)))).toMatch(/already placed all three/);
    expect(airbasePlacements(CTX, s, "germany")).toEqual([]);
    expect(airbasesInReserve(s, "italy")).toBe(3);
  });

  it("refuses water, a hex the other side holds, an unknown hex, a second airbase in a hex and a hex with enemy units", () => {
    const s = base();
    const sea = Object.values(CTX.map.hexes).find((h) => !h.land)!.id;
    expect(errorOf(applyAction(CTX, s, place("germany", sea)))).toMatch(/open water/);
    expect(errorOf(applyAction(CTX, s, place("germany", "M33")))).toMatch(/not held by the axis side/); // Poznan, Polish
    expect(errorOf(applyAction(CTX, s, place("germany", "ZZ99")))).toMatch(/not on the map/);
    const one = okOf(applyAction(CTX, s, place("germany", "L32"))).state;
    expect(errorOf(applyAction(CTX, one, place("germany", "L32")))).toMatch(/one to a hex/);
    const crowded = board6f([inf("u1", "germany", "L32", 3, 3), inf("p1", "poland", "L33", 2, 3)]);
    const held = { ...crowded, control: { ...crowded.control, L33: "germany" as const } };
    expect(errorOf(applyAction(CTX, held, place("germany", "L33")))).toMatch(/holds enemy units/);
  });

  it("refuses at another step, in the other side's turn, for a nation that is not a Major Power, and malformed input", () => {
    const s = base();
    expect(errorOf(applyAction(CTX, { ...s, position: { part: "player-turn", turn: 1, step: "7h" } }, place("germany", "L32")))).toMatch(/setup or at step 6f/);
    expect(errorOf(applyAction(CTX, s, place("britain", "K24")))).toMatch(/player turn/);
    expect(errorOf(applyAction(CTX, s, { type: "PLACE_AIRBASE", owner: "poland" as PowerId, at: "M34" }))).toMatch(/Major Power/);
    expect(errorOf(applyAction(CTX, s, { type: "PLACE_AIRBASE", owner: 5 as unknown as PowerId, at: "L32" }))).toMatch(/names an owner and a hex/);
    expect(errorOf(applyAction(CTX, s, { type: "PLACE_AIRBASE", owner: "germany", at: undefined as unknown as string }))).toMatch(/names an owner and a hex/);
  });

  it("allows a hex inside an enemy armor zone of control (Ref 11.72)", () => {
    const s = board6f([inf("u1", "germany", "L32", 3, 3), inf("p1", "poland", "M33", 4, 6, "armor")]);
    const inZoc = germanHexes(s).find((h) => CTX.map.hexes[h]!.land && (h === "L33" || h === "L32" || h === "M32"))!;
    expect(inZoc).toBeDefined();
    expect(applyAction(CTX, s, place("germany", inZoc)).ok).toBe(true);
  });

  it("refuses a hex that is out of supply, and the list leaves it out", () => {
    // Germany is given a single far Soviet hex with nothing connecting it to a source.
    const s0 = base();
    const far = Object.values(CTX.map.hexes).filter((h) => h.land && h.country === "ussr").map((h) => h.id).sort();
    const cut = far.find((h) => !airbasePlacements(CTX, { ...s0, control: { ...s0.control, [h]: "germany" as const } }, "germany").includes(h));
    expect(cut, "some far hex is out of supply").toBeDefined();
    const s = { ...s0, control: { ...s0.control, [cut!]: "germany" as const } };
    expect(errorOf(applyAction(CTX, s, place("germany", cut!)))).toMatch(/out of supply/);
  });

  it("the list and the engine agree on every hex of the map", () => {
    const s = board6f([inf("u1", "germany", "L32", 3, 3), inf("p1", "poland", "M33", 4, 6, "armor")]);
    const listed = new Set(airbasePlacements(CTX, s, "germany"));
    expect(listed.size).toBeGreaterThan(30);
    for (const h of Object.keys(CTX.map.hexes)) {
      expect(applyAction(CTX, s, place("germany", h)).ok, h).toBe(listed.has(h));
    }
  });

  it("is not in legalActions (the computer does not place airbases yet) and changes no other list", () => {
    const s = base();
    expect(legalActions(CTX, s).some((a) => a.type === "PLACE_AIRBASE")).toBe(false);
    const after = okOf(applyAction(CTX, s, place("germany", "L32"))).state;
    expect(legalActions(CTX, after).filter((a) => a.type === "MOVE").length).toBe(legalActions(CTX, s).filter((a) => a.type === "MOVE").length);
  });

  it("the record belongs to one Player Turn: another turn starts empty", () => {
    const r = okOf(applyAction(CTX, base(), place("germany", "L32")));
    expect(airOf({ ...r.state, activeSide: "allies" }).placed).toEqual([]);
    expect(airOf({ ...r.state, year: r.state.year + 1 }).placed).toEqual([]);
    expect(airOf(r.state).placed).toHaveLength(1);
  });
});

describe("PLACE_AIRBASE in the opening setup", () => {
  const setup = () => newGame(SCENARIO_1939, 1); // Poland deploys first
  it("only the owner now setting up may place", () => {
    const s = setup();
    expect(s.phase).toBe("setup");
    expect(errorOf(applyAction(CTX, s, place("germany", "L32")))).toMatch(/setting up now/);
    expect(errorOf(applyAction(CTX, s, place("britain", "K24")))).toMatch(/setting up now/);
  });
  it("a Minor-Ally that is not a Major Power may not, even when its turn comes", () => {
    expect(errorOf(applyAction(CTX, setup(), { type: "PLACE_AIRBASE", owner: "poland" as PowerId, at: "M34" }))).toMatch(/Major Power/);
  });
  it("the owner setting up places in a hex of its side, with no supply test", () => {
    let s = setup();
    // Move the deployment on to Germany: every earlier owner is done (empty pools are refused by SETUP_DONE, so jump the cursor).
    const index = s.setup!.order.indexOf("germany");
    expect(index).toBeGreaterThanOrEqual(0);
    s = { ...s, setup: { ...s.setup!, index } };
    const r = okOf(applyAction(CTX, s, place("germany", "L32")));
    expect(Object.values(r.state.units).filter((u) => u.type === "airbase")).toHaveLength(1);
    expect(airbasePlacements(CTX, s, "germany")).toContain("L32");
    expect(errorOf(applyAction(CTX, s, place("germany", "M33")))).toMatch(/not held by the axis side/);
  });
});
