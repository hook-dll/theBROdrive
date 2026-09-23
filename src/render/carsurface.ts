/**
 * One car's visible body condition: the paint's dirt and scratches.
 *
 * Created once per instanced car by render/carmodel.ts, which is the only place that
 * knows which materials are this car's paint. Holding those handles is the point: a
 * car driving through dust updates its paint every frame, and walking a 20-node scene
 * graph to find two materials each time is work that buys nothing.
 */

import type * as THREE from 'three';
import { setCarBodyCondition } from './materials';

export class CarBodySurface {
  private appliedDirt = -1;
  private appliedScratches = -1;

  constructor(
    /** This car's own paint materials, captured when it was instanced. */
    readonly paint: readonly THREE.Material[],
  ) {}

  /** Writes dirt and scratches into this car's paint; free when neither changed. */
  setCondition(dirt: number, scratches: number): void {
    if (dirt === this.appliedDirt && scratches === this.appliedScratches) return;
    this.appliedDirt = dirt;
    this.appliedScratches = scratches;
    setCarBodyCondition(this.paint, dirt, scratches);
  }

  /** Frees this car's own paint materials. */
  dispose(): void {
    for (const material of this.paint) material.dispose();
  }
}
