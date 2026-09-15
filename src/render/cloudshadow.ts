import * as THREE from 'three';
import type { WebGLProgramParametersWithUniforms } from 'three';
import { hashUnit2 } from '../core/rng';
import { shadowsFor, type GraphicsQuality } from '../game/settings';

/**
 * CLOUD SHADOWS: the only thing in this desert that changes without the player
 * driving anywhere.
 *
 * WHY IT EXISTS. Measured (`road_variety_current.md`), nothing inside 3 km of view
 * changes, and the worst offender is not the geometry — it is the LIGHT. The sun
 * moves a degree in four minutes, the sky palette is a function of its elevation
 * alone, and the ground therefore holds exactly one brightness for minutes at a
 * time. A desert under a clear sky is genuinely like that; a desert under the
 * ordinary broken cumulus of a Saharan afternoon is not, and that afternoon is the
 * cheapest variety available: a patch of shade sliding across three kilometres of
 * open ground is visible from anywhere, needs no geometry, and never repeats
 * itself in the same place twice.
 *
 * WHAT IT IS. One scrolling low-frequency noise field, sampled in WORLD space by
 * every ground material, multiplying the light that leaves the surface. No shadow
 * map, no second pass, no texture: eight hash evaluations on a ground fragment,
 * and none at all at night (see `uCloudStrength` below, which gates the whole
 * block and is zero after dusk).
 *
 * THE THREE THINGS THAT MAKE IT CORRECT RATHER THAN MERELY CHEAP:
 *
 *  1. IT IS WORLD-ANCHORED, ACROSS A REBASE. The scene is origin-relative
 *     (`world/origin.ts`), so a fragment's own position is NOT a world coordinate,
 *     and sampling the field at it would nail the clouds to the player: the shade
 *     would never arrive, and every rebase would teleport the pattern. The origin
 *     goes in as a uniform instead. It cannot go in as a raw absolute coordinate
 *     either — the road reaches 386 km from the centre, where f32 steps in metres,
 *     and the shader adds it in f32 — so what the uniform carries is the origin
 *     REDUCED MODULO the field's own period. The field is exactly periodic by
 *     construction (its lattice cells are wrapped before they are hashed), so the
 *     reduced sample and the absolute sample are the same sample, and the largest
 *     number the shader ever handles is one period instead of one road.
 *  2. IT IS DRIVEN BY THE LOOP'S OWN CLOCK. `advanceCloudShadows` integrates the
 *     render frame's dt, which is the clock the sky and the wheel spray already
 *     run on. Wall-clock time would keep the clouds moving through a pause and
 *     ignore any time scaling; a game-clock day fraction would fly them past at
 *     the day-cycle compression (a 24-minute day is 60x) instead of at wind speed.
 *  3. IT IS OFF AT NIGHT. Not because a moonlit cloud casts no shadow, but because
 *     the ground light it would modulate is hemisphere fill, and darkening fill by
 *     a third reads as dirt rather than shade. The gate is the same band the
 *     mirage uses on the same day factor (`render/mirage.ts`), so the two illusions
 *     leave together at dusk.
 *
 * WHY THE STATE IS MODULE-LEVEL rather than an instance's. The ground materials are
 * themselves module-level singletons (`TERRAIN_MATERIAL`, the road ribbon's
 * `roadMaterial`, the vista's `MESA_MATERIAL`), created at import time, long before
 * anything in `main.ts` runs. One shared uniform block is therefore the only thing
 * they can all be bound to, and one shared block is also what makes the per-frame
 * cost a single uniform write for the whole world instead of one per material.
 */

// ---------------------------------------------------------------------------
// The field
// ---------------------------------------------------------------------------

/**
 * Lattice spacing of the shadow patches, metres.
 *
 * This is the number that decides whether the effect reads as weather or as a
 * pattern. At 120 m the ground boiled: patches arrived and left inside a second at
 * road speed and the whole desert shimmered. At 1500 m there is one shadow and it
 * takes four minutes to cross, which is indistinguishable from the sun having
 * moved. 420 m gives a patch that takes tens of seconds to pass at wind speed and
 * a few seconds to drive through — the thing a cumulus field actually does.
 */
export const CLOUD_CELL_M = 420;
/** Second octave: ragged edges at half the patch scale, not a second field. */
export const CLOUD_DETAIL_CELL_M = 210;
/**
 * Cells before the lattice repeats, and why it repeats at all.
 *
 * The wrap is what lets the shader work in small numbers (see the origin note
 * above): the field is periodic, so the origin can be reduced into one period
 * before it is ever handled in f32. 128 cells is 53.76 km of road between
 * repeats of a pattern which is a soft grey blob with no landmark in it — the
 * player would have to drive 54 km and remember the shape of a shadow. The
 * detail octave shares the period exactly (53 760 / 210 = 256 cells), so the
 * sum of the two is periodic and not merely nearly so.
 */
export const CLOUD_PERIOD_CELLS = 128;
export const CLOUD_PERIOD_M = CLOUD_CELL_M * CLOUD_PERIOD_CELLS;
const CLOUD_DETAIL_PERIOD_CELLS = CLOUD_PERIOD_M / CLOUD_DETAIL_CELL_M;
/**
 * How much the detail octave moves the field, and why it is ZERO-MEAN.
 *
 * The octave is added as `(noise - 0.5) * amplitude` rather than as a weighted
 * mean of two noises, so switching it off (a phone, the weakest rung) changes the
 * RAGGEDNESS of a patch edge and not how much of the ground is in shade. Mixed in
 * the usual way, the cheap tier would have had visibly fewer, larger shadows —
 * a different sky, not a cheaper one.
 *
 * Lowered with the edge band below: an octave half the patch's size at two thirds
 * of its old amplitude keeps the patch's outline irregular without drawing a hard
 * scalloped boundary along it.
 */
const CLOUD_DETAIL_AMPLITUDE = 0.14;
/**
 * The soft edge, in field units. Value noise of this kind has almost all of its
 * mass in 0.25..0.75, so a band across the upper half puts roughly a third of the
 * ground in shade with an edge hundreds of metres wide — the penumbra of a cloud
 * two kilometres up, which is what a hard-edged patch got wrong.
 *
 * WIDENED ONCE, from 0.54..0.74. The first band produced a visible edge at 75 m of
 * 10-90% penumbra — a cloud's shadow on the ground has no edge at all, and 75 m
 * reads as one when the patch is 400 m across. The band is 0.40 wide and centred
 * where the old one was, so coverage and the deep end are unchanged and the
 * transition is a little over twice as long. Measured by `tools/sky-variety.ts`,
 * which fails below 100 m: 170 m median, 129 m at the worst quartile.
 */
const CLOUD_EDGE_LOW = 0.42;
const CLOUD_EDGE_HIGH = 0.82;
/**
 * Deepest darkening, as a fraction of the light leaving the surface.
 *
 * A cumulus blocks the sun but not the sky, and in this desert the sky fill is a
 * large part of the ground's light; measured against the real thing, shaded sand
 * keeps most of its brightness and loses its contrast. 0.32 at the core of a patch
 * puts the typical shaded ground at 15-30% down, which reads as shade. Past about
 * 0.45 it reads as a bruise on the terrain.
 */
export const CLOUD_DARKEN_MAX = 0.32;
/**
 * Drift speed, m/s. A gentle breeze aloft. Cloud shadows move with the wind at
 * cloud base, not with the surface wind, and 6 m/s takes a patch across its own
 * width in about 70 seconds: slow enough that the shade arriving is a surprise,
 * fast enough that standing still is never static.
 */
export const CLOUD_DRIFT_MPS = 6;
/** Mirage's own twilight band, so the two illusions leave together. */
export const CLOUD_DAY_LOW = 0.12;
export const CLOUD_DAY_HIGH = 0.42;

/** Hash domains. Distinct from every other system's. */
const TAG_WIND = 0x43534831; // 'CSH1'
const TAG_SALT = 0x43534832; // 'CSH2'
/**
 * Offset between the two octaves' hash domains, written into the GLSL as well.
 *
 * A WHOLE NUMBER on purpose. It is added to the salt uniform, and the salt is a
 * multiple of a sixteenth, so a whole offset leaves the sum exact in f32, in f64
 * and in a GLSL literal alike. It was 19.19, which is none of those: f32 and f64
 * disagree about it in the seventh digit, and a hash magnifies a seventh-digit
 * disagreement into a different number — so the CPU twin and the shader would have
 * been measuring two different detail octaves.
 */
const CLOUD_DETAIL_SALT = 19;

const f32 = Math.fround;

function fract(v: number): number {
  return v - Math.floor(v);
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * The lattice hash, and the one place in this file where the arithmetic is written
 * out in f32.
 *
 * This is the CPU twin of the GLSL below, and it exists so `tools/sky-variety.ts`
 * can measure the field the player sees rather than a different field with the same
 * intent. A hash is chaotic: one ulp of disagreement is not a small error in the
 * answer, it is a different answer, so every step is rounded to f32 exactly as the
 * shader's highp float does, the sums are parenthesised in the order the GLSL
 * parenthesises them, and `dot` is avoided because GLSL does not specify the order
 * it accumulates one in. (The interpolation and the smoothstep further down are
 * left in f64: they are numerically placid, so the two agree to ~1e-7 there, which
 * cannot move a shade band by a pixel.)
 *
 * Sine is avoided for the same reason in reverse: `sin` is the usual hash mixer and
 * its precision is explicitly implementation-defined in GLSL, so it cannot be
 * mirrored on a CPU at all.
 */
function cloudHash(cx: number, cz: number, salt: number): number {
  const k = f32(0.1031);
  const c = f32(33.33);
  let hx = f32(fract(f32(cx * k)));
  let hy = f32(fract(f32(cz * k)));
  let hz = f32(fract(f32(f32(f32(cx + cz) + salt) * k)));
  const d = f32(
    f32(f32(hx * f32(hy + c)) + f32(hy * f32(hz + c))) + f32(hz * f32(hx + c)),
  );
  hx = f32(hx + d);
  hy = f32(hy + d);
  hz = f32(hz + d);
  return f32(fract(f32(f32(hx + hy) * hz)));
}

/** Cell index folded into one period, so the field repeats exactly. */
function cloudWrap(cell: number, cells: number): number {
  return cell - cells * Math.floor(cell / cells);
}

/** Smoothstep-interpolated value noise on a wrapped lattice. */
function cloudNoise(px: number, pz: number, cells: number, salt: number): number {
  const ix = Math.floor(px);
  const iz = Math.floor(pz);
  const fx = px - ix;
  const fz = pz - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const x0 = cloudWrap(ix, cells);
  const x1 = cloudWrap(ix + 1, cells);
  const z0 = cloudWrap(iz, cells);
  const z1 = cloudWrap(iz + 1, cells);
  const a = cloudHash(x0, z0, salt);
  const b = cloudHash(x1, z0, salt);
  const c = cloudHash(x0, z1, salt);
  const d = cloudHash(x1, z1, salt);
  return a + (b - a) * ux + ((c + (d - c) * ux) - (a + (b - a) * ux)) * uz;
}

/** Which patch layout this seed gets. Small, so the shader holds it exactly. */
export function cloudShadowSalt(seed: number): number {
  // Quantised to sixteenths: an f32 uniform, a JS double and a GLSL literal all
  // hold a multiple of 1/16 in this range exactly, so the CPU twin and the shader
  // start from the identical number rather than one 1e-8 apart.
  return Math.round(hashUnit2(seed, TAG_SALT) * 512 * 16) / 16;
}

/** Wind at cloud base: direction from the seed, speed fixed. Metres per second. */
export function cloudShadowWind(seed: number, out: { x: number; z: number }): void {
  const angle = hashUnit2(seed, TAG_WIND) * Math.PI * 2;
  out.x = Math.cos(angle) * CLOUD_DRIFT_MPS;
  out.z = Math.sin(angle) * CLOUD_DRIFT_MPS;
}

/** Reused by both entry points below; neither nests inside the other. */
const windScratch = { x: 0, z: 0 };

/**
 * The field's shade at a point, 0 (full sun) to 1 (the core of a patch).
 *
 * `x`/`z` are ABSOLUTE world metres and `elapsed` is seconds since the drive began;
 * `detail` is 0 or 1. Pure: this is the function the shader evaluates, and the only
 * difference between the two is which of them had to reduce the coordinate first.
 */
export function cloudShadowShadeAt(
  seed: number,
  x: number,
  z: number,
  elapsed: number,
  detail: number,
): number {
  cloudShadowWind(seed, windScratch);
  return shadeFromSample(
    x - windScratch.x * elapsed,
    z - windScratch.z * elapsed,
    cloudShadowSalt(seed),
    detail,
  );
}

/** Shade from an already-drifted sample point. Shared by both entry points. */
function shadeFromSample(sx: number, sz: number, salt: number, detail: number): number {
  let field = cloudNoise(sx / CLOUD_CELL_M, sz / CLOUD_CELL_M, CLOUD_PERIOD_CELLS, salt);
  if (detail > 0) {
    field +=
      detail *
      (cloudNoise(
        sx / CLOUD_DETAIL_CELL_M,
        sz / CLOUD_DETAIL_CELL_M,
        CLOUD_DETAIL_PERIOD_CELLS,
        salt + CLOUD_DETAIL_SALT,
      ) -
        0.5) *
      CLOUD_DETAIL_AMPLITUDE;
  }
  return smoothstep(CLOUD_EDGE_LOW, CLOUD_EDGE_HIGH, field);
}

/** How much of the light survives at a point: 1 in full sun, `1 - CLOUD_DARKEN_MAX` at worst. */
export function cloudShadowFactorAt(
  seed: number,
  x: number,
  z: number,
  elapsed: number,
  dayFactor: number,
  detail: number,
): number {
  return 1 - cloudShadowShadeAt(seed, x, z, elapsed, detail) * cloudShadowStrength(dayFactor);
}

/** Deepest darkening the current daylight allows. Zero is the shader's early-out. */
export function cloudShadowStrength(dayFactor: number): number {
  return CLOUD_DARKEN_MAX * smoothstep(CLOUD_DAY_LOW, CLOUD_DAY_HIGH, dayFactor);
}

/**
 * The origin, drifted and reduced into one field period: exactly what the uniform
 * carries and what the shader adds to a scene-relative fragment position.
 *
 * Computed in f64 and then uploaded as an f32 uniform, which rounds it — at the far
 * end of a period that is a step of 4 mm, so the shader's sample point is up to 4 mm
 * from this one. A shade band here is two hundred metres wide, so the two answers
 * differ in the eighth decimal place of a smoothstep. It is worth saying out loud
 * because the SAME rounding applied to an unreduced 386 km origin would have been a
 * step of 30 mm on the ground and a jitter in the pattern every rebase.
 */
export function cloudShadowPan(
  seed: number,
  elapsed: number,
  originX: number,
  originZ: number,
  out: { x: number; z: number },
): void {
  cloudShadowWind(seed, windScratch);
  const x = originX - windScratch.x * elapsed;
  const z = originZ - windScratch.z * elapsed;
  out.x = x - CLOUD_PERIOD_M * Math.floor(x / CLOUD_PERIOD_M);
  out.z = z - CLOUD_PERIOD_M * Math.floor(z / CLOUD_PERIOD_M);
}

/**
 * The shader's own path: a scene-relative fragment position plus the pan uniform.
 * Answers the same question as `cloudShadowFactorAt` at the absolute point, which
 * is the property the rebase depends on and the tool checks.
 */
export function cloudShadowFactorFromPan(
  panX: number,
  panZ: number,
  relX: number,
  relZ: number,
  salt: number,
  dayFactor: number,
  detail: number,
): number {
  return 1 - shadeFromSample(relX + panX, relZ + panZ, salt, detail) * cloudShadowStrength(dayFactor);
}

// ---------------------------------------------------------------------------
// GLSL
// ---------------------------------------------------------------------------

/**
 * Written once and shared by every ground material. The literals come from the
 * constants above rather than being retyped, because the CPU twin and the shader
 * disagreeing about a lattice spacing is a bug nobody would find by looking.
 */
const CLOUD_VERTEX_PARS = /* glsl */ `
uniform vec2 uCloudPan;
uniform float uCloudSalt;
uniform float uCloudDetail;
uniform float uCloudStrength;
varying float vCloudShade;

float cloudHash( float cx, float cz, float salt ) {
	float hx = fract( cx * 0.1031 );
	float hy = fract( cz * 0.1031 );
	float hz = fract( ( ( cx + cz ) + salt ) * 0.1031 );
	float d = ( hx * ( hy + 33.33 ) + hy * ( hz + 33.33 ) ) + hz * ( hx + 33.33 );
	hx += d;
	hy += d;
	hz += d;
	return fract( ( hx + hy ) * hz );
}

float cloudWrap( float cell, float cells ) {
	return cell - cells * floor( cell / cells );
}

float cloudNoise( vec2 p, float cells, float salt ) {
	vec2 i = floor( p );
	vec2 f = p - i;
	f = f * f * ( 3.0 - 2.0 * f );
	float x0 = cloudWrap( i.x, cells );
	float x1 = cloudWrap( i.x + 1.0, cells );
	float z0 = cloudWrap( i.y, cells );
	float z1 = cloudWrap( i.y + 1.0, cells );
	float a = cloudHash( x0, z0, salt );
	float b = cloudHash( x1, z0, salt );
	float c = cloudHash( x0, z1, salt );
	float d = cloudHash( x1, z1, salt );
	return mix( mix( a, b, f.x ), mix( c, d, f.x ), f.y );
}

float cloudShade( vec2 scene ) {
	vec2 at = scene + uCloudPan;
	float field = cloudNoise( at / ${CLOUD_CELL_M.toFixed(1)}, ${CLOUD_PERIOD_CELLS.toFixed(1)}, uCloudSalt );
	if ( uCloudDetail > 0.0 ) {
		field += uCloudDetail * ( cloudNoise(
			at / ${CLOUD_DETAIL_CELL_M.toFixed(1)},
			${CLOUD_DETAIL_PERIOD_CELLS.toFixed(1)},
			uCloudSalt + ${CLOUD_DETAIL_SALT.toFixed(1)}
		) - 0.5 ) * ${CLOUD_DETAIL_AMPLITUDE.toFixed(2)};
	}
	return smoothstep( ${CLOUD_EDGE_LOW.toFixed(2)}, ${CLOUD_EDGE_HIGH.toFixed(2)}, field );
}
`;

/**
 * What the fragment stage still needs: the shade, and how much of it to apply.
 *
 * `uCloudStrength` is declared in BOTH stages on purpose — the vertex stage uses it to
 * skip the whole field at night, and the fragment stage to skip the multiply. A uniform
 * declared in two stages of one program is ordinary GLSL, and it means the zero-strength
 * frame this effect has always promised costs nothing anywhere rather than only in the
 * half of the pipeline that used to do the hashing.
 */
const CLOUD_FRAGMENT_PARS = /* glsl */ `
varying float vCloudShade;
uniform float uCloudStrength;
`;

/**
 * WHERE THE FIELD IS EVALUATED, AND WHY IT MOVED.
 *
 * This ran in the FRAGMENT shader first, and on the machine that reported it the frame
 * went from 87 to 36 frames a second: 34 ms of GPU for four hashes a pixel. The
 * arithmetic says it should have been about one, and the reason it was not is that the
 * ground shader is already enormous — twelve light slots per fragment, the comic stack,
 * the spotlight normals, eight shadow-tap lookups — so the sampler, the noise and its
 * temporaries pushed it over the edge into register spilling. Spilled registers are
 * local memory traffic per fragment, which is what a factor of thirty looks like.
 *
 * It is now evaluated PER VERTEX and interpolated, which is the right answer for this
 * field regardless of the spill: a patch is 420 m across, its penumbra is 170 m, and the
 * meshes it lands on are metre-scale — the refined terrain grid is 2.67 m, the road
 * ribbon's rows are 1.3 m. Across a triangle that small the field is a straight line to
 * within a fraction of a percent, so the interpolation is not an approximation of the
 * picture, it IS the picture, and the fragment stage is left with one multiply.
 *
 * WHAT IT IS NOT RIGHT FOR is the vista, whose rings are up to 360 m apart — wider than
 * the penumbra itself — where the interpolation would band the edge across a triangle.
 * At that distance the haze has the ground half washed out, and the ring spacing widens
 * with radius, so the worst triangles are the ones least visible. That is a judgement to
 * be made by looking at the horizon, not by arithmetic; if the banding shows, the answer
 * is to leave `render/vista.ts`'s two materials unpatched, which is one line.
 */
const CLOUD_VERTEX_HOOK = /* glsl */ `#include <worldpos_vertex>
	vCloudShade = uCloudStrength > 0.0
		? cloudShade( ( modelMatrix * vec4( transformed, 1.0 ) ).xz )
		: 0.0;`;

/**
 * Applied to `outgoingLight`, which is the lit surface colour before fog and tone
 * mapping: a shadow must be fogged with the ground it is on (otherwise a patch five
 * kilometres out is a hard grey stain on a hazy horizon) and must be tone-mapped
 * with it (otherwise the darkening is applied to a display value and the deep end
 * of the ramp crushes).
 *
 * The strength test is not a micro-optimisation. It is the whole of the night and
 * tier gating: a zero-strength frame does no work at all, and `uCloudStrength` is a
 * uniform, so the branch is coherent across every fragment in the draw.
 */
const CLOUD_FRAGMENT_HOOK = /* glsl */ `
	if ( uCloudStrength > 0.0 ) {
		outgoingLight *= 1.0 - vCloudShade * uCloudStrength;
	}
#include <opaque_fragment>`;

/** Suffix, so a patched material never shares a program with an unpatched one. */
const CLOUD_PROGRAM_KEY = 'cloud-shadow-v2';

/**
 * ONE uniform block for the whole world. Every patched material is bound to these
 * exact objects, so `advanceCloudShadows` writes four numbers per frame however
 * many ground materials exist.
 */
const uniforms = {
  uCloudPan: { value: new THREE.Vector2() },
  uCloudSalt: { value: 0 },
  uCloudStrength: { value: 0 },
  uCloudDetail: { value: 0 },
};

/** Materials already carrying the injection, so a second call cannot double it. */
const injected = new WeakSet<THREE.Material>();

function patchCloudShader(shader: WebGLProgramParametersWithUniforms): void {
  for (const [name, uniform] of Object.entries(uniforms)) shader.uniforms[name] = uniform;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${CLOUD_VERTEX_PARS}`)
    .replace('#include <worldpos_vertex>', CLOUD_VERTEX_HOOK);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\n${CLOUD_FRAGMENT_PARS}`)
    .replace('#include <opaque_fragment>', CLOUD_FRAGMENT_HOOK);
}

/**
 * Gives one ground material the shared cloud-shadow field. Returns the same
 * material, so it can be wrapped around a construction expression.
 *
 * CHAINS, NEVER REPLACES. Every ground material in the game already carries a patch
 * — `applyComicShading` on the terrain and the vista, `applyGroundSpotlightNormals`
 * on the road ribbon and its markings, and the desert tiles chain a third onto the
 * comic one — so this captures what is there and calls it first. Idempotent as
 * well: the terrain material factory is called twice and the road's asphalt finish
 * is handed out by name, so a second call on a material that already has the field
 * has to be a no-op rather than a second copy of the GLSL (which would not compile:
 * `vCloudShade` would be declared twice).
 */
export function applyCloudShadow(material: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  if (injected.has(material)) return material;
  injected.add(material);

  const previousCompile = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previousCompile.call(material, shader, renderer);
    patchCloudShader(shader);
  };
  const previousKey = material.customProgramCacheKey;
  material.customProgramCacheKey = () => `${previousKey.call(material)}:${CLOUD_PROGRAM_KEY}`;
  return material;
}

// ---------------------------------------------------------------------------
// Per frame
// ---------------------------------------------------------------------------

/** Seconds of drift accumulated from the render loop's own dt. */
let elapsed = 0;
const pan = { x: 0, z: 0 };

/**
 * Advances the field and writes the frame's four uniforms. Called once per rendered
 * frame from `main.ts`, beside the mirage's own presentation update.
 *
 * `dt` is the render frame's delta, NOT wall-clock: a paused or time-scaled game
 * must not have clouds drifting on its own. `dayFactor` is the sky's, and the rung
 * decides the detail octave — `shadowsFor` is reused rather than a new tier key
 * invented, because it already answers the question being asked here (does this
 * presentation have per-pixel fill rate to spare for the light), and it answers no
 * for every phone, which is where the second octave was worth the most.
 */
export function advanceCloudShadows(
  seed: number,
  dt: number,
  dayFactor: number,
  originX: number,
  originZ: number,
  quality: GraphicsQuality,
  mobilePresentation: boolean,
): void {
  elapsed += dt;
  cloudShadowPan(seed, elapsed, originX, originZ, pan);
  uniforms.uCloudPan.value.set(pan.x, pan.z);
  uniforms.uCloudSalt.value = cloudShadowSalt(seed);
  uniforms.uCloudStrength.value = cloudShadowStrength(dayFactor);
  uniforms.uCloudDetail.value = shadowsFor(quality, mobilePresentation) ? 1 : 0;
}

/** The frame's uniform values, read back by `tools/sky-variety.ts`. */
export function cloudShadowFrame(): {
  elapsed: number;
  panX: number;
  panZ: number;
  salt: number;
  strength: number;
  detail: number;
} {
  return {
    elapsed,
    panX: uniforms.uCloudPan.value.x,
    panZ: uniforms.uCloudPan.value.y,
    salt: uniforms.uCloudSalt.value,
    strength: uniforms.uCloudStrength.value,
    detail: uniforms.uCloudDetail.value,
  };
}
