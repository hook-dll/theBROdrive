/**
 * The access lane as a wheel meets it, for tools/racetrack-gen.ts: across the lane, from
 * its centre to `PAST_EDGE_M` past its edge (past the widest shoulder) every 0.25 m, at
 * every third station along it, three heights —
 *
 *   drawn     the lane mesh the chunk draws (ray against the geometry),
 *   collider  the track's colliders (ray against the physics world it was built into),
 *   ground    the desert AS THE TILES DRAW IT (`tileGroundSampler`): their lattice, whose
 *             nodes are also the heightfield collider's. Between nodes that is a plane
 *             decimetres off `Terrain.heightAt`, so the function is not what a wheel
 *             meets past the shoulder,
 *
 * and from them what a wheel stands on (`support`: the higher of the collider and the
 * ground) and how it changes. Reported: the worst |drawn - collider| where both exist,
 * the worst the drawn surface stands above the support (a wheel seen sunk into the
 * lane), and the worst jump in support between neighbouring samples (a step a
 * suspension kicks at), with where it was.
 */

import * as THREE from 'three';
import type { PhysicsWorld } from '../src/core/physics';
import type { DrawnGroundSample } from '../src/world/deserttiledata';
import type { RaceTrack } from '../src/world/racetrack/track';

export interface LaneMeasure {
  samples: number;
  drawnVsCollider: number;
  sink: number;
  sinkAt: string;
  step: number;
  stepAt: string;
}

export function newLaneMeasure(): LaneMeasure {
  return { samples: 0, drawnVsCollider: 0, sink: 0, sinkAt: '', step: 0, stepAt: '' };
}

const ACROSS_STEP_M = 0.25;
const PAST_EDGE_M = 14;
const STATION_STRIDE = 3;

/**
 * Measures one track's lane into `into`. `group` is the chunk's built group (the lane
 * mesh is the one named 'racetrack-lane'), `physics` a world holding that build's
 * colliders, ENABLED and with its scene queries updated (one `step()`),
 * origin-relative at (`originX`, `originZ`); `ground` a `tileGroundSampler`.
 */
export function measureLane(
  track: RaceTrack,
  group: THREE.Object3D,
  physics: PhysicsWorld,
  ground: (x: number, z: number, out: DrawnGroundSample) => void,
  originX: number,
  originZ: number,
  into: LaneMeasure,
): void {
  const sample: DrawnGroundSample = { height: 0, detail: 0, nx: 0, ny: 1, nz: 0 };
  const mesh = group.getObjectByName('racetrack-lane') as THREE.Mesh;
  mesh.updateMatrixWorld(true);
  const raycaster = new THREE.Raycaster();
  const from = new THREE.Vector3();
  const down = new THREE.Vector3(0, -1, 0);
  const lane = track.accessLane;
  const hw = track.laneHalfWidth;
  for (let i = STATION_STRIDE; i + STATION_STRIDE < lane.length; i += STATION_STRIDE) {
    const a = lane[i - 1]!;
    const b = lane[i + 1]!;
    const length = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const dx = (b.x - a.x) / length;
    const dz = (b.z - a.z) / length;
    for (const sign of [-1, 1]) {
      let previous = Number.NaN;
      let previousGround = Number.NaN;
      for (let u = 0; u <= hw + PAST_EDGE_M + 1e-9; u += ACROSS_STEP_M) {
        // Left of the lane's direction (dx, dz) is (dz, -dx).
        const x = lane[i]!.x + dz * u * sign;
        const z = lane[i]!.z - dx * u * sign;
        ground(x, z, sample);
        const groundY = sample.height;
        const top = groundY + 30;
        raycaster.set(from.set(x - originX, top, z - originZ), down);
        const drawnHit = raycaster.intersectObject(mesh, false)[0];
        const drawn = drawnHit ? drawnHit.point.y : Number.NaN;
        // A ray exactly down a shared triangle edge can slip between the two triangles
        // (Rapier's ray-trimesh test, not the collider): retry 2 mm off it.
        const hit =
          physics.raycast({ x: x - originX, y: top, z: z - originZ }, { x: 0, y: -1, z: 0 }, 60) ??
          physics.raycast({ x: x - originX + 0.002, y: top, z: z - originZ + 0.002 }, { x: 0, y: -1, z: 0 }, 60);
        const collider = hit ? hit.point.y : Number.NaN;
        const support = Number.isNaN(collider) ? groundY : Math.max(collider, groundY);
        const where =
          `${track.id} at ${(track.postS / 1000).toFixed(1)} km, station ${i} of ${lane.length}, ${(u * sign).toFixed(2)} m across ` +
          `(half width ${hw}), world x ${x.toFixed(1)} z ${z.toFixed(1)}`;
        into.samples++;
        if (!Number.isNaN(drawn) && !Number.isNaN(collider)) into.drawnVsCollider = Math.max(into.drawnVsCollider, Math.abs(drawn - collider));
        if (!Number.isNaN(drawn) && drawn - support > into.sink) {
          into.sink = drawn - support;
          into.sinkAt = `${where}: drawn ${drawn.toFixed(2)}, collider ${Number.isNaN(collider) ? 'none' : collider.toFixed(2)}, ground ${groundY.toFixed(2)}`;
        }
        // The jump the lane adds: what a wheel stands on changes by more than the
        // desert under it does (a steep dune flank past the shoulder is the desert's own).
        if (!Number.isNaN(previous)) {
          const jump = Math.abs(support - previous) - Math.abs(groundY - previousGround);
          if (jump > into.step) {
            into.step = jump;
            into.stepAt = `${where}: ${(Math.abs(support - previous) * 100).toFixed(1)} cm against the desert's own ${(Math.abs(groundY - previousGround) * 100).toFixed(1)} cm`;
          }
        }
        previous = support;
        previousGround = groundY;
      }
    }
  }
}
