// Old-against-new comparison of whole computer games (CLAUDE.md, "Checking a change").
// Usage: npm run compare-games [-- --base <git ref>] [--quick]
// Plays the standard set of 22 games (1939 seeds 1 to 10; Campaign, 1942 and 1944 seeds 1 to 4) to their end on the base
// (default origin/main, in a temporary worktree) and on this checkout, then compares every recorded action of each pair.
// Prints one line per game: identical, or the first action that differs (its index and the old and new action), with the
// result of each side. --quick plays 1939 seeds 1 to 3 and seed 1 of the other three scenarios.
// Exit code: 0 when it ran (differences are reported, not failures), 1 when a game had an anomaly, 2 for a bad command line.
import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const args = process.argv.slice(2).filter((a) => a !== "--");
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const base = opt("--base") ?? "origin/main";
const quick = args.includes("--quick");
for (const a of args) if (a.startsWith("--") && !["--base", "--quick"].includes(a)) { console.error(`Unknown argument ${a}. Usage: npm run compare-games [-- --base <ref>] [--quick]`); process.exit(2); }

const SETS = quick ? [["1939", 3], ["campaign", 1], ["1942", 1], ["1944", 1]] : [["1939", 10], ["campaign", 4], ["1942", 4], ["1944", 4]];
const root = resolve(new URL("..", import.meta.url).pathname);
const OUT = "selfplay-out/compare";

let baseSha;
try { baseSha = execFileSync("git", ["rev-parse", "--verify", `${base}^{commit}`], { cwd: root, encoding: "utf8" }).trim(); }
catch { console.error(`Unknown git ref "${base}".`); process.exit(2); }
const headSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const dirty = execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], { cwd: root, encoding: "utf8" }).trim() !== "";

const tmp = mkdtempSync(join(tmpdir(), "compare-games-"));
const baseTree = join(tmp, "base");
execFileSync("git", ["worktree", "add", "--detach", baseTree, baseSha], { cwd: root, stdio: "ignore" });
symlinkSync(join(root, "node_modules"), join(baseTree, "node_modules"));

/** Plays the set in one tree; resolves when every scenario is done. Exit 1 (an anomaly) is reported per game, not thrown. */
function play(tree) {
  return Promise.all(SETS.map(([scenario, games]) => new Promise((done, fail) => {
    const p = spawn("npx", ["vite-node", "scripts/selfplay/cli.ts", "--scenario", scenario, "--turns", "end", "--seed", "1", "--games", String(games), "--no-verify", "--out", OUT], { cwd: tree, stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => (code === 0 || code === 1 ? done() : fail(new Error(`${tree} ${scenario}: exit ${code}\n${err.slice(-2000)}`))));
  })));
}

const started = Date.now();
let anomalies = 0;
try {
  await Promise.all([play(baseTree), play(root)]);
  const read = (tree, scenario, seed) => {
    const f = join(tree, OUT, `${scenario}-seed${seed}`);
    const rec = JSON.parse(readFileSync(`${f}.json`, "utf8"));
    const md = existsSync(`${f}.md`) ? readFileSync(`${f}.md`, "utf8") : "";
    const result = /^- Result: (.*)$/m.exec(md)?.[1] ?? "?";
    return { actions: rec.actions.map((a) => JSON.stringify(a)), anomalies: rec.anomalies ?? [], result };
  };
  const lines = [];
  let same = 0;
  for (const [scenario, games] of SETS) {
    for (let seed = 1; seed <= games; seed++) {
      const o = read(baseTree, scenario, seed);
      const n = read(root, scenario, seed);
      anomalies += n.anomalies.length;
      const len = Math.min(o.actions.length, n.actions.length);
      let i = 0;
      while (i < len && o.actions[i] === n.actions[i]) i++;
      const name = `${scenario} seed ${seed}`;
      const anom = n.anomalies.length ? `; NEW ANOMALIES: ${n.anomalies.map((x) => `${x.kind} at ${x.at}`).join(", ")}` : "";
      if (i === o.actions.length && i === n.actions.length) { same++; lines.push(`- ${name}: identical (${n.actions.length} actions; ${n.result})${anom}`); continue; }
      const at = (list) => (i < list.length ? list[i].slice(0, 160) : "(the game had ended)");
      lines.push(`- ${name}: first difference at action ${i} of ${o.actions.length} / ${n.actions.length}\n    old: ${at(o.actions)}\n    new: ${at(n.actions)}\n    result: ${o.result === n.result ? `same, ${n.result}` : `${o.result} -> ${n.result}`}${anom}`);
    }
  }
  const total = SETS.reduce((s, [, g]) => s + g, 0);
  console.log(`Compared ${total} games, base ${base} (${baseSha.slice(0, 7)}) against this checkout (${headSha.slice(0, 7)}${dirty ? " plus uncommitted changes" : ""}), in ${Math.round((Date.now() - started) / 1000)} s.`);
  console.log(`${same} identical, ${total - same} differ, ${anomalies} anomalies in the new games.\n`);
  console.log(lines.join("\n"));
} finally {
  execFileSync("git", ["worktree", "remove", "--force", baseTree], { cwd: root, stdio: "ignore" });
  rmSync(tmp, { recursive: true, force: true });
}
process.exit(anomalies ? 1 : 0);
