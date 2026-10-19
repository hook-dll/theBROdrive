import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { SurfaceType } from '../core/surfaces';
import { freezeStaticSubtree, type ChunkContent, type ChunkContext, type ChunkProvider } from './chunks';
import { laybysBetween, type Layby } from './layby';
import { paintSign, SIGN_PLANE } from './market';
import { placeNameAt } from './placenames';
import { box, C } from './poi/kit';
import { addStatic } from './props/scatter';

/**
 * SIGNPOSTS: every lay-by's board, naming the stop and the stops either way.
 *
 * A painted board on two posts at the pad's far edge, facing the road. The headline is
 * the stop's own name (world/placenames.ts); below it the neighbouring stops with a
 * lay-by, behind and ahead, each with its arrow and its road distance. The arrows are
 * as a driver sees them from the road looking at the board: on a stop LEFT of travel
 * the road ahead runs off to his right, on one RIGHT of travel to his left. The first
 * stop's «behind» is home, where the road begins.
 *
 * The board's text is the stop's alone, so its material is painted per board
 * (`paintSign`) and disposed with the chunk; its program is the market sign's, which
 * `marketProgramAnchor` links at boot, and the posts are kit boxes. Colliders on the
 * posts only, in the physics band.
 */

/** Board above the pad, metres: width, height, and its centre's height. */
const BOARD_W = 2.6;
const BOARD_H = 1.3;
const BOARD_Y = 2.05;
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

/** The board's three lines: the stop, then the two directions as the driver reads them. */
export function signpostLines(seed: number, l: Layby): [string, string, string] {
  const back = neighbour(seed, l, -1);
  const ahead = neighbour(seed, l, 1);
  const backText = back ? `${placeNameAt(seed, back.s)} · ${kmText(l.s - back.s)}` : `Home · ${kmText(l.s)}`;
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
      for (const x of [-BOARD_W * 0.38, BOARD_W * 0.38]) {
        box(root, [0.1, postH + 0.3, 0.1], [x, (postH - 0.3) / 2, -0.06], C.darkMetal);
      }
      box(root, [BOARD_W + 0.1, BOARD_H + 0.1, 0.04], [0, BOARD_Y, -0.03], C.white);
      const material = paintSign(signpostLines(ctx.world.seed, l), '#1f5b3a', '#f2ecd8', 1024, 512);
      materials.push(material);
      const board = new THREE.Mesh(SIGN_PLANE, material);
      board.scale.set(BOARD_W, BOARD_H, 1);
      board.position.set(0, BOARD_Y, 0);
      root.add(board);
      group.add(root);

      if (ctx.hasPhysics) {
        const cos = Math.cos(yaw);
        const sin = Math.sin(yaw);
        for (const x of [-BOARD_W * 0.38, BOARD_W * 0.38]) {
          // The post's local offset, turned into the world by the board's yaw.
          addStatic(
            ctx,
            bodies,
            colliders,
            point.x + x * cos - 0.06 * sin,
            ground + postH / 2,
            point.z - x * sin - 0.06 * cos,
            RAPIER.ColliderDesc.cuboid(0.05, postH / 2, 0.05),
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
