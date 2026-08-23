import * as THREE from 'three';
import type { PhysicsWorld } from '../core/physics';
import type { GameWorld } from '../game/state';
import type { InputFrame } from '../core/input';
import type { Inventory, Item, PartItem, FuelCanItem, ToolKind } from '../items/items';
import { itemLabel, itemMass } from '../items/items';
import type { PartInstance } from '../parts/registry';
import { applyBrush, applySponge, variant, RUST_CLEAN_EPSILON, BRUSH_DIRT_FLOOR } from '../parts/registry';
import type { LoosePartField } from '../parts/loose';
import type { Vehicle } from '../vehicle/vehicle';
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
 * Hits closer than this are treated as "no hit". The eye origin sits inside the
 * player's own capsule, and `castRayAndGetNormal(..., solid = true)` returns an
 * immediate zero-distance self-hit when the ray is not told to exclude that body.
 * Resolving that self-hit to a valid target is what made the bug invisible, so a
 * near-zero `toi` is now a programming error that degrades to a miss, never a
 * phantom pickup.
 */
const MIN_HIT_TOI = 0.05;

type Target =
  | { kind: 'none' }
  | { kind: 'loose-part'; partId: string }
  | { kind: 'loose-item'; itemId: string }
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
  continuous: FoleyContinuous;
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

  constructor(
    private readonly physics: PhysicsWorld,
    private readonly world: GameWorld,
    private readonly inventory: Inventory,
    private readonly loose: LoosePartField,
    private readonly getVehicle: () => Vehicle | null,
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
      if (interactPressed) this.tryExit();
      return { prompt: null, sound: this.sound, continuous: null };
    }

    const resolved = this.resolve(eyeX, eyeY, eyeZ, dirX, dirY, dirZ);
    const prompt = this.promptFor(resolved);

    if (input.usePrimary) this.usePrimary(dt, resolved);
    if (mountPressed) this.mount(resolved);
    if (interactPressed) this.tryEnter(resolved);
    // Deliberately after the driving early-return above: dropping while seated is a
    // no-op, the item stays in the inventory.
    if (dropPressed) this.drop(eyeX, eyeY, eyeZ, dirX, dirY, dirZ);

    return { prompt, sound: this.sound, continuous: this.continuous };
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
      const partId = this.loose.partIdForCollider(hit.colliderHandle);
      if (partId) keep(hit.toi, { kind: 'loose-part', partId });
      else {
        const itemId = this.loose.itemIdForCollider(hit.colliderHandle);
        if (itemId) keep(hit.toi, { kind: 'loose-item', itemId });
      }
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
      const gizmos = this.world.state.cars[carId].gizmos;
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
    }

    // `lastAnchorTarget` was already recorded by `keep`.
    return { target, vehicle, carId, vehicleDist };
  }

  /** The `getVehicle()` result, paired with the state car it wraps. */
  private targetVehicle(): { carId: string; vehicle: Vehicle } | null {
    const vehicle = this.getVehicle();
    if (!vehicle) return null;
    const driving = this.world.state.player.drivingCarId;
    if (driving) return { carId: driving, vehicle };
    // On foot, identify the wrapped car by matching the chassis to its state entry.
    const t = vehicle.chassis.translation(this.tScratch);
    let bestId: string | null = null;
    let bestD = Infinity;
    for (const id of Object.keys(this.world.state.cars)) {
      const car = this.world.state.cars[id]!;
      const d = (car.x - t.x) ** 2 + (car.z - t.z) ** 2;
      if (d < bestD) {
        bestD = d;
        bestId = id;
      }
    }
    return bestId ? { carId: bestId, vehicle } : null;
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

    if (t.kind === 'anchor') {
      const car = this.world.state.cars[t.carId];
      if (!car) return null;
      const anchor = resolved.vehicle?.modelMeasure.anchors.find((a) => a.id === t.anchorId);
      if (!anchor) return null;
      const fitted = car.gizmos[t.anchorId];

      // The car is complete, so any anchor doubles as the filler neck: pour wherever
      // the player is aiming rather than hunting a dedicated fuel_tank mount.
      if (held?.type === 'fuel_can') {
        const stats = resolved.vehicle?.stats;
        if (stats && stats.tankCapacity <= 0) return '[LMB] pour — no fuel tank';
        if (stats?.fuel && held.fuel !== stats.fuel) {
          return `[LMB] pour ${held.fuel} — wrong fuel (needs ${stats.fuel})`;
        }
        return `[LMB] pour ${held.fuel}`;
      }

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

    // Car entry remains bound to the interaction key, but vehicle prompts are
    // deliberately absent to keep the driving/on-foot HUD free of enter hints.
    return null;
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
    if (held.type === 'tool') this.scrub(dt, held.tool, resolved);
    else if (held.type === 'fuel_can') this.pourFuel(dt, held, resolved);
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

  private pourFuel(dt: number, can: FuelCanItem, resolved: Resolved): void {
    const t = resolved.target;
    if (t.kind !== 'anchor') return;
    const car = this.world.state.cars[t.carId];
    const stats = resolved.vehicle?.stats;
    if (!car || !stats || stats.tankCapacity <= 0) return;
    if (stats.fuel && can.fuel !== stats.fuel) return;
    if (can.litres <= 0) return;

    const amount = Math.min(FUEL_POUR_RATE * dt, can.litres);
    const target = Math.min(car.fuelLitres + amount, stats.tankCapacity);
    const poured = target - car.fuelLitres;
    if (poured <= 0) return; // tank full
    can.litres -= poured;
    this.continuous = 'pour';
    this.world.apply({ t: 'car_fuel', carId: t.carId, litres: target });
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

  private tryExit(): void {
    const carId = this.world.state.player.drivingCarId;
    if (!carId) return;
    const vehicle = this.getVehicle();
    if (!vehicle) return;
    this.world.apply({ t: 'exit_car' });
    this.sound = 'exit-car';
    const exit = this.computeExitPosition(carId, vehicle);
    if (this.player) {
      this.player.setEnabled(true);
      if (exit) this.player.teleport(exit.x, exit.y, exit.z);
    }
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
