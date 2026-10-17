/**
 * The low-poly service cabin every Japanese toilet is built around, and the plan its
 * fixtures are laid out on.
 *
 * A cabin is a plinth, four walls with a door in the front (-Z) and a high window in
 * the back, a tiled floor, a ceiling under its roof, and the fixtures that never move:
 * the pan, the cistern, the sink, the mirror's frame and glass, the flush plate, the
 * valve's pipe and the lamp's base. A drum (`ToiletShellSpec.drum`) wraps its side and
 * back walls into a round booth with a flat door front. Everything that moves or changes
 * with progress (door, lid, flush button, valve wheel, plunger, dirt, lamp glow, face,
 * live mirror) is the rig's (rig.ts), laid out on the same `ToiletLayout` and added over
 * the merged shell. Whatever stands around the cabin is its family's (families.ts); a
 * row's rooms share the cabin's plinth and roof.
 *
 * The shell is built from the POI kit's boxes and the parts in parts.ts, so it shares
 * their materials and merges like every kit variant (world/poi-variants.ts
 * `mergePoiStatics`). The corners are closed: the front and back walls run the full
 * width and the side walls fit between them, so nothing overlaps and no corner is open.
 * Ceiling and roof are `poiRoof`, so the gallery's roof toggle opens the interior.
 */

import * as THREE from 'three';
import {
  box,
  cylinder,
  markDoorObstacle,
  material,
  registerDoorClearance,
  trimOpening,
  wallWithOpenings,
  type Opening,
  type V3,
} from '../poi/kit';
import { buildFamily, cabinOutline, familyReach } from './families';
import {
  drumWrapGeometry,
  LOUVRE_REACH,
  louvres,
  minDrumRadius,
  PLINTH,
  PLINTH_MARGIN,
  Reach,
  roofHalf,
  roofLook,
  roofOver,
  ROUND_SIDES,
  WALL,
} from './parts';
import type { ToiletShellSpec, ToiletVariant } from './types';

const TILE = 0.02;
const CEILING = 0.08;
const DOOR_WIDTH = 1.0;
const DOOR_HEIGHT = 2.05;
/** The kit trims every opening with bars this wide inside the opening (kit.ts `trimOpening`). */
const TRIM_BAR = 0.09;
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
  /** Outermost front surface the face can sit on (the wall, or its louvres). */
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
  const { width: w, depth: d, height: h, drum } = variant.shell;
  if (w < MIN_PLAN || d < MIN_PLAN || h < MIN_HEIGHT) {
    throw new Error(`${variant.id}: a toilet cabin needs at least ${MIN_PLAN} x ${MIN_PLAN} x ${MIN_HEIGHT} m`);
  }
  if (drum !== undefined && drum < minDrumRadius(w, d)) {
    throw new Error(`${variant.id}: a drum round a ${w} x ${d} m cabin needs a radius of at least ${minDrumRadius(w, d).toFixed(2)} m`);
  }
  const floorY = PLINTH + TILE;
  const inner = { minX: -w / 2 + WALL, maxX: w / 2 - WALL, minZ: -d / 2 + WALL, maxZ: d / 2 - WALL };
  const doorStart = inner.minX + 0.12;
  const doorEnd = doorStart + DOOR_WIDTH;
  const frontSkinZ = -d / 2 - (variant.shell.dressing.includes('louvres') ? LOUVRE_REACH : 0);

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
 * covering the plinth, the roof's overhang, any dressing and the whole family.
 */
export function toiletFootprint(shell: ToiletShellSpec): readonly [number, number] {
  const { width: w, depth: d } = shell;
  const reach = new Reach();
  const outline = cabinOutline(shell);
  const [roofX, roofZ] = roofHalf(shell.roof, outline, shell.overhang);
  if (outline.kind === 'circle') reach.circle(outline.x, outline.z, Math.max(outline.radius + PLINTH_MARGIN, roofX));
  else reach.rect(outline.x, outline.z, Math.max(outline.width / 2 + PLINTH_MARGIN, roofX), Math.max(outline.depth / 2 + PLINTH_MARGIN, roofZ));
  if (shell.dressing.includes('louvres')) reach.rect(0, 0, w / 2 + LOUVRE_REACH, d / 2 + LOUVRE_REACH);
  if (shell.dressing.includes('privacy-walls')) reach.point(0, d / 2 + PRIVACY_WALL_OFFSET + PRIVACY_WALL_THICKNESS / 2);
  // The pickets' front faces; the rails sit behind them.
  if (shell.dressing.includes('house')) reach.point(0, d / 2 + FENCE_OFFSET + 0.015);
  familyReach(shell, reach);
  return reach.footprint();
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

  const outline = cabinOutline(shell);
  if (outline.kind === 'circle') {
    const radius = outline.radius + PLINTH_MARGIN;
    cylinder(root, radius, radius, PLINTH, ROUND_SIDES, [outline.x, PLINTH / 2, outline.z], palette.plinth);
  } else {
    const size = [outline.width + 2 * PLINTH_MARGIN, PLINTH, outline.depth + 2 * PLINTH_MARGIN] as const;
    box(root, size, [outline.x, PLINTH / 2, outline.z], palette.plinth, [0, 0, 0], false, 'blocks');
  }

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
  if (shell.drum !== undefined) {
    const wrap = new THREE.Mesh(drumWrapGeometry(w, d, h, shell.drum), material(palette.walls[1]));
    wrap.castShadow = true;
    wrap.receiveShadow = true;
    body.add(wrap);
  }
  registerDoorClearance(
    root,
    new THREE.Box3(new THREE.Vector3(doorStart, PLINTH + 0.08, -d / 2 - 0.3), new THREE.Vector3(doorEnd, PLINTH + DOOR_HEIGHT, -d / 2 + 1.05)),
    'toilet door',
  );

  if (shell.dressing.includes('louvres')) {
    const skipFront: [number, number][] = [[doorStart - 0.1, doorEnd + 0.1]];
    const skipBack: [number, number][] = [[backWindow[0] - 0.1, backWindow[1] + 0.1]];
    const skipSide = sideWindows.map((o): [number, number] => [o[0] - 0.1, o[1] + 0.1]);
    louvres(body, 'x', -d / 2, -1, w, 0, h, skipFront, palette.accent, 0);
    louvres(body, 'x', d / 2, 1, w, 0, h, skipBack, palette.accent, 1);
    louvres(body, 'z', -w / 2, -1, d, 0, h, skipSide, palette.accent, 2);
    louvres(body, 'z', w / 2, 1, d, 0, h, skipSide, palette.accent, 3);
  }

  // The ceiling sits inside the walls' top, so the roof rests on walls and ceiling alike.
  box(body, [w - 2 * WALL, CEILING, d - 2 * WALL], [0, h - CEILING / 2, 0], 0xe6e2d8, [0, 0, 0], true);
  // A floating roof over a drum stands on the wrap: at the back and either side.
  const posts =
    outline.kind === 'circle'
      ? ([
          [0, (d / 2 + outline.z + outline.radius) / 2],
          [(w / 2 + outline.radius) / 2, outline.z],
          [-(w / 2 + outline.radius) / 2, outline.z],
        ] as const)
      : [];
  roofOver(root, shell.roof, outline, PLINTH + h, shell.overhang, roofLook(palette, [palette.walls[0], palette.walls[1]], house), posts);

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
  buildFamily(root, variant);
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

/** A low picket fence along X: pickets in front, two rails touching their backs. */
function fence(parent: THREE.Object3D, from: number, to: number, z: number, color: number): void {
  if (to - from < 0.3) return;
  for (let x = from + 0.04; x <= to - 0.04 + 1e-6; x += 0.14) box(parent, [0.06, 0.8, 0.03], [x, 0.4, z], color);
  for (const y of [0.25, 0.6]) box(parent, [to - from, 0.06, 0.03], [(from + to) / 2, y, z + 0.03], color);
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
