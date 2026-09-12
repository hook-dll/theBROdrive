import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { SurfaceType } from '../core/surfaces';
import { ROAD_TILE_METRES } from '../render/roadtexture';
import type { ChunkContent, ChunkContext, ChunkProvider } from './chunks';
import { roadAsphaltMaterial, roadAsphaltVertexColorAtStart } from './roadmesh';
import { TERMINUS_CENTRE_M, TERMINUS_PAD_M } from './terminus';

/** About 1.5 m between outer-ring vertices, matching the road's dense ribbon. */
const RING_SEGMENTS = 72;
const RING_COUNT = 12;

/**
 * The paved turning bulb behind the road's start.
 *
 * This is deliberately separate from the road ribbon: its circular extent would
 * otherwise widen the road corridor into the homestead.
 */
export class TerminusPadProvider implements ChunkProvider {
  readonly id = 'terminus-pad';

  build(ctx: ChunkContext): ChunkContent | null {
    if (ctx.chunkIndex !== 0) return null;

    const vertexCount = 1 + RING_COUNT * RING_SEGMENTS;
    const positions = new Float32Array(vertexCount * 3);
    const colors = new Float32Array(vertexCount * 3);
    const uvs = new Float32Array(vertexCount * 2);
    const indices = new Uint32Array(RING_SEGMENTS * (3 + (RING_COUNT - 1) * 6));
    const ox = ctx.originX;
    const oz = ctx.originZ;
    const centreZ = -TERMINUS_CENTRE_M;

    const writeVertex = (index: number, x: number, z: number): void => {
      positions[index * 3] = x - ox;
      positions[index * 3 + 1] = ctx.terrain.terminusSurfaceY(x, z);
      positions[index * 3 + 2] = z - oz;
      uvs[index * 2] = x / ROAD_TILE_METRES;
      uvs[index * 2 + 1] = z / ROAD_TILE_METRES;
    };

    writeVertex(0, 0, centreZ);
    for (let ring = 1; ring <= RING_COUNT; ring++) {
      const radius = (TERMINUS_PAD_M * ring) / RING_COUNT;
      for (let segment = 0; segment < RING_SEGMENTS; segment++) {
        const angle = (segment * Math.PI * 2) / RING_SEGMENTS;
        writeVertex(
          1 + (ring - 1) * RING_SEGMENTS + segment,
          Math.cos(angle) * radius,
          centreZ + Math.sin(angle) * radius,
        );
      }
    }

    const asphalt = roadAsphaltVertexColorAtStart(new THREE.Color());
    for (let i = 0; i < vertexCount; i++) {
      colors[i * 3] = asphalt.r;
      colors[i * 3 + 1] = asphalt.g;
      colors[i * 3 + 2] = asphalt.b;
    }

    let ii = 0;
    for (let segment = 0; segment < RING_SEGMENTS; segment++) {
      const next = (segment + 1) % RING_SEGMENTS;
      // Counter-clockwise when viewed from above, for upward-facing triangles.
      indices[ii++] = 0;
      indices[ii++] = 1 + next;
      indices[ii++] = 1 + segment;
    }
    for (let ring = 1; ring < RING_COUNT; ring++) {
      const inner = 1 + (ring - 1) * RING_SEGMENTS;
      const outer = inner + RING_SEGMENTS;
      for (let segment = 0; segment < RING_SEGMENTS; segment++) {
        const next = (segment + 1) % RING_SEGMENTS;
        indices[ii++] = inner + segment;
        indices[ii++] = outer + next;
        indices[ii++] = outer + segment;
        indices[ii++] = inner + segment;
        indices[ii++] = inner + next;
        indices[ii++] = outer + next;
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    const normals = new Float32Array(positions.length);
    for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));

    const material = roadAsphaltMaterial().clone();
    // The pad and ribbon are coplanar at the mouth. Offset the pad away so the road
    // wins depth testing there, while retaining the complete disc for collision.
    material.polygonOffset = true;
    material.polygonOffsetFactor = 1;
    material.polygonOffsetUnits = 1;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    const group = new THREE.Group();
    group.add(mesh);

    const bodies: RAPIER.RigidBody[] = [];
    const colliders: RAPIER.Collider[] = [];
    if (ctx.hasPhysics) {
      const collider = ctx.physics.addStaticTrimesh(positions, indices, SurfaceType.Asphalt);
      colliders.push(collider);
      const body = collider.parent();
      if (body) bodies.push(body);
    }

    return {
      group,
      bodies,
      colliders,
      dispose: () => {
        geometry.dispose();
        material.dispose();
      },
    };
  }
}
