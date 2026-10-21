import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

/**
 * The victory screens (spec 14, ticket 14-4; docs/specs/14-victory-surrender-winter.md part D) in a real browser, with a mouse and with a finger:
 * the score line under the turn line, the "Victory and objectives" card (42 Objectives, a tap on a name centres the map), the shapes that mark who
 * holds each Objective on the map, and the result card of a finished game (a dialog the heading of which has the focus; "Look at the map",
 * "Read the log", "New game"; the status line). The finished game is a recorded one (tests/e2e/fixtures/ended-1939.json, the `?e2e` test hook):
 * the 1939 scenario cut to its first Game Turn.
 */

const ENDED = JSON.parse(readFileSync("tests/e2e/fixtures/ended-1939.json", "utf8")) as { scenario: string; seed: number; end: unknown; actions: unknown[] };
type Size = readonly [number, number];
const SIZES: readonly Size[] = [[1024, 768], [768, 1024], [1180, 820], [1400, 1000], [390, 844], [844, 390], [568, 320]];

async function startPlay(page: Page, size?: Size): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  if (size) await page.setViewportSize({ width: size[0], height: size[1] });
  await page.goto("/");
  await page.locator("#scenario").selectOption("1939");
  await page.locator("#side").selectOption("axis");
  await page.locator("#newgame").click();
  for (let i = 0; i < 12 && (await page.locator("#fill").count()); i++) await page.locator("#fill").click();
  await expect(page.locator(".turn")).toContainText("step 1");
  return errors;
}

async function loadEnded(page: Page, size?: Size): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  if (size) await page.setViewportSize({ width: size[0], height: size[1] });
  await page.goto("/?e2e");
  await page.evaluate((detail) => document.dispatchEvent(new CustomEvent("e2e-load", { detail })), { scenario: ENDED.scenario, side: "axis", seed: ENDED.seed, end: ENDED.end, actions: ENDED.actions });
  await expect(page.locator(".turn")).toContainText("Game over");
  return errors;
}

/** The text of the map's viewBox, which changes when the map is centred or zoomed. */
const viewBox = (page: Page) => page.locator("svg.map").getAttribute("viewBox");

test("the score line shows the three counts, and the Objectives card lists 42 Objectives with who holds each", async ({ page }) => {
  const errors = await startPlay(page);
  await expect(page.locator(".score-line")).toHaveText("Objectives held: Axis 9, Allies 23, nobody 10");
  const open = page.locator("#obj-open");
  await expect(open).toHaveText("Victory and objectives");
  expect((await open.boundingBox())!.height, "touch target").toBeGreaterThanOrEqual(44);
  await expect(page.locator("#obj-card")).toHaveCount(0);
  await open.click();
  const card = page.locator("#obj-card");
  await expect(card).toBeVisible();
  await expect(page.locator("#obj-title")).toBeFocused();
  await expect(card).toHaveAttribute("aria-labelledby", "obj-title");
  await expect(card.locator("h3").filter({ hasText: "Front (14)" })).toHaveCount(3);
  await expect(card.locator("button.obj-row")).toHaveCount(42);
  await expect(card.locator("button.obj-row", { hasText: "Berlin" })).toContainText("Axis");
  await expect(card.locator("button.obj-row", { hasText: "Moscow" })).toContainText("Allies");
  await expect(card.locator("button.obj-row", { hasText: "Antwerp" })).toContainText("nobody");
  await expect(card).toContainText("Allies: 15 = Marginal, 16 = Tactical, 17 = Decisive");
  await expect(card).toContainText("Axis: 25 = Marginal, 26 = Tactical, 27 = Decisive");
  for (const row of await card.locator("button.obj-row").all()) expect((await row.boundingBox())!.height, "each row is a touch target").toBeGreaterThanOrEqual(44);
  expect((await page.locator("#obj-close").boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await page.locator("#obj-close").click();
  await expect(card).toHaveCount(0);
  await expect(open).toBeFocused();
  expect(errors).toEqual([]);
});

test("the Escape key closes the Objectives card and gives the focus back to its button", async ({ page, hasTouch }) => {
  test.skip(hasTouch, "a keyboard test");
  await startPlay(page);
  await page.locator("#obj-open").click();
  await expect(page.locator("#obj-title")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator("#obj-card")).toHaveCount(0);
  await expect(page.locator("#obj-open")).toBeFocused();
});

test("a tap on a name in the card centres the map on that Objective", async ({ page }) => {
  await startPlay(page);
  await page.locator("#obj-open").click();
  const before = await viewBox(page);
  await page.locator("button.obj-row", { hasText: "Stalingrad" }).click();
  await expect.poll(() => viewBox(page)).not.toBe(before);
  const after = await viewBox(page);
  await page.locator("button.obj-row", { hasText: "London" }).click();
  await expect.poll(() => viewBox(page)).not.toBe(after);
});

test("the map marks every Objective by its holder with a shape: square, circle, dashed ring", async ({ page }) => {
  await startPlay(page);
  await expect(page.locator("svg.map g.objective-marks .obj-mark")).toHaveCount(42);
  await expect(page.locator('svg.map rect.obj-mark[data-holder="axis"]')).toHaveCount(9);
  await expect(page.locator('svg.map circle.obj-mark[data-holder="allies"]')).toHaveCount(23);
  await expect(page.locator('svg.map circle.obj-mark[data-holder="nobody"]')).toHaveCount(10);
  const dash = await page.locator('svg.map circle.obj-mark[data-holder="nobody"]').first().evaluate((c) => getComputedStyle(c).strokeDasharray);
  expect(dash, "the ring is dashed").not.toBe("none");
  await page.locator("#obj-open").click();
  await expect(page.locator(".objcard-key")).toContainText("a square is an Objective the Axis holds");
});

for (const size of SIZES) {
  test(`${size[0]}x${size[1]}: a finished game shows the result card as a dialog, wholly on screen, with the heading in focus`, async ({ page }) => {
    const errors = await loadEnded(page, size);
    const dialog = page.locator("#end-card");
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("role", "dialog");
    await expect(dialog).toHaveAttribute("aria-modal", "true");
    await expect(page.locator("#end-title")).toBeFocused();
    await expect(page.locator("#end-title")).toHaveText("Allied Decisive Victory");
    await expect(dialog).toContainText("(a complete win for the Allies)");
    await expect(dialog).toContainText("The scenario ended after Fall 1939.");
    await expect(dialog).toContainText("Objectives held: Axis 9, Allies 23, nobody 10");
    await expect(dialog).toContainText("The Allies needed 17 for a Decisive victory.");
    const box = (await dialog.boundingBox())!;
    expect(box.x, "inside the screen, left").toBeGreaterThanOrEqual(0);
    expect(box.y, "inside the screen, top").toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, "inside the screen, right").toBeLessThanOrEqual(size[0] + 1);
    expect(box.y + box.height, "inside the screen, bottom").toBeLessThanOrEqual(size[1] + 1);
    for (const id of ["end-look", "end-log", "end-new"]) {
      const b = page.locator(`#${id}`);
      await expect(b).toBeInViewport();
      expect((await b.boundingBox())!.height, `${id} is a touch target`).toBeGreaterThanOrEqual(44);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth), "no sideways scroll").toBeLessThanOrEqual(size[0]);
    expect(errors).toEqual([]);
  });
}

test("the status line names the verdict; 'Look at the map' puts the card away and the map still answers a tap", async ({ page }) => {
  await loadEnded(page);
  await expect(page.locator(".turn")).toHaveText("Game over: Allied Decisive Victory");
  await page.locator("#end-look").click();
  await expect(page.locator("#end-card")).toHaveCount(0);
  await expect(page.locator(".turn")).toHaveText("Game over: Allied Decisive Victory");
  await expect(page.locator("#end-show")).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  const pt = await page.locator('svg.map polygon[data-id="L31"]').evaluate((p) => {
    const r = p.getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2] as const;
  });
  await page.mouse.click(pt[0], pt[1]);
  await expect(page.locator(".hexcard")).toBeVisible();
  await page.locator("#end-show").click();
  await expect(page.locator("#end-card")).toBeVisible();
  await expect(page.locator("#end-title")).toBeFocused();
});

test("the Escape key puts the card away", async ({ page, hasTouch }) => {
  test.skip(hasTouch, "a keyboard test");
  await loadEnded(page);
  await page.keyboard.press("Escape");
  await expect(page.locator("#end-card")).toHaveCount(0);
});

test("'Read the log' puts the card away and takes the reader to the log, which names the result", async ({ page }) => {
  await loadEnded(page);
  await page.locator("#end-log").click();
  await expect(page.locator("#end-card")).toHaveCount(0);
  await expect(page.locator("ol.log")).toBeFocused();
  await expect(page.locator("ol.log li", { hasText: "Allied Decisive Victory. Objectives held: Axis 9, Allies 23, nobody 10." })).toHaveCount(1);
});

test("'New game' starts again from the title screen's own button", async ({ page }) => {
  await loadEnded(page);
  await page.locator("#end-new").click();
  await expect(page.locator("#end-card")).toHaveCount(0);
  await expect(page.locator(".turn")).not.toContainText("Game over");
  await expect(page.locator(".setup h2")).toContainText("Your setup");
});

test("the Tab key stays inside the open result card", async ({ page, hasTouch }) => {
  test.skip(hasTouch, "a keyboard test");
  await loadEnded(page);
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => document.activeElement?.closest("#end-card") !== null)).toBe(true);
});
