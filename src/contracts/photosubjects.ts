/**
 * The subjects a photograph can recognise, and the frame test that reads them at the
 * shutter.
 *
 * A subject is a named thing the world already places: a monument or artefact at a
 * 20 km mark, a roadside POI, a courier car, or a mirage. Each has a stable id built
 * from the same pure function of the seed that put the thing there, so the photo
 * errand (kinds/photoErrand.ts) can name one at generation and the shutter can
 * recognise it later — through a save, on another frame, with no world table.
 *
 * This module is a READER. It imports the placement functions and never changes what
 * they place. It also never imports `world/poi.ts` at runtime: the roadside POIs are
 * passed in by the caller (`poisBetween` there), which keeps the module free of the
 * poi → offers → registry → kinds → here edge.
 *
 * The frame test is not computer vision. At the shutter it builds a THREE.Frustum
 * from the camera, tests each nearby subject's bounding sphere, requires a minimum
 * share of the frame and a maximum distance, and asks the physics raycast whether
 * something large stands in the way. That is enough for "the mirage is in this
 * picture" and cheap enough to run once per exposure.
 */

import * as THREE from 'three';
import { couriersBetween, courierParkingLateral } from '../world/couriers';
import { monumentsBetween, type MonumentKind } from '../world/gradient';
import { structureDef } from '../world/poistructures';
import { ARTIFACT_EXTRA_SETBACK_M } from '../world/props/artifacts';
import { MirageSchedule } from '../render/mirage-schedule';
import type { Poi, PoiStock } from '../world/poi';
import type { Road } from '../world/road';
import type { Terrain } from '../world/terrain';
import type { PhotoEvidence } from '../items/items';

// ---------------------------------------------------------------------------
// Subject identity
// ---------------------------------------------------------------------------

export type PhotoSubjectCategory = 'monument' | 'poi' | 'courier' | 'mirage';

/**
 * One subject, with everything the frame test needs to place its bounding sphere
 * without querying the world again. A pure function of the seed: the enumeration
 * below rebuilds an identical list on any machine from the same world seed.
 */
export type PhotoSubjectSpec =
  | {
      readonly id: string;
      readonly category: 'monument';
      readonly s: number;
      readonly label: string;
      readonly radius: number;
      readonly side: -1 | 1;
      /** Metres from the asphalt edge, before the road's own half width is added. */
      readonly setback: number;
      readonly artifact: boolean;
    }
  | {
      readonly id: string;
      readonly category: 'poi';
      readonly s: number;
      readonly label: string;
      readonly radius: number;
      readonly lateral: number;
    }
  | {
      readonly id: string;
      readonly category: 'courier';
      readonly s: number;
      readonly label: string;
      readonly radius: number;
      readonly lateral: number;
    }
  | {
      readonly id: string;
      readonly category: 'mirage';
      readonly s: number;
      readonly label: string;
      readonly radius: number;
      /** The mirage schedule encounter; the render systems report it by this index. */
      readonly index: number;
    };

/** The road-side subject list, resolved lazily from the world seed. */
export type PhotoSubjectsProvider = (fromS: number, toS: number) => readonly PhotoSubjectSpec[];

/** Bounding radii for the frame test, metres. */
const MONUMENT_ARTIFACT_RADIUS_M = 4;
const MONUMENT_SIGN_RADIUS_M = 2;
const COURIER_RADIUS_M = 2.6;
/**
 * A vessel is a 34–62 m tall object drawn "impossibly large" half a kilometre off the
 * road, and the only anchor the schedule gives is its foot, so the sphere is its own
 * height: that is what makes it legible from the road at all, and it is the only
 * subject whose largest view is also its farthest.
 */
const VESSEL_RADIUS_M = 60;
/** A tableau straddles the road; the player drives into it, so a modest sphere. */
const TABLEAU_RADIUS_M = 50;

/** The four categories, in the fixed order the errand draws a category from. */
export const PHOTO_SUBJECT_CATEGORIES: readonly PhotoSubjectCategory[] = [
  'monument',
  'poi',
  'courier',
  'mirage',
];

const MONUMENT_LABELS: Record<MonumentKind, string> = {
  distance_sign: 'distance sign',
  monolith: 'monolith',
  orbit: 'orbit',
  bloom: 'bloom',
  gate: 'gate',
};

const POI_LABELS: Record<PoiStock, string> = {
  fuel: 'gas station',
  store: 'roadside store',
  home: 'house by the road',
  salvage: 'salvage yard',
  scrap: 'scrapyard',
  mast: 'radio mast',
};

function kmText(s: number): string {
  return `at km ${Math.round(s / 1000)}`;
}

/**
 * Every subject whose arclength falls in [fromS, toS), from the world seed and the
 * roadside POIs the caller has already resolved for the range.
 */
export function photoSubjects(
  seed: number,
  fromS: number,
  toS: number,
  pois: readonly Poi[],
): PhotoSubjectSpec[] {
  const out: PhotoSubjectSpec[] = [];

  for (const m of monumentsBetween(seed, fromS, toS)) {
    if (m.s < fromS || m.s >= toS) continue;
    const artifact = m.kind !== 'distance_sign';
    out.push({
      id: `monument:${m.s}`,
      category: 'monument',
      s: m.s,
      label: `the ${MONUMENT_LABELS[m.kind]} ${kmText(m.s)}`,
      radius: artifact ? MONUMENT_ARTIFACT_RADIUS_M : MONUMENT_SIGN_RADIUS_M,
      side: m.side,
      setback: m.setback,
      artifact,
    });
  }

  for (const poi of pois) {
    if (poi.s < fromS || poi.s >= toS) continue;
    const footprint = structureDef(poi.structure).footprint;
    out.push({
      id: `poi:${poi.index}`,
      category: 'poi',
      s: poi.s,
      label: `a ${POI_LABELS[poi.stock]} ${kmText(poi.s)}`,
      radius: Math.hypot(footprint[0], footprint[1]) / 2,
      lateral: poi.lateral,
    });
  }

  // A courier parks on the POI side of the road, so its lateral comes from that POI.
  // The POIs handed in cover the same range, so the match is exact; a courier whose
  // POI is not in the list is skipped rather than placed at a guessed lateral.
  for (const stop of couriersBetween(seed, fromS, toS)) {
    const poi = pois.find((candidate) => Math.abs(candidate.s - stop.s) < 1e-6);
    if (!poi) continue;
    out.push({
      id: `courier:${stop.index}`,
      category: 'courier',
      s: stop.s,
      label: `a courier car ${kmText(stop.s)}`,
      radius: COURIER_RADIUS_M,
      lateral: courierParkingLateral(poi.lateral),
    });
  }

  for (const encounter of new MirageSchedule(seed, toS).encounters) {
    if (encounter.startS < fromS || encounter.startS >= toS) continue;
    out.push({
      id: `mirage:${encounter.index}`,
      category: 'mirage',
      s: encounter.startS,
      label: 'a mirage',
      radius: encounter.apparition.system === 'tableau' ? TABLEAU_RADIUS_M : VESSEL_RADIUS_M,
      index: encounter.index,
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// The frame test
// ---------------------------------------------------------------------------

/** What a mirage render system reports about the encounter it is drawing right now. */
export interface VisibleMirage {
  readonly encounterIndex: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly opacity: number;
}

/** True when something large stands between two scene-space points. */
export type OcclusionProbe = (
  fromX: number,
  fromY: number,
  fromZ: number,
  toX: number,
  toY: number,
  toZ: number,
  radius: number,
) => boolean;

export interface PhotoFrame {
  readonly seed: number;
  readonly road: Road;
  readonly terrain: Terrain;
  /** The THREE.PerspectiveCamera the frame is drawn with. */
  readonly camera: THREE.PerspectiveCamera;
  readonly originX: number;
  readonly originZ: number;
  /** Sky day factor at the shutter; a mirage only counts in daylight. */
  readonly dayFactor: number;
  readonly pois: (fromS: number, toS: number) => readonly Poi[];
  readonly visibleMirage: VisibleMirage | null;
  readonly occluded?: OcclusionProbe;
}

/** Road metres either side of the player searched for subjects at the shutter. */
export const PHOTO_SUBJECT_WINDOW_M = 2_600;
/**
 * The subject's drawn radius must cover this share of the half-frame height. The
 * half-angle is `radius / distance`; divided by `tan(fov/2)` it is 1 when the disc
 * fills half the frame, so 0.05 is 2.5 % of the frame height — a landmark that is
 * unmistakably in the picture rather than a speck on the horizon.
 */
const MIN_FRAME_SHARE = 0.05;
/** The closer framing an errand's signature asks of ITS subject (7 % of the height). */
const CLOSE_FRAME_SHARE = 0.14;
/** Farther than this nothing is legible (a vessel shows at up to ~1.6 km). */
const MAX_SUBJECT_DISTANCE_M = 1_800;
/** A mirage counts only when it is actually drawn, and drawn brightly enough. */
const MIN_MIRAGE_OPACITY = 0.15;
const MIN_MIRAGE_DAY_FACTOR = 0.13;

/**
 * Where a subject stands, absolute. Null for a mirage that is not visible now: the
 * schedule knows where it *would* be, but a photograph must not credit an apparition
 * the player cannot see.
 */
export function resolvePhotoSubject(
  spec: PhotoSubjectSpec,
  road: Road,
  terrain: Terrain,
  visibleMirage: VisibleMirage | null,
  dayFactor: number,
): { x: number; y: number; z: number } | null {
  if (spec.category === 'mirage') {
    if (dayFactor <= MIN_MIRAGE_DAY_FACTOR) return null;
    if (!visibleMirage || visibleMirage.encounterIndex !== spec.index) return null;
    if (visibleMirage.opacity < MIN_MIRAGE_OPACITY) return null;
    return { x: visibleMirage.x, y: visibleMirage.y, z: visibleMirage.z };
  }
  const lateral =
    spec.category === 'monument'
      ? spec.side * (road.halfWidthAt(spec.s) + spec.setback + (spec.artifact ? ARTIFACT_EXTRA_SETBACK_M : 0))
      : spec.lateral;
  const point = road.offsetPoint(spec.s, lateral);
  return { x: point.x, y: terrain.heightAt(point.x, point.z, spec.s), z: point.z };
}

/**
 * The subjects a frame contains, and the close-framed subset. Everything it decides
 * is decided from the camera and the subject geometry alone.
 */
export function photoFrameSubjects(
  frame: PhotoFrame,
  candidates: readonly PhotoSubjectSpec[],
): { readonly subjects: readonly string[]; readonly subjectsClose: readonly string[] } {
  const camera = frame.camera;
  camera.updateMatrixWorld();
  const projection = new THREE.Matrix4().multiplyMatrices(
    camera.projectionMatrix,
    camera.matrixWorldInverse,
  );
  const frustum = new THREE.Frustum().setFromProjectionMatrix(projection);
  const halfTan = Math.tan((camera.fov * Math.PI) / 360);
  const eye = camera.position;
  const centre = new THREE.Vector3();
  const ndc = new THREE.Vector3();
  const sphere = new THREE.Sphere();
  const subjects: string[] = [];
  const subjectsClose: string[] = [];
  for (const spec of candidates) {
    const at = resolvePhotoSubject(spec, frame.road, frame.terrain, frame.visibleMirage, frame.dayFactor);
    if (!at) continue;
    // Scene space is origin-relative; the subject is absolute.
    centre.set(at.x - frame.originX, at.y, at.z - frame.originZ);
    const dx = centre.x - eye.x;
    const dy = centre.y - eye.y;
    const dz = centre.z - eye.z;
    const distance = Math.hypot(dx, dy, dz);
    if (distance > MAX_SUBJECT_DISTANCE_M || distance < spec.radius * 0.5) continue;
    sphere.set(centre, spec.radius);
    if (!frustum.intersectsSphere(sphere)) continue;
    // The centre must also be on screen; a huge sphere can graze the frustum with
    // everything it owns off the edge of the frame.
    ndc.copy(centre).project(camera);
    if (ndc.z > 1 || Math.abs(ndc.x) > 1 || Math.abs(ndc.y) > 1) continue;
    const share = spec.radius / distance / halfTan;
    if (share < MIN_FRAME_SHARE) continue;
    if (
      frame.occluded
      && frame.occluded(eye.x, eye.y, eye.z, centre.x, centre.y, centre.z, spec.radius)
    ) {
      continue;
    }
    subjects.push(spec.id);
    if (share >= CLOSE_FRAME_SHARE) subjectsClose.push(spec.id);
  }
  return { subjects, subjectsClose };
}

/**
 * The evidence record for one exposure: the subjects found in a window around the
 * player, and the frame the test read. Called once, at the shutter.
 */
export function photoEvidence(
  frame: PhotoFrame,
  roadS: number,
  timeOfDay: number,
  playedS: number,
): PhotoEvidence {
  const window = PHOTO_SUBJECT_WINDOW_M;
  const candidates = photoSubjects(frame.seed, roadS - window, roadS + window, frame.pois(roadS - window, roadS + window));
  const { subjects, subjectsClose } = photoFrameSubjects(frame, candidates);
  const eye = frame.camera.position;
  const direction = new THREE.Vector3();
  frame.camera.getWorldDirection(direction);
  return {
    subjects,
    subjectsClose,
    roadS,
    timeOfDay,
    playedS,
    cameraPosition: { x: eye.x + frame.originX, y: eye.y, z: eye.z + frame.originZ },
    cameraDirection: { x: direction.x, y: direction.y, z: direction.z },
  };
}
