// Stop hook: if src/ or tests/ have uncommitted TypeScript changes, run the quick typecheck and send the errors back to Claude (exit 2) instead of letting the turn end.
import { execSync } from 'node:child_process'

let raw = ''
for await (const chunk of process.stdin) raw += chunk
// Already continuing because of this hook once: do not loop.
if (JSON.parse(raw || '{}').stop_hook_active) process.exit(0)

const dirty = execSync('git status --porcelain -- src tests', { encoding: 'utf8' })
if (!/\.tsx?$/m.test(dirty)) process.exit(0)
try {
  execSync('npx tsc --noEmit', { stdio: ['ignore', 2, 2] })
} catch {
  console.error('Typecheck failed on your uncommitted changes. Fix the errors above before finishing.')
  process.exit(2)
}
