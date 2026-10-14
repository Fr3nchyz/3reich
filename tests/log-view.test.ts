import { describe, expect, it } from "vitest";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { legalActions } from "../src/engine/actions";
import { LOG_LIMIT, logEntries, logHtml, logScrollTop } from "../src/ui/logView";
import { createSession } from "../src/ui/session";
import { statusHtml } from "../src/ui/statusView";

/** The activity log panel: newest entry first, capped on screen but never in the session, and a stable scroll position. */

const lines = (n: number) => Array.from({ length: n }, (_, i) => `entry ${i + 1}`);

describe("the order and size of the listed entries", () => {
  it("lists the newest entry first", () => {
    expect(logEntries(["a", "b", "c"])).toEqual(["c", "b", "a"]);
  });

  it("lists at most the latest LOG_LIMIT entries and leaves the data alone", () => {
    const log = lines(LOG_LIMIT + 50);
    const shown = logEntries(log);
    expect(shown).toHaveLength(LOG_LIMIT);
    expect(shown[0]).toBe(`entry ${LOG_LIMIT + 50}`);
    expect(shown.at(-1)).toBe("entry 51");
    expect(log).toHaveLength(LOG_LIMIT + 50);
    expect(log[0]).toBe("entry 1");
  });

  it("renders newest first, numbered by entry, and says when older ones are not shown", () => {
    const html = logHtml(lines(LOG_LIMIT + 3));
    expect(html).toContain(`start="${LOG_LIMIT + 3}"`);
    expect(html).toContain("reversed");
    expect(html.indexOf(`entry ${LOG_LIMIT + 3}<`)).toBeLessThan(html.indexOf(`entry ${LOG_LIMIT + 2}<`));
    expect(html).not.toContain("<li>entry 3</li>");
    expect(html).toContain("Older entries (3) are not shown.");
    expect(logHtml(["only"])).not.toContain("Older entries");
  });

  it("is what the status area shows for a real session, with the first line last", () => {
    const s = createSession(SCENARIO_1939, "axis", 1);
    s.log.push("newest line");
    const html = statusHtml(s, null, legalActions(s.ctx, s.state));
    const items = [...html.matchAll(/<li>(.*?)<\/li>/g)].map((m) => m[1]);
    expect(items[0]).toBe("newest line");
    expect(items.at(-1)).toContain("started");
  });
});

describe("the log's scroll position across a redraw", () => {
  it("stays at the top when the reader is at the top, so new entries show", () => {
    expect(logScrollTop(0, 3, 90)).toBe(0);
    expect(logScrollTop(2, 3, 90)).toBe(0);
  });

  it("moves down with the new entries when the reader is partway down, so the same entries stay in view", () => {
    expect(logScrollTop(120, 2, 60)).toBe(180);
  });

  it("stays put when nothing was added", () => {
    expect(logScrollTop(120, 0, 0)).toBe(120);
  });

  it("goes back to the top when the log shrank (a new game)", () => {
    expect(logScrollTop(120, -4, 0)).toBe(0);
  });
});
