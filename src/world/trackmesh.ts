import * as THREE from 'three';

import { applyCloudShadow } from '../render/cloudshadow';
import { applyComicShading } from '../render/comic';
import { applySnowCover } from '../render/season';
import { TRACK_TILE_M, trackTexture } from '../render/trackpaint';
import type { ChunkContent, ChunkContext, ChunkProvider } from './chunks';
import { tileSurfaceSampler } from './deserttiledata';
import type { RoadDistance } from './roaddistance';
import { TRACK_HALF_WIDTH_M, trackAlong, trackFade, tracksBetween, type Track } from './tracks';

/**
 * Draws the dirt tracks (world/tracks.ts): a ribbon down each, laid on the ground as
 * the tiles draw it (`tileSurfaceSampler`) a few centimetres up, painted with two ruts
 * (render/trackpaint.ts) and transparent between and beside them. A chunk draws the
 * tracks whose junction lies in it. No collider: a rut is the ground it is pressed into.
 */

/** Metres between ribbon rows along a track. */
const STEP_M = 1.5;
/** Columns across a row: enough to follow the ground's cross-fall. */
const ACROSS = [-1, -0.5, 0, 0.5, 1];

// Winter: the ruts are packed snow, greyer than the drifts beside them.
const material = applySnowCover(applyCloudShadow(
  applyComicShading(
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      map: trackTexture(),
      // Coverage, not a cut: the ruts' soft edges and the fade at a track's end resolve
      // to a blend under MSAA.
      alphaTest: 0.02,
      alphaToCoverage: true,
      roughness: 0.95,
      metalness: 0,
      // Both faces: where the track bends hard two rows can cross, and a triangle folded
      // under by that was culled as a notch in the ruts.
      side: THREE.DoubleSide,
      polygonOffset: true,
      // By slope as well: the tiles' ground creases along its triangle diagonals, and a
      // ridge between two of the ribbon's rows poked through it as a straight cut.
      polygonOffsetFactor: -1.5,
      polygonOffsetUnits: -4,
    }),
    { lightingStrength: 0, shadowWarmth: 0, reliefShadeStrength: 0, contourStrength: 0, stippleStrength: 0, spotlightNormals: 'smooth' },
  ),
), 0.85, 0.86);
/** Packed earth of a rut, warm; a little darker where the track is wetter. */
const EARTH = new THREE.Color(0x8e7a5c);

export class TrackProvider implements ChunkProvider {
  readonly id = 'tracks';

  constructor(private readonly roadDistance: RoadDistance) {}

  build(ctx: ChunkContext): ChunkContent | null {
    const tracks = tracksBetween(ctx.world.seed, ctx.sStart, ctx.sEnd);
    if (tracks.length === 0) return null;
    const ground = tileSurfaceSampler({ seed: ctx.world.seed, road: ctx.road, terrain: ctx.terrain, roadDistance: this.roadDistance });
    const group = new THREE.Group();
    const geometries: THREE.BufferGeometry[] = [];
    for (const track of tracks) {
      const g = buildTrack(ctx, track, ground);
      geometries.push(g);
      const mesh = new THREE.Mesh(g, material);
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    return {
      group,
      bodies: [],
      colliders: [],
      dispose: () => {
        for (const g of geometries) g.dispose();
      },
    };
  }
}

function buildTrack(ctx: ChunkContext, track: Track, ground: (x: number, z: number) => number): THREE.BufferGeometry {
  const { road } = ctx;
  const rows = Math.max(2, Math.ceil(track.length / STEP_M) + 1);
  const cols = ACROSS.length;
  const pos = new Float32Array(rows * cols * 3);
  const col = new Float32Array(rows * cols * 4);
  const uv = new Float32Array(rows * cols * 2);
  const centres: THREE.Vector3[] = [];
  const p = new THREE.Vector3();
  for (let r = 0; r < rows; r++) {
    const t = Math.min(track.length, r * STEP_M);
    const along = trackAlong(track, t);
    road.offsetPoint(along, track.side * (road.halfWidthAt(along) + t), p);
    centres.push(p.clone());
  }
  const dir = new THREE.Vector3();
  const across = new THREE.Vector3();
  for (let r = 0; r < rows; r++) {
    const a = centres[Math.max(0, r - 1)]!;
    const b = centres[Math.min(rows - 1, r + 1)]!;
    dir.subVectors(b, a).setY(0).normalize();
    across.set(-dir.z, 0, dir.x);
    const t = Math.min(track.length, r * STEP_M);
    // Out of the asphalt's edge in the first metres, where the shoulder already is.
    const fade = trackFade(track, t) * Math.min(1, t / 3);
    for (let c = 0; c < cols; c++) {
      const w = ACROSS[c]! * TRACK_HALF_WIDTH_M;
      const x = centres[r]!.x + across.x * w;
      const z = centres[r]!.z + across.z * w;
      const i = r * cols + c;
      pos[i * 3] = x - ctx.originX;
      pos[i * 3 + 1] = ground(x, z) + 0.05;
      pos[i * 3 + 2] = z - ctx.originZ;
      col[i * 4] = EARTH.r;
      col[i * 4 + 1] = EARTH.g;
      col[i * 4 + 2] = EARTH.b;
      col[i * 4 + 3] = fade;
      uv[i * 2] = (ACROSS[c]! + 1) / 2;
      uv[i * 2 + 1] = t / TRACK_TILE_M;
    }
  }
  const index: number[] = [];
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = r * cols + c;
      const b = a + cols;
      index.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 4));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  const normals = new Float32Array(pos.length);
  for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
  g.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  g.setIndex(index);
  g.computeBoundingSphere();
  return g;
}
