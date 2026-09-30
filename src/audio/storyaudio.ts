/**
 * The two voices the ending cutscenes need and the world has no recording of: a
 * light aircraft's propeller and the sea.
 *
 * WHY SYNTHESISED. Both are CONTINUOUS numbers, not events: the propeller's blade
 * pass is the rpm, and surf is a swell that never repeats a take. That is the same
 * split audio/samples.ts describes for the engine — a recording can only step
 * between takes — and neither sound has a CC0 loop in the shipped set anyway, so
 * neither one adds a download here.
 *
 * WHERE THEY SIT. Both are voiced on `mixer.sfx`, not on `mixer.world` and not on
 * `mixer.car`:
 *
 *  - under `sfx` the master volume (and the pause mute) still applies, which is what
 *    a player expects of a cutscene he can hear;
 *  - NOT under `world`, because the story ducks the world bus while the plane is the
 *    subject (`GameAudio.setWorldLevel`) and the propeller must survive its own duck;
 *  - not under `car`, because there is no car being driven.
 *
 * Both are disposed with the cutscene that made them; nothing here holds a timer.
 */

import { AudioMixer, ramp } from './mixer';

/* ---- propeller ---- */

/** Rev range the blade pass spans, rpm: 0 at rest, 2700 flat out. */
const PROP_MAX_RPM = 2700;
/** Blades on the disc. The blade pass is `blades × rpm / 60`. */
const PROP_BLADES = 2;
/**
 * Detune of the second blade-pass oscillator, as a fraction. This is the beat: at
 * cruise it is about 0.9 Hz, the flutter that tells a live prop from a drone.
 */
const DETUNE = 0.011;
/** How fast the blade pass follows the throttle, seconds (time constant). */
const RPM_TAU = 0.11;
/** How fast the level follows, seconds. */
const LEVEL_TAU = 0.07;
/** Level of each layer at level 1. */
const BLADE_GAIN = 0.34;
const SECOND_BLADE_GAIN = 0.2;
const THRUM_GAIN = 0.3;
const AIR_GAIN = 0.26;
/** Flutter of the whole blade-pass bed: `1 ± FLUTTER_DEPTH`, at `FLUTTER_HZ`. */
const FLUTTER_DEPTH = 0.16;
const FLUTTER_HZ = 0.9;

export interface PropellerVoice {
  /** `rpmFraction` 0..1 of `2700` rpm (≈0.26 is idle); `level` 0..1, ~0.3 at idle. */
  set(rpmFraction: number, level: number): void;
  dispose(): void;
}

/**
 * A two-blade propeller: the blade pass and its harmonics through a low-pass that
 * opens with rpm, an engine thrum at half the blade pass, and pink noise band-passed
 * around the airflow the disc drags through it.
 */
export function createPropellerVoice(mixer: AudioMixer): PropellerVoice {
  const ctx = mixer.ctx;

  const master = ctx.createGain();
  master.gain.value = 0;
  master.connect(mixer.sfx);

  // Blade pass and harmonics. A sawtooth already carries every harmonic, so the
  // second oscillator is there for the BEAT, not for the spectrum.
  const blade = ctx.createOscillator();
  blade.type = 'sawtooth';
  const bladeSecond = ctx.createOscillator();
  bladeSecond.type = 'sawtooth';
  const thrum = ctx.createOscillator();
  thrum.type = 'square';

  const tone = ctx.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.value = 900;
  tone.Q.value = 0.7;

  const flutter = ctx.createGain();
  flutter.gain.value = 1;

  const bladeGain = ctx.createGain();
  bladeGain.gain.value = BLADE_GAIN;
  const secondGain = ctx.createGain();
  secondGain.gain.value = SECOND_BLADE_GAIN;
  const thrumGain = ctx.createGain();
  thrumGain.gain.value = THRUM_GAIN;

  blade.connect(bladeGain).connect(tone);
  bladeSecond.connect(secondGain).connect(tone);
  thrum.connect(thrumGain).connect(tone);
  tone.connect(flutter).connect(master);

  const flutterLfo = ctx.createOscillator();
  flutterLfo.type = 'sine';
  flutterLfo.frequency.value = FLUTTER_HZ;
  const flutterDepth = ctx.createGain();
  flutterDepth.gain.value = FLUTTER_DEPTH;
  flutterLfo.connect(flutterDepth).connect(flutter.gain);

  // Airflow: the roar of the slipstream the disc is pushing, not a hiss.
  const air = mixer.noiseSource('pink');
  const airBand = ctx.createBiquadFilter();
  airBand.type = 'bandpass';
  airBand.frequency.value = 700;
  airBand.Q.value = 0.8;
  const airGain = ctx.createGain();
  airGain.gain.value = 0;
  air.connect(airBand).connect(airGain).connect(master);

  const oscillators = [blade, bladeSecond, thrum, flutterLfo];
  for (const source of oscillators) source.start();
  let disposed = false;

  return {
    set(rpmFraction: number, level: number): void {
      if (disposed) return;
      const t = mixer.now;
      const f = rpmFraction < 0 ? 0 : rpmFraction > 1 ? 1 : rpmFraction;
      const l = level < 0 ? 0 : level > 1 ? 1 : level;
      const bladePass = PROP_BLADES * (PROP_MAX_RPM * f) / 60;
      blade.frequency.setTargetAtTime(Math.max(0.01, bladePass), t, RPM_TAU);
      // The second oscillator is detuned by a FRACTION, so the beat stays the same
      // proportion of the blade pass at every rpm rather than sliding with it.
      bladeSecond.frequency.setTargetAtTime(Math.max(0.01, bladePass * (1 + DETUNE)), t, RPM_TAU);
      thrum.frequency.setTargetAtTime(Math.max(0.01, bladePass * 0.5), t, RPM_TAU);
      // The blade tips pass the air at a fixed speed, so the blade-pass spectrum
      // hardly moves; what opens with rpm is the engine's own noise. Keep it close.
      tone.frequency.setTargetAtTime(700 + 1400 * f, t, RPM_TAU);
      airBand.frequency.setTargetAtTime(600 + 700 * f, t, RPM_TAU);
      airGain.gain.setTargetAtTime(AIR_GAIN * l, t, LEVEL_TAU);
      ramp(master.gain, l, t, LEVEL_TAU);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const source of oscillators) source.stop();
      air.stop();
      for (const source of oscillators) source.disconnect();
      air.disconnect();
      flutterDepth.disconnect();
      tone.disconnect();
      flutter.disconnect();
      bladeGain.disconnect();
      secondGain.disconnect();
      thrumGain.disconnect();
      airBand.disconnect();
      airGain.disconnect();
      master.disconnect();
    },
  };
}

/* ---- surf ---- */

/** Surf level follows its own swell, seconds. */
const SURF_TAU = 0.4;
/**
 * Swell clocks: period in seconds, and the depth of its sine against a base gain of
 * one. Three INCOMMENSURATE periods, so no two waves arrive alike — and none of them
 * is a whole multiple of another, which would have re-introduced the very pattern
 * the second and third are there to break.
 */
const SWELLS: readonly (readonly [number, number])[] = [
  [7.4, 0.22],
  [12.3, 0.16],
  [21.1, 0.3],
];
/** Layer levels at level 1. */
const BODY_GAIN = 0.5;
const RUMBLE_GAIN = 0.62;
const WASH_GAIN = 0.32;
/** Centre and swing of the wash band's own clock-driven brightness, Hz. */
const WASH_CENTRE_HZ = 620;
const WASH_SWING_HZ = 460;
/** The clock that drags the wash: the longest one (the last entry in `SWELLS`). */
const WASH_CLOCK = SWELLS.length - 1;

export interface SurfVoice {
  set(level: number): void;
  dispose(): void;
}

/**
 * The sea: a wide pink-noise body under a low-pass, brown noise for the low roll, and
 * a brighter band whose centre and level ride the same slow clocks — so the wave that
 * breaks louder and hissier than the swell it arrived on is the third clock's own
 * peak rather than an event anyone scheduled.
 */
export function createSurfVoice(mixer: AudioMixer): SurfVoice {
  const ctx = mixer.ctx;

  const master = ctx.createGain();
  master.gain.value = 0;
  master.connect(mixer.sfx);

  const swell = ctx.createGain();
  swell.gain.value = 1;
  swell.connect(master);

  const buffers: AudioBufferSourceNode[] = [];
  const clocks: OscillatorNode[] = [];

  // Body: a wide wash of air and broken water.
  const bodyLow = ctx.createBiquadFilter();
  bodyLow.type = 'lowpass';
  bodyLow.frequency.value = 820;
  bodyLow.Q.value = 0.5;
  const bodyGain = ctx.createGain();
  bodyGain.gain.value = BODY_GAIN;
  mixer.stereoNoise('pink', buffers).connect(bodyLow).connect(bodyGain).connect(swell);

  // Rumble: the water's own weight, and the ear of the beach.
  const rumbleSrc = mixer.noiseSource('brown');
  buffers.push(rumbleSrc);
  const rumbleLow = ctx.createBiquadFilter();
  rumbleLow.type = 'lowpass';
  rumbleLow.frequency.value = 150;
  rumbleLow.Q.value = 0.6;
  const rumbleGain = ctx.createGain();
  rumbleGain.gain.value = RUMBLE_GAIN;
  rumbleSrc.connect(rumbleLow).connect(rumbleGain).connect(swell);

  // Wash: the bright top of a breaking wave, brightened and lifted by the long clock.
  const washSrc = mixer.noiseSource('pink');
  buffers.push(washSrc);
  const washBand = ctx.createBiquadFilter();
  washBand.type = 'bandpass';
  washBand.frequency.value = WASH_CENTRE_HZ;
  washBand.Q.value = 0.55;
  const washGain = ctx.createGain();
  washGain.gain.value = WASH_GAIN;
  washSrc.connect(washBand).connect(washGain).connect(swell);

  SWELLS.forEach(([period, depth], index) => {
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 1 / period;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = depth;
    lfo.connect(lfoDepth);
    lfoDepth.connect(swell.gain);
    clocks.push(lfo);
    if (index === WASH_CLOCK) {
      // The longest clock does double duty: the biggest swell AND the brightest
      // wash, which is why the wave that breaks loudest is also the whitest.
      const washDepth = ctx.createGain();
      washDepth.gain.value = WASH_SWING_HZ;
      lfoDepth.connect(washDepth);
      washDepth.connect(washBand.frequency);
    }
  });
  // The swell clocks themselves are silent; only their sum is heard.
  for (const lfo of clocks) lfo.start();

  let disposed = false;
  return {
    set(level: number): void {
      if (disposed) return;
      ramp(master.gain, level < 0 ? 0 : level > 1 ? 1 : level, mixer.now, SURF_TAU);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const source of buffers) source.stop();
      for (const clock of clocks) clock.stop();
      for (const source of buffers) source.disconnect();
      for (const clock of clocks) clock.disconnect();
      bodyLow.disconnect();
      bodyGain.disconnect();
      rumbleLow.disconnect();
      rumbleGain.disconnect();
      washBand.disconnect();
      washGain.disconnect();
      swell.disconnect();
      master.disconnect();
    },
  };
}
