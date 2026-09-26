import * as THREE from 'three';

import { hash01 } from '../core/rng';
import { roadMaterials } from '../render/look/roadsurface';
import type { ChunkContent, ChunkContext, ChunkProvider } from './chunks';
import { tileSurfaceSampler } from './deserttiledata';
import type { RoadDistance } from './roaddistance';
import { TRACK_HALF_WIDTH_M, trackAlong, trackFade, tracksBetween, type Track } from './tracks';

/**
 * Draws the dirt tracks (world/tracks.ts): a ribbon down each, laid on the ground as
 * the tiles draw it (`tileSurfaceSampler`) a few centimetres up.
 *
 * TWO RUTS AND NOTHING ELSE. The ribbon carries coverage in its vertex alpha and a
 * lateral coordinate per vertex, and the material cuts two troughs out of it
 * (render/look/roadsurface.ts): between them and beside them the alpha is zero, so what
 * shows there is the ground itself — the strip of grass down the middle of a Russian
 * dirt road is real grass on real ground, not a picture of grass drawn on a ribbon.
 * That is also why the ruts are a function of position rather than a tiled texture: the
 * trough is soft-edged and a little over half a metre wide, and the ribbon has five
 * columns across three and a half metres.
 *
 * The surface itself is `public/look/gravel.webp` at the ground's own world period and
 * tint, so a rut is the same material as the packed ground it is pressed into.
 *
 * No collider: a rut is the ground it is pressed into.
 */

/** Metres between ribbon rows along a track. */
const STEP_M = 1.5;
/** Columns across a row: enough to follow the ground's cross-fall and to place the ruts. */
const ACROSS = [-1, -0.5, 0, 0.5, 1];
/** Wavelength (m) of the tonal mottling along a track, and its swing. */
const MOTTLE_WAVELENGTH = 17;
const MOTTLE_AMOUNT = 0.14;
/** Hash domain for one track's own phase in that field. */
const TRACK_TAG = 0x74726b6b; // 'trkk'

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
      const g = this.buildTrack(ctx, track, ground);
      geometries.push(g);
      const mesh = new THREE.Mesh(g, roadMaterials().track);
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

  private buildTrack(ctx: ChunkContext, track: Track, ground: (x: number, z: number) => number): THREE.BufferGeometry {
    const { road } = ctx;
    const rows = Math.max(2, Math.ceil(track.length / STEP_M) + 1);
    const cols = ACROSS.length;
    const pos = new Float32Array(rows * cols * 3);
    const col = new Float32Array(rows * cols * 4);
    const lateral = new Float32Array(rows * cols);
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
      // How trodden this metre of track is: one slow field, so a rut is deeper where the
      // ground is softer rather than uniform down its whole length.
      const phase = hash01(ctx.world.seed, TRACK_TAG, Math.round(track.s0), track.side) * 6.283185;
      // Two incommensurate waves rather than one: their sum does not come round again
      // inside a track's 220 m, and the alternative — a noise object per track — is an
      // allocation per track per chunk for a number that a road's own rutting makes.
      const mottle =
        0.5 + 0.25 * Math.sin(t / MOTTLE_WAVELENGTH + phase) + 0.25 * Math.sin(t / 31.7 + phase * 1.7);
      const tint = 1 - MOTTLE_AMOUNT * mottle;
      for (let c = 0; c < cols; c++) {
        const w = ACROSS[c]! * TRACK_HALF_WIDTH_M;
        const x = centres[r]!.x + across.x * w;
        const z = centres[r]!.z + across.z * w;
        const i = r * cols + c;
        pos[i * 3] = x - ctx.originX;
        pos[i * 3 + 1] = ground(x, z) + 0.05;
        pos[i * 3 + 2] = z - ctx.originZ;
        col[i * 4] = tint;
        col[i * 4 + 1] = tint;
        col[i * 4 + 2] = tint;
        col[i * 4 + 3] = fade;
        lateral[i] = w;
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
    g.setAttribute('aTrackLateral', new THREE.BufferAttribute(lateral, 1));
    const normals = new Float32Array(pos.length);
    for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
    g.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    g.setIndex(index);
    g.computeBoundingSphere();
    return g;
  }
}
