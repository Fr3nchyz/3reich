/**
 * Headless computer-against-computer games (docs/SELFPLAY.md):
 *   npm run selfplay -- --scenario <1939|campaign|1942|1944|all> --turns <N|end> --seed <n> [--games k] [--out dir] [--no-verify]
 * Writes <scenario>-seed<n>.json (the recorded actions, replayable with the engine's replay()) and .md per game
 * to the output folder (default selfplay-out/, git-ignored), prints the one-page comparison, and exits 1 on any anomaly.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs, recording, type CliArgs } from "./args";
import { comparison, gameReport } from "./report";
import { runGame } from "./runner";
import type { GameResult } from "./types";

function main(): void {
  let args: CliArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error((e as Error).message);
    process.exit(2);
  }
  mkdirSync(args.out, { recursive: true });
  const results: GameResult[] = [];
  for (const scenario of args.scenarios) {
    for (let k = 0; k < args.games; k++) {
      const seed = args.seed + k;
      const r = runGame({ scenario, seed, turns: args.turns, verify: args.verify });
      const base = join(args.out, `${scenario}-seed${seed}`);
      writeFileSync(`${base}.json`, JSON.stringify(recording(r)));
      writeFileSync(`${base}.md`, gameReport(r));
      console.error(`${scenario} seed ${seed}: ${r.ended}, ${r.actions.length} actions, ${r.anomalies.length} anomalies, ${(r.runtimeMs / 1000).toFixed(1)} s`);
      results.push(r);
    }
  }
  const page = comparison(results);
  writeFileSync(join(args.out, `comparison-${args.scenarios.length > 1 ? "all" : args.scenarios[0]}-seed${args.seed}x${args.games}.md`), page);
  console.log(page);
  console.error(`Reports in ${args.out}/`);
  process.exit(results.some((r) => r.anomalies.length > 0) ? 1 : 0);
}

main();
