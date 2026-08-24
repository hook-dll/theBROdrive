/**
 * Ground surface types and their driving characteristics.
 *
 * Rapier's vehicle controller reports which collider each wheel is standing on
 * (`wheelGroundObject`). We map that collider back to a surface type and feed the
 * surface's numbers into the per-wheel friction settings each tick, which is how
 * "reacts to the quality of the road surface" is implemented.
 */

export const enum SurfaceType {
  Asphalt = 0,
  CrackedAsphalt = 1,
  Gravel = 2,
  Sand = 3,
  Rock = 4,
  Concrete = 5,
}

export interface SurfaceProps {
  readonly label: string;
  /** Forward traction. Higher = tyre bites harder before slipping. */
  readonly frictionSlip: number;
  /** Lateral grip multiplier. Low values let the tail step out. */
  readonly sideFriction: number;
  /** Speed-independent drag, as a fraction of vehicle weight. */
  readonly rollingResistance: number;
  /** Amplitude in metres of the micro-bumps baked into the collider mesh. */
  readonly roughness: number;
  /** Base albedo for the surface material. */
  readonly color: number;
  /**
   * How much LOOSE MATERIAL a slipping wheel throws off this surface. Drives both
   * the count and the colour of the wheel spray: this is sand and grit, and it is
   * the ground's own material leaving the ground.
   */
  readonly dust: number;
  /**
   * How much a slipping wheel SMOKES on this surface. The complementary channel:
   * rubber boiling off a tyre that is being dragged across something hard, which is
   * grey-white, sparse, and goes nowhere. A sealed road raises no dust at all and is
   * where a tyre smokes most; sand is the reverse, because a wheel on sand digs
   * instead of scrubbing. The two are not normalised — `dust + smoke` is under 1 on
   * gravel and rock, where a scrubbing tyre does neither well.
   */
  readonly smoke: number;
}

export const SURFACES: Record<SurfaceType, SurfaceProps> = {
  [SurfaceType.Asphalt]: {
    label: 'asphalt',
    frictionSlip: 2.6,
    sideFriction: 1.0,
    rollingResistance: 0.013,
    roughness: 0.012,
    color: 0x3a3a3d,
    dust: 0.0,
    smoke: 1.0,
  },
  [SurfaceType.CrackedAsphalt]: {
    label: 'cracked asphalt',
    frictionSlip: 2.2,
    sideFriction: 0.88,
    rollingResistance: 0.018,
    roughness: 0.045,
    color: 0x46433f,
    dust: 0.1,
    smoke: 0.85,
  },
  [SurfaceType.Gravel]: {
    label: 'gravel',
    frictionSlip: 1.35,
    sideFriction: 0.55,
    rollingResistance: 0.035,
    roughness: 0.07,
    color: 0x7a6c56,
    dust: 0.6,
    smoke: 0.15,
  },
  [SurfaceType.Sand]: {
    label: 'sand',
    frictionSlip: 0.95,
    sideFriction: 0.42,
    rollingResistance: 0.075,
    roughness: 0.05,
    color: 0xbf9f6b,
    dust: 1.0,
    smoke: 0.0,
  },
  [SurfaceType.Rock]: {
    label: 'rock',
    frictionSlip: 2.1,
    sideFriction: 0.8,
    rollingResistance: 0.022,
    roughness: 0.13,
    color: 0x6b6257,
    dust: 0.25,
    smoke: 0.5,
  },
  [SurfaceType.Concrete]: {
    label: 'concrete',
    frictionSlip: 2.5,
    sideFriction: 0.98,
    rollingResistance: 0.012,
    roughness: 0.006,
    color: 0x9a978f,
    dust: 0.0,
    smoke: 1.0,
  },
};

/**
 * Collider handle -> surface type. Rapier colliders carry no structured user-data
 * slot, so ownership of that mapping lives here. Chunk unloading must call `forget`
 * or this map leaks across a long drive.
 */
export class SurfaceRegistry {
  private readonly byHandle = new Map<number, SurfaceType>();

  register(colliderHandle: number, surface: SurfaceType): void {
    this.byHandle.set(colliderHandle, surface);
  }

  forget(colliderHandle: number): void {
    this.byHandle.delete(colliderHandle);
  }

  /**
   * Registered type of a collider. Unknown colliders read as asphalt so a missing
   * registration cannot strand the car.
   */
  lookupType(colliderHandle: number | null | undefined): SurfaceType {
    if (colliderHandle == null) return SurfaceType.Asphalt;
    return this.byHandle.get(colliderHandle) ?? SurfaceType.Asphalt;
  }

  /** Driving characteristics of a collider's registered surface. */
  lookup(colliderHandle: number | null | undefined): SurfaceProps {
    return SURFACES[this.lookupType(colliderHandle)];
  }
}
