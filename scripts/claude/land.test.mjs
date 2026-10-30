import { test, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const script = resolve('scripts/land.sh');
function run(options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'land-test-'));
  mkdirSync(join(root, 'docs'));
  writeFileSync(join(root, 'docs/RULES.md'), options.rules ?? '');
  writeFileSync(join(root, 'docs/TODO-VERIFY.md'), options.verify ?? '');
  const executable = (name, body) => {
    const path = join(root, name);
    writeFileSync(path, '#!/usr/bin/env bash\nset -eu\n' + body);
    chmodSync(path, 0o755);
  };
  executable('git', `case "$1" in
    rev-parse) printf '%s\\n' "$LAND_ROOT" ;;
    status) printf '%s' "\${LAND_DIRTY:-}" ;;
    branch) echo task ;;
    diff)
      if [[ $* == *--name-only* ]]; then printf '%s' "$LAND_FILES" | tr '\\n' '\\0';
      else printf '%s' "\${LAND_DIFF:-}"; fi ;;
    *) exit 99 ;;
  esac`);
  executable('gh', `if [[ $1 == auth ]]; then exit "$LAND_AUTH"; fi
    echo "$LAND_STATE"`);
  executable('npm', `echo "$2" >> "$LAND_CALLS"
    if [[ $2 == coverage ]]; then echo ' Tests  7 passed (7)'; fi
    if [[ $2 == compare-games ]]; then echo '- 1939 seed 1: identical (42 actions)'; fi
    [[ $2 != "\${LAND_FAIL:-}" ]]`);
  const result = spawnSync('bash', [script, '204', ...(options.branch ? [options.branch] : [])], {
    encoding: 'utf8', timeout: 10000,
    env: { ...process.env, PATH: root + ':' + process.env.PATH, LAND_ROOT: root,
      LAND_FILES: options.files ?? 'docs/CODEX.md', LAND_AUTH: options.auth ?? '1',
      LAND_STATE: options.state ?? 'OPEN', LAND_DIRTY: options.dirty ?? '',
      LAND_DIFF: options.diff ?? '', LAND_FAIL: options.fail ?? '',
      LAND_CALLS: join(root, 'calls') },
  });
  const calls = (() => { try { return readFileSync(join(root, 'calls'), 'utf8'); } catch { return ''; } })();
  const path = /Summary: (.+)/.exec(result.stdout)?.[1];
  const summary = path ? readFileSync(path, 'utf8') : '';
  if (path) { rmSync(path); rmSync(path + '.log'); }
  rmSync(root, { recursive: true, force: true });
  return { ...result, summary, calls };
}

// #204: local changes must stop the helper before gates or network checks.
test('landing refuses a dirty tree', () => {
  const result = run({ dirty: '?? local.txt' });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('local changes');
  expect(result.calls).toBe('');
});

test('landing checks an optional branch', () => {
  expect(run({ branch: 'other' }).stderr).toContain('expected branch');
  expect(run({ branch: 'task' }).status).toBe(0);
});

test('docs-only landing skips comparison and unauthenticated PR checks, saves counts', () => {
  const result = run();
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain('Current branch: task');
  expect(result.summary).toContain('closed-PR check skipped (no gh token)');
  expect(result.summary).toContain('compare-games: skipped (no engine/ai/data change)');
  for (const gate of ['lint', 'typecheck', 'coverage', 'build']) expect(result.summary).toContain(gate + ': PASS');
  expect(result.summary).toContain('7 passed (7)');
  expect(result.summary).toContain('Changed shared engine files: none');
  expect(result.summary).toContain('tests/ai-stability.test.ts: unchanged');
});

test.each(['engine', 'ai', 'data'])('classifies src/%s and preserves per-game lines', (directory) => {
  const result = run({ files: `src/${directory}/actions.ts\ntests/ai-stability.test.ts` });
  expect(result.status).toBe(0);
  expect(result.summary).toContain('compare-games: PASS');
  expect(result.summary).toContain('- 1939 seed 1: identical (42 actions)');
  expect(result.summary).toContain('tests/ai-stability.test.ts: changed');
  expect(result.summary).toContain('Changed shared engine files: ' + (directory === 'engine' ? 'src/engine/actions.ts' : 'none'));
});

test('gate failure returns nonzero and still runs later gates', () => {
  const result = run({ fail: 'lint' });
  expect(result.status).toBe(1);
  expect(result.summary).toContain('lint: FAIL');
  expect(result.summary).toContain('build: PASS');
});

test('authenticated closed PR is refused; open PR continues', () => {
  expect(run({ auth: '0', state: 'CLOSED' }).stderr).toContain('must be open');
  expect(run({ auth: '0' }).summary).toContain('closed-PR check: open');
});

test('reports new unregistered verification ids but ignores moved markers', () => {
  const result = run({ diff: '+// TODO(verify) NEW999\n-// TODO(verify) MOVED998\n+// TODO(verify) MOVED998\n' });
  expect(result.summary).toContain('NEW999 (missing from docs/RULES.md, docs/TODO-VERIFY.md)');
  expect(result.summary).not.toContain('MOVED998');
});

test('comparison failure propagates and similarly named directories do not trigger it', () => {
  const failed = run({ files: 'src/data/map.json', fail: 'compare-games' });
  expect(failed.status).toBe(1);
  expect(failed.summary).toContain('compare-games: FAIL');
  expect(run({ files: 'src/engine-extra/example.ts' }).calls).not.toContain('compare-games');
});

test('verification ids must appear in each registry', () => {
  const result = run({ rules: 'ONE997 BOTH996', verify: 'BOTH996',
    diff: '+// TODO(verify) ONE997\n+// TODO(verify) BOTH996\n' });
  expect(result.summary).toContain('ONE997 (missing from docs/TODO-VERIFY.md)');
  expect(result.summary).not.toContain('BOTH996');
});
