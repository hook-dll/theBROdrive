/**
 * The cactus air dancers that stand beside every courier: a fabric tube on a blower,
 * 4.4 m of green with two arms, whipping in its own airflow. Cosmetic, never saved,
 * no collider — the courier is the thing you came for.
 *
 * WHAT "LIKE A REAL ONE" MEANS HERE. One mesh per dancer, skinned to a chain of 15
 * bones (11 up the body, then two 2-bone arms). The chain is simulated on the CPU: a
 * travelling whip wave up the tube, a wind lean read from the live weather, and a
 * periodic choke — the airflow cuts, the tube buckles at a seeded height and folds
 * over, writhes on the ground for a moment, then re-inflates and snaps back up with
 * the overshoot a real blower gives. Every instance draws its own phase and its own
 * choke clock from the courier's appearance seed, so a pair of them never pumps in
 * step.
 *
 * THE SKINNING IS THE CHEAP PART. The rest pose, the bone inverses and the skin
 * weights are all a pure function of the constants below, so they are built ONCE at
 * module load: every dancer shares one geometry, one material, one set of rest
 * transforms and one bone-inverse table. A dancer is then 15 Bone objects and one
 * Skeleton (an 8x8 float bone texture, freed when its chunk goes).
 *
 * SHADER RULE. The skinned program is a variant nothing else in the world uses, so a
 * hidden anchor rig is added to the scene here, at construction, and the boot warm-up
 * (`waitForFrameShaders` compiles the whole scene with `traverse`, invisible or not)
 * links it behind the loading cover. The runtime meshes share the anchor's geometry
 * and material, and match it in every variant dimension (skinned, vertex-coloured,
 * castShadow/receiveShadow false, FrontSide, opaque), so the first courier that
 * arrives compiles nothing.
 *
 * LIFECYCLE. A dancer is built into the chunk group that built the courier and is
 * forgotten from this field when that chunk is disposed; out of animation range it is
 * left standing (it is fogged to a smudge) but costs no CPU.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { hash01, hashUnit3 } from '../../core/rng';
import { weather } from '../weather';
import { paint } from './forms';

// ---------------------------------------------------------------------------
// Shape (metres, in the tube's own standing frame: the blower box is on y = 0)
// ---------------------------------------------------------------------------

/** 4.4 m of tube: tall enough to read over a parked car from the lane. */
const BODY_HEIGHT_M = 4.4;
/** Body bones: one rigid segment each, blended across the joints. */
const BODY_BONES = 11;
const BODY_SEG_M = BODY_HEIGHT_M / BODY_BONES;
const BODY_RADIUS_BASE_M = 0.36;
const BODY_RADIUS_TOP_M = 0.26;
const BODY_RADIAL_SEGMENTS = 12;

/** Arm bones: an outward stub, then a nearly upright tip, like a saguaro's. */
const ARM_LEN_M = 1.05;
const ARM_RADIUS_M = 0.16;
const ARM_SIDE = [-1, 1] as const;
/** Body bone each arm hangs off. Its origin IS the attach height (bone i at i * seg). */
const ARM_PARENT_BONE = [6, 7] as const;
const ARM_OFFSET_X_M = 0.3;

const COLOUR_TUBE = 0x55973f;
const COLOUR_BLOWER = 0x4a4e51;
const COLOUR_FACE = 0x1b1f1a;

/**
 * Where a dancer stands relative to the car it advertises: this far forward along the
 * car's own heading, and this far further from the road than the car's parked flank.
 * 2.8 m clears the widest car's half-track and keeps the blower off the lane.
 */
export const DANCER_ALONG_M = 0.5;
export const DANCER_OUT_M = 2.8;

const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);
const ONE = new THREE.Vector3(1, 1, 1);
const IDENTITY_MATRIX = new THREE.Matrix4();

// ---------------------------------------------------------------------------
// Rest pose: shared by every dancer (positions and local rotations only)
// ---------------------------------------------------------------------------

interface RestBone {
  readonly parent: number;
  readonly pos: THREE.Vector3;
  readonly quat: THREE.Quaternion;
}

function armDirLower(side: number): THREE.Vector3 {
  return new THREE.Vector3(side * 1.0, 0.85, 0).normalize();
}
function armDirUpper(side: number): THREE.Vector3 {
  return new THREE.Vector3(side * 0.18, 1, 0).normalize();
}

function buildRest(): RestBone[] {
  const bones: RestBone[] = [];
  for (let i = 0; i < BODY_BONES; i++) {
    bones.push({
      parent: i - 1,
      // Parent-relative: one segment up from the previous joint, not the absolute
      // height. `pos` is a local offset (bone i's world height is i * seg); using the
      // absolute height here stacks the offsets and stretches the tube to 22 m.
      pos: new THREE.Vector3(0, i === 0 ? 0 : BODY_SEG_M, 0),
      quat: new THREE.Quaternion(),
    });
  }
  for (let a = 0; a < ARM_SIDE.length; a++) {
    const side = ARM_SIDE[a];
    const lower = armDirLower(side);
    const q0 = new THREE.Quaternion().setFromUnitVectors(UP, lower);
    const q1 = new THREE.Quaternion().setFromUnitVectors(UP, armDirUpper(side));
    bones.push({
      parent: ARM_PARENT_BONE[a],
      // The arm root's parent is a body bone, whose rest frame is the tube frame.
      pos: new THREE.Vector3(side * ARM_OFFSET_X_M, 0, 0),
      quat: q0,
    });
    bones.push({
      parent: bones.length - 1,
      pos: new THREE.Vector3(0, ARM_LEN_M, 0),
      // The tip's frame continues the stub; its own rest turn points it upright.
      quat: q0.clone().invert().multiply(q1),
    });
  }
  return bones;
}

const REST = buildRest();
/** Local rest rotations, for `bone.quaternion.copy(rest).multiply(extra)`. */
const REST_LOCAL_QUAT: readonly THREE.Quaternion[] = REST.map((bone) => bone.quat.clone());

/**
 * The inverse of every bone's rest world matrix. Identical for every dancer, so the
 * skeletons share one table (read-only after construction) instead of inverting 15
 * matrices per spawn.
 */
const SHARED_BONE_INVERSES: readonly THREE.Matrix4[] = (() => {
  const world: THREE.Matrix4[] = [];
  for (let i = 0; i < REST.length; i++) {
    const local = new THREE.Matrix4().compose(REST[i].pos, REST[i].quat, ONE);
    world.push(
      REST[i].parent < 0
        ? local
        : new THREE.Matrix4().multiplyMatrices(world[REST[i].parent], local),
    );
  }
  return world.map((matrix) => matrix.clone().invert());
})();

/**
 * Per arm bone, the local axis that swings that arm toward the ground. Rotating about
 * `lower x down` in the arm's own rest frame is what drops a limp arm without having
 * to think about which way the bone happened to be turned.
 */
const ARM_LOCAL_DROOP_AXIS: readonly THREE.Vector3[] = (() => {
  const out: THREE.Vector3[] = [];
  for (let a = 0; a < ARM_SIDE.length; a++) {
    const side = ARM_SIDE[a];
    const worldAxis = new THREE.Vector3().crossVectors(armDirLower(side), DOWN).normalize();
    const q0 = new THREE.Quaternion().setFromUnitVectors(UP, armDirLower(side));
    const q1 = new THREE.Quaternion().setFromUnitVectors(UP, armDirUpper(side));
    out.push(worldAxis.clone().applyQuaternion(q0.clone().invert()).normalize());
    out.push(worldAxis.clone().applyQuaternion(q1.clone().invert()).normalize());
  }
  return out;
})();

// ---------------------------------------------------------------------------
// Geometry: also shared (rest-pose vertex positions, weights, colours)
// ---------------------------------------------------------------------------

/** Every vertex hangs on the bone that spans its height; joints blend the two. */
function weightBodyByHeight(geometry: THREE.BufferGeometry): void {
  const position = geometry.getAttribute('position');
  const last = BODY_BONES - 1;
  const index = new Uint16Array(position.count * 4);
  const weight = new Float32Array(position.count * 4);
  for (let v = 0; v < position.count; v++) {
    const t = position.getY(v) / BODY_SEG_M;
    const i = Math.min(last, Math.max(0, Math.floor(t)));
    const f = i >= last ? 0 : Math.min(1, Math.max(0, t - i));
    index[v * 4] = i;
    weight[v * 4] = 1 - f;
    index[v * 4 + 1] = Math.min(last, i + 1);
    weight[v * 4 + 1] = f;
  }
  geometry.setAttribute('skinIndex', new THREE.BufferAttribute(index, 4));
  geometry.setAttribute('skinWeight', new THREE.BufferAttribute(weight, 4));
}

/** A rigid part: every vertex on one bone at full weight. */
function weightToBone(geometry: THREE.BufferGeometry, bone: number): void {
  const count = geometry.getAttribute('position').count;
  const index = new Uint16Array(count * 4);
  const weight = new Float32Array(count * 4);
  for (let v = 0; v < count; v++) {
    index[v * 4] = bone;
    weight[v * 4] = 1;
  }
  geometry.setAttribute('skinIndex', new THREE.BufferAttribute(index, 4));
  geometry.setAttribute('skinWeight', new THREE.BufferAttribute(weight, 4));
}

function buildDancerGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  // Tube. Open-ended: the blower box closes the bottom, the sphere closes the top.
  const body = new THREE.CylinderGeometry(
    BODY_RADIUS_TOP_M,
    BODY_RADIUS_BASE_M,
    BODY_HEIGHT_M,
    BODY_RADIAL_SEGMENTS,
    BODY_BONES,
    true,
  );
  body.translate(0, BODY_HEIGHT_M / 2, 0);
  paint(body, COLOUR_TUBE);
  weightBodyByHeight(body);
  parts.push(body);

  const cap = new THREE.SphereGeometry(
    BODY_RADIUS_TOP_M,
    BODY_RADIAL_SEGMENTS,
    5,
    0,
    Math.PI * 2,
    0,
    Math.PI / 2,
  );
  cap.translate(0, BODY_HEIGHT_M, 0);
  paint(cap, COLOUR_TUBE);
  weightBodyByHeight(cap);
  parts.push(cap);

  const blower = new THREE.BoxGeometry(0.78, 0.42, 0.78);
  blower.translate(0, 0.21, 0);
  paint(blower, COLOUR_BLOWER);
  weightToBone(blower, 0);
  parts.push(blower);

  for (let a = 0; a < ARM_SIDE.length; a++) {
    const side = ARM_SIDE[a];
    const rootBone = BODY_BONES + a * 2;
    const lower = armDirLower(side);
    const upper = armDirUpper(side);
    const attach = new THREE.Vector3(
      side * ARM_OFFSET_X_M,
      ARM_PARENT_BONE[a] * BODY_SEG_M,
      0,
    );
    const elbow = attach.clone().addScaledVector(lower, ARM_LEN_M);

    const stub = new THREE.CylinderGeometry(ARM_RADIUS_M * 0.92, ARM_RADIUS_M, ARM_LEN_M, 9, 1, true);
    stub.translate(0, ARM_LEN_M / 2, 0);
    stub.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, lower));
    stub.translate(attach.x, attach.y, attach.z);
    paint(stub, COLOUR_TUBE);
    weightToBone(stub, rootBone);
    parts.push(stub);

    const rise = new THREE.CylinderGeometry(ARM_RADIUS_M * 0.85, ARM_RADIUS_M * 0.92, ARM_LEN_M, 9, 1, true);
    rise.translate(0, ARM_LEN_M / 2, 0);
    rise.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, upper));
    rise.translate(elbow.x, elbow.y, elbow.z);
    paint(rise, COLOUR_TUBE);
    weightToBone(rise, rootBone + 1);
    parts.push(rise);

    const tip = new THREE.SphereGeometry(ARM_RADIUS_M * 0.85, 9, 5);
    tip.translate(
      elbow.x + upper.x * ARM_LEN_M,
      elbow.y + upper.y * ARM_LEN_M,
      elbow.z + upper.z * ARM_LEN_M,
    );
    paint(tip, COLOUR_TUBE);
    weightToBone(tip, rootBone + 1);
    parts.push(tip);
  }

  // The face, on the +Z side: the rig is turned to look at the road.
  for (const side of [-1, 1]) {
    const eye = new THREE.SphereGeometry(0.055, 7, 5);
    eye.translate(side * 0.11, 3.46, 0.255);
    paint(eye, COLOUR_FACE);
    weightBodyByHeight(eye);
    parts.push(eye);
  }
  const mouth = new THREE.BoxGeometry(0.17, 0.03, 0.06);
  mouth.translate(0, 3.2, 0.27);
  paint(mouth, COLOUR_FACE);
  weightBodyByHeight(mouth);
  parts.push(mouth);

  const merged = mergeGeometries(parts, false);
  if (merged === null) throw new Error('air dancer geometry failed to merge');
  merged.computeBoundingSphere();
  return merged;
}

const DANCER_GEOMETRY = buildDancerGeometry();

/**
 * One material for every dancer and the anchor. Nothing about it varies per instance,
 * so the merged multi-colour mesh is one draw call, and vertex colour carries the
 * blower, the tube, the arms and the face.
 */
const DANCER_MATERIAL = new THREE.MeshStandardMaterial({
  vertexColors: true,
  roughness: 0.9,
  metalness: 0,
  flatShading: true,
  side: THREE.FrontSide,
});

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

/** Radians of total bend that take the tube from upright to folded over. */
const FOLD_RAD = Math.PI * 1.12;
/**
 * Buckle profiles, one per possible buckle bone, normalised to sum to 1. Narrow: a
 * choked air dancer creases at one band and the tube above it hangs, like a broken
 * arm, rather than curving over in a smooth arc.
 */
const FOLD_SPREAD_BONES = 0.85;
const BUCKLE_MIN_BONE = 3;
const BUCKLE_MAX_BONE = BODY_BONES - 3;
const FOLD_PROFILES: readonly Float32Array[] = (() => {
  const out: Float32Array[] = [];
  for (let buckle = BUCKLE_MIN_BONE; buckle <= BUCKLE_MAX_BONE; buckle++) {
    const profile = new Float32Array(BODY_BONES);
    let sum = 0;
    for (let i = 0; i < BODY_BONES; i++) {
      const d = i - buckle;
      profile[i] = Math.exp(-(d * d) / (2 * FOLD_SPREAD_BONES * FOLD_SPREAD_BONES));
      sum += profile[i];
    }
    for (let i = 0; i < BODY_BONES; i++) profile[i] /= sum;
    out.push(profile);
  }
  return out;
})();
/** Lowest a joint of a folded tube may come, metres above the blower's foot. */
const FOLD_FLOOR_M = 0.35;
/**
 * The total fold each buckle profile may take before a joint reaches the ground. A
 * low buckle with the full `FOLD_RAD` put the top of the tube up to 1.9 m into the
 * sand: the same angle that lays a high buckle over buries a low one. Found once, by
 * bisection on the planar chain the pose builds.
 */
const FOLD_LIMITS: Float32Array = (() => {
  const lowestJoint = (profile: Float32Array, angle: number): number => {
    let theta = 0;
    let y = REST[0]!.pos.y;
    let lowest = Infinity;
    for (let i = 0; i < BODY_BONES; i++) {
      theta += angle * profile[i]!;
      y += BODY_SEG_M * Math.cos(theta);
      lowest = Math.min(lowest, y);
    }
    return lowest;
  };
  const out = new Float32Array(FOLD_PROFILES.length);
  for (let p = 0; p < FOLD_PROFILES.length; p++) {
    let lo = 0;
    let hi = FOLD_RAD;
    if (lowestJoint(FOLD_PROFILES[p]!, hi) >= FOLD_FLOOR_M) lo = hi;
    else {
      for (let step = 0; step < 24; step++) {
        const mid = (lo + hi) / 2;
        if (lowestJoint(FOLD_PROFILES[p]!, mid) >= FOLD_FLOOR_M) lo = mid;
        else hi = mid;
      }
    }
    out[p] = lo;
  }
  return out;
})();

const COLLAPSE_SECONDS = 0.85;
const RISE_SECONDS = 0.8;
const GROUND_MIN_SECONDS = 0.5;
const GROUND_MAX_SECONDS = 1.4;
const CHOKE_MIN_SECONDS = 2.6;
const CHOKE_MAX_SECONDS = 6.4;
/** How far the wind pulls the fold direction away from "away from the road". */
const FOLD_WIND_MIX = 0.45;
/** Wind speed that reaches full lean. */
const LEAN_FULL_MPS = 13;
/** Largest lean from a steady wind, radians. */
const LEAN_MAX_RAD = 0.32;
/** Beyond this the dancer is left standing but not simulated, metres. */
const ANIMATE_RANGE_M = 700;
const ANIMATE_RANGE_SQ = ANIMATE_RANGE_M * ANIMATE_RANGE_M;
/** Domain tag for this field's own draws. */
const DANCER_DOMAIN = 0x41495231; // 'AIR1'

const PHASE_UP = 0;
const PHASE_COLLAPSE = 1;
const PHASE_GROUND = 2;
const PHASE_RISE = 3;

function easeInOut(u: number): number {
  return u < 0.5 ? 2 * u * u : 1 - 2 * (1 - u) * (1 - u);
}

/** Overshoots above 1 around u = 0.7, lands exactly on 1: the re-inflation snap. */
function easeOutBack(u: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const p = u - 1;
  return 1 + c3 * p * p * p + c1 * p * p;
}

const _euler = new THREE.Euler();
const _bend = new THREE.Quaternion();
const _arm = new THREE.Quaternion();

/** Where a dancer stands, in absolute metres. */
export interface DancerSite {
  readonly x: number;
  readonly z: number;
  /** Ground height at the site, absolute. */
  readonly y: number;
  /** Facing: the face looks along this yaw's +Z, i.e. at the road. */
  readonly yaw: number;
  readonly seed: number;
  /** The chunk's build origin, so the rig can be placed in the chunk's own frame. */
  readonly originX: number;
  readonly originZ: number;
}

/** The chunk that built a dancer hands this back on dispose. */
export interface DancerHandle {
  readonly root: THREE.Group;
}

class Dancer implements DancerHandle {
  readonly root = new THREE.Group();
  readonly bones: THREE.Bone[] = [];
  /** Absolute metres. The rig moves with its chunk; this does not. */
  readonly absX: number;
  readonly absZ: number;
  phase = 0;
  speed = 1;
  energy = 1;
  nextChoke = 0;
  /** This dancer's own seed and how many chokes it has had: the choke clock's draws. */
  readonly seed: number;
  chokes = 0;
  readonly skeleton: THREE.Skeleton;
  /** Largest total fold for its buckle profile; see FOLD_LIMITS. */
  foldMax = FOLD_RAD;
  /** Fold direction in the dancer's own frame, biased away from the road. */
  foldX = 0;
  foldZ = -1;
  profile: Float32Array = FOLD_PROFILES[0];
  phaseId = PHASE_UP;
  phaseTime = 0;
  groundFor = 1;

  constructor(site: DancerSite) {
    for (const rest of REST) {
      const bone = new THREE.Bone();
      bone.position.copy(rest.pos);
      bone.quaternion.copy(rest.quat);
      if (rest.parent >= 0) this.bones[rest.parent].add(bone);
      this.bones.push(bone);
    }
    const skeleton = new THREE.Skeleton(this.bones, SHARED_BONE_INVERSES as THREE.Matrix4[]);
    this.skeleton = skeleton;
    // The root bone carries the blower box and is never posed: bending it rocked the
    // box on the ground. Composed once, since chunk scenery does not update matrices.
    this.bones[0]!.updateMatrix();
    const mesh = new THREE.SkinnedMesh(DANCER_GEOMETRY, DANCER_MATERIAL);
    // The rest geometry is a 4.4 m tube; a folded dancer reaches well outside it.
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    // Bound against the rest pose in the rig's own frame: the rig's world transform
    // cancels in the shader, so a rebase or a chunk move needs no rebind.
    mesh.bind(skeleton, IDENTITY_MATRIX);

    this.root.name = 'airdancer';
    this.root.add(this.bones[0], mesh);
    this.absX = site.x;
    this.absZ = site.z;

    const seed = site.seed;
    this.seed = seed;
    this.phase = hash01(seed, DANCER_DOMAIN, 1) * Math.PI * 2;
    this.speed = 0.85 + hash01(seed, DANCER_DOMAIN, 2) * 0.4;
    this.energy = 0.85 + hash01(seed, DANCER_DOMAIN, 3) * 0.5;
    const profileIndex = Math.min(
      FOLD_PROFILES.length - 1,
      Math.floor(hash01(seed, DANCER_DOMAIN, 5) * FOLD_PROFILES.length),
    );
    this.profile = FOLD_PROFILES[profileIndex]!;
    this.foldMax = FOLD_LIMITS[profileIndex]!;
    // Folds away from the face, which is turned at the road, with a spread of angles.
    const away = Math.PI + (hash01(seed, DANCER_DOMAIN, 6) - 0.5) * 2.4;
    this.foldX = Math.sin(away);
    this.foldZ = Math.cos(away);
  }
}

/**
 * Owns every live dancer, the shared geometry/material, and the boot anchor rig that
 * compiles their skinned program before a courier is ever in sight.
 */
export class DancerField {
  private readonly anchor = new THREE.Group();
  private readonly dancers: Dancer[] = [];
  private time = 0;

  constructor(private readonly scene: THREE.Scene) {
    // An invisible rig with the same geometry, material and skinning as the real
    // ones. The boot warm-up walks the scene with `traverse`, so this links the
    // program behind the loading cover; nothing draws it.
    this.anchor.name = 'airdancer-anchor';
    this.anchor.visible = false;
    const anchorRig = new Dancer({
      x: 0,
      z: 0,
      y: 0,
      yaw: 0,
      seed: 0,
      originX: 0,
      originZ: 0,
    });
    this.anchor.add(anchorRig.root);
    scene.add(this.anchor);
  }

  /** Builds one dancer into `target` (the courier's chunk group). */
  spawn(target: THREE.Object3D, site: DancerSite): DancerHandle {
    const dancer = new Dancer(site);
    // Relative to this field's clock: an absolute time made every dancer spawned
    // after the first few seconds choke on its very first pose.
    dancer.nextChoke = this.time + 1.5 + hash01(site.seed, DANCER_DOMAIN, 4) * 5;
    dancer.root.position.set(site.x - site.originX, site.y, site.z - site.originZ);
    dancer.root.rotation.y = site.yaw;
    target.add(dancer.root);
    this.dancers.push(dancer);
    return dancer;
  }

  /** Drops dancers whose chunk has gone, and frees their bone textures. Their meshes go with the chunk group. */
  forget(handles: readonly DancerHandle[]): void {
    if (handles.length === 0) return;
    const dropped = new Set<DancerHandle>(handles);
    for (let i = this.dancers.length - 1; i >= 0; i--) {
      const dancer = this.dancers[i]!;
      if (!dropped.has(dancer)) continue;
      dancer.skeleton.dispose();
      this.dancers.splice(i, 1);
    }
  }

  /**
   * Poses every dancer near enough to be seen, from the live weather wind. Absolute
   * camera coordinates: the caller adds the floating origin, so a rebase never moves
   * the dancers in this field's own book-keeping.
   */
  update(dt: number, cameraX: number, cameraZ: number): void {
    if (this.dancers.length === 0) return;
    this.time += dt;
    const lean = Math.min(1, weather.windMps / LEAN_FULL_MPS) * LEAN_MAX_RAD;
    const windX = weather.windX;
    const windZ = weather.windZ;
    for (const dancer of this.dancers) {
      const dx = dancer.absX - cameraX;
      const dz = dancer.absZ - cameraZ;
      if (dx * dx + dz * dz > ANIMATE_RANGE_SQ) continue;
      this.pose(dancer, dt, lean, windX, windZ);
    }
  }

  dispose(): void {
    for (const dancer of this.dancers) dancer.skeleton.dispose();
    this.dancers.length = 0;
    this.scene.remove(this.anchor);
  }

  private pose(dancer: Dancer, dt: number, lean: number, windX: number, windZ: number): void {
    dancer.phaseTime += dt;
    switch (dancer.phaseId) {
      case PHASE_UP:
        if (this.time >= dancer.nextChoke) {
          dancer.phaseId = PHASE_COLLAPSE;
          dancer.phaseTime = 0;
        }
        break;
      case PHASE_COLLAPSE:
        if (dancer.phaseTime >= COLLAPSE_SECONDS) {
          dancer.phaseId = PHASE_GROUND;
          dancer.phaseTime = 0;
          dancer.groundFor =
            GROUND_MIN_SECONDS +
            hashUnit3(dancer.seed, DANCER_DOMAIN, 16 + 2 * dancer.chokes) * (GROUND_MAX_SECONDS - GROUND_MIN_SECONDS);
        }
        break;
      case PHASE_GROUND:
        if (dancer.phaseTime >= dancer.groundFor) {
          dancer.phaseId = PHASE_RISE;
          dancer.phaseTime = 0;
        }
        break;
      default:
        if (dancer.phaseTime >= RISE_SECONDS) {
          dancer.phaseId = PHASE_UP;
          dancer.phaseTime = 0;
          dancer.nextChoke =
            this.time +
            CHOKE_MIN_SECONDS +
            hashUnit3(dancer.seed, DANCER_DOMAIN, 17 + 2 * dancer.chokes) * (CHOKE_MAX_SECONDS - CHOKE_MIN_SECONDS);
          dancer.chokes++;
        }
        break;
    }

    const time = this.time;
    const up = dancer.speed;
    let fold: number;
    switch (dancer.phaseId) {
      case PHASE_COLLAPSE:
        fold = easeInOut(Math.min(1, dancer.phaseTime / COLLAPSE_SECONDS));
        break;
      case PHASE_GROUND:
        fold = 1 + Math.sin(time * 2.3 + dancer.phase) * 0.03;
        break;
      case PHASE_RISE:
        fold = 1 - easeOutBack(Math.min(1, dancer.phaseTime / RISE_SECONDS));
        break;
      default:
        fold = 0;
        break;
    }
    const flow = Math.max(0, 1 - fold * 0.8);
    const foldAngle = fold * dancer.foldMax;

    // The wind in the tube's own frame (the rig is turned by its yaw).
    const cos = Math.cos(dancer.root.rotation.y);
    const sin = Math.sin(dancer.root.rotation.y);
    const windLocalX = cos * windX - sin * windZ;
    const windLocalZ = sin * windX + cos * windZ;

    // Fold away from the road, nudged by the weather.
    const dirX = dancer.foldX + windLocalX * FOLD_WIND_MIX;
    const dirZ = dancer.foldZ + windLocalZ * FOLD_WIND_MIX;
    const inv = 1 / Math.max(1e-4, Math.hypot(dirX, dirZ));
    const foldX = dirX * inv;
    const foldZ = dirZ * inv;

    const wobble = fold > 0.5 ? Math.sin(time * 3.1 + dancer.phase) * 0.35 : 0;
    const leanPerBone = (lean * (1 - 0.5 * Math.min(1, fold))) / BODY_BONES;
    const amplitude = dancer.energy * flow;

    // Bone 0 is the blower's and stays at rest; the tube bends from bone 1 up.
    for (let i = 1; i < BODY_BONES; i++) {
      const w = (i + 1) / BODY_BONES;
      // A whip travels up the tube, faster and wider toward the top. The amplitudes
      // are cumulative: a few hundredths of a radian per bone add up to a metre of
      // swing at the top, which is what a fabric tube on a blower actually does.
      const whipZ = Math.sin(time * 2.2 * up + dancer.phase + i * 0.8) * 0.15 * (0.35 + w) * amplitude;
      const whipX =
        Math.cos(time * 3.4 * up + dancer.phase * 1.6 + i * 0.63) * 0.13 * (0.25 + w * w) * amplitude;
      // The top of a real one never settles: it snaps around.
      const snap =
        Math.sin(time * 7.3 * up + dancer.phase * 2.1 + i * 1.9) * 0.055 * Math.max(0, w - 0.5) * amplitude;
      const profile = dancer.profile[i]!;
      // The writhing never takes the fold past this profile's limit (FOLD_LIMITS).
      const boneFold = Math.min(foldAngle * profile + wobble * profile * 3, dancer.foldMax * 1.03 * profile);
      const bendZ = whipZ + snap + windLocalZ * leanPerBone + boneFold * foldZ;
      const bendX = whipX + windLocalX * leanPerBone + boneFold * foldX;
      _euler.set(bendZ, 0, -bendX, 'XYZ');
      _bend.setFromEuler(_euler);
      const bone = dancer.bones[i];
      bone.quaternion.copy(REST_LOCAL_QUAT[i]).multiply(_bend);
      // Chunk scenery is frozen (`matrixAutoUpdate = false`, world/chunks.ts), so the
      // local matrix has to be recomposed here or the skinning keeps using the rest
      // pose. Same reason as world/props/artifacts.ts.
      bone.updateMatrix();
    }

    for (let a = 0; a < ARM_SIDE.length; a++) {
      const rootBone = BODY_BONES + a * 2;
      const armPhase = dancer.phase + a * 2.4;
      const flap = 0.55 * flow;
      const droop = Math.min(1, Math.max(0, fold)) * 1.25;
      const rootAngle = Math.sin(time * 3.3 * up + armPhase) * flap;
      const tipAngle = Math.sin(time * 4.6 * up + armPhase + 1.1) * flap * 1.3;
      _arm.setFromAxisAngle(ARM_LOCAL_DROOP_AXIS[a * 2], rootAngle + droop * 0.55);
      dancer.bones[rootBone].quaternion.copy(REST_LOCAL_QUAT[rootBone]).multiply(_arm);
      dancer.bones[rootBone].updateMatrix();
      _arm.setFromAxisAngle(ARM_LOCAL_DROOP_AXIS[a * 2 + 1], tipAngle + droop * 0.7);
      dancer.bones[rootBone + 1].quaternion.copy(REST_LOCAL_QUAT[rootBone + 1]).multiply(_arm);
      dancer.bones[rootBone + 1].updateMatrix();
    }
  }
}
