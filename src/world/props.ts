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
import { maxAnisotropy } from '../render/texturequality';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import RAPIER from '@dimforge/rapier3d-compat';

import { hash01 } from '../core/rng';
import { SURFACES, SurfaceType } from '../core/surfaces';
import { monumentsBetween, poleConditionAt, poleEraSegments } from './gradient';
import {
  varietyEventOfKindAt,
  varietyEventsBetween,
  type VarietyEvent,
} from './director';

import type { Monument, PoleCondition, PoleEra } from './gradient';
import { HazardIndex } from './hazards';
import { ROAD_HALF_WIDTH, type Road } from './road';
import type { Terrain } from './terrain';
import { drawnGroundY } from './terrainmesh';
import type { RoadDistance } from './roaddistance';
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
/**
 * Nearest a scattered prop stands to the ASPHALT EDGE, metres: clear of the 3.5 m
 * gravel verge with room to spare. Authored as a setback for the same reason the
 * pole line is — a fixed 9 m from the crown is 9 m of clearance on a narrow road and
 * 3.2 m on a widened one, which puts cacti on the verge and boulders at the paint.
 */
const SCATTER_SETBACK_M = 6.1;
/** Cheap pre-filter: the setback at the NARROWEST the road ever is. */
const MIN_LAT = ROAD_HALF_WIDTH + SCATTER_SETBACK_M;
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
/**
 * MEASURED FROM THE ASPHALT EDGE, NOT FROM THE CROWN.
 *
 * The line used to stand at a fixed -6 m, which was the edge plus 3.1 m while every
 * road was 5.8 m wide. On a widened stretch (`roadprofile.ts`) that put the poles
 * 0.2 m off the paint and the lamp arms over the outer lane. Real poles keep their
 * distance from the road they light, so the setback is what is authored and the
 * lateral is derived — which also means the whole line sweeps out and back through
 * a taper exactly as the carriageway does.
 */
const POLE_SETBACK_M = 3.1;
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
 * poles stand `POLE_SETBACK_M` = 3.1 m outside the asphalt edge and the gravel verge
 * is 3.5 m wide, so 2.4 hangs the head 0.7 m outside that edge: over the gravel,
 * which is where the light pool wants to sit to cover the near lane. The reach is a
 * constant because the setback is: the head keeps its 0.7 m at any road width.
 */
const LAMP_ARM_REACH = 2.4;

// Signs.
const SIGN_WIDTH = 2.4;
const SIGN_HEIGHT = 0.9;
const SIGN_CENTRE_Y = 1.9; // sign centre height above the ground

// Delineators: the reflector-post runs the variety director schedules (kind
// 'delineators' in `world/director.ts`). A run is 400-1200 m of road, so the posts
// are the one thing on this list that arrives as a RUN rather than as an object.
const TAG_DELINEATOR = 0xde11a7;
/**
 * MEASURED FROM THE ASPHALT EDGE, like every other setback in this file.
 *
 * 1.2 m is where a delineator belongs: far enough out that a wheel tracking the
 * paint cannot clip one, close enough in that the run reads as edge marking rather
 * than as a fence line retreating into the desert. It also lands the whole run
 * inside the 3.5 m loose verge and nowhere near the 3.1 m pole line, so a post and
 * a mast never fight for the same ground. Perched birds use 0.7-2.4 m of the same
 * shoulder (`agents/birds.ts`); a post is 12 cm wide and carries no collider, so the
 * two share the band the way a bird and a fence post share a fence post.
 */
export const DELINEATOR_SETBACK_M = 1.2;
/**
 * Station spacing, metres. Every consecutive gap lands in this exact range: the
 * gaps are drawn per station rather than fixed, because a perfectly even run reads
 * as a texture and an uneven one reads as something somebody installed.
 */
export const DELINEATOR_GAP_MIN = 40;
export const DELINEATOR_GAP_MAX = 60;
/** Post height, metres: knee-high plus a little, the height of the real article. */
export const DELINEATOR_HEIGHT = 1.05;
/** Width of the face that carries the reflector. */
const DELINEATOR_FACE_W = 0.12;
/** Planted this deep, so no post shows daylight under it on a rippled verge. */
export const DELINEATOR_EMBED = 0.03;
/**
 * Reflector centre height. A saloon's headlamps sit near 0.7 m and the beam rises
 * as it goes, so a reflector at 0.82 m is inside the hot part of the beam at the
 * distance the run matters — a hundred metres ahead, where it draws the curve.
 */
const DELINEATOR_REFLECTOR_Y = 0.82;
/**
 * What `event.draw` buys. Below the first figure the run is posted on BOTH sides
 * (the avenue), below the second it alternates sides (the cheap installation), above
 * it stays on the event's own side. Three layouts, because one layout over 1.2 km is
 * a fence and the player learns to stop seeing it.
 */
const DELINEATOR_BOTH_SIDES = 0.34;
const DELINEATOR_ALTERNATING = 0.67;
/**
 * Radians the post's face is canted in toward the carriageway. A reflector square to
 * the road returns light to a driver who is already past it; the cant turns it back
 * up the road toward the headlights that are still coming.
 */
const DELINEATOR_CANT = 0.26;
/** Yaw jitter, radians: these are hammered in from the back of a truck, not surveyed. */
const DELINEATOR_YAW_JITTER = 0.1;
/**
 * Base of the delineator id band, and why it is a band of its own.
 *
 * A breakable's id is its identity in `state.flattenedProps`, which is a number array
 * in every save: two props sharing one id means knocking down a post also erases some
 * cactus three deserts away. The scatter's road obstacles use small negatives
 * (`-1 - candidate * 2 - kind`) and the desert uses packed positive cells, so the
 * delineators take a reserved negative band far above both — 2^24 is 16.7 million, an
 * exact integer in a double and about six times the widest the road-obstacle stream
 * can ever count to.
 */
const DELINEATOR_ID_BASE = 1 << 24;
/** Slots reserved per run, so the band cannot collide with itself. A run is under 30. */
const DELINEATOR_ID_SLOTS = 256;

/** Stable identity of one post: the run's window, its station, and which side it is on. */
function delineatorId(window: number, ordinal: number, side: -1 | 1): number {
  return -(DELINEATOR_ID_BASE + window * DELINEATOR_ID_SLOTS + ordinal * 2 + (side > 0 ? 1 : 0));
}
/**
 * Emissive intensity of a reflector at full night. It is NOT a light: the light
 * budget is six real PointLights for the whole world (see `LightBudget` in main.ts)
 * and a kilometre of posts would eat it twice over. An emissive chip that comes up
 * over the same dusk ramp as the lamps is what makes the run read as an avenue.
 */
const REFLECTOR_EMISSIVE = 2.6;

// Pole anomalies: the 2-4 consecutive poles the director's 'poleAnomaly' event turns
// into something other than a pole standing there. These are a LOCAL OVERRIDE of the
// era's own pole — same index, same station, same era — and never a second line.
const TAG_POLE_ANOMALY = 0x90f1a9;
const ANOMALY_RUN_MIN = 2;
const ANOMALY_RUN_MAX = 4;
/**
 * Lean of a pole that is DOWN, radians. 1.46 is 84 degrees: the butt is still in its
 * hole and the mast is in the sand, with the tip a few tens of centimetres up, which
 * is what a pulled-over pole looks like. A right angle instead buried the tip.
 */
const DOWN_ANGLE = 1.46;
/** Spread of the fall direction, radians, about straight out into the desert. */
const DOWN_AZ_JITTER = 0.9;
/**
 * THE DERELICT: what a 'poleAnomaly' event leaves where there is no pole line at all.
 *
 * About one era band in four has no poles (`poleEraForBand` in gradient.ts), and an
 * override has nothing to override there — so a quarter of the events on this kind
 * used to schedule a change and produce nothing, which makes the director's cadence a
 * lie. Measured at 151 of 602 events over 6000 km before this existed.
 *
 * The fix is NOT a ghost pole in the line. Pole form comes from
 * `hash(seed, TAG_POLE, index)` over ONE global running index, so inserting a station
 * anywhere renumbers every pole after it and rewrites the roadside for the remaining
 * forty thousand kilometres. A derelict is therefore a discrete object at the event's
 * own arclength that borrows the neighbouring era's silhouette: the remnant of a line
 * nobody maintained, which is exactly what an empty band is the aftermath of.
 */
const TAG_DERELICT = 0x90f1d3;
/** Half-buried: the mast is in the sand, not lying on top of it. */
export const DERELICT_SINK_M = 0.28;
/**
 * 1.52 radians is 87 degrees — flatter than a fallen pole of the LIVE line, which is
 * still in its hole at 84. This one snapped at the base decades ago and settled.
 */
const DERELICT_FALL_ANGLE = 1.52;
/** Metres along the road to the second remnant, and the roll above which it exists. */
const DERELICT_STUMP_GAP = 40;
const DERELICT_STUMP_CHANCE = 0.35;
const DERELICT_STUMP_HEIGHT = 0.85;
/** Sag as a fraction of the span: a live span, and one hanging off a fallen pole. */
const WIRE_SAG_TAUT = 0.03;
const WIRE_SAG_SLACK = 0.14;
/** Fraction of the chord's own clearance over the ground the sag may ever spend. */
const WIRE_SAG_CLEARANCE = 0.55;

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
//  - The saguaro is the one green thing here, and it is far paler than a leaf: the
//    pale sage green of a real Carnegiea gigantea, read off a photograph rather than
//    guessed at. It is flat shaded because the flutes below are what a saguaro IS at
//    any distance, and flat shading is what makes them read as ribs catching the low
//    sun down one side instead of as a smooth tube. The barrel form gets its own dry
//    khaki, because at 0.8-1.7 scale it is a low round blob, and in green it reads as
//    a lawn shrub that wandered into the desert.
const matCactus = new THREE.MeshStandardMaterial({
  // Set against the RUNNING GAME, not a swatch: the desert sun here is bright enough
  // that a colour picked off a photograph comes out neon — brighter than the sand the
  // plant stands on, which the eye reads as signage rather than as a plant. The sample
  // is cut by a tenth for that reason: still unmistakably sage, and now under the
  // ground's own albedo instead of on top of it.
  color: 0x7d9a63,
  roughness: 0.95,
  metalness: 0,
  flatShading: true,
});
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

/**
 * Delineator post and reflector.
 *
 * The post is bleached white-grey plastic, not white: a pure white post in this
 * palette reads as a painted kerb stone. The reflector's own albedo is a dull amber
 * so it is legible in daylight as a chip of glass rather than a hole in the post,
 * and its EMISSIVE — not a light — is what makes it a bright dot after dark.
 */
const matDelineator = new THREE.MeshStandardMaterial({ color: 0xd6d1c3, roughness: 0.78, metalness: 0.05 });
const matReflector = new THREE.MeshStandardMaterial({
  color: 0xb9a179,
  emissive: 0xffdca8,
  emissiveIntensity: 0,
  roughness: 0.22,
  metalness: 0.2,
});

let reflectorEmissiveIntensity = -1;

/** Shared with every run in the world, so this is one material write per frame. */
function setReflectorEmission(on: number): void {
  const value = on * REFLECTOR_EMISSIVE;
  if (value === reflectorEmissiveIntensity) return;
  reflectorEmissiveIntensity = value;
  matReflector.emissiveIntensity = value;
}

// Anomaly fittings. The tarp is sun-bleached canvas — grey with the warmth burnt out
// of it — because a saturated cloth on a pole reads as a flag and therefore as
// somebody being here now, which is the opposite of what a wrapped pole says. The
// gear is the pale green-grey of painted line equipment, the one manufactured colour
// the desert never produces by itself.
const matTarp = new THREE.MeshStandardMaterial({ color: 0x9c9686, roughness: 1.0, metalness: 0 });
const matGear = new THREE.MeshStandardMaterial({ color: 0x69706a, roughness: 0.62, metalness: 0.35 });

/**
 * The two trees carry their bark and their canopy in VERTEX COLOURS on one material,
 * so a tree is one instanced draw call instead of two. Everything else in this file
 * is a single flat colour and does not need it.
 */
const matPlant = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });

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
  /** Relative selection weight inside its surface's form list. 1 is an ordinary member. */
  readonly weight: number;
  /**
   * Per-instance shape variation amplitudes, absent on everything that is not a plant.
   * A boulder is a boulder; a tree is never the same tree twice.
   */
  readonly vary?: {
    /** Height multiplier spread, ±: 0.16 means every instance stands 0.84 to 1.16 of the authored height. */
    readonly stretch: number;
    /** Width multiplier spread, ± the same way. */
    readonly spread: number;
    /** Largest lean from vertical, radians. */
    readonly lean: number;
  };
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

/**
 * A fluted column: the cactus silhouette. A saguaro is not a cylinder — it is a ring
 * of deep vertical ribs, and at any distance those ribs ARE the plant, because they
 * are what catches the low sun down one side. The radius is modulated by a cosine of
 * the angle, so the flutes cost nothing but a few more radial segments.
 */
function ribbedColumn(rTop: number, rBottom: number, height: number, segments: number, ribs: number, depth: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(rTop, rBottom, height, segments, 1);
  const position = g.getAttribute('position');
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const z = position.getZ(i);
    const radius = Math.hypot(x, z);
    if (radius < 1e-5) continue;
    const flute = 1 + depth * Math.cos(ribs * Math.atan2(z, x));
    position.setX(i, x * flute);
    position.setZ(i, z * flute);
  }
  g.computeVertexNormals();
  return g;
}

function buildSaguaro(): THREE.BufferGeometry {
  const trunk = ribbedColumn(0.27, 0.375, 6.4, 18, 9, 0.08);
  trunk.translate(0, 3.2, 0);
  const arm = (radius: number, length: number) => ribbedColumn(radius, radius, length, 12, 6, 0.07);

  // Right arm: a short horizontal stub then a vertical riser, the classic shape.
  const rStub = arm(0.13, 0.8);
  rStub.rotateZ(Math.PI / 2);
  rStub.translate(0.7, 3.5, 0);
  const rRise = arm(0.12, 2.1);
  rRise.translate(1.05, 4.55, 0);

  // Left arm, higher, mirrored to the far side.
  const lStub = arm(0.13, 0.8);
  lStub.rotateZ(Math.PI / 2);
  lStub.rotateY(Math.PI);
  lStub.translate(-0.7, 4.1, 0);
  const lRise = arm(0.12, 2.1);
  lRise.translate(-1.05, 5.15, 0);

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

/**
 * Paints every vertex of a part one colour, so merged parts keep their own look on
 * one material.
 *
 * The hex is a DISPLAY colour, set through `LinearSRGBColorSpace` — the convention
 * `render/mirage-tableau.ts` and `world/weatherfx.ts` already use for their
 * vertex-coloured geometry, because the renderer writes the working colour space
 * straight to the canvas (see the two-pass note in `core/renderer.ts`). Authored any
 * other way a tree comes out a gamma darker than the props standing beside it.
 */
function paint(geometry: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const colour = new THREE.Color().setHex(hex, THREE.LinearSRGBColorSpace);
  const count = geometry.getAttribute('position').count;
  const colours = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colours[i * 3] = colour.r;
    colours[i * 3 + 1] = colour.g;
    colours[i * 3 + 2] = colour.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  return geometry;
}

/** One limb: a tapered cylinder with its base at (x, y, z), tilted from vertical and turned to `az`. */
function limb(
  x: number,
  y: number,
  z: number,
  tilt: number,
  az: number,
  length: number,
  rBase: number,
  rTip: number,
  segments: number,
): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(rTip, rBase, length, segments, 1);
  g.translate(0, length / 2, 0);
  g.rotateZ(tilt);
  g.rotateY(az);
  g.translate(x, y, z);
  return g;
}

/** Where `limb` with these arguments ends: what stops a canopy floating off its branch. */
function limbTip(
  x: number,
  y: number,
  z: number,
  tilt: number,
  az: number,
  length: number,
): [number, number, number] {
  const horizontal = -Math.sin(tilt) * length;
  return [x + horizontal * Math.cos(az), y + Math.cos(tilt) * length, z - horizontal * Math.sin(az)];
}

/**
 * One tuft of canopy: a flattened icosahedron, INDEXED.
 *
 * `IcosahedronGeometry` is non-indexed while cylinders and lathes are indexed, and
 * `mergeGeometries` refuses the mix — it returns null, which is a tree that does not
 * exist. `mergeVertices` costs one build and welds nothing here (the faceted normals
 * differ), so the shape is exactly the icosahedron with an index on it.
 */
function canopyPad(
  radius: number,
  flatten: number,
  x: number,
  y: number,
  z: number,
  detail = 0,
): THREE.BufferGeometry {
  const g = mergeVertices(new THREE.IcosahedronGeometry(radius, detail));
  g.scale(1, flatten, 1);
  g.translate(x, y, z);
  return g;
}

/**
 * Scales a finished tree so it really stands as tall as its form says it does.
 *
 * The parts are authored in comfortable round numbers and their sum lands wherever it
 * lands; the form's `height` is what the capsule collider is built from, so the two
 * have to be one number or a tree is a taller obstacle than it looks. One build per
 * form, so it costs nothing at run time.
 */
function standTo(geometry: THREE.BufferGeometry, height: number): THREE.BufferGeometry {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (!box) return geometry;
  const grown = box.max.y - Math.min(0, box.min.y);
  if (grown <= 1e-6) return geometry;
  const k = height / grown;
  geometry.scale(k, k, k);
  return geometry;
}

/**
 * THE SOCOTRA DRAGON TREE, Dracaena cinnabari.
 *
 * One trunk carries most of the height: a single tall stout column standing alone from
 * the ground all the way to the crown. THAT column is what identifies the plant — a tree
 * that forks at the ground is a shrub, not a Dracaena. Only just under the crown does the
 * trunk break into a short fork band, and there it doubles FIVE times over, five limbs to
 * ten to twenty to forty to eighty, so a dense basket fans out fast ABOVE the column and
 * is seen through and under. The crown is not a lens laid over the basket: its rim IS the
 * tips' own tufts, so every fork and every tip reads from outside instead of the whole
 * plant being swallowed by an overhanging mat.
 */
function buildDragonTree(): THREE.BufferGeometry {
  const bark = 0x87796a;
  // On screen, not in the swatch: vertex colours here are display-space (see `paint`),
  // so this IS what the crown looks like — a dry olive, not a leaf green. Cut by a
  // tenth from the olive it was tuned at, for the saguaro's reason: in a scatter where
  // every other form is sand, rock or khaki, a plant's green is the one thing that
  // reads as a signal, and a landmark may not out-read the ground it stands on.
  const canopy = 0x5e7145;
  const parts: THREE.BufferGeometry[] = [
    paint(new THREE.CylinderGeometry(0.44, 0.66, 3.4, 12, 1).translate(0, 1.7, 0), bark),
  ];
  const tips: Array<[number, number, number]> = [];
  // Five doublings, 5 -> 10 -> 20 -> 40 -> 80 limbs, every split inside a short band at the
  // TOP of that column. Each is shorter, thinner and more tilted than its parent, and
  // carries the parent's own azimuth so the fan spreads outward instead of doubling back
  // through itself; the deepest levels are three-segment tubes, cheap to draw in bulk.
  const levels = [
    { tilt: 0.80, length: 1.15, rBase: 0.3, rTip: 0.22, segments: 6, spread: 0 },
    { tilt: 1.00, length: 0.90, rBase: 0.2, rTip: 0.15, segments: 5, spread: 0.5 },
    { tilt: 1.12, length: 0.72, rBase: 0.13, rTip: 0.095, segments: 4, spread: 0.44 },
    { tilt: 1.25, length: 0.62, rBase: 0.085, rTip: 0.06, segments: 3, spread: 0.36 },
    { tilt: 1.35, length: 0.5, rBase: 0.055, rTip: 0.04, segments: 3, spread: 0.3 },
  ];
  let nodes: Array<{ x: number; y: number; z: number; az: number }> = [];
  for (let i = 0; i < 5; i++) nodes.push({ x: 0, y: 3.35, z: 0, az: i * (Math.PI * 2 / 5) });
  for (let level = 0; level < levels.length; level++) {
    const { tilt, length, rBase, rTip, segments, spread } = levels[level]!;
    const grown: Array<{ x: number; y: number; z: number; az: number }> = [];
    for (const node of nodes) {
      // Identical tilt and length at a level puts all sixteen descendants of a primary
      // on one ring at one height, which is one silhouette rather than sixteen branches:
      // the first child of every fork leans less than its parent and the second more, so
      // the tips land on two rings and the basket reads as branch on branch.
      const azimuths = level === 0 ? [node.az] : [node.az - spread, node.az + spread];
      for (let c = 0; c < azimuths.length; c++) {
        const az = azimuths[c]!;
        const childTilt = level === 0 ? tilt : tilt * (c === 0 ? 0.88 : 1.12);
        parts.push(paint(limb(node.x, node.y, node.z, childTilt, az, length, rBase, rTip, segments), bark));
        const [tx, ty, tz] = limbTip(node.x, node.y, node.z, childTilt, az, length);
        grown.push({ x: tx, y: ty, z: tz, az });
      }
    }
    nodes = grown;
    if (level === levels.length - 1) for (const n of nodes) tips.push([n.x, n.y, n.z]);
  }
  let crownY = 0;
  for (const [, ty] of tips) crownY += ty;
  crownY = crownY / tips.length + 0.18;
  // ONE mat closes the middle of the crown out to the inner tips, hung at the mean tip
  // height so it sits INSIDE the tips and reads as the crown of a column rather than a cap
  // laid on top of it, and eighty round clumps — each one a ball, not a plate, and smaller
  // than the branch that carries it — sit on every tip: the mat reaches the ring of clumps
  // with no bare annulus between them, so the rim stays torn while the crown is never
  // perforated and no ground shows through.
  parts.push(paint(canopyPad(2.7, 0.28, 0, crownY, 0, 1), canopy));
  for (let i = 0; i < tips.length; i++) {
    const [tx, ty, tz] = tips[i]!;
    parts.push(paint(canopyPad(0.65, 0.6, tx, ty + 0.06, tz), canopy));
  }
  return standTo(mergeGeometries(parts)!, 6.3);
}

/**
 * A BAOBAB, Adansonia. The bottle trunk is the whole tree; the crown is a wide, flat,
 * sparse fan of thick bare branches, and it finishes WIDER THAN THE TREE IS TALL. The
 * branches stay bare almost to their tips, so the crown reads as wood, not leaves,
 * which is why the species is called the upside-down tree.
 */
function buildBaobab(): THREE.BufferGeometry {
  const bark = 0x9a8b74;
  // A tenth down, like the dragon tree's olive: the two crowns are the only green in
  // the scatter and neither may out-read the sand between them.
  const canopy = 0x49522f;
  // The lathe is open at top and bottom: the foot stands in sand and the crown cap
  // below covers the top, so neither opening is ever seen.
  const profile = [
    new THREE.Vector2(1.05, 0),
    new THREE.Vector2(1.9, 0.8),
    new THREE.Vector2(2.0, 2.2),
    new THREE.Vector2(1.75, 4.5),
    new THREE.Vector2(1.35, 6.6),
    new THREE.Vector2(1.12, 7.3),
  ];
  const parts: THREE.BufferGeometry[] = [paint(new THREE.LatheGeometry(profile, 11), bark)];
  for (let i = 0; i < 5; i++) {
    const az = (i * Math.PI * 2) / 5;
    parts.push(paint(limb(0, 7.15, 0, 1.25, az, 3.4, 0.46, 0.24, 6), bark));
    const [tx, ty, tz] = limbTip(0, 7.15, 0, 1.25, az, 3.4);
    // Each primary forks once, splayed about the parent azimuth: the second level is
    // what turns five spokes into a fan.
    for (const az2 of [az - 0.34, az + 0.34]) {
      parts.push(paint(limb(tx, ty, tz, 1.35, az2, 1.6, 0.2, 0.12, 5), bark));
      const [bx, by, bz] = limbTip(tx, ty, tz, 1.35, az2, 1.6);
      parts.push(paint(canopyPad(1.15, 0.4, bx, by + 0.08, bz), canopy));
    }
  }
  parts.push(paint(canopyPad(1.5, 0.34, 0, 7.5, 0), canopy));
  return standTo(mergeGeometries(parts)!, 9.4);
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
    weight: 1,
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
    weight: 1,
  };
  return _trunkForm;
}

let _sandForms: PropForm[] | null = null;
function sandForms(): PropForm[] {
  if (!_sandForms) {
    _sandForms = [
      { id: 'saguaro', geometry: buildSaguaro(), material: matCactus, baseRadius: 0.4, height: 6.4, collider: 'capsule', sink: 0, rotate3d: false, minScale: 0.75, maxScale: 1.35, weight: 1, vary: { stretch: 0.18, spread: 0.1, lean: 0.07 } },
      { id: 'barrel', geometry: buildBarrel(), material: matScrub, baseRadius: 0.34, height: 0.55, collider: 'capsule', sink: 0.18, rotate3d: false, minScale: 0.8, maxScale: 1.7, weight: 1 },
      { id: 'deadstick', geometry: buildDeadStick(), material: matDeadStick, baseRadius: 0.06, height: 1.8, collider: 'capsule', sink: 0, rotate3d: false, minScale: 0.7, maxScale: 1.5, weight: 1 },
      trunkForm(),
      scrubForm(),
      // A LANDMARK IS NOT A PROP, and the weight is what says so: a fifth of an
      // ordinary member, so a driver can cross minutes of desert without meeting one.
      // `baseRadius` is the trunk at its foot AFTER `standTo`, because the capsule
      // collider's radius is derived from it.
      { id: 'dragontree', geometry: buildDragonTree(), material: matPlant, baseRadius: 0.82, height: 6.3, collider: 'capsule', sink: 0, rotate3d: false, minScale: 0.85, maxScale: 1.2, weight: 0.18, vary: { stretch: 0.16, spread: 0.18, lean: 0.1 } },
      // Rarer still, and the capsule is what makes nine metres of trunk a wall rather
      // than scenery.
      { id: 'baobab', geometry: buildBaobab(), material: matPlant, baseRadius: 2.04, height: 9.4, collider: 'capsule', sink: 0, rotate3d: false, minScale: 0.8, maxScale: 1.15, weight: 0.1, vary: { stretch: 0.12, spread: 0.2, lean: 0.06 } },
    ];
  }
  return _sandForms;
}

let _rockForms: PropForm[] | null = null;
function rockForms(): PropForm[] {
  if (!_rockForms) {
    _rockForms = [
      { id: 'boulder', geometry: deformIcosahedron(0x00b1, 1.0), material: matRock, baseRadius: 1, height: 2, collider: 'hull', sink: 0.28, rotate3d: true, minScale: 0.4, maxScale: 1.6, weight: 1 },
      { id: 'boulderlow', geometry: deformIcosahedron(0x00b2, 0.55), material: matRock, baseRadius: 1, height: 1.1, collider: 'hull', sink: 0.28, rotate3d: true, minScale: 0.4, maxScale: 1.6, weight: 1 },
      { id: 'bouldertall', geometry: deformIcosahedron(0x00b3, 1.5), material: matRock, baseRadius: 1, height: 3, collider: 'hull', sink: 0.28, rotate3d: true, minScale: 0.4, maxScale: 1.6, weight: 1 },
      { id: 'slab', geometry: deformIcosahedron(0x00b4, 0.26), material: matRock, baseRadius: 1, height: 0.52, collider: 'hull', sink: 0.3, rotate3d: true, minScale: 0.5, maxScale: 1.9, weight: 1 },
    ];
  }
  return _rockForms;
}
/** Shared visual/collision forms for deterministic world-space desert scatter. */
export function desertPropForms(surface: SurfaceType): readonly DesertPropForm[] {
  return surface === SurfaceType.Rock ? rockForms() : sandForms();
}

/**
 * Weighted pick from a surface's forms. A uniform pick made every member equally
 * likely, which is right for five ordinary props and wrong for a landmark: a tree
 * that stands nine metres over the sand has to be rarer than a barrel cactus.
 */
export function pickDesertForm(forms: readonly DesertPropForm[], roll: number): DesertPropForm {
  let total = 0;
  for (const form of forms) total += form.weight;
  let cursor = roll * total;
  for (const form of forms) {
    cursor -= form.weight;
    if (cursor < 0) return form;
  }
  return forms[forms.length - 1]!;
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
  /**
   * A dirt clod yields and compacts instead of preserving momentum like woody debris.
   * DebrisField uses this to give only the road-pile pieces strong rolling resistance.
   */
  readonly looseSoil?: true;
}

function armPiece(mirror: number): THREE.BufferGeometry {
  const stub = ribbedColumn(0.13, 0.13, 0.8, 12, 6, 0.07);
  stub.rotateZ(Math.PI / 2);
  stub.translate(-0.35 * mirror, -1.02, 0);
  const rise = ribbedColumn(0.12, 0.12, 2.1, 12, 6, 0.07);
  rise.translate(0, 0.05, 0);
  return mergeGeometries([stub, rise]);
}

/**
 * One length of a snapped delineator blade.
 *
 * Centred on its own origin because that is what `PropPiece.offset` composes with:
 * the debris body is placed at `offset` and spun about its own centre, so a piece
 * built offset inside its own geometry would orbit a point outside itself.
 */
function postPiece(height: number): THREE.BufferGeometry {
  return new THREE.BoxGeometry(DELINEATOR_FACE_W, height, 0.04);
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
      // Three trunk lifts and two arms, cut at the joints a real column fails at. The
      // masses are still far under the tonne a real saguaro of this size weighs, ON
      // PURPOSE, for the reason given above the interface: a tonne of anything stops a
      // car dead, and these pieces exist so the car WALKS THROUGH the fallen plant.
      saguaro: [
        { geometry: ribbedColumn(0.3, 0.375, 2.1, 18, 9, 0.08), material: matCactus, offset: [0, 1.05, 0], capsule: [1.05, 0.33], mass: 60 },
        { geometry: ribbedColumn(0.29, 0.3, 2.1, 18, 9, 0.08), material: matCactus, offset: [0, 3.15, 0], capsule: [1.05, 0.3], mass: 45 },
        { geometry: ribbedColumn(0.27, 0.29, 2.1, 18, 9, 0.08), material: matCactus, offset: [0, 5.25, 0], capsule: [1.05, 0.28], mass: 34 },
        { geometry: armPiece(1), material: matCactus, offset: [1.05, 4.55, 0], capsule: [1.05, 0.14], mass: 16 },
        { geometry: armPiece(-1), material: matCactus, offset: [-1.05, 5.15, 0], capsule: [1.05, 0.14], mass: 16 },
      ],
      barrel: [
        { geometry: lump(0.19), material: matScrub, offset: [0.1, 0.12, 0.05], capsule: [0.06, 0.16], mass: 4 },
        { geometry: lump(0.17), material: matScrub, offset: [-0.12, 0.14, -0.08], capsule: [0.05, 0.14], mass: 3 },
        { geometry: lump(0.15), material: matScrub, offset: [0.02, 0.3, -0.1], capsule: [0.05, 0.13], mass: 3 },
      ],
      scrub: [
        { geometry: lump(0.34, 0.65), material: matScrub, offset: [0, 0.22, 0], capsule: [0.07, 0.28], mass: 4, looseSoil: true },
        { geometry: lump(0.24, 0.65), material: matScrub, offset: [0.28, 0.15, 0.1], capsule: [0.05, 0.2], mass: 2, looseSoil: true },
        { geometry: lump(0.2, 0.65), material: matScrub, offset: [-0.2, 0.14, -0.22], capsule: [0.04, 0.17], mass: 2, looseSoil: true },
      ],
      // A post that has been hit: the blade snaps in two and the reflector chip goes
      // its own way. Light parts with a low mass, so a car that clips one scatters
      // plastic rather than being slowed by it — the whole point of making a solid
      // post breakable in the first place.
      delineator: [
        { geometry: postPiece(0.44), material: matDelineator, offset: [0, 0.78, 0], capsule: [0.17, 0.055], mass: 1.6 },
        { geometry: postPiece(0.34), material: matDelineator, offset: [0, 0.21, 0], capsule: [0.12, 0.055], mass: 1.4 },
        { geometry: new THREE.BoxGeometry(0.075, 0.13, 0.014), material: matReflector, offset: [0, DELINEATOR_REFLECTOR_Y - DELINEATOR_EMBED, 0.027], capsule: [0.05, 0.045], mass: 0.2 },
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
          // The exact near edge, now that `s` is known. `MIN_LAT` above is the cheap
          // narrow-road filter; this is the one that keeps a prop off a widened verge,
          // and it costs three hashes rather than a road projection.
          if (absLateral < ctx.road.halfWidthAt(s) + SCATTER_SETBACK_M) break cell;

          // Thin out towards the far edge so the scatter ends in a fringe rather than a
          // fence line. Still only arithmetic: no sampling yet.
          const t = Math.min(1, Math.max(0, (absLateral - FULL_LAT) / (MAX_LAT - FULL_LAT)));
          const fade = 1 - t * t * (3 - 2 * t);
          if (roll >= ROCK_DENSITY * fade) break cell;

          const p = ctx.road.offsetPoint(s, lateral);
          // From the FRAME, not by projection: this cell was generated from (s, lateral),
          // so `surfaceAt`'s road search would spend 5 us rediscovering what the loop
          // counter already knows.
          const surface = ctx.terrain.surfaceFromFrame(p.x, p.z, lateral, s);

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

          const form = pickDesertForm(forms, hash01(seed, TAG_SCATTER, cs, cl, 3));

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
            // Road piles are low scrub and nothing else. A fallen trunk is desert
            // scenery now — it is still in `sandForms()` — and never spawns on the
            // carriageway: a log across a lane is the one piece of litter a driver
            // cannot read in time at speed.
            form = scrubForm();
          } else {
            const rocks = rockForms();
            form = rocks[Math.floor(hash01(seed, tag, candidate, 1) * rocks.length)]!;
          }

          const scaleRoll = hash01(seed, tag, candidate, 2);
          const scale = kind === 0 ? 0.9 + scaleRoll * 0.6 : 0.65 + scaleRoll * 0.7;
          const radius = form.baseRadius * scale;
          // Across whatever asphalt there is here: a widened stretch gets its holes
          // and rubble over both lanes, not only over the inner one.
          const asphaltHalf = ctx.road.halfWidthAt(s);
          const lateralReach = Math.max(0, asphaltHalf - radius - ROAD_HAZARD_EDGE_CLEARANCE);
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
      // Culled on the bounds of its INSTANCES, which three computes over every instance
      // matrix — not on the form's own geometry sphere, which sits at the mesh origin
      // and would pop a whole chunk's scatter out while half of it was still on screen.
      // Computed here, once, at full scale: the only later writes are a break's zero-
      // scale blank, which only ever shrinks what the sphere has to hold. A rebase moves
      // the chunk GROUP, and the sphere is local to it, so it never needs redoing.
      mesh.computeBoundingSphere();
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

/**
 * Global index of the first pole at or after `s`, or null if the road has none left.
 *
 * The same walk as `forEachPole`, for one arclength instead of a range: the anomaly
 * cluster has to name the poles it owns BY INDEX, because the index is the only
 * identity a pole has that a chunk boundary cannot cut in half.
 */
function poleIndexAtOrAfter(s: number): number | null {
  let indexBase = 0;
  for (const seg of poleEraSegments()) {
    const count = seg.spacing > 0 ? Math.floor((seg.end - seg.start) / seg.spacing) : 0;
    if (seg.end > s && count > 0) {
      const k = Math.max(0, Math.ceil((s - seg.start) / seg.spacing - 0.5 - POLE_EPS));
      if (k < count) return indexBase + k;
    }
    indexBase += count;
  }
  return null;
}

/**
 * What the pole at `index` is doing instead of standing there.
 *
 * Four forms, one per quarter of the event's own roll, so a cluster is all of one
 * kind: two poles wrapped in the same tarp are a road crew, one of each is a
 * showroom. The per-pole hash then varies the detail inside the form.
 */
export type PoleAnomaly = 'none' | 'down' | 'wrapped' | 'nest' | 'gear';

/**
 * The anomaly on a given pole, or 'none'.
 *
 * There is deliberately no second pole system here. The event names a STRETCH of
 * road; the poles inside it are whatever the era already put there, and only their
 * form changes. Two consequences worth stating, because both are load-bearing:
 *
 *  - `varietyEventOfKindAt` answers null outside the span, so the cluster cannot
 *    leak past the event even when the run of 2-4 would have reached further. The
 *    span is the authority, not the count.
 *  - where the span holds no pole at all — an era band with no line, or a span that
 *    falls in the gap before a band's first pole — this returns 'none' for everything
 *    and `poleDerelictAt` takes the event instead. Between them the two cover every
 *    scheduled event, which is the property `tools/verge-furniture.ts` measures over
 *    6000 km: a cluster where there is a line, a derelict where there is not, never
 *    nothing.
 */
export function poleAnomalyAt(seed: number, s: number, index: number): PoleAnomaly {
  const event = varietyEventOfKindAt(seed, 'poleAnomaly', s);
  if (!event) return 'none';
  const first = poleIndexAtOrAfter(event.s - event.halfLength);
  if (first === null) return 'none';
  const run =
    ANOMALY_RUN_MIN +
    Math.floor(hash01(seed, TAG_POLE_ANOMALY, event.index) * (ANOMALY_RUN_MAX - ANOMALY_RUN_MIN + 1));
  if (index < first || index >= first + run) return 'none';
  if (event.draw < 0.25) return 'down';
  if (event.draw < 0.5) return 'wrapped';
  if (event.draw < 0.75) return 'nest';
  return 'gear';
}

/**
 * Does the era schedule put a pole inside this span at all?
 *
 * Asked of the SPAN and not of the band, because a span that straddles a band
 * boundary can sit entirely in the gap before the next band's first pole while
 * `poleConditionAt` at its centre still names an era. That case is rare and it is
 * exactly the one that would otherwise schedule a change and show nothing.
 */
function poleLineInSpan(spanStart: number, spanEnd: number): boolean {
  const index = poleIndexAtOrAfter(spanStart);
  if (index === null) return false;
  const s = poleSByIndex(index);
  return s !== null && s <= spanEnd;
}

/**
 * The silhouette a derelict wears: the era of the nearest band that HAS a line.
 *
 * Backwards first, because a derelict is the remnant of the line the drive has just
 * been following — the one that stopped. Only at the very start of the road, where
 * there is nothing behind, does it borrow from ahead.
 */
function derelictEra(s: number): PoleEra {
  const bands = poleEraSegments();
  let here = bands.length - 1;
  for (let i = 0; i < bands.length; i++) {
    if (s < bands[i]!.end) {
      here = i;
      break;
    }
  }
  for (let i = here; i >= 0; i--) if (bands[i]!.era !== 'none') return bands[i]!.era;
  for (let i = here + 1; i < bands.length; i++) if (bands[i]!.era !== 'none') return bands[i]!.era;
  return 'timber';
}

/**
 * A standalone derelict, and NOT a member of the pole line.
 *
 * One old mast down in the sand, snapped off at its stump, and often a second stump
 * forty metres on: the remnant of a line that was never replaced. It carries no
 * index, so it renumbers nothing (see `TAG_DERELICT` on why that matters), no wire,
 * and no lamp — the whole read is that this one was abandoned rather than maintained.
 */
export interface PoleDerelict {
  /** Arclength of the fallen mast. The event's own centre. */
  readonly s: number;
  readonly side: -1 | 1;
  /** Borrowed silhouette; see `derelictEra`. */
  readonly era: PoleEra;
  /** Arclength of the surviving stump, or null when there is only the mast. */
  readonly stumpS: number | null;
}

/**
 * The derelict a 'poleAnomaly' event leaves at `s`, or null.
 *
 * Null in the ordinary case: where the era has a line, the event overrides poles and
 * this is not needed. Exported so the measuring tool can ask the same question
 * without building a chunk.
 */
export function poleDerelictAt(seed: number, s: number): PoleDerelict | null {
  const event = varietyEventOfKindAt(seed, 'poleAnomaly', s);
  if (!event) return null;
  if (poleLineInSpan(event.s - event.halfLength, event.s + event.halfLength)) return null;
  const stump = hash01(seed, TAG_DERELICT, event.index) > DERELICT_STUMP_CHANCE;
  return {
    s: event.s,
    side: event.side,
    era: derelictEra(event.s),
    // Forward along the road, so the mast is what the driver meets first and the
    // stump is the thing still there after it — a line ending rather than starting.
    stumpS: stump ? event.s + DERELICT_STUMP_GAP : null,
  };
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
  hasCrossarm: boolean;
  hasWire: boolean;
  height: number;
  /** What this pole is doing instead of standing upright. Usually 'none'. */
  anomaly: PoleAnomaly;
}

/**
 * Timber-era lamp head, hung from an outrigger under the road-side crossarm tip.
 * X = 2.1 puts the head 3.9 m out from a pole 6 m from a narrow road's crown: right at
 * the asphalt edge (-3.3 plus the paint), which is the only way a 6 m mast with an
 * inverse-square falloff actually lights the near lane rather than the gravel.
 */
const TIMBER_LAMP_LOCAL: readonly [number, number, number] = [2.1, 5.95, 0];

/**
 * Local (un-rotated) position of the lamp head for an era, or null if it has none.
 *
 * +X is LEFT of travel and the poles stand right of the road, so a positive X
 * reaches over the carriageway. The concrete arm reaches `LAMP_ARM_REACH` from a
 * pole standing 3.1 m outside the paint, leaving the head just inside the shoulder —
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

/**
 * The visual pose is factored from the road query so the gallery cannot drift into
 * a hand-copied silhouette while the provider retains its exact world-space inputs.
 */
function describePoleAt(
  seed: number,
  s: number,
  index: number,
  baseX: number,
  baseY: number,
  baseZ: number,
  heading: number,
  cond: PoleCondition,
  anomaly: PoleAnomaly,
): PolePose {
  const h1 = hash01(seed, TAG_POLE, index, 0);
  const h3 = hash01(seed, TAG_POLE, index, 2);
  const h4 = hash01(seed, TAG_POLE, index, 3);
  const h5 = hash01(seed, TAG_POLE, index, 4);
  const h6 = hash01(seed, TAG_POLE, index, 5);
  const h7 = hash01(seed, TAG_POLE, index, 6);

  const height = POLE_HEIGHT[cond.era];
  const d = cond.dilapidation;

  // A pole in an anomaly cluster is the SAME pole: same index, same station, same
  // era, same hashes. Only the two numbers that describe how it is standing are
  // overridden, which is exactly why this lives inside the pose rather than beside it.
  const down = anomaly === 'down';

  // A downed pole falls INTO THE DESERT, never across the road. `leanOffset` sends the
  // top along (sin az, cos az) and the pole line's outward normal is
  // (-cos heading, sin heading), so `heading - PI/2` is the azimuth that lays a mast
  // down away from the paint; the jitter is narrow enough that the outward component
  // survives it. Any other azimuth drops eight metres of timber over a live lane, and
  // where this feature meets the asphalt the asphalt wins.
  const leanAz = down ? heading - Math.PI * 0.5 + (h1 - 0.5) * DOWN_AZ_JITTER : h1 * Math.PI * 2;
  // No pole is ever tipped right over BY WEAR: `dilapidation` stops at MAX_WEAR,
  // because a mast lying in the sand is a wreck rather than a road going somewhere.
  // What is left is the lean, which is what a pole that has stood through decades of
  // wind looks like — and it is what makes the silhouette on the horizon change
  // between eras. A scheduled 'down' anomaly is the deliberate exception: one pole in
  // a hundred kilometres is an event, a whole era of them is a junkyard.
  const leanAngle = down ? DOWN_ANGLE + (h3 - 0.5) * 0.12 : d * 0.42 * (0.5 + h3);

  // `twist` spins the pole about +Y so its local axes follow the road: rotating by
  // the heading maps local +X onto (cos h, 0, -sin h), which is `offsetPoint`'s
  // LEFT-of-travel normal. Everything mounted on an arm therefore uses positive X
  // to lean over the road (see `lampLocal`).
  const jitter = (h4 - 0.5) * 0.14;
  const twist = heading + (cond.era === 'lattice' ? Math.PI * 0.25 : 0) + jitter;

  const hasCrossarm = cond.era === 'timber' ? h5 > d * 0.8 : true;
  // A lamp that has hit the sand does not come back on, and a pole nobody has
  // maintained since somebody tied a tarp round it has had its fixture stripped with
  // everything else worth carrying away.
  const lampWorks = down || anomaly === 'wrapped' ? false : h6 < cond.lampChance;
  // The span into a fallen pole is still attached, just slack. That is the whole read:
  // a line that came DOWN, rather than one that was taken away.
  const hasWire = down ? true : h7 < cond.wireChance;

  const top = leanOffset(height, leanAngle, leanAz);

  const ll = lampLocal(cond.era, hasCrossarm);
  const hasLamp = ll !== null;
  let lampX = 0;
  let lampY = 0;
  let lampZ = 0;
  if (ll) {
    const w = applyPoleRotation(ll[0], ll[1], ll[2], twist, leanAngle, leanAz);
    lampX = baseX + w.x;
    lampY = baseY + w.y;
    lampZ = baseZ + w.z;
  }

  return {
    index,
    s,
    era: cond.era,
    baseX,
    baseY,
    baseZ,
    topX: baseX + top.x,
    topY: baseY + top.y,
    topZ: baseZ + top.z,
    lampX,
    lampY,
    lampZ,
    hasLamp,
    lampWorks,
    twist,
    leanAz,
    leanAngle,
    hasCrossarm,
    hasWire,
    height,
    anomaly,
  };
}

/** Pure, chunk-independent description of the pole at global index `index`. */
function describePole(road: Road, terrain: Terrain, seed: number, s: number, index: number): PolePose {
  const sample = road.sampleAt(s);
  const p = road.offsetPoint(s, -(road.halfWidthAt(s) + POLE_SETBACK_M));
  return describePoleAt(
    seed,
    s,
    index,
    p.x,
    terrain.heightAt(p.x, p.z, s),
    p.z,
    sample.heading,
    poleConditionAt(s),
    poleAnomalyAt(seed, s, index),
  );
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
    // to the RIGHT of the road, outside the paint, so the arm must reach along +X to
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

// --- Anomaly fittings (shared) ---------------------------------------------

let _tarpWrap: THREE.BufferGeometry | null = null;
/**
 * Canvas tied round the foot of a pole, with the rope that holds it.
 *
 * Authored for the TIMBER shaft (0.16 m at the butt) and scaled per era at the mesh,
 * because the lattice mast is 1 m across its legs down there and a wrap sized for
 * timber vanished inside it. Slightly wider at the bottom than the top: cloth tied at
 * the waist and left for a decade falls outward, and a straight cylinder read as a
 * bollard rather than as cloth.
 */
function tarpWrap(): THREE.BufferGeometry {
  if (!_tarpWrap) {
    const cloth = new THREE.CylinderGeometry(0.26, 0.38, 1.55, 7, 1, true).translate(0, 0.78, 0);
    const hem = new THREE.CylinderGeometry(0.38, 0.33, 0.16, 7, 1).translate(0, 0.08, 0);
    _tarpWrap = mergeGeometries([cloth, hem]);
  }
  return _tarpWrap;
}

let _tarpRope: THREE.BufferGeometry | null = null;
function tarpRope(): THREE.BufferGeometry {
  if (!_tarpRope) _tarpRope = new THREE.TorusGeometry(0.29, 0.018, 4, 10).rotateX(Math.PI / 2).translate(0, 1.32, 0);
  return _tarpRope;
}

let _stickNest: THREE.BufferGeometry | null = null;
/**
 * A nest: a squashed mass of twigs with loose sticks out of the sides.
 *
 * The deformed icosahedron is the same trick the boulders use — one weld, one radial
 * push — and at 0.45 squash it is exactly the flattened dome a raptor builds. The
 * loose sticks are what stop it reading as a rock somebody left on the crossarm; the
 * angles are from a fixed hash, so every nest in the world is this one nest and the
 * geometry is shared.
 */
function stickNest(): THREE.BufferGeometry {
  if (!_stickNest) {
    const parts: THREE.BufferGeometry[] = [deformIcosahedron(0x9e57, 0.45).scale(0.42, 0.42, 0.42)];
    for (let i = 0; i < 6; i++) {
      const yaw = hash01(0x9e57, i, 1) * Math.PI * 2;
      const length = 0.34 + hash01(0x9e57, i, 2) * 0.3;
      const stick = new THREE.CylinderGeometry(0.012, 0.016, length, 4, 1);
      // `mergeGeometries` refuses a mixed attribute set, and the welded icosahedron
      // above has had its UVs deleted (it is deformed per vertex, so a UV seam is a
      // hole). The sticks are untextured too, so the UVs go rather than the weld.
      stick.deleteAttribute('uv');
      stick.rotateZ(Math.PI / 2 - (hash01(0x9e57, i, 3) - 0.5) * 0.5);
      stick.rotateY(yaw);
      stick.translate(Math.sin(yaw) * length * 0.3, 0.06 + hash01(0x9e57, i, 4) * 0.12, Math.cos(yaw) * length * 0.3);
      parts.push(stick);
    }
    _stickNest = mergeGeometries(parts);
  }
  return _stickNest;
}

let _transformerCan: THREE.BufferGeometry | null = null;
/** A pole-mounted transformer: a ribbed can on a bracket, bolted to the shaft. */
function transformerCan(): THREE.BufferGeometry {
  if (!_transformerCan) {
    const can = new THREE.CylinderGeometry(0.19, 0.19, 0.52, 9, 1);
    const lid = new THREE.CylinderGeometry(0.21, 0.2, 0.06, 9, 1).translate(0, 0.29, 0);
    const bracket = new THREE.BoxGeometry(0.22, 0.06, 0.05).translate(0.16, 0.18, 0);
    const bushing = new THREE.CylinderGeometry(0.03, 0.04, 0.14, 5, 1).translate(0.09, 0.37, 0);
    _transformerCan = mergeGeometries([can, lid, bracket, bushing]);
  }
  return _transformerCan;
}

let _loudspeaker: THREE.BufferGeometry | null = null;
/**
 * A horn loudspeaker on a stub arm, mouth along local +X.
 *
 * +X is over the carriageway (see `applyPoleRotation`), and that is deliberate: a
 * speaker bolted to a pole exists to be heard from the road. The mouth reaches 0.55 m
 * from a pole standing 3.1 m outside the paint, so it is still two and a half metres
 * clear of anything driving past.
 */
function loudspeaker(): THREE.BufferGeometry {
  if (!_loudspeaker) {
    const horn = new THREE.CylinderGeometry(0.23, 0.07, 0.42, 9, 1);
    horn.rotateZ(-Math.PI / 2);
    horn.translate(0.34, 0, 0);
    const driver = new THREE.CylinderGeometry(0.08, 0.08, 0.14, 7, 1);
    driver.rotateZ(-Math.PI / 2);
    driver.translate(0.07, 0, 0);
    const arm = new THREE.BoxGeometry(0.16, 0.05, 0.05).translate(-0.02, 0, 0);
    _loudspeaker = mergeGeometries([horn, driver, arm]);
  }
  return _loudspeaker;
}

/**
 * Where a nest sits on each era's pole: on the crossarm if there is one, on the mast
 * cap if there is not. Read off the silhouette builders above rather than guessed —
 * `timberCrossarm` puts its arm at y = 6.1 and `latticeMast` caps at 8.25.
 */
function nestLocal(era: PoleEra, hasCrossarm: boolean): [number, number, number] {
  if (era === 'timber') return hasCrossarm ? [-0.52, 6.26, 0] : [0, 6.42, 0];
  if (era === 'lattice') return [0, 8.36, 0];
  return [0, 8.88, 0];
}

/** Height up the shaft that line gear is bolted at: chest height for a lineman on a ladder. */
const GEAR_LOCAL_Y = 3.4;

/**
 * Adds whatever the anomaly hangs on the pole. Nothing here moves the pole: the
 * 'down' form is entirely in the pose's lean, so this switch has no case for it.
 */
function addAnomalyMeshes(poleGroup: THREE.Group, pose: PolePose): void {
  switch (pose.anomaly) {
    case 'wrapped': {
      // The lattice mast's legs stand 1 m apart at the base; the wrap is authored for
      // a 0.3 m timber butt, so it is stretched to cover them instead of hiding in them.
      const spread = pose.era === 'lattice' ? 1.9 : 1;
      const cloth = new THREE.Mesh(tarpWrap(), matTarp);
      cloth.scale.set(spread, 1, spread);
      poleGroup.add(cloth);
      const rope = new THREE.Mesh(tarpRope(), matWire);
      rope.scale.set(spread, 1, spread);
      poleGroup.add(rope);
      break;
    }
    case 'nest': {
      const local = nestLocal(pose.era, pose.hasCrossarm);
      const nest = new THREE.Mesh(stickNest(), matDeadStick);
      nest.position.set(local[0], local[1], local[2]);
      nest.rotation.y = hash01(pose.index, TAG_POLE_ANOMALY, 1) * Math.PI * 2;
      poleGroup.add(nest);
      break;
    }
    case 'gear': {
      // Which fitting is per POLE, not per event: a cluster where one pole carries a
      // transformer and the next a loudspeaker is a line somebody kept adding to.
      if (hash01(pose.index, TAG_POLE_ANOMALY, 2) < 0.5) {
        const can = new THREE.Mesh(transformerCan(), matGear);
        // On the desert side (-X), where a can hangs clear of the carriageway.
        can.position.set(-0.26, GEAR_LOCAL_Y, 0);
        poleGroup.add(can);
      } else {
        const horn = new THREE.Mesh(loudspeaker(), matGear);
        horn.position.set(0.14, GEAR_LOCAL_Y + 0.7, 0);
        poleGroup.add(horn);
      }
      break;
    }
    case 'down':
    case 'none':
      break;
  }
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
  addAnomalyMeshes(poleGroup, pose);
}

/**
 * Builds the production pole silhouette at a gallery-friendly origin. This remains
 * intentionally pose-only: wires and light-budget source markers belong to chunks.
 */
export function createPoleDisplay(
  cond: PoleCondition,
  seed: number,
  index: number,
  anomaly: PoleAnomaly = 'none',
): THREE.Group {
  const pose = describePoleAt(seed, 0, index, 0, 0, 0, 0, cond, anomaly);
  const group = new THREE.Group();
  poleQuaternion(pose.twist, pose.leanAngle, pose.leanAz, group.quaternion);
  addPoleMeshes(group, pose);
  return group;
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

/**
 * Metres the middle of a span hangs below its own chord.
 *
 * A live span is nearly drum-tight: three per cent of its length is the small curve
 * that stops a wire reading as a drawn line. A span into a FALLEN pole is the
 * opposite — slack is the whole point — but a flat fraction put seven metres of sag on
 * a fifty-metre span whose chord already ran down to half a metre off the sand, i.e.
 * the wire went underground and the anomaly read as a wire that simply stopped. So the
 * sag is also capped by the clearance the chord has over the two poles' own ground.
 */
function wireSagMetres(slack: boolean, span: number, clearance: number): number {
  const wanted = span * (slack ? WIRE_SAG_SLACK : WIRE_SAG_TAUT);
  return Math.min(wanted, Math.max(0, clearance) * WIRE_SAG_CLEARANCE);
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

/**
 * The stump of a mast that snapped: a short butt with one splinter still standing.
 *
 * The splinter is the whole point. A plain cylinder in the sand is a bollard; a
 * cylinder with a sliver of itself torn up out of the break is a pole that failed.
 */
let _snappedStump: THREE.BufferGeometry | null = null;
function snappedStump(): THREE.BufferGeometry {
  if (!_snappedStump) {
    const butt = new THREE.CylinderGeometry(0.13, 0.17, DERELICT_STUMP_HEIGHT, 7, 1).translate(
      0,
      DERELICT_STUMP_HEIGHT * 0.5,
      0,
    );
    const splinter = new THREE.CylinderGeometry(0.02, 0.05, 0.42, 4, 1);
    splinter.rotateZ(0.22);
    splinter.translate(0.06, DERELICT_STUMP_HEIGHT + 0.16, 0);
    _snappedStump = mergeGeometries([butt, splinter]);
  }
  return _snappedStump;
}

/** The era's own standing silhouette, for the derelict that borrows it. */
function eraShaft(era: PoleEra): { geometry: THREE.BufferGeometry; material: THREE.MeshStandardMaterial } {
  if (era === 'lattice') return { geometry: latticeMast(), material: matLattice };
  if (era === 'concrete') return { geometry: concreteColumn(), material: matConcrete };
  return { geometry: timberShaft(), material: matTimber };
}

/**
 * Builds one derelict into a chunk: the fallen mast, its stump, and the collider for
 * the mast if this chunk carries physics.
 *
 * The fall azimuth is derived, not rolled. `leanOffset` sends the top along
 * (sin az, cos az) and the outward normal on side `side` is `side * (cos h, -sin h)`,
 * so `h + side * PI/2` is the azimuth that lays the mast AWAY from the carriageway.
 * A rolled azimuth would eventually put nine metres of concrete across a lane.
 */
function addDerelict(
  ctx: ChunkContext,
  group: THREE.Group,
  bodies: RAPIER.RigidBody[],
  colliders: RAPIER.Collider[],
  derelict: PoleDerelict,
): void {
  const lateral = derelict.side * (ctx.road.halfWidthAt(derelict.s) + POLE_SETBACK_M);
  const base = ctx.road.offsetPoint(derelict.s, lateral);
  const baseY = ctx.terrain.heightAt(base.x, base.z, derelict.s) - DERELICT_SINK_M;
  const heading = ctx.road.sampleAt(derelict.s).heading;
  const az = heading + derelict.side * Math.PI * 0.5;
  const height = POLE_HEIGHT[derelict.era];

  const mast = new THREE.Group();
  mast.position.set(base.x - ctx.originX, baseY, base.z - ctx.originZ);
  poleQuaternion(heading, DERELICT_FALL_ANGLE, az, mast.quaternion);
  const shaft = eraShaft(derelict.era);
  mast.add(new THREE.Mesh(shaft.geometry, shaft.material));
  group.add(mast);

  // The stump sits where the mast's own butt would have been if it had stayed up, so
  // the two read as one line rather than as two unrelated objects.
  if (derelict.stumpS !== null) {
    const stumpLateral = derelict.side * (ctx.road.halfWidthAt(derelict.stumpS) + POLE_SETBACK_M);
    const stumpBase = ctx.road.offsetPoint(derelict.stumpS, stumpLateral);
    const stump = new THREE.Group();
    stump.position.set(
      stumpBase.x - ctx.originX,
      ctx.terrain.heightAt(stumpBase.x, stumpBase.z, derelict.stumpS) - DERELICT_SINK_M * 0.5,
      stumpBase.z - ctx.originZ,
    );
    // Leaning the way the line fell: the same azimuth, a fraction of the angle.
    poleQuaternion(heading, 0.18, az, stump.quaternion);
    stump.add(new THREE.Mesh(snappedStump(), shaft.material));
    group.add(stump);
  }

  if (!ctx.hasPhysics) return;
  // Solid where it visibly lies, like the pole line's own leaning collider.
  const mid = leanOffset(height * 0.5, DERELICT_FALL_ANGLE, az);
  addStatic(
    ctx,
    bodies,
    colliders,
    base.x + mid.x,
    baseY + mid.y,
    base.z + mid.z,
    RAPIER.ColliderDesc.capsule(height * 0.45, 0.16),
    SurfaceType.Concrete,
    leanRotation(DERELICT_FALL_ANGLE, az),
  );
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
      poleGroup.position.set(pose.baseX - ox, pose.baseY, pose.baseZ - oz);
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

      // Every pole is a solid obstacle, including a scheduled 'down' one: the
      // collider is built from the pose's own lean, so a mast lying in the sand is
      // solid where it lies rather than where it stood. Nothing is skipped, which is
      // why there is no flat-in-the-sand special case here.
      if (ctx.hasPhysics) {
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
      if (!pose.hasWire) continue;
      const nextS = poleSByIndex(pose.index + 1);
      if (nextS === null) continue;
      if (poleConditionAt(nextS).era !== pose.era) continue; // no span across era boundary
      const nextPose = describePole(ctx.road, ctx.terrain, seed, nextS, pose.index + 1);
      const a = new THREE.Vector3(pose.topX - ox, pose.topY, pose.topZ - oz);
      const b = new THREE.Vector3(nextPose.topX - ox, nextPose.topY, nextPose.topZ - oz);
      // Either end being down makes the span slack; the clearance is the mean height
      // of the two tops above their own bases, which is what the chord has to spend.
      const slack = pose.anomaly === 'down' || nextPose.anomaly === 'down';
      const clearance = (pose.topY - pose.baseY + (nextPose.topY - nextPose.baseY)) * 0.5;
      const wireGeo = new THREE.TubeGeometry(
        new CatenaryCurve(a, b, wireSagMetres(slack, a.distanceTo(b), clearance)),
        20,
        WIRE_RADIUS,
        4,
        false,
      );
      wireGeos.push(wireGeo);
      group.add(new THREE.Mesh(wireGeo, matWire));
    }

    // Derelicts. Built by the POLE provider and not by a provider of their own,
    // because a derelict is the pole line's own remnant and the two must never both
    // claim the same ground: `poleDerelictAt` returns null wherever the line exists.
    // Owned by the chunk holding the event's centre, so a mast that reaches past the
    // chunk end is still built exactly once.
    for (const event of varietyEventsBetween(seed, ctx.sStart, ctx.sEnd)) {
      if (event.kind !== 'poleAnomaly') continue;
      if (event.s < ctx.sStart || event.s >= ctx.sEnd) continue;
      const derelict = poleDerelictAt(seed, event.s);
      if (derelict) addDerelict(ctx, group, bodies, colliders, derelict);
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
// Delineators: runs of reflector posts
// ===========================================================================

let _delineatorPost: THREE.BufferGeometry | null = null;
/**
 * The post: a flat blade, not a round picket, with its reflector merged in.
 *
 * The wide face is what carries the reflector and what a headlight beam meets
 * square-on, and 4 cm of thickness is what makes it read as a sheet of plastic at
 * fifty metres rather than as a fence post. Twelve triangles per box, and it is
 * instanced, so a 1.2 km run of thirty posts is one draw call either way.
 *
 * ONE geometry with two material GROUPS rather than two instanced meshes sharing a
 * matrix, and the reason is the break. A post is a solid obstacle now, and a solid
 * obstacle that cannot be knocked down is a car-wrecker; so a post is registered with
 * the debris field as a breakable, and `BreakableProp` blanks ONE mesh instance when
 * it goes. Two meshes meant either a second field in that interface or a reflector
 * chip left hanging in the air at knee height after its blade had gone — glowing, at
 * night, which is exactly when the run matters. Merging makes the two inseparable
 * instead of merely kept in step.
 */
function delineatorPost(): THREE.BufferGeometry {
  if (!_delineatorPost) {
    // The reflector is carried in the post's own frame: it sits proud of the +Z face,
    // which is the face the post's yaw turns back up the road toward oncoming lights.
    const blade = new THREE.BoxGeometry(DELINEATOR_FACE_W, DELINEATOR_HEIGHT, 0.04).translate(
      0,
      DELINEATOR_HEIGHT * 0.5 - DELINEATOR_EMBED,
      0,
    );
    const reflector = new THREE.BoxGeometry(0.075, 0.13, 0.014).translate(
      0,
      DELINEATOR_REFLECTOR_Y - DELINEATOR_EMBED,
      0.027,
    );
    _delineatorPost = mergeGeometries([blade, reflector], true);
  }
  return _delineatorPost;
}

/** Material order for `delineatorPost`'s two groups. */
const DELINEATOR_MATERIALS: THREE.Material[] = [matDelineator, matReflector];


/**
 * Every post station of one run that falls in `[fromS, toS)`.
 *
 * The run is walked FROM ITS OWN START every time, because the gaps are a hash
 * CHAIN: station n is the sum of n drawn gaps, and a chain entered halfway is a
 * different chain. A run is at most 1200 m of 40-60 m gaps, so the walk is at most
 * thirty iterations of one hash — cheaper than the road query each surviving station
 * then costs, and it is what makes the chunk holding the middle of a run agree with
 * the chunk that held its beginning.
 */
function forEachDelineator(
  seed: number,
  event: VarietyEvent,
  fromS: number,
  toS: number,
  cb: (s: number, side: -1 | 1, ordinal: number) => void,
): void {
  const end = event.s + event.halfLength;
  const both = event.draw < DELINEATOR_BOTH_SIDES;
  const alternating = !both && event.draw < DELINEATOR_ALTERNATING;
  let s = event.s - event.halfLength;
  for (let ordinal = 0; s < end; ordinal++) {
    if (s >= fromS && s < toS) {
      if (both) {
        cb(s, -1, ordinal);
        cb(s, 1, ordinal);
      } else if (alternating) {
        cb(s, ((ordinal & 1) === 0 ? event.side : -event.side) as -1 | 1, ordinal);
      } else {
        cb(s, event.side, ordinal);
      }
    }
    s +=
      DELINEATOR_GAP_MIN +
      hash01(seed, TAG_DELINEATOR, event.index, ordinal) * (DELINEATOR_GAP_MAX - DELINEATOR_GAP_MIN);
  }
}

/**
 * Runs of roadside reflector posts, on the director's 'delineators' schedule.
 *
 * This is the cheapest thing in the world that changes the view: a run says the road
 * is being maintained, it draws the curve ahead in daylight, and after dark the
 * reflectors are the only thing in the desert that answers the headlights.
 *
 * THEY ARE SOLID, AND THEY COME APART. A post with no collider is a lie the first
 * time a car drives through one; a post with a collider and nothing else is a worse
 * lie, because 12 cm of plastic would stop two tonnes dead. So a post inside the
 * physics window carries a collider AND is registered with the debris field as
 * breakable, which is the same road the scatter's cacti and boulders take: the car
 * clips it, the post bursts into its parts, and the parts are the debris. That is
 * what the real article does, and it is why the run can be an obstacle without being
 * a wall.
 *
 * The cost is bounded by the streaming radii and nothing else. Colliders are built
 * only where `ctx.hasPhysics` is true — the player's chunk and its two neighbours,
 * a kilometre of road — so a 40-60 m spacing puts eight to twenty-four of them in
 * the world at once, against the hundreds the scatter field carries over the same
 * kilometre. A run outside that window is instanced scenery and nothing more.
 */
export class DelineatorProvider implements ChunkProvider {
  readonly id = 'delineators';

  /**
   * The SHARED road-distance index, for the same reason `TerrainMeshProvider` takes
   * it: a post has to stand on the surface that is DRAWN, and `drawnGroundY` can only
   * reproduce the mesh if it asks the same lattice the mesh asked. Sampling the height
   * field instead left feet up to 4.6 cm off the drawn ground — measured, in
   * `tools/verge-furniture.ts` — which on sand in a low sun is a visible gap.
   *
   * `breakables` is optional for the same reason it is on the scatter: a viewer with
   * no debris field should still get the posts.
   */
  constructor(
    private readonly roadDistance: RoadDistance,
    private readonly breakables?: BreakableSink,
  ) {}

  build(ctx: ChunkContext): ChunkContent | null {
    const seed = ctx.world.seed;
    const ox = ctx.originX;
    const oz = ctx.originZ;

    // One allocation per chunk, which is what `varietyEventsBetween` is for. A run is
    // 400-1200 m against a 200 m chunk, so most chunks inside a run see exactly one
    // event and most chunks outside one see none.
    const posts: { x: number; y: number; z: number; yaw: number; id: number }[] = [];
    for (const event of varietyEventsBetween(seed, ctx.sStart, ctx.sEnd)) {
      if (event.kind !== 'delineators') continue;
      forEachDelineator(seed, event, ctx.sStart, ctx.sEnd, (s, side, ordinal) => {
        // A post already knocked down is not rebuilt, which is the same test the
        // scatter makes: the piece is absent rather than re-created and blanked, so a
        // saved flat post stays flat and costs nothing.
        const id = delineatorId(event.index, ordinal, side);
        if (this.breakables?.isBroken(id)) return;
        // Outward from the LOCAL asphalt edge: the carriageway widens and narrows
        // (`roadprofile.ts`), and a run authored at a fixed lateral would walk onto
        // the paint of every widened stretch it crossed.
        const lateral = side * (ctx.road.halfWidthAt(s) + DELINEATOR_SETBACK_M);
        const p = ctx.road.offsetPoint(s, lateral);
        const sample = ctx.road.sampleAt(s);
        // `heading + PI` turns the face back DOWN the road at traffic that has not
        // arrived yet; `+ side * cant` turns it in over the carriageway rather than
        // out at the desert. The jitter is per post and per side, so a both-sides run
        // does not read as a pair of rails.
        const yaw =
          sample.heading +
          Math.PI +
          side * DELINEATOR_CANT +
          (hash01(seed, TAG_DELINEATOR, event.index, ordinal, side) - 0.5) * DELINEATOR_YAW_JITTER;
        posts.push({
          x: p.x,
          y: drawnGroundY(ctx.road, ctx.terrain, this.roadDistance, s, lateral),
          z: p.z,
          yaw,
          id,
        });
      });
    }
    if (posts.length === 0) return null;

    const group = new THREE.Group();
    const shafts = new THREE.InstancedMesh(delineatorPost(), DELINEATOR_MATERIALS, posts.length);

    const bodies: RAPIER.RigidBody[] = [];
    const colliders: RAPIER.Collider[] = [];
    const registered: number[] = [];
    // Half the blade's STANDING height — what is above ground once the planted depth
    // is taken off. The collider's centre goes a half-blade above the foot the
    // instance sits at, so the solid post occupies exactly the drawn post.
    const halfHeight = (DELINEATOR_HEIGHT - DELINEATOR_EMBED) * 0.5;
    for (let i = 0; i < posts.length; i++) {
      const post = posts[i]!;
      _dummy.position.set(post.x - ox, post.y, post.z - oz);
      _dummy.rotation.set(0, post.yaw, 0);
      _dummy.scale.setScalar(1);
      _dummy.updateMatrix();
      shafts.setMatrixAt(i, _dummy.matrix);

      if (!ctx.hasPhysics) continue;
      // A cuboid, not a capsule: the blade is 12 cm of face and 4 cm of thickness, and
      // a capsule would give the car a round fence post to hit. It is solid for the
      // whole height of the standing blade, so a wheel arch clips what a wheel misses.
      const collider = addStatic(
        ctx,
        bodies,
        colliders,
        post.x,
        post.y + halfHeight,
        post.z,
        RAPIER.ColliderDesc.cuboid(DELINEATOR_FACE_W * 0.5, halfHeight, 0.02),
        // The post is plastic and breaks on the first touch; what a wheel is on when
        // it clips one is the verge the post is planted in.
        SurfaceType.LooseShoulder,
        yawRotation(post.yaw),
      );
      if (this.breakables) {
        registered.push(post.id);
        this.breakables.register({
          id: post.id,
          pieces: propPieces('delineator')!,
          x: post.x,
          y: post.y,
          z: post.z,
          yaw: post.yaw,
          scale: 1,
          radius: DELINEATOR_FACE_W * 0.5,
          height: DELINEATOR_HEIGHT - DELINEATOR_EMBED,
          mesh: shafts,
          instance: i,
          collider,
        });
      }
    }
    shafts.instanceMatrix.needsUpdate = true;
    // Culled on its instances' own bounds, for the scatter's reasons (see `buildSteps`):
    // computed once over the standing run; a broken post is only ever blanked smaller.
    shafts.computeBoundingSphere();
    group.add(shafts);

    return {
      group,
      bodies,
      colliders,
      dispose: () => {
        shafts.dispose();
        if (registered.length > 0) this.breakables?.forget(registered);
      },
      /**
       * The reflector material is shared by every run in the world, so this is one
       * comparison and at most one write per frame however many runs are loaded. It
       * takes the same dusk ramp the lamps do (see `setLampEmission`), which is why
       * the run comes up over the twilight instead of switching on in a frame.
       */
      setLamps(on: number): void {
        setReflectorEmission(on);
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
  tex.anisotropy = maxAnisotropy();
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
      // From the edge out, so a monument keeps its distance from the road however
      // wide the road is there.
      const lateral = m.side * (ctx.road.halfWidthAt(m.s) + m.setback);
      const p = ctx.road.offsetPoint(m.s, lateral);
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
