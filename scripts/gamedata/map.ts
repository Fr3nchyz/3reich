/**
 * Compares our map (src/data/map.json) with the original game's own map data and prints the
 * differences as Markdown, grouped by kind.
 *
 *   npx vite-node scripts/gamedata/map.ts <game-folder> > /tmp/map-diff.md
 *
 * The game folder stays outside the repository and nothing from it is written into the repo:
 * the output lists hex ids and our own field names. The lists in docs/MAP_COMPARISON.md come
 * from this script. The decoder itself is scripts/gamedata/binmap.ts; the format is in
 * docs/GAME_DATA.md.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MAP } from "../../src/data/map";
import { compareMaps, decodeBinmap, hasLand, isPlayableRecord, NATIONS, SIDE_BITS, type GameHex } from "./binmap";

const folder = process.argv[2];
if (!folder) {
  console.error("usage: npx vite-node scripts/gamedata/map.ts <game-folder>");
  process.exit(1);
}
const read = (name: string) => new Uint8Array(readFileSync(join(folder, name)));

const game = decodeBinmap(read("BINMAP.BIN"));
const c = compareMaps(game, MAP);

// --- checks that the decoding is right --------------------------------------------------
const playable = game.filter(isPlayableRecord);
const byId = new Map(playable.map((g) => [g.id, g]));
let symmetric = 0;
let asymmetric = 0;
const DELTA: Record<string, [number, number]> = { NE: [1, -1], E: [1, 0], SE: [0, 1], SW: [-1, 1], W: [-1, 0], NW: [0, -1] };
const parse = (id: string) => {
  const m = /^([A-Z])(\1?)(\d+)$/.exec(id)!;
  return { q: Number(m[3]), r: m[1]!.charCodeAt(0) - 65 + (m[2] ? 26 : 0) };
};
const label = (q: number, r: number) => {
  const ch = String.fromCharCode(65 + (r % 26));
  return `${r < 26 ? ch : ch + ch}${q}`;
};
for (const g of playable) {
  const p = parse(g.id);
  SIDE_BITS.forEach((d, k) => {
    const [dq, dr] = DELTA[d]!;
    if (p.r + dr < 0 || p.r + dr > 39 || p.q + dq < 0) return;
    const n = byId.get(label(p.q + dq, p.r + dr));
    if (!n) return;
    const back = 1 << ((k + 3) % 6);
    const here = Boolean(g.landSides & (1 << k));
    const there = Boolean(n.landSides & back);
    if (here || there) here === there ? symmetric++ : asymmetric++;
  });
}

// AREADATA.BIN: 68 records of 11 bytes; byte 6 is the area's hex count.
const areaData = read("AREADATA.BIN");
let areaMatches = 0;
for (let a = 0; a < 68; a++) {
  const count = playable.filter((g) => g.area === a).length + game.filter((g) => !isPlayableRecord(g) && g.label && g.area === a).length;
  if (areaData[a * 11 + 6] === count) areaMatches++;
}

// --- report -----------------------------------------------------------------------------
const out: string[] = [];
const list = (ids: readonly string[]) => (ids.length ? ids.join(", ") : "none");
const section = (title: string, n: number, body: string) => out.push(`### ${title} (${n})`, "", body, "");

out.push("## Decoding checks", "");
out.push(`- Records naming their own hex: ${playable.length}; our map: ${Object.keys(MAP.hexes).length} hexes.`);
out.push(`- Land hexside bits agreeing from both sides: ${symmetric}; disagreeing: ${asymmetric}.`);
out.push(`- AREADATA.BIN hex counts matching the area byte of BINMAP.BIN: ${areaMatches} of 68.`);
out.push("");

out.push("## Hexes", "");
section("Game hexes missing from our map", c.gameOnlyHexes.length,
  c.gameOnlyHexes.map((h) => `${h.id} (${h.land ? `land, ${h.nation}, ${h.landSides ? "with" : "no"} land hexsides` : "sea"})`).join(", ") || "none");
section("Our hexes with no game record", c.oursOnlyHexes.length, list(c.oursOnlyHexes));
section("Other records (naming a hex other than their own position)", c.strayRecords.length,
  c.strayRecords.map((s) => `${s.id} names ${s.label}`).join(", ") || "none");
section("Land in the game, all sea on our map", c.land.gameLand.length, list(c.land.gameLand));
section("All sea in the game, land on our map", c.land.gameSea.length, list(c.land.gameSea));
section("Land hexes the game gives water hexsides, not coastal on our map", c.coastal.gameCoastal.length, list(c.coastal.gameCoastal));
section("Land hexes the game gives no water hexside, coastal on our map", c.coastal.gameInland.length, list(c.coastal.gameInland));
section("Country", c.country.length, c.country.map((x) => `${x.id} (ours ${x.ours}, game ${x.game})`).join(", ") || "none");
section("Front", c.front.length, c.front.map((x) => `${x.id} (ours ${x.ours}, game ${x.game})`).join(", ") || "none");
section("Terrain (where the game's code names a terrain)", c.terrain.length, c.terrain.map((x) => `${x.id} (ours ${x.ours}, game ${x.game})`).join(", ") || "none");
for (const [k, v] of Object.entries(c.features)) {
  section(`Feature: ${k}`, v.gameOnly.length + v.oursOnly.length, `Game only: ${list(v.gameOnly)}. Ours only: ${list(v.oursOnly)}.`);
}

out.push("## Hexsides", "");
const h = c.hexsides;
section("Ground units may cross in the game, not on our map", h.landGameOnly.length, list(h.landGameOnly));
section("Ground units may cross on our map, not in the game", h.landOursOnly.length, list(h.landOursOnly));
section("Land crossing marked by one record only", h.landOneSided.length, list(h.landOneSided));
section("Water hexside in the game, not a sea hexside on our map", h.seaGameOnly.length, list(h.seaGameOnly));
section("Sea hexside on our map, no water in the game", h.seaOursOnly.length, list(h.seaOursOnly));
section("Water marked one-sided in the game", h.seaOneSided.length, list(h.seaOneSided));
section("Crossing arrows", h.arrowGameOnly.length + h.arrowOursOnly.length, `Game only: ${list(h.arrowGameOnly)}. Ours only: ${list(h.arrowOursOnly)}.`);
section("Rivers: game only", h.riverGameOnly.length, list(h.riverGameOnly));
section("Rivers: ours only", h.riverOursOnly.length, list(h.riverOursOnly));
section("National boundaries (crossable hexsides between two nations)", h.borderGameOnly.length + h.borderOursOnly.length,
  `Game only: ${list(h.borderGameOnly)}. Ours only: ${list(h.borderOursOnly)}.`);

out.push("## Notes", "", ...c.notes.map((n) => `- ${n}`), "");

// Nation totals, for the country counts.
const totals = new Map<string, number>();
for (const g of playable) if (hasLand(g) && MAP.hexes[g.id]) totals.set(NATIONS[g.nation] ?? "?", (totals.get(NATIONS[g.nation] ?? "?") ?? 0) + 1);
const oursTotals = new Map<string, number>();
for (const x of Object.values(MAP.hexes)) if (x.country) oursTotals.set(x.country, (oursTotals.get(x.country) ?? 0) + 1);
const diffs = [...new Set([...totals.keys(), ...oursTotals.keys()])].sort().filter((k) => totals.get(k) !== oursTotals.get(k));
out.push(`Country totals that differ (game/ours, hexes on our map): ${diffs.map((k) => `${k} ${totals.get(k) ?? 0}/${oursTotals.get(k) ?? 0}`).join(", ") || "none"}.`, "");

console.log(out.join("\n"));

export type { GameHex };
