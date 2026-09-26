"""Tree atlases, tree models and impostor bakes, rendered in Blender.

    Blender --background --factory-startup --python trees/trees.py -- <job> <outdir> [args]

Jobs (the JS driver tools/look/trees.mjs runs them in this order per species and
season, compositing between runs):
    clumps  <species> <season> <outdir>          six crown modules -> the card sprites
    tree    <species> <season> <clumpsDir> <outdir> <column> <columns>
                                                 whole-tree sprite, impostor row, GLBs
    bark    <species> <outdir>                   the tiling bark strip
    conifer <species> <season> <outdir>          whole-tree sprite, top-down star,
                                                 side branch, impostor row
    models  <outdir> <name>:<column>:<columns>..  the GLBs of those species only

How the look is made (docs/slowroads-steam/notes/SrTrees.md §2-§4, and the
2026-09-26 review that rejected the previous hand-assembled sprites):

* Every sprite comes from a **full-detail 3D tree** — a recursive skeleton of four
  orders plus several thousand individual leaves 3-9 cm across, clustered on the
  terminal twigs — and never from the low-poly game model. That is the whole
  difference between a crown that reads as a tree and one that reads as a handful
  of flat cards.
* The tree is grown deterministically from (species, seed): trunk, limbs and
  branch orders with species habits — birch: slender white trunk, ascending
  limbs, long drooping twigs, open airy crown; aspen: straight trunk, narrow high
  crown; oak: thick short trunk, crooked wide-spreading limbs; lime: dense
  rounded crown.
* Shading is baked, never simulated: a ray-traced sun would double-light against
  the game's own Lambert pass, so each leaf carries a **per-leaf ambient
  occlusion** computed from how many other leaves surround it, times an outward
  and skyward term. The crown therefore has a lit outside and a darker inside,
  which is what the eye reads as volume.
* Normals are analytic (crown capsule, conifer cone, flattened outward for bark)
  and stored **per vertex**, which keeps the bake deterministic and lets the
  impostor row bake one material per view.
* Everything is rendered unlit, with Cycles' transparent BSDF doing the cutout:
  deterministic, a handful of samples, no lighting the game would apply twice.
  See public/look/manifest.json for the atlas layout and the conventions.
"""

import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'blender'))
import bpy  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

import lib as L  # noqa: E402

LOOK = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(LOOK, '.cache')
PH = os.path.join(CACHE, 'ph-files')
LEAF_FILE = os.path.join(CACHE, 'acg-Leaf001', 'Leaf001_1K-JPG_Color.jpg')
LEAF_ALPHA = os.path.join(CACHE, 'acg-Leaf001', 'Leaf001_1K-JPG_Opacity.jpg')

# the photo sheet holds two single leaves side by side; uv = (u0, v0, u1, v1)
LEAF_RECTS = [(0.02, 0.02, 0.48, 0.98), (0.52, 0.02, 0.98, 0.98)]
# a needle sprig sheet is drawn 2 x 2 and read the same way: four shoots of the
# same species, so a crown of twenty thousand cards is not one drawing repeated
SPRIG_RECTS = [(0.02, 0.52, 0.48, 0.98), (0.52, 0.52, 0.98, 0.98),
               (0.02, 0.02, 0.48, 0.48), (0.52, 0.02, 0.98, 0.48)]

# --------------------------------------------------------------------------- #
# atlas layout, in atlas pixels with y measured from the TOP of the column.
# A column is 1024 px wide and 1024 px tall; public/look/manifest.json repeats
# this in uv and in metres for the consumer.

COLUMN_PX = 1024
WHOLE = dict(x=0, y=0, w=512, h=768)          # whole-tree sprite
CLUMPS = [(x, y) for y in (0, 256, 512) for x in (512, 768)]   # 6 x 256^2, row 0 on top
BARK = dict(x=0, y=768, w=1024, h=256)        # tiling bark strip, v < 0.25
# 512 x 768 px at 64 px/m covers 8.0 x 12.0 m, so the 10.2-11.5 m trees fill
# 85-96 % of their cell height without ever touching an edge.
WHOLE_M = (8.0, 12.0)
# 256 px over 3.2 m = 80 px/m: a 6 cm leaf is nearly five texels wide, so a clump
# sprite keeps its leaf texture instead of turning into noise.
CLUMP_M = 3.2
# 2.0 m along the trunk per repeat, and 0.5 m around it per repeat: the strip cell
# is 1024 x 256 px, so both directions come out at the same 512 px/m and the
# pattern is neither squashed nor stretched. 0.5 m of circumference is a 0.16 m
# trunk's wrap, which is what these trees have at the base.
BARK_M = (2.0, 0.5)                           # metres along the trunk / around it
# A conifer column holds the same whole-tree sprite as a deciduous one, plus the
# top-down star its fans sample, a side branch and the bark strip. The star used
# to be three cells 512 px square, and the third of them overlapped the bark strip
# the driver composited over it: half of that cell was bark, which is what "a
# whorl cell with a hexagon of trunk in it" turned out to be. One star per
# species, no overlap, and the model scales it to its own whorl radius.
STAR = dict(x=512, y=0, w=512, h=512, m=5.6)
BRANCH = dict(x=512, y=512, w=512, h=256, m=(4.0, 2.0))
# 256 px over 12.4 m puts an 11.5 m birch across 93 % of the impostor cell height
IMPOSTOR_CELL_M = 12.4
IMPOSTOR_VIEWS = 16
IMPOSTOR_VARIANTS = 4


def clump_uv(i):
    """uv rect of clump cell i (u0, v0, u1, v1) with v from the image bottom."""
    x, y = CLUMPS[i]
    return (x / COLUMN_PX, 1.0 - (y + 256) / 1024.0, (x + 256) / COLUMN_PX, 1.0 - y / 1024.0)


# --------------------------------------------------------------------------- #
# species
#
# `levels` is the branching recipe below the trunk: limb, branch, twig, twiglet.
#   n      children per segment (min, max)
#   len    child length in metres (min, max)
#   r      child radius as a fraction of the parent's
#   spread half-angle of the children off the parent axis, degrees
#   up     vertical bias added to a child direction (-1 = straight down)
#   steps  polyline segments in one branch
#   curv   per-step wander of the direction
#   grav   gravity pull accumulated while the branch is walked


def _lvl(n, ln, r, spread, up, steps, curv, grav, minz=-0.95):
    """`minz` is the lowest z component a child direction may have: an ascending
    limb that starts pointing 30 degrees down leaves a white bar hanging out of
    the crown, which is exactly what the first birch render showed."""
    return dict(n=n, len=ln, r=r, spread=spread, up=up, steps=steps, curv=curv,
                grav=grav, minz=minz)


SPECIES = {
    'birch': dict(
        kind='deciduous', bark='Bark011', height=11.5, trunk_r=(0.115, 0.055), trunk_h=3.3,
        sides=6, lean=0.035, crown_r=4.70, leaves=42000, leaf=(0.190, 0.155),
        leaf_shape='birch', thin=True,
        levels=[_lvl((5, 7), (1.7, 2.5), 0.40, 60, 0.75, 3, 0.16, -0.05, 0.34),
                _lvl((3, 5), (1.00, 1.55), 0.44, 52, 0.45, 3, 0.22, -0.20, 0.10),
                _lvl((3, 4), (0.60, 1.00), 0.52, 48, 0.20, 2, 0.30, -0.45, -0.30),
                _lvl((2, 3), (0.50, 0.90), 0.58, 44, -0.05, 2, 0.34, -0.75)],
        autumn=(0.62, 0.40, 0.045), autumn_name='gold',
    ),
    'aspen': dict(
        kind='deciduous', bark='Bark009', height=11.2, trunk_r=(0.120, 0.055), trunk_h=4.0,
        sides=6, lean=0.02, crown_r=5.25, leaves=34000, leaf=(0.145, 0.132),
        leaf_shape='aspen', thin=False,
        levels=[_lvl((4, 5), (1.50, 2.20), 0.38, 44, 1.20, 3, 0.13, -0.04, 0.55),
                _lvl((3, 4), (0.80, 1.20), 0.46, 40, 0.75, 2, 0.20, -0.18, 0.20),
                _lvl((2, 4), (0.50, 0.85), 0.54, 40, 0.35, 2, 0.28, -0.55),
                _lvl((2, 3), (0.36, 0.65), 0.58, 38, 0.00, 2, 0.32, -1.00)],
        autumn=(0.60, 0.20, 0.028), autumn_name='orange-red',
    ),
    'oak': dict(
        kind='deciduous', bark='Bark014', height=10.9, trunk_r=(0.170, 0.080), trunk_h=2.1,
        sides=7, lean=0.09, crown_r=5.20, leaves=40000, leaf=(0.185, 0.130),
        leaf_shape='oak', thin=False,
        levels=[_lvl((4, 6), (1.40, 2.00), 0.48, 72, 0.35, 3, 0.30, -0.12, 0.30),
                _lvl((3, 5), (0.90, 1.40), 0.50, 62, 0.30, 3, 0.32, -0.30, 0.05),
                _lvl((2, 4), (0.58, 0.95), 0.56, 52, 0.10, 2, 0.34, -0.28),
                _lvl((2, 3), (0.42, 0.75), 0.60, 46, 0.00, 2, 0.36, -0.45)],
        autumn=(0.38, 0.21, 0.055), autumn_name='ochre-brown', summer=(0.042, 0.100, 0.026),
    ),
    'lime': dict(
        kind='deciduous', bark='Bark006', height=11.4, trunk_r=(0.140, 0.065), trunk_h=3.0,
        sides=6, lean=0.04, crown_r=5.85, leaves=38000, leaf=(0.175, 0.140),
        leaf_shape='lime', thin=False,
        levels=[_lvl((4, 6), (1.50, 2.20), 0.42, 62, 0.60, 3, 0.20, -0.08, 0.34),
                _lvl((3, 4), (0.95, 1.45), 0.46, 54, 0.40, 3, 0.26, -0.24, 0.10),
                _lvl((2, 4), (0.58, 0.95), 0.54, 50, 0.15, 2, 0.32, -0.50),
                _lvl((2, 3), (0.42, 0.78), 0.58, 44, -0.05, 2, 0.34, -1.05)],
        autumn=(0.66, 0.50, 0.070), autumn_name='yellow', summer=(0.052, 0.135, 0.030),
    ),
    # Conifers are *grown* like the deciduous trees, not cut out of a scan: a
    # whorled skeleton of three orders, and every needle sprig its own quad on a
    # card drawn at its own scale (see needle_sheet). Slicing a CC0 scan gave
    # flat olive silhouettes, whorl cells aimed at the gaps between tiers and a
    # hexagon of trunk in the middle of a star.
    #
    # The height is what fits the cells: the whole-tree sprite is 8 x 12 m at
    # 64 px/m, so a 12 m tree would put its apex on the cell's top edge, where a
    # mip level blends the sprite into the row above. 11.3 / 11.6 m is 94-97 % of
    # that cell and 91-94 % of the 12.4 m impostor cell, the same calibration the
    # deciduous species use.
    'spruce': dict(
        # Norway spruce (Picea abies, central Russia): a straight trunk, regular
        # whorls of branches that reach the ground in the open, ascending near
        # the top and drooping in the lower half with hanging branchlets (comb
        # habit), dark blue-green needles, and a crown with a dark core.
        kind='conifer', bark='Bark006', bark_style='spruce', bark_m=(2.0, 0.5),
        height=11.3, trunk_r=(0.205, 0.030), trunk_h=11.3, sides=6, lean=0.010,
        # `whorl_hi` is 0.9 of the way up: raising it to 11.05 m closes the leader
        # with two more tiers, but the assets in `public/look` were rendered at
        # 10.30 m, so the tree here stays at what they show (see the log)
        whorls=26, crown=(3.30, 0.10), crown_lo=0.95, whorl_hi=10.30, whorl_pow=0.85,
        branch_n=(8, 3), branch_pitch=(-0.14, 0.44), envelope=1.30, floor_m=0.45,
        # whorl branch -> branchlet -> needle twig. `minz` never reaches -1: a
        # branchlet hanging straight down reads as a wire, not as a comb.
        levels=[_lvl((7, 9), (0.42, 0.80), 0.30, 62, -0.06, 4, 0.15, -0.16, -0.78),
                _lvl((4, 6), (0.17, 0.30), 0.46, 58, -0.10, 3, 0.22, -0.42, -0.80),
                _lvl((2, 3), (0.10, 0.18), 0.60, 52, -0.12, 2, 0.26, -0.55, -0.70)],
        sprig=dict(level=(0.55, 1.00, 1.00), t_range=(0.0, 1.0), len=(0.20, 0.30),
                   wid=(0.13, 0.20), per_m=13.0, up=0.35, gain=1.06),
        needle=dict(needles=30, len=(0.30, 0.52), thick=(0.030, 0.046), spread=1.35,
                    base=(0.155, 0.255, 0.165), tip=(0.285, 0.400, 0.250),
                    twig=(0.330, 0.255, 0.180)),
        crown_to_ground=True, snow=True,
    ),
    'pine': dict(
        # Scots pine (Pinus sylvestris): a tall clear trunk with grey-brown
        # furrowed lower bark and orange-red flaky upper bark, a few dead stubs
        # below, and the crown only in the top third — irregular flat plates of
        # grey-green needle tufts on crooked limbs.
        kind='conifer', bark='Bark012', bark_style='pine', bark_m=(11.6, 2.9),
        height=11.6, trunk_r=(0.260, 0.055), trunk_h=11.6, sides=6, lean=0.014,
        whorls=11, crown=(2.85, 0.25), crown_lo=7.60, whorl_hi=11.10, whorl_pow=0.55,
        branch_n=(4, 2), branch_pitch=(0.12, 0.55), envelope=1.35, floor_m=0.35,
        stubs=dict(count=7, lo=1.4, hi=6.6, len=(0.22, 0.52)),
        # crooked limbs that level out and carry their foliage at the ends: the
        # last two orders are the plates, and a plate is a flat mass, not a
        # drooping one — which is what the model's side cards are drawn from
        levels=[_lvl((4, 5), (0.90, 1.70), 0.40, 46, 0.30, 4, 0.30, -0.22, -0.28),
                _lvl((3, 4), (0.42, 0.78), 0.50, 60, 0.16, 3, 0.28, -0.22, -0.16),
                _lvl((2, 3), (0.22, 0.44), 0.60, 62, 0.18, 2, 0.28, -0.26, -0.30)],
        sprig=dict(level=(0.40, 0.85, 1.00), t_range=(0.30, 1.0), len=(0.28, 0.40),
                   wid=(0.20, 0.28), per_m=140.0, up=0.12, gain=1.22),
        needle=dict(needles=18, fascicles=6, len=(0.40, 0.66), thick=(0.026, 0.040),
                    spread=0.60,
                    base=(0.300, 0.380, 0.275), tip=(0.395, 0.470, 0.320),
                    twig=(0.370, 0.300, 0.205)),
        snow=True,
    ),
}

# Season grade: `tint` is mixed into the photographed leaf, `amount` how much of
# the mix a fully turned leaf takes, `bias` what a leaf that never turns takes
# (spring and summer keep the crown uniform, autumn gets real variety), `gain` a
# linear brightness scale, `bright` the spread of the per-leaf brightness.
LEAF_GRADES = {
    'spring': dict(tint=(0.185, 0.290, 0.062), amount=0.50, bias=0.62, gain=1.18, bright=(0.84, 1.26)),
    'summer': dict(tint=(0.058, 0.150, 0.030), amount=0.52, bias=0.70, gain=1.00, bright=(0.72, 1.30)),
    'autumn': dict(tint=(0.60, 0.40, 0.06), amount=0.80, bias=0.16, gain=0.97, bright=(0.74, 1.28)),
    'winter': dict(tint=(0.10, 0.12, 0.08), amount=0.60, bias=0.55, gain=0.94, bright=(0.85, 1.15)),
}

CONIFER_GRADES = {
    'spring': dict(tint=(0.10, 0.24, 0.07), amount=0.22, gain=1.05),
    'summer': dict(tint=(0.045, 0.12, 0.04), amount=0.16, gain=1.0),
    'autumn': dict(tint=(0.10, 0.16, 0.05), amount=0.22, gain=0.98),
    'winter': dict(tint=(0.10, 0.15, 0.09), amount=0.30, gain=0.97, snow=0.62),
}


# --------------------------------------------------------------------------- #
# growth


def _rand_perp(rng, d):
    axis = Vector((rng.gauss(0, 1), rng.gauss(0, 1), rng.gauss(0, 1)))
    if axis.length < 1e-5:
        axis = Vector((0.0, 0.0, 1.0))
    p = d.cross(axis)
    if p.length < 1e-5:
        p = d.cross(Vector((1.0, 0.0, 0.0)))
    return p.normalized()


def cone_radius(species, z):
    """The crown's radius at height `z`, in metres.

    A spruce's crown is a cone that starts at the ground, a pine's a cone whose
    base sits at the bottom of a clear trunk; `whorl_pow` is how the two differ —
    a spruce tapers almost linearly, a pine keeps its width high up and then runs
    out into a flat top. Every whorl branch is as long as this radius at its own
    height, which is what makes the outline a cone rather than a barrel."""
    lo = species['crown_lo']
    (r_lo, r_hi) = species['crown']
    t = min(1.0, max(0.0, (z - lo) / max(1e-3, species['height'] * 0.995 - lo)))
    return r_hi + (r_lo - r_hi) * (1.0 - t) ** species.get('whorl_pow', 0.85)


class Tree:
    """A grown tree: tubes for the woody parts, quads for the leaves."""

    def __init__(self, species, seed, scale=1.0):
        self.species = species
        self.scale = scale          # trial-unit -> metre factor (see grow())
        self.rng = random.Random(seed)
        self.segs = []       # dict(pts, radii, order, level, parent, first, last)
        self.leaves = []     # dict(centre, dir, side, n, half_len, half_wid, uv, turn, bright, ao)

    # -- skeleton -----------------------------------------------------------

    def _reach(self, z):
        """The radius a branch may reach at height `z`, in this pass's units.

        A deciduous crown is a ball, so `crown_r` is a constant; a conifer's is a
        cone, and its profile has to be the envelope the whorls are grown into or
        the tree comes out as a barrel with a spike on top. A conifer's growth is
        already at the species' own height in *both* of `grow()`'s passes — its
        trunk is built to `height * scale` and its whorls to the cone — so `scale`
        comes out at 1 and a coordinate is a metre, which is why the cone profile
        needs no conversion here where `crown_r` does."""
        sp = self.species
        if sp['kind'] == 'conifer':
            return cone_radius(sp, z) * sp.get('envelope', 1.3)
        return sp['crown_r'] / self.scale

    def _walk(self, base, direction, length, radius, level, parent):
        cfg = self.species['levels'][level]
        rng = self.rng
        d = Vector(direction).normalized()
        steps = cfg['steps']
        step = length / steps
        floor_z = self.species.get('floor_m', 0.055 * self.species['height']) / self.scale
        pts = [tuple(base)]
        radii = [radius]
        cur = Vector(base)
        for _ in range(steps):
            # a crown has a radius: as a branch nears it, light competition turns
            # it upward instead of outward, which is what keeps a birch crown a
            # crown and not a set of straight spokes
            reach = self._reach(cur.z)
            r = max(1e-4, math.hypot(cur.x, cur.y))
            pull = min(1.0, max(0.0, (r / reach - 0.72) / 0.38))
            inward = Vector((-cur.x / r, -cur.y / r, 0.0))
            floor = 0.6 if cur.z < floor_z else 0.0
            d = (d + inward * (1.10 * pull)
                 + Vector((rng.gauss(0, cfg['curv']), rng.gauss(0, cfg['curv']),
                           cfg['grav'] * (step / max(0.05, length)) + 0.55 * pull + floor
                           + rng.gauss(0, cfg['curv'] * 0.5)))).normalized()
            # the elevation floor holds for the whole branch, not only at its
            # first step: a limb that starts ascending and wanders downwards
            # leaves a bare bar hanging under the crown
            if d.z < cfg['minz']:
                d = Vector((d.x, d.y, cfg['minz'])).normalized()
            cur = cur + d * step
            radius *= (1.0 - (1.0 - cfg['r']) / steps)
            pts.append(tuple(cur))
            radii.append(radius)
        idx = len(self.segs)
        self.segs.append(dict(pts=pts, radii=radii, order=level + 1, level=level,
                              parent=parent, first=idx, last=idx, idx=idx,
                              whorl=getattr(self, '_whorl', -1)))
        if level + 1 >= len(self.species['levels']):
            return idx
        n = rng.randint(*cfg['n'])
        kids = []
        for i in range(n):
            t = (i + rng.uniform(0.35, 0.95)) / max(1, n - 0.001)
            t = min(0.995, 0.30 + 0.70 * t)
            k = t * steps
            i0 = min(steps - 1, int(k))
            f = k - i0
            p = Vector(pts[i0]).lerp(Vector(pts[i0 + 1]), f)
            r = radius * (1.0 - i0 / max(1, steps)) * cfg['r']
            nd = (d + Vector((rng.gauss(0, 0.25), rng.gauss(0, 0.25), 0.0))).normalized()
            ang = math.radians(cfg['spread']) * rng.uniform(0.18, 1.0)
            cd = (Matrix.Rotation(ang, 3, _rand_perp(rng, nd)) @ nd).normalized()
            cd = (cd + Vector((0.0, 0.0, cfg['up'] * rng.uniform(0.5, 1.4)))).normalized()
            if cd.z < cfg['minz']:
                cd = Vector((cd.x, cd.y, cfg['minz'])).normalized()
            # a branch that has already reached the crown envelope is neither a
            # long one nor an outward one, or the crown loses its shape
            r0 = math.hypot(p.x, p.y)
            excess = min(1.0, max(0.0, (r0 / self._reach(p.z) - 0.72) / 0.28))
            if excess > 0.0:
                cd = (cd + Vector((-p.x, -p.y, 0.0)).normalized() * (1.1 * excess)
                      + Vector((0.0, 0.0, 0.45 * excess))).normalized()
            shorten = 1.0 - 0.62 * min(1.0, max(0.0, (r0 / self._reach(p.z) - 0.55) / 0.45) ** 1.5)
            kids.append(self._walk(p, cd, rng.uniform(*cfg['len']) * shorten * self.scale,
                                   max(0.0022, r), level + 1, idx))
        self.segs[idx]['last'] = max([idx] + kids)
        return idx

    def grow(self):
        """Build the skeleton in trial units.

        Everything that has a length is multiplied by `scale`, and the whole
        growth is linear in `scale`, so the caller measures one trial tree's
        height and grows the real one at `height / trial_height`. Scaling after
        the fact would inflate the crown sideways as well, which is exactly how
        the first oak came out ten metres wide."""
        if self.species['kind'] == 'conifer':
            return self.grow_conifer()
        sp = self.species
        sc = self.scale
        rng = self.rng
        th = sp['trunk_h'] * sc
        # radii are final metres, not trial units: the trial scale exists to put
        # the crown at the right height, and a tree scaled 2.5x also grew a trunk
        # 2.5x too fat (the first oak came out with a 0.9 m barrel)
        (r0, r1) = sp['trunk_r']
        lean = sp['lean']
        n = 5
        pts = [(0.0, 0.0, 0.0)]
        d = Vector((rng.gauss(0, lean), rng.gauss(0, lean), 1.0)).normalized()
        cur = Vector((0.0, 0.0, 0.0))
        for _ in range(n):
            d = (d + Vector((rng.gauss(0, lean * 0.6), rng.gauss(0, lean * 0.6), 0.0))).normalized()
            cur = cur + d * (th / n)
            pts.append(tuple(cur))
        radii = [r1 + (r0 - r1) * (1.0 - i / n) for i in range(n + 1)]
        self.segs.append(dict(pts=pts, radii=radii, order=0, level=-1, parent=None, first=0, last=None))
        # limbs leave the trunk along its upper half, so the crown grows out of a
        # length of trunk rather than out of a single point
        nl = rng.randint(*sp['levels'][0]['n'])
        for i in range(nl):
            a = (i / nl) * math.tau + rng.uniform(-0.5, 0.5)
            f = min(0.98, 0.38 + 0.62 * ((i + rng.uniform(0.0, 0.9)) / max(1, nl)))
            k = f * n
            i0 = min(n - 1, int(k))
            base = Vector(pts[i0]).lerp(Vector(pts[i0 + 1]), k - i0)
            rad = radii[i0] * sp['levels'][0]['r']
            up = sp['levels'][0]['up']
            cd = Vector((math.cos(a) * (1.0 - 0.30 * up), math.sin(a) * (1.0 - 0.30 * up), up)).normalized()
            cd = (Matrix.Rotation(math.radians(rng.uniform(0, 24)), 3, _rand_perp(rng, cd)) @ cd).normalized()
            self._walk(base, cd, rng.uniform(*sp['levels'][0]['len']) * sc, max(0.004, rad), 0, 0)
        return self

    def top(self):
        return max(p[2] for s in self.segs for p in s['pts'])

    # -- leaves -------------------------------------------------------------

    def seg_len(self, seg):
        return sum(math.dist(seg['pts'][i], seg['pts'][i + 1]) for i in range(len(seg['pts']) - 1))

    def _polyline(self, seg, t):
        pts = seg['pts']
        lengths = [0.0]
        for i in range(1, len(pts)):
            lengths.append(lengths[-1] + math.dist(pts[i - 1], pts[i]))
        target = t * (lengths[-1] or 1.0)
        i = 0
        while i < len(lengths) - 2 and lengths[i + 1] < target:
            i += 1
        span = max(1e-6, lengths[i + 1] - lengths[i])
        f = (target - lengths[i]) / span
        p = Vector(pts[i]).lerp(Vector(pts[i + 1]), f)
        d = (Vector(pts[min(i + 1, len(pts) - 1)]) - Vector(pts[i])).normalized()
        return p, d

    def leaf_out(self):
        sp = self.species
        rng = self.rng
        last = len(sp['levels']) - 1        # level of the terminal twigs
        hosts = [s for s in self.segs if s['level'] >= last - 3]
        if not hosts:
            return self
        # a real crown carries most of its leaf area in a shell near the light,
        # not in a ball around the trunk, so favour the twigs that got out there
        reach = sp['crown_r']
        share = {last: 1.0, last - 1: 0.45, last - 2: 0.24, last - 3: 0.30}
        weights = [max(1e-4, self.seg_len(s) * share.get(s['level'], 0.2)
                        * (0.35 + 0.65 * min(1.0, math.hypot(s['pts'][-1][0], s['pts'][-1][1]) / reach)))
                   for s in hosts]
        total = sum(weights)
        budget = sp['leaves']
        (ll, lw) = sp['leaf']
        for seg, w in zip(hosts, weights):
            count = int(round(budget * w / total))
            for _ in range(count):
                # uniform along the host: biasing toward the tip leaves the
                # inner half of a limb bare, and a bare limb is a brown bar
                t = rng.random()
                p, d = self._polyline(seg, t)
                perp = _rand_perp(rng, d)
                # leaves sit on short petioles around the twig; the spray of
                # directions is what gives a twig volume instead of a line
                dir_v = (perp * rng.uniform(0.55, 1.0) + d * rng.uniform(-0.35, 0.45)
                         + Vector((0.0, 0.0, -0.32 if sp['thin'] else -0.10))).normalized()
                # a leaf spray occupies a volume, not a shell around the twig:
                # without this the crown is a set of beaded strings with the
                # voids between twigs showing, and adding leaves stops helping
                # because they all land on top of each other
                j = ll * 1.15
                centre = p + dir_v * (ll * 0.5) + Vector((rng.gauss(0, j * 0.42),
                                                          rng.gauss(0, j * 0.42),
                                                          rng.gauss(0, j * 0.42)))
                blade_n = ( _rand_perp(rng, dir_v)
                           + Vector((rng.gauss(0, 0.25), rng.gauss(0, 0.25), rng.gauss(0.05, 0.35)))).normalized()
                side = dir_v.cross(blade_n).normalized()
                ln = ll * rng.uniform(0.78, 1.22)
                wd = lw * rng.uniform(0.82, 1.18)
                # autumn: about a quarter of the leaves hang on green, the rest turn
                turn = rng.uniform(0.0, 0.34) if rng.random() < 0.25 else rng.uniform(0.72, 1.0)
                self.leaves.append(dict(centre=centre, dir=dir_v, side=side, n=blade_n,
                                        half_len=ln * 0.5, half_wid=wd * 0.5,
                                        uv=LEAF_RECTS[rng.randrange(2)], turn=turn,
                                        bright=rng.random()))
        return self

    def shade_leaves(self):
        """Per-leaf ambient occlusion from the leaf cloud itself.

        A ray-traced bake would double-light against the game's Lambert pass, so
        the bake only has to produce the part Lambert cannot know: how boxed-in a
        leaf is. A leaf at the crown surface has leaves on one side only, one
        inside the crown has them on all sides, and that difference is what makes
        the sprite read as a solid crown with a dark interior."""
        if not self.leaves:
            return self
        cell = 0.42
        R = 0.45
        grid = {}
        for i, lf in enumerate(self.leaves):
            c = lf['centre']
            key = (int(math.floor(c.x / cell)), int(math.floor(c.y / cell)), int(math.floor(c.z / cell)))
            grid.setdefault(key, []).append(i)
        w = [0.0] * len(self.leaves)
        for key, idxs in grid.items():
            near = []
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    for dz in (-1, 0, 1):
                        near.extend(grid.get((key[0] + dx, key[1] + dy, key[2] + dz), ()))
            for i in idxs:
                c = self.leaves[i]['centre']
                acc = 0.0
                for j in near:
                    if j == i:
                        continue
                    d = (self.leaves[j]['centre'] - c).length
                    if d < R:
                        acc += 1.0 - d / R
                w[i] = acc
        order = sorted(w)
        # the typical leaf is half boxed in by the crown around it; scaling by
        # twice the median puts a crown-surface leaf near occ 0.35 and a buried
        # one near 1.0, which is the range the sprite needs
        ref = max(1e-3, 2.0 * order[len(order) // 2])
        for i, lf in enumerate(self.leaves):
            occ = min(1.0, w[i] / ref)
            ao = min(1.0, max(0.32, 1.06 - 0.62 * occ))
            # a leaf that faces the sky keeps a little more than one hanging
            # under the crown
            ao *= 0.94 + 0.06 * max(0.0, lf['n'].z)
            lf['ao'] = min(1.0, ao)
        return self

    # -- conifers -----------------------------------------------------------

    def grow_conifer(self):
        """Trunk, regular whorls, and (for a pine) the dead stubs of its clear
        lower trunk.

        The habit is not a scaled deciduous one and it is not a scan either: the
        whorl branches are grown by the same recursion a deciduous limb uses, one
        order at a time, and each is as long as the crown's own radius at that
        height. So the sprite, the top-down star and the model are all the same
        tree, which is the one property the scan-slicing path could never have —
        an object cut out of a fir and a model grown as a cone were two different
        trees handed over at the same distance."""
        sp = self.species
        sc = self.scale
        rng = self.rng
        h = sp['height'] * sc
        (r0, r1) = sp['trunk_r']
        lean = sp['lean']
        n = 6
        pts = [(0.0, 0.0, 0.0)]
        d = Vector((rng.gauss(0, lean), rng.gauss(0, lean), 1.0)).normalized()
        cur = Vector((0.0, 0.0, 0.0))
        for _ in range(n):
            d = (d + Vector((rng.gauss(0, lean * 0.5), rng.gauss(0, lean * 0.5), 0.0))).normalized()
            cur = cur + d * (h / n)
            pts.append(tuple(cur))
        # a conifer holds its diameter most of the way up and then runs out into
        # the leader: the opposite of the deciduous trunk's steady taper
        radii = [r1 + (r0 - r1) * (1.0 - (i / n) ** 1.9) for i in range(n + 1)]
        self.segs.append(dict(pts=pts, radii=radii, order=0, level=-1, parent=None,
                              first=0, last=None, idx=0, whorl=-1))

        def axis_at(z):
            t = min(1.0, max(0.0, z / max(1e-6, h))) * n
            i = min(n - 1, int(t))
            f = t - i
            p = Vector(pts[i]).lerp(Vector(pts[i + 1]), f)
            return p, radii[i] * (1.0 - f) + radii[i + 1] * f

        lo = sp['crown_lo'] * sc
        hi = sp['whorl_hi'] * sc
        whorls = sp['whorls']
        (n_lo, n_hi) = sp['branch_n']
        (p_lo, p_hi) = sp['branch_pitch']
        step = (hi - lo) / max(1, whorls - 1)
        for k in range(whorls):
            t = k / max(1, whorls - 1)
            z = min(h * 0.995, max(0.0, lo + (hi - lo) * t + rng.gauss(0, 0.05 * step)))
            self._whorl = k
            base, tr = axis_at(z)
            reach = cone_radius(sp, z / sc) * sc
            pitch = min(0.85, max(-0.55, p_lo + (p_hi - p_lo) * (t ** 0.8) + rng.gauss(0, 0.05)))
            cp = math.sqrt(max(0.04, 1.0 - pitch * pitch))
            nb = max(2, int(round(n_lo + (n_hi - n_lo) * (t ** 0.85) + rng.gauss(0, 0.45))))
            az0 = rng.uniform(0.0, math.tau)
            for b in range(nb):
                a = az0 + math.tau * b / nb + rng.gauss(0, 0.09)
                cd = Vector((math.cos(a) * cp, math.sin(a) * cp, pitch)).normalized()
                # the branch is as long as the cone is wide there: the outline is
                # the profile, not the envelope pull at the end of a long shoot
                self._walk(base, cd, reach * rng.uniform(0.88, 1.02),
                           max(0.006, tr * sp['levels'][0]['r']), 0, 0)
        if sp.get('stubs'):
            st = sp['stubs']
            for i in range(st['count']):
                z = st['lo'] + (st['hi'] - st['lo']) * (i + rng.uniform(0.2, 0.8)) / st['count']
                base, tr = axis_at(z * sc)
                a = rng.uniform(0.0, math.tau)
                pitch = rng.uniform(-0.6, -0.05)
                cp = math.sqrt(max(0.0, 1.0 - pitch * pitch))
                cd = Vector((math.cos(a) * cp, math.sin(a) * cp, pitch)).normalized()
                idx = len(self.segs)
                ln = rng.uniform(*st['len']) * sc
                self.segs.append(dict(
                    pts=[tuple(base), tuple(base + cd * ln * 0.5), tuple(base + cd * ln)],
                    radii=[tr * 0.50, tr * 0.34, tr * 0.18], order=1, level=0, parent=0,
                    first=idx, last=idx, idx=idx, whorl=-2, dead=True))
        self._whorl = -1
        return self

    def sprig_out(self):
        """A drawn needle shoot on its own card along every shoot of the tree.

        The conifer's `leaf_out`. A deciduous leaf card points *away* from its
        twig — a petiole and a blade; a needle card lies *along* the shoot,
        because what it carries is a drawing of a shoot: a twig with needles raked
        off both sides (see needle_sheet). The roll around the twig is random, so
        the shoots fill a volume rather than a plane, which is what the impostor's
        sixteen views need, and the card's tip end is a little brighter than its
        base, so a card is never one flat colour.

        The number of cards is per metre of shoot, not per branch: a whorl branch
        near the top is 30 cm long and gets three cards, the widest one is 3 m and
        gets forty, and the density therefore comes out even over the cone."""
        sp = self.species
        cfg = sp['sprig']
        rng = self.rng
        (l0, l1) = cfg['len']
        (w0, w1) = cfg['wid']
        weights = cfg['level']
        (t0, t1) = cfg['t_range']
        up = cfg.get('up', 0.2)
        hosts = [s for s in self.segs
                 if 0 <= s['level'] < len(weights) and weights[s['level']] > 0.0
                 and not s.get('dead')]
        if not hosts:
            return self
        for seg in hosts:
            ln = self.seg_len(seg)
            count = int(round(ln * cfg['per_m'] * weights[seg['level']] * rng.uniform(0.85, 1.15)))
            for _ in range(count):
                t = rng.uniform(t0, t1)
                p, d = self._polyline(seg, t)
                # the card's long axis is the shoot, its short axis the fan of
                # needles around it, and the roll is what gives the shoot volume
                side = _rand_perp(rng, d)
                side = (side + Vector((0.0, 0.0, up))).normalized()
                nrm = d.cross(side).normalized()
                half_len = rng.uniform(l0, l1) * 0.5 * rng.uniform(0.90, 1.10)
                half_wid = rng.uniform(w0, w1) * 0.5 * rng.uniform(0.86, 1.14)
                jitter = half_wid * 0.16
                centre = p + side * rng.gauss(0.0, jitter) + nrm * rng.gauss(0.0, jitter)
                self.leaves.append(dict(
                    centre=centre, dir=d, side=side, n=nrm, half_len=half_len,
                    half_wid=half_wid, uv=SPRIG_RECTS[rng.randrange(len(SPRIG_RECTS))],
                    turn=rng.uniform(0.0, 0.34) if rng.random() < 0.4 else rng.uniform(0.62, 1.0),
                    bright=rng.random(), seg=seg['idx']))
        return self

    def shade_sprigs(self):
        """The deciduous bake plus what a cone knows that a ball does not.

        The per-card occlusion of `shade_leaves` is how boxed-in a shoot is; a
        conifer needs two more terms on top of it, and both are the ones the eye
        reads as a conifer: the needle mass is lit at its surface and dark toward
        the trunk axis, and the tiers below are shaded by the tiers above them.
        Both are per card, in the same `Col` channel the game multiplies into the
        albedo, so the sprite and the model are shaded the same way."""
        self.shade_leaves()
        sp = self.species
        lo = sp['crown_lo']
        hi = max(0.5, sp['height'] - lo)
        for lf in self.leaves:
            c = lf['centre']
            r = math.hypot(c.x, c.y)
            rr = min(1.0, r / max(0.25, cone_radius(sp, c.z)))
            radial = 0.58 + 0.42 * (rr ** 0.75)
            tier = 0.78 + 0.22 * min(1.0, max(0.0, (c.z - lo) / hi))
            lf['ao'] = min(1.0, max(0.15, lf['ao'] * radial * tier))
            # how much snow this card can hold: a shoot whose own face looks up,
            # and higher up the crown — that is where snow lies on a conifer, and
            # it is baked per card because winter is the one season the material
            # cannot decide from the drawing alone
            lf['snow'] = min(1.0, max(0.0, lf['n'].z * 1.6)) * (0.40 + 0.60 * min(1.0, max(0.0, (c.z - lo) / hi)))
        return self


def grow(species, seed):
    """A tree exactly `species['height']` metres tall."""
    trial = Tree(species, seed, 1.0).grow()
    k = species['height'] / max(1e-6, trial.top())
    tree = Tree(species, seed, k).grow()
    # the growth is not exactly linear in the trial scale (the crown envelope and
    # the ground clearance are absolute lengths), so trim the few per cent left
    fix = species['height'] / max(1e-6, tree.top())
    for s in tree.segs:
        s['pts'] = [(p[0] * fix, p[1] * fix, p[2] * fix) for p in s['pts']]
        s['radii'] = [r * fix for r in s['radii']]
    if species['kind'] == 'conifer':
        return tree.sprig_out().shade_sprigs()
    return tree.leaf_out().shade_leaves()


# --------------------------------------------------------------------------- #
# meshes


def mesh_object(name, verts, faces, uvs, cols, uvs2, mats, slots):
    """One mesh with `mats` in its slots and `slots[i]` the slot of face i. Three
    vertex attributes carry the bake: `Col` (R = the leaf's autumn turn, G = its
    brightness, B = its occlusion) and `LeafUV` (the leaf's own 0..1 space)."""
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([tuple(v) for v in verts], [], [list(f) for f in faces])
    mesh.validate()
    layer = mesh.uv_layers.new(name='UVMap')
    for poly in mesh.polygons:
        for li in poly.loop_indices:
            layer.data[li].uv = uvs[mesh.loops[li].vertex_index]
    if uvs2 is not None:
        layer2 = mesh.uv_layers.new(name='LeafUV')
        for poly in mesh.polygons:
            for li in poly.loop_indices:
                layer2.data[li].uv = uvs2[mesh.loops[li].vertex_index]
    attr = mesh.color_attributes.new(name='Col', type='FLOAT_COLOR', domain='POINT')
    for i, c in enumerate(cols):
        attr.data[i].color = (c[0], c[1], c[2], 1.0)
    for m in mats:
        mesh.materials.append(m)
    for poly, slot in zip(mesh.polygons, slots):
        poly.material_index = slot
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return obj


def _leaf_quad(lf):
    c = lf['centre']
    a = lf['dir'] * lf['half_len']
    s = lf['side'] * lf['half_wid']
    v = [tuple(c - a - s), tuple(c - a + s), tuple(c + a + s), tuple(c + a - s)]
    u0, v0, u1, v1 = lf['uv']
    return v, [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]


def _bark_ao(z, species):
    """The open trunk is lit; everything inside the crown is not, and the root
    collar is dark.

    A bark strip tiles, so it cannot know where the ground is: "darker toward the
    base" has to be baked where the trunk's own height is known, which is the wood
    of the model and of the sprite — this function. The base term is why a birch
    reads as a birch: white a metre up, near-black and rough where it meets the
    ground."""
    lo = species['trunk_h'] * 0.25
    # the ramp is steep on purpose: a branch a third of the way up the crown is
    # already deep in shade, not half lit. A gentle ramp left the limbs reading
    # as bright bars through the leaves in the first renders.
    span = max(0.4, species['height'] * 0.30)
    t = min(1.0, max(0.0, (z - lo) / span))
    ao = 1.0 - 0.82 * min(1.0, t * 1.5)
    base = 0.40 + 0.60 * min(1.0, max(0.0, z / (0.06 * species['height'])))
    return ao * base


def wood_parts(segs, species, *, max_level=99, trims=None):
    """Tubes for the woody skeleton. Five or six sides on the trunk, four on a
    limb, three on a twig, which is what keeps a full 200-twig skeleton small."""
    verts, faces, uvs, cols, slots = [], [], [], [], []
    for seg in segs:
        if seg['level'] > max_level:
            continue
        if seg['level'] < 0:
            s = species.get('sides', 5)
        elif seg['level'] == 0:
            s = 5
        elif seg['level'] == 1:
            s = 4
        else:
            s = 3
        pts, radii = seg['pts'], seg['radii']
        frac = (trims or {}).get(seg['level'])
        if frac is not None:
            lengths = [0.0]
            for i in range(1, len(pts)):
                lengths.append(lengths[-1] + math.dist(pts[i - 1], pts[i]))
            total = lengths[-1] or 1.0
            keep = 1
            while keep < len(pts) - 1 and lengths[keep] < frac * total:
                keep += 1
            pts, radii = pts[:keep + 1], radii[:keep + 1]
        ln = sum(math.dist(pts[i], pts[i + 1]) for i in range(len(pts) - 1))
        v, f, u = L.taper_tube(pts, radii, sides=s,
                               uv_u_scale=ln / BARK_M[0], v_span=(0.0, 1.0))
        off = len(verts)
        verts.extend(v)
        uvs.extend(u)
        faces.extend([[i + off for i in fc] for fc in f])
        slots.extend([0] * len(f))
        # per vertex, not per segment: a limb starts at the dark base of the
        # crown and ends up in full shade, and shading the whole limb by its
        # first point left it a bright bar across the leaves
        cols.extend([(1.0, 1.0, _bark_ao(p[2], species)) for p in v])
    return verts, faces, uvs, cols, slots


def build_leafy(name, species, seed, mats):
    """The full-detail tree: the woody skeleton plus every leaf as its own quad."""
    tree = grow(species, seed)
    verts, faces, uvs, cols, slots = wood_parts(tree.segs, species, max_level=1,
                                                trims={0: 0.92, 1: 0.80})
    uvs2 = [(0.5, 0.5)] * len(verts)
    n_wood = len(verts)
    for lf in tree.leaves:
        lv, luv = _leaf_quad(lf)
        base = len(verts)
        verts.extend(lv)
        uvs.extend(luv)
        uvs2.extend([(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)])
        cols.extend([(lf['turn'], lf['bright'], lf['ao'])] * 4)
        faces.append([base, base + 1, base + 2, base + 3])
        slots.append(1)
    if len(mats) == 1:
        slots = [0] * len(faces)
    obj = mesh_object(name, verts, faces, uvs, cols, uvs2, mats, slots)
    return obj, tree, n_wood


# --------------------------------------------------------------------------- #
# materials


def attr_ao(tree, name='Col'):
    """The occlusion channel of the bake, used as a plain multiplier.

    The values already sit in the range the bake wants (0.22-1.0 for a leaf, and
    down to 0.26 for a branch inside a crown), so this must not compress them
    again: a floor here is what kept the birch's limbs bright white through the
    leaves."""
    n = tree.nodes.new('ShaderNodeAttribute')
    n.attribute_name = name
    # the fallback matters: the bark-strip cylinder carries no `Col`, and without
    # it the attribute reads as black and the whole strip renders black
    n.outputs['Color'].default_value = (1.0, 1.0, 1.0, 1.0)
    sep = tree.nodes.new('ShaderNodeSeparateXYZ')
    tree.links.new(n.outputs['Color'], sep.inputs[0])
    return L.clamp01(L.Num(tree, sep.outputs['Z']))


def attr_rgb(tree, name='Col'):
    n = tree.nodes.new('ShaderNodeAttribute')
    n.attribute_name = name
    sep = tree.nodes.new('ShaderNodeSeparateXYZ')
    tree.links.new(n.outputs['Color'], sep.inputs[0])
    return {k: L.Num(tree, sep.outputs[k]) for k in ('X', 'Y', 'Z')}


def _hash01(tree, x, y):
    """A per-cell pseudo-random 0..1 from two cell coordinates. A modulo alone
    drew stripes right across the trunk; hashing the cell gives every mark its own
    place."""
    return (L.math_node(tree, 'MULTIPLY',
                        L.math_node(tree, 'SINE', x * 12.9898 + y * 78.233), 43758.5453) % 1.0)


def _bark_uv(tree, species):
    """The strip's own uv in **metres**: u along the trunk (bark_m[0] per repeat)
    and v around it (bark_m[1] per wrap).

    The pattern is written in uv, not in object space, because the strip render
    and the trunk of the tree model are different objects with different axes: in
    the strip x is along the trunk and z is around it, on the tree z is height.
    uv is the one frame both share, so one pattern lands on both unchanged. A
    spruce's strip repeats every 2 m; a pine's is the whole trunk, so its u is a
    height and the two-tone of the species falls out of the pattern itself."""
    (bu, bv) = species['bark_m']
    uv = tree.nodes.new('ShaderNodeUVMap')
    uv.uv_map = 'UVMap'
    sep = tree.nodes.new('ShaderNodeSeparateXYZ')
    tree.links.new(uv.outputs['UV'], sep.inputs[0])
    u = L.Num(tree, sep.outputs['X']) * bu
    v = L.Num(tree, sep.outputs['Y']) * bv
    return u, v


def _bark_marks(tree, u, v, *, pitch_u, pitch_v, cut, thin, long, soft=6.0):
    """Short marks on a hashed (along, around) grid of the trunk: `thin` metres
    across the trunk axis and `long` metres along the circumference.

    That is what a lenticel is — a dash lying round the trunk, a millimetre or two
    thick — and it is also the shape of an aspen's leaf scar when the two extents
    match. The grid wraps in v, because the strip is one wrap of the trunk and has
    to join itself."""
    fu = (u / pitch_u) % 1.0
    iu = u / pitch_u - fu
    fv = (v / pitch_v) % 1.0
    iv = v / pitch_v - fv
    h = _hash01(tree, iu, iv)
    hx = _hash01(tree, iu + 7.31, iv - 3.17)
    hy = _hash01(tree, iu - 2.77, iv + 5.53)
    on = L.clamp01((h - cut) * 3.0 / max(1e-3, 1.0 - cut))
    du = (fu - 0.5 - (hx - 0.5) * 0.55) / max(1e-4, thin / pitch_u)
    dv = (fv - 0.5 - (hy - 0.5) * 0.55) / max(1e-4, long / pitch_v)
    shape = L.clamp01((L.const(tree, 1.0) - (du * du + dv * dv)) * soft)
    return L.clamp01(on * shape * 1.6)


def birch_bark(tree, emit, tex, species):
    """Birch bark: a cream sheet with grey flaking patches, black lenticels and
    the odd dark scab.

    There is no CC0 birch bark photograph on either provider (ambientCG has no
    birch at all; Poly Haven's `bark_platanus` is a plane tree), so the colour of
    birch comes from here and the *pattern* comes from an ambientCG scan of a pale
    flaking bark: its luminance carries the flakes and the grey patches, and every
    lenticel is synthesised on top. BARK011 is the pale flaking one — the grey-green
    BARK009 reads as aspen, which is where it has moved."""
    u, v = _bark_uv(tree, species)
    lum = L.Vec(tree, tex.outputs['Color']).dot(L.vec_const(tree, 0.2126, 0.7152, 0.0722))
    cream = L.vec_const(tree, 0.905, 0.888, 0.850)
    grey = L.vec_const(tree, 0.575, 0.560, 0.540)
    # the scan's own luminance carries the flaking: a birch is cream, but it is a
    # *mottled* cream, and a flat white sheet reads as painted
    col = L.mix_vec(cream, grey, L.clamp01((lum - 0.15) * 1.35))
    # dark scabs: 2-4 per wrap of the trunk, 20-40 cm across, the rough grey-brown
    # patches old birch bark peels around
    scab = _bark_marks(tree, u, v, pitch_u=0.55, pitch_v=BARK_M[1] / 3.0, cut=0.72, thin=0.20, long=0.110,
                       soft=5.0)
    col = L.mix_vec(col, L.vec_const(tree, 0.285, 0.265, 0.240), L.clamp01(scab * 1.1))
    # lenticels: ~250 per square metre of strip, 2-5 cm round the trunk and 2-4 mm
    # thick, which at the strip's 512 px/m is a 10-25 px dash one or two pixels thick
    lent = _bark_marks(tree, u, v, pitch_u=0.045, pitch_v=BARK_M[1] / 14.0, cut=0.22, thin=0.0032,
                       long=0.031, soft=1.4)
    col = L.mix_vec(col, L.vec_const(tree, 0.018, 0.017, 0.016), L.clamp01(lent * 1.15))
    tree.links.new(col.scale(attr_ao(tree)).socket, emit.inputs['Color'])


def aspen_bark(tree, emit, tex, species):
    """Aspen: smooth grey-green with sparse dark diamond leaf scars. The photo
    sheet (the grey-green BARK009) is the colour; the diamonds sit on their own
    wider grid than a birch lenticel, because that is the only mark an aspen
    trunk carries."""
    u, v = _bark_uv(tree, species)
    lum = L.Vec(tree, tex.outputs['Color']).dot(L.vec_const(tree, 0.2126, 0.7152, 0.0722))
    col = L.mix_vec(L.vec_const(tree, 0.615, 0.640, 0.545), L.vec_const(tree, 0.455, 0.480, 0.410),
                    L.clamp01(lum * 1.8))
    mark = _bark_marks(tree, u, v, pitch_u=0.11, pitch_v=0.09, cut=0.62, thin=0.011, long=0.013, soft=2.2)
    col = L.mix_vec(col, L.vec_const(tree, 0.105, 0.100, 0.085), L.clamp01(mark * 1.2))
    tree.links.new(col.scale(attr_ao(tree)).socket, emit.inputs['Color'])


def spruce_bark(tree, emit, tex, species):
    """Spruce: thin grey-brown scales in a fine mosaic, lit by a trace of lichen.

    The scan is a grey-green scaled bark, so its own colour carries the structure —
    the plates, the light and the grey-green lichen — and the pattern here only
    pulls it toward the grey-brown a spruce's trunk actually is and adds the dark
    cracks between the plates. The first cut of this wrote the mosaic *itself*
    with marks on a hashed grid and came out as a rash of dark blobs: a mark
    function is for a mark, a bark is a photograph."""
    u, v = _bark_uv(tree, species)
    photo = L.Vec(tree, tex.outputs['Color'])
    lum = photo.dot(L.vec_const(tree, 0.2126, 0.7152, 0.0722))
    col = L.mix_vec(photo, L.vec_const(tree, 0.130, 0.108, 0.085), 0.34)
    col = col.scale(0.50 + 0.80 * lum)
    # the cracks between the plates: sparse, thin, dark — a spruce's bark is a
    # mosaic of small plates and the cracks are the only lines in it
    crack = _bark_marks(tree, u, v, pitch_u=0.19, pitch_v=0.062, cut=0.84,
                        thin=0.009, long=0.026, soft=2.2)
    col = L.mix_vec(col, L.vec_const(tree, 0.032, 0.026, 0.020), L.clamp01(crack * 1.3))
    lich = _bark_marks(tree, u, v, pitch_u=0.42, pitch_v=0.21, cut=0.93, thin=0.16, long=0.10, soft=2.6)
    col = L.mix_vec(col, L.vec_const(tree, 0.150, 0.175, 0.120), L.clamp01(lich * 3.0))
    tree.links.new(col.scale(attr_ao(tree)).socket, emit.inputs['Color'])


def pine_bark(tree, emit, tex, species):
    """Scots pine: grey-brown furrowed bark on the lower trunk, orange-red flaky
    plates above, and the change between them is a *height*.

    That is only possible because the pine's cell is the whole trunk in one sheet
    (11.6 m of u) instead of a repeating 2 m patch: a tile cannot have an upper and
    a lower half, and the two bark zones are the most recognisable thing about the
    tree. The scan is a grey bark with orange patches on it, so the lower zone is
    that colour pulled dark and grey and the upper is it pushed to the orange-red,
    with deep vertical furrows through both and warm flakes above the crossover —
    which is exactly the shape of a pine's bark: long plates, cracked vertically."""
    u, v = _bark_uv(tree, species)
    photo = L.Vec(tree, tex.outputs['Color'])
    lum = photo.dot(L.vec_const(tree, 0.2126, 0.7152, 0.0722))
    (bu, _bv) = species['bark_m']
    t = L.clamp01((u - 0.22 * bu) / (0.15 * bu))
    grey = L.mix_vec(photo, L.vec_const(tree, 0.070, 0.058, 0.045), 0.42)
    grey = grey.scale(0.52 + 0.85 * lum)
    warm = L.mix_vec(photo, L.vec_const(tree, 0.300, 0.115, 0.035), 0.60)
    warm = warm.scale(0.55 + 0.85 * lum)
    orange = L.mix_vec(warm, L.vec_const(tree, 0.520, 0.150, 0.038), 0.42)
    col = L.mix_vec(grey, orange, t)
    # a pine's bark is cracked into long vertical plates: the furrows run along the
    # trunk, so they are long in u and thin in v
    furrow = _bark_marks(tree, u, v, pitch_u=0.40, pitch_v=0.085, cut=0.72,
                         thin=0.30, long=0.024, soft=1.3)
    col = L.mix_vec(col, L.vec_const(tree, 0.030, 0.024, 0.018), L.clamp01(furrow * 1.3))
    flake = _bark_marks(tree, u, v, pitch_u=0.24, pitch_v=0.070, cut=0.78,
                        thin=0.12, long=0.052, soft=1.5)
    col = L.mix_vec(col, L.vec_const(tree, 0.620, 0.265, 0.075), L.clamp01(flake * t * 1.2))
    tree.links.new(col.scale(attr_ao(tree)).socket, emit.inputs['Color'])


def _bark_photo_uv(tree, image, species):
    """The photograph's own world scale.

    A bark sheet is a 2 x 0.5 m patch. A spruce's strip repeats every 2 m, so it
    samples the sheet once per repeat; a pine's strip is 11.6 m of trunk in one
    cell, so it has to sample the sheet just under six times along the trunk or
    the flakes would be stretched with the cell itself."""
    (bu, bv) = species['bark_m']
    if abs(bu - BARK_M[0]) < 1e-6 and abs(bv - BARK_M[1]) < 1e-6:
        return
    uv = tree.nodes.new('ShaderNodeUVMap')
    uv.uv_map = 'UVMap'
    mul = tree.nodes.new('ShaderNodeVectorMath')
    mul.operation = 'MULTIPLY'
    mul.inputs[1].default_value = (bu / BARK_M[0], bv / BARK_M[1], 1.0)
    tree.links.new(uv.outputs['UV'], mul.inputs[0])
    tree.links.new(mul.outputs['Vector'], image.inputs['Vector'])


def bark_material(species):
    tex = os.path.join(CACHE, 'bark', f'{species["bark"]}.jpg')
    if not os.path.exists(tex):
        raise RuntimeError(f'missing {tex} — run node tools/look/build.mjs')
    mat = L.cutout_emission(f'bark_{species["name"]}', tex)
    tree = mat.node_tree
    emit = [n for n in tree.nodes if n.type == 'EMISSION'][0]
    image = [n for n in tree.nodes if n.type == 'TEX_IMAGE'][0]
    _bark_photo_uv(tree, image, species)
    style = species.get('bark_style')
    if style == 'spruce':
        spruce_bark(tree, emit, image, species)
    elif style == 'pine':
        pine_bark(tree, emit, image, species)
    elif species['name'] == 'birch':
        birch_bark(tree, emit, image, species)
    elif species['name'] == 'aspen':
        aspen_bark(tree, emit, image, species)
    else:
        src = emit.inputs['Color'].links[0].from_socket
        tree.links.new(L.Vec(tree, src).scale(attr_ao(tree)).socket, emit.inputs['Color'])
    return mat


def _leaf_shape(tree, species):
    """Narrow the photographed leaf (a serrated birch-type blade) toward the
    species silhouette by multiplying the cutout with an analytic profile read in
    the leaf's own 0..1 space."""
    shape = species.get('leaf_shape', 'birch')
    if shape == 'birch':
        return
    mix = [n for n in tree.nodes if n.type == 'MIX_SHADER'][0]
    fac = mix.inputs['Fac'].links[0].from_socket
    uv = tree.nodes.new('ShaderNodeUVMap')
    uv.uv_map = 'LeafUV'
    sep = tree.nodes.new('ShaderNodeSeparateXYZ')
    tree.links.new(uv.outputs['UV'], sep.inputs[0])
    u = L.Num(tree, sep.outputs['X'])
    v = L.Num(tree, sep.outputs['Y'])
    one_minus_v = L.const(tree, 1.0) - v
    if shape == 'oak':
        s = tree.nodes.new('ShaderNodeMath')
        s.operation = 'SINE'
        tree.links.new((v * 3.6 * 6.2831853).socket, s.inputs[0])
        lobe = L.Num(tree, s.outputs[0]) * 0.20 + 0.34
        half = lobe * (v * 3.1).min(1.0).max(0.0).sqrt() * one_minus_v.max(0.0).sqrt() * 1.35
    elif shape == 'lime':
        half = (L.const(tree, 1.05) - v * 0.80).max(0.0) * (v * 3.6).min(1.0).max(0.0).sqrt() \
            * one_minus_v.max(0.0).sqrt() * 0.60
    else:  # aspen: rounder and wider
        half = (v * 3.2).min(1.0).max(0.0).sqrt() * one_minus_v.max(0.0).sqrt() * 0.78 + 0.04
    inside = (u - 0.5).abs().less(half)
    tree.links.new(L.math_node(tree, 'MULTIPLY', fac, inside).socket, mix.inputs['Fac'])


def leaf_material(species, season):
    """Photo leaf, per-species silhouette, season grade, per-leaf variation and
    the baked per-leaf occlusion (see Tree.shade_leaves)."""
    if not os.path.exists(LEAF_FILE):
        raise RuntimeError(f'missing {LEAF_FILE} — run node tools/look/build.mjs')
    mat = L.cutout_emission(f'leaf_{species["name"]}_{season}', LEAF_FILE,
                            opacity_path=LEAF_ALPHA, threshold=0.45)
    tree = mat.node_tree
    emit = [n for n in tree.nodes if n.type == 'EMISSION'][0]
    tex = [n for n in tree.nodes if n.type == 'TEX_IMAGE'][0]
    var = attr_rgb(tree)
    g = dict(LEAF_GRADES[season])
    if season == 'autumn':
        g['tint'] = species['autumn']
    elif season == 'summer':
        g['tint'] = species.get('summer', g['tint'])
    amount = L.clamp01(g['bias'] + (1.0 - g['bias']) * var['X']) * g['amount']
    col = L.mix_vec(L.Vec(tree, tex.outputs['Color']), L.vec_const(tree, *g['tint']), amount)
    lo, hi = g['bright']
    col = col.scale(L.const(tree, g['gain']) * (lo + (hi - lo) * var['Y']))
    col = col.scale(attr_ao(tree))
    _leaf_shape(tree, species)
    tree.links.new(col.socket, emit.inputs['Color'])
    return mat


def crown_normal_material(kind, *, yaw=0.0, axis=(0.0, 0.0), world=False, height=12.0):
    """Analytic crown normal in the viewer's tangent space.

    Deciduous: capsule `normalize(p - (0, 0, clamp(z, 1.0, 5.5)))`. Conifer: a cone
    whose surface tilts further up toward the top of the tree — a fan near the
    leader is nearly horizontal and one at the skirt is not, and the impostor has
    to carry that or a cone shades like a barrel. `yaw` rotates the normal about
    the trunk axis, which is how the impostor row bakes one material per view; the
    position is read in OBJECT space (or world, for a row of copies) so the
    rotation of a copy never leaks in twice."""
    c, s = math.cos(yaw), math.sin(yaw)
    mat = bpy.data.materials.new(f'crown_normal_{kind}_{yaw:.4f}')
    mat.use_nodes = True
    tree = mat.node_tree
    for n in list(tree.nodes):
        tree.nodes.remove(n)
    out = tree.nodes.new('ShaderNodeOutputMaterial')
    emit = tree.nodes.new('ShaderNodeEmission')
    tc = tree.nodes.new('ShaderNodeTexCoord')
    sub = tree.nodes.new('ShaderNodeVectorMath')
    sub.operation = 'SUBTRACT'
    sub.inputs[1].default_value = (axis[0], axis[1], 0.0)
    tree.links.new(tc.outputs['Object'] if not world else L.position(tree).socket, sub.inputs[0])
    pos = L.Vec(tree, sub.outputs['Vector'])
    comp = L.components(tree, pos)
    if kind == 'conifer':
        # the outward direction is horizontal; what varies is how far the needle
        # mass tilts up out of it — 0.30 at the skirt to 0.75 at the leader
        xy = (comp['X'] * comp['X'] + comp['Y'] * comp['Y']).sqrt()
        up = 0.30 + 0.45 * (comp['Z'] / L.const(tree, max(1.0, height))).min(1.0).max(0.0)
        nrm = L.combine_rgb(comp['X'], comp['Y'], xy * up).normalize()
    else:
        centre = L.combine_rgb(L.const(tree, 0.0), L.const(tree, 0.0),
                               comp['Z'].min(5.5).max(1.0))
        nrm = (pos - centre).normalize()
    n = L.components(tree, nrm)
    view = L.combine_rgb(n['X'] * c - n['Y'] * s, n['Z'], (n['X'] * s + n['Y'] * c) * -1.0)
    tree.links.new(L.encode_normal(view).socket, emit.inputs['Color'])
    tree.links.new(emit.outputs['Emission'], out.inputs['Surface'])
    return mat


def bark_normal_material():
    """Bark normals: the trunk's outward direction, unrolled.

    The strip is one wrap of the trunk, so the stored normal turns once across the
    cell's v — `(cos, sin)` around the trunk plus a small outward component, the
    same shape the cylindrical bake used to carry. It is read from the uv, so the
    trunk of the tree model (where the object axes are x, y, height) gets the same
    normals as the strip render (where they are along and around)."""
    mat = bpy.data.materials.new('bark_normal')
    mat.use_nodes = True
    tree = mat.node_tree
    for n in list(tree.nodes):
        tree.nodes.remove(n)
    out = tree.nodes.new('ShaderNodeOutputMaterial')
    emit = tree.nodes.new('ShaderNodeEmission')
    uv = tree.nodes.new('ShaderNodeUVMap')
    uv.uv_map = 'UVMap'
    sep = tree.nodes.new('ShaderNodeSeparateXYZ')
    tree.links.new(uv.outputs['UV'], sep.inputs[0])
    theta = L.Num(tree, sep.outputs['Y']) * (2.0 * math.pi)
    s = tree.nodes.new('ShaderNodeMath')
    s.operation = 'SINE'
    tree.links.new(theta.socket, s.inputs[0])
    c = tree.nodes.new('ShaderNodeMath')
    c.operation = 'COSINE'
    tree.links.new(theta.socket, c.inputs[0])
    # the sheet's v is "around the trunk", and it maps to the trunk's radial
    # direction; the strip's own u (along the trunk) carries no normal tilt
    nrm = L.combine_rgb(L.Num(tree, c.outputs[0]), L.Num(tree, s.outputs[0]),
                        L.const(tree, 0.12)).normalize()
    tree.links.new(L.encode_normal(nrm).socket, emit.inputs['Color'])
    tree.links.new(emit.outputs['Emission'], out.inputs['Surface'])
    return mat


def leaf_mats(species, season):
    return [bark_material(species), leaf_material(species, season)]


# --------------------------------------------------------------------------- #
# clump modules


def clump_modules(tree, species, count=6):
    """Six crown modules cut out of the grown tree.

    A crown card is 1.5-3 m across, so a module has to hold that much crown. A
    subtree of the real tree, centred and scaled to fill the cell, keeps the
    species' leaf density and twig habit; a synthetic tuft per cell would not."""
    picks = []
    for seg in tree.segs:
        if seg['level'] < 0:
            continue
        lo, hi = seg['first'], seg['last']
        sub_segs = tree.segs[lo:hi + 1]
        pts = [p for s in sub_segs for p in s['pts']]
        if len(pts) < 10:
            continue
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        zs = [p[2] for p in pts]
        size = max(max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs))
        if size < 1.1:
            continue
        box = Vector(((max(xs) + min(xs)) * 0.5, (max(ys) + min(ys)) * 0.5,
                      (max(zs) + min(zs)) * 0.5))
        reach = size * 0.62
        leaves = [lf for lf in tree.leaves
                  if (lf['centre'] - box).length < reach]
        if len(leaves) < 150:
            continue
        picks.append(dict(segs=sub_segs, leaves=leaves, box=box, size=size,
                          span=max(1e-3, max(zs) - min(zs)),
                          score=len(leaves) / (size * size + 1.0),
                          rnd=random.Random(lo * 7919).random()))
    picks.sort(key=lambda p: -(p['score'] * (0.80 + 0.45 * p['rnd'])))
    chosen = []
    for p in picks:
        if len(chosen) >= count:
            break
        if any((p['box'] - q['box']).length < p['size'] * 0.40 for q in chosen):
            continue
        chosen.append(p)
    if not picks:
        raise RuntimeError(f'{tree.species["name"]}: no crown module had enough leaves')
    for i in range(len(chosen), count):
        chosen.append(picks[i % len(picks)])
    out = []
    for i, p in enumerate(chosen[:count]):
        scale = (CLUMP_M * 0.76) / max(1e-6, p['size'])
        stretch = min(1.30, max(1.0, p['size'] / p['span']))
        out.append(dict(segs=p['segs'], leaves=p['leaves'], box=p['box'],
                        scale=scale, stretch=stretch, index=i))
    return out


class _ClumpXform:
    """Centre the module on the origin, scale it into the cell, stretch its height
    a little so a wide branch mass still fills a square sprite."""

    def __init__(self, module):
        self.box = module['box']
        self.k = module['scale']
        self.z = module['scale'] * module['stretch']

    def __matmul__(self, v):
        return Vector(((v.x - self.box.x) * self.k, (v.y - self.box.y) * self.k,
                       (v.z - self.box.z) * self.z))


def build_clump(species, module, mats):
    xf = _ClumpXform(module)
    aomax = max([lf['ao'] for lf in module['leaves']] or [1.0])
    verts, faces, uvs, cols, slots = [], [], [], [], []
    for seg in module['segs']:
        s = 3 if seg['level'] >= 2 else 4
        pts, radii = seg['pts'], seg['radii']
        ln = sum(math.dist(pts[i], pts[i + 1]) for i in range(len(pts) - 1))
        v, f, u = L.taper_tube(pts, radii, sides=s,
                               uv_u_scale=ln / BARK_M[0], v_span=(0.0, 1.0))
        off = len(verts)
        verts.extend([tuple(xf @ Vector(p)) for p in v])
        uvs.extend(u)
        faces.extend([[i + off for i in fc] for fc in f])
        slots.extend([0] * len(f))
        cols.extend([(1.0, 1.0, 0.50)] * len(v))
    uvs2 = [(0.5, 0.5)] * len(verts)
    for lf in module['leaves']:
        lv, luv = _leaf_quad(lf)
        base = len(verts)
        verts.extend([tuple(xf @ Vector(p)) for p in lv])
        uvs.extend(luv)
        uvs2.extend([(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)])
        cols.extend([(lf['turn'], lf['bright'], min(1.0, lf['ao'] / aomax))] * 4)
        faces.append([base, base + 1, base + 2, base + 3])
        slots.append(1)
    return mesh_object(f'clump{module["index"]}', verts, faces, uvs, cols, uvs2, mats, slots)


# --------------------------------------------------------------------------- #
# low-poly game models


def bark_chunks(pts, radii, span):
    """A polyline as pieces no longer than one bark repeat.

    A repeating UV cannot go on one long quad: where the repetition comes round,
    the interpolation sweeps backwards and the piece of trunk at the seam wears the
    bark of the far end. The deciduous models used to carry `u = length / 2 m` over
    a whole trunk — for a birch, u up to 1.65, i.e. the trunk of *two* columns — and
    `v` over the whole column instead of the strip's own band, so a game trunk was
    drawn with the crown modules. Every piece here gets its own u in [0, 1], which
    is one repeat of the strip."""
    out = []
    for i in range(len(pts) - 1):
        a, b = Vector(pts[i]), Vector(pts[i + 1])
        ra, rb = radii[i], radii[i + 1]
        n = max(1, int(math.ceil((b - a).length / span - 1e-6)))
        for k in range(n):
            t0, t1 = k / n, (k + 1) / n
            out.append((tuple(a.lerp(b, t0)), tuple(a.lerp(b, t1)),
                        ra + (rb - ra) * t0, ra + (rb - ra) * t1))
    return out


def model_wood(species, seed):
    """A trunk and the limbs, simplified to the ~60 vertices a game model can
    afford: 5 sides for the trunk, 4 for a limb, three rings each."""
    tree = grow(species, seed)
    parts = []
    trunk = tree.segs[0]
    pts = [trunk['pts'][i] for i in (0, 2, 4, 5)]
    rad = [trunk['radii'][i] for i in (0, 2, 4, 5)]
    parts.append((pts, rad, species['sides']))
    for seg in tree.segs[1:]:
        if seg['order'] != 1:
            continue
        p = seg['pts']
        r = seg['radii']
        parts.append(([p[0], p[(len(p) - 1) // 2], p[-1]],
                      [r[0], r[(len(r) - 1) // 2], r[-1]], 4))
    verts, faces, uvs, cols, slots = [], [], [], [], []
    band = cell_uv(BARK)
    for pts, rad, sides in parts:
        for p0, p1, r0, r1 in bark_chunks(pts, rad, BARK_M[0]):
            v, f, u = L.taper_tube([p0, p1], [r0, r1], sides=sides, uv_u_scale=1.0,
                                   v_span=(band[1], band[3]))
            off = len(verts)
            verts.extend(v)
            uvs.extend(u)
            faces.extend([[i + off for i in fc] for fc in f])
            slots.extend([0] * len(f))
            cols.extend([(1.0, 1.0, _bark_ao(p[2], species)) for p in v])
    return verts, faces, uvs, cols, slots, tree


def build_tree_model(species, seed, variant, n_cards=22):
    """The in-game model: trunk, limbs and `n_cards` crown cards cut from the six
    clump sprites. About 150-260 vertices — the crown's volume comes from the
    game shader's capsule masking, exactly as in slowroads, so the geometry only
    has to hold the silhouette and the leaf texture."""
    verts, faces, uvs, cols, slots, tree = model_wood(species, seed + variant * 7919)
    uvs2 = [(0.5, 0.5)] * len(verts)
    rng = random.Random(seed + variant * 131)
    leaves = tree.leaves
    if leaves:
        zs = [lf['centre'].z for lf in leaves]
        lo, hi = min(zs), max(zs)
        mid = (lo + hi) * 0.5
        step = max(1, len(leaves) // n_cards)
        picks = [leaves[(i * step + rng.randrange(step)) % len(leaves)] for i in range(n_cards)]
        for lf in picks:
            p = lf['centre']
            out = Vector((p.x, p.y, (p.z - mid) * 0.55))
            if out.length < 1e-4:
                out = Vector((1.0, 0.0, 0.0))
            nrm = out.normalized()
            right = Vector((0.0, 0.0, 1.0)).cross(nrm)
            if right.length < 1e-3:
                right = Vector((1.0, 0.0, 0.0))
            right.normalize()
            up = nrm.cross(right).normalized()
            roll = rng.random() * math.tau
            c, s = math.cos(roll), math.sin(roll)
            rr = (right * c + up * s).normalized()
            uu = (right * -s + up * c).normalized()
            size = rng.uniform(1.5, 2.4)
            centre = p - nrm * 0.10
            u0, v0, u1, v1 = clump_uv(rng.randrange(6))
            base = len(verts)
            verts.extend([
                tuple(centre - rr * size - uu * size),
                tuple(centre + rr * size - uu * size),
                tuple(centre + rr * size + uu * size),
                tuple(centre - rr * size + uu * size)])
            uvs.extend([(u0, v0), (u1, v0), (u1, v1), (u0, v1)])
            uvs2.extend([(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)])
            turn = rng.uniform(0.25, 1.0) if rng.random() > 0.25 else rng.uniform(0.0, 0.3)
            cols.extend([(turn, rng.uniform(0.30, 0.70),
                          0.80 + 0.20 * max(0.0, (p.z - lo) / max(0.3, hi - lo)))] * 4)
            faces.append([base, base + 1, base + 2, base + 3])
            slots.append(1)
    return verts, faces, uvs, cols, slots, uvs2


def cell_uv(rect):
    """A cell's uv rect in *column-local* uv: v from the image bottom, u inside the
    1024 px column. The exporter shifts u into the species' own column after."""
    return (rect['x'] / COLUMN_PX, 1.0 - (rect['y'] + rect['h']) / 1024.0,
            (rect['x'] + rect['w']) / COLUMN_PX, 1.0 - rect['y'] / 1024.0)


def _model_trunk(species, pts, radii, *, sides, v_span, u_of):
    """A trunk as a stack of one-piece tubes, each with its own u.

    A repeating UV cannot go on one long quad: where the period comes round, the
    interpolation sweeps backwards and the bark is smeared across the joint. Each
    piece carries its own u in [0, 1] and the joint ring is duplicated, which is
    how a repeating UV goes on a tube anywhere else."""
    verts, faces, uvs, cols = [], [], [], []
    for i in range(len(pts) - 1):
        (u0, u1) = u_of(i)
        v, f, u = L.taper_tube([pts[i], pts[i + 1]], [radii[i], radii[i + 1]],
                               sides=sides, uv_u_scale=1.0, v_span=v_span)
        off = len(verts)
        verts.extend(v)
        for (frac, vv) in u:
            uvs.append((u0 + (u1 - u0) * frac, vv))
        faces.extend([[k + off for k in fc] for fc in f])
        cols.extend([(1.0, 1.0, _bark_ao(p[2], species)) for p in v])
    return verts, faces, uvs, cols


def _card(verts, faces, uvs, cols, slots, uvs2, p, ux, vx, hu, hv, rect, col):
    """One quad card: `ux`, `vx` its own in-plane axes in metres."""
    uh, vh = ux * hu, vx * hv
    base = len(verts)
    verts.extend([tuple(p - uh - vh), tuple(p + uh - vh), tuple(p + uh + vh), tuple(p - uh + vh)])
    uvs.extend([(rect[0], rect[1]), (rect[2], rect[1]), (rect[2], rect[3]), (rect[0], rect[3])])
    uvs2.extend([(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)])
    cols.extend([col] * 4)
    faces.append([base, base + 1, base + 2, base + 3])
    slots.append(1)


def build_conifer_model(species, seed, variant=0):
    """The in-game conifer: a 5-sided trunk, plus the whorl fans a spruce is drawn
    with or the crossed crown cards a pine is.

    Both come from the *same grown tree* the sprites are drawn from: the fans are
    that tree's own whorls, scaled so a fan's radius is the whorl's radius in the
    star cell, and the cards sit where that tree's own crown is. So the
    model→sprite hand-over is a change of drawing and not a change of tree — the
    one thing the scan-slicing path could not give, because its model was a cone
    and its sprites were a fir. About 190-230 vertices: the volume comes from the
    game shader's cone normal, exactly as in slowroads."""
    tree = grow(species, seed + variant * 7919)
    rng = random.Random(seed + variant * 131)
    verts, faces, uvs, cols, slots, uvs2 = [], [], [], [], [], []
    h = species['height']
    (bu, bv) = species['bark_m']
    bark = cell_uv(BARK)
    sides = species['sides']

    if species['name'] == 'spruce':
        # the bark cell repeats every 2 m, so the trunk is one piece per repeat,
        # each sampling the cell once at its own 512 px/m
        zs = [z for z in (0.0, 2.0, 4.0, 6.0, 8.0, 10.0) if z < h] + [h]
        pts, rad = [], []
        for z in zs:
            p, r = trunk_point(tree, z)
            pts.append(tuple(p))
            rad.append(r)
        vt, ft, ut, ct = _model_trunk(species, pts, rad, sides=sides,
                                      v_span=(bark[1], bark[3]), u_of=lambda i: (0.0, 1.0))
        verts += vt
        faces += ft
        uvs += ut
        cols += ct
        slots += [0] * len(ft)
        uvs2 += [(0.5, 0.5)] * len(vt)

        star = cell_uv(STAR)
        cu, cv = (star[0] + star[2]) * 0.5, (star[1] + star[3]) * 0.5
        ru, rv = (star[2] - star[0]) * 0.5 * 0.94, (star[3] - star[1]) * 0.5 * 0.94
        band_r = _star_band(tree, species)[2]
        whorls = sorted({s.get('whorl', -1) for s in tree.segs if s.get('whorl', -1) >= 0})
        step = max(1, len(whorls) // 22)
        picks = whorls[::step][:22]
        for k, w in enumerate(picks):
            lvs = [lf for lf in tree.leaves if tree.segs[lf['seg']].get('whorl') == w]
            if not lvs:
                continue
            t = k / max(1, len(picks) - 1)
            r = max(math.hypot(lf['centre'].x, lf['centre'].y) for lf in lvs)
            z = sum(lf['centre'].z for lf in lvs) / len(lvs)
            frac = min(1.0, r / max(0.2, band_r))
            rim = 5 + (1 if rng.random() < 0.5 else 0)
            twist = rng.random() * math.tau
            base = len(verts)
            verts.append((rng.uniform(-0.05, 0.05), rng.uniform(-0.05, 0.05), z))
            uvs.append((cu, cv))
            uvs2.append((0.5, 0.5))
            cols.append((1.0, 0.55, 0.45 + 0.55 * t))
            for s in range(rim):
                a = twist + (s / rim) * math.tau
                # the lower whorls hang below their own branch, the upper ones
                # lift: the comb habit and the leader, in the geometry
                dz = (0.12 + 0.30 * t) * r * rng.uniform(0.4, 1.0) - 0.18 * r * (1.0 - t)
                droop = rng.uniform(0.82, 1.04)
                verts.append((math.cos(a) * r * droop, math.sin(a) * r * droop, z + dz))
                uvs.append((cu + math.cos(a) * ru * frac, cv + math.sin(a) * rv * frac))
                uvs2.append((0.5, 0.5))
                cols.append((1.0, rng.uniform(0.40, 0.80), 0.50 + 0.50 * t))
            for s in range(rim):
                faces.append([base, base + 1 + s, base + 1 + (s + 1) % rim])
                slots.append(1)
        return verts, faces, uvs, cols, slots, uvs2

    # a pine: the trunk is one tube, because its cell is the whole trunk and its u
    # is a height — grey-brown at the bottom, orange-red above — with no repeat to
    # hide, so there is no joint to duplicate
    zs = [min(h, z) for z in (0.0, 1.3, 2.6, 3.9, 5.2, 6.5, 7.8, 9.1, 10.4)] + [h]
    pts, rad = [], []
    for z in zs:
        p, r = trunk_point(tree, z)
        pts.append(tuple(p))
        rad.append(r)
    span = min(1.0, 2.0 * math.pi * rad[0] / max(0.05, bv))
    v, f, u = L.taper_tube(pts, rad, sides=sides, uv_u_scale=1.0,
                           v_span=(bark[1], bark[1] + (bark[3] - bark[1]) * span))
    verts += v
    faces += [list(fc) for fc in f]
    slots += [0] * len(f)
    cols += [(1.0, 1.0, _bark_ao(p[2], species)) for p in v]
    uvs2 += [(0.5, 0.5)] * len(v)
    for i in range(len(pts)):
        for s in range(sides):
            uvs.append((zs[i] / h, u[i * sides + s][1]))
    # the dead stubs of the clear trunk, on the grey half of the sheet
    st = species['stubs']
    for i in range(st['count']):
        z = st['lo'] + (st['hi'] - st['lo']) * (i + rng.uniform(0.25, 0.75)) / st['count']
        p, r = trunk_point(tree, z)
        a = rng.uniform(0.0, math.tau)
        pitch = rng.uniform(-0.6, -0.1)
        cp = math.sqrt(max(0.0, 1.0 - pitch * pitch))
        d = Vector((math.cos(a) * cp, math.sin(a) * cp, pitch)).normalized()
        ln = rng.uniform(*st['len'])
        sv, sf, su = L.taper_tube([tuple(p), tuple(p + d * ln)], [r * 0.5, r * 0.18],
                                  sides=3, uv_u_scale=1.0, v_span=(bark[1], bark[1] + 0.06))
        off = len(verts)
        verts += sv
        uvs += [(z / h, uv[1]) for uv in su]
        faces += [[k + off for k in fc] for fc in sf]
        slots += [0] * len(sf)
        cols += [(1.0, 1.0, _bark_ao(p[2], species)) for _p in sv]
        uvs2 += [(0.5, 0.5)] * len(sv)
    # the crown: crossed cards on the tree's own limbs, so the plates the sprite
    # shows and the plates the model shows are in the same places
    plate = cell_uv(BRANCH)
    lo = species['crown_lo'] * (h / species['height'])
    host = [lf for lf in tree.leaves if lf['centre'].z > lo] or tree.leaves
    n_plates = 11
    step = max(1, len(host) // n_plates)
    for i in range(n_plates):
        lf = host[(i * step + rng.randrange(step)) % len(host)]
        p = lf['centre']
        t = min(1.0, max(0.0, (p.z - lo) / max(0.5, h - lo)))
        a0 = rng.uniform(0.0, math.tau)
        for half in (0.0, math.pi * 0.5):
            a = a0 + half
            tilt = 0.26 + 0.16 * t
            ux = Vector((math.cos(a), math.sin(a), 0.0))
            nrm = Vector((math.cos(a) * math.cos(tilt), math.sin(a) * math.cos(tilt), math.sin(tilt)))
            vx = nrm.cross(ux).normalized()
            _card(verts, faces, uvs, cols, slots, uvs2, p, ux, vx,
                  rng.uniform(1.05, 1.55), rng.uniform(0.60, 0.95), plate,
                  (1.0, rng.uniform(0.55, 0.95), 0.60 + 0.40 * t))
    return verts, faces, uvs, cols, slots, uvs2


def export_models(species, season, out_dir, *, column, columns):
    """One GLB per variant, with UVs shifted into the species' atlas column."""
    mats = []
    for variant in range(IMPOSTOR_VARIANTS):
        L.configure(64, 64, samples=1)
        L.clear_objects()
        if species['kind'] == 'conifer':
            data = build_conifer_model(species, 101, variant)
        else:
            data = build_tree_model(species, 101, variant)
        verts, faces, uvs, cols, slots, uvs2 = data
        uvs = [((column + u) / columns, v) for (u, v) in uvs]
        obj = mesh_object(f'tree_{species["name"]}_{variant}', verts, faces, uvs, cols, uvs2, mats, slots)
        L.export_glb([obj], os.path.join(out_dir, f'tree_{species["name"]}_{variant}.glb'),
                     vertex_color='ACTIVE')
        L.log('exported', species['name'], variant, len(obj.data.vertices), 'verts',
              len(obj.data.polygons), 'faces')


# --------------------------------------------------------------------------- #
# rendering


def _cell(species, season, w, h, frame_w, frame_h, samples, centre):
    L.configure(w, h, samples=samples)
    L.clear_objects()
    L.ortho_camera(frame_h, frame_w, frame_h, centre=centre)


def render_clumps(species, season, out_dir, *, seed=101):
    tree = grow(species, seed)
    modules = clump_modules(tree, species, 6)
    mats = leaf_mats(species, season)
    for module in modules:
        i = module['index']
        _cell(species, season, 256, 256, CLUMP_M, CLUMP_M, 32, (0.0, 0.0, 0.0))
        build_clump(species, module, mats)
        L.render_to(os.path.join(out_dir, f'clump{i}.png'))
        _cell(species, season, 256, 256, CLUMP_M, CLUMP_M, 16, (0.0, 0.0, 0.0))
        build_clump(species, module, [crown_normal_material('deciduous')])
        L.render_to(os.path.join(out_dir, f'clump{i}_n.png'))
        L.log('clump', i, len(module['leaves']), 'leaves')


def render_whole_tree(species, season, out_dir, *, seed=101):
    mats = leaf_mats(species, season)
    _cell(species, season, WHOLE['w'], WHOLE['h'], WHOLE_M[0], WHOLE_M[1], 32,
          (0.0, 0.0, WHOLE_M[1] * 0.5))
    build_leafy('tree', species, seed, mats)[0]
    L.render_to(os.path.join(out_dir, 'tree.png'))
    _cell(species, season, WHOLE['w'], WHOLE['h'], WHOLE_M[0], WHOLE_M[1], 16,
          (0.0, 0.0, WHOLE_M[1] * 0.5))
    build_leafy('tree', species, seed, [crown_normal_material('deciduous')])
    L.render_to(os.path.join(out_dir, 'tree_n.png'))


def render_impostors(species, season, out_dir, *, seed=101, views=IMPOSTOR_VIEWS):
    """16 views of the full-detail tree in ONE render: the copies stand along the
    camera plane, each rotated about its own axis, so one orthographic camera
    bakes the whole row. The normal pass swaps in one material per view (through
    the object-level material override, so the mesh is built once) and carries
    that view's rotation inside the baked normal."""
    cell = IMPOSTOR_CELL_M
    mats = leaf_mats(species, season)
    for pass_name, normal in (('albedo', False), ('normal', True)):
        L.configure(views * 256, 256, samples=24 if not normal else 16)
        L.clear_objects()
        L.ortho_camera(views * cell, views * cell, cell, centre=(0.0, 0.0, cell * 0.5))
        obj, _, n_wood = build_leafy(
            'imp', species, seed,
            [mats[0], mats[1]] if not normal else [crown_normal_material('deciduous')])
        mesh = obj.data
        for view in range(views):
            yaw = (view / views) * math.tau
            copy = L.object_from_mesh(f'imp_{view}', mesh)
            copy.matrix_world = Matrix.Translation(((view - (views - 1) * 0.5) * cell, 0.0, 0.0)) \
                @ Matrix.Rotation(yaw, 4, 'Z')
            if normal:
                copy.material_slots[0].link = 'OBJECT'
                copy.material_slots[0].material = crown_normal_material('deciduous', yaw=yaw)
        bpy.data.objects.remove(obj, do_unlink=True)
        L.render_to(os.path.join(out_dir, f'impostor_{pass_name}.png'))


def _bark_sheet(span, cols=16, rows=8):
    """The trunk surface laid flat in the X-Z plane: x along the trunk (the span's
    first number, the texture's u) and z around it (the second, the texture's v).

    A photograph of a vertical cylinder instead put the visible 0.6 m of trunk in
    the middle 30 % of a 2 m cell and mapped the circumference through an arccos,
    so the strip was a pale square with one smeared blob and the game's bark was
    squashed. A flat sheet gives the camera exactly the rectangle the atlas claims,
    at the same texels per metre on both axes."""
    verts, faces, uvs = [], [], []
    for iy in range(rows + 1):
        for ix in range(cols + 1):
            u, v = ix / cols, iy / rows
            verts.append((u * span[0] - span[0] * 0.5, 0.0, v * span[1] - span[1] * 0.5))
            uvs.append((u, v))
    for iy in range(rows):
        for ix in range(cols):
            a = iy * (cols + 1) + ix
            faces.append([a, a + 1, a + cols + 2, a + cols + 1])
    return verts, faces, uvs


def render_bark(species, out_dir):
    """The bark strip: the trunk surface unrolled, u along the trunk and v one
    wrap around it.

    A spruce's cell repeats every 2 m, which gives 512 px/m on both axes and a
    scale of its own size. A pine's cell is the whole trunk, because that is the
    only way one sheet can hold the two zones the species is known by — grey-brown
    furrowed bark below, orange-red flaky plates above. It is 11.6 m along u and
    2.9 m around v: the cell's 4:1 pixels then cover both axes at 88 px/m, the way
    the cell's aspect wants, and a pine's own trunk (a 0.26 m one, 1.6 m round)
    shows the first 56 % of that."""
    span = species['bark_m']
    for pass_name, normal in (('', False), ('_n', True)):
        L.configure(BARK['w'], BARK['h'], samples=24 if not normal else 8)
        L.clear_objects()
        L.ortho_camera(span[0], span[0], span[1], centre=(0.0, 0.0, 0.0))
        verts, faces, uvs = _bark_sheet(span, cols=max(16, int(span[0] * 8)), rows=8)
        obj = L.mesh_object('bark', verts, faces, uvs)
        attr = obj.data.color_attributes.new(name='Col', type='FLOAT_COLOR', domain='POINT')
        for i in range(len(verts)):
            attr.data[i].color = (1.0, 1.0, 1.0, 1.0)
        obj.data.materials.append(bark_normal_material() if normal else bark_material(species))
        L.render_to(os.path.join(out_dir, f'bark{pass_name}.png'))


# --------------------------------------------------------------------------- #
# conifers: needle shoots, cards, cells
#
# There is no scan path left here. Every conifer sprite — the whole-tree side
# view, the top-down star the model's fans sample and the side cell — is a render
# of the *same grown tree*, and the game model is grown from that tree as well.
# The previous pass cut a CC0 fir and a pine out of their packs with camera clip
# planes and handed the game a different tree from the one the sprites showed:
# flat olive silhouettes, whorl cells aimed at the gaps between tiers, a hexagon
# of trunk through the middle of a star, and a bare pole where the crown was
# supposed to start.


def needle_sheet(species, *, size=512, seed=17):
    """Four drawn needle shoots on transparent, one per quadrant.

    A photograph cannot fill a needle card. A spruce needle is 1.5-2 cm: at the
    whole-tree sprite's 64 px/m that is one texel, and at the impostor's
    20.6 px/m a third of one, so a photo of real needles comes out as speckle —
    which is what "flat olive silhouette" was. A card here is 9-36 cm of shoot
    carrying a *drawing* of that shoot at its own scale: needles 2-3 px wide raked
    off a twig, darker at the base and lighter at the tip, so the card reads as a
    needle mass at any angle and at any mip level.

    The species' own habit is in the drawing: a spruce shoot carries ~46 short
    dark blue-green needles along its whole length; a pine's card is a tuft of
    long grey-green fascicles out of the end of a twig. One sheet serves all four
    seasons — the grade in the material does the season, as it does for leaves.
    """
    name = species['name']
    path = os.path.join(CACHE, 'trees', f'needles_{name}.png')
    if os.path.exists(path):
        return path
    os.makedirs(os.path.dirname(path), exist_ok=True)
    cfg = species['needle']
    n = cfg['needles']
    (l0, l1) = cfg['len']
    (t0, t1) = cfg['thick']
    spread = cfg['spread']
    base, tip, twig = cfg['base'], cfg['tip'], cfg['twig']
    rng = random.Random(seed)
    px = [0.0] * (size * size * 4)

    def dot(fx, fy, rad, col, alpha=1.0):
        """One soft round dot at (fx, fy) in the sheet's uv, radius in pixels."""
        cx, cy = fx * size, fy * size
        for y in range(max(0, int(cy - rad) - 1), min(size, int(cy + rad) + 2)):
            for x in range(max(0, int(cx - rad) - 1), min(size, int(cx + rad) + 2)):
                d = math.hypot(x + 0.5 - cx, y + 0.5 - cy)
                a = min(1.0, max(0.0, rad + 0.5 - d)) * alpha
                if a <= 0.0 or a < px[((size - 1 - y) * size + x) * 4 + 3]:
                    continue
                o = ((size - 1 - y) * size + x) * 4
                px[o] = col[0]
                px[o + 1] = col[1]
                px[o + 2] = col[2]
                px[o + 3] = a

    def needle(x0, y0, x1, y1, half, c_base, c_tip, bright):
        """A needle with a lighter tip: a row of dots along the segment."""
        ln = math.hypot(x1 - x0, y1 - y0) * size
        steps = max(2, int(ln * 1.5))
        for i in range(steps + 1):
            t = i / steps
            col = tuple((c_base[k] + (c_tip[k] - c_base[k]) * t) * bright for k in range(3))
            dot(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, half, col)

    if name not in ('spruce', 'pine'):
        raise RuntimeError(f'needle_sheet: no drawing for {name}')
    for c in range(4):
        rect = SPRIG_RECTS[c]
        b = random.Random(seed + 131 * c)
        cell_px = size * (rect[2] - rect[0])

        def local(a, v, rect=rect):
            return (rect[0] + a * (rect[2] - rect[0]), rect[1] + v * (rect[3] - rect[1]))

        if name == 'spruce':
            # a shoot: the twig runs along the card and the needles rake forward
            # and out on both sides along its whole length. Dense on purpose —
            # a card is 20-30 cm of shoot and it has to *cover* the branch behind
            # it, or the tree renders as a skeleton with whiskers on it
            for i in range(32):
                dot(*local(0.02 + 0.96 * (i / 31.0), 0.5), 1.0, twig, 1.0)
            # the strands are drawn *thick* on purpose: a card is 10-30 px on
            # the screen, so a 2 px strand on a 256 px sheet would be a sixteenth
            # of a pixel and mip into a flat wash. At this width a card keeps a
            # needle texture at the whole-tree scale and still reads as a needle
            # mass at the impostor's
            for i in range(n):
                t = i / max(1, n - 1)
                a0 = min(0.90, max(0.04, 0.04 + 0.62 * t + b.gauss(0.0, 0.02)))
                sgn = 1.0 if i % 2 else -1.0
                ang = sgn * b.uniform(0.30, spread)
                ln = b.uniform(l0, l1)
                a1 = min(0.98, max(0.02, a0 + math.cos(ang) * ln))
                v1 = min(0.98, max(0.02, 0.5 + math.sin(ang) * ln * 0.94))
                half = b.uniform(t0, t1) * cell_px * 0.5
                # needles at the back of the shoot are darker, which is the only
                # depth a flat card can carry
                shade = b.uniform(0.70, 1.18)
                needle(*local(a0, 0.5), *local(a1, v1), half, base, tip, shade)
        else:
            # a pine's card is a tuft: fascicles of long needles out of one twig
            # end, each with its own brown sheath
            for f in range(cfg.get('fascicles', 6)):
                v0 = 0.14 + 0.72 * ((f + b.uniform(0.15, 0.85)) / cfg.get('fascicles', 6))
                a0 = 0.04 + 0.26 * b.random()
                dot(*local(a0, v0), 2.6, twig, 1.0)
                for _ in range(max(3, n // cfg.get('fascicles', 6))):
                    ang = b.uniform(-spread, spread)
                    ln = b.uniform(l0, l1)
                    a1 = min(0.98, max(0.02, a0 + math.cos(ang) * ln))
                    v1 = min(0.98, max(0.02, v0 + math.sin(ang) * ln))
                    half = b.uniform(t0, t1) * cell_px * 0.5
                    needle(*local(a0, v0), *local(a1, v1), half, base, tip, b.uniform(0.72, 1.16))
    img = bpy.data.images.new(f'needles_{name}', size, size, alpha=True)
    img.pixels = px
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()
    return path


def needle_material(species, season):
    """The needle card: the drawn shoot, the season's grade, the per-card
    brightness and occlusion, and — in winter — snow on the cards that face up.

    `Col` carries three things per card, the same channel the deciduous leaves
    use: R how much snow the card holds (its own up-facing-ness and its height in
    the crown), G its brightness, B its occlusion. R is free here because a
    conifer never turns, so the slot that carries a leaf's autumn turn carries a
    shoot's snow instead."""
    mat = L.cutout_emission(f'needle_{species["name"]}_{season}', needle_sheet(species),
                            threshold=0.45)
    tree = mat.node_tree
    emit = [n for n in tree.nodes if n.type == 'EMISSION'][0]
    tex = [n for n in tree.nodes if n.type == 'TEX_IMAGE'][0]
    var = attr_rgb(tree)
    g = CONIFER_GRADES[season]
    amount = L.const(tree, g['amount']) * (0.72 + 0.28 * var['Y'])
    col = L.mix_vec(L.Vec(tree, tex.outputs['Color']), L.vec_const(tree, *g['tint']), amount)
    gain = g['gain'] * species['sprig'].get('gain', 1.0)
    col = col.scale(L.const(tree, gain) * (0.78 + 0.44 * var['Y']))
    col = col.scale(attr_ao(tree))
    if g.get('snow'):
        snow = L.clamp01(var['X']) * g['snow']
        col = L.mix_vec(col, L.vec_const(tree, 0.88, 0.91, 0.96), snow)
    tree.links.new(col.socket, emit.inputs['Color'])
    return mat


def conifer_mats(species, season):
    return [bark_material(species), needle_material(species, season)]


# --------------------------------------------------------------------------- #
# conifer meshes


def _trim_seg(seg, trims):
    pts, radii = seg['pts'], seg['radii']
    frac = (trims or {}).get(seg['level'])
    if frac is None:
        return pts, radii
    lengths = [0.0]
    for i in range(1, len(pts)):
        lengths.append(lengths[-1] + math.dist(pts[i - 1], pts[i]))
    total = lengths[-1] or 1.0
    keep = 1
    while keep < len(pts) - 1 and lengths[keep] < frac * total:
        keep += 1
    return pts[:keep + 1], radii[:keep + 1]


def _wood_uv(species, seg, dist, z, v):
    """The bark strip's own uv for one wood vertex.

    The strip is the trunk unrolled — u along the trunk, v one wrap around it —
    and every bark pattern is written in those uv *metres*, because the strip
    render and the tree are different objects with different axes and uv is the
    one frame both share.

    A spruce's strip tiles every 2 m, so its u is the distance along the branch.
    A pine's cell is the *whole trunk*: grey-brown furrowed bark at the bottom,
    orange-red flaky plates above, so its trunk samples the sheet by height, its
    limbs sample the flaky part by distance along the branch, and the dead stubs
    below the crown sit in the grey. That is the only difference between the two,
    and it is why a pine's clear trunk reads as a pine."""
    (bu, _bv) = species['bark_m']
    if species['bark_style'] == 'pine':
        if seg['level'] < 0:
            return (min(0.999, max(0.0, z / bu)), v)
        if seg.get('dead'):
            return (0.04 + 0.22 * ((dist / 1.2) % 1.0), v)
        return (0.62 + 0.32 * ((dist / 1.6) % 1.0), v)
    return (((dist / bu) % 1.0), v)


def _wood_ao(species, p):
    """The woody skeleton's own occlusion, in the same `Col` channel as a card's.

    `_bark_ao` knows the height of the trunk and nothing else, which is right for
    a deciduous tree whose limbs are out in the light. A conifer's limbs are
    *inside* the crown: a whorl branch is bright out at its tip and dark where it
    leaves the trunk, and a trunk that carries its crown to the ground is dark all
    the way up it. That radial term is what stopped the first grown star cell from
    having a white blob where its spokes met, and the whole-tree sprite from
    showing a pale trunk through its needles."""
    z = p[2]
    ao = _bark_ao(z, species)
    if species.get('crown_to_ground'):
        inside = 1.0
    else:
        inside = min(1.0, max(0.0, (z - species['crown_lo']) / max(0.5, species['height'] * 0.18)))
    if inside > 0.0:
        reach = max(0.30, cone_radius(species, max(z, species['crown_lo'])))
        rr = min(1.0, math.hypot(p[0], p[1]) / reach)
        ao *= 1.0 - inside * (0.72 - 0.58 * rr)
    return ao


def conifer_mesh(tree, species, *, sel=None, xf=None, max_level=1, trims=None):
    """The full-detail conifer: woody tubes for the skeleton and one needle card
    per drawn shoot.

    `sel` limits both to a set of segment indices — that is how the top-down star
    (a band of whole whorls, seen from above) and the side cell (one whole branch)
    are drawn from the same tree instead of being cut out of an imported mesh, and
    `sel=None` is the whole tree. `xf` moves the finished cell; the bark's uv is
    read from the vertex *before* it, because the pine's bark is a function of
    height and a branch turned to run across a cell must keep the bark it grew."""
    verts, faces, uvs, cols, uvs2, slots = [], [], [], [], [], []
    for seg in tree.segs:
        if seg['level'] > max_level:
            continue
        if sel is not None and seg['idx'] not in sel:
            continue
        s = species.get('sides', 5) if seg['level'] < 0 else (5 if seg['level'] == 0 else 4)
        pts, radii = _trim_seg(seg, trims)
        ln = sum(math.dist(pts[i], pts[i + 1]) for i in range(len(pts) - 1))
        # the strip's v is one wrap of the trunk it was authored for; a twig is not
        # that thick, so its own circumference is what it gets, or a 3 cm twig
        # would wear the whole trunk's bark stretched round it
        span = min(1.0, 2.0 * math.pi * max(0.004, radii[0]) / max(0.05, species['bark_m'][1]))
        v, f, u = L.taper_tube(pts, radii, sides=s, uv_u_scale=1.0, v_span=(0.0, span))
        off = len(verts)
        for i, (frac, vv) in enumerate(u):
            uvs.append(_wood_uv(species, seg, frac * ln, v[i][2], vv))
        verts.extend([tuple(xf @ Vector(p)) if xf is not None else p for p in v])
        faces.extend([[i + off for i in fc] for fc in f])
        slots.extend([0] * len(f))
        cols.extend([(1.0, 1.0, _wood_ao(species, p)) for p in v])
    uvs2 = [(0.5, 0.5)] * len(verts)
    for lf in tree.leaves:
        if sel is not None and lf['seg'] not in sel:
            continue
        lv, luv = _leaf_quad(lf)
        base = len(verts)
        verts.extend([tuple(xf @ Vector(p)) if xf is not None else p for p in lv])
        uvs.extend(luv)
        uvs2.extend([(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)])
        # the tip end of a shoot sees more sky than the end by the twig, so the
        # card's far edge is brighter: a card of one flat colour reads as paper
        snow = lf.get('snow', 0.0)
        bright = lf['bright']
        cols.extend([(snow, bright * 0.90, lf['ao'])] * 2
                    + [(snow, min(1.35, bright * 1.10), lf['ao'])] * 2)
        faces.append([base, base + 1, base + 2, base + 3])
        slots.append(1)
    return verts, faces, uvs, cols, uvs2, slots


def build_conifer_detail(name, tree, species, season, *, sel=None, xf=None, trims=None,
                         normal=False, max_level=1):
    """One object from `conifer_mesh`: bark and needles in two slots, or a single
    material for the analytic normal pass over the whole thing."""
    verts, faces, uvs, cols, uvs2, slots = conifer_mesh(
        tree, species, sel=sel, xf=xf, max_level=max_level, trims=trims)
    if normal:
        mats = [crown_normal_material('conifer', height=species['height'])]
        slots = [0] * len(faces)
    else:
        mats = conifer_mats(species, season)
    return mesh_object(name, verts, faces, uvs, cols, uvs2, mats, slots)


def _subtree(tree, seg):
    return set(range(seg['first'], seg['last'] + 1))


def trunk_point(tree, z):
    """The trunk's axis and radius at height z."""
    pts, radii = tree.segs[0]['pts'], tree.segs[0]['radii']
    for i in range(len(pts) - 1):
        if pts[i][2] <= z <= pts[i + 1][2]:
            span = max(1e-6, pts[i + 1][2] - pts[i][2])
            f = (z - pts[i][2]) / span
            p = Vector(pts[i]).lerp(Vector(pts[i + 1]), f)
            return p, radii[i] * (1.0 - f) + radii[i + 1] * f
    top = z > pts[-1][2]
    return Vector(pts[-1] if top else pts[0]), (radii[-1] if top else radii[0])


def _top_camera(size_m):
    """An orthographic camera looking straight down, image up = world +Y."""
    cam_data = bpy.data.cameras.new('star_cam')
    cam_data.type = 'ORTHO'
    cam_data.ortho_scale = size_m
    cam_data.clip_start = 0.05
    cam_data.clip_end = 400.0
    cam = bpy.data.objects.new('star_cam', cam_data)
    bpy.context.collection.objects.link(cam)
    cam.location = (0.0, 0.0, 80.0)
    cam.rotation_euler = (0.0, 0.0, 0.0)
    bpy.context.scene.camera = cam
    return cam


def conifer_whole(tree, species, out, season):
    """The whole-tree sprite: the tree at instance scale 1, its base on the cell's
    bottom edge, 64 px/m — the same cell a deciduous species uses."""
    L.configure(WHOLE['w'], WHOLE['h'], samples=32)
    L.clear_objects()
    L.ortho_camera(WHOLE_M[1], WHOLE_M[0], WHOLE_M[1], centre=(0.0, 0.0, WHOLE_M[1] * 0.5))
    build_conifer_detail('tree', tree, species, season, trims={0: 0.90}, max_level=0)
    L.render_to(os.path.join(out, 'tree.png'))


def _star_band(tree, species):
    """The whorls the top-down cell is drawn from, and how wide they are.

    The band is the tree's own widest whorl plus its neighbours: one tier seen
    from above is a ring of spokes with a hole in the middle, and the two metres
    of tiers around it are the needle mass the model's fans need. The band is
    centred on the **trunk axis** at that height rather than on the bounding box,
    because the fan it is mapped onto is centred on the axis."""
    width, zs = {}, {}
    for seg in tree.segs:
        w = seg.get('whorl', -1)
        if w >= 0:
            zs.setdefault(w, seg['pts'][0][2])
    for lf in tree.leaves:
        w = tree.segs[lf['seg']].get('whorl', -1)
        if w < 0:
            continue
        width[w] = max(width.get(w, 0.0), math.hypot(lf['centre'].x, lf['centre'].y))
    k = max(width, key=lambda w: width[w])
    band = [w for w in (k - 2, k - 1, k, k + 1, k + 2) if w in zs]
    return band, zs[k], width[k]


def conifer_star(tree, species, out, season):
    """The top-down star the model's whorl fans sample.

    A real top-down view of the grown tree's own tiers: no clip planes, no slice
    height guessed from a radius profile, and no chance of landing in the gap
    between two whorls, because the band *is* whorls. Scaled so the star fills
    94 % of the cell and centred on the trunk axis, which is where a fan's centre
    vertex sits."""
    band, z, radius = _star_band(tree, species)
    sel = set()
    for seg in tree.segs:
        if seg.get('whorl', -1) in band:
            sel |= _subtree(tree, seg)
    k = (STAR['m'] * 0.5 * 0.94) / max(0.25, radius)
    p, _ = trunk_point(tree, z)
    xf = Matrix.Scale(k, 4) @ Matrix.Translation((-p.x, -p.y, -z))
    L.configure(STAR['w'], STAR['h'], samples=24)
    L.clear_objects()
    _top_camera(STAR['m'])
    build_conifer_detail('star', tree, species, season, sel=sel, xf=xf, max_level=0)
    L.render_to(os.path.join(out, 'star.png'))
    L.log(species['name'], 'star: whorls', band,
          'at %.2f m, %.2f m across, %d shoots' % (z, 2 * radius,
                                                   len([lf for lf in tree.leaves if lf['seg'] in sel])))


def conifer_branch(tree, species, out, season):
    """The side cell: a spruce's hanging whorl branch, a pine's foliage plate.

    One whole branch of the grown tree — every branchlet and every shoot it
    carries — turned to run across the cell and scaled to fill it. The cell is
    twice as wide as it is tall, so the branch is chosen for *its own* aspect as
    well as for its size: a long thin branch in a 4 x 2 m cell leaves a band of
    nothing along the top, which is what "an empty cell" was in the last pass. A
    spruce's frame is the whole branch, comb and all; a pine's is its foliage,
    because a pine's plate is its foliage and the bare half of the limb belongs
    outside the frame, where a card's branch enters it."""
    want = 0            # a limb: a spruce's whorl branch, a pine's crown limb
    picks = []
    for seg in tree.segs:
        if seg['level'] != want or seg.get('dead'):
            continue
        sub = [tree.segs[i] for i in _subtree(tree, seg)]
        sel = _subtree(tree, seg)
        leaves = [lf['centre'] for lf in tree.leaves if lf['seg'] in sel]
        wood = [p for s in sub for p in s['pts']]
        if len(leaves) < 40 or len(wood) < 4:
            continue
        pts = leaves if species['name'] == 'pine' else leaves + wood
        w = math.hypot(max(p[0] for p in pts) - min(p[0] for p in pts),
                       max(p[1] for p in pts) - min(p[1] for p in pts))
        h = max(p[2] for p in pts) - min(p[2] for p in pts)
        if w < 0.6 or h < 0.15:
            continue
        # a spruce wants a low whorl — those are the branches that hang with their
        # branchlets, the comb habit
        low = seg['whorl'] <= species['whorls'] * 0.55
        score = 1.0 * (1.0 if low else 0.0) - abs(math.log(w / h) - math.log(2.0))
        picks.append((score, len(leaves) * w, seg, sub, sel, pts))
    if not picks:
        raise RuntimeError(f'{species["name"]}: no branch to draw a side cell from')
    _s, _a, seg, sub, sel, pts = max(picks, key=lambda p: (p[0], p[1]))
    base = Vector(seg['pts'][0])
    lo = Vector((min(p[0] for p in pts), min(p[1] for p in pts), min(p[2] for p in pts)))
    hi = Vector((max(p[0] for p in pts), max(p[1] for p in pts), max(p[2] for p in pts)))
    centre = (lo + hi) * 0.5
    far = max(pts, key=lambda p: (Vector(p) - base).length)
    theta = math.atan2(far[1] - base.y, far[0] - base.x)
    rot = Matrix.Rotation(-theta, 4, 'Z')
    moved = [rot @ (Vector(p) - centre) for p in pts]
    ex = max(0.2, max(p.x for p in moved) - min(p.x for p in moved))
    ez = max(0.2, max(p.z for p in moved) - min(p.z for p in moved))
    k = min(BRANCH['m'][0] * 0.94 / ex, BRANCH['m'][1] * 0.94 / ez)
    xf = Matrix.Scale(k, 4) @ rot @ Matrix.Translation(-centre)
    L.configure(BRANCH['w'], BRANCH['h'], samples=24)
    L.clear_objects()
    L.ortho_camera(BRANCH['m'][0], BRANCH['m'][0], BRANCH['m'][1], centre=(0.0, 0.0, 0.0))
    build_conifer_detail('branch', tree, species, season, sel=sel, xf=xf)
    L.render_to(os.path.join(out, 'branch.png'))
    L.log(species['name'], 'side cell: whorl', seg['whorl'],
          len([lf for lf in tree.leaves if lf['seg'] in sel]), 'shoots,',
          '%.2f x %.2f m framed at %.2f' % (ex, ez, k))


def render_conifer_cells(species, season, out_dir, *, seed=101):
    """The whole-tree sprite, the top-down star and the side branch of one
    species-season, all three from one grown tree."""
    tree = grow(species, seed)
    conifer_whole(tree, species, out_dir, season)
    conifer_star(tree, species, out_dir, season)
    conifer_branch(tree, species, out_dir, season)
    L.log(species['name'], season, len(tree.leaves), 'needle shoots,',
          sum(len(s['pts']) for s in tree.segs), 'skeleton points')


def render_conifer_impostors(species, season, out_dir, *, seed=101, views=IMPOSTOR_VIEWS):
    """The impostor row: sixteen views of the same full-detail tree the sprites
    are drawn from, in one render, at the species' own height — so the sprite and
    the model agree in size as well as in shape."""
    cell = IMPOSTOR_CELL_M
    # a conifer's needles keep their shape all year, so the normal row is baked
    # once and shared by the seasons (tools/look/trees.mjs writes it out of summer)
    for pass_name, normal in [('albedo', False)] + ([('normal', True)] if season == 'summer' else []):
        L.configure(views * 256, 256, samples=24 if not normal else 16)
        L.clear_objects()
        L.ortho_camera(views * cell, views * cell, cell, centre=(0.0, 0.0, cell * 0.5))
        obj = build_conifer_detail('imp', grow(species, seed), species, season,
                                   normal=normal, max_level=0)
        mesh = obj.data
        for view in range(views):
            yaw = (view / views) * math.tau
            x0 = (view - (views - 1) * 0.5) * cell
            copy = L.object_from_mesh(f'imp_{view}', mesh)
            copy.matrix_world = Matrix.Translation((x0, 0.0, 0.0)) @ Matrix.Rotation(yaw, 4, 'Z')
            if normal:
                copy.material_slots[0].link = 'OBJECT'
                copy.material_slots[0].material = crown_normal_material(
                    'conifer', yaw=yaw, axis=(x0, 0.0), world=True, height=species['height'])
        bpy.data.objects.remove(obj, do_unlink=True)
        L.render_to(os.path.join(out_dir, f'impostor_{pass_name}.png'))

# --------------------------------------------------------------------------- #
# stumps and logs
#
# Poly Haven's stump and fallen-trunk scans are 22k-53k vertices; the game wants a
# few hundred. They are decimated here and their UVs are remapped into one 2x2
# texture atlas (tools/look/trees.mjs assembles stump.webp from the same four
# diffuse maps), so a whole stump or log costs one draw and one small texture.

STUMP_SOURCES = [
    dict(model='tree_stump_01', file='tree_stump_0', tile=0, tris=520),
    dict(model='tree_stump_02', file='tree_stump_1', tile=1, tris=520),
    dict(model='dead_tree_trunk', file='tree_log_0', tile=2, tris=420),
    dict(model='dead_tree_trunk_02', file='tree_log_1', tile=3, tris=420),
]


def job_stumps(out, target_scale=None):
    L.reset(64, 64, samples=1)
    for spec in STUMP_SOURCES:
        model = spec['model']
        path = os.path.join(PH, model, f'{model}_1k.gltf')
        if not os.path.exists(path):
            raise RuntimeError(f'{path} missing — run node tools/look/build.mjs')
        objs = [o for o in L.import_gltf(path) if o.type == 'MESH']
        obj = max(objs, key=lambda o: len(o.data.vertices))
        for other in objs:
            if other is not obj:
                bpy.data.objects.remove(other, do_unlink=True)
        obj.data.transform(obj.matrix_world)
        obj.matrix_world = Matrix.Identity(4)
        lo = [min(v.co[i] for v in obj.data.vertices) for i in range(3)]
        hi = [max(v.co[i] for v in obj.data.vertices) for i in range(3)]
        obj.data.transform(Matrix.Translation((-(lo[0] + hi[0]) * 0.5, -(lo[1] + hi[1]) * 0.5, -lo[2])))
        if target_scale:
            height = hi[2] - lo[2]
            obj.data.transform(Matrix.Scale(target_scale / height, 4))
        tile = spec['tile']
        tx, ty = tile % 2, tile // 2
        # the tile's own uv space [0,1]^2 -> its quarter of the atlas, with the
        # tile row 0 at the top because stump.webp is assembled row 0 on top
        for layer in obj.data.uv_layers:
            for datum in layer.data:
                u, v = datum.uv
                datum.uv = ((tx + min(1.0, max(0.0, u))) * 0.5, 1.0 - (ty + 1.0 - min(1.0, max(0.0, v))) * 0.5)
        faces = len(obj.data.polygons)
        mod = obj.modifiers.new('decimate', 'DECIMATE')
        mod.ratio = min(1.0, spec['tris'] / max(1, faces))
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        bpy.ops.object.modifier_apply(modifier=mod.name)
        obj.data.materials.clear()
        size = max(max(v.co[i] for v in obj.data.vertices) - min(v.co[i] for v in obj.data.vertices)
                   for i in range(2))
        L.export_glb([obj], os.path.join(out, f'{spec["file"]}.glb'), vertex_color='NONE')
        L.log('stump', spec['file'], len(obj.data.vertices), 'verts',
              len(obj.data.polygons), 'tris, footprint %.2f m' % size)
        bpy.data.objects.remove(obj, do_unlink=True)


# --------------------------------------------------------------------------- #
# jobs


def job_clumps(out, species_name, season):
    species = dict(SPECIES[species_name], name=species_name)
    render_clumps(species, season, out)


def job_tree(out, species_name, season, clumps, column, columns):
    """Whole-tree sprite, impostor row and the four models of a deciduous species.

    A conifer's sprites and impostors come from the `conifer` job, which draws
    them from its own grown tree, so this only exports that species' models."""
    species = dict(SPECIES[species_name], name=species_name)
    if species['kind'] == 'deciduous':
        render_whole_tree(species, season, out)
        render_impostors(species, season, out)
    export_models(species, season, out, column=int(column), columns=int(columns))


def job_bark(out, species_name):
    render_bark(dict(SPECIES[species_name], name=species_name), out)


def job_models(out, specs):
    """The game models of a list of species, and nothing else.

    A driver rebuild renders a species' sprites on its way to the models; this
    exists so a model-side fix — a UV against a cell the atlas has since moved —
    can be re-exported without re-rendering a single pixel. `specs` are
    `name:column:columns` triples, because the column lives in the driver's species
    table (tools/look/trees.mjs) and not in this file's."""
    for spec in specs:
        name, column, columns = spec.split(':')
        species = dict(SPECIES[name], name=name)
        export_models(species, 'summer', out, column=int(column), columns=int(columns))


def job_conifer(out, species_name, season):
    """The conifer's cells and impostors, from one grown tree: the whole-tree
    sprite, the top-down star the model's fans sample, the side cell and the
    sixteen-view impostor row."""
    species = dict(SPECIES[species_name], name=species_name)
    render_conifer_cells(species, season, out)
    render_conifer_impostors(species, season, out)


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    job = argv[0]
    out = argv[1]
    os.makedirs(out, exist_ok=True)
    if job == 'clumps':
        job_clumps(out, argv[2], argv[3])
    elif job == 'tree':
        job_tree(out, argv[2], argv[3], argv[4], argv[5], argv[6])
    elif job == 'bark':
        job_bark(out, argv[2])
    elif job == 'stumps':
        job_stumps(out)
    elif job == 'models':
        job_models(out, argv[2:])
    else:
        job_conifer(out, argv[2], argv[3])
    L.log('done', job)


if __name__ == '__main__':
    main()
