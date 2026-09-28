/**
 * The engine, synthesised one combustion event at a time.
 *
 * WHY NOT OSCILLATORS. The voice this replaced was a periodic wave at the firing
 * frequency. A periodic wave is exactly what an engine is NOT: no two combustion
 * events in a real cylinder are the same size (cycle-to-cycle variation is several
 * per cent under load and far more at idle), no two cylinders are quite matched, and
 * what reaches the ear is not the pulses themselves but the pulses ringing down a
 * pipe. A perfect oscillator is heard, correctly, as a synthesiser.
 *
 * WHAT IS HERE (after Andy Farnell, "Designing Sound", the engine chapters):
 *
 *  - A crank angle integrated from rpm. Each cylinder fires at its own point of the
 *    720° cycle, with a small fixed timing and strength error of its own (seeded per
 *    engine: this Volga's number three is always the weak one), plus a fresh random
 *    error every cycle. That is what makes the half-order "lumpiness" of an idle.
 *  - Every firing excites the exhaust blowdown: a pressure pulse that rises in a
 *    fraction of a millisecond as the valve cracks open and decays over a few, whose
 *    height follows load: a closed throttle is manifold vacuum and small pulses, wide
 *    open is full cylinders. Turbulent noise rides inside the pulse envelope. The
 *    sharp front matters: a soft symmetric bump has no top end at all, and an exhaust
 *    made of them is a dull synthesiser thud however well the pipe is modelled.
 *  - The crank does not turn evenly: a strong firing kicks it faster, a weak one lets
 *    it sag, and the next firing arrives early or late accordingly. That coupling of
 *    strength and timing is the lope of a real idle.
 *  - Each cylinder blows down its own runner of the cast manifold, and the runners are
 *    not the same length, so every cylinder is coloured a little differently before
 *    they merge — the difference between an engine and four copies of one pulse.
 *  - The pulses go down a two-section waveguide: a short header and a long tailpipe,
 *    each a delay line with an inverting, damped reflection at its open end. The
 *    comb that makes is the pipe's own set of resonances — the "tube" in an exhaust
 *    note that no filter bank reproduces — and it does not move with rpm, which is
 *    why a real engine's tone changes character as the harmonics sweep through it.
 *    The speed of sound in the pipe follows the gas temperature, so the resonances
 *    climb as the engine is worked and settle back as it cools.
 *  - A muffler low-pass that opens with load, a DC block, a soft saturation, and the
 *    flow noise of gas leaving the tailpipe, which is born after the silencer and so
 *    is not filtered by it.
 *  - A second channel for the engine bay: induction (noise through an airbox
 *    resonance, per intake stroke), valve-train ticking, turbo whistle, starter
 *    motor, and rod knock for a destroyed engine; the block's own light ring under
 *    combustion, the belt-driven fan's blade-pass whoosh and a faint alternator whine.
 *
 * Output channel 0 is the tailpipe, channel 1 the engine bay, so the main thread can
 * place them at the two ends of the car and filter them differently through a cabin.
 *
 * Starting and stopping are the processor's own: a 'crank' message runs the starter
 * and the first catching cycles; dropping `running` is a stall, not a switch — the
 * last cylinders sputter and miss for half a second, a carburettor coughs, the crank
 * runs down through compression-only strokes, and the block rocks back on its
 * mounts as it stops.
 */

// AudioWorkletGlobalScope is not in the DOM lib.
declare const sampleRate: number;
declare function registerProcessor(name: string, ctor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: unknown);
}

export interface EngineCharacter {
  cylinders: number;
  displacementL: number;
  turbo: boolean;
  /** 0..1, stable per engine. */
  seed: number;
}

/** Speed of sound in exhaust gas, m/s: cool-ish at idle, hot under load. */
const C_EXHAUST_COOL = 400;
const C_EXHAUST_HOT = 560;
/** Blowdown rise time as a fraction of the pulse's decay. */
const PULSE_RISE = 0.3;
const TWO_PI = Math.PI * 2;

/** Fixed-size delay line with a fractional read. */
class Delay {
  private readonly buf: Float32Array;
  private write = 0;
  constructor(maxSamples: number) {
    this.buf = new Float32Array(Math.max(4, Math.ceil(maxSamples) + 4));
  }
  read(delaySamples: number): number {
    const n = this.buf.length;
    const d = Math.min(n - 2, Math.max(1, delaySamples));
    const pos = this.write - d;
    const i = Math.floor(pos);
    const f = pos - i;
    const a = this.buf[((i % n) + n) % n]!;
    const b = this.buf[(((i + 1) % n) + n) % n]!;
    return a + (b - a) * f;
  }
  push(x: number): void {
    this.buf[this.write] = x;
    this.write = (this.write + 1) % this.buf.length;
  }
}

/** Two-pole resonator, unity gain at its centre, for ringing things. */
class Resonator {
  private y1 = 0;
  private y2 = 0;
  private a1 = 0;
  private a2 = 0;
  private g = 0;
  set(freq: number, bandwidth: number): void {
    const r = Math.exp((-Math.PI * bandwidth) / sampleRate);
    const w = (TWO_PI * Math.min(freq, sampleRate * 0.45)) / sampleRate;
    this.a1 = 2 * r * Math.cos(w);
    this.a2 = -r * r;
    // Unity gain at the resonance, whatever the frequency.
    this.g = (1 - r) * Math.sqrt(1 - 2 * r * Math.cos(2 * w) + r * r);
  }
  tick(x: number): number {
    const y = this.g * x + this.a1 * this.y1 + this.a2 * this.y2;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

/** RBJ biquad low-pass, coefficients recomputed per block. */
class Lowpass {
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;
  set(freq: number, q: number): void {
    const w = (TWO_PI * Math.min(freq, sampleRate * 0.45)) / sampleRate;
    const alpha = Math.sin(w) / (2 * q);
    const cos = Math.cos(w);
    const a0 = 1 + alpha;
    this.b0 = (1 - cos) / 2 / a0;
    this.b1 = (1 - cos) / a0;
    this.b2 = this.b0;
    this.a1 = (-2 * cos) / a0;
    this.a2 = (1 - alpha) / a0;
  }
  tick(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

class EngineProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'rpm', defaultValue: 800, minValue: 0, maxValue: 12000, automationRate: 'k-rate' },
      { name: 'load', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'running', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      // Doppler / time scale: 1 is as-is. Scales every frequency INCLUDING the pipe.
      { name: 'pitch', defaultValue: 1, minValue: 0.5, maxValue: 2, automationRate: 'k-rate' },
      { name: 'destroyed', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'idleRpm', defaultValue: 800, minValue: 0, maxValue: 5000, automationRate: 'k-rate' },
      { name: 'redlineRpm', defaultValue: 6000, minValue: 100, maxValue: 12000, automationRate: 'k-rate' },
    ];
  }

  private readonly ch: EngineCharacter;
  /** Cleared by a 'stop' message; returning false lets the browser collect the node. */
  private alive = true;
  private rngState: number;

  // Crank.
  private phase = 0;
  private nextCyl = 0;
  private readonly fireAt: Float32Array;
  private readonly cylGain: Float32Array;
  private rpmNow = 0;
  private loadNow = 0;
  private wobble = 0;
  private wobbleTarget = 0;
  private wobbleTimer = 0;

  // Start / stop.
  private crankLeft = 0;
  private crankTotal = 0.72;
  private flare = 0;
  private spinDown = 0;
  private spinRpm = 0;
  /** Seconds of sputtering left after `running` drops, and its full length. */
  private sputterLeft = 0;
  private sputterTotal = 1;
  /** The block rocking back on its mounts as the crank stops: a low clunk, once. */
  private shudderEnv = 0;
  private thumpEnv = 0;
  private thumpPhase = 0;
  private thumpLp = 0;
  private readonly thumpHz: number;
  private wasRunning = false;
  private starterPhase = 0;

  // Exhaust pulse per cylinder: a difference of two one-poles (fast rise, slow fall).
  private readonly pSlow: Float64Array;
  private readonly pFast: Float64Array;
  private readonly kicks: Float64Array;
  private readonly runners: Delay[];
  private readonly runnerLen: Float32Array;
  private readonly runnerLp: Float64Array;
  private aSlow = 0.99;
  private aFast = 0.9;
  private pulseNorm = 1;
  /** Crank speed deviation from the governor's mean: kicked by each firing. */
  private speedDev = 0;
  /** Exhaust gas heat, 0..1: sets the speed of sound in the pipe. */
  private gasHeat = 0.3;
  private jetEnv = 0;
  private jetHp = 0;
  private jetLp = 0;
  private jetLp2 = 0;
  private popEnv = 0;
  private dcX = 0;
  private dcY = 0;
  private readonly header: Delay;
  private readonly tail: Delay;
  private headerLp = 0;
  private tailLp = 0;
  private readonly muffler = new Lowpass();
  private readonly muffler2 = new Lowpass();
  private readonly shell = new Resonator();

  // Engine bay.
  private intakeEnv = 0;
  private readonly airbox = new Resonator();
  private readonly airbox2 = new Resonator();
  private hissLp = 0;
  private clatterEnv = 0;
  private readonly clatter = new Resonator();
  private tickEnv = 0;
  private readonly valve = new Resonator();
  private knockEnv = 0;
  private readonly knock = new Resonator();
  private turboSpeed = 0;
  private turboPhase = 0;
  private readonly fan = new Resonator();
  private readonly fanBlades: number;
  private fanPhase = 0;
  private altPhase = 0;
  private altWobble = 0;
  private readonly bayLp = new Lowpass();

  // Per-block values `fire` reads, and the per-sample kicks it writes.
  private fBase = 0;
  private fCov = 0;
  private fLoad = 0;
  private fRev = 0;
  private fIdleness = 0;
  private fCombustion = 0;
  private fOverrun = false;
  /** 1 at the start of a stall's sputter, falling to 0. */
  private fSputter = 0;
  private kickIntake = 0;
  private kickClatter = 0;

  private readonly headerLen: number;
  private readonly tailLen: number;
  private readonly clatterHz: number;
  private readonly valveHz: number;
  private readonly shellHz: number;
  private readonly roughness: number;

  constructor(options: { processorOptions: EngineCharacter }) {
    super(options);
    this.ch = options.processorOptions;
    const { cylinders, seed, displacementL } = this.ch;
    this.rngState = (Math.floor(seed * 0xffffffff) ^ 0x5bd1e995) >>> 0 || 1;

    // Per-cylinder fixed personality. Cylinder 0 is the timing reference.
    const n = Math.max(1, Math.round(cylinders));
    this.fireAt = new Float32Array(n);
    this.cylGain = new Float32Array(n);
    // Tired Soviet engines are uneven.
    this.roughness = 0.6 + 0.8 * this.rand01();
    for (let k = 0; k < n; k++) {
      const offset = k === 0 ? 0 : (this.rand01() - 0.5) * 0.012 / n;
      this.fireAt[k] = (k + offset) / n;
      this.cylGain[k] = 1 + (this.rand01() - 0.5) * 0.22 * this.roughness;
    }
    // A two-cylinder four-stroke (the Oka) is not evenly spaced over 720°: its two
    // pistons rise together and fire 360° apart, which is still even. Keep it even.

    // Pipe geometry grows with the engine.
    const size = Math.min(4, Math.max(0.6, displacementL));
    this.headerLen = (0.35 + 0.12 * size) * (0.9 + 0.2 * this.rand01());
    this.tailLen = (2.1 + 0.55 * size) * (0.85 + 0.3 * this.rand01());
    this.header = new Delay(((2 * this.headerLen) / C_EXHAUST_COOL) * sampleRate * 2.2);
    this.tail = new Delay(((2 * this.tailLen) / C_EXHAUST_COOL) * sampleRate * 2.2);
    // Manifold runners: the outer cylinders' are longer, and casting is not precise.
    this.pSlow = new Float64Array(n);
    this.pFast = new Float64Array(n);
    this.kicks = new Float64Array(n);
    this.runnerLp = new Float64Array(n);
    this.runnerLen = new Float32Array(n);
    this.runners = [];
    for (let k = 0; k < n; k++) {
      const outer = Math.abs(k - (n - 1) / 2) / Math.max(1, (n - 1) / 2);
      this.runnerLen[k] = (0.22 + 0.2 * outer + 0.05 * size) * (0.9 + 0.2 * this.rand01());
      this.runners.push(new Delay(((2 * this.runnerLen[k]!) / C_EXHAUST_COOL) * sampleRate * 2.2));
    }
    // A petrol engine's soft pressure rise rings the block low and quietly.
    this.clatterHz = 1400 + 800 * this.rand01();
    this.fanBlades = 4 + Math.floor(this.rand01() * 3);
    this.fan.set(650 + 250 * this.rand01(), 900);
    // A tappet tick, not a cymbal: the classic's rocker clatter sits in the low kHz.
    this.valveHz = 2300 + 1000 * this.rand01();
    // The silencer's steel can booms at its own low mode: a big Volga lower than a
    // Zhiguli. When an engine order sweeps through it at cruise, the car drones.
    this.shellHz = (128 - 16 * size) * (0.92 + 0.16 * this.rand01());
    this.knock.set(900 + 500 * this.rand01(), 140);
    this.thumpHz = 42 + 16 * this.rand01();

    this.port.onmessage = (event: MessageEvent) => {
      const data = event.data as { type?: string } | null;
      if (data?.type === 'stop') {
        this.alive = false;
      } else if (data?.type === 'crank') {
        this.crankTotal = 0.55 + 0.35 * this.rand01();
        this.crankLeft = this.crankTotal;
        this.spinDown = 0;
      }
    };
  }

  /** One cylinder's combustion event: adds its kicks to this sample's accumulators. */
  private fire(k: number): void {
    let amp = this.fBase * this.cylGain[k]! * Math.max(0.15, 1 + this.fCov * this.gauss());
    if (this.fSputter > 0) {
      // Dying: some strokes still fire, weaker and weaker, the rest are compression
      // only; now and then a lean one coughs back through the carburettor.
      const u = this.fSputter;
      if (this.rand01() < 0.25 + 0.6 * u) amp = (0.25 + 0.75 * this.rand01()) * (0.3 + 0.7 * u);
      else amp = 0.1;
      if (this.rand01() < 0.06 * u) this.popEnv = 0.5;
      this.kicks[k] = this.kicks[k]! + amp;
      this.kickIntake += 0.3 * u * this.rand01();
      return;
    }
    if (this.fCombustion > 0 && this.fIdleness > 0.5 && this.rand01() < 0.003 * this.roughness) amp *= 0.3;
    // A stock carburettor car with a silencer only now and then burbles on a lift.
    if (this.fOverrun && this.rand01() < 0.004) {
      amp *= 1.6;
      this.popEnv = 0.35;
    }
    this.kicks[k] = this.kicks[k]! + amp;
    // The crank answers the firing: a strong one hurries the next, a weak one
    // delays it. Only noticeable where the flywheel has little speed to hide it in.
    if (this.fBase > 0) this.speedDev += (amp / this.fBase - 1) * (0.004 + 0.03 * this.fIdleness) * this.fCombustion;
    this.kickIntake += (0.25 + 0.75 * this.fLoad) * (0.8 + 0.4 * this.rand01());
    const block = 0.07 * (0.2 + 0.8 * this.fLoad) * (0.5 + 0.5 * this.fRev);
    this.kickClatter += this.fCombustion * block * (0.7 + 0.6 * this.rand01());
  }

  private rand(): number {
    let s = this.rngState;
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    this.rngState = s >>> 0;
    return (this.rngState / 0xffffffff) * 2 - 1;
  }

  private rand01(): number {
    return (this.rand() + 1) / 2;
  }

  /** Cheap near-Gaussian: sum of three uniforms, unit-ish variance. */
  private gauss(): number {
    return (this.rand() + this.rand() + this.rand()) * 0.577;
  }

  process(
    _inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean {
    if (!this.alive) return false;
    const out = outputs[0];
    if (!out || out.length === 0) return true;
    const exhaustOut = out[0]!;
    const bayOut = out[1] ?? out[0]!;
    const frames = exhaustOut.length;
    const dt = 1 / sampleRate;
    const blockSeconds = frames * dt;

    const pitch = parameters.pitch![0]!;
    const targetRpm = parameters.rpm![0]!;
    const targetLoad = parameters.load![0]!;
    const running = parameters.running![0]! > 0.5;
    const destroyed = parameters.destroyed![0]!;
    const idleRpm = Math.max(300, parameters.idleRpm![0]!);
    const redlineRpm = Math.max(idleRpm + 100, parameters.redlineRpm![0]!);
    const n = this.fireAt.length;

    // --- start / stop state machine ---------------------------------------------
    if (running && !this.wasRunning && this.crankLeft <= 0 && this.rpmNow < 50) {
      // Came to life without a crank request (a traffic car spawning already running):
      // start at speed, silently.
      this.rpmNow = targetRpm;
    }
    if (!running && this.wasRunning) {
      this.spinDown = 1;
      this.spinRpm = Math.max(this.rpmNow, idleRpm * 0.8);
      this.crankLeft = 0;
      // A crank that was only just turning stalls fast; a revving one sputters on.
      this.sputterTotal = 0.35 + 0.35 * this.rand01() + 0.15 * Math.min(1, this.rpmNow / 3000);
      this.sputterLeft = this.sputterTotal;
    }
    this.wasRunning = running;

    let effRpm: number;
    let combustion = running ? 1 : 0;
    let starter = 0;
    if (this.crankLeft > 0) {
      // Cranking: the starter turns the engine at ~200 rpm through compression
      // strokes; the last third of it the cylinders begin to catch.
      this.crankLeft -= blockSeconds;
      const t = 1 - this.crankLeft / this.crankTotal;
      effRpm = 190 + 50 * Math.sin(t * 17) + (t > 0.7 ? (t - 0.7) * 2000 : 0);
      combustion = t > 0.68 ? Math.min(1, (t - 0.68) * 4) * (this.rand01() < 0.8 ? 1 : 0.2) : 0;
      starter = t < 0.85 ? 1 : 0;
      if (this.crankLeft <= 0) this.flare = 1;
    } else if (this.spinDown > 0) {
      if (this.sputterLeft > 0) {
        // Still catching now and then: the revs sag and lurch rather than fall.
        this.sputterLeft -= blockSeconds;
        this.spinRpm *= Math.exp(-blockSeconds * 1.6);
        this.spinRpm = Math.max(this.spinRpm, idleRpm * 0.45);
        if (this.rand01() < 0.02) this.spinRpm += idleRpm * 0.12 * this.rand01();
      } else {
        this.spinRpm *= Math.exp(-blockSeconds * 3.2);
        this.spinRpm -= 90 * blockSeconds;
      }
      effRpm = Math.max(0, this.spinRpm);
      combustion = 0;
      if (effRpm < 40) {
        this.spinDown = 0;
        this.sputterLeft = 0;
        // The last compression stroke kicks the crank back and the block swings.
        this.shudderEnv = 1;
      }
    } else if (running) {
      effRpm = targetRpm;
    } else {
      effRpm = 0;
    }
    // Catch flare: the first revs overshoot idle before the idle circuit settles.
    if (this.flare > 0 && running) {
      effRpm += idleRpm * 0.7 * this.flare;
      this.flare = Math.max(0, this.flare - blockSeconds * 1.6);
    }

    // Idle wander: a slow random walk the governor never quite catches.
    this.wobbleTimer -= blockSeconds;
    if (this.wobbleTimer <= 0) {
      this.wobbleTarget = this.gauss();
      this.wobbleTimer = 0.25 + 0.4 * this.rand01();
    }
    this.wobble += (this.wobbleTarget - this.wobble) * Math.min(1, blockSeconds * 3);
    const idleness = Math.max(0, 1 - (effRpm - idleRpm) / 900);
    effRpm *= 1 + this.wobble * 0.011 * this.roughness * idleness;

    const rpmStart = this.rpmNow;
    const rpmEnd = effRpm;
    this.rpmNow = effRpm;
    this.loadNow += (targetLoad - this.loadNow) * Math.min(1, blockSeconds * 25);
    const load = this.loadNow;
    const rev = Math.min(1, Math.max(0, (effRpm - idleRpm) / (redlineRpm - idleRpm)));
    const overrun = load < 0.06 && effRpm > idleRpm + 1100 && running ? 1 : 0;

    // --- per-block coefficients --------------------------------------------------
    const fireHz = Math.max(1, (effRpm / 120) * n);
    const pulseDur = Math.min(0.0021, 0.2 / fireHz) * (0.8 + 0.12 * Math.min(4, this.ch.displacementL));
    const tau = Math.max(2, pulseDur * sampleRate / pitch);
    this.aSlow = Math.exp(-1 / tau);
    this.aFast = Math.exp(-1 / Math.max(0.5, tau * PULSE_RISE));
    // Peak of e^(-t/τ) - e^(-t/rτ) is fixed by r alone; normalise it to 1.
    {
      const r = PULSE_RISE;
      const tPeak = (r * Math.log(1 / r)) / (1 - r);
      this.pulseNorm = 1 / (Math.exp(-tPeak) - Math.exp(-tPeak / r));
    }

    // Gas heat: follows how hard the engine is worked, over a couple of seconds.
    const heatTarget = combustion > 0 ? 0.2 + 0.45 * load + 0.35 * rev : 0.1;
    this.gasHeat += (heatTarget - this.gasHeat) * Math.min(1, blockSeconds / 2.2);
    const cGas = C_EXHAUST_COOL + (C_EXHAUST_HOT - C_EXHAUST_COOL) * this.gasHeat;
    const hDelay = ((2 * this.headerLen) / cGas) * sampleRate / pitch;
    const tDelay = ((2 * this.tailLen) / cGas) * sampleRate / pitch;
    const runnerSamples = (2 * sampleRate) / (cGas * pitch);
    const loopK = 1 - Math.exp((-TWO_PI * 900 * pitch) / sampleRate);
    // A stock silencer: two chambers and a resonator. Wide open it still takes the
    // rasp off — an exhaust that opens to 4 kHz is a straight pipe, and a straight
    // four is then a light aircraft, not a Zhiguli.
    const open = 0.25 * rev + 0.75 * load;
    const muffHz = (420 + 850 * open * open + 200 * open) * pitch;
    this.muffler.set(muffHz, 0.7);
    this.muffler2.set(muffHz * 2.8, 0.5);
    // Gas leaving the tailpipe hisses in proportion to the flow through it.
    const flow = combustion > 0 ? (effRpm / redlineRpm) * (0.25 + 0.75 * load) : 0.1 * Math.min(1, effRpm / idleRpm);
    const jetAmt = 0.02 + 0.09 * flow;
    this.shell.set(this.shellHz * pitch, 45);

    // A carburettor's air filter hums; it does not chop. A wide noise band pulsed per
    // intake stroke is a propeller, so the band is narrow and low.
    const airboxHz = (150 + 260 * rev) * pitch;
    this.airbox.set(airboxHz, 40 + 45 * load);
    this.airbox2.set(airboxHz * 2.7, 180);
    this.clatter.set(this.clatterHz * pitch, 420);
    this.valve.set(this.valveHz * pitch, 700);
    this.bayLp.set((1400 + 2200 * (0.4 * rev + 0.6 * load)) * pitch, 0.7);

    // Pulse strength per firing, before per-event randomness.
    const base = combustion * (overrun ? 0.16 : 0.26 + 0.74 * load) + (1 - combustion) * 0.1;
    const cov = (0.035 + 0.1 * idleness + (overrun ? 0.12 : 0)) * this.roughness;
    // Turbulence inside the pulse is the exhaust's grit; a silenced car has little.
    const noiseAmt = 0.1 + 0.14 * load;
    this.fBase = base;
    this.fCov = cov;
    this.fLoad = load;
    this.fRev = rev;
    this.fIdleness = idleness;
    this.fCombustion = combustion;
    this.fOverrun = overrun === 1;
    this.fSputter = this.sputterLeft > 0 ? this.sputterLeft / this.sputterTotal : 0;
    const shudderKick = this.shudderEnv;
    this.shudderEnv = 0;

    // Turbo: spools with exhaust energy, slowly, and runs down more slowly still.
    const turboTarget = this.ch.turbo && running ? Math.min(1, rev ** 1.4 * (0.25 + 0.75 * load) * 1.3) : 0;
    const turboK = turboTarget > this.turboSpeed ? blockSeconds / 1.1 : blockSeconds / 1.8;
    this.turboSpeed += (turboTarget - this.turboSpeed) * Math.min(1, turboK);
    const turboHz = (1800 + 6200 * this.turboSpeed) * pitch;
    const turboAmp = this.turboSpeed * this.turboSpeed * 0.05;

    const starterHz = (95 + 25 * Math.sin(this.phase * TWO_PI)) * pitch;
    // Belt-driven: fan on the water-pump pulley, alternator geared up ~2x with 36
    // rectified ripples per turn. Both only while the crank turns.
    const shaftHz = (effRpm / 60) * pitch;
    const fanHz = shaftHz * 1.1 * this.fanBlades;
    const fanAmp = 0.22 * Math.min(1, (effRpm / 4200) ** 2);
    this.altWobble += (this.gauss() * 0.4 - this.altWobble) * Math.min(1, blockSeconds * 4);
    const altHz = shaftHz * 2.05 * 36 * (1 + 0.002 * this.altWobble);
    const altAmp = effRpm > 200 ? 0.0007 : 0;
    // Crank speed deviation settles within a firing interval or two.
    const speedDecay = Math.exp(-blockSeconds * fireHz * 0.7);
    const valvesPerCycle = n * 2;

    // --- samples -----------------------------------------------------------------
    this.speedDev *= speedDecay;
    for (let i = 0; i < frames; i++) {
      const rpm = rpmStart + (rpmEnd - rpmStart) * (i / frames);
      const prevPhase = this.phase;
      this.phase += (rpm / 120) * dt * pitch * (1 + this.speedDev);

      this.kickIntake = 0;
      this.kickClatter = 0;
      // Firings due this sample (never more than one in practice).
      while (this.nextCyl < n && this.phase >= this.fireAt[this.nextCyl]!) this.fire(this.nextCyl++);
      if (this.phase >= 1) {
        this.phase -= 1;
        this.nextCyl = 0;
        while (this.nextCyl < n && this.phase >= this.fireAt[this.nextCyl]!) this.fire(this.nextCyl++);
      }
      const intakeKick = this.kickIntake;
      const clatterKick = this.kickClatter;
      // Valve closings: twice per cylinder per cycle.
      if (Math.floor(this.phase * valvesPerCycle) !== Math.floor(prevPhase * valvesPerCycle)) {
        this.tickEnv = 0.6 + 0.4 * this.rand01();
      }
      // Rod knock: once per crank revolution, i.e. twice per cycle.
      if (destroyed > 0 && Math.floor(this.phase * 2) !== Math.floor(prevPhase * 2)) {
        this.knockEnv = destroyed * (0.5 + 0.5 * load) * (0.7 + 0.6 * this.rand01());
      }

      // Blowdown pulses, each down its own runner into the collector.
      const white = this.rand();
      let x = 0;
      let env = 0;
      for (let k = 0; k < n; k++) {
        const kick = this.kicks[k]!;
        this.kicks[k] = 0;
        this.pSlow[k] = this.aSlow * this.pSlow[k]! + kick;
        this.pFast[k] = this.aFast * this.pFast[k]! + kick;
        const pulse = (this.pSlow[k]! - this.pFast[k]!) * this.pulseNorm;
        env += pulse;
        const runner = this.runners[k]!;
        const back = runner.read(this.runnerLen[k]! * runnerSamples);
        this.runnerLp[k] = this.runnerLp[k]! + (back - this.runnerLp[k]!) * loopK;
        const y = pulse * (1 + noiseAmt * white) - 0.2 * this.runnerLp[k]!;
        runner.push(y);
        x += y;
      }
      if (this.popEnv > 0) {
        x += this.popEnv * white * 0.9;
        this.popEnv *= 0.9965;
        if (this.popEnv < 1e-3) this.popEnv = 0;
      }

      // DC block (~25 Hz): blowdown pulses are all positive pressure.
      const dc = x - this.dcX + 0.9967 * this.dcY;
      this.dcX = x;
      this.dcY = dc;

      // Header: short pipe, mild inverting reflection.
      const hBack = this.header.read(hDelay);
      this.headerLp += (hBack - this.headerLp) * loopK;
      const h = dc - 0.22 * this.headerLp;
      this.header.push(h);
      // Tailpipe: the long one, stronger reflection, damped in the loop.
      const tBack = this.tail.read(tDelay);
      this.tailLp += (tBack - this.tailLp) * loopK;
      const t = h - 0.5 * this.tailLp;
      this.tail.push(t);

      let ex = this.muffler2.tick(this.muffler.tick(t));
      ex += this.shell.tick(ex) * 1.1;
      // Tailpipe flow noise, gated by the pulses arriving at the outlet.
      this.jetEnv += (Math.abs(ex) - this.jetEnv) * 0.02;
      const jw = this.rand();
      // A band around 1-2.5 kHz: a small pipe's jet, not a hiss up to 16 kHz.
      this.jetHp += (jw - this.jetHp) * 0.12;
      this.jetLp += (jw - this.jetHp - this.jetLp) * 0.28;
      this.jetLp2 += (this.jetLp - this.jetLp2) * 0.28;
      ex += this.jetLp2 * this.jetEnv * jetAmt;
      // Soft saturation: a hard-worked exhaust gets gritty, a quiet one stays clean.
      const drive = 1 + 0.35 * load;
      ex = Math.tanh(ex * drive) / drive;
      exhaustOut[i] = ex * 0.9;

      // --- engine bay ---
      this.intakeEnv = this.intakeEnv * 0.9965 + intakeKick;
      const induction = this.airbox.tick(white * this.intakeEnv) * 1.5 + this.airbox2.tick(white * this.intakeEnv) * 0.3;
      this.hissLp += (white - this.hissLp) * 0.35;
      const hiss = (white - this.hissLp) * load * rev * 0.01;

      this.clatterEnv = this.clatterEnv * 0.985 + clatterKick;
      const clat = this.clatter.tick(white * this.clatterEnv) * 0.9;

      this.tickEnv *= 0.93;
      const ticks = this.valve.tick(white * this.tickEnv) * 0.05 * (0.3 + rev) * running01(combustion, this.spinDown);

      this.knockEnv *= 0.992;
      const knock = this.knock.tick(white * this.knockEnv) * 1.6;
      // Rubber and steel taking up the swing: a dull clunk with a little rattle.
      if (i === 0 && shudderKick > 0) {
        this.thumpEnv = shudderKick;
        this.thumpPhase = 0;
      }
      let thump = 0;
      if (this.thumpEnv > 1e-4) {
        this.thumpPhase += (this.thumpHz * pitch) / sampleRate;
        this.thumpLp += (white - this.thumpLp) * 0.02;
        thump = (Math.sin(this.thumpPhase * TWO_PI) * 0.5 + this.thumpLp * 2.5) * this.thumpEnv * 0.6;
        this.thumpEnv *= 0.99985;
      }

      let whistle = 0;
      if (turboAmp > 1e-5) {
        this.turboPhase += (turboHz * dt) % 1;
        if (this.turboPhase >= 1) this.turboPhase -= 1;
        whistle = Math.sin(this.turboPhase * TWO_PI) * turboAmp * (0.85 + 0.15 * white);
      }

      let starterSig = 0;
      if (starter > 0) {
        this.starterPhase += starterHz * dt;
        if (this.starterPhase >= 1) this.starterPhase -= 1;
        // A buzzy DC motor through a bendix: saw with a little hash.
        starterSig = (this.starterPhase * 2 - 1) * 0.07 + white * 0.015;
      }

      let fanSig = 0;
      let alt = 0;
      if (fanAmp > 1e-5) {
        this.fanPhase += fanHz * dt;
        if (this.fanPhase >= 1) this.fanPhase -= Math.floor(this.fanPhase);
        // Each blade passing the radiator is a puff: a whoosh with a flutter at the
        // blade rate that becomes a hum as the revs rise.
        const blade = 0.5 + 0.5 * Math.cos(this.fanPhase * TWO_PI);
        fanSig = this.fan.tick(white) * fanAmp * (0.45 + 0.55 * blade * blade);
      }
      if (altAmp > 0) {
        this.altPhase += altHz * dt;
        if (this.altPhase >= 1) this.altPhase -= Math.floor(this.altPhase);
        alt = Math.sin(this.altPhase * TWO_PI) * altAmp;
      }

      // Some exhaust pulse gets through the block as mechanical body.
      const bay = this.bayLp.tick(induction + clat + ticks + knock + starterSig + thump + fanSig + dc * 0.25) + hiss + whistle + alt;
      bayOut[i] = bay;
      if (out[1] === undefined) exhaustOut[i] = exhaustOut[i]! + bay;
    }
    return true;
  }
}

/** Valve-train noise exists while the crank turns, fired or not. */
function running01(combustion: number, spinDown: number): number {
  return combustion > 0 || spinDown > 0 ? 1 : 0.5;
}

registerProcessor('bro-engine', EngineProcessor);
