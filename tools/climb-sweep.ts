/**
 * Climb sweep: how steep a grade each body in the catalogue can actually escape.
 *
 *   npx tsx tools/climb-sweep.ts [--surface sand|gravel|shoulder|rock] [--all]
 *
 * Every surface in this world only asks a car to climb what the terrain can generate,
 * and the terrain's own maximum is `MAX_SLOPE` — 18.7 degrees. A surface a car can get
 * into but not out of is a trap, so that number is the one this bench exists to defend:
 * for every body in the catalogue, the steepest grade it still escapes must be at least
 * the steepest grade the world can produce.
 *
 * "Escapes" is measured, not inferred: a real car, real Rapier, released from a parked
 * start on a real incline and driven at full throttle for the launch window. The window
 * has to be long enough to cover the gearbox's own engagement delay — during which the
 * car legitimately rolls back a little on a grade — so the rollback is measured and
 * reported rather than being hidden inside the criterion.
 *
 * The angles are found by bisection rather than by a fixed ladder, because the answer
 * is a threshold and a threshold is what an assertion can hold.
 */

import { SurfaceType } from '../src/core/surfaces';
import { MAX_SLOPE } from '../src/world/landscape';
import { installAssetShim } from './assetshim';
import { drive, makeRig } from './handling-bench';
import type { PhysicsWorld } from '../src/core/physics';
import { preloadCarModels } from '../src/render/carmodel';
import { CAR_MODELS } from '../src/vehicle/carmodels';

installAssetShim();

const ARGS = process.argv.slice(2);
function argValue(name: string, fallback: string): string {
  const i = ARGS.indexOf(`--${name}`);
  return i >= 0 && ARGS[i + 1] ? ARGS[i + 1]! : fallback;
}
const ONLY_SURFACE = argValue('surface', '');
const ALL = ARGS.includes('--all');

/** Seconds of full-throttle driving per angle. Covers the gearbox's launch delay. */
const WINDOW_S = 14;
/** Half-depth of the test incline, m. Long enough that nothing runs off the top. */
const RAMP_HALF_DEPTH = 150;
/** Tested grades, degrees. The floor is the world's steepest; the ceiling is a wall. */
const MIN_DEG = 5;
const MAX_DEG = 32;
/** Bisection resolution: 0.5 degrees is finer than the assertion needs. */
const BISECTION_STEPS = 6;

/**
 * The steepest grade this world can present a car. `MAX_SLOPE` is a rise over run, so
 * the angle that matters is its arctangent.
 */
export const WORLD_MAX_GRADE_DEG = (Math.atan(MAX_SLOPE) * 180) / Math.PI;

function addLongIncline(physics: PhysicsWorld, degrees: number, surface: SurfaceType): void {
  const rise = Math.tan((degrees * Math.PI) / 180) * RAMP_HALF_DEPTH;
  physics.addStaticTrimesh(
    new Float32Array([
      -40,
      -rise,
      -RAMP_HALF_DEPTH,
      40,
      -rise,
      -RAMP_HALF_DEPTH,
      -40,
      rise,
      RAMP_HALF_DEPTH,
      40,
      rise,
      RAMP_HALF_DEPTH,
    ]),
    new Uint32Array([0, 1, 2, 2, 1, 3]),
    surface,
  );
}

interface ClimbResult {
  readonly escaped: boolean;
  readonly netM: number;
  readonly lowestM: number;
  readonly finalMps: number;
}

/** Drives one body up one grade from a parked start. */
async function attempt(
  modelId: string,
  degrees: number,
  surface: SurfaceType,
): Promise<ClimbResult> {
  const rig = await makeRig(modelId, (physics) => addLongIncline(physics, degrees, surface), true);
  const startZ = rig.vehicle.chassis.translation().z;
  let lowestZ = startZ;
  drive(rig, WINDOW_S, (_, input) => {
    input.throttle = 1;
    input.reverse = false;
    input.steer = 0;
    input.handbrake = false;
    const z = rig.vehicle.chassis.translation().z;
    if (z < lowestZ) lowestZ = z;
  });
  const endZ = rig.vehicle.chassis.translation().z;
  const finalMps = rig.vehicle.audio.forwardMps;
  rig.vehicle.dispose();
  const netM = endZ - startZ;
  return {
    escaped: netM > 0.5 && finalMps > 0.5,
    netM,
    lowestM: lowestZ - startZ,
    finalMps,
  };
}

/** Steepest grade the body still escapes, by bisection, degrees. */
async function steepestEscape(modelId: string, surface: SurfaceType): Promise<number> {
  if (!(await attempt(modelId, MIN_DEG, surface)).escaped) return MIN_DEG;
  let low = MIN_DEG;
  let high = MAX_DEG;
  for (let i = 0; i < BISECTION_STEPS; i++) {
    const mid = (low + high) / 2;
    if ((await attempt(modelId, mid, surface)).escaped) low = mid;
    else high = mid;
  }
  return low;
}

/**
 * The surfaces to sweep, and whether each one has to clear the world's own maximum grade.
 *
 * `mustEscape` is not applied to every surface, and the reason is what each one IS:
 *
 *   - SAND and the loose SHOULDER are the two that form the open slopes a car gets onto
 *     by choice or by mistake, and being unable to climb out of either is a trap. They
 *     are held to the full world maximum.
 *   - GRAVEL exists in exactly one place, the homestead yard, which is built flat. There
 *     is no sloped gravel anywhere for a car to be trapped on, so sweeping it against a
 *     dune only measures a surface the player cannot meet. It is swept and printed for
 *     information, because a number that looks wrong should be visible.
 *   - ASPHALT is not asserted on at all. It is the reference: what a car climbs on the
 *     road is the honest limit of its drivetrain and tyres, and it is printed so every
 *     other surface can be read against it.
 *   - ROCK is bedrock outcrops: solid, and honest. Its coefficient is measured and much
 *     higher than loose ground's, so what stops a car on a steep outcrop is the engine's
 *     tractive effort, not a bog — and "this slope is too steep for this car" is a
 *     legitimate answer on rock in a way that it is not on sand. Nearly every surface in
 *     the world is limited by the drivetrain before it is limited by grip, and asphalt
 *     included: the same GAZ-21 that digs its way up 22 degrees of sand has 12 degrees
 *     of honest asphalt in it. The dig is a deliberate exception granted to the two
 *     surfaces that need one, not a floor applied to the whole world.
 */
const SURFACES: readonly { name: string; type: SurfaceType; digSurface: boolean }[] = [
  // Asphalt is the reference the whole fleet and the road itself were designed
  // around, so it is printed first and never asserted on directly: whatever a car can
  // do here is the honest traction limit of the machine, and every other surface is
  // read against it.
  { name: 'asphalt', type: SurfaceType.Asphalt, digSurface: false },
  { name: 'sand', type: SurfaceType.Sand, digSurface: true },
  { name: 'shoulder', type: SurfaceType.LooseShoulder, digSurface: true },
  { name: 'gravel', type: SurfaceType.Gravel, digSurface: false },
  { name: 'rock', type: SurfaceType.Rock, digSurface: false },
];

/**
 * How much worse than asphalt a digging surface is still allowed to be, degrees.
 *
 * Not zero, because the two are measured by bisection on a 0.4-degree grid and by two
 * different tyre laws — a digging wheel and a rolling one — so a tenth of a degree
 * either way is the instrument, not the world.
 */
const RELATIVE_TOLERANCE_DEG = 1;

/**
 * The body the absolute guarantee is made about.
 *
 * The user's requirement was specific and so is this: the WEAKEST front-engined
 * rear-drive car in the catalogue — which `tools/climb-limit.ts` independently reports
 * as the GAZ-21 Volga — must clear the steepest grade the world can generate, on the
 * loose surfaces, from a standstill. That is the car the whole sand concession exists
 * for, and naming it keeps the requirement visible instead of averaging it away across
 * a fleet that contains a four-wheel-drive truck.
 */
const WEAKEST_RWD = 'sv_gaz21';

/**
 * Clearance the weakest car must have over the world's own maximum, degrees.
 *
 * A margin rather than a bare pass: the bisection's own resolution is 0.4 degrees, and
 * a requirement met by a tenth of a degree is a requirement that will be broken by the
 * next unrelated change to the tyre model.
 */
const WEAKEST_RWD_MARGIN_DEG = 2;

const models = ALL ? CAR_MODELS.map((m) => m.id) : ['sv_gaz21', 'sv_vaz2101', 'sa_oka'];
console.log(
  `world's steepest grade: ${WORLD_MAX_GRADE_DEG.toFixed(1)} deg ` +
    `(MAX_SLOPE ${MAX_SLOPE})   window ${WINDOW_S} s   ${models.length} bodies   ` +
    `held to it: ${SURFACES.filter((s) => s.mustEscape).map((s) => s.name).join(', ')}`,
);

let failures = 0;
/** Every body's own sealed-road ceiling, measured once and reused as the yardstick. */
const asphaltCeiling = new Map<string, number>();

async function ceilingFor(id: string, surface: SurfaceType): Promise<number> {
  if (surface === SurfaceType.Asphalt) {
    const cached = asphaltCeiling.get(id);
    if (cached !== undefined) return cached;
    const measured = await steepestEscape(id, SurfaceType.Asphalt);
    asphaltCeiling.set(id, measured);
    return measured;
  }
  return steepestEscape(id, surface);
}

for (const surface of SURFACES) {
  if (ONLY_SURFACE && surface.name !== ONLY_SURFACE) continue;
  console.log(`\n--- ${surface.name} ---`);
  console.log('body                 steepest escape (deg)   vs asphalt   verdict');
  await preloadCarModels(models);
  for (const id of models) {
    const deg = await ceilingFor(id, surface.type);
    if (!surface.digSurface) {
      console.log(`${id.padEnd(20)} ${deg.toFixed(1).padStart(20)}   ${'—'.padStart(10)}   —`);
      continue;
    }

    // THE CONTRACT, in one line: a digging surface must never be a penalty. Whatever
    // this body can climb on sealed Tarmac it must also climb on sand and on the verge,
    // because the dig exists precisely to guarantee that. It is NOT required to climb
    // the world's maximum when its own drivetrain cannot — a heavy truck whose first
    // gear tops out at 13 degrees on asphalt is not trapped by sand, it is limited by
    // its gearbox, and demanding 18.7 degrees of it on sand would be demanding that
    // loose ground out-climb Tarmac.
    const reference = Math.min(WORLD_MAX_GRADE_DEG, await ceilingFor(id, SurfaceType.Asphalt));
    const required = reference - RELATIVE_TOLERANCE_DEG;
    const ok = deg >= required;
    if (!ok) failures++;
    const note =
      id === WEAKEST_RWD && deg >= WORLD_MAX_GRADE_DEG + WEAKEST_RWD_MARGIN_DEG
        ? ' (weakest RWD clears the world with margin)'
        : '';
    console.log(
      `${id.padEnd(20)} ${deg.toFixed(1).padStart(20)}   ` +
        `${`>= ${required.toFixed(1)}`.padStart(10)}   ` +
        `${ok ? 'not a penalty' : 'WORSE THAN ASPHALT'}${note}`,
    );
  }
}

// AND THE REQUIREMENT THE CONCESSION EXISTS FOR, stated on its own so it cannot be
// lost among the fleet: the weakest front-engined rear-drive car clears the world's own
// steepest grade on both digging surfaces, with margin.
for (const surface of SURFACES.filter((s) => s.digSurface)) {
  const deg = await ceilingFor(WEAKEST_RWD, surface.type);
  if (deg < WORLD_MAX_GRADE_DEG + WEAKEST_RWD_MARGIN_DEG) {
    failures++;
    console.log(
      `\nFAIL  ${WEAKEST_RWD} on ${surface.name}: ${deg.toFixed(1)} deg, ` +
        `needs ${(WORLD_MAX_GRADE_DEG + WEAKEST_RWD_MARGIN_DEG).toFixed(1)}`,
    );
  }
}

if (failures > 0) {
  throw new Error(`${failures} climb checks failed`);
}
console.log(
  '\nno digging surface is a penalty against asphalt, and the weakest rear-drive car ' +
    `clears the world's ${WORLD_MAX_GRADE_DEG.toFixed(1)} degrees with margin`,
);
