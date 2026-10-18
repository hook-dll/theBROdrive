/**
 * tools/wreck-lids.ts
 *
 * A roadside shell's grids answer to its lids, as a driven kit car's do. The shell used
 * to be one merged mesh with no lid to open, so its bonnet and trunk grids opened on F
 * straight through the shut panels. Checked here, headless, against the real models and
 * the real `Interaction`:
 *
 *  - every kit body's shell hangs the same lids the driven car has, the shell and lids
 *    together exactly the mid shell's triangles, each lid where the driven one stands;
 *  - aimed at a shut compartment the grid is not shown; F opens the lid and the grid
 *    with it; E on the open lid shuts it and the grid goes; E on a shut lid opens both;
 *  - a body with no lid over a compartment (the van's bonnet) offers no grid there, a
 *    kit shell whose lids have not arrived offers none, and a body that is not a kit
 *    keeps the grid F opens;
 *  - the van's shell alone hangs its middle side door (`STATIC_SHELL_DOORS`): shut, its
 *    bay under the engine cover is not reached; E opens it with the cover, and every bay
 *    cell is picked and taken through the opening by the real `Interaction`.
 *
 *   bun tools/wreck-lids.ts
 *
 * Nothing here is part of the game bundle.
 */

import * as THREE from 'three';
import { installAssetShim } from './assetshim';
import { installDocumentShim } from './domshim';
import { CAR_MODELS } from '../src/vehicle/carmodels';
import { carModelMeasure, createCarModel, createCourierCarModel, createStaticCarModel, loadCarModel, STATIC_SHELL_DOORS, type StaticCarModel } from '../src/render/carmodel';
import { KitRig } from '../src/carkit/rig';
import { STORAGE_LID_CHANNELS, storageCellBox, storageGridCentreLocal, storageLidSide, type StorageSide } from '../src/vehicle/trunk';
import { BONNET_SLOT_COUNT } from '../src/vehicle/bonnet';
import { emptyInput, type InputFrame } from '../src/core/input';
import { GameWorld, newWorldState } from '../src/game/state';
import { Inventory } from '../src/items/items';
import { Interaction, type InteractionResult } from '../src/player/interaction';
import { WreckTrunkField } from '../src/world/wrecktrunks';
import { CourierField } from '../src/world/couriers';
import { WorldOrigin } from '../src/world/origin';

installAssetShim();
installDocumentShim();

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(52)} ${detail}`);
}

/** Triangles drawn by the meshes under `root` whose name passes `keep`. */
function triangles(root: THREE.Object3D, keep: (mesh: THREE.Mesh) => boolean): number {
  let count = 0;
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh || !keep(mesh) || (mesh as THREE.SkinnedMesh).isSkinnedMesh) return;
    count += mesh.geometry.getAttribute('position').count / 3;
  });
  return count;
}

const isPaint = (mesh: THREE.Mesh): boolean => (mesh.material as THREE.Material).name !== 'car-glass-clear' && mesh.name !== 'wheels' && !mesh.name.includes('shadow');
const isPane = (mesh: THREE.Mesh): boolean => (mesh.material as THREE.Material).name === 'car-glass-clear';

const kitIds = CAR_MODELS.filter((def) => def.kit).map((def) => def.id);
for (const id of kitIds) await loadCarModel(id);

console.log('--- shells: lids, triangles, hinges ---');
for (const id of kitIds) {
  const shell = createStaticCarModel(id, `check:${id}`);
  const driving = createCarModel(id).body;
  const drivenLids = new Map<string, THREE.Object3D>();
  driving.traverse((node) => {
    const control = node.userData.kitControl as { id: string } | undefined;
    if (control && (storageLidSide(control.id) || STATIC_SHELL_DOORS[id]?.includes(control.id)) && node.userData.kitMotion) drivenLids.set(control.id, node);
  });
  const lids = shell.lids;
  const ids = lids ? lids.controls.map((control) => control.id).sort() : [];
  check(`${id}: lids match the driven car`, ids.join(',') === [...drivenLids.keys()].sort().join(','), ids.join(',') || '(none)');

  // Shell plus lids are the mid shell, cut and nothing lost or doubled.
  const mid = createCourierCarModel(id, `check:${id}`);
  const paint = triangles(shell.model, isPaint);
  const panes = triangles(shell.model, isPane);
  check(
    `${id}: shell + lids = mid shell`,
    paint === triangles(mid, isPaint) && panes === triangles(mid, isPane),
    `paint ${paint}/${triangles(mid, isPaint)} panes ${panes}/${triangles(mid, isPane)}`,
  );

  // Each lid stands where the driven car's does, shut and open.
  shell.model.updateMatrixWorld(true);
  driving.updateMatrixWorld(true);
  let worst = 0;
  for (const pivot of lids?.pivots ?? []) {
    const driven = drivenLids.get(pivot.name)!;
    const ours = new THREE.Box3().setFromObject(pivot, true);
    const theirs = new THREE.Box3().setFromObject(driven, true);
    worst = Math.max(worst, ours.min.distanceTo(theirs.min), ours.max.distanceTo(theirs.max));
  }
  check(`${id}: lids stand on the driven car's hinges`, worst < 0.01, `${(worst * 1000).toFixed(1)} mm`);

  if (lids) {
    const channel = lids.controls[0]!.id;
    lids.rig.set(channel, 1);
    lids.update(5);
    shell.model.updateMatrixWorld(true);
    const inside = shell.model.getObjectByName('inside')!;
    const pivot = lids.pivots[0]!;
    const rest = new THREE.Quaternion().copy(pivot.quaternion);
    check(`${id}: an open lid swings and shows the inside`, inside.visible && rest.angleTo(drivenLids.get(channel)!.quaternion) > 0.5, `${channel} ${THREE.MathUtils.radToDeg(rest.angleTo(drivenLids.get(channel)!.quaternion)).toFixed(0)}°`);
    lids.rig.set(channel, 0);
    lids.update(5);
    check(`${id}: shut again, the inside is hidden`, !inside.visible && pivot.quaternion.angleTo(drivenLids.get(channel)!.quaternion) < 1e-6, '');
  }
}

console.log('--- interaction: the grid answers to the lid ---');

/** One shell at the origin, upright, registered as a wreck and seen by a fresh `Interaction`. */
function stage(id: string, withLids = true): { shell: StaticCarModel; interaction: Interaction; wrecks: WreckTrunkField; world: GameWorld; inventory: Inventory } {
  const shell = createStaticCarModel(id, `stage:${id}`);
  const half = carModelMeasure(id).halfExtents;
  const wrecks = new WreckTrunkField();
  wrecks.register({ id: 'wreck:test', modelId: id, x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1, halfExtents: half });
  if (withLids && shell.lids) wrecks.attachLids('wreck:test', shell.lids);
  shell.model.updateMatrixWorld(true);
  const world = new GameWorld(newWorldState(1337));
  const inventory = new Inventory();
  const none = {} as never;
  const interaction = new Interaction(
    { raycast: () => null } as never,
    world,
    inventory,
    none,
    none,
    wrecks,
    new CourierField(),
    () => null,
    { vehicle: () => null, position: () => null, nearest: () => 0 },
    none,
    () => {},
    () => {},
    new WorldOrigin(),
    { has: () => false } as never,
    () => 0,
  );
  return { shell, interaction, wrecks, world, inventory };
}

/** One fixed tick, the eye at `eye` looking at `at`. */
function tick(interaction: Interaction, eye: THREE.Vector3, at: THREE.Vector3, press: Partial<InputFrame> = {}): InteractionResult {
  const input = { ...emptyInput(), ...press };
  const dir = at.clone().sub(eye).normalize();
  return interaction.fixedUpdate(1 / 60, input, eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, 0, false);
}

/** Lets the lids ease home and the shell's matrices follow, as rendered frames do. */
function settle(shell: StaticCarModel, wrecks: WreckTrunkField): void {
  wrecks.syncVisuals(5);
  shell.model.updateMatrixWorld(true);
}

/** Where to stand for a compartment: over the bay ahead of the screen, or behind the tail. */
function standAt(id: string, side: StorageSide): { eye: THREE.Vector3; at: THREE.Vector3 } {
  const at = new THREE.Vector3();
  storageGridCentreLocal(carModelMeasure(id), side, at);
  const eye = side === 'bonnet' ? at.clone().add(new THREE.Vector3(0, 0.9, 0.7)) : at.clone().add(new THREE.Vector3(0, 0.25, -1.1));
  return { eye, at };
}

/**
 * Where to stand to aim at a lid (`leaf`, by its pivot's name) as it stands now: on its
 * skin, at the vertex nearest its middle, looked at along that vertex's normal from a
 * metre off it.
 */
function lidAim(shell: StaticCarModel, leaf: string): { eye: THREE.Vector3; at: THREE.Vector3 } {
  const pivot = shell.lids!.pivots.find((node) => node.name === leaf)!;
  const skin = pivot.children.find((node) => node.name.endsWith('_skin')) as THREE.Mesh;
  const middle = new THREE.Box3().setFromObject(skin, true).getCenter(new THREE.Vector3());
  const position = skin.geometry.getAttribute('position');
  const normal = skin.geometry.getAttribute('normal');
  const at = new THREE.Vector3();
  const n = new THREE.Vector3();
  const p = new THREE.Vector3();
  let best = Infinity;
  for (let i = 0; i < position.count; i++) {
    p.fromBufferAttribute(position, i).applyMatrix4(skin.matrixWorld);
    const d = p.distanceToSquared(middle);
    if (d >= best) continue;
    best = d;
    at.copy(p);
    n.fromBufferAttribute(normal, i).transformDirection(skin.matrixWorld);
  }
  return { eye: at.clone().addScaledVector(n, 1), at };
}

const isOpen = (shell: StaticCarModel, side: StorageSide): boolean => STORAGE_LID_CHANNELS[side].some((channel) => shell.lids!.rig.get(channel) > 0.5);

for (const [id, side] of [['kit_vaz2106', 'bonnet'], ['kit_vaz2106', 'trunk'], ['kit_vaz2108', 'trunk'], ['kit_uaz2206', 'trunk']] as const) {
  const { shell, interaction, wrecks } = stage(id);
  const { eye, at } = standAt(id, side);
  const label = side === 'bonnet' ? 'bonnet' : 'trunk';
  let result = tick(interaction, eye, at);
  check(`${id} ${side}: shut, offered but not shown`, result.prompt === `[F] open ${label}` && result.boot === null && !isOpen(shell, side), `${result.prompt} · grid ${result.boot?.side ?? 'none'}`);
  tick(interaction, eye, at, { mount: true });
  result = tick(interaction, eye, at);
  check(`${id} ${side}: F opens the lid, then the grid`, isOpen(shell, side) && result.boot?.side === side && result.boot.owner === 'wreck', `lid ${isOpen(shell, side)} · grid ${result.boot?.side ?? 'none'}`);
  settle(shell, wrecks);

  // E on each leaf where it stands open: it shuts, and with the last the grid goes.
  const leaves = shell.lids!.pivots.map((pivot) => pivot.name).filter((name) => storageLidSide(name) === side);
  for (const leaf of leaves) {
    const open = lidAim(shell, leaf);
    result = tick(interaction, open.eye, open.at);
    check(`${id} ${leaf}: the open lid takes E`, result.actionable && interaction.claimsUseHeld, `actionable ${result.actionable}`);
    tick(interaction, open.eye, open.at, { useHeld: true });
  }
  result = tick(interaction, eye, at);
  check(`${id} ${side}: E shuts the lid and the grid goes`, !isOpen(shell, side) && result.boot === null, `lid ${isOpen(shell, side)} · grid ${result.boot?.side ?? 'none'}`);
  settle(shell, wrecks);

  // E on the shut lid opens lid and grid.
  const shut = lidAim(shell, leaves[0]!);
  tick(interaction, shut.eye, shut.at);
  tick(interaction, shut.eye, shut.at, { useHeld: true });
  result = tick(interaction, shut.eye, shut.at);
  check(`${id} ${side}: E on the shut lid opens lid and grid`, isOpen(shell, side) && result.boot?.side === side, `lid ${isOpen(shell, side)} · grid ${result.boot?.side ?? 'none'}`);
}

{
  const { interaction } = stage('kit_uaz2206');
  const { eye, at } = standAt('kit_vaz2106', 'bonnet');
  const result = tick(interaction, eye, at);
  check('kit_uaz2206: no bonnet, no bonnet grid', !(result.prompt ?? '').includes('bonnet'), result.prompt ?? '(nothing)');
}
{
  const { interaction } = stage('kit_vaz2106', false);
  const { eye, at } = standAt('kit_vaz2106', 'trunk');
  const result = tick(interaction, eye, at);
  check('kit shell before its lids arrive: nothing offered', result.prompt === null && result.boot === null, result.prompt ?? '(nothing)');
}
{
  // A full trunk under a shut lid: F aimed straight at a cell lifts the lid and takes
  // nothing; only the next press, the grid open, reaches in.
  const { shell, interaction, world, inventory } = stage('kit_vaz2106');
  world.state.wreckStorage['wreck:test'] = Array.from({ length: 8 }, (_, cell) => ({ type: 'bubble_gum' as const, id: `gum:${cell}`, charges: 3 }));
  const centre = new THREE.Vector3();
  storageCellBox(1, carModelMeasure('kit_vaz2106'), 'trunk', centre, new THREE.Vector3());
  const eye = centre.clone().add(new THREE.Vector3(0, 0.1, -1));
  tick(interaction, eye, centre, { mount: true });
  const kept = world.state.wreckStorage['wreck:test']!.filter((item) => item !== null).length;
  check('F at a cell under the shut lid takes nothing', kept === 8 && inventory.all.length === 0 && isOpen(shell, 'trunk'), `${kept} kept · lid ${isOpen(shell, 'trunk')}`);
  tick(interaction, eye, centre);
  tick(interaction, eye, centre, { mount: true });
  check('with the lid open, F reaches in', inventory.all.length === 1, `${inventory.all.length} carried`);
}
{
  // The van's shell: its bay under the cabin engine cover through the middle side door.
  const id = 'kit_uaz2206';
  const { shell, interaction, wrecks, world, inventory } = stage(id);
  world.state.wreckBonnet['wreck:test'] = Array.from({ length: BONNET_SLOT_COUNT }, (_, cell) => ({ type: 'bubble_gum' as const, id: `bay:${cell}`, charges: 3 }));
  const lids = shell.lids!;
  const door = lids.pivots.find((pivot) => pivot.name === 'door_rr')!;
  check(`${id}: the middle side door hangs`, door !== undefined && lids.controls.some((control) => control.id === 'door_rr'), lids.controls.map((control) => control.id).join(','));
  // Standing at the door: its shut outline's middle, half a metre out from its skin.
  const box = new THREE.Box3();
  for (const child of door.children) {
    const mesh = child as THREE.Mesh;
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    box.union(mesh.geometry.boundingBox!.clone().applyMatrix4(mesh.matrix));
  }
  box.translate(door.position);
  const left = box.max.x + box.min.x > 0;
  const eye = door.parent!.localToWorld(new THREE.Vector3(left ? box.max.x + 0.5 : box.min.x - 0.5, box.max.y - 0.1, (box.min.z + box.max.z) / 2));
  // Each cell's middle, the ray to it from the stretch of the door opening abreast of it.
  const cells = Array.from({ length: BONNET_SLOT_COUNT }, (_, cell) => {
    const centre = new THREE.Vector3();
    const size = new THREE.Vector3();
    storageCellBox(cell, carModelMeasure(id), 'bonnet', centre, size);
    return centre.addScaledVector(THREE.Object3D.DEFAULT_UP, size.y / 2);
  });
  const shutDoor = new THREE.Box3().setFromObject(door, true);
  const eyeAbreast = (at: THREE.Vector3): THREE.Vector3 => eye.clone().setZ(THREE.MathUtils.clamp(at.z, shutDoor.min.z + 0.2, shutDoor.max.z - 0.2));

  // Shut: F at a bay cell neither lifts the cover nor reaches in.
  tick(interaction, eye, cells[0]!);
  tick(interaction, eye, cells[0]!, { mount: true });
  let result = tick(interaction, eye, cells[0]!);
  check(`${id}: door shut, the bay is not reached`, !isOpen(shell, 'bonnet') && result.boot === null && inventory.all.length === 0, `cover ${isOpen(shell, 'bonnet')} · grid ${result.boot?.side ?? 'none'}`);

  // E on the shut door, aimed at its middle from outside, opens it, the cover lifts with
  // it, the grid opens.
  const doorMiddle = door.parent!.localToWorld(box.getCenter(new THREE.Vector3()));
  tick(interaction, eye, doorMiddle);
  tick(interaction, eye, doorMiddle, { useHeld: true });
  result = tick(interaction, eye, doorMiddle);
  check(`${id}: E opens the door, the cover and the grid`, lids.rig.get('door_rr') > 0.5 && isOpen(shell, 'bonnet') && result.boot?.side === 'bonnet', `door ${lids.rig.get('door_rr')} · cover ${isOpen(shell, 'bonnet')} · grid ${result.boot?.side ?? 'none'}`);
  settle(shell, wrecks);
  check(`${id}: the open door shows the cabin`, shell.model.getObjectByName('inside')!.visible, '');

  // Through the opening every cell is aimed and taken (the pack emptied between takes:
  // it holds three).
  const picked: string[] = [];
  let taken = 0;
  for (let cell = 0; cell < cells.length; cell++) {
    const at = cells[cell]!;
    const from = eyeAbreast(at);
    result = tick(interaction, from, at);
    const selected = result.boot?.selectedCell ?? null;
    tick(interaction, from, at, { mount: true });
    picked.push(`${cell}:${selected}@${from.distanceTo(at).toFixed(2)}m`);
    for (const item of [...inventory.all]) if (inventory.remove(item.id)) taken++;
  }
  const kept = world.state.wreckBonnet['wreck:test']!.filter((item) => item !== null).length;
  check(`${id}: every bay cell picked and taken from the door`, picked.every((entry, cell) => entry.startsWith(`${cell}:${cell}@`)) && kept === 0 && taken === BONNET_SLOT_COUNT, `${picked.join(' ')} · ${taken} taken`);

  // E on the open door shuts it and drops the cover; the grid goes.
  const swung = new THREE.Box3().setFromObject(door, true).getCenter(new THREE.Vector3());
  tick(interaction, eye, swung);
  tick(interaction, eye, swung, { useHeld: true });
  result = tick(interaction, eye, cells[0]!);
  check(`${id}: E shuts the door and the cover, the grid goes`, lids.rig.get('door_rr') < 0.5 && !isOpen(shell, 'bonnet') && result.boot === null, `door ${lids.rig.get('door_rr')} · cover ${isOpen(shell, 'bonnet')} · grid ${result.boot?.side ?? 'none'}`);
}
{
  const shells = kitIds.filter((id) => createStaticCarModel(id, `doors:${id}`).lids?.controls.some((control) => control.id.startsWith('door_')));
  check('only the van shell opens a side door', shells.join(',') === 'kit_uaz2206', shells.join(',') || '(none)');
}

// Program variants: the lids are the shell's mesh kind in its material; the inside is
// the one skinned mesh, the driven car's kind over the driven car's buffer.
{
  const shell = createStaticCarModel('kit_vaz2106', 'programs');
  const skinned: string[] = [];
  shell.model.traverse((node) => {
    if ((node as THREE.SkinnedMesh).isSkinnedMesh) skinned.push(node.name);
  });
  check('inside is the one skinned mesh, hidden while shut', skinned.join(',') === 'inside' && !shell.model.getObjectByName('inside')!.visible, skinned.join(','));
  check('the shell round the lids is no control', KitRig.controlOf(shell.model.getObjectByName('body')!) === null, '');
}

console.log(failures === 0 ? 'all checks passed' : `${failures} CHECK(S) FAILED`);
process.exitCode = failures === 0 ? 0 : 1;
