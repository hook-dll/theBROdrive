/**
 * tools/trailer-bench.ts
 *
 * Settles the trailer's exact rigid body — mass, collider, two tyre contacts and
 * their spring (src/vehicle/tyrecontact.ts) — against flat ground, a cross-slope and a
 * step under ONE wheel, and reports where the wheels, the bed and the drawbar actually
 * end up. The tow ball is a static anchor at a chosen height, so the coupled case can be
 * measured without a car in the room.
 *
 * Three numbers matter, and each one was a bug:
 *
 *  - RESERVE, the settled suspension length against the travel clamp
 *    (`rest - travel`). The contact draws AND simulates a clamped wheel at the clamp
 *    while the ground goes on rising, so once a bump needs more compression than the
 *    spring has left, that tyre goes through the terrain. The first spring (k=20,
 *    travel 0.22) settled with 32 mm left, which is why ONE wheel vanished into a
 *    hummock while the other sat correctly on it.
 *  - PITCH, with the ball at the design height (0.45 m) versus the height the old
 *    hitch code computed from the car's measured wheel mounts (up to 0.15 m high,
 *    because Vehicle corrects ride height when it builds the suspension). A ball at
 *    the wrong height is a joint holding the drawbar up: the trailer stands nose-up.
 *  - HANG, the settled suspension length, which is what `WHEEL_HANG` in
 *    src/vehicle/trailer.ts must equal — the art is fitted to it, so a wrong value
 *    rides the whole trailer at the wrong height with its wheels in the arches.
 *
 * The rates are given per kilogram, as `SUSPENSION` in trailer.ts is, and multiplied
 * by the trailer's mass the way its `applyMass` does before they reach the contacts.
 *
 * Usage: bun tools/trailer-bench.ts                  (the shipped setup)
 *        bun tools/trailer-bench.ts 32 0.3 0.3 0.166  (stiffness rest travel hang)
 *        bun tools/trailer-bench.ts sweep             (stiffness -> settled length)
 */
import RAPIER from '@dimforge/rapier3d-compat';
import type { PhysicsWorld } from '../src/core/physics';
import { TyreContacts, type TyreContact } from '../src/vehicle/tyrecontact';

await RAPIER.init();

// Mirrors src/vehicle/trailer.ts. Kept as literals rather than imported: that file
// pulls in three.js and the renderer.
const BED_HALF = [0.631, 0.126, 0.9525] as const;
const WHEEL_RADIUS = 0.289;
const TYRE_WIDTH = 0.155;
const AXLE_Z = 0.022;
const TRACK_HALF = 0.732;
const TARE = 180;
/** The kerb mass's three parts (trailer.ts TARE_*): box, running gear, drawbar. */
const TARE_RUNNING = 47;
const TARE_DRAWBAR = 20;
const HITCH_HEIGHT = 0.45;
const BALL_Z = 3.085 - BED_HALF[2] - 0.05;
const WALL_HEIGHT = 0.336;
const MAX_FORCE_N = 26000;
const G = 9.81;
const DT = 1 / 60;
const STEPS = 900; // 15 s at 60 Hz

const f3 = (n: number): string => n.toFixed(3);

interface Suspension {
  /** Per kilogram of trailer mass, as trailer.ts `SUSPENSION`. */
  readonly stiffness: number;
  readonly compression: number;
  readonly relaxation: number;
  readonly restLength: number;
  readonly maxTravel: number;
}

/**
 * The trailer's damping split for a per-kilogram `stiffness`: 0.30 and 0.45 of
 * critical, where critical is `2 * sqrt(stiffness * cornerShare)` with each of the two
 * wheels carrying half the mass (2.4 / 3.6 at k=32, as trailer.ts ships).
 */
function suspension(stiffness: number, restLength: number, maxTravel: number): Suspension {
  const critical = 2 * Math.sqrt(stiffness * 0.5);
  return {
    stiffness,
    restLength,
    maxTravel,
    compression: Number((0.3 * critical).toFixed(2)),
    relaxation: Number((0.45 * critical).toFixed(2)),
  };
}

interface Ground {
  build(world: RAPIER.World): void;
  /** Ground height under a given x. */
  heightAt(x: number): number;
}

const flat = (): Ground => ({
  build: (world) => {
    const b = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -1, 0));
    world.createCollider(RAPIER.ColliderDesc.cuboid(80, 1, 80).setFriction(0.9), b);
  },
  heightAt: () => 0,
});

const slope = (deg: number): Ground => ({
  build: (world) => {
    const tilt = (deg * Math.PI) / 180;
    const b = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed()
        .setTranslation(0, -1, 0)
        .setRotation({ x: 0, y: 0, z: Math.sin(tilt / 2), w: Math.cos(tilt / 2) }),
    );
    world.createCollider(RAPIER.ColliderDesc.cuboid(80, 1, 80).setFriction(0.9), b);
  },
  heightAt: (x) => x * Math.tan((deg * Math.PI) / 180),
});

/** Flat ground with a step of `h` metres under the +X wheel only. */
const step = (h: number): Ground => ({
  build: (world) => {
    flat().build(world);
    const b = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(TRACK_HALF, h / 2, AXLE_Z));
    world.createCollider(RAPIER.ColliderDesc.cuboid(0.7, h / 2, 0.9).setFriction(0.9), b);
  },
  heightAt: (x) => (x > 0 ? h : 0),
});

interface SettleOptions {
  readonly susp: Suspension;
  readonly hang: number;
  readonly cargoKg?: number;
  readonly ground?: Ground;
  /**
   * Height of the tow ball above the ground, or null to leave the trailer standing on
   * its own (which is nose-heavy by design — see the tongue-weight note in the output).
   */
  readonly ballHeight?: number | null;
}

interface Settled {
  readonly body: RAPIER.RigidBody;
  readonly wheels: readonly TyreContact[];
  readonly mountY: number;
  readonly ground: Ground;
}

/** Builds a trailer and settles it. */
function settle({ susp, hang, cargoKg = 0, ground = flat(), ballHeight = HITCH_HEIGHT }: SettleOptions): Settled {
  const mountY = -BED_HALF[1] + hang;
  const groundY = -BED_HALF[1] - WHEEL_RADIUS;
  const hitchLocalY = groundY + HITCH_HEIGHT;

  const world = new RAPIER.World({ x: 0, y: -G, z: 0 });
  world.timestep = DT;
  ground.build(world);

  const mass = TARE + cargoKg;
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(0, BED_HALF[1] + WHEEL_RADIUS, 0)
      .setAngularDamping(0.2)
      .setCanSleep(false),
  );
  const colliderHalfY = (BED_HALF[1] - mountY) / 2;
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(BED_HALF[0], colliderHalfY, BED_HALF[2])
      .setTranslation(0, mountY + colliderHalfY, 0)
      .setDensity(0)
      .setFriction(0.5)
      .setRestitution(0.02),
    body,
  );
  // The prop stand, exactly as src/vehicle/trailer.ts builds it: a leg from the
  // drawbar to the ground, enabled only while the trailer is uncoupled.
  const propLegHalfY = (hitchLocalY - groundY) / 2;
  const prop = world.createCollider(
    RAPIER.ColliderDesc.cuboid(0.04, propLegHalfY, 0.04)
      .setTranslation(0, (hitchLocalY + groundY) / 2, BED_HALF[2] + 0.45)
      .setDensity(0)
      .setFriction(1.2)
      .setRestitution(0),
    body,
  );
  prop.setEnabled(ballHeight === null);
  // The crate (0.6 m tall) on the deck, and the kerb mass where trailer.ts puts it: the
  // box at the deck, the running gear on the axle, the drawbar half way to the ball.
  const crateCentreY = BED_HALF[1] + 0.3;
  const tareBox = TARE - TARE_RUNNING - TARE_DRAWBAR;
  const comY =
    (tareBox * BED_HALF[1] + TARE_RUNNING * -BED_HALF[1] + TARE_DRAWBAR * hitchLocalY + cargoKg * crateCentreY) / mass;
  const comZ = (TARE_RUNNING * AXLE_Z + TARE_DRAWBAR * (BED_HALF[2] + BALL_Z) / 2) / mass;
  const hy = BED_HALF[1] + (cargoKg > 0 ? 0.3 : WALL_HEIGHT / 2);
  body.setAdditionalMassProperties(
    mass,
    { x: 0, y: comY, z: comZ },
    {
      x: (mass / 3) * (hy * hy + BED_HALF[2] ** 2),
      y: (mass / 3) * (BED_HALF[0] ** 2 + BED_HALF[2] ** 2),
      z: (mass / 3) * (BED_HALF[0] ** 2 + hy * hy),
    },
    { x: 0, y: 0, z: 0, w: 1 },
    false,
  );
  body.recomputeMassPropertiesFromColliders();

  // The tow ball: a static stand-in for the car's rear end. It holds its height
  // exactly, which is the point — the question is what the trailer does with the ball
  // at the right height and at the wrong one.
  if (ballHeight !== null) {
    const ballZ = BALL_Z;
    const anchor = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, ballHeight, ballZ));
    world.createImpulseJoint(
      RAPIER.JointData.spherical({ x: 0, y: 0, z: 0 }, { x: 0, y: hitchLocalY, z: ballZ }),
      anchor,
      body,
      true,
    );
  }

  // The contacts with the trailer's own setup: per-kilogram rates times the mass,
  // as `applyMass` sets them.
  const tyres = new TyreContacts({ world } as unknown as PhysicsWorld, body);
  for (const side of [-1, 1]) {
    const tyre = tyres.add({ x: side * TRACK_HALF, y: mountY, z: AXLE_Z }, susp.restLength, WHEEL_RADIUS, TYRE_WIDTH);
    tyre.maxTravelM = susp.maxTravel;
    tyre.maxForceN = MAX_FORCE_N;
    tyre.springRateNPerM = susp.stiffness * mass;
    tyre.compressionRateNsPerM = susp.compression * mass;
    tyre.relaxationRateNsPerM = susp.relaxation * mass;
  }

  for (let s = 0; s < STEPS; s++) {
    tyres.update(DT);
    world.step();
  }
  return { body, wheels: tyres.wheels, mountY, ground };
}

/** Body-space point -> world, so the report reads the same frame the renderer does. */
function toWorld(body: RAPIER.RigidBody, p: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  const t = body.translation();
  const q = body.rotation();
  const tx = 2 * (q.y * p.z - q.z * p.y);
  const ty = 2 * (q.z * p.x - q.x * p.z);
  const tz = 2 * (q.x * p.y - q.y * p.x);
  return {
    x: t.x + p.x + q.w * tx + (q.y * tz - q.z * ty),
    y: t.y + p.y + q.w * ty + (q.z * tx - q.x * tz),
    z: t.z + p.z + q.w * tz + (q.x * ty - q.y * tx),
  };
}

function report(label: string, opts: SettleOptions): string {
  const { body, wheels, mountY, ground } = settle(opts);
  const t = body.translation();
  const q = body.rotation();
  const pitch = Math.atan2(2 * (q.w * q.x + q.y * q.z), 1 - 2 * (q.x * q.x + q.y * q.y));
  const roll = Math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.y * q.y + q.z * q.z));
  const lens = wheels.map((w) => w.lengthM);
  const clamp = opts.susp.restLength - opts.susp.maxTravel;
  const lines = [
    `${label}: bedY ${f3(t.y)} pitch ${((pitch * 180) / Math.PI).toFixed(2)}deg ` +
      `roll ${((roll * 180) / Math.PI).toFixed(2)}deg susp [${lens.map(f3).join(', ')}] ` +
      `reserve [${lens.map((l) => f3(l - clamp)).join(', ')}]`,
  ];
  for (const i of [0, 1]) {
    const x = i === 0 ? -TRACK_HALF : TRACK_HALF;
    // Exactly what the renderer draws: the mount, in body space, minus the
    // suspension length, along the body's own down axis.
    const centre = toWorld(body, { x, y: mountY - lens[i]!, z: AXLE_Z });
    const bottom = centre.y - WHEEL_RADIUS;
    // Under the wheel where it is, not where it was built: on the cross-slope the
    // trailer, held at the ball and with no tyre side force here, swings down the hill.
    const gy = ground.heightAt(centre.x);
    const sink = gy - bottom;
    lines.push(
      `   wheel ${i} (x ${x.toFixed(2)} -> ${centre.x.toFixed(2)}): centre ${f3(centre.y)} bottom ${f3(bottom)} ` +
        `ground ${f3(gy)} contact ${wheels[i]!.inContact} ` +
        `=> ${sink > 0.02 ? `SUNK ${(sink * 1000).toFixed(0)} mm` : 'on the ground'}`,
    );
  }
  return lines.join('\n');
}

if (process.argv[2] === 'sweep') {
  console.log('Settled suspension length by rate (rest 0.30, travel 0.30, coupled, empty):');
  console.log('stiffness   analytic sag g/2k   settled length   compression   reserve');
  for (const k of [20, 26, 32, 38, 44, 50, 60]) {
    const susp = suspension(k, 0.3, 0.3);
    const { wheels } = settle({ susp, hang: 0.19 });
    const len = wheels[0]!.lengthM;
    console.log(
      `${String(k).padStart(9)}   ${f3(G / (2 * k)).padStart(17)}   ${f3(len).padStart(14)}   ` +
        `${f3(susp.restLength - len).padStart(11)}   ${f3(len)}`,
    );
  }
  console.log('');
  console.log('Mass independence (rates scaled by the mass, as applyMass does, k=32):');
  for (const cargo of [0, 285, 570]) {
    const { wheels } = settle({ susp: suspension(32, 0.3, 0.3), hang: 0.166, cargoKg: cargo });
    console.log(`   cargo ${String(cargo).padStart(3)} kg -> settled length ${f3(wheels[0]!.lengthM)}`);
  }
  process.exit(0);
}

const k = Number(process.argv[2] ?? 32);
const rest = Number(process.argv[3] ?? 0.3);
const travel = Number(process.argv[4] ?? 0.3);
const hang = Number(process.argv[5] ?? 0.166);
const susp = suspension(k, rest, travel);

console.log(
  `stiffness ${k}/kg rest ${rest} travel ${travel} damping ${susp.compression}/${susp.relaxation} /kg ` +
    `(critical ${(2 * Math.sqrt(k * 0.5)).toFixed(2)}, body mode ${(Math.sqrt(2 * k) / (2 * Math.PI)).toFixed(2)} Hz; ` +
    `empty ${(k * TARE).toFixed(0)} N/m per wheel)`,
);
console.log(
  `WHEEL_HANG ${f3(hang)} -> MOUNT_Y ${f3(-BED_HALF[1] + hang)}; ` +
    `the art wants the bed at ${f3(BED_HALF[1] + WHEEL_RADIUS)} m over flat ground`,
);
console.log('');

console.log('--- coupled, ball at the design height (0.45 m) ---');
console.log(report('flat, empty      ', { susp, hang }));
console.log(report('flat, 570 kg     ', { susp, hang, cargoKg: 570 }));
console.log(report('4deg cross-slope ', { susp, hang, ground: slope(4) }));
console.log(report('120 mm step      ', { susp, hang, ground: step(0.12) }));
console.log(report('200 mm step      ', { susp, hang, ground: step(0.2) }));
console.log('');
console.log('--- coupled, ball 0.15 m high: what the old hitch code computed ---');
console.log(report('flat, empty      ', { susp, hang, ballHeight: HITCH_HEIGHT + 0.15 }));
console.log('');
console.log('--- uncoupled, standing on its prop stand. The drawbar\'s mass is ahead of the');
console.log('    axle, so the tongue is heavy: without the stand it stands on its coupler ---');
console.log(report('standing, empty  ', { susp, hang, ballHeight: null }));
