import { readFileSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * Map marks of the Move card (spec 10, ticket 10-5) in a real browser, with a mouse and with a finger: the chosen hex is outlined thickly, ticked
 * counters carry a gold ring, left-behind ones a veil and a bar, and the marks follow the ticks. Same game as move-pick.spec.ts: step 6f, where
 * J36 holds a 4-6 armor and a 3-3 infantry.
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
const press = (loc: Locator, touch: boolean) => (touch ? loc.tap() : loc.click());
async function tapHexId(page: Page, touch: boolean, id: string): Promise<void> {
  await page.evaluate(() => window.scrollTo(0, 0));
  const pt = await page.locator(`svg.map polygon[data-id="${id}"]`).evaluate((p) => {
    const r = p.getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2] as Pt;
  });
  if (touch) await page.touchscreen.tap(pt[0], pt[1]);
  else await page.mouse.click(pt[0], pt[1]);
}

const ticked = (page: Page) => page.locator('svg.map g.units g[data-mark="ticked"]');
const left = (page: Page) => page.locator('svg.map g.units g[data-mark="left"]');

test("the chosen hex is outlined, ticked counters ringed, left-behind ones struck, and the marks follow the ticks", async ({ page, hasTouch }) => {
  const errors = await load(page);
  await expect(page.locator("svg.map [data-mk-from]")).toHaveCount(0);
  await expect(ticked(page)).toHaveCount(0);
  await tapHexId(page, hasTouch, "J36");
  await expect(page.locator("svg.map [data-mk-from]")).toHaveCount(1);
  await expect(page.locator("svg.map [data-mk-from]")).toHaveAttribute("data-mk-from", "J36");
  await expect(ticked(page)).toHaveCount(2);
  await expect(ticked(page).locator("rect.ring")).toHaveCount(2);
  await expect(left(page)).toHaveCount(0);

  await press(page.locator("button.mline").filter({ hasText: "infantry" }), hasTouch);
  await expect(ticked(page)).toHaveCount(1);
  await expect(left(page)).toHaveCount(1);
  await expect(left(page).locator("rect.veil")).toHaveCount(1);
  await expect(left(page).locator("line.dash")).toHaveCount(1);
  await expect(left(page).locator("rect.ring")).toHaveCount(0); // different shape, not only a different colour
  await expect(page.locator("svg.map [data-mk-from]")).toHaveCount(1);

  await press(page.locator("#move-none"), hasTouch);
  await expect(ticked(page)).toHaveCount(0);
  await expect(left(page)).toHaveCount(2);
  await press(page.locator("#move-all"), hasTouch);
  await expect(ticked(page)).toHaveCount(2);
  await expect(left(page)).toHaveCount(0);

  await press(page.locator("#move-cancel"), hasTouch);
  await expect(page.locator("svg.map [data-mk-from]")).toHaveCount(0);
  await expect(ticked(page)).toHaveCount(0);
  await expect(left(page)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("the marks are drawn apart from the yellow hexes, are a few pixels thick at any zoom and never take a tap", async ({ page, hasTouch }) => {
  await load(page);
  await tapHexId(page, hasTouch, "J36");
  const style = await page.evaluate(() => {
    const css = (sel: string) => getComputedStyle(document.querySelector(sel)!);
    const lum = (rgb: string) => {
      const [r, g, b] = (rgb.match(/\d+/g) ?? []).slice(0, 3).map((v) => Number(v) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
    };
    const ring = css("svg.map g.units rect.ring"), ringCase = css("svg.map g.units rect.ring-case"), from = css("svg.map .mk-from"), hl = css("svg.map g.highlights polygon");
    const a = lum(ring.stroke), b = lum(ringCase.stroke);
    return {
      contrast: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
      ringW: parseFloat(ring.strokeWidth), fromW: parseFloat(from.strokeWidth), hlW: parseFloat(hl.strokeWidth),
      nonScaling: [ring.vectorEffect, from.vectorEffect],
      events: [ring.pointerEvents, from.pointerEvents],
      fromStroke: from.stroke, hlStroke: hl.stroke,
    };
  });
  expect(style.contrast).toBeGreaterThanOrEqual(3);
  expect(style.nonScaling).toEqual(["non-scaling-stroke", "non-scaling-stroke"]);
  expect(style.events).toEqual(["none", "none"]);
  expect(style.fromW, "the chosen hex is thicker than a yellow hex").toBeGreaterThan(style.hlW);
  expect(style.fromStroke).not.toBe(style.hlStroke);
  // A tap on the ringed hex still reaches the map: it is the chosen hex, so a second tap lets it go.
  await tapHexId(page, hasTouch, "J36");
  await expect(page.locator(".movecard")).toHaveCount(0);
});

test("with no move chosen the map carries no move marks", async ({ page }) => {
  await page.goto("/");
  await page.locator("#newgame").click();
  await expect(page.locator('svg.map g.units g[data-mark]')).toHaveCount(0);
  await expect(page.locator("svg.map [data-mk-from]")).toHaveCount(0);
});
