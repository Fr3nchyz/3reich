// PreToolUse hook: before any `git push`, run the repo's checks and block the push if they fail.
import { execSync } from 'node:child_process'

let raw = ''
for await (const chunk of process.stdin) raw += chunk
const command = JSON.parse(raw || '{}').tool_input?.command ?? ''

if (/\bgit\s+push\b/.test(command)) {
  try {
    // Lint only tracked files so untracked scratch files cannot block a push; CI lints the whole checkout.
    execSync('git ls-files -z -- \'*.ts\' \'*.js\' \'*.mjs\' | xargs -0 npx eslint --max-warnings 0 --no-error-on-unmatched-pattern && npm run typecheck && npm test && npm run build', { stdio: ['ignore', 2, 2] })
  } catch {
    console.error('Blocked: lint, typecheck, tests or build failed. Fix them, then push again. If the error is a missing module or command, run `npm ci` first.')
    process.exit(2)
  }
}
