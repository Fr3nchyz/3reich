import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Makes the output folder (inside `root`, as parseArgs checked) and returns its full path. Refuses a path that is a file.
 * The folder gets a .gitignore of its own, so reports are never committed whatever it is called. `existing` says whether
 * it held files already (a new run overwrites those of the same name).
 */
export function prepareOut(root: string, out: string): { dir: string; existing: boolean } {
  const dir = resolve(root, out);
  if (existsSync(dir) && !statSync(dir).isDirectory()) throw new Error(`--out ${out} is a file, not a folder.`);
  const existing = existsSync(dir) && readdirSync(dir).length > 0;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, ".gitignore"), "*\n");
  return { dir, existing };
}
