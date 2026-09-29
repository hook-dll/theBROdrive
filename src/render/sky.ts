import * as THREE from 'three';
import { maxAnisotropy } from './texturequality';
import { GRAPHICS_CONFIG } from '../config';
import type { GraphicsQuality } from '../game/settings';
import { DAY_LENGTH } from '../game/state';
import { skyGradientAt } from '../world/gradient';
import { hash01 } from '../core/rng';
import { AstronomySystem } from './astronomy';
import { StarField } from './starcatalog';
import { PlanetField } from './planetfield';
import { weather } from '../world/weather';
import { SandColor } from './desertdust';
import { setAirFogExtinction, setAirFogSky, setAirFogSun } from './airfog';

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
/**
 * Reference axes for building an orthonormal basis perpendicular to the shadow
 * direction (see `stabilizeShadowTarget`). `WORLD_UP` is crossed with the shadow
 * direction to get "right"; the fallback substitutes when the sun sits close enough
 * to straight overhead that the cross product would be near zero.
 */
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const WORLD_UP_FALLBACK = new THREE.Vector3(1, 0, 0);

/** Sun elevation (radians) below this counts as night for headlight/lamp logic. */
const NIGHT_ELEVATION = -0.08;
/**
 * Sun elevation (radians) at which roadside lamps reach full output. Eight degrees
 * below the horizon: the end of civil twilight, where a lamp finally out-lights
 * the sky. Above the horizon they are off; between the two they ramp.
 */
const LAMP_FULL_ELEVATION = -0.14;

/**
 * Shadow direction is clamped only in the last few degrees above the horizon.
 *
 * A mathematically exact horizon light makes kilometre-long shadows that cannot fit
 * the local shadow map. Holding the caster direction at roughly 3.5 degrees keeps the
 * map finite while preserving the long, raking shadows that make dawn and sunset
 * readable. Shadows fade only as the actual key reaches the horizon; golden hour is
 * not faded away.
 */
const SHADOW_MIN_ELEVATION = 0.06;
const SHADOW_FADE_ELEVATION = 0.035;
/**
 * The key light's share of the scene's light at which its shadow fades out, and the
 * share at which it is fully drawn.
 *
 * A shadow can darken a surface by at most key / (key + fill) of what it receives, so
 * a key that is a sliver of the lighting casts a shadow nobody can see — and it still
 * paid for the whole 2048² map, re-rendered every frame. That is every night: the Moon
 * is the key from dusk to dawn, and under the fifty-fold exposure ceiling a FULL moon at
 * the zenith is 0.25 lx / 40 000 × 50 = 3.1e-4 of display light against a moonlit fill
 * that never drops below 0.022 (the pre-dawn trough), so its shadow could take at most
 * 1.4 % off the ground it falls on. Measured across a whole day at the default epoch:
 * 0.05-0.29 % all night, 16 % a minute before sunset and 50 % by day. Fading between 2
 * and 5 % leaves every daylight and golden-hour shadow exactly as it was and makes the
 * night's exactly zero, which is what lets `update` stop drawing the map.
 */
const SHADOW_KEY_SHARE_GONE = 0.02;
const SHADOW_KEY_SHARE_FULL = 0.05;


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
/** The enlarged disc is three times the physical angular radius: twice its prior size. */
const SUN_VISUAL_SCALE = 3;
/**
 * Meteorological visibility of the clear desert air, metres: the distance at which a
 * dark ridge keeps 2 % of its contrast (Koschmieder, beta = 3.912 / V).
 *
 * Dry desert air runs to 100-200 km. At 120 a ridge ten kilometres out keeps about
 * 70 % of its own colour — a little bluer and flatter, which is what distance looks
 * like — and the land only gives itself up to the sky near the edge of the drawn world
 * (render/airfog.ts). The old base fog was a visibility of a few kilometres under a
 * clear sky: on the top tier a mesa ten kilometres off came out exactly the horizon's
 * pale cyan, the same pixel as the sky band beside it, over dark ground in front.
 */
const CLEAR_AIR_VISIBILITY_M = 120_000;
/**
 * How strongly the gradient's regional `haze` (1..3.2) thickens the clear air, as an
 * exponent. Linear gave the haziest stretch 37 km of sight under the same clean blue
 * sky — a milky skyline no weather accounts for. At 0.5 it is about 67 km: softer
 * distance, still the land's own colour. A real veil belongs to the weather (mgla),
 * which also bleaches the sky it hangs in.
 */
const REGIONAL_HAZE_POWER = 0.5;

/**
 * Total display-referred light the key and the sky bounce are exposed to between
 * them. The two lights below are written as their share of the real illuminance
 * times this exposure, so under full adaptation they always sum to it and only
 * their SPLIT — and the palette they are tinted with — carries the time of day.
 */
export const EXPOSURE_TARGET = 5;
/**
 * Soft floor under normalized scene illuminance. This is the limit of visual
 * adaptation, not a numerical epsilon: `EXPOSURE_TARGET / ADAPTATION_FLOOR` is a
 * maximum 50x exposure.
 *
 * The previous 25,000x maximum divided almost all real day-to-night variation back
 * out of the lights. The desert retained essentially full daylight through civil
 * twilight and stayed readable under 0.002 lux night-sky illumination. Fifty-fold
 * adaptation preserves detail at sunset, then lets the world become genuinely dark.
 * Adding the floor in the denominator keeps that transition smooth without a clamp.
 */
export const ADAPTATION_FLOOR = 0.1;
/**
 * The sky's own dark adaptation remains exactly as authored. Stars and unresolved
 * planets are display-space lights, not illumination cast onto the desert; coupling
 * them to the ground exposure would erase the night sky while fixing the ground.
 */
const CELESTIAL_ADAPTATION_FLOOR = EXPOSURE_TARGET / 25_000;


// ---------------------------------------------------------------------------
// Palette (authored as sRGB hex; THREE converts to linear working space)
// ---------------------------------------------------------------------------

const C_DAY_ZENITH = new THREE.Color().setStyle('#4d8ede');
/**
 * The pale band the daytime sky fades to at the horizon, and — because `fog.color`
 * copies it — the colour the far desert dissolves into.
 *
 * Taken off a reference screenshot of the genre's own noon sky: almost white with
 * only a restrained cyan bias, so the saturated blue remains overhead instead of
 * reaching the desert skyline.
 */
const C_DAY_HORIZON = new THREE.Color().setStyle('#dceff8');
const C_NIGHT_ZENITH = new THREE.Color().setStyle('#03040a');
const C_NIGHT_HORIZON = new THREE.Color().setStyle('#0d1424');
const C_SUN_LOW = new THREE.Color().setStyle('#ffb166');
const C_SUN_HIGH = new THREE.Color().setStyle('#fff7ec');
const C_TURBID = new THREE.Color().setStyle('#c9b18c');
const C_MOON = new THREE.Color().setStyle('#a9c6e6');
const C_GROUND = new THREE.Color().setStyle('#d8a45c'); // warm ochre sand bounce
/** Daylight sky illumination gain; the warm ground bounce is compensated below. */
const DAY_SKY_FILL_BOOST = 1.5;
/**
 * MOONLIT FILL. The dome's night palette above is what the SKY looks like, and it
 * is nearly black on purpose — that is what lets the stars read. The hemisphere
 * bounce used to inherit those same numbers at a strictly photometric intensity,
 * and the result at midnight was a desert of absolute zero: no dune, no verge, no
 * silhouette, nothing but stars and whatever a headlight happened to be pointing
 * at. That is what made night driving hostile rather than quiet. The beam was not
 * too bright; it was the ONLY thing on screen, so the eye had nothing to adapt to
 * and read it as glare.
 *
 * So the FILL — and only the fill, never the dome, the stars, the environment map
 * or the direct key light — carries an authored floor: a cool moonlit sky bounce
 * over a dim warm sand bounce, at about a hundredth of daylight. Enough that a
 * dune keeps an edge and the road keeps its verges; far too little to compete with
 * the lamps or to wash out a magnitude-8 star. A real desert night is pitch black;
 * this is the eye that has been out in it for a while, and it was raised a third
 * (0.09 to 0.12) so the shapes of the ground just read beyond the beams.
 */
const C_NIGHT_FILL_SKY = new THREE.Color().setStyle('#41567f');
const C_NIGHT_FILL_GROUND = new THREE.Color().setStyle('#241f19');
const NIGHT_FILL_INTENSITY = 0.12;

// ---------------------------------------------------------------------------
// Weather palettes (world/weather.ts)
// ---------------------------------------------------------------------------

/**
 * The dust colours are authored against the starting sand and carried round the
 * palette with it (render/desertdust.ts): a violet desert raises a violet storm.
 *
 * Each weather owns a zenith and a horizon it pulls the sky toward, in daylight; at
 * night every one of them is simply darker air, so the pull is weighted by `day`.
 * The horizon doubles as the fog colour, which is what makes each of these a change
 * of the WHOLE picture rather than of the sky: the far desert dissolves into it.
 */
/** Mgla: bleached beige at the horizon, a washed grey-blue overhead. */
const C_HAZE_HORIZON = new SandColor(new THREE.Color().setStyle('#d8c6a2')).value;
const C_HAZE_ZENITH = new THREE.Color().setStyle('#9fb0ba');
/** Inside a haboob: burnt orange dusk at noon. */
const C_DUST_HORIZON = new SandColor(new THREE.Color().setStyle('#bf7a3e')).value;
const C_DUST_ZENITH = new SandColor(new THREE.Color().setStyle('#a0622f')).value;
const C_DUST_NIGHT = new THREE.Color().setStyle('#140e09');
/** Under a storm deck: cool slate, lighter at the skyline where the deck thins. */
const C_STORM_HORIZON = new THREE.Color().setStyle('#838d95');
const C_STORM_ZENITH = new THREE.Color().setStyle('#4c5764');
/** Scrubbed air: a deeper blue overhead and a cleaner, bluer skyline. */
const C_CLEAR_ZENITH = new THREE.Color().setStyle('#2c6fd2');
const C_CLEAR_HORIZON = new THREE.Color().setStyle('#c4e2f4');
/** Lightning's colour on the fill: violet-white. */
const C_FLASH = new THREE.Color().setStyle('#dfe2ff');

/**
 * What each weather does to sight, as a meteorological visibility at full strength
 * (Koschmieder, beta = 3.912 / V), added to the clear air's extinction. This is the
 * same exponential law as the clear air, so a light veil is light: haze at a fifth of
 * its strength leaves a mesa five kilometres out about 45 % of its own colour.
 *
 * These used to be the scene's `FogExp2` density, 1 - exp(-(d·k)²). Squared distance
 * is spotless near and total a little further on: the trace of haze a windy or a hot
 * day carries (0.14-0.23) put 81 % fog on the land at 3 km and 99 % at 5 km, so every
 * mesa on the skyline came out one flat pale cut-out under a blue sky.
 */
const HAZE_VISIBILITY_M = 2_500;
const RAIN_VISIBILITY_M = 4_000;
const STORM_VISIBILITY_M = 8_000;
/**
 * The dust storm keeps the scene's `FogExp2`, and is its only density: a haboob IS a
 * wall, clear up to it and blind inside, and the wall pass (render/hazeshader.ts)
 * shares this law. 1 - exp(-(d·k)²) leaves ~150 m of sight.
 */
const FOG_DUST = 0.0125;

/**
 * How bright the far LAND's fog is against the sky's own horizon band, at night (by
 * day it is 1: the land dissolves into exactly the band behind it).
 *
 * `fog.color` used to be the horizon band itself at every hour. That is right at noon
 * and wrong from sunset on: the band is sky, lit from above the horizon by a sun the
 * ground has already lost, while the land in front of it is lit only by the fill. So
 * the far ridges took the full glow of a rose or gold twilight and stood out as flat
 * pink and tan cut-outs BRIGHTER than the sky above them, over a foreground already
 * gone black — which reads as an overexposed photograph, not as dusk. Real ridges at
 * twilight are silhouettes: the air in front of them adds some of the sky's colour,
 * never all of its light. Follows `day`, so the hand-over is as smooth as the palette.
 */
const LAND_FOG_NIGHT = 0.35;

/** The 22-degree halo radius, and how the sun dogs move off it as the sun climbs. */
const HALO_RADIUS = 0.384;

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

// --- Weather (world/weather.ts). Every term below is gated on its own uniform, so a
// clear sky pays for five comparisons and nothing else. ---
/**
 * How far the dome is flattened to its horizon colour, 0..1. Inside dust, a thick
 * haze or heavy rain the sky overhead is the same murk the land dissolves into; left
 * as a gradient, a fully fogged ridge would stand out as a pale silhouette against
 * the darker sky just above it — the one thing thick air must never show.
 */
uniform float uDomeFlat;
/** Storm deck: the cirrus becomes a grey convective overcast with darker bases. */
uniform float uStorm;
/** Cirrostratus optics: the 22-degree halo and the two sun dogs. */
uniform float uHalo;
uniform vec3 uDogA;
uniform vec3 uDogAOut;
uniform vec3 uDogB;
uniform vec3 uDogBOut;
/** Rainbow strength: rain in the air with the sun shining behind the eye. */
uniform float uRainbow;
/** Lightning: the flash, and the bolt's bearing, top elevation and shape seed. */
uniform float uFlash;
uniform float uBoltAz;
uniform float uBoltTop;
uniform float uBoltSeed;

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
  vec3 col = mix(uHorizon, uZenith, pow(h, 0.62) * (1.0 - uDomeFlat));

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
  if (uStorm > 0.0) {
    // A convective deck is not ice: it is thick, grey, and darkest where it is
    // thickest, so the same noise that places the puffs now shades them — dense
    // cores sink toward a slate base, thin edges stay the pale horizon grey. The
    // cover grows from the cirrus threshold (uCloudCover rises with the storm), so
    // the sky closes in from the existing wisps rather than fading in everywhere.
    float thick = smoothstep(0.08, 0.42, n);
    vec3 stormCol = mix(uHorizon * 1.04, uZenith * 0.78, thick);
    stormCol += uSunColor * 0.12 * pow(max(sd, 0.0), 3.0) * (1.0 - thick);
    cloudCol = mix(cloudCol, stormCol, uStorm);
  }
  col = mix(col, cloudCol, deck);

  float sunUp = smoothstep(-0.02, 0.06, uSunDir.y);

  // --- Cirrostratus optics --------------------------------------------------
  if (uHalo > 0.0) {
    float ang = acos(clamp(sd, -1.0, 1.0));
    // A thin milky veil is what makes a halo: the whole sky pales toward the sun.
    col = mix(col, uHorizon * 1.02, uHalo * 0.28 * (0.5 + 0.5 * max(sd, 0.0)));
    // The 22-degree ring: a sharp reddish inner edge, a soft white outer skirt, and a
    // sky slightly darker inside it than out, as the real one has.
    float ring = exp(-pow((ang - 0.384) / 0.009, 2.0));
    float skirt = smoothstep(0.384, 0.40, ang) * (1.0 - smoothstep(0.40, 0.5, ang));
    vec3 ringCol = mix(vec3(1.0, 0.62, 0.42), vec3(0.95, 0.97, 1.0), smoothstep(0.378, 0.395, ang));
    float inside = smoothstep(0.1, 0.36, ang) * (1.0 - smoothstep(0.37, 0.384, ang));
    col *= 1.0 - inside * 0.06 * uHalo * sunUp;
    col += (ringCol * ring * 0.22 + vec3(0.9, 0.93, 1.0) * skirt * 0.035) * uHalo * sunUp;
    // Sun dogs: a bright spot on each side at the sun's own elevation, red toward the
    // sun, trailing a white tail away from it.
    for (int i = 0; i < 2; i++) {
      vec3 dogD = i == 0 ? uDogA : uDogB;
      vec3 dogO = i == 0 ? uDogAOut : uDogBOut;
      vec3 v = dir - dogD;
      float x = dot(v, dogO);
      float y = v.y;
      float spot = exp(-pow(y / 0.012, 2.0)) * (x < 0.0 ? exp(-pow(x / 0.008, 2.0)) : exp(-x / 0.05));
      vec3 dogCol = x < 0.0 ? vec3(1.0, 0.58, 0.4) : mix(vec3(1.0, 0.93, 0.8), vec3(0.9, 0.95, 1.0), smoothstep(0.0, 0.04, x));
      col += dogCol * spot * 0.32 * uHalo * sunUp * step(0.0, dot(dir, dogD));
    }
  }

  // --- Rainbow --------------------------------------------------------------
  // 42 degrees round the antisolar point, red outside, violet inside, with the faint
  // reversed secondary at 51 and the darker Alexander band between. Only where rain
  // is falling in front of the eye and the sun is behind it, which the uniform says.
  if (uRainbow > 0.0 && dir.y > 0.0) {
    float anti = acos(clamp(-sd, -1.0, 1.0));
    // Primary 40.5-42.5 degrees, violet inside; secondary 50-53.5, reversed and dimmer.
    float p = (anti - 0.706) / 0.036;
    float q = (0.935 - anti) / 0.06;
    vec3 bow = vec3(0.0);
    if (p > 0.0 && p < 1.0) {
      vec3 hue = clamp(abs(fract(vec3(0.78 * (1.0 - p)) + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0, 0.0, 1.0);
      bow += mix(hue, vec3(1.0), 0.3) * sin(3.14159 * p);
    }
    if (q > 0.0 && q < 1.0) {
      vec3 hue = clamp(abs(fract(vec3(0.78 * (1.0 - q)) + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0, 0.0, 1.0);
      bow += 0.3 * mix(hue, vec3(1.0), 0.35) * sin(3.14159 * q);
    }
    // Brighter sky inside the primary, darker Alexander's band between the two.
    float inner = 1.0 - smoothstep(0.55, 0.705, anti);
    float alexander = smoothstep(0.745, 0.77, anti) * (1.0 - smoothstep(0.85, 0.875, anti));
    float foot = smoothstep(0.0, 0.08, dir.y);
    col += (bow * 0.13 + inner * 0.03) * uRainbow * foot;
    col *= 1.0 - alexander * 0.06 * uRainbow * foot;
  }

  // --- Lightning ------------------------------------------------------------
  if (uFlash > 0.001) {
    // The whole deck lights from inside; clear sky only a little.
    col += vec3(0.78, 0.8, 1.0) * uFlash * (0.12 + 0.55 * deck * uStorm);
    // The channel: a jagged line from the cloud base to the ground on one bearing.
    float az = atan(dir.x, dir.z);
    float da = mod(az - uBoltAz + 3.14159265, 6.28318531) - 3.14159265;
    float e = asin(clamp(dir.y, -1.0, 1.0));
    float h = clamp(e / max(uBoltTop, 0.01), 0.0, 1.0);
    float jag = (cloudNoise(vec2(h * 9.0, uBoltSeed * 50.0)) - 0.5) * 0.03
      + (cloudNoise(vec2(h * 31.0, uBoltSeed * 50.0 + 7.0)) - 0.5) * 0.009;
    float width = 0.0009 + 0.0005 * (1.0 - h);
    float core = exp(-pow((da - jag * uBoltTop * 4.0) / width, 2.0));
    float glow = exp(-abs(da - jag * uBoltTop * 4.0) / (width * 8.0));
    float span = step(0.0, e) * step(e, uBoltTop);
    col += vec3(0.85, 0.87, 1.0) * (core * 2.0 + glow * 0.25) * span * uFlash;
  }

  // Disc edges are one-pixel derivative transitions. The old fixed dot-product
  // width was wider than the Moon itself and mixed its dark limb into nearby sky.
  float sunEdge = cos(uSunAngularRadius);
  float sunAa = max(fwidth(sd) * 0.5, 0.0000001);
  float disc = smoothstep(sunEdge - sunAa, sunEdge + sunAa, sd);
  // Keep the white-hot centre, but concentrate both lobes so the clipped region
  // does not spread across a large part of a clear high-altitude sky.
  float glow = pow(max(sd, 0.0), 12.0) * 0.45 + pow(max(sd, 0.0), 96.0) * 1.5;
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
  /** Network/decode completion for the only external texture owned by the sky. */
  private readonly moonReady: Promise<void>;
  private exposure = 1;

  // --- Environment probe: what makes metal read as metal (see refreshEnvironment) ---
  private readonly pmrem: THREE.PMREMGenerator;
  private readonly envScene = new THREE.Scene();
  /** Holds one dome, sharing the visible dome's uniforms, shaded in linear space. */
  private readonly envMaterial: THREE.ShaderMaterial;
  private envTarget: THREE.WebGLRenderTarget | null = null;

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
  // --- Weather (see the SKY_FRAGMENT weather block) ---
  private readonly uDomeFlat = { value: 0 };
  private readonly uStorm = { value: 0 };
  private readonly uHalo = { value: 0 };
  private readonly uDogA = new THREE.Vector3();
  private readonly uDogAOut = new THREE.Vector3();
  private readonly uDogB = new THREE.Vector3();
  private readonly uDogBOut = new THREE.Vector3();
  private readonly uRainbow = { value: 0 };
  private readonly uFlash = { value: 0 };
  private readonly uBoltAz = { value: 0 };
  private readonly uBoltTop = { value: 0.1 };
  private readonly uBoltSeed = { value: 0 };
  /** A haboob's FogExp2 density, the scene fog's only one (see FOG_DUST). */
  private dustFog = 0;
  private readonly _weatherTint = new THREE.Color();
  private readonly _airSky = new THREE.Color();
  private readonly _airDusk = new THREE.Color();


  // --- Scratch state, reused every frame (no allocation in the hot path) ---
  private readonly _sunDir = new THREE.Vector3();
  private readonly _lightDir = new THREE.Vector3();
  /** Light direction with its elevation clamped, for the shadow camera only. */
  private readonly _shadowDir = new THREE.Vector3();
  private readonly _targetPos = new THREE.Vector3();
  /** Orthonormal basis perpendicular to `_shadowDir`, rebuilt each frame it changes. */
  private readonly _shadowRight = new THREE.Vector3();
  private readonly _shadowUp = new THREE.Vector3();
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
    this.moonTexture = new THREE.Texture();
    this.moonReady = new THREE.ImageLoader().loadAsync('/data/moon.jpg').then((image) => {
      this.moonTexture.image = image;
      this.moonTexture.needsUpdate = true;
    });
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
    this.moonTexture.anisotropy = maxAnisotropy();
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
        uDomeFlat: this.uDomeFlat,
        uStorm: this.uStorm,
        uHalo: this.uHalo,
        uDogA: { value: this.uDogA },
        uDogAOut: { value: this.uDogAOut },
        uDogB: { value: this.uDogB },
        uDogBOut: { value: this.uDogBOut },
        uRainbow: this.uRainbow,
        uFlash: this.uFlash,
        uBoltAz: this.uBoltAz,
        uBoltTop: this.uBoltTop,
        uBoltSeed: this.uBoltSeed,
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
    // The shadow map follows the camera, so a tighter frustum spends its texels on
    // the road, car and nearby props instead of wasting resolution on empty desert.
    shadow.mapSize.set(GRAPHICS_CONFIG.shadowMapSize, GRAPHICS_CONFIG.shadowMapSize);
    shadow.camera.near = GRAPHICS_CONFIG.shadowNear;
    shadow.camera.far = GRAPHICS_CONFIG.shadowFar;
    const shadowHalfSize = GRAPHICS_CONFIG.shadowFrustumHalfSize;
    shadow.camera.left = -shadowHalfSize;
    shadow.camera.right = shadowHalfSize;
    shadow.camera.top = shadowHalfSize;
    shadow.camera.bottom = -shadowHalfSize;
    // Small bias preserves contact shadows without acne on the terrain.
    shadow.bias = GRAPHICS_CONFIG.shadowBias;
    shadow.normalBias = GRAPHICS_CONFIG.shadowNormalBias;
    shadow.camera.updateProjectionMatrix();
    scene.add(this.sunLight);
    // The target must be in the scene graph for its matrixWorld to update.
    scene.add(this.sunLight.target);

    // --- Hemisphere bounce ---
    this.hemiLight = new THREE.HemisphereLight(0x88b4e6, 0xd8a45c, 1.0);
    scene.add(this.hemiLight);

    scene.add(this.root);
  }

  /** Prevents the launch cover from leaving while the lunar texture is still decoding. */
  async waitForAssets(): Promise<void> {
    await this.moonReady;
  }


  update(
    calendarEpoch: string,
    timeOfDay: number,
    dayIndex: number,
    s: number,
    cameraX: number,
    cameraY: number,
    cameraZ: number,
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

    // --- Weather pulls ---
    // Order matters only where two overlap: scrubbed air first (it is the baseline
    // the others darken), then the veil, the deck and the dust, heaviest last.
    const w = weather;
    this._zenith.lerp(C_CLEAR_ZENITH, w.clarity * 0.6 * day);
    this._horizon.lerp(C_CLEAR_HORIZON, w.clarity * 0.45 * day);
    this._zenith.lerp(C_HAZE_ZENITH, w.haze * 0.75 * day);
    this._horizon.lerp(C_HAZE_HORIZON, w.haze * 0.85 * day);
    this._zenith.lerp(this._weatherTint.copy(C_HAZE_HORIZON).lerp(C_DUST_ZENITH, 0.3), w.halo * 0.18 * day);
    this._zenith.lerp(C_STORM_ZENITH, w.cloud * 0.9 * day);
    this._horizon.lerp(C_STORM_HORIZON, w.cloud * 0.8 * day);
    // At night a storm deck still hides the last blue of the sky: darker, not grey.
    this._zenith.multiplyScalar(1 - 0.5 * w.cloud * night);
    this._horizon.multiplyScalar(1 - 0.35 * w.cloud * night);
    this._weatherTint.copy(C_DUST_HORIZON).lerp(C_DUST_NIGHT, night);
    // Ahead of a haboob the air is already carrying its outflow: the horizon, and so
    // the fog the land dissolves into, browns as the wall comes, instead of leaving
    // the far ridges as pale blue ghosts in front of it.
    this._horizon.lerp(this._weatherTint, Math.max(w.dust * 0.95, w.front ** 4 * 0.55));
    this._weatherTint.copy(C_DUST_ZENITH).lerp(C_DUST_NIGHT, night);
    this._zenith.lerp(this._weatherTint, Math.max(w.dust * 0.97, w.front ** 8 * 0.6));

    // Sun disc: warm at low angle, white overhead.
    this._sunColor.copy(C_SUN_LOW).lerp(C_SUN_HIGH, smoothstep(0.0, 0.55, this.sunElevation));
    // What reaches the eye through the weather. Haze turns the disc into the pale,
    // flat coin you can look straight at; a storm deck or a dust storm takes it away.
    const sunThrough =
      (1 - 0.6 * weather.haze) * (1 - 0.97 * weather.dust) * (1 - 0.94 * weather.cloud);
    this._sunColor.lerp(C_SUN_LOW, weather.haze * 0.35).multiplyScalar(sunThrough);
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
    ) * sunThrough * (1 + 0.8 * weather.haze * (1 - weather.dust));
    // --- Fog tracks the dome so distant terrain melts into the sky behind it ---
    // ...at the land's own light level once the sun is low (see LAND_FOG_NIGHT). The
    // gradient's top is the dome's own, `mix(uHorizon, uZenith, 1 - uDomeFlat)`, so the
    // land fog climbs with elevation exactly as the sky does (render/airfog.ts).
    const landFog = LAND_FOG_NIGHT + (1 - LAND_FOG_NIGHT) * day;
    this.fog.color.copy(this._horizon).multiplyScalar(landFog);
    setAirFogSky(
      this._airSky.copy(this._horizon).lerp(this._zenith, 1 - this.uDomeFlat.value).multiplyScalar(landFog),
    );
    // The dome's anti-solar darkening, set here so the land's fog reads the same value.
    this.uAntiSolar.value = 1 - smoothstep(0, 0.55, Math.abs(this.sunElevation));
    setAirFogSun(
      celestial.sun.direction,
      this.uAntiSolar.value,
      this._airDusk.copy(this._zenith).multiplyScalar(0.55 * landFog),
    );
    setAirFogExtinction(
      (3.912 / CLEAR_AIR_VISIBILITY_M) * g.haze ** REGIONAL_HAZE_POWER *
        (1 - 0.55 * weather.clarity) * (1 - 0.6 * weather.front * (1 - weather.dust)) +
        3.912 *
          (weather.haze / HAZE_VISIBILITY_M +
            weather.rain / RAIN_VISIBILITY_M +
            weather.cloud / STORM_VISIBILITY_M),
    );
    this.dustFog = FOG_DUST * Math.max(weather.dust, 0.2 * smoothstep(0.88, 1, weather.front));

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

    // --- Cirrus deck ---
    // Cover comes from the sky gradient (weather, on a 400 km cycle). Visibility is
    // held through dusk — a lit deck at sunset is the best the sky ever looks — and
    // gone by the time `night` reaches 1, past nautical dusk, because the dome cannot
    // occlude a star.
    this.uCloudCover.value = Math.max(
      g.cloudCover * (1 - weather.clarity * 0.5),
      0.5 + 0.5 * weather.cloud,
      g.cloudCover + weather.halo * 0.25,
    );
    // A storm deck stays visible after dark (it is lit by the town-less desert's
    // nothing, and by lightning), so it does not fade with the night like cirrus.
    // Haze and dust swallow the high cloud: the sky above a mgla is one milky veil.
    this.uCloudAmount.value =
      Math.max(1 - night, weather.cloud * 0.9) * (1 - 0.85 * weather.haze) * (1 - weather.dust);
    this.uCloudTime.value = (performance.now() * 0.001) % 3600;
    this.updateWeatherOptics(celestial.sun.direction);

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
    const celestialExposure =
      EXPOSURE_TARGET / (sceneIlluminance + CELESTIAL_ADAPTATION_FLOOR);
    // The probe is intentionally baked once, then scaled continuously. Re-baking a
    // PMREM through twilight caused recurrent main-thread/GPU stalls; leaving a bright
    // daytime probe at full strength instead made night materials glow. The exposed
    // light budget is the exact scalar both problems need.
    this.scene.environmentIntensity = Math.min(
      1,
      (sceneIlluminance * this.exposure) / EXPOSURE_TARGET,
    );
    // Cloud, dust and a thick haze put out the stars and the Moon they would hide.
    const overcast = Math.max(weather.cloud, weather.dust, weather.haze * 0.75);
    const starVisibility = smoothstep(0.12, -0.12, this.sunElevation) * (1 - 0.97 * overcast);
    this.uMoonAmount.value *= 1 - 0.92 * overcast;
    this.starField.update(
      celestial.equatorialToWorld,
      celestialExposure / 18_000,
      starVisibility,
      celestial.moon.direction,
      visibleMoonRadius,
    );
    this.planetField.update(celestial, celestialExposure / 18_000);

    // One shadow-casting key light. Astronomy blends the Sun/Moon direction and
    // exposes the same blend for colour, so the horizon hand-off cannot step.
    this._lightDir.copy(celestial.keyDirection);
    this._lightColor.copy(C_MOON).lerp(this._sunColor, celestial.keySunWeight);
    // The key through the weather. Not the disc's `sunThrough`: the eye adapts to
    // a dimmer day, so the ground loses far less than the disc does. What is taken
    // from the key is partly handed to the fill below, which is what makes overcast
    // light flat instead of merely dark.
    const keyThrough =
      (1 - 0.5 * weather.haze) * (1 - 0.88 * weather.dust) * (1 - 0.82 * weather.cloud ** 1.6);
    this.sunLight.intensity = (celestial.keyIlluminanceLux / 40_000) * this.exposure * keyThrough;
    this.sunLight.color.copy(this._lightColor);
    if (weather.dust > 0) this.sunLight.color.lerp(C_DUST_HORIZON, weather.dust * 0.6);

    // Diffuse sky/ground bounce retains real day-to-night ratios by day, and floors
    // at an authored moonlit fill by night (see NIGHT_FILL_INTENSITY): photometric
    // adaptation alone left the desert at absolute zero, which is what turned a
    // headlight into the only object on screen. Daylight receives 50% more SKY fill,
    // while reciprocal compensation keeps the warm sand bounce at its former energy.
    // This opens upward and vertical shadow detail with a blue-cyan cast without
    // touching the direct Sun, the shadow map, the dome, or global exposure.
    const skyFillBoost = 1 + (DAY_SKY_FILL_BOOST - 1) * day;
    this._hemiSky.copy(C_DAY_ZENITH)
      .offsetHSL(g.skyHueShift * 0.5, 0.025, 0.0)
      .lerp(C_DAY_HORIZON, 0.32)
      .lerp(C_SUN_HIGH, 0.025)
      .lerp(C_NIGHT_FILL_SKY, night);
    this._hemiGround.copy(C_GROUND)
      .lerp(C_NIGHT_FILL_GROUND, night)
      .multiplyScalar(1 / skyFillBoost);
    this.hemiLight.color.copy(this._hemiSky);
    this.hemiLight.groundColor.copy(this._hemiGround);
    const photometricFill =
      (celestial.diffuseIlluminanceLux / 10_000) * this.exposure *
      GRAPHICS_CONFIG.hemisphereIntensityScale * skyFillBoost;
    this.hemiLight.intensity = Math.max(
      photometricFill,
      NIGHT_FILL_INTENSITY * night * GRAPHICS_CONFIG.hemisphereIntensityScale,
    );
    // Weather on the fill: overcast and haze scatter the lost key into the sky, so
    // the fill grows and takes the sky's own colour; dust is dimmer and orange.
    this.hemiLight.color.lerp(this._horizon, Math.min(1, weather.cloud * 0.7 + weather.haze * 0.5 + weather.dust * 0.8));
    this.hemiLight.groundColor.lerp(this._horizon, weather.dust * 0.5 + weather.cloud * 0.3);
    this.hemiLight.intensity *=
      (1 + 0.35 * weather.haze + 0.45 * weather.cloud * day) * (1 - 0.35 * weather.dust);
    if (weather.flash > 0) {
      this.hemiLight.color.lerp(C_FLASH, Math.min(1, weather.flash));
      this.hemiLight.intensity += weather.flash * 2.2 * GRAPHICS_CONFIG.hemisphereIntensityScale;
    }

    this.refreshEnvironment();

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
    // `_targetPos` just followed the camera to a WORLD position that moves smoothly,
    // a fraction of a shadow-map texel every frame. Left as-is, every point in the
    // world lands on a slightly different texel each frame, and the shadow it casts
    // swims with it — invisible against open desert, but under a low indoor ceiling,
    // where a rafter or a doorframe is a metre or two overhead, the swimming shadow
    // boundary of everything close by reads as a dark patch that follows the player
    // around the room, because the frustum is by construction always centred on
    // them. Snapping the target to the shadow map's own texel lattice makes every
    // world point land on the SAME texel regardless of camera motion, which is what
    // stops the crawl; the residual discretisation is one texel (a few centimetres),
    // far below anything a player can see move.
    this.stabilizeShadowTarget();
    this.sunLight.position.copy(this._shadowDir).multiplyScalar(SUN_DISTANCE).add(this._targetPos);
    // Fade the whole shadow out as the true sun sinks: at that point the ground is
    // in general shade anyway, and a clamped shadow under a horizon sun is the one
    // case where the cheat above would be visible. It also fades with the key's share
    // of the light, which is what takes the Moon's invisible shadow away at night (see
    // SHADOW_KEY_SHARE_GONE). `hemiLight` was written above, this same frame.
    const key = this.sunLight.intensity;
    const keyShare = key / Math.max(1e-9, key + this.hemiLight.intensity);
    const shadowStrength =
      smoothstep(0, SHADOW_FADE_ELEVATION, elevation) *
      smoothstep(SHADOW_KEY_SHARE_GONE, SHADOW_KEY_SHARE_FULL, keyShare) *
      (1 - 0.45 * weather.haze) * (1 - 0.9 * weather.dust) * (1 - 0.75 * weather.cloud);
    this.sunLight.shadow.intensity = shadowStrength;
    // A zero-strength shadow is never drawn again until it returns. Freezing the map
    // rather than clearing `castShadow` is the point: `castShadow` is compiled into
    // every lit program, so switching it at dusk recompiled the world, while three
    // simply skips a light whose shadow does not auto-update. The frozen map and its
    // matrix stay a matching pair (both are written only by the shadow pass), and the
    // first frame with any strength renders a fresh one before it is sampled.
    //
    // Except before the map exists. A drive that launches at night would otherwise
    // allocate the map and compile every caster's depth program at DAWN, with the player
    // watching; one pass while there is no map puts both under the loading cover.
    const shadow = this.sunLight.shadow;
    shadow.autoUpdate = shadowStrength > 0 || shadow.map === null;
    this.sunLight.target.position.copy(this._targetPos);
    this.sunLight.target.updateMatrixWorld();
  }

  /**
   * The dome's weather uniforms: deck, halo and sun dogs, rainbow, lightning.
   * Geometry is worked out here once a frame so the fragment shader only compares.
   */
  private updateWeatherOptics(sun: THREE.Vector3): void {
    const w = weather;
    this.uStorm.value = w.cloud;
    this.uDomeFlat.value = Math.min(0.97, w.dust * 0.97 + w.haze * 0.55 + w.rain * 0.35 + w.front ** 8 * 0.55);
    this.uHalo.value = w.halo;
    if (w.halo > 0) {
      // Sun dogs sit at the sun's own elevation, on a circle that widens off the
      // 22-degree ring as the sun climbs (about 1 degree at 20, 4 at 40).
      const h = Math.asin(Math.min(1, Math.max(-1, sun.y)));
      const sep = HALO_RADIUS + 0.2 * h * h;
      const ch = Math.cos(h);
      const cosDa = Math.min(1, Math.max(-1, (Math.cos(sep) - sun.y * sun.y) / Math.max(1e-4, ch * ch)));
      const da = Math.acos(cosDa);
      const az = Math.atan2(sun.x, sun.z);
      for (const [dog, out, sign] of [
        [this.uDogA, this.uDogAOut, 1],
        [this.uDogB, this.uDogBOut, -1],
      ] as const) {
        const a = az + sign * da;
        dog.set(Math.sin(a) * ch, sun.y, Math.cos(a) * ch);
        out.set(Math.cos(a) * sign, 0, -Math.sin(a) * sign);
      }
    }
    // A rainbow wants rain in the air, the sun out, and the sun below 42 degrees.
    const sunOut = 1 - smoothstep(0.35, 0.85, w.cloud);
    this.uRainbow.value =
      smoothstep(0.01, 0.12, w.rain) * sunOut * smoothstep(0.02, 0.1, sun.y) *
      (1 - smoothstep(0.62, 0.72, sun.y)) * (1 - w.dust);
    this.uFlash.value = w.flash;
    this.uBoltAz.value = w.boltAzimuth;
    // A cloud base about 2.5 km up, seen from the stroke's distance.
    this.uBoltTop.value = Math.atan2(2500, w.boltDistance);
    this.uBoltSeed.value = w.boltSeed;
  }

  /** The sun's display colour as the dome draws it this frame. Live — do not retain. */
  get sunColor(): THREE.Color {
    return this._sunColor;
  }

  /** The horizon band (and fog) colour this frame. Live — do not retain. */
  get horizonColor(): THREE.Color {
    return this._horizon;
  }

  /** The dust storm's FogExp2 density, per metre: all the scene fog carries. */
  get dustFogDensity(): number {
    return this.dustFog;
  }

  /**
   * Snaps `_targetPos` to the shadow map's texel grid, in the plane perpendicular
   * to `_shadowDir` — the two axes the shadow camera actually samples. See the call
   * site in `update()` for why: this is what stops an indoor shadow boundary from
   * swimming as the camera it is centred on moves continuously.
   */
  private stabilizeShadowTarget(): void {
    const reference = Math.abs(this._shadowDir.y) > 0.999 ? WORLD_UP_FALLBACK : WORLD_UP;
    this._shadowRight.crossVectors(reference, this._shadowDir).normalize();
    this._shadowUp.crossVectors(this._shadowDir, this._shadowRight).normalize();

    const texel = (2 * GRAPHICS_CONFIG.shadowFrustumHalfSize) / GRAPHICS_CONFIG.shadowMapSize;
    const right = this._targetPos.dot(this._shadowRight);
    const up = this._targetPos.dot(this._shadowUp);
    const snappedRight = Math.round(right / texel) * texel;
    const snappedUp = Math.round(up / texel) * texel;
    this._targetPos
      .addScaledVector(this._shadowRight, snappedRight - right)
      .addScaledVector(this._shadowUp, snappedUp - up);
  }

  /**
   * Bakes the reflection probe once. Its intensity follows the analytic light budget
   * every frame above; rebuilding the cubemap cannot add useful detail worth a hitch.
   */
  private refreshEnvironment(): void {
    if (this.envTarget !== null) return;
    this.envTarget = this.pmrem.fromScene(
      this.envScene,
      0,
      1,
      DOME_RADIUS * 2,
      { size: 128 },
    );
    this.scene.environment = this.envTarget.texture;
    this.didBakeEnvironment = true;
  }

  /** Applies the rendering tier to the catalogue star depth. */
  setQuality(quality: GraphicsQuality, mobilePresentation?: boolean): void {
    this.starField.setQuality(quality, mobilePresentation);
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
    return 1 - this.seeingLight * 0.995;
  }

  /**
   * How much daylight there is to SEE by, 0..1: the day factor with the weather's
   * gloom taken off. A haboob or a storm deck is dusk at noon, so beams read again
   * and drivers switch their lamps on (world/traffic.ts reads this).
   */
  get seeingLight(): number {
    const gloom = Math.min(1, weather.dust * 0.9 + weather.cloud * 0.45 + weather.haze * 0.15);
    return this.dayFactor * (1 - gloom * 0.8);
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
