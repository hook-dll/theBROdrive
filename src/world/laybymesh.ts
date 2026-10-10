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
 * across (world/layby.ts `laybyLevel`), so these carry colour, not shape.
 */
const TOP_COLUMNS = 5;
/**
 * The outer lip: one more column this far out and this far down, so the pad's edge
 * goes INTO the sand (which the desert tiles sink under and round it,
 * deserttiledata `laybyAsphaltCover`) instead of standing on it as a mat.
 */
const LIP_OUT_M = 0.35;
const LIP_DROP_M = 0.16;
const COLUMNS = TOP_COLUMNS + 1;
/** Rows narrower than this are left out: the slips start from nothing. */
const MIN_WIDTH_M = 0.02;
/** Rows of quads per collider trimesh (as roadmesh.ts's `COLLIDER_SLAB_QUADS`). */
const COLLIDER_SLAB_QUADS = 15;
/**
 * Wind-blown dust, towards the sand: some over the whole pad, which nobody sweeps, and
 * more on the outer column and the lip, where the desert meets it.
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
      let first = -1;
      let last = -1;
      for (let si = 0; si < sCount; si++) {
        const s = sStart + (si * (sEnd - sStart)) / (sCount - 1);
        const halfWidth = ctx.road.halfWidthAt(s);
        if (laybyOuterAt(layby, s, halfWidth) - halfWidth < MIN_WIDTH_M) continue;
        if (first < 0) first = si;
        last = si;
      }
      if (first < 0 || last <= first) continue;
      const geometry = this.buildLayby(ctx, layby, sCount, first, last, group, bodies, colliders);
      geometries.push(geometry);
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
    bodies: RAPIER.RigidBody[],
    colliders: RAPIER.Collider[],
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

    for (let r = 0; r < rows; r++) {
      const si = first + r;
      const s = sStart + (si * (sEnd - sStart)) / (sCount - 1);
      const halfWidth = road.halfWidthAt(s);
      const outer = laybyOuterAt(layby, s, halfWidth);
      sand.setHex(desertPaletteAt(s).sand).multiplyScalar(roadVertexColorGain());
      const mottle = 1 + MOTTLE * Math.sin(s / 9.7) * Math.sin(s / 3.3 + 1.3);
      for (let c = 0; c < COLUMNS; c++) {
        const lip = c === TOP_COLUMNS;
        const u = lip ? outer + LIP_OUT_M : halfWidth + ((outer - halfWidth) * c) / (TOP_COLUMNS - 1);
        const lateral = layby.side * u;
        road.offsetPoint(s, lateral, point);
        const vi = r * COLUMNS + c;
        positions[vi * 3] = point.x - ox;
        positions[vi * 3 + 1] = lip
          ? terrain.laybySurfaceY(s, layby.side * outer, layby.side) - LIP_DROP_M
          : terrain.laybySurfaceY(s, lateral, layby.side);
        positions[vi * 3 + 2] = point.z - oz;
        normals[vi * 3 + 1] = 1;
        uvs[vi * 2] = lateral / ROAD_TILE_METRES;
        uvs[vi * 2 + 1] = textureVStart + (s - sStart) / ROAD_TILE_METRES;
        tone.copy(asphalt).multiplyScalar(mottle).lerp(sand, c >= TOP_COLUMNS - 1 ? EDGE_DUST : DUST);
        colors[vi * 3] = tone.r;
        colors[vi * 3 + 1] = tone.g;
        colors[vi * 3 + 2] = tone.b;
      }
    }

    // Which diagonal order faces up depends on which side of the road the lay-by is
    // on; ask the geometry rather than the sign convention. Across is measured on the
    // middle row (the widest the chunk has), along down the inner column.
    const mid = (rows >> 1) * COLUMNS;
    const acrossX = positions[(mid + TOP_COLUMNS - 1) * 3]! - positions[mid * 3]!;
    const acrossZ = positions[(mid + TOP_COLUMNS - 1) * 3 + 2]! - positions[mid * 3 + 2]!;
    const alongX = positions[(rows - 1) * COLUMNS * 3]! - positions[0]!;
    const alongZ = positions[(rows - 1) * COLUMNS * 3 + 2]! - positions[2]!;
    const upward = acrossZ * alongX - acrossX * alongZ > 0;
    const quad = (out: Uint32Array, at: number, v: number, rowStride: number): number => {
      const b = v + 1;
      const d = v + rowStride;
      const e = d + 1;
      if (upward) out.set([v, b, d, b, e, d], at);
      else out.set([v, d, b, b, d, e], at);
      return at + 6;
    };

    const indices = new Uint32Array((rows - 1) * (COLUMNS - 1) * 6);
    let w = 0;
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < COLUMNS - 1; c++) w = quad(indices, w, r * COLUMNS + c, COLUMNS);
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

    if (ctx.hasPhysics) {
      // The top surface only, in slabs sharing their boundary rows.
      for (let q0 = 0; q0 < rows - 1; q0 += COLLIDER_SLAB_QUADS) {
        const q1 = Math.min(q0 + COLLIDER_SLAB_QUADS, rows - 1);
        const slabRows = q1 - q0 + 1;
        const vertices = new Float32Array(slabRows * TOP_COLUMNS * 3);
        for (let r = 0; r < slabRows; r++) {
          vertices.set(
            positions.subarray((q0 + r) * COLUMNS * 3, ((q0 + r) * COLUMNS + TOP_COLUMNS) * 3),
            r * TOP_COLUMNS * 3,
          );
        }
        const slabIndices = new Uint32Array((slabRows - 1) * (TOP_COLUMNS - 1) * 6);
        let k = 0;
        for (let r = 0; r < slabRows - 1; r++) {
          for (let c = 0; c < TOP_COLUMNS - 1; c++) k = quad(slabIndices, k, r * TOP_COLUMNS + c, TOP_COLUMNS);
        }
        const collider = ctx.physics.addStaticTrimesh(vertices, slabIndices, SurfaceType.Asphalt);
        collider.setEnabled(false);
        colliders.push(collider);
        const body = collider.parent();
        if (body) bodies.push(body);
      }
    }
    return geometry;
  }
}
