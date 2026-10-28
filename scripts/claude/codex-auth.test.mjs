import { test, expect } from 'vitest';
import { spawnSync } from 'node:child_process';

test('subscription bootstrap passes the seven isolated dummy-credential checks', () => {
  const result = spawnSync(process.execPath, ['--test', 'scripts/claude/codex-auth-check.mjs'], {
    encoding: 'utf8', timeout: 10000,
  });
  expect(result.error).toBeUndefined();
  expect(result.status, result.stdout + result.stderr).toBe(0);
  expect(result.stdout).toMatch(/tests 7/);
});
