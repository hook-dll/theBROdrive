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
 * Both distant layers are visual only. Mountains and mesas are raised gradually with
 * camera distance, so driving toward one returns it to ordinary physical terrain before
 * it can be reached. Their world-space seeds remain fixed while they are visible: the
 * same butte holds its place across vista rebuilds instead of following the camera.
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
 * How far the camera moves before the disc is rebuilt, metres.
 *
 * Small enough that the inner hole never leaves the near terrain, large enough that a
 * rebuild is a few times a minute at road speed. Rebuilding is cheap in vertices; what it
 * costs is nearest-road-distance nodes, and those are cached absolutely, so every rebuild
 * after the first only pays for the fringe it has newly uncovered.
 */
const REBUILD_STEP = 250;


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
 * Sparse middle-distance landmarks. Their job is depth, not coverage: repeating a
 * recognisable hundred-metre form at successively smaller angular sizes gives the eye a
 * scale reference that an uninterrupted heightfield cannot. One candidate per absolute
 * cell keeps the arrangement stable while the camera moves.
 */
const MESA_CELL_SIZE = 1800;
const MESA_OCCUPANCY = 0.22;
const MESA_INNER_START = 1800;
const MESA_FULL_HEIGHT = 3600;
const MESA_MAX_DISTANCE = 18_000;
const MESA_MAX_RADIUS = 600;
const MESA_MIN_RADIUS = 170;
const MESA_MIN_HEIGHT = 90;
const MESA_MAX_HEIGHT = 320;
const MESA_TAG = 0x4d455341;
const MESA_MOUNTAIN_CLEARANCE = 40;
const MESA_RINGS = [
  { radius: 1.14, height: 0 },
  { radius: 1.0, height: 0.12 },
  { radius: 0.82, height: 0.55 },
  { radius: 0.68, height: 0.58 },
  { radius: 0.56, height: 0.84 },
  { radius: 0.45, height: 0.88 },
  { radius: 0.39, height: 1 },
] as const;

/** Palette scratch colours, set once per disc rebuild from `desertPaletteAt`. */
const sandLinear = new THREE.Color();
const rockLinear = new THREE.Color();
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

export class VistaMesh {
  private readonly mesh: THREE.Mesh;
  private readonly mesaMesh: THREE.Mesh;
  private geometry: THREE.BufferGeometry | null = null;
  private mesaGeometry: THREE.BufferGeometry | null = null;

  /** Radius of the disc, metres. Set by the view-distance setting. */
  private outerRadius = 0;
  /**
   * Centre of the disc as last built, in the RELATIVE frame; NaN until the first
   * build. Kept relative on purpose: `update` receives the relative camera, and a
   * rebase shifts that relative camera by a whole `REBASE_STEP` (at least 1000 m),
   * which is always more than `REBUILD_STEP`, so the rebuild gate below trips on
   * its own and the disc is rebuilt for the new origin with no explicit rebase
   * handling and no `Rebasable` bookkeeping.
   */
  private centreX = Number.NaN;
  private centreZ = Number.NaN;

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
    this.mesaMesh.visible = outer > MESA_INNER_START;
    if (outer > 0) this.radii = ringRadii(outer);
    // Force the next update to rebuild whatever the camera has done since.
    this.centreX = Number.NaN;
  }

  /** Rebuilds the disc if the camera has left the patch it was built for. */
  update(cameraX: number, cameraZ: number, s: number): void {
    if (this.outerRadius <= 0) return;
    const snapX = Math.round(cameraX / REBUILD_STEP) * REBUILD_STEP;
    const snapZ = Math.round(cameraZ / REBUILD_STEP) * REBUILD_STEP;
    if (snapX === this.centreX && snapZ === this.centreZ) return;
    this.centreX = snapX;
    this.centreZ = snapZ;
    this.build(snapX, snapZ, s);
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
    let closestDistanceSq = ROAD_UNDERLAY_FADE * ROAD_UNDERLAY_FADE;
    let closestRoadY = 0;
    for (let i = 0; i < this.roadSampleCount - 1; i++) {
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

  private build(cx: number, cz: number, s: number): void {
    const radii = this.radii;
    const rings = radii.length;
    const vertexCount = rings * SECTORS;
    // Vertices are stored relative to the floating origin, while every terrain field
    // remains a function of absolute world coordinates.
    const ox = this.origin.x;
    const oz = this.origin.z;
    this.prepareRoadUnderlay(s);

    const positions = new Float32Array(vertexCount * 3);
    const colors = new Float32Array(vertexCount * 3);
    // The whole disc shares one palette sample, taken at the camera's arclength:
    // the palette cycles over 4 000 km, so a single s across the disc is exact to
    // the eye and matches the near desert at the horizon line.
    const palette = desertPaletteAt(s);
    sandLinear.setHex(palette.sand);
    rockLinear.setHex(palette.rock);
    // Kilometres of dusty air mute sandstone before fog finishes the job. Keeping the
    // base near the sand palette prevents unlit walls from becoming black cut-outs.
    rockLinear.lerp(sandLinear, 0.45);

    for (let r = 0; r < rings; r++) {
      const radius = radii[r]!;
      const bias =
        INNER_BIAS *
        (1 - smoothstep01((radius - INNER_RADIUS) / (BIAS_FADE - INNER_RADIUS)));
      const reliefWeight =
        1 - smoothstep01((radius - RELIEF_FADE_START) / (RELIEF_FADE_END - RELIEF_FADE_START));
      for (let a = 0; a < SECTORS; a++) {
        const x = cx + this.dirX[a]! * radius;
        const z = cz + this.dirZ[a]! * radius;
        const absoluteX = x + ox;
        const absoluteZ = z + oz;
        const horizonY = this.terrain.horizonHeight(absoluteX, absoluteZ, radius, reliefWeight);
        // Height above the driveable landscape is a cheap proxy for exposed rock.
        // Fog still owns distance desaturation, so this adds material identity without
        // painting a second atmospheric gradient into the terrain.
        const rockWeight = smoothstep01(
          (horizonY - this.terrain.baseHeight(absoluteX, absoluteZ, radius)) / ROCK_ALTITUDE,
        );
        let y = horizonY - bias;
        if (radius <= ROAD_UNDERLAY_RADIUS) {
          y = this.beneathRoad(absoluteX, absoluteZ, y, bias);
        }

        const vi = (r * SECTORS + a) * 3;
        positions[vi] = x;
        positions[vi + 1] = y;
        positions[vi + 2] = z;

        colors[vi] = sandLinear.r + (rockLinear.r - sandLinear.r) * rockWeight;
        colors[vi + 1] = sandLinear.g + (rockLinear.g - sandLinear.g) * rockWeight;
        colors[vi + 2] = sandLinear.b + (rockLinear.b - sandLinear.b) * rockWeight;
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
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
    geometry.computeVertexNormals();

    this.geometry?.dispose();
    this.geometry = geometry;
    this.mesh.geometry = geometry;
    this.buildMesas(cx, cz, s);
  }

  /**
   * Rebuilds a few dozen low-poly buttes around the snapped vista centre. Candidates
   * touching the mountain field are rejected; a terrain-conforming talus skirt then
   * gives every accepted mesa one unambiguous contact with the distant ground.
   */
  private buildMesas(cx: number, cz: number, s: number): void {
    const outer = Math.min(MESA_MAX_DISTANCE, this.outerRadius - MESA_MAX_RADIUS);
    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    if (outer > MESA_INNER_START) {
      const cameraX = cx + this.origin.x;
      const cameraZ = cz + this.origin.z;
      const minCellX = Math.floor((cameraX - outer) / MESA_CELL_SIZE);
      const maxCellX = Math.floor((cameraX + outer) / MESA_CELL_SIZE);
      const minCellZ = Math.floor((cameraZ - outer) / MESA_CELL_SIZE);
      const maxCellZ = Math.floor((cameraZ + outer) / MESA_CELL_SIZE);

      for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
        for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ++) {
          if (hashUnit3(this.road.seed ^ MESA_TAG, cellX, cellZ) >= MESA_OCCUPANCY) continue;
          const worldX =
            (cellX + 0.18 + hashUnit3(this.road.seed ^ (MESA_TAG + 1), cellX, cellZ) * 0.64) *
            MESA_CELL_SIZE;
          const worldZ =
            (cellZ + 0.18 + hashUnit3(this.road.seed ^ (MESA_TAG + 2), cellX, cellZ) * 0.64) *
            MESA_CELL_SIZE;
          const dx = worldX - cameraX;
          const dz = worldZ - cameraZ;
          const distance = Math.hypot(dx, dz);
          if (distance <= MESA_INNER_START || distance >= outer) continue;

          const heightWeight = smoothstep01(
            (distance - MESA_INNER_START) / (MESA_FULL_HEIGHT - MESA_INNER_START),
          );
          if (heightWeight <= 0.01) continue;
          const radius =
            MESA_MIN_RADIUS +
            hashUnit3(this.road.seed ^ (MESA_TAG + 3), cellX, cellZ) *
              (MESA_MAX_RADIUS - MESA_MIN_RADIUS);
          const radiusZ =
            radius *
            (0.48 + hashUnit3(this.road.seed ^ (MESA_TAG + 4), cellX, cellZ) * 0.42);
          const height =
            (MESA_MIN_HEIGHT +
              hashUnit3(this.road.seed ^ (MESA_TAG + 5), cellX, cellZ) *
                (MESA_MAX_HEIGHT - MESA_MIN_HEIGHT)) *
            heightWeight;
          const rotation =
            hashUnit3(this.road.seed ^ (MESA_TAG + 6), cellX, cellZ) * Math.PI;
          const segments =
            9 + Math.floor(hashUnit3(this.road.seed ^ (MESA_TAG + 7), cellX, cellZ) * 5);
          this.appendMesa(
            positions,
            colors,
            indices,
            worldX - this.origin.x,
            worldZ - this.origin.z,
            distance,
            radius,
            radiusZ,
            height,
            rotation,
            segments,
            cellX,
            cellZ,
          );
        }
      }
    }

    const indexed = new THREE.BufferGeometry();
    indexed.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    indexed.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    indexed.setIndex(indices);
    // Separate triangle normals keep the sedimentary ledges and faceted walls legible.
    const geometry = indexed.toNonIndexed();
    indexed.dispose();
    geometry.computeVertexNormals();
    this.mesaGeometry?.dispose();
    this.mesaGeometry = geometry;
    this.mesaMesh.geometry = geometry;
    this.mesaMesh.visible = positions.length > 0;
  }

  private appendMesa(
    positions: number[],
    colors: number[],
    indices: number[],
    x: number,
    z: number,
    distance: number,
    radiusX: number,
    radiusZ: number,
    height: number,
    rotation: number,
    segments: number,
    cellX: number,
    cellZ: number,
  ): void {
    const absoluteX = x + this.origin.x;
    const absoluteZ = z + this.origin.z;
    const reliefWeight =
      1 - smoothstep01((distance - RELIEF_FADE_START) / (RELIEF_FADE_END - RELIEF_FADE_START));
    const footprint: readonly (readonly [number, number])[] = [
      [0, 0],
      [radiusX, 0],
      [-radiusX, 0],
      [0, radiusZ],
      [0, -radiusZ],
    ];
    // The mesa and mountain meshes must never occupy the same world footprint. Their
    // independent coarse facets otherwise alternate in the depth buffer at long range.
    for (const [sx, sz] of footprint) {
      if (
        this.road.landscape.mountainAt(absoluteX + sx, absoluteZ + sz)
        > MESA_MOUNTAIN_CLEARANCE
      ) {
        return;
      }
    }
    const centreGround = this.terrain.horizonHeight(
      absoluteX,
      absoluteZ,
      distance,
      reliefWeight,
    );

    const firstVertex = positions.length / 3;
    for (let ring = 0; ring < MESA_RINGS.length; ring++) {
      const level = MESA_RINGS[ring]!;
      for (let segment = 0; segment < segments; segment++) {
        const theta = rotation + (segment / segments) * Math.PI * 2;
        const irregularity =
          0.86 +
          hashUnit3(
            this.road.seed ^ (MESA_TAG + 20 + ring * 37 + segment),
            cellX,
            cellZ,
          ) *
            0.24;
        const px = x + Math.cos(theta) * radiusX * level.radius * irregularity;
        const pz = z + Math.sin(theta) * radiusZ * level.radius * irregularity;
        const localGround = this.terrain.horizonHeight(
          px + this.origin.x,
          pz + this.origin.z,
          distance,
          reliefWeight,
        );
        const y =
          ring === 0
            ? localGround - 3
            : ring === 1
              ? localGround + height * level.height
              : centreGround + height * level.height;
        const shade =
          0.96 +
          hashUnit3(
            this.road.seed ^ (MESA_TAG + 200 + ring * 31 + segment),
            cellX,
            cellZ,
          ) *
            0.08;
        positions.push(px, y, pz);
        colors.push(
          Math.min(1, rockLinear.r * shade),
          Math.min(1, rockLinear.g * shade),
          Math.min(1, rockLinear.b * shade),
        );
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
    positions.push(x, centreGround + height * 1.01, z);
    colors.push(rockLinear.r, rockLinear.g, rockLinear.b);
    for (let segment = 0; segment < segments; segment++) {
      indices.push(centre, top + ((segment + 1) % segments), top + segment);
    }
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
