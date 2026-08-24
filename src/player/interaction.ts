import * as THREE from 'three';
import type { PhysicsWorld } from '../core/physics';
import type { CarState, GameWorld, StickerState } from '../game/state';
import type { InputFrame } from '../core/input';
import type {
  Inventory,
  Item,
  PartItem,
  FluidCanItem,
  FluidKind,
  ToolKind,
} from '../items/items';
import { itemLabel, itemMass } from '../items/items';
import type { CarStats, PartInstance } from '../parts/registry';
import {
  applyBrush,
  applySponge,
  coolantCapacity,
  oilCapacity,
  variant,
  RUST_CLEAN_EPSILON,
  BRUSH_DIRT_FLOOR,
} from '../parts/registry';
import type { LoosePartField } from '../parts/loose';
import type { WreckField } from '../world/wrecks';
import type { Vehicle } from '../vehicle/vehicle';
import { jobAt, type FreightField } from '../world/freight';
import type { TrailerField } from '../vehicle/trailer';
import { carModel } from '../vehicle/carmodels';
import { setCondition } from '../render/materials';
import type { FoleyEvent, FoleyContinuous } from '../audio/foley';
import type { Player } from './player';

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
/** A filled anchor is picked for REMOVAL when the aim ray passes within this of it. */
const ANCHOR_PICK_RADIUS = 0.6;
/**
 * Reach and forgiveness for MOUNTING the gizmo you are holding.
 *
 * Deliberately more generous than removal picking, and than `RAY_RANGE`. Anchors are
 * picked by proximity to the aim ray rather than by a physics hit, so range is not a
 * line-of-sight question — the player aims at a spot on the shell, not through a
 * collider. The car is already gated by `VEHICLE_RANGE`, so matching it here costs
 * nothing and makes mounting feel fair.
 */
const ANCHOR_FIT_RADIUS = 0.85;
const ANCHOR_FIT_RANGE = VEHICLE_RANGE;
/** Condition deltas are throttled; the visual updates every tick regardless. */
const CONDITION_EMIT_INTERVAL = 0.25;
/** Fuel poured per second from a held can. */
const FUEL_POUR_RATE = 1.2;
/**
 * How far the towing car may be from the player while coupling a trailer. Generous
 * on purpose: you stand at the drawbar, and the car you are hooking to is a whole
 * car-length away by definition.
 */
const HITCH_CAR_RANGE = 9;
/**
 * The only sticker design so far: a five-pointed star, one per completed haul.
 * Named rather than hardcoded at the call site so a pack of designs can be added
 * without touching the placement path or the save format.
 */
const STICKER_KIND = 'star';
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
  | { kind: 'revivable-wreck'; wreckId: string }
  | { kind: 'trailer'; trailerId: string }
  | { kind: 'pallet'; poiIndex: number }
  | { kind: 'freight-sign'; poiIndex: number }
  | { kind: 'boot'; carId: string }
  | { kind: 'car-body'; carId: string; point: THREE.Vector3; normal: THREE.Vector3 }
  | { kind: 'anchor'; carId: string; anchorId: string };

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
  /**
   * Boot contents while the player is looking into one, else null. Reported rather
   * than drawn here for the same reason the sounds are: this class owns the world,
   * not the screen.
   */
  boot: readonly (Item | null)[] | null;
}

const FLUID_POUR_RATE = 1.2;
/**
 * How close you have to stand to a car to pour into it. Comfortably more than the
 * 2.6 m aim ray, because pouring is not aimed: you walk up to the car, not to a
 * spot on it.
 */
const POUR_RANGE = 4.2;
/** Within this many litres of capacity a reservoir reads as full. */
const FLUID_FULL_EPSILON = 0.05;
/**
 * Reach and forgiveness for the boot. Generous: it is a region the size of a car's
 * tail, not a point, and the player stands behind the car looking at it rather than
 * aiming at a latch.
 */
const BOOT_RANGE = 3.2;
const BOOT_PICK_RADIUS = 0.95;

/**
 * The most recently stowed item in a boot, with its cell.
 *
 * Last in, first out. A boot is a hole you drop things into, not a shelf you index,
 * and searching backwards is what makes "put the can in, take the can out" work
 * without the player ever choosing a slot.
 */
function lastStowed(car: CarState): { cell: number; item: Item } | null {
  for (let i = car.storage.length - 1; i >= 0; i--) {
    const item = car.storage[i];
    if (item) return { cell: i, item };
  }
  return null;
}

/**
 * Which reservoir a fluid goes into on this car, with its current level and size.
 *
 * Null means this car cannot take that fluid at all — the only case being petrol
 * into a diesel or the reverse. Coolant and oil fit every engine, so they never
 * fail; a can of the wrong fuel is the one mistake the game lets you make and then
 * refuses.
 */
function fluidTarget(
  car: CarState,
  stats: CarStats,
  fluid: FluidKind,
): { label: string; level: number; capacity: number } | null {
  switch (fluid) {
    case 'petrol':
    case 'diesel':
      if (stats.tankCapacity <= 0 || stats.fuel !== fluid) return null;
      return { label: 'tank', level: car.fuelLitres, capacity: stats.tankCapacity };
    case 'coolant':
      return {
        label: 'coolant',
        level: car.coolantLitres,
        capacity: coolantCapacity(stats.engine),
      };
    case 'oil':
      return { label: 'oil', level: car.oilLitres, capacity: oilCapacity(stats.engine) };
  }
}

interface Resolved {
  target: Target;
  vehicle: Vehicle | null;
  carId: string | null;
  /** Distance from the eye to the car's chassis centre, metres. */
  vehicleDist: number;
}

function conditionPrefix(part: PartInstance): string {
  if (part.rust > 0.3) return 'rusty ';
  if (part.dirt > 0.3) return 'dirty ';
  return '';
}

function scrubLabel(part: PartInstance): string {
  if (part.rust > RUST_CLEAN_EPSILON) return 'rust';
  if (part.dirt > BRUSH_DIRT_FLOOR) return 'dirt';
  return 'grime';
}

export class Interaction {
  private player: Player | null = null;
  private prevInteract = false;
  private prevMount = false;
  private prevDrop = false;
  private conditionEmitTimer = 0;

  /** The anchor id under the crosshair on the last resolve, for ghost previews. */
  public lastAnchorTarget: string | null = null;

  private readonly tScratch = new THREE.Vector3();
  private readonly qScratch = new THREE.Quaternion();
  private readonly vScratch = new THREE.Vector3();
  /** This tick's discrete sound and held action; reset at the top of every tick. */
  private sound: FoleyEvent | null = null;
  private continuous: FoleyContinuous = null;
  /** Scene-graph raycaster and scratch, for picking real bodywork. */
  private readonly raycaster = new THREE.Raycaster();
  private readonly rayOrigin = new THREE.Vector3();
  private readonly rayDir = new THREE.Vector3();
  private readonly qBody = new THREE.Quaternion();
  private readonly hits: THREE.Intersection[] = [];

  constructor(
    private readonly physics: PhysicsWorld,
    private readonly world: GameWorld,
    private readonly inventory: Inventory,
    private readonly loose: LoosePartField,
    private readonly wrecks: WreckField,
    private readonly trailers: TrailerField,
    private readonly freight: FreightField,
    /** The car in reach, WITH its id. Never re-derive the id from geometry. */
    private readonly getVehicle: () => { carId: string; vehicle: Vehicle } | null,
    /** Materialises a freed car; the composition root owns the Vehicle map. */
    private readonly onCarFreed: (car: CarState) => void,
    /** Draws a newly placed sticker; the renderer owns the decal meshes. */
    private readonly onStickerPlaced: (carId: string, sticker: StickerState) => void,
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
    this.prevInteract = input.interact;
    this.prevMount = input.mount;
    this.prevDrop = input.dropItem;
    this.sound = null;
    this.continuous = null;

    if (this.world.state.player.drivingCarId) {
      // Exit is edge-triggered, but a refusal stays up while the key is held so
      // the prompt is visible instead of a single-tick flicker.
      let prompt: string | null = null;
      if (interactPressed) prompt = this.tryExit(roadS);
      else if (input.interact) prompt = this.exitRefused();
      return { prompt, sound: this.sound, continuous: null, boot: null };
    }

    const resolved = this.resolve(eyeX, eyeY, eyeZ, dirX, dirY, dirZ);
    const prompt = this.promptFor(resolved);

    if (input.usePrimary) this.usePrimary(dt, resolved);
    if (mountPressed) this.mount(resolved);
    if (interactPressed) this.tryEnter(resolved);
    // Deliberately after the driving early-return above: dropping while seated is a
    // no-op, the item stays in the inventory.
    if (dropPressed) this.drop(eyeX, eyeY, eyeZ, dirX, dirY, dirZ);

    // Resolved AFTER the actions above, so stowing or taking is reflected in the
    // same frame the player sees rather than one behind.
    const boot =
      resolved.target.kind === 'boot'
        ? (this.world.state.cars[resolved.target.carId]?.storage ?? null)
        : null;
    return { prompt, sound: this.sound, continuous: this.continuous, boot };
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
    // Written here rather than derived from `target` afterwards: TypeScript narrows
    // `target` to its initial `{ kind: 'none' }` literal and will not widen it back
    // for a closure assignment, so any later `target.kind === 'anchor'` test is a
    // type error. `next` is an un-narrowed parameter, so the test is valid inside `keep`.
    this.lastAnchorTarget = null;
    const keep = (dist: number, next: Target): void => {
      if (dist < bestDist) {
        bestDist = dist;
        target = next;
        this.lastAnchorTarget = next.kind === 'anchor' ? next.anchorId : null;
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
      // One physics hit, six possible owners. Each map is keyed by collider handle,
      // so the whole chain is a handful of hash lookups on the aim ray's hit.
      const h = hit.colliderHandle;
      const partId = this.loose.partIdForCollider(h);
      const itemId = partId ? null : this.loose.itemIdForCollider(h);
      const wreckId = partId || itemId ? null : this.wrecks.wreckIdForCollider(h);
      const trailerId = partId || itemId || wreckId ? null : this.trailers.trailerIdForCollider(h);
      const claimed = partId || itemId || wreckId || trailerId;
      const palletPoi = claimed ? null : this.freight.palletPoiForCollider(h);
      const signPoi = claimed || palletPoi !== null ? null : this.freight.signPoiForCollider(h);
      if (partId) keep(hit.toi, { kind: 'loose-part', partId });
      else if (itemId) keep(hit.toi, { kind: 'loose-item', itemId });
      else if (wreckId) keep(hit.toi, { kind: 'revivable-wreck', wreckId });
      else if (trailerId) keep(hit.toi, { kind: 'trailer', trailerId });
      else if (palletPoi !== null) keep(hit.toi, { kind: 'pallet', poiIndex: palletPoi });
      else if (signPoi !== null) keep(hit.toi, { kind: 'freight-sign', poiIndex: signPoi });
    }

    // Anchors have no colliders (a bare mount must be aimable), so project the ray
    // against each anchor's world position instead.
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

      const anchors = vehicle.modelMeasure.anchors;
      const carState = this.world.state.cars[carId];
      const gizmos = carState.gizmos;
      const held = this.inventory.held;
      const heldPart = held?.type === 'part' ? held.part : null;

      // An anchor is only a candidate for something the player can actually DO: mount
      // the held part into an empty anchor, or pull a mounted gizmo out. Gizmos are
      // junk, not fitted parts, so an empty anchor accepts whatever is held.
      let bestFitAlong = Infinity;
      let bestFit: Target | null = null;
      let bestRemoveAlong = Infinity;
      let bestRemove: Target | null = null;

      for (const anchor of anchors) {
        const isFilled = gizmos[anchor.id] !== undefined;
        const fittable = !isFilled && heldPart !== null;
        const removable = isFilled;
        if (!fittable && !removable) continue;

        this.vScratch.set(anchor.pos[0], anchor.pos[1], anchor.pos[2]).applyQuaternion(this.qScratch);
        const rx = this.vScratch.x + t.x - eyeX;
        const ry = this.vScratch.y + t.y - eyeY;
        const rz = this.vScratch.z + t.z - eyeZ;
        const along = rx * dx + ry * dy + rz * dz;
        if (along < 0) continue;
        const perpX = rx - dx * along;
        const perpY = ry - dy * along;
        const perpZ = rz - dz * along;
        const perpSq = perpX * perpX + perpY * perpY + perpZ * perpZ;

        if (fittable && along <= ANCHOR_FIT_RANGE && perpSq < ANCHOR_FIT_RADIUS * ANCHOR_FIT_RADIUS) {
          if (along < bestFitAlong) {
            bestFitAlong = along;
            bestFit = { kind: 'anchor', carId, anchorId: anchor.id };
          }
        }
        if (removable && along <= RAY_RANGE && perpSq < ANCHOR_PICK_RADIUS * ANCHOR_PICK_RADIUS) {
          if (along < bestRemoveAlong) {
            bestRemoveAlong = along;
            bestRemove = { kind: 'anchor', carId, anchorId: anchor.id };
          }
        }
      }

      // Mounting wins: if the player is holding a part that goes somewhere in reach,
      // that is unambiguously the intent.
      if (bestFit) keep(bestFitAlong, bestFit);
      else if (bestRemove) keep(bestRemoveAlong, bestRemove);

      // The boot. Picked like an anchor rather than by a collider, because the boot
      // is not a modelled object on any of these shells — it is a REGION: the rear
      // face of the measured body box, at about waist height. Standing behind the
      // car and looking at its tail is the entire gesture, and it needs no openable
      // door and no new geometry.
      if (carState.storage.length > 0) {
        const half = vehicle.modelMeasure.halfExtents;
        this.vScratch.set(0, -half[1] * 0.1, -half[2]).applyQuaternion(this.qScratch);
        const bx = this.vScratch.x + t.x - eyeX;
        const by = this.vScratch.y + t.y - eyeY;
        const bz = this.vScratch.z + t.z - eyeZ;
        const along = bx * dx + by * dy + bz * dz;
        if (along > 0 && along <= BOOT_RANGE) {
          const px = bx - dx * along;
          const py = by - dy * along;
          const pz = bz - dz * along;
          if (px * px + py * py + pz * pz < BOOT_PICK_RADIUS * BOOT_PICK_RADIUS) {
            keep(along, { kind: 'boot', carId });
          }
        }
      }

      // Bodywork, for sticking a sticker on. Deliberately a MESH raycast rather
      // than the physics hit: the chassis collider is a box with its floor raised to
      // the wheel centres, so a collider hit would place stickers in mid-air off the
      // real silhouette. Only offered when there is actually a sticker to place, so
      // it never competes with a mount or a fuel pour.
      if (this.world.state.stickersUnplaced > 0 && vehicleDist <= VEHICLE_RANGE) {
        const surface = this.pickBody(vehicle, eyeX, eyeY, eyeZ, dx, dy, dz);
        if (surface) keep(surface.distance, { kind: 'car-body', carId, ...surface.local });
      }
    }

    // `lastAnchorTarget` was already recorded by `keep`.
    return { target, vehicle, carId, vehicleDist };
  }

  /**
   * Nearest point on a car's drawn bodywork along the aim ray, in the car's own
   * local space.
   *
   * Three.js raycasting rather than Rapier: the physics chassis is a single box, and
   * a sticker placed on a box would float off the bonnet of anything with a shape.
   * The scene graph has the real triangles, so it is the only thing that can answer
   * "where exactly is the player pointing on this car".
   */
  private pickBody(
    vehicle: Vehicle,
    eyeX: number,
    eyeY: number,
    eyeZ: number,
    dx: number,
    dy: number,
    dz: number,
  ): { distance: number; local: { point: THREE.Vector3; normal: THREE.Vector3 } } | null {
    this.raycaster.set(this.rayOrigin.set(eyeX, eyeY, eyeZ), this.rayDir.set(dx, dy, dz));
    this.raycaster.far = VEHICLE_RANGE;
    this.hits.length = 0;
    this.raycaster.intersectObject(vehicle.root, true, this.hits);
    for (const hit of this.hits) {
      // Wheels are not bodywork, and a sticker on a rotating wheel would smear.
      if (/^wheel_/.test(hit.object.name)) continue;
      if (!hit.face) continue;
      const point = vehicle.root.worldToLocal(hit.point.clone());
      // Face normals are in the hit object's local space; take them to world and
      // then into the car's frame, so a normal on a rotated sub-mesh is still right.
      const normal = hit.face.normal
        .clone()
        .applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld))
        .normalize();
      vehicle.root.getWorldQuaternion(this.qBody);
      normal.applyQuaternion(this.qBody.invert()).normalize();
      this.hits.length = 0;
      return { distance: hit.distance, local: { point, normal } };
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

  private promptFor(resolved: Resolved): string | null {
    const held = this.inventory.held;
    const t = resolved.target;

    if (t.kind === 'loose-part') {
      const part = this.world.state.looseParts[t.partId]?.part;
      if (!part) return null;
      const toolPrompt = this.toolPrompt(held, part);
      if (toolPrompt) return toolPrompt;
      const label = variant(part.variantId).label;
      if (variant(part.variantId).mass + this.inventory.carriedMass > this.inventory.massLimit) {
        return `[F] pick up ${label} — too heavy`;
      }
      return `[F] pick up ${conditionPrefix(part)}${label}`;
    }

    if (t.kind === 'loose-item') {
      const item = this.world.state.looseItems[t.itemId]?.item;
      if (!item) return null;
      if (itemMass(item) + this.inventory.carriedMass > this.inventory.massLimit) {
        return `[F] pick up ${itemLabel(item)} — too heavy`;
      }
      return `[F] pick up ${itemLabel(item)}`;
    }

    if (t.kind === 'revivable-wreck') {
      const label = this.wrecks.labelFor(t.wreckId);
      if (!label) return null;
      if (held?.type !== 'tool' || held.tool !== 'wrench') {
        return `${label} — might still run, with a wrench`;
      }
      const pct = Math.round(this.wrecks.progressOf(t.wreckId) * 100);
      return pct > 0 ? `[LMB] freeing ${label} — ${pct}%` : `[LMB] free the ${label}`;
    }

    if (t.kind === 'pallet') {
      const job = jobAt(this.world.state.seed, t.poiIndex);
      if (!job) return null;
      const km = (job.distanceM / 1000).toFixed(0);
      if (this.world.state.job) return `${job.cargoKg} kg — already hauling`;
      const trailer = resolved.carId ? this.trailers.hitchedTo(resolved.carId) : null;
      if (!trailer) return `${job.cargoKg} kg, ${km} km down the road — needs a trailer`;
      if (trailer.cargoKg > 0) return `${job.cargoKg} kg — your trailer is loaded`;
      return `[F] load ${job.cargoKg} kg — ${km} km down the road`;
    }

    if (t.kind === 'freight-sign') {
      const job = this.world.state.job;
      if (!job || job.toPoi !== t.poiIndex) return null;
      const trailer = resolved.carId ? this.trailers.hitchedTo(resolved.carId) : null;
      if (!trailer || trailer.cargoKg <= 0) return 'this is the place — bring the load';
      return `[F] deliver ${Math.round(trailer.cargoKg)} kg`;
    }

    if (t.kind === 'boot') {
      const car = this.world.state.cars[t.carId];
      if (!car) return null;
      const used = car.storage.filter((cell) => cell !== null).length;
      const total = car.storage.length;
      if (held) {
        if (used >= total) return `boot full — ${used}/${total}`;
        return `[F] stow ${itemLabel(held)} — boot ${used}/${total}`;
      }
      const top = lastStowed(car);
      if (!top) return `boot empty — ${total} cells`;
      return `[F] take ${itemLabel(top.item)} — boot ${used}/${total}`;
    }

    if (t.kind === 'car-body') {
      const spare = this.world.state.stickersUnplaced;
      if (spare <= 0) return null;
      return `[F] stick it on — ${spare} to place`;
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

    if (t.kind === 'anchor') {
      const car = this.world.state.cars[t.carId];
      if (!car) return null;
      const anchor = resolved.vehicle?.modelMeasure.anchors.find((a) => a.id === t.anchorId);
      if (!anchor) return null;
      const fitted = car.gizmos[t.anchorId];

      // Pouring is no longer aimed at anything: see the fluid-can branch at the end
      // of this method. Standing near the car with a can is the whole gesture.
      if (fitted) {
        const toolPrompt = this.toolPrompt(held, fitted);
        if (toolPrompt) return toolPrompt;
        const label = variant(fitted.variantId).label;
        if (variant(fitted.variantId).mass + this.inventory.carriedMass > this.inventory.massLimit) {
          return `[F] remove ${label} — too heavy`;
        }
        return `[F] remove ${label}`;
      }

      if (held?.type === 'part') {
        const v = variant(held.part.variantId);
        return `[F] mount ${v.label}`;
      }
    }

    // Pouring: proximity, not aim. Holding a can anywhere near a car offers the
    // transfer, because hunting for a filler neck on a low-poly shell that has no
    // modelled filler neck is busywork. It sits last so anything specific under the
    // crosshair — a loose part, a pallet, a trailer — still wins.
    if (held?.type === 'fluid_can' && resolved.vehicle && resolved.carId) {
      if (resolved.vehicleDist > POUR_RANGE) return null;
      return this.pourPrompt(held, resolved.carId, resolved.vehicle);
    }

    // Car entry remains bound to the interaction key, but vehicle prompts are
    // deliberately absent to keep the driving/on-foot HUD free of enter hints.
    return null;
  }

  /**
   * What pouring this can into this car would do, or why it would not.
   *
   * The fluid decides the reservoir with no ambiguity, so there is no picker and no
   * mode: coolant goes in the coolant, oil in the oil, and petrol or diesel in the
   * tank if the engine takes that one.
   */
  private pourPrompt(can: FluidCanItem, carId: string, vehicle: Vehicle): string | null {
    const car = this.world.state.cars[carId];
    if (!car) return null;
    if (can.litres <= 0) return `${can.fluid} can — empty`;
    const target = fluidTarget(car, vehicle.stats, can.fluid);
    if (!target) return `[LMB] pour ${can.fluid} — this engine takes ${vehicle.stats.fuel}`;
    if (target.level >= target.capacity - FLUID_FULL_EPSILON) {
      return `${target.label} full — ${target.capacity.toFixed(1)} L`;
    }
    return `[LMB] pour ${can.fluid} — ${target.label} ${target.level.toFixed(1)}/${target.capacity.toFixed(1)} L`;
  }

  private toolPrompt(held: Item | null, part: PartInstance): string | null {
    if (held?.type !== 'tool') return null;
    if (held.tool === 'brush') return `[LMB] scrub ${scrubLabel(part)}`;
    if (held.tool === 'sponge') {
      if (part.rust > RUST_CLEAN_EPSILON) return '[LMB] sponge — needs the brush first';
      return '[LMB] polish';
    }
    return null; // wrench: no continuous action; the [F] prompt flows through.
  }

  private usePrimary(dt: number, resolved: Resolved): void {
    const held = this.inventory.held;
    if (!held) return;
    if (held.type === 'tool') {
      // The wrench is the one tool that acts on something other than a part, so it
      // branches before `scrub` rather than inside it.
      if (held.tool === 'wrench') this.wrench(dt, resolved);
      else this.scrub(dt, held.tool, resolved);
    } else if (held.type === 'fluid_can') this.pourFluid(dt, held, resolved);
  }

  /**
   * Works a derelict loose. The whole car supply of the game is this method: there
   * is no spawn menu, so every vehicle after the first is one the player freed.
   */
  private wrench(dt: number, resolved: Resolved): void {
    const t = resolved.target;
    if (t.kind !== 'revivable-wreck') return;
    this.continuous = 'scrub';
    const car = this.wrecks.advance(t.wreckId, dt);
    if (!car) return;
    this.onCarFreed(car);
    this.sound = 'mount';
  }

  private scrub(dt: number, tool: ToolKind, resolved: Resolved): void {
    const part = this.targetPart(resolved);
    if (!part) return;
    if (tool === 'brush') {
      if (!applyBrush(part, dt)) return;
    } else if (tool === 'sponge') {
      // applySponge refuses while rust remains, enforcing brush-then-sponge order.
      if (!applySponge(part, dt)) return;
    } else {
      return; // wrench does nothing continuous.
    }
    this.continuous = 'scrub';
    this.applyConditionVisual(resolved, part);
    this.conditionEmitTimer += dt;
    if (this.conditionEmitTimer >= CONDITION_EMIT_INTERVAL) {
      this.conditionEmitTimer = 0;
      this.world.apply({ t: 'part_condition', partId: part.id, dirt: part.dirt, rust: part.rust });
    }
  }

  /**
   * Pours whatever is in the held can into whatever reservoir it belongs in.
   *
   * Gated on distance to the car, not on what the crosshair is over: you walk up
   * with the can and hold the button. One code path for all four fluids, because
   * the only thing the kind changes is which number goes up.
   */
  private pourFluid(dt: number, can: FluidCanItem, resolved: Resolved): void {
    const carId = resolved.carId;
    const vehicle = resolved.vehicle;
    if (!carId || !vehicle || resolved.vehicleDist > POUR_RANGE) return;
    if (can.litres <= 0) return;
    const car = this.world.state.cars[carId];
    if (!car) return;

    const target = fluidTarget(car, vehicle.stats, can.fluid);
    if (!target) return;

    const room = target.capacity - target.level;
    if (room <= FLUID_FULL_EPSILON) return;
    const poured = Math.min(FLUID_POUR_RATE * dt, can.litres, room);
    if (poured <= 0) return;

    can.litres -= poured;
    this.continuous = 'pour';
    const level = target.level + poured;
    if (can.fluid === 'petrol' || can.fluid === 'diesel') {
      this.world.apply({ t: 'car_fuel', carId, litres: level });
    } else {
      this.world.apply({ t: 'car_fluid', carId, fluid: can.fluid, litres: level });
    }
  }

  private mount(resolved: Resolved): void {
    const t = resolved.target;
    const held = this.inventory.held;

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

    // Accepting a haul. The job is recorded and the destination's sign lights on the
    // next frame's lamp push — no chunk rebuild, nothing else to tell the player.
    if (t.kind === 'pallet') {
      if (this.world.state.job) return;
      const job = jobAt(this.world.state.seed, t.poiIndex);
      if (!job || !resolved.carId) return;
      const trailer = this.trailers.hitchedTo(resolved.carId);
      if (!trailer || trailer.cargoKg > 0) return;
      trailer.setCargo(job.cargoKg);
      this.world.apply({
        t: 'job_accept',
        job: { fromPoi: job.fromPoi, toPoi: job.toPoi, cargoKg: job.cargoKg },
      });
      this.freight.takePallet(t.poiIndex);
      this.sound = 'mount';
      return;
    }

    // Delivering. The sign is both the marker and the receiver: one object doing
    // both jobs is why this system needs no UI at all.
    if (t.kind === 'freight-sign') {
      const job = this.world.state.job;
      if (!job || job.toPoi !== t.poiIndex || !resolved.carId) return;
      const trailer = this.trailers.hitchedTo(resolved.carId);
      if (!trailer || trailer.cargoKg <= 0) return;
      trailer.setCargo(0);
      this.world.apply({ t: 'job_complete', poiIndex: t.poiIndex });
      this.sound = 'mount';
      return;
    }

    // The boot. One key does both directions, decided by whether your hands are
    // full: holding something stows it, holding nothing takes the last thing back
    // out. That is what lets the whole feature exist without a grid, a cursor or a
    // modal screen — the prompt line already says what will happen.
    if (t.kind === 'boot') {
      const car = this.world.state.cars[t.carId];
      if (!car) return;
      if (held) {
        const cell = car.storage.indexOf(null);
        if (cell < 0) {
          this.sound = 'refused';
          return;
        }
        this.inventory.remove(held.id);
        this.world.apply({ t: 'car_storage', carId: t.carId, cell, item: held });
        this.sound = 'drop';
        return;
      }
      const top = lastStowed(car);
      if (!top) return;
      // Refused rather than silently dropped: a boot item that vanished because the
      // pack was full would be the worst possible outcome of pressing one key.
      if (!this.inventory.add(top.item)) {
        this.sound = 'refused';
        return;
      }
      this.world.apply({ t: 'car_storage', carId: t.carId, cell: top.cell, item: null });
      this.sound = 'pickup';
      return;
    }

    // Placing a sticker. Permanent by design: no removal path exists anywhere, and
    // it stays with this car if the player ever drives another.
    if (t.kind === 'car-body') {
      if (this.world.state.stickersUnplaced <= 0) return;
      const car = this.world.state.cars[t.carId];
      if (!car) return;
      const sticker: StickerState = {
        kind: STICKER_KIND,
        x: t.point.x,
        y: t.point.y,
        z: t.point.z,
        nx: t.normal.x,
        ny: t.normal.y,
        nz: t.normal.z,
        // Spin from where the player happened to be standing, so a bonnet full of
        // them reads as hand-applied rather than stamped.
        roll: Math.atan2(t.normal.x, t.normal.z),
      };
      this.world.apply({ t: 'sticker_place', carId: t.carId, sticker });
      this.onStickerPlaced(t.carId, sticker);
      this.sound = 'mount';
      return;
    }

    if (t.kind === 'anchor') {
      const car = this.world.state.cars[t.carId];
      if (!car || !resolved.vehicle) return;
      const anchor = resolved.vehicle.modelMeasure.anchors.find((a) => a.id === t.anchorId);
      if (!anchor) return;
      const fitted = car.gizmos[t.anchorId];
      if (fitted) this.detach(t.carId, t.anchorId, fitted, resolved);
      else if (held?.type === 'part') this.attach(t.carId, t.anchorId, held.part, resolved);
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
    if (held.type === 'part') this.loose.spawn(held.part, eyeX + dx * dist, eyeY + dy * dist, eyeZ + dz * dist);
    else this.loose.spawnItem(held, eyeX + dx * dist, eyeY + dy * dist, eyeZ + dz * dist);
    this.sound = 'drop';
  }

  private attach(carId: string, anchorId: string, part: PartInstance, resolved: Resolved): void {
    const car = this.world.state.cars[carId];
    if (!car || !resolved.vehicle) return;
    // Gizmos are junk, not fitted parts: any part mounts on any anchor.
    this.world.apply({ t: 'gizmo_attach', carId, anchor: anchorId, part });
    this.inventory.remove(part.id);
    resolved.vehicle.rebuild();
    this.sound = 'mount';
  }

  private detach(carId: string, anchorId: string, part: PartInstance, resolved: Resolved): void {
    if (!resolved.vehicle) return;
    const anchor = resolved.vehicle.modelMeasure.anchors.find((a) => a.id === anchorId);
    if (!anchor) return; // a gizmo saved against an anchor this model lacks
    const t = resolved.vehicle.chassis.translation(this.tScratch);
    resolved.vehicle.chassis.rotation(this.qScratch);
    this.vScratch.set(anchor.pos[0], anchor.pos[1], anchor.pos[2]).applyQuaternion(this.qScratch);
    this.world.apply({ t: 'gizmo_detach', carId, anchor: anchorId });
    // Drop the removed gizmo into the loose field at its anchor's world position.
    this.loose.spawn(part, this.vScratch.x + t.x, this.vScratch.y + t.y, this.vScratch.z + t.z);
    resolved.vehicle.rebuild();
    this.sound = 'detach';
  }

  private targetPart(resolved: Resolved): PartInstance | null {
    const t = resolved.target;
    if (t.kind === 'loose-part') return this.world.state.looseParts[t.partId]?.part ?? null;
    if (t.kind === 'anchor') {
      const car = this.world.state.cars[t.carId];
      return car ? (car.gizmos[t.anchorId] ?? null) : null;
    }
    return null;
  }

  private applyConditionVisual(resolved: Resolved, part: PartInstance): void {
    const t = resolved.target;
    if (t.kind === 'loose-part') {
      const mesh = this.loose.meshFor(t.partId);
      if (mesh) setCondition(mesh, part.dirt, part.rust);
      return;
    }
    if (t.kind === 'anchor' && resolved.vehicle) {
      // Mounted gizmo: its mesh is named by anchor id inside the vehicle root.
      const mesh = resolved.vehicle.root.getObjectByName(t.anchorId);
      if (mesh) setCondition(mesh, part.dirt, part.rust);
    }
  }

  private tryEnter(resolved: Resolved): void {
    if (!resolved.vehicle || !resolved.carId) return;
    if (resolved.vehicleDist >= VEHICLE_RANGE) return;
    this.world.apply({ t: 'enter_car', carId: resolved.carId });
    this.player?.setEnabled(false);
    this.sound = 'enter-car';
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
    // measured left edge stepped a further 1.1 m outward.
    this.vScratch.set(-measure.halfExtents[0] - 1.1, 0, 0).applyQuaternion(this.qScratch);
    const exitX = t.x + this.vScratch.x;
    const exitZ = t.z + this.vScratch.z;

    // Ground check so exiting never drops the player inside geometry. Exclude the
    // player's own capsule for the same reason as the aim ray: it is about to be
    // placed at this spot, so it must never count as the ground.
    const ground = this.physics.raycast(
      { x: exitX, y: t.y + 2, z: exitZ },
      { x: 0, y: -1, z: 0 },
      6,
      this.player?.rigidBody,
    );
    const groundY = ground ? ground.point.y : t.y - measure.halfExtents[1];
    return { x: exitX, y: groundY, z: exitZ };
  }
}
