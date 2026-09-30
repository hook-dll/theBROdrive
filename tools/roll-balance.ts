/**
 * tools/roll-balance.ts
 *
 * Where a car's cornering load transfer goes. A car held on a steady circle at a set
 * speed: the lateral load transfer on each axle (outer tyre load minus inner, halved)
 * as the tyres actually see it, its front share of the total, and the total against
 * the textbook `m · a_y · h / track` it should add up to.
 *
 * The front share is the handling balance. A real car puts more of the transfer on the
 * axle with the stiffer roll resistance (springs plus anti-roll bar), and load
 * sensitivity makes that axle the first to run out of grip. If the share does not
 * follow the bars, the balance lever works backwards.
 *
 *   bun tools/roll-balance.ts [modelId ...] [--kmh=60] [--steer=0.35]
 *
 * Nothing here is part of the game bundle.
 */

import { installAssetShim } from './assetshim';
import { preloadCarModels } from '../src/render/carmodel';
import { makeRig, drive } from './handling-bench';

installAssetShim();

const args = process.argv.slice(2);
const flag = (name: string, fallback: number): number => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? +hit.slice(name.length + 3) : fallback;
};
const ids = args.filter((a) => !a.startsWith('--'));
const models = ids.length > 0 ? ids : ['sv_vaz2101', 'sv_vaz2108', 'pg_911sc', 'pg_2cv'];
const targetKmh = flag('kmh', 60);
const steer = flag('steer', 0.35);

interface WheelView {
  readonly isFront: boolean;
  readonly sideSign: number;
  readonly loadN: number;
  readonly staticLoadN: number;
  readonly grounded: boolean;
}

await preloadCarModels(models);
console.log(`steady circle, ${targetKmh} km/h, steer ${steer}`);
console.log('model            lat g   front dF   rear dF   front share   total/ideal   lean');
for (const id of models) {
  const rig = await makeRig(id);
  const v = rig.vehicle;
  const wheels = (v as unknown as { wheels: WheelView[] }).wheels;
  const target = targetKmh / 3.6;
  // A proportional throttle holds the speed; the steer ramps in over two seconds.
  const hold = (t: number, f: typeof rig.input): void => {
    const lv = v.chassis.linvel();
    const speed = Math.hypot(lv.x, lv.z);
    f.throttle = Math.max(0, Math.min(1, (target - speed) * 0.6 + 0.25));
    f.brake = speed > target + 2 ? 0.3 : 0;
    f.steer = t < 8 ? 0 : steer * Math.min(1, (t - 8) / 2);
  };
  drive(rig, 16, hold);

  let n = 0;
  let front = 0;
  let rear = 0;
  let lat = 0;
  let lean = 0;
  drive(rig, 4, (t, f) => {
    hold(16 + t, f);
    let fl = 0;
    let fr = 0;
    let rl = 0;
    let rr = 0;
    for (const w of wheels) {
      if (w.isFront) {
        if (w.sideSign < 0) fl += w.loadN;
        else fr += w.loadN;
      } else if (w.sideSign < 0) rl += w.loadN;
      else rr += w.loadN;
    }
    front += Math.abs(fl - fr) / 2;
    rear += Math.abs(rl - rr) / 2;
    const lv = v.chassis.linvel();
    const av = v.chassis.angvel();
    lat += Math.hypot(lv.x, lv.z) * Math.abs(av.y);
    const q = v.chassis.rotation();
    // Body +X lifted out of horizontal.
    lean += Math.abs(Math.asin(Math.max(-1, Math.min(1, 2 * (q.x * q.y + q.w * q.z)))));
    n++;
  });
  front /= n;
  rear /= n;
  lat /= n;
  lean /= n;

  const mass = v.chassis.mass();
  const lever = (v as unknown as { rollLeverArm: number }).rollLeverArm;
  const measure = v.modelMeasure;
  const trackOf = (isFront: boolean): number => {
    const xs = measure.wheels.filter((w) => w.isFront === isFront).map((w) => w.pos[0]);
    return Math.max(...xs) - Math.min(...xs);
  };
  // Ideal transfer, summed as moments: the couple m·a·h is carried by the two axles'
  // (dF · track), so the check is on moments, not on newtons.
  const idealMoment = mass * lat * lever;
  const moment = front * trackOf(true) + rear * trackOf(false);
  console.log(
    `${id.padEnd(16)} ${(lat / 9.81).toFixed(2).padStart(5)}  ${front.toFixed(0).padStart(8)}  ` +
      `${rear.toFixed(0).padStart(8)}   ${((100 * front) / (front + rear)).toFixed(0).padStart(8)}%` +
      `     ${(moment / idealMoment).toFixed(2).padStart(8)}    ${((lean * 180) / Math.PI).toFixed(1)}°`,
  );
  v.dispose();
}
