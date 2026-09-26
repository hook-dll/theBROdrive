import * as THREE from 'three';

import type { GraphicsQuality } from '../game/settings';
import { DESERT_TILE_SIZE, TREE_STRIDE, TreeKind, UNDERGROWTH_KIND_FROM, UNDERGROWTH_KIND_TO } from './deserttiledata';
import type { ForestWorkerRequest, ForestWorkerResponse } from './forestworker';
import { FAR_WOODS_TO_M } from './farwoods';
import { ImpostorField } from './impostors';
import type { WorldOrigin } from './origin';
import type { Road } from './road';
import { coniferTreeMaterial, deciduousTreeMaterial, stumpMaterial } from '../render/look/treematerial';
import { setImpostorLayout, setImpostorReach } from '../render/look/treeimpostor';
import { setTreeModelRange, TREE_LOD_BAND_M, TREE_MODEL_SCALE, TREE_WIDTH_SCALE } from '../render/look/treeglsl';
import { SPECIES_ORDER, treeLayout, treeModels, type TreeModels } from '../render/look/treeassets';
import { treeShape, treeVariantCount } from './treeshape';

/**
 * THE FOREST: every tree, drawn as an asset rather than built, and by distance in two ways
 * (docs/renderer-v2.md, stage 4; the technique is docs/slowroads-steam/notes/SrTrees.md).
 *
 *   MODEL      to the tier's range (130-280 m): the GLB with its crown cards, cut out of
 *              the species' atlas, shaded by the crown's own capsule, normal-mapped, and
 *              dissolving into its impostor over the last `TREE_LOD_BAND_M` of it.
 *   IMPOSTOR   from there to a wood's reach: one quad, one of sixteen baked views, the
 *              same tint, glow and darkening (world/impostors.ts,
 *              render/look/treeimpostor.ts). A tree standing OUTSIDE a wood — a belt, a
 *              copse, a wood's edge, a lone tree — goes on to the horizon's haze, because
 *              the canopy blanket only draws woods and a farmland horizon is made of
 *              exactly those trees.
 *
 * ONE BUCKET PER SPECIES AND VARIANT. The four model variants of a species differ in their
 * branch and card seeds, and the placement's variant index (a habit, `world/treeshape.ts`)
 * picks among them modulo their count: a wood of one silhouette repeated is what the asset
 * pipeline's four models exist to prevent, and the rendering cost is one instanced draw per
 * (species, variant) that has trees in it. The 16 TreeKinds of the placement map onto the
 * six species — and the two low models — in `KIND_MODEL` below.
 *
 * MODELS COME FROM THE NEAR TILES. They are planted with exact ground heights and their
 * trunks are colliders (world/deserttiles.ts); impostors come from this module's own worker,
 * which plants every tile out to the impostor radius with the same function, so both hold
 * the same trees and the hand-over changes how a tree is drawn, never which tree is there.
 *
 * The bucket refill is the frame's one piece of per-tree work, every `REBUCKET_M` of travel:
 * the hand-over does NOT wait for it (both sides measure the band from the camera every
 * frame in their own shaders), so a stale bucket is a tree drawn at the wrong distance for a
 * few metres, never a hole.
 */

/** Where a species' model ends, per tier: the model range the tier pays for. */
const MODEL_RANGE_M: Record<GraphicsQuality, number> = {
  acceptable: 130,
  standard: 190,
  blessing: 280,
};
/** How far a tree of a wood is drawn as an impostor before its wood is the keepers' and haze. */
const IMPOSTOR_TO_M = 2000;
/** How far a tree outside a wood is drawn: the horizon's belts and copses. */
const IMPOSTOR_OPEN_TO_M = 6000;
const REBUCKET_M = 14;
/** Where the undergrowth has dissolved: nothing stands in for a bracken clump at 110 m. */
const UNDERGROWTH_FADE_TO_M = 110;
/** The kinds the bush layer draws (stage 3): hazel, rowan, bracken, juniper. */
const BUSH_KINDS: ReadonlySet<number> = new Set([
  TreeKind.Bush,
  TreeKind.Rowan,
  TreeKind.Fern,
  TreeKind.Juniper,
]);
/**
 * WHICH ASSET A KIND IS DRAWN WITH: an index into the impostor atlases' species order
 * (`SPECIES_ORDER`: birch, aspen, oak, lime, spruce, pine), or one of the two low models.
 * `Maple` is a lime and `Alder` a birch and `Willow` a lime until they have an asset of
 * their own (docs/renderer-v2.md, stage 4), each with a tint of its own so the three do not
 * read as the species they stand in for; the four undergrowth kinds are the bush layer's.
 */
const KIND_MODEL: readonly number[] = [0, 4, -1, 3, 5, 1, 2, 3, 0, 3, -1, -1, -1, 6, 7, 5];
const MODEL_STUMP = 6;
const MODEL_LOG = 7;
/**
 * What each kind's own colour is, multiplied into the atlas: the three stand-ins are moved
 * enough to be their own tree and not enough to leave their atlas' bark.
 */
const KIND_TINT: readonly (readonly [number, number, number])[] = [
  [1, 1, 1],
  [1, 1, 1],
  [1, 1, 1],
  [1, 1, 1],
  [1, 1, 1],
  [1, 1, 1],
  [1, 1, 1],
  [1.02, 0.96, 0.84],
  [0.88, 0.94, 0.9],
  [1.04, 1.06, 0.94],
  [1, 1, 1],
  [1, 1, 1],
  [1, 1, 1],
  [1, 1, 1],
  [1, 1, 1],
  [1, 1, 1],
];
/** How deep a tree is set into its ground, so the base of a trunk is never a seam. */
const TREE_SINK_M = 0.15;
/** Impostor tiles are kept out to this many tiles: the open trees' reach. */
const IMPOSTOR_TILE_RADIUS = Math.ceil(IMPOSTOR_OPEN_TO_M / DESERT_TILE_SIZE) + 1;
/**
 * Within this many tiles a tile carries all its trees; past it only the open ones. Two tiles
 * of margin: a tile's woods must be in before its nearest trees come within reach, or a whole
 * tile's worth of them arrived at once, already inside it.
 */
const FULL_TILE_RADIUS = Math.ceil(IMPOSTOR_TO_M / DESERT_TILE_SIZE) + 3;
/** Within this many tiles a far tile also carries its woods' far keepers (world/farwoods.ts). */
const KEEPER_TILE_RADIUS = Math.ceil(FAR_WOODS_TO_M / DESERT_TILE_SIZE) + 1;
/** Re-anchor the impostor buffer when the camera strays this far from its anchor. */
const ANCHOR_REBASE_M = 20_000;

/** A far tile's trees, as the worker planted them; `openOnly` when the woods are left out. */
interface ImpostorTile {
  readonly tx: number;
  readonly tz: number;
  readonly trees: Float32Array;
  readonly count: number;
  readonly openOnly: boolean;
  /** Whether an open-only tile also carries its woods' far keepers. */
  readonly keepers: boolean;
}

interface TileTrees {
  readonly centreX: number;
  readonly centreZ: number;
  readonly trees: Float32Array;
  readonly count: number;
}

interface Bucket {
  mesh: THREE.InstancedMesh;
  count: number;
}

const matrix = new THREE.Matrix4();
const quat = new THREE.Quaternion();
const pos = new THREE.Vector3();
const scl = new THREE.Vector3();
const tint = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);
const shape = { variant: 0, sx: 1, sy: 1 };

/** A round patch no tree may stand in: a POI's yard. Absolute metres. */
export interface Clearing {
  readonly x: number;
  readonly z: number;
  readonly r: number;
}

/** Clearings touching a square of ground centred on (x, z) with half-side `half`. */
export type ClearingSource = (x: number, z: number, half: number) => readonly Clearing[];

/**
 * A tile's trees minus those standing in a clearing, as a new packed array (or the input
 * itself when nothing is cleared).
 */
export function clearTrees(
  source: ClearingSource | null,
  centreX: number,
  centreZ: number,
  trees: Float32Array,
  count: number,
): { trees: Float32Array; count: number } {
  const clearings = source ? source(centreX, centreZ, DESERT_TILE_SIZE / 2) : [];
  if (clearings.length === 0) return { trees, count };
  const out = new Float32Array(count * TREE_STRIDE);
  let n = 0;
  for (let i = 0; i < count; i++) {
    const o = i * TREE_STRIDE;
    const x = centreX + trees[o]!;
    const z = centreZ + trees[o + 2]!;
    if (clearings.some((c) => Math.hypot(x - c.x, z - c.z) < c.r)) continue;
    out.set(trees.subarray(o, o + TREE_STRIDE), n * TREE_STRIDE);
    n++;
  }
  return { trees: out, count: n };
}

export class ForestRenderer {
  private readonly tiles = new Map<string, TileTrees>();
  /** Where no tree may stand (POI yards); set by the game, read on every tile. */
  clearings: ClearingSource | null = null;
  /**
   * The undergrowth, handed out instead of drawn (stage 3). The four small kinds — hazel,
   * rowan, bracken, juniper — are the bush layer's own atlas (`world/bushes.ts`), and this
   * renderer visits every tree within reach once per refill, so it is also the one place
   * that knows where they stand. `beginBush` clears the layer's list, `endBush` closes it.
   */
  onBush: ((kind: number, x: number, y: number, z: number, yaw: number, scale: number, tint: number) => void) | null = null;
  beginBush: (() => void) | null = null;
  endBush: (() => void) | null = null;
  /**
   * Every bucket: `[model][variant]`, where a model is one of the six species or one of
   * the two low ones (`MODEL_STUMP`, `MODEL_LOG`).
   */
  private buckets: Bucket[][] = [];
  private materials: {
    readonly deciduous: THREE.MeshStandardMaterial;
    readonly conifer: THREE.MeshStandardMaterial;
    readonly stump: THREE.MeshStandardMaterial;
  } | null = null;
  private modelRange = MODEL_RANGE_M.standard;
  private dirty = true;
  private lastX = Number.NaN;
  private lastZ = Number.NaN;
  private lastOriginX = Number.NaN;
  private lastOriginZ = Number.NaN;

  private renderer: THREE.WebGLRenderer | null = null;
  private impostors: ImpostorField | null = null;
  private anchorX = 0;
  private anchorZ = 0;
  private worker: Worker | null = null;
  private workerReady = false;
  private inFlight: string | null = null;
  /**
   * Impostor tiles. A tree's tint (float 6) is stored NEGATIVE when it stands outside a
   * wood: the impostor shader reads the sign as its reach, the magnitude as tint.
   */
  private readonly impostorTiles = new Map<string, ImpostorTile>();
  private centreTx = Number.NaN;
  private centreTz = Number.NaN;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly origin: WorldOrigin,
    private readonly seed: number,
    private readonly road: Road,
  ) {
    this.startWorker();
  }

  /** The WebGL renderer the impostor buffer is built for, and the sign that the world is up. */
  attachRenderer(renderer: THREE.WebGLRenderer): void {
    this.renderer = renderer;
    void this.loadAssets();
  }

  /** The tier's own model range: how far a tree is a model rather than a quad. */
  setQuality(quality: GraphicsQuality): void {
    this.quality = quality;
    this.modelRange = MODEL_RANGE_M[quality];
    setTreeModelRange(this.modelRange);
    setImpostorReach(this.modelRange, IMPOSTOR_TO_M, IMPOSTOR_OPEN_TO_M, FAR_WOODS_TO_M);
  }

  /**
   * The atlases, the models and the materials, once. The layout comes from the manifest
   * (`treeassets.ts`); a world that cannot fetch one — the headless tools — simply has no
   * trees to draw, which is the contract the ground's photographs are on.
   */
  private async loadAssets(): Promise<void> {
    const layout = await treeLayout();
    if (!layout) return;
    const models = await treeModels(layout);
    if (!models) return;
    this.materials = {
      deciduous: deciduousTreeMaterial(layout),
      conifer: coniferTreeMaterial(layout),
      stump: stumpMaterial(),
    };
    setImpostorLayout(layout.rows.deciduous, layout.rows.conifer, layout.cellPx, layout.views);
    this.cellM = layout.cellM;
    this.setQuality(this.quality);
    this.buildBuckets(models);
    this.maybeBuildImpostors();
  }

  private quality: GraphicsQuality = 'standard';

  /** A bucket per species and variant: one instanced mesh, grown as a wood needs it. */
  private buildBuckets(models: TreeModels): void {
    const materials = this.materials!;
    this.buckets = [];
    for (const [species, variants] of models.tree.entries()) {
      const material = SPECIES_ORDER[species] === 'spruce' || SPECIES_ORDER[species] === 'pine'
        ? materials.conifer
        : materials.deciduous;
      this.buckets.push(variants.map((geometry) => this.makeBucket(geometry, material)));
    }
    this.buckets.push(models.stump.map((geometry) => this.makeBucket(geometry, materials.stump)));
    this.buckets.push(models.log.map((geometry) => this.makeBucket(geometry, materials.stump)));
    this.dirty = true;
  }

  private makeBucket(geometry: THREE.BufferGeometry, material: THREE.Material): Bucket {
    // Sixteen trees a bucket to start: a species and variant is a few dozen trees of one
    // wood, and the buffer doubles when a stretch of road has more (`push`).
    const mesh = new THREE.InstancedMesh(geometry, material, 16);
    mesh.count = 0;
    mesh.frustumCulled = false;
    // No shadow map: the sun's frustum is the car's and the tiles refuse the map, so a tree
    // casts and receives nothing (SrTrees §7).
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.userData.tree = true;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.visible = false;
    this.scene.add(mesh);
    return { mesh, count: 0 };
  }

  private maybeBuildImpostors(): void {
    if (this.impostors || !this.renderer || !this.materials) return;
    this.impostors = new ImpostorField(
      this.renderer,
      this.modelRange,
      TREE_LOD_BAND_M,
      IMPOSTOR_TO_M,
      IMPOSTOR_OPEN_TO_M,
      FAR_WOODS_TO_M,
    );
    this.scene.add(this.impostors.mesh);
    // Tiles that arrived before the buffer existed are written now.
    for (const [key, tile] of this.impostorTiles) this.writeImpostorTile(key, tile);
  }

  private startWorker(): void {
    if (typeof Worker === 'undefined') return;
    try {
      const worker = new Worker(new URL('./forestworker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (event: MessageEvent<ForestWorkerResponse>) => this.onWorker(event.data);
      worker.onerror = () => {
        worker.terminate();
        this.worker = null;
      };
      const init: ForestWorkerRequest = { type: 'init', seed: this.seed, spine: this.road.spine };
      worker.postMessage(init);
      this.worker = worker;
    } catch {
      this.worker = null;
    }
  }

  private onWorker(message: ForestWorkerResponse): void {
    if (message.type === 'ready') {
      this.workerReady = true;
      this.pump();
      return;
    }
    const key = `${message.tx},${message.tz}`;
    if (this.inFlight === key) this.inFlight = null;
    if (this.wantsImpostorTile(message.tx, message.tz)) {
      // The tint carries the tree's reach (world/impostors.ts): negative outside a wood,
      // plus 10 for a wood's far keeper.
      for (let i = 0; i < message.count; i++) {
        if (message.open[i] === 1) message.trees[i * TREE_STRIDE + 6] = -message.trees[i * TREE_STRIDE + 6]!;
        else if (message.open[i] === 2) message.trees[i * TREE_STRIDE + 6] = message.trees[i * TREE_STRIDE + 6]! + 10;
      }
      const cleared = clearTrees(
        this.clearings,
        (message.tx + 0.5) * DESERT_TILE_SIZE,
        (message.tz + 0.5) * DESERT_TILE_SIZE,
        message.trees,
        message.count,
      );
      const tile = { tx: message.tx, tz: message.tz, trees: cleared.trees, count: cleared.count, openOnly: message.openOnly, keepers: message.keepers };
      this.impostorTiles.set(key, tile);
      this.writeImpostorTile(key, tile);
    }
    this.pump();
  }

  private wantsImpostorTile(tx: number, tz: number): boolean {
    return Math.abs(tx - this.centreTx) <= IMPOSTOR_TILE_RADIUS && Math.abs(tz - this.centreTz) <= IMPOSTOR_TILE_RADIUS;
  }

  private wantsKeepers(tx: number, tz: number): boolean {
    return Math.abs(tx - this.centreTx) <= KEEPER_TILE_RADIUS && Math.abs(tz - this.centreTz) <= KEEPER_TILE_RADIUS;
  }

  private wantsFullTile(tx: number, tz: number): boolean {
    return Math.abs(tx - this.centreTx) <= FULL_TILE_RADIUS && Math.abs(tz - this.centreTz) <= FULL_TILE_RADIUS;
  }

  /**
   * Requests the nearest tile that is missing — or holds only its open trees but has come
   * within the woods' reach — one at a time.
   */
  private pump(): void {
    if (!this.worker || !this.workerReady || this.inFlight !== null || !Number.isFinite(this.centreTx)) return;
    let best: [number, number] | null = null;
    let bestD = Infinity;
    const R = IMPOSTOR_TILE_RADIUS;
    for (let dx = -R; dx <= R; dx++) {
      for (let dz = -R; dz <= R; dz++) {
        const d = dx * dx + dz * dz;
        if (d > (R + 0.5) * (R + 0.5) || d >= bestD) continue;
        const tx = this.centreTx + dx;
        const tz = this.centreTz + dz;
        const have = this.impostorTiles.get(`${tx},${tz}`);
        if (have && !(have.openOnly && (this.wantsFullTile(tx, tz) || (!have.keepers && this.wantsKeepers(tx, tz))))) continue;
        best = [tx, tz];
        bestD = d;
      }
    }
    if (!best) return;
    this.inFlight = `${best[0]},${best[1]}`;
    const request: ForestWorkerRequest = {
      type: 'tile',
      tx: best[0],
      tz: best[1],
      openOnly: !this.wantsFullTile(best[0], best[1]),
      keepers: this.wantsKeepers(best[0], best[1]),
    };
    this.worker.postMessage(request);
  }

  private writeImpostorTile(key: string, tile: ImpostorTile): void {
    const field = this.impostors;
    if (!field) return;
    const centreX = (tile.tx + 0.5) * DESERT_TILE_SIZE;
    const centreZ = (tile.tz + 0.5) * DESERT_TILE_SIZE;
    const t = tile.trees;
    field.add(key, tile.count, (i, a0, a1, at) => {
      const o = i * TREE_STRIDE;
      const wx = centreX + t[o]!;
      const wz = centreZ + t[o + 2]!;
      const kind = t[o + 5]!;
      treeShape(wx, wz, treeVariantCount(kind), shape);
      // The two low models never stand this far out (`isImpostorKind`), and a width of zero
      // is a quad the shader collapses: it is how a tree says "I am not an impostor".
      const species = KIND_MODEL[kind]!;
      const s = t[o + 3]! * TREE_MODEL_SCALE;
      a0[at] = wx - this.anchorX;
      a0[at + 1] = t[o + 1]! - TREE_SINK_M;
      a0[at + 2] = wz - this.anchorZ;
      // The quad is one impostor cell: its size in metres times the tree's own scale.
      a0[at + 3] = 0;
      // The species, and the tree's own turn as a fraction of a turn (render/look/treeimpostor.ts).
      const turn = t[o + 4]! / (Math.PI * 2);
      a1[at] = species + (turn - Math.floor(turn)) * 0.999;
      a1[at + 1] = species > 5 ? 0 : this.cellM * s * shape.sx * TREE_WIDTH_SCALE;
      a1[at + 2] = this.cellM * s * shape.sy;
      a1[at + 3] = t[o + 6]!;
    }, centreX - this.anchorX, centreZ - this.anchorZ, DESERT_TILE_SIZE * 0.75);
  }

  /** One impostor cell's world size, from the manifest: 12.4 m, or the asset default. */
  private cellM = 12.4;

  /**
   * Drops every impostor tile so the worker plants them again against the current clearings
   * (after the POI spacing changed).
   */
  refreshImpostors(): void {
    for (const key of this.impostorTiles.keys()) this.impostors?.remove(key);
    this.impostorTiles.clear();
    this.inFlight = null;
    this.pump();
  }

  /** A tile's trees, copied: the tile's own buffer goes back to the worker. */
  addTile(key: string, centreX: number, centreZ: number, trees: Float32Array, count: number): void {
    this.tiles.set(key, { centreX, centreZ, trees: trees.slice(0, count * TREE_STRIDE), count });
    this.dirty = true;
  }

  removeTile(key: string): void {
    if (this.tiles.delete(key)) this.dirty = true;
  }

  /**
   * `x`/`z` are the camera's ABSOLUTE world position; `fx`/`fz` its look direction on the
   * ground and `halfFov` half its horizontal field of view, radians: impostors out of view
   * are not drawn (world/impostors.ts).
   */
  update(x: number, z: number, fx: number, fz: number, halfFov: number): void {
    this.updateImpostorWindow(x, z);
    this.impostors?.cull(x - this.anchorX, z - this.anchorZ, fx, fz, halfFov);
    if (this.buckets.length === 0) return;
    const moved = Math.hypot(x - this.lastX, z - this.lastZ);
    if (
      !this.dirty &&
      moved < REBUCKET_M &&
      this.origin.x === this.lastOriginX &&
      this.origin.z === this.lastOriginZ
    ) {
      return;
    }
    this.dirty = false;
    this.lastX = x;
    this.lastZ = z;
    this.lastOriginX = this.origin.x;
    this.lastOriginZ = this.origin.z;
    this.rebucket(x, z);
    if (this.impostors) {
      this.impostors.mesh.position.set(this.anchorX - this.origin.x, 0, this.anchorZ - this.origin.z);
      this.impostors.mesh.updateMatrix();
    }
  }

  private updateImpostorWindow(x: number, z: number): void {
    const tx = Math.floor(x / DESERT_TILE_SIZE);
    const tz = Math.floor(z / DESERT_TILE_SIZE);
    if (Math.hypot(x - this.anchorX, z - this.anchorZ) > ANCHOR_REBASE_M || !Number.isFinite(this.centreTx)) {
      this.anchorX = Math.round(x);
      this.anchorZ = Math.round(z);
      for (const [key, tile] of this.impostorTiles) this.writeImpostorTile(key, tile);
      this.dirty = true;
    }
    if (tx === this.centreTx && tz === this.centreTz) return;
    this.centreTx = tx;
    this.centreTz = tz;
    for (const [key, tile] of this.impostorTiles) {
      if (this.wantsImpostorTile(tile.tx, tile.tz)) continue;
      this.impostorTiles.delete(key);
      this.impostors?.remove(key);
    }
    this.pump();
  }

  /** How far models are bucketed: a refill's travel past the band's far edge. */
  private get modelReach(): number {
    return this.modelRange + TREE_LOD_BAND_M / 2 + REBUCKET_M;
  }

  private rebucket(camX: number, camZ: number): void {
    for (const model of this.buckets) for (const variant of model) variant.count = 0;
    this.beginBush?.();
    const reach = this.modelReach + DESERT_TILE_SIZE;
    for (const tile of this.tiles.values()) {
      // A whole tile out of reach is skipped without looking at its trees.
      if (Math.abs(tile.centreX - camX) > reach || Math.abs(tile.centreZ - camZ) > reach) continue;
      const t = tile.trees;
      for (let i = 0; i < tile.count; i++) {
        const o = i * TREE_STRIDE;
        const wx = tile.centreX + t[o]!;
        const wz = tile.centreZ + t[o + 2]!;
        const d = Math.hypot(wx - camX, wz - camZ);
        if (d >= this.modelReach) continue;
        const kind = t[o + 5]!;
        // The bushes are not drawn here at all: they are handed to the bush layer, which
        // stands them in its own cards and fades them by ITS distance law (world/bushes.ts).
        if (BUSH_KINDS.has(kind)) {
          this.onBush?.(kind, wx, t[o + 1]!, wz, t[o + 4]!, t[o + 3]!, t[o + 6]!);
          continue;
        }
        // The undergrowth has dissolved by here: past its fade nothing larger stands in for
        // it, so it is simply not drawn (the fade itself is the bush layer's).
        if (kind >= UNDERGROWTH_KIND_FROM && kind <= UNDERGROWTH_KIND_TO && d >= UNDERGROWTH_FADE_TO_M) continue;
        const model = this.buckets[KIND_MODEL[kind]!];
        if (!model || model.length === 0) continue;
        treeShape(wx, wz, treeVariantCount(kind), shape);
        const variant = shape.variant % model.length;
        const s = t[o + 3]! * TREE_MODEL_SCALE;
        pos.set(wx - this.origin.x, t[o + 1]! - TREE_SINK_M, wz - this.origin.z);
        quat.setFromAxisAngle(UP, t[o + 4]!);
        scl.set(s * shape.sx * TREE_WIDTH_SCALE, s * shape.sy, s * shape.sx * TREE_WIDTH_SCALE);
        matrix.compose(pos, quat, scl);
        const kindTint = KIND_TINT[kind]!;
        tint.setRGB(t[o + 6]! * kindTint[0], t[o + 6]! * kindTint[1], t[o + 6]! * kindTint[2]);
        this.push(model[variant]!, matrix, tint);
      }
    }
    this.endBush?.();
    for (const model of this.buckets) {
      for (const b of model) {
        b.mesh.count = b.count;
        // An empty bucket is still a draw: most species are absent from any one stretch.
        b.mesh.visible = b.count > 0;
        if (b.count === 0) continue;
        // Only what is used: the buffers are sized for the densest stretch of wood seen,
        // and uploading their whole length every 14 m was a stall of tens of milliseconds
        // (the GPU is still reading them).
        b.mesh.instanceMatrix.clearUpdateRanges();
        b.mesh.instanceMatrix.addUpdateRange(0, b.count * 16);
        b.mesh.instanceMatrix.needsUpdate = true;
        if (b.mesh.instanceColor) {
          b.mesh.instanceColor.clearUpdateRanges();
          b.mesh.instanceColor.addUpdateRange(0, b.count * 3);
          b.mesh.instanceColor.needsUpdate = true;
        }
      }
    }
  }

  private push(bucket: Bucket, m: THREE.Matrix4, c: THREE.Color): void {
    let mesh = bucket.mesh;
    const capacity = mesh.instanceMatrix.count;
    if (bucket.count >= capacity) {
      // Grow by doubling: a fresh mesh over the same geometry and material.
      const grown = new THREE.InstancedMesh(mesh.geometry, mesh.material as THREE.Material, capacity * 2);
      grown.count = 0;
      grown.frustumCulled = false;
      grown.castShadow = false;
      grown.receiveShadow = false;
      grown.userData.tree = true;
      grown.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.scene.add(grown);
      (grown.instanceMatrix.array as Float32Array).set(mesh.instanceMatrix.array as Float32Array);
      if (mesh.instanceColor) {
        grown.setColorAt(0, c);
        (grown.instanceColor!.array as Float32Array).set(mesh.instanceColor.array as Float32Array);
      }
      this.scene.remove(mesh);
      mesh.dispose();
      bucket.mesh = grown;
      mesh = grown;
    }
    mesh.setMatrixAt(bucket.count, m);
    mesh.setColorAt(bucket.count, c);
    bucket.count++;
  }
}
