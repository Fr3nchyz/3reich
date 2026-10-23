// Every commit a session pushes must end with its Claude-Session trailer (CLAUDE.md, "Commits"). A merge made with `--no-edit` is the usual way to lose it.
import { execFileSync } from 'node:child_process'

/** The directory a push command runs in: the last `cd <dir>` before it, or `git -C <dir> push`, else the current one. */
export function pushDir(command) {
  const c = /\bgit\s+-C\s+("[^"]+"|'[^']+'|\S+)\s+push\b/.exec(command)
  if (c) return unquote(c[1])
  const cds = [...command.split(/\bgit\s+push\b/)[0].matchAll(/\bcd\s+("[^"]+"|'[^']+'|[^\s;&|]+)/g)]
  return cds.length ? unquote(cds[cds.length - 1][1]) : process.cwd()
}

const unquote = (s) => s.replace(/^["']|["']$/g, '')

/** The subjects of the commits whose message lacks a `Claude-Session:` line. `log` is `git log --format=%H%x00%s%x00%B%x01` output. */
export function missingTrailer(log) {
  return log.split('\x01').map((r) => r.trim()).filter(Boolean).flatMap((r) => {
    const [, subject, body] = r.split('\x00')
    return /^Claude-Session: \S+/m.test(body ?? '') ? [] : [subject]
  })
}

/** The commits not yet on origin/main in `dir` that lack the trailer; [] when the range cannot be read (no origin/main, not a repo). */
export function unsignedCommits(dir) {
  try {
    const log = execFileSync('git', ['-C', dir, 'log', 'origin/main..HEAD', '--format=%H%x00%s%x00%B%x01'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    return missingTrailer(log)
  } catch {
    return []
  }
}
