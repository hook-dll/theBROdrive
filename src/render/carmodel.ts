/**
 * Loads complete car models (see vehicle/carmodels.ts).
 *
 * The GLB remains authoritative for visuals. A small generated fit manifest carries
 * only the geometry metadata needed by physics and POI placement before a model is
 * resident; the actual scene is loaded lazily and cloned per instance.
 *
 * Everything a caller gets is in CHASSIS-LOCAL metres: the origin is the centre of
 * the chassis box, which is what Rapier's rigid body and render group both use.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import {
  makeCarBodyConditionMaterial,
  makeCarPaintFinishMaterial,
  makeCarPalettePaintMaterial,
  setCarBodyPalettePaint,
  setConditionFieldOrigin,
} from './materials';
import {
  CAR_MODELS,
  carModel,
  type CarModelDef,
  type CarModelFit,
  type GizmoAnchorDef,
} from '../vehicle/carmodels';

/** The four wheels the vehicle controller drives, in the order it expects them. */
const WHEEL_IDS = ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr'] as const;
type WheelId = (typeof WHEEL_IDS)[number];

/**
 * Node names for a model whose wheels are found by SHAPE. `renameDetectedWheels`
 * writes these, so a detected pack and a pack that names its own wheels reach
 * `takeOwnWheels` looking identical.
 */
const DETECTED_WHEEL_NODES: Readonly<Record<WheelId, readonly string[]>> = {
  wheel_fl: ['wheel-front-left'],
  wheel_fr: ['wheel-front-right'],
  wheel_rl: ['wheel-back-left'],
  wheel_rr: ['wheel-back-right'],
};

/**
 * Finds a model's four wheels by SHAPE rather than by name, and renames them to the
 * convention above.
 *
 * Packs authored outside a game engine name their wheels whatever the modeller
 * felt like — `Wheel_1..4`, `Cylinder006`, `Brake003` — so matching names does not
 * scale past one pack. A wheel is instead recognised by being a squat disc (its
 * extent across the axle much smaller than its diameter, and near-circular in the
 * other two axes) and is then assigned to a corner by the sign of its centre:
 * +X is left (the models face +Z), +Z is front.
 *
 * Returns false when the model does not yield exactly four, which is a hard error
 * for the caller: half-wheeling a car is worse than refusing to load it. A pack
 * that names its wheels consistently sets `wheelNodes` and skips this entirely.
 */
function renameDetectedWheels(scene: THREE.Group): boolean {
  const candidates: { node: THREE.Object3D; centre: THREE.Vector3 }[] = [];
  for (const node of scene.children) {
    const box = boundsOf(node);
    const sx = box.max.x - box.min.x;
    const sy = box.max.y - box.min.y;
    const sz = box.max.z - box.min.z;
    if (sy <= 0 || sz <= 0) continue;
    const roundness = Math.min(sy, sz) / Math.max(sy, sz);
    if (roundness < 0.85) continue; // not a disc seen side-on
    if (sx > Math.min(sy, sz) * 0.9) continue; // too fat across the axle to be a tyre
    candidates.push({ node, centre: box.getCenter(new THREE.Vector3()) });
  }
  if (candidates.length < 4) return false;

  // With more than four discs (brake drums, spare wheels, exhaust cans) keep the
  // four largest: on any car the road wheels are the biggest discs it has.
  candidates.sort((a, b) => {
    const size = (c: typeof a): number => {
      const box = boundsOf(c.node);
      return box.max.y - box.min.y;
    };
    return size(b) - size(a);
  });
  const wheels = candidates.slice(0, 4);

  const named = new Set<string>();
  for (const wheel of wheels) {
    const side = wheel.centre.x > 0 ? 'left' : 'right';
    const end = wheel.centre.z > 0 ? 'front' : 'back';
    const name = `wheel-${end}-${side}`;
    if (named.has(name)) return false; // two wheels in one corner: not a car layout
    named.add(name);
    wheel.node.name = name;
  }
  return named.size === 4;
}

export interface WheelMeasure {
  /** 'wheel_fl' | 'wheel_fr' | 'wheel_rl' | 'wheel_rr'. */
  readonly id: string;
  /** Suspension mount, chassis-local metres. */
  readonly pos: readonly [number, number, number];
  /** Rolling radius, metres, from the wheel's own bounds. */
  readonly radius: number;
  readonly isFront: boolean;
}

export interface GizmoAnchor {
  readonly id: string;
  readonly label: string;
  /** Chassis-local metres. */
  readonly pos: readonly [number, number, number];
  readonly yaw: number;
}

export interface CarModelMeasure {
  /** Chassis box half-extents, metres. */
  readonly halfExtents: readonly [number, number, number];
  readonly wheels: readonly WheelMeasure[];
  readonly anchors: readonly GizmoAnchor[];
  /** Bonnet camera mount in chassis-local metres, measured off the bodywork. */
  readonly hoodPoint: readonly [number, number, number];
  /** Where the model's own origin sits inside the chassis group. */
  readonly visualOffset: readonly [number, number, number];
}

interface Template {
  readonly def: CarModelDef;
  readonly measure: CarModelMeasure;
  /** Body-and-trim subtree, already scaled and offset. Cloned per instance. */
  readonly body: THREE.Object3D;
  /** One template per wheel id, already scaled. */
  readonly wheels: ReadonlyMap<string, THREE.Object3D>;
}

const templates = new Map<string, Template>();
const modelLoads = new Map<string, Promise<void>>();
const paletteLoads = new Map<string, Promise<THREE.Texture>>();
/**
 * One ready-to-attach instance of every loaded model. GLB parsing is already paid
 * before play; cloning its scene graph was still first paid at a roadside POI or
 * dev spawn, creating the multi-second hitch those paths exposed. These pools move
 * that one-off CPU work behind the loading screen.
 */
const warmDrivingInstances = new Map<string, CarModelInstance>();
const warmStaticInstances = new Map<string, THREE.Object3D>();
let gltf: GLTFLoader | null = null;
let fbx: FBXLoader | null = null;
let textures: THREE.TextureLoader | null = null;

/**
 * The FBX loader for the Soviet pack.
 *
 * It DELEGATES URL resolution to the default manager rather than replacing it.
 * Headless tools install their own modifier there to turn the game's root-absolute
 * asset paths into file URLs (tools/assetshim.ts); resolving through it at request
 * time composes with whatever they installed, in either install order.
 */
function fbxLoader(): FBXLoader {
  if (fbx) return fbx;
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => THREE.DefaultLoadingManager.resolveURL(url));
  fbx = new FBXLoader(manager);
  return fbx;
}

function gltfLoader(): GLTFLoader {
  gltf ??= new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  return gltf;
}

/**
 * Produces one model's scene graph, picking the source from its URL.
 *
 * Asset-file cameras and lights are authoring aids, never vehicle parts. Keeping
 * them makes every spawned copy add another renderer light; the updated Soviet
 * FBXs contain Blender scene lights, which overwhelmed the sun around each car.
 */
async function loadScene(file: string): Promise<THREE.Group> {
  const scene = file.toLowerCase().endsWith('.fbx')
    ? await fbxLoader().loadAsync(file)
    : (await gltfLoader().loadAsync(file)).scene;

  const authoringDevices: THREE.Object3D[] = [];
  scene.traverse((node) => {
    if (node instanceof THREE.Light || node instanceof THREE.Camera) {
      authoringDevices.push(node);
    }
  });
  for (const node of authoringDevices) node.removeFromParent();
  return scene;
}

/** Curated factory colours shared by both imported packs. */
const CAR_PAINT_COLORS: readonly number[] = [
  0x2f5f87, // deep blue
  0x74a3bd, // powder blue
  0x315f55, // dark teal
  0x76917a, // sage
  0x8b3f36, // oxide red
  0xb9683f, // burnt orange
  0xc5a548, // ochre
  0xd6d0bc, // ivory
  0x9c927b, // beige
  0x6f5b78, // plum
  0x697887, // slate
  0x343a40, // charcoal
];
const paintScratch = new THREE.Color();

/**
 * Stable string avalanche: a saved/generated car keeps its colour and its wear
 * pattern across reloads.
 */
function appearanceHash(modelId: string, appearanceKey: string): number {
  let h = 0x811c9dc5;
  const key = `${modelId}:${appearanceKey}`;
  for (let i = 0; i < key.length; i++) {
    h = Math.imul(h ^ key.charCodeAt(i), 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

function paintColorFor(modelId: string, appearanceKey: string): THREE.Color {
  const h = appearanceHash(modelId, appearanceKey);
  return paintScratch.setHex(CAR_PAINT_COLORS[h % CAR_PAINT_COLORS.length]!);
}

function isRandomPaintMesh(mesh: THREE.Mesh, def: CarModelDef): boolean {
  if (def.paintStyle === 'soviet-atlas') return mesh.name.endsWith('body');
  if (def.paintStyle === 'solid-paint') return true;
  return false;
}

/**
 * Whether one material slot of a paint mesh is the paint itself.
 *
 * A Soviet body mesh has exactly one slot, so all of it is paint. A normalized GTA
 * SA body carries six runtime roles in one file, and only the painted panels may be
 * repainted or weathered: rusting a headlight is not a thing.
 */
function isPaintSlot(material: THREE.Material, def: CarModelDef): boolean {
  if (def.paintStyle === 'solid-paint') {
    if (def.glassMaterial && material.name === def.glassMaterial) return false;
    return !/(glass|lamp|light|chrome|trim|tyre|tire|wheel)/i.test(material.name);
  }
  return true;
}

/**
 * Gives each car independent condition uniforms while preserving the exact paint
 * slot. Packs with a paint style name their paint; a pack without one is repainted
 * whole, which is what its single-material bodies describe.
 */
function cloneCarBodyPaintMaterials(
  root: THREE.Object3D,
  def: CarModelDef,
  appearanceKey: string,
): void {
  const seed = appearanceHash(def.id, appearanceKey);
  const clones = new Map<THREE.Material, THREE.Material>();
  const paint = (source: THREE.Material): THREE.Material => {
    const existing = clones.get(source);
    if (existing) return existing;
    const material = makeCarBodyConditionMaterial(source);
    // Wear is sampled in the body's own frame now, so two cars of one model would
    // otherwise rust in identical places. The car's own hash spreads them apart.
    setConditionFieldOrigin(material, seed);
    clones.set(source, material);
    return material;
  };

  root.traverse((mesh) => {
    if (!(mesh instanceof THREE.Mesh)) return;
    if (def.paintStyle && !isRandomPaintMesh(mesh, def)) return;
    const eligible = (source: THREE.Material): THREE.Material =>
      isPaintSlot(source, def) ? paint(source) : source;
    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map(eligible)
      : eligible(mesh.material);
  });
}

/**
 * Gives static cars independent paint without the dynamic body-wear shader. Parked
 * cars never accumulate dirt or scratches; paying that FBM cost for each one can
 * saturate an integrated GPU as POIs enter the scene.
 */
function cloneStaticPaintMaterials(root: THREE.Object3D, def: CarModelDef): void {
  if (!def.paintStyle) return;
  const clones = new Map<THREE.Material, THREE.Material>();
  const paint = (source: THREE.Material): THREE.Material => {
    const existing = clones.get(source);
    if (existing) return existing;
    // Soviet paint additionally needs atlas recolouring; both packs use the same
    // metallic automotive finish.
    const material = def.paintStyle === 'soviet-atlas'
      ? makeCarPalettePaintMaterial(source)
      : makeCarPaintFinishMaterial(source);
    clones.set(source, material);
    return material;
  };

  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh) || !isRandomPaintMesh(child, def)) return;
    const eligible = (source: THREE.Material): THREE.Material =>
      isPaintSlot(source, def) ? paint(source) : source;
    child.material = Array.isArray(child.material)
      ? child.material.map(eligible)
      : eligible(child.material);
  });
}

/**
 * Soviet shells are authored as outward-facing skins. A single-sided skin shows
 * holes at grazing angles from outside. Driven instances already own cloned paint
 * materials, so making that shell two-sided does not mutate shared/static materials.
 */
function prepareSovietShellFaces(root: THREE.Object3D, def: CarModelDef): void {
  if (def.paintStyle !== 'soviet-atlas') return;
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh) || !isRandomPaintMesh(child, def)) return;
    for (const material of materialsOf(child)) material.side = THREE.DoubleSide;
  });
}

/** Writes one deterministic per-car colour into already-independent paint materials. */
function applyRandomPaint(root: THREE.Object3D, def: CarModelDef, appearanceKey: string): void {
  if (!def.paintStyle) return;
  const color = paintColorFor(def.id, appearanceKey);
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh) || !isRandomPaintMesh(child, def)) return;
    for (const material of materialsOf(child)) {
      if (!(material instanceof THREE.MeshStandardMaterial)) continue;
      if (!isPaintSlot(material, def)) continue;
      if (def.paintStyle === 'solid-paint') {
        material.map = null;
        material.color.copy(color);
        material.needsUpdate = true;
      } else if (def.paintUvCell) {
        setCarBodyPalettePaint(material, color, def.paintUvCell);
      }
    }
  });
}

/**
 * Sampling for the Soviet palette atlas.
 *
 * The pack paints by UV: a face points at one swatch of a small image, so there is
 * no texture detail to filter and any filtering is pure damage. Nearest on BOTH
 * directions matters — with the default mipmap chain a 32x32 palette averages four
 * unrelated colours per level, so a car turned mud-coloured as it walked away from
 * the camera. There is no aliasing cost to pay for it either: a face's UVs are
 * constant across it, so minification has nothing to alias.
 */
function tunePaletteTexture(texture: THREE.Texture): void {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
}

/**
 * Points a subtree's palette material at its pack's shared texture.
 *
 * The Soviet FBXs have no named mapped slot, so the texture goes onto whichever
 * material the body already carries.
 *
 * Materials are cloned once per source material, not once per mesh, so slots shared
 * between meshes stay one material and one draw call's worth of state.
 */
function applyTexture(
  root: THREE.Object3D,
  map: THREE.Texture,
  materialName?: string,
): void {
  const meshes: THREE.Mesh[] = [];
  let textured = false;
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    meshes.push(child);
    for (const m of materialsOf(child)) {
      if ((m as THREE.MeshStandardMaterial).map) textured = true;
    }
  });

  const clones = new Map<THREE.Material, THREE.Material>();
  const repaint = (source: THREE.Material): THREE.Material => {
    const existing = clones.get(source);
    if (existing) return existing;
    const standard = source as THREE.MeshStandardMaterial;
    if (
      (materialName && source.name !== materialName) ||
      (!materialName && textured && !standard.map)
    ) {
      clones.set(source, source);
      return source;
    }
    const material = standard.clone();
    material.map = map;
    material.color.setRGB(1, 1, 1);
    material.needsUpdate = true;
    clones.set(source, material);
    return material;
  };

  for (const mesh of meshes) {
    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map(repaint)
      : repaint(mesh.material);
  }
}

function materialsOf(mesh: THREE.Mesh): readonly THREE.Material[] {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material];
}

/** Applies palette sampling to whatever maps the pack resolved for itself. */
function tuneMaps(root: THREE.Object3D): void {
  const seen = new Set<THREE.Texture>();
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    for (const material of materialsOf(child)) {
      const map = (material as THREE.MeshStandardMaterial).map;
      if (!map || seen.has(map)) continue;
      seen.add(map);
      tunePaletteTexture(map);
    }
  });
}

/** Bounds of a subtree in ITS OWN parent's space, ignoring nothing. */
function boundsOf(object: THREE.Object3D): THREE.Box3 {
  return new THREE.Box3().setFromObject(object, true);
}

/**
 * THE CAR SHADOW CONTRACT: bodywork casts and never receives; wheels do both.
 *
 * Both packs author bodywork as ZERO-THICKNESS panels, and a driven instance draws
 * the Soviet shell DOUBLE-SIDED on purpose (`prepareSovietShellFaces`). A
 * double-sided panel is rasterized into the sun's depth map whichever way it faces,
 * so it stores ITS OWN surface depth, and three flips the shading normal for a
 * back-facing fragment — so the very same panel is also lit. It therefore shadows
 * itself at any bias small enough to keep the car's contact shadow on the sand
 * (2 cm; see render/sky.ts), which is the banding that appeared across roofs,
 * bonnets and flanks when that bias was tightened.
 *
 * Measured in tools/shadowlab: dropping reception on the bodywork removes the bands
 * and changes NOTHING else — the ground silhouette is unchanged because the panels
 * still cast.
 *
 * `bodywork` is a caller's fact, not a mesh-name test: `buildTemplate` passes the
 * body scene and `takeOwnWheels` the wheel wrappers, so no pack or mesh name can
 * slip past it.
 */
function prepareMaterials(root: THREE.Object3D, bodywork: boolean): void {
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    // Glass is the one surface that must not cast: a window throws a pane-shaped
    // black slab across the ground, which is the shadow of a wall, not of a window.
    child.castShadow = !materialsOf(child).includes(carGlassMaterial());
    child.receiveShadow = !bodywork;
    // Wheels are closed solids, so their lit face is culled from the depth map and
    // the depth stored under them is metres away: they can receive safely, and a
    // wheel darkening under its own arch is worth having.
    for (const material of materialsOf(child)) material.shadowSide = THREE.BackSide;
  });
}

/**
 * The one window glass in the game, shared by every car of both packs.
 *
 * Shared rather than per-pack on purpose: glass is glass, and one material means
 * one program, one draw state and one place to tune the tint.
 */
let glassMaterial: THREE.MeshStandardMaterial | null = null;

function carGlassMaterial(): THREE.MeshStandardMaterial {
  glassMaterial ??= new THREE.MeshStandardMaterial({
    name: 'car-glass',
    // A cold near-black tint remains glossy enough to read as glass in direct sun.
    color: 0x101a22,
    transparent: false,
    roughness: 0.08,
    metalness: 0.12,
    side: THREE.DoubleSide,
  });
  return glassMaterial;
}

/**
 * Separates a body's windows into the shared opaque tint, whichever way its pack
 * drew them.
 *
 * `glassMaterial` names an authored material on separate window meshes (GTA SA),
 * and is a straight swap. `glassUvCell` is the harder case (Soviet): the windows
 * are not objects at all, only the triangles of ONE body mesh whose UVs point at
 * the atlas's glass swatch, so they are cut out into a mesh of their own and the
 * host is left drawing everything else.
 */
function isolateGlass(scene: THREE.Group, def: CarModelDef): void {
  if (def.glassMaterial) {
    const wanted = def.glassMaterial;
    scene.traverse((mesh) => {
      if (!(mesh instanceof THREE.Mesh)) return;
      const swap = (source: THREE.Material): THREE.Material =>
        source.name === wanted ? carGlassMaterial() : source;
      mesh.material = Array.isArray(mesh.material)
        ? mesh.material.map(swap)
        : swap(mesh.material);
    });
    return;
  }

  const cell = def.glassUvCell;
  if (!cell) return;
  const meshes: THREE.Mesh[] = [];
  scene.traverse((node) => {
    if (node instanceof THREE.Mesh) meshes.push(node);
  });
  for (const mesh of meshes) {
    // Only a single-material host can be cut this way: on a multi-slot mesh the
    // groups already partition the buffer and the glass would be a slot, not a
    // region. Neither shipped pack does that, and guessing at it would be worse
    // than leaving the body alone.
    if (Array.isArray(mesh.material)) continue;
    const uv = mesh.geometry.attributes.uv as THREE.BufferAttribute | undefined;
    if (!uv) continue;
    const glass = triangleRuns(mesh.geometry, (tri) => uvCellOf(mesh.geometry, tri, cell));
    if (glass.matched.length === 0) continue;

    const pane = new THREE.Mesh(subGeometry(mesh.geometry, glass.matched), carGlassMaterial());
    pane.name = 'glass';
    pane.position.copy(mesh.position);
    pane.quaternion.copy(mesh.quaternion);
    pane.scale.copy(mesh.scale);
    mesh.parent?.add(pane);

    // The host is REBUILT without the cut triangles rather than left drawing the
    // gaps as groups. The glass is scattered through the buffer — the Zhiguli's
    // 34 panes fall in 21 runs — so keeping the buffer would turn one body draw
    // into twenty-one. One copy of a 2.4k-triangle body, once per model at load,
    // buys back a single draw call on every car in the world.
    const remainder = subGeometry(mesh.geometry, glass.rest);
    mesh.geometry.dispose();
    mesh.geometry = remainder;
  }
}

/** Whether triangle `tri` samples the atlas cell `cell`, by its UV centroid. */
function uvCellOf(
  geometry: THREE.BufferGeometry,
  tri: number,
  cell: readonly [number, number],
): boolean {
  const uv = geometry.attributes.uv as THREE.BufferAttribute;
  const index = geometry.index;
  let u = 0;
  let v = 0;
  for (let c = 0; c < 3; c++) {
    const vertex = index ? index.getX(tri * 3 + c) : tri * 3 + c;
    u += uv.getX(vertex);
    v += uv.getY(vertex);
  }
  return (
    Math.floor((u / 3) * SOVIET_ATLAS_COLUMNS) === cell[0] &&
    Math.floor((v / 3) * SOVIET_ATLAS_ROWS) === cell[1]
  );
}

/** The Soviet pack's shared swatch atlas, in cells. */
const SOVIET_ATLAS_COLUMNS = 9;
const SOVIET_ATLAS_ROWS = 2;

/**
 * Splits a geometry's triangles into contiguous matching and non-matching draw
 * ranges. Runs rather than per-triangle groups because authored regions are
 * contiguous in the buffer: the Soviet glass comes out as a handful of ranges, not
 * one per pane.
 */
function triangleRuns(
  geometry: THREE.BufferGeometry,
  matches: (tri: number) => boolean,
): { matched: { start: number; count: number }[]; rest: { start: number; count: number }[] } {
  const drawCount = geometry.index
    ? geometry.index.count
    : geometry.attributes.position.count;
  const matched: { start: number; count: number }[] = [];
  const rest: { start: number; count: number }[] = [];
  let runStart = 0;
  let runMatched = matches(0);
  const flush = (end: number): void => {
    if (end === runStart) return;
    (runMatched ? matched : rest).push({ start: runStart, count: end - runStart });
  };
  for (let tri = 1; tri * 3 < drawCount; tri++) {
    const hit = matches(tri);
    if (hit === runMatched) continue;
    flush(tri * 3);
    runStart = tri * 3;
    runMatched = hit;
  }
  flush(drawCount);
  return { matched, rest };
}


/**
 * A new geometry holding only the vertices some draw ranges of `source` reference.
 *
 * The ranges are copied rather than aliased into the parent's buffer: a lamp is a
 * handful of triangles, and an independent buffer is what lets the host geometry be
 * disposed on its own.
 */
function subGeometry(
  source: THREE.BufferGeometry,
  ranges: readonly { start: number; count: number }[],
): THREE.BufferGeometry {
  const index = source.index;
  const total = ranges.reduce((sum, range) => sum + range.count, 0);
  const out = new THREE.BufferGeometry();
  for (const [name, attribute] of Object.entries(source.attributes)) {
    const src = attribute as THREE.BufferAttribute;
    const size = src.itemSize;
    // `getComponent` rather than raw array reads: it denormalizes a quantized
    // attribute, so a float copy is correct whatever the source buffer's type.
    const data = new Float32Array(total * size);
    let write = 0;
    for (const range of ranges) {
      for (let i = range.start; i < range.start + range.count; i++) {
        const vertex = index ? index.getX(i) : i;
        for (let c = 0; c < size; c++) data[write++] = src.getComponent(vertex, c);
      }
    }
    out.setAttribute(name, new THREE.Float32BufferAttribute(data, size));
  }
  return out;
}

/**
 * Detaches the four wheel nodes of a model that carries its own wheels.
 *
 * They must be detached because the vehicle drives them itself: Rapier's ray-cast
 * suspension reports each wheel's position and spin every step, so a wheel parented
 * to the body would be dragged along by the body instead.
 *
 * A wheel may be several nodes (a hub plus a tyre); they are measured as one and
 * detached into one wrapper, so they spin and steer together.
 */
function takeOwnWheels(
  def: CarModelDef,
  scene: THREE.Group,
): {
  objects: Map<string, THREE.Object3D>;
  positions: Map<string, THREE.Vector3>;
  radii: Map<string, number>;
} {
  const s = def.scale;
  const names = def.wheelNodes ?? DETECTED_WHEEL_NODES;
  const objects = new Map<string, THREE.Object3D>();
  const positions = new Map<string, THREE.Vector3>();
  const radii = new Map<string, number>();

  for (const id of WHEEL_IDS) {
    const nodes = names[id]
      .map((name) => scene.getObjectByName(name))
      .filter((node): node is THREE.Object3D => node !== undefined);
    if (nodes.length !== names[id].length) continue;

    const box = new THREE.Box3();
    for (const node of nodes) box.union(boundsOf(node));
    // The suspension mount is the wheel's own CENTRE, not its node origin. Several
    // exporters put a node on the tyre's inner face rather than on its axle plane;
    // mounting there pulls the track in by a tyre width on both sides and makes a
    // perfectly good body handle like a tippy shopping trolley.
    const centre = box.getCenter(new THREE.Vector3());
    // Radius from the disc's own bounds, measured across whichever pair of axes is
    // the wheel's face. The axle is the SHORTEST extent — some packs model a wheel
    // about X, some about Z — so taking half of the largest extent is what makes
    // this independent of the modeller's axis convention.
    const extents = [box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z];
    radii.set(id, (Math.max(...extents) / 2) * s);
    positions.set(id, centre.clone().multiplyScalar(s));

    // The vehicle spins a wheel about X and steers it about Y, so the wheel's axle
    // has to BE X. Packs disagree on the authored axis, and zeroing the authored
    // transform instead lays a wheel modelled about another axis flat like a dinner
    // plate. The transform is kept and an alignment group turns whichever axis is
    // the axle onto X — mesh and centring offset rotate together, so the wheel stays
    // centred on its mount.
    const align = new THREE.Group();
    const axle = extents.indexOf(Math.min(...extents));
    if (axle === 1) align.rotation.z = Math.PI / 2; // axle along Y
    else if (axle === 2) align.rotation.y = Math.PI / 2; // axle along Z

    for (const node of nodes) {
      // With the mount moved to the centre, the mesh has to move the other way, or
      // it would be drawn a tyre-width outboard of the wheel physics simulates.
      const local = node.position.clone().sub(centre);
      node.removeFromParent();
      node.position.copy(local);
      node.updateMatrix();
      align.add(node);
    }

    const wrapper = new THREE.Group();
    wrapper.name = id;
    wrapper.scale.setScalar(s);
    wrapper.add(align);
    prepareMaterials(wrapper, false);
    objects.set(id, wrapper);
  }

  if (objects.size !== WHEEL_IDS.length) {
    throw new Error(`Car model "${def.id}" has ${objects.size} of ${WHEEL_IDS.length} wheels`);
  }
  return { objects, positions, radii };
}

/**
 * Turns a model that was authored facing the wrong way (`def.yaw`).
 *
 * The rotation is baked into the scene's TOP-LEVEL CHILDREN — each one's position
 * and orientation — rather than set on the root. Setting it on the root would be
 * one line, and wrong: `takeOwnWheels` below mixes a wheel's world-space centre
 * with its own local `position` to re-centre the mesh on its axle, and detaching
 * that node from a rotated parent drops the rotation, so the mesh would be drawn
 * a wheelbase away from the suspension that carries it. Baking the turn into the
 * children leaves every node's local frame already correct, which is also what
 * keeps `renameDetectedWheels` — it reads the sign of Z to decide which axle is
 * the front one — from labelling the car back to front.
 */
function applyModelYaw(scene: THREE.Group, yaw: number): void {
  const turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  for (const child of scene.children) {
    child.position.applyQuaternion(turn);
    child.quaternion.premultiply(turn);
  }
  scene.updateMatrixWorld(true);
}

/**
 * Cosmetic ride-height correction, metres: how far the body drops relative to the
 * wheels. Every catalogue body sits a hand's width too tall — the tyre tops ride
 * 3-5 cm clear of the arch lips instead of tucking under them, so the cars read as
 * standing on stilts. Raising each wheel's mount (its chassis-local Y) by this much
 * drops the body by the same amount; the collider floor keys off the same mount and
 * follows it up, so the belly keeps its clearance and only the stance changes.
 */
const RIDE_DROP_M = 0.04;

/**
 * How far the hood camera stands above the measured bonnet skin, metres. Enough to
 * clear the panel it is mounted on without floating off it.
 */
const HOOD_CAMERA_CLEARANCE_M = 0.1;
/** Scratch for the bonnet sweep; measuring a body must not allocate per vertex. */
const _sample = new THREE.Vector3();

/** The node every pack names for the animated steering wheel. */
export const STEERING_WHEEL_NODE = 'steering_wheel';


/** Measures a loaded scene and splits it into a body template plus wheel templates. */
function buildTemplate(def: CarModelDef, scene: THREE.Group): Template {
  if (def.yaw) applyModelYaw(scene, def.yaw);
  // Normalized assets already carry one mesh per independently controlled lamp.
  isolateGlass(scene, def);
  scene.updateMatrixWorld(true);
  const s = def.scale;

  // The model's own wheels come out first, which is what leaves `body` behind as
  // everything else.
  //
  // `detectWheels` is for packs that name their wheels whatever the modeller felt
  // like: the four discs are found by shape and renamed to the convention before
  // the usual path runs, so nothing downstream needs to know the difference.
  if (def.detectWheels && !renameDetectedWheels(scene)) {
    throw new Error(`Car model "${def.id}": could not identify four wheels by shape`);
  }
  const parts = takeOwnWheels(def, scene);

  // Chassis box: the bounds of what is left, i.e. the body and its fixed trim.
  // Box3 has no scalar multiply, so the corners are scaled directly.
  const bodyBox = boundsOf(scene);
  bodyBox.min.multiplyScalar(s);
  bodyBox.max.multiplyScalar(s);
  const centre = bodyBox.getCenter(new THREE.Vector3());
  const half = bodyBox.getSize(new THREE.Vector3()).multiplyScalar(0.5);

  const toLocal = (v: THREE.Vector3): [number, number, number] => [
    v.x - centre.x,
    v.y - centre.y,
    v.z - centre.z,
  ];

  const wheels: WheelMeasure[] = [];
  for (const id of WHEEL_IDS) {
    const p = toLocal(parts.positions.get(id)!);
    wheels.push({
      id,
      // RIDE_DROP_M lifts the mount in chassis space, which drops the body by the
      // same amount once the suspension settles onto its (unchanged) tyres.
      pos: [p[0], p[1] + RIDE_DROP_M, p[2]],
      radius: parts.radii.get(id)!,
      isFront: id === 'wheel_fl' || id === 'wheel_fr',
    });
  }

  // Fractional anchor resolution, straight into CHASSIS-LOCAL metres: x of
  // half-width, y through the body's height (0 = floor, 1 = roof), z of half-length.
  //
  // Chassis-local is the only frame these can be resolved in. Resolving them in the
  // model's OWN space and subtracting `centre` afterwards silently breaks every body
  // whose box is not centred on its own origin: `frac * half` measured from the
  // origin comes out one offset wrong. Resolving in chassis space makes the
  // fractions mean the same thing on all forty-six bodies.
  const resolveFrac = (frac: readonly [number, number, number]): [number, number, number] => [
    frac[0] * half.x,
    (frac[1] * 2 - 1) * half.y,
    frac[2] * half.z,
  ];

  const anchors: GizmoAnchor[] = def.gizmoAnchors.map((a: GizmoAnchorDef) => ({
    id: a.id,
    label: a.label,
    pos: resolveFrac(a.frac),
    yaw: a.yaw ?? 0,
  }));

  // Hood camera mount, measured rather than authored.
  //
  // The bonnet is the highest bodywork over the front third of the car, on the
  // centreline: sampling THAT is what makes one rule work for a Volga, a Niva and
  // a semi, none of which agree on where a bonnet is or whether it slopes. Taking
  // the body box's top instead would put the camera on the ROOF, and taking its
  // centre would bury it in the engine.
  //
  // The window deliberately stops short of the nose: the leading edge is bumper and
  // grille, which slope away, and a camera pinned to them looks at sky.
  const hoodFrontZ = half.z * 0.86;
  const hoodRearZ = half.z * 0.34;
  const hoodHalfWidth = half.x * 0.35;
  let hoodY = -half.y;
  scene.updateMatrixWorld(true);
  scene.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    const position = node.geometry.getAttribute('position');
    if (!position) return;
    for (let i = 0; i < position.count; i++) {
      _sample.fromBufferAttribute(position, i).applyMatrix4(node.matrixWorld).multiplyScalar(s);
      const z = _sample.z - centre.z;
      if (z < hoodRearZ || z > hoodFrontZ) continue;
      if (Math.abs(_sample.x - centre.x) > hoodHalfWidth) continue;
      hoodY = Math.max(hoodY, _sample.y - centre.y);
    }
  });
  // A camera exactly on the sheet metal z-fights with it and shows nothing of the
  // car, so it sits a hand's width proud of the measured skin.
  const hoodPoint: [number, number, number] = [
    0,
    hoodY + HOOD_CAMERA_CLEARANCE_M,
    (hoodFrontZ + hoodRearZ) * 0.5,
  ];


  scene.scale.setScalar(s);
  scene.position.set(-centre.x, -centre.y, -centre.z);
  prepareMaterials(scene, true);
  scene.updateMatrixWorld(true);

  // The model's origin is on the ground between the wheels, so the distance from
  // the chassis centre down to that origin is exactly the spawn clearance needed
  // for the body to settle onto its wheels rather than through them.
  const measure: CarModelMeasure = {
    halfExtents: [half.x, half.y, half.z],
    wheels,
    anchors,
    hoodPoint,
    visualOffset: [-centre.x, -centre.y, -centre.z],
  };

  return { def, measure, body: scene, wheels: parts.objects };
}

/** One shared palette per pack, loaded once and pointed at by every body in it. */
const paletteTextures = new Map<string, THREE.Texture>();

/**
 * Loads a pack's palette and tunes its sampling.
 *
 * Only the Soviet FBX pack ships one. Its V origin follows the FORMAT: FBX counts
 * V from the bottom, which is what TextureLoader's default flip already produces,
 * so the flip stays on. Sampling it any other way puts roof paint on the sills and
 * tyre black across the glass.
 */
async function loadPalette(url: string): Promise<THREE.Texture> {
  const cached = paletteTextures.get(url);
  if (cached) return cached;
  const pending = paletteLoads.get(url);
  if (pending) return pending;
  textures ??= new THREE.TextureLoader();
  const load = textures
    .loadAsync(url)
    .then((map) => {
      map.flipY = true;
      tunePaletteTexture(map);
      paletteTextures.set(url, map);
      paletteLoads.delete(url);
      return map;
    })
    .catch((error) => {
      paletteLoads.delete(url);
      throw error;
    });
  paletteLoads.set(url, load);
  return load;
}

function loadModel(def: CarModelDef): Promise<void> {
  if (templates.has(def.id)) return Promise.resolve();
  const pending = modelLoads.get(def.id);
  if (pending) return pending;

  const load = (async () => {
    if (def.textureFile) await loadPalette(def.textureFile);
    const scene = await loadScene(def.file);
    if (def.textureFile) {
      applyTexture(scene, paletteTextures.get(def.textureFile)!);
    }
    tuneMaps(scene);
    templates.set(def.id, buildTemplate(def, scene));
  })().catch((error) => {
    modelLoads.delete(def.id);
    throw error;
  });
  modelLoads.set(def.id, load);
  return load;
}

/**
 * Loads the selected models once. Calls share the same in-flight promise per model,
 * so POI streaming, a saved car and a dev spawn cannot duplicate network or parse
 * work when they request the same asset in one frame.
 */
export async function preloadCarModels(ids?: readonly string[]): Promise<void> {
  const defs = ids ? ids.map(carModel) : CAR_MODELS;
  await Promise.all(defs.map(loadModel));
}

/** Lazy-loading entry point used by runtime consumers that need one model. */
export function loadCarModel(id: string): Promise<void> {
  return loadModel(carModel(id));
}

/** True when a visual template is resident and can be cloned synchronously. */
export function isCarModelLoaded(id: string): boolean {
  return templates.has(id);
}

function measureFromFit(fit: CarModelFit): CarModelMeasure {
  return fit;
}

function template(id: string): Template {
  const t = templates.get(id);
  if (!t) throw new Error(`Car model "${id}" has not finished loading`);
  return t;
}

/** Measurements are available from the tiny fit manifest before visuals stream in. */
export function carModelMeasure(id: string): CarModelMeasure {
  return templates.get(id)?.measure ?? measureFromFit(carModel(id).fit);
}

/** Clear air below a newly-created car before gravity settles its suspension. */
export const CAR_SPAWN_DROP_METRES = 0.75;

/**
 * Chassis-centre Y that leaves the complete visual—body and detached wheels—above
 * the sampled ground. Model origins vary across packs, so neither `halfExtents.y`
 * nor the authored origin is a reliable universal floor by itself.
 *
 * Open-world spawns use the default 0.75 m drop. Constrained spawns may request
 * less clear air so the car cannot meet a ceiling before gravity can settle it.
 */
export function carSpawnYAboveGround(
  measure: CarModelMeasure,
  groundY: number,
  dropMetres = CAR_SPAWN_DROP_METRES,
): number {
  let lowestLocalY = -measure.halfExtents[1];
  for (const wheel of measure.wheels) {
    lowestLocalY = Math.min(lowestLocalY, wheel.pos[1] - wheel.radius);
  }
  return groundY - lowestLocalY + Math.max(0, dropMetres);
}

export interface CarModelInstance {
  /** Body and fixed trim, positioned for a chassis-centred parent. */
  readonly body: THREE.Object3D;
  /** Wheel id -> its own object, to be parented and driven by the vehicle. */
  readonly wheels: ReadonlyMap<string, THREE.Object3D>;
}

function visualBodyLift(t: Template): number {
  const fraction = t.def.visualRideLiftWheelFraction ?? 0;
  if (fraction === 0) return 0;
  let wheelRadius = 0;
  for (const wheel of t.measure.wheels) wheelRadius = Math.max(wheelRadius, wheel.radius);
  return wheelRadius * fraction;
}

function cloneDrivingModel(t: Template, appearanceKey = t.def.id): CarModelInstance {
  const wheels = new Map<string, THREE.Object3D>();
  for (const [wheelId, object] of t.wheels) wheels.set(wheelId, object.clone(true));
  const body = t.body.clone(true);
  cloneCarBodyPaintMaterials(body, t.def, appearanceKey);
  prepareSovietShellFaces(body, t.def);
  applyRandomPaint(body, t.def, appearanceKey);
  body.position.y += visualBodyLift(t);
  body.name = 'body';
  return { body, wheels };
}

/** A fresh instance of a loaded model, sharing geometry but owning its paint state. */
export function createCarModel(id: string, appearanceKey = id): CarModelInstance {
  const t = template(id);
  const warmed = warmDrivingInstances.get(id);
  if (warmed) {
    warmDrivingInstances.delete(id);
    applyRandomPaint(warmed.body, t.def, appearanceKey);
    return warmed;
  }
  return cloneDrivingModel(t, appearanceKey);
}

/**
 * A static, non-driven copy of a whole vehicle — wheels included, bolted where the
 * model puts them. This is what wrecks and scenery cars use.
 */
function cloneStaticModel(id: string, appearanceKey = id): THREE.Object3D {
  const t = template(id);
  const group = new THREE.Group();
  group.name = id;
  const body = t.body.clone(true);
  cloneStaticPaintMaterials(body, t.def);
  applyRandomPaint(body, t.def, appearanceKey);
  body.position.y += visualBodyLift(t);
  group.add(body);
  for (const wheel of t.measure.wheels) {
    const mesh = t.wheels.get(wheel.id)!.clone(true);
    mesh.position.set(wheel.pos[0], wheel.pos[1], wheel.pos[2]);
    group.add(mesh);
  }
  return group;
}
/**
 * Clones instances only for templates already resident. Lazy models warm on their
 * first visual attach instead of turning the loading screen into a catalogue preload.
 */
export async function warmCarModelInstances(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
): Promise<void> {
  const compileGroup = new THREE.Group();
  const drivingBodies: THREE.Object3D[] = [];
  compileGroup.position.z = -20;
  scene.add(compileGroup);
  for (const def of CAR_MODELS) {
    if (!templates.has(def.id) || warmDrivingInstances.has(def.id)) continue;
    const drivingModel = cloneDrivingModel(template(def.id));
    warmDrivingInstances.set(def.id, drivingModel);
    drivingBodies.push(drivingModel.body);
    compileGroup.add(drivingModel.body);
    const staticModel = cloneStaticModel(def.id);
    staticModel.traverse((object) => {
      object.frustumCulled = false;
    });
    warmStaticInstances.set(def.id, staticModel);
    compileGroup.add(staticModel);
  }
  await renderer.compileAsync(scene, camera);
  scene.remove(compileGroup);
  for (const model of warmStaticInstances.values()) compileGroup.remove(model);
  for (const body of drivingBodies) compileGroup.remove(body);
}


/**
 * A static, non-driven copy of a whole vehicle — wheels included, bolted where the
 * model puts them. This is what wrecks and scenery cars use.
 */
export function createStaticCarModel(id: string, appearanceKey = id): THREE.Object3D {
  const t = template(id);
  const warmed = warmStaticInstances.get(id);
  if (warmed) {
    warmStaticInstances.delete(id);
    applyRandomPaint(warmed, t.def, appearanceKey);
    return warmed;
  }
  return cloneStaticModel(id, appearanceKey);
}

export function disposeCarModelCache(): void {
  const seenGeometry = new Set<THREE.BufferGeometry>();
  const seenMaterial = new Set<THREE.Material>();
  const dispose = (root: THREE.Object3D): void => {
    root.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      if (!seenGeometry.has(child.geometry)) {
        seenGeometry.add(child.geometry);
        child.geometry.dispose();
      }
      for (const material of Array.isArray(child.material) ? child.material : [child.material]) {
        if (seenMaterial.has(material)) continue;
        seenMaterial.add(material);
        // The map is NOT freed here. Every car texture is a pack palette shared by
        // every body in that pack and by every recoloured copy of it, so it is
        // released once below instead of by whichever car happened to be walked
        // first.
        material.dispose();
      }
    });
  };
  warmDrivingInstances.clear();
  warmStaticInstances.clear();
  for (const t of templates.values()) {
    dispose(t.body);
    for (const wheel of t.wheels.values()) dispose(wheel);
  }
  templates.clear();
  modelLoads.clear();
  paletteLoads.clear();
  // The Soviet palette is shared by every body in that pack, so it is released here
  // rather than through the per-material walk above, which would otherwise free it
  // on the first car that referenced it.
  for (const texture of paletteTextures.values()) texture.dispose();
  paletteTextures.clear();
  gltf = null;
  fbx = null;
  glassMaterial = null;
}
