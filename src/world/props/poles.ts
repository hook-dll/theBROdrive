/**
 * Roadside props, the pole line: the lampposts beside the road, the anomalies the
 * director's 'poleAnomaly' events leave on them, and the derelicts an era band with
 * no line of its own gets instead.
 *
 * Every prop is a pure function of the integer seed via stateless hashing, so a
 * chunk builds identically whether it is generated in order or revisited later.
 * Nothing here owns game state; chunk content is a derived view of the seed.
 *
 * Poles are a handful per chunk, so they use ordinary meshes rather than the
 * scatter's instancing.
 */

import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { hash01 } from '../../core/rng';
import { SURFACES, SurfaceType } from '../../core/surfaces';
import type { WetGlints } from '../../render/wetglints';
import { varietyEventOfKindAt, varietyEventsBetween } from '../director';
import { poleConditionAt, poleEraSegments, type PoleCondition, type PoleEra } from '../gradient';
import type { Road } from '../road';
import type { Terrain } from '../terrain';
import type { ChunkContext, ChunkContent, ChunkProvider } from '../chunks';

import { deformIcosahedron, matDeadStick } from './forms';
import { addStatic, leanRotation } from './scatter';

// ---------------------------------------------------------------------------
// Scratch objects reused across the per-chunk build loops (never per-frame).
// ---------------------------------------------------------------------------
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _axis = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3();

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
 * A street lamp's brightness to the wet-road reflections, in the headlights' units
 * (render/wetglints.ts): a sodium head seen at a glance is about a dipped headlight.
 */
const LAMP_GLINT = 9;
const DOWN = new THREE.Vector3(0, -1, 0);
const glintScratch = new THREE.Vector3();
/**
 * How far the concrete lamp arm reaches from its pole, metres. The poles stand at
 * poles stand `POLE_SETBACK_M` = 3.1 m outside the asphalt edge and the gravel verge
 * is 3.5 m wide, so 2.4 hangs the head 0.7 m outside that edge: over the gravel,
 * which is where the light pool wants to sit to cover the near lane. The reach is a
 * constant because the setback is: the head keeps its 0.7 m at any road width.
 */
const LAMP_ARM_REACH = 2.4;

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

// Timber that has stood forty winters goes silver-grey, not brown.
export const matTimber = new THREE.MeshStandardMaterial({ color: 0x5d554b, roughness: 0.95, metalness: 0 });
/** Pin insulators: the pale green glass of the Soviet line, catching the light. */
const matInsulator = new THREE.MeshStandardMaterial({ color: 0x8fb8a6, roughness: 0.18, metalness: 0.05 });
/** Galvanised steel: crossarms of the concrete line, and the bands tying timber to its stub. */
const matSteel = new THREE.MeshStandardMaterial({ color: 0x5f6266, roughness: 0.6, metalness: 0.5 });
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
export const matChrome = new THREE.MeshStandardMaterial({
  color: 0xd8d8d8,
  roughness: 0.15,
  metalness: 0.95,
  emissive: 0x202020,
  emissiveIntensity: 0.6,
});
export const matSignPost = new THREE.MeshStandardMaterial({ color: 0x5a5a5e, roughness: 0.7, metalness: 0.4 });
export const matRust = new THREE.MeshStandardMaterial({ color: 0x6b4a32, roughness: 0.85, metalness: 0.25 });

// Anomaly fittings. The tarp is sun-bleached canvas — grey with the warmth burnt out
// of it — because a saturated cloth on a pole reads as a flag and therefore as
// somebody being here now, which is the opposite of what a wrapped pole says. The
// gear is the pale green-grey of painted line equipment, the one manufactured colour
// the desert never produces by itself.
const matTarp = new THREE.MeshStandardMaterial({ color: 0x9c9686, roughness: 1.0, metalness: 0 });
const matGear = new THREE.MeshStandardMaterial({ color: 0x69706a, roughness: 0.62, metalness: 0.35 });

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
/**
 * Invokes cb(s, index) for every pole whose arclength lies in [sStart, sEnd). Exported
 * with `describePole` as the pole line's pure description: the chunk batches each pole's
 * meshes into one geometry, so the line can only be measured from here
 * (tools/roadside-setback.ts).
 */
export function forEachPole(sStart: number, sEnd: number, cb: (s: number, index: number) => void): void {
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

export interface PolePose {
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
export function describePole(road: Road, terrain: Terrain, seed: number, s: number, index: number): PolePose {
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
    _timberCrossarm = mergeGeometries([arm, outrigger, drop]);
  }
  return _timberCrossarm;
}

/** A pin insulator: a glass bell on its steel pin. Stood at the local origin. */
function insulatorAt(x: number, y: number, z: number): THREE.BufferGeometry {
  const bell = new THREE.CylinderGeometry(0.045, 0.075, 0.13, 7, 1).translate(x, y + 0.1, z);
  const skirt = new THREE.CylinderGeometry(0.075, 0.08, 0.03, 7, 1).translate(x, y + 0.03, z);
  return mergeGeometries([bell, skirt]);
}

let _timberInsulators: THREE.BufferGeometry | null = null;
function timberInsulators(): THREE.BufferGeometry {
  if (!_timberInsulators) {
    _timberInsulators = mergeGeometries([insulatorAt(-0.62, 6.13, 0), insulatorAt(0.62, 6.13, 0), insulatorAt(-0.2, 6.13, 0)]);
  }
  return _timberInsulators;
}

let _timberStub: THREE.BufferGeometry | null = null;
/**
 * THE STUB (pasynok): the concrete foot a Russian timber pole is strapped to, so the
 * wood never stands in wet ground. It stands on the field side of the shaft, two
 * metres of it showing, the shaft's butt lifted clear of the grass.
 */
function timberStub(): THREE.BufferGeometry {
  if (!_timberStub) {
    _timberStub = new THREE.BoxGeometry(0.17, 2.6, 0.2).translate(-0.19, 0.95, 0);
  }
  return _timberStub;
}

let _timberBands: THREE.BufferGeometry | null = null;
function timberBands(): THREE.BufferGeometry {
  if (!_timberBands) {
    const band = (y: number): THREE.BufferGeometry =>
      new THREE.CylinderGeometry(0.25, 0.25, 0.05, 8, 1, true).scale(1, 1, 0.75).translate(-0.09, y, 0);
    _timberBands = mergeGeometries([band(0.9), band(1.9)]);
  }
  return _timberBands;
}

let _concreteHardware: THREE.BufferGeometry | null = null;
/** Steel crossarm at the head of a concrete pole. */
function concreteCrossarm(): THREE.BufferGeometry {
  if (!_concreteHardware) {
    const arm = new THREE.BoxGeometry(1.9, 0.07, 0.07).translate(0, 8.55, 0);
    const brace = cylinderBetween(new THREE.Vector3(-0.6, 8.52, 0), new THREE.Vector3(0, 8.0, 0), 0.025, 4);
    const brace2 = cylinderBetween(new THREE.Vector3(0.6, 8.52, 0), new THREE.Vector3(0, 8.0, 0), 0.025, 4);
    _concreteHardware = mergeGeometries([arm, brace, brace2]);
  }
  return _concreteHardware;
}

let _concreteInsulators: THREE.BufferGeometry | null = null;
function concreteInsulators(): THREE.BufferGeometry {
  if (!_concreteInsulators) {
    _concreteInsulators = mergeGeometries([insulatorAt(-0.85, 8.59, 0), insulatorAt(0.85, 8.59, 0), insulatorAt(0, 8.98, 0)]);
  }
  return _concreteInsulators;
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
    // The SV pole: a SQUARE section tapering to the head, not a round column. Four
    // radial segments turned 45 degrees give the flat faces the comic light bands.
    const col = new THREE.CylinderGeometry(0.1, 0.2, 9.0, 4, 1).rotateY(Math.PI / 4).translate(0, 4.5, 0);
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
      poleGroup.add(new THREE.Mesh(timberStub(), matConcrete));
      poleGroup.add(new THREE.Mesh(timberBands(), matSteel));
      if (pose.hasCrossarm) {
        poleGroup.add(new THREE.Mesh(timberCrossarm(), matTimber));
        poleGroup.add(new THREE.Mesh(timberInsulators(), matInsulator));
      }
      break;
    case 'lattice':
      poleGroup.add(new THREE.Mesh(latticeMast(), matLattice));
      break;
    case 'concrete':
      poleGroup.add(new THREE.Mesh(concreteColumn(), matConcrete));
      poleGroup.add(new THREE.Mesh(concreteCrossarm(), matSteel));
      poleGroup.add(new THREE.Mesh(concreteInsulators(), matInsulator));
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

type LampPos = { x: number; y: number; z: number; ground: number };

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

/**
 * Pieces of a chunk's pole line gathered by material, to be drawn as one mesh each.
 *
 * Built as a group per pole, the line cost six draws a pole and one a span: 232 of a
 * frame's 476 draws in a measured drive, for about 600 triangles a chunk. Nothing on
 * a pole moves once it is built, so each piece is baked into chunk space and merged.
 */
class PoleBatch {
  private readonly pieces = new Map<THREE.Material, THREE.BufferGeometry[]>();

  /** Bakes every mesh under `root` (which must have no parent) into the batch. */
  add(root: THREE.Object3D): void {
    root.updateMatrixWorld(true);
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      this.addGeometry(object.geometry as THREE.BufferGeometry, object.material as THREE.Material, object.matrixWorld);
    });
  }

  addGeometry(geometry: THREE.BufferGeometry, material: THREE.Material, matrix?: THREE.Matrix4): void {
    const piece = new THREE.BufferGeometry();
    piece.setAttribute('position', geometry.getAttribute('position').clone());
    const normal = geometry.getAttribute('normal');
    if (normal) piece.setAttribute('normal', normal.clone());
    else piece.computeVertexNormals();
    const index = geometry.getIndex();
    if (index) piece.setIndex(Array.from(index.array as ArrayLike<number>));
    else piece.setIndex(Array.from({ length: piece.getAttribute('position').count }, (_, i) => i));
    if (matrix) piece.applyMatrix4(matrix);
    let list = this.pieces.get(material);
    if (!list) this.pieces.set(material, (list = []));
    list.push(piece);
  }

  /** One mesh per material into `group`; returns the merged geometries to dispose. */
  flush(group: THREE.Group): THREE.BufferGeometry[] {
    const merged: THREE.BufferGeometry[] = [];
    for (const [material, list] of this.pieces) {
      const geometry = mergeGeometries(list);
      for (const piece of list) piece.dispose();
      if (!geometry) continue;
      group.add(new THREE.Mesh(geometry, material));
      merged.push(geometry);
    }
    this.pieces.clear();
    return merged;
  }
}

export class PoleProvider implements ChunkProvider {
  readonly id = 'poles';

  build(ctx: ChunkContext): ChunkContent {
    const group = new THREE.Group();
    const bodies: RAPIER.RigidBody[] = [];
    const colliders: RAPIER.Collider[] = [];
    const batch = new PoleBatch();
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
      batch.add(poleGroup);

      if (pose.hasLamp && pose.lampWorks) {
        // Lamps are stored relative to the chunk origin: these positions also set
        // the invisible source-marker PointLights (children of `group`), so they
        // must be group-local. The distance test against the camera re-adds the
        // captured build origin in `setLamps` (see `setNearestLampSources`).
        workingLamps.push({ x: pose.lampX - ox, y: pose.lampY, z: pose.lampZ - oz, ground: pose.baseY });
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
      batch.addGeometry(wireGeo, matWire);
      wireGeo.dispose();
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
    const merged = batch.flush(group);

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
    let lampsOn = 0;

    return {
      group,
      bodies,
      colliders,
      dispose: () => {
        for (const g of merged) g.dispose();
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
        lampsOn = on;
        setLampEmission(on);
        setNearestLampSources(workingLamps, nearX, nearZ, ox, oz, on, lampSources);
      },
      /**
       * Every working lamp of the chunk, at its fixture's own brightness: the light
       * budget above lights the ground from three of them, the reflections take all.
       * Stored positions are group-local; the group's position carries the rebase.
       */
      offerGlints(glints: WetGlints): void {
        if (!(lampsOn > 0)) return;
        for (const lamp of workingLamps) {
          glintScratch.set(lamp.x + group.position.x, lamp.y, lamp.z + group.position.z);
          glints.addLamp(glintScratch, lamp.ground, DOWN, 0, LAMP_COLOR, LAMP_GLINT * lampsOn);
        }
      },
    };
  }
}
