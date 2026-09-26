import { hashUnit3 } from '../core/rng';
import { TreeKind } from './deserttiledata';

/**
 * THE SHAPE OF A TREE, WITHOUT DRAWING ONE: which of a kind's variants stands at a
 * point, how tall and how wide, and how thick its trunk is.
 *
 * This is the tree contract as DATA. The renderer (world/forest.ts, the look modules)
 * draws a tree from an asset; physics (`world/deserttiles.ts`) puts a cylinder where the
 * trunk is; the ground's baked shade reads the wood's density. All three must agree about
 * where a tree stands, which one it is and how big it is — so none of them owns the
 * answer.
 *
 * It lives apart from the drawing for the same reason: physics must not depend on a
 * renderer to know where a trunk is, and a variant index must not move because a sprite
 * was re-rendered. The numbers below (the habit catalogues' girths, the region mixing)
 * are the ones the trunk colliders have always been built from: they are DATA as much as
 * the placement itself, and moving them is what lets the drawing change under them.
 *
 * The habit tables this summarises (`world/props/trees.ts` before stage 4) described the
 * whole shape of a tree — crown height, taper, lean, what became of the top — because the
 * procedural builder read them. Drawing is an asset now, so only the two things anyone
 * else needs survive: how many variants a kind has (the index space of `treeShape`), and
 * each variant's trunk girth (what the collider is).
 */

/** Variant, and the height and width multipliers, of the tree at a world position. */
export interface TreeShape {
  variant: number;
  sx: number;
  sy: number;
}

const VARIANT_TAG = 0x46524553;
const SHAPE_TAG = 0x53484150;

/**
 * Trunk collider radius per kind at scale 1 and girth 1, metres, in `TreeKind` order; 0
 * for things a car drives through. Read through `trunkColliderRadius`, which applies the
 * variant's habit.
 */
const TREE_TRUNK_RADIUS: readonly number[] = [0.2, 0.26, 0, 0.3, 0.34, 0.2, 0.46, 0.26, 0.2, 0.4, 0.12, 0, 0, 0.3, 0, 0.42];

/**
 * Each variant's trunk girth: the drawn trunk's own width multiplier, which the collider
 * follows. Before the habits carried it, an old oak of girth 1.9 was driven into up to its
 * heartwood and a sapling-thin birch stopped a car short of its bark. A spruce has no girth
 * in its habit — its trunk is drawn at one width whatever the habit — so its twelve
 * variants are all 1, and so are the kinds whose shapes never varied the stem.
 */
const TREE_VARIANT_GIRTH: readonly (readonly number[])[] = [
  // Birch.
  [0.8, 1.0, 1.0, 0.6, 0.8, 1.3, 1.0, 1.0, 1.0, 1.0, 0.55],
  // Spruce.
  [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0],
  // Bush.
  [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0],
  // Lime.
  [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 0.6, 1.7],
  // Pine.
  [1.35, 1.6, 0.7, 1.25, 1.2, 1.2, 1.1, 1.0, 0.6, 0.8, 0.85],
  // Aspen.
  [1.0, 1.0, 1.2, 1.0, 1.15, 1.0, 1.0, 0.5, 1.5, 1.0],
  // Oak.
  [1.0, 0.9, 1.2, 1.0, 1.3, 1.0, 1.0, 1.0, 1.9, 1.6],
  // Maple.
  [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 0.6, 1.7],
  // Alder.
  [1.0, 1.0, 0.7, 1.2, 1.0, 1.0, 1.0, 1.0, 0.6, 1.6],
  // Willow.
  [1.0, 1.0, 1.0, 1.6, 1.2, 0.7, 1.0, 1.4, 1.0, 0.5],
  // Rowan.
  [1.0, 1.0, 0.7, 0.8, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0],
  // Fern.
  [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0],
  // Juniper.
  [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 0.6, 1.0],
  // Stump.
  [1.0, 1.0, 1.0, 1.0, 1.6, 1.0, 1.0, 1.0, 1.0, 1.0],
  // Log.
  [1.0, 1.0, 0.6, 1.6, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0],
  // Pine of the open field.
  [1.2, 1.0, 1.35, 1.1, 1.15, 1.05, 0.95, 0.9, 1.5, 0.8],
];

/** How many variants a kind has: the count `treeShape` picks among. */
export function treeVariantCount(kind: TreeKind): number {
  return TREE_VARIANT_GIRTH[kind]!.length;
}

/** Trunk collider radius of one variant at scale 1, metres. */
export function trunkColliderRadius(kind: TreeKind, variant: number): number {
  const girth = TREE_VARIANT_GIRTH[kind]![variant] ?? 1;
  return TREE_TRUNK_RADIUS[kind]! * girth;
}

/** Side of one region of habit, metres: a stand's own set of variants. */
const HABIT_REGION_M = 260;
/**
 * Habits a region grows. Two: a stand has one age and one history, and two forms of a
 * species among its neighbours read as variety (a young spruce among old ones), where
 * ten read as a catalogue. It is also the lever on cost — see the measurement in
 * docs/research-2026-09-26.md, §6.7: two habits a region drew 45 tree slots in a wood
 * where a uniform mix of the same catalogue drew 89.
 */
const HABIT_MIX = 2;

/**
 * Which of a kind's variants a region grows. A wood is not a random mix of everything
 * its species can be: a stand has one age and one history, so a region grows three of a
 * kind's habits and the next region another three, sharing one or two with its
 * neighbour. The player meets the whole catalogue in a few kilometres of driving, and
 * any one view shows a few habits — which is what keeps the number of *drawn* variants,
 * and so the number of draw calls, where one species stood before the habits existed
 * (docs/research-2026-09-26.md, §6.6; measured in §6.7).
 */
function mixInRegion(wx: number, wz: number, variants: number, tag: number): number {
  if (variants <= HABIT_MIX) return Math.floor(hashUnit3(tag, Math.round(wx * 4), Math.round(wz * 4)) * variants);
  const rx = Math.floor(wx / HABIT_REGION_M);
  const rz = Math.floor(wz / HABIT_REGION_M);
  const start = Math.floor(hashUnit3(tag, rx, rz) * variants);
  // The stride is odd against the catalogue, so three habits of a region are spread
  // across the whole of it rather than three neighbours in the table.
  const stride = 5 + 2 * Math.floor(hashUnit3(tag ^ 0x9e37, rx, rz) * Math.floor(variants / HABIT_MIX));
  const pick = Math.floor(hashUnit3(tag ^ 0x85eb, Math.round(wx * 4), Math.round(wz * 4)) * HABIT_MIX);
  return (start + pick * stride) % variants;
}

/**
 * Fill `out` with the variant standing at a world position, and the height and width
 * multipliers it is drawn with. Both the renderer and the colliders call it: it is the
 * same tree in both places, and it is a pure hash of the position, so it cannot drift.
 */
export function treeShape(
  wx: number,
  wz: number,
  variants: number,
  out: TreeShape,
): void {
  const ix = Math.round(wx * 4);
  const iz = Math.round(wz * 4);
  out.variant = mixInRegion(wx, wz, variants, VARIANT_TAG);
  // Height and girth vary independently: a tall thin one, a short broad one.
  out.sy = 0.82 + 0.4 * hashUnit3(SHAPE_TAG, ix, iz);
  out.sx = 0.85 + 0.32 * hashUnit3(SHAPE_TAG + 1, ix, iz);
}
