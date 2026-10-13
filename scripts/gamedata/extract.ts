/**
 * Regenerates src/data/gamedata.ts from the original game's files, after checking the decoded
 * files against each other and against our scenario data.
 *
 *   npx vite-node scripts/gamedata/extract.ts <game-folder>
 *
 * The game folder stays outside the repository. Only what the game uses is written: the hexes of
 * each zone the scenarios need, and the hexsides of the three lines (per hex, as stored). The
 * whole control bitmaps are not committed; the cross-checks that need them run here. Exits with
 * status 1 if a check fails. See docs/GAME_DATA.md.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ISLANDS } from "../../src/data/islands";
import { MAP } from "../../src/data/map";
import type { HexId } from "../../src/engine/hex";
import type { ForceOwner, Scenario } from "../../src/engine/types";
import { around, borderCheck } from "./checks";
import { decodeBitmap, decodeLine, lineEnds, lineHexsides, MASK_DIRECTIONS, readingFor, type LineEntry } from "./formats";

const BITMAPS = ["BRIT42", "BRIT44", "EASTEURP", "GERM42", "GERM44", "ITALY42", "USSR42", "USSR44", "VICHY", "VICHY42"] as const;
type Bitmap = (typeof BITMAPS)[number];
const LINES = ["NSPPLINE", "1942LINE", "1944LINE"] as const;

/**
 * The zones taken from the bitmaps: the hexes `bitmap` marks (less those of `minus`) that are land
 * of `countries` on our map, plus the hexes it marks that our map calls sea next to those (coastal
 * slivers; they join the zone in src/data/zones.ts only once our map makes them land of the zone's
 * countries). `islands` are zones of their own, read off our map, and are left out, along with
 * slivers that touch only them.
 */
const ZONES: { id: string; bitmap: Bitmap; countries: string[]; minus?: Bitmap; islands?: readonly HexId[] }[] = [
  { id: "1942/ussr-east-of-start-line", bitmap: "USSR42", countries: ["ussr"] },
  { id: "1942/ussr-west-of-start-line", bitmap: "GERM42", countries: ["ussr"] },
  { id: "1942/libya-east-of-start-line", bitmap: "BRIT42", countries: ["libya"] },
  { id: "1942/libya-west-of-start-line", bitmap: "ITALY42", countries: ["libya"] },
  { id: "1942/vichy-france", bitmap: "VICHY42", countries: ["france"], islands: ISLANDS.corsica.hexes },
  { id: "1942/occupied-france", bitmap: "GERM42", countries: ["france"], minus: "VICHY42" },
  { id: "1944/ussr-east-of-start-line", bitmap: "USSR44", countries: ["ussr"] },
  { id: "1944/ussr-west-of-start-line", bitmap: "GERM44", countries: ["ussr"] },
  { id: "1944/italy-north-of-start-line", bitmap: "GERM44", countries: ["italy"], islands: ISLANDS.rhodes.hexes },
  { id: "1944/italy-south-of-start-line", bitmap: "BRIT44", countries: ["italy"], islands: [...ISLANDS.sicily.hexes, ...ISLANDS.sardinia.hexes] },
  { id: "eastern-europe", bitmap: "EASTEURP", countries: ["baltic-states", "poland", "rumania"] },
];

const folder = process.argv[2];
if (!folder) {
  console.error("usage: npx vite-node scripts/gamedata/extract.ts <game-folder>");
  process.exit(1);
}
const read = (name: string) => new Uint8Array(readFileSync(join(folder, name)));
const bitmaps = Object.fromEntries(BITMAPS.map((b) => [b, decodeBitmap(read(`${b}.CON`))])) as Record<Bitmap, HexId[]>;
const lines = Object.fromEntries(LINES.map((l) => [l, decodeLine(read(`${l}.BIN`))])) as Record<(typeof LINES)[number], LineEntry[]>;

const H = MAP.hexes;
const isLand = (id: HexId) => !!H[id]?.land;
const landOf = (ids: Iterable<HexId>, country: string) => new Set([...ids].filter((id) => isLand(id) && H[id]!.country === country));
const countryLand = (country: string) => landOf(Object.keys(H), country);
const failures: string[] = [];
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures.push(what);
};

// --- report ------------------------------------------------------------------------------------
for (const b of BITMAPS) {
  const byCountry = new Map<string, number>();
  for (const id of bitmaps[b].filter(isLand)) byCountry.set(H[id]!.country!, (byCountry.get(H[id]!.country!) ?? 0) + 1);
  const sea = bitmaps[b].filter((id) => !isLand(id));
  const counts = [...byCountry].sort().map(([c, n]) => `${c} ${n}`).join(", ");
  console.log(`${b}.CON: ${bitmaps[b].length} hexes (${counts})${sea.length ? `; sea on our map: ${sea.join(" ")}` : ""}`);
}
const m = MASK_DIRECTIONS;
const swap34 = readingFor([m[0]!, m[1]!, m[2]!, m[4]!, m[3]!, m[5]!]);
for (const l of LINES) {
  let swapped: string;
  try {
    swapped = `${lineEnds(lineHexsides(lines[l], swap34))} loose ends`;
  } catch (e) {
    swapped = (e as Error).message;
  }
  const hexsides = lineHexsides(lines[l]);
  console.log(`${l}.BIN: ${lines[l].length} entries, ${hexsides.length} hexsides, ${lineEnds(hexsides)} loose ends (bits 3 and 4 swapped: ${swapped})`);
}

// --- cross-checks on the decoded files ---------------------------------------------------------
check(lineEnds(lineHexsides(lines.NSPPLINE)) === 2, "the Polish Partition Line is one unbroken path");
type Split = [string, (typeof LINES)[number], string, Set<HexId>, Set<HexId>];
const splits: Split[] = [
  ["1942 U.S.S.R.", "1942LINE", "ussr", landOf(bitmaps.USSR42, "ussr"), landOf(bitmaps.GERM42, "ussr")],
  ["1942 Libya", "1942LINE", "libya", landOf(bitmaps.BRIT42, "libya"), landOf(bitmaps.ITALY42, "libya")],
  ["1944 U.S.S.R.", "1944LINE", "ussr", landOf(bitmaps.USSR44, "ussr"), landOf(bitmaps.GERM44, "ussr")],
  ["1944 Italy", "1944LINE", "italy", landOf(bitmaps.BRIT44, "italy"), landOf(bitmaps.GERM44, "italy")],
  ...["poland", "rumania"].map((c): Split => {
    const east = landOf(bitmaps.EASTEURP, c);
    return [`Partition Line in ${c}`, "NSPPLINE", c, east, new Set([...countryLand(c)].filter((h) => !east.has(h)))];
  }),
];
for (const [name, l, country, a, b] of splits) {
  const r = borderCheck(MAP, lineHexsides(lines[l]), country, a, b);
  check(r.offBorder.length === 0 && r.undrawn.length === 0, `${l} runs exactly along the border of the two sides' bitmaps: ${name} (${r.inside} hexsides)`);
}
const groups: Bitmap[][] = [["BRIT42", "GERM42", "ITALY42", "USSR42"], ["BRIT42", "ITALY42", "USSR42", "VICHY42"], ["BRIT44", "GERM44", "USSR44"]];
for (const group of groups) {
  const seen = new Map<HexId, Bitmap>();
  const clashes: string[] = [];
  for (const b of group) {
    for (const id of bitmaps[b]) {
      if (seen.has(id)) clashes.push(`${id} ${seen.get(id)}/${b}`);
      else seen.set(id, b);
    }
  }
  check(clashes.length === 0, `no hex in two of ${group.join(", ")}${clashes.length ? `: ${clashes.join(" ")}` : ""}`);
}
const germanVichy = bitmaps.GERM42.filter((id) => bitmaps.VICHY42.includes(id));
console.log(`note: GERM42 also marks the ${germanVichy.length} mainland Vichy hexes of VICHY42`);
const vichyEurope = bitmaps.VICHY42.filter((id) => !isLand(id) || H[id]!.country === "france");
check([...bitmaps.VICHY].sort().join() === vichyEurope.sort().join(), "VICHY.CON is VICHY42.CON's European part");

// --- output ------------------------------------------------------------------------------------
function zoneHexes(z: (typeof ZONES)[number]): HexId[] {
  const marked = bitmaps[z.bitmap].filter((id) => (!z.minus || !bitmaps[z.minus].includes(id)) && !z.islands?.includes(id));
  const land = new Set(marked.filter((id) => isLand(id) && z.countries.includes(H[id]!.country!)));
  return marked.filter((id) => land.has(id) || (!isLand(id) && H[id] && around(MAP, id).some((n) => land.has(n))));
}
const zones = Object.fromEntries(ZONES.map((z) => [z.id, zoneHexes(z)]));
const wrap = (items: readonly string[], indent: string) => {
  const out: string[] = [];
  let line = "";
  for (const item of items) {
    if (line && line.length + item.length + 1 > 120 - indent.length) {
      out.push(indent + line);
      line = "";
    }
    line += (line ? " " : "") + item;
  }
  if (line) out.push(indent + line);
  return out.join("\n");
};
const source = (id: string) => {
  const z = ZONES.find((x) => x.id === id)!;
  return `${z.bitmap}.CON${z.minus ? ` less ${z.minus}.CON` : ""}${z.islands ? ` less ${z.islands.join(" ")}` : ""}`;
};
const zoneBlock = Object.entries(zones)
  .map(([id, ids]) => `  // ${source(id)}: ${ids.length}\n  "${id}": [\n${wrap(ids.map((i) => `"${i}",`), "    ")}\n  ],`)
  .join("\n");
const entry = (e: LineEntry) => `{ hex: "${e.hex}", sides: [${e.sides.map((d) => `"${d}"`).join(", ")}] },`;
const lineBlock = LINES.map((l) => `  // ${l}.BIN\n  "${l}": [\n${wrap(lines[l].map(entry), "    ")}\n  ],`).join("\n");
const text = `// Generated by scripts/gamedata/extract.ts from the original game's files. Do not edit by hand.
// Only derived facts the game uses: zone hexes and line hexsides in our coordinates. The control
// bitmaps themselves are not committed. See docs/GAME_DATA.md.
import type { Direction, HexId } from "../engine/hex";

/**
 * The hexes of each zone, in file order: land hexes of the zone's countries on our map, plus the
 * few the original marks that our map calls sea (see src/data/zones.ts).
 */
export const ORIGINAL_ZONES: Readonly<Record<${ZONES.map((z) => `"${z.id}"`).join(" | ")}, readonly HexId[]>> = {
${zoneBlock}
};

/** The three lines, per hex: the hexsides of that hex the line runs along. */
export const LINES: Readonly<Record<${LINES.map((l) => `"${l}"`).join(" | ")}, readonly { hex: HexId; sides: readonly Direction[] }[]>> = {
${lineBlock}
};
`;
const target = fileURLToPath(new URL("../../src/data/gamedata.ts", import.meta.url));
writeFileSync(target, text);
console.log(`wrote ${target}`);

// --- cross-checks against the scenario data, which reads the file just written ------------------
const { SCENARIO_1942 } = await import("../../src/data/scenario-1942");
const { SCENARIO_1944 } = await import("../../src/data/scenario-1944");
const { territoryOf } = await import("../../src/engine/areas");
/** Each owner's "controlled at start" against its bitmap, apart from named differences. */
const owners: [Scenario, ForceOwner, Bitmap, HexId[]][] = [
  // GERM42 also marks mainland Vichy France; CC30 is an Aegean hex our map gives to Turkey.
  [SCENARIO_1942, "germany", "GERM42", ["CC30", ...germanVichy]],
  [SCENARIO_1942, "italy", "ITALY42", []],
  [SCENARIO_1942, "britain", "BRIT42", []],
  [SCENARIO_1942, "ussr", "USSR42", []],
  [SCENARIO_1942, "vichy-france", "VICHY42", []],
  [SCENARIO_1944, "germany", "GERM44", ["CC30"]],
  [SCENARIO_1944, "britain", "BRIT44", []],
  [SCENARIO_1944, "ussr", "USSR44", []],
];
for (const [s, owner, b, extra] of owners) {
  const encoded = [...territoryOf({ map: MAP, scenario: s }, owner).places].sort();
  const marked = bitmaps[b].filter((id) => isLand(id) && !extra.includes(id)).sort();
  const diff = [...encoded.filter((x) => !marked.includes(x)).map((x) => `+${x}`), ...marked.filter((x) => !encoded.includes(x)).map((x) => `-${x}`)];
  check(diff.length === 0, `${s.id} ${owner} controls at start what ${b}.CON marks${diff.length ? `: ${diff.join(" ")}` : ""}`);
}

if (failures.length) {
  console.error(`${failures.length} check(s) failed`);
  process.exit(1);
}
