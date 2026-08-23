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
 *  - Brakes. Pad hiss plus a high squeal that only exists while braking hard, and
 *    which fades out as the car stops, the way a real one does.
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

/** Brake squeal only exists between these speeds (m/s): it dies as the car stops. */
const SQUEAL_MIN_MPS = 1.2;
const SQUEAL_FULL_MPS = 6;
const SQUEAL_GAIN = 0.1;
const BRAKE_HISS_GAIN = 0.12;

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

  // Ambience chains.
  private readonly windFilter: BiquadFilterNode;
  private readonly windLowpass: BiquadFilterNode;
  private readonly windGain: GainNode;
  private readonly tyreFilter: BiquadFilterNode;
  private readonly tyreGain: GainNode;
  private readonly skidFilter: BiquadFilterNode;
  private readonly skidGain: GainNode;
  private readonly squealOsc: OscillatorNode;
  private readonly squealGain: GainNode;
  private readonly brakeHissGain: GainNode;

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
    const hiss = ctx.createBiquadFilter();
    hiss.type = 'bandpass';
    hiss.frequency.value = 3200;
    hiss.Q.value = 0.8;
    this.brakeHissGain = ctx.createGain();
    this.brakeHissGain.gain.value = 0;
    this.addNoise(hiss);
    hiss.connect(this.brakeHissGain).connect(this.out);

    this.squealOsc = ctx.createOscillator();
    this.squealOsc.type = 'triangle';
    this.squealOsc.frequency.value = 2350;
    this.squealGain = ctx.createGain();
    this.squealGain.gain.value = 0;
    this.squealOsc.connect(this.squealGain).connect(this.out);
    this.squealOsc.start();
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

    const brake = clamp01(state.brake + (state.handbrake ? 0.7 : 0));
    const squealT = clamp01((speed - SQUEAL_MIN_MPS) / (SQUEAL_FULL_MPS - SQUEAL_MIN_MPS));
    // Squeal rises as the car slows through the band and vanishes at a standstill:
    // it is the pad grabbing, not a siren tied to speed.
    ramp(this.squealGain.gain, brake * brake * squealT * (1 - 0.5 * windT) * SQUEAL_GAIN, now, 0.05);
    ramp(this.brakeHissGain.gain, brake * squealT * BRAKE_HISS_GAIN, now, 0.06);
    this.squealOsc.frequency.setTargetAtTime(2100 + 700 * squealT, now, 0.08);

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
    this.squealOsc.stop();
    this.out.disconnect();
  }
}
