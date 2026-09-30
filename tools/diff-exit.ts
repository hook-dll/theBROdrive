/**
 * tools/diff-exit.ts
 *
 * What a limited-slip differential does on the way out of a bend. The car holds a
 * steady circle, then the throttle goes to the floor with the steering held for two
 * seconds: printed are the speed gained, the inside and outside driven wheels' peak
 * slip ratios, and the yaw rate at the end, once with the model's own differential and
 * once with an open one in its place.
 *
 *   bun tools/diff-exit.ts [modelId ...] [--kmh=50] [--steer=0.35]
 *
 * Nothing here is part of the game bundle.
 */

import { installAssetShim } from './assetshim';
import { preloadCarModels } from '../src/render/carmodel';
import { carModel, type LimitedSlip } from '../src/vehicle/carmodels';
import { makeRig, drive } from './handling-bench';

installAssetShim();

const args = process.argv.slice(2);
const flag = (name: string, fallback: number): number => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? +hit.slice(name.length + 3) : fallback;
};
const ids = args.filter((a) => !a.startsWith('--'));
const models = ids.length > 0 ? ids : ['pg_mustang', 'pg_testarossa', 'pg_integrale'];
const targetKmh = flag('kmh', 50);
const steer = flag('steer', 0.35);

interface WheelView {
  readonly isFront: boolean;
  readonly sideSign: number;
  readonly slipRatio: number;
  readonly driveTorqueNm: number;
}
type Diffs = { frontDiff?: LimitedSlip; rearDiff?: LimitedSlip };

async function run(id: string): Promise<string> {
  const rig = await makeRig(id);
  const v = rig.vehicle;
  const wheels = (v as unknown as { wheels: WheelView[] }).wheels;
  const target = targetKmh / 3.6;
  const speed = (): number => Math.hypot(v.chassis.linvel().x, v.chassis.linvel().z);
  drive(rig, 14, (t, f) => {
    f.throttle = Math.max(0, Math.min(1, (target - speed()) * 0.6 + 0.25));
    f.steer = t < 6 ? 0 : steer * Math.min(1, (t - 6) / 2);
  });
  // Left turn or right: the inside wheel is the one carrying less load, found by sign
  // of the yaw rate.
  const insideSign = v.chassis.angvel().y > 0 ? -1 : 1;
  const start = speed();
  let inside = 0;
  let outside = 0;
  drive(rig, 2, (_t, f) => {
    f.throttle = 1;
    f.steer = steer;
    for (const w of wheels) {
      if (w.driveTorqueNm === 0 && w.slipRatio === 0) continue;
      if (w.isFront && v.model.rearDriveBias >= 1) continue;
      if (!w.isFront && v.model.rearDriveBias <= 0) continue;
      if (w.sideSign === insideSign) inside = Math.max(inside, w.slipRatio);
      else outside = Math.max(outside, w.slipRatio);
    }
  });
  const gained = (speed() - start) * 3.6;
  const yaw = v.chassis.angvel().y;
  v.dispose();
  return `+${gained.toFixed(1).padStart(4)} km/h   inside slip ${inside.toFixed(2).padStart(5)}   ` +
    `outside slip ${outside.toFixed(2).padStart(5)}   yaw ${Math.abs(yaw).toFixed(2)} rad/s`;
}

await preloadCarModels(models);
console.log(`corner exit: ${targetKmh} km/h circle, steer ${steer}, then full throttle for 2 s`);
for (const id of models) {
  const def = carModel(id) as Diffs;
  const own = { frontDiff: def.frontDiff, rearDiff: def.rearDiff };
  console.log(`${id.padEnd(15)} own diff   ${await run(id)}`);
  def.frontDiff = undefined;
  def.rearDiff = undefined;
  console.log(`${''.padEnd(15)} open diff  ${await run(id)}`);
  def.frontDiff = own.frontDiff;
  def.rearDiff = own.rearDiff;
}
