/**
 * The car you are driving, in sound. Everything is synthesised from the telemetry
 * the physics already produces (`VehicleAudioState`), so nothing can drift out of
 * sync with what the car is doing.
 *
 * PLACE. The car is not a point between your ears. Three sources sit on it: the
 * engine bay at the nose, the tailpipe at the tail, the tyres and body in the middle.
 * From the chase camera the exhaust is nearest and loudest; swing the camera round
 * and it moves. From the bonnet seat all of it arrives through a CABIN: a steel shell
 * that takes the top off everything outside (low-pass), booms at its own low
 * resonance, and makes the engine bay — a firewall away — louder relative to the
 * exhaust than it is from the street.
 *
 * VOICES
 *  - Engine: the per-firing worklet (engine-worklet.ts), tailpipe and bay separately.
 *  - Gearbox whine: a gear mesh at shaft speed times tooth count. Loudest in reverse
 *    (straight-cut) and first, nearly gone in the direct top gear, as in any
 *    rear-drive Soviet box; the final drive adds a quieter one that follows road speed.
 *  - Wind: stereo pink noise with gusts, against the car's AIR speed (the weather's
 *    wind included), plus low buffeting and, inside, a door-seal whistle.
 *  - Tyres: a low road roar with the tyre-cavity resonance (~220 Hz, the hum every
 *    driver knows), a tread hiss, and surface texture: stones and grit as sparse
 *    grains on loose ground, slab joints thumping front-then-rear on concrete, cracks
 *    on broken asphalt, a hiss of spray on a wet road.
 *  - Skid: on a hard surface a pitched, chirping squeal; on loose ground no squeal at
 *    all — a scrabble of stones and a roar instead.
 *  - Brakes: a low-mid pad rub pulsed once per wheel revolution (see below).
 *
 * One-shots: gear change, suspension jolts, landings, collisions, the starter.
 */

import { AUDIO_CONFIG } from '../config';
import { SurfaceType } from '../core/surfaces';
import type { VehicleAudioState } from '../vehicle/vehicle';
import { EngineVoice } from './enginevoice';
import { AudioMixer, ramp, setPannerPosition } from './mixer';

/** Where the listener is relative to the car. */
export type CarPerspective = 'cabin' | 'outside';

/** Everything about the car's place in the world the audio needs, per frame. */
export interface CarPose {
  x: number;
  y: number;
  z: number;
  /** Unit horizontal forward. */
  forwardX: number;
  forwardZ: number;
  /** Air speed over the body, m/s: road speed and the weather's wind combined. */
  airMps: number;
  /** Road wetness, 0..1. */
  wet: number;
}

const WIND_FULL_MPS = AUDIO_CONFIG.windFullMps;
const WIND_GAIN = AUDIO_CONFIG.windGain;
const TYRE_FULL_MPS = AUDIO_CONFIG.tyreFullMps;
const TYRE_GAIN = AUDIO_CONFIG.tyreGain;
const SKID_START_MPS = AUDIO_CONFIG.skidStartMps;
const SKID_FULL_MPS = AUDIO_CONFIG.skidFullMps;
const SKID_GAIN = AUDIO_CONFIG.skidGain;
const RUB_GAIN = AUDIO_CONFIG.rubGain;
const ENGINE_GAIN = AUDIO_CONFIG.engineGain;
const WHINE_GAIN = AUDIO_CONFIG.gearWhineGain;
const LANDING_FULL_MPS = AUDIO_CONFIG.landingFullMps;
const BUMP_START_MPS = AUDIO_CONFIG.bumpStartMps;
const BUMP_FULL_MPS = AUDIO_CONFIG.bumpFullMps;
const BUMP_GAIN = AUDIO_CONFIG.bumpGain;
const IMPACT_GAIN = AUDIO_CONFIG.impactGain;

/** Surface roughness (metres of micro-bump) treated as fully rough. */
const ROUGHNESS_FULL = 0.05;

/**
 * What each surface sounds like under a rolling tyre, relative to smooth asphalt.
 *  roar     low road roar
 *  hiss     tread hiss level, and its band centre
 *  grit     sparse grains (stones, grit) level, and their band centre
 *  squeal   whether a sliding tyre sings here (hard, dry surfaces) or scrabbles
 *  joints   slab joints (concrete) or random cracks (broken asphalt)
 */
interface SurfaceVoice {
  roar: number;
  hiss: number;
  hissHz: number;
  grit: number;
  gritHz: number;
  squeal: boolean;
  joints: 'slab' | 'crack' | null;
}

const SURFACE_VOICES: Record<SurfaceType, SurfaceVoice> = {
  [SurfaceType.Asphalt]: { roar: 1, hiss: 1, hissHz: 1000, grit: 0, gritHz: 2500, squeal: true, joints: null },
  [SurfaceType.CrackedAsphalt]: { roar: 1.25, hiss: 0.9, hissHz: 850, grit: 0.12, gritHz: 2200, squeal: true, joints: 'crack' },
  [SurfaceType.Gravel]: { roar: 1.1, hiss: 0.6, hissHz: 650, grit: 1, gritHz: 2600, squeal: false, joints: null },
  [SurfaceType.Sand]: { roar: 0.55, hiss: 0.8, hissHz: 420, grit: 0.25, gritHz: 1300, squeal: false, joints: null },
  [SurfaceType.Rock]: { roar: 1.5, hiss: 0.5, hissHz: 700, grit: 0.55, gritHz: 1700, squeal: true, joints: null },
  [SurfaceType.Concrete]: { roar: 1.1, hiss: 1.15, hissHz: 1250, grit: 0, gritHz: 2500, squeal: true, joints: 'slab' },
  [SurfaceType.LooseShoulder]: { roar: 1.2, hiss: 0.5, hissHz: 600, grit: 1.3, gritHz: 2300, squeal: false, joints: null },
};

/** Concrete slab length, metres: the ta-dum, ta-dum period. */
const SLAB_M = 6.2;
/** Front-to-rear axle distance used to time the second thump of a joint. */
const WHEELBASE_M = 2.45;

/**
 * Brakes.
 *
 * A braking car does NOT hiss: a wide noise band held open by the pedal is a hair
 * dryer. What a drum/disc car of this era makes audible from the driver's seat is a
 * RUB — pad over rotor, low-mid, narrow, amplitude-pulsed once per wheel revolution
 * because no rotor is perfectly flat. There is deliberately no pitched squeal: a
 * squeal tied to the pedal, with nothing physical making it come and go, reads as a
 * siren. The rub hands over to the skid voice as the wheels lock.
 */
const BRAKE_MIN_MPS = 1.2;
const BRAKE_FULL_MPS = 6;
const RUB_FREQ_SLOW = 420;
const RUB_FREQ_FAST = 780;
const RUB_Q = 6;
const BRAKE_LP_HZ = 1900;
/** Nominal loaded tyre radius (m), only for the per-revolution pulse rate. */
const ROTOR_RADIUS_M = 0.31;
const ROTOR_RATE_MIN_HZ = 1.5;
const ROTOR_RATE_MAX_HZ = 26;
const RUB_PULSE_DEPTH = 0.55;

/**
 * Gear mesh: layshaft teeth the input shaft's speed is multiplied by, and the whine
 * level per gear. Reverse is a straight-cut idler and sings; the top gear is direct
 * drive and the layshaft carries no load.
 */
const GEAR_MESH_TEETH = 21;
const FINAL_DRIVE_MESH = 41;
const GEAR_WHINE: Record<string, number> = { R: 1, N: 0, '1': 0.55, '2': 0.34, '3': 0.2, '4': 0.07, '5': 0.1 };

/** Cabin: corner of the shell's low-pass, and its low boom. */
const CABIN_LP_HZ = 2300;
const OUTSIDE_LP_HZ = 16000;
const CABIN_BOOM_DB = 5;

/** Source offsets along the car, metres from the root. */
const NOSE_M = 1.4;
const TAIL_M = -2.0;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export class VehicleAudio {
  private readonly out: GainNode;
  private readonly cabinLowpass: BiquadFilterNode;
  private readonly cabinBoom: BiquadFilterNode;
  private readonly nose: PannerNode;
  private readonly body: PannerNode;
  private readonly tail: PannerNode;
  /** One-shots land here: the body panner, through the cabin. */
  private readonly impacts: GainNode;

  private readonly engine: EngineVoice;
  private readonly exhaustGain: GainNode;
  private readonly bayGain: GainNode;

  private readonly whineOsc: OscillatorNode;
  private readonly whineGain: GainNode;
  private readonly diffOsc: OscillatorNode;
  private readonly diffGain: GainNode;

  private readonly windHighpass: BiquadFilterNode;
  private readonly windLowpass: BiquadFilterNode;
  private readonly windGain: GainNode;
  private readonly buffetGain: GainNode;
  private readonly sealFilter: BiquadFilterNode;
  private readonly sealGain: GainNode;

  private readonly roarGain: GainNode;
  private readonly hissFilter: BiquadFilterNode;
  private readonly hissGain: GainNode;
  private readonly gritSource: AudioBufferSourceNode;
  private readonly gritFilter: BiquadFilterNode;
  private readonly gritGain: GainNode;
  private readonly sprayGain: GainNode;

  private readonly squealA: BiquadFilterNode;
  private readonly squealB: BiquadFilterNode;
  private readonly squealGain: GainNode;
  private readonly scrabbleGain: GainNode;
  private readonly scrabbleSource: AudioBufferSourceNode;

  private readonly rubFilter: BiquadFilterNode;
  private readonly rubGain: GainNode;
  private readonly rotorLfo: OscillatorNode;

  private readonly sources: AudioBufferSourceNode[] = [];

  private lastGearLabel = '';
  private wasRunning = false;
  private active = false;
  private perspective: CarPerspective = 'outside';
  private jointAccumM = 0;
  private nextCrackM = 8;
  private lastBumpAt = 0;
  private gustPhase = Math.random() * 100;
  private squealWander = 0;

  constructor(private readonly mixer: AudioMixer) {
    const ctx = mixer.ctx;

    // --- places and the cabin ---------------------------------------------------
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.cabinLowpass = ctx.createBiquadFilter();
    this.cabinLowpass.type = 'lowpass';
    this.cabinLowpass.frequency.value = OUTSIDE_LP_HZ;
    this.cabinLowpass.Q.value = 0.6;
    this.cabinBoom = ctx.createBiquadFilter();
    this.cabinBoom.type = 'peaking';
    this.cabinBoom.frequency.value = 78;
    this.cabinBoom.Q.value = 1.1;
    this.cabinBoom.gain.value = 0;
    this.out.connect(this.cabinLowpass).connect(this.cabinBoom).connect(mixer.sfx);

    const panner = (): PannerNode => {
      const p = new PannerNode(ctx, {
        panningModel: 'equalpower',
        distanceModel: 'inverse',
        refDistance: 6,
        rolloffFactor: 1,
        maxDistance: 400,
      });
      p.connect(this.out);
      return p;
    };
    this.nose = panner();
    this.body = panner();
    this.tail = panner();
    this.impacts = ctx.createGain();
    this.impacts.connect(this.body);

    // --- engine -----------------------------------------------------------------
    this.engine = new EngineVoice(mixer);
    this.exhaustGain = ctx.createGain();
    this.exhaustGain.gain.value = 0;
    this.bayGain = ctx.createGain();
    this.bayGain.gain.value = 0;
    this.engine.exhaust.connect(this.exhaustGain).connect(this.tail);
    this.engine.bay.connect(this.bayGain).connect(this.nose);

    // --- gearbox ----------------------------------------------------------------
    // A mesh whine is not a pure sine: a little second harmonic and a slow flutter
    // (tooth-to-tooth error) keep it mechanical.
    const whineWave = ctx.createPeriodicWave(new Float32Array([0, 0, 0, 0]), new Float32Array([0, 1, 0.22, 0.06]));
    this.whineOsc = ctx.createOscillator();
    this.whineOsc.setPeriodicWave(whineWave);
    this.whineGain = ctx.createGain();
    this.whineGain.gain.value = 0;
    this.whineOsc.connect(this.whineGain).connect(this.nose);
    this.diffOsc = ctx.createOscillator();
    this.diffOsc.setPeriodicWave(whineWave);
    this.diffGain = ctx.createGain();
    this.diffGain.gain.value = 0;
    this.diffOsc.connect(this.diffGain).connect(this.tail);
    this.whineOsc.start();
    this.diffOsc.start();

    // --- wind -------------------------------------------------------------------
    // Stereo and unpanned: moving air is all round you, not at a point on the car.
    this.windHighpass = ctx.createBiquadFilter();
    this.windHighpass.type = 'highpass';
    this.windHighpass.frequency.value = 120;
    this.windHighpass.Q.value = 0.5;
    this.windLowpass = ctx.createBiquadFilter();
    this.windLowpass.type = 'lowpass';
    this.windLowpass.frequency.value = 2400;
    this.windLowpass.Q.value = 0.5;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    mixer.stereoNoise('pink', this.sources).connect(this.windHighpass);
    this.windHighpass.connect(this.windLowpass).connect(this.windGain).connect(this.out);

    // Buffeting: the low, uneven pressure the body sheds at speed.
    const buffetFilter = ctx.createBiquadFilter();
    buffetFilter.type = 'lowpass';
    buffetFilter.frequency.value = 85;
    buffetFilter.Q.value = 0.9;
    this.buffetGain = ctx.createGain();
    this.buffetGain.gain.value = 0;
    this.addNoise('brown', buffetFilter);
    buffetFilter.connect(this.buffetGain).connect(this.out);

    // A door seal that does not quite seal: a narrow, wandering whistle.
    this.sealFilter = ctx.createBiquadFilter();
    this.sealFilter.type = 'bandpass';
    this.sealFilter.frequency.value = 1300;
    this.sealFilter.Q.value = 16;
    this.sealGain = ctx.createGain();
    this.sealGain.gain.value = 0;
    this.addNoise('pink', this.sealFilter);
    this.sealFilter.connect(this.sealGain).connect(this.out);

    // --- tyres ------------------------------------------------------------------
    const roarLow = ctx.createBiquadFilter();
    roarLow.type = 'lowpass';
    roarLow.frequency.value = 420;
    roarLow.Q.value = 0.6;
    const cavity = ctx.createBiquadFilter();
    cavity.type = 'peaking';
    cavity.frequency.value = 222;
    cavity.Q.value = 3;
    cavity.gain.value = 9;
    this.roarGain = ctx.createGain();
    this.roarGain.gain.value = 0;
    this.addNoise('pink', roarLow);
    roarLow.connect(cavity).connect(this.roarGain).connect(this.body);

    this.hissFilter = ctx.createBiquadFilter();
    this.hissFilter.type = 'bandpass';
    this.hissFilter.frequency.value = 1000;
    this.hissFilter.Q.value = 0.8;
    this.hissGain = ctx.createGain();
    this.hissGain.gain.value = 0;
    this.addNoise('pink', this.hissFilter);
    this.hissFilter.connect(this.hissGain).connect(this.body);

    this.gritSource = mixer.crackleSource();
    this.sources.push(this.gritSource);
    this.gritFilter = ctx.createBiquadFilter();
    this.gritFilter.type = 'bandpass';
    this.gritFilter.frequency.value = 2500;
    this.gritFilter.Q.value = 0.9;
    this.gritGain = ctx.createGain();
    this.gritGain.gain.value = 0;
    this.gritSource.connect(this.gritFilter).connect(this.gritGain).connect(this.body);

    const sprayHigh = ctx.createBiquadFilter();
    sprayHigh.type = 'highpass';
    sprayHigh.frequency.value = 2200;
    sprayHigh.Q.value = 0.5;
    const sprayLow = ctx.createBiquadFilter();
    sprayLow.type = 'lowpass';
    sprayLow.frequency.value = 9000;
    this.sprayGain = ctx.createGain();
    this.sprayGain.gain.value = 0;
    this.addNoise('white', sprayHigh);
    sprayHigh.connect(sprayLow).connect(this.sprayGain).connect(this.body);

    // --- skid -------------------------------------------------------------------
    // Two narrow bands a little apart, wandering independently: a rubber squeal is
    // a stick-slip near-tone that never holds one pitch.
    this.squealGain = ctx.createGain();
    this.squealGain.gain.value = 0;
    this.squealA = ctx.createBiquadFilter();
    this.squealA.type = 'bandpass';
    this.squealA.frequency.value = 900;
    this.squealA.Q.value = 10;
    this.squealB = ctx.createBiquadFilter();
    this.squealB.type = 'bandpass';
    this.squealB.frequency.value = 1350;
    this.squealB.Q.value = 14;
    this.addNoise('pink', this.squealA);
    this.addNoise('pink', this.squealB);
    const squealSum = ctx.createGain();
    squealSum.gain.value = 3.2;
    this.squealA.connect(squealSum);
    this.squealB.connect(squealSum);
    squealSum.connect(this.squealGain).connect(this.body);

    // Loose ground: stones thrown and a low roar, no tone.
    this.scrabbleSource = mixer.crackleSource();
    this.sources.push(this.scrabbleSource);
    const scrabbleFilter = ctx.createBiquadFilter();
    scrabbleFilter.type = 'bandpass';
    scrabbleFilter.frequency.value = 1700;
    scrabbleFilter.Q.value = 0.6;
    const scrabbleRoar = ctx.createBiquadFilter();
    scrabbleRoar.type = 'lowpass';
    scrabbleRoar.frequency.value = 260;
    this.addNoise('brown', scrabbleRoar);
    this.scrabbleGain = ctx.createGain();
    this.scrabbleGain.gain.value = 0;
    this.scrabbleSource.connect(scrabbleFilter).connect(this.scrabbleGain);
    scrabbleRoar.connect(this.scrabbleGain);
    this.scrabbleGain.connect(this.body);

    // --- brakes -----------------------------------------------------------------
    const brakeLowpass = ctx.createBiquadFilter();
    brakeLowpass.type = 'lowpass';
    brakeLowpass.frequency.value = BRAKE_LP_HZ;
    brakeLowpass.Q.value = 0.7;
    brakeLowpass.connect(this.body);
    // Multiplicative tremolo so silence stays silent with the pedal up.
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
    this.addNoise('white', this.rubFilter);
    this.rubFilter.connect(rubTremolo).connect(this.rubGain).connect(brakeLowpass);
    this.rotorLfo.start();
  }

  private addNoise(colour: 'white' | 'pink' | 'brown', destination: AudioNode): void {
    const src = this.mixer.noiseSource(colour);
    src.connect(destination);
    this.sources.push(src);
  }

  /**
   * Fades the whole car out (stepping out of it, or the car being destroyed) without
   * tearing the voices down: they cost little while silent and a re-entry is instant.
   */
  setActive(active: boolean): void {
    if (this.active === active) return;
    this.active = active;
    ramp(this.out.gain, active ? 1 : 0, this.mixer.now, 0.12);
    if (!active) this.wasRunning = false;
  }

  /** Cabin (bonnet camera) or outside (chase). Crossfades the shell's filtering. */
  setPerspective(perspective: CarPerspective): void {
    if (this.perspective === perspective) return;
    this.perspective = perspective;
    const now = this.mixer.now;
    const cabin = perspective === 'cabin';
    this.cabinLowpass.frequency.setTargetAtTime(cabin ? CABIN_LP_HZ : OUTSIDE_LP_HZ, now, 0.08);
    this.cabinBoom.gain.setTargetAtTime(cabin ? CABIN_BOOM_DB : 0, now, 0.08);
  }

  /** One update per rendered frame. */
  update(state: VehicleAudioState, pose: CarPose, dt: number): void {
    // Events are consumed whether or not they are voiced, so none is heard late.
    const bump = state.bumpMps;
    const landing = state.landingImpactMps;
    const impact = state.impactMps;
    state.bumpMps = 0;
    state.landingImpactMps = 0;
    state.impactMps = 0;
    if (!this.active) return;
    const now = this.mixer.now;
    const cabin = this.perspective === 'cabin';

    this.placeSources(pose, now);

    // --- engine -----------------------------------------------------------------
    this.engine.update(state);
    if (state.engineRunning && !this.wasRunning) this.engine.crank();
    this.wasRunning = state.engineRunning;
    // Through the cabin the bay is a firewall away and the tailpipe three metres
    // behind a closed boot; from outside the tailpipe dominates.
    ramp(this.exhaustGain.gain, ENGINE_GAIN * (cabin ? 0.75 : 1), now, 0.08);
    ramp(this.bayGain.gain, ENGINE_GAIN * (cabin ? 1.3 : 0.65), now, 0.08);

    const speed = Math.abs(state.forwardMps);
    const load = clamp01(state.throttle);

    // --- gearbox ----------------------------------------------------------------
    const whineLevel = GEAR_WHINE[state.gearLabel] ?? 0.1;
    const shaftHz = state.rpm / 60;
    this.whineOsc.frequency.setTargetAtTime(Math.max(20, shaftHz * GEAR_MESH_TEETH), now, 0.03);
    // Whine rides on torque through the mesh: drive or engine braking, not coasting.
    const torque = state.engineRunning ? 0.35 + 0.65 * load : 0;
    ramp(this.whineGain.gain, WHINE_GAIN * whineLevel * torque * clamp01(speed / 2), now, 0.06);
    const wheelHz = speed / (2 * Math.PI * ROTOR_RADIUS_M);
    this.diffOsc.frequency.setTargetAtTime(Math.max(20, wheelHz * FINAL_DRIVE_MESH), now, 0.05);
    ramp(this.diffGain.gain, WHINE_GAIN * 0.35 * clamp01(speed / 25) * (0.4 + 0.6 * load), now, 0.1);

    // --- wind -------------------------------------------------------------------
    this.gustPhase += dt;
    const gust =
      0.8 + 0.12 * Math.sin(this.gustPhase * 0.9) + 0.08 * Math.sin(this.gustPhase * 2.3 + 1.7);
    const air = Math.max(0, pose.airMps);
    const windT = clamp01(air / WIND_FULL_MPS);
    this.windHighpass.frequency.setTargetAtTime(110 + 380 * windT, now, 0.1);
    this.windLowpass.frequency.setTargetAtTime((cabin ? 1400 : 2600) + 2200 * windT, now, 0.1);
    ramp(this.windGain.gain, windT * windT * WIND_GAIN * gust * (cabin ? 0.6 : 1), now, 0.12);
    ramp(this.buffetGain.gain, windT * windT * WIND_GAIN * 1.6 * (cabin ? 1 : 0.35) * gust, now, 0.12);
    const sealT = clamp01((air - 18) / 20);
    this.sealFilter.frequency.setTargetAtTime(1150 + 500 * sealT + 90 * Math.sin(this.gustPhase * 0.6), now, 0.2);
    ramp(this.sealGain.gain, cabin ? sealT * sealT * WIND_GAIN * 0.45 * gust : 0, now, 0.2);

    // --- tyres ------------------------------------------------------------------
    const voice = SURFACE_VOICES[state.surface] ?? SURFACE_VOICES[SurfaceType.Asphalt];
    const contact = state.wheelContactFraction;
    const rough = clamp01(state.surfaceRoughness / ROUGHNESS_FULL);
    const rollT = clamp01(speed / TYRE_FULL_MPS);
    ramp(
      this.roarGain.gain,
      TYRE_GAIN * 0.9 * rollT ** 1.3 * voice.roar * (0.7 + 0.6 * rough) * contact * (cabin ? 1.3 : 1),
      now,
      0.09,
    );
    this.hissFilter.frequency.setTargetAtTime(voice.hissHz * (0.8 + 0.4 * rollT), now, 0.1);
    ramp(this.hissGain.gain, TYRE_GAIN * 0.8 * rollT * rollT * voice.hiss * contact, now, 0.09);
    // Grain density and brightness both follow speed: the stones come faster.
    this.gritSource.playbackRate.setTargetAtTime(0.35 + speed / 9, now, 0.1);
    this.gritFilter.frequency.setTargetAtTime(voice.gritHz * (0.85 + 0.3 * rollT), now, 0.1);
    ramp(this.gritGain.gain, TYRE_GAIN * 1.4 * voice.grit * clamp01(speed / 12) * contact, now, 0.08);
    // Spray: a wet road is a hiss that swamps everything else the tyre does.
    const wetRoad = voice.squeal ? pose.wet : pose.wet * 0.4;
    ramp(this.sprayGain.gain, TYRE_GAIN * 1.1 * wetRoad * rollT ** 1.5 * contact, now, 0.15);

    this.joints(voice, speed, dt, contact);

    // --- skid -------------------------------------------------------------------
    const slipT = clamp01((state.lateralSlipMps - SKID_START_MPS) / (SKID_FULL_MPS - SKID_START_MPS));
    const lockT = Math.max(state.frontLockT, state.rearLockT);
    const skidT = Math.max(slipT, lockT) * contact;
    // Wet rubber barely sings.
    const squeal = voice.squeal ? skidT * (1 - 0.75 * pose.wet) : 0;
    this.squealWander += dt;
    const base = (720 + 380 * slipT) * (1 + 0.05 * Math.sin(this.squealWander * 7.3));
    this.squealA.frequency.setTargetAtTime(base * (0.96 + Math.random() * 0.08), now, 0.025);
    this.squealB.frequency.setTargetAtTime(base * 1.52 * (0.95 + Math.random() * 0.1), now, 0.03);
    // Stick-slip: the squeal chatters in level as well as pitch.
    ramp(this.squealGain.gain, SKID_GAIN * squeal * (0.75 + 0.25 * Math.random()), now, 0.03);
    this.scrabbleSource.playbackRate.setTargetAtTime(0.6 + speed / 6, now, 0.05);
    ramp(this.scrabbleGain.gain, voice.squeal ? 0 : SKID_GAIN * 0.9 * skidT, now, 0.05);

    // --- brakes -----------------------------------------------------------------
    const brake = clamp01(state.brake + (state.handbrake ? 0.7 : 0));
    const moving = clamp01((speed - BRAKE_MIN_MPS) / (BRAKE_FULL_MPS - BRAKE_MIN_MPS));
    const rotorHz = Math.min(ROTOR_RATE_MAX_HZ, Math.max(ROTOR_RATE_MIN_HZ, wheelHz));
    this.rotorLfo.frequency.setTargetAtTime(rotorHz, now, 0.12);
    this.rubFilter.frequency.setTargetAtTime(RUB_FREQ_SLOW + (RUB_FREQ_FAST - RUB_FREQ_SLOW) * moving, now, 0.1);
    ramp(this.rubGain.gain, brake * moving * (1 - lockT) * contact * RUB_GAIN, now, 0.06);

    // --- one-shots --------------------------------------------------------------
    if (state.gearLabel !== this.lastGearLabel) {
      if (this.lastGearLabel !== '') this.shiftClunk();
      this.lastGearLabel = state.gearLabel;
    }
    if (landing > 0.6) this.landing(landing);
    else if (bump > BUMP_START_MPS && now - this.lastBumpAt > 0.07) {
      this.lastBumpAt = now;
      this.bump(bump, voice);
    }
    if (impact > 0.3) this.crash(impact);
  }

  private placeSources(pose: CarPose, now: number): void {
    const { x, y, z, forwardX: fx, forwardZ: fz } = pose;
    setPannerPosition(this.nose, x + fx * NOSE_M, y, z + fz * NOSE_M, now, 0.02);
    setPannerPosition(this.body, x, y, z, now, 0.02);
    setPannerPosition(this.tail, x + fx * TAIL_M, y - 0.2, z + fz * TAIL_M, now, 0.02);
  }

  /** Slab joints and cracks: distance-driven, one thump per axle. */
  private joints(voice: SurfaceVoice, speed: number, dt: number, contact: number): void {
    if (voice.joints === null || speed < 2 || contact < 0.5) {
      this.jointAccumM = 0;
      return;
    }
    this.jointAccumM += speed * dt;
    const period = voice.joints === 'slab' ? SLAB_M : this.nextCrackM;
    if (this.jointAccumM < period) return;
    this.jointAccumM -= period;
    if (voice.joints === 'crack') this.nextCrackM = 3 + Math.random() * 14;
    const strength = clamp01(speed / 25) * (voice.joints === 'slab' ? 1 : 0.4 + Math.random() * 0.8);
    const axleGap = WHEELBASE_M / Math.max(1, speed);
    for (const delay of [0, axleGap]) {
      this.mixer.burst(this.impacts, {
        gain: BUMP_GAIN * 0.55 * strength,
        frequency: 95 + 30 * strength,
        q: 0.8,
        decay: 0.07,
        type: 'lowpass',
        colour: 'brown',
        delay,
      });
      this.mixer.burst(this.impacts, {
        gain: BUMP_GAIN * 0.12 * strength,
        frequency: 1100,
        q: 1.4,
        decay: 0.025,
        delay,
      });
    }
  }

  /** A jolt through the springs: a thud, a rattle of the suspension, a clunk if hard. */
  private bump(joltMps: number, voice: SurfaceVoice): void {
    const s = clamp01((joltMps - BUMP_START_MPS) / (BUMP_FULL_MPS - BUMP_START_MPS));
    this.mixer.burst(this.impacts, {
      gain: BUMP_GAIN * (0.25 + 0.75 * s),
      frequency: 80 + 60 * s,
      q: 0.8,
      decay: 0.08 + 0.1 * s,
      type: 'lowpass',
      colour: 'brown',
    });
    // Loose ground adds a spatter of stones.
    if (voice.grit > 0.5) {
      this.mixer.burst(this.impacts, {
        gain: BUMP_GAIN * 0.25 * s * voice.grit,
        frequency: voice.gritHz,
        q: 0.9,
        decay: 0.06,
        delay: 0.01,
      });
    }
    this.mixer.burst(this.impacts, {
      gain: BUMP_GAIN * 0.18 * s,
      frequency: 1900 + 600 * Math.random(),
      q: 3,
      decay: 0.05,
      delay: 0.015,
    });
    if (s > 0.6) {
      // Bump stop: rubber and a steel cup, a dull knock with a short ring.
      this.mixer.blip(this.impacts, { gain: BUMP_GAIN * 0.1 * s, frequency: 310, endFrequency: 240, decay: 0.09, type: 'sine', delay: 0.02 });
    }
  }

  /** Suspension bottoming out / wheels landing. Body thud plus a spring rattle. */
  private landing(impactMps: number): void {
    const strength = clamp01(impactMps / LANDING_FULL_MPS);
    this.mixer.burst(this.impacts, {
      gain: 0.3 + 0.55 * strength,
      frequency: 70 + 40 * strength,
      q: 0.7,
      decay: 0.12 + 0.14 * strength,
      type: 'lowpass',
      colour: 'brown',
    });
    this.mixer.burst(this.impacts, { gain: 0.12 * strength, frequency: 1800, q: 2, decay: 0.09, delay: 0.02 });
    this.mixer.blip(this.impacts, { gain: 0.05 * strength, frequency: 420, endFrequency: 300, decay: 0.15, type: 'sine', delay: 0.01 });
  }

  /**
   * A collision. Sheet steel does three things when it is hit: the body takes a
   * low blow, the panel crumples (a spray of short mid-band crunches, not one), and
   * the undamaged metal around it rings at inharmonic plate modes. A hard enough hit
   * breaks glass.
   */
  private crash(severityMps: number): void {
    const s = clamp01(severityMps / 8);
    const gain = IMPACT_GAIN * (0.25 + 0.75 * s);
    this.mixer.burst(this.impacts, {
      gain: gain * 0.9,
      frequency: 140,
      endFrequency: 55,
      q: 0.7,
      decay: 0.18 + 0.2 * s,
      type: 'lowpass',
      colour: 'brown',
      send: 0.2,
    });
    const crunches = 2 + Math.floor(s * 5);
    for (let i = 0; i < crunches; i++) {
      this.mixer.burst(this.impacts, {
        gain: gain * (0.35 + 0.3 * Math.random()),
        frequency: 450 + Math.random() * 1400,
        q: 1 + Math.random() * 1.5,
        decay: 0.04 + Math.random() * 0.08,
        delay: Math.random() * (0.03 + 0.09 * s),
        send: 0.15,
      });
    }
    const plate = 260 + Math.random() * 280;
    for (const [ratio, level, decay] of [[1, 0.1, 0.5], [2.76, 0.06, 0.35], [5.4, 0.035, 0.22], [8.9, 0.02, 0.14]] as const) {
      this.mixer.blip(this.impacts, {
        gain: gain * level * (0.5 + s),
        frequency: plate * ratio,
        endFrequency: plate * ratio * 0.985,
        decay: decay * (0.6 + 0.8 * s),
        type: 'sine',
        delay: 0.004,
        send: 0.2,
      });
    }
    if (s > 0.5) {
      const shards = 4 + Math.floor(s * 8);
      for (let i = 0; i < shards; i++) {
        this.mixer.burst(this.impacts, {
          gain: gain * 0.22 * Math.random(),
          frequency: 4200 + Math.random() * 4000,
          q: 2 + Math.random() * 3,
          decay: 0.02 + Math.random() * 0.05,
          delay: 0.02 + Math.random() * 0.35,
        });
      }
    }
  }

  /** Lever through the gate, then the driveline taking up the slack. */
  private shiftClunk(): void {
    this.mixer.burst(this.impacts, { gain: 0.05, frequency: 2300, q: 3, decay: 0.03 });
    this.mixer.burst(this.impacts, { gain: 0.07, frequency: 520, q: 1.6, decay: 0.05, delay: 0.03 });
    this.mixer.burst(this.impacts, { gain: 0.1, frequency: 130, q: 0.8, decay: 0.08, type: 'lowpass', colour: 'brown', delay: 0.09 });
  }

  dispose(): void {
    for (const src of this.sources) src.stop();
    this.sources.length = 0;
    this.engine.dispose();
    this.whineOsc.stop();
    this.diffOsc.stop();
    this.rotorLfo.stop();
    this.out.disconnect();
  }
}
