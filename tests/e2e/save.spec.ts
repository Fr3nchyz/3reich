import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import type { SaveFile } from "../../src/save/format";

// Spec 11 Parts D/I: use real browser storage; observe committed transactions, not fixed sleeps.
async function entries(page: Page): Promise<Record<string, SaveFile>> {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open("3reich-saves", 1);
    request.onerror = () => reject(request.error ?? new Error("Storage open failed"));
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction("saves", "readonly");
      const result: Record<string, SaveFile> = {};
      const cursor = tx.objectStore("saves").openCursor();
      cursor.onsuccess = () => {
        const row = cursor.result;
        if (row) { result[typeof row.key === "string" ? row.key : ""] = row.value as SaveFile; row.continue(); }
      };
      tx.oncomplete = () => { db.close(); resolve(result); };
      tx.onabort = () => { db.close(); reject(tx.error ?? new Error("Storage read failed")); };
    };
  }));
}

async function editStorage(page: Page, damage = false): Promise<void> {
  await page.evaluate(broken => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("3reich-saves", 1);
    request.onerror = () => reject(request.error ?? new Error("Storage open failed"));
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction("saves", "readwrite");
      const store = tx.objectStore("saves");
      if (broken) store.put({ format: 2, seed: "damaged" }, "broken-entry");
      else store.clear();
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onabort = () => { db.close(); reject(tx.error ?? new Error("Storage write failed")); };
    };
  }), damage);
}

const sheet = (page: Page) => page.getByRole("dialog", { name: "Saved games" });
const row = (page: Page, title: string) => page.locator("#saved-content section").filter({ has: page.getByRole("heading", { name: title, exact: true }) });
const position = async (page: Page) => ({
  status: await page.locator(".turn").innerText(),
  counters: await page.locator("g.units").innerHTML(),
});

async function atMovement(page: Page): Promise<void> {
  await page.goto("/");
  await page.locator("#scenario").selectOption("1939");
  await page.locator("#side").selectOption("axis");
  await page.locator("#newgame").click();
  for (let i = 0; i < 12 && await page.locator("#fill").count(); i++) await page.locator("#fill").click();
  // Spec 11 I.1: reach 6f through the same setup/front controls as move.spec.ts.
  await expect(page.locator(".turn")).toContainText("step 1");
  await page.locator(".actions button[data-action]").last().click();
  await expect(page.locator(".turn")).toContainText("step 3");
  await page.locator("summary", { hasText: "Choose a Front Option" }).click();
  await page.getByRole("button", { name: "Eastern Front: Offensive Option", exact: true }).click();
  await page.locator(".actions button[data-action]").last().click();
  await expect(page.locator(".turn")).toContainText("step 6f");
}

async function move(page: Page, touch: boolean): Promise<void> {
  await page.evaluate(() => window.scrollTo(0, 0));
  const centres = (selector: string) => page.locator("svg.map").evaluate((svg, sel) => {
    const box = svg.getBoundingClientRect();
    return [...svg.querySelectorAll(sel)].flatMap(el => {
      const r = el.getBoundingClientRect();
      return r.left > Math.max(box.left, 0) + 8 && r.right < Math.min(box.right, innerWidth) - 8 &&
        r.top > Math.max(box.top, 0) + 8 && r.bottom < Math.min(box.bottom, innerHeight) - 8
        ? [[r.left + r.width / 2, r.top + r.height / 2] as const] : [];
    });
  }, selector);
  const tap = async (pt: readonly [number, number]) => {
    if (touch) await page.touchscreen.tap(...pt);
    else await page.mouse.click(...pt);
  };
  const before = await position(page);
  for (const pt of await centres("g.units > g")) {
    await tap(pt);
    const destination = (await centres("g.highlights polygon"))[0];
    if (!destination) continue;
    await tap(destination);
    await expect.poll(() => position(page)).not.toEqual(before);
    await expect(page.locator("g.highlights polygon")).toHaveCount(0);
    return;
  }
  throw new Error("No visible stack has a visible movement destination");
}

async function savedPosition(page: Page): Promise<SaveFile> {
  await expect.poll(async () => (await entries(page)).autosave?.snapshot.position).toMatchObject({ step: "6f" });
  return (await entries(page)).autosave!;
}

async function saveAs(page: Page, title: string): Promise<void> {
  await page.locator("#savedgames").click();
  await sheet(page).getByRole("button", { name: "Save this game as...", exact: true }).click();
  await sheet(page).getByLabel("Save this game as...").fill(title);
  await sheet(page).getByRole("button", { name: "Save", exact: true }).click();
  await expect(row(page, title)).toBeVisible();
}

// Spec 11 E/H: every flow must remain free of uncaught browser exceptions.
test.beforeEach(({ page }) => {
  page.on("pageerror", error => { throw error; });
});

test("autosave and Continue restore step 6f and hex contents after a move", async ({ page, hasTouch }) => {
  await atMovement(page);
  const previous = await savedPosition(page);
  await move(page, hasTouch);
  const expected = await position(page);
  await expect.poll(async () => (await entries(page)).autosave?.fingerprint).not.toBe(previous.fingerprint);
  await page.reload();
  await expect(page.locator("#continue-game")).toBeVisible();
  await page.locator("#continue-game").getByRole("button", { name: "Continue", exact: true }).click();
  await expect(sheet(page)).not.toBeVisible();
  await expect.poll(() => position(page)).toEqual(expected); // Spec 11 I.1.
  await expect(page.locator("#continue-game")).toBeHidden();
  await expect(page.locator("#status :focus")).toHaveCount(1); // Part E touch flow 3.
});

test("a fresh game preserves autosave until play, then rotates Earlier game", async ({ page, hasTouch }) => {
  await atMovement(page);
  await move(page, hasTouch);
  await savedPosition(page);
  // Wait for the move's debounce before capturing the complete old entry.
  await expect.poll(async () => (await entries(page)).autosave?.actions.at(-1)?.type).toBe("MOVE");
  const old = (await entries(page)).autosave!;
  await page.reload();
  await expect(page.locator("#continue-game")).toBeVisible();
  await page.locator("#newgame").click();
  // Spec 11 D/I.2: wait beyond the 1 s debounce without arming the fresh game.
  await page.waitForTimeout(1500);
  expect((await entries(page)).autosave).toEqual(old);
  await page.locator("#fill").click(); // First accepted placement batch arms autosave (Part G).
  await expect.poll(async () => (await entries(page)).autosave?.fingerprint).not.toBe(old.fingerprint);
  expect((await entries(page))["earlier-game"]).toEqual(old);
  await page.locator("#savedgames").click();
  await expect(row(page, "Earlier game")).toBeVisible();
  await row(page, "Earlier game").getByRole("button", { name: "Open", exact: true }).click();
  await expect(page.locator(".turn")).toContainText("step 6f");
});

test("Save as restores its position and Delete requires confirmation", async ({ page, hasTouch }) => {
  await atMovement(page);
  const original = await position(page);
  await saveAs(page, "Before movement"); // Spec 11 I.3 / E sketch 4.
  await page.locator("#saved-close").click();
  await move(page, hasTouch);
  expect(await position(page)).not.toEqual(original);
  await page.locator("#savedgames").click();
  await row(page, "Before movement").getByRole("button", { name: "Open", exact: true }).click();
  await expect(sheet(page)).not.toBeVisible();
  await expect.poll(() => position(page)).toEqual(original);
  await page.locator("#savedgames").click();
  await row(page, "Before movement").getByRole("button", { name: "Delete", exact: true }).click();
  await expect(sheet(page)).toContainText("Delete 'Before movement'?");
  expect(Object.values(await entries(page)).some(save => save.title === "Before movement")).toBe(true);
  await sheet(page).getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(row(page, "Before movement")).toBeVisible();
  await row(page, "Before movement").getByRole("button", { name: "Delete", exact: true }).click();
  await sheet(page).getByRole("button", { name: "Delete", exact: true }).last().click();
  await expect(row(page, "Before movement")).toHaveCount(0);
  expect(Object.values(await entries(page)).some(save => save.title === "Before movement")).toBe(false);
});

test("save file downloads JSON and opens through the picker at the same position", async ({ page, hasTouch }) => {
  await atMovement(page);
  await move(page, hasTouch);
  const original = await position(page);
  await page.locator("#savedgames").click();
  // Spec 11 F/I.4: exercise Chromium's download fallback and inspect the actual bytes.
  const downloading = page.waitForEvent("download");
  await sheet(page).getByRole("button", { name: "Save to a file", exact: true }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe("3reich-1939-axis-summer1939.json");
  const path = await download.path();
  expect(path).not.toBeNull();
  const buffer = await readFile(path);
  const exported = JSON.parse(buffer.toString()) as SaveFile;
  expect(exported).toMatchObject({ format: 2, app: "3reich", scenario: "1939", humanSide: "axis" });
  await page.locator("#saved-close").click();
  await page.locator("#newgame").click();
  await page.locator("#savedgames").click();
  const before = await entries(page);
  const choosing = page.waitForEvent("filechooser");
  await sheet(page).getByRole("button", { name: "Open a save file", exact: true }).click();
  await (await choosing).setFiles({ name: download.suggestedFilename(), mimeType: "application/json", buffer });
  await expect(sheet(page).getByRole("button", { name: "Continue", exact: true })).toBeVisible();
  expect(await entries(page)).toEqual(before); // Part F/H: no write before acceptance.
  await sheet(page).getByRole("button", { name: "Continue", exact: true }).click();
  await expect.poll(() => position(page)).toEqual(original);
  await expect.poll(async () => Object.entries(await entries(page)).filter(([id]) => id.startsWith("named-")).length).toBe(1);
  const imported = Object.entries(await entries(page)).find(([id]) => id.startsWith("named-"))![1];
  expect(imported.fingerprint).toBe(exported.fingerprint);
  expect(imported.snapshot).toEqual(exported.snapshot);
});

test("corrupt file is refused without changing the position or stored games", async ({ page }) => {
  await atMovement(page);
  await savedPosition(page);
  const original = await position(page);
  const before = await entries(page);
  await page.locator("#savedgames").click();
  const choosing = page.waitForEvent("filechooser");
  await sheet(page).getByRole("button", { name: "Open a save file", exact: true }).click();
  await (await choosing).setFiles({ name: "broken.json", mimeType: "application/json", buffer: Buffer.from('{"format":2,') });
  // Spec 11 H: incomplete JSON gets a plain refusal and never writes.
  await expect(sheet(page)).toContainText("This file is not a 3Reich saved game, or it is incomplete.");
  await expect(sheet(page).getByRole("button", { name: "Continue", exact: true })).toHaveCount(0);
  expect(await entries(page)).toEqual(before);
  await page.locator("#saved-close").click();
  expect(await position(page)).toEqual(original);
  await page.locator(".actions button[data-action]").last().click();
  await expect(page.locator(".turn")).not.toHaveText(original.status); // Play still works (Part E.6).
});

test("cleared IndexedDB starts normally without a Continue card or error", async ({ page }) => {
  await atMovement(page);
  await savedPosition(page);
  await editStorage(page);
  await page.reload(); // Spec 11 I.5.
  await expect(page.locator(".setup h2")).toContainText("Your setup");
  await page.locator("#savedgames").click();
  await expect(sheet(page)).toContainText("No saved games yet.");
  await expect(page.locator("#continue-game")).toBeHidden();
  await expect(page.locator("#save-notice")).toBeEmpty();
  expect(await entries(page)).toEqual({});
});

test("damaged stored entry remains visible beside readable games", async ({ page }) => {
  await atMovement(page);
  await savedPosition(page);
  await editStorage(page, true);
  await page.reload(); // Spec 11 H/I.6: damage never prevents a fresh game or deletes data.
  await expect(page.locator(".setup h2")).toContainText("Your setup");
  await page.locator("#savedgames").click();
  await expect(row(page, "broken-entry")).toContainText("Cannot be opened");
  await expect(row(page, "broken-entry").getByRole("button", { name: "Open", exact: true })).toHaveCount(0);
  await expect(row(page, "broken-entry").getByRole("button", { name: "Delete", exact: true })).toBeVisible();
  await expect(row(page, "Autosave").getByRole("button", { name: "Open", exact: true })).toBeVisible();
  expect((await entries(page))["broken-entry"]).toEqual({ format: 2, seed: "damaged" });
});

test("touch save controls stay usable in both tablet orientations", async ({ page, hasTouch }) => {
  test.skip(!hasTouch, "Spec 11 I.7 is specific to the touch project");
  await atMovement(page);
  await savedPosition(page);
  // Spec 11 E/I.7: include card, list, form, replacement and deletion controls.
  const checkButtons = async (selector: string) => {
    const buttons = page.locator(`${selector} button:visible, ${selector}:is(button):visible`);
    expect(await buttons.count()).toBeGreaterThan(0);
    for (const button of await buttons.all()) {
      await button.scrollIntoViewIfNeeded();
      const box = (await button.boundingBox())!;
      expect(box.width, await button.innerText()).toBeGreaterThanOrEqual(44);
      expect(box.height, await button.innerText()).toBeGreaterThanOrEqual(44);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    }
  };
  for (const viewport of [{ width: 1024, height: 768 }, { width: 768, height: 1024 }]) {
    await page.setViewportSize(viewport);
    await page.reload();
    await expect(page.locator("#continue-game")).toBeVisible();
    await checkButtons("#continue-game");
    await checkButtons("#savedgames");
    await saveAs(page, "Tablet save");
    await checkButtons("#saved-sheet");
    await sheet(page).getByRole("button", { name: "Save this game as...", exact: true }).click();
    await checkButtons("#saved-sheet");
    await sheet(page).getByLabel("Save this game as...").fill("Tablet save");
    await sheet(page).getByRole("button", { name: "Save", exact: true }).click();
    await expect(sheet(page).getByRole("button", { name: "Replace", exact: true })).toBeVisible();
    await checkButtons("#saved-sheet");
    await sheet(page).getByRole("button", { name: "Cancel", exact: true }).click();
    await row(page, "Tablet save").getByRole("button", { name: "Delete", exact: true }).click();
    await checkButtons("#saved-sheet");
    await sheet(page).getByRole("button", { name: "Delete", exact: true }).last().click();
    await expect(row(page, "Tablet save")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(sheet(page)).not.toBeVisible();
    await expect(page.locator("#savedgames")).toBeFocused();
  }
});
