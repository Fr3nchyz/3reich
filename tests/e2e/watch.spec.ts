import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";

/** Watch two computers play (spec 06): start on every scenario, pause, step, speed, turbo, end of game, record, take over, phone layout. */

const SCENARIOS = [["1939", "1939 Scenario"], ["campaign", "Campaign Scenario"], ["1942", "1942 Scenario"], ["1944", "1944 Scenario"]] as const;

async function startWatch(page: Page, id: string, opts: { seed?: string; speed?: string; turns?: string } = {}): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.locator("#scenario").selectOption(id);
  await page.locator("#side").selectOption("watch");
  await expect(page.locator("#seed")).toHaveValue(/^\d+$/); // a random seed is shown
  if (opts.seed) await page.locator("#seed").fill(opts.seed);
  if (opts.turns) await page.locator("#watchturns").fill(opts.turns);
  await page.locator("#newgame").click();
  await expect(page.locator("#watchbar")).toBeVisible();
  await page.locator("#w-speed").selectOption(opts.speed ?? "fast");
  return errors;
}

const status = (page: Page) => page.locator("#w-status").innerText();
const actions = async (page: Page) => Number(/action (\d+)/.exec(await status(page))![1]);
const gameTurn = async (page: Page) => /Game Turn (\w+ \d+)/.exec(await status(page))?.[1] ?? "";

for (const [id, name] of SCENARIOS) {
  test(`${id}: watch mode runs, pauses, steps one action and shows the status`, async ({ page }) => {
    test.setTimeout(90_000);
    const errors = await startWatch(page, id, { seed: "11" });
    const line = await status(page);
    expect(line).toContain(name);
    expect(line).toMatch(/Game Turn \w+ \d{4} · (Axis|Allied) to move · step .* · action \d+ · (Axis|Allied) acting/);
    const first = await actions(page);
    await expect.poll(() => actions(page), { timeout: 20_000 }).toBeGreaterThan(first + 3);
    expect(await page.locator("ol.log li").count()).toBeGreaterThan(1);
    expect(await page.locator("ol.log").innerText()).toMatch(/Computer \((Axis|Allied)\)/);

    await page.locator("#w-play").click();
    await expect(page.locator("#w-play")).toHaveText("Play");
    await page.waitForTimeout(150); // an action already scheduled may still land
    const paused = await actions(page);
    await page.waitForTimeout(600);
    expect(await actions(page), "paused: no action is played").toBe(paused);

    for (let i = 1; i <= 2; i++) {
      await page.locator("#w-step").click();
      await expect.poll(() => actions(page)).toBe(paused + i);
      await page.waitForTimeout(250);
      expect(await actions(page), "one step plays exactly one action").toBe(paused + i);
    }
    await page.locator("#w-play").click();
    await expect(page.locator("#w-play")).toHaveText("Pause");
    await expect.poll(() => actions(page), { timeout: 20_000 }).toBeGreaterThan(paused + 5);
    expect(errors).toEqual([]);
  });
}

test("speed changes the rate: Slow plays about one action in 600 ms, Fast many more", async ({ page }) => {
  const errors = await startWatch(page, "1939", { seed: "5", speed: "slow" });
  const rate = async (ms: number) => { const a = await actions(page); await page.waitForTimeout(ms); return (await actions(page)) - a; };
  const slow = await rate(2400);
  expect(slow).toBeGreaterThanOrEqual(2);
  expect(slow).toBeLessThanOrEqual(6);
  await page.locator("#w-speed").selectOption("fast");
  const fast = await rate(1200);
  expect(fast).toBeGreaterThan(slow * 3);
  await page.locator("#w-speed").selectOption("turbo");
  const turbo = await rate(1200);
  expect(turbo).toBeGreaterThan(fast);
  expect(errors).toEqual([]);
});

test("turbo plays several Game Turns (or the whole scenario) and the page keeps repainting", async ({ page }) => {
  test.setTimeout(60_000);
  const errors = await startWatch(page, "1939", { seed: "5", speed: "turbo" });
  await page.evaluate(() => {
    const w = window as unknown as { maxGap: number };
    w.maxGap = 0;
    let last = performance.now();
    const tick = (t: number) => { w.maxGap = Math.max(w.maxGap, t - last); last = t; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
  const seen = new Set<string>();
  // Turbo may finish the whole scenario in a few seconds: count Game Turns seen, or the end of the game.
  await expect.poll(async () => { seen.add(await gameTurn(page)); return seen.size >= 3 || (await status(page)).includes("ended"); }, { timeout: 40_000, intervals: [100] }).toBe(true);
  expect(await actions(page)).toBeGreaterThan(100);
  const gap = await page.evaluate(() => (window as unknown as { maxGap: number }).maxGap);
  expect(gap, "longest time between repaints at Turbo (ms)").toBeLessThan(400);
  expect(errors).toEqual([]);
});

test("'Step to next turn' plays on to the next Game Turn and stops there", async ({ page }) => {
  const errors = await startWatch(page, "1939", { seed: "9" });
  await page.locator("#w-play").click();
  await page.waitForTimeout(200);
  const before = await gameTurn(page);
  const n = await actions(page);
  await page.locator("#w-turn").click();
  await expect.poll(() => gameTurn(page), { timeout: 20_000 }).not.toBe(before);
  const after = await actions(page);
  expect(after).toBeGreaterThan(n + 3);
  await page.waitForTimeout(400);
  expect(await actions(page)).toBe(after);
  expect(await status(page)).toContain("paused");
  expect(errors).toEqual([]);
});

test("a game with a Game Turn limit ends with the End of game summary", async ({ page }) => {
  const errors = await startWatch(page, "1939", { seed: "3", speed: "turbo", turns: "1" });
  await expect(page.locator(".watch-summary")).toBeVisible({ timeout: 30_000 });
  const text = await page.locator(".watch-summary").innerText();
  expect(text).toContain("End of game");
  expect(text).toMatch(/Germany: -?\d+ BRPs/);
  expect(text).toMatch(/Axis: \d+ counters, \d+ hexes controlled/);
  expect(text).toMatch(/Allies: \d+ counters, \d+ hexes controlled/);
  expect(await status(page)).toContain("ended");
  await expect(page.locator("#w-play")).toBeDisabled();
  expect(errors).toEqual([]);
});

test("the saved record is valid JSON that the engine replays to the same game", async ({ page }) => {
  const errors = await startWatch(page, "1939", { seed: "4242", speed: "turbo", turns: "1" });
  await expect(page.locator(".watch-summary")).toBeVisible({ timeout: 30_000 });
  const [download] = await Promise.all([page.waitForEvent("download"), page.locator("#w-save").click()]);
  expect(download.suggestedFilename()).toBe("1939-seed4242.json");
  const file = await download.path();
  const rec = JSON.parse(readFileSync(file, "utf8")) as { format: number; scenario: string; seed: number; ended: string; setupActions: number; actions: unknown[] };
  expect(rec).toMatchObject({ format: 1, scenario: "1939", seed: 4242, ended: "turn-limit" });
  expect(rec.actions.length).toBeGreaterThan(rec.setupActions + 10);
  // The engine (which reads the map as JSON) cannot be loaded by Playwright itself: Vitest replays the downloaded file.
  execFileSync("npx", ["vitest", "run", "tests/watch-record-file.test.ts"], { env: { ...process.env, WATCH_RECORD: file }, stdio: "pipe" });
  const shown = Number(/action (\d+)/.exec(await status(page))![1]);
  expect(rec.actions.length - rec.setupActions).toBe(shown);
  expect(errors).toEqual([]);
});

test("take over: the game becomes a normal single-player game where it stood", async ({ page }) => {
  const errors = await startWatch(page, "1939", { seed: "8", speed: "fast" });
  await expect.poll(() => actions(page)).toBeGreaterThan(5);
  await page.locator("#w-take-allies").click();
  await expect(page.locator("#watchbar")).toBeHidden();
  await expect(page.locator("#side")).toHaveValue("allies");
  await expect(page.locator("ol.log")).toContainText("You take over the Allied side");
  // The human can now end a turn of the Allied side when it comes up; the computer plays the Axis one.
  await expect(page.locator(".actions button[data-action], .computer-status").first()).toBeVisible({ timeout: 20_000 });
  const turn = await page.locator(".turn").innerText();
  for (let i = 0; i < 40 && (await page.locator(".turn").innerText()) === turn; i++) {
    const buttons = page.locator(".actions button[data-action]");
    if (await buttons.count()) await buttons.last().click();
    else await page.waitForTimeout(150);
  }
  expect(await page.locator(".turn").innerText()).not.toBe(turn);
  expect(errors).toEqual([]);
});

test("stop watching returns to the setup menu; map taps only inspect", async ({ page }) => {
  const errors = await startWatch(page, "1939", { seed: "2", speed: "slow" });
  await page.locator("#w-play").click();
  await page.locator("svg.map g.hexes polygon:not(.sea)").nth(400).click({ force: true });
  await expect(page.locator("#hexinfo")).toContainText("Front");
  expect(await page.locator("#w-status").innerText()).toContain("paused");
  await page.locator("#w-stop").click();
  await expect(page.locator("#watchbar")).toBeHidden();
  await expect(page.locator(".setup h2")).toContainText("Your setup");
  expect(errors).toEqual([]);
});

test("tapping a hex with counters lists them in the hex info", async ({ page, hasTouch }) => {
  await startWatch(page, "1939", { seed: "2", speed: "slow" });
  await page.locator("#w-play").click();
  const pt = await page.locator("svg.map").evaluate((svg) => {
    const at = svg.querySelector("g.units g[data-at]")!.getAttribute("data-at")!;
    const r = svg.querySelector(`g.hexes polygon[data-id="${at}"]`)!.getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2] as const;
  });
  if (hasTouch) await page.touchscreen.tap(pt[0], pt[1]); else await page.mouse.click(pt[0], pt[1]);
  await expect(page.locator("#hexinfo")).toContainText("Units: ");
});

test("phone: the controls are 44 px targets, in view, and the page does not scroll sideways", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = await startWatch(page, "1939", { seed: "6", speed: "fast" });
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  for (const id of ["w-play", "w-step", "w-turn", "w-speed"]) {
    const box = (await page.locator(`#${id}`).boundingBox())!;
    expect(box.height, id).toBeGreaterThanOrEqual(44);
    expect(box.y, `${id} in view with the panels scrolled`).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, id).toBeLessThanOrEqual(390);
  }
  const dock = (await page.locator(".map-dock").boundingBox())!;
  expect(dock.y).toBeLessThan(2);
  expect(dock.height).toBeLessThanOrEqual(844 * 0.62);
  expect((await page.locator(".map-wrap").boundingBox())!.height).toBeGreaterThan(844 * 0.25);
  await expect(page.locator("#w-status")).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await expect.poll(() => actions(page)).toBeGreaterThan(3);
  expect(errors).toEqual([]);
});
