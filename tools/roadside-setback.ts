/**
 * Everything beside the road keeps its distance from the ROAD, not from the crown.
 *
 * The carriageway widens (`world/roadprofile.ts`), so a prop authored at a fixed
 * lateral is 6 m clear of a narrow road and standing on the paint of a wide one.
 * Poles, scattered rocks and cacti, and the distance monuments are all authored as a
 * SETBACK from the asphalt edge; this measures what the real providers emit against
 * the local edge, on a narrow chunk and on a fully widened one.
 *
 *   bun tools/roadside-setback.ts [seed]
 *
 * Nothing here is part of the game bundle.
 */

import * as THREE from 'three';

import { CHUNK_LENGTH, type ChunkContext } from '../src/world/chunks';
import { Road } from '../src/world/road';
import { Terrain } from '../src/world/terrain';
import { MonumentProvider, PoleProvider, ScatterProvider } from '../src/world/props';
import { lanesPerSideAt } from '../src/world/roadprofile';
import { installDocumentShim } from './domshim';

installDocumentShim();

const SEED = Number(process.argv[2] ?? 1337) >>> 0;
/** Authored setbacks, metres from the asphalt edge. See props.ts. */
const POLE_SETBACK_M = 3.1;
const SCATTER_SETBACK_M = 6.1;
const MONUMENT_MIN_SETBACK_M = 3.6;

const road = new Road(SEED);
const terrain = new Terrain(SEED, road);

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(50)} ${detail}`);
}

function contextFor(chunkIndex: number): ChunkContext {
  return {
    chunkIndex,
    sStart: chunkIndex * CHUNK_LENGTH,
    sEnd: (chunkIndex + 1) * CHUNK_LENGTH,
    road,
    terrain,
    physics: null,
    world: { seed: SEED },
    hasPhysics: false,
    originX: 0,
    originZ: 0,
  } as unknown as ChunkContext;
}

/** Setback of every world-space point in a group, measured from the local edge. */
function setbacks(group: THREE.Object3D, hintS: number): number[] {
  const out: number[] = [];
  const world = new THREE.Vector3();
  group.updateMatrixWorld(true);
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh) && !(object instanceof THREE.InstancedMesh)) return;
    const positions: THREE.Vector3[] = [];
    if (object instanceof THREE.InstancedMesh) {
      const matrix = new THREE.Matrix4();
      for (let i = 0; i < object.count; i++) {
        object.getMatrixAt(i, matrix);
        positions.push(new THREE.Vector3().setFromMatrixPosition(matrix).applyMatrix4(object.matrixWorld));
      }
    } else {
      positions.push(world.setFromMatrixPosition(object.matrixWorld).clone());
    }
    for (const position of positions) {
      const projection = road.project(position.x, position.z, hintS);
      out.push(Math.abs(projection.lateral) - road.halfWidthAt(projection.s));
    }
  });
  return out;
}

/** First chunk whose whole span offers `lanes` lanes each way. */
function findChunk(lanes: number): number {
  for (let chunk = 5; chunk < 4_000; chunk++) {
    const sStart = chunk * CHUNK_LENGTH;
    let all = true;
    for (let s = sStart; s <= sStart + CHUNK_LENGTH; s += 10) {
      if (lanesPerSideAt(SEED, s) !== lanes) {
        all = false;
        break;
      }
    }
    if (all) return chunk;
  }
  throw new Error(`no ${lanes}-lane chunk found`);
}

const narrowChunk = findChunk(1);
const wideChunk = findChunk(2);
console.log(
  `seed ${SEED}: narrow chunk ${narrowChunk} (s ${narrowChunk * CHUNK_LENGTH}), ` +
    `wide chunk ${wideChunk} (s ${wideChunk * CHUNK_LENGTH})`,
);

// --- poles ---------------------------------------------------------------------
// A pole's own group sits at its base; the lean and the lamp arm move the meshes off
// it, so the BASE is what the setback is about and it is read from the group.
const poles = new PoleProvider();
for (const [label, chunk] of [['narrow', narrowChunk], ['wide', wideChunk]] as const) {
  const content = poles.build(contextFor(chunk));
  const hintS = chunk * CHUNK_LENGTH + CHUNK_LENGTH * 0.5;
  const bases: number[] = [];
  for (const child of content.group.children) {
    if (!(child instanceof THREE.Group)) continue;
    const projection = road.project(child.position.x, child.position.z, hintS);
    bases.push(Math.abs(projection.lateral) - road.halfWidthAt(projection.s));
  }
  const worst = bases.reduce((far, value) => Math.max(far, Math.abs(value - POLE_SETBACK_M)), 0);
  check(
    `the ${label} road's poles stand ${POLE_SETBACK_M} m off its edge`,
    bases.length > 0 && worst < 0.05,
    `${bases.length} poles, worst error ${(worst * 1000).toFixed(0)} mm`,
  );
  content.dispose?.();
}

// --- scatter -------------------------------------------------------------------
const scatter = new ScatterProvider();
for (const [label, chunk] of [['narrow', narrowChunk], ['wide', wideChunk]] as const) {
  const content = scatter.build(contextFor(chunk));
  if (!content) continue;
  const hintS = chunk * CHUNK_LENGTH + CHUNK_LENGTH * 0.5;
  const measured = setbacks(content.group, hintS);
  const nearest = measured.length > 0 ? Math.min(...measured) : Infinity;
  check(
    `no ${label}-road scatter reaches the verge`,
    measured.length > 0 && nearest >= SCATTER_SETBACK_M - 0.3,
    `${measured.length} props, nearest ${nearest.toFixed(2)} m from the edge`,
  );
  content.dispose?.();
}

// --- monuments -----------------------------------------------------------------
// They stand every 20 km, so a chunk almost never holds one: walk enough chunks to
// find some on each width instead of demanding them in the sampled pair.
const monuments = new MonumentProvider();
for (const [label, lanes] of [['narrow', 1], ['wide', 2]] as const) {
  let measured: number[] = [];
  for (let chunk = 5; chunk < 4_000 && measured.length < 3; chunk++) {
    const s = chunk * CHUNK_LENGTH;
    if (s % 20_000 !== 0 || lanesPerSideAt(SEED, s) !== lanes) continue;
    const content = monuments.build(contextFor(chunk));
    measured = measured.concat(setbacks(content.group, s));
    content.dispose?.();
  }
  const nearest = measured.length > 0 ? Math.min(...measured) : Infinity;
  check(
    `${label}-road monuments stand clear of the paint`,
    measured.length > 0 && nearest >= MONUMENT_MIN_SETBACK_M - 1.2,
    `${measured.length} parts measured, nearest ${nearest.toFixed(2)} m from the edge`,
  );
}

console.log(failures === 0 ? '\nthe roadside keeps its distance' : `\n${failures} checks failed`);
process.exit(failures === 0 ? 0 : 1);
