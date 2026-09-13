/**
 * The homestead: the player's first five minutes, told without a word of text.
 *
 * A small house with an attached open-fronted garage sits beside the road's runout
 * (`STRAIGHT_RUNOUT` in road.ts keeps s ∈ [0, 260] dead straight and heading 0, and
 * `HOME_FLAT_RADIUS` in landscape.ts keeps the ground under the footprint level to
 * within a tenth of a metre). Inside the garage sits the starter car — a complete
 * model — with a jerry can, professional camera and pocket watch within arm's reach;
 * a football waits beside the drive.
 *
 * Everything here is pure geometry derived from the seed, never a texture or a
 * prefab, and never `Math.random` — the same seed rebuilds the same homestead,
 * car and starting-item placement.
 */
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';

import { hash01, pick } from '../core/rng';
import { SurfaceType } from '../core/surfaces';
import { Road, ROAD_HALF_WIDTH } from './road';
import { Terrain } from './terrain';
import { desertPaletteAt } from './gradient';
import { fitGround } from './footprint';
import { createVariantInstance, registerPlacedSwitches } from './poivariantbuild';
import type { PoiSwitchField } from './poiswitches';
import { SHELF_PLANK_TOP, STARTER_GARAGE_SHELF } from './poi-variants';
import { oilCapacity } from '../parts/registry';
import { bonnetWaterCapacity, createBonnetStorage } from '../vehicle/bonnet';
import { COLD_SOAK_C } from '../vehicle/cooling';
import { carModelMeasure, carSpawnYAboveGround } from '../render/carmodel';
import { FOOTBALL_RADIUS } from '../render/partmesh';
import { modelEngine, CAR_MODELS } from '../vehicle/carmodels';
import type { CarState, GameWorld } from '../game/state';
import type { ChunkContext, ChunkContent, ChunkProvider } from './chunks';
import type { LoosePartField } from '../parts/loose';
import { CAMERA_FRAME_LIMIT, type Item } from '../items/items';

type V3 = [number, number, number];

// ---------------------------------------------------------------------------
// Layout constants. Positions are expressed in "road-local" coordinates:
//   u = metres away from the centreline into the desert (positive),
//   v = metres forward from the homestead anchor (positive = direction of travel),
//   y = absolute height.
// The homestead sits on the LEFT of travel (SIDE = -1); heading 0 on the runout
// means the frame is axis-aligned, so (u, v) boxes map to axis-aligned world boxes.
// ---------------------------------------------------------------------------

/** Arclength of the homestead, ahead of the player's spawn (z = -14). */
const HOMESTEAD_S = 116;
/** -1 = left of travel, +1 = right. */
const SIDE = -1;

/**
 * Garage door line: the building's garage front sits here, and the driveway ramps up to
 * it from the road. It is also the homestead's NEAREST point to the road, so this number
 * is the homestead's setback.
 *
 * WHY IT STAYS AT THE ROAD, and it is not a matter of taste. The terrain is fitted to the
 * road only inside the 30 m corridor (`terrain.ts`); past that the landscape's long bands
 * return, and they keep their slope everywhere — the origin-centred flattening in
 * `landscape.ts` suppresses the SHORT bands, not those. So distance from the road is
 * bought with relief, and a concrete pad cannot pay for it: measured under this
 * compound's own footprint, the ground varies 0.60 m at this setback and 1.62 m fifty
 * metres further out, where it also stands 1.5-3.1 m higher. The slab is 0.45 m thick
 * with a 0.12 m lift, so it absorbs the first and not the second — push the homestead out
 * and it ends up on a hill with the edge of its pad in the air. Move it outward only
 * after making the terrain answer for it.
 */
const GARAGE_DOOR_U = 8.3;
/** Small free-fall inside the low garage; the open-world 0.75 m drop hits its roof. */
const GARAGE_CAR_DROP_METRES = 0.08;

/**
 * Slab thickness below the pad's top surface, and the lift above the highest ground
 * under it. Exported because together they are the pad's CAPACITY to absorb uneven
 * ground, and `tools/poi-placement.ts` holds the terrain to it — a homestead placed
 * where the ground varies more than this stands on a hill with its edge in the air.
 */
export const SLAB_THICK = 0.45;

/**
 * Intensity given to every authored lamp of the building and of the yard.
 *
 * The value is the light budget's business, not this file's: the budget picks the
 * nearest few sources at night and leaves them dark by day, so anything non-zero is
 * simply "eligible". Matching the POI buildings' value keeps a lit homestead and a
 * lit petrol station at the same brightness.
 */
const HOMESTEAD_LAMP_INTENSITY = 0.55;
/** The concrete pad tops this far above the highest terrain under it, so the
 *  heightfield can never poke through the floor. The slab is thick enough that the
 *  LOWEST corner of the footprint still has concrete below the sand: the runout is
 *  level to a tenth of a metre, not exactly, since the landscape's long bands keep
 *  their slope everywhere (see landscape.ts). */
export const SLAB_LIFT = 0.12;

/** Gravel driveway: a filled wedge from the garage door down to the asphalt edge. */
const DRIVE_FAR_U = ROAD_HALF_WIDTH; // meet the road surface, not the shoulder
const DRIVE_V0 = 0.7;
const DRIVE_V1 = 5.1;

/**
 * The gallery variant this homestead is built from: `starter-homestead`, index 25.
 *
 * It is placed by its own local frame rather than by editing its geometry: local x
 * runs FORWARD along the road and local z runs AWAY from it, so the variant's front
 * (-Z) faces the road and its garage wing (+X) points down the road. That is a
 * coordinate swap, which composes with `toWorld` into a proper rotation of the whole
 * building — the compound is not mirrored — and it is how the house and garage end up
 * side by side facing the drive, exactly as the hand-built version was arranged.
 */
const VARIANT_INDEX = 25;
/** The variant's local origin, in (u, v). Its garage door lands on the drive. */
const VARIANT_U = GARAGE_DOOR_U + 5;
const VARIANT_V = (DRIVE_V0 + DRIVE_V1) / 2 - 8.68;
/** Garage centre in the variant's own coordinates: door at local z = -5, centre at x = 8.68. */
const GARAGE_CENTRE_U = VARIANT_U;
const GARAGE_CENTRE_V = VARIANT_V + 8.68;

/**
 * The variant's own extent, MEASURED rather than taken from its declared footprint: a
 * porch, a balcony and a garage wing all project past the declared box. These are the
 * same numbers the world's POI placement measures for this variant.
 */
const VARIANT_HALF_X = 13.7;
const VARIANT_HALF_Z = 7.8;
/** Exported for the same reason as the slab: the bench measures under this footprint. */
/** Yard in front of the garage, beyond the building, for the junk and the fuel can. */
const YARD_M = 3.2;

/** Concrete pad: the building's own extent, plus that yard. */
const PAD_V0 = VARIANT_V - VARIANT_HALF_X;
const PAD_V1 = VARIANT_V + VARIANT_HALF_X + YARD_M;
const PAD_U0 = VARIANT_U - VARIANT_HALF_Z;
const PAD_U1 = VARIANT_U + VARIANT_HALF_Z;

/**
 * How far a pad's edge is graded down into the ground, metres, and in how many steps.
 *
 * The pad's top has to clear the HIGHEST ground under it, or the sand rises inside the
 * garage; so on ground that varies it stands proud somewhere, and a vertical face there is
 * read as a plinth. Measured on this compound: 0.77 m of grey concrete along the building,
 * which is the one thing a player sees from the drive. A real pad on a slope is banked
 * instead, so the edges are given the ground's own material at the ground's own slope.
 *
 * The run is 2.6 m because the shoulder between the pad's near edge and the asphalt is
 * 2.6 m wide: the bank reaches the road edge exactly, and no further.
 */
const BANK_RUN = 2.6;
const BANK_SEGMENTS = 8;
/** Exported so the placement bench measures the bank it actually builds. */
export const HOMESTEAD_BANK = { run: BANK_RUN, segments: BANK_SEGMENTS } as const;

/** The pad's extent, exported so the placement bench measures under the same footprint. */
export const HOMESTEAD_PAD = {
  s: HOMESTEAD_S,
  u0: PAD_U0,
  u1: PAD_U1,
  v0: PAD_V0,
  v1: PAD_V1,
};


/** Layout derived from the seed; shared by the chunk and the scatter helpers. */
export interface HomesteadLayout {
  floorY: number;
  /**
   * Underside of the concrete pad, metres.
   *
   * DERIVED FROM THE GROUND rather than fixed, and that is the difference between a pad
   * that works anywhere and one that works only where it was designed. The top is poured
   * above the HIGHEST ground under the footprint, so the slab has to reach the LOWEST
   * ground or its downhill edge hangs in the air — and the gap is the ground's full height
   * range, not its deviation from a slope, because a garage floor is poured level.
   *
   * The compound is 39 m along the road, four times the hand-built house's pad, so it
   * spans four times the relief: measured, 0.63 m of range against the 0.33 m a 0.45 m
   * slab can bridge. Fixed thickness was therefore already not enough at the road, let
   * alone anywhere else; this makes the pad size itself.
   */
  baseY: number;
  /** Lowest ground under the pad, so a caller can check the slab reached it. */
  padMinGroundY: number;
  roadY: number;
  ax: number;
  az: number;
  fx: number;
  fz: number;
  toWorld(u: number, v: number): [number, number];
  /**
   * The inverse of `toWorld`: where a world point falls in the homestead's own frame.
   *
   * Needed because the building is a catalogue variant placed with its own yaw, and the
   * things that stand on it — the shelf, and the starting items on that shelf — are
   * described in the variant's coordinates. Rather than restate the shelf's place in two
   * frames and let them drift, the variant's point is taken to world and this asks the
   * homestead where that is.
   */
  toUV(x: number, z: number): [number, number];
  /** Where a point in the variant's frame lands in the homestead's frame. */
  variantToUV(x: number, z: number): [number, number];
}

/**
 * Computes the homestead's frame and the concrete-pad height.
 *
 * `floorY` is the *top* of the pad, chosen to clear the tallest terrain point
 * under the footprint plus a lift. The driveway then ramps from `floorY` down to
 * `roadY`, so the garage floor is flush with the driveway and the driveway is
 * flush with the road — a car can roll out without catching a lip. The terrain
 * inside the road corridor is now the road surface itself (see terrain.ts), so
 * the wedge only needs a modest burial to stay below the ground it sits on.
 */
export function homesteadLayout(road: Road, terrain: Terrain): HomesteadLayout {
  const ref = road.sampleAt(HOMESTEAD_S);
  // Forward = direction of travel, right = road's right-hand normal.
  const fx = Math.sin(ref.heading);
  const fz = Math.cos(ref.heading);
  // "Away" points into the desert on the chosen side of the road.
  const ax = SIDE * Math.cos(ref.heading);
  const az = -SIDE * Math.sin(ref.heading);

  const toWorld = (u: number, v: number): [number, number] => [
    ref.x + ax * u + fx * v,
    ref.z + az * u + fz * v,
  ];
  // `away` and `forward` are orthonormal, so the inverse is two dot products.
  const toUV = (x: number, z: number): [number, number] => [
    (x - ref.x) * ax + (z - ref.z) * az,
    (x - ref.x) * fx + (z - ref.z) * fz,
  ];

  // The slab tops the HIGHEST ground under its footprint (see SLAB_LIFT), which is
  // the one number `fitGround` is asked for here; the pad is poured level because a
  // garage floor is, and its thickness carries the rest.
  const uc = (PAD_U0 + PAD_U1) / 2;
  const vc = (PAD_V0 + PAD_V1) / 2;
  const [cx, cz] = toWorld(uc, vc);
  const plane = fitGround(
    terrain,
    cx,
    cz,
    ref.heading,
    (PAD_U1 - PAD_U0) / 2,
    (PAD_V1 - PAD_V0) / 2,
    HOMESTEAD_S,
    9,
  );
  const floorY = plane.maxY + SLAB_LIFT;
  // At least SLAB_THICK of concrete, and ALWAYS below the lowest ground: the pad's job
  // is to be underground at its shallowest point.
  const baseY = Math.min(plane.minY - 0.05, floorY - SLAB_THICK);

  // The same placement the building gets below: `toWorld` of the variant's origin, with
  // the building yawed to face the road. Recomputed here rather than shared because the
  // layout is what both this and the geometry are derived from — and `homesteadLayout` is
  // pure, so the two agree by construction.
  const variantYaw = Math.atan2(ax, az);
  const [vx0, vz0] = toWorld(VARIANT_U, VARIANT_V);
  const variantToUV = (x: number, z: number): [number, number] => {
    const cos = Math.cos(variantYaw);
    const sin = Math.sin(variantYaw);
    return toUV(vx0 + x * cos + z * sin, vz0 - x * sin + z * cos);
  };

  return {
    floorY,
    baseY,
    toUV,
    variantToUV,
    padMinGroundY: plane.minY,
    roadY: ref.y,
    ax,
    az,
    fx,
    fz,
    toWorld,
  };
}

/** Local (u, v, y) box -> world axis-aligned box. Exact because the frame is flat. */
function boxUV(
  L: HomesteadLayout,
  u0: number,
  v0: number,
  y0: number,
  u1: number,
  v1: number,
  y1: number,
): [V3, V3] {
  const [x0, z0] = L.toWorld(u0, v0);
  const [x1, z1] = L.toWorld(u1, v1);
  return [
    [Math.min(x0, x1), y0, Math.min(z0, z1)],
    [Math.max(x0, x1), y1, Math.max(z0, z1)],
  ];
}

/** Accumulates axis-aligned boxes into one merged triangle mesh per surface. */
class TrimeshAcc {
  readonly verts: number[] = [];
  readonly idx: number[] = [];

  addBox(min: V3, max: V3): void {
    const [x0, y0, z0] = min;
    const [x1, y1, z1] = max;
    const b = this.verts.length / 3;
    this.verts.push(
      x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0,
      x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1,
    );
    // 12 triangles, wound counter-clockwise from outside the box so the
    // right-hand-rule normals point outward. Rapier treats trimeshes as solid
    // from both sides, so this does not change the collision, but keeping the
    // winding correct means the acc is safe to reuse for a one-sided visual
    // without reintroducing the inside-out-face bug.
    this.idx.push(
      b + 4, b + 5, b + 6, b + 4, b + 6, b + 7, // +z
      b + 1, b + 0, b + 2, b + 0, b + 3, b + 2, // -z
      b + 5, b + 1, b + 6, b + 1, b + 2, b + 6, // +x
      b + 0, b + 4, b + 3, b + 4, b + 7, b + 3, // -x
      b + 2, b + 3, b + 6, b + 3, b + 7, b + 6, // +y
      b + 0, b + 1, b + 5, b + 0, b + 5, b + 4, // -y
    );
  }

  addIndexed(verts: number[], tris: number[]): void {
    const base = this.verts.length / 3;
    for (const v of verts) this.verts.push(v);
    for (const t of tris) this.idx.push(base + t);
  }
}

interface BuildCtx {
  group: THREE.Group;
  concrete: TrimeshAcc;
  gravel: TrimeshAcc;
  /** The graded banks around the pad, which the player walks on rather than through. */
  bank: TrimeshAcc;
  geos: THREE.BufferGeometry[];
  L: HomesteadLayout;
  /** The chunk's floating origin; every f32/Rapier write subtracts these. */
  ox: number;
  oz: number;
}

/** Solid box: visual + collider. */
function solid(ctx: BuildCtx, box: [V3, V3], acc: TrimeshAcc, material: THREE.Material): void {
  visual(ctx, box, material);
  acc.addBox(
    [box[0][0] - ctx.ox, box[0][1], box[0][2] - ctx.oz],
    [box[1][0] - ctx.ox, box[1][1], box[1][2] - ctx.oz],
  );
}

/** Visual-only box (glass, frames, fence, jack stands). */
function visual(ctx: BuildCtx, box: [V3, V3], material: THREE.Material): void {
  const [min, max] = box;
  const geo = new THREE.BoxGeometry(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.set((min[0] + max[0]) / 2 - ctx.ox, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2 - ctx.oz);
  ctx.group.add(mesh);
  ctx.geos.push(geo);
}

/** Cylinder prop. When `acc` is given it also gets an approximating box collider. */
function cylinder(
  ctx: BuildCtx,
  cx: number,
  cy: number,
  cz: number,
  radius: number,
  height: number,
  material: THREE.Material,
  segments: number,
  acc?: TrimeshAcc,
): void {
  const geo = new THREE.CylinderGeometry(radius, radius, height, segments);
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.set(cx - ctx.ox, cy, cz - ctx.oz);
  ctx.group.add(mesh);
  ctx.geos.push(geo);
  if (acc) {
    acc.addBox(
      [cx - radius - ctx.ox, cy - height / 2, cz - radius - ctx.oz],
      [cx + radius - ctx.ox, cy + height / 2, cz + radius - ctx.oz],
    );
  }
}

/**
 * The driveway as a filled gravel wedge: ramp top, buried bottom, closed ends.
 *
 * Winding requirement: every face must wind counter-clockwise as seen from
 * *outside* the solid, so the right-hand-rule normal points outward. A face
 * wound backwards renders as a dark hole — the exact bug that once ate the
 * ground in front of the garage. Corner indices are:
 *   0 near-top-lo, 1 near-top-hi, 2 far-top-lo, 3 far-top-hi,
 *   4 near-bot-lo, 5 near-bot-hi, 6 far-bot-lo, 7 far-bot-hi,
 * where near/far = garage door / road edge and lo/hi = DRIVE_V0 / DRIVE_V1.
 * The runout is axis-aligned, so near = -x, far = +x, lo = -z, hi = +z.
 */
function drivewayData(L: HomesteadLayout): { verts: number[]; tris: number[] } {
  // Buried as deep as the slab, for the same reason: the ground beside the runout is
  // level to a tenth of a metre rather than exactly, so a shallow wedge shows its
  // underside on the low side.
  const base = Math.min(L.baseY, L.roadY - SLAB_THICK);
  const top0 = L.floorY;
  const top1 = L.roadY;
  const corners: V3[] = [
    [GARAGE_DOOR_U, DRIVE_V0, top0], [GARAGE_DOOR_U, DRIVE_V1, top0],
    [DRIVE_FAR_U, DRIVE_V0, top1], [DRIVE_FAR_U, DRIVE_V1, top1],
    [GARAGE_DOOR_U, DRIVE_V0, base], [GARAGE_DOOR_U, DRIVE_V1, base],
    [DRIVE_FAR_U, DRIVE_V0, base], [DRIVE_FAR_U, DRIVE_V1, base],
  ];
  const verts: number[] = [];
  for (const [u, v, y] of corners) {
    const [x, z] = L.toWorld(u, v);
    verts.push(x, y, z);
  }
  const tris = [
    0, 1, 3, 0, 3, 2, // top ramp (outward +y)
    6, 7, 5, 6, 5, 4, // bottom (outward -y)
    0, 4, 5, 0, 5, 1, // near end, garage door (outward -x)
    2, 3, 7, 2, 7, 6, // far end, road edge (outward +x)
    0, 2, 6, 0, 6, 4, // v-lo side (outward -z)
    1, 5, 7, 1, 7, 3, // v-hi side (outward +z)
  ];
  return { verts, tris };
}

/**
 * The pad's edges, graded into the ground.
 *
 * A STRIP, NOT A BOX, and its outer edge is the terrain itself: the inner edge is the
 * pad's top edge and the outer one is the ground `BANK_RUN` away, so the bank meets both
 * exactly and cannot leave a lip at either end. Its triangles are wound so their normals
 * point up, computed rather than reasoned about — a bank facing away from the sky is
 * invisible from the drive, which is the only place anyone looks at it.
 *
 * `skip` names one edge that the driveway crosses, because a bank through the middle of
 * the drive would be a ridge across the garage's own doorway.
 */
function bankData(L: HomesteadLayout, terrain: Terrain): { verts: number[]; tris: number[] } {
  const edges: { from: [number, number]; to: [number, number]; out: [number, number] }[] = [
    // Near edge, split around the driveway (DRIVE_V0..DRIVE_V1).
    { from: [PAD_U0, PAD_V0], to: [PAD_U0, DRIVE_V0], out: [-1, 0] },
    { from: [PAD_U0, DRIVE_V1], to: [PAD_U0, PAD_V1], out: [-1, 0] },
    { from: [PAD_U1, PAD_V0], to: [PAD_U1, PAD_V1], out: [1, 0] },
    { from: [PAD_U0, PAD_V0], to: [PAD_U1, PAD_V0], out: [0, -1] },
    { from: [PAD_U0, PAD_V1], to: [PAD_U1, PAD_V1], out: [0, 1] },
  ];

  const verts: number[] = [];
  const tris: number[] = [];
  for (const edge of edges) {
    const base = verts.length / 3;
    for (let i = 0; i <= BANK_SEGMENTS; i++) {
      const f = i / BANK_SEGMENTS;
      const u = edge.from[0] + (edge.to[0] - edge.from[0]) * f;
      const v = edge.from[1] + (edge.to[1] - edge.from[1]) * f;
      const outerU = u + edge.out[0] * BANK_RUN;
      const outerV = v + edge.out[1] * BANK_RUN;
      const [ix, iz] = L.toWorld(u, v);
      const [ox, oz] = L.toWorld(outerU, outerV);
      verts.push(ix, L.floorY, iz);
      verts.push(ox, terrain.heightAt(ox, oz, HOMESTEAD_S), oz);
    }
    for (let i = 0; i < BANK_SEGMENTS; i++) {
      const a = base + i * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      // Up-facing normals, decided by arithmetic rather than by getting the winding
      // right in the head: the cross product of the first two edges says which way the
      // face points, and a bank pointing at the ground is a hole in the yard.
      const ax = verts[b * 3]! - verts[a * 3]!;
      const ay = verts[b * 3 + 1]! - verts[a * 3 + 1]!;
      const az = verts[b * 3 + 2]! - verts[a * 3 + 2]!;
      const bx = verts[d * 3]! - verts[a * 3]!;
      const by = verts[d * 3 + 1]! - verts[a * 3 + 1]!;
      const bz = verts[d * 3 + 2]! - verts[a * 3 + 2]!;
      const ny = az * bx - ax * bz;
      if (ny >= 0) {
        tris.push(a, b, d, a, d, c);
      } else {
        tris.push(a, d, b, a, c, d);
      }
    }
  }
  return { verts, tris };
}

// ---------------------------------------------------------------------------
// The chunk provider: static geometry only, chunk 0 alone.
// ---------------------------------------------------------------------------

export class HomesteadProvider implements ChunkProvider {
  readonly id = 'homestead';

  /**
   * The homestead places the same catalogue building the road does, so its light switches
   * have to be registered the same way — otherwise the first building a player ever stands
   * in is the one building whose lights cannot be worked, which is exactly the kind of gap
   * that survives a screenshot.
   */
  constructor(private readonly switches: PoiSwitchField) {}

  build(ctx: ChunkContext): ChunkContent | null {
    if (ctx.chunkIndex !== 0) return null;

    const L = homesteadLayout(ctx.road, ctx.terrain);
    const ox = ctx.originX;
    const oz = ctx.originZ;
    const group = new THREE.Group();
    const concrete = new TrimeshAcc();
    const gravel = new TrimeshAcc();
    const bank = new TrimeshAcc();
    const registeredSwitches: string[] = [];
    const geos: THREE.BufferGeometry[] = [];
    const mats: THREE.Material[] = [];

    const bctx: BuildCtx = { group, concrete, gravel, bank, geos, L, ox, oz };

    const mat = (color: number, o: { metalness?: number; roughness?: number; transparent?: boolean; opacity?: number } = {}) => {
      const m = new THREE.MeshStandardMaterial({
        color,
        metalness: o.metalness ?? 0,
        roughness: o.roughness ?? 0.9,
        transparent: o.transparent ?? false,
        opacity: o.opacity ?? 1,
      });
      mats.push(m);
      return m;
    };

    const floorMat = mat(0x9a978f, { roughness: 0.95 });
    // The ground's own colour at this arclength, so the bank is the ground and not a
    // second kind of dirt beside it.
    const bankMat = mat(desertPaletteAt(HOMESTEAD_S).sand, { roughness: 1 });
    const gravelMat = mat(0x7a6c56, { roughness: 1 });
    const drumMatA = mat(0x8b3a2a, { metalness: 0.5, roughness: 0.7 });
    const drumMatB = mat(0x5a6b3a, { metalness: 0.5, roughness: 0.7 });
    const tyreMat = mat(0x1a1a1a);
    const metalMat = mat(0x4c4c50, { metalness: 0.6, roughness: 0.6 });
    const tankMat = mat(0x6e7b6a, { metalness: 0.5, roughness: 0.7 });
    const fenceMat = mat(0x6b5138);

    const fy = L.floorY;

    // --- Shared concrete pad (garage floor + house floor, one flush slab) ----
    solid(bctx, boxUV(L, PAD_U0, PAD_V0, L.baseY, PAD_U1, PAD_V1, fy), concrete, floorMat);

    // --- Its edges, graded into the ground --------------------------------
    //
    // Without this the pad presents a vertical face wherever the ground is lower than its
    // top — measured 0.77 m of concrete along the building, which reads as a plinth. See
    // `BANK_RUN`.
    {
      const { verts, tris } = bankData(L, ctx.terrain);
      for (let i = 0; i < verts.length; i += 3) {
        verts[i] = verts[i]! - ox;
        verts[i + 2] = verts[i + 2]! - oz;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      geo.setIndex(tris);
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, bankMat);
      mesh.receiveShadow = true;
      // Tagged so the placement bench can find the bank and check the one thing about it
      // that is invisible when wrong: a strip whose faces point at the ground is a hole in
      // the yard, and it looks like nothing at all from above.
      mesh.userData.poiBank = true;
      group.add(mesh);
      geos.push(geo);
      bank.addIndexed(verts, tris);
    }

    // --- THE HOUSE AND GARAGE: the gallery's `starter-homestead` variant -------
    //
    // The building is not built here any more. It is the catalogue's own compound,
    // placed as a unit and collided as a unit, which is what keeps this file from
    // drifting away from the thing the POI gallery shows.
    //
    // Its local frame maps onto this one by a coordinate swap: the variant's front
    // (-Z) faces the road, and its garage wing (+X) runs forward along it. Composed
    // with `toWorld` that is a proper rotation of the whole building, so the compound
    // is NOT mirrored — house and garage stand side by side facing the drive, which is
    // how the hand-built version was arranged. `yaw` is the same angle the world's POI
    // placement uses for the same reason: `atan2(awayX, awayZ)` turns a building's
    // front toward the centreline.
    {
      const instance = createVariantInstance(VARIANT_INDEX);
      const [bx, bz] = L.toWorld(VARIANT_U, VARIANT_V);
      const yaw = Math.atan2(L.ax, L.az);
      const quat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0, 'YXZ'));

      instance.group.position.set(bx - ox, fy, bz - oz);
      instance.group.quaternion.copy(quat);
      instance.group.updateMatrixWorld(true);
      group.add(instance.group);
      registerPlacedSwitches(
        this.switches,
        instance,
        'home-switch',
        registeredSwitches,
        ox,
        oz,
      );

      // Its wall lights become light-budget sources, so they carry the budget that
      // every other artificial light in the world already obeys instead of adding
      // eleven uncompiled lights to the scene the moment the player spawns.
      for (const source of instance.lightSources) {
        source.intensity = HOMESTEAD_LAMP_INTENSITY;
        source.userData.lightBudgetSource = true;
      }

      if (ctx.hasPhysics) {
        // One trimesh for the whole building. Roofs are excluded from `solid`, so the
        // interior is entered through its doors rather than sealed by its roof, and
        // the wall openings the catalogue builds stay openings.
        const matrix = new THREE.Matrix4().compose(
          new THREE.Vector3(bx, fy, bz),
          quat,
          new THREE.Vector3(1, 1, 1),
        );
        const position = instance.solid.getAttribute('position');
        const v = new THREE.Vector3();
        const verts: number[] = [];
        for (let i = 0; i < position.count; i++) {
          v.fromBufferAttribute(position, i).applyMatrix4(matrix);
          verts.push(v.x, v.y, v.z);
        }
        const tris: number[] = [];
        for (let i = 0; i < position.count; i++) tris.push(i);
        concrete.addIndexed(verts, tris);
      }
    }

    // --- Driveway (gravel wedge, ramps flush to the road) ---
    {
      const { verts, tris } = drivewayData(L);
      // Rebase the shared vertex set ONCE: `verts` feeds both the driveway mesh's
      // Float32BufferAttribute and, via `gravel`, the trimesh collider below. A
      // second subtraction in either consumer would offset the shell from its
      // collider.
      for (let i = 0; i < verts.length; i += 3) {
        verts[i] -= ox;
        verts[i + 2] -= oz;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      geo.setIndex(tris);
      geo.computeVertexNormals();
      // Closed solid with outward winding: default front-face culling is correct,
      // so no DoubleSide workaround is needed here.
      const mesh = new THREE.Mesh(geo, gravelMat);
      group.add(mesh);
      geos.push(geo);
      gravel.addIndexed(verts, tris);
    }

    // --- Workbench (solid block; small parts rest on top) ---


    // --- Junk: oil drums, tyre stack, jack stands ---
    //
    // On the YARD now, not beside the garage door: the building is the catalogue's
    // and fills its own footprint, so anything this file adds would stand inside a
    // wall. The yard is the strip the pad keeps in front of the garage for exactly
    // this, and the cluster reads the same from the drive.
    const yardU = PAD_U1 - YARD_M * 0.55;
    const [d1x, d1z] = L.toWorld(yardU, GARAGE_CENTRE_V - 1.2);
    const [d2x, d2z] = L.toWorld(yardU + 0.6, GARAGE_CENTRE_V - 0.7);
    const [d3x, d3z] = L.toWorld(yardU, GARAGE_CENTRE_V - 2.2);
    cylinder(bctx, d1x, fy + 0.45, d1z, 0.32, 0.9, drumMatA, 18, concrete);
    cylinder(bctx, d2x, fy + 0.45, d2z, 0.32, 0.9, drumMatB, 18, concrete);
    cylinder(bctx, d3x, fy + 0.45, d3z, 0.32, 0.9, drumMatA, 18, concrete);

    // Tyre stack: three tyres lying flat.
    const [tx, tz] = L.toWorld(yardU - 0.3, GARAGE_CENTRE_V - 2.8);
    for (let k = 0; k < 3; k++) {
      cylinder(bctx, tx, fy + 0.09 + k * 0.18, tz, 0.35, 0.18, tyreMat, 20, concrete);
    }

    // Jack stands: small tripods on the yard, where the car's wheels will go.
    const [j1x, j1z] = L.toWorld(yardU + 0.9, GARAGE_CENTRE_V + 1.6);
    const [j2x, j2z] = L.toWorld(yardU + 0.9, GARAGE_CENTRE_V + 3.0);
    visual(bctx, [ [j1x - 0.14, fy, j1z - 0.14], [j1x + 0.14, fy + 0.5, j1z + 0.14] ], metalMat);
    visual(bctx, [ [j2x - 0.14, fy, j2z - 0.14], [j2x + 0.14, fy + 0.5, j2z + 0.14] ], metalMat);

    // --- Water tank beside the house ---
    {
      const [tx2, tz2] = L.toWorld(PAD_U1 + 0.2, GARAGE_CENTRE_V - 3.0);
      const ground = ctx.terrain.heightAt(tx2, tz2, HOMESTEAD_S);
      cylinder(bctx, tx2, ground + 1.1, tz2, 0.9, 2.2, tankMat, 24, concrete);
    }

    // --- Fence line behind the house ---
    {
      const fenceU = PAD_U1 + 0.6;
      let refGround = 0;
      for (let i = 0; i < 5; i++) {
        const v = -5 + i * 2.5;
        const [px, pz] = L.toWorld(fenceU, v);
        const ground = ctx.terrain.heightAt(px, pz, HOMESTEAD_S);
        if (i === 2) refGround = ground;
        visual(bctx, [ [px - 0.07, ground, pz - 0.07], [px + 0.07, ground + 1.3, pz + 0.07] ], fenceMat);
      }
      const [r1x, r1z] = L.toWorld(fenceU, -5);
      const [r2x, r2z] = L.toWorld(fenceU, 5);
      visual(bctx, [ [Math.min(r1x, r2x) - 0.04, refGround + 0.5, Math.min(r1z, r2z) - 0.04], [Math.max(r1x, r2x) + 0.04, refGround + 0.58, Math.max(r1z, r2z) + 0.04] ], fenceMat);
      visual(bctx, [ [Math.min(r1x, r2x) - 0.04, refGround + 1.0, Math.min(r1z, r2z) - 0.04], [Math.max(r1x, r2x) + 0.04, refGround + 1.08, Math.max(r1z, r2z) + 0.04] ], fenceMat);
    }

    // --- Lights: modest pools at the garage door. Born dark; the LightBudget
    // (src/render/lights.ts) enables them only at night and only while the
    // homestead is within the light cutoff of the camera. ---
    const [glx, glz] = L.toWorld(GARAGE_CENTRE_U + 2.0, GARAGE_CENTRE_V);
    const garageLight = new THREE.PointLight(0xffd9a0, HOMESTEAD_LAMP_INTENSITY, 16, 2);
    garageLight.position.set(glx - ox, fy + 2.3, glz - oz);
    garageLight.name = 'garageLight';
    garageLight.visible = false;
    group.add(garageLight);

    // The yard lamp, which is what makes the compound read as inhabited from the road.
    const [dlx, dlz] = L.toWorld(GARAGE_DOOR_U - 1.2, GARAGE_CENTRE_V);
    const doorLight = new THREE.PointLight(0xffe0b0, HOMESTEAD_LAMP_INTENSITY, 12, 2);
    doorLight.position.set(dlx - ox, fy + 2.5, dlz - oz);
    doorLight.name = 'doorLight';
    doorLight.visible = false;
    group.add(doorLight);

    // --- Physics ---
    const bodies: RAPIER.RigidBody[] = [];
    const colliders: RAPIER.Collider[] = [];
    if (ctx.hasPhysics) {
      const buildTrimesh = (acc: TrimeshAcc, surface: SurfaceType): void => {
        if (acc.idx.length === 0) return;
        const collider = ctx.physics.addStaticTrimesh(
          new Float32Array(acc.verts),
          new Uint32Array(acc.idx),
          surface,
        );
        colliders.push(collider);
        const bodyRef = collider.parent();
        if (bodyRef) bodies.push(bodyRef);
      };
      buildTrimesh(concrete, SurfaceType.Concrete);
      buildTrimesh(gravel, SurfaceType.Gravel);
      buildTrimesh(bank, SurfaceType.Sand);
    }

    return {
      group,
      bodies,
      colliders,
      dispose: () => {
        this.switches.forget(registeredSwitches);
        for (const g of geos) g.dispose();
        for (const m of mats) m.dispose();
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Starting car
// ---------------------------------------------------------------------------


/**
 * Where a new game drops the player, and which way they face.
 *
 * This exists because the world does not extend behind s = 0 — spawning at the
 * default player position would put the player outside every generated chunk,
 * staring into the sky dome. Returns a FEET position, as `Player.teleport` expects.
 *
 * The player stands alongside the parked car (which occupies the garage centre)
 * and faces out through the open front, so the first thing on screen is the car
 * and the road beyond it.
 */
export function homesteadSpawn(
  road: Road,
  terrain: Terrain,
): { x: number; y: number; z: number; yaw: number } {
  const L = homesteadLayout(road, terrain);
  // Alongside the parked car, one bay toward the garage's -v wall.
  const [x, z] = L.toWorld(GARAGE_CENTRE_U, GARAGE_CENTRE_V - 2.2);
  // Facing out of the garage is the -away direction; yaw is measured from +Z.
  return { x, y: L.floorY, z, yaw: Math.atan2(-L.ax, -L.az) };
}

/**
 * Builds the starter car: a deterministic seed-based pick from the whole catalogue,
 * parked in the garage facing the door, bare
 * mounted yet. Fuel starts low but non-zero, clamped to the selected tank.
 */
export function createStartingCar(world: GameWorld): CarState {
  const road = new Road(world.seed);
  const terrain = new Terrain(world.seed, road);
  const L = homesteadLayout(road, terrain);

  const def = pick(CAR_MODELS, world.seed, 0x3f0);
  const engine = modelEngine(def);

  // Keep the existing deterministic fuel roll, clamped to the tank's capacity.
  const fuelLitres = Math.min(4 + hash01(world.seed, 0x3f1) * 6, def.tankLitres);
  const bonnet = createBonnetStorage('car:start', def.engineId, def.bodyClass, def.tankLitres);
  // Water and oil start part-used on the same deterministic principle: the car
  // has been sitting in a shed, not prepped. Enough to set off on, not enough to
  // finish on, which is what makes the first can worth picking up.
  const waterLitres = bonnetWaterCapacity(bonnet) * (0.45 + hash01(world.seed, 0x3f2) * 0.3);
  const oilLitres = oilCapacity(engine) * (0.4 + hash01(world.seed, 0x3f3) * 0.35);

  const measure = carModelMeasure(def.id);
  const carY = carSpawnYAboveGround(measure, L.floorY, GARAGE_CAR_DROP_METRES);
  // The variant's own garage centre, so the car stands in the bay rather than beside it.
  const [cx, cz] = L.toWorld(GARAGE_CENTRE_U, GARAGE_CENTRE_V);
  // Face the door: body +Z -> "toward the road" (-away), i.e. world +X here.
  const yaw = Math.atan2(-L.ax, -L.az);
  const half = yaw / 2;

  return {
    id: 'car:start',
    modelId: def.id,
    stickers: [],
    headlightMode: 'off',
    taillightsOn: false,
    reverseLightsOn: false,
    // It has been standing in a shut garage, not in a showroom. Enough dust to read
    // as stored; the player's first wash is a tutorial nobody has to write.
    dirt: 0.4,
    scratches: 0,
    fuelLitres,
    fuelKind: engine.fuel,
    waterLitres,
    oilLitres,
    // Stood in a shut garage overnight: cold, whatever the afternoon outside is.
    engineTempC: COLD_SOAK_C,
    storage: new Array<Item | null>(def.storageCells).fill(null),
    bonnet,
    odometer: 0,
    x: cx,
    y: carY,
    z: cz,
    qx: 0,
    qy: Math.sin(half),
    qz: 0,
    qw: Math.cos(half),
  };
}

// ---------------------------------------------------------------------------
// Starting items
// ---------------------------------------------------------------------------

/**
 * Places the starter fuel can, two medicine bottles and distinctive handheld tools
 * around the homestead: the tools on the garage shelf, the can on the yard beside the
 * garage door, the ball on the sand. This runs only for a new world, so stable generated
 * ids can never restock something the player has already taken.
 */
export function spawnStartingItems(world: GameWorld, loose: LoosePartField): void {
  const road = new Road(world.seed);
  const terrain = new Terrain(world.seed, road);
  const L = homesteadLayout(road, terrain);

  // The can stands on the yard beside the garage door, where the player cannot miss
  // it on the way out.
  const [canX, canZ] = L.toWorld(
    PAD_U1 - YARD_M * 0.5 + (hash01(world.seed, 0x94d, 2) - 0.5) * 0.2,
    GARAGE_CENTRE_V + 0.4 + (hash01(world.seed, 0x95d, 2) - 0.5) * 0.2,
  );
  loose.spawnItem(
    {
      type: 'fluid_can',
      id: world.generatedPartId('home_item', 0, 2),
      fluid: modelEngine(pick(CAR_MODELS, world.seed, 0x3f0)).fuel,
      capacity: 20,
      litres: Math.round((12 + hash01(world.seed, 0x9ef) * 8) * 10) / 10,
    },
    canX,
    L.floorY + 0.28,
    canZ,
  );

  // Camera, watch and medicine wait ON THE GARAGE SHELF, which is where a person walks
  // past on the way to the car. They used to stand on a workbench just inside the garage
  // door, and that bench had to go: it stood in the doorway the car drives through and in
  // the player's path, for the sake of holding four small objects a shelf was already
  // holding.
  //
  // A point on the shelf is given as a distance ALONG it and a distance across it, in the
  // shelf's own frame, and `variantToUV` resolves that into the homestead's. The plank
  // heights come from the catalogue that builds the shelf, so moving or restacking it
  // takes the items with it instead of leaving them in the sand.
  const shelfAt = (along: number, across: number): [number, number] => {
    // `variantToUV` answers in the homestead's own frame; `toWorld` is what turns that
    // into somewhere to stand.
    const [su, sv] = L.variantToUV(
      STARTER_GARAGE_SHELF.centreX + across,
      STARTER_GARAGE_SHELF.centreZ - along,
    );
    return L.toWorld(su, sv);
  };
  const topPlank = L.floorY + SHELF_PLANK_TOP(3);
  const middlePlank = L.floorY + SHELF_PLANK_TOP(2);

  // The top plank, because the camera is the tallest thing here and the plank above a
  // lower one is only 0.37 m away — which a camera fits under only just.
  const [cameraX, cameraZ] = shelfAt(-0.9, 0.02);
  loose.spawnItem(
    {
      type: 'camera',
      id: world.generatedPartId('home_item', 0, 3),
      framesRemaining: CAMERA_FRAME_LIMIT,
    },
    cameraX,
    topPlank + 0.14,
    cameraZ,
  );
  const [watchX, watchZ] = shelfAt(-0.3, -0.02);
  loose.spawnItem(
    {
      type: 'pocket_watch',
      id: world.generatedPartId('home_item', 0, 4),
    },
    watchX,
    topPlank + 0.08,
    watchZ,
  );

  // Two complete doses wait in the garage together: enough to teach the item's
  // value without making the rest of the road's rare POI finds redundant.
  for (let i = 0; i < 2; i++) {
    const [medicineX, medicineZ] = shelfAt(0.4 + i * 0.55, 0);
    loose.spawnItem(
      {
        type: 'medicine',
        id: world.generatedPartId('home_item', 0, 6 + i),
      },
      medicineX,
      middlePlank + 0.12,
      medicineZ,
    );
  }


  // The ball starts on bare ground beside the drive, with the centre one radius
  // above the terrain so it neither floats nor spawns intersecting the sand.
  // Off the pad, on the sand: the ball belongs on bare ground, and the pad's near
  // edge is where bare ground now starts.
  const [ballX, ballZ] = L.toWorld(PAD_U0 - 1.0, GARAGE_CENTRE_V + 4.0);
  loose.spawnItem(
    {
      type: 'football',
      id: world.generatedPartId('home_item', 0, 5),
    },
    ballX,
    terrain.heightAt(ballX, ballZ, HOMESTEAD_S) + FOOTBALL_RADIUS,
    ballZ,
  );
}

