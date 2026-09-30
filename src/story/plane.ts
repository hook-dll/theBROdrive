/**
 * The light plane: a Cessna-172-shaped single-engine high-wing, lofted from
 * cross-sections and built at the size the story needs and nothing more.
 *
 * WHY PROCEDURAL. The parked plane is scenery and the take-off and landing
 * cutscenes fly two more of the same thing, so what matters is a recognisable
 * silhouette at 20 m and a cost near zero: thirteen merged meshes (nine of them the
 * parked aeroplane, four the propeller), under four thousand triangles, and no
 * download. The kit is the one the dwellings and the props are built from — boxes,
 * cylinders, scaled spheres — plus one LOFT that carries what a box cannot: the
 * fuselage's taper, the wing's section, the cowl's bowl and the spinner are rings of
 * a handful of points swept along a table of stations.
 *
 * THE LOCAL FRAME (fixed by the story contract, shared with the site builder):
 * +Z is the nose, +Y is up, and y = 0 is where the TYRES touch the ground. The
 * origin sits on the ground under the wing's centre, which is roughly the main
 * gear, so a plane placed at `y = runwaySurfaceY(...)` rests on the runway with
 * no correction and `doorPoint` is a standing position beside the cabin door.
 *
 * THE WINDOWS are the one window tint in the game (`TINTED_GLASS`, shared with
 * every car and house): an opaque black-blue sky mirror, never a see-through
 * pane, so nothing inside the cabin has to be modelled. Each pane is a patch laid
 * on the fuselage's own skin a few millimetres proud of it, so it follows the
 * cabin's curve instead of standing off the side as a slab.
 *
 * NOTHING SHARES A PLANE WITH ANYTHING ELSE, AND THE SKIN'S OWN FACETS NEVER EAT A
 * DECAL. Every detail that is traditionally a plate lying on the skin — the cheat
 * line, the door seams, the panes, the hinge lines — is either PAINTED onto the
 * surface it belongs to (a loft's `paint`) or floated a few millimetres along the
 * normal of the FACET it sits on. Measured from the smooth curve those facets
 * approximate, a decal of a few millimetres sinks into the skin between the ring
 * points and comes out in torn patches: a facet sags several millimetres inside it.
 * And every part that meets another — a gear leg into the belly and into its wheel
 * pant, a strut into the wing, the fin into the roof — starts INSIDE the part it
 * meets, numerically, so no leg hangs in the air beside the fuselage.
 *
 * MATERIALS ARE SHARED across every plane instance for the session (the
 * dwellings' idiom: `dwellingBodyMaterial`/`dwellingGlassMaterial`), because a
 * plane is pure and building the same swatches again per instance would only add
 * programs. `dispose()` therefore frees this instance's GEOMETRY alone.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { TINTED_GLASS } from '../render/materials';
import { applyComicShading } from '../render/comic';

/** Nominal span, metres: tip to tip, as the site's colliders and keep-outs size it. */
export const LIGHT_PLANE_SPAN = 11;
/** Nominal length, metres: spinner tip to rudder trailing edge. */
export const LIGHT_PLANE_LENGTH = 8.3;
/** Nominal height, metres: ground to the top of the fin, level attitude. */
export const LIGHT_PLANE_HEIGHT = 2.7;

/** Propeller revolutions per second at `rpmFraction = 1`, for `spin`. */
const PROP_REV_PER_SECOND = 40;

/* ---- layout: every number in the local frame, metres ---- */

/** Fuselage centreline height above the tyres, metres, at the wing. */
const AXIS_Y = 1.62;
/** The engine cowl's front face: the nose bowl, where the spinner's base sits behind it. */
const COWL_FRONT_Z = 3.02;
/** Cabin: the widest part of the fuselage, its roof and floor, and the door's own span. */
const CABIN_HALF_W = 0.575;
const CABIN_FRONT_Z = 1.72;
const CABIN_REAR_Z = -0.82;
const CABIN_FLOOR_Y = 1.07;
const CABIN_ROOF_Y = 2.18;
/** The tail cone's own end. */
const TAIL_END_Z = -4.22;
/** Wing: high, strut-braced, 1.75 m at the root, rising 2 degrees outboard. */
const WING_Y = 2.06;
const WING_ROOT_CHORD = 1.75;
const WING_CENTRE_Z = 0.65;
const WING_DIHEDRAL = 0.035;
/** Tail surfaces. */
const FIN_TOP_Y = LIGHT_PLANE_HEIGHT;
const STAB_Y = 1.985;
const STAB_HALF_SPAN = 1.65;
/** Tricycle gear: mains under the wing, nose wheel well forward of them. */
const MAIN_WHEEL_X = 1.12;
const MAIN_WHEEL_R = 0.3;
const NOSE_WHEEL_Z = 2.28;
const NOSE_WHEEL_R = 0.22;
/** Propeller disc, just ahead of the cowl's front face. */
const PROP_Z = 3.15;

/* ---- shared materials ---- */

function comic(material: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  return applyComicShading(material, { contourStrength: 0, stippleStrength: 0 });
}

let bodyMaterial: THREE.MeshStandardMaterial | null = null;
let trimMaterial: THREE.MeshStandardMaterial | null = null;
let darkMaterial: THREE.MeshStandardMaterial | null = null;
let chromeMaterial: THREE.MeshStandardMaterial | null = null;
let bladeMaterial: THREE.MeshStandardMaterial | null = null;
let tipMaterial: THREE.MeshStandardMaterial | null = null;
let rubberMaterial: THREE.MeshStandardMaterial | null = null;
let glassMaterial: THREE.MeshStandardMaterial | null = null;
let portLampMaterial: THREE.MeshStandardMaterial | null = null;
let starboardLampMaterial: THREE.MeshStandardMaterial | null = null;

/** The airframe's white: warm off-white, semi-matt, no metalness. */
function planeBodyMaterial(): THREE.MeshStandardMaterial {
  bodyMaterial ??= comic(new THREE.MeshStandardMaterial({ name: 'plane-body', color: 0xeef0ee, roughness: 0.42, metalness: 0.05 }));
  return bodyMaterial;
}
/** The cheat line and the trim: one deep blue, the classic high-wing livery. */
function planeTrimMaterial(): THREE.MeshStandardMaterial {
  trimMaterial ??= comic(new THREE.MeshStandardMaterial({ name: 'plane-trim', color: 0x1d3f74, roughness: 0.38, metalness: 0.05 }));
  return trimMaterial;
}
/** Structural dark: gear legs, cowl lips, exhausts, panel seams. */
function planeDarkMaterial(): THREE.MeshStandardMaterial {
  darkMaterial ??= comic(new THREE.MeshStandardMaterial({ name: 'plane-dark', color: 0x3a3d40, roughness: 0.62, metalness: 0.25 }));
  return darkMaterial;
}
/** Spinner and hub: bright metal, and the only mirror on the airframe. */
function planeChromeMaterial(): THREE.MeshStandardMaterial {
  chromeMaterial ??= new THREE.MeshStandardMaterial({ name: 'plane-chrome', color: 0xd9dce0, roughness: 0.18, metalness: 0.9, envMapIntensity: 1.2 });
  return chromeMaterial;
}
/** Propeller blades: matt dark grey, deliberately not shiny. */
function planeBladeMaterial(): THREE.MeshStandardMaterial {
  bladeMaterial ??= comic(new THREE.MeshStandardMaterial({ name: 'plane-blade', color: 0x25272b, roughness: 0.55, metalness: 0.15 }));
  return bladeMaterial;
}
/** Blade tips, painted so a turning prop reads as a disc. */
function planeTipMaterial(): THREE.MeshStandardMaterial {
  tipMaterial ??= comic(new THREE.MeshStandardMaterial({ name: 'plane-blade-tip', color: 0xe3b53a, roughness: 0.5, metalness: 0 }));
  return tipMaterial;
}
/** Tyres. */
function planeRubberMaterial(): THREE.MeshStandardMaterial {
  rubberMaterial ??= comic(new THREE.MeshStandardMaterial({ name: 'plane-tyre', color: 0x1b1c1e, roughness: 0.92, metalness: 0 }));
  return rubberMaterial;
}
/** Windscreen, side windows and the rear panes: the game's one window tint. */
function planeGlassMaterial(): THREE.MeshStandardMaterial {
  glassMaterial ??= new THREE.MeshStandardMaterial({ name: 'plane-glass', ...TINTED_GLASS });
  return glassMaterial;
}
/** Port navigation light: red, on the local +X flank, which is the aeroplane's left. */
function planePortLampMaterial(): THREE.MeshStandardMaterial {
  portLampMaterial ??= comic(new THREE.MeshStandardMaterial({ name: 'plane-nav-port', color: 0xc0392b, roughness: 0.24, metalness: 0.1 }));
  return portLampMaterial;
}
/** Starboard navigation light: green, on the local -X flank. */
function planeStarboardLampMaterial(): THREE.MeshStandardMaterial {
  starboardLampMaterial ??= comic(new THREE.MeshStandardMaterial({ name: 'plane-nav-starboard', color: 0x1f7a3d, roughness: 0.24, metalness: 0.1 }));
  return starboardLampMaterial;
}

/* ---- superellipse sections: the fuselage and the cowl ---- */

type Vec2 = readonly [number, number];
type Vec3 = readonly [number, number, number];

/** A cross-section: centre height, half width, half height, and how boxy it is. */
interface Section {
  readonly cy: number;
  readonly hw: number;
  readonly hh: number;
  readonly e: number;
}

/** `sign(value) * |value| ** power`: the superellipse's exponent rule. */
function sgnPow(value: number, power: number): number {
  return Math.sign(value) * Math.abs(value) ** power;
}

/** `a` to `b`, linearly. */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * The outward unit normal of `section` at ring angle `t`: the gradient of the
 * superellipse `|x/hw|^e + |y/hh|^e = 1`. It is what puts a decal's points a few
 * millimetres OFF the skin rather than exactly on it, where they would fight it.
 */
function skinNormal(section: Section, t: number): Vec2 {
  const x = sgnPow(Math.cos(t), (2 * (section.e - 1)) / section.e) / section.hw;
  const y = sgnPow(Math.sin(t), (2 * (section.e - 1)) / section.e) / section.hh;
  const length = Math.hypot(x, y) || 1;
  return [x / length, y / length];
}

/** The skin's point at ring angle `t` (0 = the +X flank, π/2 = the crown), `out` metres along the normal. */
function skinPoint(section: Section, t: number, out = 0): Vec2 {
  const x = section.hw * sgnPow(Math.cos(t), 2 / section.e);
  const y = section.cy + section.hh * sgnPow(Math.sin(t), 2 / section.e);
  if (out === 0) return [x, y];
  const normal = skinNormal(section, t);
  return [x + normal[0] * out, y + normal[1] * out];
}

/** The ring angle at height `y`, on `side` (+1 = the local +X flank, -1 = the other one). */
function skinAngle(section: Section, y: number, side: number): number {
  const fraction = Math.max(-1, Math.min(1, (y - section.cy) / section.hh));
  const t = Math.asin(Math.max(-1, Math.min(1, sgnPow(fraction, section.e / 2))));
  return side >= 0 ? t : Math.PI - t;
}

/**
 * The fuselage's stations, tail first: `[z, centre y, half width, half height,
 * squareness]`. The squareness rises through the cabin — a 172's greenhouse is a
 * rounded rectangle — and falls away into the tail cone and the cowl, which are
 * nearer round.
 */
const FUSELAGE: readonly (readonly [number, number, number, number, number])[] = [
  [TAIL_END_Z, 1.865, 0.075, 0.085, 2.6],
  [-3.9, 1.828, 0.132, 0.146, 2.6],
  [-3.4, 1.775, 0.205, 0.222, 2.7],
  [-2.7, 1.705, 0.3, 0.312, 2.8],
  [-2.0, 1.668, 0.385, 0.392, 3.0],
  [-1.3, 1.65, 0.462, 0.462, 3.2],
  [-0.7, 1.638, 0.52, 0.508, 3.5],
  [0.0, 1.628, 0.56, 0.54, 3.6],
  [0.6, 1.624, 0.575, 0.552, 3.6],
  [1.2, 1.622, 0.566, 0.556, 3.6],
  [CABIN_FRONT_Z, 1.62, 0.505, 0.548, 3.4],
  [2.2, 1.615, 0.46, 0.47, 3.1],
  [2.65, 1.612, 0.395, 0.4, 2.9],
  [COWL_FRONT_Z, 1.61, 0.315, 0.325, 2.8],
];

/** How many points go round the fuselage: twenty quads a bay, smooth under a flat light. */
const FUSELAGE_SEGMENTS = 20;

/** The fuselage's cross-section at `z`, between stations and clamped at the ends. */
function fuselageSection(z: number): Section {
  const last = FUSELAGE.length - 1;
  const first = FUSELAGE[0]!;
  if (z <= first[0]) return { cy: first[1], hw: first[2], hh: first[3], e: first[4] };
  for (let i = 1; i <= last; i++) {
    const b = FUSELAGE[i]!;
    if (z > b[0]) continue;
    const a = FUSELAGE[i - 1]!;
    const t = (z - a[0]) / (b[0] - a[0]);
    return { cy: lerp(a[1], b[1], t), hw: lerp(a[2], b[2], t), hh: lerp(a[3], b[3], t), e: lerp(a[4], b[4], t) };
  }
  const end = FUSELAGE[last]!;
  return { cy: end[1], hw: end[2], hh: end[3], e: end[4] };
}

/** The fuselage's ring at `z`: `n` points counter-clockwise in `(x, y)`. */
function fuselageRing(z: number, n: number): Vec2[] {
  const section = fuselageSection(z);
  const ring: Vec2[] = [];
  for (let i = 0; i < n; i++) ring.push(skinPoint(section, (i * Math.PI * 2) / n));
  return ring;
}

/**
 * The same point ON THE DRAWN SKIN. The fuselage is a loft of flat facets, and a facet
 * sags up to seven millimetres inside the superellipse its ring points are taken from, so
 * a decal placed on the analytic surface sinks into the fuselage between the ring points
 * and comes out in torn patches — the skin's own chords eat it. Snapping the angle into
 * the facet it falls in keeps the whole offset, so a cheat line reads as a line and a pane
 * reads as one pane the length of the cabin.
 */
function skinFacetPoint(section: Section, t: number, out = 0): Vec2 {
  const step = (Math.PI * 2) / FUSELAGE_SEGMENTS;
  const wrapped = ((t % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  const index = Math.floor(wrapped / step) % FUSELAGE_SEGMENTS;
  const from = skinPoint(section, index * step);
  const to = skinPoint(section, (index + 1) * step);
  const chordX = to[0] - from[0];
  const chordY = to[1] - from[1];
  const length = Math.hypot(chordX, chordY) || 1;
  const along = (wrapped - index * step) / step;
  // The ring runs counter-clockwise, so the chord turned a quarter turn clockwise points
  // out of the fuselage.
  return [from[0] + chordX * along + (chordY / length) * out, from[1] + chordY * along - (chordX / length) * out];
}

/* ---- the wing's section: a plate with a round nose and a sharp trailing edge ---- */

/** A wing section: centre height, half chord, half thickness, and its mid-chord station. */
interface WingSection {
  readonly cy: number;
  readonly halfChord: number;
  readonly halfT: number;
  readonly zMid: number;
}

/**
 * Wing stations, root first: `[x, half chord, half thickness, mid-chord z]`. The centre
 * height is `WING_Y + tan(2°) * x`, so the dihedral is one number rather than eight, and
 * the last four stations cut the chord away so the tip rounds off instead of ending
 * square.
 */
const WING: readonly (readonly [number, number, number, number])[] = [
  [0.0, WING_ROOT_CHORD / 2, 0.135, WING_CENTRE_Z],
  [1.6, 0.82, 0.128, 0.63],
  [3.2, 0.752, 0.112, 0.6],
  [4.4, 0.7, 0.1, 0.575],
  [5.0, 0.64, 0.09, 0.56],
  [5.3, 0.5, 0.078, 0.545],
  [5.46, 0.3, 0.058, 0.53],
  [5.5, 0.12, 0.03, 0.52],
];

/**
 * The wing's profile in `(u, v)` fractions: `u` along the chord (+1 = the leading
 * edge) and `v` through the thickness (+1 = up). Read from the leading edge under the
 * section, aft along the bottom, round the trailing edge and forward over the top —
 * which is what puts the `(y, z)` ring the loft wants the counter-clockwise way round.
 * The two close pairs near `u = -0.46` are the flap and aileron hinge line: one quad
 * wide, painted dark, on the surface itself.
 */
const WING_PROFILE: readonly Vec2[] = [
  [1.0, 0.0],
  [0.85, -0.72],
  [0.45, -0.98],
  [-0.1, -1.0],
  [-0.44, -0.975],
  [-0.48, -0.972],
  [-0.65, -0.92],
  [-1.0, -0.35],
  [-1.0, 0.35],
  [-0.65, 0.92],
  [-0.48, 0.972],
  [-0.44, 0.975],
  [-0.1, 1.0],
  [0.45, 0.98],
  [0.85, 0.72],
];

/** The wing profile's quads that carry the hinge line: the bottom one and the top one. */
const WING_HINGE_BOTTOM = 4;
const WING_HINGE_TOP = 10;

/** The wing's section at `x`, between stations and clamped at the ends. */
function wingSection(x: number): WingSection {
  const distance = Math.abs(x);
  const last = WING.length - 1;
  let station = last;
  for (let i = 0; i < last; i++) {
    if (distance <= WING[i + 1]![0]!) {
      station = i;
      break;
    }
  }
  const a = WING[station]!;
  const b = WING[Math.min(station + 1, last)]!;
  const span = b[0] - a[0];
  const t = span > 1e-9 ? Math.max(0, Math.min(1, (distance - a[0]) / span)) : 0;
  return {
    cy: WING_Y + WING_DIHEDRAL * distance,
    halfChord: lerp(a[1], b[1], t),
    halfT: lerp(a[2], b[2], t),
    zMid: lerp(a[3], b[3], t),
  };
}

/** A profile point of `section`, in the loft's `(y, z)` plane. */
function wingPoint(section: WingSection, index: number): Vec2 {
  const [u, v] = WING_PROFILE[index]!;
  return [section.cy + v * section.halfT, section.zMid + u * section.halfChord];
}

/** The wing section's outward normals, one per profile point. */
function wingNormals(section: WingSection): Vec2[] {
  const n = WING_PROFILE.length;
  const normals: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const previous = wingPoint(section, (i - 1 + n) % n);
    const here = wingPoint(section, i);
    const next = wingPoint(section, (i + 1) % n);
    // Counter-clockwise in (y, z): an edge turned a quarter turn to the right points out.
    const beforeX = here[1] - previous[1];
    const beforeY = previous[0] - here[0];
    const afterX = next[1] - here[1];
    const afterY = here[0] - next[0];
    const before = Math.hypot(beforeX, beforeY) || 1;
    const after = Math.hypot(afterX, afterY) || 1;
    const x = beforeX / before + afterX / after;
    const y = beforeY / before + afterY / after;
    const length = Math.hypot(x, y) || 1;
    normals.push([x / length, y / length]);
  }
  return normals;
}

/** The wing's ring: the whole profile, in the loft's `(y, z)` plane. */
function wingRing(section: WingSection): Vec2[] {
  return WING_PROFILE.map((_point, index) => wingPoint(section, index));
}

/** A run of profile points pushed `out` along their own normals: one shell of a stripe. */
function wingBand(section: WingSection, indices: readonly number[], out: number): Vec2[] {
  const normals = wingNormals(section);
  const band: Vec2[] = [];
  for (const index of indices) {
    const [y, z] = wingPoint(section, index);
    const [ny, nz] = normals[index]!;
    band.push([y + ny * out, z + nz * out]);
  }
  return band;
}

/** The leading edge's arc, from the upper shoulder round the nose to the lower one. */
const WING_NOSE = [13, 14, 0, 1, 2] as const;

/* ---- the tail surfaces ---- */

/**
 * Fin, rudder and dorsal fillet as one plate, `[z, bottom y, top y, half thickness,
 * band]`. The band is how far up the side the cheat line runs: it is painted onto the
 * plate itself, so the livery's sweep up the fin is part of the surface rather than a
 * strip lying on it. Every station's bottom edge is inside the tail cone, an inch or
 * two under its skin, and every band stays inside its own section — a band taller than
 * the station it is painted on folds the ring over itself.
 */
const FIN: readonly (readonly [number, number, number, number, number])[] = [
  [-4.55, 2.1, 2.34, 0.028, 0.08],
  [-4.34, 1.98, 2.52, 0.031, 0.18],
  [-4.1, 1.86, 2.66, 0.034, 0.24],
  [-3.8, 1.79, 2.7, 0.036, 0.26],
  [-3.4, 1.8, 2.7, 0.038, 0.26],
  // The fin's top-front corner: from here forward the leading edge is the dorsal fillet,
  // a long low ramp over the roof, and from here aft the fin's top runs level to the
  // rudder. A leading edge that climbs gently the whole way reads as a sail, not a fin.
  [-3.05, 1.82, 2.7, 0.04, 0.24],
  [-2.6, 1.88, 2.26, 0.042, 0.16],
  [-2.2, 1.94, 2.22, 0.044, 0.1],
  [-1.7, 2.0, 2.16, 0.045, 0.06],
  [-1.2, 2.05, 2.14, 0.045, 0.04],
];

/** Where the fin's trailing edge gives way to the rudder, and the tailplane's rear spar. */
const RUDDER_HINGE_Z = -3.98;
const ELEVATOR_HINGE_Z = -4.16;

/**
 * Tailplane, elevator and their hinge line as one plate, `[x, centre y, half thickness,
 * leading edge z, trailing edge z]`. The root is buried in the tail cone and the plate
 * passes through the fin's own base.
 */
const STAB: readonly (readonly [number, number, number, number, number])[] = [
  [0.0, STAB_Y, 0.052, -3.12, -4.38],
  [0.7, STAB_Y, 0.048, -3.22, -4.38],
  [1.3, 1.99, 0.042, -3.34, -4.34],
  [STAB_HALF_SPAN, 1.995, 0.036, -3.44, -4.28],
];

/** Propeller blade sections, `[half thickness, half chord, pitch]`, root to tip. */
const BLADE: readonly (readonly [number, number, number])[] = [
  [0.026, 0.055, 0.58],
  [0.022, 0.078, 0.45],
  [0.016, 0.072, 0.33],
  [0.012, 0.056, 0.26],
];

/* ---- the primitive builder ---- */

const ZERO: Vec3 = [0, 0, 0];
const ONE: Vec3 = [1, 1, 1];
/** Cylinders are built along +Y; this Euler re-points that axis along +Z. */
const AXIS_Z: Vec3 = [Math.PI / 2, 0, 0];
/** ...and along +X. */
const AXIS_X: Vec3 = [0, 0, -Math.PI / 2];

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _ref = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _t1 = new THREE.Vector3();
const _t2 = new THREE.Vector3();
const _n = new THREE.Vector3();

/** One cross-section of a loft: where along the axis it sits, and its ring. */
interface Station {
  readonly at: number;
  readonly ring: readonly Vec2[];
}

/** Which material one quad of a loft takes; `undefined` leaves the loft's own material. */
type Paint = (station: number, segment: number) => THREE.Material | undefined;

/** A ring turned the counter-clockwise way round in the plane the loft does not advance along. */
function orientRing(ring: readonly Vec2[]): Vec2[] {
  const points = [...ring];
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const q = points[(i + 1) % points.length]!;
    area += p[0] * q[1] - q[0] * p[1];
  }
  return area < 0 ? points.reverse() : points;
}

/** A station list given nose-in is turned around, so the quads wind the same either way. */
function orderStations(stations: readonly Station[]): readonly Station[] {
  const points = [...stations];
  return points[points.length - 1]!.at < points[0]!.at ? points.reverse() : points;
}

/** A rectangle, counter-clockwise in the `(a, b)` plane: a plate's or a strap's section. */
function rectRing(halfA: number, centreB: number, halfB: number): Vec2[] {
  return [
    [-halfA, centreB - halfB],
    [halfA, centreB - halfB],
    [halfA, centreB + halfB],
    [-halfA, centreB + halfB],
  ];
}

/** A blade's section in `(y, z)`: a rectangle turned by its pitch. */
function bladeRing(halfT: number, halfChord: number, pitch: number): Vec2[] {
  const cos = Math.cos(pitch);
  const sin = Math.sin(pitch);
  const ring: Vec2[] = [];
  for (const [a, b] of rectRing(halfT, 0, halfChord)) ring.push([a * cos - b * sin, a * sin + b * cos]);
  return ring;
}

/** A round ring of `n` points about `(cx, cy)`: a wheel pant's section. */
function circleRing(cx: number, cy: number, rx: number, ry: number, n: number): Vec2[] {
  const ring: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i * Math.PI * 2) / n;
    ring.push([cx + Math.cos(t) * rx, cy + Math.sin(t) * ry]);
  }
  return ring;
}

/**
 * Accumulates primitives and merges them one mesh per material. The geometries are
 * freshly created here and never shared, so transforming them in place is safe;
 * nothing is retained after `build()`.
 */
class Airframe {
  private readonly geometry: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];

  box(size: Vec3, material: THREE.Material, position: Vec3, rotation: Vec3 = ZERO, scale: Vec3 = ONE): void {
    this.add(new THREE.BoxGeometry(size[0], size[1], size[2]), material, position, rotation, scale);
  }

  cylinder(
    radiusTop: number,
    radiusBottom: number,
    height: number,
    segments: number,
    material: THREE.Material,
    position: Vec3,
    rotation: Vec3 = ZERO,
    scale: Vec3 = ONE,
    openEnded = false,
  ): void {
    this.add(
      new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments, 1, openEnded),
      material,
      position,
      rotation,
      scale,
    );
  }

  sphere(radius: number, widthSegments: number, heightSegments: number, material: THREE.Material, position: Vec3, scale: Vec3 = ONE): void {
    this.add(new THREE.SphereGeometry(radius, widthSegments, heightSegments), material, position, ZERO, scale);
  }

  /** A round tube spanning two local points; `radiusFrom` is the end at `from`, metres. */
  strut(from: Vec3, to: Vec3, radiusFrom: number, radiusTo: number, material: THREE.Material, segments = 8): void {
    _a.set(from[0], from[1], from[2]);
    _b.set(to[0], to[1], to[2]);
    _dir.subVectors(_b, _a);
    const length = _dir.length();
    if (length < 1e-6) return;
    _dir.divideScalar(length);
    _q.setFromUnitVectors(_up, _dir);
    _e.setFromQuaternion(_q);
    this.add(
      new THREE.CylinderGeometry(radiusTo, radiusFrom, length, segments, 1, false),
      material,
      [(_a.x + _b.x) / 2, (_a.y + _b.y) / 2, (_a.z + _b.z) / 2],
      [_e.x, _e.y, _e.z],
      ONE,
    );
  }

  /**
   * A closed lofted solid: `stations` are cross-sections along the axis, all rings with
   * the same number of points, each counter-clockwise in `(x, y)` for a `z` loft or in
   * `(y, z)` for an `x` loft — the loft turns a ring round if it is not that way, and
   * reads a nose-in station list backwards. Both ends are capped, and `paint` overrides
   * the material of a single quad, which is how the fin's livery and the wing's hinge
   * line are laid on the surfaces they belong to.
   */
  loft(axis: 'x' | 'z', stations: readonly Station[], material: THREE.Material, paint?: Paint): void {
    this.loftPart(axis, stations, material, paint);
  }

  /**
   * The same loft in a frame of its own: the axis runs from `from` to `to`, and `refX`
   * — take its part across the axis — becomes the ring's own `x`, so a strap's thin
   * direction and a fairing's chord can be pointed in the aeroplane rather than
   * wherever the rotation happens to leave them. The gear legs and the wing struts.
   */
  aimed(from: Vec3, to: Vec3, refX: Vec3, stations: readonly Station[], material: THREE.Material): void {
    _a.set(from[0], from[1], from[2]);
    _b.set(to[0], to[1], to[2]);
    _dir.subVectors(_b, _a);
    const length = _dir.length();
    if (length < 1e-6) return;
    _dir.divideScalar(length);
    _ref.set(refX[0], refX[1], refX[2]);
    _ref.addScaledVector(_dir, -_ref.dot(_dir));
    if (_ref.lengthSq() < 1e-8) _ref.set(0, 1, 0).addScaledVector(_dir, -_dir.y);
    _ref.normalize();
    _s.crossVectors(_dir, _ref);
    _m.makeBasis(_ref, _s, _dir);
    _m.setPosition(_a);
    this.loftPart('z', stations, material, undefined, _m);
  }

  /**
   * A patch — glass, paint or dark trim — laid on the fuselage's own skin: `corners` are
   * `[z, y, side]` triples in the order they come round the patch. A patch that stays on
   * one flank is banded by HEIGHT, so the cheat line's edges are straight lines in a side
   * view whatever the fuselage is doing underneath them; the windscreen wraps the crown,
   * where one height is two points on the ring, so that one is banded by ring angle
   * instead. Every point is then snapped to the drawn skin and lifted `out` metres along
   * its facet's normal, so a pane sits the same few millimetres out along its whole
   * length. The normals are the grid's own tangents and the winding is settled against
   * them, so the caller's corners only have to come round the patch.
   */
  skinPatch(corners: readonly (readonly [number, number, number])[], out: number, material: THREE.Material): void {
    if (corners.length < 4) return;
    const cornerZ: number[] = [];
    const cornerY: number[] = [];
    const cornerT: number[] = [];
    const cornerSide: number[] = [];
    for (const corner of corners) {
      const side = corner[2] >= 0 ? 1 : -1;
      cornerZ.push(corner[0]);
      cornerY.push(corner[1]);
      cornerT.push(skinAngle(fuselageSection(corner[0]), corner[1], side));
      cornerSide.push(side);
    }
    const banded = cornerSide.every((side) => side === cornerSide[0]);
    const at = (index: number): [number, number, number] => {
      const point = skinFacetPoint(fuselageSection(cornerZ[index]!), cornerT[index]!);
      return [point[0], point[1], cornerZ[index]!];
    };
    const corner = [at(0), at(1), at(2), at(3)];
    const span = (a: readonly number[], b: readonly number[]): number => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
    // One quad per 150 mm of surface. The fuselage's stations are half a metre apart and
    // the flank bulges between them, so a coarser patch chords across the bulge and sinks
    // under the skin it is supposed to lie on — which is what turns a cheat line into a
    // row of blobs.
    const across = Math.max(2, Math.min(24, Math.ceil(Math.max(span(corner[0]!, corner[1]!), span(corner[3]!, corner[2]!)) / 0.15)));
    const along = Math.max(2, Math.min(48, Math.ceil(Math.max(span(corner[0]!, corner[3]!), span(corner[1]!, corner[2]!)) / 0.15)));
    const mixed = (u: number, v: number, values: readonly number[]): number =>
      values[0]! * (1 - u) * (1 - v) + values[1]! * u * (1 - v) + values[2]! * u * v + values[3]! * (1 - u) * v;

    const position: number[] = [];
    const uv: number[] = [];
    const grid: number[][] = [];
    for (let v = 0; v <= along; v++) {
      const row: number[] = [];
      for (let u = 0; u <= across; u++) {
        const z = mixed(u / across, v / along, cornerZ);
        const section = fuselageSection(z);
        const t = banded ? skinAngle(section, mixed(u / across, v / along, cornerY), cornerSide[0]!) : mixed(u / across, v / along, cornerT);
        const point = skinFacetPoint(section, t, out);
        row.push(position.length / 3);
        position.push(point[0], point[1], z);
        uv.push(u / across, v / along);
      }
      grid.push(row);
    }

    // Normals from the grid's own tangents, which carry the taper the ring's normal
    // alone would miss, then one sign taken from the skin's own outward normal at the
    // first corner: that is also the way the quads wind.
    const normal: number[] = [];
    for (let v = 0; v <= along; v++) {
      for (let u = 0; u <= across; u++) {
        const before = grid[v]![Math.max(0, u - 1)]!;
        const after = grid[v]![Math.min(across, u + 1)]!;
        const down = grid[Math.max(0, v - 1)]![u]!;
        const up = grid[Math.min(along, v + 1)]![u]!;
        _t1.set(
          position[after * 3]! - position[before * 3]!,
          position[after * 3 + 1]! - position[before * 3 + 1]!,
          position[after * 3 + 2]! - position[before * 3 + 2]!,
        );
        _t2.set(
          position[up * 3]! - position[down * 3]!,
          position[up * 3 + 1]! - position[down * 3 + 1]!,
          position[up * 3 + 2]! - position[down * 3 + 2]!,
        );
        _n.crossVectors(_t1, _t2).normalize();
        normal.push(_n.x, _n.y, _n.z);
      }
    }
    const lean = skinNormal(fuselageSection(cornerZ[0]!), cornerT[0]!);
    const sign = normal[0]! * lean[0] + normal[1]! * lean[1] >= 0 ? 1 : -1;
    if (sign < 0) {
      for (let i = 0; i < normal.length; i++) normal[i] = -normal[i]!;
    }

    const index: number[] = [];
    for (let v = 0; v < along; v++) {
      for (let u = 0; u < across; u++) {
        const a = grid[v]![u]!;
        const bb = grid[v]![u + 1]!;
        const c = grid[v + 1]![u + 1]!;
        const d = grid[v + 1]![u]!;
        if (sign > 0) index.push(a, bb, c, a, c, d);
        else index.push(a, c, bb, a, d, c);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geometry.setIndex(index);
    this.push(geometry, material);
  }

  private loftPart(
    axis: 'x' | 'z',
    stations: readonly Station[],
    material: THREE.Material,
    paint?: Paint,
    matrix?: THREE.Matrix4,
  ): void {
    if (stations.length < 2) return;
    const ordered = orderStations(stations);
    const rings = ordered.map((station) => orientRing(station.ring));
    const n = rings[0]!.length;
    if (n < 3) return;
    const last = ordered.length - 1;
    const at = (station: number): number => ordered[station]!.at;
    const point = (station: number, index: number): Vec2 => rings[station]![index % n]!;

    interface Bucket {
      readonly position: number[];
      readonly uv: number[];
      readonly index: number[];
      readonly vertices: Map<number, number>;
    }
    const buckets = new Map<THREE.Material, Bucket>();
    const bucketFor = (bucketMaterial: THREE.Material): Bucket => {
      let bucket = buckets.get(bucketMaterial);
      if (!bucket) {
        bucket = { position: [], uv: [], index: [], vertices: new Map() };
        buckets.set(bucketMaterial, bucket);
      }
      return bucket;
    };
    const vertex = (bucket: Bucket, station: number, index: number): number => {
      const key = station * n + (index % n);
      let found = bucket.vertices.get(key);
      if (found === undefined) {
        found = bucket.position.length / 3;
        const p = point(station, index);
        if (axis === 'z') bucket.position.push(p[0], p[1], at(station));
        else bucket.position.push(at(station), p[0], p[1]);
        bucket.uv.push((index % n) / n, station / last);
        bucket.vertices.set(key, found);
      }
      return found;
    };

    for (let station = 0; station < last; station++) {
      for (let index = 0; index < n; index++) {
        const bucket = bucketFor(paint?.(station, index) ?? material);
        const a = vertex(bucket, station, index);
        const bb = vertex(bucket, station, index + 1);
        const c = vertex(bucket, station + 1, index + 1);
        const d = vertex(bucket, station + 1, index);
        bucket.index.push(a, bb, c, a, c, d);
      }
    }
    // Caps: a fan at each end, wound to face out of the solid along the axis. The fan
    // takes its own copy of the ring, so the cap's normals stay the cap's own plane
    // instead of leaning into the sides — a crisp end edge, and no sliver averaged
    // past the point where its winding would read as inside out.
    for (const [end, outwards] of [[0, -1], [last, 1]] as const) {
      const bucket = bucketFor(material);
      let cx = 0;
      let cy = 0;
      for (let index = 0; index < n; index++) {
        const p = point(end, index);
        cx += p[0];
        cy += p[1];
      }
      const cap: number[] = [];
      for (let index = 0; index < n; index++) {
        const p = point(end, index);
        cap.push(bucket.position.length / 3);
        if (axis === 'z') bucket.position.push(p[0], p[1], at(end));
        else bucket.position.push(at(end), p[0], p[1]);
        bucket.uv.push(index / n, end === 0 ? 0 : 1);
      }
      const centre = bucket.position.length / 3;
      if (axis === 'z') bucket.position.push(cx / n, cy / n, at(end));
      else bucket.position.push(at(end), cx / n, cy / n);
      bucket.uv.push(0.5, end === 0 ? 0 : 1);
      for (let index = 0; index < n; index++) {
        const a = cap[index]!;
        const bb = cap[(index + 1) % n]!;
        if (outwards < 0) bucket.index.push(centre, bb, a);
        else bucket.index.push(centre, a, bb);
      }
    }

    for (const [bucketMaterial, bucket] of buckets) {
      if (bucket.index.length === 0) continue;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(bucket.position, 3));
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(bucket.uv, 2));
      geometry.setIndex(bucket.index);
      geometry.computeVertexNormals();
      if (matrix) geometry.applyMatrix4(matrix);
      this.push(geometry, bucketMaterial);
    }
  }

  private push(geometry: THREE.BufferGeometry, material: THREE.Material): void {
    this.geometry.push(geometry);
    this.materials.push(material);
  }

  private add(
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    position: Vec3,
    rotation: Vec3,
    scale: Vec3,
  ): void {
    _p.set(position[0], position[1], position[2]);
    _e.set(rotation[0], rotation[1], rotation[2]);
    _q.setFromEuler(_e);
    _s.set(scale[0], scale[1], scale[2]);
    _m.compose(_p, _q, _s);
    geometry.applyMatrix4(_m);
    this.push(geometry, material);
  }

  /** One mesh per material, in first-seen order. */
  build(): { meshes: THREE.Mesh[]; geometries: THREE.BufferGeometry[] } {
    const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
    for (let i = 0; i < this.geometry.length; i++) {
      const material = this.materials[i]!;
      let list = buckets.get(material);
      if (!list) {
        list = [];
        buckets.set(material, list);
      }
      list.push(this.geometry[i]!);
    }
    const meshes: THREE.Mesh[] = [];
    const owned: THREE.BufferGeometry[] = [];
    for (const [material, list] of buckets) {
      const merged = list.length === 1 ? list[0]! : mergeGeometries(list, false);
      if (!merged) continue;
      if (list.length > 1) for (const geometry of list) geometry.dispose();
      merged.name = material.name || 'part';
      meshes.push(new THREE.Mesh(merged, material));
      owned.push(merged);
    }
    return { meshes, geometries: owned };
  }
}

/** Local collision boxes of the airframe: `[min, max]` corners, metres. */
const COLLIDER_BOXES: readonly (readonly [readonly [number, number, number], readonly [number, number, number]])[] = [
  // The cabin and the cowl: floor to roof, the cabin's rear to the nose bowl.
  [[-0.62, CABIN_FLOOR_Y - 0.07, CABIN_REAR_Z - 0.08], [0.62, CABIN_ROOF_Y + 0.06, COWL_FRONT_Z]],
  // The aft fuselage cone, rising to the tail.
  [[-0.6, 1.32, TAIL_END_Z], [0.6, 2.2, CABIN_REAR_Z - 0.08]],
  // The wing, to the tips' own (dihedral-raised) thickness.
  [[-LIGHT_PLANE_SPAN / 2, 1.9, -0.3], [LIGHT_PLANE_SPAN / 2, 2.44, WING_CENTRE_Z + WING_ROOT_CHORD / 2]],
  // Tailplane, elevator and the hinge between them.
  [[-STAB_HALF_SPAN, 1.9, -4.42], [STAB_HALF_SPAN, 2.1, -3.05]],
  // Fin, rudder and the dorsal fillet.
  [[-0.08, 1.95, -4.6], [0.08, FIN_TOP_Y, -1.2]],
  // Main gear, wheel pants included.
  [[MAIN_WHEEL_X - 0.24, 0, -0.66], [MAIN_WHEEL_X + 0.24, 0.7, 0.52]],
  [[-MAIN_WHEEL_X - 0.24, 0, -0.66], [-MAIN_WHEEL_X + 0.24, 0.7, 0.52]],
  // Nose gear and its wheel pant.
  [[-0.18, 0, NOSE_WHEEL_Z - 0.36], [0.18, 0.5, NOSE_WHEEL_Z + 0.3]],
];

export interface LightPlane {
  /** Root. Local frame: +Z = nose/forward, +Y up, wheels' contact at y = 0, origin under the wing's centre (≈ main gear). */
  readonly group: THREE.Group;
  /** Spins about its local Z; set `.rotation.z` or call `spin(dt, rpmFraction)`. */
  readonly propeller: THREE.Object3D;
  /** Collision boxes in the plane's LOCAL frame: [min, max] pairs (fuselage, wing, tail…). */
  readonly colliderBoxes: readonly (readonly [readonly [number, number, number], readonly [number, number, number]])[];
  /** Local point beside the cabin door (left side), feet height 0. */
  readonly doorPoint: readonly [number, number, number];
  spin(dt: number, rpmFraction: number): void;
  dispose(): void;
}

/**
 * Builds the airframe: the lofted fuselage, the wing and its struts, the tail, the
 * tricycle gear, the panes, the small details and the propeller.
 */
function buildAirframe(): { group: THREE.Group; propeller: THREE.Group; geometries: THREE.BufferGeometry[] } {
  const white = planeBodyMaterial();
  const trim = planeTrimMaterial();
  const dark = planeDarkMaterial();
  const chrome = planeChromeMaterial();
  const blade = planeBladeMaterial();
  const tip = planeTipMaterial();
  const rubber = planeRubberMaterial();
  const glass = planeGlassMaterial();

  const b = new Airframe();
  const prop = new Airframe();

  // --- fuselage: one lofted skin from the tail cone to the cowl's front ----------
  b.loft(
    'z',
    FUSELAGE.map((station) => ({ at: station[0], ring: fuselageRing(station[0], FUSELAGE_SEGMENTS) })),
    white,
  );

  // --- livery: the cheat line, laid on the skin a few millimetres proud ----------
  // It leaves the firewall under the door's sill and sweeps up the tapering tail cone;
  // the fin carries it on up as its own painted band (see FIN).
  for (const side of [1, -1] as const) {
    b.skinPatch(
      [
        [-3.95, 1.8, side],
        [-3.95, 1.9, side],
        [1.62, 1.5, side],
        [1.62, 1.3, side],
      ],
      0.006,
      trim,
    );
  }

  // --- glass: black sky mirrors, the cars' own tint -----------------------------
  for (const side of [1, -1] as const) {
    // Door window: the frame first, the pane next, each a touch further off the skin
    // than the last, so the frame reads as a mullion and nothing is ever coincident.
    b.skinPatch(
      [
        [0.02, 1.66, side],
        [0.02, 2.07, side],
        [1.02, 2.07, side],
        [1.02, 1.66, side],
      ],
      0.004,
      dark,
    );
    b.skinPatch(
      [
        [0.08, 1.7, side],
        [0.08, 2.03, side],
        [0.96, 2.03, side],
        [0.96, 1.7, side],
      ],
      0.008,
      glass,
    );
    // Rear quarter window, behind the door's trailing edge.
    b.skinPatch(
      [
        [-0.78, 1.7, side],
        [-0.78, 2.04, side],
        [-0.08, 2.04, side],
        [-0.08, 1.7, side],
      ],
      0.004,
      dark,
    );
    b.skinPatch(
      [
        [-0.72, 1.74, side],
        [-0.72, 2.0, side],
        [-0.14, 2.0, side],
        [-0.14, 1.74, side],
      ],
      0.008,
      glass,
    );
    // Door outline: the front and rear seams down the flank, and the sill.
    b.skinPatch(
      [
        [1.02, 1.24, side],
        [1.02, 2.09, side],
        [1.06, 2.09, side],
        [1.06, 1.24, side],
      ],
      0.005,
      dark,
    );
    b.skinPatch(
      [
        [-0.06, 1.24, side],
        [-0.06, 2.09, side],
        [-0.02, 2.09, side],
        [-0.02, 1.24, side],
      ],
      0.005,
      dark,
    );
    b.skinPatch(
      [
        [-0.06, 1.2, side],
        [-0.06, 1.26, side],
        [1.02, 1.26, side],
        [1.02, 1.2, side],
      ],
      0.005,
      dark,
    );
    // The gear leg's fitting, where it comes through the belly's flank.
    b.skinPatch(
      [
        [0.56, 1.09, side],
        [0.56, 1.2, side],
        [0.9, 1.2, side],
        [0.9, 1.09, side],
      ],
      0.005,
      dark,
    );
  }
  // Windscreen: one raked pane wrapping the cabin's front, its frame behind it.
  b.skinPatch(
    [
      [1.24, 2.05, 1],
      [1.24, 2.05, -1],
      [1.86, 1.76, -1],
      [1.86, 1.76, 1],
    ],
    0.004,
    dark,
  );
  b.skinPatch(
    [
      [1.3, 2.02, 1],
      [1.3, 2.02, -1],
      [1.8, 1.8, -1],
      [1.8, 1.8, 1],
    ],
    0.008,
    glass,
  );
  // The handle is on the pilot's side. Facing +Z with +Y up and a right-handed basis,
  // the LEFT hand points along +X (`right × up = backward`).
  b.skinPatch(
    [
      [0.3, 1.5, 1],
      [0.3, 1.58, 1],
      [0.46, 1.58, 1],
      [0.46, 1.5, 1],
    ],
    0.014,
    dark,
  );

  // --- the nose: cowl inlets, the landing light and the exhausts -----------------
  for (const side of [1, -1] as const) {
    // The two inlets sit in the half-moon of nose bowl either side of the spinner.
    b.cylinder(1, 1, 1, 12, dark, [side * 0.19, 1.5, 3.022], AXIS_Z, [0.098, 0.04, 0.072]);
    // Exhaust stub, out through the cowl's lower flank and aft.
    b.strut([side * 0.3, 1.35, 2.35], [side * 0.44, 1.22, 2.0], 0.035, 0.028, dark, 8);
  }
  // Landing light in the port cheek: bezel first, lens proud of it.
  const cowl = fuselageSection(2.55);
  const lampAngle = skinAngle(cowl, 1.44, 1);
  const lampAt = skinPoint(cowl, lampAngle);
  const lampNormal = skinNormal(cowl, lampAngle);
  b.strut(
    [lampAt[0] - lampNormal[0] * 0.05, lampAt[1] - lampNormal[1] * 0.05, 2.55],
    [lampAt[0] + lampNormal[0] * 0.012, lampAt[1] + lampNormal[1] * 0.012, 2.55],
    0.075,
    0.075,
    chrome,
    12,
  );
  b.strut(
    [lampAt[0] - lampNormal[0] * 0.03, lampAt[1] - lampNormal[1] * 0.03, 2.55],
    [lampAt[0] + lampNormal[0] * 0.02, lampAt[1] + lampNormal[1] * 0.02, 2.55],
    0.058,
    0.058,
    glass,
    12,
  );

  // --- wing: one loft a side, the dihedral built into the stations ---------------
  for (const side of [1, -1] as const) {
    b.loft(
      'x',
      WING.map((station) => ({ at: side * station[0], ring: wingRing(wingSection(station[0])) })),
      white,
      (_station, segment) => (segment === WING_HINGE_BOTTOM || segment === WING_HINGE_TOP ? dark : white),
    );
    // The cheat line carries out along the leading edge as a sock over the nose of the
    // section: six millimetres proud, ten inside, so it is part of the wing's surface
    // rather than a box standing in front of it.
    b.loft(
      'x',
      [0.2, 2.0, 4.0, 5.1].map((x) => {
        const section = wingSection(x);
        return {
          at: side * x,
          ring: [...wingBand(section, WING_NOSE, 0.006), ...wingBand(section, [...WING_NOSE].reverse(), -0.01)],
        };
      }),
      trim,
    );
    // Wing root: no fairing shelf is needed. The cabin's flank rises to within a
    // centimetre or two of the wing's underside at the root, so the joint is closed by
    // the two surfaces themselves — and a shelf big enough to be seen would sit straight
    // across the cabin's windows.
    // V strut: from inside the sill out to the front spar, faired.
    b.aimed(
      [side * 0.34, 1.3, 0.92],
      [side * 2.55, 2.1, 1.0],
      [0, 0, 1],
      [
        { at: 0, ring: rectRing(0.07, 0, 0.032) },
        { at: 1.2, ring: rectRing(0.062, 0, 0.028) },
        { at: 2.32, ring: rectRing(0.058, 0, 0.026) },
      ],
      white,
    );
    // Navigation light: red to port (the local +X flank), green to starboard.
    b.sphere(
      1,
      8,
      6,
      side > 0 ? planePortLampMaterial() : planeStarboardLampMaterial(),
      [side * 5.44, 2.256, 0.8],
      [0.05, 0.045, 0.062],
    );
  }

  // --- tail: fin, rudder, tailplane and their hinge lines ------------------------
  b.loft(
    'z',
    FIN.map((station) => ({
      at: station[0],
      ring: [
        [-station[3], station[1]],
        [station[3], station[1]],
        [station[3], station[1] + station[4]],
        [station[3], station[2]],
        [-station[3], station[2]],
        [-station[3], station[1] + station[4]],
      ],
    })),
    white,
    (_station, segment) => (segment === 1 || segment === 5 ? trim : white),
  );
  {
    // Rudder hinge: a dark band round the fin where its trailing edge gives way to the
    // rudder, a few millimetres proud of the fin's own sides.
    const rear = FIN[2]!;
    const front = FIN[3]!;
    const mix = (RUDDER_HINGE_Z - rear[0]) / (front[0] - rear[0]);
    const bottom = lerp(rear[1], front[1], mix);
    const top = lerp(rear[2], front[2], mix);
    const halfT = lerp(rear[3], front[3], mix) + 0.005;
    b.loft(
      'z',
      [RUDDER_HINGE_Z - 0.016, RUDDER_HINGE_Z + 0.016].map((z) => ({
        at: z,
        ring: rectRing(halfT, (bottom + top) / 2, (top - bottom) / 2),
      })),
      dark,
    );
  }
  for (const side of [1, -1] as const) {
    b.loft(
      'x',
      STAB.map((station) => ({
        at: side * station[0],
        ring: [
          [station[1] - station[2], station[3]],
          [station[1] + station[2], station[3]],
          [station[1] + station[2], station[4]],
          [station[1] - station[2], station[4]],
        ],
      })),
      white,
    );
    // Elevator hinge: the same plate's thickness, a hair proud, at the rear spar. Its
    // own end caps stop short of the tailplane's, which are in the plane they would share.
    b.loft(
      'x',
      STAB.map((station, index) => ({
        at: side * (index === 0 ? 0.04 : index === STAB.length - 1 ? STAB_HALF_SPAN - 0.03 : station[0]),
        ring: [
          [station[1] - station[2] - 0.005, ELEVATOR_HINGE_Z - 0.016],
          [station[1] + station[2] + 0.005, ELEVATOR_HINGE_Z - 0.016],
          [station[1] + station[2] + 0.005, ELEVATOR_HINGE_Z + 0.016],
          [station[1] - station[2] - 0.005, ELEVATOR_HINGE_Z + 0.016],
        ],
      })),
      dark,
    );
  }

  // --- tricycle gear: spring-steel legs, wheel pants, tyres ----------------------
  for (const side of [1, -1] as const) {
    const x = side * MAIN_WHEEL_X;
    // The leg starts inside the belly and ends inside the pant: two straps with the bow
    // of a spring leg at the knee, and the pant swallows the axle.
    b.aimed(
      [side * 0.42, 1.22, 0.72],
      [side * 0.8, 0.86, 0.3],
      [1, 0, 0],
      [
        { at: 0, ring: rectRing(0.012, 0, 0.03) },
        { at: 0.3, ring: rectRing(0.013, 0, 0.032) },
        { at: 0.62, ring: rectRing(0.013, 0, 0.03) },
      ],
      dark,
    );
    b.aimed(
      [side * 0.76, 0.88, 0.34],
      [x, 0.4, 0.02],
      [1, 0, 0],
      [
        { at: 0, ring: rectRing(0.013, 0, 0.03) },
        { at: 0.3, ring: rectRing(0.013, 0, 0.028) },
        { at: 0.56, ring: rectRing(0.012, 0, 0.024) },
      ],
      dark,
    );
    b.loft(
      'z',
      [
        { at: -0.62, ring: circleRing(x, 0.6, 0.045, 0.085, 10) },
        { at: -0.44, ring: circleRing(x, 0.48, 0.115, 0.19, 10) },
        { at: -0.22, ring: circleRing(x, 0.39, 0.155, 0.23, 10) },
        { at: 0.02, ring: circleRing(x, 0.37, 0.175, 0.245, 10) },
        { at: 0.3, ring: circleRing(x, 0.39, 0.13, 0.175, 10) },
        { at: 0.46, ring: circleRing(x, 0.42, 0.055, 0.07, 10) },
      ],
      white,
    );
    b.cylinder(MAIN_WHEEL_R, MAIN_WHEEL_R, 0.16, 14, rubber, [x, MAIN_WHEEL_R, 0], AXIS_X);
    b.cylinder(0.1, 0.1, 0.18, 10, chrome, [x, MAIN_WHEEL_R, 0], AXIS_X);
  }
  // Nose gear: strut out of the cowl's bottom down into its own pant and fork.
  b.aimed(
    [0, 1.32, NOSE_WHEEL_Z],
    [0, 0.34, NOSE_WHEEL_Z],
    [0, 0, 1],
    [
      { at: 0, ring: rectRing(0.05, 0, 0.028) },
      { at: 0.5, ring: rectRing(0.042, 0, 0.024) },
      { at: 0.99, ring: rectRing(0.036, 0, 0.022) },
    ],
    dark,
  );
  b.loft(
    'z',
    [
      { at: 1.96, ring: circleRing(0, 0.37, 0.045, 0.07, 10) },
      { at: 2.08, ring: circleRing(0, 0.31, 0.115, 0.155, 10) },
      { at: 2.26, ring: circleRing(0, 0.28, 0.14, 0.185, 10) },
      { at: 2.44, ring: circleRing(0, 0.29, 0.115, 0.145, 10) },
      { at: 2.56, ring: circleRing(0, 0.3, 0.055, 0.065, 10) },
    ],
    white,
  );
  b.cylinder(NOSE_WHEEL_R, NOSE_WHEEL_R, 0.13, 12, rubber, [0, NOSE_WHEEL_R, NOSE_WHEEL_Z], AXIS_X);
  b.cylinder(0.07, 0.07, 0.15, 10, chrome, [0, NOSE_WHEEL_R, NOSE_WHEEL_Z], AXIS_X);

  // --- the step under the door, and the antenna behind the cabin -----------------
  b.strut([0.42, 1.2, 0.72], [0.46, 1.0, 0.72], 0.022, 0.022, dark, 6);
  b.box([0.24, 0.03, 0.32], dark, [0.46, 0.985, 0.72]);
  b.box([0.1, 0.05, 0.16], dark, [0, 2.13, -0.62]);
  b.strut([0, 2.11, -0.62], [0, 2.52, -0.78], 0.014, 0.005, dark, 6);

  // --- propeller: the spinning group, blades and spinner on one axis -------------
  // Spinner: an ogive whose base is tucked up inside the cowl's mouth.
  prop.loft(
    'z',
    [
      { at: -0.16, ring: circleRing(0, 0, 0.17, 0.17, 12) },
      { at: -0.02, ring: circleRing(0, 0, 0.156, 0.156, 12) },
      { at: 0.08, ring: circleRing(0, 0, 0.14, 0.14, 12) },
      { at: 0.19, ring: circleRing(0, 0, 0.108, 0.108, 12) },
      { at: 0.27, ring: circleRing(0, 0, 0.07, 0.07, 12) },
      { at: 0.34, ring: circleRing(0, 0, 0.022, 0.022, 12) },
    ],
    chrome,
  );
  // Crank flange, kept off the cowl's front face: its cap and that face would be one
  // plane otherwise, and two faces in one plane is the shimmer this file is arranged
  // to avoid.
  prop.cylinder(0.12, 0.12, 0.12, 10, dark, [0, 0, -0.24], AXIS_Z);
  // Two blades, pitched from the root out, the last bay painted as the tip band.
  for (const side of [1, -1] as const) {
    prop.loft(
      'x',
      [0.13, 0.45, 0.75, 0.94].map((x, index) => {
        const [halfT, halfChord, pitch] = BLADE[index]!;
        return { at: side * x, ring: bladeRing(halfT, halfChord, pitch) };
      }),
      blade,
      (station) => (station === BLADE.length - 2 ? tip : blade),
    );
  }
  const hub = new THREE.Group();
  hub.name = 'propeller';
  hub.position.set(0, AXIS_Y, PROP_Z);
  const propBuilt = prop.build();
  for (const mesh of propBuilt.meshes) {
    mesh.castShadow = false;
    hub.add(mesh);
  }

  const built = b.build();
  const group = new THREE.Group();
  group.name = 'light-plane';
  for (const mesh of built.meshes) group.add(mesh);
  group.add(hub);

  return { group, propeller: hub, geometries: [...built.geometries, ...propBuilt.geometries] };
}

/** A fresh plane standing on its tyres at the local origin. */
export function createLightPlane(): LightPlane {
  const { group, propeller, geometries } = buildAirframe();
  const glass = planeGlassMaterial();
  group.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    // Glass must never be shadowed into a black slab (render/partmesh.ts makes the
    // same call for the cars' windows).
    const isGlass = child.material === glass;
    child.castShadow = !isGlass;
    child.receiveShadow = !isGlass;
  });
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
