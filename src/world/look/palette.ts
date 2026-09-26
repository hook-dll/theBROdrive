/**
 * THE LOOK'S TABLE: the air, the light and the clouds for every hour, weather and
 * season, as pure data.
 *
 * slowroads carries 32 hand-authored cells (4 seasons x 4 times x 2 weathers) and
 * snaps between them, because its sun never moves: its four "times" are four skies,
 * not four moments of one. We have a real sun path and a real calendar, so this table
 * has to interpolate, and its three axes are built to make that possible without
 * inventing weights for 32 cells:
 *
 *  - TIME is six authored rows — night, dawn, dusk, morning, evening, day — placed at
 *    fixed SUN ELEVATIONS (`STOP_ELEVATION_DEG`) and mixed by the sun's height.
 *    Dawn and dusk are separate rows because a Russian morning is pink and hazy and a
 *    Russian evening is amber and flat, and because the sun's own azimuth says which
 *    is happening (the sine of the azimuth is +1 at sunrise and -1 at sunset).
 *  - WEATHER is a modulation, not a second table (`applyWeather`): overcast greys the
 *    air, cuts the key, raises the fill, sinks the noisy haze into the hilltops and
 *    closes the cloud deck; rain darkens the deck and pushes the air in; a fog spell
 *    brings everything pale and low. All three interpolate on the weather channels for
 *    free, so a half-overcast sky — the common case — is one continuous answer rather
 *    than a cross-fade between two authored extremes.
 *  - SEASON is the same trick on the season channels (world/season.ts, `turn` /
 *    `fresh` / `snow`): the ground and foliage colours and a tint on the air, so the
 *    two-month fade of a real autumn is the channel's own shape.
 *
 * TWO COLOUR CONVENTIONS, and the difference matters:
 *
 *  - `air()` is what the player SEES. The frame reaches the display without a transfer
 *    curve — the scene pass writes linear light into an sRGB target and the post pass
 *    copies the texels through, so a value written here is the sRGB number that lands
 *    on screen. That is what lets these numbers be checked against a reference
 *    screenshot pixel by pixel, and it is why the air colours below read as ordinary
 *    sky colours (the sun's own light and the ground's reflectance are the other
 *    convention).
 *  - `surface()` is LINEAR light: a reflectance, or a light's colour, which is
 *    multiplied by other linear quantities (an albedo, an intensity) inside the
 *    shaders. Light and ground colours use it.
 *
 * Values are seeded from the slowroads cells in `docs/slowroads-steam/notes/SrSkyLight.md`
 * as relative guidance and then tuned against our own frames.
 *
 * Pure data and pure arithmetic: no three.js, no allocation per frame.
 */

import type { SeasonState } from '../season';

/** A colour triple. */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Everything the table reads about the moment being drawn. */
export interface LookState {
  /** Sun altitude, radians; negative below the horizon. */
  readonly sunElevation: number;
  /** Sun azimuth, radians clockwise from north. Decides morning from evening. */
  readonly sunAzimuth: number;
  /** Weather channels (world/weather.ts), each 0..1. */
  readonly overcast: number;
  readonly precip: number;
  readonly fog: number;
  /** Season channels (world/season.ts). */
  readonly season: SeasonState;
}

/**
 * The table's output: what this frame's air, light, clouds and ground want to be.
 *
 * Everything here is used by stage 1 except the last six fields, which are the
 * ground's and the trees' colours: they belong to stages 2-4, and they live here
 * because this is where a colour that changes with the season is decided.
 */
export interface LookPalette {
  /** Fog: A the horizon, B the zenith, C the haze tint (render/look/fog.ts). */
  fogA: Rgb;
  fogB: Rgb;
  fogC: Rgb;
  /** Where the fog starts, as a share of the far plane: 0.9 clear noon, 0.02 in fog. */
  fogNear: number;
  /**
   * How far this air lets you see, metres.
   *
   * The fog's own scale, and the one number a fog spell really changes: the ramp's far
   * plane is the presentation's draw distance on a clear day, but 25 km of it is not a
   * fog, and no amount of `fogNear` turns one into the other — the curve is
   * `1 - exp(-(d/far)²)`, so what sets the visibility is the far plane itself. Weather
   * brings it in; clear air leaves it beyond anything the camera draws.
   */
  visibilityM: number;
  /** Noisy fog height, metres: positive pools mist in the valleys, negative is a deck. */
  hazeHeight: number;
  hazeIntensity: number;
  /** The key light: the sun by day, the Moon by night (astronomy picks the direction). */
  sunColor: Rgb;
  sunIntensity: number;
  /** Flat fill, and the sky and ground hemispheres over it. */
  ambientColor: Rgb;
  ambientIntensity: number;
  hemiSky: Rgb;
  hemiGround: Rgb;
  hemiIntensity: number;
  /**
   * The fill's own intensity once the sun is gone, in `hemiIntensity`'s units: the night
   * sky is the only light there is, so its floor is absolute rather than photometric.
   */
  nightFill: number;
  /** World shading (render/look/lighting.ts): grazing sheen, sunlit boost, baked shade. */
  fresnel: number;
  radiance: number;
  shadowFactor: number;
  /** The cloud plane (render/clouds.ts). */
  cloudHighlight: Rgb;
  cloudLowlight: Rgb;
  cloudCover: number;
  /** How dark the deck's own shading goes: 0 a bright fair-weather sky, 1 a storm. */
  cloudDark: number;
  /** Ground and foliage (stages 2-4, carried from the first frame). */
  grassA: Rgb;
  grassB: Rgb;
  peakA: Rgb;
  peakB: Rgb;
  fieldTint: Rgb;
  treeTint: Rgb;
  /**
   * THE GROUND'S LAYER TINTS (stage 2, render/look/groundmaterial.ts). Linear light.
   *
   * Every one of them MULTIPLIES a greyscale or a photographed albedo — `soil.webp`,
   * `peat.webp`, the forest floor of the season — so white leaves the photograph as it
   * was taken and a tint only moves it with the season. That is the whole reason the
   * ground is a stack of photographs with one shared colour function on top instead of
   * a season repaint per texture: the palette says how October differs from July, and
   * the four ground colours say what a field of grass is at all.
   */
  groundSoil: Rgb;
  groundStubble: Rgb;
  groundPeat: Rgb;
  groundSilt: Rgb;
  groundGravel: Rgb;
  groundRock: Rgb;
  groundMud: Rgb;
  groundForest: Rgb;
  /**
   * The seven crop tints, three floats each, in `landcover.ts`'s `Crop` order. A
   * standing crop has no photograph of its own: it is the grass tile's luminance under
   * a colour of its own, which is exactly how the meadow is built and why a field of
   * rye reads at four hundred metres.
   */
  groundCrops: Float32Array;
  /**
   * WHICH TWO FOREST-FLOOR PHOTOGRAPHS ARE IN PLAY, and how far between them: 0 spring,
   * 1 summer, 2 autumn, 3 winter, with `groundForestMix` the weight of the second.
   *
   * The floor is four photographs and the season is one continuous channel, so in
   * principle three or four of them can be partly present. Sampling four to blend them
   * costs three fetches a fragment for a difference nobody can see, so the palette names
   * the two heaviest and the shader fetches exactly those; the material binds the two
   * samplers once a frame from these numbers. On a settled season both are the same
   * photograph and the shader skips the second fetch altogether.
   */
  groundForestA: number;
  groundForestB: number;
  groundForestMix: number;
}

const colour = (): Rgb => ({ r: 0, g: 0, b: 0 });

export function newLookPalette(): LookPalette {
  return {
    fogA: colour(),
    fogB: colour(),
    fogC: colour(),
    fogNear: 0.9,
    visibilityM: 30000,
    hazeHeight: 0,
    hazeIntensity: 0,
    sunColor: colour(),
    sunIntensity: 1,
    ambientColor: colour(),
    ambientIntensity: 0.3,
    hemiSky: colour(),
    hemiGround: colour(),
    hemiIntensity: 1,
    nightFill: 0,
    fresnel: 0.5,
    radiance: 1,
    shadowFactor: 0.85,
    cloudHighlight: colour(),
    cloudLowlight: colour(),
    cloudCover: 0.3,
    cloudDark: 0.5,
    grassA: colour(),
    grassB: colour(),
    peakA: colour(),
    peakB: colour(),
    fieldTint: colour(),
    treeTint: colour(),
    groundSoil: colour(),
    groundStubble: colour(),
    groundPeat: colour(),
    groundSilt: colour(),
    groundGravel: colour(),
    groundRock: colour(),
    groundMud: colour(),
    groundForest: colour(),
    groundCrops: new Float32Array(CROP_COUNT * 3),
    groundForestA: 1,
    groundForestB: 1,
    groundForestMix: 0,
  };
}

// ---------------------------------------------------------------------------
// Colour authoring
// ---------------------------------------------------------------------------

/** Air, cloud and sky colours: the value that reaches the screen (see the note above). */
function air(hex: number): Rgb {
  return { r: ((hex >> 16) & 255) / 255, g: ((hex >> 8) & 255) / 255, b: (hex & 255) / 255 };
}

/** Light and ground colours: linear light, multiplied by albedos and intensities. */
function surface(hex: number): Rgb {
  const encode = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return {
    r: encode(((hex >> 16) & 255) / 255),
    g: encode(((hex >> 8) & 255) / 255),
    b: encode((hex & 255) / 255),
  };
}

function luma(c: Rgb): number {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

// ---------------------------------------------------------------------------
// Row shape: authored nested, interpolated flat
// ---------------------------------------------------------------------------

/**
 * One authored hour. Nested so the table below reads as a table; flattened once at
 * load into the numeric row the per-frame mix walks, because mixing twenty nested
 * colour objects every frame is both slower and easier to get wrong than a loop over
 * a fixed field list.
 */
interface RowSpec {
  /** The sky: A the horizon, B the zenith, C the haze tint — all as seen. */
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly near: number;
  /** How far this hour's air lets you see, metres. */
  readonly vis: number;
  /** Noisy fog height in metres, and how much fog it adds where it reaches. */
  readonly haze: readonly [height: number, intensity: number];
  readonly sun: readonly [colour: number, intensity: number];
  readonly amb: readonly [colour: number, intensity: number];
  /** Hemisphere sky and ground colours, intensity, and the fill's own night value. */
  readonly hemi: readonly [sky: number, ground: number, intensity: number, floor: number];
  readonly shade: readonly [fresnel: number, radiance: number, shadow: number];
  readonly cloud: readonly [highlight: number, lowlight: number, cover: number, dark: number];
}

const ROW_FIELDS = [
  'fogAr', 'fogAg', 'fogAb',
  'fogBr', 'fogBg', 'fogBb',
  'fogCr', 'fogCg', 'fogCb',
  'fogNear', 'visibilityM', 'hazeHeight', 'hazeIntensity',
  'sunR', 'sunG', 'sunB', 'sunIntensity',
  'ambR', 'ambG', 'ambB', 'ambIntensity',
  'skyR', 'skyG', 'skyB', 'groundR', 'groundG', 'groundB', 'hemiIntensity', 'nightFill',
  'fresnel', 'radiance', 'shadowFactor',
  'cloudHiR', 'cloudHiG', 'cloudHiB', 'cloudLoR', 'cloudLoG', 'cloudLoB', 'cloudCover', 'cloudDark',
  // The season's own, written after the rows are mixed; the rows leave them at zero.
  'grassAr', 'grassAg', 'grassAb', 'grassBr', 'grassBg', 'grassBb',
  'peakAr', 'peakAg', 'peakAb', 'peakBr', 'peakBg', 'peakBb',
  'fieldR', 'fieldG', 'fieldB', 'treeR', 'treeG', 'treeB',
] as const;

type RowField = (typeof ROW_FIELDS)[number];
type Row = Record<RowField, number>;

function zeroRow(): Row {
  const row = {} as Row;
  for (const field of ROW_FIELDS) row[field] = 0;
  return row;
}

/** Expands one authored row into the flat fields the interpolation walks. */
function flatten(spec: RowSpec): Row {
  const row = zeroRow();
  const a = air(spec.a);
  const b = air(spec.b);
  const c = air(spec.c);
  row.fogAr = a.r; row.fogAg = a.g; row.fogAb = a.b;
  row.fogBr = b.r; row.fogBg = b.g; row.fogBb = b.b;
  row.fogCr = c.r; row.fogCg = c.g; row.fogCb = c.b;
  row.fogNear = spec.near;
  row.visibilityM = spec.vis;
  row.hazeHeight = spec.haze[0];
  row.hazeIntensity = spec.haze[1];
  const sun = surface(spec.sun[0]);
  row.sunR = sun.r; row.sunG = sun.g; row.sunB = sun.b;
  row.sunIntensity = spec.sun[1];
  const amb = surface(spec.amb[0]);
  row.ambR = amb.r; row.ambG = amb.g; row.ambB = amb.b;
  row.ambIntensity = spec.amb[1];
  const sky = surface(spec.hemi[0]);
  const ground = surface(spec.hemi[1]);
  row.skyR = sky.r; row.skyG = sky.g; row.skyB = sky.b;
  row.groundR = ground.r; row.groundG = ground.g; row.groundB = ground.b;
  row.hemiIntensity = spec.hemi[2];
  row.nightFill = spec.hemi[3];
  row.fresnel = spec.shade[0];
  row.radiance = spec.shade[1];
  row.shadowFactor = spec.shade[2];
  const hi = air(spec.cloud[0]);
  const lo = air(spec.cloud[1]);
  row.cloudHiR = hi.r; row.cloudHiG = hi.g; row.cloudHiB = hi.b;
  row.cloudLoR = lo.r; row.cloudLoG = lo.g; row.cloudLoB = lo.b;
  row.cloudCover = spec.cloud[2];
  row.cloudDark = spec.cloud[3];
  return row;
}

/**
 * The six rows.
 *
 * The air colours are target on-screen values, measured off the reference frames:
 * a clear noon sky is #9ec2e4 by the horizon and #5a96d4 twenty degrees up; a clear
 * evening is a flat warm #ab9a80; a clear night is #30383f overhead and near-black at
 * the ground; an overcast noon is #838787.
 *
 * `night` carries the Moon's own light: it is the sky with no sun in it at all, and
 * its key colour is what a moonlit Russian night looks like — blue-grey, not white.
 * The `sun` intensity is relative to a clear noon, because the physics supplies the
 * absolute level: astronomy's illuminance already takes the sun to zero at night and
 * down by an order of magnitude at the horizon (see the exposure in render/sky.ts).
 */
const NODE: Record<'night' | 'dawn' | 'dusk' | 'morning' | 'evening' | 'day', RowSpec> = {
  // Clear night: dark blue-grey, the horizon barely warmer than the zenith.
  night: {
    a: 0x3c424c, b: 0x212834, c: 0x2a3038,
    near: 0.85, vis: 30000, haze: [0, 0],
    sun: [0xc3d6ea, 1],
    amb: [0x4e5a74, 0.42],
    hemi: [0x5d6f8f, 0x2b2620, 0.55, 3.4],
    shade: [0.2, 1, 0],
    cloud: [0x3f4757, 0x232a36, 0.18, 0.5],
  },
  // Before sunrise: pink and wet, mist lying in every hollow.
  dawn: {
    a: 0xd2a184, b: 0x5f7dab, c: 0xdda98a,
    near: 0.3, vis: 9000, haze: [70, 0.45],
    sun: [0xffcfa0, 1.15],
    amb: [0x63566a, 0.5],
    hemi: [0x5f76a0, 0x4a3d31, 1.0, 0.02],
    shade: [0.34, 1.3, 0.85],
    cloud: [0xe8b894, 0x74657f, 0.4, 0.7],
  },
  // After sunset: warm and flat, the air cleaned out by the day, the deck still lit.
  dusk: {
    a: 0xbfa583, b: 0x87838d, c: 0xbb9a7c,
    near: 0.45, vis: 18000, haze: [55, 0.32],
    sun: [0xffc186, 1.2],
    amb: [0x57495e, 0.5],
    hemi: [0x56709b, 0x4b3c2e, 1.05, 0.02],
    shade: [0.36, 1.4, 0.85],
    cloud: [0xd6ac8c, 0x6a5677, 0.45, 0.65],
  },
  // The first hour of sun: pale gold light, warm haze still lying in the hollows.
  morning: {
    a: 0xc9cfd4, b: 0x74a0d2, c: 0xcbc4b2,
    near: 0.5, vis: 11000, haze: [80, 0.4],
    sun: [0xffe3bc, 1.9],
    amb: [0x6d707a, 0.4],
    hemi: [0x99aecb, 0x6b5b45, 0.95, 0],
    shade: [0.35, 1.4, 0.85],
    cloud: [0xf0e0cc, 0x8d95ab, 0.4, 0.6],
  },
  // The last hour: the same light, warmer and clearer, the deck catching the sun.
  evening: {
    a: 0xc4b295, b: 0x7c8aa6, c: 0xbda98c,
    near: 0.55, vis: 16000, haze: [50, 0.3],
    sun: [0xffdcae, 2.0],
    amb: [0x6b6b70, 0.42],
    hemi: [0x9aa5bd, 0x6e5b41, 1.0, 0],
    shade: [0.4, 1.5, 0.85],
    cloud: [0xe4c3a6, 0x82788c, 0.45, 0.6],
  },
  // Noon: a saturated blue twenty degrees up over a pale horizon, and no fog at all
  // until the last tenth of the view — the crisp middle ground and the hazy band.
  //
  // THE KEY IS MOST OF THE LIGHT, AND THAT IS A LOOK DECISION (2026-09-26, stage 3).
  // Measured against `img/autumn-day-*.jpg` and `summer-day-clear-8s.jpg`, our frames
  // were about a third darker than slowroads and the meadow read as a dark saturated
  // green. The reason was the split, not the total: on a flat up-facing surface the
  // fill (a hemisphere under a strong blue sky plus a blue ambient) put three quarters
  // of the irradiance in, and leaf albedo is blue-starved by four, so most of that
  // light fell on a channel the grass barely reflects while the lane that does carry
  // the picture — the warm key — stood at 1.0 against slowroads' 6.2 beside an ambient
  // of 2.4. The key goes to 2.2 and the fill comes down and loses its blue to match
  // that ratio: the fill is still what lights a leaf out of the sun, so it stays a real
  // hemisphere, only no longer the dominant term of the frame.
  day: {
    a: 0xb3cde8, b: 0x4d86cc, c: 0x9dc2e2,
    near: 0.9, vis: 30000, haze: [0, 0],
    sun: [0xfff8ea, 2.05],
    amb: [0x71859a, 0.4],
    hemi: [0xa9c2d8, 0x8b7b61, 1.15, 0],
    shade: [0.3, 1.2, 0.85],
    cloud: [0xfdfdfd, 0xc2c8d8, 0.35, 0.55],
  },
};

const ROWS: Record<'night' | 'dawn' | 'dusk' | 'morning' | 'evening' | 'day', Row> = {
  night: flatten(NODE.night),
  dawn: flatten(NODE.dawn),
  dusk: flatten(NODE.dusk),
  morning: flatten(NODE.morning),
  evening: flatten(NODE.evening),
  day: flatten(NODE.day),
};

// ---------------------------------------------------------------------------
// Interpolation
// ---------------------------------------------------------------------------

/**
 * Where the rows sit, by sun elevation in degrees.
 *
 * Between consecutive stops the two rows are mixed by a smoothstep of the elevation,
 * so every value here is a continuous function of the sun's height and nothing pops
 * as it crosses a stop. -16 is astronomical night, -3 the middle of twilight, +6 the
 * middle of the golden hour and +28 the settled middle of the day.
 */
const STOP_ELEVATION_DEG = [-16, -3, 6, 28] as const;

const rowA = zeroRow();
const rowB = zeroRow();

function mixRows(out: Row, a: Row, b: Row, t: number): void {
  for (const field of ROW_FIELDS) out[field] = a[field] + (b[field] - a[field]) * t;
}

function copyRow(out: Row, src: Row): void {
  for (const field of ROW_FIELDS) out[field] = src[field];
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * How far you can see, blended between two airs.
 *
 * Geometrically, not linearly: visibility is a logarithmic quantity — 420 m, 3 km and
 * 20 km are three different worlds, and 90 % of the way to a fog bank is not three
 * kilometres of it. A linear mix put a barely-foggy channel at 3.4 km and the fog spell
 * never arrived.
 */
function mixVisibility(from: number, to: number, t: number): number {
  if (t <= 0) return from;
  if (t >= 1) return to;
  return Math.max(1, from) ** (1 - t) * Math.max(1, to) ** t;
}

function mixRgb(out: Rgb, a: Rgb, b: Rgb, t: number): void {
  out.r = a.r + (b.r - a.r) * t;
  out.g = a.g + (b.g - a.g) * t;
  out.b = a.b + (b.b - a.b) * t;
}

/** Fills `out` with the row for stop `index` (0 night, 1 twilight, 2 golden, 3 day). */
function rowFor(index: number, morningness: number, out: Row): void {
  switch (index) {
    case 0:
      copyRow(out, ROWS.night);
      return;
    case 1:
      mixRows(out, ROWS.dawn, ROWS.dusk, 1 - morningness);
      return;
    case 2:
      mixRows(out, ROWS.morning, ROWS.evening, 1 - morningness);
      return;
    default:
      copyRow(out, ROWS.day);
  }
}

/** Scratch: one flat row, and the deck's own grey while the weather is applied. */
const row = zeroRow();
const deck = { r: 0, g: 0, b: 0 };

const seasonWeights = { spring: 0, summer: 1, autumn: 0, winter: 0 };

/**
 * The season's own weights, from its channels.
 *
 * The channels are built not to overlap — the trees turn in September and October,
 * the leaves fall in late October, the snow lies from November, spring's green comes
 * and goes in May and June — so a weight is the channel itself and the summer is what
 * is left over. That is what makes the palette follow the same calendar as the world.
 */
function seasonBlendWeights(season: SeasonState): void {
  const winter = Math.min(1, Math.max(0, season.snow));
  const autumn = Math.min(1, Math.max(0, season.turn)) * (1 - winter);
  const spring = Math.min(1, Math.max(0, season.fresh)) * (1 - winter) * (1 - autumn);
  seasonWeights.winter = winter;
  seasonWeights.autumn = autumn;
  seasonWeights.spring = spring;
  seasonWeights.summer = Math.max(0, 1 - winter - autumn - spring);
}

// ---------------------------------------------------------------------------
// Season
// ---------------------------------------------------------------------------

/** How many crop tints a season row carries: `landcover.ts`'s `Crop` enum. */
const CROP_COUNT = 7;

/** How one season moves the air and paints the ground, in sRGB hex. */
interface SeasonRow {
  /** Multipliers on the light's colours: warm autumn, cold winter. */
  readonly lightTint: number;
  /** Multipliers on the horizon and haze colours. */
  readonly fogTint: number;
  /** How much white the wet winter air puts into the horizon, 0..1. */
  readonly paleness: number;
  readonly grassA: number;
  readonly grassB: number;
  readonly peakA: number;
  readonly peakB: number;
  readonly field: number;
  readonly tree: number;
  /** Ground layer tints, all multipliers on photographs (see `LookPalette`). */
  readonly soil: number;
  readonly stubble: number;
  readonly peat: number;
  readonly silt: number;
  readonly gravel: number;
  readonly rock: number;
  readonly mud: number;
  readonly forest: number;
  /** One tint per crop, in `Crop` order: wheat, rye, stubble, plough, green, fallow, hay. */
  readonly crops: readonly number[];
}

type SeasonName = 'spring' | 'summer' | 'autumn' | 'winter';

/** The order the forest-floor pair is indexed in: `SEASON_ORDER`. */
const SEASON_INDEX: Record<SeasonName, number> = { spring: 0, summer: 1, autumn: 2, winter: 3 };

const SEASONS: Record<SeasonName, SeasonRow> = {
  spring: {
    lightTint: 0xfff6f4,
    fogTint: 0xfff2f0,
    paleness: 0.2,
    grassA: 0xa2ba7d,
    grassB: 0xcfcca0,
    peakA: 0xf4eec6,
    peakB: 0xfffcd9,
    field: 0xc0bc84,
    tree: 0xb6c98a,
    soil: 0xf8f4ea,
    stubble: 0xfaf6ea,
    peat: 0xeeeadf,
    silt: 0xf4f6f0,
    gravel: 0xf6f7f3,
    rock: 0xf6f6f2,
    mud: 0xf4f0e4,
    forest: 0xeef4e4,
    crops: [0xf4ecc4, 0xece4c4, 0xf4eede, 0xcdb79a, 0xa8c86e, 0xccca8a, 0xe2deb0],
  },
  summer: {
    lightTint: 0xffffff,
    fogTint: 0xffffff,
    paleness: 0,
    grassA: 0x98b074,
    grassB: 0xbcb88e,
    peakA: 0xe2dcb4,
    peakB: 0xfffce1,
    field: 0xd2cc90,
    tree: 0xffffff,
    soil: 0xf6eee4,
    stubble: 0xfaf4e8,
    peat: 0xefeee6,
    silt: 0xf6f1e8,
    gravel: 0xf5f3ee,
    rock: 0xf7f4f0,
    mud: 0xf6ecdf,
    forest: 0xffffff,
    crops: [0xf0d888, 0xe4d69c, 0xecdfb4, 0xc0a284, 0xa8c868, 0xbcc084, 0xd6d090],
  },
  autumn: {
    lightTint: 0xffefd6,
    fogTint: 0xf6e2c6,
    paleness: 0.12,
    // LATE SEPTEMBER IS STILL GREEN. The first pass made an autumn meadow khaki-brown and
    // the frames read as straw everywhere; slowroads' own autumn pair is a green base
    // (#4A7D4D) against a khaki second tone (#BEAF79), and the owner's photographs of the
    // same week show green herbs with dry patches. So the FIRST colour stays a green and
    // the second carries the season, which is what the noise blend then reads as a country
    // of green meadows with mown and drying patches.
    //
    // THE CHROMA IS 0.7 OF THE PHOTOGRAPH'S, IN EVERY SEASON (stage 3). Measured on the
    // field frame, the ground came out at saturation 0.75 against the reference frames'
    // 0.48-0.60 for the same green field, because our frame reaches the display through
    // ACES with the key carrying most of the light, and that curve spends the blue end of
    // a saturated green early: an albedo of B/G 0.53 arrived at B/G 0.12. Hue and value
    // are the authored ones; only the chroma of the four tones moves, once, for all four
    // seasons, so a meadow that was acid becomes the sage the references show.
    grassA: 0x97ab84,
    grassB: 0xc6c3a4,
    // THE PEAK TONES ARE GREY-KHAKI, NOT YELLOW (stage 3). These two are the pale, dry
    // half of the tint, and the blade term hands them to every bright tip: slowroads'
    // autumn pair is a PINKISH pale (#E3BEA0) against a dark olive (#A28125), and the
    // first pass here had two yellows (#EDE0A5 / #FFE7A3). Under our warm key a yellow
    // peak turns the whole meadow acid, because the tip term only ever ADDS to the sun's
    // own warmth — measured on our field frame, (169,148,74) against the reference's
    // (137,136,79). A greyer pale keeps the tips bright without the cast.
    peakA: 0xe4d6b6,
    peakB: 0xd2be83,
    field: 0xd0b98a,
    tree: 0xd8b878,
    soil: 0xf2e8d8,
    stubble: 0xf8eeda,
    peat: 0xe8ded0,
    silt: 0xf0e6d6,
    gravel: 0xf4eee4,
    rock: 0xf4eee4,
    mud: 0xf0e4d2,
    forest: 0xfaf0dc,
    crops: [0xe8cc84, 0xdcc890, 0xe8dab8, 0xc39d79, 0xacc466, 0xc4b47c, 0xded0a0],
  },
  winter: {
    lightTint: 0xeff4ff,
    fogTint: 0xeef4ff,
    paleness: 0.42,
    grassA: 0xcbcac2,
    grassB: 0xe7e7df,
    peakA: 0xffffff,
    peakB: 0xffffff,
    field: 0xd4d6da,
    tree: 0x8f9aa4,
    soil: 0xe6ebf2,
    stubble: 0xeaf0f6,
    peat: 0xdee4ec,
    silt: 0xecf0f5,
    gravel: 0xeef2f7,
    rock: 0xe8eef4,
    mud: 0xe4eaf1,
    forest: 0xe6ecf2,
    crops: [0xe2e6ec, 0xdee2e8, 0xe6eaf0, 0xccd0d4, 0xd2d6da, 0xd8dce0, 0xdee2e6],
  },
};

/**
 * THE LAND COVER'S OWN COLOURS, in linear rgb.
 *
 * `world/landcover.ts` still hands out a colour alongside the cover class, for the
 * callers that want a colour and nothing else — the tools, and the grass cache. The
 * meadow and the seven crops are the SUMMER ROW of the table above rather than a second
 * copy of it, so a season's grass and a season's field cannot drift from the colours the
 * ground shader starts from; only the margins, the two forest floors and the mud are the
 * cover's own, because nothing else needs to know them.
 */
export const COVER_COLOURS = {
  /** Dry ground between plots: the strip a plough turns at. */
  margin: surface(0x959962),
  /** Needle and leaf litter under a spruce wood, and the paler floor of a bor. */
  forestFloor: surface(0x86785a),
  borFloor: surface(0xa89670),
  /** Wet clay underfoot. A colour, not a hole: darker and warmer than ploughland. */
  mud: surface(0x7d6a55),
  meadowLush: surface(SEASONS.summer.grassA),
  meadowDry: surface(SEASONS.summer.grassB),
  crops: SEASONS.summer.crops.map((c) => surface(c)),
} as const;

/**
 * The Moon's own light, linear: the colour the key carries while the Moon is the key.
 * It is the same blue-grey the night row is authored with, exported because the sky has
 * to blend towards it during the dusk hand-off, when the palette's own row is still the
 * sunset's.
 */
export const MOONLIGHT: Rgb = surface(0xc3d6ea);

/** Snow lying on the ground: blue-white, as it reads under our light. */
const SNOW_GROUND = surface(0xdde3ec);
/** A leafless crown: twigs, grey-brown — what the trees' tint goes to in winter. */
const BARE_TREES = surface(0x8d8a88);

type SeasonLinear = { lightTint: Rgb; fogTint: Rgb; paleness: number } & Record<
  'grassA' | 'grassB' | 'peakA' | 'peakB' | 'field' | 'tree' | 'soil' | 'stubble' | 'peat' | 'silt' | 'gravel' | 'rock' | 'mud' | 'forest',
  Rgb
> & { crops: Float32Array };

/** The same rows in the space the row mix works in, so nothing allocates per frame. */
const SEASON_LINEAR: Record<SeasonName, SeasonLinear> = (() => {
  const out = {} as Record<SeasonName, SeasonLinear>;
  for (const name of ['spring', 'summer', 'autumn', 'winter'] as const) {
    const authored = SEASONS[name];
    const crops = new Float32Array(CROP_COUNT * 3);
    for (let i = 0; i < CROP_COUNT; i++) {
      const c = surface(authored.crops[i] ?? 0xffffff);
      crops[i * 3] = c.r;
      crops[i * 3 + 1] = c.g;
      crops[i * 3 + 2] = c.b;
    }
    out[name] = {
      lightTint: surface(authored.lightTint),
      fogTint: surface(authored.fogTint),
      paleness: authored.paleness,
      grassA: surface(authored.grassA),
      grassB: surface(authored.grassB),
      peakA: surface(authored.peakA),
      peakB: surface(authored.peakB),
      field: surface(authored.field),
      tree: surface(authored.tree),
      soil: surface(authored.soil),
      stubble: surface(authored.stubble),
      peat: surface(authored.peat),
      silt: surface(authored.silt),
      gravel: surface(authored.gravel),
      rock: surface(authored.rock),
      mud: surface(authored.mud),
      forest: surface(authored.forest),
      crops,
    };
  }
  return out;
})();

const season = {
  lightTint: surface(0xffffff),
  fogTint: surface(0xffffff),
  paleness: 0,
  grassA: surface(0xffffff),
  grassB: surface(0xffffff),
  peakA: surface(0xffffff),
  peakB: surface(0xffffff),
  field: surface(0xffffff),
  tree: surface(0xffffff),
  soil: surface(0xffffff),
  stubble: surface(0xffffff),
  peat: surface(0xffffff),
  silt: surface(0xffffff),
  gravel: surface(0xffffff),
  rock: surface(0xffffff),
  mud: surface(0xffffff),
  forest: surface(0xffffff),
  crops: new Float32Array(CROP_COUNT * 3),
  forestA: SEASON_INDEX.summer,
  forestB: SEASON_INDEX.summer,
  forestMix: 0,
};

const SEASON_FIELDS = [
  'lightTint', 'fogTint', 'grassA', 'grassB', 'peakA', 'peakB', 'field', 'tree',
  'soil', 'stubble', 'peat', 'silt', 'gravel', 'rock', 'mud', 'forest',
] as const;

const SEASON_ORDER = ['spring', 'summer', 'autumn', 'winter'] as const;

function blendSeasons(): void {
  for (const field of SEASON_FIELDS) {
    const out = season[field];
    out.r = 0;
    out.g = 0;
    out.b = 0;
    for (const name of SEASON_ORDER) {
      const c = SEASON_LINEAR[name][field];
      const w = seasonWeights[name];
      out.r += c.r * w;
      out.g += c.g * w;
      out.b += c.b * w;
    }
  }
  for (let i = 0; i < CROP_COUNT * 3; i++) {
    let v = 0;
    for (const name of SEASON_ORDER) v += SEASON_LINEAR[name].crops[i]! * seasonWeights[name];
    season.crops[i] = v;
  }
  season.paleness = 0;
  for (const name of SEASON_ORDER) season.paleness += SEASON_LINEAR[name].paleness * seasonWeights[name];

  // The two woods in play, heaviest first. A settled season names itself twice, which the
  // shader reads as "one fetch, no blend".
  const weights = SEASON_ORDER.map((name) => seasonWeights[name]);
  let first = 0;
  for (let i = 1; i < weights.length; i++) if (weights[i]! > weights[first]!) first = i;
  let second = first;
  for (let i = 0; i < weights.length; i++) {
    if (i !== first && weights[i]! > weights[second]!) second = i;
  }
  const total = weights[first]! + weights[second]!;
  season.forestA = first;
  season.forestB = second;
  season.forestMix = second === first || total < 1e-4 ? 0 : weights[second]! / total;
}

// ---------------------------------------------------------------------------
// The frame's palette
// ---------------------------------------------------------------------------

/**
 * The look for this moment.
 *
 * `out` is filled in place: one call per frame, from the sky, and every other system
 * (the fog uniforms, the world lighting, the cloud plane) reads that same object, so
 * the air the ground dissolves into and the air the sky is painted with cannot drift
 * apart.
 */
export function paletteAt(state: LookState, out: LookPalette): LookPalette {
  const elevationDeg = (state.sunElevation * 180) / Math.PI;

  let band = 0;
  while (band < STOP_ELEVATION_DEG.length - 2 && elevationDeg >= STOP_ELEVATION_DEG[band + 1]!) band++;
  const t = smoothstep(STOP_ELEVATION_DEG[band]!, STOP_ELEVATION_DEG[band + 1]!, elevationDeg);

  // The sun rises in the east and sets in the west, so the sine of the azimuth is +1
  // at sunrise and -1 at sunset. Passing smoothly through the meridian is what hands a
  // midwinter sun, which never climbs out of the golden hour, from morning to evening.
  const morningness = smoothstep(-0.25, 0.25, Math.sin(state.sunAzimuth));

  rowFor(band, morningness, rowA);
  rowFor(band + 1, morningness, rowB);
  mixRows(row, rowA, rowB, t);

  seasonBlendWeights(state.season);
  blendSeasons();
  applySeason(state.season);
  applyWeather(state, elevationDeg);

  writePalette(out);
  return out;
}

/** Copies the flat row into the named palette the rest of the renderer reads. */
function writePalette(out: LookPalette): void {
  out.fogA.r = row.fogAr; out.fogA.g = row.fogAg; out.fogA.b = row.fogAb;
  out.fogB.r = row.fogBr; out.fogB.g = row.fogBg; out.fogB.b = row.fogBb;
  out.fogC.r = row.fogCr; out.fogC.g = row.fogCg; out.fogC.b = row.fogCb;
  out.fogNear = row.fogNear;
  out.visibilityM = row.visibilityM;
  out.hazeHeight = row.hazeHeight;
  out.hazeIntensity = row.hazeIntensity;
  out.sunColor.r = row.sunR; out.sunColor.g = row.sunG; out.sunColor.b = row.sunB;
  out.sunIntensity = row.sunIntensity;
  out.ambientColor.r = row.ambR; out.ambientColor.g = row.ambG; out.ambientColor.b = row.ambB;
  out.ambientIntensity = row.ambIntensity;
  out.hemiSky.r = row.skyR; out.hemiSky.g = row.skyG; out.hemiSky.b = row.skyB;
  out.hemiGround.r = row.groundR; out.hemiGround.g = row.groundG; out.hemiGround.b = row.groundB;
  out.hemiIntensity = row.hemiIntensity;
  out.nightFill = row.nightFill;
  out.fresnel = row.fresnel;
  out.radiance = row.radiance;
  out.shadowFactor = row.shadowFactor;
  out.cloudHighlight.r = row.cloudHiR; out.cloudHighlight.g = row.cloudHiG; out.cloudHighlight.b = row.cloudHiB;
  out.cloudLowlight.r = row.cloudLoR; out.cloudLowlight.g = row.cloudLoG; out.cloudLowlight.b = row.cloudLoB;
  out.cloudCover = row.cloudCover;
  out.cloudDark = row.cloudDark;
  out.grassA.r = row.grassAr; out.grassA.g = row.grassAg; out.grassA.b = row.grassAb;
  out.grassB.r = row.grassBr; out.grassB.g = row.grassBg; out.grassB.b = row.grassBb;
  out.peakA.r = row.peakAr; out.peakA.g = row.peakAg; out.peakA.b = row.peakAb;
  out.peakB.r = row.peakBr; out.peakB.g = row.peakBg; out.peakB.b = row.peakBb;
  out.fieldTint.r = row.fieldR; out.fieldTint.g = row.fieldG; out.fieldTint.b = row.fieldB;
  out.treeTint.r = row.treeR; out.treeTint.g = row.treeG; out.treeTint.b = row.treeB;
  // The ground's layer tints are the season's own, written straight from the blend: they
  // are multipliers on photographs rather than functions of the hour, and the same
  // argument that keeps the grass colours out of the row applies to them.
  writeRgb(out.groundSoil, season.soil);
  writeRgb(out.groundStubble, season.stubble);
  writeRgb(out.groundPeat, season.peat);
  writeRgb(out.groundSilt, season.silt);
  writeRgb(out.groundGravel, season.gravel);
  writeRgb(out.groundRock, season.rock);
  writeRgb(out.groundMud, season.mud);
  writeRgb(out.groundForest, season.forest);
  out.groundCrops.set(season.crops);
  out.groundForestA = season.forestA;
  out.groundForestB = season.forestB;
  out.groundForestMix = season.forestMix;
}

function writeRgb(out: Rgb, src: Rgb): void {
  out.r = src.r;
  out.g = src.g;
  out.b = src.b;
}

/**
 * The season's own hand on the air and the ground.
 *
 * The air is TINTED rather than restated: a winter noon and a summer noon differ in
 * how the light is bent and how pale the haze is far more than in what colour the sky
 * is, and a tint leaves the hour's own structure alone — a winter dawn is still a
 * dawn. The ground and foliage colours are the season's own, because a colour that is
 * not the light's cannot be derived from it.
 */
function applySeason(state: SeasonState): void {
  const notSummer = 1 - seasonWeights.summer;
  const lightR = 1 + (season.lightTint.r - 1) * 0.7;
  const lightG = 1 + (season.lightTint.g - 1) * 0.7;
  const lightB = 1 + (season.lightTint.b - 1) * 0.7;
  row.sunR *= lightR; row.sunG *= lightG; row.sunB *= lightB;
  row.ambR *= lightR; row.ambG *= lightG; row.ambB *= lightB;

  // The horizon carries the tint; the zenith keeps its own depth, because a cold sky is
  // a deeper blue, not a redder one. A third of the tint's own strength: at full
  // strength an autumn green channel loses a sixth and the whole horizon band goes pink,
  // which is a filter on the sky rather than a season in it.
  const tintWeight = 0.34 * notSummer;
  const fogR = 1 + (season.fogTint.r * lightR - 1) * tintWeight;
  const fogG = 1 + (season.fogTint.g * lightG - 1) * tintWeight;
  const fogB = 1 + (season.fogTint.b * lightB - 1) * tintWeight * 0.4;
  row.fogAr *= fogR; row.fogAg *= fogG; row.fogAb *= fogB;
  row.fogCr *= fogR; row.fogCg *= fogG; row.fogCb *= fogB;

  // Winter air is paler: the horizon goes toward blue-white without touching the
  // zenith. The reference winter frame is a pale lavender-grey, not a white-out.
  const pale = Math.min(0.75, season.paleness * (0.7 + 0.5 * state.snow));
  if (pale > 0) {
    deck.r = row.fogAr; deck.g = row.fogAg; deck.b = row.fogAb;
    const lift = luma(deck);
    row.fogAr = mix(row.fogAr, Math.max(row.fogAr, lift * 1.15 + 0.1), pale);
    row.fogAg = mix(row.fogAg, Math.max(row.fogAg, lift * 1.17 + 0.11), pale);
    row.fogAb = mix(row.fogAb, Math.max(row.fogAb, lift * 1.22 + 0.14), pale);
  }

  const snow = Math.min(1, Math.max(0, state.snow)) * 0.8;
  const bare = Math.min(1, Math.max(0, state.bare));
  row.grassAr = mix(season.grassA.r, SNOW_GROUND.r, snow);
  row.grassAg = mix(season.grassA.g, SNOW_GROUND.g, snow);
  row.grassAb = mix(season.grassA.b, SNOW_GROUND.b, snow);
  row.grassBr = mix(season.grassB.r, SNOW_GROUND.r, snow);
  row.grassBg = mix(season.grassB.g, SNOW_GROUND.g, snow);
  row.grassBb = mix(season.grassB.b, SNOW_GROUND.b, snow);
  row.peakAr = mix(season.peakA.r, SNOW_GROUND.r, snow);
  row.peakAg = mix(season.peakA.g, SNOW_GROUND.g, snow);
  row.peakAb = mix(season.peakA.b, SNOW_GROUND.b, snow);
  row.peakBr = mix(season.peakB.r, SNOW_GROUND.r, snow);
  row.peakBg = mix(season.peakB.g, SNOW_GROUND.g, snow);
  row.peakBb = mix(season.peakB.b, SNOW_GROUND.b, snow);
  row.fieldR = mix(season.field.r, SNOW_GROUND.r, snow);
  row.fieldG = mix(season.field.g, SNOW_GROUND.g, snow);
  row.fieldB = mix(season.field.b, SNOW_GROUND.b, snow);

  // A leafless crown is twigs, and twigs are grey: the tint loses its colour, it does
  // not merely darken (stages 3 and 4 read this).
  const twigs = bare * 0.7;
  row.treeR = mix(season.tree.r, BARE_TREES.r, twigs);
  row.treeG = mix(season.tree.g, BARE_TREES.g, twigs);
  row.treeB = mix(season.tree.b, BARE_TREES.b, twigs);
}

/** The overcast deck's own grey at night and at noon: an overcast sky is not black. */
const OVERCAST_NIGHT = air(0x1c2129);
const OVERCAST_DAY = air(0x939ba3);
/** What is left of the key light under a closed deck, and under rain through it. */
const OVERCAST_KEY = 0.2;
const RAIN_KEY = 0.55;
/** Where an overcast sky puts the noisy haze: the hilltops sit in it. */
const OVERCAST_HAZE_HEIGHT = -150;
const OVERCAST_HAZE_INTENSITY = 0.45;

/**
 * Overcast, rain and fog, as a modulation of the hour's row.
 *
 * All three are properties of the AIR rather than of the hour: they grey the sky,
 * flatten the light and close the deck whatever time it is. A second authored table
 * would need 32 more cells and would turn the common case — a half-overcast sky — into
 * a blend of two authored extremes instead of one continuous answer.
 */
function applyWeather(state: LookState, elevationDeg: number): void {
  const dayLevel = smoothstep(-8, 4, elevationDeg);
  const overcast = Math.min(1, Math.max(0, state.overcast));
  const rain = Math.min(1, Math.max(0, state.precip));
  const fog = Math.min(1, Math.max(0, state.fog));

  mixRgb(deck, OVERCAST_NIGHT, OVERCAST_DAY, dayLevel);

  if (overcast > 0) {
    // Rain takes the light out of the deck as well as out of the sun.
    const dim = 1 - 0.3 * rain * overcast;
    deck.r *= dim; deck.g *= dim; deck.b *= dim;

    // Air: the horizon keeps more light than the zenith, because the deck is thickest
    // overhead — that is what lets an overcast sky still read as a sky.
    row.fogAr = mix(row.fogAr, deck.r * 1.1, overcast * 0.85);
    row.fogAg = mix(row.fogAg, deck.g * 1.1, overcast * 0.85);
    row.fogAb = mix(row.fogAb, deck.b * 1.1, overcast * 0.85);
    row.fogBr = mix(row.fogBr, deck.r * 0.8, overcast * 0.9);
    row.fogBg = mix(row.fogBg, deck.g * 0.8, overcast * 0.9);
    row.fogBb = mix(row.fogBb, deck.b * 0.8, overcast * 0.9);
    row.fogCr = mix(row.fogCr, deck.r, overcast * 0.7);
    row.fogCg = mix(row.fogCg, deck.g, overcast * 0.7);
    row.fogCb = mix(row.fogCb, deck.b, overcast * 0.7);

    // The key is cut and turned cold — what reaches the ground has been scattered by
    // the deck — and the fill is raised and greyed, because that IS the light.
    row.sunIntensity *= mix(1, OVERCAST_KEY * mix(1, RAIN_KEY, rain), overcast);
    row.sunR = mix(row.sunR, deck.r * 1.3, overcast * 0.8);
    row.sunG = mix(row.sunG, deck.g * 1.3, overcast * 0.8);
    row.sunB = mix(row.sunB, deck.b * 1.3, overcast * 0.8);
    row.ambIntensity *= mix(1, 1.45, overcast);
    row.ambR = mix(row.ambR, deck.r * 1.1, overcast * 0.8);
    row.ambG = mix(row.ambG, deck.g * 1.1, overcast * 0.8);
    row.ambB = mix(row.ambB, deck.b * 1.1, overcast * 0.8);
    row.hemiIntensity *= mix(1, 1.2, overcast);
    row.skyR = mix(row.skyR, deck.r * 1.15, overcast * 0.9);
    row.skyG = mix(row.skyG, deck.g * 1.15, overcast * 0.9);
    row.skyB = mix(row.skyB, deck.b * 1.15, overcast * 0.9);
    row.groundR = mix(row.groundR, deck.r * 0.75, overcast * 0.7);
    row.groundG = mix(row.groundG, deck.g * 0.75, overcast * 0.7);
    row.groundB = mix(row.groundB, deck.b * 0.75, overcast * 0.7);

    // The haze sinks into the hilltops (a negative height asks the noise for the deck
    // itself) and the cumulus closes into one grey layer.
    row.hazeHeight = mix(row.hazeHeight, OVERCAST_HAZE_HEIGHT, overcast);
    row.hazeIntensity = mix(row.hazeIntensity, OVERCAST_HAZE_INTENSITY, overcast);
    row.cloudCover = mix(row.cloudCover, 1, overcast);
    row.cloudDark = mix(row.cloudDark, 0.5 + 0.3 * rain, overcast);
    row.cloudHiR = mix(row.cloudHiR, deck.r * 1.3, overcast * 0.9);
    row.cloudHiG = mix(row.cloudHiG, deck.g * 1.3, overcast * 0.9);
    row.cloudHiB = mix(row.cloudHiB, deck.b * 1.3, overcast * 0.9);
    row.cloudLoR = mix(row.cloudLoR, deck.r * 0.78, overcast * 0.9);
    row.cloudLoG = mix(row.cloudLoG, deck.g * 0.78, overcast * 0.9);
    row.cloudLoB = mix(row.cloudLoB, deck.b * 0.78, overcast * 0.9);

    // A deck sits on the ground, not above it: under overcast the air is thicker.
    row.visibilityM = mixVisibility(row.visibilityM, 13000, overcast);
    // Rain pushes the air in and takes the shine off the deck.
    row.cloudCover = Math.min(1, row.cloudCover + 0.15 * rain * overcast);
    row.visibilityM = mixVisibility(row.visibilityM, 3200, rain * overcast);
    row.fogNear = mix(row.fogNear, 0.35, rain * overcast);
  }

  if (fog > 0) {
    // A fog spell: the air becomes the sky. Horizon, zenith and haze tint converge on
    // one pale grey, the fog comes in to a few hundred metres, and the ground mist the
    // noise paints is what makes it read as lying low rather than as a white screen.
    const pale = 0.6 + 0.4 * dayLevel;
    const fr = deck.r * pale * 1.2;
    const fg = deck.g * pale * 1.2;
    const fb = deck.b * pale * 1.2;
    row.fogAr = mix(row.fogAr, fr, fog * 0.95);
    row.fogAg = mix(row.fogAg, fg, fog * 0.95);
    row.fogAb = mix(row.fogAb, fb, fog * 0.95);
    row.fogBr = mix(row.fogBr, fr, fog * 0.9);
    row.fogBg = mix(row.fogBg, fg, fog * 0.9);
    row.fogBb = mix(row.fogBb, fb, fog * 0.9);
    row.fogCr = mix(row.fogCr, fr, fog * 0.9);
    row.fogCg = mix(row.fogCg, fg, fog * 0.9);
    row.fogCb = mix(row.fogCb, fb, fog * 0.9);
    // A fog spell is a few hundred metres of air and nothing beyond it: the far plane of
    // the fog itself comes in, and the ramp starts almost at the eye.
    row.visibilityM = mixVisibility(row.visibilityM, 420, fog);
    row.fogNear = mix(row.fogNear, 0.02, fog);
    row.hazeHeight = mix(row.hazeHeight, 60, fog);
    row.hazeIntensity = mix(row.hazeIntensity, 0.85, fog);
    row.sunIntensity *= mix(1, 0.5, fog);
    row.cloudCover = mix(row.cloudCover, 0.85, fog);
  }

  row.fogNear = Math.min(0.98, Math.max(0.02, row.fogNear));
}
