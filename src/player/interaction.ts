import * as THREE from 'three';
import type { PhysicsWorld } from '../core/physics';

import type { CarState, GameWorld, PlayerSeat, StickerState } from '../game/state';
import { contractAcceptRefusal, contractDeliveryEffect, contractRewardSticker } from '../contracts/registry';
import type { DeliveryProbe } from '../contracts/types';
import { contractPay, contractSlotsFor, giveCoins, licenceFor } from '../economy/economy';
import { TOW_COUPLE_RANGE_M, towEyeWorld, type CarTowField } from '../vehicle/cartow';
import type { InputFrame } from '../core/input';
import type {
  Inventory,
  Item,
  PartItem,
  FluidCanItem,
  FluidKind,
  SprayCanItem,
  StickerEnvelopeItem,
  ToolItem,
} from '../items/items';
import { INVENTORY_ITEM_LIMIT, itemLabel, itemMass, litreText, spongeSpent } from '../items/items';
import { CABIN_PLACES, cabinIndex, layPlace, placeSeats, seatTaken, takePlace } from '../vehicle/cabin';
import { cabinItemBounds } from '../vehicle/cabincargo';
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
  STORAGE_LID_CHANNELS,
  storageGridCentreLocal,
  storageLidSide,
  storageRevealDistance,
  TRUNK_CELL_COUNT,
  type StorageGridShape,
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
import { CAR_BODY_POSITION_ATTRIBUTE, setPartCondition } from '../render/materials';
import { carModelMeasure } from '../render/carmodel';
import { KIT_PICK_LAYER } from '../render/kitdraw';
import type { FoleyEvent, FoleyContinuous } from '../audio/foley';
import type { Player } from './player';
import type { WorldOrigin } from '../world/origin';
import type { WreckTrunkField } from '../world/wrecktrunks';
import type { StaticCarLids } from '../render/staticlids';
import type { CourierField, CourierTrunk } from '../world/couriers';
import type { BoardableField } from '../story/sitebuild';
import { STICKER_SCALE_MAX, STICKER_SCALE_MIN } from '../items/stickercatalog';
import { uprightStickerRoll } from '../render/stickers';
import { KitRig, type KitControl, type KitPicked } from '../carkit/rig';
import { KIT_BENCH_NODE } from '../carkit/interior';
import { coinsHeld, fuelPricePerLitre, itemPrice, spendCoins } from '../economy/economy';
import type { MarketField, VendingMachine } from '../world/market';
import { aimVending, PUMP_SLOT, vendingTrayPoint, type VendingAim } from '../world/vending';

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
/**
 * Slack around a kit door's opening for the entry test, metres: the eye ray may cross
 * the door plane a hand's width outside the shut door's outline (the seal, the
 * pillar's edge) and still count as aimed through the opening.
 */
const KIT_OPENING_SLACK = 0.08;
/** How long E holds a momentary fitting (the horn) down, seconds. */
const KIT_PRESS_SECONDS = 0.3;
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
 * that a battered 55% shell takes nearly four seconds to improve. It goes all the
 * way to zero.
 */
const BODY_SPONGE_SCRATCH_RATE = 0.12;
/** Fuel poured per second from a held can. */
const FUEL_POUR_RATE = 1.2;
/** Litres a FUEL machine's nozzle pours per second into a held can. */
const PUMP_RATE = 1.5;
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
  /** The open (or shut) fuel flap of a kit car, aimed at with a can in hand. */
  | { kind: 'filler'; carId: string }
  | { kind: 'aircraft' }
  | {
      kind: 'car-body';
      carId: string;
      point: THREE.Vector3;
      normal: THREE.Vector3;
      valid: boolean;
    }
  | { kind: 'loose-part'; partId: string }
  /** A vending machine's front; `slot` is the window slot aimed at, or -1 off the window. */
  | { kind: 'vending'; machineId: string; slot: number }
  /** An `InteractionFixture`, by its index in the list the composition root gave. */
  | { kind: 'fixture'; index: number };

/**
 * A fixed thing put in reach from outside the world catalogue — a dream's parcel
 * terminal (dreams/terminal.ts) — that aims, prompts and acts through itself, so the
 * interaction knows nothing about what it is.
 */
export interface InteractionFixture {
  /**
   * Distance along the eye ray to its face, metres, or Infinity for a miss. The eye is
   * in the physics frame (relative to the floating origin); `dx..dz` a unit direction.
   */
  aim(eyeX: number, eyeY: number, eyeZ: number, dx: number, dy: number, dz: number, range: number): number;
  /** The prompt while it is aimed at, or null for none. */
  prompt(): string | null;
  /** [F] on it; the sound it makes, or null. */
  act(): FoleyEvent | null;
}

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
  /**
   * The crosshair is on something a car's E or F works that no prompt names: a door,
   * lid, flap or fitting, a seat F sits in, an open flap a held can pours into. The HUD
   * lights the crosshair for it, and shows it at all while driving only then.
   */
  actionable: boolean;
}

/**
 * Litres a second a can transfers. Pouring is aimed at the fitted part that owns
 * the reservoir, inside an opened bonnet, or at the open fuel flap, so the grid's own
 * `BOOT_RANGE` is the whole proximity rule: there is no separate pour distance.
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
 * Aim forgiveness round the fuel flap's opening, on every side: the opening is a hand
 * across, and a can's spout is aimed at it, not threaded into it.
 */
const FILLER_AIM_MARGIN = 0.05;
/** A lid or the flap counts as open past half its travel, as the kit's own toggles do. */
const LID_OPEN = 0.5;
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
 *
 * A kit car's lids are the authority over its own grids (`followLids`): the grid opens
 * with its lid and shuts with it; this distance still lets it go when the player walks
 * away from a lid left open.
 */
const GRID_PERSIST_RANGE = BOOT_RANGE * 2;

/** What a sticker in hand asks for until the crosshair finds a car. */
const STICKER_HINT = 'sticker in hand · aim at a car to try it on';

const EMPTY_WRECK_TRUNK: readonly (Item | null)[] =
  new Array<Item | null>(TRUNK_CELL_COUNT).fill(null);
const EMPTY_WRECK_BONNET: readonly (Item | null)[] =
  new Array<Item | null>(BONNET_SLOT_COUNT).fill(null);

/**
 * A serviceable reservoir, resolved from the bonnet slot or the fuel flap the
 * crosshair is on.
 *
 * Oil and water are read and filled through the FITTED PART that holds them — the
 * engine, the radiator — so what the bonnet tells you is exactly what a can can pour
 * into. A missing part has no reservoir at all, and its fluid left with it (see
 * `moveSlotFluid` in game/state.ts). Petrol goes into the body's own tank, through
 * the flap (`fillerReservoir`).
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
    default:
      return null;
  }
}

/** The body's own fuel tank, read and filled through the flap. */
function fillerReservoir(car: CarState, stats: CarStats): Reservoir | null {
  if (stats.tankCapacity <= 0) return null;
  return { label: 'petrol', level: car.fuelLitres, capacity: stats.tankCapacity, wants: 'petrol' };
}

/**
 * Whether the lid over a compartment is open, on a kit car or a roadside shell: the
 * bonnet, or the boot lid or tailgate (either leaf of a split one), whichever the body
 * has (`STORAGE_LID_CHANNELS`). Null with no rig: a body with no lids, whose grids open on F.
 */
function lidOpen(rig: KitRig | null, side: StorageSide): boolean | null {
  if (!rig) return null;
  for (const channel of STORAGE_LID_CHANNELS[side]) if (rig.get(channel) > LID_OPEN) return true;
  return false;
}

/**
 * Whether a compartment's lid is open and is a cabin part reached through a side door
 * (`KIT_DOOR_REACH_PART`: the van's engine cover), not one of the shell's lids.
 */
function cabinLidOpen(rig: KitRig, side: StorageSide): boolean {
  for (const channel of STORAGE_LID_CHANNELS[side]) if (KIT_DOOR_REACH_PART.test(channel) && rig.get(channel) > LID_OPEN) return true;
  return false;
}

/**
 * Whether a roadside shell's compartment lies under a cabin lid (`KIT_DOOR_REACH_PART`):
 * the van's bay, reached only through the shell's open side door (`wreckDoors`).
 */
function wreckCabinCompartment(lids: StaticCarLids, side: StorageSide): boolean {
  for (const control of lids.controls) if (KIT_DOOR_REACH_PART.test(control.id) && storageLidSide(control.id) === side) return true;
  return false;
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
  const wants: FluidKind = container.channel;
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
  /**
   * The kit car's shell panel the eye ray meets (a side door, a lid, the flap), or null;
   * see `aimKit`. Only ever set for `vehicle`.
   */
  kitPart: KitPicked | null;
  /** The eye ray met the kit car's render mesh within reach. */
  kitHit: boolean;
  /** The side door the player stands at (see `kitEntryDoor`), or null. */
  kitDoor: KitDoor | null;
  /** F gets in, to this seat: the eye looks at it through an open side door's opening. */
  kitSeat: PlayerSeat | null;
  /**
   * The cabin place (vehicle/cabin.ts index) whose thing the eye looks at through that
   * open door, or -1: F takes it.
   */
  kitPlace: number;
  /**
   * A roadside shell's lid or a courier's boot lid the eye ray meets (`aimWreckLid`), or
   * null: E works it as it does a car's.
   */
  wreckLid: {
    readonly owner: 'wreck' | 'courier';
    readonly id: string;
    readonly lids: StaticCarLids;
    readonly control: KitControl;
  } | null;
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

/**
 * Channels the Vehicle writes from its driving state every frame (`driveKit` in
 * vehicle/vehicle.ts) and that have no world action of their own here: a click on
 * them would be undone on the next frame, so they are not offered. The light switch,
 * the hazard button and the indicator stalk are, but routed to the car's lamps.
 */
const KIT_VEHICLE_CHANNELS: Readonly<Record<string, true>> = {
  steer: true,
  throttle: true,
  brake: true,
  clutch: true,
  handbrake: true,
  gear: true,
  speed: true,
  rpm: true,
  fuel: true,
  temp: true,
};

/** The shell's own panels (doors, lids, flap): outside parts, not cabin fittings. */
const KIT_SHELL_PART = /^(door_|bonnet$|boot$|tailgate(_[lr])?$|flap$)/;
/**
 * Cabin parts also worked on foot, when the eye ray reaches them through an open side
 * door (`kitOpenDoorDistance`): the van's engine cover behind the front seats, which is
 * lifted from the side door as from the seat. The bay under it is reached through that
 * door too (`cabinLidOpen`).
 */
const KIT_DOOR_REACH_PART = /^engine_cover$/;

/** Lids opened only from outside: from a seat they are not offered. */
const KIT_LID_PART = /^(bonnet|boot|tailgate(_[lr])?)$/;

/**
 * Parts worked only through their own control: a door's pane by its crank
 * (`crank_*`), the wiper arms by the stalk (`stalk_wipers`). The pane is looked
 * through like fixed glass; an arm stops the ray and offers nothing. The arms are told
 * by their node (`wiper_<i>`, exterior.ts `buildWipers`), not their control: the stalk
 * carries the same `wipers` control id, and matching the id hid the stalk as well.
 */
const KIT_PANE_PART = /^window_/;
const KIT_WIPER_ARM = /^wiper_\d+$/;
/** The door mirrors' heads (carkit/exterior.ts `sideMirrorControl`): a front seat's, through any glass. */
const KIT_SIDE_MIRROR = /^mirror_[lr]$/;

/** A front seat's parts, by the channel's position; the rear bench is `KIT_BENCH_NODE`. */
const KIT_FRONT_SEAT = /^(?:seat|seatback|headrest)_(f[lr])$/;
/**
 * A seat's own controls (its runners, back and headrest): sat in, never worked. They
 * stay controls in the car lab; in the game the seat is only where F puts the player.
 */
const KIT_SEAT_PART = /^(?:seat|seatback|headrest)_/;

/** A panel's sounds by channel: [channel, latch as it opens, slam as it lands shut]. */
const KIT_PANEL_SOUND: readonly (readonly [RegExp, FoleyEvent, FoleyEvent])[] = [
  [/^door_/, 'door-open', 'door-close'],
  [/^bonnet$/, 'bonnet-open', 'bonnet-shut'],
  [/^(boot|tailgate(_[lr])?)$/, 'boot-open', 'boot-shut'],
];
/** A shutting panel is heard landing once its pose is this close to closed (0..1). */
const PANEL_SHUT_AT = 0.02;
/** Longest a panel takes to swing shut from wide open, with margin, seconds. */
const PANEL_SHUT_WAIT_S = 3;

function kitAction(control: KitControl): NonNullable<KitControl['action']> {
  return control.action ?? { type: 'toggle', channel: control.id };
}

/** A kit side door as the entry and exit rules need it; see `Interaction.kitDoors`. */
interface KitDoor {
  readonly id: string;
  readonly node: THREE.Object3D;
  /** `door_fl`/`door_fr`: the doors the front seats are reached through. */
  readonly front: boolean;
  /** On the car's +X side, which is its LEFT, the driver's, in the kit frame. */
  readonly left: boolean;
  /** The SHUT door's outline in the car frame (the door node's parent), from its rest pose. */
  readonly box: THREE.Box3;
}

/** Is every node from `object` up to `root` drawn? A hidden program anchor is not a part. */
function shownUnder(object: THREE.Object3D, root: THREE.Object3D): boolean {
  for (let node: THREE.Object3D | null = object; node && node !== root; node = node.parent) {
    if (!node.visible) return false;
  }
  return true;
}

/** The car lab's picking rule (car-lab.ts `pick`): a pane is glass by its material's name. */
function isGlassHit(hit: THREE.Intersection): boolean {
  const mesh = hit.object as THREE.Mesh;
  const material = Array.isArray(mesh.material) ? mesh.material[hit.face?.materialIndex ?? 0] : mesh.material;
  return material instanceof THREE.Material && /glass/.test(material.name);
}

/**
 * Longest thing a boot's cell takes, metres: a rolled carpet is longer, and goes across
 * the rear bench instead (vehicle/cabin.ts).
 */
const BOOT_ITEM_MAX_M = 0.8;

/** Why `item` does not go in a boot, or null. */
function bootRefusal(item: Item): string | null {
  const size = cabinItemBounds(item);
  return Math.max(size.x, size.z) > BOOT_ITEM_MAX_M ? `the ${itemLabel(item)} is too long for the boot — lay it across the back seat` : null;
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
  /**
   * The target car's lids as last seen on foot, so a lid that has just opened shows
   * its grid even when another compartment's is up (see `followLids`).
   */
  private readonly lidsSeen = { carId: '', bonnet: false, trunk: false };
  /** Chassis-local box of the fuel flap's opening and the ray tested against it; see `aimsAtFiller`. */
  private readonly fillerBox = new THREE.Box3();
  private readonly fillerRay = new THREE.Ray();
  private readonly fillerHit = new THREE.Vector3();

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
  /**
   * What `aimKit` found on a kit car's render mesh, reused in place; valid for the call
   * that filled it. `part` is the working part, already filtered by reach rules; `seat`
   * is the seat the first opaque thing hit belongs to; `throughGlass` says a pane was
   * looked through on the way to it.
   */
  private readonly kitAimed = {
    part: null as KitPicked | null,
    distance: Infinity,
    seat: null as PlayerSeat | null,
    /** A thing lying in the cabin (vehicle/cabin.ts index), or -1. */
    place: -1,
    throughGlass: false,
  };
  /** The lid `aimWreckLid` last found, valid for the call that filled it. */
  private wreckLidAimed: KitControl | null = null;
  /** Side doors per rig, found once; a rebuilt car has a new rig and new nodes. */
  private readonly kitDoorCache = new WeakMap<KitRig, readonly KitDoor[]>();
  private readonly kitEye = new THREE.Vector3();
  private readonly kitAhead = new THREE.Vector3();
  private readonly kitCentre = new THREE.Vector3();
  private readonly kitBox = new THREE.Box3();
  /** A momentary fitting (the horn) held down by E, released after `KIT_PRESS_SECONDS`. */
  private kitPress: { rig: KitRig; control: KitControl; left: number } | null = null;
  /** The hand-aimed part (the inside mirror) E is held on: the mouse turns it, not the head. */
  private kitAim: { vehicle: Vehicle; rig: KitRig; control: KitControl } | null = null;
  /** Last tick's aim named a kit part, so E belongs to it; see `claimsUseHeld`. */
  private kitClaimsE = false;
  /** A seated press main.ts answers; see `takeCabinPress`. */
  private cabinPress: 'hazard' | 'radio' | null = null;
  /** Panels set swinging shut, slammed by `listenForShut` as each lands. */
  private readonly shutting: { rig: KitRig; channel: string; sound: FoleyEvent; left: number }[] = [];
  /** This tick's car-to-car bar action, or null; see `towAction`. */
  private towActionValue: TowAction | null = null;
  /** Reused receiver for the two cars nearest the player, and their eyes. */
  private readonly towNearest: (string | null)[] = [null, null];
  private readonly towEyeA = { x: 0, y: 0, z: 0 };
  private readonly towEyeB = { x: 0, y: 0, z: 0 };
  private readonly towEyeC = { x: 0, y: 0, z: 0 };
  private readonly towEyeD = { x: 0, y: 0, z: 0 };
  /** Where the eye ray met a vending machine's front, reused in place; see `aimVending`. */
  private readonly vendAim: VendingAim = { distance: 0, slot: -1 };
  /**
   * The FUEL nozzle's running sale. `credit` is litres already paid for and not yet
   * poured at `machineId` (a coin buys `1 / price` litres, so the last coin of a fill
   * leaves change in the machine for the next one); `litres` and `coins` count up over
   * the current hold for the prompt; `dry` is set once a hold has run out of coins.
   * In memory only: a reload forgets the change, never more than one coin's worth.
   */
  private readonly pump = { machineId: '', credit: 0, litres: 0, coins: 0, dry: false };
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
    /** The vending machines and lot cars in the physics band (world/market.ts). */
    private readonly market: MarketField,
    /** Fixed things in reach that are not world catalogue items; see `InteractionFixture`. */
    private readonly fixtures: readonly InteractionFixture[],
  ) {
    // A kit car is drawn merged and picked by the parts it was built of (render/kitdraw.ts).
    this.raycaster.layers.enable(KIT_PICK_LAYER);
  }

  /**
   * The last tick's aim named a kit car's working part, so E works that part and not
   * the held item (binoculars, torch, shades). Read by the composition root before it
   * hands E to the held item; a sticker in hand keeps E (it mirrors the sticker).
   */
  get claimsUseHeld(): boolean {
    return this.kitClaimsE || this.kitAim !== null;
  }

  /**
   * The hazard button or the radio knob worked from the seat since the last call, once:
   * main.ts cycles the hazards with the autopilot and steps the car's radio.
   */
  takeCabinPress(): 'hazard' | 'radio' | null {
    const press = this.cabinPress;
    this.cabinPress = null;
    return press;
  }

  /** The part the mouse turns this frame instead of the view (main.ts), or null. */
  get aimingKit(): { readonly rig: KitRig; readonly control: KitControl } | null {
    return this.kitAim;
  }

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
    /** The drawing camera is the cabin view (not the chase). */
    cabinView: boolean,
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
    this.kitClaimsE = false;
    this.listenForShut(dt);
    if (this.kitPress) {
      this.kitPress.left -= dt;
      if (this.kitPress.left <= 0) {
        this.kitPress.rig.release(this.kitPress.control);
        this.kitPress = null;
      }
    }
    // Let go of E (or out of the seat), the mirror stays where the hand left it.
    if (this.kitAim && (!input.useHeldDown || !this.world.state.player.drivingCarId)) {
      this.kitAim.vehicle.storeMirrorAim();
      this.kitAim = null;
    }

    if (this.world.state.player.drivingCarId) {
      // Sitting down closes whatever was open: the grid belongs to a player standing
      // at the car, and a driver cannot reach into it.
      this.openStorage = null;
      // A kit car is worked from the seat too: the ray runs from whichever camera is
      // drawing, so the occupant looks at a door or a fitting and E works it; from the
      // chase view only the side doors answer. Nothing is said: the crosshair
      // appears on it (`actionable`), and a refused exit is the door that stays shut.
      const active = this.getVehicle();
      const rig = active?.vehicle.kit ?? null;
      let aimed: KitPicked | null = null;
      // Another seat in the aim, from the cabin view, at any speed: F moves the occupant
      // into it (over the tunnel, between the seats) instead of out.
      let seat: PlayerSeat | null = null;
      if (active && rig) {
        aimed = this.seatedKitPart(active.vehicle, eyeX, eyeY, eyeZ, dirX, dirY, dirZ, cabinView);
        if (aimed) {
          this.kitClaimsE = true;
          if (useHeldPressed) this.workKitPart(active.vehicle, rig, aimed.control);
        }
        const other = this.kitAimed.seat;
        if (cabinView && other !== null && other !== this.world.state.player.seat) {
          seat = other;
        }
      }
      if (interactPressed) {
        if (seat) this.world.apply({ t: 'enter_car', carId: this.world.state.player.drivingCarId, seat });
        else this.tryExit(roadS);
      }
      return { prompt: null, sound: this.sound, continuous: null, boot: null, board: false, actionable: aimed !== null || seat !== null };
    }

    const resolved = this.resolve(eyeX, eyeY, eyeZ, dirX, dirY, dirZ);
    this.followLids(resolved, eyeX, eyeY, eyeZ);
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
    // A kit car's part in the aim takes E, unnamed: the crosshair lights on it. A sticker
    // in hand keeps E for mirroring, and the car is a surface to it, not a set of doors.
    const kitRig = resolved.vehicle?.kit ?? null;
    const kitPart = envelope === null && kitRig ? resolved.kitPart : null;
    if (kitPart && resolved.vehicle && kitRig) {
      this.kitClaimsE = true;
      if (useHeldPressed) this.workKitPart(resolved.vehicle, kitRig, kitPart.control);
    }
    // A roadside shell's lid, or a courier's boot lid, takes E the same way.
    const wreckLid = envelope === null && !kitPart ? resolved.wreckLid : null;
    if (wreckLid) {
      this.kitClaimsE = true;
      if (useHeldPressed) this.workWreckLid(wreckLid.owner, wreckLid.id, wreckLid.lids, wreckLid.control);
    }

    if (input.usePrimary) this.usePrimary(dt, resolved);
    // F or LMB held at a FUEL machine's nozzle fills the can in hand.
    const aimedAt = resolved.target;
    if (aimedAt.kind === 'vending' && aimedAt.slot === PUMP_SLOT && (input.mountDown || input.usePrimary)) {
      this.pumpFuel(dt, aimedAt.machineId, mountPressed || primaryPressed);
    }
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
    // Drawn from `openStorage`, NOT from the aim: the open compartment stays on screen
    // while the player looks elsewhere, and closes with its lid (`followLids`) or when
    // they walk out of `GRID_PERSIST_RANGE`. Only the highlighted cell still follows
    // the crosshair, because only reaching in needs the aim.
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
    // A refused seat says why (the prompt), so it does not also light the crosshair.
    const actionable = kitPart !== null
      || wreckLid !== null
      || (resolved.kitSeat !== null && !stickerBlocksCar && prompt === null)
      || (resolved.target.kind === 'filler' && this.inventory.held?.type === 'fluid_can' && this.aimedReservoir(resolved) !== null);
    return { prompt, sound: this.sound, continuous: this.continuous, boot, board, actionable };
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
      return { prompt: 'stuck on', sound: this.sound, continuous: null, boot: null, board: false, actionable: false };
    }
    this.onStickerPreview(carId, sticker, true);
    const size = Math.round(style.scale * 100);
    return {
      prompt: `[F/click] stick · wheel turn · Shift+wheel size ${size}% · [E] mirror${style.mirror ? ' ✓' : ''} · right click reset`,
      sound: null,
      continuous: null,
      boot: null,
      board: false,
      actionable: false,
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
   * Why this car takes no more contracts, or null. How many it carries at once, in the
   * boot and the cabin together, is the body's (economy/economy.ts `contractSlotsFor`):
   * one in a saloon, two in an estate, three in the van.
   */
  private contractSlotsRefusal(carId: string): string | null {
    const car = this.world.state.cars[carId];
    if (!car) return null;
    const slots = contractSlotsFor(car.modelId);
    let aboard = 0;
    for (const cell of car.storage) if (cell?.type === 'contract_cargo') aboard++;
    for (const place of car.cabin) if (place?.type === 'contract_cargo') aboard++;
    if (aboard < slots) return null;
    return slots === 1
      ? 'one contract is already aboard — this car carries one'
      : `${aboard} contracts already aboard — this car carries ${slots}`;
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
   * ABSOLUTE world centre of a compartment's grid: the same chassis-local cells
   * `pickStorage` intersects, so "how far am I from the grid" is measured against the
   * thing the player is actually looking at rather than the car's centre.
   */
  private storageGridCentre(
    target: { readonly owner: StorageOwnerKind; readonly side: StorageSide; readonly id: string },
    out: THREE.Vector3,
  ): boolean {
    let shape: StorageGridShape;
    if (target.owner !== 'car') {
      const fixed = target.owner === 'wreck'
        ? this.wreckTrunks.get(target.id)
        : this.couriers.get(target.id);
      if (!fixed) return false;
      shape = carModelMeasure(fixed.modelId);
      this.trunkQuaternion.set(fixed.qx, fixed.qy, fixed.qz, fixed.qw);
      out.set(fixed.x, fixed.y, fixed.z);
    } else {
      const vehicle = this.carLookup.vehicle(target.id);
      if (!vehicle) return false;
      shape = vehicle.modelMeasure;
      vehicle.chassis.rotation(this.trunkQuaternion);
      const t = vehicle.chassis.translation(this.tScratch);
      out.set(t.x + this.origin.x, t.y, t.z + this.origin.z);
    }
    if (!storageGridCentreLocal(shape, target.side, this.gridScratch)) return false;
    out.add(this.gridScratch.applyQuaternion(this.trunkQuaternion));
    return true;
  }

  /** A roadside shell's lids or a courier's boot lid, null for a car or before its model is drawn. */
  private fixedLids(owner: StorageOwnerKind, id: string): StaticCarLids | null {
    if (owner === 'wreck') return this.wreckTrunks.lids(id);
    return owner === 'courier' ? this.couriers.lids(id) : null;
  }

  /**
   * Makes the lids the authority over their grids, a kit car's, a roadside shell's and a
   * courier's: a grid whose lid has shut closes, and a lid's grid rides with its car. The
   * grid shown is the aimed compartment under an open lid, else a car's lid that has just
   * opened (a shell's or a courier's opens its grid itself, `workWreckLid`), else — with
   * nothing open — the nearest open lid of the car within `GRID_PERSIST_RANGE`. One grid
   * is up at a time, as the renderer draws one.
   *
   * A car without a rig has no lid to follow and keeps the [F] that opens it.
   */
  private followLids(resolved: Resolved, eyeX: number, eyeY: number, eyeZ: number): void {
    const open = this.openStorage;
    if (open?.owner === 'car') {
      const lid = lidOpen(this.carLookup.vehicle(open.id)?.kit ?? null, open.side);
      if (lid === false || !this.storageGridCentre(open, this.vScratch)) {
        this.openStorage = null;
      } else if (lid) {
        open.x = this.vScratch.x;
        open.y = this.vScratch.y;
        open.z = this.vScratch.z;
      }
    } else if (open && lidOpen(this.fixedLids(open.owner, open.id)?.rig ?? null, open.side) === false) {
      this.openStorage = null;
    }

    const t = resolved.target;
    // `resolve` offers a shell's compartment under its lid shut or open, a courier's boot
    // only under its open lid; open, it shows.
    if (
      t.kind === 'storage'
      && t.owner !== 'car'
      && !this.isStorageOpen(t)
      && lidOpen(this.fixedLids(t.owner, t.id)?.rig ?? null, t.side) === true
    ) {
      this.openGrid(t);
    }

    const carId = resolved.carId;
    const rig = resolved.vehicle?.kit ?? null;
    if (!carId || !rig) return;
    const seen = this.lidsSeen;
    const bonnet = lidOpen(rig, 'bonnet') === true;
    const trunk = lidOpen(rig, 'trunk') === true;
    const sameCar = seen.carId === carId;
    let side: StorageSide | null = null;
    // `resolve` offers a kit car's compartment only under its open lid.
    if (t.kind === 'storage' && t.owner === 'car' && t.id === carId) side = t.side;
    else if (sameCar && bonnet && !seen.bonnet) side = 'bonnet';
    else if (sameCar && trunk && !seen.trunk) side = 'trunk';
    seen.carId = carId;
    seen.bonnet = bonnet;
    seen.trunk = trunk;

    const eyeAbsX = eyeX + this.origin.x;
    const eyeAbsZ = eyeZ + this.origin.z;
    if (side === null) {
      if (this.openStorage) return;
      let nearest = GRID_PERSIST_RANGE * GRID_PERSIST_RANGE;
      for (const candidate of ['bonnet', 'trunk'] as const) {
        if (!(candidate === 'bonnet' ? bonnet : trunk)) continue;
        if (!this.storageGridCentre({ owner: 'car', side: candidate, id: carId }, this.vScratch)) continue;
        const dx = eyeAbsX - this.vScratch.x;
        const dy = eyeY - this.vScratch.y;
        const dz = eyeAbsZ - this.vScratch.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 <= nearest) {
          nearest = d2;
          side = candidate;
        }
      }
      if (side === null) return;
    }
    const target = { owner: 'car', side, id: carId } as const;
    if (this.isStorageOpen(target) || !this.storageGridCentre(target, this.vScratch)) return;
    this.openStorage = { ...target, x: this.vScratch.x, y: this.vScratch.y, z: this.vScratch.z };
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
      this.storageGridCentre(target, this.vScratch)
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
   * Resolves the same chassis-local cells the renderer draws, within `reach` of the eye.
   * A narrowly padded box round the whole grid reveals it before a precise cell is under
   * the crosshair.
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
    shape: StorageGridShape,
    side: StorageSide,
    reach: number,
  ): boolean {
    this.trunkInverse.copy(quaternion).invert();
    this.trunkEye.set(eyeX - position.x, eyeY - position.y, eyeZ - position.z).applyQuaternion(this.trunkInverse);
    this.trunkDirection.set(dirX, dirY, dirZ).applyQuaternion(this.trunkInverse);
    if (
      intersectStorageGrid(this.trunkEye, this.trunkDirection, shape, side, this.trunkRayHit) &&
      this.trunkRayHit.distance <= reach
    ) {
      this.trunkPickedCell = this.trunkRayHit.cell;
      this.trunkPickedDistance = this.trunkRayHit.distance;
      return true;
    }
    const distance = storageRevealDistance(this.trunkEye, this.trunkDirection, shape, side, BOOT_REVEAL_MARGIN);
    if (distance > reach) return false;
    this.trunkPickedCell = null;
    this.trunkPickedDistance = distance;
    return true;
  }

  /**
   * Whether the eye ray meets a kit car's fuel flap opening (`CarModelMeasure.filler`,
   * padded by `FILLER_AIM_MARGIN`) within `BOOT_RANGE`; the distance, or Infinity.
   */
  private fillerDistance(
    vehicle: Vehicle,
    eyeX: number,
    eyeY: number,
    eyeZ: number,
    dirX: number,
    dirY: number,
    dirZ: number,
  ): number {
    const filler = vehicle.modelMeasure.filler;
    if (!filler) return Infinity;
    vehicle.chassis.rotation(this.qScratch);
    const t = vehicle.chassis.translation(this.tScratch);
    this.trunkInverse.copy(this.qScratch).invert();
    this.fillerRay.origin.set(eyeX - t.x, eyeY - t.y, eyeZ - t.z).applyQuaternion(this.trunkInverse);
    this.fillerRay.direction.set(dirX, dirY, dirZ).applyQuaternion(this.trunkInverse);
    const [cx, cy, cz] = filler.centre;
    const [sx, sy, sz] = filler.size;
    this.fillerBox.min.set(cx - sx * 0.5, cy - sy * 0.5, cz - sz * 0.5).subScalar(FILLER_AIM_MARGIN);
    this.fillerBox.max.set(cx + sx * 0.5, cy + sy * 0.5, cz + sz * 0.5).addScalar(FILLER_AIM_MARGIN);
    if (!this.fillerRay.intersectBox(this.fillerBox, this.fillerHit)) return Infinity;
    const distance = this.fillerHit.sub(this.fillerRay.origin).length();
    return distance <= BOOT_RANGE ? distance : Infinity;
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
    let kitHit = false;
    let kitDoor: KitDoor | null = null;
    const tv = this.targetVehicle();
    if (tv) {
      vehicle = tv.vehicle;
      carId = tv.carId;
      const t = vehicle.chassis.translation(this.tScratch);
      vehicle.chassis.rotation(this.qScratch);
      vehicleDist = Math.hypot(t.x - eyeX, t.y - eyeY, t.z - eyeZ);

      // Rear and front use the same deliberate close-range interaction. The nearer
      // grid wins, so a long bus cannot expose both ends at once. A kit car's grid is
      // there only under its open lid (`followLids`): a shut one is reached by opening it.
      // A compartment under a cabin lid (`cabinLidOpen`: the van's engine cover) is
      // reached into through an open side door: `BOOT_RANGE` then counts from where the
      // eye ray goes in through the door's opening, as the arm does.
      const rig = vehicle.kit;
      let inCompartment = false;
      for (const side of ['trunk', 'bonnet'] as const) {
        if (lidOpen(rig, side) === false) continue;
        const door = rig && cabinLidOpen(rig, side) ? this.kitOpenDoorDistance(rig, vehicle, eyeX, eyeY, eyeZ, dx, dy, dz) : Infinity;
        const reach = BOOT_RANGE + (door < Infinity ? door : 0);
        if (this.pickStorage(eyeX, eyeY, eyeZ, dx, dy, dz, t, this.qScratch, vehicle.modelMeasure, side, reach)) {
          inCompartment = true;
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
      // A compartment aimed into wins over the box it sits in: the bonnet's cells are
      // inside the chassis box, so its hit always stood nearer and no cell was ever picked.
      if (
        !inCompartment &&
        vehicleDist <= VEHICLE_RANGE &&
        hit &&
        vehicle.isChassisCollider(hit.colliderHandle)
      ) {
        keep(hit.toi, { kind: 'car-entry', carId });
      }

      // A kit car is worked part by part, so for it the eye ray is also tested against
      // the render mesh, which is what the parts are. Bounded: only this one car, only
      // inside VEHICLE_RANGE, and the ray itself stops there (`aimKit`).
      if (rig && vehicleDist <= VEHICLE_RANGE) {
        kitHit = this.aimKit(vehicle, eyeX, eyeY, eyeZ, dx, dy, dz, VEHICLE_RANGE, false);
        kitDoor = this.kitEntryDoor(rig, vehicle, eyeX, eyeY, eyeZ);
      }

      // The fuel flap is a target of its own while it is open (its level is read there)
      // and, shut, while a can is in hand; it wins over the body it is cut into.
      if (rig && (this.inventory.held?.type === 'fluid_can' || rig.get('flap') > LID_OPEN)) {
        const distance = this.fillerDistance(vehicle, eyeX, eyeY, eyeZ, dx, dy, dz);
        const current = target as Target;
        const body = current.kind === 'none' || current.kind === 'car-entry' || current.kind === 'car-body';
        if (distance < Infinity && (body || distance < bestDist)) {
          bestDist = distance;
          target = { kind: 'filler', carId };
        }
      }
    }

    // The lid of a roadside shell or a courier nearest in the eye ray, if any (`aimWreckLid`).
    let wreckLidOwner: 'wreck' | 'courier' = 'wreck';
    let wreckLidId: string | null = null;
    let wreckLids: StaticCarLids | null = null;
    let wreckLidControl: KitControl | null = null;
    let wreckLidDistance = Infinity;
    for (const wreck of this.wreckTrunks.values()) {
      this.trunkPosition.set(wreck.x - this.origin.x, wreck.y, wreck.z - this.origin.z);
      this.trunkQuaternion.set(wreck.qx, wreck.qy, wreck.qz, wreck.qw);
      // Both ends of a shell open, exactly as a driven car's do: the rear gives up the
      // trunk's cans and tools, the service cells under the bonnet give up the worn
      // parts. The nearer grid wins, so a buried nose exposes its boot. Every shell is a
      // kit body and its grids lie under its lids (`StaticCarLids`), offered shut too,
      // where F opens the lid first (`mount`); a shell whose model is still loading has
      // no lids yet and offers nothing. The van's bay under its cabin engine cover is
      // reached only through its open side door, `BOOT_RANGE` counted from the opening
      // as on the driven van (`wreckCabinCompartment`).
      const lids = this.wreckTrunks.lids(wreck.id);
      if (!lids) continue;
      const shape = carModelMeasure(wreck.modelId);
      for (const side of ['trunk', 'bonnet'] as const) {
        if (!lids.has(side)) continue;
        let reach = BOOT_RANGE;
        if (wreckCabinCompartment(lids, side)) {
          const door = this.openDoorDistance(lids.rig, this.wreckDoors(lids), eyeX, eyeY, eyeZ, dx, dy, dz);
          if (door === Infinity) continue;
          reach += door;
        }
        if (this.pickStorage(eyeX, eyeY, eyeZ, dx, dy, dz, this.trunkPosition, this.trunkQuaternion, shape, side, reach)) {
          keep(this.trunkPickedDistance, {
            kind: 'storage',
            owner: 'wreck',
            side,
            id: wreck.id,
            cell: this.trunkPickedCell,
          });
        }
      }
      const p = this.trunkPosition;
      if (Math.hypot(p.x - eyeX, p.y - eyeY, p.z - eyeZ) > VEHICLE_RANGE) continue;
      const distance = this.aimWreckLid(lids, eyeX, eyeY, eyeZ, dx, dy, dz);
      if (distance < wreckLidDistance) {
        wreckLidDistance = distance;
        wreckLidOwner = 'wreck';
        wreckLidId = wreck.id;
        wreckLids = lids;
        wreckLidControl = this.wreckLidAimed;
      }
    }

    // A courier's boot lies under its boot lid or tailgate, as a shell's does, but it is
    // offered only open: E on the lid opens it and the grid with it (`workWreckLid`), and
    // F at the shut lid does nothing. Its bonnet and doors are part of the shell and never
    // open. A courier whose model is still loading has no lid yet and offers nothing.
    for (const courier of this.couriers.values()) {
      const lids = this.couriers.lids(courier.id);
      if (!lids) continue;
      this.trunkPosition.set(courier.x - this.origin.x, courier.y, courier.z - this.origin.z);
      this.trunkQuaternion.set(courier.qx, courier.qy, courier.qz, courier.qw);
      if (
        lidOpen(lids.rig, 'trunk') === true
        && this.pickStorage(eyeX, eyeY, eyeZ, dx, dy, dz, this.trunkPosition, this.trunkQuaternion, courier, 'trunk', BOOT_RANGE)
      ) {
        keep(this.trunkPickedDistance, {
          kind: 'storage',
          owner: 'courier',
          side: 'trunk',
          id: courier.id,
          cell: this.trunkPickedCell,
        });
      }
      const p = this.trunkPosition;
      if (Math.hypot(p.x - eyeX, p.y - eyeY, p.z - eyeZ) > VEHICLE_RANGE) continue;
      const distance = this.aimWreckLid(lids, eyeX, eyeY, eyeZ, dx, dy, dz);
      if (distance < wreckLidDistance) {
        wreckLidDistance = distance;
        wreckLidOwner = 'courier';
        wreckLidId = courier.id;
        wreckLids = lids;
        wreckLidControl = this.wreckLidAimed;
      }
    }

    // A vending machine's front, its window slots in it.
    for (const machine of this.market.machineValues()) {
      if (aimVending(machine, this.origin.x, this.origin.z, eyeX, eyeY, eyeZ, dx, dy, dz, RAY_RANGE, this.vendAim)) {
        keep(this.vendAim.distance, { kind: 'vending', machineId: machine.id, slot: this.vendAim.slot });
      }
    }

    for (let index = 0; index < this.fixtures.length; index++) {
      const distance = this.fixtures[index]!.aim(eyeX, eyeY, eyeZ, dx, dy, dz, RAY_RANGE);
      if (distance <= RAY_RANGE) keep(distance, { kind: 'fixture', index });
    }

    // The kit aim answers only when nothing else stands nearer in the ray (a loose part,
    // a trailer); the car's own entry and compartment targets never occlude it.
    let kitPart: KitPicked | null = null;
    let kitSeat: PlayerSeat | null = null;
    let kitPlace = -1;
    const rig = vehicle?.kit ?? null;
    if (kitHit && rig && vehicle) {
      const aim = this.kitAimed;
      const t = target as Target;
      const own = t.kind === 'none' || t.kind === 'car-entry' || t.kind === 'car-body' || t.kind === 'filler'
        || (t.kind === 'storage' && t.owner === 'car' && t.id === carId);
      if (own || aim.distance <= bestDist) {
        kitPart = aim.distance <= RAY_RANGE ? aim.part : null;
        // Getting in: the first thing the ray meets is a seat, not behind glass, and the
        // ray reaches it through an open side door's opening (`kitOpenDoorDistance`).
        if (aim.seat && !aim.throughGlass && this.kitOpenDoorDistance(rig, vehicle, eyeX, eyeY, eyeZ, dx, dy, dz) < Infinity) {
          kitSeat = aim.seat;
          kitPlace = aim.place;
        }
      } else {
        kitHit = false;
      }
    }

    // A shell's or a courier's lid answers as a car's part does: unless something else
    // stands nearer in the ray, its own compartments aside.
    let wreckLid: Resolved['wreckLid'] = null;
    if (wreckLidId !== null && wreckLids && wreckLidControl) {
      const t = target as Target;
      const own = t.kind === 'none' || (t.kind === 'storage' && t.owner === wreckLidOwner && t.id === wreckLidId);
      if (own || wreckLidDistance <= bestDist) {
        wreckLid = { owner: wreckLidOwner, id: wreckLidId, lids: wreckLids, control: wreckLidControl };
      }
    }

    return { target, vehicle, carId, vehicleDist, kitPart, kitHit, kitDoor, kitSeat, kitPlace, wreckLid };
  }

  /**
   * Distance along the eye ray, within `RAY_RANGE`, to the nearest of a roadside shell's
   * lids, or Infinity; its control in `wreckLidAimed`. Only the lids are tested, a few
   * hundred triangles: the shell round them is never worked, so a cabin lid (the van's
   * engine cover, `KIT_DOOR_REACH_PART`) answers only through the open side door, as on
   * the driven van.
   */
  private aimWreckLid(lids: StaticCarLids, eyeX: number, eyeY: number, eyeZ: number, dx: number, dy: number, dz: number): number {
    this.raycaster.set(this.rayOrigin.set(eyeX, eyeY, eyeZ), this.rayDir.set(dx, dy, dz));
    this.raycaster.far = RAY_RANGE;
    this.hits.length = 0;
    // Each call sorts the whole list, so after the last the nearest hit is first.
    for (const pivot of lids.pivots) this.raycaster.intersectObject(pivot, true, this.hits);
    const hit = this.hits[0];
    this.hits.length = 0;
    let control = hit ? (KitRig.controlOf(hit.object)?.control ?? null) : null;
    if (control && KIT_DOOR_REACH_PART.test(control.id)
      && this.openDoorDistance(lids.rig, this.wreckDoors(lids), eyeX, eyeY, eyeZ, dx, dy, dz) === Infinity) {
      control = null;
    }
    this.wreckLidAimed = control;
    return hit && control ? hit.distance : Infinity;
  }

  /** Scratch for `pickBody`'s stamp read: the hit face's three corners and two edges. */
  private static readonly stampScratch = [
    new THREE.Vector3(),
    new THREE.Vector3(),
    new THREE.Vector3(),
    new THREE.Vector3(),
    new THREE.Vector3(),
  ] as const;

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
      const stamp = mesh.geometry.getAttribute(CAR_BODY_POSITION_ATTRIBUTE);
      if (stamp && hit.barycoord) {
        // A kit car's door or lid may stand open, and its decals are cut in the shut
        // pose (render/stickerdecals.ts): the sticker goes where the chassis stamp under
        // the hit says, not where the live face stands. The stamp keeps the face's
        // winding; a mirrored mesh reverses it, as it does the live face's normal.
        const [a, b, c, ab, ac] = Interaction.stampScratch;
        a.fromBufferAttribute(stamp, hit.face.a);
        b.fromBufferAttribute(stamp, hit.face.b);
        c.fromBufferAttribute(stamp, hit.face.c);
        this.stickerPoint
          .copy(a).multiplyScalar(hit.barycoord.x)
          .addScaledVector(b, hit.barycoord.y)
          .addScaledVector(c, hit.barycoord.z);
        this.stickerNormal.crossVectors(ab.subVectors(b, a), ac.subVectors(c, a)).normalize();
        if (mesh.matrixWorld.determinant() < 0) this.stickerNormal.negate();
      } else {
        this.stickerPoint.copy(hit.point);
        vehicle.root.worldToLocal(this.stickerPoint);
        this.stickerNormal
          .copy(hit.face.normal)
          .applyNormalMatrix(this.stickerNormalMatrix.getNormalMatrix(hit.object.matrixWorld))
          .normalize();
        vehicle.root.getWorldQuaternion(this.qBody).invert();
        this.stickerNormal.applyQuaternion(this.qBody).normalize();
      }
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
   * The eye ray against a kit car's render mesh (Rapier knows only its chassis box),
   * filling `kitAimed`; true when the ray met the car at all. The car lab's picking rule
   * (car-lab.ts `pick`): a clear pane is looked through unless it is itself a part (a
   * door's window, a fixed pane riding in a door), and the first other surface decides.
   * The cost is one car's triangles inside `far`, for the one car the player stands at
   * (on foot, within VEHICLE_RANGE) or sits in.
   *
   * Reach rules on the part found: the channels the Vehicle drives itself are not
   * offered (`KIT_VEHICLE_CHANNELS`), nor a drop pane or the wiper arms (worked by the
   * crank and the stalk); on foot only the shell's panels are (`KIT_SHELL_PART`), and
   * through an open side door the parts in `KIT_DOOR_REACH_PART`; from a seat every
   * part but the lids (`KIT_LID_PART`).
   */
  private aimKit(
    vehicle: Vehicle,
    eyeX: number,
    eyeY: number,
    eyeZ: number,
    dx: number,
    dy: number,
    dz: number,
    far: number,
    seated: boolean,
  ): boolean {
    const aim = this.kitAimed;
    aim.part = null;
    aim.distance = Infinity;
    aim.seat = null;
    aim.place = -1;
    aim.throughGlass = false;
    const root = vehicle.root;
    this.raycaster.set(
      this.rayOrigin.set(eyeX, eyeY, eyeZ),
      this.rayDir.set(dx, dy, dz).normalize(),
    );
    this.raycaster.far = far;
    this.hits.length = 0;
    this.raycaster.intersectObject(root, true, this.hits);
    const frontSeat = seated && (this.world.state.player.seat === 'driver' || this.world.state.player.seat === 'passenger');
    // A door mirror is reached from a front seat through whatever glass is in the way,
    // shut or not: the door's drop pane, a vent window, the screen. The first surface
    // that is not glass decides whether it is the mirror.
    if (frontSeat) {
      for (const hit of this.hits) {
        if (!(hit.object as THREE.Mesh).isMesh || !shownUnder(hit.object, root) || isGlassHit(hit)) continue;
        const picked = KitRig.controlOf(hit.object);
        if (picked && KIT_SIDE_MIRROR.test(picked.control.id)) {
          aim.part = picked;
          aim.distance = hit.distance;
          aim.throughGlass = true;
          this.hits.length = 0;
          return true;
        }
        break;
      }
    }
    let found = false;
    for (const hit of this.hits) {
      if (!(hit.object as THREE.Mesh).isMesh || !shownUnder(hit.object, root)) continue;
      const picked = KitRig.controlOf(hit.object);
      const pane = picked !== null && KIT_PANE_PART.test(picked.control.id);
      if ((!picked || pane) && isGlassHit(hit)) {
        aim.throughGlass = true;
        continue;
      }
      // A thing lying in the cabin answers for itself: F takes it, through an open door.
      const place = vehicle.cabinPlaceOf(hit.object);
      if (place >= 0) {
        if (seated) continue;
        found = true;
        aim.distance = hit.distance;
        aim.place = place;
        aim.seat = placeSeats(CABIN_PLACES[place]!)[0]!;
        break;
      }
      const seat = this.kitSeatOf(hit);
      // From a seat the eye looks back past its own seat's back and head restraint,
      // between the seats, at the bench: they are never what the occupant points at.
      if (seated && seat !== null && seat === this.world.state.player.seat) continue;
      found = true;
      aim.distance = hit.distance;
      aim.seat = seat;
      if (
        picked
        && !pane
        && !KIT_WIPER_ARM.test(picked.node.name)
        && !KIT_VEHICLE_CHANNELS[kitAction(picked.control).channel]
        && !KIT_SEAT_PART.test(picked.control.id)
        && (frontSeat || !KIT_SIDE_MIRROR.test(picked.control.id))
        && (seated
          ? !KIT_LID_PART.test(picked.control.id)
          : KIT_SHELL_PART.test(picked.control.id)
            || (KIT_DOOR_REACH_PART.test(picked.control.id) && vehicle.kit !== null && this.kitOpenDoorDistance(vehicle.kit, vehicle, eyeX, eyeY, eyeZ, dx, dy, dz) < Infinity))
      ) {
        aim.part = picked;
      }
      break;
    }
    this.hits.length = 0;
    return found;
  }

  /**
   * The seat a kit car's surface belongs to, or null: a front seat by its parts' channel
   * (`seat_fl` and the back and headrest riding on it are the driver's, on the left),
   * the rear bench by its group, halved down the car's centre line.
   */
  private kitSeatOf(hit: THREE.Intersection): PlayerSeat | null {
    for (let node: THREE.Object3D | null = hit.object; node; node = node.parent) {
      if (node.name === KIT_BENCH_NODE) {
        return node.worldToLocal(this.kitEye.copy(hit.point)).x > 0 ? 'rear-left' : 'rear-right';
      }
      const id = (node.userData.kitControl as KitControl | undefined)?.id;
      if (id === undefined) continue;
      const front = KIT_FRONT_SEAT.exec(id);
      return front ? (front[1] === 'fl' ? 'driver' : 'passenger') : null;
    }
    return null;
  }

  /**
   * The part the seated player aims at through the drawing camera, or null, at any
   * speed. Away from the cabin view (the chase) only the side doors are offered. The ray
   * reaches from the camera across the car and no further.
   */
  private seatedKitPart(
    vehicle: Vehicle,
    eyeX: number,
    eyeY: number,
    eyeZ: number,
    dirX: number,
    dirY: number,
    dirZ: number,
    cabinView: boolean,
  ): KitPicked | null {
    const t = vehicle.chassis.translation(this.tScratch);
    const half = vehicle.modelMeasure.halfExtents;
    const reach = Math.hypot(t.x - eyeX, t.y - eyeY, t.z - eyeZ) + Math.hypot(half[0], half[1], half[2]);
    if (!this.aimKit(vehicle, eyeX, eyeY, eyeZ, dirX, dirY, dirZ, reach, true)) return null;
    const part = this.kitAimed.part;
    if (part && !cabinView && !part.control.id.startsWith('door_')) return null;
    return part;
  }

  /**
   * A kit car's side doors, found once per rig: the `door_*` control nodes and the shut
   * door's outline in the car frame. A door turns about its hinge from an unrotated rest
   * pose, so its node position plus its own meshes' bounds is the opening it fills,
   * whatever it is doing now. Its side is read off that outline (+X is the car's left).
   */
  private kitDoors(rig: KitRig, vehicle: Vehicle): readonly KitDoor[] {
    const cached = this.kitDoorCache.get(rig);
    if (cached) return cached;
    const doors: KitDoor[] = [];
    vehicle.root.traverse((node) => {
      const door = this.kitDoorOf(node);
      if (door) doors.push(door);
    });
    this.kitDoorCache.set(rig, doors);
    return doors;
  }

  /**
   * A roadside shell's side doors that open (render/carmodel.ts `STATIC_SHELL_DOORS`:
   * the van's middle door), found once per shell among its hinged pivots as `kitDoors`
   * finds a car's. Empty for every other shell.
   */
  private wreckDoors(lids: StaticCarLids): readonly KitDoor[] {
    const cached = this.kitDoorCache.get(lids.rig);
    if (cached) return cached;
    const doors: KitDoor[] = [];
    for (const pivot of lids.pivots) {
      const door = this.kitDoorOf(pivot);
      if (door) doors.push(door);
    }
    this.kitDoorCache.set(lids.rig, doors);
    return doors;
  }

  /** `node` as a side door, if it is one with meshes to outline it. */
  private kitDoorOf(node: THREE.Object3D): KitDoor | null {
    const id = (node.userData.kitControl as KitControl | undefined)?.id;
    if (!id || !/^door_[fr][lr]$/.test(id) || !node.parent) return null;
    const box = new THREE.Box3();
    for (const child of node.children) {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) continue;
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      box.union(this.kitBox.copy(mesh.geometry.boundingBox!).applyMatrix4(mesh.matrix));
    }
    if (box.isEmpty()) return null;
    box.translate(node.position);
    return { id, node, front: id.charAt(5) === 'f', left: box.max.x + box.min.x > 0, box };
  }

  /**
   * The side door the player stands at: the one whose shut outline is nearest the eye,
   * when it is on the player's side of the car. Null for a car without doors found.
   * Only the "shut" prompt asks; getting in is `kitOpenDoorDistance`.
   */
  private kitEntryDoor(rig: KitRig, vehicle: Vehicle, eyeX: number, eyeY: number, eyeZ: number): KitDoor | null {
    const doors = this.kitDoors(rig, vehicle);
    const frame = doors[0]?.node.parent;
    if (!frame) return null;
    const eye = frame.worldToLocal(this.kitEye.set(eyeX, eyeY, eyeZ));
    let nearest: KitDoor | null = null;
    let nearestDist = Infinity;
    for (const door of doors) {
      const dist = door.box.distanceToPoint(eye);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = door;
      }
    }
    if (!nearest || eye.x > 0 !== nearest.left) return null;
    return nearest;
  }

  /** `openDoorDistance` through a kit car's side doors. */
  private kitOpenDoorDistance(
    rig: KitRig,
    vehicle: Vehicle,
    eyeX: number,
    eyeY: number,
    eyeZ: number,
    dx: number,
    dy: number,
    dz: number,
  ): number {
    return this.openDoorDistance(rig, this.kitDoors(rig, vehicle), eyeX, eyeY, eyeZ, dx, dy, dz);
  }

  /**
   * How far along the eye ray it enters the car through one of `doors` standing open on
   * the player's side (0 with the eye already in the opening), or Infinity when it does
   * not. Any of them, front or rear: the rear bench of a two-door car is reached through
   * a front door, a front seat across the car through the near one.
   */
  private openDoorDistance(
    rig: KitRig,
    doors: readonly KitDoor[],
    eyeX: number,
    eyeY: number,
    eyeZ: number,
    dx: number,
    dy: number,
    dz: number,
  ): number {
    const frame = doors[0]?.node.parent;
    if (!frame) return Infinity;
    const left = frame.worldToLocal(this.kitEye.set(eyeX, eyeY, eyeZ)).x > 0;
    let nearest = Infinity;
    for (const door of doors) {
      if (door.left !== left || rig.get(door.id) <= 0.5) continue;
      nearest = Math.min(nearest, this.throughOpening(door, eyeX, eyeY, eyeZ, dx, dy, dz));
    }
    return nearest;
  }

  /**
   * Where the eye ray passes through `door`'s opening: its distance along the ray, or
   * Infinity when it misses. Where the ray crosses the plane of the shut door's outer
   * skin (car frame), the crossing must fall inside the shut door's outline, give or take
   * `KIT_OPENING_SLACK`. With the rest of the entry rule in `resolve` (the first opaque
   * thing hit is a seat, not through glass), that is "looking at a seat through this
   * open door": a look through the windscreen, over the roof or from the nose does not
   * count.
   */
  private throughOpening(
    door: KitDoor,
    eyeX: number,
    eyeY: number,
    eyeZ: number,
    dx: number,
    dy: number,
    dz: number,
  ): number {
    const frame = door.node.parent!;
    const o = frame.worldToLocal(this.kitEye.set(eyeX, eyeY, eyeZ));
    const ahead = frame.worldToLocal(this.kitAhead.set(eyeX + dx, eyeY + dy, eyeZ + dz)).sub(o);
    const box = door.box;
    const skin = door.left ? box.max.x : box.min.x;
    let s = 0;
    if (door.left ? o.x > skin : o.x < skin) {
      if (Math.abs(ahead.x) < 1e-6) return Infinity;
      s = (skin - o.x) / ahead.x;
      if (s <= 0) return Infinity;
    }
    const y = o.y + ahead.y * s;
    const z = o.z + ahead.z * s;
    const inside = y >= box.min.y - KIT_OPENING_SLACK && y <= box.max.y + KIT_OPENING_SLACK
      && z >= box.min.z - KIT_OPENING_SLACK && z <= box.max.z + KIT_OPENING_SLACK;
    return inside ? s : Infinity;
  }

  /**
   * Works a kit part as a click does in the car lab, except the lamp switches: those
   * channels follow the car's own lamps every frame, so the switch works the lamps (the
   * beam, the indicators) and the rig shows it. The hazard button and the radio knob are
   * handed to the composition root (`takeCabinPress`). A momentary part (the horn) is
   * held down for `KIT_PRESS_SECONDS`. A door, the bonnet or the boot is toggled with its
   * latch and slam (`togglePanel`).
   */
  private workKitPart(vehicle: Vehicle, rig: KitRig, control: KitControl): void {
    const action = kitAction(control);
    if (action.type === 'aim') {
      this.kitAim = { vehicle, rig, control };
      return;
    }
    this.sound = 'mount';
    if (action.channel === 'lights') {
      vehicle.cycleHeadlights();
    } else if (action.channel === 'hazard' || action.channel === 'radio') {
      // The hazard button and the radio knob work what the composition root owns (the
      // autopilot and the car's radio stream); it takes the press (`takeCabinPress`)
      // and the rig shows the result.
      this.cabinPress = action.channel;
    } else if (action.channel === 'blinker') {
      const now = vehicle.indicator;
      vehicle.setIndicator(now === 'left' ? 'right' : now === 'right' ? 'off' : 'left');
    } else if (action.type === 'press') {
      if (this.kitPress) this.kitPress.rig.release(this.kitPress.control);
      rig.activate(control);
      this.kitPress = { rig, control, left: KIT_PRESS_SECONDS };
    } else {
      this.togglePanel(rig, control);
    }
  }

  /**
   * Toggles a kit part (`KitRig.activate`). A door, the bonnet or the boot sounds its
   * latch as it opens; its slam waits until it lands shut (`listenForShut`).
   */
  private togglePanel(rig: KitRig, control: KitControl): void {
    rig.activate(control);
    const channel = kitAction(control).channel;
    const panel = KIT_PANEL_SOUND.find(([pattern]) => pattern.test(channel));
    if (!panel) return;
    const opening = rig.get(channel) > 0.5;
    this.sound = opening ? panel[1] : null;
    const at = this.shutting.findIndex((s) => s.rig === rig && s.channel === channel);
    if (at >= 0) this.shutting.splice(at, 1);
    if (!opening) this.shutting.push({ rig, channel, sound: panel[2], left: PANEL_SHUT_WAIT_S });
  }

  /**
   * Works a roadside shell's lid, or a courier's boot lid, as `workKitPart` works a car's.
   * Opening it opens its compartment's grid too, as a car's lid does (`followLids`), even
   * over another grid. The van shell's side door (`wreckDoors`) takes the engine cover
   * with it: opened, the cover lifts and the bay's grid opens; shut, the cover drops and
   * the grid goes.
   */
  private workWreckLid(owner: 'wreck' | 'courier', id: string, lids: StaticCarLids, control: KitControl): void {
    this.sound = 'mount';
    this.togglePanel(lids.rig, control);
    let side = storageLidSide(control.id);
    if (side === null && control.id.startsWith('door_')) {
      const open = lids.rig.get(control.id);
      for (const cover of lids.controls) {
        if (!KIT_DOOR_REACH_PART.test(cover.id)) continue;
        lids.rig.set(cover.id, open);
        side = storageLidSide(cover.id);
      }
    }
    if (side && lidOpen(lids.rig, side)) this.openGrid({ owner, side, id });
  }

  /**
   * Shows a compartment's grid, measured at its centre (`storageGridCentre`); false
   * when it cannot be placed. Opening rules are the callers'.
   */
  private openGrid(target: { readonly owner: StorageOwnerKind; readonly side: StorageSide; readonly id: string }): boolean {
    if (!this.storageGridCentre(target, this.vScratch)) return false;
    this.openStorage = { owner: target.owner, side: target.side, id: target.id, x: this.vScratch.x, y: this.vScratch.y, z: this.vScratch.z };
    return true;
  }

  /**
   * Slams each panel set swinging shut once it lands (its pose within `PANEL_SHUT_AT`
   * of closed). One sound a tick: a second panel landing on the same tick waits for the
   * next. A panel opened again before it landed was taken off the list by `workKitPart`;
   * one whose car stopped updating (streamed out mid-swing) is dropped after
   * `PANEL_SHUT_WAIT_S`, silently.
   */
  private listenForShut(dt: number): void {
    for (let i = this.shutting.length - 1; i >= 0; i--) {
      const s = this.shutting[i]!;
      s.left -= dt;
      if (s.rig.position(s.channel) > PANEL_SHUT_AT) {
        if (s.left <= 0) this.shutting.splice(i, 1);
        continue;
      }
      if (this.sound !== null) continue;
      this.sound = s.sound;
      this.shutting.splice(i, 1);
    }
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
    // The flap is poured into, not picked up: F there still gets in as it does at the body.
    if (target.kind === 'filler') return false;
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

    if (t.kind === 'vending') return this.vendingPrompt(t.machineId, t.slot);
    if (t.kind === 'fixture') return this.fixtures[t.index]?.prompt() ?? null;
    const lot = this.lotCarAimed(resolved);
    if (lot) {
      const coins = coinsHeld(this.world.state);
      const label = carModel(lot.modelId).label;
      return coins >= (lot.lotPrice ?? 0)
        ? `[F] buy ${label} — ${lot.lotPrice} coins`
        : `${label} for sale — ${lot.lotPrice} coins · you have ${coins}`;
    }


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

    // The body's tank, through its flap: shut, nothing — the tank is not seen and takes
    // nothing; open, its level, and with a can in hand the pour as the bonnet's
    // reservoirs show theirs.
    if (t.kind === 'filler') {
      const car = this.world.state.cars[t.carId];
      const open = (resolved.vehicle?.kit?.get('flap') ?? 0) > LID_OPEN;
      const reservoir = open && car && resolved.vehicle ? fillerReservoir(car, resolved.vehicle.stats) : null;
      if (!reservoir) return null;
      return held?.type === 'fluid_can' ? this.pourPrompt(held, reservoir) : fillReadout(reservoir);
    }

    if (t.kind === 'storage') {
      const cells = this.storageCells(t);
      if (!cells) return null;
      const label = t.side === 'bonnet' ? 'bonnet' : 'trunk';
      // Aimed at shut: a compartment with no lid to follow, or a roadside shell's under
      // its shut lid, which F opens first (`mount`); a kit car's is offered only open.
      if (!this.isStorageOpen(t)) return `[F] open ${label}`;

      // The grid itself shows which cells hold what, so the prompt names only what F
      // does: no cell numbers, counters or "empty" readouts.
      if (t.cell === null) return null;
      const item = cells[t.cell];
      if (item) {
        // A contract is signed out only to a licensed driver; the refusal names what
        // is missing. The offer shows what it pays.
        if (t.owner === 'courier' && item.type === 'contract_cargo') {
          const licence = licenceFor(this.world.state, item.contractKind);
          if (!licence.ok) return licence.reason ?? 'no licence for this cargo';
          return `[F] take ${itemLabel(item)} — pays ${contractPay(this.world.seed, item)} coins`;
        }
        // A fitted engine or radiator reports what it is holding.
        // Same resolution the pour uses, so the number you read is the number a can
        // fills — and holding one turns the readout into the pour offer itself.
        const reservoir = this.aimedReservoir(resolved);
        if (reservoir) {
          if (held?.type === 'fluid_can') return this.pourPrompt(held, reservoir);
          return `[F] take ${itemLabel(item)} — ${fillReadout(reservoir)}`;
        }
        return `[F] take ${itemLabel(item)}`;
      }
      if (t.side === 'bonnet') {
        if (!held) return null;
        if (!bonnetAccepts(t.cell, held)) {
          const slotLabel = bonnetSlotKind(t.cell)?.replace('_', ' ') ?? 'service';
          return `${slotLabel} slot — wrong part`;
        }
        return `[F] install ${itemLabel(held)}`;
      }
      if (held?.type === 'contract_cargo' && t.owner === 'courier') {
        const courier = this.couriers.get(t.id);
        if (!courier) return null;
        const refusal = contractAcceptRefusal(held, this.deliveryProbe(courier));
        if (refusal) return refusal;
        return `[F] deliver ${itemLabel(held)} — ${contractPay(this.world.seed, held)} coins`;
      }
      if (held?.type === 'contract_cargo' && t.owner === 'car') {
        const full = this.contractSlotsRefusal(t.id);
        if (full) return full;
      }
      if (held && !cells[t.cell]) {
        const tooLong = bootRefusal(held);
        if (tooLong) return tooLong;
      }
      if (held) return `[F] stow ${itemLabel(held)}`;
      return null;
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

    // A kit car says nothing about its doors and seats: the crosshair lights on a seat
    // that F sits in (`actionable`). Only a refusal the eye cannot see is told.
    const kitRig = resolved.vehicle?.kit ?? null;
    if (kitRig && resolved.carId && (t.kind === 'none' || t.kind === 'car-body' || t.kind === 'car-entry')) {
      if (!resolved.kitSeat) return null;
      const action = this.cabinAction(resolved);
      const car = this.world.state.cars[resolved.carId];
      switch (action.kind) {
        case 'refuse':
          return action.why;
        case 'take': {
          const item = car?.cabin[action.place];
          return item ? `[F] take ${itemLabel(item)}` : null;
        }
        case 'lay':
          return `[F] lay ${itemLabel(action.item)} on the seat`;
        case 'sit':
          return this.cabinRefusal();
      }
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
   * The reservoir under the crosshair. Four kinds resolve here so that the level
   * readout and the pour can never disagree about which container you are looking
   * at: a fitted engine or radiator in an OPENED bonnet; the body's tank through an
   * OPEN fuel flap; the same engine or radiator lying loose in the world; and a can
   * on the ground.
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
    if (t.kind === 'filler') {
      const car = this.world.state.cars[t.carId];
      if (!car || !resolved.vehicle || (resolved.vehicle.kit?.get('flap') ?? 0) <= LID_OPEN) return null;
      const reservoir = fillerReservoir(car, resolved.vehicle.stats);
      return reservoir ? { ...reservoir, sink: 'car', carId: t.carId } : null;
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
    if (dirtFraction <= 0 && scratchFraction <= 0) {
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
    const scratchStep = Math.min(scratches, BODY_SPONGE_SCRATCH_RATE * dt);
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
   * Aimed at what holds the fluid, not the car: you open the bonnet and look at the
   * engine or the radiator, or open the fuel flap and look at the filler, and hold the
   * button. That makes the filling gesture the same object as the level readout, and
   * it is why an empty slot takes nothing — there is no reservoir without the part
   * that holds it.
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

    if (t.kind === 'vending') {
      this.buyFromMachine(t.machineId, t.slot);
      return;
    }

    if (t.kind === 'fixture') {
      this.sound = this.fixtures[t.index]?.act() ?? null;
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


    // A compartment with no lid to follow (a car without a rig) opens on the first press;
    // a kit car's and a courier's are offered only under an open lid, already shown
    // (`followLids`). A roadside shell's opens with its lid: the press lifts every leaf
    // over the compartment first, so the grid never shows under a shut lid. Further
    // presses operate the aimed cell.
    if (t.kind === 'storage') {
      if (!this.isStorageOpen(t)) {
        // Located from the same transform the target was resolved against, so this
        // cannot fail in practice; refusing to open rather than guessing a position
        // keeps the persistence rule measuring a real compartment.
        if (!this.openGrid(t)) return;
        this.sound = 'mount';
        const lids = t.owner === 'wreck' ? this.wreckTrunks.lids(t.id) : null;
        if (lids && !lidOpen(lids.rig, t.side)) {
          for (const control of lids.controls) {
            if (storageLidSide(control.id) === t.side) this.togglePanel(lids.rig, control);
          }
        }
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
        // The kind's signature sticker, or the offer's seed-random one for a kind
        // without a signature. Nothing on the way is scored; a delivery never fails.
        const envelope: StickerEnvelopeItem = {
          type: 'sticker_envelope',
          id: `${held.id}:signed:${courier.index}`,
          stickerKind: contractRewardSticker(held),
          completedContractId: held.id,
        };
        // What the kind consumes besides the cargo: the trailer or car the contract
        // named. The world deltas follow the `courier_storage` delta that writes the
        // completed id, so a crash between the halves cannot pay twice.
        const effect = contractDeliveryEffect(held, probe);
        const nextCells = cells.slice();
        nextCells[t.cell] = envelope;
        // The delivery pays coins (economy/economy.ts `contractPay`), and a race won
        // adds its prize to them. They go into the pack the cargo just left.
        const coins = contractPay(this.world.seed, held) + this.raceCoins(held.id);
        this.world.apply({
          t: 'courier_storage',
          courierId: t.id,
          cells: nextCells,
          consumedItemId: held.id,
          completedContractId: held.id,
          completedContractKind: held.contractKind,
        });
        if (effect?.deltas) {
          for (const delta of effect.deltas) this.world.apply(delta);
        }
        this.inventory.remove(held.id);
        const leftover = giveCoins(this.inventory, coins, `${held.id}:coin`);
        if (leftover) {
          // A pack too heavy even for a coin: it waits in the courier's boot.
          const free = nextCells.findIndex((cell) => cell === null);
          if (free >= 0) {
            const withCoin = nextCells.slice();
            withCoin[free] = leftover;
            this.world.apply({ t: 'courier_storage', courierId: t.id, cells: withCoin });
          }
        }
        this.sound = 'mount';
        return;
      }
      if (held && !cells[t.cell] && bootRefusal(held)) {
        this.sound = 'refused';
        return;
      }
      if (held?.type === 'contract_cargo' && t.owner === 'car' && cells[t.cell]?.type !== 'contract_cargo') {
        if (this.contractSlotsRefusal(t.id)) {
          this.sound = 'refused';
          return;
        }
      }
      const taking = cells[t.cell];
      if (
        t.owner === 'courier'
        && taking?.type === 'contract_cargo'
        && !licenceFor(this.world.state, taking.contractKind).ok
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

  /**
   * The car on a lot the player is looking at, or null: the nearest car, still priced
   * (`lotPrice`), within reach, and in the aim (its body, or a kit car's render mesh).
   */
  private lotCarAimed(resolved: Resolved): CarState | null {
    if (!resolved.carId || resolved.vehicleDist > VEHICLE_RANGE) return null;
    const car = this.world.state.cars[resolved.carId];
    if (car?.lotPrice === undefined) return null;
    const t = resolved.target;
    const aimed = t.kind === 'car-entry' || t.kind === 'car-body' || (t.kind === 'none' && resolved.kitHit);
    return aimed ? car : null;
  }

  /** The window slot under the crosshair: what it is and what it costs here. */
  private vendingPrompt(machineId: string, slot: number): string | null {
    const machine = this.market.machine(machineId);
    if (!machine) return null;
    const coins = coinsHeld(this.world.state);
    if (slot === PUMP_SLOT) return this.pumpPrompt(machine, coins);
    if (slot < 0) return `${machine.title} vending machine — you have ${coins} coin${coins === 1 ? '' : 's'}`;
    const item = machine.stock[slot];
    if (!item) return 'empty';
    if (this.world.state.vendingSold[machine.id]?.includes(slot)) return 'sold out';
    const price = itemPrice(item, machine.km);
    const cost = `${price} coin${price === 1 ? '' : 's'}`;
    // A can in the window says its size, and whether anything is in it.
    const label = item.type === 'fluid_can'
      ? `${litreText(item.capacity)} ${item.fluid} can${item.litres > 0 ? ` (${litreText(item.litres)})` : ', empty'}`
      : itemLabel(item);
    return coins >= price
      ? `[F] buy ${label} — ${cost}`
      : `${label} — ${cost} · you have ${coins}`;
  }

  /**
   * The nozzle under the crosshair: the price of a litre here and, with a petrol can in
   * hand, how full it is and what this hold has poured and cost so far.
   */
  private pumpPrompt(machine: VendingMachine, coins: number): string {
    const head = `petrol ${fuelPricePerLitre(machine.km).toFixed(1)} coins/L`;
    const can = this.inventory.held;
    if (can?.type !== 'fluid_can') return `${head} — hold a can to the nozzle (empty cans in the window)`;
    if (can.fluid !== 'petrol') return `${head} — not into a ${can.fluid} can`;
    const pump = this.pump;
    const here = pump.machineId === machine.id;
    const level = `can ${can.litres.toFixed(1)}/${litreText(can.capacity)}`;
    const sale = here && pump.litres > 0 ? ` · +${pump.litres.toFixed(1)} L for ${pump.coins} coin${pump.coins === 1 ? '' : 's'}` : '';
    if (can.litres >= can.capacity - FLUID_FULL_EPSILON) return `${level} full${sale}`;
    if (coins <= 0 && !(here && pump.credit > FLUID_FULL_EPSILON)) return `${head} — out of coins · ${level}${sale}`;
    return `[F] hold to fill — ${head} · ${level}${sale} · ${coins} coin${coins === 1 ? '' : 's'}`;
  }

  /**
   * One tick of the nozzle held to the can in hand. Coins are taken one at a time as the
   * litres they buy run out, so the fill stops on the tick the can is full or the pack has
   * no coin for the next drop; whatever a last coin bought and the can had no room for
   * stays in the machine as `credit`. A press that pours nothing is refused, and so is the
   * tick a running fill runs out of coins.
   */
  private pumpFuel(dt: number, machineId: string, pressed: boolean): void {
    const machine = this.market.machine(machineId);
    const can = this.inventory.held;
    const pump = this.pump;
    if (pump.machineId !== machineId) {
      pump.machineId = machineId;
      pump.credit = 0;
      pump.litres = 0;
      pump.coins = 0;
    }
    if (pressed) {
      pump.litres = 0;
      pump.coins = 0;
      pump.dry = false;
    }
    if (!machine?.pump || can?.type !== 'fluid_can' || can.fluid !== 'petrol') {
      if (pressed) this.sound = 'refused';
      return;
    }
    const room = can.capacity - can.litres;
    if (room <= FLUID_FULL_EPSILON) {
      if (pressed) this.sound = 'refused';
      return;
    }
    const want = Math.min(PUMP_RATE * dt, room);
    const litresPerCoin = 1 / fuelPricePerLitre(machine.km);
    while (pump.credit < want && spendCoins(this.inventory, 1)) {
      pump.credit += litresPerCoin;
      pump.coins += 1;
    }
    const poured = Math.min(want, pump.credit);
    if (poured < want && !pump.dry) {
      pump.dry = true;
      this.sound = 'refused';
    }
    if (poured <= 0) return;
    can.litres += poured;
    pump.credit -= poured;
    pump.litres += poured;
    this.continuous = 'pour';
  }

  /**
   * Pays for one slot and lets its goods fall into the tray as a real loose thing. The
   * slot is recorded sold before the thing exists, so no rebuild can hand it out twice.
   */
  private buyFromMachine(machineId: string, slot: number): void {
    const machine = this.market.machine(machineId);
    const item = slot >= 0 ? machine?.stock[slot] : null;
    if (!machine || !item || this.world.state.vendingSold[machine.id]?.includes(slot)) return;
    if (!spendCoins(this.inventory, itemPrice(item, machine.km))) {
      this.sound = 'refused';
      return;
    }
    this.world.apply({ t: 'vend_sold', machineId: machine.id, slot });
    this.market.sold(machine.id, slot);
    const tray = vendingTrayPoint(machine);
    if (item.type === 'part') this.loose.spawn(item.part, tray.x, tray.y, tray.z);
    else this.loose.spawnItem(item, tray.x, tray.y, tray.z);
    this.sound = 'drop';
  }

  private tryEnter(resolved: Resolved): void {
    if (!resolved.vehicle || !resolved.carId) return;
    // A car on a lot is bought before anyone sits in it: F there pays.
    const lot = this.lotCarAimed(resolved);
    if (lot) {
      if (lot.lotPrice !== undefined && spendCoins(this.inventory, lot.lotPrice)) {
        this.world.apply({ t: 'car_buy', carId: lot.id });
        this.market.carSold(lot.id);
        this.sound = 'pickup';
      } else {
        this.sound = 'refused';
      }
      return;
    }
    const target = resolved.target;
    if (resolved.vehicle.kit) {
      // A kit car: a seat looked at through an open side door is the whole rule (see
      // `resolve`); the eye may look past Rapier's reach into the cabin, so a `none`
      // target counts, while a loose thing in front of the car keeps F for itself.
      if (target.kind !== 'none' && target.kind !== 'car-body' && target.kind !== 'car-entry') return;
      if (!resolved.kitSeat) {
        if (resolved.kitDoor && resolved.kitHit) this.sound = 'refused';
        return;
      }
      const action = this.cabinAction(resolved);
      if (action.kind === 'refuse') {
        this.sound = 'refused';
        return;
      }
      if (action.kind === 'take') {
        const item = this.world.state.cars[resolved.carId]?.cabin[action.place];
        if (!item || !this.inventory.add(item)) {
          this.sound = 'refused';
          return;
        }
        this.world.apply({ t: 'car_cabin', carId: resolved.carId, place: action.place, item: null });
        this.sound = 'pickup';
        return;
      }
      if (action.kind === 'lay') {
        this.inventory.remove(action.item.id);
        this.world.apply({ t: 'car_cabin', carId: resolved.carId, place: action.place, item: action.item });
        this.sound = 'drop';
        return;
      }
    } else if (
      (target.kind !== 'car-body' && target.kind !== 'car-entry') ||
      target.carId !== resolved.carId ||
      resolved.vehicleDist >= VEHICLE_RANGE
    ) return;
    if (this.cabinRefusal() !== null) {
      this.sound = 'refused';
      return;
    }
    this.world.apply({ t: 'enter_car', carId: resolved.carId, seat: resolved.kitSeat ?? 'driver' });
    this.player?.setEnabled(false);
    // Getting in is silent: the door was heard opening, and is heard shutting if he shuts it.
  }

  /**
   * What F does at a kit car's seat seen through its open door (`resolve`): takes the
   * thing looked at, or the thing lying on that seat; lays what he holds there when he
   * could not sit with it (a contract's cargo, something too big for a lap); else sits
   * (vehicle/cabin.ts).
   */
  private cabinAction(resolved: Resolved):
    | { readonly kind: 'sit' }
    | { readonly kind: 'take'; readonly place: number }
    | { readonly kind: 'lay'; readonly place: number; readonly item: Item }
    | { readonly kind: 'refuse'; readonly why: string } {
    const car = resolved.carId ? this.world.state.cars[resolved.carId] : undefined;
    const seat = resolved.kitSeat;
    if (!car || !seat || !resolved.vehicle) return { kind: 'sit' };
    const cabin = car.cabin;
    const takeAt = resolved.kitPlace >= 0 ? resolved.kitPlace : seatTaken(cabin, seat) ? cabinIndex(takePlace(cabin, seat)!) : -1;
    if (takeAt >= 0 && cabin[takeAt]) {
      if (this.inventory.contents.length >= INVENTORY_ITEM_LIMIT && cabin[takeAt]!.type !== 'coin') {
        return { kind: 'refuse', why: 'your hands are full' };
      }
      return { kind: 'take', place: takeAt };
    }
    const held = this.inventory.held;
    if (held && this.cabinRefusal() !== null && seat !== 'driver') {
      if (held.type === 'contract_cargo') {
        const full = this.contractSlotsRefusal(car.id);
        if (full) return { kind: 'refuse', why: full };
      }
      const lay = layPlace(cabin, resolved.vehicle.cabinRooms, seat, cabinItemBounds(held));
      if ('refusal' in lay) return { kind: 'refuse', why: lay.refusal };
      return { kind: 'lay', place: cabinIndex(lay.place), item: held };
    }
    return { kind: 'sit' };
  }

  /**
   * Why the player cannot sit down with what they carry, else null. The pack rides in
   * the cabin, so a contract parcel in it was a second parcel aboard past the car's
   * contract rule; a parcel goes in the boot or on a seat. And an engine does not fit
   * on a lap.
   */
  private cabinRefusal(): string | null {
    for (const item of this.inventory.contents) {
      if (item.type === 'contract_cargo') return `stow the ${itemLabel(item)} in the boot or lay it on a seat first`;
      if (itemMass(item) > CABIN_ITEM_LIMIT_KG) return `the ${itemLabel(item)} won't fit in the cabin`;
    }
    return null;
  }

  /**
   * Steps the occupant out, or refuses without a word: the car is moving too fast
   * (`speedKmh` is absolute, so reversing at speed too), or it is a kit car whose door by
   * his seat is shut, which answers with the refusal knock.
   */
  private tryExit(roadS: number): void {
    const carId = this.world.state.player.drivingCarId;
    if (!carId) return;
    const active = this.getVehicle();
    if (!active || active.vehicle.speedKmh >= EXIT_SPEED_LIMIT_KMH) return;
    const rig = active.vehicle.kit;
    const door = rig ? this.kitExitDoor(rig, active.vehicle, this.world.state.player.seat) : null;
    if (rig && door && rig.get(door.id) <= 0.5) {
      this.sound = 'refused';
      return;
    }
    const exit = this.computeExitPosition(carId, active.vehicle, door);
    this.world.apply({ t: 'exit_car' });
    // Silent, as getting in is: the door he leaves by was opened and is shut with E.
    if (this.player) {
      this.player.setEnabled(true);
      if (exit) this.player.teleport(exit.x, exit.y, exit.z, roadS);
    }
  }

  /**
   * The door `seat` is left by, open or shut: the front door on its side for a front
   * seat; for a rear seat the rear door on its side, or the front one on a car without
   * rear doors. Null for a kit car without doors found, which is left by its flank.
   */
  private kitExitDoor(rig: KitRig, vehicle: Vehicle, seat: PlayerSeat): KitDoor | null {
    const left = seat === 'driver' || seat === 'rear-left';
    const rear = seat === 'rear-left' || seat === 'rear-right';
    let front: KitDoor | null = null;
    for (const door of this.kitDoors(rig, vehicle)) {
      if (door.left !== left) continue;
      if (!door.front && rear) return door;
      if (door.front) front = door;
    }
    return front;
  }

  private computeExitPosition(
    carId: string,
    vehicle: Vehicle,
    door: KitDoor | null,
  ): { x: number; y: number; z: number } | null {
    const car = this.world.state.cars[carId];
    if (!car) return null;
    const measure = vehicle.modelMeasure;
    const chassis = vehicle.chassis;
    const t = chassis.translation(this.tScratch);
    chassis.rotation(this.qScratch);

    // Model convention: +X is left, the models face +Z (see render/carmodel.ts).
    if (door) {
      // A kit car is left through the door that was opened: beside it, on its side, in
      // the rear half of the opening where the swung door does not stand, 0.8 m out
      // from the measured flank.
      const box = door.box;
      this.kitCentre.set((box.min.x + box.max.x) / 2, (box.min.y + box.max.y) / 2, box.min.z * 0.75 + box.max.z * 0.25);
      door.node.parent!.localToWorld(this.kitCentre);
      this.kitCentre.x -= t.x;
      this.kitCentre.y -= t.y;
      this.kitCentre.z -= t.z;
      this.kitCentre.applyQuaternion(this.qBody.copy(this.qScratch).invert());
      const out = measure.halfExtents[0] + 0.8;
      this.vScratch.set(door.left ? out : -out, 0, this.kitCentre.z).applyQuaternion(this.qScratch);
    } else {
      // The left flank is a featureless shell with baked doors, so exit at the
      // measured left edge stepped a further 1.1 m outward.
      this.vScratch.set(measure.halfExtents[0] + 1.1, 0, 0).applyQuaternion(this.qScratch);
    }
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
