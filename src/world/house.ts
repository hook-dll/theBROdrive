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
import { fitGround, type GroundPlane } from './footprint';
import { createVariantInstance, registerPlacedSwitches } from './poivariantbuild';
import { poseMatrix, geometryToTrimesh } from './poi';
import type { PoiSwitchField } from './poiswitches';
import { SHELF_PLANK_TOP } from './poi/kit';
import { STARTER_GARAGE_SHELF } from './poi/starter';
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
 * Garage door line: the building's garage front sits here. It is also the
 * homestead's NEAREST point to the road, so this number is the homestead's setback.
 *
 * Kept inside the 30 m corridor the terrain is fitted to (`terrain.ts`): past that
 * the landscape's long bands return and keep their slope everywhere, so distance
 * from the road is bought with relief. The building is TILTED onto the ground
 * rather than levelled on a slab (see `homesteadLayout`), so what this setback
 * actually buys is a gentler grade to tilt onto, not a shallower pad —
 * `tools/poi-placement.ts` measures the grade this site produces.
 */
const GARAGE_DOOR_U = 13.3;
/** Small free-fall inside the low garage; the open-world 0.75 m drop hits its roof. */
const GARAGE_CAR_DROP_METRES = 0.08;
/** Clears the player's teleported feet strictly above the sand, not exactly on it,
 *  so a float rounding error at spawn can never read as standing inside the ground. */
const SPAWN_CLEARANCE_M = 0.05;

/**
 * Intensity given to every authored lamp of the building and of the yard.
 *
 * The value is the light budget's business, not this file's: the budget picks the
 * nearest few sources at night and leaves them dark by day, so anything non-zero is
 * simply "eligible". Matching the POI buildings' value keeps a lit homestead and a
 * lit petrol station at the same brightness.
 */
const HOMESTEAD_LAMP_INTENSITY = 0.55;

/**
 * How far below the fitted ground plane the building is sunk, on top of the
 * plane's own residual (see `GroundPlane` in `footprint.ts`). Mirrors the general
 * POI system's own `SEAT_BURY_MARGIN` (`poi.ts`) so the one hand-placed building in
 * the game is buried by the same rule as the whole catalogue.
 */
const SEAT_BURY_MARGIN = 0.08;

/** Where the variant's garage door has to land relative to the road, so the car
 *  drives straight out onto it. Not a physical strip any more — there is no
 *  driveway mesh — just the anchor `VARIANT_V` is measured from. */
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
/** Yard in front of the garage, beyond the building, for the junk and the fuel can. */
const YARD_M = 3.2;

/** The compound's footprint: the building's own extent, plus that yard. Purely the
 *  rectangle `homesteadLayout` fits its one ground plane under — there is no pad. */
const PAD_V0 = VARIANT_V - VARIANT_HALF_X;
const PAD_V1 = VARIANT_V + VARIANT_HALF_X + YARD_M;
const PAD_U0 = VARIANT_U - VARIANT_HALF_Z;
const PAD_U1 = VARIANT_U + VARIANT_HALF_Z;

/** The compound's footprint, exported so the placement bench measures the ground
 *  under the same rectangle the building is fitted to. */
export const HOMESTEAD_FOOTPRINT = {
  s: HOMESTEAD_S,
  u0: PAD_U0,
  u1: PAD_U1,
  v0: PAD_V0,
  v1: PAD_V1,
};


/** Layout derived from the seed; shared by the chunk and the scatter helpers. */
export interface HomesteadLayout {
  /**
   * One ground plane fitted under the whole compound. The building is tilted onto
   * it (`plane.pitch`/`plane.roll`) rather than levelled on a slab — see
   * `homesteadLayout` for why, and `poi.ts`'s `buildVariantPoi`, which retired the
   * same slab from the general POI system after measuring this exact building's
   * version of it at 0.82 m deep.
   */
  plane: GroundPlane;
  /** World Y the building's local origin sits at: on the plane, sunk by its own
   *  residual and `SEAT_BURY_MARGIN`, so no wall ever stands on air. */
  seatY: number;
  /** The building's own yaw: `atan2(away.x, away.z)`, turning its front to the road. */
  yaw: number;
  /** World-frame "away from the road" unit vector; `atan2(-ax, -az)` faces the road. */
  ax: number;
  az: number;
  /**
   * Height of the (tilted, sunk) floor surface at a homestead-frame (u, v) point.
   *
   * Not a single `floorY`: once the building is tilted its floor is a plane, not a
   * height, so anything that has to stand exactly on it — the player's spawn feet,
   * the parked car, an item on a shelf — asks for its own point rather than sharing
   * one number that was only ever true at the plane's own centre.
   */
  floorYAt(u: number, v: number): number;
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
 * Computes the homestead's frame, its fitted ground plane, and the tilt/bury that
 * seats the building directly on the sand — no slab, no apron.
 *
 * ONE plane is fitted under the whole compound (not a slab-sized patch at the
 * garage): the building is tilted onto `plane.pitch`/`plane.roll` and sunk by
 * `plane.residual + SEAT_BURY_MARGIN`, the same pattern `poi.ts`'s own
 * `buildVariantPoi` uses for every other building in the game — see the comment
 * there for why a level slab was the wrong trade, on this exact building, before
 * this file even stopped building one of its own.
 *
 * `fitGround`'s own (right, forward) axes are the object's own (+X, +Z) once yawed
 * by the angle passed in. Passing this building's own `yaw` below (not the road's
 * `heading`, which is 90° off it) makes `right` the along-road (v) direction and
 * `forward` the away-from-road (u) direction, so the half-extents passed to
 * `fitGround` are `(v-extent, u-extent)`, not `(u-extent, v-extent)`.
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

  const yaw = Math.atan2(ax, az);
  const uc = (PAD_U0 + PAD_U1) / 2;
  const vc = (PAD_V0 + PAD_V1) / 2;
  const [cx, cz] = toWorld(uc, vc);
  const plane = fitGround(
    terrain,
    cx,
    cz,
    yaw,
    (PAD_V1 - PAD_V0) / 2,
    (PAD_U1 - PAD_U0) / 2,
    HOMESTEAD_S,
    9,
  );
  const seatY = plane.centreY - plane.residual - SEAT_BURY_MARGIN;
  // The floor is the SAME rigid tilted plane everywhere, so any point on it is
  // buried by the same residual + margin as the centre, not just correct there.
  const floorYAt = (u: number, v: number): number =>
    plane.yAt(v - vc, u - uc) - plane.residual - SEAT_BURY_MARGIN;

  const [vx0, vz0] = toWorld(VARIANT_U, VARIANT_V);
  const variantToUV = (x: number, z: number): [number, number] => {
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    return toUV(vx0 + x * cos + z * sin, vz0 - x * sin + z * cos);
  };

  return { plane, seatY, yaw, ax, az, floorYAt, toWorld, toUV, variantToUV };
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

  addIndexed(verts: Iterable<number>, tris: Iterable<number>): void {
    const base = this.verts.length / 3;
    for (const v of verts) this.verts.push(v);
    for (const t of tris) this.idx.push(base + t);
  }
}

interface BuildCtx {
  group: THREE.Group;
  concrete: TrimeshAcc;
  geos: THREE.BufferGeometry[];
  L: HomesteadLayout;
  /** The chunk's floating origin; every f32/Rapier write subtracts these. */
  ox: number;
  oz: number;
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
    const registeredSwitches: string[] = [];
    const geos: THREE.BufferGeometry[] = [];
    const mats: THREE.Material[] = [];

    const bctx: BuildCtx = { group, concrete, geos, L, ox, oz };

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

    const drumMatA = mat(0x8b3a2a, { metalness: 0.5, roughness: 0.7 });
    const drumMatB = mat(0x5a6b3a, { metalness: 0.5, roughness: 0.7 });
    const tyreMat = mat(0x1a1a1a);
    const metalMat = mat(0x4c4c50, { metalness: 0.6, roughness: 0.6 });
    const tankMat = mat(0x6e7b6a, { metalness: 0.5, roughness: 0.7 });
    const fenceMat = mat(0x6b5138);

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
    // how the hand-built version was arranged.
    //
    // NO PAD, NO SLAB: the building is TILTED onto `L.plane` (`plane.pitch`/`plane.roll`)
    // and sunk by the plane's own residual, exactly the way `poi.ts`'s `buildVariantPoi`
    // seats every other building in the game — see `homesteadLayout` for the reasoning.
    // A tilted floor is the correct look here, not a defect: real sand under a real
    // house is uneven, and the building now follows it instead of standing on a slab
    // poured level to hide that.
    {
      const instance = createVariantInstance(VARIANT_INDEX);
      const [bx, bz] = L.toWorld(VARIANT_U, VARIANT_V);

      instance.group.position.set(bx - ox, L.seatY, bz - oz);
      instance.group.rotation.set(L.plane.pitch, L.yaw, L.plane.roll, 'YXZ');
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
        // the wall openings the catalogue builds stay openings. `ox`/`oz` of 0 here is
        // deliberate: this accumulator's other entries (yard props, below) are ALSO
        // baked in absolute coordinates, via each helper's own `ctx.ox`/`ctx.oz`
        // subtraction happening once, at the call site — not twice.
        const matrix = poseMatrix(bx, L.seatY, bz, L.yaw, L.plane.roll, L.plane.pitch, 0, 0);
        const trimesh = geometryToTrimesh(instance.solid, matrix);
        if (trimesh.indices.length > 0) concrete.addIndexed(trimesh.vertices, trimesh.indices);
      }
    }

    // --- Junk: oil drums, tyre stack, jack stands ---
    //
    // On the YARD now, not beside the garage door: the building is the catalogue's
    // and fills its own footprint, so anything this file adds would stand inside a
    // wall. The yard is the strip beyond the garage's own footprint kept for exactly
    // this, and the cluster reads the same from the drive.
    //
    // Bare ground, not a shared floor height: there is no pad any more, so each prop
    // samples the terrain under its own feet, the same as the water tank and the
    // fence below have always done.
    const yardU = PAD_U1 - YARD_M * 0.55;
    const [d1x, d1z] = L.toWorld(yardU, GARAGE_CENTRE_V - 1.2);
    const [d2x, d2z] = L.toWorld(yardU + 0.6, GARAGE_CENTRE_V - 0.7);
    const [d3x, d3z] = L.toWorld(yardU, GARAGE_CENTRE_V - 2.2);
    const d1y = ctx.terrain.heightAt(d1x, d1z, HOMESTEAD_S);
    const d2y = ctx.terrain.heightAt(d2x, d2z, HOMESTEAD_S);
    const d3y = ctx.terrain.heightAt(d3x, d3z, HOMESTEAD_S);
    cylinder(bctx, d1x, d1y + 0.45, d1z, 0.32, 0.9, drumMatA, 18, concrete);
    cylinder(bctx, d2x, d2y + 0.45, d2z, 0.32, 0.9, drumMatB, 18, concrete);
    cylinder(bctx, d3x, d3y + 0.45, d3z, 0.32, 0.9, drumMatA, 18, concrete);

    // Tyre stack: three tyres lying flat.
    const [tx, tz] = L.toWorld(yardU - 0.3, GARAGE_CENTRE_V - 2.8);
    const ty = ctx.terrain.heightAt(tx, tz, HOMESTEAD_S);
    for (let k = 0; k < 3; k++) {
      cylinder(bctx, tx, ty + 0.09 + k * 0.18, tz, 0.35, 0.18, tyreMat, 20, concrete);
    }

    // Jack stands: small tripods on the yard, where the car's wheels will go.
    const [j1x, j1z] = L.toWorld(yardU + 0.9, GARAGE_CENTRE_V + 1.6);
    const [j2x, j2z] = L.toWorld(yardU + 0.9, GARAGE_CENTRE_V + 3.0);
    const j1y = ctx.terrain.heightAt(j1x, j1z, HOMESTEAD_S);
    const j2y = ctx.terrain.heightAt(j2x, j2z, HOMESTEAD_S);
    visual(bctx, [ [j1x - 0.14, j1y, j1z - 0.14], [j1x + 0.14, j1y + 0.5, j1z + 0.14] ], metalMat);
    visual(bctx, [ [j2x - 0.14, j2y, j2z - 0.14], [j2x + 0.14, j2y + 0.5, j2z + 0.14] ], metalMat);

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
    // homestead is within the light cutoff of the camera. On the tilted floor's own
    // height at each light's point, not the bare yard: both hang right at the
    // building, where the floor is what is actually underfoot. ---
    const [glx, glz] = L.toWorld(GARAGE_CENTRE_U + 2.0, GARAGE_CENTRE_V);
    const garageLight = new THREE.PointLight(0xffd9a0, HOMESTEAD_LAMP_INTENSITY, 16, 2);
    garageLight.position.set(glx - ox, L.floorYAt(GARAGE_CENTRE_U + 2.0, GARAGE_CENTRE_V) + 2.3, glz - oz);
    garageLight.name = 'garageLight';
    garageLight.visible = false;
    group.add(garageLight);

    // The yard lamp, which is what makes the compound read as inhabited from the road.
    const [dlx, dlz] = L.toWorld(GARAGE_DOOR_U - 1.2, GARAGE_CENTRE_V);
    const doorLight = new THREE.PointLight(0xffe0b0, HOMESTEAD_LAMP_INTENSITY, 12, 2);
    doorLight.position.set(dlx - ox, L.floorYAt(GARAGE_DOOR_U - 1.2, GARAGE_CENTRE_V) + 2.5, dlz - oz);
    doorLight.name = 'doorLight';
    doorLight.visible = false;
    group.add(doorLight);

    // --- Physics ---
    const bodies: RAPIER.RigidBody[] = [];
    const colliders: RAPIER.Collider[] = [];
    if (ctx.hasPhysics && concrete.idx.length > 0) {
      const collider = ctx.physics.addStaticTrimesh(
        new Float32Array(concrete.verts),
        new Uint32Array(concrete.idx),
        SurfaceType.Concrete,
      );
      colliders.push(collider);
      const bodyRef = collider.parent();
      if (bodyRef) bodies.push(bodyRef);
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
  // On the bare ground directly underfoot, not `L.floorYAt`: the building's own
  // floor is deliberately sunk below grade wherever it has to be to keep every
  // wall clear of floating (see `homesteadLayout`), so it is not a safe surface
  // to teleport a fixed FEET position onto — it can sit meaningfully below the
  // sand the player would actually be standing on at that exact spot.
  const groundY = terrain.heightAt(x, z, HOMESTEAD_S) + SPAWN_CLEARANCE_M;
  // Facing out of the garage is the -away direction; yaw is measured from +Z.
  return { x, y: groundY, z, yaw: Math.atan2(-L.ax, -L.az) };
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
  const [cx, cz] = L.toWorld(GARAGE_CENTRE_U, GARAGE_CENTRE_V);
  // Ground under the car's own spot, for the same reason `homesteadSpawn` uses
  // bare ground rather than `L.floorYAt`.
  const carY = carSpawnYAboveGround(measure, terrain.heightAt(cx, cz, HOMESTEAD_S), GARAGE_CAR_DROP_METRES);
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

  // The can stands on the yard beside the garage door, on bare ground like the rest
  // of the yard's junk, where the player cannot miss it on the way out.
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
    terrain.heightAt(canX, canZ, HOMESTEAD_S) + 0.28,
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
  // heights come from the catalogue that builds the shelf, added onto `floorYAt` AT THE
  // SHELF'S OWN POINT rather than one shared floor height, so a plank at the far end of a
  // tilted shelf still sits on the floor height under it, not the one under the near end.
  const shelfUV = (along: number, across: number): [number, number] =>
    L.variantToUV(
      STARTER_GARAGE_SHELF.centreX + across,
      STARTER_GARAGE_SHELF.centreZ - along,
    );
  const shelfAt = (along: number, across: number): [number, number] => {
    const [su, sv] = shelfUV(along, across);
    return L.toWorld(su, sv);
  };
  const shelfPlankY = (along: number, across: number, plankTop: number): number => {
    const [su, sv] = shelfUV(along, across);
    return L.floorYAt(su, sv) + plankTop;
  };

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
    shelfPlankY(-0.9, 0.02, SHELF_PLANK_TOP(3)) + 0.14,
    cameraZ,
  );
  const [watchX, watchZ] = shelfAt(-0.3, -0.02);
  loose.spawnItem(
    {
      type: 'pocket_watch',
      id: world.generatedPartId('home_item', 0, 4),
    },
    watchX,
    shelfPlankY(-0.3, -0.02, SHELF_PLANK_TOP(3)) + 0.08,
    watchZ,
  );

  // Two complete doses wait in the garage together: enough to teach the item's
  // value without making the rest of the road's rare POI finds redundant.
  for (let i = 0; i < 2; i++) {
    const along = 0.4 + i * 0.55;
    const [medicineX, medicineZ] = shelfAt(along, 0);
    loose.spawnItem(
      {
        type: 'medicine',
        id: world.generatedPartId('home_item', 0, 6 + i),
      },
      medicineX,
      shelfPlankY(along, 0, SHELF_PLANK_TOP(2)) + 0.12,
      medicineZ,
    );
  }


  // The ball starts on bare ground beside the drive, with the centre one radius
  // above the terrain so it neither floats nor spawns intersecting the sand.
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

