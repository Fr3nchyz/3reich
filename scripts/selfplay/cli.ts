/**
 * Headless computer-against-computer games (docs/SELFPLAY.md):
 *   npm run selfplay -- --scenario <1939|campaign|1942|1944|all> --turns <N|end> --seed <n> [--games k] [--out dir] [--no-verify]
 * Writes <scenario>-seed<n>.json (the recorded actions, replayable with the engine's replay()) and .md per game
 * to the output folder (default selfplay-out/, git-ignored), prints the one-page comparison, and exits 1 on any anomaly,
 * 2 for a bad command line, 3 if the run itself crashed.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, recording, type CliArgs } from "./args";
import { prepareOut } from "./out";
import { comparison, gameReport } from "./report";
import { runGame } from "./runner";
import type { GameResult } from "./types";

function main(): void {
  const root = fileURLToPath(new URL("../..", import.meta.url));
  let args: CliArgs;
  let dir: string;
  try {
    args = parseArgs(process.argv.slice(2), root);
    const out = prepareOut(root, args.out);
    dir = out.dir;
    if (out.existing) console.error(`${dir} already holds files; those with the same names are overwritten.`);
  } catch (e) {
    console.error((e as Error).message);
    process.exit(2);
  }
  const results: GameResult[] = [];
  for (const scenario of args.scenarios) {
    for (let k = 0; k < args.games; k++) {
      const seed = args.seed + k;
      const r = runGame({ scenario, seed, turns: args.turns, verify: args.verify });
      const base = join(dir, `${scenario}-seed${seed}`);
      writeFileSync(`${base}.json`, JSON.stringify(recording(r)));
      writeFileSync(`${base}.md`, gameReport(r));
      console.error(`${scenario} seed ${seed}: ${r.ended}, ${r.actions.length} actions, ${r.anomalies.length} anomalies, ${(r.runtimeMs / 1000).toFixed(1)} s`);
      results.push(r);
    }
  }
  const page = comparison(results);
  writeFileSync(join(dir, `comparison-${args.scenarios.length > 1 ? "all" : args.scenarios[0]}-seed${args.seed}x${args.games}.md`), page);
  console.log(page);
  console.error(`Reports in ${dir}`);
  process.exit(results.some((r) => r.anomalies.length > 0) ? 1 : 0);
}

try {
  main();
} catch (e) {
  console.error(`The run crashed: ${(e as Error).stack ?? String(e)}`);
  process.exit(3);
}
