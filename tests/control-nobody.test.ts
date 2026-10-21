import { describe, expect, it } from "vitest";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { controlMap, controllerOf, controllingSide, isNobodys } from "../src/engine/control";
import { entryProblem } from "../src/engine/movement";
import { objectiveStandings } from "../src/engine/objectives";
import { board, counter } from "./board";
import { CTX } from "./helpers";

// Spec 14 C1, R4 (TODO(verify) V11, V34): `GameState.control[hex] = null` means nobody controls the hex, which is not the same as having no entry.

describe("a hex nobody controls", () => {
  const plain = board([]);
  const nobody = board([], SCENARIO_1939, { control: { J29: null, C35: null, M35: null } });

  it("is nobody's, and does not fall back to its start owner (J29 is German land)", () => {
    expect(controllerOf(CTX, plain, "J29")).toBe("germany");
    expect(controllerOf(CTX, nobody, "J29")).toBeNull();
    expect(isNobodys(nobody, "J29")).toBe(true);
    expect(isNobodys(plain, "J29")).toBe(false);
    expect(controllingSide(CTX, nobody, "J29")).toBeNull();
  });
  it("is left out of the map of controlled hexes", () => {
    expect(controlMap(CTX, plain).get("J29")).toBe("germany");
    expect(controlMap(CTX, nobody).has("J29")).toBe(false);
    expect(controlMap(CTX, nobody).size).toBe(controlMap(CTX, plain).size - 2); // J29 (Germany) and M35 (Poland) had owners at the start; C35 (Norway) had none
  });
  it("counts for neither side in the Objective standings (Warsaw)", () => {
    expect(objectiveStandings(CTX, plain).axis).not.toContain("M35");
    expect(objectiveStandings(CTX, nobody).nobody).toContain("M35");
  });
  it("is open to every ground unit even inside a minor country (Oslo is closed neutral land otherwise): a French unit may enter it", () => {
    const french = counter("f1", "france", "infantry", 3, "C34", 3);
    expect(entryProblem(CTX, board([french]), ["france"], "C35")).toMatch(/neutral land/);
    expect(entryProblem(CTX, board([french], SCENARIO_1939, { control: { C35: null } }), ["france"], "C35")).toBeNull();
  });
});
