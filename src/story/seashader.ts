import * as THREE from 'three';

/**
 * The ending's sea: one `ShaderMaterial` for the water sheet `ending.ts` lays out.
 *
 * WHY A SHADER AND NOT `render/watermaterial.ts`. That material is the game's stock
 * answer for the dug basins (world/lakes.ts): a `MeshStandardMaterial` with a
 * scrolling normal map, reflecting the sky through `scene.environment`. It is right
 * there because a puddle beside a road only has to be water. A sea that is the back
 * half of a held final shot has to do more than one thing per pixel — swell that
 * translates, ripples, a fresnel reflection of the dome, a sun path, a depth ramp, a
 * surf line and a swash running up the beach — and every one of those is a term this
 * shader gets to place itself, in one draw call, without a texture, a render target or
 * a second pass.
 *
 * THE CONTRACT WITH THE GEOMETRY. The sheet carries two extra attributes, both
 * resolved from the beach's own cross-section by `ending.ts` so the water and the sand
 * cannot disagree about where the shore is:
 *
 *  - `aShore`: metres SEAWARD of the waterline at this vertex. The rows of the sheet
 *    are the shore's own depth contours, so this is constant along a row and exact.
 *  - `aBed`: the height of the bed under this vertex, metres, positive where the sand
 *    stands above the waterline. Derived from the same profile, so a row is a depth.
 *
 * Everything the fragment does — the depth ramp, the breaker windows, the swash — is a
 * function of those two numbers and the world position, which is what makes the foam
 * follow the waterline's own wobble instead of a straight line in z.
 *
 * THE SKY IS THE SCENE'S OWN. `skyAt` is the same function the ending's dome is drawn
 * with (same three colours, same sun disc, same glow), so the reflection in the water
 * is a reflection of the backdrop and not of a second, invented sky.
 *
 * WHY NO `THREE.Fog`. Three fog would have to be mixed after the tonemap, on an
 * already display-encoded colour, and it cannot bend: the sea's haze has to reach the
 * horizon colour before the sheet's own far edge so the edge is never a seam, which is
 * a different curve from the land's `FogExp2`. The `haze` term below is that curve,
 * fed the same density, so the far water and the far sand still agree.
 */

/**
 * The swell: four crossing trains, `[kx, kz, amplitude]`.
 *
 * Every wavevector points seaward, so every train runs toward the beach, and no two
 * are parallel, so the crests cross instead of marching. Angular frequency comes from
 * the deep-water dispersion relation `w = sqrt(g k)`, which is what keeps the long
 * train long-legged and the short one quick; amplitudes are metres of water.
 */
const SWELL = [
  /** 63 m: the ground swell, the one whose faces catch the sun. */
  [0.0418, 0.0905, 0.3],
  /** 37 m. */
  [-0.0934, 0.1418, 0.16],
  /** 21 m. */
  [0.2217, 0.2008, 0.085],
  /** 13 m. */
  [-0.1313, 0.4501, 0.045],
] as const;

/** One train as GLSL: its height and its analytic horizontal gradient. */
function swellTerm(kx: number, kz: number, amplitude: number): string {
  const frequency = Math.sqrt(9.81 * Math.hypot(kx, kz));
  return `
  k = vec2(${kx}, ${kz}); p = dot(xz, k) + t * ${frequency.toFixed(3)};
  height += ${amplitude} * sin(p);
  grad += ${amplitude} * cos(p) * k;
`;
}

const SEA_VERTEX = `
attribute float aShore;
attribute float aBed;

uniform float uTime;

varying float vShore;
varying float vBed;
varying vec3 vWorld;
varying vec2 vSwellGrad;

void swellTrains(vec2 xz, float t, out float height, out vec2 grad) {
  height = 0.0;
  grad = vec2(0.0);
  vec2 k;
  float p;
  ${SWELL.map(([kx, kz, a]) => swellTerm(kx, kz, a)).join('')}
}

void main() {
  vShore = aShore;
  vBed = aBed;

  // A droplet of the sheet's own bed: swell is a deep-water thing. It shoals away over
  // the last metres, steepens as it comes up to the break, and is dropped altogether
  // where the rows stand hundreds of metres apart — a 63 m wave across a 400 m quad is
  // not a wave, it is a vertex moving in the dark.
  float depth = max(0.0, -aBed);
  float range = distance(position.xz, cameraPosition.xz);
  float shoal = smoothstep(0.35, 6.5, depth);
  float steep = (depth - 1.15) * 0.95;
  float resolvable = 1.0 - smoothstep(150.0, 430.0, range);
  float amp = shoal * (1.0 + 0.35 * exp(-steep * steep)) * resolvable;

  float height;
  vec2 grad;
  swellTrains(position.xz, uTime, height, grad);

  // The gradient rides the same amplitude as the displacement, so the low-frequency
  // normal can never describe a wave the surface is not showing.
  vSwellGrad = grad * amp;
  // The mesh carries no transform: the local frame IS the world frame, which the bed
  // and shore attributes above also assume.
  vWorld = vec3(position.x, position.y + height * amp, position.z);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(vWorld, 1.0);
}
`;

const SEA_FRAGMENT = `
uniform float uTime;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uSunColour;
uniform vec3 uSunDirection;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uFoam;
uniform vec3 uWet;
uniform float uFogDensity;

varying float vShore;
varying float vBed;
varying vec3 vWorld;
varying vec2 vSwellGrad;

/** The ending's dome, verbatim: the water reflects the sky that is actually drawn. */
vec3 skyAt(vec3 dir) {
  float up = clamp(dir.y, -1.0, 1.0);
  vec3 sky = mix(uHorizon, uZenith, pow(clamp(up, 0.0, 1.0), 0.62));
  sky = mix(uGround, sky, smoothstep(-0.06, 0.06, up));
  float toSun = max(dot(dir, uSunDirection), 0.0);
  sky += uSunColour * pow(toSun, 1400.0) * 1.35;
  sky += uSunColour * pow(toSun, 12.0) * 0.16;
  return sky;
}

/**
 * The wind chop, in three bands, each a gradient only, summed analytically.
 *
 *  - THE SHORT CHOP, a metre or two across, is the near water's sparkle. It is the
 *    steepest field in the shader and the first to go: by seventy metres a sub-metre wave
 *    is sampled worse than the screen can show it, and a sparkle that boils reads as
 *    noise rather than as water.
 *  - THE WORKING WAVES, twelve to twenty-four metres across, are what the sun's path on
 *    the water is actually made of at every range these shots have. Ten to twenty metres
 *    across, a kilometre out, is still several pixels, so these keep their slopes all the
 *    way to the sheet's far edge and give a wide, soft road of glitter instead of a
 *    single bright point.
 *  - THE FAR SWELL, a few hundred metres across, is always present: it only tilts the far
 *    mirror enough to keep the water from reading as a pane of glass, and at that
 *    wavelength the rows can resolve it wherever it is sampled.
 */
vec2 waveGrad(vec2 xz, float t, float chop, float mid) {
  vec2 g = vec2(0.0);
  vec2 k;
  float p;
  k = vec2(1.031, 1.241); p = dot(xz, k) + t * 3.975; g += 0.055 * cos(p) * k * chop;
  k = vec2(-1.257, 2.570); p = dot(xz, k) + t * 5.293; g += 0.045 * cos(p) * k * chop;
  k = vec2(3.949, 2.109); p = dot(xz, k) + t * 6.635; g += 0.030 * cos(p) * k * chop;
  k = vec2(-1.109, 7.318); p = dot(xz, k) + t * 8.516; g += 0.018 * cos(p) * k * chop * 0.6;
  k = vec2(0.168, 0.203); p = dot(xz, k) + t * 1.300; g += 0.340 * cos(p) * k * mid;
  k = vec2(-0.290, 0.372); p = dot(xz, k) + t * 1.700; g += 0.220 * cos(p) * k * mid;
  k = vec2(0.0122, 0.0221); p = dot(xz, k) + t * 0.500; g += 0.600 * cos(p) * k;
  k = vec2(-0.0141, 0.0107); p = dot(xz, k) + t * 0.420; g += 0.450 * cos(p) * k;
  return g;
}

void main() {
  float range = distance(cameraPosition, vWorld);
  // Three fades, each tied to what the screen can still resolve at that distance: the
  // short chop goes first and hardest, the working waves hold almost to the sheet's own
  // edge (they are what the sun's path is made of), and the swell's own vertex normal —
  // which the rows cannot describe once they are hundreds of metres apart — is gone by
  // the time the water is two hundred metres out. What is left far away is smooth water
  // with a soft glitter path on it, and not one high-frequency term to moire with.
  float chop = 1.0 - smoothstep(8.0, 70.0, range);
  float mid = 1.0 - smoothstep(400.0, 1600.0, range);
  float swellNormal = 1.0 - smoothstep(50.0, 210.0, range);

  vec2 ripple = waveGrad(vWorld.xz, uTime, chop, mid);
  vec2 tilt = vSwellGrad * swellNormal + ripple;
  vec3 normal = normalize(vec3(-tilt.x, 1.0, -tilt.y));
  if (!gl_FrontFacing) normal = -normal;

  vec3 view = normalize(cameraPosition - vWorld);
  float ndv = clamp(dot(normal, view), 0.001, 1.0);
  float fresnel = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
  // The mirror is lifted a couple of degrees: a flat surface at grazing reflects the sky
  // exactly AT the horizon, which in this dome is the grey-green band where the ground
  // colour meets the sky's, and the far sea therefore came out olive. Two degrees up is
  // still the sky, and it is the sky the water is actually under.
  vec3 mirror = normalize(reflect(-view, normal) + vec3(0.0, 0.045, 0.0));
  vec3 sky = skyAt(mirror);

  float depth = max(0.0, -vBed);
  // Distance up the sand from the waterline, in metres, and the one number the swash
  // uses: vShore is the row's own offset along the shore's normal, so a tongue's reach
  // is measured against the same ruler the beach profile itself is drawn on.
  float upBeach = max(0.0, -vShore);

  // Body: turquoise over the sand shallows, deep blue past the shelf, and a step
  // brighter again in the last half-metre, where the bed's own light still shows.
  vec3 body = mix(uShallow, uDeep, smoothstep(0.55, 4.5, depth));
  body = mix(body * 1.3, body, smoothstep(0.0, 0.7, depth));
  // Grazing water is a mirror: alpha climbs with the fresnel, so the horizon does not
  // sit translucent against the sky it is reflecting.
  float waterAlpha = mix(0.3, 0.94, smoothstep(0.3, 3.6, depth));
  waterAlpha = max(waterAlpha, fresnel * 0.9);

  // The sun: a sharp facet glint, which only the near water's chop can make, plus the
  // broad working-wave lobe that carries a soft path out to the horizon. The glint goes
  // with the chop, so the far water never sparkles; the path stays.
  float glint = 1.0 - smoothstep(60.0, 320.0, range);
  float toSun = max(dot(mirror, uSunDirection), 0.0);
  vec3 waterColour = mix(body, sky, fresnel)
    + uSunColour * (pow(toSun, 110.0) * 1.7 * glint + pow(toSun, 26.0) * 0.20);

  // ---- the surf, seaward: two trains of breakers riding the depth contours ----
  // vShore runs with the waterline's own wobble, so a breaker follows the beach
  // rather than a straight z, and the wobble in the phase makes it ragged.
  float wobble = 0.55 * sin(vWorld.x * 0.045) + 0.30 * sin(vWorld.x * 0.11 + 1.7);
  float crestA = sin(vShore * 0.165 + uTime * 1.30 + wobble);
  float crestB = sin(vShore * 0.083 + uTime * 0.62 + wobble * 0.7 + 2.1);
  float breaking = smoothstep(0.15, 0.75, depth) * (1.0 - smoothstep(1.7, 3.6, depth));
  float foamSea = smoothstep(0.78 + 0.07 * crestB, 1.0, crestA) * breaking
    + (1.0 - smoothstep(0.0, 0.9, depth))
      * (0.55 + 0.45 * sin(vShore * 0.6 + uTime * 1.9 + wobble));
  foamSea = clamp(foamSea, 0.0, 1.0);

  // ---- the beach: the swash running up the sand, and the band it leaves wet ----
  // Two tongues at different periods, phase-shifted along x, so the wash arrives in
  // pulses and never as one even line. A tongue's reach is metres up the sand from the
  // waterline, and the beach climbs about a metre in twenty, so a 5 m tongue is a
  // quarter-metre of tide.
  float swashPhase = 0.35 * sin(vWorld.x * 0.030 + 0.8) + 0.18 * sin(vWorld.x * 0.085 + 2.3);
  float reachA = 4.6 + 3.4 * sin(uTime * 0.80 + swashPhase) + 1.2 * sin(uTime * 1.90 + swashPhase * 1.6);
  float reachB = 3.4 + 2.7 * sin(uTime * 0.57 - 1.1 + swashPhase * 0.7);
  float cover = smoothstep(0.0, 0.7, max(reachA, reachB) - upBeach);
  float edgeA = smoothstep(0.0, 0.9, reachA - upBeach) * (1.0 - smoothstep(0.9, 2.6, reachA - upBeach));
  float edgeB = smoothstep(0.0, 0.6, reachB - upBeach) * (1.0 - smoothstep(0.6, 2.0, reachB - upBeach));
  float foamShore = clamp(edgeA + edgeB * 0.85, 0.0, 1.0);
  // The sand stays dark above the tongue: it was wet a moment ago, and the tide line is
  // the highest reach of the last few swashes — walked along the shore so the line is a
  // line rather than a ruled edge.
  float wetBand = 1.0 - smoothstep(6.6, 9.8, upBeach + 0.8 * sin(vWorld.x * 0.037 + 1.3));

  // THE OVERLAY IS A GLOSS, NOT A COAT OF PAINT. The sand under all of this is already
  // painted wet by the ground's own vertex colours, so this layer has only to add what
  // moves: the soaked ground under the tongue, and the foam. A wide, even alpha here —
  // which is what it used to be — put a flat grey-green veil over the whole swash zone,
  // and at a grazing angle that veil is all a camera two metres up can see.
  vec3 wetSand = mix(uWet, uWet * 0.86, cover);
  vec3 sheen = mix(wetSand, sky, 0.3);
  vec3 beachColour = mix(wetSand, sheen, cover * 0.4);
  beachColour = mix(beachColour, uFoam, foamShore);
  float beachAlpha = clamp(wetBand * (0.1 + 0.2 * cover) + foamShore * 0.95, 0.0, 1.0);

  // The branch between water and sand, in the shore's own coordinate and only half a
  // metre wide, so the wet band reaches its full darkening right at the waterline
  // instead of ramping up over the first six metres of beach.
  float beach = smoothstep(-0.6, 0.4, -vShore);
  vec3 colour = mix(waterColour, beachColour, beach);
  float alpha = mix(waterAlpha, beachAlpha, beach);

  // ---- the air ----
  // The land's own FogExp2 curve, then an extra pull that reaches the horizon colour
  // before the sheet ends, so the far edge of the water is never a seam in the haze.
  // The colour is a shade under the horizon's and a shade toward the zenith: a sea
  // meeting a sky is a line, and a line that is exactly the sky is no line at all —
  // while a sea that goes the grey of the horizon's own band reads as a muddy band of
  // its own halfway up the frame.
  vec3 air = mix(uHorizon, uZenith, 0.18) * 0.9;
  float haze = 1.0 - exp(-pow(range * uFogDensity, 2.0));
  haze += (1.0 - haze) * smoothstep(1200.0, 2400.0, range);
  colour = mix(colour, air, haze * 0.85);

  gl_FragColor = vec4(colour, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export interface SeaMaterialOptions {
  readonly zenith: THREE.Color;
  readonly horizon: THREE.Color;
  readonly ground: THREE.Color;
  readonly sunColour: THREE.Color;
  readonly sunDirection: THREE.Vector3;
  readonly deep: THREE.Color;
  readonly shallow: THREE.Color;
  readonly foam: THREE.Color;
  /** The wet sand the swash leaves behind: darker and warmer than the dry sand. */
  readonly wetSand: THREE.Color;
  /** The scene's own `FogExp2` density, so the water's haze matches the land's. */
  readonly fogDensity: number;
}

export interface SeaMaterial {
  readonly material: THREE.ShaderMaterial;
  /** Advances the swell, the breakers and the swash. Called once per rendered frame. */
  advance(dt: number): void;
  dispose(): void;
}

export function createSeaMaterial(options: SeaMaterialOptions): SeaMaterial {
  const uniforms = {
    uTime: { value: 0 },
    uZenith: { value: options.zenith.clone() },
    uHorizon: { value: options.horizon.clone() },
    uGround: { value: options.ground.clone() },
    uSunColour: { value: options.sunColour.clone() },
    uSunDirection: { value: options.sunDirection.clone() },
    uDeep: { value: options.deep.clone() },
    uShallow: { value: options.shallow.clone() },
    uFoam: { value: options.foam.clone() },
    uWet: { value: options.wetSand.clone() },
    uFogDensity: { value: options.fogDensity },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: SEA_VERTEX,
    fragmentShader: SEA_FRAGMENT,
    transparent: true,
    depthWrite: false,
    // The sheet is drawn from inside the swell as well as above it, so it has to be
    // visible from below; the normal is flipped on the back faces rather than the
    // geometry being doubled.
    side: THREE.DoubleSide,
    // See the header: the sea mixes its own haze, after the scene's fog curve and past
    // where three's fog would have stopped.
    fog: false,
  });
  material.name = 'ending-sea';

  let time = 0;
  return {
    material,
    advance(dt: number): void {
      time += dt;
      uniforms.uTime.value = time;
    },
    dispose(): void {
      material.dispose();
    },
  };
}
