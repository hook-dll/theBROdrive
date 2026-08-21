import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { Noise2D } from '../core/rng';
import { SurfaceType, SURFACES } from '../core/surfaces';
import { roadConditionAt } from './gradient';
import { NODE_SPACING, ROAD_HALF_WIDTH, SHOULDER_WIDTH, type Road } from './road';
import type { ChunkContent, ChunkContext, ChunkProvider } from './chunks';

/**
 * The road ribbon: asphalt lanes with gravel shoulders, banked into corners and
 * displaced by decay-driven roughness. The same vertex positions feed both the
 * visible mesh and the trimesh collider, so what you see is what the wheels feel.
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
 * lateral`. Capped so the banked shoulder edge plus roughness displacement can
 * never fall below the terrain corridor floor (sunk ROAD_SINK = 0.16 m below the
 * centreline): max bank here is (1/170) * 3 * 4.7 ≈ 0.083 m, plus at most 0.07 m of
 * gravel roughness, well inside the 0.16 m budget.
 */
const CAMBER_SCALE = 3;

/** Noise frequency for roughness displacement (wavelength ≈ 8 m at 4 m nodes). */
const ROUGH_FREQ = 0.12;

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

  private readonly roughnessNoise: Noise2D;

  constructor(seed: number) {
    this.roughnessNoise = new Noise2D(seed ^ 0x72e5c0a1);
  }

  build(ctx: ChunkContext): ChunkContent | null {
    const { sStart, sEnd, road, physics, hasPhysics } = ctx;
    if (sEnd <= sStart) return null;

    // One surface type per chunk drives both the collider friction profile and the
    // roughness amplitude; per-vertex decay still modulates the displacement.
    const surface = roadConditionAt((sStart + sEnd) / 2).surface;
    const laneColor = SURFACE_LINEAR[surface];
    const roughness = SURFACES[surface].roughness;

    const sCount = Math.round((sEnd - sStart) / NODE_SPACING) + 1;
    const latCount = LATERALS.length;
    const vertexCount = sCount * latCount;

    const positions = new Float32Array(vertexCount * 3);
    const colors = new Float32Array(vertexCount * 3);
    const indices = new Uint32Array((sCount - 1) * (latCount - 1) * 6);

    const point = { x: 0, y: 0, z: 0 };
    const color = new THREE.Color();

    for (let si = 0; si < sCount; si++) {
      const s = sStart + si * NODE_SPACING;
      const sample = road.sampleAt(s);
      const cond = roadConditionAt(s);
      const bankScale = sample.curvature * CAMBER_SCALE;
      const dispAmp = cond.decay * roughness;

      for (let li = 0; li < latCount; li++) {
        const lateral = LATERALS[li]!;
        road.offsetPoint(s, lateral, point);
        const y =
          point.y - bankScale * lateral +
          this.roughnessNoise.at(point.x * ROUGH_FREQ, point.z * ROUGH_FREQ) * dispAmp;

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

    const markings = this.buildMarkings(road, sStart, sCount, roughness, laneColor);
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
    sCount: number,
    roughness: number,
    laneColor: THREE.Color,
  ): THREE.Mesh | null {
    const positions: number[] = [];
    const colors: number[] = [];
    const point = { x: 0, y: 0, z: 0 };
    const color = new THREE.Color();

    for (let si = 0; si < sCount - 1; si++) {
      const s = sStart + si * NODE_SPACING;
      const markings = roadConditionAt(s).markings;
      if (markings < MARKING_MIN) continue;

      color.lerpColors(laneColor, WHITE, markings);

      for (const line of MARKING_LINES) {
        if (line.dashed && (si & 1) !== 0) continue;
        this.emitMarkingQuad(
          road, roughness, line.lateral, s, s + NODE_SPACING,
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
    roughness: number,
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
    this.markingCorner(road, roughness, s0, l0, point);
    const x00 = point.x; const y00 = point.y; const z00 = point.z;
    this.markingCorner(road, roughness, s0, l1, point);
    const x01 = point.x; const y01 = point.y; const z01 = point.z;
    this.markingCorner(road, roughness, s1, l0, point);
    const x10 = point.x; const y10 = point.y; const z10 = point.z;
    this.markingCorner(road, roughness, s1, l1, point);
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
    roughness: number,
    s: number,
    lateral: number,
    out: { x: number; y: number; z: number },
  ): void {
    const sample = road.sampleAt(s);
    road.offsetPoint(s, lateral, out);
    const disp =
      this.roughnessNoise.at(out.x * ROUGH_FREQ, out.z * ROUGH_FREQ) *
      roadConditionAt(s).decay *
      roughness;
    out.y = out.y - sample.curvature * CAMBER_SCALE * lateral + disp + MARKING_LIFT;
  }
}
