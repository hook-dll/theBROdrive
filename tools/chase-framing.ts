/**
 * tools/chase-framing.ts
 *
 * What the chase view actually puts on screen while the player drives: where the horizon
 * sits in the frame, how much of it the car takes, whether the projection is ever yanked,
 * and how far the aim trails the car's heading.
 *
 * The rig's constants are metres and radians that each look plausible in review — the arm's
 * elevation, the FOV ceiling — and what they produce is not a number but a picture. So this
 * drives the REAL `CameraRig` along the REAL road with the REAL terrain collided under it,
 * reads the frame back out of the camera, and holds five properties:
 *
 *   THE HORIZON SITS IN THE UPPER THIRD. Where it lands decides how much of the picture is
 *   road and how far down the road the eye is led. Because the arm always aims back at the
 *   car's centre, the horizon is placed by the arm's elevation alone:
 *   `(1 - tan(armPitch) / tan(fov / 2)) / 2` of the frame height from the top.
 *
 *   THE CAR READS, AND DOES NOT FILL THE FRAME — at either end of the speed range.
 *
 *   THE CAR DOES NOT SHRINK AWAY AT SPEED. That is the price of the FOV widening, stated as
 *   the player pays it: two things shrink the car at speed, and only one of them is the
 *   projection's business.
 *
 *   THE PROJECTION NEVER JUMPS. The FOV is speed-driven, so it must ease, and it must not
 *   reverse while the speed is rising. A projection assigned rather than eased steps by
 *   degrees in one frame, which the eye reads as a cut.
 *
 *   THE ROAD AHEAD STAYS FRAMED. The aim belongs to the player, and the rig only eases it
 *   back toward the live vehicle heading after a spell of no horizontal look. Read over a
 *   real drive, this is how far the road ahead sits off centre while the road bends.
 *
 *   npx tsx tools/chase-framing.ts
 *
 * Nothing here is part of the game bundle.
 */
import * as THREE from 'three';
import { installAssetShim } from './assetshim';
import { carModelMeasure, preloadCarModels, type CarModelMeasure } from '../src/render/carmodel';
import { PhysicsWorld } from '../src/core/physics';
import { Road } from '../src/world/road';
import { Terrain } from '../src/world/terrain';
import { WorldOrigin } from '../src/world/origin';
import { CameraRig, type CameraTarget } from '../src/render/cameras';
import { emptyInput } from '../src/core/input';
import { CAR_MODELS } from '../src/vehicle/carmodels';
import { SurfaceType } from '../src/core/surfaces';

installAssetShim();
await preloadCarModels();

const SEED = 1337;
const FIXED_DT = 1 / 60;
/** Speeds the framing is measured at, km/h: rest, an ordinary cruise, and flat out. */
const SPEEDS = [0, 60, 130];
/** Metres of road driven at each speed, per stretch. */
const STRETCH_M = 500;
/** Stretches measured, spread far enough apart that the relief under them differs. */
const STRETCH_STARTS = [1_000, 8_000, 15_000, 22_000, 29_000, 36_000, 43_000, 50_000];
/** Lane the frames are measured from, metres from the centreline. */
const LANE_LATERAL = 3;
/**
 * Terrain collider cell size, metres.
 *
 * The shipped desert heightfield uses 3 m cells; this samples at 6 and pays a third of the
 * runtime for it. Measured over the same two stretches, the coarser lattice moved one
 * stretch's median horizon by 0.4 percentage points and left the other identical — an order
 * of magnitude inside the band the check holds, so the cheaper lattice answers the question.
 */
const GROUND_CELL_M = 6;
/** Frames skipped at the start of a run, while the position spring catches up. */
const SETTLE_FRAMES = 60;
/** Frames the car is left sitting at rest for. */
const REST_FRAMES = 240;

/**
 * The band the horizon must sit in, as a fraction of the frame height from the top.
 *
 * Wide at the bottom because the GROUND moves the eye and the composition is not allowed to
 * compensate: the rig lifts the eye off terrain rising behind the car, while the view goes on
 * aiming at the car's own centre — which is a deliberate choice, since leading the look point
 * down the road made the camera pivot around one end of the car. So a rise behind the car
 * pushes the horizon down the frame, and over a real drive that is worth about three points.
 * Measured: 35.0% at a standstill, 35.8..39.2 at 60, 36.5..42.0 at 130.
 */
const HORIZON_MIN = 0.33;
const HORIZON_MAX = 0.43;
/** The car must never be a speck, and never stand so close that it fills the frame. */
const CAR_MIN_SHARE = 0.07;
const CAR_MAX_SHARE = 0.32;
/**
 * How much smaller the car may get from a standstill to the top speed.
 *
 * Two things shrink it at speed: the projection opening up, and the arm's position spring
 * lagging the car by `speed / SPRING_OMEGA` metres — 5.9 m behind at rest, 8.6 at 130 km/h.
 * Only the first is the FOV's business, and this bounds what the two together may cost.
 */
const CAR_SHRINK_MAX = 1.8;
/**
 * Widest the view may get, degrees VERTICAL.
 *
 * At 16:9 that is 100 degrees horizontal. A rectilinear projection stretches the picture
 * along the frame's radius by `1 / cos²(angle)`: at 70 vertical that is 2.4x at the corners
 * against 2.3x at the resting 65, while the 79 this ceiling replaced stretched them 3.1x.
 */
const MAX_WIDE_FOV_DEG = 70;
/** The resting view, degrees: the FOV the speed cue widens from. */
const RESTING_FOV_DEG = 65;
/** Largest FOV change one frame may make, degrees. See the property list above. */
const MAX_FOV_STEP_DEG = 0.5;
/** Seconds a full-throttle launch is held, for the smoothness property. */
const LAUNCH_SECONDS = 20;
/** Long drive the aim is read over, metres, and how often the player glances aside. */
const TRAIL_DRIVE_M = 30_000;
const GLANCE_PERIOD_S = 12;
/** Slack the resting camera must keep from the car's own body box, metres. */
const BODY_SKIN_M = 0.2;

const road = new Road(SEED);
const terrain = new Terrain(SEED, road);

interface Body {
  readonly id: string;
  readonly measure: CarModelMeasure;
}

const catalogue: Body[] = CAR_MODELS.map((def) => ({
  id: def.id,
  measure: carModelMeasure(def.id),
})).sort((a, b) => a.measure.halfExtents[1] - b.measure.halfExtents[1]);
/** Shortest, middle and tallest bodies: the range the camera has to work across. */
const MEASURED = [
  catalogue[0]!,
  catalogue[Math.floor(catalogue.length / 2)]!,
  catalogue[catalogue.length - 1]!,
];

interface Frame {
  readonly rig: CameraRig;
  readonly camera: THREE.PerspectiveCamera;
}

const target: CameraTarget = {
  x: 0,
  y: 0,
  z: 0,
  qx: 0,
  qy: 0,
  qz: 0,
  qw: 1,
  speedKmh: 0,
  hoodOffset: [0, 0, 0],
};
let carYaw = 0;

function makeFrame(physics: PhysicsWorld): Frame {
  const camera = new THREE.PerspectiveCamera(RESTING_FOV_DEG, 16 / 9, 0.05, 12_000);
  return { rig: new CameraRig(camera, physics, new WorldOrigin()), camera };
}

/** Puts the car on the road at `s`, pointing along it. */
function placeCar(s: number, halfY: number): void {
  const point = road.offsetPoint(s, LANE_LATERAL);
  carYaw = road.sampleAt(s).heading;
  target.x = point.x;
  target.z = point.z;
  target.y = terrain.heightAt(point.x, point.z, s) + halfY;
  target.qy = Math.sin(carYaw / 2);
  target.qw = Math.cos(carYaw / 2);
}

/** Where the horizon sits in the frame: fraction of the frame height from the top. */
function horizonFraction(frame: Frame): number {
  const dir = frame.rig.eyeDirection;
  const depression = Math.atan2(-dir.y, Math.hypot(dir.x, dir.z));
  const halfTan = Math.tan(THREE.MathUtils.degToRad(frame.camera.fov) / 2);
  return (1 - THREE.MathUtils.clamp(Math.tan(depression) / halfTan, -1, 1)) / 2;
}

/** The car's own height as a fraction of the frame, seen from the eye. */
function carFraction(frame: Frame, halfY: number): number {
  const eye = frame.rig.eyePosition;
  const distance = Math.hypot(eye.x - target.x, eye.z - target.z);
  return (halfY * 2) / (2 * distance * Math.tan(THREE.MathUtils.degToRad(frame.camera.fov) / 2));
}

/** How far the view's aim trails the live vehicle heading, degrees. */
function trailDeg(frame: Frame): number {
  let error = carYaw - frame.rig.yaw;
  while (error > Math.PI) error -= Math.PI * 2;
  while (error < -Math.PI) error += Math.PI * 2;
  return Math.abs(THREE.MathUtils.radToDeg(error));
}

/**
 * The eye in the car's own frame: `[right, up, forward]` from the car's centre, with
 * forward positive along the car's heading. The inverse of `rotateXZ` in `world/poi.ts`,
 * which is this project's convention throughout.
 */
function eyeInCarFrame(frame: Frame): [number, number, number] {
  const eye = frame.rig.eyePosition;
  const c = Math.cos(carYaw);
  const s = Math.sin(carYaw);
  const dx = eye.x - target.x;
  const dz = eye.z - target.z;
  return [c * dx - s * dz, eye.y - target.y, s * dx + c * dz];
}

function percentile(sorted: readonly number[], q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
}

const median = (values: readonly number[]): number =>
  percentile([...values].sort((a, b) => a - b), 0.5);

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(46)} ${detail}`);
}

/**
 * Real terrain under a stretch of road, as a Rapier heightfield.
 *
 * The rig's ground probe is a raycast, so a bench with an empty physics world would measure
 * a camera that is never lifted and never occluded — which is not the camera the player
 * drives behind. The lattice is sampled the way `world/deserttiledata.ts` samples it (height
 * index `ix * verts + iz`, x varying slowest) and then VERIFIED along the road, because a
 * transposed heightfield still collides, just against the wrong ground.
 */
async function groundForStretch(
  start: number,
): Promise<{ physics: PhysicsWorld; worstErrorM: number }> {
  const xs: number[] = [];
  const zs: number[] = [];
  for (let s = start - 80; s <= start + STRETCH_M + 80; s += 40) {
    const p = road.offsetPoint(s, LANE_LATERAL);
    xs.push(p.x);
    zs.push(p.z);
  }
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);
  const margin = 60;
  const span = Math.max(maxX - minX, maxZ - minZ) + margin * 2;
  const cells = Math.ceil(span / GROUND_CELL_M);
  const verts = cells + 1;
  const step = span / cells;
  const centreX = (minX + maxX) / 2;
  const centreZ = (minZ + maxZ) / 2;
  const startX = centreX - span / 2;
  const startZ = centreZ - span / 2;

  const physics = await PhysicsWorld.create();
  const heights = new Float32Array(verts * verts);
  for (let ix = 0; ix < verts; ix++) {
    const x = startX + ix * step;
    for (let iz = 0; iz < verts; iz++) {
      heights[ix * verts + iz] = terrain.heightAt(x, startZ + iz * step);
    }
  }
  physics.addHeightfield(
    cells,
    cells,
    heights,
    { x: span, y: 1, z: span },
    { x: centreX, y: 0, z: centreZ },
    SurfaceType.Sand,
  );
  // Rapier answers raycasts from its query pipeline, which only `step` refreshes: without
  // this the field is in the world but invisible to every probe, and a bench that never
  // hits the ground would pass while measuring a camera that is never lifted.
  physics.step();

  let worstErrorM = 0;
  for (let i = 0; i <= 12; i++) {
    // Probed ALONG the road the car drives, since that is the ground the camera is lifted
    // from. Clamped inside the field's edge, where a ray cannot fall off it.
    const s = start + (i * STRETCH_M) / 12;
    const point = road.offsetPoint(s, LANE_LATERAL);
    const x = Math.min(Math.max(point.x, minX + 3), maxX - 3);
    const z = Math.min(Math.max(point.z, minZ + 3), maxZ - 3);
    const drawn = terrain.heightAt(x, z, s);
    const hit = physics.raycast({ x, y: drawn + 80, z }, { x: 0, y: -1, z: 0 }, 300);
    if (!hit) throw new Error(`no ground at ${x.toFixed(0)}, ${z.toFixed(0)}: field misplaced`);
    worstErrorM = Math.max(worstErrorM, Math.abs(hit.point.y - drawn));
  }
  if (worstErrorM > GROUND_CELL_M) {
    throw new Error(`ground does not match the terrain: worst ${worstErrorM.toFixed(2)} m`);
  }
  return { physics, worstErrorM };
}

const input = emptyInput();

/* ---- 1. the frame the player gets, over real ground --------------------------- */

console.log('car              speed   horizon p5/p50/p95        car      eye clearance  behind');
const horizons = new Map<number, number[]>();
const shares = new Map<string, number[]>();
let worstGroundError = 0;
let resting: { body: Body; local: [number, number, number]; eyeAboveGround: number } | null =
  null;
let restingFov = 0;

for (const start of STRETCH_STARTS) {
  const { physics, worstErrorM } = await groundForStretch(start);
  worstGroundError = Math.max(worstGroundError, worstErrorM);

  for (const speed of SPEEDS) {
    for (const body of MEASURED) {
      const frame = makeFrame(physics);
      const halfY = body.measure.halfExtents[1];
      const metresPerFrame = (speed / 3.6) * FIXED_DT;
      const frames = speed === 0 ? REST_FRAMES : Math.round(STRETCH_M / metresPerFrame);
      const stretchHorizon: number[] = [];
      const stretchCar: number[] = [];
      for (let i = 0; i < frames; i++) {
        placeCar(start + i * metresPerFrame, halfY);
        target.speedKmh = speed;
        frame.rig.update(FIXED_DT, input, target, false);
        if (i >= SETTLE_FRAMES) {
          stretchHorizon.push(horizonFraction(frame));
          stretchCar.push(carFraction(frame, halfY));
        }
      }
      stretchHorizon.sort((a, b) => a - b);
      stretchCar.sort((a, b) => a - b);
      const eye = frame.rig.eyePosition;
      // The ground BENEATH THE EYE. The car's own ground is metres away over terrain that
      // undulates by more than the arm's own height, so comparing the two measures nothing.
      const below = physics.raycast({ x: eye.x, y: eye.y, z: eye.z }, { x: 0, y: -1, z: 0 }, 200);
      const clearance = below ? eye.y - below.point.y : NaN;
      console.log(
        `  ${body.id.padEnd(14)} ${String(speed).padStart(3)} km/h  ` +
          `${((percentile(stretchHorizon, 0.05) * 100).toFixed(1) + '% / ' +
            (percentile(stretchHorizon, 0.5) * 100).toFixed(1) + '% / ' +
            (percentile(stretchHorizon, 0.95) * 100).toFixed(1) + '%').padEnd(24)}` +
          `${(percentile(stretchCar, 0.5) * 100).toFixed(1)}%`.padEnd(9) +
          `${clearance.toFixed(2)} m`.padEnd(17) +
          `${Math.hypot(eye.x - target.x, eye.z - target.z).toFixed(2)} m`,
      );
      horizons.set(speed, [...(horizons.get(speed) ?? []), ...stretchHorizon]);
      const key = `${speed}:${body.id}`;
      shares.set(key, [...(shares.get(key) ?? []), ...stretchCar]);
      if (resting === null && speed === 0) {
        // Captured HERE, because `target` and `carYaw` move on with the next stretch and a
        // later reading of the eye against them would measure nothing at all.
        const under = physics.raycast({ x: eye.x, y: eye.y, z: eye.z }, { x: 0, y: -1, z: 0 }, 200);
        resting = {
          body,
          local: eyeInCarFrame(frame),
          eyeAboveGround: under ? eye.y - under.point.y : NaN,
        };
        restingFov = frame.camera.fov;
      }
    }
  }
}

console.log('');
for (const speed of SPEEDS) {
  const horizon = [...horizons.get(speed)!].sort((a, b) => a - b);
  check(
    `at ${String(speed).padStart(3)} km/h: the horizon sits in the upper third`,
    percentile(horizon, 0.05) >= HORIZON_MIN && percentile(horizon, 0.95) <= HORIZON_MAX,
    `${(percentile(horizon, 0.05) * 100).toFixed(1)}%..${(percentile(horizon, 0.95) * 100).toFixed(1)}% ` +
      `from the top (band ${HORIZON_MIN * 100}..${HORIZON_MAX * 100}%)`,
  );
  let widestShare = 0;
  let narrowestShare = 1;
  for (const body of MEASURED) {
    const value = median(shares.get(`${speed}:${body.id}`)!);
    widestShare = Math.max(widestShare, value);
    narrowestShare = Math.min(narrowestShare, value);
  }
  check(
    `at ${String(speed).padStart(3)} km/h: the car reads without filling the frame`,
    narrowestShare >= CAR_MIN_SHARE && widestShare <= CAR_MAX_SHARE,
    `${(narrowestShare * 100).toFixed(1)}%..${(widestShare * 100).toFixed(1)}% of the frame ` +
      `height across the catalogue's shortest..tallest bodies`,
  );
}

for (const body of MEASURED) {
  const atRest = median(shares.get(`0:${body.id}`)!);
  const flatOut = median(shares.get(`130:${body.id}`)!);
  const shrink = atRest / flatOut;
  check(
    `${body.id.padEnd(14)}: does not shrink away at speed`,
    shrink <= CAR_SHRINK_MAX,
    `${(atRest * 100).toFixed(1)}% at rest, ${(flatOut * 100).toFixed(1)}% at 130 km/h ` +
      `(x${shrink.toFixed(2)}, limit x${CAR_SHRINK_MAX})`,
  );
}

/* ---- 2. the projection eases, and never reverses under rising speed ----------- */

{
  const frame = makeFrame(await PhysicsWorld.create());
  let previous = frame.camera.fov;
  let worstStep = 0;
  let reversals = 0;
  let widest = 0;
  const frames = LAUNCH_SECONDS * 60;
  for (let i = 0; i < frames; i++) {
    placeCar(1_000 + i * 0.02, MEASURED[1]!.measure.halfExtents[1]);
    // A launch into the top of the range: 130 km/h in twenty seconds.
    target.speedKmh = (130 * i) / frames;
    frame.rig.update(FIXED_DT, input, target, false);
    const step = Math.abs(frame.camera.fov - previous);
    if (step > worstStep) worstStep = step;
    if (frame.camera.fov < previous - 1e-9) reversals++;
    previous = frame.camera.fov;
    widest = Math.max(widest, frame.camera.fov);
  }
  console.log('');
  check(
    'the projection never steps in one frame',
    worstStep <= MAX_FOV_STEP_DEG,
    `worst ${worstStep.toFixed(4)} deg/frame at full throttle`,
  );
  check(
    'the FOV rises with speed and never reverses',
    reversals === 0,
    `${reversals} frames moved the view the wrong way`,
  );
  check(
    'the fastest view is no wider than the ceiling',
    widest <= MAX_WIDE_FOV_DEG + 0.01,
    `${widest.toFixed(1)} deg vertical, ceiling ${MAX_WIDE_FOV_DEG}`,
  );
  check(
    'the resting view is the resting FOV',
    Math.abs(restingFov - RESTING_FOV_DEG) < 0.01,
    `${restingFov.toFixed(2)} deg at a standstill`,
  );
}

/* ---- 3. the aim keeps the road ahead framed ---------------------------------- */

{
  const frame = makeFrame(await PhysicsWorld.create());
  const halfY = MEASURED[1]!.measure.halfExtents[1];
  const speed = 60;
  const metresPerFrame = (speed / 3.6) * FIXED_DT;
  const trails: number[] = [];
  let frames = 0;
  for (let s = 1_000; s < 1_000 + TRAIL_DRIVE_M; s += metresPerFrame) {
    placeCar(s, halfY);
    target.speedKmh = speed;
    // A glance every twelve seconds: the common case of a player looking about, and the
    // one that parks the aim on its world heading until the idle timer expires.
    input.lookYaw = frames % (GLANCE_PERIOD_S * 60) < 2 ? 0.02 : 0;
    frame.rig.update(FIXED_DT, input, target, false);
    trails.push(trailDeg(frame));
    frames++;
  }
  input.lookYaw = 0;
  trails.sort((a, b) => a - b);
  const mean = trails.reduce((sum, v) => sum + v, 0) / trails.length;
  console.log('');
  check(
    'the road ahead stays framed while the road bends',
    percentile(trails, 0.99) <= 35 && mean <= 5,
    `mean ${mean.toFixed(1)} deg, p95 ${percentile(trails, 0.95).toFixed(1)}, ` +
      `p99 ${percentile(trails, 0.99).toFixed(1)}, max ${trails[trails.length - 1]!.toFixed(1)}`,
  );
}

/* ---- 4. the camera stands clear of the car it is filming --------------------- */

{
  if (resting === null) throw new Error('the resting camera was never measured');
  const { body, local, eyeAboveGround } = resting;
  const [halfX, halfY, halfZ] = body.measure.halfExtents;
  const [right, up, forward] = local;
  const behind = -forward;
  const inside =
    Math.abs(right) < halfX + BODY_SKIN_M &&
    Math.abs(up) < halfY + BODY_SKIN_M &&
    behind < halfZ + BODY_SKIN_M;
  console.log('');
  check(
    'the resting camera stands outside the car, not inside it',
    !inside,
    `${behind.toFixed(2)} m behind the centre, ${up.toFixed(2)} m up; body half length ` +
      `${halfZ.toFixed(2)} m, half height ${halfY.toFixed(2)} m`,
  );
  console.log(
    `  note  eye ${eyeAboveGround.toFixed(2)} m above the ground beneath it on ${body.id}, ` +
      `whose roof is ${(halfY * 2).toFixed(2)} m tall`,
  );

  // The zoom is the player's, so this is reported rather than required: twelve wheel
  // notches in is the closest the arm goes, and whether that is inside the bodywork is a
  // choice, not a defect to assert against.
  const zoomed = makeFrame(await PhysicsWorld.create());
  input.zoomDelta = -1;
  for (let i = 0; i < 12; i++) {
    placeCar(1_000, halfY);
    zoomed.rig.update(FIXED_DT, input, target, false);
  }
  input.zoomDelta = 0;
  const [, zoomUp, zoomForward] = eyeInCarFrame(zoomed);
  console.log(
    `  note  zoomed as far in as it goes: ${(-zoomForward).toFixed(2)} m behind the centre, ` +
      `${zoomUp.toFixed(2)} m up — the tail is at ${halfZ.toFixed(2)} m`,
  );
}

console.log('');
console.log(
  `terrain under the measured stretches matches the drawn ground to ${worstGroundError.toFixed(4)} m`,
);
console.log(failures === 0 ? 'all checks passed' : `${failures} FAILURES`);
if (failures) process.exitCode = 1;
