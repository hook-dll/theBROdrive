import * as THREE from 'three';
import { farPlaneForViewDistance } from '../core/renderer';
import { DESERT_TILE_SIZE } from '../world/deserttiledata';
import {
  MESA_CELL_SIZE,
  MESA_MAX_RADIUS,
  MESA_RINGS,
  MESA_TOP_HEIGHT,
  footprintDistance,
  mesaFacetShade,
  mesaFootingY,
  mesaFieldOf,
  type MesaField,
  type MesaSite,
} from '../world/mesas';
import { applyCloudShadow } from './cloudshadow';
import { applyComicShading } from './comic';
import { applyGroundLight } from './groundlight';

import { desertPaletteAt } from '../world/gradient';
import { groundWindowRevision, outsideGroundWindow } from './groundfade';
import type { WorldOrigin } from '../world/origin';
import type { Road } from '../world/road';
import type { Terrain } from '../world/terrain';
import { applyDesertGround, TERRAIN_MATERIAL } from '../world/terrainmesh';
import type {
  VistaWorkerRequest,
  VistaWorkerResponse,
  VistaWorkerSampleResult,
} from './vistaworker';

/**
 * The fine, player-centred desert tiles own the ground around the camera. This polar
 * mesh begins beneath their guaranteed synchronous ring and carries the distant view.
 * The overlap also covers a visual tile that is still arriving from the worker, so a
 * scheduling delay cannot expose sky between the two terrain systems. A second, much
 * smaller mesh draws the desert's mesas (`world/mesas.ts`) through the middle distance.
 *
 * Mountain ranges stand at fixed world positions, kilometres off the road. Mesas keep a
 * stable world position too, placed clear of every pass of the road, and stay standing
 * as the player drives up to and past them; near the player they are solid
 * (`world/mesacolliders.ts`). The horizon is a spatial interpolation of fixed world
 * samples, never a timed animation.
 *
 * WORLD-ANCHORED BETWEEN STEPS. The disc does not slide with the camera: it stands on a
 * world lattice of `DISC_STEP` and moves only when the camera's nearest lattice point
 * changes, and its heights and the mesas' are a function of that point alone. Between
 * steps nothing in it moves, so the drawn ground and a mesa's foot hold still under a
 * moving camera. When it slid, every vertex was re-blended for the camera's exact
 * position up to 75 times a second, the triangle over any fixed spot changed with it,
 * and the drawn height there wandered by up to 10 m across a cell (at 10 km), a few
 * centimetres a frame: enough to flip a mesa's outline against the ground from frame to
 * frame (owner's recording, 2026-10-27).
 */

/**
 * Terrain samples at the corners of this world-space grid are bilinearly mixed for the
 * disc's lattice point. Crossing a cell therefore reuses the same edge samples: movement
 * stays spatial and immediately reversible instead of starting a timed morph.
 */
const SAMPLE_CELL_SIZE = 250;
/**
 * The disc's lattice: it stands on the lattice point nearest the camera, sixteen to a
 * cell. Fine enough that the camera is never more than `DISC_STEP / sqrt 2` (11 m) off
 * the disc's centre, which `INNER_RADIUS` absorbs, and that a step's change at a fixed
 * spot is a fraction of a pixel (tens of centimetres at 2-10 km); coarse enough that the
 * disc is rewritten a few times a second at speed (2.6/s at 40 m/s) rather than every
 * frame.
 */
const DISC_STEPS_PER_CELL = 16;
const DISC_STEP = SAMPLE_CELL_SIZE / DISC_STEPS_PER_CELL;

/**
 * Forty metres of hidden overlap beneath the nearest guaranteed tile edge, wherever the
 * camera stands about the disc's lattice point.
 */
const INNER_RADIUS = DESERT_TILE_SIZE - 40 - DISC_STEP * Math.SQRT1_2;
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
 * Past the fine tiles the vista is the only ground under the streamed road, and its
 * interpolated heights can sit metres BELOW the ribbon, which then hangs in the air on
 * the skyline. Outside the tile window it is pulled UP to the road as well as down;
 * inside, the tiles own the ground and it must stay under them. Applied only in the
 * per-frame pass, never baked into the cached cell samples, because the window moves.
 */
function roadRaiseAt(absX: number, absZ: number): number {
  return smoothstep01((outsideGroundWindow(absX, absZ) + 10) / 60);
}
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

/** Downward overlap bias, fading out over the first eighty metres of the vista. */
const INNER_BIAS = 2;
const BIAS_FADE = 480;

/**
 * Altitude, in metres above the ring's own base, over which distant ground reads as rock
 * rather than sand.
 *
 * Mountains are not made of dune sand and painting them as though they were makes a
 * kilometre-tall range look like a heap of it. The tint is by height alone: cheap, and at
 * this distance nobody can tell it from a real material boundary.
 */
const ROCK_ALTITUDE = 260;

/**
 * Mesas are drawn out to `MESA_MAX_DISTANCE` and buried by `MESA_BURY_DEPTH` over the
 * last `MESA_OUTER_FADE` of it, so one entering or leaving the resident set does so
 * underground rather than popping. Where each one stands, and its shape, are
 * `world/mesas.ts`'s.
 */
const MESA_MAX_DISTANCE = 18_000;
const MESA_OUTER_FADE = 2000;
const MESA_RESIDENCY_MARGIN = SAMPLE_CELL_SIZE * 2;
const MESA_BURY_DEPTH = 12;
/** The vista's skirt sits this far under its own interpolated ground. */
const MESA_SKIRT_DROP = 3;
/**
 * Below the skirt the vista hangs a vertical curtain of rock this deep, at the skirt's
 * own outline, so no ground a mesa stands on can open a gap under its foot: the vista's
 * ground at a spot and the ground a mesa vertex was stood on are interpolated from
 * different triangles and disagree by metres over dunes (10 m and more,
 * render/groundfade.ts), and on a slope the ground between two skirt vertices falls
 * further. The skirt itself stays 3 m down, so the talus between it and the wall's foot,
 * and the footprint the colliders and the placement share (`MESA_RINGS`), keep their
 * shape. Nothing of the curtain shows unless the ground drops away beside it.
 */
const MESA_CURTAIN_DEPTH = 60;
/**
 * Near the player a mesa stands on the EXACT ground (`MesaField.footing`,
 * `mesaFootingY`): the ground the fine tiles draw and the collider
 * (`world/mesacolliders.ts`) is built on, so the wall the car hits is the wall it sees.
 *
 * The vista's own ground is a 250 m-cell interpolation of a polar mesh whose rings are
 * tens of metres apart, and it is not even the same field: it carries the horizon
 * mountains, which the tiles never do. A skirt three metres under it hung in the air
 * over a hollow the tiles drew at the foot of a mesa the player drove up to, with lit
 * sky under the rock; past `MOUNTAIN_START` the whole mesa stood hundreds of metres up
 * on a mountain the player could not see. So inside `MESA_FOOTING_FULL` of a footprint
 * every vertex takes its exact height, and the skirt also stays under the vista's
 * ground; out to `MESA_FOOTING_REACH` the mesa blends back onto the vista's ground,
 * spatially (the fine tiles end at `DESERT_TILE_SIZE * 2.5`; past it the vista's
 * ground is the only ground there is). A mesa within `MESA_FOOTING_REACH` plus what the
 * camera can cover inside one sample cell is "footed" at a cell load and carries the
 * exact heights; nothing else pays for them.
 */
const MESA_FOOTING_FULL = DESERT_TILE_SIZE * 3;
const MESA_FOOTING_REACH = DESERT_TILE_SIZE * 5;
const MESA_FOOTED_AT = MESA_FOOTING_REACH + SAMPLE_CELL_SIZE * 2;

type GroundSample = {
  heights: Float32Array;
  colors: Float32Array;
  normals: Float32Array;
};

type GroundCellSamples = [
  GroundSample,
  GroundSample,
  GroundSample,
  GroundSample,
];

type GroundHeightSamples = [
  Float32Array,
  Float32Array,
  Float32Array,
  Float32Array,
];

type MesaCandidate = {
  readonly key: number;
  readonly firstVertex: number;
  readonly vertexCount: number;
  readonly centreX: number;
  readonly centreZ: number;
  readonly radius: number;
  /** Carries exact-ground heights (`MESA_FOOTED_AT`). */
  readonly footed: boolean;
};

/** Palette scratch colours, set once per interpolation-cell load. */
const sandLinear = new THREE.Color();
const rockLinear = new THREE.Color();
const mesaLinear = new THREE.Color();
/**
 * Mesas need physical light and fog, but not the terrain shader's elevation contours:
 * on a sheer wall those screen-space lines read as printed cardboard. No polygon
 * offset: it was there to settle the skirt's last sub-pixel contact with the ground,
 * and on the reversed float depth buffer (render/depthconvention.ts) the foot meets the
 * ground at its true line; the offset only pulled the outline a pixel's depth forward.
 */
// The drifting cloud shade is shared with the streamed terrain and the road (see
// `render/cloudshadow.ts`): a patch that stopped at the edge of the near tiles
// would draw its own boundary across the desert, which is the one place the effect
// would be worse than not having it.
const MESA_MATERIAL = applyGroundLight(applyCloudShadow(
  applyComicShading(
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.98,
      metalness: 0,
    }),
    {
      lightingStrength: 0.18,
      shadowWarmth: 0.35,
      reliefShadeStrength: 0.12,
      contourStrength: 0,
      stippleStrength: 0,
    },
  ),
));


// Same authored shading as streamed terrain, used only where both terrain systems
// overlap. It draws colour but not depth, so the fine tiles win without corrupting
// the depth of the distant vista, mesas, fog, or the post-process.
const VISTA_OVERLAP_MATERIAL = applyGroundLight(applyDesertGround(
  applyCloudShadow(
    applyComicShading(
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.93,
        metalness: 0,
        depthWrite: false,
      }),
      {
        lightingStrength: 0,
        shadowWarmth: 0,
        reliefShadeStrength: 0.28,
        spotlightNormals: 'smooth',
      },
    ),
  ),
));


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
 *
 * A ring is drawn as chords, which sag inside its circle (3.5 m at 18 km), so a point
 * just inside a ring's radius can lie beyond its chord, in the next pair of rings'
 * triangles: that pair is tried before giving up. Taking a vertex's height there instead
 * stood a mesa 80 m above the drawn ground on a mountainside (tools/vista-check.ts).
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
  let theta = Math.atan2(sampleX - cx, sampleZ - cz);
  if (theta < 0) theta += Math.PI * 2;
  const sectorFloat = (theta / (Math.PI * 2)) * SECTORS;
  const a = Math.floor(sectorFloat) % SECTORS;
  const b = (a + 1) % SECTORS;
  const lastRing = Math.min(outerRing + 1, radii.length - 1);
  for (let ring = outerRing; ring <= lastRing; ring++) {
    const innerA = (ring - 1) * SECTORS + a;
    const innerB = (ring - 1) * SECTORS + b;
    const outerA = ring * SECTORS + a;
    const outerB = ring * SECTORS + b;
    const height =
      triangleHeightAt(sampleX, sampleZ, innerA, outerA, innerB, positions, heights) ??
      triangleHeightAt(sampleX, sampleZ, outerA, outerB, innerB, positions, heights);
    if (height !== null) return height;
  }
  return heights[(outerRing - 1) * SECTORS + a]!;
}

export class VistaMesh {
  private readonly mesh: THREE.Mesh;
  private readonly mesaMesh: THREE.Mesh;
  private readonly mesas: MesaField;
  private geometry: THREE.BufferGeometry | null = null;
  private mesaGeometry: THREE.BufferGeometry | null = null;
  private groundLocalPositions: Float32Array | null = null;
  private groundSamples: GroundCellSamples | null = null;
  private readonly groundSampleCache = new Map<string, GroundSample>();
  private sampleCellX = Number.NaN;
  private sampleCellZ = Number.NaN;
  private interpolationX = 0;
  private interpolationZ = 0;
  /** The disc's lattice point (`DISC_STEP` units) and the tile window it was written for. */
  private discStepX = Number.NaN;
  private discStepZ = Number.NaN;
  private discWindow = -1;

  /** CPU-only mesa animation data; none of these buffers are uploaded as attributes. */
  private mesaGroundY: GroundHeightSamples | null = null;
  private mesaHeightOffset: Float32Array | null = null;
  private mesaCentreXZ: Float32Array | null = null;
  /** Per mesa vertex, its exact-ground height (`MESA_FOOTING_FULL`); NaN unless footed. */
  private mesaExactY: Float32Array | null = null;
  private mesaCandidates: MesaCandidate[] = [];
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
  private horizonScratch: Float32Array | null = null;
  private baseScratch: Float32Array | null = null;
  /**
   * The camera's arclength when the current cell was loaded: the hint the roadside
   * landforms are looked up by (`Terrain.horizonHeight`). Their window is kilometres
   * wide, so a prefetch sent a cell later gets the same ground.
   */
  private groundHintS = 0;
  private mesaVisibleOuter = 0;

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
    this.mesas = mesaFieldOf(road, terrain);
    for (let a = 0; a < SECTORS; a++) {
      const theta = (a / SECTORS) * Math.PI * 2;
      this.dirX[a] = Math.sin(theta);
      this.dirZ[a] = Math.cos(theta);
    }
    this.mesh = new THREE.Mesh(
      new THREE.BufferGeometry(),
      [VISTA_OVERLAP_MATERIAL, TERRAIN_MATERIAL],
    );
    this.mesh.renderOrder = -1;
    this.mesaMesh = new THREE.Mesh(new THREE.BufferGeometry(), MESA_MATERIAL);
    // Draw mesas before both vista bands. The colour-only inner vista can then cover
    // mesa fragments that are behind its ground without writing the overlap depth that
    // would prevent the finer player-centred tiles from replacing it.
    this.mesaMesh.renderOrder = -2;
    // Both meshes surround the camera and span the whole view; their bounding spheres
    // are no cheaper than drawing the already sparse geometry.
    this.mesh.frustumCulled = false;
    this.mesaMesh.frustumCulled = false;
    // Nothing this far away casts or receives a shadow the shadow map can resolve.
    for (const distant of [this.mesh, this.mesaMesh]) {
      distant.castShadow = false;
      distant.receiveShadow = false;
      distant.visible = false;
      scene.add(distant);
    }
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
        hintS: this.groundHintS,
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
    const base = new Float32Array(result.base);
    const vertexCount = this.radii.length * SECTORS;
    if (
      horizon.length === vertexCount
      && base.length === vertexCount
      && !this.groundSampleCache.has(pending.key)
      && this.groundLocalPositions !== null
    ) {
      this.groundSampleCache.set(
        pending.key,
        this.buildGroundSample(pending.cornerX, pending.cornerZ, horizon, base),
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
    this.mesaMesh.visible = false;
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
   * Stands the disc on the lattice point nearest the camera (`DISC_STEP`). Its expensive
   * terrain samples come from the four corners of that point's cell; the disc and the
   * mesas are rewritten only when the point, the cell or the fine tiles' window changes,
   * and are a function of the point alone, so between steps nothing moves. Ground and
   * mesa movement is spatial and reversible.
   */
  update(cameraX: number, cameraZ: number, s: number): void {
    if (this.outerRadius <= 0) return;
    this.ensureGroundGeometry();
    const stepX = Math.round(cameraX / DISC_STEP);
    const stepZ = Math.round(cameraZ / DISC_STEP);
    // The cell is the lattice point's, so the point's weights stay in [0, 1).
    const cellX = Math.floor(stepX / DISC_STEPS_PER_CELL);
    const cellZ = Math.floor(stepZ / DISC_STEPS_PER_CELL);
    const cellChanged =
      cellX !== this.sampleCellX || cellZ !== this.sampleCellZ || this.groundSamples === null;
    if (cellChanged) this.prepareRoadUnderlay(s);
    if (cellChanged) this.loadGroundCell(cellX, cellZ, s);

    // The road raise inside `ROAD_UNDERLAY_RADIUS` depends on the fine tiles' window
    // (`roadRaiseAt`), which moves at tile crossings, not with the lattice.
    const window = groundWindowRevision();
    if (!cellChanged && stepX === this.discStepX && stepZ === this.discStepZ && window === this.discWindow) return;
    this.discStepX = stepX;
    this.discStepZ = stepZ;
    this.discWindow = window;
    this.interpolationX = (stepX - cellX * DISC_STEPS_PER_CELL) / DISC_STEPS_PER_CELL;
    this.interpolationZ = (stepZ - cellZ * DISC_STEPS_PER_CELL) / DISC_STEPS_PER_CELL;
    const anchorX = stepX * DISC_STEP;
    const anchorZ = stepZ * DISC_STEP;
    this.updateGroundPositions(anchorX, anchorZ);
    this.updateMesaPositions(anchorX, anchorZ);
    if (cellChanged) this.refreshMesaNormals();
  }

  /** Writes the disc for the lattice point (`anchorX`, `anchorZ`); see `update`. */
  private updateGroundPositions(anchorX: number, anchorZ: number): void {
    if (!this.geometry || !this.groundSamples) return;
    const position = this.geometry.getAttribute('position') as THREE.BufferAttribute;
    const color = this.geometry.getAttribute('color') as THREE.BufferAttribute;
    const normal = this.geometry.getAttribute('normal') as THREE.BufferAttribute;
    const xyz = position.array as Float32Array;
    const rgb = color.array as Float32Array;
    const normals = normal.array as Float32Array;
    const [sample00, sample10, sample01, sample11] = this.groundSamples;
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
        const absX = anchorX + this.groundLocalPositions![vi]! + this.origin.x;
        const absZ = anchorZ + this.groundLocalPositions![vi + 2]! + this.origin.z;
        y = this.beneathRoad(absX, absZ, y, bias, roadRaiseAt(absX, absZ));
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
    for (let i = 0; i < rgb.length; i++) {
      const lower =
        sample00.colors[i]! + (sample10.colors[i]! - sample00.colors[i]!) * tx;
      const upper =
        sample01.colors[i]! + (sample11.colors[i]! - sample01.colors[i]!) * tx;
      rgb[i] = lower + (upper - lower) * tz;
    }
    this.mesh.position.set(anchorX, 0, anchorZ);
    position.needsUpdate = true;
    color.needsUpdate = true;
    normal.needsUpdate = true;
  }

  /**
   * Writes the mesas for the lattice point (`anchorX`, `anchorZ`): their ground, and
   * their spatial fades (buried at the edge of the resident set, onto exact ground near
   * the player), are measured from that point, not from the camera, so they too hold
   * still between steps.
   */
  private updateMesaPositions(anchorX: number, anchorZ: number): void {
    if (!this.mesaGeometry || !this.mesaGroundY || !this.mesaHeightOffset || !this.mesaExactY) return;
    const position = this.mesaGeometry.getAttribute('position') as THREE.BufferAttribute;
    const xyz = position.array as Float32Array;
    const [base00, base10, base01, base11] = this.mesaGroundY;
    const exact = this.mesaExactY;
    const offsets = this.mesaHeightOffset;
    const tx = this.interpolationX;
    const tz = this.interpolationZ;
    const outerFadeStart = Math.max(1, this.mesaVisibleOuter - MESA_OUTER_FADE);
    let anyVisible = false;
    for (const candidate of this.mesaCandidates) {
      const distance = Math.hypot(candidate.centreX - anchorX, candidate.centreZ - anchorZ);
      const farWeight =
        1 -
        smoothstep01(
          (distance - outerFadeStart) / Math.max(1, this.mesaVisibleOuter - outerFadeStart),
        );
      // `radius` is the footprint's farthest vertex, so this errs toward exact ground.
      const footWeight = candidate.footed
        ? 1 -
          smoothstep01(
            (distance - candidate.radius - MESA_FOOTING_FULL) /
              (MESA_FOOTING_REACH - MESA_FOOTING_FULL),
          )
        : 0;
      anyVisible ||= farWeight > 0.002;
      const end = candidate.firstVertex + candidate.vertexCount;
      for (let i = candidate.firstVertex; i < end; i++) {
        const lower = base00[i]! + (base10[i]! - base00[i]!) * tx;
        const upper = base01[i]! + (base11[i]! - base01[i]!) * tx;
        const base = lower + (upper - lower) * tz;
        let y = base + offsets[i]! * farWeight;
        if (footWeight > 0) {
          // The skirt and its curtain stay under BOTH grounds: whichever is lower is the
          // one drawn.
          const target = offsets[i]! <= -MESA_SKIRT_DROP ? Math.min(exact[i]!, y) : exact[i]!;
          y += (target - y) * footWeight;
        }
        xyz[i * 3 + 1] = y - (1 - farWeight) * MESA_BURY_DEPTH;
      }
    }
    this.mesaMesh.visible = anyVisible;
    position.needsUpdate = true;
  }

  /**
   * Flat face normals, then each quad's two triangles given their shared normal so a
   * ledge reads as one face. Written over the typed arrays: through `computeVertexNormals`
   * and `getX`/`setXYZ` this was 2 ms of every 250 m cell crossing for 18k vertices,
   * and it runs in the same frame as the mesa rebuild.
   */
  private refreshMesaNormals(): void {
    if (!this.mesaGeometry) return;
    const position = this.mesaGeometry.getAttribute('position') as THREE.BufferAttribute;
    const p = position.array as Float32Array;
    let normal = this.mesaGeometry.getAttribute('normal') as THREE.BufferAttribute | undefined;
    if (!normal || normal.count !== position.count) {
      normal = new THREE.BufferAttribute(new Float32Array(p.length), 3);
      this.mesaGeometry.setAttribute('normal', normal);
    }
    const n = normal.array as Float32Array;
    // Face normals, the arithmetic `computeVertexNormals` uses on a non-indexed buffer.
    for (let v = 0; v + 8 < p.length; v += 9) {
      const bx = p[v + 3]!;
      const by = p[v + 4]!;
      const bz = p[v + 5]!;
      const cbx = p[v + 6]! - bx;
      const cby = p[v + 7]! - by;
      const cbz = p[v + 8]! - bz;
      const abx = p[v]! - bx;
      const aby = p[v + 1]! - by;
      const abz = p[v + 2]! - bz;
      let nx = cby * abz - cbz * aby;
      let ny = cbz * abx - cbx * abz;
      let nz = cbx * aby - cby * abx;
      const length = Math.hypot(nx, ny, nz) || 1;
      nx /= length;
      ny /= length;
      nz /= length;
      for (let k = v; k < v + 9; k += 3) {
        n[k] = nx;
        n[k + 1] = ny;
        n[k + 2] = nz;
      }
    }
    for (let i = 0; i + 5 < position.count; i += 6) {
      const o = i * 3;
      const bx = p[o + 3]!;
      const by = p[o + 4]!;
      const bz = p[o + 5]!;
      const cx = p[o + 6]!;
      const cy = p[o + 7]!;
      const cz = p[o + 8]!;
      if (
        Math.abs(cx - p[o + 9]!) > 1e-4 ||
        Math.abs(cy - p[o + 10]!) > 1e-4 ||
        Math.abs(cz - p[o + 11]!) > 1e-4 ||
        Math.abs(bx - p[o + 12]!) > 1e-4 ||
        Math.abs(by - p[o + 13]!) > 1e-4 ||
        Math.abs(bz - p[o + 14]!) > 1e-4
      ) {
        continue;
      }

      const ax = p[o]!;
      const ay = p[o + 1]!;
      const az = p[o + 2]!;
      const dx = p[o + 15]!;
      const dy = p[o + 16]!;
      const dz = p[o + 17]!;
      const abx = bx - ax;
      const aby = by - ay;
      const abz = bz - az;
      const acx = cx - ax;
      const acy = cy - ay;
      const acz = cz - az;
      let nx1 = aby * acz - abz * acy;
      let ny1 = abz * acx - abx * acz;
      let nz1 = abx * acy - aby * acx;
      const cbx = bx - cx;
      const cby = by - cy;
      const cbz = bz - cz;
      const cdx = dx - cx;
      const cdy = dy - cy;
      const cdz = dz - cz;
      let nx2 = cby * cdz - cbz * cdy;
      let ny2 = cbz * cdx - cbx * cdz;
      let nz2 = cbx * cdy - cby * cdx;
      const length1 = Math.hypot(nx1, ny1, nz1) || 1;
      const length2 = Math.hypot(nx2, ny2, nz2) || 1;
      nx1 /= length1;
      ny1 /= length1;
      nz1 /= length1;
      nx2 /= length2;
      ny2 /= length2;
      nz2 /= length2;
      const nx = nx1 + nx2;
      const ny = ny1 + ny2;
      const nz = nz1 + nz2;
      const length = Math.hypot(nx, ny, nz) || 1;
      for (let k = o; k < o + 18; k += 3) {
        n[k] = nx / length;
        n[k + 1] = ny / length;
        n[k + 2] = nz / length;
      }
    }
    normal.needsUpdate = true;
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
  private beneathRoad(x: number, z: number, openY: number, bias: number, raise: number): number {
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
    const distance = Math.sqrt(closestDistanceSq);
    const fade = smoothstep01(
      (distance - ROAD_UNDERLAY_CORE) / (ROAD_UNDERLAY_FADE - ROAD_UNDERLAY_CORE),
    );
    if (belowRoad >= openY) {
      // The vista sits BELOW the road here. Past the tiles it is the only ground, so it
      // is raised to the road rather than leave the ribbon hanging in the air — but
      // only once the fine tiles have ended, or it would poke up through them.
      return openY + (belowRoad - openY) * raise * (1 - fade);
    }
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

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(positions.length), 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(positions.length), 3));
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
    let overlapPairs = 0;
    while (
      overlapPairs < rings - 1 &&
      this.radii[overlapPairs]! < NON_OCCLUDING_RADIUS
    ) {
      overlapPairs++;
    }
    const overlapIndexCount = overlapPairs * SECTORS * 6;
    geometry.addGroup(0, overlapIndexCount, 0);
    geometry.addGroup(overlapIndexCount, index.length - overlapIndexCount, 1);
    this.geometry?.dispose();
    this.geometry = geometry;
    this.groundLocalPositions = positions;
    this.mesh.geometry = geometry;
    // A new disc invalidates the worker's layout, every queued corner and anything
    // still in flight: they were all sized for the previous ring count.
    this.layoutId++;
    this.pendingRequest = null;
    this.prefetchQueue.length = 0;
    this.publishLayout();
  }

  private loadGroundCell(cellX: number, cellZ: number, s: number): void {
    const x0 = cellX * SAMPLE_CELL_SIZE;
    this.groundHintS = s;
    const z0 = cellZ * SAMPLE_CELL_SIZE;
    const palette = desertPaletteAt(s);
    sandLinear.setHex(palette.sand);
    rockLinear.setHex(palette.rock).lerp(sandLinear, 0.45);
    mesaLinear.setHex(palette.rock).lerp(sandLinear, 0.2);

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
    this.buildMesas(
      x0 + SAMPLE_CELL_SIZE * 0.5,
      z0 + SAMPLE_CELL_SIZE * 0.5,
      this.groundLocalPositions,
      samples,
      x0,
      z0,
    );

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
      this.baseScratch = new Float32Array(vertexCount);
    }
    const horizon = this.horizonScratch;
    const base = this.baseScratch!;
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
        horizon[i] = this.terrain.horizonHeight(absoluteX, absoluteZ, reliefWeight, this.groundHintS);
        base[i] = this.terrain.baseHeight(absoluteX, absoluteZ, radius);
      }
    }
    const sample = this.buildGroundSample(cx, cz, horizon, base);
    this.groundSampleCache.set(key, sample);
    return sample;
  }

  /**
   * Shapes raw terrain field values into a renderable sample: the overlap bias, the
   * road underlay, the rock/sand tint and the smooth normals. Deliberately shared by
   * the synchronous and worker paths so both produce identical geometry.
   */
  private buildGroundSample(
    cx: number,
    cz: number,
    horizon: Float32Array,
    base: Float32Array,
  ): GroundSample {
    invariantLocalPositions(this.groundLocalPositions);
    const vertexCount = this.radii.length * SECTORS;
    const heights = new Float32Array(vertexCount);
    const colors = new Float32Array(vertexCount * 3);
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
        const rockWeight = smoothstep01((horizonY - base[i]!) / ROCK_ALTITUDE);
        if (radius <= ROAD_UNDERLAY_RADIUS) {
          const absoluteX = cx + this.groundLocalPositions[vi]! + ox;
          const absoluteZ = cz + this.groundLocalPositions[vi + 2]! + oz;
          heights[i] = this.beneathRoad(absoluteX, absoluteZ, horizonY - bias, bias, 0);
        } else {
          heights[i] = horizonY - bias;
        }
        colors[vi] = sandLinear.r + (rockLinear.r - sandLinear.r) * rockWeight;
        colors[vi + 1] = sandLinear.g + (rockLinear.g - sandLinear.g) * rockWeight;
        colors[vi + 2] = sandLinear.b + (rockLinear.b - sandLinear.b) * rockWeight;
      }
    }
    return { heights, colors, normals: this.groundNormalsFor(heights) };
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

  /**
   * Smooth normals of the disc at these heights: the area-weighted face normals summed
   * per vertex and normalised, the same arithmetic as `computeVertexNormals`, written
   * over the typed arrays directly.
   *
   * It runs on the main thread once per sampled cell corner — every worker result and
   * every synchronous fallback — and through a scratch `BufferGeometry` it cost 4 ms of
   * a frame for the 14.5k-vertex disc, almost all of it `Vector3` traffic: measured in
   * a browser trace as nine tenths of accepting a worker result, which lands several
   * times per 250 m cell crossing.
   */
  private groundNormalsFor(heights: Float32Array): Float32Array {
    invariantLocalPositions(this.groundLocalPositions);
    if (!this.geometry) throw new Error('vista ground geometry is not initialized');
    const local = this.groundLocalPositions;
    const index = this.geometry.getIndex()!.array;
    const normals = new Float32Array(local.length);
    for (let t = 0; t < index.length; t += 3) {
      const a = index[t]!;
      const b = index[t + 1]!;
      const c = index[t + 2]!;
      const bx = local[b * 3]!;
      const by = heights[b]!;
      const bz = local[b * 3 + 2]!;
      const cbx = local[c * 3]! - bx;
      const cby = heights[c]! - by;
      const cbz = local[c * 3 + 2]! - bz;
      const abx = local[a * 3]! - bx;
      const aby = heights[a]! - by;
      const abz = local[a * 3 + 2]! - bz;
      const nx = cby * abz - cbz * aby;
      const ny = cbz * abx - cbx * abz;
      const nz = cbx * aby - cby * abx;
      normals[a * 3] += nx;
      normals[a * 3 + 1] += ny;
      normals[a * 3 + 2] += nz;
      normals[b * 3] += nx;
      normals[b * 3 + 1] += ny;
      normals[b * 3 + 2] += nz;
      normals[c * 3] += nx;
      normals[c * 3 + 1] += ny;
      normals[c * 3 + 2] += nz;
    }
    for (let v = 0; v < normals.length; v += 3) {
      const length = Math.hypot(normals[v]!, normals[v + 1]!, normals[v + 2]!) || 1;
      normals[v] = normals[v]! / length;
      normals[v + 1] = normals[v + 1]! / length;
      normals[v + 2] = normals[v + 2]! / length;
    }
    return normals;
  }

  /**
   * Rebuilds the resident mesas (`world/mesas.ts`) for the current interpolation cell.
   * The residency margin keeps candidates below ground before they can enter view.
   */
  private buildMesas(
    cx: number,
    cz: number,
    groundPositions: Float32Array,
    groundSamples: GroundCellSamples,
    groundX0: number,
    groundZ0: number,
  ): void {
    const visibleOuter = Math.min(MESA_MAX_DISTANCE, this.outerRadius - MESA_MAX_RADIUS);
    const residentOuter = Math.min(
      MESA_MAX_DISTANCE + MESA_RESIDENCY_MARGIN,
      this.outerRadius - MESA_MAX_RADIUS,
    );
    this.mesaVisibleOuter = visibleOuter;
    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    const baseGroundY: [number[], number[], number[], number[]] = [[], [], [], []];
    const heightOffsets: number[] = [];
    const centres: number[] = [];
    const exacts: number[] = [];
    const candidates: MesaCandidate[] = [];
    if (residentOuter > 0) {
      const cameraX = cx + this.origin.x;
      const cameraZ = cz + this.origin.z;
      const minCellX = Math.floor((cameraX - residentOuter) / MESA_CELL_SIZE);
      const maxCellX = Math.floor((cameraX + residentOuter) / MESA_CELL_SIZE);
      const minCellZ = Math.floor((cameraZ - residentOuter) / MESA_CELL_SIZE);
      const maxCellZ = Math.floor((cameraZ + residentOuter) / MESA_CELL_SIZE);

      for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
        for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ++) {
          const site = this.mesas.site(cellX, cellZ);
          if (site === null) continue;
          const x = site.x - this.origin.x;
          const z = site.z - this.origin.z;
          if (Math.hypot(x - cx, z - cz) >= residentOuter) continue;
          const firstVertex = indices.length;
          const footed = footprintDistance(site, cameraX, cameraZ) < MESA_FOOTED_AT;
          this.appendMesa(
            positions,
            colors,
            indices,
            baseGroundY,
            heightOffsets,
            centres,
            exacts,
            groundPositions,
            groundSamples,
            groundX0,
            groundZ0,
            site,
            x,
            z,
            footed,
          );
          candidates.push({
            footed,
            key: site.key,
            firstVertex,
            vertexCount: indices.length - firstVertex,
            centreX: x,
            centreZ: z,
            radius: site.footprintRadius,
          });
        }
      }
    }

    const indexed = new THREE.BufferGeometry();
    indexed.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    indexed.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    indexed.setAttribute('_base00', new THREE.Float32BufferAttribute(baseGroundY[0], 1));
    indexed.setAttribute('_base10', new THREE.Float32BufferAttribute(baseGroundY[1], 1));
    indexed.setAttribute('_base01', new THREE.Float32BufferAttribute(baseGroundY[2], 1));
    indexed.setAttribute('_base11', new THREE.Float32BufferAttribute(baseGroundY[3], 1));
    indexed.setAttribute('_heightOffset', new THREE.Float32BufferAttribute(heightOffsets, 1));
    indexed.setAttribute('_centreXZ', new THREE.Float32BufferAttribute(centres, 2));
    indexed.setAttribute('_exactY', new THREE.Float32BufferAttribute(exacts, 1));
    indexed.setIndex(indices);
    // Separate triangle normals keep the sedimentary ledges and faceted walls legible.
    const geometry = indexed.toNonIndexed();
    indexed.dispose();
    this.mesaGroundY = [
      (geometry.getAttribute('_base00') as THREE.BufferAttribute).array as Float32Array,
      (geometry.getAttribute('_base10') as THREE.BufferAttribute).array as Float32Array,
      (geometry.getAttribute('_base01') as THREE.BufferAttribute).array as Float32Array,
      (geometry.getAttribute('_base11') as THREE.BufferAttribute).array as Float32Array,
    ];
    this.mesaHeightOffset = (geometry.getAttribute('_heightOffset') as THREE.BufferAttribute)
      .array as Float32Array;
    this.mesaCentreXZ = (geometry.getAttribute('_centreXZ') as THREE.BufferAttribute)
      .array as Float32Array;
    this.mesaExactY = (geometry.getAttribute('_exactY') as THREE.BufferAttribute)
      .array as Float32Array;
    geometry.deleteAttribute('_base00');
    geometry.deleteAttribute('_base10');
    geometry.deleteAttribute('_base01');
    geometry.deleteAttribute('_base11');
    geometry.deleteAttribute('_heightOffset');
    geometry.deleteAttribute('_centreXZ');
    geometry.deleteAttribute('_exactY');
    (geometry.getAttribute('position') as THREE.BufferAttribute).setUsage(THREE.DynamicDrawUsage);
    this.mesaGeometry?.dispose();
    this.mesaGeometry = geometry;
    this.mesaMesh.geometry = geometry;
    this.mesaCandidates = candidates;
    this.mesaMesh.visible = positions.length > 0;
  }

  /**
   * One mesa's rings and plateau, from the shared outline. Every vertex stands on the
   * vista's own interpolated ground (the skirt and wall foot on the ground under them,
   * the upper rings on the ground at the centre), so a distant mesa meets the triangles
   * actually drawn around it. A `footed` mesa also carries every vertex's exact-ground
   * height, which it stands on up close (`MESA_FOOTING_FULL`). Under the skirt hangs the
   * curtain (`MESA_CURTAIN_DEPTH`): one more row of vertices, the skirt's own, lowered.
   */
  private appendMesa(
    positions: number[],
    colors: number[],
    indices: number[],
    baseGroundY: [number[], number[], number[], number[]],
    heightOffsets: number[],
    centres: number[],
    exacts: number[],
    groundPositions: Float32Array,
    groundSamples: GroundCellSamples,
    groundX0: number,
    groundZ0: number,
    site: MesaSite,
    x: number,
    z: number,
    footed: boolean,
  ): void {
    const groundAt = (sampleIndex: number, px: number, pz: number): number => {
      const sampleX = groundX0 + (sampleIndex % 2) * SAMPLE_CELL_SIZE;
      const sampleZ = groundZ0 + Math.floor(sampleIndex / 2) * SAMPLE_CELL_SIZE;
      return renderedGroundHeightAt(
        px - sampleX,
        pz - sampleZ,
        0,
        0,
        this.radii,
        groundPositions,
        groundSamples[sampleIndex]!.heights,
      );
    };
    const centreGround: [number, number, number, number] = [
      groundAt(0, x, z),
      groundAt(1, x, z),
      groundAt(2, x, z),
      groundAt(3, x, z),
    ];
    const footing = footed ? this.mesas.footing(site) : null;
    const seed = this.road.seed;
    const segments = site.segments;
    const firstVertex = positions.length / 3;
    // Row 0 is the curtain under the skirt; row r > 0 is ring r - 1. The skirt row stands
    // on the curtain's ground, sampled once.
    const rows = MESA_RINGS.length + 1;
    const skirtGrounds: [number, number, number, number][] = [];
    for (let row = 0; row < rows; row++) {
      const ring = Math.max(0, row - 1);
      const level = MESA_RINGS[ring]!;
      for (let segment = 0; segment < segments; segment++) {
        const px = x + site.outlineX[segment]! * level.radius;
        const pz = z + site.outlineZ[segment]! * level.radius;
        let grounds = centreGround;
        if (row === 0) {
          grounds = [groundAt(0, px, pz), groundAt(1, px, pz), groundAt(2, px, pz), groundAt(3, px, pz)];
          skirtGrounds.push(grounds);
        } else if (ring === 0) {
          grounds = skirtGrounds[segment]!;
        } else if (ring === 1) {
          grounds = [groundAt(0, px, pz), groundAt(1, px, pz), groundAt(2, px, pz), groundAt(3, px, pz)];
        }
        const heightOffset = row === 0
          ? -MESA_SKIRT_DROP - MESA_CURTAIN_DEPTH
          : ring === 0 ? -MESA_SKIRT_DROP : site.height * level.height;
        const shade = mesaFacetShade(seed, site, ring, segment);
        positions.push(px, grounds[0] + heightOffset, pz);
        colors.push(
          Math.min(1, mesaLinear.r * shade),
          Math.min(1, mesaLinear.g * shade),
          Math.min(1, mesaLinear.b * shade),
        );
        for (let sample = 0; sample < 4; sample++) {
          baseGroundY[sample]!.push(grounds[sample]!);
        }
        heightOffsets.push(heightOffset);
        centres.push(x, z);
        const exact = footing ? mesaFootingY(site, footing, ring, segment) : NaN;
        exacts.push(row === 0 ? exact - MESA_CURTAIN_DEPTH : exact);
      }
    }

    for (let row = 0; row < rows - 1; row++) {
      const current = firstVertex + row * segments;
      const next = current + segments;
      for (let segment = 0; segment < segments; segment++) {
        const b = (segment + 1) % segments;
        indices.push(
          current + segment,
          next + segment,
          current + b,
          current + b,
          next + segment,
          next + b,
        );
      }
    }
    const top = firstVertex + (rows - 1) * segments;
    const centre = positions.length / 3;
    const topOffset = site.height * MESA_TOP_HEIGHT;
    positions.push(x, centreGround[0] + topOffset, z);
    colors.push(mesaLinear.r, mesaLinear.g, mesaLinear.b);
    for (let sample = 0; sample < 4; sample++) {
      baseGroundY[sample]!.push(centreGround[sample]!);
    }
    heightOffsets.push(topOffset);
    centres.push(x, z);
    exacts.push(footing ? footing.centreGroundY + topOffset : NaN);
    for (let segment = 0; segment < segments; segment++) {
      indices.push(centre, top + ((segment + 1) % segments), top + segment);
    }
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
    this.scene.remove(this.mesaMesh);
    this.geometry?.dispose();
    this.mesaGeometry?.dispose();
    this.geometry = null;
    this.mesaGeometry = null;
    this.groundLocalPositions = null;
    this.groundSamples = null;
    this.groundSampleCache.clear();
    this.mesaGroundY = null;
    this.mesaHeightOffset = null;
    this.mesaCentreXZ = null;
    this.mesaExactY = null;
    this.mesaCandidates = [];
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
