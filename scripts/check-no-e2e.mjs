import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The production bundle must not contain the test-only game loader (src/ui/e2eLoad.ts, spec 07 builder question B3): it is compiled in only by
 * `vite build --mode e2e`. Run after `vite build`; exits with 1 if the marker string is found anywhere in dist/. Usage: node scripts/check-no-e2e.mjs [dir]
 */
const dir = process.argv[2] ?? "dist";
const MARKER = "e2e-load";

function files(d) {
  return readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(d, e.name)) : [join(d, e.name)]));
}

const hits = files(dir).filter((f) => /\.(js|html|css|map)$/.test(f) && readFileSync(f, "utf8").includes(MARKER));
if (hits.length > 0) {
  console.error(`The test-only loader ("${MARKER}") is in the production bundle: ${hits.join(", ")}`);
  process.exit(1);
}
console.log(`ok: no "${MARKER}" in ${dir}/`);
