/**
 * tools/hood-mount.ts
 *
 * Where the bonnet camera actually ends up on every body in the catalogue, and
 * whether the road is visible from there.
 *
 * The mount is measured at load time (`render/carmodel.ts`) rather than authored per
 * car, so a mistake in the sweep is a mistake on EVERY body at once and is invisible
 * in review — the number it produces is still a plausible-looking metre figure. The
 * property that matters is not the number, it is the view: a driver in the bonnet
 * camera must see the road ahead, and the camera must stand ON the bodywork rather
 * than inside it or in the air above it. So this casts two rays against the real
 * body geometry of every catalogue model and reads what they hit.
 *
 *   npx tsx tools/hood-mount.ts
 *
 * Nothing here is part of the game bundle.
 */

import * as THREE from 'three';
import { installAssetShim } from './assetshim';
import { CAR_MODELS } from '../src/vehicle/carmodels';
import { carModelMeasure, createCarModel, preloadCarModels } from '../src/render/carmodel';

installAssetShim();

/** Ray origin lifted off a surface so it cannot start inside the triangle it sits on. */
const SURFACE_EPSILON_M = 0.001;
/**
 * How far ahead the view must be clear of the car's own bodywork, metres.
 *
 * The bonnet slopes away from the mount and the nose is the last thing it can cross;
 * the longest catalogue body is 5.2 m, so half that is already beyond any panel the
 * mount could be looking through.
 */
const MIN_FORWARD_CLEAR_M = 2.5;
/** How far below the mount bodywork may be before the camera is floating, metres. */
const MAX_DROP_TO_BODYWORK_M = 0.6;

/** Epsilon-clean first hit along a chassis-local ray, or null when the ray misses. */
function firstHit(
  raycaster: THREE.Raycaster,
  target: THREE.Object3D,
  origin: readonly [number, number, number],
  direction: readonly [number, number, number],
): number | null {
  raycaster.set(
    new THREE.Vector3(origin[0], origin[1], origin[2]),
    new THREE.Vector3(direction[0], direction[1], direction[2]).normalize(),
  );
  const hits = raycaster.intersectObject(target, true);
  return hits.length > 0 ? hits[0]!.distance : null;
}

const raycaster = new THREE.Raycaster();
let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(44)} ${detail}`);
}

await preloadCarModels();

console.log('car            mount y   roof   forward clear   bodywork below');
for (const def of CAR_MODELS) {
  const measure = carModelMeasure(def.id);
  const { body } = createCarModel(def.id);
  body.updateMatrixWorld(true);

  const hood = measure.hoodPoint;
  const roof = measure.halfExtents[1];
  const forward = firstHit(raycaster, body, [hood[0], hood[1] + SURFACE_EPSILON_M, hood[2]], [0, 0, 1]);
  const below = firstHit(raycaster, body, [hood[0], hood[1], hood[2]], [0, -1, 0]);

  const forwardText = forward === null ? 'clear of the car' : `${forward.toFixed(2)} m`;
  const belowText = below === null ? 'NOTHING' : `${below.toFixed(2)} m`;
  console.log(
    `  ${def.id.padEnd(13)} ${hood[1].toFixed(3).padStart(6)} ${roof.toFixed(3).padStart(6)} ` +
      `  ${forwardText.padStart(14)}   ${belowText.padStart(13)}`,
  );

  check(`${def.id}: looks down the road`, forward === null || forward >= MIN_FORWARD_CLEAR_M, forwardText);
  check(
    `${def.id}: stands on bodywork`,
    below !== null && below <= MAX_DROP_TO_BODYWORK_M,
    belowText,
  );
  check(`${def.id}: not above the roof`, hood[1] <= roof + SURFACE_EPSILON_M, `${hood[1].toFixed(3)} vs ${roof.toFixed(3)}`);

  body.removeFromParent();
}

/**
 * The mount the unscaled sweep produced, cast from the SAME ray origins: the floor of
 * the body box, where `hoodY` stayed when no sample survived its window. Proving the
 * check fails there is the whole point of keeping it.
 */
console.log('\n  pre-fix mount (box floor + clearance), same rays:');
for (const id of ['sv_vaz2103', 'sv_gaz21', 'sv_niva']) {
  const measure = carModelMeasure(id);
  const { body } = createCarModel(id);
  body.updateMatrixWorld(true);
  const floorMount: [number, number, number] = [0, -measure.halfExtents[1] + 0.1, measure.hoodPoint[2]];
  const forward = firstHit(raycaster, body, [floorMount[0], floorMount[1] + SURFACE_EPSILON_M, floorMount[2]], [0, 0, 1]);
  const below = firstHit(raycaster, body, floorMount, [0, -1, 0]);
  console.log(
    `    ${id.padEnd(13)} y ${floorMount[1].toFixed(3).padStart(6)}   forward ` +
      `${(forward === null ? 'clear' : `${forward.toFixed(2)} m`).padStart(10)}   below ` +
      `${(below === null ? 'NOTHING' : `${below.toFixed(2)} m`).padStart(10)}`,
  );
  // Either symptom is a failure: a view through the car's own bodywork, or a camera
  // that is not standing on the car at all.
  const forwardOk = forward === null || forward >= MIN_FORWARD_CLEAR_M;
  const belowOk = below !== null && below <= MAX_DROP_TO_BODYWORK_M;
  check(
    `${id}: the old mount fails this`,
    !(forwardOk && belowOk),
    forwardOk ? 'only the ray below catches it' : 'the forward ray catches it',
  );
  body.removeFromParent();
}

console.log(`\n${failures === 0 ? 'all checks passed' : `${failures} FAILURES`}`);
if (failures) process.exitCode = 1;
