import { readFileSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * Map marks of the Move card (spec 10, ticket 10-5) in a real browser, with a mouse and with a finger: the chosen hex is outlined thickly, ticked
 * counters have a ringed badge with a tick under the stack, left-behind ones a flat dash, and the marks follow the ticks. Same game as move-pick.spec.ts:
 * step 6f, where J36 holds a 4-6 armor and a 3-3 infantry (a stack of two) and L31 a stack of three counters.
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

const ticked = (page: Page) => page.locator('svg.map g.unit-marks g[data-mark="ticked"]');
const left = (page: Page) => page.locator('svg.map g.unit-marks g[data-mark="left"]');

test("the chosen hex is outlined, ticked counters ringed, left-behind ones struck, and the marks follow the ticks", async ({ page, hasTouch }) => {
  const errors = await load(page);
  await expect(page.locator("svg.map [data-mk-from]")).toHaveCount(0);
  await expect(ticked(page)).toHaveCount(0);
  await tapHexId(page, hasTouch, "J36");
  await expect(page.locator("svg.map [data-mk-from]")).toHaveCount(1);
  await expect(page.locator("svg.map [data-mk-from]")).toHaveAttribute("data-mk-from", "J36");
  await expect(ticked(page)).toHaveCount(2);
  await expect(ticked(page).locator("circle.bd-ring")).toHaveCount(2);
  await expect(ticked(page).locator("path.bd-tick")).toHaveCount(2);
  await expect(left(page)).toHaveCount(0);

  await press(page.locator("button.mline").filter({ hasText: "infantry" }), hasTouch);
  await expect(ticked(page)).toHaveCount(1);
  await expect(left(page)).toHaveCount(1);
  await expect(left(page).locator("rect.bd-dash")).toHaveCount(1);
  await expect(left(page).locator("circle")).toHaveCount(0); // a different shape, not only a different colour
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
    const ring = css("svg.map g.unit-marks circle.bd-ring"), ringCase = css("svg.map g.unit-marks circle.bd-case"), from = css("svg.map .mk-from"), hl = css("svg.map g.highlights polygon");
    const a = lum(ring.stroke), b = lum(ringCase.fill);
    return {
      contrast: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
      ringW: parseFloat(ring.strokeWidth), fromW: parseFloat(from.strokeWidth), hlW: parseFloat(hl.strokeWidth),
      nonScaling: [from.vectorEffect, ring.vectorEffect],
      events: [ring.pointerEvents, from.pointerEvents],
      fromStroke: from.stroke, hlStroke: hl.stroke,
    };
  });
  expect(style.contrast).toBeGreaterThanOrEqual(3);
  expect(style.nonScaling[0], "the hex outline is screen pixels").toBe("non-scaling-stroke");
  expect(style.nonScaling[1], "the badge scales with the counters").not.toBe("non-scaling-stroke");
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

/** The screen boxes of the badges and of the counters in one hex, and of the map. */
async function boxes(page: Page, hex: string) {
  return page.evaluate((id) => {
    const r = (e: Element) => { const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; };
    return {
      badges: [...document.querySelectorAll("svg.map g.unit-marks g[data-mark]")].map((g) => ({ kind: (g as SVGElement).dataset.mark!, ...r(g.querySelector("circle.bd-case, rect.bd-case")!) })),
      counters: [...document.querySelectorAll(`svg.map g.units g[data-at="${id}"]`)].map(r),
      map: r(document.querySelector("svg.map")!),
      view: { w: innerWidth, h: innerHeight },
    };
  }, hex);
}
const overlap = (a: { l: number; t: number; r: number; b: number }, b: { l: number; t: number; r: number; b: number }) => a.l < b.r - 0.5 && a.r > b.l + 0.5 && a.t < b.b - 0.5 && a.b > b.t + 0.5;

const SIZES: readonly Pt[] = [[1024, 768], [1180, 820], [768, 1024], [390, 844]];
for (const size of SIZES) {
  test(`${size[0]}x${size[1]}: in a stack of two and of three every marked counter has its own badge, uncovered, clear of every counter and of the other badges`, async ({ page, hasTouch }) => {
    await load(page);
    await page.setViewportSize({ width: size[0], height: size[1] });
    for (const hex of ["J36", "L31"]) {
      await press(page.locator(`button.stack-row[data-stack="${hex}"]`), hasTouch);
      await expect(page.locator(".movecard")).toBeVisible();
      const counters = await page.locator(`svg.map g.units g[data-at="${hex}"]`).count();
      expect(counters, `${hex} is a stack of at least two`).toBeGreaterThanOrEqual(2);
      for (const mode of ["all ticked", "one unticked", "none ticked"]) {
        if (mode === "one unticked") await press(page.locator("button.mline:not(.greyed)").first(), hasTouch);
        if (mode === "none ticked") await press(page.locator("#move-none"), hasTouch);
        const lines = await page.locator("button.mline:not(.greyed)").count();
        await expect(page.locator("svg.map g.unit-marks g[data-mark]"), `${hex}, ${mode}: one badge for each counter that can move`).toHaveCount(lines);
        const b = await boxes(page, hex);
        b.badges.forEach((m, i) => {
          expect(m.r - m.l, `${hex}, ${mode}: badge ${i} is a good share of a counter width (the map is small at this size, so a pixel count says nothing)`).toBeGreaterThanOrEqual(0.35 * (b.counters[0]!.r - b.counters[0]!.l));
          for (const c of b.counters) expect(overlap(m, c), `${hex}, ${mode}: badge ${i} covers no counter`).toBe(false);
          b.badges.slice(i + 1).forEach((o) => expect(overlap(m, o), `${hex}, ${mode}: badges do not overlap`).toBe(false));
          if (i > 0) expect(m.l, "left to right, lowest counter first").toBeGreaterThan(b.badges[i - 1]!.l);
        });
        expect(b.badges.length).toBeGreaterThan(0);
        const kinds = new Set(b.badges.map((m) => m.kind));
        const expected = mode === "all ticked" ? ["ticked"] : mode === "none ticked" ? ["left"] : lines > 1 ? ["left", "ticked"] : ["left"];
        expect([...kinds].sort(), `${hex}, ${mode}: ticked and left-behind counters are told apart`).toEqual(expected);
      }
      await press(page.locator("#move-cancel"), hasTouch);
    }
  });
}
