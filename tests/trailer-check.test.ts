import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isPush, missingTrailer, pushDir, unsignedCommits } from "../scripts/claude/trailer-check.mjs";

// CLAUDE.md "Commits": every commit ends with the Co-Authored-By and Claude-Session lines; the push gate refuses a push that would publish one without.
const rec = (subject: string, body: string) => `abc\x00${subject}\x00${body}\x01`;

describe("push gate: Claude-Session trailer", () => {
  it("passes commits that carry the trailer", () => {
    expect(missingTrailer(rec("Fix", "Fix\n\nCo-Authored-By: X <x@y>\nClaude-Session: https://claude.ai/code/session_1\n"))).toEqual([]);
  });
  it("names a merge made with --no-edit", () => {
    expect(missingTrailer(rec("Merge remote-tracking branch 'origin/main'", "Merge remote-tracking branch 'origin/main'\n") + rec("Ok", "Ok\nClaude-Session: s\n"))).toEqual(["Merge remote-tracking branch 'origin/main'"]);
  });
  it("does not take a mention in the text for the trailer line", () => {
    expect(missingTrailer(rec("Docs", "Docs about the Claude-Session: line"))).toEqual(["Docs"]);
  });
  it("is empty for an empty range", () => {
    expect(missingTrailer("")).toEqual([]);
  });
  it("sees a push in both forms, and nothing else", () => {
    expect(isPush("cd /x && git push -u origin a")).toBe(true);
    expect(isPush("git -C '/home/user/3reich-wt/b' push origin b")).toBe(true);
    expect(isPush("git -C /x push")).toBe(true);
    expect(isPush("git status && git log")).toBe(false);
    expect(isPush("git -C /x pull")).toBe(false);
  });
  it("finds the directory the push runs in", () => {
    expect(pushDir("cd /home/user/3reich-wt/a && git push -u origin a")).toBe("/home/user/3reich-wt/a");
    expect(pushDir("cd /x && cd /y && git push")).toBe("/y");
    expect(pushDir("git -C '/home/user/3reich-wt/b' push -u origin b")).toBe("/home/user/3reich-wt/b");
    expect(pushDir("git push")).toBe(process.cwd());
  });
});

describe("push gate: range of commits checked", () => {
  const dirs: string[] = [];
  afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
  it("checks only commits not yet on the remote branch, so an old pushed commit does not block later pushes", () => {
    const dir = mkdtempSync(join(tmpdir(), "trailer-"));
    dirs.push(dir);
    const git = (...a: string[]) => execFileSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@t", ...a], { encoding: "utf8" });
    git("init", "-q", "-b", "main");
    git("commit", "-q", "--allow-empty", "-m", "base\n\nClaude-Session: s");
    git("update-ref", "refs/remotes/origin/main", "HEAD");
    git("checkout", "-q", "-b", "work");
    git("commit", "-q", "--allow-empty", "-m", "old unsigned");
    expect(unsignedCommits(dir)).toEqual(["old unsigned"]);
    git("update-ref", "refs/remotes/origin/work", "HEAD");
    expect(unsignedCommits(dir)).toEqual([]);
    git("commit", "-q", "--allow-empty", "-m", "new unsigned");
    expect(unsignedCommits(dir)).toEqual(["new unsigned"]);
  });
});
