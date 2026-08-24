#!/usr/bin/env node
/**
 * tools/trailer-bench.mjs
 *
 * Settles the trailer's exact rigid body — mass, collider, two ray-cast wheels and
 * their spring — against flat ground, a cross-slope and a step under ONE wheel, and
 * reports where the wheels, the bed and the drawbar actually end up. The tow ball is
 * a static anchor at a chosen height, so the coupled case can be measured without a
 * car in the room.
 *
 * Three numbers matter, and each one was a bug:
 *
 *  - RESERVE, the settled suspension length against the travel clamp
 *    (`rest - travel`). Rapier draws AND simulates a clamped wheel at the clamp
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
 * Usage: node tools/trailer-bench.mjs                  (the shipped setup)
 *        node tools/trailer-bench.mjs 32 0.3 0.3 0.193  (stiffness rest travel hang)
 *        node tools/trailer-bench.mjs sweep             (stiffness -> settled length)
 */
import RAPIER from '@dimforge/rapier3d-compat';

await RAPIER.init();

// Mirrors src/vehicle/trailer.ts. Kept as literals rather than imported: this is a
// node script and that file is TypeScript pulling in three.js.
const BED_HALF = [0.9, 0.35, 1.4];
const WHEEL_RADIUS = 0.32;
const AXLE_Z = -0.2;
const TRACK_HALF = 0.95;
const TARE = 320;
const HITCH_HEIGHT = 0.45;
const DRAWBAR = 0.9;
const G = 9.81;
const STEPS = 900; // 15 s at 60 Hz

const f3 = (n) => n.toFixed(3);

function suspension(stiffness, restLength, maxTravel) {
  const critical = 2 * Math.sqrt(stiffness);
  return {
    stiffness,
    restLength,
    maxTravel,
    compression: Number((0.35 * critical).toFixed(2)),
    relaxation: Number((0.45 * critical).toFixed(2)),
    maxForce: 26000,
  };
}

/** Ground shapes. Each returns the ground height under a given x. */
const flat = () => ({
  build: (world) => {
    const b = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -1, 0));
    world.createCollider(RAPIER.ColliderDesc.cuboid(80, 1, 80).setFriction(0.9), b);
  },
  heightAt: () => 0,
});

const slope = (deg) => ({
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
const step = (h) => ({
  build: (world) => {
    flat().build(world);
    const b = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(TRACK_HALF, h / 2, AXLE_Z),
    );
    world.createCollider(RAPIER.ColliderDesc.cuboid(0.7, h / 2, 0.9).setFriction(0.9), b);
  },
  heightAt: (x) => (x > 0 ? h : 0),
});

/**
 * Builds a trailer and settles it.
 *
 * @param ballHeight height of the tow ball above the ground, or null to leave the
 *                   trailer standing on its own (which is nose-heavy by design —
 *                   see the tongue-weight note in the output).
 */
function settle({ susp, hang, cargoKg = 0, ground = flat(), ballHeight = HITCH_HEIGHT, drag = 0 }) {
  const mountY = -BED_HALF[1] + hang;
  const groundY = -BED_HALF[1] - WHEEL_RADIUS;
  const hitchLocalY = groundY + HITCH_HEIGHT;

  const world = new RAPIER.World({ x: 0, y: -G, z: 0 });
  world.timestep = 1 / 60;
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
  const crateCentreY = BED_HALF[1] + 0.45;
  const tareComY = -0.35 * BED_HALF[1];
  const comY = (TARE * tareComY + cargoKg * crateCentreY) / mass;
  const hy = BED_HALF[1] + (cargoKg > 0 ? 0.45 : 0);
  body.setAdditionalMassProperties(
    mass,
    { x: 0, y: comY, z: 0 },
    {
      x: (mass / 3) * (hy * hy + BED_HALF[2] ** 2),
      y: (mass / 3) * (BED_HALF[0] ** 2 + BED_HALF[2] ** 2),
      z: (mass / 3) * (BED_HALF[0] ** 2 + hy * hy),
    },
    { x: 0, y: 0, z: 0, w: 1 },
    false,
  );
  body.recomputeMassPropertiesFromColliders();

  // The tow ball: a static stand-in for the car's rear end when the trailer is
  // parked (it holds its height exactly, which is the point — the question is what
  // the trailer does with the ball at the right height and at the wrong one), or a
  // velocity-driven kinematic body when the trailer is being towed.
  let anchor = null;
  const ballZ = BED_HALF[2] + DRAWBAR;
  if (ballHeight !== null) {
    anchor = world.createRigidBody(
      drag > 0
        ? RAPIER.RigidBodyDesc.kinematicVelocityBased().setTranslation(0, ballHeight, ballZ)
        : RAPIER.RigidBodyDesc.fixed().setTranslation(0, ballHeight, ballZ),
    );
    world.createImpulseJoint(
      RAPIER.JointData.spherical({ x: 0, y: 0, z: 0 }, { x: 0, y: hitchLocalY, z: ballZ }),
      anchor,
      body,
      true,
    );
  }

  const c = new RAPIER.DynamicRayCastVehicleController(
    body,
    world.broadPhase,
    world.narrowPhase,
    world.bodies,
    world.colliders,
  );
  c.indexUpAxis = 1;
  c.setIndexForwardAxis = 2;
  for (const side of [-1, 1]) {
    const i = c.numWheels();
    c.addWheel(
      { x: side * TRACK_HALF, y: mountY, z: AXLE_Z },
      { x: 0, y: -1, z: 0 },
      { x: -1, y: 0, z: 0 },
      susp.restLength,
      WHEEL_RADIUS,
    );
    c.setWheelSuspensionStiffness(i, susp.stiffness);
    c.setWheelSuspensionCompression(i, susp.compression);
    c.setWheelSuspensionRelaxation(i, susp.relaxation);
    c.setWheelMaxSuspensionTravel(i, susp.maxTravel);
    c.setWheelMaxSuspensionForce(i, susp.maxForce);
  }

  // Towing ramps the speed over two seconds after the trailer has settled: yanking
  // a parked trailer to 8 m/s in one step throws it into the air, and an airborne
  // wheel is exactly the case where Rapier's own rotation only decays.
  const roll = [];
  for (let s = 0; s < STEPS; s++) {
    if (drag > 0 && anchor) {
      const t = Math.min(1, Math.max(0, (s - 120) / 120));
      anchor.setLinvel({ x: 0, y: 0, z: drag * t }, true);
    }
    c.updateVehicle(1 / 60);
    world.step();
    if (drag > 0 && s > STEPS - 5) {
      const q = body.rotation();
      const rotation = c.wheelRotation(0) ?? NaN;
      roll.push({
        rotation,
        delta: roll.length ? rotation - roll[roll.length - 1].rotation : NaN,
        speed: body.linvel().z,
        contact: c.wheelIsInContact(0) && c.wheelIsInContact(1),
        suspension: c.wheelSuspensionLength(0) ?? NaN,
        pitch: (Math.atan2(2 * (q.w * q.x + q.y * q.z), 1 - 2 * (q.x * q.x + q.y * q.y)) * 180) / Math.PI,
      });
    }
  }
  return { body, c, mountY, roll, ground };
}

/** Body-space point -> world, so the report reads the same frame the renderer does. */
function toWorld(body, p) {
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

function report(label, opts) {
  const { body, c, mountY, ground } = settle(opts);
  const t = body.translation();
  const q = body.rotation();
  const pitch = Math.atan2(2 * (q.w * q.x + q.y * q.z), 1 - 2 * (q.x * q.x + q.y * q.y));
  const roll = Math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.y * q.y + q.z * q.z));
  const lens = [0, 1].map((i) => c.wheelSuspensionLength(i) ?? NaN);
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
    const centre = toWorld(body, { x, y: mountY - lens[i], z: AXLE_Z });
    const bottom = centre.y - WHEEL_RADIUS;
    const gy = ground.heightAt(x);
    const sink = gy - bottom;
    lines.push(
      `   wheel ${i} (x ${x.toFixed(2)}): centre ${f3(centre.y)} bottom ${f3(bottom)} ` +
        `ground ${f3(gy)} contact ${c.wheelIsInContact(i)} ` +
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
    const { c } = settle({ susp, hang: 0.19 });
    const len = c.wheelSuspensionLength(0) ?? NaN;
    console.log(
      `${String(k).padStart(9)}   ${f3(G / (2 * k)).padStart(17)}   ${f3(len).padStart(14)}   ` +
        `${f3(susp.restLength - len).padStart(11)}   ${f3(len)}`,
    );
  }
  console.log('');
  console.log('Mass independence (the rate is per kilogram, k=32):');
  for (const cargo of [0, 350, 700]) {
    const { c } = settle({ susp: suspension(32, 0.3, 0.3), hang: 0.193, cargoKg: cargo });
    console.log(`   cargo ${String(cargo).padStart(3)} kg -> settled length ${f3(c.wheelSuspensionLength(0) ?? NaN)}`);
  }
  process.exit(0);
}

const k = Number(process.argv[2] ?? 32);
const rest = Number(process.argv[3] ?? 0.3);
const travel = Number(process.argv[4] ?? 0.3);
const hang = Number(process.argv[5] ?? 0.166);
const susp = suspension(k, rest, travel);

console.log(
  `stiffness ${k} rest ${rest} travel ${travel} damping ${susp.compression}/${susp.relaxation} ` +
    `(critical ${(2 * Math.sqrt(k)).toFixed(2)}, body mode ${(Math.sqrt(2 * k) / (2 * Math.PI)).toFixed(2)} Hz)`,
);
console.log(
  `WHEEL_HANG ${f3(hang)} -> MOUNT_Y ${f3(-BED_HALF[1] + hang)}; ` +
    `the art wants the bed at ${f3(BED_HALF[1] + WHEEL_RADIUS)} m over flat ground`,
);
console.log('');

console.log('--- coupled, ball at the design height (0.45 m) ---');
console.log(report('flat, empty      ', { susp, hang }));
console.log(report('flat, 700 kg     ', { susp, hang, cargoKg: 700 }));
console.log(report('4deg cross-slope ', { susp, hang, ground: slope(4) }));
console.log(report('120 mm step      ', { susp, hang, ground: step(0.12) }));
console.log(report('200 mm step      ', { susp, hang, ground: step(0.2) }));
console.log('');
console.log('--- coupled, ball 0.15 m high: what the old hitch code computed ---');
console.log(report('flat, empty      ', { susp, hang, ballHeight: HITCH_HEIGHT + 0.15 }));
console.log('');
console.log('--- uncoupled, standing on its prop stand. The axle is behind the bed centre,');
console.log('    so the tongue is heavy: without the stand this pitched 17.8deg nose-down ---');
console.log(report('standing, empty  ', { susp, hang, ballHeight: null }));
console.log('');
// Towing at walking pace, which is all this rig can honestly show: the ball here is
// a KINEMATIC body at a fixed height, i.e. infinite mass that cannot pitch, yield
// or lift with the trailer. Drag it fast and the trailer somersaults against a
// constraint no car imposes. What it does prove is the thing the renderer needs —
// that Rapier integrates a towed wheel's rotation from the ground, so the drawn
// wheel has a real spin to read instead of a stationary tyre.
console.log('--- towed at walking pace: is there a wheel spin to draw? ---');
for (const r of settle({ susp, hang, drag: 3 }).roll.slice(1)) {
  const free = (r.speed / 60) / WHEEL_RADIUS;
  console.log(
    `   speed ${r.speed.toFixed(3)} m/s contact ${r.contact} susp ${f3(r.suspension)} ` +
      `pitch ${r.pitch.toFixed(2)}deg wheelRotation +${r.delta.toFixed(4)} rad/step ` +
      `(free rolling wants ${free.toFixed(4)}, ${((r.delta / free) * 100).toFixed(0)}%)`,
  );
}
