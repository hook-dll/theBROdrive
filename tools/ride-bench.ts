/**
 * tools/ride-bench.ts
 *
 * Ride bench for the road's surface field. It answers the only question that
 * matters about bumpiness: what does a WHEEL feel, given that the wheel does not
 * feel the analytic field at all — it ray-casts against the trimesh, which is
 * piecewise linear between vertex rows SURFACE_STEP apart.
 *
 * So the headline number is not amplitude, it is the KICK: on a linear collider a
 * wheel's vertical velocity is slope * speed, and it changes discontinuously at
 * every vertex row. `kick = |slope_after - slope_before| * speed` is therefore the
 * vertical velocity step the suspension is hit with, in m/s, and it is what the
 * body actually reports as a bump. Amplitude alone lies: a 3 cm swell over 30 m is
 * invisible and a 3 cm notch over 1.3 m throws the car.
 *
 * The wheel is tracked down a real wheel path (roadmesh.ts WHEEL_PATH_LATERALS),
 * not down the centreline, because that is where potholes have to be to be hit.
 *
 *   npx tsx tools/ride-bench.ts [speedKmh]
 *
 * Nothing here is part of the game bundle.
 */

import { roadConditionAt } from '../src/world/gradient';
import { ROAD_LENGTH } from '../src/world/road';
import { SURFACE_STEP, SurfaceField } from '../src/world/roadsurface';

/** Right-lane wheel paths, from roadmesh.ts. A car sits in one lane, not both. */
const WHEEL_PATHS = [0.85, 2.45];
/** Seeds sampled and averaged; bumpiness must not be a seed lottery. */
const SEEDS = [1, 7, 42, 1337];
/** Metres of road measured per progress band. */
const SPAN_M = 3000;
/** A single-row dip counts as a pothole hit past this depth below its neighbours, mm. */
const NOTCH_MM = 15;

const speedKmh = Number(process.argv[2] ?? 60);
const speed = speedKmh / 3.6;

/**
 * Where to measure, in metres of arclength.
 *
 * ABSOLUTE distances, not fractions of the road. They used to be fractions, which was
 * right while decay was a one-way ramp from 0 to 1 — "40% of the way along" then meant
 * something about road quality. It no longer does: quality is stationary in absolute
 * distance (see gradient.ts), so a fraction is just an arbitrary place, and multiplying
 * it by a road that grew a hundred times over silently moved every band. The first row
 * has to be the first kilometre, because that is the road the player actually learns
 * the car on.
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
  /** RMS of the displacement field itself, mm. Texture, not feel. */
  rmsMm: number;
  /** RMS vertical-velocity step at each vertex row, m/s. The felt bumpiness. */
  kickRms: number;
  /** 99th percentile kick, m/s: the ones you notice individually. */
  kickP99: number;
  /** Worst kick over the span, m/s. */
  kickMax: number;
  /**
   * Single-row notches per km of one wheel path: rows sitting NOTCH_MM below both
   * neighbours. At a 1.333 m vertex step that is exactly the shape a pothole has,
   * and the bump layer's shortest octave (3.33 m) cannot make one.
   */
  notchesPerKm: number;
  /** Deepest such notch, mm. */
  notchMaxMm: number;
}

function measureBand(seed: number, s0: number): Ride {
  const field = new SurfaceField(seed);
  const count = Math.round(SPAN_M / SURFACE_STEP);

  const kicks: number[] = [];
  let sumSq = 0;
  let samples = 0;
  let decaySum = 0;
  let notches = 0;
  let notchMax = 0;

  for (const lateral of WHEEL_PATHS) {
    const h: number[] = [];
    for (let i = 0; i <= count; i++) {
      const s = s0 + i * SURFACE_STEP;
      const cond = roadConditionAt(s);
      // The bump layer is 2D world noise; the road is locally straight enough over
      // 3 km that walking x with s is a faithful stand-in for offsetPoint here, and
      // it keeps the bench independent of the road's curvature.
      h.push(field.displacement(s, lateral, s, lateral, cond.decay, cond.surface));
      if (lateral === WHEEL_PATHS[0]) decaySum += cond.decay;
    }

    for (let i = 1; i < count; i++) {
      const before = (h[i]! - h[i - 1]!) / SURFACE_STEP;
      const after = (h[i + 1]! - h[i]!) / SURFACE_STEP;
      kicks.push(Math.abs(after - before) * speed);
      sumSq += h[i]! * h[i]!;
      samples++;

      const notch = (Math.min(h[i - 1]!, h[i + 1]!) - h[i]!) * 1000;
      if (notch >= NOTCH_MM) {
        notches++;
        if (notch > notchMax) notchMax = notch;
      }
    }
  }

  kicks.sort((a, b) => a - b);
  const kickSq = kicks.reduce((acc, k) => acc + k * k, 0);

  return {
    decay: decaySum / (count + 1),
    rmsMm: Math.sqrt(sumSq / samples) * 1000,
    kickRms: Math.sqrt(kickSq / kicks.length),
    kickP99: kicks[Math.floor(kicks.length * 0.99)]!,
    kickMax: kicks[kicks.length - 1]!,
    notchesPerKm: notches / ((SPAN_M / 1000) * WHEEL_PATHS.length),
    notchMaxMm: notchMax,
  };
}

console.log(`ride bench @ ${speedKmh} km/h, ${SPAN_M} m per band, wheel paths ${WHEEL_PATHS.join('/')} m`);
console.log('band        decay   rms mm   kick rms   kick p99   kick max   notch/km   worst notch');
for (const band of BANDS) {
  const rides = SEEDS.map((seed) => measureBand(seed, band.s));
  const mean = (pick: (r: Ride) => number): number =>
    rides.reduce((acc, r) => acc + pick(r), 0) / rides.length;
  console.log(
    `${band.label}  ${mean((r) => r.decay).toFixed(2)}` +
      `    ${mean((r) => r.rmsMm).toFixed(1).padStart(5)}` +
      `     ${mean((r) => r.kickRms).toFixed(3).padStart(6)}` +
      `     ${mean((r) => r.kickP99).toFixed(3).padStart(6)}` +
      `     ${mean((r) => r.kickMax).toFixed(3).padStart(6)}` +
      `      ${mean((r) => r.notchesPerKm).toFixed(1).padStart(5)}` +
      `      ${mean((r) => r.notchMaxMm).toFixed(1).padStart(5)} mm`,
  );
}
