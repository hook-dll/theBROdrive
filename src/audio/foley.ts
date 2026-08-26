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

import { SurfaceType } from '../core/surfaces';
import { AudioMixer, ramp } from './mixer';

/** Metres of ground covered per footstep. A stride, not a tick. */
const STRIDE_METRES = 1.5;
/** Speed (m/s) below which the player is standing still and no steps are emitted. */
const STEP_MIN_MPS = 0.4;

const SCRUB_GAIN = 0.16;
const POUR_GAIN = 0.14;
/** Breath level while a bubble is being inflated. Kept below footsteps and impacts. */
const GUM_BLOW_GAIN = 0.11;

export type FoleyEvent =
  | 'enter-car'
  | 'exit-car'
  | 'pickup'
  | 'mount'
  | 'detach'
  | 'drop'
  | 'refused';

export type FoleyContinuous = 'scrub' | 'pour' | null;

export type BubbleGumAudioPhase = 'idle' | 'chew' | 'blow';

export class Foley {
  private readonly out: GainNode;

  private readonly scrubFilter: BiquadFilterNode;
  private readonly scrubGain: GainNode;
  private readonly pourGain: GainNode;
  private readonly gumBlowFilter: BiquadFilterNode;
  private readonly gumBlowGain: GainNode;
  private readonly sources: AudioBufferSourceNode[] = [];

  private strideAccum = 0;
  private stepParity = 0;
  private wasGrounded = true;
  private gumPhase: BubbleGumAudioPhase = 'idle';
  private gumChewTimer = 0;
  private gumChewParity = 0;
  private gumBlowWanderTimer = 0;

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

    // Exhaled breath is broad turbulence shaped by the mouth. A low-Q band pass
    // keeps it airy without turning it into static; the slow formant drift below
    // stops a five-second blow sounding like a machine loop.
    this.gumBlowFilter = ctx.createBiquadFilter();
    this.gumBlowFilter.type = 'bandpass';
    this.gumBlowFilter.frequency.value = 1050;
    this.gumBlowFilter.Q.value = 0.65;
    this.gumBlowGain = ctx.createGain();
    this.gumBlowGain.gain.value = 0;
    this.addNoise(this.gumBlowFilter);
    this.gumBlowFilter.connect(this.gumBlowGain).connect(this.out);
  }

  private addNoise(destination: AudioNode): void {
    const src = this.mixer.noiseSource();
    src.connect(destination);
    this.sources.push(src);
  }

  /**
   * Walking. `speedMps` is horizontal ground speed, `grounded` the character
   * controller's own flag, and `surface` is the collider supporting the capsule.
   * A landing is the frame grounded goes back to true.
   */
  updateWalk(dt: number, speedMps: number, grounded: boolean, surface: SurfaceType): void {
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
      this.step(speedMps, surface);
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

  /**
   * Gum mouth sounds follow simulation time, so pausing also pauses the three
   * seconds of chewing instead of letting a wall-clock sound schedule run ahead.
   */
  updateBubbleGum(dt: number, phase: BubbleGumAudioPhase): void {
    if (phase !== this.gumPhase) {
      this.gumPhase = phase;
      const now = this.mixer.now;
      ramp(this.gumBlowGain.gain, phase === 'blow' ? GUM_BLOW_GAIN : 0, now, 0.055);

      if (phase === 'chew') {
        this.gumChewTimer = 0;
      } else if (phase === 'blow') {
        this.gumBlowWanderTimer = 0;
        // Soft lip release at the front of the sustained breath.
        this.mixer.burst(this.out, {
          gain: 0.075,
          frequency: 720,
          q: 0.7,
          attack: 0.035,
          decay: 0.16,
          type: 'lowpass',
        });
        this.mixer.blip(this.out, {
          gain: 0.025,
          frequency: 145,
          endFrequency: 95,
          decay: 0.13,
          type: 'sine',
        });
      } else {
        this.gumChewTimer = 0;
      }
    }

    if (phase === 'chew') {
      this.gumChewTimer -= dt;
      if (this.gumChewTimer <= 0) {
        this.chewGum();
        this.gumChewParity ^= 1;
        this.gumChewTimer += this.gumChewParity ? 0.37 : 0.44;
      }
    } else if (phase === 'blow') {
      this.gumBlowWanderTimer -= dt;
      if (this.gumBlowWanderTimer <= 0) {
        const now = this.mixer.now;
        const frequency = 880 + Math.random() * 360;
        this.gumBlowFilter.frequency.setTargetAtTime(frequency, now, 0.16);
        this.gumBlowWanderTimer += 0.32;
      }
    }
  }

  /** Wet gum compression, jaw body and a quiet lip closure in one human chew. */
  private chewGum(): void {
    const pitch = this.gumChewParity ? 760 : 890;
    this.mixer.burst(this.out, {
      gain: 0.09,
      frequency: pitch,
      q: 0.9,
      attack: 0.008,
      decay: 0.085,
      type: 'lowpass',
    });
    this.mixer.burst(this.out, {
      gain: 0.025,
      frequency: 1850 + this.gumChewParity * 220,
      q: 1.8,
      decay: 0.035,
    });
    this.mixer.blip(this.out, {
      gain: 0.022,
      frequency: 105,
      endFrequency: 72,
      decay: 0.07,
      type: 'sine',
    });
  }

  /** Bubble membrane snap over the small, low slap heard back at the lips. */
  bubbleGumPop(): void {
    this.mixer.burst(this.out, {
      gain: 0.32,
      frequency: 1900,
      q: 0.55,
      attack: 0.001,
      decay: 0.105,
    });
    this.mixer.burst(this.out, {
      gain: 0.13,
      frequency: 180,
      q: 0.75,
      decay: 0.075,
      type: 'lowpass',
    });
    this.mixer.blip(this.out, {
      gain: 0.045,
      frequency: 260,
      endFrequency: 88,
      decay: 0.09,
      type: 'sine',
    });
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

  private step(speedMps: number, surface: SurfaceType): void {
    // Alternate feet: pitch changes keep either material from sounding like a
    // metronome striking the same sample.
    this.stepParity ^= 1;
    const heavy = speedMps > 5;

    if (surface === SurfaceType.Sand) {
      // A boot in dry sand has no hard impact transient. The broad low crunch is
      // the sole compressing the bed, the higher short layer is grains shearing
      // around its edge, and only a muted heel body survives underneath.
      this.mixer.burst(this.out, {
        gain: heavy ? 0.13 : 0.085,
        frequency: (this.stepParity ? 980 : 850) * (heavy ? 1.08 : 1),
        q: 0.62,
        attack: 0.014,
        decay: heavy ? 0.15 : 0.12,
        type: 'lowpass',
      });
      this.mixer.burst(this.out, {
        gain: heavy ? 0.055 : 0.036,
        frequency: this.stepParity ? 2700 : 2350,
        q: 0.8,
        attack: 0.006,
        decay: heavy ? 0.09 : 0.07,
      });
      this.mixer.burst(this.out, {
        gain: heavy ? 0.045 : 0.028,
        frequency: 95,
        q: 0.65,
        decay: 0.075,
        type: 'lowpass',
      });
      return;
    }

    // Keep the established hard-ground footstep unchanged for road, gravel,
    // concrete and rock.
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
