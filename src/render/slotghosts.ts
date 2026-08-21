/**
 * Ghost previews and empty-slot hints for the car the player is assembling.
 *
 * Empty sockets have no collider and no visible placeholder, so a player cannot
 * tell where a part goes. `SlotGhosts` draws two kinds of translucent overlay,
 * both parented under the car's own scene group so they inherit its transform
 * for free:
 *
 *  - When a part that fits somewhere is held, a translucent copy of that part
 *    floats at every compatible empty slot; the slot currently under the
 *    crosshair is brighter and pulses gently.
 *  - Otherwise, a small ring marks every empty essential slot, so the holes are
 *    discoverable even before the player has picked anything up.
 *
 * Meshes are reused across frames: the set is rebuilt only when the held part,
 * the empty-slot set or the vehicle changes, and the pulse is a material-opacity
 * tweak, never a rebuild. Ghost geometry comes from partmesh's shared cache and
 * is never disposed here; only this module's own materials and geometry are.
 */
import * as THREE from 'three';
import { variant } from '../parts/registry';
import type { BodyDef, PartInstance } from '../parts/registry';
import { createPartMesh } from './partmesh';
import type { Vehicle } from '../vehicle/vehicle';

type SlotMap = ReadonlyMap<string, PartInstance | null> | Record<string, PartInstance>;

type Mode = 'ghost' | 'marker' | 'none';

/** Drawn after opaque geometry and most transparents, so previews show through. */
const RENDER_ORDER = 900;

const GHOST_COLOR = 0x6fd4ff;
const GHOST_OPACITY = 0.32;
const TARGET_COLOR = 0xffffff;
const TARGET_BASE_OPACITY = 0.45;
const TARGET_PULSE_AMPLITUDE = 0.3;
/** Radians/second; a gentle ~0.8 Hz pulse. */
const PULSE_RATE = 5;

const MARKER_COLOR = 0xffd27a;
const MARKER_OPACITY = 0.26;
const MARKER_RADIUS = 0.16;
const MARKER_TUBE = 0.02;
/** How far the hint ring floats above its slot. */
const MARKER_LIFT = 0.12;

function makeGhostMaterial(color: number, opacity: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

function slotPart(slots: SlotMap, id: string): PartInstance | null {
  if (slots instanceof Map) return slots.get(id) ?? null;
  const value = (slots as Record<string, PartInstance | undefined>)[id];
  return value ?? null;
}

export class SlotGhosts {
  /** Shared no-op so re-styling meshes never allocates a closure. */
  private static readonly NO_RAYCAST = (): void => {};

  private readonly scene: THREE.Scene;
  private readonly root = new THREE.Group();

  private vehicle: Vehicle | null = null;

  private ghostMaterial!: THREE.MeshBasicMaterial;
  private targetMaterial!: THREE.MeshBasicMaterial;
  private markerMaterial!: THREE.MeshBasicMaterial;
  private markerGeometry!: THREE.TorusGeometry;

  private mode: Mode = 'none';
  private setMask = 0;
  private heldVariantId: string | null = null;
  private targetedSlotId: string | null = null;
  private pulseTime = 0;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.root.name = 'slot-ghosts';
    this.root.visible = false;
    this.createResources();
  }

  update(
    vehicle: Vehicle | null,
    def: BodyDef,
    slots: SlotMap,
    heldVariantId: string | null,
    targetedSlotId: string | null,
    dt: number,
  ): void {
    this.pulseTime += dt;

    if (!vehicle) {
      this.root.visible = false;
      this.clearGroup();
      if (this.root.parent) this.root.parent.remove(this.root);
      this.vehicle = null;
      this.mode = 'none';
      this.setMask = 0;
      this.heldVariantId = null;
      this.targetedSlotId = null;
      return;
    }

    // A vehicle rebuild (attach/detach) tears down every child of `root`,
    // disposing our materials as it goes. Detect the sweep and recreate.
    const attached = this.root.parent === vehicle.root;
    if (this.vehicle !== vehicle || !attached) {
      this.vehicle = vehicle;
      this.clearGroup();
      if (!attached) {
        this.disposeOwnedResources();
        this.createResources();
        vehicle.root.add(this.root);
      }
      this.mode = 'none';
      this.setMask = 0;
      this.heldVariantId = null;
      this.targetedSlotId = null;
    }

    const heldVariant = heldVariantId ? variant(heldVariantId) : null;
    let ghostMask = 0;
    let markerMask = 0;
    for (let i = 0; i < def.slots.length; i++) {
      const slot = def.slots[i];
      if (slotPart(slots, slot.id) !== null) continue;
      if (heldVariant && slot.kind === heldVariant.kind && heldVariant.fits.includes(def.bodyClass)) {
        ghostMask |= 1 << i;
      }
      if (slot.essential) markerMask |= 1 << i;
    }
    const mode: Mode = ghostMask !== 0 ? 'ghost' : markerMask !== 0 ? 'marker' : 'none';
    const mask = mode === 'ghost' ? ghostMask : markerMask;

    const rebuilt = this.mode !== mode || this.setMask !== mask || this.heldVariantId !== heldVariantId;
    if (rebuilt) {
      this.mode = mode;
      this.setMask = mask;
      this.heldVariantId = heldVariantId;
      this.rebuild(def, heldVariantId, mode, mask);
    }

    const retargeted = this.targetedSlotId !== targetedSlotId;
    this.targetedSlotId = targetedSlotId;
    if (this.mode === 'ghost' && (rebuilt || retargeted)) {
      this.applyTargetHighlight(targetedSlotId);
    }

    this.animateTarget();
    this.root.visible = this.mode !== 'none';
  }

  dispose(): void {
    this.clearGroup();
    if (this.root.parent) this.root.parent.remove(this.root);
    this.scene.remove(this.root);
    this.disposeOwnedResources();
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private rebuild(def: BodyDef, heldVariantId: string | null, mode: Mode, mask: number): void {
    this.clearGroup();

    if (mode === 'ghost') {
      for (let i = 0; i < def.slots.length; i++) {
        if ((mask & (1 << i)) === 0) continue;
        const slot = def.slots[i];
        const mesh = createPartMesh(heldVariantId!);
        mesh.position.set(slot.pos[0], slot.pos[1], slot.pos[2]);
        if (slot.yaw) mesh.rotation.y = slot.yaw;
        mesh.name = `ghost:${slot.id}`;
        mesh.userData.slotId = slot.id;
        this.root.add(mesh);
      }
      // Materials, shadow/raycast flags and render order are applied by
      // applyTargetHighlight immediately after the rebuild.
    } else if (mode === 'marker') {
      for (let i = 0; i < def.slots.length; i++) {
        if ((mask & (1 << i)) === 0) continue;
        const slot = def.slots[i];
        const marker = new THREE.Mesh(this.markerGeometry, this.markerMaterial);
        marker.position.set(slot.pos[0], slot.pos[1] + MARKER_LIFT, slot.pos[2]);
        if (slot.yaw) marker.rotation.y = slot.yaw;
        marker.name = `ghost-marker:${slot.id}`;
        this.styleGroup(marker, this.markerMaterial);
        this.root.add(marker);
      }
    }
  }

  private applyTargetHighlight(targetedSlotId: string | null): void {
    for (const child of this.root.children) {
      if (child.userData.slotId === undefined) continue;
      this.styleGroup(child, child.userData.slotId === targetedSlotId ? this.targetMaterial : this.ghostMaterial);
    }
  }

  private styleGroup(root: THREE.Object3D, material: THREE.Material): void {
    root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh !== true) return;
      mesh.material = material;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.renderOrder = RENDER_ORDER;
      mesh.raycast = SlotGhosts.NO_RAYCAST;
    });
  }

  private animateTarget(): void {
    const pulse = 0.5 + 0.5 * Math.sin(this.pulseTime * PULSE_RATE);
    this.targetMaterial.opacity = TARGET_BASE_OPACITY + TARGET_PULSE_AMPLITUDE * pulse;
  }

  private clearGroup(): void {
    for (const child of this.root.children.slice()) {
      this.root.remove(child);
    }
  }

  private createResources(): void {
    this.ghostMaterial = makeGhostMaterial(GHOST_COLOR, GHOST_OPACITY);
    this.targetMaterial = makeGhostMaterial(TARGET_COLOR, TARGET_BASE_OPACITY);
    this.markerMaterial = makeGhostMaterial(MARKER_COLOR, MARKER_OPACITY);
    this.markerGeometry = new THREE.TorusGeometry(MARKER_RADIUS, MARKER_TUBE, 8, 32);
    this.markerGeometry.rotateX(-Math.PI / 2);
  }

  private disposeOwnedResources(): void {
    this.ghostMaterial?.dispose();
    this.targetMaterial?.dispose();
    this.markerMaterial?.dispose();
    this.markerGeometry?.dispose();
  }
}
