/**
 * tools/ride-bench.ts
 *
 * Ride bench for the road's surface field. It answers the only question that
 * matters about bumpiness: what does a WHEEL feel, given that the wheel does not
 * feel the analytic field at all — it ray-casts against the trimesh, which is
 * piecewise linear between its vertex rows.
 *
 * Four views of one wheel path, each along the REAL mesh profile (the rows the road
 * provider emits, interpolated linearly between them, as the collider is):
 *
 *   BANDS   RMS of the profile by wavelength (Hann-windowed FFT at 0.1 m). The bands
 *           are where a car responds to them, not round numbers:
 *             >40 m    road shape: the car follows it, nobody feels it as a ride.
 *             10-40 m  the FLOAT band. A body on 1.1-1.3 Hz springs is driven at its
 *                      own resonance by 10-15 m waves at 60 km/h and 18-25 m at
 *                      100: this is the band that makes a car swim like a boat.
 *             3-10 m   pitch and heave above resonance: felt, but as motion.
 *             <3 m     the jolt band: what reaches the wheel as a hit.
 *   KICK    on a linear collider a wheel's vertical velocity is slope * speed, and it
 *           changes discontinuously at every row: `kick = |Δslope| * speed`, m/s. The
 *           safety cap lives here — the worst single pothole is held under 2.8 m/s
 *           at 90 km/h (POTH_MAX_RAMP in roadsurface.ts).
 *   STEP    the same, but as the 60 Hz physics actually samples it: one ray per
 *           fixed step, so a feature shorter than a step is landed on or missed, and
 *           the damper is handed whatever ramp the ray landed on. `ramp` is the
 *           steepest |slope| on the mesh, the most a single step can be handed.
 *           `hit/km` counts steps where that input jumps by more than 0.5 m/s: a
 *           thing the wheel struck rather than rode over.
 *   CAR     a quarter car (1.15 Hz, ζ 0.3: the catalogue's Zhiguli) driven over the
 *           mesh plus the sub-collider profile (core/surfaces.ts) at the 60 Hz step.
 *           `float` is the RMS of its body acceleration below ~2 Hz, `sharp` above.
 *   EVENTS  road events (roadsurface.ts) the wheel path crosses, per km, and the
 *           old single-row notches (rows 15 mm under both neighbours).
 *
 * The wheel is tracked down a real wheel path (roadmesh.ts WHEEL_PATH_LATERALS),
 * not down the centreline, because that is where the road is worn.
 *
 *   npx tsx tools/ride-bench.ts [speedKmh]
 *
 * Nothing here is part of the game bundle.
 */

import { RoadTexture, MicroRelief, SurfaceType, SURFACES } from '../src/core/surfaces';
import { FIXED_DT } from '../src/core/physics';
import { roadConditionAt } from '../src/world/gradient';
import { ROAD_HALF_WIDTH } from '../src/world/road';
import { EVENT_MAX_KNOTS, SURFACE_STEP, SurfaceField } from '../src/world/roadsurface';

/** Right-lane wheel paths, from roadmesh.ts. A car sits in one lane, not both. */
const WHEEL_PATHS = [0.85, 2.45];
/** Seeds sampled and averaged; bumpiness must not be a seed lottery. */
const SEEDS = [1, 7, 42, 1337];
/** Metres of road measured per progress band. */
const SPAN_M = 3000;
/** A single-row dip counts as a pothole hit past this depth below its neighbours, mm. */
const NOTCH_MM = 15;
/** Resampling step for the spectrum, metres. */
const FFT_STEP = 0.1;
/** Wavelength band edges, metres, longest first. */
const BAND_EDGES = [Infinity, 40, 10, 3, 2 * FFT_STEP];
/** Quarter car: body frequency and damping ratio. */
const BODY_HZ = 1.15;
const BODY_ZETA = 0.3;
/** A compression faster than this counts as one hit; same as surface-feel.ts. */
const HIT_MPS = 0.5;
/** Steps a hit must be clear of the last one to count again. */
const HIT_GAP_STEPS = 12;
/** Centred-mean half window, steps, splitting the float band from the jolts. */
const FLOAT_HALF_WINDOW = 12;

const speedKmh = Number(process.argv[2] ?? 60);
const speed = speedKmh / 3.6;

/**
 * Where to measure, in metres of arclength. ABSOLUTE distances: road quality is
 * stationary in absolute distance (see gradient.ts), and the first row has to be the
 * first kilometre, because that is the road the player learns the car on.
 */
interface Band {
  label: string;
  s: number;
}

const BANDS: Band[] = [
  { label: '0.6 km    ', s: 600 },
  { label: '20 km     ', s: 20_000 },
  { label: '200 km    ', s: 200_000 },
  { label: '2 000 km  ', s: 2_000_000 },
  { label: '20 000 km ', s: 20_000_000 },
  { label: '39 000 km ', s: 39_000_000 },
];

interface Ride {
  decay: number;
  /** RMS of the mesh profile, mm. */
  rmsMm: number;
  /** RMS per wavelength band (BAND_EDGES), mm. */
  bandMm: number[];
  /** RMS of the sub-collider profile the vehicle adds per wheel, mm. */
  subMm: number;
  kickP99: number;
  kickMax: number;
  /** 60 Hz-sampled change of damper input per step, m/s: p99 and worst. */
  stepP99: number;
  stepMax: number;
  /** Steepest |slope| anywhere on the mesh path. */
  rampMax: number;
  /** Quarter-car body acceleration RMS, g: below and above ~2 Hz. */
  floatG: number;
  sharpG: number;
  /** Quarter-car suspension travel RMS, mm. */
  travelMm: number;
  /** Discrete compression hits per km. */
  hitsPerKm: number;
  /** Road events this wheel path crosses, per km. */
  eventsPerKm: number;
  notchesPerKm: number;
}

/** In-place iterative radix-2 FFT. */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    const wr = Math.cos(angle);
    const wi = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k + len / 2]! * cr - im[i + k + len / 2]! * ci;
        const ai = re[i + k + len / 2]! * ci + im[i + k + len / 2]! * cr;
        re[i + k + len / 2] = re[i + k]! - ar;
        im[i + k + len / 2] = im[i + k]! - ai;
        re[i + k] = re[i + k]! + ar;
        im[i + k] = im[i + k]! + ai;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
}

/** RMS per wavelength band of a uniformly sampled profile, after removing its trend. */
function bandRms(h: Float64Array, step: number): number[] {
  let n = 1;
  while (n < h.length) n <<= 1;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const count = h.length;
  // Linear detrend, then Hann.
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < count; i++) {
    sx += i; sy += h[i]!; sxx += i * i; sxy += i * h[i]!;
  }
  const slope = (count * sxy - sx * sy) / (count * sxx - sx * sx);
  const icept = (sy - slope * sx) / count;
  let w2 = 0;
  for (let i = 0; i < count; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (count - 1));
    re[i] = (h[i]! - icept - slope * i) * w;
    w2 += w * w;
  }
  fft(re, im);
  const out = new Array<number>(BAND_EDGES.length - 1).fill(0);
  for (let k = 1; k < n / 2; k++) {
    const lambda = (n * step) / k;
    const power = (2 * (re[k]! ** 2 + im[k]! ** 2)) / (count * w2);
    for (let b = 0; b < out.length; b++) {
      if (lambda <= BAND_EDGES[b]! && lambda > BAND_EDGES[b + 1]!) out[b] += power;
    }
  }
  return out.map((p) => Math.sqrt(p) * 1000);
}

/**
 * The mesh profile down one lateral line: the rows the road provider emits from `s0`
 * for SPAN_M — base rows SURFACE_STEP apart and the road-event rows inside their gaps
 * — and the height the collider has on each. Linear between rows. An event row is its
 * gap's base rows interpolated plus the event, exactly as roadmesh.ts builds it.
 */
function meshProfile(
  field: SurfaceField,
  seed: number,
  s0: number,
  lateral: number,
  surface: SurfaceType | undefined,
): { s: number[]; h: number[]; decaySum: number; baseRows: number; events: number } {
  const count = Math.round(SPAN_M / SURFACE_STEP);
  const base: number[] = [];
  let decaySum = 0;
  for (let i = 0; i <= count; i++) {
    const at = s0 + i * SURFACE_STEP;
    const cond = roadConditionAt(seed, at);
    decaySum += cond.decay;
    // The edge break is 2D world noise; the road is locally straight enough over
    // 3 km that walking x with s is a faithful stand-in for offsetPoint here, and
    // it keeps the bench independent of the road's curvature.
    base.push(
      field.displacement(at, lateral, at, lateral, cond.decay, surface ?? cond.surface, ROAD_HALF_WIDTH),
    );
  }
  const s: number[] = [];
  const h: number[] = [];
  const rows = new Float64Array(EVENT_MAX_KNOTS);
  let events = 0;
  for (let i = 0; i <= count; i++) {
    const sA = s0 + i * SURFACE_STEP;
    s.push(sA);
    h.push(base[i]!);
    if (i === count) break;
    const n = field.eventRows(sA, rows, 0);
    let touched = false;
    for (let k = 0; k < n; k++) {
      const at = rows[k]!;
      const t = (at - sA) / SURFACE_STEP;
      const event = field.eventAt(at, lateral, ROAD_HALF_WIDTH);
      if (Math.abs(event) > 5e-4) touched = true;
      s.push(at);
      h.push(base[i]! + (base[i + 1]! - base[i]!) * t + event);
    }
    if (touched) events++;
  }
  return { s, h, decaySum, baseRows: count + 1, events };
}

/** `surface` forces one material over the whole span; otherwise the road's own district. */
function measureBand(seed: number, s0: number, surface?: SurfaceType): Ride {
  const field = new SurfaceField(seed, surface ?? null);
  const micro = new MicroRelief(seed);
  const texture = new RoadTexture(seed);

  const kicks: number[] = [];
  const steps: number[] = [];
  const bands = new Array<number>(BAND_EDGES.length - 1).fill(0);
  let sumSq = 0;
  let samples = 0;
  let decay = 0;
  let notches = 0;
  let subSq = 0;
  let subN = 0;
  let rampMax = 0;
  let floatSq = 0;
  let sharpSq = 0;
  let bandN = 0;
  let travelSq = 0;
  let travelN = 0;
  let hits = 0;
  let events = 0;

  for (const lateral of WHEEL_PATHS) {
    const profile = meshProfile(field, seed, s0, lateral, surface);
    const { s, h } = profile;
    events += profile.events;
    if (lateral === WHEEL_PATHS[0]) decay = profile.decaySum / profile.baseRows;

    for (let i = 1; i < s.length - 1; i++) {
      const before = (h[i]! - h[i - 1]!) / (s[i]! - s[i - 1]!);
      const after = (h[i + 1]! - h[i]!) / (s[i + 1]! - s[i]!);
      kicks.push(Math.abs(after - before) * speed);
      rampMax = Math.max(rampMax, Math.abs(after));
      sumSq += h[i]! * h[i]!;
      samples++;
      const notch = (Math.min(h[i - 1]!, h[i + 1]!) - h[i]!) * 1000;
      if (notch >= NOTCH_MM) notches++;
    }

    // Uniform resample for the spectrum.
    const uniformCount = Math.floor(SPAN_M / FFT_STEP);
    const uniform = new Float64Array(uniformCount);
    for (let i = 0, j = 0; i < uniformCount; i++) {
      const at = s0 + i * FFT_STEP;
      while (j < s.length - 2 && s[j + 1]! <= at) j++;
      const t = (at - s[j]!) / (s[j + 1]! - s[j]!);
      uniform[i] = h[j]! + (h[j + 1]! - h[j]!) * t;
    }
    const rms = bandRms(uniform, FFT_STEP);
    for (let b = 0; b < bands.length; b++) bands[b] += rms[b]! ** 2;

    // The 60 Hz ray, and a quarter car on it.
    const surfaceProps = SURFACES[surface ?? roadConditionAt(seed, s0).surface];
    const omega = 2 * Math.PI * BODY_HZ;
    const k = omega * omega;
    const c = 2 * BODY_ZETA * omega;
    let z = h[0]!;
    let zv = 0;
    let lastInput = 0;
    let lastSub = 0;
    let lastHit = -HIT_GAP_STEPS;
    const accel: number[] = [];
    const stepCount = Math.floor((s[s.length - 1]! - s0 - 1) / (speed * FIXED_DT));
    for (let n = 0, j = 0; n < stepCount; n++) {
      const at = s0 + n * speed * FIXED_DT;
      while (j < s.length - 2 && s[j + 1]! <= at) j++;
      const slope = (h[j + 1]! - h[j]!) / (s[j + 1]! - s[j]!);
      const mesh = h[j]! + slope * (at - s[j]!);
      const input = slope * speed;
      if (n > 0) steps.push(Math.abs(input - lastInput));
      lastInput = input;
      const sub =
        surfaceProps.microRelief * micro.at(at, lateral) +
        surfaceProps.hummock * micro.hummockAt(at, lateral) +
        surfaceProps.texture * texture.at(at, lateral);
      subSq += sub * sub;
      subN++;
      const ground = mesh + sub;
      // The damper sees the ray's ramp (Rapier projects the chassis velocity on the
      // hit normal) and the sub-collider profile through its rate.
      const yv = input + (n === 0 ? 0 : (sub - lastSub) / FIXED_DT);
      lastSub = sub;
      const a = k * (ground - z) + c * (yv - zv);
      // Semi-implicit.
      zv = (zv + FIXED_DT * (k * (ground - z) + c * yv)) / (1 + FIXED_DT * c + FIXED_DT * FIXED_DT * k);
      z += zv * FIXED_DT;
      accel.push(a / 9.81);
      travelSq += (ground - z) ** 2;
      travelN++;
      // A HIT is the collider changing the damper's input by more than HIT_MPS from
      // one step to the next: a thing the wheel struck rather than rode over.
      if (n > 0 && steps[steps.length - 1]! > HIT_MPS && n - lastHit >= HIT_GAP_STEPS) {
        hits++;
        lastHit = n;
      }
    }
    for (let i = FLOAT_HALF_WINDOW + 60; i < accel.length - FLOAT_HALF_WINDOW; i++) {
      let mean = 0;
      for (let q = i - FLOAT_HALF_WINDOW; q <= i + FLOAT_HALF_WINDOW; q++) mean += accel[q]!;
      mean /= 2 * FLOAT_HALF_WINDOW + 1;
      floatSq += mean * mean;
      sharpSq += (accel[i]! - mean) ** 2;
      bandN++;
    }
  }

  kicks.sort((a, b) => a - b);
  steps.sort((a, b) => a - b);
  const km = (SPAN_M / 1000) * WHEEL_PATHS.length;
  return {
    decay,
    rmsMm: Math.sqrt(sumSq / samples) * 1000,
    bandMm: bands.map((p) => Math.sqrt(p / WHEEL_PATHS.length)),
    subMm: Math.sqrt(subSq / subN) * 1000,
    kickP99: kicks[Math.floor(kicks.length * 0.99)]!,
    kickMax: kicks[kicks.length - 1]!,
    stepP99: steps[Math.floor(steps.length * 0.99)]!,
    stepMax: steps[steps.length - 1]!,
    rampMax,
    floatG: Math.sqrt(floatSq / bandN),
    sharpG: Math.sqrt(sharpSq / bandN),
    travelMm: Math.sqrt(travelSq / travelN) * 1000,
    hitsPerKm: hits / km,
    eventsPerKm: events / km,
    notchesPerKm: notches / km,
  };
}

const HEADER =
  'decay  rms mm | >40m 10-40  3-10   <3m   sub | kick p99   max | step p99   max  ramp | float  sharp  travel hit/km | event/km notch/km';

function report(label: string, rides: Ride[]): void {
  const mean = (pick: (r: Ride) => number): number =>
    rides.reduce((acc, r) => acc + pick(r), 0) / rides.length;
  const max = (pick: (r: Ride) => number): number => Math.max(...rides.map(pick));
  const f = (v: number, digits: number, width: number): string => v.toFixed(digits).padStart(width);
  console.log(
    `${label}  ${mean((r) => r.decay).toFixed(2)}  ${f(mean((r) => r.rmsMm), 1, 5)} |` +
      rides[0]!.bandMm.map((_, b) => f(mean((r) => r.bandMm[b]!), 1, 5)).join(' ') +
      ` ${f(mean((r) => r.subMm), 1, 5)} |` +
      `    ${f(mean((r) => r.kickP99), 2, 4)}  ${f(max((r) => r.kickMax), 2, 4)} |` +
      `    ${f(mean((r) => r.stepP99), 2, 4)}  ${f(max((r) => r.stepMax), 2, 4)} ${f(max((r) => r.rampMax), 3, 5)} |` +
      ` ${f(mean((r) => r.floatG), 3, 5)}  ${f(mean((r) => r.sharpG), 3, 5)}  ${f(mean((r) => r.travelMm), 1, 5)}  ${f(mean((r) => r.hitsPerKm), 1, 5)} |` +
      `  ${f(mean((r) => r.eventsPerKm), 1, 5)}    ${f(mean((r) => r.notchesPerKm), 1, 5)}`,
  );
}

console.log(
  `ride bench @ ${speedKmh} km/h, ${SPAN_M} m per band, wheel paths ${WHEEL_PATHS.join('/')} m; ` +
    'bands/sub in mm RMS, kick/step in m/s, float/sharp in g, travel in mm; kick/step/ramp max is the worst seed',
);
console.log(`band        ${HEADER}`);
for (const band of BANDS) {
  report(band.label, SEEDS.map((seed) => measureBand(seed, band.s)));
}

// The same bands with one material forced over them: what each district surface is
// worth on its own, across the full range of decay the bands above sample.
const DISTRICT_SURFACES = [
  SurfaceType.Asphalt,
  SurfaceType.CrackedAsphalt,
  SurfaceType.Gravel,
  SurfaceType.Concrete,
];
console.log(`\nsurface           ${HEADER}`);
for (const surface of DISTRICT_SURFACES) {
  const rides = BANDS.flatMap((band) => SEEDS.map((seed) => measureBand(seed, band.s, surface)));
  report(SURFACES[surface].label.padEnd(16), rides);
}
