/**
 * The ending: a separate scene, a separate camera and its own rAF loop, drawn through
 * the game's own post pass once main has stopped calling `Renderer.render`.
 *
 * WHY A SCENE OF ITS OWN. The game's scene carries the streamed world, whose streamer,
 * vista and providers would all have to be found and hidden; a beach far from the road
 * has nothing to share with it. `Renderer.renderAlternate` runs the alternate pair
 * through the same fullscreen pass, so the ink outline, the colour finish and the
 * horizon handling are the ones the player has been looking at all game.
 *
 * THE ONE THING IT SHARES is the air. The scene carries its own fog and its own ridge
 * colours, but the pass's daylight, heat shimmer and air veil are set here explicitly
 * rather than inherited, because whatever the game left in those uniforms describes a
 * desert at another hour.
 *
 * THE SHAPE OF THE SCENE, AND WHY IT IS A LANDING. Sea to the north (+Z), a wavy
 * waterline with surf running along it, a wide beach of wet-then-dry sand climbing
 * into the scrub, a packed strip laid along Z whose seaward threshold sits just inside
 * the wash, a small house on the sand beside the strip's far end, palms scattered
 * round it and along the beach, flat-topped mesas across the plain behind, and three
 * layers of blue ridges behind those.
 *
 * The aeroplane arrives from INLAND: it comes down over the mesas, crosses the scrub,
 * touches down on the strip and rolls toward the water, stopping a few metres short of
 * the surf line with the house just to one side and the sea right there. That is what
 * puts the sea in the last third of the film instead of behind the aeroplane for the
 * whole descent, and it is what the four shots are built around: up at a mesa rim as
 * the aeroplane crosses it, inland from the wash as it comes down out of the mesas and
 * touches down, the roll-out seen from behind it toward the water, and the held
 * composition with house, aeroplane, palms and the sun's path on the sea.
 *
 * The sea is `story/seashader.ts` — its own shader, one draw call, laid on the beach
 * profile's own depth contours so the surf, the turquoise shelf and the swash running
 * up the sand all follow the waterline's wobble rather than a straight line in z.
 *
 * Everything here is thrown away at the end: the geometries and materials this module
 * built are disposed, and the process reloads. The ONE exception is the dwelling's body,
 * which is the session-cached geometry every POI house shares (world/poistructures.ts)
 * and therefore outlives this scene.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Renderer } from '../core/renderer';
import { hashUnit3 } from '../core/rng';
import type { GameAudio } from '../audio/gameaudio';
import type { PropellerVoice, SurfVoice } from '../audio/storyaudio';
import { createStructureInstance, structureCount, structureDef } from '../world/poistructures';
import { cardMaterial, PALM_TINT, palmGeometry } from '../render/mirage-tableau';
import { createLightPlane, type LightPlane } from './plane';
import { createSeaMaterial } from './seashader';
import { ShotRig } from './takeoff';
import type { StoryOverlay } from './overlay';

/* ---- choreography, seconds ---- */
/** Reveal from black at the start. */
const FADE_IN_S = 1.4;
/** Touchdown. */
const TOUCHDOWN_AT = 6.6;
/** Rolling speed at touchdown, m/s: a light single's landing speed. */
const ROLL_SPEED = 35;
/** The propeller has finished turning: idle to still. */
const SPUN_DOWN_AT = 17.6;
/** The credits start rolling. */
const CREDITS_AT = 19;
/** The roll of placeholder lines, seconds. */
const CREDITS_S = 7;
/** Fade to black. */
const FADE_OUT_AT = 21.4;
const FADE_OUT_S = 1.7;
/** Everything is resolved a beat after the black. */
const TOTAL_S = 23.6;
/** Shot changes, seconds. */
const SHOT_BEACH_AT = 4.6;
const SHOT_ROLL_AT = 7;
const SHOT_HOUSE_AT = 13.6;

/* ---- the flight, metres ---- */
/**
 * Where the aeroplane enters the shot: inland, over the mesas, forty metres up. The
 * descent from here is one glide path onto the strip, and the entry is deliberately
 * about a quarter of a kilometre out so that the six and a half seconds to touchdown
 * come out at something like the aeroplane's own approach speed.
 */
const APPROACH_Z = -320;
const APPROACH_ALT = 40;
/** Where the tyres touch the strip, and where the roll stops: sixty metres later. */
const TOUCHDOWN_Z = -55;
const STOP_Z = 4;
/** ...which with the roll's own length fixes how long the roll-out takes: `2d / v`. */
const STOPPED_AT = TOUCHDOWN_AT + (2 * (STOP_Z - TOUCHDOWN_Z)) / ROLL_SPEED;
/** Tail-down attitude at touchdown and the braking attitude once rolling, radians. */
const FLARE_PITCH = 0.085;
const ROLL_PITCH = -0.015;
/**
 * Heading: the strip runs along Z and the aeroplane lands on it travelling toward the
 * sea, and the model's nose is its +Z (see `plane.ts`), so the yaw is zero.
 */
const RUNWAY_YAW = 0;

/* ---- the beach, metres ---- */
/**
 * Shoreline cross-section, `[z, y]`: sea at +Z, hills at -Z. The waterline sits at
 * z = 30 and the sand climbs gently from there, so the sea is a couple of dozen metres
 * seaward of where the aeroplane comes to rest, the swash is in the foreground of the
 * shot from the beach, and the beach runs a hundred and twenty metres inland before
 * the scrub takes over. The sea side is deliberately shallow: a beach reads as sand
 * under turquoise before it reads as water, and a gentle shore is what puts the
 * shallow band far enough out to be seen from the strip.
 */
const PROFILE: readonly (readonly [number, number])[] = [
  [2600, -220],
  [1400, -70],
  [420, -22],
  [150, -3.4],
  [70, -1.15],
  [42, -0.42],
  [30, 0],
  [22, 0.45],
  [10, 0.9],
  [-30, 1.3],
  [-90, 1.8],
  [-170, 2.7],
  // The plain behind the beach is held nearly level, and deliberately so: a mesa is a
  // wall standing out of flat ground, and a plain that climbed to fourteen metres over
  // the three hundred a butte's own footprint covers would swallow every one of the
  // buttes standing on it — they came out mounds. The range behind can still climb.
  [-430, 7],
  [-900, 40],
];
/** The strip: half width, its run, and how far it is lifted over the sand. */
const STRIP_HALF_W = 10.5;
/**
 * Its seaward threshold sits ten metres inside the waterline, so the swash can run up
 * to it without standing on the made surface; inland it runs well past the touchdown.
 */
const STRIP_FROM_Z = 20;
const STRIP_TO_Z = -140;
const STRIP_LIFT = 0.04;
/**
 * The house: on the sand west of the strip, level with where the aeroplane stops, so
 * the last shot has the house, the aeroplane and the sea in one frame and the sea is
 * twenty-eight metres away. Its front door looks east-south-east, at the strip and the
 * parked aeroplane, with the water down its left flank.
 */
const HOUSE_X = -30;
const HOUSE_Z = 2;
const HOUSE_YAW = -1.75;
/** The dwelling the ending builds; the site's own house comes from the same catalogue. */
const HOUSE_ID = 'cycladic';
/** Fallback index: the first dwelling in POI_STRUCTURES (the masts come first). */
const HOUSE_FALLBACK_INDEX = 3;

/* ---- the air ---- */
const SKY_ZENITH = new THREE.Color(0.09, 0.3, 0.68);
/** Pale and slightly warm, so the far sea and the ridges fade into a sunny haze. */
const SKY_HORIZON = new THREE.Color(0.74, 0.76, 0.7);
const SKY_GROUND = new THREE.Color(0.4, 0.46, 0.45);
const SUN_COLOUR = new THREE.Color(1, 0.93, 0.79);
/**
 * Unit direction TOWARD the sun: high, on the seaward side of the aeroplane's own
 * landing run and west of the strip. That puts it ahead of the descent (the aeroplane
 * lands toward it) and inside the held shot's frame, which is where the glitter path
 * on the water has to be.
 */
const SUN_DIRECTION = new THREE.Vector3(-0.46, 0.56, 0.69).normalize();
const FOG_DENSITY = 0.00032;
const SKY_RADIUS = 2200;
/**
 * The sky's own bake, as a share of what a material's `envMapIntensity` already asks for.
 * The dome is a bright, broad light: at full strength it fills the shadows so evenly that
 * sand and scrub both come out the same milky tone, which is what the beach looked like.
 */
const ENVIRONMENT_INTENSITY = 0.7;

/* ---- the sea ---- */
const SEA_DEEP = new THREE.Color(0.04, 0.2, 0.42);
const SEA_SHALLOW = new THREE.Color(0.16, 0.62, 0.6);
const SEA_FOAM = new THREE.Color(0.85, 0.9, 0.9);
/** The wet sand the swash leaves: the sand's own tone, darkened and slightly cooled. */
const SAND_SOAKED = new THREE.Color(0.3, 0.24, 0.17);
/**
 * The sea's rows, metres SEAWARD of the waterline (negative is up the beach). The sheet
 * is built along the waterline rather than as a grid, so the rows can be dense where the
 * eye is — the swash running up the sand, the breakers, the turquoise shelf — and
 * kilometres apart out at the horizon, where the swell has been dropped anyway.
 */
const SEA_ROWS: readonly number[] = [
  -16, -12, -9.2, -7, -5.4, -4.1, -3.1, -2.3, -1.6, -1, -0.55, -0.2, 0.15, 0.6, 1.15, 1.85,
  2.7, 3.7, 4.9, 6.4, 8.2, 10.5, 13.5, 17.5, 22.5, 29, 37, 47, 60, 77, 99, 127, 163, 210,
  270, 348, 448, 577, 743, 957, 1232, 1586, 2042, 2600,
];

/* ---- the land ---- */
/**
 * The dry sand is authored as the pale, warm tone it should READ as, not as the ochre
 * its own albedo suggests: the dome's bake and the hemisphere fill together put more
 * light on the beach than the desert gets, and a mid ochre under them came out the
 * brown of wet cardboard. The wet band is a shade of the same sand rather than a second
 * colour, so the beach still reads as one beach either side of the waterline.
 */
const SAND_DRY = new THREE.Color(0.78, 0.68, 0.5);
const SAND_WET = new THREE.Color(0.4, 0.33, 0.23);
/**
 * Behind the beach the ground is the desert's own, not a green flat with a beach in
 * front of it: the game's terrain is sand, rock and gravel at every mileage, and its
 * scrub is a thin thing that shows gravel through it. These are warmer and much less
 * green than the ending's first pass — which painted a wide olive-grey band across the
 * back of every shot from the beach and read as a dull field rather than as a desert.
 */
const GRASS_SCRUB = new THREE.Color(0.21, 0.2, 0.1);
const DIRT_DRY = new THREE.Color(0.44, 0.35, 0.2);
const HILL = new THREE.Color(0.36, 0.29, 0.17);
/** The plain at the mesas' own feet: the rock's tone, lifted toward the sand. */
const PLAIN_OCHRE = new THREE.Color(0.55, 0.44, 0.27);
/** The strip's packed earth, and the darker soil along its two edges. */
const STRIP_PACKED = new THREE.Color(0.34, 0.29, 0.21);
const STRIP_EDGE = new THREE.Color(0.18, 0.15, 0.11);
const RIDGE_BASE = new THREE.Color(0.13, 0.15, 0.14);
/** The ridges' own air: cooler and bluer than the horizon's, which is what depth is. */
const RIDGE_HAZE = new THREE.Color(0.34, 0.42, 0.56);

/* ---- the mesas ---- */
/**
 * A flat-topped butte, authored in the desert's own sandstone: `MESA_ROCK` is the
 * shade the walls read as, `MESA_TOP` the sunlit plateau a step lighter, and both are
 * mixed toward the ridges' air by distance the way the ridge layers are, so the mesas
 * stand in front of the range instead of on it.
 */
const MESA_ROCK = new THREE.Color(0.44, 0.3, 0.18);
const MESA_TOP = new THREE.Color(0.62, 0.47, 0.3);
/**
 * The mesa silhouette, `[radius, height]` as fractions of the butte's own: a buried
 * skirt, a step out to the wall, two long near-vertical faces and a plateau. Verbatim
 * `MESA_RINGS` from `render/vista.ts`, because a mesa the ending draws has to be the
 * same shape as the ones the driver watched dissolve all game.
 */
const MESA_RINGS: readonly (readonly [number, number])[] = [
  [1.16, 0],
  [1, 0.16],
  [0.84, 0.62],
  [0.66, 0.66],
  [0.56, 0.88],
  [0.45, 0.92],
  [0.39, 1],
];

/** The placeholder credits. */
const CREDIT_LINES: readonly string[] = [
  'Voyage',
  'A drive by nobody in particular',
  'Сынок, мы с Котёной купили дом у моря',
  'Credits — coming soon',
  'Thanks for playing',
];

export interface EndingOptions {
  /** The live renderer: this takes over its frame but never re-creates its context. */
  renderer: Renderer;
  audio: GameAudio;
  overlay: StoryOverlay;
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** The shoreline's cross-section at `z`, linear between the table's rows. */
function profileY(z: number): number {
  if (z >= PROFILE[0]![0]) return PROFILE[0]![1];
  for (let i = 1; i < PROFILE.length; i++) {
    const [z0, y0] = PROFILE[i - 1]!;
    const [z1, y1] = PROFILE[i]!;
    if (z <= z0 && z >= z1) return lerp(y0, y1, (z0 - z) / (z0 - z1));
  }
  return PROFILE[PROFILE.length - 1]![1];
}

/**
 * The z at which the profile stands at `y`, the inverse of `profileY`. The table is
 * monotone in z, so the walk is one pass. Used to place the sea's rows on the depth
 * contours rather than on a fixed grid: the surf line and the shallows then have as much
 * resolution as they need without spending vertices on the rest of the sheet.
 */
function profileZ(y: number): number {
  if (y <= PROFILE[0]![1]) return PROFILE[0]![0];
  for (let i = 1; i < PROFILE.length; i++) {
    const [z0, y0] = PROFILE[i - 1]!;
    const [z1, y1] = PROFILE[i]!;
    if (y >= y0 && y <= y1) return lerp(z0, z1, (y - y0) / (y1 - y0));
  }
  return PROFILE[PROFILE.length - 1]![0];
}

/** Where the waterline crosses the strip's corridor: the wobble is zero there. */
const WATERLINE_Z = profileZ(0);
/**
 * The wheels' height where they touch the sand. The approach descends toward this fixed
 * level rather than following the ground: following it made the last third of a second
 * rise instead of fall, because the beach climbs faster than the flare comes down.
 */
const TOUCHDOWN_LEVEL = runwayLevel(TOUCHDOWN_Z) + 0.07;

/**
 * The shoreline's own wobble along X, in metres of Z. Zero across the strip's corridor so
 * the runway stays straight and growing either side of it: a beach is a curve, and a
 * perfectly straight waterline is what makes low-poly water read as a plane.
 */
function shoreOffset(x: number): number {
  const open = smoothstep(12, 46, Math.abs(x));
  return open * (5.2 * Math.sin(x * 0.011 + 0.7) + 2.6 * Math.sin(x * 0.037 + 2.1));
}

/** The drawn ground: the profile, wobbled, plus dunes away from the strip. */
function landHeight(x: number, z: number): number {
  const open = smoothstep(20, 60, Math.abs(x));
  const dry = smoothstep(-6, -20, z);
  const dunes =
    open * dry * (0.55 * Math.sin(x * 0.05 + 0.3) + 0.4 * Math.sin(z * 0.017 + x * 0.006 + 1.2));
  return profileY(z + shoreOffset(x)) + dunes;
}

/**
 * The height the wheels ride at: the sand where there is sand, the water's own level
 * over the shallows. Without the floor the final approach followed the sea bed down and
 * the tyres cut the water surface for the last few metres before the beach.
 */
function runwayLevel(z: number): number {
  return Math.max(0, landHeight(0, z));
}

/* ---- the sky ---- */

const SKY_VERTEX = `
varying vec3 vDirection;
void main() {
  vDirection = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SKY_FRAGMENT = `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uSunDirection;
uniform vec3 uSunColour;
varying vec3 vDirection;
void main() {
  vec3 dir = normalize(vDirection);
  float up = clamp(dir.y, -1.0, 1.0);
  vec3 sky = mix(uHorizon, uZenith, pow(clamp(up, 0.0, 1.0), 0.62));
  sky = mix(uGround, sky, smoothstep(-0.06, 0.06, up));
  // The sun's disc and the glow that widens just outside it. Kept small and only a
  // little over white: the descent is framed toward the sun's own side of the sky, so a
  // disc at two and a half times white is a blown blot on the film, while a 0.6-degree
  // disc (the real sun's own size) with a modest halo reads as a sun.
  float toSun = max(dot(dir, normalize(uSunDirection)), 0.0);
  sky += uSunColour * pow(toSun, 1400.0) * 1.35;
  sky += uSunColour * pow(toSun, 12.0) * 0.16;
  gl_FragColor = vec4(sky, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

interface EndingSky {
  readonly sunLight: THREE.DirectionalLight;
  dispose(): void;
}

/** Dome, sun, lights and the sky's own reflection for the water. */
function createSky(scene: THREE.Scene, webgl: THREE.WebGLRenderer): EndingSky {
  const geometry = new THREE.SphereGeometry(SKY_RADIUS, 32, 16);
  const material = new THREE.ShaderMaterial({
    vertexShader: SKY_VERTEX,
    fragmentShader: SKY_FRAGMENT,
    uniforms: {
      uZenith: { value: SKY_ZENITH.clone() },
      uHorizon: { value: SKY_HORIZON.clone() },
      uGround: { value: SKY_GROUND.clone() },
      uSunDirection: { value: SUN_DIRECTION.clone() },
      uSunColour: { value: SUN_COLOUR.clone() },
    },
    side: THREE.BackSide,
    // The sky is the backdrop: drawn first, never depth tested (render/sky.ts's dome).
    depthWrite: false,
    depthTest: false,
    fog: false,
  });
  const dome = new THREE.Mesh(geometry, material);
  dome.renderOrder = -10;
  dome.frustumCulled = false;
  scene.add(dome);

  const sunLight = new THREE.DirectionalLight(0xfff1d6, 3.4);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(1024, 1024);
  sunLight.shadow.camera.near = 1;
  sunLight.shadow.camera.far = 900;
  const half = 150;
  sunLight.shadow.camera.left = -half;
  sunLight.shadow.camera.right = half;
  sunLight.shadow.camera.top = half;
  sunLight.shadow.camera.bottom = -half;
  sunLight.shadow.bias = -0.0004;
  sunLight.shadow.normalBias = 0.03;
  sunLight.shadow.camera.updateProjectionMatrix();
  scene.add(sunLight, sunLight.target);

  // A low sky fill with a warm ground bounce: enough to keep the shadows blue rather
  // than black, not enough to flatten the sand and the scrub into one tone.
  scene.add(new THREE.HemisphereLight(0x8fb6e6, 0xd8a86a, 1.0));

  // The water's reflection: one bake of the same dome, as sky.ts bakes its own. The
  // probe's far plane has to be named, because Three's default is 100 m and would clip
  // the dome to nothing.
  const pmrem = new THREE.PMREMGenerator(webgl);
  const envGeometry = new THREE.SphereGeometry(50, 24, 12);
  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(envGeometry, material));
  const envTarget = pmrem.fromScene(envScene, 0, 0.5, 400);
  scene.environment = envTarget.texture;
  scene.environmentIntensity = ENVIRONMENT_INTENSITY;

  return {
    sunLight,
    dispose(): void {
      scene.environment = null;
      scene.clear();
      envGeometry.dispose();
      envTarget.dispose();
      pmrem.dispose();
      geometry.dispose();
      material.dispose();
    },
  };
}

/* ---- the ground ---- */

/** A grid of the drawn ground in the sand's own colours: one mesh, one draw call. */
function createGround(): THREE.BufferGeometry {
  const x0 = -420;
  const x1 = 420;
  const z0 = -430;
  // Seaward the grid has to reach past the shallows: the sand under the transparent
  // water is the bed the turquoise is read against, and a sheet with no bed shows sky.
  const z1 = 420;
  // ~4.7 m cells across, ~5 m up the beach: the waterline's wobble and the wet-sand band
  // are 10-30 m features, so anything coarser smears them into a single flat tone.
  const nx = 180;
  const nz = 170;
  const count = (nx + 1) * (nz + 1);
  const positions = new Float32Array(count * 3);
  const colours = new Float32Array(count * 4);
  const indices: number[] = [];
  const colour = new THREE.Color();

  let v = 0;
  for (let iz = 0; iz <= nz; iz++) {
    const z = lerp(z0, z1, iz / nz);
    for (let ix = 0; ix <= nx; ix++, v++) {
      const x = lerp(x0, x1, ix / nx);
      const height = landHeight(x, z);
      positions[v * 3] = x;
      positions[v * 3 + 1] = height;
      positions[v * 3 + 2] = z;

      // Wet sand below the waterline and a short stride above it, dry sand up the beach,
      // dry grass with dirt showing through as patches behind it, ochre hills at the
      // back. The wet band keys off the height rather than off z, so it follows the
      // waterline's own curve along X the way the water does. It is kept to the first
      // half-metre — the swash zone and nothing more — because the sea draws the band
      // that is actually wet, and it moves; a wide one baked into the sand would leave
      // a tide line out on the dry beach no water ever reached.
      colour.copy(SAND_DRY).lerp(SAND_WET, 1 - smoothstep(0, 0.6, height));
      // A little mottling: a hundred metres of beach is otherwise one flat tone.
      colour.multiplyScalar(
        0.95 + 0.09 * Math.sin(x * 0.085 + 2.3) * Math.sin(z * 0.05 + 0.9),
      );
      // Behind the sand: gravel showing through thin scrub, then the ochre plain the
      // buttes stand on. The scrub is held to patches — a third of the ground at most,
      // and never all of it — because a continuous cover reads as a field.
      const scrub = smoothstep(-95, -150, z);
      const patch = Math.sin(x * 0.062 + 1.1) * Math.sin(z * 0.029 - 0.4);
      const coverage = scrub * (0.3 + 0.5 * smoothstep(-0.35, 0.45, patch));
      colour.lerp(patch > 0.05 ? DIRT_DRY : GRASS_SCRUB, coverage);
      colour.lerp(PLAIN_OCHRE, smoothstep(-170, -330, z));
      colour.lerp(HILL, smoothstep(-330, -470, z));
      colours[v * 4] = colour.r;
      colours[v * 4 + 1] = colour.g;
      colours[v * 4 + 2] = colour.b;
      colours[v * 4 + 3] = 1;
    }
  }
  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      const a = iz * (nx + 1) + ix;
      const b = a + 1;
      const c = a + nx + 1;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 4));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

/** The packed strip the aeroplane lands on, and the markings down its centre. */
function createStrip(): THREE.BufferGeometry[] {
  const nx = 12;
  const nz = 60;
  const count = (nx + 1) * (nz + 1);
  const positions = new Float32Array(count * 3);
  const colours = new Float32Array(count * 4);
  const indices: number[] = [];
  const colour = new THREE.Color();

  let v = 0;
  for (let iz = 0; iz <= nz; iz++) {
    const z = lerp(STRIP_FROM_Z, STRIP_TO_Z, iz / nz);
    for (let ix = 0; ix <= nx; ix++, v++) {
      const x = lerp(-STRIP_HALF_W, STRIP_HALF_W, ix / nx);
      positions[v * 3] = x;
      positions[v * 3 + 1] = landHeight(x, z) + STRIP_LIFT;
      positions[v * 3 + 2] = z;
      // Packed earth across the middle, turning to darker soil along the two edges so
      // the strip reads as a made surface with defined edges against the sand rather
      // than as a band that fades into it.
      colour.copy(STRIP_PACKED).lerp(STRIP_EDGE, smoothstep(8.6, 10.4, Math.abs(x)));
      colours[v * 4] = colour.r;
      colours[v * 4 + 1] = colour.g;
      colours[v * 4 + 2] = colour.b;
      colours[v * 4 + 3] = 1;
    }
  }
  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      const a = iz * (nx + 1) + ix;
      const b = a + 1;
      const c = a + nx + 1;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const strip = new THREE.BufferGeometry();
  strip.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  strip.setAttribute('color', new THREE.BufferAttribute(colours, 4));
  strip.setIndex(indices);
  strip.computeVertexNormals();
  strip.computeBoundingSphere();

  // Markings: a threshold bar and four centre dashes, merged into one mesh.
  const quads: THREE.BufferGeometry[] = [];
  const colourOfQuad = new THREE.Color();
  const addQuad = (cx: number, cz: number, halfX: number, halfZ: number, hex: number): void => {
    const quad = new THREE.PlaneGeometry(halfX * 2, halfZ * 2);
    quad.rotateX(-Math.PI / 2);
    quad.translate(cx, landHeight(cx, cz) + STRIP_LIFT + 0.015, cz);
    colourOfQuad.setHex(hex);
    const count4 = quad.getAttribute('position').count * 4;
    const rgba = new Float32Array(count4);
    for (let i = 0; i < count4; i += 4) {
      rgba[i] = colourOfQuad.r;
      rgba[i + 1] = colourOfQuad.g;
      rgba[i + 2] = colourOfQuad.b;
      rgba[i + 3] = 1;
    }
    quad.setAttribute('color', new THREE.BufferAttribute(rgba, 4));
    quads.push(quad);
  };
  // The aiming point at the touchdown, and four dashes running inland from the stop.
  addQuad(0, TOUCHDOWN_Z + 3, 8, 0.55, 0xd8d3c4);
  for (let i = 0; i < 4; i++) addQuad(0, 2 - i * 34, 0.45, 5, 0xcfcabc);
  const markings = mergeGeometries(quads, false);
  for (const quad of quads) quad.dispose();
  return markings ? [strip, markings] : [strip];
}

/**
 * The sea: one sheet laid out along the shoreline rather than as a square grid, with
 * the two attributes `story/seashader.ts` works from (`aShore`, `aBed`).
 *
 * WHY THE ROWS FOLLOW DEPTH CONTOURS. `z = WATERLINE_Z + shoreOffset(x)` is the
 * waterline at every x, so a row at `SEA_ROWS[i]` metres seaward of it sits over exactly
 * the same bed height at every x: the shore's wobble is carried by the geometry instead
 * of being recomputed, and a row's depth is a resolved constant. That is what buys the
 * swash its resolution — a dozen rows inside the sixteen metres of beach the wash runs
 * over, and eleven more inside the first ten metres of water — without spending a
 * vertex on the water two kilometres out, which a uniform grid cannot do at any
 * resolution anybody would pay for.
 *
 * WHY THE SURFACE SITS ON THE SAND INSIDE THE WATERLINE. Seaward of the waterline the
 * sheet is flat water at y = 0 and the bed shows through it, which is where the
 * turquoise comes from. Landward of it the sheet rides 7 cm over the sand it has just
 * washed, because that is where the swash and the wet band are drawn: foam running up
 * the beach has to be drawn on the beach, and a sheet left at y = 0 would be buried by
 * the sand it is supposed to be lying on.
 */
function createSea(): THREE.BufferGeometry {
  // Columns: dense over the strip's corridor, where the camera lives and where the
  // swash is read; growing fast toward the edges of the drawn sea.
  const nx = 150;
  const xHalf = 1600;
  const rows = SEA_ROWS.length;
  const count = (nx + 1) * rows;
  const positions = new Float32Array(count * 3);
  const shoreOffsets = new Float32Array(count);
  const beds = new Float32Array(count);
  const indices: number[] = [];

  // The bed under each row is the profile's own height there, resolved once: the row
  // is a contour, so it is the same number at every x.
  const rowBed = SEA_ROWS.map((beyond) => profileY(WATERLINE_Z + beyond));

  let v = 0;
  for (let ix = 0; ix <= nx; ix++) {
    const t = (ix / nx) * 2 - 1;
    // Two thirds of the columns inside the first fifth of the width: the beach a
    // camera can stand on is a hundred metres wide and the sea is three kilometres.
    const x = Math.sign(t) * (0.35 * Math.abs(t) + 0.65 * Math.pow(Math.abs(t), 3.2)) * xHalf;
    // The rows shift with the waterline, so the sheet's edge is the shore's own curve.
    const shore = WATERLINE_Z - shoreOffset(x);
    for (let iy = 0; iy < rows; iy++, v++) {
      const beyond = SEA_ROWS[iy]!;
      const bed = rowBed[iy]!;
      positions[v * 3] = x;
      // Flat at the waterline's own level over the water; lying on the sand a few
      // centimetres clear of it where the sand is above the waterline.
      positions[v * 3 + 1] = Math.max(bed, 0) + 0.07 * smoothstep(-0.05, 0.35, bed);
      positions[v * 3 + 2] = shore + beyond;
      shoreOffsets[v] = beyond;
      beds[v] = bed;
    }
  }
  for (let ix = 0; ix < nx; ix++) {
    for (let iy = 0; iy < rows - 1; iy++) {
      const a = ix * rows + iy;
      const b = a + rows;
      const c = a + 1;
      const d = b + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aShore', new THREE.BufferAttribute(shoreOffsets, 1));
  geometry.setAttribute('aBed', new THREE.BufferAttribute(beds, 1));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * One ridge layer: a cutout wall whose crest is a sum of two sines, tapering into the
 * haze at both ends. `haze` mixes it toward the ridges' own air — a cooler, bluer tone
 * than the horizon haze it used to take — which is what makes three flat layers read as
 * depth instead of as three flat layers.
 */
function createRidge(z: number, crest: number, seed: number, haze: number): THREE.BufferGeometry {
  const segments = 72;
  const width = 4200;
  const positions = new Float32Array((segments + 1) * 2 * 3);
  const colours = new Float32Array((segments + 1) * 2 * 4);
  const indices: number[] = [];
  const colour = new THREE.Color();

  for (let i = 0; i <= segments; i++) {
    const x = lerp(-width / 2, width / 2, i / segments);
    const taper = 1 - smoothstep(0.3, 0.5, Math.abs(x) / width);
    const shape =
      0.55 + 0.45 * (0.62 * Math.sin(x * 0.0072 + seed) + 0.38 * Math.sin(x * 0.0231 + seed * 2.7));
    const top = Math.max(0.1, shape) * crest * taper;
    const base = i * 2;
    positions[base * 3] = x;
    positions[base * 3 + 1] = -8;
    positions[base * 3 + 2] = z;
    positions[(base + 1) * 3] = x;
    positions[(base + 1) * 3 + 1] = top;
    positions[(base + 1) * 3 + 2] = z;
    colour.copy(RIDGE_BASE).lerp(RIDGE_HAZE, haze);
    const r = colour.r;
    const g = colour.g;
    const b = colour.b;
    colours[base * 4] = r * 0.86;
    colours[base * 4 + 1] = g * 0.86;
    colours[base * 4 + 2] = b * 0.86;
    colours[base * 4 + 3] = 1;
    colours[(base + 1) * 4] = r * 1.05;
    colours[(base + 1) * 4 + 1] = g * 1.05;
    colours[(base + 1) * 4 + 2] = b * 1.05;
    colours[(base + 1) * 4 + 3] = 1;
  }
  for (let i = 0; i < segments; i++) {
    const a = i * 2;
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 4));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

/* ---- the mesas ---- */

/**
 * One butte: a flat-topped table on the plain behind the beach. `rx`/`rz` are the
 * footprint's radii at the wall's foot, and `top` is the ABSOLUTE height of the
 * plateau, because that is the number the flight path is checked against.
 */
interface MesaSite {
  readonly x: number;
  readonly z: number;
  readonly rx: number;
  readonly rz: number;
  /** The plateau's height above y = 0, metres. */
  readonly top: number;
  readonly rotation: number;
}

/**
 * The table mountains the aeroplane comes in over.
 *
 * THE HEIGHTS ARE PLACED AGAINST THE GLIDE PATH, not chosen for looks alone. The
 * descent is a fixed curve — `APPROACH_ALT` at `APPROACH_Z` easing down to the strip at
 * `TOUCHDOWN_Z` — so any butte whose footprint reaches the flight line x = 0 has a
 * ceiling on its plateau, and the ceiling is low: the aeroplane is only forty metres up
 * on the way in and nineteen by the time it is overhead. That is why the buttes are
 * placed in two bands. The one the flight line runs through is small and flat, and the
 * wheels cross its rim about five metres above it; everything tall stands aside from
 * the line by a wing's worth of clear air, where its height is free and its job is
 * simply to be seen — a butte whose plateau is sixty metres up, standing two hundred
 * metres from the approach, is the whole point of the shot.
 *
 * HOW SHARP A WALL IS. The profile below climbs 0.46 of the wall over the first 0.16 of
 * the radius, so a butte only reads as a table rather than as a mound when its wall is
 * a good fraction of its radius. Everything here is therefore far taller than it is
 * wide (sixty metres of wall on a hundred and forty of radius), which is the proportion
 * the game's own mesas have — they are six to nine hundred metres up on two to eight
 * hundred of radius.
 *
 * Every centre stays inside the drawn ground's own rectangle with its whole footprint,
 * so no mesa shows a base floating over the void beyond it, and all of them stand
 * inland of the scrub line, so nothing sits on the beach itself.
 */
const MESAS: readonly MesaSite[] = [
  /**
   * The first rim the aeroplane crosses, dead under the entry, crossed at half a second
   * — while the film is still coming up from black. A small flat-topped butte, twenty-
   * eight metres to its plateau. Small on purpose: the same plateau height spread over
   * five times the radius would be a slope, not a rim.
   */
  { x: 0, z: -319, rx: 55, rz: 48, top: 28, rotation: 0.6 },
  /**
   * The SECOND rim, and the one the film actually shows being crossed: its plateau's edge
   * is at z = -248, which is a second and three quarters in — fully lit, the fade long
   * done — and the wheels clear it by five and a half metres with the whole cliff face
   * below them across the lower half of the first shot. Sized so that the crossing
   * happens after the fade rather than inside it, which is the only reason there are two
   * of these on the line instead of one.
   */
  { x: 0, z: -268, rx: 45, rz: 45, top: 20, rotation: 2.9 },
  /**
   * The tall one beside the approach, its eastern wall twenty-seven metres off the
   * wingtip and its plateau thirty metres ABOVE the aeroplane as it comes in: the
   * first thing the first shot sees, and the table mountain the descent is framed by.
   */
  { x: -110, z: -345, rx: 75, rz: 95, top: 72, rotation: 2.1 },
  /** The big one further west, for depth behind it. */
  { x: -250, z: -430, rx: 140, rz: 170, top: 88, rotation: 3.4 },
  /** East of the line: one mid, one far, so the plain is buttes either side. */
  { x: 210, z: -380, rx: 110, rz: 130, top: 62, rotation: 1.2 },
  { x: 300, z: -430, rx: 95, rz: 110, top: 54, rotation: 4.6 },
  /**
   * A lower one further down the plain, level with the scrub: it is the butte the second
   * shot has behind the aeroplane's landing run.
   */
  { x: -200, z: -260, rx: 85, rz: 80, top: 40, rotation: 0.3 },
];

/**
 * All six mesas as one merged geometry: one draw call, one material, and nothing that
 * moves. Each is the ring profile the game's own mesas are built from, with the skirt
 * buried under the sand, the two lowest rings fitted to the sand under them (so the
 * footprint follows the plain's own slope) and the plateau fanned off one centre height.
 */
function createMesas(): THREE.BufferGeometry {
  const segments = 22;
  const positions: number[] = [];
  const colours: number[] = [];
  const indices: number[] = [];
  const colour = new THREE.Color();
  const haze = new THREE.Color();

  MESAS.forEach((mesa, index) => {
    const centreY = landHeight(mesa.x, mesa.z);
    const wall = mesa.top - centreY;
    // The range's own air: a mesa four hundred metres out is already a shade cooler
    // than the sand in front of it, which is what puts it behind the beach rather than
    // on it. The ridge layers behind take the same treatment further.
    const air = smoothstep(180, 700, Math.hypot(mesa.x, mesa.z)) * 0.3;
    const first = positions.length / 3;

    for (let ring = 0; ring < MESA_RINGS.length; ring++) {
      const [radiusFrac, heightFrac] = MESA_RINGS[ring]!;
      for (let segment = 0; segment < segments; segment++) {
        const theta = mesa.rotation + (segment / segments) * Math.PI * 2;
        // One outline per angular segment, shared by every ring: noise per ring twists
        // one nominal wall quad into two triangles with nothing between them.
        const irregular = 0.88 + hashUnit3(0x4d455341, index * 31 + segment, 1) * 0.22;
        const px = mesa.x + Math.cos(theta) * mesa.rx * radiusFrac * irregular;
        const pz = mesa.z + Math.sin(theta) * mesa.rz * radiusFrac * irregular;
        const base = ring <= 1 ? landHeight(px, pz) : centreY;
        const y = ring === 0 ? base - 2.5 : base + wall * heightFrac;
        // The wall in its own shade, the plateau in the sun: a butte is read from the
        // light on its top, and one flat tone turns the cliff into a cardboard cut-out.
        const lit = heightFrac === 1 ? 1 : 0.8 + 0.2 * heightFrac;
        const shade = (0.96 + hashUnit3(0x4d455341, index * 97 + segment, 2) * 0.08) * lit;
        haze.copy(RIDGE_HAZE);
        colour.copy(MESA_ROCK).lerp(MESA_TOP, heightFrac).multiplyScalar(shade).lerp(haze, air);
        positions.push(px, y, pz);
        colours.push(Math.min(1, colour.r), Math.min(1, colour.g), Math.min(1, colour.b), 1);
      }
    }

    for (let ring = 0; ring < MESA_RINGS.length - 1; ring++) {
      const current = first + ring * segments;
      const next = current + segments;
      for (let segment = 0; segment < segments; segment++) {
        const b = (segment + 1) % segments;
        indices.push(
          current + segment, next + segment, current + b,
          current + b, next + segment, next + b,
        );
      }
    }
    const topRing = first + (MESA_RINGS.length - 1) * segments;
    const centre = positions.length / 3;
    positions.push(mesa.x, mesa.top, mesa.z);
    haze.copy(RIDGE_HAZE);
    colour.copy(MESA_TOP).lerp(haze, air);
    colours.push(colour.r, colour.g, colour.b, 1);
    for (let segment = 0; segment < segments; segment++) {
      indices.push(centre, topRing + ((segment + 1) % segments), topRing + segment);
    }
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 4));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

/* ---- the palms ---- */

/** How many palm variants the tableau offers, and how many palms stand on the beach. */
const PALM_VARIANTS = 3;

/**
 * Where the palms stand: a grove round the house and a loose scatter down both reaches
 * of the beach either side of the strip.
 *
 * BOTH ARE HASHED OUT, NOT LISTED. A hand-placed line of palms along a shoreline is the
 * one arrangement that reads as furniture, so the radius, the angle, the height and the
 * yaw are all jittered per palm, no two stand nearer than eight metres, and a candidate
 * that lands in the strip's own corridor, in the wash, up on the scrub or inside the
 * house's footprint is simply dropped. The scatter is deterministic (a fixed set of
 * hashes over a fixed index), so the grove is the same grove every time the ending runs.
 */
function palmSites(): readonly { x: number; z: number }[] {
  const sites: { x: number; z: number }[] = [];
  const keep = (x: number, z: number): void => {
    // Nothing in the strip's corridor — the aeroplane rolls down it — nothing standing
    // in water the swash reaches, and nothing out on the scrub.
    if (Math.abs(x) < 17) return;
    if (landHeight(x, z) < 0.45 || z < -58) return;
    if (Math.hypot(x - HOUSE_X, z - HOUSE_Z) < 8) return;
    for (const site of sites) if (Math.hypot(site.x - x, site.z - z) < 8) return;
    sites.push({ x, z });
  };

  // The grove: an annulus round the house, thinned along the seaward side by the wash.
  for (let i = 0; i < 11; i++) {
    const angle = hashUnit3(0x9a17, i, 1) * Math.PI * 2;
    const radius = 11 + hashUnit3(0x9a17, i, 2) * 26;
    keep(HOUSE_X + Math.cos(angle) * radius, HOUSE_Z - 4 + Math.sin(angle) * radius * 0.85);
  }
  // The beach: both reaches, out on the sand and the scrub edge behind it. The scatter is
  // kept north of z = -36 because the last shot's camera stands and pulls back through
  // the beach south-east of the house: a palm inside twenty-five metres of that lens
  // would fill a corner of the held frame with a crown the size of the aeroplane.
  for (let i = 0; i < 10; i++) {
    const side = i % 2 === 0 ? 1 : -1;
    const x = side * (34 + hashUnit3(0x9a17, i, 3) * 120);
    const z = 18 - hashUnit3(0x9a17, i, 4) * 54;
    keep(x, z);
  }
  return sites;
}

/**
 * The mirage tableau's own palms, planted for good: an instanced grove over
 * `palmGeometry(variant)` and the tableau's own `cardMaterial()`.
 *
 * WHY THE SAME GEOMETRY. `palmGeometry` is two crossed painted cards per palm, a lit
 * half and a shaded half down each frond's spine, with the fronds spread through the
 * crown's own depth — the whole reason a flat card reads as a palm from any angle the
 * shots use, and the reason three silhouettes are mixed rather than one repeated.
 *
 * WHY THEY DO NOT VANISH. A mirage palm is held at zero opacity until its encounter
 * streams in and is faded out again as the camera closes on it, which is what a mirage
 * does. This beach wants the opposite, so the material arrives at full opacity and is
 * left there; the cards are lit by their own palette, not by the scene's sun.
 *
 * HOW AN UNLIT CARD SITS IN A LIT SCENE. It sits there the way the game's own palms
 * do: the card palette is authored bright (see `displayColour`'s note — these pales
 * are what the screen receives after the tone map, not albedos), and the per-instance
 * tint the tableau uses multiplies it rather than replacing it, so each palm keeps a
 * light of its own that no shadow pass has to agree with. What places them among the
 * lit sand and the cast shadows is the scene's own fog, which every card takes, and
 * the grove's scale: eight to ten metres of palm on a two-metre beach is the same
 * reading the driver gets when one passes the windscreen.
 */
function createPalms(): { meshes: THREE.InstancedMesh[]; material: THREE.MeshBasicMaterial } {
  const sites = palmSites();
  const material = cardMaterial();
  material.opacity = 1;
  const perVariant: { x: number; z: number }[][] = Array.from(
    { length: PALM_VARIANTS },
    () => [],
  );
  sites.forEach((site, index) => {
    const variant = Math.min(PALM_VARIANTS - 1, Math.floor(hashUnit3(0x5eed, index, 7) * PALM_VARIANTS));
    perVariant[variant]!.push(site);
  });

  const meshes: THREE.InstancedMesh[] = [];
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const tint = new THREE.Color();

  perVariant.forEach((group, variant) => {
    const mesh = new THREE.InstancedMesh(palmGeometry(variant), material, Math.max(1, group.length));
    group.forEach((site, index) => {
      // A palm is eight to ten metres of trunk and crown, and a little wider than it
      // is tall: the cards are a unit silhouette, so the scale IS the height.
      const height = 6.5 + hashUnit3(0x5eed, variant * 53 + index, 11) * 3.5;
      const girth = 0.85 + hashUnit3(0x5eed, variant * 53 + index, 12) * 0.3;
      const lean = (hashUnit3(0x5eed, variant * 53 + index, 13) - 0.5) * 0.09;
      const facing = hashUnit3(0x5eed, variant * 53 + index, 14) * Math.PI * 2;
      position.set(site.x, landHeight(site.x, site.z) - 0.12, site.z);
      euler.set(0, facing, lean, 'YXZ');
      quaternion.setFromEuler(euler);
      scale.set(height * girth, height, height * girth);
      matrix.compose(position, quaternion, scale);
      mesh.setMatrixAt(index, matrix);
      // The haze lift the tableau multiplies over the card palette (near white, so it
      // varies the light on a palm rather than colouring it), with the same eight per
      // cent of variation between one palm and the next that a grove has.
      const lift = 0.94 + hashUnit3(0x5eed, variant * 53 + index, 15) * 0.16;
      tint.copy(PALM_TINT).multiplyScalar(lift);
      mesh.setColorAt(index, tint);
    });
    mesh.count = group.length;
    mesh.visible = group.length > 0;
    // A crossed card's shadow is the card's own silhouette stretched along the sun, so
    // a palm still lays a palm on the sand.
    mesh.castShadow = true;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    meshes.push(mesh);
  });

  return { meshes, material };
}

/** Shrubs: flattened spheres, one mesh, scattered on the scrub behind the beach. */
function createShrubs(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 12; i++) {
    // Both sides of the strip's corridor, and inland of the sand: scrub is what grows
    // where the beach stops.
    const side = i % 2 === 0 ? 1 : -1;
    const x = side * (20 + ((i * 137) % 150));
    const z = -104 - ((i * 61) % 130);
    const shrub = new THREE.SphereGeometry(1, 6, 5);
    shrub.scale(0.75 + (i % 3) * 0.2, 0.4, 0.75 + (i % 4) * 0.15);
    shrub.translate(x, landHeight(x, z) + 0.24, z);
    parts.push(shrub);
  }
  const merged = mergeGeometries(parts, false)!;
  for (const part of parts) part.dispose();
  return merged;
}

/**
 * Runs the ending and resolves when the black is complete. The caller clears the resume
 * slot and reloads: there is nothing to hand back, and nothing here survives it.
 */
export async function playEnding(opts: EndingOptions): Promise<void> {
  const { renderer, audio, overlay } = opts;
  const webgl = renderer.renderer;
  const canvas = webgl.domElement;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(SKY_HORIZON.getHex(), FOG_DENSITY);
  const camera = new THREE.PerspectiveCamera(
    46,
    Math.max(1, canvas.clientWidth) / Math.max(1, canvas.clientHeight),
    0.5,
    3200,
  );
  const sky = createSky(scene, webgl);

  // --- the land, the strip and the sea -------------------------------------------
  const groundGeometry = createGround();
  const groundMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.94, metalness: 0 });
  const ground = new THREE.Mesh(groundGeometry, groundMaterial);
  ground.receiveShadow = true;
  scene.add(ground);

  const stripGeometries = createStrip();
  const strip = new THREE.Mesh(stripGeometries[0]!, groundMaterial);
  strip.receiveShadow = true;
  scene.add(strip);
  const markings = stripGeometries[1] ? new THREE.Mesh(stripGeometries[1], groundMaterial) : null;
  if (markings) {
    markings.receiveShadow = true;
    scene.add(markings);
  }

  const water = createSeaMaterial({
    zenith: SKY_ZENITH,
    horizon: SKY_HORIZON,
    ground: SKY_GROUND,
    sunColour: SUN_COLOUR,
    sunDirection: SUN_DIRECTION,
    deep: SEA_DEEP,
    shallow: SEA_SHALLOW,
    foam: SEA_FOAM,
    wetSand: SAND_SOAKED,
    fogDensity: FOG_DENSITY,
  });
  const seaGeometry = createSea();
  const sea = new THREE.Mesh(seaGeometry, water.material);
  sea.renderOrder = 1;
  scene.add(sea);

  // Three ridge layers, each hazier than the one in front of it. They are sized so the
  // crests subtend 10-12 degrees from the strip — a range behind the mesas, not a band on
  // the skyline — and each farther layer stands a little taller on screen than the one in
  // front, which is what stacks them instead of hiding them.
  const ridgeMaterial = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 1,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  const ridges: THREE.Mesh[] = [
    createRidge(-560, 105, 0.6, 0.18),
    createRidge(-980, 190, 2.3, 0.42),
    createRidge(-1520, 320, 4.1, 0.62),
  ].map((geometry) => {
    const mesh = new THREE.Mesh(geometry, ridgeMaterial);
    scene.add(mesh);
    return mesh;
  });

  // The mesas the aeroplane comes down over, between the scrub and the ranges. Flat
  // shaded: a butte is all edges, and a smooth normal across the rim turns the plateau
  // into a hill. One geometry, one draw call, six tables.
  const mesaMaterial = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.97,
    metalness: 0,
    flatShading: true,
  });
  const mesas = new THREE.Mesh(createMesas(), mesaMaterial);
  mesas.castShadow = true;
  mesas.receiveShadow = true;
  scene.add(mesas);

  // The house: a dwelling from the catalogue the roadscape uses. Its body geometry is
  // the session cache every POI house shares, so it is NOT disposed with the rest.
  let houseIndex = HOUSE_FALLBACK_INDEX;
  for (let i = 0; i < structureCount(); i++) {
    if (structureDef(i).id === HOUSE_ID) houseIndex = i;
  }
  const house = createStructureInstance(houseIndex);
  house.group.position.set(HOUSE_X, landHeight(HOUSE_X, HOUSE_Z) - 0.06, HOUSE_Z);
  house.group.rotation.set(0, HOUSE_YAW, 0);
  house.group.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
  scene.add(house.group);

  // The palms: the mirage tableau's own, planted on a shore that does not fade.
  const palm = createPalms();
  for (const mesh of palm.meshes) scene.add(mesh);

  const shrubs = new THREE.Mesh(
    createShrubs(),
    new THREE.MeshStandardMaterial({ color: 0x5e6d3c, roughness: 0.95 }),
  );
  shrubs.castShadow = true;
  shrubs.receiveShadow = true;
  scene.add(shrubs);

  // The aeroplane: its own instance, because the parked one belongs to the world scene.
  const plane: LightPlane = createLightPlane();
  scene.add(plane.group);
  const propeller: PropellerVoice = audio.createPropellerVoice();
  const surf: SurfVoice = audio.createSurfVoice();
  // The world's own frame loop has stopped, so its bus is taken down for good.
  audio.setWorldLevel(0.06, 1.2);

  // The pass's own air, set explicitly: the game's last frame described a desert.
  // The veil is what hazed this scene grey-blue: at 0.1 the air mixed the beach, the
  // aeroplane and the ridges a tenth of the way to the horizon's colour everywhere past
  // 320 m, on top of the scene's own fog. A tenth of that keeps the far air while the
  // sand stays sand; the grade takes a little more colour back than the game's 1.0.
  renderer.setDaylight(1);
  // The shimmer is scaled by the eye's height above the ground, and this ending's eyes
  // are 2 m for the first three shots and eight to sixteen for the last one, so the
  // value is a compromise rather than the 1.6 m a car's windscreen assumes.
  renderer.setHeatHaze({ shimmer: 0.18, mirage: 0.06, eyeAboveM: 4.5, groundSlope: 0.02 });
  renderer.setWeather({
    wallM: -1,
    windX: 1,
    windZ: 0,
    wallAlongM: 0,
    timeS: 0,
    sunDirection: SUN_DIRECTION,
    sunColor: SUN_COLOUR,
    air: SKY_HORIZON,
    saturation: 1.06,
    veil: 0.04,
    airThick: 0.12,
    weatherFog: FOG_DENSITY,
  });

  const rig = new ShotRig();
  const eye = new THREE.Vector3();
  const lookAt = new THREE.Vector3();
  const planePos = new THREE.Vector3();
  const housePoint = new THREE.Vector3();
  const sunPosition = new THREE.Vector3();
  // The aeroplane's own state; the shots read it rather than assuming it.
  const flight = { z: TOUCHDOWN_Z, y: 0, pitch: 0, bank: 0, prop: 0, level: 0 };
  const rollDistance = STOP_Z - TOUCHDOWN_Z;
  let elapsed = 0;
  let shot = -1;
  let creditsStarted = false;
  let fadeStarted = false;

  /** Every frame of the ending: the flight, the sound, the shot and the draw. */
  const frame = (dt: number): void => {
    elapsed += dt;

    // --- the flight --------------------------------------------------------------
    if (elapsed < TOUCHDOWN_AT) {
      const u = elapsed / TOUCHDOWN_AT;
      flight.z = lerp(APPROACH_Z, TOUCHDOWN_Z, u);
      // Flared: the last metres of the descent are nearly level, and the whole descent is
      // a single glide path down to the strip's own height — not a follow of the sand
      // below, which over the rising plain would read as a height above the ground it is
      // not at. It is the same curve whether the aeroplane is over a mesa or over the
      // beach, which is what keeps the pass over the rim in the first shot honest.
      flight.y = TOUCHDOWN_LEVEL + APPROACH_ALT * Math.pow(1 - u, 1.7);
      flight.pitch = lerp(0.02, FLARE_PITCH, smoothstep(0.55, 1, u));
      // A touch of bank through the first seconds, easing out as it settles on final.
      // Its own left is +X now (the nose is +Z), so the negative sign is the aeroplane
      // dipping the wing away from the mesa it has just crossed.
      flight.bank = -0.05 * (1 - smoothstep(0, 0.5, u));
      flight.prop = 0.62;
      flight.level = 0.72;
    } else if (elapsed < STOPPED_AT) {
      const u = (elapsed - TOUCHDOWN_AT) / (STOPPED_AT - TOUCHDOWN_AT);
      // The roll-out, toward the water: constant deceleration, so the distance covered is
      // `2u - u²` of the run and the aeroplane is stopped at `STOPPED_AT`.
      flight.z = TOUCHDOWN_Z + rollDistance * (2 * u - u * u);
      flight.pitch = lerp(FLARE_PITCH, ROLL_PITCH, smoothstep(0, 0.35, u));
      // The wheels' contact is the model's origin, so the nose-down braking attitude has
      // to be paid for or the nose wheel would stand a centimetre in the sand.
      flight.y = runwayLevel(flight.z) + 0.07 - Math.min(0, flight.pitch) * 2.3;
      flight.bank = 0;
      flight.prop = lerp(0.62, 0.27, smoothstep(0, 0.3, u));
      flight.level = lerp(0.72, 0.35, smoothstep(0, 0.3, u));
    } else {
      flight.z = STOP_Z;
      flight.pitch = ROLL_PITCH;
      flight.y = runwayLevel(STOP_Z) + 0.07 - Math.min(0, flight.pitch) * 2.3;
      const down = smoothstep(STOPPED_AT, SPUN_DOWN_AT, elapsed);
      const u = clamp((elapsed - STOPPED_AT) / (SPUN_DOWN_AT - STOPPED_AT), 0, 1);
      // The last of the revs falls away faster than the idle it came down through.
      flight.prop = (1 - u) * (1 - u) * 0.27;
      flight.level = (1 - down) * 0.35;
    }

    planePos.set(0, flight.y, flight.z);
    plane.group.position.copy(planePos);
    plane.group.rotation.set(-flight.pitch, RUNWAY_YAW, -flight.bank, 'YXZ');
    plane.spin(dt, flight.prop);
    propeller.set(flight.prop, flight.level);

    // Surf rises as the propeller dies: the sea is what is left.
    surf.set(
      lerp(0.32, 0.62, smoothstep(1.5, TOUCHDOWN_AT, elapsed))
        + 0.38 * smoothstep(TOUCHDOWN_AT, SPUN_DOWN_AT, elapsed),
    );

    // --- the shots ---------------------------------------------------------------
    const want =
      elapsed < SHOT_BEACH_AT ? 0
        : elapsed < SHOT_ROLL_AT ? 1
          : elapsed < SHOT_HOUSE_AT ? 2
            : 3;
    if (want !== shot) {
      shot = want;
      // The opening shot is not a cut: the cutscene simply starts there.
      if (want !== 0) rig.cut();
    }

    if (shot === 0) {
      // Out on the plain east of the flight line, far enough back that the two low buttes
      // it crosses fill the lower frame whole instead of one cliff filling all of it: the
      // aeroplane comes over their plateaus against the sky, the tall table mountain to
      // the west behind it, and the pan carries it down out of the mesa country toward
      // the beach. From beside the second butte's wall (the first cut of this shot) the
      // rim hid the aeroplane at the very moment it crossed.
      eye.set(120, landHeight(120, -215) + 5, -215);
      lookAt.copy(planePos);
      lookAt.y -= 4;
      rig.update(dt, eye, lookAt, 40);
    } else if (shot === 1) {
      // Standing on the wet sand two metres above the tide line, east of the strip and
      // looking inland: the swash runs up to the foot of the frame and back out of it, the
      // dry beach climbs to the strip, and the aeroplane comes down out of the mesas
      // almost straight at the lens — the camera is twenty-three metres east of the flight
      // line, so it is one continuous pan and never an about-face — touches down and rolls
      // the last stretch toward the camera. The lens pushes in from a wide 44 to a 30 as
      // it comes, which is what keeps a light single reading as an aeroplane rather than
      // as a speck at a hundred metres, and the sand at the foot of the frame is why the
      // camera stands here rather than in the shallows: from out in the water the sheet a
      // metre under the lens fills the bottom of the picture with a flat smear.
      // East rather than west because the house's grove stands west of the strip: from
      // that side the arrival lined up behind a palm, and a palm the size of the
      // aeroplane is a palm that hides it.
      const push = smoothstep(SHOT_BEACH_AT, TOUCHDOWN_AT, elapsed);
      eye.set(23, landHeight(23, 27) + 2.1, 27);
      lookAt.copy(planePos);
      lookAt.y += 0.5;
      rig.update(dt, eye, lookAt, 44 - 14 * push);
    } else if (shot === 2) {
      // From just off the strip's west edge and eighteen metres behind the aeroplane,
      // tracking with it: the roll-out seen from behind — the wheels' run down the packed
      // earth, the strip and the beach opening out ahead of it, the surf line across the
      // frame beyond the nose, the sea and the horizon over that, and the palms down the
      // beach off to its right. Behind rather than beside because the house's grove stands
      // between the strip and the house: a side-on camera in either of those places looks
      // through a palm, and one raised enough to clear them loses the surf line.
      eye.set(-14, landHeight(-14, flight.z - 18) + 2.5, flight.z - 18);
      lookAt.copy(planePos);
      lookAt.y += 1.2;
      rig.update(dt, eye, lookAt, 40);
    } else {
      // The held shot: from the scrub inland and east of both, looking seaward-diagonal,
      // so the frame reads scrub and beach in the foreground, the aeroplane and then the
      // house with its palms across the middle, the wet sand and the surf, and then the
      // sea — with the sun's path on the water just left of the aeroplane and the horizon
      // in the upper third. A slow rise and pull back, with a longer lens as it goes: the
      // sea grows in the frame while the aeroplane settles into it.
      const u = smoothstep(SHOT_HOUSE_AT, FADE_OUT_AT, elapsed);
      const ex = 34 + 10 * u;
      const ez = -56 - 14 * u;
      eye.set(ex, landHeight(ex, ez) + 8 + 8 * u, ez);
      housePoint.set(HOUSE_X, landHeight(HOUSE_X, HOUSE_Z) + 2.2, HOUSE_Z);
      // Between the aeroplane and the house, and a little past the midpoint: the frame
      // has to hold the aeroplane left of centre with the sun's path on the water just
      // right of it, and the house with its palms to the right of both.
      lookAt.lerpVectors(planePos, housePoint, 0.55);
      lookAt.y += 1;
      // A long-ish lens that tightens as the camera rises, so the aeroplane and the
      // house keep their size while the sea grows behind them: three's `fov` is the
      // VERTICAL one, so 36-42 here is a 59-66 degree horizontal frame.
      rig.update(dt, eye, lookAt, 36 + 6 * u);
    }

    // --- the overlay -------------------------------------------------------------
    if (!creditsStarted && elapsed >= CREDITS_AT) {
      creditsStarted = true;
      void overlay.showCredits(CREDIT_LINES, CREDITS_S);
    }
    if (!fadeStarted && elapsed >= FADE_OUT_AT) {
      fadeStarted = true;
      void overlay.fadeTo(1, FADE_OUT_S);
    }

    // --- the draw ----------------------------------------------------------------
    water.advance(dt);
    const aspect = Math.max(1, canvas.clientWidth) / Math.max(1, canvas.clientHeight);
    if (Math.abs(camera.aspect - aspect) > 1e-4) {
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
    }
    camera.position.copy(rig.eye);
    camera.lookAt(rig.lookAt);
    // The sun light follows the action, so the shadow frustum stays on the aeroplane.
    sunPosition.copy(planePos).addScaledVector(SUN_DIRECTION, 320);
    sky.sunLight.position.copy(sunPosition);
    sky.sunLight.target.position.copy(planePos);
    sky.sunLight.target.updateMatrixWorld();
    renderer.renderAlternate(scene, camera);
  };

  // The scene opens black; the warm-up frame compiles the ending's own programs while
  // nothing can be seen, so the reveal never stutters.
  await overlay.fadeTo(1, 0);
  frame(0);
  void overlay.fadeTo(0, FADE_IN_S);

  await new Promise<void>((resolve) => {
    let previous = performance.now();
    let handle = 0;
    const step = (now: number): void => {
      const dt = clamp((now - previous) / 1000, 0, 0.1);
      previous = now;
      frame(dt);
      if (elapsed >= TOTAL_S) {
        cancelAnimationFrame(handle);
        resolve();
        return;
      }
      handle = requestAnimationFrame(step);
    };
    handle = requestAnimationFrame(step);
  });

  // Everything ends black, whatever the clock did.
  await overlay.fadeTo(1, 0.5);

  // --- teardown ------------------------------------------------------------------
  propeller.dispose();
  surf.dispose();
  plane.dispose();
  water.dispose();
  const owned: (THREE.Mesh | null)[] = [ground, strip, markings, sea, shrubs, mesas, ...palm.meshes];
  for (const mesh of owned) {
    if (!mesh) continue;
    scene.remove(mesh);
    mesh.geometry.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) for (const one of material) one.dispose();
    else material.dispose();
  }
  for (const mesh of ridges) {
    scene.remove(mesh);
    mesh.geometry.dispose();
  }
  ridgeMaterial.dispose();
  scene.remove(house.group);
  // The dwelling's shared geometry and material belong to the session cache, not to this
  // scene, and `sky.dispose` clears what is left of the graph.
  sky.dispose();
}
