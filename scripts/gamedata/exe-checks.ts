/**
 * Checks of our rule tables against the original program, 3R2.EXE (roadmap 2.3).
 *
 * OPTIONAL MODULE. Whether the program itself may be analysed is an open policy question for the
 * project owner (see the PR for T03). Everything that reads 3R2.EXE lives in this one file, so it
 * can be dropped by deleting this file and its import and call in tables.ts; the chart checks
 * there keep working.
 *
 * Nothing from the program is committed: no code bytes, no disassembly. The checks search the
 * loaded program for tables shaped like ours, or for x86 compare instructions carrying our own rule
 * values, and run the routines they find through a tiny emulator.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ATTRITION_COLUMNS,
  ATTRITION_TABLE,
  FORCED_COUNTERATTACK_COLUMN,
  ODDS_COLUMNS,
  OFFENSIVE_CRT,
  oddsColumn,
  type CrtResult,
} from "../../src/engine/combat";
import {
  airNationalityDrm,
  interceptionRolls,
  navalAdvantageDrm,
  navalNationalityDrm,
  type NavalNation,
} from "../../src/engine/tables";

/** The outcome of one check. `known` holds differences already listed as open questions in docs/RULES.md. */
export interface CheckResult {
  name: string;
  found: boolean;
  differences: string[];
  known: string[];
  notes: string[];
}

const result = (name: string): CheckResult => ({ name, found: false, differences: [], known: [], notes: [] });

/** Nation numbers from the game's FORMAT.TXT list. */
const NATION_NUMBER: Record<NavalNation, number> = {
  france: 1, britain: 2, usa: 3, ussr: 4, germany: 5, italy: 6,
  spain: 17, sweden: 18, turkey: 19, "vichy-france": 40, "free-france": 41,
};

/** Differences we already know about and list as open questions (docs/RULES.md). */
const KNOWN_OPEN_NATIONS: readonly NavalNation[] = ["vichy-france", "free-france"];

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

const s8 = (m: Uint8Array, a: number) => (m[a]! << 24) >> 24;

/** If `at` is `mov dword [ebp+d8], imm32`, return [d8, imm32]. */
function movLocal(img: Image, at: number): [number, number] | null {
  if (at < 0 || at + 7 > img.mem.length || img.mem[at] !== 0xc7 || img.mem[at + 1] !== 0x45) return null;
  return [s8(img.mem, at + 2), img.view.getInt32(at + 3, true)];
}

/** Every `jmp dword cs:[eax+table]` (a compiled switch) with the address of its table. */
function switchJumps(img: Image): { at: number; table: number }[] {
  return findAll(img.mem, [0x2e, 0xff, 0xa0]).map((at) => ({ at, table: img.view.getUint32(at + 3, true) }));
}

/** The CRT, stored by die roll (6 rows of 8 columns), one byte per result. */
function checkCrt(img: Image): { check: CheckResult; at: number | null; codes: Map<CrtResult, number> } {
  const check = result("Offensive CRT table");
  const cells: CrtResult[] = [];
  for (let r = 0; r < 6; r++) for (const c of ODDS_COLUMNS) cells.push(OFFENSIVE_CRT[c][r]!);
  const best = findTable(img.mem, cells, 4).sort((a, b) => a.diffs.length - b.diffs.length)[0];
  if (!best) return { check, at: null, codes: new Map() };
  check.found = true;
  check.notes.push(`at 0x${best.at.toString(16)}, codes ${[...best.map].map(([s, v]) => `${s}=${v}`).join(" ")}`);
  check.differences = best.diffs.map((i) => `roll ${Math.floor(i / 8) + 1} column ${ODDS_COLUMNS[i % 8]}`);
  return { check, at: best.at, codes: best.map };
}

/** Attrition: units and hexes, each by die roll (6 rows of 7 columns), stored next to the CRT. */
function checkAttrition(img: Image, crtAt: number | null): CheckResult[] {
  const units: number[] = [];
  const hexes: number[] = [];
  for (let r = 0; r < 6; r++)
    for (const c of ATTRITION_COLUMNS) {
      units.push(ATTRITION_TABLE[c][r]![0]);
      hexes.push(ATTRITION_TABLE[c][r]![1]);
    }
  return ([["Attrition units (#C) table", units], ["Attrition hexes (#H) table", hexes]] as const).map(([name, cells]) => {
    const check = result(name);
    const hit = findNumbers(img.mem, cells, 3).find((h) => crtAt !== null && Math.abs(h.at - crtAt) < 0x100);
    if (hit) {
      check.found = true;
      check.notes.push(`at 0x${hit.at.toString(16)}`);
      check.differences = hit.diffs.map((i) => `roll ${Math.floor(i / 7) + 1} column ${ATTRITION_COLUMNS[i % 7]}`);
    }
    return check;
  });
}

/** Odds column: the routine takes attack/defence as a single-precision float; index 8 = attacker eliminated. */
function checkOdds(img: Image): CheckResult {
  const check = result("Odds column routine (attack 1-80 x defence 1-80)");
  for (const at of findAll(img.mem, [0x81, 0x7d, 0x14, ...le32(floatBits(0.25))])) {
    check.found = true;
    for (let a = 1; a <= 80; a++)
      for (let d = 1; d <= 80; d++) {
        const idx = lastWrite(emulate(img, at, new Map([[0x14, floatBits(Math.fround(a / d))]])), -8);
        const game = idx === 8 ? null : (ODDS_COLUMNS[idx ?? -1] ?? `?${idx}`);
        if (game !== oddsColumn(a, d)) check.differences.push(`${a} vs ${d}: game ${game}, ours ${oddsColumn(a, d)}`);
      }
  }
  return check;
}

/**
 * CA1-CA3: the combat routine switches on (result code - 4); cases 1-3 store a fixed column index.
 * Result codes are the ones the CRT table uses, so this check needs the CRT check's code map.
 */
function checkForcedColumns(img: Image, codes: Map<CrtResult, number>): CheckResult {
  const check = result("Forced counterattack columns (CA1-CA3)");
  const byCode = new Map([...codes].map(([r, c]) => [c, r]));
  for (const { at, table } of switchJumps(img)) {
    const before = img.mem.subarray(Math.max(0, at - 0x30), at);
    if (!findAll(before, [0x83, 0xe8, 0x04]).length || !findAll(before, [0x03, 0x77]).length) continue;
    const cases = [1, 2, 3].map((k) => movLocal(img, img.view.getUint32(table + 4 * k, true)));
    if (cases.some((c) => !c || c[1] < 0 || c[1] > 7) || new Set(cases.map((c) => c![0])).size !== 1) continue;
    check.found = true;
    check.notes.push(`switch at 0x${at.toString(16)}`);
    cases.forEach((c, i) => {
      const code = 5 + i;
      const res = byCode.get(code);
      const game = ODDS_COLUMNS[c![1]];
      const ours = res ? FORCED_COUNTERATTACK_COLUMN[res] : undefined;
      if (!res || game !== ours) check.differences.push(`code ${code} (${res ?? "?"}): game ${game}, ours ${ours}`);
      else check.notes.push(`${res} -> ${game}`);
    });
  }
  return check;
}

/** Interception: distance 1 is automatic, then a maximum die roll per distance band. */
function checkInterception(img: Image): CheckResult {
  const check = result("Interception routine (distance 1-40)");
  const starts = findAll(img.mem, [0x83, 0x7d, 0x14, 0x01]).filter(
    (a) => findAll(img.mem.subarray(a, a + 0x20), [0x83, 0x7d, 0x14, 0x0a]).length,
  );
  for (const at of starts) {
    check.found = true;
    for (let dist = 1; dist <= 40; dist++) {
      const w = emulate(img, at, new Map([[0x14, dist]]));
      const max = lastWrite(w, -8);
      const game = max === undefined && lastWrite(w, -4) === 1 ? "automatic" : Array.from({ length: max ?? 0 }, (_, i) => i + 1);
      if (JSON.stringify(game) !== JSON.stringify(interceptionRolls(dist)))
        check.differences.push(`distance ${dist}: game ${JSON.stringify(game)}, ours ${JSON.stringify(interceptionRolls(dist))}`);
    }
  }
  return check;
}

/** Naval advantage: ratio larger/smaller as a float, compared with the doubles 1.33 and 1.67, then 2, 3, 4. */
function checkNavalAdvantage(img: Image): CheckResult {
  const check = result("Naval advantage routine");
  for (let a = 0; a + 9 < img.mem.length; a++) {
    if (img.mem[a] !== 0xd9 || img.mem[a + 1] !== 0x45 || img.mem[a + 3] !== 0xdc || img.mem[a + 4] !== 0x1d) continue;
    const addr = img.view.getUint32(a + 5, true);
    if (addr + 8 > img.mem.length || img.view.getFloat64(addr, true) !== 1.33) continue;
    check.found = true;
    const disp = s8(img.mem, a + 2);
    const sizes = [...Array.from({ length: 60 }, (_, i) => i + 1), 100, 133, 134, 166, 167, 168, 200];
    for (const f of sizes)
      for (const e of sizes) {
        if (f < e) continue;
        const w = emulate(img, a, new Map([[disp, floatBits(Math.fround(f / e))]]));
        const game = w.at(-1)?.[1];
        if (game !== navalAdvantageDrm(f, e)) check.differences.push(`${f} vs ${e}: game +${game}, ours +${navalAdvantageDrm(f, e)}`);
      }
  }
  return check;
}

/**
 * Naval nationality: arguments are a nation number and a second value that the routine compares
 * with 13, row N's index (A = 0). That this second value is the battle hex's row was read by hand
 * from the caller; this check only shows the comparison.
 */
function checkNavalNationality(img: Image): CheckResult {
  const check = result("Naval nationality routine");
  for (const rowAt of findAll(img.mem, [0x83, 0x7d, 0x18, 0x0d])) {
    const starts = findAll(img.mem.subarray(rowAt - 0x60, rowAt), [0x83, 0x7d, 0x14, 0x05]);
    if (!starts.length) continue;
    const at = rowAt - 0x60 + starts[0]!;
    check.found = true;
    const drm = (n: number, row: number) => emulate(img, at, new Map([[0x14, n], [0x18, row]])).at(-1)?.[1];
    for (const [nation, n] of Object.entries(NATION_NUMBER) as [NavalNation, number][])
      for (const [row, north] of [[12, true], [13, false]] as const) {
        const game = drm(n, row);
        if (game === navalNationalityDrm(nation, north)) continue;
        const line = `${nation} (nation ${n}) row ${row}: game ${game}, ours ${navalNationalityDrm(nation, north)}`;
        (KNOWN_OPEN_NATIONS.includes(nation) ? check.known : check.differences).push(line);
      }
    const named = Object.values(NATION_NUMBER).filter((n) => n !== 4 && n !== 17 && n !== 19 && n < 40);
    const others = Array.from({ length: 43 }, (_, n) => n).filter((n) => !named.includes(n) && drm(n, 13) !== -2);
    if (others.length) check.differences.push(`nations not named on the chart but not -2: ${others.join(", ")}`);
  }
  return check;
}

/**
 * Air nationality: the routine switches on (nation number - 1) for nations 1-6 after checking the
 * value is at most 5; every case and the default store a DRM in the same local.
 */
function checkAirNationality(img: Image): CheckResult {
  const check = result("Air nationality routine");
  const NATION: Record<number, "france" | "britain" | "usa" | "ussr" | "germany" | "italy"> = {
    1: "france", 2: "britain", 3: "usa", 4: "ussr", 5: "germany", 6: "italy",
  };
  for (const { at, table } of switchJumps(img)) {
    const window = Math.max(0, at - 0x20);
    const guard = findAll(img.mem.subarray(window, at), [0x80, 0x7d]).map((o) => window + o)
      .find((g) => img.mem[g + 3] === 0x05 && img.mem[g + 4] === 0x77);
    if (guard === undefined || !findAll(img.mem.subarray(window, guard), [0xfe, 0xc8]).length) continue;
    const defaultCase = movLocal(img, guard + 6 + s8(img.mem, guard + 5));
    const cases = [0, 1, 2, 3, 4, 5].map((k) => movLocal(img, img.view.getUint32(table + 4 * k, true)));
    const all = [defaultCase, ...cases];
    if (all.some((c) => !c || c[1] < -2 || c[1] > 0) || new Set(all.map((c) => c![0])).size !== 1) continue;
    check.found = true;
    check.notes.push(`switch at 0x${at.toString(16)}`);
    cases.forEach((c, k) => {
      const nation = NATION[k + 1]!;
      if (c![1] !== airNationalityDrm(nation)) check.differences.push(`${nation}: game ${c![1]}, ours ${airNationalityDrm(nation)}`);
    });
    if (defaultCase![1] !== airNationalityDrm("other")) check.differences.push(`others: game ${defaultCase![1]}, ours ${airNationalityDrm("other")}`);
  }
  return check;
}

/** Run every program check. */
export function checkProgram(folder: string): CheckResult[] {
  const img = loadLe(readFileSync(join(folder, "3R2.EXE")));
  const crt = checkCrt(img);
  return [
    crt.check,
    ...checkAttrition(img, crt.at),
    checkOdds(img),
    checkForcedColumns(img, crt.codes),
    checkInterception(img),
    checkNavalAdvantage(img),
    checkNavalNationality(img),
    checkAirNationality(img),
  ];
}
