/**
 * A toilet's moving fixtures: door, washlet lid, flush button, water valve, plunger and
 * the dirt on the floor. One builder per kind, laid out on the cabin's plan
 * (geometry.ts `toiletLayout`), so every variant reuses the same mechanics.
 *
 * Like a kit car's controls (carkit/rig.ts), a fixture is one CHANNEL from 0 to 1 that
 * eases towards its target, and a pose function that writes the channel into node
 * transforms and visibility; nothing here builds geometry after construction. The node a
 * player would click carries `userData.toiletFixture` (a `ToiletFixtureControl`).
 */

import * as THREE from 'three';
import { makeFlatMaterial } from '../../render/materials';
import type { ToiletLayout } from './geometry';
import type { ToiletFixtureKind, ToiletVariant, ToiletVerb } from './types';

/** What a click on a fixture may do, on `userData.toiletFixture`. */
export interface ToiletFixtureControl {
  readonly kind: ToiletFixtureKind;
  /** Shown on hover. */
  readonly label: string;
  readonly verbs: readonly ToiletVerb[];
}

/** What each channel's 1 means: the door and lid open, the valve open, the button in, the plunger in the pan, the floor dirty. */
const CONTROLS: Readonly<Record<ToiletFixtureKind, Omit<ToiletFixtureControl, 'kind'>>> = {
  door: { label: 'Дверь', verbs: ['open', 'close'] },
  lid: { label: 'Крышка', verbs: ['open', 'close'] },
  flush: { label: 'Смыв', verbs: ['press'] },
  valve: { label: 'Вентиль', verbs: ['turn'] },
  plunger: { label: 'Вантуз', verbs: ['insert', 'pump', 'pull'] },
  'floor-dirt': { label: 'Грязь на полу', verbs: ['wipe'] },
};

/** Channel units a second. */
const RATES: Readonly<Record<ToiletFixtureKind, number>> = {
  door: 1.6,
  lid: 2.2,
  flush: 10,
  valve: 0.9,
  plunger: 2.5,
  'floor-dirt': 3,
};

const DOOR_SWING = 1.75;
const LID_SWING = 1.5;
const VALVE_TURN = 1.5 * Math.PI;
const BUTTON_TRAVEL = 0.008;
/** One wipe takes this much of the dirt. */
const WIPE_SHARE = 0.34;
/** A pump's bob, seconds. */
const PUMP_TIME = 0.45;

type Pose = (value: number, pump: number) => void;

function part(parent: THREE.Object3D, geometry: THREE.BufferGeometry, color: number, position: readonly [number, number, number], roughness = 0.7): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, makeFlatMaterial(color, roughness));
  mesh.position.set(position[0], position[1], position[2]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

/** Unit shapes for every fixture of every cabin; meshes scale them. */
const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
const UNIT_CYLINDER = new THREE.CylinderGeometry(1, 1, 1, 10);
const CUP = new THREE.CylinderGeometry(0.055, 0.075, 0.07, 10);

function sized(mesh: THREE.Mesh, x: number, y: number, z: number): THREE.Mesh {
  mesh.scale.set(x, y, z);
  return mesh;
}

/** One fixture's node and the function that poses it. */
function build(kind: ToiletFixtureKind, variant: ToiletVariant, layout: ToiletLayout): { node: THREE.Object3D; pose: Pose } {
  const node = new THREE.Group();
  switch (kind) {
    case 'door': {
      const { hingeX, hingeZ, width, height, bottomY } = layout.door;
      node.position.set(hingeX, bottomY, hingeZ);
      sized(part(node, UNIT_BOX, variant.shell.palette.door, [width / 2, height / 2, 0]), width, height, 0.04);
      for (const z of [-0.035, 0.035]) sized(part(node, UNIT_BOX, 0x8c8f90, [width - 0.08, 1.0, z], 0.4), 0.03, 0.14, 0.03);
      // Opens outward, so the cabin keeps its whole floor: +Y turns +X towards -Z.
      return { node, pose: (value) => { node.rotation.y = value * DOOR_SWING; } };
    }
    case 'lid': {
      const { x, z, rimY } = layout.bowl;
      node.position.set(x, rimY, z + 0.19);
      sized(part(node, UNIT_BOX, 0xe9e6dd, [0, 0.015, -0.21], 0.5), 0.38, 0.03, 0.42);
      return { node, pose: (value) => { node.rotation.x = value * LID_SWING; } };
    }
    case 'flush': {
      const [x, y, z] = layout.flush;
      node.position.set(x, y, z);
      const button = sized(part(node, UNIT_CYLINDER, 0x7aa6c8, [-0.01, 0, 0], 0.4), 0.035, 0.02, 0.035);
      button.rotation.z = Math.PI / 2;
      return { node, pose: (value) => { node.position.x = x + value * BUTTON_TRAVEL; } };
    }
    case 'valve': {
      const [x, y, z] = layout.valve;
      node.position.set(x, y, z);
      const wheel = sized(part(node, UNIT_CYLINDER, 0xb03028, [0, 0, 0], 0.5), 0.05, 0.016, 0.05);
      wheel.rotation.x = Math.PI / 2;
      sized(part(node, UNIT_BOX, 0x5a2420, [0, 0, -0.012], 0.5), 0.1, 0.014, 0.012);
      // Open (1) turns the wheel three quarters anticlockwise as seen from the room.
      return { node, pose: (value) => { node.rotation.z = -value * VALVE_TURN; } };
    }
    case 'plunger': {
      const { stowed, inUse } = layout.plunger;
      part(node, CUP, 0x8a2a20, [0, 0.035, 0], 0.6);
      sized(part(node, UNIT_CYLINDER, 0xb08a5a, [0, 0.38, 0], 0.8), 0.012, 0.62, 0.012);
      return {
        node,
        pose: (value, pump) => {
          node.position.set(
            THREE.MathUtils.lerp(stowed[0], inUse[0], value),
            THREE.MathUtils.lerp(stowed[1], inUse[1], value) - 0.05 * Math.abs(Math.sin((pump / PUMP_TIME) * Math.PI)),
            THREE.MathUtils.lerp(stowed[2], inUse[2], value),
          );
          // Stowed, it leans into the corner by the right wall.
          node.rotation.z = -0.12 * (1 - value);
        },
      };
    }
    case 'floor-dirt': {
      const { bowl, sink, inner, floorY } = layout;
      node.position.y = floorY;
      // Three wet patches, apart from each other: they lie in one plane.
      const patches = [
        sized(part(node, UNIT_BOX, 0x5a4a30, [bowl.x - 0.1, 0.004, bowl.frontZ - 0.25], 0.3), 0.5, 0.008, 0.4),
        sized(part(node, UNIT_BOX, 0x5a4a30, [bowl.x - 0.7, 0.004, bowl.frontZ - 0.6], 0.3), 0.34, 0.008, 0.26),
        sized(part(node, UNIT_BOX, 0x4c3e28, [sink.x, 0.004, inner.maxZ - 0.55], 0.3), 0.22, 0.008, 0.18),
      ];
      const sizes = patches.map((mesh) => mesh.scale.clone());
      return {
        node,
        pose: (value) => {
          patches.forEach((mesh, i) => {
            const size = sizes[i]!;
            mesh.visible = value > 0.02;
            mesh.scale.set(size.x * value, size.y, size.z * value);
          });
        },
      };
    }
  }
}

/** One fixture at run time: its channel, its node and its verbs. */
export class ToiletFixture {
  readonly node: THREE.Object3D;
  readonly control: ToiletFixtureControl;
  private value: number;
  private target: number;
  private pump = 0;
  private readonly pose: Pose;

  constructor(readonly kind: ToiletFixtureKind, variant: ToiletVariant, layout: ToiletLayout) {
    const built = build(kind, variant, layout);
    this.node = built.node;
    this.pose = built.pose;
    this.control = { kind, ...CONTROLS[kind] };
    this.node.name = `toilet-${kind}`;
    this.node.userData.toiletFixture = this.control;
    this.value = this.target = 0;
    this.pose(0, 0);
  }

  /** The channel now, 0..1. */
  get current(): number {
    return this.value;
  }

  /** Where the channel is heading. */
  get goal(): number {
    return this.target;
  }

  /** Sets where the channel heads, as a state's pose does. */
  setTarget(value: number): void {
    this.target = THREE.MathUtils.clamp(value, 0, 1);
  }

  /**
   * Applies one verb, or the fixture's toggle with none. False when the fixture does not
   * answer to the verb or it does nothing now (pumping a stowed plunger, wiping a clean
   * floor).
   */
  activate(verb?: ToiletVerb): boolean {
    const chosen = verb ?? this.toggleVerb();
    if (!this.control.verbs.includes(chosen)) return false;
    switch (chosen) {
      case 'open':
      case 'insert':
        if (this.target === 1) return false;
        this.target = 1;
        return true;
      case 'close':
      case 'pull':
        if (this.target === 0) return false;
        this.target = 0;
        return true;
      case 'turn':
        this.target = this.target > 0.5 ? 0 : 1;
        return true;
      case 'press':
        this.target = 1;
        return true;
      case 'pump':
        if (this.target < 1) return false;
        this.pump = PUMP_TIME;
        return true;
      case 'wipe':
        if (this.target <= 0) return false;
        this.target = Math.max(0, this.target - WIPE_SHARE);
        return true;
      default:
        return false;
    }
  }

  /** The verb a plain click means: the opposite of where the channel is heading. */
  private toggleVerb(): ToiletVerb {
    const on = this.target > 0.5;
    switch (this.kind) {
      case 'door':
      case 'lid':
        return on ? 'close' : 'open';
      case 'plunger':
        return on ? 'pull' : 'insert';
      case 'valve':
        return 'turn';
      case 'flush':
        return 'press';
      case 'floor-dirt':
        return 'wipe';
    }
  }

  /** Eases the channel; `snap` lands it at once (captures, restores). True if anything moved. */
  update(dt: number, snap = false): boolean {
    const step = snap ? Infinity : RATES[this.kind] * dt;
    const before = this.value;
    const pumping = this.pump > 0;
    this.value += THREE.MathUtils.clamp(this.target - this.value, -step, step);
    // The flush button springs back once it is home.
    if (this.kind === 'flush' && this.target === 1 && this.value >= 1) this.target = 0;
    this.pump = Math.max(0, this.pump - (snap ? this.pump : dt));
    this.pose(this.value, this.pump);
    return this.value !== before || pumping;
  }
}
