/**
 * tools/shadow-bias.ts
 *
 * How much of a car's contact shadow the sun's depth bias throws away.
 *
 * The reported artefact was a car shadow on sand that read as diagonally striped and
 * torn, worst with the sun high. It is not a shadow-map resolution problem and not
 * acne: the desert tiles are the only ground that RECEIVES the sun's shadow map
 * (world/deserttiles.ts) and they never CAST into it, so they cannot shadow themselves.
 *
 * The mechanism is the bias, and the arithmetic is the whole proof:
 *
 *  - `shadow.bias` is a fraction of the shadow camera's depth range, so its size in
 *    METRES is `|bias| * (far - near)`. Over 40..540 m the old -0.0004 was 20 cm.
 *  - `shadow.normalBias` pushes the receiver along its own normal, which for flat sand
 *    under a high sun is straight at the light: another `normalBias * sin(elevation)`.
 *  - Three renders a caster's BACK faces into the depth map (`shadowSide`, set in
 *    `prepareMaterials` in render/carmodel.ts), so the depth stored under a car is
 *    its UNDERBODY. The sand beneath sits one GROUND CLEARANCE further from the
 *    light — 0.18 to 0.51 m across the two shipped packs, as the catalogue states it
 *    rather than as the artist drew it (see RIDE_LIFT_MAX in vehicle/vehicle.ts).
 *  - Along the light ray that clearance is `gap / sin(elevation)`, so the sand is
 *    declared LIT — the shadow is erased — whenever
 *
 *        gap <= sin(elevation) * (|bias| * range + normalBias * sin(elevation))
 *
 * Twenty-five centimetres of slack against an eighteen-centimetre gap erases the whole
 * contact shadow; where the dune relief closes or opens the gap around the threshold it
 * erases PART of it, and the boundary follows the desert tile's 3 m lattice. That is
 * the diagonal striping, and it is worst at noon because the threshold scales with
 * sin(elevation).
 *
 *   npx tsx tools/shadow-bias.ts
 *
 * Nothing here is part of the game bundle.
 */

/** Keep in sync with render/sky.ts. */
const SUN_DISTANCE = 240;
const SHADOW_NEAR = 40;
const SHADOW_FAR = SUN_DISTANCE + 300;
const SHADOW_MIN_ELEVATION = 0.26;
const BIAS_NOW = -0.00004;
const NORMAL_BIAS_NOW = 0.02;
/** What shipped before this was measured. */
const BIAS_BEFORE = -0.0004;
const NORMAL_BIAS_BEFORE = 0.05;

/**
 * Body-to-ground clearance of the shipped cars, metres, as they SETTLE on their
 * springs — the figure tools/suspension-probe.ts reports, not the drawn stance,
 * because a low-drawn box is lifted to a stated clearance (RIDE_LIFT_MAX).
 */
const CLEARANCES: readonly { readonly label: string; readonly metres: number }[] = [
  { label: 'mid-engined V8', metres: 0.18 },
  { label: 'VAZ-2101 Zhiguli', metres: 0.2 },
  { label: 'tractor unit', metres: 0.51 },
];

const DEPTH_RANGE = SHADOW_FAR - SHADOW_NEAR;

/** Vertical gap, in metres, below which the contact shadow is erased. */
function erasedBelow(elevationRad: number, bias: number, normalBias: number): number {
  const sin = Math.sin(elevationRad);
  return sin * (Math.abs(bias) * DEPTH_RANGE + normalBias * sin);
}

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(46)} ${detail}`);
}

console.log(
  `depth range ${DEPTH_RANGE} m; bias ${(Math.abs(BIAS_BEFORE) * DEPTH_RANGE).toFixed(3)} m -> ` +
    `${(Math.abs(BIAS_NOW) * DEPTH_RANGE).toFixed(3)} m, normalBias ${NORMAL_BIAS_BEFORE} -> ${NORMAL_BIAS_NOW}`,
);
console.log('');
console.log('sun elev   erased gap before   erased gap after   cars losing contact shadow');

const ELEVATIONS_DEG = [15, 20, 30, 40, 50, 60, 70, 80, 90];
let worstBefore = 0;
let worstAfter = 0;
for (const degrees of ELEVATIONS_DEG) {
  const rad = Math.max((degrees * Math.PI) / 180, SHADOW_MIN_ELEVATION);
  const before = erasedBelow(rad, BIAS_BEFORE, NORMAL_BIAS_BEFORE);
  const after = erasedBelow(rad, BIAS_NOW, NORMAL_BIAS_NOW);
  worstBefore = Math.max(worstBefore, before);
  worstAfter = Math.max(worstAfter, after);
  const lost = CLEARANCES.filter((car) => car.metres <= before).map((car) => car.label);
  console.log(
    `${String(degrees).padStart(5)}\u00b0   ${before.toFixed(3).padStart(14)} m   ` +
      `${after.toFixed(3).padStart(13)} m   ${lost.length === 0 ? '-' : lost.join(', ')}`,
  );
}

console.log('');
const minClearance = Math.min(...CLEARANCES.map((car) => car.metres));

// The bug: the old slack reached past a real car's clearance, so this is not a
// hypothetical tolerance — it erased shadows that shipped.
check(
  'the old bias reached past a real car',
  worstBefore >= minClearance,
  `${worstBefore.toFixed(3)} m of slack vs ${minClearance.toFixed(2)} m clearance`,
);

// The fix: at every sun elevation the shadow map can be trusted for every pack, with
// room to spare so dune relief under the car cannot bring the gap down to it.
check(
  'the new bias clears every pack',
  worstAfter < minClearance,
  `${worstAfter.toFixed(3)} m of slack vs ${minClearance.toFixed(2)} m clearance`,
);
check(
  'and clears it by at least 2x',
  worstAfter * 2 < minClearance,
  `${(minClearance / worstAfter).toFixed(1)}x margin`,
);

// Bias still has to survive float noise in the depth comparison. A packed-RGBA depth
// map resolves this range far finer than a millimetre, and the receiver's shadow
// coordinate is interpolated exactly for an orthographic light across a planar
// triangle, so a centimetre is generous rather than tight.
check(
  'and is still above a millimetre',
  Math.abs(BIAS_NOW) * DEPTH_RANGE >= 0.01,
  `${(Math.abs(BIAS_NOW) * DEPTH_RANGE * 1000).toFixed(1)} mm of depth slack`,
);

console.log(failures === 0 ? 'all checks passed' : `${failures} CHECK(S) FAILED`);
process.exitCode = failures === 0 ? 0 : 1;
