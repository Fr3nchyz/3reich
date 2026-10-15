// Number-literal mutation harness (a companion to Stryker, which does not change numbers).
// Usage: node scripts/mutation/numbers.mjs <src/engine/file.ts> [--every N] [--offset K] [--out report.json]
// For each whole-number literal in code (never in a comment, string, or type) it writes the file with that number
// +1, then -1 where the result is not negative, runs the tests that depend on the file, and records killed or
// survived. The file is always restored. --every N keeps every Nth mutant (fixed order, so the sample is repeatable).
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import ts from "typescript";

const args = process.argv.slice(2);
const file = args[0];
const opt = (name, d) => (args.includes(name) ? args[args.indexOf(name) + 1] : d);
const every = Number(opt("--every", 1));
const offset = Number(opt("--offset", 0));
const out = opt("--out", "");
const original = readFileSync(file, "utf8");
const src = ts.createSourceFile(file, original, ts.ScriptTarget.Latest, true);

const inType = (n) => {
  for (let p = n.parent; p; p = p.parent) if (ts.isTypeNode(p) || ts.isTypeAliasDeclaration(p) || ts.isInterfaceDeclaration(p)) return true;
  return false;
};
const found = [];
(function walk(n) {
  if (ts.isNumericLiteral(n) && !inType(n) && /^\d+$/.test(n.text)) {
    const v = Number(n.text);
    const { line } = src.getLineAndCharacterOfPosition(n.getStart());
    for (const d of [1, -1]) if (v + d >= 0) found.push({ start: n.getStart(), end: n.getEnd(), from: v, to: v + d, line: line + 1 });
  }
  ts.forEachChild(n, walk);
})(src);
const picked = found.filter((_, i) => i % every === offset % every);

// Slow whole-game tests are left out: the rule tests for a module are the quick ones.
const SLOW = ["ai-selfplay", "selfplay", "warsaw-playtest", "ai-stability", "computer-play", "computer-loop", "watch-play", "e2e-load"];
const exclude = SLOW.map((s) => `--exclude=tests/${s}.test.ts`);
const results = [];
try {
  for (const m of picked) {
    writeFileSync(file, original.slice(0, m.start) + String(m.to) + original.slice(m.end));
    const r = spawnSync(
      "npx",
      ["vitest", "related", file, "--run", "--bail=1", "--pool=threads", "--poolOptions.threads.maxThreads=2", "--poolOptions.threads.minThreads=1", ...exclude, "--reporter=dot"],
      { encoding: "utf8", timeout: 120000 },
    );
    const status = r.error ? "killed" : r.status === 0 ? "survived" : "killed";
    results.push({ file, line: m.line, from: m.from, to: m.to, status });
    console.log(`${file}:${m.line} ${m.from} -> ${m.to}: ${status}`);
  }
} finally {
  writeFileSync(file, original);
}
const killed = results.filter((r) => r.status === "killed").length;
console.log(`${file}: ${results.length} tried of ${found.length}, ${killed} killed, ${results.length - killed} survived`);
if (out) writeFileSync(out, JSON.stringify({ file, total: found.length, results }, null, 1));
