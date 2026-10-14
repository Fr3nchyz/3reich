import { expect, test, type Page } from "@playwright/test";

/** On a phone the map stays in view while the panels below it scroll: tapping a chip never loses the map. */

// Portrait phones, then landscape ones (the short ones are under 480 px tall, the wide ones still over 640 px wide).
const SIZES = [[360, 640], [390, 844], [420, 900], [844, 390], [932, 430], [640, 360], [568, 320]] as const;

async function startSetup(page: Page, width: number, height: number): Promise<void> {
  await page.setViewportSize({ width, height });
  await page.goto("/");
  await page.locator("#newgame").click();
  await expect(page.locator(".setup h2")).toContainText("Your setup");
}

for (const [width, height] of SIZES) {
  test(`phone ${width}x${height}: the map stays on screen after scrolling down to the panels`, async ({ page }) => {
    await startSetup(page, width, height);
    const chip = page.locator(".setup button[data-spec]").first();
    await chip.scrollIntoViewIfNeeded();
    await chip.click();
    // Scroll well down through the panels: the map must still be on screen at the top.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const dock = await page.locator(".map-dock").boundingBox();
    expect(dock, "the map is on screen with a chip chosen").not.toBeNull();
    expect(dock!.y).toBeGreaterThanOrEqual(0);
    expect(dock!.y).toBeLessThan(2);
    expect(dock!.height, "the map block is a share of the screen, not most of it").toBeLessThanOrEqual(height * (height < 480 ? 0.45 : 0.56));
    expect((await page.locator(".map-wrap").boundingBox())!.height).toBeGreaterThan(height * 0.3);
    await expect(page.locator("g.highlights polygon").first()).toBeInViewport();
    // The toggle is a full-size touch target; the page does not scroll sideways.
    expect((await page.locator("#overlay").boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}

test("focusing a control below the map scrolls it clear of the sticky map", async ({ page }) => {
  await startSetup(page, 390, 844);
  const last = page.locator("main button:visible, #status button:visible").last();
  await page.evaluate(() => window.scrollTo(0, 0));
  await last.focus();
  const dock = (await page.locator(".map-dock").boundingBox())!;
  const box = (await last.boundingBox())!;
  expect(box.y, "the focused control must not be hidden behind the map").toBeGreaterThanOrEqual(dock.y + dock.height - 1);
  // And from the other direction: focusing a control above the dock's height after scrolling down.
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const first = page.locator("#status button:visible").first();
  await first.focus();
  const again = (await first.boundingBox())!;
  expect(again.y).toBeGreaterThanOrEqual(dock.y + dock.height - 1);
});

for (const [width, height] of [[360, 640], [844, 390]] as const) {
  test(`${width}x${height}: a refused move is told over the map, with the panels scrolled out of sight`, async ({ page, hasTouch }) => {
    await startSetup(page, width, height);
    await page.locator(".setup button[data-spec]").first().click();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    // Tap a sea hex: no counter can go there.
    const spot = await page.locator("svg.map").evaluate((svg) => {
      const box = svg.getBoundingClientRect();
      for (const p of svg.querySelectorAll("g.hexes polygon.sea")) {
        const r = p.getBoundingClientRect();
        const x = r.left + r.width / 2, y = r.top + r.height / 2;
        if (x > box.left + 20 && x < box.right - 20 && y > box.top + 60 && y < box.bottom - 70 && !(x > box.right - 160 && y < box.top + 60)) return { x, y };
      }
      return null;
    });
    if (!spot) throw new Error("no sea hex is visible");
    if (hasTouch) await page.touchscreen.tap(spot.x, spot.y);
    else await page.mouse.click(spot.x, spot.y);
    const toast = page.locator("#maptoast");
    await expect(toast).toContainText("cannot go there");
    await expect(toast).toBeInViewport();
    await expect(toast).toBeVisible();
    const map = (await page.locator(".map-wrap").boundingBox())!;
    const t = (await toast.boundingBox())!;
    expect(t.y).toBeGreaterThanOrEqual(map.y);
    expect(t.y + t.height).toBeLessThanOrEqual(map.y + map.height);
  });
}
