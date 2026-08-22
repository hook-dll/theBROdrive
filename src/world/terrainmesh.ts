import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { SurfaceType, SURFACES } from '../core/surfaces';
import { NODE_SPACING, type Road } from './road';
import { CORRIDOR_INNER, RIM_START } from './terrain';
import { CHUNK_LENGTH, type ChunkContent, type ChunkContext, type ChunkProvider } from './chunks';

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
 * How far out the visible desert reaches, each side of the road. Chosen against the
 * fog: with the off-road haze ramp (main.ts) nothing beyond this resolves, so
 * drawing further only costs triangles on a weak GPU.
 */
const FAR_LATERAL = 1500;
/**
 * How far out the ground is solid, each side of the road. The relief turns
 * genuinely impassable before this, so the edge is reached by choice, not by
 * surprise — and `main.ts` catches anything that gets past it anyway.
 */
const PHYSICS_LATERAL = 600;
/** Lateral spacing growth factor; resolution falls off away from the road. */
const LATERAL_RATIO = 1.35;
/** Visible mesh sampling step along the road. Must divide CHUNK_LENGTH. */
const S_STEP = 8;

/**
 * Maximum lateral ring spacing across the rim. Small enough that the escarpment is
 * drawn as a slope rather than a fold: the face climbs its full height over a few
 * hundred metres, and at the unconstrained geometric spacing out there it would be
 * two facets wide.
 */
const RIM_RING_SPACING = 60;
/**
 * Ring spacing from the end of the solid band out to the draw distance. Coarser
 * than the face — nothing beyond is drivable and the fog is eating it — but capped
 * all the same, because the ridge crest and its far slope live out here and the
 * geometric progression alone would step straight over them, which is exactly how
 * a ridge turns into one enormous flat facet across the sky.
 */
const RIM_FAR_RING_SPACING = 150;

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

/** Surface albedos pre-converted to the linear working colour space. */
const SURFACE_LINEAR: Record<SurfaceType, THREE.Color> = {
  [SurfaceType.Asphalt]: new THREE.Color(SURFACES[SurfaceType.Asphalt].color),
  [SurfaceType.CrackedAsphalt]: new THREE.Color(SURFACES[SurfaceType.CrackedAsphalt].color),
  [SurfaceType.Gravel]: new THREE.Color(SURFACES[SurfaceType.Gravel].color),
  [SurfaceType.Sand]: new THREE.Color(SURFACES[SurfaceType.Sand].color),
  [SurfaceType.Rock]: new THREE.Color(SURFACES[SurfaceType.Rock].color),
  [SurfaceType.Concrete]: new THREE.Color(SURFACES[SurfaceType.Concrete].color),
};

// Shared across every chunk; never disposed by the streamer.
const terrainMaterial = new THREE.MeshStandardMaterial({
  vertexColors: true,
  roughness: 1,
  metalness: 0,
});

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

    const isApron = sStart < 0 || sEnd > road.length;

    // Geometric lateral rings — metres at the verge, hundreds at the horizon — with
    // two exceptions. `PHYSICS_LATERAL` is forced in as an exact ring so the
    // collider ends on a shared row of vertices (the solid ground and the drawn
    // ground then agree there to the bit rather than meeting mid-quad), and across
    // the rim the spacing is capped: the escarpment climbs 120 m over 350 m of
    // lateral distance, and at the unconstrained spacing out there it would be two
    // facets wide and read as a folded sheet.
    const magnitudes: number[] = [CORRIDOR_INNER];
    let m = CORRIDOR_INNER;
    while (m < FAR_LATERAL) {
      const geometric = m * LATERAL_RATIO - m;
      const cap =
        m >= RIM_START - RIM_RING_SPACING && m < PHYSICS_LATERAL
          ? RIM_RING_SPACING
          : RIM_FAR_RING_SPACING;
      const step = Math.min(geometric, cap);
      const next = Math.min(m + step, FAR_LATERAL);
      m = m < PHYSICS_LATERAL && next > PHYSICS_LATERAL ? PHYSICS_LATERAL : next;
      if (m - magnitudes[magnitudes.length - 1]! < 1) break;
      magnitudes.push(m);
    }
    if (magnitudes[magnitudes.length - 1]! < FAR_LATERAL) magnitudes.push(FAR_LATERAL);

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
      // The row's centreline frame, sampled once. Every vertex in the row already
      // knows its own lateral offset, so the terrain never has to project back.
      const centre = road.sampleAt(Math.min(Math.max(s, 0), road.length));
      this.offsetPoint(road, s, 0, point);
      const centreX = point.x;
      const centreZ = point.z;
      for (let li = 0; li < latCount; li++) {
        const lateral = laterals[li]!;
        this.offsetPoint(road, s, lateral, point);
        const vi = si * latCount + li;
        positions[vi * 3] = point.x;
        positions[vi * 3 + 1] = terrain.heightFromFrame(
          point.x,
          point.z,
          lateral,
          centreX,
          centreZ,
          centre.y,
          s,
        );
        positions[vi * 3 + 2] = point.z;

        const surfaceColor = SURFACE_LINEAR[terrain.surfaceFromFrame(point.x, point.z, lateral)]!;
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
    const xz = (vi: number): readonly [number, number] => [
      positions[vi * 3]!,
      positions[vi * 3 + 2]!,
    ];
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
        if (isApron || (edgeValid(li) && edgeValid(li + 1))) {
          validCells[si * (latCount - 1) + li] = 1;
        }
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
      group: new THREE.Group().add(new THREE.Mesh(geometry, terrainMaterial)),
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

    const collider = ctx.physics.addStaticTrimesh(
      vertices,
      Uint32Array.from(index),
      SurfaceType.Sand,
    );
    colliders.push(collider);
    const body = collider.parent();
    if (body) bodies.push(body);
  }
}
