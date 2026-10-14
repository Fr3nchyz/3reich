import type { Shell } from "./shell";
import type { Speed } from "./watchController";

/** The watch options in the scenario menu (spec 06): shown only when "Watch the computer play both sides" is the chosen mode, with a seed that is always visible. */

const MAX_SEED = 0xffffffff;

/** A seed typed by the player: a whole number from 0 to 4294967295, else null. */
export function parseSeed(text: string): number | null {
  const t = text.trim();
  if (!/^\d{1,10}$/.test(t)) return null;
  const n = Number(t);
  return n <= MAX_SEED ? n : null;
}

/** The number of Game Turns to play, or null for "to the end of the scenario". */
export function parseTurns(text: string): number | null {
  const n = Number(text.trim());
  return text.trim() !== "" && Number.isInteger(n) && n >= 1 ? n : null;
}

export interface WatchMenu {
  /** Shows or hides the options for the chosen mode, and fills the seed field if it is empty. */
  refresh: () => void;
  /** What the options say now; a seed that is missing or not a number is replaced by a fresh one, written into the field. */
  read: () => { seed: number; turns: number | null; speed: Speed };
}

export function watchMenu(shell: Shell, newSeed: () => number): WatchMenu {
  const refresh = (): void => {
    shell.watchOpts.hidden = shell.side.value !== "watch";
    shell.side.classList.toggle("wide", !shell.watchOpts.hidden);
    if (!shell.watchOpts.hidden && parseSeed(shell.seed.value) === null) shell.seed.value = String(newSeed());
  };
  shell.side.addEventListener("change", refresh);
  shell.seedRandom.addEventListener("click", () => { shell.seed.value = String(newSeed()); });
  const read = () => {
    let seed = parseSeed(shell.seed.value);
    if (seed === null) { seed = newSeed(); shell.seed.value = String(seed); }
    const speed = (shell.watchBar.querySelector<HTMLSelectElement>("#w-speed")?.value ?? "normal") as Speed;
    return { seed, turns: parseTurns(shell.watchTurns.value), speed };
  };
  return { refresh, read };
}
