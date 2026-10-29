/**
 * Another car on the road, heard from outside.
 *
 * What makes a passing car a passing car is not its engine — it is the rush of tyres
 * and air that swells, swings across and falls away, and the pitch drop as it goes
 * by. So each voice has three layers through one HRTF panner: the same per-firing
 * engine as the player's car (built from THIS car's engine), a road layer (tyre roar,
 * tread hiss and displaced air, rising steeply with speed), and air absorption, a
 * low-pass that closes with distance because air eats treble over a few hundred
 * metres.
 *
 * DOPPLER. Web Audio's panner no longer does it, and a procedural source does not
 * need it to: the engine takes a `pitch` factor that scales every frequency it makes,
 * pipe resonances included, and the road layer's bands move by the same factor.
 * The factor comes from the rate the distance to the listener changes, which the
 * floating-origin rebase cannot disturb because it moves both ends together.
 *
 * POOLED. A voice is costly to make (an engine worklet and some fifteen nodes) and the
 * nearest few change all the time, so a released voice fades, is parked silent
 * (`park`) and is given to the next car that needs one (`reuse`), its engine rebuilt
 * in place for that car's character.
 *
 * PANNING. HRTF is the dear part of a voice on the audio thread and buys nothing at a
 * distance where the air has taken the treble it works with, so a far car is panned
 * equal-power, switched over at `EQUALPOWER_FROM_M` (where the voice is ~25 dB down)
 * and back at `HRTF_WITHIN_M`.
 *
 * MUSIC. A car with music playing (cabinmusic.ts, fixed by its id) adds its loop to
 * the voice before the panner: heard within some 25 m, louder with its windows or doors
 * open, quieter as it gathers speed and its own wind and engine cover it.
 */

import type { KitRig } from '../carkit/rig';
import { AUDIO_CONFIG } from '../config';
import type { VehicleAudioState } from '../vehicle/vehicle';
import { cabinMusicFor, type CabinMusic, type CabinMusicPick } from './cabinmusic';
import { cabinOpenness, type CabinOpenness } from './cabinopenness';
import { EngineVoice } from './enginevoice';
import { AudioMixer, ramp, setPannerPosition, snapPannerPosition, steer } from './mixer';

const SPEED_OF_SOUND = 343;
const TRAFFIC_GAIN = AUDIO_CONFIG.trafficGain;
/** Road-layer level at `ROAD_FULL_MPS`. */
const ROAD_GAIN = 0.3;
const ROAD_FULL_MPS = 30;
/** Seconds from `release` until the fade is inaudible and the voice can be parked. */
export const TRAFFIC_RELEASE_S = 0.6;
const EQUALPOWER_FROM_M = 120;
const HRTF_WITHIN_M = 100;
/** A panner target closer than this to the last one written is not written, metres. */
const PLACE_EPS_M = 0.005;
/**
 * A car with music has it on LOUD: what gets out of a shut car is only the shell's
 * muffled bottom (the loops have it baked in, cabinmusic.ts), and that is still plain to
 * hear beside it. A loop (-18 dBFS RMS) at a car's loudest, shut: ~-13 dBFS into the
 * voice, some 10 dB over its engine at idle (-23 dBFS, measured offline), so it carries
 * over the engine and tyres at road speed. Was 0.45 (-25 dBFS), under the engine, and a
 * drive alongside traffic heard next to none of it.
 */
const CABIN_MUSIC_GAIN = 1.8;
/**
 * Music at full within NEAR, gone by FAR, metres (on top of the panner's roll-off). Two
 * cars passing at 90 km/h each close 50 m a second, so a 25 m reach was a blip under a
 * second long and passed unheard; at 45 m the pass carries the music for some two.
 */
const MUSIC_NEAR_M = 20;
const MUSIC_FAR_M = 45;
/** Every window and door open: this much louder than shut (+7 dB). */
const MUSIC_OPEN_BOOST = 1.2;
/** By this speed the music is down by `MUSIC_SPEED_DROP` under the car's wind and engine, m/s. */
const MUSIC_SPEED_MPS = 25;
const MUSIC_SPEED_DROP = 0.15;

/** Initial values of the per-frame params, as built (`reuse` puts them back). */
const AIR_HZ = 12000;
const ROAR_HZ = 380;
const HISS_HZ = 900;
/** `steer` slots. */
const AIR = 0;
const ROAR = 1;
const HISS = 2;
const ROAD = 3;
const MUSIC = 4;
const MUSIC_RATE = 5;

export class TrafficAudio {
  private readonly out: GainNode;
  private readonly panner: PannerNode;
  private readonly air: BiquadFilterNode;
  private readonly engine: EngineVoice;
  private readonly roarFilter: BiquadFilterNode;
  private readonly hissFilter: BiquadFilterNode;
  private readonly roadGain: GainNode;
  private readonly sources: AudioBufferSourceNode[] = [];
  private readonly last = new Float64Array(6).fill(Number.NaN);
  /** This car's music, if `hasMusic`; its loop starts once rendered. */
  private readonly musicGain: GainNode;
  private readonly pick: CabinMusicPick = { loop: 0, level: 0, offset: 0, rate: 1 };
  private readonly openness: CabinOpenness = { left: 0, right: 0 };
  private hasMusic = false;
  private musicSource: AudioBufferSourceNode | null = null;
  private lastDistance = -1;
  private radialMps = 0;
  /** Last panner target; NaN until the first update, which snaps there. */
  private placedX = Number.NaN;
  private placedY = Number.NaN;
  private placedZ = Number.NaN;
  private hrtf = true;
  private disposed = false;

  constructor(
    private readonly mixer: AudioMixer,
    private readonly music: CabinMusic,
    carId: string,
  ) {
    const ctx = mixer.ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(mixer.traffic);

    this.panner = new PannerNode(ctx, {
      panningModel: 'HRTF',
      distanceModel: 'inverse',
      refDistance: 7,
      rolloffFactor: 1.15,
      maxDistance: 900,
    });
    this.air = ctx.createBiquadFilter();
    this.air.type = 'lowpass';
    this.air.frequency.value = AIR_HZ;
    this.air.Q.value = 0.6;
    this.air.connect(this.panner).connect(this.out);

    this.engine = new EngineVoice(mixer);
    const exhaust = ctx.createGain();
    exhaust.gain.value = 1;
    const bay = ctx.createGain();
    bay.gain.value = 0.55;
    this.engine.exhaust.connect(exhaust).connect(this.air);
    this.engine.bay.connect(bay).connect(this.air);

    this.roadGain = ctx.createGain();
    this.roadGain.gain.value = 0;
    this.roadGain.connect(this.air);
    this.roarFilter = ctx.createBiquadFilter();
    this.roarFilter.type = 'lowpass';
    this.roarFilter.frequency.value = ROAR_HZ;
    this.roarFilter.Q.value = 1.2;
    this.hissFilter = ctx.createBiquadFilter();
    this.hissFilter.type = 'bandpass';
    this.hissFilter.frequency.value = HISS_HZ;
    this.hissFilter.Q.value = 0.7;
    const roar = mixer.noiseSource('pink');
    const hiss = mixer.noiseSource('pink');
    this.sources.push(roar, hiss);
    const roarLevel = ctx.createGain();
    roarLevel.gain.value = 1.3;
    roar.connect(this.roarFilter).connect(roarLevel).connect(this.roadGain);
    hiss.connect(this.hissFilter).connect(this.roadGain);

    this.musicGain = ctx.createGain();
    this.musicGain.gain.value = 0;
    this.musicGain.connect(this.air);
    this.hasMusic = cabinMusicFor(carId, this.pick);

    ramp(this.out.gain, TRAFFIC_GAIN, mixer.now, 0.25);
  }

  /**
   * `x,y,z` is the car and `lx,ly,lz` the listener, both in the same (relative)
   * frame. `kit` is the car's rig, whose doors and windows let its music out. `dt` is
   * the frame's own delta.
   */
  update(
    state: VehicleAudioState,
    kit: KitRig | null,
    x: number,
    y: number,
    z: number,
    lx: number,
    ly: number,
    lz: number,
    dt: number,
  ): void {
    if (this.disposed) return;
    // Events belong to whoever voices them; traffic does not, so they are dropped.
    state.bumpMps = 0;
    state.bumpStopMps = 0;
    state.landingImpactMps = 0;
    state.impactMps = 0;

    const now = this.mixer.now;
    const distance = Math.hypot(x - lx, y - ly, z - lz);
    const fresh = this.lastDistance < 0;
    if (!fresh && dt > 0) {
      // A camera cut or a teleport is not a velocity: clamp it to a plausible road
      // closing speed and smooth, so the pitch cannot jump.
      const measured = Math.max(-80, Math.min(80, (distance - this.lastDistance) / dt));
      this.radialMps += (measured - this.radialMps) * Math.min(1, dt * 8);
    }
    this.lastDistance = distance;
    const pitch = SPEED_OF_SOUND / (SPEED_OF_SOUND + this.radialMps);

    const hrtf = distance < (this.hrtf ? EQUALPOWER_FROM_M : HRTF_WITHIN_M);
    if (hrtf !== this.hrtf) {
      this.hrtf = hrtf;
      this.panner.panningModel = hrtf ? 'HRTF' : 'equalpower';
    }
    if (fresh) {
      snapPannerPosition(this.panner, x, y, z, now);
      this.placedX = x;
      this.placedY = y;
      this.placedZ = z;
    } else if (
      Math.abs(x - this.placedX) > PLACE_EPS_M
      || Math.abs(y - this.placedY) > PLACE_EPS_M
      || Math.abs(z - this.placedZ) > PLACE_EPS_M
    ) {
      setPannerPosition(this.panner, x, y, z, now, 0.05);
      this.placedX = x;
      this.placedY = y;
      this.placedZ = z;
    }
    this.engine.update(state, pitch);
    const last = this.last;
    steer(this.air.frequency, last, AIR, Math.max(1800, 14000 / (1 + distance / 70)), now, 0.1);

    const speed = Math.abs(state.forwardMps);
    const t = Math.min(1, speed / ROAD_FULL_MPS);
    steer(this.roarFilter.frequency, last, ROAR, ROAR_HZ * pitch, now, 0.05);
    steer(this.hissFilter.frequency, last, HISS, (700 + 500 * t) * pitch, now, 0.05);
    steer(this.roadGain.gain, last, ROAD, ROAD_GAIN * t ** 1.6 * state.wheelContactFraction, now, 0.1);
    if (this.hasMusic) this.updateMusic(kit, distance, speed, pitch, now);
  }

  private updateMusic(kit: KitRig | null, distance: number, speed: number, pitch: number, now: number): void {
    let src = this.musicSource;
    if (!src) {
      const buffer = this.music.loops[this.pick.loop];
      if (!buffer) return;
      src = new AudioBufferSourceNode(this.mixer.ctx, { buffer, loop: true, playbackRate: this.pick.rate });
      src.connect(this.musicGain);
      src.start(now, this.pick.offset * buffer.duration);
      this.musicSource = src;
    }
    let level = 0;
    if (distance < MUSIC_FAR_M && this.music.level > 0) {
      const far = Math.min(1, Math.max(0, (distance - MUSIC_NEAR_M) / (MUSIC_FAR_M - MUSIC_NEAR_M)));
      const near = 1 - far * far * (3 - 2 * far);
      let open = 0;
      if (kit) {
        // From outside, the car's openings by side; a driver's ears are as good as any.
        cabinOpenness(kit, 'driver', 1, this.openness);
        open = (this.openness.left + this.openness.right) / 2;
      }
      const covered = 1 - MUSIC_SPEED_DROP * Math.min(1, speed / MUSIC_SPEED_MPS);
      level = CABIN_MUSIC_GAIN * this.pick.level * this.music.level * near * covered * (1 + MUSIC_OPEN_BOOST * open);
    }
    steer(this.musicGain.gain, this.last, MUSIC, level, now, 0.15);
    // Doppler moves the music with the engine.
    steer(src.playbackRate, this.last, MUSIC_RATE, this.pick.rate * pitch, now, 0.05);
  }

  private stopMusic(): void {
    if (!this.musicSource) return;
    this.musicSource.stop();
    this.musicSource.disconnect();
    this.musicSource = null;
  }

  /** Fades out; the owner parks or disposes it `TRAFFIC_RELEASE_S` later. */
  release(): void {
    if (this.disposed) return;
    ramp(this.out.gain, 0, this.mixer.now, 0.1);
  }

  /** Off the bus, its engine asleep and its music stopped, faded out, until `reuse`. */
  park(): void {
    if (this.disposed) return;
    this.out.disconnect();
    this.engine.sleep();
    this.stopMusic();
  }

  /**
   * A parked voice for car `carId`: back on the bus, every per-frame param where a new
   * voice's starts, fading in as one does, and that car's music, if any. The first
   * update places it outright and gives its engine the car's character.
   */
  reuse(carId: string): void {
    if (this.disposed) return;
    const now = this.mixer.now;
    this.out.connect(this.mixer.traffic);
    this.out.gain.cancelScheduledValues(now);
    this.out.gain.setValueAtTime(0, now);
    ramp(this.out.gain, TRAFFIC_GAIN, now, 0.25);
    for (const [param, value] of [
      [this.air.frequency, AIR_HZ],
      [this.roarFilter.frequency, ROAR_HZ],
      [this.hissFilter.frequency, HISS_HZ],
      [this.roadGain.gain, 0],
      [this.musicGain.gain, 0],
    ] as const) {
      param.cancelScheduledValues(now);
      param.setValueAtTime(value, now);
    }
    this.last.fill(Number.NaN);
    this.lastDistance = -1;
    this.radialMps = 0;
    this.stopMusic();
    this.hasMusic = cabinMusicFor(carId, this.pick);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const src of this.sources) src.stop();
    this.stopMusic();
    this.engine.dispose();
    this.out.disconnect();
    this.panner.disconnect();
  }
}
