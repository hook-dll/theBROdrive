import * as THREE from 'three';

import { bushMaterial, bushUniforms, BUSH_SLOT, loadBushCards } from '../render/look/bushmaterial';
import { Crop, newCoverSample } from './landcover';
import type { WorldOrigin } from './origin';
import type { Road } from './road';
import type { RoadDistance } from './roaddistance';
import { shoulderWidthAt } from './shoulder';
import type { Terrain } from './terrain';

/**
 * THE BUSH LAYER: the undergrowth, the ditch weeds and the wet ground's willow scrub.
 *
 * ONE SYSTEM, NOT TWO. Before this layer, the four small kinds `plantTrees` grows —
 * hazel (`Bush`), rowan, bracken (`Fern`) and juniper — were drawn by the tree renderer
 * as small procedural models, and a bush of the verge would have been a fifth. So the
 * tree renderer hands those four kinds over (`ForestRenderer.onBush`), their placement
 * — the wood's edge, its floor, the wet hollows — is kept exactly as it was, and they
 * come out of this layer's atlas instead. The tree renderer still draws stumps and
 * fallen trunks; stage 4 takes those.
 *
 * AND THE ROAD'S OWN DITCH. A wood is not the only place a bush grows: the verge of a
 * Russian country road is a line of willowherb, umbellifers and scrub wherever the
 * ground is lush and untended, and slowroads puts its bushes there too (`SrGrass` §5,
 * the same sample reading road proximity). That placement is this layer's own: a world
 * lattice of cells, each cell's bush — whether there is one, which slot, how big, which
 * way it faces — a pure hash of the cell, filtered by the ditch's own band (5-15 m past
 * the asphalt edge), by the ground's lushness and by its wetness. Nothing about a bush
 * is a function of the camera, so no ring and no combing can appear: the camera only
 * decides which cells are COLLECTED, and a cell is collected while it is still a hundred
 * metres past the distance at which its bush has shrunk to nothing.
 *
 * COST is one instanced draw. The card is 1.6 x 1.6 m with its base at the plant's own
 * ground contact, the scale is the instance's (0.5-1.5, `manifest.json`), and the
 * distance behaviour — sink, shrink, the rising alpha test — is all in the shader.
 */

/** The lattice the ditch bushes stand on, metres. */
const DITCH_PITCH_M = 2.6;
/**
 * How far from the camera cells are collected. Past the sink's end by fifteen metres, so
 * a bush has already shrunk to nothing before it can arrive or leave.
 */
const COLLECT_RADIUS_M = 150;
/** Past the asphalt edge: the ditch, and the untended strip beyond it. Not the shoulder. */
const DITCH_FROM_M = 4.5;
const DITCH_TO_M = 15;
/** The share of ditch cells that carry a bush before the ground has its own say. */
const DITCH_ACCEPT = 0.24;
/** The cell is skipped when its tile's ground is not loaded yet, and retried. */
const MAX_BUSHES = 12000;
const UP = new THREE.Vector3(0, 1, 0);

const cover = newCoverSample();
const matrixScratch = new THREE.Matrix4();
const quatScratch = new THREE.Quaternion();
const posScratch = new THREE.Vector3();
const scaleScratch = new THREE.Vector3();

/** One collected bush, before it goes into the instance buffers. */
interface Bush {
  x: number;
  y: number;
  z: number;
  yaw: number;
  scale: number;
  slot: number;
  seed: number;
  tint: number;
  /** Distances from the camera, for the one sort that keeps the nearest when full. */
  d: number;
}

/**
 * A hash of one lattice cell, 0..1 per channel: which way the cell's bush faces, how big
 * it is, whether it is drawn at all. The same construction the world's other lattices
 * use (`core/rng.ts`), because a bush's own randomness must not depend on the order the
 * cells were walked in.
 */
function cellHash(cx: number, cz: number, salt: number): number {
  let h = Math.imul(cx | 0, 0x27d4eb2d) ^ Math.imul(cz | 0, 0x165667b1) ^ Math.imul(salt, 0x9e3779b9);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

export class BushField {
  private readonly material: THREE.MeshStandardMaterial;
  private mesh: THREE.InstancedMesh | null = null;
  private readonly slotAttribute = new THREE.InstancedBufferAttribute(
    new Float32Array(MAX_BUSHES * 4),
    4,
  );
  /** What the tree renderer handed over, and what the ditch lattice placed. */
  private readonly fromTrees: Bush[] = [];
  private readonly fromDitch: Bush[] = [];
  private readonly draw: Bush[] = [];
  private dirty = true;
  private lastX = Number.NaN;
  private lastZ = Number.NaN;
  /** A cell whose tile had not arrived, retried on the next refill. */
  /** Lattice cells whose ground had not arrived, kept as cells and retried. */
  private pending: number[] = [];

  constructor(
    private readonly scene: THREE.Scene,
    private readonly origin: WorldOrigin,
    private readonly terrain: Terrain,
    private readonly road: Road,
    private readonly roadDistance: RoadDistance,
    private readonly groundHeightAt: (x: number, z: number) => number | null,
  ) {
    this.material = bushMaterial();
    loadBushCards().then(
      (geometry) => this.attach(geometry),
      () => {
        // No asset, no bush layer: the same contract the ground photographs are on.
      },
    );
  }

  private attach(geometry: THREE.BufferGeometry): void {
    const mesh = new THREE.InstancedMesh(geometry, this.material, MAX_BUSHES);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    // The tiles refuse the shadow map; a bush is the ground's own surface and takes what
    // the ground takes (see `render/look/bushmaterial.ts`).
    mesh.receiveShadow = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.geometry.setAttribute('aBushSlot', this.slotAttribute);
    mesh.userData.bush = true;
    this.scene.add(mesh);
    this.mesh = mesh;
    this.dirty = true;
  }

  /**
   * One undergrowth instance the tree renderer grew, handed over instead of drawn. The
   * kind is the tree kinds' own, and this is the whole of the mapping between the two
   * systems: hazel and rowan are the shrub slot, bracken the bracken slot, juniper the
   * juniper slot.
   */
  readonly onTreeBush = (kind: number, x: number, y: number, z: number, yaw: number, scale: number, tint: number): void => {
    this.fromTrees.push({
      x,
      y,
      z,
      yaw,
      scale: scale * BUSH_EDGE_SCALE,
      slot: TREE_BUSH_SLOT[kind] ?? BUSH_SLOT.shrub,
      seed: cellHash(Math.round(x * 4), Math.round(z * 4), 7),
      tint,
      d: 0,
    });
  };

  /** The tree renderer is about to walk its tiles: the hand-over list starts again. */
  beginTreeRefill(): void {
    this.fromTrees.length = 0;
  }

  /** The tree renderer has finished: the bushes it handed over are what stands now. */
  endTreeRefill(): void {
    this.dirty = true;
  }

  /** Camera travel, absolute metres. See the class note on the collection radius. */
  update(x: number, z: number, _fx: number, _fz: number, _dt: number): void {
    (bushUniforms.uBushCamRel!.value as THREE.Vector2).set(x - this.origin.x, z - this.origin.z);
    (bushUniforms.uOriginMod!.value as THREE.Vector2).set(
      ((this.origin.x % 1000) + 1000) % 1000,
      ((this.origin.z % 1000) + 1000) % 1000,
    );
    if (!(Math.hypot(x - this.lastX, z - this.lastZ) > DITCH_PITCH_M * 3)) {
      if (this.dirty) this.upload(x, z);
      return;
    }
    this.lastX = x;
    this.lastZ = z;
    this.placeDitch(x, z);
    this.dirty = true;
    this.upload(x, z);
  }

  /** The road ditch's own bushes: the lattice of cells within the collection radius. */
  private placeDitch(x: number, z: number): void {
    this.fromDitch.length = 0;
    const r = COLLECT_RADIUS_M;
    const held = this.pending;
    this.pending = [];
    const c0x = Math.floor((x - r) / DITCH_PITCH_M);
    const c1x = Math.floor((x + r) / DITCH_PITCH_M);
    const c0z = Math.floor((z - r) / DITCH_PITCH_M);
    const c1z = Math.floor((z + r) / DITCH_PITCH_M);
    for (let cz = c0z; cz <= c1z; cz++) {
      for (let cx = c0x; cx <= c1x; cx++) {
        this.placeDitchCell(cx, cz, x, z, r);
      }
    }
    // A cell whose ground had not arrived is looked at again now, and dropped if the
    // camera has driven past it: a bush follows its cell, never the car.
    for (let i = 0; i < held.length; i += 2) this.placeDitchCell(held[i]!, held[i + 1]!, x, z, r + DITCH_PITCH_M);
  }

  /** One cell of the ditch lattice: a bush, or nothing, decided by the cell's own hash. */
  private placeDitchCell(cx: number, cz: number, camX: number, camZ: number, radius: number): void {
    const wx = (cx + 0.5) * DITCH_PITCH_M;
    const wz = (cz + 0.5) * DITCH_PITCH_M;
    const dx = wx - camX;
    const dz = wz - camZ;
    if (dx * dx + dz * dz > radius * radius) return;
    if (cellHash(cx, cz, 11) > DITCH_ACCEPT) return;
    // Outside the ditch band there is nothing to plant, and the road's own coarse
    // distance field says so far more cheaply than a projection does.
    if (this.roadDistance.distAt(wx, wz, 24) > DITCH_TO_M + 12) return;
    const owner = this.roadDistance.ownerAt(wx, wz, 24);
    const p = this.road.project(wx, wz, owner);
    const side = Math.sign(p.lateral) || 1;
    const edge = this.road.halfWidthAt(p.s) + shoulderWidthAt(p.s, side);
    const past = Math.abs(p.lateral) - edge;
    if (past < DITCH_FROM_M || past > DITCH_TO_M) return;
    const y = this.groundHeightAt(wx, wz);
    if (y === null) {
      this.pending.push(cx, cz);
      return;
    }
    this.terrain.cover.sample(wx, wz, Math.abs(p.lateral), cover);
    // A standing crop or fresh plough has no ditch weeds in it; a flowerless, wet hollow
    // has the willow scrub instead.
    if (cover.crop === Crop.Wheat || cover.crop === Crop.Rye || cover.crop === Crop.Ploughed) return;
    const wet = this.terrain.wetnessAt(wx, wz);
    // A verge is untended ground: it takes a weed wherever it is not a crop, and the
    // three slots are then told apart by WHERE they stand — the umbellifers and the
    // willowherb stand in the first metres of the ditch, the scrub beyond them, and the
    // willow/juniper wherever the ground never drains.
    if (cover.lush < 0.03 && wet < 0.4) return;
    const seed = cellHash(cx, cz, 3);
    const slot =
      wet > 0.45
        ? BUSH_SLOT.juniper
        : past < 8
          ? seed < 0.72
            ? BUSH_SLOT.umbellifer
            : BUSH_SLOT.shrub
          : BUSH_SLOT.shrub;
    this.fromDitch.push({
      x: wx,
      y,
      z: wz,
      yaw: cellHash(cx, cz, 5) * Math.PI * 2,
      scale: 0.5 + cellHash(cx, cz, 9),
      slot,
      seed,
      tint: 0.86 + cellHash(cx, cz, 17) * 0.28,
      d: Math.hypot(dx, dz),
    });
  }

  /** Writes this refill's bushes into the instance buffers. */
  private upload(x: number, z: number): void {
    this.dirty = false;
    const mesh = this.mesh;
    if (!mesh) return;
    this.draw.length = 0;
    for (const bush of this.fromTrees) this.draw.push(bush);
    for (const bush of this.fromDitch) this.draw.push(bush);
    // The nearest first, so a full buffer keeps what the eye is closest to instead of
    // whatever the lattice happened to walk first.
    for (const bush of this.draw) bush.d = Math.hypot(bush.x - x, bush.z - z);
    this.draw.sort((a, b) => a.d - b.d);
    const count = Math.min(this.draw.length, MAX_BUSHES);
    const slots = this.slotAttribute.array as Float32Array;
    for (let i = 0; i < count; i++) {
      const bush = this.draw[i]!;
      posScratch.set(bush.x - this.origin.x, bush.y, bush.z - this.origin.z);
      quatScratch.setFromAxisAngle(UP, bush.yaw);
      scaleScratch.setScalar(1);
      matrixScratch.compose(posScratch, quatScratch, scaleScratch);
      mesh.setMatrixAt(i, matrixScratch);
      slots[i * 4] = bush.slot;
      slots[i * 4 + 1] = bush.scale;
      slots[i * 4 + 2] = bush.seed;
      slots[i * 4 + 3] = bush.tint;
    }
    mesh.count = count;
    mesh.visible = count > 0;
    mesh.instanceMatrix.clearUpdateRanges();
    mesh.instanceMatrix.addUpdateRange(0, count * 16);
    mesh.instanceMatrix.needsUpdate = true;
    this.slotAttribute.clearUpdateRanges();
    this.slotAttribute.addUpdateRange(0, count * 4);
    this.slotAttribute.needsUpdate = true;
  }

  /** The count and the draws this layer costs, for the log and the checks. */
  stats(): { count: number; visible: boolean } {
    return { count: this.mesh?.count ?? 0, visible: this.mesh?.visible ?? false };
  }
}

/**
 * The four tree kinds that become bushes, and which slot each is. A rowan is a small
 * tree of the wood's edge with a shrub's silhouette; a hazel is scrub; bracken is
 * bracken; a juniper of the wet hollow is the juniper slot.
 */
const TREE_BUSH_SLOT: Record<number, number> = {
  2: BUSH_SLOT.shrub, // TreeKind.Bush
  10: BUSH_SLOT.shrub, // TreeKind.Rowan
  11: BUSH_SLOT.bracken, // TreeKind.Fern
  12: BUSH_SLOT.juniper, // TreeKind.Juniper
};

/**
 * The undergrowth the tree renderer grew is 0.45-1.15 of a model that is a metre or two
 * tall; the card it becomes is 1.6 m of plant, so the tree's own scale is carried over
 * almost as it stands and only clipped where a card would tower over the wood's floor.
 */
const BUSH_EDGE_SCALE = 0.85;
