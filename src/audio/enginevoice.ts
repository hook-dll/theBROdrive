/**
 * Main-thread handle on one engine worklet (see engine-worklet.ts).
 *
 * The two outputs — `exhaust` (tailpipe) and `bay` (induction, valve train, clatter,
 * starter) — exist from construction, so callers wire their graph once; the worklet
 * node behind them arrives when the module has loaded. A different engine (the car's
 * engine swapped, or a pooled traffic voice given another car) is a 'character'
 * message: the processor builds a fresh engine in place, its params go back to their
 * defaults, and no node is made or rewired.
 */

import type { VehicleAudioState } from '../vehicle/vehicle';
import type { EngineCharacter } from './engine-worklet';
import { AudioMixer, steer } from './mixer';

/** Smoothing on the rpm/load params. Short: the engine must answer the pedal. */
const PARAM_TAU = 0.025;

type EngineParam = 'rpm' | 'load' | 'running' | 'pitch' | 'destroyed' | 'idleRpm' | 'redlineRpm';
/** Each param and its default in the processor's descriptors: a fresh node's values. */
const ENGINE_PARAMS: readonly (readonly [EngineParam, number])[] = [
  ['rpm', 800],
  ['load', 0],
  ['running', 0],
  ['pitch', 1],
  ['destroyed', 0],
  ['idleRpm', 800],
  ['redlineRpm', 6000],
];
/** Slots in `EngineVoice.last`, in ENGINE_PARAMS order. */
const RPM = 0;
const LOAD = 1;
const RUNNING = 2;
const PITCH = 3;
const DESTROYED = 4;
const IDLE = 5;
const REDLINE = 6;

export class EngineVoice {
  readonly exhaust: GainNode;
  readonly bay: GainNode;

  private node: AudioWorkletNode | null = null;
  private params: AudioParam[] | null = null;
  private splitter: ChannelSplitterNode | null = null;
  /**
   * The engine character last asked for, as the old string key rounded it (displacement
   * to 0.01 L, seed to 0.001); `cylinders` -1 is none, so the next update sends one.
   */
  private cylinders = -1;
  private displacementCl = 0;
  private turbo = false;
  private seedMilli = 0;
  private pending: EngineCharacter | null = null;
  private ready = false;
  private disposed = false;
  /** Last value written to each param (`steer`); NaN when the param is at its default. */
  private readonly last = new Float64Array(ENGINE_PARAMS.length).fill(Number.NaN);
  /** The car whose starter this voice follows, and the last crank count it saw of it. */
  private crankOf: VehicleAudioState | null = null;
  private crankSeq = 0;

  constructor(private readonly mixer: AudioMixer) {
    this.exhaust = mixer.ctx.createGain();
    this.bay = mixer.ctx.createGain();
    mixer.whenEngineReady(() => {
      this.ready = true;
      if (this.pending && !this.disposed) this.build(this.pending);
    });
  }

  /**
   * Per-frame parameters. `pitch` is the Doppler factor for an outside observer (1
   * for the car you are in).
   */
  update(state: VehicleAudioState, pitch = 1): void {
    if (this.disposed) return;
    const displacementCl = Math.round(state.displacementL * 100);
    const seedMilli = Math.round(state.engineSeed * 1000);
    if (
      state.cylinders !== this.cylinders
      || displacementCl !== this.displacementCl
      || state.turbo !== this.turbo
      || seedMilli !== this.seedMilli
    ) {
      this.cylinders = state.cylinders;
      this.displacementCl = displacementCl;
      this.turbo = state.turbo;
      this.seedMilli = seedMilli;
      const character: EngineCharacter = {
        cylinders: state.cylinders,
        displacementL: state.displacementL,
        turbo: state.turbo,
        seed: state.engineSeed,
      };
      if (this.ready) this.build(character);
      else this.pending = character;
    }
    // The starter, on a change of the car's crank count (`VehicleAudioState.crankSeq`).
    // The first count a voice sees of a car is where it picks up, never an event: a voice
    // given a car already running plays no start.
    if (state !== this.crankOf) {
      this.crankOf = state;
      this.crankSeq = state.crankSeq;
    } else if (state.crankSeq !== this.crankSeq) {
      this.crankSeq = state.crankSeq;
      this.node?.port.postMessage(
        state.crankSeconds > 0
          ? { type: 'crank', seconds: state.crankSeconds, catches: state.crankCatches }
          : { type: 'crank-stop' },
      );
    }
    const p = this.params;
    if (!p) return;
    const now = this.mixer.now;
    const last = this.last;
    steer(p[RPM]!, last, RPM, state.rpm, now, PARAM_TAU);
    steer(p[LOAD]!, last, LOAD, Math.min(1, Math.max(0, state.throttle)), now, PARAM_TAU);
    steer(p[PITCH]!, last, PITCH, pitch, now, 0.05);
    // Steps, written when they change. A car with no engine fitted reports a redline of
    // 1; keep the params in range rather than have the browser warn about it.
    this.step(RUNNING, state.engineRunning ? 1 : 0, now);
    this.step(DESTROYED, state.engineDestroyed ? 1 : 0, now);
    this.step(IDLE, Math.min(5000, Math.max(0, state.idleRpm)), now);
    this.step(REDLINE, Math.min(12000, Math.max(100, state.redlineRpm)), now);
  }

  /**
   * Silences the processor while the voice waits in the traffic pool; the next update
   * sends its car's character, which wakes it with a fresh engine.
   */
  sleep(): void {
    this.cylinders = -1;
    this.crankOf = null;
    this.node?.port.postMessage({ type: 'sleep' });
  }

  private step(slot: number, value: number, now: number): void {
    if (this.last[slot] === value) return;
    this.last[slot] = value;
    this.params![slot]!.setValueAtTime(value, now);
  }

  private build(character: EngineCharacter): void {
    this.pending = null;
    if (this.node && this.params) {
      this.node.port.postMessage({ type: 'character', character });
      // A fresh engine starts from a fresh node's params, as it always did.
      const now = this.mixer.now;
      for (let i = 0; i < ENGINE_PARAMS.length; i++) {
        const param = this.params[i]!;
        param.cancelScheduledValues(now);
        param.setValueAtTime(ENGINE_PARAMS[i]![1], now);
      }
      this.last.fill(Number.NaN);
      return;
    }
    const ctx = this.mixer.ctx;
    this.node = new AudioWorkletNode(ctx, 'bro-engine', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions: character,
    });
    // AudioParamMap is maplike, but the DOM lib without DOM.Iterable types no `get`.
    const map = this.node.parameters as unknown as ReadonlyMap<string, AudioParam>;
    this.params = ENGINE_PARAMS.map(([name]) => map.get(name)!);
    this.last.fill(Number.NaN);
    this.splitter = ctx.createChannelSplitter(2);
    this.node.connect(this.splitter);
    this.splitter.connect(this.exhaust, 0);
    this.splitter.connect(this.bay, 1);
  }

  private teardownNode(): void {
    if (!this.node) return;
    this.node.port.postMessage({ type: 'stop' });
    this.node.disconnect();
    this.splitter?.disconnect();
    this.node = null;
    this.params = null;
    this.splitter = null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.teardownNode();
    this.exhaust.disconnect();
    this.bay.disconnect();
  }
}
