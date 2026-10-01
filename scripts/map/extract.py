"""
Build src/data/map.json from the 300 dpi reference-map scan.

    python3 -m venv .venv && .venv/bin/pip install -r scripts/map/requirements.txt
    pdfimages -j -f 1 -l 1 Third-Reich_Map_DOS_EN.pdf /tmp/map     # -> /tmp/map-000.jpg
    .venv/bin/python scripts/map/extract.py /tmp/map-000.jpg

The scan is not stored in the repo (copyright); see docs/SOURCES.md. Hex terrain,
hexside crossability, rivers and borders are measured from the scan's colours; names,
symbols and special cases come from curated.py. The output is our own data.
"""
import argparse
import json
import re
import sys
from collections import Counter, deque
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage, signal
from scipy.spatial import cKDTree

import curated as C

Image.MAX_IMAGE_PIXELS = None
REPO = Path(__file__).resolve().parents[2]
ROWS = 40
DIRS = ((1, 0), (-1, 0), (1, -1), (0, -1), (0, 1), (-1, 1))  # E, W, NE, NW, SE, SW (axial)


# --- hex ids ---------------------------------------------------------------------------

def label(r):
    letter = chr(65 + r % 26)
    return letter if r < 26 else letter + letter


def hid(q, r):
    return f"{label(r)}{q}"


def parse(h):
    m = re.fullmatch(r"([A-Z])(\1?)(\d+)", h)
    return int(m.group(3)), (ord(m.group(1)) - 65) + (26 if m.group(2) else 0)


def side_id(a, b):
    (qa, ra), (qb, rb) = parse(a), parse(b)
    return f"{a}-{b}" if (ra < rb or (ra == rb and qa < qb)) else f"{b}-{a}"


def neighbours(h):
    q, r = parse(h)
    for dq, dr in DIRS:
        if 0 <= r + dr < ROWS and q + dq >= 0:
            yield hid(q + dq, r + dr)


# --- grid registration -----------------------------------------------------------------

def design(i, j):
    i, j = np.asarray(i, float), np.asarray(j, float)
    return np.stack([np.ones_like(i), i, j, i * i, i * j, j * j, i ** 3, i * i * j, i * j * j, j ** 3], -1)


def center(q, r):
    X = design(q - C.GRID_Q0, r - C.GRID_R0)
    return float(X @ np.array(C.GRID_FIT_X)), float(X @ np.array(C.GRID_FIT_Y))


def refit(gray):
    """Fit the lattice to hexagon-template matches. Prints new GRID_FIT_* for curated.py."""
    H, W = gray.shape
    bg = ndimage.zoom(ndimage.median_filter(gray[::4, ::4], size=9), 4, order=1)[:H, :W]
    dark = np.clip(bg - gray, 0, 80)
    w, v = 85.7, 72.7
    R = int(np.ceil(max(w, 4 * v / 3) / 2)) + 4
    yy, xx = np.mgrid[-R:R + 1, -R:R + 1].astype(np.float32)
    verts = [(0, -2 * v / 3), (w / 2, -v / 3), (w / 2, v / 3), (0, 2 * v / 3), (-w / 2, v / 3), (-w / 2, -v / 3)]
    k = np.zeros_like(xx)
    for (x1, y1), (x2, y2) in zip(verts, verts[1:] + verts[:1]):
        dx, dy = x2 - x1, y2 - y1
        t = np.clip(((xx - x1) * dx + (yy - y1) * dy) / (dx * dx + dy * dy), 0, 1)
        k = np.maximum(k, np.exp(-(np.hypot(xx - (x1 + t * dx), yy - (y1 + t * dy)) / 2.0) ** 2))
    corr = signal.fftconvolve(dark, (k - k.mean())[::-1, ::-1], mode="same")
    mx = ndimage.maximum_filter(corr, size=int(0.6 * w))
    peaks = np.argwhere((corr == mx) & (corr > np.percentile(corr, 99.0)))[:, ::-1].astype(float)
    # Seed with the current fit, then refine.
    cx, cy = np.array(C.GRID_FIT_X), np.array(C.GRID_FIT_Y)
    J = np.array([[cx[1], cx[2]], [cy[1], cy[2]]])
    ij = np.linalg.solve(J, (peaks - [cx[0], cy[0]]).T).T
    for _ in range(4):
        I = np.round(ij)
        X = design(I[:, 0], I[:, 1])
        pred = np.stack([X @ cx, X @ cy], 1)
        keep = np.hypot(*(pred - peaks).T) < 12
        cx, *_ = np.linalg.lstsq(X[keep], peaks[keep, 0], rcond=None)
        cy, *_ = np.linalg.lstsq(X[keep], peaks[keep, 1], rcond=None)
        J = np.array([[cx[1], cx[2]], [cy[1], cy[2]]])
        ij = I + np.linalg.solve(J, (peaks - np.stack([X @ cx, X @ cy], 1)).T).T
    print("GRID_FIT_X =", list(map(float, cx)))
    print("GRID_FIT_Y =", list(map(float, cy)))


# --- pixel classes ---------------------------------------------------------------------

def pixel_classes(p):
    r, g, b = p[..., 0], p[..., 1], p[..., 2]
    lum = (r + g + b) / 3
    sea = (b - r > 45) & (b > 150)
    green = (g - b > 25) & (np.abs(r - g) <= 15) & (lum > 70) & (lum < 160)
    yellow = (r > 180) & (g > 140) & (b < 140) & (r - b > 70)
    brown = (r - g > 15) & (r - g < 75) & (g - b > 15) & (r - b > 35) & (lum < 150) & (lum > 50) & ~yellow
    gray = (np.abs(r - g) < 18) & (np.abs(g - b) < 22) & (lum > 70) & (lum < 175) & ~sea & ~green
    light = (r > 175) & (g > 175) & (b > 160)
    black = (r < 45) & (g < 45) & (b < 45)
    red = (r > 150) & (g < 110) & (b < 120)
    ink = (lum < 70) & ~black
    return dict(sea=sea, green=green, yellow=yellow, brown=brown, gray=gray & ~light, light=light,
                black=black, red=red, ink=ink, lum=lum)


def hex_pixels(img, q, r, frac):
    x, y = center(q, r)
    w, v = 84.8, 73.6
    rad = frac * w / 2
    x0, y0 = max(int(x - rad - 2), 0), max(int(y - rad * 1.2 - 2), 0)
    sub = img[y0:int(y + rad * 1.2 + 2), x0:int(x + rad + 2)]
    yy, xx = np.mgrid[y0:y0 + sub.shape[0], x0:x0 + sub.shape[1]]
    dx, dy = np.abs(xx - x), np.abs(yy - y)
    inside = (dx <= rad) & (dx * 0.5 + dy * (w / 2) / (2 * v / 3) <= rad)
    return sub[inside]


def fractions(p):
    pc = pixel_classes(p)
    f = {k: float(m.mean()) for k, m in pc.items() if k != "lum"}
    nonink = ~(pc["ink"] | pc["black"] | pc["red"])
    f["tex"] = float(pc["lum"][nonink].std()) if nonink.sum() > 50 else 0.0
    return f


def point_in(poly, x, y):
    c = False
    for (x1, y1), (x2, y2) in zip(poly, poly[1:] + poly[:1]):
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            c = not c
    return c


# --- pipeline --------------------------------------------------------------------------

def classify_hexes(img):
    H, W, _ = img.shape
    out = {}
    for r in range(ROWS):
        for q in range(0, 90):
            x, y = center(q, r)
            if not (0 <= x < W and 0 <= y < H) or any(point_in(p, x, y) for p in C.OFF_MAP):
                continue
            core = fractions(hex_pixels(img, q, r, 0.8))
            full = fractions(hex_pixels(img, q, r, 0.97))
            if core["black"] >= 0.5 or core["light"] >= 0.6:      # outside the map, black land, Switzerland
                continue
            if r >= 28 and core["gray"] >= 0.3:                  # legend panels
                continue
            land_px = full["green"] + full["yellow"] + full["brown"] + (full["gray"] if full["gray"] >= 0.3 else 0)
            land, sea = land_px >= 0.04, full["sea"] >= 0.04
            if not land and not sea:
                continue
            terrain = None
            if land:
                tot = core["green"] + core["yellow"] + core["brown"] + core["gray"]
                if core["gray"] >= 0.5:
                    terrain = "swamp"
                elif tot > 0 and core["brown"] / tot >= 0.4 and core["tex"] >= 15:
                    terrain = "mountains"
                else:
                    terrain = "plain"
            out[hid(q, r)] = {"land": terrain, "sea": sea}
    # keep the single connected map
    seen, best = set(), []
    for h in out:
        if h in seen:
            continue
        comp, stack = [], [h]
        seen.add(h)
        while stack:
            x = stack.pop()
            comp.append(x)
            for n in neighbours(x):
                if n in out and n not in seen:
                    seen.add(n)
                    stack.append(n)
        best = max(best, comp, key=len)
    return {h: out[h] for h in best}


def classify_hexsides(img, hexes):
    H, W, _ = img.shape
    L = 24.0
    S = np.linspace(-0.75, 0.75, 31) * L

    def sample(pts):
        xs = np.clip(np.round(pts[..., 0]).astype(int), 0, W - 1)
        ys = np.clip(np.round(pts[..., 1]).astype(int), 0, H - 1)
        return img[ys, xs]

    out = {}
    for h in hexes:
        q, r = parse(h)
        for dq, dr in ((1, 0), (0, 1), (-1, 1)):
            n = hid(q + dq, r + dr) if r + dr < ROWS and q + dq >= 0 else None
            if n not in hexes:
                continue
            a, b = np.array(center(q, r)), np.array(center(*parse(n)))
            m = (a + b) / 2
            nv = (b - a) / np.linalg.norm(b - a)
            tv = np.array([-nv[1], nv[0]])

            def band(d0, d1, sign):
                ds = np.arange(d0, d1 + 1)
                pts = m[None, None, :] + S[:, None, None] * tv + sign * ds[None, :, None] * nv
                pc = pixel_classes(sample(pts))
                pc["landish"] = pc["green"] | pc["yellow"] | pc["brown"]
                pc["dark"] = pc["lum"] < 60
                pc["blueish"] = (sample(pts)[..., 2] - sample(pts)[..., 0] > 25) & (sample(pts)[..., 2] > 120) & ~pc["dark"]
                return pc

            swampy = "swamp" in (hexes[h]["land"], hexes[n]["land"])
            nA, nB, fA, fB = band(4, 12, -1), band(4, 12, 1), band(12, 22, -1), band(12, 22, 1)
            landA = np.concatenate([nA["landish"] | (nA["gray"] & swampy), fA["landish"] | (fA["gray"] & swampy)], 1).mean()
            landB = np.concatenate([nB["landish"] | (nB["gray"] & swampy), fB["landish"] | (fB["gray"] & swampy)], 1).mean()
            seaA, seaB = fA["sea"].mean(), fB["sea"].mean()
            centred = np.concatenate([band(1, 5, -1)["blueish"], band(1, 5, 1)["blueish"]], 1).mean()
            river = max(centred, nA["blueish"].mean() if seaA < 0.06 else 0, nB["blueish"].mean() if seaB < 0.06 else 0)
            land = landA >= 0.06 and landB >= 0.06 and hexes[h]["land"] is not None and hexes[n]["land"] is not None
            sea = seaA >= 0.06 and seaB >= 0.06 and hexes[h]["sea"] and hexes[n]["sea"]
            rec = {"land": bool(land), "sea": bool(sea), "mid": (float(m[0]), float(m[1])), "tv": tv, "nv": nv}
            if land and river >= 0.3:
                rec["river"] = True
            out[side_id(h, n)] = rec
    return out


def border_coverage(img, sides):
    """Share of each hexside covered by a thick (>= ~5 px) dark stroke: national borders."""
    r, g, b = (img[..., i].astype(np.int16) for i in range(3))
    thick = ndimage.binary_opening((r + g + b) / 3 < 75, structure=np.hypot(*np.mgrid[-2:3, -2:3]) <= 2.01)
    H, W = thick.shape
    for rec in sides.values():
        m, tv, nv = np.array(rec["mid"]), rec["tv"], rec["nv"]
        pts = m[None, None, :] + (np.linspace(-0.38, 0.38, 15) * 49.0)[:, None, None] * tv + np.arange(-6, 7)[None, :, None] * nv
        xs = np.clip(np.round(pts[..., 0]).astype(int), 0, W - 1)
        ys = np.clip(np.round(pts[..., 1]).astype(int), 0, H - 1)
        rec["border"] = float((thick[ys, xs].sum(1) >= 4).mean())


def fill(hexes, sides, seeds, passable):
    owner = {}
    for name, starts in seeds.items():
        for s in starts:
            if s not in hexes:
                raise SystemExit(f"seed {s} for {name} is not on the map")
            if s in owner:
                if owner[s] != name:
                    raise SystemExit(f"seed {s} for {name} was reached from {owner[s]}: a border is missing")
                continue
            owner[s] = name
            dq = deque([s])
            while dq:
                h = dq.popleft()
                for n in neighbours(h):
                    if n in hexes and n not in owner and passable(h, n):
                        owner[n] = name
                        dq.append(n)
    return owner


def red_coverage(img, sides):
    r, g, b = (img[..., i].astype(np.int16) for i in range(3))
    red = ndimage.binary_opening((r > 140) & (g < 120) & (b < 130) & (r - g > 60), structure=np.ones((3, 3)))
    H, W = red.shape
    for rec in sides.values():
        m, tv, nv = np.array(rec["mid"]), rec["tv"], rec["nv"]
        pts = m[None, None, :] + (np.linspace(-0.38, 0.38, 15) * 49.0)[:, None, None] * tv + np.arange(-6, 7)[None, :, None] * nv
        xs = np.clip(np.round(pts[..., 0]).astype(int), 0, W - 1)
        ys = np.clip(np.round(pts[..., 1]).astype(int), 0, H - 1)
        rec["red"] = float((red[ys, xs].sum(1) >= 2).mean())


def beaches(img, hexes):
    r, g, b = (img[..., i].astype(np.int16) for i in range(3))
    lum = ((r + g + b) / 3).astype(np.float32)
    sea = (b - r > 45) & (b > 150)
    tan = (r > 140) & (r < 215) & (g > 105) & (g < 165) & (b > 60) & (b < 120) & (r - g > 18) & (r - g < 55) & (g - b > 15)
    m, m2 = ndimage.uniform_filter(lum, 5), ndimage.uniform_filter(lum * lum, 5)
    smooth = np.sqrt(np.maximum(m2 - m * m, 0)) < 14
    beach = ndimage.binary_opening(tan & smooth & ndimage.binary_dilation(sea, iterations=14), structure=np.ones((3, 3)))
    keys = list(hexes)
    tree = cKDTree(np.array([center(*parse(k)) for k in keys]))
    ys, xs = np.nonzero(beach)
    _, idx = tree.query(np.stack([xs, ys], 1))
    cnt = Counter(idx.tolist())
    return {keys[i] for i, n in cnt.items() if n >= 80 and hexes[keys[i]]["land"] and hexes[keys[i]]["sea"]}


CITY_FEATURES = {
    "city": ["city"], "port": ["port"], "capital": ["capital"], "objective": ["objective"],
    "objective-port": ["objective", "port"], "capital-objective": ["capital", "objective"],
    "capital-port": ["capital-port"], "capital-port-objective": ["capital-port", "objective"],
}
BORDER = 0.3  # share of a hexside covered by a thick line that blocks the country fill
RANK = {"objective": 0, "capital": 1, "port": 2, "city": 3}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("scan", help="page 1 of Third-Reich_Map_DOS_EN.pdf as JPEG (pdfimages -j)")
    ap.add_argument("--refit", action="store_true", help="re-fit the hex lattice and print coefficients")
    ap.add_argument("--debug", help="write a debug overlay PNG here (keep it outside the repo)")
    args = ap.parse_args()

    img = np.asarray(Image.open(args.scan).convert("RGB")).astype(np.int32)
    if args.refit:
        refit(img.mean(2).astype(np.float32))
        return

    hexes = classify_hexes(img)
    tree = cKDTree(np.array([center(*parse(h)) for h in hexes]))
    keys = list(hexes)

    # Cities fix land/sea on their hex: a symbol means land; a port means sea too.
    city_hex = {}
    for name, kind, x, y in C.CITIES:
        h = keys[tree.query([x, y])[1]]
        city_hex.setdefault(h, []).append((name, kind))
        if hexes[h]["land"] is None:
            hexes[h]["land"] = "plain"
        if "port" in kind:
            hexes[h]["sea"] = True
    for h, t in C.TERRAIN_OVERRIDES.items():
        hexes[h]["land"] = t

    sides = classify_hexsides(img, hexes)
    border_coverage(img, sides)
    red_coverage(img, sides)
    for s in C.QATTARA_HEXSIDES:
        sides[s].update(land=False, sea=False, qattara=True)
        sides[s].pop("river", None)
    for s in C.CROSSING_ARROWS:
        # All eight arrows cross straits: water, navigable, crossable by land only at the arrow.
        sides[s].update(land=False, sea=True, crossingArrow=True)
        sides[s].pop("river", None)
    for s in C.SUEZ_CANAL:
        sides[s].update(sea=True, suezCanal=True)
        for h in s.split("-"):   # the canal is too thin for colour sampling to see as water
            hexes[h]["sea"] = True

    def land_link(a, b):
        s = side_id(a, b)
        return hexes[a]["land"] and hexes[b]["land"] and sides[s]["land"] and s not in C.EXTRA_BORDERS

    country = fill(hexes, sides, C.COUNTRY_SEEDS,
                   lambda a, b: land_link(a, b) and sides[side_id(a, b)]["border"] < BORDER)
    land = [h for h, v in hexes.items() if v["land"]]
    missing = [h for h in land if h not in country]
    if missing:
        raise SystemExit(f"land hexes without a country (add a seed or check the borders): {missing}")

    front = {}
    for f, names in C.FRONT_OF_COUNTRY.items():
        for h in land:
            if country[h] in names:
                front[h] = f
    for name, main_hex, other in C.FRONT_SPLITS:
        reach = fill({h: 1 for h in land if country[h] == name}, sides, {name: [main_hex]},
                     lambda a, b: land_link(a, b) and sides[side_id(a, b)]["red"] < 0.6)
        for h in land:
            if country[h] == name and h not in reach:
                front[h] = other

    for start, f in C.FRONT_OVERRIDES.items():
        mass = fill({h: 1 for h in land if country[h] == country[start]}, sides, {f: [start]}, land_link)
        for h in mass:
            front[h] = f

    # Coastal hexes take their land's front, and the red front lines run through them,
    # so the seas are separated once only all-sea hexes are filled.
    sea_hexes = {h: 1 for h, v in hexes.items() if v["sea"] and v["land"] is None}
    sea_front = {}
    for f, starts in C.SEA_FRONT_SEEDS.items():
        reach = fill(sea_hexes, sides, {f: starts},
                     lambda a, b: sides[side_id(a, b)]["sea"] and sides[side_id(a, b)]["red"] < 0.6
                     and (a not in sea_front) and (b not in sea_front))
        for h in reach:
            if h in sea_front and sea_front[h] != f:
                # find where the two seas meet, to point at the gap in the red line
                gap = [side_id(a, b) for a in reach for b in neighbours(a)
                       if b in sea_front and sea_front[b] != f and sides.get(side_id(a, b), {}).get("sea")]
                raise SystemExit(f"sea hex {h} reached from both {sea_front[h]} and {f}; gaps: {gap[:10]}")
            sea_front[h] = f
    # Enclosed waters not reached from the open seas (Adriatic, Aegean, Azov, gulfs) take
    # the front of the coasts around them, which must agree; otherwise name it in curated.py.
    left = {h for h in sea_hexes if h not in sea_front}
    while left:
        comp, stack = set(), [left.pop()]
        while stack:
            h = stack.pop()
            comp.add(h)
            for n in neighbours(h):
                if n in left and sides[side_id(h, n)]["sea"]:
                    left.discard(n)
                    stack.append(n)
        coast = {front[n] for h in comp for n in neighbours(h) if n in front and hexes[n]["land"]}
        named = {C.SEA_FRONT_OVERRIDES[h] for h in comp if h in C.SEA_FRONT_OVERRIDES}
        options = named or coast
        if len(options) != 1:
            raise SystemExit(f"enclosed water {sorted(comp)} borders fronts {sorted(coast)}; add it to SEA_FRONT_OVERRIDES")
        for h in comp:
            sea_front[h] = next(iter(options))
    for h, v in hexes.items():
        if v["land"] is None:
            front[h] = sea_front[h]

    beach = beaches(img, hexes)

    out_hexes = {}
    for h in sorted(hexes, key=lambda k: (parse(k)[1], parse(k)[0])):
        v = hexes[h]
        rec = {"id": h, "land": v["land"], "sea": v["sea"], "features": []}
        feats = set()
        if h in beach:
            feats.add("beach")
        names = sorted(city_hex.get(h, []), key=lambda nk: min(RANK[part] for part in nk[1].split("-")))
        for _, kind in names:
            feats.update(CITY_FEATURES[kind])
        if "capital-port" in feats:
            feats -= {"capital", "port"}
        rec["features"] = sorted(feats)
        if names:
            rec["name"] = names[0][0]
        if h in C.FORTRESSES:
            rec["fortress"] = C.FORTRESSES[h]
        if v["land"]:
            rec["country"] = country[h]
        rec["front"] = front[h]
        if h in C.US_BOX_ENTRY:
            rec["usBoxEntry"] = True
        out_hexes[h] = rec

    out_sides = {}
    for s in sorted(sides, key=lambda k: [(parse(x)[1], parse(x)[0]) for x in k.split("-")]):
        v = sides[s]
        a, b = s.split("-")
        rec = {"id": s, "land": v["land"], "sea": v["sea"]}
        for k in ("river", "crossingArrow", "qattara", "suezCanal"):
            if v.get(k):
                rec[k] = True
        crossable = v["land"] or v.get("crossingArrow")
        if crossable and a in country and b in country and (country[a] != country[b] or s in C.EXTRA_BORDERS):
            rec["nationalBoundary"] = True
        if front[a] != front[b]:
            rec["frontBoundary"] = True
        out_sides[s] = rec

    data = {
        "source": "Third Reich PC (Avalon Hill, 1996) reference map, digitised by scripts/map/extract.py",
        "hexes": out_hexes,
        "hexsides": out_sides,
    }
    path = REPO / "src" / "data" / "map.json"
    path.write_text(json.dumps(data, separators=(",", ":")) + "\n")

    # Cross-check: borders detected from the scan vs borders implied by the countries.
    implied = {s for s, v in out_sides.items() if v.get("nationalBoundary")}
    drawn = {s for s, v in sides.items() if v["land"] and v["border"] >= 0.6}
    print(f"{len(out_hexes)} hexes ({len(land)} land), {len(out_sides)} hexsides -> {path}")
    print("countries:", dict(Counter(country.values()).most_common()))
    print("fronts (all hexes):", dict(Counter(front.values())))
    print(f"beaches: {len(beach)}, rivers: {sum('river' in v for v in out_sides.values())}")
    print(f"borders drawn but not implied: {sorted(drawn - implied)}")
    print(f"borders implied but not drawn: {len(implied - drawn)} (lakes, estuaries, coasts)")

    if args.debug:
        over = Image.open(args.scan).convert("RGB")
        d = ImageDraw.Draw(over)
        colours = {"western": (255, 60, 60), "eastern": (60, 60, 255), "mediterranean": (255, 200, 0)}
        for h, rec in out_hexes.items():
            x, y = center(*parse(h))
            if rec.get("front"):
                d.ellipse((x - 8, y - 8, x + 8, y + 8), fill=colours[rec["front"]])
        for s, rec in out_sides.items():
            if rec.get("nationalBoundary"):
                m, tv = np.array(sides[s]["mid"]), sides[s]["tv"]
                d.line((*(m - tv * 22), *(m + tv * 22)), fill=(0, 255, 0), width=7)
        over.save(args.debug)


if __name__ == "__main__":
    sys.exit(main())
