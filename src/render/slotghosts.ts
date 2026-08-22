/**
 * Ghost previews and empty-anchor hints for the car the player is decorating.
 *
 * A bare anchor is invisible until something is mounted on it, so a player cannot
 * tell where a gizmo goes. `AnchorGhosts` draws two kinds of translucent overlay,
 * both parented under the car's own scene group so they inherit its transform for
 * free:
 *
 *  - When a part is held, a translucent copy of that part floats at every empty
 *    anchor; the anchor currently under the crosshair is brighter and pulses
 *    gently.
 *  - Otherwise, a small ring marks every empty anchor, so the mount points are
 *    discoverable even before the player has picked anything up.
 *
 * Meshes are reused across frames: the set is rebuilt only when the held part,
 * the empty-anchor set or the vehicle changes, and the pulse is a material-opacity
 * tweak, never a rebuild. Ghost geometry comes from partmesh's shared cache and is
 * never disposed here; only this module's own materials and geometry are.
 */
import * as THREE from 'three';
import type { PartInstance } from '../parts/registry';
import type { GizmoAnchor } from '../render/carmodel';
import { createPartMesh } from './partmesh';
import type { Vehicle } from '../vehicle/vehicle';

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
/** How far the hint ring floats above its anchor. */
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

export class AnchorGhosts {
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
  private targetedAnchorId: string | null = null;
  private pulseTime = 0;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.root.name = 'anchor-ghosts';
    this.root.visible = false;
    this.createResources();
  }

  update(
    vehicle: Vehicle | null,
    anchors: readonly GizmoAnchor[],
    gizmos: Readonly<Record<string, PartInstance>>,
    heldVariantId: string | null,
    targetedAnchorId: string | null,
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
      this.targetedAnchorId = null;
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
      this.targetedAnchorId = null;
    }

    // Gizmos are junk, not fitted parts: a held part previews at every empty
    // anchor, and empty anchors are marked whenever nothing is held.
    const heldPart = heldVariantId !== null;
    let ghostMask = 0;
    let markerMask = 0;
    for (let i = 0; i < anchors.length; i++) {
      const anchor = anchors[i];
      if (gizmos[anchor.id] !== undefined) continue;
      if (heldPart) ghostMask |= 1 << i;
      else markerMask |= 1 << i;
    }
    const mode: Mode = ghostMask !== 0 ? 'ghost' : markerMask !== 0 ? 'marker' : 'none';
    const mask = mode === 'ghost' ? ghostMask : markerMask;

    const rebuilt = this.mode !== mode || this.setMask !== mask || this.heldVariantId !== heldVariantId;
    if (rebuilt) {
      this.mode = mode;
      this.setMask = mask;
      this.heldVariantId = heldVariantId;
      this.rebuild(anchors, heldVariantId, mode, mask);
    }

    const retargeted = this.targetedAnchorId !== targetedAnchorId;
    this.targetedAnchorId = targetedAnchorId;
    if (this.mode === 'ghost' && (rebuilt || retargeted)) {
      this.applyTargetHighlight(targetedAnchorId);
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

  private rebuild(anchors: readonly GizmoAnchor[], heldVariantId: string | null, mode: Mode, mask: number): void {
    this.clearGroup();

    if (mode === 'ghost') {
      for (let i = 0; i < anchors.length; i++) {
        if ((mask & (1 << i)) === 0) continue;
        const anchor = anchors[i];
        const mesh = createPartMesh(heldVariantId!);
        mesh.position.set(anchor.pos[0], anchor.pos[1], anchor.pos[2]);
        if (anchor.yaw) mesh.rotation.y = anchor.yaw;
        mesh.name = `ghost:${anchor.id}`;
        mesh.userData.anchorId = anchor.id;
        this.root.add(mesh);
      }
      // Materials, shadow/raycast flags and render order are applied by
      // applyTargetHighlight immediately after the rebuild.
    } else if (mode === 'marker') {
      for (let i = 0; i < anchors.length; i++) {
        if ((mask & (1 << i)) === 0) continue;
        const anchor = anchors[i];
        const marker = new THREE.Mesh(this.markerGeometry, this.markerMaterial);
        marker.position.set(anchor.pos[0], anchor.pos[1] + MARKER_LIFT, anchor.pos[2]);
        if (anchor.yaw) marker.rotation.y = anchor.yaw;
        marker.name = `ghost-marker:${anchor.id}`;
        this.styleGroup(marker, this.markerMaterial);
        this.root.add(marker);
      }
    }
  }

  private applyTargetHighlight(targetedAnchorId: string | null): void {
    for (const child of this.root.children) {
      if (child.userData.anchorId === undefined) continue;
      this.styleGroup(child, child.userData.anchorId === targetedAnchorId ? this.targetMaterial : this.ghostMaterial);
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
      mesh.raycast = AnchorGhosts.NO_RAYCAST;
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
