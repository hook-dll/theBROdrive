import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Road } from '../world/road';
import type { Terrain } from '../world/terrain';
import type { WorldOrigin } from '../world/origin';
import { material } from '../world/poi/kit';
import { POCKET_HALF_LENGTH_M, POCKET_HALF_WIDTH_M, type DreamPocket, type DreamRoute } from './dream';

/**
 * The dream's parking pockets, painted: a dashed rectangle on the lay-by's pad at the
 * start and at the goal.
 *
 * Each frame is one merged box geometry in the POI kit's flat material, casting and
 * receiving like a kit box: the program `marketProgramAnchor` links at boot, and the
 * frames are in the scene before the boot warm-up. Nothing here links a program
 * mid-drive.
 *
 * Each frame is its own group, placed relative to the floating origin and shifted on
 * every rebase, so neither ever holds a far absolute coordinate in f32.
 */

const PAINT = 0xe8e6df;
const DASH_M = 0.6;
const GAP_M = 0.35;
const LINE_WIDTH_M = 0.12;
/** Above the pad: clear of its depth, below a tyre's notice. */
const LINE_LIFT_M = 0.012;
const LINE_THICKNESS_M = 0.02;

export class DreamMarkers {
  private readonly groups: THREE.Group[] = [];

  constructor(route: DreamRoute, road: Road, terrain: Terrain, origin: WorldOrigin, scene: THREE.Scene) {
    const paint = material(PAINT);
    for (const pocket of [route.start, route.finish]) {
      const group = new THREE.Group();
      group.name = 'dream-pocket';
      const centre = road.offsetPoint(pocket.s, pocket.lateral);
      const centreY = terrain.laybySurfaceY(pocket.s, pocket.lateral, pocket.layby.side);
      group.position.set(centre.x - origin.x, centreY, centre.z - origin.z);
      // Local +Z along the road, local +X towards positive lateral (left of travel).
      group.rotation.y = road.sampleAt(pocket.s).heading;
      const mesh = new THREE.Mesh(pocketFrame(pocket, terrain, centreY), paint);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
      scene.add(group);
      this.groups.push(group);
    }
    origin.register({
      rebase: ({ dx, dz }) => {
        for (const group of this.groups) {
          group.position.x -= dx;
          group.position.z -= dz;
        }
      },
    });
  }
}

/**
 * The dashed rectangle in the pocket's own frame. Each dash sits on the pad where it
 * lies (the pad falls 1% away from the road), measured against the frame's centre.
 */
function pocketFrame(pocket: DreamPocket, terrain: Terrain, centreY: number): THREE.BufferGeometry {
  const dashes: THREE.BufferGeometry[] = [];
  const dashAt = (x: number, z: number, alongZ: boolean, length: number): void => {
    const y = terrain.laybySurfaceY(pocket.s + z, pocket.lateral + x, pocket.layby.side) - centreY;
    const box = alongZ
      ? new THREE.BoxGeometry(LINE_WIDTH_M, LINE_THICKNESS_M, length)
      : new THREE.BoxGeometry(length, LINE_THICKNESS_M, LINE_WIDTH_M);
    box.translate(x, y + LINE_LIFT_M, z);
    dashes.push(box);
  };
  // One side of the rectangle: dashes centred on it, a dash at each corner.
  const side = (halfSpan: number, place: (t: number, length: number) => void): void => {
    const span = halfSpan * 2;
    const count = Math.max(2, Math.round((span + GAP_M) / (DASH_M + GAP_M)));
    const length = (span - GAP_M * (count - 1)) / count;
    for (let i = 0; i < count; i++) place(-halfSpan + length / 2 + i * (length + GAP_M), length);
  };
  for (const x of [-POCKET_HALF_WIDTH_M, POCKET_HALF_WIDTH_M]) {
    side(POCKET_HALF_LENGTH_M, (z, length) => dashAt(x, z, true, length));
  }
  for (const z of [-POCKET_HALF_LENGTH_M, POCKET_HALF_LENGTH_M]) {
    side(POCKET_HALF_WIDTH_M, (x, length) => dashAt(x, z, false, length));
  }
  const merged = mergeGeometries(dashes, false);
  for (const dash of dashes) dash.dispose();
  if (!merged) throw new Error('dream pocket dashes failed to merge');
  return merged;
}
