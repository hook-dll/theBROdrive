/**
 * On-foot and hand foley: footsteps, jumps and landings, the sounds of picking
 * things up and bolting them on, scrubbing, pouring fuel, and gunfire.
 *
 * Footsteps are driven by distance travelled rather than a timer, so a sprint
 * steps faster than a walk for the same reason a real one does, and stopping
 * mid-stride does not leave a step queued.
 *
 * The two continuous actions (scrubbing a part, pouring a can) hold one voice each
 * and are gated by a per-frame flag from Interaction; nothing here polls state.
 */

import { AudioMixer, ramp } from './mixer';

/** Metres of ground covered per footstep. A stride, not a tick. */
const STRIDE_METRES = 1.5;
/** Speed (m/s) below which the player is standing still and no steps are emitted. */
const STEP_MIN_MPS = 0.4;

const SCRUB_GAIN = 0.16;
const POUR_GAIN = 0.14;

export type FoleyEvent =
  | 'enter-car'
  | 'exit-car'
  | 'pickup'
  | 'mount'
  | 'detach'
  | 'drop'
  | 'refused';

export type FoleyContinuous = 'scrub' | 'pour' | null;

export class Foley {
  private readonly out: GainNode;

  private readonly scrubFilter: BiquadFilterNode;
  private readonly scrubGain: GainNode;
  private readonly pourGain: GainNode;
  private readonly sources: AudioBufferSourceNode[] = [];

  private strideAccum = 0;
  private stepParity = 0;
  private wasGrounded = true;

  constructor(private readonly mixer: AudioMixer) {
    const ctx = mixer.ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 1;
    this.out.connect(mixer.sfx);

    // Scrubbing: a brush on dirty metal is band-limited noise, and the band moves
    // as the stroke does. One filter sweep does the whole gesture.
    this.scrubFilter = ctx.createBiquadFilter();
    this.scrubFilter.type = 'bandpass';
    this.scrubFilter.frequency.value = 2600;
    this.scrubFilter.Q.value = 1.4;
    this.scrubGain = ctx.createGain();
    this.scrubGain.gain.value = 0;
    this.addNoise(this.scrubFilter);
    this.scrubFilter.connect(this.scrubGain).connect(this.out);

    const pourFilter = ctx.createBiquadFilter();
    pourFilter.type = 'bandpass';
    pourFilter.frequency.value = 1500;
    pourFilter.Q.value = 0.9;
    this.pourGain = ctx.createGain();
    this.pourGain.gain.value = 0;
    this.addNoise(pourFilter);
    pourFilter.connect(this.pourGain).connect(this.out);
  }

  private addNoise(destination: AudioNode): void {
    const src = this.mixer.noiseSource();
    src.connect(destination);
    this.sources.push(src);
  }

  /**
   * Walking. `speedMps` is horizontal ground speed, `grounded` the character
   * controller's own flag — a landing is the frame grounded goes back to true.
   */
  updateWalk(dt: number, speedMps: number, grounded: boolean): void {
    if (grounded && !this.wasGrounded) this.land();
    this.wasGrounded = grounded;

    if (!grounded || speedMps < STEP_MIN_MPS) {
      // Reset just short of a step so the first stride after standing still lands
      // promptly instead of instantly.
      this.strideAccum = Math.min(this.strideAccum, STRIDE_METRES * 0.7);
      return;
    }

    this.strideAccum += speedMps * dt;
    if (this.strideAccum >= STRIDE_METRES) {
      this.strideAccum -= STRIDE_METRES;
      this.step(speedMps);
    }
  }

  /** Both continuous actions in one call: at most one can be running. */
  setContinuous(action: FoleyContinuous): void {
    const now = this.mixer.now;
    ramp(this.scrubGain.gain, action === 'scrub' ? SCRUB_GAIN : 0, now, 0.06);
    ramp(this.pourGain.gain, action === 'pour' ? POUR_GAIN : 0, now, 0.06);
    if (action === 'scrub') {
      // Sweep the band so a held stroke does not sit on one static hiss.
      this.scrubFilter.frequency.setTargetAtTime(1800 + Math.random() * 1600, now, 0.12);
    }
  }

  event(event: FoleyEvent): void {
    switch (event) {
      case 'enter-car':
      case 'exit-car':
        // Door: a body thump with a latch click on top. Closing is the tighter of
        // the two, so entering (door pulled shut) gets the shorter decay.
        this.mixer.burst(this.out, {
          gain: 0.3,
          frequency: event === 'enter-car' ? 130 : 110,
          q: 0.8,
          decay: event === 'enter-car' ? 0.12 : 0.16,
          type: 'lowpass',
        });
        this.mixer.blip(this.out, { gain: 0.09, frequency: 900, endFrequency: 420, decay: 0.05 });
        break;
      case 'pickup':
        this.mixer.burst(this.out, { gain: 0.18, frequency: 700, q: 1.5, decay: 0.07 });
        break;
      case 'mount':
        // Bolting a gizmo on: two metallic hits and a short ring.
        this.mixer.burst(this.out, { gain: 0.22, frequency: 1400, q: 3, decay: 0.06 });
        this.mixer.blip(this.out, { gain: 0.1, frequency: 2100, decay: 0.16 });
        break;
      case 'detach':
        this.mixer.burst(this.out, { gain: 0.2, frequency: 1000, q: 2.2, decay: 0.09 });
        break;
      case 'drop':
        this.mixer.burst(this.out, { gain: 0.24, frequency: 220, q: 0.9, decay: 0.14, type: 'lowpass' });
        break;
      case 'refused':
        // Too heavy / wrong fuel: a dull, deliberately unsatisfying knock.
        this.mixer.blip(this.out, { gain: 0.07, frequency: 220, endFrequency: 150, decay: 0.09 });
        break;
    }
  }

  /** A shot: muzzle crack over a body thump, plus the action working. */
  gunshot(): void {
    this.mixer.burst(this.out, { gain: 0.55, frequency: 1800, q: 0.6, decay: 0.09 });
    this.mixer.burst(this.out, { gain: 0.4, frequency: 180, q: 0.7, decay: 0.22, type: 'lowpass' });
    this.mixer.blip(this.out, { gain: 0.1, frequency: 3200, endFrequency: 900, decay: 0.07 });
  }

  /** Dry fire: firing pin, nothing else. */
  dryFire(): void {
    this.mixer.blip(this.out, { gain: 0.12, frequency: 1600, endFrequency: 700, decay: 0.04 });
  }

  reload(): void {
    this.mixer.burst(this.out, { gain: 0.2, frequency: 1100, q: 2.5, decay: 0.07 });
    window.setTimeout(() => {
      this.mixer.burst(this.out, { gain: 0.18, frequency: 800, q: 2, decay: 0.08 });
    }, 130);
  }

  private step(speedMps: number): void {
    // Alternate feet: a small pitch offset is enough to stop a run sounding like a
    // metronome hitting the same board.
    this.stepParity ^= 1;
    const heavy = speedMps > 5;
    this.mixer.burst(this.out, {
      gain: heavy ? 0.16 : 0.1,
      frequency: (this.stepParity ? 520 : 430) * (heavy ? 1.15 : 1),
      q: 1.1,
      decay: heavy ? 0.09 : 0.07,
    });
    this.mixer.burst(this.out, {
      gain: heavy ? 0.09 : 0.05,
      frequency: 120,
      q: 0.8,
      decay: 0.06,
      type: 'lowpass',
    });
  }

  private land(): void {
    this.mixer.burst(this.out, { gain: 0.24, frequency: 150, q: 0.7, decay: 0.13, type: 'lowpass' });
    this.mixer.burst(this.out, { gain: 0.1, frequency: 700, q: 1.2, decay: 0.07 });
  }

  dispose(): void {
    for (const src of this.sources) src.stop();
    this.sources.length = 0;
    this.out.disconnect();
  }
}
