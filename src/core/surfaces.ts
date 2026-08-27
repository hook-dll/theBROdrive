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
    color: 0x505055,
    dust: 0.0,
    smoke: 1.0,
  },
  [SurfaceType.CrackedAsphalt]: {
    label: 'cracked asphalt',
    frictionSlip: 2.2,
    sideFriction: 0.88,
    rollingResistance: 0.018,
    roughness: 0.045,
    color: 0x5a5550,
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
    /**
     * FORWARD traction, and the highest of the loose surfaces on purpose — higher than
     * gravel, which reads wrong until you ask what the tyre is doing. A tyre on gravel
     * shears a thin layer of stones over hardpan. A tyre on sand sinks in and builds a
     * wedge of material ahead of the contact patch, and pushes against that. Forward,
     * sand gives; sideways it gives up completely, which is what `sideFriction` says.
     *
     * The number is set by a budget, not by feel: `frictionSlip *
     * LONGITUDINAL_GRIP_FRACTION` is the longitudinal mu, and the grade a stopped car
     * can pull away on is `(mu * drivenShare - rollingResistance) / (1 -/+ mu * h/L)`.
     * At the old 0.95 that was ELEVEN PERCENT for a two-wheel-drive saloon, which is
     * the whole reason the desert had to be glass: the dune field's own peak slope was
     * 7%, just under it, and the moment the near desert got chop and scoops in it (see
     * `Terrain.detailAt`) a car that stopped could only reverse back out of its own
     * tracks. Measured by tools/desert-ride.ts: 6.7% of every (spot, heading) pair in
     * the near desert was a direction a stopped car could not pull away in. At 1.35 the
     * budget is 20% and that falls to 0.7%.
     *
     * It also restores a capability the game lost. The `sport` tyre compound used to
     * hand out 35% more longitudinal grip, and the surface where anyone noticed was
     * sand; when that became traction control (see TYRE_COMPOUNDS in vehicle.ts) the
     * sand traction went with it, because TCS adds nothing — it only stops a wheel
     * wasting what it already makes. There is nothing for it to un-waste when the tyre
     * is simply out of grip, which is why the lamp lights and the car stays put.
     *
     * The side effect is honest and intended: the friction cone is also the lateral
     * ceiling, so ultimate cornering grip on sand rises with it. `sideFriction` at 0.42
     * still builds that force lazily, so sand still washes wide and still slides — it
     * just no longer runs out of road-going traction on a one-in-eight slope.
     */
    frictionSlip: 1.35,
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
