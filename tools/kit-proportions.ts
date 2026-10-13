/**
 * tools/kit-proportions.ts
 *
 * Every kit body (src/carkit) against its factory figures, before and after the loader
 * fits it.
 *
 * The loader (`buildTemplate` in render/carmodel.ts) scales any body to the
 * `FACTORY_GEOMETRY` length, width and height-over-clearance on three separate axes and
 * puts the wheels on the factory wheelbase and tracks around the body's own axle
 * midpoint. So the fitted car always measures right, and a body generated out of
 * proportion would be quietly stretched into it. This reads the body AS GENERATED, the
 * way the loader reads it, and holds it to the factory:
 *
 *   native     length (bounds), width (lower 55% of the body, mirrors out, as the loader
 *              measures the shell), height and lowest point above the ground, and the
 *              generated hubs' wheelbase, tracks and tyre radius
 *   stretch    the loader's per-axis correction, factory over native, and how far the
 *              factory wheelbase moves each generated hub inside its arch
 *   fit        the `model-fits.json` row (what physics and POI layout use before the
 *              visual streams in) against the fresh `carModelMeasure`, and against the
 *              factory box, axles and wheel radius
 *
 * Limits, from tools/vehicle-pipeline.md §9 E1 and §14: wheelbase, track and radius
 * within 0.5%; length, width and height within 1%; every per-axis stretch within 3%;
 * lowest point within 10 mm of the factory clearance; a hub moved by its arch fit at
 * most 10 mm; the fit row within 1 mm of the fresh measure.
 *
 * HARD gates (`!`, exit non-zero) are what the game uses: the fit row, against the fresh
 * measure and the factory, and how far a hub moves in its arch. The generated body's own
 * box, axles and the stretch are ADVISORY (`~`, listed, not failing): the pipeline calls
 * a stretch over 2-3% a sign the source is wrong, but the kit draws its bodies on period
 * drawings that stand lower than the passports and lets the loader grow them, by the
 * carkit's own convention (src/carkit/README.md, "Frame of reference"). The advisories
 * are the size of that growth; a drawing fix shows up here first.
 *
 *   bun tools/kit-proportions.ts [modelId ...]      (default: every kit body)
 *
 * Nothing here is part of the game bundle.
 */

import * as THREE from 'three';
import { installAssetShim } from './assetshim';
import { buildKitCar } from '../src/carkit/kit';
import { KIT_SPECS } from '../src/carkit/specs';
import { carModelMeasure, preloadCarModels } from '../src/render/carmodel';
import { carModel, hasCarModel, type CarModelDef } from '../src/vehicle/carmodels';
import modelFits from '../src/vehicle/model-fits.json';

installAssetShim();

interface FitRow {
  readonly halfExtents: readonly [number, number, number];
  readonly wheels: readonly { readonly id: string; readonly pos: readonly [number, number, number]; readonly radius: number }[];
}
const FITS = modelFits as unknown as Record<string, FitRow>;

const GATE = { axle: 0.005, box: 0.01, stretch: 0.03, clearanceM: 0.01, hubShiftM: 0.01, fitM: 0.001 } as const;
const WHEELS = ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr'] as const;
/** Same name the loader keeps out of the shell width (render/carmodel.ts `MIRRORS_NODE`). */
const MIRRORS_NODE = 'mirrors';

const argv = process.argv.slice(2);
const ids = argv.length > 0 ? argv : Object.keys(KIT_SPECS).map((kit) => `kit_${kit}`).filter(hasCarModel);

let failures = 0;
const failed: string[] = [];
const advised: string[] = [];
function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}
/** Records a miss as a hard failure or an advisory and returns its mark. */
function judge(hard: boolean, bad: boolean, line: string): string {
  if (!bad) return ' ';
  if (hard) {
    failures++;
    failed.push(line);
    return '!';
  }
  advised.push(line);
  return '~';
}
/** A relative deviation, printed and judged. */
function rel(label: string, id: string, value: number, target: number, gate: number, hard: boolean): string {
  const dev = (value - target) / target;
  const mark = judge(hard, Math.abs(dev) > gate, `${id} ${label} ${value.toFixed(3)} against ${target.toFixed(3)} (${pct(dev)})`);
  return `${pct(dev).padStart(6)}${mark}`;
}
/** An absolute deviation in metres, printed in mm and judged. */
function abs(label: string, id: string, value: number, target: number, gate: number, hard: boolean): string {
  const dev = value - target;
  // Half a millimetre of slack: a figure printed to the millimetre is not judged on float noise.
  const mark = judge(hard, Math.abs(dev) > gate + 5e-4, `${id} ${label} ${(dev * 1000).toFixed(1)} mm`);
  return `${(dev * 1000).toFixed(0).padStart(4)}${mark}`;
}

interface Native {
  length: number;
  width: number;
  bodyHeight: number;
  top: number;
  lowest: number;
  centreZ: number;
  frontZ: number;
  rearZ: number;
  frontTrack: number;
  rearTrack: number;
  radius: number;
}

/** The generated body measured as `buildTemplate` measures a loaded one. */
function measureNative(def: CarModelDef): Native {
  const scene = buildKitCar(def.kit!);
  scene.updateMatrixWorld(true);
  const centres = new Map<string, THREE.Vector3>();
  let radius = 0;
  for (const id of WHEELS) {
    const node = scene.getObjectByName(def.wheelNodes![id][0]!);
    if (!node) throw new Error(`${def.id}: no wheel node for ${id}`);
    const box = new THREE.Box3().setFromObject(node, true);
    centres.set(id, box.getCenter(new THREE.Vector3()));
    const size = box.getSize(new THREE.Vector3());
    radius = Math.max(radius, Math.max(size.x, size.y, size.z) / 2);
    node.removeFromParent();
  }
  scene.updateMatrixWorld(true);
  const body = new THREE.Box3().setFromObject(scene, true);
  const size = body.getSize(new THREE.Vector3());
  const shellTop = body.min.y + size.y * 0.55;
  let minX = Infinity;
  let maxX = -Infinity;
  const p = new THREE.Vector3();
  scene.traverse((node) => {
    if (!(node instanceof THREE.Mesh) || node.name === MIRRORS_NODE) return;
    const positions = node.geometry.getAttribute('position');
    if (!positions) return;
    for (let i = 0; i < positions.count; i++) {
      p.fromBufferAttribute(positions, i).applyMatrix4(node.matrixWorld);
      if (p.y > shellTop) continue;
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
    }
  });
  const c = (id: (typeof WHEELS)[number]): THREE.Vector3 => centres.get(id)!;
  return {
    length: size.z,
    width: maxX - minX,
    bodyHeight: size.y,
    top: body.max.y,
    lowest: body.min.y,
    centreZ: (body.min.z + body.max.z) / 2,
    frontZ: (c('wheel_fl').z + c('wheel_fr').z) / 2,
    rearZ: (c('wheel_rl').z + c('wheel_rr').z) / 2,
    frontTrack: Math.abs(c('wheel_fl').x - c('wheel_fr').x),
    rearTrack: Math.abs(c('wheel_rl').x - c('wheel_rr').x),
    radius,
  };
}

const natives = new Map<string, Native>();
console.log('--- generated body against the factory (before the loader fits it) ---');
console.log(
  'model            length  dev     width  dev     height dev     low  mm    wb     dev     ftrack dev     rtrack dev     radius dev',
);
for (const id of ids) {
  const def = carModel(id);
  if (!def.kit) throw new Error(`${id} is not a kit body`);
  const f = def.factory;
  const n = measureNative(def);
  natives.set(id, n);
  console.log(
    `${id.padEnd(16)} ${n.length.toFixed(3)} ${rel('native length', id, n.length, f.length, GATE.box, false)} ` +
      `${n.width.toFixed(3)} ${rel('native width', id, n.width, f.width, GATE.box, false)} ` +
      `${n.top.toFixed(3)} ${rel('native height', id, n.top, f.height, GATE.box, false)} ` +
      `${n.lowest.toFixed(3)} ${abs('lowest point vs clearance', id, n.lowest, f.clearance, GATE.clearanceM, false)} ` +
      `${(n.frontZ - n.rearZ).toFixed(3)} ${rel('native wheelbase', id, n.frontZ - n.rearZ, f.wheelbase, GATE.axle, false)} ` +
      `${n.frontTrack.toFixed(3)} ${rel('native front track', id, n.frontTrack, f.frontTrack, GATE.axle, false)} ` +
      `${n.rearTrack.toFixed(3)} ${rel('native rear track', id, n.rearTrack, f.rearTrack, GATE.axle, false)} ` +
      `${n.radius.toFixed(3)} ${rel('native tyre radius', id, n.radius, f.wheelRadius, GATE.axle, false)}`,
  );
}

console.log('\n--- the loader\'s correction: per-axis stretch (factory / native) and hub moves in the arch ---');
console.log('model            length  width   body-h   front hub mm  rear hub mm');
for (const id of ids) {
  const f = carModel(id).factory;
  const n = natives.get(id)!;
  const sx = f.width / n.width;
  const sy = (f.height - f.clearance) / n.bodyHeight;
  const sz = f.length / n.length;
  // The loader keeps the generated axle midpoint (stretched with the body) and lays the
  // factory wheelbase about it; compare each hub with where the stretched body has it.
  const mid = ((n.frontZ + n.rearZ) / 2 - n.centreZ) * sz;
  const fittedFront = mid + f.wheelbase / 2;
  const fittedRear = mid - f.wheelbase / 2;
  console.log(
    `${id.padEnd(16)} ${rel('stretch Z', id, sz, 1, GATE.stretch, false)} ${rel('stretch X', id, sx, 1, GATE.stretch, false)} ` +
      `${rel('stretch Y', id, sy, 1, GATE.stretch, false)}   ` +
      `${abs('front hub moved in its arch', id, fittedFront, (n.frontZ - n.centreZ) * sz, GATE.hubShiftM, true)}          ` +
      `${abs('rear hub moved in its arch', id, fittedRear, (n.rearZ - n.centreZ) * sz, GATE.hubShiftM, true)}`,
  );
}

await preloadCarModels(ids);
console.log('\n--- model-fits.json row: against the fresh measure, and against the factory ---');
console.log('model            stale mm   length  width   body-h   wb      ftrack  rtrack  radius  ground mm');
for (const id of ids) {
  const f = carModel(id).factory;
  const row = FITS[id];
  if (!row) {
    failures++;
    failed.push(`${id}: no model-fits.json row (bun tools/fit-models.ts ${id})`);
    console.log(`${id.padEnd(16)} no fit row`);
    continue;
  }
  const m = carModelMeasure(id);
  let stale = 0;
  for (let i = 0; i < 3; i++) stale = Math.max(stale, Math.abs(row.halfExtents[i]! - m.halfExtents[i]!));
  for (const w of m.wheels) {
    const r = row.wheels.find((x) => x.id === w.id);
    if (!r) {
      stale = Infinity;
      continue;
    }
    stale = Math.max(stale, Math.abs(r.radius - w.radius), ...[0, 1, 2].map((i) => Math.abs(r.pos[i]! - w.pos[i]!)));
  }
  const [hx, hy, hz] = row.halfExtents;
  const wheel = (wid: string): FitRow['wheels'][number] => row.wheels.find((w) => w.id === wid)!;
  const fl = wheel('wheel_fl');
  const fr = wheel('wheel_fr');
  const rl = wheel('wheel_rl');
  const rr = wheel('wheel_rr');
  // Wheels stand on the ground the body's clearance is measured from: hub height less
  // radius is the ground, `clearance` under the body box's floor.
  const ground = fl.pos[1] - fl.radius;
  console.log(
    `${id.padEnd(16)} ${abs('fit row stale against carModelMeasure', id, stale, 0, GATE.fitM, true)}       ` +
      `${rel('fit length', id, 2 * hz, f.length, GATE.axle, true)} ${rel('fit width', id, 2 * hx, f.width, GATE.axle, true)} ` +
      `${rel('fit body height', id, 2 * hy, f.height - f.clearance, GATE.axle, true)} ` +
      `${rel('fit wheelbase', id, fl.pos[2] - rl.pos[2], f.wheelbase, GATE.axle, true)} ` +
      `${rel('fit front track', id, fl.pos[0] - fr.pos[0], f.frontTrack, GATE.axle, true)} ` +
      `${rel('fit rear track', id, rl.pos[0] - rr.pos[0], f.rearTrack, GATE.axle, true)} ` +
      `${rel('fit radius', id, fl.radius, f.wheelRadius, GATE.axle, true)} ` +
      `${abs('fit ground under the body', id, -hy - ground, f.clearance, GATE.fitM, true)}`,
  );
}

if (advised.length > 0) {
  console.log(`\n${advised.length} advisories (~), the generated body against the factory:\n  ${advised.join('\n  ')}`);
}
if (failures > 0) {
  console.log(`\n${failures} out of gate (!):\n  ${failed.join('\n  ')}`);
  process.exit(1);
}
console.log(`\nall ${ids.length} kit bodies within the hard gates`);
