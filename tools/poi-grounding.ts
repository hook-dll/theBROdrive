/**
 * Nothing a POI is built from hangs in the air.
 *
 * The desert is dunes: measured through the real generators, the ground under a 14 m
 * footprint carries 1.5 m of height range at a 9-10% tilt. A structure placed from a
 * single centre sample therefore stands on one corner and floats on the other three,
 * which is exactly what this proves is no longer happening.
 *
 * Every static piece of every stop in a stretch of road is checked to be either
 * GROUNDED (its lowest vertex reaches the terrain under it) or CARRIED (something
 * else in the same stop spans that ground and reaches its underside) — a roof is
 * carried by its posts, a tool is carried by the bench, a pump stands on the apron.
 * Anything that is neither is a thing visibly hanging over sand.
 *
 *   npx tsx tools/poi-grounding.ts [seed]
 *
 * Nothing here is part of the game bundle.
 */

import * as THREE from 'three';

import { GameWorld, newWorldState } from '../src/game/state';
import { CHUNK_LENGTH, type ChunkContext } from '../src/world/chunks';
import { Road } from '../src/world/road';
import { Terrain } from '../src/world/terrain';
import { PoiProvider, poisBetween, type PoiKind } from '../src/world/poi';
import type { LoosePartField } from '../src/parts/loose';
import type { TrailerField } from '../src/vehicle/trailer';
import type { WreckTrunkField } from '../src/world/wrecktrunks';
import type { CourierField } from '../src/world/couriers';

const SEED = Number(process.argv[2] ?? 1337) >>> 0;
/** Chunks walked. 60 chunks is 12 km of road, around 10 stops. */
const CHUNKS = 300;
/** A piece may hang this far over its support before it reads as floating. */
const TOLERANCE_M = 0.12;

const road = new Road(SEED);
const terrain = new Terrain(SEED, road);
const world = new GameWorld(newWorldState(SEED));

const noLoose = {
  spawnItem: () => {},
  spawnPart: () => {},
  forget: () => {},
} as unknown as LoosePartField;
const noTrailers = { spawn: () => {}, forget: () => {} } as unknown as TrailerField;
const noWreckTrunks = { register: () => {}, forget: () => {} } as unknown as WreckTrunkField;
const noCouriers = { register: () => {}, forget: () => {} } as unknown as CourierField;

const provider = new PoiProvider(noLoose, noTrailers, noWreckTrunks, noCouriers);

interface Piece {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  readonly minZ: number;
  readonly maxZ: number;
}

function pieceOf(mesh: THREE.Mesh): Piece {
  mesh.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(mesh);
  return {
    minX: box.min.x,
    maxX: box.max.x,
    minY: box.min.y,
    maxY: box.max.y,
    minZ: box.min.z,
    maxZ: box.max.z,
  };
}

/** Highest terrain under a piece's footprint: what its underside has to reach. */
function groundUnder(piece: Piece, hintS: number): number {
  let top = -Infinity;
  for (let i = 0; i <= 2; i++) {
    for (let j = 0; j <= 2; j++) {
      const x = piece.minX + ((piece.maxX - piece.minX) * i) / 2;
      const z = piece.minZ + ((piece.maxZ - piece.minZ) * j) / 2;
      const h = terrain.heightAt(x, z, hintS);
      if (h > top) top = h;
    }
  }
  return top;
}

function overlapsXZ(a: Piece, b: Piece): boolean {
  return a.minX < b.maxX && b.minX < a.maxX && a.minZ < b.maxZ && b.minZ < a.maxZ;
}

interface KindStat {
  pieces: number;
  floating: number;
  /** Posts and legs that stop short of the thing standing on them. */
  shortMembers: number;
  worstGap: number;
  worstS: number;
}

const stats = new Map<PoiKind | 'courier', KindStat>();
function statFor(kind: PoiKind | 'courier'): KindStat {
  let stat = stats.get(kind);
  if (!stat) {
    stat = { pieces: 0, floating: 0, shortMembers: 0, worstGap: 0, worstS: 0 };
    stats.set(kind, stat);
  }
  return stat;
}

let stops = 0;
for (let chunk = 0; chunk < CHUNKS; chunk++) {
  const sStart = chunk * CHUNK_LENGTH;
  const sEnd = sStart + CHUNK_LENGTH;
  const pois = poisBetween(SEED, sStart, sEnd, world.state.settings.poiSpacingMetres);
  if (pois.length === 0) continue;

  const ctx = {
    chunkIndex: chunk,
    sStart,
    sEnd,
    road,
    terrain,
    world,
    hasPhysics: false,
    originX: 0,
    originZ: 0,
  } as unknown as ChunkContext;

  const content = provider.build(ctx);
  if (!content) continue;
  const meshes: THREE.Mesh[] = [];
  content.group.traverse((object) => {
    if (object instanceof THREE.Mesh) meshes.push(object);
  });
  const pieces = meshes.map(pieceOf);

  for (const poi of pois) {
    stops++;
    const anchor = road.offsetPoint(poi.s, poi.lateral);
    // Pieces of THIS stop: the nearest anchor owns them. Stops are 1.2 km apart, so
    // a 30 m radius cannot claim a neighbour's.
    const owned: number[] = [];
    for (let i = 0; i < pieces.length; i++) {
      const piece = pieces[i]!;
      const cx = (piece.minX + piece.maxX) / 2 - anchor.x;
      const cz = (piece.minZ + piece.maxZ) / 2 - anchor.z;
      if (cx * cx + cz * cz < 30 * 30) owned.push(i);
    }
    const stat = statFor(poi.kind);
    for (const i of owned) {
      const piece = pieces[i]!;
      stat.pieces++;
      const ground = groundUnder(piece, poi.s);
      const gap = piece.minY - ground;
      if (gap <= TOLERANCE_M) continue;
      // Supported: something else in the same stop starts below this piece's
      // underside, spans the same ground, and reaches up to it — a post under a
      // roof, a pump body behind its display panel, a bench under a tool.
      let carried = false;
      for (const j of owned) {
        if (j === i) continue;
        const other = pieces[j]!;
        if (other.minY >= piece.minY - 1e-6) continue;
        if (!overlapsXZ(piece, other)) continue;
        if (other.maxY >= piece.minY - TOLERANCE_M) {
          carried = true;
          break;
        }
      }
      if (carried) continue;
      stat.floating++;
      if (gap > stat.worstGap) {
        stat.worstGap = gap;
        stat.worstS = poi.s;
        console.log(
          `        floating ${(piece.maxX - piece.minX).toFixed(1)}x${(piece.maxY - piece.minY).toFixed(1)}x${(piece.maxZ - piece.minZ).toFixed(1)} m ` +
            `at s=${poi.s.toFixed(0)}, ${gap.toFixed(2)} m over the sand`,
        );
      }
    }

    // A POST OR A LEG HAS TO REACH WHAT STANDS ON IT.
    //
    // This is the failure a level roof over sloping ground actually produces: the
    // four posts each find their own footing, the roof is hung at one sampled
    // height, and the posts on the low side end half a metre short of it. Nothing
    // is floating in the ground test above — the posts are on the sand and the roof
    // is over the posts — so the gap only shows up as a joint.
    for (const i of owned) {
      const member = pieces[i]!;
      const width = Math.max(member.maxX - member.minX, member.maxZ - member.minZ);
      const height = member.maxY - member.minY;
      if (width > 0.6 || height < 0.5) continue;
      let carriedTop = -Infinity;
      for (const j of owned) {
        if (j === i) continue;
        const other = pieces[j]!;
        if (!overlapsXZ(member, other)) continue;
        if (other.maxY <= member.maxY - 1e-6) continue;
        carriedTop = Math.max(carriedTop, member.maxY - other.minY);
      }
      if (carriedTop === -Infinity) continue; // carries nothing: a pole, a sign
      if (carriedTop >= -TOLERANCE_M) continue;
      stat.shortMembers++;
      console.log(
        `        ${width.toFixed(2)} m member ${(-carriedTop).toFixed(2)} m short of its load ` +
          `at s=${poi.s.toFixed(0)}`,
      );
    }
  }
  content.dispose?.();
}

let failures = 0;
console.log(`seed ${SEED}: ${stops} stops over ${(CHUNKS * CHUNK_LENGTH) / 1000} km`);
for (const [kind, stat] of stats) {
  const ok = stat.floating === 0 && stat.shortMembers === 0;
  if (!ok) failures++;
  console.log(
    `  ${ok ? 'ok  ' : 'FAIL'}  ${kind.padEnd(16)} ${String(stat.pieces).padStart(4)} pieces, ` +
      `${stat.floating} floating, ${stat.shortMembers} short members` +
      (stat.floating > 0 ? `, worst ${stat.worstGap.toFixed(2)} m at s=${stat.worstS.toFixed(0)}` : ''),
  );
}

console.log(
  failures === 0
    ? '\nnothing floats and every member reaches its load'
    : `\n${failures} kinds have pieces off the ground`,
);
process.exit(failures === 0 ? 0 : 1);
