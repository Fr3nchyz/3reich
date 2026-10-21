import { describe, expect, it } from "vitest";
import { MAP } from "../src/data/map";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { SCENARIO_1942 } from "../src/data/scenario-1942";
import { SCENARIO_1944 } from "../src/data/scenario-1944";
import { SCENARIO_CAMPAIGN } from "../src/data/scenario-campaign";
import { controllerOf } from "../src/engine/control";
import { newGame } from "../src/engine/game";
import { objectiveHexes, objectiveSide, objectiveStandings } from "../src/engine/objectives";
import type { ForceOwner, GameState, NationStatus, PowerId } from "../src/engine/types";
import { ctxFor } from "./helpers";

// Spec 14 R1 (ticket 14-1): who holds the 42 Objectives. Ref 2.0 (neutral Italy and U.S.S.R., minors never at war), 35.0 (Vichy), 6.0 (control).

const named = (name: string) => Object.values(MAP.hexes).find((h) => h.name === name)!.id;
const counts = (ctx = ctxFor(), state = newGame(ctx.scenario, 1)) => {
  const s = objectiveStandings(ctx, state);
  return [s.axis.length, s.allies.length, s.nobody.length];
};
const withStatus = (state: GameState, id: PowerId, status: NationStatus): GameState => ({ ...state, nations: { ...state.nations, [id]: { ...state.nations[id], status } } });
const withControl = (state: GameState, hex: string, owner: ForceOwner): GameState => ({ ...state, control: { ...state.control, [hex]: owner } });

describe("the Objectives on the map (Ref 2.0)", () => {
  it("are 42, 14 on each Front, and only the red-printed ones: capitals that are not red are left out", () => {
    const ids = objectiveHexes(ctxFor());
    expect(ids).toHaveLength(42);
    for (const front of ["western", "eastern", "mediterranean"] as const) expect(ids.filter((h) => MAP.hexes[h]!.front === front)).toHaveLength(14);
    for (const capital of ["Brussels", "Copenhagen", "Helsinki"]) {
      const hex = MAP.hexes[named(capital)]!;
      expect(hex.features.some((f) => f === "capital" || f === "capital-port"), capital).toBe(true);
      expect(ids, `${capital} is a capital and not an Objective`).not.toContain(hex.id);
    }
  });
});

describe("the standings at the start of each scenario (counted from the scenario data, spec 14 'What exists today')", () => {
  it("1939 and the Campaign: Axis 9, Allies 23, nobody 10", () => {
    expect(counts(ctxFor(SCENARIO_1939))).toEqual([9, 23, 10]);
    expect(counts(ctxFor(SCENARIO_CAMPAIGN))).toEqual([9, 23, 10]);
  });
  it("1942: Axis 25, Allies 14, nobody 3", () => expect(counts(ctxFor(SCENARIO_1942))).toEqual([25, 14, 3]));
  it("1944: Axis 22, Allies 17, nobody 3", () => expect(counts(ctxFor(SCENARIO_1944))).toEqual([22, 17, 3]));

  it("every Objective is in exactly one list", () => {
    for (const sc of [SCENARIO_1939, SCENARIO_1942, SCENARIO_1944]) {
      const ctx = ctxFor(sc);
      const s = objectiveStandings(ctx, newGame(sc, 1));
      expect([...s.axis, ...s.allies, ...s.nobody].sort()).toEqual([...objectiveHexes(ctx)].sort());
    }
  });

  it("1939 names: the neutral cities are nobody's, Rome is Axis, Moscow is Allied (Ref 2.0)", () => {
    const s = objectiveStandings(ctxFor(), newGame(SCENARIO_1939, 1));
    expect(s.nobody.sort()).toEqual(["Oslo", "Stockholm", "Riga", "Antwerp", "Budapest", "Madrid", "Belgrade", "Ploesti", "Istanbul", "Athens"].map(named).sort());
    expect(s.axis).toContain(named("Rome"));
    expect(s.allies).toContain(named("Moscow"));
    expect(s.allies).toContain(named("Warsaw"));
  });
});

describe("whose hex counts for which side (R1)", () => {
  const state = newGame(SCENARIO_1939, 1);
  it("a neutral Italy counts for the Axis and a neutral U.S.S.R. for the Allies (Ref 2.0); Italy at war counts for the Axis", () => {
    expect(state.nations.italy.status).toBe("neutral");
    expect(objectiveSide(state, "italy")).toBe("axis");
    expect(objectiveSide(state, "ussr")).toBe("allies");
    expect(objectiveSide(withStatus(state, "italy", "axis"), "italy")).toBe("axis");
    expect(objectiveSide(withStatus(state, "ussr", "allied"), "ussr")).toBe("allies");
  });
  it("a Major Power out of the scenario, or neutral without a fixed side, counts for nobody", () => {
    expect(objectiveSide(withStatus(state, "italy", "out"), "italy")).toBeNull();
    expect(objectiveSide(withStatus(state, "france", "vichy"), "france")).toBeNull();
    expect(objectiveSide(state, "usa")).toBeNull();
  });
  it("Poland and the Free French count for the Allies; Vichy France for the Axis (Ref 35.0)", () => {
    expect(objectiveSide(state, "poland")).toBe("allies");
    expect(objectiveSide(state, "free-france")).toBe("allies");
    expect(objectiveSide(state, "vichy-france")).toBe("axis");
  });
  it("an inactive Minor-Ally counts for nobody until activated; an active one for the Axis (TODO(verify) V2)", () => {
    const s42 = newGame(SCENARIO_1942, 1);
    expect(objectiveSide(s42, "hungary")).toBe("axis");
    const off = { ...s42, minorAllies: s42.minorAllies.map((m) => (m.owner === "hungary" ? { ...m, active: false } : m)) };
    expect(objectiveSide(off, "hungary")).toBeNull();
    expect(objectiveStandings(ctxFor(SCENARIO_1942), off).nobody).toContain(named("Budapest"));
  });
  it("Marseilles and Lyons, held by Vichy France, count for the Axis: they are the only Objectives of the Vichy zone", () => {
    const ctx = ctxFor(SCENARIO_1942);
    const s = newGame(SCENARIO_1942, 1);
    const vichy = objectiveHexes(ctx).filter((h) => controllerOf(ctx, s, h) === "vichy-france");
    expect(vichy.sort()).toEqual([named("Lyons"), named("Marseilles")].sort());
    expect(objectiveStandings(ctx, s).axis).toEqual(expect.arrayContaining(vichy));
  });
});

describe("control changes the standings (Ref 6.0)", () => {
  it("a hex taken by a German unit moves from the Allies to the Axis; a hex nobody controls stays nobody's until someone takes it", () => {
    const ctx = ctxFor();
    const s = newGame(SCENARIO_1939, 1);
    const paris = named("Paris");
    expect(objectiveStandings(ctx, s).allies).toContain(paris);
    const taken = objectiveStandings(ctx, withControl(s, paris, "germany"));
    expect(taken.axis).toContain(paris);
    expect(taken.allies).not.toContain(paris);
    expect(counts(ctx, withControl(s, paris, "germany"))).toEqual([10, 22, 10]);
    const antwerp = named("Antwerp");
    expect(counts(ctx, withControl(s, antwerp, "germany"))).toEqual([10, 23, 9]);
  });
  it("a Polish Objective taken by Germany counts for the Axis", () => {
    const ctx = ctxFor();
    expect(counts(ctx, withControl(newGame(SCENARIO_1939, 1), named("Warsaw"), "germany"))).toEqual([10, 22, 10]);
  });
});
