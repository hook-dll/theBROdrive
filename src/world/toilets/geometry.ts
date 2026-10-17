/**
 * The one low-poly Japanese toilet cabin every variant is drawn from, and the plan its
 * fixtures are laid out on.
 *
 * A cabin is a plinth, four walls with a door in the front (-Z) and a high window in
 * the back, a tiled floor, a ceiling under one of three roofs, and the fixtures that
 * never move: the pan, the cistern, the sink, the mirror's frame and glass, the flush
 * plate, the valve's pipe and the lamp's base. Everything that moves or changes with
 * progress (door, lid, flush button, valve wheel, plunger, dirt, lamp glow, face, live
 * mirror) is the rig's (rig.ts), laid out on the same `ToiletLayout` and added over the
 * merged shell.
 *
 * The shell is built from the POI kit's boxes, so it shares its materials and merges
 * like every kit variant (world/poi-variants.ts `mergePoiStatics`). The corners are
 * closed: the front and back walls run the full width and the side walls fit between
 * them, so nothing overlaps and no corner is open. Ceiling and roof are `poiRoof`, so
 * the gallery's roof toggle opens the interior.
 */

import * as THREE from 'three';
import {
  box,
  cylinder,
  gableGeometry,
  geometryCache,
  markDoorObstacle,
  material,
  registerDoorClearance,
  trimOpening,
  wallWithOpenings,
  type Opening,
  type V3,
} from '../poi/kit';
import type { ToiletShellSpec, ToiletVariant } from './types';

/** Plinth under the cabin, metres; it reaches `PLINTH_MARGIN` past the walls. */
export const PLINTH = 0.15;
const PLINTH_MARGIN = 0.2;
export const WALL = 0.14;
const TILE = 0.02;
const CEILING = 0.08;
const DOOR_WIDTH = 1.0;
export const DOOR_HEIGHT = 2.05;
/** The kit trims every opening with bars this wide inside the opening (kit.ts `trimOpening`). */
const TRIM_BAR = 0.09;
const BATTEN_DEPTH = 0.035;
const BATTEN_STEP = 0.16;
const GABLE_PITCH = 0.55;
const ROOF_SLAB = 0.12;
const PRIVACY_WALL_HEIGHT = 2.1;
const PRIVACY_WALL_THICKNESS = 0.16;
/** The privacy wall's centre, in front of the front wall's outer face. */
const PRIVACY_WALL_OFFSET = 1.45;
const FENCE_OFFSET = 0.9;
const MIN_PLAN = 2.2;
const MIN_HEIGHT = 2.4;

/** Where everything stands in a cabin, in the variant root's frame (ground at Y = 0). */
export interface ToiletLayout {
  readonly width: number;
  readonly depth: number;
  /** Top of the floor tiles. */
  readonly floorY: number;
  /** Underside of the ceiling. */
  readonly ceilingY: number;
  /** Interior wall faces. */
  readonly inner: { readonly minX: number; readonly maxX: number; readonly minZ: number; readonly maxZ: number };
  /** Outermost front surface the face can sit on (the wall, or its battens). */
  readonly frontSkinZ: number;
  readonly door: {
    /** Hinge line, at the opening's left jamb and the front wall's centre plane. */
    readonly hingeX: number;
    readonly hingeZ: number;
    /** Leaf size inside the trim. */
    readonly width: number;
    readonly height: number;
    readonly bottomY: number;
  };
  readonly bowl: { readonly x: number; readonly z: number; readonly rimY: number; readonly frontZ: number };
  readonly sink: { readonly x: number; readonly z: number; readonly topY: number };
  /** The static glass's front plane, and the live face's half size on it. */
  readonly mirror: { readonly x: number; readonly y: number; readonly glassZ: number; readonly half: readonly [number, number] };
  readonly valve: V3;
  readonly flush: V3;
  readonly plunger: { readonly stowed: V3; readonly inUse: V3 };
  readonly lamp: V3;
  readonly face: V3;
}

export function toiletLayout(variant: ToiletVariant): ToiletLayout {
  const { width: w, depth: d, height: h } = variant.shell;
  if (w < MIN_PLAN || d < MIN_PLAN || h < MIN_HEIGHT) {
    throw new Error(`${variant.id}: a toilet cabin needs at least ${MIN_PLAN} x ${MIN_PLAN} x ${MIN_HEIGHT} m`);
  }
  const floorY = PLINTH + TILE;
  const inner = { minX: -w / 2 + WALL, maxX: w / 2 - WALL, minZ: -d / 2 + WALL, maxZ: d / 2 - WALL };
  const doorStart = inner.minX + 0.12;
  const doorEnd = doorStart + DOOR_WIDTH;
  const battens = variant.shell.dressing.includes('battens');
  const frontSkinZ = -d / 2 - (battens ? BATTEN_DEPTH : 0);

  const bowlX = inner.maxX - 0.45;
  const bowlZ = inner.maxZ - 0.36;
  const squat = variant.bowl === 'squat';
  const rimY = squat ? floorY + 0.06 : floorY + 0.44;
  // The squat pan and its hood reach further forward than a bowl's rim.
  const bowlFrontZ = squat ? bowlZ - 0.42 : bowlZ - 0.21;
  const sinkX = inner.minX + 0.38;

  return {
    width: w,
    depth: d,
    floorY,
    ceilingY: PLINTH + h - CEILING,
    inner,
    frontSkinZ,
    door: {
      hingeX: doorStart + TRIM_BAR + 0.005,
      hingeZ: -d / 2 + WALL / 2,
      width: DOOR_WIDTH - 2 * TRIM_BAR - 0.01,
      // From a centimetre over the tiles to a centimetre under the top trim bar.
      height: DOOR_HEIGHT - TILE - TRIM_BAR - 0.02,
      bottomY: floorY + 0.01,
    },
    bowl: { x: bowlX, z: bowlZ, rimY, frontZ: bowlFrontZ },
    sink: { x: sinkX, z: inner.maxZ - 0.18, topY: floorY + 0.84 },
    mirror: { x: sinkX, y: floorY + 1.45, glassZ: inner.maxZ - 0.04, half: [0.18, 0.25] },
    valve: [bowlX - 0.26, floorY + 0.3, inner.maxZ - 0.08],
    flush: [inner.maxX - 0.02, floorY + 0.9, bowlZ - 0.45],
    plunger: {
      // A centimetre up: leaning into the corner tips the cup's rim towards the floor.
      stowed: [inner.maxX - 0.12, floorY + 0.01, inner.minZ + 0.14],
      inUse: [bowlX, squat ? floorY + 0.02 : floorY + 0.3, bowlZ - 0.04],
    },
    lamp: [0, PLINTH + h - CEILING - 0.05, 0],
    face: [(doorEnd + w / 2) / 2, PLINTH + 1.85, frontSkinZ],
  };
}

/**
 * The authored `[x, z]` extent: symmetric about the origin, as placement reads it, and
 * covering the roof's overhang, the plinth and any dressing in front of the door.
 */
export function toiletFootprint(shell: ToiletShellSpec): readonly [number, number] {
  let halfX = shell.width / 2 + Math.max(shell.overhang, PLINTH_MARGIN);
  let halfZ = shell.depth / 2 + Math.max(shell.overhang, PLINTH_MARGIN);
  // A gable slab's upper edge reaches past its eave by its thickness's run.
  if (shell.roof === 'gable') halfX = Math.max(halfX, shell.width / 2 + shell.overhang + ROOF_SLAB * Math.sin(GABLE_PITCH));
  if (shell.dressing.includes('privacy-walls')) {
    halfZ = Math.max(halfZ, shell.depth / 2 + PRIVACY_WALL_OFFSET + PRIVACY_WALL_THICKNESS / 2);
  }
  // The pickets' front faces; the rails sit behind them.
  if (shell.dressing.includes('house')) halfZ = Math.max(halfZ, shell.depth / 2 + FENCE_OFFSET + 0.015);
  // Rounded up to the centimetre, so the authored figure never undercuts the measured one.
  return [Math.ceil(200 * halfX - 1e-6) / 100, Math.ceil(200 * halfZ - 1e-6) / 100];
}

/** Builds a variant's static shell into `root` (a `PoiVariantDefinition.build`). */
export function buildToiletShell(root: THREE.Group, variant: ToiletVariant): void {
  const { shell } = variant;
  const { width: w, depth: d, height: h, palette } = shell;
  const layout = toiletLayout(variant);
  const pattern = shell.wallPattern;
  const doorStart = layout.inner.minX + 0.12;
  const doorEnd = doorStart + DOOR_WIDTH;
  // The doorway starts on the floor tiles: a sill of wall stands under it, level with them,
  // so the jambs stand on the tiles instead of sharing their underside.
  const door: Opening = [doorStart, doorEnd, TILE, DOOR_HEIGHT];
  const backWindow: Opening = [-0.35, 0.35, h - 0.6, h - 0.25];
  const house = shell.dressing.includes('house');
  const sideWindows: Opening[] = house ? [[-0.35, 0.35, 1.15, 1.75]] : [];

  box(root, [w + 2 * PLINTH_MARGIN, PLINTH, d + 2 * PLINTH_MARGIN], [0, PLINTH / 2, 0], palette.plinth, [0, 0, 0], false, 'blocks');

  // Everything from the plinth up is built on its top, so the kit's walls start at 0.
  const body = new THREE.Group();
  body.position.y = PLINTH;
  root.add(body);
  box(body, [w - 2 * WALL, TILE, d - 2 * WALL], [0, TILE / 2, 0], palette.floor, [0, 0, 0], false, 'tiles');
  wallWithOpenings(body, 'x', -d / 2 + WALL / 2, w, h, [door], palette.walls[0], WALL, pattern);
  wallWithOpenings(body, 'x', d / 2 - WALL / 2, w, h, [backWindow], palette.walls[1], WALL, pattern);
  wallWithOpenings(body, 'z', -w / 2 + WALL / 2, d - 2 * WALL, h, sideWindows, palette.walls[2], WALL, pattern);
  wallWithOpenings(body, 'z', w / 2 - WALL / 2, d - 2 * WALL, h, sideWindows, palette.walls[3], WALL, pattern);
  trimOpening(body, 'x', -d / 2 + WALL / 2, door, palette.trim);
  windowIn(body, 'x', d / 2 - WALL / 2, backWindow, palette.trim);
  for (const opening of sideWindows) {
    windowIn(body, 'z', -w / 2 + WALL / 2, opening, palette.trim);
    windowIn(body, 'z', w / 2 - WALL / 2, opening, palette.trim);
  }
  registerDoorClearance(
    root,
    new THREE.Box3(new THREE.Vector3(doorStart, PLINTH + 0.08, -d / 2 - 0.3), new THREE.Vector3(doorEnd, PLINTH + DOOR_HEIGHT, -d / 2 + 1.05)),
    'toilet door',
  );

  if (shell.dressing.includes('battens')) {
    const skipFront: [number, number][] = [[doorStart - 0.1, doorEnd + 0.1]];
    const skipBack: [number, number][] = [[backWindow[0] - 0.1, backWindow[1] + 0.1]];
    const skipSide = sideWindows.map((o): [number, number] => [o[0] - 0.1, o[1] + 0.1]);
    battens(body, 'x', -d / 2 - BATTEN_DEPTH / 2, w, h, skipFront, palette.accent);
    battens(body, 'x', d / 2 + BATTEN_DEPTH / 2, w, h, skipBack, palette.accent);
    battens(body, 'z', -w / 2 - BATTEN_DEPTH / 2, d, h, skipSide, palette.accent);
    battens(body, 'z', w / 2 + BATTEN_DEPTH / 2, d, h, skipSide, palette.accent);
  }

  // The ceiling sits inside the walls' top, so the roof rests on walls and ceiling alike.
  box(body, [w - 2 * WALL, CEILING, d - 2 * WALL], [0, h - CEILING / 2, 0], 0xe6e2d8, [0, 0, 0], true);
  roof(root, variant, PLINTH + h);

  interior(root, variant, layout);

  if (shell.dressing.includes('privacy-walls')) {
    // An L of two walls: one across the approach from the plinth's left edge, one back
    // along that edge towards the cabin, open to the right.
    const left = -w / 2 - PLINTH_MARGIN;
    const right = (doorStart + doorEnd) / 2 + 0.9;
    const z = -d / 2 - PRIVACY_WALL_OFFSET;
    const t = PRIVACY_WALL_THICKNESS;
    const across = box(root, [right - left, PRIVACY_WALL_HEIGHT, t], [(left + right) / 2, PRIVACY_WALL_HEIGHT / 2, z], palette.accent, [0, 0, 0], false, 'boards');
    const sideLength = PRIVACY_WALL_OFFSET - t / 2 - 0.35;
    const side = box(
      root,
      [t, PRIVACY_WALL_HEIGHT, sideLength],
      [left + t / 2, PRIVACY_WALL_HEIGHT / 2, z + t / 2 + sideLength / 2],
      palette.accent,
      [0, 0, 0],
      false,
      'boards',
    );
    markDoorObstacle(across, 'privacy wall');
    markDoorObstacle(side, 'privacy wall');
  }
  if (house) {
    const z = -d / 2 - FENCE_OFFSET;
    fence(root, -w / 2 - PLINTH_MARGIN, doorStart - 0.35, z, palette.accent);
    fence(root, doorEnd + 0.35, w / 2 + PLINTH_MARGIN, z, palette.accent);
  }
}

/** A trimmed window with a frosted pane filling what the trim leaves of the opening. */
function windowIn(parent: THREE.Object3D, axis: 'x' | 'z', fixed: number, opening: Opening, trim: number): void {
  trimOpening(parent, axis, fixed, opening, trim);
  const [start, end, bottom, top] = opening;
  const along = end - start - 2 * TRIM_BAR;
  const tall = top - bottom - 2 * TRIM_BAR;
  const centre = (start + end) / 2;
  const y = (bottom + top) / 2;
  if (axis === 'x') box(parent, [along, tall, 0.02], [centre, y, fixed], 0xcfdcda);
  else box(parent, [0.02, tall, along], [fixed, y, centre], 0xcfdcda);
}

/** Vertical battens over one outer wall face, clear of its openings and its corners. */
function battens(parent: THREE.Object3D, axis: 'x' | 'z', fixed: number, length: number, height: number, skip: readonly (readonly [number, number])[], color: number): void {
  for (let u = -length / 2 + 0.06; u <= length / 2 - 0.06 + 1e-6; u += BATTEN_STEP) {
    if (skip.some(([a, b]) => u > a && u < b)) continue;
    if (axis === 'x') box(parent, [0.05, height, BATTEN_DEPTH], [u, height / 2, fixed], color);
    else box(parent, [BATTEN_DEPTH, height, 0.05], [fixed, height / 2, u], color);
  }
}

/** A low picket fence along X: pickets in front, two rails touching their backs. */
function fence(parent: THREE.Object3D, from: number, to: number, z: number, color: number): void {
  if (to - from < 0.3) return;
  for (let x = from + 0.04; x <= to - 0.04 + 1e-6; x += 0.14) box(parent, [0.06, 0.8, 0.03], [x, 0.4, z], color);
  for (const y of [0.25, 0.6]) box(parent, [to - from, 0.06, 0.03], [(from + to) / 2, y, z + 0.03], color);
}

/** A four-sided frustum with flat facets, its corners on the axes' diagonals: unit base. */
function pyramidGeometry(topShare: number): THREE.BufferGeometry {
  const key = `toilet-pyramid:${topShare}`;
  let geometry = geometryCache.get(key);
  if (!geometry) {
    const radius = Math.SQRT1_2;
    geometry = new THREE.CylinderGeometry(radius * topShare, radius, 1, 4, 1, false, Math.PI / 4).toNonIndexed();
    geometry.computeVertexNormals();
    geometryCache.set(key, geometry);
  }
  return geometry;
}

function roof(root: THREE.Group, variant: ToiletVariant, y: number): void {
  const { width: w, depth: d, overhang: o, palette, roof: kind } = variant.shell;
  if (kind === 'flat') {
    box(root, [w + 2 * o, 0.16, d + 2 * o], [0, y + 0.08, 0], palette.roof, [0, 0, 0], true);
    return;
  }
  if (kind === 'pyramid') {
    box(root, [w + 2 * o, 0.1, d + 2 * o], [0, y + 0.05, 0], palette.roof, [0, 0, 0], true);
    const rise = 0.5 * (Math.min(w, d) / 2 + o);
    const frustum = new THREE.Mesh(pyramidGeometry(0.1), material(palette.roof));
    frustum.scale.set(w + 2 * o, rise, d + 2 * o);
    frustum.position.set(0, y + 0.1 + rise / 2, 0);
    frustum.castShadow = true;
    frustum.receiveShadow = true;
    frustum.userData.poiRoof = true;
    root.add(frustum);
    cylinder(root, 0.05, 0.05, 0.35, 6, [0, y + 0.1 + rise + 0.175, 0], palette.accent).userData.poiRoof = true;
    return;
  }
  // Gable, ridge along Z: two slabs whose undersides run along the gable ends' tops.
  const slope = Math.tan(GABLE_PITCH);
  const rise = (w / 2) * slope;
  const run = w / 2 + o;
  const length = run / Math.cos(GABLE_PITCH);
  const midX = run / 2;
  const midY = y + rise - midX * slope;
  const nx = Math.sin(GABLE_PITCH) * (ROOF_SLAB / 2);
  const ny = Math.cos(GABLE_PITCH) * (ROOF_SLAB / 2);
  box(root, [length, ROOF_SLAB, d + 2 * o], [midX + nx, midY + ny, 0], palette.roof, [0, 0, -GABLE_PITCH], true);
  box(root, [length, ROOF_SLAB, d + 2 * o], [-midX - nx, midY + ny, 0], palette.roof, [0, 0, GABLE_PITCH], true);
  for (const [z, color] of [[-d / 2 + WALL / 2, palette.walls[0]], [d / 2 - WALL / 2, palette.walls[1]]] as const) {
    const end = new THREE.Mesh(gableGeometry(w, rise, WALL), material(color));
    end.position.set(0, y, z);
    end.castShadow = true;
    end.receiveShadow = true;
    end.userData.poiRoof = true;
    root.add(end);
  }
  if (variant.shell.dressing.includes('house')) {
    const x = 0.45;
    const surface = y + rise - x * slope + ROOF_SLAB / Math.cos(GABLE_PITCH);
    for (const z of [-d / 4, 0, d / 4]) {
      box(root, [0.24, 0.7, 0.24], [x, surface + 0.35 - 0.12, z], palette.accent, [0, 0, 0], true);
    }
  }
}

/** The fixtures that never move. */
function interior(root: THREE.Group, variant: ToiletVariant, layout: ToiletLayout): void {
  const { floorY, bowl, sink, mirror, inner } = layout;
  const white = 0xf2f0ea;
  const steel = 0x9aa0a2;
  if (variant.bowl === 'washlet') {
    cylinder(root, 0.16, 0.19, 0.38, 10, [bowl.x, floorY + 0.19, bowl.z], white);
    cylinder(root, 0.21, 0.19, 0.06, 12, [bowl.x, bowl.rimY - 0.03, bowl.z], white);
    cylinder(root, 0.15, 0.15, 0.012, 12, [bowl.x, bowl.rimY, bowl.z], 0x6f8c96);
    // The washlet's control arm.
    box(root, [0.07, 0.07, 0.24], [bowl.x + 0.24, bowl.rimY - 0.02, bowl.z + 0.02], 0xdedbd2);
  } else {
    box(root, [0.4, 0.06, 0.62], [bowl.x, floorY + 0.03, bowl.z - 0.1], white);
    box(root, [0.2, 0.012, 0.3], [bowl.x, floorY + 0.06, bowl.z - 0.06], 0x6f8c96);
    box(root, [0.34, 0.12, 0.08], [bowl.x, floorY + 0.12, bowl.z - 0.38], white);
  }
  // The cistern against the back wall, and the supply pipe its valve sits on.
  box(root, [0.42, 0.36, 0.16], [bowl.x, floorY + 0.75, inner.maxZ - 0.08], white);
  const [valveX, , valveZ] = layout.valve;
  cylinder(root, 0.018, 0.018, 0.57, 6, [valveX, floorY + 0.285, valveZ + 0.05], steel);
  // The flush plate on the right wall; its button is the rig's.
  box(root, [0.02, 0.18, 0.14], [inner.maxX - 0.01, layout.flush[1], layout.flush[2]], 0xdedbd2);

  box(root, [0.12, 0.7, 0.12], [sink.x, floorY + 0.35, sink.z - 0.02], white);
  box(root, [0.48, 0.14, 0.36], [sink.x, floorY + 0.77, sink.z], white);
  box(root, [0.36, 0.01, 0.24], [sink.x, sink.topY, sink.z - 0.02], 0x6f8c96);
  cylinder(root, 0.015, 0.015, 0.14, 6, [sink.x, sink.topY + 0.07, inner.maxZ - 0.04], steel);

  // Frame, then the static glass the live face lies over (mirror.ts).
  box(root, [0.44, 0.58, 0.03], [mirror.x, mirror.y, inner.maxZ - 0.015], 0x3a3a3c);
  box(root, [0.38, 0.52, 0.01], [mirror.x, mirror.y, mirror.glassZ + 0.005], 0x8fa3aa);

  // The lamp's base on the ceiling; the glowing diffuser below it is the rig's.
  cylinder(root, 0.12, 0.12, 0.025, 10, [layout.lamp[0], layout.ceilingY - 0.0125, layout.lamp[2]], steel);
}
