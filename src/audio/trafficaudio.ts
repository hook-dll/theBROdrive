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
 */

import { AUDIO_CONFIG } from '../config';
import type { VehicleAudioState } from '../vehicle/vehicle';
import { EngineVoice } from './enginevoice';
import { AudioMixer, ramp, setPannerPosition } from './mixer';

const SPEED_OF_SOUND = 343;
const TRAFFIC_GAIN = AUDIO_CONFIG.trafficGain;
/** Road-layer level at `ROAD_FULL_MPS`. */
const ROAD_GAIN = 0.55;
const ROAD_FULL_MPS = 30;

export class TrafficAudio {
  private readonly out: GainNode;
  private readonly panner: PannerNode;
  private readonly air: BiquadFilterNode;
  private readonly engine: EngineVoice;
  private readonly roarFilter: BiquadFilterNode;
  private readonly hissFilter: BiquadFilterNode;
  private readonly roadGain: GainNode;
  private readonly sources: AudioBufferSourceNode[] = [];
  private lastDistance = -1;
  private radialMps = 0;
  private disposed = false;

  constructor(private readonly mixer: AudioMixer) {
    const ctx = mixer.ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(mixer.sfx);

    this.panner = new PannerNode(ctx, {
      panningModel: 'HRTF',
      distanceModel: 'inverse',
      refDistance: 7,
      rolloffFactor: 1.15,
      maxDistance: 900,
    });
    this.air = ctx.createBiquadFilter();
    this.air.type = 'lowpass';
    this.air.frequency.value = 12000;
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
    this.roarFilter.frequency.value = 380;
    this.roarFilter.Q.value = 1.2;
    this.hissFilter = ctx.createBiquadFilter();
    this.hissFilter.type = 'bandpass';
    this.hissFilter.frequency.value = 900;
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
    state.landingImpactMps = 0;
    state.impactMps = 0;

    const now = this.mixer.now;
    const distance = Math.hypot(x - lx, y - ly, z - lz);
    if (this.lastDistance >= 0 && dt > 0) {
      // A camera cut or a teleport is not a velocity: clamp it to a plausible road
      // closing speed and smooth, so the pitch cannot jump.
      const measured = Math.max(-80, Math.min(80, (distance - this.lastDistance) / dt));
      this.radialMps += (measured - this.radialMps) * Math.min(1, dt * 8);
    }
    this.lastDistance = distance;
    const pitch = SPEED_OF_SOUND / (SPEED_OF_SOUND + this.radialMps);

    setPannerPosition(this.panner, x, y, z, now, 0.05);
    this.engine.update(state, pitch);
    this.air.frequency.setTargetAtTime(Math.max(1800, 14000 / (1 + distance / 70)), now, 0.1);

    const speed = Math.abs(state.forwardMps);
    const t = Math.min(1, speed / ROAD_FULL_MPS);
    this.roarFilter.frequency.setTargetAtTime(380 * pitch, now, 0.05);
    this.hissFilter.frequency.setTargetAtTime((700 + 500 * t) * pitch, now, 0.05);
    ramp(this.roadGain.gain, ROAD_GAIN * t ** 1.6 * state.wheelContactFraction, now, 0.1);
  }

  /** Fades out, then tears down. */
  release(): void {
    if (this.disposed) return;
    ramp(this.out.gain, 0, this.mixer.now, 0.1);
    window.setTimeout(() => this.dispose(), 600);
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
