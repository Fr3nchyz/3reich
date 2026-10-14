/**
 * The activity log as shown: newest entry first, only the latest LOG_LIMIT of them (the session keeps all),
 * and a scroll position that survives the status area being redrawn. The maths is pure and unit tested;
 * captureLog and restoreLog are the thin DOM glue.
 */

/** How many entries the log panel lists; older ones stay in Session.log. */
export const LOG_LIMIT = 200;

/** Within this many pixels of the top counts as "at the top": the reader is following the newest entries. */
const TOP_SLACK = 4;

/** The entries to list: newest first, at most `limit`. */
export const logEntries = (log: readonly string[], limit = LOG_LIMIT): string[] => log.slice(-limit).reverse();

/**
 * Where the log panel's scrollTop should be after a redraw. At the top, stay at the top, so the newest
 * entries show. Otherwise the reader is partway down: the `added` new entries above push everything down
 * by `shift` pixels, and scrolling by the same amount keeps the same entries in view. A shrunk log (a new
 * game) goes back to the top.
 */
export function logScrollTop(prevTop: number, added: number, shift: number): number {
  if (prevTop <= TOP_SLACK || added < 0) return 0;
  return Math.max(0, prevTop + (added > 0 ? shift : 0));
}

/** The panel as it was before a redraw: how far it was scrolled, and how many entries the session had then. */
export interface LogMark {
  top: number;
  total: number;
  /** The scroll position of the whole status column (the side column on wide screens), restored too. */
  column: number;
}

export function captureLog(status: HTMLElement): LogMark {
  const ol = status.querySelector<HTMLElement>("ol.log");
  return { top: ol?.scrollTop ?? 0, total: Number(ol?.dataset.total ?? 0), column: status.scrollTop };
}

/** Puts the redrawn log panel and the status column back where the reader had them. */
export function restoreLog(status: HTMLElement, mark: LogMark): void {
  status.scrollTop = mark.column;
  const ol = status.querySelector<HTMLElement>("ol.log");
  if (!ol) return;
  const added = Number(ol.dataset.total ?? 0) - mark.total;
  const items = ol.querySelectorAll<HTMLElement>("li");
  const first = items[0]?.offsetTop ?? 0;
  const shift = (items[Math.min(Math.max(added, 0), items.length - 1)]?.offsetTop ?? first) - first;
  ol.scrollTop = logScrollTop(mark.top, added, shift);
}

/** The panel's HTML: numbered from the newest entry down, so an entry keeps its number as more arrive. */
export function logHtml(log: readonly string[]): string {
  const shown = logEntries(log);
  const more = log.length > shown.length ? `<li class="log-more">Older entries (${log.length - shown.length}) are not shown.</li>` : "";
  return `<ol class="log" reversed start="${log.length}" data-total="${log.length}" tabindex="0" aria-label="Activity log, newest first">${shown.map((l) => `<li>${l}</li>`).join("")}${more}</ol>`;
}
