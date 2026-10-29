import * as THREE from 'three';

import { desertPaletteAt } from '../world/gradient';
import type { RebaseShift, WorldOrigin } from '../world/origin';
import {
  EMBANKMENT_BATTER_M,
  EMBANKMENT_HEIGHT_M,
  SHOULDER_FALL_INNER,
  SHOULDER_FALL_OUTER,
  SHOULDER_WIDTH_M,
} from '../world/roadprofile';
import { GROUND_BACKSCATTER_GAIN } from './groundlight';
import { LAMP_OCCLUDER_GLSL, LAMP_SHADOW_FLOOR, LAMP_SOURCE_M, lampOccluderUniform, type LampOccluders } from './lampoccluders';

/**
 * THE SECOND TIER OF LAMP LIGHT: a lamp without a spotlight slot still lights the ground.
 *
 * The renderer's spot slots are few and fixed (render/vehiclelights.ts): measured on a
 * night drive with normal traffic, 23-31 beams wanted one at the median and up to 47,
 * against 11 slots. A lamp refused a slot used to lay NO light at all: its lens glowed and
 * the road under it stayed night. Each lamp without a slot now lays a POOL instead: a
 * soft additive patch on the ground under its beam, shaded per pixel by the same spot,
 * range and incidence terms three's own spotlight uses, so a beam handed from its pool to
 * a slot (or back) by the slot pool's fade (render/slotpool.ts) neither steps nor shifts.
 * The cars standing in the beam cut its light as boxes (render/lampoccluders.ts), and the
 * cars it reaches are lit by it through their own material (`lightOn`, render/materials.ts
 * `setCarPoolLight`); posts and walls are not. A headlamp whose slot lights the ground
 * lays a SHADE pool in the same draw: its light negated, in the wedge behind the boxes in
 * its beam, where they stop it, which is the shadow no slot but one has a map for.
 *
 * ONE DRAW CALL. Every pool is a grid of `POOL_ROWS` x `POOL_COLS` vertices in one
 * geometry, rewritten each frame in place like the contact patches
 * (render/contactpatches.ts); the draw range says how many are live. The grid lies on the
 * ground: the rows near the car on its own tyre contact plane, the far rows of a
 * headlamp's pool where the beam is this frame at the terrain's height, sampled by the
 * caller (`takeSamples`, `groundHeight`) when the car has moved on, and the whole pool's
 * depth pulled toward the eye so the coarse grid never sinks into what it lights. A
 * headlamp's grid runs out to most of the beam's cutoff and across its whole cone: a
 * slot's light on the sand is still half the night's own a couple of hundred metres out,
 * and a pool that stopped at 75 m and faded its sides from 70% of the cone left all of
 * that dark until a slot took the beam over (measured 2026-10-30).
 *
 * WHAT IT LIGHTS. A pool adds light, so it carries the reflectance of the ground under
 * it, and the ground under a headlamp's pool is two: dark asphalt and the sand either
 * side, which takes the same beam five times brighter. Every vertex carries its signed
 * distance from the road's centreline, linear across a pool on a road straight enough to
 * see, and the shader picks asphalt or the desert's sand there by the road's half-width.
 * The ground's own shading (render/groundlight.ts) is matched term by term: Lambert, the
 * backscatter toward the eye, and the RELIEF the ground's normals carry that a flat pool's
 * up does not (`poolIncidence`).
 */

/** Rows of a pool's grid, along the beam; the first is just behind the lamp. */
export const POOL_ROWS = 8;
/** Columns of a pool's grid, across the beam, edge to edge through the axis. */
export const POOL_COLS = 5;
export const POOL_VERTS = POOL_ROWS * POOL_COLS;
/** Pools in the field: every lit group of about twenty cars. */
const POOL_CAPACITY = 64;
/**
 * Floats per vertex in the one interleaved buffer: position, lamp A, lamp B, beam axis,
 * colour (3 each), the beam's cone cosine, penumbra cosine, decay and cutoff, then the
 * vertex's road lateral and the road's half-width, the occluder mask
 * (render/lampoccluders.ts), the road's across (the lateral's gradient in x, z), and the
 * ground's normal there (`poolGridNormals`).
 */
const STRIDE = 27;
/** Floats per vertex of the grids callers pass: position and road lateral. */
export const POOL_GRID_STRIDE = 4;
/** Lift off the ground, metres, besides the polygon offset: the far rows are chords. */
export const POOL_LIFT_M = 0.05;
/**
 * The depth pull toward the eye (see the vertex shader): this much at the eye plus this
 * share of the distance, so 0.3 m at 10 m, 0.9 m at 30 m and 7.5 m at 300 m. A far row's
 * cells are a hundred metres across and their chords cut through the dunes; anything
 * standing that far out hides the ground tens of metres behind it along a ray this
 * shallow, so the pull only reaches the foot of it.
 */
const POOL_PULL = new THREE.Vector2(0.15, 0.025);
/**
 * The reflectance a pool's light lands on, asphalt, the shoulder's stone and sand, as the
 * ground's own shading shows a spotlight's at night. Matched by reading the scene target
 * (2026-10-30): the same lamp as a slot and as a pool at one pose, 266 points on the
 * road, the verge and the sand from 8 to 200 m, the sum of each surface's added light
 * brought to within 10% of the slot's at 8-120 m. The asphalt is the lane's mean: its
 * polished wheel tracks take twice the oil strip's light (render/roadlook.ts). Sand is
 * the desert's own colour at the road's arclength (world/gradient.ts) times
 * `SAND_ALBEDO_SCALE`; the stone is the shoulder's (world/roadmesh.ts), whose band gives
 * way to sand `SHOULDER_SAND_FROM_M` to `SHOULDER_SAND_TO_M` past the asphalt.
 */
const ROAD_ALBEDO = new THREE.Color(0.15, 0.141, 0.1275);
const SHOULDER_ALBEDO = new THREE.Color(0x6b6158).multiplyScalar(0.8);
const SAND_ALBEDO_SCALE = 1;
const SHOULDER_SAND_FROM_M = 1.1;
const SHOULDER_SAND_TO_M = 2.1;
/**
 * RELIEF: the spread of the ground's normals about its up, road and sand. A slot lights
 * the real normals (the road's slope normal, the terrain's smooth ones), and on ground a
 * beam grazes the faces tipped toward it take most of the light: on the sand 150 m out a
 * slot showed three times what a flat Lambert gives. A pool takes the mean of Lambert
 * over normals spread this much (`poolIncidence`), which is the flat cosine wherever the
 * beam comes down steeply and never falls to nothing at the horizon.
 */
const RELIEF = new THREE.Vector2(0.012, 0.04);
/** Metres either side of the asphalt's edge over which the two blend. */
const ROAD_EDGE_BLEND_M = 0.3;
/**
 * GLSL: `float embankmentFall( float e )`, the formation's fall outward (rise over run)
 * `e` metres past the asphalt's edge: the shoulder steepening from
 * `SHOULDER_FALL_INNER` to `SHOULDER_FALL_OUTER`, then the batter, the slope of
 * world/roadprofile.ts `embankmentDropAt`. The pool tips its normal outward by
 * `EMBANKMENT_TILT` of it: the verge faces away from a beam coming down the road, and a
 * slot showed the far verge a third as bright as a flat pool. Not all of it: the grid's
 * chord stands over the batter, so a pixel of the sand at its foot reads the pool at the
 * batter's lateral, and the full fall blacked out a strip of lit sand there.
 */
const EMBANKMENT_FALL_GLSL = /* glsl */ `
float embankmentFall( float e ) {
  if ( e <= 0.0 ) return 0.0;
  if ( e <= ${SHOULDER_WIDTH_M.toFixed(3)} ) return ${SHOULDER_FALL_INNER.toFixed(4)} + ${((SHOULDER_FALL_OUTER - SHOULDER_FALL_INNER) / SHOULDER_WIDTH_M).toFixed(5)} * e;
  float u = ( e - ${SHOULDER_WIDTH_M.toFixed(3)} ) / ${EMBANKMENT_BATTER_M.toFixed(3)};
  if ( u >= 1.0 ) return 0.0;
  return ( ( 3.0 * u * u - 4.0 * u + 1.0 ) * ${(SHOULDER_FALL_OUTER * EMBANKMENT_BATTER_M).toFixed(5)} + ( 6.0 * u - 6.0 * u * u ) * ${(EMBANKMENT_HEIGHT_M - (SHOULDER_WIDTH_M * (SHOULDER_FALL_INNER + SHOULDER_FALL_OUTER)) / 2).toFixed(5)} ) / ${EMBANKMENT_BATTER_M.toFixed(3)};
}
`;
const EMBANKMENT_TILT = 0.3;
/** Height samples the field allows per frame (`takeSamples`): two cars' headlamp pools. */
const SAMPLES_PER_FRAME = 70;
/** Floats per pool in the beam records `lightOn` reads: lamps, axis, colour, shape. */
const BEAM_RECORD = 16;
/**
 * Most a car's dominant pooled beam is brightened by to carry the others reaching it
 * (`lightOn`): one stand-in lamp pair, so many beams at once read as one stronger one.
 */
const MAX_FOLDED_GAIN = 3;
/** Floats `lightOn` writes: lamp A, lamp B, axis, colour (vec4 each, w unused), shape. */
export const POOL_LIGHT_FLOATS = 20;

/** Where a point lies in the road's frame. */
export interface PoolRoadFrame {
  s: number;
  /** Signed distance from the centreline, positive LEFT of travel (world/road.ts). */
  lateral: number;
  /** The road's heading at `s`: travel is (sin, cos) in x, z. */
  heading: number;
  halfWidth: number;
}

/** The ground pools lie on, in ABSOLUTE world coordinates. */
export interface PoolGround {
  /** The road frame at a point; `hintS` (finite) makes it a local search. */
  frame(x: number, z: number, hintS: number, out: PoolRoadFrame): PoolRoadFrame;
  /** Ground height at a point whose road arclength is `s`. */
  heightAt(x: number, z: number, s: number): number;
}

const VERTEX = /* glsl */ `
attribute vec2 quad;
attribute vec3 lampA;
attribute vec3 lampB;
attribute vec3 beamAxis;
attribute vec3 beamColor;
attribute vec4 beamShape;
attribute vec2 roadFrame;
attribute vec2 roadAcross;
attribute float occluders;
attribute vec3 groundNormal;
uniform vec2 uPull;
varying vec2 vQuad;
varying vec2 vRoad;
varying vec2 vAcross;
varying vec3 vNormal;
varying vec3 vWorld;
varying vec3 vToA;
varying vec3 vToB;
varying vec3 vAxis;
varying vec3 vColor;
varying vec4 vShape;
// The pool's box mask, the same at every vertex of a pool, so interpolated it is exact.
// Not a flat int: ANGLE over Metal rebuilt the draw for its provoking vertex, and from
// the cabin that alone cost 18 ms a frame (2026-10-30, M2 Pro).
varying float vOccluders;
#include <fog_pars_vertex>

void main() {
  vQuad = quad;
  // Linear across a triangle, since the lamps are constant over the pool: exact.
  vToA = lampA - position;
  vToB = lampB - position;
  vWorld = position;
  vAxis = beamAxis;
  vColor = beamColor;
  vShape = beamShape;
  vRoad = roadFrame;
  vAcross = roadAcross;
  vNormal = groundNormal;
  vOccluders = occluders;
  vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );
  // THE DEPTH IS PULLED TOWARD THE EYE along the view ray (POOL_PULL): the screen
  // position is unchanged, but a pool drawn as chords between rows 20-100 m apart, over
  // a road's crown, a dune or a race track's asphalt raised over the ground the terrain
  // reports, still lies in front of the ground it lights instead of under it. Anything
  // standing on that ground is metres in front of it along a ray this shallow, and
  // still hides it.
  float eyeDistance = max( length( mvPosition.xyz ), 1e-3 );
  float pull = min( 0.5 * eyeDistance, uPull.x + uPull.y * eyeDistance );
  gl_Position = projectionMatrix * vec4( mvPosition.xyz * ( 1.0 - pull / eyeDistance ), 1.0 );
  #include <fog_vertex>
}`;

const FRAGMENT = /* glsl */ `
uniform vec3 uRoadAlbedo;
uniform vec3 uShoulderAlbedo;
uniform vec3 uSandAlbedo;
uniform vec2 uRelief;
varying vec2 vQuad;
varying vec3 vNormal;
varying vec2 vRoad;
varying vec2 vAcross;
varying vec3 vWorld;
varying vec3 vToA;
varying vec3 vToB;
varying vec3 vAxis;
varying vec3 vColor;
varying vec4 vShape;
varying float vOccluders;
#include <fog_pars_fragment>
${LAMP_OCCLUDER_GLSL}
${EMBANKMENT_FALL_GLSL}

// The mean of Lambert, max( n.l, 0 ), over ground normals spread by sigma about the
// normal (RELIEF), for light arriving at cos c to it: c where the beam comes down
// steeply, 0.4 sigma at the horizon. A hyperbola through both, within 5% of a
// Gaussian's partial expectation and one square root.
float poolIncidence( float c, float sigma ) {
  return 0.5 * ( c + sqrt( c * c + 0.64 * sigma * sigma ) );
}

// Three's spotlight cone (lights_pars_begin: getSpotAttenuation) for a lamp in direction l.
float lampSpot( vec3 l ) {
  return smoothstep( vShape.x, vShape.y, dot( -l, vAxis ) );
}

void main() {
  int occluders = int( vOccluders + 0.5 );
  // The cone first, per lamp, and nothing more where neither lamp reaches: the grid
  // covers the whole cone, most of it in the penumbra. Out by writing nothing, never by
  // discard: a shader that can discard loses the early depth test, and from the cabin
  // every pool lies under the car's floor.
  gl_FragColor = vec4( 0.0 );
  float dA = max( length( vToA ), 1e-4 );
  float dB = max( length( vToB ), 1e-4 );
  float spotA = lampSpot( vToA / dA );
  float spotB = lampSpot( vToB / dB );
  // The grid covers the whole cone; only its far end is faded, where the light is low. A
  // shade pool's columns are the wedge behind its boxes (vehicle/vehiclelamps.ts), not
  // the cone's edges, and are not faded.
  float rim = ( vColor.r < 0.0 ? 1.0 : 1.0 - smoothstep( 0.9, 1.0, abs( vQuad.y ) ) ) * ( 1.0 - smoothstep( 0.86, 1.0, vQuad.x ) );
  if ( ( spotA + spotB ) * rim <= 0.0 ) return;
  // Range, incidence and backscatter once, from between the lamps: they are a metre
  // apart and level, so on the ground they differ by a few per cent 2.5 m out and by
  // nothing further (three's getDistanceAttenuation; render/groundlight.ts).
  vec3 toMid = 0.5 * ( vToA + vToB );
  float source = ${LAMP_SOURCE_M.toFixed(3)} + 0.5 * length( vToA - vToB );
  // A SHADE pool (negative colour, LampPoolField.add) takes away the light of a lamp
  // whose spotlight slot lights this ground, where a car in its beam stops it: the box
  // test first, and nothing more where nothing stands in the way.
  float shade = 0.0;
  if ( vColor.r < 0.0 ) {
    shade = 1.0 - lampOccluderLight( vWorld, vWorld + toMid, source, occluders );
    if ( shade < 0.005 ) return;
  }
  float d = max( length( toMid ), 1e-4 );
  vec3 l = toMid / d;
  float falloff = 1.0 / max( pow( d, vShape.z ), 0.01 );
  float r = d / vShape.w;
  r *= r;
  float window = clamp( 1.0 - r * r, 0.0, 1.0 );
  vec3 viewDir = normalize( cameraPosition - vWorld );
  float behind = clamp( dot( viewDir, l ), 0.0, 1.0 );
  behind *= behind;
  behind *= behind;
  behind *= behind;
  // The ground's normal at the grid's vertices (poolGridNormals), smooth across each
  // cell: rows 20-100 m apart drawn with their facets' own normals made each facet's
  // light a step of its own. The verge falls away from the road (embankmentFall), finer
  // than the grid; what the real normals add besides is RELIEF's.
  float past = abs( vRoad.x ) - vRoad.y;
  float verge = smoothstep( -${ROAD_EDGE_BLEND_M.toFixed(2)}, ${ROAD_EDGE_BLEND_M.toFixed(2)}, past );
  float sand = smoothstep( ${SHOULDER_SAND_FROM_M.toFixed(2)}, ${SHOULDER_SAND_TO_M.toFixed(2)}, past );
  vec3 outward = vec3( vAcross.x, 0.0, vAcross.y ) * sign( vRoad.x );
  vec3 normal = normalize( normalize( vNormal ) + ${EMBANKMENT_TILT.toFixed(2)} * embankmentFall( past ) * outward );
  float sigma = mix( uRelief.x, uRelief.y, verge );
  float light = falloff * window * window * poolIncidence( dot( normal, l ), sigma ) * ( 1.0 + ${GROUND_BACKSCATTER_GAIN.toFixed(3)} * behind );
  // The cars in the beam (render/lampoccluders.ts), seen from between the two lamps as
  // one source as wide as the pair: one test where two would cost twice as much and
  // differ only in the penumbra's two steps. Not where the light is too dim for any
  // shadow in it to show (LAMP_SHADOW_FLOOR).
  vec3 albedo = mix( mix( uRoadAlbedo, uShoulderAlbedo, verge ), uSandAlbedo, sand );
  vec3 lit = vColor * albedo * ( 0.31830989 * ( spotA + spotB ) * light * rim );
  if ( vColor.r < 0.0 ) lit *= shade;
  else if ( occluders != 0 && dot( lit, vec3( 0.2126, 0.7152, 0.0722 ) ) > ${LAMP_SHADOW_FLOOR.toExponential(3)} ) {
    lit *= lampOccluderLight( vWorld, vWorld + toMid, source, occluders );
  }
  float visibility = 1.0;
  #ifdef USE_FOG
    #ifdef FOG_EXP2
      visibility = exp( -fogDensity * fogDensity * vFogDepth * vFogDepth );
    #else
      visibility = 1.0 - smoothstep( fogNear, fogFar, vFogDepth );
    #endif
  #endif
  // Added to what the ground already shows, as a slot's light would be: Lambert,
  // albedo over pi (render/groundlight.ts).
  gl_FragColor = vec4( lit * visibility, 1.0 );
}`;

const _lampMid = new THREE.Vector3();
const _probe = new THREE.Vector3();
const _beamLamp = new THREE.Vector3();
const _beamLampB = new THREE.Vector3();
const _beamAxis = new THREE.Vector3();

export class LampPoolField {
  /** The rig's headlamp reach scale (render/vehiclelights.ts), for a headlamp's cutoff. */
  readonly headlightDistanceScale: number;
  readonly mesh: THREE.Mesh;
  private readonly geometry = new THREE.BufferGeometry();
  private readonly material: THREE.ShaderMaterial;
  private readonly data = new Float32Array(POOL_CAPACITY * POOL_VERTS * STRIDE);
  private readonly buffer: THREE.InterleavedBuffer;
  private readonly unregisterOrigin: () => void;
  /** Each live pool's beam (`BEAM_RECORD`) and the car it belongs to, for `lightOn`. */
  private readonly beams = new Float32Array(POOL_CAPACITY * BEAM_RECORD);
  private readonly owners: (object | null)[] = new Array<object | null>(POOL_CAPACITY).fill(null);
  /** Pools written this frame; the draw range follows it. */
  private used = 0;
  private samplesLeft = SAMPLES_PER_FRAME;
  /** Counts frames, so a car asks for its road frame once a frame (`frameId`). */
  private frame = 0;
  private readonly sandAlbedo = new THREE.Color();
  private sandArclength = Number.NaN;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly origin: WorldOrigin,
    private readonly ground: PoolGround,
    headlightDistanceScale: number,
    private readonly occluders: LampOccluders,
  ) {
    this.headlightDistanceScale = headlightDistanceScale;
    const quad = new Float32Array(POOL_CAPACITY * POOL_VERTS * 2);
    const indices = new Uint16Array(POOL_CAPACITY * (POOL_ROWS - 1) * (POOL_COLS - 1) * 6);
    const midColumn = (POOL_COLS - 1) / 2;
    let o = 0;
    for (let p = 0; p < POOL_CAPACITY; p++) {
      const base = p * POOL_VERTS;
      for (let r = 0; r < POOL_ROWS; r++) {
        for (let c = 0; c < POOL_COLS; c++) {
          const v = base + r * POOL_COLS + c;
          quad[v * 2] = r / (POOL_ROWS - 1);
          quad[v * 2 + 1] = (c - midColumn) / midColumn;
          if (r === POOL_ROWS - 1 || c === POOL_COLS - 1) continue;
          indices[o++] = v;
          indices[o++] = v + POOL_COLS;
          indices[o++] = v + 1;
          indices[o++] = v + 1;
          indices[o++] = v + POOL_COLS;
          indices[o++] = v + POOL_COLS + 1;
        }
      }
    }
    this.buffer = new THREE.InterleavedBuffer(this.data, STRIDE);
    this.buffer.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('position', new THREE.InterleavedBufferAttribute(this.buffer, 3, 0));
    this.geometry.setAttribute('lampA', new THREE.InterleavedBufferAttribute(this.buffer, 3, 3));
    this.geometry.setAttribute('lampB', new THREE.InterleavedBufferAttribute(this.buffer, 3, 6));
    this.geometry.setAttribute('beamAxis', new THREE.InterleavedBufferAttribute(this.buffer, 3, 9));
    this.geometry.setAttribute('beamColor', new THREE.InterleavedBufferAttribute(this.buffer, 3, 12));
    this.geometry.setAttribute('beamShape', new THREE.InterleavedBufferAttribute(this.buffer, 4, 15));
    this.geometry.setAttribute('roadFrame', new THREE.InterleavedBufferAttribute(this.buffer, 2, 19));
    this.geometry.setAttribute('occluders', new THREE.InterleavedBufferAttribute(this.buffer, 1, 21));
    this.geometry.setAttribute('roadAcross', new THREE.InterleavedBufferAttribute(this.buffer, 2, 22));
    this.geometry.setAttribute('groundNormal', new THREE.InterleavedBufferAttribute(this.buffer, 3, 24));
    this.geometry.setAttribute('quad', new THREE.BufferAttribute(quad, 2));
    this.geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    this.geometry.setDrawRange(0, 0);

    this.material = new THREE.ShaderMaterial({
      name: 'lamp-pool',
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        ...THREE.UniformsLib.fog,
        uRoadAlbedo: { value: ROAD_ALBEDO },
        uShoulderAlbedo: { value: SHOULDER_ALBEDO },
        uSandAlbedo: { value: this.sandAlbedo },
        uRelief: { value: RELIEF },
        uPull: { value: POOL_PULL },
        uLampOccluders: lampOccluderUniform,
      },
      fog: true,
      transparent: true,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = 'lamp-pools';
    // Rewritten every frame; bounds computed once would cull the field wrongly. In the
    // scene from boot, so the boot warm-up links its one program.
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.renderOrder = 1;
    scene.add(this.mesh);
    this.unregisterOrigin = origin.register(this);
  }

  /** Absolute X of the floating origin: scene = absolute - origin. */
  get originX(): number {
    return this.origin.x;
  }

  get originZ(): number {
    return this.origin.z;
  }

  /** Pools drawn this frame. */
  get poolCount(): number {
    return this.used;
  }

  /** This frame's number; see `frame`. */
  get frameId(): number {
    return this.frame;
  }

  /**
   * Starts a frame's collection at the active road arclength `s`, whose desert colour
   * the sand under the pools takes. Nothing is hidden until `endFrame`. The occluders
   * (render/lampoccluders.ts) must hold this frame's cars before the first `add`.
   */
  beginFrame(s: number): void {
    this.used = 0;
    this.samplesLeft = SAMPLES_PER_FRAME;
    this.frame++;
    if (!(Math.abs(s - this.sandArclength) < 25)) {
      this.sandArclength = s;
      this.sandAlbedo.setHex(desertPaletteAt(s).sand).multiplyScalar(SAND_ALBEDO_SCALE);
    }
  }

  /**
   * Claims `count` terrain samples from this frame's allowance; false when it is spent.
   * The callers' walk starts at a different car each frame (main.ts), so it goes round.
   */
  takeSamples(count: number): boolean {
    if (this.samplesLeft < count) return false;
    this.samplesLeft -= count;
    return true;
  }

  /** The road frame at an absolute world position; a NaN hint searches the whole road. */
  roadFrame(x: number, z: number, hintS: number, out: PoolRoadFrame): PoolRoadFrame {
    return this.ground.frame(x, z, hintS, out);
  }

  /** Ground height at an absolute world position whose road arclength is `s`. */
  groundHeight(x: number, z: number, s: number): number {
    return this.ground.heightAt(x, z, s);
  }

  /**
   * The cars' boxes (render/lampoccluders.ts) a lamp group at `lamp` (its lamps' middle),
   * aimed along `axis` with outer cone cosine `coneCos`, can shade within `reach` metres,
   * never its `owner`'s own: the mask `add` takes.
   */
  occluderMask(owner: object, lamp: THREE.Vector3, axis: THREE.Vector3, coneCos: number, reach: number): number {
    return this.occluders.mask(owner, lamp, axis, coneCos, reach);
  }

  /** The wedge the boxes in `mask` shade (render/lampoccluders.ts `sector`). */
  occluderSector(
    mask: number,
    lamp: THREE.Vector3,
    forward: THREE.Vector3,
    across: THREE.Vector3,
    halfSpacing: number,
    out: { min: number; max: number },
  ): boolean {
    return this.occluders.sector(mask, lamp, forward, across, halfSpacing, out);
  }

  /**
   * Writes one lamp group's pool, or does nothing when the field is full.
   *
   * `owner` is the car the lamps belong to. `shade`: a SHADE pool, the shadows the cars in
   * the beam cast in the light of lamps whose spotlight slots light the ground (no slot
   * but the driven car's one shadowed beam has a shadow map): drawn with the colour
   * negated, where a box stops the light. `occluders` is the beam's box mask
   * (`occluderMask`). `grid` holds `POOL_VERTS` vertices of `POOL_GRID_STRIDE` floats,
   * row by row from the lamps outwards and left to right: scene position and road
   * lateral; `normals` the ground's unit normal at each (`poolGridNormals`). `road` is
   * the car's road frame (its half-width and heading stand for the pool's).
   * `lampA`/`lampB` are the group's two lamps; `axis` the beam's unit direction; `r,g,b`
   * the linear colour times intensity, gain and share, as a spotlight's
   * `color * intensity` would be.
   */
  add(
    owner: object,
    shade: boolean,
    occluders: number,
    grid: Float32Array,
    normals: Float32Array,
    road: PoolRoadFrame,
    lampA: THREE.Vector3,
    lampB: THREE.Vector3,
    axis: THREE.Vector3,
    r: number,
    g: number,
    b: number,
    coneCos: number,
    penumbraCos: number,
    decay: number,
    cutoff: number,
  ): void {
    if (!(r + g + b > 0) || this.used >= POOL_CAPACITY) return;
    if (shade) {
      r = -r;
      g = -g;
      b = -b;
    }
    // The lateral's gradient: world/road.ts lateral grows LEFT of travel (sin, cos).
    const acrossX = Math.cos(road.heading);
    const acrossZ = -Math.sin(road.heading);
    const halfWidth = road.halfWidth;
    const beam = this.used * BEAM_RECORD;
    const beams = this.beams;
    lampA.toArray(beams, beam);
    lampB.toArray(beams, beam + 3);
    axis.toArray(beams, beam + 6);
    beams[beam + 9] = r;
    beams[beam + 10] = g;
    beams[beam + 11] = b;
    beams[beam + 12] = coneCos;
    beams[beam + 13] = penumbraCos;
    beams[beam + 14] = decay;
    beams[beam + 15] = cutoff;
    this.owners[this.used] = owner;
    const data = this.data;
    let o = this.used * POOL_VERTS * STRIDE;
    this.used++;
    for (let v = 0; v < POOL_VERTS; v++) {
      const i = v * POOL_GRID_STRIDE;
      data[o] = grid[i];
      data[o + 1] = grid[i + 1];
      data[o + 2] = grid[i + 2];
      data[o + 3] = lampA.x;
      data[o + 4] = lampA.y;
      data[o + 5] = lampA.z;
      data[o + 6] = lampB.x;
      data[o + 7] = lampB.y;
      data[o + 8] = lampB.z;
      data[o + 9] = axis.x;
      data[o + 10] = axis.y;
      data[o + 11] = axis.z;
      data[o + 12] = r;
      data[o + 13] = g;
      data[o + 14] = b;
      data[o + 15] = coneCos;
      data[o + 16] = penumbraCos;
      data[o + 17] = decay;
      data[o + 18] = cutoff;
      data[o + 19] = grid[i + 3];
      data[o + 20] = halfWidth;
      data[o + 21] = occluders;
      data[o + 22] = acrossX;
      data[o + 23] = acrossZ;
      data[o + 24] = normals[v * 3];
      data[o + 25] = normals[v * 3 + 1];
      data[o + 26] = normals[v * 3 + 2];
      o += STRIDE;
    }
  }

  /** Publishes the frame: one upload of the live pools. */
  endFrame(): void {
    const count = this.used * (POOL_ROWS - 1) * (POOL_COLS - 1) * 6;
    if (this.geometry.drawRange.count !== count) this.geometry.setDrawRange(0, count);
    if (this.used === 0) return;
    this.buffer.clearUpdateRanges();
    this.buffer.addUpdateRange(0, this.used * POOL_VERTS * STRIDE);
    this.buffer.needsUpdate = true;
  }

  /**
   * The pooled light on a car (a sphere at `centre`, `radius`, owned by `owner`, whose
   * own pools are skipped), as ONE stand-in lamp pair the car's material evaluates per
   * pixel with the pool's own spot and range (render/materials.ts `setCarPoolLight`): the
   * beam putting the most light on the car, its colour raised by the others' share of
   * what reaches it (at most `MAX_FOLDED_GAIN` times). Written to `out`
   * (`POOL_LIGHT_FLOATS`, scene coordinates); false, and `out` untouched, when no pool
   * reaches the car. Call after this frame's last `add`.
   */
  lightOn(owner: object, centre: THREE.Vector3, radius: number, out: Float32Array): boolean {
    const beams = this.beams;
    let best = -1;
    let bestLight = 0;
    let total = 0;
    for (let p = 0; p < this.used; p++) {
      if (this.owners[p] === owner) continue;
      const o = p * BEAM_RECORD;
      const lampA = _beamLamp.fromArray(beams, o);
      const cutoff = beams[o + 15];
      const reach = cutoff + radius;
      if (lampA.distanceToSquared(centre) > reach * reach) continue;
      const lampB = _beamLampB.fromArray(beams, o + 3);
      const axis = _beamAxis.fromArray(beams, o + 6);
      // The centre, and the point of the car's sphere toward the lamps: a beam that only
      // reaches the car's near end still lights it.
      let light = 0;
      for (let k = 0; k < 2; k++) {
        const probe = _probe.copy(centre);
        if (k === 1) probe.addScaledVector(_lampMid.subVectors(lampA, centre).normalize(), radius * 0.7);
        const at =
          spotIrradiance(lampA, axis, probe, null, beams[o + 12], beams[o + 13], beams[o + 14], cutoff)
          + spotIrradiance(lampB, axis, probe, null, beams[o + 12], beams[o + 13], beams[o + 14], cutoff);
        if (at > light) light = at;
      }
      light *= 0.2126 * beams[o + 9] + 0.7152 * beams[o + 10] + 0.0722 * beams[o + 11];
      if (!(light > 0)) continue;
      total += light;
      if (light > bestLight) {
        bestLight = light;
        best = p;
      }
    }
    if (best < 0) return false;
    const o = best * BEAM_RECORD;
    const gain = Math.min(MAX_FOLDED_GAIN, total / bestLight);
    for (let k = 0; k < 3; k++) {
      out[k] = beams[o + k];
      out[4 + k] = beams[o + 3 + k];
      out[8 + k] = beams[o + 6 + k];
      out[12 + k] = beams[o + 9 + k] * gain;
    }
    out[3] = out[7] = out[11] = out[15] = 0;
    out[16] = beams[o + 12];
    out[17] = beams[o + 13];
    out[18] = beams[o + 14];
    out[19] = beams[o + 15];
    return true;
  }

  /** Shifts every vertex and lamp across a floating-origin step (see contactpatches.ts). */
  rebase(shift: RebaseShift): void {
    const data = this.data;
    for (let o = 0; o < data.length; o += STRIDE) {
      data[o] -= shift.dx;
      data[o + 2] -= shift.dz;
      data[o + 3] -= shift.dx;
      data[o + 5] -= shift.dz;
      data[o + 6] -= shift.dx;
      data[o + 8] -= shift.dz;
    }
    this.buffer.clearUpdateRanges();
    this.buffer.needsUpdate = true;
  }

  dispose(): void {
    this.unregisterOrigin();
    this.scene.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
  }
}

/**
 * Past the asphalt's edge this far, metres, the ground is the road's corridor: its slope
 * across is the verge's (the shader's `embankmentFall`), not the terrain's.
 */
const CORRIDOR_PAST_EDGE_M = 6;

/**
 * Whether two grid vertices at road laterals `a` and `b` lie on one ground a slope can
 * be taken across: both on the asphalt (within `halfWidth`), or both clear of the road's
 * corridor (`corridor` from the centreline) on one side. The verge between is the
 * embankment's, whose fall the shader draws finer than the grid (`embankmentFall`).
 */
function sameGround(a: number, b: number, halfWidth: number, corridor: number): boolean {
  const absA = Math.abs(a);
  const absB = Math.abs(b);
  if (absA < halfWidth) return absB < halfWidth;
  return absA >= corridor && absB >= corridor && a * b > 0;
}

/**
 * The ground's normal at each vertex of a pool grid (`POOL_GRID_STRIDE`, rows from the
 * lamps out), into `normals` (3 floats a vertex), from the neighbouring rows and columns
 * on the same ground (`sameGround`, the corridor `CORRIDOR_PAST_EDGE_M` past
 * `halfWidth`); level along an axis with none. Rows before `firstSampled` lie on the car's
 * own tyre plane and take its `up`. Each vertex's own neighbours, so the normal is
 * continuous across the grid and interpolates smoothly over a cell.
 */
export function poolGridNormals(
  grid: Float32Array,
  halfWidth: number,
  firstSampled: number,
  up: THREE.Vector3,
  normals: Float32Array,
): void {
  const corridor = halfWidth + CORRIDOR_PAST_EDGE_M;
  const stride = POOL_GRID_STRIDE;
  const rowStride = POOL_COLS * stride;
  for (let row = 0; row < POOL_ROWS; row++) {
    for (let column = 0; column < POOL_COLS; column++) {
      const n = (row * POOL_COLS + column) * 3;
      if (row < firstSampled) {
        normals[n] = up.x;
        normals[n + 1] = up.y;
        normals[n + 2] = up.z;
        continue;
      }
      const v = (row * POOL_COLS + column) * stride;
      const lateral = grid[v + 3];
      // Along the beam: the rows either side on the same ground.
      let near = v;
      let far = v;
      if (row > firstSampled && sameGround(lateral, grid[v - rowStride + 3], halfWidth, corridor)) near = v - rowStride;
      if (row < POOL_ROWS - 1 && sameGround(lateral, grid[v + rowStride + 3], halfWidth, corridor)) far = v + rowStride;
      let ax: number;
      let ay: number;
      let az: number;
      if (near !== far) {
        ax = grid[far] - grid[near];
        ay = grid[far + 1] - grid[near + 1];
        az = grid[far + 2] - grid[near + 2];
      } else {
        // No slope along: level, the way the rows run.
        const a = row > firstSampled ? v - rowStride : v;
        const b = row < POOL_ROWS - 1 ? v + rowStride : v;
        ax = grid[b] - grid[a];
        ay = 0;
        az = grid[b + 2] - grid[a + 2];
      }
      // Across it: the columns either side on the same ground.
      let left = v;
      let right = v;
      if (column > 0 && sameGround(lateral, grid[v - stride + 3], halfWidth, corridor)) left = v - stride;
      if (column < POOL_COLS - 1 && sameGround(lateral, grid[v + stride + 3], halfWidth, corridor)) right = v + stride;
      let bx: number;
      let by: number;
      let bz: number;
      if (left !== right) {
        bx = grid[right] - grid[left];
        by = grid[right + 1] - grid[left + 1];
        bz = grid[right + 2] - grid[left + 2];
      } else {
        // No slope across: level, square to the beam.
        bx = az;
        by = 0;
        bz = -ax;
      }
      // cross( b, a ), turned up.
      let nx = by * az - bz * ay;
      let ny = bz * ax - bx * az;
      let nz = bx * ay - by * ax;
      const length = Math.hypot(nx, ny, nz) * (ny < 0 ? -1 : 1);
      if (!(Math.abs(length) > 1e-9)) {
        nx = 0;
        ny = 1;
        nz = 0;
      } else {
        nx /= length;
        ny /= length;
        nz /= length;
      }
      normals[n] = nx;
      normals[n + 1] = ny;
      normals[n + 2] = nz;
    }
  }
}

const _toLamp = new THREE.Vector3();

/**
 * Light a spot puts on a surface at `point` with unit `normal` (null: facing the lamp),
 * per unit of its intensity: three's spot cone, distance falloff and incidence, as the
 * pool's shader and the slot itself compute them.
 */
export function spotIrradiance(
  lamp: THREE.Vector3,
  axis: THREE.Vector3,
  point: THREE.Vector3,
  normal: THREE.Vector3 | null,
  coneCos: number,
  penumbraCos: number,
  decay: number,
  cutoff: number,
): number {
  const toLamp = _toLamp.subVectors(lamp, point);
  const d = Math.max(toLamp.length(), 1e-4);
  toLamp.divideScalar(d);
  const t = Math.min(1, Math.max(0, (-toLamp.dot(axis) - coneCos) / (penumbraCos - coneCos)));
  const spot = t * t * (3 - 2 * t);
  if (!(spot > 0)) return 0;
  const r = (d / cutoff) ** 2;
  const window = Math.max(0, 1 - r * r);
  const incidence = normal === null ? 1 : Math.max(0, normal.dot(toLamp));
  return (spot * window * window * incidence) / Math.max(d ** decay, 0.01);
}

/**
 * Who should hold a spotlight slot: how much of a beam's light the player SEES.
 *
 * Slots went to the nearest cars. A car's distance says little about its light on
 * screen: an oncoming car's beam lies on the road in front of the camera, a car ahead
 * driving away lights road nobody looks at past it, and a car close BEHIND the player
 * lights the road round him and the inside of his cabin, which a distance order ranked
 * last of the three. A headlamp is therefore scored by its light on the ground in the
 * view, each sample of its footprint weighted by the share of the screen that ground
 * covers (`groundWeight`), plus its light on the player's own car, weighted by the share
 * of the screen the car covers (`carWeight`): from the cabin that is the whole screen.
 * The scores are in one unit, light times screen fraction, and are compared to each
 * other and to `main.ts`'s floor, below which a beam is left to its pool.
 */
export class LampView {
  readonly eye = new THREE.Vector3();
  private readonly frustum = new THREE.Frustum();
  private readonly viewProjection = new THREE.Matrix4();
  private readonly car = new THREE.Sphere();
  private hasCar = false;
  /** The view's solid angle, steradians. */
  private solidAngle = 1;

  /** Takes this frame's camera and the car the player sits in (null on foot). */
  update(camera: THREE.PerspectiveCamera, car: THREE.Object3D | null, carRadius: number): void {
    camera.updateMatrixWorld();
    this.viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.viewProjection, camera.coordinateSystem);
    this.eye.setFromMatrixPosition(camera.matrixWorld);
    const halfV = THREE.MathUtils.degToRad(camera.getEffectiveFOV()) / 2;
    const halfH = Math.atan(Math.tan(halfV) * camera.aspect);
    this.solidAngle = 4 * Math.asin(Math.sin(halfH) * Math.sin(halfV));
    this.hasCar = car !== null;
    if (car !== null) {
      this.car.center.setFromMatrixPosition(car.matrixWorld);
      this.car.radius = carRadius;
    }
  }

  /** Share of the screen a flat ground cell of `area` m2 at `point` covers; 0 off screen. */
  groundWeight(point: THREE.Vector3, area: number): number {
    if (!this.frustum.containsPoint(point)) return 0;
    const distanceSq = Math.max(1, point.distanceToSquared(this.eye));
    const distance = Math.sqrt(distanceSq);
    const facing = Math.max(0.05, (this.eye.y - point.y) / distance);
    return Math.min(1, (area * facing) / distanceSq / this.solidAngle);
  }

  /**
   * The player's car as a lit target: its centre (null on foot) and the share of the
   * screen it covers, all of it from the cabin.
   */
  carTarget(): THREE.Vector3 | null {
    return this.hasCar ? this.car.center : null;
  }

  carWeight(): number {
    if (!this.hasCar) return 0;
    const distanceSq = this.car.center.distanceToSquared(this.eye);
    const radius = this.car.radius;
    if (distanceSq <= radius * radius) return 1;
    if (!this.frustum.intersectsSphere(this.car)) return 0;
    return Math.min(1, (Math.PI * radius * radius) / distanceSq / this.solidAngle);
  }
}
