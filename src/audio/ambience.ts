/**
 * The world, heard: air, weather and life.
 *
 * Until this existed the only sounds were the ones the player made, so a clear dawn,
 * a haboob and a thunderstorm were equally silent. Everything here reads the numbers
 * the weather and the sky already publish (world/weather.ts, the sky's day factor),
 * so what is heard always agrees with what is seen: the thunder belongs to the flash
 * that was drawn, delayed by the distance the sky put it at.
 *
 * LAYERS
 *  - Air: a stereo bed that is almost nothing on a still day and a roar in a gale,
 *    with narrow, wandering howls once the wind is strong enough to sing on edges.
 *  - Sand: a fine high hiss of grains in the air (drift, dust).
 *  - Rain: a stereo wash plus close drops as sparse grains; from the cabin, the roof
 *    drumming instead, and the outside muffled by the shell.
 *  - Thunder: a crack for a near stroke, then a rolling rumble of several swells whose
 *    length and darkness grow with distance, panned to where the flash was.
 *  - Life: birds by day (larks' warbles, short "tsip" calls, a crow), cicadas in the
 *    heat, crickets at night. All quiet, all occasional, all driven away by rain and
 *    wind the way real animals are.
 *  - Flocks taking off: a spatial flutter of wingbeats where the birds actually are.
 */

import { AUDIO_CONFIG } from '../config';
import { AudioMixer, ramp, setPannerPosition } from './mixer';

const AMBIENCE_GAIN = AUDIO_CONFIG.ambienceGain;
const RAIN_GAIN = AUDIO_CONFIG.rainGain;
const THUNDER_GAIN = AUDIO_CONFIG.thunderGain;
const WILDLIFE_GAIN = AUDIO_CONFIG.wildlifeGain;
const SPEED_OF_SOUND = 343;

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

export class Ambience {
  /** Everything outside the car goes through this: muffled by the cabin. */
  private readonly world: GainNode;
  private readonly worldLowpass: BiquadFilterNode;
  private readonly sources: AudioBufferSourceNode[] = [];

  private readonly airLowpass: BiquadFilterNode;
  private readonly airGain: GainNode;
  private readonly howlA: BiquadFilterNode;
  private readonly howlB: BiquadFilterNode;
  private readonly howlGain: GainNode;
  private readonly sandGain: GainNode;
  private readonly rainGain: GainNode;
  private readonly dropsGain: GainNode;
  private readonly roofGain: GainNode;
  private readonly cricketGain: GainNode;
  private readonly cicadaGain: GainNode;

  private lastBoltSeed = -1;
  private birdTimer = 4;
  private howlWander = Math.random() * 50;
  private cabin = false;

  constructor(private readonly mixer: AudioMixer) {
    const ctx = mixer.ctx;
    const master = ctx.createGain();
    master.gain.value = AMBIENCE_GAIN;
    master.connect(mixer.sfx);

    this.world = ctx.createGain();
    this.worldLowpass = ctx.createBiquadFilter();
    this.worldLowpass.type = 'lowpass';
    this.worldLowpass.frequency.value = 16000;
    this.worldLowpass.Q.value = 0.6;
    this.world.connect(this.worldLowpass).connect(master);

    // --- air --------------------------------------------------------------------
    this.airLowpass = ctx.createBiquadFilter();
    this.airLowpass.type = 'lowpass';
    this.airLowpass.frequency.value = 400;
    this.airLowpass.Q.value = 0.5;
    this.airGain = ctx.createGain();
    this.airGain.gain.value = 0;
    mixer.stereoNoise('pink', this.sources).connect(this.airLowpass).connect(this.airGain).connect(this.world);

    this.howlA = ctx.createBiquadFilter();
    this.howlA.type = 'bandpass';
    this.howlA.frequency.value = 620;
    this.howlA.Q.value = 18;
    this.howlB = ctx.createBiquadFilter();
    this.howlB.type = 'bandpass';
    this.howlB.frequency.value = 910;
    this.howlB.Q.value = 22;
    this.howlGain = ctx.createGain();
    this.howlGain.gain.value = 0;
    const howlPanA = new StereoPannerNode(ctx, { pan: -0.5 });
    const howlPanB = new StereoPannerNode(ctx, { pan: 0.6 });
    this.noise('pink', this.howlA);
    this.noise('pink', this.howlB);
    this.howlA.connect(howlPanA).connect(this.howlGain);
    this.howlB.connect(howlPanB).connect(this.howlGain);
    this.howlGain.connect(this.world);

    // --- sand -------------------------------------------------------------------
    const sandHigh = ctx.createBiquadFilter();
    sandHigh.type = 'highpass';
    sandHigh.frequency.value = 3800;
    sandHigh.Q.value = 0.5;
    this.sandGain = ctx.createGain();
    this.sandGain.gain.value = 0;
    mixer.stereoNoise('white', this.sources).connect(sandHigh).connect(this.sandGain).connect(this.world);

    // --- rain -------------------------------------------------------------------
    const rainBand = ctx.createBiquadFilter();
    rainBand.type = 'bandpass';
    rainBand.frequency.value = 2800;
    rainBand.Q.value = 0.45;
    this.rainGain = ctx.createGain();
    this.rainGain.gain.value = 0;
    mixer.stereoNoise('pink', this.sources).connect(rainBand).connect(this.rainGain).connect(this.world);

    const dropsHigh = ctx.createBiquadFilter();
    dropsHigh.type = 'highpass';
    dropsHigh.frequency.value = 1400;
    this.dropsGain = ctx.createGain();
    this.dropsGain.gain.value = 0;
    mixer.stereoCrackle(this.sources).connect(dropsHigh).connect(this.dropsGain).connect(this.world);

    // Roof: drops on a steel panel over your head, with the panel's own low body.
    // Not through the cabin low-pass — the listener is inside with it.
    const roofBand = ctx.createBiquadFilter();
    roofBand.type = 'bandpass';
    roofBand.frequency.value = 1100;
    roofBand.Q.value = 0.8;
    const roofBody = ctx.createBiquadFilter();
    roofBody.type = 'peaking';
    roofBody.frequency.value = 280;
    roofBody.Q.value = 1.4;
    roofBody.gain.value = 8;
    this.roofGain = ctx.createGain();
    this.roofGain.gain.value = 0;
    mixer.stereoCrackle(this.sources).connect(roofBand).connect(roofBody).connect(this.roofGain).connect(master);

    // --- insects ----------------------------------------------------------------
    this.cricketGain = ctx.createGain();
    this.cricketGain.gain.value = 0;
    this.cricketGain.connect(this.world);
    // A meadow, not a transformer: a few singers at different distances, each with
    // its own pitch, tempo and bouts of silence. The far ones are quiet and mostly
    // reverb, so the near one or two carry the rhythm and the rest is space.
    const cricketSend = ctx.createGain();
    cricketSend.gain.value = 0.45;
    this.cricketGain.connect(cricketSend).connect(mixer.reverb);
    const crickets: [carrier: number, period: number, pan: number, level: number][] = [
      [3900, 0.52, -0.55, 1],
      [4250, 0.66, 0.4, 0.7],
      [3650, 0.58, 0.85, 0.4],
      [4100, 0.74, -0.9, 0.3],
      [3500, 0.61, 0.1, 0.22],
    ];
    crickets.forEach(([carrier, period, pan, gain], i) => {
      const src = ctx.createBufferSource();
      src.buffer = this.cricketBuffer(carrier, period, 0x3c6ef372 + i * 977);
      src.loop = true;
      src.playbackRate.value = 0.98 + Math.random() * 0.04;
      const panner = new StereoPannerNode(ctx, { pan });
      const level = ctx.createGain();
      level.gain.value = gain * (0.85 + 0.3 * Math.random());
      src.connect(level).connect(panner).connect(this.cricketGain);
      src.start(0, Math.random() * 10);
      this.sources.push(src);
    });

    this.cicadaGain = ctx.createGain();
    this.cicadaGain.gain.value = 0;
    this.cicadaGain.connect(this.world);
    for (const [pan, seed] of [[-0.45, 0x1b873593], [0.55, 0x6b43a9b5]] as const) {
      const src = ctx.createBufferSource();
      src.buffer = this.cicadaBuffer(seed);
      src.loop = true;
      src.playbackRate.value = 0.96 + Math.random() * 0.08;
      const panner = new StereoPannerNode(ctx, { pan });
      src.connect(panner).connect(this.cicadaGain);
      src.start(0, Math.random() * 7);
      this.sources.push(src);
    }
  }

  private noise(colour: 'white' | 'pink' | 'brown', destination: AudioNode): void {
    const src = this.mixer.noiseSource(colour);
    src.connect(destination);
    this.sources.push(src);
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
    this.airLowpass.frequency.setTargetAtTime(260 + 1500 * windT, now, 0.3);
    ramp(this.airGain.gain, 0.02 + 0.28 * windT ** 1.5, now, 0.3);
    this.howlWander += dt;
    const howlT = clamp01((windT - 0.45) / 0.55);
    this.howlA.frequency.setTargetAtTime(520 + 260 * windT + 70 * Math.sin(this.howlWander * 0.37), now, 0.4);
    this.howlB.frequency.setTargetAtTime(780 + 330 * windT + 90 * Math.sin(this.howlWander * 0.23 + 2), now, 0.4);
    ramp(this.howlGain.gain, howlT * howlT * 0.9 * (0.6 + 0.4 * Math.sin(this.howlWander * 0.5) ** 2), now, 0.4);

    ramp(this.sandGain.gain, 0.05 * f.drift * windT + 0.035 * f.dust, now, 0.3);

    // --- rain -------------------------------------------------------------------
    const rain = f.rain;
    ramp(this.rainGain.gain, RAIN_GAIN * rain * (f.cabin ? 0.6 : 1), now, 0.4);
    ramp(this.dropsGain.gain, RAIN_GAIN * 0.8 * rain * (f.cabin ? 0 : 1), now, 0.4);
    ramp(this.roofGain.gain, f.cabin ? RAIN_GAIN * 2.2 * rain : 0, now, 0.25);

    // --- thunder ----------------------------------------------------------------
    if (f.boltSeed !== this.lastBoltSeed) {
      const fresh = this.lastBoltSeed >= 0 && f.boltAge < 1;
      this.lastBoltSeed = f.boltSeed;
      if (fresh) this.thunder(f, rightX, rightZ);
    }

    // --- life -------------------------------------------------------------------
    // Animals go quiet in rain and hard wind.
    const shelter = (1 - clamp01(rain * 2)) * (1 - clamp01((windT - 0.35) * 2));
    const night = 1 - clamp01(f.dayFactor * 1.6);
    ramp(this.cricketGain.gain, WILDLIFE_GAIN * 0.032 * night * shelter, now, 1.5);
    const hot = clamp01((f.dayFactor - 0.6) * 2.5) * (0.35 + 0.65 * f.heat);
    ramp(this.cicadaGain.gain, WILDLIFE_GAIN * 0.035 * hot * shelter, now, 1.5);

    const birdChance = clamp01(f.dayFactor * 1.4 - 0.2) * shelter;
    this.birdTimer -= dt;
    if (this.birdTimer <= 0) {
      this.birdTimer = 3 + Math.random() * 11;
      if (Math.random() < birdChance) this.bird();
    }
  }

  /**
   * A thunderclap from a stroke `boltDistance` away, arriving `distance / c` after
   * the flash. Near strokes crack; all of them rumble, longer and darker the
   * farther away — the rumble is the channel's length arriving over time.
   */
  private thunder(f: AmbienceFrame, rightX: number, rightZ: number): void {
    if (!this.mixer.running) return;
    const ctx = this.mixer.ctx;
    const distance = f.boltDistance;
    const delay = Math.max(0.05, distance / SPEED_OF_SOUND - f.boltAge);
    const t0 = this.mixer.now + delay;
    const near = clamp01(1 - (distance - 900) / 2200);
    const level = THUNDER_GAIN / (1 + distance / 1400);
    // World direction of the stroke: x = sin(az), z = cos(az), as the sky draws it.
    const pan = Math.max(-0.9, Math.min(0.9, Math.sin(f.boltAzimuth) * rightX + Math.cos(f.boltAzimuth) * rightZ));

    const panner = new StereoPannerNode(ctx, { pan });
    panner.connect(this.world);
    const send = ctx.createGain();
    send.gain.value = 0.6;
    panner.connect(send).connect(this.mixer.reverb);

    // Crack: a bright tearing burst, only for strokes close enough to hear it.
    if (near > 0.05) {
      const crack = ctx.createBufferSource();
      crack.buffer = this.mixer.noiseBuffer('white');
      const band = ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.setValueAtTime(3000, t0);
      band.frequency.exponentialRampToValueAtTime(600, t0 + 0.5);
      band.Q.value = 0.5;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, t0);
      env.gain.linearRampToValueAtTime(level * near * 1.1, t0 + 0.01);
      env.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.7);
      crack.connect(band).connect(env).connect(panner);
      crack.start(t0, Math.random() * 6, 0.8);
    }

    // Rumble: brown noise, several swells.
    const length = 3 + distance / 900 + Math.random() * 2;
    const rumble = ctx.createBufferSource();
    rumble.buffer = this.mixer.noiseBuffer('brown');
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    const corner = 180 + 700 * near;
    lowpass.frequency.setValueAtTime(corner, t0);
    lowpass.frequency.exponentialRampToValueAtTime(Math.max(70, corner * 0.35), t0 + length);
    lowpass.Q.value = 0.7;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    let t = t0 + 0.05 + (1 - near) * 0.4;
    const swells = 3 + Math.floor(Math.random() * 4);
    for (let i = 0; i < swells && t < t0 + length; i++) {
      const peak = level * (1.4 - (i / swells) * 0.9) * (0.6 + 0.4 * Math.random());
      env.gain.linearRampToValueAtTime(peak, t);
      t += 0.25 + Math.random() * (length / swells);
      env.gain.linearRampToValueAtTime(peak * (0.25 + 0.3 * Math.random()), t);
      t += 0.1 + Math.random() * 0.3;
    }
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + length + 1);
    rumble.connect(lowpass).connect(env).connect(panner);
    rumble.start(t0, Math.random() * 3);
    rumble.stop(t0 + length + 1.2);
    rumble.onended = () => panner.disconnect();
  }

  /** One bird, somewhere off the road: a lark's warble, a pair of tsips, or a crow. */
  private bird(): void {
    if (!this.mixer.running) return;
    const ctx = this.mixer.ctx;
    const t0 = this.mixer.now + 0.05;
    const distance = Math.random();
    const panner = new StereoPannerNode(ctx, { pan: Math.random() * 1.8 - 0.9 });
    const air = ctx.createBiquadFilter();
    air.type = 'lowpass';
    air.frequency.value = 9000 - 5500 * distance;
    const level = ctx.createGain();
    level.gain.value = WILDLIFE_GAIN * 0.05 * (1 - 0.7 * distance);
    air.connect(level).connect(panner).connect(this.world);
    const send = ctx.createGain();
    send.gain.value = 0.25;
    level.connect(send).connect(this.mixer.reverb);

    const kind = Math.random();
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t0);
    osc.connect(env).connect(air);
    let end = t0;

    if (kind < 0.45) {
      // Lark: a fast tumbling warble of short notes, each with its own slide.
      osc.type = 'sine';
      const notes = 8 + Math.floor(Math.random() * 14);
      let t = t0;
      for (let i = 0; i < notes; i++) {
        const len = 0.03 + Math.random() * 0.06;
        const f0 = 2600 + Math.random() * 2600;
        osc.frequency.setValueAtTime(f0, t);
        osc.frequency.linearRampToValueAtTime(f0 * (0.8 + Math.random() * 0.45), t + len);
        env.gain.setValueAtTime(0, t);
        env.gain.linearRampToValueAtTime(0.6 + 0.4 * Math.random(), t + 0.006);
        env.gain.setValueAtTime(0.5, t + len - 0.008);
        env.gain.linearRampToValueAtTime(0, t + len);
        t += len + Math.random() * 0.025;
      }
      end = t;
    } else if (kind < 0.85) {
      // Tsip: two or three quick downward sweeps.
      osc.type = 'sine';
      const calls = 2 + Math.floor(Math.random() * 2);
      const top = 5200 + Math.random() * 1800;
      let t = t0;
      for (let i = 0; i < calls; i++) {
        osc.frequency.setValueAtTime(top, t);
        osc.frequency.exponentialRampToValueAtTime(top * 0.55, t + 0.07);
        env.gain.setValueAtTime(0, t);
        env.gain.linearRampToValueAtTime(0.9, t + 0.008);
        env.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
        t += 0.14 + Math.random() * 0.12;
      }
      end = t;
    } else {
      // Crow: harsh, nasal caws — a buzzy source through a formant.
      osc.type = 'sawtooth';
      const formant = ctx.createBiquadFilter();
      formant.type = 'bandpass';
      formant.frequency.value = 1250;
      formant.Q.value = 2.2;
      osc.disconnect();
      osc.connect(formant).connect(env);
      level.gain.value *= 1.6;
      const caws = 2 + Math.floor(Math.random() * 3);
      let t = t0;
      for (let i = 0; i < caws; i++) {
        const f0 = 520 + Math.random() * 80;
        osc.frequency.setValueAtTime(f0, t);
        osc.frequency.linearRampToValueAtTime(f0 * 0.82, t + 0.28);
        env.gain.setValueAtTime(0, t);
        env.gain.linearRampToValueAtTime(0.8, t + 0.03);
        env.gain.setValueAtTime(0.7, t + 0.2);
        env.gain.linearRampToValueAtTime(0, t + 0.3);
        t += 0.45 + Math.random() * 0.2;
      }
      end = t;
    }
    osc.start(t0);
    osc.stop(end + 0.05);
    osc.onended = () => panner.disconnect();
  }

  /**
   * A flock leaving the ground at a point in the world: a burst of wingbeats that
   * starts dense and loud and thins as the birds climb away. `count` scales it.
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
    const level = ctx.createGain();
    level.gain.value = WILDLIFE_GAIN * Math.min(1.4, 0.35 + 0.12 * count);
    level.connect(panner).connect(this.world);
    const beats = 10 + Math.floor(Math.random() * 8);
    const rate = large ? 5 : 13;
    for (let i = 0; i < beats; i++) {
      const fade = 1 - i / beats;
      this.mixer.burst(level, {
        gain: 0.4 * fade * (0.6 + 0.4 * Math.random()),
        frequency: large ? 420 : 950 + Math.random() * 500,
        q: 0.8,
        attack: 0.004,
        decay: large ? 0.07 : 0.035,
        delay: i / rate + Math.random() * 0.02,
      });
    }
    window.setTimeout(() => panner.disconnect(), (beats / rate) * 1000 + 600);
  }

  /**
   * A field cricket: three or four syllables of ~15 ms, one chirp every `period`
   * seconds, sung in bouts with pauses between. Each syllable is a tone near 4 kHz
   * that glides down a little as the wing's file runs out, with its own level and
   * timing error — a steady, identical pulse train is what an electric hum is.
   * Rendered at a low sample rate (the song has nothing above 5 kHz) to keep a long,
   * non-repeating loop cheap.
   */
  private cricketBuffer(carrier: number, period: number, seed: number): AudioBuffer {
    const sr = 22050;
    const seconds = 17 + (seed % 7);
    const length = Math.floor(sr * seconds);
    const buffer = this.mixer.ctx.createBuffer(1, length, sr);
    const data = buffer.getChannelData(0);
    let s = seed >>> 0;
    const rand = () => {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      return (s >>> 0) / 0xffffffff;
    };
    let t = rand() * 1.5;
    while (t < seconds - 1) {
      // A bout: a few seconds of song, the tempo drifting, then a rest.
      const boutEnd = Math.min(seconds - 1, t + 3 + rand() * 6);
      const tempo = period * (0.92 + 0.16 * rand());
      const pitch = carrier * (0.98 + 0.04 * rand());
      let boutLevel = 0.25;
      while (t < boutEnd) {
        // Starts soft and settles into the song.
        boutLevel = Math.min(1, boutLevel + 0.25);
        const syllables = 3 + (rand() < 0.35 ? 1 : 0);
        let at = t;
        for (let p = 0; p < syllables; p++) {
          const len = 0.013 + 0.004 * rand();
          const start = Math.floor(sr * at);
          const n = Math.floor(sr * len);
          const amp = boutLevel * (0.65 + 0.35 * rand()) * (p === syllables - 1 ? 0.75 : 1);
          let phase = 0;
          for (let i = 0; i < n && start + i < length; i++) {
            const u = i / n;
            // Quick attack, longer fall; the pitch sags ~4% across the syllable.
            const env = Math.sin(Math.PI * Math.min(1, u * 1.6) * 0.5) ** 2 * (1 - u) ** 0.7;
            phase += (2 * Math.PI * pitch * (1.02 - 0.04 * u)) / sr;
            // A trace of the second harmonic: a wing, not a sine generator.
            data[start + i] = (Math.sin(phase) + 0.08 * Math.sin(2 * phase)) * env * amp * 0.8;
          }
          at += len + 0.017 + 0.006 * rand();
        }
        t += tempo * (0.95 + 0.1 * rand());
      }
      t += 1.2 + rand() * 4;
    }
    return buffer;
  }

  /**
   * A cicada: a noisy band near 5-6 kHz buzzing at ~140 Hz (the tymbal clicks),
   * swelling up and dying away over several seconds.
   */
  private cicadaBuffer(seed: number): AudioBuffer {
    const sr = this.mixer.ctx.sampleRate;
    const seconds = 7;
    const length = Math.floor(sr * seconds);
    const buffer = this.mixer.ctx.createBuffer(1, length, sr);
    const data = buffer.getChannelData(0);
    let s = seed >>> 0;
    const rand = () => {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      return ((s >>> 0) / 0xffffffff) * 2 - 1;
    };
    // Resonator at the body's song frequency.
    const f = 5200 + 900 * ((rand() + 1) / 2);
    const r = Math.exp((-Math.PI * 900) / sr);
    const a1 = 2 * r * Math.cos((2 * Math.PI * f) / sr);
    const a2 = -r * r;
    let y1 = 0;
    let y2 = 0;
    const buzz = 125 + 30 * ((rand() + 1) / 2);
    for (let i = 0; i < length; i++) {
      const t = i / sr;
      const y = (1 - r) * rand() + a1 * y1 + a2 * y2;
      y2 = y1;
      y1 = y;
      const tymbal = Math.abs(Math.sin(Math.PI * buzz * t)) ** 4;
      const swell = Math.sin((Math.PI * t) / seconds) ** 1.5;
      data[i] = y * tymbal * swell * 6;
    }
    return buffer;
  }

  dispose(): void {
    for (const src of this.sources) src.stop();
    this.sources.length = 0;
    this.world.disconnect();
  }
}
