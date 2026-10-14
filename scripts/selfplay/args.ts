import { isAbsolute, relative, resolve } from "node:path";
import type { ScenarioKey } from "./scenarios";
import { SCENARIO_KEYS } from "./scenarios";
import type { GameResult } from "./types";

export interface CliArgs {
  scenarios: ScenarioKey[];
  turns: number | "end";
  seed: number;
  games: number;
  out: string;
  verify: boolean;
}

export const USAGE = "usage: npm run selfplay -- --scenario <1939|campaign|1942|1944|all> --turns <N|end> --seed <n> [--games k] [--out dir] [--no-verify]";

/** The seeds the engine accepts (newGame). */
export const MAX_SEED = 0xffffffff;

/**
 * Parses the command line; throws an Error with the usage text for anything it does not understand. `root` is the repository
 * folder: `--out` must name a folder inside it (not the folder itself), so a run cannot write over anything else.
 */
export function parseArgs(argv: readonly string[], root: string = process.cwd()): CliArgs {
  const args: CliArgs = { scenarios: ["1939"], turns: 4, seed: 1, games: 1, out: "selfplay-out", verify: true };
  const int = (name: string, v: string | undefined, min: number, max = Number.MAX_SAFE_INTEGER): number => {
    const n = Number(v);
    if (v === undefined || !/^\d+$/.test(v) || !Number.isSafeInteger(n) || n < min || n > max) throw new Error(`${name} needs a whole number from ${min} to ${max}, got ${v === undefined ? "nothing" : `"${v}"`}. ${USAGE}`);
    return n;
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]!;
    const value = argv[i + 1];
    switch (flag) {
      case "--scenario":
        if (value === "all") args.scenarios = [...SCENARIO_KEYS];
        else if ((SCENARIO_KEYS as string[]).includes(value ?? "")) args.scenarios = [value as ScenarioKey];
        else throw new Error(`--scenario is one of ${SCENARIO_KEYS.join(", ")}, all; got ${value ?? "nothing"}. ${USAGE}`);
        i++;
        break;
      case "--turns": args.turns = value === "end" ? "end" : int("--turns", value, 1); i++; break;
      case "--seed": args.seed = int("--seed", value, 0, MAX_SEED); i++; break;
      case "--games": args.games = int("--games", value, 1); i++; break;
      case "--out": {
        if (!value || value.startsWith("--")) throw new Error(`--out needs a folder name, got ${value === undefined ? "nothing" : `"${value}"`}. ${USAGE}`);
        const rel = relative(resolve(root), resolve(root, value));
        if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) throw new Error(`--out must be a folder inside the repository (not the repository itself), got "${value}". ${USAGE}`);
        args.out = value;
        i++;
        break;
      }
      case "--no-verify": args.verify = false; break;
      case "--": break;
      default: throw new Error(`Unknown argument ${flag}. ${USAGE}`);
    }
  }
  if (args.seed + args.games - 1 > MAX_SEED) throw new Error(`--seed ${args.seed} with --games ${args.games} goes past the largest seed, ${MAX_SEED}. ${USAGE}`);
  return args;
}

/** The recorded game as written to disk: the actions replay() needs, with the facts to find the right scenario and seed. */
export function recording(r: GameResult) {
  return { format: 1, scenario: r.options.scenario, seed: r.options.seed, turns: r.options.turns, ended: r.ended, setupActions: r.setupActions, anomalies: r.anomalies, actions: r.actions };
}

