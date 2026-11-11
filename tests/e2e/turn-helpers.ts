import { expect, test, type Page } from "@playwright/test";

/** #351, spec 12 AER75: human starts enable manual fleet movement; decline it before ground movement. */
export async function passFleetMovement(page: Page): Promise<void> {
  await expect(page.locator(".turn")).toContainText("step 6b");
  await page.locator("#fleet-done").click();
  await expect(page.locator(".turn")).not.toContainText("step 6b");
}

/** #351, spec 09 AER76: optional fleet movement and the human defender's DAS answer have their own controls. */
export async function passOptionalStep(page: Page): Promise<boolean> {
  if (await page.locator("#fleet-done").count()) {
    await passFleetMovement(page);
    return true;
  }
  if (await page.locator("#air-mission-pass").count()) {
    await page.locator("#air-mission-pass").click();
    return true;
  }
  return false;
}

/** Walk the displayed step, rather than assuming which optional stops a scenario reaches.
 * #351 adds fleet/DAS answers; #354 adds 7b stops. Card-owned closing buttons also
 * sit outside .actions (notably the Free Siberian Transfer at 8a).
 */
async function turnControl(page: Page) {
  // Round 9: later scenarios can spend over 30 seconds on one computer step.
  const totalWaitMs = 300_000;
  const stallMs = 30_000;
  // Leave room for setup and assertions around the bounded wait.
  test.setTimeout(Math.max(test.info().timeout, totalWaitMs + 30_000));
  let next = page.locator(".actions button").last();
  const turn = await page.locator(".turn").innerText();
  let lastTurn = turn;
  let lastProgressAt = Date.now();
  const lossChoices = page.locator("details.declarations").filter({
    has: page.locator("summary", { hasText: /^All ways to lose, as a list/ }),
  });
  let chooseLosses = false;
  const ready = async () => {
    // Spec 11 D / Ops 5.49b: autosave does not answer 10b. Human turns
    // use the ordinary End turn action below; computer turns expose no buttons.
    // Give the computer time to finish its work without spending a walk iteration.
    if (await page.locator(".computer-status").count()) {
      lastProgressAt = Date.now();
      return false;
    }
    // Spec 07 State 4 / Ref 12.2: the human can owe Exchange losses during the
    // computer's turn. legalActions withholds END_STEP until they are settled.
    // choiceView omits quick picks when there is only one group; the list in
    // statusView always offers the legal sets, including that single-group case.
    if (await page.locator(".losscard").isVisible() && await lossChoices.count()) {
      chooseLosses = true;
      return true;
    }
    const step = /step (\S+)/.exec(await page.locator(".turn").innerText())?.[1];
    const selectors = [
      "#minor-auto", "#minor-end-combat",
      ...(step === "6b" ? ["#fleet-done"] : []),
      "#fleet-pass", "#fleet-resolve", "#air-mission-pass", "#air-mission-resolve", "#sea-air-resolve",
      // Spec 16 D2: skip optional Attrition, or answer the computer's losses/retreat first.
      '[data-attrition-action="next"]', '[data-attrition-action="auto"]', '[data-attrition-action="confirm"]',
      ".attrition-card button[data-attrition-action]:enabled",
      ".siberian-buttons button[data-action]", ".winter-buttons button[data-action]", ".surrender-buttons button[data-action]",
      ".actions button",
    ];
    for (const selector of selectors) {
      const button = page.locator(selector).filter({ visible: true }).last();
      if (await button.count() && await button.isEnabled()) {
        next = button;
        return true;
      }
    }
    return false;
  };
  try {
    let stalled = false;
    await expect.poll(async () => {
      const current = await page.locator(".turn").innerText();
      if (current !== lastTurn) {
        lastTurn = current;
        lastProgressAt = Date.now();
      }
      if (await ready()) return true;
      stalled = Date.now() - lastProgressAt >= stallMs;
      return stalled;
    }, { message: `A control to continue from ${turn}`, timeout: totalWaitMs }).toBe(true);
    expect(stalled, `No turn progress for ${stallMs} ms`).toBe(false);
  } catch (cause) {
    // The computer may have crossed several steps since this call began.
    const current = await page.locator(".turn").innerText();
    const status = await page.locator(".computer-status, .toast, .next-text, .saved-hint, #save-notice").allTextContents();
    throw new Error(`Walk started at ${turn}; now at ${current}. Status: ${status.join("; ")}`, { cause });
  }
  return { next, chooseLosses, lossChoices };
}

/** Wait for a human answer, including answers owed during the computer's turn. */
export async function waitForTurnStep(page: Page): Promise<void> {
  await turnControl(page);
}

export async function advanceTurnStep(page: Page): Promise<string> {
  const { next, chooseLosses, lossChoices } = await turnControl(page);
  let label: string;
  if (chooseLosses) {
    if (await lossChoices.getAttribute("open") === null) await lossChoices.locator("summary").click();
    const loss = lossChoices.locator("button[data-action]").first();
    await expect(loss).toBeVisible();
    await expect(loss).toBeEnabled();
    label = (await loss.innerText()).trim();
    await loss.click();
    await expect(page.locator(".toast")).toBeEmpty();
  } else {
    label = (await next.innerText()).trim();
    await next.click();
  }
  // Ticket 15-14-2 (#304): automatic minor placement is a draft until Done.
  if (await page.locator("#minor-done").count()) {
    await expect(page.locator("#minor-done")).toBeEnabled();
    await page.locator("#minor-done").click();
  }
  return label;
}
