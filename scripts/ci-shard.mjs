// Runs one half of the unit tests for CI (see .github/workflows/ci.yml, job test-shard): `node scripts/ci-shard.mjs <1|2> [vitest args...]`.
// The files are the ones `vitest list` reports (its own include rules), split the way `vitest --shard=i/2` splits them (sort by the sha1 of the
// path, first half to shard 1), except the files in PINNED, which are set by hand so the slow ones come out balanced (measured seconds, one local
// run): shard 1 gets siberian-play and winter-play, shard 2 gets surrender-play, ai-selfplay, selfplay and action-labels, selfplay-audit, ai-supply-play.
// The script exits non-zero if the two halves do not cover exactly the listed files or a half is empty (an empty list would run everything).
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

const PINNED = new Map([
  ["siberian-play", 1], ["winter-play", 1],
  ["surrender-play", 2], ["ai-selfplay", 2], ["selfplay", 2], ["action-labels", 2], ["selfplay-audit", 2], ["ai-supply-play", 2],
]);
const TEST_FILE = /\.test\.[cm]?[jt]sx?$/;

export function listTestFiles() {
  const r = spawnSync("npx", ["vitest", "list", "--filesOnly"], { encoding: "utf8", maxBuffer: 1 << 24 });
  if (r.status !== 0) throw new Error(`vitest list failed: ${r.stderr}`);
  return r.stdout.split("\n").map((l) => l.trim()).filter((l) => TEST_FILE.test(l));
}

export function shardFiles(index, count = 2, names = listTestFiles()) {
  const hashed = names.map((f) => [createHash("sha1").update(`/${f}`).digest("hex"), f]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const size = Math.ceil(hashed.length / count);
  return hashed
    .filter(([, f], i) => (PINNED.get(f.replace(/^.*\//, "").replace(TEST_FILE, "")) ?? Math.floor(i / size) + 1) === index)
    .map(([, f]) => f);
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const index = Number(process.argv[2]);
  if (index !== 1 && index !== 2) throw new Error("usage: node scripts/ci-shard.mjs <1|2> [vitest args]");
  const all = listTestFiles();
  const files = shardFiles(index, 2, all);
  const union = new Set([...shardFiles(1, 2, all), ...shardFiles(2, 2, all)]);
  if (!files.length || union.size !== all.length || all.some((f) => !union.has(f))) {
    console.error(`shard ${index}: the two shards do not cover exactly the ${all.length} test files vitest lists`);
    process.exit(1);
  }
  console.log(`shard ${index}: ${files.length} of ${all.length} test files`);
  const r = spawnSync("npx", ["vitest", "run", ...process.argv.slice(3), ...files], { stdio: "inherit" });
  process.exit(r.status ?? 1);
}
