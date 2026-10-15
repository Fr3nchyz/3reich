import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * The zoom target button (spec 08, As built): with a hex shown on the hex card it centres and zooms on that hex; with nothing
 * selected it shows a readable line on the map for a few seconds, without moving anything. Run with a mouse and with a touch screen.
 */

type Rect = { x: number; y: number; width: number; height: number };
const NOTE_MS = 4000;

async function startPlay(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/");
  await page.locator("#newgame").click();
  for (let i = 0; i < 12 && (await page.locator("#fill").count()); i++) await page.locator("#fill").click();
  await expect(page.locator(".turn")).toContainText("step 1");
  await page.evaluate(() => document.getElementById("wholemap")!.click());
}

const box = async (l: Locator): Promise<Rect> => (await l.boundingBox())!;
const viewBox = (page: Page) => page.locator("svg.map").evaluate((svg) => svg.getAttribute("viewBox")!.split(" ").map(Number) as [number, number, number, number]);
const target = (page: Page) => page.locator('#zoom button[data-zoom="selected"]');

test("a tapped hex is centred and zoomed on by the target button", async ({ page, hasTouch }) => {
  await startPlay(page);
  const whole = await viewBox(page);
  const hex = await box(page.locator('svg.map polygon[data-id="M35"]'));
  const [x, y] = [hex.x + hex.width / 2, hex.y + hex.height / 2];
  if (hasTouch) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
  await expect(page.locator(".hexcard")).toBeVisible();
  await expect(page.locator("g.highlights polygon")).toHaveCount(0);
  expect(await viewBox(page), "tapping a hex alone does not move the map").toEqual(whole);

  if (hasTouch) await target(page).tap();
  else await target(page).click();
  await expect(page.locator("#zoomsay")).toHaveText("Zoomed to the hex Warsaw (M35)");
  const zoomed = await viewBox(page);
  expect(zoomed[2], "zoomed in a good deal").toBeLessThan(whole[2] / 3);
  const svg = await box(page.locator("svg.map"));
  const now = await box(page.locator('svg.map polygon[data-id="M35"]'));
  expect(Math.abs(now.x + now.width / 2 - (svg.x + svg.width / 2)), "centred sideways").toBeLessThan(svg.width * 0.1);
  expect(Math.abs(now.y + now.height / 2 - (svg.y + svg.height / 2)), "centred up and down").toBeLessThan(svg.height * 0.1);
  await expect(page.locator("#zoomnote"), "no warning when the map moved").toBeHidden();
});

test("with nothing selected the target button shows a readable line for a few seconds and moves nothing", async ({ page, hasTouch }) => {
  await page.clock.install();
  await startPlay(page);
  await expect(page.locator(".hexcard")).toHaveCount(0);
  await page.clock.pauseAt(new Date(Date.now() + 60_000)); // the page's timers now move only when this test says so
  const before = { view: await viewBox(page), map: await box(page.locator(".map-wrap")), status: await box(page.locator("#status")) };
  if (hasTouch) await target(page).tap();
  else await target(page).click();
  const note = page.locator("#zoomnote");
  await expect(note).toBeVisible();
  await expect(note).toHaveText("Nothing is selected. Choose one of your counters first.");
  await page.clock.fastForward(100); // the screen reader line is set a moment after it is cleared
  await expect(page.locator("#zoomsay")).toContainText("Nothing is selected");
  expect(await note.evaluate((e) => parseFloat(getComputedStyle(e).fontSize)), "readable").toBeGreaterThanOrEqual(14);
  const n = await box(note);
  const map = await box(page.locator(".map-wrap"));
  expect(n.x >= map.x && n.x + n.width <= map.x + map.width && n.y >= map.y && n.y + n.height <= map.y + map.height, "inside the map frame").toBe(true);
  for (const b of await page.locator("#zoom button").all()) {
    const r = await box(b);
    expect(n.x < r.x + r.width && r.x < n.x + n.width && n.y < r.y + r.height && r.y < n.y + n.height, "clear of the zoom buttons").toBe(false);
  }
  expect(await viewBox(page), "the map stayed where it was").toEqual(before.view);
  expect(await box(page.locator(".map-wrap")), "no layout shift").toEqual(before.map);
  expect(await box(page.locator("#status"))).toEqual(before.status);

  await page.clock.fastForward(NOTE_MS - 500);
  await expect(note, "still there before the time is up").toBeVisible();
  await page.clock.fastForward(1000);
  await expect(note).toBeHidden();
  expect(await box(page.locator(".map-wrap")), "no layout shift when it goes").toEqual(before.map);
});

const SIZES = [[1024, 768], [1180, 820], [768, 1024], [390, 844], [844, 390], [568, 320]] as const;
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

for (const [width, height] of SIZES) {
  test(`${width}x${height}: the nothing-selected line never covers the key, the buttons, the refused-move line or the zoom buttons`, async ({ page, hasTouch }) => {
    await page.setViewportSize({ width, height });
    await page.goto("/");
    await page.locator("#newgame").click();
    for (let i = 0; i < 12 && (await page.locator("#fill").count()); i++) await page.locator("#fill").click();
    await expect(page.locator(".turn")).toContainText("step 1");
    await page.evaluate(() => document.getElementById("wholemap")!.click());
    await page.locator("#overlay").click(); // the key on
    await expect(page.locator("#legend")).toBeVisible();
    await page.evaluate(() => { document.getElementById("maptoast")!.textContent = "That stack cannot get there. The yellow hexes are the places it can."; });
    if (hasTouch) await target(page).tap();
    else await target(page).click();
    const note = page.locator("#zoomnote");
    await expect(note).toBeVisible();
    await expect(note).toHaveText("Nothing is selected. Choose one of your counters first.");
    const n = await box(note);
    const map = await box(page.locator(".map-wrap"));
    expect(n.x >= map.x - 0.5 && n.x + n.width <= map.x + map.width + 0.5 && n.y >= map.y - 0.5 && n.y + n.height <= map.y + map.height + 0.5, "inside the map frame").toBe(true);
    const others = ["#legend", "#overlay", "#maptoast", "#zoom button:nth-child(1)", "#zoom button:nth-child(2)", "#zoom button:nth-child(3)", "#zoom button:nth-child(4)"];
    for (const sel of others) {
      const r = await page.locator(sel).boundingBox(); // null: not shown, so not covered
      if (r) expect(overlaps(n, r), `clear of ${sel}`).toBe(false);
      if (sel === "#maptoast" && height >= 390) expect(r, "the refused-move line is still shown where the map has room").not.toBeNull();
    }
  });
}
