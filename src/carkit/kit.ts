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
import { finishKitSurfaces } from './materials';
import { simplifyFlats } from './simplify';
import { KIT_SPECS } from './specs';
import { buildWheel } from './wheels';
import type { KitMotion } from './rig';
import type { Vec3 } from './builder';

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
  if (spec.rearLean) leanEnd(root, ctx.holes, frame.z(frame.rearBase), -1, spec.rearLean);
  if (spec.frontLean) leanEnd(root, ctx.holes, frame.z(spec.frontLean.full ?? spec.bonnetFront), 1, spec.frontLean);
  // The finished shape in the fewest faces: flat runs merged, zero-area triangles gone.
  simplifyFlats(root);
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
  finishKitSurfaces(root);
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
 */
function leanEnd(root: THREE.Object3D, holes: KitHole[], zFull: number, end: 1 | -1, lean: { readonly base: number; readonly lean: number; readonly blend: number }): void {
  const zStart = zFull - end * lean.blend;
  /** Moves a car-frame point; false where it stays. */
  const warp = (p: THREE.Vector3): boolean => {
    const into = end * (p.z - zStart);
    if (into <= 0 || p.y <= lean.base) return false;
    const w = Math.min(1, into / lean.blend);
    p.z -= end * (w * w * (3 - 2 * w) * lean.lean * (p.y - lean.base));
    return true;
  };
  root.updateMatrixWorld(true);
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
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

