/**
 * Builds a kit car as the scene a model file would have loaded: car-frame metres,
 * +Z forward, +X left, ground at y = 0, wheels named for `wheelNodes`, lamp lenses
 * named for `lights`, every part in the one kit material (its slot in its vertices,
 * materials.ts) and the panes in `glass`.
 * render/carmodel.ts then fits, measures and instances it like any other model.
 *
 * Moving parts hang from pivot groups at their hinges. A pivot carries
 * `userData.kitMotion` (what drives it) and the node a player clicks carries
 * `userData.kitControl`; see rig.ts.
 */

import * as THREE from 'three';
import { BodyFrame, buildShell, cutShellHoles, type KitHole } from './body';
import { buildBay } from './bay';
import { addBuilt, pivotGroup, type KitContext, type KitNode } from './context';
import { buildExterior } from './exterior';
import { buildInterior } from './interior';
import { fitCabinPlaces } from './places';
import { finishKitSurfaces } from './materials';
import { simplifyFlats } from './simplify';
import { KIT_SPECS } from './specs';
import { buildWheel } from './wheels';
import type { KitMotion } from './rig';
import type { Vec3 } from './builder';
import type { EndLean } from './spec';

/** Russian names for the shell's moving parts, shown on hover. */
const PART_LABELS: Readonly<Record<string, string>> = {
  door_fl: 'Передняя левая дверь',
  door_fr: 'Передняя правая дверь',
  door_rl: 'Задняя левая дверь',
  door_rr: 'Задняя правая дверь',
  bonnet: 'Капот',
  boot: 'Багажник',
  tailgate: 'Дверь багажника',
  tailgate_l: 'Левая задняя дверь',
  tailgate_r: 'Правая задняя дверь',
  flap: 'Лючок бензобака',
  window_fl: 'Стекло передней левой двери',
  window_fr: 'Стекло передней правой двери',
  window_rl: 'Стекло задней левой двери',
  window_rr: 'Стекло задней правой двери',
  vent_fl: 'Левая форточка',
  vent_fr: 'Правая форточка',
};

function shellMotion(owner: string, frame: BodyFrame): KitMotion | undefined {
  const left = owner.endsWith('l');
  if (owner.startsWith('door_')) return { channel: owner, kind: 'rot', axis: [0, 1, 0], amount: left ? -1.15 : 1.15 };
  if (owner === 'bonnet') return { channel: owner, kind: 'rot', axis: [1, 0, 0], amount: -0.95 };
  if (owner === 'boot') return { channel: owner, kind: 'rot', axis: [1, 0, 0], amount: 1.05 };
  // A rear door hinged at its side (`tailgateHinge`) swings out about the upright, as a door
  // does; a split tailgate's two leaves each about their own outer edge.
  const hinge = frame.spec.tailgateHinge;
  if (owner === 'tailgate_l' || owner === 'tailgate_r') return { channel: owner, kind: 'rot', axis: [0, 1, 0], amount: left ? -1.5 : 1.5 };
  if (owner === 'tailgate' && hinge) return { channel: owner, kind: 'rot', axis: [0, 1, 0], amount: hinge === 'left' ? -1.2 : 1.2 };
  if (owner === 'tailgate') return { channel: owner, kind: 'rot', axis: [1, 0, 0], amount: 1.25 };
  if (owner === 'flap') return { channel: owner, kind: 'rot', axis: [0, 1, 0], amount: frame.spec.flap.side === 'left' ? -1.6 : 1.6 };
  // A drop pane winds all the way down into its door (rig.ts `SinkingPane`).
  if (owner.startsWith('window_')) return { channel: owner, kind: 'sink', axis: [0, -1, 0], amount: 1 };
  if (owner.startsWith('vent_')) return { channel: owner, kind: 'rot', axis: [0, 1, 0], amount: left ? -0.9 : 0.9 };
  return undefined;
}

export function buildKitCar(id: string): THREE.Group {
  const spec = KIT_SPECS[id];
  if (!spec) throw new Error(`Unknown kit car "${id}"`);
  const frame = new BodyFrame(spec);
  const root = new THREE.Group();
  root.name = `kit_${id}`;

  const shell = buildShell(frame);
  const nodes = new Map<string, KitNode>();
  for (const part of shell.parts) {
    if (part.owner === 'body') {
      addBuilt(root, part.builder, [0, 0, 0], 'body');
      continue;
    }
    const motion = shellMotion(part.owner, frame);
    // A part that does not move (a door's fixed quarter pane) is not a control.
    const control = motion ? { id: part.owner, label: PART_LABELS[part.owner] ?? part.owner } : undefined;
    const node = pivotGroup(part.owner, part.pivot, motion, control);
    addBuilt(node, part.builder, part.pivot, part.owner);
    nodes.set(part.owner, { node, pivot: part.pivot });
  }
  // Panes ride in their doors.
  for (const [owner, { node }] of nodes) {
    const door = nodes.get(owner.replace(/^(window|vent|quarter)_/, 'door_'));
    if (!door || door.node === node) continue;
    node.position.sub(new THREE.Vector3(...door.pivot));
    door.node.add(node);
  }
  for (const { node } of nodes.values()) if (!node.parent) root.add(node);

  const ctx: KitContext = { frame, root, nodes, lining: shell.lining, holes: [] };
  buildExterior(ctx);
  buildInterior(ctx);
  buildBay(ctx);
  cutShellHoles(root, ctx.holes);
  if (spec.rearLean) leanEnd(root, ctx.holes, frame.z(spec.rearLean.full ?? frame.rearBase), -1, spec.rearLean);
  if (spec.frontLean) leanEnd(root, ctx.holes, frame.z(spec.frontLean.full ?? spec.bonnetFront), 1, spec.frontLean);
  // The finished shape in the fewest faces: flat runs merged, zero-area triangles gone.
  simplifyFlats(root);
  // The cabin's places for things (interior.ts `KIT_PLACE_NODE`) cut clear of the finished car.
  fitCabinPlaces(root);
  // For tools (tools/kit-zfight.ts checks every hole is covered): the cut outlines, leant.
  root.userData.kitHoles = ctx.holes;

  // The car's own wheels, named for its `wheelNodes`: they set the wheels' places and
  // size; the loader shods the car from the Soviet pack's sets (`wheelSetPool`).
  const w = spec.wheels;
  const wheels: [string, number, number][] = [
    ['kit_wheel_fl', w.front, w.frontHalfTrack],
    ['kit_wheel_fr', w.front, -w.frontHalfTrack],
    ['kit_wheel_rl', w.rear, w.rearHalfTrack],
    ['kit_wheel_rr', w.rear, -w.rearHalfTrack],
  ];
  for (const [name, s, x] of wheels) {
    const wheel = buildWheel(w.radius, w.width);
    wheel.name = name;
    wheel.position.set(x, w.radius, frame.z(s));
    // Built with the outer face to +X (the left side): the right wheels turn round.
    if (x < 0) wheel.rotation.y = Math.PI;
    root.add(wheel);
  }
  finishKitSurfaces(root, spec.look.tone);
  return root;
}

const _p = new THREE.Vector3();
const _inv = new THREE.Matrix4();

/**
 * Leans one end of the car (`KitCarSpec.rearLean`, `frontLean`): above `base`, every
 * point moves towards the car's middle by `lean` per metre of height, in full beyond
 * `zFull` (the rear base, or the bonnet's front edge) and fading to nothing over `blend`
 * inside it. That end — tailgate or face, the lamp corners beside it, the lamps on them —
 * then lies in one raked plane, while the bumper below stays upright. Moving parts are
 * warped in their built (closed) pose, so they still close flush; wheels are added
 * afterwards and never touched. `end` is +1 at the front, −1 at the tail.
 *
 * The warp bends at `base` (and at `peak.y`), so a triangle reaching across it is first
 * cut there: left whole, it stayed a straight chord through the bend while its neighbour,
 * cut finer (round a lamp's hole), followed the bend, and a slit opened between them down
 * the estates' tail corners (owner, 2026-10-19). Behind `zFull` the warp is then one
 * linear map on each side of each bend, so every shared edge stays shared.
 */
function leanEnd(root: THREE.Object3D, holes: KitHole[], zFull: number, end: 1 | -1, lean: EndLean): void {
  const zStart = zFull - end * lean.blend;
  const peak = lean.peak;
  /** The offset towards the middle at height y, in full. */
  const offset = (y: number): number => (peak && y > peak.y
    ? lean.lean * (peak.y - lean.base) + peak.lean * (y - peak.y)
    : lean.lean * (y - lean.base));
  /** Moves a car-frame point; false where it stays. */
  const warp = (p: THREE.Vector3): boolean => {
    const into = end * (p.z - zStart);
    if (into <= 0 || p.y <= lean.base) return false;
    const w = Math.min(1, into / lean.blend);
    p.z -= end * (w * w * (3 - 2 * w) * offset(p.y));
    return true;
  };
  root.updateMatrixWorld(true);
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    // A leaning nose is cut along its base in the shell already (body.ts), and its bumpers
    // and lamps are laid to it; every part is cut at a peak, where the warp bends again.
    const inZone = (z: number): boolean => end * (z - zStart) > 0;
    if (end === -1) splitAtBase(mesh, inZone, lean.base);
    if (peak) splitAtBase(mesh, inZone, peak.y);
    const position = mesh.geometry.getAttribute('position');
    _inv.copy(mesh.matrixWorld).invert();
    let moved = false;
    for (let i = 0; i < position.count; i++) {
      _p.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
      if (!warp(_p)) continue;
      _p.applyMatrix4(_inv);
      position.setXYZ(i, _p.x, _p.y, _p.z);
      moved = true;
    }
    if (!moved) return;
    position.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
    mesh.geometry.computeBoundingBox();
    mesh.geometry.computeBoundingSphere();
  });
  holes.forEach((hole, i) => {
    const poly = hole.outline.poly.map((q): Vec3 => {
      warp(_p.set(q[0], q[1], q[2]));
      return [_p.x, _p.y, _p.z];
    });
    holes[i] = { ...hole, outline: { ...hole.outline, poly } };
  });
}

/**
 * Cuts every triangle of a non-indexed mesh that reaches across the car-frame height `base`
 * inside the warped zone (`inZone` of a vertex's car-frame z) into pieces on either side
 * of it, every attribute interpolated along the cut edges. Indexed meshes are left alone.
 */
function splitAtBase(mesh: THREE.Mesh, inZone: (z: number) => boolean, base: number): void {
  const geometry = mesh.geometry;
  if (geometry.index || geometry.groups.length > 0) return;
  const position = geometry.getAttribute('position');
  const count = position.count;
  const ys = new Float64Array(count);
  const zone = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    _p.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
    ys[i] = _p.y - base;
    zone[i] = inZone(_p.z) ? 1 : 0;
  }
  const crosses = (t: number): boolean => {
    const [a, b, c] = [ys[t * 3]!, ys[t * 3 + 1]!, ys[t * 3 + 2]!];
    const reach = zone[t * 3]! | zone[t * 3 + 1]! | zone[t * 3 + 2]!;
    return reach === 1 && Math.min(a, b, c) < -1e-6 && Math.max(a, b, c) > 1e-6;
  };
  let cut = false;
  for (let t = 0; t < count / 3 && !cut; t++) cut = crosses(t);
  if (!cut) return;
  const names = Object.keys(geometry.attributes);
  const src = names.map((n) => geometry.getAttribute(n) as THREE.BufferAttribute);
  const out = names.map(() => [] as number[]);
  /** Pushes vertex i of the source, or the point a fraction f of the way from i to j. */
  const emit = (i: number, j = i, f = 0): void => {
    src.forEach((attr, k) => {
      for (let c = 0; c < attr.itemSize; c++) {
        const a = attr.getComponent(i, c);
        out[k]!.push(a + (attr.getComponent(j, c) - a) * f);
      }
    });
  };
  type Corner = [number, number, number];
  for (let t = 0; t < count / 3; t++) {
    const v = [t * 3, t * 3 + 1, t * 3 + 2];
    if (!crosses(t)) {
      for (const i of v) emit(i);
      continue;
    }
    // Walk the outline, splitting each edge that crosses the base; then fan each side's
    // polygon (convex: a triangle cut by a line) in the original winding.
    const below: Corner[] = [];
    const above: Corner[] = [];
    for (let e = 0; e < 3; e++) {
      const i = v[e]!;
      const j = v[(e + 1) % 3]!;
      const yi = ys[i]!;
      const yj = ys[j]!;
      if (yi <= 0) below.push([i, i, 0]);
      if (yi >= 0) above.push([i, i, 0]);
      if ((yi < 0 && yj > 0) || (yi > 0 && yj < 0)) {
        const f = yi / (yi - yj);
        below.push([i, j, f]);
        above.push([i, j, f]);
      }
    }
    for (const poly of [below, above]) {
      for (let k = 1; k + 1 < poly.length; k++) for (const p of [poly[0]!, poly[k]!, poly[k + 1]!]) emit(...p);
    }
  }
  const next = new THREE.BufferGeometry();
  names.forEach((n, k) => next.setAttribute(n, new THREE.Float32BufferAttribute(out[k]!, src[k]!.itemSize, src[k]!.normalized)));
  next.userData = geometry.userData;
  mesh.geometry = next;
}

