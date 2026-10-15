import { readFileSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * Spec 07, ticket 07-7: the result, "Choose your losses" and "Advance into <place>?" cards in one sequence, with a mouse and with a finger.
 * The game is loaded at step 7h of the first Axis Player Turn (tests/e2e/fixtures/axis-at-7h.json, the e2e build's test-only loader); the position is
 * the same for every seed, only the dice differ. Seed 27 at Warsaw (M35): column 1-2, a Counterattack, then an Exchange the Axis player settles
 * (the armor, or both infantry), then the hex is empty and the survivors may advance. Seed 4 at Krakow (P33): the defenders are eliminated at once.
 */

type Pt = readonly [number, number];
const FIXTURE = JSON.parse(readFileSync("tests/e2e/fixtures/axis-at-7h.json", "utf8")) as { scenario: string; actions: unknown[] };

async function load(page: Page, seed: number, size?: Pt): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  if (size) await page.setViewportSize({ width: size[0], height: size[1] });
  await page.goto("/?e2e");
  await page.evaluate((detail) => document.dispatchEvent(new CustomEvent("e2e-load", { detail })), { scenario: FIXTURE.scenario, side: "axis", seed, actions: FIXTURE.actions });
  await expect(page.locator(".turn")).toContainText("step 7h");
  return errors;
}

async function tapHexId(page: Page, touch: boolean, id: string): Promise<void> {
  await page.evaluate(() => window.scrollTo(0, 0));
  const [x, y] = await page.locator(`svg.map polygon[data-id="${id}"]`).evaluate((p) => {
    const r = p.getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2] as const;
  });
  if (touch) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
}

/** Whether a control is wholly on screen and nothing (the pinned map, the Next bar) covers its middle: a finger can press it without scrolling. */
async function reachable(loc: Locator): Promise<boolean> {
  return loc.evaluate((el) => {
    const b = el.getBoundingClientRect();
    const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
    return b.top >= 0 && b.bottom <= window.innerHeight && b.left >= 0 && b.right <= window.innerWidth && hit !== null && (el === hit || el.contains(hit));
  });
}
const expectReachable = async (loc: Locator, what: string) => expect(await reachable(loc), `${what} can be pressed without scrolling`).toBe(true);

/** Scrolls the status column (two columns) and the page (pinned map) as far down as they go: the player read a long card and pressed its last button. */
const scrollDown = (page: Page) => page.evaluate(() => { document.getElementById("status")!.scrollTop = 1e6; window.scrollTo(0, 1e6); });

const text = (page: Page) => page.locator("main").innerText();
const clean = (s: string) => expect(s).not.toMatch(/\bu\d+\b/);
const done = (page: Page) => page.getByRole("button", { name: "Done with step 7h", exact: true });
const loss = (page: Page) => page.locator(".losscard");
const advance = (page: Page) => page.locator(".advancecard");

/** Opens Warsaw from the list, presses the one attack button; the Exchange then waits for the player's losses. */
async function attackWarsaw(page: Page): Promise<void> {
  await page.locator('button.attack-row[data-target="M35"]').click();
  await expect(page.locator(".attackcard")).toBeVisible();
  await scrollDown(page);
  await page.locator("#attack-go").click();
  await expect(loss(page)).toBeVisible();
}

test("attack, result, losses, advance, done: one sequence, the next thing first, no hunting", async ({ page, hasTouch }) => {
  const errors = await load(page, 27);
  await tapHexId(page, hasTouch, "M35");
  await expect(page.locator(".attackcard h2")).toHaveText("Attack on Warsaw (M35)");
  await scrollDown(page);
  await page.locator("#attack-go").click();

  // The result card and the losses card; the losses card (what the game waits for) is first, right under the Next bar, with focus.
  await expect(page.locator(".nextbar .next-text")).toHaveText("Next: choose your losses.");
  await expect(loss(page).locator("h2")).toHaveText("Choose your losses");
  await expect(loss(page).locator("h2")).toBeFocused();
  await expect(page.locator(".resultcard")).toContainText("Their counterattack, column 1-3, roll 1: Exchange.");
  const tops = await page.evaluate(() => [".nextbar", ".losscard", ".resultcard", ".attacklist"].map((s) => document.querySelector(s)?.getBoundingClientRect().top ?? 1e9));
  expect([...tops].sort((a, b) => a - b), "bar, losses, result, then the list").toEqual(tops);
  expect(await text(page)).not.toMatch(/\babove\b|\bbelow\b/);
  clean(await text(page));
  await expect(done(page), "the engine holds the step until the losses are chosen").toHaveCount(0);
  await expect(loss(page)).toContainText("at least 4 factors");
  await expect(loss(page).locator("button.way")).toHaveText([/Lose 4-6 German armor \(4 factors\)/, /Lose 2 x 3-3 German infantry \(6 factors\)/]);
  await expect(loss(page).locator("button.pick")).toHaveCount(3);
  await expect(loss(page).locator(".total")).toHaveText("Chosen 0 of at least 4 factors: 4 more needed.");
  await expect(page.locator("#loss-go")).toBeDisabled();
  await expect(page.locator("#loss-go")).toHaveText("Choose 4 more factors to lose");

  // Chips and a running total: one infantry is not enough, two are; the armor alone is.
  await loss(page).locator("button.pick", { hasText: "3-3 German infantry" }).first().click();
  await expect(loss(page).locator(".total")).toHaveText("Chosen 3 of at least 4 factors: 1 more needed.");
  await expect(page.locator("#loss-go")).toBeDisabled();
  await loss(page).locator("button.pick", { hasText: "4-6 German armor" }).click();
  await expect(loss(page).locator(".total")).toContainText("more than the Exchange takes");
  await expect(page.locator("#loss-go")).toBeDisabled();
  await loss(page).locator("button.pick", { hasText: "3-3 German infantry" }).first().click();
  await expect(loss(page).locator(".total")).toHaveText("Chosen 4 of at least 4 factors. That is enough.");
  await expect(page.locator("#loss-go")).toHaveText("Lose 4-6 German armor");
  await expect(loss(page).locator("button.pick[aria-pressed=true]")).toHaveCount(1);
  await loss(page).locator("button.way").nth(1).click(); // a quick pick replaces the choice: both infantry
  await expect(loss(page).locator("button.pick[aria-pressed=true]")).toHaveCount(2);
  await expect(page.locator("#loss-go")).toHaveText("Lose 2 x 3-3 German infantry");
  await loss(page).locator("button.way").nth(0).click(); // the armor again
  await expectReachable(page.locator("#loss-go"), "Lose");
  await page.locator("#loss-go").click();

  // The advance card replaces it at once: the survivors as chips, "Advance N units into Warsaw (M35)" and Stay, heading focused.
  await expect(loss(page)).toHaveCount(0);
  await expect(page.locator(".nextbar .next-text")).toHaveText("Next: advance into Warsaw (M35), or stay.");
  await expect(advance(page).locator("h2")).toHaveText("Advance into Warsaw (M35)?");
  await expect(advance(page).locator("h2")).toBeFocused();
  await expect(page.locator(".resultcard")).toContainText("You lost: 4-6 German armor.");
  await expect(page.locator(".resultcard")).toContainText("Warsaw (M35) is empty.");
  await expect(advance(page).locator("button.pick")).toHaveCount(2);
  await expect(advance(page).locator("button.pick").first()).toContainText("3-3 German infantry");
  await expect(advance(page).locator("button.pick").first()).toContainText("from L35");
  await expect(advance(page).locator("button[data-advancego]")).toHaveText("Advance 2 units into Warsaw (M35)");
  await advance(page).locator("button.pick").first().click();
  await expect(advance(page).locator("button[data-advancego]")).toHaveText("Advance 1 unit into Warsaw (M35)");
  await advance(page).locator("button.pick").first().click();
  await expect(advance(page).locator("button[data-advancego]")).toHaveText("Advance 2 units into Warsaw (M35)");
  await expectReachable(advance(page).locator("button[data-advancego]"), "Advance");
  await expectReachable(advance(page).locator("button[data-advancestay]"), "Stay");
  await expectReachable(done(page), "Done with step 7h");
  clean(await text(page));
  await advance(page).locator("button[data-advancego]").click();
  await expect(advance(page)).toHaveCount(0);
  await expect(page.locator(".resultcard")).toContainText("You advanced 2 x 3-3 German infantry into it.");
  await expect(page.locator(".log li").filter({ hasText: /^2 x 3-3 German infantry advance into Warsaw \(M35\)\./ })).toHaveCount(1);
  await expect(page.locator(".nextbar .next-text")).toHaveText("Next: attack a red hex, or finish.");

  // Done with the step.
  await expectReachable(done(page), "Done with step 7h");
  await done(page).click();
  await expect(page.locator(".turn")).not.toContainText("step 7h");
  await expect(page.locator(".nextbar")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("Stay puts the advance card away: the units stay, the result says so, the step is still open", async ({ page }) => {
  const errors = await load(page, 27);
  await attackWarsaw(page);
  await loss(page).locator("button.way").nth(0).click();
  await page.locator("#loss-go").click();
  await expect(advance(page)).toBeVisible();
  await advance(page).locator("button[data-advancestay]").click();
  await expect(advance(page)).toHaveCount(0);
  await expect(page.locator(".resultcard")).toContainText("Warsaw (M35) is empty. Your units stayed where they are.");
  await expect(page.locator(".nextbar .next-text")).toHaveText("Next: attack a red hex, or finish.");
  await expect(page.locator(".log li").filter({ hasText: /advance into Warsaw/ })).toHaveCount(0);
  await expect(done(page)).toBeVisible();
  expect(errors).toEqual([]);
});

test("the stacking limit: three survivors, two fit; the third chip turns the button off in words", async ({ page }) => {
  // Krakow, seed 4: two armor win and may advance; only the engine's own sets are accepted, so the button follows the chips.
  const errors = await load(page, 4);
  await page.locator('button.attack-row[data-target="P33"]').click();
  await page.locator("#attack-go").click();
  await expect(advance(page)).toBeVisible();
  await advance(page).locator("button.pick").first().click();
  await expect(advance(page).locator("button[data-advancego]")).toHaveText("Advance 1 unit into Krakow (P33)");
  await advance(page).locator("button.pick").first().click();
  await advance(page).locator("button.pick").nth(1).click();
  await advance(page).locator("button.pick").first().click();
  await expect(advance(page).locator("button[data-advancego]")).toHaveText("Choose at least one unit to advance");
  await expect(advance(page).locator("button[data-advancego]")).toBeDisabled();
  expect(errors).toEqual([]);
});

const SIZES: readonly Pt[] = [[1024, 768], [768, 1024], [1180, 820], [1400, 1000], [390, 844]];
for (const size of SIZES) {
  test(`${size[0]}x${size[1]}: after each press the next control is on screen without scrolling; every button and summary is 44 px`, async ({ page, hasTouch }) => {
    await load(page, 27, size);
    await attackWarsaw(page);
    // The player had scrolled down to the Attack button; now the losses card is in reach, and so is the Next bar.
    await expectReachable(loss(page).locator("h2"), "the losses heading");
    await expectReachable(page.locator("#loss-go"), "Lose");
    await expectReachable(loss(page).locator("button.way").first(), "the first quick pick");
    const measure = async () => {
      for (const b of await page.locator(".choicecard button:visible, .nextbar button:visible, .attacks summary:visible, details.declarations summary:visible, .resultcard button:visible").all()) {
        const box = (await b.boundingBox())!;
        const name = (await b.innerText()).slice(0, 30);
        expect(box.height, `${name} is tall enough`).toBeGreaterThanOrEqual(44);
        expect(box.width, `${name} is wide enough`).toBeGreaterThanOrEqual(44);
      }
      const chips = await page.locator(".choicecard button.pick").evaluateAll((els) => els.map((e) => e.getBoundingClientRect()));
      for (let i = 1; i < chips.length; i++) {
        const a = chips[i - 1]!, b = chips[i]!;
        expect(Math.max(b.left - a.right, b.top - a.bottom, a.left - b.right, a.top - b.bottom), "chips do not touch").toBeGreaterThanOrEqual(8);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(size[0]);
    };
    await measure();
    await page.screenshot({ path: `test-results/cards-losses-${size[0]}x${size[1]}.png` });
    await loss(page).locator("button.way").nth(0).click();
    await scrollDown(page);
    await page.locator("#loss-go").click();
    await expect(advance(page)).toBeVisible();
    await expectReachable(advance(page).locator("h2"), "the advance heading");
    await expectReachable(advance(page).locator("button[data-advancego]"), "Advance");
    await expectReachable(advance(page).locator("button[data-advancestay]"), "Stay");
    await expectReachable(done(page), "Done with step 7h");
    await measure();
    await page.screenshot({ path: `test-results/cards-advance-${size[0]}x${size[1]}.png` });
    await scrollDown(page);
    await expectReachable(done(page), "Done with step 7h, after scrolling down");
    await advance(page).locator("button[data-advancego]").scrollIntoViewIfNeeded();
    await advance(page).locator("button[data-advancego]").click();
    await expectReachable(done(page), "Done with step 7h after the advance");
    await expect(page.locator(".resultcard")).toBeVisible();
    await expectReachable(page.locator(".resultcard h2"), "the result heading");
    void hasTouch;
  });
}

for (const size of [[1024, 768], [1180, 820], [768, 1024]] as const) {
  test(`${size[0]}x${size[1]}: the result alone (attackers eliminated) keeps Done with step 7h in reach after a long card was read`, async ({ page, hasTouch }) => {
    await load(page, 4, size);
    await tapHexId(page, hasTouch, "M35");
    await scrollDown(page);
    await page.locator("#attack-go").click();
    await expect(page.locator(".resultcard")).toBeVisible();
    await expect(page.locator(".resultcard")).toContainText("your attackers are eliminated");
    await expectReachable(page.locator(".resultcard h2"), "the result heading");
    await expectReachable(done(page), "Done with step 7h");
    await expect(page.locator(".nextbar .next-text")).toHaveText("Next: attack a red hex, or finish.");
  });
}

test("the summaries of the attack card and of the fold-outs are 44 px tall", async ({ page, hasTouch }) => {
  await load(page, 4);
  await tapHexId(page, hasTouch, "M35");
  const sums = page.locator(".attackcard summary, details.declarations summary");
  expect(await sums.count()).toBeGreaterThan(1);
  for (const s of await sums.all()) expect((await s.boundingBox())!.height).toBeGreaterThanOrEqual(44);
});
