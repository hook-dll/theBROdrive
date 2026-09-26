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

import './domshim';
import * as THREE from 'three';

import { CHUNK_LENGTH, type ChunkContext } from '../src/world/chunks';
import { Road } from '../src/world/road';
import { Terrain } from '../src/world/terrain';
import { MonumentProvider } from '../src/world/props/monuments';
import { describePole, forEachPole } from '../src/world/props/poles';
import { ScatterProvider } from '../src/world/props/scatter';
import { lanesPerSideAt } from '../src/world/roadprofile';

const SEED = Number(process.argv[2] ?? 1337) >>> 0;
/** Authored setbacks, metres from the asphalt edge. See world/props/. */
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

/** Chunks, from 5 on, whose whole span offers `lanes` lanes each way. */
function* chunksWith(lanes: number): Generator<number> {
  for (let chunk = 5; chunk < 4_000; chunk++) {
    const sStart = chunk * CHUNK_LENGTH;
    let all = true;
    for (let s = sStart; s <= sStart + CHUNK_LENGTH; s += 10) {
      if (lanesPerSideAt(SEED, s) !== lanes) {
        all = false;
        break;
      }
    }
    if (all) yield chunk;
  }
}

/**
 * Builds chunks of one width until `enough` measurements are in. The first chunk of a
 * width used to be taken as it came, and in the countryside a pole line has gaps (an
 * era band with no line) and scatter is placed by land cover, so that one chunk often
 * carried nothing and four checks passed judgement on empty sets.
 */
function measureOver(
  lanes: number,
  enough: number,
  build: (context: ChunkContext) => { group: THREE.Group; dispose?: () => void } | null | undefined,
  measure: (group: THREE.Group, hintS: number) => number[],
): { values: number[]; chunks: number } {
  let values: number[] = [];
  let chunks = 0;
  for (const chunk of chunksWith(lanes)) {
    const content = build(contextFor(chunk));
    chunks++;
    if (content) {
      values = values.concat(measure(content.group, chunk * CHUNK_LENGTH + CHUNK_LENGTH * 0.5));
      content.dispose?.();
    }
    if (values.length >= enough || chunks >= 200) break;
  }
  return { values, chunks };
}

// --- poles ---------------------------------------------------------------------
// A chunk batches every pole's meshes into one geometry, so the line is read from its
// own pure description — the pose the provider builds each pole from — and the BASE is
// what the setback is about (the lean and the lamp arm move the meshes off it).
for (const [label, lanes] of [['narrow', 1], ['wide', 2]] as const) {
  const bases: number[] = [];
  let chunks = 0;
  for (const chunk of chunksWith(lanes)) {
    chunks++;
    forEachPole(chunk * CHUNK_LENGTH, (chunk + 1) * CHUNK_LENGTH, (s, index) => {
      const pose = describePole(road, terrain, SEED, s, index);
      const projection = road.project(pose.baseX, pose.baseZ, s);
      bases.push(Math.abs(projection.lateral) - road.halfWidthAt(projection.s));
    });
    if (bases.length >= 12 || chunks >= 200) break;
  }
  const worst = bases.reduce((far, value) => Math.max(far, Math.abs(value - POLE_SETBACK_M)), 0);
  check(
    `the ${label} road's poles stand ${POLE_SETBACK_M} m off its edge`,
    bases.length > 0 && worst < 0.05,
    `${bases.length} poles over ${chunks} chunks, worst error ${(worst * 1000).toFixed(0)} mm`,
  );
}

// --- scatter -------------------------------------------------------------------
// The desert's rocks and cacti stand on Sand and Rock surfaces, which the countryside
// does not have, and the road hazards are off (props/scatter.ts, ROAD_HAZARD_KINDS). So
// the country's requirement is that the provider puts nothing by the road at all; if
// it ever emits again, the desert's setback check applies to what it emits.
const scatter = new ScatterProvider();
for (const [label, lanes] of [['narrow', 1], ['wide', 2]] as const) {
  const { values: measured, chunks } = measureOver(lanes, 20, (context) => scatter.build(context), setbacks);
  const nearest = measured.length > 0 ? Math.min(...measured) : Infinity;
  check(
    `no ${label}-road scatter reaches the verge`,
    measured.length === 0 || nearest >= SCATTER_SETBACK_M - 0.3,
    `${measured.length} props over ${chunks} chunks` + (measured.length > 0 ? `, nearest ${nearest.toFixed(2)} m from the edge` : ' (the country scatters none)'),
  );
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
