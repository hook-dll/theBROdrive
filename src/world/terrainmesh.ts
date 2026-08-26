import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { SurfaceType } from '../core/surfaces';
import { applyComicShading } from '../render/comic';
import { NODE_SPACING, type Road } from './road';
import { RoadDistance } from './roaddistance';
import { BERM_CREST, BERM_FADE, BERM_START, CORRIDOR_INNER, type Terrain } from './terrain';
import { CHUNK_LENGTH, type ChunkContent, type ChunkContext, type ChunkProvider } from './chunks';
import { desertPaletteAt } from './gradient';

/**
 * Desert either side of the road.
 *
 * One road-aligned (s, lateral) grid serves as both the visible mesh and — out to
 * `PHYSICS_LATERAL` — the collider, so what you see is exactly what the wheels
 * feel, with no second sampling pass and no seam between a physics surface and a
 * drawn one. Lateral spacing grows geometrically: metres at the verge, hundreds of
 * metres at the horizon, which is what lets the vista reach kilometres for a few
 * hundred triangles.
 *
 * The bands, outward from the centreline:
 *   - to `PHYSICS_LATERAL`: drawn and solid. Fine at the verge, progressively
 *     coarser, and (see `terrain.ts`) progressively steeper past
 *     `HOSTILE_LATERAL_START`, so leaving the road becomes hard work rather than
 *     hitting an invisible wall.
 *   - to `FAR_LATERAL`: drawn only. Distant landscape; nothing to collide with out
 *     there because nothing can reach it.
 * Beyond that the fog ramp (main.ts) and the sky dome close the view.
 */

/**
 * How far out this mesh reaches, each side of the road. Chosen against the fog: at the
 * default view distance nothing beyond it resolves, so drawing further only costs
 * triangles on a weak GPU. Exported because the vista starts where this stops, and
 * because a view distance no larger than this needs no vista at all.
 */
export const NEAR_TERRAIN_REACH = 1500;
/**
 * How far out the ground is solid, each side of the road. The berm turns genuinely
 * unclimbable before this, so the edge is reached by choice, not by surprise — and
 * `main.ts` catches anything that gets past it anyway.
 */
const PHYSICS_LATERAL = 600;
/** Lateral spacing growth factor; resolution falls off away from the road. */
const LATERAL_RATIO = 1.35;
/** Visible mesh sampling step along the road. Must divide CHUNK_LENGTH. */
const S_STEP = 8;
/** Terrain tucks 8 cm below the shoulder, covering numerical seam cracks. */
const ROAD_SEAM_OVERLAP = 0.08;
const TERRAIN_INNER = CORRIDOR_INNER - ROAD_SEAM_OVERLAP;
/** Keep overlapped terrain below the road ribbon to prevent z-fighting. */
const ROAD_SEAM_DROP = 0.015;

/**
 * The one surface every terrain collider registers, and the only place in the world
 * that registers it.
 *
 * A chunk's fan spans gravel verge, sand and rock outcrops, but it is ONE trimesh, so
 * the registry can only hold one answer for it. Sand is that answer, and the desert
 * is mostly sand, so traction is right almost everywhere. Anything that needs the
 * real material at a point asks `Terrain.surfaceFromFrame` instead — the wheel spray
 * does exactly that, and it recognises "this contact is terrain, not road or scenery"
 * by comparing against this constant. Register it anywhere else and the spray will
 * treat that collider as open desert.
 */
export const TERRAIN_COLLIDER_SURFACE = SurfaceType.Sand;

/**
 * Ring spacing across the berm's face, metres. It climbs its 22 m over 70 m of lateral
 * distance, so this puts three rings on the face; at the unconstrained geometric spacing
 * out there the whole thing would be one facet and a 31-degree wall would draw as a
 * gentle ramp.
 */
const BERM_RING_SPACING = 24;
/**
 * Ring spacing across the berm's back, out to where it has faded away. Coarser than the
 * face — nothing past the crest is drivable — but still capped, because the fade is the
 * part that has to read as the back of a bank rather than as a step.
 */
const BERM_BACK_RING_SPACING = 90;
/**
 * Ring spacing from there out to this mesh's own draw distance. Everything past
 * FAR_LATERAL belongs to the vista (render/vista.ts), which has its own, much coarser,
 * rings.
 */
const OUTER_RING_SPACING = 150;

/**
 * Fold guard for road-relative terrain.
 *
 * A lateral row offsets each road sample along that sample's normal. On a curve,
 * normals converge on the inside and diverge on the outside; far enough away the
 * inside offset reaches a cusp and runs BACKWARDS. Indexing across that cusp makes
 * a kilometres-wide inverted triangle that sweeps over the road and closes the sky
 * as chunks stream.
 *
 * Valid longitudinal edges must still point along the centreline tangent and may
 * not grow absurdly relative to the centre row's own step. Both tests are derived
 * from the generated geometry, so they are independent of seed and kilometre.
 */
const FOLD_MIN_FORWARD_COS = 0.04;
const FOLD_MAX_EDGE_RATIO = 18;

/**
 * One piece of ground, one height.
 *
 * The fold guard above only makes a chunk's own fan locally one-to-one. It cannot
 * see the real problem, which is GLOBAL: every chunk fans terrain out to
 * FAR_LATERAL either side of ITS OWN 200 m of road, the streamer keeps chunks alive
 * 1200 m of road each way, and the road turns on radii as tight as 170 m. So chunks
 * routinely fan across each other — and a chunk's height at a point used to be
 * anchored to ITS centreline and ITS lateral offset, so the same ground got two
 * answers, differing by the rim term (78 m) plus the hill each frame sat on. The
 * loser hangs in the air: those were the brown beams, lines and slabs in the
 * mid-distance, and no amount of tuning the rim profile could remove them, because
 * the height field simply was not a function of position.
 *
 * It is one now. `Terrain.openHeight` is the landscape field plus dune relief plus
 * the world's edge, and only that edge needs anything road-relative at all: the
 * distance to the nearest branch. So what this provider still owes the desert is much
 * smaller than it was — a distance, not an elevation — and the two-branch height blend
 * that used to ramp between two passes' altitudes is gone with the altitudes. The
 * distance itself now lives in `RoadDistance`, shared with the vista mesh, because the
 * two must agree about it or the horizon has a seam in it.
 *
 * Two rules remain, and both are needed:
 *
 *  1. GLOBAL SEARCH, ABSOLUTE LATTICE. Both properties live in `RoadDistance` and both
 *     are load-bearing: a per-chunk window gave each chunk a different "nearest" for
 *     the same ground (the branch nearest a patch of desert is routinely kilometres
 *     away in arclength), and a per-chunk lattice let two chunks round the same point
 *     differently.
 *  2. BOUNDED OWNERSHIP. A cell yields to a chunk within OWN_YIELD_CHUNKS that is
 *     genuinely nearer, so coincident sheets are not drawn twice — but never to one
 *     further away than that, because the streamer's window would not contain it and
 *     the ground would go undrawn. That mistake looks like pale wedges with sky
 *     behind them; it is the same artefact reached from the other side.
 *
 * The near-road frame path is kept and cross-faded into the world path over
 * WORLD_HEIGHT_START..FULL. Inside the corridor the shoulder vertex MUST equal the
 * road ribbon's own vertex at that exact `s`, which only the frame knows; past 30 m
 * the two paths are the same arithmetic (the berm is zero that close in), so the fade
 * is between values that agree, and it stays as the guarantee that they must.
 */
/** Lateral offset where height starts blending from frame-derived to position-derived. */
const WORLD_HEIGHT_START = 30;
/** Lateral offset past which height is purely a function of world position. */
const WORLD_HEIGHT_FULL = 60;
/**
 * Spacing of the absolute world lattice this provider reads the nearest-branch distance
 * on, metres. Small enough that the berm's own rise is captured (140 m of lateral
 * distance), large enough that a chunk's 3 km fan costs a few hundred searches. The
 * vista asks the same field for a much coarser one.
 */
const DIST_LATTICE = 50;
/**
 * Slack in the ownership test, metres. Sized against the lattice the owner comes from,
 * for the reason the OWN_TOLERANCE comment below gives.
 */
const OWN_SAMPLE_STEP = 20;
/**
 * How many chunks away, in arclength, a cell may yield ownership to. Small, because
 * the streamer only keeps a window of chunks around the camera: yielding outside
 * that window leaves nothing drawn at all.
 */
const OWN_YIELD_CHUNKS = 2;
/**
 * Slack in the ownership test, metres.
 *
 * A cell also keeps its ground when its OWN row is as near as the best lattice
 * sample, within a lattice step. Without this the cell straddling a chunk boundary
 * resolves to the neighbour's first sample and both chunks drop it, which drew a
 * bare strip across the whole desert every 200 m.
 */
const OWN_TOLERANCE = OWN_SAMPLE_STEP * 0.75;

/**
 * Palette scratch colours, reused for every arclength row so a palette lookup
 * never allocates. The desert's sand, rock and gravel albedos come from
 * `desertPaletteAt` rather than the static `SURFACES` table, so they track the
 * colour cycle; asphalt, cracked asphalt and concrete never appear on terrain.
 */
const sandLinear = new THREE.Color();
const rockLinear = new THREE.Color();
const gravelLinear = new THREE.Color();

/**
 * Keep comic contours and stipple, but leave diffuse light and shadow colour untouched so
 * the desert responds to lamps and moonlight exactly like the road.
 *
 * Exported because the vista mesh draws the same ground and must therefore be the same
 * material: a second one, however carefully matched, drifts the moment either is tuned,
 * and the seam between near desert and far desert is the one place a mismatch is obvious.
 */
export const TERRAIN_MATERIAL = applyComicShading(
  new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.93,
    metalness: 0,
  }),
  { lightingStrength: 0, shadowWarmth: 0 },
);

/**
 * One chunk's terrain grid: the drawn mesh plus the raw grid it was built from, so
 * the collider can be indexed straight off the same vertices.
 */
interface BuiltTerrain {
  readonly group: THREE.Group;
  readonly geometry: THREE.BufferGeometry;
  /** Interleaved xyz, row-major: `positions[(si * laterals.length + li) * 3]`. */
  readonly positions: Float32Array;
  /** Signed lateral offset of each grid column, ascending. */
  readonly laterals: readonly number[];
  readonly sCount: number;
  /**
   * One byte per visual grid cell: 1 when both longitudinal edges stay
   * forward-facing and bounded, 0 when the road-normal parameterisation folded.
   * Reused by the collider so drawn and solid terrain cannot disagree.
   */
  readonly validCells: Uint8Array;
  /** True for chunks off either end of the road, where there is no road quad. */
  readonly isApron: boolean;
}

export class TerrainMeshProvider implements ChunkProvider {
  readonly id = 'terrain';

  /**
   * The shared nearest-road-distance field. Injected rather than owned, because the
   * vista mesh reads the same one: two independent copies would index the road twice
   * and, worse, could round the same ground differently.
   */
  constructor(private readonly roadDistance: RoadDistance) {}

  /**
   * Desert height at a world position: `Terrain.openHeight` with the nearest-branch
   * distance interpolated off the lattice. A pure function of x and z, which is what
   * makes every chunk agree.
   */
  private worldHeight(terrain: Terrain, x: number, z: number): number {
    return terrain.openHeight(x, z, this.roadDistance.distAt(x, z, DIST_LATTICE));
  }

  build(ctx: ChunkContext): ChunkContent | null {
    // Every chunk owns a full CHUNK_LENGTH span, even outside the road: the
    // negative and past-end chunks are the desert apron. `ctx.sStart`/`ctx.sEnd`
    // are clamped to the road and therefore empty out there, so derive the span
    // from the chunk index instead.
    const sStart = ctx.chunkIndex * CHUNK_LENGTH;
    const sEnd = (ctx.chunkIndex + 1) * CHUNK_LENGTH;

    const built = this.buildVisual(ctx, sStart, sEnd);
    const bodies: RAPIER.RigidBody[] = [];
    const colliders: RAPIER.Collider[] = [];

    if (ctx.hasPhysics) {
      this.addCollider(ctx, built, bodies, colliders);
    }

    return { group: built.group, bodies, colliders, dispose: () => built.geometry.dispose() };
  }

  /**
   * Terrain-sampling offset from the road centreline.
   *
   * `Road.offsetPoint` clamps `s` to the road's extent, which would collapse every
   * apron sample onto the boundary frame and flatten the apron to nothing. Beyond
   * either end we instead continue the boundary frame linearly — constant heading
   * and height — which is exact for the straight, flat runout behind s = 0 and a
   * deliberate straight continuation past the road's end. In-range this is
   * identical to `road.offsetPoint`.
   */
  private offsetPoint(
    road: Road,
    s: number,
    lateral: number,
    out: { x: number; y: number; z: number },
  ): { x: number; y: number; z: number } {
    const c = road.sampleAt(s);
    const ds = s - c.s;
    out.x = c.x + Math.sin(c.heading) * ds + Math.cos(c.heading) * lateral;
    out.y = c.y;
    out.z = c.z + Math.cos(c.heading) * ds - Math.sin(c.heading) * lateral;
    return out;
  }

  private buildVisual(ctx: ChunkContext, sStart: number, sEnd: number): BuiltTerrain {
    const { road, terrain } = ctx;
    // The floating origin, frozen at build time: every height and surface sample
    // below stays absolute, and the subtraction happens only where a coordinate is
    // written into f32.
    const ox = ctx.originX;
    const oz = ctx.originZ;

    const isApron = sStart < 0 || sEnd > road.length;

    // Geometric lateral rings — metres at the verge, hundreds at the horizon — with
    // two exceptions. `PHYSICS_LATERAL` is forced in as an exact ring so the
    // collider ends on a shared row of vertices (the solid ground and the drawn
    // ground then agree there to the bit rather than meeting mid-quad), and across
    // the rim the spacing is capped: the escarpment climbs 120 m over 350 m of
    // lateral distance, and at the unconstrained spacing out there it would be two
    // facets wide and read as a folded sheet.
    const magnitudes: number[] = [TERRAIN_INNER];
    let m = CORRIDOR_INNER;
    while (m < NEAR_TERRAIN_REACH) {
      const geometric = m * LATERAL_RATIO - m;
      // Three caps, because the berm has three parts: an unclimbable face that must be
      // resolved, a back slope that must not step, and open ground past it that the vista
      // takes over.
      const cap =
        m >= BERM_START - BERM_RING_SPACING && m < BERM_CREST
          ? BERM_RING_SPACING
          : m < BERM_FADE
            ? BERM_BACK_RING_SPACING
            : OUTER_RING_SPACING;
      const step = Math.min(geometric, cap);
      const next = Math.min(m + step, NEAR_TERRAIN_REACH);
      m = m < PHYSICS_LATERAL && next > PHYSICS_LATERAL ? PHYSICS_LATERAL : next;
      if (m - magnitudes[magnitudes.length - 1]! < 1) break;
      magnitudes.push(m);
    }
    if (magnitudes[magnitudes.length - 1]! < NEAR_TERRAIN_REACH) {
      magnitudes.push(NEAR_TERRAIN_REACH);
    }

    const laterals: number[] = [];
    for (let i = magnitudes.length - 1; i >= 0; i--) laterals.push(-magnitudes[i]!);
    for (let i = 0; i < magnitudes.length; i++) laterals.push(magnitudes[i]!);

    const sCount = Math.round((sEnd - sStart) / S_STEP) + 1;
    const latCount = laterals.length;
    const vertexCount = sCount * latCount;

    const positions = new Float32Array(vertexCount * 3);
    const colors = new Float32Array(vertexCount * 3);

    const point = { x: 0, y: 0, z: 0 };

    for (let si = 0; si < sCount; si++) {
      const s = sStart + si * S_STEP;
      // Palette colour is a function of arclength alone, so sample it once per
      // row and reuse it across every lateral column. Neighbouring chunks share
      // the seam row's colour, and a chunk rebuilt after unloading is identical.
      const palette = desertPaletteAt(s);
      sandLinear.setHex(palette.sand);
      rockLinear.setHex(palette.rock);
      gravelLinear.setHex(palette.gravel);
      // Every vertex in the row already knows its own lateral offset, so the terrain
      // never has to project back to the centreline to find its frame.
      for (let li = 0; li < latCount; li++) {
        const lateral = laterals[li]!;
        this.offsetPoint(road, s, lateral, point);
        const vi = si * latCount + li;
        // Terrain overlaps the road's shoulder slightly and samples the same road
        // surface there. The tiny downward bias is beneath the ribbon, closing the
        // floating pixel seam without a coplanar z-fight.
        const absLateral = Math.abs(lateral);
        const blend = Math.min(
          1,
          Math.max(0, (absLateral - WORLD_HEIGHT_START) / (WORLD_HEIGHT_FULL - WORLD_HEIGHT_START)),
        );
        const frameWeight = isApron ? 1 : 1 - blend * blend * (3 - 2 * blend);
        let y: number;
        if (frameWeight >= 1) {
          y = terrain.heightFromFrame(point.x, point.z, lateral, s);
        } else if (frameWeight <= 0) {
          y = this.worldHeight(terrain, point.x, point.z);
        } else {
          const frameY = terrain.heightFromFrame(point.x, point.z, lateral, s);
          const world = this.worldHeight(terrain, point.x, point.z);
          y = world + (frameY - world) * frameWeight;
        }
        if (!isApron && absLateral <= CORRIDOR_INNER) y -= ROAD_SEAM_DROP;
        positions[vi * 3] = point.x - ox;
        positions[vi * 3 + 1] = y;
        positions[vi * 3 + 2] = point.z - oz;

        const surface = terrain.surfaceFromFrame(point.x, point.z, lateral);
        const surfaceColor =
          surface === SurfaceType.Rock ? rockLinear
          : surface === SurfaceType.Gravel ? gravelLinear
          : sandLinear;
        colors[vi * 3] = surfaceColor.r;
        colors[vi * 3 + 1] = surfaceColor.g;
        colors[vi * 3 + 2] = surfaceColor.b;
      }
    }

    /**
     * Mark cells whose road-normal parameterisation is still one-to-one.
     *
     * The tangent is measured at the corridor midpoint (average of the ±inner
     * rings). At every lateral column, the longitudinal edge must point broadly in
     * that same direction and stay within a bounded multiple of its length. Once an
     * inside offset reaches its curvature cusp the dot becomes negative; a far
     * outside edge can instead become hundreds of metres long. Either means the
     * cell is a fold, not terrain, and must have no triangles.
     */
    const validCells = new Uint8Array((sCount - 1) * (latCount - 1));
    const leftCentre = magnitudes.length - 1;
    const rightCentre = magnitudes.length;
    // Read back ABSOLUTE x/z. `positions` is origin-relative now, but the fold test
    // and the ownership lattice both reason about world geometry: the edge/dot tests
    // are differences (offset-invariant), while `ownerAt` is keyed on an absolute
    // lattice and must see the true position. Re-adding the origin keeps both right.
    const xz = (vi: number): readonly [number, number] => [
      positions[vi * 3]! + ox,
      positions[vi * 3 + 2]! + oz,
    ];

    /**
     * Does this chunk own the ground under the cell at (row0..row1, li..li+1)?
     *
     * Judged at the cell centre against the SAME lattice the heights come from: the
     * owning branch's arclength must fall in this chunk's span, half-open so ground
     * resolving exactly to a boundary belongs to the following chunk only. Every
     * chunk asks the same question of the same lattice, so each piece of desert is
     * drawn once and only once — which is what stops distant fans stacking up.
     *
     * The second clause is OWN_TOLERANCE: a cell whose OWN row is as near the ground
     * as the owning branch keeps it regardless. That is what the cell straddling a
     * chunk boundary needs — its centre resolves to the neighbour's first sample, and
     * without the clause neither chunk would draw it and the desert would carry a
     * bare strip every 200 m.
     */
    const ownsCell = (row0: number, row1: number, li: number, rowCentre: readonly [number, number]): boolean => {
      const a = xz(row0 + li);
      const b = xz(row1 + li);
      const c = xz(row0 + li + 1);
      const d = xz(row1 + li + 1);
      const cx = (a[0] + b[0] + c[0] + d[0]) * 0.25;
      const cz = (a[1] + b[1] + c[1] + d[1]) * 0.25;
      const owner = this.roadDistance.ownerAt(cx, cz, DIST_LATTICE);
      if (owner >= sStart && owner < sEnd) return true;
      // Yield ONLY to a neighbour that is certain to be loaded whenever this chunk
      // is. Yielding to a chunk kilometres away in arclength leaves a hole instead of
      // a duplicate: the streamer keeps a window of chunks around the camera, and
      // where the road doubles back the true owner is often outside it. A hole reads
      // as a pale wedge with sky behind it — the same class of artefact by the
      // opposite mistake. Anything further away is simply drawn twice, at the same
      // height, because the distance lattice is absolute.
      const ownerChunk = Math.floor(owner / CHUNK_LENGTH);
      const thisChunk = Math.floor(sStart / CHUNK_LENGTH);
      if (Math.abs(ownerChunk - thisChunk) > OWN_YIELD_CHUNKS) return true;
      const ownerPoint = road.sampleAt(Math.min(Math.max(owner, 0), road.length));
      const best = Math.hypot(cx - ownerPoint.x, cz - ownerPoint.z);
      const own = Math.hypot(cx - rowCentre[0], cz - rowCentre[1]);
      return own <= best + OWN_TOLERANCE;
    };
    for (let si = 0; si < sCount - 1; si++) {
      const row0 = si * latCount;
      const row1 = row0 + latCount;
      const lc0 = xz(row0 + leftCentre);
      const rc0 = xz(row0 + rightCentre);
      const lc1 = xz(row1 + leftCentre);
      const rc1 = xz(row1 + rightCentre);
      const tx = (lc1[0] + rc1[0] - lc0[0] - rc0[0]) * 0.5;
      const tz = (lc1[1] + rc1[1] - lc0[1] - rc0[1]) * 0.5;
      const centreLength = Math.hypot(tx, tz);
      // The cell's own centreline reference: the midpoint of the two rows' road
      // centres, i.e. the road point this cell was actually generated from.
      const rowCentre: readonly [number, number] = [
        (lc0[0] + rc0[0] + lc1[0] + rc1[0]) * 0.25,
        (lc0[1] + rc0[1] + lc1[1] + rc1[1]) * 0.25,
      ];

      const edgeValid = (li: number): boolean => {
        const a = xz(row0 + li);
        const b = xz(row1 + li);
        const ex = b[0] - a[0];
        const ez = b[1] - a[1];
        const length = Math.hypot(ex, ez);
        if (centreLength < 1e-6 || length < 1e-6) return false;
        const forwardCos = (ex * tx + ez * tz) / (length * centreLength);
        return (
          forwardCos >= FOLD_MIN_FORWARD_COS &&
          length <= centreLength * FOLD_MAX_EDGE_RATIO
        );
      };

      for (let li = 0; li < latCount - 1; li++) {
        if (!isApron && !(edgeValid(li) && edgeValid(li + 1))) continue;
        if (!isApron && !ownsCell(row0, row1, li, rowCentre)) continue;
        validCells[si * (latCount - 1) + li] = 1;
      }
    }

    // Index only valid cells. The single quad spanning the road is also skipped
    // in-range, where the road mesh owns it; the apron has no road, so it is filled.
    const index: number[] = [];
    for (let si = 0; si < sCount - 1; si++) {
      for (let li = 0; li < latCount - 1; li++) {
        if (validCells[si * (latCount - 1) + li] === 0) continue;
        const here = laterals[li]!;
        const next = laterals[li + 1]!;
        if (!isApron && here < 0 && next > 0) continue;

        const a = si * latCount + li;
        const b = a + latCount;
        const c = a + 1;
        const d = b + 1;
        index.push(a, b, c, b, d, c);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setIndex(new THREE.BufferAttribute(Uint32Array.from(index), 1));
    geometry.computeVertexNormals();

    return {
      group: new THREE.Group().add(new THREE.Mesh(geometry, TERRAIN_MATERIAL)),
      geometry,
      positions,
      laterals,
      sCount,
      validCells,
      isApron,
    };
  }

  /**
   * Solid ground, built from the visible grid's own vertices out to
   * `PHYSICS_LATERAL`.
   *
   * Reusing the drawn vertices is the whole trick: the collider costs no extra
   * terrain sampling (the expensive part is `heightAt`, already paid), it can never
   * disagree with what is on screen, and because the rings are geometric it is
   * detailed at the verge and cheap far out — a few hundred triangles for 600 m of
   * driveable desert either side. The previous axis-aligned heightfield sampled the
   * terrain a second time on its own 2 m lattice, which cost more than the mesh and
   * still only reached 60 m.
   */
  private addCollider(
    ctx: ChunkContext,
    built: BuiltTerrain,
    bodies: RAPIER.RigidBody[],
    colliders: RAPIER.Collider[],
  ): void {
    const { laterals, positions, sCount, validCells, isApron } = built;
    const latCount = laterals.length;

    // Contiguous block of rings within the solid band; the ring list is sorted and
    // symmetric, so this is a slice, not a filter.
    let first = 0;
    while (first < latCount && laterals[first]! < -PHYSICS_LATERAL) first++;
    let last = latCount - 1;
    while (last > 0 && laterals[last]! > PHYSICS_LATERAL) last--;
    if (last - first < 1) return;

    // Compact the band's vertices into their own array. Handing Rapier the whole
    // grid and indexing only part of it looks tempting, but a trimesh's AABB spans
    // every vertex it was given: the collider would claim a kilometres-wide box in
    // the broad phase and every query in the world would test against it. Measured:
    // 32 ms/frame with the full array, 14 ms with this copy.
    const bandCount = last - first + 1;
    const vertices = new Float32Array(sCount * bandCount * 3);
    for (let si = 0; si < sCount; si++) {
      for (let li = first; li <= last; li++) {
        const src = (si * latCount + li) * 3;
        const dst = (si * bandCount + (li - first)) * 3;
        vertices[dst] = positions[src]!;
        vertices[dst + 1] = positions[src + 1]!;
        vertices[dst + 2] = positions[src + 2]!;
      }
    }

    const index: number[] = [];
    for (let si = 0; si < sCount - 1; si++) {
      for (let li = first; li < last; li++) {
        if (validCells[si * (latCount - 1) + li] === 0) continue;
        // Same rule as the visible grid: in-range, the road's own trimesh owns the
        // corridor quad, so leaving it out here keeps the two from fighting over
        // the same wheel ray.
        if (!isApron && laterals[li]! < 0 && laterals[li + 1]! > 0) continue;
        const a = si * bandCount + (li - first);
        const b = a + bandCount;
        const c = a + 1;
        const d = b + 1;
        index.push(a, b, c, b, d, c);
      }
    }
    if (index.length === 0) return;

    // `vertices` is copied verbatim from the already-relative `positions` above, so
    // the trimesh receives origin-relative vertices — no second subtraction here.
    const collider = ctx.physics.addStaticTrimesh(
      vertices,
      Uint32Array.from(index),
      TERRAIN_COLLIDER_SURFACE,
    );
    colliders.push(collider);
    const body = collider.parent();
    if (body) bodies.push(body);
  }
}
