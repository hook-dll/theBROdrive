/**
 * tools/bird-perch.ts
 *
 * Where are the birds actually standing?
 *
 * Runs the REAL `BirdFlock` against the real road and terrain — it is a kinematic
 * system with no Rapier and no loaded assets, so it runs in Node — and reads the
 * answer out of the instanced mesh the game draws, which is the only honest place to
 * read it from. Every instance is projected back onto the road and compared with the
 * road surface under it.
 *
 * A bird is then one of three things:
 *
 *   standing   within a few centimetres of the surface beneath it
 *   flying     up at something like its species' cruise altitude
 *   HOVERING   stationary, metres up, on nothing — the bug this exists to catch
 *
 * It also drives a car past a flock and checks the round trip: they leave the road as
 * it arrives, and they are back down on it a while after it has gone.
 *
 *   npx tsx tools/bird-perch.ts
 *
 * Nothing here is part of the game bundle.
 */

import * as THREE from 'three';
import { BirdFlock } from '../src/agents/birds';
import { WorldOrigin } from '../src/world/origin';
import { ROAD_HALF_WIDTH, Road } from '../src/world/road';
import { Terrain } from '../src/world/terrain';

/** Height above the surface inside which a bird counts as standing on it. */
const STANDING_TOLERANCE = 0.25;
/** Height above the surface past which a stationary bird counts as hovering. */
const HOVER_FLOOR = 0.6;
const FIXED_DT = 1 / 60;

const SEEDS = [1, 7, 42, 1337];

interface Census {
  standing: number;
  flying: number;
  hovering: number;
  offRoad: number;
  worstHover: number;
}

function census(
  mesh: THREE.InstancedMesh,
  count: number,
  road: Road,
  terrain: Terrain,
  hintS: number,
  previous: Map<number, THREE.Vector3>,
): Census {
  const out: Census = { standing: 0, flying: 0, hovering: 0, offRoad: 0, worstHover: 0 };
  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    mesh.getMatrixAt(i, m);
    p.setFromMatrixPosition(m);
    const was = previous.get(i);
    const moved = was ? p.distanceTo(was) > 0.02 : true;
    previous.set(i, p.clone());

    // GLOBAL projection, not a hinted one. A hinted refine walks downhill from the
    // hint, and a bird 400 m along the road from the observer is far enough for that
    // to settle on the wrong stretch — which reports a bird standing on the asphalt as
    // standing hundreds of metres out in the desert. A millisecond a bird is nothing
    // here and the answer is then the honest one.
    const proj = road.project(p.x, p.z);
    const surface = terrain.heightFromFrame(p.x, p.z, proj.lateral, proj.s);
    const above = p.y - surface;

    if (above <= STANDING_TOLERANCE) {
      out.standing++;
      if (Math.abs(proj.lateral) > ROAD_HALF_WIDTH) out.offRoad++;
    } else if (moved) {
      out.flying++;
    } else if (above >= HOVER_FLOOR) {
      out.hovering++;
      if (above > out.worstHover) out.worstHover = above;
    } else {
      out.standing++;
    }
  }
  return out;
}

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(38)} ${detail}`);
}

let totalStanding = 0;
let totalOffRoad = 0;
let totalHovering = 0;
let worstHover = 0;
let seedsThatScattered = 0;
let seedsThatReturned = 0;

for (const seed of SEEDS) {
  const road = new Road(seed);
  const terrain = new Terrain(seed, road);
  const origin = new WorldOrigin();
  const scene = new THREE.Scene();
  const flock = new BirdFlock(scene, road, terrain, seed, origin);
  // The flock's mesh is the only child it adds. `children` is typed as the Object3D
  // base, which cannot express that it is an InstancedMesh.
  const mesh = scene.children[0] as unknown as THREE.InstancedMesh;
  const previous = new Map<number, THREE.Vector3>();

  // Walk the road slowly, stopping to look. Slowly, because the alert radius grows
  // with speed and a car scares everything from 50 m out: to see anything STANDING at
  // all, the observer has to be creeping. Several stops, because whether a given group
  // has anyone on the ground is a species-and-hash lottery.
  let scattered = 0;
  let returned = 0;
  for (let stop = 0; stop < 6; stop++) {
    const parkedS = 18_000 + stop * 900;
    const parked = road.sampleAt(parkedS);
    for (let i = 0; i < 240; i++) {
      flock.update(FIXED_DT, parkedS, parked.x, parked.y + 1.6, parked.z);
    }
    previous.clear();
    census(mesh, mesh.count, road, terrain, parkedS, previous);
    for (let i = 0; i < 60; i++) {
      flock.update(FIXED_DT, parkedS, parked.x, parked.y + 1.6, parked.z);
    }
    const resting = census(mesh, mesh.count, road, terrain, parkedS, previous);
    totalStanding += resting.standing;
    totalOffRoad += resting.offRoad;
    totalHovering += resting.hovering;
    if (resting.worstHover > worstHover) worstHover = resting.worstHover;
    if (resting.standing > 0) returned++;

    // Now drive through at speed and see them go up.
    for (let step = 0; step < 900; step++) {
      const s = parkedS + step * 0.35;
      const at = road.sampleAt(s);
      flock.update(FIXED_DT, s, at.x, at.y + 1.4, at.z);
      if (step % 150 === 0) {
        const c = census(mesh, mesh.count, road, terrain, s, previous);
        if (c.flying > 0) scattered++;
      }
    }
  }
  if (scattered > 0) seedsThatScattered++;
  if (returned > 0) seedsThatReturned++;
  console.log(
    `seed ${seed}: scattered at ${scattered} sample points, ` +
      `birds standing at ${returned} of 6 stops`,
  );
  flock.dispose();
}

check('nothing sits in the sky', totalHovering === 0, `${totalHovering} hovering, worst ${worstHover.toFixed(2)} m up`);
check('everything standing is on the road', totalOffRoad === 0, `${totalOffRoad} of ${totalStanding} off the asphalt`);
check('birds do stand on the road', totalStanding > 0, `${totalStanding} sightings`);
check('a car puts them up', seedsThatScattered === SEEDS.length, `${seedsThatScattered}/${SEEDS.length} seeds`);
check('they settle back onto it', seedsThatReturned === SEEDS.length, `${seedsThatReturned}/${SEEDS.length} seeds`);

console.log(failures === 0 ? 'all checks passed' : `${failures} CHECK(S) FAILED`);
process.exitCode = failures === 0 ? 0 : 1;
