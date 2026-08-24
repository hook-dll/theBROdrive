import type * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { hash01 } from '../core/rng';
import { poiAt, POI_SPACING, type Poi } from './poi';
import { ROAD_LENGTH } from './road';

/**
 * Freight: what a stop wants moved, and where to.
 *
 * Pure functions of the seed, like every other piece of world content. A slot's
 * job never changes and is never stored — only the job the player has *accepted*
 * is state (`WorldState.job`).
 *
 * Two rules carry the whole design:
 *
 *  1. **Destinations are always further down the road.** Never back. This is what
 *     marries freight to the one-way drive: hauling is the reason you keep going
 *     rather than a reason to shuttle between two stops.
 *  2. **Weight and distance are the only variables.** No fragility, no clocks, no
 *     spoilage. The load is a number of kilograms and a number of kilometres, and
 *     the era-correct tyre model turns those two numbers into the entire
 *     difficulty. Anything else would need UI, and the point of this system is
 *     that it has none: the job lives on a signpost and the payment on your
 *     bonnet.
 */

/** A job offered at a POI. Deterministic; never stored. */
export interface FreightJob {
  /** POI slot offering the load. */
  readonly fromPoi: number;
  /** POI slot the lit sign stands at. Always ahead of `fromPoi`. */
  readonly toPoi: number;
  /** Load, kg. */
  readonly cargoKg: number;
  /** Haul length in metres, for the pickup prompt. */
  readonly distanceM: number;
}

/** Domain tag for the freight hash stream, distinct from every other subsystem. */
const FREIGHT_DOMAIN = 0x46524731; // 'FRG1'
/** Fraction of eligible stops with a load waiting. */
const JOB_CHANCE = 0.55;
/** Only stops with somewhere to put a pallet offer freight. */
const JOB_KINDS: readonly Poi['kind'][] = ['gas_stop', 'workshop'];
/** Load range, kg. Bottom end is a nuisance; top end ruins a small car. */
const CARGO_MIN = 180;
const CARGO_MAX = 700;
/**
 * Haul length in POI slots. Four slots is ~4.8 km — long enough that you commit to
 * it, short enough that a dry tank is a setback rather than the end of the run.
 */
const HAUL_SLOTS_MIN = 4;
const HAUL_SLOTS_MAX = 26;

/**
 * The job waiting at a slot, or null.
 *
 * The destination is resolved by walking forward until a slot actually holds a POI:
 * occupancy is 55%, so a raw offset would half the time name empty desert, and a
 * sign standing in open sand with nothing behind it would read as a bug.
 */
export function jobAt(seed: number, index: number): FreightJob | null {
  const from = poiAt(seed, index);
  if (!from || !JOB_KINDS.includes(from.kind)) return null;
  if (hash01(seed, FREIGHT_DOMAIN, index) >= JOB_CHANCE) return null;

  const span = HAUL_SLOTS_MAX - HAUL_SLOTS_MIN;
  const wanted = index + HAUL_SLOTS_MIN + Math.floor(hash01(seed, FREIGHT_DOMAIN, index, 1) * span);
  const lastSlot = Math.floor(ROAD_LENGTH / POI_SPACING);

  let to: Poi | null = null;
  for (let i = wanted; i <= lastSlot; i++) {
    const candidate = poiAt(seed, i);
    if (candidate) {
      to = candidate;
      break;
    }
  }
  // Near the end of the road there may be nothing left ahead. No job, rather than
  // a delivery to a place that does not exist.
  if (!to) return null;

  const cargoKg = Math.round(
    CARGO_MIN + hash01(seed, FREIGHT_DOMAIN, index, 2) * (CARGO_MAX - CARGO_MIN),
  );

  return { fromPoi: from.index, toPoi: to.index, cargoKg, distanceM: to.s - from.s };
}

// ---------------------------------------------------------------------------
// Live world objects: the destination sign and the pallet waiting at a stop
// ---------------------------------------------------------------------------

/** Emissive intensity of a lit destination sign. */
const SIGN_EMISSIVE = 2.4;
/** Point-light output of a lit sign, matching the streetlight budget's units. */
const SIGN_POINT = 70;

interface SignEntry {
  readonly poiIndex: number;
  readonly material: THREE.MeshStandardMaterial;
  readonly light: THREE.PointLight;
  readonly chunkBodies: RAPIER.RigidBody[];
}

interface PalletEntry {
  readonly poiIndex: number;
  readonly mesh: THREE.Object3D;
  readonly chunkBodies: RAPIER.RigidBody[];
}

/**
 * Every destination sign and freight pallet currently built, and the collider maps
 * that let the aim ray name one.
 *
 * The sign is the whole navigation system. Every stop has one — an unlit frame is
 * ordinary desert furniture, so the presence of a sign gives nothing away — and the
 * one standing at the destination of the accepted job lights up. No kilometre
 * number, no name, no HUD tracker: you drive until you see it burning on the
 * horizon. That also makes the sign the delivery point, which is why it is
 * aimable: one object, both roles.
 *
 * Lighting rides the per-frame `setLamps` push that chunks already receive, so a
 * job starting or finishing needs no chunk rebuild and no new invalidation path.
 */
export class FreightField {
  private readonly signs = new Map<number, SignEntry>();
  private readonly pallets = new Map<number, PalletEntry>();
  private readonly colliderToSign = new Map<number, number>();
  private readonly colliderToPallet = new Map<number, number>();
  /** Last intensity written, so a static night costs no material writes. */
  private lastLitPoi = -1;
  private lastNight = -1;

  registerSign(
    poiIndex: number,
    material: THREE.MeshStandardMaterial,
    light: THREE.PointLight,
    colliderHandle: number | null,
    chunkBodies: RAPIER.RigidBody[],
  ): void {
    this.signs.set(poiIndex, { poiIndex, material, light, chunkBodies });
    if (colliderHandle !== null) this.colliderToSign.set(colliderHandle, poiIndex);
  }

  registerPallet(
    poiIndex: number,
    mesh: THREE.Object3D,
    colliderHandle: number | null,
    chunkBodies: RAPIER.RigidBody[],
  ): void {
    this.pallets.set(poiIndex, { poiIndex, mesh, chunkBodies });
    if (colliderHandle !== null) this.colliderToPallet.set(colliderHandle, poiIndex);
  }

  /** Drops every registration belonging to an unloading chunk. */
  forgetChunk(chunkBodies: RAPIER.RigidBody[]): void {
    for (const [index, entry] of this.signs) {
      if (entry.chunkBodies !== chunkBodies) continue;
      this.signs.delete(index);
    }
    for (const [index, entry] of this.pallets) {
      if (entry.chunkBodies !== chunkBodies) continue;
      this.pallets.delete(index);
    }
    for (const [handle, index] of this.colliderToSign) {
      if (!this.signs.has(index)) this.colliderToSign.delete(handle);
    }
    for (const [handle, index] of this.colliderToPallet) {
      if (!this.pallets.has(index)) this.colliderToPallet.delete(handle);
    }
    // A lit sign that just unloaded must not keep its cached state, or the next
    // sign built for the same job would never be told to light.
    this.lastLitPoi = -1;
  }

  signPoiForCollider(colliderHandle: number): number | null {
    return this.colliderToSign.get(colliderHandle) ?? null;
  }

  /** Live pallets and their world positions. Used by the dev inspection hook. */
  livePallets(): { poiIndex: number; x: number; y: number; z: number }[] {
    const out: { poiIndex: number; x: number; y: number; z: number }[] = [];
    for (const entry of this.pallets.values()) {
      const p = entry.mesh.position;
      out.push({ poiIndex: entry.poiIndex, x: p.x, y: p.y, z: p.z });
    }
    return out;
  }

  /** Live signs, with position and whether each is lit. Used by the dev hook. */
  liveSigns(): { poiIndex: number; lit: boolean; x: number; y: number; z: number }[] {
    const out: { poiIndex: number; lit: boolean; x: number; y: number; z: number }[] = [];
    for (const entry of this.signs.values()) {
      const p = entry.light.position;
      out.push({
        poiIndex: entry.poiIndex,
        lit: entry.material.emissiveIntensity > 0,
        x: p.x,
        y: p.y,
        z: p.z,
      });
    }
    return out;
  }

  palletPoiForCollider(colliderHandle: number): number | null {
    return this.colliderToPallet.get(colliderHandle) ?? null;
  }

  /** Hides the pallet whose load is now on a trailer. */
  takePallet(poiIndex: number): void {
    const entry = this.pallets.get(poiIndex);
    if (entry) entry.mesh.visible = false;
  }

  /**
   * Lights the destination sign and leaves every other one dark. Called from the
   * chunk content's per-frame lamp push, so it must stay allocation-free and cheap:
   * it writes only when the lit slot or the night factor actually changed.
   */
  updateSigns(night: number, toPoi: number | null): void {
    const lit = toPoi ?? -1;
    if (lit === this.lastLitPoi && night === this.lastNight) return;
    this.lastLitPoi = lit;
    this.lastNight = night;

    for (const entry of this.signs.values()) {
      const active = entry.poiIndex === lit;
      // A lit sign is legible in daylight too: the panel glows regardless, and only
      // the pool of light it throws is gated on darkness.
      entry.material.emissiveIntensity = active ? SIGN_EMISSIVE : 0;
      entry.light.intensity = active ? night * SIGN_POINT : 0;
    }
  }
}
