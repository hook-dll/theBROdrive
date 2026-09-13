/**
 * Contact patches: are the tyres actually touching the ground?
 *
 *   npx tsx tools/contact-patches.ts
 *
 * The patches are the only thing on screen that reports what each tyre is carrying, so
 * this checks the three properties that make them worth having, by reading back the
 * geometry that will be drawn rather than the inputs that produced it:
 *
 *   PLACED. One quad per grounded wheel, centred on that wheel's own contact point.
 *   FLAT. Lying in the ground plane, using the terrain normal the wheel reported — a
 *   patch standing up through a slope is worse than no patch at all.
 *   LOADED. Opacity following the load, so a wheel in the air has none and the light
 *   side of a corner is visibly lighter than the heavy one.
 */

import * as THREE from 'three';

import { SurfaceType } from '../src/core/surfaces';
import { installAssetShim } from './assetshim';
import { addInclineGround, drive, makeRig } from './handling-bench';
import { preloadCarModels } from '../src/render/carmodel';
import { ContactPatchField, patchOpacity } from '../src/render/contactpatches';
import { WorldOrigin } from '../src/world/origin';

installAssetShim();

const MODEL = 'sv_vaz2101';
const DEGREES = 12;

/** Metres a quad centre may differ from the wheel's own contact point. */
const PLACEMENT_TOLERANCE_M = 0.06;
/** Degrees a patch may be off the ground plane. */
const FLATNESS_TOLERANCE_DEG = 2;

interface Quad {
  readonly centre: THREE.Vector3;
  readonly normal: THREE.Vector3;
  readonly alpha: number;
}

/** Reads the live quads back out of the geometry the mesh is about to draw. */
function readQuads(scene: THREE.Scene, count: number): Quad[] {
  const mesh = scene.children[0] as THREE.Mesh;
  const position = mesh.geometry.getAttribute('position');
  const alpha = mesh.geometry.getAttribute('alpha');
  const quads: Quad[] = [];
  for (let q = 0; q < count; q++) {
    const v = q * 4;
    const corners: THREE.Vector3[] = [];
    let sum = 0;
    for (let c = 0; c < 4; c++) {
      corners.push(
        new THREE.Vector3(
          position.getX(v + c),
          position.getY(v + c),
          position.getZ(v + c),
        ),
      );
      sum += alpha.getX(v + c);
    }
    const centre = new THREE.Vector3();
    for (const corner of corners) centre.add(corner);
    centre.multiplyScalar(0.25);
    // The normal of the FIRST TRIANGLE the index buffer draws — (0, 2, 1) — because
    // that is the plane the rasteriser actually fills. The four corners are stored in a
    // Z order rather than around the perimeter, so a winding-based method like Newell's
    // would walk two crossing edges and report a normal perpendicular to the truth.
    const normal = new THREE.Vector3()
      .subVectors(corners[2]!, corners[0]!)
      .cross(new THREE.Vector3().subVectors(corners[1]!, corners[0]!))
      .normalize();
    quads.push({ centre, normal, alpha: sum / 4 });
  }
  return quads;
}

await preloadCarModels([MODEL]);
const rig = await makeRig(
  MODEL,
  (physics) => addInclineGround(physics, DEGREES, SurfaceType.Sand),
  false,
);

// A dedicated scene, so the field's mesh is the only child and can be read directly.
const patchScene = new THREE.Scene();
const field = new ContactPatchField(patchScene, new WorldOrigin());

drive(rig, 2, (_, input) => {
  input.throttle = 0.5;
  input.brake = 0;
  input.reverse = false;
  input.steer = 0;
  input.handbrake = false;
});

field.beginFrame();
rig.vehicle.syncContactPatches(field, 1);
field.endFrame();

const quads = readQuads(patchScene, 4);
const spray = rig.vehicle.wheelSpray;
const ride = rig.vehicle.wheelRide;

console.log(`${MODEL} on ${DEGREES} deg sand: ${quads.length} patches for 4 wheels`);
console.log('  wheel  load N  static N   alpha   offset m   flat deg');

const failures: string[] = [];
for (let i = 0; i < 4; i++) {
  const quad = quads[i]!;
  const wheel = spray[i]!;
  const state = ride[i]!;
  const contact = new THREE.Vector3(wheel.contactX, wheel.contactY, wheel.contactZ);
  const offset = quad.centre.distanceTo(contact);
  const groundNormal = new THREE.Vector3(
    wheel.normalX,
    wheel.normalY,
    wheel.normalZ,
  ).normalize();
  const flatDeg =
    (Math.acos(Math.min(1, Math.max(-1, Math.abs(quad.normal.dot(groundNormal))))) * 180) /
    Math.PI;

  console.log(
    `  ${wheel.inContact ? ' ' : 'x'}${i}    ${state.loadN.toFixed(0).padStart(6)} ` +
      `${state.staticLoadN.toFixed(0).padStart(8)} ${quad.alpha.toFixed(3).padStart(8)} ` +
      `${offset.toFixed(3).padStart(10)} ${flatDeg.toFixed(2).padStart(10)}`,
  );

  if (offset > PLACEMENT_TOLERANCE_M) {
    failures.push(`wheel ${i}: patch centre is ${offset.toFixed(3)} m from the contact point`);
  }
  if (flatDeg > FLATNESS_TOLERANCE_DEG) {
    failures.push(`wheel ${i}: patch is ${flatDeg.toFixed(1)} deg off the ground plane`);
  }
  if (quad.alpha <= 0) {
    failures.push(`wheel ${i}: grounded wheel has a zero-opacity patch`);
  }
}

// LOAD IS WHAT THE PATCH IS FOR, so the relation is checked directly: the darkest patch
// must belong to the most heavily loaded wheel, and the ratios must agree.
let heaviest = 0;
let lightest = 0;
for (let i = 1; i < 4; i++) {
  if (ride[i]!.loadN > ride[heaviest]!.loadN) heaviest = i;
  if (ride[i]!.loadN < ride[lightest]!.loadN) lightest = i;
}
if (quads[heaviest]!.alpha < quads[lightest]!.alpha) {
  failures.push(
    `the load order is inverted: the heaviest wheel (${ride[heaviest]!.loadN.toFixed(0)} N) ` +
      `has a lighter patch than the lightest (${ride[lightest]!.loadN.toFixed(0)} N)`,
  );
}
const expectedRatio =
  Math.min(1.15, ride[heaviest]!.loadN / ride[heaviest]!.staticLoadN) /
  Math.min(1.15, ride[lightest]!.loadN / ride[lightest]!.staticLoadN);
const actualRatio = quads[heaviest]!.alpha / Math.max(1e-6, quads[lightest]!.alpha);
if (Math.abs(actualRatio - expectedRatio) > expectedRatio * 0.15) {
  failures.push(
    `patch opacity does not follow load: ${actualRatio.toFixed(3)} against ` +
      `${expectedRatio.toFixed(3)} expected`,
  );
}

// AND A WHEEL IN THE AIR GETS NOTHING. Measured through the same function the vehicle
// calls, so an airborne corner cannot leave a shadow hanging under it.
const airborne = patchOpacity(0, 4000, 1);
if (airborne !== 0) {
  failures.push(`an unloaded wheel draws a patch of opacity ${airborne}`);
}

rig.vehicle.dispose();
field.dispose();

if (failures.length > 0) {
  for (const f of failures) console.log(`  FAIL  ${f}`);
  throw new Error(`${failures.length} contact-patch checks failed`);
}
console.log(
  '\nevery patch sits on its own tyre, flat on the ground, and darkness follows the load',
);
