import { describe, expect, it } from "vitest";
import { continueCard, openingText } from "../src/ui/continueCard";
import type { SavedGameRow } from "../src/ui/savedGames";
import type { SaveFile } from "../src/save/format";

const row = (actions: number, snapshot = false): SavedGameRow => ({ id: "autosave", title: "Autosave", detail: "Saved position",
  save: { actions: Array.from({ length: actions }, () => ({ type: "END_STEP" })), start: snapshot ? { kind: "snapshot", state: {} } : { kind: "new" } } as unknown as SaveFile });
describe("spec 11 Continue card", () => {
  it("Part E sketch 2: absent, damaged and unplayed autosaves show no offer", () => {
    expect(continueCard([])).toBeUndefined(); expect(continueCard([{ id: "autosave", title: "Bad", detail: "Cannot be opened" }])).toBeUndefined();
    expect(continueCard([row(0)])).toBeUndefined();
  });
  it("Part D/E: only autosave progress is offered, including a rescued snapshot with no later moves", () => {
    const saved = row(1); expect(continueCard([saved])).toBe(saved);
    expect(continueCard([{ ...saved, id: "named" }])).toBeUndefined();
    const rescued = row(0, true); expect(continueCard([rescued])).toBe(rescued);
  });
  it("Part E: bounded replay progress and an empty completed record", () => {
    expect(openingText(2, 5)).toBe("Opening your game... 40%"); expect(openingText(0, 0)).toContain("100%");
    expect(openingText(-1, 5)).toContain("0%"); expect(openingText(6, 5)).toContain("100%");
  });
});
