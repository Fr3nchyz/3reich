import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import type { Action } from "../src/engine/actions";
import { sessionFromRecord } from "../src/ui/e2eLoad";
import { movableStacks, movesNow } from "../src/ui/moveTap";
import type { Session } from "../src/ui/session";

const fixture = JSON.parse(readFileSync("tests/e2e/fixtures/axis-at-7h.json", "utf8")) as { seed: number; actions: Action[] };
const hexes = (s: Session) => movableStacks(s).map((k) => k.hex);
const initial = ["D41", "J36", "K33", "L31", "M27", "N26", "O32"];
function load(): Session {
  return sessionFromRecord(SCENARIO_1939, "axis", fixture.seed, fixture.actions.slice(0, fixture.actions.findIndex((a) => a.type === "MOVE")));
}
describe("the unchanged browser movement recording at step 6f", () => {
  it("includes Helsinki's German armor moving within sleeping Finland (15-7, #235; spec 15 R10)", () => {
    const s = load();
    expect(hexes(s)).toEqual(initial);
    const armor = Object.values(s.state.units).find((u) => u.at === "D41")!;
    expect(armor).toMatchObject({ owner: "germany", type: "armor", strength: 4, movement: 6 });
    const moves = movesNow(s).filter((m) => m.units.includes(armor.id));
    expect(moves.length).toBeGreaterThan(0);
    for (const m of moves) for (const h of m.path) expect(s.ctx.map.hexes[h]?.country).toBe("finland");
  });
});
