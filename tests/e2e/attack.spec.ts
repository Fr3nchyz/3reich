import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

/**
 * Tap to attack (spec 07, ticket 07-6) in a real browser, with a mouse and with a finger. The game is loaded at step 7h of the first Axis Player
 * Turn from a recorded list of actions (tests/e2e/fixtures/axis-at-7h.json, the `?e2e` test hook, src/ui/e2eLoad.ts): Warsaw (M35) and Krakow (P33)
 * can be attacked. The same seed always gives the same dice.
 */

type Pt = readonly [number, number];
const FIXTURE = JSON.parse(readFileSync("tests/e2e/fixtures/axis-at-7h.json", "utf8")) as { scenario: string; seed: number; actions: unknown[] };

async function load(page: Page, size?: Pt): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  if (size) await page.setViewportSize({ width: size[0], height: size[1] });
  await page.goto("/?e2e");
  await page.evaluate((detail) => document.dispatchEvent(new CustomEvent("e2e-load", { detail })), { scenario: FIXTURE.scenario, side: "axis", seed: FIXTURE.seed, actions: FIXTURE.actions });
  await expect(page.locator(".turn")).toContainText("step 7h");
  return errors;
}

async function tapAt(page: Page, touch: boolean, pt: Pt): Promise<void> {
  if (touch) await page.touchscreen.tap(pt[0], pt[1]);
  else await page.mouse.click(pt[0], pt[1]);
}

/** The screen point of the middle of a hex, after bringing the map to the top of the page. */
async function centreOf(page: Page, id: string): Promise<Pt> {
  await page.evaluate(() => window.scrollTo(0, 0));
  return page.locator(`svg.map polygon[data-id="${id}"]`).evaluate((p) => {
    const r = p.getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2] as const;
  });
}
const tapHexId = async (page: Page, touch: boolean, id: string) => tapAt(page, touch, await centreOf(page, id));

const card = (page: Page) => page.locator(".attackcard");
const rows = (page: Page) => page.locator("button.attack-row");
const go = (page: Page) => page.locator("#attack-go");
const clean = (s: string) => expect(s).not.toMatch(/\bu\d+\b/);

test("tap Warsaw on the map: the card shows the defenders and the odds, chips change them, Confirm attacks and shows the result", async ({ page, hasTouch }) => {
  const errors = await load(page);
  await expect(page.locator(".attacks h2").first()).toHaveText("Attacks you can make (2)");
  await expect(rows(page)).toHaveCount(2);
  await expect(rows(page).first()).toContainText("Warsaw (M35)");
  await expect(rows(page).first()).toContainText("2 x 2-3 Polish infantry");
  await expect(page.locator("g.attack-marks .mk-target")).toHaveCount(2);
  await expect(card(page)).toHaveCount(0);

  await tapHexId(page, hasTouch, "M35");
  await expect(card(page)).toBeVisible();
  await expect(card(page).locator("h2")).toHaveText("Attack on Warsaw (M35)");
  await expect(card(page)).toContainText("2 x 2-3 Polish infantry = 4 factors");
  await expect(card(page)).toContainText("tripled");
  const chips = card(page).locator("button.chip");
  await expect(chips).toHaveCount(3);
  await expect(card(page).locator('button.chip[aria-pressed="true"]')).toHaveCount(3);
  await expect(card(page).locator(".odds")).toContainText("Odds: 10 against 12, column 1-2.");
  await expect(go(page)).toHaveText("Attack Warsaw (M35) with 3 units (10 factors) at 1-2 (risky)");
  await expect(go(page)).toHaveClass(/risky/);
  await expect(card(page).locator("ol.results > li")).toHaveCount(3);
  await expect(page.locator("g.attack-marks .mk-chosen")).toHaveCount(1);
  await expect(page.locator("g.attack-marks .mk-attacker")).toHaveCount(2); // L35 and M34
  await expect(page.locator("g.attack-marks .mk-target")).toHaveCount(1); // Krakow stays dashed
  clean(await card(page).innerText());

  // Taking the 4-6 armor out: the odds, the button and the gold hexes follow.
  await chips.filter({ hasText: "German armor" }).click();
  await expect(card(page).locator('button.chip[aria-pressed="true"]')).toHaveCount(2);
  await expect(card(page).locator(".odds")).toContainText("6 against 12");
  await expect(go(page)).toContainText("with 2 units (6 factors)");
  await expect(chips.filter({ hasText: "German armor" })).toHaveAttribute("aria-pressed", "false");
  await chips.filter({ hasText: "German armor" }).click();
  await expect(go(page)).toContainText("with 3 units (10 factors)");

  // Confirm: one press, no pop-up. The die is rolled by the engine; the result card replaces the attack card.
  await go(page).click();
  await expect(card(page)).toHaveCount(0);
  await expect(page.locator(".resultcard")).toBeVisible();
  await expect(page.locator(".resultcard h2")).toHaveText("Result: Warsaw (M35)");
  await expect(page.locator(".resultcard")).toContainText("Column 1-2: 10 against 12.");
  // Seed 4: the first die is a 6, so a 1-2 attack ends with the attackers eliminated.
  await expect(page.locator(".resultcard")).toContainText("Your attack, column 1-2, roll 6: your attackers are eliminated.");
  await expect(page.locator(".resultcard")).toContainText("You lost: 4-6 German armor, 2 x 3-3 German infantry.");
  await expect(page.locator(".resultcard")).toContainText("They lost nothing.");
  await expect(page.locator(".log li").filter({ hasText: /^Attack on Warsaw \(M35\)/ })).toHaveCount(1);
  clean(await page.locator(".resultcard").innerText());
  await expect(rows(page)).toHaveCount(1); // Warsaw has been attacked: only Krakow is left
  await expect(page.locator("g.attack-marks .mk-chosen")).toHaveCount(0);
  await expect(page.locator("g.attack-marks .mk-target")).toHaveCount(1);
  await page.locator("#result-close").click();
  await expect(page.locator(".resultcard")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("a win: the result card names what was lost, offers the advance with names, and the old button still moves the units", async ({ page, hasTouch }) => {
  const errors = await load(page);
  await tapHexId(page, hasTouch, "P33");
  await expect(card(page).locator("h2")).toHaveText("Attack on Krakow (P33)");
  await go(page).click();
  // Seed 4: the first die is a 6, which is the defenders eliminated at 1-1.
  const result = page.locator(".resultcard");
  await expect(result).toContainText("Your attack, column 1-1, roll 6: the defenders are eliminated.");
  await expect(result).toContainText("They lost: 2-3 Polish infantry, 1-3 Polish infantry.");
  await expect(result).toContainText("You lost nothing.");
  await expect(result).toContainText("Krakow (P33) is empty. Your surviving units can advance into it");
  // The advance is asked for in a card of its own, first under the Next bar, with the heading focused; chips name the units, no ids.
  const adv = page.locator(".advancecard");
  await expect(adv.locator("h2")).toHaveText("Advance into Krakow (P33)?");
  await expect(adv.locator("h2")).toBeFocused();
  await expect(adv.locator("button.pick")).toHaveCount(2);
  await expect(adv.locator("button.pick").first()).toContainText("4-6 German armor");
  await expect(adv.locator("button.pick").first()).toContainText("from P32");
  await expect(adv.locator("button[data-advancego]")).toHaveText("Advance 2 units into Krakow (P33)");
  await expect(adv.locator("button[data-advancestay]")).toHaveText("Stay");
  clean(await page.locator("main").innerText());
  // The old coded button is still in a fold-out, with its readable label.
  const fold = page.locator("details.declarations", { hasText: "All advances as a list" });
  await expect(fold.locator("button", { hasText: "Advance 2 x 4-6 German armor from P32 into Krakow (P33)" })).toHaveCount(1);
  await adv.locator("button[data-advancego]").click();
  await expect(page.locator(".log li").filter({ hasText: /^2 x 4-6 German armor advance into Krakow \(P33\)\./ })).toHaveCount(1);
  await expect(page.locator(".advancecard")).toHaveCount(0);
  await expect(page.locator(".resultcard")).toContainText("You advanced 2 x 4-6 German armor into it.");
  await expect(page.locator("button", { hasText: /^Advance / })).toHaveCount(0);
  await expect(page.locator("g.attack-marks .mk-target")).toHaveCount(1); // Warsaw is still there to attack
  expect(errors).toEqual([]);
});

test("the list path, Cancel, Escape, the same hex again, and the old buttons in a fold-out with readable labels", async ({ page, hasTouch }) => {
  const errors = await load(page);
  // The old coded attack buttons are in a closed fold-out, never among the step buttons.
  const fold = page.locator("details.declarations", { hasText: "All attacks as a list" });
  await expect(fold.locator("summary")).toHaveText("All attacks as a list (4 choices)");
  expect(await fold.evaluate((d) => (d as HTMLDetailsElement).open)).toBe(false);
  await fold.locator("summary").click();
  await expect(fold.getByRole("button", { name: "Attack Warsaw (M35) with 3-3 German infantry from M34", exact: true })).toBeVisible();
  await expect(fold.getByRole("button", { name: /^Attack Krakow \(P33\) with 2 x 4-6 German armor from P32/ })).toBeVisible();
  clean(await fold.innerText());
  await expect(page.locator("main > .actions button[data-action]")).toHaveCount(1); // "Done with step 7h" only
  await fold.locator("summary").click();

  // The list row opens the same card; Cancel throws it away; nothing was rolled.
  await rows(page).nth(1).click();
  await expect(card(page).locator("h2")).toHaveText("Attack on Krakow (P33)");
  await expect(card(page).locator("h2")).toBeFocused();
  await expect(card(page).locator("button.chip")).toHaveCount(2);
  await expect(card(page).locator('button.chip[aria-pressed="true"]')).toHaveCount(2);
  await expect(go(page)).toHaveText("Attack Krakow (P33) with 2 units (8 factors)");
  await page.locator("#attack-cancel").click();
  await expect(card(page)).toHaveCount(0);
  await expect(page.locator(".log li").filter({ hasText: /^Attack on/ })).toHaveCount(0);

  // Keyboard: Tab to a row, Enter opens, Space on a chip toggles, Escape cancels.
  await rows(page).first().focus();
  await page.keyboard.press("Enter");
  await expect(card(page).locator("h2")).toBeFocused();
  await page.keyboard.press("Tab"); // Cancel
  await page.keyboard.press("Tab"); // the first chip
  await expect(card(page).locator("button.chip").first()).toBeFocused();
  await page.keyboard.press("Space");
  await expect(card(page).locator("button.chip").first()).toHaveAttribute("aria-pressed", "false");
  await expect(card(page).locator("button.chip").first()).toBeFocused(); // focusKeep gives the focus back to the same chip
  await page.keyboard.press("Escape");
  await expect(card(page)).toHaveCount(0);

  // Tapping the same hex again on the map closes the card; another red hex moves it.
  await tapHexId(page, hasTouch, "M35");
  await expect(card(page).locator("h2")).toHaveText("Attack on Warsaw (M35)");
  await tapHexId(page, hasTouch, "P33");
  await expect(card(page).locator("h2")).toHaveText("Attack on Krakow (P33)");
  await tapHexId(page, hasTouch, "P33");
  await expect(card(page)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("opening a card from the list moves a zoomed-in map to show the target, and leaves a map that already shows it alone", async ({ page }) => {
  await load(page);
  const inView = (id: string) => page.locator(`svg.map polygon[data-id="${id}"]`).evaluate((p) => {
    const r = p.getBoundingClientRect(), b = document.querySelector("svg.map")!.getBoundingClientRect();
    return r.left >= b.left && r.right <= b.right && r.top >= b.top && r.bottom <= b.bottom;
  });
  const viewBox = () => page.locator("svg.map").getAttribute("viewBox");
  // The whole map is on show: opening a card does not move it.
  const whole = await viewBox();
  await rows(page).first().click();
  await expect(card(page)).toBeVisible();
  expect(await viewBox()).toBe(whole);
  await page.locator("#attack-cancel").click();
  // Zoom right in at the map's top left corner, far from Warsaw.
  const box = (await page.locator("svg.map").boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + 20);
  for (let i = 0; i < 12; i++) await page.mouse.wheel(0, -100);
  await expect.poll(viewBox).not.toBe(whole);
  expect(await inView("M35")).toBe(false);
  await rows(page).first().click();
  await expect(card(page).locator("h2")).toHaveText("Attack on Warsaw (M35)");
  await expect.poll(() => inView("M35")).toBe(true);
  await expect.poll(() => inView("L35")).toBe(true); // and the units that attack it
});

test("a hex that cannot be attacked says why; the open card stays while another hex is looked at", async ({ page, hasTouch }) => {
  await load(page);
  // A Polish hex with no German unit beside it.
  const far = await page.evaluate(() => {
    const own = new Set([...document.querySelectorAll("svg.map g.units > g")].map((g) => g.getAttribute("data-at")));
    return [...own].filter((id) => id !== "M35" && id !== "P33");
  });
  expect(far.length).toBeGreaterThan(0);
  let said = false;
  for (const id of far) {
    await tapHexId(page, hasTouch, id!);
    const t = await page.locator(".hexcard").innerText().catch(() => "");
    if (/None of your units that have not attacked is next to this hex\./.test(t) || /You are not at war with/.test(t)) { said = true; break; }
  }
  expect(said, "some enemy hex says why it cannot be attacked").toBe(true);
  await expect(card(page)).toHaveCount(0);

  await tapHexId(page, hasTouch, "M35");
  await expect(card(page)).toBeVisible();
  await tapHexId(page, hasTouch, far[0]!);
  await expect(card(page).locator("h2")).toHaveText("Attack on Warsaw (M35)"); // the draft stays
  await expect(page.locator(".hexcard")).toBeVisible(); // and the hex card shows the hex looked at, under it
});

test("the computer's turn: no list, no card, no marks", async ({ page }) => {
  test.setTimeout(90_000);
  await load(page);
  await page.getByRole("button", { name: "Done with step 7h", exact: true }).click();
  await expect(page.locator(".attacks")).toHaveCount(0);
  await expect(page.locator("g.attack-marks *")).toHaveCount(0);
  await expect(page.locator(".turn")).not.toContainText("step 7h");
  // End the Axis turn (steps 8b, 10b are quick), then watch the Allied turn pass.
  for (let i = 0; i < 6 && !(await page.locator(".turn").textContent())?.includes("Allied player turn"); i++) {
    await page.locator("main > .actions button[data-action]").last().click();
  }
  await expect(page.locator(".turn")).toContainText("Allied player turn");
  for (let i = 0; i < 20; i++) {
    await expect(page.locator(".attacks")).toHaveCount(0);
    await expect(page.locator("g.attack-marks *")).toHaveCount(0);
    if (!(await page.locator(".turn").textContent())?.includes("Allied player turn")) break;
    await page.waitForTimeout(250);
  }
});

test("watch mode: taps only inspect; no list and no card", async ({ page, hasTouch }) => {
  await page.goto("/");
  await page.locator("#side").selectOption("watch");
  await page.locator("#seed").fill("4242");
  await page.locator("#newgame").click();
  await expect(page.locator(".turn")).toContainText("player turn");
  await tapHexId(page, hasTouch, "M35");
  await expect(page.locator(".hexcard")).toBeVisible();
  await expect(page.locator(".attacks")).toHaveCount(0);
  await expect(page.locator("g.attack-marks *")).toHaveCount(0);
});

const SIZES: readonly Pt[] = [[1024, 768], [768, 1024], [1180, 820], [1400, 1000], [390, 844], [844, 390]];
for (const size of SIZES) {
  test(`${size[0]}x${size[1]}: the card opens in reach, every button is 44 px, the map stays on screen, nothing scrolls sideways`, async ({ page, hasTouch }) => {
    await load(page, size);
        await expect(page.locator("#attacks-title"), "the list of attacks is on screen when step 7h begins").toBeInViewport();
    await expect(rows(page).first()).toBeInViewport();
    await tapHexId(page, hasTouch, "M35");
    await expect(card(page)).toBeVisible();
    await expect(card(page).locator("h2")).toBeFocused();
    const heading = (await card(page).locator("h2").boundingBox())!;
    expect(heading.y, "the card heading is in view").toBeGreaterThanOrEqual(0);
    expect(heading.y + heading.height).toBeLessThanOrEqual(size[1]);
    const map = (await page.locator(".map-wrap").boundingBox())!;
    expect(map.height, "the map is still on screen").toBeGreaterThan(size[1] * 0.25);
    expect(map.y + map.height).toBeGreaterThan(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(size[0]);
    const bar = (await page.locator(".nextbar").boundingBox())!;
    const cardTop = (await card(page).boundingBox())!.y;
    expect(bar.y + bar.height, "the Next bar does not cover the card").toBeLessThanOrEqual(cardTop + 1);
    for (const b of await page.locator(".attacks button:visible").all()) {
      const box = (await b.boundingBox())!;
      const name = (await b.innerText()).slice(0, 30);
      expect(box.height, `${name} is tall enough`).toBeGreaterThanOrEqual(44);
      expect(box.width, `${name} is wide enough`).toBeGreaterThanOrEqual(44);
    }
    // Chips are 8 px or more apart.
    const boxes = await card(page).locator("button.chip").evaluateAll((els) => els.map((e) => e.getBoundingClientRect()));
    for (let i = 1; i < boxes.length; i++) {
      const a = boxes[i - 1]!, b = boxes[i]!;
      const gap = Math.max(b.left - a.right, b.top - a.bottom, a.left - b.right, a.top - b.bottom);
      expect(gap, "chips do not touch").toBeGreaterThanOrEqual(8);
    }
    await page.screenshot({ path: `test-results/attack-${size[0]}x${size[1]}.png` });
  });
}
