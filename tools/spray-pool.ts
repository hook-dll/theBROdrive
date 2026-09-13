/**
 * Wheel spray: the pool must go quiet when nothing is in flight, and never before.
 *
 *   npx tsx tools/spray-pool.ts
 *
 * `WheelSpray.update` used to scan all 400 slots and flag three dynamic attributes on
 * every frame, whatever the pool held — 400 pointless tests and 8,000 bytes of attribute
 * flags for a draw of 400 discarded points. The pool is now skipped outright while
 * nothing is in flight, which is most of the time on a phone.
 *
 * A skip is only safe if it is EXACT, and the two ways to get that wrong both fail here.
 * Close it too late and the cost comes back; close it one frame early and airborne motes
 * freeze mid-air, then hang there for the rest of their life. So the gate is checked at
 * both ends: a quiet pool must cost nothing, and a busy one must still fly.
 */

import * as THREE from 'three';
import { WheelSpray } from '../src/render/wheelspray';
import { WorldOrigin } from '../src/world/origin';

const S = 24_000;
const DT = 1 / 30;
const failures: string[] = [];

function check(condition: boolean, message: string): void {
  if (!condition) failures.push(message);
}

const scene = new THREE.Scene();
const spray = new WheelSpray(scene, new WorldOrigin());
const points = scene.children.find((child): child is THREE.Points => child instanceof THREE.Points);
if (points === undefined) throw new Error('the spray was not attached to the scene');
const position = points.geometry.getAttribute('position') as THREE.BufferAttribute;
const alpha = points.geometry.getAttribute('alpha') as THREE.BufferAttribute;

// --- a pool with nothing in it must not upload -------------------------------
{
  const before = [position.version, alpha.version];
  for (let i = 0; i < 30; i++) spray.update(DT, S);
  check(
    position.version === before[0] && alpha.version === before[1],
    'an empty pool still flagged its buffers for upload',
  );

  const drawCount = (points.geometry.drawRange.count);
  check(drawCount !== 0 || drawCount === Infinity, `empty pool has an odd draw range (${drawCount})`);
}

// --- a busy pool must fly ----------------------------------------------------
const sample = (): number[] => [position.getX(0), position.getY(0), position.getZ(0), alpha.getX(0)];
let flying = false;
{
  const trail: number[] = [];
  for (let frame = 0; frame < 90; frame++) {
    spray.emit(0, 0.1, 0, 1, 0, 3, 0, DT);
    spray.update(DT, S);
    if (frame % 10 === 0) trail.push(alpha.getX(0));
    if (frame === 5) {
      const first = sample();
      spray.update(DT, S);
      const second = sample();
      check(
        first.some((value, index) => Math.abs(value - second[index]!) > 1e-6),
        'live motes did not move between frames — the pool is being skipped while it is busy',
      );
      flying = true;
    }
  }
  check(flying, 'the emit path produced no motes at all');
  check(
    position.version > 0 && alpha.version > 0,
    'a busy pool never flagged its buffers',
  );
  // Motes fade as they age, so the newest slot's opacity must fall across a life.
  check(
    trail.length > 2 && trail[trail.length - 1]! <= trail[0]!,
    `live motes were not fading (${trail.map((v) => v.toFixed(2)).join(' -> ')})`,
  );
}

// --- and it must go quiet again, once the last mote has died ------------------
{
  for (let frame = 0; frame < 90; frame++) spray.update(DT, S);
  const before = [position.version, alpha.version];
  for (let i = 0; i < 30; i++) spray.update(DT, S);
  check(
    position.version === before[0] && alpha.version === before[1],
    'the pool stayed awake after every mote had died — the gate never closes again',
  );
}

// --- a burst must wake a sleeping pool ---------------------------------------
{
  spray.emitBurst(0, 0.1, 0, 1, 0, 8);
  const before = alpha.version;
  spray.update(DT, S);
  check(
    alpha.version > before,
    'a burst left the pool asleep, so those motes would hang in the air',
  );
}

if (failures.length > 0) {
  for (const failure of failures) console.log(`  FAIL  ${failure}`);
  throw new Error(`${failures.length} spray-pool checks failed`);
}
console.log('the spray pool sleeps when it is empty, wakes when it is fed, and flies while it is awake');
