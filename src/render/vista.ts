import * as THREE from 'three';
import { farPlaneForViewDistance } from '../core/renderer';
import { hashUnit3 } from '../core/rng';
import { GROUND_ATTRIBUTES, GROUND_VISTA_MATERIAL, GROUND_VISTA_UNDER_MATERIAL } from './look/groundmaterial';

import { DESERT_TILE_SIZE } from '../world/deserttiledata';
import { GROUND_AUX_STRIDE, GROUND_COVER_STRIDE, GROUND_FIELD_STRIDE, GROUND_ROAD_STRIDE, GroundAttributes, groundRockWeight } from '../world/groundattrs';
import { newSeasonState, type SeasonState } from '../world/season';
import { vistaGroundAt } from '../world/vistaground';
import type { WorldOrigin } from '../world/origin';
import type { Road } from '../world/road';
import type { Terrain } from '../world/terrain';
import type {
  VistaWorkerRequest,
  VistaWorkerResponse,
  VistaWorkerSampleResult,
} from './vistaworker';

/**
 * The fine, player-centred tiles own the ground around the camera. This polar disc
 * begins beneath their guaranteed synchronous ring and carries the distant view, so a
 * scheduling delay cannot expose sky between the two terrain systems: the inner band
 * writes its depth at the far plane and therefore loses to the tiles wherever both are
 * drawn.
 *
 * It draws with the SAME material as the tiles (render/look/groundmaterial.ts), only
 * with the three terms that die of their own minification substituted for their means,
 * and it carries the same render attributes the tiles do. That is what keeps the seam
 * between two meshes with a hundredfold difference in vertex spacing invisible: there is
 * nothing at the boundary except a change of sampling density.
 *
 * Hills rise with distance and so does a wood, as a raised, painted canopy blanket
 * (world/vistaground.ts). The horizon is a spatial interpolation of fixed world samples,
 * never a timed animation.
 */

/** Forty metres of hidden overlap beneath the nearest guaranteed tile edge. */
const INNER_RADIUS = DESERT_TILE_SIZE - 40;
/** Metres the camera may move before the disc is rebuilt round it. */
const VISTA_STEP_M = 3;
/** Only the overlap covered by the settled 5x5 desert-tile window is non-occluding. */
const NON_OCCLUDING_RADIUS = DESERT_TILE_SIZE * 2;
/**
 * Radial spacing growth, and the cap it grows into.
 *
 * The vista is also the mountain mesh. A 900 m radial step was acceptable for a
 * distant flat desert, but when binoculars enlarged a mountain it exposed every
 * ring as a horizontal terrace. Keep the polar layout, only give its heightfield
 * enough radial samples to describe a long mountain face continuously.
 */
const RADIAL_RATIO = 1.1;
const MAX_RING_SPACING = 360;
/**
 * The streamed road remains visible about 1.4 km each way. Inside this radius the
 * distant underlay must stay beneath that road rather than use an unrelated open-
 * desert height which can sit ten metres above it and erase patches as the camera moves.
 */
const ROAD_UNDERLAY_RADIUS = 1600;
const ROAD_SAMPLE_STEP = 40;
const ROAD_SAMPLE_CAPACITY = Math.ceil((ROAD_UNDERLAY_RADIUS * 2) / ROAD_SAMPLE_STEP) + 1;
const ROAD_UNDERLAY_CORE = 45;
const ROAD_UNDERLAY_FADE = 150;
const ROAD_UNDERLAY_DROP = 0.75;
/**
 * Vertices per ring. At 25 km this is a 980 m arc, so the mountain silhouette remains
 * deliberately faceted around the horizon; the radial spacing above is the dimension
 * that needed refinement. Close in it is finer than it needs to be and that costs
 * nothing worth measuring.
 */
const SECTORS = 160;
/**
 * Dune relief remains full through the near terrain overlap, then fades
 * continuously. The old boolean cutoff could drop the new fifty-metre dune field
 * between adjacent rings and resemble a horizontal hole in the desert.
 */
const RELIEF_FADE_START = 2500;
const RELIEF_FADE_END = 7000;

/**
 * Terrain samples at the corners of this world-space grid are bilinearly mixed from
 * the camera's exact position. Crossing a cell therefore reuses the same edge samples:
 * movement is continuous and immediately reversible instead of starting a timed morph.
 */
const SAMPLE_CELL_SIZE = 250;

/** Downward overlap bias, fading out over the first eighty metres of the vista. */
const INNER_BIAS = 2;
const BIAS_FADE = 480;



/**
 * One cell corner's contribution, as the worker computes it: heights, the ground's render
 * attributes, the canopy blanket, and the surface normals the main thread derives from the
 * heights (`groundNormalsFor`). Everything here is interpolated between four corners as the
 * camera crosses the cell, which is why it is a plain set of flat arrays.
 */
type GroundSample = {
  heights: Float32Array;
  cover: Float32Array;
  aux: Float32Array;
  field: Float32Array;
  road: Float32Array;
  canopy: Float32Array;
  normals: Float32Array;
};

type GroundCellSamples = [
  GroundSample,
  GroundSample,
  GroundSample,
  GroundSample,
];

function smoothstep01(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}


function invariantLocalPositions(
  positions: Float32Array | null,
): asserts positions is Float32Array {
  if (!positions) throw new Error('vista ground geometry is not initialized');
}
/** Height inside one rendered XZ triangle, or null when the point is outside it. */
function triangleHeightAt(
  x: number,
  z: number,
  ia: number,
  ib: number,
  ic: number,
  positions: Float32Array,
  heights: Float32Array,
): number | null {
  const ax = positions[ia * 3]!;
  const az = positions[ia * 3 + 2]!;
  const bx = positions[ib * 3]!;
  const bz = positions[ib * 3 + 2]!;
  const cx = positions[ic * 3]!;
  const cz = positions[ic * 3 + 2]!;
  const denominator = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
  if (Math.abs(denominator) < 1e-6) return null;
  const wa = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / denominator;
  const wb = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / denominator;
  const wc = 1 - wa - wb;
  if (wa < -1e-4 || wb < -1e-4 || wc < -1e-4) return null;
  return heights[ia]! * wa + heights[ib]! * wb + heights[ic]! * wc;
}

/**
 * Height of the ACTUAL polar vista triangles. Sampling the analytic field here can
 * disagree with a 900 m rendered cell by tens of metres and leave a mesa in the air.
 */
function renderedGroundHeightAt(
  x: number,
  z: number,
  cx: number,
  cz: number,
  radii: readonly number[],
  positions: Float32Array,
  heights: Float32Array,
): number {
  const dx = x - cx;
  const dz = z - cz;
  const radius = Math.hypot(dx, dz);
  const clampedRadius = Math.max(radii[0]!, Math.min(radii[radii.length - 1]!, radius));
  const scale = radius > 1e-6 ? clampedRadius / radius : 0;
  const sampleX = radius > 1e-6 ? cx + dx * scale : cx;
  const sampleZ = radius > 1e-6 ? cz + dz * scale : cz + clampedRadius;

  let outerRing = 1;
  while (outerRing < radii.length - 1 && radii[outerRing]! < clampedRadius) outerRing++;
  const innerRing = outerRing - 1;
  let theta = Math.atan2(sampleX - cx, sampleZ - cz);
  if (theta < 0) theta += Math.PI * 2;
  const sectorFloat = (theta / (Math.PI * 2)) * SECTORS;
  const a = Math.floor(sectorFloat) % SECTORS;
  const b = (a + 1) % SECTORS;
  const innerA = innerRing * SECTORS + a;
  const innerB = innerRing * SECTORS + b;
  const outerA = outerRing * SECTORS + a;
  const outerB = outerRing * SECTORS + b;
  return (
    triangleHeightAt(sampleX, sampleZ, innerA, outerA, innerB, positions, heights) ??
    triangleHeightAt(sampleX, sampleZ, outerA, outerB, innerB, positions, heights) ??
    heights[innerA]!
  );
}

export class VistaMesh {
  /**
   * The season the ground is coloured for, updated every frame by the caller. A cell
   * takes it when it is sampled, and keeps it while cached: the cache holds the last
   * few kilometres, over which the season does not visibly move.
   */
  readonly season: SeasonState = newSeasonState();
  private readonly mesh: THREE.Mesh;
  /**
   * The disc as drawn, and the copy the next rebuild writes into. A rebuild is three
   * 175 KB uploads; written into the buffer the GPU may still be reading, each one waits
   * for it on ANGLE over Metal (4-8 ms, docs/research-2026-09-26.md, «Дёрганье»). So the
   * rebuild goes into the copy that has been out of the draw since the previous rebuild —
   * several frames at any driving speed — and the two swap.
   */
  private geometry: THREE.BufferGeometry | null = null;
  private backGeometry: THREE.BufferGeometry | null = null;
  /** Reused scratch geometry for normal generation; cell loads must not allocate it. */
  private normalGeometry: THREE.BufferGeometry | null = null;
  private normalPositions: Float32Array | null = null;
  private groundLocalPositions: Float32Array | null = null;
  private groundSamples: GroundCellSamples | null = null;
  private readonly groundSampleCache = new Map<string, GroundSample>();
  private sampleCellX = Number.NaN;
  private sampleCellZ = Number.NaN;
  private interpolationX = 0;
  private builtAtX = Number.NaN;
  private builtAtZ = Number.NaN;
  private interpolationZ = 0;

  private worker: Worker | null = null;
  private workerReady = false;
  private disposed = false;
  /**
   * Which disc the worker holds. Bumped whenever the geometry is rebuilt, so a
   * result computed for the previous view distance is dropped instead of being
   * written into buffers of a different length.
   */
  private layoutId = 0;
  private nextRequestId = 0;
  /** At most one request is in flight, so a stale corner cannot delay a wanted one. */
  private pendingRequest: {
    id: number;
    layoutId: number;
    key: string;
    cornerX: number;
    cornerZ: number;
  } | null = null;
  /** Corners the camera is about to need, in vista-local coordinates. */
  private readonly prefetchQueue: { cornerX: number; cornerZ: number }[] = [];
  /** Scratch field values for the synchronous path; sized with the disc. */
  /** The synchronous path's own buffers; sized with the disc. */
  private horizonScratch: Float32Array | null = null;
  private attributeScratch: GroundAttributes | null = null;
  private canopyScratch: Float32Array | null = null;

  /** Radius of the disc, metres. Set by the view-distance setting. */
  private outerRadius = 0;

  /** Ring radii for the current outer radius, rebuilt only when that changes. */
  private radii: number[] = [];
  /** Unit direction per sector, so a rebuild does no trigonometry. */
  private readonly dirX = new Float32Array(SECTORS);
  private readonly dirZ = new Float32Array(SECTORS);
  /** Fixed-capacity road samples rebuilt with the vista; used only to keep its cheap
   * underlay beneath the streamed road. */
  private readonly roadX = new Float64Array(ROAD_SAMPLE_CAPACITY);
  private readonly roadY = new Float64Array(ROAD_SAMPLE_CAPACITY);
  private readonly roadZ = new Float64Array(ROAD_SAMPLE_CAPACITY);
  private roadSampleCount = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly terrain: Terrain,
    private readonly road: Road,
    private readonly origin: WorldOrigin,
  ) {
    for (let a = 0; a < SECTORS; a++) {
      const theta = (a / SECTORS) * Math.PI * 2;
      this.dirX[a] = Math.sin(theta);
      this.dirZ[a] = Math.cos(theta);
    }
    this.mesh = new THREE.Mesh(
      new THREE.BufferGeometry(),
      [GROUND_VISTA_UNDER_MATERIAL, GROUND_VISTA_MATERIAL],
    );
    // After the tiles (0): the vista lies under them wherever both are drawn, and drawn
    // first it was shaded in full there and then painted over — 2.7 ms at 1.4 Mpx. The
    // outer band is ordinary depth-written ground, so order changes only who pays; the
    // inner band writes its depth at the far plane (`farDepthOnly`), so the tiles in
    // front of it still win. Before the sky dome (5), which fills only what is left.
    this.mesh.renderOrder = 1;
    // The disc surrounds the camera and spans the whole view; its bounding sphere is no
    // cheaper than drawing the already sparse geometry.
    this.mesh.frustumCulled = false;
    // Nothing this far away casts or receives a shadow the shadow map can resolve.
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.worker = this.createWorker();
  }

  private createWorker(): Worker | null {
    if (typeof Worker === 'undefined') return null;
    let worker: Worker | null = null;
    try {
      worker = new Worker(new URL('./vistaworker.ts', import.meta.url), { type: 'module' });
      const candidate = worker;
      candidate.onmessage = (event: MessageEvent<VistaWorkerResponse>) => {
        if (this.disposed || candidate !== this.worker) return;
        const response = event.data;
        if (response.type === 'ready') {
          this.workerReady = true;
          this.pumpWorker();
          return;
        }
        this.acceptSampleResult(response);
      };
      const fail = (): void => {
        if (candidate !== this.worker) return;
        candidate.terminate();
        this.worker = null;
        this.workerReady = false;
      };
      candidate.onerror = fail;
      candidate.onmessageerror = fail;
      const request: VistaWorkerRequest = {
        type: 'init',
        seed: this.road.seed,
        spine: this.road.spine,
      };
      candidate.postMessage(request);
      return candidate;
    } catch {
      worker?.terminate();
      return null;
    }
  }

  /**
   * Sends at most one corner request per pump and only while the worker is idle.
   * A queued corner that has since been sampled synchronously is dropped here
   * rather than recomputed.
   */
  private pumpWorker(): void {
    if (this.disposed || !this.worker || !this.workerReady || this.pendingRequest) return;
    if (this.groundLocalPositions === null) return;
    const ox = this.origin.x;
    const oz = this.origin.z;
    while (this.prefetchQueue.length > 0) {
      const next = this.prefetchQueue.shift()!;
      const key = `${next.cornerX + ox},${next.cornerZ + oz}`;
      if (this.groundSampleCache.has(key)) continue;
      const id = ++this.nextRequestId;
      this.pendingRequest = {
        id,
        layoutId: this.layoutId,
        key,
        cornerX: next.cornerX,
        cornerZ: next.cornerZ,
      };
      const request: VistaWorkerRequest = {
        type: 'sample',
        requestId: id,
        layoutId: this.layoutId,
        cornerX: next.cornerX,
        cornerZ: next.cornerZ,
        originX: ox,
        originZ: oz,
      };
      this.worker.postMessage(request);
      return;
    }
  }

  /**
   * Turns worker field values into a cached ground sample.
   *
   * Four things must still agree for the result to be usable: it must be the request
   * we are waiting for, computed for the disc we still have, under an origin the
   * cache key was formed from, and for a corner nothing has sampled synchronously in
   * the meantime. Anything else is discarded — the synchronous path remains correct
   * on its own, so a dropped prefetch costs nothing but the work.
   */
  private acceptSampleResult(result: VistaWorkerSampleResult): void {
    const pending = this.pendingRequest;
    this.pendingRequest = null;
    if (
      !pending
      || pending.id !== result.requestId
      || pending.layoutId !== this.layoutId
      || result.layoutId !== this.layoutId
      || result.originX !== this.origin.x
      || result.originZ !== this.origin.z
    ) {
      this.pumpWorker();
      return;
    }
    const horizon = new Float32Array(result.horizon);
    const vertexCount = this.radii.length * SECTORS;
    const blocks = [result.cover, result.aux, result.field, result.road, result.canopy].map(
      (buffer) => new Float32Array(buffer),
    );
    const [cover, aux, field, road, canopy] = blocks as [Float32Array, Float32Array, Float32Array, Float32Array, Float32Array];
    if (
      horizon.length === vertexCount
      && cover.length === vertexCount * GROUND_COVER_STRIDE
      && aux.length === vertexCount * GROUND_AUX_STRIDE
      && field.length === vertexCount * GROUND_FIELD_STRIDE
      && road.length === vertexCount * GROUND_ROAD_STRIDE
      && canopy.length === vertexCount * 4
      && !this.groundSampleCache.has(pending.key)
      && this.groundLocalPositions !== null
    ) {
      this.groundSampleCache.set(
        pending.key,
        this.buildGroundSample(pending.cornerX, pending.cornerZ, horizon, cover, aux, field, road, canopy),
      );
      this.trimGroundSampleCache();
    }
    this.pumpWorker();
  }

  /**
   * Extends the cheap polar ground to the camera's far plane. Fog owns the final
   * transition; the road-aware inner strip below owns the reported gaps.
   */
  setViewDistance(metres: number): void {
    const outer = metres <= INNER_RADIUS ? 0 : farPlaneForViewDistance(metres);
    if (outer === this.outerRadius) return;
    this.outerRadius = outer;
    this.mesh.visible = outer > 0;
    this.radii = outer > 0 ? ringRadii(outer) : [];
    this.groundSamples = null;
    this.groundSampleCache.clear();
    this.groundLocalPositions = null;
    this.sampleCellX = Number.NaN;
    this.sampleCellZ = Number.NaN;
    this.prefetchQueue.length = 0;
    this.pendingRequest = null;
  }

  /**
   * The polar disc follows the camera continuously. Its expensive terrain samples come
   * from the four corners of the current cell and only the cheap interpolation runs every
   * frame, so the ground moves continuously and reversibly with the car.
   */
  update(cameraX: number, cameraZ: number, s: number, _frameDt: number): void {
    if (this.outerRadius <= 0) return;
    this.ensureGroundGeometry();
    const cellX = Math.floor(cameraX / SAMPLE_CELL_SIZE);
    const cellZ = Math.floor(cameraZ / SAMPLE_CELL_SIZE);
    const cellChanged =
      cellX !== this.sampleCellX || cellZ !== this.sampleCellZ || this.groundSamples === null;
    if (cellChanged) this.prepareRoadUnderlay(s);
    if (cellChanged) this.loadGroundCell(cellX, cellZ);

    this.interpolationX = Math.max(
      0,
      Math.min(1, (cameraX - cellX * SAMPLE_CELL_SIZE) / SAMPLE_CELL_SIZE),
    );
    this.interpolationZ = Math.max(
      0,
      Math.min(1, (cameraZ - cellZ * SAMPLE_CELL_SIZE) / SAMPLE_CELL_SIZE),
    );
    // Not every frame: rebuilding the disc is three 175 KB uploads, 3-4 ms a frame on
    // ANGLE/Metal (measured). The disc is kept where it was last built, so it stays
    // exactly consistent with itself; the camera can stray `VISTA_STEP_M` from its
    // centre, which at the disc's inner edge, 200 m out and under the tiles, is nothing.
    if (cellChanged || Math.hypot(cameraX - this.builtAtX, cameraZ - this.builtAtZ) >= VISTA_STEP_M) {
      this.builtAtX = cameraX;
      this.builtAtZ = cameraZ;
      this.updateGroundPositions(cameraX, cameraZ);
    }

  }

  private updateGroundPositions(cameraX: number, cameraZ: number): void {
    if (!this.geometry || !this.backGeometry || !this.groundSamples) return;
    const target = this.backGeometry;
    const position = target.getAttribute('position') as THREE.BufferAttribute;
    const normal = target.getAttribute('normal') as THREE.BufferAttribute;
    const xyz = position.array as Float32Array;
    const normals = normal.array as Float32Array;
    const [sample00, sample10, sample01, sample11] = this.groundSamples;
    // Everything the shader reads about the ground, interpolated between the four cell
    // corners exactly as the heights are: they are all linear quantities in x and z, so
    // crossing a cell corner cannot step the picture.
    const blocks: [THREE.BufferAttribute, Float32Array, Float32Array, Float32Array, Float32Array][] = [
      [target.getAttribute(GROUND_ATTRIBUTES.cover) as THREE.BufferAttribute, sample00.cover, sample10.cover, sample01.cover, sample11.cover],
      [target.getAttribute(GROUND_ATTRIBUTES.aux) as THREE.BufferAttribute, sample00.aux, sample10.aux, sample01.aux, sample11.aux],
      [target.getAttribute(GROUND_ATTRIBUTES.field) as THREE.BufferAttribute, sample00.field, sample10.field, sample01.field, sample11.field],
      [target.getAttribute(GROUND_ATTRIBUTES.road) as THREE.BufferAttribute, sample00.road, sample10.road, sample01.road, sample11.road],
      [target.getAttribute(GROUND_ATTRIBUTES.canopy) as THREE.BufferAttribute, sample00.canopy, sample10.canopy, sample01.canopy, sample11.canopy],
    ];
    const tx = this.interpolationX;
    const tz = this.interpolationZ;
    for (let i = 0; i < sample00.heights.length; i++) {
      const vi = i * 3;
      const lower =
        sample00.heights[i]! + (sample10.heights[i]! - sample00.heights[i]!) * tx;
      const upper =
        sample01.heights[i]! + (sample11.heights[i]! - sample01.heights[i]!) * tx;
      let y = lower + (upper - lower) * tz;
      const ring = Math.floor(i / SECTORS);
      const radius = this.radii[ring]!;
      if (radius <= ROAD_UNDERLAY_RADIUS) {
        const bias =
          INNER_BIAS *
          (1 - smoothstep01((radius - INNER_RADIUS) / (BIAS_FADE - INNER_RADIUS)));
        y = this.beneathRoad(
          cameraX + this.groundLocalPositions![vi]! + this.origin.x,
          cameraZ + this.groundLocalPositions![vi + 2]! + this.origin.z,
          y,
          bias,
        );
      }
      xyz[vi + 1] = y;
      const nxLower =
        sample00.normals[vi]! + (sample10.normals[vi]! - sample00.normals[vi]!) * tx;
      const nxUpper =
        sample01.normals[vi]! + (sample11.normals[vi]! - sample01.normals[vi]!) * tx;
      const nyLower =
        sample00.normals[vi + 1]! +
        (sample10.normals[vi + 1]! - sample00.normals[vi + 1]!) * tx;
      const nyUpper =
        sample01.normals[vi + 1]! +
        (sample11.normals[vi + 1]! - sample01.normals[vi + 1]!) * tx;
      const nzLower =
        sample00.normals[vi + 2]! +
        (sample10.normals[vi + 2]! - sample00.normals[vi + 2]!) * tx;
      const nzUpper =
        sample01.normals[vi + 2]! +
        (sample11.normals[vi + 2]! - sample01.normals[vi + 2]!) * tx;
      const nx = nxLower + (nxUpper - nxLower) * tz;
      const ny = nyLower + (nyUpper - nyLower) * tz;
      const nz = nzLower + (nzUpper - nzLower) * tz;
      // Interpolated unit normals are bounded; no hypot overflow rescaling is needed.
      const normalLength = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      normals[vi] = nx / normalLength;
      normals[vi + 1] = ny / normalLength;
      normals[vi + 2] = nz / normalLength;
    }
    for (const [attribute, c00, c10, c01, c11] of blocks) {
      const out = attribute.array as Float32Array;
      for (let i = 0; i < out.length; i++) {
        const lower = c00[i]! + (c10[i]! - c00[i]!) * tx;
        const upper = c01[i]! + (c11[i]! - c01[i]!) * tx;
        out[i] = lower + (upper - lower) * tz;
      }
      attribute.needsUpdate = true;
    }
    this.mesh.position.set(cameraX, 0, cameraZ);
    position.needsUpdate = true;
    normal.needsUpdate = true;
    this.backGeometry = this.geometry;
    this.geometry = target;
    this.mesh.geometry = target;
  }

  private prepareRoadUnderlay(s: number): void {
    const from = Math.max(0, s - ROAD_UNDERLAY_RADIUS);
    const to = Math.min(this.road.length, s + ROAD_UNDERLAY_RADIUS);
    const count = Math.max(2, Math.ceil((to - from) / ROAD_SAMPLE_STEP) + 1);
    this.roadSampleCount = Math.min(count, ROAD_SAMPLE_CAPACITY);
    const denominator = Math.max(1, this.roadSampleCount - 1);
    for (let i = 0; i < this.roadSampleCount; i++) {
      const sampleS = from + ((to - from) * i) / denominator;
      const sample = this.road.sampleAt(sampleS);
      this.roadX[i] = sample.x;
      this.roadZ[i] = sample.z;
      this.roadY[i] = this.terrain.explorationHeightFromFrame(
        sample.x,
        sample.z,
        0,
        sample.s,
      );
    }
  }

  /**
   * Smoothly buries a vista vertex beneath the closest sampled road segment. Segment
   * distance matters here: lowering isolated vertices around isolated samples makes
   * long triangles whose sides read as disappearing cones.
   */
  private beneathRoad(x: number, z: number, openY: number, bias: number): number {
    const coarseStride = 4;
    let closestSample = 0;
    let closestSampleDistanceSq = Infinity;
    for (let i = 0; i < this.roadSampleCount; i += coarseStride) {
      const distanceSq = (x - this.roadX[i]!) ** 2 + (z - this.roadZ[i]!) ** 2;
      if (distanceSq >= closestSampleDistanceSq) continue;
      closestSampleDistanceSq = distanceSq;
      closestSample = i;
    }
    const lastSample = this.roadSampleCount - 1;
    const lastDistanceSq =
      (x - this.roadX[lastSample]!) ** 2 + (z - this.roadZ[lastSample]!) ** 2;
    if (lastDistanceSq < closestSampleDistanceSq) {
      closestSampleDistanceSq = lastDistanceSq;
      closestSample = lastSample;
    }
    const coarseReach = ROAD_UNDERLAY_FADE + (ROAD_SAMPLE_STEP * coarseStride) / 2;
    if (closestSampleDistanceSq >= coarseReach * coarseReach) return openY;

    let closestDistanceSq = ROAD_UNDERLAY_FADE * ROAD_UNDERLAY_FADE;
    let closestRoadY = 0;
    const from = Math.max(0, closestSample - coarseStride);
    const to = Math.min(this.roadSampleCount - 1, closestSample + coarseStride);
    for (let i = from; i < to; i++) {
      const ax = this.roadX[i]!;
      const az = this.roadZ[i]!;
      const dx = this.roadX[i + 1]! - ax;
      const dz = this.roadZ[i + 1]! - az;
      const lengthSq = dx * dx + dz * dz;
      const t =
        lengthSq > 0
          ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / lengthSq))
          : 0;
      const nearestX = ax + dx * t;
      const nearestZ = az + dz * t;
      const distanceSq = (x - nearestX) ** 2 + (z - nearestZ) ** 2;
      if (distanceSq >= closestDistanceSq) continue;
      closestDistanceSq = distanceSq;
      closestRoadY = this.roadY[i]! + (this.roadY[i + 1]! - this.roadY[i]!) * t;
    }
    if (closestDistanceSq >= ROAD_UNDERLAY_FADE * ROAD_UNDERLAY_FADE) return openY;
    const belowRoad = closestRoadY - bias - ROAD_UNDERLAY_DROP;
    if (belowRoad >= openY) return openY;
    const distance = Math.sqrt(closestDistanceSq);
    const fade = smoothstep01(
      (distance - ROAD_UNDERLAY_CORE) / (ROAD_UNDERLAY_FADE - ROAD_UNDERLAY_CORE),
    );
    return belowRoad + (openY - belowRoad) * fade;
  }

  private ensureGroundGeometry(): void {
    const rings = this.radii.length;
    const vertexCount = rings * SECTORS;
    if (
      this.geometry &&
      this.groundLocalPositions &&
      this.groundLocalPositions.length === vertexCount * 3
    ) {
      return;
    }

    const positions = new Float32Array(vertexCount * 3);
    for (let r = 0; r < rings; r++) {
      const radius = this.radii[r]!;
      for (let a = 0; a < SECTORS; a++) {
        const vi = (r * SECTORS + a) * 3;
        positions[vi] = this.dirX[a]! * radius;
        positions[vi + 2] = this.dirZ[a]! * radius;
      }
    }

    // Quads between consecutive rings, wrapping in the angular direction. Wrapping rather
    // than duplicating the seam column keeps the two sides of it numerically identical.
    const index = new Uint32Array((rings - 1) * SECTORS * 6);
    let o = 0;
    for (let r = 0; r < rings - 1; r++) {
      const inner = r * SECTORS;
      const outer = inner + SECTORS;
      for (let a = 0; a < SECTORS; a++) {
        const b = (a + 1) % SECTORS;
        index[o] = inner + a;
        index[o + 1] = outer + a;
        index[o + 2] = inner + b;
        index[o + 3] = outer + a;
        index[o + 4] = outer + b;
        index[o + 5] = inner + b;
        o += 6;
      }
    }

    // Two copies of the disc (see `backGeometry`), sharing one index. Each carries its
    // own position array: the rebuild writes heights into it, and the local x/z the
    // road underlay reads come from `groundLocalPositions`, which no rebuild touches.
    const indexAttribute = new THREE.BufferAttribute(index, 1);
    let overlapPairs = 0;
    while (
      overlapPairs < rings - 1 &&
      this.radii[overlapPairs]! < NON_OCCLUDING_RADIUS
    ) {
      overlapPairs++;
    }
    const overlapIndexCount = overlapPairs * SECTORS * 6;
    const makeDisc = (): THREE.BufferGeometry => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions.slice(), 3));
      geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(positions.length), 3));
      geometry.setAttribute(GROUND_ATTRIBUTES.cover, new THREE.BufferAttribute(new Float32Array(vertexCount * GROUND_COVER_STRIDE), GROUND_COVER_STRIDE));
      geometry.setAttribute(GROUND_ATTRIBUTES.aux, new THREE.BufferAttribute(new Float32Array(vertexCount * GROUND_AUX_STRIDE), GROUND_AUX_STRIDE));
      geometry.setAttribute(GROUND_ATTRIBUTES.field, new THREE.BufferAttribute(new Float32Array(vertexCount * GROUND_FIELD_STRIDE), GROUND_FIELD_STRIDE));
      geometry.setAttribute(GROUND_ATTRIBUTES.road, new THREE.BufferAttribute(new Float32Array(vertexCount * GROUND_ROAD_STRIDE), GROUND_ROAD_STRIDE));
      geometry.setAttribute(GROUND_ATTRIBUTES.canopy, new THREE.BufferAttribute(new Float32Array(vertexCount * 4), 4));
      geometry.setIndex(indexAttribute);
      geometry.addGroup(0, overlapIndexCount, 0);
      geometry.addGroup(overlapIndexCount, index.length - overlapIndexCount, 1);
      return geometry;
    };
    this.geometry?.dispose();
    this.backGeometry?.dispose();
    this.geometry = makeDisc();
    this.backGeometry = makeDisc();
    this.groundLocalPositions = positions;
    this.mesh.geometry = this.geometry;
    // A new disc invalidates the worker's layout, every queued corner and anything
    // still in flight: they were all sized for the previous ring count.
    this.layoutId++;
    this.pendingRequest = null;
    this.prefetchQueue.length = 0;
    this.publishLayout();
  }

  private loadGroundCell(cellX: number, cellZ: number): void {
    const x0 = cellX * SAMPLE_CELL_SIZE;
    const z0 = cellZ * SAMPLE_CELL_SIZE;

    const samples: GroundCellSamples = [
      this.groundSampleAt(x0, z0),
      this.groundSampleAt(x0 + SAMPLE_CELL_SIZE, z0),
      this.groundSampleAt(x0, z0 + SAMPLE_CELL_SIZE),
      this.groundSampleAt(x0 + SAMPLE_CELL_SIZE, z0 + SAMPLE_CELL_SIZE),
    ];
    this.groundSamples = samples;
    this.sampleCellX = cellX;
    this.sampleCellZ = cellZ;
    invariantLocalPositions(this.groundLocalPositions);
    this.trimGroundSampleCache();
    // Queue the corners of the eight neighbouring cells. Whichever way the camera
    // leaves this cell, the corners it needs are already being sampled off-thread,
    // so the crossing costs interpolation rather than a terrain sweep.
    this.queueNeighbourCorners(cellX, cellZ);
    this.pumpWorker();
  }

  /**
   * The synchronous fallback: samples the terrain field for one cell corner on the
   * main thread. Used for the first cell of a session and whenever a crossing
   * outruns the worker; the worker path below writes into the same cache.
   */
  private groundSampleAt(cx: number, cz: number): GroundSample {
    const key = `${cx + this.origin.x},${cz + this.origin.z}`;
    const cached = this.groundSampleCache.get(key);
    if (cached) {
      this.groundSampleCache.delete(key);
      this.groundSampleCache.set(key, cached);
      return cached;
    }
    invariantLocalPositions(this.groundLocalPositions);
    const vertexCount = this.radii.length * SECTORS;
    if (this.horizonScratch?.length !== vertexCount) {
      this.horizonScratch = new Float32Array(vertexCount);
      this.attributeScratch = new GroundAttributes(vertexCount);
      this.canopyScratch = new Float32Array(vertexCount * 4);
    }
    const horizon = this.horizonScratch!;
    const attributes = this.attributeScratch!;
    const canopy = this.canopyScratch!;
    const ox = this.origin.x;
    const oz = this.origin.z;
    for (let r = 0; r < this.radii.length; r++) {
      const radius = this.radii[r]!;
      const reliefWeight =
        1 - smoothstep01((radius - RELIEF_FADE_START) / (RELIEF_FADE_END - RELIEF_FADE_START));
      for (let a = 0; a < SECTORS; a++) {
        const i = r * SECTORS + a;
        const vi = i * 3;
        const absoluteX = cx + this.groundLocalPositions[vi]! + ox;
        const absoluteZ = cz + this.groundLocalPositions[vi + 2]! + oz;
        horizon[i] = vistaGroundAt(this.terrain, absoluteX, absoluteZ, radius, reliefWeight, attributes, i, canopy);
      }
    }
    const sample = this.buildGroundSample(
      cx, cz, horizon, attributes.cover, attributes.aux, attributes.field, attributes.road, canopy,
    );
    this.groundSampleCache.set(key, sample);
    return sample;
  }

  /**
   * Shapes raw terrain field values into a renderable sample: the overlap bias, the road
   * underlay, the smooth normals and the rock the slope calls for. Deliberately shared by
   * the synchronous and worker paths, so both produce identical geometry.
   *
   * The attribute blocks are COPIED, because the caller's arrays are the synchronous
   * path's own scratch and are about to be written over.
   */
  private buildGroundSample(
    cx: number,
    cz: number,
    horizon: Float32Array,
    coverIn: Float32Array,
    auxIn: Float32Array,
    fieldIn: Float32Array,
    roadIn: Float32Array,
    canopyIn: Float32Array,
  ): GroundSample {
    invariantLocalPositions(this.groundLocalPositions);
    const vertexCount = this.radii.length * SECTORS;
    const heights = new Float32Array(vertexCount);
    const ox = this.origin.x;
    const oz = this.origin.z;
    for (let r = 0; r < this.radii.length; r++) {
      const radius = this.radii[r]!;
      const bias =
        INNER_BIAS *
        (1 - smoothstep01((radius - INNER_RADIUS) / (BIAS_FADE - INNER_RADIUS)));
      for (let a = 0; a < SECTORS; a++) {
        const i = r * SECTORS + a;
        const vi = i * 3;
        const horizonY = horizon[i]!;
        if (radius <= ROAD_UNDERLAY_RADIUS) {
          const absoluteX = cx + this.groundLocalPositions[vi]! + ox;
          const absoluteZ = cz + this.groundLocalPositions[vi + 2]! + oz;
          heights[i] = this.beneathRoad(absoluteX, absoluteZ, horizonY - bias, bias);
        } else {
          heights[i] = horizonY - bias;
        }
      }
    }
    const aux = auxIn.slice();
    const normals = this.groundNormalsFor(heights);
    // Rock comes off the slope, and the slope only exists here, where the heights have
    // been turned into normals: the same `groundRockWeight` the tiles use, so the two
    // agree about where a bank stops being a bank.
    for (let i = 0; i < vertexCount; i++) {
      aux[i * GROUND_AUX_STRIDE + 3] = groundRockWeight(normals[i * 3 + 1]!);
    }
    return {
      heights,
      cover: coverIn.slice(),
      aux,
      field: fieldIn.slice(),
      road: roadIn.slice(),
      canopy: canopyIn.slice(),
      normals,
    };
  }

  /** Sends the current disc layout so a sample request is only four numbers. */
  private publishLayout(): void {
    if (this.disposed || !this.worker || this.groundLocalPositions === null) return;
    const positions = this.groundLocalPositions.slice();
    const radii = new Float32Array(this.radii);
    const request: VistaWorkerRequest = {
      type: 'layout',
      layoutId: this.layoutId,
      positions: positions.buffer as ArrayBuffer,
      radii: radii.buffer as ArrayBuffer,
    };
    this.worker.postMessage(request, [request.positions, request.radii]);
  }

  /**
   * Corners of the 3x3 cell block around the current one. Nine cells share sixteen
   * corners, four of which are the current cell's, so a crossing in any direction —
   * including straight back — finds its corners already sampled.
   */
  private queueNeighbourCorners(cellX: number, cellZ: number): void {
    if (!this.worker) return;
    this.prefetchQueue.length = 0;
    const ox = this.origin.x;
    const oz = this.origin.z;
    for (let dz = -1; dz <= 2; dz++) {
      for (let dx = -1; dx <= 2; dx++) {
        const cornerX = (cellX + dx) * SAMPLE_CELL_SIZE;
        const cornerZ = (cellZ + dz) * SAMPLE_CELL_SIZE;
        if (this.groundSampleCache.has(`${cornerX + ox},${cornerZ + oz}`)) continue;
        this.prefetchQueue.push({ cornerX, cornerZ });
      }
    }
  }

  /**
   * Bounded LRU over cell corners. Sixteen is the 3x3 prefetch block, so a player
   * driving back and forth over one boundary never re-samples.
   */
  private trimGroundSampleCache(): void {
    while (this.groundSampleCache.size > 24) {
      const oldest = this.groundSampleCache.keys().next().value;
      if (oldest === undefined) break;
      this.groundSampleCache.delete(oldest);
    }
  }

  private groundNormalsFor(heights: Float32Array): Float32Array {
    invariantLocalPositions(this.groundLocalPositions);
    if (!this.geometry) throw new Error('vista ground geometry is not initialized');
    const positionCount = this.groundLocalPositions.length;
    if (this.normalGeometry === null || this.normalPositions?.length !== positionCount) {
      this.normalPositions = new Float32Array(positionCount);
      this.normalGeometry?.dispose();
      this.normalGeometry = new THREE.BufferGeometry();
      this.normalGeometry.setAttribute(
        'position',
        new THREE.BufferAttribute(this.normalPositions, 3),
      );
      this.normalGeometry.setIndex(this.geometry.getIndex()!);
    }
    this.normalPositions.set(this.groundLocalPositions);
    for (let i = 0; i < heights.length; i++) this.normalPositions[i * 3 + 1] = heights[i]!;
    const position = this.normalGeometry.getAttribute('position') as THREE.BufferAttribute;
    position.needsUpdate = true;
    this.normalGeometry.computeVertexNormals();
    const normal = this.normalGeometry.getAttribute('normal') as THREE.BufferAttribute;
    return new Float32Array(normal.array as Float32Array);
  }

  /** Vertices in the current disc, for the perf bench. */
  get vertexCount(): number {
    return this.radii.length * SECTORS;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.worker?.terminate();
    this.worker = null;
    this.workerReady = false;
    this.scene.remove(this.mesh);
    this.geometry?.dispose();
    this.backGeometry?.dispose();
    this.normalGeometry?.dispose();
    this.geometry = null;
    this.backGeometry = null;
    this.normalGeometry = null;
    this.normalPositions = null;
    this.groundLocalPositions = null;
    this.groundSamples = null;
    this.groundSampleCache.clear();
    this.horizonScratch = null;
    this.attributeScratch = null;
    this.canopyScratch = null;
  }
}

/**
 * Ring radii from the inner edge to `outer`: geometric growth until the spacing reaches
 * the cap, then constant. The last ring is forced onto `outer` exactly, so the disc's
 * silhouette is a circle rather than a polygon whose radius depends on where the
 * progression happened to land.
 */
function ringRadii(outer: number): number[] {
  const radii = [INNER_RADIUS];
  let r = INNER_RADIUS;
  while (r < outer) {
    r += Math.min(r * (RADIAL_RATIO - 1), MAX_RING_SPACING);
    if (r >= outer) break;
    radii.push(r);
  }
  radii.push(outer);
  return radii;
}
