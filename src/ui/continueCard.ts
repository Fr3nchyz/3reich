import type { SavedGameRow } from "./savedGames";

/** Spec 11 E sketch 2 / D: nonblocking, and only an autosave with progress. */
export function continueCard(rows: SavedGameRow[]): SavedGameRow | undefined {
  return rows.find(row => row.id === "autosave" && row.save !== undefined &&
    (row.save.actions.length > 0 || row.save.start.kind === "snapshot"));
}

/** Spec 11 E: sliced replay announces bounded percentage, including empty records. */
export function openingText(completed: number, total: number): string {
  const percent = total === 0 ? 100 : Math.max(0, Math.min(100, Math.floor(completed / total * 100)));
  return `Opening your game... ${percent}%`;
}
