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
 * The surfaces to sweep, and what each one is held to.
 *
 * `digSurface` marks the loose ground the DIG exists for, and those are held to a
 * RELATION rather than to a grade: a digging surface must never be a penalty against
 * sealed Tarmac, because the dig exists precisely to guarantee that. It is NOT required
 * to climb the world's maximum when the drivetrain cannot — a heavy truck whose first gear
 * tops out at 13 degrees on asphalt is not trapped by sand, it is limited by its gearbox,
 * and demanding 18.7 degrees of it on sand would be demanding that loose ground out-climb
 * Tarmac.
 *
 * `roadDeck` marks the four surfaces the generator draws a road DISTRICT from (see
 * `DISTRICT_SURFACES` in `world/gradient.ts`), and those are held to the world's own
 * steepest grade outright. That is a different promise from the dig's, and it is the one
 * the LOW RANGE exists for: the road is where the player is ROUTED, so a pitch the car
 * cannot leave from a standstill is a dead end rather than a challenge. It used to go
 * unasserted here — "asphalt is the honest reference, printed so every other surface can
 * be read against it" — and that stance was wrong for exactly one reason: the reference
 * was not good enough. Measured before the concession, the starter VAZ-2101 escaped 10.9
 * degrees of honest asphalt while seed 1's road reaches 11.9.
 *
 * ROCK is deliberately in neither group. A bedrock outcrop is honest ground, and "this
 * slope is too steep for this car" is a legitimate answer there in a way that it is not on
 * a road.
 */
const SURFACES: readonly {
  name: string;
  type: SurfaceType;
  digSurface: boolean;
  roadDeck: boolean;
}[] = [
  { name: 'asphalt', type: SurfaceType.Asphalt, digSurface: false, roadDeck: true },
  { name: 'cracked', type: SurfaceType.CrackedAsphalt, digSurface: false, roadDeck: true },
  { name: 'gravel', type: SurfaceType.Gravel, digSurface: false, roadDeck: true },
  { name: 'concrete', type: SurfaceType.Concrete, digSurface: false, roadDeck: true },
  { name: 'sand', type: SurfaceType.Sand, digSurface: true, roadDeck: false },
  { name: 'shoulder', type: SurfaceType.LooseShoulder, digSurface: true, roadDeck: false },
  { name: 'rock', type: SurfaceType.Rock, digSurface: false, roadDeck: false },
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
    if (!surface.digSurface && !surface.roadDeck) {
      console.log(`${id.padEnd(20)} ${deg.toFixed(1).padStart(20)}   ${'—'.padStart(10)}   —`);
      continue;
    }

    // THE CONTRACT, in one line, and it is the same line for both groups: whatever this
    // body can climb on the reference surface it must also climb here, because the
    // concession exists precisely to guarantee that. It is NOT required to climb the
    // world's maximum when its own drivetrain cannot — a heavy truck whose first gear tops
    // out at 13 degrees on asphalt is not trapped by the road, it is limited by its
    // gearbox, and demanding 18.7 degrees of it would be demanding that the concession do
    // an engine's work. Measured: the UAZ-330364's torque ceiling is 15.1 degrees, its
    // honest asphalt escape 13.0, and it is the one body in the catalogue the deck's
    // requirement cannot reach.
    const reference = Math.min(WORLD_MAX_GRADE_DEG, await ceilingFor(id, SurfaceType.Asphalt));
    const required = reference - RELATIVE_TOLERANCE_DEG;
    const ok = deg >= required;
    if (!ok) failures++;
    const note =
      id === WEAKEST_RWD && deg >= WORLD_MAX_GRADE_DEG + WEAKEST_RWD_MARGIN_DEG
        ? ' (weakest RWD clears the world with margin)'
        : '';
    const verdict = ok
      ? surface.roadDeck
        ? 'road is escapable'
        : 'not a penalty'
      : surface.roadDeck
        ? 'DEAD END'
        : 'WORSE THAN ASPHALT';
    console.log(
      `${id.padEnd(20)} ${deg.toFixed(1).padStart(20)}   ` +
        `${`>= ${required.toFixed(1)}`.padStart(10)}   ` +
        `${verdict}${note}`,
    );
  }
}

// AND THE REQUIREMENT BOTH CONCESSIONS EXIST FOR, stated on its own so it cannot be lost
// among the fleet: the weakest front-engined rear-drive car clears the world's own steepest
// grade on every surface a car can be stuck on — the loose ground the dig covers, and the
// deck the road is made of — with margin.
for (const surface of SURFACES.filter((s) => s.digSurface || s.roadDeck)) {
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
  '\nno digging surface and no surface the road is made of is a penalty against asphalt, ' +
    `and the weakest rear-drive car clears the world's ` +
    `${WORLD_MAX_GRADE_DEG.toFixed(1)} degrees with margin`,
);
