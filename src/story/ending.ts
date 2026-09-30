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
 * THE SHAPE OF THE SCENE: sea to the north (+Z), a wavy waterline with a surf line of
 * foam over it, a wide beach of wet-then-dry sand climbing into a flat, a packed strip
 * laid along Z whose seaward threshold sits at the water's edge, a small house on the
 * scrub behind the strip's inland end, palms, and three layers of blue ridges behind.
 * The aeroplane comes in low over the water, touches down on the wet sand just inside
 * the strip, rolls inland and stops by the house. The camera never looks out to sea for
 * long: the last held composition is from over the shallows looking inland-diagonal, so
 * house, aeroplane and the ridges behind them are in one frame.
 *
 * Everything here is thrown away at the end: the geometries and materials this module
 * built are disposed, and the process reloads. The ONE exception is the dwelling's body,
 * which is the session-cached geometry every POI house shares (world/poistructures.ts)
 * and therefore outlives this scene.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Renderer } from '../core/renderer';
import type { GameAudio } from '../audio/gameaudio';
import type { PropellerVoice, SurfVoice } from '../audio/storyaudio';
import { createStructureInstance, structureCount, structureDef } from '../world/poistructures';
import { createWaterMaterial } from '../render/watermaterial';
import { createLightPlane, type LightPlane } from './plane';
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
const SHOT_SIDE_AT = 4.6;
const SHOT_ROLL_AT = 9.4;
const SHOT_HOUSE_AT = 16.4;

/* ---- the flight, metres ---- */
/** Where the aeroplane enters the shot: out over the water. */
const APPROACH_Z = 250;
const APPROACH_ALT = 26;
/** Where the tyres touch, and where the roll stops. */
const TOUCHDOWN_Z = 18;
const STOP_Z = -78;
/** ...which with the roll's own length fixes how long the roll-out takes: `2d / v`. */
const STOPPED_AT = TOUCHDOWN_AT + (2 * (TOUCHDOWN_Z - STOP_Z)) / ROLL_SPEED;
/** Tail-down attitude at touchdown and the braking attitude once rolling, radians. */
const FLARE_PITCH = 0.085;
const ROLL_PITCH = -0.015;
/** Heading: the strip runs along -Z, so the model is yawed a half turn. */
const RUNWAY_YAW = Math.PI;

/* ---- the beach, metres ---- */
/**
 * Shoreline cross-section, `[z, y]`: sea at +Z, hills at -Z. The waterline sits at
 * z = 30 and the sand climbs gently from there, so the sea is a dozen metres behind the
 * touchdown, the surf line is in every landing shot, and the beach runs a hundred and
 * twenty metres inland before the scrub takes over. The sea side is deliberately
 * shallow: a beach reads as sand under turquoise before it reads as water, and a gentle
 * shore is what puts the shallow band far enough out to be seen from the strip.
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
  [-430, 14],
  [-900, 40],
];
/** The strip: half width, its run, and how far it is lifted over the sand. */
const STRIP_HALF_W = 10.5;
/** Its seaward threshold sits just inside the waterline; inland it runs past the house. */
const STRIP_FROM_Z = 26;
const STRIP_TO_Z = -140;
const STRIP_LIFT = 0.04;
/** The house, +X of the strip, beside the point the aeroplane stops at. */
const HOUSE_X = 34;
const HOUSE_Z = -90;
const HOUSE_YAW = Math.PI + 0.22;
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
/** Unit direction TOWARD the sun: high, ahead of the landing view and to its left. */
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
const SEA_ALPHA_SHALLOW = 0.3;
const SEA_ALPHA_DEEP = 0.94;
/**
 * The sea's rows, metres of z beyond the waterline. The sheet is built along the
 * waterline rather than as a grid, so the rows can be dense where the eye is — the foam
 * and the turquoise shallows — and kilometres apart out at the horizon.
 */
const SEA_ROWS: readonly number[] = [
  -10, -3, 0, 1.5, 3.5, 6, 10, 16, 26, 42, 65, 100, 160, 250, 400, 700, 1200, 1800, 2600,
];

/* ---- the land ---- */
const SAND_DRY = new THREE.Color(0.62, 0.44, 0.24);
const SAND_WET = new THREE.Color(0.28, 0.21, 0.14);
const GRASS_SCRUB = new THREE.Color(0.13, 0.2, 0.08);
const DIRT_DRY = new THREE.Color(0.3, 0.24, 0.14);
const HILL = new THREE.Color(0.22, 0.22, 0.13);
/** The strip's packed earth, and the darker soil along its two edges. */
const STRIP_PACKED = new THREE.Color(0.28, 0.25, 0.18);
const STRIP_EDGE = new THREE.Color(0.15, 0.12, 0.09);
const RIDGE_BASE = new THREE.Color(0.13, 0.15, 0.14);
/** The ridges' own air: cooler and bluer than the horizon's, which is what depth is. */
const RIDGE_HAZE = new THREE.Color(0.34, 0.42, 0.56);

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
  // The sun's disc and the glow that widens just outside it.
  float toSun = max(dot(dir, normalize(uSunDirection)), 0.0);
  sky += uSunColour * pow(toSun, 260.0) * 2.2;
  sky += uSunColour * pow(toSun, 9.0) * 0.22;
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

      // Wet sand below the waterline and a stride above it, dry sand up the beach, dry
      // grass with dirt showing through as patches behind it, ochre hills at the back.
      // The wet band keys off the height rather than off z, so it follows the waterline's
      // own curve along X the way the water does.
      colour.copy(SAND_DRY).lerp(SAND_WET, 1 - smoothstep(0, 1.5, height));
      // A little mottling: a hundred metres of beach is otherwise one flat tone.
      colour.multiplyScalar(
        0.95 + 0.09 * Math.sin(x * 0.085 + 2.3) * Math.sin(z * 0.05 + 0.9),
      );
      const scrub = smoothstep(-95, -150, z);
      const patch = Math.sin(x * 0.062 + 1.1) * Math.sin(z * 0.029 - 0.4);
      const coverage = scrub * (0.62 + 0.38 * smoothstep(-0.35, 0.45, patch));
      colour.lerp(patch > 0.05 ? DIRT_DRY : GRASS_SCRUB, coverage);
      colour.lerp(HILL, smoothstep(-240, -460, z));
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
  addQuad(0, TOUCHDOWN_Z + 4, 8, 0.55, 0xd8d3c4);
  for (let i = 0; i < 4; i++) addQuad(0, 6 - i * 34, 0.45, 5, 0xcfcabc);
  const markings = mergeGeometries(quads, false);
  for (const quad of quads) quad.dispose();
  return markings ? [strip, markings] : [strip];
}

/**
 * The sea: one sheet laid out along the shoreline rather than as a square grid.
 *
 * The rows follow depth contours, so each row's colour and alpha is a function of the
 * row alone: the waterline wobbles in X, and a row at `SEA_ROWS[i]` metres beyond it sits
 * over exactly the same depth at every X. That is what buys the surf line its resolution —
 * four rows inside the first six metres of water, and six inside sixteen — without
 * spending a vertex on the water two kilometres out, which a uniform grid cannot do at any
 * resolution anybody would pay for (the old 48 x 48 sheet had 55 m cells, so the foam band
 * was a fifth of a cell).
 */
function createSea(): THREE.BufferGeometry {
  // Columns: dense across the strip's corridor, sparse at the edges of the drawn sea.
  const nx = 150;
  const xHalf = 1600;
  const rows = SEA_ROWS.length;
  const count = (nx + 1) * rows;
  const positions = new Float32Array(count * 3);
  const colours = new Float32Array(count * 4);
  const uvs = new Float32Array(count * 2);
  const indices: number[] = [];
  const colour = new THREE.Color();

  // The bed under each row is the profile's own depth there, so it is resolved once.
  const rowColour = SEA_ROWS.map((beyond) => {
    const depth = -profileY(WATERLINE_Z + beyond);
    const shallow = smoothstep(0.12, 3.2, depth);
    const foam = smoothstep(0, 0.1, depth) * (1 - smoothstep(0.1, 0.75, depth));
    colour.copy(SEA_SHALLOW).lerp(SEA_DEEP, shallow).lerp(SEA_FOAM, foam * 0.85);
    return {
      r: colour.r,
      g: colour.g,
      b: colour.b,
      a: lerp(lerp(SEA_ALPHA_SHALLOW, SEA_ALPHA_DEEP, shallow), 0.88, foam * 0.8),
    };
  });

  let v = 0;
  for (let ix = 0; ix <= nx; ix++) {
    const t = (ix / nx) * 2 - 1;
    const x = Math.sign(t) * Math.pow(Math.abs(t), 2.1) * xHalf;
    // The rows shift with the waterline, so the sheet's edge is the shore's own curve.
    const shore = WATERLINE_Z - shoreOffset(x);
    for (let iy = 0; iy < rows; iy++, v++) {
      const z = shore + SEA_ROWS[iy]!;
      positions[v * 3] = x;
      positions[v * 3 + 1] = 0;
      positions[v * 3 + 2] = z;
      uvs[v * 2] = x;
      uvs[v * 2 + 1] = z;
      const row = rowColour[iy]!;
      colours[v * 4] = row.r;
      colours[v * 4 + 1] = row.g;
      colours[v * 4 + 2] = row.b;
      colours[v * 4 + 3] = row.a;
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
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 4));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
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

/** A palm: a tapered trunk and eight drooping fronds, two merged geometries. */
function createPalm(): { trunk: THREE.BufferGeometry; fronds: THREE.BufferGeometry } {
  const trunk = new THREE.CylinderGeometry(0.16, 0.3, 6.4, 7, 1);
  trunk.translate(0, 3.2, 0);
  const fronds: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2 + 0.3;
    const frond = new THREE.BoxGeometry(0.34, 0.06, 3);
    frond.translate(0, 0, 1.4);
    frond.rotateX(-0.5);
    frond.rotateY(angle);
    frond.translate(0, 6.3, 0);
    fronds.push(frond);
  }
  const merged = mergeGeometries(fronds, false)!;
  for (const frond of fronds) frond.dispose();
  return { trunk, fronds: merged };
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

  const water = createWaterMaterial();
  const seaGeometry = createSea();
  const sea = new THREE.Mesh(seaGeometry, water.material);
  sea.renderOrder = 1;
  scene.add(sea);

  // Three ridge layers, each hazier than the one in front of it. They are sized so the
  // crests subtend 10-12 degrees from the strip — a range behind the house, not a band on
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

  // Palms round the house, on the sand and the scrub line behind it.
  const palm = createPalm();
  const palmTrunkMaterial = new THREE.MeshStandardMaterial({ color: 0x8a7355, roughness: 0.9 });
  const palmFrondMaterial = new THREE.MeshStandardMaterial({ color: 0x53763a, roughness: 0.85 });
  const palms: THREE.Mesh[] = [];
  for (let i = 0; i < 5; i++) {
    const angle = i * 2.399963;
    const x = HOUSE_X + Math.cos(angle) * (12 + i * 3.4);
    const z = HOUSE_Z + 12 + Math.sin(angle) * (10 + i * 2.6);
    const lean = 0.06 + (i % 3) * 0.03;
    for (const geometry of [palm.trunk, palm.fronds]) {
      const mesh = new THREE.Mesh(geometry, geometry === palm.trunk ? palmTrunkMaterial : palmFrondMaterial);
      mesh.position.set(x, landHeight(x, z) - 0.1, z);
      mesh.rotation.set(lean, angle, -lean * 0.6);
      mesh.scale.setScalar(0.85 + (i % 3) * 0.12);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      scene.add(mesh);
      palms.push(mesh);
    }
  }

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
  renderer.setHeatHaze({ shimmer: 0.18, mirage: 0.06, eyeAboveM: 2.6, groundSlope: 0.02 });
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
  const rollDistance = TOUCHDOWN_Z - STOP_Z;
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
      // a single glide path down to the touchdown's own height — not a follow of the sand
      // below, which over the shallows would read as height over the sea bed.
      flight.y = TOUCHDOWN_LEVEL + APPROACH_ALT * Math.pow(1 - u, 1.7);
      flight.pitch = lerp(0.02, FLARE_PITCH, smoothstep(0.55, 1, u));
      flight.bank = 0.05 * (1 - smoothstep(0, 0.5, u));
      flight.prop = 0.62;
      flight.level = 0.72;
    } else if (elapsed < STOPPED_AT) {
      const u = (elapsed - TOUCHDOWN_AT) / (STOPPED_AT - TOUCHDOWN_AT);
      flight.z = TOUCHDOWN_Z - rollDistance * (2 * u - u * u);
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
      elapsed < SHOT_SIDE_AT ? 0
        : elapsed < SHOT_ROLL_AT ? 1
          : elapsed < SHOT_HOUSE_AT ? 2
            : 3;
    if (want !== shot) {
      shot = want;
      // The opening shot is not a cut: the cutscene simply starts there.
      if (want !== 0) rig.cut();
    }

    if (shot === 0) {
      // On the sand a few metres above the surf line, looking out to sea: the beach's own
      // wet band and the surf fill the near frame while the aeroplane comes down over the
      // water toward the strip.
      const dolly = smoothstep(0, SHOT_SIDE_AT, elapsed);
      eye.set(-32 + 3 * dolly, landHeight(-32, 8) + 3.1, 8 + 5 * dolly);
      lookAt.copy(planePos);
      lookAt.y += 0.7;
      lookAt.z += 6;
      rig.update(dt, eye, lookAt, 46);
    } else if (shot === 1) {
      // Water level in the shallows, seaward of the touchdown: the aeroplane crosses the
      // surf line and settles onto the wet sand fifty metres from the lens, and the pan
      // then carries it inland up the strip. Keeping the camera seaward of the whole roll
      // is what keeps this one continuous pan instead of an about-face as it passes.
      eye.set(16, 2.6, 70);
      lookAt.copy(planePos);
      lookAt.y += 1.2;
      rig.update(dt, eye, lookAt, 50);
    } else if (shot === 2) {
      // Tracking alongside it on the sand, thirty-six metres off its left wing: the
      // aeroplane rolls the last hundred metres of the strip across the frame, the beach
      // under it, its own packed band reading against the sand, the house and its palms
      // beyond it, and the ridges over the whole lot. The camera comes to rest with the
      // aeroplane.
      eye.set(-36, landHeight(-36, flight.z + 14) + 2.3, flight.z + 14);
      lookAt.copy(planePos);
      lookAt.y += 1.3;
      rig.update(dt, eye, lookAt, 44);
    } else {
      // The held shot: from over the shallows, looking inland-diagonal, so the frame is
      // sea in the foreground, wet sand and surf line above it, then the strip, the
      // aeroplane and the house, and the ridges standing behind them all. A slow pull
      // back and rise over the shallows, with a longer lens as it goes.
      const u = smoothstep(SHOT_HOUSE_AT, FADE_OUT_AT, elapsed);
      const ex = -28 + 4 * u;
      eye.set(ex, 3.2 + 1.9 * u, 46 + 15 * u);
      housePoint.set(HOUSE_X, landHeight(HOUSE_X, HOUSE_Z) + 2.2, HOUSE_Z);
      lookAt.lerpVectors(planePos, housePoint, 0.45);
      lookAt.y += 0.9;
      rig.update(dt, eye, lookAt, 34 + 4 * u);
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
  const owned: (THREE.Mesh | null)[] = [ground, strip, markings, sea, shrubs, ...palms];
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
  palm.trunk.dispose();
  palm.fronds.dispose();
  palmTrunkMaterial.dispose();
  palmFrondMaterial.dispose();
  scene.remove(house.group);
  // The dwelling's shared geometry and material belong to the session cache, not to this
  // scene, and `sky.dispose` clears what is left of the graph.
  sky.dispose();
}
