import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { SurfaceType, SURFACES } from '../core/surfaces';
import { NODE_SPACING, type Road } from './road';
import { CORRIDOR_INNER } from './terrain';
import { CHUNK_LENGTH, type ChunkContent, type ChunkContext, type ChunkProvider } from './chunks';

/**
 * Desert either side of the road.
 *
 * The visible mesh is a road-aligned (s, lateral) grid so it hugs the road exactly,
 * with lateral spacing growing geometrically (fine at the verge, coarse at the
 * horizon). Physics is an axis-aligned Rapier heightfield covering the near band —
 * enough ground to drive off-road on, and no colliders beyond it. Rapier
 * heightfields are axis-aligned and centred on their body translation, and their
 * heights are column-major with rows along local Z and columns along local X, so
 * the fill ordering below is load-bearing.
 */

/** How far out the visible desert reaches, each side of the road. */
const FAR_LATERAL = 220;
/** Lateral spacing growth factor; resolution falls off away from the road. */
const LATERAL_RATIO = 1.35;
/** Visible mesh sampling step along the road. Must divide CHUNK_LENGTH. */
const S_STEP = 8;

/** How far either side of the road the physics heightfield reaches. */
const NEAR_BAND = 60;
/** Physics heightfield cell size in metres. */
const HEIGHTFIELD_CELL = 2;

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

export class TerrainMeshProvider implements ChunkProvider {
  readonly id = 'terrain';

  build(ctx: ChunkContext): ChunkContent | null {
    // Every chunk owns a full CHUNK_LENGTH span, even outside the road: the
    // negative and past-end chunks are the desert apron. `ctx.sStart`/`ctx.sEnd`
    // are clamped to the road and therefore empty out there, so derive the span
    // from the chunk index instead.
    const sStart = ctx.chunkIndex * CHUNK_LENGTH;
    const sEnd = (ctx.chunkIndex + 1) * CHUNK_LENGTH;

    const { group, geometry } = this.buildVisual(ctx, sStart, sEnd);
    const bodies: RAPIER.RigidBody[] = [];
    const colliders: RAPIER.Collider[] = [];

    if (ctx.hasPhysics) {
      this.buildHeightfield(ctx, sStart, sEnd, bodies, colliders);
    }

    return { group, bodies, colliders, dispose: () => geometry.dispose() };
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

  private buildVisual(
    ctx: ChunkContext,
    sStart: number,
    sEnd: number,
  ): { group: THREE.Group; geometry: THREE.BufferGeometry } {
    const { road, terrain } = ctx;

    const isApron = sStart < 0 || sEnd > road.length;

    const magnitudes: number[] = [CORRIDOR_INNER];
    let m = CORRIDOR_INNER;
    while (m < FAR_LATERAL) {
      m = Math.min(m * LATERAL_RATIO, FAR_LATERAL);
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
      const hint = Math.min(Math.max(s, 0), road.length);
      for (let li = 0; li < latCount; li++) {
        const lateral = laterals[li]!;
        this.offsetPoint(road, s, lateral, point);
        const vi = si * latCount + li;
        positions[vi * 3] = point.x;
        positions[vi * 3 + 1] = terrain.heightAt(point.x, point.z, hint);
        positions[vi * 3 + 2] = point.z;

        const surfaceColor = SURFACE_LINEAR[terrain.surfaceAt(point.x, point.z, hint)]!;
        colors[vi * 3] = surfaceColor.r;
        colors[vi * 3 + 1] = surfaceColor.g;
        colors[vi * 3 + 2] = surfaceColor.b;
      }
    }

    // Index grid. The single quad spanning the road (the gap between the last
    // negative and first positive lateral) is skipped only in-range, where the
    // road mesh covers it; the apron has no road, so there it must be filled or
    // the corridor would read as a void trench.
    const index: number[] = [];
    for (let si = 0; si < sCount - 1; si++) {
      for (let li = 0; li < latCount - 1; li++) {
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

    return { group: new THREE.Group().add(new THREE.Mesh(geometry, terrainMaterial)), geometry };
  }

  private buildHeightfield(
    ctx: ChunkContext,
    sStart: number,
    sEnd: number,
    bodies: RAPIER.RigidBody[],
    colliders: RAPIER.Collider[],
  ): void {
    const { road, terrain, physics } = ctx;

    // Centreline samples over the chunk: used for the road AABB and, per grid
    // point, to seed the road projection so the corridor sink lands exactly.
    const nSamples = Math.round((sEnd - sStart) / NODE_SPACING) + 1;
    const csx = new Float64Array(nSamples);
    const csz = new Float64Array(nSamples);
    const css = new Float64Array(nSamples);
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    const point = { x: 0, y: 0, z: 0 };
    for (let k = 0; k < nSamples; k++) {
      const s = sStart + k * NODE_SPACING;
      this.offsetPoint(road, s, 0, point);
      csx[k] = point.x;
      csz[k] = point.z;
      css[k] = Math.min(Math.max(s, 0), road.length);
      if (point.x < minX) minX = point.x;
      if (point.x > maxX) maxX = point.x;
      if (point.z < minZ) minZ = point.z;
      if (point.z > maxZ) maxZ = point.z;
    }

    minX -= NEAR_BAND;
    maxX += NEAR_BAND;
    minZ -= NEAR_BAND;
    maxZ += NEAR_BAND;

    const ncolsX = Math.max(1, Math.ceil((maxX - minX) / HEIGHTFIELD_CELL));
    const nrowsZ = Math.max(1, Math.ceil((maxZ - minZ) / HEIGHTFIELD_CELL));
    const widthX = ncolsX * HEIGHTFIELD_CELL;
    const widthZ = nrowsZ * HEIGHTFIELD_CELL;

    // Column-major heights over an (nrowsZ+1) x (ncolsX+1) grid: the X index is
    // the column, the Z index the row, so `heights[z + x * (nrowsZ + 1)]`.
    const heights = new Float32Array((ncolsX + 1) * (nrowsZ + 1));

    for (let cx = 0; cx <= ncolsX; cx++) {
      const x = minX + cx * HEIGHTFIELD_CELL;
      for (let cz = 0; cz <= nrowsZ; cz++) {
        const z = minZ + cz * HEIGHTFIELD_CELL;
        // Seed the projection with the nearest centreline sample: within ~2 m of
        // the true s, so the corridor classification never misfires near the road.
        let best = 0;
        let bestD = Infinity;
        for (let k = 0; k < nSamples; k++) {
          const dx = csx[k]! - x;
          const dz = csz[k]! - z;
          const d = dx * dx + dz * dz;
          if (d < bestD) {
            bestD = d;
            best = k;
          }
        }
        heights[cz + cx * (nrowsZ + 1)] = terrain.heightAt(x, z, css[best]!);
      }
    }

    // The body translation is the centre of the axis-aligned grid; scale.y = 1
    // because heights are already world-space metres.
    const collider = physics.addHeightfield(
      nrowsZ,
      ncolsX,
      heights,
      { x: widthX, y: 1, z: widthZ },
      { x: (minX + maxX) / 2, y: 0, z: (minZ + maxZ) / 2 },
      SurfaceType.Sand,
    );
    colliders.push(collider);
    const body = collider.parent();
    if (body) bodies.push(body);
  }
}
