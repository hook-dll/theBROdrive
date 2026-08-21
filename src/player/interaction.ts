import * as THREE from 'three';
import type { PhysicsWorld } from '../core/physics';
import type { GameWorld } from '../game/state';
import type { InputFrame } from '../core/input';
import type { Inventory, Item, PartItem, FuelCanItem, ToolKind } from '../items/items';
import { itemLabel, itemMass } from '../items/items';
import type { PartInstance, PartKind, SlotId, SlotDef } from '../parts/registry';
import { applyBrush, applySponge, body, variant, RUST_CLEAN_EPSILON, BRUSH_DIRT_FLOOR } from '../parts/registry';
import type { LoosePartField } from '../parts/loose';
import type { Vehicle } from '../vehicle/vehicle';
import { setCondition } from '../render/materials';
import type { Player } from './player';

/** How far the eye ray reaches for picking. */
const RAY_RANGE = 2.6;
/** Distance from the eye to a car's centre at which entering it is offered. */
const VEHICLE_RANGE = 3.5;
/** A filled slot is picked for REMOVAL when the aim ray passes within this of it. */
const SLOT_PICK_RADIUS = 0.6;
/**
 * Reach and forgiveness for FITTING the part you are holding.
 *
 * Deliberately more generous than removal picking, and than `RAY_RANGE`. Slots are
 * picked by proximity to the aim ray rather than by a physics hit, so range is not a
 * line-of-sight question — and measurement showed the battery slot on a wagon sits
 * 2.64 m from a comfortably-standing eye, i.e. it was being rejected by 4 cm while
 * incompatible slots nearer the crosshair won instead. The car is already gated by
 * `VEHICLE_RANGE`, so matching it here costs nothing and makes assembly feel fair.
 */
const SLOT_FIT_RADIUS = 0.85;
const SLOT_FIT_RANGE = VEHICLE_RANGE;
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
  | { kind: 'slot'; carId: string; slotId: SlotId };

interface Resolved {
  target: Target;
  vehicle: Vehicle | null;
  carId: string | null;
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

/** Short kind-derived location for the "… fits …" hint. */
function slotLocation(kind: PartKind): string {
  switch (kind) {
    case 'engine':
    case 'battery':
    case 'radiator':
      return 'in the engine bay';
    case 'gearbox':
    case 'fuel_tank':
    case 'exhaust':
      return 'under the car';
    case 'wheel':
      return 'in a wheel arch';
    case 'door':
      return 'on a door hinge';
    case 'hood':
      return 'on the bonnet';
    case 'trunk':
      return 'on the tailgate';
    case 'seat':
      return 'in the cabin';
    case 'mirror':
      return 'on a door';
    case 'bumper':
      return 'on the front or rear';
    case 'headlight':
      return 'in the front';
  }
}
export class Interaction {
  private player: Player | null = null;
  private prevInteract = false;
  private prevEnterExit = false;
  private conditionEmitTimer = 0;

  /** The slot id under the crosshair on the last resolve, for ghost previews. */
  public lastSlotTarget: SlotId | null = null;

  private readonly tScratch = new THREE.Vector3();
  private readonly qScratch = new THREE.Quaternion();
  private readonly vScratch = new THREE.Vector3();

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
  ): { prompt: string | null } {
    const interactPressed = input.interact && !this.prevInteract;
    const enterExitPressed = input.enterExit && !this.prevEnterExit;
    this.prevInteract = input.interact;
    this.prevEnterExit = input.enterExit;

    if (this.world.state.player.drivingCarId) {
      if (enterExitPressed) this.tryExit();
      return { prompt: '[G] exit' };
    }

    const resolved = this.resolve(eyeX, eyeY, eyeZ, dirX, dirY, dirZ);
    const prompt = this.promptFor(resolved);

    if (input.usePrimary) this.usePrimary(dt, resolved);
    if (interactPressed) this.interact(resolved);
    if (enterExitPressed) this.tryEnter(resolved);

    return { prompt };
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
    // for a closure assignment, so any later `target.kind === 'slot'` test is a type
    // error. `next` is an un-narrowed parameter, so the test is valid inside `keep`.
    this.lastSlotTarget = null;
    const keep = (dist: number, next: Target): void => {
      if (dist < bestDist) {
        bestDist = dist;
        target = next;
        this.lastSlotTarget = next.kind === 'slot' ? next.slotId : null;
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

    // Slots have no colliders (empty sockets must be aimable), so project the ray
    // against each slot's world position instead.
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

      const def = body(this.world.state.cars[carId].bodyId);
      const fitted = this.world.state.cars[carId].slots;
      const held = this.inventory.held;
      const heldPart = held?.type === 'part' ? held.part : null;
      const heldVariant = heldPart ? variant(heldPart.variantId) : null;
      const canFitHere = heldVariant ? heldVariant.fits.includes(def.bodyClass) : false;

      // A slot is only a candidate for something the player can actually DO: fit the
      // held part into an empty compatible socket, or pull a fitted part out. Letting
      // every slot compete is what produced "wrong slot (needs bumper)" while the
      // socket the player was aiming at sat just out of range.
      let bestFitAlong = Infinity;
      let bestFit: Target | null = null;
      let bestRemoveAlong = Infinity;
      let bestRemove: Target | null = null;

      for (const slot of def.slots) {
        const isFilled = fitted[slot.id] !== undefined;
        const fittable = !isFilled && canFitHere && heldVariant?.kind === slot.kind;
        const removable = isFilled;
        if (!fittable && !removable) continue;

        this.vScratch.set(slot.pos[0], slot.pos[1], slot.pos[2]).applyQuaternion(this.qScratch);
        const rx = this.vScratch.x + t.x - eyeX;
        const ry = this.vScratch.y + t.y - eyeY;
        const rz = this.vScratch.z + t.z - eyeZ;
        const along = rx * dx + ry * dy + rz * dz;
        if (along < 0) continue;
        const perpX = rx - dx * along;
        const perpY = ry - dy * along;
        const perpZ = rz - dz * along;
        const perpSq = perpX * perpX + perpY * perpY + perpZ * perpZ;

        if (fittable && along <= SLOT_FIT_RANGE && perpSq < SLOT_FIT_RADIUS * SLOT_FIT_RADIUS) {
          if (along < bestFitAlong) {
            bestFitAlong = along;
            bestFit = { kind: 'slot', carId, slotId: slot.id };
          }
        }
        if (removable && along <= RAY_RANGE && perpSq < SLOT_PICK_RADIUS * SLOT_PICK_RADIUS) {
          if (along < bestRemoveAlong) {
            bestRemoveAlong = along;
            bestRemove = { kind: 'slot', carId, slotId: slot.id };
          }
        }
      }

      // Fitting wins: if the player is holding a part that goes somewhere in reach,
      // that is unambiguously the intent.
      if (bestFit) keep(bestFitAlong, bestFit);
      else if (bestRemove) keep(bestRemoveAlong, bestRemove);
    }

    // `lastSlotTarget` was already recorded by `keep`.
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
        return `[E] pick up ${label} — too heavy`;
      }
      return `[E] pick up ${conditionPrefix(part)}${label}`;
    }

    if (t.kind === 'loose-item') {
      const item = this.world.state.looseItems[t.itemId]?.item;
      if (!item) return null;
      if (itemMass(item) + this.inventory.carriedMass > this.inventory.massLimit) {
        return `[E] pick up ${itemLabel(item)} — too heavy`;
      }
      return `[E] pick up ${itemLabel(item)}`;
    }

    if (t.kind === 'slot') {
      const car = this.world.state.cars[t.carId];
      if (!car) return null;
      const def = body(car.bodyId);
      const slot = def.slots.find((s) => s.id === t.slotId);
      if (!slot) return null;
      const fitted = car.slots[t.slotId];

      // The fuel filler is the fuel_tank mount; a held can pours there.
      if (slot.id === 'fuel_tank' && held?.type === 'fuel_can') {
        const stats = resolved.vehicle?.stats;
        if (stats && stats.tankCapacity <= 0) return '[LMB] pour — no fuel tank fitted';
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
          return `[E] remove ${label} — too heavy`;
        }
        return `[E] remove ${label}`;
      }

      if (held?.type === 'part') {
        const v = variant(held.part.variantId);
        if (v.kind !== slot.kind) return `[E] fit ${v.label} — wrong slot (needs ${slot.kind})`;
        if (!v.fits.includes(def.bodyClass)) return `[E] fit ${v.label} — doesn't fit ${def.label}`;
        return `[E] fit ${v.label}`;
      }
    }

    // No specific target: if a held part belongs in the nearby car, say where.
    if (held?.type === 'part' && resolved.vehicle && resolved.carId && resolved.vehicleDist < VEHICLE_RANGE) {
      const car = this.world.state.cars[resolved.carId];
      const def = car ? body(car.bodyId) : null;
      if (def) {
        const v = variant(held.part.variantId);
        if (v.fits.includes(def.bodyClass)) {
          const slot = def.slots.find((s) => s.kind === v.kind);
          if (slot) return `${v.label} fits ${slotLocation(slot.kind)}`;
        }
      }
    }

    // No specific target: offer entering when a drivable car is close enough.
    if (resolved.vehicle && resolved.carId && resolved.vehicle.stats.drivable && resolved.vehicleDist < VEHICLE_RANGE) {
      return '[G] enter car';
    }
    return null;
  }

  private toolPrompt(held: Item | null, part: PartInstance): string | null {
    if (held?.type !== 'tool') return null;
    if (held.tool === 'brush') return `[LMB] scrub ${scrubLabel(part)}`;
    if (held.tool === 'sponge') {
      if (part.rust > RUST_CLEAN_EPSILON) return '[LMB] sponge — needs the brush first';
      return '[LMB] polish';
    }
    return null; // wrench: no continuous action; the [E] prompt flows through.
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
    this.applyConditionVisual(resolved, part);
    this.conditionEmitTimer += dt;
    if (this.conditionEmitTimer >= CONDITION_EMIT_INTERVAL) {
      this.conditionEmitTimer = 0;
      this.world.apply({ t: 'part_condition', partId: part.id, dirt: part.dirt, rust: part.rust });
    }
  }

  private pourFuel(dt: number, can: FuelCanItem, resolved: Resolved): void {
    const t = resolved.target;
    if (t.kind !== 'slot' || t.slotId !== 'fuel_tank') return;
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
    this.world.apply({ t: 'car_fuel', carId: t.carId, litres: target });
  }

  private interact(resolved: Resolved): void {
    const t = resolved.target;
    const held = this.inventory.held;

    if (t.kind === 'loose-part') {
      const loose = this.world.state.looseParts[t.partId];
      if (!loose) return;
      const item: PartItem = { type: 'part', id: loose.part.id, part: loose.part };
      if (this.inventory.add(item)) this.loose.remove(loose.part.id);
      return;
    }

    if (t.kind === 'loose-item') {
      const loose = this.world.state.looseItems[t.itemId];
      if (!loose) return;
      if (this.inventory.add(loose.item)) this.loose.remove(loose.item.id);
      return;
    }

    if (t.kind === 'slot') {
      const car = this.world.state.cars[t.carId];
      if (!car || !resolved.vehicle) return;
      const slot = body(car.bodyId).slots.find((s) => s.id === t.slotId);
      if (!slot) return;
      const fitted = car.slots[t.slotId];
      if (fitted) this.detach(t.carId, slot.id, fitted, resolved);
      else if (held?.type === 'part') this.attach(t.carId, slot, held.part, resolved);
      return;
    }
  }

  private attach(carId: string, slot: SlotDef, part: PartInstance, resolved: Resolved): void {
    const car = this.world.state.cars[carId];
    if (!car || !resolved.vehicle) return;
    const v = variant(part.variantId);
    if (v.kind !== slot.kind) return;
    if (!v.fits.includes(body(car.bodyId).bodyClass)) return;
    this.world.apply({ t: 'part_attach', carId, slot: slot.id, part });
    this.inventory.remove(part.id);
    resolved.vehicle.rebuildFromSlots();
  }

  private detach(carId: string, slotId: SlotId, part: PartInstance, resolved: Resolved): void {
    // Never pull the seat out from under the driver while seated.
    if (slotId === 'seat_driver' && this.world.state.player.drivingCarId === carId) return;
    if (!resolved.vehicle) return;
    this.world.apply({ t: 'part_detach', carId, slot: slotId });
    const item: PartItem = { type: 'part', id: part.id, part };
    if (this.inventory.add(item)) {
      resolved.vehicle.rebuildFromSlots();
    } else {
      // Can't carry it — bolt it back rather than destroying the part.
      this.world.apply({ t: 'part_attach', carId, slot: slotId, part });
    }
  }

  private targetPart(resolved: Resolved): PartInstance | null {
    const t = resolved.target;
    if (t.kind === 'loose-part') return this.world.state.looseParts[t.partId]?.part ?? null;
    if (t.kind === 'slot') {
      const car = this.world.state.cars[t.carId];
      return car ? (car.slots[t.slotId] ?? null) : null;
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
    if (t.kind === 'slot' && resolved.vehicle) {
      // Fitted part: update by slot name when the vehicle exposes it; otherwise the
      // vehicle's own syncVisuals reflects the state next render frame.
      const mesh = resolved.vehicle.root.getObjectByName(t.slotId);
      if (mesh) setCondition(mesh, part.dirt, part.rust);
    }
  }

  private tryEnter(resolved: Resolved): void {
    if (!resolved.vehicle || !resolved.carId) return;
    if (!resolved.vehicle.stats.drivable) return;
    if (resolved.vehicleDist >= VEHICLE_RANGE) return;
    this.world.apply({ t: 'enter_car', carId: resolved.carId });
    this.player?.setEnabled(false);
  }

  private tryExit(): void {
    const carId = this.world.state.player.drivingCarId;
    if (!carId) return;
    const vehicle = this.getVehicle();
    if (!vehicle) return;
    this.world.apply({ t: 'exit_car' });
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
    const def = body(car.bodyId);
    const door = def.slots.find((s) => s.id === 'door_l');
    if (!door) return null;
    const chassis = vehicle.chassis;
    const t = chassis.translation(this.tScratch);
    chassis.rotation(this.qScratch);

    // World position of the left door, stepped a further 1.1 m outward.
    this.vScratch.set(door.pos[0], door.pos[1], door.pos[2]).applyQuaternion(this.qScratch);
    const doorX = this.vScratch.x + t.x;
    const doorZ = this.vScratch.z + t.z;
    this.vScratch.set(-1, 0, 0).applyQuaternion(this.qScratch);
    const exitX = doorX + this.vScratch.x * 1.1;
    const exitZ = doorZ + this.vScratch.z * 1.1;

    // Ground check so exiting never drops the player inside geometry. Exclude the
    // player's own capsule for the same reason as the aim ray: it is about to be
    // placed at this spot, so it must never count as the ground.
    const ground = this.physics.raycast(
      { x: exitX, y: t.y + 2, z: exitZ },
      { x: 0, y: -1, z: 0 },
      6,
      this.player?.rigidBody,
    );
    const groundY = ground ? ground.point.y : t.y - def.halfExtents[1];
    return { x: exitX, y: groundY, z: exitZ };
  }
}
