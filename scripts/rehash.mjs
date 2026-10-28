// Issue #174: execute the stability test's own hash expressions, without changing its pins.
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync, symlinkSync } from "node:fs";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);

export function compareHashes(main, checkout) {
  const names = [...new Set([...main.map((c) => c.name), ...checkout.map((c) => c.name)])];
  const lines = names.map((name) => {
    const old = main.find((c) => c.name === name);
    const current = checkout.find((c) => c.name === name);
    const same = old && current && old.value === current.value && current.value === current.expected;
    return `${name}: main=${old?.value ?? "missing"} checkout=${current?.value ?? "missing"} ${same ? "same" : "different"}`;
  });
  return { lines, exitCode: lines.some((line) => line.endsWith("different")) ? 1 : 0 };
}

// Capture numeric equality assertions; negative assertions and non-hash tests are excluded.
// The original bodies still import and execute their original hash and game code.
async function play(tree, temp, label, root) {
  const file = join(tree, "tests/ai-stability.test.ts");
  const original = readFileSync(file, "utf8");
  const pins = [...original.matchAll(/expect\((hashOf\([^\n]+?\)|h)\)\.toBe\((\d+)\)/g)];
  if (!pins.length) throw new Error(`No stability hashes found in ${file}`);
  let source = original.replace(/import \{ describe, expect, it \} from "vitest";/, `
const collected = [];
let testName = "";
const describe = (_name, body) => body();
const it = (name, body) => {
  if (!/hashOf\\(|fnv\\(/.test(body.toString()) || /\\.not\\.toBe/.test(body.toString())) return;
  testName = name;
  body();
};
const expect = (value) => ({
  toBe: (expected) => collected.push({ name: testName + " [" + collected.length + "]", value, expected }),
  toBeGreaterThan: () => {},
});
`);
  source = source.replace(/from "(\.[^"]+)"/g, (_match, path) => `from ${JSON.stringify(resolve(dirname(file), path))}`);
  const resultFile = join(temp, `${label}.json`);
  source += `\nimport { writeFileSync as save } from "node:fs";\nsave(${JSON.stringify(resultFile)}, JSON.stringify(collected));\n`;
  const runner = join(temp, `${label}.ts`);
  writeFileSync(runner, source);
  await exec(join(root, "node_modules/.bin/vite-node"), [runner], { cwd: root });
  const cases = JSON.parse(readFileSync(resultFile, "utf8"));
  if (cases.length !== pins.length) throw new Error(`Collected ${cases.length} of ${pins.length} hash assertions`);
  const replacements = original.split("\n").filter((line) => pins.some((pin) => line.includes(pin[0])))
    .map((line) => pins.reduce((updated, pin, i) => updated.replace(pin[0], `expect(${pin[1]}).toBe(${cases[i].value})`), line));
  return { cases, replacements };
}

export async function main(args = process.argv.slice(2)) {
  const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
  let base = "origin/main";
  let write = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--") continue;
    if (args[i] === "--write") write = true;
    else if (args[i] === "--base" && args[i + 1] && !args[i + 1].startsWith("--")) base = args[++i];
    else throw new Error("Usage: npm run rehash [-- --base <ref>] [--write]");
  }
  // Same default and commit resolution as compare-games; archive avoids mutating Git metadata.
  const { stdout } = await exec("git", ["rev-parse", "--verify", `${base}^{commit}`], { cwd: root });
  const sha = stdout.trim();
  const temp = mkdtempSync(join(tmpdir(), "rehash-"));
  try {
    const tree = join(temp, "base");
    mkdirSync(tree);
    const archive = join(temp, "base.tar");
    await exec("git", ["archive", "--output", archive, sha], { cwd: root });
    await exec("tar", ["-xf", archive, "-C", tree]);
    symlinkSync(join(root, "node_modules"), join(tree, "node_modules"));
    const old = await play(tree, temp, "main", root);
    const current = await play(root, temp, "checkout", root);
    const result = compareHashes(old.cases, current.cases);
    console.log(result.lines.join("\n"));
    if (write) console.log("\nReplacement lines (not written):\n" + [...new Set(current.replacements)].join("\n"));
    return result.exitCode;
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = await main(); }
  catch (error) { console.error(error.message); process.exitCode = 2; }
}
