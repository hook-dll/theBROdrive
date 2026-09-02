import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { Noise1D, Noise2D } from '../core/rng';
import { SurfaceType, SURFACES } from '../core/surfaces';
import { ROAD_TILE_METRES, roadTextures } from '../render/roadtexture';
import { applyGroundSpotlightNormals } from '../render/comic';
import { desertPaletteAt, roadConditionAt } from './gradient';
import { ROAD_HALF_WIDTH, SHOULDER_WIDTH, type Road } from './road';
import { SUB_DIVISIONS, SURFACE_STEP, SurfaceField, roadSurfaceY } from './roadsurface';
import type { ChunkContent, ChunkContext, ChunkProvider } from './chunks';

/**
 * The road ribbon: asphalt lanes with gravel shoulders, banked into corners and
 * displaced by a layered surface field — broad undulation, wheel-scale bumps,
 * broken asphalt edges and discrete potholes. Surface type owns ordinary bump
 * amplitude; decay increases undulation, edge breakup and pothole occurrence. The
 * same vertices feed the visible mesh and trimesh collider, so the car feels the
 * shape the driver sees.
 */

const HW = ROAD_HALF_WIDTH;
const SW = SHOULDER_WIDTH;
/** Outer edge of the shoulder; matches terrain.ts CORRIDOR_INNER. */
const CORRIDOR_INNER = HW + SW;

/**
 * Cross-section lateral offsets, left to right.
 *
 * Finer inside the lanes than the geometry strictly needs, because the columns are
 * also where the surface's WEATHERING is sampled: the polished wheel paths and the
 * bleached outer edge are strips half a metre wide, and a 1.1 m column spacing
 * cannot resolve either. The extra columns cost ~6 vertices per row.
 */
const LATERALS: readonly number[] = [
  -CORRIDOR_INNER, -HW, -2.9, -2.45, -2.0, -1.65, -1.2, -0.85, -0.4,
  0,
  0.4, 0.85, 1.2, 1.65, 2.0, 2.45, 2.9, HW, CORRIDOR_INNER,
];

/**
 * Longitudinal rows of quads per collider slab.
 *
 * The visible ribbon is one mesh, but its collider is built in slabs so no single
 * `RAPIER.ColliderDesc.trimesh` call — an uninterruptible native BVH build — can
 * own a frame. Fifteen rows is ~540 triangles, about a millisecond, which fits
 * inside the streaming scheduler's slice with room for the surrounding work.
 */
const COLLIDER_SLAB_QUADS = 15;

const MARKING_LIFT = 0.03;
const MARKING_HALF_WIDTH = 0.12;
const EDGE_LATERAL = HW - 0.4;
const MARKING_MIN = 0.03;

/**
 * Weathering of the driving surface, as three things a photograph of any old
 * two-lane road shows and this road did not.
 *
 *  1. WHEEL PATHS. Tyres polish two strips per lane and grind the dust out of them,
 *     so they are darker and smoother than the rest, and they are the single most
 *     recognisable feature of a used road. WHEEL_PATH_LATERALS are the strip
 *     centres: a 1.65 m track either side of each lane's centreline.
 *  2. A DUSTY CROWN AND SHOULDER EDGE. Between the wheel paths and out at the
 *     edges nothing sweeps the surface, so wind-blown dust settles and the bitumen
 *     bleaches: lighter, and browner, not just lighter.
 *  3. DIRT AT THE EDGE OF THE MAT. The outer half metre is where the mat ravels and
 *     the verge creeps in, so it fades towards the gravel colour before the actual
 *     edge rather than stopping dead at it.
 *
 * All three are applied to the vertex colour, on top of the tiled asphalt texture
 * (render/roadtexture.ts) that carries the aggregate, cracks and patches.
 */
const WHEEL_PATH_LATERALS: readonly number[] = [-2.45, -0.85, 0.85, 2.45];
/** Half-width of a polished strip, metres. */
const WHEEL_PATH_HALF = 0.5;
/** Darkening at the centre of a wheel path, as a fraction of the lane colour. */
const WHEEL_PATH_DARKEN = 0.16;
/** Lightening of the dusty, unswept surface between and beside the wheel paths. */
const DUST_LIGHTEN = 0.11;
/** How much of that dust reads as colour rather than brightness (towards gravel). */
const DUST_TINT = 0.3;
/** Width of the ravelled band inside the mat's edge, metres. */
const EDGE_RAVEL = 0.55;
/** Fraction of the way to gravel colour the very edge of the mat reaches. */
const EDGE_RAVEL_MIX = 0.4;
/** Wavelength (m) of the coarse tonal mottling applied per vertex. */
const MOTTLE_WAVELENGTH = 7;
/** Peak brightness swing of that mottling. */
const MOTTLE_AMOUNT = 0.07;

/**
 * Paint wear. Nothing repaints this road, so the markings are chalky rather than
 * white, they thin out in patches, and whole dashes are simply gone.
 */
const PAINT_COLOR = 0xd9d4c6;
/** Wavelength (m) over which paint coverage varies. */
const PAINT_WEAR_WAVELENGTH = 11;
/** Coverage below which a marking quad is not drawn at all. */
const PAINT_GONE = 0.34;

/**
 * Static albedos, pre-converted to the linear working colour space. Sand, rock and
 * gravel are palette-driven (see `desertPaletteAt`), so only the sealed-lane
 * surfaces remain here.
 */
const SURFACE_LINEAR: Partial<Record<SurfaceType, THREE.Color>> = {
  [SurfaceType.Asphalt]: new THREE.Color(SURFACES[SurfaceType.Asphalt].color),
  [SurfaceType.CrackedAsphalt]: new THREE.Color(SURFACES[SurfaceType.CrackedAsphalt].color),
  [SurfaceType.Concrete]: new THREE.Color(SURFACES[SurfaceType.Concrete].color),
};

/**
 * Palette scratch colours, updated once per arclength row and reused across the
 * row's vertices so no palette lookup allocates. Gravel (the shoulder and the dust
 * that tints the mat) and sand (the drift) are palette-driven; rock never appears
 * on the road ribbon.
 */
const gravelLinear = new THREE.Color();
const sandLinear = new THREE.Color();
/** Chalky, sun-dulled paint. Fresh white is what made the markings look printed. */
const PAINT_LINEAR = new THREE.Color(PAINT_COLOR);

// Shared across every chunk; never disposed by the streamer. The maps are built on
// the first chunk build (they need a canvas, so not at module load) and the vertex
// colours are divided by the albedo's mean so the surface keeps its old brightness.
const roadMaterial = applyGroundSpotlightNormals(
  new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.93,
    metalness: 0,
  }),
);
let textureGain = 1;
let texturesAttached = false;

function attachRoadTextures(): void {
  if (texturesAttached) return;
  texturesAttached = true;
  const { map, bump, mean } = roadTextures();
  roadMaterial.map = map;
  roadMaterial.bumpMap = bump;
  // 1.5 mm of relief: enough for low sun to rake across the aggregate, small enough
  // that it never reads as a bumpy road on its own.
  roadMaterial.bumpScale = 0.0015;
  roadMaterial.needsUpdate = true;
  textureGain = 1 / Math.max(0.2, mean);
}

const markingMaterial = applyGroundSpotlightNormals(
  new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.94,
    metalness: 0,
    // Markings sit 3 cm above the road; the offset keeps them from z-fighting.
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  }),
);

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
  /** Coarse tonal mottling of the mat, and the paint's wear pattern. */
  private readonly mottleNoise: Noise2D;
  private readonly paintNoise: Noise1D;

  constructor(seed: number) {
    this.field = new SurfaceField(seed);
    this.mottleNoise = new Noise2D(seed ^ 0x5bf03635);
    this.paintNoise = new Noise1D(seed ^ 0x2545f491);
  }

  build(ctx: ChunkContext): ChunkContent | null {
    const iterator = this.buildSteps(ctx);
    let result = iterator.next();
    while (!result.done) result = iterator.next();
    return result.value;
  }

  *buildSteps(ctx: ChunkContext): Iterator<void, ChunkContent | null> {
    const { sStart, sEnd, road, physics, hasPhysics } = ctx;
    if (sEnd <= sStart) return null;
    attachRoadTextures();
    // The floating origin, frozen at build time. Sampling stays absolute — the road
    // surface's 2D bump noise is a function of world position — and the subtraction
    // happens only where a coordinate is about to live in f32.
    const ox = ctx.originX;
    const oz = ctx.originZ;

    // One surface type per chunk drives the collider friction profile and the lane
    // colour; the bump floor and roughness growth come from the per-s condition
    // inside roadSurfaceY, keeping the drawn surface continuous across chunks.
    const surface = roadConditionAt((sStart + sEnd) / 2).surface;
    // Sealed lanes keep their static albedo; a road decayed all the way to gravel
    // takes the palette gravel (resolved per row, like the shoulder), so `laneBase`
    // is null for that case.
    const laneBase = SURFACE_LINEAR[surface] ?? null;

    const sCount = Math.round((sEnd - sStart) / SURFACE_STEP) + 1;
    const latCount = LATERALS.length;
    const vertexCount = sCount * latCount;

    const positions = new Float32Array(vertexCount * 3);
    const colors = new Float32Array(vertexCount * 3);
    const uvs = new Float32Array(vertexCount * 2);
    const indices = new Uint32Array((sCount - 1) * (latCount - 1) * 6);

    const group = new THREE.Group();
    const bodies: RAPIER.RigidBody[] = [];
    const colliders: RAPIER.Collider[] = [];
    const disposables: THREE.BufferGeometry[] = [];
    let completed = false;

    try {
      const point = { x: 0, y: 0, z: 0 };
      const color = new THREE.Color();

      for (let si = 0; si < sCount; si++) {
        // Endpoint-exact rows: si * (sEnd - sStart) / (sCount - 1) makes the shared
        // boundary row bit-identical in both neighbours, keeping the seam watertight
        // at the denser resolution.
        const s = sStart + (si * (sEnd - sStart)) / (sCount - 1);
        const cond = roadConditionAt(s);
        // Palette colour is a function of arclength alone: sample once per row, so
        // neighbouring chunks share the seam row and a rebuild is identical.
        const palette = desertPaletteAt(s);
        sandLinear.setHex(palette.sand);
        gravelLinear.setHex(palette.gravel);

        for (let li = 0; li < latCount; li++) {
          const lateral = LATERALS[li]!;
          road.offsetPoint(s, lateral, point);
          // Shared height function: the terrain adopts this exact surface at the
          // shoulder edge, so the road and verge stay flush.
          const y = roadSurfaceY(road, this.field, s, lateral, point.x, point.z);

          const vi = si * latCount + li;
          positions[vi * 3] = point.x - ox;
          positions[vi * 3 + 1] = y;
          positions[vi * 3 + 2] = point.z - oz;

          // Texture coordinates in world metres, so the grain has a fixed size and
          // does not stretch through corners or over the shoulder.
          uvs[vi * 2] = lateral / ROAD_TILE_METRES;
          uvs[vi * 2 + 1] = s / ROAD_TILE_METRES;

          const a = Math.abs(lateral);
          color.lerpColors(
            a <= HW ? (laneBase ?? gravelLinear) : gravelLinear,
            sandLinear,
            sandFactor(a, cond.sandCover),
          );
          if (a <= HW) this.weather(color, gravelLinear, s, lateral, a, cond.decay);
          color.multiplyScalar(textureGain);
          colors[vi * 3] = color.r;
          colors[vi * 3 + 1] = color.g;
          colors[vi * 3 + 2] = color.b;
        }
        yield;
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
        yield;
      }

      const geometry = new THREE.BufferGeometry();
      disposables.push(geometry);
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
      geometry.setIndex(new THREE.BufferAttribute(indices, 1));
      // The road and its shoulder use the same upward lighting basis as the desert.
      // Actual slope normals made both read as a dark shadow strip on grades.
      const normals = new Float32Array(positions.length);
      for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
      geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));

      const roadMesh = new THREE.Mesh(geometry, roadMaterial);
      // Every lane surface and shoulder must receive the same vehicle shadow that
      // the surrounding desert receives. The ribbon does not cast into the map, so
      // enabling reception adds contact shadows without road self-shadow acne.
      roadMesh.receiveShadow = true;
      group.add(roadMesh);
      yield;

      if (hasPhysics) {
        // ONE TRIMESH PER SLAB, not one per chunk. Rapier builds a BVH inside
        // `trimesh`, and for a whole 200 m chunk (5400 triangles) that is a single
        // 10-50 ms native call no generator yield can interrupt — measured as the
        // last remaining streaming hitch. Row slabs are the same vertices in the
        // same order, so the collided surface is bit-identical; adjacent slabs share
        // their boundary row, so there is no seam to fall through.
        //
        // `positions` is already origin-relative (subtracted at the write site
        // above); subtracting again here would double-apply the offset and drop the
        // collider a whole chunk's origin away from the mesh.
        for (let q0 = 0; q0 < sCount - 1; q0 += COLLIDER_SLAB_QUADS) {
          const q1 = Math.min(q0 + COLLIDER_SLAB_QUADS, sCount - 1);
          const slabVertices = positions.subarray(q0 * latCount * 3, (q1 + 1) * latCount * 3);
          const slabIndices = new Uint32Array((q1 - q0) * (latCount - 1) * 6);
          let si2 = 0;
          for (let si = q0; si < q1; si++) {
            for (let li = 0; li < latCount - 1; li++) {
              const a = (si - q0) * latCount + li;
              const b = a + latCount;
              const c = a + 1;
              const d = b + 1;
              slabIndices[si2++] = a;
              slabIndices[si2++] = b;
              slabIndices[si2++] = c;
              slabIndices[si2++] = b;
              slabIndices[si2++] = d;
              slabIndices[si2++] = c;
            }
          }
          const collider = physics.addStaticTrimesh(slabVertices, slabIndices, surface);
          collider.setEnabled(false);
          colliders.push(collider);
          const body = collider.parent();
          if (body) bodies.push(body);
          yield;
        }
      }

      const markings = yield* this.buildMarkingsSteps(
        road, sStart, sEnd, sCount, laneBase, ox, oz,
      );
      if (markings) {
        disposables.push(markings.geometry);
        group.add(markings);
      }
      yield;

      // The trimeshes are created disabled and switched on by ChunkStreamer once the
      // whole contribution is attached (see ChunkContent.colliders).
      completed = true;
      return {
        group,
        bodies,
        colliders,
        dispose: () => {
          for (const g of disposables) g.dispose();
        },
      };
    } finally {
      if (!completed) {
        for (const body of bodies) physics.removeBody(body);
        for (const g of disposables) g.dispose();
        group.removeFromParent();
        group.clear();
      }
    }
  }

  /**
   * Wears the lane colour at one vertex: polished wheel paths, dust on the crown and
   * verge side, a ravelled outer edge, and coarse tonal mottling on top. See the
   * WHEEL_PATH_* block for why these three and not others.
   *
   * Everything scales with `decay` in the direction the desert takes it: an
   * abandoned road loses its polished tracks (nothing drives it) and gains dust.
   */
  private weather(
    color: THREE.Color,
    gravel: THREE.Color,
    s: number,
    lateral: number,
    a: number,
    decay: number,
  ): void {
    // Distance to the nearest wheel path, as a 0..1 strength across its half-width.
    let track = 0;
    for (const centre of WHEEL_PATH_LATERALS) {
      const t = 1 - Math.min(1, Math.abs(lateral - centre) / WHEEL_PATH_HALF);
      if (t > track) track = t;
    }
    const smoothTrack = track * track * (3 - 2 * track);
    // Traffic thins out as the road dies, so the tracks fade with decay.
    const polish = smoothTrack * WHEEL_PATH_DARKEN * (1 - decay * 0.7);
    const dust = (1 - smoothTrack) * DUST_LIGHTEN * (0.5 + decay);

    color.multiplyScalar(1 - polish + dust);
    if (dust > 0) color.lerp(gravel, dust * DUST_TINT);

    // Ravelled edge: the mat frays into the verge rather than ending at a line.
    const intoEdge = 1 - Math.min(1, (HW - a) / EDGE_RAVEL);
    if (intoEdge > 0) {
      const t = intoEdge * intoEdge;
      color.lerp(gravel, t * EDGE_RAVEL_MIX * (0.6 + decay * 0.4));
    }

    // Coarse mottling: patchy pours and old repairs at a scale the tiled texture
    // cannot carry, since the tile repeats every ROAD_TILE_METRES.
    const mottle = this.mottleNoise.fbm(
      s / MOTTLE_WAVELENGTH,
      lateral / MOTTLE_WAVELENGTH,
      2,
      2.1,
      0.5,
    );
    color.multiplyScalar(1 + mottle * MOTTLE_AMOUNT * (0.7 + decay));
  }

  private *buildMarkingsSteps(
    road: Road,
    sStart: number,
    sEnd: number,
    sCount: number,
    laneBase: THREE.Color | null,
    ox: number,
    oz: number,
  ): Generator<void, THREE.Mesh | null> {
    let geometry: THREE.BufferGeometry | null = null;
    let completed = false;

    try {
      const positions: number[] = [];
      const colors: number[] = [];
      const point = { x: 0, y: 0, z: 0 };
      const color = new THREE.Color();

      // Marking quads are emitted per surface step (not per node) so their corners
      // coincide with mesh vertices — a quad spanning a pothole or bump would
      // otherwise float or cut through the road surface between its corners.
      //
      // Coverage is per quad rather than per chunk: paint does not fade uniformly, it
      // survives in patches and is scrubbed off entirely where the traffic and the sand
      // have worked on it. A quad below PAINT_GONE is not drawn at all, which leaves the
      // gaps and half-dashes that say nobody has repainted this in decades.
      for (let si = 0; si < sCount - 1; si++) {
        const s = sStart + (si * (sEnd - sStart)) / (sCount - 1);
        const markings = roadConditionAt(s).markings;
        if (markings >= MARKING_MIN) {
          for (const line of MARKING_LINES) {
            // Dashes are 4 m on / 4 m off; skip the odd 4 m blocks.
            if (line.dashed && ((si / SUB_DIVISIONS) | 0) & 1) continue;
            // Each line wears independently: the offset separates their noise streams.
            const wear = this.paintNoise.fbm(
              (s + line.lateral * 130) / PAINT_WEAR_WAVELENGTH,
              2,
              2.3,
              0.5,
            );
            const coverage = markings * (0.72 + wear * 0.55);
            if (coverage < PAINT_GONE) continue;
            // `laneBase` is null only for a gravel road, which has `markings` 0 at every
            // step and so never reaches here.
            color.lerpColors(laneBase!, PAINT_LINEAR, Math.min(1, coverage));
            this.emitMarkingQuad(
              road, line.lateral, s, s + SURFACE_STEP,
              ox, oz, point, color, positions, colors,
            );
          }
        }
        yield;
      }

      if (positions.length === 0) {
        completed = true;
        return null;
      }

      geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(positions), 3));
      geometry.setAttribute('color', new THREE.BufferAttribute(Float32Array.from(colors), 3));
      const normals = new Float32Array(positions.length);
      for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
      geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
      const markings = new THREE.Mesh(geometry, markingMaterial);
      // Keep painted lines inside the same vehicle shadow as the lane beneath them;
      // otherwise their lifted quads remain bright and visually cut holes through it.
      markings.receiveShadow = true;
      completed = true;
      return markings;
    } finally {
      if (!completed) geometry?.dispose();
    }
  }

  private emitMarkingQuad(
    road: Road,
    lateral: number,
    s0: number,
    s1: number,
    ox: number,
    oz: number,
    point: { x: number; y: number; z: number },
    color: THREE.Color,
    positions: number[],
    colors: number[],
  ): void {
    const l0 = lateral - MARKING_HALF_WIDTH;
    const l1 = lateral + MARKING_HALF_WIDTH;
    // Four corners [c00, c01, c10, c11]; emit triangles c00,c10,c01 and c10,c11,c01.
    this.markingCorner(road, s0, l0, ox, oz, point);
    const x00 = point.x; const y00 = point.y; const z00 = point.z;
    this.markingCorner(road, s0, l1, ox, oz, point);
    const x01 = point.x; const y01 = point.y; const z01 = point.z;
    this.markingCorner(road, s1, l0, ox, oz, point);
    const x10 = point.x; const y10 = point.y; const z10 = point.z;
    this.markingCorner(road, s1, l1, ox, oz, point);
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
    s: number,
    lateral: number,
    ox: number,
    oz: number,
    out: { x: number; y: number; z: number },
  ): void {
    // Absolute in, relative out: `roadSurfaceY` feeds the surface field's 2D bump
    // noise with this point's world position, so it must see the absolute x/z. The
    // subtraction happens only after the height is resolved, on the way into the
    // marking's Float32Array.
    road.offsetPoint(s, lateral, out);
    out.y = roadSurfaceY(road, this.field, s, lateral, out.x, out.z) + MARKING_LIFT;
    out.x -= ox;
    out.z -= oz;
  }
}
