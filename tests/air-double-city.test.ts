import { describe, expect, it, vi } from "vitest";

// The map marks no double city, so DOUBLE_CITY_HEXES is empty (TODO(verify), spec 09 R1). The branch is checked here with a list.
vi.mock("../src/engine/air-rules", async (original) => ({ ...(await original<typeof import("../src/engine/air-rules")>()), DOUBLE_CITY_HEXES: ["N33"] }));

const { airCapacity, citiesAt } = await import("../src/engine/air-bases");
const { board, counter } = await import("./board");
const { CTX } = await import("./helpers");

describe("a two-city hex (Ref 20.1)", () => {
  it("bases 10 air factors, 15 with an airbase counter", () => {
    expect(citiesAt(CTX, "N33")).toBe(2);
    expect(airCapacity(CTX, board([]), "N33")).toBe(10);
    expect(airCapacity(CTX, board([counter("u1", "germany", "airbase", 1, "N33")]), "N33")).toBe(15);
    expect(airCapacity(CTX, board([]), "M35")).toBe(5); // other cities stay at one
  });
});
