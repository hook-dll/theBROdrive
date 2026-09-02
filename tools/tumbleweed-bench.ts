import * as THREE from 'three';
import { TumbleweedField, TUMBLEWEED_CAP } from '../src/agents/tumbleweed';
import { WorldOrigin } from '../src/world/origin';

/**
 * Allocation and fixed-step ceiling probe for the tumbleweed pool. The road and terrain
 * doubles deliberately return one reusable sample object: this measures the field's
 * own spawn/retire path, not an unrelated spline implementation's return allocation.
 */
const sample = { s: 0, x: 0, y: 0, z: 0, heading: 0, grade: 0, curvature: 0 };
const road = {
  sampleAt(s: number) {
    sample.s = s;
    sample.x = 0;
    sample.y = 0;
    sample.z = s;
    sample.heading = 0;
    sample.grade = 0;
    sample.curvature = 0;
    return sample;
  },
};
const terrain = { heightAt: () => 0 };
let burstCount = 0;
const spray = {
  emitBurst: () => {
    burstCount++;
  },
};
const field = new TumbleweedField(
  new THREE.Scene(),
  road as never,
  terrain as never,
  0x0badc0de,
  new WorldOrigin(),
  spray as never,
);

const dt = 1 / 60;
const steps = 72_000;
let worstLive = 0;
const allocationsBefore = field.allocationCount;
const start = performance.now();
for (let step = 0; step < steps; step++) {
  field.update(dt, step * dt * 27, null);
  if (field.liveCount > worstLive) worstLive = field.liveCount;
}
const elapsedMs = performance.now() - start;
const allocationsAfter = field.allocationCount;
if (worstLive > TUMBLEWEED_CAP) throw new Error(`cap failed: ${worstLive} > ${TUMBLEWEED_CAP}`);
if (allocationsBefore !== allocationsAfter) throw new Error('pool allocation count changed during churn');
console.log(`steps=${steps}`);
console.log(`spawned=${field.spawnCount}`);
console.log(`worstLive=${worstLive}/${TUMBLEWEED_CAP}`);
console.log(`updateUsPerStep=${((elapsedMs * 1000) / steps).toFixed(3)}`);
console.log(`poolAllocations=${allocationsBefore}->${allocationsAfter} (steady-state spawn/retire: 0)`);

/**
 * THE HIT PATH, which the population probe above never exercises because it drives
 * with no impactor at all.
 *
 * A car-sized impactor is walked straight down the road until the field reports a
 * strike, then three things must all be true in the same step: the hit is reported (so
 * main.ts can nudge the chassis and play its clunk), the spray was asked for a burst
 * (so the weed visibly disintegrates), and the weed is gone from the pool (so nothing
 * is left to hit twice).
 */
const impactor = {
  x: 0, y: 0, z: 0,
  fx: 0, fz: 1,
  halfWidth: 0.8, halfLength: 1.95,
  vx: 0, vy: 0, vz: 25,
};
const hitField = new TumbleweedField(
  new THREE.Scene(),
  road as never,
  terrain as never,
  0x0badc0de,
  new WorldOrigin(),
  spray as never,
);
burstCount = 0;
let hits = 0;
let liveBeforeHit = 0;
let liveAfterHit = 0;
let burstsAtHit = 0;
for (let step = 0; step < 6000 && hits === 0; step++) {
  impactor.z += impactor.vz * dt;
  liveBeforeHit = hitField.liveCount;
  const hit = hitField.update(dt, impactor.z, impactor as never);
  if (hit.count > 0) {
    hits = hit.count;
    burstsAtHit = burstCount;
    liveAfterHit = hitField.liveCount;
  }
}
if (hits === 0) throw new Error('a car driven down the road never met a tumbleweed');
if (burstsAtHit !== hits) throw new Error(`hit did not emit its burst: ${burstsAtHit} for ${hits}`);
if (liveAfterHit !== liveBeforeHit - hits) {
  throw new Error(`struck weed not retired: ${liveBeforeHit} -> ${liveAfterHit}`);
}
console.log(`hit at z=${impactor.z.toFixed(0)} m: hits=${hits} bursts=${burstsAtHit} live ${liveBeforeHit}->${liveAfterHit}`);
