/**
 * tools/tyre-ab.ts
 *
 * The side-force curve against the brush tyre (vehicletuning.ts `TYRE_MODEL`), car by
 * car, on the same two tests:
 *
 *   limit   the best steady lateral g held at 70 km/h over a sweep of steering
 *           inputs, and the steer it took: how much the car pulls and how much lock
 *           it asks for at the edge
 *   step    a steering step at 90 km/h: the yaw rate it settles at, how far the first
 *           swing overshoots that, and how long the response takes to reach 90% of
 *           it — how quick and how settled the car feels turning in
 *
 * Only cars that name their tyre differ; the rest print the same row twice.
 *
 *   bun tools/tyre-ab.ts [modelId ...]
 *
 * Nothing here is part of the game bundle.
 */

import { installAssetShim } from './assetshim';
import { installDocumentShim } from './domshim';
import { preloadCarModels } from '../src/render/carmodel';
import { TYRE_MODEL } from '../src/vehicle/vehicletuning';
import { makeRig, drive } from './handling-bench';

installAssetShim();
installDocumentShim();

const ids = process.argv.slice(2);
const models = ids.length > 0 ? ids : ['sv_gaz21', 'sv_vaz2101', 'sv_vaz2108', 'sv_niva', 'sa_uaz330364'];

async function limit(id: string): Promise<{ g: number; steer: number }> {
  let best = { g: 0, steer: 0 };
  for (const steer of [0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5]) {
    const rig = await makeRig(id);
    const v = rig.vehicle;
    const target = 70 / 3.6;
    const speed = (): number => Math.hypot(v.chassis.linvel().x, v.chassis.linvel().z);
    const hold = (t: number, f: typeof rig.input): void => {
      f.throttle = Math.max(0, Math.min(1, (target - speed()) * 0.6 + 0.3));
      f.steer = t < 9 ? 0 : steer * Math.min(1, (t - 9) / 2);
    };
    drive(rig, 16, hold);
    let lat = 0;
    let n = 0;
    drive(rig, 3, (t, f) => {
      hold(16 + t, f);
      lat += speed() * Math.abs(v.chassis.angvel().y);
      n++;
    });
    const g = lat / n / 9.81;
    if (g > best.g) best = { g, steer };
    v.dispose();
  }
  return best;
}

async function step(id: string): Promise<{ yaw: number; overshoot: number; rise: number }> {
  const rig = await makeRig(id);
  const v = rig.vehicle;
  const target = 90 / 3.6;
  const speed = (): number => Math.hypot(v.chassis.linvel().x, v.chassis.linvel().z);
  drive(rig, 16, (_t, f) => {
    f.throttle = Math.max(0, Math.min(1, (target - speed()) * 0.6 + 0.3));
  });
  const trace: number[] = [];
  drive(rig, 3, (_t, f) => {
    f.throttle = Math.max(0, Math.min(1, (target - speed()) * 0.6 + 0.3));
    f.steer = 0.12;
    trace.push(Math.abs(v.chassis.angvel().y));
  });
  v.dispose();
  const settled = trace.slice(-30).reduce((a, b) => a + b, 0) / 30;
  const peak = Math.max(...trace);
  const riseIndex = trace.findIndex((y) => y >= 0.9 * settled);
  return { yaw: settled, overshoot: settled > 0 ? peak / settled - 1 : 0, rise: (riseIndex * 1) / 60 };
}

await preloadCarModels(models);
console.log('model          tyre     limit g  at steer   step yaw  overshoot  rise');
for (const id of models) {
  for (const brush of [false, true]) {
    TYRE_MODEL.brush = brush;
    const l = await limit(id);
    const s = await step(id);
    console.log(
      `${(brush ? '' : id).padEnd(14)} ${brush ? 'brush' : 'curve'}    ${l.g.toFixed(2)}     ${l.steer.toFixed(2)}` +
        `      ${s.yaw.toFixed(3)}    ${(100 * s.overshoot).toFixed(0).padStart(4)}%     ${s.rise.toFixed(2)} s`,
    );
  }
}
