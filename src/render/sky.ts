import * as THREE from 'three';
import { DAY_LENGTH } from '../game/state';
import { skyGradientAt } from '../world/gradient';
import { hash01 } from '../core/rng';

/**
 * Analytic sky: an inverted sphere with a custom ShaderMaterial, a single
 * shadow-casting sun (dim cool moon by night), deterministic hash-seeded stars,
 * a galactic band and an anachronistic aurora that only exists late in the run.
 *
 * Everything drifts with `s` through `skyGradientAt`: the change is slow enough
 * that a player doubts the sky ever looked different, but km 900 is unmistakably
 * not km 9.
 *
 * The dome shader runs the same tone-mapping + colour-space pipeline as the rest
 * of the scene, so its horizon colour and the `FogExp2` colour (also linear,
 * also tone-mapped by the standard material path) coincide exactly: distant
 * terrain dissolves into the sky instead of a grey band.
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
/**
 * Stars sit just inside the dome so they layer over the gradient, not behind it.
 *
 * These radii are for LAYOUT ONLY and say nothing about occlusion: both the star
 * shader and the aurora shader pin their depth to the far plane (gl_Position.z = w),
 * because the drawn terrain reaches far past this shell on the longer view-distance
 * tiers. See the note in STAR_VERTEX.
 */
const STAR_RADIUS = DOME_RADIUS * 0.93;
/** Aurora curtains live in front of the stars, well inside the dome. */
const AURORA_DISTANCE = 800;
/** Offset of the directional light along its direction; brackets the shadow frustum. */
const SUN_DISTANCE = 240;

/** Sun elevation (radians) below this counts as night for headlight/lamp logic. */
const NIGHT_ELEVATION = -0.08;

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

/**
 * The sun's great circle is tilted this far off the east-west vertical plane, so
 * the noon sun sits south of the zenith rather than dead overhead — northern
 * hemisphere long-shadow feel, and it keeps the light from pointing straight down.
 */
const SOUTH_TILT = 0.45;

/** Matches renderer.ts's starting density; the gradient's haze multiplies it. */
const BASE_FOG_DENSITY = 0.00035;

/**
 * 14k stars: still one draw call and still a dense field, thinned back from 20k
 * because at that count the sky was closer to a texture than to a sky.
 */
const STAR_COUNT = 14000;
/**
 * Star size: min, max, and how sharply size is weighted toward the small end.
 *
 * The knee this replaces only capped the top of the range, it did not make the top
 * RARE — measured on the built buffer, 24% of stars still landed in the largest
 * bucket, because brightness itself is only squared and 31% of the field sits above
 * the knee. So the map is convex instead: size = min + range · b^exponent, which
 * leaves the great majority of stars near the floor and thins the tail properly.
 *
 * At exponent 2.5 the field comes out ~1.2 px for a typical star, ~6% above 2.3 px,
 * and a hard maximum of 2.6 px — down from 3.65 px originally and 2.96 px at the
 * knee. A big star is now something to notice rather than the texture of the sky.
 */
const STAR_SIZE_MIN = 1.15;
const STAR_SIZE_MAX = 2.6;
const STAR_SIZE_EXPONENT = 2.5;
/** Seed for the star field. Fixed so the sky is identical every session. */
const STAR_SEED = 0x5ca11ab1;
/**
 * Fraction of stars that get a real colour instead of white. Kept this low
 * deliberately: a night sky reads as white, and a coloured star is meant to be a
 * find. Split red / yellow / green inside the branch below.
 */
const STAR_TINTED_FRACTION = 0.01;
/** Fraction of stars that scintillate at all; the rest are rock steady. */
const STAR_TWINKLE_FRACTION = 0.3;
/**
 * Scintillation amplitude range, as a fraction of the star's own brightness.
 *
 * These were 0.10-0.34 and the effect was invisible. Three things were wrong at
 * once and all three are worth recording, because each on its own looks harmless:
 *
 *  - the amplitude scaled by nearness to the HORIZON, which is physically right and
 *    exactly wrong here: looking straight up is how anyone examines a star field,
 *    and at the zenith the factor is ~0, so the part of the sky under scrutiny had
 *    no twinkle at all. It now keeps STAR_TWINKLE_ZENITH_FLOOR of its amplitude
 *    overhead and still shimmers hardest low down.
 *  - the amplitude itself was too small to see: a typical twinkler is a faint star
 *    at alpha ~0.35, and ±0.16 of that is a fraction of one dim pixel.
 *  - the two sines ran at 0.37 and 0.59 Hz, slow enough to read as "steady" rather
 *    than as a shimmer. Real scintillation is a few hertz.
 */
const STAR_TWINKLE_MIN = 0.35;
const STAR_TWINKLE_MAX = 0.75;
/** Amplitude kept at the zenith, where there is least air to twinkle through. */
const STAR_TWINKLE_ZENITH_FLOOR = 0.45;
/**
 * The galactic plane is deliberately NOT thinned with the field: the band is what
 * makes the sky look like a galaxy seen edge-on, and it reads as dust rather than
 * as stars. Leaving it dense while the field came down 30% lets it stand out more.
 */
const BAND_CANDIDATES = 45000;
/** Half-width of the band in `dot(dir, normal)` space (~7.5 degrees). */
const BAND_HALF_WIDTH = 0.13;

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

/**
 * Seed for mood selection. Fixed for the same reason STAR_SEED is: the sky must be
 * reproducible, so reloading into a sunrise gives you back the sunrise you saved in.
 */
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

  // Sun disc plus a broad additive glow (a Rayleigh-ish halo that reads as
  // atmospheric scatter without pulling in a full scattering model).
  float disc = smoothstep(0.99925, 0.99975, sd);
  float glow = pow(max(sd, 0.0), 6.0) * 0.45 + pow(max(sd, 0.0), 48.0) * 1.5;
  col += uSunColor * disc * 2.0;
  col += uSunGlowColor * glow * uSunGlowIntensity;

  // Moon: a dim cool disc opposite the sun, faded in only at night.
  float md = dot(dir, uMoonDir);
  float mdisc = smoothstep(0.99955, 0.99985, md);
  col += vec3(0.66, 0.74, 0.94) * mdisc * uMoonAmount * 0.6;

  gl_FragColor = vec4(col, 1.0);

  // Match the scene's ACES + sRGB output exactly, so this horizon colour and
  // the fog colour (set from the same linear value) are pixel-identical.
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
 * Sun-elevation change, radians, that forces an environment rebake. A bake is a
 * cubemap render plus the roughness convolution — far too costly per frame — and
 * the dome's appearance is a function of sun elevation alone, so stepping the
 * probe gives ~70 bakes across a full day/night cycle with no visible stepping
 * in the reflections.
 */
const ENV_BAKE_STEP = 0.03;

/** Shared by the star field and the galactic band (band passes uDens01 = 1). */
const STAR_VERTEX = /* glsl */ `
attribute float aSize;
attribute float aBright;
attribute float aThresh;
attribute vec3 aColor;
attribute float aTwinkle;
attribute float aPhase;
uniform float uPixelRatio;
uniform float uTime;
varying float vBright;
varying float vThresh;
varying vec3 vColor;
varying float vTwinkle;
varying float vAlt;

void main() {
  vColor = aColor;
  vBright = aBright;
  vThresh = aThresh;
  // Altitude above the horizon, 0 at the horizon and 1 at the zenith. The dome is
  // only ever translated to the camera (never rotated), so the star's own
  // direction IS its altitude and no matrix is needed.
  vAlt = normalize(position).y;

  // Scintillation, in ALPHA only. Two incommensurate sines at a few hertz, so it
  // shimmers rather than pulses and never settles into a visible loop.
  //
  // It used to modulate gl_PointSize too, on the reasoning that a bright star's
  // core is clipped at full alpha and size was the only channel left. That was the
  // wrong channel: point size rasterises to WHOLE pixels, and these stars are
  // 1.2-2.6 px, so an oscillating size renders as the same single pixel and then
  // jumps a whole one. It read as a dropped frame rather than as a shimmer. Alpha
  // is continuous at any size, so all of the effect lives there; on a clipped star
  // only the dimming half shows, which is still a smooth shimmer.
  float ph = aPhase * 6.2831853;
  float shimmer = 0.62 * sin(uTime * 7.00 + ph) + 0.38 * sin(uTime * 11.00 + ph * 1.7);
  vTwinkle = 1.0 + aTwinkle * shimmer;

  gl_PointSize = aSize * uPixelRatio;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  // Pin the star to the FAR PLANE in depth, whatever its geometric radius is.
  //
  // The shell sits at STAR_RADIUS (2.79 km). The drawn terrain does not: the vista
  // disc reaches the view-distance setting, which is 8 km on the far tier and 25 km
  // on the vast one. So a mountain 6 km out is genuinely FARTHER than the star
  // shell, wins nothing in the depth test, and the star is drawn on top of the
  // mountain — the reported stars-over-the-far-ranges.
  //
  // Moving the shell out instead does not work. The far plane is only
  // viewDistance + 300 m, so on the vast tier the shell would have ~100 m of room
  // between the terrain and the clip plane, and one depth step out there is ~240 m
  // with a 24-bit buffer and a 0.16 m near plane. The separation would be finer than
  // the depth buffer can represent and the stars would z-fight with the ranges.
  //
  // z = w puts the star at normalised depth 1.0: the cleared depth buffer is also
  // 1.0 and the default LessEqual test passes, so empty sky still shows stars,
  // while ANY geometry that has written depth is in front of them. The dome behind
  // them writes no depth at all, so the sky gradient is unaffected.
  gl_Position.z = gl_Position.w;
}
`;

const STAR_FRAGMENT = /* glsl */ `
uniform float uOpacity;
uniform float uDens01;
/**
 * How bright the sky near the horizon is: 1 through dusk and dawn, 0 once the sky
 * is properly dark. Only the extinction below is scaled by it.
 */
uniform float uTwilight;
varying float vBright;
varying float vThresh;
varying vec3 vColor;
varying float vTwinkle;
varying float vAlt;

void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float mask = smoothstep(1.0, 0.0, dot(c, c));

  // Density fades each star in past its own threshold rather than rebuilding
  // the buffer: at starDensity 1 only the bright ones show, at 4.5 all do.
  float vis = smoothstep(vThresh - 0.08, vThresh + 0.08, uDens01);

  // Horizon extinction, and ONLY while the horizon is bright.
  //
  // A star seen a degree above the horizon is looked at through ~38 airmasses and
  // sits against the brightest part of a twilight sky, so in reality it is not
  // there to be seen. Drawing it anyway also collided with the ink pass: outlines
  // are applied by scaling a pixel's own colour, which is invisible against a dark
  // sky but a clearly drawn ring against a bright one — the reported "some stars
  // near the horizon have outlines". Fading them out where the sky is bright fixes
  // the artefact at its source and is the more honest sky.
  //
  // Deep night is left exactly as authored (stars all the way down to the horizon):
  // uTwilight is 0 there, so this whole term collapses to 1.
  float extinction = mix(1.0, smoothstep(0.0, 0.16, vAlt), uTwilight);

  float a = min(1.0, vBright * vTwinkle * 1.75 * vis * uOpacity * extinction * mask);
  if (a < 0.004) discard;

  gl_FragColor = vec4(vColor, a);
  #include <colorspace_fragment>
}
`;

const AURORA_VERTEX = /* glsl */ `
uniform float uTime;
uniform float uPhase;
varying vec2 vUv;

void main() {
  vUv = uv;
  vec3 p = position;
  // Two incommensurate sines make the curtain drift sideways and breathe,
  // slowly enough that it never loops visibly within a session.
  float w = sin(p.y * 0.020 + uTime * 0.30 + uPhase * 6.2831853)
          + 0.55 * sin(p.y * 0.046 - uTime * 0.19 + uPhase * 3.1415927);
  p.x += w * 16.0;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  // Same depth pin as the stars, and needed harder: the curtains hang at
  // AURORA_DISTANCE (800 m), so without it every range past the first kilometre is
  // painted over by an aurora that is supposed to be behind it.
  gl_Position.z = gl_Position.w;
}
`;

const AURORA_FRAGMENT = /* glsl */ `
uniform float uOpacity;
uniform vec3 uColor;
varying vec2 vUv;

void main() {
  // Vertically-faded: hangs brightest in its lower half, gone at both edges.
  float vertical = smoothstep(0.0, 0.22, vUv.y) * smoothstep(1.0, 0.5, vUv.y);
  float stripe = 0.62 + 0.38 * sin(vUv.x * 22.0 + vUv.y * 9.0);
  float a = vertical * stripe * uOpacity;
  if (a < 0.004) discard;

  gl_FragColor = vec4(uColor, a);
  #include <colorspace_fragment>
}
`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Uniform direction on a Fibonacci sphere. Deterministic, evenly distributed. */
function fibonacciDir(i: number, n: number, out: THREE.Vector3): THREE.Vector3 {
  const y = 1 - (2 * (i + 0.5)) / n;
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  const theta = Math.PI * (1 + Math.sqrt(5)) * i;
  return out.set(Math.cos(theta) * r, y, Math.sin(theta) * r);
}

// ---------------------------------------------------------------------------
// Sky
// ---------------------------------------------------------------------------

export class Sky {
  private readonly scene: THREE.Scene;
  private readonly fog: THREE.FogExp2;

  /** Everything that must track the camera: dome, stars, band, aurora. */
  private readonly root = new THREE.Group();

  private readonly dome: THREE.Mesh;
  private readonly starPoints: THREE.Points;
  private readonly bandPoints: THREE.Points;
  private readonly auroraGroup = new THREE.Group();
  private readonly auroraGeometry: THREE.PlaneGeometry;
  private readonly auroraMaterials: THREE.ShaderMaterial[] = [];
  private readonly auroraUniforms: { uTime: { value: number }; uOpacity: { value: number } }[] = [];

  private readonly sunLight: THREE.DirectionalLight;
  private readonly hemiLight: THREE.HemisphereLight;

  // --- Environment probe: what makes metal read as metal (see refreshEnvironment) ---
  private readonly pmrem: THREE.PMREMGenerator;
  /** Holds one dome, sharing the visible dome's uniforms, shaded in linear space. */
  private readonly envScene = new THREE.Scene();
  private readonly envMaterial: THREE.ShaderMaterial;
  private envTarget: THREE.WebGLRenderTarget | null = null;
  /** Sun elevation the live probe was baked at. NaN forces a bake on frame one. */
  private envBakedElevation = Number.NaN;

  // --- Dome shader uniforms (typed references; mutated in place each frame) ---
  private readonly uSunDir = new THREE.Vector3(0, 1, 0);
  private readonly uMoonDir = new THREE.Vector3(0, -1, 0);
  private readonly uZenith = new THREE.Color();
  private readonly uHorizon = new THREE.Color();
  private readonly uSunColor = new THREE.Color();
  private readonly uSunGlowColor = new THREE.Color();
  private readonly uSunGlowIntensity = { value: 0 };
  private readonly uMoonAmount = { value: 0 };
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

  // --- Star / band uniforms ---
  private readonly uStarOpacity = { value: 0 };
  private readonly uStarDens = { value: 0 };
  private readonly uBandOpacity = { value: 0 };
  /**
   * Twilight weight for the stars' horizon extinction: 1 while the sky near the
   * horizon is still lit, 0 once it is dark. Shared by the field and the band so
   * the two cannot disagree about where the horizon glow ends.
   */
  private readonly uStarTwilight = { value: 0 };
  /**
   * Shared by the star field and the band, so both scintillate on one clock. Wraps
   * well inside float precision; the shimmer is two sines and cannot tell.
   */
  private readonly uStarTime = { value: 0 };

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
  private readonly _dir = new THREE.Vector3();

  private sunElevation = -1.0; // radians; starts below the horizon (night)

  constructor(scene: THREE.Scene, fog: THREE.FogExp2, webgl: THREE.WebGLRenderer) {
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
        uMoonAmount: this.uMoonAmount,
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

    // --- Stars ---
    this.starPoints = this.buildStars();
    this.root.add(this.starPoints);

    // --- Galactic band ---
    this.bandPoints = this.buildBand();
    this.root.add(this.bandPoints);

    // --- Aurora ---
    this.auroraGeometry = new THREE.PlaneGeometry(220, 130, 20, 6);
    this.buildAurora();
    this.auroraGroup.visible = false; // absent until the gradient's aurora > 0
    this.root.add(this.auroraGroup);

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
    shadow.bias = -0.0004;
    shadow.normalBias = 0.05;
    shadow.camera.updateProjectionMatrix();
    scene.add(this.sunLight);
    // The target must be in the scene graph for its matrixWorld to update.
    scene.add(this.sunLight.target);

    // --- Hemisphere bounce ---
    this.hemiLight = new THREE.HemisphereLight(0x88b4e6, 0xd8a45c, 1.0);
    scene.add(this.hemiLight);

    scene.add(this.root);
  }

  /** Deterministic star field: same sky every session, no stream RNG. */
  private buildStars(): THREE.Points {
    const positions = new Float32Array(STAR_COUNT * 3);
    const colors = new Float32Array(STAR_COUNT * 3);
    const sizes = new Float32Array(STAR_COUNT);
    const brights = new Float32Array(STAR_COUNT);
    const thresholds = new Float32Array(STAR_COUNT);
    const twinkles = new Float32Array(STAR_COUNT);
    const phases = new Float32Array(STAR_COUNT);

    for (let i = 0; i < STAR_COUNT; i++) {
      fibonacciDir(i, STAR_COUNT, this._dir);
      // Small jitter breaks the Fibonacci spiral's visible seam.
      this._dir.x += (hash01(STAR_SEED, i, 0) - 0.5) * 0.03;
      this._dir.y += (hash01(STAR_SEED, i, 1) - 0.5) * 0.03;
      this._dir.z += (hash01(STAR_SEED, i, 2) - 0.5) * 0.03;
      this._dir.normalize();

      positions[i * 3] = this._dir.x * STAR_RADIUS;
      positions[i * 3 + 1] = this._dir.y * STAR_RADIUS;
      positions[i * 3 + 2] = this._dir.z * STAR_RADIUS;

      // Power-weighted brightness: a few dominant stars over many faint ones.
      const b = Math.pow(hash01(STAR_SEED, i, 3), 2.0) * 0.85 + 0.15;
      brights[i] = b;
      // Bright stars appear at low density; faint ones fill in as it rises.
      thresholds[i] = 1.0 - b;
      sizes[i] =
        STAR_SIZE_MIN + (STAR_SIZE_MAX - STAR_SIZE_MIN) * Math.pow(b, STAR_SIZE_EXPONENT);

      // Colour. Almost every star is white with only a hint of blue in it — the
      // eye reads a night sky as white, and the previous split (28% of the field
      // strongly warm or strongly blue) made it read as confetti. The hint varies
      // per star so the field is not one flat colour.
      const t = hash01(STAR_SEED, i, 4);
      if (t < 1 - STAR_TINTED_FRACTION) {
        const blue = hash01(STAR_SEED, i, 7);
        colors[i * 3] = 0.94 + blue * 0.05;
        colors[i * 3 + 1] = 0.96 + blue * 0.035;
        colors[i * 3 + 2] = 1.0;
      } else {
        // The rare ones, and they are rare on purpose: a red supergiant or a
        // yellow giant is a landmark you learn the sky by, not a texture.
        const pick = (t - (1 - STAR_TINTED_FRACTION)) / STAR_TINTED_FRACTION;
        if (pick < 0.4) {
          colors[i * 3] = 1.0; colors[i * 3 + 1] = 0.55; colors[i * 3 + 2] = 0.42;
        } else if (pick < 0.8) {
          colors[i * 3] = 1.0; colors[i * 3 + 1] = 0.84; colors[i * 3 + 2] = 0.52;
        } else {
          colors[i * 3] = 0.66; colors[i * 3 + 1] = 1.0; colors[i * 3 + 2] = 0.74;
        }
      }

      // Scintillation is atmospheric, so it belongs to stars seen through the most
      // air — but never to the point of vanishing overhead, which is where anyone
      // examining the sky is actually looking. Only a minority twinkle at all; the
      // rest are rock steady, and that contrast is what makes the movers read.
      const horizon = 1 - Math.abs(this._dir.y);
      const air = STAR_TWINKLE_ZENITH_FLOOR + (1 - STAR_TWINKLE_ZENITH_FLOOR) * horizon;
      twinkles[i] =
        hash01(STAR_SEED, i, 5) < STAR_TWINKLE_FRACTION
          ? (STAR_TWINKLE_MIN +
              (STAR_TWINKLE_MAX - STAR_TWINKLE_MIN) * hash01(STAR_SEED, i, 8)) *
            air
          : 0;
      phases[i] = hash01(STAR_SEED, i, 6);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('aBright', new THREE.BufferAttribute(brights, 1));
    geometry.setAttribute('aThresh', new THREE.BufferAttribute(thresholds, 1));
    geometry.setAttribute('aTwinkle', new THREE.BufferAttribute(twinkles, 1));
    geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));

    const material = new THREE.ShaderMaterial({
      vertexShader: STAR_VERTEX,
      fragmentShader: STAR_FRAGMENT,
      uniforms: {
        uOpacity: this.uStarOpacity,
        uDens01: this.uStarDens,
        uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
        uTime: this.uStarTime,
        uTwilight: this.uStarTwilight,
      },
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    });

    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    return points;
  }

  /** Faint additive band of denser points for the galactic plane. */
  private buildBand(): THREE.Points {
    const normal = new THREE.Vector3(0.42, 0.78, 0.46).normalize();
    const kept: number[] = [];
    for (let i = 0; i < BAND_CANDIDATES; i++) {
      fibonacciDir(i, BAND_CANDIDATES, this._dir);
      const d = this._dir.x * normal.x + this._dir.y * normal.y + this._dir.z * normal.z;
      if (Math.abs(d) < BAND_HALF_WIDTH) kept.push(this._dir.x, this._dir.y, this._dir.z);
    }

    const count = kept.length / 3;
    const positions = new Float32Array(kept.length);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const brights = new Float32Array(count);
    const thresholds = new Float32Array(count);
    const twinkles = new Float32Array(count);
    const phases = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      const dx = kept[i * 3], dy = kept[i * 3 + 1], dz = kept[i * 3 + 2];
      positions[i * 3] = dx * STAR_RADIUS;
      positions[i * 3 + 1] = dy * STAR_RADIUS;
      positions[i * 3 + 2] = dz * STAR_RADIUS;

      brights[i] = 0.18 + hash01(STAR_SEED, 0x1, i) * 0.32;
      thresholds[i] = 0; // always shown while the band's opacity is non-zero
      sizes[i] = 1.0 + hash01(STAR_SEED, 0x2, i) * 1.2;
      // Faint blue-white dust with a little warmth mixed in.
      colors[i * 3] = 0.7 + hash01(STAR_SEED, 0x3, i) * 0.15;
      colors[i * 3 + 1] = 0.78 + hash01(STAR_SEED, 0x4, i) * 0.12;
      colors[i * 3 + 2] = 1.0;
      // The band shares the star shader, so it must carry the same attributes.
      // A gentle shimmer on a third of the dust makes the plane look grainy and
      // alive rather than printed on.
      twinkles[i] = hash01(STAR_SEED, 0x5, i) < 0.33 ? 0.12 : 0;
      phases[i] = hash01(STAR_SEED, 0x6, i);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('aBright', new THREE.BufferAttribute(brights, 1));
    geometry.setAttribute('aThresh', new THREE.BufferAttribute(thresholds, 1));
    geometry.setAttribute('aTwinkle', new THREE.BufferAttribute(twinkles, 1));
    geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));

    const material = new THREE.ShaderMaterial({
      vertexShader: STAR_VERTEX,
      fragmentShader: STAR_FRAGMENT,
      uniforms: {
        uOpacity: this.uBandOpacity,
        uDens01: { value: 1 },
        uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
        uTime: this.uStarTime,
        uTwilight: this.uStarTwilight,
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });

    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    return points;
  }

  /** A few large additive curtain quads. Shared geometry; one material each so phases differ. */
  private buildAurora(): void {
    const palette = [
      new THREE.Color().setStyle('#35ffa8'),
      new THREE.Color().setStyle('#3dff9a'),
      new THREE.Color().setStyle('#55e0ff'),
      new THREE.Color().setStyle('#7a7dff'),
      new THREE.Color().setStyle('#3dffb0'),
    ];
    const count = palette.length;

    for (let k = 0; k < count; k++) {
      const uniforms = {
        uTime: { value: 0 },
        uOpacity: { value: 0 },
        uPhase: { value: k / count },
        uColor: { value: palette[k] },
      };
      const material = new THREE.ShaderMaterial({
        vertexShader: AURORA_VERTEX,
        fragmentShader: AURORA_FRAGMENT,
        uniforms,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        toneMapped: false,
      });

      const mesh = new THREE.Mesh(this.auroraGeometry, material);

      // Spread curtains in an arc across the sky, alternating elevation.
      const az = -1.1 + (k / (count - 1)) * 2.2;
      const el = 0.5 + (k % 2) * 0.22;
      const cosEl = Math.cos(el);
      mesh.position.set(
        AURORA_DISTANCE * Math.sin(az) * cosEl,
        AURORA_DISTANCE * Math.sin(el),
        AURORA_DISTANCE * Math.cos(az) * cosEl,
      );
      // Plane normal (+Z) points back toward the camera at the origin.
      mesh.rotation.y = az + Math.PI;

      this.auroraGroup.add(mesh);
      this.auroraMaterials.push(material);
      this.auroraUniforms.push(uniforms);
    }
  }

  update(
    timeOfDay: number,
    dayIndex: number,
    s: number,
    cameraX: number,
    cameraY: number,
    cameraZ: number,
  ): void {
    const g = skyGradientAt(s);

    const dayFrac = (((timeOfDay % DAY_LENGTH) + DAY_LENGTH) % DAY_LENGTH) / DAY_LENGTH;
    const phase = (dayFrac - 0.25) * Math.PI * 2;
    const eastWest = Math.cos(phase);
    const upDown = Math.sin(phase);

    // Toward-sun direction on the tilted great circle (unit by construction).
    this._sunDir.set(
      eastWest,
      upDown * Math.cos(SOUTH_TILT),
      -upDown * Math.sin(SOUTH_TILT),
    );
    this.sunElevation = Math.asin(this._sunDir.y);

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
    this._sunGlow.copy(this._moodGlow);
    const sunGlowIntensity =
      sunset * (0.9 + 1.6 * g.dust) * moodGlowScale +
      smoothstep(0.0, 0.6, this.sunElevation) * 0.22;

    // --- Fog tracks the horizon so distant terrain melts into the sky ---
    this.fog.color.copy(this._horizon);
    this.fog.density = BASE_FOG_DENSITY * g.haze;

    // --- Dome uniforms ---
    this.uSunDir.copy(this._sunDir);
    this.uMoonDir.set(-this._sunDir.x, -this._sunDir.y, -this._sunDir.z);
    this.uZenith.copy(this._zenith);
    this.uHorizon.copy(this._horizon);
    this.uSunColor.copy(this._sunColor);
    this.uSunGlowColor.copy(this._sunGlow);
    this.uSunGlowIntensity.value = sunGlowIntensity;
    this.uMoonAmount.value = night;
    // Peaks at |elevation| 0 — the sun on the horizon, when the glow is entirely
    // one-sided — and gone by ~31 degrees up or down.
    this.uAntiSolar.value = 1 - smoothstep(0, 0.55, Math.abs(this.sunElevation));

    // --- Cirrus deck ---
    // Cover comes from the sky gradient (weather, on a 400 km cycle). Visibility is
    // held through dusk — a lit deck at sunset is the best the sky ever looks — and
    // gone by the time `night` reaches 1, past nautical dusk, because the dome cannot
    // occlude a star.
    this.uCloudCover.value = g.cloudCover;
    this.uCloudAmount.value = 1 - night;
    this.uCloudTime.value = (performance.now() * 0.001) % 3600;

    // --- Stars & band ---
    // Stars remain through dusk and down to the horizon. The base desert has a
    // dense field; distance from civilisation fills the remaining faint stars.
    const starFade = smoothstep(0.35, -0.05, this.sunElevation);
    this.uStarOpacity.value = starFade;
    this.uStarDens.value = Math.min(1, 0.45 + Math.max(0, (g.starDensity - 1) / 6.5));
    this.uBandOpacity.value = starFade * g.galaxy;
    this.uStarTime.value = (performance.now() * 0.001) % 3600;
    // Bright horizon: fully on from sunset until the sky has properly darkened
    // (-0.30 rad is a shade past nautical dusk), off through the night. This is the
    // window in which a star drawn at the horizon reads as an artefact rather than
    // as a star — see the extinction note in STAR_FRAGMENT.
    this.uStarTwilight.value = smoothstep(-0.3, -0.1, this.sunElevation);

    // --- Aurora (skip the draw entirely when the gradient is zero) ---
    const auroraVisible = g.aurora > 0.001;
    this.auroraGroup.visible = auroraVisible;
    if (auroraVisible) {
      // Weighted toward night so it reads as a sky phenomenon, but never fully
      // absent once the gradient turns it on — an aurora over a desert.
      const opacity = g.aurora * (0.3 + 0.7 * starFade);
      const time = (performance.now() * 0.001) % 1000;
      for (let k = 0; k < this.auroraUniforms.length; k++) {
        this.auroraUniforms[k].uOpacity.value = opacity;
        this.auroraUniforms[k].uTime.value = time;
      }
    }

    // --- Lights: sun by day, dim cool moon (opposite) by night ---
    if (this.sunElevation >= 0) {
      this._lightDir.copy(this._sunDir);
      this._lightColor.copy(this._sunColor);
      this.sunLight.intensity = smoothstep(-0.06, 0.30, this.sunElevation) * 3.0;
    } else {
      this._lightDir.copy(this._sunDir).negate();
      this._lightColor.copy(C_MOON);
      this.sunLight.intensity = smoothstep(0.0, 0.45, -this.sunElevation) * 0.18;
    }
    this.sunLight.color.copy(this._lightColor);

    // Hemisphere bounce: sky tint above, warm sand below. Halved against the
    // pre-probe value because `scene.environment` now supplies real sky
    // irradiance to every standard material — running both at full strength
    // double-counts the ambient and flattens exactly the shading the probe was
    // added to recover. The hemisphere still earns its place: it keeps the warm
    // ground bounce on downward faces that a sky-only probe under-lights, and it
    // is what stops shadowed panels going to a dead flat tone.
    this._hemiSky.copy(C_DAY_ZENITH)
      .offsetHSL(g.skyHueShift * 0.5, 0.02, 0.0)
      .lerp(C_DAY_HORIZON, 0.4)
      .lerp(C_NIGHT_ZENITH, night);
    this._hemiGround.copy(C_GROUND).lerp(C_NIGHT_GROUND, night);
    this.hemiLight.color.copy(this._hemiSky);
    this.hemiLight.groundColor.copy(this._hemiGround);
    this.hemiLight.intensity = 0.04 + 1.15 * day;

    this.refreshEnvironment();

    // --- Reposition the sky with the camera ---
    //
    // The origin makes every scene-graph position RELATIVE, and the camera is no
    // exception: `cameraX/Y/Z` here are the relative eye straight off
    // `renderer.camera.position`. The sky must stay relative too, so the root, the
    // sun light and its shadow target below are all written with those same relative
    // coordinates and nothing in this block adds or subtracts the origin. The stars
    // and the aurora are children of `root` positioned as direction × radius about
    // its local origin (buildStars/buildBand/buildAurora), so they are camera-relative
    // by construction and must never be rebased or re-anchored. `skyGradientAt(s)`
    // takes an arclength, immune to the origin, and is deliberately left alone.
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
    this.sunLight.shadow.intensity = smoothstep(0, SHADOW_FADE_ELEVATION, Math.abs(this.sunElevation));
    this.sunLight.target.position.copy(this._targetPos);
    this.sunLight.target.updateMatrixWorld();
  }

  /**
   * Rebake the environment probe when the sun has moved enough to matter.
   *
   * This is the single reason painted metal reads as metal. A
   * MeshStandardMaterial takes almost all of a metal's response from *indirect
   * specular*, which is sampled from `scene.environment`; with no probe, a
   * metalness-0.55 body panel loses ~45% of its diffuse to the metal term and
   * gets nothing back, leaving only the sun's narrow specular lobe. That is the
   * flat, dead look — and it means raising `metalness` without a probe makes
   * panels worse, not shinier.
   *
   * Baking the game's own dome rather than importing an HDRI keeps the
   * reflection locked to the current sky (sunset paint goes orange for free) and
   * keeps the project asset-free, which is the same constraint the procedural
   * meshes are built under.
   */
  private refreshEnvironment(): void {
    if (Math.abs(this.sunElevation - this.envBakedElevation) < ENV_BAKE_STEP) return;
    this.envBakedElevation = this.sunElevation;

    const previous = this.envTarget;
    // near/far must bracket the dome; it is the only thing in the probe scene.
    this.envTarget = this.pmrem.fromScene(this.envScene, 0, 1, DOME_RADIUS * 2);
    this.scene.environment = this.envTarget.texture;
    // fromScene allocates a fresh target per call, so the day cycle leaks a
    // cubemap per bake unless the previous one is released here.
    if (previous !== null) previous.dispose();
  }

  /** Unit vector pointing toward the sun. Live internal vector — do not retain across frames. */
  get sunDirection(): { x: number; y: number; z: number } {
    return this._sunDir;
  }

  get isNight(): boolean {
    return this.sunElevation < NIGHT_ELEVATION;
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


  dispose(): void {
    this.scene.remove(this.root);
    this.scene.remove(this.sunLight);
    this.scene.remove(this.sunLight.target);
    this.scene.remove(this.hemiLight);

    this.dome.geometry.dispose();
    (this.dome.material as THREE.ShaderMaterial).dispose();

    this.starPoints.geometry.dispose();
    (this.starPoints.material as THREE.ShaderMaterial).dispose();
    this.bandPoints.geometry.dispose();
    (this.bandPoints.material as THREE.ShaderMaterial).dispose();

    this.auroraGeometry.dispose();
    for (const m of this.auroraMaterials) m.dispose();

    this.scene.environment = null;
    this.envMaterial.dispose();
    if (this.envTarget !== null) this.envTarget.dispose();
    this.pmrem.dispose();
  }
}
