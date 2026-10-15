import { chooseAction } from "../../src/ai";
import { turnIndex } from "../../src/engine/game";
import { runGame } from "./runner";
import type { ScenarioKey } from "./scenarios";

const scs = (process.argv[2] ?? "1939").split(",") as ScenarioKey[];
const [s0, s1] = (process.argv[3] ?? "1-10").split("-").map(Number) as [number, number];
const rows: string[] = [];
for (const sc of scs) {
  const T = { objAx: 0, objAl: 0, lostAx: 0, lostAl: 0, ex: 0, combats: 0, moved: 0, idleGT: 0, idleAx: 0,  churn: 0, anom: 0, ms: 0, hexAx: 0, over: 0 };
  for (let seed = s0; seed <= s1; seed++) {
    const per = new Map<number, { ax: number; al: number; att: number; attAx: number }>();
    const choose: typeof chooseAction = (ctx, state, cfg) => {
      const d = chooseAction(ctx, state, cfg);
      if (d && state.phase === "player-turn") {
        const k = turnIndex(state);
        const e = per.get(k) ?? { ax: 0, al: 0, att: 0, attAx: 0 }; per.set(k, e);
        if (d.action.type === "MOVE") e[state.activeSide === "axis" ? "ax" : "al"] += d.action.units.length;
        if (d.action.type === "ATTACK") { e.att++; if (state.activeSide === "axis") e.attAx++; }
      }
      return d;
    };
    const r = runGame({ scenario: sc, seed, turns: "end", verify: false }, { choose });
    const ks = [...per.keys()].sort((a, b) => a - b);
    let runAx = 0, runAl = 0;
    for (const k of ks) {
      const e = per.get(k)!;
      if (e.ax + e.al < 3 && e.att === 0) { T.idleGT++; if (process.env.IDLE) console.log(`  idle ${sc} s${seed} GT#${ks.indexOf(k)} ax=${e.ax} al=${e.al}`); }
      // churn: a side moving >=5 units with no attack by anyone, 3 Game Turns in a row
      runAx = e.ax >= 5 && e.att === 0 ? runAx + 1 : 0; runAl = e.al >= 5 && e.att === 0 ? runAl + 1 : 0;
      if (runAx === 3) T.churn++; if (runAl === 3) T.churn++;
    }
    ks.forEach((k, i) => { const e = per.get(k)!; if (i >= 4 && i <= 7 && e.ax === 0 && e.attAx === 0) T.idleAx++; });
    const last = r.turns.at(-1)!;
    T.objAx += last.objectives.axis; T.objAl += last.objectives.allies; T.hexAx += last.hexes.axis;
    for (const t of r.turns) { T.lostAx += t.lost.axis; T.lostAl += t.lost.allies; T.ex += t.combats.exchange; T.combats += t.combats.total; T.moved += t.unitsMoved; }
    T.anom += r.anomalies.length; T.ms += r.runtimeMs; if (r.ended !== "game-over") T.over++;
    if (process.env.V) console.log(`${sc} s${seed} obj ${last.objectives.axis}/${last.objectives.allies} lost ${r.turns.reduce((n, t) => n + t.lost.axis, 0)}/${r.turns.reduce((n, t) => n + t.lost.allies, 0)} combats ${r.turns.reduce((n, t) => n + t.combats.total, 0)}`);
  }
  console.log(`${sc} s${s0}-${s1}: objAx=${T.objAx} objAl=${T.objAl} lostAx=${T.lostAx} lostAl=${T.lostAl} exch=${T.ex} combats=${T.combats} moved=${T.moved} idleGT=${T.idleGT} axisIdle4to7=${T.idleAx} churn=${T.churn} anomalies=${T.anom} notOver=${T.over} time=${(T.ms / 1000).toFixed(0)}s`);
}
