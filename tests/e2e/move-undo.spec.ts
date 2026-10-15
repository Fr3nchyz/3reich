import { readFileSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * Take back last move (spec 10, ticket 10-6) in a real browser, with a mouse and with a finger. Same game as move-pick.spec.ts: step 6f of the first
 * Axis Player Turn, where J36 holds a 4-6 armor and a 3-3 infantry and O32 two 4-6 armor.
 */

type Pt = readonly [number, number];
const FIXTURE = JSON.parse(readFileSync("tests/e2e/fixtures/axis-at-7h.json", "utf8")) as { scenario: string; seed: number; actions: { type: string }[] };
const TO_6F = FIXTURE.actions.slice(0, FIXTURE.actions.findIndex((a) => a.type === "MOVE"));

async function load(page: Page, size?: Pt): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  if (size) await page.setViewportSize({ width: size[0], height: size[1] });
  await page.goto("/?e2e");
  await page.evaluate((detail) => document.dispatchEvent(new CustomEvent("e2e-load", { detail })), { scenario: FIXTURE.scenario, side: "axis", seed: FIXTURE.seed, actions: TO_6F });
  await expect(page.locator(".turn")).toContainText("step 6f");
  return errors;
}
const press = (loc: Locator, touch: boolean, force = false) => (touch ? loc.tap({ force }) : loc.click({ force }));
async function tapAt(page: Page, touch: boolean, pt: Pt): Promise<void> {
  if (touch) await page.touchscreen.tap(pt[0], pt[1]);
  else await page.mouse.click(pt[0], pt[1]);
}
const here = (page: Page, id: string): Promise<Pt> =>
  page.locator(`svg.map polygon[data-id="${id}"]`).evaluate((p) => {
    const r = p.getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2] as const;
  });
async function tapHexId(page: Page, touch: boolean, id: string): Promise<void> {
  await page.evaluate(() => window.scrollTo(0, 0));
  await tapAt(page, touch, await here(page, id));
}

const undo = (page: Page) => page.locator("#move-undo");
const moveLog = (page: Page) => page.locator(".log li").filter({ hasText: / move from / });
const stacksTitle = (page: Page) => page.locator("#stacks-title");

/** The id of a yellow hex with no stack of ours on it that is fully on screen, and where to tap it. */
async function emptyYellow(page: Page, avoid: readonly string[]): Promise<{ id: string; pt: Pt }> {
  const found = await page.locator("svg.map").evaluate((svg, skip) => {
    const box = svg.getBoundingClientRect();
    for (const h of svg.querySelectorAll("g.highlights polygon:not(.further)")) {
      const id = h.getAttribute("data-hl")!;
      const r = h.getBoundingClientRect();
      if (skip.includes(id) || r.left < Math.max(box.left, 0) + 8 || r.right > Math.min(box.right, window.innerWidth) - 8 || r.top < Math.max(box.top, 0) + 8 || r.bottom > Math.min(box.bottom, window.innerHeight) - 8) continue;
      return { id, pt: [r.left + r.width / 2, r.top + r.height / 2] as const };
    }
    return null;
  }, avoid);
  if (!found) throw new Error("no yellow hex is visible");
  return found as { id: string; pt: Pt };
}
const stackHexes = (page: Page) => page.locator("button.stack-row").evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.stack!));

/** Taps J36 or O32, optionally unticks the infantry, taps a yellow hex: one move. Returns where the units went. */
async function oneMove(page: Page, touch: boolean, from: string, untick: boolean): Promise<string> {
  const stacks = await stackHexes(page);
  await tapHexId(page, touch, from);
  if (untick) await press(page.locator("button.mline").filter({ hasText: "infantry" }), touch);
  const dest = await emptyYellow(page, stacks);
  await tapAt(page, touch, dest.pt);
  return dest.id;
}

test("the button is there and greyed with its reason; a move lights it; a press undoes it, cuts the log and says so in words", async ({ page, hasTouch }) => {
  const errors = await load(page);
  await expect(undo(page)).toBeVisible();
  await expect(undo(page)).toHaveText("Take back last move");
  await expect(undo(page)).toBeDisabled(); // aria-disabled counts
  await expect(page.locator("#move-undo-why")).toHaveText("Nothing to take back: no move made yet.");
  await press(undo(page), hasTouch, true); // greyed: does nothing
  await expect(moveLog(page)).toHaveCount(0);

  const logBefore = await page.locator(".log li").count();
  const dest = await oneMove(page, hasTouch, "J36", true);
  await expect(moveLog(page)).toHaveCount(1);
  await expect(undo(page)).toBeEnabled();
  await expect(page.locator("#move-undo-why")).toContainText("Last move: Moved 4-6 German armor from");
  await expect(stacksTitle(page)).toHaveCount(0); // the card is still open on the infantry left behind
  await press(undo(page), hasTouch);
  await expect(moveLog(page)).toHaveCount(0);
  await expect(page.locator(".log li")).toHaveCount(logBefore);
  await expect(page.locator(".toast")).toHaveText(new RegExp(`^Took back: Moved 4-6 German armor from .*J36\\) to .*${dest}`));
  await expect(page.locator("#maptoast")).toContainText("Took back: Moved 4-6 German armor");
  await expect(page.locator("#a11y-live")).toContainText("Took back: Moved 4-6 German armor");
  await expect(stacksTitle(page)).toHaveText("Stacks that can move (6)");
  await expect(page.locator(".movecard")).toHaveCount(0);
  await expect(undo(page)).toBeDisabled();
  await expect(page.locator("g.units g[data-at='J36']")).toHaveCount(2); // both counters are home again
  await expect(page.locator(`g.units g[data-at='${dest}']`)).not.toHaveCount(2); // the armor is not on the hex it was taken back from
  expect(errors).toEqual([]);
});

test("each press takes back one more move, the same move can be made again, and a move after a take back works", async ({ page, hasTouch }) => {
  await load(page);
  const logBefore = await page.locator(".log li").count();
  await oneMove(page, hasTouch, "O32", false);
  await expect(moveLog(page)).toHaveCount(1);
  await oneMove(page, hasTouch, "J36", false);
  await expect(moveLog(page)).toHaveCount(2);
  await expect(stacksTitle(page)).toHaveText("Stacks that can move (4)");
  const full = await page.locator(".log li").allInnerTexts();

  await press(undo(page), hasTouch);
  await expect(moveLog(page)).toHaveCount(1);
  await expect(stacksTitle(page)).toHaveText("Stacks that can move (5)");
  await expect(undo(page)).toBeEnabled();
  await press(undo(page), hasTouch);
  await expect(moveLog(page)).toHaveCount(0);
  await expect(page.locator(".log li")).toHaveCount(logBefore);
  await expect(stacksTitle(page)).toHaveText("Stacks that can move (6)");
  await expect(undo(page)).toBeDisabled();

  // Redo exactly the same two moves: the game and the log are the same as before the take backs.
  await oneMove(page, hasTouch, "O32", false);
  await oneMove(page, hasTouch, "J36", false);
  await expect(moveLog(page)).toHaveCount(2);
  expect(await page.locator(".log li").allInnerTexts()).toEqual(full);
});

test("Done with step 6f ends it: the button is gone with the step, and the next step has nothing to take back", async ({ page, hasTouch }) => {
  await load(page);
  await oneMove(page, hasTouch, "O32", false);
  await expect(undo(page)).toBeEnabled();
  await press(page.locator(".nextbar button[data-action]").last(), hasTouch);
  await expect(page.locator(".turn")).not.toContainText("step 6f");
  await expect(undo(page)).toHaveCount(0);
});

for (const size of [[1024, 768], [1180, 820], [768, 1024], [390, 844]] as const) {
  test(`${size[0]}x${size[1]}: the button is 44 px, on screen at step 6f and after a move, nothing scrolls sideways`, async ({ page, hasTouch }) => {
    await load(page, size);
    for (const state of ["at the start", "after a move"]) {
      if (state === "after a move") await oneMove(page, hasTouch, "J36", true);
      await expect(undo(page), `${state}: on screen`).toBeInViewport({ ratio: 1 });
      const box = (await undo(page).boundingBox())!;
      expect(box.height, `${state}: tall enough`).toBeGreaterThanOrEqual(44);
      expect(box.width, `${state}: wide enough`).toBeGreaterThanOrEqual(44);
      const bar = (await page.locator(".nextbar").boundingBox())!;
      expect(bar.y + bar.height, `${state}: not under the Next bar`).toBeLessThanOrEqual(box.y + 1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(size[0]);
    }
    await press(undo(page), hasTouch);
    await expect(undo(page)).toBeDisabled();
    await expect(undo(page)).toBeInViewport({ ratio: 1 });
  });
}

test("watch mode shows no button", async ({ page }) => {
  await page.goto("/");
  await page.locator("#scenario").selectOption("1939");
  await page.locator("#side").selectOption("watch");
  await page.locator("#newgame").click();
  await expect(page.locator(".watch-panel")).toBeVisible();
  await expect(undo(page)).toHaveCount(0);
});
