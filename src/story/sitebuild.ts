/**
 * The airfield's chunk provider: the runway strip, its markings, a windsock and the
 * parked plane, built as static scenery in the chunk that holds the runway's middle.
 * Not streamed while `AIRFIELD` (airfield.ts) places nothing.
 *
 * The runway is a thin strip draped on `terrain.heightAt` and collided as drawn, and the
 * parked plane is a `LightPlane` with one static box trimesh whose collider handle is
 * registered in the `BoardableField`, which is how `Interaction` offers boarding it.
 */
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import { SurfaceType } from '../core/surfaces';
import { ROAD_TILE_METRES } from '../render/roadtexture';
import { roadAsphaltMaterial, roadAsphaltVertexColorAtStart } from '../world/roadmesh';
import { geometryToTrimesh, poseMatrix } from '../world/poi';
import type { ChunkContent, ChunkContext, ChunkProvider } from '../world/chunks';
import { CHUNK_LENGTH } from '../world/ranges';
import { createLightPlane } from './plane';
import { runwaySurfaceY, type Airfield } from './airfield';

/** Strip paint lifted this far above the draped surface so it never z-fights it. */
const PAINT_LIFT_M = 0.012;
/** Metres between the strip's rows along the runway: its height stations' own spacing. */
const STRIP_ROW_M = 3;
/** The shoulder: how far past each edge the strip reaches back down to the sand (a
 *  gentle graded bed, since the strip stands proud of the sand's chop), and how far
 *  under the sand it ends so the seam never shows a gap. */
const SHOULDER_M = 2.5;
const SHOULDER_SINK_M = 0.08;

/**
 * The runway strip's material, one for the session and never disposed. It is the road's
 * finish with a polygon offset, and the strip's own vertex colours and UVs make it a
 * program no other mesh uses: a per-build clone disposed with chunk 0 took that program
 * with it, and the next build of the chunk linked it again mid-drive.
 */
let runwayMaterial: THREE.MeshStandardMaterial | null = null;
function runwayStripMaterial(): THREE.MeshStandardMaterial {
  if (!runwayMaterial) {
    runwayMaterial = roadAsphaltMaterial().clone();
    // The strip sits a few centimetres over the sand; the offset keeps its edge
    // from stippling against the terrain where the two nearly meet.
    runwayMaterial.polygonOffset = true;
    runwayMaterial.polygonOffsetFactor = -2;
    runwayMaterial.polygonOffsetUnits = -2;
  }
  return runwayMaterial;
}

/**
 * Colliders that mean "this is the plane".
 *
 * A tiny registry rather than a boolean because a handle is the only identity a
 * Rapier ray hit carries: `Interaction` asks this field whether the collider it hit
 * is the aircraft, and the answer has to survive the chunk being rebuilt, which
 * `remove` on chunk disposal guarantees.
 */
export class BoardableField {
  private readonly handles = new Set<number>();

  add(handle: number): void {
    this.handles.add(handle);
  }

  remove(handle: number): void {
    this.handles.delete(handle);
  }

  has(handle: number): boolean {
    return this.handles.has(handle);
  }
}

/** The plane's local collision boxes as one non-indexed triangle soup. */
function boxesToGeometry(boxes: readonly (readonly [readonly number[], readonly number[]])[]): THREE.BufferGeometry {
  const verts: number[] = [];
  const triangles = [0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1, 1, 5, 6, 1, 6, 2, 2, 6, 7, 2, 7, 3, 3, 7, 4, 3, 4, 0];
  for (const [min, max] of boxes) {
    const corners = [
      min[0], min[1], min[2],
      max[0], min[1], min[2],
      max[0], max[1], min[2],
      min[0], max[1], min[2],
      min[0], min[1], max[2],
      max[0], min[1], max[2],
      max[0], max[1], max[2],
      min[0], max[1], max[2],
    ];
    for (const corner of triangles) {
      verts.push(corners[corner * 3]!, corners[corner * 3 + 1]!, corners[corner * 3 + 2]!);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  return geometry;
}

export class AirfieldProvider implements ChunkProvider {
  readonly id = 'airfield';

  private planeGroup: THREE.Group | null = null;
  private planeDispose: (() => void) | null = null;
  private readonly planeHandles: number[] = [];

  constructor(
    private readonly airfield: Airfield,
    private readonly boardable: BoardableField,
  ) {}

  /** Hides/shows the parked plane (the takeoff cutscene flies its own copy). */
  setParkedPlaneVisible(visible: boolean): void {
    if (this.planeGroup) this.planeGroup.visible = visible;
  }

  build(ctx: ChunkContext): ChunkContent | null {
    if (ctx.chunkIndex !== Math.floor(this.airfield.runway.hintS / CHUNK_LENGTH)) return null;

    const site = this.airfield;
    const ox = ctx.originX;
    const oz = ctx.originZ;
    const group = new THREE.Group();
    group.name = 'airfield';
    const bodies: RAPIER.RigidBody[] = [];
    const colliders: RAPIER.Collider[] = [];
    const geos: THREE.BufferGeometry[] = [];
    const mats: THREE.Material[] = [];

    const mat = (
      color: number,
      o: { metalness?: number; roughness?: number } = {},
    ): THREE.MeshStandardMaterial => {
      const material = new THREE.MeshStandardMaterial({
        color,
        metalness: o.metalness ?? 0,
        roughness: o.roughness ?? 0.9,
      });
      mats.push(material);
      return material;
    };

    // --- The runway: a strip draped on the ground, with its markings ----------
    const runway = site.runway;
    {
      const verts: number[] = [];
      const colors: number[] = [];
      const uvs: number[] = [];
      const indices: number[] = [];
      // The road's own asphalt, in the road's own texture scale: the strip is the same
      // tarmac the player just crossed, not a darker paint of its own.
      const asphalt = roadAsphaltVertexColorAtStart(new THREE.Color());
      // Four columns: a shoulder, the two level edges, a shoulder. The runway surface is
      // level across its width (`runwaySurfaceY`), so its middle needs no vertices of its
      // own; each shoulder slopes from the edge down into the sand beside it.
      const columns = [
        -(runway.width / 2 + SHOULDER_M),
        -runway.width / 2,
        runway.width / 2,
        runway.width / 2 + SHOULDER_M,
      ];
      const rows = Math.max(1, Math.ceil(runway.length / STRIP_ROW_M));
      for (let i = 0; i <= rows; i++) {
        const along = (runway.length * i) / rows;
        const cx = runway.x0 + runway.dx * along;
        const cz = runway.z0 + runway.dz * along;
        for (let j = 0; j < columns.length; j++) {
          const across = columns[j]!;
          const x = cx - runway.dz * across;
          const z = cz + runway.dx * across;
          const shoulder = j === 0 || j === columns.length - 1;
          const y = shoulder
            ? ctx.terrain.heightAt(x, z, runway.hintS) - SHOULDER_SINK_M
            : runwaySurfaceY(runway, x, z);
          verts.push(x - ox, y, z - oz);
          colors.push(asphalt.r, asphalt.g, asphalt.b);
          uvs.push(x / ROAD_TILE_METRES, z / ROAD_TILE_METRES);
        }
      }
      const row = columns.length;
      for (let i = 0; i < rows; i++) {
        for (let j = 0; j < row - 1; j++) {
          const a = i * row + j;
          const b = (i + 1) * row + j;
          const c = a + 1;
          const d = b + 1;
          indices.push(a, c, b, b, c, d);
        }
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      geometry.setIndex(indices);
      geometry.computeVertexNormals();
      const mesh = new THREE.Mesh(geometry, runwayStripMaterial());
      mesh.receiveShadow = true;
      group.add(mesh);
      geos.push(geometry);
      // Collided as drawn: the strip stands a few centimetres proud of the sand, and feet
      // and tyres belong on the tarmac, not sunk through it to the ground beneath.
      if (ctx.hasPhysics) {
        const collider = ctx.physics.addStaticTrimesh(
          new Float32Array(verts),
          new Uint32Array(indices),
          SurfaceType.Asphalt,
        );
        colliders.push(collider);
        const body = collider.parent();
        if (body) bodies.push(body);
      }
    }

    // Markings: threshold bars, centreline dashes, edge dashes. One merged mesh.
    {
      const paintParts: THREE.BufferGeometry[] = [];
      const paintMatrix = new THREE.Matrix4();
      const paintQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, site.plane.yaw, 0, 'YXZ'));
      const paint = (t: number, across: number, along: number, width: number, thickness: number): void => {
        const cx = runway.x0 + runway.dx * runway.length * t - runway.dz * across;
        const cz = runway.z0 + runway.dz * runway.length * t + runway.dx * across;
        const geometry = new THREE.BoxGeometry(width, thickness, along);
        paintMatrix.compose(
          new THREE.Vector3(cx - ox, runwaySurfaceY(runway, cx, cz) + PAINT_LIFT_M, cz - oz),
          paintQuat,
          new THREE.Vector3(1, 1, 1),
        );
        geometry.applyMatrix4(paintMatrix);
        paintParts.push(geometry);
      };
      // Two threshold bars: a set of short stripes just inside each end.
      for (let k = 0; k < 6; k++) {
        const across = (k - 2.5) * (runway.width / 8);
        paint(0.025, across, 3.6, runway.width / 12, 0.02);
        paint(0.975, across, 3.6, runway.width / 12, 0.02);
      }
      // Centreline dashes.
      for (let k = 0; k < 11; k++) {
        paint(0.1 + k * 0.08, 0, 4.5, 0.3, 0.02);
      }
      // Edge dashes down both sides.
      for (let k = 0; k < 9; k++) {
        const t = 0.08 + k * 0.105;
        paint(t, runway.width / 2 - 0.7, 2.2, 0.22, 0.02);
        paint(t, -(runway.width / 2 - 0.7), 2.2, 0.22, 0.02);
      }
      const merged = mergeGeometries(paintParts, false);
      for (const part of paintParts) part.dispose();
      if (merged) {
        const material = mat(0xe8e6df, { roughness: 0.8 });
        // Pulled nearer than the strip's own offset, or the strip wins the depth test
        // over paint lying a centimetre above it.
        material.polygonOffset = true;
        material.polygonOffsetFactor = -4;
        material.polygonOffsetUnits = -4;
        const mesh = new THREE.Mesh(merged, material);
        group.add(mesh);
        geos.push(merged);
      }
    }

    // --- Windsock on a pole ---------------------------------------------------
    {
      const t = 0.05;
      const across = runway.width / 2 + 2.2;
      const x = runway.x0 + runway.dx * runway.length * t - runway.dz * across;
      const z = runway.z0 + runway.dz * runway.length * t + runway.dx * across;
      const ground = ctx.terrain.heightAt(x, z, runway.hintS);
      const poleGeo = new THREE.CylinderGeometry(0.06, 0.07, 3.2, 10);
      const pole = new THREE.Mesh(poleGeo, mat(0x8a8f95, { metalness: 0.5, roughness: 0.6 }));
      pole.position.set(x - ox, ground + 1.6, z - oz);
      group.add(pole);
      geos.push(poleGeo);
      const sockGeo = new THREE.ConeGeometry(0.32, 1.2, 12, 1, true);
      const sock = new THREE.Mesh(sockGeo, mat(0xd8622a, { roughness: 0.85 }));
      // Hangs off the top, blowing with the runway direction.
      sock.rotation.z = -Math.PI / 2;
      sock.rotation.y = site.plane.yaw;
      sock.position.set(x - ox + runway.dx * 0.9, ground + 3.0, z - oz + runway.dz * 0.9);
      group.add(sock);
      geos.push(sockGeo);
    }

    // --- The parked plane -----------------------------------------------------
    const lightPlane = createLightPlane();
    lightPlane.group.position.set(site.plane.x - ox, site.plane.y, site.plane.z - oz);
    lightPlane.group.rotation.set(0, site.plane.yaw, 0, 'YXZ');
    lightPlane.group.updateMatrixWorld(true);
    group.add(lightPlane.group);
    this.planeGroup = lightPlane.group;
    this.planeDispose = () => lightPlane.dispose();

    if (ctx.hasPhysics) {
      const collisionGeometry = boxesToGeometry(
        lightPlane.colliderBoxes as readonly (readonly [readonly number[], readonly number[]])[],
      );
      const matrix = poseMatrix(site.plane.x, site.plane.y, site.plane.z, site.plane.yaw, 0, 0, ox, oz);
      const trimesh = geometryToTrimesh(collisionGeometry, matrix);
      collisionGeometry.dispose();
      if (trimesh.indices.length > 0) {
        const collider = ctx.physics.addStaticTrimesh(trimesh.vertices, trimesh.indices, SurfaceType.Concrete);
        colliders.push(collider);
        const body = collider.parent();
        if (body) bodies.push(body);
        this.boardable.add(collider.handle);
        this.planeHandles.push(collider.handle);
      }
    }

    return {
      group,
      bodies,
      colliders,
      dispose: () => {
        for (const handle of this.planeHandles) this.boardable.remove(handle);
        this.planeHandles.length = 0;
        this.planeDispose?.();
        this.planeDispose = null;
        this.planeGroup = null;
        for (const geometry of geos) geometry.dispose();
        for (const material of mats) material.dispose();
      },
    };
  }
}
