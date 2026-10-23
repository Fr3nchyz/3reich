import { describe, expect, it } from "vitest";
import { missingTrailer, pushDir } from "../scripts/claude/trailer-check.mjs";

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
  it("finds the directory the push runs in", () => {
    expect(pushDir("cd /home/user/3reich-wt/a && git push -u origin a")).toBe("/home/user/3reich-wt/a");
    expect(pushDir("cd /x && cd /y && git push")).toBe("/y");
    expect(pushDir("git -C '/home/user/3reich-wt/b' push -u origin b")).toBe("/home/user/3reich-wt/b");
    expect(pushDir("git push")).toBe(process.cwd());
  });
});
