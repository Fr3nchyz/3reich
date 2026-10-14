import { expect, test } from "@playwright/test";

/** On a phone the map stays in view while the panels below it scroll: tapping a chip never loses the map. */

for (const [width, height] of [[390, 844], [420, 900]] as const) {
  test(`phone ${width}x${height}: the map stays on screen after scrolling down to the panels`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto("/");
    await page.locator("#newgame").click();
    await expect(page.locator(".setup h2")).toContainText("Your setup");
    const chip = page.locator(".setup button[data-spec]").first();
    await chip.scrollIntoViewIfNeeded();
    await chip.click();
    // Scroll well down through the panels: the map must still be on screen at the top.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const map = await page.locator(".map-wrap").boundingBox();
    expect(map, "the map is on screen with a chip chosen").not.toBeNull();
    expect(map!.y).toBeGreaterThanOrEqual(0);
    expect(map!.height).toBeGreaterThan(height * 0.4);
    expect(map!.height).toBeLessThan(height * 0.56);
    // The picked counter's places are still visible on the map without scrolling back up.
    await expect(page.locator("g.highlights polygon").first()).toBeInViewport();
    // Panels remain reachable below the map, and the toggle is a full-size touch target.
    const toggle = await page.locator("#overlay").boundingBox();
    expect(toggle!.height).toBeGreaterThanOrEqual(44);
    const docHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    expect(docHeight).toBeGreaterThan(height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}
