/**
 * tools/sky-variety.ts
 *
 * The two things that are supposed to make the light and the horizon stop standing
 * still: the drifting cloud shade on the ground, and the distant weather the variety
 * director schedules. Both are driven here as the game drives them.
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
 *  - the weather provider builds where the director says and nowhere else, on the
 *    right side, in the right lateral band, with no physics, and disposes every
 *    geometry and material it made.
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
import type { ChunkContent, ChunkContext } from '../src/world/chunks';
import { CHUNK_LENGTH } from '../src/world/chunks';
import {
  VarietyChannel,
  varietyEventOfWindow,
  varietyWindowAt,
  varietyWindowLength,
} from '../src/world/director';
import { Road } from '../src/world/road';
import { Terrain } from '../src/world/terrain';
import {
  setWeatherFrame,
  weatherFamilyFor,
  weatherLateralFor,
  weatherOpacity,
  WeatherProvider,
  WEATHER_FAMILIES,
  WEATHER_LATERAL_MIN,
  WEATHER_LATERAL_SPAN,
  WEATHER_NEAR_FULL,
  WEATHER_NEAR_GONE,
  type WeatherFamily,
} from '../src/world/weatherfx';

const SEEDS = [1, 7, 42, 1337];
/** Where the road gets to at 40 000 km: the f32 precision case, in metres. */
const FAR_FROM_CENTRE = 386_000;
/** Shade above which ground counts as "in shadow" for the run-length census. */
const IN_SHADOW = 0.5;
/**
 * Closest the road comes to a phenomenon WHILE IT IS ON SCREEN, against the top of
 * the proximity dissolve — which is the band the game itself will fade it with, so
 * the two are checked against each other rather than against a number typed twice.
 *
 * NOT its distance to the nearest asphalt anywhere, which is a different and
 * useless question: this road random-walks 40 000 km and comes back past its own
 * neighbourhood, so a phenomenon 900 m off one arclength can be 230 m from a
 * stretch three kilometres further on — and that stretch has its own chunks, which
 * means the phenomenon is not built, not drawn and nowhere near the player when he
 * drives it. What must hold is the local statement: over the road the fade keeps it
 * visible from, it never comes inside the dissolve, or it would fade out while the
 * player was looking straight at it. This is the check that caught the dissolve
 * ceiling being set 200 m too high.
 */
const NEAREST_ROAD_MIN = WEATHER_NEAR_FULL;
/**
 * The floating origin every census chunk is built under, deliberately not zero: a
 * provider must subtract it from everything it puts in the scene while sampling the
 * road and the terrain at absolute coordinates, and an origin of zero cannot tell
 * the two apart.
 */
const CENSUS_ORIGIN_X = 128_000;
const CENSUS_ORIGIN_Z = -64_000;
/** Arclength either side of the event over which it can be seen; see weatherfx.ts. */
const VISIBLE_REACH_M = 1150;

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
  check(
    'some of the ground is shaded, not most',
    cover > 0.06 && cover < 0.45,
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
      count(shader.vertexShader, '? cloudShade( ( modelMatrix') === 1 &&
      count(shader.fragmentShader, 'cloudShade(') === 0 &&
      count(shader.fragmentShader, 'cloudHash(') === 0 &&
      count(shader.fragmentShader, 'vCloudShade * uCloudStrength') === 1 &&
      count(shader.vertexShader, 'uCloudStrength > 0.0') === 1,
    'vertex hash (skipped at night), fragment multiply',
  );
  check(
    'the splice points still exist in three ' + THREE.REVISION,
    shader.vertexShader.includes('? cloudShade( ( modelMatrix') &&
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
// 2. distant weather
// ---------------------------------------------------------------------------

console.log('\ndistant weather');

/** A chunk build context with no physics: the provider asks for none. */
function contextFor(
  seed: number,
  road: Road,
  terrain: Terrain,
  chunkIndex: number,
  originX: number,
  originZ: number,
): ChunkContext {
  return {
    chunkIndex,
    sStart: chunkIndex * CHUNK_LENGTH,
    sEnd: (chunkIndex + 1) * CHUNK_LENGTH,
    road,
    terrain,
    world: { seed },
    hasPhysics: false,
    originX,
    originZ,
  } as unknown as ChunkContext;
}

{
  const provider = new WeatherProvider();
  const CHUNKS = 2000; // 400 km of road per seed
  const familyCount: Record<WeatherFamily, number> = { virga: 0, dustWall: 0, smokeColumn: 0 };
  let built = 0;
  let wrongChunk = 0;
  let missed = 0;
  let wrongSide = 0;
  let outOfBand = 0;
  let withPhysics = 0;
  let placementMismatch = 0;
  let tooCloseToRoad = 0;
  let nearestToRoad = Infinity;
  let created = 0;
  let disposed = 0;
  let emptySheets = 0;
  const contents: { content: ChunkContent; index: number }[] = [];

  for (const seed of SEEDS) {
    const road = new Road(seed);
    const terrain = new Terrain(seed, road);
    const originX = CENSUS_ORIGIN_X;
    const originZ = CENSUS_ORIGIN_Z;

    for (let index = 0; index < CHUNKS; index++) {
      const ctx = contextFor(seed, road, terrain, index, originX, originZ);
      const content = provider.build(ctx);

      // What the director itself says about this chunk, asked independently.
      const window = varietyWindowAt(VarietyChannel.Horizon, ctx.sStart);
      const event = varietyEventOfWindow(seed, VarietyChannel.Horizon, window);
      const owns =
        event.kind === 'weather' && event.s >= ctx.sStart && event.s < ctx.sEnd;

      if (content === null) {
        if (owns) missed++;
        continue;
      }
      if (!owns) {
        wrongChunk++;
        continue;
      }
      built++;

      const family = weatherFamilyFor(event.draw);
      familyCount[family]++;
      if (content.bodies.length > 0 || content.colliders.length > 0) withPhysics++;

      // Where it ended up, read back off the built group rather than recomputed.
      //
      // MEASURED IN THE EVENT'S OWN ROAD FRAME, which is the frame the placement is
      // expressed in, and not with `road.project`: the nearest point of a curving
      // road to something 1800 m out in the desert can be hundreds of metres from
      // the arclength it was placed off, so the projection's own lateral
      // understates the offset by tens of metres on a bend. Both numbers matter, so
      // both are taken — the frame offset against the authored band, and the
      // closest the road comes over the stretch it is visible from.
      const absX = content.group.position.x + originX;
      const absZ = content.group.position.z + originZ;
      const centre = road.sampleAt(event.s);
      const lateral =
        (absX - centre.x) * Math.cos(centre.heading) -
        (absZ - centre.z) * Math.sin(centre.heading);
      if (Math.sign(lateral) !== event.side) wrongSide++;
      const out = Math.abs(lateral);
      if (out < WEATHER_LATERAL_MIN || out > WEATHER_LATERAL_MIN + WEATHER_LATERAL_SPAN) {
        outOfBand++;
      }
      if (Math.abs(weatherLateralFor(seed, event) - lateral) > 0.01) placementMismatch++;
      // Swept, not projected: `project` answers for the whole 40 000 km road, and
      // the answer wanted here is local to the road this thing is co-visible with.
      // THE DISTANCE THAT MATTERS IS TO THE SHEETS, NOT TO THE ANCHOR, and measuring
      // the anchor is why a 1600 m haboob stood over the road with the census
      // reporting 600 m of clearance. The footprint is the span axis of the built
      // group, taken from its own geometry, so the check reads the thing that is
      // actually in the scene.
      const yaw = content.group.rotation.y;
      const spanX = Math.cos(yaw);
      const spanZ = -Math.sin(yaw);
      let halfSpan = 0;
      content.group.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (!mesh.isMesh) return;
        const position = mesh.geometry.getAttribute('position');
        for (let v = 0; v < position.count; v++) {
          halfSpan = Math.max(halfSpan, Math.abs(position.getX(v)));
        }
      });
      halfSpan *= content.group.scale.x;
      let toRoad = Infinity;
      for (let s = event.s - VISIBLE_REACH_M; s <= event.s + VISIBLE_REACH_M; s += 10) {
        const at = road.sampleAt(s);
        const dx = at.x - absX;
        const dz = at.z - absZ;
        const alongSpan = Math.max(-halfSpan, Math.min(halfSpan, dx * spanX + dz * spanZ));
        const d = Math.hypot(dx - alongSpan * spanX, dz - alongSpan * spanZ);
        if (d < toRoad) toRoad = d;
      }
      if (toRoad < NEAREST_ROAD_MIN) tooCloseToRoad++;
      if (toRoad < nearestToRoad) nearestToRoad = toRoad;

      let sheets = 0;
      content.group.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (!mesh.isMesh) return;
        sheets++;
        created += 2; // one geometry, one material reference
        mesh.geometry.addEventListener('dispose', () => {
          disposed++;
        });
        (mesh.material as THREE.Material).addEventListener('dispose', () => {
          disposed++;
        });
      });
      if (sheets === 0) emptySheets++;
      contents.push({ content, index });
    }
  }

  // THE COUNTRY'S OWN FAMILIES, ASKED OF THE SHIPPED SELECTOR. `WEATHER_FAMILIES` is the
  // desert's three; `weatherfx.ts` selects out of its own country list, which is rain
  // alone — "no dust walls on a green plain". Reading the reachable set off the selector
  // rather than restating the list keeps this in step with the source instead of with a
  // second copy of it, and it is what the census and the census's print below iterate.
  const reachable: WeatherFamily[] = [];
  let familyCuts = 0;
  {
    let previous = weatherFamilyFor(0);
    reachable.push(previous);
    for (let i = 1; i <= 1000; i++) {
      const family = weatherFamilyFor(i / 1000);
      if (family === previous) continue;
      familyCuts++;
      if (!reachable.includes(family)) reachable.push(family);
      previous = family;
    }
  }

  console.log(
    `  ${built} phenomena over ${((CHUNKS * CHUNK_LENGTH * SEEDS.length) / 1000).toFixed(0)} km ` +
      `of road (one every ${(
        (CHUNKS * CHUNK_LENGTH * SEEDS.length) /
        1000 /
        Math.max(1, built)
      ).toFixed(1)} km)`,
  );
  for (const family of reachable) {
    console.log(`    ${family.padEnd(13)} ${String(familyCount[family]).padStart(3)}`);
  }
  console.log(
    `  a weather window is ${(varietyWindowLength(VarietyChannel.Horizon) / 1000).toFixed(1)} km long\n`,
  );

  check('it builds where the director says', missed === 0, `${missed} events with nothing built`);
  check(
    'and nowhere else',
    wrongChunk === 0,
    `${wrongChunk} chunks built something they do not own`,
  );
  check(
    'every family the country can pick does appear',
    reachable.every((f) => familyCount[f] > 0),
    `${reachable.map((f) => `${f} ${familyCount[f]}`).join(', ')} ` +
      `of the desert's ${WEATHER_FAMILIES.length}`,
  );
  check('each stands on the event\'s own side', wrongSide === 0, `${wrongSide} on the wrong side`);
  check(
    'each stands in the lateral band',
    outOfBand === 0,
    `${outOfBand} outside ${WEATHER_LATERAL_MIN}-${WEATHER_LATERAL_MIN + WEATHER_LATERAL_SPAN} m`,
  );
  check(
    'the placement is the pure function of the event',
    placementMismatch === 0,
    `${placementMismatch} disagreed with weatherLateralFor`,
  );
  check(
    'none of it ends up near the asphalt',
    tooCloseToRoad === 0,
    `nearest road distance ${nearestToRoad.toFixed(0)} m, floor ${NEAREST_ROAD_MIN} m`,
  );
  check('nothing distant carries physics', withPhysics === 0, `${withPhysics} chunks with bodies or colliders`);
  check('every phenomenon has sheets', emptySheets === 0, `${emptySheets} empty groups`);

  // A known seed, spelled out, so a change to family selection or placement shows up
  // as a diff here rather than as a different sky nobody remembers seeing.
  {
    const windows = 200_000 / varietyWindowLength(VarietyChannel.Horizon);
    for (let window = 0; window < windows; window++) {
      const event = varietyEventOfWindow(42, VarietyChannel.Horizon, window);
      if (event.kind !== 'weather') continue;
      console.log(
        `\n  seed 42, first weather at ${(event.s / 1000).toFixed(2)} km ` +
          `(horizon window ${event.index}): ${weatherFamilyFor(event.draw)}, ` +
          `${weatherLateralFor(42, event).toFixed(0)} m ${event.side < 0 ? 'right' : 'left'} ` +
          `of travel, draw ${event.draw.toFixed(3)}`,
      );
      break;
    }
    check(
      'a known draw picks a known family',
      familyCuts === reachable.length - 1 && reachable.includes(weatherFamilyFor(0.5)),
      `the draw selects ${reachable.join(', ')} — ${familyCuts} cut` +
        `${familyCuts === 1 ? '' : 's'} across it, in that order`,
    );
  }

  // The live set, both ways round. Showing it FIRST is what makes the disposal
  // check mean anything: an unregistered phenomenon is invisible for free, so a
  // "not visible after dispose" assertion on its own passes whether or not the
  // dispose ever removed it.
  const last = contents[contents.length - 1]!;
  const anchorX = last.content.group.position.x + CENSUS_ORIGIN_X;
  const anchorZ = last.content.group.position.z + CENSUS_ORIGIN_Z;
  let shown = false;
  let camX = anchorX;
  let camZ = anchorZ;
  for (let i = 0; i < 16 && !shown; i++) {
    // A bearing at a time, at a distance inside the along fade and outside the
    // proximity dissolve, until one of them is a place the thing can be seen from.
    const angle = (i / 16) * Math.PI * 2;
    camX = anchorX + Math.cos(angle) * 700;
    camZ = anchorZ + Math.sin(angle) * 700;
    setWeatherFrame(1, camX, camZ);
    shown = last.content.group.visible;
  }
  const sheetMaterial = (last.content.group.children[0] as THREE.Mesh | undefined)
    ?.material as THREE.Material | undefined;
  check(
    'a streamed phenomenon is shown from the road',
    shown,
    `${last.content.group.children.length} sheets at ` +
      `${((sheetMaterial?.opacity ?? 0) * 100).toFixed(0)}% opacity from 700 m`,
  );

  // Dispose everything and count. The streamer disposes via `dispose`, so this is
  // the same call path a chunk leaving range takes.
  for (const entry of contents) entry.content.dispose?.();
  check(
    'every geometry and material is released',
    created > 0 && disposed === created,
    `${disposed} of ${created} disposed across ${contents.length} chunks`,
  );

  // Same phenomenon after disposal, from a camera that WOULD have changed it: the
  // sentinel survives only if the live set let go of it, and the group has been put
  // to sleep rather than left in whatever state the last frame wrote.
  const SENTINEL = 0.5;
  if (sheetMaterial) sheetMaterial.opacity = SENTINEL;
  setWeatherFrame(1, camX + 40_000, camZ + 40_000);
  check(
    'a disposed phenomenon leaves the frame',
    !last.content.group.visible && sheetMaterial?.opacity === SENTINEL,
    'hidden by dispose, and no longer written to',
  );
}

// -- the fade envelope --------------------------------------------------------

{
  check(
    'it is gone before its chunk unloads',
    weatherOpacity(1, 1150, 1000) === 0 && weatherOpacity(1, 3000, 1000) === 0,
    'zero by 1150 m along, inside the 1200 m visual radius',
  );
  check(
    'it is up while the event spans the road',
    weatherOpacity(1, 0, 1000) > 0.98 && weatherOpacity(1, 600, 1000) > 0.98,
    `${(weatherOpacity(1, 600, 1000) * 100).toFixed(0)}% at 600 m along`,
  );
  check(
    'it dissolves before it can be reached',
    weatherOpacity(1, 0, WEATHER_NEAR_GONE) === 0 &&
      weatherOpacity(1, 0, (WEATHER_NEAR_GONE + WEATHER_NEAR_FULL) / 2) < 0.6,
    `zero inside ${WEATHER_NEAR_GONE} m, half faded at ` +
      `${((WEATHER_NEAR_GONE + WEATHER_NEAR_FULL) / 2).toFixed(0)} m`,
  );
  check(
    'it is suppressed at night, like the mirage',
    weatherOpacity(0, 0, 1000) === 0 && weatherOpacity(0.11, 0, 1000) === 0,
    'zero below the same twilight band',
  );
  let monotone = true;
  for (let along = 0; along < 1400; along += 10) {
    if (weatherOpacity(1, along + 10, 1000) > weatherOpacity(1, along, 1000) + 1e-12) {
      monotone = false;
    }
  }
  check('nothing pops on the way out', monotone, 'opacity never rises as it recedes');
}

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} CHECK(S) FAILED`);
process.exitCode = failures === 0 ? 0 : 1;
