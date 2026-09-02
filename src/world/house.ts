/**
 * The homestead: the player's first five minutes, told without a word of text.
 *
 * A small house with an attached open-fronted garage sits beside the road's runout
 * (`STRAIGHT_RUNOUT` in road.ts keeps s ∈ [0, 260] dead straight and heading 0, and
 * `HOME_FLAT_RADIUS` in landscape.ts keeps the ground under the footprint level to
 * within a tenth of a metre). Inside the garage sits the starter car — a complete
 * model — and a jerry can lies within arm's reach.
 *
 * Everything here is pure geometry derived from the seed, never a texture or a
 * prefab, and never `Math.random` — the same seed rebuilds the same homestead,
 * car and fuel-can placement.
 */
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';

import { hash01, pick } from '../core/rng';
import { SurfaceType } from '../core/surfaces';
import { Road, ROAD_HALF_WIDTH } from './road';
import { Terrain } from './terrain';
import {
  coolantCapacity,
  oilCapacity,
} from '../parts/registry';
import { carModelMeasure, carSpawnYAboveGround } from '../render/carmodel';
import { modelEngine, SPAWNABLE_CAR_MODELS } from '../vehicle/carmodels';
import type { CarState, GameWorld } from '../game/state';
import type { ChunkContext, ChunkContent, ChunkProvider } from './chunks';
import type { LoosePartField } from '../parts/loose';
import type { Item } from '../items/items';
import { createBonnetStorage } from '../vehicle/bonnet';

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
const HOMESTEAD_S = 16;
/** -1 = left of travel, +1 = right. */
const SIDE = -1;

/** Garage interior, in (u, v). Open front (toward the road) at GARAGE_DOOR_U. */
const GARAGE_DOOR_U = 8.3;
const GARAGE_BACK_U = 14.0;
const GARAGE_V0 = 0.4;
const GARAGE_V1 = 5.4;
const GARAGE_WALL_H = 2.7;
/** Small free-fall inside the low garage; the open-world 0.75 m drop hits its roof. */
const GARAGE_CAR_DROP_METRES = 0.08;

/** House interior (shares the garage's back wall). */
const HOUSE_BACK_U = 20.0;
const HOUSE_V0 = -3.6;
const HOUSE_V1 = 3.6;
const HOUSE_WALL_H = 2.9;

const WALL_T = 0.14;
const SLAB_THICK = 0.45;
/** The concrete pad tops this far above the highest terrain under it, so the
 *  heightfield can never poke through the floor. The slab is thick enough that the
 *  LOWEST corner of the footprint still has concrete below the sand: the runout is
 *  level to a tenth of a metre, not exactly, since the landscape's long bands keep
 *  their slope everywhere (see landscape.ts). */
const SLAB_LIFT = 0.12;

/** Gravel driveway: a filled wedge from the garage door down to the asphalt edge. */
const DRIVE_FAR_U = ROAD_HALF_WIDTH; // meet the road surface, not the shoulder
const DRIVE_V0 = 0.7;
const DRIVE_V1 = 5.1;

/** Concrete pad footprint (house + garage share one slab). */
const PAD_U0 = GARAGE_DOOR_U;
const PAD_U1 = HOUSE_BACK_U + 0.1;
const PAD_V0 = HOUSE_V0 - 0.1;
const PAD_V1 = GARAGE_V1 + 0.1;

/** Workbench against the garage's back wall. Items rest on top at `+0.9`. */
const WB_U0 = 13.2;
const WB_U1 = 13.9;
const WB_V0 = 0.6;
const WB_V1 = 1.8;
const WB_TOP = 0.9;

/** Layout derived from the seed; shared by the chunk and the scatter helpers. */
interface HomesteadLayout {
  floorY: number;
  roadY: number;
  ax: number;
  az: number;
  fx: number;
  fz: number;
  toWorld(u: number, v: number): [number, number];
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
function layout(road: Road, terrain: Terrain): HomesteadLayout {
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

  let top = -Infinity;
  for (let u = 4.0; u <= PAD_U1; u += 2) {
    for (let v = PAD_V0; v <= PAD_V1; v += 2) {
      const [x, z] = toWorld(u, v);
      const h = terrain.heightAt(x, z, HOMESTEAD_S);
      if (h > top) top = h;
    }
  }

  return { floorY: top + SLAB_LIFT, roadY: ref.y, ax, az, fx, fz, toWorld };
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

/** A window pane + dark frame on a wall whose normal is the `u` (away) axis. */
function windowOnU(
  ctx: BuildCtx,
  u: number,
  vCenter: number,
  yCenter: number,
  w: number,
  h: number,
  towardRoad: boolean,
  glassMat: THREE.Material,
  frameMat: THREE.Material,
): void {
  const d = towardRoad ? -1 : 1;
  const v0 = vCenter - w / 2;
  const v1 = vCenter + w / 2;
  const y0 = yCenter - h / 2;
  const y1 = yCenter + h / 2;
  visual(ctx, boxUV(ctx.L, u + d * 0.02, v0 - 0.04, y0 - 0.04, u + d * 0.1, v1 + 0.04, y1 + 0.04), frameMat);
  visual(ctx, boxUV(ctx.L, u + d * 0.05, v0, y0, u + d * 0.07, v1, y1), glassMat);
}

/** A window pane + dark frame on a wall whose normal is the `v` (along) axis. */
function windowOnV(
  ctx: BuildCtx,
  v: number,
  uCenter: number,
  yCenter: number,
  w: number,
  h: number,
  towardRoad: boolean,
  glassMat: THREE.Material,
  frameMat: THREE.Material,
): void {
  const d = towardRoad ? -1 : 1;
  const u0 = uCenter - w / 2;
  const u1 = uCenter + w / 2;
  const y0 = yCenter - h / 2;
  const y1 = yCenter + h / 2;
  visual(ctx, boxUV(ctx.L, u0 - 0.04, v + d * 0.02, y0 - 0.04, u1 + 0.04, v + d * 0.1, y1 + 0.04), frameMat);
  visual(ctx, boxUV(ctx.L, u0, v + d * 0.05, y0, u1, v + d * 0.07, y1), glassMat);
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
  const base = Math.min(L.floorY, L.roadY) - SLAB_THICK;
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

// ---------------------------------------------------------------------------
// The chunk provider: static geometry only, chunk 0 alone.
// ---------------------------------------------------------------------------

export class HomesteadProvider implements ChunkProvider {
  readonly id = 'homestead';

  build(ctx: ChunkContext): ChunkContent | null {
    if (ctx.chunkIndex !== 0) return null;

    const L = layout(ctx.road, ctx.terrain);
    const ox = ctx.originX;
    const oz = ctx.originZ;
    const group = new THREE.Group();
    const concrete = new TrimeshAcc();
    const gravel = new TrimeshAcc();
    const geos: THREE.BufferGeometry[] = [];
    const mats: THREE.Material[] = [];

    const bctx: BuildCtx = { group, concrete, gravel, geos, L, ox, oz };

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

    const wallMat = mat(0x8a7f6d);
    const roofMat = mat(0x5f4a3a, { metalness: 0.4, roughness: 0.75 });
    const floorMat = mat(0x9a978f, { roughness: 0.95 });
    const gravelMat = mat(0x7a6c56, { roughness: 1 });
    const doorMat = mat(0x4a3a28);
    const glassMat = mat(0x9fc3d0, { metalness: 0.1, roughness: 0.1, transparent: true, opacity: 0.35 });
    const frameMat = mat(0x3d3a34);
    const drumMatA = mat(0x8b3a2a, { metalness: 0.5, roughness: 0.7 });
    const drumMatB = mat(0x5a6b3a, { metalness: 0.5, roughness: 0.7 });
    const tyreMat = mat(0x1a1a1a);
    const benchMat = mat(0x6b5138, { roughness: 0.85 });
    const metalMat = mat(0x4c4c50, { metalness: 0.6, roughness: 0.6 });
    const tankMat = mat(0x6e7b6a, { metalness: 0.5, roughness: 0.7 });
    const fenceMat = mat(0x6b5138);

    const fy = L.floorY;

    // --- Shared concrete pad (garage floor + house floor, one flush slab) ----
    solid(bctx, boxUV(L, PAD_U0, PAD_V0, fy - SLAB_THICK, PAD_U1, PAD_V1, fy), concrete, floorMat);

    // --- Walls (all closed boxes; the house is solid scenery, the garage open) ---
    // Shared wall: house front and garage back in one piece, so there is no
    // double-wall seam where the two buildings meet.
    solid(bctx, boxUV(L, GARAGE_BACK_U - WALL_T / 2, HOUSE_V0, fy, GARAGE_BACK_U + WALL_T / 2, GARAGE_V1, fy + HOUSE_WALL_H), concrete, wallMat);
    // Garage side walls.
    solid(bctx, boxUV(L, GARAGE_DOOR_U, GARAGE_V0 - WALL_T / 2, fy, GARAGE_BACK_U, GARAGE_V0 + WALL_T / 2, fy + GARAGE_WALL_H), concrete, wallMat);
    solid(bctx, boxUV(L, GARAGE_DOOR_U, GARAGE_V1 - WALL_T / 2, fy, GARAGE_BACK_U, GARAGE_V1 + WALL_T / 2, fy + GARAGE_WALL_H), concrete, wallMat);
    // House side + back walls.
    solid(bctx, boxUV(L, GARAGE_BACK_U, HOUSE_V0 - WALL_T / 2, fy, HOUSE_BACK_U, HOUSE_V0 + WALL_T / 2, fy + HOUSE_WALL_H), concrete, wallMat);
    solid(bctx, boxUV(L, GARAGE_BACK_U, HOUSE_V1 - WALL_T / 2, fy, HOUSE_BACK_U, HOUSE_V1 + WALL_T / 2, fy + HOUSE_WALL_H), concrete, wallMat);
    solid(bctx, boxUV(L, HOUSE_BACK_U - WALL_T / 2, HOUSE_V0, fy, HOUSE_BACK_U + WALL_T / 2, HOUSE_V1, fy + HOUSE_WALL_H), concrete, wallMat);

    // --- Roofs (closed slabs, collidable so you can't clip through) ---
    solid(bctx, boxUV(L, GARAGE_DOOR_U - 0.2, GARAGE_V0 - 0.25, fy + GARAGE_WALL_H, GARAGE_BACK_U + 0.2, GARAGE_V1 + 0.25, fy + GARAGE_WALL_H + 0.15), concrete, roofMat);
    solid(bctx, boxUV(L, GARAGE_BACK_U - 0.2, HOUSE_V0 - 0.2, fy + HOUSE_WALL_H, HOUSE_BACK_U + 0.2, HOUSE_V1 + 0.2, fy + HOUSE_WALL_H + 0.15), concrete, roofMat);

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
    solid(bctx, boxUV(L, WB_U0, WB_V0, fy, WB_U1, WB_V1, fy + WB_TOP), concrete, benchMat);
    visual(bctx, boxUV(L, WB_U0 - 0.1, WB_V0 - 0.1, fy + WB_TOP, WB_U1 + 0.1, WB_V1 + 0.1, fy + WB_TOP + 0.04), metalMat);

    // --- House door + windows (visual only; the house is solid scenery) ---
    // Front door on the road-facing wall, clear of the garage.
    visual(bctx, boxUV(L, GARAGE_BACK_U - WALL_T / 2 - 0.03, -2.45, fy, GARAGE_BACK_U - WALL_T / 2 - 0.02, -1.55, fy + 2.0), doorMat);
    windowOnU(bctx, GARAGE_BACK_U, -0.4, fy + 1.4, 0.9, 0.9, true, glassMat, frameMat);
    windowOnU(bctx, GARAGE_BACK_U, -3.1, fy + 1.4, 0.9, 0.9, true, glassMat, frameMat);
    windowOnV(bctx, HOUSE_V0, 16.5, fy + 1.4, 1.0, 0.9, true, glassMat, frameMat);
    windowOnV(bctx, HOUSE_V1, 16.5, fy + 1.4, 1.0, 0.9, true, glassMat, frameMat);
    windowOnU(bctx, HOUSE_BACK_U, 0.0, fy + 1.5, 1.0, 0.9, false, glassMat, frameMat);
    windowOnV(bctx, GARAGE_V1, 11.5, fy + 1.6, 1.0, 0.8, true, glassMat, frameMat);

    // --- Junk: oil drums, tyre stack, jack stands ---
    const [d1x, d1z] = L.toWorld(9.0, -1.0);
    const [d2x, d2z] = L.toWorld(9.6, -0.5);
    const [d3x, d3z] = L.toWorld(9.0, -2.0);
    cylinder(bctx, d1x, fy + 0.45, d1z, 0.32, 0.9, drumMatA, 18, concrete);
    cylinder(bctx, d2x, fy + 0.45, d2z, 0.32, 0.9, drumMatB, 18, concrete);
    cylinder(bctx, d3x, fy + 0.45, d3z, 0.32, 0.9, drumMatA, 18, concrete);

    // Tyre stack: three tyres lying flat.
    const [tx, tz] = L.toWorld(8.7, -2.6);
    for (let k = 0; k < 3; k++) {
      cylinder(bctx, tx, fy + 0.09 + k * 0.18, tz, 0.35, 0.18, tyreMat, 20, concrete);
    }

    // Jack stands: small tripods near where the car's wheels will go.
    const [j1x, j1z] = L.toWorld(10.4, 1.2);
    const [j2x, j2z] = L.toWorld(10.4, 4.6);
    visual(bctx, [ [j1x - 0.14, fy, j1z - 0.14], [j1x + 0.14, fy + 0.5, j1z + 0.14] ], metalMat);
    visual(bctx, [ [j2x - 0.14, fy, j2z - 0.14], [j2x + 0.14, fy + 0.5, j2z + 0.14] ], metalMat);

    // --- Water tank beside the house ---
    {
      const [tx2, tz2] = L.toWorld(21.4, 1.4);
      const ground = ctx.terrain.heightAt(tx2, tz2, HOMESTEAD_S);
      cylinder(bctx, tx2, ground + 1.1, tz2, 0.9, 2.2, tankMat, 24, concrete);
    }

    // --- Fence line behind the house ---
    {
      const fenceU = 21.8;
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
    const [glx, glz] = L.toWorld((GARAGE_DOOR_U + GARAGE_BACK_U) / 2, (GARAGE_V0 + GARAGE_V1) / 2);
    const garageLight = new THREE.PointLight(0xffd9a0, 8, 16, 2);
    garageLight.position.set(glx - ox, fy + 2.3, glz - oz);
    garageLight.name = 'garageLight';
    garageLight.visible = false;
    group.add(garageLight);

    const [dlx, dlz] = L.toWorld(GARAGE_DOOR_U + 0.4, (GARAGE_V0 + GARAGE_V1) / 2);
    const doorLight = new THREE.PointLight(0xffe0b0, 7, 12, 2);
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
    }

    return {
      group,
      bodies,
      colliders,
      dispose: () => {
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
  const L = layout(road, terrain);
  // Same u as the car so they stand level with it, but one bay toward v0.
  const carU = (GARAGE_DOOR_U + GARAGE_BACK_U) / 2;
  const [x, z] = L.toWorld(carU, GARAGE_V0 + 0.7);
  // Facing out of the garage is the -away direction; yaw is measured from +Z.
  return { x, y: L.floorY, z, yaw: Math.atan2(-L.ax, -L.az) };
}

/**
 * Builds the starter car: a deterministic seed-based pick from the Soviet and
 * Quaternius roadworthy pool, parked in the garage facing the door with no gizmos
 * mounted yet. Fuel starts low but non-zero, clamped to the selected tank.
 */
export function createStartingCar(world: GameWorld): CarState {
  const road = new Road(world.seed);
  const terrain = new Terrain(world.seed, road);
  const L = layout(road, terrain);

  const def = pick(SPAWNABLE_CAR_MODELS, world.seed, 0x3f0);
  const engine = modelEngine(def);

  // Keep the existing deterministic fuel roll, clamped to the tank's capacity.
  const fuelLitres = Math.min(4 + hash01(world.seed, 0x3f1) * 6, def.tankLitres);
  // Coolant and oil start part-used on the same deterministic principle: the car
  // has been sitting in a shed, not prepped. Enough to set off on, not enough to
  // finish on, which is what makes the first can worth picking up.
  const coolantLitres = coolantCapacity(engine) * (0.45 + hash01(world.seed, 0x3f2) * 0.3);
  const oilLitres = oilCapacity(engine) * (0.4 + hash01(world.seed, 0x3f3) * 0.35);

  const carU = (GARAGE_DOOR_U + GARAGE_BACK_U) / 2;
  const carV = (GARAGE_V0 + GARAGE_V1) / 2;
  const measure = carModelMeasure(def.id);
  const carY = carSpawnYAboveGround(measure, L.floorY, GARAGE_CAR_DROP_METRES);
  const [cx, cz] = L.toWorld(carU, carV);
  // Face the door: body +Z -> "toward the road" (-away), i.e. world +X here.
  const yaw = Math.atan2(-L.ax, -L.az);
  const half = yaw / 2;

  return {
    id: 'car:start',
    modelId: def.id,
    gizmos: {},
    stickers: [],
    headlightMode: 'off',
    taillightsOn: false,
    reverseLightsOn: false,
    // It has been standing in a shut garage, not in a showroom. Enough dust to read
    // as stored, no damage: the player's first wash is a tutorial nobody has to write.
    dirt: 0.4,
    scratches: 0,
    fuelLitres,
    fuelKind: engine.fuel,
    coolantLitres,
    oilLitres,
    storage: new Array<Item | null>(def.storageCells).fill(null),
    bonnet: createBonnetStorage('car:start', def.engineId, def.bodyClass, def.tankLitres),
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
// Starting fuel can
// ---------------------------------------------------------------------------
function fuelCanSpot(L: HomesteadLayout, seed: number): V3 {
  const [u, v, yOff] = [10.0, -1.8, 0.28]; // yard, by the drums
  const ju = (hash01(seed, 0x94d, 2) - 0.5) * 0.2;
  const jv = (hash01(seed, 0x95d, 2) - 0.5) * 0.2;
  const [x, z] = L.toWorld(u + ju, v + jv);
  return [x, L.floorY + yOff, z];
}

/**
 * Places a jerry can of the starter car's fuel in the yard.
 *
 * The hand-placed position has a small seed-derived jitter, so the can remains
 * reachable and never lands inside a wall or under the floor. It is not pre-loaded
 * into the player's inventory — finding it introduces refuelling without cluttering
 * the garage.
 */
export function spawnStartingFuelCan(world: GameWorld, loose: LoosePartField): void {
  const road = new Road(world.seed);
  const terrain = new Terrain(world.seed, road);
  const L = layout(road, terrain);

  const canSpot = fuelCanSpot(L, world.seed);
  loose.spawnItem(
    {
      type: 'fluid_can',
      id: world.generatedPartId('home_item', 0, 2),
      fluid: modelEngine(pick(SPAWNABLE_CAR_MODELS, world.seed, 0x3f0)).fuel,
      capacity: 20,
      litres: Math.round((12 + hash01(world.seed, 0x9ef) * 8) * 10) / 10,
    },
    canSpot[0], canSpot[1], canSpot[2],
  );
}

