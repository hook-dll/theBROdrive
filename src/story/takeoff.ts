/**
 * The boarding cutscene: the plane starts its engine, rolls the runway, lifts off and
 * climbs away, over four composed shots and roughly twenty seconds.
 *
 * WHERE IT RUNS. The cutscene owns its own `LightPlane` (main hides the parked one, so
 * the two never overlap), its own clock and its own camera poses, and it draws nothing:
 * `update(dt)` hands the eye, the look-at and the field of view back to the caller,
 * which passes them to `CameraRig.updateScripted`. The scene stays the game's.
 *
 * WHAT IT DOES NOT OWN. The runway's geometry and heights belong to the site builder
 * (`story/site.ts`): the roll follows `runwaySurfaceY`, so the tyres are on whatever
 * strip was actually drawn, and its length sizes the roll.
 *
 * THE FRAME. The site is described in ABSOLUTE metres (the road, the terrain and the
 * floating origin all measure from there), while the camera lives in the relative
 * frame. Everything here is composed and moved absolutely and the origin is subtracted
 * once, at the end of `update`, read fresh every frame — the origin may rebase during a
 * cutscene just as it may during play.
 */

import * as THREE from 'three';
import type { GameAudio } from '../audio/gameaudio';
import type { PropellerVoice } from '../audio/storyaudio';
import type { WorldOrigin } from '../world/origin';
import type { Terrain } from '../world/terrain';
import { createLightPlane, type LightPlane } from './plane';
import { runwaySurfaceY, type StorySite } from './site';
import type { StoryOverlay } from './overlay';

/** Engine start and prop spin-up before the brakes come off, seconds. */
const ENGINE_START_S = 2.2;
/** Lift-off (rotation) speed, m/s: a light single at its rotate speed. */
const ROTATE_SPEED = 32;
/** Climb leg before the fade, seconds. */
const CLIMB_S = 6;
/** Fade to black at the end, seconds. */
const FADE_S = 1.7;
/** Seconds of nose-up rotation at the end of the roll. */
const ROTATE_S = 1.1;
/** Rotation angle at lift-off, radians (8°). */
const ROTATE_ANGLE = 0.14;
/** Flight-path angle at lift-off, easing to the climb-out angle, radians. */
const CLIMB_ANGLE_START = 0.21;
const CLIMB_ANGLE_END = 0.165;
/** Gentle bank into the climb, radians (13°), and the heading turned through. */
const BANK_ANGLE = 0.227;
const TURN_RATE = 0.03;
/** Airborne acceleration, m/s²: the plane keeps accelerating as it cleans up. */
const CLIMB_ACCEL = 0.5;
/** How long a cut between shots eases, seconds. */
const SHOT_BLEND_S = 0.45;
/** How fast the lens follows a shot's own field of view, per second. */
const FOV_OMEGA = 6;
/** The World bus is ducked to this while the plane is the subject. */
const WORLD_DUCK = 0.28;

function smoothstep(t: number): number {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return x * x * (3 - 2 * x);
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/**
 * Cuts with a short ease. Shots hand in their own pose every frame; when the caller
 * flags a cut the rig remembers where the previous shot left the camera and eases from
 * there into the new shot over `blend` seconds, which turns a hard jump into a short
 * move without softening the shot itself.
 */
export class ShotRig {
  /** The pose to place the camera at this frame, in the caller's frame. Live. */
  readonly eye = new THREE.Vector3();
  readonly lookAt = new THREE.Vector3();
  /** The lens this frame, degrees. */
  fov = 50;

  private readonly fromEye = new THREE.Vector3();
  private readonly fromLook = new THREE.Vector3();
  private blendAge = Infinity;
  private blendLength = SHOT_BLEND_S;
  private cutPending = false;

  /** Flags the next `update` as the start of a new shot. */
  cut(blend = SHOT_BLEND_S): void {
    this.cutPending = true;
    this.blendLength = blend;
  }

  update(dt: number, eye: THREE.Vector3, lookAt: THREE.Vector3, fov: number): void {
    if (this.cutPending) {
      this.fromEye.copy(this.eye);
      this.fromLook.copy(this.lookAt);
      this.blendAge = 0;
      this.cutPending = false;
    }
    if (this.blendAge < this.blendLength) {
      this.blendAge += dt;
      const t = Math.min(1, Math.max(0, this.blendAge / this.blendLength));
      const ease = t * t * (3 - 2 * t);
      this.eye.copy(this.fromEye).lerp(eye, ease);
      this.lookAt.copy(this.fromLook).lerp(lookAt, ease);
    } else {
      this.eye.copy(eye);
      this.lookAt.copy(lookAt);
    }
    // The lens eases on its own clock, so a cut to a longer lens reads as a push.
    this.fov += (fov - this.fov) * (1 - Math.exp(-FOV_OMEGA * dt));
  }
}

export interface TakeoffCamera {
  readonly eye: THREE.Vector3;
  readonly lookAt: THREE.Vector3;
  readonly fov: number;
  readonly done: boolean;
}

export class TakeoffCutscene {
  private readonly plane: LightPlane;
  private readonly rig = new ShotRig();
  private readonly world: THREE.Object3D;
  private readonly origin: WorldOrigin;
  private readonly terrain: Terrain;
  private readonly site: StorySite;
  private readonly audio: GameAudio;
  private readonly overlay: StoryOverlay;
  private readonly propeller: PropellerVoice;

  /** Roll geometry, sized from the runway the site built. */
  private readonly startX: number;
  private readonly startZ: number;
  private readonly rollDistance: number;
  private readonly accel: number;
  private readonly liftAt: number;
  private readonly fadeAt: number;
  private readonly total: number;

  private time = 0;
  private distance = 0;
  private speed = 0;
  private altitude = 0;
  private glide = 0;
  /** Heading of the runway itself; the airborne turn is measured from it. */
  private readonly rollYaw: number;
  private heading: number;
  private pitch = 0;
  private bank = 0;
  private groundY: number;
  private airborne = false;
  private fadePending = true;
  private shot = 0;
  private disposed = false;

  /** Composed in absolute metres, then shifted into the relative frame at the end. */
  private readonly eye = new THREE.Vector3();
  private readonly lookAt = new THREE.Vector3();
  private readonly result: { eye: THREE.Vector3; lookAt: THREE.Vector3; fov: number; done: boolean } = {
    eye: new THREE.Vector3(),
    lookAt: new THREE.Vector3(),
    fov: 50,
    done: false,
  };

  constructor(opts: {
    scene: THREE.Object3D;
    site: StorySite;
    terrain: Terrain;
    origin: WorldOrigin;
    audio: GameAudio;
    overlay: StoryOverlay;
  }) {
    this.world = opts.scene;
    this.site = opts.site;
    this.terrain = opts.terrain;
    this.origin = opts.origin;
    this.audio = opts.audio;
    this.overlay = opts.overlay;

    // The roll starts at the PARKED plane's own spot and runs along the runway: the
    // parked plane is hidden when this starts, so starting anywhere else would pop.
    const runway = opts.site.runway;
    this.startX = opts.site.plane.x;
    this.startZ = opts.site.plane.z;
    this.heading = opts.site.plane.yaw;
    this.rollYaw = Math.atan2(runway.dx, runway.dz);
    // Sized to what the runway can hold from the parked spot to a comfortable overrun.
    this.rollDistance = clamp(runway.length - 35, 60, 160);
    this.accel = (ROTATE_SPEED * ROTATE_SPEED) / (2 * this.rollDistance);
    const rollSeconds = ROTATE_SPEED / this.accel;
    this.liftAt = ENGINE_START_S + rollSeconds;
    this.fadeAt = this.liftAt + CLIMB_S;
    this.total = this.fadeAt + FADE_S;

    this.groundY = this.groundAt(this.startX, this.startZ);
    this.plane = createLightPlane();
    this.plane.group.position.set(this.startX, this.groundY, this.startZ);
    this.plane.group.rotation.set(0, this.heading, 0, 'YXZ');
    this.world.add(this.plane.group);

    this.propeller = opts.audio.createPropellerVoice();
    // Everything else in the world steps back while the plane is the subject.
    this.audio.setWorldLevel(WORLD_DUCK, 0.8);
    this.propeller.set(0, 0);
  }

  update(dt: number): TakeoffCamera {
    if (this.disposed) {
      this.result.done = true;
      return this.result;
    }
    const d = dt > 0 ? Math.min(0.1, dt) : 1 / 60;
    this.time = Math.min(this.total, this.time + d);

    this.advance(d);
    this.voice();
    this.composeShot(d);

    // A composition in absolute metres becomes a camera pose by subtracting the origin
    // ONCE — read here rather than cached, because it can move under a cutscene.
    this.result.eye.copy(this.eye);
    this.result.lookAt.copy(this.lookAt);
    this.result.eye.x -= this.origin.x;
    this.result.eye.z -= this.origin.z;
    this.result.lookAt.x -= this.origin.x;
    this.result.lookAt.z -= this.origin.z;
    this.result.fov = this.rig.fov;

    if (this.fadePending && this.time >= this.fadeAt) {
      this.fadePending = false;
      void this.overlay.fadeTo(1, FADE_S);
    }
    this.result.done = this.time >= this.total;
    return this.result;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.propeller.dispose();
    this.audio.setWorldLevel(1, 0.4);
    this.world.remove(this.plane.group);
    this.plane.dispose();
  }

  /** Ground the aeroplane rolls on: the drawn runway, which never dips under the sand. */
  private groundAt(x: number, z: number): number {
    return runwaySurfaceY(this.site.runway, x, z);
  }

  /** The aeroplane, integrated a frame at a time so the climb-out can curve. */
  private advance(dt: number): void {
    const { runway } = this.site;

    if (this.time < ENGINE_START_S) {
      this.plane.group.position.y = this.groundY;
      // The engine is being cranked: the prop turns over before anything moves.
      this.plane.spin(dt, this.propellerFraction());
      return;
    }

    if (!this.airborne) {
      this.speed = Math.min(ROTATE_SPEED, this.speed + this.accel * dt);
      this.distance += this.speed * dt;
      // Nose-up through the last second of the roll.
      this.pitch = ROTATE_ANGLE * smoothstep((this.time - (this.liftAt - ROTATE_S)) / ROTATE_S);
      const cx = this.startX + runway.dx * this.distance;
      const cz = this.startZ + runway.dz * this.distance;
      this.groundY = this.groundAt(cx, cz);
      this.plane.group.position.set(cx, this.groundY, cz);
      if (this.distance >= this.rollDistance) {
        this.airborne = true;
        this.speed = Math.max(this.speed, ROTATE_SPEED);
      }
    } else {
      const u = clamp((this.time - this.liftAt) / CLIMB_S, 0, 1);
      const gamma = CLIMB_ANGLE_START + (CLIMB_ANGLE_END - CLIMB_ANGLE_START) * u;
      this.speed += CLIMB_ACCEL * dt;
      this.altitude += this.speed * Math.sin(gamma) * dt;
      this.glide += this.speed * Math.cos(gamma) * dt;
      this.heading = this.rollYaw + TURN_RATE * (this.time - this.liftAt);
      this.pitch += (gamma - this.pitch) * (1 - Math.exp(-1.5 * dt));
      this.bank = BANK_ANGLE * smoothstep((this.time - this.liftAt) / 1.6);
      const px = this.startX + runway.dx * this.rollDistance;
      const pz = this.startZ + runway.dz * this.rollDistance;
      this.plane.group.position.set(
        px + Math.sin(this.heading) * this.glide,
        this.groundY + this.altitude,
        pz + Math.cos(this.heading) * this.glide,
      );
    }

    // Yaw, then pitch, then roll about the body axes: the aeroplane's own order.
    this.plane.group.rotation.set(-this.pitch, this.heading, -this.bank, 'YXZ');
    this.plane.spin(dt, this.propellerFraction());
  }

  /** Prop speed as a fraction of 2700 rpm: idle at the start, flat out for the roll. */
  private propellerFraction(): number {
    if (this.time < ENGINE_START_S) {
      return 0.29 * smoothstep(this.time / ENGINE_START_S);
    }
    if (!this.airborne) {
      const u = clamp(
        (this.time - ENGINE_START_S) / Math.max(0.4, this.liftAt - ENGINE_START_S),
        0,
        1,
      );
      return 0.29 + 0.71 * smoothstep(u);
    }
    return 1;
  }

  private voice(): void {
    const f = this.propellerFraction();
    // Idle is about 0.3 of the full level; the last second takes the plane away with it.
    const fadeOut = 1 - smoothstep((this.time - (this.total - 1.2)) / 1.2);
    this.propeller.set(f, (0.3 + 0.7 * f) * fadeOut);
  }

  /**
   * Four shots: the start-up from the front three-quarter, the roll from low beside the
   * runway, a tracking three-quarter as it climbs, and a wide static as it shrinks into
   * the sky.
   */
  private composeShot(dt: number): void {
    const t = this.time;
    const position = this.plane.group.position;
    const heading = this.heading;
    // Ground frame of the aeroplane: forward along the nose, right of travel. (Facing
    // +Z with +Y up and a right-handed basis, the right hand side is -X.)
    const fx = Math.sin(heading);
    const fz = Math.cos(heading);
    const rx = -fz;
    const rz = fx;
    const want =
      t < this.liftAt - 6.6 ? 0
        : t < this.liftAt + 0.6 ? 1
          : t < this.fadeAt - 1.6 ? 2
            : 3;
    if (want !== this.shot) {
      this.shot = want;
      // The opening shot is not a cut: the cutscene simply starts there.
      if (want !== 0) this.rig.cut(SHOT_BLEND_S);
    }

    if (want === 0) {
      // Front three-quarter, low: the prop disc against the runway, dollying in as the
      // engine catches.
      const dolly = smoothstep(t / Math.max(0.1, this.liftAt - 6.6));
      const ox = fx * (7.4 - 1.1 * dolly) + rx * 4.6;
      const oz = fz * (7.4 - 1.1 * dolly) + rz * 4.6;
      this.eye.set(
        position.x + ox,
        this.groundAt(position.x + ox, position.z + oz) + 1.75,
        position.z + oz,
      );
      this.lookAt.set(position.x + fx * 0.6, position.y + 1.5, position.z + fz * 0.6);
      this.rig.update(dt, this.eye, this.lookAt, 44);
      return;
    }

    if (want === 1) {
      // Low beside the runway, close to the plane's path, looking well ahead of it so
      // the pass is a sweep rather than a whip.
      const bx = this.startX + this.site.runway.dx * (this.rollDistance * 0.42);
      const bz = this.startZ + this.site.runway.dz * (this.rollDistance * 0.42);
      const ex = bx + rx * 9.5;
      const ez = bz + rz * 9.5;
      this.eye.set(ex, this.groundAt(ex, ez) + 1.35, ez);
      this.lookAt.set(
        position.x + fx * 22,
        position.y + 1.6 + this.pitch * 12,
        position.z + fz * 22,
      );
      this.rig.update(dt, this.eye, this.lookAt, 52);
      return;
    }

    if (want === 2) {
      // Tracking three-quarter from behind and left: the climb, with the wing and the
      // banking fin between the camera and the sky.
      const chase = smoothstep((t - (this.liftAt + 0.6)) / 2.4);
      const back = 11 - 3 * chase;
      const side = 15 - 4 * chase;
      this.eye.set(
        position.x - fx * back + rx * side,
        position.y + 3.6 + 2.4 * chase,
        position.z - fz * back + rz * side,
      );
      this.lookAt.set(position.x + fx * 3, position.y + 0.9, position.z + fz * 3);
      this.rig.update(dt, this.eye, this.lookAt, 46);
      return;
    }

    // Wide static, planted on the runway the plane just left, watching it go.
    const px = this.startX + this.site.runway.dx * this.rollDistance;
    const pz = this.startZ + this.site.runway.dz * this.rollDistance;
    const drift = smoothstep((t - (this.fadeAt - 1.6)) / Math.max(0.1, this.total - this.fadeAt + 1.6));
    const ex = px + rx * (34 + 10 * drift) - fx * 24;
    const ez = pz + rz * (34 + 10 * drift) - fz * 24;
    this.eye.set(ex, this.groundAt(px + rx * 34 - fx * 24, pz + rz * 34 - fz * 24) + 7.5 + 2.5 * drift, ez);
    this.lookAt.set(
      position.x + fx * 30,
      position.y + 4 + this.altitude * 0.12,
      position.z + fz * 30,
    );
    this.rig.update(dt, this.eye, this.lookAt, 40);
  }
}
