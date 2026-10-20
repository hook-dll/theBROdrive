import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { SurfaceType } from '../core/surfaces';
import { freezeStaticSubtree, type ChunkContent, type ChunkContext, type ChunkProvider } from './chunks';
import { desertAt } from './gradient';
import { laybysBetween, type Layby } from './layby';
import { SIGN_PLANE } from './market';
import { placeNameAt } from './placenames';
import { box, C } from './poi/kit';
import { addStatic } from './props/scatter';
import { paintPlate, plateStyle, RING_GLYPH } from './signplates';

/**
 * SIGNPOSTS: every lay-by's board, naming the stop and the stops either way.
 *
 * A painted board on two posts at the pad's far edge, facing the road. The headline is
 * the stop's own name (world/placenames.ts); below it the neighbouring stops with a
 * lay-by, behind and ahead, each with its arrow and its road distance. The arrows are
 * as a driver sees them from the road looking at the board: on a stop LEFT of travel
 * the road ahead runs off to his right, on one RIGHT of travel to his left. Behind the
 * first stop there is no stop, only the turning circle where the road begins: the
 * board paints it as a ring (`RING_GLYPH`).
 *
 * The board is its region's plate (world/signplates.ts): every stop in one desert wears
 * the same design under the desert's name, the next desert another. Its text is the
 * stop's alone, so its material is painted per board and disposed with the chunk; every
 * board has one shape (a map, no shadows), the market sign's, whose program
 * `marketProgramAnchor` links at boot, and the backing and posts are kit boxes.
 * Colliders on the posts only, in the physics band.
 */

/** Board above the pad, metres: width, height, and its centre's height. */
const BOARD_W = 2.6;
const BOARD_H = 1.3;
const BOARD_Y = 2.05;
/** The backing box behind the board: its depth, and its rim round the board, metres. */
const BACKING_DEPTH = 0.04;
const BACKING_RIM = 0.05;
/**
 * Air between the board's face and the backing's front, and between the backing's back
 * and the posts' fronts, metres. Each is five times the depth buffer's step at 80 m
 * (about 5 mm with the 0.08 m near plane and 24 bits), so no two faces of the sign are
 * ever close enough to fight. The posts used to stand flush with the backing's front
 * and the board 1 cm before it, and both flickered from the road.
 */
const BOARD_STANDOFF = 0.025;
const POST_GAP = 0.02;
/** Post section, metres, and its centre's depth behind the board, the board's face at 0. */
const POST_SIZE = 0.1;
const POST_Z = -(BOARD_STANDOFF + BACKING_DEPTH + POST_GAP + POST_SIZE / 2);
/** Posts' x either side of the board's centre, metres. */
const POST_X = BOARD_W * 0.38;
/** Past the pad's outer edge, metres: on the sand between the pad and the building. */
const OUT_M = 1.0;
/** Along the pad from its start, metres. */
const ALONG_M = 4;
/** Road searched either way for a neighbour, metres. */
const NEIGHBOUR_REACH_M = 60_000;

function kmText(metres: number): string {
  return `${(metres / 1000).toFixed(1)} km`;
}

/** The nearest stop with a lay-by behind (`dir` −1) or ahead (+1) of `l`, or null. */
function neighbour(seed: number, l: Layby, dir: 1 | -1): Layby | null {
  const from = dir > 0 ? l.s + 1 : Math.max(0, l.s - NEIGHBOUR_REACH_M);
  const to = dir > 0 ? l.s + NEIGHBOUR_REACH_M : l.s - 1;
  let best: Layby | null = null;
  for (const other of laybysBetween(seed, from, to)) {
    if (dir > 0 ? other.s <= l.s : other.s >= l.s) continue;
    if (best === null || Math.abs(other.s - l.s) < Math.abs(best.s - l.s)) best = other;
  }
  return best;
}

/**
 * The board's three lines: the stop, then the two directions as the driver reads them.
 * Behind the first stop the road's start, as `RING_GLYPH` and its distance.
 */
export function signpostLines(seed: number, l: Layby): [string, string, string] {
  const back = neighbour(seed, l, -1);
  const ahead = neighbour(seed, l, 1);
  const backText = back ? `${placeNameAt(seed, back.s)} · ${kmText(l.s - back.s)}` : `${RING_GLYPH} ${kmText(l.s)}`;
  const aheadText = ahead ? `${placeNameAt(seed, ahead.s)} · ${kmText(ahead.s - l.s)}` : 'End of the road';
  // Left of travel: ahead is on the driver's right as he faces the board.
  const [left, right] = l.side > 0 ? [backText, aheadText] : [aheadText, backText];
  return [placeNameAt(seed, l.s).toUpperCase(), `← ${left}`, `${right} →`];
}

export class SignpostProvider implements ChunkProvider {
  readonly id = 'signposts';

  build(ctx: ChunkContext): ChunkContent | null {
    // A lay-by belongs to the chunk its stop's arclength falls in, so it is built once.
    const laybys = laybysBetween(ctx.world.seed, ctx.sStart, ctx.sEnd).filter((l) => l.s >= ctx.sStart && l.s < ctx.sEnd);
    if (laybys.length === 0) return null;
    const group = new THREE.Group();
    group.name = 'signposts';
    const bodies: RAPIER.RigidBody[] = [];
    const colliders: RAPIER.Collider[] = [];
    const materials: THREE.MeshStandardMaterial[] = [];
    const point = { x: 0, y: 0, z: 0 };

    for (const l of laybys) {
      const s = l.sPadStart + ALONG_M;
      const lateral = l.side * (l.padOuter + OUT_M);
      ctx.road.offsetPoint(s, lateral, point);
      const ground = ctx.terrain.heightAt(point.x, point.z, s);
      const heading = ctx.road.sampleAt(s).heading;
      // Local +Z towards the road: the board's face.
      const toRoadX = -l.side * Math.cos(heading);
      const toRoadZ = l.side * Math.sin(heading);
      const yaw = Math.atan2(toRoadX, toRoadZ);

      const root = new THREE.Group();
      root.position.set(point.x - ctx.originX, ground, point.z - ctx.originZ);
      root.rotation.y = yaw;
      const postH = BOARD_Y + BOARD_H / 2;
      for (const x of [-POST_X, POST_X]) {
        box(root, [POST_SIZE, postH + 0.3, POST_SIZE], [x, (postH - 0.3) / 2, POST_Z], C.darkMetal);
      }
      const desert = desertAt(l.s);
      box(
        root,
        [BOARD_W + BACKING_RIM * 2, BOARD_H + BACKING_RIM * 2, BACKING_DEPTH],
        [0, BOARD_Y, -BOARD_STANDOFF - BACKING_DEPTH / 2],
        plateStyle(desert).frameHex,
      );
      const material = paintPlate(desert, signpostLines(ctx.world.seed, l));
      materials.push(material);
      const board = new THREE.Mesh(SIGN_PLANE, material);
      board.scale.set(BOARD_W, BOARD_H, 1);
      board.position.set(0, BOARD_Y, 0);
      root.add(board);
      group.add(root);

      if (ctx.hasPhysics) {
        const cos = Math.cos(yaw);
        const sin = Math.sin(yaw);
        for (const x of [-POST_X, POST_X]) {
          // The post's local offset, turned into the world by the board's yaw.
          addStatic(
            ctx,
            bodies,
            colliders,
            point.x + x * cos + POST_Z * sin,
            ground + postH / 2,
            point.z - x * sin + POST_Z * cos,
            RAPIER.ColliderDesc.cuboid(POST_SIZE / 2, postH / 2, POST_SIZE / 2),
            SurfaceType.Concrete,
          );
        }
      }
    }
    freezeStaticSubtree(group);
    return {
      group,
      bodies,
      colliders,
      dispose: () => {
        for (const material of materials) {
          material.map?.dispose();
          material.dispose();
        }
      },
    };
  }
}
