/**
 * The world, heard: air, weather and life.
 *
 * Everything here reads the numbers the weather and the sky already publish
 * (world/weather.ts, the sky's day factor), so what is heard always agrees with what is
 * seen: the thunder belongs to the flash that was drawn, delayed by the distance the sky
 * put it at.
 *
 * RECORDED, NOT SYNTHESISED (2026-09-28). The first version built all of this from
 * filtered noise and oscillators, and every layer was heard as exactly that — a thunder
 * of brown noise, rain as a hiss, birds as sine sweeps. The layers are now CC0 field
 * recordings (samples.ts, public/audio/CREDITS.md); what stays synthetic is only what
 * no recording has: the fine sand hiss of a desert drift.
 *
 * LAYERS
 *  - Wind: grass in a light wind, and a strong gusty wind that takes over as it rises.
 *  - Sand: a fine high hiss of grains in the air (drift, dust). Synthetic.
 *  - Rain: a steady field of rain; from the cabin, rain drumming on the roof instead,
 *    with the outside muffled by the shell.
 *  - Thunder: one of several real strokes, near ones for a close flash and rolling far
 *    ones otherwise, slowed and darkened with distance, panned to where the flash was
 *    and arriving `distance / c` after it.
 *  - Life: a summer meadow by day (larks, small birds, insects), grasshoppers in the
 *    heat, crickets at night; now and then a crow, a cuckoo or a lark close by. All of
 *    it quiet, and all of it driven away by rain and hard wind the way animals are.
 *  - Flocks taking off: real wingbeats where the birds actually are.
 *
 * LEVELS. Beds are built to -20 LUFS and one-shots to -14 LUFS momentary
 * (tools/sound/build.mjs); the gains below place them against the mixer's targets
 * (mixer.ts GAIN STAGING) — a calm day's bed about -36 LUFS at the output, steady rain
 * about -28, a near stroke about -16 momentary.
 */

import { AUDIO_CONFIG } from '../config';
import { AudioMixer, ramp, setPannerPosition } from './mixer';
import { Bed, playOnce, type SampleName } from './samples';

const AMBIENCE_GAIN = AUDIO_CONFIG.ambienceGain;
const RAIN_GAIN = AUDIO_CONFIG.rainGain;
const THUNDER_GAIN = AUDIO_CONFIG.thunderGain;
const WILDLIFE_GAIN = AUDIO_CONFIG.wildlifeGain;
const SPEED_OF_SOUND = 343;

/** Bed levels (linear, against a -20 LUFS file), before the config scales. */
const WIND_LIGHT = 0.32;
const WIND_STRONG = 0.9;
const MEADOW = 0.4;
const GRASSHOPPERS = 0.3;
const CRICKETS = 0.35;
const ROOF = 1.1;
/** One-shot bird level (against a -14 LUFS momentary file) at the nearest distance. */
const BIRD = 0.45;

const THUNDER_NEAR: readonly SampleName[] = ['thunder-near-1', 'thunder-near-2', 'thunder-near-3'];
const THUNDER_FAR: readonly SampleName[] = ['thunder-far-1', 'thunder-far-2', 'thunder-far-3', 'thunder-far-4'];
/** A stroke closer than this is heard as a crack and a roll, beyond it as a rumble. */
const THUNDER_NEAR_M = 1900;

/** What the ambience needs to know about this frame. */
export interface AmbienceFrame {
  /** Wind at this instant, gusts included, m/s. */
  windMps: number;
  /** Weather channels, 0..1. */
  rain: number;
  drift: number;
  dust: number;
  heat: number;
  /** 0 night .. 1 full day (the sky's own day factor). */
  dayFactor: number;
  /** Listener sits inside a car cabin. */
  cabin: boolean;
  /** Current or last lightning stroke. */
  boltSeed: number;
  boltAge: number;
  boltDistance: number;
  boltAzimuth: number;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function pick<T>(list: readonly T[], avoid: T | null): T {
  const choices = list.length > 1 ? list.filter((v) => v !== avoid) : list;
  return choices[Math.floor(Math.random() * choices.length)]!;
}

export class Ambience {
  /** Everything outside the car goes through this: muffled by the cabin. */
  private readonly world: GainNode;
  private readonly worldLowpass: BiquadFilterNode;
  private readonly sources: AudioBufferSourceNode[] = [];

  private readonly windLight: Bed;
  private readonly windStrong: Bed;
  private readonly sandGain: GainNode;
  private readonly rain: Bed;
  private readonly roof: Bed;
  private readonly meadow: Bed;
  private readonly grasshoppers: Bed;
  private readonly crickets: Bed;
  private readonly beds: Bed[];

  private lastBoltSeed = -1;
  private lastThunder: SampleName | null = null;
  private birdTimer = 6;
  private cabin = false;

  constructor(private readonly mixer: AudioMixer) {
    const ctx = mixer.ctx;
    const bank = mixer.samples;
    const master = ctx.createGain();
    master.gain.value = AMBIENCE_GAIN;
    master.connect(mixer.world);

    this.world = ctx.createGain();
    this.worldLowpass = ctx.createBiquadFilter();
    this.worldLowpass.type = 'lowpass';
    this.worldLowpass.frequency.value = 16000;
    this.worldLowpass.Q.value = 0.6;
    this.world.connect(this.worldLowpass).connect(master);

    this.windLight = new Bed(mixer, bank, 'wind-grass', this.world, 0.8);
    this.windStrong = new Bed(mixer, bank, 'wind-strong', this.world, 0.8);

    // Sand: grains in the air, the one layer no field recording here has.
    const sandHigh = ctx.createBiquadFilter();
    sandHigh.type = 'highpass';
    sandHigh.frequency.value = 3800;
    sandHigh.Q.value = 0.5;
    this.sandGain = ctx.createGain();
    this.sandGain.gain.value = 0;
    mixer.stereoNoise('white', this.sources).connect(sandHigh).connect(this.sandGain).connect(this.world);

    this.rain = new Bed(mixer, bank, 'rain', this.world, 0.85);
    // The roof is over your head, not outside: past the cabin's low-pass.
    this.roof = new Bed(mixer, bank, 'rain-roof', master, 0.6);

    this.meadow = new Bed(mixer, bank, 'meadow-day', this.world, 0.9);
    this.grasshoppers = new Bed(mixer, bank, 'grasshoppers', this.world, 0.9);
    this.crickets = new Bed(mixer, bank, 'crickets-night', this.world, 0.9);
    this.beds = [this.windLight, this.windStrong, this.rain, this.roof, this.meadow, this.grasshoppers, this.crickets];
  }

  /** `rightX/Z` is the listener's horizontal ear-to-ear axis, for panning bearings. */
  update(f: AmbienceFrame, dt: number, rightX: number, rightZ: number): void {
    const now = this.mixer.now;

    if (f.cabin !== this.cabin) {
      this.cabin = f.cabin;
      this.worldLowpass.frequency.setTargetAtTime(f.cabin ? 1500 : 16000, now, 0.08);
    }

    // --- air --------------------------------------------------------------------
    const windT = clamp01(f.windMps / 17);
    const strongT = clamp01((windT - 0.35) / 0.5);
    this.windLight.set(WIND_LIGHT * (0.35 + 0.65 * Math.min(1, windT * 2)) * (1 - 0.6 * strongT), now, 0.6);
    this.windStrong.set(WIND_STRONG * strongT * strongT, now, 0.6);
    ramp(this.sandGain.gain, 0.05 * f.drift * windT + 0.035 * f.dust, now, 0.3);

    // --- rain -------------------------------------------------------------------
    const rain = f.rain;
    this.rain.set(RAIN_GAIN * rain * (f.cabin ? 0.55 : 1), now, 0.5);
    this.roof.set(f.cabin ? RAIN_GAIN * ROOF * rain : 0, now, 0.25);

    // --- thunder ----------------------------------------------------------------
    if (f.boltSeed !== this.lastBoltSeed) {
      const fresh = this.lastBoltSeed >= 0 && f.boltAge < 1;
      this.lastBoltSeed = f.boltSeed;
      if (fresh) this.thunder(f, rightX, rightZ);
    }

    // --- life -------------------------------------------------------------------
    // Animals go quiet in rain and hard wind.
    const shelter = (1 - clamp01(rain * 2)) * (1 - clamp01((windT - 0.35) * 2));
    const day = clamp01(f.dayFactor * 1.6 - 0.2);
    const night = 1 - clamp01(f.dayFactor * 1.6);
    const hot = clamp01((f.dayFactor - 0.6) * 2.5) * (0.35 + 0.65 * f.heat);
    this.meadow.set(WILDLIFE_GAIN * MEADOW * day * shelter, now, 2);
    this.grasshoppers.set(WILDLIFE_GAIN * GRASSHOPPERS * hot * shelter, now, 2);
    this.crickets.set(WILDLIFE_GAIN * CRICKETS * night * shelter, now, 2);

    this.birdTimer -= dt;
    if (this.birdTimer <= 0) {
      this.birdTimer = 8 + Math.random() * 22;
      if (Math.random() < day * shelter) this.bird();
    }
  }

  /**
   * A thunderclap from a stroke `boltDistance` away, arriving `distance / c` after the
   * flash: a near take for a close stroke, a rolling far one otherwise, never the same
   * take twice running. Distance slows it a little (the long, low roll of a far stroke)
   * and closes a low-pass on it, because air eats the crack first.
   */
  private thunder(f: AmbienceFrame, rightX: number, rightZ: number): void {
    if (!this.mixer.running) return;
    const distance = f.boltDistance;
    const near = distance < THUNDER_NEAR_M;
    const name = pick(near ? THUNDER_NEAR : THUNDER_FAR, this.lastThunder);
    this.lastThunder = name;
    const delay = Math.max(0.05, distance / SPEED_OF_SOUND - f.boltAge);
    // World direction of the stroke: x = sin(az), z = cos(az), as the sky draws it.
    const pan = Math.max(-0.8, Math.min(0.8, Math.sin(f.boltAzimuth) * rightX + Math.cos(f.boltAzimuth) * rightZ));
    const far = clamp01((distance - 900) / 5000);
    playOnce(this.mixer, this.mixer.samples, name, this.world, {
      gain: THUNDER_GAIN / (1 + distance / 2500),
      rate: 1 - 0.14 * far,
      spread: 0.04,
      delay,
      pan,
      lowpass: 9000 / (1 + distance / 900),
      send: 0.25,
    });
  }

  /** Dev: a stroke `distance` metres away, heard now (see GameAudio.thunder). */
  testThunder(distance: number, azimuth: number, rightX: number, rightZ: number): void {
    this.thunder(
      { boltDistance: distance, boltAzimuth: azimuth, boltAge: distance / SPEED_OF_SOUND } as AmbienceFrame,
      rightX,
      rightZ,
    );
  }

  /** One bird close by, off the road: a crow, a cuckoo, or a lark overhead. */
  private bird(): void {
    const roll = Math.random();
    const name: SampleName = roll < 0.45 ? (Math.random() < 0.5 ? 'crow-1' : 'crow-2') : roll < 0.7 ? 'cuckoo' : 'skylark';
    const distance = Math.random();
    playOnce(this.mixer, this.mixer.samples, name, this.world, {
      gain: WILDLIFE_GAIN * BIRD * (1 - 0.65 * distance),
      spread: 0.03,
      pan: Math.random() * 1.6 - 0.8,
      lowpass: 12000 - 6000 * distance,
      send: 0.2 + 0.3 * distance,
    });
  }

  /**
   * A flock leaving the ground at a point in the world: real wingbeats, placed where
   * the birds are and scaled by how many there are.
   */
  flockTakeoff(x: number, y: number, z: number, count: number, large: boolean): void {
    if (!this.mixer.running) return;
    const ctx = this.mixer.ctx;
    const panner = new PannerNode(ctx, {
      panningModel: 'HRTF',
      distanceModel: 'inverse',
      refDistance: 5,
      rolloffFactor: 1.3,
      maxDistance: 300,
    });
    setPannerPosition(panner, x, y, z, this.mixer.now, 0.001);
    panner.connect(this.world);
    const played = playOnce(this.mixer, this.mixer.samples, Math.random() < 0.5 ? 'flock-1' : 'flock-2', panner, {
      gain: WILDLIFE_GAIN * Math.min(2.4, 0.75 + 0.18 * count),
      // Big birds beat slower and lower.
      rate: large ? 0.8 : 1.05,
      spread: 0.05,
    });
    window.setTimeout(() => panner.disconnect(), played ? 9000 : 0);
  }

  dispose(): void {
    for (const src of this.sources) src.stop();
    this.sources.length = 0;
    for (const bed of this.beds) bed.dispose();
    this.world.disconnect();
  }
}
