/**
 * The light plane: a Cessna-172-shaped single-engine high-wing, built from
 * primitives at the size the story needs and nothing more.
 *
 * WHY PROCEDURAL. The parked plane is scenery and the take-off and landing
 * cutscenes fly two more of the same thing, so what matters is a recognisable
 * silhouette at 20 m and a cost near zero: a handful of merged meshes (6 draw
 * calls), a couple of thousand triangles, and no download. Every part is a box,
 * a cylinder or a scaled sphere, which is the same kit the dwellings and the
 * props are built from, so it sits in the drawn world without a second look.
 *
 * THE LOCAL FRAME (fixed by the story contract, shared with the site builder):
 * +Z is the nose, +Y is up, and y = 0 is where the TYRES touch the ground. The
 * origin sits on the ground under the wing's centre, which is roughly the main
 * gear, so a plane placed at `y = runwaySurfaceY(...)` rests on the runway with
 * no correction and `doorPoint` is a standing position beside the cabin door.
 *
 * THE WINDOWS are the one window tint in the game (`TINTED_GLASS`, shared with
 * every car and house): an opaque black-blue sky mirror, never a see-through
 * pane, so nothing inside the cabin has to be modelled.
 *
 * MATERIALS ARE SHARED across every plane instance for the session (the
 * dwellings' idiom: `dwellingBodyMaterial`/`dwellingGlassMaterial`), because a
 * plane is pure and building the same swatches again per instance would only
 * add programs. `dispose()` therefore frees this instance's GEOMETRY alone.
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

/** Fuselage centreline height above the tyres, metres. */
const AXIS_Y = 1.62;
/** Engine cowl: small at the spinner, swelling to the cabin's front. */
const COWL_FRONT_Z = 3.02;
const COWL_REAR_Z = 1.68;
/** Cabin box, the boxy greenhouse of a 172. */
const CABIN_HALF_W = 0.575;
const CABIN_FRONT_Z = 1.72;
const CABIN_REAR_Z = -0.82;
const CABIN_FLOOR_Y = 1.06;
const CABIN_ROOF_Y = 2.18;
/** Aft fuselage: a cone from the cabin's rear to the tail cone. */
const TAIL_FRONT_Z = CABIN_REAR_Z;
const TAIL_END_Z = -4.05;
/** Wing: high, strut-braced, with 2 degrees of dihedral. */
const WING_Y = 2.06;
const WING_ROOT_CHORD = 1.8;
const WING_TIP_CHORD = 1.32;
const WING_CENTRE_Z = 0.65;
const WING_DIHEDRAL = 0.035;
/** Tail surfaces. */
const FIN_TOP_Y = LIGHT_PLANE_HEIGHT;
const STAB_Y = 1.95;
const STAB_HALF_SPAN = 1.65;
/** Tricycle gear: mains under the wing, nose wheel well forward of them. */
const MAIN_WHEEL_X = 1.12;
const MAIN_WHEEL_R = 0.3;
const NOSE_WHEEL_Z = 2.28;
const NOSE_WHEEL_R = 0.24;
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

/* ---- the primitive builder ---- */

type Vec3 = readonly [number, number, number];

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
const _dir = new THREE.Vector3();

/**
 * Accumulates primitives and merges them one mesh per material. The geometries
 * are freshly created here and never shared, so transforming them in place is
 * safe; nothing is retained after `build()`.
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

  /** A round tube spanning two local points; the strut legs and the gear legs. */
  strut(from: Vec3, to: Vec3, radius: number, material: THREE.Material, segments = 8): void {
    _a.set(from[0], from[1], from[2]);
    _b.set(to[0], to[1], to[2]);
    _dir.subVectors(_b, _a);
    const length = _dir.length();
    if (length < 1e-6) return;
    _dir.divideScalar(length);
    _q.setFromUnitVectors(_up, _dir);
    _e.setFromQuaternion(_q);
    this.add(
      new THREE.CylinderGeometry(radius, radius, length, segments, 1, false),
      material,
      [(_a.x + _b.x) / 2, (_a.y + _b.y) / 2, (_a.z + _b.z) / 2],
      [_e.x, _e.y, _e.z],
      ONE,
    );
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
    this.geometry.push(geometry);
    this.materials.push(material);
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
  // The cabin, the cowl and the cabin's own width.
  [[-0.62, 0.82, -1.1], [0.62, 2.28, COWL_FRONT_Z]],
  // The wing, to the tips' own (dihedral-raised) thickness.
  [[-LIGHT_PLANE_SPAN / 2, 1.9, WING_CENTRE_Z - WING_ROOT_CHORD / 2], [LIGHT_PLANE_SPAN / 2, 2.45, WING_CENTRE_Z + WING_ROOT_CHORD / 2]],
  // The aft fuselage cone, between the cabin and the tail surfaces.
  [[-0.6, 1.0, TAIL_END_Z], [0.6, 2.2, TAIL_FRONT_Z]],
  // Tailplane and elevator.
  [[-STAB_HALF_SPAN, 1.9, -4.32], [STAB_HALF_SPAN, 2.02, -3.05]],
  // Fin and rudder.
  [[-0.08, 1.8, -4.55], [0.08, FIN_TOP_Y, -3.1]],
  // Main gear, wheel pants included.
  [[MAIN_WHEEL_X - 0.22, 0, -0.46], [MAIN_WHEEL_X + 0.22, 0.68, 0.46]],
  [[-MAIN_WHEEL_X - 0.22, 0, -0.46], [-MAIN_WHEEL_X + 0.22, 0.68, 0.46]],
  // Nose gear.
  [[-0.18, 0, NOSE_WHEEL_Z - 0.4], [0.18, 0.58, NOSE_WHEEL_Z + 0.3]],
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

/** Builds the airframe: fuselage, wing, struts, tail, gear, glass and propeller. */
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

  // --- fuselage -----------------------------------------------------------------
  b.box(
    [CABIN_HALF_W * 2, CABIN_ROOF_Y - CABIN_FLOOR_Y, CABIN_FRONT_Z - CABIN_REAR_Z],
    white,
    [0, (CABIN_FLOOR_Y + CABIN_ROOF_Y) / 2, (CABIN_FRONT_Z + CABIN_REAR_Z) / 2],
  );
  // Aft fuselage: one cone from the cabin's rear to the tail. RadiusTop is the +Z
  // end after the AXIS_Z re-point, so the SMALL end is the tail.
  const tailLength = TAIL_FRONT_Z - TAIL_END_Z;
  b.cylinder(0.6, 0.17, tailLength, 12, white, [0, AXIS_Y, (TAIL_FRONT_Z + TAIL_END_Z) / 2], AXIS_Z);
  // Cowl: swells from the spinner back to the firewall, and slightly down-sloped.
  b.cylinder(0.42, 0.6, COWL_FRONT_Z - COWL_REAR_Z, 14, white, [0, AXIS_Y - 0.03, (COWL_FRONT_Z + COWL_REAR_Z) / 2], AXIS_Z);
  // Cowl lips: the two air inlets and the exhaust, the dark notes on the nose.
  b.box([0.17, 0.15, 0.1], dark, [-0.24, AXIS_Y + 0.09, COWL_FRONT_Z - 0.02]);
  b.box([0.17, 0.15, 0.1], dark, [0.24, AXIS_Y + 0.09, COWL_FRONT_Z - 0.02]);
  b.box([0.09, 0.09, 0.5], dark, [0.42, AXIS_Y - 0.22, COWL_REAR_Z - 0.2]);
  // Belly step under the cabin, so the fuselage does not end as a flat slab.
  b.box([0.78, 0.2, 1.4], white, [0, CABIN_FLOOR_Y - 0.02, 0.2]);

  // --- wing ---------------------------------------------------------------------
  const halfSpan = LIGHT_PLANE_SPAN / 2;
  for (const side of [1, -1] as const) {
    const innerSpan = halfSpan - 2.4;
    const tipSpan = halfSpan - innerSpan;
    // Dihedral tilts each panel about its ROOT, so a panel's centre is the root
    // plus half its own span along the tilted axis: x = d·cos θ, y = d·sin θ.
    // (`d` carries the side's sign, and so does θ, so both wings rise.)
    const panelCentre = (from: number, to: number): [number, number] => {
      const d = side * (from + to) / 2;
      const theta = side * WING_DIHEDRAL;
      return [d * Math.cos(theta), WING_Y + d * Math.sin(theta)];
    };
    const inner = panelCentre(0, innerSpan);
    b.box(
      [innerSpan, 0.26, WING_ROOT_CHORD],
      white,
      [inner[0], inner[1], WING_CENTRE_Z],
      [0, 0, side * WING_DIHEDRAL],
    );
    const tip = panelCentre(innerSpan, halfSpan);
    b.box(
      [tipSpan, 0.2, WING_TIP_CHORD],
      white,
      [tip[0], tip[1], WING_CENTRE_Z - 0.06],
      [0, 0, side * WING_DIHEDRAL],
    );
    // The cheat line carries out along the wing's leading edge, standing a hand's
    // width proud of it so it is the edge that reads from the side and the front.
    const stripe = panelCentre(0.3, halfSpan - 0.3);
    b.box(
      [halfSpan - 1.2, 0.16, 0.06],
      trim,
      [stripe[0], stripe[1], WING_CENTRE_Z + WING_ROOT_CHORD / 2 + 0.02],
      [0, 0, side * WING_DIHEDRAL],
    );
    // Wing root fairing over the cabin roof.
    b.box([0.5, 0.16, WING_ROOT_CHORD + 0.3], white, [side * 0.4, CABIN_ROOF_Y + 0.02, WING_CENTRE_Z]);
    // V strut: fuselage sill out to the wing's underside amidships.
    b.strut(
      [side * 0.5, CABIN_FLOOR_Y - 0.02, 0.78],
      [side * (innerSpan - 0.55), WING_Y - 0.14, 0.66],
      0.05,
      white,
      8,
    );
  }
  // Cabin roof: the wing's centre section sits on it.
  b.box([1.1, 0.1, WING_ROOT_CHORD + 0.2], white, [0, CABIN_ROOF_Y - 0.04, WING_CENTRE_Z]);

  // --- tail ---------------------------------------------------------------------
  b.box([3.3, 0.07, 1.0], white, [0, STAB_Y, -3.5]);
  b.box([3.3, 0.06, 0.42], white, [0, STAB_Y + 0.005, -4.11]);
  b.box([0.09, FIN_TOP_Y - 1.76, 1.05], white, [0, (FIN_TOP_Y + 1.76) / 2, -3.6]);
  b.box([0.06, 0.94, 0.5], white, [0, 2.24, -4.3]);
  // Dorsal fillet from the cabin roof back to the fin.
  b.box([0.07, 0.34, 1.5], white, [0, CABIN_ROOF_Y - 0.05, -2.5]);
  // The cheat line runs up the fin.
  b.box([0.1, 0.34, 0.9], trim, [0, 2.42, -3.6]);
  b.box([0.1, 0.14, 0.5], trim, [0, 2.6, -4.3]);

  // --- glass: black sky mirrors, the cars' own tint -------------------------------
  // Windscreen, leaning back over the cabin's front.
  b.box([1.02, 0.72, 0.06], glass, [0, 1.9, CABIN_FRONT_Z + 0.06], [-0.42, 0, 0]);
  for (const side of [1, -1] as const) {
    const x = side * (CABIN_HALF_W + 0.012);
    b.box([0.06, 0.46, 1.02], glass, [x, 1.86, 0.5]);
    b.box([0.06, 0.44, 0.62], glass, [x, 1.84, -0.45]);
    // Door seam and handle, so the cabin side reads as a door rather than a panel.
    b.box([0.05, 0.98, 0.03], dark, [x, 1.6, 1.02]);
    b.box([0.05, 0.98, 0.03], dark, [x, 1.6, -0.08]);
    // The handle is on the pilot's side. Facing +Z with +Y up and a right-handed basis,
    // the LEFT hand points along +X (`right × up = backward`).
    if (side > 0) b.box([0.06, 0.07, 0.16], dark, [x + 0.01, 1.5, 0.2]);
  }

  // --- cheat line along the cabin and the aft fuselage ---------------------------
  for (const side of [1, -1] as const) {
    b.box([0.06, 0.17, 1.9], trim, [side * (CABIN_HALF_W + 0.012), 1.34, 0.45]);
    b.box([0.06, 0.15, 1.5], trim, [side * 0.42, 1.3, -1.6]);
  }

  // --- tricycle gear with wheel pants --------------------------------------------
  for (const side of [1, -1] as const) {
    const x = side * MAIN_WHEEL_X;
    b.strut([side * 0.5, CABIN_FLOOR_Y - 0.06, 0.3], [x, MAIN_WHEEL_R + 0.06, 0.0], 0.055, dark, 8);
    b.sphere(1, 10, 8, white, [x, MAIN_WHEEL_R + 0.06, 0], [0.17, 0.26, 0.45]);
    b.cylinder(MAIN_WHEEL_R, MAIN_WHEEL_R, 0.16, 14, rubber, [x, MAIN_WHEEL_R, 0], AXIS_X);
    b.cylinder(0.1, 0.1, 0.2, 8, chrome, [x, MAIN_WHEEL_R, 0], AXIS_X);
    // Fairing's trailing tip, angled up off the pant.
    b.box([0.12, 0.3, 0.34], white, [x, MAIN_WHEEL_R + 0.24, -0.42], [0.5, 0, 0]);
  }
  b.strut([0, CABIN_FLOOR_Y - 0.1, 2.1], [0, NOSE_WHEEL_R + 0.02, NOSE_WHEEL_Z], 0.05, dark, 8);
  b.sphere(1, 10, 8, white, [0, NOSE_WHEEL_R + 0.05, NOSE_WHEEL_Z], [0.13, 0.2, 0.3]);
  b.cylinder(NOSE_WHEEL_R, NOSE_WHEEL_R, 0.12, 12, rubber, [0, NOSE_WHEEL_R, NOSE_WHEEL_Z], AXIS_X);
  b.cylinder(0.07, 0.07, 0.16, 8, chrome, [0, NOSE_WHEEL_R, NOSE_WHEEL_Z], AXIS_X);

  // --- propeller: the spinning group, blades and spinner on one axis --------------
  prop.cylinder(0.06, 0.3, 0.5, 12, chrome, [0, 0, 0.16], AXIS_Z);
  prop.cylinder(0.12, 0.12, 0.16, 10, dark, [0, 0, -0.1], AXIS_Z);
  for (const side of [1, -1] as const) {
    prop.box([0.72, 0.05, 0.17], blade, [side * 0.5, 0, 0], [0.3, 0, 0]);
    prop.box([0.14, 0.05, 0.17], tip, [side * 0.9, 0, 0], [0.3, 0, 0]);
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
