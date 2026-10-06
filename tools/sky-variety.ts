/**
 * tools/sky-variety.ts
 *
 * The two things that are supposed to make the light and the horizon stop standing
 * still: the drifting cloud shade on the ground, and the weather schedule
 * (world/weather.ts). Both are driven here as the game drives them.
 *
 * WHAT A HEADLESS BENCH CAN AND CANNOT SETTLE. There is no GPU, so nothing here
 * looks at a pixel. What it can do is better than a screenshot anyway, because every
 * property that could silently be wrong is arithmetic:
 *
 *  - the cloud field is a PURE function of world position and time, so the same
 *    inputs give the same shade and a rebuilt frame cannot flicker;
 *  - it stays inside the darkening it claims, so no patch is ever a black hole;
 *  - its patches are the size the constant says they are — measured as the mean run
 *    of shaded ground along a transect, which is the only definition of "patch
 *    scale" that cannot be fooled by a lucky sample;
 *  - REBASING THE SAMPLE POINT DOES NOT MOVE THE FIELD. This is the one that would
 *    have shipped: the shader gets an origin-relative position and a panned origin,
 *    and if the two do not compose back into the absolute sample then the whole sky
 *    jumps sideways every kilometre. Checked at 386 km out, which is as far from the
 *    centre as this road ever gets;
 *  - the GLSL splices into the three version actually installed, exactly once, even
 *    when the material has already been patched twice by other systems. A shader
 *    that fails to compile is invisible in a tool that only samples functions, so
 *    the real injection is run against the real `ShaderLib` source and counted.
 *  - the weather schedule is a pure function of seed and clock, stays in range,
 *    is present for most of a drive, and never cuts one episode into the next.
 *
 *   npx tsx tools/sky-variety.ts
 *
 * Nothing here is part of the game bundle.
 */

import * as THREE from 'three';
import type { WebGLProgramParametersWithUniforms } from 'three';
import { applyComicShading, applyGroundSpotlightNormals } from '../src/render/comic';
import {
  advanceCloudShadows,
  applyCloudShadow,
  cloudShadowFactorAt,
  cloudShadowFactorFromPan,
  cloudShadowFrame,
  cloudShadowPan,
  cloudShadowSalt,
  cloudShadowShadeAt,
  cloudShadowStrength,
  CLOUD_CELL_M,
  CLOUD_DARKEN_MAX,
  CLOUD_DRIFT_MPS,
  CLOUD_PERIOD_M,
} from '../src/render/cloudshadow';
import { weatherAt, weatherKindOfSlot, WEATHER_SLOT_S, type WeatherChannels } from '../src/world/weather';

const SEEDS = [1, 7, 42, 1337];
/** Where the road gets to at 40 000 km: the f32 precision case, in metres. */
const FAR_FROM_CENTRE = 386_000;
/** Shade above which ground counts as "in shadow" for the run-length census. */
const IN_SHADOW = 0.5;
let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(44)} ${detail}`);
}

/** Mean length of the contiguous shaded runs in a sampled line, in sample steps. */
function meanRun(shaded: boolean[]): number {
  let runs = 0;
  let total = 0;
  let current = 0;
  let started = false;
  for (let i = 0; i < shaded.length; i++) {
    if (shaded[i]) {
      current++;
      continue;
    }
    // The first run is dropped: the transect began part-way through it, so its
    // length says where sampling started rather than how big a patch is.
    if (current > 0 && started) {
      runs++;
      total += current;
    }
    started = true;
    current = 0;
  }
  return runs === 0 ? 0 : total / runs;
}

/**
 * How wide the shade's own edge is, 10% to 90% of its depth, in metres.
 *
 * Measured along the same diagonals the patch census uses and reported as quantiles
 * rather than a mean, because the distribution is the point: a field can average a
 * soft edge while a quarter of its edges are still a line. Returns the 25th, the
 * median and the 90th over every edge of every seed.
 */
function penumbraWidths(seeds: readonly number[]): {
  p25: number;
  median: number;
  p90: number;
  count: number;
} {
  const widths: number[] = [];
  const STEP = 1;
  for (const seed of seeds) {
    for (let line = 0; line < 60; line++) {
      const across = line * 311;
      let entering = -1;
      let previous = 0;
      for (let i = 0; i * STEP < 20_000; i++) {
        const d = i * STEP;
        const shade = cloudShadowShadeAt(seed, d * 0.8 + across, d * 0.6 - across, 0, 1);
        // 0.1 and 0.9 of the shade's own range, so the answer does not move when the
        // deepest darkening is retuned.
        if (entering < 0 && previous < 0.1 && shade >= 0.1) entering = d;
        if (entering >= 0 && previous < 0.9 && shade >= 0.9) {
          widths.push(d - entering);
          entering = -1;
        }
        if (entering >= 0 && shade < 0.05) entering = -1;
        if (previous >= 0.1 && shade < 0.1) entering = -1;
        previous = shade;
      }
    }
  }
  widths.sort((a, b) => a - b);
  return {
    p25: widths[Math.floor(widths.length * 0.25)] ?? 0,
    median: widths[widths.length >> 1] ?? 0,
    p90: widths[Math.floor(widths.length * 0.9)] ?? 0,
    count: widths.length,
  };
}

// ---------------------------------------------------------------------------
// 1. the cloud field
// ---------------------------------------------------------------------------

console.log('cloud shadow field');

{
  let repeatable = true;
  let lowest = 1;
  let highest = 0;
  let deepest = 0;
  for (const seed of SEEDS) {
    for (let i = 0; i < 40_000; i++) {
      // Spread over the whole road's worth of coordinate, both signs, and across
      // ten minutes of drift.
      const x = (i * 7919) % 900_000 - 450_000;
      const z = (i * 104_729) % 900_000 - 450_000;
      const t = (i % 600) * 1.37;
      const factor = cloudShadowFactorAt(seed, x, z, t, 1, 1);
      if (cloudShadowFactorAt(seed, x, z, t, 1, 1) !== factor) repeatable = false;
      if (factor < lowest) lowest = factor;
      if (factor > highest) highest = factor;
      const shade = cloudShadowShadeAt(seed, x, z, t, 1);
      if (shade > deepest) deepest = shade;
    }
  }
  check('the same place and time shade the same', repeatable, '160 000 samples, 4 seeds');
  check(
    'darkening stays inside its band',
    lowest >= 1 - CLOUD_DARKEN_MAX - 1e-6 && highest <= 1 + 1e-6,
    `light kept ${(lowest * 100).toFixed(1)}%..${(highest * 100).toFixed(1)}% ` +
      `against a floor of ${((1 - CLOUD_DARKEN_MAX) * 100).toFixed(0)}%`,
  );
  check(
    'a patch does reach full depth',
    deepest > 0.98,
    `deepest shade ${(deepest * 100).toFixed(1)}% of the maximum`,
  );
}

// -- patch scale, measured rather than asserted -------------------------------

{
  const STEP_M = 5;
  const LENGTH_M = 200_000;
  console.log(
    `\n  transect ${(LENGTH_M / 1000).toFixed(0)} km at ${STEP_M} m, lattice ${CLOUD_CELL_M} m`,
  );
  let runSum = 0;
  let coverSum = 0;
  for (const seed of SEEDS) {
    const shaded: boolean[] = [];
    for (let i = 0; i * STEP_M < LENGTH_M; i++) {
      // A diagonal, not an axis: a lattice field sampled along one of its own axes
      // reports the spacing of its rows rather than the size of its patches.
      const d = i * STEP_M;
      shaded.push(cloudShadowShadeAt(seed, d * 0.8, d * 0.6, 0, 1) > IN_SHADOW);
    }
    const runM = meanRun(shaded) * STEP_M;
    const cover = shaded.filter(Boolean).length / shaded.length;
    runSum += runM;
    coverSum += cover;
    console.log(
      `    seed ${String(seed).padStart(4)}   mean shaded run ${runM.toFixed(0).padStart(4)} m   ` +
        `ground in shade ${(cover * 100).toFixed(1)}%   ` +
        `time to pass ${(runM / CLOUD_DRIFT_MPS).toFixed(0)} s`,
    );
  }
  const runM = runSum / SEEDS.length;
  const cover = coverSum / SEEDS.length;
  check(
    'patches are a few hundred metres across',
    runM > 120 && runM < 900,
    `mean shaded run ${runM.toFixed(0)} m`,
  );
  // About half: the band a clearing storm used to lower the field to, now every day's
  // (see CLOUD_EDGE_LOW). Past two thirds it stops reading as patches and reads as overcast.
  check(
    'shade comes in patches, not as an overcast',
    cover > 0.06 && cover < 0.65,
    `${(cover * 100).toFixed(1)}% in shade`,
  );
  check(
    'a patch takes tens of seconds to pass',
    runM / CLOUD_DRIFT_MPS > 10 && runM / CLOUD_DRIFT_MPS < 240,
    `${(runM / CLOUD_DRIFT_MPS).toFixed(0)} s at ${CLOUD_DRIFT_MPS} m/s`,
  );

  // THE PENUMBRA, which is the property this field exists for. A cloud's shadow on
  // the ground has no edge at all, and a shade ramp a few tens of metres wide reads
  // as one — a painted grey blob rather than a shadow. The transition is measured as
  // the distance the shade takes to cross 10% to 90% of its own depth, along the same
  // diagonals, and the floor is what makes "soft" a thing a later tweak cannot quietly
  // take away: it was 75 m before the band was widened, and the check would have
  // passed at 75 m if it only asked for "not a hard line".
  const penumbra = penumbraWidths(SEEDS);
  console.log(
    `    penumbra ${penumbra.median.toFixed(0)} m median, ` +
      `${penumbra.p25.toFixed(0)} m at the 25th, ${penumbra.p90.toFixed(0)} m at the 90th ` +
      `over ${penumbra.count} edges`,
  );
  check(
    'the edge of a shadow is a penumbra, not a line',
    penumbra.median > 100 && penumbra.p25 > 60,
    `median ${penumbra.median.toFixed(0)} m, worst quartile ${penumbra.p25.toFixed(0)} m`,
  );
  check(
    'the penumbra stays smaller than the patches it shades',
    penumbra.median < runM * 0.6,
    `${penumbra.median.toFixed(0)} m against a ${runM.toFixed(0)} m run`,
  );
}

// -- and the same thing in time, standing still -------------------------------

{
  const STEP_S = 0.5;
  const SPAN_S = 3600;
  let runSum = 0;
  for (const seed of SEEDS) {
    const shaded: boolean[] = [];
    for (let i = 0; i * STEP_S < SPAN_S; i++) {
      shaded.push(cloudShadowShadeAt(seed, 12_345, -67_890, i * STEP_S, 1) > IN_SHADOW);
    }
    runSum += meanRun(shaded) * STEP_S;
  }
  const runS = runSum / SEEDS.length;
  check(
    'standing still, the light still changes',
    runS > 10 && runS < 240,
    `a parked car is in shade for ${runS.toFixed(0)} s at a time`,
  );
}

// -- the night gate -----------------------------------------------------------

{
  check(
    'the field is off at night',
    cloudShadowStrength(0) === 0 && cloudShadowStrength(0.11) === 0,
    'strength 0 below the mirage twilight band',
  );
  check(
    'and full in daylight',
    Math.abs(cloudShadowStrength(1) - CLOUD_DARKEN_MAX) < 1e-9,
    `strength ${cloudShadowStrength(1).toFixed(2)} at noon`,
  );
}

// -- the rebase, which is the whole reason the pan uniform exists --------------

{
  const pan = { x: 0, z: 0 };
  let worst = 0;
  for (const seed of SEEDS) {
    const salt = cloudShadowSalt(seed);
    for (let i = 0; i < 4000; i++) {
      // A plausible frame: the origin on its 1 km lattice out at the far end of the
      // road, the fragment somewhere in the 2.4 km of world that is alive around it.
      const originX = FAR_FROM_CENTRE + Math.floor(i / 7) * 1000;
      const originZ = -FAR_FROM_CENTRE + Math.floor(i / 11) * 1000;
      const relX = ((i * 37) % 2400) - 1200;
      const relZ = ((i * 53) % 2400) - 1200;
      const t = (i % 900) * 3.1;
      const absolute = cloudShadowFactorAt(seed, originX + relX, originZ + relZ, t, 1, 1);
      cloudShadowPan(seed, t, originX, originZ, pan);
      const shaderSide = cloudShadowFactorFromPan(pan.x, pan.z, relX, relZ, salt, 1, 1);
      const diff = Math.abs(absolute - shaderSide);
      if (diff > worst) worst = diff;
    }
  }
  check(
    'a rebase does not move the clouds',
    worst < 1e-6,
    `worst disagreement ${worst.toExponential(1)} over 16 000 frames at 386 km`,
  );

  // The pan is also what keeps the shader out of f32's coarse range: assert it is
  // reduced, because that reduction is the only reason the field is periodic at all.
  cloudShadowPan(42, 1_000_000, FAR_FROM_CENTRE, FAR_FROM_CENTRE, pan);
  check(
    'the shader never sees a road-sized coordinate',
    Math.abs(pan.x) <= CLOUD_PERIOD_M && Math.abs(pan.z) <= CLOUD_PERIOD_M,
    `pan ${pan.x.toFixed(0)}, ${pan.z.toFixed(0)} m inside a ${(CLOUD_PERIOD_M / 1000).toFixed(1)} km period`,
  );
}

// -- the shipped per-frame path -----------------------------------------------

{
  const pan = { x: 0, z: 0 };
  const FRAMES = 120;
  const DT = 1 / 60;
  for (let i = 0; i < FRAMES; i++) {
    advanceCloudShadows(42, DT, 1, FAR_FROM_CENTRE, 12_000, 'standard', false);
  }
  const frame = cloudShadowFrame();
  cloudShadowPan(42, frame.elapsed, FAR_FROM_CENTRE, 12_000, pan);
  check(
    'the frame uniforms are the field',
    Math.abs(frame.panX - pan.x) < 1e-9 &&
      Math.abs(frame.panZ - pan.z) < 1e-9 &&
      frame.salt === cloudShadowSalt(42),
    `elapsed ${frame.elapsed.toFixed(2)} s, pan ${frame.panX.toFixed(1)}, ${frame.panZ.toFixed(1)} m`,
  );
  check(
    'dt drives the drift, not the wall clock',
    Math.abs(frame.elapsed - FRAMES * DT) < 1e-9,
    `${FRAMES} frames of ${(DT * 1000).toFixed(1)} ms gave ${frame.elapsed.toFixed(3)} s`,
  );

  advanceCloudShadows(42, 0, 0, 0, 0, 'blessing', false);
  const dark = cloudShadowFrame();
  advanceCloudShadows(42, 0, 1, 0, 0, 'acceptable', false);
  const weak = cloudShadowFrame();
  advanceCloudShadows(42, 0, 1, 0, 0, 'blessing', true);
  const phone = cloudShadowFrame();
  advanceCloudShadows(42, 0, 1, 0, 0, 'standard', false);
  const desktop = cloudShadowFrame();
  check(
    'a dark frame does no work at all',
    dark.strength === 0,
    'strength 0 disables the whole fragment block',
  );
  check(
    'the rung buys the detail octave',
    weak.detail === 0 && phone.detail === 0 && desktop.detail === 1,
    'acceptable 0, phone 0, standard desktop 1',
  );
}

// -- the injection, against the installed three -------------------------------

{
  // The real ground-material stack: the comic patch (terrain, vista) or the ground
  // spotlight patch (road ribbon) first, then this one on top of it. Applied TWICE
  // on purpose — the terrain material factory runs twice and the road hands its
  // asphalt finish out by name, so a second call has to be a no-op.
  const material = applyCloudShadow(
    applyCloudShadow(
      applyComicShading(new THREE.MeshStandardMaterial({ vertexColors: true })),
    ),
  );
  const shader = {
    uniforms: {} as Record<string, THREE.IUniform>,
    vertexShader: THREE.ShaderLib.physical.vertexShader,
    fragmentShader: THREE.ShaderLib.physical.fragmentShader,
    defines: {},
  } as unknown as WebGLProgramParametersWithUniforms;
  material.onBeforeCompile(shader, null as unknown as THREE.WebGLRenderer);

  const count = (haystack: string, needle: string): number =>
    haystack.split(needle).length - 1;
  check(
    'the varying is declared exactly once',
    count(shader.vertexShader, 'varying float vCloudShade;') === 1 &&
      count(shader.fragmentShader, 'varying float vCloudShade;') === 1,
    'applied twice, injected once',
  );
  // THE COST CHECK, and the reason this file exists at all. The field ran in the
  // fragment shader once and cost 34 ms a frame on the machine that reported it: the
  // ground shader is already near the register limit, so four hashes a pixel spilled
  // it. Nothing in the fragment stage may hash — if a later edit moves the sampler
  // back down there, this fails with the arithmetic in the message rather than
  // shipping the same 30x again.
  check(
    'the field is evaluated per VERTEX, never per fragment',
    count(shader.vertexShader, 'float cloudShade(') === 1 &&
      count(shader.vertexShader, '? cloudShade( cloudWorld.xz') === 1 &&
      count(shader.fragmentShader, 'cloudShade(') === 0 &&
      count(shader.fragmentShader, 'cloudHash(') === 0 &&
      count(shader.fragmentShader, 'vCloudShade * uCloudStrength') === 1 &&
      count(shader.vertexShader, 'uCloudStrength > 0.0') === 1,
    'vertex hash (skipped at night), fragment multiply',
  );
  check(
    'the splice points still exist in three ' + THREE.REVISION,
    shader.vertexShader.includes('? cloudShade( cloudWorld.xz') &&
      count(shader.fragmentShader, '#include <opaque_fragment>') === 1,
    'worldpos_vertex and opaque_fragment both found',
  );
  check(
    'it chained instead of replacing',
    shader.fragmentShader.includes('uComicBands') &&
      shader.uniforms.uComicBands !== undefined &&
      shader.uniforms.uCloudPan !== undefined,
    'comic uniforms and cloud uniforms both bound',
  );
  check(
    'the program key names both patches',
    material.customProgramCacheKey().includes('comic') &&
      material.customProgramCacheKey().includes('cloud-shadow'),
    material.customProgramCacheKey(),
  );

  // AND THE OTHER GROUND STACK. The road ribbon, its bed and its markings carry
  // `applyGroundSpotlightNormals`, which rewrites the stock lighting chunk instead
  // of the output — a different splice, and the one the road will be wrapped with.
  // It is checked here rather than trusted, because a patch that quietly replaced
  // the spotlight one would leave headlamps flat on every uphill road in the game.
  const road = applyCloudShadow(
    applyGroundSpotlightNormals(new THREE.MeshStandardMaterial({ vertexColors: true })),
  );
  const roadShader = {
    uniforms: {} as Record<string, THREE.IUniform>,
    vertexShader: THREE.ShaderLib.physical.vertexShader,
    fragmentShader: THREE.ShaderLib.physical.fragmentShader,
    defines: {},
  } as unknown as WebGLProgramParametersWithUniforms;
  road.onBeforeCompile(roadShader, null as unknown as THREE.WebGLRenderer);
  check(
    'the road ribbon keeps its spotlight patch',
    count(roadShader.fragmentShader, 'groundSlopeNormal( geometryPosition') === 1 &&
      count(roadShader.fragmentShader, 'vCloudShade * uCloudStrength') === 1 &&
      roadShader.uniforms.uCloudPan !== undefined,
    'slope-corrected spotlights and cloud shade in one program',
  );
}

// ---------------------------------------------------------------------------
// 2. the weather schedule
// ---------------------------------------------------------------------------

console.log('\nweather schedule');
{
  const channels = (): WeatherChannels => ({
    haze: 0, dust: 0, front: 0, cloud: 0, rain: 0, wet: 0,
    wind: 0, drift: 0, heat: 0, halo: 0, clarity: 0,
  });
  const a = channels();
  const b = channels();
  let impure = 0;
  let outOfRange = 0;
  let active = 0;
  let samples = 0;
  let repeats = 0;
  const kinds: Record<string, number> = {};
  for (const seed of SEEDS) {
    for (let t = 0; t < 6 * 3600; t += 7.3) {
      weatherAt(seed, t, a);
      weatherAt(seed, t, b);
      samples++;
      let any = 0;
      for (const k of Object.keys(a) as (keyof WeatherChannels)[]) {
        if (a[k] !== b[k]) impure++;
        if (!(a[k] >= 0 && a[k] <= 1)) outOfRange++;
        any = Math.max(any, a[k]);
      }
      if (any > 0.05) active++;
    }
    for (let slot = 0; slot < 400; slot++) {
      const kind = weatherKindOfSlot(seed, slot);
      kinds[kind] = (kinds[kind] ?? 0) + 1;
      if (kind !== 'clear' && kind === weatherKindOfSlot(seed, slot - 1)) repeats++;
    }
  }
  check('pure function of seed and clock', impure === 0, `${impure} disagreements`);
  check('every channel inside 0..1', outOfRange === 0, `${outOfRange} out of range`);
  const share = active / samples;
  check('weather present about half the time', share > 0.35 && share < 0.65, `${(share * 100).toFixed(0)}% of play`);
  check('never the same episode twice running', repeats === 0, `${repeats} repeats`);
  console.log(`        kinds over ${SEEDS.length * 400} slots: ${JSON.stringify(kinds)}`);
  // Slot edges are clear sky, so neighbouring episodes never cut into each other.
  let edge = 0;
  for (const seed of SEEDS) {
    for (let slot = 0; slot < 200; slot++) {
      weatherAt(seed, slot * WEATHER_SLOT_S + 1e-3, a);
      for (const k of Object.keys(a) as (keyof WeatherChannels)[]) edge = Math.max(edge, a[k]);
    }
  }
  check('slot boundaries are clear sky', edge < 1e-6, `max channel ${edge.toExponential(1)}`);
}

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} CHECK(S) FAILED`);
process.exitCode = failures === 0 ? 0 : 1;
