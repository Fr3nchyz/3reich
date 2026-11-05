// Runs one half of the unit tests for CI (see .github/workflows/ci.yml, job test-shard): `node scripts/ci-shard.mjs <1|2> [vitest args...]`.
// Files are split the way `vitest --shard=i/2` splits them (sort by the sha1 of the path, first half to shard 1), except the files in PINNED, which
// are set by hand so the slow ones come out balanced (measured times in seconds, one local run): shard 1 gets siberian-play and winter-play,
// shard 2 gets surrender-play, ai-selfplay, selfplay and the three files moved from shard 1 (action-labels, selfplay-audit, ai-supply-play).
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";

const PINNED = new Map([
  ["siberian-play", 1], ["winter-play", 1],
  ["surrender-play", 2], ["ai-selfplay", 2], ["selfplay", 2], ["action-labels", 2], ["selfplay-audit", 2], ["ai-supply-play", 2],
]);

export function shardFiles(index, count = 2, names = readdirSync("tests", { recursive: true }).filter((f) => f.endsWith(".test.ts") && !f.startsWith("e2e/"))) {
  const hashed = names.map((f) => [createHash("sha1").update(`/tests/${f}`).digest("hex"), f]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const size = Math.ceil(hashed.length / count);
  return hashed
    .filter(([, f], i) => (PINNED.get(f.replace(/\.test\.ts$/, "")) ?? Math.floor(i / size) + 1) === index)
    .map(([, f]) => `tests/${f}`);
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const index = Number(process.argv[2]);
  if (index !== 1 && index !== 2) throw new Error("usage: node scripts/ci-shard.mjs <1|2> [vitest args]");
  const files = shardFiles(index);
  console.log(`shard ${index}: ${files.length} test files`);
  const r = spawnSync("npx", ["vitest", "run", ...process.argv.slice(3), ...files], { stdio: "inherit" });
  process.exit(r.status ?? 1);
}
