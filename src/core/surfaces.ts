/**
 * Ground surface types and their driving characteristics.
 *
 * Rapier's vehicle controller reports which collider each wheel is standing on
 * (`wheelGroundObject`). We map that collider back to a surface type and feed the
 * surface's numbers into the per-wheel friction settings each tick, which is how
 * "reacts to the quality of the road surface" is implemented.
 */

import { hash01, Noise2D } from './rng';

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
  /**
   * Amplitude in metres of the LONG sub-collider profile the collider does not carry:
   * wind ripple on sand, corrugation on a gravel track, the chatter of broken rock.
   * Centimetres, at a couple of metres of wavelength, with a grain (see `MicroRelief`).
   *
   * Every drivable collider in this game is a triangle mesh with edges of the order of
   * a metre: the road ribbon's rows are 1.333 m apart and the desert's fan is coarser
   * still. Anything shorter than that simply cannot be a vertex, so the whole band a
   * tyre spends its life in is missing from the geometry by construction, and no
   * amount of extra height field detail can put it back without also putting visible
   * chop into a dune that is supposed to read as smooth sand.
   *
   * So it is not geometry here. It is a per-wheel excitation with the same physics a
   * real bump would have: it drives the tyre's own vertical rate against the unsprung
   * mass (see the tyre block in vehicle.ts), and the load fluctuation that results
   * costs grip, disturbs the steering and shakes the body exactly as a modelled bump
   * would. It is invisible, it is a few noise samples a step, and it is what makes
   * sand feel like sand.
   *
   * Zero for the sealed surfaces: a road does not have wind ripple. What it has is
   * `texture` below.
   */
  readonly microRelief: number;
  /**
   * Amplitude in metres of the SHORT sub-collider profile: millimetres of chip, seam
   * and crack, isotropic, at a metre and a half of wavelength and under (see
   * `RoadTexture`).
   *
   * This is the band a driver means by "feeling the road", and it was missing
   * entirely. Sealed surfaces had `microRelief: 0` on the grounds that their texture
   * was already in the collider — but the collider's rows are 1.333 m apart and its
   * shortest bump octave is 3.33 m, so what it actually carries is the road's
   * WAVINESS. Between those rows the road was glass, and the measured result was a
   * heave of 0.000 g on flat asphalt: nothing at all under the tyres. Every real road
   * has a broadband roughness spectrum, and this is the short end of it.
   */
  readonly texture: number;
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
    microRelief: 0,
    // 6 mm of chip and seam: a well-kept sealed road, ISO class B/C territory.
    texture: 0.006,
    color: 0x505055,
    dust: 0.0,
    smoke: 1.0,
  },
  [SurfaceType.CrackedAsphalt]: {
    label: 'cracked asphalt',
    frictionSlip: 2.2,
    sideFriction: 0.84,
    rollingResistance: 0.018,
    roughness: 0.06,
    microRelief: 0,
    // Crazing, patches and lifted edges. Nearly three times the sound asphalt.
    texture: 0.011,
    color: 0x5a5550,
    dust: 0.1,
    smoke: 0.85,
  },
  [SurfaceType.Gravel]: {
    label: 'gravel',
    frictionSlip: 1.35,
    sideFriction: 0.5,
    rollingResistance: 0.035,
    roughness: 0.09,
    microRelief: 0.007,
    texture: 0.008,
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
    microRelief: 0.018,
    texture: 0.006,
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
    microRelief: 0.02,
    texture: 0.014,
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
    microRelief: 0,
    // Slabs are smoother than asphalt between their joints, and the joints are in
    // the collider's own rows rather than here.
    texture: 0.0025,
    color: 0x9a978f,
    dust: 0.0,
    smoke: 1.0,
  },
};

/**
 * The sub-collider ground profile, as a field.
 *
 * One value per world position, in units of `SurfaceProps.microRelief`, and a pure
 * function of that position — so two cars crossing the same patch are thrown by the
 * same ripple, a car that stops and reverses re-crosses its own, and nothing here has
 * to be stored or streamed.
 *
 * The shape is a desert's, not a noise generator's default. Wind-blown sand and the
 * corrugation a track develops under traffic both form RIPPLES: ridges that run
 * crosswise to the flow that built them, short in the direction you cross them and
 * long along their own length. So the field is deliberately anisotropic — a couple of
 * metres between ridges, tens of metres of ridge — and that has a consequence worth
 * having: which way you point across the desert matters. Cut across the grain and the
 * car hammers; run with it and it settles. A driver can read that and use it.
 *
 * RIPPLE_WAVELENGTH is chosen against the simulation's own limits, not by eye. The
 * fixed step is 60 Hz and a car travels 0.42 m in one of them at 90 km/h, so a wave
 * shorter than about 1.7 m cannot be sampled without aliasing into noise that changes
 * with speed. 2.2 m is above that and lands the excitation at 3-8 Hz over the range
 * anyone drives off-road, which is the band where a wheel starts working and the body
 * starts being told about it.
 */
const RIPPLE_WAVELENGTH = 2.2;
/**
 * Metres a ridge holds its line for, along its own length.
 *
 * Not the tens of metres a photograph of a dune field suggests. A ridge that long,
 * with a direction that only turns every few hundred metres, leaves whole headings
 * genuinely smooth: a car running the grain feels nothing at all for a kilometre, which
 * measured as a desert quieter than the road. Ten metres keeps the grain readable —
 * crossing still hammers and running with it still settles — without any heading being
 * free.
 */
const RIPPLE_COHERENCE = 10;
/** Relative amplitude of the isotropic lump layer, and its wavelength in metres. */
const LUMP_GAIN = 0.45;
const LUMP_WAVELENGTH = 7.5;
/**
 * Metres over which the prevailing direction turns. A dune field is not a comb: the
 * wind bends round landforms and the grain bends with it, so the direction is itself a
 * slow field rather than one angle for the whole world.
 */
const RIPPLE_TURN_WAVELENGTH = 450;
/** Radians the direction may swing either side of the world's prevailing wind. */
const RIPPLE_TURN_RAD = 1.1;

export class MicroRelief {
  private readonly ripple: Noise2D;
  private readonly lump: Noise2D;
  private readonly turn: Noise2D;
  /** The world's prevailing wind, radians; the turn field bends the grain around it. */
  private readonly wind: number;

  constructor(seed: number) {
    this.ripple = new Noise2D(seed ^ 0x7a11e5);
    this.lump = new Noise2D(seed ^ 0x1c3b09);
    this.turn = new Noise2D(seed ^ 0x2f60d1);
    this.wind = hash01(seed, 0x1d) * Math.PI * 2;
  }

  /**
   * Profile height at an ABSOLUTE world position, in [-1, 1]. Callers scale it by the
   * surface's own `microRelief`. Absolute, because a field sampled at a rebased
   * coordinate would silently change shape every time the floating origin moved.
   */
  at(x: number, z: number): number {
    const angle =
      this.wind +
      RIPPLE_TURN_RAD *
        this.turn.at(x / RIPPLE_TURN_WAVELENGTH, z / RIPPLE_TURN_WAVELENGTH);
    const acrossX = Math.cos(angle);
    const acrossZ = Math.sin(angle);
    const across = x * acrossX + z * acrossZ;
    const along = z * acrossX - x * acrossZ;
    const ridges = this.ripple.at(across / RIPPLE_WAVELENGTH, along / RIPPLE_COHERENCE);
    const lumps = this.lump.at(x / LUMP_WAVELENGTH, z / LUMP_WAVELENGTH);
    return (ridges + LUMP_GAIN * lumps) / (1 + LUMP_GAIN);
  }
}

/**
 * The SHORT sub-collider profile: what a sealed road has instead of wind ripple.
 *
 * Isotropic, because asphalt has no grain — chip, seam and crack look the same
 * whichever way you cross them, which is exactly how it differs from the desert field
 * above.
 *
 * ---- why these wavelengths and not shorter ----
 *
 * The simulation steps at 60 Hz, so a car at 120 km/h (33 m/s) advances 0.56 m per
 * step and cannot resolve anything below 1.11 m of wavelength without aliasing — and
 * aliased road texture is not harshness, it is a rattle whose pitch changes with
 * speed. The short octave is therefore 1.5 m, which stays sampled at every speed the
 * game reaches and lands at 11 Hz at 60 km/h and 17 Hz at 90: the secondary-ride band,
 * right on the wheel-hop mode, which is precisely where a road talks to a driver.
 *
 * The long octave at 4.5 m fills the gap between that and the collider's own 3.33 m
 * bump field, so the spectrum has no hole in it.
 *
 * Everything below 1.5 m — the tyre roar and fine buzz a real car also has — is not
 * simulated here and must not be: at 60 Hz it cannot be, and a tyre envelops most of
 * it anyway (CONTACT_PATCH_M in vehicle.ts). It belongs to the audio layer.
 */
const TEXTURE_SHORT_WAVELENGTH = 1.5;
const TEXTURE_LONG_WAVELENGTH = 4.5;
/** Relative amplitude of the long octave. Roughness rises with wavelength (ISO 8608). */
const TEXTURE_LONG_GAIN = 1.1;

export class RoadTexture {
  private readonly fine: Noise2D;
  private readonly coarse: Noise2D;

  constructor(seed: number) {
    this.fine = new Noise2D(seed ^ 0x51d0c7);
    this.coarse = new Noise2D(seed ^ 0x3b81a9);
  }

  /**
   * Profile height at an ABSOLUTE world position, in [-1, 1]; callers scale it by the
   * surface's own `texture`. Absolute for the same reason `MicroRelief.at` is: a field
   * sampled at a rebased coordinate changes shape whenever the origin moves.
   */
  at(x: number, z: number): number {
    const fine = this.fine.at(x / TEXTURE_SHORT_WAVELENGTH, z / TEXTURE_SHORT_WAVELENGTH);
    const coarse = this.coarse.at(x / TEXTURE_LONG_WAVELENGTH, z / TEXTURE_LONG_WAVELENGTH);
    return (fine + TEXTURE_LONG_GAIN * coarse) / (1 + TEXTURE_LONG_GAIN);
  }
}

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
