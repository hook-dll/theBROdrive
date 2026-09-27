/**
 * Main-thread handle on one engine worklet (see engine-worklet.ts).
 *
 * The two outputs — `exhaust` (tailpipe) and `bay` (induction, valve train, clatter,
 * starter) — exist from construction, so callers wire their graph once; the worklet
 * node behind them arrives when the module has loaded, and is rebuilt when the car's
 * engine is swapped for a different one (its character is baked into the processor).
 */

import type { VehicleAudioState } from '../vehicle/vehicle';
import type { EngineCharacter } from './engine-worklet';
import { AudioMixer } from './mixer';

/** Smoothing on the rpm/load params. Short: the engine must answer the pedal. */
const PARAM_TAU = 0.025;

type EngineParam = 'rpm' | 'load' | 'running' | 'pitch' | 'destroyed' | 'idleRpm' | 'redlineRpm';
const ENGINE_PARAMS: readonly EngineParam[] = ['rpm', 'load', 'running', 'pitch', 'destroyed', 'idleRpm', 'redlineRpm'];

function characterOf(state: VehicleAudioState): EngineCharacter {
  return {
    cylinders: state.cylinders,
    diesel: state.fuel === 'diesel',
    displacementL: state.displacementL,
    turbo: state.turbo,
    seed: state.engineSeed,
  };
}

function characterKey(c: EngineCharacter): string {
  return `${c.cylinders}|${c.diesel}|${c.displacementL.toFixed(2)}|${c.turbo}|${c.seed.toFixed(3)}`;
}

export class EngineVoice {
  readonly exhaust: GainNode;
  readonly bay: GainNode;

  private node: AudioWorkletNode | null = null;
  private params: Record<EngineParam, AudioParam> | null = null;
  private splitter: ChannelSplitterNode | null = null;
  private key = '';
  private pending: EngineCharacter | null = null;
  private ready = false;
  private disposed = false;

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
    const character = characterOf(state);
    if (characterKey(character) !== this.key) {
      this.key = characterKey(character);
      if (this.ready) this.build(character);
      else this.pending = character;
    }
    const p = this.params;
    if (!p) return;
    const now = this.mixer.now;
    p.rpm.setTargetAtTime(state.rpm, now, PARAM_TAU);
    p.load.setTargetAtTime(Math.min(1, Math.max(0, state.throttle)), now, PARAM_TAU);
    p.running.setValueAtTime(state.engineRunning ? 1 : 0, now);
    p.pitch.setTargetAtTime(pitch, now, 0.05);
    p.destroyed.setValueAtTime(state.engineDestroyed ? 1 : 0, now);
    p.idleRpm.setValueAtTime(state.idleRpm, now);
    p.redlineRpm.setValueAtTime(state.redlineRpm, now);
  }

  /** Runs the starter and the first catching cycles. */
  crank(): void {
    this.node?.port.postMessage({ type: 'crank' });
  }

  private build(character: EngineCharacter): void {
    this.teardownNode();
    const ctx = this.mixer.ctx;
    this.node = new AudioWorkletNode(ctx, 'bro-engine', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions: character,
    });
    // AudioParamMap is maplike, but the DOM lib without DOM.Iterable types no `get`.
    const map = this.node.parameters as unknown as ReadonlyMap<string, AudioParam>;
    const params = {} as Record<EngineParam, AudioParam>;
    for (const name of ENGINE_PARAMS) params[name] = map.get(name)!;
    this.params = params;
    this.splitter = ctx.createChannelSplitter(2);
    this.node.connect(this.splitter);
    this.splitter.connect(this.exhaust, 0);
    this.splitter.connect(this.bay, 1);
    this.pending = null;
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
