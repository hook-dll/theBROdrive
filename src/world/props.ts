/**
 * Roadside props: sparse desert scatter (cacti + rocks), occasional hazards on the
 * driving surface, the pole line beside the road, and the distance monuments.
 *
 * Every prop is a pure function of the integer seed via stateless hashing, so a
 * chunk builds identically whether it is generated in order or revisited later.
 * Nothing here owns game state; chunk content is a derived view of the seed.
 *
 * Instancing is load-bearing for the scatter: the visible radius needs hundreds of
 * cacti and rocks, and one draw call per mesh is the only way that stays at frame
 * rate. Poles and monuments are a handful per chunk, so they use ordinary meshes.
 */

import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import RAPIER from '@dimforge/rapier3d-compat';

import { hash01 } from '../core/rng';
import { SURFACES, SurfaceType } from '../core/surfaces';
import { monumentsBetween, poleConditionAt, poleEraSegments } from './gradient';

import type { Monument, PoleEra } from './gradient';
import { HazardIndex } from './hazards';
import { ROAD_HALF_WIDTH, type Road } from './road';
import type { Terrain } from './terrain';
import type { ChunkContext, ChunkContent, ChunkProvider } from './chunks';

// ---------------------------------------------------------------------------
// Tuning constants
// ---------------------------------------------------------------------------

// Scatter. Cell grid is in the road's local (arclength, lateral) frame, so it
// follows the road rather than a world-aligned lattice and the road never cuts
// through a cell.
const TAG_SCATTER = 0x5ca17e2;
const TAG_ROAD_PILE = 0x6a5a41;
const TAG_ROAD_ROCK = 0x6a5a52;
/** Each independent stream varies every consecutive gap inside this exact range. */
const ROAD_HAZARD_GAP_MIN = 1800;
const ROAD_HAZARD_GAP_MAX = 4200;
/**
 * Two complementary gaps fill one cycle. If the first is `d`, the second is
 * `min + max - d`, so both stay in range while any chunk can locate them directly.
 */
const ROAD_HAZARD_CYCLE = ROAD_HAZARD_GAP_MIN + ROAD_HAZARD_GAP_MAX;
/** Keep the homestead and the player's first few bends clear. */
const ROAD_HAZARD_START = 600;
const ROAD_HAZARD_EDGE_CLEARANCE = 0.15;
const CELL_S = 6; // metres between candidate cells along the road
const CELL_L = 6; // metres between candidate cells laterally
const MIN_LAT = 9; // props stay off the corridor + gravel verge (~8.2 m)
/**
 * Lateral reach of the scatter, and where it starts thinning out.
 *
 * This was 42 m — "close enough to the road to actually be seen" — and the result was
 * a hedge. Six hundred metres of driveable desert either side, and everything standing
 * in it stood in the first seven percent of it, so leaving the road meant leaving the
 * furniture behind and driving across a bare plain.
 *
 * Two things had to be fixed before the band could be widened, and neither was the
 * band. Props were placed at `Terrain.heightAt`, which is the height FIELD; past the
 * tight rings near the road the drawn mesh chords that field by metres, so a boulder
 * at 200 m would have hovered or buried itself. They now stand on `drawnGroundY`, the
 * mesh's own surface. And every candidate cell paid two road projections (12 us) before
 * its occupancy roll was even looked at, which is what made 578 cells cost 6.5 ms; the
 * roll is a hash, so it goes first and 90% of cells now cost nothing but that hash.
 *
 * `MAX_LAT` stops just inside `PHYSICS_LATERAL`: past that edge there is no collider,
 * and a rock you can drive through is worse than no rock. The taper from `FULL_LAT`
 * exists so the far edge is not a second hedge — a line of props running the length of
 * the world at a fixed distance reads as a fence.
 */
const FULL_LAT = 300;
const MAX_LAT = 560;
/**
 * Roadside scatter is deliberately denser than the open tile field, but no longer
 * saturates the whole 1.1 km strip. Four times fewer candidates preserves occasional
 * rock fields and cacti while the player-centred tiles carry sparse landmarks forever.
 */
const ROCK_DENSITY = 0.045;
const CACTUS_DENSITY = 0.009;
const ROCK_COLLIDER_MIN = 0.55; // pebbles under this radius (m) get no collider

// Poles run along the RIGHT-hand side of the road facing away from the house, as
// specified. `Road.offsetPoint` treats positive lateral as LEFT of travel (see its
// comment: the sign is load-bearing for road/terrain triangle winding), so the
// right-hand side is a negative offset.
const TAG_POLE = 0x90f1e2;
const POLE_LATERAL = -6.0;
const POLE_HEIGHT: Record<PoleEra, number> = {
  timber: 6.5,
  lattice: 8.5,
  concrete: 9.0,
  none: 0,
};
const WIRE_RADIUS = 0.012; // thin enough to read as a wire, thick enough to resolve
// Lamps: every working fixture shares one emissive material. Three lightweight
// source markers per chunk describe nearby real fixtures; LightBudget turns the
// nearest six markers into the only six rendered PointLights.
const LAMP_COLOR = 0xffc37a;
const LAMP_DISTANCE = 46;
// Brighter warm pools at full night. The renderer keeps only six real lights.
const LAMP_POINT = 90;
const LAMP_EMISSIVE = 2.8;
/**
 * How far the concrete lamp arm reaches from its pole, metres. The poles stand at
 * POLE_LATERAL = -6 and the shoulder's outer edge is at -4.7, so 2.4 hangs the
 * head at lateral -3.6: over the gravel, a foot short of the asphalt edge, which
 * is where the light pool wants to sit to cover the near lane.
 */
const LAMP_ARM_REACH = 2.4;

// Signs.
const SIGN_WIDTH = 2.4;
const SIGN_HEIGHT = 0.9;
const SIGN_CENTRE_Y = 1.9; // sign centre height above the ground

// ---------------------------------------------------------------------------
// Shared materials (never disposed; they live for the whole session)
// ---------------------------------------------------------------------------

// Desert palette. Two deliberate departures from the obvious choice:
//
//  - Boulders are sandstone, not the grey-brown of `SURFACES[Rock]`. Sharing the
//    ground's albedo made every scattered rock read as a chip of the surface it
//    happened to sit on — grey litter — instead of warm mass catching the same low
//    sun as the dunes. It is intentionally warmer than gravel (0x7a6c56) and darker
//    than sand (0xbf9f6b), so a boulder reads against both.
//  - Only the saguaro is green, and barely: a desiccated sage rather than leaf. The
//    barrel form gets its own dry khaki, because at 0.8-1.7 scale it is a low round
//    blob, and in green it reads as a lawn shrub that wandered into the desert.
const matCactus = new THREE.MeshStandardMaterial({ color: 0x6d7d5c, roughness: 0.95, metalness: 0 });
const matScrub = new THREE.MeshStandardMaterial({ color: 0xab8a55, roughness: 1.0, metalness: 0 });
const matDeadStick = new THREE.MeshStandardMaterial({ color: 0x8a7a5c, roughness: 1.0, metalness: 0 });
const matRock = new THREE.MeshStandardMaterial({
  color: 0x815f42,
  roughness: 0.98,
  metalness: 0,
});
const matTimber = new THREE.MeshStandardMaterial({ color: 0x2f251c, roughness: 0.9, metalness: 0 });
const matLattice = new THREE.MeshStandardMaterial({ color: 0x55555c, roughness: 0.55, metalness: 0.65 });
const matConcrete = new THREE.MeshStandardMaterial({
  color: SURFACES[SurfaceType.Concrete].color,
  roughness: 0.85,
  metalness: 0,
});
const matWire = new THREE.MeshStandardMaterial({ color: 0x242424, roughness: 0.5, metalness: 0.4 });
const matLampLit = new THREE.MeshStandardMaterial({
  color: 0x2a2a2a,
  roughness: 0.4,
  metalness: 0.1,
  emissive: LAMP_COLOR,
  emissiveIntensity: 0,
});

let lampEmissiveIntensity = -1;

function setLampEmission(on: number): void {
  const intensity = on * LAMP_EMISSIVE;
  if (lampEmissiveIntensity === intensity) return;
  lampEmissiveIntensity = intensity;
  matLampLit.emissiveIntensity = intensity;
}
const matLampDead = new THREE.MeshStandardMaterial({ color: 0x3a3835, roughness: 0.6, metalness: 0.2 });
const matChrome = new THREE.MeshStandardMaterial({
  color: 0xd8d8d8,
  roughness: 0.15,
  metalness: 0.95,
  emissive: 0x202020,
  emissiveIntensity: 0.6,
});
const matSignPost = new THREE.MeshStandardMaterial({ color: 0x5a5a5e, roughness: 0.7, metalness: 0.4 });
const matRust = new THREE.MeshStandardMaterial({ color: 0x6b4a32, roughness: 0.85, metalness: 0.25 });

// ---------------------------------------------------------------------------
// Scratch objects reused across the per-chunk build loops (never per-frame).
// ---------------------------------------------------------------------------

const _dummy = new THREE.Object3D();
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _euler = new THREE.Euler();
let _hullPoints = new Float32Array(0);
const _axis = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3();

// ===========================================================================
// Scatter: cacti and rocks
// ===========================================================================

interface PropForm {
  /** Stable name: the debris field keys its piece geometries off this. */
  readonly id: string;
  geometry: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
  /** Approximate radius (m) of the form at scale 1, for sinking and collision. */
  baseRadius: number;
  /** Vertical span (m) at scale 1, for capsule colliders. */
  height: number;
  collider: 'capsule' | 'box' | 'hull' | 'none';
  /** Box half-extents at scale 1, in the form's own frame. Required by `box`. */
  readonly colliderHalf?: readonly [number, number, number];
  /** Fraction of `baseRadius` the form is planted below the surface. */
  sink: number;
  rotate3d: boolean;
  minScale: number;
  maxScale: number;
}
export type DesertPropForm = PropForm;


function deformIcosahedron(seed: number, squashY: number): THREE.BufferGeometry {
  // IcosahedronGeometry duplicates vertices along face/UV seams. Deforming those
  // copies independently pulled adjacent triangles apart into literal holes, so weld
  // the closed shell first and then move each shared vertex exactly once.
  const source = new THREE.IcosahedronGeometry(1, 1);
  source.deleteAttribute('normal');
  source.deleteAttribute('uv');
  const geo = mergeVertices(source);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const arr = pos.array as Float32Array;
  for (let i = 0; i < pos.count; i++) {
    const ix = i * 3;
    const len = Math.hypot(arr[ix], arr[ix + 1], arr[ix + 2]) || 1;
    const r = 0.78 + hash01(seed, i) * 0.4;
    arr[ix] = (arr[ix] / len) * r;
    arr[ix + 1] = (arr[ix + 1] / len) * r * squashY;
    arr[ix + 2] = (arr[ix + 2] / len) * r;
  }
  geo.computeVertexNormals();
  return geo;
}

function buildSaguaro(): THREE.BufferGeometry {
  const trunk = new THREE.CylinderGeometry(0.16, 0.22, 2.6, 8, 1);
  trunk.translate(0, 1.3, 0);
  const arm = (radius: number, length: number) => new THREE.CylinderGeometry(radius, radius, length, 7, 1);

  // Right arm: a short horizontal stub then a vertical riser, the classic shape.
  const rStub = arm(0.075, 0.45);
  rStub.rotateZ(Math.PI / 2);
  rStub.translate(0.42, 1.5, 0);
  const rRise = arm(0.07, 0.85);
  rRise.translate(0.62, 1.92, 0);

  // Left arm, higher, mirrored to the far side.
  const lStub = arm(0.075, 0.45);
  lStub.rotateZ(Math.PI / 2);
  lStub.rotateY(Math.PI);
  lStub.translate(-0.42, 1.75, 0);
  const lRise = arm(0.07, 0.9);
  lRise.translate(-0.62, 2.17, 0);

  return mergeGeometries([trunk, rStub, rRise, lStub, lRise]);
}

function buildBarrel(): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(0.34, 1);
  geo.scale(1, 0.8, 1);
  return geo;
}

function buildDeadStick(): THREE.BufferGeometry {
  const trunk = new THREE.CylinderGeometry(0.025, 0.06, 1.7, 5, 1);
  trunk.translate(0, 0.85, 0);
  trunk.rotateZ(0.1);

  // The branch grows out of the leaned trunk at y ~= 1.32. Its old centre was
  // eighteen centimetres too far right, leaving a visible air gap at the joint.
  const branch = new THREE.CylinderGeometry(0.014, 0.025, 0.5, 4, 1);
  branch.rotateZ(-(Math.PI / 2 - 0.4));
  branch.translate(0.1, 1.42, 0);
  return mergeGeometries([trunk, branch]);
}

/**
 * A fallen trunk: two tapered lengths meeting at a slight kink, with one stub branch.
 *
 * The desert needed something HORIZONTAL. Everything else in the scatter is a vertical
 * or a lump, and over 600 m of ground that reads as a field of posts and pebbles; a log
 * lying across the sand is the one silhouette that gives the eye a direction and the
 * wheels something to climb rather than something to hit.
 */
function buildFallenTrunk(): THREE.BufferGeometry {
  const butt = new THREE.CylinderGeometry(0.19, 0.24, 1.7, 6, 1);
  butt.rotateZ(Math.PI / 2);
  butt.translate(-0.8, 0.22, 0);
  const tip = new THREE.CylinderGeometry(0.1, 0.19, 1.6, 6, 1);
  tip.rotateZ(Math.PI / 2);
  tip.rotateY(0.28);
  tip.translate(0.75, 0.19, 0.22);
  const stub = new THREE.CylinderGeometry(0.05, 0.07, 0.6, 5, 1);
  stub.rotateZ(0.5);
  stub.translate(-0.2, 0.5, -0.1);
  return mergeGeometries([butt, tip, stub]);
}

/** A low scrub bush: three squashed lumps, so it clusters rather than domes. */
function buildScrub(): THREE.BufferGeometry {
  const lump = (r: number, x: number, y: number, z: number): THREE.BufferGeometry => {
    const g = new THREE.IcosahedronGeometry(r, 0);
    g.scale(1, 0.65, 1);
    g.translate(x, y, z);
    return g;
  };
  return mergeGeometries([lump(0.34, 0, 0.22, 0), lump(0.24, 0.28, 0.15, 0.1), lump(0.2, -0.2, 0.14, -0.22)]);
}

let _scrubForm: PropForm | null = null;
function scrubForm(): PropForm {
  _scrubForm ??= {
    id: 'scrub',
    geometry: buildScrub(),
    material: matScrub,
    baseRadius: 0.42,
    height: 0.45,
    collider: 'capsule',
    sink: 0.3,
    rotate3d: false,
    minScale: 0.7,
    maxScale: 1.6,
  };
  return _scrubForm;
}

let _trunkForm: PropForm | null = null;
function trunkForm(): PropForm {
  _trunkForm ??= {
    id: 'trunk',
    geometry: buildFallenTrunk(),
    material: matDeadStick,
    baseRadius: 0.42,
    height: 0.5,
    collider: 'box',
    colliderHalf: [1.55, 0.45, 0.28],
    sink: 0.25,
    rotate3d: false,
    minScale: 0.8,
    maxScale: 1.45,
  };
  return _trunkForm;
}

let _sandForms: PropForm[] | null = null;
function sandForms(): PropForm[] {
  if (!_sandForms) {
    _sandForms = [
      { id: 'saguaro', geometry: buildSaguaro(), material: matCactus, baseRadius: 0.24, height: 2.6, collider: 'capsule', sink: 0, rotate3d: false, minScale: 0.75, maxScale: 1.35 },
      { id: 'barrel', geometry: buildBarrel(), material: matScrub, baseRadius: 0.34, height: 0.55, collider: 'capsule', sink: 0.18, rotate3d: false, minScale: 0.8, maxScale: 1.7 },
      { id: 'deadstick', geometry: buildDeadStick(), material: matDeadStick, baseRadius: 0.06, height: 1.8, collider: 'capsule', sink: 0, rotate3d: false, minScale: 0.7, maxScale: 1.5 },
      trunkForm(),
      scrubForm(),
    ];
  }
  return _sandForms;
}

let _rockForms: PropForm[] | null = null;
function rockForms(): PropForm[] {
  if (!_rockForms) {
    _rockForms = [
      { id: 'boulder', geometry: deformIcosahedron(0x00b1, 1.0), material: matRock, baseRadius: 1, height: 2, collider: 'hull', sink: 0.28, rotate3d: true, minScale: 0.4, maxScale: 1.6 },
      { id: 'boulderlow', geometry: deformIcosahedron(0x00b2, 0.55), material: matRock, baseRadius: 1, height: 1.1, collider: 'hull', sink: 0.28, rotate3d: true, minScale: 0.4, maxScale: 1.6 },
      { id: 'bouldertall', geometry: deformIcosahedron(0x00b3, 1.5), material: matRock, baseRadius: 1, height: 3, collider: 'hull', sink: 0.28, rotate3d: true, minScale: 0.4, maxScale: 1.6 },
      { id: 'slab', geometry: deformIcosahedron(0x00b4, 0.26), material: matRock, baseRadius: 1, height: 0.52, collider: 'hull', sink: 0.3, rotate3d: true, minScale: 0.5, maxScale: 1.9 },
    ];
  }
  return _rockForms;
}
/** Shared visual/collision forms for deterministic world-space desert scatter. */
export function desertPropForms(surface: SurfaceType): readonly DesertPropForm[] {
  return surface === SurfaceType.Rock ? rockForms() : sandForms();
}


/**
 * A PIECE of a prop that comes apart: geometry, where it sits in the whole, and what
 * it weighs.
 *
 * The pieces are not a decomposition of the prop's merged geometry — nothing here
 * cuts a mesh at runtime. They are the SAME primitives the whole was built from, cut
 * along the joints a real one would break at, each re-centred on its own origin so a
 * rigid body can rotate about its middle instead of about the plant's foot. A saguaro
 * is a trunk in three lifts and two arms, which is how they actually fail.
 *
 * Masses are deliberately not botanical. A real saguaro that size is most of a tonne,
 * and a tonne of anything stops a car dead; these are set so the car walks through and
 * the pieces leave properly, which is the whole point of breaking them.
 */
export interface PropPiece {
  readonly geometry: THREE.BufferGeometry;
  readonly material: THREE.MeshStandardMaterial;
  /** Position in the form's own frame at scale 1. */
  readonly offset: readonly [number, number, number];
  /** Capsule collider at scale 1: half height, then radius. */
  readonly capsule: readonly [number, number];
  readonly mass: number;
}

function armPiece(mirror: number): THREE.BufferGeometry {
  const stub = new THREE.CylinderGeometry(0.075, 0.075, 0.45, 6, 1);
  stub.rotateZ(Math.PI / 2);
  stub.translate(-0.2 * mirror, -0.22, 0);
  const rise = new THREE.CylinderGeometry(0.07, 0.07, 0.86, 6, 1);
  rise.translate(0, 0.2, 0);
  return mergeGeometries([stub, rise]);
}

let _pieces: Record<string, readonly PropPiece[]> | null = null;

/** Pieces for a form that comes apart, or null for one that does not. */
export function propPieces(formId: string): readonly PropPiece[] | null {
  if (!_pieces) {
    const lump = (r: number, squashY = 0.8): THREE.BufferGeometry => {
      const g = new THREE.IcosahedronGeometry(r, 0);
      g.scale(1, squashY, 1);
      return g;
    };
    _pieces = {
      saguaro: [
        { geometry: new THREE.CylinderGeometry(0.2, 0.225, 0.85, 8, 1), material: matCactus, offset: [0, 0.425, 0], capsule: [0.42, 0.21], mass: 26 },
        { geometry: new THREE.CylinderGeometry(0.18, 0.2, 0.9, 8, 1), material: matCactus, offset: [0, 1.3, 0], capsule: [0.45, 0.19], mass: 19 },
        { geometry: new THREE.CylinderGeometry(0.155, 0.18, 0.85, 8, 1), material: matCactus, offset: [0, 2.175, 0], capsule: [0.42, 0.17], mass: 15 },
        { geometry: armPiece(1), material: matCactus, offset: [0.62, 1.72, 0], capsule: [0.43, 0.09], mass: 7 },
        { geometry: armPiece(-1), material: matCactus, offset: [-0.62, 1.97, 0], capsule: [0.45, 0.09], mass: 7 },
      ],
      barrel: [
        { geometry: lump(0.19), material: matScrub, offset: [0.1, 0.12, 0.05], capsule: [0.06, 0.16], mass: 4 },
        { geometry: lump(0.17), material: matScrub, offset: [-0.12, 0.14, -0.08], capsule: [0.05, 0.14], mass: 3 },
        { geometry: lump(0.15), material: matScrub, offset: [0.02, 0.3, -0.1], capsule: [0.05, 0.13], mass: 3 },
      ],
      scrub: [
        { geometry: lump(0.34, 0.65), material: matScrub, offset: [0, 0.22, 0], capsule: [0.07, 0.28], mass: 4 },
        { geometry: lump(0.24, 0.65), material: matScrub, offset: [0.28, 0.15, 0.1], capsule: [0.05, 0.2], mass: 2 },
        { geometry: lump(0.2, 0.65), material: matScrub, offset: [-0.2, 0.14, -0.22], capsule: [0.04, 0.17], mass: 2 },
      ],
    };
  }
  return _pieces[formId] ?? null;
}

/**
 * One standing prop that can be knocked to pieces, as handed to whoever owns the
 * breaking. Absolute coordinates, because that is what a save and a debris body both
 * want; the origin subtraction happens at the body.
 */
export interface BreakableProp {
  /** Stable seed-derived identity: positive desert cell or negative road slot. */
  readonly id: number;
  readonly pieces: readonly PropPiece[];
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly scale: number;
  /** Radius (m) of the standing prop, for the impact test. */
  readonly radius: number;
  /** Height (m) of the standing prop, for the impact test. */
  readonly height: number;
  /** The instance to blank, and the collider to switch off, when it goes. */
  readonly mesh: THREE.InstancedMesh;
  readonly instance: number;
  readonly collider: RAPIER.Collider;
}

/**
 * Whoever owns breaking. Structural on purpose: `world/props.ts` describes scenery
 * and must not depend on the debris field that animates it.
 */
export interface BreakableSink {
  /** True if this prop is already down, so the chunk must not draw it standing. */
  isBroken(id: number): boolean;
  register(prop: BreakableProp): void;
  /** Called when the chunk holding these goes away. */
  forget(ids: readonly number[]): void;
}

/**
 * Identity of a scatter cell, packed into one integer so it can live in a save's
 * number array exactly like `lootedPois` does.
 *
 * `cl` spans a couple of hundred either side of nothing, so it is biased into the low
 * byte and `cs` — which reaches seven million over a forty-thousand-kilometre road —
 * takes the rest. The product stays far inside the exact-integer range of a double.
 */
export function propCellId(cs: number, cl: number): number {
  return cs * 512 + (cl + 256);
}

interface ScatterPlacement {
  form: PropForm;
  /** Stable prop identity; only meaningful for a form that can break. */
  id: number;
  x: number;
  y: number;
  z: number;
  rx: number;
  ry: number;
  rz: number;
  scale: number;
  /** Road-frame coordinates for an asphalt obstacle; zero for ordinary scatter. */
  roadS: number;
  roadLateral: number;
  /** True only for the deterministic obstacle streams placed on asphalt. */
  roadHazard: boolean;
  radius: number;
  /** Filled in by the instancing pass, so a break can blank the right instance. */
  mesh: THREE.InstancedMesh | null;
  instance: number;
}

type Rot = { x: number; y: number; z: number; w: number };

function yawRotation(yaw: number): Rot {
  return { x: 0, y: Math.sin(yaw * 0.5), z: 0, w: Math.cos(yaw * 0.5) };
}

function leanRotation(angle: number, az: number): Rot {
  _q1.setFromAxisAngle(_axis.set(Math.cos(az), 0, -Math.sin(az)), angle);
  return { x: _q1.x, y: _q1.y, z: _q1.z, w: _q1.w };
}

function eulerRotation(rx: number, ry: number, rz: number): Rot {
  _q1.setFromEuler(_euler.set(rx, ry, rz));
  return { x: _q1.x, y: _q1.y, z: _q1.z, w: _q1.w };
}

/**
 * Builds a convex collider from the same local-space vertices as the visible rock.
 * The scratch buffer is safe to reuse because `addStatic` creates the Rapier shape
 * synchronously before the next placement is visited.
 */
function scaledHull(geometry: THREE.BufferGeometry, scale: number): RAPIER.ColliderDesc {
  const position = geometry.getAttribute('position');
  const length = position.count * 3;
  if (_hullPoints.length !== length) _hullPoints = new Float32Array(length);
  for (let i = 0; i < position.count; i++) {
    const j = i * 3;
    _hullPoints[j] = position.getX(i) * scale;
    _hullPoints[j + 1] = position.getY(i) * scale;
    _hullPoints[j + 2] = position.getZ(i) * scale;
  }
  const desc = RAPIER.ColliderDesc.convexHull(_hullPoints);
  if (!desc) throw new Error('Rock geometry did not produce a convex hull collider');
  return desc;
}

/**
 * Creates a static collider (own fixed body) and registers its surface.
 *
 * The one choke point for every scatter, pole and monument collider. Every caller
 * passes an ABSOLUTE position (the road/terrain sample it was placed from); the
 * origin subtraction happens here, once, so no caller can forget it and Rapier
 * never holds an f32 quantised by an absolute coordinate.
 *
 * Returns a DISABLED collider: `ChunkStreamer.attachContent` switches on everything
 * in `ChunkContent.colliders` when the contribution lands. Poles and monuments were
 * silently non-solid for exactly as long as that was each provider's own job.
 */
function addStatic(
  ctx: ChunkContext,
  bodies: RAPIER.RigidBody[],
  colliders: RAPIER.Collider[],
  x: number,
  y: number,
  z: number,
  desc: RAPIER.ColliderDesc,
  surface: SurfaceType,
  rot?: Rot,
): RAPIER.Collider {
  const body = ctx.physics.world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(x - ctx.originX, y, z - ctx.originZ),
  );
  if (rot) desc.setRotation(rot);
  const collider = ctx.physics.world.createCollider(desc, body);
  collider.setEnabled(false);
  ctx.physics.surfaces.register(collider.handle, surface);
  bodies.push(body);
  colliders.push(collider);
  return collider;
}

export class ScatterProvider implements ChunkProvider {
  readonly id = 'scatter';

  /**
   * Whoever owns knocking props down, or nothing. Optional because deterministic
   * scatter remains a complete visual field without mutable breakage state.
   */
  constructor(
    private readonly breakables?: BreakableSink,
    private readonly hazards?: HazardIndex,
  ) {
    const forms = [...sandForms(), ...rockForms()];
    for (const form of forms) propPieces(form.id);
  }

  build(ctx: ChunkContext): ChunkContent {
    const iterator = this.buildSteps(ctx);
    let result = iterator.next();
    while (!result.done) result = iterator.next();
    return result.value;
  }

  *buildSteps(ctx: ChunkContext): Iterator<void, ChunkContent> {
    let completed = false;
    const group = new THREE.Group();
    const bodies: RAPIER.RigidBody[] = [];
    const colliders: RAPIER.Collider[] = [];
    const meshes: THREE.InstancedMesh[] = [];
    const hazardChunkKey = `scatter:${ctx.chunkIndex}`;
    const placements: ScatterPlacement[] = [];
    const registered: number[] = [];

    try {
    const seed = ctx.world.seed;
    const ox = ctx.originX;
    const oz = ctx.originZ;
    const cellSStart = Math.floor(ctx.sStart / CELL_S);
    const cellSEnd = Math.floor(ctx.sEnd / CELL_S);
    const cellLMax = Math.ceil(MAX_LAT / CELL_L) + 1;
    let occupancyCells = 0;

    for (let cs = cellSStart; cs <= cellSEnd; cs++) {
      const centreS = (cs + 0.5) * CELL_S;
      if (centreS < ctx.sStart || centreS >= ctx.sEnd) continue;
      for (let cl = -cellLMax; cl <= cellLMax; cl++) {
        cell: {
          // CHEAPEST TEST FIRST, and that ordering is the whole reason this can afford
          // to sweep 600 m either side. The occupancy roll is one hash; the terrain
          // samples below are hundreds of times more expensive. Rolling first throws
          // away nine cells in ten before either is touched.
          const roll = hash01(seed, TAG_SCATTER, cs, cl);
          if (roll >= ROCK_DENSITY) break cell;

          const centreL = (cl + 0.5) * CELL_L;
          if (Math.abs(centreL) < MIN_LAT) break cell;

          // Jitter within the cell, then re-check the corridor/max bounds.
          const s = centreS + (hash01(seed, TAG_SCATTER, cs, cl, 1) - 0.5) * CELL_S;
          const lateral = centreL + (hash01(seed, TAG_SCATTER, cs, cl, 2) - 0.5) * CELL_L;
          const absLateral = Math.abs(lateral);
          if (absLateral < MIN_LAT || absLateral > MAX_LAT) break cell;

          // Thin out towards the far edge so the scatter ends in a fringe rather than a
          // fence line. Still only arithmetic: no sampling yet.
          const t = Math.min(1, Math.max(0, (absLateral - FULL_LAT) / (MAX_LAT - FULL_LAT)));
          const fade = 1 - t * t * (3 - 2 * t);
          if (roll >= ROCK_DENSITY * fade) break cell;

          const p = ctx.road.offsetPoint(s, lateral);
          // From the FRAME, not by projection: this cell was generated from (s, lateral),
          // so `surfaceAt`'s road search would spend 5 us rediscovering what the loop
          // counter already knows.
          const surface = ctx.terrain.surfaceFromFrame(p.x, p.z, lateral);

          // Correlation: cacti and scrub on sand, rocks concentrated on rock outcrops.
          let forms: PropForm[];
          let density: number;
          if (surface === SurfaceType.Rock) {
            forms = rockForms();
            density = ROCK_DENSITY;
          } else if (surface === SurfaceType.Sand) {
            forms = sandForms();
            density = CACTUS_DENSITY;
          } else {
            break cell;
          }
          if (roll >= density * fade) break cell;

          const form = forms[Math.floor(hash01(seed, TAG_SCATTER, cs, cl, 3) * forms.length)]!;

          // A prop already knocked down stays down. Same guard `lootedPois` is for a
          // looted stop: the chunk is rebuilt every time it crosses the physics radius,
          // and without this every rebuild would stand the cactus back up.
          const id = propCellId(cs, cl);
          if (propPieces(form.id) && this.breakables?.isBroken(id)) break cell;

          const scale = form.minScale + hash01(seed, TAG_SCATTER, cs, cl, 4) * (form.maxScale - form.minScale);
          const radius = form.baseRadius * scale;

          const ry = hash01(seed, TAG_SCATTER, cs, cl, 5) * Math.PI * 2;
          const rx = form.rotate3d ? hash01(seed, TAG_SCATTER, cs, cl, 6) * Math.PI * 2 : 0;
          const rz = form.rotate3d ? hash01(seed, TAG_SCATTER, cs, cl, 7) * Math.PI * 2 : 0;

          // The player-centred fine lattice samples this exact world-space field. The
          // road frame is already known here, so no nearest-road search is needed.
          const groundY = ctx.terrain.explorationHeightFromFrame(p.x, p.z, lateral, s);
          placements.push({
            form,
            id,
            x: p.x,
            y: groundY - radius * form.sink,
            z: p.z,
            rx,
            ry,
            rz,
            scale,
            roadS: 0,
            roadLateral: 0,
            radius,
            mesh: null,
            roadHazard: false,
            instance: 0,
          });
        }
        if (++occupancyCells >= 8) {
          occupancyCells = 0;
          yield;
        }
      }
      if (occupancyCells > 0) {
        occupancyCells = 0;
        yield;
      }
    }

    // Dirt piles, fallen trunks and solid rocks have independent deterministic
    // streams. Complementary gaps keep hazards irregular without walking every
    // previous placement to locate an arbitrary streamed chunk.
    for (let kind = 0; kind < 2; kind++) {
      const tag = kind === 0 ? TAG_ROAD_PILE : TAG_ROAD_ROCK;
      const streamStart =
        ROAD_HAZARD_START + hash01(seed, tag, 0x51a47) * ROAD_HAZARD_GAP_MAX;
      const cycleStart = Math.max(0, Math.floor((ctx.sStart - streamStart) / ROAD_HAZARD_CYCLE) - 1);
      const cycleEnd = Math.floor((ctx.sEnd - streamStart) / ROAD_HAZARD_CYCLE) + 1;

      for (let cycle = cycleStart; cycle <= cycleEnd; cycle++) {
        const firstGap =
          ROAD_HAZARD_GAP_MIN +
          hash01(seed, tag, cycle, 0) * (ROAD_HAZARD_GAP_MAX - ROAD_HAZARD_GAP_MIN);
        for (let ordinal = 0; ordinal < 2; ordinal++) {
          const s = streamStart + cycle * ROAD_HAZARD_CYCLE + (ordinal === 0 ? 0 : firstGap);
          if (s < ctx.sStart || s >= ctx.sEnd) continue;
          const candidate = cycle * 2 + ordinal;
          let form: PropForm;

          if (kind === 0) {
            // Most piles are low scrub; the occasional fallen trunk is the serious,
            // visible trajectory choice that can unload a wheel or trip a car.
            form = hash01(seed, tag, candidate, 7) < 0.22 ? trunkForm() : scrubForm();
          } else {
            const rocks = rockForms();
            form = rocks[Math.floor(hash01(seed, tag, candidate, 1) * rocks.length)]!;
          }

          const scaleRoll = hash01(seed, tag, candidate, 2);
          const scale = kind === 0 ? 0.9 + scaleRoll * 0.6 : 0.65 + scaleRoll * 0.7;
          const radius = form.baseRadius * scale;
          const lateralReach = Math.max(0, ROAD_HALF_WIDTH - radius - ROAD_HAZARD_EDGE_CLEARANCE);
          const lateral = (hash01(seed, tag, candidate, 3) * 2 - 1) * lateralReach;
          const p = ctx.road.offsetPoint(s, lateral);
          const ry = hash01(seed, tag, candidate, 4) * Math.PI * 2;
          const rx = form.rotate3d ? hash01(seed, tag, candidate, 5) * Math.PI * 2 : 0;
          const rz = form.rotate3d ? hash01(seed, tag, candidate, 6) * Math.PI * 2 : 0;
          // Even/odd negative ids keep the two streams disjoint from each other and
          // from every positive desert-cell id.
          const id = -1 - candidate * 2 - kind;
          if (propPieces(form.id) && this.breakables?.isBroken(id)) continue;
          const groundY = ctx.terrain.heightFromFrame(p.x, p.z, lateral, s);
          placements.push({
            form,
            id,
            x: p.x,
            y: groundY - radius * form.sink,
            z: p.z,
            rx,
            ry,
            rz,
            scale,
            roadS: s,
            roadLateral: lateral,
            radius,
            roadHazard: true,
            mesh: null,
            instance: 0,
          });
        }
      }
      yield;
    }

    // One InstancedMesh per form per chunk. The form geometry/material is shared
    // across chunks; only the instance buffers are per-chunk.
    const byForm = new Map<PropForm, ScatterPlacement[]>();
    for (const pl of placements) {
      let list = byForm.get(pl.form);
      if (!list) {
        list = [];
        byForm.set(pl.form, list);
      }
      list.push(pl);
    }
    for (const [form, list] of byForm) {
      const mesh = new THREE.InstancedMesh(form.geometry, form.material, list.length);
      // Instances sit up to a chunk radius from the mesh's own origin, so three's
      // geometry bounding-sphere cull would pop; disable it.
      mesh.frustumCulled = false;
      for (let i = 0; i < list.length; i++) {
        const pl = list[i]!;
        _dummy.position.set(pl.x - ox, pl.y, pl.z - oz);
        _dummy.rotation.set(pl.rx, pl.ry, pl.rz);
        _dummy.scale.setScalar(pl.scale);
        _dummy.updateMatrix();
        mesh.setMatrixAt(i, _dummy.matrix);
        pl.mesh = mesh;
        pl.instance = i;
      }
      mesh.instanceMatrix.needsUpdate = true;
      group.add(mesh);
      meshes.push(mesh);
      yield;
    }

    if (ctx.hasPhysics) {
      for (const pl of placements) {
        const form = pl.form;
        let hazardRadius = 0;
        let breakable = false;
        if (form.collider !== 'none' && !(form.collider === 'hull' && pl.radius < ROCK_COLLIDER_MIN)) {
          if (form.collider === 'hull') {
            addStatic(
              ctx,
              bodies,
              colliders,
              pl.x,
              pl.y,
              pl.z,
              scaledHull(form.geometry, pl.scale),
              SurfaceType.Rock,
              eulerRotation(pl.rx, pl.ry, pl.rz),
            );
            // The hull is constructed from these vertices, so its scaled bounding sphere
            // is a conservative radius of the collision shape, not a placement guess.
            form.geometry.computeBoundingSphere();
            hazardRadius = (form.geometry.boundingSphere?.radius ?? 0) * pl.scale;
          } else if (form.collider === 'box') {
            if (!form.colliderHalf) throw new Error(`Box collider extents missing for ${form.id}`);
            const [hx, hy, hz] = form.colliderHalf;
            addStatic(
              ctx,
              bodies,
              colliders,
              pl.x,
              pl.y + hy * pl.scale,
              pl.z,
              RAPIER.ColliderDesc.cuboid(hx * pl.scale, hy * pl.scale, hz * pl.scale),
              SurfaceType.Rock,
              yawRotation(pl.ry),
            );
            hazardRadius = Math.hypot(hx, hz) * pl.scale;
          } else {
            const halfHeight = form.height * pl.scale * 0.42;
            const rad = form.baseRadius * pl.scale * 0.8;
            const collider = addStatic(
              ctx,
              bodies,
              colliders,
              pl.x,
              pl.y + halfHeight,
              pl.z,
              RAPIER.ColliderDesc.capsule(halfHeight, rad),
              SurfaceType.Rock,
            );
            hazardRadius = rad;
            const pieces = propPieces(form.id);
            breakable = pieces !== null;
            if (pieces && this.breakables && pl.mesh) {
              registered.push(pl.id);
              this.breakables.register({
                id: pl.id,
                pieces,
                x: pl.x,
                y: pl.y,
                z: pl.z,
                yaw: pl.ry,
                scale: pl.scale,
                radius: rad,
                height: form.height * pl.scale,
                mesh: pl.mesh,
                instance: pl.instance,
                collider,
              });
            }
          }
        }
        if (pl.roadHazard && hazardRadius > 0) {
          this.hazards?.add(hazardChunkKey, {
            s: pl.roadS,
            lateral: pl.roadLateral,
            radius: hazardRadius,
            breakable,
          });
        }
        yield;
      }
    }

    // Colliders are created disabled and switched on by ChunkStreamer once this
    // contribution is attached, after every mesh and breakable registration exists
    // (see ChunkContent.colliders).
    completed = true;
    return {
      group,
      bodies,
      colliders,
      dispose: () => {
        for (const m of meshes) m.dispose();
        if (registered.length > 0) this.breakables?.forget(registered);
        this.hazards?.forget(hazardChunkKey);
      },
    };
  } finally {
    if (!completed) {
      for (const body of bodies) ctx.physics.removeBody(body);
      for (const m of meshes) m.dispose();
      if (registered.length > 0) this.breakables?.forget(registered);
      this.hazards?.forget(hazardChunkKey);
      group.clear();
    }
  }

}
}

// ===========================================================================
// Poles: the roadside lamppost line
// ===========================================================================

/** s of the pole at a given global index, or null past the last pole. */
function poleSByIndex(index: number): number | null {
  let remaining = index;
  for (const seg of poleEraSegments()) {
    const count = seg.spacing > 0 ? Math.floor((seg.end - seg.start) / seg.spacing) : 0;
    if (remaining < count) return seg.start + (remaining + 0.5) * seg.spacing;
    remaining -= count;
  }
  return null;
}

const POLE_EPS = 1e-6;
/** Invokes cb(s, index) for every pole whose arclength lies in [sStart, sEnd). */
function forEachPole(sStart: number, sEnd: number, cb: (s: number, index: number) => void): void {
  let indexBase = 0;
  for (const seg of poleEraSegments()) {
    const count = seg.spacing > 0 ? Math.floor((seg.end - seg.start) / seg.spacing) : 0;
    if (seg.end <= sStart) {
      indexBase += count;
      continue;
    }
    if (seg.start >= sEnd) break;
    if (seg.spacing > 0) {
      const from = Math.max(seg.start, sStart);
      const to = Math.min(seg.end, sEnd);
      const k0 = Math.max(0, Math.ceil((from - seg.start) / seg.spacing - 0.5 - POLE_EPS));
      const k1 = Math.min(count - 1, Math.floor((to - seg.start) / seg.spacing - 0.5 + POLE_EPS));
      for (let k = k0; k <= k1; k++) {
        cb(seg.start + (k + 0.5) * seg.spacing, indexBase + k);
      }
    }
    indexBase += count;
  }
}

interface PolePose {
  index: number;
  s: number;
  era: PoleEra;
  baseX: number;
  baseY: number;
  baseZ: number;
  topX: number;
  topY: number;
  topZ: number;
  lampX: number;
  lampY: number;
  lampZ: number;
  hasLamp: boolean;
  lampWorks: boolean;
  twist: number;
  leanAz: number;
  leanAngle: number;
  collapsed: boolean;
  hasCrossarm: boolean;
  hasWire: boolean;
  height: number;
}

/**
 * Timber-era lamp head, hung from an outrigger under the road-side crossarm tip.
 * X = 2.1 puts the head at lateral -3.9 from a pole at POLE_LATERAL = -6: right at
 * the asphalt edge (-3.3 plus the paint), which is the only way a 6 m mast with an
 * inverse-square falloff actually lights the near lane rather than the gravel.
 */
const TIMBER_LAMP_LOCAL: readonly [number, number, number] = [2.1, 5.95, 0];

/**
 * Local (un-rotated) position of the lamp head for an era, or null if it has none.
 *
 * +X is LEFT of travel and the poles stand right of the road, so a positive X
 * reaches over the carriageway. The concrete arm reaches `LAMP_ARM_REACH` from a
 * pole at POLE_LATERAL = -6, leaving the head just inside the shoulder edge —
 * where a real streetlight hangs — so its pool of light lands on the asphalt.
 */
function lampLocal(era: PoleEra, hasCrossarm: boolean): [number, number, number] | null {
  if (era === 'timber') {
    return hasCrossarm ? [TIMBER_LAMP_LOCAL[0], TIMBER_LAMP_LOCAL[1], TIMBER_LAMP_LOCAL[2]] : null;
  }
  if (era === 'concrete') return [LAMP_ARM_REACH, 8.2, 0];
  return null;
}

function leanOffset(height: number, angle: number, az: number): { x: number; y: number; z: number } {
  _q1.setFromAxisAngle(_axis.set(Math.cos(az), 0, -Math.sin(az)), angle);
  _v.set(0, height, 0).applyQuaternion(_q1);
  return { x: _v.x, y: _v.y, z: _v.z };
}

function applyPoleRotation(lx: number, ly: number, lz: number, twist: number, angle: number, az: number): { x: number; y: number; z: number } {
  _q2.setFromAxisAngle(_up, twist);
  _q1.setFromAxisAngle(_axis.set(Math.cos(az), 0, -Math.sin(az)), angle);
  _q1.multiply(_q2);
  _v.set(lx, ly, lz).applyQuaternion(_q1);
  return { x: _v.x, y: _v.y, z: _v.z };
}

function poleQuaternion(twist: number, angle: number, az: number, out: THREE.Quaternion): void {
  _q2.setFromAxisAngle(_up, twist);
  _q1.setFromAxisAngle(_axis.set(Math.cos(az), 0, -Math.sin(az)), angle);
  _q1.multiply(_q2);
  out.copy(_q1);
}

/** Pure, chunk-independent description of the pole at global index `index`. */
function describePole(road: Road, terrain: Terrain, seed: number, s: number, index: number): PolePose {
  const cond = poleConditionAt(s);
  const sample = road.sampleAt(s);
  const p = road.offsetPoint(s, POLE_LATERAL);
  const groundY = terrain.heightAt(p.x, p.z, s);

  const h1 = hash01(seed, TAG_POLE, index, 0);
  const h2 = hash01(seed, TAG_POLE, index, 1);
  const h3 = hash01(seed, TAG_POLE, index, 2);
  const h4 = hash01(seed, TAG_POLE, index, 3);
  const h5 = hash01(seed, TAG_POLE, index, 4);
  const h6 = hash01(seed, TAG_POLE, index, 5);
  const h7 = hash01(seed, TAG_POLE, index, 6);

  const height = POLE_HEIGHT[cond.era];
  const d = cond.dilapidation;

  const leanAz = h1 * Math.PI * 2;
  // High dilapidation eventually tips a pole right over, leaving it in the sand.
  const collapsed = d > 0.72 && h2 < ((d - 0.72) / 0.28) * 0.9;
  const leanAngle = collapsed ? Math.PI * 0.5 : d * 0.42 * (0.5 + h3);

  // `twist` spins the pole about +Y so its local axes follow the road: rotating by
  // the heading maps local +X onto (cos h, 0, -sin h), which is `offsetPoint`'s
  // LEFT-of-travel normal. Everything mounted on an arm therefore uses positive X
  // to lean over the road (see `lampLocal`).
  const jitter = (h4 - 0.5) * 0.14;
  const twist = sample.heading + (cond.era === 'lattice' ? Math.PI * 0.25 : 0) + jitter;

  const hasCrossarm = cond.era === 'timber' ? !collapsed && h5 > d * 0.8 : true;
  const lampWorks = h6 < cond.lampChance;
  const hasWire = h7 < cond.wireChance;

  const top = leanOffset(height, leanAngle, leanAz);

  const ll = !collapsed ? lampLocal(cond.era, hasCrossarm) : null;
  const hasLamp = ll !== null;
  let lampX = 0;
  let lampY = 0;
  let lampZ = 0;
  if (ll) {
    const w = applyPoleRotation(ll[0], ll[1], ll[2], twist, leanAngle, leanAz);
    lampX = p.x + w.x;
    lampY = groundY + w.y;
    lampZ = p.z + w.z;
  }

  return {
    index,
    s,
    era: cond.era,
    baseX: p.x,
    baseY: groundY,
    baseZ: p.z,
    topX: p.x + top.x,
    topY: groundY + top.y,
    topZ: p.z + top.z,
    lampX,
    lampY,
    lampZ,
    hasLamp,
    lampWorks,
    twist,
    leanAz,
    leanAngle,
    collapsed,
    hasCrossarm,
    hasWire,
    height,
  };
}

// --- Pole silhouette geometries (shared) ------------------------------------

function cylinderBetween(a: THREE.Vector3, b: THREE.Vector3, radius: number, radialSegments: number): THREE.CylinderGeometry {
  const dir = new THREE.Vector3().subVectors(b, a);
  const length = dir.length();
  const geo = new THREE.CylinderGeometry(radius, radius, length, radialSegments, 1, true);
  const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
  geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()));
  geo.translate(mid.x, mid.y, mid.z);
  return geo;
}

let _timberShaft: THREE.BufferGeometry | null = null;
function timberShaft(): THREE.BufferGeometry {
  if (!_timberShaft) _timberShaft = new THREE.CylinderGeometry(0.09, 0.16, 6.5, 7, 1).translate(0, 3.25, 0);
  return _timberShaft;
}

let _timberCrossarm: THREE.BufferGeometry | null = null;
function timberCrossarm(): THREE.BufferGeometry {
  if (!_timberCrossarm) {
    const arm = new THREE.CylinderGeometry(0.06, 0.06, 1.7, 6, 1);
    arm.rotateZ(Math.PI / 2);
    arm.translate(0, 6.1, 0);
    const ins1 = new THREE.CylinderGeometry(0.04, 0.05, 0.18, 5, 1).translate(-0.5, 6.24, 0);
    const ins2 = new THREE.CylinderGeometry(0.04, 0.05, 0.18, 5, 1).translate(0.5, 6.24, 0);
    // Outrigger + drop bracket carrying the lamp head out over the carriageway.
    // +X is the road side (see `lampLocal`); the crossarm alone only reaches 0.85,
    // which left the head above the gravel, so the pool of light missed the lane
    // it exists to light. The outrigger takes it to TIMBER_LAMP_LOCAL[0].
    const outrigger = cylinderBetween(
      new THREE.Vector3(0.8, 6.08, 0),
      new THREE.Vector3(TIMBER_LAMP_LOCAL[0], 5.95, 0),
      0.04,
      5,
    );
    const drop = new THREE.CylinderGeometry(0.035, 0.035, 0.42, 5, 1).translate(
      TIMBER_LAMP_LOCAL[0],
      TIMBER_LAMP_LOCAL[1] + 0.21,
      0,
    );
    _timberCrossarm = mergeGeometries([arm, ins1, ins2, outrigger, drop]);
  }
  return _timberCrossarm;
}

let _latticeMast: THREE.BufferGeometry | null = null;
function latticeMast(): THREE.BufferGeometry {
  if (!_latticeMast) {
    const H = 8.5;
    const baseHalf = 0.5;
    const topHalf = 0.16;
    const corners: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    const parts: THREE.BufferGeometry[] = [];
    for (const [sx, sz] of corners) {
      parts.push(cylinderBetween(
        new THREE.Vector3(sx * baseHalf, 0, sz * baseHalf),
        new THREE.Vector3(sx * topHalf, H, sz * topHalf),
        0.045,
        5,
      ));
    }
    for (let level = 1; level <= 3; level++) {
      const t = level / 4;
      const y = H * t;
      const half = baseHalf + (topHalf - baseHalf) * t;
      for (let i = 0; i < 4; i++) {
        const [ax, az] = corners[i];
        const [bx, bz] = corners[(i + 1) % 4];
        parts.push(cylinderBetween(
          new THREE.Vector3(ax * half, y, az * half),
          new THREE.Vector3(bx * half, y, bz * half),
          0.028,
          4,
        ));
      }
    }
    const cap = new THREE.CylinderGeometry(0.02, 0.08, 0.5, 5, 1).translate(0, H - 0.25, 0);
    parts.push(cap);
    _latticeMast = mergeGeometries(parts);
  }
  return _latticeMast;
}

let _concreteColumn: THREE.BufferGeometry | null = null;
function concreteColumn(): THREE.BufferGeometry {
  if (!_concreteColumn) {
    const col = new THREE.CylinderGeometry(0.12, 0.3, 9.0, 10, 1).translate(0, 4.5, 0);
    // Curved lamp arm sweeping out toward the road and down to the lamp head.
    // Local +X is LEFT of travel (see `applyPoleRotation`); the pole line stands
    // to the RIGHT of the road at POLE_LATERAL, so the arm must reach along +X to
    // hang its head over the carriageway. It used to sweep to -X, which put every
    // lamp on the desert side and lit the sand instead of the asphalt.
    const curve = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(0, 8.8, 0),
      new THREE.Vector3(0.9, 8.95, 0),
      new THREE.Vector3(LAMP_ARM_REACH, 8.2, 0),
    );
    const arm = new THREE.TubeGeometry(curve, 12, 0.06, 6, false);
    _concreteColumn = mergeGeometries([col, arm]);
  }
  return _concreteColumn;
}

let _lampBulb: THREE.BufferGeometry | null = null;
function lampBulb(): THREE.BufferGeometry {
  if (!_lampBulb) _lampBulb = new THREE.SphereGeometry(0.13, 10, 8);
  return _lampBulb;
}

function addPoleMeshes(poleGroup: THREE.Group, pose: PolePose): void {
  switch (pose.era) {
    case 'timber':
      poleGroup.add(new THREE.Mesh(timberShaft(), matTimber));
      if (pose.hasCrossarm) poleGroup.add(new THREE.Mesh(timberCrossarm(), matTimber));
      break;
    case 'lattice':
      poleGroup.add(new THREE.Mesh(latticeMast(), matLattice));
      break;
    case 'concrete':
      poleGroup.add(new THREE.Mesh(concreteColumn(), matConcrete));
      break;
    case 'none':
      return;
  }
  if (pose.hasLamp) {
    const ll = lampLocal(pose.era, pose.hasCrossarm);
    if (ll) {
      const bulb = new THREE.Mesh(lampBulb(), pose.lampWorks ? matLampLit : matLampDead);
      bulb.position.set(ll[0], ll[1], ll[2]);
      poleGroup.add(bulb);
    }
  }
}

/** A cosh-based catenary: zero sag at the ends, deepest in the middle. */
class CatenaryCurve extends THREE.Curve<THREE.Vector3> {
  constructor(
    private readonly a: THREE.Vector3,
    private readonly b: THREE.Vector3,
    private readonly sag: number,
  ) {
    super();
  }

  override getPoint(t: number, optionalTarget = new THREE.Vector3()): THREE.Vector3 {
    const k = 3.0;
    const shape = (Math.cosh(k * (t - 0.5)) - Math.cosh(k * 0.5)) / (1 - Math.cosh(k * 0.5));
    return optionalTarget.set(
      this.a.x + (this.b.x - this.a.x) * t,
      this.a.y + (this.b.y - this.a.y) * t - this.sag * shape,
      this.a.z + (this.b.z - this.a.z) * t,
    );
  }
}

type LampPos = { x: number; y: number; z: number };

function setLampSource(light: THREE.PointLight, pos: LampPos | null, on: number): void {
  const intensity = pos ? on * LAMP_POINT : 0;
  if (light.intensity !== intensity) light.intensity = intensity;
  if (pos && (light.position.x !== pos.x || light.position.y !== pos.y || light.position.z !== pos.z)) {
    light.position.set(pos.x, pos.y, pos.z);
  }
}

/**
 * Selects source fixtures without allocating during the render loop.
 *
 * `points` are stored relative to this chunk's build origin (`ox`/`oz`), while
 * `nearX`/`nearZ` is the live camera in the CURRENT origin's frame. The build
 * origin is added back to each point so both sides of the comparison are
 * absolute. A rebase moves the camera and the current origin together, but the
 * stored entries stay put: they must NOT become `Rebasable`, or the group shift
 * and a rebase would double-apply. The build origin already accounts for it.
 */
function setNearestLampSources(
  points: readonly LampPos[],
  nearX: number,
  nearZ: number,
  ox: number,
  oz: number,
  on: number,
  sources: readonly THREE.PointLight[],
): void {
  let first: LampPos | null = null;
  let second: LampPos | null = null;
  let third: LampPos | null = null;
  let firstD = Infinity;
  let secondD = Infinity;
  let thirdD = Infinity;
  for (const point of points) {
    const dx = point.x + ox - nearX;
    const dz = point.z + oz - nearZ;
    const d = dx * dx + dz * dz;
    if (d < firstD) {
      third = second; thirdD = secondD;
      second = first; secondD = firstD;
      first = point; firstD = d;
    } else if (d < secondD) {
      third = second; thirdD = secondD;
      second = point; secondD = d;
    } else if (d < thirdD) {
      third = point; thirdD = d;
    }
  }
  setLampSource(sources[0], first, on);
  setLampSource(sources[1], second, on);
  setLampSource(sources[2], third, on);
}

export class PoleProvider implements ChunkProvider {
  readonly id = 'poles';

  build(ctx: ChunkContext): ChunkContent {
    const group = new THREE.Group();
    const bodies: RAPIER.RigidBody[] = [];
    const colliders: RAPIER.Collider[] = [];
    const wireGeos: THREE.BufferGeometry[] = [];
    const workingLamps: LampPos[] = [];
    const poses: PolePose[] = [];

    const seed = ctx.world.seed;
    const ox = ctx.originX;
    const oz = ctx.originZ;

    forEachPole(ctx.sStart, ctx.sEnd, (s, index) => {
      const pose = describePole(ctx.road, ctx.terrain, seed, s, index);
      poses.push(pose);

      const poleGroup = new THREE.Group();
      poleGroup.position.set(pose.baseX - ox, pose.baseY - (pose.collapsed ? 0.12 : 0), pose.baseZ - oz);
      poleQuaternion(pose.twist, pose.leanAngle, pose.leanAz, poleGroup.quaternion);
      addPoleMeshes(poleGroup, pose);
      group.add(poleGroup);

      if (pose.hasLamp && pose.lampWorks) {
        // Lamps are stored relative to the chunk origin: these positions also set
        // the invisible source-marker PointLights (children of `group`), so they
        // must be group-local. The distance test against the camera re-adds the
        // captured build origin in `setLamps` (see `setNearestLampSources`).
        workingLamps.push({ x: pose.lampX - ox, y: pose.lampY, z: pose.lampZ - oz });
      }

      // Upright poles are solid obstacles; collapsed ones lie flat and are skipped.
      if (ctx.hasPhysics && !pose.collapsed) {
        // The collider leans with the pole so a dilapidated mast is solid where
        // it visually is, not where it would have stood when new.
        const mid = leanOffset(pose.height * 0.5, pose.leanAngle, pose.leanAz);
        const halfHeight = pose.height * 0.45;
        addStatic(
          ctx,
          bodies,
          colliders,
          pose.baseX + mid.x,
          pose.baseY + mid.y,
          pose.baseZ + mid.z,
          RAPIER.ColliderDesc.capsule(halfHeight, 0.14),
          SurfaceType.Concrete,
          leanRotation(pose.leanAngle, pose.leanAz),
        );
      }
    });

    // Wires. The span may land in the next chunk, so its far end is recomputed
    // from the same pure function rather than read from a neighbour's content —
    // otherwise spans would flicker as chunks load around the boundary.
    for (const pose of poses) {
      if (!pose.hasWire || pose.collapsed) continue;
      const nextS = poleSByIndex(pose.index + 1);
      if (nextS === null) continue;
      if (poleConditionAt(nextS).era !== pose.era) continue; // no span across era boundary
      const nextPose = describePole(ctx.road, ctx.terrain, seed, nextS, pose.index + 1);
      if (nextPose.collapsed) continue;
      const a = new THREE.Vector3(pose.topX - ox, pose.topY, pose.topZ - oz);
      const b = new THREE.Vector3(nextPose.topX - ox, nextPose.topY, nextPose.topZ - oz);
      const wireGeo = new THREE.TubeGeometry(
        new CatenaryCurve(a, b, a.distanceTo(b) * 0.03),
        20,
        WIRE_RADIUS,
        4,
        false,
      );
      wireGeos.push(wireGeo);
      group.add(new THREE.Mesh(wireGeo, matWire));
    }

    const lampSources = [
      new THREE.PointLight(LAMP_COLOR, 0, LAMP_DISTANCE, 2),
      new THREE.PointLight(LAMP_COLOR, 0, LAMP_DISTANCE, 2),
      new THREE.PointLight(LAMP_COLOR, 0, LAMP_DISTANCE, 2),
    ];
    for (const source of lampSources) {
      // These are data sources for LightBudget, not renderer lights. Keeping them
      // invisible prevents chunk streaming from changing Three's point-light shader.
      source.visible = false;
      source.userData.lightBudgetSource = true;
      group.add(source);
    }

    return {
      group,
      bodies,
      colliders,
      dispose: () => {
        for (const g of wireGeos) g.dispose();
        for (const source of lampSources) source.dispose();
      },
      /**
       * Emissive fixtures are cheap at any distance; the provider only updates its
       * three nearest source markers. LightBudget owns the six rendered light slots.
       *
       * `nearX`/`nearZ` is ABSOLUTE (the live camera in the current origin's
       * frame); the build origin `ox`/`oz` captured at build time bridges it to the
       * build-origin-relative `workingLamps` below.
       */
      setLamps(on: number, nearX: number, nearZ: number): void {
        setLampEmission(on);
        setNearestLampSources(workingLamps, nearX, nearZ, ox, oz, on, lampSources);
      },
    };
  }
}

// ===========================================================================
// Monuments
// ===========================================================================

/** Renders text to an offscreen canvas; no font files, no external assets. */
function makeSignTexture(
  text: string,
  width: number,
  height: number,
  bg: string,
  fg: string,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);
    const border = Math.max(3, Math.round(width * 0.012));
    ctx.strokeStyle = fg;
    ctx.lineWidth = border;
    ctx.strokeRect(border, border, width - border * 2, height - border * 2);
    ctx.fillStyle = fg;
    ctx.font = `bold ${Math.round(height * 0.42)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, width * 0.5, height * 0.5);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

type Disposable = { dispose(): void };

// Shared monument geometries (never disposed).
const unitIcosaGeo = new THREE.IcosahedronGeometry(1, 1);
const shrinePostGeo = new THREE.CylinderGeometry(0.12, 0.16, 1.5, 8, 1).translate(0, 0.75, 0);
const wreckPostGeo = new THREE.CylinderGeometry(0.08, 0.1, 1.6, 6, 1).translate(0, 0.8, 0);
const ornamentGeos: readonly THREE.BufferGeometry[] = [
  new THREE.SphereGeometry(0.09, 10, 8),
  new THREE.TorusGeometry(0.08, 0.03, 8, 14),
  new THREE.ConeGeometry(0.07, 0.18, 6),
  new THREE.BoxGeometry(0.14, 0.05, 0.1),
];

interface MonumentBuild {
  ctx: ChunkContext;
  group: THREE.Group;
  bodies: RAPIER.RigidBody[];
  colliders: RAPIER.Collider[];
  disposables: Disposable[];
  m: Monument;
  x: number;
  y: number;
  z: number;
  heading: number;
}

function buildDistanceSign(b: MonumentBuild): void {
  const ox = b.ctx.originX;
  const oz = b.ctx.originZ;
  const g = new THREE.Group();
  g.position.set(b.x - ox, b.y, b.z - oz);
  g.rotation.y = b.heading + Math.PI; // face oncoming traffic

  const tex = makeSignTexture(b.m.text, 1024, 384, '#0b5c30', '#ffffff');
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, metalness: 0.1 });
  b.disposables.push(tex, mat);

  const signGeo = new THREE.PlaneGeometry(SIGN_WIDTH, SIGN_HEIGHT);
  b.disposables.push(signGeo);
  const sign = new THREE.Mesh(signGeo, mat);
  sign.position.y = SIGN_CENTRE_Y;
  g.add(sign);

  const postH = SIGN_CENTRE_Y - SIGN_HEIGHT * 0.5;
  const postGeo = new THREE.BoxGeometry(0.09, postH, 0.09);
  b.disposables.push(postGeo);
  for (const sx of [-SIGN_WIDTH * 0.45, SIGN_WIDTH * 0.45]) {
    const post = new THREE.Mesh(postGeo, matSignPost);
    post.position.set(sx, postH * 0.5, 0);
    g.add(post);
  }
  b.group.add(g);

  if (b.ctx.hasPhysics) {
    addStatic(
      b.ctx, b.bodies, b.colliders, b.x, b.y + SIGN_CENTRE_Y, b.z,
      RAPIER.ColliderDesc.cuboid(SIGN_WIDTH * 0.5, SIGN_HEIGHT * 0.5, 0.08),
      SurfaceType.Concrete,
      yawRotation(b.heading + Math.PI),
    );
  }
}

function buildShrine(b: MonumentBuild): void {
  const ox = b.ctx.originX;
  const oz = b.ctx.originZ;
  const g = new THREE.Group();
  g.position.set(b.x - ox, b.y, b.z - oz);
  g.rotation.y = hash01(b.m.variantSeed, 0) * Math.PI * 2;

  g.add(new THREE.Mesh(shrinePostGeo, matTimber));

  // Hood ornaments and badges others left behind: small chrome shapes.
  const count = 3 + Math.floor(hash01(b.m.variantSeed, 1) * 3);
  for (let i = 0; i < count; i++) {
    const orn = new THREE.Mesh(
      ornamentGeos[Math.floor(hash01(b.m.variantSeed, i + 2) * ornamentGeos.length)],
      matChrome,
    );
    const ang = (i / count) * Math.PI * 2 + hash01(b.m.variantSeed, i + 10) * 0.7;
    const rad = 0.16 + hash01(b.m.variantSeed, i + 20) * 0.22;
    orn.position.set(Math.cos(ang) * rad, 1.42 + hash01(b.m.variantSeed, i + 30) * 0.2, Math.sin(ang) * rad);
    orn.rotation.set(
      hash01(b.m.variantSeed, i + 40) * Math.PI,
      hash01(b.m.variantSeed, i + 50) * Math.PI * 2,
      hash01(b.m.variantSeed, i + 60) * Math.PI,
    );
    orn.scale.setScalar(0.7 + hash01(b.m.variantSeed, i + 70) * 0.9);
    g.add(orn);
  }
  b.group.add(g);

  if (b.ctx.hasPhysics) {
    addStatic(b.ctx, b.bodies, b.colliders, b.x, b.y + 0.72, b.z, RAPIER.ColliderDesc.capsule(0.72, 0.16), SurfaceType.Concrete);
  }
}

function buildCairn(b: MonumentBuild): void {
  const ox = b.ctx.originX;
  const oz = b.ctx.originZ;
  const g = new THREE.Group();
  g.position.set(b.x - ox, b.y, b.z - oz);
  g.rotation.y = hash01(b.m.variantSeed, 0) * Math.PI * 2;

  // A deliberate stack of balanced stones: regular, flattened, decreasing.
  const count = 4 + Math.floor(hash01(b.m.variantSeed, 1) * 2);
  let top = 0;
  for (let i = 0; i < count; i++) {
    const t = i / Math.max(1, count - 1);
    const r = (0.52 - t * 0.3) * (0.85 + hash01(b.m.variantSeed, i + 2) * 0.3);
    const stone = new THREE.Mesh(unitIcosaGeo, matRock);
    stone.scale.set(r, r * 0.52, r);
    stone.rotation.set(
      hash01(b.m.variantSeed, i + 10) * 0.5,
      hash01(b.m.variantSeed, i + 20) * Math.PI * 2,
      hash01(b.m.variantSeed, i + 30) * 0.5,
    );
    stone.position.set(
      (hash01(b.m.variantSeed, i + 40) - 0.5) * r * 0.5,
      top + r * 0.52,
      (hash01(b.m.variantSeed, i + 50) - 0.5) * r * 0.5,
    );
    top += r * 0.52 * 2 * 0.8;
    g.add(stone);
  }
  b.group.add(g);

  if (b.ctx.hasPhysics) {
    const halfH = top * 0.5 + 0.2;
    addStatic(b.ctx, b.bodies, b.colliders, b.x, b.y + halfH, b.z, RAPIER.ColliderDesc.cuboid(0.55, halfH, 0.55), SurfaceType.Rock);
  }
}

function buildWrecked(b: MonumentBuild): void {
  const ox = b.ctx.originX;
  const oz = b.ctx.originZ;
  const g = new THREE.Group();
  g.position.set(b.x - ox, b.y, b.z - oz);
  g.rotation.y = b.heading + Math.PI + (hash01(b.m.variantSeed, 0) - 0.5) * 0.6;

  // Snapped lower stub, still planted.
  const stub = new THREE.Mesh(wreckPostGeo, matSignPost);
  stub.position.set(0, 0.45, 0);
  stub.rotation.z = 0.12 + hash01(b.m.variantSeed, 1) * 0.25;
  stub.rotation.x = (hash01(b.m.variantSeed, 2) - 0.5) * 0.2;
  g.add(stub);

  // Upper section snapped clean off and lying in the sand.
  const upper = new THREE.Mesh(wreckPostGeo, matSignPost);
  upper.position.set(0.5 + hash01(b.m.variantSeed, 3) * 0.5, 0.1, 0.2 + hash01(b.m.variantSeed, 4) * 0.4);
  upper.rotation.set(0, hash01(b.m.variantSeed, 5) * Math.PI, Math.PI * 0.5 - 0.15);
  g.add(upper);

  // Bent sign panel — no text survives a wreck.
  const panelGeo = new THREE.PlaneGeometry(SIGN_WIDTH * 0.9, SIGN_HEIGHT * 0.9);
  b.disposables.push(panelGeo);
  const panel = new THREE.Mesh(panelGeo, matRust);
  panel.position.set(-0.3, 0.7, 0.1);
  panel.rotation.set(0.6, 0.3, -1.2);
  g.add(panel);

  // Debris.
  for (let i = 0; i < 3; i++) {
    const d = new THREE.Mesh(unitIcosaGeo, matRock);
    const r = 0.12 + hash01(b.m.variantSeed, i + 20) * 0.14;
    d.scale.setScalar(r);
    d.position.set((hash01(b.m.variantSeed, i + 30) - 0.5) * 1.6, r * 0.4, (hash01(b.m.variantSeed, i + 40) - 0.5) * 1.6);
    d.rotation.set(
      hash01(b.m.variantSeed, i + 50) * Math.PI,
      hash01(b.m.variantSeed, i + 60) * Math.PI * 2,
      hash01(b.m.variantSeed, i + 70) * Math.PI,
    );
    g.add(d);
  }
  b.group.add(g);

  if (b.ctx.hasPhysics) {
    addStatic(b.ctx, b.bodies, b.colliders, b.x, b.y + 0.5, b.z, RAPIER.ColliderDesc.cuboid(0.6, 0.5, 0.6), SurfaceType.Concrete);
  }
}

export class MonumentProvider implements ChunkProvider {
  readonly id = 'monuments';

  build(ctx: ChunkContext): ChunkContent {
    const group = new THREE.Group();
    const bodies: RAPIER.RigidBody[] = [];
    const colliders: RAPIER.Collider[] = [];
    const disposables: Disposable[] = [];

    // Personal-record markers were a tall white obelisk with an inset plaque. They
    // cluttered a resumed save exactly where the player stopped, so the builder and
    // the monument kind are both gone: distance reached is recorded on the car, in
    // stickers earned by hauling.
    const monuments = monumentsBetween(ctx.world.seed, ctx.sStart, ctx.sEnd);

    for (const m of monuments) {
      // Round monuments sit exactly on 20 km boundaries, which are also chunk
      // boundaries (100 chunks), so `monumentsBetween`'s inclusive upper bound
      // would build them twice; half-open dedupe fixes that.
      if (m.s < ctx.sStart || m.s >= ctx.sEnd) continue;
      const p = ctx.road.offsetPoint(m.s, m.lateral);
      const groundY = ctx.terrain.heightAt(p.x, p.z, m.s);
      const heading = ctx.road.sampleAt(m.s).heading;
      const b: MonumentBuild = { ctx, group, bodies, colliders, disposables, m, x: p.x, y: groundY, z: p.z, heading };

      switch (m.kind) {
        case 'distance_sign':
          buildDistanceSign(b);
          break;
        case 'ornament_shrine':
          buildShrine(b);
          break;
        case 'cairn':
          buildCairn(b);
          break;
        case 'wrecked_marker':
          buildWrecked(b);
          break;
      }
    }

    return {
      group,
      bodies,
      colliders,
      dispose: () => {
        for (const d of disposables) d.dispose();
      },
    };
  }
}
