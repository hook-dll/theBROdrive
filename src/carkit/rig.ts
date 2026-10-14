/**
 * The kit car's moving parts at run time.
 *
 * A kit model tags its nodes instead of naming them in code:
 *
 *  - `userData.kitMotion` on a node that moves: a CHANNEL (a number) drives it, as a
 *    turn about an axis or a slide along one, in the node's own parent frame, from the
 *    pose it was built in, or as a drop pane winding down into its door (`sink`);
 *  - `userData.kitControl` on a node a player can click: what the click does to which
 *    channel. A click on any mesh below it counts.
 *
 * Channels ease towards their targets, so a door swings and a needle sweeps. Some
 * channels are derived every frame from others (the wipers' sweep from their switch,
 * the gear lever's two axes from the gear), and the lamp lenses are lit from the
 * light switch, the stalk, the hazard button and the pedals. A cluster's warning lamp
 * and the courtesy lamp are lit faces slid out from behind a dark lens (interior.ts).
 */

import * as THREE from 'three';
import { KIT_LAMP_NODES } from './names';

export interface KitMotion {
  readonly channel: string;
  /**
   * `rot` turns about `axis`, `pos` slides along it. `sink` is a drop pane winding down
   * into its door (`SinkingPane`): `axis` is unused and `amount` is the share of the
   * pane's height it travels at a channel value of 1.
   */
  readonly kind: 'rot' | 'pos' | 'sink';
  /** Axis in the node's parent frame. */
  readonly axis: readonly [number, number, number];
  /** Radians or metres per unit of channel value; for `sink`, a share of the height. */
  readonly amount: number;
  /**
   * Channel values the part stops at, as a needle at its pins: the value is clamped to
   * them, and the pose it was built in is at the first. Absent: no stops, built at 0.
   */
  readonly stops?: readonly [number, number];
}

export type KitAction =
  | { readonly type: 'toggle'; readonly channel: string }
  | { readonly type: 'cycle'; readonly channel: string; readonly values: readonly number[] }
  | { readonly type: 'press'; readonly channel: string }
  /**
   * A part turned by hand on two axes (the inside mirror): held, the mouse turns it
   * (`KitRig.aim`); `channel` is the up-down axis, `yaw` the side-to-side one, each held
   * within ±`limit`.
   */
  | { readonly type: 'aim'; readonly channel: string; readonly yaw: string; readonly limit: number };

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

/**
 * Channels that follow their target at once (driving inputs, read out by gauges). The
 * speedometer and tachometer are here as the HUD's dials are: they are fed in km/h and
 * rpm, and an ease of a few units a second left them minutes behind the car. A warning
 * lamp (`tell_*`) and the courtesy lamp light as they are switched; the inside mirror
 * (`mirror_*`) turns under the hand.
 */
const INSTANT = /^(steer|throttle|brake|clutch|handbrake|gear_fb|gear_lr|wiper_sweep|speed|rpm|dome|panel|mirror_\w+|tell_\w+)$/;
/** Ease rate per channel prefix, units per second. */
const RATE: readonly [RegExp, number][] = [
  [/^door_|^boot|^tailgate|^bonnet/, 1.6],
  [/^window_/, 0.45],
  [/^(fuel|temp)$/, 2.5],
  // Oil pressure (kgf/cm²) and the voltmeter (V): a damped needle crosses its dial in
  // about 0.3 s. The economy meter's 0..1 takes the default.
  [/^(oil|volts)$/, 20],
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
  /** A `sink` part's panes (its glass meshes); empty for every other motion. */
  readonly panes: readonly SinkingPane[];
  /** The channel value the node was last posed at: a still part is not posed again. */
  applied: number;
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

/**
 * Groups a far car stops drawing: the cabin, the engine bay, the boot and the underbody.
 * The mid and far traffic meshes leave them out too (render/farcars.ts `collectPieces`).
 */
export const KIT_DETAIL_GROUPS: ReadonlySet<string> = new Set(['kit_cabin', 'kit_bay', 'kit_boot', 'kit_under']);
/**
 * Clear glass opacity near, and the tinted mirror it stands in for far away: opaque, as the
 * mid and far meshes' glass is, so nothing behind it shows when the cabin stops drawing.
 */
const GLASS_NEAR_OPACITY = 0.28;
const GLASS_FAR_OPACITY = 1;
/**
 * The glass seen from inside its own car: the world through it as if it were hardly
 * there. Not zero, so a pane still shows a glint of the sky and its dust.
 */
const GLASS_INSIDE_OPACITY = 0.05;
/**
 * The glass stays clear to `GLASS_CLEAR_M` from the eye and fades to the opaque mirror by
 * `GLASS_MIRROR_M`, inside `KIT_DETAIL_M`, where the cabin, bay, boot and underbody stop
 * drawing behind it. One 25 m step did both at once: the panes of a passing car went from
 * mirror to clear in one frame, a few car lengths away, in plain sight. A pane still 0.9
 * opaque at `KIT_DETAIL_M` let a tenth of the seats show and vanish there, and a car caught
 * up with slowly showed its seats at 45 m where at 55 m (mid traffic) it had none; behind
 * an opaque pane from 45 m the cabin comes and goes unseen.
 */
const GLASS_CLEAR_M = 30;
const GLASS_MIRROR_M = 45;
export const KIT_DETAIL_M = 50;
/**
 * The cabin's fine detail (`userData.kitFine`, context.ts `fineDetail`: needles, dial
 * faces, warning lamps, switches, knobs, stalks, horn pad, pedals, levers, cranks, door
 * handles and lock knobs, visors, the courtesy lamp, glovebox and ashtray) draws only with
 * the eye in this car, for the car the player sits in, or within this distance of the
 * car's centre. A player at the open driver's door (1.5 m out) stands about 2.7 m from
 * the centre, one at the side window (3 m out) about 4 m. Past 6 m a 1 cm warning lamp
 * covers under two pixels and a 3 mm needle half of one (65° over 1080 px), behind a
 * pane at 0.28 opacity. From 8 m, car-lab renders (2026-10-15) showed only single-pixel
 * specks going; the inside mirror, which stood black against the screen, stays coarse
 * for that. The coarse cabin (lining, dash and console bodies, seats, bench, wheel
 * rim, door cards, mirror) still draws to `KIT_DETAIL_M`, with a stand-in in every window
 * and dial the fine faces fill (interior.ts `WINDOW_FILL`).
 */
export const KIT_FINE_M = 6;
/**
 * The glass's opacity seen from `distance` m outside the car: clear to `GLASS_CLEAR_M`,
 * then fading to the opaque mirror at `GLASS_MIRROR_M`. Rounded to a hundredth, below what
 * the eye resolves on a pane, so a moving eye does not write it every frame.
 */
export function kitGlassOpacity(distance: number): number {
  const t = Math.min(Math.max((distance - GLASS_CLEAR_M) / (GLASS_MIRROR_M - GLASS_CLEAR_M), 0), 1);
  return Math.round((GLASS_NEAR_OPACITY + (GLASS_FAR_OPACITY - GLASS_NEAR_OPACITY) * t) * 100) / 100;
}
/**
 * The shell's own moving parts (carkit/kit.ts `shellMotion`): doors, their panes and vent
 * wings, the bonnet, boot or tailgate and the filler flap. With any of them off its stop
 * the car is not in the pose the mid traffic meshes were baked in (render/farcars.ts).
 */
const SHELL_CHANNEL = /^(door_|window_|vent_|bonnet$|boot$|tailgate$|flap$)/;

const _q = new THREE.Quaternion();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _ab = new THREE.Vector3();
const _ac = new THREE.Vector3();

/** Where a drop pane's shut geometry is kept while it draws a cut copy (render/stickerdecals.ts). */
export const KIT_SHUT_GEOMETRY = 'kitShutGeometry';

/**
 * A drop pane winding down into its door. It slides in its own plane, square to its
 * bottom edge (where the glass meets the door's top), and nothing of it is drawn below
 * that edge: the part still showing is cut out of the shut pane on the CPU each time the
 * channel moves, into a copy of the geometry this car alone owns, made the first time
 * the pane moves. The cut carries every attribute the pane has (dust, the body stamp),
 * so it draws with the same program.
 *
 * A straight drop brought the top of a pane leaning in with the greenhouse down 5 cm
 * inside the door card, into the cabin.
 */
class SinkingPane {
  private readonly source: THREE.BufferGeometry;
  /** The shut pane's attributes, and this car's cut copy of each (`own`, made on first move). */
  private readonly from: THREE.BufferAttribute[];
  private to: THREE.BufferAttribute[] = [];
  private own: THREE.BufferGeometry | null = null;
  /** A point of the bottom edge and the pane's up, in the mesh's frame. */
  private readonly base = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  /** Metres from the bottom edge to the pane's highest point along `up`. */
  private readonly height: number;
  /** Signed heights above the cut of one triangle's corners, and the cut polygon (from, to, t). */
  private readonly side = new Float64Array(3);
  private readonly cutFrom = new Int32Array(4);
  private readonly cutTo = new Int32Array(4);
  private readonly cutT = new Float64Array(4);

  constructor(readonly mesh: THREE.Mesh) {
    this.source = mesh.geometry;
    mesh.userData[KIT_SHUT_GEOMETRY] = this.source;
    this.from = Object.values(this.source.attributes) as THREE.BufferAttribute[];
    const position = this.source.getAttribute('position');
    const normal = new THREE.Vector3();
    for (let i = 0; i + 2 < position.count; i += 3) {
      _a.fromBufferAttribute(position, i);
      _b.fromBufferAttribute(position, i + 1);
      _c.fromBufferAttribute(position, i + 2);
      normal.add(_ab.subVectors(_b, _a).cross(_ac.subVectors(_c, _a)));
    }
    normal.normalize();
    // Up in the pane's plane, then the bottom edge: the ends of the pane's lowest quarter.
    const guess = new THREE.Vector3(0, 1, 0).addScaledVector(normal, -normal.y).normalize();
    const along = new THREE.Vector3().crossVectors(guess, normal).normalize();
    let low = Infinity;
    let high = -Infinity;
    for (let i = 0; i < position.count; i++) {
      const h = _a.fromBufferAttribute(position, i).dot(guess);
      low = Math.min(low, h);
      high = Math.max(high, h);
    }
    const cut = low + (high - low) * 0.25;
    const first = new THREE.Vector3();
    const last = new THREE.Vector3();
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < position.count; i++) {
      _a.fromBufferAttribute(position, i);
      if (_a.dot(guess) > cut) continue;
      const s = _a.dot(along);
      if (s < min) (min = s), first.copy(_a);
      if (s > max) (max = s), last.copy(_a);
    }
    const edge = _ab.subVectors(last, first).normalize();
    this.up.crossVectors(normal, edge).normalize();
    if (this.up.dot(guess) < 0) this.up.negate();
    this.base.copy(first);
    let height = 0;
    for (let i = 0; i < position.count; i++) height = Math.max(height, _a.fromBufferAttribute(position, i).sub(this.base).dot(this.up));
    this.height = height;
  }

  /** Lowers the pane by `share` of its height (0 shut, 1 gone into the door). */
  pose(share: number): void {
    const drop = Math.min(1, Math.max(0, share)) * this.height;
    if (drop <= 0) {
      this.mesh.geometry = this.source;
      this.mesh.visible = true;
      return;
    }
    if (drop >= this.height) {
      this.mesh.visible = false;
      return;
    }
    this.mesh.visible = true;
    const own = this.own ?? (this.own = this.copy());
    this.mesh.geometry = own;
    const position = this.source.getAttribute('position');
    let out = 0;
    for (let t = 0; t + 2 < position.count; t += 3) {
      for (let k = 0; k < 3; k++) this.side[k] = _a.fromBufferAttribute(position, t + k).sub(this.base).dot(this.up) - drop;
      // Sutherland-Hodgman against the bottom edge: at most four corners, fanned.
      let n = 0;
      for (let k = 0; k < 3; k++) {
        const next = (k + 1) % 3;
        const here = this.side[k]!;
        const there = this.side[next]!;
        if (here >= 0) {
          this.cutFrom[n] = t + k;
          this.cutTo[n] = t + k;
          this.cutT[n++] = 0;
        }
        if (here >= 0 !== there >= 0) {
          this.cutFrom[n] = t + k;
          this.cutTo[n] = t + next;
          this.cutT[n++] = here / (here - there);
        }
      }
      for (let f = 1; f + 1 < n; f++) {
        this.emit(0, out++, drop);
        this.emit(f, out++, drop);
        this.emit(f + 1, out++, drop);
      }
    }
    own.setDrawRange(0, out);
    for (const attribute of this.to) attribute.needsUpdate = true;
  }

  /** Writes corner `corner` of the cut polygon as vertex `out`, lowered by `drop`. */
  private emit(corner: number, out: number, drop: number): void {
    const from = this.cutFrom[corner]!;
    const to = this.cutTo[corner]!;
    const w = this.cutT[corner]!;
    for (let i = 0; i < this.from.length; i++) {
      const src = this.from[i]!;
      const dst = this.to[i]!;
      for (let c = 0; c < src.itemSize; c++) dst.setComponent(out, c, src.getComponent(from, c) * (1 - w) + src.getComponent(to, c) * w);
    }
    const p = this.own!.getAttribute('position') as THREE.BufferAttribute;
    p.setXYZ(out, p.getX(out) - this.up.x * drop, p.getY(out) - this.up.y * drop, p.getZ(out) - this.up.z * drop);
  }

  /** This car's own copy: room for every triangle cut into two. */
  private copy(): THREE.BufferGeometry {
    const own = new THREE.BufferGeometry();
    const names = Object.keys(this.source.attributes);
    this.to = this.from.map((src, i) => {
      const array = new (src.array.constructor as new (length: number) => THREE.TypedArray)(src.count * 2 * src.itemSize);
      const dst = new THREE.BufferAttribute(array, src.itemSize, src.normalized).setUsage(THREE.DynamicDrawUsage);
      own.setAttribute(names[i]!, dst);
      return dst;
    });
    own.boundingBox = this.source.boundingBox?.clone() ?? null;
    own.boundingSphere = this.source.boundingSphere?.clone() ?? null;
    return own;
  }

  dispose(): void {
    this.mesh.geometry = this.source;
    this.own?.dispose();
    this.own = null;
  }
}


/**
 * A kit body nobody drives or opens (a wreck, a courier: render/carmodel.ts
 * `cloneStaticModel`) is built once in the far pose of `KitRig.setDetail`: no cabin,
 * bay, boot or underbody, glass a tinted mirror. Same materials, so no new program.
 */
export function poseKitStatic(root: THREE.Object3D): void {
  root.traverse((node) => {
    if (KIT_DETAIL_GROUPS.has(node.name)) node.visible = false;
    if (node instanceof THREE.Mesh && node.material instanceof THREE.MeshStandardMaterial && node.material.name === 'car-glass-clear') {
      node.material.opacity = GLASS_FAR_OPACITY;
    }
  });
}

export class KitRig {
  private readonly driven: Driven[] = [];
  private readonly channels = new Map<string, Channel>();
  private readonly lenses = new Map<LensRole, THREE.MeshStandardMaterial[]>();
  private time = 0;
  /**
   * Cycles the wipers have run. Not a channel: a channel eases towards its target, and
   * this one was pulled back to 0 faster than it ran, so the arms never left their park.
   */
  private wiperPhase = 0;
  private near: boolean | null = null;
  private fineShown: boolean | null = null;
  private glassOpacity = -1;
  private readonly detail: THREE.Object3D[] = [];
  /** The cabin's fine detail (`KIT_FINE_M`). */
  private readonly fine: THREE.Object3D[] = [];
  private readonly glass: THREE.MeshStandardMaterial[] = [];
  /** Names of the shell's moving parts' channels (`SHELL_CHANNEL`); `adopt` replaces the channels themselves. */
  private readonly shell: string[] = [];
  /** The live mirror faces (`userData.kitMirror`), shown by render/carmirrors.ts. */
  readonly mirrorFaces: THREE.Mesh[] = [];

  /** `ownLenses` gives this car its own lens materials (the lab; a Vehicle binds its own). */
  constructor(root: THREE.Object3D, ownLenses = true) {
    root.traverse((node) => {
      if (KIT_DETAIL_GROUPS.has(node.name)) this.detail.push(node);
      if (node.userData.kitFine) this.fine.push(node);
      if (node instanceof THREE.Mesh && node.material instanceof THREE.MeshStandardMaterial && node.material.name === 'car-glass-clear') {
        if (!this.glass.includes(node.material)) this.glass.push(node.material);
      }
      if (node instanceof THREE.Mesh && node.userData.kitMirror) this.mirrorFaces.push(node);
      const motion = node.userData.kitMotion as KitMotion | undefined;
      if (!motion) return;
      this.driven.push({
        node,
        motion,
        restPosition: node.position.clone(),
        restQuaternion: node.quaternion.clone(),
        axis: new THREE.Vector3(...motion.axis).normalize(),
        panes:
          motion.kind === 'sink'
            ? node.children.filter((child): child is THREE.Mesh => child instanceof THREE.Mesh).map((mesh) => new SinkingPane(mesh))
            : [],
        applied: Number.NaN,
      });
      this.channel(motion.channel);
      if (SHELL_CHANNEL.test(motion.channel) && !this.shell.includes(motion.channel)) this.shell.push(motion.channel);
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
   * Detail by the eye's distance (m): within `KIT_DETAIL_M` the cabin, bay, boot and
   * underbody draw, and the glass fades from clear (to `GLASS_CLEAR_M`) to the tinted
   * mirror; beyond, none of them draw. The cabin's fine detail draws only within
   * `KIT_FINE_M`, or with `inside` or `occupied`. `inside` (the eye in this car's cabin)
   * leaves the glass all but clear (`GLASS_INSIDE_OPACITY`); `occupied` (the car the
   * player sits in, seen from any camera) keeps the fine detail. Only uniforms and
   * visibility change, so crossing a line links no program. Hidden parts are still posed
   * every `update`, so they come back in their current pose.
   */
  setDetail(distance: number, inside = false, occupied = false): void {
    const near = distance < KIT_DETAIL_M;
    const fine = inside || occupied || distance < KIT_FINE_M;
    const opacity = inside ? GLASS_INSIDE_OPACITY : kitGlassOpacity(distance);
    if (near === this.near && fine === this.fineShown && opacity === this.glassOpacity) return;
    if (near !== this.near) {
      this.near = near;
      for (const node of this.detail) node.visible = near;
    }
    if (fine !== this.fineShown) {
      this.fineShown = fine;
      for (const node of this.fine) node.visible = fine;
    }
    this.glassOpacity = opacity;
    for (const material of this.glass) material.opacity = opacity;
  }

  /** Every door, pane, lid and flap shut and staying so: the shell's baked pose. */
  get shut(): boolean {
    for (const name of this.shell) {
      const c = this.channels.get(name);
      if (c && (c.value !== 0 || c.target !== 0)) return false;
    }
    return true;
  }

  private channel(name: string): Channel {
    let c = this.channels.get(name);
    if (!c) this.channels.set(name, (c = { value: 0, target: 0 }));
    return c;
  }

  get(name: string): number {
    return this.channels.get(name)?.target ?? 0;
  }

  /** Where a channel stands now, on its way to `get`'s target. */
  position(name: string): number {
    return this.channels.get(name)?.value ?? 0;
  }

  set(name: string, value: number, immediate = false): void {
    const c = this.channel(name);
    c.target = value;
    if (immediate || INSTANT.test(name)) c.value = value;
  }

  /**
   * Takes over another rig's channels (a Vehicle rebuilding its visuals after a part
   * swap): an open bonnet stays open, the lights stay on. Parts are posed next update.
   */
  adopt(other: KitRig): void {
    for (const [name, c] of other.channels) this.channels.set(name, { value: c.value, target: c.target });
    this.time = other.time;
    this.wiperPhase = other.wiperPhase;
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
    } else if (action.type === 'press') {
      this.set(action.channel, 1);
    }
    // `aim` is worked by `aim`, not by a click.
  }

  /** Turns an `aim` control by `dYaw` and `dPitch` channel units, each held within its limit. */
  aim(control: KitControl, dYaw: number, dPitch: number): void {
    const action = control.action;
    if (action?.type !== 'aim') return;
    const hold = (v: number): number => Math.min(action.limit, Math.max(-action.limit, v));
    this.set(action.yaw, hold(this.get(action.yaw) + dYaw));
    this.set(action.channel, hold(this.get(action.channel) + dPitch));
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
      this.wiperPhase += dt * hz;
      this.set('wiper_sweep', 0.5 - 0.5 * Math.cos(this.wiperPhase * Math.PI * 2));
    } else {
      // Park: finish the stroke and stay down; switched on again, the arms rise from where they are.
      const sweep = this.channel('wiper_sweep');
      sweep.value = Math.max(0, sweep.value - dt * 1.5);
      sweep.target = sweep.value;
      this.wiperPhase = Math.acos(1 - 2 * sweep.value) / (Math.PI * 2);
    }
    // A radio that is on shows it: the needle drifts along the band.
    if (this.get('radio') > 0.5) this.set('radio_tune', 0.5 + 0.4 * Math.sin(this.time * 0.15));
    // The instrument lighting is on whenever the light switch is: dipped or main beam.
    this.set('panel', this.get('lights') >= 1 ? 1 : 0);

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
      const raw = this.channels.get(d.motion.channel)?.value ?? 0;
      const stops = d.motion.stops;
      const v = stops ? Math.min(stops[1], Math.max(stops[0], raw)) - stops[0] : raw;
      // Stickers on a pane hang under it (render/stickerdecals.ts) and cannot be cut with
      // it: they are folded away while it is down, every frame, so one printed meanwhile
      // does not show in the air.
      if (v > 0 && d.panes.length > 0) for (const child of d.node.children) if (!this.isPane(d, child)) child.scale.setScalar(0);
      if (v === d.applied) continue;
      d.applied = v;
      if (d.motion.kind === 'rot') {
        d.node.quaternion.copy(d.restQuaternion).multiply(_q.setFromAxisAngle(d.axis, d.motion.amount * v));
      } else if (d.motion.kind === 'sink') {
        for (const pane of d.panes) pane.pose(d.motion.amount * v);
        if (v === 0) for (const child of d.node.children) if (!this.isPane(d, child)) child.scale.setScalar(1);
      } else {
        d.node.position.copy(d.restPosition).addScaledVector(d.axis, d.motion.amount * v);
      }
    }
    this.applyLamps();
  }

  private isPane(d: Driven, node: THREE.Object3D): boolean {
    for (const pane of d.panes) if (pane.mesh === node) return true;
    return false;
  }

  /** Frees what this car alone owns (cut panes) and puts the shut panes back. */
  dispose(): void {
    for (const d of this.driven) for (const pane of d.panes) pane.dispose();
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
