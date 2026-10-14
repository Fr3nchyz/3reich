import type { Shell } from "./shell";
import type { Speed } from "./watchController";

/** The watch options in the scenario menu (spec 06): shown only when "Watch the computer play both sides" is the chosen mode, with a seed that is always visible. */

export const MAX_SEED = 0xffffffff;
export const MAX_TURNS = 99;

export const SEED_ERROR = `The seed must be a whole number from 0 to ${MAX_SEED}.`;
export const TURNS_ERROR = `Game Turns must be a whole number from 1 to ${MAX_TURNS}, or empty to play to the end.`;

/** A seed typed by the player: a whole number from 0 to 4294967295, else null. */
export function parseSeed(text: string): number | null {
  const t = text.trim();
  if (!/^\d{1,10}$/.test(t)) return null;
  const n = Number(t);
  return n <= MAX_SEED ? n : null;
}

/** The number of Game Turns to play (1 to 99), or null for "to the end of the scenario" (an empty field) or a value that is not valid (see `turnsError`). */
export function parseTurns(text: string): number | null {
  const t = text.trim();
  if (!/^\d{1,3}$/.test(t)) return null;
  const n = Number(t);
  return n >= 1 && n <= MAX_TURNS ? n : null;
}

/** The message for a seed field that cannot be used, or "" when it can. */
export const seedError = (text: string): string => (parseSeed(text) === null ? SEED_ERROR : "");
/** The message for a Game Turns field that cannot be used (an empty one is fine), or "". */
export const turnsError = (text: string): string => (text.trim() === "" || parseTurns(text) !== null ? "" : TURNS_ERROR);

export interface WatchMenu {
  /** Shows or hides the options for the chosen mode, and fills the seed field if it is empty. */
  refresh: () => void;
  /** Hides the options while a watched game is on (the map gets the room); choosing the mode again brings them back. */
  collapse: () => void;
  /** What the options say now, or null with the problems shown next to the fields (aria-invalid and a message) when they cannot be used. */
  read: () => { seed: number; turns: number | null; speed: Speed } | null;
}

export function watchMenu(shell: Shell, newSeed: () => number): WatchMenu {
  let collapsed = false;
  const mark = (input: HTMLInputElement, error: string): void => {
    if (error) input.setAttribute("aria-invalid", "true");
    else input.removeAttribute("aria-invalid");
  };
  const check = (): string => {
    const problems = [seedError(shell.seed.value), turnsError(shell.watchTurns.value)];
    mark(shell.seed, problems[0]!);
    mark(shell.watchTurns, problems[1]!);
    shell.menuError.textContent = problems.filter(Boolean).join(" ");
    return shell.menuError.textContent;
  };
  const refresh = (): void => {
    shell.watchOpts.hidden = shell.side.value !== "watch" || collapsed;
    shell.side.classList.toggle("wide", shell.side.value === "watch");
    if (!shell.watchOpts.hidden && shell.seed.value.trim() === "") shell.seed.value = String(newSeed());
  };
  shell.side.addEventListener("change", () => { collapsed = false; refresh(); });
  shell.seedRandom.addEventListener("click", () => { shell.seed.value = String(newSeed()); check(); });
  shell.seed.addEventListener("input", check);
  shell.watchTurns.addEventListener("input", check);
  return {
    refresh,
    collapse: () => { collapsed = true; refresh(); },
    read: () => {
      if (check()) return null;
      const speed = (shell.watchBar.querySelector<HTMLSelectElement>("#w-speed")?.value ?? "normal") as Speed;
      return { seed: parseSeed(shell.seed.value)!, turns: parseTurns(shell.watchTurns.value), speed };
    },
  };
}
