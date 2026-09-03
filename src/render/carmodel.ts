/**
 * Loads and measures the complete car models (see vehicle/carmodels.ts).
 *
 * The GLB is the authority on shape, so this module's job is to read the shape back
 * out of it: the chassis box comes from the `body` node's bounds, the suspension
 * mounts from the `wheel-*` node positions and each wheel's radius from that node's
 * own bounds. Nothing is guessed and nothing is duplicated in a table.
 *
 * Everything a caller gets is in CHASSIS-LOCAL metres: the origin is the centre of
 * the chassis box, which is what Rapier's rigid body and the render group both use.
 * The GLB's own origin sits on the ground between the wheels, so the loaded model
 * has to be pushed down by `visualOffset` inside that group — that single vector is
 * the whole conversion between "what the artist drew" and "what the physics owns".
 *
 * Templates are loaded once and cloned per instance; geometry, materials and the
 * shared colormap texture are all shared between clones.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import {
  makeCarBodyConditionMaterial,
  makeCarPalettePaintMaterial,
  setCarBodyPalettePaint,
} from './materials';
import {
  CAR_MODELS,
  STYLIZED_PAINT_MATERIAL,
  carModel,
  type CarModelDef,
  type GizmoAnchorDef,
  type PalettePaintRamp,
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
  /** Driver eye, chassis-local metres. */
  readonly eyePoint: readonly [number, number, number];
  readonly anchors: readonly GizmoAnchor[];
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
 * Redirects the Stylized pack's texture references from the PSD Unity ships to the
 * PNG a browser can decode.
 *
 * Its FBX files name `PixelColors.psd` internally, with an absolute path from the
 * artist's machine. FBXLoader takes the basename and asks for it beside the model,
 * which no browser will decode, so the reference is rewritten to the converted PNG
 * sitting at exactly that stem (tools/psd-to-png.mjs). Rewriting the request beats
 * patching the reference inside 31 binary FBX files, and the catalogue names the
 * same PNG as its `textureFile`, so the rewrite and the shared palette resolve to
 * one URL and one fetch.
 *
 * The rewrite DELEGATES to the default manager rather than replacing it. Headless
 * tools install their own modifier there to turn the game's root-absolute asset
 * paths into file URLs (tools/assetshim.ts); resolving through it at request time
 * composes with whatever they installed, in either install order.
 */
function fbxLoader(): FBXLoader {
  if (fbx) return fbx;
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) =>
    THREE.DefaultLoadingManager.resolveURL(url.replace(/\.psd$/i, '.png')),
  );
  fbx = new FBXLoader(manager);
  return fbx;
}

/**
 * Produces one model's scene graph, picking the source from its URL.
 *
 * Asset-file cameras and lights are authoring aids, never vehicle parts. Keeping
 * them makes every spawned copy add another renderer light; the updated Soviet
 * FBXs contain Blender scene lights, which overwhelmed the sun around each car.
 */
async function loadScene(file: string): Promise<THREE.Group> {
  let scene: THREE.Group;
  if (file.toLowerCase().endsWith('.fbx')) {
    scene = await fbxLoader().loadAsync(file);
  } else {
    gltf ??= new GLTFLoader();
    scene = (await gltf.loadAsync(file)).scene;
  }

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

/** Stable string avalanche: a saved/generated car keeps its colour across reloads. */
function paintColorFor(modelId: string, appearanceKey: string): THREE.Color {
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
  return paintScratch.setHex(CAR_PAINT_COLORS[(h >>> 0) % CAR_PAINT_COLORS.length]!);
}

/**
 * Whether a mesh carries any of its body's paint.
 *
 * Soviet bodies are one mesh each, named `<model>body`. Stylized bodies spread
 * their paint over the shell, the four doors and the interior trim, every one of
 * which uses the pack's single palette material — so the mesh is selected by what
 * it is made of rather than by name, and the glass and lens meshes fall out.
 */
function isRandomPaintMesh(mesh: THREE.Mesh, def: CarModelDef): boolean {
  if (def.paintStyle === 'soviet-atlas') return mesh.name.endsWith('body');
  if (def.paintStyle === 'stylized-palette') {
    return materialsOf(mesh).some((material) => isPaintSlot(material, def));
  }
  return false;
}

/**
 * Whether one material slot of a paint mesh is the paint itself.
 *
 * A Soviet body mesh has exactly one slot, so all of it is paint. A Stylized body
 * mesh has six — palette, glass, and four lamp lenses — and only the palette slot
 * may be repainted or weathered: rusting a headlight is not a thing.
 */
function isPaintSlot(material: THREE.Material, def: CarModelDef): boolean {
  if (def.paintStyle === 'stylized-palette') return material.name === STYLIZED_PAINT_MATERIAL;
  return true;
}

/**
 * Gives each car independent condition uniforms while preserving the exact paint
 * slot. Packs with a paint style name their paint; a pack without one is repainted
 * whole, which is what its single-material bodies describe.
 */
function cloneCarBodyPaintMaterials(root: THREE.Object3D, def: CarModelDef): void {
  const clones = new Map<THREE.Material, THREE.Material>();
  const paint = (source: THREE.Material): THREE.Material => {
    const existing = clones.get(source);
    if (existing) return existing;
    const material = makeCarBodyConditionMaterial(source);
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
    // Soviet paint needs its atlas cell swapped in the shader. Stylized paint needs
    // no shader at all: its colour arrives as a rebuilt palette texture.
    const material =
      def.paintStyle === 'soviet-atlas' ? makeCarPalettePaintMaterial(source) : source.clone();
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

/** Writes one deterministic per-car colour into already-independent paint materials. */
function applyRandomPaint(root: THREE.Object3D, def: CarModelDef, appearanceKey: string): void {
  if (!def.paintStyle) return;
  const color = paintColorFor(def.id, appearanceKey);
  const palette =
    def.paintStyle === 'stylized-palette' ? repaintedPalette(def, color) : null;
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh) || !isRandomPaintMesh(child, def)) return;
    for (const material of materialsOf(child)) {
      if (!(material instanceof THREE.MeshStandardMaterial)) continue;
      if (!isPaintSlot(material, def)) continue;
      if (palette) {
        if (material.map === palette) continue;
        material.map = palette;
        material.needsUpdate = true;
      } else if (def.paintUvCell) {
        setCarBodyPalettePaint(material, color, def.paintUvCell);
      }
    }
  });
}

/**
 * The pack palettes, decoded once so their ramps can be rebuilt in other colours.
 *
 * Keyed by texture URL rather than by model: the Stylized pack's thirty-one bodies
 * share one 32x32 image, so it is decoded once for all of them.
 */
const paletteImages = new Map<string, ImageData>();
/** Recoloured palettes, keyed by ramp and colour. At most one per colour per ramp. */
const repaintedPalettes = new Map<string, THREE.Texture>();
const paintRGB = { r: 0, g: 0, b: 0 };

/**
 * Decodes a loaded palette texture's pixels, so a ramp can be read and rebuilt.
 *
 * A headless tool has neither a decoder nor a canvas, and the shared asset shim
 * deliberately resolves every texture to one blank object (tools/assetshim.ts) —
 * nothing a physics or geometry bench measures reads a pixel. So this records
 * nothing rather than throwing, and repainting is skipped for the run: those cars
 * keep the pack's authored colour, which no bench looks at.
 */
function readPaletteImage(url: string, texture: THREE.Texture): void {
  if (paletteImages.has(url)) return;
  if (typeof document === 'undefined') return;
  // TextureLoader hands back an HTMLImageElement, which is what a 2D context draws.
  const image = texture.image as HTMLImageElement | undefined;
  if (!image?.width || !image.height) return;
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return;
  ctx.drawImage(image, 0, 0);
  paletteImages.set(url, ctx.getImageData(0, 0, canvas.width, canvas.height));
}

/**
 * One car's palette: the pack's own image with this body's coachwork ramp rebuilt
 * in `color`.
 *
 * Each shade keeps its LUMINANCE RATIO against the ramp's key shade, which is what
 * carries the pack's hand-drawn shading into every factory colour: the key shade
 * becomes the colour asked for, brighter shades stay highlights, and the near-black
 * end of a long ramp — window rubbers, shut lines, shadow under a wing — stays
 * near-black instead of turning into a second body colour.
 *
 * Only the ramp is touched, so glass, chrome, lamps, decals and the tyres on the
 * detached wheels (which keep the pack's untouched material) are all preserved.
 *
 * Null when the palette could not be decoded — a headless bench, per
 * `readPaletteImage` — in which case the car keeps the pack's authored colour.
 */
function repaintedPalette(def: CarModelDef, color: THREE.Color): THREE.Texture | null {
  const url = def.textureFile;
  const ramp = def.paintRamp;
  if (!url || !ramp) throw new Error(`Car model "${def.id}" has no palette ramp to repaint`);
  const source = paletteImages.get(url);
  if (!source) return null;

  const key = `${url}|${ramp.column},${ramp.columns},${ramp.row},${ramp.rows},${ramp.keyRow}|${color.getHexString(THREE.SRGBColorSpace)}`;
  const cached = repaintedPalettes.get(key);
  if (cached) return cached;

  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const pixels = new ImageData(new Uint8ClampedArray(source.data), source.width, source.height);
  // The palette is stored, sampled and blended in sRGB, so the target colour has to
  // leave the renderer's linear working space before it is written into it.
  color.getRGB(paintRGB, THREE.SRGBColorSpace);
  const keyLuma = Math.max(1, paletteLuma(pixels, ramp.column, ramp.keyRow));
  for (let row = ramp.row; row < ramp.row + ramp.rows; row++) {
    const factor = paletteLuma(pixels, ramp.column, row) / keyLuma;
    const r = Math.min(255, Math.round(paintRGB.r * 255 * factor));
    const g = Math.min(255, Math.round(paintRGB.g * 255 * factor));
    const b = Math.min(255, Math.round(paintRGB.b * 255 * factor));
    for (let column = ramp.column; column < ramp.column + ramp.columns; column++) {
      const i = (row * source.width + column) * 4;
      pixels.data[i] = r;
      pixels.data[i + 1] = g;
      pixels.data[i + 2] = b;
    }
  }
  ctx.putImageData(pixels, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  tunePaletteTexture(texture);
  repaintedPalettes.set(key, texture);
  return texture;
}

function paletteLuma(image: ImageData, column: number, row: number): number {
  const i = (row * image.width + column) * 4;
  return 0.299 * image.data[i]! + 0.587 * image.data[i + 1]! + 0.114 * image.data[i + 2]!;
}

/**
 * Sampling for a palette atlas.
 *
 * Both packs paint by UV: a face points at one swatch of a small image, so there is
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
 * Points a subtree's PAINT material at the pack's palette.
 *
 * Which material is "the paint" is not a guess: a body is authored with one
 * palette-mapped slot for its painted panels and flat-coloured slots for
 * everything else (glass, lamp lenses), so a material that ALREADY has a map is
 * the palette slot and a material without one is a part colour. A body with no
 * mapped slot at all — the Soviet FBXs, which reference no texture — has nothing
 * to distinguish, so its single material takes the palette.
 *
 * Materials are cloned once per source material, not once per mesh, so slots shared
 * between meshes stay one material and one draw call's worth of state.
 */
function applyTexture(root: THREE.Object3D, map: THREE.Texture): void {
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
    if (textured && !standard.map) {
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

function prepareMaterials(root: THREE.Object3D): void {
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    // Glass is the one surface that must not cast: a window throws a pane-shaped
    // black slab across the interior and the ground, which is the shadow of a
    // wall, not of a window.
    child.castShadow = !materialsOf(child).includes(carGlassMaterial());
    child.receiveShadow = true;
    // A pack that authored `doubleSided: true` would otherwise store its LIT face in
    // the sun's depth map (three flips FrontSide to BackSide for the depth pass but
    // leaves DoubleSide alone) and every panel would test against its own depth. The
    // bias that used to hide that was wide enough to eat the car's contact shadow;
    // it is 2 cm now, so the invariant is stated here instead — see render/sky.ts.
    for (const material of materialsOf(child)) material.shadowSide = THREE.BackSide;
  });
}

/**
 * The one window glass in the game, shared by every car of both packs.
 *
 * Shared rather than per-pack on purpose: glass is glass, and one material means
 * one program, one draw state and one place to tune the tint. `depthWrite: false`
 * because a window must not occlude what is behind it in the transparent pass —
 * with depth writing on, the nearest pane wins the depth test and the cabin, the
 * far windows and anything seen through the car vanish behind it.
 */
let glassMaterial: THREE.MeshStandardMaterial | null = null;

function carGlassMaterial(): THREE.MeshStandardMaterial {
  glassMaterial ??= new THREE.MeshStandardMaterial({
    name: 'car-glass',
    // A dark cold tint at low opacity: period glass is green-grey and thick, and
    // anything clearer makes the cabin read as an open hole in the shell.
    color: 0x18242a,
    transparent: true,
    opacity: 0.42,
    roughness: 0.06,
    metalness: 0,
    // Both faces: from the driver's seat every window is seen from the inside.
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  return glassMaterial;
}

/**
 * Makes a body's windows see-through, whichever way its pack drew them.
 *
 * `glassMaterial` names an authored material on separate window meshes (Stylized),
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
 * Lifts each named lamp MATERIAL out of its host mesh into a mesh of its own.
 *
 * The Stylized pack draws headlights, brake lights and both indicators as material
 * groups of the body mesh, and lists those materials as unused slots on the doors
 * and windows besides. Binding lamps by material name against that (vehicle.ts,
 * `bindLampMaterials`) gives two wrong answers at once: the lens bounds come out as
 * the WHOLE body — so headlight beams start from the middle of the car — and the
 * doors match too, dragging their boxes into the union.
 *
 * Splitting fixes both at the source, and costs nothing to draw: a material group
 * was already its own draw call. Each lamp's triangles become one mesh named after
 * the material, a sibling sharing the host's transform, and the host is rebuilt
 * with only the groups it has left — which also drops every slot no geometry of its
 * own referenced, so the doors stop answering to `Headlights`.
 *
 * A pack that models its lamps as real objects (the Soviet FBXs) names those
 * objects in its selectors, matches no material here, and passes through untouched.
 */
function isolateLampMaterials(scene: THREE.Group, def: CarModelDef): void {
  const lights = def.lights;
  if (!lights) return;
  const wanted = new Set<string>([
    ...lights.headlights,
    ...lights.taillights,
    ...(lights.reverseLights ?? []),
    ...(lights.leftBlinkers ?? []),
    ...(lights.rightBlinkers ?? []),
  ]);

  const meshes: THREE.Mesh[] = [];
  scene.traverse((node) => {
    if (node instanceof THREE.Mesh && Array.isArray(node.material)) meshes.push(node);
  });

  for (const mesh of meshes) {
    const materials = mesh.material as THREE.Material[];
    const groups = mesh.geometry.groups;
    if (groups.length === 0) continue;

    const byIndex = new Map<number, { start: number; count: number }[]>();
    for (const group of groups) {
      const index = group.materialIndex ?? 0;
      const ranges = byIndex.get(index);
      if (ranges) ranges.push({ start: group.start, count: group.count });
      else byIndex.set(index, [{ start: group.start, count: group.count }]);
    }

    const kept: THREE.Material[] = [];
    const keptGroups: { start: number; count: number; materialIndex: number }[] = [];
    for (const [index, ranges] of byIndex) {
      const material = materials[index];
      if (!material) continue;
      if (wanted.has(material.name)) {
        const lens = new THREE.Mesh(subGeometry(mesh.geometry, ranges), material);
        lens.name = material.name;
        lens.position.copy(mesh.position);
        lens.quaternion.copy(mesh.quaternion);
        lens.scale.copy(mesh.scale);
        mesh.parent?.add(lens);
        continue;
      }
      const slot = kept.length;
      kept.push(material);
      for (const range of ranges) {
        keptGroups.push({ start: range.start, count: range.count, materialIndex: slot });
      }
    }

    if (kept.length === 0) {
      // Nothing but lamps: the host has become an empty shell of its own children.
      mesh.removeFromParent();
      continue;
    }
    // The array form is kept even for a single surviving slot. Three only walks
    // `geometry.groups` when the material IS an array; given one material it ignores
    // them and draws the whole buffer — which still holds the lamp triangles just
    // lifted out, so every lens would be drawn a second time in body paint.
    mesh.material = kept;
    mesh.geometry.clearGroups();
    for (const group of keptGroups) {
      mesh.geometry.addGroup(group.start, group.count, group.materialIndex);
    }
  }
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
    prepareMaterials(wrapper);
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

/** The node every pack names its steering wheel, and the cut cabin keeps. */
export const STEERING_WHEEL_NODE = 'steering_wheel';

/**
 * How much of a hollow body's width a fitted cabin fills.
 *
 * The donor is a 2.12 m-wide Stylized saloon and the Soviet shells are 1.56 m, so
 * the cabin is always scaled DOWN. Width is the only fit constraint that matters:
 * it is what decides whether a seat pokes through a door, and the cabin is much
 * shorter than any body so length never binds. A little under full width leaves the
 * door cards inside the shell rather than in it.
 */
const INTERIOR_WIDTH_FRACTION = 0.9;
/**
 * Where the fitted cabin's own centre sits in the host body, as fractions of that
 * body's box: y through its height (0 = floor, 1 = roof) and z of half-length.
 *
 * Both are the donor's OWN measured numbers (tools/extract-interior.mjs reports
 * 0.4854 and -0.0975), which is the point: a cabin belongs at the same place in any
 * saloon, and a fraction carries that across bodies of different sizes. Aligning
 * the cabin's FLOOR to the body's floor instead — the obvious rule — puts it on the
 * underbody: a body box's lowest point is its sills, not the floor pan, and once the
 * cabin is scaled down to a narrower car it then sits a foot too low, with the
 * driver's eye level with the door handles.
 */
const INTERIOR_Y_FRACTION = 0.485;
const INTERIOR_Z_FRACTION = -0.1;

/**
 * Fits the cut cabin into a body that has none, sized and placed from that body's
 * own measured box.
 *
 * The kit arrives in METRES about its donor's body centre; the scene it is being
 * added to is still in the model's own units and will be scaled by `def.scale`
 * afterwards, so both the fit scale and the offset are divided back out by it.
 */
function mountInterior(def: CarModelDef, scene: THREE.Group, bodyBox: THREE.Box3): void {
  const source = interiorScenes.get(def.interior!.file);
  if (!source) throw new Error(`Interior "${def.interior!.file}" was not preloaded`);
  const kit = source.clone(true);
  const kitBox = boundsOf(kit);
  const kitWidth = kitBox.max.x - kitBox.min.x;
  if (kitWidth <= 0) return;

  const size = bodyBox.getSize(new THREE.Vector3());
  const centre = bodyBox.getCenter(new THREE.Vector3());
  const fit = (size.x * INTERIOR_WIDTH_FRACTION) / kitWidth;
  const mount = new THREE.Group();
  mount.name = 'interior';
  mount.add(kit);
  mount.scale.setScalar(fit / def.scale);
  mount.position.set(
    centre.x / def.scale,
    (centre.y + (INTERIOR_Y_FRACTION * 2 - 1) * size.y * 0.5) / def.scale,
    (centre.z + INTERIOR_Z_FRACTION * size.z * 0.5) / def.scale,
  );
  scene.add(mount);
}

/**
 * The driver's eye: behind the steering wheel and above its centre.
 *
 * Derived from the wheel rather than authored per model, because the wheel is the
 * one thing in a cabin whose position IS the driver's position — it fixes which
 * side the seat is on, how far back it sits and how high. Forty-six bodies would
 * otherwise need forty-six hand-tuned fractions, and every one of them would be a
 * guess at where a seat is.
 *
 * Called AFTER the scene has been scaled and re-centred, so the wheel's world
 * transform is already the chassis-local frame in metres and needs no conversion —
 * subtracting the body centre a second time here is what put the eye under the floor
 * the first time round.
 *
 * Null for a body with no wheel at all, which falls back to the authored fraction.
 */
function driverEyePoint(scene: THREE.Group): [number, number, number] | null {
  const wheel = scene.getObjectByName(STEERING_WHEEL_NODE);
  if (!wheel) return null;
  // Bounds, not the node origin: a steering column's origin sits at the dash end of
  // the shaft, a good 12 cm ahead of the rim it is named for.
  const rim = new THREE.Box3()
    .setFromObject(wheel, true)
    .getCenter(new THREE.Vector3());
  return [rim.x, rim.y + EYE_ABOVE_WHEEL_M, rim.z - EYE_BEHIND_WHEEL_M];
}

/**
 * The driver's eye relative to the steering wheel's centre, metres.
 *
 * A driver's eyes are roughly a hand's width above the rim and a third of a metre
 * behind it — the gap between the wheel and the seat back. Any less and the rim
 * fills the screen; any more and the eye leaves the seat and ends up in the back.
 */
const EYE_ABOVE_WHEEL_M = 0.14;
const EYE_BEHIND_WHEEL_M = 0.38;

/** Measures a loaded scene and splits it into a body template plus wheel templates. */
function buildTemplate(def: CarModelDef, scene: THREE.Group): Template {
  if (def.yaw) applyModelYaw(scene, def.yaw);
  // Nodes the game does not model go before anything is measured, so they cannot
  // widen the chassis box or be mistaken for running gear.
  for (const name of def.unusedNodes ?? []) scene.getObjectByName(name)?.removeFromParent();
  isolateLampMaterials(scene, def);
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

  // Fractional anchor/eye resolution, straight into CHASSIS-LOCAL metres: x of
  // half-width, y through the body's height (0 = floor, 1 = roof), z of half-length.
  //
  // Chassis-local is the only frame these can be resolved in. Resolving them in the
  // model's OWN space and subtracting `centre` afterwards — which is what this did —
  // silently broke every body whose box is not centred on its own origin: `frac *
  // half` measured from the origin came out one offset wrong, and the fallback eye
  // and every gizmo anchor went with it. Resolving in chassis space makes the
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

  // The cabin is fitted AFTER the body box is known, because the box is what it is
  // fitted to, and it deliberately does not widen that box: an interior cannot make
  // a car bigger.
  if (def.interior) mountInterior(def, scene, bodyBox);

  scene.scale.setScalar(s);
  scene.position.set(-centre.x, -centre.y, -centre.z);
  prepareMaterials(scene);
  scene.updateMatrixWorld(true);

  // The model's origin is on the ground between the wheels, so the distance from
  // the chassis centre down to that origin is exactly the spawn clearance needed
  // for the body to settle onto its wheels rather than through them.
  const measure: CarModelMeasure = {
    halfExtents: [half.x, half.y, half.z],
    wheels,
    eyePoint: driverEyePoint(scene) ?? resolveFrac(def.viewFrac),
    anchors,
    visualOffset: [-centre.x, -centre.y, -centre.z],
  };

  return { def, measure, body: scene, wheels: parts.objects };
}

/** One shared palette per pack, loaded once and pointed at by every body in it. */
const paletteTextures = new Map<string, THREE.Texture>();
/**
 * The fitted cabin, parsed once per asset. Every body that borrows it clones the
 * same scene, so the geometry is one buffer however many cars carry it.
 */
const interiorScenes = new Map<string, THREE.Group>();

/**
 * Loads a pack's palette, tunes its sampling and decodes its pixels.
 *
 * The pixels are needed as well as the texture: repainting a Stylized body means
 * rebuilding one ramp of this image, which cannot be read back off the GPU.
 */
async function loadPalette(url: string, fbxSource: boolean): Promise<THREE.Texture> {
  const cached = paletteTextures.get(url);
  if (cached) return cached;
  textures ??= new THREE.TextureLoader();
  const map = await textures.loadAsync(url);
  // V origin follows the FORMAT, not the pack: glTF UVs are top-down and need no
  // flip, while FBX counts V from the bottom, which is what TextureLoader's default
  // flip already produces. Flipping an FBX pack's palette anyway samples it upside
  // down — roof paint on the sills, tyre black across the glass.
  map.flipY = fbxSource;
  tunePaletteTexture(map);
  readPaletteImage(url, map);
  paletteTextures.set(url, map);
  return map;
}

/**
 * Loads every model in `ids` (default: the whole catalogue) and measures it.
 *
 * Must finish before the first `Vehicle` is constructed: a vehicle's collider,
 * suspension and mass all come out of the measurement, so there is no meaningful
 * "not loaded yet" state for it to run in. The catalogue is ~10 MB of FBX in total
 * and loads from the same origin, which is why loading all of it up front is
 * cheaper than a streaming path nobody would otherwise need.
 */
export async function preloadCarModels(ids?: readonly string[]): Promise<void> {
  const defs = ids ? ids.map(carModel) : CAR_MODELS;

  // Palettes first, and once per pack rather than once per body: a body cannot be
  // repainted until the image its ramp lives in has been decoded.
  const palettes = new Map<string, boolean>();
  for (const def of defs) {
    if (def.textureFile) {
      palettes.set(def.textureFile, def.file.toLowerCase().endsWith('.fbx'));
    }
  }
  for (const def of defs) {
    // The cabin is a glTF, but its UVs were CUT OUT of an FBX and never reoriented,
    // so its palette is sampled the FBX way — same flip as the pack it came from,
    // which is also what keeps one shared texture serving both.
    if (def.interior) palettes.set(def.interior.textureFile, true);
  }
  await Promise.all([...palettes].map(([url, fbxSource]) => loadPalette(url, fbxSource)));

  // The fitted cabin, once for every body that borrows it. It is measured against
  // each body's box at template time, so one parse serves all fifteen.
  const interiors = new Map<string, string>();
  for (const def of defs) {
    if (def.interior && !interiorScenes.has(def.interior.file)) {
      interiors.set(def.interior.file, def.interior.textureFile);
    }
  }
  await Promise.all(
    [...interiors].map(async ([file, textureFile]) => {
      const scene = await loadScene(file);
      applyTexture(scene, paletteTextures.get(textureFile)!);
      tuneMaps(scene);
      interiorScenes.set(file, scene);
    }),
  );

  await Promise.all(
    defs.map(async (def) => {
      if (templates.has(def.id)) return;
      const scene = await loadScene(def.file);
      if (def.textureFile) applyTexture(scene, paletteTextures.get(def.textureFile)!);
      tuneMaps(scene);
      templates.set(def.id, buildTemplate(def, scene));
    }),
  );
}

function template(id: string): Template {
  const t = templates.get(id);
  if (!t) throw new Error(`Car model "${id}" was not preloaded`);
  return t;
}

/** Measurements for a preloaded model. */
export function carModelMeasure(id: string): CarModelMeasure {
  return template(id).measure;
}

/** Clear air below a newly-created car before gravity settles its suspension. */
export const CAR_SPAWN_DROP_METRES = 0.75;

/**
 * Chassis-centre Y that leaves the complete visual—body and detached wheels—above
 * the sampled ground. Model origins vary across packs, so neither `halfExtents.y`
 * nor the authored origin is a reliable universal floor by itself.
 *
 * Open-world spawns use the default 0.75 m drop. Constrained interiors may request
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
  cloneCarBodyPaintMaterials(body, t.def);
  applyRandomPaint(body, t.def, appearanceKey);
  body.position.y += visualBodyLift(t);
  body.name = 'body';
  return { body, wheels };
}

/** A fresh instance of a preloaded model, sharing geometry but owning its paint state. */
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
 * Clones one driving and one static instance of each model while the loading screen
 * is up, then compiles every car material against the live scene lights. Asset parse,
 * scene-graph clone and GPU program compilation are therefore all paid before play;
 * a POI entering view performs no first-use model work.
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
  for (let i = 0; i < CAR_MODELS.length; i++) {
    const id = CAR_MODELS[i]!.id;
    const drivingModel = cloneDrivingModel(template(id));
    warmDrivingInstances.set(id, drivingModel);
    drivingBodies.push(drivingModel.body);
    compileGroup.add(drivingModel.body);
    const staticModel = cloneStaticModel(id);
    staticModel.traverse((object) => {
      object.frustumCulled = false;
    });
    warmStaticInstances.set(id, staticModel);
    compileGroup.add(staticModel);
    if ((i & 1) === 1) await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
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
  // The cached cabin shares geometry and materials with the templates just walked,
  // so it goes through the SAME dedup sets — a buffer freed there must not be freed
  // a second time here.
  for (const kit of interiorScenes.values()) dispose(kit);
  interiorScenes.clear();
  // Palettes are shared by every body in a pack and by every recoloured copy, so
  // they are released here rather than through the per-material walk above, which
  // would otherwise free one pack's palette on the first car that referenced it.
  for (const texture of paletteTextures.values()) texture.dispose();
  paletteTextures.clear();
  for (const texture of repaintedPalettes.values()) texture.dispose();
  repaintedPalettes.clear();
  paletteImages.clear();
  glassMaterial = null;
}
