import { applyAction } from "../../src/engine/actions";
import { chooseAction } from "../../src/ai";
import { createMemory } from "../../src/ai/memory";
import { autoSetup } from "../../src/engine/autosetup";
import { newGame } from "../../src/engine/game";
import { MAP } from "../../src/data/map";
import { SCENARIOS, type ScenarioKey } from "./scenarios";
import { distanceToEnemyObjective, stagingTargets, groundDistances, enemyObjectives } from "../../src/ai/geo";
import { movableUnits, reachableHexes, endProblem } from "../../src/engine/movement";
import { enemyZocFor } from "../../src/engine/zoc";
import { controllerOf } from "../../src/engine/control";
const sc = process.argv[2] as ScenarioKey; const seed = Number(process.argv[3]); const want = process.argv[4]!; // e.g. 1941-spring
const ctx = { map: MAP, scenario: SCENARIOS[sc] };
let state = newGame(ctx.scenario, seed);
for (const a of autoSetup(ctx, state)) { const r = applyAction(ctx, state, a); if (!r.ok) throw new Error(r.error); state = r.state; }
const memory = createMemory();
for (let n = 0; n < 30000 && state.phase === "player-turn"; n++) {
  const d = chooseAction(ctx, state, { seed, memory })!;
  const step = state.position?.part === "player-turn" ? state.position.step : "";
  if (step === "6f" && d.action.type === "END_STEP" && `${state.year}-${state.season}` === want) {
    const side = state.activeSide; const zoc = enemyZocFor(ctx, state, side);
    const st = stagingTargets(ctx, state, side);
    console.log(side, "ussr status", state.nations.ussr.status, "staging sources", st.sources.length, "enemy objs", enemyObjectives(ctx, state, side).join(","));
    const cats: Record<string, string[]> = {};
    for (const u of movableUnits(ctx, state)) {
      const near = distanceToEnemyObjective(ctx, state, u.owner, side).get(u.at);
      const stg = groundDistances(ctx, state, u.owner, st.sources, undefined, st.open).get(u.at);
      const reach = [...reachableHexes(ctx, state, [u], zoc)].filter(([to]) => endProblem(ctx, state, [u], to) === null).length;
      const k = `near=${near === undefined ? "-" : near} stage=${stg === undefined ? "-" : stg} reach=${reach > 0 ? "y" : "n"}`;
      (cats[k] ??= []).push(`${u.id}@${u.at}`);
    }
    for (const [k, v] of Object.entries(cats)) console.log(" ", k, v.length, v.slice(0, 6).join(" "));
  }
  const r = applyAction(ctx, state, d.action); if (!r.ok) throw new Error(r.error); state = r.state;
}
