import type { Terrain } from './terrain';

/**
 * What the ground under a structure's footprint actually does.
 *
 * Everything in this world is placed on dunes, and a dune is a SLOPE rather than a
 * bumpy field: measured over the real generators, a 14 m footprint carries 1.5 m of
 * height range at a 9-10% tilt, and fitting one plane through it leaves only 0.4 m.
 * So a single centre sample — which is what every builder used to take — is wrong by
 * most of a metre, and the fix is not a finer sample but a PLANE.
 *
 * Three uses, and every placement in the game is one of them:
 *   1. tilt the object onto `roll`/`pitch` — a parked car, a tent, a crate, a hull;
 *   2. stand a vertical member on `yAt(right, forward)` — each canopy post reaches
 *      its own ground while the roof it carries stays level;
 *   3. lay a slab whose top IS this plane, thick enough to bridge `residual`, and
 *      place everything else on it exactly, with no sampling at all.
 *
 * The frame is the site's own: `right` is the +X axis of an object yawed by the same
 * angle passed to `fitGround`, `forward` is its +Z. That is the same (right, forward)
 * basis `rotateXZ` in poi.ts uses, so a builder's local offsets index this plane
 * directly.
 */
export class GroundPlane {
  constructor(
    /** Ground height at the footprint centre, on the fitted plane. */
    readonly centreY: number,
    /** Gradient along the local right axis, metres per metre. */
    readonly slopeRight: number,
    /** Gradient along the local forward axis, metres per metre. */
    readonly slopeForward: number,
    /** Lowest and highest sample taken. A skirt reaches below `minY`. */
    readonly minY: number,
    readonly maxY: number,
    /** Worst distance any sample sits from the plane. What a slab must bridge. */
    readonly residual: number,
  ) {}

  /** Plane height at a local offset, in the same (right, forward) metres. */
  yAt(right: number, forward: number): number {
    return this.centreY + this.slopeRight * right + this.slopeForward * forward;
  }

  /**
   * Base height for a PLUMB box standing at a local offset, so its LOWEST corner
   * rests on the plane and the rest of its sill is buried rather than hanging. The
   * alternative — the plane height at the centre — leaves the downhill corner of
   * anything wider than a metre visibly off the ground.
   */
  seatAt(right: number, forward: number, halfRight: number, halfForward: number): number {
    return (
      this.yAt(right, forward) -
      (Math.abs(this.slopeRight) * halfRight + Math.abs(this.slopeForward) * halfForward)
    );
  }

  /**
   * Roll for `poseMatrix`, which composes `Euler(pitch, yaw, roll, 'YXZ')`: before
   * the yaw, that tilts the object's up vector to `(-roll, 1, pitch)`, and the
   * plane's normal is `(-slopeRight, 1, -slopeForward)`.
   */
  get roll(): number {
    return this.slopeRight;
  }

  get pitch(): number {
    return -this.slopeForward;
  }

  /**
   * The same tilt, for an object whose own yaw differs from the site's by
   * `deltaYaw`. A crate dropped at a random angle still has to lie ALONG the
   * slope, and its roll/pitch are the plane's gradient resolved onto its own axes.
   */
  tiltFor(deltaYaw: number): { roll: number; pitch: number } {
    const c = Math.cos(deltaYaw);
    const s = Math.sin(deltaYaw);
    return {
      roll: this.slopeRight * c - this.slopeForward * s,
      pitch: -(this.slopeRight * s + this.slopeForward * c),
    };
  }

  /** Steepest gradient of the fitted plane, as a fraction. */
  get grade(): number {
    return Math.hypot(this.slopeRight, this.slopeForward);
  }
}

/**
 * Fits `GroundPlane` to the terrain under a rectangle.
 *
 * `halfRight`/`halfForward` are the footprint's half extents in the yawed frame.
 * `steps` is the grid resolution per axis; the default nine samples resolve the
 * tilt exactly (the field is planar at this scale) and cost one road projection
 * each, which is why the callers fit ONE plane per site rather than one per part.
 */
export function fitGround(
  terrain: Terrain,
  x: number,
  z: number,
  yaw: number,
  halfRight: number,
  halfForward: number,
  hintS: number,
  steps = 3,
): GroundPlane {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const n = Math.max(2, steps);
  let sumH = 0;
  let sumUU = 0;
  let sumVV = 0;
  let sumUH = 0;
  let sumVH = 0;
  let minY = Infinity;
  let maxY = -Infinity;
  const us = new Float64Array(n * n);
  const vs = new Float64Array(n * n);
  const hs = new Float64Array(n * n);
  let count = 0;
  for (let i = 0; i < n; i++) {
    const u = (i / (n - 1) - 0.5) * 2 * halfRight;
    for (let j = 0; j < n; j++) {
      const v = (j / (n - 1) - 0.5) * 2 * halfForward;
      const h = terrain.heightAt(x + c * u + s * v, z - s * u + c * v, hintS);
      us[count] = u;
      vs[count] = v;
      hs[count] = h;
      count++;
      sumH += h;
      sumUU += u * u;
      sumVV += v * v;
      sumUH += u * h;
      sumVH += v * h;
      if (h < minY) minY = h;
      if (h > maxY) maxY = h;
    }
  }
  // The grid is symmetric about the centre, so the normal equations decouple: the
  // cross terms and the first moments of u and v are all zero.
  const slopeRight = sumUU > 0 ? sumUH / sumUU : 0;
  const slopeForward = sumVV > 0 ? sumVH / sumVV : 0;
  const centreY = sumH / count;
  let residual = 0;
  for (let k = 0; k < count; k++) {
    const d = Math.abs(hs[k]! - (centreY + slopeRight * us[k]! + slopeForward * vs[k]!));
    if (d > residual) residual = d;
  }
  return new GroundPlane(centreY, slopeRight, slopeForward, minY, maxY, residual);
}
