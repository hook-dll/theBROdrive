/**
 * The plan families drawn around the one service cabin (docs/toilet-poi-design.md,
 * "Families"). The cabin and its interior are geometry.ts's; a family adds the volumes
 * that make the building read as its architect's gesture from the road:
 *
 *  - row:     sealed rooms either side of the cabin in one row, under the cabin's roof;
 *  - cluster: separate huts scattered about it, each under its own roof of the cabin's kind;
 *  - vessel:  one concave curved wall wrapping behind it, its rim rising to tips either
 *             side of the door, faucets at several heights on its inner face;
 *  - eave:    a round or oval eave over everything, on a louvre ring or columns, booths beneath;
 *  - canopy:  one long deflected, folded or slanted slab on columns over it and sealed cubes.
 *
 * Every builder has a `familyReach` twin summing the same numbers into the authored
 * footprint, so placement and the measured building agree (tools/toilet-check.ts).
 */

import * as THREE from 'three';
import { box, cylinder, geometryCache, material } from '../poi/kit';
import {
  annex,
  annexReach,
  column,
  COLUMN_RADIUS,
  drumCentreZ,
  PLINTH_MARGIN,
  roofHalf,
  type AnnexLook,
  type RoofOutline,
  type Reach,
} from './parts';
import type { ToiletCanopy, ToiletForm, ToiletShellSpec, ToiletVariant } from './types';

type VesselForm = Extract<ToiletForm, { family: 'vessel' }>;

const VESSEL_STEPS = 24;
/** Between the vessel's inner face and the cabin's roof or plinth, at the least. */
const VESSEL_CLEARANCE = 0.15;
const EAVE_SIDES = 32;
const STEEL = 0x9aa0a2;
const PORCELAIN = 0xf2f0ea;

/** What the cabin's plinth and roof cover: the whole row for a row, the drum for a drum, else the cabin. */
export function cabinOutline(shell: ToiletShellSpec): RoofOutline {
  const { width: w, depth: d } = shell;
  if (shell.drum !== undefined) return { kind: 'circle', x: 0, z: drumCentreZ(w, d, shell.drum), radius: shell.drum };
  if (shell.form.family !== 'row') return { kind: 'rect', x: 0, z: 0, width: w, depth: d };
  let left = -w / 2;
  let right = w / 2;
  for (const room of shell.form.rooms) {
    if (room.side === 'left') left -= room.width;
    else right += room.width;
  }
  return { kind: 'rect', x: (left + right) / 2, z: 0, width: right - left, depth: d };
}

/** How the booths of a family look: their own plinths, sealed, roofed only in a cluster. */
function boothLook(shell: ToiletShellSpec, family: ToiletForm['family']): AnnexLook {
  const cluster = family === 'cluster';
  return {
    palette: shell.palette,
    pattern: shell.wallPattern,
    plinth: family !== 'row',
    roof: cluster ? shell.roof : null,
    overhang: cluster ? shell.overhang : 0,
    louvres: cluster && shell.dressing.includes('louvres'),
  };
}

/** Builds the family's volumes into `root`, around a cabin geometry.ts has built. */
export function buildFamily(root: THREE.Group, variant: ToiletVariant): void {
  const { shell } = variant;
  const { form } = shell;
  const look = boothLook(shell, form.family);
  switch (form.family) {
    case 'cabin':
      return;
    case 'row': {
      if (shell.drum !== undefined) throw new Error(`${variant.id}: a row needs a rectangular cabin`);
      const edge = { left: -shell.width / 2, right: shell.width / 2 };
      form.rooms.forEach((room, index) => {
        const sign = room.side === 'left' ? -1 : 1;
        const x = edge[room.side] + (sign * room.width) / 2;
        edge[room.side] += sign * room.width;
        annex(root, { shape: 'box', x, z: 0, yaw: 0, width: room.width, depth: shell.depth, height: shell.height, color: room.color }, look, index + 1);
      });
      return;
    }
    case 'cluster':
      form.huts.forEach((hut, index) => annex(root, hut, look, index + 1));
      return;
    case 'vessel':
      vessel(root, variant, form);
      return;
    case 'eave': {
      const { eave } = form;
      const disc = cylinder(root, 1, 1, eave.thickness, EAVE_SIDES, [eave.x, eave.y + eave.thickness / 2, eave.z], eave.color);
      disc.scale.set(eave.radiusX, 1, eave.radiusZ);
      disc.userData.poiRoof = true;
      disc.userData.toiletPart = 'cover';
      const ring = form.louvres;
      if (ring) {
        for (let i = 0; i < ring.count; i++) {
          const angle = (2 * Math.PI * i) / ring.count;
          const fromBack = Math.min(angle, 2 * Math.PI - angle);
          if (fromBack < ring.entrance || Math.abs(angle - Math.PI) < ring.entrance) continue;
          const fin = box(root, [ring.width, eave.y, ring.depth], [ring.radius * Math.sin(angle), eave.y / 2, ring.radius * Math.cos(angle)], ring.color, [0, angle, 0]);
          fin.userData.toiletPart = 'louvre';
        }
      }
      form.booths.forEach((booth, index) => annex(root, booth, look, index + 1));
      for (const [x, z] of form.columns) column(root, x, z, eave.y, shell.palette.trim);
      return;
    }
    case 'canopy': {
      const { canopy } = form;
      const slab = new THREE.Mesh(canopyGeometry(canopy), material(canopy.color));
      slab.position.set(canopy.x, 0, canopy.z);
      slab.castShadow = true;
      slab.receiveShadow = true;
      slab.userData.poiRoof = true;
      slab.userData.toiletPart = 'cover';
      root.add(slab);
      form.cubes.forEach((cube, index) => annex(root, cube, look, index + 1));
      for (const [x, z] of form.columns) {
        if (Math.abs(x - canopy.x) > canopy.length / 2 || Math.abs(z - canopy.z) > canopy.width / 2) {
          throw new Error(`${variant.id}: a column at ${x}, ${z} stands outside its canopy`);
        }
        column(root, x, z, canopyUnderside(canopy, x), shell.palette.trim);
      }
      return;
    }
  }
}

/** Adds where the family's volumes reach; the cabin's own reach is geometry.ts's. */
export function familyReach(shell: ToiletShellSpec, reach: Reach): void {
  const { form } = shell;
  const look = boothLook(shell, form.family);
  switch (form.family) {
    case 'cabin':
    case 'row':
      // A row's rooms are inside the cabin outline its plinth and roof already cover.
      return;
    case 'cluster':
      for (const hut of form.huts) annexReach(reach, hut, look);
      return;
    case 'vessel': {
      const cz = -shell.depth / 2;
      for (const { theta, top } of vesselStations(form)) {
        for (const y of [0, top]) {
          const r = vesselRadius(form, 1, y);
          reach.point(r * Math.sin(theta), cz + r * Math.cos(theta));
        }
      }
      return;
    }
    case 'eave': {
      const { eave, louvres: ring } = form;
      reach.rect(eave.x, eave.z, eave.radiusX, eave.radiusZ);
      if (ring) reach.circle(0, 0, ring.radius + Math.hypot(ring.width, ring.depth) / 2);
      for (const booth of form.booths) annexReach(reach, booth, look);
      for (const [x, z] of form.columns) reach.circle(x, z, COLUMN_RADIUS);
      return;
    }
    case 'canopy': {
      const { canopy } = form;
      reach.rect(canopy.x, canopy.z, canopy.length / 2, canopy.width / 2);
      for (const cube of form.cubes) annexReach(reach, cube, look);
      for (const [x, z] of form.columns) reach.circle(x, z, COLUMN_RADIUS);
      return;
    }
  }
}

/** The vessel's stations from one tip round the back to the other, and its rim height at each. */
function vesselStations(form: VesselForm): { readonly theta: number; readonly top: number }[] {
  const stations: { theta: number; top: number }[] = [];
  for (let i = 0; i <= VESSEL_STEPS; i++) {
    const share = (2 * i) / VESSEL_STEPS - 1;
    stations.push({ theta: share * form.sweep, top: form.back + (form.tips - form.back) * share * share });
  }
  return stations;
}

/** Radius of the vessel's outer (`side` 1) or inner (-1) face at height `y`: it flares as it rises. */
function vesselRadius(form: VesselForm, side: 1 | -1, y: number): number {
  return form.radius + (side * form.thickness) / 2 + y * Math.tan(form.flare);
}

function vessel(root: THREE.Group, variant: ToiletVariant, form: VesselForm): void {
  const { shell } = variant;
  const cz = -shell.depth / 2;
  // The vessel must clear the cabin's roof and plinth all round.
  const outline = cabinOutline(shell);
  const [hx, hz] = roofHalf(shell.roof, outline, Math.max(shell.overhang, PLINTH_MARGIN));
  const farthest = Math.hypot(Math.abs(outline.x) + hx, Math.abs(outline.z - cz) + hz);
  if (vesselRadius(form, -1, 0) < farthest + VESSEL_CLEARANCE) {
    throw new Error(`${variant.id}: the vessel's inner face at ${vesselRadius(form, -1, 0).toFixed(2)} m does not clear the cabin (${farthest.toFixed(2)} m)`);
  }
  const wall = new THREE.Mesh(vesselGeometry(form, cz), material(form.color));
  wall.castShadow = true;
  wall.receiveShadow = true;
  wall.userData.toiletPart = 'vessel';
  root.add(wall);

  // Faucets alternate sides, spread over the forward half of each wing.
  const perSide = Math.ceil(form.faucets.length / 2);
  form.faucets.forEach((y, k) => {
    const side = k % 2 === 0 ? -1 : 1;
    const slot = Math.floor(k / 2);
    const theta = side * form.sweep * (0.5 + (0.38 * (slot + 0.5)) / perSide);
    const tap = new THREE.Group();
    tap.position.set(0, 0, cz);
    tap.rotation.y = theta;
    tap.userData.toiletPart = 'faucet';
    root.add(tap);
    // Local +Z runs out from the vessel's centre through the wall.
    const inner = vesselRadius(form, -1, y);
    cylinder(tap, 0.02, 0.02, 0.16, 6, [0, y, inner - 0.08], STEEL, [Math.PI / 2, 0, 0]);
    const basinTop = y - 0.17;
    box(tap, [0.42, 0.1, 0.3], [0, basinTop - 0.05, vesselRadius(form, -1, basinTop) + 0.02 - 0.15], PORCELAIN);
  });
}

/**
 * The vessel wall: outer and inner faces, rim and the two tip ends, flat-shaded. Each
 * quad is wound to face `towards`, so the faces point out of the solid.
 */
function vesselGeometry(form: VesselForm, cz: number): THREE.BufferGeometry {
  const key = `toilet-vessel:${form.radius}:${form.sweep}:${form.back}:${form.tips}:${form.flare}:${form.thickness}:${cz}`;
  let geometry = geometryCache.get(key);
  if (geometry) return geometry;
  const positions: number[] = [];
  const at = (theta: number, side: 1 | -1, y: number): THREE.Vector3 => {
    const r = vesselRadius(form, side, y);
    return new THREE.Vector3(r * Math.sin(theta), y, cz + r * Math.cos(theta));
  };
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  const quad = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, towards: THREE.Vector3): void => {
    const facing = ab.subVectors(b, a).cross(ac.subVectors(c, a)).dot(towards) >= 0;
    const order = facing ? [a, b, c, a, c, d] : [a, c, b, a, d, c];
    for (const p of order) positions.push(p.x, p.y, p.z);
  };
  const up = new THREE.Vector3(0, 1, 0);
  const stations = vesselStations(form);
  for (let i = 0; i < stations.length - 1; i++) {
    const s0 = stations[i]!;
    const s1 = stations[i + 1]!;
    const mid = (s0.theta + s1.theta) / 2;
    const out = new THREE.Vector3(Math.sin(mid), 0, Math.cos(mid));
    const [ob0, ob1] = [at(s0.theta, 1, 0), at(s1.theta, 1, 0)];
    const [ot0, ot1] = [at(s0.theta, 1, s0.top), at(s1.theta, 1, s1.top)];
    const [ib0, ib1] = [at(s0.theta, -1, 0), at(s1.theta, -1, 0)];
    const [it0, it1] = [at(s0.theta, -1, s0.top), at(s1.theta, -1, s1.top)];
    quad(ob0, ob1, ot1, ot0, out);
    quad(ib0, ib1, it1, it0, out.clone().negate());
    quad(ot0, ot1, it1, it0, up);
  }
  for (const [station, sign] of [[stations[0]!, -1], [stations[stations.length - 1]!, 1]] as const) {
    const { theta, top } = station;
    // Along the arc, away from the wall.
    const along = new THREE.Vector3(Math.cos(theta), 0, -Math.sin(theta)).multiplyScalar(sign);
    quad(at(theta, 1, 0), at(theta, 1, top), at(theta, -1, top), at(theta, -1, 0), along);
  }
  geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  geometryCache.set(key, geometry);
  return geometry;
}

/** The canopy slab, in its own frame (plan centre at the origin): its profile extruded across Z. */
function canopyGeometry(canopy: ToiletCanopy): THREE.BufferGeometry {
  const { length, width, profile, thickness } = canopy;
  const key = `toilet-canopy:${length}:${width}:${thickness}:${profile.join(',')}`;
  let geometry = geometryCache.get(key);
  if (geometry) return geometry;
  if (profile.length < 2) throw new Error('A canopy profile needs two stations');
  const step = length / (profile.length - 1);
  const points = profile.map((y, i) => new THREE.Vector2(-length / 2 + i * step, y));
  for (let i = profile.length - 1; i >= 0; i--) points.push(new THREE.Vector2(-length / 2 + i * step, profile[i]! + thickness));
  geometry = new THREE.ExtrudeGeometry(new THREE.Shape(points), { depth: width, bevelEnabled: false });
  geometry.translate(0, 0, -width / 2);
  geometryCache.set(key, geometry);
  return geometry;
}

/** The canopy's underside height over world `x`: the profile between its stations. */
function canopyUnderside(canopy: ToiletCanopy, x: number): number {
  const { profile, length } = canopy;
  const t = ((x - canopy.x + length / 2) / length) * (profile.length - 1);
  const i = Math.min(Math.max(Math.floor(t), 0), profile.length - 2);
  const share = Math.min(Math.max(t - i, 0), 1);
  return profile[i]! + (profile[i + 1]! - profile[i]!) * share;
}
