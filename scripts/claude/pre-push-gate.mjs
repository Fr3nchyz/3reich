// PreToolUse hook: before any `git push`, run the repo's checks and block the push if they fail.
import { execSync } from 'node:child_process'

let raw = ''
for await (const chunk of process.stdin) raw += chunk
const command = JSON.parse(raw || '{}').tool_input?.command ?? ''

if (/\bgit\s+push\b/.test(command)) {
  try {
    execSync('npm run typecheck && npm test && npm run build', { stdio: ['ignore', 2, 2] })
  } catch {
    console.error('Blocked: typecheck, tests or build failed. Fix them, then push again.')
    process.exit(2)
  }
}
