import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { SurfaceType } from '../core/surfaces';
import { ROAD_TILE_METRES } from '../render/roadtexture';
import type { ChunkContent, ChunkContext, ChunkProvider } from './chunks';
import { desertPaletteAt } from './gradient';
import { laybyOuterAt, laybysBetween, type Layby } from './layby';
import { roadAsphaltMaterial, roadAsphaltVertexColor, roadVertexColorGain } from './roadmesh';
import { SURFACE_STEP } from './roadsurface';

/**
 * Columns across the lay-by's asphalt, road edge to outer edge. The surface is planar
 * across (world/layby.ts `laybyLevel`), so these carry colour, not shape. There is no
 * lip: the road's shoulder strip hangs off the outer edge (roadmesh.ts), exactly as it
 * hangs off the ribbon's, and takes the asphalt down into the sand.
 */
const COLUMNS = 5;
/** Collider rows narrower than this are left out: the road edge's own carries a wheel there. */
const MIN_COLLIDER_WIDTH_M = 0.02;
/** Rows of quads per collider trimesh (as roadmesh.ts's `COLLIDER_SLAB_QUADS`). */
const COLLIDER_SLAB_QUADS = 15;
/**
 * Wind-blown dust, towards the sand: some over the whole pad, which nobody sweeps, and
 * more on the outer column, where the desert and its shoulder strip meet it.
 */
const DUST = 0.14;
const EDGE_DUST = 0.4;
/** Brightness swing of a slow mottle along the pad, so it is not one flat tone. */
const MOTTLE = 0.05;

const asphalt = new THREE.Color();
const sand = new THREE.Color();
const tone = new THREE.Color();
const point = { x: 0, y: 0, z: 0 };

/**
 * The lay-bys' asphalt: one ribbon per lay-by from its entry slip to its exit slip,
 * hung off the road's own edge and laid on the level the terrain was flattened to.
 *
 * ROWS ARE THE ROAD'S ROWS. Row `si` is at exactly the arclength roadmesh.ts gives
 * its row `si` (`sStart + si * (sEnd - sStart) / (sCount - 1)`), and the inner column
 * is at the road's edge lateral with the road's own edge height, so the lay-by and the
 * ribbon share their edge vertex for vertex (the road's event rows interpolate that
 * edge linearly and add nothing at the edge column), and two chunks share their
 * boundary row bit for bit.
 *
 * ONE PROGRAM. The mesh is drawn with the road's own material object and the road
 * ribbon's attribute set — position, three-component colour, uv, flat up normal — and
 * the same `receiveShadow`, so it links no shader the first road chunk did not already
 * link. Changing any of those would be a new program variant mid-drive (see the
 * shader-variant rules) and would need a boot anchor.
 *
 * Colliders are Asphalt trimesh slabs of the top surface only, built disabled and
 * switched on by the streamer, like the road's.
 */
export class LaybyMeshProvider implements ChunkProvider {
  readonly id = 'layby';

  build(ctx: ChunkContext): ChunkContent | null {
    const { sStart, sEnd } = ctx;
    if (sEnd <= sStart) return null;
    const laybys = laybysBetween(ctx.world.seed, sStart, sEnd);
    if (laybys.length === 0) return null;

    const group = new THREE.Group();
    group.name = 'layby';
    const bodies: RAPIER.RigidBody[] = [];
    const colliders: RAPIER.Collider[] = [];
    const geometries: THREE.BufferGeometry[] = [];
    const sCount = Math.round((sEnd - sStart) / SURFACE_STEP) + 1;
    roadAsphaltVertexColor(asphalt);

    for (const layby of laybys) {
      // Drawn from the last row with no width at all to the first, so the slip grows out
      // of the road edge from a point and meets the shoulder strip's inner edge on every
      // row; collided only where it is wide enough to matter.
      let first = -1;
      let last = -1;
      let colliderFirst = -1;
      let colliderLast = -1;
      for (let si = 0; si < sCount; si++) {
        const s = sStart + (si * (sEnd - sStart)) / (sCount - 1);
        const halfWidth = ctx.road.halfWidthAt(s);
        const width = laybyOuterAt(layby, s, halfWidth) - halfWidth;
        if (width <= 0) continue;
        if (first < 0) first = si;
        last = si;
        if (width < MIN_COLLIDER_WIDTH_M) continue;
        if (colliderFirst < 0) colliderFirst = si;
        colliderLast = si;
      }
      if (first < 0) continue;
      first = Math.max(0, first - 1);
      last = Math.min(sCount - 1, last + 1);
      if (last <= first) continue;
      const geometry = this.buildLayby(ctx, layby, sCount, first, last, group);
      geometries.push(geometry);
      if (ctx.hasPhysics && colliderFirst >= 0 && colliderLast > colliderFirst) {
        this.addColliders(ctx, geometry, colliderFirst - first, colliderLast - first, bodies, colliders);
      }
    }
    if (geometries.length === 0) return null;
    return {
      group,
      bodies,
      colliders,
      dispose: () => {
        for (const geometry of geometries) geometry.dispose();
      },
    };
  }

  private buildLayby(
    ctx: ChunkContext,
    layby: Layby,
    sCount: number,
    first: number,
    last: number,
    group: THREE.Group,
  ): THREE.BufferGeometry {
    const { sStart, sEnd, road, terrain } = ctx;
    const ox = ctx.originX;
    const oz = ctx.originZ;
    const rows = last - first + 1;
    const positions = new Float32Array(rows * COLUMNS * 3);
    const colors = new Float32Array(rows * COLUMNS * 3);
    const uvs = new Float32Array(rows * COLUMNS * 2);
    const normals = new Float32Array(rows * COLUMNS * 3);
    // Texture phase as the road's own (roadmesh.ts `textureVStart`), so the aggregate
    // runs on across the joint.
    const textureVStart =
      (((sStart % ROAD_TILE_METRES) + ROAD_TILE_METRES) % ROAD_TILE_METRES) / ROAD_TILE_METRES;
    // The widest row, for the winding test below.
    let widest = 0;
    let widestWidth = -1;

    for (let r = 0; r < rows; r++) {
      const si = first + r;
      const s = sStart + (si * (sEnd - sStart)) / (sCount - 1);
      const halfWidth = road.halfWidthAt(s);
      const outer = laybyOuterAt(layby, s, halfWidth);
      if (outer - halfWidth > widestWidth) {
        widestWidth = outer - halfWidth;
        widest = r;
      }
      sand.setHex(desertPaletteAt(s).sand).multiplyScalar(roadVertexColorGain());
      const mottle = 1 + MOTTLE * Math.sin(s / 9.7) * Math.sin(s / 3.3 + 1.3);
      for (let c = 0; c < COLUMNS; c++) {
        const lateral = layby.side * (halfWidth + ((outer - halfWidth) * c) / (COLUMNS - 1));
        road.offsetPoint(s, lateral, point);
        const vi = r * COLUMNS + c;
        positions[vi * 3] = point.x - ox;
        positions[vi * 3 + 1] = terrain.laybySurfaceY(s, lateral, layby.side);
        positions[vi * 3 + 2] = point.z - oz;
        normals[vi * 3 + 1] = 1;
        uvs[vi * 2] = lateral / ROAD_TILE_METRES;
        uvs[vi * 2 + 1] = textureVStart + (s - sStart) / ROAD_TILE_METRES;
        tone.copy(asphalt).multiplyScalar(mottle).lerp(sand, c === COLUMNS - 1 ? EDGE_DUST : DUST);
        colors[vi * 3] = tone.r;
        colors[vi * 3 + 1] = tone.g;
        colors[vi * 3 + 2] = tone.b;
      }
    }

    // Which diagonal order faces up depends on which side of the road the lay-by is
    // on; ask the geometry rather than the sign convention. Across is measured on the
    // widest row, along down the inner column.
    const across = widest * COLUMNS;
    const acrossX = positions[(across + COLUMNS - 1) * 3]! - positions[across * 3]!;
    const acrossZ = positions[(across + COLUMNS - 1) * 3 + 2]! - positions[across * 3 + 2]!;
    const alongX = positions[(rows - 1) * COLUMNS * 3]! - positions[0]!;
    const alongZ = positions[(rows - 1) * COLUMNS * 3 + 2]! - positions[2]!;
    const upward = acrossZ * alongX - acrossX * alongZ > 0;
    const indices = new Uint32Array((rows - 1) * (COLUMNS - 1) * 6);
    let w = 0;
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < COLUMNS - 1; c++) {
        const v = r * COLUMNS + c;
        const d = v + COLUMNS;
        indices.set(upward ? [v, v + 1, d, v + 1, d + 1, d] : [v, d, v + 1, v + 1, d, d + 1], w);
        w += 6;
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    const mesh = new THREE.Mesh(geometry, roadAsphaltMaterial());
    // As the road ribbon: receives the vehicle contact shadow, casts nothing.
    mesh.receiveShadow = true;
    group.add(mesh);
    return geometry;
  }

  /**
   * Asphalt trimesh slabs over rows `r0..r1` of a built lay-by: the drawn vertices and
   * triangles themselves, in slabs sharing their boundary rows, as the road's.
   */
  private addColliders(
    ctx: ChunkContext,
    geometry: THREE.BufferGeometry,
    r0: number,
    r1: number,
    bodies: RAPIER.RigidBody[],
    colliders: RAPIER.Collider[],
  ): void {
    const positions = geometry.getAttribute('position').array as Float32Array;
    const indices = geometry.getIndex()!.array as Uint32Array;
    const rowIndices = (COLUMNS - 1) * 6;
    for (let q0 = r0; q0 < r1; q0 += COLLIDER_SLAB_QUADS) {
      const q1 = Math.min(q0 + COLLIDER_SLAB_QUADS, r1);
      const vertices = positions.subarray(q0 * COLUMNS * 3, (q1 + 1) * COLUMNS * 3);
      const slabIndices = indices.slice(q0 * rowIndices, q1 * rowIndices);
      const rebase = q0 * COLUMNS;
      for (let i = 0; i < slabIndices.length; i++) slabIndices[i] = slabIndices[i]! - rebase;
      const collider = ctx.physics.addStaticTrimesh(vertices, slabIndices, SurfaceType.Asphalt);
      collider.setEnabled(false);
      colliders.push(collider);
      const body = collider.parent();
      if (body) bodies.push(body);
    }
  }
}
