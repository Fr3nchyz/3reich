import { describe, expect, it } from "vitest";
import { airRedeployProblem, airRedeployReach } from "../src/engine/sr-air";
import type { GameContext } from "../src/engine/context";
import type { MapHex } from "../src/engine/map";
import { hexsideId, parseHexId } from "../src/engine/hex";
import { board, counter } from "./board";
import { CTX } from "./helpers";

// Spec 16 R23 / AER32: a narrow sea corridor with bases eight steps apart.
function fixture(last = 17, bases = [1, 9, 17]) {
  const hexes: Record<string, MapHex> = {};
  for (let i = 1; i <= last; i++) hexes[`A${i}`] = {
    id: `A${i}`, land: bases.includes(i) ? "plain" : null, sea: true,
    features: bases.includes(i) ? ["city"] : [], front: "western",
    ...(bases.includes(i) ? { country: "germany" } : {}),
  };
  const ctx: GameContext = { ...CTX, map: { hexes, hexsides: {} } };
  const unit = counter("a", "germany", "air", 5, "A1");
  const state = board([unit], undefined, { activeSide: "axis" });
  return { ctx, state, unit };
}
const problem = (f: ReturnType<typeof fixture>, to = "A17") => airRedeployProblem(f.ctx, f.state, "axis", f.unit, to);

describe("air redeployment (spec 16 R23)", () => {
  it("R23: chains multiple eight-hex legs and returns sorted destinations without mutation", () => {
    const f = fixture();
    const before = JSON.stringify(f);
    expect(problem(f)).toBeNull();
    expect(airRedeployReach(f.ctx, f.state, "axis", f.unit)).toEqual(["A17", "A9"]);
    expect(JSON.stringify(f)).toBe(before);
  });
  it("R23: nine hexes without an intermediate base is too far", () => {
    expect(problem(fixture(10, [1, 10]), "A10")).toMatch(/No land route/);
  });
  it("R23 / AER32: full transit bases cannot relay this counter", () => {
    const f = fixture();
    f.state.units.other = counter("other", "germany", "air", 1, "A9");
    expect(problem(f)).toMatch(/No land route/);
  });
  it("R23: destination capacity includes existing factors", () => {
    const f = fixture();
    f.state.units.other = counter("other", "germany", "air", 1, "A17");
    expect(problem(f)).toMatch(/insufficient air capacity/);
  });
  it("R23: an air unit must end at a base", () => {
    const f = fixture();
    f.ctx.map = { ...f.ctx.map, hexes: { ...f.ctx.map.hexes, A17: { ...f.ctx.map.hexes.A17!, features: [] } } };
    expect(problem(f)).toMatch(/not an air base/);
  });
  it("R23 / AER32: mixed neutral coast is passable; neutral inland blocks the leg", () => {
    const f = fixture(9, [1, 9]);
    const coastal: MapHex = { ...f.ctx.map.hexes.A5!, land: "plain", country: "spain" };
    f.ctx.map = { ...f.ctx.map, hexes: { ...f.ctx.map.hexes, A5: coastal } };
    expect(problem(f, "A9")).toBeNull();
    f.ctx.map = { ...f.ctx.map, hexes: { ...f.ctx.map.hexes, A5: { ...coastal, sea: false } } };
    expect(problem(f, "A9")).toMatch(/No land route/);
  });
  it("R23: airbases cannot fly along the base chain", () => {
    const f = fixture();
    f.unit.type = "airbase";
    f.unit.strength = 0;
    expect(problem(f)).toMatch(/escort over water/);
  });
  it("R20, R23: airbases and air units can travel unlimited connected land", () => {
    const f = fixture(18, Array.from({ length: 18 }, (_, i) => i + 1));
    const sides = Object.fromEntries(Array.from({ length: 17 }, (_, i) => {
      const id = hexsideId(parseHexId(`A${i + 1}`)!, parseHexId(`A${i + 2}`)!);
      return [id, { id, land: true, sea: false }];
    }));
    f.ctx.map = { ...f.ctx.map, hexsides: sides };
    expect(problem(f, "A18")).toBeNull();
    f.unit.type = "airbase"; f.unit.strength = 0;
    expect(problem(f, "A18")).toBeNull();
  });
  it("R23 / AER32: moving an airbase requires clearing excess factors first", () => {
    const f = fixture();
    f.unit.type = "airbase"; f.unit.strength = 0;
    f.state.units.planes = counter("planes", "germany", "air", 6, "A1");
    expect(problem(f)).toMatch(/Redeploy excess/);
  });
  it("R18, R20: shared allowance and current-turn redeployment records apply", () => {
    const f = fixture();
    f.state.sr = { turn: `${f.state.year}-${f.state.season}-axis`, used: { germany: 9 }, moved: [], escorted: {} };
    expect(problem(f)).toMatch(/germany has 0/);
    f.state.sr.used = {}; f.state.sr.moved = ["a"];
    expect(problem(f)).toMatch(/already redeployed/);
    f.state.sr.turn = "old";
    expect(problem(f)).toBeNull();
  });
  it("R19, R20, R23: rejects wrong types, sides, off-map origins and unchanged destinations", () => {
    const f = fixture();
    expect(problem(f, "A1")).toMatch(/already in/);
    expect(airRedeployProblem(f.ctx, f.state, "allies", f.unit, "A17")).toMatch(/side/);
    f.unit.at = "us-box";
    expect(problem(f)).toMatch(/not a land hex/);
    f.unit.type = "infantry";
    expect(problem(f)).toMatch(/Choose an air/);
  });
  it("R20, R23: hostile land blocks flight legs and supply still applies", () => {
    const f = fixture(9, [1, 9]);
    f.ctx.map = { ...f.ctx.map, hexes: { ...f.ctx.map.hexes,
      A5: { ...f.ctx.map.hexes.A5!, land: "plain", country: "poland" },
    } };
    expect(problem(f, "A9")).toMatch(/No land route/);
    const isolated = fixture();
    isolated.ctx.supplyEffects = true;
    expect(problem(isolated)).toMatch(/cut off/);
  });

});
