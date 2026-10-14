import { describe, expect, it } from "vitest";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { SCENARIO_1944 } from "../src/data/scenario-1944";
import { describeAreas, resolveArea } from "../src/engine/areas";
import { setupOf } from "../src/engine/game";
import type { Area } from "../src/engine/types";
import { CTX, ctxFor } from "./helpers";

/** The tagged Area union: what each kind says in words, what it covers, and two pins on converted scenario data. */

describe("describeAreas", () => {
  const cases: [Area, string][] = [
    [{ kind: "country", id: "egypt" }, "egypt"],
    [{ kind: "hex", id: "L31" }, "L31"],
    [{ kind: "ports", front: "mediterranean" }, "mediterranean ports"],
    [{ kind: "front", front: "eastern" }, "the eastern front"],
    [{ kind: "box", box: "us-box" }, "us-box"],
    [{ kind: "zone", id: "eastern-europe" }, "eastern-europe"],
    [{ kind: "controlled-by", owner: "britain" }, "britain-controlled territory"],
  ];

  it.each(cases)("says %j as %s", (area, text) => {
    expect(describeAreas([area])).toBe(text);
  });

  it("joins several with 'or'", () => {
    expect(describeAreas(cases.slice(0, 2).map(([a]) => a))).toBe("egypt or L31");
  });
});

describe("resolveArea", () => {
  it("a ports area is the ports of that front only, and a front area is all land on it", () => {
    const ports = resolveArea(CTX, { kind: "ports", front: "mediterranean" }).places;
    expect(ports.size).toBeGreaterThan(5);
    for (const p of ports) {
      const h = CTX.map.hexes[p]!;
      expect(h.front).toBe("mediterranean");
      expect(h.features.some((f) => f === "port" || f === "capital-port")).toBe(true);
    }
    const front = resolveArea(CTX, { kind: "front", front: "mediterranean" }).places;
    expect(front.size).toBeGreaterThan(ports.size);
    for (const p of ports) expect(front.has(p)).toBe(true);
  });

  it("a controlled-by area is that owner's territory", () => {
    const britain = resolveArea(ctxFor(SCENARIO_1944), { kind: "controlled-by", owner: "britain" }).places;
    expect(britain.has("K23")).toBe(true); // London
    expect(britain.has("L31")).toBe(false); // Berlin
  });
});

describe("converted scenario data keeps its meaning", () => {
  it("Italy's fleet may start in any Mediterranean port (1939)", () => {
    const rule = setupOf(SCENARIO_1939, "italy").setup.find((r) => r.kind === "all-in" && r.types !== "all" && r.types.includes("fleet"));
    expect(rule).toMatchObject({ in: [{ kind: "ports", front: "mediterranean" }] });
  });

  it("the U.S. sets up in the U.S. Box and anywhere British-controlled (1944)", () => {
    const rule = setupOf(SCENARIO_1944, "usa").setup[0];
    expect(rule).toMatchObject({ kind: "all-in", in: [{ kind: "box", box: "us-box" }, { kind: "controlled-by", owner: "britain" }] });
  });
});
