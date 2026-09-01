import * as THREE from 'three';
import type { GraphicsQuality } from '../game/settings';
import { DAY_LENGTH } from '../game/state';
import { skyGradientAt } from '../world/gradient';
import { hash01 } from '../core/rng';
import { AstronomySystem } from './astronomy';
import { StarField } from './starcatalog';
import { PlanetField } from './planetfield';

/**
 * Analytic atmosphere around a real Tycho-2 star catalogue and ephemerides for
 * the Sun, Moon and planets. Celestial coordinates are anchored at Laayoune;
 * procedural dust, cirrus and twilight remain visual weather only.
 */

// ---------------------------------------------------------------------------
// Placement constants
// ---------------------------------------------------------------------------

/**
 * Dome radius. It has to sit OUTSIDE the terrain's draw distance, not level with
 * it: the dome is re-centred on the camera every frame and drawn as a solid
 * inside-out sphere, so ground further from the camera than this gets occluded by
 * it — and since terrain chunks stretch far up and down the road, that showed as a
 * hard curved edge cutting across the distant desert. 3 km clears the 1.5 km
 * lateral reach plus a couple of chunks of road, and still sits inside the 4 km far
 * plane.
 */
const DOME_RADIUS = 3000;
/** Offset of the directional light along its direction; brackets the shadow frustum. */
const SUN_DISTANCE = 240;

/** Sun elevation (radians) below this counts as night for headlight/lamp logic. */
const NIGHT_ELEVATION = -0.08;
/**
 * Sun elevation (radians) at which roadside lamps reach full output. Eight degrees
 * below the horizon: the end of civil twilight, where a lamp finally out-lights
 * the sky. Above the horizon they are off; between the two they ramp.
 */
const LAMP_FULL_ELEVATION = -0.14;

/**
 * Shadow length control, because a physically correct low sun draws nonsense.
 *
 * A shadow's length is the caster's height over tan(elevation), so at 3 degrees a
 * 1.7 m player throws a 32 m shadow and a car throws sixty metres of dark smear —
 * far larger than the thing casting it, streaked across the whole foreground, and
 * blurred by the shadow map's 18 cm texels into an unreadable blob. That is the
 * "shadow is sometimes enormous" everyone notices around dawn and dusk.
 *
 * Two limits, in preference order:
 *
 *  - The shadow-casting DIRECTION never drops below SHADOW_MIN_ELEVATION, while the
 *    sun's own position, colour and disc stay exactly where they were. Shadows keep
 *    pointing the right way and stop growing past about four times the caster's
 *    height. Cheating the direction rather than the light is what preserves the
 *    golden-hour colour and the raking shading that make the hour worth having.
 *  - Below SHADOW_FADE_ELEVATION the shadows fade out entirely (three's
 *    `shadow.intensity`), so the last of the mismatch between a clamped shadow and a
 *    horizon sun disappears into dusk instead of standing out in it.
 */
const SHADOW_MIN_ELEVATION = 0.26;
const SHADOW_FADE_ELEVATION = 0.12;


/** Deliberate presentation scale: physical lunar disc is too small in play. */
const MOON_VISUAL_SCALE = 3;
/**
 * Display-referred radiance of sunlit lunar regolith, day and night, in the same
 * authored units as the palette below.
 *
 * Sunlit regolith does not change brightness with phase — the shader's photometric
 * function carries every angle-dependent term per pixel — so the only thing these
 * two numbers encode is EXPOSURE, and the dome has none of its own. Three disables
 * tone mapping for anything drawn into a render target, and renderer.ts always
 * draws the scene into one, so `col` in the dome shader reaches the display
 * verbatim and clamps at 1. That is the same reason the palette carries a night
 * sky a thousand times darker than its day sky rather than one exposure stop:
 * adaptation is authored in, not computed. The Moon has to be authored the same
 * way, and the two ends are set by what the display can still show:
 *
 *  - day: a daylight sky is already at 0.75 in blue, so the disc has about 0.65 of
 *    headroom before it flattens into a white hole. At this value the crescent's
 *    bright limb saturates blue only, which is exactly what makes it read white
 *    against blue while red and green keep the maria and the terminator gradient.
 *  - night: the full disc's highlands land just under 1, so a full Moon is white
 *    and dazzling while the maria stay a clear half-tone below it.
 */
const MOON_RADIANCE_DAY = 0.75;
const MOON_RADIANCE_NIGHT = 1.15;
/** The Sun stays proportionally correct in astronomy but reads better 1.5x in play. */
const SUN_VISUAL_SCALE = 1.5;
/** Matches renderer.ts's starting density; the gradient's haze multiplies it. */
const BASE_FOG_DENSITY = 0.00035;

/**
 * Total display-referred light the key and the sky bounce are exposed to between
 * them. The two lights below are written as their share of the real illuminance
 * times this exposure, so under full adaptation they always sum to it and only
 * their SPLIT — and the palette they are tinted with — carries the time of day.
 */
export const EXPOSURE_TARGET = 5;
/**
 * How dark the eye stops following, expressed as the illuminance it stops
 * dividing by. Below this the exposure levels off instead of climbing, so the
 * scene finally starts to go dark rather than staying at EXPOSURE_TARGET forever.
 *
 * It is ADDED to the illuminance rather than imposed as a clamp on the exposure,
 * and that is the whole point. A clamp is a corner: above it the scene is pinned
 * at full brightness, below it brightness tracks illuminance one for one, and the
 * hand-over is a slope that goes from flat to a 20%-a-second fall in the width of
 * one frame. Adding a floor to the denominator gives the same limit — the maximum
 * exposure is still EXPOSURE_TARGET / ADAPTATION_FLOOR, which is what the star
 * field's brightness is calibrated against — with no corner anywhere on the curve.
 */
export const ADAPTATION_FLOOR = EXPOSURE_TARGET / 25_000;


// ---------------------------------------------------------------------------
// Palette (authored as sRGB hex; THREE converts to linear working space)
// ---------------------------------------------------------------------------

const C_DAY_ZENITH = new THREE.Color().setStyle('#4d8ede');
/**
 * The pale band the daytime sky fades to at the horizon, and — because `fog.color`
 * copies it — the colour the far desert dissolves into.
 *
 * Taken off a reference screenshot of the genre's own noon sky, where the horizon band
 * is very nearly white with a cyan bias and the saturated blue stays up high. It was
 * `#d7e5f3`: the same idea a shade duller and greener. The reference reads cleaner
 * because there is more cyan in it and it is brighter.
 */
const C_DAY_HORIZON = new THREE.Color().setStyle('#d5eefd');
const C_NIGHT_ZENITH = new THREE.Color().setStyle('#03040a');
const C_NIGHT_HORIZON = new THREE.Color().setStyle('#0d1424');
const C_SUN_LOW = new THREE.Color().setStyle('#ffb166');
const C_SUN_HIGH = new THREE.Color().setStyle('#fff7ec');
const C_TURBID = new THREE.Color().setStyle('#c9b18c');
const C_MOON = new THREE.Color().setStyle('#a9c6e6');
const C_GROUND = new THREE.Color().setStyle('#d8a45c'); // warm ochre sand bounce
const C_NIGHT_GROUND = new THREE.Color().setStyle('#0a0c14');

// ---------------------------------------------------------------------------
// Twilight moods
// ---------------------------------------------------------------------------

/**
 * Five dawn/dusk palettes, one picked per twilight.
 *
 * The old sky had exactly one sunset — C_SUNSET, a single orange — so every morning
 * and every evening of a 900 km drive were the same two minutes of colour. Real
 * twilights differ because the air differs: how much water is in it, how high the
 * dust is, whether there is cloud aloft catching light the horizon has already lost.
 * None of that is simulated here, so it is authored: five plausible skies, chosen
 * deterministically per event, blended so nothing ever pops.
 *
 * Each mood owns four things, and all four matter — swapping only the horizon colour
 * reads as a filter rather than as a different evening:
 *
 *  - `horizon`: the band the sun sets into, and (via `fog.color`) the colour the far
 *    desert dissolves into. The dominant impression.
 *  - `glow` and `glowScale`: the halo around the disc. A humid sky throws a wide soft
 *    glow; cold clean air barely glows at all.
 *  - `zenith` and `zenithWeight`: how far up the twilight reaches. This is what makes
 *    'rose' feel like a different SKY rather than a different sunset, because the
 *    colour is overhead as well as on the horizon.
 *  - `widthScale`: how long the whole thing lasts, as a multiplier on the elevation
 *    window. Dust already widens twilight; this lets a mood be brief and sharp or
 *    drawn out.
 *
 * The progression gradient still multiplies all of it: km 900's dust reddens and
 * lengthens whichever mood came up, so late-run twilights are recognisably late-run
 * whatever the roll.
 */
interface TwilightMood {
  readonly label: string;
  readonly horizon: THREE.Color;
  readonly glow: THREE.Color;
  readonly glowScale: number;
  readonly zenith: THREE.Color;
  readonly zenithWeight: number;
  readonly widthScale: number;
}

const TWILIGHT_MOODS: readonly TwilightMood[] = [
  {
    // The desert default: dust-fired orange-red, hard and brief. This is the sky the
    // game had, kept as one of five so nothing familiar is lost.
    label: 'ember',
    horizon: new THREE.Color().setStyle('#ff6a38'),
    glow: new THREE.Color().setStyle('#ff6a38'),
    glowScale: 1,
    zenith: new THREE.Color().setStyle('#3f5f9c'),
    zenithWeight: 0.12,
    widthScale: 1,
  },
  {
    // Clean, humid air: a soft peach horizon under a lilac sky, no hard edge
    // anywhere. The glow is wide and weak because the light is scattered, not fired.
    label: 'peach',
    horizon: new THREE.Color().setStyle('#ffb48a'),
    glow: new THREE.Color().setStyle('#ffd0a8'),
    glowScale: 0.72,
    zenith: new THREE.Color().setStyle('#8f7fb8'),
    zenithWeight: 0.3,
    widthScale: 1.25,
  },
  {
    // A hot, hazy day burning out: brassy gold on the horizon, the glow doing most
    // of the work, and a long slow fade because the haze holds the light.
    label: 'gold',
    horizon: new THREE.Color().setStyle('#ffb02e'),
    glow: new THREE.Color().setStyle('#ffcf5e'),
    glowScale: 1.35,
    zenith: new THREE.Color().setStyle('#5a6f9e'),
    zenithWeight: 0.16,
    widthScale: 1.4,
  },
  {
    // High cloud catching light the ground has lost: magenta-rose low down, violet
    // well overhead. The one mood that colours the whole dome.
    label: 'rose',
    horizon: new THREE.Color().setStyle('#f0577f'),
    glow: new THREE.Color().setStyle('#ff7ea0'),
    glowScale: 0.9,
    zenith: new THREE.Color().setStyle('#6a4d97'),
    zenithWeight: 0.42,
    widthScale: 1.1,
  },
  {
    // Cold clean morning: almost no colour at all, a thin copper line on a grey-blue
    // sky. Rare-feeling because it is the one that refuses to perform.
    label: 'ash',
    horizon: new THREE.Color().setStyle('#b98a6d'),
    glow: new THREE.Color().setStyle('#e0a882'),
    glowScale: 0.45,
    zenith: new THREE.Color().setStyle('#44577a'),
    zenithWeight: 0.2,
    widthScale: 0.78,
  },
];

/** Fixed seed for deterministic per-twilight palette selection. */
const MOOD_SEED = 0x5eed10ad;

/**
 * Fraction of a half-day over which one mood hands over to the next.
 *
 * Handover happens at noon and at midnight — the two moments the twilight weight is
 * exactly zero — so this window only exists to keep the sun's own glow colour from
 * stepping at midday, where it still carries 0.22 of intensity. A quarter of a
 * half-day is hours of game time for a colour nobody can point at.
 */
const MOOD_BLEND = 0.25;

/**
 * Raw mood roll for one twilight event. `event` counts half-days: even is the
 * morning of `event/2`, odd is that evening.
 */
function moodRoll(event: number): number {
  return Math.min(
    TWILIGHT_MOODS.length - 1,
    Math.floor(hash01(MOOD_SEED, event, 0x11) * TWILIGHT_MOODS.length),
  );
}

/**
 * Mood for one twilight event, with immediate repeats pushed off.
 *
 * A raw 1-in-5 roll repeats about a fifth of the time, and two identical skies in a
 * row is exactly the complaint this exists to answer — it reads as "the sky never
 * changes" even when it does. Comparing against the previous event's RAW roll keeps
 * this a pure function of the event number (no recursion, no stored history); a
 * repeat can still slip through when the previous event was itself pushed off, which
 * is rare enough to be texture rather than a pattern.
 */
function moodFor(event: number): TwilightMood {
  const roll = moodRoll(event);
  if (roll !== moodRoll(event - 1)) return TWILIGHT_MOODS[roll]!;
  const step = 1 + Math.floor(hash01(MOOD_SEED, event, 0x12) * (TWILIGHT_MOODS.length - 1));
  return TWILIGHT_MOODS[(roll + step) % TWILIGHT_MOODS.length]!;
}

// ---------------------------------------------------------------------------
// Shaders
// ---------------------------------------------------------------------------

const SKY_VERTEX = /* glsl */ `
varying vec3 vDir;

void main() {
  // The dome is centred on the camera, so local position is the world offset
  // from the camera: normalising it gives the view ray direction directly.
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SKY_FRAGMENT = /* glsl */ `
uniform float uSunAngularRadius;
uniform float uMoonAngularRadius;
/** Radiance of sunlit lunar regolith, in the dome's own display-referred units. */
uniform float uMoonRadiance;
uniform sampler2D uMoonTexture;
uniform vec3 uSunDir;
uniform vec3 uMoonDir;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uSunColor;
uniform vec3 uSunGlowColor;
uniform float uSunGlowIntensity;
uniform float uMoonAmount;
/**
 * How strongly the sky away from the sun is pulled down, 0..1. Peaks when the sun
 * is near the horizon and is zero at midday and through the night.
 */
uniform float uAntiSolar;
/** Fraction of the sky the cirrus deck covers, 0..1. */
uniform float uCloudCover;
/** Overall visibility of the deck: 1 in daylight, 0 in deep night. */
uniform float uCloudAmount;
/** Seconds, wrapped. Drifts the deck downwind. */
uniform float uCloudTime;

varying vec3 vDir;

/**
 * CIRRUS, procedurally, inside the dome fragment.
 *
 * No geometry and no draw call, which buys three things beyond the cost. It cannot be
 * outlined: the ink pass works on object edges, and a cloud shaded into the dome's own
 * fragment has none, where a billboard layer would have come back ringed in ink. It
 * cannot break the fog seam, because the deck is faded out before it reaches the
 * horizon band that the fog colour is copied from. And it is in the environment probe
 * for free, since the probe shares this shader — so an overcast sky genuinely lights
 * the car slightly differently.
 *
 * What it cannot do: occlude stars. The dome writes no depth and the star field is
 * separate geometry, so a night cloud would have stars shining through it. Rather than
 * fake that, uCloudAmount fades the deck out as night falls — which is close to
 * honest anyway, since unlit cirrus over a desert is not visible.
 */
float cloudHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float cloudNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(cloudHash(i), cloudHash(i + vec2(1.0, 0.0)), u.x),
    mix(cloudHash(i + vec2(0.0, 1.0)), cloudHash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

/** Four octaves. Enough for a fibrous edge; a fifth is invisible at this scale. */
float cloudFbm(vec2 p) {
  float sum = 0.0;
  float amp = 0.5;
  for (int k = 0; k < 4; k++) {
    sum += amp * cloudNoise(p);
    p *= 2.03;
    amp *= 0.5;
  }
  return sum;
}

/** Disc-plane coordinates in a world-up tangent basis, stable as the camera moves. */
vec2 moonTextureUv(vec3 offset) {
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), uMoonDir) + vec3(0.00001, 0.0, 0.0));
  vec3 up = cross(uMoonDir, right);
  return vec2(dot(offset, right), dot(offset, up));
}


/**
 * McEwen's lunar-Lambert photometric function.
 *
 * Regolith is not Lambertian, and that difference is most of what makes a Moon
 * look like the Moon. It is a porous, strongly backscattering powder: a full Moon
 * reads as a flat, evenly lit disc rather than a shaded ball, and a crescent keeps
 * bright horns that taper to points.
 *
 * mu0 = cos(incidence), mu = cos(emission). The Lommel-Seeliger ratio
 * mu0/(mu0 + mu) is what saves the horns: they lie against the limb, where mu -> 0,
 * so the ratio stays near one however grazing the sunlight is there. A plain
 * Lambert cos() fades them out instead and leaves a bright cap around the sub-solar
 * limb — a parachute canopy, not a crescent. McEwen's weight l runs between the
 * two: one at zero phase, falling as the phase angle opens, which is what gives a
 * crescent's terminator its gradual fade into shadow.
 */
float lunarLambert(float mu0, float mu, float phaseAngle) {
  // exp(-g / 60deg) tracks McEwen (1991) to within 0.05 across 0..90 degrees
  // (0.607 vs 0.608 at 30, 0.223 vs 0.186 at 90) and, unlike his cubic fit, stays
  // positive beyond 100 degrees — which is where every daylight crescent lives.
  float l = exp(-phaseAngle * 0.9549);
  return 2.0 * l * mu0 / max(mu0 + mu, 0.0001) + (1.0 - l) * mu0;
}

void main() {
  vec3 dir = normalize(vDir);
  float h = clamp(dir.y, 0.0, 1.0);

  // Zenith-to-horizon gradient; the pow keeps most of the blue band high.
  vec3 col = mix(uHorizon, uZenith, pow(h, 0.62));

  float sd = dot(dir, uSunDir);

  // Anti-solar darkening.
  //
  // The gradient above is a function of ELEVATION only, so without this the horizon
  // is equally bright all the way around the compass and turning your back on a
  // sunset looks the same as facing it. The sun's own terms below cannot fix that:
  // they are additive and clamped to the solar hemisphere by max(sd, 0.0), so they
  // brighten one side and never darken the other.
  //
  // What is missing is that a sunset's glow is scattered light from a low sun, and
  // the sky opposite has none of it — it is already night down there, which is why
  // the anti-twilight arch is a deep blue-grey. So the far horizon is mixed toward
  // the ZENITH colour (already the darker, cooler end of this time of day's
  // palette) rather than being multiplied down, which would leave a muddy brown
  // instead of a cold one.
  //
  //  - "away" is 0 at the sun and 1 at the anti-solar point; squaring it keeps the
  //    transition broad and centred behind you rather than a visible edge.
  //  - "lowBand" confines the effect to the horizon, so the zenith is untouched
  //    and the two hemispheres still meet seamlessly overhead.
  //  - uAntiSolar switches the whole thing off away from dawn and dusk.
  // pow 1.5 rather than a square: the darkening reaches further round toward the
  // sides, so the transition is a slow wash across the whole back half of the sky
  // instead of a patch centred behind you.
  float away = pow(max(-sd, 0.0), 1.5);
  float lowBand = 1.0 - smoothstep(0.0, 0.45, h);
  col = mix(col, uZenith * 0.55, uAntiSolar * away * lowBand);

  // --- Cirrus deck -----------------------------------------------------------
  //
  // The view ray is intersected with a flat plane at unit height: dir.xz / dir.y is
  // the standard cloud-plane parameterisation, and it is what gives the deck
  // perspective for nothing. Wisps overhead are broad and round; the same wisps
  // toward the horizon compress into long streaks, which is exactly how a high deck
  // looks and is the whole reason not to just paint noise on the dome directly.
  //
  // dir.y is floored because the projection diverges at the horizon: the uv goes to
  // infinity, the noise goes to hash grain, and the result is a shimmering band. The
  // floor bounds the frequency and the fade below hides where it bites.
  float deckY = max(dir.y, 0.06);
  vec2 cuv = dir.xz / deckY;

  // Near-isotropic scale before the noise. The old 0.55 / 2.1 squash dragged every
  // feature along the other axis into combed filaments; the small difference kept
  // here is only enough to stop the deck reading as a tiled repeat. The drift is
  // slow and on x, so the deck still slides sideways like a high wind deck should.
  vec2 combed = cuv * vec2(0.75, 0.9) + vec2(uCloudTime * 0.0035, 0.0);
  float n = cloudFbm(combed);

  // Multiply by a second sample at half the frequency instead of domain-warping.
  // The old warp smeared the weave into filaments; a coarse factor that drops low
  // punches real holes and, where it stays high, lets the fine noise through, so
  // the deck breaks into isolated rounded puffs with clear sky between them.
  n *= cloudFbm(combed * 0.5);

  // Cover is a threshold on the noise, so raising it does not fade cloud in
  // everywhere at once — it grows the patches outward from where cloud already is,
  // which is how a sky actually fills in. The multiply above cuts the field's
  // values to about 0.4 of their former size, so the band is re-scaled by that same
  // 0.4 and narrowed so the deck reads as separate spots rather than one soft veil.
  float edge = 1.0 - uCloudCover;
  float deck = smoothstep(edge * 0.4, edge * 0.4 + 0.20, n);

  // Out before the horizon band, which must stay pure gradient: the fog colour is
  // copied from it, and a cloud reaching down into it would put a hard line along
  // the join where the far desert dissolves into the sky.
  deck *= smoothstep(0.02, 0.22, dir.y);
  deck *= uCloudAmount;

  // Cirrus is ice: bright, and it takes its colour from the sun rather than owning
  // one. Toward the sun it is lit through and nearly white; away from it, it settles
  // to the pale horizon tone. That single term is also what makes the deck catch a
  // low sun and go gold at dusk, with no second palette to author or keep in step.
  float lit = 0.45 + 0.55 * max(sd, 0.0);
  vec3 cloudCol = mix(uHorizon, uSunColor, lit * 0.55);
  col = mix(col, cloudCol, deck);

  // Disc edges are one-pixel derivative transitions. The old fixed dot-product
  // width was wider than the Moon itself and mixed its dark limb into nearby sky.
  float sunEdge = cos(uSunAngularRadius);
  float sunAa = max(fwidth(sd) * 0.5, 0.0000001);
  float disc = smoothstep(sunEdge - sunAa, sunEdge + sunAa, sd);
  float glow = pow(max(sd, 0.0), 6.0) * 0.45 + pow(max(sd, 0.0), 48.0) * 1.5;
  col += uSunColor * disc * 2.0;
  col += uSunGlowColor * glow * uSunGlowIntensity;

  // --- Moon ------------------------------------------------------------------
  //
  // Composited ADDITIVELY, which is the whole reason the daytime Moon works. The
  // Moon sits beyond the atmosphere, so what reaches the eye is lunar radiance
  // PLUS the airlight of the entire column in front of it — and that airlight is
  // the sky colour already in col. Mixing toward a "moon colour" instead claims
  // the disc REPLACES the sky, and against a bright sky that can only produce a
  // grey stone darker than its surroundings. Three things the blend had to author,
  // and got wrong, then fall out of the physics for nothing:
  //
  //  - the disc can only ever be brighter than the sky around it, never grey;
  //  - the unlit side is exactly sky, so it vanishes in daylight and returns as
  //    earthshine at night, with no day/night presence term to tune;
  //  - the daylight pedestal compresses the maria's contrast by itself, so the
  //    rock needs one albedo rather than a night palette and a day palette.
  float md = dot(dir, uMoonDir);
  float moonEdge = cos(uMoonAngularRadius);
  float moonAa = max(fwidth(md) * 0.5, 0.0000001);
  float mdisc = smoothstep(moonEdge - moonAa, moonEdge + moonAa, md);

  // Disc-plane offset in lunar radii, then the near-side sphere point under it.
  vec3 moonOffset = (dir - uMoonDir * md) / max(sin(uMoonAngularRadius), 0.0001);
  // cos(emission): one at disc centre, zero at the limb. It falls as a square
  // root, so one pixel inside the limb of a binocular-sized disc it is already
  // about 0.4 — that is how far into a crescent the limb term reaches.
  float mu = sqrt(max(0.0, 1.0 - dot(moonOffset, moonOffset)));
  // Near-side normal, unit length by construction: -uMoonDir at disc centre.
  vec3 moonNormal = moonOffset - uMoonDir * mu;
  float mu0 = max(dot(moonNormal, uSunDir), 0.0);
  // Phase angle at the Moon. The Sun is far enough away that the elongation
  // measured here at the eye is its supplement to within a tenth of a degree.
  float cosPhase = -dot(uSunDir, uMoonDir);
  float sunlit = lunarLambert(mu0, mu, acos(clamp(cosPhase, -1.0, 1.0)));
  // No terminator feather. Brightness reaches the terminator as a linear ramp in
  // mu0, which is both the honest fade and already antialiased; the fixed 0.03
  // smoothstep it replaces was wider than a thin crescent is, and smeared one into
  // a blob several times its true size.

  // Earthshine, the ashen light on the unlit side. The Earth's phase as seen from
  // the Moon is the complement of the Moon's own, so this peaks exactly when the
  // crescent is thinnest — which is when the ashen light really is visible.
  // Centre-weighted, the Earth being behind the eye. It needs no daylight
  // cut-off: at this level the additive composite loses it against a lit sky.
  float earthshine = (0.5 - 0.5 * cosPhase) * 0.015 * (0.35 + mu * 0.65);

  // Orthographic inverse onto the equirectangular map; the near hemisphere spans
  // half of it, so u stays inside 0.25..0.75. Longitude compresses without bound
  // toward the limb, which is what the texture's anisotropic filtering is for —
  // isotropic mipmapping answers that footprint by averaging latitude as well and
  // hands back the mean grey of the whole map, right where the crescent lives.
  vec2 moonPlane = moonTextureUv(moonOffset);
  vec2 moonMapUv = vec2(
    0.5 + atan(moonPlane.x, mu) / 6.28318530718,
    0.5 + asin(clamp(moonPlane.y, -1.0, 1.0)) / 3.14159265359
  );
  // The map is a near-neutral grey photograph, but regolith is not neutral: the
  // Moon's B-V is about 0.27 magnitudes redder than sunlight, roughly a quarter
  // less blue for the same green. Restoring that is what turns the ivory of a high
  // full Moon back on — and, in daylight, it is the only thing that can, because
  // an additive disc inherits the sky's blue pedestal and a neutral albedo can
  // only ever land somewhere on the blue side of white.
  vec3 lunarAlbedo = texture2D(uMoonTexture, moonMapUv).rgb * vec3(1.10, 1.0, 0.84);
  col += lunarAlbedo * (sunlit + earthshine) * uMoonRadiance * mdisc * uMoonAmount;


  gl_FragColor = vec4(col, 1.0);

  // The correct terminator for a dome drawn straight to the canvas, and kept for
  // that reason — but INERT on the path renderer.ts actually uses. Three compiles
  // tone mapping out of anything drawn into a render target, and the colour-space
  // conversion is the identity into a linear one, so the colour above reaches the
  // display verbatim and clamps at 1. That is why this whole shader, palette and
  // Moon alike, is authored display-referred rather than in radiance.
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/**
 * Linear-radiance twin of SKY_FRAGMENT, used only for the environment probe.
 *
 * The visible dome ends with `tonemapping_fragment` + `colorspace_fragment` so it
 * matches the scene's ACES + sRGB output exactly. An environment map must carry
 * *linear radiance* instead: feeding it display-referred sRGB would tonemap the
 * sky once into the probe and again when the reflection is shaded, which reads as
 * washed-out, low-contrast chrome. Derived by deleting those two includes from
 * the one source above, so the gradient, sun disc and glow can never drift apart.
 */
const SKY_FRAGMENT_LINEAR = SKY_FRAGMENT
  .replace('#include <tonemapping_fragment>', '')
  .replace('#include <colorspace_fragment>', '');

/**
 * Sun-elevation change, radians, that makes an environment refresh due during
 * ordinary daylight. The probe is deliberately cheaper to update there because
 * its changes are hard to notice against a bright, stable scene.
 */
const ENV_BAKE_STEP = 0.03;
/**
 * Twilight probe cadence. The visible dome is continuous, but reflections and
 * diffuse environment lighting use the last PMREM bake. A tighter threshold and
 * cadence keep the baked probe within a barely visible radiance delta while the
 * sun crosses the horizon.
 */
const ENV_TWILIGHT_BAKE_STEP = 0.002;
/** Minimum time between completed PMREM bakes. */
const ENV_BAKE_INTERVAL_MS = 350;


// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}


// ---------------------------------------------------------------------------
// Sky
// ---------------------------------------------------------------------------

export class Sky {
  private readonly scene: THREE.Scene;
  private readonly fog: THREE.FogExp2;

  /** Camera-centred dome, real catalogue stars and unresolved planets. */
  private readonly root = new THREE.Group();

  private readonly dome: THREE.Mesh;
  private readonly starField: StarField;

  private readonly planetField = new PlanetField();
  private readonly sunLight: THREE.DirectionalLight;
  private readonly hemiLight: THREE.HemisphereLight;
  /** Solar System Scope lunar map, CC BY 4.0; attribution is in LICENSE. */
  private readonly moonTexture: THREE.Texture;
  private readonly astronomy = new AstronomySystem();
  private exposure = 1;

  // --- Environment probe: what makes metal read as metal (see refreshEnvironment) ---
  private readonly pmrem: THREE.PMREMGenerator;
  private readonly envScene = new THREE.Scene();
  /** Holds one dome, sharing the visible dome's uniforms, shaded in linear space. */
  private readonly envMaterial: THREE.ShaderMaterial;
  private envTarget: THREE.WebGLRenderTarget | null = null;
  /** Sun elevation the live probe was baked at. NaN marks the initial bake. */
  private envBakedElevation = Number.NaN;
  /** A crossed elevation threshold waits here until an idle frame can bake it. */
  private envBakePending = true;
  /** Time of the last completed bake, used only after the initial bake. */
  private envLastBakeMs = Number.NEGATIVE_INFINITY;
  private environmentSize = 128;

  /** True only for the update that successfully replaced the environment target. */
  private didBakeEnvironment = false;

  // --- Dome shader uniforms (typed references; mutated in place each frame) ---
  private readonly uSunDir = new THREE.Vector3(0, 1, 0);
  private readonly uMoonDir = new THREE.Vector3(0, -1, 0);
  private readonly uZenith = new THREE.Color();
  private readonly uHorizon = new THREE.Color();
  private readonly uSunColor = new THREE.Color();
  private readonly uSunGlowColor = new THREE.Color();
  private readonly uSunGlowIntensity = { value: 0 };
  private readonly uMoonAmount = { value: 0 };
  private readonly uSunAngularRadius = { value: 0.00465 };
  private readonly uMoonAngularRadius = { value: 0.0045 };
  private readonly uMoonRadiance = { value: MOON_RADIANCE_DAY };
  /**
   * Anti-solar darkening weight. Peaks with the sun on the horizon and falls to
   * zero both at midday (when the sky genuinely is even all round) and once night
   * has fallen (when there is no glow left to be asymmetric about).
   */
  private readonly uAntiSolar = { value: 0 };
  /** Fraction of sky the cirrus deck covers; straight from the sky gradient. */
  private readonly uCloudCover = { value: 0 };
  /**
   * Overall deck visibility. Falls to zero as night lands, because the dome cannot
   * depth-test against the star field and so cannot occlude a star — see the note in
   * SKY_FRAGMENT.
   */
  private readonly uCloudAmount = { value: 0 };
  /** Deck drift clock, seconds, wrapped well inside float precision. */
  private readonly uCloudTime = { value: 0 };


  // --- Scratch state, reused every frame (no allocation in the hot path) ---
  private readonly _sunDir = new THREE.Vector3();
  private readonly _lightDir = new THREE.Vector3();
  /** Light direction with its elevation clamped, for the shadow camera only. */
  private readonly _shadowDir = new THREE.Vector3();
  private readonly _targetPos = new THREE.Vector3();
  private readonly _zenith = new THREE.Color();
  private readonly _horizon = new THREE.Color();
  private readonly _sunColor = new THREE.Color();
  private readonly _sunGlow = new THREE.Color();
  /** This twilight's mood, already blended out of the neighbouring two. */
  private readonly _moodHorizon = new THREE.Color();
  private readonly _moodGlow = new THREE.Color();
  private readonly _moodZenith = new THREE.Color();
  private readonly _lightColor = new THREE.Color();
  private readonly _hemiSky = new THREE.Color();
  private readonly _hemiGround = new THREE.Color();

  private sunElevation = -1.0; // radians; starts below the horizon (night)

  constructor(
    scene: THREE.Scene,
    fog: THREE.FogExp2,
    webgl: THREE.WebGLRenderer,
    starField: StarField,
  ) {
    this.moonTexture = new THREE.TextureLoader().load('/data/moon.jpg');
    // Raw sampling: the map is a display-referred photograph of the Moon, and its
    // sRGB numbers used directly as reflectance land close to the contrast the eye
    // reports. The true linear albedo map is a far harsher 4:1 maria-to-highland
    // step than anyone has ever seen looking up.
    this.moonTexture.colorSpace = THREE.NoColorSpace;
    this.moonTexture.wrapS = THREE.RepeatWrapping;
    this.moonTexture.minFilter = THREE.LinearMipmapLinearFilter;
    this.moonTexture.magFilter = THREE.LinearFilter;
    // The disc's orthographic-to-equirectangular mapping compresses lunar
    // longitude without bound toward the limb, which is precisely where a crescent
    // lives. Isotropic mipmapping answers that footprint by averaging latitude
    // along with it and returns the mean grey of the whole map; anisotropic
    // filtering averages only the axis that is actually compressed, so the maria
    // survive into the horns.
    this.moonTexture.anisotropy = webgl.capabilities.getMaxAnisotropy();
    this.scene = scene;
    this.fog = fog;
    this.pmrem = new THREE.PMREMGenerator(webgl);

    // --- Sky dome ---
    const domeGeometry = new THREE.SphereGeometry(DOME_RADIUS, 48, 24);
    const domeMaterial = new THREE.ShaderMaterial({
      vertexShader: SKY_VERTEX,
      fragmentShader: SKY_FRAGMENT,
      uniforms: {
        uSunDir: { value: this.uSunDir },
        uMoonDir: { value: this.uMoonDir },
        uZenith: { value: this.uZenith },
        uHorizon: { value: this.uHorizon },
        uSunColor: { value: this.uSunColor },
        uSunGlowColor: { value: this.uSunGlowColor },
        uSunGlowIntensity: this.uSunGlowIntensity,
        uMoonTexture: { value: this.moonTexture },
        uMoonAmount: this.uMoonAmount,
        uSunAngularRadius: this.uSunAngularRadius,
        uMoonAngularRadius: this.uMoonAngularRadius,
        uMoonRadiance: this.uMoonRadiance,
        uAntiSolar: this.uAntiSolar,
        uCloudCover: this.uCloudCover,
        uCloudAmount: this.uCloudAmount,
        uCloudTime: this.uCloudTime,
      },
      side: THREE.BackSide,
      // The sky is the backdrop: draw first, never write depth, never test it,
      // so opaque geometry simply paints over it.
      depthWrite: false,
      depthTest: false,
    });
    this.dome = new THREE.Mesh(domeGeometry, domeMaterial);
    this.dome.renderOrder = -10;
    this.dome.frustumCulled = false;
    this.root.add(this.dome);

    // --- Environment probe dome: same geometry and uniform objects as the
    // visible dome, so the probe tracks the time of day for free. Only the
    // fragment shader differs (linear radiance, see SKY_FRAGMENT_LINEAR).
    this.envMaterial = new THREE.ShaderMaterial({
      vertexShader: SKY_VERTEX,
      fragmentShader: SKY_FRAGMENT_LINEAR,
      uniforms: domeMaterial.uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
    });
    const envDome = new THREE.Mesh(domeGeometry, this.envMaterial);
    envDome.frustumCulled = false;
    this.envScene.add(envDome);

    // --- Real Tycho-2 star field ---
    this.starField = starField;
    this.root.add(starField.points);
    this.root.add(this.planetField.points);

    // --- Sun / moon directional light ---
    this.sunLight = new THREE.DirectionalLight(0xffffff, 3.0);
    this.sunLight.castShadow = true;
    const shadow = this.sunLight.shadow;
    // 1024 on iGPU-class hardware: the 180 m frustum still resolves ~17 cm/texel,
    // and the renderer's PCF filter softens the larger texels into a stylised
    // blur. 2048 doubles the depth-pass fill cost for detail that never reads at
    // this camera scale.
    shadow.mapSize.set(1024, 1024);
    shadow.camera.near = 40;
    shadow.camera.far = SUN_DISTANCE + 300;
    shadow.camera.left = -90;
    shadow.camera.right = 90;
    shadow.camera.top = 90;
    shadow.camera.bottom = -90;
    // BIAS IS MEASURED IN METRES ALONG THE LIGHT RAY, and `shadow.bias` is a
    // fraction of the camera's depth range: over `near`..`far` (500 m) the old
    // -0.0004 was 20 cm, and `normalBias` added 5 cm more with the sun overhead.
    //
    // Twenty-five centimetres is a CAR'S GROUND CLEARANCE. Three renders the back
    // faces of a caster into the depth map (`shadowSide`, and see the note in
    // render/proceduralcars.ts), so the depth stored under a car is its UNDERBODY,
    // and the sand under it sits 0.11-0.29 m further from the light depending on the
    // model. The bias therefore declared most of that sand lit: the car's contact
    // shadow was eaten away wherever the dune relief closed the gap, and the surviving
    // patches followed the desert tile's 3 m lattice — the diagonally striped, torn
    // shadow, worst with the sun high and gone by dusk (the gap the bias has to beat
    // is the clearance divided by sin(elevation)).
    //
    // 2 cm + 2 cm is all a CLOSED caster needs: its far face is metres behind its
    // lit face, so the comparison has nothing to resolve but float noise, and the
    // shadow-coordinate interpolation is exact for an orthographic light across a
    // planar triangle. Nothing that receives this map casts into it from an open
    // sheet, which is the one case that would want the old slack.
    shadow.bias = -0.00004;
    shadow.normalBias = 0.02;
    shadow.camera.updateProjectionMatrix();
    scene.add(this.sunLight);
    // The target must be in the scene graph for its matrixWorld to update.
    scene.add(this.sunLight.target);

    // --- Hemisphere bounce ---
    this.hemiLight = new THREE.HemisphereLight(0x88b4e6, 0xd8a45c, 1.0);
    scene.add(this.hemiLight);

    scene.add(this.root);
  }


  update(
    calendarEpoch: string,
    timeOfDay: number,
    dayIndex: number,
    s: number,
    cameraX: number,
    cameraY: number,
    cameraZ: number,
    allowEnvironmentRefresh = true,
  ): void {
    this.didBakeEnvironment = false;
    const g = skyGradientAt(s);
    const celestial = this.astronomy.update(calendarEpoch, dayIndex, timeOfDay);
    this._sunDir.copy(celestial.sun.direction);
    this.sunElevation = THREE.MathUtils.degToRad(celestial.sun.altitudeDeg);

    const dayFrac = (((timeOfDay % DAY_LENGTH) + DAY_LENGTH) % DAY_LENGTH) / DAY_LENGTH;

    // --- Twilight mood ---
    // Half-day events: even is this day's morning, odd is its evening. The boundary
    // between them is noon (and midnight), which is exactly where `sunset` below is
    // zero — so a mood only ever changes hands while none of it is being shown.
    const event = dayIndex * 2 + (dayFrac < 0.5 ? 0 : 1);
    const eventT = dayFrac < 0.5 ? dayFrac * 2 : (dayFrac - 0.5) * 2;
    const moodBlend = smoothstep(0, MOOD_BLEND, eventT);
    const prevMood = moodFor(event - 1);
    const mood = moodFor(event);
    this._moodHorizon.copy(prevMood.horizon).lerp(mood.horizon, moodBlend);
    this._moodGlow.copy(prevMood.glow).lerp(mood.glow, moodBlend);
    this._moodZenith.copy(prevMood.zenith).lerp(mood.zenith, moodBlend);
    const moodGlowScale =
      prevMood.glowScale + (mood.glowScale - prevMood.glowScale) * moodBlend;
    const moodZenithWeight =
      prevMood.zenithWeight + (mood.zenithWeight - prevMood.zenithWeight) * moodBlend;
    const moodWidthScale =
      prevMood.widthScale + (mood.widthScale - prevMood.widthScale) * moodBlend;

    // Day/night factors.
    const day = smoothstep(-0.12, 0.3, this.sunElevation);
    const night = smoothstep(0.02, -0.4, this.sunElevation);
    // 1 while the sun is near the horizon, widening with dust (longer sunsets) and
    // with the mood: some evenings are brief and hard, others hold on for an hour.
    const sunset =
      1 -
      smoothstep(0.02, (0.4 + 0.55 * g.dust) * moodWidthScale, Math.abs(this.sunElevation));

    // --- Sky colours ---
    // Zenith: day blue, nudged away from familiar blue by skyHueShift, fading to
    // night navy, then pulled toward the mood's own upper colour while the sun is
    // near the horizon. That last term is what makes a mood a SKY rather than a
    // filter on the horizon line.
    this._zenith.copy(C_DAY_ZENITH)
      .offsetHSL(g.skyHueShift * 0.5, 0.02, 0.0)
      .lerp(C_NIGHT_ZENITH, night)
      .lerp(this._moodZenith, sunset * moodZenithWeight);

    // Horizon: day/night base, this twilight's own band (reddened by dust), then a
    // dust-driven turbid tan so the horizon mutes as the air thickens.
    this._horizon.copy(C_DAY_HORIZON).lerp(C_NIGHT_HORIZON, night);
    this._horizon.lerp(this._moodHorizon, sunset * (0.45 + 0.55 * g.dust));
    this._horizon.lerp(C_TURBID, g.dust * 0.35 * day);

    // Sun disc: warm at low angle, white overhead.
    this._sunColor.copy(C_SUN_LOW).lerp(C_SUN_HIGH, smoothstep(0.0, 0.55, this.sunElevation));
    // Twilight owns the halo colour only near the horizon. A high Sun blooms
    // toward its own warm-white disc instead of carrying a sunset mood overhead.
    this._sunGlow.copy(this._sunColor).lerp(this._moodGlow, sunset);
    const authoredSunGlow =
      sunset * (0.9 + 1.6 * g.dust) * moodGlowScale +
      smoothstep(0.0, 0.6, this.sunElevation) * 0.22;
    // A clear high Sun still overwhelms the eye. Sunset keeps its stronger,
    // mood-driven bloom; this floor prevents noon from becoming a safe white dot.
    const sunGlowIntensity = Math.max(
      authoredSunGlow,
      smoothstep(-0.01, 0.08, this.sunElevation) * 0.45,
    );
    // --- Fog tracks the horizon so distant terrain melts into the sky ---
    this.fog.color.copy(this._horizon);
    this.fog.density = BASE_FOG_DENSITY * g.haze;

    // --- Dome uniforms ---
    this.uSunDir.copy(celestial.sun.direction);
    this.uMoonDir.copy(celestial.moon.direction);
    this.uSunAngularRadius.value = celestial.sun.angularRadiusRad * SUN_VISUAL_SCALE;
    const visibleMoonRadius = celestial.moon.angularRadiusRad * MOON_VISUAL_SCALE;
    this.uMoonAngularRadius.value = visibleMoonRadius;
    // The disc's authored exposure rides the SAME night factor as the palette, so
    // the Moon and the sky it sits in are always adapted to each other. See
    // MOON_RADIANCE_DAY/NIGHT for why the dome has to carry adaptation at all.
    this.uMoonRadiance.value =
      MOON_RADIANCE_DAY + (MOON_RADIANCE_NIGHT - MOON_RADIANCE_DAY) * night;
    this.uZenith.copy(this._zenith);
    this.uHorizon.copy(this._horizon);
    this.uSunColor.copy(this._sunColor);
    this.uSunGlowColor.copy(this._sunGlow);
    this.uSunGlowIntensity.value = sunGlowIntensity;
    this.uMoonAmount.value = smoothstep(-0.01, 0.005, celestial.moon.direction.y);
    this.uAntiSolar.value = 1 - smoothstep(0, 0.55, Math.abs(this.sunElevation));

    // --- Cirrus deck ---
    // Cover comes from the sky gradient (weather, on a 400 km cycle). Visibility is
    // held through dusk — a lit deck at sunset is the best the sky ever looks — and
    // gone by the time `night` reaches 1, past nautical dusk, because the dome cannot
    // occlude a star.
    this.uCloudCover.value = g.cloudCover;
    this.uCloudAmount.value = 1 - night;
    this.uCloudTime.value = (performance.now() * 0.001) % 3600;

    // --- Photometric exposure and real catalogue stars ---
    //
    // No temporal adaptation. The exposure IS the analytic answer for the current
    // illuminance, applied the moment the illuminance changes.
    //
    // Easing it used to be the "eye adaptation" setting, and over an uninterrupted
    // cycle it bought nothing: illuminance is already a smooth function of sun
    // elevation, so the eased value only ever lagged the correct one — by up to
    // twelve seconds of a twilight that lasts about thirty at the default clock.
    // Worse, a jump to another time of day teleports the illuminance but not the
    // eased exposure, so a night exposure briefly met full daylight and whited the
    // screen out. There is no interior, tunnel or muzzle flash here for adaptation
    // to earn its keep on, so the lag was the only thing it reliably delivered.
    const sceneIlluminance =
      celestial.keyIlluminanceLux / 40_000 +
      celestial.diffuseIlluminanceLux / 10_000;
    this.exposure = EXPOSURE_TARGET / (sceneIlluminance + ADAPTATION_FLOOR);
    const starVisibility = smoothstep(0.12, -0.12, this.sunElevation);
    this.starField.update(
      celestial.equatorialToWorld,
      this.exposure / 18_000,
      starVisibility,
      celestial.moon.direction,
      visibleMoonRadius,
    );
    this.planetField.update(celestial, this.exposure / 18_000);

    // One shadow-casting key light. Astronomy blends the Sun/Moon direction and
    // exposes the same blend for colour, so the horizon hand-off cannot step.
    this._lightDir.copy(celestial.keyDirection);
    this._lightColor.copy(C_MOON).lerp(this._sunColor, celestial.keySunWeight);
    this.sunLight.intensity = (celestial.keyIlluminanceLux / 40_000) * this.exposure;
    this.sunLight.color.copy(this._lightColor);

    // Diffuse sky/ground bounce retains real day-to-night ratios; analytic
    // exposure, not an arbitrary night floor, makes dark-adapted silhouettes.
    this._hemiSky.copy(C_DAY_ZENITH)
      .offsetHSL(g.skyHueShift * 0.5, 0.02, 0.0)
      .lerp(C_DAY_HORIZON, 0.4)
      .lerp(C_NIGHT_ZENITH, night);
    this._hemiGround.copy(C_GROUND).lerp(C_NIGHT_GROUND, night);
    this.hemiLight.color.copy(this._hemiSky);
    this.hemiLight.groundColor.copy(this._hemiGround);
    this.hemiLight.intensity = (celestial.diffuseIlluminanceLux / 10_000) * this.exposure;

    this.refreshEnvironment(allowEnvironmentRefresh, performance.now());

    // --- Reposition the sky with the camera ---
    //
    // The origin makes every scene-graph position RELATIVE, and the camera is no
    // exception: `cameraX/Y/Z` here are the relative eye straight off
    // `renderer.camera.position`. The sky must stay relative too, so the root, the
    // sun light and its shadow target below are all written with those same relative
    // coordinates and nothing in this block adds or subtracts the origin. Catalogue
    // stars and planets are children of `root`, laid out as direction × radius, so
    // they remain camera-relative and are never rebased. `skyGradientAt(s)` takes
    // arclength and is deliberately origin-independent.
    this.root.position.set(cameraX, cameraY, cameraZ);

    // The classic shadow bug: a DirectionalLight's shadow frustum is defined
    // around its target, which defaults to the origin. Drive a few hundred
    // metres away and the shadow camera no longer looks at you, so shadows
    // vanish. Follow the camera every frame to keep shadows alive anywhere.
    this._targetPos.set(cameraX, cameraY, cameraZ);

    // Shadow direction: the light's own direction, with its elevation lifted to
    // SHADOW_MIN_ELEVATION so a horizon sun cannot stretch every shadow across the
    // whole frame (see the constants). Azimuth is untouched, so shadows still fall
    // away from the sun; only their length is capped. The light's POSITION is what
    // three derives the shadow direction from, so this is the one place to do it —
    // the disc, colour and intensity above are all left alone.
    const dir = this._lightDir;
    const horizontal = Math.hypot(dir.x, dir.z);
    const elevation = Math.atan2(dir.y, horizontal);
    if (elevation < SHADOW_MIN_ELEVATION && horizontal > 1e-4) {
      const flat = Math.cos(SHADOW_MIN_ELEVATION) / horizontal;
      this._shadowDir.set(dir.x * flat, Math.sin(SHADOW_MIN_ELEVATION), dir.z * flat);
    } else {
      this._shadowDir.copy(dir);
    }
    this.sunLight.position.copy(this._shadowDir).multiplyScalar(SUN_DISTANCE).add(this._targetPos);
    // Fade the whole shadow out as the true sun sinks: at that point the ground is
    // in general shade anyway, and a clamped shadow under a horizon sun is the one
    // case where the cheat above would be visible.
    this.sunLight.shadow.intensity = smoothstep(0, SHADOW_FADE_ELEVATION, elevation);
    this.sunLight.target.position.copy(this._targetPos);
    this.sunLight.target.updateMatrixWorld();
  }

  /**
   * Marks significant solar changes as due, then replaces the live probe only
   * when the caller has left the frame idle enough for a PMREM render.
   */
  private refreshEnvironment(allowEnvironmentRefresh: boolean, nowMs: number): void {
    const isInitialBake = Number.isNaN(this.envBakedElevation);
    const bakeStep =
      Math.abs(this.sunElevation) < 0.35 ? ENV_TWILIGHT_BAKE_STEP : ENV_BAKE_STEP;
    if (
      !isInitialBake &&
      Math.abs(this.sunElevation - this.envBakedElevation) >= bakeStep
    ) {
      this.envBakePending = true;
    }
    if (
      !allowEnvironmentRefresh ||
      !this.envBakePending ||
      (!isInitialBake && nowMs - this.envLastBakeMs < ENV_BAKE_INTERVAL_MS)
    ) {
      return;
    }

    // Keep the old target live until PMREM has fully produced a replacement.
    const nextTarget = this.pmrem.fromScene(
      this.envScene,
      0,
      1,
      DOME_RADIUS * 2,
      { size: this.environmentSize },
    );
    const previous = this.envTarget;
    this.envTarget = nextTarget;
    this.scene.environment = nextTarget.texture;
    this.envBakedElevation = this.sunElevation;
    this.envLastBakeMs = nowMs;
    this.envBakePending = false;
    this.didBakeEnvironment = true;
    if (previous !== null) previous.dispose();
  }

  /**
   * Applies a rendering tier to everything overhead: the PMREM resolution the next
   * due bake will use (without making one due), and how faint the star catalogue
   * is drawn to. Both take effect without a reload.
   */
  setQuality(quality: GraphicsQuality): void {
    this.environmentSize = quality === 'acceptable' ? 64 : 128;
    this.starField.setQuality(quality);
  }

  get didBakeEnvironmentThisFrame(): boolean {
    return this.didBakeEnvironment;
  }

  /** Unit vector pointing toward the sun. Live internal vector — do not retain across frames. */
  get sunDirection(): { x: number; y: number; z: number } {
    return this._sunDir;
  }

  get isNight(): boolean {
    return this.sunElevation < NIGHT_ELEVATION;
  }

  /**
   * How lit the roadside lamps should be, 0..1.
   *
   * `isNight` is a threshold and has to stay one — a lamp either counts as on for
   * gameplay or it does not. What it cannot do is drive the LOOK: switching every
   * lamp in view within one frame is the most conspicuous step in the whole dusk,
   * and `setLamps` already takes a continuous factor for emissive and point
   * intensity, so the binary was thrown away for nothing.
   *
   * The band runs from the geometric horizon to roughly eight degrees below it,
   * which is about where civil twilight gives out and a lamp starts contributing
   * more than the sky does.
   */
  get lampFactor(): number {
    return smoothstep(0, LAMP_FULL_ELEVATION, this.sunElevation);
  }

  /**
   * How "day" the sun position reads, 0..1. Drives the daytime-only heat haze:
   * zero at night and through the dawn/dusk dip, one under a clear daytime sun.
   * Reuses the same curve as the update loop's day/night sky blend, so the haze
   * disappears exactly when the sky goes dark.
   */
  get dayFactor(): number {
    return smoothstep(-0.12, 0.3, this.sunElevation);
  }

  /**
   * Perceptual visibility of local lights under the current solar illuminance.
   * The lamps still exist at noon, but a dark-adapted night beam cannot remain
   * equally visible against roughly 100,000 lux of daylight.
   */
  get artificialLightFactor(): number {
    return 1 - this.dayFactor * 0.995;
  }


  dispose(): void {
    this.scene.remove(this.root);
    this.scene.remove(this.sunLight);
    this.scene.remove(this.sunLight.target);
    this.scene.remove(this.hemiLight);

    this.dome.geometry.dispose();
    (this.dome.material as THREE.ShaderMaterial).dispose();
    this.moonTexture.dispose();

    this.starField.dispose();
    this.planetField.dispose();

    this.scene.environment = null;
    this.envMaterial.dispose();
    if (this.envTarget !== null) this.envTarget.dispose();
    this.pmrem.dispose();
  }
}
