import { describe, expect, it } from "vitest";
import { MAGINOT_GONE_YEAR, SEVASTOPOL_PORTS, WEST_WALL_YEAR } from "../src/engine/fortress-rules";
import { isPort } from "../src/engine/naval-ports";
import { CTX } from "./helpers";

describe("fortress facts (Ref 4.8, 19.2; spec 16 R26 to R28)", () => {
  it("lists exactly the five other Black Sea ports, excluding Sevastopol (AER37)", () => {
    expect(SEVASTOPOL_PORTS).toEqual(["T37", "W35", "X43", "Z33", "AA33"]);
    expect(SEVASTOPOL_PORTS).not.toContain("V38");
    for (const hex of SEVASTOPOL_PORTS) expect(isPort(CTX, hex), hex).toBe(true);
  });

  it("dates the West Wall to 1944 and the Maginot-free scenarios to 1942", () => {
    expect(WEST_WALL_YEAR).toBe(1944);
    expect(MAGINOT_GONE_YEAR).toBe(1942);
  });
});
