"""Convert a traced blueprint (pixels) into a carforge spec (new three-view schema, mm).

  python3 tools/carforge/fit_blueprint.py --in tools/carforge/examples/blueprint_uaz3151.json \
      --out tools/carforge/examples/uaz3151.json

Input (JSON). Pixel coordinates are image pixels; rows grow downward; the front view and the side view
share one scale and one ground row (z0_px) so that z means the same thing in both.

  id, source            spec id and provenance text (copied to the output)
  scale                 {mm_per_px, y0_px, z0_px, x0_px, top_x0_px?, rear_x0_px?, deskew?}
                          y = (px - y0_px) * mm_per_px      side x-px of the front axle is y0_px
                          z = (z0_px - py) * mm_per_px      ground row is z0_px
                          x = (px - x0_px) * mm_per_px      front view, car left = +x
                        top_x0_px (top view centre row; the top view's columns are the side view's),
                        rear_x0_px (rear view centre column) and deskew {deg, centre} (the rotation
                        trace.py applied to the scan) only place renders for compare.py; the spec
                        does not use them
  side                  {top, bottom, shoulder}: [[px, py], ...] side-view polylines (mm: y, z)
  plan                  {low, high}: [[px, hw_px], ...] plan half-widths, px along the side x-axis
                          (low = below the shoulder, high = above it)
  tumblehome            [[py, factor], ...] greenhouse half-width factor, relative to the belt width
  belt, glass_top       side-view rows (py)
  windscreen            [px0, px1] y-range of the windscreen (px)
  windows               [[px0, px1] | {outline: [[px, py], ...], round?, pillar?}, ...] side windows: a
                          y-range (px), or the glass edge's corners traced in the side view (round: mm;
                          pillar "a"|"c": that edge follows the A or C pillar), flags copied
  seams                 [[[px, py], ...], ...] door and panel seam polylines in the side view
  arches                {front|rear: {outline: [[px, py], ...], lip?, flare?}}: the arch opening's
                          edge in the side view, front to rear (lip/flare in mm, copied)
  lamps                 front-face lamps traced in the front view: {role, face: "front", round?,
                          segments?, single?, bezel?, bezel_depth?, bezel_cell?, circle: [cx, cy, r] |
                          rect: [x0, y0, x1, y1]} (px; bezel, bezel_depth: mm); rear-face lamps are
                          given in mm: {role, face: "rear", x, z, ...}
  wheels, bumpers, mirrors, plates, spare, nose, tail, recesses, grooves, lines: mm, copied through
                          unchanged (not traced in px; see the face coordinates in README.md)

Output keys follow the carforge schema (see tools/carforge/README.md).
"""

import argparse
import json


def fail(msg):
    raise SystemExit("fit_blueprint: " + msg)


def num(v):
    return int(round(v))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="src", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    with open(a.src) as fh:
        bp = json.load(fh)
    for key in ("id", "scale", "side", "plan", "tumblehome", "belt", "glass_top", "windows", "wheels"):
        if key not in bp:
            fail(f"missing key {key!r}")
    sc = bp["scale"]
    mm, y0, z0, x0 = sc["mm_per_px"], sc["y0_px"], sc["z0_px"], sc["x0_px"]

    def y_of(px):
        return num((px - y0) * mm)

    def z_of(py):
        return num((z0 - py) * mm)

    def xz_of(px):
        return num((px - x0) * mm)

    def side_line(pts):
        return [[y_of(px), z_of(py)] for px, py in pts]

    def plan_line(pts):
        return [[y_of(px), num(hw * mm)] for px, hw in pts]

    spec = {"id": bp["id"]}
    if "source" in bp:
        spec["source"] = bp["source"]
    spec["side"] = {
        "top": side_line(bp["side"]["top"]),
        "bottom": side_line(bp["side"]["bottom"]),
        "shoulder": side_line(bp["side"]["shoulder"]),
    }
    spec["plan"] = {"low": plan_line(bp["plan"]["low"]), "high": plan_line(bp["plan"]["high"])}
    spec["tumblehome"] = [[z_of(py), round(f, 3)] for py, f in bp["tumblehome"]]
    spec["belt"] = z_of(bp["belt"])
    spec["glass_top"] = z_of(bp["glass_top"])
    if "windscreen" in bp:
        spec["windscreen"] = [y_of(v) for v in bp["windscreen"]]
    if "backlight" in bp:
        spec["backlight"] = [y_of(v) for v in bp["backlight"]]
    windows = []
    for w in bp["windows"]:
        if isinstance(w, dict):
            out = {"y": [y_of(min(p[0] for p in w["outline"])), y_of(max(p[0] for p in w["outline"]))],
                   "outline": side_line(w["outline"])}
            for k in ("round", "pillar"):
                if k in w:
                    out[k] = w[k]
            windows.append(out)
        else:
            windows.append({"y": [y_of(w[0]), y_of(w[1])]})
    spec["windows"] = windows
    if "seams" in bp:
        spec["seams"] = [side_line(line) for line in bp["seams"]]
    spec["wheels"] = bp["wheels"]
    if "arches" in bp:
        spec["arches"] = {tag: {**{k: v for k, v in arch.items() if k != "outline"},
                                "outline": side_line(arch["outline"])} for tag, arch in bp["arches"].items()}
    for key in ("bumpers", "mirrors", "plates", "nose", "tail", "recesses", "grooves", "lines"):
        if key in bp:
            spec[key] = bp[key]

    lamps = []
    for lp in bp.get("lamps", []):
        out = {"role": lp["role"], "face": lp["face"]}
        for flag in ("round", "segments", "single", "bezel", "bezel_depth", "bezel_cell", "dome", "rim", "rim_cell"):
            if flag in lp:
                out[flag] = lp[flag]
        if "circle" in lp:
            cx, cy, r = lp["circle"]
            xa, xb = xz_of(cx - r), xz_of(cx + r)
            za, zb = z_of(cy + r), z_of(cy - r)
        elif "rect" in lp:
            px0, py0, px1, py1 = lp["rect"]
            xa, xb = xz_of(px0), xz_of(px1)
            za, zb = z_of(py1), z_of(py0)
        else:  # given in mm: a rear lamp (x, z) or a side lamp (y, z)
            for k in ("x", "y", "z"):
                if k in lp:
                    out[k] = sorted(lp[k])
            lamps.append(out)
            continue
        out["x"] = [min(xa, xb), max(xa, xb)]
        out["z"] = [min(za, zb), max(za, zb)]
        lamps.append(out)
    if lamps:
        spec["lamps"] = lamps
    if "spare" in bp:
        spec["spare"] = bp["spare"]

    with open(a.out, "w") as fh:
        json.dump(spec, fh, indent=1)
        fh.write("\n")
    print("WROTE " + a.out)


if __name__ == "__main__":
    main()
