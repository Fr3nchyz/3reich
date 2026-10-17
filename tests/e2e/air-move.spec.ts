import { readFileSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * Planes and airbases at step 6f (spec 09, ticket 09-13) in a real browser, with a mouse and with a finger. The game is loaded at step 6f of the first
 * Axis Player Turn (the recorded game of tests/e2e/fixtures/axis-at-7h.json up to its first MOVE, the `?e2e` test hook, src/ui/e2eLoad.ts). The four
 * German 5-4 air counters stand at L31, M27, N26 and N29; ground stacks that can move stand at all of them but N29.
 */

type Pt = readonly [number, number];
const FIXTURE = JSON.parse(readFileSync("tests/e2e/fixtures/axis-at-7h.json", "utf8")) as { scenario: string; seed: number; actions: { type: string }[] };
const TO_6F = FIXTURE.actions.slice(0, FIXTURE.actions.findIndex((a) => a.type === "MOVE"));

async function load(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/?e2e");
  await page.evaluate((detail) => document.dispatchEvent(new CustomEvent("e2e-load", { detail })), { scenario: FIXTURE.scenario, side: "axis", seed: FIXTURE.seed, actions: TO_6F });
  await expect(page.locator(".turn")).toContainText("step 6f");
  return errors;
}

async function centreOf(page: Page, id: string): Promise<Pt> {
  await page.evaluate(() => window.scrollTo(0, 0));
  return page.locator(`svg.map polygon[data-id="${id}"]`).evaluate((p) => {
    const r = p.getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2] as const;
  });
}

const card = (page: Page) => page.locator(".planecard");
const rows = (page: Page) => page.locator("button[data-planebase]");
const baseRows = (page: Page) => page.locator("button[data-tobase]");
const clean = (s: string) => expect(s).not.toMatch(/\bu\d+\b/);

test("step 6f: a row of the planes list opens the card, a base row changes the base, and Take back last move undoes it", async ({ page, hasTouch }) => {
  const errors = await load(page);
  const press = (loc: Locator) => (hasTouch ? loc.tap() : loc.click());
  await expect(page.locator("#planes-title")).toHaveText("Planes at 4 bases");
  await expect(rows(page)).toHaveCount(4);
  await expect(rows(page).first()).toContainText("1 plane");
  await expect(card(page)).toHaveCount(0);

  await press(rows(page).first());
  await expect(card(page)).toBeVisible();
  await expect(card(page).locator("h2")).toContainText("Planes at ");
  await expect(card(page).locator('button.chip[aria-pressed="true"]')).toHaveCount(1);
  await expect(card(page)).toContainText("This base holds 5 of 5 air factors.");
  const n = await baseRows(page).count();
  expect(n).toBeGreaterThan(0);
  await expect(page.locator("g.highlights polygon")).toHaveCount(n);
  clean(await card(page).innerText());

  // The range ring: pale hexes appear and go.
  await press(page.locator("#plane-range"));
  await expect(page.locator("g.highlights polygon.further").first()).toBeAttached();
  await press(page.locator("#plane-range"));
  await expect(page.locator("g.highlights polygon.further")).toHaveCount(0);

  await press(baseRows(page).first());
  await expect(card(page)).toHaveCount(0);
  await expect(page.locator(".log li").filter({ hasText: "change base from" })).toHaveCount(1);
  await press(page.locator("#move-undo"));
  await expect(page.locator(".toast")).toContainText("Took back:");
  await expect(page.locator(".log li").filter({ hasText: "change base from" })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("step 6f: a tap on a base with planes and no stack that can move opens the card, a second tap closes it", async ({ page, hasTouch }) => {
  const errors = await load(page);
  const [x, y] = await centreOf(page, "N29");
  if (hasTouch) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
  await expect(card(page)).toBeVisible();
  await expect(card(page).locator("h2")).toContainText("(N29)");
  const [x2, y2] = await centreOf(page, "N29");
  if (hasTouch) await page.touchscreen.tap(x2, y2);
  else await page.mouse.click(x2, y2);
  await expect(card(page)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("step 6f: an airbase is placed from the list of places, the row counts down, and a split and a join work", async ({ page, hasTouch }) => {
  const errors = await load(page);
  const press = (loc: Locator) => (hasTouch ? loc.tap() : loc.click());
  await expect(page.locator('button[data-airowner="germany"]')).toContainText("Germany: 3 airbases left to place");
  await press(page.locator('button[data-airowner="germany"]'));
  await expect(page.locator(".airbasecard h2")).toHaveText("Place a Germany airbase");
  expect(await page.locator("g.highlights polygon").count()).toBeGreaterThan(0);
  await press(page.locator(".airbasecard summary"));
  await press(page.locator("button[data-placehex]").first());
  await expect(page.locator(".log li").filter({ hasText: "Germany places an airbase at" })).toHaveCount(1);
  await expect(page.locator('button[data-airowner="germany"]')).toContainText("Germany: 2 airbases left to place");

  await press(rows(page).first());
  await press(page.locator(".planecard details summary", { hasText: "Split the" }));
  await press(page.locator("button[data-parts]").first());
  await expect(card(page).locator("button.chip")).toHaveCount(2);
  await expect(page.locator("#plane-join")).toBeVisible();
  await press(page.locator("#plane-join"));
  await expect(card(page).locator("button.chip")).toHaveCount(1);
  expect(errors).toEqual([]);
});
