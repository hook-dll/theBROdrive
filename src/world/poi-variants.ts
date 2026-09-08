import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { makeFlatMaterial } from '../render/materials';

export interface PoiVariantDefinition {
  readonly id: string;
  readonly name: string;
  readonly category: 'house' | 'shop' | 'gas' | 'wreck' | 'tower' | 'container';
  readonly footprint: readonly [number, number];
  readonly build: (root: THREE.Group) => void;
}

type Opening = readonly [start: number, end: number, bottom: number, top: number];
type WallAxis = 'x' | 'z';
type V3 = readonly [number, number, number];
type SurfacePattern = 'plaster' | 'brick' | 'blocks' | 'boards' | 'metal' | 'tiles';

const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
const geometryCache = new Map<string, THREE.BufferGeometry>();
const surfaceTextures = new Map<SurfacePattern, THREE.DataTexture>();
const surfaceMaterials = new Map<string, THREE.MeshStandardMaterial>();
const ROOM_LIGHT_INTENSITY = 62;
const BULB_EMISSIVE_INTENSITY = 2.4;

const C = {
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

function material(color: number, roughness = 0.88): THREE.MeshStandardMaterial {
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

function box(
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

function cylinder(
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
  if (axis === 'x') {
    box(parent, [bar, height, depth], [start, bottom + height / 2, fixed], color);
    box(parent, [bar, height, depth], [end, bottom + height / 2, fixed], color);
    box(parent, [width + bar, bar, depth], [(start + end) / 2, top, fixed], color);
    if (bottom > 0.05) box(parent, [width + bar, bar, depth], [(start + end) / 2, bottom, fixed], color);
  } else {
    box(parent, [depth, height, bar], [fixed, bottom + height / 2, start], color);
    box(parent, [depth, height, bar], [fixed, bottom + height / 2, end], color);
    box(parent, [depth, bar, width + bar], [fixed, top, (start + end) / 2], color);
    if (bottom > 0.05) box(parent, [depth, bar, width + bar], [fixed, bottom, (start + end) / 2], color);
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

interface ShellLayout {
  readonly width: number;
  readonly depth: number;
  readonly front: readonly Opening[];
  readonly back: readonly Opening[];
  readonly left: readonly Opening[];
  readonly right: readonly Opening[];
}

function shellOpeningsBetween(shell: ShellLayout, minY: number, maxY: number): ShellLayout {
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

interface DoorClearance {
  readonly box: THREE.Box3;
  readonly label: string;
}

function registerDoorClearance(parent: THREE.Object3D, box: THREE.Box3, label: string): void {
  const clearances = (parent.userData.poiDoorClearances as DoorClearance[] | undefined) ?? [];
  clearances.push({ box, label });
  parent.userData.poiDoorClearances = clearances;
}

function registerWindowClearance(parent: THREE.Object3D, box: THREE.Box3, label: string): void {
  const clearances = (parent.userData.poiWindowClearances as DoorClearance[] | undefined) ?? [];
  clearances.push({ box, label });
  parent.userData.poiWindowClearances = clearances;
}

function markDoorObstacle(object: THREE.Object3D, label: string): void {
  object.userData.poiDoorObstacle = label;
}

function buildingShell(parent: THREE.Object3D, options: ShellOptions): void {
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

function gableGeometry(width: number, rise: number, thickness: number, period = 1): THREE.BufferGeometry {
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

function partition(
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

function table(parent: THREE.Object3D, x: number, z: number, yaw = 0, color: number = C.timber): void {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  group.rotation.y = yaw;
  parent.add(group);
  markDoorObstacle(group, 'table');
  box(group, [1.6, 0.12, 0.85], [0, 0.82, 0], color);
  for (const sx of [-0.68, 0.68]) for (const sz of [-0.3, 0.3]) box(group, [0.1, 0.78, 0.1], [sx, 0.39, sz], C.darkTimber);
}

function chair(parent: THREE.Object3D, x: number, z: number, yaw = 0, color: number = C.timber): void {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  group.rotation.y = yaw;
  parent.add(group);
  markDoorObstacle(group, 'chair');
  box(group, [0.62, 0.1, 0.62], [0, 0.48, 0], color);
  for (const sx of [-0.24, 0.24]) for (const sz of [-0.24, 0.24]) box(group, [0.08, 0.46, 0.08], [sx, 0.23, sz], C.darkTimber);
  box(group, [0.62, 0.72, 0.1], [0, 0.84, 0.27], color);
}

function bed(parent: THREE.Object3D, x: number, z: number, yaw = 0, color: number = C.fabric): void {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  group.rotation.y = yaw;
  parent.add(group);
  markDoorObstacle(group, 'bed');
  box(group, [1.5, 0.28, 2.15], [0, 0.35, 0], C.darkTimber);
  box(group, [1.38, 0.18, 2.0], [0, 0.58, 0], color);
  box(group, [1.0, 0.16, 0.42], [0, 0.76, 0.7], C.white, [0.08, 0, -0.05]);
}

function sofa(parent: THREE.Object3D, x: number, z: number, yaw = 0, color: number = C.fadedGreen): void {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  group.rotation.y = yaw;
  parent.add(group);
  markDoorObstacle(group, 'sofa');
  box(group, [2.1, 0.45, 0.82], [0, 0.42, 0], color);
  box(group, [2.1, 0.85, 0.2], [0, 0.82, 0.34], color, [-0.12, 0, 0]);
  box(group, [0.22, 0.62, 0.9], [-1.0, 0.55, 0], color);
  box(group, [0.22, 0.62, 0.9], [1.0, 0.55, 0], color);
}

function shelf(parent: THREE.Object3D, x: number, z: number, width: number, yaw = 0, stocked = true): void {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  group.rotation.y = yaw;
  parent.add(group);
  markDoorObstacle(group, 'shelf');
  box(group, [0.1, 2.05, 0.48], [-width / 2, 1.02, 0], C.darkMetal);
  box(group, [0.1, 2.05, 0.48], [width / 2, 1.02, 0], C.darkMetal);
  for (let i = 0; i < 4; i++) {
    const y = 0.22 + i * 0.55;
    box(group, [width, 0.08, 0.55], [0, y, 0], C.metal);
    if (stocked && i < 3) {
      for (let j = 0; j < 3; j++) {
        const itemColor = [C.ochre, C.fadedRed, C.fadedBlue][(i + j) % 3];
        box(group, [0.28, 0.22 + 0.08 * ((i + j) % 2), 0.28], [-width * 0.3 + j * width * 0.3, y + 0.15, 0], itemColor, [0, 0, (j - 1) * 0.05]);
      }
    }
  }
}

function counter(parent: THREE.Object3D, x: number, z: number, width: number, yaw = 0): void {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  group.rotation.y = yaw;
  parent.add(group);
  markDoorObstacle(group, 'counter');
  box(group, [width, 0.82, 0.62], [0, 0.41, 0], C.timber);
  box(group, [width + 0.12, 0.1, 0.74], [0, 0.87, 0], C.darkTimber);
}

function cashRegister(parent: THREE.Object3D, x: number, z: number, yaw = 0): void {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  group.rotation.y = yaw;
  parent.add(group);
  markDoorObstacle(group, 'cash register');
  box(group, [0.52, 0.26, 0.42], [0, 1.08, 0], C.darkMetal);
  box(group, [0.36, 0.18, 0.06], [0, 1.25, -0.2], C.fadedGreen, [-0.25, 0, 0]);
}

function crate(parent: THREE.Object3D, x: number, z: number, yaw = 0, size = 0.7, baseY = 0): void {
  const group = new THREE.Group();
  group.position.set(x, baseY, z);
  group.rotation.set(0.03, yaw, -0.04);
  parent.add(group);
  markDoorObstacle(group, 'crate');
  box(group, [size, size, size], [0, size / 2, 0], C.timber);
  box(group, [size + 0.03, 0.08, size + 0.03], [0, size * 0.28, 0], C.darkTimber);
  box(group, [size + 0.03, 0.08, size + 0.03], [0, size * 0.72, 0], C.darkTimber);
}

function barrel(parent: THREE.Object3D, x: number, z: number, color: number = C.rust, tilt = 0, baseY = 0): void {
  const mesh = cylinder(parent, 0.34, 0.34, 0.92, 12, [x, baseY + 0.46, z], color, [tilt, 0, tilt * 0.35]);
  markDoorObstacle(mesh, 'barrel');
}

function rug(parent: THREE.Object3D, x: number, z: number, width: number, depth: number, color: number, yaw = 0): void {
  box(parent, [width, 0.025, depth], [x, 0.205, z], color, [0, yaw, 0]);
}

function roomLights(
  parent: THREE.Object3D,
  positions: readonly (readonly [x: number, z: number])[],
  ceilingY: number,
  switchPosition: V3,
  switchYaw = 0,
): void {
  const lights: THREE.SpotLight[] = [];
  const bulbMaterials: THREE.MeshStandardMaterial[] = [];
  for (const [x, z] of positions) {
    const fixture = new THREE.Group();
    fixture.position.set(x, ceilingY, z);
    parent.add(fixture);
    cylinder(fixture, 0.08, 0.08, 0.22, 8, [0, -0.11, 0], C.darkMetal);
    cylinder(fixture, 0.2, 0.08, 0.12, 12, [0, -0.24, 0], C.white);
    const bulbMaterial = new THREE.MeshStandardMaterial({
      color: 0xffe6ad,
      roughness: 0.22,
      emissive: 0xffc66d,
      emissiveIntensity: BULB_EMISSIVE_INTENSITY,
    });
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 8), bulbMaterial);
    bulb.position.y = -0.36;
    fixture.add(bulb);
    const light = new THREE.SpotLight(0xffd49a, ROOM_LIGHT_INTENSITY, ceilingY + 0.7, 0.72, 0.9, 2);
    light.position.y = -0.43;
    light.castShadow = false;
    light.target.position.set(0, -ceilingY, 0);
    fixture.add(light, light.target);
    lights.push(light);
    bulbMaterials.push(bulbMaterial);
  }

  const switchGroup = new THREE.Group();
  switchGroup.position.set(switchPosition[0], switchPosition[1], switchPosition[2]);
  // The lever protrudes along local -Z; yaw must point that vector away from the wall.
  switchGroup.rotation.y = switchYaw;
  parent.add(switchGroup);
  markDoorObstacle(switchGroup, 'light switch');
  box(switchGroup, [0.24, 0.32, 0.055], [0, 0, 0], C.white);
  const toggle = box(switchGroup, [0.08, 0.14, 0.045], [0, 0.01, -0.045], C.darkMetal, [-0.22, 0, 0]);
  let switchedOn = true;
  const toggleLight = (): boolean => {
    switchedOn = !switchedOn;
    for (const light of lights) light.intensity = switchedOn ? ROOM_LIGHT_INTENSITY : 0;
    for (const bulbMaterial of bulbMaterials) bulbMaterial.emissiveIntensity = switchedOn ? BULB_EMISSIVE_INTENSITY : 0;
    toggle.rotation.x = switchedOn ? -0.22 : 0.22;
    return switchedOn;
  };
  switchGroup.traverse((object) => {
    object.userData.poiLightToggle = toggleLight;
  });
}

function roomLight(
  parent: THREE.Object3D,
  x: number,
  z: number,
  ceilingY: number,
  switchPosition: V3,
  switchYaw = 0,
): void {
  roomLights(parent, [[x, z]], ceilingY, switchPosition, switchYaw);
}

function upperFloorWithStairwell(
  parent: THREE.Object3D,
  width: number,
  depth: number,
  y: number,
  hole: readonly [x0: number, x1: number, z0: number, z1: number],
): void {
  const [x0, x1, z0, z1] = hole;
  registerDoorClearance(
    parent,
    new THREE.Box3(
      new THREE.Vector3(x0 + 0.08, y - 0.05, z0 + 0.08),
      new THREE.Vector3(x1 - 0.08, y + 2.15, z1 - 0.08),
    ),
    'stairwell landing',
  );
  const thickness = 0.18;
  box(parent, [x0 + width / 2, thickness, depth], [(-width / 2 + x0) / 2, y - thickness / 2, 0], C.floor, [0, 0, 0], true);
  box(parent, [width / 2 - x1, thickness, depth], [(x1 + width / 2) / 2, y - thickness / 2, 0], C.floor, [0, 0, 0], true);
  box(parent, [x1 - x0, thickness, z0 + depth / 2], [(x0 + x1) / 2, y - thickness / 2, (-depth / 2 + z0) / 2], C.floor, [0, 0, 0], true);
  box(parent, [x1 - x0, thickness, depth / 2 - z1], [(x0 + x1) / 2, y - thickness / 2, (z1 + depth / 2) / 2], C.floor, [0, 0, 0], true);
}

function staircase(
  parent: THREE.Object3D,
  x: number,
  z: number,
  yaw: number,
  floorHeight: number,
  width: number,
  hole: readonly [x0: number, x1: number, z0: number, z1: number],
): void {
  const stairs = new THREE.Group();
  stairs.position.set(x, 0, z);
  stairs.rotation.y = yaw;
  parent.add(stairs);
  const steps = 16;
  const run = 0.29;
  const rise = floorHeight / steps;
  for (let step = 0; step < steps; step++) {
    const top = rise * (step + 1);
    const travel = step * run + run / 2;
    const centerX = x + Math.sin(yaw) * travel;
    const centerZ = z + Math.cos(yaw) * travel;
    const halfX = Math.abs(Math.cos(yaw)) * width / 2 + Math.abs(Math.sin(yaw)) * run / 2;
    const halfZ = Math.abs(Math.sin(yaw)) * width / 2 + Math.abs(Math.cos(yaw)) * run / 2;
    if (
      top + 1.9 > floorHeight
      && (centerX - halfX < hole[0] || centerX + halfX > hole[1] || centerZ - halfZ < hole[2] || centerZ + halfZ > hole[3])
    ) {
      throw new Error(`Stair step ${step + 1} has less than 1.9 m of headroom`);
    }
    box(stairs, [width, top, run + 0.015], [0, top / 2, travel], C.timber);
  }
  for (const side of [-1, 1]) {
    for (let step = 1; step < steps; step += 3) {
      const y = rise * (step + 1);
      const zPos = step * run;
      box(stairs, [0.07, 0.85, 0.07], [side * (width / 2 - 0.04), y + 0.42, zPos], C.darkTimber);
    }
    beamBetween(
      stairs,
      new THREE.Vector3(side * (width / 2 - 0.04), rise + 0.85, run),
      new THREE.Vector3(side * (width / 2 - 0.04), floorHeight + 0.85, steps * run),
      0.08,
      C.darkTimber,
    );
  }
}

function stairwellRailing(
  parent: THREE.Object3D,
  y: number,
  hole: readonly [x0: number, x1: number, z0: number, z1: number],
): void {
  const [x0, x1, z0, z1] = hole;
  for (const x of [x0, x1]) {
    for (const z of [z0, z1]) box(parent, [0.08, 0.9, 0.08], [x, y + 0.45, z], C.darkTimber);
    box(parent, [0.08, 0.08, z1 - z0], [x, y + 0.88, (z0 + z1) / 2], C.darkTimber);
  }
  box(parent, [x1 - x0, 0.08, 0.08], [(x0 + x1) / 2, y + 0.88, z1], C.darkTimber);
}

function buildCottage(root: THREE.Group): void {
  const h = 3.0;
  buildingShell(root, {
    width: 8.5, depth: 6.5, height: h, wall: C.plaster, roof: C.roof,
    front: [[-2.8, -1.5, 0, 2.25], [0.8, 2.3, 0.95, 2.15]],
    back: [[-3.0, -1.5, 0.95, 2.15], [1.4, 3.0, 0.95, 2.15]],
  });
  partition(root, 'z', 0.35, 6.5, h, -1.4);
  table(root, -2.2, 0, 0.14);
  chair(root, -2.35, -1.05, 0.05);
  chair(root, -2.0, 1.08, Math.PI);
  bed(root, 2.1, 1.1, 0.12, C.fadedBlue);
  crate(root, 2.9, -1.65, 0.3);
  roomLight(root, -1.95, 0, h, [0.27, 1.25, -0.65], Math.PI / 2);
  roomLight(root, 2.3, 0, h, [0.43, 1.25, -2.1], -Math.PI / 2);
}

function buildPorchHouse(root: THREE.Group): void {
  const h = 3.2;
  buildingShell(root, {
    width: 10.5, depth: 7.2, height: h, wall: C.plasterPale, roof: C.fadedGreen,
    front: [[-0.65, 0.65, 0, 2.3], [-4.1, -2.3, 0.9, 2.2], [2.3, 4.1, 0.9, 2.2]],
    back: [[-3.6, -2.0, 0.95, 2.2], [1.7, 3.5, 0.95, 2.2]],
    left: [[-2.7, -1.3, 0.9, 2.2]],
    right: [[1.3, 2.7, 0.9, 2.2]],
  });
  box(root, [11.2, 0.16, 1.7], [0, 0.22, -4.25], C.timber);
  for (const x of [-4.8, -1.7, 1.7, 4.8]) box(root, [0.14, 2.45, 0.14], [x, 1.38, -4.75], C.darkTimber);
  box(root, [11.2, 0.16, 2.1], [0, 2.65, -4.25], C.roofTin, [0.08, 0, 0], true);
  partition(root, 'z', -1.4, 7.2, h, -1.8);
  partition(root, 'x', 0.6, 10.5, h, 3.0);
  sofa(root, -3.7, -1.35, 0.08, C.fadedRed);
  table(root, -3.2, 2.0, -0.2);
  bed(root, 2.8, 2.5, Math.PI / 2, C.fabric);
  chair(root, 1.4, -1.55, 1.4);
  roomLight(root, -3.3, -1.5, h, [-1.52, 1.25, -2.55], Math.PI / 2);
  roomLight(root, -3.3, 2.1, h, [-1.52, 1.25, 1.45], Math.PI / 2);
  roomLight(root, 1.9, -1.5, h, [2.2, 1.25, 0.47], 0);
  roomLight(root, 1.9, 2.1, h, [3.8, 1.25, 0.73], Math.PI);
}

function buildLongHouse(root: THREE.Group): void {
  const h = 2.85;
  buildingShell(root, {
    width: 12.5, depth: 5.8, height: h, wall: C.plasterBlue, roof: C.roofTin,
    front: [[-5.2, -3.9, 0, 2.2], [-1.9, -0.4, 0.9, 2.05], [2.1, 3.7, 0.9, 2.05]],
    back: [[-5.0, -3.6, 0.9, 2.05], [-1.2, 0.3, 0.9, 2.05], [3.0, 4.6, 0.9, 2.05]],
    right: [[-0.7, 0.7, 0, 2.2]],
  });
  partition(root, 'z', -2.8, 5.8, h, -1.25);
  partition(root, 'z', 1.2, 5.8, h, 1.2);
  bed(root, -4.5, 1.1, Math.PI / 2, C.fadedGreen);
  sofa(root, -1.05, 1.75, Math.PI, C.ochre);
  table(root, 4.0, -0.45, 0.3);
  chair(root, 3.25, -1.55, -0.25);
  crate(root, 5.1, 1.7, 0.4, 0.55);
  roomLight(root, -4.5, 0, h, [-2.92, 1.25, -2.05], Math.PI / 2);
  roomLight(root, -0.8, 0, h, [-2.68, 1.25, -0.35], -Math.PI / 2);
  roomLight(root, 3.7, 0, h, [1.32, 1.25, 2.0], Math.PI / 2);
}

function buildCourtyardHouse(root: THREE.Group): void {
  const h = 3.6;
  buildingShell(root, {
    width: 18, depth: 13, height: h, wall: C.brick, roof: C.roof,
    wallPattern: 'brick', roofPattern: 'tiles',
    front: [[-1.0, 0.5, 0, 2.45], [-7.2, -5.3, 1.0, 2.35], [2.3, 4.2, 1.0, 2.35], [6.0, 7.9, 1.0, 2.35]],
    back: [[-7.2, -5.3, 1.0, 2.35], [-0.9, 1.0, 1.0, 2.35], [5.8, 7.7, 1.0, 2.35]],
    left: [[-4.5, -2.7, 1.0, 2.35], [2.7, 4.5, 1.0, 2.35]],
    right: [[-4.5, -2.7, 1.0, 2.35], [2.7, 4.5, 1.0, 2.35]],
  });
  partition(root, 'z', -3.0, 13, h, -2.2);
  partition(root, 'x', 1.2, 18, h, 4.8);
  box(root, [19.2, 0.18, 2.2], [0, 0.2, -7.55], C.timber);
  box(root, [19.2, 0.18, 2.6], [0, 3.0, -7.45], C.roofTin, [0.08, 0, 0], true);
  for (const x of [-8.4, -5.6, -2.8, 0, 2.8, 5.6, 8.4]) box(root, [0.14, 2.75, 0.14], [x, 1.5, -8.1], C.darkTimber);

  sofa(root, 1.2, -3.7, 0.1, C.fadedBlue);
  rug(root, 1.2, -2.4, 4.2, 2.8, C.fadedRed, 0.04);
  table(root, 6.1, -1.6, -0.08);
  chair(root, 6.0, -2.75, 0);
  chair(root, 6.2, -0.45, Math.PI);
  bed(root, -6.2, 3.6, Math.PI / 2, C.fabric);
  bed(root, 1.0, 4.1, Math.PI / 2, C.fadedGreen);
  shelf(root, 7.6, 4.6, 3.2, Math.PI / 2, false);
  crate(root, -7.5, -4.8, 0.2, 0.58);

  roomLight(root, -6.0, -2.65, h, [-3.12, 1.3, -3.15], Math.PI / 2);
  roomLight(root, -6.0, 3.85, h, [-3.12, 1.3, -1.1], Math.PI / 2);
  roomLight(root, 3.0, -2.65, h, [3.8, 1.3, 1.08], 0);
  roomLight(root, 3.0, 3.85, h, [5.85, 1.3, 1.32], Math.PI);
}

function buildWorkshopHome(root: THREE.Group): void {
  const floorHeight = 3.2;
  const totalHeight = 6.4;
  const stairwell: readonly [number, number, number, number] = [3.25, 5.75, -3.15, 0.65];
  buildingShell(root, {
    width: 16, depth: 12, height: totalHeight, wall: C.plasterPale, roof: C.fadedGreen,
    wallPattern: 'boards', roofPattern: 'metal',
    front: [
      [-1.0, 0.4, 0, 2.45], [-6.4, -4.6, 0.95, 2.35], [2.5, 4.3, 0.95, 2.35],
      [-6.4, -4.6, 4.0, 5.4], [-0.9, 0.9, 4.0, 5.4], [4.6, 6.4, 4.0, 5.4],
    ],
    back: [
      [-6.3, -4.5, 0.95, 2.35], [0.4, 2.2, 0.95, 2.35], [5.2, 6.8, 0, 2.4],
      [-6.3, -4.5, 4.0, 5.4], [2.5, 4.3, 4.0, 5.4],
    ],
    left: [[-4.0, -2.4, 0.95, 2.35], [2.4, 4.0, 0.95, 2.35], [-4.0, -2.4, 4.0, 5.4], [2.4, 4.0, 4.0, 5.4]],
    right: [[-4.0, -2.4, 0.95, 2.35], [2.4, 4.0, 0.95, 2.35], [-4.0, -2.4, 4.0, 5.4], [2.4, 4.0, 4.0, 5.4]],
  });
  partition(root, 'z', -2.0, 12, floorHeight, -2.5);
  const groundLeft = new THREE.Group();
  groundLeft.position.x = -5;
  root.add(groundLeft);
  partition(groundLeft, 'x', 1.5, 6.0, floorHeight, 0);
  upperFloorWithStairwell(root, 16, 12, floorHeight, stairwell);
  staircase(root, 4.5, -4.6, 0, floorHeight, 1.55, stairwell);
  stairwellRailing(root, floorHeight, stairwell);

  const upper = new THREE.Group();
  upper.position.y = floorHeight;
  root.add(upper);
  upper.userData.poiShell = shellOpeningsBetween(root.userData.poiShell as ShellLayout, floorHeight, totalHeight);
  partition(upper, 'z', 1.6, 12, floorHeight, 2.8);
  sofa(root, 1.2, -3.4, 0, C.fadedGreen);
  table(root, -5.2, -1.0, 0.12);
  chair(root, -5.3, -2.15, 0);
  chair(root, -5.1, 0.15, Math.PI);
  bed(root, -5.1, 3.7, Math.PI / 2, C.fabric);
  shelf(root, 7.3, 0, 3.4, Math.PI / 2, false);
  bed(upper, -4.1, 2.1, Math.PI / 2, C.fadedBlue);
  sofa(upper, -3.5, -3.7, 0.08, C.ochre);
  table(upper, 4.4, 2.8, -0.15);
  rug(upper, -3.4, -2.2, 3.6, 2.4, C.fadedRed, 0.05);

  roomLight(root, -5.0, -2.2, floorHeight, [-2.12, 1.3, -3.5], Math.PI / 2);
  roomLight(root, -5.0, 3.7, floorHeight, [-2.12, 1.3, -1.5], Math.PI / 2);
  roomLight(root, 3.0, -2.6, floorHeight, [0.8, 1.3, -5.88], Math.PI);
  roomLight(upper, -3.2, 0, floorHeight, [1.48, 1.3, 1.8], Math.PI / 2);
  roomLight(upper, 4.8, 0, floorHeight, [1.72, 1.3, 3.8], -Math.PI / 2);

  box(root, [7.2, 0.18, 1.8], [3.9, floorHeight + 0.05, -6.7], C.timber);
  for (const x of [0.5, 2.2, 3.9, 5.6, 7.3]) box(root, [0.08, 1.0, 0.08], [x, floorHeight + 0.5, -7.5], C.darkTimber);
  box(root, [7.0, 0.08, 0.08], [3.9, floorHeight + 0.95, -7.5], C.darkTimber);
}

function buildKiosk(root: THREE.Group): void {
  const h = 2.65;
  buildingShell(root, { width: 5.2, depth: 4.2, height: h, wall: C.ochre, roof: C.fadedRed, flatRoof: true, front: [[-1.9, 1.1, 1.0, 2.15]], right: [[-1.25, 0.05, 0, 2.2]], back: [[-1.3, 1.3, 1.0, 2.05]], left: [] });
  counter(root, -0.35, -1.45, 3.1);
  shelf(root, 0, 1.65, 3.4, 0, true);
  crate(root, -1.8, 0.45, 0.2, 0.55);
  box(root, [5.8, 0.18, 1.1], [0, 2.85, -2.35], C.roofTin, [-0.08, 0, 0], true);
  roomLight(root, 0, 0, h, [2.48, 1.25, 0.45], Math.PI / 2);
}

function buildRoadCafe(root: THREE.Group): void {
  const h = 3.25;
  buildingShell(root, { width: 10.5, depth: 8.2, height: h, wall: C.plasterPale, roof: C.fadedBlue, flatRoof: true, front: [[-4.3, -2.2, 0.75, 2.35], [-0.7, 0.7, 0, 2.35], [2.0, 4.3, 0.75, 2.35]], back: [[-3.8, -2.3, 0.9, 2.2], [2.1, 3.7, 0.9, 2.2]], left: [[-2.8, -1.2, 0.9, 2.2]], right: [[2.0, 3.4, 0.9, 2.2]] });
  partition(root, 'x', 1.45, 10.5, h, 3.5);
  counter(root, 2.7, 3.15, 3.4, 0);
  cashRegister(root, 3.5, 2.73);
  for (const [x, z, yaw] of [[-3.0, -1.3, 0.1], [-2.8, 0.55, -0.1], [0.1, -1.4, 0.25]] as const) {
    table(root, x, z, yaw);
    const dx = Math.cos(yaw) * 1.22;
    const dz = -Math.sin(yaw) * 1.22;
    chair(root, x - dx, z - dz, yaw + Math.PI / 2);
    chair(root, x + dx, z + dz, yaw - Math.PI / 2);
  }
  crate(root, -4.25, 3.15, 0.5, 0.6);
  roomLight(root, 0, -1.3, h, [0.95, 1.25, -3.98], Math.PI);
  roomLight(root, 0, 2.78, h, [2.7, 1.25, 1.58], Math.PI);
}

function buildGeneralStore(root: THREE.Group): void {
  const h = 3.5;
  buildingShell(root, { width: 12.0, depth: 9.0, height: h, wall: C.fadedGreen, roof: C.roofTin, front: [[-4.8, -2.1, 0.8, 2.45], [-0.65, 0.65, 0, 2.45], [2.1, 4.8, 0.8, 2.45]], left: [[-2.8, -1.1, 0.9, 2.25]], right: [[1.2, 2.9, 0.9, 2.25]], flatRoof: true });
  counter(root, 3.7, -2.8, 3.7, 0);
  cashRegister(root, 3.4, -3.18);
  for (const x of [-3.6, 0]) shelf(root, x, 0.5, 4.8, Math.PI / 2, true);
  shelf(root, 0, 3.8, 8.2, 0, true);
  crate(root, -4.8, 3.25, -0.2);
  crate(root, 4.8, 2.9, 0.35, 0.55);
  roomLight(root, 0, 0, h, [0.95, 1.25, -4.38], Math.PI);
}

function buildMarket(root: THREE.Group): void {
  const h = 4.5;
  buildingShell(root, {
    width: 24, depth: 16, height: h, wall: C.concreteLight, roof: C.fadedRed, flatRoof: true,
    front: [[-2.0, 2.0, 0, 2.9], [-10.5, -6.0, 1.0, 2.8], [5.0, 10.5, 1.0, 2.8]],
    back: [[-9.5, -6.5, 1.1, 2.7], [7.8, 10.5, 0, 3.1]],
    left: [[-5.8, -3.2, 1.1, 2.7], [0.2, 2.8, 1.1, 2.7]],
    right: [[-5.5, -3.0, 1.1, 2.7], [0.2, 2.8, 1.1, 2.7]],
  });
  partition(root, 'x', 5.2, 24, h, 8.5, C.concrete);
  for (const x of [-8.0, -4.0, 0, 4.0]) shelf(root, x, -0.2, 8.0, Math.PI / 2, true);
  shelf(root, -5.5, 4.35, 10.5, 0, true);
  counter(root, 6.2, -5.8, 3.0, 0);
  counter(root, 9.6, -5.8, 2.6, 0);
  cashRegister(root, 6.7, -6.22);
  cashRegister(root, 10.0, -6.22);
  crate(root, -9.8, 7.0, 0.15, 0.7);
  crate(root, -8.7, 7.1, -0.2, 0.62);
  barrel(root, -7.5, 7.05, C.fadedBlue);
  roomLights(root, [[-6, -1], [2, -1], [8, -1]], h, [2.6, 1.35, -7.88], Math.PI);
  roomLights(root, [[-5, 6.6], [3, 6.6]], h, [7.4, 1.35, 5.32], Math.PI);
  box(root, [25.5, 0.24, 2.2], [0, 3.9, -8.85], C.fadedRed, [-0.07, 0, 0], true);
  for (const x of [-11.2, -5.6, 0, 5.6, 11.2]) box(root, [0.16, 3.8, 0.16], [x, 1.9, -9.4], C.darkMetal);
}

function buildAutoPartsStore(root: THREE.Group): void {
  const h = 5.0;
  buildingShell(root, {
    width: 28, depth: 18, height: h, wall: C.brick, roof: C.roofTin, flatRoof: true,
    front: [[-10.5, -7.3, 0, 3.0], [-5.4, -1.5, 1.1, 2.9], [1.0, 4.2, 1.1, 2.9], [8.0, 12.0, 1.1, 2.9]],
    back: [[-11.5, -8.0, 1.1, 2.8], [-3.5, 0, 1.1, 2.8], [8.2, 11.8, 0, 3.3]],
    left: [[-6.7, -3.8, 1.1, 2.8], [-1.2, 1.2, 1.1, 2.8], [5.0, 7.2, 1.1, 2.8]],
    right: [[-6.5, -3.5, 1.1, 2.8], [-1.2, 1.0, 1.1, 2.8], [5.1, 7.3, 1.1, 2.8]],
  });
  partition(root, 'z', 5.5, 18, h, 2.8, C.concreteLight);
  for (const x of [-10.8, -6.8, -2.8, 1.2]) shelf(root, x, 0, 10.5, Math.PI / 2, true);
  shelf(root, -4.5, 7.8, 15.5, 0, false);
  counter(root, -3.8, -6.4, 5.0, 0);
  cashRegister(root, -2.8, -6.82);
  for (const [x, z, tilt] of [[8.0, -4.5, 0], [9.4, -4.2, 0.18], [11.0, -4.7, Math.PI / 2], [8.5, -2.8, 0]] as const) {
    cylinder(root, 0.52, 0.52, 0.28, 18, [x, tilt === 0 ? 0.52 : 0.35, z], C.darkMetal, tilt === 0 ? [Math.PI / 2, 0, 0] : [0, 0, tilt]);
  }
  crate(root, 9.0, 6.4, -0.2, 0.8);
  crate(root, 10.3, 6.7, 0.25, 0.7);
  barrel(root, 12.3, 6.5, C.rust);
  roomLight(root, -5.0, -2.5, h, [-6.7, 1.4, -8.88], Math.PI);
  roomLight(root, -5.0, 4.5, h, [5.38, 1.4, 1.75], Math.PI / 2);
  roomLight(root, 9.5, 0, h, [5.62, 1.4, 4.0], -Math.PI / 2);
  box(root, [29.5, 0.26, 2.6], [0, 4.25, -9.2], C.roofTin, [-0.08, 0, 0], true);
  for (const x of [-13, -6.5, 0, 6.5, 13]) box(root, [0.18, 4.0, 0.18], [x, 2, -10.0], C.darkMetal);
}

function fuelPump(parent: THREE.Object3D, x: number, z: number, yaw: number, color: number): void {
  const pump = new THREE.Group();
  pump.position.set(x, 0, z);
  pump.rotation.y = yaw;
  parent.add(pump);
  markDoorObstacle(pump, 'fuel pump');
  box(pump, [0.95, 0.16, 0.75], [0, 0.08, 0], C.concrete);
  box(pump, [0.78, 1.55, 0.52], [0, 0.88, 0], color);
  box(pump, [0.6, 0.4, 0.08], [0, 1.18, -0.29], C.darkMetal);
  box(pump, [0.38, 0.17, 0.05], [0, 1.2, -0.35], C.white);
  torus(pump, 0.34, 0.045, [0.48, 0.82, 0], C.darkMetal, [0, Math.PI / 2, 0]);
  box(pump, [0.1, 0.42, 0.12], [0.5, 0.55, -0.16], C.darkMetal, [0.1, 0, -0.12]);
}

function canopyLamp(parent: THREE.Object3D, x: number, y: number, z: number): void {
  const bulbMaterial = new THREE.MeshStandardMaterial({
    color: 0xffe8b0,
    emissive: 0xffc76f,
    emissiveIntensity: 2.8,
    roughness: 0.3,
  });
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 7), bulbMaterial);
  bulb.position.set(x, y, z);
  parent.add(bulb);
  const light = new THREE.PointLight(0xffd294, 34, 7, 2);
  light.position.set(x, y - 0.08, z);
  parent.add(light);
}

function stationSign(parent: THREE.Object3D, x: number, z: number, height: number, color: number): void {
  cylinder(parent, 0.11, 0.16, height, 8, [x, height / 2, z], C.darkMetal);
  box(parent, [2.2, 1.25, 0.18], [x, height - 0.85, z], color);
  box(parent, [1.5, 0.24, 0.22], [x, height - 0.85, z - 0.03], C.white);
  cylinder(parent, 0.32, 0.32, 0.2, 12, [x, height - 0.85, z - 0.18], C.fadedRed, [Math.PI / 2, 0, 0]);
}

function stationCabin(
  parent: THREE.Object3D,
  x: number,
  z: number,
  width: number,
  depth: number,
  wallColor: number,
  roofColor: number,
): THREE.Group {
  const cabin = new THREE.Group();
  cabin.position.set(x, 0, z);
  parent.add(cabin);
  const door: Opening = [-width / 2 + 0.45, -width / 2 + 1.7, 0, 2.25];
  const window: Opening = [door[1] + 0.65, width / 2 - 0.4, 0.9, 2.25];
  buildingShell(cabin, {
    width, depth, height: 3.0, wall: wallColor, roof: roofColor, flatRoof: true,
    front: [door, window],
    back: [[-width / 2 + 0.7, width / 2 - 0.7, 0.9, 2.2]],
    left: [[-0.7, 0.8, 0.9, 2.2]],
    right: [[-0.7, 0.8, 0.9, 2.2]],
  });
  counter(cabin, width * 0.18, 0.65, width * 0.42, 0);
  cashRegister(cabin, width * 0.22, 0.23);
  roomLight(cabin, 0, 0, 3.0, [door[1] + 0.3, 1.3, -depth / 2 + 0.12], Math.PI);
  return cabin;
}

function buildMushroomGas(root: THREE.Group): void {
  for (const [x, color] of [[-6.2, C.fadedRed], [6.2, C.fadedBlue]] as const) {
    const canopy = cylinder(root, 3.7, 4.3, 0.35, 24, [x, 4.25, 0], color);
    canopy.castShadow = false;
    cylinder(root, 0.32, 0.58, 4.1, 12, [x, 2.05, 0], C.concreteLight);
    fuelPump(root, x, -1.45, 0, C.fadedRed);
    fuelPump(root, x, 1.45, Math.PI, C.fadedGreen);
    canopyLamp(root, x, 4.0, 0);
  }
  stationCabin(root, 11.5, 7.5, 5.2, 4.2, C.plasterPale, C.fadedRed);
  stationSign(root, -13.0, -7.0, 7.5, C.fadedRed);
  box(root, [30, 0.14, 20], [0, 0.07, 0], C.concrete);
}

function buildButterflyGas(root: THREE.Group): void {
  for (const z of [-3.0, 3.0]) {
    const leftWing = box(root, [7.4, 0.22, 5.2], [-3.45, 4.2, z], C.fadedBlue, [0, 0, -0.14], true, 'metal');
    const rightWing = box(root, [7.4, 0.22, 5.2], [3.45, 4.2, z], C.white, [0, 0, 0.14], true, 'metal');
    leftWing.castShadow = false;
    rightWing.castShadow = false;
    box(root, [0.34, 4.0, 0.34], [0, 2.0, z], C.darkMetal);
    fuelPump(root, -2.0, z, 0, C.ochre);
    fuelPump(root, 2.0, z, Math.PI, C.fadedRed);
    canopyLamp(root, 0, 3.75, z);
  }
  stationCabin(root, 10.8, 6.6, 6.4, 5.0, C.brick, C.roofTin);
  stationSign(root, -13.0, -6.5, 8.2, C.fadedBlue);
  box(root, [30, 0.14, 19], [0, 0.07, 0], C.concrete);
}

function buildPavilionGas(root: THREE.Group): void {
  const pavilionRoof = box(root, [20, 0.32, 7.5], [-1.0, 4.6, -0.2], C.roof, [0, 0, 0], true, 'tiles');
  const pavilionFascia = box(root, [20.8, 0.16, 1.0], [-1.0, 4.85, -3.55], C.white, [0, 0, 0], true);
  pavilionRoof.castShadow = false;
  pavilionFascia.castShadow = false;
  for (const x of [-9, -5, -1, 3, 7]) {
    cylinder(root, 0.2, 0.28, 4.5, 12, [x, 2.25, -2.8], C.plasterPale);
    cylinder(root, 0.16, 0.23, 4.5, 12, [x, 2.25, 2.4], C.plasterPale);
  }
  for (const [index, x] of [-7, -3, 1, 5].entries()) {
    const color = index % 2 === 0 ? C.fadedGreen : C.fadedRed;
    fuelPump(root, x, -2.8, 0, color);
    fuelPump(root, x, 2.4, Math.PI, color);
    canopyLamp(root, x, 4.35, -0.2);
  }
  stationCabin(root, 11.0, 6.0, 6.0, 5.2, C.plasterPale, C.roof);
  box(root, [2.2, 7.8, 2.2], [11.0, 3.9, -3.8], C.brick, [0, 0, 0], false, 'brick');
  box(root, [2.8, 0.3, 2.8], [11.0, 7.9, -3.8], C.roof, [0, 0, 0], true, 'tiles');
  stationSign(root, -13.0, -6.2, 6.8, C.ochre);
  box(root, [30, 0.14, 19], [0, 0.07, 0], C.concrete);
}

function buildUfoGas(root: THREE.Group): void {
  const lowerSaucer = cylinder(root, 7.7, 8.8, 0.55, 32, [0, 5.35, 0], C.white);
  const upperSaucer = cylinder(root, 3.2, 7.7, 0.46, 32, [0, 5.82, 0], C.fadedRed);
  lowerSaucer.castShadow = false;
  upperSaucer.castShadow = false;
  cylinder(root, 0.55, 0.95, 5.1, 16, [0, 2.55, 0], C.concreteLight);
  for (let i = 0; i < 6; i++) {
    const angle = i * Math.PI / 3;
    const x = Math.cos(angle) * 5.7;
    const z = Math.sin(angle) * 5.7;
    fuelPump(root, x, z, -angle + Math.PI / 2, i % 2 === 0 ? C.fadedRed : C.fadedGreen);
    canopyLamp(root, Math.cos(angle) * 4.2, 5.0, Math.sin(angle) * 4.2);
  }
  stationCabin(root, 12.0, 7.2, 6.0, 5.2, C.fadedBlue, C.white);
  stationSign(root, -14.0, -8.0, 9.0, C.fadedRed);
  box(root, [32, 0.16, 22], [0, 0.08, 0], C.concrete);
}

function buildHighwayGas(root: THREE.Group): void {
  for (const laneX of [-5.2, 5.2]) {
    const canopy = box(root, [6.4, 0.3, 17.0], [laneX, 5.25, 0], laneX < 0 ? C.fadedBlue : C.fadedRed, [0, 0, 0], true, 'metal');
    const fascia = box(root, [6.4, 0.14, 0.8], [laneX, 5.5, -8.1], C.white, [0, 0, 0], true);
    canopy.castShadow = false;
    fascia.castShadow = false;
    const outerX = laneX + Math.sign(laneX) * 2.55;
    for (const z of [-7.2, 7.2]) box(root, [0.34, 5.1, 0.34], [outerX, 2.55, z], C.darkMetal);
    const pumpX = laneX + Math.sign(laneX) * 0.9;
    for (const [index, z] of [-4.5, 0, 4.5].entries()) {
      fuelPump(root, pumpX, z, laneX < 0 ? -Math.PI / 2 : Math.PI / 2, index === 1 ? C.fadedGreen : C.fadedRed);
      canopyLamp(root, laneX, 4.98, z);
    }
  }
  const shop = stationCabin(root, 12.0, 5.2, 7.0, 6.0, C.concreteLight, C.roofTin);
  shelf(shop, 2.0, 1.9, 3.0, Math.PI / 2, true);
  shelf(shop, -1.8, 2.2, 3.2, 0, true);
  box(root, [3.0, 2.2, 1.5], [11.8, 1.1, -5.8], C.fadedBlue, [0, 0, 0], false, 'metal');
  cylinder(root, 0.34, 0.34, 1.5, 12, [13.8, 0.75, -5.8], C.darkMetal, [Math.PI / 2, 0, 0]);
  stationSign(root, -15.0, 8.0, 10.5, C.fadedRed);
  box(root, [34, 0.16, 23], [0, 0.08, 0], C.concrete);
}

function buildStarterHome(root: THREE.Group): void {
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

  box(house, [8.0, 0.18, 2.0], [3.2, floorHeight + 0.06, -7.1], C.timber);
  for (const x of [-0.4, 1.4, 3.2, 5.0, 6.8]) box(house, [0.08, 1.0, 0.08], [x, floorHeight + 0.5, -8.0], C.darkTimber);
  box(house, [7.3, 0.08, 0.08], [3.2, floorHeight + 0.96, -8.0], C.darkTimber);
  box(house, [18.5, 0.18, 2.3], [0, 0.2, -7.6], C.timber);
  box(house, [18.5, 0.18, 2.7], [0, 3.0, -7.5], C.roofTin, [0.08, 0, 0], true);
  for (const x of [-7.8, -5.2, -2.6, 0, 2.6, 5.2, 7.8]) box(house, [0.14, 2.75, 0.14], [x, 1.5, -8.2], C.darkTimber);
  box(house, [1.3, 2.1, 0.45], [-7.65, 1.25, 3.8], C.brick);
  box(house, [1.5, 0.18, 0.7], [-7.65, 2.3, 3.8], C.darkTimber);
  box(house, [0.8, 2.6, 0.8], [-6.7, 7.8, 3.8], C.brick);

  const garage = new THREE.Group();
  garage.position.x = 8.68;
  root.add(garage);
  buildingShell(garage, {
    width: 9, depth: 10, height: 3.8, wall: C.concreteLight, roof: C.roofTin, flatRoof: true, wallPattern: 'blocks', roofPattern: 'metal',
    front: [[-3.5, 3.5, 0, 3.15]],
    back: [[-3.2, -1.3, 1.0, 2.4], [1.2, 3.2, 1.0, 2.4]],
    left: [[-1.0, 0.4, 0, 2.45]],
    right: [[-3.5, -1.5, 1.0, 2.4], [1.5, 3.5, 1.0, 2.4]],
  });
  counter(garage, 0, 3.8, 5.5, 0);
  shelf(garage, 3.6, 1.2, 4.5, Math.PI / 2, false);
  crate(garage, -3.5, 3.8, 0.2, 0.65);
  roomLights(garage, [[-2.2, 0], [2.2, 0]], 3.8, [4.38, 1.35, 0], Math.PI / 2);
  box(garage, [10.0, 0.22, 1.8], [0, 3.45, -5.6], C.roofTin, [-0.1, 0, 0], true);
}

function hullGeometry(length: number, width: number, height: number): THREE.BufferGeometry {
  const key = `hull:${length}:${width}:${height}`;
  const cached = geometryCache.get(key);
  if (cached) return cached;
  const stations = [
    [-length / 2, width * 0.08, height * 1.28, height * 0.42],
    [-length * 0.39, width * 0.43, height * 1.02, height * 0.08],
    [length * 0.28, width * 0.5, height, 0],
    [length * 0.46, width * 0.35, height * 1.12, height * 0.18],
    [length / 2, width * 0.07, height * 1.35, height * 0.55],
  ] as const;
  const vertices: number[] = [];
  for (const [x, half, top, bottom] of stations) {
    vertices.push(x, top, -half, x, top, half, x, bottom, half * 0.45, x, bottom, -half * 0.45);
  }
  const indices: number[] = [];
  for (let station = 0; station < stations.length - 1; station++) {
    const a = station * 4;
    const b = a + 4;
    for (let edge = 0; edge < 4; edge++) {
      const next = (edge + 1) % 4;
      indices.push(a + edge, b + edge, b + next, a + edge, b + next, a + next);
    }
  }
  indices.push(0, 1, 2, 0, 2, 3);
  const last = (stations.length - 1) * 4;
  indices.push(last, last + 2, last + 1, last, last + 3, last + 2);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometryCache.set(key, geometry);
  return geometry;
}

function hull(parent: THREE.Object3D, length: number, width: number, height: number, color: number): THREE.Mesh {
  const mesh = new THREE.Mesh(hullGeometry(length, width, height), material(color));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function torus(
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

function boatRailing(parent: THREE.Object3D, length: number, width: number, y: number): void {
  for (const side of [-1, 1]) {
    for (let x = -length / 2; x <= length / 2; x += 1.55) {
      box(parent, [0.055, 0.75, 0.055], [x, y + 0.37, side * width / 2], C.darkMetal);
    }
    box(parent, [length, 0.055, 0.055], [0, y + 0.72, side * width / 2], C.darkMetal);
  }
}

function buildTugboat(root: THREE.Group): void {
  const wreck = new THREE.Group();
  wreck.position.y = -1.15;
  wreck.rotation.set(0.025, -0.16, -0.075);
  root.add(wreck);
  hull(wreck, 16.2, 5.4, 2.1, C.rustDark);
  box(wreck, [11.2, 0.18, 4.15], [-0.25, 2.14, 0], C.darkMetal);
  box(wreck, [3.4, 0.22, 3.8], [-6.0, 2.42, 0], C.rust);
  boatRailing(wreck, 12.6, 4.45, 2.2);

  const cabin = new THREE.Group();
  cabin.position.set(-1.6, 2.23, 0);
  wreck.add(cabin);
  buildingShell(cabin, {
    width: 4.8, depth: 3.55, height: 2.5, wall: C.white, roof: C.fadedBlue, flatRoof: true,
    front: [[-0.7, 0.7, 0, 2.05]],
    back: [[-1.85, -0.65, 0.8, 1.85], [0.65, 1.85, 0.8, 1.85]],
    left: [[-1.05, 0.55, 0.78, 1.82]],
    right: [[-1.05, 0.55, 0.78, 1.82]],
  });
  counter(cabin, 0.8, 0.75, 1.5);
  roomLight(cabin, 0, 0, 2.5, [1.6, 1.2, -1.66], Math.PI);

  cylinder(wreck, 0.42, 0.5, 2.8, 12, [1.45, 4.05, 0.45], C.rust, [0, 0, -0.08]);
  cylinder(wreck, 0.16, 0.2, 5.4, 8, [-3.3, 6.4, 0], C.darkMetal, [0, 0, 0.035]);
  box(wreck, [3.2, 0.1, 0.1], [-2.2, 8.2, 0], C.darkMetal, [0, 0, -0.12]);
  for (const x of [2.2, 3.3]) {
    cylinder(wreck, 0.62, 0.62, 1.45, 14, [x, 2.75, 0], C.darkMetal, [Math.PI / 2, 0, 0]);
    cylinder(wreck, 0.2, 0.2, 1.8, 10, [x, 2.75, 0], C.rust, [Math.PI / 2, 0, 0]);
  }
  for (const x of [-5.0, -2.9, 0.1, 2.9, 5.2]) {
    torus(wreck, 0.52, 0.16, [x, 1.75, -2.52], C.darkMetal);
    torus(wreck, 0.52, 0.16, [x, 1.75, 2.52], C.darkMetal);
  }
  cylinder(wreck, 0.12, 0.12, 1.1, 8, [7.3, 0.95, 0], C.darkMetal, [0, 0, Math.PI / 2]);
  for (const angle of [0, Math.PI / 2]) box(wreck, [0.16, 1.45, 0.32], [7.9, 0.95, 0], C.rust, [angle, 0, 0.72]);
  barrel(wreck, 4.4, -0.8, C.rust, 0.16, 2.2);
  barrel(wreck, 5.05, 0.65, C.fadedBlue, -0.08, 2.2);
  box(root, [7.5, 0.55, 3.8], [4.2, 0.06, 0.3], C.sandDark, [0.02, -0.1, 0.06]);
}

function buildFishingWreck(root: THREE.Group): void {
  const wreck = new THREE.Group();
  wreck.position.y = -1.05;
  wreck.rotation.set(-0.045, 0.28, 0.12);
  root.add(wreck);
  hull(wreck, 12.8, 4.4, 1.8, C.fadedBlue);
  box(wreck, [8.7, 0.15, 3.25], [-0.3, 1.88, 0], C.timber);
  for (let x = -4.5; x <= 4.5; x += 1.5) {
    beamBetween(wreck, new THREE.Vector3(x, 1.9, -1.65), new THREE.Vector3(x, 2.65, -2.0), 0.09, C.darkTimber);
    beamBetween(wreck, new THREE.Vector3(x, 1.9, 1.65), new THREE.Vector3(x, 2.65, 2.0), 0.09, C.darkTimber);
    box(wreck, [0.09, 0.09, 3.4], [x, 1.96, 0], C.darkTimber);
  }
  boatRailing(wreck, 8.8, 3.7, 2.05);

  const wheelhouse = new THREE.Group();
  wheelhouse.position.set(-2.65, 2.0, 0);
  wreck.add(wheelhouse);
  buildingShell(wheelhouse, {
    width: 3.0, depth: 2.75, height: 1.95, wall: C.plasterBlue, roof: C.roofTin, flatRoof: true,
    front: [[-0.55, 0.55, 0, 1.65]],
    back: [[-1.1, -0.2, 0.65, 1.5], [0.2, 1.1, 0.65, 1.5]],
    left: [[-0.7, 0.45, 0.65, 1.5]],
    right: [[-0.7, 0.45, 0.65, 1.5]],
  });
  cylinder(wreck, 0.13, 0.17, 6.0, 8, [-0.9, 5.0, 0], C.darkTimber, [0, 0, 0.14]);
  beamBetween(wreck, new THREE.Vector3(-0.5, 6.85, 0), new THREE.Vector3(4.4, 4.55, 0), 0.12, C.darkTimber);
  for (const z of [-1.4, 1.4]) {
    beamBetween(wreck, new THREE.Vector3(-0.8, 6.6, 0), new THREE.Vector3(4.1, 2.15, z), 0.035, C.darkMetal);
  }
  cylinder(wreck, 0.4, 0.4, 1.25, 12, [3.25, 2.35, 0], C.rust, [Math.PI / 2, 0, 0]);
  torus(wreck, 0.42, 0.09, [-2.7, 3.05, -1.5], C.white);
  crate(wreck, 2.1, 0.75, 0.35, 0.58, 2.02);
  crate(wreck, 3.0, -0.7, -0.2, 0.48, 2.02);
  box(root, [6.5, 0.48, 3.2], [2.8, 0.02, -0.1], C.sandDark, [0.04, 0.22, -0.04]);
}

function planformGeometry(points: readonly (readonly [number, number])[], thickness: number): THREE.BufferGeometry {
  const key = `planform:${points.map((point) => point.join(',')).join(';')}:${thickness}`;
  const cached = geometryCache.get(key);
  if (cached) return cached;
  const vertices: number[] = [];
  for (const y of [-thickness / 2, thickness / 2]) {
    for (const [x, z] of points) vertices.push(x, y, z);
  }
  const count = points.length;
  const indices: number[] = [];
  for (let i = 1; i < count - 1; i++) {
    indices.push(0, i + 1, i, count, count + i, count + i + 1);
  }
  for (let i = 0; i < count; i++) {
    const next = (i + 1) % count;
    indices.push(i, next, count + next, i, count + next, count + i);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometryCache.set(key, geometry);
  return geometry;
}

function planform(
  parent: THREE.Object3D,
  points: readonly (readonly [number, number])[],
  thickness: number,
  position: V3,
  color: number,
  rotation: V3 = [0, 0, 0],
): THREE.Mesh {
  const mesh = new THREE.Mesh(planformGeometry(points, thickness), material(color));
  mesh.position.set(position[0], position[1], position[2]);
  mesh.rotation.set(rotation[0], rotation[1], rotation[2]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function aircraftWing(parent: THREE.Object3D, y: number, color: number, damaged = false): void {
  const span = damaged ? 7.8 : 11.2;
  const chord = damaged ? 2.8 : 3.5;
  const rightWing = planform(
    parent,
    [[-chord, 0], [-2.2, 2.2], [-0.55, span], [1.05, span], [2.25, 2.2], [chord * 0.85, 0]],
    0.46,
    [0, y, 0],
    color,
    [0.015, 0, -0.012],
  );
  const leftWing = planform(
    parent,
    [[-chord, 0], [-2.2, -2.2], [-0.55, -span], [1.05, -span], [2.25, -2.2], [chord * 0.85, 0]],
    0.46,
    [0, y, 0],
    color,
    [-0.015, 0, 0.012],
  );
  rightWing.userData.poiAircraftMainWing = true;
  leftWing.userData.poiAircraftMainWing = true;
}

function propeller(parent: THREE.Object3D, x: number, y: number, z: number, broken = false): void {
  cylinder(parent, 0.24, 0.34, 0.72, 12, [x, y, z], C.darkMetal, [0, 0, Math.PI / 2]);
  const blade = broken ? 1.2 : 2.05;
  box(parent, [0.1, blade * 2, 0.22], [x - 0.4, y, z], C.darkMetal, [0.25, 0, 0.18]);
  if (!broken) box(parent, [0.1, 0.22, blade * 2], [x - 0.41, y, z], C.darkMetal, [0, 0.15, 0]);
}

function aircraftWindows(
  parent: THREE.Object3D,
  fromX: number,
  count: number,
  spacing = 1.28,
  y = 2.4,
  sideZ = 1.64,
): void {
  for (let i = 0; i < count; i++) {
    const x = fromX + i * spacing;
    for (const side of [-1, 1]) {
      const glass = cylinder(parent, 0.28, 0.28, 0.075, 16, [x, y, side * sideZ], C.darkMetal, [Math.PI / 2, 0, 0]);
      glass.userData.poiAircraftWindow = true;
      torus(parent, 0.31, 0.045, [x, y, side * (sideZ + 0.035)], C.metal);
    }
  }
}

function ellipsoid(parent: THREE.Object3D, position: V3, radii: V3, color: number): THREE.Mesh {
  const key = 'aircraft-ellipsoid:24:16';
  let geometry = geometryCache.get(key);
  if (!geometry) {
    geometry = new THREE.SphereGeometry(1, 24, 16);
    geometryCache.set(key, geometry);
  }
  const mesh = new THREE.Mesh(geometry, material(color));
  mesh.position.set(position[0], position[1], position[2]);
  mesh.scale.set(radii[0], radii[1], radii[2]);
  mesh.userData.poiAircraftRoundedNose = true;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function cockpitPoint(radii: V3, pitch: number, yaw: number): THREE.Vector3 {
  const ring = Math.cos(pitch);
  return new THREE.Vector3(
    -radii[0] * ring * Math.cos(yaw),
    radii[1] * Math.sin(pitch),
    radii[2] * ring * Math.sin(yaw),
  );
}

function cockpitPaneGeometry(radii: V3, yawStart: number, yawEnd: number): THREE.BufferGeometry {
  const key = `cockpit-pane:${radii.join(':')}:${yawStart}:${yawEnd}`;
  const cached = geometryCache.get(key);
  if (cached) return cached;
  const columns = 5;
  const rows = 4;
  const vertices: number[] = [];
  for (let row = 0; row <= rows; row++) {
    const pitch = THREE.MathUtils.lerp(0.18, 0.72, row / rows);
    for (let column = 0; column <= columns; column++) {
      const yaw = THREE.MathUtils.lerp(yawStart, yawEnd, column / columns);
      const point = cockpitPoint(radii, pitch, yaw);
      vertices.push(point.x, point.y, point.z);
    }
  }
  const indices: number[] = [];
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const a = row * (columns + 1) + column;
      const b = a + 1;
      const c = a + columns + 1;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometryCache.set(key, geometry);
  return geometry;
}

function aircraftCockpit(parent: THREE.Object3D, center: V3, noseRadii: V3): void {
  const paneRadii: V3 = [noseRadii[0] + 0.025, noseRadii[1] + 0.025, noseRadii[2] + 0.025];
  const glassMaterial = material(C.fadedBlue).clone();
  glassMaterial.side = THREE.DoubleSide;
  for (const [yawStart, yawEnd] of [[-1.0, -0.07], [0.07, 1.0]] as const) {
    const pane = new THREE.Mesh(cockpitPaneGeometry(paneRadii, yawStart, yawEnd), glassMaterial);
    pane.position.set(center[0], center[1], center[2]);
    pane.userData.poiAircraftCockpitWindow = true;
    parent.add(pane);
  }
  for (const yaw of [-1.02, 0, 1.02]) {
    const bottom = cockpitPoint(paneRadii, 0.18, yaw).add(new THREE.Vector3(...center));
    const top = cockpitPoint(paneRadii, 0.72, yaw).add(new THREE.Vector3(...center));
    beamBetween(parent, bottom, top, 0.065, C.metal);
  }
}


function buildPlaneFuselage(root: THREE.Group): void {
  const wreck = new THREE.Group();
  wreck.rotation.set(0.018, 0.1, -0.025);
  wreck.position.y = -0.28;
  wreck.userData.poiAircraftCabinHeight = 3.4;
  wreck.userData.poiBuriedInSand = true;
  root.add(wreck);

  const noseCenter: V3 = [-8.2, 1.9, 0];
  const noseRadii: V3 = [2.6, 1.7, 1.7];
  cylinder(wreck, 1.7, 1.7, 15.8, 24, [-0.3, 1.9, 0], C.white, [0, 0, Math.PI / 2]);
  ellipsoid(wreck, noseCenter, noseRadii, C.white);
  cylinder(wreck, 1.68, 0.62, 5.2, 24, [10.2, 1.9, 0], C.white, [0, 0, Math.PI / 2]);
  aircraftWing(wreck, 1.72, C.white);

  planform(wreck, [[-1.8, 0], [-0.1, 4.4], [1.2, 4.4], [1.8, 0], [1.2, -4.4], [-0.1, -4.4]], 0.2, [10.0, 2.2, 0], C.fadedRed, [0, 0, 0.04]);
  const fin = new THREE.Mesh(gableGeometry(4.2, 3.8, 0.2), material(C.fadedRed));
  fin.position.set(10.2, 2.15, 0);
  fin.rotation.z = -0.12;
  fin.castShadow = true;
  wreck.add(fin);

  for (const z of [-5.4, 5.4]) {
    cylinder(wreck, 0.96, 0.78, 3.2, 18, [-1.6, 1.35, z], C.rustDark, [0, 0, Math.PI / 2]);
    propeller(wreck, -3.25, 1.35, z, z > 0);
  }
  aircraftWindows(wreck, -5.7, 8);
  aircraftCockpit(wreck, noseCenter, noseRadii);

  for (const [x, z, tilt] of [[-2.0, -3.0, -0.2], [1.2, 3.2, 0.3], [6.0, -1.2, 0.5]] as const) {
    beamBetween(wreck, new THREE.Vector3(x, 1.05, z), new THREE.Vector3(x + tilt, 0.05, z + 0.28), 0.12, C.darkMetal);
    torus(wreck, 0.36, 0.13, [x + tilt, 0.14, z + 0.28], C.darkMetal, [Math.PI / 2, 0, 0]);
  }
}

function buildBrokenPlane(root: THREE.Group): void {
  const nose = new THREE.Group();
  nose.position.set(-5.0, -0.15, 1.8);
  nose.rotation.set(0.07, -0.22, 0.09);
  nose.userData.poiAircraftCabinHeight = 3.4;
  nose.userData.poiBuriedInSand = true;
  root.add(nose);
  const noseCenter: V3 = [-4.75, 1.85, 0];
  const noseRadii: V3 = [2.6, 1.7, 1.7];
  cylinder(nose, 1.7, 1.7, 9.5, 22, [0, 1.85, 0], C.white, [0, 0, Math.PI / 2]);
  ellipsoid(nose, noseCenter, noseRadii, C.white);
  aircraftWing(nose, 1.68, C.white, true);
  aircraftWindows(nose, -2.7, 5);
  aircraftCockpit(nose, noseCenter, noseRadii);

  const tail = new THREE.Group();
  tail.position.set(8.5, -0.12, -3.2);
  tail.rotation.set(-0.06, 0.42, -0.14);
  root.add(tail);
  cylinder(tail, 1.62, 0.58, 6.4, 18, [0, 1.7, 0], C.metal, [0, 0, Math.PI / 2]);
  planform(tail, [[-1.5, 0], [-0.1, 4.0], [1.1, 3.8], [1.7, 0], [1.1, -3.8], [-0.1, -4.0]], 0.18, [2.1, 2.0, 0], C.fadedRed, [0.05, 0, 0.08]);
  const fin = new THREE.Mesh(gableGeometry(3.8, 3.4, 0.18), material(C.fadedRed));
  fin.position.set(2.1, 1.95, 0);
  fin.rotation.z = -0.22;
  fin.castShadow = true;
  tail.add(fin);

  const detachedWing = new THREE.Group();
  detachedWing.position.set(3.0, -0.35, 6.5);
  detachedWing.rotation.set(0.08, -0.38, -0.08);
  root.add(detachedWing);
  planform(detachedWing, [[-3.4, 0], [-0.3, 8.8], [1.4, 8.1], [2.8, 0]], 0.46, [0, 0.5, 0], C.white);
  cylinder(root, 0.95, 0.78, 3.0, 18, [2.8, 0.95, 2.2], C.rustDark, [0.2, 0.45, Math.PI / 2]);
  propeller(root, 1.25, 1.0, 1.8, true);
  for (let i = 0; i < 7; i++) {
    box(root, [0.1, 0.1, 1.4 + i * 0.22], [-0.2 + i * 0.55, 0.4 + i * 0.07, -0.5 + i * 0.25], C.darkMetal, [0.2 * i, 0.35, 0.5 - i * 0.06]);
  }
}

function beamBetween(parent: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, width: number, color: number): void {
  const direction = new THREE.Vector3().subVectors(b, a);
  const mesh = box(parent, [width, direction.length(), width], [(a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2], color);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
}

function latticeTower(parent: THREE.Object3D, height: number, color: number = C.rust, fallen = false): THREE.Group {
  const tower = new THREE.Group();
  if (fallen) {
    tower.position.set(height / 2, 1.1, 0);
    tower.rotation.z = Math.PI / 2 - 0.055;
  }
  parent.add(tower);
  const levels = Math.max(6, Math.round(height / 2.5));
  for (let level = 0; level < levels; level++) {
    const y0 = level * height / levels;
    const y1 = (level + 1) * height / levels;
    const half0 = 1.85 * (1 - y0 / height * 0.76);
    const half1 = 1.85 * (1 - y1 / height * 0.76);
    const corners0 = [[-half0, y0, -half0], [half0, y0, -half0], [half0, y0, half0], [-half0, y0, half0]].map(([x, y, z]) => new THREE.Vector3(x, y, z));
    const corners1 = [[-half1, y1, -half1], [half1, y1, -half1], [half1, y1, half1], [-half1, y1, half1]].map(([x, y, z]) => new THREE.Vector3(x, y, z));
    for (let i = 0; i < 4; i++) {
      const next = (i + 1) % 4;
      beamBetween(tower, corners0[i], corners1[i], 0.13, color);
      beamBetween(tower, corners0[i], corners0[next], 0.1, C.darkMetal);
      beamBetween(tower, corners0[i], corners1[next], 0.07, color);
      beamBetween(tower, corners0[next], corners1[i], 0.055, C.rustDark);
    }
    box(tower, [0.72, 0.055, 0.18], [0, (y0 + y1) / 2, -half0], C.darkMetal);
  }
  return tower;
}

function antennaDish(
  parent: THREE.Object3D,
  position: V3,
  yaw: number,
  radius: number,
  color: number = C.white,
): void {
  const dish = new THREE.Group();
  dish.position.set(position[0], position[1], position[2]);
  dish.rotation.y = yaw;
  parent.add(dish);
  cylinder(dish, 0.08, radius, 0.28, 18, [0, 0, 0], color, [Math.PI / 2, 0, 0]);
  beamBetween(dish, new THREE.Vector3(0, 0, -0.1), new THREE.Vector3(0, 0, -0.75), 0.045, C.darkMetal);
  cylinder(dish, 0.08, 0.08, 0.12, 8, [0, 0, -0.8], C.darkMetal, [Math.PI / 2, 0, 0]);
}

function guyWires(parent: THREE.Object3D, height: number, radius: number): void {
  for (let i = 0; i < 4; i++) {
    const angle = i * Math.PI / 2 + Math.PI / 4;
    const anchor = new THREE.Vector3(Math.cos(angle) * radius, 0.12, Math.sin(angle) * radius);
    beamBetween(parent, new THREE.Vector3(0, height * 0.72, 0), anchor, 0.026, C.darkMetal);
    beamBetween(parent, new THREE.Vector3(0, height * 0.94, 0), anchor.clone().multiplyScalar(0.72), 0.022, C.darkMetal);
    cylinder(parent, 0.13, 0.18, 0.28, 8, [anchor.x, 0.14, anchor.z], C.concrete);
  }
}

function buildStandingTower(root: THREE.Group): void {
  const height = 31;
  const tower = latticeTower(root, height);
  cylinder(tower, 0.08, 0.11, 5.2, 8, [0, height + 2.5, 0], C.darkMetal);
  for (const y of [20.5, 25.2, 29.5]) {
    for (let side = 0; side < 4; side++) {
      const angle = side * Math.PI / 2;
      box(tower, [0.82, 1.75, 0.13], [Math.cos(angle) * 0.62, y, Math.sin(angle) * 0.62], C.white, [0, -angle, 0.06]);
    }
  }
  antennaDish(tower, [0.65, 16.5, 0], Math.PI / 2, 1.0);
  antennaDish(tower, [-0.55, 23.1, 0], -Math.PI / 2, 0.78, C.concreteLight);
  for (const y of [10, 20, 28]) box(tower, [3.2 - y * 0.065, 0.1, 3.2 - y * 0.065], [0, y, 0], C.darkMetal);
  cylinder(tower, 0.16, 0.16, 0.28, 10, [0, height + 5.12, 0], C.fadedRed);
  box(root, [5.2, 0.18, 5.2], [0, 0.09, 0], C.concrete);
  box(root, [2.1, 1.5, 1.35], [3.5, 0.75, 2.0], C.fadedGreen);
  for (let i = 0; i < 4; i++) box(root, [0.09, 0.09, 4.3], [-1.1 + i * 0.72, 0.45 + i * 0.05, 3.2], C.darkMetal, [0, 0, -0.05]);
}

function buildFallenTower(root: THREE.Group): void {
  const height = 29;
  const tower = latticeTower(root, height, C.rust, true);
  antennaDish(tower, [0.7, 19, 0], Math.PI / 2, 0.9, C.concreteLight);
  antennaDish(tower, [-0.55, 25, 0], -Math.PI / 2, 0.72, C.white);
  for (const y of [21, 24, 27]) box(tower, [0.82, 1.7, 0.13], [0.55, y, 0], C.white, [0, 0, 0.08]);
  box(root, [4.8, 0.24, 4.8], [height / 2, 0.12, 0], C.concrete);
  box(root, [2.0, 1.2, 1.35], [-11.5, 0.62, -2.2], C.rustDark, [0, 0.3, -0.18]);
  for (let i = 0; i < 4; i++) box(root, [0.85, 1.5, 0.12], [-8.0 + i * 1.1, 0.5 + i * 0.14, 1.2 + i * 0.45], C.white, [0.2 * i, 0.4, 1.25 - i * 0.18]);
}

function buildRelayCluster(root: THREE.Group): void {
  for (const [x, z, height, yaw] of [[-4.2, -2.0, 20, 0.2], [0.2, 2.6, 26, 2.4], [4.4, -1.4, 17, 4.2]] as const) {
    const mast = new THREE.Group();
    mast.position.set(x, 0, z);
    root.add(mast);
    cylinder(mast, 0.1, 0.18, height, 8, [0, height / 2, 0], C.darkMetal);
    for (let i = 0; i < 6; i++) {
      const y = height * (0.42 + i * 0.09);
      box(mast, [1.6, 0.08, 0.08], [0, y, 0], C.rust, [0, yaw + i * 0.7, 0]);
      box(mast, [0.7, 1.35, 0.11], [0.5, y, 0], i % 2 === 0 ? C.white : C.concreteLight, [0, yaw, 0.04]);
    }
    antennaDish(mast, [0.48, height * 0.68, 0], yaw, 0.72);
    cylinder(mast, 0.12, 0.12, 0.25, 9, [0, height + 0.12, 0], C.fadedRed);
    guyWires(mast, height, 4.4);
  }
  const hut = new THREE.Group();
  hut.position.set(-9.0, 0, 6.0);
  root.add(hut);
  buildingShell(hut, {
    width: 4.2, depth: 3.0, height: 2.4, wall: C.concreteLight, roof: C.roofTin, flatRoof: true,
    front: [[-0.6, 0.6, 0, 2.05]],
    back: [[-1.5, -0.4, 0.8, 1.75]],
    left: [],
    right: [[-0.7, 0.55, 0.8, 1.75]],
  });
  shelf(hut, -1.4, 0.6, 1.5, Math.PI / 2, false);
  roomLight(hut, 0, 0, 2.4, [0.9, 1.2, -1.38], Math.PI);
  box(root, [2.4, 1.55, 1.35], [9.0, 0.78, 6.0], C.fadedGreen);
  cylinder(root, 0.34, 0.34, 1.4, 10, [10.5, 0.7, 6.0], C.darkMetal, [Math.PI / 2, 0, 0]);
  for (let i = 0; i < 5; i++) box(root, [0.1, 0.1, 7.2], [-5.5 + i * 2.7, 0.08, 0.5], C.darkMetal, [0, 0.12 * i, 0]);
  barrel(root, 9.5, 4.5, C.rust);
}

function shippingContainer(parent: THREE.Object3D, color: number, open = true): THREE.Group {
  const group = new THREE.Group();
  parent.add(group);
  const w = 2.45;
  const h = 2.6;
  const d = 6.05;
  box(group, [w, 0.13, d], [0, 0.065, 0], C.darkMetal);
  box(group, [w, 0.13, d], [0, h, 0], color, [0, 0, 0], true);
  box(group, [0.12, h, d], [-w / 2, h / 2, 0], color);
  box(group, [0.12, h, d], [w / 2, h / 2, 0], color);
  box(group, [w, h, 0.12], [0, h / 2, d / 2], color);
  if (!open) box(group, [w, h, 0.12], [0, h / 2, -d / 2], color);
  for (let i = -4; i <= 4; i++) {
    const z = i * 0.58;
    box(group, [0.08, h - 0.22, 0.07], [-w / 2 - 0.065, h / 2, z], C.rustDark);
    box(group, [0.08, h - 0.22, 0.07], [w / 2 + 0.065, h / 2, z], C.rustDark);
  }
  for (const x of [-w / 2, w / 2]) for (const z of [-d / 2, d / 2]) box(group, [0.16, h + 0.08, 0.16], [x, h / 2, z], C.darkMetal);
  return group;
}

function buildOpenContainer(root: THREE.Group): void {
  const container = shippingContainer(root, C.fadedBlue, true);
  container.rotation.y = 0.08;
  crate(container, -0.45, 1.25, 0.3, 0.58);
  crate(container, 0.48, 1.7, -0.2, 0.52);
  barrel(container, 0.35, 2.55, C.rust);
}

function buildContainerStack(root: THREE.Group): void {
  const first = shippingContainer(root, C.fadedRed, true);
  first.position.set(-2.0, 0, -1.0);
  first.rotation.y = -0.08;
  const second = shippingContainer(root, C.fadedGreen, false);
  second.position.set(2.1, 0, 1.1);
  second.rotation.y = 0.12;
  const top = shippingContainer(root, C.ochre, true);
  top.position.set(0.25, 2.72, 0.4);
  top.rotation.set(0, 0.04, -0.035);
  crate(root, -4.0, 2.8, 0.3);
  barrel(root, 4.0, -2.0, C.fadedBlue, 0.08);
}

function buildBuriedContainer(root: THREE.Group): void {
  const container = shippingContainer(root, C.rust, true);
  container.position.set(0, -0.72, 0.45);
  container.rotation.set(0.03, -0.18, -0.06);
  box(root, [5.7, 0.7, 4.0], [-0.4, 0.05, 2.1], C.sandDark, [0.02, -0.12, 0.06]);
  box(root, [5.0, 0.5, 3.0], [0.7, -0.05, -1.9], C.sandDark, [-0.04, 0.15, -0.04]);
  bed(container, 0.25, 0.9, 0, C.fabric);
  shelf(container, -0.82, 1.8, 1.5, Math.PI / 2, false);
  box(root, [4.8, 0.16, 2.0], [0, 1.95, -3.6], C.roofTin, [-0.13, -0.18, 0], true);
  for (const x of [-1.8, 1.8]) box(root, [0.13, 2.0, 0.13], [x, 0.95, -3.1], C.darkTimber, [0.08, 0, x * 0.02]);
}

function validateDoorClearances(root: THREE.Group): void {
  root.updateMatrixWorld(true);
  const clearances: DoorClearance[] = [];
  const windowClearances: DoorClearance[] = [];
  root.traverse((owner) => {
    const local = owner.userData.poiDoorClearances as DoorClearance[] | undefined;
    for (const clearance of local ?? []) {
      clearances.push({
        box: clearance.box.clone().applyMatrix4(owner.matrixWorld),
        label: clearance.label,
      });
    }
    const localWindows = owner.userData.poiWindowClearances as DoorClearance[] | undefined;
    for (const clearance of localWindows ?? []) {
      windowClearances.push({
        box: clearance.box.clone().applyMatrix4(owner.matrixWorld),
        label: clearance.label,
      });
    }
  });
  root.traverse((object) => {
    const obstacle = object.userData.poiDoorObstacle;
    if (typeof obstacle !== 'string') return;
    const bounds = new THREE.Box3().setFromObject(object);
    const blocked = clearances.find((clearance) => clearance.box.intersectsBox(bounds));
    if (blocked) {
      throw new Error(`${root.name}: ${obstacle} blocks ${blocked.label}`);
    }
    if (obstacle === 'light switch') {
      const window = windowClearances.find((clearance) => clearance.box.intersectsBox(bounds));
      if (window) throw new Error(`${root.name}: light switch overlaps ${window.label}`);
    }
  });
}

/**
 * Collapses a prototype's static meshes into one mesh per material.
 *
 * A prototype is 100-250 individually positioned boxes and cylinders, and every
 * one of them is a draw call in both the shadow and the colour pass. Twenty-six of
 * them at once measured 4020 calls a frame — ~30 ms of pure command submission on
 * an Intel N100, with only 82k triangles behind it. Materials and geometries are
 * already shared through the caches above, so baking each group's world matrices
 * into a single buffer costs nothing visually and cuts the call count by ~10x.
 *
 * Meshes that must keep their identity are left alone: roof panels (the viewer
 * hides them), light switches (raycast targets carrying the toggle closure), door
 * obstacles (clearance metadata) and anything with a one-off material, such as the
 * bulbs whose emissive intensity follows their switch.
 *
 * Call it on a finished root, before it is positioned in the world.
 */
export function mergePoiStatics(root: THREE.Group): void {
  root.updateMatrixWorld(true);
  const groups = new Map<THREE.Material, THREE.Mesh[]>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    if (object.userData.poiRoof === true) return;
    if (typeof object.userData.poiLightToggle === 'function') return;
    if (typeof object.userData.poiDoorObstacle === 'string') return;
    if (Array.isArray(object.material)) return;
    const group = groups.get(object.material);
    if (group) group.push(object);
    else groups.set(object.material, [object]);
  });
  for (const [material, meshes] of groups) {
    if (meshes.length < 2) continue;
    const indexed = meshes.every((mesh) => mesh.geometry.index !== null);
    const parts: THREE.BufferGeometry[] = [];
    for (const mesh of meshes) {
      let geometry = mesh.geometry.clone();
      for (const name of Object.keys(geometry.attributes)) {
        if (name !== 'position' && name !== 'normal' && name !== 'uv') geometry.deleteAttribute(name);
      }
      if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
      const position = geometry.getAttribute('position');
      if (!geometry.getAttribute('uv')) {
        geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(position.count * 2), 2));
      }
      if (!indexed && geometry.index) geometry = geometry.toNonIndexed();
      geometry.applyMatrix4(mesh.matrixWorld);
      parts.push(geometry);
    }
    const merged = mergeGeometries(parts, false);
    for (const part of parts) part.dispose();
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
    for (const original of meshes) original.removeFromParent();
  }
}

export const POI_VARIANTS: readonly PoiVariantDefinition[] = [
  { id: 'two-room-cottage', name: 'Двухкомнатный домик', category: 'house', footprint: [8.5, 6.5], build: buildCottage },
  { id: 'porch-house', name: 'Дом с верандой', category: 'house', footprint: [11.2, 9.2], build: buildPorchHouse },
  { id: 'long-house', name: 'Длинный трёхкомнатный дом', category: 'house', footprint: [12.5, 5.8], build: buildLongHouse },
  { id: 'spacious-veranda-house', name: 'Просторный дом с верандой', category: 'house', footprint: [20, 15], build: buildCourtyardHouse },
  { id: 'two-storey-country-house', name: 'Просторный двухэтажный дом', category: 'house', footprint: [18, 16], build: buildWorkshopHome },
  { id: 'road-kiosk', name: 'Придорожный киоск', category: 'shop', footprint: [5.8, 5.3], build: buildKiosk },
  { id: 'road-cafe', name: 'Небольшое кафе', category: 'shop', footprint: [10.5, 8.2], build: buildRoadCafe },
  { id: 'general-store', name: 'Сельский магазин', category: 'shop', footprint: [12, 9], build: buildGeneralStore },
  { id: 'large-village-market', name: 'Большой сельский универсам', category: 'shop', footprint: [27, 20], build: buildMarket },
  { id: 'parts-warehouse-store', name: 'Большой магазин-склад автозапчастей', category: 'shop', footprint: [30, 22], build: buildAutoPartsStore },
  { id: 'tugboat-wreck', name: 'Остов буксира', category: 'wreck', footprint: [18, 9], build: buildTugboat },
  { id: 'fishing-boat-wreck', name: 'Рыбацкий кораблик', category: 'wreck', footprint: [14, 9], build: buildFishingWreck },
  { id: 'plane-fuselage', name: 'Крупный разбитый самолёт', category: 'wreck', footprint: [27, 24], build: buildPlaneFuselage },
  { id: 'scattered-plane', name: 'Крупные обломки самолёта', category: 'wreck', footprint: [34, 28], build: buildBrokenPlane },
  { id: 'standing-tower', name: 'Стоящая вышка', category: 'tower', footprint: [10, 10], build: buildStandingTower },
  { id: 'fallen-tower', name: 'Упавшая вышка', category: 'tower', footprint: [32, 10], build: buildFallenTower },
  { id: 'relay-cluster', name: 'Узел связи', category: 'tower', footprint: [23, 16], build: buildRelayCluster },
  { id: 'open-container', name: 'Открытый контейнер', category: 'container', footprint: [5, 8], build: buildOpenContainer },
  { id: 'container-stack', name: 'Склад контейнеров', category: 'container', footprint: [12, 10], build: buildContainerStack },
  { id: 'buried-container', name: 'Занесённое убежище', category: 'container', footprint: [10, 10], build: buildBuriedContainer },
  { id: 'mushroom-gas-station', name: 'АЗС с навесами-грибками', category: 'gas', footprint: [30, 20], build: buildMushroomGas },
  { id: 'butterfly-gas-station', name: 'АЗС «Крыло»', category: 'gas', footprint: [30, 19], build: buildButterflyGas },
  { id: 'pavilion-gas-station', name: 'АЗС-павильон 1950-х', category: 'gas', footprint: [30, 19], build: buildPavilionGas },
  { id: 'ufo-gas-station', name: 'Футуристическая АЗС', category: 'gas', footprint: [32, 22], build: buildUfoGas },
  { id: 'highway-gas-station', name: 'Двухпоточная трассовая АЗС', category: 'gas', footprint: [35, 23], build: buildHighwayGas },
  { id: 'starter-homestead', name: 'Стартовый двухэтажный дом', category: 'house', footprint: [29, 19], build: buildStarterHome },
];

export function createPoiVariant(index: number): THREE.Group {
  const definition = POI_VARIANTS[index];
  if (!definition) throw new RangeError(`Unknown POI variant ${index + 1}`);
  const root = new THREE.Group();
  root.name = `poi-${String(index + 1).padStart(2, '0')}-${definition.id}`;
  root.userData.poiVariant = definition.id;
  definition.build(root);
  validateDoorClearances(root);
  return root;
}
