import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { Noise1D, Noise2D } from '../core/rng';
import { SurfaceType, SURFACES } from '../core/surfaces';
import { ROAD_TILE_METRES, roadTextures } from '../render/roadtexture';
import { applyGroundSpotlightNormals } from '../render/comic';
import { desertPaletteAt, roadConditionAt } from './gradient';
import { ROAD_HALF_WIDTH, type Road } from './road';
import { LANE_WIDTH, laneHalfWidthFor, laneOffsetFor } from './roadprofile';
import { SUB_DIVISIONS, SURFACE_STEP, SurfaceField, roadSurfaceY } from './roadsurface';
import type { ChunkContent, ChunkContext, ChunkProvider } from './chunks';

/**
 * The asphalt ribbon, banked into corners and displaced by a layered surface field —
 * broad undulation, wheel-scale bumps, broken edges and discrete potholes. The desert
 * terrain begins directly beneath each asphalt edge. Surface type owns ordinary bump
 * amplitude; decay increases undulation, edge breakup and pothole occurrence. The
 * same vertices feed the visible mesh and trimesh collider, so the car feels the
 * shape the driver sees.
 */

const HW = ROAD_HALF_WIDTH;

/**
 * Cross-section lateral offsets, left to right. The narrow and open templates have
 * exactly the same count, so quad strips and collider slabs cannot tear in a taper.
 * The narrow literals preserve the old ribbon bit-for-bit; the wide literals retain
 * dense wheel/edge samples and hit the outer pothole catalogue's fixed laterals.
 */
const SECTION_LATERALS: readonly number[] = [
  -HW, -2.45, -2, -1.65, -1.2, -0.85, -0.4,
  0,
  0.4, 0.85, 1.2, 1.65, 2, 2.45, HW,
];
const WIDE_SECTION_LATERALS: readonly number[] = [
  -5.8, -5.25, -4.85, -4.05, -3.25, -2.45, -0.85,
  0,
  0.85, 2.45, 3.25, 4.05, 4.85, 5.25, 5.8,
];

function sectionLateral(halfWidth: number, column: number): number {
  const narrowLateral = SECTION_LATERALS[column]!;
  if (halfWidth === HW) return narrowLateral;
  const wideLateral = WIDE_SECTION_LATERALS[column]!;
  if (halfWidth === HW * 2) return wideLateral;
  // The outer lane's own half-width is the added asphalt. Interpolating its
  // lane-defined taper between fixed endpoint templates preserves the column count
  // while letting terrain's outer-lane potholes land on real mesh vertices.
  const widening = laneHalfWidthFor(halfWidth, 1) / laneHalfWidthFor(HW * 2, 1);
  return narrowLateral + (wideLateral - narrowLateral) * widening;
}

/**
 * Longitudinal rows of quads per collider slab.
 *
 * The visible ribbon is one mesh, but its collider is built in slabs so no single
 * `RAPIER.ColliderDesc.trimesh` call — an uninterruptible native BVH build — can
 * own a frame. Fifteen rows is ~540 triangles, about a millisecond, which fits
 * inside the streaming scheduler's slice with room for the surrounding work.
 */
const COLLIDER_SLAB_QUADS = 15;
/**
 * Rendered depth of the sealed mat. The terrain overlaps the upper edge, while this
 * skirt continues well below it so low viewpoints never expose a zero-thickness sheet.
 */
const ROAD_BED_DEPTH = 0.35;

const MARKING_LIFT = 0.002;
const MARKING_HALF_WIDTH = 0.12;
const MARKING_MIN = 0.03;

/**
 * Weathering of the driving surface, as three things a photograph of an old road
 * shows and this road did not.
 *
 *  1. WHEEL PATHS. Tyres polish two strips per lane and grind dust out of them.
 *     Each lane supplies its own pair, so opening a lane extends the traffic story
 *     rather than scaling narrow-road tracks across empty asphalt.
 *  2. A DUSTY CROWN AND ROAD EDGE. Between the wheel paths and out at the edges
 *     nothing sweeps the surface, so wind-blown dust settles and bitumen bleaches.
 *  3. DIRT AT THE EDGE OF THE MAT. The outer half metre ravels into the verge before
 *     the asphalt ends rather than stopping in a hard visual line.
 *
 * All three are applied to the vertex colour, on top of the tiled asphalt texture
 * (render/roadtexture.ts) that carries aggregate, cracks and patches.
 */
/**
 * The inherited polished pair is centred 0.2 m outward of each nominal lane centre:
 * it preserves the narrow road's ±0.85/±2.45 m tracks while carrying that real-world
 * camber bias into every added lane.
 */
const WHEEL_TRACK_LANE_BIAS = 0.2;
/** A 1.6 m tyre track places each path 0.8 m either side of its lane centre. */
const WHEEL_TRACK_HALF = 0.8;
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
 * row's vertices so no palette lookup allocates. Gravel tints weathered asphalt;
 * sand colours wind-blown cover at the edge.
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
/** Dark, weathered aggregate exposed only where the sand falls below the mat edge. */
const roadBedMaterial = applyGroundSpotlightNormals(
  new THREE.MeshStandardMaterial({
    color: 0x25231f,
    roughness: 1,
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

/** Shared road finish for small paved features outside the ribbon. */
export function roadAsphaltMaterial(): THREE.MeshStandardMaterial {
  attachRoadTextures();
  return roadMaterial;
}

/** Texture-brightness-corrected vertex colour for the road's start condition. */
export function roadAsphaltVertexColorAtStart(out: THREE.Color): THREE.Color {
  attachRoadTextures();
  return out.copy(SURFACE_LINEAR[roadConditionAt(0).surface]!).multiplyScalar(textureGain);
}

const markingMaterial = applyGroundSpotlightNormals(
  new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.94,
    metalness: 0,
    // Markings sit 2 mm above the road: enough to avoid coplanar depth fighting
    // while remaining visually flush with the asphalt under a tyre.
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  }),
);

/** Fraction of sand covering a point at |lateral| = a, given sandCover (0..1). */
function sandFactor(a: number, halfWidth: number, sandCover: number): number {
  if (sandCover <= 0) return 0;
  const tip = halfWidth * (1 - sandCover);
  if (a <= tip) return 0;
  if (a >= halfWidth) return 1;
  return (a - tip) / (halfWidth - tip);
}

interface MarkingLine {
  readonly kind: 'edge' | 'crown' | 'divider';
  readonly dashed: boolean;
}

const MARKING_LINES: readonly MarkingLine[] = [
  { kind: 'edge', dashed: false },
  { kind: 'crown', dashed: true },
  { kind: 'divider', dashed: true },
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
    const latCount = SECTION_LATERALS.length;
    // One surface type per chunk drives the collider friction profile. Visual colour
    // is sampled per row below because a material-district boundary can cross a chunk.
    const surface = roadConditionAt((sStart + sEnd) / 2).surface;

    const sCount = Math.round((sEnd - sStart) / SURFACE_STEP) + 1;
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
      // Keep texture coordinates close to zero before they enter Float32. Using
      // absolute `s / tile` loses the fractional UV at long-distance road positions:
      // the aggregate then advances in visible blocks as the camera moves, which looks
      // exactly like heat haze on high-contrast gravel. The modulo preserves the
      // world-space tile phase; the local delta remains continuous through this chunk.
      const textureVStart =
        (((sStart % ROAD_TILE_METRES) + ROAD_TILE_METRES) % ROAD_TILE_METRES) /
        ROAD_TILE_METRES;

      for (let si = 0; si < sCount; si++) {
        // Endpoint-exact rows: si * (sEnd - sStart) / (sCount - 1) makes the shared
        // boundary row bit-identical in both neighbours, keeping the seam watertight
        // at the denser resolution.
        const s = sStart + (si * (sEnd - sStart)) / (sCount - 1);
        // Every consumer of this row gets this one local width. In particular the
        // collider is indexed from these same fixed-count rows as the visible mat.
        const halfWidth = road.halfWidthAt(s);
        const cond = roadConditionAt(s);
        const laneBase = SURFACE_LINEAR[cond.surface] ?? null;
        // Palette colour is a function of arclength alone: sample once per row, so
        // neighbouring chunks share the seam row and a rebuild is identical.
        const palette = desertPaletteAt(s);
        sandLinear.setHex(palette.sand);
        gravelLinear.setHex(palette.gravel);

        for (let li = 0; li < latCount; li++) {
          const lateral = sectionLateral(halfWidth, li);
          road.offsetPoint(s, lateral, point);
          // Shared height function: the desert terrain adopts this exact surface at
          // the asphalt edge, so the two meshes stay flush.
          const y = roadSurfaceY(road, this.field, s, lateral, point.x, point.z);

          const vi = si * latCount + li;
          positions[vi * 3] = point.x - ox;
          positions[vi * 3 + 1] = y;
          positions[vi * 3 + 2] = point.z - oz;

          // Absolute lateral / 24 m is world-scale texture space: widening neither
          // stretches aggregate nor bakes lane paint into this texture.
          uvs[vi * 2] = lateral / ROAD_TILE_METRES;
          uvs[vi * 2 + 1] = textureVStart + (s - sStart) / ROAD_TILE_METRES;

          const a = Math.abs(lateral);
          color.lerpColors(
            laneBase ?? gravelLinear,
            sandLinear,
            sandFactor(a, halfWidth, cond.sandCover),
          );
          this.weather(color, gravelLinear, s, lateral, a, halfWidth, cond.decay);
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
      // The road uses the same upward lighting basis as the desert. Actual slope
      // normals made it read as a dark shadow strip on grades.
      const normals = new Float32Array(positions.length);
      for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
      geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));

      const roadMesh = new THREE.Mesh(geometry, roadMaterial);
      // The whole asphalt surface receives the same vehicle contact shadow as the
      // surrounding desert without casting into the map.
      roadMesh.receiveShadow = true;
      group.add(roadMesh);

      // Close both open edges down into the terrain. This is deliberately visual-only:
      // tyres still collide with the exact top ribbon, and the skirt remains buried
      // wherever the sand meets the asphalt at its intended height.
      const bedPositions = new Float32Array(sCount * 4 * 3);
      const bedIndices = new Uint32Array((sCount - 1) * 12);
      for (let si = 0; si < sCount; si++) {
        const rightTop = si * latCount;
        const leftTop = rightTop + latCount - 1;
        const row = si * 12;

        bedPositions[row] = positions[rightTop * 3]!;
        bedPositions[row + 1] = positions[rightTop * 3 + 1]!;
        bedPositions[row + 2] = positions[rightTop * 3 + 2]!;
        bedPositions[row + 3] = bedPositions[row]!;
        bedPositions[row + 4] = bedPositions[row + 1]! - ROAD_BED_DEPTH;
        bedPositions[row + 5] = bedPositions[row + 2]!;

        bedPositions[row + 6] = positions[leftTop * 3]!;
        bedPositions[row + 7] = positions[leftTop * 3 + 1]!;
        bedPositions[row + 8] = positions[leftTop * 3 + 2]!;
        bedPositions[row + 9] = bedPositions[row + 6]!;
        bedPositions[row + 10] = bedPositions[row + 7]! - ROAD_BED_DEPTH;
        bedPositions[row + 11] = bedPositions[row + 8]!;
      }
      let bi = 0;
      for (let si = 0; si < sCount - 1; si++) {
        const row = si * 4;
        const next = row + 4;
        // Negative-lateral edge: outward normal points right.
        bedIndices[bi++] = row;
        bedIndices[bi++] = row + 1;
        bedIndices[bi++] = next;
        bedIndices[bi++] = next;
        bedIndices[bi++] = row + 1;
        bedIndices[bi++] = next + 1;
        // Positive-lateral edge: outward normal points left.
        bedIndices[bi++] = row + 2;
        bedIndices[bi++] = next + 2;
        bedIndices[bi++] = row + 3;
        bedIndices[bi++] = next + 2;
        bedIndices[bi++] = next + 3;
        bedIndices[bi++] = row + 3;
      }
      const bedGeometry = new THREE.BufferGeometry();
      disposables.push(bedGeometry);
      bedGeometry.setAttribute('position', new THREE.BufferAttribute(bedPositions, 3));
      bedGeometry.setIndex(new THREE.BufferAttribute(bedIndices, 1));
      bedGeometry.computeVertexNormals();
      const bedMesh = new THREE.Mesh(bedGeometry, roadBedMaterial);
      bedMesh.receiveShadow = true;
      group.add(bedMesh);
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
        road, sStart, sEnd, sCount, ox, oz,
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
    halfWidth: number,
    decay: number,
  ): void {
    let track = 0;
    if (halfWidth === HW) {
      // Keep the original literal centres, rather than reconstructing them through
      // arithmetic, so the narrow road's weather field remains bit-identical.
      for (const centre of [-2.45, -0.85, 0.85, 2.45]) {
        const t = 1 - Math.min(1, Math.abs(lateral - centre) / WHEEL_PATH_HALF);
        if (t > track) track = t;
      }
    } else {
      for (const side of [-1, 1]) {
        for (let lane = 0; lane < 2; lane++) {
          const centre = side * (laneOffsetFor(halfWidth, lane) + WHEEL_TRACK_LANE_BIAS);
          for (const wheel of [-WHEEL_TRACK_HALF, WHEEL_TRACK_HALF]) {
            const t = 1 - Math.min(1, Math.abs(lateral - (centre + wheel)) / WHEEL_PATH_HALF);
            if (t > track) track = t;
          }
        }
      }
    }
    const smoothTrack = track * track * (3 - 2 * track);
    const polish = smoothTrack * WHEEL_PATH_DARKEN * (1 - decay * 0.7);
    const dust = (1 - smoothTrack) * DUST_LIGHTEN * (0.5 + decay);

    color.multiplyScalar(1 - polish + dust);
    if (dust > 0) color.lerp(gravel, dust * DUST_TINT);

    // Ravelled edge: the mat frays into the verge rather than ending at a line.
    const intoEdge = 1 - Math.min(1, (halfWidth - a) / EDGE_RAVEL);
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

      // Marking quads are emitted per surface step so their corners coincide with
      // mesh vertices rather than floating across a bump or pothole.
      for (let si = 0; si < sCount - 1; si++) {
        const s = sStart + (si * (sEnd - sStart)) / (sCount - 1);
        const s1 = s + SURFACE_STEP;
        const condition = roadConditionAt(s);
        const laneBase = SURFACE_LINEAR[condition.surface];
        if (condition.markings >= MARKING_MIN && laneBase) {
          const halfWidth0 = road.halfWidthAt(s);
          const halfWidth1 = road.halfWidthAt(s1);
          for (const line of MARKING_LINES) {
            // Keep the old crown cadence exactly. The dividers use their own two-metre
            // phase and only paint a complete step inside an on dash, never a stretched
            // half dash. They also require both ends to be genuinely two-lane.
            const dividerOn0 = (Math.floor((s + 2) / 8) & 1) === 0;
            const dividerOn1 = (Math.floor((s1 + 2) / 8) & 1) === 0;
            if (line.kind === 'crown' && ((si / SUB_DIVISIONS) | 0) & 1) continue;
            if (
              line.kind === 'divider' &&
              (!dividerOn0 || !dividerOn1 ||
                road.lanesPerSideAt(s) !== 2 || road.lanesPerSideAt(s1) !== 2)
            ) continue;

            const laterals: readonly [number, number][] =
              line.kind === 'edge'
                ? [
                  [-(halfWidth0 - MARKING_HALF_WIDTH), -(halfWidth1 - MARKING_HALF_WIDTH)],
                  [halfWidth0 - MARKING_HALF_WIDTH, halfWidth1 - MARKING_HALF_WIDTH],
                ]
                : line.kind === 'divider'
                  ? [[-LANE_WIDTH, -LANE_WIDTH], [LANE_WIDTH, LANE_WIDTH]]
                  : [[0, 0]];
            for (const [lateral0, lateral1] of laterals) {
              const wear = this.paintNoise.fbm(
                (s + lateral0 * 130) / PAINT_WEAR_WAVELENGTH,
                2,
                2.3,
                0.5,
              );
              const coverage = condition.markings * (0.72 + wear * 0.55);
              if (coverage < PAINT_GONE) continue;
              color.lerpColors(laneBase, PAINT_LINEAR, Math.min(1, coverage));
              this.emitMarkingQuad(
                road, lateral0, lateral1, s, s1,
                ox, oz, point, color, positions, colors,
              );
            }
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
      markings.receiveShadow = true;
      completed = true;
      return markings;
    } finally {
      if (!completed) geometry?.dispose();
    }
  }

  private emitMarkingQuad(
    road: Road,
    lateral0: number,
    lateral1: number,
    s0: number,
    s1: number,
    ox: number,
    oz: number,
    point: { x: number; y: number; z: number },
    color: THREE.Color,
    positions: number[],
    colors: number[],
  ): void {
    const l00 = lateral0 - MARKING_HALF_WIDTH;
    const l01 = lateral0 + MARKING_HALF_WIDTH;
    const l10 = lateral1 - MARKING_HALF_WIDTH;
    const l11 = lateral1 + MARKING_HALF_WIDTH;
    // Four corners [c00, c01, c10, c11]; emit triangles c00,c10,c01 and c10,c11,c01.
    this.markingCorner(road, s0, l00, ox, oz, point);
    const x00 = point.x; const y00 = point.y; const z00 = point.z;
    this.markingCorner(road, s0, l01, ox, oz, point);
    const x01 = point.x; const y01 = point.y; const z01 = point.z;
    this.markingCorner(road, s1, l10, ox, oz, point);
    const x10 = point.x; const y10 = point.y; const z10 = point.z;
    this.markingCorner(road, s1, l11, ox, oz, point);
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
