import { expect, test, type Page } from "@playwright/test";

/**
 * A basic usability pass over every scenario and both sides: start, put one counter down the way a
 * player would (a tap on a yellow hex, or the box button when the counter goes off the map), let the
 * game place the rest, then play into the next Game Turn. No page error may occur on the way.
 */

const SCENARIOS = [
  ["1939", "1939 Scenario"],
  ["campaign", "Campaign Scenario"],
  ["1942", "1942 Scenario"],
  ["1944", "1944 Scenario"],
] as const;

async function tapVisibleHighlight(page: Page, touch: boolean): Promise<boolean> {
  await page.evaluate(() => window.scrollTo(0, 0));
  const pt = await page.locator("svg.map").evaluate((svg) => {
    const box = svg.getBoundingClientRect();
    for (const h of svg.querySelectorAll("g.highlights polygon")) {
      const r = h.getBoundingClientRect();
      if (r.left > Math.max(box.left, 0) + 8 && r.right < Math.min(box.right, window.innerWidth) - 8 && r.top > Math.max(box.top, 0) + 8 && r.bottom < Math.min(box.bottom, window.innerHeight) - 8) {
        return [r.left + r.width / 2, r.top + r.height / 2] as const;
      }
    }
    return null;
  });
  if (!pt) return false;
  if (touch) await page.touchscreen.tap(pt[0], pt[1]);
  else await page.mouse.click(pt[0], pt[1]);
  return true;
}

for (const [id, label] of SCENARIOS) {
  for (const side of ["axis", "allies"] as const) {
    test(`${label}, ${side}: set up the first nation, then play into the next turn`, async ({ page, hasTouch }) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto("/");
      await page.locator("#scenario").selectOption(id);
      await page.locator("#side").selectOption(side);
      await page.locator("#newgame").click();
      await expect(page.locator(".setup h2")).toContainText("Your setup");

      // The first nation: one counter by hand.
      await page.locator(".setup button[data-spec]").first().click();
      const before = await page.locator("g.units > g").count();
      if (!(await tapVisibleHighlight(page, hasTouch))) {
        // No hex to tap: the counter goes in a box, and the panel says so.
        await expect(page.locator(".setup")).toContainText("goes in the U.S. Box");
        await page.locator("button[data-box]").first().click();
      }
      await expect(page.locator(".toast")).toBeEmpty();
      expect(await page.locator(".setup").innerText()).toContain("On the map: ");

      // The rest for me, nation after nation, until play begins.
      for (let i = 0; i < 12 && (await page.locator("#fill").count()); i++) await page.locator("#fill").click();
      await expect(page.locator(".turn")).toContainText("player turn");
      expect(await page.locator("g.units > g").count()).toBeGreaterThanOrEqual(before);

      // Play into the next Game Turn: always the last button, which moves the game on.
      const turn = async () => (await page.locator(".turn").innerText()).split("—")[0]!.trim();
      const start = await turn();
      for (let i = 0; i < 8 && (await turn()) === start; i++) await page.locator(".actions button[data-action]").last().click();
      expect(await turn()).not.toBe(start);

      expect(errors).toEqual([]);
    });
  }
}
