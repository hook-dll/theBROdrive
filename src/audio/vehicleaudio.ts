/**
 * The car, in sound. Everything here is synthesised from the same telemetry the
 * physics already produces (`VehicleAudioState`), so nothing can drift out of sync
 * with what the car is doing.
 *
 * Four continuous voices plus one-shots:
 *
 *  - Engine. A four-stroke fires `cylinders / 2` times per crank revolution, so the
 *    firing frequency is `rpm / 60 * cylinders / 2` — 100 Hz for a four at 3000 rpm.
 *    A deliberately band-limited pulse wave provides exhaust texture without the
 *    brittle high harmonics of a raw sawtooth. A subharmonic carries the body
 *    resonance, while filtered noise adds induction only under load. Load opens the
 *    low-pass: a closed throttle is a muffled drone, a wide-open one is brighter.
 *    That makes lifting off audible without making an ordinary four-cylinder sound
 *    like a turbine.
 *  - Wind. Noise through a high-pass that climbs with speed, gain going with the
 *    square of speed exactly as aerodynamic drag does. Inside the car it is
 *    muffled and quieter, because the shell is between you and it.
 *  - Tyre roll. Noise band-passed around a centre frequency set by the surface's
 *    own roughness, gain rising with speed and with how many wheels are actually
 *    on the ground. Sand hisses, asphalt hums, gravel rattles — all one voice.
 *  - Skid. A separate, much harder noise band gated on lateral slip, so a
 *    handbrake turn or a lost rear end squeals under the roll noise.
 *  - Brakes. A narrow low-mid pad rub, pulsed once per wheel revolution, which
 *    fades as the car stops and hands over to the skid voice as the wheels lock.
 *    Explicitly NOT a broadband hiss and explicitly not a pitched squeal: see the
 *    brake note below for what each of those sounded like.
 *
 * One-shots: gear engagement clunk, suspension/landing thump, engine start.
 */

import type { VehicleAudioState } from '../vehicle/vehicle';
import { AudioMixer, ramp } from './mixer';

/** Speed (m/s) at which wind reaches its maximum intended level. */
const WIND_FULL_MPS = 45;
/** Wind filter corners, Hz. Kept below hiss territory for a softer road sound. */
const WIND_HP_LOW = 140;
const WIND_HP_HIGH = 480;
const WIND_LP_LOW = 3000;
const WIND_LP_HIGH = 1800;
/** Hood and chase cameras share the same restrained wind level. */
const WIND_GAIN = 0.16;

/** Speed (m/s) at which tyre roll noise saturates. */
const TYRE_FULL_MPS = 30;
const TYRE_GAIN = 0.34;
/** Roll-noise band centre, Hz, for a glass-smooth and for a rough surface. */
const TYRE_FREQ_SMOOTH = 620;
const TYRE_FREQ_ROUGH = 260;
/** Surface roughness (metres of micro-bump) treated as fully rough. */
const ROUGHNESS_FULL = 0.05;

/** Lateral slip (m/s) at which the skid voice starts and where it saturates. */
const SKID_START_MPS = 1.6;
const SKID_FULL_MPS = 7;
const SKID_GAIN = 0.42;

/**
 * Brakes.
 *
 * A braking car does NOT hiss. The voice this replaced was a wide (Q 0.8) noise
 * band at 3.2 kHz held open by pedal pressure, which is the exact recipe for a hair
 * dryer: broadband air, flat envelope, no mechanism. What is here instead is the
 * one thing a drum/disc car of this era actually makes audible from the driver's
 * seat: a RUB. Pad dragged over a rotor — low-mid, narrow, dull, friction against
 * iron rather than air through a nozzle — amplitude-pulsed once per wheel
 * revolution, because no rotor is perfectly flat and no shoe sits perfectly even.
 * That per-revolution pulse is the single cue that says "brake" instead of "fan",
 * and it slows audibly as the car slows.
 *
 * There is deliberately NO SQUEAL voice. A pitched pad resonance was tried at
 * several frequencies and levels and never stopped sounding synthetic: a squeal is
 * a near-tone, and a near-tone that the simulation cannot make appear and vanish
 * for physical reasons (pad wear, moisture, temperature, none of which are
 * modelled) reads as a siren tied to the pedal. The rub alone carries the braking.
 *
 * The rub is suppressed as the wheels lock: a locked wheel is not rubbing, and the
 * tyre takes over the noise, so it hands off to the skid voice instead of stacking
 * on top of it.
 */
/** The rub exists between these speeds (m/s): it dies as the car stops. */
const BRAKE_MIN_MPS = 1.2;
const BRAKE_FULL_MPS = 6;

/** Pad rub: narrow (Q 6) low-mid friction, rising slightly with speed. */
const RUB_GAIN = 0.055;
const RUB_FREQ_SLOW = 420;
const RUB_FREQ_FAST = 780;
const RUB_Q = 6;
/**
 * Tone cap over the rub. Iron rubbing iron inside a wheel, behind a wheelarch, has
 * no content up where a hiss lives; the corner keeps the noise band's skirt out of
 * hair-dryer territory even at full pedal.
 */
const BRAKE_LP_HZ = 1900;

/**
 * Nominal loaded tyre radius (m) used only to turn road speed into a ROTOR RATE for
 * the per-revolution pulse. Every car in the catalogue sits within a few cm of this,
 * and the pulse is a rhythm cue, not a pitch — a 10% radius error is inaudible.
 */
const ROTOR_RADIUS_M = 0.31;
/** Pulse rate is clamped: below ~1.5 Hz it reads as a fault, above ~26 Hz as a tone. */
const ROTOR_RATE_MIN_HZ = 1.5;
const ROTOR_RATE_MAX_HZ = 26;
/** Depth of the per-revolution amplitude pulse, 0..1. */
const RUB_PULSE_DEPTH = 0.55;

const ENGINE_GAIN_IDLE = 0.11;
const ENGINE_GAIN_LOAD = 0.2;
/** Low-pass corner at closed and at wide-open throttle, Hz. */
const ENGINE_LP_CLOSED = 700;
const ENGINE_LP_OPEN = 5200;
/** Inside the car the engine is closer and the shell cuts the top end. */
const ENGINE_INTERIOR_GAIN = 1.15;
const ENGINE_INTERIOR_LP = 0.55;

/** Vertical speed (m/s) killed in one landing that counts as a full-strength thump. */
const LANDING_FULL_MPS = 6;

/** Slew for continuous voices. The engine tracks fast; ambience is lazier. */
const ENGINE_TAU = 0.03;
const DESTROYED_METAL_GAIN = 0.16;
const DESTROYED_METAL_FREQ_IDLE = 720;
const DESTROYED_METAL_FREQ_REV = 1650;
const AMBIENCE_TAU = 0.09;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export class VehicleAudio {
  private readonly out: GainNode;

  // Engine chain.
  private readonly fireOsc: OscillatorNode;
  private readonly bodyOsc: OscillatorNode;
  private readonly intakeFilter: BiquadFilterNode;
  private readonly intakeGain: GainNode;
  private readonly engineLowpass: BiquadFilterNode;
  private readonly engineGain: GainNode;
  private readonly destroyedMetalFilter: BiquadFilterNode;
  private readonly destroyedMetalGain: GainNode;

  // Ambience chains.
  private readonly windFilter: BiquadFilterNode;
  private readonly windLowpass: BiquadFilterNode;
  private readonly windGain: GainNode;
  private readonly tyreFilter: BiquadFilterNode;
  private readonly tyreGain: GainNode;
  private readonly skidFilter: BiquadFilterNode;
  private readonly skidGain: GainNode;
  private readonly rubFilter: BiquadFilterNode;
  private readonly rubGain: GainNode;
  /** Rotor-rate LFO driving the rub's per-revolution pulse. */
  private readonly rotorLfo: OscillatorNode;

  private readonly sources: AudioBufferSourceNode[] = [];

  private lastGearLabel = '';
  private wasRunning = false;
  private active = false;

  constructor(private readonly mixer: AudioMixer) {
    const ctx = mixer.ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(mixer.sfx);

    // --- engine -------------------------------------------------------------
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineLowpass = ctx.createBiquadFilter();
    this.engineLowpass.type = 'lowpass';
    this.engineLowpass.frequency.value = ENGINE_LP_CLOSED;
    this.engineLowpass.Q.value = 0.7;
    this.engineLowpass.connect(this.engineGain).connect(this.out);

    this.fireOsc = ctx.createOscillator();
    // A small falling harmonic series creates an exhaust-like pulse yet leaves
    // room for load-controlled induction noise. Raw sawtooths caused the former
    // abrasive, synthetic buzz at high rpm.
    const exhaustWave = ctx.createPeriodicWave(
      new Float32Array(7),
      new Float32Array([0, 1, 0.46, 0.2, 0.09, 0.04, 0.015]),
      { disableNormalization: false },
    );
    this.fireOsc.setPeriodicWave(exhaustWave);
    const fireGain = ctx.createGain();
    fireGain.gain.value = 0.62;
    this.fireOsc.connect(fireGain).connect(this.engineLowpass);

    // Lower combustion/body resonance prevents a small four-cylinder from
    // thinning out at idle and replaces the old octave saw's electronic buzz.
    this.bodyOsc = ctx.createOscillator();
    this.bodyOsc.type = 'sine';
    const bodyGain = ctx.createGain();
    bodyGain.gain.value = 0.34;
    this.bodyOsc.connect(bodyGain).connect(this.engineLowpass);

    this.intakeFilter = ctx.createBiquadFilter();
    this.intakeFilter.type = 'bandpass';
    this.intakeFilter.frequency.value = 400;
    this.intakeFilter.Q.value = 0.8;
    this.intakeGain = ctx.createGain();
    this.intakeGain.gain.value = 0;
    this.addNoise(this.intakeFilter);
    this.intakeFilter.connect(this.intakeGain).connect(this.engineLowpass);

    // A narrow, load-sensitive scrape/rattle layered over combustion when the
    // fitted engine has catastrophically damaged internals.
    this.destroyedMetalFilter = ctx.createBiquadFilter();
    this.destroyedMetalFilter.type = 'bandpass';
    this.destroyedMetalFilter.frequency.value = DESTROYED_METAL_FREQ_IDLE;
    this.destroyedMetalFilter.Q.value = 3.2;
    this.destroyedMetalGain = ctx.createGain();
    this.destroyedMetalGain.gain.value = 0;
    this.addNoise(this.destroyedMetalFilter);
    this.destroyedMetalFilter.connect(this.destroyedMetalGain).connect(this.out);

    this.fireOsc.start();
    this.bodyOsc.start();

    // --- wind ---------------------------------------------------------------
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'highpass';
    this.windFilter.frequency.value = WIND_HP_LOW;
    this.windFilter.Q.value = 0.4;
    this.windLowpass = ctx.createBiquadFilter();
    this.windLowpass.type = 'lowpass';
    this.windLowpass.frequency.value = WIND_LP_LOW;
    this.windLowpass.Q.value = 0.5;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    this.addNoise(this.windFilter);
    this.windFilter.connect(this.windLowpass).connect(this.windGain).connect(this.out);

    // --- tyre roll ----------------------------------------------------------
    this.tyreFilter = ctx.createBiquadFilter();
    this.tyreFilter.type = 'bandpass';
    this.tyreFilter.frequency.value = TYRE_FREQ_SMOOTH;
    this.tyreFilter.Q.value = 0.9;
    this.tyreGain = ctx.createGain();
    this.tyreGain.gain.value = 0;
    this.addNoise(this.tyreFilter);
    this.tyreFilter.connect(this.tyreGain).connect(this.out);

    // --- skid ---------------------------------------------------------------
    this.skidFilter = ctx.createBiquadFilter();
    this.skidFilter.type = 'bandpass';
    this.skidFilter.frequency.value = 1400;
    this.skidFilter.Q.value = 3.5;
    this.skidGain = ctx.createGain();
    this.skidGain.gain.value = 0;
    this.addNoise(this.skidFilter);
    this.skidFilter.connect(this.skidGain).connect(this.out);

    // --- brakes -------------------------------------------------------------
    // Tone cap over the rub: nothing from inside a wheel arrives with hiss on it.
    const brakeLowpass = ctx.createBiquadFilter();
    brakeLowpass.type = 'lowpass';
    brakeLowpass.frequency.value = BRAKE_LP_HZ;
    brakeLowpass.Q.value = 0.7;
    brakeLowpass.connect(this.out);

    // The rotor LFO is applied MULTIPLICATIVELY, through a tremolo stage inside the
    // rub's own path, so silence stays silent: modulating the level gain additively
    // would leak the pulse through a released pedal.
    this.rotorLfo = ctx.createOscillator();
    this.rotorLfo.type = 'sine';
    this.rotorLfo.frequency.value = ROTOR_RATE_MIN_HZ;

    const rubTremolo = ctx.createGain();
    rubTremolo.gain.value = 1;
    const rubDepth = ctx.createGain();
    rubDepth.gain.value = RUB_PULSE_DEPTH;
    this.rotorLfo.connect(rubDepth).connect(rubTremolo.gain);

    this.rubFilter = ctx.createBiquadFilter();
    this.rubFilter.type = 'bandpass';
    this.rubFilter.frequency.value = RUB_FREQ_SLOW;
    this.rubFilter.Q.value = RUB_Q;
    this.rubGain = ctx.createGain();
    this.rubGain.gain.value = 0;
    this.addNoise(this.rubFilter);
    this.rubFilter.connect(rubTremolo).connect(this.rubGain).connect(brakeLowpass);

    this.rotorLfo.start();
  }

  private addNoise(destination: AudioNode): void {
    const src = this.mixer.noiseSource();
    src.connect(destination);
    this.sources.push(src);
  }

  /**
   * Fades the whole car out (stepping out of it, or the car being destroyed) without
   * tearing the voices down: they cost nothing while silent and a re-entry is
   * instant.
   */
  setActive(active: boolean): void {
    if (this.active === active) return;
    this.active = active;
    ramp(this.out.gain, active ? 1 : 0, this.mixer.now, 0.12);
    if (!active) this.wasRunning = false;
  }

  /**
   * One update per rendered frame. `interior` is the in-car camera: it is the only
   * thing here that is a *view* concern, and it belongs in audio because what you
   * hear depends on whether the shell is between you and the noise.
   */
  update(state: VehicleAudioState, interior: boolean): void {
    if (!this.active) return;
    const now = this.mixer.now;

    // --- engine -------------------------------------------------------------
    // Firing frequency, floored so a stalled engine does not slide into DC.
    const fire = Math.max(12, (state.rpm / 60) * (state.cylinders / 2));
    const rpmSpan = Math.max(1, state.redlineRpm - state.idleRpm);
    const rev = clamp01((state.rpm - state.idleRpm) / rpmSpan);
    const load = clamp01(state.throttle);

    this.fireOsc.frequency.setTargetAtTime(fire, now, ENGINE_TAU);
    this.bodyOsc.frequency.setTargetAtTime(Math.max(20, fire * 0.5), now, ENGINE_TAU);
    this.intakeFilter.frequency.setTargetAtTime(220 + fire * 6, now, ENGINE_TAU);

    const lpBase = ENGINE_LP_CLOSED + (ENGINE_LP_OPEN - ENGINE_LP_CLOSED) * (0.35 * rev + 0.65 * load);
    this.engineLowpass.frequency.setTargetAtTime(
      interior ? lpBase * ENGINE_INTERIOR_LP : lpBase,
      now,
      ENGINE_TAU,
    );

    const running = state.engineRunning;
    const engineLevel = running
      ? (ENGINE_GAIN_IDLE + ENGINE_GAIN_LOAD * (0.45 * rev + 0.55 * load)) *
        (interior ? ENGINE_INTERIOR_GAIN : 1)
      : 0;
    ramp(this.engineGain.gain, engineLevel, now, ENGINE_TAU);
    ramp(this.intakeGain.gain, running ? 0.07 + 0.43 * load : 0, now, ENGINE_TAU);
    this.destroyedMetalFilter.frequency.setTargetAtTime(
      DESTROYED_METAL_FREQ_IDLE +
        (DESTROYED_METAL_FREQ_REV - DESTROYED_METAL_FREQ_IDLE) * rev,
      now,
      ENGINE_TAU,
    );
    ramp(
      this.destroyedMetalGain.gain,
      running && state.engineDestroyed
        ? DESTROYED_METAL_GAIN * (0.45 + 0.55 * load) * (interior ? 0.8 : 1)
        : 0,
      now,
      ENGINE_TAU,
    );
    // Induction is broadband turbulence, not a fixed-pitch whistle. The existing
    // load-controlled intake noise supplies it instead of an oscillator.

    // An engine that just came back to life (refuelled) gets a starter crank.
    if (running && !this.wasRunning) this.crank();
    this.wasRunning = running;

    // --- ambience -----------------------------------------------------------
    const speed = Math.abs(state.forwardMps);
    const windT = clamp01(speed / WIND_FULL_MPS);
    this.windFilter.frequency.setTargetAtTime(
      WIND_HP_LOW + (WIND_HP_HIGH - WIND_HP_LOW) * windT,
      now,
      AMBIENCE_TAU,
    );
    this.windLowpass.frequency.setTargetAtTime(
      WIND_LP_LOW + (WIND_LP_HIGH - WIND_LP_LOW) * windT,
      now,
      AMBIENCE_TAU,
    );
    ramp(this.windGain.gain, windT * windT * WIND_GAIN, now, AMBIENCE_TAU);

    const rough = clamp01(state.surfaceRoughness / ROUGHNESS_FULL);
    this.tyreFilter.frequency.setTargetAtTime(
      TYRE_FREQ_SMOOTH + (TYRE_FREQ_ROUGH - TYRE_FREQ_SMOOTH) * rough,
      now,
      AMBIENCE_TAU,
    );
    // Rough ground is louder as well as lower: more of the tyre is being hit.
    const rollT = clamp01(speed / TYRE_FULL_MPS);
    ramp(
      this.tyreGain.gain,
      rollT * TYRE_GAIN * (0.6 + 0.8 * rough) * state.wheelContactFraction * (interior ? 0.7 : 1),
      now,
      AMBIENCE_TAU,
    );

    // Two ways to make a tyre howl: dragging it sideways (lateral slip) or dragging
    // it flat with the wheel stopped. A no-ABS stop is the second one, and it makes
    // no lateral slip at all while the car is still going straight — so the louder
    // of the two drives the skid voice.
    const slipT = clamp01(
      (state.lateralSlipMps - SKID_START_MPS) / (SKID_FULL_MPS - SKID_START_MPS),
    );
    const lockT = Math.max(state.frontLockT, state.rearLockT);
    const skidT = Math.max(slipT, lockT);
    ramp(
      this.skidGain.gain,
      skidT * SKID_GAIN * state.wheelContactFraction * (interior ? 0.75 : 1),
      now,
      0.05,
    );

    // --- brakes -------------------------------------------------------------
    const brake = clamp01(state.brake + (state.handbrake ? 0.7 : 0));
    const moving = clamp01((speed - BRAKE_MIN_MPS) / (BRAKE_FULL_MPS - BRAKE_MIN_MPS));
    // Wheel revolutions per second: the rhythm the rub pulses at, so a car slowing
    // to a stop slows its brake noise down with it instead of holding one flat
    // band open.
    const rotorHz = Math.min(
      ROTOR_RATE_MAX_HZ,
      Math.max(ROTOR_RATE_MIN_HZ, speed / (2 * Math.PI * ROTOR_RADIUS_M)),
    );
    this.rotorLfo.frequency.setTargetAtTime(rotorHz, now, 0.12);

    // Locked wheels mean the pad has stopped rubbing and the tyre is doing the
    // noise: hand over to the skid voice rather than sounding both.
    const unlocked = 1 - lockT;

    // Pad rub, present whenever the pedal is down and the wheels still turn.
    this.rubFilter.frequency.setTargetAtTime(
      RUB_FREQ_SLOW + (RUB_FREQ_FAST - RUB_FREQ_SLOW) * moving,
      now,
      0.1,
    );
    ramp(
      this.rubGain.gain,
      brake * moving * unlocked * state.wheelContactFraction * RUB_GAIN * (interior ? 0.8 : 1),
      now,
      0.06,
    );

    // --- one-shots ----------------------------------------------------------
    if (state.gearLabel !== this.lastGearLabel) {
      if (this.lastGearLabel !== '') this.shiftClunk();
      this.lastGearLabel = state.gearLabel;
    }
    if (state.landingImpactMps > 0.6) this.landing(state.landingImpactMps);
  }

  /** Suspension bottoming out / wheels landing. Body thud plus a spring rattle. */
  private landing(impactMps: number): void {
    const strength = clamp01(impactMps / LANDING_FULL_MPS);
    this.mixer.burst(this.out, {
      gain: 0.25 + 0.5 * strength,
      frequency: 70 + 40 * strength,
      q: 0.7,
      decay: 0.1 + 0.12 * strength,
      type: 'lowpass',
    });
    this.mixer.burst(this.out, {
      gain: 0.12 * strength,
      frequency: 1800,
      q: 2,
      decay: 0.09,
    });
  }

  private shiftClunk(): void {
    this.mixer.burst(this.out, { gain: 0.1, frequency: 520, q: 1.6, decay: 0.05 });
    this.mixer.blip(this.out, { gain: 0.05, frequency: 180, endFrequency: 110, decay: 0.06 });
  }

  private crank(): void {
    this.mixer.burst(this.out, { gain: 0.18, frequency: 320, q: 1.2, decay: 0.35 });
    this.mixer.blip(this.out, { gain: 0.08, frequency: 90, endFrequency: 150, decay: 0.4, type: 'sawtooth' });
  }

  dispose(): void {
    for (const src of this.sources) src.stop();
    this.sources.length = 0;
    this.fireOsc.stop();
    this.bodyOsc.stop();
    this.rotorLfo.stop();
    this.out.disconnect();
  }
}
