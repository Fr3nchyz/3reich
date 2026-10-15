import { expect, test } from "@playwright/test";

/** Attack marks (spec 07, 07-5): drawn from data through a test hook, never in the way of taps. The attack flow itself is ticket 07-6. */

const MARKS = { targets: ["M35", "N33", "M33"], chosen: "M35", attackers: ["L34", "L33"] };

test("attack marks appear for the given hexes, differ from the yellow highlights, and clear", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.locator("#newgame").click();
  await page.evaluate(() => document.getElementById("wholemap")!.click());
  const layer = page.locator("svg.map g.attack-marks");
  await expect(layer).toBeAttached();
  await expect(layer.locator("*")).toHaveCount(0);
  const before = await page.locator("svg.map *").count();

  await page.locator("svg.map").evaluate((svg, marks) => svg.dispatchEvent(new CustomEvent("attack-marks", { detail: marks })), MARKS);
  await expect(layer.locator(".mk-target")).toHaveCount(2);
  await expect(layer.locator(".mk-chosen")).toHaveCount(1);
  await expect(layer.locator(".mk-attacker")).toHaveCount(2);
  await expect(layer.locator(".pip")).toHaveCount(2);
  expect(await page.locator("svg.map *").count() - before, "marks add only a few nodes").toBeLessThan(20);

  const style = await layer.evaluate((g) => {
    const css = (sel: string) => getComputedStyle(g.querySelector(sel)!);
    const hl = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
    document.querySelector("g.highlights")!.append(hl);
    const hlStyle = getComputedStyle(hl);
    const out = {
      layerEvents: getComputedStyle(g).pointerEvents,
      allNone: [...g.querySelectorAll("*")].every((n) => getComputedStyle(n).pointerEvents === "none"),
      targetDash: css(".mk-target").strokeDasharray, targetW: parseFloat(css(".mk-target").strokeWidth),
      chosenDash: css(".mk-chosen").strokeDasharray, chosenW: parseFloat(css(".mk-chosen").strokeWidth),
      attackerDash: css(".mk-attacker").strokeDasharray, attackerStroke: css(".mk-attacker").stroke, targetStroke: css(".mk-target").stroke,
      nonScaling: css(".mk-chosen").vectorEffect, hlStroke: hlStyle.stroke,
    };
    hl.remove();
    return out;
  });
  expect(style.layerEvents).toBe("none");
  expect(style.allNone).toBe(true);
  expect(style.targetDash, "targets are dashed").not.toBe("none");
  expect(style.chosenDash, "the chosen target and the attackers are solid").toBe("none");
  expect(style.attackerDash).toBe("none");
  expect(style.chosenW, "chosen is the thickest").toBeGreaterThan(style.targetW);
  expect(style.nonScaling, "widths are screen pixels at any zoom").toBe("non-scaling-stroke");
  expect(style.attackerStroke).not.toBe(style.targetStroke);
  expect(style.targetStroke).not.toBe(style.hlStroke);
  expect(style.attackerStroke).not.toBe(style.hlStroke);

  await page.locator("svg.map").evaluate((svg) => svg.dispatchEvent(new CustomEvent("attack-marks", { detail: null })));
  await expect(layer.locator("*")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("a tap on a marked hex still reaches the map (marks do not take taps)", async ({ page, hasTouch }) => {
  await page.goto("/");
  await page.locator("#newgame").click();
  await page.locator(".setup button[data-spec]").first().click();
  await page.evaluate(() => window.scrollTo(0, 0));
  const spot = await page.locator("svg.map").evaluate((svg) => {
    const box = svg.getBoundingClientRect();
    for (const p of svg.querySelectorAll("g.highlights polygon")) {
      const r = p.getBoundingClientRect();
      if (r.left > Math.max(box.left, 0) + 8 && r.right < Math.min(box.right, innerWidth) - 8 && r.top > Math.max(box.top, 0) + 8 && r.bottom < Math.min(box.bottom, innerHeight) - 8) {
        return { x: r.left + r.width / 2, y: r.top + r.height / 2, id: p.getAttribute("data-hl")! };
      }
    }
    return null;
  });
  if (!spot) throw new Error("no highlighted hex is visible");
  // Mark that very hex as target, chosen target and attacker in turn: each time the tap must place the counter.
  await page.locator("svg.map").evaluate((svg, id) => svg.dispatchEvent(new CustomEvent("attack-marks", { detail: { targets: [id], chosen: id, attackers: [id] } })), spot.id);
  await expect(page.locator("g.attack-marks [data-mk-chosen]")).toHaveCount(1);
  const before = await page.locator("g.units > g").count();
  if (hasTouch) await page.touchscreen.tap(spot.x, spot.y);
  else await page.mouse.click(spot.x, spot.y);
  await expect(page.locator("g.units > g")).toHaveCount(before + 1);
});
