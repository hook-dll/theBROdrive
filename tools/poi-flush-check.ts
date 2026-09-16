/**
 * Throwaway audit: do walls/floors/ceilings in the POI gallery meet each other flush
 * (touching, not interpenetrating)? A near-coplanar overlap that consumes almost the
 * ENTIRE thickness of the thinner panel along one axis, while sharing a substantial
 * area on the other two, is a duplicated/overlapping panel: two faces at nearly the
 * same plane, which the GPU cannot consistently depth-sort (flicker).
 *
 * Excluded by construction:
 *  - Wall-corner joins (two perpendicular walls sharing a thickness^2 x height cube):
 *    substantial overlap on all three axes, not a thin sliver on one.
 *  - Half-embedded trim/frame mouldings (a thin frame piece deliberately sunk HALF its
 *    own depth into an adjacent wall so the other half stands proud of it): the overlap
 *    there is close to 50% of the frame's own thickness, not close to 100%.
 *  - Floating-point "touching" (near-zero overlap reported as a tiny positive number).
 *
 *   npx tsx tools/_poi-flush-check.ts
 */

import * as THREE from 'three';
import { POI_VARIANTS } from '../src/world/poi-variants';

/** Below this, an axis overlap is numerical noise from floating-point touching. */
const TOUCH_EPS = 1e-4;
/** Above this, the other two axes are considered "a real shared area", not a sliver prop. */
const SIGNIFICANT = 0.15;
/** The thin-axis overlap must consume at least this fraction of the THINNER box's own
 *  extent along that axis to count as a near-duplicate panel rather than embedded trim. */
const FULL_DEPTH_FRACTION = 0.85;
/** A mesh must be no thicker than this along the overlap's thin axis to count as a
 *  wall/floor/ceiling panel rather than a post, pump or piece of furniture grounded on
 *  the floor (whose foot legitimately overlaps the floor's full thickness). */
const PANEL_MAX_THICKNESS = 0.4;

function isAxisAlignedWorld(mesh: THREE.Object3D): boolean {
  const q = new THREE.Quaternion();
  mesh.getWorldQuaternion(q);
  const m = new THREE.Matrix4().makeRotationFromQuaternion(q);
  const e = m.elements;
  for (let col = 0; col < 3; col++) {
    const x = Math.abs(e[col * 4]!);
    const y = Math.abs(e[col * 4 + 1]!);
    const z = Math.abs(e[col * 4 + 2]!);
    const near1 = [Math.abs(x - 1) < 1e-3, Math.abs(y - 1) < 1e-3, Math.abs(z - 1) < 1e-3];
    if (near1.filter(Boolean).length !== 1) return false;
  }
  return true;
}

let totalFlags = 0;
let totalCandidates = 0;

for (let index = 0; index < POI_VARIANTS.length; index++) {
  const def = POI_VARIANTS[index]!;
  const root = new THREE.Group();
  def.build(root);
  root.updateMatrixWorld(true);

  const candidates: { mesh: THREE.Mesh; box: THREE.Box3; size: THREE.Vector3 }[] = [];
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (mesh.userData.poiRoof === true) return;
    if (!(mesh.geometry instanceof THREE.BoxGeometry)) return;
    if (!isAxisAlignedWorld(mesh)) return;
    const box = new THREE.Box3().setFromObject(mesh);
    candidates.push({ mesh, box, size: box.getSize(new THREE.Vector3()) });
  });
  totalCandidates += candidates.length;

  const flags: string[] = [];
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const a = candidates[i]!;
      const b = candidates[j]!;
      if (!a.box.intersectsBox(b.box)) continue;
      const overlap = [
        Math.min(a.box.max.x, b.box.max.x) - Math.max(a.box.min.x, b.box.min.x),
        Math.min(a.box.max.y, b.box.max.y) - Math.max(a.box.min.y, b.box.min.y),
        Math.min(a.box.max.z, b.box.max.z) - Math.max(a.box.min.z, b.box.min.z),
      ];
      if (!(overlap[0]! > TOUCH_EPS && overlap[1]! > TOUCH_EPS && overlap[2]! > TOUCH_EPS)) continue;
      let thinAxis = 0;
      if (overlap[1]! < overlap[thinAxis]!) thinAxis = 1;
      if (overlap[2]! < overlap[thinAxis]!) thinAxis = 2;
      const other = [0, 1, 2].filter((k) => k !== thinAxis);
      const wide1 = overlap[other[0]!]!;
      const wide2 = overlap[other[1]!]!;
      if (!(wide1 > SIGNIFICANT && wide2 > SIGNIFICANT)) continue;
      // A post/pump/furniture leg planted at ground level naturally overlaps the WHOLE
      // thickness of a floor slab (its foot sits at y=0, inside the slab's own range) —
      // that is grounding, not a duplicated surface. Require BOTH meshes to be panel-thin
      // along the thin axis itself, not just "the floor happens to be thin": a slab is
      // thin along its own thickness; a post is not, whichever axis the overlap picks.
      const aThin = a.size.getComponent(thinAxis);
      const bThin = b.size.getComponent(thinAxis);
      if (!(aThin < PANEL_MAX_THICKNESS && bThin < PANEL_MAX_THICKNESS)) continue;
      const thinnerDepth = Math.min(aThin, bThin);
      if (!(overlap[thinAxis]! >= FULL_DEPTH_FRACTION * thinnerDepth)) continue;
      const ac = a.box.getCenter(new THREE.Vector3());
      const bc = b.box.getCenter(new THREE.Vector3());
      flags.push(
        `    axis ${'xyz'[thinAxis]} A centre(${ac.x.toFixed(2)},${ac.y.toFixed(2)},${ac.z.toFixed(2)}) size(${a.size.x.toFixed(2)},${a.size.y.toFixed(2)},${a.size.z.toFixed(2)}) x ` +
        `B centre(${bc.x.toFixed(2)},${bc.y.toFixed(2)},${bc.z.toFixed(2)}) size(${b.size.x.toFixed(2)},${b.size.y.toFixed(2)},${b.size.z.toFixed(2)}) ` +
        `-- overlap (${overlap[0]!.toFixed(3)},${overlap[1]!.toFixed(3)},${overlap[2]!.toFixed(3)})`,
      );
    }
  }
  if (flags.length > 0) {
    console.log(`${def.id} (${candidates.length} candidates): ${flags.length} near-duplicate panel(s)`);
    for (const f of flags) console.log(f);
    totalFlags += flags.length;
  }
}

console.log('');
console.log(`${totalCandidates} axis-aligned wall/floor/ceiling candidates scanned across ${POI_VARIANTS.length} variants`);
console.log(`${totalFlags} near-duplicate panel(s) flagged`);
process.exit(0);
