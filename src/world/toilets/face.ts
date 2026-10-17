/**
 * The optional face on a toilet's front wall: two eyes with pupils, upper and lower
 * lids, brows and blush. It never speaks; an emotion is a pose its parts ease towards,
 * and the pupils follow whatever the caller points them at (a tool, the player).
 *
 * Low-poly and shared: one geometry and one material per part for every face, so a
 * face is a dozen draws and no program of its own beyond the flat material's. Lids and
 * blush are shown and hidden by visibility only.
 */

import * as THREE from 'three';
import { makeFlatMaterial } from '../../render/materials';
import type { ToiletEmotion, ToiletFaceSpec, ToiletState } from './types';

/** One emotion's pose. Lids are shares of the eye's height; angles in radians. */
interface FacePose {
  /** Upper lid closure, 0 open to 1 shut. */
  readonly upper: number;
  /** Lower lid rise: a smile pushes it up. */
  readonly lower: number;
  /** Brow tilt: positive drops the inner ends (anger), negative raises them (worry). */
  readonly tilt: number;
  /** Brow lift above its rest, as a share of the eye radius. */
  readonly lift: number;
  /** Where the pupils rest without a target, -1 down to 1 up. */
  readonly gaze: number;
  readonly blush: number;
}

const POSES: Readonly<Record<ToiletEmotion, FacePose>> = {
  sleepy: { upper: 0.62, lower: 0.05, tilt: 0.05, lift: -0.1, gaze: -0.4, blush: 0 },
  angry: { upper: 0.28, lower: 0.15, tilt: 0.38, lift: -0.15, gaze: 0, blush: 0 },
  embarrassed: { upper: 0.18, lower: 0.12, tilt: -0.22, lift: 0.12, gaze: -0.7, blush: 1 },
  worried: { upper: 0.08, lower: 0, tilt: -0.36, lift: 0.22, gaze: 0.1, blush: 0 },
  relieved: { upper: 0.42, lower: 0.18, tilt: -0.14, lift: 0.1, gaze: 0.2, blush: 0 },
  happy: { upper: 0, lower: 0.42, tilt: -0.06, lift: 0.18, gaze: 0.25, blush: 0.6 },
  proud: { upper: 0.34, lower: 0.3, tilt: 0.14, lift: 0.28, gaze: 0.45, blush: 0 },
};

/** Eases a pose part per second. */
const EASE_RATE = 6;
/** Eye white: taller than wide. */
const EYE_ASPECT = 1.15;
const EYE_DEPTH = 0.03;
const PUPIL_SHARE = 0.45;
/** How far the pupils may travel from the centre, as a share of the eye radius. */
const PUPIL_REACH = 0.38;

let parts: {
  readonly disc: THREE.BufferGeometry;
  readonly block: THREE.BoxGeometry;
  readonly white: THREE.Material;
  readonly pupil: THREE.Material;
  readonly brow: THREE.Material;
  readonly blush: THREE.Material;
} | null = null;

function sharedParts(): NonNullable<typeof parts> {
  if (!parts) {
    // A disc facing -Z: a ten-sided cylinder turned onto its side.
    const disc = new THREE.CylinderGeometry(1, 1, 1, 10).rotateX(Math.PI / 2);
    parts = {
      disc,
      block: new THREE.BoxGeometry(1, 1, 1),
      white: makeFlatMaterial(0xf4f1e8, 0.5),
      pupil: makeFlatMaterial(0x1d1b1a, 0.4),
      brow: makeFlatMaterial(0x2a2420, 0.8),
      blush: makeFlatMaterial(0xe58a8a, 0.8),
    };
  }
  return parts;
}

interface Eye {
  readonly pupil: THREE.Mesh;
  readonly upper: THREE.Mesh;
  readonly lower: THREE.Mesh;
  readonly brow: THREE.Mesh;
  /** +1 for the eye on the face's right (the viewer's left), -1 for the other. */
  readonly side: number;
}

const _local = new THREE.Vector3();

/**
 * A face on the plane z = 0 of its group, looking down -Z. The group is placed on the
 * wall by the rig; `lids` is the wall's colour, so a closing lid reads as skin.
 */
export class ToiletFace {
  readonly group = new THREE.Group();
  private readonly eyes: Eye[] = [];
  private readonly blushes: THREE.Mesh[] = [];
  private readonly radius: number;
  private readonly browBase: number;
  private emotion: ToiletEmotion;
  private readonly pose: { -readonly [K in keyof FacePose]: number };
  /** Pupil offset target, shares of `PUPIL_REACH` (null: the pose's resting gaze). */
  private look: THREE.Vector2 | null = null;
  private readonly pupilAt = new THREE.Vector2();

  constructor(spec: ToiletFaceSpec, lids: number) {
    const shared = sharedParts();
    const lidMaterial = makeFlatMaterial(lids, 0.9);
    this.radius = spec.size;
    this.browBase = spec.brow;
    this.emotion = spec.arrival;
    this.pose = { ...POSES[spec.arrival] };
    this.group.name = 'toilet-face';
    const r = spec.size;
    const spacing = 1.45 * r;
    for (const side of [1, -1]) {
      const x = side * spacing;
      const white = new THREE.Mesh(shared.disc, shared.white);
      white.scale.set(r, r * EYE_ASPECT, EYE_DEPTH);
      white.position.set(x, 0, -EYE_DEPTH / 2);
      const pupil = new THREE.Mesh(shared.disc, shared.pupil);
      pupil.scale.set(r * PUPIL_SHARE, r * PUPIL_SHARE * EYE_ASPECT, 0.012);
      pupil.position.set(x, 0, -EYE_DEPTH - 0.006);
      // Lids stand proud of the pupils, so a closing lid covers both.
      const upper = new THREE.Mesh(shared.block, lidMaterial);
      const lower = new THREE.Mesh(shared.block, lidMaterial);
      const brow = new THREE.Mesh(shared.block, shared.brow);
      brow.scale.set(2.1 * r, 0.22 * r, 0.03);
      const blush = new THREE.Mesh(shared.disc, shared.blush);
      blush.scale.set(0.42 * r, 0.24 * r, 0.01);
      blush.position.set(x + side * 0.55 * r, -1.35 * r, -0.005);
      for (const mesh of [white, pupil, upper, lower, brow, blush]) {
        mesh.castShadow = false;
        mesh.receiveShadow = true;
        this.group.add(mesh);
      }
      this.eyes.push({ pupil, upper, lower, brow, side });
      this.blushes.push(blush);
    }
    this.apply();
  }

  get current(): ToiletEmotion {
    return this.emotion;
  }

  setEmotion(emotion: ToiletEmotion): void {
    this.emotion = emotion;
  }

  /** Points the pupils at a world position, or back to the pose's own gaze with null. */
  lookAt(target: THREE.Vector3 | null): void {
    if (!target) {
      this.look = null;
      return;
    }
    this.group.updateWorldMatrix(true, false);
    this.group.worldToLocal(_local.copy(target));
    // The face looks down -Z: a target in front has a negative z.
    const ahead = Math.max(0.3, -_local.z);
    this.look ??= new THREE.Vector2();
    this.look.set(THREE.MathUtils.clamp(_local.x / ahead, -1, 1), THREE.MathUtils.clamp(_local.y / ahead, -1, 1));
  }

  /** Eases towards the emotion's pose; `snap` lands on it at once. */
  update(dt: number, snap = false): void {
    const target = POSES[this.emotion];
    const k = snap ? 1 : 1 - Math.exp(-EASE_RATE * dt);
    for (const key of Object.keys(target) as (keyof FacePose)[]) {
      this.pose[key] += (target[key] - this.pose[key]) * k;
    }
    const gx = this.look ? this.look.x : 0;
    const gy = this.look ? this.look.y : target.gaze;
    this.pupilAt.x += (gx - this.pupilAt.x) * k;
    this.pupilAt.y += (gy - this.pupilAt.y) * k;
    this.apply();
  }

  private apply(): void {
    const r = this.radius;
    const tall = r * EYE_ASPECT;
    const { upper, lower, tilt, lift, blush } = this.pose;
    for (const eye of this.eyes) {
      const x = eye.side * 1.45 * r;
      eye.pupil.position.x = x + this.pupilAt.x * PUPIL_REACH * r;
      eye.pupil.position.y = this.pupilAt.y * PUPIL_REACH * tall;
      const upperHeight = upper * 2 * tall;
      eye.upper.visible = upperHeight > 0.004;
      eye.upper.scale.set(2.2 * r, Math.max(upperHeight, 0.001), 0.02);
      eye.upper.position.set(x, tall - upperHeight / 2, -EYE_DEPTH - 0.025);
      const lowerHeight = lower * 2 * tall;
      eye.lower.visible = lowerHeight > 0.004;
      eye.lower.scale.set(2.2 * r, Math.max(lowerHeight, 0.001), 0.02);
      eye.lower.position.set(x, -tall + lowerHeight / 2, -EYE_DEPTH - 0.025);
      // The inner end is the one towards the face's centre (x = 0); a positive tilt drops it.
      eye.brow.rotation.z = eye.side * tilt;
      eye.brow.position.set(x, tall + this.browBase * 0.35 + lift * r, -0.02);
    }
    for (const mesh of this.blushes) mesh.visible = blush > 0.5;
  }
}

/** The face's emotion for a progress state: worry while it is worked on, joy once healthy. */
export function emotionForState(state: ToiletState, arrival: ToiletEmotion, completed: boolean): ToiletEmotion {
  switch (state) {
    case 'arrived':
      return arrival;
    case 'cleaning':
      return 'relieved';
    case 'healthy':
      return completed ? 'proud' : 'happy';
    default:
      return 'worried';
  }
}
