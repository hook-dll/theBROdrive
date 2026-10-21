/**
 * tools/dust-flow.ts
 *
 * Authors and checks every kit car's `dustFlow` row in src/vehicle/model-fits.json: how
 * the body's own airflow places the road dust on its paint and glass (`CarDustFlow` in
 * src/vehicle/carmodels.ts, `CAR_DUST_FLOW` in src/render/materials.ts).
 *
 * The values are OFFLINE-AUTHORED APPROXIMATIONS, NOT CFD: each is one of the model's
 * existing figures mapped onto a dust term, clamped and rounded to 0.01. The aero
 * figures are the literature's for the body's SHAPE class (notchback, squareback,
 * two-box, van: see `AeroSpec`), so the body class reaches the dust through them. Only
 * read here; drag, lift and crosswind physics are not touched.
 *
 *   front  nose bluntness. Front lift grows with the stagnation area of a blunt nose
 *          (Niva, UAZ 0.2-0.25) and falls on a wedge (Samara, 2110 0.08):
 *          0.6 * clamp((liftFront - 0.06) / 0.19, 0, 1).
 *   roof   rear lift is suction over the roof and rear deck, fast attached flow that
 *          sweeps settled film; a squareback's flow leaves at the roof's edge and the
 *          film stays: clamp(2 * (0.15 - liftRear), -0.3, 0.3).
 *   wake   squareness, from the crossflow centre of pressure (yawSlope / sideSlope, in
 *          wheelbases ahead of the midpoint: a third on a saloon, a fifth on a
 *          squareback, whose tall rear flank draws it aft). The square base holds the
 *          biggest low-pressure wake: s = clamp((0.4 - cp) / 0.3, 0, 1), 0.8 s - 0.15.
 *   wheel  tyre throw past the arch lip, from factory ground clearance (a tall body
 *          on open arches): clamp(4 * (clearance - 0.17), -0.2, 0.4).
 *   under  road spray on the sills and valances, the closer the floor to the road:
 *          clamp(-3 * (clearance - 0.17), -0.3, 0.3).
 *   side   flank slab area, from the side-force slope (1.25 on a rounded Samara, 1.9 on
 *          the UAZ van): clamp(0.5 * (sideSlope - 1.25) / 0.65, 0, 0.5).
 *
 * 0.17 m is the Zhiguli's clearance, so the reference saloon's road terms are neutral.
 *
 *   bun tools/dust-flow.ts           check the file, the fallback and the shader path
 *   bun tools/dust-flow.ts --write   rewrite every kit row's dustFlow from the formulas
 *
 * Nothing here is part of the game bundle.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import * as THREE from 'three';
import { installAssetShim } from './assetshim';
import { installDocumentShim } from './domshim';
import { createCarModel, preloadCarModels } from '../src/render/carmodel';
import { carPaintGrimeFrame } from '../src/render/materials';
import {
  CAR_MODELS,
  NEUTRAL_DUST_FLOW,
  carModel,
  modelDustFlow,
  type CarDustFlow,
  type CarModelDef,
} from '../src/vehicle/carmodels';

installAssetShim();
// A kit car's sticker decals paint their atlas on a canvas.
installDocumentShim();

const FITS_PATH = new URL('../src/vehicle/model-fits.json', import.meta.url);
const KEYS = ['front', 'roof', 'wake', 'wheel', 'under', 'side'] as const;
/** The documented range of each coefficient (`CarDustFlow`). */
const RANGE: Record<(typeof KEYS)[number], readonly [number, number]> = {
  front: [0, 1],
  roof: [-1, 1],
  wake: [-1, 1],
  wheel: [-1, 1],
  under: [-1, 1],
  side: [0, 1],
};

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const cents = (v: number): number => Math.round(v * 100) / 100 + 0;

function deriveDustFlow(def: CarModelDef): CarDustFlow {
  const aero = def.aero;
  const clearance = def.factory.clearance;
  const square = clamp((0.4 - aero.yawSlope / aero.sideSlope) / 0.3, 0, 1);
  return {
    front: cents(0.6 * clamp((aero.liftFront - 0.06) / 0.19, 0, 1)),
    roof: cents(clamp(2 * (0.15 - aero.liftRear), -0.3, 0.3)),
    wake: cents(0.8 * square - 0.15),
    wheel: cents(clamp(4 * (clearance - 0.17), -0.2, 0.4)),
    under: cents(clamp(-3 * (clearance - 0.17), -0.3, 0.3)),
    side: cents(clamp((0.5 * (aero.sideSlope - 1.25)) / 0.65, 0, 0.5)),
  };
}

const kitDefs = CAR_MODELS.filter((def) => def.kit !== undefined);
const fits = JSON.parse(readFileSync(FITS_PATH, 'utf8')) as Record<string, Record<string, unknown>>;

if (process.argv.includes('--write')) {
  for (const def of kitDefs) {
    const row = fits[def.id];
    if (!row) throw new Error(`${def.id}: no model-fits.json row (bun tools/fit-models.ts ${def.id})`);
    row.dustFlow = deriveDustFlow(def);
    console.log(`${def.id.padEnd(14)} ${KEYS.map((k) => `${k} ${(row.dustFlow as CarDustFlow)[k].toFixed(2).padStart(5)}`).join('  ')}`);
  }
  writeFileSync(FITS_PATH, `${JSON.stringify(fits, null, 2)}\n`);
  process.exit(0);
}

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label.padEnd(64)} ${detail}`);
}

// --- the file: every kit row authored, in range, and as the formulas give it --------
for (const def of kitDefs) {
  const flow = fits[def.id]?.dustFlow as Partial<Record<string, unknown>> | undefined;
  const shaped =
    flow !== undefined &&
    Object.keys(flow).length === KEYS.length &&
    KEYS.every((k) => typeof flow[k] === 'number' && Number.isFinite(flow[k]));
  const inRange = shaped && KEYS.every((k) => (flow[k] as number) >= RANGE[k][0] && (flow[k] as number) <= RANGE[k][1]);
  const expected = deriveDustFlow(def);
  const current = shaped && KEYS.every((k) => flow[k] === expected[k]);
  check(
    `${def.id}: dustFlow present, in range, as derived`,
    shaped && inRange && current,
    shaped ? KEYS.map((k) => `${k}=${flow[k] as number}`).join(' ') : 'missing or malformed (bun tools/dust-flow.ts --write)',
  );
  check(`${def.id}: the catalogue reads that row`, shaped && modelDustFlow(def) === carModel(def.id).fit.dustFlow);
}

// --- every other body: no row, neutral flow -----------------------------------------
const packIds = Object.keys(fits).filter((id) => !kitDefs.some((def) => def.id === id));
check(
  'no non-kit row carries dustFlow',
  packIds.every((id) => fits[id]!.dustFlow === undefined),
  `${packIds.length} pack/carforge rows`,
);
check(
  'every non-kit body falls back to the neutral flow',
  packIds.every((id) => modelDustFlow(carModel(id)) === NEUTRAL_DUST_FLOW),
);
check('the neutral flow is all zero', KEYS.every((k) => NEUTRAL_DUST_FLOW[k] === 0));

// --- the shader path: the real loader's paint and glass get the row, one program ----
/** Runs a material's onBeforeCompile on a stand-in program and returns what it bound. */
function compiled(material: THREE.Material): { uniforms: Record<string, { value: unknown }>; fragment: string } {
  const shader = {
    uniforms: {} as Record<string, { value: unknown }>,
    vertexShader: THREE.ShaderLib.physical.vertexShader,
    fragmentShader: THREE.ShaderLib.physical.fragmentShader,
  };
  material.onBeforeCompile(
    shader as unknown as Parameters<THREE.Material['onBeforeCompile']>[0],
    null as unknown as THREE.WebGLRenderer,
  );
  return { uniforms: shader.uniforms, fragment: shader.fragmentShader };
}

const KIT_A = 'kit_uaz469';
const KIT_B = 'kit_vaz2108';
const PACK = 'sv_vaz2101';
await preloadCarModels([KIT_A, KIT_B, PACK]);
const programKeys = new Set<string>();
for (const id of [KIT_A, KIT_B, PACK]) {
  const def = carModel(id);
  const kit = def.kit !== undefined;
  const flow = kit ? def.fit.dustFlow! : NEUTRAL_DUST_FLOW;
  const car = createCarModel(id);
  const paint = car.surface.paint[0];
  check(`${id}: has condition paint`, paint !== undefined);
  if (!paint) continue;
  const { uniforms, fragment } = compiled(paint);
  const a = uniforms.uCarDustFlowA?.value;
  const b = uniforms.uCarDustFlowB?.value;
  check(
    `${id}: paint binds its ${kit ? 'kit row' : 'neutral'} flow`,
    a instanceof THREE.Vector3 &&
      b instanceof THREE.Vector3 &&
      a.equals(new THREE.Vector3(flow.front, flow.roof, flow.wake)) &&
      b.equals(new THREE.Vector3(flow.wheel, flow.under, flow.side)),
    `A=${a instanceof THREE.Vector3 ? a.toArray().join(',') : a} B=${b instanceof THREE.Vector3 ? b.toArray().join(',') : b}`,
  );
  check(`${id}: paint shader runs the flow`, fragment.includes('carDustFlow( carP, carHeight, carAlong, carForward, carFlowRoof )'));
  if (!kit) continue;
  // A kit car's glass is always the chassis-stamped kind (render/carmodel.ts `cloneCarGlass`).
  const frame = carPaintGrimeFrame(paint);
  const glass = car.surface.glass.map(compiled).find((g) => g.fragment.includes('carDustFlow( carP'));
  check(
    `${id}: window glass shares the paint's flow uniforms`,
    glass !== undefined &&
      frame !== null &&
      glass.uniforms.uCarDustFlowA === frame.dustFlowA &&
      glass.uniforms.uCarDustFlowB === frame.dustFlowB,
    `${car.surface.glass.length} glass material(s)`,
  );
  programKeys.add((paint as THREE.MeshStandardMaterial).customProgramCacheKey());
}
const flowA = carModel(KIT_A).fit.dustFlow!;
const flowB = carModel(KIT_B).fit.dustFlow!;
check(
  'two kit cars with different flows share one paint program',
  programKeys.size === 1 && programKeys.has('car-body-condition-v3-kit-v3') && KEYS.some((k) => flowA[k] !== flowB[k]),
  [...programKeys].join(' / '),
);

console.log(failures === 0 ? 'dust-flow: all checks passed' : `dust-flow: ${failures} check(s) FAILED`);
if (failures > 0) process.exitCode = 1;
