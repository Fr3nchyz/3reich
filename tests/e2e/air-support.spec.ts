import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

/**
 * Choosing planes for ground support at step 7b (spec 09, ticket 09-14) in a real browser, with a mouse and with a finger. The game is the recorded
 * game of tests/e2e/fixtures/axis-at-7h.json up to its end of step 6f, with two German planes changed to bases near Poland first (STAGE_AIR through
 * the `?e2e` test hook, src/ui/e2eLoad.ts): a 5-4 at O32 that reaches Warsaw (M35) and Krakow (P33), and a 5-4 at K33 that reaches Warsaw.
 */

type Pt = readonly [number, number];
const FIXTURE = JSON.parse(readFileSync("tests/e2e/fixtures/axis-at-7h.json", "utf8")) as { scenario: string; seed: number; actions: { type: string; step?: string }[] };
const TO_END_OF_6F = FIXTURE.actions.slice(0, FIXTURE.actions.length - 1); // everything but END_STEP 6f
const STAGE = [
  { type: "STAGE_AIR", side: "axis", units: ["u107"], to: "O32" },
  { type: "STAGE_AIR", side: "axis", units: ["u108"], to: "K33" },
  { type: "END_STEP", side: "axis", step: "6f" },
];

async function load(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/?e2e");
  await page.evaluate((detail) => document.dispatchEvent(new CustomEvent("e2e-load", { detail })), { scenario: FIXTURE.scenario, side: "axis", seed: FIXTURE.seed, actions: [...TO_END_OF_6F, ...STAGE] });
  await expect(page.locator(".turn")).toContainText("step 7b");
  return errors;
}

async function tapAt(page: Page, touch: boolean, pt: Pt): Promise<void> {
  if (touch) await page.touchscreen.tap(pt[0], pt[1]);
  else await page.mouse.click(pt[0], pt[1]);
}
async function centreOf(page: Page, id: string): Promise<Pt> {
  await page.evaluate(() => window.scrollTo(0, 0));
  return page.locator(`svg.map polygon[data-id="${id}"]`).evaluate((p) => {
    const r = p.getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2] as const;
  });
}

const card = (page: Page) => page.locator(".aircard");
const rows = (page: Page) => page.locator("button.air-row");
const planes = (page: Page) => card(page).locator("button.chip");
const go = (page: Page) => page.locator("#air-go");
const clean = (s: string) => expect(s).not.toMatch(/\bu\d+\b/);

test("step 7b: a row opens the card, a plane chip changes the button, Commit sends only that plane, and the attack card lists it", async ({ page, hasTouch }) => {
  const errors = await load(page);
  const press = (loc: ReturnType<Page["locator"]>) => (hasTouch ? loc.tap() : loc.click());
  await expect(page.locator(".air-support h2").first()).toHaveText("Air support you can add (2)");
  await expect(rows(page)).toHaveCount(2);
  await expect(rows(page).first()).toContainText("Warsaw (M35)");
  await expect(rows(page).first()).toContainText("2 planes in range (10 air factors)");
  await expect(page.locator("g.attack-marks .mk-target")).toHaveCount(2);
  await expect(card(page)).toHaveCount(0);
  await expect(page.locator(".nextbar")).toContainText("Done with step 7b");

  await press(rows(page).first());
  await expect(card(page)).toBeVisible();
  await expect(card(page).locator("h2")).toHaveText("Air support for Warsaw (M35)");
  await expect(planes(page)).toHaveCount(2);
  await expect(card(page).locator('button.chip[aria-pressed="true"]')).toHaveCount(2);
  await expect(go(page)).toHaveText("Commit 2 planes (10 air factors) to Warsaw (M35)");
  await expect(page.locator("g.attack-marks .mk-chosen")).toHaveCount(1);
  clean(await card(page).innerText());

  await press(planes(page).last());
  await expect(card(page).locator('button.chip[aria-pressed="true"]')).toHaveCount(1);
  await expect(go(page)).toHaveText("Commit 1 plane (5 air factors) to Warsaw (M35)");
  await press(go(page));
  await expect(card(page)).toHaveCount(0);
  await expect(page.locator(".log li").filter({ hasText: "fly ground support to Warsaw (M35)" })).toHaveCount(1);
  await expect(rows(page).first()).toContainText("5 air factors already committed");

  await press(page.locator(".nextbar button", { hasText: "Done with step 7b" }));
  await expect(page.locator(".turn")).toContainText("step 7h");
  await expect(page.locator(".air-warn")).toContainText("Air is committed to Warsaw (M35)");
  await tapAt(page, hasTouch, await centreOf(page, "M35"));
  await expect(page.locator(".attackcard .air-plane")).toHaveCount(1);
  await expect(page.locator(".attackcard .air-plane")).toContainText("Counts in this attack");
  await expect(page.locator(".attackcard .odds")).toContainText("in the air");
  expect(errors).toEqual([]);
});

test("step 7b: a tap on a hex of the map opens the card, a second tap closes it, and Cancel commits nothing", async ({ page, hasTouch }) => {
  const errors = await load(page);
  await tapAt(page, hasTouch, await centreOf(page, "P33"));
  await expect(card(page).locator("h2")).toHaveText("Air support for Krakow (P33)");
  await expect(planes(page)).toHaveCount(1);
  await tapAt(page, hasTouch, await centreOf(page, "P33"));
  await expect(card(page)).toHaveCount(0);
  await tapAt(page, hasTouch, await centreOf(page, "M35"));
  await expect(card(page)).toBeVisible();
  await (hasTouch ? page.locator("#air-cancel").tap() : page.locator("#air-cancel").click());
  await expect(card(page)).toHaveCount(0);
  await expect(page.locator(".log li").filter({ hasText: "ground support" })).toHaveCount(0);
  expect(errors).toEqual([]);
});
