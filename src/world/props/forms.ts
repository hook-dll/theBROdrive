/**
 * Roadside props, the forms half: the shapes the desert scatter stands, and the
 * pieces a knocked-over prop comes apart into.
 *
 * Every prop is a pure function of the integer seed via stateless hashing, so a
 * chunk builds identically whether it is generated in order or revisited later.
 * Nothing here owns game state; chunk content is a derived view of the seed.
 */

import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { hash01 } from '../../core/rng';
import { SurfaceType } from '../../core/surfaces';

import {
  DELINEATOR_EMBED,
  DELINEATOR_FACE_W,
  DELINEATOR_REFLECTOR_Y,
  matDelineator,
  matReflector,
} from './delineators';

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
export const matDeadStick = new THREE.MeshStandardMaterial({ color: 0x8a7a5c, roughness: 1.0, metalness: 0 });
export const matRock = new THREE.MeshStandardMaterial({
  color: 0x815f42,
  roughness: 0.98,
  metalness: 0,
});

/**
 * The two trees carry their bark and their canopy in VERTEX COLOURS on one material,
 * so a tree is one instanced draw call instead of two. Everything else in this file
 * is a single flat colour and does not need it.
 */
const matPlant = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });

// ===========================================================================
// Scatter: cacti and rocks
// ===========================================================================

export interface PropForm {
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


export function deformIcosahedron(seed: number, squashY: number): THREE.BufferGeometry {
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
export function scrubForm(): PropForm {
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
export function sandForms(): PropForm[] {
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
export function rockForms(): PropForm[] {
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
 * Whoever owns breaking. Structural on purpose: `world/props/forms.ts` describes scenery
 * and must not depend on the debris field that animates it.
 */
export interface BreakableSink {
  /** True if this prop is already down, so the chunk must not draw it standing. */
  isBroken(id: number): boolean;
  register(prop: BreakableProp): void;
  /** Called when the chunk holding these goes away. */
  forget(ids: readonly number[]): void;
}
