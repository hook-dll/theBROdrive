import type { VehicleAudioState } from '../vehicle/vehicle';
import { AudioMixer, ramp } from './mixer';

/** A deliberately small exterior engine voice: one pulse, one body resonance and a panner. */
export class TrafficEngineAudio {
  private readonly out: GainNode;
  private readonly panner: PannerNode;
  private readonly fireOsc: OscillatorNode;
  private readonly bodyOsc: OscillatorNode;
  private readonly lowpass: BiquadFilterNode;
  private readonly engineGain: GainNode;
  private disposed = false;

  constructor(private readonly mixer: AudioMixer) {
    const ctx = mixer.ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(mixer.sfx);

    this.panner = new PannerNode(ctx, {
      panningModel: 'HRTF',
      distanceModel: 'inverse',
      refDistance: 5,
      rolloffFactor: 0.7,
      maxDistance: 900,
    });
    this.panner.connect(this.out);

    this.lowpass = ctx.createBiquadFilter();
    this.lowpass.type = 'lowpass';
    this.lowpass.frequency.value = 1100;
    this.lowpass.Q.value = 0.7;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0.8;
    this.engineGain.connect(this.lowpass).connect(this.panner);

    const wave = ctx.createPeriodicWave(
      new Float32Array([0, 1, 0.42, 0.16, 0.06]),
      new Float32Array([0, 1, 0.45, 0.18, 0.07]),
    );
    this.fireOsc = ctx.createOscillator();
    this.fireOsc.setPeriodicWave(wave);
    this.fireOsc.connect(this.engineGain);

    this.bodyOsc = ctx.createOscillator();
    this.bodyOsc.type = 'sine';
    const bodyGain = ctx.createGain();
    bodyGain.gain.value = 0.42;
    this.bodyOsc.connect(bodyGain).connect(this.engineGain);

    this.fireOsc.start();
    this.bodyOsc.start();
  }

  update(state: VehicleAudioState, x: number, y: number, z: number): void {
    if (this.disposed) return;
    const now = this.mixer.now;
    const fire = Math.max(12, (state.rpm / 60) * (state.cylinders / 2));
    const rev = Math.max(0, Math.min(1, (state.rpm - state.idleRpm) / Math.max(1, state.redlineRpm - state.idleRpm)));
    const load = Math.max(0, Math.min(1, state.throttle));
    this.panner.positionX.setTargetAtTime(x, now, 0.08);
    this.panner.positionY.setTargetAtTime(y, now, 0.08);
    this.panner.positionZ.setTargetAtTime(z, now, 0.08);
    this.fireOsc.frequency.setTargetAtTime(fire, now, 0.04);
    this.bodyOsc.frequency.setTargetAtTime(Math.max(20, fire * 0.5), now, 0.04);
    this.lowpass.frequency.setTargetAtTime(750 + 2200 * (0.35 * rev + 0.65 * load), now, 0.06);
    ramp(this.out.gain, state.engineRunning ? 0.75 : 0, now, 0.12);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.fireOsc.stop();
    this.bodyOsc.stop();
    this.out.disconnect();
    this.panner.disconnect();
  }
}
