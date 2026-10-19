import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { FoleyEvent } from '../audio/foley';
import type { PhysicsWorld } from '../core/physics';
import type { Item } from '../items/items';
import type { InteractionFixture } from '../player/interaction';
import { SIGN_PLANE, signMaterial } from '../world/market';
import type { WorldOrigin } from '../world/origin';
import { box, C } from '../world/poi/kit';
import type { Road } from '../world/road';
import type { Terrain } from '../world/terrain';
import { DREAM_CARGO_ID, POCKET_HALF_LENGTH_M, type DreamPocket } from './dream';

/**
 * A parcel terminal: a cabinet with one window and a small screen, standing on the pad
 * just ahead of a dream's parking pocket, its front to the bay.
 *
 * The START terminal holds the parcel in its window and shows its six-digit PIN; [F]
 * takes the parcel into the hands. The GOAL terminal takes it back: [F] with the parcel
 * in hand puts it in the window, which is the delivery — refused until the car stands
 * parked in the bay.
 *
 * Built from the POI kit (`box`) and a market sign board, whose programs
 * `marketProgramAnchor` links at boot; the cabinet is in the scene before the boot
 * warm-up. One fixed cuboid collider, so a car parked nose-first stops against it.
 * Placed relative to the floating origin and shifted on every rebase, mesh and body.
 */

export type TerminalRole = 'pickup' | 'dropoff';

/** What the terminal asks of the world when it is used; wired by the composition root. */
export interface TerminalHooks {
  /** The item in the hands, or null. */
  held(): Item | null;
  /** Puts an item in the hands; false when they are full. */
  take(item: Item): boolean;
  /** Takes the held item out of the hands. */
  give(itemId: string): void;
  /** The dream accepted the delivery (`DreamRun.deliver`); false to refuse it. */
  deliver(): boolean;
  /** Whether the car stands parked in the goal bay, for the prompt. */
  parked(): boolean;
  /**
   * Opens the rotary dial for `pin` (dreams/dial.ts) with the game held still, and
   * calls `opened` once it has been dialled; hanging up calls nothing.
   */
  dial(pin: string, opened: () => void): void;
}

/** Cabinet, metres: width, height, depth. Its front faces local -Z. */
const W = 0.8;
const H = 1.6;
const D = 0.5;
/** Clear ground between the bay's front line and the cabinet's front, metres. */
const BAY_CLEARANCE_M = 0.7;
/** The window: centre height, and half its size on the front. */
const WINDOW_Y = 0.98;
const WINDOW_HALF_W = 0.25;
const WINDOW_HALF_H = 0.16;
const SCREEN_Y = 1.36;

export class ParcelTerminal implements InteractionFixture {
  private readonly group = new THREE.Group();
  private readonly parcelMesh: THREE.Mesh;
  private readonly body: RAPIER.RigidBody;
  /** Absolute base centre and yaw; the front faces local -Z. */
  private readonly x: number;
  private readonly y: number;
  private readonly z: number;
  private readonly cos: number;
  private readonly sin: number;
  /** What lies in the window. */
  private window: Item | null;

  constructor(
    private readonly role: TerminalRole,
    pocket: DreamPocket,
    private readonly cargoName: string,
    /** Where the parcel goes: the goal stop's name. */
    private readonly destination: string,
    private readonly pin: string,
    /** The parcel, waiting in the window of a pickup terminal; null for a dropoff one. */
    parcel: Item | null,
    private readonly hooks: TerminalHooks,
    road: Road,
    terrain: Terrain,
    private readonly origin: WorldOrigin,
    scene: THREE.Scene,
    physics: PhysicsWorld,
  ) {
    this.window = parcel;
    const s = pocket.s + POCKET_HALF_LENGTH_M + BAY_CLEARANCE_M + D / 2;
    const at = road.offsetPoint(s, pocket.lateral);
    const yaw = road.sampleAt(s).heading;
    this.x = at.x;
    this.y = terrain.laybySurfaceY(s, pocket.lateral, pocket.layby.side);
    this.z = at.z;
    this.cos = Math.cos(yaw);
    this.sin = Math.sin(yaw);

    const g = this.group;
    g.name = 'parcel-terminal';
    g.position.set(this.x - origin.x, this.y, this.z - origin.z);
    // Local +Z down the road, so the front (local -Z) faces back into the bay.
    g.rotation.y = yaw;
    box(g, [W, H, D], [0, H / 2, 0], C.fadedBlue);
    box(g, [W + 0.08, 0.06, D + 0.08], [0, H + 0.03, 0], C.darkMetal);
    box(g, [WINDOW_HALF_W * 2 + 0.08, WINDOW_HALF_H * 2 + 0.08, 0.03], [0, WINDOW_Y, -D / 2 - 0.005], C.darkMetal);
    this.parcelMesh = box(g, [0.34, 0.22, 0.05], [0, WINDOW_Y - 0.02, -D / 2 - 0.03], C.ochre);
    this.parcelMesh.visible = parcel !== null;
    const screen = new THREE.Mesh(
      SIGN_PLANE,
      signMaterial(
        role === 'pickup'
          ? [`TO ${destination.toUpperCase()}`, `PIN ${pin.slice(0, 3)} ${pin.slice(3)}`]
          : ['PARCELS', 'DIAL YOUR PIN'],
        '#16323a',
        '#bff0d0',
        512,
        256,
      ),
    );
    screen.scale.set(0.6, 0.3, 1);
    screen.position.set(0, SCREEN_Y, -D / 2 - 0.006);
    // The board faces local +Z; the screen faces the front.
    screen.rotation.y = Math.PI;
    g.add(screen);
    scene.add(g);

    this.body = physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed()
        .setTranslation(this.x - origin.x, this.y + H / 2, this.z - origin.z)
        .setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }),
    );
    physics.world.createCollider(RAPIER.ColliderDesc.cuboid(W / 2, H / 2, D / 2), this.body);

    origin.register({
      rebase: ({ dx, dz }) => {
        g.position.x -= dx;
        g.position.z -= dz;
        const t = this.body.translation();
        this.body.setTranslation({ x: t.x - dx, y: t.y, z: t.z - dz }, false);
      },
    });
  }

  /** The front face, in the cabinet's frame: a hit anywhere on it names the terminal. */
  aim(eyeX: number, eyeY: number, eyeZ: number, dx: number, dy: number, dz: number, range: number): number {
    // Into the local frame: undo the yaw about the base centre.
    const rx = eyeX + this.origin.x - this.x;
    const rz = eyeZ + this.origin.z - this.z;
    const lx = rx * this.cos - rz * this.sin;
    const lz = rx * this.sin + rz * this.cos;
    const ldx = dx * this.cos - dz * this.sin;
    const ldz = dx * this.sin + dz * this.cos;
    // The ray must travel towards the front (+Z) from in front of it.
    if (ldz <= 1e-6 || lz > -D / 2) return Infinity;
    const t = (-D / 2 - lz) / ldz;
    if (t > range) return Infinity;
    const hx = lx + ldx * t;
    const hy = eyeY + dy * t - this.y;
    return Math.abs(hx) <= W / 2 && hy >= 0 && hy <= H ? t : Infinity;
  }

  prompt(): string | null {
    if (this.role === 'pickup') {
      return this.window
        ? `[F] take the ${this.cargoName} for ${this.destination} — PIN ${this.pin} on the screen`
        : `Parcel terminal — your PIN is ${this.pin}`;
    }
    if (this.window) return 'Parcel terminal — delivered';
    if (this.hooks.held()?.id !== DREAM_CARGO_ID) return `Parcel terminal — bring the ${this.cargoName} from the boot`;
    if (!this.hooks.parked()) return 'Park the car in the marked bay first';
    return '[F] dial the PIN to open the window';
  }

  act(): FoleyEvent | null {
    if (this.role === 'pickup') {
      if (!this.window || !this.hooks.take(this.window)) return 'refused';
      this.window = null;
      this.parcelMesh.visible = false;
      return 'pickup';
    }
    if (this.window || this.hooks.held()?.id !== DREAM_CARGO_ID || !this.hooks.parked()) return 'refused';
    this.hooks.dial(this.pin, () => this.putIn());
    return 'mount';
  }

  /** The window unlocked: the parcel goes in, which is the delivery. */
  private putIn(): void {
    const held = this.hooks.held();
    if (this.window || !held || held.id !== DREAM_CARGO_ID || !this.hooks.deliver()) return;
    this.hooks.give(held.id);
    this.window = held;
    this.parcelMesh.visible = true;
  }

  /** The parcel still waits in this window. */
  get holdsParcel(): boolean {
    return this.window !== null;
  }
}
