/**
 * Builds a kit car as the scene a model file would have loaded: car-frame metres,
 * +Z forward, +X left, ground at y = 0, wheels named for `wheelNodes`, lamp lenses
 * named for `lights`, the painted shell in material `paint` and the panes in `glass`.
 * render/carmodel.ts then fits, measures and instances it like any other model.
 *
 * Moving parts hang from pivot groups at their hinges. A pivot carries
 * `userData.kitMotion` (what drives it) and the node a player clicks carries
 * `userData.kitControl`; see rig.ts.
 */

import * as THREE from 'three';
import { BodyFrame, buildShell } from './body';
import { buildBay } from './bay';
import { addBuilt, pivotGroup, type KitContext, type KitNode } from './context';
import { buildExterior } from './exterior';
import { buildInterior } from './interior';
import { KIT_SPECS } from './specs';
import { buildWheel } from './wheels';
import type { KitMotion } from './rig';

/** Russian names for the shell's moving parts, shown on hover. */
const PART_LABELS: Readonly<Record<string, string>> = {
  door_fl: 'Передняя левая дверь',
  door_fr: 'Передняя правая дверь',
  door_rl: 'Задняя левая дверь',
  door_rr: 'Задняя правая дверь',
  bonnet: 'Капот',
  boot: 'Багажник',
  tailgate: 'Дверь багажника',
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
  if (owner === 'tailgate') return { channel: owner, kind: 'rot', axis: [1, 0, 0], amount: 1.25 };
  if (owner === 'flap') return { channel: owner, kind: 'rot', axis: [0, 1, 0], amount: 1.6 };
  if (owner.startsWith('window_')) {
    const drop = frame.spec.cabin.rail - frame.spec.cabin.glassTop - frame.station(frame.cowl).belt - frame.spec.cabin.glassBottom - 0.02;
    return { channel: owner, kind: 'pos', axis: [0, -1, 0], amount: drop };
  }
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
    const control = { id: part.owner, label: PART_LABELS[part.owner] ?? part.owner };
    const node = pivotGroup(part.owner, part.pivot, motion, control);
    addBuilt(node, part.builder, part.pivot, part.owner);
    nodes.set(part.owner, { node, pivot: part.pivot });
  }
  // Panes ride in their doors.
  for (const [owner, { node }] of nodes) {
    const door = nodes.get(owner.replace(/^(window|vent)_/, 'door_'));
    if (!door || door.node === node) continue;
    node.position.sub(new THREE.Vector3(...door.pivot));
    door.node.add(node);
  }
  for (const { node } of nodes.values()) if (!node.parent) root.add(node);

  const ctx: KitContext = { frame, root, nodes };
  buildExterior(ctx);
  buildInterior(ctx);
  buildBay(ctx);

  // Wheels.
  const w = spec.wheels;
  const wheels: [string, number, number][] = [
    ['kit_wheel_fl', w.front, w.frontHalfTrack],
    ['kit_wheel_fr', w.front, -w.frontHalfTrack],
    ['kit_wheel_rl', w.rear, w.rearHalfTrack],
    ['kit_wheel_rr', w.rear, -w.rearHalfTrack],
  ];
  for (const [name, s, x] of wheels) {
    const wheel = buildWheel(w.radius, w.width, { hubcap: spec.look.bumpers === 'chrome' ? 'chrome-dome' : 'small-cap' });
    wheel.name = name;
    wheel.position.set(x, w.radius, frame.z(s));
    // Built with the outer face to +X (the left side): the right wheels turn round.
    if (x < 0) wheel.rotation.y = Math.PI;
    root.add(wheel);
  }
  return root;
}
