import * as THREE from 'three';

/**
 * CUMULUS: clouds with a body, for the price of a few hundred quads.
 *
 * WHAT THEY WERE. Noise on a plane in the sky dome's shader: flat blotches with no
 * volume, lit by two samples, and — the dome being the backdrop — stars shone through
 * them. The owner: "coarse, unrealistic, not Shishkin".
 *
 * WHAT THEY ARE (docs/research-2026-09-26.md). Volumetric clouds raymarched ONCE, at
 * load, into an atlas, then drawn as cards lit by the live sun — the same trick as the
 * trees' impostors, and the cheap end of what Sea of Thieves and the volumetric
 * renderers do. The bake keeps, per texel:
 *   atlas A  rgb: light reaching the visible surface from up, +x and -x
 *            a:   coverage (1 - transmittance through the whole cloud)
 *   atlas B  rg: light from +z and -z
 *            b:  height inside the cloud (0 at its flat base, 1 at its top)
 *            a:  how much cloud the ray crossed (thin edges transmit the sun)
 * At draw time a card is lit from those: the sunward side warm, the shade cool and
 * blue-grey, the base darker, a silver lining where the sun is behind a thin edge
 * (Shishkin's "Rye", "Midday"). Near the horizon clouds sink into the haze as the land
 * does.
 *
 * TWO VIEWS. A card that only turns about the vertical is seen edge-on from under the
 * cloud: overhead, a cloud was a smeared streak. So every shape is baked twice — from
 * the side (atlas rows 0..2) and from below (rows 3..5: the flat base with the heads
 * showing round its rim) — and each cloud is two quads, an upright one facing the
 * camera and a flat one at its base, cross-faded by how high the cloud stands in the
 * view (`VIEW_FADE_*`). The impostors' view blend, with two views.
 *
 * THE FIELD. `COUNT` clouds scattered over a square of `FIELD_M` that wraps round the
 * camera, so there are always clouds and they keep their world places: driving under
 * them, they pass overhead with real parallax; the wind moves the whole field. The
 * cumulus cover decides how many show. Cards are sorted far to near every so often,
 * into the draw buffer that is not being drawn (see `sort`).
 *
 * THE SKY BEHIND. Drawn after the stars, blended over them: a cloud hides the stars.
 */

const SHAPES = 12;
const ATLAS_COLS = 4;
/** Rows per view: the side view in rows 0..2, the view from below in rows 3..5. */
const VIEW_ROWS = 3;
const ATLAS_ROWS = VIEW_ROWS * 2;
/**
 * Sine of the cloud's elevation over which the side view hands over to the view from
 * below: ~20 to ~44 degrees. A big cloud a kilometre or two off spans tens of degrees,
 * so its upright card already reads as a streak toward its near edge at 30; the first
 * try, 30..53, left exactly that streak in the sky.
 */
const VIEW_FADE_LOW = 0.35;
const VIEW_FADE_HIGH = 0.7;
const CELL_W = 320;
const CELL_H = 160;
/** Clouds in the field, the field's side, and how high they float over the camera. */
const COUNT = 200;
const FIELD_M = 36000;
const ALTITUDE_M = 1600;
const ALTITUDE_SPREAD_M = 500;
/** Card width range, metres; a card is half as tall as wide. */
const WIDTH_MIN_M = 1400;
const WIDTH_MAX_M = 4200;
/** Metres of camera travel between re-sorts. */
const RESORT_M = 400;

/**
 * The bake: one full-screen pass per atlas over the whole atlas, each texel marching
 * its cell's cloud along the view axis. Cloud space: x in [-1, 1], y in [0, 1] (the
 * flat base at 0), z in [-0.7, 0.7]. A cloud is a heap of puffs — a broad base row and
 * smaller ones stacked on it, each lumpy with noise — cut flat below.
 */
const BAKE_FRAGMENT = /* glsl */ `
precision highp float;
in vec2 vUv;
layout(location = 0) out highp vec4 outA;
layout(location = 1) out highp vec4 outB;
float h31( vec3 p ) { return fract( sin( dot( p, vec3( 127.1, 311.7, 74.7 ) ) ) * 43758.5453 ); }
float h11( float n ) { return fract( sin( n * 91.3458 ) * 47453.5453 ); }
float vnoise( vec3 p ) {
  vec3 i = floor( p ), f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  float a = h31( i ), b = h31( i + vec3( 1, 0, 0 ) ), c = h31( i + vec3( 0, 1, 0 ) ), d = h31( i + vec3( 1, 1, 0 ) );
  float e = h31( i + vec3( 0, 0, 1 ) ), g = h31( i + vec3( 1, 0, 1 ) ), k = h31( i + vec3( 0, 1, 1 ) ), l = h31( i + vec3( 1, 1, 1 ) );
  return mix( mix( mix( a, b, f.x ), mix( c, d, f.x ), f.y ), mix( mix( e, g, f.x ), mix( k, l, f.x ), f.y ), f.z );
}
float fbm3( vec3 p ) {
  float s = 0.0, a = 0.5;
  for ( int i = 0; i < 3; i++ ) { s += a * vnoise( p ); p *= 2.1; a *= 0.5; }
  return s;
}
float shapeSeed;
const int PUFFS = 24;
vec4 puffs[ PUFFS ];
void buildPuffs() {
  // A mound on a broad foot: 10 flattened puffs spread wide along the base, 6 body
  // puffs resting on it, then 8 turrets: three growing out of the body, each later one
  // on the head three before it, smaller and a little aside — cauliflower towers of
  // shrinking heads, some cut short. The spread of scales is what breaks the
  // silhouette into heads instead of one smooth dome.
  //
  // ONE CONTACT RULE. A puff's visible radius is ~0.59 r (where its Gaussian meets the
  // heap's threshold), so every puff above the foot is placed on the one it rests on,
  // at under 0.6 of that one's radius up and 0.45 aside: close enough that the two
  // visible spheres always overlap. Height comes from larger bodies and stacking, never
  // from spacing — placing rows at independent heights left the body floating clear
  // of the foot and the turrets clear of the body.
  float peak = ( h11( shapeSeed * 2.3 ) - 0.5 ) * 0.6;
  float tall = 0.8 + 0.7 * h11( shapeSeed * 4.1 );
  for ( int i = 0; i < PUFFS; i++ ) {
    float fi = float( i );
    float h = h11( shapeSeed * 5.9 + fi );
    float jx = h11( shapeSeed * 13.1 + fi ) - 0.5;
    float climb = h11( shapeSeed * 7.7 + fi );
    float z = ( h11( shapeSeed * 3.3 + fi ) - 0.5 ) * 0.42;
    float x, y, r;
    if ( i < 10 ) {
      // The foot: neighbours 0.168 apart against visible radii of 0.1 or more, so it is
      // one flat slab. No taper at the ends: a thinner end puff drops out as a bead.
      x = ( ( fi + 0.5 ) / 10.0 * 2.0 - 1.0 ) * 0.84 + jx * 0.05;
      y = 0.1 + 0.03 * h;
      r = 0.2 * ( 0.85 + 0.4 * h );
    } else if ( i < 16 ) {
      // The body, over the middle of the foot and leaning to the peak; bigger (so
      // taller) toward the peak and in tall clouds.
      x = ( ( fi - 10.0 + 0.5 ) / 6.0 * 2.0 - 1.0 ) * 0.56 + peak * 0.4 + jx * 0.16;
      float dome = 1.0 - abs( x - peak ) / 1.3;
      int k = int( clamp( floor( ( x / 0.84 + 1.0 ) * 5.0 ), 0.0, 9.0 ) );
      vec4 foot = puffs[ k ];
      r = 0.21 * ( 0.75 + 0.6 * h ) * ( 0.7 + 0.6 * dome ) * sqrt( tall );
      // The foot is squashed (visible half-height 0.44 of its radius): the body's
      // bottom stays inside it.
      y = foot.y + foot.w * ( 0.2 + 0.15 * dome * tall );
    } else {
      vec4 parent = puffs[ i - 3 ].w > 0.0 && i >= 19 ? puffs[ i - 3 ] : puffs[ i - 5 ];
      x = parent.x + jx * parent.w * 0.9;
      y = parent.y + parent.w * ( 0.4 + 0.2 * climb );
      r = parent.w * ( 0.6 + 0.25 * h );
      if ( i >= 19 && h11( shapeSeed * 11.3 + fi ) < 0.25 ) r = -1.0;
      y = min( y, 0.98 - max( r, 0.0 ) * 0.6 );
    }
    x = clamp( x, -1.0 + max( r, 0.0 ) * 0.6, 1.0 - max( r, 0.0 ) * 0.6 );
    puffs[ i ] = vec4( x, y, z, r );
  }
}
// Signed "inside" of the heap, before noise: puffs blended smoothly into one mass.
float heap( vec3 p ) {
  float sum = 0.0;
  for ( int i = 0; i < PUFFS; i++ ) {
    vec4 q = puffs[ i ];
    if ( q.w <= 0.0 ) continue;
    // The foot's puffs are squashed: the flat, broad bottom of fair-weather cumulus.
    float squash = q.y < 0.15 ? 1.35 : 1.05;
    float t = length( ( p - q.xyz ) * vec3( 1.0, squash, 1.0 ) ) / q.w;
    sum += exp( -3.0 * t * t );
  }
  return sum - 0.35;
}
float density( vec3 p, bool fine ) {
  float d = heap( p );
  // Noise only near the heap: far from every puff the lobes would otherwise poke
  // above zero on their own and scatter loose specks round the cloud.
  float near = smoothstep( -0.33, -0.05, d );
  // Lobes on the surface, stronger on top, at two scales: a coarse one that bites
  // whole bays out of the outline and the finer billows; grain only for what the eye sees.
  float n = ( vnoise( p * 1.6 + shapeSeed * 5.0 ) - 0.5 ) * ( 0.3 + 0.3 * p.y );
  n += ( fbm3( p * 3.4 + shapeSeed * 17.0 ) - 0.5 ) * ( 0.45 + 0.4 * p.y );
  if ( fine ) n += ( vnoise( p * 10.0 + shapeSeed ) - 0.5 ) * 0.12;
  d += n * near;
  // A flat base, soft and a little ragged.
  d *= smoothstep( 0.0, 0.1, p.y + ( vnoise( p * 7.0 ) - 0.5 ) * 0.05 );
  return clamp( d * 2.2, 0.0, 1.0 );
}
// Transmittance from p toward direction l: 5 steps through the cloud.
float lightT( vec3 p, vec3 l ) {
  float od = 0.0;
  for ( int i = 1; i <= 6; i++ ) od += density( p + l * ( float( i ) * 0.13 ), false );
  // Beer's law with a powder term: deep inside is dark, and so is the very edge on the
  // sun's side less than a plain exponential would have it.
  return exp( -od * 0.13 * 7.0 );
}
void main() {
  vec2 cellF = vUv * vec2( ${ATLAS_COLS}.0, ${ATLAS_ROWS}.0 );
  vec2 cell = floor( cellF );
  vec2 inCell = fract( cellF );
  bool below = cell.y >= ${VIEW_ROWS}.0;
  shapeSeed = mod( cell.y, ${VIEW_ROWS}.0 ) * ${ATLAS_COLS}.0 + cell.x + 1.0;
  buildPuffs();
  vec2 q = ( inCell - 0.5 ) / 0.9 + 0.5;
  // Side view: marching -z from the viewer's side. From below: marching +y up from
  // under the base, the cell's v across z (so 0.7 of x's scale: the flat quad is 0.7
  // as deep as it is wide).
  vec3 ro = below ? vec3( q.x * 2.0 - 1.0, -0.02, ( q.y * 2.0 - 1.0 ) * 0.7 ) : vec3( q.x * 2.0 - 1.0, q.y, 0.6 );
  vec3 rd = below ? vec3( 0.0, 1.0, 0.0 ) : vec3( 0.0, 0.0, -1.0 );
  const int STEPS = 36;
  float dz = 1.2 / float( STEPS );
  float T = 1.0;
  float depth = 0.0;
  vec4 lA = vec4( 0.0 ); // up, +x, -x
  vec2 lB = vec2( 0.0 ); // +z (toward the viewer), -z
  float hgt = 0.0;
  float W = 0.0;
  bool inside = all( greaterThanEqual( q, vec2( 0.0 ) ) ) && all( lessThanEqual( q, vec2( 1.0 ) ) );
  for ( int i = 0; i < STEPS; i++ ) {
    if ( !inside || T < 0.02 ) break;
    vec3 p = ro + rd * ( dz * ( float( i ) + 0.5 ) );
    float d = density( p, true );
    if ( d < 0.01 ) continue;
    float a = 1.0 - exp( -d * dz * 11.0 );
    float seen = T * a;
    lA.x += seen * lightT( p, vec3( 0.0, 1.0, 0.0 ) );
    lA.y += seen * lightT( p, vec3( 1.0, 0.0, 0.0 ) );
    lA.z += seen * lightT( p, vec3( -1.0, 0.0, 0.0 ) );
    lB.x += seen * lightT( p, vec3( 0.0, 0.0, 1.0 ) );
    lB.y += seen * lightT( p, vec3( 0.0, 0.0, -1.0 ) );
    hgt += seen * p.y;
    W += seen;
    depth += d * dz;
    T *= 1.0 - a;
  }
  float alpha = 1.0 - T;
  float inv = 1.0 / max( W, 1e-4 );
  outA = vec4( lA.x * inv, lA.y * inv, lA.z * inv, alpha );
  outB = vec4( lB.x * inv, lB.y * inv, clamp( hgt * inv, 0.0, 1.0 ), clamp( depth * 1.8, 0.0, 1.0 ) );
}
`;

const BAKE_VERTEX = /* glsl */ `
in vec3 position;
in vec2 uv;
out vec2 vUv;
void main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }
`;

const DRAW_VERTEX = /* glsl */ `
attribute vec4 aCloud; // x, z in the field, altitude, width
attribute vec2 aShape; // atlas cell, own random
attribute float aView; // 0: the upright side card, 1: the flat card under the base
uniform vec2 uCamAbs;
uniform vec2 uWind;
uniform float uCover;
varying vec2 vUv;
varying vec3 vRight;
varying vec3 vFwd;
varying float vElev;
varying float vRnd;
varying float vShow;
varying vec3 vDir;
void main() {
  float F = ${FIELD_M.toFixed(1)};
  vec2 at = aCloud.xy + uWind;
  vec2 rel = mod( at - uCamAbs + F * 0.5, F ) - F * 0.5;
  // Fewer as the cover falls: each cloud has its own threshold.
  vShow = smoothstep( aShape.y, aShape.y + 0.08, uCover ) * ( 1.0 - smoothstep( F * 0.4, F * 0.5, length( rel ) ) );
  vec3 centre = vec3( rel.x, aCloud.z, rel.y );
  float w = aCloud.w * ( 0.35 + 0.65 * vShow );
  float cell = aShape.x;
  vec2 cellUv = vec2( mod( cell, ${ATLAS_COLS}.0 ), floor( cell / ${ATLAS_COLS}.0 ) + aView * ${VIEW_ROWS}.0 );
  vec3 p;
  if ( aView < 0.5 ) {
    // Upright, turned to face the camera about the vertical.
    vec3 fwd = normalize( vec3( -rel.x, 0.0, -rel.y ) + vec3( 1e-4, 0.0, 0.0 ) );
    vRight = vec3( fwd.z, 0.0, -fwd.x );
    vFwd = fwd;
    p = centre + vRight * position.x * w + vec3( 0.0, ( position.y + 0.5 ) * w * 0.5, 0.0 );
  } else {
    // Flat at the base, on the cloud's own heading (fixed in the world, so it does not
    // spin as the camera passes beneath). 0.7 as deep as wide, as baked.
    float a = aShape.y * 6.2831853;
    vFwd = vec3( -sin( a ), 0.0, cos( a ) );
    vRight = vec3( vFwd.z, 0.0, -vFwd.x );
    p = centre + vRight * position.x * w + vFwd * position.y * w * 0.7;
  }
  // The hand-over between the views, by the cloud's elevation in the view.
  float up = smoothstep( ${VIEW_FADE_LOW}, ${VIEW_FADE_HIGH}, centre.y / length( centre ) );
  vShow *= aView < 0.5 ? 1.0 - up : up;
  vDir = p;
  vElev = normalize( p ).y;
  vRnd = aShape.y;
  vUv = ( cellUv + vec2( position.x + 0.5, position.y + 0.5 ) ) / vec2( ${ATLAS_COLS}.0, ${ATLAS_ROWS}.0 );
  // The camera's own position: the field is built round it, in camera-relative metres.
  gl_Position = projectionMatrix * viewMatrix * vec4( cameraPosition + p, 1.0 );
  // On the far plane (in front of the sky dome): behind everything real.
  gl_Position.z = gl_Position.w * 0.99999;
  if ( vShow <= 0.001 ) gl_Position = vec4( 0.0, 0.0, -2.0, 1.0 );
}
`;

const DRAW_FRAGMENT = /* glsl */ `
uniform sampler2D uAtlasA;
uniform sampler2D uAtlasB;
uniform vec3 uLightDir;
uniform vec3 uLightColor;
uniform float uLight;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform float uAmount;
uniform float uGrey;
uniform float uDusk;
varying vec2 vUv;
varying vec3 vRight;
varying vec3 vFwd;
varying float vElev;
varying float vRnd;
varying float vShow;
varying vec3 vDir;
void main() {
  vec4 a = texture2D( uAtlasA, vUv );
  vec4 b = texture2D( uAtlasB, vUv );
  float alpha = a.a * vShow * uAmount;
  if ( alpha < 0.004 ) discard;
  // The sun in the card's own frame (x right, y up, z toward the viewer), and the
  // light baked from the five sides it could come from, blended by it.
  vec3 L = normalize( uLightDir );
  vec3 l = vec3( dot( L, vRight ), L.y, dot( L, vFwd ) );
  vec3 wp = max( l, 0.0 );
  vec3 wn = max( -l, 0.0 );
  vec4 w = vec4( wp.y, wp.x, wn.x, wp.z );
  w *= w;
  float wBack = wn.z * wn.z;
  float lit = ( a.r * w.x + a.g * w.y + a.b * w.z + b.r * w.w + b.g * wBack ) / max( w.x + w.y + w.z + w.w + wBack, 1e-4 );
  float height = b.b;
  float thick = b.a;
  // Silver lining: the sun behind a thin edge, seen through it. The real view ray, so
  // it holds for the flat card under the cloud as for the upright one.
  float rim = pow( max( dot( normalize( vDir ), L ), 0.0 ), 5.0 ) * ( 1.0 - thick ) * 0.9;
  // Shade is the sky's cool blue-grey, deeper under the cloud; light the sun's warm
  // white (Shishkin's clouds: warm where lit, cold in their own shadow).
  // Part of the shade is the sky round the cloud, lower down the horizon's. At dusk the
  // horizon's glow takes a larger part: the zenith has gone deep blue by then, and a
  // cloud shaded from it alone reads as an ink blot against a pink sky. Only a larger
  // part — shaded wholly from the horizon, a cloud is the sky's own colour and flat.
  float horizonShare = mix( 0.3 + 0.25 * ( 1.0 - height ), 0.45 + 0.3 * ( 1.0 - height ), uDusk );
  vec3 shade = mix( mix( uZenith, vec3( 0.5, 0.54, 0.63 ), 0.5 ), uHorizon, horizonShare ) * mix( 0.55, 0.95, height );
  vec3 col = shade * 0.9 + uLightColor * uLight * ( lit * lit * 1.1 + rim );
  // The low sun under the cloud's level lights its base from beneath: the flat bottom
  // goes rose and gold, brightest where the cloud is thin enough to glow through,
  // while the body above keeps its own light and shade. Only the bottom band — the
  // clouds are mostly low heaps (height under 0.5), so a slow falloff tints them all.
  float under = uDusk * ( 1.0 - smoothstep( 0.12, 0.38, height ) ) * ( 0.55 + 0.45 * ( 1.0 - thick ) );
  col += mix( uHorizon, uLightColor, 0.6 ) * under * 0.9;
  // Overcast: the clouds go grey and flat.
  col = mix( col, mix( uHorizon, uZenith, 0.4 ) * ( 0.8 + 0.25 * height ), uGrey );
  // Low clouds sink into the horizon's haze, as the land does.
  col = mix( uHorizon, col, 0.25 + 0.75 * smoothstep( 0.0, 0.22, vElev ) );
  gl_FragColor = vec4( col, alpha );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** The atlas pair, baked once, both in one pass (two render targets). */
function bake(renderer: THREE.WebGLRenderer): [THREE.Texture, THREE.Texture] {
  const target = new THREE.WebGLRenderTarget(CELL_W * ATLAS_COLS, CELL_H * ATLAS_ROWS, {
    count: 2,
    type: THREE.UnsignedByteType,
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
  });
  const material = new THREE.RawShaderMaterial({
    vertexShader: BAKE_VERTEX,
    fragmentShader: BAKE_FRAGMENT,
    glslVersion: THREE.GLSL3,
    depthTest: false,
    depthWrite: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  const scene = new THREE.Scene();
  scene.add(quad);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const previous = renderer.getRenderTarget();
  renderer.setRenderTarget(target);
  renderer.render(scene, camera);
  renderer.setRenderTarget(previous);
  material.dispose();
  quad.geometry.dispose();
  for (const t of target.textures) t.colorSpace = THREE.NoColorSpace;
  return [target.textures[0]!, target.textures[1]!];
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface CloudUniforms {
  readonly zenith: THREE.Color;
  readonly horizon: THREE.Color;
}
/** Wind over the field, metres a second. */
const WIND_X = 3.2;
const WIND_Z = 1.1;

export class Clouds {
  readonly mesh: THREE.Group;
  private readonly material: THREE.ShaderMaterial;
  /** Two draw buffers, one drawn while the other is sorted into (see the header). */
  private readonly geoms: [THREE.InstancedBufferGeometry, THREE.InstancedBufferGeometry];
  private readonly meshes: [THREE.Mesh, THREE.Mesh];
  private readonly base: Float32Array;
  private readonly shape: Float32Array;
  private front = 0;
  private sortedAtX = Number.NaN;
  private sortedAtZ = Number.NaN;
  private readonly camAbs = new THREE.Vector2();

  constructor(renderer: THREE.WebGLRenderer, shared: CloudUniforms) {
    const [atlasA, atlasB] = bake(renderer);
    const rnd = mulberry(0x636c6f75);
    this.base = new Float32Array(COUNT * 4);
    this.shape = new Float32Array(COUNT * 2);
    for (let i = 0; i < COUNT; i++) {
      this.base[i * 4] = rnd() * FIELD_M;
      this.base[i * 4 + 1] = rnd() * FIELD_M;
      this.base[i * 4 + 2] = ALTITUDE_M + (rnd() - 0.5) * ALTITUDE_SPREAD_M;
      // Many small, few large: the size of the sky's clouds is skewed.
      this.base[i * 4 + 3] = WIDTH_MIN_M + (WIDTH_MAX_M - WIDTH_MIN_M) * rnd() ** 2.2;
      this.shape[i * 2] = Math.floor(rnd() * SHAPES);
      this.shape[i * 2 + 1] = rnd();
    }
    this.material = new THREE.ShaderMaterial({
      vertexShader: DRAW_VERTEX,
      fragmentShader: DRAW_FRAGMENT,
      uniforms: {
        uAtlasA: { value: atlasA },
        uAtlasB: { value: atlasB },
        uCamAbs: { value: this.camAbs },
        uWind: { value: new THREE.Vector2() },
        uCover: { value: 0.5 },
        uLightDir: { value: new THREE.Vector3(0, 1, 0) },
        uLightColor: { value: new THREE.Color() },
        uLight: { value: 1 },
        uZenith: { value: shared.zenith },
        uHorizon: { value: shared.horizon },
        uAmount: { value: 1 },
        uGrey: { value: 0 },
        uDusk: { value: 0 },
      },
      transparent: true,
      // The flat card under the base is seen from below, the upright one from either
      // side of its turn: no winding is "front" for both.
      side: THREE.DoubleSide,
      depthWrite: false,
      depthTest: true,
    });
    // Two quads per cloud (see TWO VIEWS): the flat one first, so where both show
    // during the hand-over the upright one blends over it.
    const quad = new THREE.PlaneGeometry(1, 1);
    const quadPos = quad.getAttribute('position').array as Float32Array;
    const quadIndex = quad.index!.array;
    const positions = new Float32Array(quadPos.length * 2);
    positions.set(quadPos, 0);
    positions.set(quadPos, quadPos.length);
    const views = new Float32Array([1, 1, 1, 1, 0, 0, 0, 0]);
    const indices = new Uint16Array(quadIndex.length * 2);
    for (let k = 0; k < quadIndex.length; k++) {
      indices[k] = quadIndex[k]!;
      indices[k + quadIndex.length] = quadIndex[k]! + 4;
    }
    const position = new THREE.BufferAttribute(positions, 3);
    const view = new THREE.BufferAttribute(views, 1);
    const index = new THREE.BufferAttribute(indices, 1);
    quad.dispose();
    const geom = (): THREE.InstancedBufferGeometry => {
      const g = new THREE.InstancedBufferGeometry();
      g.setIndex(index);
      g.setAttribute('position', position);
      g.setAttribute('aView', view);
      g.setAttribute('aCloud', new THREE.InstancedBufferAttribute(new Float32Array(COUNT * 4), 4));
      g.setAttribute('aShape', new THREE.InstancedBufferAttribute(new Float32Array(COUNT * 2), 2));
      g.instanceCount = 0;
      return g;
    };
    this.geoms = [geom(), geom()];
    this.mesh = new THREE.Group();
    const card = (g: THREE.InstancedBufferGeometry): THREE.Mesh => {
      const m = new THREE.Mesh(g, this.material);
      m.frustumCulled = false;
      // After the stars (-8) and planets (-7), so a cloud hides them.
      m.renderOrder = 6;
      m.visible = false;
      this.mesh.add(m);
      return m;
    };
    this.meshes = [card(this.geoms[0]), card(this.geoms[1])];
  }

  private windX = 0;
  private windZ = 0;
  private lastT = Number.NaN;

  /**
   * Once a frame. `camX`/`camZ` the camera's ABSOLUTE world position (the field is in
   * world metres), `light` the key light (sun or moon) direction and colour and its
   * strength against full day, `cover` the cumulus cover 0..1, `overcast` 0..1,
   * `amount` 0..1 how visible clouds are at all (they fade into the night), `dusk` 0..1
   * how strongly a low sun lights the bases from underneath.
   */
  update(camX: number, camZ: number, lightDir: THREE.Vector3, lightColor: THREE.Color, light: number, cover: number, overcast: number, amount: number, dusk: number): void {
    const u = this.material.uniforms;
    this.camAbs.set(camX, camZ);
    // The wind: its own clock, wrapped on the field, so it never jumps.
    const now = performance.now() * 0.001;
    const dt = Number.isFinite(this.lastT) ? Math.min(0.1, now - this.lastT) : 0;
    this.lastT = now;
    this.windX = (this.windX + dt * WIND_X) % FIELD_M;
    this.windZ = (this.windZ + dt * WIND_Z) % FIELD_M;
    (u.uWind!.value as THREE.Vector2).set(this.windX, this.windZ);
    u.uCover!.value = Math.min(1, cover + overcast * 0.5);
    (u.uLightDir!.value as THREE.Vector3).copy(lightDir);
    (u.uLightColor!.value as THREE.Color).copy(lightColor);
    u.uLight!.value = light;
    u.uGrey!.value = overcast * 0.85;
    u.uAmount!.value = amount;
    u.uDusk!.value = dusk;
    if (!(Math.hypot(camX - this.sortedAtX, camZ - this.sortedAtZ) < RESORT_M)) this.sort(camX, camZ);
  }

  /**
   * Sorts the clouds far to near into the buffer not being drawn, and swaps: blended
   * cards overlap, and must be drawn back to front. The wind moves the field too slowly
   * between sorts (every `RESORT_M` of travel) to upset the order visibly.
   */
  private sort(camX: number, camZ: number): void {
    this.sortedAtX = camX;
    this.sortedAtZ = camZ;
    const wind = this.material.uniforms.uWind!.value as THREE.Vector2;
    const F = FIELD_M;
    const order = Array.from({ length: COUNT }, (_, i) => {
      const rx = ((((this.base[i * 4]! + wind.x - camX + F / 2) % F) + F) % F) - F / 2;
      const rz = ((((this.base[i * 4 + 1]! + wind.y - camZ + F / 2) % F) + F) % F) - F / 2;
      return { i, d: rx * rx + rz * rz };
    }).sort((a, b) => b.d - a.d);
    const back = 1 - this.front;
    const g = this.geoms[back]!;
    const c = g.getAttribute('aCloud') as THREE.InstancedBufferAttribute;
    const s = g.getAttribute('aShape') as THREE.InstancedBufferAttribute;
    order.forEach(({ i }, k) => {
      (c.array as Float32Array).set(this.base.subarray(i * 4, i * 4 + 4), k * 4);
      (s.array as Float32Array).set(this.shape.subarray(i * 2, i * 2 + 2), k * 2);
    });
    c.needsUpdate = true;
    s.needsUpdate = true;
    g.instanceCount = COUNT;
    this.meshes[back]!.visible = true;
    this.meshes[this.front]!.visible = false;
    this.front = back;
  }
}
