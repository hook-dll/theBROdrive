/**
 * tools/dwelling-skin.ts
 *
 * Depth-separation census of the dwellings' facade skin (src/world/dwellings): where a
 * door, frame, panel, batten or pane stops being depth-separable from what is around
 * it as the house recedes.
 *
 *   nice -n 15 npx tsx tools/dwelling-skin.ts [--strict] [log-cabin ...]   (default: every dwelling)
 *
 * The skin and the glass are drawn with a polygon offset of 4 units (builder.ts
 * `dwellingSkinMaterial`), which makes them win over the shell BEHIND them at any range
 * but also pulls them through shell IN FRONT of them once 4 depth steps exceed the gap,
 * and does nothing between two skin layers, which carry the same offset. So for every
 * skin and glass triangle, sampled at its centroid and towards each corner:
 *
 *   covered  shell within `REACH` along the face normal: skin under a log, a roof edge,
 *            a wall it was meant to stand on. Pulls through beyond d = sqrt((g/4)·near·2^24).
 *   stacked  another skin or glass face of a different colour facing the same way within
 *            `REACH` behind it (a panel on its leaf, a slat on its shutter, a bar on its
 *            pane). Fights beyond d = sqrt(g·near·2^24/2), as tools/kit-zfight.ts counts.
 *
 * Findings merge per face cluster with the smallest gap and the range the fight starts
 * at. A finding is VISIBLE if the narrower of its two faces still spans a pixel there
 * (1440 lines, 65°, as tools/kit-zfight.ts): past that range it keeps fighting but only
 * shrinks, and a sub-pixel slat or glazing bar shimmers whatever its depth. `--strict`
 * exits 1 when any listed dwelling has a visible finding inside `DRAW_M`.
 * Nothing here is part of the game.
 */

import * as THREE from 'three';
import { buildDwellingGeometry } from '../src/world/dwellings/catalogue';
import { DWELLINGS } from '../src/world/dwellings/list';

const DEPTH_NEAR = 0.08; // CAMERA_NEAR, core/renderer.ts; 24-bit scene depth
const DEPTH_STEPS = 2 ** 24;
const OFFSET_UNITS = 4; // dwellingSkinMaterial / dwellingGlassMaterial polygonOffsetUnits
/** How far along a face normal a neighbour still counts. */
const REACH = 0.3;
/** Start of a ray, off its own face. */
const LIFT = 1e-4;
/** A covering shell face must lie at least this far off the skin's own plane to count (touching is not covering). */
const MIN_COVER = 2e-4;
/** Faces this close to parallel and facing the same way count as stacked. */
const COS_STACK = Math.cos((5 * Math.PI) / 180);
/** Colours closer than this (linear, per channel) are the same paint: no visible fight. */
const SAME_COLOUR = 0.02;
/** A finding must cover at least this much skin to be reported (m²). */
const MIN_AREA = 4e-4;
/** How far out a house is still looked at; the kit cars' shell horizon (tools/kit-zfight.ts). */
const DRAW_M = 700;
const SCREEN_H = 1440;
const FOV_Y = (65 * Math.PI) / 180;
const pixelAt = (d: number): number => (2 * d * Math.tan(FOV_Y / 2)) / SCREEN_H;

const coverDistance = (gap: number): number => Math.sqrt((gap / OFFSET_UNITS) * DEPTH_NEAR * DEPTH_STEPS);
const stackDistance = (gap: number): number => Math.sqrt((gap * DEPTH_NEAR * DEPTH_STEPS) / 2);

type Layer = 'shell' | 'proud' | 'flush' | 'glass';

interface Tri {
  readonly a: THREE.Vector3;
  readonly b: THREE.Vector3;
  readonly c: THREE.Vector3;
  readonly n: THREE.Vector3;
  readonly area: number;
  /** Smallest altitude: how narrow the face is, for the pixel test. */
  readonly size: number;
  readonly layer: Layer;
  readonly colour: number; // index into the colour table, -1 for glass
  readonly min: THREE.Vector3;
  readonly max: THREE.Vector3;
}

interface Finding {
  kind: 'covered' | 'stacked';
  gap: number;
  range: number;
  area: number;
  size: number;
  at: THREE.Vector3;
  layer: Layer;
}

function trianglesOf(index: number): Tri[] {
  const { body, glass } = buildDwellingGeometry(index);
  const tris: Tri[] = [];
  const colours: number[][] = [];
  const colourIndex = (r: number, g: number, b: number): number => {
    for (let i = 0; i < colours.length; i++) {
      const c = colours[i]!;
      if (Math.abs(c[0]! - r) < SAME_COLOUR && Math.abs(c[1]! - g) < SAME_COLOUR && Math.abs(c[2]! - b) < SAME_COLOUR) return i;
    }
    colours.push([r, g, b]);
    return colours.length - 1;
  };
  const layerAt = (vertex: number): Layer => {
    for (const group of body.groups) {
      if (vertex >= group.start && vertex < group.start + group.count) {
        return group.materialIndex === 0 ? 'shell' : group.materialIndex === 1 ? 'proud' : 'flush';
      }
    }
    return 'shell';
  };
  const add = (geometry: THREE.BufferGeometry, isGlass: boolean): void => {
    const position = geometry.getAttribute('position');
    const colour = geometry.getAttribute('color');
    for (let i = 0; i + 2 < position.count; i += 3) {
      const a = new THREE.Vector3().fromBufferAttribute(position, i);
      const b = new THREE.Vector3().fromBufferAttribute(position, i + 1);
      const c = new THREE.Vector3().fromBufferAttribute(position, i + 2);
      const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
      const twice = n.length();
      if (twice < 1e-10) continue;
      n.divideScalar(twice);
      const longest = Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a));
      tris.push({
        a, b, c, n,
        area: twice / 2,
        size: twice / longest,
        layer: isGlass ? 'glass' : layerAt(i),
        // Faces are flat-coloured per vertex; the first vertex stands for the face.
        colour: isGlass ? -1 : colourIndex(colour.getX(i), colour.getY(i), colour.getZ(i)),
        min: new THREE.Vector3().copy(a).min(b).min(c),
        max: new THREE.Vector3().copy(a).max(b).max(c),
      });
    }
  };
  add(body, false);
  if (glass) add(glass, true);
  return tris;
}

/** Uniform grid over triangle bounds, for short segment queries. */
class Grid {
  private readonly cells = new Map<string, number[]>();
  constructor(private readonly tris: readonly Tri[], private readonly cell: number) {
    tris.forEach((tri, i) => {
      for (let x = Math.floor(tri.min.x / cell); x <= Math.floor(tri.max.x / cell); x++) {
        for (let y = Math.floor(tri.min.y / cell); y <= Math.floor(tri.max.y / cell); y++) {
          for (let z = Math.floor(tri.min.z / cell); z <= Math.floor(tri.max.z / cell); z++) {
            const key = `${x},${y},${z}`;
            let list = this.cells.get(key);
            if (!list) this.cells.set(key, (list = []));
            list.push(i);
          }
        }
      }
    });
  }

  near(p: THREE.Vector3, q: THREE.Vector3): Set<number> {
    const out = new Set<number>();
    const c = this.cell;
    for (let x = Math.floor(Math.min(p.x, q.x) / c); x <= Math.floor(Math.max(p.x, q.x) / c); x++) {
      for (let y = Math.floor(Math.min(p.y, q.y) / c); y <= Math.floor(Math.max(p.y, q.y) / c); y++) {
        for (let z = Math.floor(Math.min(p.z, q.z) / c); z <= Math.floor(Math.max(p.z, q.z) / c); z++) {
          for (const i of this.cells.get(`${x},${y},${z}`) ?? []) out.add(i);
        }
      }
    }
    return out;
  }

  get(i: number): Tri {
    return this.tris[i]!;
  }
}

const _e1 = new THREE.Vector3();
const _e2 = new THREE.Vector3();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _q = new THREE.Vector3();

/** Möller–Trumbore, either facing: distance along `dir` or Infinity. */
function hit(origin: THREE.Vector3, dir: THREE.Vector3, tri: Tri): number {
  _e1.subVectors(tri.b, tri.a);
  _e2.subVectors(tri.c, tri.a);
  _p.crossVectors(dir, _e2);
  const det = _e1.dot(_p);
  if (Math.abs(det) < 1e-12) return Infinity;
  const inv = 1 / det;
  _s.subVectors(origin, tri.a);
  const u = _s.dot(_p) * inv;
  if (u < -1e-6 || u > 1 + 1e-6) return Infinity;
  _q.crossVectors(_s, _e1);
  const v = dir.dot(_q) * inv;
  if (v < -1e-6 || u + v > 1 + 1e-6) return Infinity;
  const t = _e2.dot(_q) * inv;
  return t > 0 ? t : Infinity;
}

function census(index: number): Finding[] {
  const tris = trianglesOf(index);
  const grid = new Grid(tris, 0.25);
  const findings: Finding[] = [];
  const origin = new THREE.Vector3();
  const end = new THREE.Vector3();
  const back = new THREE.Vector3();
  for (let i = 0; i < tris.length; i++) {
    const tri = tris[i]!;
    if (tri.layer === 'shell') continue;
    const centre = new THREE.Vector3().add(tri.a).add(tri.b).add(tri.c).divideScalar(3);
    const samples = [centre, ...[tri.a, tri.b, tri.c].map((v) => new THREE.Vector3().lerpVectors(centre, v, 0.8))];
    let cover = Infinity;
    let stack = Infinity;
    let coverAt = centre;
    let stackAt = centre;
    let stackSize = 0;
    for (const sample of samples) {
      // Covered: the first shell along the outward normal is one this face lies inside
      // of (its face looks the same way). A first shell facing back at it is the solid the
      // skin stands on or under, seen from outside: no pull-through along the normal.
      origin.copy(sample).addScaledVector(tri.n, LIFT);
      end.copy(origin).addScaledVector(tri.n, REACH);
      let first = Infinity;
      let inside = false;
      for (const j of grid.near(origin, end)) {
        const other = grid.get(j);
        if (other.layer !== 'shell') continue;
        const t = hit(origin, tri.n, other);
        if (t + LIFT > MIN_COVER && t < REACH && t < first) {
          first = t;
          inside = other.n.dot(tri.n) > 0;
        }
      }
      if (inside && first + LIFT < cover) {
        cover = first + LIFT;
        coverAt = sample;
      }
      // Stacked: a different skin or pane facing the same way just behind.
      back.copy(tri.n).negate();
      origin.copy(sample).addScaledVector(back, LIFT);
      end.copy(origin).addScaledVector(back, REACH);
      for (const j of grid.near(origin, end)) {
        const other = grid.get(j);
        if (other.layer === 'shell' || j === i) continue;
        if (other.n.dot(tri.n) < COS_STACK) continue;
        if (other.colour === tri.colour && other.layer !== 'glass' && tri.layer !== 'glass') continue;
        if (other.layer === 'glass' && tri.layer === 'glass') continue;
        const t = hit(origin, back, other);
        if (t < REACH && t + LIFT < stack) {
          stack = t + LIFT;
          stackAt = sample;
          stackSize = Math.min(tri.size, other.size);
        }
      }
    }
    if (cover < Infinity) findings.push({ kind: 'covered', gap: cover, range: coverDistance(cover), area: tri.area, size: tri.size, at: coverAt, layer: tri.layer });
    if (stack < Infinity) findings.push({ kind: 'stacked', gap: stack, range: stackDistance(stack), area: tri.area, size: stackSize, at: stackAt, layer: tri.layer });
  }
  return findings;
}

/** Merges findings of one kind lying within 15 cm and 1 mm of gap of each other. */
function clusters(findings: readonly Finding[]): Finding[] {
  const out: Finding[] = [];
  for (const f of [...findings].sort((x, y) => x.gap - y.gap)) {
    const same = out.find((c) => c.kind === f.kind && c.at.distanceTo(f.at) < 0.15 && Math.abs(c.gap - f.gap) < 1e-3);
    if (same) {
      same.area += f.area;
      same.size = Math.max(same.size, f.size);
    } else {
      out.push({ ...f, at: f.at.clone() });
    }
  }
  return out.filter((c) => c.area >= MIN_AREA);
}

const args = process.argv.slice(2);
const strict = args.includes('--strict');
const named = args.filter((arg) => !arg.startsWith('--'));
const ids = named.length > 0 ? named : DWELLINGS.map((d) => d.id);
let failed = 0;
for (const id of ids) {
  const index = DWELLINGS.findIndex((d) => d.id === id);
  if (index < 0) throw new Error(`unknown dwelling ${id}`);
  const found = clusters(census(index)).sort((a, b) => a.range - b.range);
  const visible = found.filter((f) => f.range < DRAW_M && f.size >= pixelAt(f.range));
  // Area, not cluster count: a cluster count moves with how a face happens to triangulate.
  const area = (kind: Finding['kind'], list: readonly Finding[]): string =>
    (list.filter((f) => f.kind === kind).reduce((sum, f) => sum + f.area, 0) * 1e4).toFixed(0);
  if (visible.length > 0) failed++;
  console.log(`${id}: covered ${area('covered', found)} cm² (visible ${area('covered', visible)}), stacked ${area('stacked', found)} cm² (visible ${area('stacked', visible)})`);
  const shown = named.length > 0 ? found : visible;
  for (const f of shown.slice(0, 40)) {
    const at = `(${f.at.x.toFixed(2)}, ${f.at.y.toFixed(2)}, ${f.at.z.toFixed(2)})`;
    const mark = visible.includes(f) ? 'VISIBLE' : '       ';
    console.log(`  ${mark} ${f.kind.padEnd(7)} ${f.layer.padEnd(5)} gap ${(f.gap * 100).toFixed(2).padStart(6)} cm  from ${f.range.toFixed(0).padStart(5)} m  ${(f.size * 100).toFixed(1).padStart(5)} cm wide  ${(f.area * 1e4).toFixed(0).padStart(5)} cm²  at ${at}`);
  }
}
if (strict && failed > 0) {
  console.log(`${failed} dwelling(s) with a visible fight inside ${DRAW_M} m`);
  process.exit(1);
}
