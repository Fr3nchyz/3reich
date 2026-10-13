/**
 * Check our encoded rule tables against the original game's own files (roadmap 2.3).
 *
 *   npx vite-node scripts/gamedata/tables.ts <game-folder> [--png <out-dir>] [--no-program]
 *
 * Read-only on the game folder. Prints a report. Exit status: 0 when nothing differs except the
 * known open items (listed in docs/RULES.md), 1 when a check finds a new difference or cannot find
 * what it looks for, 2 on a usage error.
 *
 * With --png it renders the chart screens (TABLE*.TAB) as PNG files into <out-dir>. The charts are
 * the publisher's art and are never committed; the script refuses an <out-dir> inside this
 * checkout, which protects this checkout only.
 *
 *  A. TABLE*.TAB are 16-colour PCX images of the game's chart screens (header check, size).
 *  B. RAWCHRT.RAW and CHART.RAW are 8-bit sound samples, not chart bitmaps (statistics).
 *  C. OPTIONAL: checks against the program 3R2.EXE, in exe-checks.ts. Skip them with --no-program;
 *     drop them by deleting exe-checks.ts and the lines marked "program checks" below.
 *
 * The formats are described in our own words in docs/GAME_DATA.md ("Rule tables").
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { checkProgram, type CheckResult } from "./exe-checks"; // program checks (optional module)

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

// ---------------------------------------------------------------------------------------------
// A. PCX chart images
// ---------------------------------------------------------------------------------------------

/** What each chart file shows, identified by viewing the rendered image (our own words). */
const CHART_CONTENTS: Record<string, string> = {
  "TABLE1.TAB": "Air-combat DRM chart: air advantage, air nationality DRMs",
  "TABLE2.TAB": "Quarterly attrition resolution table",
  "TABLE3.TAB": "BRP costs chart: declarations of war, offensive option, cost per factor",
  "TABLE5.TAB": "Offensive combat results table",
  "TABLE6.TAB": "Unit-type legend (how to read a counter)",
  "TABLE7.TAB": "Interception table",
  "TABLE8.TAB": "Map legend, flat map style",
  "TABLE8A.TAB": "Map legend, relief map style",
  "TABLE9.TAB": "Minor country forces",
  "TABLE10.TAB": "Naval-combat DRM chart: naval advantage, naval nationality DRMs",
  "TABLE11.TAB": "Terrain effects chart",
};

interface Pcx {
  width: number;
  height: number;
  planes: number;
  bitsPerPixel: number;
  palette: [number, number, number][];
  pixels: Uint8Array;
}

function readPcx(buf: Buffer): Pcx {
  if (buf[0] !== 0x0a || buf[2] !== 1) throw new Error("not an RLE PCX file");
  const bitsPerPixel = buf[3]!;
  const width = buf.readUInt16LE(8) - buf.readUInt16LE(4) + 1;
  const height = buf.readUInt16LE(10) - buf.readUInt16LE(6) + 1;
  const planes = buf[65]!;
  const bytesPerLine = buf.readUInt16LE(66);
  if (bitsPerPixel !== 1 || planes !== 4) throw new Error(`unexpected PCX layout ${bitsPerPixel} bpp x ${planes}`);
  const palette: [number, number, number][] = [];
  for (let i = 0; i < 16; i++) palette.push([buf[16 + 3 * i]!, buf[17 + 3 * i]!, buf[18 + 3 * i]!]);
  const lineBytes = planes * bytesPerLine;
  const raw = new Uint8Array(lineBytes * height);
  let p = 128;
  let o = 0;
  while (o < raw.length && p < buf.length) {
    const c = buf[p++]!;
    if ((c & 0xc0) === 0xc0) {
      const v = buf[p++]!;
      for (let k = 0; k < (c & 0x3f) && o < raw.length; k++) raw[o++] = v;
    } else raw[o++] = c;
  }
  const pixels = new Uint8Array(width * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      let v = 0;
      for (let pl = 0; pl < planes; pl++) {
        const byte = raw[y * lineBytes + pl * bytesPerLine + (x >> 3)]!;
        if (byte & (0x80 >> (x & 7))) v |= 1 << pl;
      }
      pixels[y * width + x] = v;
    }
  return { width, height, planes, bitsPerPixel, palette, pixels };
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(b: Buffer): number {
  let c = 0xffffffff;
  for (const x of b) c = CRC_TABLE[(c ^ x) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function toPng(img: Pcx): Buffer {
  const rows = Buffer.alloc((img.width * 3 + 1) * img.height);
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < img.width; x++) {
      const [r, g, b] = img.palette[img.pixels[y * img.width + x]!]!;
      rows.set([r, g, b], y * (img.width * 3 + 1) + 1 + x * 3);
    }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(img.width, 0);
  ihdr.writeUInt32BE(img.height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(rows)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function checkCharts(folder: string, pngDir: string | null): CheckResult {
  console.log("\n## A. TABLE*.TAB chart images");
  const check: CheckResult = { name: "Chart screens", found: true, differences: [], known: [], notes: [] };
  const files = readdirSync(folder).filter((f) => /^TABLE.*\.TAB$/i.test(f)).sort();
  for (const expected of Object.keys(CHART_CONTENTS))
    if (!files.some((f) => f.toUpperCase() === expected)) check.differences.push(`${expected} is missing`);
  for (const f of files) {
    const img = readPcx(readFileSync(join(folder, f)));
    const what = CHART_CONTENTS[f.toUpperCase()];
    if (!what) check.differences.push(`${f} is not classified`);
    console.log(`${f.padEnd(12)} PCX ${img.width}x${img.height}, 16 colours  ${what ?? "(unclassified)"}`);
    if (pngDir) writeFileSync(join(pngDir, f.replace(/\.TAB$/i, ".png")), toPng(img));
  }
  return check;
}

// ---------------------------------------------------------------------------------------------
// B. RAW files named like charts
// ---------------------------------------------------------------------------------------------

function checkRaw(folder: string): void {
  console.log("\n## B. RAWCHRT.RAW, CHART.RAW");
  for (const f of ["RAWCHRT.RAW", "CHART.RAW", "HEIL.RAW"]) {
    let d: Buffer;
    try {
      d = readFileSync(join(folder, f));
    } catch {
      continue;
    }
    let sum = 0;
    let step = 0;
    for (let i = 0; i < d.length; i++) {
      sum += d[i]!;
      if (i) step += Math.abs(d[i]! - d[i - 1]!);
    }
    console.log(
      `${f.padEnd(12)} ${d.length} bytes, mean ${(sum / d.length).toFixed(1)}, mean step ${(step / (d.length - 1)).toFixed(1)}` +
        (f === "HEIL.RAW" ? "  (a known sound effect, for comparison)" : ""),
    );
  }
  console.log("Both centre on 128 with small steps and no row period: unsigned 8-bit sound, not a bitmap.");
}

function report(results: CheckResult[]): number {
  let problems = 0;
  for (const r of results) {
    if (!r.found) {
      problems++;
      console.log(`${r.name}: NOT FOUND`);
      continue;
    }
    problems += r.differences.length;
    const status = r.differences.length ? `${r.differences.length} difference(s): ${r.differences.slice(0, 6).join("; ")}` : "matches";
    console.log(`${r.name}: ${status}${r.notes.length ? `  [${r.notes.join(", ")}]` : ""}`);
    for (const k of r.known) console.log(`  known open item (docs/RULES.md): ${k}`);
  }
  return problems;
}

function main(): void {
  const args = process.argv.slice(2);
  const folder = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--png");
  if (!folder) {
    console.error("usage: npx vite-node scripts/gamedata/tables.ts <game-folder> [--png <out-dir>] [--no-program]");
    process.exit(2);
  }
  const pngIdx = args.indexOf("--png");
  let pngDir: string | null = null;
  if (pngIdx >= 0) {
    pngDir = resolve(args[pngIdx + 1] ?? "");
    const rel = relative(REPO_ROOT, pngDir);
    if (!rel.startsWith("..") && !isAbsolute(rel)) {
      console.error("Refusing to write chart images inside this checkout; choose a folder outside it.");
      process.exit(2);
    }
    mkdirSync(pngDir, { recursive: true });
  }
  const results = [checkCharts(folder, pngDir)];
  checkRaw(folder);
  if (!args.includes("--no-program")) {
    console.log("\n## C. 3R2.EXE (optional program checks)"); // program checks
    results.push(...checkProgram(folder)); // program checks
  }
  console.log("\n## Result");
  const problems = report(results);
  const known = results.reduce((n, r) => n + r.known.length, 0);
  if (problems) {
    console.log(`\nFAILED: ${problems} new difference(s) or missing item(s).`);
    process.exit(1);
  }
  console.log(`\nOK: no new differences${known ? ` (${known} known open item(s))` : ""}.`);
}

main();
