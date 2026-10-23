import { verdictName } from "../../src/engine/victory-record";
import type { PowerId } from "../../src/engine/types";
import { conquestList } from "./audit";
import { holdings, turnLabel } from "./stats";
import type { RebuildStats } from "./rebuild";
import type { GameResult, TurnStats } from "./types";

const POWERS: readonly PowerId[] = ["germany", "italy", "ussr", "britain", "france", "usa"];
const SHORT: Record<PowerId, string> = { germany: "Ger", italy: "Ita", ussr: "USSR", britain: "Bri", france: "Fra", usa: "USA" };

const table = (head: readonly string[], rows: readonly (readonly (string | number)[])[]): string =>
  [`| ${head.join(" | ")} |`, `|${head.map(() => " --- ").join("|")}|`, ...rows.map((r) => `| ${r.join(" | ")} |`)].join("\n");
const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);
const pair = (p: { axis: number; allies: number }): string => `${p.axis} / ${p.allies}`;

/** A side with at least this many ground units that neither moves nor attacks in its Player Turn counts as idle. */
export const IDLE_MIN_GROUND = 10;

/** A side that moves at least CHURN_MIN_MOVED units in each of CHURN_RUN or more Game Turns in a row without one attack is churning: marching without fighting. */
export const CHURN_MIN_MOVED = 5;
export const CHURN_RUN = 3;

/** The runs of Game Turns in which a side moved units but never attacked, as "axis Summer 1940 to Spring 1941 (4 Game Turns, 83 units moved)". */
export function churnRuns(turns: readonly TurnStats[]): string[] {
  const out: string[] = [];
  for (const side of ["axis", "allies"] as const) {
    let run: TurnStats[] = [];
    const close = () => {
      if (run.length >= CHURN_RUN) out.push(`${side} ${run[0]!.label} to ${run[run.length - 1]!.label} (${run.length} Game Turns, ${run.reduce((n, t) => n + t.movedBy[side], 0)} units moved)`);
      run = [];
    };
    for (const t of turns) {
      if (!t.partial && t.movedBy[side] >= CHURN_MIN_MOVED && t.attacks[side] === 0) run.push(t);
      else close();
    }
    close();
  }
  return out;
}

/** The Player Turns in which a side with IDLE_MIN_GROUND or more ground units neither moved a unit nor attacked, as "Spring 1941 axis". */
export function idleTurns(turns: readonly TurnStats[]): string[] {
  return turns.flatMap((t) => (["axis", "allies"] as const).filter((s) => !t.partial && t.ground[s] >= IDLE_MIN_GROUND && t.movedBy[s] === 0 && t.attacks[s] === 0).map((s) => `${t.label} ${s}`));
}

/** Totals over every Game Turn of a game: what the summary and the comparison table show. */
export function totals(r: GameResult) {
  const t = r.turns;
  const last = t[t.length - 1];
  return {
    turnsPlayed: t.filter((x) => !x.partial).length,
    wars: t.flatMap((x) => x.wars.map((w) => `${x.label}: ${w}`)),
    built: sum(t.map((x) => x.built)),
    grants: sum(t.map((x) => x.grants)),
    combats: sum(t.map((x) => x.combats.total)),
    attacksAxis: sum(t.map((x) => x.attacks.axis)),
    attacksAllies: sum(t.map((x) => x.attacks.allies)),
    lostAxis: sum(t.map((x) => x.lost.axis)),
    lostAllies: sum(t.map((x) => x.lost.allies)),
    lostUnsuppliedAxis: sum(t.map((x) => x.lostUnsupplied.axis)),
    lostUnsuppliedAllies: sum(t.map((x) => x.lostUnsupplied.allies)),
    lostFactorsAxis: sum(t.map((x) => x.lostFactors.axis)),
    lostFactorsAllies: sum(t.map((x) => x.lostFactors.allies)),
    hexChanges: sum(t.map((x) => x.hexChanges)),
    unitsMoved: sum(t.map((x) => x.unitsMoved)),
    redeployed: Object.fromEntries(POWERS.map((p) => [p, sum(t.map((x) => x.redeployed[p]))])) as Record<PowerId, number>,
    idle: idleTurns(t),
    churn: churnRuns(t),
    spent: sum(t.map((x) => sum(POWERS.map((p) => x.spent[p])))),
    final: { ...holdings(r.ctx, r.final), brp: last?.brp, units: last?.units, factors: last?.factors },
    start: holdings(r.ctx, r.initial),
  };
}

function turnTables(turns: readonly TurnStats[]): string {
  const label = (t: TurnStats) => (t.partial ? `${t.label} (partial)` : t.label);
  const econ = table(
    ["Game Turn", ...POWERS.map((p) => `BRP ${SHORT[p]}`), "Spent", ...POWERS.map((p) => `sp ${SHORT[p]}`), "war / build / grant / option"],
    turns.map((t) => [label(t), ...POWERS.map((p) => t.brp[p]), sum(POWERS.map((p) => t.spent[p])), ...POWERS.map((p) => t.spent[p]), `${t.spentOn.war} / ${t.spentOn.build} / ${t.spentOn.grant} / ${t.spentOn.option}`]),
  );
  const acts = table(
    ["Game Turn", "Wars declared", "Built", "Grants (BRPs)", "Units moved", "Moved ax / al", "Ground units ax / al", "Combats (A out / D out / Ex)", "Attacks ax / al", "Lost units ax / al", "Unsupplied lost ax / al", "Lost factors ax / al", "Hexes changed", "Front Options", "Actions"],
    turns.map((t) => [label(t), t.wars.join("; ") || "-", t.built, `${t.grants} (${t.grantAmount})`, t.unitsMoved, pair(t.movedBy), pair(t.ground), `${t.combats.total} (${t.combats.attackerEliminated} / ${t.combats.defenderEliminated} / ${t.combats.exchange})`, pair(t.attacks), pair(t.lost), pair(t.lostUnsupplied), pair(t.lostFactors), t.hexChanges, t.frontOptions.join("; ") || "-", t.actions]),
  );
  const map = table(
    ["Game Turn", "Hexes ax / al / neutral", "Objectives ax / al / neutral", "Units ax / al", "Factors ax / al"],
    turns.map((t) => [label(t), `${t.hexes.axis} / ${t.hexes.allies} / ${t.hexes.neutral}`, `${t.objectives.axis} / ${t.objectives.allies} / ${t.objectives.neutral}`, pair(t.units), pair(t.factors)]),
  );
  return `### Economy (BRP totals at the end of each Game Turn, BRPs spent)\n\n${econ}\n\n### Activity\n\n${acts}\n\n### Map and forces (ax = Axis, al = Allies)\n\n${map}`;
}

/** The result of the game in words ("Allied Marginal Victory (Objectives: Axis 24, Allies 15, nobody 3)"), or "none" when it did not reach the end. */
export function resultText(r: GameResult): string {
  const v = r.final.result;
  return v ? `${verdictName(v)} (Objectives: Axis ${v.objectives.axis}, Allies ${v.objectives.allies}, nobody ${v.objectives.nobody}${v.siberian ? ", Free Siberian Transfer tables" : ""})` : "none";
}

/** "Options chosen per Front" (spec 16 Part E): for each Front, how many times each Option was chosen over the game ("western: offensive 3, attrition 9, defensive 20"). */
export function optionsPerFront(turns: readonly { frontOptions: string[] }[]): string {
  const count = new Map<string, number>();
  for (const e of turns.flatMap((t) => t.frontOptions)) {
    const key = e.split(" ").slice(1).join(" "); // drop the side
    count.set(key, (count.get(key) ?? 0) + 1);
  }
  return ["western", "eastern", "mediterranean"].map((f) => `${f}: ${["offensive", "attrition", "defensive"].map((o) => `${o} ${count.get(`${f} ${o}`) ?? 0}`).join(", ")}`).join("; ");
}

/** The lost-units section (spec 17 Part E): per nation, units returned to the pool, rebuilt, lost for good by reason, BRPs paid for rebuilds, Siberian units taken; then the BRPs left unspent at each Year Start. */
export function rebuildReport(s: RebuildStats): string {
  const rows = Object.entries(s.nations).map(([id, n]) => [id, n.returned, n.rebuilt, Object.entries(n.lostForGood).map(([why, c]) => `${why} ${c}`).join(", ") || "-", Object.values(n.lostForGood).reduce((a, b) => a + b, 0), n.brps, n.siberian]);
  const years = s.yearStarts.map((y) => [y.year, ...POWERS.map((p) => y.unspent[p] ?? "-")]);
  return [
    "## Lost units and rebuilds",
    "",
    rows.length ? table(["Nation (pool)", "Returned to the pool", "Rebuilt", "Lost for good, by reason", "Lost for good", "BRPs spent on rebuilds", "Siberian units taken"], rows) : "No unit was lost or taken.",
    "",
    `Russia's offer to surrender was made ${s.surrenderOffers} time(s).`,
    "",
    "BRPs left unspent when each year ended (before the Year Start Sequence):",
    "",
    years.length ? table(["Year started", ...POWERS.map((p) => SHORT[p])], years) : "No Year Start was reached.",
    "",
  ].join("\n");
}

/** The Markdown report of one game. It holds nothing that varies between runs of the same seed (the runtime is left out). */
export function gameReport(r: GameResult): string {
  const o = r.options;
  const t = totals(r);
  const f = t.final;
  const first = r.turns[0]?.label ?? "-";
  const last = r.turns[r.turns.length - 1]?.label ?? "-";
  const lines = [
    `# Self-play: ${r.ctx.scenario.name}, seed ${o.seed}`,
    "",
    `Computer against computer. Command: \`npm run selfplay -- --scenario ${o.scenario} --turns ${o.turns} --seed ${o.seed} --supply-effects ${o.supplyEffects ? "on" : "off"}\`. The scenario runs ${turnLabel(r.ctx.scenario.start)} to ${turnLabel(r.ctx.scenario.end)}.`,
    "",
    "## Summary",
    "",
    `- Ended: **${r.ended}** (${r.ended === "game-over" ? "the scenario's last Game Turn was played" : r.ended === "turn-limit" ? `the limit of ${o.turns} Game Turns was reached` : "stopped by an anomaly"}); ${t.turnsPlayed} complete Game Turns, ${first} to ${last}; ${r.actions.length} actions (${r.setupActions} of them setup).`,
    `- Result: ${resultText(r)}`,
    `- Conquests (${r.final.conquests?.length ?? 0}): ${conquestList(r.final).join("; ") || "none"}.`,
    `- Options chosen per Front (${r.turns.reduce((n, x) => n + x.frontOptions.length, 0)}): ${optionsPerFront(r.turns)}.`,
    `- Wars declared (${t.wars.length}): ${t.wars.join("; ") || "none"}.`,
    `- Units built: ${t.built}; BRPs spent: ${t.spent}; grants: ${t.grants}.`,
    `- Ground combats: ${t.combats} (attacks Axis / Allies: ${t.attacksAxis} / ${t.attacksAllies}); units lost Axis / Allies: ${t.lostAxis} / ${t.lostAllies} (of them out of supply ${t.lostUnsuppliedAxis} / ${t.lostUnsuppliedAllies}; factors ${t.lostFactorsAxis} / ${t.lostFactorsAllies}); units moved: ${t.unitsMoved}; hexes changed hands: ${t.hexChanges}.`,
    `- Redeployments per nation (step 9e): ${POWERS.map((p) => `${SHORT[p]} ${t.redeployed[p]}`).join(", ")}.`,
    `- Player Turns in which a side with ${IDLE_MIN_GROUND} or more ground units neither moved nor attacked (${t.idle.length}): ${t.idle.join("; ") || "none"}.`,
    `- Churn (a side moving ${CHURN_MIN_MOVED} or more units without a single attack for ${CHURN_RUN} or more Game Turns in a row) (${t.churn.length}): ${t.churn.join("; ") || "none"}.`,
    `- Hexes held Axis / Allies / neutral: ${f.hexes.axis} / ${f.hexes.allies} / ${f.hexes.neutral} (at the start ${t.start.hexes.axis} / ${t.start.hexes.allies} / ${t.start.hexes.neutral}).`,
    `- Capitals and objectives held Axis / Allies / neutral: ${f.objectives.axis} / ${f.objectives.allies} / ${f.objectives.neutral} (at the start ${t.start.objectives.axis} / ${t.start.objectives.allies} / ${t.start.objectives.neutral}).`,
    f.units && f.factors ? `- Units on the map at the end Axis / Allies: ${pair(f.units)}; factors ${pair(f.factors)}.` : "- No Game Turn was played.",
    `- Final BRPs: ${f.brp ? POWERS.map((p) => `${SHORT[p]} ${f.brp![p]}`).join(", ") : "-"}.`,
    "",
    "## Anomalies",
    "",
    r.anomalies.length === 0 ? "None." : table(["Kind", "Where", "Detail"], r.anomalies.map((a) => [a.kind, a.at, a.detail])),
    "",
    rebuildReport(r.rebuild),
    "## Game Turns",
    "",
    turnTables(r.turns),
    "",
  ];
  return lines.join("\n");
}

/** One page comparing several games: a row per game, plus the runtime. */
export function comparison(results: readonly GameResult[]): string {
  const rows = results.map((r) => {
    const t = totals(r);
    return [r.options.scenario, r.options.seed, t.turnsPlayed, r.ended, r.final.result ? verdictName(r.final.result) : "-", r.final.conquests?.length ?? 0, r.actions.length, t.wars.length, t.built, t.combats, `${t.attacksAxis} / ${t.attacksAllies}`, `${t.lostAxis} / ${t.lostAllies}`, t.hexChanges, `${t.final.hexes.axis} / ${t.final.hexes.allies}`, `${t.final.objectives.axis} / ${t.final.objectives.allies}`, t.idle.length, t.churn.length, `${t.lostUnsuppliedAxis} / ${t.lostUnsuppliedAllies}`, r.anomalies.length, (r.runtimeMs / 1000).toFixed(1)];
  });
  const head = ["Scenario", "Seed", "Game Turns", "Ended", "Result", "Conquests", "Actions", "Wars", "Built", "Combats", "Attacks ax / al", "Lost ax / al", "Hexes changed", "Hexes ax / al", "Objectives ax / al", "Idle turns", "Churn runs", "Unsupplied lost ax / al", "Anomalies", "Runtime s"];
  const totalMs = sum(results.map((r) => r.runtimeMs));
  const anomalies = results.flatMap((r) => r.anomalies.map((a) => `- ${r.options.scenario} seed ${r.options.seed}: ${a.kind} at ${a.at}: ${a.detail}`));
  return [`# Self-play comparison`, "", table(head, rows), "", `${results.length} games, ${(totalMs / 1000).toFixed(1)} s in all, ${sum(results.map((r) => r.anomalies.length))} anomalies.`, "", ...(anomalies.length ? ["## Anomalies", "", ...anomalies, ""] : [])].join("\n");
}
