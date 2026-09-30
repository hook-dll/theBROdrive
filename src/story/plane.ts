/**
 * The light plane: a Cessna 172, built to its real dimensions and nothing more.
 *
 * THE NUMBERS ARE THE AEROPLANE'S. Length 8.28 m, span 11.00 m, height 2.72 m; the
 * wing a constant 1.63 m chord out to 2.55 m from the centreline and tapering to
 * 1.12 m at the tip along a swept leading edge, the trailing edge straight, 1°44′ of
 * dihedral, a NACA 2412 section; tailplane span 3.43 m; main gear track 2.53 m and
 * wheelbase 1.63 m; a 1.91 m two-blade propeller. What reads as "a Cessna" at twenty
 * metres is exactly those proportions: the long cowl, the boxy cabin under a wing laid
 * on its roof, the strut, the swept fin with its dorsal fillet, the tail cone rising
 * to the fin, the three spats.
 *
 * ONE SKIN, PAINTED, NO DECALS. The first build laid the cheat line, the panes and the
 * seams on the fuselage as plates a few millimetres proud of it, and on a faceted skin
 * they tore: a facet sags inside the smooth curve between its ring points and the
 * plate sank through in patches. Now the fuselage is ONE smooth loft (36 points round,
 * a few dozen stations along, interpolated through a table of real sections), and
 * everything that is paint or glass on the real aircraft is PAINTED by its material:
 * the livery shader reads the fragment's position and normal in the aeroplane's own
 * frame and draws the windscreen, the side and rear windows, the door and cowl seams,
 * the cheat line, the fin stripes, the flap and aileron hinge lines, the nose inlets
 * and the registration — crisp at any distance (edges are antialiased on their own
 * screen-space derivative) and never coplanar with anything. Glass is the same
 * surface with its roughness and metalness dropped, so it mirrors the sky.
 *
 * THE LOCAL FRAME (the story contract, shared with the site builder and the two
 * cutscenes): +Z is the nose, +Y is up, y = 0 is where the tyres touch, and the origin
 * is on the ground under the main gear. +X is the aeroplane's LEFT (the door side).
 *
 * MATERIALS ARE SHARED across instances for the session; `dispose()` frees this
 * instance's geometry alone.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { applyComicShading } from '../render/comic';

/** Tip to tip, metres, as the site's colliders and keep-outs size it. */
export const LIGHT_PLANE_SPAN = 11;
/** Spinner tip to rudder trailing edge, metres. */
export const LIGHT_PLANE_LENGTH = 8.28;
/** Ground to the top of the fin, metres. */
export const LIGHT_PLANE_HEIGHT = 2.72;

/** Propeller revolutions per second at `rpmFraction = 1`, for `spin`. */
const PROP_REV_PER_SECOND = 40;

/* ---- layout, metres, local frame ---- */

const NOSE_Z = 3.12; // spinner tip
const COWL_FRONT_Z = 2.9;
const FIREWALL_Z = 1.56;
const WING_LE_Z = 0.95;
const WING_TE_Z = -0.68;
const TAIL_Z = NOSE_Z - LIGHT_PLANE_LENGTH; // -5.16, rudder trailing edge
const CABIN_HALF_W = 0.57;
const WING_Y = 2.04; // chord line at the root
const WING_HALF_SPAN = LIGHT_PLANE_SPAN / 2;
const WING_TAPER_X = 2.55;
const WING_TIP_CHORD = 1.12;
const WING_DIHEDRAL = (1.73 * Math.PI) / 180;
const STAB_HALF_SPAN = 3.43 / 2;
const MAIN_TRACK_HALF = 2.53 / 2;
const MAIN_TYRE_R = 0.215;
const NOSE_WHEEL_Z = 1.63;
const NOSE_TYRE_R = 0.18;
const SPINNER_Y = 1.26;
const PROP_RADIUS = 1.91 / 2;

/* ---- the fuselage's sections, from real side and plan views ---- */

/**
 * z, half width, top, bottom, roundness of the upper and lower halves (superellipse
 * exponents: 2 is an ellipse, higher is boxier).
 */
const FUSELAGE_TABLE: readonly (readonly [number, number, number, number, number, number])[] = [
  [TAIL_Z + 0.04, 0.045, 1.66, 1.57, 2, 2],
  [-4.8, 0.1, 1.68, 1.52, 2.1, 2.1],
  [-4.0, 0.17, 1.71, 1.43, 2.2, 2.3],
  [-3.0, 0.27, 1.77, 1.27, 2.4, 2.6],
  [-2.0, 0.39, 1.86, 1.08, 2.7, 2.9],
  [-1.2, 0.5, 1.95, 0.9, 3.0, 3.2],
  [-0.7, 0.55, 2.0, 0.82, 3.3, 3.6],
  [-0.2, 0.57, 2.02, 0.78, 3.5, 3.8],
  [0.5, 0.57, 2.02, 0.78, 3.5, 3.8],
  [0.95, 0.565, 2.0, 0.79, 3.4, 3.8],
  // The windscreen: the roof falls to the cowl at the rake of the real screen.
  [1.25, 0.55, 1.84, 0.8, 3.2, 3.6],
  [FIREWALL_Z, 0.53, 1.69, 0.82, 3.0, 3.4],
  [2.0, 0.5, 1.63, 0.86, 2.8, 3.0],
  [2.45, 0.46, 1.58, 0.9, 2.6, 2.7],
  [2.75, 0.41, 1.54, 0.95, 2.4, 2.4],
  // The nose bowl, rounding in to the spinner's base.
  [2.85, 0.35, 1.5, 1.0, 2.2, 2.2],
  [COWL_FRONT_Z, 0.28, 1.46, 1.05, 2.1, 2.1],
];

function catmull(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

/** The section at z, Catmull-Rom through the table: a smooth silhouette, no kinks. */
function fuselageSection(z: number): readonly number[] {
  const rows = FUSELAGE_TABLE;
  let i = 0;
  while (i < rows.length - 2 && rows[i + 1]![0] < z) i++;
  const a = rows[Math.max(0, i - 1)]!;
  const b = rows[i]!;
  const c = rows[i + 1]!;
  const d = rows[Math.min(rows.length - 1, i + 2)]!;
  const t = Math.min(1, Math.max(0, (z - b[0]) / (c[0] - b[0])));
  const out: number[] = [];
  for (let k = 1; k < 6; k++) out.push(catmull(a[k]!, b[k]!, c[k]!, d[k]!, t));
  return out;
}

const RING = 36;

function sgnPow(v: number, p: number): number {
  return Math.sign(v) * Math.abs(v) ** p;
}

type V3 = [number, number, number];

function fuselageRing(z: number): V3[] {
  const [hw, top, bot, nTop, nBot] = fuselageSection(z) as [number, number, number, number, number];
  const cy = (top + bot) / 2;
  const hh = (top - bot) / 2;
  const ring: V3[] = [];
  for (let i = 0; i < RING; i++) {
    const a = (i / RING) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const n = s >= 0 ? nTop : nBot;
    ring.push([hw * sgnPow(c, 2 / n), cy + hh * sgnPow(s, 2 / n), z]);
  }
  return ring;
}

/* ---- geometry kit ---- */

/**
 * Rings of equal length swept into one indexed skin, optionally capped at either end
 * with its own (flat) fan. Normals come from the shared vertices, so the skin is smooth;
 * `closed` wraps each ring.
 */
function loft(rings: readonly V3[][], closed = true, capStart = false, capEnd = false): THREE.BufferGeometry {
  const m = rings[0]!.length;
  const positions: number[] = [];
  const index: number[] = [];
  for (const ring of rings) for (const p of ring) positions.push(p[0], p[1], p[2]);
  const span = closed ? m : m - 1;
  for (let r = 0; r + 1 < rings.length; r++) {
    for (let i = 0; i < span; i++) {
      const a = r * m + i;
      const b = r * m + ((i + 1) % m);
      const c = a + m;
      const d = b + m;
      index.push(a, b, d, a, d, c);
    }
  }
  const cap = (ring: V3[], flip: boolean): void => {
    const base = positions.length / 3;
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (const p of ring) {
      positions.push(p[0], p[1], p[2]);
      cx += p[0];
      cy += p[1];
      cz += p[2];
    }
    positions.push(cx / m, cy / m, cz / m);
    const centre = base + m;
    for (let i = 0; i < m; i++) {
      const a = base + i;
      const b = base + ((i + 1) % m);
      if (flip) index.push(centre, b, a);
      else index.push(centre, a, b);
    }
  };
  if (capStart) cap(rings[0]!, false);
  if (capEnd) cap(rings[rings.length - 1]!, true);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

/**
 * Flips the winding if the vertex at `probe` has a normal pointing away from `outward`,
 * so a loft never has to be written in the one ring order that happens to face out.
 */
function faceOutward(g: THREE.BufferGeometry, probe: number, outward: THREE.Vector3): THREE.BufferGeometry {
  const n = g.getAttribute('normal') as THREE.BufferAttribute;
  const probeNormal = new THREE.Vector3(n.getX(probe), n.getY(probe), n.getZ(probe));
  if (probeNormal.dot(outward) >= 0) return g;
  const index = g.getIndex()!;
  const arr = index.array as Uint16Array | Uint32Array;
  for (let i = 0; i < arr.length; i += 3) {
    const t = arr[i + 1]!;
    arr[i + 1] = arr[i + 2]!;
    arr[i + 2] = t;
  }
  index.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

/** The mirror image across the aeroplane's centre plane, wound to face out. */
function mirrorX(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const m = g.clone();
  m.scale(-1, 1, 1);
  const index = m.getIndex();
  if (index) {
    const arr = index.array as Uint16Array | Uint32Array;
    for (let i = 0; i < arr.length; i += 3) {
      const t = arr[i + 1]!;
      arr[i + 1] = arr[i + 2]!;
      arr[i + 2] = t;
    }
  }
  m.computeVertexNormals();
  return m;
}

/** A ring swept from `a` to `b`: `profile` gives points in (side, up) about the axis. */
function strut(a: V3, b: V3, profile: readonly [number, number][], upHint: V3, scaleB = 1): THREE.BufferGeometry {
  const A = new THREE.Vector3(...a);
  const B = new THREE.Vector3(...b);
  const d = B.clone().sub(A).normalize();
  const side = new THREE.Vector3().crossVectors(d, new THREE.Vector3(...upHint)).normalize();
  const up = new THREE.Vector3().crossVectors(side, d).normalize();
  const ring = (o: THREE.Vector3, k: number): V3[] =>
    profile.map(([s, u]) => {
      const p = o.clone().addScaledVector(side, s * k).addScaledVector(up, u * k);
      return [p.x, p.y, p.z];
    });
  const g = loft([ring(A, 1), ring(B, scaleB)], true, true, true);
  return faceOutward(g, 0, side.clone().multiplyScalar(profile[0]![0]).addScaledVector(up, profile[0]![1]));
}

function ellipseProfile(rs: number, ru: number, n = 10): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    out.push([Math.cos(a) * rs, Math.sin(a) * ru]);
  }
  return out;
}

/** A body of revolution about +Z from a (z, r) profile. */
function lathe(profile: readonly [number, number][], segments = 24): THREE.BufferGeometry {
  // LatheGeometry revolves (x, y) about +Y; rotating +Y onto +Z makes the axis the nose.
  const g = new THREE.LatheGeometry(profile.map(([z, r]) => new THREE.Vector2(Math.max(r, 1e-4), z)), segments);
  g.rotateX(Math.PI / 2);
  return g;
}

/* ---- airfoils ---- */

/** NACA 4-digit section, cosine-spaced: [chordwise 0..1, thickness-wise] from TE over the top to LE and back. */
function naca(camber: number, camberPos: number, thickness: number, n = 14): [number, number][] {
  const upper: [number, number][] = [];
  const lower: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const x = 0.5 * (1 - Math.cos((i / n) * Math.PI));
    const yt = 5 * thickness * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
    let yc = 0;
    let dy = 0;
    if (camber > 0) {
      if (x < camberPos) {
        yc = (camber / camberPos ** 2) * (2 * camberPos * x - x * x);
        dy = ((2 * camber) / camberPos ** 2) * (camberPos - x);
      } else {
        yc = (camber / (1 - camberPos) ** 2) * (1 - 2 * camberPos + 2 * camberPos * x - x * x);
        dy = ((2 * camber) / (1 - camberPos) ** 2) * (camberPos - x);
      }
    }
    const th = Math.atan(dy);
    upper.push([x - yt * Math.sin(th), yc + yt * Math.cos(th)]);
    lower.push([x + yt * Math.sin(th), yc - yt * Math.cos(th)]);
  }
  // TE (upper) -> LE -> TE (lower); the LE point is shared, the TE keeps a hair of thickness.
  const ring: [number, number][] = [];
  for (let i = n; i >= 0; i--) ring.push(upper[i]!);
  for (let i = 1; i <= n; i++) ring.push(lower[i]!);
  ring[0] = [1, ring[0]![1] + 0.002];
  ring[ring.length - 1] = [1, ring[ring.length - 1]![1] - 0.002];
  return ring;
}

const WING_FOIL = naca(0.02, 0.4, 0.12);
const TAIL_FOIL = naca(0, 0.4, 0.09);

/* ---- materials ---- */

function comic(material: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  return applyComicShading(material, { contourStrength: 0, stippleStrength: 0 });
}

type LiveryPart = 'FUSELAGE' | 'WING' | 'TAIL';

/** The registration, painted on the tail cone by the livery shader. */
let registrationTexture: THREE.CanvasTexture | null = null;
function planeRegistration(): THREE.CanvasTexture {
  if (registrationTexture) return registrationTexture;
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 160;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 142px "Arial Narrow", "Helvetica Neue", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('RA-67172', canvas.width / 2, canvas.height / 2 + 6);
  }
  registrationTexture = new THREE.CanvasTexture(canvas);
  registrationTexture.anisotropy = 8;
  return registrationTexture;
}

/** Livery colours, linear. */
const NAVY = new THREE.Color(0x1b3363);
const GOLD = new THREE.Color(0xd6a23a);
const GLASS = new THREE.Color(0x14222e);
const SEAM = new THREE.Color(0x8e9398);

const LIVERY_PARS = /* glsl */ `
varying vec3 vPlaneLocal;
varying vec3 vPlaneNormal;
uniform sampler2D uPlaneReg;
uniform vec3 uNavy;
uniform vec3 uGold;
uniform vec3 uGlass;
uniform vec3 uSeam;
float planeBox( vec2 p, vec2 c, vec2 h, float r ) {
  vec2 d = abs( p - c ) - h + r;
  return length( max( d, 0.0 ) ) + min( max( d.x, d.y ), 0.0 ) - r;
}
// 1 inside, antialiased on the field's own screen-space rate.
float planeFill( float sdf ) {
  float w = max( fwidth( sdf ), 1e-4 );
  return 1.0 - smoothstep( -w, w, sdf );
}
float planeLine( float sdf, float halfWidth ) {
  float w = max( fwidth( sdf ), 1e-4 );
  return 1.0 - smoothstep( halfWidth - w, halfWidth + w, abs( sdf ) );
}
vec3 planeLivery( vec3 p, vec3 n, out float glass ) {
  vec3 colour = vec3( 1.0 );
  glass = 0.0;
  float side = smoothstep( 0.45, 0.7, abs( n.x ) );
#if defined( PLANE_FUSELAGE )
  // Cheat line: navy over a gold pinstripe, level along the cabin and sweeping up the
  // tail cone towards the fin.
  float yc = p.z > -0.6 ? 1.2 : 1.2 + ( -0.6 - p.z ) * 0.085;
  float band = planeFill( abs( p.y - yc ) - 0.062 ) * step( p.z, 2.86 );
  float pin = planeFill( abs( p.y - ( yc - 0.098 ) ) - 0.013 ) * step( p.z, 2.8 );
  float stripeSide = smoothstep( 0.25, 0.45, abs( n.x ) );
  colour = mix( colour, uNavy, band * stripeSide );
  colour = mix( colour, uGold, pin * stripeSide );
  // Registration on the tail cone, read from nose to tail on the left (+X) and from
  // tail to nose on the right, the way a real one reads on each side.
  vec2 regUv = vec2( ( p.x > 0.0 ? ( -1.75 - p.z ) : ( p.z + 3.55 ) ) / 1.8, ( p.y - ( yc + 0.1 ) ) / 0.18 );
  if ( regUv.x > 0.0 && regUv.x < 1.0 && regUv.y > 0.0 && regUv.y < 1.0 ) {
    colour = mix( colour, uNavy, texture2D( uPlaneReg, regUv ).a * side );
  }
  // Side windows: the door's, raked at the front with the screen, and the rear quarter
  // pane, narrowing at the top with the roof's fall.
  float doorWin = planeBox( vec2( p.z - ( p.y - 1.69 ) * 0.42, p.y ), vec2( 0.5, 1.69 ), vec2( 0.37, 0.215 ), 0.07 );
  float rearWin = planeBox( vec2( p.z + ( p.y - 1.69 ) * 0.5, p.y ), vec2( -0.31, 1.69 ), vec2( 0.29, 0.2 ), 0.09 );
  float sideGlass = max( planeFill( doorWin ), planeFill( rearWin ) ) * side;
  // Windscreen: seen from above it is the sloped band between the cowl and the roof.
  float screen = planeFill( planeBox( vec2( p.x, p.z ), vec2( 0.0, 1.24 ), vec2( 0.5, 0.27 ), 0.14 ) )
    * smoothstep( 1.68, 1.72, p.y ) * smoothstep( 0.1, 0.3, n.y + n.z );
  // Rear window over the tail cone, behind the wing.
  float rear = planeFill( planeBox( vec2( p.x, p.z ), vec2( 0.0, -0.98 ), vec2( 0.34, 0.24 ), 0.1 ) )
    * smoothstep( 0.35, 0.55, n.y ) * step( 1.85, p.y );
  glass = max( max( sideGlass, screen ), rear );
  // Seams: the door around its window, and the cowl's joint at the firewall.
  float door = planeBox( vec2( p.z - ( p.y - 1.69 ) * 0.42, p.y ), vec2( 0.52, 1.4 ), vec2( 0.46, 0.56 ), 0.06 );
  float seams = planeLine( door, 0.005 ) * side * step( 1.0, p.y );
  seams = max( seams, planeLine( p.z - 1.57, 0.005 ) );
  seams = max( seams, planeLine( abs( p.x ) - 0.16, 0.004 ) * step( 1.9, p.z ) * step( 1.2, p.y ) * smoothstep( 0.6, 0.8, n.y ) );
  colour = mix( colour, uSeam, seams * 0.8 );
  // The nose bowl: two air inlets beside the spinner, and the dark throat under it.
  float inlets = planeFill( length( ( vec2( abs( p.x ), p.y ) - vec2( 0.19, 1.13 ) ) / vec2( 0.095, 0.055 ) ) - 1.0 );
  inlets = max( inlets, planeFill( length( ( vec2( p.x, p.y ) - vec2( 0.0, 1.08 ) ) / vec2( 0.11, 0.035 ) ) - 1.0 ) );
  colour = mix( colour, vec3( 0.04 ), inlets * smoothstep( 2.8, 2.86, p.z ) );
#elif defined( PLANE_WING )
  // Flap and aileron hinge lines, top and bottom, and the gaps at their ends.
  float ax = abs( p.x );
  float flap = planeLine( p.z - ( ${WING_TE_Z.toFixed(3)} + 0.36 ), 0.006 ) * step( 0.6, ax ) * step( ax, 2.9 );
  float aileron = planeLine( p.z - ( ${WING_TE_Z.toFixed(3)} + 0.3 ), 0.006 ) * step( 2.98, ax ) * step( ax, 5.05 );
  float ends = 0.0;
  ends = max( ends, planeLine( ax - 2.94, 0.006 ) );
  ends = max( ends, planeLine( ax - 5.05, 0.006 ) );
  ends = max( ends, planeLine( ax - 0.6, 0.006 ) );
  ends *= step( p.z, ${WING_TE_Z.toFixed(3)} + 0.36 ) * step( 0.6, ax );
  float surface = smoothstep( 0.3, 0.5, abs( n.y ) );
  colour = mix( colour, uSeam, max( max( flap, aileron ), ends ) * surface * 0.85 );
  // Fuel caps on top of each wing root.
  float cap = planeLine( length( vec2( ax - 1.05, p.z - 0.25 ) ) - 0.05, 0.007 ) * step( 0.0, n.y );
  colour = mix( colour, uSeam, cap );
  // A navy tip.
  colour = mix( colour, uNavy, planeFill( 5.22 - ax ) );
#elif defined( PLANE_TAIL )
  float ax = abs( p.x );
  // Elevator hinge across the tailplane, rudder hinge down the fin.
  float elevator = planeLine( p.z + 4.62, 0.006 ) * step( 0.12, ax ) * smoothstep( 0.3, 0.5, abs( n.y ) );
  float rudder = planeLine( p.z + 4.66 - ( p.y - 1.8 ) * 0.1, 0.006 ) * step( 1.78, p.y ) * side;
  colour = mix( colour, uSeam, max( elevator, rudder ) * 0.85 );
  // Fin stripes, raked with the leading edge.
  float s = p.y + ( p.z + 4.6 ) * 0.55;
  float finBand = planeFill( abs( s - 2.16 ) - 0.07 ) * step( 1.7, p.y );
  float finPin = planeFill( abs( s - 2.285 ) - 0.014 ) * step( 1.7, p.y );
  colour = mix( colour, uNavy, finBand * side );
  colour = mix( colour, uGold, finPin * side );
#endif
  colour = mix( colour, uGlass, glass );
  return colour;
}`;

const liveryMaterials = new Map<LiveryPart, THREE.MeshStandardMaterial>();

/** The white airframe, with the livery for one family of parts painted in. */
function liveryMaterial(part: LiveryPart): THREE.MeshStandardMaterial {
  const cached = liveryMaterials.get(part);
  if (cached) return cached;
  const material = comic(
    new THREE.MeshStandardMaterial({ name: `plane-${part.toLowerCase()}`, color: 0xf1f2ee, roughness: 0.5, metalness: 0.02 }),
  );
  const uniforms = {
    uPlaneReg: { value: planeRegistration() },
    uNavy: { value: NAVY },
    uGold: { value: GOLD },
    uGlass: { value: GLASS },
    uSeam: { value: SEAM },
  };
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vPlaneLocal;\nvarying vec3 vPlaneNormal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPlaneLocal = position;\nvPlaneNormal = normal;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n#define PLANE_${part}\n${LIVERY_PARS}`)
      .replace(
        '#include <color_fragment>',
        '#include <color_fragment>\nfloat planeGlass = 0.0;\ndiffuseColor.rgb *= planeLivery( vPlaneLocal, normalize( vPlaneNormal ), planeGlass );',
      )
      .replace(
        '#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\nroughnessFactor = mix( roughnessFactor, 0.07, planeGlass );',
      )
      .replace(
        '#include <metalnessmap_fragment>',
        '#include <metalnessmap_fragment>\nmetalnessFactor = mix( metalnessFactor, 0.4, planeGlass );',
      );
  };
  const previousKey = material.customProgramCacheKey;
  material.customProgramCacheKey = () => `${previousKey.call(material)}:plane-livery-v1-${part}`;
  liveryMaterials.set(part, material);
  return material;
}

const plainMaterials = new Map<string, THREE.MeshStandardMaterial>();
function plain(
  name: string,
  color: number,
  roughness: number,
  metalness: number,
  options: { emissive?: number; comic?: boolean } = {},
): THREE.MeshStandardMaterial {
  let m = plainMaterials.get(name);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ name: `plane-${name}`, color, roughness, metalness });
    if (options.emissive !== undefined) {
      m.emissive.setHex(options.emissive);
      m.emissiveIntensity = 0.6;
    }
    if (options.comic !== false) m = comic(m);
    plainMaterials.set(name, m);
  }
  return m;
}

/* ---- parts ---- */

function buildFuselage(): THREE.BufferGeometry {
  const rings: V3[][] = [];
  const stations = 56;
  for (let i = 0; i <= stations; i++) {
    // Denser at both ends, where the curvature is.
    const u = i / stations;
    const t = 0.5 - 0.5 * Math.cos(u * Math.PI);
    const z = TAIL_Z + 0.04 + (COWL_FRONT_Z - TAIL_Z - 0.04) * (0.35 * u + 0.65 * t);
    rings.push(fuselageRing(z));
  }
  const g = loft(rings, true, true, true);
  // Vertex 0 of a mid ring lies on +X.
  return faceOutward(g, 20 * RING, new THREE.Vector3(1, 0, 0));
}

/** Wing section ring at span station x (positive, the left wing). */
function wingRing(x: number): V3[] {
  const inboard = x <= WING_TAPER_X;
  const chord = inboard
    ? 1.63
    : 1.63 + ((WING_TIP_CHORD - 1.63) * (x - WING_TAPER_X)) / (WING_HALF_SPAN - WING_TAPER_X);
  const le = WING_TE_Z + chord;
  const y = WING_Y + Math.max(0, x - CABIN_HALF_W) * Math.tan(WING_DIHEDRAL);
  // 1.5 degrees of incidence at the root, washed out to zero at the tip.
  const incidence = ((1.5 - (1.5 * x) / WING_HALF_SPAN) * Math.PI) / 180;
  const ci = Math.cos(incidence);
  const si = Math.sin(incidence);
  return WING_FOIL.map(([u, v]) => {
    const along = u * chord;
    const up = v * chord;
    return [x, y + up * ci + along * si * 0.2, le - along * ci + up * si];
  });
}

function buildWing(): THREE.BufferGeometry {
  const xs = [0, 0.6, 1.4, WING_TAPER_X, 3.4, 4.3, 5.1, WING_HALF_SPAN - 0.12];
  const rings = xs.map(wingRing);
  // The tip: a shallow rounded cap, the section shrinking in thickness and chord.
  const tip = wingRing(WING_HALF_SPAN - 0.12);
  const cx = tip.reduce((s, p) => s + p[2], 0) / tip.length;
  const cy = tip.reduce((s, p) => s + p[1], 0) / tip.length;
  for (const [dx, k, kz] of [
    [0.07, 0.62, 0.96],
    [0.12, 0.2, 0.9],
  ] as const) {
    rings.push(tip.map((p) => [WING_HALF_SPAN - 0.12 + dx, cy + (p[1] - cy) * k, cx + (p[2] - cx) * kz]));
  }
  const g = loft(rings, true, true, true);
  const probe = 3 * WING_FOIL.length + Math.floor(WING_FOIL.length / 4);
  const left = faceOutward(g, probe, new THREE.Vector3(0, 1, 0));
  return mergeGeometries([left, mirrorX(left)])!;
}

function buildTailplane(): THREE.BufferGeometry {
  const ring = (x: number): V3[] => {
    const rootChord = 1.42;
    const chord = rootChord + ((0.95 - rootChord) * x) / STAB_HALF_SPAN;
    const te = -4.98;
    const le = te + chord;
    return TAIL_FOIL.map(([u, v]) => [x, 1.63 + v * chord, le - u * chord]);
  };
  const xs = [0, 0.6, 1.2, STAB_HALF_SPAN - 0.06];
  const rings = xs.map(ring);
  const tip = ring(STAB_HALF_SPAN - 0.06);
  const cz = tip.reduce((s, p) => s + p[2], 0) / tip.length;
  rings.push(tip.map((p) => [STAB_HALF_SPAN, 1.63 + (p[1] - 1.63) * 0.4, cz + (p[2] - cz) * 0.93]));
  const g = faceOutward(loft(rings, true, true, true), 2 * TAIL_FOIL.length + 4, new THREE.Vector3(0, 1, 0));
  return mergeGeometries([g, mirrorX(g)])!;
}

function buildFin(): THREE.BufferGeometry {
  // Sections in (z, x) at height y: LE swept back 38 degrees, TE nearly upright.
  const ring = (y: number): V3[] => {
    const t = (y - 1.6) / (LIGHT_PLANE_HEIGHT - 0.06 - 1.6);
    const te = TAIL_Z - 0.02 * t;
    const le = -3.5 - t * 0.95;
    const chord = le - te;
    return TAIL_FOIL.map(([u, v]) => [v * chord, y, le - u * chord]);
  };
  const ys = [1.6, 1.9, 2.2, 2.45, LIGHT_PLANE_HEIGHT - 0.06];
  const rings = ys.map(ring);
  const top = ring(LIGHT_PLANE_HEIGHT - 0.06);
  const cz = top.reduce((s, p) => s + p[2], 0) / top.length;
  rings.push(top.map((p) => [p[0] * 0.4, LIGHT_PLANE_HEIGHT - 0.01, cz + (p[2] - cz) * 0.92]));
  const g = loft(rings, true, true, true);
  const probe = 2 * TAIL_FOIL.length + Math.floor(TAIL_FOIL.length / 4);
  return faceOutward(g, probe, new THREE.Vector3(1, 0, 0));
}

/**
 * The dorsal fillet: a thin blade rising off the tail cone behind the rear window and
 * running up into the fin's leading edge, so the fin grows out of the fuselage the way
 * the real one does instead of standing on it.
 */
function finLeadingEdgeY(z: number): number {
  // Inverse of `buildFin`'s leading edge: le = -3.5 - t * 0.95 over the fin's height.
  const t = (-3.5 - z) / 0.95;
  return 1.6 + t * (LIGHT_PLANE_HEIGHT - 0.06 - 1.6);
}

function buildDorsal(): THREE.BufferGeometry {
  const rings: V3[][] = [];
  const start = -1.6;
  const end = -4.1;
  const n = 14;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const z = start + (end - start) * t;
    const top = fuselageSection(z)[1]!;
    // A concave rise: slow off the cone, then up to meet the fin's leading edge.
    const target = finLeadingEdgeY(end) + 0.04;
    const y = top + (target - top) * t ** 1.8;
    const hw = 0.02 + 0.03 * t;
    rings.push([
      [hw * 1.6, top - 0.05, z],
      [hw, (top + y) / 2, z],
      [hw * 0.45, y - 0.01, z],
      [0, y, z],
      [-hw * 0.45, y - 0.01, z],
      [-hw, (top + y) / 2, z],
      [-hw * 1.6, top - 0.05, z],
    ]);
  }
  return faceOutward(loft(rings, true, true, true), 7 * 7 + 1, new THREE.Vector3(1, 0, 0));
}

/** A speed fairing round a wheel: a teardrop, taller than wide, open at the bottom. */
function spat(length: number, radius: number): THREE.BufferGeometry {
  const profile: [number, number][] = [];
  const n = 14;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    // Blunt nose, long tail.
    const r = radius * Math.sin(Math.PI * Math.min(1, t ** 0.75)) ** 0.8;
    profile.push([length * (0.4 - t), r]);
  }
  // Tail first: the lathe faces outward when its profile runs towards +Z.
  const g = lathe(profile.reverse(), 20);
  g.scale(0.78, 1.45, 1);
  return g;
}

function tyre(radius: number, width: number): THREE.BufferGeometry {
  const g = new THREE.TorusGeometry(radius - width / 2, width / 2, 10, 24);
  g.rotateY(Math.PI / 2);
  return g;
}

function buildPropeller(): { blades: THREE.BufferGeometry; tips: THREE.BufferGeometry; spinner: THREE.BufferGeometry } {
  const bladeRing = (r: number): V3[] => {
    const t = (r - 0.1) / (PROP_RADIUS - 0.1);
    const chord = 0.1 + 0.07 * Math.sin(Math.PI * Math.min(1, t * 1.25)) - 0.04 * t;
    const thick = 0.03 * (1 - t) + 0.008;
    const pitch = ((38 - 26 * t) * Math.PI) / 180;
    const c = Math.cos(pitch);
    const s = Math.sin(pitch);
    return ellipseProfile(chord / 2, thick / 2, 10).map(([u, v]) => [u * c - v * s * 0.3, r, -u * s * 0.6 + v * c]);
  };
  const radii = (from: number, to: number, n: number): number[] =>
    Array.from({ length: n + 1 }, (_, i) => from + ((to - from) * i) / n);
  const one = (from: number, to: number, n: number, capEnd: boolean): THREE.BufferGeometry =>
    loft(radii(from, to, n).map(bladeRing), true, true, capEnd);
  const blade = one(0.1, PROP_RADIUS - 0.1, 8, false);
  const tip = one(PROP_RADIUS - 0.1, PROP_RADIUS, 2, true);
  const pair = (g: THREE.BufferGeometry): THREE.BufferGeometry => {
    const other = g.clone();
    other.rotateZ(Math.PI);
    return mergeGeometries([g, other])!;
  };
  // Back plate, rim, then the dome to its point.
  const spinnerProfile: [number, number][] = [[-0.02, 0], [-0.02, 0.2]];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    spinnerProfile.push([0.32 * t, 0.2 * Math.sqrt(Math.max(0, 1 - t ** 2.4))]);
  }
  const spinner = lathe(spinnerProfile, 24);
  return { blades: pair(blade), tips: pair(tip), spinner };
}

/* ---- assembly ---- */

/** Collision boxes, local frame: [min, max]. */
const COLLIDER_BOXES: readonly (readonly [readonly [number, number, number], readonly [number, number, number]])[] = [
  // Cabin and cowl.
  [[-CABIN_HALF_W, 0.78, -0.7], [CABIN_HALF_W, 2.05, COWL_FRONT_Z]],
  // Tail cone.
  [[-0.5, 0.9, TAIL_Z], [0.5, 2.0, -0.7]],
  // Wing.
  [[-WING_HALF_SPAN, 1.92, WING_TE_Z], [WING_HALF_SPAN, 2.35, WING_LE_Z]],
  // Tailplane.
  [[-STAB_HALF_SPAN, 1.55, -5.0], [STAB_HALF_SPAN, 1.72, -3.56]],
  // Fin.
  [[-0.08, 1.6, TAIL_Z], [0.08, LIGHT_PLANE_HEIGHT, -3.5]],
  // Main gear and spats.
  [[MAIN_TRACK_HALF - 0.15, 0, -0.45], [MAIN_TRACK_HALF + 0.15, 0.5, 0.4]],
  [[-MAIN_TRACK_HALF - 0.15, 0, -0.45], [-MAIN_TRACK_HALF + 0.15, 0.5, 0.4]],
  // Nose gear.
  [[-0.14, 0, NOSE_WHEEL_Z - 0.35], [0.14, 0.9, NOSE_WHEEL_Z + 0.3]],
];

export interface LightPlane {
  /** Root. Local frame: +Z nose, +Y up, tyres at y = 0, origin under the main gear. */
  readonly group: THREE.Group;
  /** Spins about its local Z; set `.rotation.z` or call `spin(dt, rpmFraction)`. */
  readonly propeller: THREE.Object3D;
  /** Collision boxes in the plane's LOCAL frame: [min, max] pairs. */
  readonly colliderBoxes: readonly (readonly [readonly [number, number, number], readonly [number, number, number]])[];
  /** Local point beside the cabin door (left side), feet height 0. */
  readonly doorPoint: readonly [number, number, number];
  spin(dt: number, rpmFraction: number): void;
  dispose(): void;
}

/** Strips everything but position and normal, un-indexes, so any parts merge. */
function prepared(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const out = g.index ? g.toNonIndexed() : g.clone();
  for (const name of Object.keys(out.attributes)) {
    if (name !== 'position' && name !== 'normal') out.deleteAttribute(name);
  }
  if (!out.getAttribute('normal')) out.computeVertexNormals();
  return out;
}

class PartBin {
  private readonly bins = new Map<THREE.Material, THREE.BufferGeometry[]>();
  add(material: THREE.Material, ...geometries: THREE.BufferGeometry[]): void {
    const list = this.bins.get(material) ?? [];
    for (const g of geometries) list.push(prepared(g));
    this.bins.set(material, list);
  }
  build(parent: THREE.Object3D, owned: THREE.BufferGeometry[]): void {
    for (const [material, list] of this.bins) {
      const merged = mergeGeometries(list)!;
      for (const g of list) g.dispose();
      merged.computeBoundingSphere();
      owned.push(merged);
      const mesh = new THREE.Mesh(merged, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      parent.add(mesh);
    }
  }
}

function buildAirframe(): { group: THREE.Group; propeller: THREE.Group; geometries: THREE.BufferGeometry[] } {
  const fuselageMat = liveryMaterial('FUSELAGE');
  const wingMat = liveryMaterial('WING');
  const tailMat = liveryMaterial('TAIL');
  const white = plain('white', 0xf1f2ee, 0.5, 0.02);
  const steel = plain('gear', 0x9ea3a8, 0.35, 0.7);
  const dark = plain('dark', 0x2c2f33, 0.6, 0.3);
  const rubber = plain('tyre', 0x1b1c1e, 0.92, 0);
  const blade = plain('blade', 0x2a2c30, 0.5, 0.2);
  const tipPaint = plain('blade-tip', 0xe7b43a, 0.5, 0);
  const spinnerMat = plain('spinner', 0xf1f2ee, 0.45, 0.05);
  const port = plain('nav-port', 0xd23a2a, 0.3, 0.1, { emissive: 0x801010, comic: false });
  const starboard = plain('nav-starboard', 0x2aa050, 0.3, 0.1, { emissive: 0x0a5020, comic: false });
  const clear = plain('nav-white', 0xf4f4f0, 0.3, 0.1, { emissive: 0x505050, comic: false });

  const bin = new PartBin();
  const geometries: THREE.BufferGeometry[] = [];

  bin.add(fuselageMat, buildFuselage(), buildDorsal());
  bin.add(wingMat, buildWing());
  bin.add(tailMat, buildTailplane(), buildFin());

  // --- wing struts: streamlined tubes from the cabin's floor to the wing's underside ---
  const strutProfile = ellipseProfile(0.022, 0.055, 12);
  for (const side of [1, -1] as const) {
    const root: V3 = [side * (CABIN_HALF_W - 0.03), 1.0, 0.1];
    const wingAt: V3 = [side * 2.95, WING_Y - 0.07 + (2.95 - CABIN_HALF_W) * Math.tan(WING_DIHEDRAL), 0.33];
    bin.add(white, strut(root, wingAt, strutProfile, [0, 0, 1]));
    // The fitting where it meets the wing, a short fairing.
    bin.add(white, strut([wingAt[0] - side * 0.14, wingAt[1] - 0.05, wingAt[2]], [wingAt[0] + side * 0.04, wingAt[1] + 0.02, wingAt[2]], ellipseProfile(0.035, 0.08, 10), [0, 0, 1], 0.7));
  }

  // --- main gear: spring-steel legs sweeping out and down into the spats ---
  for (const side of [1, -1] as const) {
    const axleX = side * MAIN_TRACK_HALF;
    const legTop: V3 = [side * 0.42, 0.84, -0.02];
    const legFoot: V3 = [axleX - side * 0.1, MAIN_TYRE_R + 0.06, -0.02];
    bin.add(steel, strut(legTop, legFoot, [[-0.018, -0.045], [0.018, -0.045], [0.018, 0.045], [-0.018, 0.045]], [0, 0, 1], 0.7));
    const t = tyre(MAIN_TYRE_R, 0.14);
    t.translate(axleX, MAIN_TYRE_R, 0);
    bin.add(rubber, t);
    const hub = new THREE.CylinderGeometry(0.08, 0.08, 0.15, 14).rotateZ(Math.PI / 2).translate(axleX, MAIN_TYRE_R, 0);
    bin.add(steel, hub);
    const pant = spat(0.9, 0.16);
    pant.translate(axleX, MAIN_TYRE_R + 0.07, 0.02);
    bin.add(white, pant);
    // A step on the left leg, where the pilot climbs up to the fuel caps.
    if (side === 1) bin.add(dark, new THREE.BoxGeometry(0.12, 0.015, 0.09).translate(side * 0.78, 0.6, 0.05));
  }

  // --- nose gear: oleo strut, torque links, fork, its own spat ---
  {
    const z = NOSE_WHEEL_Z;
    bin.add(dark, new THREE.CylinderGeometry(0.05, 0.05, 0.28, 14).translate(0, 0.86, z - 0.05));
    bin.add(steel, new THREE.CylinderGeometry(0.035, 0.035, 0.38, 14).translate(0, 0.55, z - 0.03));
    bin.add(dark, strut([0, 0.72, z + 0.02], [0, 0.56, z + 0.1], [[-0.015, -0.012], [0.015, -0.012], [0.015, 0.012], [-0.015, 0.012]], [1, 0, 0]));
    bin.add(dark, strut([0, 0.56, z + 0.1], [0, 0.42, z + 0.01], [[-0.015, -0.012], [0.015, -0.012], [0.015, 0.012], [-0.015, 0.012]], [1, 0, 0]));
    const t = tyre(NOSE_TYRE_R, 0.12);
    t.translate(0, NOSE_TYRE_R, z);
    bin.add(rubber, t);
    bin.add(steel, new THREE.CylinderGeometry(0.06, 0.06, 0.13, 12).rotateZ(Math.PI / 2).translate(0, NOSE_TYRE_R, z));
    const pant = spat(0.62, 0.13);
    pant.translate(0, NOSE_TYRE_R + 0.06, z + 0.02);
    bin.add(white, pant);
  }

  // --- small things that make it read as an aeroplane up close ---
  // Exhaust stub under the cowl, right side; the pitot under the left wing.
  bin.add(dark, new THREE.CylinderGeometry(0.028, 0.032, 0.16, 10).rotateX(0.5).translate(-0.2, 0.86, 2.45));
  bin.add(steel, new THREE.CylinderGeometry(0.008, 0.008, 0.36, 6).rotateX(Math.PI / 2).translate(3.2, WING_Y - 0.12 + 2.6 * Math.tan(WING_DIHEDRAL), 0.95));
  // Antennas on the roof and the tail cone.
  bin.add(dark, new THREE.BoxGeometry(0.012, 0.26, 0.09).translate(0, 2.13, -0.2));
  bin.add(dark, new THREE.BoxGeometry(0.012, 0.2, 0.08).translate(0, 1.88, -2.3));
  // Navigation lights: red on the left tip, green on the right, white on the tail; the
  // beacon on the fin's top.
  const tipY = WING_Y + (WING_HALF_SPAN - CABIN_HALF_W) * Math.tan(WING_DIHEDRAL);
  bin.add(port, new THREE.SphereGeometry(0.04, 10, 8).scale(1, 0.8, 1.6).translate(WING_HALF_SPAN + 0.02, tipY, WING_TE_Z + WING_TIP_CHORD - 0.12));
  bin.add(starboard, new THREE.SphereGeometry(0.04, 10, 8).scale(1, 0.8, 1.6).translate(-WING_HALF_SPAN - 0.02, tipY, WING_TE_Z + WING_TIP_CHORD - 0.12));
  bin.add(clear, new THREE.SphereGeometry(0.03, 8, 6).translate(0, 1.9, TAIL_Z - 0.02));
  bin.add(port, new THREE.CylinderGeometry(0.035, 0.04, 0.07, 10).translate(0, LIGHT_PLANE_HEIGHT - 0.0, -4.62));

  const group = new THREE.Group();
  group.name = 'light-plane';
  bin.build(group, geometries);

  // --- propeller: blades and tips turn with the spinner about +Z ---
  const hub = new THREE.Group();
  hub.name = 'light-plane-propeller';
  hub.position.set(0, SPINNER_Y, COWL_FRONT_Z + 0.03);
  const { blades, tips, spinner } = buildPropeller();
  blades.translate(0, 0, 0.1);
  tips.translate(0, 0, 0.1);
  const propBin = new PartBin();
  propBin.add(blade, blades);
  propBin.add(tipPaint, tips);
  propBin.add(spinnerMat, spinner);
  propBin.build(hub, geometries);
  group.add(hub);

  return { group, propeller: hub, geometries };
}

/** A fresh plane standing on its tyres at the local origin. */
export function createLightPlane(): LightPlane {
  const { group, propeller, geometries } = buildAirframe();
  return {
    group,
    propeller,
    colliderBoxes: COLLIDER_BOXES,
    doorPoint: [CABIN_HALF_W + 0.38, 0, 0.45],
    spin(dt: number, rpmFraction: number): void {
      if (dt <= 0 || rpmFraction <= 0) return;
      // Wrapped, so an hour of spinning never grows the angle into f32 mush.
      const angle = propeller.rotation.z + Math.PI * 2 * PROP_REV_PER_SECOND * rpmFraction * dt;
      propeller.rotation.z = angle % (Math.PI * 2);
    },
    dispose(): void {
      for (const geometry of geometries) geometry.dispose();
      group.clear();
    },
  };
}

/** Exported for the plane lab: the nose, so a camera can frame the whole aeroplane. */
export const LIGHT_PLANE_NOSE_Z = NOSE_Z;
