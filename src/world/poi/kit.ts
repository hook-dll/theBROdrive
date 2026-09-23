import * as THREE from 'three';
import { makeFlatMaterial } from '../../render/materials';

export type Opening = readonly [start: number, end: number, bottom: number, top: number];
type WallAxis = 'x' | 'z';
export type V3 = readonly [number, number, number];
type SurfacePattern = 'plaster' | 'brick' | 'blocks' | 'boards' | 'metal' | 'tiles';

const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
export const geometryCache = new Map<string, THREE.BufferGeometry>();
const surfaceTextures = new Map<SurfacePattern, THREE.DataTexture>();
const surfaceMaterials = new Map<string, THREE.MeshStandardMaterial>();
/**
 * A room light's intensity, in the same units as the street lamps' `LAMP_POINT`.
 *
 * Exported because the placement builds the marker this describes. It is the catalogue's
 * number either way: how brightly a room is lit is a decision about the building.
 *
 * It has to be those units because a room light is one now: it reaches the screen
 * through the shared `LightBudget` as a point source, exactly like a street lamp, rather
 * than as the spot light it used to be. Slightly under a street lamp's 90, because a room
 * is lit to be lived in and a road is lit to be driven.
 */
export const ROOM_LIGHT_INTENSITY = 55;
export const BULB_EMISSIVE_INTENSITY = 2.4;

/**
 * How much smaller the furniture is than it was drawn.
 *
 * One number for the whole catalogue, because "the furniture is too big" is one
 * judgement about all of it: a chair, a bed and a shop counter are the same mistake at
 * different scales, and tuning them separately would let them drift out of proportion
 * with each other. Applied INSIDE each helper as a group scale, so every part of a piece
 * — legs, backrest, the boxes stacked on a shelf — shrinks together and by the same
 * amount, and a piece that stands on another piece stays standing on it.
 *
 * Two things it must not do, and both are checked rather than assumed:
 *
 *  - it must not lift anything off the floor. Every helper builds upward from its group
 *    origin at y = 0, so scaling about that origin keeps the base on the ground.
 *  - it must not break the register off its counter. `cashRegister` is a separate helper
 *    from `counter` and stands on one, so both shrink by this factor and the gap between
 *    them scales with them rather than changing.
 */
export const FURNITURE_SCALE = 1 / 1.5;

/**
 * How much smaller the light switch is than it was drawn.
 *
 * Half, and the reason it is not simply the furniture factor is that a switch is not
 * furniture: it is a fitting whose size reads against the human hand, and a switchplate
 * shrunk to two thirds of a plausible size still reads as a switchplate while the old one
 * read as a box.
 */
const SWITCH_SCALE = 0.5;
/** Depth of the switchplate's housing, metres. The face the wall is measured from. */
const SWITCH_PLATE_DEPTH = 0.055;
/**
 * How far below its ceiling a room light hangs, metres.
 *
 * One number for the fixture, the bulb and the light source, because they are one fitting:
 * the light a room is lit by comes from where the visible fixture hangs. Anywhere else
 * would put the bulb the player sees and the light that lights the room in two places.
 */
const LIGHT_DROP_Y = -0.43;
/**
 * How far a room light reaches, metres.
 *
 * Read by nobody: `LightBudget` takes a source's intensity and position into its own fixed
 * slot and composes the reach from the slot, so this is the one number in the light path
 * that is deliberately unused. It is exported anyway rather than deleted, so that the
 * placement can build a light that would work on its own terms — a zero-range light is a
 * shape that reads as a mistake.
 */
export const ROOM_LIGHT_REACH = 14;

export const C = {
  plaster: 0xb99b72,
  plasterPale: 0xd0bb91,
  plasterBlue: 0x78909a,
  brick: 0x8c4f38,
  concrete: 0x77746b,
  concreteLight: 0xa29b89,
  timber: 0x6e482a,
  darkTimber: 0x38291d,
  rust: 0x8a452d,
  rustDark: 0x4d3025,
  metal: 0x777d7c,
  darkMetal: 0x292d2c,
  roof: 0x6f3d30,
  roofTin: 0x858b87,
  floor: 0x655744,
  fabric: 0x877253,
  fadedRed: 0x9b4938,
  fadedBlue: 0x4d6871,
  fadedGreen: 0x596b4b,
  ochre: 0xb3823e,
  sandDark: 0x8a704f,
  white: 0xc9c1ad,
} as const;

export function material(color: number, roughness = 0.88): THREE.MeshStandardMaterial {
  return makeFlatMaterial(color, roughness);
}

function surfaceMaterial(color: number, pattern: SurfacePattern): THREE.MeshStandardMaterial {
  const key = `${color}:${pattern}`;
  const cached = surfaceMaterials.get(key);
  if (cached) return cached;
  let texture = surfaceTextures.get(pattern);
  if (!texture) {
    const size = 16;
    const pixels = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const stagger = Math.floor(y / 4) % 2 === 0 ? 0 : 4;
        const noise = ((x * 17 + y * 31 + x * y * 3) % 23) - 11;
        let shade = 226 + noise;
        if (pattern === 'brick' && (y % 4 === 0 || (x + stagger) % 8 === 0)) shade = 132;
        if (pattern === 'blocks' && (y % 8 === 0 || (x + (y < 8 ? 0 : 4)) % 8 === 0)) shade = 150;
        if (pattern === 'boards' && x % 4 === 0) shade = 142;
        if (pattern === 'metal' && x % 5 === 0) shade = 158;
        if (pattern === 'tiles' && (y % 4 === 0 || (x + stagger) % 8 === 0)) shade = 164;
        const offset = (y * size + x) * 4;
        pixels[offset] = shade;
        pixels[offset + 1] = shade;
        pixels[offset + 2] = shade;
        pixels[offset + 3] = 255;
      }
    }
    texture = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(1, 1);
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.needsUpdate = true;
    surfaceTextures.set(pattern, texture);
  }
  const patterned = makeFlatMaterial(color, pattern === 'metal' ? 0.74 : 0.92).clone();
  patterned.map = texture;
  patterned.needsUpdate = true;
  surfaceMaterials.set(key, patterned);
  return patterned;
}

const PATTERN_PERIOD: Readonly<Record<SurfacePattern, number>> = {
  plaster: 2.4,
  brick: 0.9,
  blocks: 1.6,
  boards: 1.2,
  metal: 2.0,
  tiles: 1.2,
};

function patternedBoxGeometry(size: V3, pattern: SurfacePattern, origin: V3): THREE.BoxGeometry {
  const key = `pattern-box:${pattern}:${size.join(':')}:${origin.join(':')}`;
  const cached = geometryCache.get(key);
  if (cached instanceof THREE.BoxGeometry) return cached;
  const geometry = new THREE.BoxGeometry(size[0], size[1], size[2]);
  const positions = geometry.getAttribute('position');
  const normals = geometry.getAttribute('normal');
  const uvs = geometry.getAttribute('uv');
  const period = PATTERN_PERIOD[pattern];
  for (let vertex = 0; vertex < positions.count; vertex++) {
    const nx = Math.abs(normals.getX(vertex));
    const ny = Math.abs(normals.getY(vertex));
    const px = positions.getX(vertex) + origin[0];
    const py = positions.getY(vertex) + origin[1];
    const pz = positions.getZ(vertex) + origin[2];
    if (nx > 0.5) uvs.setXY(vertex, pz / period, py / period);
    else if (ny > 0.5) uvs.setXY(vertex, px / period, pz / period);
    else uvs.setXY(vertex, px / period, py / period);
  }
  uvs.needsUpdate = true;
  geometryCache.set(key, geometry);
  return geometry;
}

export function box(
  parent: THREE.Object3D,
  size: V3,
  position: V3,
  color: number,
  rotation: V3 = [0, 0, 0],
  roof = false,
  pattern?: SurfacePattern,
  patternOrigin: V3 = position,
): THREE.Mesh {
  const geometry = pattern ? patternedBoxGeometry(size, pattern, patternOrigin) : UNIT_BOX;
  const mesh = new THREE.Mesh(geometry, pattern ? surfaceMaterial(color, pattern) : material(color));
  if (!pattern) mesh.scale.set(size[0], size[1], size[2]);
  mesh.position.set(position[0], position[1], position[2]);
  mesh.rotation.set(rotation[0], rotation[1], rotation[2]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  if (roof) mesh.userData.poiRoof = true;
  parent.add(mesh);
  return mesh;
}

export function cylinder(
  parent: THREE.Object3D,
  radiusTop: number,
  radiusBottom: number,
  height: number,
  segments: number,
  position: V3,
  color: number,
  rotation: V3 = [0, 0, 0],
): THREE.Mesh {
  const key = `${radiusTop}:${radiusBottom}:${height}:${segments}`;
  let geometry = geometryCache.get(key);
  if (!geometry) {
    geometry = new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments);
    geometryCache.set(key, geometry);
  }
  const mesh = new THREE.Mesh(geometry, material(color));
  mesh.position.set(position[0], position[1], position[2]);
  mesh.rotation.set(rotation[0], rotation[1], rotation[2]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function wallWithOpenings(
  parent: THREE.Object3D,
  axis: WallAxis,
  fixed: number,
  length: number,
  height: number,
  openings: readonly Opening[],
  color: number,
  thickness = 0.18,
  pattern?: SurfacePattern,
): void {
  const horizontal = [-length / 2, length / 2];
  const vertical = [0, height];
  for (const opening of openings) {
    horizontal.push(opening[0], opening[1]);
    vertical.push(opening[2], opening[3]);
  }
  horizontal.sort((a, b) => a - b);
  vertical.sort((a, b) => a - b);
  const xs = horizontal.filter((value, index) => index === 0 || value - horizontal[index - 1] > 0.001);
  const ys = vertical.filter((value, index) => index === 0 || value - vertical[index - 1] > 0.001);

  for (let xi = 0; xi < xs.length - 1; xi++) {
    const a = xs[xi];
    const b = xs[xi + 1];
    if (b - a < 0.01) continue;
    for (let yi = 0; yi < ys.length - 1; yi++) {
      const bottom = ys[yi];
      const top = ys[yi + 1];
      if (top - bottom < 0.01) continue;
      const hx = (a + b) / 2;
      const hy = (bottom + top) / 2;
      if (openings.some((opening) => hx > opening[0] && hx < opening[1] && hy > opening[2] && hy < opening[3])) continue;
      const size: V3 = axis === 'x' ? [b - a, top - bottom, thickness] : [thickness, top - bottom, b - a];
      const position: V3 = axis === 'x' ? [hx, hy, fixed] : [fixed, hy, hx];
      box(parent, size, position, color, [0, 0, 0], false, pattern);
    }
  }
}

function trimOpening(
  parent: THREE.Object3D,
  axis: WallAxis,
  fixed: number,
  opening: Opening,
  color = C.darkTimber,
): void {
  const [start, end, bottom, top] = opening;
  const width = end - start;
  const height = top - bottom;
  const depth = 0.26;
  const bar = 0.09;
  // Every bar sits entirely INSIDE the opening's own void rather than straddling its
  // edge. A bar centred exactly on the edge put half its thickness into whatever wall
  // stood just outside that edge — fine when that wall is generous, but a sliver
  // between two close openings (a thin mullion pier, or a shallow band of wall right
  // under the eave) is easily thinner than half a bar. The two then occupy nearly the
  // same plane over a real shared area: a coplanar overlap the GPU cannot consistently
  // depth-sort, seen as flicker. Trim drawn only inward of the opening can never reach
  // a neighbouring wall it does not open into. The four bars still meet at the corners
  // exactly as before — jambs run the full opening height, so the top/bottom bars still
  // overlap them there, the ordinary 3-axis corner join, not a coplanar sliver.
  if (axis === 'x') {
    box(parent, [bar, height, depth], [start + bar / 2, bottom + height / 2, fixed], color);
    box(parent, [bar, height, depth], [end - bar / 2, bottom + height / 2, fixed], color);
    box(parent, [width, bar, depth], [(start + end) / 2, top - bar / 2, fixed], color);
    if (bottom > 0.05) box(parent, [width, bar, depth], [(start + end) / 2, bottom + bar / 2, fixed], color);
  } else {
    box(parent, [depth, height, bar], [fixed, bottom + height / 2, start + bar / 2], color);
    box(parent, [depth, height, bar], [fixed, bottom + height / 2, end - bar / 2], color);
    box(parent, [depth, bar, width], [fixed, top - bar / 2, (start + end) / 2], color);
    if (bottom > 0.05) box(parent, [depth, bar, width], [fixed, bottom + bar / 2, (start + end) / 2], color);
  }
}

interface ShellOptions {
  readonly width: number;
  readonly depth: number;
  readonly height: number;
  readonly wall: number;
  readonly roof: number;
  readonly front: readonly Opening[];
  readonly back?: readonly Opening[];
  readonly left?: readonly Opening[];
  readonly right?: readonly Opening[];
  readonly flatRoof?: boolean;
  readonly wallPattern?: SurfacePattern;
  readonly roofPattern?: SurfacePattern;
}

export interface ShellLayout {
  readonly width: number;
  readonly depth: number;
  readonly front: readonly Opening[];
  readonly back: readonly Opening[];
  readonly left: readonly Opening[];
  readonly right: readonly Opening[];
}

export function shellOpeningsBetween(shell: ShellLayout, minY: number, maxY: number): ShellLayout {
  const inStorey = (opening: Opening): boolean => opening[3] > minY && opening[2] < maxY;
  return {
    width: shell.width,
    depth: shell.depth,
    front: shell.front.filter(inStorey),
    back: shell.back.filter(inStorey),
    left: shell.left.filter(inStorey),
    right: shell.right.filter(inStorey),
  };
}

export interface DoorClearance {
  readonly box: THREE.Box3;
  readonly label: string;
}

export function registerDoorClearance(parent: THREE.Object3D, box: THREE.Box3, label: string): void {
  const clearances = (parent.userData.poiDoorClearances as DoorClearance[] | undefined) ?? [];
  clearances.push({ box, label });
  parent.userData.poiDoorClearances = clearances;
}

function registerWindowClearance(parent: THREE.Object3D, box: THREE.Box3, label: string): void {
  const clearances = (parent.userData.poiWindowClearances as DoorClearance[] | undefined) ?? [];
  clearances.push({ box, label });
  parent.userData.poiWindowClearances = clearances;
}

export function markDoorObstacle(object: THREE.Object3D, label: string): void {
  object.userData.poiDoorObstacle = label;
}

export function buildingShell(parent: THREE.Object3D, options: ShellOptions): void {
  const { width, depth, height, wall, roof, front } = options;
  const back = options.back ?? [[-1.1, 1.1, 0.9, 2.1]];
  const left = options.left ?? [[-0.9, 0.9, 0.9, 2.1]];
  const right = options.right ?? [[-0.9, 0.9, 0.9, 2.1]];
  const wallPattern = options.wallPattern ?? (wall === C.brick ? 'brick' : 'plaster');
  const roofPattern = options.roofPattern ?? (roof === C.roofTin ? 'metal' : 'tiles');
  parent.userData.poiShell = { width, depth, front, back, left, right } satisfies ShellLayout;
  for (const opening of front) {
    if (opening[2] > 0.05) registerWindowClearance(
      parent,
      new THREE.Box3(
        new THREE.Vector3(opening[0], opening[2], -depth / 2 - 0.35),
        new THREE.Vector3(opening[1], opening[3], -depth / 2 + 0.35),
      ),
      'front window',
    );
    if (opening[2] <= 0.05) registerDoorClearance(
      parent,
      new THREE.Box3(
        new THREE.Vector3(opening[0], 0.08, -depth / 2 - 0.3),
        new THREE.Vector3(opening[1], opening[3], -depth / 2 + 1.05),
      ),
      'front exterior door',
    );
  }
  for (const opening of back) {
    if (opening[2] > 0.05) registerWindowClearance(
      parent,
      new THREE.Box3(
        new THREE.Vector3(opening[0], opening[2], depth / 2 - 0.35),
        new THREE.Vector3(opening[1], opening[3], depth / 2 + 0.35),
      ),
      'back window',
    );
    if (opening[2] <= 0.05) registerDoorClearance(
      parent,
      new THREE.Box3(
        new THREE.Vector3(opening[0], 0.08, depth / 2 - 1.05),
        new THREE.Vector3(opening[1], opening[3], depth / 2 + 0.3),
      ),
      'back exterior door',
    );
  }
  for (const opening of left) {
    if (opening[2] > 0.05) registerWindowClearance(
      parent,
      new THREE.Box3(
        new THREE.Vector3(-width / 2 - 0.35, opening[2], opening[0]),
        new THREE.Vector3(-width / 2 + 0.35, opening[3], opening[1]),
      ),
      'left window',
    );
    if (opening[2] <= 0.05) registerDoorClearance(
      parent,
      new THREE.Box3(
        new THREE.Vector3(-width / 2 - 0.3, 0.08, opening[0]),
        new THREE.Vector3(-width / 2 + 1.05, opening[3], opening[1]),
      ),
      'left exterior door',
    );
  }
  for (const opening of right) {
    if (opening[2] > 0.05) registerWindowClearance(
      parent,
      new THREE.Box3(
        new THREE.Vector3(width / 2 - 0.35, opening[2], opening[0]),
        new THREE.Vector3(width / 2 + 0.35, opening[3], opening[1]),
      ),
      'right window',
    );
    if (opening[2] <= 0.05) registerDoorClearance(
      parent,
      new THREE.Box3(
        new THREE.Vector3(width / 2 - 1.05, 0.08, opening[0]),
        new THREE.Vector3(width / 2 + 0.3, opening[3], opening[1]),
      ),
      'right exterior door',
    );
  }
  box(parent, [width, 0.18, depth], [0, 0.09, 0], C.floor);
  wallWithOpenings(parent, 'x', -depth / 2, width, height, front, wall, 0.18, wallPattern);
  wallWithOpenings(parent, 'x', depth / 2, width, height, back, wall, 0.18, wallPattern);
  wallWithOpenings(parent, 'z', -width / 2, depth, height, left, wall, 0.18, wallPattern);
  wallWithOpenings(parent, 'z', width / 2, depth, height, right, wall, 0.18, wallPattern);
  for (const opening of front) trimOpening(parent, 'x', -depth / 2 - 0.01, opening);
  for (const opening of back) trimOpening(parent, 'x', depth / 2 + 0.01, opening);
  for (const opening of left) trimOpening(parent, 'z', -width / 2 - 0.01, opening);
  for (const opening of right) trimOpening(parent, 'z', width / 2 + 0.01, opening);
  if (options.flatRoof) {
    box(parent, [width + 0.35, 0.22, depth + 0.35], [0, height + 0.11, 0], roof, [0, 0, 0], true, roofPattern);
  } else {
    gableRoof(parent, width, depth, height, wall, roof, wallPattern, roofPattern);
  }
}

export function gableGeometry(width: number, rise: number, thickness: number, period = 1): THREE.BufferGeometry {
  const key = `gable:${width}:${rise}:${thickness}:${period}`;
  const cached = geometryCache.get(key);
  if (cached) return cached;
  const w = width / 2;
  const t = thickness / 2;
  const vertices = [
    -w, 0, -t, w, 0, -t, 0, rise, -t,
    -w, 0, t, w, 0, t, 0, rise, t,
  ];
  const indices = [
    0, 2, 1, 3, 4, 5,
    0, 1, 4, 0, 4, 3,
    1, 2, 5, 1, 5, 4,
    2, 0, 3, 2, 3, 5,
  ];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([
    -w / period, 0, w / period, 0, 0, rise / period,
    -w / period, 0, w / period, 0, 0, rise / period,
  ], 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometryCache.set(key, geometry);
  return geometry;
}

function gableRoof(
  parent: THREE.Object3D,
  width: number,
  depth: number,
  y: number,
  wallColor: number,
  roofColor: number,
  wallPattern: SurfacePattern,
  roofPattern: SurfacePattern,
): void {
  const pitch = 0.38;
  const halfSlope = width * 0.55;
  const rise = Math.sin(pitch) * halfSlope;
  const run = Math.cos(pitch) * halfSlope / 2;
  const panelRise = rise / 2;
  box(parent, [halfSlope, 0.18, depth + 0.65], [-run, y + panelRise, 0], roofColor, [0, 0, pitch], true, roofPattern);
  box(parent, [halfSlope, 0.18, depth + 0.65], [run, y + panelRise, 0], roofColor, [0, 0, -pitch], true, roofPattern);
  box(parent, [width - 0.24, 0.12, depth - 0.24], [0, y - 0.06, 0], C.plasterPale, [0, 0, 0], true);
  for (const z of [-depth / 2, depth / 2]) {
    const fronton = new THREE.Mesh(gableGeometry(width, rise, 0.18, PATTERN_PERIOD[wallPattern]), surfaceMaterial(wallColor, wallPattern));
    fronton.position.set(0, y, z);
    fronton.castShadow = true;
    fronton.receiveShadow = true;
    fronton.userData.poiRoof = true;
    parent.add(fronton);
  }
}

export function partition(
  parent: THREE.Object3D,
  axis: WallAxis,
  fixed: number,
  length: number,
  height: number,
  doorwayAt: number,
  color: number = C.plasterPale,
): void {
  const shell = parent.userData.poiShell as ShellLayout | undefined;
  if (shell) {
    const reachesOuterWall = axis === 'z' ? length >= shell.depth - 0.25 : length >= shell.width - 0.25;
    const contactedOpenings = axis === 'z'
      ? [...shell.front, ...shell.back]
      : [...shell.left, ...shell.right];
    const blocksOpening = reachesOuterWall && contactedOpenings.some(
      (opening) => fixed >= opening[0] - 0.12 && fixed <= opening[1] + 0.12,
    );
    if (blocksOpening) {
      throw new Error(`Interior wall at ${fixed.toFixed(2)} intersects an exterior opening`);
    }
  }
  const door: Opening = [doorwayAt - 0.55, doorwayAt + 0.55, 0, 2.2];
  const clearance = axis === 'z'
    ? new THREE.Box3(
      new THREE.Vector3(fixed - 0.85, 0.08, door[0]),
      new THREE.Vector3(fixed + 0.85, door[3], door[1]),
    )
    : new THREE.Box3(
      new THREE.Vector3(door[0], 0.08, fixed - 0.85),
      new THREE.Vector3(door[1], door[3], fixed + 0.85),
    );
  registerDoorClearance(parent, clearance, 'interior door');
  wallWithOpenings(parent, axis, fixed, length, height, [door], color, 0.12);
  trimOpening(parent, axis, fixed, door, C.darkTimber);
}

export function table(parent: THREE.Object3D, x: number, z: number, yaw = 0, color: number = C.timber): void {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  group.rotation.y = yaw;
  parent.add(group);
  markDoorObstacle(group, 'table');
  // Furniture scale: see `FURNITURE_SCALE`. Scaling the group rather than every box
  // keeps a piece in proportion and keeps whatever stands on it standing on it.
  group.scale.setScalar(FURNITURE_SCALE);
  box(group, [1.6, 0.12, 0.85], [0, 0.82, 0], color);
  for (const sx of [-0.68, 0.68]) for (const sz of [-0.3, 0.3]) box(group, [0.1, 0.78, 0.1], [sx, 0.39, sz], C.darkTimber);
}

export function chair(parent: THREE.Object3D, x: number, z: number, yaw = 0, color: number = C.timber): void {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  group.rotation.y = yaw;
  parent.add(group);
  markDoorObstacle(group, 'chair');
  // Furniture scale: see `FURNITURE_SCALE`. Scaling the group rather than every box
  // keeps a piece in proportion and keeps whatever stands on it standing on it.
  group.scale.setScalar(FURNITURE_SCALE);
  box(group, [0.62, 0.1, 0.62], [0, 0.48, 0], color);
  for (const sx of [-0.24, 0.24]) for (const sz of [-0.24, 0.24]) box(group, [0.08, 0.46, 0.08], [sx, 0.23, sz], C.darkTimber);
  box(group, [0.62, 0.72, 0.1], [0, 0.84, 0.27], color);
}

export function bed(parent: THREE.Object3D, x: number, z: number, yaw = 0, color: number = C.fabric): void {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  group.rotation.y = yaw;
  parent.add(group);
  markDoorObstacle(group, 'bed');
  // Furniture scale: see `FURNITURE_SCALE`. Scaling the group rather than every box
  // keeps a piece in proportion and keeps whatever stands on it standing on it.
  group.scale.setScalar(FURNITURE_SCALE);
  box(group, [1.5, 0.28, 2.15], [0, 0.35, 0], C.darkTimber);
  box(group, [1.38, 0.18, 2.0], [0, 0.58, 0], color);
  box(group, [1.0, 0.16, 0.42], [0, 0.76, 0.7], C.white, [0.08, 0, -0.05]);
}

export function sofa(parent: THREE.Object3D, x: number, z: number, yaw = 0, color: number = C.fadedGreen): void {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  group.rotation.y = yaw;
  parent.add(group);
  markDoorObstacle(group, 'sofa');
  // Furniture scale: see `FURNITURE_SCALE`. Scaling the group rather than every box
  // keeps a piece in proportion and keeps whatever stands on it standing on it.
  group.scale.setScalar(FURNITURE_SCALE);
  box(group, [2.1, 0.45, 0.82], [0, 0.42, 0], color);
  box(group, [2.1, 0.85, 0.2], [0, 0.82, 0.34], color, [-0.12, 0, 0]);
  box(group, [0.22, 0.62, 0.9], [-1.0, 0.55, 0], color);
  box(group, [0.22, 0.62, 0.9], [1.0, 0.55, 0], color);
}

/**
 * Top surface of a shelf's plank `i`, above the shelf's own floor, metres.
 *
 * A shelf is four planks 0.55 m apart, each 0.08 m thick, all of it scaled as furniture.
 * Exported because the starting items are placed ON a shelf from another module: sharing
 * the expression rather than its result is what keeps a moved or resized shelf carrying
 * whatever stands on it.
 */
export const SHELF_PLANK_TOP = (i: number): number => (0.26 + i * 0.55) * FURNITURE_SCALE;

export function shelf(parent: THREE.Object3D, x: number, z: number, width: number, yaw = 0, stocked = true): void {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  group.rotation.y = yaw;
  parent.add(group);
  markDoorObstacle(group, 'shelf');
  // Furniture scale: see `FURNITURE_SCALE`. Scaling the group rather than every box
  // keeps a piece in proportion and keeps whatever stands on it standing on it.
  group.scale.setScalar(FURNITURE_SCALE);
  box(group, [0.1, 2.05, 0.48], [-width / 2, 1.02, 0], C.darkMetal);
  box(group, [0.1, 2.05, 0.48], [width / 2, 1.02, 0], C.darkMetal);
  for (let i = 0; i < 4; i++) {
    // Derived from the exported plank top rather than stated twice: 0.04 is half the
    // plank's own thickness.
    const y = SHELF_PLANK_TOP(i) / FURNITURE_SCALE - 0.04;
    box(group, [width, 0.08, 0.55], [0, y, 0], C.metal);
    if (stocked && i < 3) {
      for (let j = 0; j < 3; j++) {
        const itemColor = [C.ochre, C.fadedRed, C.fadedBlue][(i + j) % 3];
        box(group, [0.28, 0.22 + 0.08 * ((i + j) % 2), 0.28], [-width * 0.3 + j * width * 0.3, y + 0.15, 0], itemColor, [0, 0, (j - 1) * 0.05]);
      }
    }
  }
}

export function counter(parent: THREE.Object3D, x: number, z: number, width: number, yaw = 0): void {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  group.rotation.y = yaw;
  parent.add(group);
  markDoorObstacle(group, 'counter');
  // Furniture scale: see `FURNITURE_SCALE`. Scaling the group rather than every box
  // keeps a piece in proportion and keeps whatever stands on it standing on it.
  group.scale.setScalar(FURNITURE_SCALE);
  box(group, [width, 0.82, 0.62], [0, 0.41, 0], C.timber);
  box(group, [width + 0.12, 0.1, 0.74], [0, 0.87, 0], C.darkTimber);
}

export function cashRegister(parent: THREE.Object3D, x: number, z: number, yaw = 0): void {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  group.rotation.y = yaw;
  parent.add(group);
  markDoorObstacle(group, 'cash register');
  // Furniture scale: see `FURNITURE_SCALE`. Scaling the group rather than every box
  // keeps a piece in proportion and keeps whatever stands on it standing on it.
  group.scale.setScalar(FURNITURE_SCALE);
  box(group, [0.52, 0.26, 0.42], [0, 1.08, 0], C.darkMetal);
  box(group, [0.36, 0.18, 0.06], [0, 1.25, -0.2], C.fadedGreen, [-0.25, 0, 0]);
}

export function crate(parent: THREE.Object3D, x: number, z: number, yaw = 0, size = 0.7, baseY = 0): void {
  const group = new THREE.Group();
  group.position.set(x, baseY, z);
  group.rotation.set(0.03, yaw, -0.04);
  parent.add(group);
  markDoorObstacle(group, 'crate');
  box(group, [size, size, size], [0, size / 2, 0], C.timber);
  box(group, [size + 0.03, 0.08, size + 0.03], [0, size * 0.28, 0], C.darkTimber);
  box(group, [size + 0.03, 0.08, size + 0.03], [0, size * 0.72, 0], C.darkTimber);
}

export function barrel(parent: THREE.Object3D, x: number, z: number, color: number = C.rust, tilt = 0, baseY = 0): void {
  const mesh = cylinder(parent, 0.34, 0.34, 0.92, 12, [x, baseY + 0.46, z], color, [tilt, 0, tilt * 0.35]);
  markDoorObstacle(mesh, 'barrel');
}

export function rug(parent: THREE.Object3D, x: number, z: number, width: number, depth: number, color: number, yaw = 0): void {
  // The footprint shrinks with the furniture around it; the pile does not, because a
  // rug is a flat thing and its thickness is what a rug is.
  box(
    parent,
    [width * FURNITURE_SCALE, 0.025, depth * FURNITURE_SCALE],
    [x, 0.205, z],
    color,
    [0, yaw, 0],
  );
}

export function roomLights(
  parent: THREE.Object3D,
  positions: readonly (readonly [x: number, z: number])[],
  ceilingY: number,
  switchPosition: V3,
  switchYaw = 0,
): void {
  // THE SWITCH DOES NOT BUILD ITS LIGHTS, AND THAT IS THE DESIGN.
  //
  // A variant is built ONCE and placed MANY times, so anything a switch controls has to
  // belong to the PLACEMENT rather than to the build: two houses of the same variant must
  // not share a light, or switching one off would darken the other. So this builds the
  // fixtures and their bulbs — geometry like any other — and RECORDS what the switch
  // drives for `poivariantbuild.ts` to create per placement.
  //
  // What those lights will be is that module's business, but the reason is worth stating
  // here: a real light added to the scene compiles its own shader permutation, so a room
  // light streaming in would recompile the world's materials. The world keeps its rendered
  // lights in fixed budgets (`render/lights.ts`), so a room light is an invisible MARKER
  // that `LightBudget` draws like any street lamp — and a switch that is off is genuinely
  // off, because an unlit marker is not an eligible source to spend a slot on.
  for (const [x, z] of positions) {
    const fixture = new THREE.Group();
    fixture.position.set(x, ceilingY, z);
    parent.add(fixture);
    // Never a shadow caster: a ceiling fixture is metres from the floor and centimetres
    // across, so its sun shadow is a dark disc that reads as a stray blob under whoever
    // is standing nearby — not a shading cue anyone is meant to notice. The canopy roofs
    // and wings elsewhere in this file are excluded from `castShadow` for the same
    // reason; this is that same exclusion for every room light in every building.
    const stem = cylinder(fixture, 0.08, 0.08, 0.22, 8, [0, -0.11, 0], C.darkMetal);
    stem.castShadow = false;
    const shade = cylinder(fixture, 0.2, 0.08, 0.12, 12, [0, -0.24, 0], C.white);
    shade.castShadow = false;
  }

  const switchGroup = new THREE.Group();
  switchGroup.position.set(switchPosition[0], switchPosition[1], switchPosition[2]);
  // The lever protrudes along local -Z; yaw must point that vector away from the wall.
  switchGroup.rotation.y = switchYaw;
  parent.add(switchGroup);
  markDoorObstacle(switchGroup, 'light switch');
  // A marker on the GROUP alone, so the world can find the switch — and so that
  // `mergePoiStatics` leaves it and its plate out of the wall it is mounted on.
  switchGroup.userData.poiLightSwitch = true;
  // HALF SIZE, WITH THE PLATE'S BACK FACE LEFT EXACTLY WHERE IT WAS.
  //
  // Scaling about the group origin would not do: the plate is centred on that origin, so
  // halving it would pull its back 0.014 m off the wall and leave the switch floating in
  // front of its own mounting. Offsetting the scaled body by half the difference puts the
  // back face back on the wall — and does so ARITHMETICALLY, for any scale, rather than
  // for the one value that happens to be right today.
  const body = new THREE.Group();
  body.scale.setScalar(SWITCH_SCALE);
  body.position.z = (SWITCH_PLATE_DEPTH / 2) * (1 - SWITCH_SCALE);
  switchGroup.add(body);
  box(body, [0.24, 0.32, SWITCH_PLATE_DEPTH], [0, 0, 0], C.white);
  box(body, [0.08, 0.14, 0.045], [0, 0.01, -0.045], C.darkMetal, [-0.22, 0, 0]);

  // What the switch drives, for the placement to build and to work: where each light hangs,
  // measured FROM THE SWITCH. `positions` arrives in the caller's frame and the switch is
  // placed and yawed inside that same frame, so the two are reconciled here, once, rather
  // than leaving the placement to guess which frame it was handed. The bulbs are the
  // placement's too — see `roomBulbMaterial`.
  const toSwitch = new THREE.Matrix4()
    .makeRotationY(-switchYaw)
    .multiply(
      new THREE.Matrix4().makeTranslation(
        -switchPosition[0],
        -switchPosition[1],
        -switchPosition[2],
      ),
    );
  switchGroup.userData.poiSwitchLights = positions.map(([x, z]) => {
    const point = new THREE.Vector3(x, ceilingY + LIGHT_DROP_Y, z).applyMatrix4(toSwitch);
    return [point.x, point.y, point.z] as V3;
  });
}

/**
 * A fresh bulb material, plus the size of the bulb it goes on.
 *
 * A FACTORY, NOT A SHARED MATERIAL, and the difference is the whole reason the bulbs are
 * built by the placement: two buildings of one variant share a catalogue, so a shared
 * material would let one building's switch darken the other's bulbs. Handing out a new
 * material per bulb makes that impossible by construction, rather than by remembering to
 * clone at the right moment.
 */
export function roomBulbMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: 0xffe6ad,
    roughness: 0.22,
    emissive: 0xffc66d,
    emissiveIntensity: BULB_EMISSIVE_INTENSITY,
  });
}

/** Radius of a room bulb, metres. Its fixture is sized around it. */
export const ROOM_BULB_RADIUS = 0.13;

/** How far above the light's own height the bulb sits, metres, so it hangs in its shade. */
export const ROOM_BULB_LIFT = 0.07;

export function roomLight(
  parent: THREE.Object3D,
  x: number,
  z: number,
  ceilingY: number,
  switchPosition: V3,
  switchYaw = 0,
): void {
  roomLights(parent, [[x, z]], ceilingY, switchPosition, switchYaw);
}

export function torus(
  parent: THREE.Object3D,
  major: number,
  tube: number,
  position: V3,
  color: number,
  rotation: V3 = [0, 0, 0],
): THREE.Mesh {
  const key = `torus:${major}:${tube}`;
  let geometry = geometryCache.get(key);
  if (!geometry) {
    geometry = new THREE.TorusGeometry(major, tube, 7, 18);
    geometryCache.set(key, geometry);
  }
  const mesh = new THREE.Mesh(geometry, material(color));
  mesh.position.set(position[0], position[1], position[2]);
  mesh.rotation.set(rotation[0], rotation[1], rotation[2]);
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}
