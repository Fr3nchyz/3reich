import { readFileSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * The loss and advance cards on a phone, upright (390x844) and on its side (844x390): right after each card appears, with no scrolling, the
 * heading, every way and chip of the losses, Advance and Stay are wholly on screen and not covered (by the pinned map, the Next bar or the
 * card's own sticky button bar). Same position as tests/e2e/cards.spec.ts: seed 27 at Warsaw gives an Exchange, then an advance.
 */

type Pt = readonly [number, number];
const FIXTURE = JSON.parse(readFileSync("tests/e2e/fixtures/axis-at-7h.json", "utf8")) as { scenario: string; actions: unknown[] };

async function load(page: Page, seed: number, size: Pt): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: size[0], height: size[1] });
  await page.goto("/?e2e");
  await page.evaluate((detail) => document.dispatchEvent(new CustomEvent("e2e-load", { detail })), { scenario: FIXTURE.scenario, side: "axis", seed, actions: FIXTURE.actions });
  await expect(page.locator(".turn")).toContainText("step 7h");
  return errors;
}

/** Whether a control is wholly on screen and nothing covers its middle: a finger can press it without scrolling. */
async function reachable(loc: Locator): Promise<boolean> {
  return loc.evaluate((el) => {
    const b = el.getBoundingClientRect();
    const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
    return b.top >= 0 && b.bottom <= window.innerHeight && b.left >= 0 && b.right <= window.innerWidth && hit !== null && (el === hit || el.contains(hit));
  });
}
const expectReachable = async (loc: Locator, what: string) => expect(await reachable(loc), `${what} can be pressed without scrolling`).toBe(true);

const scrollDown = (page: Page) => page.evaluate(() => { document.getElementById("status")!.scrollTop = 1e6; window.scrollTo(0, 1e6); });

/** Scrolls a little at a time, the way a finger does, until the control can be pressed (wholly on screen, uncovered); false if scrolling never gets it there. */
async function reachableAfterScroll(page: Page, loc: Locator): Promise<boolean> {
  for (let i = 0; i < 30; i++) {
    if (await reachable(loc)) return true;
    await page.evaluate(() => { window.scrollBy(0, 40); document.getElementById("status")!.scrollTop += 40; });
  }
  return reachable(loc);
}

/**
 * Upright, the card is wider than it is high: its heading, both ways and the confirm button are in reach the moment it appears. On its side
 * there is room for the heading and the ways only; the chips and the confirm button are a scroll away but never stay covered.
 */
const SIZES: readonly (readonly [number, number, boolean])[] = [[390, 844, true], [844, 390, false]];
for (const [w, h, upright] of SIZES) {
  test(`${w}x${h}: the losses card and the advance card (Advance beside Stay) can be pressed whole`, async ({ page }) => {
    const errors = await load(page, 27, [w, h]);
    await page.locator('button.attack-row[data-target="M35"]').click();
    await scrollDown(page);
    await page.locator("#attack-go").click();
    const loss = page.locator(".losscard");
    await expect(loss).toBeVisible();
    await expectReachable(loss.locator("h2"), "the losses heading");
    const ways = await loss.locator("button.way").all();
    expect(ways).toHaveLength(2);
    for (const [i, way] of ways.entries()) await expectReachable(way, `loss way ${i + 1}`);
    if (upright) await expectReachable(page.locator("#loss-go"), "Lose");
    for (const [i, chip] of (await loss.locator("button.pick").all()).entries()) expect(await reachableAfterScroll(page, chip), `loss unit ${i + 1}`).toBe(true);
    expect(await reachableAfterScroll(page, page.locator("#loss-go")), "Lose, after scrolling").toBe(true);

    await loss.locator("button.way").nth(0).click();
    await page.locator("#loss-go").click();
    const adv = page.locator(".advancecard");
    await expect(adv).toBeVisible();
    await expectReachable(adv.locator("h2"), "the advance heading");
    await expectReachable(adv.locator("button[data-advancego]"), "Advance");
    await expectReachable(adv.locator("button[data-advancestay]"), "Stay");
    const [go, stay] = await Promise.all([adv.locator("button[data-advancego]").boundingBox(), adv.locator("button[data-advancestay]").boundingBox()]);
    expect(stay!.y, "Stay sits beside Advance, not under it").toBeLessThan(go!.y + go!.height / 2);
    for (const [i, chip] of (await adv.locator("button.pick").all()).entries()) expect(await reachableAfterScroll(page, chip), `advance unit ${i + 1}`).toBe(true);
    expect(errors).toEqual([]);
  });
}
