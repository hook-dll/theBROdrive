import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import { applyComicShading } from '../../render/comic';
import {
  applyBarkMapping,
  BARK_ROUGH_U,
  BARK_SMOOTH_U,
  BARK_TILE_AROUND_M,
  BARK_TILE_UP_M,
  leafAtlas,
  leafCellUv,
  SOLID_UV,
  type LeafSprite,
} from '../../render/leafpaint';
import { injectSeason, SEASON_TREE_RANDOM_GLSL, SNOW_GLSL } from '../../render/season';
import { TREE_KINDS, TreeKind, UNDERGROWTH_KIND_FROM, UNDERGROWTH_KIND_TO } from '../deserttiledata';
import type { Season } from '../landcover';

/**
 * THE WOOD'S TREES: low-poly silhouettes, built here, in the desert's language.
 *
 * Silhouette over detail. A spruce is known by its outline — tiers of ragged, drooping
 * skirts narrowing to a spire — not by a needle texture; a birch by its white trunk
 * with dark marks and an airy crown; a lime or an aspen by a round full crown. Every
 * face carries one flat colour in its vertices; the comic shading splits the light into
 * bands and the post pass inks the outline. No textures anywhere, so nothing reads as a
 * photograph and nothing crawls.
 *
 * Near and far are the same tree drawn from the same seeded shape: the near level has
 * rounder leaf masses, more trunk facets and the bark dashes; the far level keeps the
 * silhouette on a fraction of the triangles. The forest's impostors are baked from the
 * far level and take over past `IMPOSTOR_FROM_M` (world/forest.ts).
 */

export interface TreePart {
  /**
   * Wood and leaves in one geometry, so a tree is one draw per level, not two. The
   * `aWood` attribute (1 wood, 0 leaves) keeps the one difference the two parts had:
   * leaves take no shadow of their own (see `material`).
   */
  readonly geometry: THREE.BufferGeometry;
  readonly material: THREE.MeshStandardMaterial;
  /** Shadow material for the alpha-cut leaf cards: they cast their painted outline. */
  readonly depthMaterial: THREE.MeshDepthMaterial | null;
}

export type TreeLod = readonly TreePart[];

export interface TreeVariant {
  readonly near: TreeLod;
  readonly far: TreeLod;
}

/**
 * Trunk collider radius per kind at scale 1, metres, in `TreeKind` order; 0 for things
 * a car drives through.
 */
export const TREE_TRUNK_RADIUS: readonly number[] = [0.2, 0.26, 0, 0.3, 0.34, 0.2, 0.46, 0.26, 0.2, 0.4, 0.12, 0, 0, 0.3, 0, 0.42];

interface Palette {
  readonly spruce: readonly number[];
  readonly spruceUnder: number;
  readonly birchLeaf: readonly number[];
  readonly limeLeaf: readonly number[];
  readonly mapleLeaf: readonly number[];
  readonly bush: readonly number[];
  readonly pine: readonly number[];
  readonly aspenLeaf: readonly number[];
  readonly oakLeaf: readonly number[];
  readonly alderLeaf: readonly number[];
  readonly willowLeaf: readonly number[];
  readonly rowanLeaf: readonly number[];
  readonly fern: readonly number[];
  readonly juniper: readonly number[];
  /** Grey weathered wood, a stump's or a fallen trunk's. */
  readonly deadwood: number;
  /** A cut face, pale and warm. */
  readonly deadwoodCut: number;
  readonly moss: number;
  readonly birchBark: number;
  readonly birchGrey: number;
  readonly birchMark: number;
  readonly birchButt: number;
  readonly pineBark: number;
  /** Where the grey fissured foot gives way to the thin copper bark above. */
  readonly pineBarkMid: number;
  readonly pineBarkLow: number;
  readonly aspenBark: number;
  readonly aspenButt: number;
  readonly oakBark: number;
  readonly oakFissure: number;
  readonly alderBark: number;
  readonly willowBark: number;
  readonly willowFissure: number;
  readonly rowanBark: number;
  readonly rowanBerry: number;
  readonly twig: number;
  readonly trunk: number;
}

/**
 * Light, warm and few: the palette is part of the style. Each kind keeps a green of
 * its own, as it does in a real wood seen across a field — the pale yellow of birch,
 * aspen's grey, the dark of oak and alder, willow's silver, pine's blue.
 */
const PALETTES: Record<Season, Palette> = {
  summer: {
    // Olive-grey, never teal (docs/shishkin.md): 0x3f7a60 sat at 155 degrees and read
    // as plastic against every painted spruce.
    spruce: [0x557552, 0x62805b],
    spruceUnder: 0x4e6247,
    birchLeaf: [0xb0b56a, 0xa3a962, 0xbcbd76],
    limeLeaf: [0x829a52, 0x7b924d, 0x8aa25a],
    mapleLeaf: [0x92a64e, 0x899d49, 0x9cae58],
    bush: [0x7a8a4f, 0x73824a, 0x829256],
    // Lighter and warmer than spruce: a pine crown against the sky is olive, lit
    // through ("Rye", "Pines sunlit"), never the dark mass a spruce is.
    pine: [0x61744a, 0x6b7e52, 0x586a44],
    aspenLeaf: [0x9ba673, 0x919c6a, 0xa5ae7d],
    oakLeaf: [0x68803f, 0x61783a, 0x718a48],
    alderLeaf: [0x5e7644, 0x586e3f, 0x667f4b],
    willowLeaf: [0xabb18e, 0x9fa684, 0xb5ba99],
    rowanLeaf: [0x8a9e55, 0x80944f, 0x93a75e],
    fern: [0x7d9448, 0x87a052, 0x738a42],
    juniper: [0x55684c, 0x5e7253, 0x4d6045],
    deadwood: 0x8a7d6c,
    deadwoodCut: 0xc4a77c,
    moss: 0x6e7a46,
    // Grown birch is not snow-white: a creamy grey, patched greyer with lichen and
    // weather, and black and furrowed at the foot. Only a young one is white.
    birchBark: 0xcac6bb,
    birchGrey: 0x9d998f,
    birchMark: 0x35333a,
    birchButt: 0x5f5852,
    // Ochre-copper, not orange: Shishkin's pines glow where the sun is on them, and
    // the light does that, not the paint (docs/shishkin.md).
    pineBark: 0xb08058,
    pineBarkMid: 0x937262,
    pineBarkLow: 0x6e6159,
    aspenBark: 0xb6bea5,
    aspenButt: 0x55534e,
    oakBark: 0x857b6c,
    oakFissure: 0x463f3a,
    alderBark: 0x5f5c59,
    willowBark: 0x7e756a,
    willowFissure: 0x5c544b,
    rowanBark: 0x8a8279,
    rowanBerry: 0xe26a2c,
    twig: 0x5d5752,
    trunk: 0x7f756b,
  },
};

function hash2(x: number, y: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** One flat colour per face, from its centroid. Non-indexed, flat normals. */
function flatColour(g: THREE.BufferGeometry, colour: (x: number, y: number, z: number) => number): THREE.BufferGeometry {
  const geo = g.index ? g.toNonIndexed() : g;
  if (geo.getAttribute('uv')) geo.deleteAttribute('uv');
  const p = geo.getAttribute('position');
  const c = new Float32Array(p.count * 3);
  const col = new THREE.Color();
  for (let i = 0; i < p.count; i += 3) {
    const cx = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3;
    const cy = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3;
    const cz = (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3;
    col.setHex(colour(cx, cy, cz));
    for (let k = 0; k < 3; k++) c.set([col.r, col.g, col.b], (i + k) * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  geo.computeVertexNormals();
  return geo;
}

/**
 * A habit a spruce grows in. Twelve of them, because a wood of one spruce repeated is
 * not a wood: the trees differ in height first of all, then in where the crown begins,
 * how wide its skirts are, how uneven their gaps, how deep they hang and what became
 * of the top. Each variant is one habit built by the same code, and every level builds
 * the same habit (commit ddc13bc), so a tree keeps its shape as it hands over to its
 * impostor.
 */
interface SpruceHabit {
  /** For the docs and the tree lab. */
  readonly name: string;
  /** Height, metres, before the per-tree scale. */
  readonly height: readonly [number, number];
  /** Height of the lowest tier: the bare stem below it. */
  readonly skirt: number;
  /** Tiers, lowest and highest count. */
  readonly tiers: readonly [number, number];
  /** Spread of the gaps between tiers: 0 even, 1 gaps from twice to half the mean. */
  readonly uneven: number;
  /** Crown half-width at the foot, metres. */
  readonly width: readonly [number, number];
  /** Crown radius over height: 0.8 bulges the foot, 1.0 is near straight, 1.4 pinches. */
  readonly taper: number;
  /** How far a bough's tip falls over the tier below, in gaps between tiers: 1.0
   *  puts the tip level with the whorl below it, and the tiers just touch. */
  readonly droop: number;
  /** Boughs of a tier, low and high count. */
  readonly branches: readonly [number, number];
  /** Fraction of boughs missing: the holes a crown has. */
  readonly loss: number;
  /** Long boughs on the clear side: 1 even, 1.45 a tree grown at the edge of a wood. */
  readonly lean: number;
  /** How far the crown's axis bends toward the light: 0..0.5, over four metres. */
  readonly bend: number;
  /** How far the boughs lie toward the wind: 0..0.6 of the way. */
  readonly sweep: number;
  /** Where the lean, the bend and the wind point, degrees. */
  readonly toward: number;
  /** What became of the top. */
  readonly top: 'spire' | 'stub' | 'twin';
}

const SPRUCE_HABITS: readonly SpruceHabit[] = [
  // The spruce of a closed wood: tall, its crown starting low, tiers close and even.
  { name: 'ельник', height: [20, 26], skirt: 2.6, tiers: [13, 15], uneven: 0.35, width: [2.9, 3.3], taper: 1.05, droop: 0.85, branches: [6, 7], loss: 0.05, lean: 1.03, bend: 0.05, sweep: 0.05, toward: 0, top: 'spire' },
  // Grown in the open: short, a broad skirt of long boughs nearly to the ground.
  { name: 'выгон', height: [11, 14], skirt: 0.9, tiers: [11, 13], uneven: 0.45, width: [3.7, 4.3], taper: 0.8, droop: 1.0, branches: [7, 8], loss: 0.07, lean: 1.06, bend: 0.12, sweep: 0.08, toward: 60, top: 'spire' },
  // A thicket of young spruce: narrow, dense, a green cone head to foot.
  { name: 'молодняк', height: [6.5, 9.5], skirt: 0.5, tiers: [11, 13], uneven: 0.28, width: [1.7, 2.2], taper: 0.95, droop: 0.9, branches: [6, 7], loss: 0.04, lean: 1.02, bend: 0.06, sweep: 0.06, toward: 30, top: 'spire' },
  // Old: the lower tiers died off, and a bare grey stem stands five metres clear.
  { name: 'оголённый ствол', height: [21, 26], skirt: 5.0, tiers: [11, 13], uneven: 0.5, width: [3.4, 4.2], taper: 0.85, droop: 0.9, branches: [6, 8], loss: 0.08, lean: 1.08, bend: 0.16, sweep: 0.1, toward: 210, top: 'spire' },
  // At the edge of a wood: boughs long on the clear side and short in the shade, and
  // the crown's axis leaning after the light.
  { name: 'кривобокая', height: [15, 20], skirt: 1.7, tiers: [12, 14], uneven: 0.55, width: [3.0, 3.8], taper: 1.0, droop: 0.95, branches: [6, 7], loss: 0.1, lean: 1.45, bend: 0.4, sweep: 0.22, toward: 45, top: 'spire' },
  // On a ridge: every bough laid the way the wind blows, the crown streaming aside.
  { name: 'ветровая', height: [13, 18], skirt: 1.5, tiers: [12, 14], uneven: 0.55, width: [2.8, 3.4], taper: 1.1, droop: 1.0, branches: [6, 7], loss: 0.12, lean: 1.3, bend: 0.3, sweep: 0.5, toward: 300, top: 'spire' },
  // The weeping spruce: narrow, and every tier hangs far below its whorl.
  { name: 'плакучая', height: [14, 18], skirt: 1.2, tiers: [10, 12], uneven: 0.5, width: [2.9, 3.5], taper: 1.35, droop: 1.45, branches: [6, 7], loss: 0.08, lean: 1.05, bend: 0.1, sweep: 0.08, toward: 90, top: 'spire' },
  // Grown in the shade: thin, sparse, the boughs reaching out for the light.
  { name: 'теневая', height: [11, 15], skirt: 1.1, tiers: [8, 10], uneven: 0.6, width: [1.6, 2.0], taper: 1.2, droop: 0.85, branches: [5, 6], loss: 0.34, lean: 1.08, bend: 0.15, sweep: 0.15, toward: 150, top: 'spire' },
  // On bog and in wet ground: short, thin, ragged, the tiers far apart.
  { name: 'болотная', height: [8, 12], skirt: 1.4, tiers: [9, 11], uneven: 0.7, width: [2.0, 2.6], taper: 1.15, droop: 1.0, branches: [5, 6], loss: 0.3, lean: 1.05, bend: 0.12, sweep: 0.2, toward: 240, top: 'spire' },
  // Twinned: frost or a bud took the leader, and two tops grew.
  { name: 'двухвершинная', height: [16, 21], skirt: 1.8, tiers: [12, 14], uneven: 0.45, width: [3.0, 3.8], taper: 1.0, droop: 0.9, branches: [6, 7], loss: 0.1, lean: 1.12, bend: 0.2, sweep: 0.12, toward: 0, top: 'twin' },
  // Broken: the top snapped under wet snow, and a blunt ring of boughs is what is left.
  { name: 'сломанная', height: [12, 17], skirt: 1.6, tiers: [11, 13], uneven: 0.5, width: [2.8, 3.6], taper: 1.0, droop: 0.95, branches: [6, 7], loss: 0.12, lean: 1.15, bend: 0.25, sweep: 0.18, toward: 120, top: 'stub' },
  // The dark spruce of a damp gully: many tiers, dense boughs, near black.
  { name: 'глухая', height: [15, 19], skirt: 1.2, tiers: [14, 16], uneven: 0.28, width: [2.8, 3.4], taper: 1.15, droop: 0.8, branches: [7, 8], loss: 0.03, lean: 1.02, bend: 0.08, sweep: 0.05, toward: 200, top: 'spire' },
];

/** What became of a tree's top. */
type HabitTop = 'whole' | 'broken' | 'twin' | 'flat' | 'droop' | 'layered';

/**
 * A habit of growth: what one tree of a kind is that its neighbour is not. Every kind
 * reads the fields that mean anything to it and ignores the rest, so the tables stay
 * comparable across species and a reader can see what a kind varies (docs/research-
 * 2026-09-26.md, §6.6).
 *
 *   height  metres at scale 1                crown  where the crown starts, of height
 *   width   crown half-width, metres         tall   crown half-height over half-width
 *   stems   stems from one foot              lean   0 upright, 1 a real lean
 *   gaps    share of the crown's masses gone hang   share of branches that hang
 *   taper   1 a cone, .5 a dome, 0 flat      top    what became of the top
 *   limbs   limbs, of the count the kind usually grows
 *   girth   trunk radius multiplier
 */
interface Habit {
  readonly name: string;
  readonly height: readonly [number, number];
  readonly crown: readonly [number, number];
  readonly width: readonly [number, number];
  readonly tall: number;
  readonly stems: number;
  readonly lean: number;
  readonly gaps: number;
  readonly hang: number;
  readonly taper: number;
  readonly top: HabitTop;
  readonly limbs: number;
  readonly girth: number;
}

const HABIT_DEFAULTS: Habit = {
  name: '',
  height: [12, 16],
  crown: [0.32, 0.42],
  width: [2.0, 2.8],
  tall: 1,
  stems: 1,
  lean: 0,
  gaps: 0,
  hang: 0,
  taper: 0.7,
  top: 'whole',
  limbs: 1,
  girth: 1,
};

/** A table is written as the differences from `HABIT_DEFAULTS`: only what a habit changes. */
function habits(rows: readonly (Partial<Habit> & { readonly name: string })[]): readonly Habit[] {
  return rows.map((row) => ({ ...HABIT_DEFAULTS, ...row }));
}

/**
 * Scots pines of the middle belt. In a bor a pine is a mast: a bare stem clean to
 * two-thirds, grey below and copper above, and a flat crown of dark plates on
 * upswept limbs at the very top. In the open it is Shishkin's "Rye" pine: stout,
 * crowned from a third up, its low limbs sagging. On bog it is short and crooked;
 * a burnt pine keeps only a stem and its whorls of dead stubs.
 */
const PINE_HABITS: readonly Habit[] = habits([
  { name: 'бор', height: [20, 26], crown: [0.62, 0.7], width: [2.6, 3.2], tall: 0.5, taper: 0.55, top: 'flat', limbs: 0.9, girth: 1.35 },
  { name: 'бор, старая', height: [24, 29], crown: [0.68, 0.76], width: [3.0, 3.8], tall: 0.45, taper: 0.45, top: 'flat', limbs: 1.1, girth: 1.6 },
  { name: 'молодая, конус', height: [8, 12], crown: [0.22, 0.3], width: [1.5, 2.0], tall: 1.5, taper: 1.2, top: 'whole', limbs: 1.15, girth: 0.7 },
  { name: 'на просторе', height: [15, 19], crown: [0.3, 0.38], width: [4.6, 5.6], tall: 0.6, taper: 0.5, top: 'flat', limbs: 1.5, girth: 1.25, hang: 0.5 },
  { name: 'лира', height: [18, 23], crown: [0.6, 0.68], width: [2.8, 3.4], tall: 0.5, taper: 0.5, top: 'twin', limbs: 0.95, girth: 1.2 },
  { name: 'наклонная', height: [17, 22], crown: [0.58, 0.66], width: [2.6, 3.2], tall: 0.5, taper: 0.5, top: 'flat', lean: 0.6, limbs: 0.9, girth: 1.2 },
  { name: 'сломанная', height: [10, 15], crown: [0.4, 0.5], width: [2.2, 2.8], tall: 0.55, taper: 0.5, top: 'broken', limbs: 1.0, girth: 1.1 },
  { name: 'низкая, ветровая', height: [11, 15], crown: [0.45, 0.55], width: [2.4, 3.0], tall: 0.55, taper: 0.5, top: 'flat', lean: 0.4, limbs: 1.1, girth: 1.0, hang: 0.25 },
  { name: 'болотная', height: [6, 10], crown: [0.2, 0.32], width: [1.6, 2.2], tall: 0.75, taper: 0.9, top: 'layered', gaps: 0.3, limbs: 0.65, girth: 0.6 },
  { name: 'подсвечник', height: [7, 12], crown: [0.85, 0.95], width: [0.6, 1.0], tall: 0.5, taper: 0.3, top: 'layered', gaps: 0.55, limbs: 0.3, girth: 0.8 },
  { name: 'редкая, теневая', height: [16, 21], crown: [0.5, 0.6], width: [2.0, 2.6], tall: 0.7, taper: 0.8, top: 'layered', gaps: 0.4, limbs: 0.6, girth: 0.85 },
]);

/** Pines of the open field: the same habit table read with `open` set (a low, wide crown). */
const FIELD_PINE_HABITS: readonly Habit[] = habits([
  { name: 'поле, широкая', height: [13, 17], crown: [0.26, 0.34], width: [4.4, 5.4], tall: 0.6, taper: 0.5, top: 'flat', limbs: 1.5, girth: 1.2, hang: 0.5 },
  { name: 'поле, низкая', height: [9, 12], crown: [0.2, 0.28], width: [3.6, 4.6], tall: 0.65, taper: 0.55, top: 'flat', limbs: 1.4, girth: 1.0, hang: 0.6 },
  { name: 'поле, высокая', height: [16, 20], crown: [0.34, 0.42], width: [4.0, 5.0], tall: 0.55, taper: 0.5, top: 'flat', limbs: 1.4, girth: 1.35, hang: 0.4 },
  { name: 'поле, лира', height: [12, 16], crown: [0.28, 0.36], width: [4.0, 5.0], tall: 0.6, taper: 0.5, top: 'twin', limbs: 1.5, girth: 1.1, hang: 0.5 },
  { name: 'поле, наклонная', height: [12, 16], crown: [0.26, 0.34], width: [4.2, 5.2], tall: 0.6, taper: 0.5, top: 'flat', lean: 0.7, limbs: 1.4, girth: 1.15, hang: 0.5 },
  { name: 'поле, сломанная', height: [8, 12], crown: [0.3, 0.4], width: [3.4, 4.2], tall: 0.6, taper: 0.5, top: 'broken', limbs: 1.3, girth: 1.05, hang: 0.5 },
  { name: 'поле, редкая', height: [11, 15], crown: [0.24, 0.32], width: [3.8, 4.8], tall: 0.65, taper: 0.55, top: 'layered', gaps: 0.35, limbs: 1.2, girth: 0.95, hang: 0.45 },
  { name: 'поле, кривая', height: [10, 14], crown: [0.22, 0.3], width: [3.4, 4.4], tall: 0.7, taper: 0.6, top: 'flat', lean: 0.9, gaps: 0.15, limbs: 1.35, girth: 0.9, hang: 0.55 },
  { name: 'поле, старая', height: [17, 22], crown: [0.36, 0.44], width: [4.6, 5.6], tall: 0.5, taper: 0.45, top: 'flat', limbs: 1.6, girth: 1.5, hang: 0.35 },
  { name: 'поле, тонкая', height: [9, 13], crown: [0.3, 0.4], width: [3.0, 3.8], tall: 0.8, taper: 0.7, top: 'droop', gaps: 0.25, limbs: 1.1, girth: 0.8, hang: 0.7 },
]);

/**
 * Birches. A silver birch is a white stem and a crown that does not close: thin limbs,
 * hanging twigs and sky between the masses. In a closed stand it is a slender mast with
 * a small high crown; in the open, a broad tree with a skirt down to eye level. Clumps
 * of two or three stems from one root are what grows where a birch was cut, and old
 * trees fork, lose the leader, or are broken by ice.
 */
const BIRCH_HABITS: readonly Habit[] = habits([
  { name: 'лесная, тонкая', height: [15, 19], crown: [0.34, 0.42], width: [1.7, 2.2], taper: 0.3, limbs: 1.0, hang: 0.4, girth: 0.8 },
  { name: 'повислая', height: [13, 17], crown: [0.26, 0.34], width: [2.4, 3.0], taper: 0.35, limbs: 0.95, hang: 0.85, gaps: 0.1 },
  { name: 'на просторе', height: [12, 16], crown: [0.2, 0.28], width: [3.2, 4.0], taper: 0.6, limbs: 1.4, hang: 0.55 },
  { name: 'куст из трёх стволов', height: [9, 13], crown: [0.3, 0.4], width: [2.4, 3.0], stems: 3, taper: 0.6, limbs: 1.2, hang: 0.5, girth: 0.6 },
  { name: 'два ствола', height: [12, 16], crown: [0.3, 0.38], width: [2.2, 2.8], stems: 2, taper: 0.5, limbs: 1.1, hang: 0.5, girth: 0.8 },
  { name: 'старая, чёрный низ', height: [18, 23], crown: [0.4, 0.48], width: [2.2, 2.8], taper: 0.45, limbs: 0.9, hang: 0.45, girth: 1.3 },
  { name: 'раздвоенная', height: [14, 19], crown: [0.3, 0.4], width: [2.2, 2.8], taper: 0.5, top: 'twin', limbs: 1.0, hang: 0.5 },
  { name: 'сломанная', height: [10, 14], crown: [0.25, 0.35], width: [2.0, 2.6], taper: 0.5, top: 'broken', limbs: 1.2, hang: 0.4 },
  { name: 'кривая, у дороги', height: [11, 16], crown: [0.3, 0.4], width: [2.0, 2.6], taper: 0.45, lean: 0.8, limbs: 1.1, hang: 0.6 },
  { name: 'редкая, в тени', height: [14, 18], crown: [0.5, 0.58], width: [1.6, 2.1], taper: 0.5, limbs: 0.7, hang: 0.35, gaps: 0.4 },
  { name: 'молодая чаща', height: [8, 12], crown: [0.18, 0.26], width: [1.5, 2.0], taper: 0.35, limbs: 1.1, hang: 0.3, girth: 0.55 },
]);

/**
 * Aspens. A straight pale stem clean to half its height, and a dense narrow crown of
 * grey-green that is rounder and fuller than a birch's — and, unlike a birch, does not
 * hang. Old aspens are hollow, broken, or forked.
 */
const ASPEN_HABITS: readonly Habit[] = habits([
  { name: 'лесная', height: [16, 21], crown: [0.5, 0.58], width: [1.8, 2.3], taper: 0.5, limbs: 1.0 },
  { name: 'широкая', height: [14, 18], crown: [0.42, 0.5], width: [2.6, 3.2], taper: 0.6, limbs: 1.3 },
  { name: 'высокая, чистая', height: [20, 25], crown: [0.6, 0.68], width: [1.7, 2.2], taper: 0.45, limbs: 0.85, girth: 1.2 },
  { name: 'раздвоенная', height: [15, 19], crown: [0.45, 0.55], width: [2.0, 2.6], taper: 0.5, top: 'twin', limbs: 1.05 },
  { name: 'сломанная, дуплистая', height: [10, 14], crown: [0.35, 0.45], width: [2.0, 2.6], taper: 0.6, top: 'broken', limbs: 1.2, girth: 1.15 },
  { name: 'кривая', height: [12, 17], crown: [0.45, 0.55], width: [2.0, 2.6], taper: 0.5, lean: 0.7, limbs: 1.0 },
  { name: 'редкая, теневая', height: [13, 17], crown: [0.55, 0.65], width: [1.6, 2.1], taper: 0.5, limbs: 0.7, gaps: 0.35 },
  { name: 'молодая', height: [7, 11], crown: [0.25, 0.35], width: [1.3, 1.8], taper: 0.4, limbs: 1.1, girth: 0.5 },
  { name: 'толстая, старая', height: [18, 23], crown: [0.5, 0.6], width: [2.2, 2.8], taper: 0.55, limbs: 1.0, girth: 1.5 },
  { name: 'придорожная', height: [13, 18], crown: [0.42, 0.52], width: [2.2, 2.8], taper: 0.55, lean: 0.5, limbs: 1.15, gaps: 0.15 },
]);

/**
 * Oaks. Grown in the open an oak is a broad crooked tent of heavy limbs, wider than it
 * is tall; in a closed stand it is a tall straight mast with a small high crown. A
 * pollarded or an old, hollow oak is what stands in a village.
 */
const OAK_HABITS: readonly Habit[] = habits([
  { name: 'шатёр', height: [11, 14], crown: [0.3, 0.38], width: [4.6, 5.6], tall: 0.85, taper: 0.75, top: 'flat', limbs: 1.2 },
  { name: 'дубрава, узкий', height: [18, 23], crown: [0.45, 0.55], width: [2.8, 3.4], tall: 1.1, taper: 0.5, limbs: 0.9, girth: 0.9 },
  { name: 'высокий шатёр', height: [16, 20], crown: [0.32, 0.4], width: [5.0, 6.2], tall: 0.7, taper: 0.8, top: 'flat', limbs: 1.3, girth: 1.2 },
  { name: 'корявый', height: [9, 13], crown: [0.24, 0.34], width: [4.2, 5.2], tall: 0.8, taper: 0.8, top: 'flat', lean: 0.5, gaps: 0.2, limbs: 1.4 },
  { name: 'сломанный', height: [8, 12], crown: [0.4, 0.5], width: [3.4, 4.2], tall: 0.7, taper: 0.7, top: 'broken', limbs: 1.5, girth: 1.3 },
  { name: 'раздвоенный', height: [12, 16], crown: [0.3, 0.4], width: [4.0, 4.8], tall: 0.85, taper: 0.75, top: 'twin', limbs: 1.15 },
  { name: 'наклонный', height: [11, 15], crown: [0.28, 0.36], width: [4.2, 5.2], tall: 0.8, taper: 0.75, lean: 0.9, limbs: 1.25 },
  { name: 'редкий, клён-дуб', height: [13, 17], crown: [0.4, 0.5], width: [3.4, 4.2], tall: 0.9, taper: 0.7, gaps: 0.35, limbs: 0.9 },
  { name: 'толстый, старый', height: [13, 17], crown: [0.26, 0.34], width: [5.2, 6.4], tall: 0.75, taper: 0.8, top: 'flat', limbs: 1.4, girth: 1.9 },
  { name: 'низкий, выпас', height: [6, 9], crown: [0.2, 0.3], width: [3.6, 4.6], tall: 0.8, taper: 0.8, top: 'flat', limbs: 1.5, girth: 1.6, gaps: 0.15 },
]);

/**
 * Willows, the rakita of ditches: a short thick leaning trunk that breaks into a
 * fountain of upswept limbs. The white willow hangs its long shoots; the brittle
 * willow is broad and rank; a pollarded one is a knot with brooms.
 */
const WILLOW_HABITS: readonly Habit[] = habits([
  { name: 'белая, плакучая', height: [9, 12], crown: [0.2, 0.3], width: [3.6, 4.4], taper: 0.5, hang: 0.9, limbs: 1.1 },
  { name: 'ракita у канавы', height: [7, 10], crown: [0.25, 0.35], width: [3.0, 3.8], taper: 0.6, lean: 0.5, limbs: 1.0 },
  { name: 'широкая, ломкая', height: [10, 14], crown: [0.22, 0.3], width: [4.4, 5.4], taper: 0.7, limbs: 1.4 },
  { name: 'старая, дуплистая', height: [8, 12], crown: [0.24, 0.32], width: [4.0, 5.0], taper: 0.6, top: 'flat', limbs: 1.2, girth: 1.6 },
  { name: 'сломанная', height: [5, 8], crown: [0.3, 0.42], width: [3.0, 4.0], taper: 0.7, top: 'broken', limbs: 1.3, girth: 1.2 },
  { name: 'куст из стволов', height: [6, 9], crown: [0.2, 0.3], width: [3.4, 4.4], stems: 3, taper: 0.6, limbs: 1.2, girth: 0.7 },
  { name: 'наклонная над водой', height: [7, 11], crown: [0.2, 0.3], width: [3.6, 4.6], taper: 0.55, lean: 1.1, hang: 0.5, limbs: 1.2 },
  { name: 'низкая, стриженая', height: [4, 6], crown: [0.2, 0.3], width: [2.8, 3.6], taper: 0.8, top: 'flat', limbs: 1.5, girth: 1.4 },
  { name: 'редкая', height: [8, 12], crown: [0.3, 0.4], width: [2.8, 3.6], taper: 0.6, gaps: 0.4, limbs: 0.8 },
  { name: 'молодая, тонкая', height: [5, 8], crown: [0.25, 0.35], width: [2.2, 3.0], taper: 0.5, limbs: 1.0, girth: 0.5, hang: 0.4 },
]);

/**
 * Alder and rowan: the alder of wet ground, often two or three stems and always slight
 * of crown; the rowan of a wood's edge, small, open, with its berries.
 */
const ALDER_HABITS: readonly Habit[] = habits([
  { name: 'ольшаник, один ствол', height: [11, 15], crown: [0.3, 0.38], width: [2.0, 2.6], taper: 0.35 },
  { name: 'два ствола', height: [9, 13], crown: [0.3, 0.4], width: [2.2, 2.8], stems: 2, taper: 0.4 },
  { name: 'три ствола', height: [8, 12], crown: [0.28, 0.38], width: [2.4, 3.0], stems: 3, taper: 0.4, girth: 0.7 },
  { name: 'высокая', height: [15, 19], crown: [0.35, 0.45], width: [2.0, 2.6], taper: 0.3, girth: 1.2 },
  { name: 'наклонная над водой', height: [10, 14], crown: [0.28, 0.36], width: [2.2, 2.8], taper: 0.4, lean: 0.9 },
  { name: 'сломанная', height: [7, 11], crown: [0.4, 0.5], width: [2.0, 2.6], taper: 0.5, top: 'broken', gaps: 0.2 },
  { name: 'раздвоенная', height: [11, 15], crown: [0.32, 0.4], width: [2.2, 2.8], top: 'twin', taper: 0.35 },
  { name: 'редкая, в тени', height: [9, 13], crown: [0.4, 0.5], width: [1.8, 2.4], taper: 0.4, gaps: 0.4, limbs: 0.8 },
  { name: 'низкая, болотная', height: [6, 9], crown: [0.25, 0.35], width: [2.0, 2.6], taper: 0.5, girth: 0.6 },
  { name: 'толстая, старая', height: [12, 16], crown: [0.3, 0.4], width: [2.6, 3.2], taper: 0.35, girth: 1.6, stems: 2 },
]);

const ROWAN_HABITS: readonly Habit[] = habits([
  { name: 'у опушки', height: [6, 8], crown: [0.4, 0.48], width: [1.4, 1.8], taper: 0.5 },
  { name: 'два ствола', height: [5, 7], crown: [0.38, 0.48], width: [1.5, 1.9], stems: 2, taper: 0.5 },
  { name: 'три ствола', height: [4.5, 6.5], crown: [0.35, 0.45], width: [1.5, 2.0], stems: 3, taper: 0.5, girth: 0.7 },
  { name: 'высокая, тонкая', height: [8, 10], crown: [0.45, 0.55], width: [1.3, 1.7], taper: 0.4, girth: 0.8 },
  { name: 'широкая', height: [5, 7], crown: [0.3, 0.4], width: [1.9, 2.4], taper: 0.7, limbs: 1.3 },
  { name: 'кривая', height: [5, 7], crown: [0.35, 0.45], width: [1.5, 2.0], lean: 0.9, taper: 0.5 },
  { name: 'сломанная', height: [3.5, 5.5], crown: [0.4, 0.5], width: [1.4, 1.8], top: 'broken', taper: 0.6 },
  { name: 'раздвоенная', height: [5, 7], crown: [0.38, 0.48], width: [1.5, 1.9], top: 'twin', taper: 0.5 },
  { name: 'редкая, в тени', height: [6, 8], crown: [0.5, 0.6], width: [1.2, 1.6], gaps: 0.4, limbs: 0.7, taper: 0.4 },
  { name: 'низкая, у пня', height: [3, 4.5], crown: [0.3, 0.4], width: [1.3, 1.7], limbs: 1.2, taper: 0.6 },
]);

/**
 * Undergrowth and the floor. A hazel-and-willow bush, a bracken clump, a juniper, a
 * stump and a fallen trunk: small things, but the same rule — sixteen of one shape is
 * not a wood's floor.
 */
const BUSH_HABITS: readonly Habit[] = habits([
  { name: 'лещина, куст', height: [2.4, 3.4], crown: [0.1, 0.2], width: [1.5, 2.0], taper: 0.6, stems: 5 },
  { name: 'низкий, стелющийся', height: [1.2, 1.8], crown: [0.1, 0.2], width: [1.4, 1.9], taper: 0.8, stems: 6 },
  { name: 'высокий, вытянутый', height: [3.2, 4.4], crown: [0.08, 0.16], width: [1.2, 1.6], taper: 0.4, stems: 3 },
  { name: 'широкий, в поле', height: [1.8, 2.6], crown: [0.12, 0.22], width: [2.0, 2.6], taper: 0.9, stems: 4 },
  { name: 'редкий', height: [2.0, 3.0], crown: [0.15, 0.25], width: [1.4, 1.9], taper: 0.6, gaps: 0.4, stems: 3 },
  { name: 'ивняк, прутья', height: [2.6, 3.6], crown: [0.06, 0.14], width: [1.3, 1.7], taper: 0.3, stems: 7, hang: 0.5 },
  { name: 'один стволик', height: [2.2, 3.2], crown: [0.2, 0.3], width: [1.3, 1.7], taper: 0.5, stems: 1 },
  { name: 'сломанный', height: [1.4, 2.2], crown: [0.2, 0.3], width: [1.5, 2.0], taper: 0.7, top: 'broken', stems: 4 },
  { name: 'двойной', height: [2.0, 3.0], crown: [0.12, 0.2], width: [1.8, 2.4], taper: 0.7, top: 'twin', stems: 4 },
  { name: 'наклонный', height: [1.8, 2.8], crown: [0.1, 0.2], width: [1.6, 2.1], taper: 0.6, lean: 0.9, stems: 3 },
]);

/**
 * Lime and maple: two species of one build (a full crown on a short stem), told apart
 * by proportion and by what the crown does. A lime is an egg with a skirt of low
 * branches and the densest shade in the wood; a maple is wider than tall, with limbs
 * showing under it. Both are cut, coppiced, broken and grown in the open.
 */
const LIME_HABITS: readonly Habit[] = habits([
  { name: 'липа, яйцо', height: [13, 17], crown: [0.3, 0.38], width: [3.0, 3.8], tall: 1.35, taper: 0.8, limbs: 1.0 },
  { name: 'с юбкой', height: [11, 15], crown: [0.18, 0.26], width: [3.2, 4.0], tall: 1.2, taper: 0.85, limbs: 1.3 },
  { name: 'высокая, узкая', height: [16, 20], crown: [0.4, 0.48], width: [2.4, 3.0], tall: 1.6, taper: 0.6, limbs: 0.9 },
  { name: 'широкая', height: [10, 14], crown: [0.26, 0.34], width: [4.0, 5.0], tall: 1.0, taper: 0.9, limbs: 1.2 },
  { name: 'раздвоенная', height: [12, 16], crown: [0.3, 0.4], width: [3.0, 3.8], tall: 1.3, top: 'twin', taper: 0.8 },
  { name: 'сломанная', height: [8, 12], crown: [0.4, 0.5], width: [3.0, 3.8], tall: 1.1, top: 'broken', taper: 0.85, limbs: 1.25 },
  { name: 'кривая', height: [11, 15], crown: [0.28, 0.36], width: [3.0, 3.8], tall: 1.25, lean: 0.8, taper: 0.8 },
  { name: 'редкая, в тени', height: [14, 18], crown: [0.45, 0.55], width: [2.4, 3.0], tall: 1.4, gaps: 0.4, limbs: 0.7, taper: 0.7 },
  { name: 'подрост, куст', height: [4, 7], crown: [0.16, 0.24], width: [2.0, 2.6], tall: 1.1, taper: 0.75, limbs: 1.3, girth: 0.6 },
  { name: 'толстая, старая', height: [15, 19], crown: [0.24, 0.32], width: [3.6, 4.4], tall: 1.3, taper: 0.85, girth: 1.7, limbs: 1.1 },
]);

const MAPLE_HABITS: readonly Habit[] = habits([
  { name: 'клён, шар', height: [10, 13], crown: [0.28, 0.36], width: [3.4, 4.2], tall: 0.95, taper: 0.85 },
  { name: 'высокий', height: [14, 18], crown: [0.4, 0.5], width: [3.2, 4.0], tall: 1.15, taper: 0.7 },
  { name: 'широкий', height: [9, 12], crown: [0.24, 0.32], width: [4.4, 5.4], tall: 0.8, taper: 0.9, limbs: 1.25 },
  { name: 'с ветвями', height: [11, 15], crown: [0.3, 0.4], width: [3.6, 4.4], tall: 1.0, taper: 0.85, limbs: 1.4 },
  { name: 'раздвоенный', height: [11, 14], crown: [0.3, 0.4], width: [3.4, 4.2], tall: 1.0, top: 'twin', taper: 0.85 },
  { name: 'сломанный', height: [7, 10], crown: [0.4, 0.5], width: [3.0, 3.8], tall: 0.9, top: 'broken', taper: 0.9, limbs: 1.3 },
  { name: 'наклонный', height: [10, 13], crown: [0.26, 0.34], width: [3.4, 4.2], tall: 0.95, lean: 0.85, taper: 0.85 },
  { name: 'редкий, в тени', height: [12, 16], crown: [0.5, 0.6], width: [2.8, 3.4], tall: 1.1, gaps: 0.4, limbs: 0.7, taper: 0.75 },
  { name: 'подрост', height: [4, 7], crown: [0.18, 0.26], width: [2.2, 2.8], tall: 1.0, taper: 0.8, limbs: 1.3, girth: 0.6 },
  { name: 'толстый, старый', height: [13, 17], crown: [0.24, 0.32], width: [4.0, 4.8], tall: 1.0, taper: 0.9, girth: 1.7 },
]);

/**
 * The floor and the undergrowth: bracken, juniper, stumps and fallen trunks. Their
 * habits are the things a wood's floor is: fresh cut and grey, broken, twin, burnt,
 * mossy, uprooted, split, leaning, a clump of two or three.
 */
const FERN_HABITS: readonly Habit[] = habits([
  { name: 'орляк, высокий', height: [1.1, 1.5], width: [0.34, 0.44], taper: 0.9, limbs: 1.1 },
  { name: 'орляк, широкий', height: [0.9, 1.3], width: [0.44, 0.56], taper: 1.1, limbs: 1.3, hang: 0.5 },
  { name: 'низкий, у дороги', height: [0.5, 0.8], width: [0.3, 0.4], taper: 1.0, limbs: 1.2 },
  { name: 'щитовник, узкий', height: [0.7, 1.0], width: [0.2, 0.28], taper: 0.7, limbs: 1.0 },
  { name: 'редкий', height: [0.8, 1.2], width: [0.3, 0.42], taper: 1.0, gaps: 0.4, limbs: 0.8 },
  { name: 'сломанный, прибитый', height: [0.4, 0.7], width: [0.34, 0.46], taper: 1.3, limbs: 1.2, hang: 0.8 },
  { name: 'молодой завиток', height: [0.3, 0.5], width: [0.18, 0.26], taper: 0.8, limbs: 1.0 },
  { name: 'двойной куст', height: [0.7, 1.1], width: [0.36, 0.48], taper: 1.15, top: 'twin', limbs: 1.4 },
  { name: 'наклонный', height: [0.6, 1.0], width: [0.3, 0.42], taper: 1.0, lean: 0.9, limbs: 1.1 },
  { name: 'густой, в тени', height: [0.9, 1.4], width: [0.3, 0.4], taper: 0.85, limbs: 1.5 },
]);

const JUNIPER_HABITS: readonly Habit[] = habits([
  { name: 'столбик', height: [2.6, 3.6], width: [0.5, 0.65], taper: 0.45 },
  { name: 'низкий, стелющийся', height: [1.0, 1.6], width: [0.7, 0.95], taper: 0.9, top: 'flat' },
  { name: 'высокий, тонкий', height: [3.6, 5.0], width: [0.45, 0.6], taper: 0.3 },
  { name: 'широкий', height: [1.8, 2.6], width: [0.85, 1.1], taper: 0.7, limbs: 1.3 },
  { name: 'раздвоенный', height: [2.2, 3.2], width: [0.6, 0.8], taper: 0.5, top: 'twin' },
  { name: 'сломанный', height: [1.2, 2.0], width: [0.55, 0.75], taper: 0.6, top: 'broken' },
  { name: 'кривой', height: [2.0, 3.0], width: [0.55, 0.75], taper: 0.5, lean: 0.9 },
  { name: 'редкий', height: [1.6, 2.6], width: [0.5, 0.7], taper: 0.6, gaps: 0.4, limbs: 0.7 },
  { name: 'молодой', height: [0.7, 1.2], width: [0.35, 0.5], taper: 0.5, limbs: 0.8, girth: 0.6 },
  { name: 'два стволика', height: [1.8, 2.8], width: [0.6, 0.85], taper: 0.6, stems: 2 },
]);

const STUMP_HABITS: readonly Habit[] = habits([
  { name: 'свежий рез', height: [0.35, 0.55], width: [0.28, 0.36], crown: [0.75, 0.95], girth: 1.0 },
  { name: 'старый, серый', height: [0.2, 0.4], width: [0.3, 0.4], crown: [0.05, 0.2], taper: 0.4 },
  { name: 'высокий пень', height: [0.8, 1.3], width: [0.24, 0.32], crown: [0.6, 0.85], taper: 0.9 },
  { name: 'низкий, вросший', height: [0.12, 0.25], width: [0.34, 0.44], crown: [0.1, 0.3], taper: 0.3 },
  { name: 'толстый', height: [0.4, 0.7], width: [0.42, 0.55], crown: [0.6, 0.9], girth: 1.6 },
  { name: 'расколотый', height: [0.4, 0.8], width: [0.3, 0.4], crown: [0.2, 0.4], top: 'broken', taper: 0.7 },
  { name: 'сломанный', height: [0.5, 0.9], width: [0.26, 0.34], crown: [0.15, 0.35], top: 'broken', taper: 0.8 },
  { name: 'двойной', height: [0.3, 0.6], width: [0.24, 0.32], crown: [0.5, 0.8], top: 'twin', stems: 2 },
  { name: 'наклонный', height: [0.3, 0.6], width: [0.28, 0.38], crown: [0.4, 0.7], lean: 0.9 },
  { name: 'обгоревший', height: [0.3, 0.7], width: [0.26, 0.36], crown: [0.05, 0.2], taper: 0.2, gaps: 0.6 },
]);

const LOG_HABITS: readonly Habit[] = habits([
  { name: 'бурелом, длинный', height: [7, 11], width: [0.2, 0.28], taper: 0.5 },
  { name: 'короткий обрубок', height: [2.5, 4], width: [0.22, 0.3], taper: 0.7 },
  { name: 'тонкий, жердь', height: [6, 10], width: [0.12, 0.18], taper: 0.4, girth: 0.6 },
  { name: 'толстый, комель', height: [5, 8], width: [0.34, 0.46], taper: 0.5, girth: 1.6 },
  { name: 'с сучьями', height: [5, 9], width: [0.2, 0.3], taper: 0.5, limbs: 1.8 },
  { name: 'голый', height: [4, 8], width: [0.18, 0.26], taper: 0.5, limbs: 0.3 },
  { name: 'наклонный, в яме', height: [4, 7], width: [0.2, 0.3], taper: 0.5, lean: 0.8 },
  { name: 'расколотый', height: [3, 6], width: [0.24, 0.34], taper: 0.6, top: 'broken' },
  { name: 'два ствола', height: [5, 9], width: [0.18, 0.26], taper: 0.5, stems: 2 },
  { name: 'короткий, сломанный', height: [1.8, 3], width: [0.2, 0.3], taper: 0.8, top: 'broken', limbs: 1.4 },
]);

/**
 * A spruce: a slim stem, then tiers of drooping boughs — cards painted with spruce
 * sprays (render/leafpaint.ts) — shortening to a spire.
 *
 * Nothing solid stands inside it. A dark cone of mesh used to: it read as what it was,
 * a smooth surface wherever the boughs left a gap, with its rim the one straight line
 * in a ragged tree, and above the top tier it stood bare as the dark spike the eye took
 * for the cone of the trunk. In its place a few ragged cards hang inside the crown.
 * They have no outline to follow, they wear the boughs' own colour family, and they
 * take the crown's lighting (`finishCrown`), so a gap between tiers opens on depth.
 *
 * Tiers stand at uneven heights. Even ones stack into a cone, and the eye reads the
 * straight line of their tips instead of counting tiers — which is what made a spruce
 * of one silhouette repeated look like a cone with boughs stuck on it.
 */
function spruceGeometry(seed: number, pal: Palette, near: boolean, habit: SpruceHabit): TreeShape {
  const rnd = (i: number): number => hash2(seed * 31 + i, seed * 7 - i);
  const H = habit.height[0] + rnd(1) * (habit.height[1] - habit.height[0]);
  const skirt = habit.skirt * (0.88 + rnd(2) * 0.24);
  const span = H - skirt - 1.1;
  const low = habit.tiers[0];
  const whorls = low + Math.floor(rnd(0) * (habit.tiers[1] - low + 1));
  const toward = (habit.toward * Math.PI) / 180;
  const leanX = Math.cos(toward);
  const leanZ = Math.sin(toward);
  const sideX = -leanZ;
  const sideZ = leanX;
  // Tier heights: gaps drawn one by one and then stretched over the crown's span, so
  // the ladder stays inside the tree whatever the draws come out like.
  const gaps: number[] = [];
  let drawn = 0;
  for (let t = 0; t < whorls; t++) {
    const g = 1 + (rnd(t + 200) - 0.5) * 2 * habit.uneven;
    gaps.push(g);
    drawn += g;
  }
  const tierY: number[] = [];
  let at = skirt;
  for (const g of gaps) {
    at += (g / drawn) * span;
    tierY.push(at);
  }
  /** How far the crown's axis leans at the height fraction `k`, metres. */
  const axisAt = (k: number): number => habit.bend * 4 * Math.pow(Math.max(0, k), 1.6);
  const R0 = habit.width[0] + rnd(60) * (habit.width[1] - habit.width[0]);
  /** Crown radius at the height fraction `k`, with tier `t`'s own unevenness. */
  const crownR = (k: number, t: number): number => (R0 * Math.pow(Math.max(0, 1 - k), habit.taper) + 0.3) * (0.9 + rnd(t + 240) * 0.2);
  const trunkTop = tierY[whorls - 1]!;
  const parts: THREE.BufferGeometry[] = [
    // The stem ends with the last tier. Run to the tip it showed as a bare stick through
    // the crown, and the wood above the top tier was that cone. Its rings flare at the
    // foot, slim to a pole, and follow the crown's axis.
    tube(
      [
        { x: 0, y: 0, z: 0, r: 0.3 },
        { x: leanX * axisAt(0.05), y: 0.8, z: leanZ * axisAt(0.05), r: 0.16 },
        { x: leanX * axisAt(0.45), y: skirt + span * 0.45, z: leanZ * axisAt(0.45), r: 0.11 },
        { x: leanX * axisAt(1), y: trunkTop, z: leanZ * axisAt(1), r: 0.055 },
      ],
      5,
      () => pal.trunk,
    ),
  ];
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const c = new THREE.Color();
  const under = new THREE.Color();
  const lift = new THREE.Color();
  /** One card of four corners, each corner (x, y, z, u, v), from the crown's colour. */
  const card = (corners: readonly (readonly [number, number, number, number, number])[]): void => {
    for (const i of [0, 1, 2, 0, 2, 3]) {
      const p = corners[i]!;
      pos.push(p[0], p[1], p[2]);
      nor.push(0, 1, 0);
      uv.push(p[3], p[4]);
      col.push(c.r, c.g, c.b);
    }
  };
  // ONE SHAPE AT EVERY LEVEL. A far level with fewer, wider boughs showed its dark
  // inside between them and filled in at 60 m as the near level took over: a spruce
  // that grew its branches as you drove up. The levels differ only in each bough's
  // segments.
  for (let t = 0; t < whorls; t++) {
    const y = tierY[t]!;
    const k = (y - skirt) / span;
    const R = crownR(k, t);
    const gap = y - (t === 0 ? skirt : tierY[t - 1]!);
    const ox = leanX * axisAt(k);
    const oz = leanZ * axisAt(k);
    const count = habit.branches[0] + Math.floor(rnd(t + 70) * (habit.branches[1] - habit.branches[0] + 1));
    const twist = rnd(t + 10) * 3;
    for (let b = 0; b < count; b++) {
      // A tier is not a closed ring: a bough here and there is gone, and the hole it
      // leaves is part of the crown.
      if (rnd(t * 33 + b + 300) < habit.loss) continue;
      const a = twist + (b / count) * Math.PI * 2 + (rnd(t * 50 + b) - 0.5) * 0.4;
      const facing = Math.cos(a) * leanX + Math.sin(a) * leanZ;
      // The bough's direction, laid over toward the wind where the tree grew windily.
      let dx = Math.cos(a) * (1 - habit.sweep) + leanX * habit.sweep;
      let dz = Math.sin(a) * (1 - habit.sweep) + leanZ * habit.sweep;
      const flat = Math.hypot(dx, dz) || 1;
      dx /= flat;
      dz /= flat;
      // Long on the clear side, short in the shade: most of an edge tree's character.
      const reach = R * (0.78 + rnd(t * 40 + b) * 0.36) * (1 + 0.75 * (habit.lean - 1) * facing);
      // The tip falls over the tier below but not onto it: the gap under a tier is what
      // makes a tier read as one, and the lowest hang deepest.
      const droop = reach * (0.12 + rnd(t * 30 + b) * 0.1) + gap * habit.droop * (1 + 0.2 * (1 - k));
      // As wide across as it reaches: a narrower card leaves the tier below it bare and
      // the crown reads through, and the spray's own painted taper does the shaping.
      const width = reach * (0.95 + rnd(t * 44 + b + 400) * 0.35);
      // Rolled well off flat, either way: seen level, a flat spray is a line.
      const roll = (rnd(t * 20 + b) < 0.5 ? -1 : 1) * (0.45 + rnd(t * 25 + b) * 0.6);
      const px = -dz * Math.cos(roll);
      const py = Math.sin(roll);
      const pz = dx * Math.cos(roll);
      const cell = leafCellUv('fir', rnd(t * 90 + b));
      c.setHex(pal.spruce[(t + b) % pal.spruce.length]!);
      const ex = ox + dx * 0.25;
      const ez = oz + dz * 0.25;
      const fy = y + 0.2;
      const tx = ox + dx * reach;
      const tz = oz + dz * reach;
      const ty = y - droop;
      const corner = (along: number, across: number, u: number, v: number): void => {
        const x = ex + (tx - ex) * along + px * across * width * 0.5;
        const yy = fy + (ty - fy) * along + py * across * width * 0.5 + along * (1 - along) * droop * -0.6;
        const z = ez + (tz - ez) * along + pz * across * width * 0.5;
        pos.push(x, yy, z);
        nor.push(0, 1, 0);
        uv.push(u, v);
        col.push(c.r, c.g, c.b);
      };
      // Two quads along the bough, so it can bend.
      for (const [a0, a1] of near ? ([[0, 0.5], [0.5, 1]] as const) : ([[0, 1]] as const)) {
        const v0 = cell.v0 + (cell.v1 - cell.v0) * a0;
        const v1 = cell.v0 + (cell.v1 - cell.v0) * a1;
        corner(a0, -1, cell.u0, v0);
        corner(a0, 1, cell.u1, v0);
        corner(a1, 1, cell.u1, v1);
        corner(a0, -1, cell.u0, v0);
        corner(a1, 1, cell.u1, v1);
        corner(a1, -1, cell.u0, v1);
      }
    }
  }
  // Inside the crown: dark ragged cards where the cone used to stand. Each hangs from
  // the height of one tier past the one below, off the axis and off the others' planes,
  // so no view finds them all edge-on. Narrower than the crown: they are what shows
  // between the boughs, not a shape of their own at the silhouette.
  const inner = 7 + Math.floor(rnd(3) * 3);
  const gapMean = span / whorls;
  for (let n = 0; n < inner; n++) {
    const f = (n + 0.5) / inner;
    const y = skirt + f * span;
    const R = (R0 * Math.pow(Math.max(0, 1 - f), habit.taper) + 0.3) * (0.4 + rnd(n * 13 + 500) * 0.24);
    const height = gapMean * (1.6 + rnd(n * 17 + 520) * 1.0);
    const a = rnd(n * 11 + 540) * Math.PI * 2;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    const px = -dz;
    const pz = dx;
    const half = R * (0.9 + rnd(n * 23 + 560) * 0.5);
    const lean = 0.35 + rnd(n * 19 + 580) * 0.3;
    const cx = leanX * axisAt(f);
    const cz = leanZ * axisAt(f);
    const cy = y + height * 0.35;
    const by = y - height * 0.65;
    const cell = leafCellUv('fir', rnd(n * 31 + 620));
    under.setHex(pal.spruceUnder);
    c.copy(under).lerp(lift.setHex(pal.spruce[0]), rnd(n * 37 + 640) * 0.3);
    card([
      [cx + px * half + dx * R * 0.1, cy, cz + pz * half + dz * R * 0.1, cell.u0, cell.v0],
      [cx - px * half + dx * R * 0.1, cy, cz - pz * half + dz * R * 0.1, cell.u1, cell.v0],
      [cx - px * half * lean + dx * R * (0.1 + lean * 0.45), by, cz - pz * half * lean + dz * R * (0.1 + lean * 0.45), cell.u1, cell.v1],
      [cx + px * half * lean + dx * R * (0.1 + lean * 0.45), by, cz + pz * half * lean + dz * R * (0.1 + lean * 0.45), cell.u0, cell.v1],
    ]);
  }
  // The top: tiers of tiny boughs shrinking to the leader's tuft, or what a broken or
  // twinned leader left. Cards, never a solid — a tip of geometry there was the dark
  // cone all over again — and never two crossed quads, which read as a star on the sky.
  const tip = (ox: number, oz: number, from: number, to: number, wide: number, levels: number): void => {
    for (let p = 0; p < levels; p++) {
      const f = levels === 1 ? 0 : p / (levels - 1);
      const y = from + f * Math.max(0, to - from - 0.55);
      const R = wide * (1 - 0.55 * f);
      const cards = p === 0 ? 3 : 2;
      const turn = rnd(p * 53 + 700) * Math.PI * 2;
      c.setHex(pal.spruce[0]!);
      for (let q = 0; q < cards; q++) {
        const a = turn + (q / cards) * Math.PI * 2;
        const dx = Math.cos(a);
        const dz = Math.sin(a);
        const px = -dz;
        const pz = dx;
        const cell = leafCellUv('fir', rnd(p * 41 + q * 7 + 660));
        const ex = ox + dx * 0.12;
        const ez = oz + dz * 0.12;
        const tx = ox + dx * R;
        const tz = oz + dz * R;
        const drop = R * 0.6;
        card([
          [ex + px * R * 0.4, y + 0.05, ez + pz * R * 0.4, cell.u0, cell.v0],
          [ex - px * R * 0.4, y + 0.05, ez - pz * R * 0.4, cell.u1, cell.v0],
          [tx - px * R * 0.16, y - drop, tz - pz * R * 0.16, cell.u1, cell.v1],
          [tx + px * R * 0.16, y - drop, tz + pz * R * 0.16, cell.u0, cell.v1],
        ]);
      }
    }
  };
  const apex = leanX * axisAt(1);
  const apexZ = leanZ * axisAt(1);
  const topY = tierY[whorls - 1]!;
  if (habit.top === 'twin') {
    // Two leaders: the taller off the axis, the shorter starting lower beside it.
    tip(apex, apexZ, topY - 0.4, H, 0.42, 3);
    tip(apex + sideX * 0.6, apexZ + sideZ * 0.6, topY - 1.6, H - 1.3, 0.4, 3);
  } else if (habit.top === 'stub') {
    // Wet snow took the leader: a blunt ragged crown where the spire was.
    tip(apex, apexZ, topY - 0.7, H - 1.1, 0.6, 2);
  } else {
    tip(apex, apexZ, topY - 0.2, H, 0.46, 3);
  }
  const boughs = new THREE.BufferGeometry();
  boughs.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  boughs.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  boughs.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  boughs.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const crown = finishCrown(boughs, apex * 0.5, skirt + span * 0.5, apexZ * 0.5, R0 * 1.05, (H - skirt) * 0.6, R0 * 1.05);
  return { wood: mergeGeometries(parts.map(asFlat)), leaves: crown };
}

type Rnd = () => number;

/** A small seeded stream: a tree draws its shape in order, the same for both levels. */
function rng(seed: number): Rnd {
  let s = Math.imul(seed + 1, 0x9e3779b1) >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Ring {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly r: number;
}

/** A faceted tube through horizontal rings, open at both ends. Flat colour per quad. */
/**
 * A tube through `rings`, `sides` faces round, coloured per face. Its bark is a texture
 * (render/leafpaint.ts `applyBarkMapping`): u runs round the trunk in whole tiles, v up
 * it in metres, so the bark's fissures and lenticels keep their size on any girth. Face
 * colours carry only broad changes (the dark foot, pine's copper crown); a pattern in
 * face colours shows as a chessboard of flat facets.
 */
function tube(rings: readonly Ring[], sides: number, colour: (ring: number, side: number) => number, bark: 'rough' | 'smooth' = 'rough'): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const uv: number[] = [];
  const girth = rings.reduce((m, r) => Math.max(m, r.r), 0) * Math.PI * 2;
  const around = Math.max(1, Math.round(girth / BARK_TILE_AROUND_M));
  const u0 = bark === 'smooth' ? BARK_SMOOTH_U : BARK_ROUGH_U;
  const heights: number[] = [0];
  for (let i = 1; i < rings.length; i++) {
    const a = rings[i - 1]!;
    const b = rings[i]!;
    heights.push(heights[i - 1]! + Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z));
  }
  const c = new THREE.Color();
  const at = (ring: Ring, s: number): [number, number, number] => {
    const a = (s / sides) * Math.PI * 2;
    return [ring.x + Math.cos(a) * ring.r, ring.y, ring.z + Math.sin(a) * ring.r];
  };
  for (let i = 0; i + 1 < rings.length; i++) {
    for (let s = 0; s < sides; s++) {
      const a = at(rings[i]!, s);
      const b = at(rings[i]!, s + 1);
      const u = at(rings[i + 1]!, s);
      const d = at(rings[i + 1]!, s + 1);
      pos.push(...a, ...u, ...b, ...b, ...u, ...d);
      const ua = u0 + (s / sides) * around;
      const ub = u0 + ((s + 1) / sides) * around;
      const va = heights[i]! / BARK_TILE_UP_M;
      const vb = heights[i + 1]! / BARK_TILE_UP_M;
      uv.push(ua, va, ua, vb, ub, va, ub, va, ua, vb, ub, vb);
      c.setHex(colour(i, s));
      for (let k = 0; k < 6; k++) col.push(c.r, c.g, c.b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

/**
 * Subdivision of every leaf mass, near and far alike (see `blob`). 0: twenty faces a
 * mass. At 1 (eighty) for every tree out to 420 m a birch wood cost 35 ms of GPU a
 * frame instead of 17; the crown lighting (`finishCrown`) rounds the coarse masses.
 */
const CROWN_DETAIL = 0;

/**
 * The leaf sprite the crown being built is painted with (render/leafpaint.ts), set
 * per kind by `loadTreeVariants` before each build.
 */
let leafSprite: LeafSprite = 'broad';

/**
 * A MASS OF LEAVES as cards: three upright quads crossed and one lying nearly flat, each
 * painted with a cluster of leaves from the leaf atlas and scattered a little inside
 * the mass's ellipsoid. `finishCrown` then bends every normal to the crown's own
 * ellipsoid, so the crown is lit as one soft volume and the cards never show as flat.
 * The flat one is for the view from above: a chase camera looks down into crowns.
 * Eight triangles, where a solid lump took twenty and read as a toy.
 */
function blob(
  cx: number,
  cy: number,
  cz: number,
  rx: number,
  ry: number,
  rz: number,
  tones: readonly number[],
  seed: number,
  hanging = false,
): THREE.BufferGeometry {
  const rnd = rng(seed * 2654435761 + 97);
  const sprite: LeafSprite = hanging && leafSprite === 'small' && rnd() < 0.5 ? 'hanging' : leafSprite;
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const c = new THREE.Color();
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const yaw0 = rnd() * Math.PI;
  const reach = Math.max(rx, rz);
  for (let k = 0; k < 4; k++) {
    const flat = k === 3;
    const yaw = yaw0 + k * (Math.PI / 3) + (rnd() - 0.5) * 0.5;
    // Upright cards lean a little; the flat one is tipped most of the way over.
    const tilt = flat ? 1.25 + rnd() * 0.25 : (rnd() - 0.5) * 0.6;
    right.set(Math.cos(yaw), 0, Math.sin(yaw));
    normal.set(-Math.sin(yaw), 0, Math.cos(yaw));
    up.set(0, 1, 0).multiplyScalar(Math.cos(tilt)).addScaledVector(normal, -Math.sin(tilt));
    normal.crossVectors(right, up).normalize();
    const hw = (flat ? reach : Math.max(reach, ry * 0.8)) * (1.2 + rnd() * 0.12);
    const hh = (flat ? reach : ry) * (1.2 + rnd() * 0.12) * (hanging && !flat ? 1.15 : 1);
    const ox = cx + (rnd() - 0.5) * rx * 0.4;
    const oy = cy + (rnd() - 0.5) * ry * 0.3 - (hanging && !flat ? ry * 0.15 : 0);
    const oz = cz + (rnd() - 0.5) * rz * 0.4;
    const cell = leafCellUv(flat && sprite === 'hanging' ? leafSprite : sprite, rnd());
    const flip = rnd() < 0.5;
    const u0 = flip ? cell.u1 : cell.u0;
    const u1 = flip ? cell.u0 : cell.u1;
    c.setHex(tones[k % tones.length]!);
    const corner = (a: number, b: number, u: number, v: number): void => {
      pos.push(ox + right.x * a * hw + up.x * b * hh, oy + right.y * a * hw + up.y * b * hh, oz + right.z * a * hw + up.z * b * hh);
      nor.push(normal.x, normal.y, normal.z);
      uv.push(u, v);
      col.push(c.r, c.g, c.b);
    };
    corner(-1, -1, u0, cell.v0);
    corner(1, -1, u1, cell.v0);
    corner(1, 1, u1, cell.v1);
    corner(-1, -1, u0, cell.v0);
    corner(1, 1, u1, cell.v1);
    corner(-1, 1, u0, cell.v1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

/** A solid lump: what a crown mass used to be, now only for rowan's berry bunches. */
/**
 * One mass of leaves: a lumpy ellipsoid. The lumps come from the direction alone, so
 * the faces stay joined; neighbouring faces take slightly different tones of the same
 * green, which is what makes a crown read as foliage and not as a gem. A `hanging`
 * mass narrows to a point below — a birch's leaves stream down from the twig — where
 * an ordinary one has a soft flat shelf underneath.
 *
 * THE SAME AT EVERY LEVEL. A crown's outline is what the eye tracks as a tree comes
 * near; built finer for the near level, every crown in view changed shape at the swap
 * distance, and driving through a wood was a constant ripple of trees redrawing
 * themselves. The levels differ only in bark marks, trunk facets and stubs, which are
 * below a pixel where they swap.
 */
function lump(
  cx: number,
  cy: number,
  cz: number,
  rx: number,
  ry: number,
  rz: number,
  tones: readonly number[],
  seed: number,
  hanging = false,
): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, CROWN_DETAIL);
  const p = g.getAttribute('position');
  for (let k = 0; k < p.count; k++) {
    const x = p.getX(k);
    const y = p.getY(k);
    const z = p.getZ(k);
    const f = 1 + 0.14 * Math.sin(x * 3.1 + seed) * Math.cos(z * 2.7 - seed * 1.3) + 0.07 * Math.sin(y * 4.3 + seed * 0.7);
    let across = 1;
    let down = 1;
    if (y < 0) {
      if (hanging) {
        // Rounded, not a spear: a narrower point read as one giant leaf.
        across = 1 + 0.38 * y;
        down = 1.35;
      } else down = 0.78;
    }
    p.setXYZ(k, cx + x * rx * f * across, cy + y * ry * f * down, cz + z * rz * f * across);
  }
  return flatColour(g, (x, y, z) => {
    const h = hash2(Math.floor(x * 7.3 + y * 3.1) + seed * 13, Math.floor(z * 7.3 - y * 5.7));
    const pick = h < 0.55 ? 0 : h < 0.82 ? 1 : 2;
    return tones[pick % tones.length]!;
  });
}

/** A branch from `from` out to `to`, arching through `bend`: three rings, thinning. */
function limb(
  from: THREE.Vector3,
  bend: THREE.Vector3,
  to: THREE.Vector3,
  r0: number,
  r1: number,
  sides: number,
  colour: number,
): THREE.BufferGeometry {
  const rings: Ring[] = [
    { x: from.x, y: from.y, z: from.z, r: r0 },
    { x: bend.x, y: bend.y, z: bend.z, r: (r0 + r1) / 2 },
    { x: to.x, y: to.y, z: to.z, r: r1 },
  ];
  // Rings are horizontal, so a limb is drawn as a stack of offset rings along its
  // path; on a near-level limb that is a flattened tube, which at a branch's girth
  // reads the same as a round one.
  return tube(rings, sides, () => colour);
}

/** Where the trunk axis is at height `y`: linear between its rings. */
function axisAt(rings: readonly Ring[], y: number, out: THREE.Vector3): THREE.Vector3 {
  for (let i = 0; i + 1 < rings.length; i++) {
    const a = rings[i]!;
    const b = rings[i + 1]!;
    if (y <= b.y || i + 2 === rings.length) {
      const t = Math.max(0, Math.min(1, (y - a.y) / (b.y - a.y)));
      out.set(a.x + (b.x - a.x) * t, y, a.z + (b.z - a.z) * t);
      return out;
    }
  }
  return out.set(0, y, 0);
}

function radiusAt(rings: readonly Ring[], y: number): number {
  for (let i = 0; i + 1 < rings.length; i++) {
    const a = rings[i]!;
    const b = rings[i + 1]!;
    if (y <= b.y) return a.r + (b.r - a.r) * Math.max(0, Math.min(1, (y - a.y) / (b.y - a.y)));
  }
  return rings[rings.length - 1]!.r;
}

/**
 * A trunk that sways a little on its way up, flared at the foot. Every random draw
 * happens before the rings are laid, so the near and the far level of one tree are
 * the same tree at a different ring count.
 */
function trunkRings(rnd: Rnd, height: number, r0: number, taper: number, sway: number, count: number): Ring[] {
  const leanX = (rnd() - 0.5) * sway * 2;
  const leanZ = (rnd() - 0.5) * sway * 2;
  const phase = rnd() * Math.PI * 2;
  const rings: Ring[] = [{ x: 0, y: -0.4, z: 0, r: r0 * 1.45 }];
  for (let i = 0; i <= count; i++) {
    const t = i / count;
    const wob = Math.sin(t * 4.2 + phase) * sway * 0.35 * t;
    rings.push({
      x: leanX * t * t + wob,
      y: t * height,
      z: leanZ * t * t + Math.cos(t * 3.7 + phase) * sway * 0.3 * t,
      r: r0 * (1 - taper * t) * (i === 0 ? 1.25 : 1),
    });
  }
  return rings;
}

/**
 * Rings inserted into a trunk at the given heights, on its own axis and taper: the
 * foot of a stem carries detail (fissures, the dark butt) finer than the ring pitch.
 */
function refine(rings: readonly Ring[], heights: readonly number[]): Ring[] {
  const out = [...rings];
  const p = new THREE.Vector3();
  for (const y of heights) {
    const i = out.findIndex((r) => r.y > y);
    if (i <= 0) continue;
    axisAt(out, y, p);
    out.splice(i, 0, { x: p.x, y, z: p.z, r: radiusAt(out, y) });
  }
  return out;
}

/**
 * Lights a crown as ONE soft volume. Every leaf mass keeps its own lumpy outline, but
 * its normals are bent toward the crown's ellipsoid, so the light falls across the
 * whole crown in one terminator instead of glinting off every facet — the facets were
 * what made the old crowns read as cut gems. The crown is also darker and cooler
 * underneath and inside, lighter on top: the self-shade a real crown has.
 */
function finishCrown(g: THREE.BufferGeometry, cx: number, cy: number, cz: number, rx: number, ry: number, rz: number): THREE.BufferGeometry {
  const p = g.getAttribute('position');
  const n = g.getAttribute('normal');
  const c = g.getAttribute('color');
  const v = new THREE.Vector3();
  const s = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    const dx = (p.getX(i) - cx) / rx;
    const dy = (p.getY(i) - cy) / ry;
    const dz = (p.getZ(i) - cz) / rz;
    s.set(dx / rx, dy / ry, dz / rz).normalize();
    v.set(n.getX(i), n.getY(i), n.getZ(i)).multiplyScalar(0.15).addScaledVector(s, 0.85).normalize();
    n.setXYZ(i, v.x, v.y, v.z);
    const up = Math.max(0, Math.min(1, dy * 0.5 + 0.5));
    const depth = Math.min(1, Math.hypot(dx, dy, dz));
    const k = (0.8 + 0.28 * up) * (0.84 + 0.16 * depth);
    c.setXYZ(i, c.getX(i) * k * (0.96 + 0.04 * up), c.getY(i) * k, c.getZ(i) * k * (1.06 - 0.06 * up));
  }
  return g;
}

/** A tree as two parts: wood takes shadows; leaves do not shadow themselves (acne). */
interface TreeShape {
  readonly wood: THREE.BufferGeometry | null;
  readonly leaves: THREE.BufferGeometry | null;
}

/**
 * A silver birch: a slender white stem, black and fissured at the foot, marked all the
 * way up with short dark dashes and a dark chevron under each branch; dark twiggy
 * branches out of the upper half carrying a narrow, tall crown of hanging masses with
 * sky between them.
 */
function birchGeometry(seed: number, pal: Palette, near: boolean, habit: Habit): TreeShape {
  const rnd = rng(seed * 7919 + 13);
  const H = habit.height[0] + rnd() * (habit.height[1] - habit.height[0]);
  // The dark furrowed foot of a grown birch stands a metre and a half to three high.
  const butt = 1.4 + rnd() * 1.6;
  const rings = refine(trunkRings(rnd, H * 0.94, 0.19 * habit.girth, 0.8 * (0.4 + habit.lean), 0.35, near ? 10 : 6), near ? [0.35, 0.75, 1.2, 1.7, 2.3, 3.0, 3.8] : [0.8, 1.6, 2.6]);
  const sides = near ? 7 : 5;
  const parts: THREE.BufferGeometry[] = [
    tube(rings, sides, (ring, side) => {
      const y = (rings[ring]!.y + rings[ring + 1]!.y) / 2;
      const h = hash2(side * 7 + seed, 1);
      // The far level paints the butt on its faces; the near level lays plates over a
      // white stem (see below), so its faces stay white above the ground line.
      if (near) return y < 0.2 ? pal.birchButt : pal.birchBark;
      // The far level paints the foot by side, in tongues: never face by face.
      const foot = butt * (0.7 + 0.6 * h);
      return y < foot ? pal.birchButt : y < foot * 1.4 ? pal.birchGrey : pal.birchBark;
    }, 'smooth'),
  ];
  const leaves: THREE.BufferGeometry[] = [];
  const from = new THREE.Vector3();
  const bend = new THREE.Vector3();
  const to = new THREE.Vector3();
  const junctions: [number, number][] = [];
  // A clump: the other stems of one root, each thin, leaning its own way, and each
  // carrying its own small crown at the top. What grows where a birch was cut.
  const turn = rnd() * Math.PI * 2;
  for (let stem = 1; stem < habit.stems; stem++) {
    const a = turn + (stem / habit.stems) * Math.PI * 2;
    const own = trunkRings(rnd, H * (0.8 - 0.08 * stem), 0.19 * habit.girth * 0.7, 0.4, 0.3, near ? 7 : 4).map((ring) => {
      const t = Math.max(0, ring.y) / H;
      return { ...ring, x: ring.x + Math.cos(a) * (0.35 + 1.1 * t), z: ring.z + Math.sin(a) * (0.35 + 1.1 * t) };
    });
    parts.push(tube(own, near ? 5 : 4, () => pal.birchBark, 'smooth'));
    const tip = own[own.length - 1]!;
    for (const [dy, r] of [[0.2, 1.0], [1.3, 0.7]] as const) {
      const rr = r * (0.8 + rnd() * 0.3);
      leaves.push(blob(tip.x, tip.y + dy, tip.z, rr, rr * 1.3, rr, rotated(pal.birchLeaf, stem), seed * 31 + stem * 5 + dy));
    }
  }
  const limbs = Math.max(3, Math.round(habit.limbs * 9));
  // The crown takes the upper two thirds: a birch in the open is leafy far down.
  const crownBase = H * (habit.crown[0] + rnd() * (habit.crown[1] - habit.crown[0]));
  const crownW = habit.width[0] + rnd() * (habit.width[1] - habit.width[0]);
  for (let j = 0; j < limbs; j++) {
    const k = j / limbs;
    const y = crownBase + (H * 0.84 - crownBase) * k + rnd() * 0.4;
    const a = turn + j * 2.4 + rnd() * 0.5;
    // A birch's crown is open: a limb here and there never grew, and the sky shows.
    if (rnd() < habit.gaps) continue;
    // Lower branches reach furthest and hang lowest: the crown is an upright oval,
    // widest below its middle, and its lower skirt droops.
    const reach = crownW * 1.25 * (1 - (1 - habit.taper) * k) * (0.8 + rnd() * 0.3);
    axisAt(rings, y, from);
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    bend.set(from.x + dx * reach * 0.5, y + reach * (0.45 + 0.3 * k), from.z + dz * reach * 0.5);
    // The tip hangs: a weeping birch's branch rises, then falls away.
    to.set(from.x + dx * reach, y + reach * ((1 - habit.hang) * (0.1 + 0.45 * k) - habit.hang * (0.35 + 0.35 * k)), from.z + dz * reach);
    parts.push(limb(from, bend, to, 0.06, 0.02, near ? 4 : 3, pal.twig));
    junctions.push([y, a]);
    const r = (1.2 - 0.5 * k) * (0.8 + rnd() * 0.35);
    leaves.push(blob(to.x, to.y - 0.3, to.z, r, r * (1.3 + rnd() * 0.3), r, rotated(pal.birchLeaf, j), seed * 31 + j, true));
    // A second, smaller mass half-way out: the branch is leafy along its length.
    const r2 = r * (0.6 + rnd() * 0.2);
    leaves.push(blob(bend.x, bend.y - 0.2, bend.z, r2, r2 * 1.3, r2, rotated(pal.birchLeaf, j + 1), seed * 31 + j + 40, true));
  }
  // The leader and the crown's heart, so it is one crown and not a mobile.
  const top = axisAt(rings, H * 0.94, new THREE.Vector3());
  const lead = 0.8 * (0.5 + habit.taper);
  leaves.push(blob(top.x, H * (habit.top === 'broken' ? 0.86 : 0.9), top.z, lead, lead * 1.6, lead, pal.birchLeaf, seed * 31 + 90, true));
  if (habit.top === 'twin') {
    // A birch forks where the leader was lost: two equal crowns, the second lower.
    leaves.push(blob(top.x + lead * 1.3, H * 0.82, top.z + lead * 0.7, lead * 0.85, lead * 1.3, lead * 0.85, pal.birchLeaf, seed * 31 + 92, true));
  }
  const heart = axisAt(rings, H * 0.62, new THREE.Vector3());
  const fill = (1.3 + rnd() * 0.3) * (1 - habit.gaps * 0.5) * (0.75 + habit.taper * 0.35);
  leaves.push(blob(heart.x, H * 0.62, heart.z, fill, fill * 1.6, fill, rotated(pal.birchLeaf, 1), seed * 31 + 91, true));
  const crownMidY = (crownBase + H) / 2;
  const crown = finishCrown(mergeGeometries(leaves.map(asFlat)), heart.x, crownMidY, heart.z, crownW + 0.8, (H - crownBase) / 2 + 0.8, crownW + 0.8);
  if (near) {
    // The rough foot: grey plates rising from the ground in pointed tongues of
    // different heights, dark fissures between them. No level edge anywhere.
    const plates = 7 + Math.floor(rnd() * 3);
    for (let q = 0; q < plates; q++) {
      const a0 = (q / plates) * Math.PI * 2 + rnd() * 0.3;
      const top = butt * (0.55 + rnd() * 0.9);
      parts.push(barkPlate(rings, a0, (Math.PI * 2) / plates + 0.25, top, pal.birchButt, 1.03));
      if (rnd() < 0.7) parts.push(barkPlate(rings, a0 + rnd() * 0.5, 0.18 + rnd() * 0.2, top * (0.5 + rnd() * 0.4), pal.birchMark, 1.045));
    }
    // Bark marks: thin dark lenses across the stem, never rings, thickest toward the
    // foot, and a wide dark chevron under every branch. Past 110 m they are under a
    // pixel, so the far level has none.
    const marks = 26 + Math.floor(rnd() * 10);
    for (let m = 0; m < marks; m++) {
      const y = butt * 1.1 + Math.pow(rnd(), 1.8) * (H * 0.72 - butt * 1.1);
      const big = rnd() < 0.12;
      const h = big ? 0.09 + rnd() * 0.07 : 0.025 + rnd() * 0.045;
      const arc = big ? 1.4 + rnd() * 1.1 : 0.5 + rnd() * 1.2;
      parts.push(barkDash(rings, y, h, rnd() * Math.PI * 2, arc, pal.birchMark));
    }
    for (const [y, a] of junctions) {
      if (y > H * 0.75) continue;
      parts.push(barkDash(rings, y - 0.25, 0.16, a - 0.65, 1.3, pal.birchMark));
    }
  }
  return { wood: mergeGeometries(parts.map(asFlat)), leaves: crown };
}

/**
 * One plate of rough bark at a birch's foot: from below the ground up to `top`, as
 * wide as `arc`, its upper edge rising to a point in the middle.
 */
function barkPlate(rings: readonly Ring[], a0: number, arc: number, top: number, colour: number, lift: number): THREE.BufferGeometry {
  const steps = 4;
  const pos: number[] = [];
  const c = new THREE.Vector3();
  const edge = (s: number): [number[], number[]] => {
    const t = s / steps;
    const a = a0 + arc * t;
    const y = top * (1 - 0.45 * Math.abs(2 * t - 1));
    axisAt(rings, y, c);
    const r0 = radiusAt(rings, -0.2) * lift;
    const r1 = radiusAt(rings, y) * lift;
    return [
      [c.x + Math.cos(a) * r0, -0.2, c.z + Math.sin(a) * r0],
      [c.x + Math.cos(a) * r1, y, c.z + Math.sin(a) * r1],
    ];
  };
  for (let s = 0; s < steps; s++) {
    const [a, u] = edge(s);
    const [b, d] = edge(s + 1);
    pos.push(...a, ...u, ...b, ...b, ...u, ...d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return flatColour(g, () => colour);
}

/**
 * A birch's dark mark: a thin lens wrapped part-way round the stem, pointed at both
 * ends and fullest in the middle, standing just proud of the bark.
 */
function barkDash(rings: readonly Ring[], y: number, h: number, a0: number, arc: number, colour: number): THREE.BufferGeometry {
  const centre = axisAt(rings, y, new THREE.Vector3());
  const r = radiusAt(rings, y) * 1.03;
  const steps = 5;
  const tilt = (hash2(Math.floor(a0 * 1000), Math.floor(y * 1000)) - 0.5) * h * 0.8;
  const pos: number[] = [];
  const edge = (s: number): [number[], number[]] => {
    const t = s / steps;
    const a = a0 + arc * t;
    const half = (h / 2) * Math.pow(Math.sin(Math.PI * t), 0.7);
    const mid = y + tilt * (t - 0.5);
    const x = centre.x + Math.cos(a) * r;
    const z = centre.z + Math.sin(a) * r;
    return [
      [x, mid - half, z],
      [x, mid + half, z],
    ];
  };
  for (let s = 0; s < steps; s++) {
    const [a, u] = edge(s);
    const [b, d] = edge(s + 1);
    pos.push(...a, ...u, ...b, ...b, ...u, ...d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return flatColour(g, () => colour);
}

/** The tones of a palette, starting at `k`: neighbouring masses lead with a different green. */
function rotated(tones: readonly number[], k: number): number[] {
  return tones.map((_, i) => tones[(i + k) % tones.length]!);
}

/** Every part non-indexed with position, colour, normal and uv only, so they merge. */
function asFlat(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const geo = g.index ? g.toNonIndexed() : g;
  for (const name of Object.keys(geo.attributes)) {
    if (name !== 'position' && name !== 'color' && name !== 'normal' && name !== 'uv') geo.deleteAttribute(name);
  }
  // Wood and anything else untextured samples the atlas's solid white cell.
  if (!geo.getAttribute('uv')) {
    const count = geo.getAttribute('position').count;
    const uv = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) uv.set(SOLID_UV, i * 2);
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  }
  return geo;
}

/** Shape of a tree with one full crown on a short stem: lime and maple. */
interface RoundCrown {
  readonly salt: number;
  readonly trunkR: number;
  /** The kind's own crown shape: lime is an egg, maple nearly a ball. */
  readonly tall: number;
  readonly leaves: (pal: Palette) => readonly number[];
}

const LIME: RoundCrown = { salt: 104729, trunkR: 0.32, tall: 1.3, leaves: (p) => p.limeLeaf };
const MAPLE: RoundCrown = { salt: 130363, trunkR: 0.28, tall: 0.92, leaves: (p) => p.mapleLeaf };

/**
 * A short stout grey stem, a few limbs showing under the crown, and one full crown on
 * the upper two thirds — a core with lumps of leaves pushed out of its surface, most
 * on top and at the sides.
 */
function roundCrownGeometry(spec: RoundCrown, seed: number, pal: Palette, near: boolean, habit: Habit): TreeShape {
  const rnd = rng(seed * spec.salt + 7);
  const H = habit.height[0] + rnd() * (habit.height[1] - habit.height[0]);
  const rx = habit.width[0] + rnd() * (habit.width[1] - habit.width[0]);
  const ry = rx * spec.tall * habit.tall;
  const fork = Math.max(2.2, H - ry * 2 + 0.4);
  const rings = trunkRings(rnd, fork + 0.6, spec.trunkR * habit.girth, 0.3 * (0.4 + habit.lean), 0.25, near ? 5 : 3);
  const tones = spec.leaves(pal);
  const parts: THREE.BufferGeometry[] = [tube(rings, near ? 7 : 5, () => pal.trunk)];
  const leaves: THREE.BufferGeometry[] = [];
  const top = rings[rings.length - 1]!;
  const from = new THREE.Vector3(top.x, fork, top.z);
  const bend = new THREE.Vector3();
  const to = new THREE.Vector3();
  const cy = H - ry;
  // A full crown, a broken one, a flat one and a twin: what the crown's own centre is.
  const spread = habit.top === 'flat' ? 0.95 : 0.8;
  const rise = habit.top === 'flat' ? 0.62 : habit.top === 'broken' ? 0.6 : 0.85;
  leaves.push(blob(top.x, cy, top.z, rx * spread, ry * rise, rx * spread, tones, seed * 17 + 50));
  if (habit.top === 'twin') leaves.push(blob(top.x + rx * 0.5, cy + ry * 0.35, top.z + rx * 0.3, rx * 0.6, ry * 0.5, rx * 0.6, tones, seed * 17 + 52));
  const masses = Math.max(3, Math.round(habit.limbs * 9));
  const turn = rnd() * Math.PI * 2;
  let limbs = 0;
  for (let j = 0; j < masses; j++) {
    const a = turn + j * 2.4 + rnd() * 0.4;
    if (rnd() < habit.gaps) continue;
    const e = -0.25 + rnd() * 1.1;
    const flat = Math.sqrt(Math.max(0, 1 - e * e));
    const px = top.x + Math.cos(a) * flat * rx * 0.72;
    const py = cy + e * ry * 0.72;
    const pz = top.z + Math.sin(a) * flat * rx * 0.72;
    const r = (0.48 + rnd() * 0.2) * rx * (1 - 0.2 * Math.max(0, e));
    leaves.push(blob(px, py, pz, r, r * 0.9, r, rotated(tones, j), seed * 17 + j));
    // Limbs to the lower masses: what shows of the wood under a full crown.
    if (e < 0.35 && limbs < 4) {
      limbs++;
      to.set(from.x + (px - from.x) * 0.75, from.y + (py - r * 0.4 - from.y) * 0.75, from.z + (pz - from.z) * 0.75);
      bend.set((from.x + to.x) / 2, (from.y + to.y) / 2 + 0.3, (from.z + to.z) / 2);
      parts.push(limb(from, bend, to, spec.trunkR * 0.5, spec.trunkR * 0.22, near ? 5 : 4, pal.trunk));
    }
  }
  const crown = finishCrown(mergeGeometries(leaves.map(asFlat)), top.x, cy, top.z, rx + 0.8, ry + 0.8, rx + 0.8);
  return { wood: mergeGeometries(parts.map(asFlat)), leaves: crown };
}

/**
 * A Scots pine: a tall stem, grey and scaly below, copper-orange from half-way up,
 * bare but for dead stubs until a flat, uneven crown of dark blue-green clouds on
 * short upswept limbs at the very top.
 */
/**
 * A Scots pine. In a wood (`open` false) a mast: a long bare stem and a flat crown at
 * the top. Grown in the open (`open`, Shishkin's "Rye"), the crown starts a third of
 * the way up, wide and ragged, the lower limbs long and drooping, on a stouter stem.
 */
function pineGeometry(seed: number, pal: Palette, near: boolean, open: boolean, habit: Habit): TreeShape {
  const rnd = rng(seed * 2654435 + 11 + (open ? 977 : 0));
  const H = habit.height[0] + rnd() * (habit.height[1] - habit.height[0]);
  const copper = H * (0.42 + rnd() * 0.12);
  // A broken or a twinned pine is a shorter tree: nothing grows above the break.
  const topY = habit.top === 'broken' ? 0.84 : habit.top === 'twin' ? 0.9 : 1;
  const turn = rnd() * Math.PI * 2;
  // A leaning pine leans whole, stem and crown together: the stem's rings are moved,
  // not its geometry, so the bark mapping and everything hung off the axis follow.
  const leanX = Math.cos(turn) * habit.lean;
  const leanZ = Math.sin(turn) * habit.lean;
  const rings = trunkRings(rnd, H * 0.92, habit.girth * 0.34, 0.72, 0.7, near ? 10 : 6).map((ring) => ({
    ...ring,
    x: ring.x + leanX * Math.max(0, ring.y) * 0.3,
    z: ring.z + leanZ * Math.max(0, ring.y) * 0.3,
  }));
  const parts: THREE.BufferGeometry[] = [
    tube(rings, near ? 7 : 5, (ring, side) => {
      const y = (rings[ring]!.y + rings[ring + 1]!.y) / 2;
      // Grey foot, a band of both, copper above: the change is a zone, in tongues.
      const edge = copper + (hash2(side + seed, 7) - 0.5) * 2.5;
      return y < edge - 1.6 ? pal.pineBarkLow : y < edge + 1.2 ? pal.pineBarkMid : pal.pineBark;
    }),
  ];
  const leaves: THREE.BufferGeometry[] = [];
  const from = new THREE.Vector3();
  const bend = new THREE.Vector3();
  const to = new THREE.Vector3();
  const crownBase = H * (habit.crown[0] + rnd() * (habit.crown[1] - habit.crown[0]));
  // Many limbs, each carrying a plate at its tip and one half-way: the plates overlap
  // into one ragged, flat-topped mass. Four or five lone plates read as a savanna
  // acacia, not a pine.
  const limbs = Math.max(3, Math.round(habit.limbs * (open ? 17 : 9)));
  for (let j = 0; j < limbs; j++) {
    const k = j / limbs;
    const y = crownBase + (H * topY * 0.9 - crownBase) * k;
    const a = turn + j * 2.3 + rnd() * 0.6;
    // A limb here and there is gone: a crown of a pine is never closed.
    if (rnd() < habit.gaps) continue;
    const out = (habit.width[0] + rnd() * (habit.width[1] - habit.width[0])) * (1 - (1 - habit.taper) * k);
    // A sagging limb is the open pine's: it reaches out and falls, where a bor pine's rise.
    const sag = habit.hang * (1 - k) * (0.6 + rnd() * 0.8);
    axisAt(rings, y, from);
    bend.set(from.x + Math.cos(a) * out * 0.5, y + 0.3 + rnd() * 0.4, from.z + Math.sin(a) * out * 0.5);
    to.set(from.x + Math.cos(a) * out, y + 0.6 + rnd() * 0.9 - sag * 1.6, from.z + Math.sin(a) * out);
    parts.push(limb(from, bend, to, 0.1 * (1 + habit.girth * 0.4), 0.04, near ? 4 : 3, pal.pineBark));
    // Pine needles sit in flat plates on top of their limbs, not in balls.
    const r = 1.5 + rnd() * 0.6;
    leaves.push(blob(to.x, to.y + 0.25, to.z, r, r * 0.55, r * (0.8 + rnd() * 0.3), rotated(pal.pine, j), seed * 23 + j));
    const r2 = r * 0.75;
    leaves.push(blob(bend.x, bend.y + 0.45, bend.z, r2, r2 * 0.6, r2, rotated(pal.pine, j + 1), seed * 23 + j + 40));
  }
  // The leader: a broad flat plate on a mast pine, a ragged clump on a young one, and
  // on a broken or a burnt one almost nothing.
  const top = axisAt(rings, H * topY * 0.92, new THREE.Vector3());
  const lead = habit.width[1] * (habit.top === 'flat' ? 0.8 : habit.top === 'layered' ? 0.4 : 0.6);
  const leadY = habit.top === 'flat' ? 0.32 : habit.top === 'droop' ? 0.55 : 0.55;
  const leadDrop = habit.top === 'droop' ? 0.9 : 0.15;
  leaves.push(blob(top.x, H * topY * 0.93 - leadDrop, top.z, lead, lead * leadY, lead, pal.pine, seed * 23 + 90));
  if (habit.top === 'twin') {
    // Two leaders: a bud or frost took the first, and the second grew beside it.
    leaves.push(blob(top.x + lead * 0.9, H * 0.8, top.z + lead * 0.5, lead * 0.7, lead * 0.8, lead * 0.7, pal.pine, seed * 23 + 91));
  }
  // Dead stubs on the bare stem: short, pointing down, a pine's bare trunk is never clean.
  if (near) {
    const stubs = Math.round((6 + rnd() * 5) * (habit.top === 'layered' ? 1.8 : 1));
    for (let s = 0; s < stubs; s++) {
      const y = 2.2 + rnd() * Math.max(1, (habit.top === 'layered' ? H * topY * 0.94 : crownBase) - 3);
      const a = rnd() * Math.PI * 2;
      const len = 0.35 + rnd() * 0.5;
      axisAt(rings, y, from);
      to.set(from.x + Math.cos(a) * len, y - len * 0.4, from.z + Math.sin(a) * len);
      bend.set((from.x + to.x) / 2, (from.y + to.y) / 2, (from.z + to.z) / 2);
      parts.push(limb(from, bend, to, 0.035, 0.012, 3, pal.twig));
    }
  }
  const cy = (crownBase + H * topY) / 2 + 0.5;
  const reach = habit.width[1] * 1.2 + 0.6;
  const crown = finishCrown(mergeGeometries(leaves.map(asFlat)), top.x, cy, top.z, reach, (H * topY - crownBase) / 2 + 1, reach);
  return { wood: mergeGeometries(parts.map(asFlat)), leaves: crown };
}

/**
 * An aspen: a straight smooth stem, pale grey-green, marked with dark diamonds and
 * darkening at the foot, under a narrow, high, round-lumped crown of a greyer green
 * than the birch beside it.
 */
function aspenGeometry(seed: number, pal: Palette, near: boolean, habit: Habit): TreeShape {
  const rnd = rng(seed * 40503 + 29);
  const H = habit.height[0] + rnd() * (habit.height[1] - habit.height[0]);
  const butt = 0.6 + rnd() * 0.7;
  const rings = trunkRings(rnd, H * 0.95, 0.2 * habit.girth, 0.75 * (0.4 + habit.lean), 0.15, near ? 10 : 6);
  const parts: THREE.BufferGeometry[] = [
    tube(rings, near ? 7 : 5, (ring, side) => {
      const y = (rings[ring]!.y + rings[ring + 1]!.y) / 2;
      return y < butt + (hash2(side * 3 + seed, 5) - 0.5) * 0.6 ? pal.aspenButt : pal.aspenBark;
    }, 'smooth'),
  ];
  const leaves: THREE.BufferGeometry[] = [];
  const from = new THREE.Vector3();
  const bend = new THREE.Vector3();
  const to = new THREE.Vector3();
  const junctions: [number, number][] = [];
  const crownBase = H * (habit.crown[0] + rnd() * (habit.crown[1] - habit.crown[0]));
  const crownW = habit.width[0] + rnd() * (habit.width[1] - habit.width[0]);
  const limbs = Math.max(3, Math.round(habit.limbs * 8));
  const turn = rnd() * Math.PI * 2;
  for (let j = 0; j < limbs; j++) {
    const k = j / limbs;
    const y = crownBase + (H * 0.86 - crownBase) * k + rnd() * 0.3;
    const a = turn + j * 2.4 + rnd() * 0.5;
    if (rnd() < habit.gaps) continue;
    const reach = crownW * 1.1 * (1 - (1 - habit.taper) * k) * (0.8 + rnd() * 0.3);
    axisAt(rings, y, from);
    // Aspen limbs climb: no weeping tips.
    bend.set(from.x + Math.cos(a) * reach * 0.5, y + reach * 0.6, from.z + Math.sin(a) * reach * 0.5);
    to.set(from.x + Math.cos(a) * reach, y + reach * (0.85 - habit.hang * 1.0), from.z + Math.sin(a) * reach);
    parts.push(limb(from, bend, to, 0.055, 0.02, near ? 4 : 3, pal.twig));
    junctions.push([y, a]);
    const r = (1.05 - 0.35 * k) * (0.85 + rnd() * 0.3);
    leaves.push(blob(to.x, to.y, to.z, r, r * 1.1, r, rotated(pal.aspenLeaf, j), seed * 29 + j));
  }
  const top = axisAt(rings, H * 0.95, new THREE.Vector3());
  const lead = 0.9 * (0.6 + habit.taper * 0.5);
  leaves.push(blob(top.x, H * (habit.top === 'broken' ? 0.88 : 0.92), top.z, lead, lead * 1.4, lead, pal.aspenLeaf, seed * 29 + 90));
  if (habit.top === 'twin') leaves.push(blob(top.x + lead * 1.1, H * 0.85, top.z + lead * 0.5, lead * 0.8, lead * 1.2, lead * 0.8, pal.aspenLeaf, seed * 29 + 92));
  const heart = axisAt(rings, H * 0.72, new THREE.Vector3());
  const rHeart = (1.3 + rnd() * 0.3) * (1 - habit.gaps * 0.5);
  leaves.push(blob(heart.x, H * 0.72, heart.z, rHeart, rHeart * 1.4, rHeart, rotated(pal.aspenLeaf, 1), seed * 29 + 91));
  if (near) {
    // Dark diamonds: short, tall lenses — the aspen's lenticels are upright, a birch's lie flat.
    const marks = 10 + Math.floor(rnd() * 7);
    for (let m = 0; m < marks; m++) {
      const y = butt + 0.4 + rnd() * (H * 0.55 - butt);
      parts.push(barkDash(rings, y, 0.1 + rnd() * 0.1, rnd() * Math.PI * 2, 0.35 + rnd() * 0.3, pal.aspenButt));
    }
    for (const [y, a] of junctions) {
      if (y < H * 0.8) parts.push(barkDash(rings, y - 0.25, 0.18, a - 0.5, 1.0, pal.aspenButt));
    }
  }
  const cy = (crownBase + H) / 2;
  const crown = finishCrown(mergeGeometries(leaves.map(asFlat)), heart.x, cy, heart.z, crownW + 0.8, (H - crownBase) / 2 + 0.8, crownW + 0.8);
  return { wood: mergeGeometries(parts.map(asFlat)), leaves: crown };
}

/**
 * An oak: a thick, dark, furrowed trunk that forks low into a few heavy crooked limbs
 * reaching out rather than up, under a broad, dark, lumpy crown wider than it is tall.
 */
function oakGeometry(seed: number, pal: Palette, near: boolean, habit: Habit): TreeShape {
  const rnd = rng(seed * 69069 + 5);
  const H = habit.height[0] + rnd() * (habit.height[1] - habit.height[0]);
  const fork = H * (habit.crown[0] + rnd() * (habit.crown[1] - habit.crown[0]));
  const rings = trunkRings(rnd, fork + 0.5, 0.48 * habit.girth, 0.3 * (0.4 + habit.lean), 0.35, near ? 5 : 3);
  const sides = near ? 9 : 6;
  const parts: THREE.BufferGeometry[] = [
    // Furrowed: bark ridges and dark fissures alternate round the stem.
    // The fissures are the bark texture's; faces coloured in stripes read as a chessboard.
    tube(rings, sides, () => pal.oakBark),
  ];
  const leaves: THREE.BufferGeometry[] = [];
  const top = rings[rings.length - 1]!;
  const from = new THREE.Vector3(top.x, fork, top.z);
  const bend = new THREE.Vector3();
  const to = new THREE.Vector3();
  const rx = habit.width[0] + rnd() * (habit.width[1] - habit.width[0]);
  const ry = (H - fork) * 0.5 * habit.tall + 0.4;
  const cy = fork + ry - 0.3;
  // A tent is broader and flatter than a wood oak's crown; a broken one is a stump of
  // its old self, and a twinned one forked where the leader was lost.
  const spread = habit.top === 'flat' ? 0.86 : 0.68;
  const rise = habit.top === 'flat' ? 0.52 : 0.75;
  leaves.push(blob(top.x, cy + 0.4, top.z, rx * spread, ry * rise, rx * spread, pal.oakLeaf, seed * 31 + 70));
  const limbs = Math.max(3, Math.round(habit.limbs * 5));
  const turn = rnd() * Math.PI * 2;
  for (let j = 0; j < limbs; j++) {
    const a = turn + (j / limbs) * Math.PI * 2 + (rnd() - 0.5) * 0.7;
    if (rnd() < habit.gaps) continue;
    const elev = 0.35 + rnd() * 0.45;
    const L = rx * (0.62 + rnd() * 0.28);
    const dx = Math.cos(a) * Math.cos(elev);
    const dz = Math.sin(a) * Math.cos(elev);
    const dy = Math.sin(elev);
    // A crook half-way: the limb changes its mind.
    const side = (rnd() - 0.5) * 1.6;
    bend.set(from.x + dx * L * 0.5 - dz * side, from.y + dy * L * 0.5 + 0.4 + rnd() * 0.6, from.z + dz * L * 0.5 + dx * side);
    to.set(from.x + dx * L, from.y + dy * L + 0.5, from.z + dz * L);
    parts.push(limb(from, bend, to, 0.26, 0.09, near ? 5 : 4, pal.oakBark));
    const r = 1.8 + rnd() * 0.7;
    leaves.push(blob(to.x, to.y + 0.6, to.z, r, r * 0.75, r, rotated(pal.oakLeaf, j), seed * 31 + j));
    const r2 = 1.3 + rnd() * 0.5;
    leaves.push(blob(bend.x, bend.y + 1.0, bend.z, r2, r2 * 0.8, r2, rotated(pal.oakLeaf, j + 1), seed * 31 + j + 40));
  }
  const crown = finishCrown(mergeGeometries(leaves.map(asFlat)), top.x, cy, top.z, rx + 0.8, ry + 0.8, rx + 0.8);
  return { wood: mergeGeometries(parts.map(asFlat)), leaves: crown };
}

/**
 * An alder by the water: often two or three stems from one foot, dark grey, under a
 * narrow crown tapering to a blunt point, the darkest green of the broadleaves.
 */
function alderGeometry(seed: number, pal: Palette, near: boolean, habit: Habit): TreeShape {
  const rnd = rng(seed * 92821 + 17);
  const H = habit.height[0] + rnd() * (habit.height[1] - habit.height[0]);
  const stems = habit.stems;
  const parts: THREE.BufferGeometry[] = [];
  const turn = rnd() * Math.PI * 2;
  for (let s = 0; s < stems; s++) {
    const a = turn + (s / stems) * Math.PI * 2;
    const spread = stems === 1 ? 0 : 0.25;
    const lean = stems === 1 ? 0 : (0.9 + rnd() * 0.6) * (0.4 + habit.lean);
    const own = trunkRings(rnd, H * (0.88 - s * 0.08), (0.2 - s * 0.03) * habit.girth, 0.75, 0.2, near ? 8 : 5);
    const moved = own.map((ring) => {
      const t = Math.max(0, ring.y) / H;
      return { ...ring, x: ring.x + Math.cos(a) * (spread + lean * t), z: ring.z + Math.sin(a) * (spread + lean * t) };
    });
    parts.push(tube(moved, near ? 6 : 4, () => pal.alderBark));
  }
  const leaves: THREE.BufferGeometry[] = [];
  const crownBase = H * (habit.crown[0] + rnd() * (habit.crown[1] - habit.crown[0]));
  const rx = habit.width[0] + rnd() * (habit.width[1] - habit.width[0]) + (stems - 1) * 0.5;
  const levels = Math.max(3, Math.round(habit.limbs * 7));
  for (let j = 0; j < levels; j++) {
    const k = j / levels;
    const y = crownBase + (H - 1.2 - crownBase) * k;
    // A cone: wide low, narrowing up to a blunt top. Two masses a level, on opposite
    // sides and overlapping the axis: one mass a level stacked into a topiary.
    const ring = rx * (1 - (1 - habit.taper) * k);
    const a = turn + j * 2.2 + rnd() * 0.6;
    if (rnd() < habit.gaps) continue;
    for (const side of [0, Math.PI]) {
      const r = (1.35 - 0.5 * k) * (0.85 + rnd() * 0.3);
      const d = ring * (0.35 + rnd() * 0.25);
      leaves.push(blob(Math.cos(a + side) * d, y + (rnd() - 0.5) * 0.8, Math.sin(a + side) * d, r, r * 1.2, r, rotated(pal.alderLeaf, j), seed * 37 + j * 2 + (side ? 1 : 0)));
    }
  }
  const lead = 0.8 * (0.6 + habit.taper * 0.5);
  leaves.push(blob(0, H * (habit.top === 'broken' ? 0.88 : 1) - 0.9, 0, lead, lead * 1.4, lead, pal.alderLeaf, seed * 37 + 90));
  if (habit.top === 'twin') leaves.push(blob(0.7, H * 0.82, 0.4, lead * 0.8, lead * 1.2, lead * 0.8, pal.alderLeaf, seed * 37 + 92));
  const cy = (crownBase + H) / 2;
  const crown = finishCrown(mergeGeometries(leaves.map(asFlat)), 0, cy, 0, rx + 0.8, (H - crownBase) / 2 + 0.8, rx + 0.8);
  return { wood: mergeGeometries(parts.map(asFlat)), leaves: crown };
}

/**
 * A white willow, the rakita of ditches and ponds: a short, thick, leaning trunk that
 * breaks into a fountain of upswept limbs, and a broad, rounded, silvery crown.
 */
function willowGeometry(seed: number, pal: Palette, near: boolean, habit: Habit): TreeShape {
  const rnd = rng(seed * 48271 + 41);
  const H = habit.height[0] + rnd() * (habit.height[1] - habit.height[0]);
  const trunkH = H * (habit.crown[0] + rnd() * (habit.crown[1] - habit.crown[0]));
  const rings = trunkRings(rnd, trunkH, 0.42 * habit.girth, 0.25, 1.1 * (0.6 + habit.lean), near ? 4 : 3);
  const parts: THREE.BufferGeometry[] = [tube(rings, near ? 8 : 5, () => pal.willowBark)];
  const leaves: THREE.BufferGeometry[] = [];
  const top = rings[rings.length - 1]!;
  const from = new THREE.Vector3(top.x, trunkH, top.z);
  const bend = new THREE.Vector3();
  const to = new THREE.Vector3();
  const rx = habit.width[0] + rnd() * (habit.width[1] - habit.width[0]);
  const limbs = Math.max(3, Math.round(habit.limbs * 5));
  const turn = rnd() * Math.PI * 2;
  for (let j = 0; j < limbs; j++) {
    const a = turn + (j / limbs) * Math.PI * 2 + (rnd() - 0.5) * 0.5;
    if (rnd() < habit.gaps) continue;
    const out = rx * (0.5 + rnd() * 0.3);
    // Up first then out is the fountain; the white willow's limbs then hang.
    const up = (H - trunkH) * (0.6 + rnd() * 0.25) * (1 - habit.hang * 0.7);
    // Up first, then out: the fountain.
    bend.set(from.x + Math.cos(a) * out * 0.25, from.y + up * 0.6, from.z + Math.sin(a) * out * 0.25);
    to.set(from.x + Math.cos(a) * out, from.y + up, from.z + Math.sin(a) * out);
    parts.push(limb(from, bend, to, 0.2, 0.07, near ? 5 : 4, pal.willowBark));
    const r = 1.6 + rnd() * 0.6;
    leaves.push(blob(to.x, to.y, to.z, r, r * 0.9, r, rotated(pal.willowLeaf, j), seed * 41 + j));
  }
  const cy = H * (habit.top === 'flat' ? 0.78 : 1) - 2.4 * habit.taper;
  leaves.push(blob(from.x, cy, from.z, rx * 0.7, 2.2 * (habit.top === 'flat' ? 0.6 : 1), rx * 0.7, pal.willowLeaf, seed * 41 + 60));
  const crown = finishCrown(mergeGeometries(leaves.map(asFlat)), from.x, cy, from.z, rx + 0.8, 3.2, rx + 0.8);
  return { wood: mergeGeometries(parts.map(asFlat)), leaves: crown };
}

/**
 * A rowan at a wood's edge: small, slender, sometimes two stems, an open oval crown
 * of light leaves, and the orange-red berry clusters that are the whole point of it.
 */
function rowanGeometry(seed: number, pal: Palette, near: boolean, habit: Habit): TreeShape {
  const rnd = rng(seed * 16807 + 53);
  const H = habit.height[0] + rnd() * (habit.height[1] - habit.height[0]);
  const stems = habit.stems;
  const parts: THREE.BufferGeometry[] = [];
  const turn = rnd() * Math.PI * 2;
  let rings: Ring[] = [];
  for (let s = 0; s < stems; s++) {
    const a = turn + s * Math.PI;
    const lean = stems === 1 ? 0 : 0.6;
    const own = trunkRings(rnd, H * (0.9 - s * 0.1), 0.12, 0.7, 0.25, near ? 6 : 4).map((ring) => {
      const t = Math.max(0, ring.y) / H;
      return { ...ring, x: ring.x + Math.cos(a) * lean * t, z: ring.z + Math.sin(a) * lean * t };
    });
    if (s === 0) rings = own;
    parts.push(tube(own, near ? 5 : 4, () => pal.rowanBark));
  }
  const leaves: THREE.BufferGeometry[] = [];
  const from = new THREE.Vector3();
  const bend = new THREE.Vector3();
  const to = new THREE.Vector3();
  const crownBase = H * (habit.crown[0] + rnd() * (habit.crown[1] - habit.crown[0]));
  const crownW = habit.width[0] + rnd() * (habit.width[1] - habit.width[0]);
  const masses = Math.max(3, Math.round(habit.limbs * 7));
  const berries: [number, number, number, number][] = [];
  for (let j = 0; j < masses; j++) {
    const k = j / masses;
    const y = crownBase + (H * 0.85 - crownBase) * k;
    const a = turn + j * 2.4 + rnd() * 0.5;
    if (rnd() < habit.gaps) continue;
    const reach = crownW * 1.05 * (1 - (1 - habit.taper) * k) * (0.8 + rnd() * 0.3);
    axisAt(rings, y, from);
    bend.set(from.x + Math.cos(a) * reach * 0.5, y + reach * 0.5, from.z + Math.sin(a) * reach * 0.5);
    to.set(from.x + Math.cos(a) * reach, y + reach * 0.7, from.z + Math.sin(a) * reach);
    parts.push(limb(from, bend, to, 0.04, 0.015, 3, pal.twig));
    const r = (0.8 - 0.25 * k) * (0.85 + rnd() * 0.3);
    leaves.push(blob(to.x, to.y, to.z, r, r * 0.85, r, rotated(pal.rowanLeaf, j), seed * 43 + j));
    // Clusters hang under the outer side of a mass, where the sun finds them.
    // Flat bunches, many and small: a few big balls read as apples. The same at both
    // levels: a bunch appearing at the swap distance is a pop like any other.
    const clusters = 2;
    for (let c = 0; c < clusters; c++) {
      const ca = a + (rnd() - 0.5) * 1.6;
      const cr = 0.12 + rnd() * 0.04;
      berries.push([to.x + Math.cos(ca) * r * 0.9, to.y - r * (0.1 + rnd() * 0.4), to.z + Math.sin(ca) * r * 0.9, cr]);
    }
  }
  const heart = axisAt(rings, (crownBase + H) / 2, new THREE.Vector3());
  leaves.push(blob(heart.x, heart.y, heart.z, crownW * 0.7, crownW * 0.9, crownW * 0.7, pal.rowanLeaf, seed * 43 + 90));
  // A bunch is a few berries, not one disc: three small balls hanging together.
  for (const [x, y, z, r] of berries) {
    for (let b = 0; b < 3; b++) {
      const ba = b * 2.1 + x;
      parts.push(lump(x + Math.cos(ba) * r * 0.9, y - b * r * 0.5, z + Math.sin(ba) * r * 0.9, r, r, r, [pal.rowanBerry], seed + b));
    }
  }
  const crown = finishCrown(mergeGeometries(leaves.map(asFlat)), heart.x, heart.y, heart.z, crownW + 0.7, (H - crownBase) / 2 + 0.7, crownW + 0.7);
  return { wood: mergeGeometries(parts.map(asFlat)), leaves: crown };
}

/**
 * A hazel or a willow clump: a few thin stems out of one spot, fanning out, carrying
 * upright masses of leaves — taller than wide, narrow at the foot, its stems showing
 * under it.
 */
function bushGeometry(seed: number, pal: Palette, near: boolean, habit: Habit): TreeShape {
  const rnd = rng(seed * 15485863 + 3);
  const wood: THREE.BufferGeometry[] = [];
  const leaves: THREE.BufferGeometry[] = [];
  const from = new THREE.Vector3();
  const bend = new THREE.Vector3();
  const to = new THREE.Vector3();
  const H = habit.height[0] + rnd() * (habit.height[1] - habit.height[0]);
  const W = habit.width[0] + rnd() * (habit.width[1] - habit.width[0]);
  const n = Math.max(1, habit.stems);
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2;
    if (i > 0 && rnd() < habit.gaps) continue;
    const d = (i === 0 ? 0 : 0.45 + rnd() * 0.55) * (0.6 + habit.lean);
    const r = (i === 0 ? 0.95 : 0.7) * (0.7 + habit.taper * 0.5) + rnd() * 0.3;
    const h = H * (1.1 + rnd() * 0.5) - d * 0.5 - habit.hang * (0.3 + rnd() * 0.4);
    const x = Math.cos(a) * d * (0.6 + W * 0.4);
    const z = Math.sin(a) * d * (0.6 + W * 0.4);
    leaves.push(blob(x, h * (habit.top === 'broken' ? 0.75 : 1), z, r, r * 1.15, r, rotated(pal.bush, i), seed * 19 + i));
    from.set(x * 0.15, -0.2, z * 0.15);
    to.set(x * 0.8, h - r * 0.5, z * 0.8);
    bend.set(x * 0.4, (h - r * 0.5) * 0.5, z * 0.4);
    wood.push(limb(from, bend, to, 0.045 * habit.girth, 0.02, 3, pal.twig));
  }
  return {
    wood: mergeGeometries(wood.map(asFlat)),
    leaves: finishCrown(mergeGeometries(leaves.map(asFlat)), 0, H, 0, W, H * 0.7, W),
  };
}

/**
 * A fern: a crown of fronds from one root, each a card painted with a frond
 * (render/leafpaint.ts), rising and then arching out and down in two segments. Bracken
 * and lady fern stand knee to waist high; the instance scale spreads that.
 */
function fernGeometry(seed: number, pal: Palette, near: boolean, habit: Habit): TreeShape {
  const rnd = rng(seed * 6007 + 3);
  const H = habit.height[0] + rnd() * (habit.height[1] - habit.height[0]);
  const W = habit.width[0] + rnd() * (habit.width[1] - habit.width[0]);
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const c = new THREE.Color();
  const fronds = Math.max(3, Math.round((near ? 9 : 6) * habit.limbs));
  const cell = leafCellUv('frond', 0);
  for (let f = 0; f < fronds; f++) {
    const a = (f / fronds) * Math.PI * 2 + rnd() * 0.5 + habit.lean;
    if (rnd() < habit.gaps) continue;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    const L = H * (0.85 + rnd() * 0.35);
    const rise = (0.55 + rnd() * 0.35) * (1 - habit.hang * 0.5);
    const width = W * (0.85 + rnd() * 0.3);
    c.setHex(pal.fern[f % pal.fern.length]!);
    // Spine: root, the arch's top two thirds out, the drooping tip.
    const spine = [
      [0, 0.02, 0],
      [dx * L * 0.45, L * rise, dz * L * 0.45],
      [dx * L, L * rise * 0.55, dz * L],
    ];
    // Across: horizontal, tipped a little so a frond is seen from above and from the side.
    const tilt = 0.35 + rnd() * 0.3;
    const px = -dz * Math.cos(tilt);
    const py = Math.sin(tilt);
    const pz = dx * Math.cos(tilt);
    for (let seg = 0; seg < 2; seg++) {
      const p0 = spine[seg]!;
      const p1 = spine[seg + 1]!;
      const v0 = cell.v0 + (cell.v1 - cell.v0) * (seg / 2);
      const v1 = cell.v0 + (cell.v1 - cell.v0) * ((seg + 1) / 2);
      const w0 = width * (seg === 0 ? 0.55 : 1);
      const w1 = width * (seg === 0 ? 1 : 0.6);
      const corner = (p: number[], w: number, side: number, u: number, v: number): void => {
        pos.push(p[0]! + px * w * side, p[1]! + py * w * side, p[2]! + pz * w * side);
        nor.push(0, 1, 0);
        uv.push(u, v);
        col.push(c.r, c.g, c.b);
      };
      corner(p0, w0, -1, cell.u0, v0);
      corner(p0, w0, 1, cell.u1, v0);
      corner(p1, w1, 1, cell.u1, v1);
      corner(p0, w0, -1, cell.u0, v0);
      corner(p1, w1, 1, cell.u1, v1);
      corner(p1, w1, -1, cell.u0, v1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return { wood: null, leaves: finishCrown(g, 0, 0.35, 0, 1.1, 0.6, 1.1) };
}

/**
 * A stump: a short broad trunk with a flared foot, its top a pale cut face or, when old,
 * a ragged grey break, a cushion of moss on one side. Sits a little into the ground.
 */
function stumpGeometry(seed: number, pal: Palette, near: boolean, habit: Habit): TreeShape {
  const rnd = rng(seed * 7717 + 5);
  const r = (habit.width[0] + rnd() * (habit.width[1] - habit.width[0])) * 0.5;
  const h = habit.height[0] + rnd() * (habit.height[1] - habit.height[0]);
  const lean = habit.lean * (rnd() - 0.5) * 0.6;
  const rings: Ring[] = [
    { x: 0, y: -0.15, z: 0, r: r * 1.45 },
    { x: 0, y: 0.08, z: 0, r: r * 1.15 },
    { x: lean * h, y: h, z: 0, r },
  ];
  const sides = near ? 9 : 6;
  const parts = [tube(rings, sides, () => pal.deadwood)];
  // The cut: a flat disc, tilted a touch, pale if fresh and grey if old; a broken one
  // has a ragged grey break instead, and a burnt one no cut at all.
  const fresh = rnd() < (habit.crown[0] + habit.crown[1]) / 2;
  if (habit.top !== 'broken') {
    const top = new THREE.CircleGeometry(r * 0.98, sides).rotateX(-Math.PI / 2).rotateZ((rnd() - 0.5) * 0.25).translate(lean * h, h, 0);
    parts.push(flatColour(top, () => (fresh ? pal.deadwoodCut : pal.deadwood)));
  }
  if (habit.stems > 1) {
    // Two trunks out of one root, one cut lower: a stump beside a stump.
    const own = trunkRings(rnd, h * 0.7, r * 0.7, 0.2, 0.1, near ? 6 : 4).map((ring) => ({ ...ring, x: ring.x + r * 1.3 }));
    parts.push(tube(own, near ? 6 : 4, () => pal.deadwood));
  }
  const moss = lump(r * 0.7, 0.12, 0, r * 0.7 * (1 - habit.taper), 0.18, r * 0.8, [pal.moss], seed * 13);
  moss.rotateY(rnd() * Math.PI * 2);
  return { wood: mergeGeometries(parts.map(asFlat)), leaves: habit.gaps > 0.4 ? null : asFlat(moss) };
}

/**
 * A fallen trunk: a long tube lying along x on the ground, thinning toward the top end,
 * a few broken branch stubs, its root end a cut or a torn plate. Grey with moss on top.
 */
function logGeometry(seed: number, pal: Palette, near: boolean, habit: Habit): TreeShape {
  const rnd = rng(seed * 9973 + 17);
  const L = habit.height[0] + rnd() * (habit.height[1] - habit.height[0]);
  const r0 = (habit.width[0] + rnd() * (habit.width[1] - habit.width[0])) * 0.5;
  const steps = near ? 5 : 3;
  const rings: Ring[] = [];
  for (let k = 0; k <= steps; k++) {
    const t = k / steps;
    rings.push({ x: 0, y: -L / 2 + t * L, z: 0, r: r0 * (1 - habit.taper * 0.8 * t) });
  }
  // Built upright (the tube is vertical), then laid down: rotated onto x, raised to
  // rest on the ground, a little sunk.
  const wood = tube(rings, near ? 7 : 5, () => pal.deadwood);
  const parts = [wood];
  const stubs = Math.max(0, Math.round((2 + rnd() * 3) * habit.limbs));
  for (let k = 0; k < stubs; k++) {
    const y = -L / 2 + (0.3 + rnd() * 0.6) * L;
    const a = rnd() * Math.PI * 2;
    const from = new THREE.Vector3(0, y, 0);
    const to = new THREE.Vector3(Math.cos(a) * 0.7, y + 0.5, Math.sin(a) * 0.7);
    const bend = from.clone().lerp(to, 0.5);
    parts.push(limb(from, bend, to, 0.06, 0.03, 3, pal.deadwood));
  }
  if (habit.stems > 1) {
    // A second trunk lying across the first: what a windthrow leaves.
    const own = trunkRings(rnd, L * 0.6, r0 * 0.8, 0.3, 0.2, near ? 5 : 3);
    parts.push(tube(own, near ? 5 : 4, () => pal.deadwood).rotateZ(Math.PI / 2).rotateY(0.5).translate(r0 * 2.2, r0 * 1.6, 0));
  }
  const g = mergeGeometries(parts.map(asFlat));
  // Laid down along x, resting on the ground, leaning a little where it fell.
  g.rotateZ(Math.PI / 2 + habit.lean * 0.35).translate(0, r0 * 0.75, 0);
  const moss = lump(0, r0 * 1.5, 0, L * 0.3, 0.1, r0 * 0.8, [pal.moss], seed * 29);
  return { wood: g, leaves: asFlat(moss) };
}

/**
 * A juniper: the bor's dark column, taller than wide, of needle masses stacked on a
 * short stem, narrowing to a blunt point.
 */
function juniperGeometry(seed: number, pal: Palette, near: boolean, habit: Habit): TreeShape {
  const rnd = rng(seed * 4099 + 11);
  const H = habit.height[0] + rnd() * (habit.height[1] - habit.height[0]);
  const W = habit.width[0] + rnd() * (habit.width[1] - habit.width[0]);
  const leanX = Math.cos(rnd() * Math.PI * 2) * habit.lean * 0.4;
  const stems = Math.max(1, habit.stems);
  const wood: THREE.BufferGeometry[] = [];
  for (let s = 0; s < stems; s++) {
    const off = s === 0 ? 0 : W * 0.5;
    wood.push(tube([
      { x: off, y: -0.2, z: 0, r: 0.07 * habit.girth },
      { x: off + leanX * H * 0.4, y: H * 0.5, z: off * 0.3, r: 0.04 },
    ], near ? 5 : 4, () => pal.twig));
  }
  const leaves: THREE.BufferGeometry[] = [];
  const masses = Math.max(2, Math.round((near ? 5 : 3) * habit.limbs));
  for (let k = 0; k < masses; k++) {
    const t = (k + 0.5) / masses;
    if (rnd() < habit.gaps) continue;
    const r = W * (1 - (1 - habit.taper) * t) * (0.8 + rnd() * 0.3);
    const top = habit.top === 'broken' ? 0.82 : 1;
    leaves.push(blob(
      (rnd() - 0.5) * W * 0.5 + leanX * H * t * 0.5,
      H * (0.12 + 0.8 * t) * top,
      (rnd() - 0.5) * W * 0.5,
      r, (H / masses) * 0.8 * (habit.top === 'flat' ? 0.6 : 1), r,
      rotated(pal.juniper, k), seed * 17 + k,
    ));
  }
  return {
    wood: mergeGeometries(wood.map(asFlat)),
    leaves: finishCrown(mergeGeometries(leaves.map(asFlat)), leanX * H * 0.5, H * 0.5, 0, W + 0.2, H * 0.55, W + 0.2),
  };
}

const material = applyComicShading(
  // Leaves are cards (see `blob`): textured, seen from both sides, cut out by the
  // atlas's alpha. Wood samples the atlas's solid cell and is closed, so its back faces
  // are never seen.
  new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, map: leafAtlas(), side: THREE.DoubleSide }),
  { contourStrength: 0, stippleStrength: 0, shadowWarmth: 0.3 },
);
/**
 * Leaf cards cast their painted outline, not their square, from either face. Wood casts
 * from its back faces only, as three's default shadow side does for a closed solid:
 * drawn from both, its lit faces shadowed themselves in fine stripes.
 */
const depthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: leafAtlas(), alphaTest: 0.5, side: THREE.DoubleSide });
depthMaterial.onBeforeCompile = (shader) => {
  injectSeason(shader);
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nattribute float aWood;\nattribute float aKind;\nvarying float vWood;\nvarying float vKind;\nvarying float vLeafBare;')
    .replace('#include <begin_vertex>', `#include <begin_vertex>
vWood = aWood;
vKind = aKind;
vLeafBare = 0.0;
#ifdef USE_INSTANCING_COLOR
{
  float tint = instanceColor.r;
  if ( aWood < 0.5 ) vLeafBare = seasonLeafBare( int( aKind + 0.5 ), ${SEASON_TREE_RANDOM_GLSL} );
}
#endif`);
  // A leaf that has fallen casts no shadow either (see the main material).
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <alphatest_fragment>',
    `#include <alphatest_fragment>
#ifdef USE_MAP
if ( vWood < 0.5 && seasonLeafKeep( vLeafBare, texture2D( map, vMapUv ).r ) < 0.5 ) discard;
#endif`,
  );
  // Undergrowth (fern, juniper) casts no shadow: under the trees it would be shadow in
  // shadow, and it was a shadow-pass draw for every bucket of it.
  shader.fragmentShader = `varying float vWood;\nvarying float vKind;\nvarying float vLeafBare;\n${shader.fragmentShader.replace(
    'void main() {',
    `void main() {\n\tif ( vKind > ${(UNDERGROWTH_KIND_FROM - 0.5).toFixed(1)} && vKind < ${(UNDERGROWTH_KIND_TO + 0.5).toFixed(1)} ) discard;\n\tif ( vWood > 0.5 && gl_FrontFacing ) discard;`,
  )}`;
};
depthMaterial.customProgramCacheKey = () => 'tree-depth-v4';
applyBarkMapping(depthMaterial);
// Leaves take no sun shadow: self-shadowed crowns crawl with triangle-sized acne. Wood
// does. One program for both, told apart per vertex by `aWood`.
{
  const compileComic = material.onBeforeCompile;
  const shadowTest = '( directLight.visible && receiveShadow )';
  material.onBeforeCompile = (shader, renderer) => {
    compileComic.call(material, shader, renderer);
    // The test that guards the DIRECTIONAL shadow lookup: the last one before it.
    const lookup = shader.fragmentShader.indexOf('directionalShadowMap[ i ]');
    const at = lookup < 0 ? -1 : shader.fragmentShader.lastIndexOf(shadowTest, lookup);
    if (at < 0) throw new Error('Tree shader: directional shadow test not found');
    shader.fragmentShader =
      shader.fragmentShader.slice(0, at) +
      '( directLight.visible && receiveShadow && vWood > 0.5 )' +
      shader.fragmentShader.slice(at + shadowTest.length);
    injectSeason(shader);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute float aWood;
attribute float aKind;
varying float vWood;
varying float vUnderFade;
varying float vLeafBare;`)
      // Leaves take the season's colour, each tree at its own pace: its random comes
      // from the tint the impostor also carries, so model and impostor turn together.
      .replace('#include <color_vertex>', `#include <color_vertex>
#if defined( USE_COLOR ) && defined( USE_INSTANCING_COLOR )
{
  float tint = instanceColor.r;
  int kind = int( aKind + 0.5 );
  if ( aWood < 0.5 ) {
    vColor.rgb = seasonLeaf( vColor.rgb, kind, ${SEASON_TREE_RANDOM_GLSL} );
    vLeafBare = seasonLeafBare( kind, ${SEASON_TREE_RANDOM_GLSL} );
    // What stays of a bare crown is twigs: their colour, here, where the leaf colour
    // lives (the fragment multiplies the atlas by it).
    vColor.rgb = seasonTwigs( vColor.rgb, vLeafBare );
    // Snow on an evergreen's upper side: the crown's bent normals face up on top.
    vColor.rgb = mix( vColor.rgb, ${SNOW_GLSL}, seasonEvergreenSnow( kind, normal.y ) );
  } else {
    // Snow along the top of a fallen trunk, a stump's cut, a limb.
    vColor.rgb = mix( vColor.rgb, ${SNOW_GLSL}, uSeasonSnow * smoothstep( 0.55, 0.9, normal.y ) * 0.85 );
  }
}
#endif`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vWood = aWood;
#ifndef USE_INSTANCING_COLOR
vLeafBare = 0.0;
#endif
// Undergrowth dissolves over UNDERGROWTH_FADE, tree by tree at its foot, by coverage:
// past it the forest stops drawing it at all (world/forest.ts).
vUnderFade = 1.0;
#ifdef USE_INSTANCING
if ( aKind > ${(UNDERGROWTH_KIND_FROM - 0.5).toFixed(1)} && aKind < ${(UNDERGROWTH_KIND_TO + 0.5).toFixed(1)} ) {
  vec3 underFoot = ( modelMatrix * instanceMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xyz;
  // Each plant at its own distance, over its own 30 m: a band crossed in under a second
  // at speed was plants appearing out of nothing.
  float tint = instanceColor.r;
  float underAt = mix( ${(UNDERGROWTH_FADE_FROM_M + 15).toFixed(1)}, ${(UNDERGROWTH_FADE_TO_M - 15).toFixed(1)}, ${SEASON_TREE_RANDOM_GLSL} );
  vUnderFade = 1.0 - smoothstep( underAt - 15.0, underAt + 15.0, length( cameraPosition.xz - underFoot.xz ) );
}
#endif`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying float vWood;
varying float vUnderFade;
varying float vLeafBare;`)
      // A leaf card's edge from the atlas's coverage, sharpened to about a pixel and
      // widened as it minifies (mips average leaf and gap and would thin the crown with
      // distance), as the grass does. Under MSAA the coverage resolves to a soft edge.
      .replace('#include <map_fragment>', `#include <map_fragment>
// Only the leaf cards are two-sided. Wood draws its front faces as before: the
// spruce's tiers are open shells, and their backs fought their fronts in stripes.
if ( vWood > 0.5 && !gl_FrontFacing ) discard;
{
  vec2 leafTexel = vMapUv * vec2( textureSize( map, 0 ) );
  float leafMip = max( 0.0, 0.5 * log2( max( dot( dFdx( leafTexel ), dFdx( leafTexel ) ), dot( dFdy( leafTexel ), dFdy( leafTexel ) ) ) ) );
  float leafA = diffuseColor.a * ( 1.0 + leafMip * 0.22 );
  diffuseColor.a = clamp( ( leafA - 0.5 ) / max( fwidth( leafA ), 0.0001 ) + 0.5, 0.0, 1.0 ) * vUnderFade;
  // Autumn's fall: each painted leaf drops at its own point (render/season.ts).
  if ( vWood < 0.5 && vLeafBare > 0.0 ) {
    diffuseColor.a *= seasonLeafKeep( vLeafBare, texture2D( map, vMapUv ).r );
  }
  if ( diffuseColor.a < 0.02 ) discard;
}`)
      // Both faces of a leaf card are lit by its crown normal (see \`finishCrown\`): three
      // flips the normal of a back face, which turned half the cards of a crown dark.
      .replace(
        '#include <normal_fragment_begin>',
        THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', 'normal *= vWood > 0.5 ? faceDirection : 1.0;'),
      );
  };
  const comicKey = material.customProgramCacheKey;
  material.customProgramCacheKey = () => `${comicKey.call(material)}:tree-cards-v5`;
}
// Bark (render/leafpaint.ts): wood whose texture coordinates carry a bark offset.
applyBarkMapping(material);

/** Wood and leaves merged, tagged per vertex: see `TreePart`. */
function mergeTreeParts(wood: THREE.BufferGeometry | null, leaves: THREE.BufferGeometry | null, kind: TreeKind): THREE.BufferGeometry {
  const tagged = ([[wood, 1], [leaves, 0]] as const)
    .filter(([g]) => g !== null)
    .map(([g, tag]) => {
      // Every part needs texture coordinates now, the spruce's untextured cones too.
      g = asFlat(g!);
      g.setAttribute('aWood', new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute('position').count).fill(tag), 1));
      return g;
    });
  const merged = tagged.length === 1 ? tagged[0]! : mergeGeometries(tagged);
  if (!merged) throw new Error('Tree parts could not be merged');
  // The kind, for the season's leaf colours (render/season.ts).
  merged.setAttribute('aKind', new THREE.Float32BufferAttribute(new Float32Array(merged.getAttribute('position').count).fill(kind), 1));
  return merged;
}

/** Which leaf painting each kind's crown wears (render/leafpaint.ts). */
const LEAF_SPRITES: Record<TreeKind, LeafSprite> = {
  [TreeKind.Birch]: 'small',
  [TreeKind.Spruce]: 'needle',
  [TreeKind.Bush]: 'broad',
  [TreeKind.Lime]: 'broad',
  [TreeKind.Pine]: 'needle',
  [TreeKind.Aspen]: 'small',
  [TreeKind.Oak]: 'broad',
  [TreeKind.Maple]: 'broad',
  [TreeKind.Alder]: 'small',
  [TreeKind.Willow]: 'small',
  [TreeKind.Rowan]: 'small',
  [TreeKind.Fern]: 'frond',
  [TreeKind.Juniper]: 'needle',
  [TreeKind.Stump]: 'broad',
  [TreeKind.Log]: 'small',
  [TreeKind.FieldPine]: 'needle',
};

/** Undergrowth dissolves between these camera distances and is not drawn past them. */
export const UNDERGROWTH_FADE_FROM_M = 50;
export const UNDERGROWTH_FADE_TO_M = 110;

const VARIANTS: Record<TreeKind, number> = {
  [TreeKind.Birch]: BIRCH_HABITS.length,
  // One variant per habit (see `SPRUCE_HABITS`): the spruce is the kind the wood has
  // most of, and the one whose shapes the owner reads first.
  [TreeKind.Spruce]: SPRUCE_HABITS.length,
  [TreeKind.Bush]: BUSH_HABITS.length,
  [TreeKind.Lime]: LIME_HABITS.length,
  [TreeKind.Pine]: PINE_HABITS.length,
  [TreeKind.Aspen]: ASPEN_HABITS.length,
  [TreeKind.Oak]: OAK_HABITS.length,
  [TreeKind.Maple]: MAPLE_HABITS.length,
  [TreeKind.Alder]: ALDER_HABITS.length,
  [TreeKind.Willow]: WILLOW_HABITS.length,
  [TreeKind.Rowan]: ROWAN_HABITS.length,
  [TreeKind.Fern]: FERN_HABITS.length,
  [TreeKind.Juniper]: JUNIPER_HABITS.length,
  [TreeKind.Stump]: STUMP_HABITS.length,
  [TreeKind.Log]: LOG_HABITS.length,
  [TreeKind.FieldPine]: FIELD_PINE_HABITS.length,
};

let variants: readonly TreeVariant[][] | null = null;

/** Every kind's variants, built once. Index by `TreeKind`. */
export function loadTreeVariants(season: Season = 'summer'): Promise<readonly TreeVariant[][]> {
  if (!variants) {
    const pal = PALETTES[season];
    const build: Record<TreeKind, (seed: number, pal: Palette, near: boolean) => TreeShape> = {
      [TreeKind.Birch]: (seed, p, near) => birchGeometry(seed, p, near, BIRCH_HABITS[(seed - 1) % BIRCH_HABITS.length]!),
      // The seed handed to a builder is the variant's index plus one, so a spruce can
      // wear its own habit rather than draw one.
      [TreeKind.Spruce]: (seed, p, near) => spruceGeometry(seed, p, near, SPRUCE_HABITS[(seed - 1) % SPRUCE_HABITS.length]!),
      [TreeKind.Bush]: (seed, p, near) => bushGeometry(seed, p, near, BUSH_HABITS[(seed - 1) % BUSH_HABITS.length]!),
      [TreeKind.Lime]: (seed, p, near) => roundCrownGeometry(LIME, seed, p, near, LIME_HABITS[(seed - 1) % LIME_HABITS.length]!),
      [TreeKind.Pine]: (seed, p, near) => pineGeometry(seed, p, near, false, PINE_HABITS[(seed - 1) % PINE_HABITS.length]!),
      [TreeKind.Aspen]: (seed, p, near) => aspenGeometry(seed, p, near, ASPEN_HABITS[(seed - 1) % ASPEN_HABITS.length]!),
      [TreeKind.Oak]: (seed, p, near) => oakGeometry(seed, p, near, OAK_HABITS[(seed - 1) % OAK_HABITS.length]!),
      [TreeKind.Maple]: (seed, p, near) => roundCrownGeometry(MAPLE, seed, p, near, MAPLE_HABITS[(seed - 1) % MAPLE_HABITS.length]!),
      [TreeKind.Alder]: (seed, p, near) => alderGeometry(seed, p, near, ALDER_HABITS[(seed - 1) % ALDER_HABITS.length]!),
      [TreeKind.Willow]: (seed, p, near) => willowGeometry(seed, p, near, WILLOW_HABITS[(seed - 1) % WILLOW_HABITS.length]!),
      [TreeKind.Rowan]: (seed, p, near) => rowanGeometry(seed, p, near, ROWAN_HABITS[(seed - 1) % ROWAN_HABITS.length]!),
      [TreeKind.Fern]: (seed, p, near) => fernGeometry(seed, p, near, FERN_HABITS[(seed - 1) % FERN_HABITS.length]!),
      [TreeKind.Juniper]: (seed, p, near) => juniperGeometry(seed, p, near, JUNIPER_HABITS[(seed - 1) % JUNIPER_HABITS.length]!),
      [TreeKind.Stump]: (seed, p, near) => stumpGeometry(seed, p, near, STUMP_HABITS[(seed - 1) % STUMP_HABITS.length]!),
      [TreeKind.Log]: (seed, p, near) => logGeometry(seed, p, near, LOG_HABITS[(seed - 1) % LOG_HABITS.length]!),
      [TreeKind.FieldPine]: (seed, p, near) => pineGeometry(seed, p, near, true, FIELD_PINE_HABITS[(seed - 1) % FIELD_PINE_HABITS.length]!),
    };
    const lod = ({ wood, leaves }: TreeShape, kind: TreeKind): TreeLod => {
      const geometry = mergeTreeParts(wood, leaves, kind);
      geometry.computeBoundingSphere();
      return [{ geometry, material, depthMaterial }];
    };
    variants = TREE_KINDS.map((kind) => {
      leafSprite = LEAF_SPRITES[kind];
      return Array.from({ length: VARIANTS[kind] }, (_, seed) => ({
        near: lod(build[kind](seed + 1, pal, true), kind),
        far: lod(build[kind](seed + 1, pal, false), kind),
      }));
    });
  }
  return Promise.resolve(variants);
}
