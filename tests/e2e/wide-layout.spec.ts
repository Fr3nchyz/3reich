import { expect, test, type Page } from "@playwright/test";

/**
 * On tablets and desktops the map stays on screen while the panels are used: two columns when the screen is
 * wide and landscape (each column scrolls on its own), the phone's pinned map otherwise. And the activity log
 * lists the newest entry first and keeps its scroll position when the panels are redrawn.
 */

const TABLETS_AND_DESKTOPS = [[768, 1024], [1024, 768], [1180, 820], [1280, 800], [1920, 1080], [1024, 600]] as const;
/** The widths and heights from which the page is two columns (mirrors the media query in style.css). */
const twoColumns = (w: number, h: number) => w >= 900 && h > 480 && w / h >= 1.25;

async function startSetup(page: Page, width: number, height: number): Promise<void> {
  await page.setViewportSize({ width, height });
  await page.goto("/");
  await page.locator("#newgame").click();
  await expect(page.locator(".setup h2")).toContainText("Your setup");
}

/** Scrolls whatever scrolls the panels (the page, or the side column) to its very end. */
const scrollPanelsToEnd = (page: Page) =>
  page.evaluate(() => {
    window.scrollTo(0, document.documentElement.scrollHeight);
    const status = document.getElementById("status")!;
    status.scrollTop = status.scrollHeight;
  });

for (const [width, height] of TABLETS_AND_DESKTOPS) {
  test(`${width}x${height}: the map stays on screen with the panels scrolled to the bottom, and a tap on it works`, async ({ page, hasTouch }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await startSetup(page, width, height);
    await page.locator(".setup button[data-spec]").first().click();
    await scrollPanelsToEnd(page);

    const dock = (await page.locator(".map-dock").boundingBox())!;
    expect(dock.y, "the map block is not scrolled off the top").toBeGreaterThanOrEqual(0);
    expect(dock.y + dock.height, "and ends inside the screen").toBeLessThanOrEqual(height + 1);
    const wrap = (await page.locator(".map-wrap").boundingBox())!;
    expect(wrap.height, "the map is a real share of the screen").toBeGreaterThan(height * 0.3);
    await expect(page.locator("g.highlights polygon").first()).toBeInViewport();
    expect((await page.locator("#overlay").boundingBox())!.height, "touch target").toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);

    if (twoColumns(width, height)) {
      const status = (await page.locator("#status").boundingBox())!;
      expect(status.x, "the panels are in a column beside the map").toBeGreaterThanOrEqual(dock.x + dock.width - 1);
      expect(await page.evaluate(() => document.documentElement.scrollHeight), "the page itself does not scroll").toBeLessThanOrEqual(height);
      expect(await page.evaluate(() => document.getElementById("status")!.scrollTop), "the side column did scroll").toBeGreaterThan(0);
    } else {
      expect(dock.y, "pinned to the top").toBeLessThan(2);
      expect(dock.height, "the map block is a share of the screen, not most of it").toBeLessThanOrEqual(height * 0.56);
    }

    // A tap on a highlighted hex still places the counter, with the panels scrolled away.
    const spot = await page.locator("svg.map").evaluate((svg) => {
      const box = svg.getBoundingClientRect();
      for (const hl of svg.querySelectorAll("g.highlights polygon")) {
        const r = hl.getBoundingClientRect();
        if (r.left > Math.max(box.left, 0) + 8 && r.right < Math.min(box.right, innerWidth) - 8 && r.top > Math.max(box.top, 0) + 8 && r.bottom < Math.min(box.bottom, innerHeight) - 60) {
          return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        }
      }
      return null;
    });
    if (!spot) throw new Error("no highlighted hex is visible");
    const before = await page.locator("g.units > g").count();
    if (hasTouch) await page.touchscreen.tap(spot.x, spot.y);
    else await page.mouse.click(spot.x, spot.y);
    await expect(page.locator("g.units > g")).toHaveCount(before + 1);
    expect(errors).toEqual([]);
  });
}

test("1280x800: the panel column and the map scroll on their own; the map toast and legend stay over the map", async ({ page, hasTouch }) => {
  await startSetup(page, 1280, 800);
  await page.locator(".setup button[data-spec]").first().click();
  await scrollPanelsToEnd(page);
  const tap = async () => (hasTouch ? page.locator("#overlay").tap() : page.locator("#overlay").click());
  await tap();
  const map = (await page.locator(".map-wrap").boundingBox())!;
  const legend = (await page.locator("#legend").boundingBox())!;
  expect(legend.y).toBeGreaterThanOrEqual(map.y);
  expect(legend.x + legend.width).toBeLessThanOrEqual(map.x + map.width);
  await tap();
  // A refused tap (a sea hex) is told in the line over the map.
  const sea = await page.locator("svg.map").evaluate((svg) => {
    const box = svg.getBoundingClientRect();
    for (const p of svg.querySelectorAll("g.hexes polygon.sea")) {
      const r = p.getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      if (x > box.left + 200 && x < box.right - 200 && y > box.top + 150 && y < box.bottom - 150) return { x, y };
    }
    return null;
  });
  if (!sea) throw new Error("no sea hex is visible");
  if (hasTouch) await page.touchscreen.tap(sea.x, sea.y);
  else await page.mouse.click(sea.x, sea.y);
  await expect(page.locator("#maptoast")).toContainText("cannot go there");
  await expect(page.locator("#maptoast")).toBeInViewport();
});

for (const [width, height] of [[1280, 800], [768, 1024], [390, 844]] as const) {
  test(`${width}x${height}: the log lists the newest entry first and keeps its scroll position when the panels redraw`, async ({ page }) => {
    await startSetup(page, width, height);
    // A short log box, so that the few entries of a new game overflow it.
    await page.addStyleTag({ content: ".log { max-height: 3rem !important; }" });
    const log = page.locator("ol.log");
    await expect(log.locator("li").last()).toContainText("started");
    await log.evaluate((el) => { el.scrollTop = el.scrollHeight; });
    const top = await log.evaluate((el) => el.scrollTop);
    expect(top, "the log box scrolls").toBeGreaterThan(0);
    // The entry at the bottom of the box, and where it sits in the box.
    const place = () => log.evaluate((el) => {
      const items = [...el.querySelectorAll("li")];
      const last = items[items.length - 1]!;
      return { text: last.textContent, offset: Math.round(last.getBoundingClientRect().top - el.getBoundingClientRect().top) };
    });
    const before = await place();

    // Place the rest of a nation (it is then done): the status area is redrawn and a new entry is logged at the top.
    await page.locator("#fill").click();
    await expect(log.locator("li").first()).toContainText("has set up");
    const after = await place();
    expect(after.text).toBe(before.text);
    expect(Math.abs(after.offset - before.offset), "the entry being read has not moved in the box (give or take a rounded pixel)").toBeLessThanOrEqual(2);
    expect(await log.evaluate((el) => el.scrollTop)).toBeGreaterThan(top);

    // At the top, the reader follows the newest entries.
    await log.evaluate((el) => { el.scrollTop = 0; });
    const count = await log.locator("li").count();
    await page.locator("#newgame").click();
    await expect(log.locator("li").last()).toContainText("started");
    expect(await log.evaluate((el) => el.scrollTop)).toBe(0);
    expect(await log.locator("li").count()).toBeLessThanOrEqual(count);
  });
}
