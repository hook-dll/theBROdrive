import * as THREE from 'three';
import type { PhysicsWorld } from '../core/physics';

import type { CarState, GameWorld, StickerState } from '../game/state';
import { contractAcceptRefusal, contractDeliveryEffect, contractRewardSticker } from '../contracts/registry';
import type { DeliveryContext, DeliveryProbe } from '../contracts/types';
import { TOW_COUPLE_RANGE_M, towEyeWorld, type CarTowField } from '../vehicle/cartow';
import type { InputFrame } from '../core/input';
import type {
  Inventory,
  CoinItem,
  Item,
  PartItem,
  FluidCanItem,
  FluidKind,
  SprayCanItem,
  StickerEnvelopeItem,
  ToolItem,
} from '../items/items';
import { itemLabel, itemMass, litreText, spongeSpent } from '../items/items';
import type { CarStats, PartInstance } from '../parts/registry';
import {
  applySponge,
  oilCapacity,
  variant,
  RUST_CLEAN_EPSILON,
} from '../parts/registry';
import type { LoosePartField } from '../parts/loose';
import type { Vehicle } from '../vehicle/vehicle';
import type { TrailerField } from '../vehicle/trailer';
import { carModel } from '../vehicle/carmodels';
import { carPaintSwatch, visiblePaintHex } from '../vehicle/carpaint';
import {
  intersectStorageGrid,
  TRUNK_CELL_COUNT,
  TRUNK_CELL_HEIGHT,
  TRUNK_GRID_DEPTH,
  storageGridCentreY,
  storageGridRows,
  trunkGridWidth,
  type StorageOwnerKind,
  type StorageSide,
  type TrunkGridRayHit,
  type TrunkViewState,
} from '../vehicle/trunk';
import {
  bonnetAccepts,
  bonnetPart,
  bonnetSlotKind,
  bonnetWaterCapacity,
  BONNET_SLOT_COUNT,
  partContainer,
} from '../vehicle/bonnet';
import { setPartCondition } from '../render/materials';
import type { FoleyEvent, FoleyContinuous } from '../audio/foley';
import type { Player } from './player';
import type { WorldOrigin } from '../world/origin';
import type { WreckTrunkField } from '../world/wrecktrunks';
import type { CourierField, CourierTrunk } from '../world/couriers';
import type { BoardableField } from '../story/sitebuild';
import { STICKER_SCALE_MAX, STICKER_SCALE_MIN } from '../items/stickercatalog';
import { uprightStickerRoll } from '../render/stickers';

/** How far the eye ray reaches for picking. */
const RAY_RANGE = 2.6;
/** How far in front of the eye a dropped item materialises. */
const DROP_DISTANCE = 1.2;
/**
 * A drop is pulled back to this short of whatever the view ray hits, so dropping
 * into a wall cannot embed the item; MIN_HIT_TOI below floors the result.
 */
const DROP_WALL_MARGIN = 0.15;
/** Distance from the eye to a car's centre at which entering it is offered. */
const VEHICLE_RANGE = 3.5;
/**
 * Fastest a seated player may still step out of a moving car, in km/h. Five is
 * walking pace, so a permitted exit reads as stepping out rather than the car
 * being snapped to a halt under you, and it sits above the creep a car makes on
 * an idling clutch on a grade, so a car rolling gently downhill can still be
 * left. `speedKmh` is already absolute, so fast reversing refuses too.
 */
const EXIT_SPEED_LIMIT_KMH = 5;
/** Refusal shown while the driver holds interact above the exit speed. */
const EXIT_REFUSED_PROMPT = 'slow down to step out';
/**
 * Heaviest single thing a player can take into the cabin, kg: what fits on a lap or
 * the back seat. An engine (118 kg and up) is carried to a car, not ridden with.
 */
const CABIN_ITEM_LIMIT_KG = 40;
/**
 * How far from the join between two cars the player stands to work a tow bar, metres.
 * Without it the bar was offered from anywhere the two coupled cars were the nearest
 * pair, and since it wins the F key, it took entering either car away entirely.
 */
const TOW_WORK_RANGE_M = 2;
/** Condition deltas are throttled; the visual updates every tick regardless. */
const CONDITION_EMIT_INTERVAL = 0.25;
/** The sponge shifts a car's dirt as fast as it does a part's. */
const BODY_SPONGE_DIRT_RATE = 0.7;
/**
 * Polishing removes 12 percentage points of visible scuffing per second, slow enough
 * that a battered 55% shell takes nearly four seconds to improve. It stops at 8%:
 * wax hides surface marks but cannot repaint worn paint.
 */
const BODY_SPONGE_SCRATCH_RATE = 0.12;
const BODY_SCRATCH_FLOOR = 0.08;
/** Fuel poured per second from a held can. */
const FUEL_POUR_RATE = 1.2;
/**
 * Seconds of held spray for one full coat. Long enough to read as work, short
 * enough that a colour change is one sitting rather than a chore.
 */
const SPRAY_COAT_SECONDS = 6;
/** Seconds of spray in a full can: one coat, plus a touch-up's worth. */
const SPRAY_CAN_SECONDS = 7.5;
/**
 * How far the towing car may be from the player while coupling a trailer. Generous
 * on purpose: you stand at the drawbar, and the car you are hooking to is a whole
 * car-length away by definition.
 */
const HITCH_CAR_RANGE = 9;
/**
 * Hits closer than this are treated as "no hit". The eye origin sits inside the
 * player's own capsule, and `castRayAndGetNormal(..., solid = true)` returns an
 * immediate zero-distance self-hit when the ray is not told to exclude that body.
 * Resolving that self-hit to a valid target is what made the bug invisible, so a
 * floor is applied here rather than trusting the exclusion alone.
 */
const MIN_HIT_TOI = 0.05;

type Target =
  | { kind: 'none' }
  | { kind: 'loose-part'; partId: string }
  | { kind: 'loose-item'; itemId: string }
  | { kind: 'trailer'; trailerId: string }
  | { kind: 'storage'; owner: StorageOwnerKind; side: StorageSide; id: string; cell: number | null }
  | { kind: 'car-entry'; carId: string }
  | { kind: 'aircraft' }
  | {
      kind: 'car-body';
      carId: string;
      point: THREE.Vector3;
      normal: THREE.Vector3;
      valid: boolean;
    }
  | { kind: 'loose-part'; partId: string };

/**
 * What one tick of interaction produced: the prompt to draw, at most one
 * discrete sound (a pickup, a door, a bolt going in) and whichever continuous
 * action is being held (scrubbing, pouring). The sounds are reported rather than
 * played here — Interaction owns the world, not the audio device.
 */
export interface InteractionResult {
  prompt: string | null;
  sound: FoleyEvent | null;
  /** The held action running this tick, for the audio layer's continuous voices. */
  continuous: FoleyContinuous;
  /** World-attached storage grid while the player is looking into an opened compartment. */
  boot: TrunkViewState | null;
  /** True on the F edge that asks to board the parked plane. */
  board: boolean;
}

/**
 * Litres a second a can transfers. Pouring is aimed at the fitted part that owns
 * the reservoir, inside an opened bonnet, so the grid's own `BOOT_RANGE` is the
 * whole proximity rule: there is no separate pour distance.
 */
const FLUID_POUR_RATE = 1.2;
/** Within this many litres of capacity a reservoir reads as full. */
const FLUID_FULL_EPSILON = 0.05;
/**
 * Maximum eye-to-grid distance. Halved from 3.2 m so the trunk only opens when the
 * player has deliberately walked up to the rear of the car.
 */
const BOOT_RANGE = 1.6;
/**
 * Aim forgiveness outside the drawn grid. A rectangular margin preserves the old
 * horizontal cutoff without the old circular region's oversized vertical reach.
 */
const BOOT_REVEAL_MARGIN = 0.15;
/**
 * How far the player may walk from an opened compartment before it closes itself, as
 * a multiple of `BOOT_RANGE`.
 *
 * The grid used to be tied to the AIM: it was drawn only while the resolve landed on
 * that compartment, so a step back or a glance sideways closed it and the next look
 * needed another [F]. Loading a boot is exactly the task that wants to look away —
 * at the ground, at the part you are about to carry over — so the grid now survives
 * the aim entirely and answers to distance alone.
 *
 * Doubling the reach rather than picking a new number keeps ONE distance in the
 * design: `BOOT_RANGE` is how close you must be to open a compartment, and this is
 * how far you must walk for it to give up on you. Reaching in still needs the aim,
 * so nothing about operating a cell has changed.
 */
const GRID_PERSIST_RANGE = BOOT_RANGE * 2;

/** What a sticker in hand asks for until the crosshair finds a car. */
const STICKER_HINT = 'sticker in hand · aim at a car to try it on';

const EMPTY_WRECK_TRUNK: readonly (Item | null)[] =
  new Array<Item | null>(TRUNK_CELL_COUNT).fill(null);
const EMPTY_WRECK_BONNET: readonly (Item | null)[] =
  new Array<Item | null>(BONNET_SLOT_COUNT).fill(null);

/**
 * A serviceable reservoir, resolved from the bonnet slot the crosshair is on.
 *
 * Levels are read and filled through the FITTED PART that holds them — the engine
 * for oil, the radiator, the fuel tank — so what the bonnet tells you is exactly
 * what a can can pour into. A missing part has no reservoir at all, and its fluid
 * left with it (see `moveSlotFluid` in game/state.ts).
 */
interface Reservoir {
  /** What the readout calls it: 'oil', 'water' or 'petrol'. */
  readonly label: string;
  readonly level: number;
  readonly capacity: number;
  /** The one fluid this reservoir takes. */
  readonly wants: FluidKind;
}

function reservoirAccepts(reservoir: Reservoir, fluid: FluidKind): boolean {
  return fluid === reservoir.wants;
}

/** `oil 3.2/4.0 L`, or `oil full — 4.0 L` once topping up would do nothing. */
function fillReadout(reservoir: Reservoir): string {
  if (reservoir.level >= reservoir.capacity - FLUID_FULL_EPSILON) {
    return `${reservoir.label} full — ${litreText(reservoir.capacity)}`;
  }
  // Same one-decimal format the can label uses, so pouring never looks like it lost
  // half a litre in the transfer (`litreText`, items/items.ts).
  return `${reservoir.label} ${reservoir.level.toFixed(1)}/${litreText(reservoir.capacity)}`;
}

/**
 * The reservoir serviced through one bonnet slot, or null when that slot holds no
 * part, is the turbocharger or air filter position, or the model has no capacity
 * for it.
 */
function bonnetReservoir(car: CarState, stats: CarStats, cell: number): Reservoir | null {
  if (!bonnetPart(car.bonnet, cell)) return null;
  switch (bonnetSlotKind(cell)) {
    case 'engine': {
      const capacity = oilCapacity(stats.engine);
      return capacity > 0
        ? { label: 'oil', level: car.oilLitres, capacity, wants: 'oil' }
        : null;
    }
    case 'radiator': {
      const capacity = bonnetWaterCapacity(car.bonnet);
      return capacity > 0
        ? { label: 'water', level: car.waterLitres, capacity, wants: 'water' }
        : null;
    }
    case 'fuel_tank': {
      if (stats.tankCapacity <= 0) return null;
      return { label: 'petrol', level: car.fuelLitres, capacity: stats.tankCapacity, wants: 'petrol' };
    }
    default:
      return null;
  }
}

/**
 * Where a resolved reservoir actually lives, and therefore which delta a pour
 * writes. A fitted container's level belongs to the CAR; a detached one carries it
 * on the part; a can carries its own.
 */
type AimedReservoir = Reservoir &
  (
    | { readonly sink: 'car'; readonly carId: string }
    | { readonly sink: 'loose-part'; readonly partId: string }
    | { readonly sink: 'loose-can'; readonly itemId: string }
  );

/**
 * The reservoir of a container lying in the world, or null when the part holds no
 * fluid at all (a turbocharger, an air filter).
 */
function loosePartReservoir(part: PartInstance): Reservoir | null {
  const container = partContainer(part);
  if (container === null) return null;
  const wants: FluidKind = container.channel === 'fuel' ? 'petrol' : container.channel;
  return { label: wants, level: part.litres ?? 0, capacity: container.capacity, wants };
}

/**
 * The composition root's view of the world's cars, by id. Interaction knows the
 * prompt's geometry and the contract probe's needs; it does not own the live
 * `Vehicle` map, so the three reads it needs are handed in.
 */
export interface CarLookup {
  /** The live `Vehicle` of a car, or null when it is not materialised. */
  vehicle(carId: string): Vehicle | null;
  /** Absolute X/Z of a car: its body when materialised, its saved pose otherwise. */
  position(carId: string): { readonly x: number; readonly z: number } | null;
  /**
   * Fills `out` with the ids of the two cars nearest a point in Rapier's own frame
   * (the same frame `Vehicle.chassis.translation` answers in), nearest first, and
   * returns how many were written. `out` is the caller's reused array.
   */
  nearest(x: number, z: number, out: (string | null)[]): number;
}

/** The bar action available where the player stands; see `towAction`. */
interface TowAction {
  readonly towerId: string;
  readonly towedId: string;
  /** False when the two are already coupled and the action is to drop the bar. */
  readonly hitch: boolean;
}

interface Resolved {
  target: Target;
  vehicle: Vehicle | null;
  carId: string | null;
  /** Distance from the eye to the car's chassis centre, metres. */
  vehicleDist: number;
}

/** `DeliveryProbe` with writable fields, so one instance can track the aim. */
interface MutableDeliveryProbe {
  targetCourierIndex: number;
  courierX: number;
  courierZ: number;
  drivingCarId: string | null;
  readonly trailerPosition: DeliveryProbe['trailerPosition'];
  readonly carPosition: DeliveryProbe['carPosition'];
  readonly car: DeliveryProbe['car'];
}

function conditionPrefix(part: PartInstance): string {
  if (part.destroyed) return 'destroyed ';
  if (part.rust > 0.3) return 'rusty ';
  if (part.dirt > 0.3) return 'dirty ';
  return '';
}

function scrubLabel(part: PartInstance): string {
  if (part.rust > RUST_CLEAN_EPSILON) return 'rust';
  return 'dirt';
}

export type TrunkCellAction = 'none' | 'refused' | 'stored' | 'retrieved';

/**
 * Moves one aimed cell between trunk and pack. Occupancy wins over held state:
 * looking at an item retrieves that exact item even while another item is held.
 */
export function operateTrunkCell(
  storage: readonly (Item | null)[],
  cell: number,
  held: Item | null,
  inventory: Inventory,
): { action: TrunkCellAction; item: Item | null } {
  if (cell < 0 || cell >= storage.length) return { action: 'none', item: null };
  const stored = storage[cell];
  if (stored) {
    if (!inventory.add(stored)) return { action: 'refused', item: stored };
    return { action: 'retrieved', item: null };
  }
  if (!held) return { action: 'none', item: null };
  const removed = inventory.remove(held.id);
  if (!removed) return { action: 'none', item: null };
  return { action: 'stored', item: removed };
}

export class Interaction {
  private player: Player | null = null;
  private prevInteract = false;
  private prevMount = false;
  private prevDrop = false;
  private conditionEmitTimer = 0;
  /**
   * The opened compartment, if any, with the ABSOLUTE world position of its grid
   * centre. Absolute because it outlives the aim: the origin can rebase between the
   * tick that opened it and the tick that measures whether the player has walked
   * away, and a relative position would silently move the compartment with it.
   */
  private openStorage: {
    owner: StorageOwnerKind;
    side: StorageSide;
    id: string;
    x: number;
    y: number;
    z: number;
  } | null = null;

  private readonly tScratch = new THREE.Vector3();
  private readonly qScratch = new THREE.Quaternion();
  private readonly vScratch = new THREE.Vector3();
  private readonly trunkEye = new THREE.Vector3();
  /** Chassis-local grid offset, rotated into world space; see `storageGridCentre`. */
  private readonly gridScratch = new THREE.Vector3();
  private readonly trunkDirection = new THREE.Vector3();
  private readonly trunkPosition = new THREE.Vector3();
  private readonly trunkQuaternion = new THREE.Quaternion();
  private readonly trunkInverse = new THREE.Quaternion();
  private readonly trunkRayHit: TrunkGridRayHit = { cell: 0, distance: 0 };
  private trunkPickedCell: number | null = null;
  private trunkPickedDistance = Infinity;
  /** This tick's discrete sound and held action; reset at the top of every tick. */
  private sound: FoleyEvent | null = null;
  private continuous: FoleyContinuous = null;
  /** A sponge that wore out this tick, to be let fall from the hand. */
  private spentSponge: string | null = null;
  /** Scene-graph raycaster and scratch, for picking real bodywork. */
  private readonly raycaster = new THREE.Raycaster();
  private readonly rayOrigin = new THREE.Vector3();
  private readonly rayDir = new THREE.Vector3();
  private readonly qBody = new THREE.Quaternion();
  private readonly hits: THREE.Intersection[] = [];
  private prevPrimary = false;
  private prevSecondary = false;
  /**
   * How the held sticker is being worn while it is tried on: turned, sized and
   * mirrored by the player, kept while the same envelope stays in hand.
   */
  private stickerStyle: { envelopeId: string; rollOffset: number; scale: number; mirror: boolean } | null = null;
  private prevUseHeld = false;
  private readonly stickerPoint = new THREE.Vector3();
  private readonly stickerNormal = new THREE.Vector3();
  private readonly stickerNormalMatrix = new THREE.Matrix3();
  /** This tick's car-to-car bar action, or null; see `towAction`. */
  private towActionValue: TowAction | null = null;
  /** Reused receiver for the two cars nearest the player, and their eyes. */
  private readonly towNearest: (string | null)[] = [null, null];
  private readonly towEyeA = { x: 0, y: 0, z: 0 };
  private readonly towEyeB = { x: 0, y: 0, z: 0 };
  private readonly towEyeC = { x: 0, y: 0, z: 0 };
  private readonly towEyeD = { x: 0, y: 0, z: 0 };
  /**
   * The delivery probe handed to contract kinds, reused in place: the prompt that
   * aims at a courier boot with a contract in hand rebuilds it every tick, and it
   * must not allocate. Valid only for the call that filled it.
   */
  private readonly deliveryProbeValue: MutableDeliveryProbe = {
    targetCourierIndex: -1,
    courierX: 0,
    courierZ: 0,
    drivingCarId: null,
    // Arrows, not values: they read the live world when the kind asks, and the
    // fields above are only the courier this call is about.
    trailerPosition: (id) => this.trailerPositionOf(id),
    carPosition: (id) => this.carLookup.position(id),
    car: (id) => this.world.state.cars[id] ?? null,
  };

  constructor(
    private readonly physics: PhysicsWorld,
    private readonly world: GameWorld,
    private readonly inventory: Inventory,
    private readonly loose: LoosePartField,
    private readonly trailers: TrailerField,
    private readonly wreckTrunks: WreckTrunkField,
    private readonly couriers: CourierField,
    /** Never re-derive the id from geometry. */
    private readonly getVehicle: () => { carId: string; vehicle: Vehicle } | null,
    /** The composition root's lookups over the world's cars, by id. */
    private readonly carLookup: CarLookup,
    /** The car-to-car tow bars; hitching is a world mutation like a trailer's. */
    private readonly towField: CarTowField,
    /** Draws a newly placed sticker; the renderer owns the decal meshes. */
    private readonly onStickerPlaced: (carId: string, sticker: StickerState) => void,
    /** Owns the single reusable translucent placement preview. */
    private readonly onStickerPreview: (
      carId: string | null,
      sticker: StickerState | null,
      valid: boolean,
    ) => void,
    /**
     * The floating origin. Interaction straddles both frames by nature: its rays go
     * into Rapier (relative) while the things it drops and teleports are saved world
     * positions (absolute). See `world/origin.ts`.
     */
    private readonly origin: WorldOrigin,
    /** Colliders that mean "this is the parked plane"; boarding is offered here. */
    private readonly boardable: BoardableField,
    /** Coins a race win pays for handing this cargo in now; see `RivalRace.winCoins`. */
    private readonly raceCoins: (itemId: string) => number,
  ) {}

  /** Gives interaction a handle on the on-foot character, so enter/exit can move it. */
  attachPlayer(player: Player): void {
    this.player = player;
  }

  fixedUpdate(
    dt: number,
    input: InputFrame,
    eyeX: number,
    eyeY: number,
    eyeZ: number,
    dirX: number,
    dirY: number,
    dirZ: number,
    roadS: number,
  ): InteractionResult {
    const interactPressed = input.interact && !this.prevInteract;
    const mountPressed = input.mount && !this.prevMount;
    const dropPressed = input.dropItem && !this.prevDrop;
    const primaryPressed = input.usePrimary && !this.prevPrimary;
    const secondaryPressed = input.useSecondary && !this.prevSecondary;
    this.prevInteract = input.interact;
    this.prevMount = input.mount;
    this.prevDrop = input.dropItem;
    this.sound = null;
    this.continuous = null;
    this.prevPrimary = input.usePrimary;
    this.prevSecondary = input.useSecondary;
    const useHeldPressed = input.useHeld && !this.prevUseHeld;
    this.prevUseHeld = input.useHeld;

    if (this.world.state.player.drivingCarId) {
      // Sitting down closes whatever was open: the grid belongs to a player standing
      // at the car, and a driver cannot reach into it.
      this.openStorage = null;
      // Successful exit is self-evident. Only a refused moving exit needs a prompt,
      // and it stays visible while F is held rather than flashing for one tick.
      let prompt: string | null = null;
      if (interactPressed) prompt = this.tryExit(roadS);
      else if (input.interact) prompt = this.exitRefused();
      return { prompt, sound: this.sound, continuous: null, boot: null, board: false };
    }

    const resolved = this.resolve(eyeX, eyeY, eyeZ, dirX, dirY, dirZ);
    // The bar action is settled before the prompt is built from it. A storage cell,
    // a loose item or a trailer in the aim keeps its own action: the bar is what is
    // offered when the player is simply standing at the join with nothing to aim at.
    this.towActionValue = this.towAction();
    const towTargetKind = resolved.target.kind;
    if (
      towTargetKind !== 'none' &&
      towTargetKind !== 'car-entry' &&
      towTargetKind !== 'car-body'
    ) {
      this.towActionValue = null;
    }
    const envelope = this.inventory.held?.type === 'sticker_envelope' ? this.inventory.held : null;
    if (envelope) {
      const trying = this.updateStickerMode(
        envelope,
        resolved,
        input,
        mountPressed || primaryPressed,
        secondaryPressed,
        useHeldPressed,
        dropPressed,
        eyeX,
        eyeY,
        eyeZ,
        dirX,
        dirY,
        dirZ,
      );
      if (trying) return trying;
    } else if (this.stickerStyle) {
      this.stickerStyle = null;
      this.onStickerPreview(null, null, false);
    }
    this.holdOpenStorage(resolved, eyeX, eyeY, eyeZ);
    // A sticker in hand turns the car into a surface, not a door: getting in, the bonnet
    // and the boot are not offered while it is held (an already open boot still takes
    // the envelope into a cell). What is offered is the hint to aim at the car.
    const stickerBlocksCar = envelope !== null && this.isClosedCarTarget(resolved.target);
    const prompt = envelope !== null && (stickerBlocksCar || resolved.target.kind === 'none')
      ? STICKER_HINT
      : this.promptFor(resolved);

    if (input.usePrimary) this.usePrimary(dt, resolved);
    if (this.spentSponge !== null) {
      // Let go of it: dropped straight down a little ahead of the feet.
      if (this.inventory.held?.id === this.spentSponge) this.drop(eyeX, eyeY, eyeZ, dirX * 0.25, -1, dirZ * 0.25);
      this.spentSponge = null;
    }
    const worldActionPressed = mountPressed && !stickerBlocksCar
      && (this.towActionValue !== null || this.mountHasPriority(resolved.target));
    if (worldActionPressed) {
      const actionResolved = resolved;
      this.mount(actionResolved);
    }
    if (interactPressed && !worldActionPressed && !stickerBlocksCar) this.tryEnter(resolved);
    // F is also world manipulation, but `mountHasPriority` yields the plane to this
    // edge, so an F aimed at the aircraft never reaches `mount`.
    const board = interactPressed && !worldActionPressed && !stickerBlocksCar && resolved.target.kind === 'aircraft';
    // Deliberately after the driving early-return above: dropping while seated is a
    // no-op, the item stays in the inventory.
    if (dropPressed) this.drop(eyeX, eyeY, eyeZ, dirX, dirY, dirZ);

    // Resolved AFTER the actions above, so stowing or taking is reflected in the
    // same frame the player sees rather than one behind.
    //
    // Drawn from `openStorage`, NOT from the aim: the compartment the player opened
    // stays on screen while they look elsewhere, and closes itself only when they
    // walk out of `GRID_PERSIST_RANGE`. Only the highlighted cell still follows the
    // crosshair, because only reaching in needs the aim.
    let boot: TrunkViewState | null = null;
    const open = this.openStorage;
    if (open) {
      const cells = this.storageCells(open);
      if (cells) {
        const aimed = resolved.target.kind === 'storage' && this.isStorageOpen(resolved.target)
          ? resolved.target.cell
          : null;
        boot = {
          owner: open.owner,
          side: open.side,
          id: open.id,
          cells,
          selectedCell: aimed,
        };
      }
    }
    return { prompt, sound: this.sound, continuous: this.continuous, boot, board };
  }

  /** A target that belongs to a car and is not an open storage grid. */
  private isClosedCarTarget(t: Target): boolean {
    if (t.kind === 'car-entry' || t.kind === 'car-body') return true;
    return t.kind === 'storage' && t.owner === 'car' && !this.isStorageOpen(t);
  }

  /**
   * STICKER MODE: an envelope in hand is the editing tool. Aimed at a car's paint or
   * glass, the sticker is shown there live, see-through, exactly as it will be —
   * a decal clipped to the panels that can carry it, on top of every sticker
   * already there — and follows the crosshair. The wheel turns it, Shift+wheel sizes
   * it, E mirrors it, right click puts it back upright at catalogue size, F or click
   * sticks it. Returns null when the crosshair is not on a car, so the rest of the
   * world stays usable with the envelope in hand.
   */
  private updateStickerMode(
    held: StickerEnvelopeItem,
    resolved: Resolved,
    input: InputFrame,
    confirm: boolean,
    reset: boolean,
    mirror: boolean,
    drop: boolean,
    eyeX: number,
    eyeY: number,
    eyeZ: number,
    dirX: number,
    dirY: number,
    dirZ: number,
  ): InteractionResult | null {
    if (this.stickerStyle?.envelopeId !== held.id) {
      this.stickerStyle = { envelopeId: held.id, rollOffset: 0, scale: 1, mirror: false };
    }
    const style = this.stickerStyle;
    const t = resolved.target;
    const vehicle = resolved.vehicle;
    const carId = resolved.carId;
    if (
      !vehicle
      || !carId
      || !this.world.state.cars[carId]
      || (t.kind === 'storage' && this.isStorageOpen(t))
      || drop
    ) {
      this.onStickerPreview(null, null, false);
      return null;
    }
    const surface = this.pickBody(vehicle, eyeX, eyeY, eyeZ, dirX, dirY, dirZ);
    if (!surface) {
      this.onStickerPreview(null, null, false);
      return null;
    }

    // The wheel turns it and Shift+wheel sizes it; the touch strip steps the same
    // notches (core/touch.ts).
    const sizeSteps = (input.sprint ? -input.zoomDelta : 0) + input.stickerSize;
    const turnNotches = (input.sprint ? 0 : input.zoomDelta) + input.stickerTurn;
    if (sizeSteps !== 0) {
      style.scale = Math.min(
        STICKER_SCALE_MAX,
        Math.max(STICKER_SCALE_MIN, Math.round((style.scale + sizeSteps * 0.1) * 10) / 10),
      );
    }
    style.rollOffset += (turnNotches * Math.PI) / 12;
    if (mirror) style.mirror = !style.mirror;
    if (reset || input.stickerReset) {
      style.rollOffset = 0;
      style.scale = 1;
      style.mirror = false;
    }

    const { point, normal } = surface.local;
    const sticker: StickerState = {
      id: `${held.id}:sticker`,
      kind: held.stickerKind,
      x: point.x,
      y: point.y,
      z: point.z,
      nx: normal.x,
      ny: normal.y,
      nz: normal.z,
      roll: uprightStickerRoll(normal.x, normal.y, normal.z) + style.rollOffset,
      scale: style.scale,
      mirror: style.mirror,
    };
    if (confirm) {
      this.world.apply({ t: 'sticker_place', carId, sticker, envelopeId: held.id });
      this.inventory.remove(held.id);
      this.stickerStyle = null;
      this.onStickerPreview(null, null, false);
      this.onStickerPlaced(carId, sticker);
      this.sound = 'mount';
      return { prompt: 'stuck on', sound: this.sound, continuous: null, boot: null, board: false };
    }
    this.onStickerPreview(carId, sticker, true);
    const size = Math.round(style.scale * 100);
    return {
      prompt: `[F/click] stick · wheel turn · Shift+wheel size ${size}% · [E] mirror${style.mirror ? ' ✓' : ''} · right click reset`,
      sound: null,
      continuous: null,
      boot: null,
      board: false,
    };
  }

  private storageCells(
    target: { readonly owner: StorageOwnerKind; readonly side: StorageSide; readonly id: string },
  ): readonly (Item | null)[] | null {
    if (target.owner === 'wreck') {
      return target.side === 'bonnet'
        ? this.world.state.wreckBonnet[target.id] ?? EMPTY_WRECK_BONNET
        : this.world.state.wreckStorage[target.id] ?? EMPTY_WRECK_TRUNK;
    }
    if (target.owner === 'courier') {
      const courier = this.couriers.get(target.id);
      return this.world.state.courierStorage[target.id] ?? courier?.defaultStorage ?? null;
    }
    const car = this.world.state.cars[target.id];
    return target.side === 'bonnet' ? car?.bonnet ?? null : car?.storage ?? null;
  }

  /**
   * Fills the shared probe for one courier and one aim and returns it. The prompt
   * and the commit both go through here, so what the sentence promises and what F
   * does are read from the same world at the same moment.
   */
  private deliveryProbe(courier: CourierTrunk): DeliveryProbe {
    const probe = this.deliveryProbeValue;
    probe.targetCourierIndex = courier.index;
    probe.courierX = courier.x;
    probe.courierZ = courier.z;
    probe.drivingCarId = this.world.state.player.drivingCarId;
    return probe;
  }

  /**
   * Absolute X/Z of a trailer: the live body while it is materialised (a towed one
   * always is), the saved pose while it is dormant. State alone is up to two seconds
   * stale for a moving trailer, which is why the live body wins when there is one.
   */
  private trailerPositionOf(id: string): { readonly x: number; readonly z: number } | null {
    const live = this.trailers.get(id);
    if (live) {
      const t = live.rigidBody.translation();
      return { x: t.x + this.origin.x, z: t.z + this.origin.z };
    }
    const saved = this.world.state.trailers[id];
    return saved ? { x: saved.x, z: saved.z } : null;
  }

  /**
   * The car-to-car bar action available where the player stands, or null.
   *
   * Read from the two cars NEAREST the player, not from the aim. Hitching is
   * standing at the join: one car's tail and another's nose, with nothing in
   * particular to point a crosshair at, which is why a trailer is worked from its
   * drawbar end too. The pairing is "the two nearest live cars, if one's tow eye is
   * at the other's and they point the same way"; either order is allowed, so the
   * tower is whichever car can actually drive — a car with no engine in its bay
   * cannot pull anything, and the contract's stranded car has exactly that.
   *
   * Offered on foot only: seated, the bar is on the far side of the car around the
   * player, and walking round to work it is the whole gesture.
   */
  private towAction(): TowAction | null {
    if (this.world.state.player.drivingCarId !== null) return null;
    const p = this.player?.position;
    if (!p) return null;
    if (this.carLookup.nearest(p.x, p.z, this.towNearest) < 2) return null;
    const first = this.towNearest[0];
    const second = this.towNearest[1];
    if (!first || !second) return null;
    const a = this.carLookup.vehicle(first);
    const b = this.carLookup.vehicle(second);
    if (!a || !b) return null;
    const aRear = towEyeWorld(a, 'rear', this.towEyeA);
    const bFront = towEyeWorld(b, 'front', this.towEyeB);
    const aFront = towEyeWorld(a, 'front', this.towEyeC);
    const bRear = towEyeWorld(b, 'rear', this.towEyeD);
    // Standing at the join: the player is within reach of the midpoint between one
    // car's tail and the other's nose. Holds for dropping a bar as much as hitching.
    const atJoin = (rear: { x: number; z: number }, front: { x: number; z: number }): boolean =>
      Math.hypot((rear.x + front.x) / 2 - p.x, (rear.z + front.z) / 2 - p.z) <= TOW_WORK_RANGE_M;
    // On a bar already: the action is to drop it, and it reads from either end.
    const towerOfFirst = this.world.state.cars[first]?.towedBy ?? null;
    if (towerOfFirst === second) {
      return atJoin(bRear, aFront) ? { towerId: second, towedId: first, hitch: false } : null;
    }
    const towerOfSecond = this.world.state.cars[second]?.towedBy ?? null;
    if (towerOfSecond === first) {
      return atJoin(aRear, bFront) ? { towerId: first, towedId: second, hitch: false } : null;
    }
    if (towerOfFirst !== null || towerOfSecond !== null) return null;
    const qa = a.chassis.rotation();
    const qb = b.chassis.rotation();
    const aligned =
      (2 * (qa.x * qa.z + qa.w * qa.y)) * (2 * (qb.x * qb.z + qb.w * qb.y)) +
      (1 - 2 * (qa.x * qa.x + qa.y * qa.y)) * (1 - 2 * (qb.x * qb.x + qb.y * qb.y));
    if (aligned < 0.5) return null;
    // `first` may be either end of the pair; the tower is the driveable one.
    if (Math.hypot(aRear.x - bFront.x, aRear.z - bFront.z) <= TOW_COUPLE_RANGE_M && atJoin(aRear, bFront)) {
      return this.towOrder(first, second);
    }
    if (Math.hypot(bRear.x - aFront.x, bRear.z - aFront.z) <= TOW_COUPLE_RANGE_M && atJoin(bRear, aFront)) {
      return this.towOrder(second, first);
    }
    return null;
  }

  /**
   * Picks tower and towed for a pair that is geometrically coupled, preferring the
   * car with an engine in its bay: the contract's stranded car has none, and a car
   * that cannot run cannot pull.
   */
  private towOrder(towerId: string, towedId: string): TowAction {
    const driveable = (carId: string): boolean =>
      (this.world.state.cars[carId]?.bonnet[0] ?? null) !== null;
    if (driveable(towedId) && !driveable(towerId)) return { towerId: towedId, towedId: towerId, hitch: true };
    return { towerId, towedId, hitch: true };
  }

  private towPrompt(action: TowAction): string {
    const towed = this.world.state.cars[action.towedId];
    if (!towed) return '';
    const label = carModel(towed.modelId).label;
    if (!action.hitch) return `[F] unhitch the tow bar — ${label}`;
    const tower = this.world.state.cars[action.towerId];
    const towerLabel = tower ? carModel(tower.modelId).label : 'car';
    return `[F] hitch the ${label} behind the ${towerLabel}`;
  }

  private applyTowAction(action: TowAction): void {
    if (!action.hitch) {
      this.towField.unhitch(action.towedId);
      this.sound = 'drop';
      this.towActionValue = null;
      return;
    }
    const tower = this.carLookup.vehicle(action.towerId);
    const towed = this.carLookup.vehicle(action.towedId);
    if (!tower || !towed) return;
    this.towField.hitch(tower, action.towerId, towed, action.towedId);
    this.sound = 'mount';
    this.towActionValue = null;
  }

  private isStorageOpen(
    target: { readonly owner: StorageOwnerKind; readonly side: StorageSide; readonly id: string },
  ): boolean {
    const open = this.openStorage;
    return open?.owner === target.owner && open.side === target.side && open.id === target.id;
  }

  /**
   * ABSOLUTE world centre of a compartment's grid: the same chassis-local plane
   * `pickStorage` intersects, so "how far am I from the grid" is measured against the
   * thing the player is actually looking at rather than the car's centre.
   */
  private storageGridCentre(
    target: { readonly owner: StorageOwnerKind; readonly side: StorageSide; readonly id: string },
    vehicle: Vehicle | null,
    out: THREE.Vector3,
  ): boolean {
    let half: readonly [number, number, number];
    if (target.owner !== 'car') {
      const fixed = target.owner === 'wreck'
        ? this.wreckTrunks.get(target.id)
        : this.couriers.get(target.id);
      if (!fixed) return false;
      half = fixed.halfExtents;
      this.trunkQuaternion.set(fixed.qx, fixed.qy, fixed.qz, fixed.qw);
      out.set(fixed.x, fixed.y, fixed.z);
    } else {
      if (!vehicle) return false;
      half = vehicle.modelMeasure.halfExtents;
      vehicle.chassis.rotation(this.trunkQuaternion);
      const t = vehicle.chassis.translation(this.tScratch);
      out.set(t.x + this.origin.x, t.y, t.z + this.origin.z);
    }
    const depth = half[2] + TRUNK_GRID_DEPTH;
    this.gridScratch
      .set(0, storageGridCentreY(half[1]), target.side === 'bonnet' ? depth : -depth)
      .applyQuaternion(this.trunkQuaternion);
    out.add(this.gridScratch);
    return true;
  }

  /**
   * Holds an opened compartment open across a wandering aim, and closes it once the
   * player has walked `GRID_PERSIST_RANGE` from it.
   *
   * The grid's centre is refreshed on every tick the aim is back on the compartment, so
   * a car that rolls takes its grid with it; between those ticks the last known position
   * is what the distance is measured against, which is also what makes this work while
   * the compartment is behind the player and resolves to nothing at all.
   */
  private holdOpenStorage(resolved: Resolved, eyeX: number, eyeY: number, eyeZ: number): void {
    const open = this.openStorage;
    if (!open) return;
    const target = resolved.target;
    if (
      target.kind === 'storage' &&
      this.isStorageOpen(target) &&
      this.storageGridCentre(target, resolved.vehicle, this.vScratch)
    ) {
      open.x = this.vScratch.x;
      open.y = this.vScratch.y;
      open.z = this.vScratch.z;
      return;
    }
    const dx = eyeX + this.origin.x - open.x;
    const dy = eyeY - open.y;
    const dz = eyeZ + this.origin.z - open.z;
    if (dx * dx + dy * dy + dz * dz > GRID_PERSIST_RANGE * GRID_PERSIST_RANGE) {
      this.openStorage = null;
    }
  }

  /**
   * Resolves the same chassis-local grid the renderer draws. A narrowly padded
   * rectangle reveals it before a precise cell is under the crosshair.
   */
  private pickStorage(
    eyeX: number,
    eyeY: number,
    eyeZ: number,
    dirX: number,
    dirY: number,
    dirZ: number,
    position: { readonly x: number; readonly y: number; readonly z: number },
    quaternion: THREE.Quaternion,
    halfExtents: readonly [number, number, number],
    side: StorageSide,
  ): boolean {
    this.trunkInverse.copy(quaternion).invert();
    this.trunkEye.set(eyeX - position.x, eyeY - position.y, eyeZ - position.z).applyQuaternion(this.trunkInverse);
    this.trunkDirection.set(dirX, dirY, dirZ).applyQuaternion(this.trunkInverse);
    if (
      intersectStorageGrid(this.trunkEye, this.trunkDirection, halfExtents, side, this.trunkRayHit) &&
      this.trunkRayHit.distance <= BOOT_RANGE
    ) {
      this.trunkPickedCell = this.trunkRayHit.cell;
      this.trunkPickedDistance = this.trunkRayHit.distance;
      return true;
    }

    if (Math.abs(this.trunkDirection.z) < 1e-5) return false;
    const planeZ = side === 'bonnet'
      ? halfExtents[2] + TRUNK_GRID_DEPTH
      : -halfExtents[2] - TRUNK_GRID_DEPTH;
    const distance = (planeZ - this.trunkEye.z) / this.trunkDirection.z;
    if (distance <= 0 || distance > BOOT_RANGE) return false;

    const localX = this.trunkEye.x + this.trunkDirection.x * distance;
    const localY = this.trunkEye.y + this.trunkDirection.y * distance;
    const halfWidth = trunkGridWidth(halfExtents[0]) * 0.5 + BOOT_REVEAL_MARGIN;
    const halfHeight = storageGridRows(side) * TRUNK_CELL_HEIGHT * 0.5 + BOOT_REVEAL_MARGIN;
    const centreY = storageGridCentreY(halfExtents[1]);
    if (Math.abs(localX) > halfWidth || Math.abs(localY - centreY) > halfHeight) {
      return false;
    }
    this.trunkPickedCell = null;
    this.trunkPickedDistance = distance;
    return true;
  }

  private resolve(
    eyeX: number,
    eyeY: number,
    eyeZ: number,
    dirX: number,
    dirY: number,
    dirZ: number,
  ): Resolved {
    const dirLen = Math.hypot(dirX, dirY, dirZ) || 1;
    const dx = dirX / dirLen;
    const dy = dirY / dirLen;
    const dz = dirZ / dirLen;

    let bestDist = Infinity;
    let target: Target = { kind: 'none' };
    const keep = (dist: number, next: Target): void => {
      if (dist < bestDist) {
        bestDist = dist;
        target = next;
      }
    };

    // Loose parts/items have colliders, so the physics ray resolves them directly.
    // Exclude the player's own capsule: the eye origin sits inside it, and
    // `castRayAndGetNormal(..., solid = true)` returns an immediate zero-distance
    // self-hit unless the capsule body is excluded. `attachPlayer` runs right after
    // construction, but if it has not (player is null) there is no capsule to
    // exclude — the MIN_HIT_TOI guard below still catches any residual self-hit
    // rather than crashing.
    const hit = this.physics.raycast(
      { x: eyeX, y: eyeY, z: eyeZ },
      { x: dx, y: dy, z: dz },
      RAY_RANGE,
      this.player?.rigidBody,
    );
    if (hit && hit.toi >= MIN_HIT_TOI) {
      // One physics hit, five possible owners. Each map is keyed by collider handle,
      // so the whole chain is a handful of hash lookups on the aim ray's hit.
      const h = hit.colliderHandle;
      const partId = this.loose.partIdForCollider(h);
      const itemId = partId ? null : this.loose.itemIdForCollider(h);
      const trailerId = partId || itemId ? null : this.trailers.trailerIdForCollider(h);
      if (partId) keep(hit.toi, { kind: 'loose-part', partId });
      else if (itemId) keep(hit.toi, { kind: 'loose-item', itemId });
      else if (trailerId) keep(hit.toi, { kind: 'trailer', trailerId });
    }

    // The parked plane is a large hull, so boarding is offered out to `VEHICLE_RANGE`
    // rather than the picking range. A second ray at that reach keeps every other
    // target's reach exactly as it was and still occludes on whatever stands in front.
    const boardHit = this.physics.raycast(
      { x: eyeX, y: eyeY, z: eyeZ },
      { x: dx, y: dy, z: dz },
      VEHICLE_RANGE,
      this.player?.rigidBody,
    );
    if (boardHit && boardHit.toi >= MIN_HIT_TOI && this.boardable.has(boardHit.colliderHandle)) {
      keep(boardHit.toi, { kind: 'aircraft' });
    }

    let vehicle: Vehicle | null = null;
    let carId: string | null = null;
    let vehicleDist = Infinity;
    const tv = this.targetVehicle();
    if (tv) {
      vehicle = tv.vehicle;
      carId = tv.carId;
      const t = vehicle.chassis.translation(this.tScratch);
      vehicle.chassis.rotation(this.qScratch);
      vehicleDist = Math.hypot(t.x - eyeX, t.y - eyeY, t.z - eyeZ);

      // Rear and front use the same deliberate close-range interaction. The nearer
      // plane wins, so a long bus cannot expose both ends at once.
      const half = vehicle.modelMeasure.halfExtents;
      for (const side of ['trunk', 'bonnet'] as const) {
        if (this.pickStorage(eyeX, eyeY, eyeZ, dx, dy, dz, t, this.qScratch, half, side)) {
          keep(this.trunkPickedDistance, {
            kind: 'storage',
            owner: 'car',
            side,
            id: carId,
            cell: this.trunkPickedCell,
          });
        }
      }

      // Ordinary entry and whole-body cleaning need only the chassis collider already
      // hit by Rapier above. The full render mesh is raycast only on the one frame a
      // sticker is actually placed; walking near a detailed car stays constant-time.
      if (
        vehicleDist <= VEHICLE_RANGE &&
        hit &&
        vehicle.isChassisCollider(hit.colliderHandle)
      ) {
        keep(hit.toi, { kind: 'car-entry', carId });
      }
    }

    for (const wreck of this.wreckTrunks.values()) {
      this.trunkPosition.set(wreck.x - this.origin.x, wreck.y, wreck.z - this.origin.z);
      this.trunkQuaternion.set(wreck.qx, wreck.qy, wreck.qz, wreck.qw);
      // Both ends of a shell are openable, exactly as a driven car's are: the rear
      // gives up the trunk's cans and tools, the service cells under the bonnet give
      // up the worn parts. The nearer plane wins, so a buried nose exposes its boot.
      for (const side of ['trunk', 'bonnet'] as const) {
        if (
          this.pickStorage(
            eyeX,
            eyeY,
            eyeZ,
            dx,
            dy,
            dz,
            this.trunkPosition,
            this.trunkQuaternion,
            wreck.halfExtents,
            side,
          )
        ) {
          keep(this.trunkPickedDistance, {
            kind: 'storage',
            owner: 'wreck',
            side,
            id: wreck.id,
            cell: this.trunkPickedCell,
          });
        }
      }
    }

    for (const courier of this.couriers.values()) {
      this.trunkPosition.set(
        courier.x - this.origin.x,
        courier.y,
        courier.z - this.origin.z,
      );
      this.trunkQuaternion.set(courier.qx, courier.qy, courier.qz, courier.qw);
      if (
        this.pickStorage(
          eyeX,
          eyeY,
          eyeZ,
          dx,
          dy,
          dz,
          this.trunkPosition,
          this.trunkQuaternion,
          courier.halfExtents,
          'trunk',
        )
      ) {
        keep(this.trunkPickedDistance, {
          kind: 'storage',
          owner: 'courier',
          side: 'trunk',
          id: courier.id,
          cell: this.trunkPickedCell,
        });
      }
    }

    return { target, vehicle, carId, vehicleDist };
  }

  /**
   * Exact body surface for sticker placement.
   *
   * This intentionally runs only on the sticker key edge. Three.js checks the render
   * triangles on CPU; using it as the standing interaction probe made every fixed
   * tick near a detailed car walk the complete mesh.
   */
  private pickBody(
    vehicle: Vehicle,
    eyeX: number,
    eyeY: number,
    eyeZ: number,
    dx: number,
    dy: number,
    dz: number,
  ): {
    distance: number;
    valid: boolean;
    local: { point: THREE.Vector3; normal: THREE.Vector3 };
  } | null {
    this.raycaster.set(
      this.rayOrigin.set(eyeX, eyeY, eyeZ),
      this.rayDir.set(dx, dy, dz).normalize(),
    );
    this.raycaster.far = VEHICLE_RANGE;
    this.hits.length = 0;
    this.raycaster.intersectObject(vehicle.root, true, this.hits);
    for (const hit of this.hits) {
      if (!hit.face) continue;
      // The nearest face decides: a sticker cannot be aimed through a mirror or a
      // bumper at the panel behind it.
      const stickerSlots = hit.object.userData.stickerMaterialIndices as number[] | undefined;
      const mesh = hit.object as THREE.Mesh;
      const faceMaterial = Array.isArray(mesh.material) ? mesh.material[hit.face.materialIndex] : mesh.material;
      // Every car's own copy of the shared glass keeps its name (render/carmodel.ts).
      const glass = faceMaterial?.name === 'car-glass';
      if (!glass && !stickerSlots?.includes(hit.face.materialIndex)) break;
      const distance = hit.distance;
      this.stickerPoint.copy(hit.point);
      vehicle.root.worldToLocal(this.stickerPoint);
      this.stickerNormal
        .copy(hit.face.normal)
        .applyNormalMatrix(this.stickerNormalMatrix.getNormalMatrix(hit.object.matrixWorld))
        .normalize();
      vehicle.root.getWorldQuaternion(this.qBody).invert();
      this.stickerNormal.applyQuaternion(this.qBody).normalize();
      this.hits.length = 0;
      return {
        distance,
        // Any aimed point on paint or glass is valid: the decal is clipped to what can
        // carry it (render/stickerdecals.ts), so nothing overhangs an edge.
        valid: true,
        local: { point: this.stickerPoint, normal: this.stickerNormal },
      };
    }
    this.hits.length = 0;
    return null;
  }

  /**
   * The car interaction is aimed at, with its id.
   *
   * The id comes from the caller, which already knows it. It used to be recovered
   * here by matching the live chassis position against every `CarState`'s SAVED
   * transform — which is correct only while those two agree. They do not agree for
   * any car moved without a `car_transform` delta, and the failure is silent and
   * nasty: `resolved.vehicle` is the right car while `resolved.carId` names a
   * different one, so a trailer coupled to the car in front of you reads as absent.
   */
  private targetVehicle(): { carId: string; vehicle: Vehicle } | null {
    return this.getVehicle();
  }

  /**
   * F is both vehicle entry and world manipulation by default. A specific aimed
   * target wins. Looking at plain car body enters it; that body only becomes a
   * world-manipulation target while there is a sticker to place.
   */
  private mountHasPriority(target: Target): boolean {
    if (target.kind === 'none') return false;
    // F boards the plane rather than manipulating it; see `fixedUpdate`.
    if (target.kind === 'aircraft') return false;
    if (target.kind === 'car-body' || target.kind === 'car-entry') {
      return this.inventory.held?.type === 'sticker_envelope';
    }
    return true;
  }

  private promptFor(resolved: Resolved): string | null {
    const held = this.inventory.held;
    const t = resolved.target;

    // The bar is offered before anything the aim could name, because it is the one
    // action that is about where the player STANDS rather than what he looks at.
    // It is cleared whenever the aim named something with its own action (see
    // `fixedUpdate`), so a boot cell or a trailer in the crosshair keeps its prompt.
    if (this.towActionValue) return this.towPrompt(this.towActionValue);

    if (t.kind === 'aircraft') return '[F] board the plane';


    if (t.kind === 'loose-part') {
      const part = this.world.state.looseParts[t.partId]?.part;
      if (!part) return null;
      const toolPrompt = this.toolPrompt(held, part);
      if (toolPrompt) return toolPrompt;
      // A container on the ground offers the pour first: holding a can over a
      // dry engine means one thing, and picking it up is still [F].
      const reservoir = held?.type === 'fluid_can' ? this.aimedReservoir(resolved) : null;
      if (reservoir) return this.pourPrompt(held as FluidCanItem, reservoir);
      const container = loosePartReservoir(part);
      const holding = container ? ` — ${fillReadout(container)}` : '';
      const worn = part.clog !== undefined ? ` — ${Math.round(part.clog * 100)}% clogged` : '';
      return `[F] pick up ${conditionPrefix(part)}${variant(part.variantId).label}${holding}${worn}`;
    }

    if (t.kind === 'loose-item') {
      const item = this.world.state.looseItems[t.itemId]?.item;
      if (!item) return null;
      // Can-to-can: the same gesture as filling a tank, so a five-litre oil can
      // found half full can be consolidated instead of carried twice. A held can is
      // in the pack, never in the loose field, so it can never be its own target.
      if (held?.type === 'fluid_can' && item.type === 'fluid_can') {
        const reservoir = this.aimedReservoir(resolved);
        if (reservoir) return this.pourPrompt(held, reservoir);
      }
      return `[F] pick up ${itemLabel(item)}`;
    }



    if (t.kind === 'storage') {
      const cells = this.storageCells(t);
      if (!cells) return null;
      const label = t.side === 'bonnet' ? 'bonnet' : 'trunk';
      if (!this.isStorageOpen(t)) return `[F] open ${label}`;

      let used = 0;
      for (const cell of cells) {
        if (cell) used++;
      }
      if (t.cell === null) return `${label} ${used}/${cells.length}`;
      const item = cells[t.cell];
      if (item) {
        // A fitted engine, radiator or fuel tank reports what it is holding.
        // Same resolution the pour uses, so the number you read is the number a can
        // fills — and holding one turns the readout into the pour offer itself.
        const reservoir = this.aimedReservoir(resolved);
        if (reservoir) {
          if (held?.type === 'fluid_can') return this.pourPrompt(held, reservoir);
          return `[F] take ${itemLabel(item)} — ${fillReadout(reservoir)}`;
        }
        return `[F] take ${itemLabel(item)} — cell ${t.cell + 1}`;
      }
      if (t.side === 'bonnet') {
        const expected = bonnetSlotKind(t.cell);
        const slotLabel = expected?.replace('_', ' ') ?? 'service';
        if (!held) return `empty ${slotLabel} slot`;
        if (!bonnetAccepts(t.cell, held)) return `${slotLabel} slot — wrong part`;
        return `[F] install ${itemLabel(held)} — ${slotLabel} slot`;
      }
      if (held?.type === 'contract_cargo' && t.owner === 'courier') {
        const courier = this.couriers.get(t.id);
        if (!courier) return null;
        const refusal = contractAcceptRefusal(held, this.deliveryProbe(courier));
        if (refusal) return refusal;
        return `[F] deliver ${itemLabel(held)} — receive signed envelope`;
      }
      if (
        held?.type === 'contract_cargo'
        && t.owner === 'car'
        && cells.some((cell) => cell?.type === 'contract_cargo')
      ) {
        return 'one contract parcel is already aboard';
      }
      if (held) return `[F] stow ${itemLabel(held)} — cell ${t.cell + 1}`;
      return `empty trunk cell ${t.cell + 1}`;
    }

    if (t.kind === 'car-body' || t.kind === 'car-entry') {
      const car = this.world.state.cars[t.carId];
      if (!car) return null;
      const bodyPrompt = this.bodyToolPrompt(held, car);
      if (held?.type === 'spray_can') return this.sprayPrompt(held, car);
      if (bodyPrompt) return bodyPrompt;
      if (held?.type === 'sticker_envelope') return '[F] preview sticker placement';
    }

    if (t.kind === 'trailer') {
      const trailer = this.trailers.get(t.trailerId);
      if (!trailer) return null;
      const load = trailer.cargoKg > 0 ? ` — ${Math.round(trailer.cargoKg)} kg aboard` : ' — empty';
      if (trailer.hitchedTo !== null) return `[F] unhitch trailer${load}`;
      if (!resolved.carId || !resolved.vehicle || resolved.vehicleDist > HITCH_CAR_RANGE) {
        return `trailer${load} — bring a car alongside`;
      }
      const already = this.trailers.hitchedTo(resolved.carId);
      if (already && already.id !== t.trailerId) return 'that car is already towing';
      return `[F] hitch to ${carModel(this.world.state.cars[resolved.carId]!.modelId).label}`;
    }

    if (
      (t.kind === 'car-body' || t.kind === 'car-entry') &&
      resolved.vehicle &&
      resolved.carId &&
      resolved.vehicleDist < VEHICLE_RANGE
    ) {
      const car = this.world.state.cars[resolved.carId];
      return this.cabinRefusal()
        ?? (car ? `[F] enter ${carModel(car.modelId).label}` : '[F] enter vehicle');
    }
    return null;
  }

  /**
   * The reservoir under the crosshair. Three kinds resolve here so that the level
   * readout and the pour can never disagree about which container you are looking
   * at: a fitted engine, radiator or tank in an OPENED bonnet; the same three parts
   * lying loose in the world; and a can on the ground.
   *
   * Filling a part before it is installed is the point of the loose cases. A wreck
   * gives up a dry engine, you top it up where it lies, and the car it goes into
   * receives that oil through the normal installation transfer (`moveSlotFluid` in
   * game/state.ts) instead of needing a second trip with the can.
   */
  private aimedReservoir(resolved: Resolved): AimedReservoir | null {
    const t = resolved.target;
    if (t.kind === 'loose-part') {
      const part = this.world.state.looseParts[t.partId]?.part;
      if (!part) return null;
      const reservoir = loosePartReservoir(part);
      return reservoir ? { ...reservoir, sink: 'loose-part', partId: t.partId } : null;
    }
    if (t.kind === 'loose-item') {
      const item = this.world.state.looseItems[t.itemId]?.item;
      if (item?.type !== 'fluid_can') return null;
      return {
        label: `${item.fluid} can`,
        level: item.litres,
        capacity: item.capacity,
        // A can holds one fluid and mixes nothing.
        wants: item.fluid,
        sink: 'loose-can',
        itemId: t.itemId,
      };
    }
    if (t.kind !== 'storage' || t.side !== 'bonnet' || t.owner !== 'car' || t.cell === null) {
      return null;
    }
    if (!this.isStorageOpen(t) || !resolved.vehicle) return null;
    const car = this.world.state.cars[t.id];
    if (!car) return null;
    const reservoir = bonnetReservoir(car, resolved.vehicle.stats, t.cell);
    return reservoir ? { ...reservoir, sink: 'car', carId: t.id } : null;
  }

  /**
   * What pouring this can into the aimed reservoir would do, or why it would not.
   * Each reservoir takes exactly one fluid.
   * An empty can drops to the bare level readout rather than announcing itself. The
   * can's own litres are already on the inventory slot, and the tank is not the
   * place to report them: what the bonnet is for is how much is in the CAR.
   */
  private pourPrompt(can: FluidCanItem, reservoir: Reservoir): string {
    if (!reservoirAccepts(reservoir, can.fluid)) {
      return `${fillReadout(reservoir)} — ${can.fluid} does not go in there`;
    }
    // Nothing to pour, or nowhere to put it: the level is the whole answer.
    if (can.litres <= 0 || reservoir.level >= reservoir.capacity - FLUID_FULL_EPSILON) {
      return fillReadout(reservoir);
    }
    return `[LMB] pour ${can.fluid} — ${fillReadout(reservoir)}`;
  }

  private toolPrompt(held: Item | null, part: PartInstance): string | null {
    if (held?.type !== 'tool') return null;
    if (part.rust <= RUST_CLEAN_EPSILON && part.dirt <= 0.005) return 'clean';
    return `[LMB] scrub ${scrubLabel(part)}`;
  }


  /**
   * Body-condition readouts use whole percentages: one short HUD line is easier to
   * scan than two 0..1 fractions, while retaining enough precision for a cosmetic
   * condition that moves by only 0.55 or 0.70 per second.
   */
  private bodyToolPrompt(held: Item | null, car: CarState): string | null {
    if (held?.type !== 'tool') return null;
    const dirtFraction = Math.min(1, Math.max(0, car.dirt));
    const scratchFraction = Math.min(1, Math.max(0, car.scratches));
    const dirt = Math.round(dirtFraction * 100);
    const scratches = Math.round(scratchFraction * 100);
    if (dirtFraction <= 0 && scratchFraction <= BODY_SCRATCH_FLOOR) {
      return 'body clean and polished';
    }
    return `[LMB] sponge — body ${dirt}% dirt, ${scratches}% scratched`;
  }

  /** What spraying this car with this can would do, as the HUD line. */
  private sprayPrompt(can: SprayCanItem, car: CarState): string {
    const name = carPaintSwatch(can.paint)?.name ?? 'paint';
    const paint = car.paint;
    const cover = paint !== null && paint.coat === can.paint ? paint.cover : 0;
    if (cover >= 1 || (paint === null && visiblePaintHex(null, car.modelId, car.id) === can.paint)) {
      return `body already ${name}`;
    }
    if (can.charge <= 0) return `${name} can is empty`;
    return `[LMB] spray ${name} — ${Math.round(cover * 100)}% coat`;
  }

  private usePrimary(dt: number, resolved: Resolved): void {
    const held = this.inventory.held;
    if (!held) return;
    if (held.type === 'tool') this.scrub(dt, held, resolved);
    else if (held.type === 'fluid_can') this.pourFluid(dt, held, resolved);
    else if (held.type === 'spray_can') this.spray(dt, held, resolved);
  }

  /**
   * Lays the held can's colour over the car's body. A new colour starts a fresh coat
   * over whatever is visible now, factory paint or an unfinished coat alike; the same
   * colour continues its coat. State is written stroke by stroke (the Vehicle paints
   * it each frame) and reported on the condition cadence.
   */
  private spray(dt: number, can: SprayCanItem, resolved: Resolved): void {
    const t = resolved.target;
    if ((t.kind !== 'car-body' && t.kind !== 'car-entry') || !resolved.vehicle) return;
    const car = this.world.state.cars[t.carId];
    if (!car || can.charge <= 0) return;
    let paint = car.paint;
    if (paint === null || paint.coat !== can.paint) {
      const base = visiblePaintHex(paint, car.modelId, car.id);
      if (base === can.paint) return;
      paint = { base, coat: can.paint, cover: 0 };
      car.paint = paint;
    }
    if (paint.cover >= 1) return;
    paint.cover = Math.min(1, paint.cover + dt / SPRAY_COAT_SECONDS);
    can.charge = Math.max(0, can.charge - dt / SPRAY_CAN_SECONDS);
    this.continuous = 'spray';
    this.conditionEmitTimer += dt;
    if (this.conditionEmitTimer >= CONDITION_EMIT_INTERVAL || paint.cover >= 1 || can.charge <= 0) {
      this.conditionEmitTimer = 0;
      this.world.apply({ t: 'car_paint', carId: t.carId, paint: { ...paint } });
    }
  }

  private scrub(dt: number, sponge: ToolItem, resolved: Resolved): void {
    if (spongeSpent(sponge)) return;
    if (resolved.target.kind === 'car-body' || resolved.target.kind === 'car-entry') {
      this.scrubBody(dt, sponge, resolved);
      return;
    }
    const part = this.targetPart(resolved);
    if (!part) return;
    const removed = applySponge(part, dt, sponge.capacity * sponge.integrity);
    if (removed <= 0) return;
    this.wearSponge(sponge, removed);
    this.continuous = 'scrub';
    this.applyConditionVisual(resolved, part);
    this.conditionEmitTimer += dt;
    if (this.conditionEmitTimer >= CONDITION_EMIT_INTERVAL || spongeSpent(sponge)) {
      this.conditionEmitTimer = 0;
      this.world.apply({ t: 'part_condition', partId: part.id, dirt: part.dirt, rust: part.rust });
    }
  }

  /**
   * Takes what a stroke cleaned off the sponge's life. A spent sponge has turned the
   * colour of what it took off and is no use to anyone: it falls from the hand at the
   * player's feet, the way a used-up rag is dropped.
   */
  private wearSponge(sponge: ToolItem, removed: number): void {
    sponge.integrity = Math.max(0, sponge.integrity - removed / Math.max(1e-4, sponge.capacity));
    if (!spongeSpent(sponge)) return;
    sponge.integrity = 0;
    this.spentSponge = sponge.id;
  }

  /**
   * Cleans the permanent shell condition, with the same quarter-second delta cadence
   * as parts. Each stroke writes the car's state directly, and the Vehicle adopts
   * any value it did not write itself on its next rendered frame (`syncVisuals`), so
   * a held sponge visibly works stroke by stroke rather than in 0.25-second jumps.
   * Dirt and scratches come off together and both wear the sponge.
   */
  private scrubBody(dt: number, sponge: ToolItem, resolved: Resolved): void {
    const t = resolved.target;
    if ((t.kind !== 'car-body' && t.kind !== 'car-entry') || !resolved.vehicle) return;
    const car = this.world.state.cars[t.carId];
    if (!car) return;

    const dirt = Math.min(1, Math.max(0, car.dirt));
    const scratches = Math.min(1, Math.max(0, car.scratches));
    const dirtStep = Math.min(dirt, BODY_SPONGE_DIRT_RATE * dt);
    const scratchStep = Math.max(0, Math.min(scratches - BODY_SCRATCH_FLOOR, BODY_SPONGE_SCRATCH_RATE * dt));
    const total = dirtStep + scratchStep;
    if (total <= 0) return;
    const k = Math.min(1, (sponge.capacity * sponge.integrity) / total);
    car.dirt = dirt - dirtStep * k;
    car.scratches = scratches - scratchStep * k;
    this.wearSponge(sponge, total * k);

    this.continuous = 'scrub';
    this.conditionEmitTimer += dt;
    if (this.conditionEmitTimer >= CONDITION_EMIT_INTERVAL || spongeSpent(sponge)) {
      this.conditionEmitTimer = 0;
      this.world.apply({
        t: 'car_body_condition',
        carId: t.carId,
        dirt: car.dirt,
        scratches: car.scratches,
      });
    }
  }

  /**
   * Pours the held can into the reservoir the crosshair is on.
   *
   * Aimed at the fitted part, not the car: you open the bonnet, look at the engine,
   * the radiator or the fuel tank, and hold the button. That makes the filling
   * gesture the same object as the level readout, and it is why an empty slot takes
   * nothing — there is no reservoir without the part that holds it.
   *
   * One code path for all three fluids. The kind decides only which number goes up.
   */
  private pourFluid(dt: number, can: FluidCanItem, resolved: Resolved): void {
    if (can.litres <= 0) return;

    const reservoir = this.aimedReservoir(resolved);
    if (!reservoir || !reservoirAccepts(reservoir, can.fluid)) return;

    const room = reservoir.capacity - reservoir.level;
    if (room <= FLUID_FULL_EPSILON) return;
    const poured = Math.min(FLUID_POUR_RATE * dt, can.litres, room);
    if (poured <= 0) return;

    const level = reservoir.level + poured;

    switch (reservoir.sink) {
      case 'car': {
        if (!this.world.state.cars[reservoir.carId]) return;
        if (can.fluid === 'petrol') {
          this.world.apply({ t: 'car_fuel', carId: reservoir.carId, litres: level });
        } else {
          // Oil and water accept nothing but themselves, so the can names the channel.
          this.world.apply({
            t: 'car_fluid',
            carId: reservoir.carId,
            fluid: can.fluid,
            litres: level,
          });
        }
        break;
      }
      case 'loose-part': {
        if (!this.world.state.looseParts[reservoir.partId]) return;
        this.world.apply({ t: 'loose_part_fluid', partId: reservoir.partId, litres: level });
        break;
      }
      case 'loose-can': {
        this.world.apply({ t: 'loose_item_fluid', itemId: reservoir.itemId, litres: level });
        break;
      }
    }
    can.litres -= poured;
    this.continuous = 'pour';
  }

  private mount(resolved: Resolved): void {
    const t = resolved.target;
    const held = this.inventory.held;

    // The bar wins the F key where it is offered: see `promptFor`.
    if (this.towActionValue) {
      this.applyTowAction(this.towActionValue);
      return;
    }

    if (t.kind === 'loose-part') {
      const loose = this.world.state.looseParts[t.partId];
      if (!loose) return;
      const item: PartItem = { type: 'part', id: loose.part.id, part: loose.part };
      // A refused pickup is as informative as a successful one: it is the only
      // feedback that the pack is full, besides the prompt already saying so.
      if (this.inventory.add(item)) {
        this.loose.remove(loose.part.id);
        this.sound = 'pickup';
      } else {
        this.sound = 'refused';
      }
      return;
    }

    if (t.kind === 'loose-item') {
      const loose = this.world.state.looseItems[t.itemId];
      if (!loose) return;
      if (this.inventory.add(loose.item)) {
        this.loose.remove(loose.item.id);
        this.sound = 'pickup';
      } else {
        this.sound = 'refused';
      }
      return;
    }

    if (t.kind === 'trailer') {
      const trailer = this.trailers.get(t.trailerId);
      if (!trailer) return;
      if (trailer.hitchedTo !== null) {
        trailer.unhitch();
        this.sound = 'drop';
        return;
      }
      // One trailer per car: a second coupling on the same rear axle would put two
      // joints on one anchor and the solver would fight itself.
      if (!resolved.carId || !resolved.vehicle || resolved.vehicleDist > HITCH_CAR_RANGE) return;
      if (this.trailers.hitchedTo(resolved.carId)) return;
      trailer.hitchTo(resolved.vehicle, resolved.carId);
      this.sound = 'mount';
      return;
    }


    // The first press opens a compartment. Further presses operate its aimed cell.
    if (t.kind === 'storage') {
      if (!this.isStorageOpen(t)) {
        // Located from the same transform the target was resolved against, so this
        // cannot fail in practice; refusing to open rather than guessing a position
        // keeps the persistence rule measuring a real compartment.
        if (!this.storageGridCentre(t, resolved.vehicle, this.vScratch)) return;
        this.openStorage = {
          owner: t.owner,
          side: t.side,
          id: t.id,
          x: this.vScratch.x,
          y: this.vScratch.y,
          z: this.vScratch.z,
        };
        this.sound = 'mount';
        return;
      }
      if (t.cell === null) return;
      const cells = this.storageCells(t);
      if (!cells) return;
      if (t.side === 'bonnet' && !cells[t.cell] && !bonnetAccepts(t.cell, held)) {
        this.sound = 'refused';
        return;
      }
      if (!cells[t.cell] && held?.type === 'contract_cargo' && t.owner === 'courier') {
        const courier = this.couriers.get(t.id);
        if (!courier) {
          this.sound = 'refused';
          return;
        }
        const probe = this.deliveryProbe(courier);
        if (contractAcceptRefusal(held, probe)) {
          this.sound = 'refused';
          return;
        }
        // The kind decides the payout here: its signature sticker when its own
        // condition held, the offer's seed-random sticker otherwise. A delivery
        // never fails.
        const delivery: DeliveryContext = { item: held, probe };
        const envelope: StickerEnvelopeItem = {
          type: 'sticker_envelope',
          id: `${held.id}:signed:${courier.index}`,
          stickerKind: contractRewardSticker(held, delivery),
          completedContractId: held.id,
        };
        // What the kind consumes besides the cargo: the trailer or car the contract
        // named. The world deltas follow the `courier_storage` delta that writes the
        // completed id, so a crash between the halves cannot pay twice.
        const effect = contractDeliveryEffect(held, probe, delivery);
        const nextCells = cells.slice();
        nextCells[t.cell] = envelope;
        // A race won pays its coins beside the envelope, or into the pack when the
        // courier's boot is full (they stack onto a coin already carried).
        const coins = this.raceCoins(held.id);
        let coinToPack: CoinItem | null = null;
        if (coins > 0) {
          const coin: CoinItem = { type: 'coin', id: `${held.id}:coin`, value: coins };
          const free = nextCells.findIndex((cell) => cell === null);
          if (free >= 0) nextCells[free] = coin;
          else coinToPack = coin;
        }
        this.world.apply({
          t: 'courier_storage',
          courierId: t.id,
          cells: nextCells,
          consumedItemId: held.id,
          completedContractId: held.id,
        });
        if (effect?.deltas) {
          for (const delta of effect.deltas) this.world.apply(delta);
        }
        this.inventory.remove(held.id);
        if (coinToPack) this.inventory.add(coinToPack);
        this.sound = 'mount';
        return;
      }
      if (
        !cells[t.cell]
        && held?.type === 'contract_cargo'
        && t.owner === 'car'
        && cells.some((cell) => cell?.type === 'contract_cargo')
      ) {
        this.sound = 'refused';
        return;
      }
      const result = operateTrunkCell(cells, t.cell, held, this.inventory);
      if (result.action === 'refused') {
        this.sound = 'refused';
        return;
      }
      if (result.action === 'none') return;
      if (t.owner === 'wreck') {
        this.world.apply(
          t.side === 'bonnet'
            ? { t: 'wreck_bonnet', wreckId: t.id, cell: t.cell, item: result.item }
            : { t: 'wreck_storage', wreckId: t.id, cell: t.cell, item: result.item },
        );
      } else if (t.owner === 'courier') {
        const nextCells = cells.slice();
        nextCells[t.cell] = result.item;
        this.world.apply({ t: 'courier_storage', courierId: t.id, cells: nextCells });
      } else if (t.side === 'bonnet') {
        // The delta itself moves the slot's fluid into the part coming out and out of
        // the part going in (`moveSlotFluid`, game/state.ts). Nothing to zero here.
        this.world.apply({ t: 'car_bonnet', carId: t.id, cell: t.cell, item: result.item });
        resolved.vehicle?.rebuild();
      } else {
        this.world.apply({ t: 'car_storage', carId: t.id, cell: t.cell, item: result.item });
      }
      this.sound = result.action === 'retrieved' ? 'pickup' : 'drop';
      return;
    }
  }

  /**
   * Drops the held item 1.2 m down the view ray, pulled back to just short of any
   * geometry the ray hits first so a drop aimed at a wall cannot spawn inside it.
   * The player's capsule is excluded exactly as the aim ray does: the eye origin
   * sits inside it, and its zero-distance self-hit would collapse the drop point
   * onto the eye.
   */
  private drop(
    eyeX: number,
    eyeY: number,
    eyeZ: number,
    dirX: number,
    dirY: number,
    dirZ: number,
  ): void {
    const held = this.inventory.held;
    if (!held) return;
    const dirLen = Math.hypot(dirX, dirY, dirZ) || 1;
    const dx = dirX / dirLen;
    const dy = dirY / dirLen;
    const dz = dirZ / dirLen;

    const hit = this.physics.raycast(
      { x: eyeX, y: eyeY, z: eyeZ },
      { x: dx, y: dy, z: dz },
      DROP_DISTANCE,
      this.player?.rigidBody,
    );
    // The floor is the same self-hit guard the aim ray uses: never spawn nearer to
    // the eye than a real target could be, even with a wall at arm's length.
    const dist = hit ? Math.max(hit.toi - DROP_WALL_MARGIN, MIN_HIT_TOI) : DROP_DISTANCE;

    // Remove from the inventory first so a dropped item can never be double-held,
    // then materialise it; spawn/spawnItem record state before building the body.
    this.inventory.remove(held.id);
    // The eye is in the scene's relative frame; the loose field stores absolute,
    // saved positions.
    const dropX = eyeX + dx * dist + this.origin.x;
    const dropY = eyeY + dy * dist;
    const dropZ = eyeZ + dz * dist + this.origin.z;
    if (held.type === 'part') this.loose.spawn(held.part, dropX, dropY, dropZ);
    else this.loose.spawnItem(held, dropX, dropY, dropZ);
    this.sound = 'drop';
  }

  private targetPart(resolved: Resolved): PartInstance | null {
    const t = resolved.target;
    if (t.kind === 'loose-part') return this.world.state.looseParts[t.partId]?.part ?? null;
    return null;
  }

  private applyConditionVisual(resolved: Resolved, part: PartInstance): void {
    const t = resolved.target;
    if (t.kind === 'loose-part') {
      const mesh = this.loose.meshFor(t.partId);
      if (mesh) setPartCondition(mesh, part);
    }
  }

  private tryEnter(resolved: Resolved): void {
    if (!resolved.vehicle || !resolved.carId) return;
    const target = resolved.target;
    if (
      (target.kind !== 'car-body' && target.kind !== 'car-entry') ||
      target.carId !== resolved.carId ||
      resolved.vehicleDist >= VEHICLE_RANGE
    ) return;
    if (this.cabinRefusal() !== null) {
      this.sound = 'refused';
      return;
    }
    this.world.apply({ t: 'enter_car', carId: resolved.carId });
    this.player?.setEnabled(false);
    this.sound = 'enter-car';
  }

  /**
   * Why the player cannot sit down with what they carry, else null. The pack rides in
   * the cabin, so a contract parcel in it was a second parcel aboard past the boot's
   * one-parcel rule; a parcel goes in the boot. And an engine does not fit on a lap.
   */
  private cabinRefusal(): string | null {
    for (const item of this.inventory.contents) {
      if (item.type === 'contract_cargo') return `stow the ${itemLabel(item)} in the boot first`;
      if (itemMass(item) > CABIN_ITEM_LIMIT_KG) return `the ${itemLabel(item)} won't fit in the cabin`;
    }
    return null;
  }

  /**
   * The refusal prompt when the driven car is moving too fast to step out, else
   * null. `speedKmh` is absolute, so this covers reversing at speed as well as
   * driving forward. Kept separate from `tryExit` so a held key re-asks the gate
   * without re-running the exit itself, which stays edge-triggered.
   */
  private exitRefused(): string | null {
    const active = this.getVehicle();
    if (!active) return null;
    return active.vehicle.speedKmh >= EXIT_SPEED_LIMIT_KMH ? EXIT_REFUSED_PROMPT : null;
  }

  private tryExit(roadS: number): string | null {
    const carId = this.world.state.player.drivingCarId;
    if (!carId) return null;
    const active = this.getVehicle();
    if (!active) return null;
    if (active.vehicle.speedKmh >= EXIT_SPEED_LIMIT_KMH) return EXIT_REFUSED_PROMPT;
    this.world.apply({ t: 'exit_car' });
    this.sound = 'exit-car';
    const exit = this.computeExitPosition(carId, active.vehicle);
    if (this.player) {
      this.player.setEnabled(true);
      if (exit) this.player.teleport(exit.x, exit.y, exit.z, roadS);
    }
    return null;
  }

  private computeExitPosition(
    carId: string,
    vehicle: Vehicle,
  ): { x: number; y: number; z: number } | null {
    const car = this.world.state.cars[carId];
    if (!car) return null;
    const measure = vehicle.modelMeasure;
    const chassis = vehicle.chassis;
    const t = chassis.translation(this.tScratch);
    chassis.rotation(this.qScratch);

    // The left flank is a featureless shell with baked doors, so exit at the
    // measured left edge stepped a further 1.1 m outward. Model convention:
    // +X is left, the models face +Z (see render/carmodel.ts).
    this.vScratch.set(measure.halfExtents[0] + 1.1, 0, 0).applyQuaternion(this.qScratch);
    const exitX = t.x + this.vScratch.x;
    const exitZ = t.z + this.vScratch.z;

    // Ground check so exiting never drops the player inside geometry. Exclude the
    // player's own capsule for the same reason as the aim ray: it is about to be
    // placed at this spot, so it must never count as the ground.
    //
    // The ray is RELATIVE: `exitX`/`exitZ` came off a chassis translation, and Rapier
    // is the relative frame. The RETURN is absolute, because `Player.teleport` takes a
    // world position — so the origin goes back on here and nowhere else, which keeps
    // the ray and the teleport each in the frame it needs.
    const ground = this.physics.raycast(
      { x: exitX, y: t.y + 2, z: exitZ },
      { x: 0, y: -1, z: 0 },
      6,
      this.player?.rigidBody,
    );
    const groundY = ground ? ground.point.y : t.y - measure.halfExtents[1];
    return { x: exitX + this.origin.x, y: groundY, z: exitZ + this.origin.z };
  }
}
