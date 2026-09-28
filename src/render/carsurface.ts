/**
 * One car's visible body condition: the paint's dirt and scratches, and the dust on
 * its windows.
 *
 * Created once per instanced car by render/carmodel.ts, which is the only place that
 * knows which materials are this car's paint. Holding those handles is the point: a
 * car driving through dust updates its paint every frame, and walking a 20-node scene
 * graph to find two materials each time is work that buys nothing.
 */

import type * as THREE from 'three';
import type { StickerState } from '../game/state';
import {
  setCarBodyCondition,
  setCarBodyHighlight,
  setCarBodyPaintColor,
  setCarBodyStickers,
  setCarGrime,
} from './materials';

/**
 * Share of the body's dirt the windows carry. One: the glass evaluates the paint's own
 * crust in the chassis frame (materials.ts GLASS_GRIME_BODY), so the dust line has to be
 * the same number or it would step down where it crosses from a door onto its window.
 * What makes glass hold less is in the shader (a thinner film above the crust).
 */
export const GLASS_DIRT_SHARE = 1;

export class CarBodySurface {
  private appliedDirt = -1;
  private appliedHighlight = 0;
  private appliedScratches = -1;

  constructor(
    /** This car's own paint materials, captured when it was instanced. */
    readonly paint: readonly THREE.Material[],
    /** This car's own window glass (render/carmodel.ts `cloneCarGlass`). */
    readonly glass: readonly THREE.Material[] = [],
  ) {}

  /** Writes dirt and scratches into this car's paint; free when neither changed. */
  setCondition(dirt: number, scratches: number): void {
    if (dirt === this.appliedDirt && scratches === this.appliedScratches) return;
    this.appliedDirt = dirt;
    this.appliedScratches = scratches;
    setCarBodyCondition(this.paint, dirt, scratches);
    setCarGrime(this.glass, dirt * GLASS_DIRT_SHARE);
  }

  /** Resprays the body `color`, over the factory colour it was instanced with. */
  setPaint(color: THREE.Color): void {
    setCarBodyPaintColor(this.paint, color);
  }

  /**
   * Prints this car's placed stickers into its paint and glass (materials.ts
   * CAR_STICKERS), with `preview` — the one being tried on — see-through on top.
   */
  setStickers(stickers: readonly StickerState[], preview: StickerState | null = null): void {
    setCarBodyStickers(this.paint, stickers, preview);
  }

  /** The "stick it here" pulse, 0..1. */
  setHighlight(value: number): void {
    if (value === this.appliedHighlight) return;
    this.appliedHighlight = value;
    setCarBodyHighlight(this.paint, value);
  }

  /** Frees this car's own paint materials. */
  dispose(): void {
    for (const material of this.paint) material.dispose();
    for (const material of this.glass) material.dispose();
  }
}
