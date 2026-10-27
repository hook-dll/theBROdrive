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
 */

import { AUDIO_CONFIG } from '../config';
import type { VehicleAudioState } from '../vehicle/vehicle';
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

/** Initial values of the per-frame params, as built (`reuse` puts them back). */
const AIR_HZ = 12000;
const ROAR_HZ = 380;
const HISS_HZ = 900;
/** `steer` slots. */
const AIR = 0;
const ROAR = 1;
const HISS = 2;
const ROAD = 3;

export class TrafficAudio {
  private readonly out: GainNode;
  private readonly panner: PannerNode;
  private readonly air: BiquadFilterNode;
  private readonly engine: EngineVoice;
  private readonly roarFilter: BiquadFilterNode;
  private readonly hissFilter: BiquadFilterNode;
  private readonly roadGain: GainNode;
  private readonly sources: AudioBufferSourceNode[] = [];
  private readonly last = new Float64Array(4).fill(Number.NaN);
  private lastDistance = -1;
  private radialMps = 0;
  /** Last panner target; NaN until the first update, which snaps there. */
  private placedX = Number.NaN;
  private placedY = Number.NaN;
  private placedZ = Number.NaN;
  private hrtf = true;
  private disposed = false;

  constructor(private readonly mixer: AudioMixer) {
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

    ramp(this.out.gain, TRAFFIC_GAIN, mixer.now, 0.25);
  }

  /**
   * `x,y,z` is the car and `lx,ly,lz` the listener, both in the same (relative)
   * frame. `dt` is the frame's own delta.
   */
  update(
    state: VehicleAudioState,
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
  }

  /** Fades out; the owner parks or disposes it `TRAFFIC_RELEASE_S` later. */
  release(): void {
    if (this.disposed) return;
    ramp(this.out.gain, 0, this.mixer.now, 0.1);
  }

  /** Off the bus and its engine asleep, faded out, until `reuse`. */
  park(): void {
    if (this.disposed) return;
    this.out.disconnect();
    this.engine.sleep();
  }

  /**
   * A parked voice for another car: back on the bus, every per-frame param where a new
   * voice's starts, and fading in as one does. The first update places it outright and
   * gives its engine the car's character.
   */
  reuse(): void {
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
    ] as const) {
      param.cancelScheduledValues(now);
      param.setValueAtTime(value, now);
    }
    this.last.fill(Number.NaN);
    this.lastDistance = -1;
    this.radialMps = 0;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const src of this.sources) src.stop();
    this.engine.dispose();
    this.out.disconnect();
    this.panner.disconnect();
  }
}
