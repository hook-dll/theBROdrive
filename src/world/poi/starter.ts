import * as THREE from 'three';

import {
  C,
  FURNITURE_SCALE,
  bed,
  box,
  buildingShell,
  chair,
  counter,
  crate,
  partition,
  registerDoorClearance,
  roomLight,
  roomLights,
  rug,
  shelf,
  shellOpeningsBetween,
  sofa,
  table,
  type ShellLayout,
} from './kit';
import { staircase, stairwellRailing, upperFloorWithStairwell } from './houses';

/** The garage wing's offset from the variant's origin, metres. */
const GARAGE_WING_X = 8.68;

/**
 * The starter garage's shelf, in the VARIANT's own frame, and what it is built from.
 *
 * Exported because the player's starting items are placed on this shelf by `house.ts`,
 * which works in the homestead's own (u, v) frame. Sharing the numbers is what keeps the
 * items on the shelf: restating them next door would put them in the sand the first time
 * the shelf moved.
 */
export const STARTER_GARAGE_SHELF = {
  /** Centre, in the variant's own coordinates: the garage's offset plus the shelf's own. */
  centreX: GARAGE_WING_X + 3.6,
  centreZ: 1.2,
  /** Where `shelf()` is called, in the garage group's frame. */
  localX: 3.6,
  localZ: 1.2,
  yaw: Math.PI / 2,
  width: 4.5,
  /** Half the usable depth of a plank along the shelf's own z, metres. */
  halfDepth: 0.275 * FURNITURE_SCALE,
  /** Half the shelf's own length along its own x, metres. */
  halfWidth: (4.5 / 2) * FURNITURE_SCALE,
} as const;

export function buildStarterHome(root: THREE.Group): void {
  const floorHeight = 3.25;
  const totalHeight = 6.6;
  const house = new THREE.Group();
  house.position.x = -4.5;
  root.add(house);
  const stairwell: readonly [number, number, number, number] = [3.0, 5.5, -3.2, 0.65];
  buildingShell(house, {
    width: 17, depth: 13, height: totalHeight, wall: C.plasterPale, roof: C.roof,
    wallPattern: 'plaster', roofPattern: 'tiles',
    front: [
      [-0.9, 0.6, 0, 2.5], [-7.0, -5.2, 1.0, 2.4], [2.3, 4.1, 1.0, 2.4], [5.6, 7.4, 1.0, 2.4],
      [-7.0, -5.2, 4.05, 5.5], [-0.9, 0.9, 4.05, 5.5], [2.3, 3.8, floorHeight, 5.55], [5.6, 7.4, 4.05, 5.5],
    ],
    back: [
      [-7.0, -5.2, 1.0, 2.4], [-0.9, 0.9, 1.0, 2.4], [5.7, 7.1, 0, 2.45],
      [-7.0, -5.2, 4.05, 5.5], [-0.9, 0.9, 4.05, 5.5], [5.5, 7.3, 4.05, 5.5],
    ],
    left: [[-4.2, -2.4, 1.0, 2.4], [2.4, 4.2, 1.0, 2.4], [-4.2, -2.4, 4.05, 5.5], [2.4, 4.2, 4.05, 5.5]],
    right: [[-1.0, 0.4, 0, 2.45], [-4.2, -2.4, 4.05, 5.5], [2.4, 4.2, 4.05, 5.5]],
  });
  registerDoorClearance(
    house,
    new THREE.Box3(
      new THREE.Vector3(2.3, floorHeight + 0.08, -6.8),
      new THREE.Vector3(3.8, 5.55, -5.45),
    ),
    'upper balcony door',
  );
  partition(house, 'z', -2.5, 13, floorHeight, -2.4);
  partition(house, 'x', 1.6, 17, floorHeight, 4.6);
  upperFloorWithStairwell(house, 17, 13, floorHeight, stairwell);
  staircase(house, 4.25, -4.7, 0, floorHeight, 1.55, stairwell);
  stairwellRailing(house, floorHeight, stairwell);
  const upper = new THREE.Group();
  upper.position.y = floorHeight;
  upper.userData.poiShell = shellOpeningsBetween(house.userData.poiShell as ShellLayout, floorHeight, totalHeight);
  house.add(upper);
  partition(upper, 'z', 1.15, 13, floorHeight, 2.8);

  sofa(house, 0.5, -4.0, Math.PI + 0.08, C.fadedGreen);
  sofa(house, 0.5, -1.0, 0, C.ochre);
  rug(house, 0.5, -2.5, 4.6, 2.6, C.fadedRed, 0.02);
  table(house, -5.4, -0.7, 0.04);
  chair(house, -5.4, -1.9, Math.PI);
  chair(house, -5.4, 0.5, 0);
  bed(house, -5.3, 4.2, Math.PI / 2, C.fabric);
  rug(house, -5.3, 4.2, 3.2, 3.0, C.ochre);
  shelf(house, 7.3, -3.2, 3.0, Math.PI / 2, false);
  bed(upper, -4.8, 2.8, Math.PI / 2, C.fadedBlue);
  bed(upper, 4.8, 3.7, Math.PI / 2, C.fabric);
  rug(upper, 4.8, 3.7, 3.1, 3.0, C.fadedRed);
  sofa(upper, -3.8, -4.0, Math.PI + 0.02, C.fadedBlue);
  table(upper, -3.8, -2.2, 0);
  rug(upper, -3.8, -3.0, 4.2, 2.6, C.ochre);

  roomLight(house, -5.5, -2.5, floorHeight, [-2.62, 1.3, -3.4], Math.PI / 2);
  roomLight(house, -5.5, 4.0, floorHeight, [-2.62, 1.3, -1.25], Math.PI / 2);
  roomLight(house, 3.0, -2.5, floorHeight, [0.95, 1.3, -6.38], Math.PI);
  roomLight(house, 3.0, 4.0, floorHeight, [3.7, 1.3, 1.48], 0);
  roomLight(upper, -3.5, 0, floorHeight + 0.05, [1.03, 1.3, 1.8], Math.PI / 2);
  roomLight(upper, 5.0, 0, floorHeight + 0.05, [1.27, 1.3, 3.8], -Math.PI / 2);

  // --- Upper balcony: a proper depth, and a railing closed on all three open
  // sides (the fourth is the house wall the door is in) rather than a scatter of
  // posts with one top rail and nothing between them. ---
  box(house, [8.0, 0.18, 2.6], [3.2, floorHeight + 0.06, -7.4], C.timber);
  for (const x of [1.4, 3.2, 5.0]) box(house, [0.08, 1.0, 0.08], [x, floorHeight + 0.5, -8.6], C.darkTimber);
  box(house, [8.0, 0.08, 0.08], [3.2, floorHeight + 0.96, -8.6], C.darkTimber);
  box(house, [8.0, 0.06, 0.06], [3.2, floorHeight + 0.15, -8.6], C.darkTimber);
  for (const x of [0.3, 2.3, 4.1, 6.1]) box(house, [0.05, 0.82, 0.05], [x, floorHeight + 0.56, -8.6], C.darkTimber);
  for (const side of [-0.8, 7.2]) {
    // The corner post also closes the front rail's end, so front and side never
    // double up a post 0.4 m apart from each other at the same corner.
    box(house, [0.08, 1.0, 0.08], [side, floorHeight + 0.5, -8.6], C.darkTimber);
    box(house, [0.08, 1.0, 0.08], [side, floorHeight + 0.5, -6.3], C.darkTimber);
    box(house, [0.08, 0.08, 2.3], [side, floorHeight + 0.96, -7.45], C.darkTimber);
  }

  // --- Ground-floor porch: deck, its lean-to roof, and the posts that hold it up.
  //
  // The roof's tilt was `+0.08` — this same file's OWN garage canopy at the bottom
  // of this function uses `-0.1` for the same shape at the same kind of eave, and
  // that is the correct sign: a lean-to's high edge is where it meets the house
  // wall, sloping DOWN and away so rain runs off the porch, not toward it. `+0.08`
  // had it backwards — the eave over the door was the LOW one.
  //
  // The support posts were seven, evenly spaced through dead centre — exactly
  // where the front door is, so one of them stood in the doorway. Eight posts,
  // offset by half a bay, put the gap at centre instead of a post.
  box(house, [18.5, 0.18, 2.3], [0, 0.2, -7.6], C.timber);
  box(house, [18.5, 0.18, 2.7], [0, 3.0, -7.5], C.roofTin, [-0.08, 0, 0], true);
  for (const x of [-9.1, -6.5, -3.9, -1.3, 1.3, 3.9, 6.5, 9.1]) box(house, [0.14, 2.75, 0.14], [x, 1.5, -8.2], C.darkTimber);
  box(house, [1.3, 2.1, 0.45], [-7.65, 1.25, 3.8], C.brick);
  box(house, [1.5, 0.18, 0.7], [-7.65, 2.3, 3.8], C.darkTimber);
  box(house, [0.8, 2.6, 0.8], [-6.7, 7.8, 3.8], C.brick);

  const garage = new THREE.Group();
  garage.position.x = GARAGE_WING_X;
  root.add(garage);
  buildingShell(garage, {
    width: 9, depth: 10, height: 3.8, wall: C.concreteLight, roof: C.roofTin, flatRoof: true, wallPattern: 'blocks', roofPattern: 'metal',
    front: [[-3.5, 3.5, 0, 3.15]],
    back: [[-3.2, -1.3, 1.0, 2.4], [1.2, 3.2, 1.0, 2.4]],
    left: [[-1.0, 0.4, 0, 2.45]],
    right: [[-3.5, -1.5, 1.0, 2.4], [1.5, 3.5, 1.0, 2.4]],
  });
  counter(garage, 0, 3.8, 5.5, 0);
  shelf(
    garage,
    STARTER_GARAGE_SHELF.localX,
    STARTER_GARAGE_SHELF.localZ,
    STARTER_GARAGE_SHELF.width,
    STARTER_GARAGE_SHELF.yaw,
    false,
  );
  crate(garage, -3.5, 3.8, 0.2, 0.65);
  roomLights(garage, [[-2.2, 0], [2.2, 0]], 3.8, [4.38, 1.35, 0], Math.PI / 2);
  box(garage, [10.0, 0.22, 1.8], [0, 3.45, -5.6], C.roofTin, [-0.1, 0, 0], true);
}
