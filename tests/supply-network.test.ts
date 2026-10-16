import { describe, expect, it } from "vitest";
import { applyAction } from "../src/engine/actions";
import { autoSetup } from "../src/engine/autosetup";
import { newGame } from "../src/engine/game";
import { supplyNetwork, supplyStatus } from "../src/engine/supply";
import { fortressSupplies } from "../src/engine/supply-sources";
import type { GameState, Side } from "../src/engine/types";
import { ctxFor } from "./helpers";
import { SCENARIOS, SCENARIO_KEYS } from "../scripts/selfplay/scenarios";

// supplyNetwork is what supplyStatus reads (spec 03, supply tracing): the reach of each source set before any unit is looked at, for callers
// that ask about many hexes (the computer's mover, src/ai/lines.ts). Read against supplyStatus on every scenario's opening position.
describe("supplyNetwork and supplyStatus give the same answer", () => {
  for (const key of SCENARIO_KEYS) {
    it(`${key}: a unit is supplied exactly when its main set reaches its hex, a Fortress holds it, or a special net that serves it reaches it`, () => {
      const ctx = ctxFor(SCENARIOS[key]);
      let s: GameState = newGame(ctx.scenario, 1);
      for (const a of autoSetup(ctx, s)) {
        const r = applyAction(ctx, s, a);
        if (r.ok) s = r.state;
      }
      for (const side of ["axis", "allies"] as Side[]) {
        const net = supplyNetwork(ctx, s, side);
        const status = supplyStatus(ctx, s, side);
        expect(net.sources).toEqual(status.sources);
        expect(net.reaches.filter((r) => r.kind === "main").length).toBeGreaterThan(0);
        for (const id of [...status.supplied.map((l) => l.unitId), ...status.unsupplied]) {
          const u = s.units[id]!;
          const main = net.reaches.find((r) => r.kind === "main" && r.serves(u.owner));
          const viaNet = net.reaches.some((r) => r.kind === "net" && r.serves(u.owner) && r.next.has(u.at));
          const supplied = !!main?.next.has(u.at) || fortressSupplies(ctx, s, side, u) || viaNet;
          expect(supplied, `${key} ${side} ${id} at ${u.at}`).toBe(!status.unsupplied.includes(id));
        }
      }
    }, 60_000);
  }
});
