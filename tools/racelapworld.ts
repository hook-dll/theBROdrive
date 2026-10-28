/**
 * A race track's ground for the headless benches (tools/racetrack-gen.ts,
 * tools/race-bench.ts): the real collider, and a sand apron where the game has the
 * levelled desert.
 *
 * The ribbon is the game's own (`buildTrackRibbon`, `addTrackRibbonColliders`: slabs by
 * surface), and so are the chicanes' rocks and logs (`addChicaneBlockerColliders`), so a
 * car that cuts a chicane hits what it would hit in the game. The desert the game's
 * tiles draw either side — the track's plane carried across the run-off, then flat
 * sand — is a trimesh strip each side, so a car that runs wide lands on what it would
 * land on in the game.
 */

import type { PhysicsWorld } from '../src/core/physics';
import { SurfaceType } from '../src/core/surfaces';
import type { WorldOrigin } from '../src/world/origin';
import { addChicaneBlockerColliders, addTrackRibbonColliders, buildTrackRibbon } from '../src/world/racetrack/mesh';
import { RUNOFF_M } from '../src/world/racetrack/site';
import type { RaceTrack } from '../src/world/racetrack/track';

export function buildLapGround(physics: PhysicsWorld, origin: WorldOrigin, track: RaceTrack): void {
  const ribbon = buildTrackRibbon(track, origin.x, origin.z);
  addTrackRibbonColliders(physics, ribbon, true, [], []);
  addChicaneBlockerColliders(physics, track, origin.x, origin.z, true, [], []);
  for (const side of [-1, 1]) {
    const columns = [track.halfWidth + 1.1, track.halfWidth + RUNOFF_M, track.halfWidth + RUNOFF_M + 20];
    const rowsCount = Math.round(track.lengthM / 2);
    const vertices = new Float32Array(rowsCount * columns.length * 3);
    const point = { x: 0, y: 0, z: 0 };
    for (let r = 0; r < rowsCount; r++) {
      const s = (r * track.lengthM) / rowsCount;
      columns.forEach((u, c) => {
        const lateral = side * u;
        const clamped = side * Math.min(u, track.halfWidth + RUNOFF_M);
        track.offsetPoint(s, lateral, point);
        vertices.set([point.x - origin.x, track.surfaceY(s, clamped) - 0.02, point.z - origin.z], (r * columns.length + c) * 3);
      });
    }
    const indices: number[] = [];
    for (let r = 0; r < rowsCount; r++) {
      const next = (r + 1) % rowsCount;
      for (let c = 0; c < columns.length - 1; c++) {
        const a = r * columns.length + c;
        const b = next * columns.length + c;
        indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
    physics.addStaticTrimesh(vertices, Uint32Array.from(indices), SurfaceType.Sand);
  }
}
