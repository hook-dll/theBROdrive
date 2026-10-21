/**
 * THE TYRE ON THE GROUND: where each wheel of one body touches the world, and the
 * spring and damper that hold the body up off it.
 *
 * The contact is the TYRE'S OWN PROFILE, not a point under the hub. Each wheel is a
 * disc of the tyre's radius whose rim is rounded across by half the tread width (a
 * Rapier `RoundCylinder` of zero height, its axis on the steered axle). Two reads make
 * the contact: the face under the hub, from the mount's ray, solved for the travel at
 * which the disc touches that face's plane; and the disc cast along the suspension
 * axis from full bump to free length, for anything it meets first (an edge, the next
 * triangle, another collider), read back onto its face where it met one. The earlier
 * of the two is the contact: point, normal, collider and travel.
 *
 * A single ray straight down from the hub saw the road one point at a time, so a kerb,
 * a pothole edge or a seam between two trimesh chunks arrived as a STEP in suspension
 * length — a step in spring force on one step, which the tyre model then had to
 * low-pass away. The disc meets an edge on its arc: the travel rises as the edge
 * slides under the tread (`r - sqrt(r² - x²)` for an edge `x` ahead of the hub), and
 * the normal leans back toward the hub, so the spring pushes the body UP and BACK the
 * way a wheel meeting a step is pushed. A crack between chunks narrower than the patch
 * is bridged. Rounded across, a tyre on a rolling body touches on its shoulder rather
 * than on the edge of a flat drum, which would lift the whole axle by half the tread
 * times the roll angle.
 *
 * THE SPRING is Bullet's `btRaycastVehicle` law, as Rapier's
 * `DynamicRayCastVehicleController` computed it (rapier/src/control/
 * ray_cast_vehicle_controller.rs, `ray_cast` and `update_suspension`), with absolute
 * rates in place of Rapier's per-kilogram ones (Rapier multiplied them by the chassis
 * mass, which the callers divided back out), and the spring and damper acting along
 * the strut:
 *
 *   inv    = -1 / (n · d)                          (d the suspension axis, down)
 *   v      = (f · v_body(p)) · -1 / (f · d)        (the strut's rate; < 0 closing)
 *   F      = max(0, (k (rest - length) - c v) inv) c = compression if v < 0, else rebound
 *
 * with `inv` held at 10 (and `v` at 0) where the ground is within ~84° of the axis,
 * and the impulse `n · min(F, maxForce) · dt` applied at the contact: the strut's
 * force, carried to the ground along its normal.
 *
 * `f` is the face under the hub, from the mount's ray, or the contact's own normal
 * where the ray found no face. On any face `v` is exactly how fast the strut's length
 * changes as the body moves over it, and on a face under the tread `f` is `n` and this
 * is Bullet's rate. Bullet read it off `n` everywhere, which on an EDGE is the rate a
 * rigid, massless disc's travel would have to change at to roll over it: the normal
 * leans back toward the hub, and the rate is the forward speed times the lean's
 * tangent — 5.9 m/s at 10 m/s onto a 4 cm step, which the damper turned into 6.5 kN on
 * a front wheel where Rapier's ray put 3.1 kN. No real damper sees that rate: a real
 * tyre's carcass and its wheel's mass take the edge first, and neither exists here.
 * So the edge reaches the strut as travel, through the spring, and the damper reads
 * the body against the ground under the hub, as Rapier's did: 3.1 kN on that step.
 * Nor is the rate the body's velocity along its own strut axis: with the body dived
 * 1° under braking that puts 0.47 m/s of a 27 m/s forward speed into the damper on
 * level ground, where the strut is not moving at all.
 *
 * The contact is only ever as far as rest length plus radius below the mount, so a
 * wheel past its rest length is in the air, at rest length, as Rapier's was.
 *
 * A start inside something — a wall or another car against the tyre's flank, which a
 * cast that sweeps along it cannot resolve — is left to the ray, so a scrape never
 * reads as a bottomed spring.
 *
 * Sensors are not ground. Everything else that is not this body is.
 *
 * Cost per wheel per step: one ray (0.6-1.1 µs in the bundled wasm, the ray Rapier's
 * controller cast), one shape cast (4-6 µs) and, when the cast meets something, one
 * ray against that collider alone. Nothing here allocates per step on a fixed ground.
 */

import RAPIER from '@dimforge/rapier3d-compat';
import type { PhysicsWorld } from '../core/physics';

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Below this `-(n · d)` the ground is too steep to carry the strut's force along (Bullet). */
const MIN_CONTACT_DOT = 0.1;
/**
 * The face read back under the tread cast is the face the tread is on when its normal
 * is within 3° of the cast's: the cast's own error on a large triangle is about a
 * degree, and an edge 3° round the disc stands 0.4 mm proud of the face beside it.
 */
const FACE_AGREE_COS = Math.cos((3 * Math.PI) / 180);
/** How far past the tyre's radius the read-back looks, metres: the cast's error, and more. */
const FACE_PROBE_SLACK_M = 0.2;

/**
 * One wheel's contact and suspension. The configuration fields are the caller's to
 * keep current; the result fields are rewritten by every `TyreContacts.update`.
 */
export interface TyreContact {
  /** Suspension mount, body-local metres: the hub at zero travel. */
  readonly mountLocal: Readonly<Vec3>;
  /** Spring free length, metres of travel below the mount. */
  readonly restLengthM: number;
  readonly radiusM: number;
  /** Travel either side of the free length, metres. */
  maxTravelM: number;
  springRateNPerM: number;
  compressionRateNsPerM: number;
  relaxationRateNsPerM: number;
  /** Cap on the spring force put through the body, N. */
  maxForceN: number;
  /** Road-wheel angle about the body's up axis, radians, positive toward +X. */
  steerRad: number;
  /** The parking brake's grip cone (`TyreContacts.holdBrake`): load times this. */
  frictionSlip: number;

  /** The tyre touches something this step. */
  inContact: boolean;
  /** Where the tread touches the ground, world (origin-relative) metres. */
  readonly point: Vec3;
  /** The ground's normal there, out of the ground. Minus the axis when in the air. */
  readonly normal: Vec3;
  /** What it stands on, or null in the air. */
  ground: RAPIER.Collider | null;
  /** Mount to hub along the axis, metres. Rest length in the air. */
  lengthM: number;
  /** Spring and damper force this step, N, after the cap. Zero in the air. */
  forceN: number;
}

interface ContactState extends TyreContact {
  readonly shape: RAPIER.RoundCylinder;
  /** The strut's rate this step, m/s, < 0 closing, against the face under the hub (THE SPRING). */
  speedMps: number;
  /** Bullet's `clipped_inv_contact_dot_suspension`. */
  inv: number;
  /** The parking brake's rolling direction this step, world. */
  readonly forward: Vec3;
  holdImpulse: number;
}

/** The wheels of one rigid body. */
export class TyreContacts {
  private readonly contacts: ContactState[] = [];
  /** The contacts, in the order they were added. */
  readonly wheels: readonly TyreContact[] = this.contacts;

  private shapeHit: RAPIER.ColliderShapeCastHit | null = null;
  private rayHit: RAPIER.RayColliderIntersection | null = null;
  private readonly ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
  private readonly upRay = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
  private readonly bodyPos: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly bodyRot = { x: 0, y: 0, z: 0, w: 1 };
  private readonly linvel: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly angvel: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly com: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly axis: Vec3 = { x: 0, y: -1, z: 0 };
  private readonly castPos: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly castRot = { x: 0, y: 0, z: 0, w: 1 };
  private readonly tread: Vec3 = { x: 0, y: 0, z: 0 };
  /** What the tread cast met this step: its point and normal, read back. */
  private readonly treadPoint: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly treadNormal: Vec3 = { x: 0, y: 1, z: 0 };
  /** The normal of the face under the hub this step, when the mount's ray found one. */
  private readonly hubNormal: Vec3 = { x: 0, y: 1, z: 0 };
  private readonly probeRay = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
  private faceHit: RAPIER.RayIntersection | null = null;
  private readonly impulse: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly velocity: Vec3 = { x: 0, y: 0, z: 0 };
  /**
   * World inverse inertia, upper triangle `m11 m12 m13 m22 m23 m33`. Copied out at
   * once: Rapier hands the matrix back over a scratch buffer its next read reuses.
   */
  private readonly invInertia = new Float64Array(6);
  private readonly groundInvInertia = new Float64Array(6);

  constructor(
    private readonly physics: PhysicsWorld,
    private readonly body: RAPIER.RigidBody,
  ) {}

  /** Adds a wheel; `widthM` is the tread's. Spring fields start at zero. */
  add(mountLocal: Readonly<Vec3>, restLengthM: number, radiusM: number, widthM: number): TyreContact {
    const crown = Math.min(0.5 * widthM, 0.5 * radiusM);
    const contact: ContactState = {
      mountLocal: { x: mountLocal.x, y: mountLocal.y, z: mountLocal.z },
      restLengthM,
      radiusM,
      maxTravelM: 0,
      springRateNPerM: 0,
      compressionRateNsPerM: 0,
      relaxationRateNsPerM: 0,
      maxForceN: 0,
      steerRad: 0,
      // Rapier's default, which a wheel nobody has driven kept.
      frictionSlip: 10.5,
      inContact: false,
      point: { x: 0, y: 0, z: 0 },
      normal: { x: 0, y: 1, z: 0 },
      ground: null,
      lengthM: restLengthM,
      forceN: 0,
      shape: new RAPIER.RoundCylinder(0, radiusM - crown, crown),
      speedMps: 0,
      inv: 1,
      forward: { x: 0, y: 0, z: 1 },
      holdImpulse: 0,
    };
    this.contacts.push(contact);
    return contact;
  }

  /**
   * Finds every wheel's ground, then pushes the body off it: all contacts are read
   * against the body's velocity before any spring pushes, as Bullet does.
   */
  update(dt: number): void {
    const body = this.body;
    body.translation(this.bodyPos);
    body.rotation(this.bodyRot);
    body.linvel(this.linvel);
    body.angvel(this.angvel);
    body.worldCom(this.com);
    rotate(this.axis, this.bodyRot, 0, -1, 0);
    for (const c of this.contacts) this.findGround(c);

    const impulse = this.impulse;
    for (const c of this.contacts) {
      if (!c.inContact) {
        c.forceN = 0;
        continue;
      }
      // Spring and damper along the strut, carried to the ground along its normal.
      const damping = c.speedMps < 0 ? c.compressionRateNsPerM : c.relaxationRateNsPerM;
      const force = Math.max(
        0,
        (c.springRateNPerM * (c.restLengthM - c.lengthM) - damping * c.speedMps) * c.inv,
      );
      c.forceN = Math.min(force, c.maxForceN);
      if (c.forceN === 0) continue;
      impulse.x = c.normal.x * c.forceN * dt;
      impulse.y = c.normal.y * c.forceN * dt;
      impulse.z = c.normal.z * c.forceN * dt;
      body.applyImpulseAtPoint(impulse, c.point, false);
    }
  }

  /**
   * The parking brake: each wheel on the ground pushes the patch toward standing still
   * along its rolling direction, at most `maxImpulse` (N·s) a wheel and never past its
   * grip cone (`forceN · dt · frictionSlip`, with the brake counted at half against it).
   * Bullet's braked rolling friction (`calc_rolling_friction`), shared over the wheels
   * on the ground. Runs after `update`, against the velocity the springs left.
   */
  holdBrake(dt: number, maxImpulse: number): void {
    let grounded = 0;
    for (const c of this.contacts) if (c.inContact) grounded++;
    if (grounded === 0) return;
    const body = this.body;
    body.linvel(this.linvel);
    body.angvel(this.angvel);
    body.worldCom(this.com);
    copyInvInertia(body, this.invInertia);
    const invMass = body.invMass();
    body.rotation(this.bodyRot);
    for (const c of this.contacts) {
      c.holdImpulse = 0;
      if (!c.inContact || !this.rollingDirection(c)) continue;
      const f = c.forward;
      const rx = c.point.x - this.com.x;
      const ry = c.point.y - this.com.y;
      const rz = c.point.z - this.com.z;
      // Body side of the denominator; a dynamic ground's own share is added below.
      let denominator = invMass + angularShare(this.invInertia, rx, ry, rz, f);
      this.velocityAt(c.point, this.velocity);
      let vx = this.velocity.x;
      let vy = this.velocity.y;
      let vz = this.velocity.z;
      const groundBody = c.ground?.parent() ?? null;
      if (groundBody && groundBody.isDynamic()) {
        const gv = groundBody.velocityAtPoint(c.point);
        vx -= gv.x;
        vy -= gv.y;
        vz -= gv.z;
        const gc = groundBody.worldCom();
        copyInvInertia(groundBody, this.groundInvInertia);
        denominator +=
          groundBody.invMass() +
          angularShare(this.groundInvInertia, c.point.x - gc.x, c.point.y - gc.y, c.point.z - gc.z, f);
      }
      const along = f.x * vx + f.y * vy + f.z * vz;
      let hold = Math.max(-maxImpulse, Math.min(maxImpulse, -along / denominator / grounded));
      const cone = c.forceN * dt * c.frictionSlip;
      if (Math.abs(0.5 * hold) > cone) hold = Math.sign(hold) * 2 * cone;
      c.holdImpulse = hold;
    }
    const impulse = this.impulse;
    for (const c of this.contacts) {
      if (c.holdImpulse === 0) continue;
      impulse.x = c.forward.x * c.holdImpulse;
      impulse.y = c.forward.y * c.holdImpulse;
      impulse.z = c.forward.z * c.holdImpulse;
      body.applyImpulseAtPoint(impulse, c.point, false);
    }
  }

  /** Writes `c.forward`, the steered wheel's rolling direction on its ground; false if degenerate. */
  private rollingDirection(c: ContactState): boolean {
    // The axle: body -X turned by the steering about body up, then laid into the ground.
    const v = this.velocity;
    rotate(v, this.bodyRot, -Math.cos(c.steerRad), 0, Math.sin(c.steerRad));
    const n = c.normal;
    const along = v.x * n.x + v.y * n.y + v.z * n.z;
    let ax = v.x - n.x * along;
    let ay = v.y - n.y * along;
    let az = v.z - n.z * along;
    const axleLength = Math.hypot(ax, ay, az);
    if (axleLength < 1e-5) return false;
    ax /= axleLength;
    ay /= axleLength;
    az /= axleLength;
    const fx = n.y * az - n.z * ay;
    const fy = n.z * ax - n.x * az;
    const fz = n.x * ay - n.y * ax;
    const length = Math.hypot(fx, fy, fz);
    if (length < 1e-5) return false;
    c.forward.x = fx / length;
    c.forward.y = fy / length;
    c.forward.z = fz / length;
    return true;
  }

  /**
   * Writes `tread`: from the disc's centre to its surface point furthest along the
   * unit direction `u` — the rim's point in the wheel plane, then the crown's radius
   * along `u`. The disc is posed by `castRot`.
   */
  private treadToward(c: ContactState, ux: number, uy: number, uz: number): void {
    const a = this.tread;
    rotate(a, this.castRot, 0, 1, 0);
    const along = ux * a.x + uy * a.y + uz * a.z;
    let px = ux - a.x * along;
    let py = uy - a.y * along;
    let pz = uz - a.z * along;
    const inPlane = Math.hypot(px, py, pz);
    const rim = inPlane > 1e-6 ? c.shape.radius / inPlane : 0;
    px *= rim;
    py *= rim;
    pz *= rim;
    const crown = c.shape.borderRadius;
    a.x = px + ux * crown;
    a.y = py + uy * crown;
    a.z = pz + uz * crown;
  }

  /**
   * The travel at which the disc, hanging from the mount `m`, first touches the plane
   * through `p` with normal `n` (out of the ground): where its tread point toward the
   * plane (`tread`, left written) meets it.
   */
  private faceTravel(c: ContactState, px: number, py: number, pz: number, n: Vec3, mx: number, my: number, mz: number): number {
    const d = this.axis;
    this.treadToward(c, -n.x, -n.y, -n.z);
    const s = this.tread;
    return (
      (n.x * (px - mx - s.x) + n.y * (py - my - s.y) + n.z * (pz - mz - s.z)) /
      (n.x * d.x + n.y * d.y + n.z * d.z)
    );
  }

  /**
   * Whether a cast's witness `w` and normal `n` (out of the ground) are a contact of
   * the disc centred at `centre`: `w` on the tyre's surface, and `n` the tyre's own
   * surface normal there, reversed. For a rounded disc that normal is the direction
   * from the nearest point of its core (the flat disc of radius `radius - crown`) out
   * to `w`, so both are one test, each to the cast's own error (`FACE_PROBE_SLACK_M`,
   * `FACE_AGREE_COS`).
   *
   * GJK sweeping the disc across the shared edge of two coplanar triangles — a
   * heightfield cell's diagonal, the seam of a two-triangle ramp — reports that edge
   * as if it stood proud: a normal leant 15-20° across it, at a witness up to a
   * hundred metres along it. Taken as a contact, that pushed the body sideways from
   * a lever of a hundred metres and rolled a car over on flat gravel at 10 km/h.
   */
  private onTyre(c: ContactState, centre: Vec3, w: Vec3, n: Vec3): boolean {
    const a = this.tread;
    rotate(a, this.castRot, 0, 1, 0);
    const vx = w.x - centre.x;
    const vy = w.y - centre.y;
    const vz = w.z - centre.z;
    const along = vx * a.x + vy * a.y + vz * a.z;
    // The core's nearest point to `w`, from the centre.
    let qx = vx - a.x * along;
    let qy = vy - a.y * along;
    let qz = vz - a.z * along;
    const inPlane = Math.hypot(qx, qy, qz);
    if (inPlane > c.shape.radius) {
      const k = c.shape.radius / inPlane;
      qx *= k;
      qy *= k;
      qz *= k;
    }
    const ox = vx - qx;
    const oy = vy - qy;
    const oz = vz - qz;
    const out = Math.hypot(ox, oy, oz);
    if (Math.abs(out - c.shape.borderRadius) > FACE_PROBE_SLACK_M || out < 1e-6) return false;
    return -(ox * n.x + oy * n.y + oz * n.z) / out > FACE_AGREE_COS;
  }

  private findGround(c: ContactState): void {
    const world = this.physics.world;
    const d = this.axis;
    const m = c.mountLocal;
    const q = this.bodyRot;
    // The mount, world.
    rotate(this.castPos, q, m.x, m.y, m.z);
    const mx = this.bodyPos.x + this.castPos.x;
    const my = this.bodyPos.y + this.castPos.y;
    const mz = this.bodyPos.z + this.castPos.z;
    const shortest = c.restLengthM - c.maxTravelM;
    const longest = c.restLengthM + c.maxTravelM;
    wheelRotation(this.castRot, q, c.steerRad);

    // THE FACE UNDER THE HUB: a ray from the mount, a radius past free length — the
    // ray Rapier's vehicle cast. Exact on any triangle, however large, and the tread
    // is solved against that face's plane: the travel at which the disc's lowest point
    // toward the face meets it. On level ground that is the ray's own length less a
    // radius.
    const rayLength = c.restLengthM + c.radiusM;
    const ray = this.ray;
    ray.origin.x = mx;
    ray.origin.y = my;
    ray.origin.z = mz;
    ray.dir.x = d.x * rayLength;
    ray.dir.y = d.y * rayLength;
    ray.dir.z = d.z * rayLength;
    const rayHit = world.broadPhase.castRayAndGetNormal(
      world.narrowPhase,
      world.bodies,
      world.colliders,
      ray,
      1,
      true,
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      undefined,
      undefined,
      this.body.handle,
      undefined,
      this.rayHit ?? undefined,
    );
    let length = Infinity;
    let hubFace = false;
    if (rayHit) {
      this.rayHit = rayHit;
      const toi = rayHit.timeOfImpact;
      c.ground = rayHit.collider;
      const n = c.normal;
      n.x = rayHit.normal.x;
      n.y = rayHit.normal.y;
      n.z = rayHit.normal.z;
      c.point.x = mx + ray.dir.x * toi;
      c.point.y = my + ray.dir.y * toi;
      c.point.z = mz + ray.dir.z * toi;
      if (toi === 0) {
        // The mount itself is inside: the normal is that of the face the ray would
        // leave by, and the spring is on its stop.
        this.insideNormal(c, rayHit.collider, mx, my, mz);
        length = -c.radiusM;
      } else if (n.x * d.x + n.y * d.y + n.z * d.z < -MIN_CONTACT_DOT) {
        hubFace = true;
        this.hubNormal.x = n.x;
        this.hubNormal.y = n.y;
        this.hubNormal.z = n.z;
        length = this.faceTravel(c, c.point.x, c.point.y, c.point.z, n, mx, my, mz);
        c.point.x = mx + d.x * length + this.tread.x;
        c.point.y = my + d.y * length + this.tread.y;
        c.point.z = mz + d.z * length + this.tread.z;
      } else {
        length = toi * rayLength - c.radiusM;
      }
    }

    // THE TREAD: the disc swept from full bump to free length, for whatever it meets
    // before that face — a kerb's lip, a pothole's far edge, the next triangle over a
    // crest, the raised side of a seam between two colliders. A cast that starts inside
    // something (a wall or another car at the tyre's flank) cannot be read and is left
    // to the ray.
    //
    // GJK in single precision against a large triangle (a bench's 20 km cell, a long
    // verge) misplaces the time of impact by centimetres and the normal by a degree,
    // and misses outright often enough. So what the cast meets is read back with a ray
    // from the disc's centre toward it, against that collider alone: where that face's
    // normal agrees with the cast's the tread is on a face, and it is solved on the
    // face's plane exactly as the face under the hub is. An edge keeps the cast's own
    // answer, whose normal is the edge's and whose geometry is small, when that answer
    // is a contact of the tyre at all (`onTyre`): the seam between two coplanar
    // triangles is not an edge, and GJK reports it as one. A miss, or an answer that
    // is not the tyre's, is the face under the hub's to answer.
    this.castPos.x = mx + d.x * shortest;
    this.castPos.y = my + d.y * shortest;
    this.castPos.z = mz + d.z * shortest;
    const hit = world.broadPhase.castShape(
      world.narrowPhase,
      world.bodies,
      world.colliders,
      this.castPos,
      this.castRot,
      d,
      c.shape,
      0,
      c.restLengthM - shortest,
      false,
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      undefined,
      undefined,
      this.body.handle,
      undefined,
      this.shapeHit ?? undefined,
    );
    if (hit) this.shapeHit = hit;
    if (hit && hit.time_of_impact > 0) {
      const toi = hit.time_of_impact;
      let tread = shortest + toi;
      let onFace = false;
      const n = this.treadNormal;
      n.x = hit.normal1.x;
      n.y = hit.normal1.y;
      n.z = hit.normal1.z;
      const p = this.treadPoint;
      p.x = hit.witness1.x;
      p.y = hit.witness1.y;
      p.z = hit.witness1.z;
      const probe = this.probeRay;
      probe.origin.x = this.castPos.x + d.x * toi;
      probe.origin.y = this.castPos.y + d.y * toi;
      probe.origin.z = this.castPos.z + d.z * toi;
      probe.dir.x = -n.x;
      probe.dir.y = -n.y;
      probe.dir.z = -n.z;
      const back = hit.collider.castRayAndGetNormal(
        probe,
        c.radiusM + FACE_PROBE_SLACK_M,
        true,
        this.faceHit ?? undefined,
      );
      if (back) {
        this.faceHit = back;
        const f = back.normal;
        if (f.x * n.x + f.y * n.y + f.z * n.z > FACE_AGREE_COS && f.x * d.x + f.y * d.y + f.z * d.z < -MIN_CONTACT_DOT) {
          onFace = true;
          n.x = f.x;
          n.y = f.y;
          n.z = f.z;
          tread = this.faceTravel(
            c,
            probe.origin.x + probe.dir.x * back.timeOfImpact,
            probe.origin.y + probe.dir.y * back.timeOfImpact,
            probe.origin.z + probe.dir.z * back.timeOfImpact,
            n,
            mx,
            my,
            mz,
          );
          p.x = mx + d.x * tread + this.tread.x;
          p.y = my + d.y * tread + this.tread.y;
          p.z = mz + d.z * tread + this.tread.z;
        }
      }
      // Off a face, the cast's own answer stands only if it is a contact of this tyre.
      if (tread < length && (onFace || this.onTyre(c, probe.origin, p, n))) {
        length = tread;
        c.ground = hit.collider;
        c.point.x = p.x;
        c.point.y = p.y;
        c.point.z = p.z;
        c.normal.x = n.x;
        c.normal.y = n.y;
        c.normal.z = n.z;
      }
    }

    if (!(length <= c.restLengthM)) {
      this.inTheAir(c, mx, my, mz);
      return;
    }

    c.inContact = true;
    c.lengthM = Math.min(longest, Math.max(shortest, length));
    const n = c.normal;
    const dot = n.x * d.x + n.y * d.y + n.z * d.z;
    c.inv = dot >= -MIN_CONTACT_DOT ? 1 / MIN_CONTACT_DOT : -1 / dot;
    // The strut's rate against the face under the hub, or against the contact's own
    // face where the hub has none (see THE SPRING).
    const f = hubFace ? this.hubNormal : n;
    const faceDot = f.x * d.x + f.y * d.y + f.z * d.z;
    if (faceDot >= -MIN_CONTACT_DOT) {
      c.speedMps = 0;
    } else {
      const v = this.velocityAt(c.point, this.velocity);
      c.speedMps = -(f.x * v.x + f.y * v.y + f.z * v.z) / faceDot;
    }
  }

  /**
   * Rapier's answer for a mount already inside the ground: the normal of the face the
   * ray would leave by, else straight up the suspension axis.
   */
  private insideNormal(c: ContactState, collider: RAPIER.Collider, mx: number, my: number, mz: number): void {
    const ray = this.ray;
    const up = this.upRay;
    up.origin.x = mx + ray.dir.x;
    up.origin.y = my + ray.dir.y;
    up.origin.z = mz + ray.dir.z;
    up.dir.x = -ray.dir.x;
    up.dir.y = -ray.dir.y;
    up.dir.z = -ray.dir.z;
    const exit = collider.castRayAndGetNormal(up, 1, false);
    if (exit) {
      c.normal.x = -exit.normal.x;
      c.normal.y = -exit.normal.y;
      c.normal.z = -exit.normal.z;
    }
    if (c.normal.x === 0 && c.normal.y === 0 && c.normal.z === 0) {
      c.normal.x = -this.axis.x;
      c.normal.y = -this.axis.y;
      c.normal.z = -this.axis.z;
    }
  }

  private inTheAir(c: ContactState, mx: number, my: number, mz: number): void {
    const d = this.axis;
    const reach = c.restLengthM + c.radiusM;
    c.inContact = false;
    c.ground = null;
    c.lengthM = c.restLengthM;
    c.speedMps = 0;
    c.inv = 1;
    c.point.x = mx + d.x * reach;
    c.point.y = my + d.y * reach;
    c.point.z = mz + d.z * reach;
    c.normal.x = -d.x;
    c.normal.y = -d.y;
    c.normal.z = -d.z;
  }

  /** The body's velocity at a world point, from the step's cached state. */
  private velocityAt(point: Vec3, out: Vec3): Vec3 {
    const w = this.angvel;
    const rx = point.x - this.com.x;
    const ry = point.y - this.com.y;
    const rz = point.z - this.com.z;
    out.x = this.linvel.x + w.y * rz - w.z * ry;
    out.y = this.linvel.y + w.z * rx - w.x * rz;
    out.z = this.linvel.z + w.x * ry - w.y * rx;
    return out;
  }
}

function copyInvInertia(body: RAPIER.RigidBody, out: Float64Array): void {
  const m = body.effectiveWorldInvInertia();
  out[0] = m.m11;
  out[1] = m.m12;
  out[2] = m.m13;
  out[3] = m.m22;
  out[4] = m.m23;
  out[5] = m.m33;
}

/** `(r × f) · I⁻¹ (r × f)`: the angular part of an impulse denominator. */
function angularShare(inv: Float64Array, rx: number, ry: number, rz: number, f: Vec3): number {
  const cx = ry * f.z - rz * f.y;
  const cy = rz * f.x - rx * f.z;
  const cz = rx * f.y - ry * f.x;
  const ix = inv[0] * cx + inv[1] * cy + inv[2] * cz;
  const iy = inv[1] * cx + inv[3] * cy + inv[4] * cz;
  const iz = inv[2] * cx + inv[4] * cy + inv[5] * cz;
  return cx * ix + cy * iy + cz * iz;
}

/** `out = q · (x, y, z)`. */
function rotate(out: Vec3, q: RAPIER.Rotation, x: number, y: number, z: number): void {
  const tx = 2 * (q.y * z - q.z * y);
  const ty = 2 * (q.z * x - q.x * z);
  const tz = 2 * (q.x * y - q.y * x);
  out.x = x + q.w * tx + (q.y * tz - q.z * ty);
  out.y = y + q.w * ty + (q.z * tx - q.x * tz);
  out.z = z + q.w * tz + (q.x * ty - q.y * tx);
}

/**
 * The tyre's pose: the body's rotation, then the steering about body up, then the
 * cylinder's own axis (local Y) laid onto the axle (body X).
 */
function wheelRotation(out: RAPIER.Rotation, q: RAPIER.Rotation, steerRad: number): void {
  const sy = Math.sin(0.5 * steerRad);
  const cy = Math.cos(0.5 * steerRad);
  const h = Math.SQRT1_2;
  // (0, sy, 0, cy) · (0, 0, h, h)
  const lx = sy * h;
  const ly = sy * h;
  const lz = cy * h;
  const lw = cy * h;
  out.x = q.w * lx + q.x * lw + q.y * lz - q.z * ly;
  out.y = q.w * ly - q.x * lz + q.y * lw + q.z * lx;
  out.z = q.w * lz + q.x * ly - q.y * lx + q.z * lw;
  out.w = q.w * lw - q.x * lx - q.y * ly - q.z * lz;
}
