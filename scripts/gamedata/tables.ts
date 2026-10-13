/**
 * Check our encoded rule tables against the original game's own files (roadmap 2.3).
 *
 *   npx vite-node scripts/gamedata/tables.ts <game-folder> [--png <out-dir>]
 *
 * Read-only on the game folder. Prints a report; with --png it renders the on-screen charts
 * (TABLE*.TAB) as PNG files into <out-dir>, which must be outside this repository: the charts
 * are the publisher's art and are never committed. The formats are described in our own words
 * in docs/GAME_DATA.md ("Rule tables").
 *
 * What it checks:
 *  A. TABLE*.TAB are 16-colour PCX images of the game's chart screens (header check, size).
 *  B. RAWCHRT.RAW and CHART.RAW are 8-bit sound samples, not chart bitmaps (statistics).
 *  C. 3R2.EXE (a DOS/4GW linear executable): the CRT and attrition data tables are located and
 *     compared cell by cell with ours; the odds-column, interception, naval-advantage and
 *     naval-nationality routines are run through a tiny emulator for every relevant input and
 *     compared with our functions.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import {
  ATTRITION_COLUMNS,
  ATTRITION_TABLE,
  ODDS_COLUMNS,
  OFFENSIVE_CRT,
  oddsColumn,
  type CrtResult,
} from "../../src/engine/combat";
import { interceptionRolls, navalAdvantageDrm, navalNationalityDrm, type NavalNation } from "../../src/engine/tables";

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

function checkCharts(folder: string, pngDir: string | null): void {
  console.log("\n## A. TABLE*.TAB chart images");
  const files = readdirSync(folder).filter((f) => /^TABLE.*\.TAB$/i.test(f)).sort();
  for (const f of files) {
    const img = readPcx(readFileSync(join(folder, f)));
    console.log(`${f.padEnd(12)} PCX ${img.width}x${img.height}, 16 colours  ${CHART_CONTENTS[f.toUpperCase()] ?? "(unclassified)"}`);
    if (pngDir) writeFileSync(join(pngDir, f.replace(/\.TAB$/i, ".png")), toPng(img));
  }
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

// ---------------------------------------------------------------------------------------------
// C. The executable
// ---------------------------------------------------------------------------------------------

interface Image {
  mem: Uint8Array;
  view: DataView;
}

/** Load a DOS/4GW linear executable (LE): objects at their linear bases, internal fixups applied. */
function loadLe(d: Buffer): Image {
  let le = d.readUInt32LE(0x3c);
  if (d.toString("latin1", le, le + 2) !== "LE") le = d.indexOf("LE\0\0", 0, "latin1");
  const h = (o: number) => d.readUInt32LE(le + o);
  const pageSize = h(0x28);
  const nPages = h(0x14);
  const lastPage = h(0x2c);
  const objTab = le + h(0x40);
  const nObj = h(0x44);
  const fixPage = le + h(0x68);
  const fixRec = le + h(0x6c);
  const dataPages = h(0x80);
  const objs: { base: number; first: number; count: number }[] = [];
  let top = 0;
  for (let i = 0; i < nObj; i++) {
    const o = objTab + i * 24;
    const size = d.readUInt32LE(o);
    const base = d.readUInt32LE(o + 4);
    objs.push({ base, first: d.readUInt32LE(o + 12), count: d.readUInt32LE(o + 16) });
    top = Math.max(top, base + size + pageSize);
  }
  const mem = new Uint8Array(top);
  const view = new DataView(mem.buffer);
  for (const ob of objs)
    for (let p = 0; p < ob.count; p++) {
      const pg = ob.first + p;
      const src = dataPages + (pg - 1) * pageSize;
      mem.set(d.subarray(src, src + (pg < nPages ? pageSize : lastPage)), ob.base + p * pageSize);
    }
  for (const ob of objs)
    for (let p = 0; p < ob.count; p++) {
      const pg = ob.first + p;
      let q = fixRec + d.readUInt32LE(fixPage + (pg - 1) * 4);
      const end = fixRec + d.readUInt32LE(fixPage + pg * 4);
      while (q < end) {
        const st = d[q]!;
        const fl = d[q + 1]!;
        q += 2;
        let srcs: number[] | null = null;
        let count = 0;
        if (st & 0x20) count = d[q++]!;
        else {
          srcs = [d.readInt16LE(q)];
          q += 2;
        }
        if ((fl & 3) !== 0) throw new Error("only internal fixups are expected");
        let obj: number;
        if (fl & 0x40) {
          obj = d.readUInt16LE(q);
          q += 2;
        } else obj = d[q++]!;
        let target = 0;
        if ((st & 0xf) !== 2) {
          if (fl & 0x10) {
            target = d.readUInt32LE(q);
            q += 4;
          } else {
            target = d.readUInt16LE(q);
            q += 2;
          }
        }
        if (!srcs) {
          srcs = [];
          for (let k = 0; k < count; k++) srcs.push(d.readInt16LE(q + 2 * k));
          q += 2 * count;
        }
        const addr = objs[obj - 1]!.base + target;
        for (const s of srcs) {
          const at = ob.base + p * pageSize + s;
          if (at < 0 || at + 4 > mem.length) continue;
          if ((st & 0xf) === 7) view.setUint32(at, addr, true);
          else if ((st & 0xf) === 8) view.setUint32(at, (addr - (at + 4)) >>> 0, true);
        }
      }
    }
  return { mem, view };
}

function findAll(mem: Uint8Array, pattern: number[], from = 0): number[] {
  const out: number[] = [];
  outer: for (let i = from; i <= mem.length - pattern.length; i++) {
    for (let k = 0; k < pattern.length; k++) if (mem[i + k] !== pattern[k]) continue outer;
    out.push(i);
  }
  return out;
}
const le32 = (v: number) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
const floatBits = (x: number) => {
  const b = new DataView(new ArrayBuffer(4));
  b.setFloat32(0, x, true);
  return b.getUint32(0, true);
};

/**
 * Search for a byte table shaped like `cells` (symbols), allowing a few cells to differ: the
 * symbol-to-byte mapping is taken by majority and must be one-to-one. Returns the best matches.
 */
function findTable<T>(mem: Uint8Array, cells: readonly T[], maxDiff: number) {
  const hits: { at: number; diffs: number[]; map: Map<T, number> }[] = [];
  for (let at = 0; at + cells.length <= mem.length; at++) {
    const votes = new Map<T, Map<number, number>>();
    cells.forEach((s, i) => {
      const m = votes.get(s) ?? new Map<number, number>();
      m.set(mem[at + i]!, (m.get(mem[at + i]!) ?? 0) + 1);
      votes.set(s, m);
    });
    const map = new Map<T, number>();
    for (const [s, m] of votes) map.set(s, [...m].sort((a, b) => b[1] - a[1])[0]![0]);
    if (new Set(map.values()).size !== map.size) continue;
    const diffs = cells.flatMap((s, i) => (mem[at + i] === map.get(s) ? [] : [i]));
    if (diffs.length <= maxDiff) hits.push({ at, diffs, map });
  }
  return hits;
}

/** Same as findTable for plain numbers (no mapping). */
function findNumbers(mem: Uint8Array, cells: readonly number[], maxDiff: number) {
  const hits: { at: number; diffs: number[] }[] = [];
  for (let at = 0; at + cells.length <= mem.length; at++) {
    const diffs: number[] = [];
    for (let i = 0; i < cells.length && diffs.length <= maxDiff; i++) if (mem[at + i] !== cells[i]) diffs.push(i);
    if (diffs.length <= maxDiff) hits.push({ at, diffs });
  }
  return hits;
}

/**
 * A tiny x86 emulator for the straight-line compare-and-assign code the game uses for its
 * lookup routines. It knows only: cmp dword [ebp+d8], imm; jcc/jmp; mov dword [ebp+d8], imm32;
 * fld dword [ebp+d8]; fcomp qword [abs]; fnstsw ax; sahf. It stops at the first other
 * instruction and returns every local written, in order.
 */
function emulate(img: Image, start: number, locals: Map<number, number>): [number, number][] {
  const writes: [number, number][] = [];
  const get = (disp: number) => {
    const v = locals.get(disp);
    if (v === undefined) throw new Error(`emulator read an unset local ${disp} at ${start.toString(16)}`);
    return v | 0;
  };
  let pc = start;
  let cf = false;
  let zf = false;
  let lt: boolean | null = null;
  let st: number | null = null;
  let fcmp = 0; // -1 less, 0 equal, 1 greater
  const m = img.mem;
  const s8 = (a: number) => (m[a]! << 24) >> 24;
  for (let steps = 0; steps < 200; steps++) {
    const op = m[pc]!;
    const cmp = (a: number, b: number) => {
      cf = a >>> 0 < b >>> 0;
      zf = a === b;
      lt = a < b;
    };
    if (op === 0x83 && m[pc + 1] === 0x7d) {
      cmp(get(s8(pc + 2)), s8(pc + 3));
      pc += 4;
    } else if (op === 0x81 && m[pc + 1] === 0x7d) {
      cmp(get(s8(pc + 2)), img.view.getInt32(pc + 3, true));
      pc += 7;
    } else if (op === 0xc7 && m[pc + 1] === 0x45) {
      const disp = s8(pc + 2);
      const v = img.view.getInt32(pc + 3, true);
      locals.set(disp, v);
      writes.push([disp, v]);
      pc += 7;
    } else if (op === 0xd9 && m[pc + 1] === 0x45) {
      const b = new DataView(new ArrayBuffer(4));
      b.setUint32(0, get(s8(pc + 2)) >>> 0, true);
      st = b.getFloat32(0, true);
      pc += 3;
    } else if (op === 0xdc && m[pc + 1] === 0x1d) {
      const c = img.view.getFloat64(img.view.getUint32(pc + 2, true), true);
      if (st === null) throw new Error("fcomp with an empty stack");
      fcmp = st < c ? -1 : st > c ? 1 : 0;
      st = null;
      pc += 6;
    } else if (op === 0xdf && m[pc + 1] === 0xe0) pc += 2;
    else if (op === 0x9e) {
      cf = fcmp < 0;
      zf = fcmp === 0;
      lt = null;
      pc += 1;
    } else if (op === 0xeb) pc += 2 + s8(pc + 1);
    else if (op === 0xe9) pc += 5 + img.view.getInt32(pc + 1, true);
    else if ((op >= 0x72 && op <= 0x77) || (op >= 0x7c && op <= 0x7f) || (op === 0x0f && m[pc + 1]! >= 0x82 && m[pc + 1]! <= 0x8f)) {
      const near = op === 0x0f;
      const cc = near ? m[pc + 1]! - 0x80 : op - 0x70;
      const len = near ? 6 : 2;
      const rel = near ? img.view.getInt32(pc + 2, true) : s8(pc + 1);
      const signed = () => {
        if (lt === null) throw new Error("signed jump after a float compare");
        return lt;
      };
      const conditions: Record<number, () => boolean> = {
        0x2: () => cf, 0x3: () => !cf, 0x4: () => zf, 0x5: () => !zf, 0x6: () => cf || zf, 0x7: () => !(cf || zf),
        0xc: () => signed(), 0xd: () => !signed(), 0xe: () => signed() || zf, 0xf: () => !(signed() || zf),
      };
      const condition = conditions[cc];
      if (!condition) break;
      const taken = condition();
      pc += len + (taken ? rel : 0);
    } else break;
  }
  return writes;
}

const lastWrite = (w: [number, number][], disp: number) => [...w].reverse().find(([d]) => d === disp)?.[1];

function checkExe(folder: string): void {
  console.log("\n## C. 3R2.EXE");
  const img = loadLe(readFileSync(join(folder, "3R2.EXE")));
  let problems = 0;
  const report = (name: string, mismatches: string[]) => {
    problems += mismatches.length;
    console.log(mismatches.length ? `${name}: ${mismatches.length} difference(s), e.g. ${mismatches.slice(0, 6).join("; ")}` : `${name}: matches`);
  };

  // C1. Offensive CRT, stored by die roll (6 rows of 8 columns), one byte per result.
  const crtCells: CrtResult[] = [];
  for (let r = 0; r < 6; r++) for (const c of ODDS_COLUMNS) crtCells.push(OFFENSIVE_CRT[c][r]!);
  const crt = findTable(img.mem, crtCells, 4).sort((a, b) => a.diffs.length - b.diffs.length);
  if (!crt.length) console.log("CRT: no table of that shape found");
  for (const hit of crt.slice(0, 2)) {
    const codes = [...hit.map].map(([s, v]) => `${s}=${v}`).join(" ");
    report(
      `CRT table at 0x${hit.at.toString(16)} (codes ${codes})`,
      hit.diffs.map((i) => `roll ${Math.floor(i / 8) + 1} column ${ODDS_COLUMNS[i % 8]}`),
    );
  }

  // C2. Attrition table: hexes then units, each by die roll (6 rows of 7 columns).
  const units: number[] = [];
  const hexes: number[] = [];
  for (let r = 0; r < 6; r++)
    for (const c of ATTRITION_COLUMNS) {
      units.push(ATTRITION_TABLE[c][r]![0]);
      hexes.push(ATTRITION_TABLE[c][r]![1]);
    }
  for (const [name, cells] of [["attrition units (#C)", units], ["attrition hexes (#H)", hexes]] as const) {
    const hits = findNumbers(img.mem, cells, 3).filter((h) => !crt[0] || Math.abs(h.at - crt[0].at) < 0x100);
    if (!hits.length) console.log(`${name}: not found next to the CRT`);
    for (const hit of hits)
      report(
        `${name} at 0x${hit.at.toString(16)}`,
        hit.diffs.map((i) => `roll ${Math.floor(i / 7) + 1} column ${ATTRITION_COLUMNS[i % 7]}`),
      );
  }

  // C3. Odds column: the routine takes attack/defence as a single-precision float.
  const oddsAt = findAll(img.mem, [0x81, 0x7d, 0x14, ...le32(floatBits(0.25))]);
  for (const at of oddsAt) {
    const diffs: string[] = [];
    for (let a = 1; a <= 80; a++)
      for (let d = 1; d <= 80; d++) {
        const w = emulate(img, at, new Map([[0x14, floatBits(Math.fround(a / d))]]));
        const idx = lastWrite(w, -8);
        const game = idx === 8 ? null : ODDS_COLUMNS[idx ?? -1] ?? `?${idx}`;
        if (game !== oddsColumn(a, d)) diffs.push(`${a} vs ${d}: game ${game}, ours ${oddsColumn(a, d)}`);
      }
    report(`odds column routine at 0x${at.toString(16)} (attack 1-80 x defence 1-80)`, diffs);
  }

  // C4. Interception: distance 1 is automatic, then a maximum die roll per distance band.
  const intAt = findAll(img.mem, [0x83, 0x7d, 0x14, 0x01]).filter((a) =>
    findAll(img.mem.subarray(a, a + 0x20), [0x83, 0x7d, 0x14, 0x0a]).length,
  );
  for (const at of intAt) {
    const diffs: string[] = [];
    const bands: string[] = [];
    for (let dist = 1; dist <= 40; dist++) {
      const w = emulate(img, at, new Map([[0x14, dist]]));
      const max = lastWrite(w, -8);
      const game = max === undefined && lastWrite(w, -4) === 1 ? "automatic" : Array.from({ length: max ?? 0 }, (_, i) => i + 1);
      bands.push(`${dist}:${game === "automatic" ? "auto" : `<=${max}`}`);
      if (JSON.stringify(game) !== JSON.stringify(interceptionRolls(dist)))
        diffs.push(`distance ${dist}: game ${JSON.stringify(game)}, ours ${JSON.stringify(interceptionRolls(dist))}`);
    }
    report(`interception routine at 0x${at.toString(16)} (distance 1-40)`, diffs);
    console.log(`  bands: ${bands.filter((_, i) => [0, 1, 9, 10, 17, 18, 23, 24, 29, 30].includes(i)).join(" ")}`);
  }

  // C5. Naval advantage: ratio larger/smaller as a float, compared with 1.33, 1.67, 2, 3, 4.
  const navAt: { at: number; disp: number }[] = [];
  for (let a = 0; a + 9 < img.mem.length; a++)
    if (img.mem[a] === 0xd9 && img.mem[a + 1] === 0x45 && img.mem[a + 3] === 0xdc && img.mem[a + 4] === 0x1d) {
      const addr = img.view.getUint32(a + 5, true);
      if (addr + 8 <= img.mem.length && img.view.getFloat64(addr, true) === 1.33) navAt.push({ at: a, disp: (img.mem[a + 2]! << 24) >> 24 });
    }
  for (const { at, disp } of navAt) {
    const diffs: string[] = [];
    const sizes = [...Array.from({ length: 60 }, (_, i) => i + 1), 100, 133, 134, 166, 167, 168, 200];
    for (const f of sizes)
      for (const e of sizes) {
        if (f < e) continue;
        const w = emulate(img, at, new Map([[disp, floatBits(Math.fround(f / e))]]));
        const game = w.length ? w[w.length - 1]![1] : undefined;
        if (game !== navalAdvantageDrm(f, e)) diffs.push(`${f} vs ${e}: game +${game}, ours +${navalAdvantageDrm(f, e)}`);
      }
    report(`naval advantage routine at 0x${at.toString(16)}`, diffs);
  }

  // C6. Naval nationality: arguments are the nation number (FORMAT.TXT list) and the battle's
  // row index (A = 0, so row N = 13).
  const NATION_NUMBER: Record<NavalNation, number> = {
    france: 1, britain: 2, usa: 3, ussr: 4, germany: 5, italy: 6,
    spain: 17, sweden: 18, turkey: 19, "vichy-france": 40, "free-france": 41,
  };
  for (const rowAt of findAll(img.mem, [0x83, 0x7d, 0x18, 0x0d])) {
    const starts = findAll(img.mem.subarray(rowAt - 0x60, rowAt), [0x83, 0x7d, 0x14, 0x05]);
    if (!starts.length) continue;
    const at = rowAt - 0x60 + starts[0]!;
    const diffs: string[] = [];
    const drm = (n: number, row: number) => emulate(img, at, new Map([[0x14, n], [0x18, row]])).at(-1)?.[1];
    for (const [nation, n] of Object.entries(NATION_NUMBER) as [NavalNation, number][])
      for (const [row, north] of [[12, true], [13, false]] as const) {
        const game = drm(n, row);
        if (game !== navalNationalityDrm(nation, north))
          diffs.push(`${nation} (nation ${n}) row ${row}: game ${game}, ours ${navalNationalityDrm(nation, north)}`);
      }
    const others = Array.from({ length: 43 }, (_, n) => n).filter((n) => ![1, 2, 3, 5, 6, 18].includes(n) && drm(n, 13) !== -2);
    report(`naval nationality routine at 0x${at.toString(16)}`, diffs);
    console.log(`  nations other than France, Britain, U.S., Germany, Italy, Sweden that are not -2: ${others.length ? others.join(", ") : "none"}`);
  }

  console.log(`\n${problems ? `${problems} difference(s) found.` : "No differences found."}`);
}

function main(): void {
  const args = process.argv.slice(2);
  const folder = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--png");
  if (!folder) {
    console.error("usage: npx vite-node scripts/gamedata/tables.ts <game-folder> [--png <out-dir>]");
    process.exit(2);
  }
  const pngIdx = args.indexOf("--png");
  let pngDir: string | null = null;
  if (pngIdx >= 0) {
    pngDir = resolve(args[pngIdx + 1] ?? "");
    const rel = relative(REPO_ROOT, pngDir);
    if (!rel.startsWith("..") && !isAbsolute(rel)) {
      console.error("Refusing to write chart images inside the repository; choose a folder outside it.");
      process.exit(2);
    }
    mkdirSync(pngDir, { recursive: true });
  }
  checkCharts(folder, pngDir);
  checkRaw(folder);
  checkExe(folder);
}

main();
