"""Trace the UAZ-469 hard-top factory drawing into a blueprint JSON and a carforge spec.

Usage: python3 trace_blueprint.py IMAGE OUT_BLUEPRINT.json OUT_SPEC.json

Each view uses its own pixel->mm anchors (the scan is anisotropic). Silhouettes are
flood-filled from the ink (dimension and extension lines masked), then sampled into
(y, z) / (x, z) / (y, x) polylines in mm. Mirror-symmetric front width is taken from
the front view, and the top view gives the shoulder half-width per station.
"""
import json
import sys

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

# --- anchors (original pixels) -------------------------------------------
# Side view, longitudinal: front overhang line 708 mm ahead of origin, 4100 mm extent.
SIDE_X = [(81.5, -708.0), (936.5, 3392.0)]
# Side view, vertical: ground row z=0, roof extension row z=2025.
SIDE_Z = [(551.0, 0.0), (146.5, 2025.0)]
# Front view, lateral: width extension lines 2010 mm apart.
FRONT_X = [(1071.5, -1005.0), (1499.5, 1005.0)]
# Top view lateral uses the front-view lateral scale; rows share the front-view scale.
TOP_X = FRONT_X
SIDE_HUB_PX = [(229.5, 471.0), (726.5, 471.0)]  # front, rear hub (px)
FRONT_WHEEL_LINES_PX = (1135.0, 1438.0)
# Glazed openings in side view (px boxes), from the enclosed-hole overlay.
SIDE_WINDOWS_PX = [
    (412, 525, 186, 277),
    (543, 670, 186, 277),
    (675, 838, 186, 280),
]
# Headlamp ring (front view, px), from Hough on the front crop; mirrored about centre.
HEADLAMP_PX = (1174.0, 350.0, 33.8)
TYRE_R_MM = 400.0  # hub row 471 to ground row 551 (80 px)
BODY_BOTTOM_Z = 445.0  # median of clean mid-body underside rows (441-446 px band)
TRACK_NOMINAL = 1445.0
BODY_FRONT = -628.0  # body face; bumper (80 mm) brings the nose to the 708 mm overhang
BODY_REAR = 2990.0  # rear panel; the spare sits behind it and sets the 3392 mm end
SPARE_Y_MM = 2992.0  # spare centre: 400 mm behind its outer edge at 3392
SPARE_HUB_Z = 1076.0  # spare hub height from the drawing (tyre 676-1476 mm)
BASE_SPEC = "tools/carforge/examples/uaz469.json"


def lin(anchors):
    (p0, m0), (p1, m1) = anchors
    k = (m1 - m0) / (p1 - p0)
    return lambda p: m0 + (np.asarray(p, dtype=float) - p0) * k


def load_ink(path):
    g = np.array(Image.open(path).convert("L"))
    ink = g < 150
    ink[:, 990:1012] = False  # dimension lines
    ink[140:152, 850:1012] = False
    ink[546:556, 880:1012] = False
    ink[:, 934:940] = False  # rear extension line
    ink[:, 78:85] = False  # front extension line
    return ink


def sil(ink, box, it=2):
    """Filled silhouette: pixels not reachable from the box border through non-ink."""
    x0, y0, x1, y1 = box
    m = np.zeros_like(ink)
    m[y0:y1, x0:x1] = ink[y0:y1, x0:x1]
    md = ndi.binary_dilation(m, iterations=it)
    lab, _ = ndi.label(~md)
    border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    return ~np.isin(lab, list(border))


def main(image, out_bp, out_spec):
    ink = load_ink(image)
    sx = lin(SIDE_X)
    sz = lin(SIDE_Z)
    fx = lin(FRONT_X)
    fz = lin(SIDE_Z)
    px_per_mm_front = (FRONT_X[1][0] - FRONT_X[0][0]) / (FRONT_X[1][1] - FRONT_X[0][1])

    # ---- side silhouette: roof profile (y, z) ----
    side = sil(ink, (70, 128, 1000, 548))
    roof = []
    for ymm in np.arange(SIDE_X[0][1], SIDE_X[1][1] + 1, 25.0):
        col = int(round(SIDE_X[0][0] + (ymm - SIDE_X[0][1]) / (SIDE_X[1][1] - SIDE_X[0][1]) * (SIDE_X[1][0] - SIDE_X[0][0])))
        if not (0 <= col < side.shape[1]):
            continue
        rows = np.where(side[:, col])[0]
        if rows.size:
            roof.append([float(ymm), float(sz(rows.min()))])

    # ---- windows (side) ----
    windows = []
    for x0, x1, y0, y1 in SIDE_WINDOWS_PX:
        windows.append({"y": [float(sx(x0)), float(sx(x1))], "z": [float(sz(y1)), float(sz(y0))]})
    belt_z = float(np.mean([w["z"][0] for w in windows]))

    # ---- front silhouette (x, z) and cabin half-width ----
    front = sil(ink, (1040, 128, 1540, 620))
    front_pts = []
    roof_hw = None
    for row in range(128, 620, 8):
        cols = np.where(front[row])[0]
        if cols.size == 0:
            continue
        hw = float(fx(cols.max()))
        front_pts.append([hw, float(fz(row))])
        front_pts.append([float(fx(cols.min())), float(fz(row))])
        if roof_hw is None and float(fz(row)) <= 1700.0:
            roof_hw = (hw - float(fx(cols.min()))) / 2.0

    # ---- top silhouette: shoulder half-width per station ----
    top = sil(ink, (60, 650, 950, 1130))
    top_pts = []
    for col in range(60, 950, 8):
        rows = np.where(top[:, col])[0]
        if rows.size == 0:
            continue
        top_pts.append([float(sx(col)), float(abs(fx(rows.max()) - fx(rows.min())) / 2.0)])

    hx, hy, hr = HEADLAMP_PX
    headlamp = {"x": float(fx(hx)), "z": float(fz(hy)), "r": float(hr / px_per_mm_front)}
    track = float(fx(FRONT_WHEEL_LINES_PX[1]) - fx(FRONT_WHEEL_LINES_PX[0]))
    front_hub_y = float(sx(SIDE_HUB_PX[0][0]))
    rear_hub_y = float(sx(SIDE_HUB_PX[1][0]))

    bp = {
        "id": "uaz3151x",
        "source": image,
        "scale": {"side_x": SIDE_X, "side_z": SIDE_Z, "front_x": FRONT_X, "top_x": TOP_X},
        "wheels": {
            "radius": TYRE_R_MM,
            "hub_front_y": front_hub_y,
            "hub_rear_y": rear_hub_y,
            "track_traced": track,
            "track_nominal": TRACK_NOMINAL,
        },
        "side": {"roof_yz": roof, "windows": windows, "belt_z": belt_z, "body_bottom_z": BODY_BOTTOM_Z},
        "front": {"outline_xz": front_pts, "headlamp": headlamp, "cabin_half_width": roof_hw},
        "top": {"shoulder_y_halfwidth": top_pts},
    }
    with open(out_bp, "w") as f:
        json.dump(bp, f, indent=1)

    # Body ends at the rear panel; the spare wheel carries the 4100 mm length to the rear.
    base = json.load(open(BASE_SPEC))

    def clip(pts):
        pts = sorted((float(a), float(b)) for a, b in pts)
        ys = [p[0] for p in pts]
        vs = [p[1] for p in pts]
        mid = [p for p in pts if BODY_FRONT < p[0] < BODY_REAR]
        out = [(BODY_FRONT, float(np.interp(BODY_FRONT, ys, vs)))] + mid + [(BODY_REAR, float(np.interp(BODY_REAR, ys, vs)))]
        return [[round(a), round(b)] for a, b in out]

    shoulder = [p for p in top_pts if p[1] > 100]
    glass_y = []
    for w in windows:
        a, b = w["y"]
        glass_y += [round(a + 10), round(b - 10)]
    stations = {round(y) for y in (BODY_FRONT, 0, 550, 1000, 1500, 2000, 2380, 2600, BODY_REAR)}
    stations |= set(glass_y)
    spec = {
        "id": "uaz3151x",
        "wheels": {
            "radius": TYRE_R_MM,
            "width": 215,
            "track_front": round(track),
            "track_rear": round(track),
            "wheelbase": round(rear_hub_y - front_hub_y),
            "arch_factor": 1.2,
        },
        "spare": {"y": SPARE_Y_MM, "z": SPARE_HUB_Z},
        "silhouette": {
            "bottom": [[round(BODY_FRONT), round(BODY_BOTTOM_Z)], [round(BODY_REAR), round(BODY_BOTTOM_Z)]],
            "top": clip(roof),
            "beltline": [[round(BODY_FRONT), round(belt_z)], [round(BODY_REAR), round(belt_z)]],
            "shoulder": clip(shoulder),
            "roof": [[round(BODY_FRONT), round(roof_hw)], [round(BODY_REAR), round(roof_hw)]],
        },
        "stations": [{"y": y, "glass": y in glass_y} for y in sorted(stations)],
        "bumpers": base["bumpers"],
        "grille": base["grille"],
        "wings": [dict(base["wings"][0], arch={"y": 0, "z": round(TYRE_R_MM), "r": round(1.2 * TYRE_R_MM)})],
        "mirrors": base["mirrors"],
        "lamps": [
            {"role": "headlights", "x": [round(-headlamp["x"] - headlamp["r"]), round(-headlamp["x"] + headlamp["r"])],
             "z": [round(headlamp["z"] - headlamp["r"]), round(headlamp["z"] + headlamp["r"])], "round": True},
            {"role": "headlights", "x": [round(headlamp["x"] - headlamp["r"]), round(headlamp["x"] + headlamp["r"])],
             "z": [round(headlamp["z"] - headlamp["r"]), round(headlamp["z"] + headlamp["r"])], "round": True},
        ] + [l for l in base["lamps"] if l["role"] != "headlights"],
    }
    with open(out_spec, "w") as f:
        json.dump(spec, f, indent=1)
    print("track", round(track), "wheelbase", spec["wheels"]["wheelbase"], "roof_hw", round(roof_hw),
          "belt_z", round(belt_z), "headlamp", {k: round(v) for k, v in headlamp.items()})


if __name__ == "__main__":
    main(*sys.argv[1:4])
