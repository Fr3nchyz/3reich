import { expect, test, type Page } from "@playwright/test";

/**
 * A seeded random play-through at phone size, over every scenario and both sides, with new games started
 * mid-way: random counters in setup, then random declarations, builds and grants while turns go by. It
 * looks for page errors, toasts that should not appear, "undefined"/"NaN" in the page, and a game that
 * gets stuck. The same seed plays the same game, so a failure can be repeated.
 */

const SCENARIOS = ["1939", "campaign", "1942", "1944"] as const;
const SIDES = ["axis", "allies"] as const;
const TURNS = 3;

function random(seed: number) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

async function visibleHighlight(page: Page, rnd: () => number): Promise<[number, number] | null> {
  // The chips sit below the map, so a tap on one leaves the map scrolled out of sight on a phone.
  await page.evaluate(() => window.scrollTo(0, 0));
  const spots = await page.locator("svg.map").evaluate((svg) => {
    const box = svg.getBoundingClientRect();
    return [...svg.querySelectorAll("g.highlights polygon")]
      .map((h) => h.getBoundingClientRect())
      .filter((r) => r.left > Math.max(box.left, 0) + 4 && r.right < Math.min(box.right, innerWidth) - 4 && r.top > Math.max(box.top, 0) + 4 && r.bottom < Math.min(box.bottom, innerHeight) - 4)
      .map((r) => [r.left + r.width / 2, r.top + r.height / 2] as [number, number]);
  });
  return spots.length ? spots[Math.floor(rnd() * spots.length)]! : null;
}

test("random play at phone size: every scenario, both sides, new games between", async ({ page, hasTouch }) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 420, height: 900 });
  const rnd = random(777);
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
  const tap = async ([x, y]: [number, number]) => {
    await page.evaluate(() => window.scrollTo(0, 0));
    if (hasTouch) await page.touchscreen.tap(x, y);
    else await page.mouse.click(x, y);
  };
  const toast = async () => (await page.locator(".toast").innerText()).trim();
  const turnLine = async () => (await page.locator(".turn").innerText()).trim();
  let turnsPlayed = 0;
  let builds = 0;

  await page.goto("/");
  for (const scenario of SCENARIOS) {
    for (const side of SIDES) {
      const tag = `${scenario}/${side}`;
      await page.locator("#scenario").selectOption(scenario);
      await page.locator("#side").selectOption(side);
      await page.locator("#newgame").click();

      // A few counters by hand, then the rest for me.
      for (let k = 0; k < Math.floor(rnd() * 3); k++) {
        const chips = page.locator(".setup button[data-spec]");
        const n = await chips.count();
        if (!n) break;
        await chips.nth(Math.floor(rnd() * n)).click();
        const spot = await visibleHighlight(page, rnd);
        if (spot) await tap(spot);
        else if (await page.locator("button[data-box]").count()) await page.locator("button[data-box]").first().click();
        if (await toast()) problems.push(`${tag}: toast after a placement: ${await toast()}`);
      }
      for (let i = 0; i < 14 && (await page.locator("#fill").count()); i++) {
        await page.locator("#fill").click();
        const t = await toast();
        if (t && !/taken back and set down/.test(t)) problems.push(`${tag}: toast after "place the rest": ${t}`);
      }
      await expect(page.locator(".turn")).toContainText("player turn");

      // Turns with random choices at the steps that have any.
      let played = 0;
      for (let guard = 0; guard < TURNS * 12 && played < TURNS; guard++) {
        // The computer plays the other side's turns by itself: wait until it is the player's turn again.
        await expect(page.locator(".computer-status")).toHaveCount(0, { timeout: 60_000 });
        const turn = await turnLine();
        if (/undefined|NaN|\[object/.test(await page.locator("body").innerText())) problems.push(`${tag}: odd text on the page at "${turn}"`);
        const step = /step (\S+)/.exec(turn)?.[1];
        const fold = page.locator("details.declarations summary");
        if ((step === "1" || step === "9a") && rnd() < 0.5 && (await fold.count())) {
          await fold.first().click();
          const buttons = page.locator("details.declarations button[data-action]");
          await buttons.nth(Math.floor(rnd() * (await buttons.count()))).click();
        } else if (step === "8b" && rnd() < 0.8 && (await page.locator("button[data-build]").count())) {
          const chips = page.locator("button[data-build]");
          await chips.nth(Math.floor(rnd() * (await chips.count()))).click();
          const before = await page.locator("g.units > g").count();
          const spot = await visibleHighlight(page, rnd);
          if (spot) await tap(spot);
          else if (await page.locator("button[data-buildbox]").count()) await page.locator("button[data-buildbox]").first().click();
          if (await toast()) problems.push(`${tag}: toast after a build tap: ${await toast()}`);
          if ((await page.locator("g.units > g").count()) > before) builds++;
        }
        const last = page.locator(".actions button[data-action]").last();
        if (!(await last.count())) { problems.push(`${tag}: no move-on button at "${turn}"`); break; }
        const label = (await last.innerText()).trim();
        await last.click();
        if (await toast()) problems.push(`${tag}: toast after "${label}" at "${turn}": ${await toast()}`);
        if (/^End /.test(label)) { played++; turnsPlayed++; }
      }
      if (played < TURNS) problems.push(`${tag}: only ${played} of ${TURNS} turns played`);
    }
  }
  expect(turnsPlayed).toBe(SCENARIOS.length * SIDES.length * TURNS);
  expect(builds).toBeGreaterThan(0);
  expect(problems).toEqual([]);
});
