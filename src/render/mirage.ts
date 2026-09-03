import * as THREE from 'three';
import { hash01 } from '../core/rng';
import type { WorldOrigin } from '../world/origin';
import type { Road } from '../world/road';
import type { Terrain } from '../world/terrain';

/**
 * A seeded impossible structure that exists only in the middle distance.
 *
 * It is deliberately not world content: there is no collider, reward, marker, or
 * close model. The player can see it for roughly half a minute, but it dissolves
 * before the road can bring them near enough to inspect it. One seeded encounter is
 * placed early enough to make the experiment testable; later candidates are sparse.
 *
 * The night sky is inviolable. Structures are suppressed outside daylight rather
 * than becoming silhouettes across the stars, and this system never reads or changes
 * Sky, the radio, or either audio bus.
 */

const SLOT_SPACING = 12_000;
const SLOT_CHANCE = 0.28;
const FIRST_ENCOUNTER_S = 2_600;

/** Longitudinal visibility window ahead of the player, in road metres. */
const APPEAR_AHEAD = 1_500;
const FULLY_VISIBLE_AHEAD = 1_150;
const DISSOLVE_START_AHEAD = 700;
const GONE_AHEAD = 500;

/** Far enough off-road to remain unreachable before it disappears. */
const LATERAL_MIN = 420;
const LATERAL_RANGE = 180;

/** One box primitive becomes an authored silhouette of at most this many pieces. */
const MAX_PIECES = 12;

const SALT_CHANCE = 0x4d17;
const SALT_POSITION = 0x6a21;
const SALT_SIDE = 0x83c9;
const SALT_LATERAL = 0xa14f;
const SALT_FORM = 0xc237;
const SALT_SHAPE = 0xd46b;
const SALT_COLOUR = 0xe581;

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * One geometry and one material form every structure. A new candidate rewrites at
 * most twelve instance matrices; the per-frame path changes only a transform and
 * opacity, allocates nothing, and performs no terrain work.
 */
export class DistantMirage {
  private readonly material: THREE.MeshStandardMaterial;
  private readonly mesh: THREE.InstancedMesh;
  private readonly matrix = new THREE.Matrix4();
  private readonly quaternion = new THREE.Quaternion();
  private readonly position = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly rollAxis = new THREE.Vector3(0, 0, 1);
  private readonly columnHeights = new Float32Array(6);
  private activeSlot = Number.MIN_SAFE_INTEGER;
  private eventS = -Infinity;
  private eventX = 0;
  private eventY = 0;
  private eventZ = 0;

  constructor(
    scene: THREE.Scene,
    private readonly road: Road,
    private readonly terrain: Terrain,
    private readonly seed: number,
    private readonly origin: WorldOrigin,
  ) {
    this.material = new THREE.MeshStandardMaterial({
      color: 0x6d4b3c,
      roughness: 1,
      metalness: 0,
      flatShading: true,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      fog: true,
    });
    this.mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      this.material,
      MAX_PIECES,
    );
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  /** Updates presentation only. `dayFactor` comes from Sky but is never fed back into it. */
  update(playerS: number, dayFactor: number): void {
    const slot = this.findVisibleSlot(playerS);
    if (slot === null || dayFactor <= 0.12) {
      this.mesh.visible = false;
      return;
    }
    if (slot !== this.activeSlot) this.place(slot);

    const ahead = this.eventS - playerS;
    const arrivalFade = smoothstep(GONE_AHEAD, DISSOLVE_START_AHEAD, ahead);
    const distanceFade = 1 - smoothstep(FULLY_VISIBLE_AHEAD, APPEAR_AHEAD, ahead);
    const daylightFade = smoothstep(0.12, 0.42, dayFactor);
    const opacity = arrivalFade * distanceFade * daylightFade;
    if (opacity <= 0.002) {
      this.mesh.visible = false;
      return;
    }

    this.mesh.visible = true;
    this.material.opacity = opacity * 0.82;
    // Scene objects are origin-relative. Recompute from the retained f64 absolute
    // position so a rebase cannot move the mirage or perturb its terrain sample.
    this.mesh.position.set(this.eventX - this.origin.x, this.eventY, this.eventZ - this.origin.z);
  }

  private findVisibleSlot(playerS: number): number | null {
    // At most two slots can overlap the 1.5 km visibility window at a 12 km cadence.
    // Check the current slot and the next one because the seeded offset may put either
    // candidate ahead of the player.
    const base = Math.max(0, Math.floor(playerS / SLOT_SPACING));
    for (let slot = base; slot <= base + 1; slot++) {
      if (!this.slotExists(slot)) continue;
      const s = this.slotS(slot);
      const ahead = s - playerS;
      if (ahead >= GONE_AHEAD && ahead <= APPEAR_AHEAD) return slot;
    }
    return null;
  }

  private slotExists(slot: number): boolean {
    return slot === 0 || hash01(this.seed, slot, SALT_CHANCE) < SLOT_CHANCE;
  }

  private slotS(slot: number): number {
    if (slot === 0) return FIRST_ENCOUNTER_S;
    const inset = 2_000 + hash01(this.seed, slot, SALT_POSITION) * (SLOT_SPACING - 4_000);
    return slot * SLOT_SPACING + inset;
  }

  private place(slot: number): void {
    this.activeSlot = slot;
    this.eventS = this.slotS(slot);
    const side = hash01(this.seed, slot, SALT_SIDE) < 0.5 ? -1 : 1;
    const lateral = side * (LATERAL_MIN + hash01(this.seed, slot, SALT_LATERAL) * LATERAL_RANGE);
    const point = this.road.offsetPoint(this.eventS, lateral);
    this.eventX = point.x;
    this.eventZ = point.z;
    this.eventY = this.terrain.heightAt(point.x, point.z, this.eventS);

    // Face the place from which the structure becomes clear, not the road beside it.
    // Open forms therefore read as deliberate silhouettes instead of unrelated bars.
    const approach = this.road.sampleAt(this.eventS - FULLY_VISIBLE_AHEAD);
    this.mesh.rotation.y = Math.atan2(approach.x - point.x, approach.z - point.z);
    this.buildStructure(slot);
  }

  /**
   * Generates one of four coherent construction grammars, then varies every dimension.
   * Pure seed + slot means an encounter survives reloads exactly, but two locations
   * almost never share a silhouette.
   */
  private buildStructure(slot: number): void {
    const width = 26 + this.shapeRandom(slot, 0) * 38;
    const height = 38 + this.shapeRandom(slot, 1) * 50;
    const depth = 4 + this.shapeRandom(slot, 2) * 6;
    const pillar = 3.5 + this.shapeRandom(slot, 3) * 4;
    const beam = 4 + this.shapeRandom(slot, 4) * 5;
    const family = Math.floor(hash01(this.seed, slot, SALT_FORM) * 4);
    let count = 0;

    if (family === 0) {
      // A recognisable gate, made uneasy by unequal supports and an off-level crown.
      const span = (width - pillar) * 0.5;
      const leftHeight = height * (0.82 + this.shapeRandom(slot, 5) * 0.18);
      const rightHeight = height * (0.82 + this.shapeRandom(slot, 6) * 0.18);
      count = this.piece(count, -span, leftHeight * 0.5, 0, pillar, leftHeight, depth, (this.shapeRandom(slot, 7) - 0.5) * 0.06);
      count = this.piece(count, span, rightHeight * 0.5, 0, pillar, rightHeight, depth, (this.shapeRandom(slot, 8) - 0.5) * 0.06);
      const crownY = Math.min(leftHeight, rightHeight) - beam * 0.45;
      count = this.piece(count, 0, crownY, 0, width, beam, depth, (this.shapeRandom(slot, 9) - 0.5) * 0.1);
      if (this.shapeRandom(slot, 10) > 0.52) {
        const finHeight = height * (0.18 + this.shapeRandom(slot, 11) * 0.2);
        count = this.piece(count, (this.shapeRandom(slot, 12) - 0.5) * width * 0.3, crownY + beam * 0.5 + finHeight * 0.5, 0, pillar * 0.65, finHeight, depth * 0.8, (this.shapeRandom(slot, 13) - 0.5) * 0.12);
      }
    } else if (family === 1) {
      // Two openings sharing a central pier: temple, viaduct, or machine at this range.
      const span = width * 0.46;
      const centreHeight = height * (0.9 + this.shapeRandom(slot, 5) * 0.1);
      const sideHeight = height * (0.72 + this.shapeRandom(slot, 6) * 0.2);
      count = this.piece(count, -span, sideHeight * 0.5, 0, pillar, sideHeight, depth, (this.shapeRandom(slot, 7) - 0.5) * 0.05);
      count = this.piece(count, 0, centreHeight * 0.5, 0, pillar * 1.15, centreHeight, depth, (this.shapeRandom(slot, 8) - 0.5) * 0.04);
      count = this.piece(count, span, sideHeight * 0.5, 0, pillar, sideHeight, depth, (this.shapeRandom(slot, 9) - 0.5) * 0.05);
      const halfBeam = span + pillar;
      count = this.piece(count, -span * 0.5, sideHeight - beam * 0.45, 0, halfBeam, beam, depth, (this.shapeRandom(slot, 10) - 0.5) * 0.08);
      count = this.piece(count, span * 0.5, sideHeight - beam * 0.45, 0, halfBeam, beam, depth, (this.shapeRandom(slot, 11) - 0.5) * 0.08);
    } else if (family === 2) {
      // A broken colonnade: enough repetition to imply extent, enough gaps to deny it.
      const columns = 4 + Math.floor(this.shapeRandom(slot, 5) * 3);
      const gap = width / (columns - 1);
      const heights = this.columnHeights;
      for (let i = 0; i < columns; i++) {
        const columnHeight = height * (0.58 + this.shapeRandom(slot, 10 + i) * 0.42);
        heights[i] = columnHeight;
        count = this.piece(count, -width * 0.5 + i * gap, columnHeight * 0.5, 0, pillar * (0.75 + this.shapeRandom(slot, 20 + i) * 0.5), columnHeight, depth, (this.shapeRandom(slot, 30 + i) - 0.5) * 0.08);
      }
      for (let i = 0; i < columns - 1 && count < MAX_PIECES; i++) {
        if (this.shapeRandom(slot, 40 + i) < 0.3) continue;
        const y = Math.min(heights[i]!, heights[i + 1]!) - beam * 0.45;
        count = this.piece(count, -width * 0.5 + (i + 0.5) * gap, y, 0, gap + pillar, beam * (0.7 + this.shapeRandom(slot, 50 + i) * 0.5), depth, (this.shapeRandom(slot, 60 + i) - 0.5) * 0.08);
      }
    } else {
      // An implausibly balanced sign: long mass above supports too slight to explain it.
      const span = width * (0.22 + this.shapeRandom(slot, 5) * 0.15);
      const supportWidth = pillar * (0.45 + this.shapeRandom(slot, 6) * 0.25);
      const supportHeight = height * (0.72 + this.shapeRandom(slot, 7) * 0.22);
      const lean = 0.08 + this.shapeRandom(slot, 8) * 0.12;
      count = this.piece(count, -span, supportHeight * 0.5, 0, supportWidth, supportHeight, depth * 0.65, lean);
      count = this.piece(count, span, supportHeight * 0.5, 0, supportWidth, supportHeight, depth * 0.65, -lean);
      count = this.piece(count, (this.shapeRandom(slot, 9) - 0.5) * width * 0.22, supportHeight, 0, width * (1.05 + this.shapeRandom(slot, 10) * 0.35), beam * (1.1 + this.shapeRandom(slot, 11)), depth, (this.shapeRandom(slot, 12) - 0.5) * 0.13);
      if (this.shapeRandom(slot, 13) > 0.4) {
        const hanging = height * (0.12 + this.shapeRandom(slot, 14) * 0.22);
        count = this.piece(count, (this.shapeRandom(slot, 15) - 0.5) * width * 0.55, supportHeight - hanging * 0.5, 0, supportWidth * 0.75, hanging, depth * 0.55, 0);
      }
    }

    const hue = 0.025 + hash01(this.seed, slot, SALT_COLOUR) * 0.035;
    const saturation = 0.2 + hash01(this.seed, slot, SALT_COLOUR + 1) * 0.18;
    const lightness = 0.24 + hash01(this.seed, slot, SALT_COLOUR + 2) * 0.12;
    this.material.color.setHSL(hue, saturation, lightness);
    this.mesh.count = count;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  private shapeRandom(slot: number, index: number): number {
    return hash01(this.seed, slot, SALT_SHAPE + index * 0x9e37);
  }

  private piece(
    index: number,
    x: number,
    y: number,
    z: number,
    width: number,
    height: number,
    depth: number,
    roll: number,
  ): number {
    this.position.set(x, y, z);
    this.quaternion.setFromAxisAngle(this.rollAxis, roll);
    this.scale.set(width, height, depth);
    this.matrix.compose(this.position, this.quaternion, this.scale);
    this.mesh.setMatrixAt(index, this.matrix);
    return index + 1;
  }
}
