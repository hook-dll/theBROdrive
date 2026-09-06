import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { PhysicsWorld } from '../core/physics';
import { WorldOrigin, type RebaseShift } from '../world/origin';
import type { GameWorld } from '../game/state';
import type { PartInstance } from './registry';
import { variant } from './registry';
import type { Item } from '../items/items';
import { itemMass } from '../items/items';
import {
  createItemMesh,
  createPartMesh,
  disposeItemMeshResources,
  FOOTBALL_RADIUS,
  partHalfExtents,
} from '../render/partmesh';
import { setPartCondition } from '../render/materials';
import type { Shoveable } from '../player/player';

/**
 * Every part and item lying loose in the world.
 *
 * Authoritative existence lives in `world.state.looseParts` / `looseItems`; the
 * physics bodies and meshes held here are derived views. `spawn`/`spawnItem`
 * record into state first (via the matching drop delta), then materialise the
 * body + visual. `remove` emits the matching pickup delta and tears the body
 * down, so the collider-handle maps never leak across a long drive.
 */

interface LooseEntry {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  readonly mesh: THREE.Object3D;
  readonly football?: FootballMotion;
}

const FOOTBALL_SAMPLE_STRIDE = 7;
const FOOTBALL_START_SPEED = 0.18;
const FOOTBALL_SETTLED_SPEED = 0.14;
const FOOTBALL_SETTLED_SECONDS = 0.45;
const FOOTBALL_STRONG_KICK_SPEED = 5;

/**
 * Runtime-only rewind tape for one football. Authority still lives in the ordinary
 * loose-item state; the tape is transient because saving an entire 60 Hz trajectory
 * would make one ball larger than the rest of the world state.
 */
class FootballMotion implements Shoveable {
  private readonly path: number[] = [];
  private ready = false;
  private active = false;
  private returning = false;
  private settledFor = 0;
  private kickCooldown = 0;
  private returnCursor = -1;
  private queuedSample = -1;
  private readonly translation = { x: 0, y: 0, z: 0 };
  private readonly rotation = { x: 0, y: 0, z: 0, w: 1 };
  private readonly velocity = { x: 0, y: 0, z: 0 };
  private readonly impulse = { x: 0, y: 0, z: 0 };
  private readonly zero = { x: 0, y: 0, z: 0 };

  constructor(
    private readonly body: RAPIER.RigidBody,
    private readonly collider: RAPIER.Collider,
    private readonly mesh: THREE.Object3D,
  ) {
    this.resetPath();
  }

  shove(dirX: number, dirZ: number, seconds: number, speedMps: number): void {
    if (this.returning || this.kickCooldown > 0 || seconds <= 0) return;
    const length = Math.hypot(dirX, dirZ);
    if (length < 1e-4) return;
    if (!this.ready) {
      this.ready = true;
      this.resetPath();
    }

    const nx = dirX / length;
    const nz = dirZ / length;
    const strong = speedMps >= FOOTBALL_STRONG_KICK_SPEED;
    const targetSpeed = strong
      ? Math.min(12, speedMps * 1.55)
      : Math.min(3, speedMps * 0.72);
    const liftSpeed = strong ? Math.min(4.2, speedMps * 0.58) : 0.24;
    this.body.linvel(this.velocity);
    const along = this.velocity.x * nx + this.velocity.z * nz;
    const delta = Math.max(0, targetSpeed - along);
    const mass = this.body.mass();
    this.impulse.x = nx * delta * mass;
    this.impulse.y = Math.max(0, liftSpeed - this.velocity.y) * mass;
    this.impulse.z = nz * delta * mass;
    this.body.applyImpulse(this.impulse, true);
    this.kickCooldown = strong ? 0.32 : 0.2;
  }

  afterStep(dt: number): void {
    this.kickCooldown = Math.max(0, this.kickCooldown - dt);
    if (this.returning) {
      if (this.returnCursor < 0) {
        this.finishReturn();
      } else {
        this.queueSample(this.returnCursor);
        this.returnCursor -= 1;
      }
      return;
    }

    this.body.linvel(this.velocity);
    const speed = Math.hypot(this.velocity.x, this.velocity.y, this.velocity.z);
    if (!this.ready) {
      // Freshly dropped balls fall and settle before their rewind origin is armed.
      // A horizontal car strike during that settle is still a real kick.
      if (Math.hypot(this.velocity.x, this.velocity.z) > 0.55) {
        this.ready = true;
        this.active = true;
        this.resetPath();
        this.recordCurrent();
      } else {
        this.settledFor = speed < FOOTBALL_SETTLED_SPEED ? this.settledFor + dt : 0;
        if (this.settledFor >= FOOTBALL_SETTLED_SECONDS || this.body.isSleeping()) {
          this.ready = true;
          this.settledFor = 0;
          this.body.setLinvel(this.zero, false);
          this.body.setAngvel(this.zero, false);
          this.body.sleep();
          this.resetPath();
        }
      }
      return;
    }

    if (!this.active) {
      if (speed < FOOTBALL_START_SPEED) return;
      this.active = true;
      this.settledFor = 0;
    }
    this.recordCurrent();
    this.settledFor =
      speed < FOOTBALL_SETTLED_SPEED || this.body.isSleeping()
        ? this.settledFor + dt
        : 0;
    if (this.settledFor >= FOOTBALL_SETTLED_SECONDS) this.startReturn();
  }

  rebase(dx: number, dz: number): void {
    for (let i = 0; i < this.path.length; i += FOOTBALL_SAMPLE_STRIDE) {
      this.path[i] = this.path[i]! - dx;
      this.path[i + 2] = this.path[i + 2]! - dz;
    }
    // PhysicsWorld shifts the current body but cannot see a kinematic body's queued
    // next pose. Re-issue that one target in the new frame as well.
    if (this.returning && this.queuedSample >= 0) this.setQueuedSample(this.queuedSample);
  }

  private startReturn(): void {
    const sampleCount = this.path.length / FOOTBALL_SAMPLE_STRIDE;
    if (sampleCount < 2) {
      this.active = false;
      this.resetPath();
      return;
    }
    this.returning = true;
    this.settledFor = 0;
    this.collider.setSensor(true);
    this.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    this.body.setLinvel(this.zero, false);
    this.body.setAngvel(this.zero, false);
    this.returnCursor = sampleCount - 2;
    this.queueSample(this.returnCursor);
    this.returnCursor -= 1;
  }

  private finishReturn(): void {
    this.returning = false;
    this.active = false;
    this.queuedSample = -1;
    this.collider.setSensor(false);
    this.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    this.body.setLinvel(this.zero, false);
    this.body.setAngvel(this.zero, false);
    const t = this.body.translation(this.translation);
    const r = this.body.rotation(this.rotation);
    this.mesh.position.set(t.x, t.y, t.z);
    this.mesh.quaternion.set(r.x, r.y, r.z, r.w);
    this.body.sleep();
    this.resetPath();
  }

  private resetPath(): void {
    this.path.length = 0;
    this.recordCurrent();
  }

  private recordCurrent(): void {
    const t = this.body.translation(this.translation);
    const r = this.body.rotation(this.rotation);
    this.path.push(t.x, t.y, t.z, r.x, r.y, r.z, r.w);
  }

  private queueSample(index: number): void {
    this.queuedSample = index;
    this.setQueuedSample(index);
  }

  private setQueuedSample(index: number): void {
    const offset = index * FOOTBALL_SAMPLE_STRIDE;
    this.translation.x = this.path[offset]!;
    this.translation.y = this.path[offset + 1]!;
    this.translation.z = this.path[offset + 2]!;
    this.rotation.x = this.path[offset + 3]!;
    this.rotation.y = this.path[offset + 4]!;
    this.rotation.z = this.path[offset + 5]!;
    this.rotation.w = this.path[offset + 6]!;
    this.body.setNextKinematicTranslation(this.translation);
    this.body.setNextKinematicRotation(this.rotation);
  }
}

export class LoosePartField {
  private readonly parts = new Map<string, LooseEntry>();
  private readonly items = new Map<string, LooseEntry>();
  private readonly colliderToPartId = new Map<number, string>();
  private readonly colliderToItemId = new Map<number, string>();
  private readonly footballByBody = new Map<number, FootballMotion>();
  private readonly unregisterOrigin: () => void;
  private hasActiveCenter = false;
  private activeX = 0;
  private activeZ = 0;
  private loadRadiusSq = 0;

  constructor(
    private readonly physics: PhysicsWorld,
    private readonly world: GameWorld,
    private readonly scene: THREE.Scene,
    private readonly origin: WorldOrigin,
  ) {
    this.unregisterOrigin = this.origin.register(this);
  }

  /** Number of state entries currently represented by a body, collider, and mesh. */
  get liveCount(): number {
    return this.parts.size + this.items.size;
  }

  /**
   * Updates the spatially active derived view. State always remains absolute and
   * complete; only entries within the load radius gain a relative runtime, and an
   * already-live entry remains until it crosses the wider unload radius.
   */
  updateActive(absoluteX: number, absoluteZ: number, loadRadius: number, unloadRadius: number): void {
    if (
      !Number.isFinite(loadRadius) ||
      !Number.isFinite(unloadRadius) ||
      loadRadius < 0 ||
      unloadRadius <= loadRadius
    ) {
      throw new RangeError('Loose-part load radius must be non-negative and smaller than unload radius.');
    }

    this.hasActiveCenter = true;
    this.activeX = absoluteX;
    this.activeZ = absoluteZ;
    this.loadRadiusSq = loadRadius * loadRadius;

    const unloadRadiusSq = unloadRadius * unloadRadius;
    for (const [id, entry] of this.parts) {
      const translation = entry.body.translation(this.tScratch);
      const dx = translation.x + this.origin.x - absoluteX;
      const dz = translation.z + this.origin.z - absoluteZ;
      if (dx * dx + dz * dz <= unloadRadiusSq) continue;
      const loose = this.world.state.looseParts[id];
      if (loose) this.flushPose(entry, loose);
      this.disposeEntry(entry);
      this.parts.delete(id);
    }
    for (const [id, entry] of this.items) {
      const translation = entry.body.translation(this.tScratch);
      const dx = translation.x + this.origin.x - absoluteX;
      const dz = translation.z + this.origin.z - absoluteZ;
      if (dx * dx + dz * dz <= unloadRadiusSq) continue;
      const loose = this.world.state.looseItems[id];
      if (loose) this.flushPose(entry, loose);
      this.disposeEntry(entry);
      this.items.delete(id);
    }

    this.materialiseNearbyFromState();
  }

  /**
   * Records a part into state and materialises its body + visual only when it is in
   * the active field. `x, y, z` are ABSOLUTE world coordinates.
   */
  spawn(part: PartInstance, x: number, y: number, z: number): void {
    this.world.apply({ t: 'part_drop', part, x, y, z });
    if (!this.parts.has(part.id) && this.isInsideLoadRadius(x, z)) {
      this.materialisePart(part, x, y, z);
    }
  }

  /**
   * Records a non-part pickup (tool, fuel can, weapon, ammo, quarry) and
   * materialises it when it is in the active field. `x, y, z` are ABSOLUTE.
   */
  spawnItem(item: Item, x: number, y: number, z: number): void {
    this.world.apply({ t: 'item_drop', item, x, y, z });
    if (!this.items.has(item.id) && this.isInsideLoadRadius(x, z)) {
      this.materialiseItem(item, x, y, z);
    }
  }

  /** Removes either a loose part or a loose item, whether or not it is currently live. */
  remove(id: string): void {
    const part = this.parts.get(id);
    if (part || this.world.state.looseParts[id]) {
      this.world.apply({ t: 'part_pickup', partId: id });
      if (part) {
        this.disposeEntry(part);
        this.parts.delete(id);
      }
      return;
    }

    const item = this.items.get(id);
    if (item || this.world.state.looseItems[id]) {
      this.world.apply({ t: 'item_pickup', itemId: id });
      if (item) {
        this.disposeEntry(item);
        this.items.delete(id);
      }
    }
  }

  partIdForCollider(colliderHandle: number): string | null {
    return this.colliderToPartId.get(colliderHandle) ?? null;
  }

  itemIdForCollider(colliderHandle: number): string | null {
    return this.colliderToItemId.get(colliderHandle) ?? null;
  }

  /** Custom foot-contact response for a football; other loose props use the generic nudge. */
  shoveableForBody(bodyHandle: number): Shoveable | null {
    return this.footballByBody.get(bodyHandle) ?? null;
  }

  /** Mesh for a loose part, so interaction can scrub its condition in place. */
  meshFor(partId: string): THREE.Object3D | null {
    return this.parts.get(partId)?.mesh ?? null;
  }

  /**
   * Rebuilds the derived view from authoritative state. Before an active center is
   * supplied, state remains intentionally dormant rather than materialising a save.
   */
  restoreFromState(): void {
    this.disposeAllRuntime(true);
    this.materialiseNearbyFromState();
  }

  /** Flushes every live loose pose into save authority without unloading its runtime. */
  flushToState(): void {
    for (const [id, entry] of this.parts) {
      const loose = this.world.state.looseParts[id];
      if (loose) this.flushPose(entry, loose);
    }
    for (const [id, entry] of this.items) {
      const loose = this.world.state.looseItems[id];
      if (loose) this.flushPose(entry, loose);
    }
  }
  /**
   * The physics world rebases every body after origin listeners run. Shift meshes
   * here too, including sleeping bodies that `syncVisuals` deliberately does not read.
   */
  rebase(shift: RebaseShift): void {
    for (const entry of this.parts.values()) {
      entry.mesh.position.x -= shift.dx;
      entry.mesh.position.z -= shift.dz;
    }
    for (const entry of this.items.values()) {
      entry.mesh.position.x -= shift.dx;
      entry.mesh.position.z -= shift.dz;
      entry.football?.rebase(shift.dx, shift.dz);
    }
  }

  /** Advances football rewind tapes after Rapier has produced this tick's pose. */
  fixedUpdate(dt: number): void {
    for (const football of this.footballByBody.values()) football.afterStep(dt);
  }

  /** Copies settled bodies' transforms into their meshes, once per render frame. */
  syncVisuals(): void {
    for (const entry of this.parts.values()) this.syncEntry(entry);
    for (const entry of this.items.values()) this.syncEntry(entry);
  }

  dispose(): void {
    this.unregisterOrigin();
    this.disposeAllRuntime(true);
  }
  private readonly tScratch = { x: 0, y: 0, z: 0 };
  private readonly rScratch = { x: 0, y: 0, z: 0, w: 1 };

  private isInsideLoadRadius(x: number, z: number): boolean {
    if (!this.hasActiveCenter) return false;
    const dx = x - this.activeX;
    const dz = z - this.activeZ;
    return dx * dx + dz * dz <= this.loadRadiusSq;
  }

  private materialiseNearbyFromState(): void {
    if (!this.hasActiveCenter) return;
    for (const id in this.world.state.looseParts) {
      const loose = this.world.state.looseParts[id]!;
      if (!this.parts.has(id) && this.isInsideLoadRadius(loose.x, loose.z)) {
        this.materialisePart(loose.part, loose.x, loose.y, loose.z);
      }
    }
    for (const id in this.world.state.looseItems) {
      const loose = this.world.state.looseItems[id]!;
      if (!this.items.has(id) && this.isInsideLoadRadius(loose.x, loose.z)) {
        this.materialiseItem(loose.item, loose.x, loose.y, loose.z);
      }
    }
  }

  private flushPose(entry: LooseEntry, loose: { x: number; y: number; z: number }): void {
    const translation = entry.body.translation(this.tScratch);
    loose.x = translation.x + this.origin.x;
    loose.y = translation.y;
    loose.z = translation.z + this.origin.z;
  }

  private disposeAllRuntime(flushState = false): void {
    for (const [id, entry] of this.parts) {
      if (flushState) {
        const loose = this.world.state.looseParts[id];
        if (loose) this.flushPose(entry, loose);
      }
      this.disposeEntry(entry);
    }
    this.parts.clear();
    this.colliderToPartId.clear();
    for (const [id, entry] of this.items) {
      if (flushState) {
        const loose = this.world.state.looseItems[id];
        if (loose) this.flushPose(entry, loose);
      }
      this.disposeEntry(entry);
    }
    this.items.clear();
    this.colliderToItemId.clear();
    this.footballByBody.clear();
  }

  private syncEntry(entry: LooseEntry): void {
    // Sleeping bodies never move; skipping them is what makes hundreds of settled
    // parts free. Reading isSleeping() does not wake the body.
    if (entry.body.isSleeping()) return;
    const t = entry.body.translation(this.tScratch);
    const r = entry.body.rotation(this.rScratch);
    entry.mesh.position.set(t.x, t.y, t.z);
    entry.mesh.quaternion.set(r.x, r.y, r.z, r.w);
  }

  private disposeEntry(entry: LooseEntry): void {
    disposeItemMeshResources(entry.mesh);
    this.footballByBody.delete(entry.body.handle);
    this.scene.remove(entry.mesh);
    // removeBody forgets the surface and every collider attached to the body.
    this.physics.removeBody(entry.body);
    // Handles are unique, so deleting from both maps is safe and cheap.
    this.colliderToPartId.delete(entry.collider.handle);
    this.colliderToItemId.delete(entry.collider.handle);
  }

  private materialisePart(part: PartInstance, x: number, y: number, z: number): void {
    const half = partHalfExtents(part.variantId);
    // x/z are absolute; Rapier and the scene graph hold positions relative to the
    // floating origin, so subtract it once before the body AND the mesh.
    const rx = x - this.origin.x;
    const rz = z - this.origin.z;
    const { body, collider } = this.physics.addDynamicBox(
      { x: half.x, y: half.y, z: half.z },
      { x: rx, y, z: rz },
      variant(part.variantId).mass,
    );
    const mesh = createPartMesh(part.variantId);
    setPartCondition(mesh, part);
    mesh.position.set(rx, y, rz);
    this.scene.add(mesh);
    this.parts.set(part.id, { body, collider, mesh });
    this.colliderToPartId.set(collider.handle, part.id);
    // Settled junk costs nothing: spawn asleep. Contact wakes it via normal Rapier
    // integration (a car, a brush, a foot).
    body.sleep();
  }

  private materialiseItem(item: Item, x: number, y: number, z: number): void {
    const mesh = createItemMesh(item);
    // x/z are absolute; subtract the origin once before the body AND the mesh.
    const rx = x - this.origin.x;
    const rz = z - this.origin.z;

    let body: RAPIER.RigidBody;
    let collider: RAPIER.Collider;
    let football: FootballMotion | undefined;
    if (item.type === 'football') {
      body = this.physics.world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(rx, y, rz)
          .setLinearDamping(0.08)
          .setAngularDamping(0.12)
          .setCcdEnabled(true),
      );
      collider = this.physics.world.createCollider(
        RAPIER.ColliderDesc.ball(FOOTBALL_RADIUS)
          .setMass(itemMass(item))
          .setFriction(0.58)
          .setRestitution(0.72)
          .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max),
        body,
      );
      football = new FootballMotion(body, collider, mesh);
      this.footballByBody.set(body.handle, football);
    } else {
      // Other items have no partHalfExtents; derive their box from the visual bounds.
      const box = new THREE.Box3().setFromObject(mesh);
      const size = box.getSize(new THREE.Vector3());
      const half = {
        x: Math.max(size.x * 0.5, 0.04),
        y: Math.max(size.y * 0.5, 0.04),
        z: Math.max(size.z * 0.5, 0.04),
      };
      ({ body, collider } = this.physics.addDynamicBox(half, { x: rx, y, z: rz }, itemMass(item)));
      body.sleep();
    }

    mesh.position.set(rx, y, rz);
    this.scene.add(mesh);
    const entry: LooseEntry = football
      ? { body, collider, mesh, football }
      : { body, collider, mesh };
    this.items.set(item.id, entry);
    this.colliderToItemId.set(collider.handle, item.id);
  }
}
