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
 * exhaust than it is from the street. Outside, the car stands on a road with verges,
 * a ditch and a body of its own, and a few early reflections off them are what put
 * it in the air instead of inside the listener's head.
 *
 * VOICES
 *  - Engine: the per-firing worklet (engine-worklet.ts), tailpipe and bay separately.
 *  - Gearbox whine: a gear mesh at shaft speed times tooth count. Loudest in reverse
 *    (straight-cut) and first, nearly gone in the direct top gear, as in any
 *    rear-drive Soviet box; the final drive adds a quieter one that follows road speed.
 *  - Wind: stereo pink noise with gusts, against the car's AIR speed (the weather's
 *    wind included), plus low buffeting and, inside, a door-seal whistle.
 *  - Tyres: a low road roar with the tyre-cavity resonance (~220 Hz, the hum every
 *    driver knows), the tread slapping the road as dense grains rather than smooth
 *    noise (smooth noise in that band is wind, and a car on tarmac then sounds like a
 *    blizzard), a little hiss, and surface texture: stones and grit as sparse
 *    grains on loose ground, slab joints thumping front-then-rear on concrete, cracks
 *    on broken asphalt, a hiss of spray on a wet road.
 *  - Skid: on a hard surface a pitched, chirping squeal; on loose ground no squeal at
 *    all — a scrabble of stones and a roar instead.
 *  - Brakes: a low-mid pad rub pulsed once per wheel revolution (see below).
 *
 * One-shots: gear change, suspension jolts, landings, collisions, the starter.
 *
 * RECORDED (2026-09-28): stones under the tyres on loose ground, the tyre squeal and
 * the crunch of a collision are CC0 recordings (samples.ts); their synthesised versions
 * were heard as a Geiger counter, a whistle and a burst of noise. Everything that has to
 * follow rpm or road speed continuously stays synthesised.
 *
 * After the engine stops: the exhaust and manifold tick and ping as they cool and
 * contract, often at first and more sparsely for minutes after a hard run; an engine
 * that stalled from overheating hisses steam and gurgles at the radiator.
 */

import { AUDIO_CONFIG } from '../config';
import { SurfaceType } from '../core/surfaces';
import type { VehicleAudioState } from '../vehicle/vehicle';
import { EngineVoice } from './enginevoice';
import { AudioMixer, ramp, setPannerPosition } from './mixer';
import { Bed, playOnce, type SampleName } from './samples';

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
/**
 * Recorded layers, against files built to -20 LUFS (loops) and -14 LUFS momentary
 * (one-shots); the car bus then loses 10 dB to the game trim (mixer.ts).
 *
 * THE STONES ARE A RUSTLE UNDER THE ROAD NOISE, NOT A BED OVER IT. At 1.2 the recorded
 * roll alone measured -18.5 LUFS against -30.4 for everything a tyre makes on asphalt
 * at 80 km/h (offline render, engine off): a gravel road came in 12 dB louder than
 * tarmac, a dense low-mid wash of a trailer wheel heard as a big hall, and sand, which
 * has no stones, got a quarter of it. Now its low half is cut (the tyre's own roar
 * already carries it), it sits nearly at the car rather than spread across the stereo
 * field, and only loose stone plays it: gravel measures -26.7 against asphalt's -30.4,
 * and 0.1 dB over asphalt once the engine is running. A squeal a little over the
 * engine, a hard crash well over everything.
 */
const GRAVEL_GAIN = 0.22;
const GRAVEL_HIGHPASS_HZ = 650;
const GRAVEL_WIDTH = 0.12;
const CRASH_GAIN = 6;
/**
 * A tyre sliding on loose ground, against SKID_GAIN (which is levelled for the
 * recorded squeal). The synthetic scrabble is not a -20 LUFS file: at the squeal's
 * gain a slide on sand measured -7.3 LUFS, louder than the engine at 80% throttle
 * (-9.5) — sand drumming on the floor pan. The brown under-roar is the drum, so it
 * is the smaller share; a slide on sand now adds 3 dB to its rolling hiss (-38.1
 * against -41.3 at 43 km/h), a slide on gravel 1 dB over its stones.
 */
const SCRABBLE_GAIN = 0.34;
const SCRABBLE_ROAR = 0.3;

/** Surface roughness (metres of micro-bump) treated as fully rough. */
const ROUGHNESS_FULL = 0.05;

/**
 * What each surface sounds like under a rolling tyre, relative to smooth asphalt.
 *  roar     low road roar
 *  hiss     tread hiss level, and its band centre
 *  grit     sparse synthetic grains (grit) level, and their band centre
 *  stones   the recorded roll of stones under the tyre: loose stone only, never sand
 *  squeal   whether a sliding tyre sings here (hard, dry surfaces) or scrabbles
 *  scrabble a slide's level on loose ground, and the band of what it throws: stones
 *           mid-band, sand a fine high hiss
 *  joints   slab joints (concrete) or random cracks (broken asphalt)
 */
interface SurfaceVoice {
  roar: number;
  hiss: number;
  hissHz: number;
  grit: number;
  gritHz: number;
  stones: number;
  squeal: boolean;
  scrabble: number;
  scrabbleHz: number;
  joints: 'slab' | 'crack' | null;
}

const SURFACE_VOICES: Record<SurfaceType, SurfaceVoice> = {
  [SurfaceType.Asphalt]: { roar: 1, hiss: 1, hissHz: 1000, grit: 0, gritHz: 2500, stones: 0, squeal: true, scrabble: 0, scrabbleHz: 1700, joints: null },
  [SurfaceType.CrackedAsphalt]: { roar: 1.1, hiss: 0.9, hissHz: 850, grit: 0.12, gritHz: 2200, stones: 0, squeal: true, scrabble: 0, scrabbleHz: 1700, joints: 'crack' },
  [SurfaceType.Gravel]: { roar: 1.1, hiss: 0.55, hissHz: 420, grit: 0.5, gritHz: 1050, stones: 0.8, squeal: false, scrabble: 1, scrabbleHz: 1700, joints: null },
  [SurfaceType.Sand]: { roar: 0.55, hiss: 0.8, hissHz: 420, grit: 0.12, gritHz: 1300, stones: 0, squeal: false, scrabble: 1, scrabbleHz: 3200, joints: null },
  [SurfaceType.Rock]: { roar: 1.3, hiss: 0.5, hissHz: 700, grit: 0.4, gritHz: 1700, stones: 0.35, squeal: true, scrabble: 0, scrabbleHz: 1700, joints: null },
  [SurfaceType.Concrete]: { roar: 1.1, hiss: 1.15, hissHz: 1250, grit: 0, gritHz: 2500, stones: 0, squeal: true, scrabble: 0, scrabbleHz: 1700, joints: 'slab' },
  [SurfaceType.LooseShoulder]: { roar: 1.15, hiss: 0.5, hissHz: 400, grit: 0.6, gritHz: 950, stones: 1, squeal: false, scrabble: 1, scrabbleHz: 1500, joints: null },
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
/** Early reflections off the road, verges and body, heard from outside only. */
/** Reflection level against the direct sound: about -8 dB, a car in the open. */
const SPACE_SEND = 0.4;
const SPACE_SECONDS = 0.22;

/**
 * Cooling metal. `exhaustHeat` (0..1) is how much heat the pipes hold: it builds over
 * tens of seconds of hard running and leaks away over minutes once stopped.
 */
const HEAT_RISE_S = 40;
const HEAT_FALL_RUNNING_S = 150;
const HEAT_FALL_STOPPED_S = 110;
/** Ticks per second from a fully heat-soaked exhaust the moment it stops. */
const TICK_RATE_MAX = 3.2;
/** The first ticks wait for the metal to begin shrinking. */
const TICK_DELAY_S = 1.2;
const TICK_GAIN = 0.05;
const BOIL_GAIN = 0.07;

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
  private readonly spaceSend: GainNode;
  /**
   * THE ENGINE HAS ITS OWN SHELL, AND IT IS VOICED THE OTHER WAY ROUND.
   *
   * By ear (the player's, 2026-09-28): the engine heard from the bonnet camera and the
   * engine heard from the chase camera sounded swapped. The bonnet camera sits ON the
   * bay, in the open air, not behind a firewall; the chase camera hears the car as a
   * whole shut box going by. So the engine — exhaust and bay, nothing else — goes
   * through its own filter pair driven by the opposite perspective (`engineHeardAs`),
   * while tyres, wind and the body keep the cabin/outside voicing they had.
   */
  private readonly engineOut: GainNode;
  private readonly engineLowpass: BiquadFilterNode;
  private readonly engineBoom: BiquadFilterNode;
  private readonly engineSpaceSend: GainNode;
  private readonly engineNose: PannerNode;
  private readonly engineTail: PannerNode;
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
  private readonly treadSource: AudioBufferSourceNode;
  private readonly treadGain: GainNode;
  private readonly gritSource: AudioBufferSourceNode;
  private readonly gritFilter: BiquadFilterNode;
  private readonly gritGain: GainNode;
  private readonly sprayGain: GainNode;

  private readonly gravel: Bed;
  private readonly skid: Bed;
  private readonly scrabbleGain: GainNode;
  private readonly scrabbleSource: AudioBufferSourceNode;
  private readonly scrabbleFilter: BiquadFilterNode;

  private readonly rubFilter: BiquadFilterNode;
  private readonly rubGain: GainNode;
  private readonly rotorLfo: OscillatorNode;

  private readonly sources: AudioBufferSourceNode[] = [];

  /** One-shots placed at the manifold (nose) and the silencer (tail). */
  private readonly noseFx: GainNode;
  private readonly tailFx: GainNode;
  private readonly steamFilter: BiquadFilterNode;
  private readonly steamGain: GainNode;
  private exhaustHeat = 0;
  private stoppedFor = 0;
  private boil = 0;

  private lastGearLabel = '';
  private wasRunning = false;
  private active = false;
  private perspective: CarPerspective = 'outside';
  private jointAccumM = 0;
  private nextCrackM = 8;
  private lastBumpAt = 0;
  private gustPhase = Math.random() * 100;
  /** Road texture under the tyres: no stretch of tarmac is as coarse as the last. */
  private texture = 1;
  private textureTarget = 1;
  private textureLeftM = 10;
  private lastCrash: SampleName | null = null;

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
    this.out.connect(this.cabinLowpass).connect(this.cabinBoom).connect(mixer.car);
    this.spaceSend = ctx.createGain();
    this.spaceSend.gain.value = SPACE_SEND;
    const space = ctx.createConvolver();
    space.normalize = false;
    space.buffer = this.buildSpaceImpulse();
    this.out.connect(this.spaceSend).connect(space).connect(mixer.car);
    this.engineOut = ctx.createGain();
    this.engineOut.gain.value = 0;
    this.engineLowpass = ctx.createBiquadFilter();
    this.engineLowpass.type = 'lowpass';
    this.engineLowpass.frequency.value = CABIN_LP_HZ;
    this.engineLowpass.Q.value = 0.6;
    this.engineBoom = ctx.createBiquadFilter();
    this.engineBoom.type = 'peaking';
    this.engineBoom.frequency.value = 78;
    this.engineBoom.Q.value = 1.1;
    this.engineBoom.gain.value = CABIN_BOOM_DB;
    this.engineOut.connect(this.engineLowpass).connect(this.engineBoom).connect(mixer.car);
    this.engineSpaceSend = ctx.createGain();
    this.engineSpaceSend.gain.value = 0;
    this.engineOut.connect(this.engineSpaceSend).connect(space);

    const panner = (bus: AudioNode = this.out): PannerNode => {
      const p = new PannerNode(ctx, {
        panningModel: 'equalpower',
        distanceModel: 'inverse',
        refDistance: 6,
        rolloffFactor: 1,
        maxDistance: 400,
      });
      p.connect(bus);
      return p;
    };
    this.engineNose = panner(this.engineOut);
    this.engineTail = panner(this.engineOut);
    this.nose = panner();
    this.body = panner();
    this.tail = panner();
    this.impacts = ctx.createGain();
    this.impacts.connect(this.body);
    this.noseFx = ctx.createGain();
    this.noseFx.connect(this.nose);
    this.tailFx = ctx.createGain();
    this.tailFx.connect(this.tail);

    // Steam from a boiling radiator: a fluttering high hiss under the bonnet.
    this.steamFilter = ctx.createBiquadFilter();
    this.steamFilter.type = 'bandpass';
    this.steamFilter.frequency.value = 4200;
    this.steamFilter.Q.value = 0.9;
    this.steamGain = ctx.createGain();
    this.steamGain.gain.value = 0;

    // --- engine -----------------------------------------------------------------
    this.engine = new EngineVoice(mixer);
    this.exhaustGain = ctx.createGain();
    this.exhaustGain.gain.value = 0;
    this.bayGain = ctx.createGain();
    this.bayGain.gain.value = 0;
    this.engine.exhaust.connect(this.exhaustGain).connect(this.engineTail);
    this.engine.bay.connect(this.bayGain).connect(this.engineNose);

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

    // Tread blocks meeting the road: thousands of tiny impacts a second, low-mid.
    this.treadSource = mixer.crackleSource();
    this.sources.push(this.treadSource);
    const treadBand = ctx.createBiquadFilter();
    treadBand.type = 'bandpass';
    treadBand.frequency.value = 650;
    treadBand.Q.value = 0.8;
    const treadSoft = ctx.createBiquadFilter();
    treadSoft.type = 'lowpass';
    treadSoft.frequency.value = 1400;
    treadSoft.Q.value = 0.5;
    this.treadGain = ctx.createGain();
    this.treadGain.gain.value = 0;
    this.treadSource.connect(treadBand).connect(treadSoft).connect(this.treadGain).connect(this.body);

    this.gritSource = mixer.crackleSource();
    this.sources.push(this.gritSource);
    this.gritFilter = ctx.createBiquadFilter();
    this.gritFilter.type = 'bandpass';
    this.gritFilter.frequency.value = 2500;
    this.gritFilter.Q.value = 0.7;
    // The grains are sub-millisecond clicks; without a top cut, stones under a tyre
    // are a Geiger counter. What a gravel road makes is a soft, low crunching rustle.
    const gritSoft = ctx.createBiquadFilter();
    gritSoft.type = 'lowpass';
    gritSoft.frequency.value = 1900;
    gritSoft.Q.value = 0.5;
    this.gritGain = ctx.createGain();
    this.gritGain.gain.value = 0;
    this.gritSource.connect(this.gritFilter).connect(gritSoft).connect(this.gritGain).connect(this.body);

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
    // A real tyre squealing on tarmac; its pitch follows how hard it slides.
    this.skid = new Bed(mixer, mixer.samples, 'skid', this.body, 0.2);
    // Stones under the tyres: a recorded roll over gravel, faster as the car is. Only
    // its top half and nearly at one point: the low half of a trailer wheel on gravel,
    // spread wide, is a room, not a road (see GRAVEL_GAIN).
    const gravelHighpass = ctx.createBiquadFilter();
    gravelHighpass.type = 'highpass';
    gravelHighpass.frequency.value = GRAVEL_HIGHPASS_HZ;
    gravelHighpass.Q.value = 0.6;
    gravelHighpass.connect(this.body);
    this.gravel = new Bed(mixer, mixer.samples, 'gravel-roll', gravelHighpass, GRAVEL_WIDTH);

    // Loose ground: what the tyre throws (stones mid-band, sand a fine hiss) over a
    // little low roar, no tone.
    this.scrabbleSource = mixer.crackleSource();
    this.sources.push(this.scrabbleSource);
    this.scrabbleFilter = ctx.createBiquadFilter();
    this.scrabbleFilter.type = 'bandpass';
    this.scrabbleFilter.frequency.value = 1700;
    this.scrabbleFilter.Q.value = 0.6;
    const scrabbleRoar = ctx.createBiquadFilter();
    scrabbleRoar.type = 'lowpass';
    scrabbleRoar.frequency.value = 260;
    const scrabbleRoarGain = ctx.createGain();
    scrabbleRoarGain.gain.value = SCRABBLE_ROAR;
    this.addNoise('brown', scrabbleRoar);
    this.scrabbleGain = ctx.createGain();
    this.scrabbleGain.gain.value = 0;
    this.scrabbleSource.connect(this.scrabbleFilter).connect(this.scrabbleGain);
    scrabbleRoar.connect(scrabbleRoarGain).connect(this.scrabbleGain);
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

    this.addNoise('white', this.steamFilter);
    this.steamFilter.connect(this.steamGain).connect(this.nose);
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
    ramp(this.engineOut.gain, active ? 1 : 0, this.mixer.now, 0.12);
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
    this.spaceSend.gain.setTargetAtTime(cabin ? 0 : SPACE_SEND, now, 0.08);
    const engineCabin = this.engineHeardAs === 'cabin';
    this.engineLowpass.frequency.setTargetAtTime(engineCabin ? CABIN_LP_HZ : OUTSIDE_LP_HZ, now, 0.08);
    this.engineBoom.gain.setTargetAtTime(engineCabin ? CABIN_BOOM_DB : 0, now, 0.08);
    this.engineSpaceSend.gain.setTargetAtTime(engineCabin ? 0 : SPACE_SEND, now, 0.08);
  }

  /** The perspective the ENGINE is voiced from: the camera's, swapped. See `engineOut`. */
  private get engineHeardAs(): CarPerspective {
    return this.perspective === 'cabin' ? 'outside' : 'cabin';
  }

  /**
   * A car on an open road: the tarmac under it answers within a few milliseconds, the
   * verges and ditch banks within a few tens, darker each time, and a thin diffuse
   * tail follows. Left and right are different surfaces, so they are independent.
   */
  private buildSpaceImpulse(): AudioBuffer {
    const ctx = this.mixer.ctx;
    const sr = ctx.sampleRate;
    const length = Math.floor(sr * SPACE_SECONDS);
    const buffer = ctx.createBuffer(2, length, sr);
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      let seed = 0x2545f491 + ch * 0x9e3779b9;
      const rand = (): number => {
        seed ^= seed << 13;
        seed ^= seed >>> 17;
        seed ^= seed << 5;
        return ((seed >>> 0) / 0xffffffff) * 2 - 1;
      };
      // Discrete early reflections, each a short smeared blob rather than a click.
      const taps = 9;
      for (let r = 0; r < taps; r++) {
        const at = 0.003 + (r / taps) ** 1.4 * 0.06 + rand() * 0.002;
        const level = 0.55 * Math.exp(-at / 0.03) * (0.6 + 0.4 * Math.abs(rand()));
        const start = Math.floor(at * sr);
        const smear = Math.floor(sr * (0.0006 + 0.0012 * (r / taps)));
        for (let i = 0; i < smear * 3 && start + i < length; i++) {
          data[start + i] = data[start + i]! + level * Math.exp(-i / smear) * (i === 0 ? 1 : rand() * 0.6);
        }
      }
      // Diffuse tail, darkening as it goes.
      let lp = 0;
      for (let i = Math.floor(sr * 0.02); i < length; i++) {
        const t = i / sr;
        lp += (rand() - lp) * (0.5 * Math.exp(-t * 18) + 0.08);
        data[i] = data[i]! + lp * 0.1 * Math.exp(-t / 0.045) * Math.min(1, (t - 0.02) / 0.01);
      }
      // Unit energy, so SPACE_SEND alone says how loud the reflections are.
      let energy = 0;
      for (let i = 0; i < length; i++) energy += data[i]! * data[i]!;
      const norm = 1 / Math.sqrt(energy || 1);
      for (let i = 0; i < length; i++) data[i] = data[i]! * norm;
    }
    return buffer;
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
    const engineCabin = this.engineHeardAs === 'cabin';
    ramp(this.exhaustGain.gain, ENGINE_GAIN * (engineCabin ? 0.75 : 1), now, 0.08);
    ramp(this.bayGain.gain, ENGINE_GAIN * (engineCabin ? 1.3 : 0.65), now, 0.08);

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
    // A new patch of surface every few to few tens of metres: a shade coarser or
    // smoother, gliding in as the tyres roll onto it.
    this.textureLeftM -= speed * dt;
    if (this.textureLeftM <= 0) {
      this.textureLeftM = 4 + Math.random() * 26;
      this.textureTarget = 0.9 + Math.random() * 0.2;
    }
    this.texture += (this.textureTarget - this.texture) * clamp01((speed * dt) / 3);
    ramp(
      this.roarGain.gain,
      TYRE_GAIN * 0.9 * rollT ** 1.3 * voice.roar * (0.7 + 0.6 * rough) * contact * (cabin ? 1.3 : 1) * this.texture,
      now,
      0.09,
    );
    this.hissFilter.frequency.setTargetAtTime(voice.hissHz * (0.8 + 0.4 * rollT) * (0.9 + 0.1 * this.texture), now, 0.1);
    ramp(this.hissGain.gain, TYRE_GAIN * 0.25 * rollT * rollT * voice.hiss * contact * this.texture, now, 0.09);
    this.treadSource.playbackRate.setTargetAtTime(1 + speed / 5, now, 0.1);
    ramp(this.treadGain.gain, TYRE_GAIN * 1.1 * rollT ** 1.4 * voice.hiss * contact * this.texture, now, 0.09);
    // Grain density and brightness both follow speed: the stones come faster.
    // Played slower than recorded, the grains are longer and duller as well as fewer.
    this.gritSource.playbackRate.setTargetAtTime(0.3 + speed / 16, now, 0.1);
    this.gritFilter.frequency.setTargetAtTime(voice.gritHz * (0.85 + 0.25 * rollT), now, 0.1);
    ramp(this.gritGain.gain, TYRE_GAIN * 0.35 * voice.grit * clamp01(speed / 12) * contact, now, 0.08);
    // The recorded roll carries loose stone; the synthetic grains above only add bite.
    this.gravel.setRate(Math.min(1.5, 0.6 + speed / 22), now);
    this.gravel.set(GRAVEL_GAIN * voice.stones * clamp01(speed / 8) * contact * (cabin ? 1.2 : 1), now, 0.12);
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
    this.skid.setRate(0.88 + 0.22 * slipT, now, 0.05);
    this.skid.set(SKID_GAIN * squeal, now, 0.04);
    this.scrabbleSource.playbackRate.setTargetAtTime(0.6 + speed / 6, now, 0.05);
    this.scrabbleFilter.frequency.setTargetAtTime(voice.scrabbleHz, now, 0.1);
    ramp(this.scrabbleGain.gain, voice.squeal ? 0 : SCRABBLE_GAIN * voice.scrabble * skidT, now, 0.05);

    // --- brakes -----------------------------------------------------------------
    const brake = clamp01(state.brake + (state.handbrake ? 0.7 : 0));
    const moving = clamp01((speed - BRAKE_MIN_MPS) / (BRAKE_FULL_MPS - BRAKE_MIN_MPS));
    const rotorHz = Math.min(ROTOR_RATE_MAX_HZ, Math.max(ROTOR_RATE_MIN_HZ, wheelHz));
    this.rotorLfo.frequency.setTargetAtTime(rotorHz, now, 0.12);
    this.rubFilter.frequency.setTargetAtTime(RUB_FREQ_SLOW + (RUB_FREQ_FAST - RUB_FREQ_SLOW) * moving, now, 0.1);
    ramp(this.rubGain.gain, brake * moving * (1 - lockT) * contact * RUB_GAIN, now, 0.06);

    this.cooling(state, load, dt, now);

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
    setPannerPosition(this.engineNose, x + fx * NOSE_M, y, z + fz * NOSE_M, now, 0.02);
    setPannerPosition(this.engineTail, x + fx * TAIL_M, y - 0.2, z + fz * TAIL_M, now, 0.02);
  }

  /** Hot metal ticking as it cools, and a boiling radiator after an overheat. */
  private cooling(state: VehicleAudioState, load: number, dt: number, now: number): void {
    const running = state.engineRunning;
    if (running) {
      const target = 0.25 + 0.75 * load * clamp01((state.rpm / Math.max(1, state.redlineRpm)) * 1.4);
      const tau = target > this.exhaustHeat ? HEAT_RISE_S : HEAT_FALL_RUNNING_S;
      this.exhaustHeat += (target - this.exhaustHeat) * Math.min(1, dt / tau);
      this.stoppedFor = 0;
    } else {
      this.exhaustHeat -= this.exhaustHeat * Math.min(1, dt / HEAT_FALL_STOPPED_S);
      this.stoppedFor += dt;
    }
    // A block that never got warm has nothing to give back.
    const warm = clamp01((state.engineTempC - 45) / 40);
    const heat = this.exhaustHeat * warm;
    if (!running && this.stoppedFor > TICK_DELAY_S) {
      // Starts gently, peaks a few seconds in, then thins out with the heat.
      const onset = clamp01((this.stoppedFor - TICK_DELAY_S) / 4);
      if (Math.random() < TICK_RATE_MAX * heat * heat * onset * dt) this.coolingTick(heat);
    }

    this.boil += ((state.overheatStalled ? 1 : 0) - this.boil) * Math.min(1, dt / 1.5);
    const flutter = 0.65 + 0.35 * Math.random();
    this.steamFilter.frequency.setTargetAtTime(3600 + 1600 * Math.random(), now, 0.05);
    ramp(this.steamGain.gain, BOIL_GAIN * this.boil * flutter, now, 0.05);
    if (this.boil > 0.2 && Math.random() < 1.8 * this.boil * dt) {
      // Coolant gurgling up the filler neck: a few wet low bubbles.
      const bubbles = 1 + Math.floor(Math.random() * 3);
      for (let i = 0; i < bubbles; i++) {
        this.mixer.burst(this.noseFx, {
          gain: TICK_GAIN * 1.4 * this.boil * (0.5 + 0.5 * Math.random()),
          frequency: 260 + Math.random() * 320,
          endFrequency: 420 + Math.random() * 400,
          q: 4,
          attack: 0.004,
          decay: 0.04 + Math.random() * 0.05,
          delay: i * (0.05 + Math.random() * 0.07),
        });
      }
    }
  }

  /**
   * One tick of contracting steel: a hard, bright click with a short inharmonic ring.
   * The pipe and silencer tick high and dry; the heat shield over them now and then
   * answers with a lower, longer "tonk".
   */
  private coolingTick(heat: number): void {
    const atManifold = Math.random() < 0.4;
    const dest = atManifold ? this.noseFx : this.tailFx;
    const level = TICK_GAIN * (0.35 + 0.65 * heat) * (0.4 + 0.6 * Math.random());
    this.mixer.burst(dest, { gain: level * 0.9, frequency: 6500, q: 1.5, attack: 0.0005, decay: 0.005 });
    if (Math.random() < 0.18) {
      const f = 650 + Math.random() * 450;
      this.mixer.blip(dest, { gain: level * 0.7, frequency: f, endFrequency: f * 0.995, decay: 0.16, type: 'sine' });
      this.mixer.blip(dest, { gain: level * 0.3, frequency: f * 2.41, endFrequency: f * 2.4, decay: 0.09, type: 'sine' });
    } else {
      const f = 2000 + Math.random() * 2600;
      this.mixer.blip(dest, { gain: level * 0.55, frequency: f, endFrequency: f * 0.997, decay: 0.035 + Math.random() * 0.04, type: 'sine' });
      this.mixer.blip(dest, { gain: level * 0.25, frequency: f * 2.76, decay: 0.02, type: 'sine' });
    }
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
    if (voice.stones > 0.5) {
      this.mixer.burst(this.impacts, {
        gain: BUMP_GAIN * 0.25 * s * voice.stones,
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
    // The body's own blow, low and short, under whichever crunch is recorded.
    this.mixer.burst(this.impacts, {
      gain: gain * 0.5,
      frequency: 140,
      endFrequency: 55,
      q: 0.7,
      decay: 0.14 + 0.16 * s,
      type: 'lowpass',
      colour: 'brown',
    });
    // A knock is the light take, dulled; a real crash the heavier ones, with glass.
    const takes: SampleName[] = s < 0.35 ? ['crash-3'] : s < 0.7 ? ['crash-1', 'crash-3'] : ['crash-1', 'crash-2'];
    const choices = takes.length > 1 ? takes.filter((t) => t !== this.lastCrash) : takes;
    const take = choices[Math.floor(Math.random() * choices.length)]!;
    this.lastCrash = take;
    playOnce(this.mixer, this.mixer.samples, take, this.impacts, {
      gain: CRASH_GAIN * (0.2 + 0.8 * s),
      rate: 1.08 - 0.12 * s,
      spread: 0.04,
      lowpass: 2500 + 14000 * s,
      send: 0.15,
    });
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
    this.gravel.dispose();
    this.skid.dispose();
    this.out.disconnect();
    this.engineOut.disconnect();
  }
}
