/**
 * Roadside props, the pole line: the line poles beside the road and their wires, and
 * the anomalies the director's 'poleAnomaly' events leave on them.
 *
 * Every prop is a pure function of the integer seed via stateless hashing, so a
 * chunk builds identically whether it is generated in order or revisited later.
 * Nothing here owns game state; chunk content is a derived view of the seed.
 *
 * Poles are a handful per chunk, so they use ordinary meshes rather than the
 * scatter's instancing: one mesh per pole over its design's shared geometry
 * (`poledesigns.ts`), and one merged mesh for every wire in the chunk.
 *
 * THE LINE CARRIES NO LAMPS. It used to be a lamppost line, three of whose eras hung
 * a light over the road; the desert night is no longer dark enough to need them and
 * every car carries its own, so the fixtures and their emissive material are gone. A
 * pole is what holds a wire up.
 */

import { retroActive } from '../../render/retro';
import { sceneFrameHeight } from '../../render/cleanstyle';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { hash01 } from '../../core/rng';
import { SurfaceType } from '../../core/surfaces';
import { varietyEventOfKindAt } from '../director';
import type { P3 } from '../dwellings/builder';
import { poleConditionAt, poleEraSegments, type PoleCondition, type PoleEra } from '../gradient';
import { ROAD_LENGTH, type Road } from '../road';
import type { Terrain } from '../terrain';
import { drawnGroundY } from '../terrainmesh';
import type { RoadDistance } from '../roaddistance';
import { laybyKeepsClear } from '../layby';
import type { ChunkContext, ChunkContent, ChunkProvider } from '../chunks';

import { deformIcosahedron, paintAsMaterial } from './forms';
import { makePoleMaterial, plainPoleMaterial, POLE_GEAR_Y, poleDesign, poleDesignSpacing, poleDesignsOfEra, poleMaterial, type PoleDesign } from './poledesigns';
import { addStatic, leanRotation } from './scatter';

// ---------------------------------------------------------------------------
// Scratch objects reused across the per-chunk build loops (never per-frame).
// ---------------------------------------------------------------------------
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _poleQuat = new THREE.Quaternion();
const _poleAt = new THREE.Vector3();
const _unitScale = new THREE.Vector3(1, 1, 1);
const _axis = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3();
const _wireTangent = new THREE.Vector3();
const _wireNormal = new THREE.Vector3();
const _wireBinormal = new THREE.Vector3();

// Poles run along the RIGHT-hand side of the road facing away from the house, as
// specified. `Road.offsetPoint` treats positive lateral as LEFT of travel (see its
// comment: the sign is load-bearing for road/terrain triangle winding), so the
// right-hand side is a negative offset.
const TAG_POLE = 0x90f1e2;
/** Per-wire survival rolls, a stream of their own so no pole roll moves. */
const TAG_WIRE = 0x90f1c7;
/**
 * MEASURED FROM THE ASPHALT EDGE, NOT FROM THE CROWN.
 *
 * The line used to stand at a fixed -6 m, which was the edge plus 3.1 m while every
 * road was 5.8 m wide. On a widened stretch (`roadprofile.ts`) that put the poles
 * 0.2 m off the paint. Real poles keep their distance from the road they follow, so
 * the setback is what is authored and the lateral is derived — which also means the
 * whole line sweeps out and back through a taper exactly as the carriageway does.
 *
 * 4.5 m, past the embankment's foot (`roadprofile`: 2.5 m shoulder, its fringe, a 1 m
 * batter). At 3.1 m the line stood on the shoulder's outer edge, where a frantic verge
 * pass puts the body's edge (up to 2.5 m out, and 0.3-0.6 m wider while it arrives).
 */
export const POLE_SETBACK_M = 4.5;
/**
 * How far below the drawn sand a pole's ground plane is set: a pole is planted, and
 * the sand sits up round its footing rather than meeting it at an edge. Below this the
 * design's own root (`POLE_ROOT_M`) carries the body on down.
 */
const POLE_SINK_M = 0.1;
/** Clear sand a pole keeps from a lay-by's asphalt, metres. */
const POLE_LAYBY_CLEAR_M = 1.5;

/**
 * Whether the pole at `s` would stand on a lay-by (world/layby.ts). It is left out and
 * the line spans the pad: a pole in a pull-in is the one place a parked car is sure to
 * meet it.
 */
function onLayby(road: Road, seed: number, s: number): boolean {
  const halfWidth = road.halfWidthAt(s);
  return laybyKeepsClear(seed, s, -(halfWidth + POLE_SETBACK_M), halfWidth, POLE_LAYBY_CLEAR_M);
}

/**
 * SECTIONS: the line is rebuilt in stretches of one design.
 *
 * An era band is 300 km (`POLE_ERA_BAND_M`, gradient.ts), which is the right length
 * for the MATERIAL to change but far too long for one pole: a band of one design is
 * the same pole seven thousand times. So a band is cut into sections of 8-25 km, each
 * carrying one design of the band's era, and the next section never repeats the design
 * it follows. At 90 km/h that is a new pole every five to seventeen minutes, and a
 * 2 500 km drive crosses some one hundred and fifty sections, so it meets nearly every
 * design its eras hold while each still reads as a LINE — a road crew builds a
 * stretch, not a pole.
 *
 * THERE IS NO STRETCH OF ROAD WITHOUT POLES. A section is a whole number of its own
 * spacings long and the next one starts where it ends, so the widest gap between two
 * poles anywhere is half of one spacing plus half of the next: at most 120 m, which is
 * also the shortest span a 'poleAnomaly' event covers (`director.ts`). Every event
 * therefore finds poles to alter.
 *
 * Seed-independent, like the era bands above it, so the schedule is one list for the
 * session and the tools can rebuild it without a world.
 */
const TAG_SECTION = 0x90f5ec;
const SECTION_MIN_M = 8_000;
const SECTION_MAX_M = 25_000;

// Pole anomalies: the 2-4 consecutive poles the director's 'poleAnomaly' event turns
// into something other than a pole standing there. These are a LOCAL OVERRIDE of the
// line's own pole — same index, same station, same design — and never a second line.
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
/** Sag as a fraction of the span: a live span, and one hanging off a fallen pole. */
const WIRE_SAG_TAUT = 0.03;
const WIRE_SAG_SLACK = 0.14;
/** Fraction of the chord's own clearance over the ground the sag may ever spend. */
const WIRE_SAG_CLEARANCE = 0.55;
/** Straight pieces per span, and sides per wire: enough to read as a hanging curve. */
const WIRE_SEGMENTS = 12;
const WIRE_SIDES = 3;
/**
 * THE NARROWEST A WIRE IS EVER DRAWN, in pixels of the scene target.
 *
 * A wire is 9 to 22 mm in radius (poledesigns.ts `WireStyle`). At the default 85°
 * field of view a scene pixel is 1.27 mm wide per metre of depth at 1440 lines and
 * 2.5 mm at 720, so a 1 cm wire drops under a pixel from about 12 m out at 1440p and
 * 6 m at 720p. Under a pixel, the rasteriser only lights the pixels whose centres the
 * sliver happens to cross, and a span beyond 30 to 50 m read as a broken dotted line
 * that crawled as the car moved; FXAA cannot restore pixels that were never drawn.
 *
 * So the shader (`wireMaterial`) never lets a wire's projected width fall under this,
 * and fades it by the ratio of its true radius to the radius drawn: the "ink" per
 * metre of wire (width x opacity) is what the true wire would cover, so a far span is
 * a continuous faint line rather than dots, and from about 12 m in at 1440p nothing
 * changes at all. One pixel is the least a sloping strip can be and still put a
 * sample in every column (or row) it crosses; wider would only smear it.
 */
const WIRE_MIN_WIDTH_PX = 1;
/**
 * The narrowest the WIRE_SIDES-gon cross-section looks from any side, in units of its
 * circumradius (the radius the tube is built at): an odd polygon seen vertex-on
 * spans r(1 + cos(PI/n)), 1.5 r for the triangle; an even one 2r cos(PI/n). The clamp
 * is sized on this, not on 2r, so a wire seen across a vertex is still a full pixel.
 */
const WIRE_NARROWEST_WIDTH = WIRE_SIDES % 2 === 1 ? 1 + Math.cos(Math.PI / WIRE_SIDES) : 2 * Math.cos(Math.PI / WIRE_SIDES);
/**
 * How much of a worn section has lost its arms and insulators, per unit of
 * dilapidation. Timber is stripped for its hardware and its arms rot; steel and
 * concrete keep theirs far longer.
 */
const STRIP_TIMBER = 0.8;
const STRIP_OTHER = 0.3;

// ---------------------------------------------------------------------------
// Colours of what hangs on a pole, painted onto the pole's own material
// ---------------------------------------------------------------------------

// Anomaly fittings. The tarp is sun-bleached canvas — grey with the warmth burnt out
// of it — because a saturated cloth on a pole reads as a flag and therefore as
// somebody being here now, which is the opposite of what a wrapped pole says. The
// gear is the pale green-grey of painted line equipment, the one manufactured colour
// the desert never produces by itself.
const TARP = 0x9c9686;
const GEAR = 0x69706a;
const ROPE = 0x242424;
const NEST = 0x8a7a5c;
/** The monuments' sign posts (props/monuments.ts). */
export const SIGN_POST = 0x5a5a5e;

/**
 * One fitting on a pole: its geometry painted, on the pole's plain material (one program,
 * no material of its own), casting and receiving as the pole it hangs on does.
 */
export function poleFitting(geometry: THREE.BufferGeometry, hex: number): THREE.Mesh {
  const mesh = new THREE.Mesh(paintAsMaterial(geometry, hex), plainPoleMaterial());
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// ===========================================================================
// The section schedule
// ===========================================================================

/** One stretch of line of one design. */
export interface PoleSection {
  readonly start: number;
  /** `start + count * spacing`: where the next section's first spacing begins. */
  readonly end: number;
  readonly era: PoleEra;
  readonly design: number;
  /** Metres between poles. */
  readonly spacing: number;
  /** Global index of the section's first pole. */
  readonly firstIndex: number;
  readonly count: number;
  /** The era band the section belongs to, which is what its wear is measured over. */
  readonly bandStart: number;
  readonly bandEnd: number;
}

let sections: readonly PoleSection[] | null = null;

/** The pole section schedule over the whole road, built once. */
export function poleSections(): readonly PoleSection[] {
  if (sections) return sections;
  const out: PoleSection[] = [];
  let firstIndex = 0;
  let start = 0;
  let previous = -1;
  poleEraSegments().forEach((band, bandIndex) => {
    const ids = poleDesignsOfEra(band.era);
    for (let k = 0; start < band.end; k++) {
      let length = SECTION_MIN_M + hash01(TAG_SECTION, bandIndex, k) * (SECTION_MAX_M - SECTION_MIN_M);
      // A remainder too short to be a section of its own joins the one before it.
      const last = band.end - (start + length) < SECTION_MIN_M;
      if (last) length = band.end - start;
      let pick = Math.floor(hash01(TAG_SECTION, bandIndex, k, 1) * ids.length);
      if (ids[pick] === previous) pick = (pick + 1 + Math.floor(hash01(TAG_SECTION, bandIndex, k, 2) * (ids.length - 1))) % ids.length;
      const design = ids[pick]!;
      const spacing = poleDesignSpacing(design);
      // Whole spacings, so the next section's first pole is one ordinary gap away. The
      // last section of a band rounds UP, past the band's end: rounding down would leave
      // a sliver the next band fills with a one-pole section of some other design. The
      // last band may round past the end of the road, which the road itself does not.
      let count = last ? Math.ceil(length / spacing) : Math.max(1, Math.round(length / spacing));
      if (start + count * spacing > ROAD_LENGTH) count = Math.floor((ROAD_LENGTH - start) / spacing);
      if (count <= 0) return;
      const end = start + count * spacing;
      out.push({ start, end, era: band.era, design, spacing, firstIndex, count, bandStart: band.start, bandEnd: band.end });
      firstIndex += count;
      previous = design;
      start = end;
    }
  });
  sections = out;
  return out;
}

/** Index into `poleSections()` of the section holding `s`. */
function sectionIndexAt(s: number): number {
  const list = poleSections();
  let lo = 0;
  let hi = list.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (s < list[mid]!.end) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** The design of the line at `s`. */
export function poleDesignAt(s: number): PoleDesign {
  return poleDesign(poleSections()[sectionIndexAt(s)]!.design);
}

// ===========================================================================
// Poles: stations along the line
// ===========================================================================

const POLE_EPS = 1e-6;
/** Invokes cb(s, index, section) for every pole whose arclength lies in [sStart, sEnd). */
function forEachPole(sStart: number, sEnd: number, cb: (s: number, index: number, section: PoleSection) => void): void {
  const list = poleSections();
  for (let i = sectionIndexAt(sStart); i < list.length; i++) {
    const section = list[i]!;
    if (section.start >= sEnd) break;
    if (section.count === 0) continue;
    const from = Math.max(section.start, sStart);
    const to = Math.min(section.end, sEnd);
    const k0 = Math.max(0, Math.ceil((from - section.start) / section.spacing - 0.5 - POLE_EPS));
    const k1 = Math.min(section.count - 1, Math.floor((to - section.start) / section.spacing - 0.5 + POLE_EPS));
    for (let k = k0; k <= k1; k++) cb(section.start + (k + 0.5) * section.spacing, section.firstIndex + k, section);
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
  const list = poleSections();
  for (let i = sectionIndexAt(s); i < list.length; i++) {
    const section = list[i]!;
    if (section.count === 0) continue;
    const k = Math.max(0, Math.ceil((s - section.start) / section.spacing - 0.5 - POLE_EPS));
    if (k < section.count) return section.firstIndex + k;
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
 * road; the poles inside it are whatever the section already put there, and only
 * their form changes. Two consequences worth stating, because both are load-bearing:
 *
 *  - `varietyEventOfKindAt` answers null outside the span, so the cluster cannot
 *    leak past the event even when the run of 2-4 would have reached further. The
 *    span is the authority, not the count.
 *  - the span always holds a pole: sections tile the road with no gap wider than the
 *    shortest event span (see SECTIONS above), so every scheduled event alters two to
 *    four poles of the line. `tools/verge-furniture.ts` measures exactly that over
 *    6000 km.
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

interface PolePose {
  index: number;
  s: number;
  design: PoleDesign;
  baseX: number;
  baseY: number;
  baseZ: number;
  twist: number;
  leanAz: number;
  leanAngle: number;
  /** False once the pole has lost its arms and insulators: it carries no wire. */
  fitted: boolean;
  /** What this pole is doing instead of standing upright. Usually 'none'. */
  anomaly: PoleAnomaly;
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
  design: PoleDesign,
  anomaly: PoleAnomaly,
): PolePose {
  const h1 = hash01(seed, TAG_POLE, index, 0);
  const h3 = hash01(seed, TAG_POLE, index, 2);
  const h4 = hash01(seed, TAG_POLE, index, 3);
  const h5 = hash01(seed, TAG_POLE, index, 4);
  const d = cond.dilapidation;

  // A pole in an anomaly cluster is the SAME pole: same index, same station, same
  // design, same hashes. Only the two numbers that describe how it is standing are
  // overridden, which is exactly why this lives inside the pose rather than beside it.
  const down = anomaly === 'down';

  // A downed pole falls INTO THE DESERT, never across the road. `poleQuaternion` tips the
  // top along (sin az, cos az) and the pole line's outward normal is
  // (-cos heading, sin heading), so `heading - PI/2` is the azimuth that lays a mast
  // down away from the paint; the jitter is narrow enough that the outward component
  // survives it. Any other azimuth drops a pole over a live lane, and where this
  // feature meets the asphalt the asphalt wins.
  const leanAz = down ? heading - Math.PI * 0.5 + (h1 - 0.5) * DOWN_AZ_JITTER : h1 * Math.PI * 2;
  // No pole is ever tipped right over BY WEAR: `dilapidation` stops at MAX_WEAR,
  // because a mast lying in the sand is a wreck rather than a road going somewhere.
  // What is left is the lean, which is what a pole that has stood through decades of
  // wind looks like. A scheduled 'down' anomaly is the deliberate exception: one pole
  // in a hundred kilometres is an event, a whole era of them is a junkyard.
  const leanAngle = down ? DOWN_ANGLE + (h3 - 0.5) * 0.12 : d * 0.42 * (0.5 + h3);

  // `twist` spins the pole about +Y so its local axes follow the road: rotating by
  // the heading maps local +X onto (cos h, 0, -sin h), which is `offsetPoint`'s
  // LEFT-of-travel normal. Every arm is authored with +X over the road and every
  // wire leaves along Z, so this is also what lines the wires up with the road.
  const twist = heading + (h4 - 0.5) * 0.1;

  const fitted = h5 >= d * (design.era === 'timber' ? STRIP_TIMBER : STRIP_OTHER);

  return { index, s, design, baseX, baseY, baseZ, twist, leanAz, leanAngle, fitted, anomaly };
}

/**
 * The condition of a section's poles at `s`, measured over the section's own band.
 * A section is whole spacings long, so the last one of a band can run a few tens of
 * metres into the next; its poles stay as worn as their neighbours instead of
 * jumping to the new band's fresh start.
 */
function sectionCondition(section: PoleSection, s: number): PoleCondition {
  return poleConditionAt(Math.min(Math.max(s, section.bandStart), section.bandEnd - 1));
}

/**
 * Pure, chunk-independent description of the pole at global index `index`.
 *
 * STANDS ON THE DRAWN GROUND, not on `Terrain.heightAt`: the tiles chord the field, and
 * a footing set on the field hovered over the sand by the chord's error, which is the
 * daylight that showed under every pole that had a footing to show it.
 */
function describePole(
  road: Road,
  terrain: Terrain,
  roadDistance: RoadDistance,
  seed: number,
  s: number,
  index: number,
  section: PoleSection,
): PolePose {
  const sample = road.sampleAt(s);
  const lateral = -(road.halfWidthAt(s) + POLE_SETBACK_M);
  const p = road.offsetPoint(s, lateral);
  return describePoleAt(
    seed,
    s,
    index,
    p.x,
    drawnGroundY(road, terrain, roadDistance, s, lateral) - POLE_SINK_M,
    p.z,
    sample.heading,
    sectionCondition(section, s),
    poleDesign(section.design),
    poleAnomalyAt(seed, s, index),
  );
}

/** A point authored in the pole's own frame, placed in the world. */
function worldOf(pose: PolePose, local: P3): { x: number; y: number; z: number } {
  const w = applyPoleRotation(local[0], local[1], local[2], pose.twist, pose.leanAngle, pose.leanAz);
  return { x: pose.baseX + w.x, y: pose.baseY + w.y, z: pose.baseZ + w.z };
}

// --- Anomaly fittings (shared) ---------------------------------------------

let _tarpWrap: THREE.BufferGeometry | null = null;
/**
 * Canvas tied round the foot of a pole, with the rope that holds it.
 *
 * Authored for a 0.17 m timber butt and scaled per design at the mesh, because a
 * lattice mast is over a metre across its legs down there and a wrap sized for timber
 * vanished inside it. Slightly wider at the bottom than the top: cloth tied at the
 * waist and left for a decade falls outward, and a straight cylinder read as a
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
/** The foot radius `tarpWrap` is authored for. */
const TARP_AUTHORED_RADIUS = 0.17;

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
/** How far the can's own centre stands off the face it is bolted to. */
const CAN_STANDOFF = 0.14;

let _loudspeaker: THREE.BufferGeometry | null = null;
/**
 * A horn loudspeaker on a stub arm, mouth along local +X.
 *
 * +X is over the carriageway (see `applyPoleRotation`), and that is deliberate: a
 * speaker bolted to a pole exists to be heard from the road. The mouth reaches 0.55 m
 * from a pole standing 4.5 m outside the paint, so it is still almost four metres
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
 * Adds whatever the anomaly hangs on the pole. Nothing here moves the pole: the
 * 'down' form is entirely in the pose's lean, so this switch has no case for it.
 * Every placement is read off the design (`foot`, `gear`, `nest`) rather than
 * guessed, because a hundred designs do not share one shaft.
 */
function addAnomalyMeshes(poleGroup: THREE.Group, pose: PolePose): void {
  const design = pose.design;
  switch (pose.anomaly) {
    case 'wrapped': {
      const spread = Math.max(1, design.foot.r / TARP_AUTHORED_RADIUS);
      const cloth = poleFitting(tarpWrap(), TARP);
      cloth.position.x = design.foot.x;
      cloth.scale.set(spread, 1, spread);
      poleGroup.add(cloth);
      const rope = poleFitting(tarpRope(), ROPE);
      rope.position.x = design.foot.x;
      rope.scale.set(spread, 1, spread);
      poleGroup.add(rope);
      break;
    }
    case 'nest': {
      // A stripped pole has no arm to build on, so the nest goes on its top.
      const local: P3 = pose.fitted ? design.nest : [design.legs[0]!.x, design.height + 0.02, 0];
      const nest = poleFitting(stickNest(), NEST);
      nest.position.set(local[0], local[1], local[2]);
      nest.rotation.y = hash01(pose.index, TAG_POLE_ANOMALY, 1) * Math.PI * 2;
      poleGroup.add(nest);
      break;
    }
    case 'gear': {
      // Which fitting is per POLE, not per event: a cluster where one pole carries a
      // transformer and the next a loudspeaker is a line somebody kept adding to.
      if (hash01(pose.index, TAG_POLE_ANOMALY, 2) < 0.5) {
        const can = poleFitting(transformerCan(), GEAR);
        // On the desert side (-X), where a can hangs clear of the carriageway.
        can.position.set(design.gear.x - design.gear.r - CAN_STANDOFF, POLE_GEAR_Y, 0);
        poleGroup.add(can);
      } else {
        const horn = poleFitting(loudspeaker(), GEAR);
        horn.position.set(design.gear.x + design.gear.r + 0.01, POLE_GEAR_Y + 0.7, 0);
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
  const mesh = new THREE.Mesh(pose.fitted ? pose.design.full : pose.design.mast, plainPoleMaterial());
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  poleGroup.add(mesh);
  addAnomalyMeshes(poleGroup, pose);
}

/**
 * Builds the production pole silhouette at a gallery-friendly origin. This remains
 * intentionally pose-only: wires belong to chunks.
 */
export function createPoleDisplay(
  design: PoleDesign,
  cond: PoleCondition,
  seed: number,
  index: number,
  anomaly: PoleAnomaly = 'none',
): THREE.Group {
  const pose = describePoleAt(seed, 0, index, 0, 0, 0, 0, cond, design, anomaly);
  const group = new THREE.Group();
  poleQuaternion(pose.twist, pose.leanAngle, pose.leanAz, group.quaternion);
  addPoleMeshes(group, pose);
  return group;
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

/** A cosh-shaped catenary: zero sag at the ends, deepest in the middle. */
function catenary(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
  sag: number,
  ox: number,
  oz: number,
): P3[] {
  const k = 3.0;
  const path: P3[] = [];
  for (let i = 0; i <= WIRE_SEGMENTS; i++) {
    const t = i / WIRE_SEGMENTS;
    const shape = (Math.cosh(k * (t - 0.5)) - Math.cosh(k * 0.5)) / (1 - Math.cosh(k * 0.5));
    path.push([a.x + (b.x - a.x) * t - ox, a.y + (b.y - a.y) * t - sag * shape, a.z + (b.z - a.z) * t - oz]);
  }
  return path;
}

/** One upright capsule per leg, leaning with the pose, so a pole is solid where it is drawn. */
function addLegColliders(
  ctx: ChunkContext,
  bodies: RAPIER.RigidBody[],
  colliders: RAPIER.Collider[],
  design: PoleDesign,
  baseX: number,
  baseY: number,
  baseZ: number,
  twist: number,
  angle: number,
  az: number,
): void {
  const rotation = leanRotation(angle, az);
  for (const leg of design.legs) {
    const mid = applyPoleRotation(leg.x, design.height * 0.5, 0, twist, angle, az);
    addStatic(
      ctx,
      bodies,
      colliders,
      baseX + mid.x,
      baseY + mid.y,
      baseZ + mid.z,
      RAPIER.ColliderDesc.capsule(design.height * 0.45, leg.r),
      SurfaceType.Concrete,
      rotation,
    );
  }
}

const _wireColour = new THREE.Color();
let _retroWireMaterial: THREE.LineBasicMaterial | null = null;
/** The retro rung's wire: unlit, like the dark silhouette a wire is against any sky. */
function retroWireMaterial(): THREE.LineBasicMaterial {
  return (_retroWireMaterial ??= new THREE.LineBasicMaterial({ vertexColors: true, fog: true }));
}

/** Per-vertex attribute: the wire's true radius, metres (`WireBuilder`, `wireMaterial`). */
const WIRE_RADIUS_ATTRIBUTE = 'wireRadius';

const WIRE_VERTEX_PARS = /* glsl */ `#include <common>
attribute float ${WIRE_RADIUS_ATTRIBUTE};
uniform float sceneFrameHeight;
varying float vWireCoverage;`;

// The vertex's own normal IS its radial direction (a tube ring's smooth normal, unit
// length, caps included: they share the rings' vertices), so the centreline is the
// vertex less its normal times the true radius, and the wire is redrawn about it at
// the clamped radius. Sized at the CENTRE's view depth, so a ring stays round, and by
// view depth rather than distance because a rectilinear projection draws a small
// object at a given depth the same size anywhere on screen. projectionMatrix[1][1] is
// 1 / tan(fov / 2): one pixel at depth z is 2z / (that x frame height) metres. Object
// space is taken for view space, which holds because a chunk is never scaled. Before
// the renderer has sized its target (height 0) the wire is drawn true.
const WIRE_VERTEX_WIDEN = /* glsl */ `#include <begin_vertex>
{
	vec3 wireCentre = position - normal * ${WIRE_RADIUS_ATTRIBUTE};
	float wireDepth = max( -( modelViewMatrix * vec4( wireCentre, 1.0 ) ).z, 0.0 );
	float wirePixel = sceneFrameHeight > 0.0
		? 2.0 * wireDepth / ( projectionMatrix[ 1 ][ 1 ] * sceneFrameHeight )
		: 0.0;
	float wireDrawn = max( ${WIRE_RADIUS_ATTRIBUTE}, wirePixel * ${(WIRE_MIN_WIDTH_PX / WIRE_NARROWEST_WIDTH).toFixed(4)} );
	transformed = wireCentre + normal * wireDrawn;
	vWireCoverage = ${WIRE_RADIUS_ATTRIBUTE} / max( wireDrawn, 1e-6 );
}`;

const WIRE_FRAGMENT_PARS = /* glsl */ `#include <common>
varying float vWireCoverage;`;

const WIRE_FRAGMENT_COVERAGE = /* glsl */ `#include <color_fragment>
	diffuseColor.a *= vWireCoverage;`;

let _wireMaterial: THREE.MeshStandardMaterial | null = null;
/**
 * The wires' material: the pole material (vertex colour, comic light unbanded), its
 * own object so the plain pole meshes keep their program, plus the pixel clamp of
 * `WIRE_MIN_WIDTH_PX`: a wire under a pixel is drawn a pixel wide and that much fainter.
 *
 * THE FADE IS ALPHA BLENDING, so the material is transparent. The alternatives were
 * worse. Alpha to coverage needs a multisampled target and the scene target is not
 * (core/renderer.ts, "NOT MULTISAMPLED"). A dithered discard is a pattern that crawls
 * as the wire moves across the pixel grid, the very thing being fixed and the thing
 * the Clean style exists to remove. Mixing the colour toward the fog instead is right
 * only against the horizon sky, and a wire seen from the chase camera crosses sand too,
 * where it would draw a pale line. Up close the coverage is exactly 1 and the wire
 * looks as it did; it is only drawn in the transparent pass instead of the opaque one.
 *
 * DEPTH WRITE STAYS ON. A chunk's wires are one mesh, sorted on that mesh's centre
 * against the other transparent things, which are all either far behind a wire (the
 * mirage tableaux, water) or right at the eye (car glass, spray, dust) and sort the
 * right way round. What depth buys is the post pass (render/hazeshader.ts), which
 * reads the scene's depth: without it a near wire against hot ground would take the
 * ground's depth and boil with it, and against the sky the ink gate would see the far
 * plane and leave it unoutlined. The price is that the
 * faint pixels of a far wire hide anything transparent drawn after them behind it:
 * one pixel wide, at a few per cent opacity.
 *
 * Casts no shadow, like the wire mesh it draws (a 1 cm wire's shadow was never drawn).
 */
function wireMaterial(): THREE.MeshStandardMaterial {
  if (_wireMaterial) return _wireMaterial;
  const material = makePoleMaterial();
  material.name = 'pole-wire';
  material.transparent = true;
  const previousCompile = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previousCompile.call(material, shader, renderer);
    shader.uniforms.sceneFrameHeight = sceneFrameHeight;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', WIRE_VERTEX_PARS)
      .replace('#include <begin_vertex>', WIRE_VERTEX_WIDEN);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', WIRE_FRAGMENT_PARS)
      .replace('#include <color_fragment>', WIRE_FRAGMENT_COVERAGE);
  };
  const previousKey = material.customProgramCacheKey;
  material.customProgramCacheKey = () => `${previousKey.call(material)}:pole-wire-v1`;
  _wireMaterial = material;
  return material;
}

/**
 * Every wire of a chunk as one INDEXED geometry: position, normal, colour and the true
 * radius `wireMaterial` widens about. It replaces `DwellingBuilder.tube`, which emits
 * every triangle's three corners apart and carries no extra stream. Same rings, same
 * parallel-transported frame, same smooth normals, so the same picture; the two end
 * caps are drawn on the end rings' own vertices, so they widen with the tube.
 *
 * Memory per wire (13 rings of 3): 39 vertices x 40 bytes (12 position, 12 normal,
 * 12 colour, 4 radius) and 222 16-bit indices, about 2.0 KB, where the builder's
 * 222 separate vertices x 36 bytes were 8.0 KB. The radius attribute adds 156 bytes a
 * wire; the chunk's wire geometry ends up about four times smaller than before.
 */
class WireBuilder {
  private readonly positions: number[] = [];
  private readonly normals: number[] = [];
  private readonly colours: number[] = [];
  private readonly radii: number[] = [];
  private readonly indices: number[] = [];

  tube(path: readonly P3[], radius: number, hex: number): void {
    const count = path.length;
    if (count < 2) return;
    const last = count - 1;
    const base = this.positions.length / 3;
    _wireColour.set(hex);
    wireTangent(path, 0, _wireTangent);
    if (Math.abs(_wireTangent.y) < 0.9) _wireNormal.set(0, 1, 0);
    else _wireNormal.set(1, 0, 0);
    for (let i = 0; i < count; i++) {
      wireTangent(path, i, _wireTangent);
      _wireNormal.addScaledVector(_wireTangent, -_wireNormal.dot(_wireTangent)).normalize();
      _wireBinormal.crossVectors(_wireTangent, _wireNormal);
      const p = path[i]!;
      for (let k = 0; k < WIRE_SIDES; k++) {
        const a = (k / WIRE_SIDES) * Math.PI * 2;
        const c = Math.cos(a);
        const s = Math.sin(a);
        const nx = c * _wireNormal.x + s * _wireBinormal.x;
        const ny = c * _wireNormal.y + s * _wireBinormal.y;
        const nz = c * _wireNormal.z + s * _wireBinormal.z;
        this.positions.push(p[0] + nx * radius, p[1] + ny * radius, p[2] + nz * radius);
        this.normals.push(nx, ny, nz);
        this.colours.push(_wireColour.r, _wireColour.g, _wireColour.b);
        this.radii.push(radius);
      }
    }
    // The ring runs counter-clockwise about the tangent, so (k, k+1 on this ring, k+1
    // on the next) faces outward.
    for (let i = 0; i < last; i++) {
      const ring = base + i * WIRE_SIDES;
      const next = ring + WIRE_SIDES;
      for (let k = 0; k < WIRE_SIDES; k++) {
        const l = (k + 1) % WIRE_SIDES;
        this.indices.push(ring + k, ring + l, next + l, ring + k, next + l, next + k);
      }
    }
    // Caps: the first faces back along the path, the last forward.
    const end = base + last * WIRE_SIDES;
    for (let k = 1; k + 1 < WIRE_SIDES; k++) {
      this.indices.push(base, base + k + 1, base + k);
      this.indices.push(end, end + k, end + k + 1);
    }
  }

  geometry(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(this.colours, 3));
    geometry.setAttribute(WIRE_RADIUS_ATTRIBUTE, new THREE.Float32BufferAttribute(this.radii, 1));
    // 16-bit indices until a chunk passes 65535 vertices (about 1700 wires), 32 after.
    geometry.setIndex(this.indices);
    return geometry;
  }
}

/** Central-difference tangent of `path` at point `i`, one-sided at the ends. */
function wireTangent(path: readonly P3[], i: number, out: THREE.Vector3): THREE.Vector3 {
  const a = path[Math.max(0, i - 1)]!;
  const b = path[Math.min(path.length - 1, i + 1)]!;
  return out.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
}

export class PoleProvider implements ChunkProvider {
  readonly id = 'poles';

  /** The drawn ground's sampler needs it: see `describePole`. */
  constructor(private readonly roadDistance: RoadDistance) {}

  build(ctx: ChunkContext): ChunkContent {
    const group = new THREE.Group();
    const bodies: RAPIER.RigidBody[] = [];
    const colliders: RAPIER.Collider[] = [];
    const poses: { pose: PolePose; section: PoleSection }[] = [];
    // Pole bodies by design geometry, drawn as one InstancedMesh each below.
    const bodyMatrices = new Map<THREE.BufferGeometry, THREE.Matrix4[]>();

    const seed = ctx.world.seed;
    const ox = ctx.originX;
    const oz = ctx.originZ;

    forEachPole(ctx.sStart, ctx.sEnd, (s, index, section) => {
      if (onLayby(ctx.road, seed, s)) return;
      const pose = describePole(ctx.road, ctx.terrain, this.roadDistance, seed, s, index, section);
      poses.push({ pose, section });

      poleQuaternion(pose.twist, pose.leanAngle, pose.leanAz, _poleQuat);
      _poleAt.set(pose.baseX - ox, pose.baseY, pose.baseZ - oz);
      const body = pose.fitted ? pose.design.full : pose.design.mast;
      const matrix = new THREE.Matrix4().compose(_poleAt, _poleQuat, _unitScale);
      const list = bodyMatrices.get(body);
      if (list) list.push(matrix);
      else bodyMatrices.set(body, [matrix]);

      const poleGroup = new THREE.Group();
      poleGroup.position.copy(_poleAt);
      poleGroup.quaternion.copy(_poleQuat);
      addAnomalyMeshes(poleGroup, pose);
      if (poleGroup.children.length > 0) group.add(poleGroup);

      // Every pole is a solid obstacle, including a scheduled 'down' one: the
      // colliders are built from the pose's own lean, so a mast lying in the sand is
      // solid where it lies rather than where it stood. Nothing is skipped, which is
      // why there is no flat-in-the-sand special case here.
      if (ctx.hasPhysics) {
        addLegColliders(ctx, bodies, colliders, pose.design, pose.baseX, pose.baseY, pose.baseZ, pose.twist, pose.leanAngle, pose.leanAz);
      }
    });

    // One InstancedMesh per design geometry: a chunk of poles is one draw per design.
    const bodyMeshes: THREE.InstancedMesh[] = [];
    for (const [geometry, matrices] of bodyMatrices) {
      const mesh = new THREE.InstancedMesh(geometry, poleMaterial(), matrices.length);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      matrices.forEach((matrix, i) => mesh.setMatrixAt(i, matrix));
      mesh.instanceMatrix.needsUpdate = true;
      // Culled on its instances' bounds: the design's own sphere sits at the pole root.
      mesh.computeBoundingSphere();
      group.add(mesh);
      bodyMeshes.push(mesh);
    }

    // Wires. The span may land in the next chunk, so its far end is recomputed from
    // the same pure function rather than read from a neighbour's content — otherwise
    // spans would flicker as chunks load around the boundary. Every wire of the chunk
    // goes into ONE geometry: a telegraph line is eight wires a span.
    const wires = new WireBuilder();
    // The retro rung draws each wire as a one-pixel line instead of a tube: a tube a
    // centimetre across is a fraction of a pixel at 360 lines from a few metres out, and
    // rasterised it breaks into a dotted trail (render/retro.ts). A line is always one
    // pixel, which is how every period game drew a wire.
    const retro = retroActive();
    const linePositions: number[] = [];
    const lineColours: number[] = [];
    let wireCount = 0;
    for (const { pose, section } of poses) {
      // The next pole that stands: one on a lay-by's pad is left out (`onLayby`), and
      // the line spans the pad to the pole beyond it.
      let nextIndex = pose.index + 1;
      let nextS = section.start + (nextIndex - section.firstIndex + 0.5) * section.spacing;
      while (onLayby(ctx.road, seed, nextS)) {
        nextIndex++;
        nextS += section.spacing;
      }
      // No span across a section boundary: the next design ties on elsewhere.
      if (nextIndex >= section.firstIndex + section.count || !pose.fitted) continue;
      const next = describePole(ctx.road, ctx.terrain, this.roadDistance, seed, nextS, nextIndex, section);
      if (!next.fitted) continue;
      // Either end being down makes the span slack, and a line that came down stays
      // attached: that is the whole read of a fallen pole.
      const slack = pose.anomaly === 'down' || next.anomaly === 'down';
      const wireChance = sectionCondition(section, pose.s).wireChance;
      pose.design.wires.forEach((wire, k) => {
        if (!slack && hash01(seed, TAG_WIRE, pose.index, k) >= wireChance) return;
        const a = worldOf(pose, wire.at);
        const b = worldOf(next, wire.at);
        const span = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
        // The clearance is the mean height of the two ties above their own poles'
        // ground, which is what the chord has to spend.
        const clearance = (a.y - pose.baseY + (b.y - next.baseY)) * 0.5;
        const path = catenary(a, b, wireSagMetres(slack, span, clearance), ox, oz);
        if (retro) {
          _wireColour.set(wire.hex);
          for (let i = 0; i < path.length - 1; i++) {
            linePositions.push(...path[i]!, ...path[i + 1]!);
            lineColours.push(_wireColour.r, _wireColour.g, _wireColour.b, _wireColour.r, _wireColour.g, _wireColour.b);
          }
        } else {
          wires.tube(path, wire.radius, wire.hex);
        }
        wireCount++;
      });
    }
    let wireGeometry: THREE.BufferGeometry | null = null;
    if (wireCount > 0 && retro) {
      wireGeometry = new THREE.BufferGeometry();
      wireGeometry.setAttribute('position', new THREE.Float32BufferAttribute(linePositions, 3));
      wireGeometry.setAttribute('color', new THREE.Float32BufferAttribute(lineColours, 3));
      group.add(new THREE.LineSegments(wireGeometry, retroWireMaterial()));
    } else if (wireCount > 0) {
      wireGeometry = wires.geometry();
      // Shadow flags left off, as `poleProgramAnchor`'s wire stand-in copies them.
      group.add(new THREE.Mesh(wireGeometry, wireMaterial()));
    }

    return {
      group,
      bodies,
      colliders,
      dispose: () => {
        wireGeometry?.dispose();
        for (const mesh of bodyMeshes) mesh.dispose();
      },
    };
  }
}

/**
 * Compiles the pole programs at boot. A chunk's pole bodies are InstancedMeshes, a
 * different program from a plain Mesh, and linking it on first draw would hitch on
 * Windows. A pole with an anomaly is a plain Mesh, and so is what hangs on it (tarp and
 * rope, nest, transformer can or loudspeaker, `poleFitting`), on the same plain material:
 * the `plain` anchor holds that program (before, the fittings had materials of their
 * own, and the first nest in view linked one mid-drive: 17 ms on the Mac, seed `flick`).
 * The wires are a plain Mesh too, on `wireMaterial` (transparent, its own patch: a
 * program of its own), and exist only once a chunk with a span streams in, so the
 * `wire` anchor is a real wire from `WireBuilder`, attribute for attribute.
 * The anchors are never drawn: their group stays invisible. Each copies the shadow flags
 * of the mesh it stands for.
 */
export function poleProgramAnchor(): THREE.Object3D {
  const group = new THREE.Group();
  group.name = 'pole-anchor';
  group.visible = false;
  const geometry = new THREE.BoxGeometry(0.01, 0.01, 0.01);
  const count = geometry.getAttribute('position').count;
  geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3).fill(1), 3));
  const anchor = new THREE.InstancedMesh(geometry, poleMaterial(), 1);
  anchor.castShadow = true;
  anchor.receiveShadow = true;
  const plain = new THREE.Mesh(geometry, plainPoleMaterial());
  plain.castShadow = true;
  plain.receiveShadow = true;
  const wires = new WireBuilder();
  wires.tube([[0, 0, 0], [0, 0, 0.01]], 0.001, 0xffffff);
  const wire = new THREE.Mesh(wires.geometry(), wireMaterial());
  group.add(anchor, plain, wire);
  return group;
}
