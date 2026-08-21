import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { hash01, Noise1D, Noise2D } from '../core/rng';
import { SurfaceType, SURFACES } from '../core/surfaces';
import { roadConditionAt } from './gradient';
import { NODE_SPACING, ROAD_HALF_WIDTH, SHOULDER_WIDTH, type Road } from './road';
import type { ChunkContent, ChunkContext, ChunkProvider } from './chunks';

/**
 * The road ribbon: asphalt lanes with gravel shoulders, banked into corners and
 * displaced by a layered surface field — a long undulation, a short bump layer and
 * discrete potholes, all scaled by the road's decay so maintained asphalt stays
 * nearly smooth while cracked and gravel stretches visibly rough up. The same
 * vertex positions feed both the visible mesh and the trimesh collider, so what
 * you see is what the wheels feel.
 */

const HW = ROAD_HALF_WIDTH;
const SW = SHOULDER_WIDTH;
/** Outer edge of the shoulder; matches terrain.ts CORRIDOR_INNER. */
const CORRIDOR_INNER = HW + SW;

/**
 * Cross-section lateral offsets, left to right. Finer inside the lanes so drifted
 * sand wedges resolve, with one quad for each shoulder.
 */
const LATERALS: readonly number[] = [
  -CORRIDOR_INNER, -HW, -(HW * 2) / 3, -(HW * 1) / 3, 0,
  (HW * 1) / 3, (HW * 2) / 3, HW, CORRIDOR_INNER,
];

/**
 * How strongly the road banks into corners. `drop = curvature * CAMBER_SCALE *
 * lateral`. Capped so the banked shoulder edge plus surface displacement can never
 * fall below the terrain corridor floor (sunk ROAD_SINK = 0.16 m below the
 * centreline): max bank here is (1/170) * 3 * 4.7 ≈ 0.083 m, plus at most 0.073 m
 * of displacement at the shoulder edge (undulation 0.024 + bumps 0.049; potholes
 * stay inside the lanes, |lateral| ≤ 2.2, where the bank is smaller), well inside
 * the 0.16 m budget.
 */
const CAMBER_SCALE = 3;

/**
 * Longitudinal sub-samples per road node. The mesh is densified 3x (a 1.333 m
 * vertex step instead of NODE_SPACING's 4 m) so bumps and potholes are actually
 * representable by the trimesh the wheels ray-cast against. NODE_SPACING itself
 * stays 4 m — it is the road curve's integration step and other systems depend on
 * it; this only sub-samples inside the provider.
 */
export const SUB_DIVISIONS = 3;
/** Longitudinal vertex/collider step in metres. */
export const SURFACE_STEP = NODE_SPACING / SUB_DIVISIONS;

/**
 * Short bump layer, two octaves: 8.3 m (the original wave) plus a 4.17 m octave.
 * 4-8 m is the band a car at 60-100 km/h actually feels as texture; nothing
 * shorter than ~3 m is representable at the 1.333 m vertex step, and 4.17 m keeps
 * a safe margin above that.
 */
const ROUGH_FREQ = 0.12;
const ROUGH_FREQ_HI = 0.24;
/** Relative amplitude of the 4.17 m octave. */
const ROUGH_HI_GAIN = 0.55;
/**
 * Bump amplitude on a maintained road, per surface type (m). Even a well-kept
 * road has texture — decay must add to a floor, not multiply zero. Cracked
 * asphalt is floored highest because broken tarmac is rutted; loose gravel stays
 * even until it degrades; concrete is the one genuinely smooth surface.
 */
const BUMP_FLOOR: Record<SurfaceType, number> = {
  [SurfaceType.Asphalt]: 0.028,
  [SurfaceType.CrackedAsphalt]: 0.052,
  [SurfaceType.Gravel]: 0.024,
  [SurfaceType.Sand]: 0.024,
  [SurfaceType.Rock]: 0.03,
  [SurfaceType.Concrete]: 0.008,
};
/**
 * Decay-driven bump growth: adds `decay * roughness * BUMP_GAIN` metres on top of
 * the floor. Sized so the shoulder-edge worst case (bank 0.083 + undulation 0.024
 * + bumps 0.049) stays inside the ROAD_SINK budget above.
 */
const BUMP_GAIN = 0.35;

/** Long undulation: wavelength (m) of its first octave — gentle rolling, not hills. */
const UND_WAVELENGTH = 30;
/** Undulation amplitude at decay = 1 (m). */
const UND_AMP = 0.024;
/** Fraction of the amplitude kept even on pristine road; glass is boring. */
const UND_FLOOR = 0.35;

/** Metres between pothole candidate slots. */
export const POTH_SLOT = 4;
/** Per-slot occupancy at decay = 1, before the burst multiplier. */
const POTH_DENSITY = 0.12;
/**
 * Occupancy keeps this fraction even at decay = 0, so maintained asphalt still
 * throws the occasional patched hole (~1.5/km); quadratic decay growth stacks on
 * top of the floor.
 */
const POTH_DECAY_FLOOR = 0.075;
/** Depth keeps this fraction of its cap even on pristine road (a patched hole). */
const POTH_DEPTH_FLOOR = 0.15;
/** Pothole diameter range in metres. */
const POTH_MIN_D = 0.4;
const POTH_MAX_D = 1.2;
/** Depth cap (m): never a hole deep enough to swallow a wheel. */
const POTH_MAX_DEPTH = 0.07;
/**
 * Depth/diameter cap. The cosine profile's steepest slope is pi*depth/diameter at
 * r = D/4; 0.13 keeps that under ~22 degrees, so a wheel never meets a kerb-like
 * wall. The mesh is even shallower: a pothole lands on one vertex, so the felt
 * slope is depth/1.333 m ≈ 3 degrees.
 */
const POTH_SLOPE_CAP = 0.13;
/** Lattice lines (m) a pothole may centre on; the lanes where wheels actually track. */
const POTH_LATERALS: readonly number[] = [-2.2, -1.1, 0, 1.1, 2.2];

// Hash tags keep each pothole property's random stream independent.
const TAG_POTH_BURST = 0x50d4b7;
const TAG_POTH_OCCUPANCY = 0x0a11ce;
const TAG_POTH_OFFSET = 0x0ffee;
const TAG_POTH_LATERAL = 0x1a7a1;
const TAG_POTH_DIAMETER = 0xd1a4;
const TAG_POTH_DEPTH = 0xdee7;

export interface Pothole {
  /** Arclength of the pothole centre. Always a vertex row, so it is exactly sampled. */
  readonly s: number;
  /** Lateral of the pothole centre. Always a lattice line, so it is exactly sampled. */
  readonly lateral: number;
  /** Diameter across the cosine profile, metres. */
  readonly diameter: number;
  /** Centre depth in metres, after decay and jitter scaling. */
  readonly depth: number;
}

/**
 * Shape of the pothole candidate at `slot`, before the decay-scaled occupancy
 * test. Deterministic in (seed, slot), so neighbouring chunks agree across seams.
 */
export function potholeForSlot(seed: number, slot: number): Pick<Pothole, 's' | 'lateral' | 'diameter'> {
  const off = Math.floor(hash01(seed, slot, TAG_POTH_OFFSET) * SUB_DIVISIONS);
  return {
    s: POTH_SLOT * slot + off * SURFACE_STEP,
    lateral: POTH_LATERALS[Math.floor(hash01(seed, slot, TAG_POTH_LATERAL) * POTH_LATERALS.length)]!,
    diameter: POTH_MIN_D + (POTH_MAX_D - POTH_MIN_D) * hash01(seed, slot, TAG_POTH_DIAMETER),
  };
}

/**
 * The pothole anchored at `slot`, if its decay-scaled occupancy test passes.
 * Occupancy rises quadratically with decay and is bursty (0.35..1 multiplier), so
 * holes cluster on ruined stretches and almost vanish from maintained ones.
 */
export function potholeAtSlot(seed: number, slot: number, decay: number): Pothole | null {
  const burst = 0.35 + 0.65 * hash01(seed, slot, TAG_POTH_BURST);
  // Floor + quadratic decay growth: pristine road still gets the odd patched hole,
  // ruined road gets plenty.
  const decayFactor = POTH_DECAY_FLOOR + (1 - POTH_DECAY_FLOOR) * decay * decay;
  if (hash01(seed, slot, TAG_POTH_OCCUPANCY) >= POTH_DENSITY * decayFactor * burst) return null;
  const shape = potholeForSlot(seed, slot);
  // A patched hole on pristine road is shallow but present; depth grows with decay.
  const depthFactor = (POTH_DEPTH_FLOOR + (1 - POTH_DEPTH_FLOOR) * decay) * (0.5 + 0.5 * decay);
  const depth =
    Math.min(POTH_MAX_DEPTH, POTH_SLOPE_CAP * shape.diameter) *
    depthFactor *
    (0.5 + 0.5 * hash01(seed, slot, TAG_POTH_DEPTH));
  return { s: shape.s, lateral: shape.lateral, diameter: shape.diameter, depth };
}

/**
 * Pothole displacement (m, negative = down) at a road point, or 0. Anchors sit on
 * vertex rows, so the cosine profile's centre is always exactly sampled; the
 * 1.333 m grid cannot resolve anything smaller anyway.
 */
export function potholeAt(seed: number, s: number, lateral: number, decay: number): number {
  // The +1e-9 guards a float-boundary trap: row s = 3j * (4/3) rounds to just
  // BELOW 4j, so floor(s / 4) alone would look up slot j-1 and silently drop every
  // pothole anchored at a slot start. The epsilon is far below any real feature.
  const hole = potholeAtSlot(seed, Math.floor(s / POTH_SLOT + 1e-9), decay);
  if (!hole) return 0;
  const ds = s - hole.s;
  const dl = lateral - hole.lateral;
  const half = hole.diameter * 0.5;
  if (Math.abs(ds) > half || Math.abs(dl) > half) return 0;
  const r = Math.sqrt(ds * ds + dl * dl);
  // Cosine profile: deepest at the centre, zero slope at the rim (C1).
  return -hole.depth * Math.cos((Math.PI * r) / hole.diameter) ** 2;
}

/**
 * The layered surface field: long undulation + short bumps + discrete potholes.
 * Everything is a pure function of (seed, s, lateral), so rebuilds reproduce
 * exactly and chunk seams stay watertight.
 */
export class SurfaceField {
  private readonly seed: number;
  private readonly undulationNoise: Noise1D;
  private readonly bumpNoise: Noise2D;

  constructor(seed: number) {
    this.seed = seed >>> 0;
    // Separate seeds keep the layers decorrelated; the bump seed is the one the
    // old single-octave roughness used, so existing worlds keep the same bumps.
    this.undulationNoise = new Noise1D(seed ^ 0x2d5f3e71);
    this.bumpNoise = new Noise2D(seed ^ 0x72e5c0a1);
  }

  /**
   * Total displacement (m, positive up) at a road point. `x`/`z` are the point's
   * world position (the bump layer is 2D world noise), `decay` the road condition
   * at this s, `surface` the per-chunk surface type (drives both the bump floor
   * and the decay-driven roughness growth).
   */
  displacement(
    s: number,
    lateral: number,
    x: number,
    z: number,
    decay: number,
    surface: SurfaceType,
  ): number {
    const und =
      UND_AMP * (UND_FLOOR + (1 - UND_FLOOR) * decay) *
      this.undulationNoise.fbm(s / UND_WAVELENGTH, 2, 2, 0.5);
    // Floor keeps texture on maintained roads; decay adds material degradation.
    const bumpAmp = BUMP_FLOOR[surface] + BUMP_GAIN * decay * SURFACES[surface].roughness;
    const bump = bumpAmp * this.bumpNoise.fbm(x * ROUGH_FREQ, z * ROUGH_FREQ, 2, 2, ROUGH_HI_GAIN);
    return und + bump + potholeAt(this.seed, s, lateral, decay);
  }
}

const MARKING_LIFT = 0.03;
const MARKING_HALF_WIDTH = 0.12;
const EDGE_LATERAL = HW - 0.4;
const MARKING_MIN = 0.03;

/** Surface albedos pre-converted to the linear working colour space. */
const SURFACE_LINEAR: Record<SurfaceType, THREE.Color> = {
  [SurfaceType.Asphalt]: new THREE.Color(SURFACES[SurfaceType.Asphalt].color),
  [SurfaceType.CrackedAsphalt]: new THREE.Color(SURFACES[SurfaceType.CrackedAsphalt].color),
  [SurfaceType.Gravel]: new THREE.Color(SURFACES[SurfaceType.Gravel].color),
  [SurfaceType.Sand]: new THREE.Color(SURFACES[SurfaceType.Sand].color),
  [SurfaceType.Rock]: new THREE.Color(SURFACES[SurfaceType.Rock].color),
  [SurfaceType.Concrete]: new THREE.Color(SURFACES[SurfaceType.Concrete].color),
};

const GRAVEL_LINEAR = SURFACE_LINEAR[SurfaceType.Gravel];
const SAND_LINEAR = SURFACE_LINEAR[SurfaceType.Sand];
const WHITE = new THREE.Color(0xffffff);

// Shared across every chunk; never disposed by the streamer.
const roadMaterial = new THREE.MeshStandardMaterial({
  vertexColors: true,
  roughness: 0.96,
  metalness: 0,
});
const markingMaterial = new THREE.MeshStandardMaterial({
  vertexColors: true,
  roughness: 0.9,
  metalness: 0,
  // Markings sit 3 cm above the road; the offset keeps them from z-fighting.
  polygonOffset: true,
  polygonOffsetFactor: -1,
  polygonOffsetUnits: -1,
});

/** Fraction of sand covering a point at |lateral| = a, given sandCover (0..1). */
function sandFactor(a: number, sandCover: number): number {
  if (sandCover <= 0) return 0;
  const tip = HW * (1 - sandCover);
  if (a <= tip) return 0;
  if (a >= CORRIDOR_INNER) return 1;
  return (a - tip) / (CORRIDOR_INNER - tip);
}

interface MarkingLine {
  readonly lateral: number;
  readonly dashed: boolean;
}

const MARKING_LINES: readonly MarkingLine[] = [
  { lateral: -EDGE_LATERAL, dashed: false },
  { lateral: 0, dashed: true },
  { lateral: EDGE_LATERAL, dashed: false },
];

export class RoadMeshProvider implements ChunkProvider {
  readonly id = 'road';

  private readonly field: SurfaceField;

  constructor(seed: number) {
    this.field = new SurfaceField(seed);
  }

  build(ctx: ChunkContext): ChunkContent | null {
    const { sStart, sEnd, road, physics, hasPhysics } = ctx;
    if (sEnd <= sStart) return null;

    // One surface type per chunk drives the collider friction profile, the bump
    // floor and the decay-driven roughness growth; per-vertex decay still
    // modulates the displacement.
    const surface = roadConditionAt((sStart + sEnd) / 2).surface;
    const laneColor = SURFACE_LINEAR[surface];

    const sCount = Math.round((sEnd - sStart) / SURFACE_STEP) + 1;
    const latCount = LATERALS.length;
    const vertexCount = sCount * latCount;

    const positions = new Float32Array(vertexCount * 3);
    const colors = new Float32Array(vertexCount * 3);
    const indices = new Uint32Array((sCount - 1) * (latCount - 1) * 6);

    const point = { x: 0, y: 0, z: 0 };
    const color = new THREE.Color();

    for (let si = 0; si < sCount; si++) {
      // Endpoint-exact rows: si * (sEnd - sStart) / (sCount - 1) makes the shared
      // boundary row bit-identical in both neighbours, keeping the seam watertight
      // at the denser resolution.
      const s = sStart + (si * (sEnd - sStart)) / (sCount - 1);
      const sample = road.sampleAt(s);
      const cond = roadConditionAt(s);
      const bankScale = sample.curvature * CAMBER_SCALE;

      for (let li = 0; li < latCount; li++) {
        const lateral = LATERALS[li]!;
        road.offsetPoint(s, lateral, point);
        const y =
          point.y - bankScale * lateral +
          this.field.displacement(s, lateral, point.x, point.z, cond.decay, surface);

        const vi = si * latCount + li;
        positions[vi * 3] = point.x;
        positions[vi * 3 + 1] = y;
        positions[vi * 3 + 2] = point.z;

        const a = Math.abs(lateral);
        color.lerpColors(
          a <= HW ? laneColor : GRAVEL_LINEAR,
          SAND_LINEAR,
          sandFactor(a, cond.sandCover),
        );
        colors[vi * 3] = color.r;
        colors[vi * 3 + 1] = color.g;
        colors[vi * 3 + 2] = color.b;
      }
    }

    let ii = 0;
    for (let si = 0; si < sCount - 1; si++) {
      for (let li = 0; li < latCount - 1; li++) {
        const a = si * latCount + li;
        const b = a + latCount;
        const c = a + 1;
        const d = b + 1;
        indices[ii++] = a;
        indices[ii++] = b;
        indices[ii++] = c;
        indices[ii++] = b;
        indices[ii++] = d;
        indices[ii++] = c;
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.computeVertexNormals();

    const group = new THREE.Group();
    group.add(new THREE.Mesh(geometry, roadMaterial));

    const bodies: RAPIER.RigidBody[] = [];
    const colliders: RAPIER.Collider[] = [];
    const disposables: THREE.BufferGeometry[] = [geometry];

    if (hasPhysics) {
      const collider = physics.addStaticTrimesh(positions, indices, surface);
      colliders.push(collider);
      const body = collider.parent();
      if (body) bodies.push(body);
    }

    const markings = this.buildMarkings(road, sStart, sEnd, sCount, surface, laneColor);
    if (markings) {
      group.add(markings);
      disposables.push(markings.geometry);
    }

    return {
      group,
      bodies,
      colliders,
      dispose: () => {
        for (const g of disposables) g.dispose();
      },
    };
  }

  private buildMarkings(
    road: Road,
    sStart: number,
    sEnd: number,
    sCount: number,
    surface: SurfaceType,
    laneColor: THREE.Color,
  ): THREE.Mesh | null {
    const positions: number[] = [];
    const colors: number[] = [];
    const point = { x: 0, y: 0, z: 0 };
    const color = new THREE.Color();

    // Marking quads are emitted per surface step (not per node) so their corners
    // coincide with mesh vertices — a quad spanning a pothole or bump would
    // otherwise float or cut through the road surface between its corners.
    for (let si = 0; si < sCount - 1; si++) {
      const s = sStart + (si * (sEnd - sStart)) / (sCount - 1);
      const markings = roadConditionAt(s).markings;
      if (markings < MARKING_MIN) continue;

      color.lerpColors(laneColor, WHITE, markings);

      for (const line of MARKING_LINES) {
        // Dashes are 4 m on / 4 m off; skip the odd 4 m blocks.
        if (line.dashed && ((si / SUB_DIVISIONS) | 0) & 1) continue;
        this.emitMarkingQuad(
          road, surface, line.lateral, s, s + SURFACE_STEP,
          point, color, positions, colors,
        );
      }
    }

    if (positions.length === 0) return null;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(positions), 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(Float32Array.from(colors), 3));
    geometry.computeVertexNormals();
    return new THREE.Mesh(geometry, markingMaterial);
  }

  private emitMarkingQuad(
    road: Road,
    surface: SurfaceType,
    lateral: number,
    s0: number,
    s1: number,
    point: { x: number; y: number; z: number },
    color: THREE.Color,
    positions: number[],
    colors: number[],
  ): void {
    const l0 = lateral - MARKING_HALF_WIDTH;
    const l1 = lateral + MARKING_HALF_WIDTH;
    // Four corners [c00, c01, c10, c11]; emit triangles c00,c10,c01 and c10,c11,c01.
    this.markingCorner(road, surface, s0, l0, point);
    const x00 = point.x; const y00 = point.y; const z00 = point.z;
    this.markingCorner(road, surface, s0, l1, point);
    const x01 = point.x; const y01 = point.y; const z01 = point.z;
    this.markingCorner(road, surface, s1, l0, point);
    const x10 = point.x; const y10 = point.y; const z10 = point.z;
    this.markingCorner(road, surface, s1, l1, point);
    const x11 = point.x; const y11 = point.y; const z11 = point.z;

    const order = [0, 2, 1, 2, 3, 1];
    const xs = [x00, x01, x10, x11];
    const ys = [y00, y01, y10, y11];
    const zs = [z00, z01, z10, z11];
    for (const i of order) {
      positions.push(xs[i]!, ys[i]!, zs[i]!);
      colors.push(color.r, color.g, color.b);
    }
  }

  private markingCorner(
    road: Road,
    surface: SurfaceType,
    s: number,
    lateral: number,
    out: { x: number; y: number; z: number },
  ): void {
    const sample = road.sampleAt(s);
    road.offsetPoint(s, lateral, out);
    const disp = this.field.displacement(s, lateral, out.x, out.z, roadConditionAt(s).decay, surface);
    out.y = out.y - sample.curvature * CAMBER_SCALE * lateral + disp + MARKING_LIFT;
  }
}
