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
   * Amplitude in metres of the MID sub-collider profile: the 3-6 m band, which on
   * loose ground is hummock, whoop and the long side of track corrugation.
   *
   * It exists because of a resolution floor, exactly like `microRelief` and
   * `texture`, but a different one. The shipped desert is a heightfield with 3 m
   * cells (`deserttiles.ts`), so it cannot honestly carry anything under about 7.5 m
   * of wavelength. Terrain geometry therefore stops at the ~10 m corrugation band in
   * world/terrain.ts, and this carries the octaves below it: 5.5 m and 3.2 m are 3.0
   * and 5.2 Hz at 60 km/h — primary ride and the bottom of secondary ride, the band a
   * body HEAVES in rather than the one a tyre buzzes in.
   *
   * Centimetres here are not small. It reaches the body through the tyre and the
   * unsprung mass like any bump (see the tyre block in vehicle.ts) and it costs grip
   * while it does. Measured on an in-game excursion at 67 km/h, sand's 9 cm is worth
   * about a third of the desert's body heave on its own; the terrain's corrugation is
   * worth about the same, and together they take heave from 0.32 g rms to 0.71.
   *
   * It also never touches a vertex, which is the other half of why it is here: it
   * cannot crumple a dune, so it is the knob to turn when the desert must feel rougher
   * without the landscape changing shape at all.
   *
   * Zero for the sealed surfaces: a graded road has no hummocks. What a road has in
   * this band is its own collider's 3.33 m bump octave.
   */
  readonly hummock: number;
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
    // Road-only steering experiment: twice the previous lateral tyre force.
    sideFriction: 2.0,
    rollingResistance: 0.013,
    roughness: 0.012,
    microRelief: 0,
    hummock: 0,
    // 6 mm of chip and seam: a well-kept sealed road, ISO class B/C territory.
    texture: 0.006,
    color: 0x505055,
    dust: 0.0,
    smoke: 1.0,
  },
  [SurfaceType.CrackedAsphalt]: {
    label: 'cracked asphalt',
    frictionSlip: 2.2,
    // Retains cracked asphalt's 84% relationship to sound asphalt.
    sideFriction: 1.68,
    rollingResistance: 0.018,
    roughness: 0.06,
    microRelief: 0,
    hummock: 0,
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
    // Gravel is the ROUGHEST ground in the game, and it used to be quieter than sand:
    // 7 mm against sand's 18. A graded track corrugates under its own traffic —
    // washboard is the thing gravel is famous for — and stones do not deform under a
    // tyre the way sand does.
    microRelief: 0.026,
    hummock: 0.045,
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
     * The number is set by a reachability budget, not by making sand conveniently
     * grippy: `frictionSlip * LONGITUDINAL_GRIP_FRACTION` is longitudinal mu, and a
     * stopped car's pull-away grade is
     * `(mu * drivenShare - rollingResistance) / (1 -/+ mu * h/L)`.
     *
     * At 1.15, tools/desert-ride.ts finds only 1.1% of sampled RWD headings and 1.7%
     * of FWD headings blocked, with no sampled location stranded in every direction.
     * That preserves deliberate exploration while making momentum and route choice
     * matter. The previous 1.35 let a two-wheel-drive road car climb one-in-five sand
     * slopes from rest and made leaving the road too cheap.
     *
     * Forward grip remains high enough to preserve escapability; the distinction from
     * the road is carried by a lower lateral coefficient and sustained bulldozing drag.
     * The latter is deliberately stronger than the old 0.075: engine-limited cars could
     * otherwise accelerate almost identically on asphalt and sand despite different
     * peak tyre capacity.
     */
    frictionSlip: 1.15,
    sideFriction: 0.34,
    rollingResistance: 0.095,
    roughness: 0.05,
    // Wind ripple, and the long hummocks under the geometry's own ~10 m corrugation
    // crests. Sand gives under load, so its ripple is softer than gravel's chatter
    // while its hummock band is the tallest: this is the surface an excursion is
    // measured on (tools/desert-washboard.ts).
    microRelief: 0.02,
    hummock: 0.09,
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
    // Broken rock chatters rather than ripples, and a shelf is never flat.
    microRelief: 0.024,
    hummock: 0.05,
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
    hummock: 0,
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
/**
 * THE HUMMOCK BAND (`SurfaceProps.hummock`): the octave between the ripple above and
 * the terrain's own 9 m corrugation in world/terrain.ts.
 *
 * 5.5 m and its 3.2 m harmonic. The upper end is set by the DESERT HEIGHTFIELD, not
 * by the physics step: its cells are 3 m, so 7.5 m is the shortest wave geometry can
 * carry, and everything below that has to arrive here or not at all. The lower end is
 * the 60 Hz step's own 1.7 m floor, which both octaves clear at every speed the game
 * reaches. At 60 km/h they land at 3.0 and 5.2 Hz: primary ride and the bottom of
 * secondary ride, which is the band a body HEAVES in — the sway a car gets when it
 * leaves the asphalt, as opposed to the buzz the 2.2 m ripple gives it.
 *
 * Anisotropic, on the same grain and the same bent direction field as the ripple, so
 * the whole desert has ONE grain at every scale: cut across it and the car works,
 * run with it and it settles. The coherence is longer than the ripple's because a
 * hummock is a bigger landform than a ripple, and a crest that short would read as
 * lumps rather than as a direction.
 */
const HUMMOCK_WAVELENGTH = 5.5;
const HUMMOCK_SHORT_WAVELENGTH = 3.2;
const HUMMOCK_SHORT_GAIN = 0.5;
const HUMMOCK_COHERENCE = 22;

export class MicroRelief {
  private readonly ripple: Noise2D;
  private readonly lump: Noise2D;
  private readonly hummock: Noise2D;
  private readonly turn: Noise2D;
  /** The world's prevailing wind, radians; the turn field bends the grain around it. */
  private readonly wind: number;
  /**
   * The last `basis` result: distance across the ridges, and along them. Scratch
   * rather than a returned pair because both fields below need it and this is called
   * once per wheel per step.
   */
  private across = 0;
  private along = 0;

  constructor(seed: number) {
    this.ripple = new Noise2D(seed ^ 0x7a11e5);
    this.lump = new Noise2D(seed ^ 0x1c3b09);
    this.hummock = new Noise2D(seed ^ 0x5f2d4b);
    this.turn = new Noise2D(seed ^ 0x2f60d1);
    this.wind = hash01(seed, 0x1d) * Math.PI * 2;
  }

  /** Rotates a world position into the local grain direction, into the scratch pair. */
  private basis(x: number, z: number): void {
    const angle =
      this.wind +
      RIPPLE_TURN_RAD *
        this.turn.at(x / RIPPLE_TURN_WAVELENGTH, z / RIPPLE_TURN_WAVELENGTH);
    const acrossX = Math.cos(angle);
    const acrossZ = Math.sin(angle);
    this.across = x * acrossX + z * acrossZ;
    this.along = z * acrossX - x * acrossZ;
  }

  /**
   * Profile height at an ABSOLUTE world position, in [-1, 1]. Callers scale it by the
   * surface's own `microRelief`. Absolute, because a field sampled at a rebased
   * coordinate would silently change shape every time the floating origin moved.
   */
  at(x: number, z: number): number {
    this.basis(x, z);
    const ridges = this.ripple.at(this.across / RIPPLE_WAVELENGTH, this.along / RIPPLE_COHERENCE);
    const lumps = this.lump.at(x / LUMP_WAVELENGTH, z / LUMP_WAVELENGTH);
    return (ridges + LUMP_GAIN * lumps) / (1 + LUMP_GAIN);
  }

  /**
   * The hummock band at an ABSOLUTE world position, in [-1, 1]; callers scale it by
   * the surface's own `hummock`. Same grain as `at`, two octaves up in wavelength
   * (see the constants above).
   */
  hummockAt(x: number, z: number): number {
    this.basis(x, z);
    const long = this.hummock.at(this.across / HUMMOCK_WAVELENGTH, this.along / HUMMOCK_COHERENCE);
    const short = this.hummock.at(
      this.across / HUMMOCK_SHORT_WAVELENGTH + 41.3,
      this.along / HUMMOCK_COHERENCE - 17.9,
    );
    return (long + HUMMOCK_SHORT_GAIN * short) / (1 + HUMMOCK_SHORT_GAIN);
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
