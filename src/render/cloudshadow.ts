import * as THREE from 'three';
import type { WebGLProgramParametersWithUniforms } from 'three';
import { hashUnit2 } from '../core/rng';
import { shadowModeDefault, shadowModeFor, type GraphicsQuality } from '../game/settings';
import { weather } from '../world/weather';

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
/**
 * Where the patches give way to their mean, metres from the eye.
 *
 * The field is evaluated per vertex (see CLOUD_VERTEX_HOOK), and the vista that
 * carries the far ground is a camera-centred polar mesh of 160 sectors: its vertices
 * are 4 % of their radius apart round each ring — 120 m at 3 km, 390 m at 10 km — and
 * they travel with the camera. A 420 m patch on that mesh does not band, it JUMPS:
 * every rebuild moves every sample to an unrelated point of the field, and whole
 * hillsides blinked light and dark, worst after rain, when a thinning storm deck puts
 * the most shade on the ground. The detail octave is half the size, so it goes first.
 */
const CLOUD_FAR_START_M = 1800;
const CLOUD_FAR_END_M = 3200;
const CLOUD_DETAIL_FAR_START_M = 900;
const CLOUD_DETAIL_FAR_END_M = 1800;

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
 * mass in 0.25..0.75, so a band centred just under the middle puts a little over
 * half the ground in shade with an edge hundreds of metres wide — the penumbra of a
 * cloud two kilometres up, which is what a hard-edged patch got wrong.
 *
 * WIDENED ONCE, from 0.54..0.74. The first band produced a visible edge at 75 m of
 * 10-90% penumbra — a cloud's shadow on the ground has no edge at all, and 75 m
 * reads as one when the patch is 400 m across. The band is 0.40 wide; measured by
 * `tools/sky-variety.ts`, which fails below 100 m.
 *
 * LOWERED ONCE, from 0.42..0.82, so the clearing after rain was every day's; RAISED
 * BACK to 0.42..0.74 (2026-10-17) when the sky's cumulus became a volume
 * (render/cloudvolume.ts) and the shade had to be the shadow OF those clouds; and
 * RAISED AGAIN to 0.61..0.93 the same day, when the owner found the sky too full ("it
 * looks generated"). The band's middle sits on the clouds' own footprint edge
 * (`CLOUD_COVER_EDGE`), so the shade fraction follows the cloud cover, about 15%, and
 * the penumbra reaches a little past each cloud as a real one does. 0.32 wide, so the
 * 10-90% penumbra stays over 100 m (the tool's floor).
 */
const CLOUD_EDGE_LOW = 0.61;
const CLOUD_EDGE_HIGH = 0.93;
/**
 * Where the sky's cumulus stands, in field units (render/cloudvolume.ts): a cloud's
 * footprint begins where the field crosses `CLOUD_COVER_EDGE` (its height is read from
 * the blurred field, in cloudvolume.ts). The field's 85th percentile is 0.77, so before
 * erosion about 15% of the sky has cloud over it, and not evenly: over 3 km stretches
 * of sky (`CLOUD_COVER_AMPLITUDE`) one in seven holds almost nothing, the median 12%,
 * one in ten 30% or more. A clear-district sky has a few isolated small clouds where the
 * field's peaks poke through; a cloudy district's footprints run together into big ones.
 */
export const CLOUD_COVER_EDGE = 0.77;
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

/**
 * THE FIELD'S IRREGULARITY (owner, 2026-10-17: the sky showed "a grid", clouds that
 * shout "a function made us"). Value noise keeps its lattice: every blob sits on a
 * square cell of one size. Four cheap terms break that, every one periodic on the
 * field's period so the origin reduction above still holds:
 *  - WARP. The sample point is pushed up to `CLOUD_WARP_M` by a 1.68 km noise pair, so
 *    no cell edge stays straight.
 *  - A SECOND LATTICE at 97 cells a period (554 m), mixed in: two incommensurate grids
 *    leave no axis for the eye to find.
 *  - COVERAGE at 3.36 km: whole districts of sky more and less cloudy, clusters and
 *    clear gaps rather than an even sprinkle. Its amplitude was 0.24, and the sky then
 *    held about the same number of same-size puffs everywhere, which read as
 *    procedural; at 0.6 it outweighs the other terms over a district, so some districts
 *    are near-clear with a few small clouds and others hold big merged ones.
 *  - The half-size DETAIL octave, as before, on the warped point.
 * The sum is re-spread about 0.5 (`CLOUD_SPREAD`), since mixing two lattices narrows it.
 */
const CLOUD_WARP_CELLS = 32;
const CLOUD_WARP_M = 520;
const CLOUD_SECOND_CELLS = 97;
const CLOUD_SECOND_SHARE = 0.35;
const CLOUD_COVER_CELLS = 16;
const CLOUD_COVER_AMPLITUDE = 0.6;
const CLOUD_SPREAD = 1.3;
/** Hash offsets of the extra lattices, whole numbers like CLOUD_DETAIL_SALT. */
const SALT_WARP_X = 41;
const SALT_WARP_Z = 43;
const SALT_COVER = 47;
const SALT_SECOND = 53;

/** Shade of a raw field value: the shadow's edge band (`CLOUD_EDGE_LOW`..`HIGH`). */
export function cloudShadeOfField(field: number): number {
  return smoothstep(CLOUD_EDGE_LOW, CLOUD_EDGE_HIGH, field);
}

/** Shade from an already-drifted sample point. Shared by both entry points. */
function shadeFromSample(sx: number, sz: number, salt: number, detail: number): number {
  return cloudShadeOfField(cloudFieldAt(sx, sz, salt, detail));
}

/** CPU twin of the GLSL `cloudField`, at an already-drifted sample point. */
export function cloudFieldAt(sx: number, sz: number, salt: number, detail: number): number {
  const warpCell = CLOUD_PERIOD_M / CLOUD_WARP_CELLS;
  const px = sx + (cloudNoise(sx / warpCell, sz / warpCell, CLOUD_WARP_CELLS, salt + SALT_WARP_X) - 0.5) * CLOUD_WARP_M;
  const pz = sz + (cloudNoise(sx / warpCell, sz / warpCell, CLOUD_WARP_CELLS, salt + SALT_WARP_Z) - 0.5) * CLOUD_WARP_M;
  const secondCell = CLOUD_PERIOD_M / CLOUD_SECOND_CELLS;
  const a = cloudNoise(px / CLOUD_CELL_M, pz / CLOUD_CELL_M, CLOUD_PERIOD_CELLS, salt);
  const b = cloudNoise(px / secondCell, pz / secondCell, CLOUD_SECOND_CELLS, salt + SALT_SECOND);
  const coverCell = CLOUD_PERIOD_M / CLOUD_COVER_CELLS;
  let field =
    0.5 + (a + (b - a) * CLOUD_SECOND_SHARE - 0.5) * CLOUD_SPREAD +
    (cloudNoise(sx / coverCell, sz / coverCell, CLOUD_COVER_CELLS, salt + SALT_COVER) - 0.5) * CLOUD_COVER_AMPLITUDE;
  if (detail > 0) {
    field +=
      detail *
      (cloudNoise(px / CLOUD_DETAIL_CELL_M, pz / CLOUD_DETAIL_CELL_M, CLOUD_DETAIL_PERIOD_CELLS, salt + CLOUD_DETAIL_SALT) - 0.5) *
      CLOUD_DETAIL_AMPLITUDE;
  }
  return field;
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
 * The cumulus slab above the eye, metres (render/cloudvolume.ts). Fair-weather cumulus
 * all condense at one level, the lifting condensation level, so every cloud has its
 * flat base at `CLOUD_BASE_M`; the tops build to at most `CLOUD_TOP_M`, the densest
 * cores tallest. Parallax comes from the volume itself now, not from staggered decks.
 */
export const CLOUD_BASE_M = 1300;
export const CLOUD_TOP_M = 2300;
/**
 * The one height the ground's shade looks up the sun's ray to: a few hundred metres
 * into the slab, where a typical cloud is widest, so the shadow lands under the body
 * of the cloud rather than under its base alone.
 */
const CLOUD_SHADOW_HEIGHT_M = CLOUD_BASE_M + 350;

/**
 * The field itself, shared by the ground (its shadows) and the sky (the clouds that
 * cast them): one lattice, one salt, one pan, so every patch of shade on the sand has
 * its cloud overhead and the two drift together. `cloudField` is the raw value before
 * any threshold; `detail` 0..1 scales the half-size octave. The literals come from the
 * constants above rather than being retyped, because the CPU twin and the shader
 * disagreeing about a lattice spacing is a bug nobody would find by looking.
 */
export const CLOUD_FIELD_GLSL = /* glsl */ `
uniform vec2 uCloudPan;
uniform float uCloudSalt;

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

/** The half-size octave alone, zero-mean (see CLOUD_DETAIL_AMPLITUDE). */
float cloudDetailOctave( vec2 at ) {
	return ( cloudNoise(
		at / ${CLOUD_DETAIL_CELL_M.toFixed(1)},
		${CLOUD_DETAIL_PERIOD_CELLS.toFixed(1)},
		uCloudSalt + ${CLOUD_DETAIL_SALT.toFixed(1)}
	) - 0.5 ) * ${CLOUD_DETAIL_AMPLITUDE.toFixed(2)};
}

float cloudField( vec2 at, float detail ) {
	// See fieldAt (the CPU twin) for the four terms.
	vec2 warp = vec2(
		cloudNoise( at / ${(CLOUD_PERIOD_M / CLOUD_WARP_CELLS).toFixed(1)}, ${CLOUD_WARP_CELLS.toFixed(1)}, uCloudSalt + ${SALT_WARP_X.toFixed(1)} ),
		cloudNoise( at / ${(CLOUD_PERIOD_M / CLOUD_WARP_CELLS).toFixed(1)}, ${CLOUD_WARP_CELLS.toFixed(1)}, uCloudSalt + ${SALT_WARP_Z.toFixed(1)} )
	) - 0.5;
	vec2 p = at + warp * ${CLOUD_WARP_M.toFixed(1)};
	float a = cloudNoise( p / ${CLOUD_CELL_M.toFixed(1)}, ${CLOUD_PERIOD_CELLS.toFixed(1)}, uCloudSalt );
	float b = cloudNoise( p / ${(CLOUD_PERIOD_M / CLOUD_SECOND_CELLS).toFixed(4)}, ${CLOUD_SECOND_CELLS.toFixed(1)}, uCloudSalt + ${SALT_SECOND.toFixed(1)} );
	float field = 0.5 + ( mix( a, b, ${CLOUD_SECOND_SHARE.toFixed(2)} ) - 0.5 ) * ${CLOUD_SPREAD.toFixed(2)}
		+ ( cloudNoise( at / ${(CLOUD_PERIOD_M / CLOUD_COVER_CELLS).toFixed(1)}, ${CLOUD_COVER_CELLS.toFixed(1)}, uCloudSalt + ${SALT_COVER.toFixed(1)} ) - 0.5 ) * ${CLOUD_COVER_AMPLITUDE.toFixed(2)};
	if ( detail > 0.0 ) field += detail * cloudDetailOctave( p );
	return field;
}
`;

/**
 * The field value the distant ground's shade gives way to: the one whose shade is the
 * field's MEAN shade (about 0.15), so far land keeps the average light of the patches
 * rather than the shade of the average field, which this band would make unshaded.
 * `tools/sky-variety.ts` measures the mean against it.
 */
export const CLOUD_FAR_FIELD = 0.69;

const CLOUD_VERTEX_PARS = /* glsl */ `
${CLOUD_FIELD_GLSL}
uniform float uCloudDetail;
uniform float uCloudStrength;
uniform float uWet;
uniform vec2 uGroundPan;
uniform vec2 uCloudSunSlope;
varying float vCloudShade;
varying float vWetMask;

float cloudShade( vec2 scene, float dist ) {
	// The cloud that shades this point stands up the sun's ray from it: met at the height
	// where the slab's clouds are widest (CLOUD_SHADOW_HEIGHT_M).
	vec2 at = scene + uCloudPan + uCloudSunSlope * ${CLOUD_SHADOW_HEIGHT_M.toFixed(1)};
	// See CLOUD_FAR_*: out where the mesh is too coarse for them, the patches give way
	// to their mean shade (CLOUD_FAR_FIELD), so distant land keeps it without blinking.
	float near = 1.0 - smoothstep( ${CLOUD_FAR_START_M.toFixed(1)}, ${CLOUD_FAR_END_M.toFixed(1)}, dist );
	float detail = uCloudDetail * ( 1.0 - smoothstep( ${CLOUD_DETAIL_FAR_START_M.toFixed(1)}, ${CLOUD_DETAIL_FAR_END_M.toFixed(1)}, dist ) );
	float field = mix( ${CLOUD_FAR_FIELD.toFixed(2)}, cloudField( at, detail ), near );
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
varying float vWetMask;
uniform float uCloudStrength;
uniform float uWet;
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
	vec3 cloudWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
	float cloudDist = distance( cloudWorld, cameraPosition );
	vCloudShade = uCloudStrength > 0.0 ? cloudShade( cloudWorld.xz, cloudDist ) : 0.0;
	// Wet ground dries in patches, not as one sheet: a nine-metre noise decides which
	// ground holds its water longest (the hollows, the ruts), evaluated per vertex for
	// the same reason as the cloud field above, and only while anything is wet.
	//
	// Only where the mesh can carry it. The vista's vertices are up to 360 m apart and
	// its rings follow the camera, so a nine-metre noise sampled on them is pure
	// aliasing: every vertex lands on an unrelated cell, and every rebuild re-rolls
	// them — whole hillsides blinked dark and light after rain. With distance the
	// noise gives way to its own mean, so far ground is evenly damp; the near tiles
	// are 2.67 m and keep every patch.
	vWetMask = 0.0;
	if ( uWet > 0.0 ) {
		float held = cloudNoise( ( cloudWorld.xz + uGroundPan ) / 9.0, 4096.0, uCloudSalt + 7.0 );
		held = mix( held, 0.5, smoothstep( 180.0, 420.0, cloudDist ) );
		vWetMask = smoothstep( 0.0, 0.35, uWet - held * 0.65 + 0.3 );
	}`;

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
/**
 * Wet ground only darkens. The road used to go glossy and mirror the horizon, and every
 * oncoming headlamp laid a streak along it, wet or dry; the owner (2026-10-16) wanted
 * none of it: desert asphalt is matt, and after rain it dries in minutes.
 */
const CLOUD_FRAGMENT_HOOK = /* glsl */ `
	if ( uCloudStrength > 0.0 ) {
		outgoingLight *= 1.0 - vCloudShade * uCloudStrength;
	}
	if ( uWet > 0.0 ) {
		// Water darkens anything porous by filling the air gaps that scattered light
		// back out: damp sand and wet asphalt both lose about a third of their light.
		outgoingLight *= 1.0 - 0.36 * vWetMask;
	}
#include <opaque_fragment>`;

/** Suffix, so a patched material never shares a program with an unpatched one. */
const CLOUD_PROGRAM_KEY = 'cloud-shadow-v5';

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
  /** Ground wetness from world/weather.ts, 0..1. */
  uWet: { value: 0 },
  /** The rebase origin reduced into one wet-patch period: puddles stay put on a rebase. */
  uGroundPan: { value: new THREE.Vector2() },
  /** Horizontal metres per metre of height along the sun's ray (`setCloudSunShift`). */
  uCloudSunSlope: { value: new THREE.Vector2() },
};

/**
 * The field's uniforms for the sky's cumulus (render/sky.ts, render/cloudvolume.ts): the very objects the
 * ground is bound to, so the clouds and their shadows can never be a frame apart.
 */
export const cloudFieldUniforms = { uCloudPan: uniforms.uCloudPan, uCloudSalt: uniforms.uCloudSalt };

/**
 * Lowest sun the shift follows. Below it the shadow would come from a cloud ten or more
 * kilometres off, out where the sky has faded its clouds into the horizon; the shadows
 * themselves are fading out with the day by then (`CLOUD_DAY_LOW`).
 */
const SUN_SHIFT_MIN_ELEVATION = 0.15;

/**
 * Points the ground's shade at the clouds that cast it: a ground point is shaded by the
 * cloud where the ray from it to the sun (`sunDir`, unit, scene frame) meets the body of
 * the slab (`CLOUD_SHADOW_HEIGHT_M`). Called once a frame by the sky.
 */
export function setCloudSunShift(sunDir: THREE.Vector3): void {
  const k = 1 / Math.max(SUN_SHIFT_MIN_ELEVATION, sunDir.y);
  uniforms.uCloudSunSlope.value.set(sunDir.x * k, sunDir.z * k);
}

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
 * decides the detail octave — the rung's default shadow mode through `shadowModeFor`
 * is reused rather than a new tier key invented, because it already answers the
 * question being asked here (does this presentation have per-pixel fill rate to spare
 * for the light), and it answers no for every phone, which is where the second octave
 * was worth the most. The player's `Settings.shadows` is a different question.
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
  // Weather on the shade: a building storm puts deeper shade on the ground; once the
  // deck has closed the sun is gone and so are the patches (the lights carry the
  // gloom). Haze and dust scatter the sun into a flat light that casts no patch at all.
  const w = weather;
  const building = w.cloud * (1 - w.cloud) * 4;
  uniforms.uCloudStrength.value =
    cloudShadowStrength(dayFactor) *
    (1 + 0.25 * building) *
    (1 - 0.9 * Math.max(0, w.cloud - 0.6) / 0.4) *
    (1 - 0.6 * w.haze) *
    (1 - w.dust);
  uniforms.uCloudDetail.value =
    shadowModeFor(shadowModeDefault(quality), quality, mobilePresentation) !== 'off' ? 1 : 0;
  uniforms.uWet.value = w.wet;
  uniforms.uGroundPan.value.set(
    originX - WET_PERIOD_M * Math.floor(originX / WET_PERIOD_M),
    originZ - WET_PERIOD_M * Math.floor(originZ / WET_PERIOD_M),
  );
}

/** Period of the wet-patch lattice: 4096 cells of 9 m. */
const WET_PERIOD_M = 9 * 4096;

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
