/**
 * The kit car's moving parts at run time.
 *
 * A kit model tags its nodes instead of naming them in code:
 *
 *  - `userData.kitMotion` on a node that moves: a CHANNEL (a number) drives it, as a
 *    turn about an axis or a slide along one, in the node's own parent frame, from the
 *    pose it was built in;
 *  - `userData.kitControl` on a node a player can click: what the click does to which
 *    channel. A click on any mesh below it counts.
 *
 * Channels ease towards their targets, so a door swings and a needle sweeps. Some
 * channels are derived every frame from others (the wipers' sweep from their switch,
 * the gear lever's two axes from the gear), and the lamp lenses are lit from the
 * light switch, the stalk, the hazard button and the pedals.
 */

import * as THREE from 'three';
import { KIT_LAMP_NODES } from './names';

export interface KitMotion {
  readonly channel: string;
  readonly kind: 'rot' | 'pos';
  /** Axis in the node's parent frame. */
  readonly axis: readonly [number, number, number];
  /** Radians or metres per unit of channel value. */
  readonly amount: number;
}

export type KitAction =
  | { readonly type: 'toggle'; readonly channel: string }
  | { readonly type: 'cycle'; readonly channel: string; readonly values: readonly number[] }
  | { readonly type: 'press'; readonly channel: string };

export interface KitControl {
  readonly id: string;
  /** Shown on hover. */
  readonly label: string;
  /** Defaults to toggling the channel named `id`. */
  readonly action?: KitAction;
}

/** A control and the node that carries it. */
export interface KitPicked {
  readonly node: THREE.Object3D;
  readonly control: KitControl;
}

/** Channels that follow their target at once (driving inputs, read out by gauges). */
const INSTANT = new Set(['steer', 'throttle', 'brake', 'clutch', 'handbrake', 'gear_fb', 'gear_lr', 'wiper_sweep']);
/** Ease rate per channel prefix, units per second. */
const RATE: readonly [RegExp, number][] = [
  [/^door_|^boot|^tailgate|^bonnet/, 1.6],
  [/^window_/, 0.45],
  [/^(speed|rpm|fuel|temp)$/, 2.5],
  [/^horn|^hazard_button/, 12],
];

/** H-pattern: gear -> [fore/aft, across]; R is beyond fifth on the Lada boxes. */
const GEAR_GATE: Readonly<Record<number, readonly [number, number]>> = {
  [-1]: [-1, 1.6],
  0: [0, 0],
  1: [1, -1],
  2: [-1, -1],
  3: [1, 0],
  4: [-1, 0],
  5: [1, 1],
};

const BLINK_PERIOD_S = 2 / 3;

interface Driven {
  readonly node: THREE.Object3D;
  readonly motion: KitMotion;
  readonly restPosition: THREE.Vector3;
  readonly restQuaternion: THREE.Quaternion;
  readonly axis: THREE.Vector3;
}

interface Channel {
  value: number;
  target: number;
}

type LensRole = 'head' | 'tail' | 'brake' | 'reverse' | 'blink_l' | 'blink_r';

const LENS_NODES: Readonly<Record<LensRole, string>> = {
  head: KIT_LAMP_NODES.lamp_head,
  tail: KIT_LAMP_NODES.lamp_tail,
  brake: KIT_LAMP_NODES.lamp_brake,
  reverse: KIT_LAMP_NODES.lamp_reverse,
  blink_l: KIT_LAMP_NODES.lamp_blinker_l,
  blink_r: KIT_LAMP_NODES.lamp_blinker_r,
};
const LENS_EMISSIVE: Readonly<Record<LensRole, number>> = {
  head: 0xffffff,
  tail: 0xff1a0a,
  brake: 0xff1a0a,
  reverse: 0xf4f7ff,
  blink_l: 0xff8a00,
  blink_r: 0xff8a00,
};

/** Groups a far car stops drawing: the cabin, the engine bay, the boot and the underbody. */
const DETAIL_GROUPS = new Set(['kit_cabin', 'kit_bay', 'kit_boot', 'kit_under']);
/** Clear glass opacity near, and the tinted mirror it stands in for far away. */
const GLASS_NEAR_OPACITY = 0.28;
const GLASS_FAR_OPACITY = 0.9;

const _q = new THREE.Quaternion();

export class KitRig {
  private readonly driven: Driven[] = [];
  private readonly channels = new Map<string, Channel>();
  private readonly lenses = new Map<LensRole, THREE.MeshStandardMaterial[]>();
  private time = 0;
  private near: boolean | null = null;
  private readonly detail: THREE.Object3D[] = [];
  private readonly glass: THREE.MeshStandardMaterial[] = [];

  /** `ownLenses` gives this car its own lens materials (the lab; a Vehicle binds its own). */
  constructor(root: THREE.Object3D, ownLenses = true) {
    root.traverse((node) => {
      if (DETAIL_GROUPS.has(node.name)) this.detail.push(node);
      if (node instanceof THREE.Mesh && node.material instanceof THREE.MeshStandardMaterial && node.material.name === 'car-glass-clear') {
        if (!this.glass.includes(node.material)) this.glass.push(node.material);
      }
      const motion = node.userData.kitMotion as KitMotion | undefined;
      if (!motion) return;
      this.driven.push({
        node,
        motion,
        restPosition: node.position.clone(),
        restQuaternion: node.quaternion.clone(),
        axis: new THREE.Vector3(...motion.axis).normalize(),
      });
      this.channel(motion.channel);
    });
    if (!ownLenses) return;
    for (const role of Object.keys(LENS_NODES) as LensRole[]) {
      const list: THREE.MeshStandardMaterial[] = [];
      root.traverse((node) => {
        if (!(node instanceof THREE.Mesh) || node.name !== LENS_NODES[role]) return;
        const source = node.material as THREE.MeshStandardMaterial;
        const own = source.clone();
        own.emissive.setHex(LENS_EMISSIVE[role]);
        own.emissiveIntensity = 0;
        node.material = own;
        list.push(own);
      });
      this.lenses.set(role, list);
    }
  }

  /**
   * Near: the cabin, bay, boot and underbody draw, and the glass is clear. Far: none of
   * them draw and the glass is a tinted mirror. Only uniforms and visibility change, so
   * crossing the line links no program.
   */
  setDetail(near: boolean): void {
    if (near === this.near) return;
    this.near = near;
    for (const node of this.detail) node.visible = near;
    for (const material of this.glass) material.opacity = near ? GLASS_NEAR_OPACITY : GLASS_FAR_OPACITY;
  }

  private channel(name: string): Channel {
    let c = this.channels.get(name);
    if (!c) this.channels.set(name, (c = { value: 0, target: 0 }));
    return c;
  }

  get(name: string): number {
    return this.channels.get(name)?.target ?? 0;
  }

  set(name: string, value: number, immediate = false): void {
    const c = this.channel(name);
    c.target = value;
    if (immediate || INSTANT.has(name)) c.value = value;
  }

  /** The control a picked object belongs to, if any. */
  static controlOf(object: THREE.Object3D | null): KitPicked | null {
    for (let node = object; node; node = node.parent) {
      const control = node.userData.kitControl as KitControl | undefined;
      if (control) return { node, control };
    }
    return null;
  }

  /** Does what clicking the control does. */
  activate(control: KitControl): void {
    const action = control.action ?? { type: 'toggle', channel: control.id };
    if (action.type === 'toggle') {
      this.set(action.channel, this.get(action.channel) > 0.5 ? 0 : 1);
    } else if (action.type === 'cycle') {
      const at = action.values.indexOf(this.get(action.channel));
      this.set(action.channel, action.values[(at + 1) % action.values.length]!);
    } else {
      this.set(action.channel, 1);
    }
  }

  /** Releases a momentary control (the horn). */
  release(control: KitControl): void {
    if (control.action?.type === 'press') this.set(control.action.channel, 0);
  }

  update(dt: number): void {
    this.time += dt;
    // Derived channels.
    const gate = GEAR_GATE[Math.round(this.get('gear'))] ?? GEAR_GATE[0]!;
    this.set('gear_fb', gate[0]);
    this.set('gear_lr', gate[1]);
    const wipers = this.get('wipers');
    if (wipers > 0) {
      const hz = wipers > 1.5 ? 1.1 : 0.6;
      this.channel('wiper_phase').value += dt * hz;
      this.set('wiper_sweep', 0.5 - 0.5 * Math.cos(this.channel('wiper_phase').value * Math.PI * 2));
    } else {
      // Park: finish the stroke and stay down.
      const sweep = this.channel('wiper_sweep');
      sweep.value = Math.max(0, sweep.value - dt * 1.5);
      sweep.target = sweep.value;
      this.channel('wiper_phase').value = 0;
    }
    // A radio that is on shows it: the needle drifts along the band.
    if (this.get('radio') > 0.5) this.set('radio_tune', 0.5 + 0.4 * Math.sin(this.time * 0.15));

    for (const [name, c] of this.channels) {
      if (c.value === c.target) continue;
      let rate = 3;
      for (const [pattern, r] of RATE) {
        if (pattern.test(name)) {
          rate = r;
          break;
        }
      }
      const step = rate * dt;
      const delta = c.target - c.value;
      c.value = Math.abs(delta) <= step ? c.target : c.value + Math.sign(delta) * step;
    }

    for (const d of this.driven) {
      const v = this.channels.get(d.motion.channel)?.value ?? 0;
      if (d.motion.kind === 'rot') {
        d.node.quaternion.copy(d.restQuaternion).multiply(_q.setFromAxisAngle(d.axis, d.motion.amount * v));
      } else {
        d.node.position.copy(d.restPosition).addScaledVector(d.axis, d.motion.amount * v);
      }
    }
    this.applyLamps();
  }

  private applyLamps(): void {
    if (this.lenses.size === 0) return;
    const lights = this.get('lights');
    const stalk = this.get('blinker');
    const hazard = this.get('hazard') > 0.5;
    const on = (this.time % BLINK_PERIOD_S) < BLINK_PERIOD_S / 2;
    const left = on && (hazard || stalk < -0.5);
    const right = on && (hazard || stalk > 0.5);
    const glow = (role: LensRole, intensity: number): void => {
      for (const m of this.lenses.get(role) ?? []) m.emissiveIntensity = intensity;
    };
    glow('head', lights >= 2 ? 3.2 : lights >= 1 ? 2.2 : 0);
    glow('tail', lights >= 1 ? 0.9 : 0);
    glow('brake', this.get('brake') > 0.05 ? 3 : lights >= 1 ? 0.9 : 0);
    glow('reverse', this.get('gear') < 0 ? 2.4 : 0);
    glow('blink_l', left ? 2.6 : 0);
    glow('blink_r', right ? 2.6 : 0);
  }
}
