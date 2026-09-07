import * as THREE from 'three';
import { farPlaneForViewDistance } from '../core/renderer';
import { hashUnit3 } from '../core/rng';
import { applyComicShading } from './comic';

import { desertPaletteAt } from '../world/gradient';
import type { WorldOrigin } from '../world/origin';
import type { Road } from '../world/road';
import type { Terrain } from '../world/terrain';
import { TERRAIN_MATERIAL } from '../world/terrainmesh';

/**
 * The fine, player-centred desert tiles own the ground around the camera. This polar
 * mesh begins inside their outer edge and carries only the distant view. A second,
 * much smaller mesh places sparse sedimentary mesas through the middle distance.
 *
 * Mountains rise with distance. Mesas keep a stable world position and full height
 * through the middle distance, then slide continuously below the rendered ground only
 * inside the streamed-terrain overlap and at the residency edge. The horizon is a
 * spatial interpolation of fixed world samples, never a timed animation.
 */

/** The fine streamed tiles own the central 400 metres; the vista starts in their overlap. */
const INNER_RADIUS = 400;
/**
 * Radial spacing growth, and the cap it grows into.
 *
 * Geometric alone puts a 3.2 km gap at the outer edge of a 25 km disc, and the mountain
 * field's shorter band is 6.5 km, so a range arrives as two facets and reads as a folded
 * sheet — the same failure the near mesh's ring caps exist to prevent, at fifty times the
 * scale. The cap was 1200 m first and a 1400 m range at 12 km still drew as a slab with a
 * flat top; 900 puts a dozen rings across a range instead of eight.
 */
const RADIAL_RATIO = 1.13;
const MAX_RING_SPACING = 900;
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
 * Vertices per ring. At 25 km this is a 980 m arc, which matches the radial cap, so the
 * triangles stay roughly isotropic where the detail is. Close in it is finer than it needs
 * to be and that costs nothing worth measuring.
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
 * Altitude, in metres above the ring's own base, over which distant ground reads as rock
 * rather than sand.
 *
 * Mountains are not made of dune sand and painting them as though they were makes a
 * kilometre-tall range look like a heap of it. The tint is by height alone: cheap, and at
 * this distance nobody can tell it from a real material boundary.
 */
const ROCK_ALTITUDE = 260;

/**
 * Sparse middle-distance landmarks. Candidate positions and full heights are absolute
 * world properties. A mesa starts dissolving once the camera comes within 500 metres
 * of its footprint; that transition is irreversible for the rest of the session.
 * The outer burial band remains only to prevent residency-edge popping.
 */
const MESA_CELL_SIZE = 2200;
const MESA_OCCUPANCY = 0.18;
/** Clear ground kept between the camera and a mesa when its dissolve begins. */
const MESA_DISSOLVE_CLEARANCE = 500;
/** A slow, conspicuous disappearance that still begins with 500 metres of clearance. */
const MESA_DISSOLVE_SECONDS = 18;
const MESA_MAX_DISTANCE = 18_000;
const MESA_OUTER_FADE = 2000;
const MESA_RESIDENCY_MARGIN = SAMPLE_CELL_SIZE * 2;
const MESA_BURY_DEPTH = 12;
const MESA_MAX_RADIUS = 800;
const MESA_MIN_RADIUS = 220;
const MESA_MIN_HEIGHT = 180;
const MESA_MAX_HEIGHT = 900;
const MESA_TAG = 0x4d455341;
const MESA_RINGS = [
  { radius: 1.14, height: 0 },
  { radius: 1.0, height: 0.12 },
  { radius: 0.82, height: 0.55 },
  { radius: 0.68, height: 0.58 },
  { radius: 0.56, height: 0.84 },
  { radius: 0.45, height: 0.88 },
  { radius: 0.39, height: 1 },
] as const;

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
  readonly key: string;
  readonly firstVertex: number;
  readonly vertexCount: number;
  readonly centreX: number;
  readonly centreZ: number;
  readonly radius: number;
};

/** Palette scratch colours, set once per interpolation-cell load. */
const sandLinear = new THREE.Color();
const rockLinear = new THREE.Color();
const mesaLinear = new THREE.Color();
/**
 * Mesas need physical light and fog, but not the terrain shader's elevation contours:
 * on a sheer wall those screen-space lines read as printed cardboard. Polygon offset
 * resolves the last sub-pixel contact at the buried skirt without changing occlusion.
 */
const MESA_MATERIAL = applyComicShading(
  new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.98,
    metalness: 0,
    alphaHash: true,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  }),
  {
    lightingStrength: 0.18,
    shadowWarmth: 0.35,
    reliefShadeStrength: 0.12,
    contourStrength: 0,
    stippleStrength: 0,
  },
);

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
  private readonly mesh: THREE.Mesh;
  private readonly mesaMesh: THREE.Mesh;
  private geometry: THREE.BufferGeometry | null = null;
  private mesaGeometry: THREE.BufferGeometry | null = null;
  private groundLocalPositions: Float32Array | null = null;
  private groundSamples: GroundCellSamples | null = null;
  private readonly groundSampleCache = new Map<string, GroundSample>();
  private sampleCellX = Number.NaN;
  private sampleCellZ = Number.NaN;
  private interpolationX = 0;
  private interpolationZ = 0;

  /** CPU-only mesa animation data; none of these buffers are uploaded as attributes. */
  private mesaGroundY: GroundHeightSamples | null = null;
  private mesaHeightOffset: Float32Array | null = null;
  private mesaCentreXZ: Float32Array | null = null;
  private mesaCandidates: MesaCandidate[] = [];
  private readonly dissolvingMesas = new Map<string, number>();
  private readonly retiredMesas = new Set<string>();
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
    for (let a = 0; a < SECTORS; a++) {
      const theta = (a / SECTORS) * Math.PI * 2;
      this.dirX[a] = Math.sin(theta);
      this.dirZ[a] = Math.cos(theta);
    }
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), TERRAIN_MATERIAL);
    this.mesaMesh = new THREE.Mesh(new THREE.BufferGeometry(), MESA_MATERIAL);
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
  }

  /**
   * The polar disc follows the camera continuously. Its expensive terrain samples
   * come from the four corners of the current cell; only the cheap interpolation runs
   * every frame. Ground movement is spatial and reversible; a triggered mesa dissolve
   * deliberately is not.
   */
  update(cameraX: number, cameraZ: number, s: number, frameDt: number): void {
    this.advanceMesaDissolves(frameDt);
    if (this.outerRadius <= 0) return;
    this.ensureGroundGeometry();
    const cellX = Math.floor(cameraX / SAMPLE_CELL_SIZE);
    const cellZ = Math.floor(cameraZ / SAMPLE_CELL_SIZE);
    const cellChanged =
      cellX !== this.sampleCellX || cellZ !== this.sampleCellZ || this.groundSamples === null;
    if (cellChanged) this.prepareRoadUnderlay(s);
    if (cellChanged) this.loadGroundCell(cellX, cellZ, s);

    this.interpolationX = Math.max(
      0,
      Math.min(1, (cameraX - cellX * SAMPLE_CELL_SIZE) / SAMPLE_CELL_SIZE),
    );
    this.interpolationZ = Math.max(
      0,
      Math.min(1, (cameraZ - cellZ * SAMPLE_CELL_SIZE) / SAMPLE_CELL_SIZE),
    );
    this.updateGroundPositions(cameraX, cameraZ);
    this.updateMesaPositions(cameraX, cameraZ);
    if (cellChanged) this.refreshMesaNormals();
  }

  private advanceMesaDissolves(frameDt: number): void {
    const elapsed = Math.max(0, frameDt);
    if (elapsed === 0) return;
    for (const [key, remaining] of this.dissolvingMesas) {
      const next = remaining - elapsed;
      if (next > 0) {
        this.dissolvingMesas.set(key, next);
        continue;
      }
      this.dissolvingMesas.delete(key);
      this.retiredMesas.add(key);
    }
  }

  private updateGroundPositions(cameraX: number, cameraZ: number): void {
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
      const normalLength = Math.hypot(nx, ny, nz) || 1;
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
    this.mesh.position.set(cameraX, 0, cameraZ);
    position.needsUpdate = true;
    color.needsUpdate = true;
    normal.needsUpdate = true;
  }

  private updateMesaPositions(cameraX: number, cameraZ: number): void {
    if (!this.mesaGeometry || !this.mesaGroundY || !this.mesaHeightOffset) return;
    const position = this.mesaGeometry.getAttribute('position') as THREE.BufferAttribute;
    const color = this.mesaGeometry.getAttribute('color') as THREE.BufferAttribute;
    const xyz = position.array as Float32Array;
    const rgba = color.array as Float32Array;
    const [base00, base10, base01, base11] = this.mesaGroundY;
    const tx = this.interpolationX;
    const tz = this.interpolationZ;
    const outerFadeStart = Math.max(1, this.mesaVisibleOuter - MESA_OUTER_FADE);
    let anyVisible = false;
    for (const candidate of this.mesaCandidates) {
      const distance = Math.hypot(candidate.centreX - cameraX, candidate.centreZ - cameraZ);
      const clearance = distance - candidate.radius;
      let remaining = this.dissolvingMesas.get(candidate.key);
      if (
        remaining === undefined &&
        !this.retiredMesas.has(candidate.key) &&
        clearance <= MESA_DISSOLVE_CLEARANCE
      ) {
        if (clearance <= 0) {
          this.retiredMesas.add(candidate.key);
          remaining = 0;
        } else {
          remaining = MESA_DISSOLVE_SECONDS;
          this.dissolvingMesas.set(candidate.key, remaining);
        }
      }
      const dissolveWeight = this.retiredMesas.has(candidate.key)
        ? 0
        : remaining === undefined
          ? 1
          : smoothstep01(remaining / MESA_DISSOLVE_SECONDS);
      const farWeight =
        1 -
        smoothstep01(
          (distance - outerFadeStart) / Math.max(1, this.mesaVisibleOuter - outerFadeStart),
        );
      anyVisible ||= dissolveWeight > 0.002 && farWeight > 0.002;
      const end = candidate.firstVertex + candidate.vertexCount;
      for (let i = candidate.firstVertex; i < end; i++) {
        const lower = base00[i]! + (base10[i]! - base00[i]!) * tx;
        const upper = base01[i]! + (base11[i]! - base01[i]!) * tx;
        const base = lower + (upper - lower) * tz;
        xyz[i * 3 + 1] =
          base + this.mesaHeightOffset[i]! * farWeight - (1 - farWeight) * MESA_BURY_DEPTH;
        rgba[i * 4 + 3] = dissolveWeight;
      }
    }
    this.mesaMesh.visible = anyVisible;
    position.needsUpdate = true;
    color.needsUpdate = true;
  }
  private refreshMesaNormals(): void {
    if (!this.mesaGeometry) return;
    this.mesaGeometry.computeVertexNormals();
    const position = this.mesaGeometry.getAttribute('position') as THREE.BufferAttribute;
    const normal = this.mesaGeometry.getAttribute('normal') as THREE.BufferAttribute;
    for (let i = 0; i + 5 < position.count; i += 6) {
      const bx = position.getX(i + 1);
      const by = position.getY(i + 1);
      const bz = position.getZ(i + 1);
      const cx = position.getX(i + 2);
      const cy = position.getY(i + 2);
      const cz = position.getZ(i + 2);
      if (
        Math.abs(cx - position.getX(i + 3)) > 1e-4 ||
        Math.abs(cy - position.getY(i + 3)) > 1e-4 ||
        Math.abs(cz - position.getZ(i + 3)) > 1e-4 ||
        Math.abs(bx - position.getX(i + 4)) > 1e-4 ||
        Math.abs(by - position.getY(i + 4)) > 1e-4 ||
        Math.abs(bz - position.getZ(i + 4)) > 1e-4
      ) {
        continue;
      }

      const ax = position.getX(i);
      const ay = position.getY(i);
      const az = position.getZ(i);
      const dx = position.getX(i + 5);
      const dy = position.getY(i + 5);
      const dz = position.getZ(i + 5);
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
      for (let vertex = i; vertex < i + 6; vertex++) {
        normal.setXYZ(vertex, nx / length, ny / length, nz / length);
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

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(positions.length), 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(positions.length), 3));
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
    this.geometry?.dispose();
    this.geometry = geometry;
    this.groundLocalPositions = positions;
    this.mesh.geometry = geometry;
  }

  private loadGroundCell(cellX: number, cellZ: number, s: number): void {
    const x0 = cellX * SAMPLE_CELL_SIZE;
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

    while (this.groundSampleCache.size > 12) {
      const oldest = this.groundSampleCache.keys().next().value;
      if (oldest === undefined) break;
      this.groundSampleCache.delete(oldest);
    }
  }

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
    const heights = new Float32Array(vertexCount);
    const colors = new Float32Array(vertexCount * 3);
    const ox = this.origin.x;
    const oz = this.origin.z;
    for (let r = 0; r < this.radii.length; r++) {
      const radius = this.radii[r]!;
      const bias =
        INNER_BIAS *
        (1 - smoothstep01((radius - INNER_RADIUS) / (BIAS_FADE - INNER_RADIUS)));
      const reliefWeight =
        1 - smoothstep01((radius - RELIEF_FADE_START) / (RELIEF_FADE_END - RELIEF_FADE_START));
      for (let a = 0; a < SECTORS; a++) {
        const i = r * SECTORS + a;
        const vi = i * 3;
        const absoluteX = cx + this.groundLocalPositions[vi]! + ox;
        const absoluteZ = cz + this.groundLocalPositions[vi + 2]! + oz;
        const horizonY = this.terrain.horizonHeight(absoluteX, absoluteZ, radius, reliefWeight);
        const rockWeight = smoothstep01(
          (horizonY - this.terrain.baseHeight(absoluteX, absoluteZ, radius)) / ROCK_ALTITUDE,
        );
        heights[i] =
          radius <= ROAD_UNDERLAY_RADIUS
            ? this.beneathRoad(absoluteX, absoluteZ, horizonY - bias, bias)
            : horizonY - bias;
        colors[vi] = sandLinear.r + (rockLinear.r - sandLinear.r) * rockWeight;
        colors[vi + 1] = sandLinear.g + (rockLinear.g - sandLinear.g) * rockWeight;
        colors[vi + 2] = sandLinear.b + (rockLinear.b - sandLinear.b) * rockWeight;
      }
    }
    const sample = { heights, colors, normals: this.groundNormalsFor(heights) };
    this.groundSampleCache.set(key, sample);
    return sample;
  }

  private groundNormalsFor(heights: Float32Array): Float32Array {
    invariantLocalPositions(this.groundLocalPositions);
    if (!this.geometry) throw new Error('vista ground geometry is not initialized');
    const samplePositions = this.groundLocalPositions.slice();
    for (let i = 0; i < heights.length; i++) samplePositions[i * 3 + 1] = heights[i]!;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(samplePositions, 3));
    geometry.setIndex(this.geometry.getIndex());
    geometry.computeVertexNormals();
    const normal = geometry.getAttribute('normal') as THREE.BufferAttribute;
    const normals = new Float32Array(normal.array as Float32Array);
    geometry.dispose();
    return normals;
  }

  /**
   * Rebuilds a stable set of world-space buttes for the current interpolation cell.
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
          if (hashUnit3(this.road.seed ^ MESA_TAG, cellX, cellZ) >= MESA_OCCUPANCY) continue;
          const key = `${cellX},${cellZ}`;
          if (this.retiredMesas.has(key)) continue;
          const worldX =
            (cellX + 0.18 + hashUnit3(this.road.seed ^ (MESA_TAG + 1), cellX, cellZ) * 0.64) *
            MESA_CELL_SIZE;
          const worldZ =
            (cellZ + 0.18 + hashUnit3(this.road.seed ^ (MESA_TAG + 2), cellX, cellZ) * 0.64) *
            MESA_CELL_SIZE;
          const x = worldX - this.origin.x;
          const z = worldZ - this.origin.z;
          if (Math.hypot(x - cx, z - cz) >= residentOuter) continue;

          const widthT = hashUnit3(this.road.seed ^ (MESA_TAG + 3), cellX, cellZ);
          const depthT = hashUnit3(this.road.seed ^ (MESA_TAG + 4), cellX, cellZ);
          const heightT = hashUnit3(this.road.seed ^ (MESA_TAG + 5), cellX, cellZ);
          const silhouetteT = hashUnit3(this.road.seed ^ (MESA_TAG + 8), cellX, cellZ);
          let radius: number;
          let radiusZ: number;
          let height: number;
          if (silhouetteT < 0.15) {
            // Retain a few dramatic spires, but make them the exception.
            radius = MESA_MIN_RADIUS + widthT * 110;
            radiusZ = radius * (0.65 + depthT * 0.25);
            height = 650 + heightT * (MESA_MAX_HEIGHT - 650);
          } else if (silhouetteT < 0.8) {
            // Most landmarks are the broader, medium-height formations seen in deserts.
            radius = 450 + widthT * (MESA_MAX_RADIUS - 450);
            radiusZ = radius * (0.8 + depthT * 0.3);
            height = MESA_MIN_HEIGHT + heightT * (600 - MESA_MIN_HEIGHT);
          } else {
            // The remainder bridge both families instead of repeating one silhouette.
            radius = 320 + widthT * 330;
            radiusZ = radius * (0.7 + depthT * 0.35);
            height = 300 + heightT * 450;
          }
          const rotation =
            hashUnit3(this.road.seed ^ (MESA_TAG + 6), cellX, cellZ) * Math.PI;
          const segments =
            9 + Math.floor(hashUnit3(this.road.seed ^ (MESA_TAG + 7), cellX, cellZ) * 5);
          const firstVertex = indices.length;
          const footprintRadius = this.appendMesa(
            positions,
            colors,
            indices,
            baseGroundY,
            heightOffsets,
            centres,
            groundPositions,
            groundSamples,
            groundX0,
            groundZ0,
            x,
            z,
            radius,
            radiusZ,
            height,
            rotation,
            segments,
            cellX,
            cellZ,
          );
          candidates.push({
            key,
            firstVertex,
            vertexCount: indices.length - firstVertex,
            centreX: x,
            centreZ: z,
            radius: footprintRadius,
          });
        }
      }
    }

    const indexed = new THREE.BufferGeometry();
    indexed.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    indexed.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4));
    indexed.setAttribute('_base00', new THREE.Float32BufferAttribute(baseGroundY[0], 1));
    indexed.setAttribute('_base10', new THREE.Float32BufferAttribute(baseGroundY[1], 1));
    indexed.setAttribute('_base01', new THREE.Float32BufferAttribute(baseGroundY[2], 1));
    indexed.setAttribute('_base11', new THREE.Float32BufferAttribute(baseGroundY[3], 1));
    indexed.setAttribute('_heightOffset', new THREE.Float32BufferAttribute(heightOffsets, 1));
    indexed.setAttribute('_centreXZ', new THREE.Float32BufferAttribute(centres, 2));
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
    geometry.deleteAttribute('_base00');
    geometry.deleteAttribute('_base10');
    geometry.deleteAttribute('_base01');
    geometry.deleteAttribute('_base11');
    geometry.deleteAttribute('_heightOffset');
    geometry.deleteAttribute('_centreXZ');
    (geometry.getAttribute('color') as THREE.BufferAttribute).setUsage(THREE.DynamicDrawUsage);
    this.mesaGeometry?.dispose();
    this.mesaGeometry = geometry;
    this.mesaMesh.geometry = geometry;
    this.mesaCandidates = candidates;
    this.mesaMesh.visible = positions.length > 0;
  }

  private appendMesa(
    positions: number[],
    colors: number[],
    indices: number[],
    baseGroundY: [number[], number[], number[], number[]],
    heightOffsets: number[],
    centres: number[],
    groundPositions: Float32Array,
    groundSamples: GroundCellSamples,
    groundX0: number,
    groundZ0: number,
    x: number,
    z: number,
    radiusX: number,
    radiusZ: number,
    height: number,
    rotation: number,
    segments: number,
    cellX: number,
    cellZ: number,
  ): number {
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
    const firstVertex = positions.length / 3;
    let footprintRadius = 0;
    for (let ring = 0; ring < MESA_RINGS.length; ring++) {
      const level = MESA_RINGS[ring]!;
      for (let segment = 0; segment < segments; segment++) {
        const theta = rotation + (segment / segments) * Math.PI * 2;
        // One outline per angular segment, shared by every height ring. Independent
        // ring noise twists one nominal wall quad into two visibly different triangles.
        const irregularity =
          0.86 +
          hashUnit3(this.road.seed ^ (MESA_TAG + 20 + segment), cellX, cellZ) * 0.24;
        const px = x + Math.cos(theta) * radiusX * level.radius * irregularity;
        const pz = z + Math.sin(theta) * radiusZ * level.radius * irregularity;
        footprintRadius = Math.max(footprintRadius, Math.hypot(px - x, pz - z));
        const followsLocalGround = ring <= 1;
        const grounds: [number, number, number, number] = followsLocalGround
          ? [
              groundAt(0, px, pz),
              groundAt(1, px, pz),
              groundAt(2, px, pz),
              groundAt(3, px, pz),
            ]
          : centreGround;
        const heightOffset = ring === 0 ? -3 : height * level.height;
        const shade =
          0.96 +
          hashUnit3(
            this.road.seed ^ (MESA_TAG + 200 + ring * 31 + segment),
            cellX,
            cellZ,
          ) *
            0.08;
        positions.push(px, grounds[0] + heightOffset, pz);
        colors.push(
          Math.min(1, mesaLinear.r * shade),
          Math.min(1, mesaLinear.g * shade),
          Math.min(1, mesaLinear.b * shade),
          1,
        );
        for (let sample = 0; sample < 4; sample++) {
          baseGroundY[sample]!.push(grounds[sample]!);
        }
        heightOffsets.push(heightOffset);
        centres.push(x, z);
      }
    }

    for (let ring = 0; ring < MESA_RINGS.length - 1; ring++) {
      const current = firstVertex + ring * segments;
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
    const top = firstVertex + (MESA_RINGS.length - 1) * segments;
    const centre = positions.length / 3;
    const topOffset = height * 1.01;
    positions.push(x, centreGround[0] + topOffset, z);
    colors.push(mesaLinear.r, mesaLinear.g, mesaLinear.b, 1);
    for (let sample = 0; sample < 4; sample++) {
      baseGroundY[sample]!.push(centreGround[sample]!);
    }
    heightOffsets.push(topOffset);
    centres.push(x, z);
    for (let segment = 0; segment < segments; segment++) {
      indices.push(centre, top + ((segment + 1) % segments), top + segment);
    }
    return footprintRadius;
  }

  /** Vertices in the current disc, for the perf bench. */
  get vertexCount(): number {
    return this.radii.length * SECTORS;
  }

  dispose(): void {
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
    this.mesaCandidates = [];
    this.dissolvingMesas.clear();
    this.retiredMesas.clear();
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
