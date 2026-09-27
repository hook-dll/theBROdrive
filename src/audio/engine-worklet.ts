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
 *  - Every firing excites a critically damped pulse — the exhaust blowdown — whose
 *    height follows load: a closed throttle is manifold vacuum and small pulses, wide
 *    open is full cylinders. Turbulent noise rides inside the pulse envelope.
 *  - The pulses go down a two-section waveguide: a short header and a long tailpipe,
 *    each a delay line with an inverting, damped reflection at its open end. The
 *    comb that makes is the pipe's own set of resonances — the "tube" in an exhaust
 *    note that no filter bank reproduces — and it does not move with rpm, which is
 *    why a real engine's tone changes character as the harmonics sweep through it.
 *  - A muffler low-pass that opens with load, a DC block, a soft saturation.
 *  - A second channel for the engine bay: induction (noise through an airbox
 *    resonance, per intake stroke), valve-train ticking, diesel combustion clatter,
 *    turbo whistle, starter motor, and rod knock for a destroyed engine.
 *
 * Output channel 0 is the tailpipe, channel 1 the engine bay, so the main thread can
 * place them at the two ends of the car and filter them differently through a cabin.
 *
 * Starting and stopping are the processor's own: a 'crank' message runs the starter
 * and the first catching cycles; dropping `running` spins the crank down through a
 * few compression-only strokes instead of cutting to silence.
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
  diesel: boolean;
  displacementL: number;
  turbo: boolean;
  /** 0..1, stable per engine. */
  seed: number;
}

/** Speed of sound in hot exhaust gas, m/s. */
const C_EXHAUST = 500;
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
  private wasRunning = false;
  private starterPhase = 0;

  // Exhaust pulse (two cascaded one-poles excited by impulses).
  private e1 = 0;
  private e2 = 0;
  private pulseA = 0.99;
  private pulseNorm = 1;
  private popEnv = 0;
  private dcX = 0;
  private dcY = 0;
  private readonly header: Delay;
  private readonly tail: Delay;
  private headerLp = 0;
  private tailLp = 0;
  private readonly muffler = new Lowpass();
  private readonly muffler2 = new Lowpass();

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
  private readonly bayLp = new Lowpass();

  // Per-block values `fire` reads, and the per-sample kicks it writes.
  private fBase = 0;
  private fCov = 0;
  private fLoad = 0;
  private fRev = 0;
  private fIdleness = 0;
  private fCombustion = 0;
  private fOverrun = false;
  private kickExhaust = 0;
  private kickIntake = 0;
  private kickClatter = 0;

  private readonly headerLen: number;
  private readonly tailLen: number;
  private readonly clatterHz: number;
  private readonly valveHz: number;
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
    // Tired Soviet engines are uneven; a diesel's injectors are matched worse still.
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
    this.header = new Delay(((2 * this.headerLen) / C_EXHAUST) * sampleRate * 2.2);
    this.tail = new Delay(((2 * this.tailLen) / C_EXHAUST) * sampleRate * 2.2);
    this.clatterHz = 2300 + 1300 * this.rand01();
    this.valveHz = 3800 + 1800 * this.rand01();
    this.knock.set(900 + 500 * this.rand01(), 140);

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
    if (this.fCombustion > 0 && this.fIdleness > 0.5 && this.rand01() < 0.003 * this.roughness) amp *= 0.3;
    if (this.fOverrun && this.rand01() < 0.02) {
      amp *= 2.4;
      this.popEnv = 1;
    }
    this.kickExhaust += amp;
    this.kickIntake += (0.25 + 0.75 * this.fLoad) * (0.8 + 0.4 * this.rand01());
    if (this.ch.diesel) {
      this.kickClatter +=
        this.fCombustion * (1 - 0.55 * this.fRev) * (0.6 + 0.4 * this.fLoad) * (0.7 + 0.6 * this.rand01());
    }
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
    const diesel = this.ch.diesel;
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
      this.spinRpm *= Math.exp(-blockSeconds * 3.2);
      this.spinRpm -= 60 * blockSeconds;
      effRpm = Math.max(0, this.spinRpm);
      combustion = 0;
      if (effRpm < 40) this.spinDown = 0;
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
    effRpm *= 1 + this.wobble * 0.011 * this.roughness * idleness * (diesel ? 0.6 : 1);

    const rpmStart = this.rpmNow;
    const rpmEnd = effRpm;
    this.rpmNow = effRpm;
    this.loadNow += (targetLoad - this.loadNow) * Math.min(1, blockSeconds * 25);
    const load = this.loadNow;
    const rev = Math.min(1, Math.max(0, (effRpm - idleRpm) / (redlineRpm - idleRpm)));
    const overrun = !diesel && load < 0.06 && effRpm > idleRpm + 1100 && running ? 1 : 0;

    // --- per-block coefficients --------------------------------------------------
    const fireHz = Math.max(1, (effRpm / 120) * n);
    const pulseDur = Math.min(0.0032, 0.24 / fireHz) * (0.8 + 0.12 * Math.min(4, this.ch.displacementL));
    const tau = Math.max(2, pulseDur * sampleRate / pitch);
    this.pulseA = Math.exp(-1 / tau);
    this.pulseNorm = Math.E / ((1 - this.pulseA) * tau);

    const hDelay = ((2 * this.headerLen) / C_EXHAUST) * sampleRate / pitch;
    const tDelay = ((2 * this.tailLen) / C_EXHAUST) * sampleRate / pitch;
    const loopK = 1 - Math.exp((-TWO_PI * 1400 * pitch) / sampleRate);
    const open = diesel ? 0.35 + 0.5 * rev + 0.15 * load : 0.25 * rev + 0.75 * load;
    const muffHz = (320 + 3000 * open * open + 500 * open) * pitch;
    this.muffler.set(muffHz, 0.75);
    this.muffler2.set(muffHz * 1.6, 0.6);

    const airboxHz = (170 + 380 * rev) * pitch;
    this.airbox.set(airboxHz, 70 + 80 * load);
    this.airbox2.set(airboxHz * 2.7, 260);
    this.clatter.set(this.clatterHz * pitch, 420);
    this.valve.set(this.valveHz * pitch, 900);
    this.bayLp.set((1800 + 3500 * (0.4 * rev + 0.6 * load)) * pitch, 0.7);

    // Pulse strength per firing, before per-event randomness.
    let base: number;
    if (diesel) base = combustion * (0.45 + 0.55 * load) + (1 - combustion) * 0.12;
    else base = combustion * (overrun ? 0.16 : 0.26 + 0.74 * load) + (1 - combustion) * 0.1;
    const cov = (0.035 + 0.1 * idleness + (overrun ? 0.12 : 0)) * this.roughness;
    const noiseAmt = 0.18 + 0.45 * load;
    this.fBase = base;
    this.fCov = cov;
    this.fLoad = load;
    this.fRev = rev;
    this.fIdleness = idleness;
    this.fCombustion = combustion;
    this.fOverrun = overrun === 1;

    // Turbo: spools with exhaust energy, slowly, and runs down more slowly still.
    const turboTarget = this.ch.turbo && running ? Math.min(1, rev ** 1.4 * (0.25 + 0.75 * load) * 1.3) : 0;
    const turboK = turboTarget > this.turboSpeed ? blockSeconds / 1.1 : blockSeconds / 1.8;
    this.turboSpeed += (turboTarget - this.turboSpeed) * Math.min(1, turboK);
    const turboHz = (1800 + 6200 * this.turboSpeed) * pitch;
    const turboAmp = this.turboSpeed * this.turboSpeed * 0.05;

    const starterHz = (95 + 25 * Math.sin(this.phase * TWO_PI)) * pitch;
    const valvesPerCycle = n * 2;

    // --- samples -----------------------------------------------------------------
    for (let i = 0; i < frames; i++) {
      const rpm = rpmStart + (rpmEnd - rpmStart) * (i / frames);
      const prevPhase = this.phase;
      this.phase += (rpm / 120) * dt * pitch;

      this.kickExhaust = 0;
      this.kickIntake = 0;
      this.kickClatter = 0;
      // Firings due this sample (never more than one in practice).
      while (this.nextCyl < n && this.phase >= this.fireAt[this.nextCyl]!) this.fire(this.nextCyl++);
      if (this.phase >= 1) {
        this.phase -= 1;
        this.nextCyl = 0;
        while (this.nextCyl < n && this.phase >= this.fireAt[this.nextCyl]!) this.fire(this.nextCyl++);
      }
      const impulse = this.kickExhaust;
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

      // Exhaust pulse: alpha-function shape, peak normalised to the impulse height.
      this.e1 = this.pulseA * this.e1 + impulse * this.pulseNorm;
      this.e2 = this.pulseA * this.e2 + (1 - this.pulseA) * this.e1;
      const env = this.e2;
      const white = this.rand();
      let x = env * (1 + noiseAmt * white);
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
      const h = dc - 0.32 * this.headerLp;
      this.header.push(h);
      // Tailpipe: the long one, stronger reflection, damped in the loop.
      const tBack = this.tail.read(tDelay);
      this.tailLp += (tBack - this.tailLp) * loopK;
      const t = h - 0.5 * this.tailLp;
      this.tail.push(t);

      let ex = this.muffler2.tick(this.muffler.tick(t));
      // Soft saturation: a hard-worked exhaust gets gritty, a quiet one stays clean.
      const drive = 1.2 + 1.6 * load;
      ex = Math.tanh(ex * drive) / drive;
      exhaustOut[i] = ex * 0.9;

      // --- engine bay ---
      this.intakeEnv = this.intakeEnv * 0.9965 + intakeKick;
      const induction = this.airbox.tick(white * this.intakeEnv) * 2.2 + this.airbox2.tick(white * this.intakeEnv) * 0.7;
      this.hissLp += (white - this.hissLp) * 0.35;
      const hiss = (white - this.hissLp) * load * rev * 0.035;

      this.clatterEnv = this.clatterEnv * 0.985 + clatterKick;
      const clat = this.clatter.tick(white * this.clatterEnv) * 0.9;

      this.tickEnv *= 0.93;
      const ticks = this.valve.tick(white * this.tickEnv) * 0.08 * (0.3 + rev) * running01(combustion, this.spinDown);

      this.knockEnv *= 0.992;
      const knock = this.knock.tick(white * this.knockEnv) * 1.6;

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

      // Some exhaust pulse gets through the block as mechanical body.
      const bay = this.bayLp.tick(induction + clat + ticks + knock + starterSig + dc * 0.25) + hiss + whistle;
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
