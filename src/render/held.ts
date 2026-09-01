/**
 * First-person "viewmodel" for the item the player is carrying.
 *
 * The camera is never added to the scene graph (`Renderer.render(scene, camera)`
 * only draws `scene`), so a genuine camera child would never render. Instead the
 * viewmodel root lives in the main scene and its world transform is copied from
 * the camera every tick, which reproduces "parented to the camera" exactly while
 * keeping the viewmodel in the ordinary render pass: one tone-map, one shadow
 * pass, no second scene/camera, no leaked state.
 *
 * Call `update` after the camera rig has written its transform and before
 * `renderer.render()`.
 */
import * as THREE from 'three';
import { createItemMesh, setBubbleGumPieceCount } from './partmesh';
import { setPartCondition } from './materials';
import { itemMass } from '../items/items';
import type { Item } from '../items/items';
import type { CameraMode } from './cameras';

/**
 * Mirrors `CONDITION_PROGRAM_KEY` in ./materials. Condition materials are the
 * per-instance clones this viewmodel owns (fresh from `makeConditionMaterial`),
 * while flat materials are shared via the materials cache and geometry is
 * partmesh's shared cache. Only condition materials report this program key, so
 * it cleanly identifies what is safe to dispose.
 */
const CONDITION_PROGRAM_KEY = 'condition-rust-dirt-v1';

/* ---- carry pose (camera-local: +X right, +Y up, -Z forward) ---- */
const HOLD_DIST_LIGHT = 0.42;
const HOLD_DIST_HEAVY = 0.38;
const LIGHT_X = 0.24;
const LIGHT_Y = -0.13;
const HEAVY_X = 0.02;
const HEAVY_Y = -0.22;

/* ---- tilt (Euler YXZ: pitch, yaw, roll) ---- */
const TILT_PITCH = 0.22;
const TILT_YAW = -2.35;
const TILT_ROLL = -0.18;

/* ---- scale, derived from the item's bounding box ---- */
const TARGET_MAX = 0.28;
const TARGET_TAU = 0.32;

/* ---- heaviness (log mass -> 0..1) ---- */
const MASS_LOG_MIN = Math.log(1);
const MASS_LOG_MAX = Math.log(400);

/* ---- motion ---- */
const SWAY_X = 0.006;
const SWAY_Y = 0.005;
const SWAY_ROLL = 0.02;
const SWAY_PITCH = 0.015;

const WALK_FREQ = 9.0;
const WALK_BOB = 0.018;
const WALK_SWAY = 0.008;
const WALK_ROLL = 0.03;

const SCRUB_FREQ = 14.0;
const SCRUB_AMP = 0.045;
const SCRUB_ROLL = 0.07;

const USE_RAMP = 3.0;
const POUR_ANGLE = 1.15;
const POUR_LIFT = 0.02;

const RECOIL_DECAY = 9.0;
const RECOIL_BACK = 0.06;
const RECOIL_PITCH = 0.3;
const RECOIL_LIFT = 0.012;

/* ---- bubble-gum pack: one quick hand-to-mouth cycle at the start of chewing ---- */
const GUM_DETACH_T = 0.45;
const GUM_MOUTH_X = 0.025;
const GUM_MOUTH_Y = -0.085;
const GUM_MOUTH_Z = -0.13;
const GUM_MOUTH_ROLL = 0.12;

/* ---- module-level scratch: `update` must not allocate ---- */
const _size = new THREE.Vector3();
const _centre = new THREE.Vector3();
const _box = new THREE.Box3();
const _eul = new THREE.Euler();
_eul.order = 'YXZ';

/**
 * Ramps `cur` toward 1 while `up` is true, toward 0 otherwise, at `rate`/s.
 * The conditional sign is the one easy-to-miss detail; keeping it here means the
 * tool and fuel-can ramps stay in lockstep.
 */
function ramp(cur: number, up: boolean, rate: number, dt: number): number {
  const next = cur + (up ? rate : -rate) * dt;
  return next < 0 ? 0 : next > 1 ? 1 : next;
}

export class HeldItemView {
  private readonly root: THREE.Group;
  private readonly hand: THREE.Group;
  private mesh: THREE.Object3D | null = null;
  private heldType: Item['type'] | null = null;
  private heldId: string | null = null;

  private time = 0;
  private bobPhase = 0;
  private scrubPhase = 0;
  private useT = 0;
  private recoil = 0;
  private shotClock = 0;
  private prevUse = false;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly scene: THREE.Scene,
  ) {
    this.root = new THREE.Group();
    this.hand = new THREE.Group();
    this.root.add(this.hand);
    this.root.visible = false;
    this.scene.add(this.root);
  }

  update(
    item: Item | null,
    mode: CameraMode,
    dt: number,
    opts: {
      usePrimary: boolean;
      moveMag: number;
      speedKmh: number;
      /** Normalized pack-to-mouth cycle, or -1 while no gum-use animation is running. */
      gumUseProgress: number;
      /** Sticks left after the current use; the detached stick remains visible until the mouth. */
      gumCharges: number;
    },
  ): void {
    const d = dt > 0 ? dt : 1 / 60;

    // A spent pack remains for the return half of its animation even though the
    // inventory has already removed it. Likewise, do not replace it with the newly
    // selected slot until the hand has come back from the mouth.
    const gumAnimating =
      opts.gumUseProgress >= 0 &&
      opts.gumUseProgress <= 1 &&
      this.heldType === 'bubble_gum' &&
      this.mesh !== null;
    if (mode !== 'foot' || (item === null && !gumAnimating)) {
      this.root.visible = false;
      this.resetMotion();
      return;
    }

    // Rebuild only when the held item actually changes. A gum pack in flight owns
    // the hand until it returns, including the final use where the pack is gone.
    if (
      item !== null &&
      !gumAnimating &&
      (item.type !== this.heldType || item.id !== this.heldId)
    ) {
      this.rebuild(item);
      this.resetMotion();
    }
    if (!this.mesh) return;

    this.root.visible = true;
    this.root.position.copy(this.camera.position);
    this.root.quaternion.copy(this.camera.quaternion);

    this.time += d;
    const t = this.time;

    // Heavy items sink toward centre for a two-handed carry; light ones stay
    // to the side, one-handed. During the final gum use `item` may already be null,
    // but the returning empty wrapper is still the same 20 g viewmodel.
    const visibleMass = this.heldType === 'bubble_gum' ? 0.02 : item ? itemMass(item) : 0.02;
    const h = this.heaviness(visibleMass);
    const baseX = LIGHT_X + (HEAVY_X - LIGHT_X) * h;
    const baseY = LIGHT_Y + (HEAVY_Y - LIGHT_Y) * h;
    const baseZ = -(HOLD_DIST_LIGHT + (HOLD_DIST_HEAVY - HOLD_DIST_LIGHT) * h);

    // Gentle idle sway.
    let ox = Math.sin(t * 0.9) * SWAY_X;
    let oy = Math.sin(t * 1.3 + 1.0) * SWAY_Y;
    let oz = 0;
    let pitch = Math.sin(t * 1.1 + 2.0) * SWAY_PITCH;
    let roll = Math.sin(t * 0.6) * SWAY_ROLL;
    let yaw = 0;

    // Walking bob, frozen at rest.
    const mag = opts.moveMag > 0 ? (opts.moveMag > 1 ? 1 : opts.moveMag) : 0;
    if (mag > 1e-3) {
      this.bobPhase += d * WALK_FREQ;
      oy += Math.sin(this.bobPhase) * WALK_BOB * mag;
      ox += Math.cos(this.bobPhase * 0.5) * WALK_SWAY * mag;
      roll += Math.sin(this.bobPhase) * WALK_ROLL * mag;
    }

    // Use animation, per item type. Gum is driven by the full use action rather
    // than the mouse being held: a click completes one deliberate mouth cycle.
    const use = opts.usePrimary;
    if (this.heldType === 'bubble_gum') {
      const gumProgress = opts.gumUseProgress;
      let pieceCount = item?.type === 'bubble_gum' ? item.charges : 0;
      if (gumProgress >= 0 && gumProgress <= 1) {
        pieceCount = opts.gumCharges + (gumProgress < GUM_DETACH_T ? 1 : 0);
        const rawReach =
          gumProgress < GUM_DETACH_T
            ? gumProgress / GUM_DETACH_T
            : (1 - gumProgress) / (1 - GUM_DETACH_T);
        const clampedReach = Math.max(0, Math.min(1, rawReach));
        const reach = clampedReach * clampedReach * (3 - 2 * clampedReach);
        ox += (GUM_MOUTH_X - baseX) * reach;
        oy += (GUM_MOUTH_Y - baseY) * reach;
        oz += (GUM_MOUTH_Z - baseZ) * reach;
        roll += GUM_MOUTH_ROLL * reach;
      }
      setBubbleGumPieceCount(this.mesh, pieceCount);
    } else if (item?.type === 'binoculars') {
      this.useT = ramp(this.useT, use, USE_RAMP * 1.5, d);
      // Once the ocular mask is live the physical model is behind the player's
      // eyes; drawing its barrels over the magnified view is both wrong and noisy.
      this.mesh.visible = !use;
      pitch -= TILT_PITCH;
      yaw += Math.PI - TILT_YAW;
      roll -= TILT_ROLL;
    } else if (item?.type === 'torchlight') {
      this.useT = ramp(this.useT, use, USE_RAMP, d);
      // Item primitives point down local +Z; camera forward is local -Z.
      pitch -= TILT_PITCH;
      yaw += Math.PI - TILT_YAW;
      roll -= TILT_ROLL;
      oy += this.useT * 0.035;
      pitch += this.useT * 0.08;
    } else if (item?.type === 'tool') {
      this.useT = ramp(this.useT, use, USE_RAMP, d);
      if (item.tool === 'brush' || item.tool === 'sponge') {
        // A visible back-and-forth scrubbing stroke.
        if (use) this.scrubPhase += d * SCRUB_FREQ;
        const stroke = Math.sin(this.scrubPhase) * this.useT;
        ox += stroke * SCRUB_AMP;
        roll += stroke * SCRUB_ROLL;
      } else {
        // Wrench: a quick working twist.
        if (use) this.scrubPhase += d * 9;
        roll += Math.sin(this.scrubPhase) * 0.12 * this.useT;
      }
    } else if (item?.type === 'fluid_can') {
      // Tip forward and pour, with a slight slosh.
      this.useT = ramp(this.useT, use, USE_RAMP, d);
      const pour = this.useT;
      pitch += -pour * POUR_ANGLE;
      oy += pour * POUR_LIFT;
      if (pour > 0.01) this.scrubPhase += d * 10;
      roll += Math.sin(this.scrubPhase) * 0.02 * pour;
    } else if (item?.type === 'weapon') {
      // Recoil kick: once on the trigger edge, then once per shot cycle.
      if (use && item.loaded > 0) {
        if (!this.prevUse || this.shotClock >= item.cycleTime) {
          this.recoil = 1;
          this.shotClock = 0;
        }
        this.shotClock += d;
      }
      this.recoil = Math.max(0, this.recoil - d * RECOIL_DECAY);
      const kick = this.recoil;
      oz += kick * RECOIL_BACK;
      pitch += -kick * RECOIL_PITCH;
      oy += kick * RECOIL_LIFT;
    }
    this.prevUse = use;

    this.hand.position.set(baseX + ox, baseY + oy, baseZ + oz);
    _eul.set(TILT_PITCH + pitch, TILT_YAW + yaw, TILT_ROLL + roll);
    this.hand.quaternion.setFromEuler(_eul);
  }

  dispose(): void {
    this.clearMesh();
    this.scene.remove(this.root);
  }

  /* ---- internals ---- */

  private rebuild(item: Item): void {
    this.clearMesh();

    const mesh = createItemMesh(item);
    // A filthy part must look filthy in your hands, not just when bolted on.
    if (item.type === 'part') setPartCondition(mesh, item.part);

    // A viewmodel must neither cast onto the world nor receive the sun's shadow
    // map (which would read as a floating smudge).
    mesh.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = false;
        m.receiveShadow = false;
      }
    });

    // Centre the item on its bounding box, then scale it so the longest axis
    // lands at a saturating target: small items keep near-natural size, large
    // ones read bulky without filling the screen.
    _box.setFromObject(mesh);
    const size = _box.getSize(_size);
    const maxDim = Math.max(size.x, size.y, size.z);
    const target =
      maxDim > 0 ? TARGET_MAX * (1 - Math.exp(-maxDim / TARGET_TAU)) : TARGET_MAX * 0.5;
    const scale = maxDim > 0 ? target / maxDim : 1;
    const centre = _box.getCenter(_centre);
    // Three.js applies scale before the object's position, so the centring
    // offset must be scaled too for the box centre to land on the hand origin.
    mesh.position.copy(centre).multiplyScalar(-scale);
    mesh.scale.multiplyScalar(scale);

    this.hand.add(mesh);
    this.mesh = mesh;
    this.heldType = item.type;
    this.heldId = item.id;
  }

  private clearMesh(): void {
    if (!this.mesh) return;
    this.mesh.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) {
        // Dispose only the per-instance condition materials. Flat materials are
        // shared (materials.ts cache) and geometry is partmesh's shared cache.
        if (mat.customProgramCacheKey() === CONDITION_PROGRAM_KEY) mat.dispose();
      }
    });
    this.hand.remove(this.mesh);
    this.mesh = null;
    this.heldType = null;
    this.heldId = null;
  }

  private resetMotion(): void {
    this.useT = 0;
    this.recoil = 0;
    this.shotClock = 0;
    this.prevUse = false;
  }

  private heaviness(mass: number): number {
    const m = Math.log(mass > 1 ? mass : 1);
    const h = (m - MASS_LOG_MIN) / (MASS_LOG_MAX - MASS_LOG_MIN);
    return h < 0 ? 0 : h > 1 ? 1 : h;
  }
}
