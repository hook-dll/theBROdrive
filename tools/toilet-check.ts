/**
 * The Japanese toilet POIs' gates that need no browser (docs/toilet-poi-design.md,
 * "Quality gates"):
 *
 *   nice -n 15 ~/.bun/bin/bun tools/toilet-check.ts
 *
 *  1. catalogue: stable unique ids, every variant registered as a POI variant, source
 *     cards complete;
 *  2. merge: the world's cached instance (world/poivariantbuild.ts) is the merged gallery
 *     form, mesh for mesh and roof for roof, within 1 cm, in few draws;
 *  3. placement: stands on the ground, inside its authored footprint, door clear of its
 *     dressing (opened too), every interior fixture inside the cabin in every state;
 *  4. z-fighting: no near-duplicate panel and no same-facing coplanar box faces of two
 *     looks within 2 mm, static shell and rig together, in every state; the live mirror
 *     clear of its glass;
 *  5. fixtures: every verb opens, closes, turns, presses, pumps or wipes what it says;
 *  6. lamp: one light per cabin in every state, lit by intensity alone;
 *  7. mirror: the camera stands at the reflected eye, near plane on the glass, far plane
 *     bounded, and refuses an eye behind the glass;
 *  8. determinism: two builds of a shell and a rig are identical;
 *  9. save/load: every state and completion round-trips through JSON, a rebuilt rig shows
 *     it, and malformed records are refused;
 * 10. face: every emotion lands, brows tilt the right way.
 *
 * What still needs the browser (gallery `window.__poiGallery`): the rendered mirror, the
 * day/night look and no shader-program growth while fixtures and states change.
 */

import * as THREE from 'three';
import { aimMirrorCamera } from '../src/render/mirrorview';
import { createPoiVariant, mergePoiStatics, poiVariantIndex } from '../src/world/poi-variants';
import { createVariantInstance } from '../src/world/poivariantbuild';
import { TOILET_VARIANTS } from '../src/world/toilets/catalog';
import { toiletFootprint, toiletLayout, type ToiletLayout } from '../src/world/toilets/geometry';
import { MIRROR_FAR } from '../src/world/toilets/mirror';
import { ToiletRig } from '../src/world/toilets/rig';
import { completeToilet, decodeToiletProgress, encodeToiletProgress, newToiletProgress, withToiletState } from '../src/world/toilets/state';
import { TOILET_EMOTIONS, TOILET_STATES, type ToiletVariant } from '../src/world/toilets/types';
import { boxCandidates, coplanarFaces, nearDuplicatePanels } from './poizfight';

const failures: string[] = [];
function check(condition: boolean, message: string): void {
  if (!condition) failures.push(message);
}

/** Two looks closer than this along a shared plane fight (tools/kit-zfight.ts FIGHT_GAP). */
const FIGHT_GAP = 0.002;
/** Most draws a merged shell may take; the masts take 6-49. */
const MAX_SHELL_MESHES = 40;

function meshes(root: THREE.Object3D): THREE.Mesh[] {
  const found: THREE.Mesh[] = [];
  root.traverse((object) => {
    if ((object as THREE.Mesh).isMesh) found.push(object as THREE.Mesh);
  });
  return found;
}

function boundsOf(object: THREE.Object3D): THREE.Box3 {
  object.updateWorldMatrix(true, true);
  return new THREE.Box3().setFromObject(object, true);
}

/** A rig over a fresh merged instance, posed for `state` and landed there. */
function posedRig(variant: ToiletVariant, state: (typeof TOILET_STATES)[number]): { group: THREE.Group; rig: ToiletRig } {
  const group = createVariantInstance(poiVariantIndex(variant.id)).group;
  const rig = new ToiletRig(variant);
  group.add(rig.root);
  rig.pose(withToiletState(newToiletProgress(variant), state));
  rig.update(0, true);
  group.updateMatrixWorld(true);
  return { group, rig };
}

// --- 1. catalogue ------------------------------------------------------------
{
  const ids = new Set<string>();
  for (const variant of TOILET_VARIANTS) {
    check(!ids.has(variant.id), `${variant.id}: id used twice`);
    ids.add(variant.id);
    check(variant.id.startsWith('toilet-'), `${variant.id}: toilet ids start with "toilet-"`);
    let registered = true;
    try {
      poiVariantIndex(variant.id);
    } catch {
      registered = false;
    }
    check(registered, `${variant.id}: not registered in POI_VARIANTS`);
    check(new Set(variant.fixtures).size === variant.fixtures.length, `${variant.id}: a fixture is listed twice`);
    check(variant.fixtures.includes('lid') === (variant.bowl === 'washlet'), `${variant.id}: a lid goes with a washlet bowl and only with one`);
    check(variant.sources.length > 0, `${variant.id}: no source card`);
    for (const card of variant.sources) {
      check(card.url.startsWith('https://'), `${variant.id}: source url ${card.url}`);
      check(/^\d{4}-\d{2}-\d{2}$/.test(card.accessed), `${variant.id}: source accessed date ${card.accessed}`);
      check(card.title.length > 0 && card.author.length > 0 && card.licence.length > 0, `${variant.id}: source card incomplete`);
      check(Boolean(card.silhouette ?? card.plan ?? card.fixtures ?? card.palette), `${variant.id}: source card records no fact used`);
    }
  }
  console.log(`  ${TOILET_VARIANTS.length} variants catalogued, ${TOILET_VARIANTS.reduce((n, v) => n + v.sources.length, 0)} source cards`);
}

// --- 2. merge: the world's instance is the gallery's merged form ---------------
{
  let worst = 0;
  let most = 0;
  for (const variant of TOILET_VARIANTS) {
    const index = poiVariantIndex(variant.id);
    let gallery: THREE.Group;
    try {
      gallery = createPoiVariant(index);
    } catch (error) {
      check(false, `${variant.id}: ${(error as Error).message}`);
      continue;
    }
    mergePoiStatics(gallery);
    const instance = createVariantInstance(index);
    const galleryMeshes = meshes(gallery);
    const instanceMeshes = meshes(instance.group);
    check(instanceMeshes.length === galleryMeshes.length, `${variant.id}: the world builds ${instanceMeshes.length} meshes where the gallery shows ${galleryMeshes.length}`);
    const roofs = (list: THREE.Mesh[]): number => list.filter((mesh) => mesh.userData.poiRoof === true).length;
    check(roofs(instanceMeshes) === roofs(galleryMeshes), `${variant.id}: roof panels differ between world and gallery`);
    check(roofs(galleryMeshes) > 0, `${variant.id}: no roof panel for the gallery's roof toggle`);
    const want = boundsOf(gallery);
    const got = boundsOf(instance.group);
    const delta = Math.max(want.min.distanceTo(got.min), want.max.distanceTo(got.max));
    worst = Math.max(worst, delta);
    most = Math.max(most, instanceMeshes.length);
    check(delta < 0.01, `${variant.id}: the world's building is ${delta.toFixed(3)} m off the gallery's`);
    check(instanceMeshes.length <= MAX_SHELL_MESHES, `${variant.id}: ${instanceMeshes.length} meshes after merging, over ${MAX_SHELL_MESHES}`);
    check(instance.solid.getAttribute('position').count >= 3, `${variant.id}: empty collider`);
  }
  console.log(`  merged shells match the gallery within ${worst.toFixed(4)} m, at most ${most} meshes each`);
}

// --- 3. placement ---------------------------------------------------------------
{
  for (const variant of TOILET_VARIANTS) {
    const instance = createVariantInstance(poiVariantIndex(variant.id));
    const bounds = boundsOf(instance.group);
    const [footX, footZ] = toiletFootprint(variant.shell);
    check(Math.abs(bounds.min.y) < 1e-3, `${variant.id}: lowest point at ${bounds.min.y.toFixed(3)} m, not on the ground`);
    const halfX = Math.max(-bounds.min.x, bounds.max.x);
    const halfZ = Math.max(-bounds.min.z, bounds.max.z);
    check(halfX <= footX / 2 + 1e-3 && halfZ <= footZ / 2 + 1e-3, `${variant.id}: measured half extent ${halfX.toFixed(2)} x ${halfZ.toFixed(2)} exceeds footprint ${footX} x ${footZ}`);
    check(footX / 2 - halfX < 0.05 && footZ / 2 - halfZ < 0.05, `${variant.id}: footprint ${footX} x ${footZ} is loose on ${halfX.toFixed(2)} x ${halfZ.toFixed(2)}`);
    check(instance.footprint[0] === footX && instance.footprint[1] === footZ, `${variant.id}: POI footprint is not the shell's`);

    const layout = toiletLayout(variant);
    const room = new THREE.Box3(
      new THREE.Vector3(layout.inner.minX, layout.floorY - 1e-3, layout.inner.minZ),
      new THREE.Vector3(layout.inner.maxX, layout.ceilingY + 1e-3, layout.inner.maxZ),
    );
    for (const state of TOILET_STATES) {
      const { rig } = posedRig(variant, state);
      for (const kind of variant.fixtures) {
        if (kind === 'door') continue;
        const node = rig.fixture(kind)?.node;
        if (!node) continue;
        for (const mesh of meshes(node)) {
          if (!mesh.visible) continue;
          const box = boundsOf(mesh);
          check(room.containsBox(box), `${variant.id} ${state}: ${kind} leaves the cabin (${box.min.toArray().map((v) => v.toFixed(2))} .. ${box.max.toArray().map((v) => v.toFixed(2))})`);
        }
      }
    }

    // The open door against everything standing in front of the cabin.
    const { group, rig } = posedRig(variant, 'inspected');
    const door = rig.fixture('door');
    check(door?.current === 1, `${variant.id}: the door is not open when inspected`);
    const leaf = boundsOf(door!.node);
    check(leaf.min.z < -variant.shell.depth / 2 - 0.6, `${variant.id}: the open door does not swing out (${leaf.min.z.toFixed(2)})`);
    const unmerged = createPoiVariant(poiVariantIndex(variant.id));
    unmerged.position.copy(group.position);
    for (const mesh of meshes(unmerged)) {
      const box = boundsOf(mesh);
      if (box.max.z >= -variant.shell.depth / 2 - 0.07) continue;
      check(!box.intersectsBox(leaf), `${variant.id}: the open door hits the dressing in front of the cabin`);
    }
  }
  console.log('  shells stand on the ground inside their footprints; fixtures stay in the cabin; doors swing clear');
}

// --- 4. z-fighting ----------------------------------------------------------------
{
  let flagged = 0;
  let scanned = 0;
  for (const variant of TOILET_VARIANTS) {
    const shell = createPoiVariant(poiVariantIndex(variant.id));
    const panels = nearDuplicatePanels(boxCandidates(shell, true));
    for (const flag of panels) check(false, `${variant.id}: near-duplicate panel ${flag}`);
    flagged += panels.length;
    const seen = new Set<string>();
    for (const state of TOILET_STATES) {
      const rig = new ToiletRig(variant);
      shell.add(rig.root);
      rig.pose(withToiletState(newToiletProgress(variant), state));
      rig.update(0, true);
      const candidates = boxCandidates(shell, true);
      scanned += candidates.length;
      for (const flag of coplanarFaces(candidates, FIGHT_GAP)) {
        if (seen.has(flag)) continue;
        seen.add(flag);
        check(false, `${variant.id} ${state}: coplanar ${flag}`);
        flagged++;
      }
      rig.dispose();
    }
    // The live face lies in front of the static glass, never on it.
    const layout: ToiletLayout = toiletLayout(variant);
    const rig = new ToiletRig(variant);
    const face = boundsOf(rig.mirrorFace);
    const gap = layout.mirror.glassZ - face.max.z;
    check(gap >= 0.005, `${variant.id}: live mirror ${(gap * 1000).toFixed(1)} mm from its glass`);
  }
  console.log(`  ${scanned} box placements scanned over every state, ${flagged} z-fight(s)`);
}

// --- 5. fixtures open and close ------------------------------------------------------
{
  for (const variant of TOILET_VARIANTS) {
    const { rig } = posedRig(variant, 'arrived');
    const layout = toiletLayout(variant);
    const settle = (): void => {
      rig.update(0, true);
    };
    const door = rig.fixture('door')!;
    check(rig.activate('door', 'open') && (settle(), door.current === 1), `${variant.id}: door does not open`);
    check(!rig.activate('door', 'open'), `${variant.id}: an open door opens again`);
    check(rig.activate('door', 'close') && (settle(), door.current === 0), `${variant.id}: door does not close`);
    const shut = boundsOf(door.node);
    check(Math.abs((shut.min.z + shut.max.z) / 2 - layout.door.hingeZ) < 0.05, `${variant.id}: the shut door is not in its wall`);
    check(!rig.activate('door', 'wipe'), `${variant.id}: the door answers to "wipe"`);

    const lid = rig.fixture('lid');
    if (lid) {
      check(rig.activate('lid') && (settle(), boundsOf(lid.node).max.y > layout.bowl.rimY + 0.3), `${variant.id}: the lid does not stand up when opened`);
      check(rig.activate('lid') && (settle(), boundsOf(lid.node).max.y < layout.bowl.rimY + 0.05), `${variant.id}: the lid does not lie down when closed`);
    }

    const valve = rig.fixture('valve')!;
    const openBefore = valve.goal;
    check(rig.activate('valve', 'turn') && valve.goal === 1 - openBefore, `${variant.id}: the valve does not turn`);
    settle();
    check(Math.abs(valve.node.rotation.z + valve.current * 1.5 * Math.PI) < 1e-6, `${variant.id}: the valve wheel is not where its channel says`);

    const flush = rig.fixture('flush')!;
    check(rig.activate('flush', 'press'), `${variant.id}: the flush does not press`);
    let peak = 0;
    for (let i = 0; i < 40; i++) {
      rig.update(0.025);
      peak = Math.max(peak, flush.current);
    }
    check(peak === 1 && flush.current === 0, `${variant.id}: the flush button does not go in and spring back (peak ${peak}, now ${flush.current})`);

    const plunger = rig.fixture('plunger')!;
    check(!rig.activate('plunger', 'pump'), `${variant.id}: a stowed plunger pumps`);
    check(rig.activate('plunger', 'insert') && (settle(), plunger.current === 1), `${variant.id}: the plunger does not go in`);
    const inPan = plunger.node.position;
    check(Math.hypot(inPan.x - layout.plunger.inUse[0], inPan.z - layout.plunger.inUse[2]) < 1e-6, `${variant.id}: the plunger is not over the pan`);
    check(rig.activate('plunger', 'pump'), `${variant.id}: an inserted plunger does not pump`);
    check(rig.activate('plunger', 'pull') && (settle(), plunger.current === 0), `${variant.id}: the plunger does not come out`);

    const dirt = rig.fixture('floor-dirt')!;
    let wipes = 0;
    while (rig.activate('floor-dirt', 'wipe')) wipes++;
    settle();
    check(wipes === 3 && dirt.current === 0, `${variant.id}: the floor takes ${wipes} wipes and is at ${dirt.current}`);
    check(meshes(dirt.node).every((mesh) => !mesh.visible), `${variant.id}: dirt still shows on a clean floor`);
  }
  console.log('  every fixture verb does what it says');
}

// --- 6. lamp ------------------------------------------------------------------
{
  for (const variant of TOILET_VARIANTS) {
    for (const state of TOILET_STATES) {
      const { group, rig } = posedRig(variant, state);
      let lights = 0;
      group.traverse((object) => {
        if ((object as THREE.Light).isLight) {
          lights++;
          check(!(object as THREE.Light).castShadow, `${variant.id}: the lamp casts`);
        }
      });
      check(lights === 1, `${variant.id} ${state}: ${lights} lights, not one`);
      if (state === 'healthy') check(rig.lamp === 'steady' && rig.light.intensity > 0, `${variant.id}: a healthy toilet's lamp is not steady`);
    }
    const { rig } = posedRig(variant, 'arrived');
    const twin = posedRig(variant, 'arrived').rig;
    let low = Infinity;
    let high = 0;
    let same = true;
    for (let i = 0; i < 400; i++) {
      rig.update(0.025);
      twin.update(0.025);
      low = Math.min(low, rig.light.intensity);
      high = Math.max(high, rig.light.intensity);
      same &&= rig.light.intensity === twin.light.intensity;
    }
    check(rig.lamp === 'flicker' && low < 0.2 * high, `${variant.id}: the arrival lamp does not flicker (${low}..${high})`);
    check(same, `${variant.id}: the flicker is not deterministic`);
  }
  console.log('  one non-casting lamp per cabin in every state; arrival flickers, healthy is steady');
}

// --- 7. mirror -----------------------------------------------------------------
{
  const camera = new THREE.PerspectiveCamera();
  for (const variant of TOILET_VARIANTS) {
    const layout = toiletLayout(variant);
    const rig = new ToiletRig(variant);
    rig.root.updateMatrixWorld(true);
    const faceZ = layout.mirror.glassZ - 0.01;
    const eye = new THREE.Vector3(layout.mirror.x + 0.1, layout.mirror.y - 0.1, faceZ - 1.2);
    check(aimMirrorCamera(camera, rig.mirrorFace, eye, MIRROR_FAR), `${variant.id}: the mirror refuses an eye in front of it`);
    check(Math.abs(camera.position.z - (2 * faceZ - eye.z)) < 1e-6, `${variant.id}: the mirror camera is not at the reflected eye`);
    check(Math.abs(camera.near - (faceZ - eye.z)) < 1e-6 && camera.far === MIRROR_FAR, `${variant.id}: the mirror frustum is not bounded by glass and ${MIRROR_FAR} m`);
    check(!aimMirrorCamera(camera, rig.mirrorFace, new THREE.Vector3(layout.mirror.x, layout.mirror.y, faceZ + 0.3), MIRROR_FAR), `${variant.id}: the mirror draws for an eye behind its glass`);
    check(!rig.mirrorFace.visible, `${variant.id}: a mirror face shows before it is drawn`);
  }
  console.log(`  mirror cameras reflect the eye, near plane on the glass, far plane ${MIRROR_FAR} m`);
}

// --- 8. determinism -----------------------------------------------------------
{
  const signature = (root: THREE.Object3D): string => {
    root.updateMatrixWorld(true);
    return meshes(root)
      .map((mesh) => {
        const position = mesh.geometry.getAttribute('position');
        let sum = 0;
        for (let i = 0; i < position.count * 3; i++) sum += (position.array[i] as number) * ((i % 7) + 1);
        return `${position.count}:${sum.toFixed(5)}:${mesh.matrixWorld.elements.map((v) => v.toFixed(5)).join(',')}`;
      })
      .join('|');
  };
  for (const variant of TOILET_VARIANTS) {
    const build = (): THREE.Group => {
      const root = createPoiVariant(poiVariantIndex(variant.id));
      mergePoiStatics(root);
      return root;
    };
    check(signature(build()) === signature(build()), `${variant.id}: two builds of the shell differ`);
    check(signature(posedRig(variant, 'repairing').rig.root) === signature(posedRig(variant, 'repairing').rig.root), `${variant.id}: two rigs differ`);
  }
  console.log('  shells and rigs rebuild identically');
}

// --- 9. save and load -----------------------------------------------------------
{
  for (const variant of TOILET_VARIANTS) {
    let progress = newToiletProgress(variant);
    for (const state of TOILET_STATES) {
      progress = withToiletState(progress, state);
      const back = decodeToiletProgress(JSON.parse(JSON.stringify(encodeToiletProgress(progress))));
      check(JSON.stringify(back) === JSON.stringify(progress), `${variant.id} ${state}: the save does not round-trip`);
    }
    const once = completeToilet(withToiletState(newToiletProgress(variant), 'testing'), 12);
    const twice = completeToilet(withToiletState(once, 'arrived'), null);
    check(once.state === 'healthy' && once.completion?.count === 1 && once.completion.lastDay === 12, `${variant.id}: completion is not recorded`);
    check(twice.completion?.count === 2 && twice.completion.lastDay === null, `${variant.id}: a second completion is not counted`);

    // Rebuilt from the catalogue and posed from the record, a completed toilet is healthy.
    const restored = decodeToiletProgress(JSON.parse(JSON.stringify(encodeToiletProgress(once))));
    const rig = new ToiletRig(variant);
    rig.pose(restored);
    rig.update(0, true);
    const values = rig.fixtureValues();
    check(values['floor-dirt'] === 0 && values.door === 0 && rig.lamp === 'steady', `${variant.id}: a restored completed toilet does not look healthy`);
    if (rig.face) check(rig.face.current === 'proud', `${variant.id}: a restored completed toilet's face is ${rig.face.current}`);

    const good = encodeToiletProgress(once);
    const bad: unknown[] = [
      { ...good, v: 2 },
      { ...good, variantId: 'toilet-nowhere' },
      { ...good, scenarioId: 'flooded-floor' },
      { ...good, state: 'sparkling' },
      { ...good, completion: { count: 0, lastDay: null } },
      { ...good, completion: { count: 1, lastDay: 'monday' } },
      null,
    ];
    for (const record of bad) {
      let refused = false;
      try {
        decodeToiletProgress(record);
      } catch {
        refused = true;
      }
      check(refused, `${variant.id}: a malformed record is accepted: ${JSON.stringify(record)}`);
    }
  }
  console.log('  progress round-trips through JSON, restores healthy, refuses malformed records');
}

// --- 10. face ------------------------------------------------------------------
{
  const faced = TOILET_VARIANTS.filter((variant) => variant.face !== null);
  check(faced.length > 0 && faced.length < TOILET_VARIANTS.length, 'the face is meant to be optional: some variants have one, some do not');
  for (const variant of faced) {
    const rig = new ToiletRig(variant);
    const face = rig.face!;
    check(face.current === variant.face!.arrival, `${variant.id}: the face does not arrive ${variant.face!.arrival}`);
    for (const emotion of TOILET_EMOTIONS) {
      face.setEmotion(emotion);
      face.update(0, true);
      check(face.current === emotion, `${variant.id}: the face does not show ${emotion}`);
    }
    // Brows: anger drops the inner ends, worry raises them.
    const innerDrop = (emotion: 'angry' | 'worried'): number => {
      face.setEmotion(emotion);
      face.update(0, true);
      face.group.updateMatrixWorld(true);
      const brow = face.group.children.find((child) => (child as THREE.Mesh).isMesh && child.position.x > 0 && child.position.y > variant.face!.size * 1.15);
      if (!brow) return NaN;
      const inner = brow.localToWorld(new THREE.Vector3(-0.5, 0, 0));
      const outer = brow.localToWorld(new THREE.Vector3(0.5, 0, 0));
      return outer.y - inner.y;
    };
    check(innerDrop('angry') > 0, `${variant.id}: angry brows do not drop at the inner end`);
    check(innerDrop('worried') < 0, `${variant.id}: worried brows do not rise at the inner end`);
  }
  console.log(`  ${faced.length} faces show all ${TOILET_EMOTIONS.length} emotions`);
}

if (failures.length > 0) {
  console.log(`\n${failures.length} failure(s):`);
  for (const failure of failures) console.log(`  FAIL ${failure}`);
  process.exit(1);
}
console.log('\ntoilet check: all gates pass');
