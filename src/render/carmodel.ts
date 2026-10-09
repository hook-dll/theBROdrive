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
import { mergeGeometries, toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  CAR_BODY_POSITION_ATTRIBUTE,
  CAR_SURFACE_FINISH,
  makeCarBodyConditionMaterial,
  makeUnifiedAtlasMaterial,
  makeUnifiedSurfaceMaterial,
  makeCarGrimeMaterial,
  carPaintGrimeFrame,
  setCarBodyCondition,
  setCarBodyPalettePaint,
  setCarGrime,
  weatherStaticCarPaint,
  TINTED_GLASS,
  type CarBodyFrame,
  type CarSurfaceFinish,
} from './materials';
import { CarBodySurface, GLASS_DIRT_SHARE } from './carsurface';
import { CarStickerDecals, type StickerDecalSurface } from './stickerdecals';
import {
  CAR_MODELS,
  carModel,
  type CarModelDef,
  type CarModelFit,
} from '../vehicle/carmodels';
import {
  appearanceHash,
  factoryPaintHex,
  secondaryFactoryPaintHex,
} from '../vehicle/carpaint';
import { lampLensAnchors } from '../vehicle/vehiclelamps';

/**
 * DEV-only A/B switch for the unified car style: `?carstyle=unified`, alongside any
 * other lab flag.
 *
 * Read ONCE, at module load, because a template is measured, creased and given its
 * materials exactly once and every car in the world is then cloned from it —
 * switching style mid-session would have to rebuild all of it, so the car lab
 * reloads instead (see `car-lab.ts`).
 *
 * `import.meta.env.DEV` folds to a constant false in a production build, and it is
 * tested first so nothing below can run there. The optional chaining lets this
 * module load under the headless tools, which have neither Vite's env object nor a
 * window.
 */
export const CAR_STYLE_UNIFIED: boolean =
  import.meta.env?.DEV === true &&
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('carstyle') === 'unified';

/** How far apart two faces must point before their normals stop being averaged. */
const CAR_CREASE_ANGLE = (35 * Math.PI) / 180;

/**
 * The surfaces the GTA conversions name outright. Forcing them to the palette is what
 * makes a GTA car's black trim read as the same black as the Soviet atlas moulding
 * cell the paint shader re-shades.
 */
const NAMED_SURFACE_FINISH: Readonly<Record<string, CarSurfaceFinish>> = {
  car_trim: CAR_SURFACE_FINISH.trim,
  Tyres: CAR_SURFACE_FINISH.rubber,
  wheel_rim: CAR_SURFACE_FINISH.rim,
};

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

export interface CarModelMeasure {
  /** Chassis box half-extents, metres. */
  readonly halfExtents: readonly [number, number, number];
  readonly wheels: readonly WheelMeasure[];
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
  /** Where the road reaches this body, for the paint's dirt placement. */
  readonly frame: CarBodyFrame;
}

const templates = new Map<string, Template>();
const modelLoads = new Map<string, Promise<void>>();
const paletteLoads = new Map<string, Promise<THREE.Texture>>();

/**
 * Compiles an object's programs as the frame will draw them; the game's is
 * `Renderer.compileForScenePass`. Resolves when every program has linked.
 */
export type CarProgramCompiler = (object: THREE.Object3D) => Promise<unknown>;

/**
 * PROGRAM ANCHORS: one never-drawn copy of every loaded model — the driven body and its
 * wheels, the static shell wrecks and couriers use, and the lamp lenses a Vehicle binds
 * — compiled before the model counts as loaded, then kept for the session.
 *
 * A model's first draw used to link its programs on the spot. Paint, glass and lens
 * variants differ across packs (Phong or Standard, palette map or none, the static
 * shell single-sided), each is a lit program carrying every light slot, and on ANGLE's
 * D3D11 one link is hundreds of milliseconds of main thread: the freezes from the first
 * seconds of a drive, while traffic was still bringing models in. The warm-up these
 * replace compiled clones against the canvas instead of the scene pass's target (a
 * different program), never saw the lens materials a Vehicle makes, and cloned every
 * model met so far again for each new one.
 *
 * KEPT because a program dies with its last material: a despawning traffic car disposes
 * its own, and a variant only traffic used was linked again by the next car of it.
 */
const programAnchors = new THREE.Group();
programAnchors.name = 'car-program-anchors';
/** Per model: its anchor built, and compiled once a compiler is registered. */
const modelReadiness = new Map<string, Promise<void>>();
/** Models whose `modelReadiness` has resolved: an instance draws without a link stall. */
const readyModels = new Set<string>();
let programCompiler: CarProgramCompiler | null = null;
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

const paintScratch = new THREE.Color();
const secondaryPaintScratch = new THREE.Color();

function paintColorFor(modelId: string, appearanceKey: string): THREE.Color {
  return paintScratch.setHex(factoryPaintHex(modelId, appearanceKey));
}

function secondaryPaintColorFor(modelId: string, appearanceKey: string): THREE.Color {
  return secondaryPaintScratch.setHex(secondaryFactoryPaintHex(modelId, appearanceKey));
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
 * Gives one car instance its own condition-shaded copy of each paint slot, leaving
 * glass, lamps and trim on their shared materials, and returns those copies.
 *
 * The returned list IS the car's paint handle. Everything that later writes dirt or
 * scratches writes it through this list, so nothing has to walk the car's scene graph
 * to find its paint again.
 */
function cloneCarBodyPaintMaterials(
  root: THREE.Object3D,
  t: Template,
  appearanceKey: string,
): THREE.Material[] {
  const def = t.def;
  const seed = appearanceHash(def.id, appearanceKey);
  const clones = new Map<THREE.Material, THREE.Material>();
  const paint = (source: THREE.Material): THREE.Material => {
    const existing = clones.get(source);
    if (existing) return existing;
    const material = makeCarBodyConditionMaterial(source, t.frame, seed, CAR_STYLE_UNIFIED);
    clones.set(source, material);
    return material;
  };

  root.traverse((mesh) => {
    if (!(mesh instanceof THREE.Mesh) || !isRandomPaintMesh(mesh, def)) return;
    const eligible = (source: THREE.Material): THREE.Material =>
      isPaintSlot(source, def) ? paint(source) : source;
    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map(eligible)
      : eligible(mesh.material);
  });
  return [...clones.values()];
}

/**
 * Stamps every paint and window-glass vertex of a freshly fitted template with its
 * chassis-local position (`CAR_BODY_POSITION_ATTRIBUTE`), which is what the paint's
 * dirt and scratch placement, and the dust on the glass, are computed in.
 *
 * Runs once per model at load, after the fit, the ride drop and the rest of
 * `buildTemplate` have placed the body, so the stamp is exactly where the metal is.
 * The scene has no parent here, so each mesh's world matrix IS its chassis frame.
 * A geometry shared by two meshes under different transforms (a mirrored pair) is
 * split first: one attribute cannot hold two positions.
 */
function stampCarBodyPositions(scene: THREE.Group, def: CarModelDef): void {
  scene.updateMatrixWorld(true);
  const stamped = new Map<THREE.BufferGeometry, THREE.Matrix4>();
  scene.traverse((mesh) => {
    if (!(mesh instanceof THREE.Mesh)) return;
    // Window glass takes the stamp too: its dust is the paint's, laid in the same frame.
    const glass = materialsOf(mesh).includes(carGlassMaterial());
    if (!glass && !isRandomPaintMesh(mesh, def)) return;
    if (!glass && !materialsOf(mesh).some((material) => isPaintSlot(material, def))) return;
    const owner = stamped.get(mesh.geometry);
    if (owner) {
      if (owner.equals(mesh.matrixWorld)) return;
      mesh.geometry = mesh.geometry.clone();
    }
    const position = mesh.geometry.getAttribute('position');
    const values = new Float32Array(position.count * 3);
    for (let i = 0; i < position.count; i++) {
      _sample.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
      values[i * 3] = _sample.x;
      values[i * 3 + 1] = _sample.y;
      values[i * 3 + 2] = _sample.z;
    }
    mesh.geometry.setAttribute(CAR_BODY_POSITION_ATTRIBUTE, new THREE.BufferAttribute(values, 3));
    stamped.set(mesh.geometry, mesh.matrixWorld.clone());
  });
}

/**
 * How long a static shell has stood in the desert, as the share of its paint the dust
 * has taken (0..1). Every static car is a roadside wreck or a working find seen from
 * afar: the key decides how long, so the same wreck is equally sand-blasted on every
 * pass. Written into its paint once (`weatherStaticCarPaint`), with the wear shader's
 * gate left shut, so a POI full of wrecks costs what clean cars cost.
 */
function derelictDust(modelId: string, appearanceKey: string): number {
  const h = appearanceHash(`${modelId}:derelict`, appearanceKey);
  return 0.35 + ((h & 0xffff) / 0xffff) * 0.25;
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
  const secondaryColor = def.secondaryPaintMaterial
    ? secondaryPaintColorFor(def.id, appearanceKey)
    : color;
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh) || !isRandomPaintMesh(child, def)) return;
    for (const material of materialsOf(child)) {
      if (!(material instanceof THREE.MeshStandardMaterial)) continue;
      if (!isPaintSlot(material, def)) continue;
      if (def.paintStyle === 'solid-paint') {
        material.map = null;
        material.color.copy(
          material.name === def.secondaryPaintMaterial ? secondaryColor : color,
        );
        material.needsUpdate = true;
      } else if (def.paintUvCell) {
        setCarBodyPalettePaint(material, color, def.paintUvCell);
      }
    }
  });
}

/**
 * Records, per mesh, the material slots a sticker may go on, and the palette cell if the
 * mesh is atlas paint. This is the one rule both sides use: placement accepts exactly
 * these slots (`player/interaction.ts` pickBody), and the decal path prints on exactly
 * their triangles (render/stickerdecals.ts).
 *
 * The slots are the paint slots and this car's own window glass. On a palette-atlas body
 * the sheet holds paint, chrome, glass and lamps in one swatch, so the mesh's slots say
 * nothing on their own: `stickerPaintCell` narrows its triangles to the paint cell, which
 * is what the printed decal's `carPaintPanel` test did per fragment.
 */
function markStickerSurfaces(root: THREE.Object3D, def: CarModelDef, glass: readonly THREE.Material[]): void {
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const materials = materialsOf(child);
    const paintMesh = isRandomPaintMesh(child, def);
    child.userData.stickerMaterialIndices = materials
      .map((material, index) =>
        glass.includes(material) || (paintMesh && isPaintSlot(material, def)) ? index : -1,
      )
      .filter((index) => index >= 0);
    child.userData.stickerPaintCell =
      paintMesh && def.paintStyle === 'soviet-atlas' && child.geometry.getAttribute('uv')
        ? def.paintUvCell
        : undefined;
  });
}

/**
 * Courier-only shader accent: turquoise paint with a bright view-angle rim.
 *
 * Takes the instance's own paint clones (`cloneCarBodyPaintMaterials`), never a scene
 * walk: wheels and trim are shared with every other car of the template, and a
 * solid-paint body counts all of them as paint, so writing through the graph repainted
 * every pool wheel in the world once the unified style made them Standard.
 */
function applyCourierAppearance(paint: readonly THREE.Material[]): void {
  for (const material of paint) {
    if (!(material instanceof THREE.MeshStandardMaterial)) continue;
    material.color.setHex(0x36b8b3);
    material.metalness = 0.68;
    material.roughness = 0.22;
    material.emissive.setHex(0x481b55);
    material.emissiveIntensity = 0.28;
    const previousCompile = material.onBeforeCompile;
    const previousKey = material.customProgramCacheKey;
    material.onBeforeCompile = (shader, renderer) => {
      previousCompile.call(material, shader, renderer);
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <opaque_fragment>',
        `outgoingLight += mix(vec3(0.05, 0.9, 0.82), vec3(0.9, 0.15, 0.72),
          0.5 + 0.5 * normal.y) * pow(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 2.2) * 1.4;
        #include <opaque_fragment>`,
      );
    };
    material.customProgramCacheKey = () => `${previousKey.call(material)}|courier-rim-v1`;
    material.needsUpdate = true;
  }
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
 *
 * Lamp lenses cast nothing either. A lens is a skin on the bodywork, so its shadow
 * falls inside the body's own and changes no pixel — but each one was a draw of its
 * own in the sun's depth pass, which made lenses over a third of that pass. `lenses`
 * names them (`lensNames`); a mesh that carries a lens AND paint in one buffer (a
 * multi-slot body) keeps casting, because its paint must.
 */
function prepareMaterials(root: THREE.Object3D, bodywork: boolean, lenses: ReadonlySet<string>): void {
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const materials = materialsOf(child);
    // Glass casts like the body round it. The sun is high, so its shadow of a car was
    // a solid silhouette whatever the windows did; the driven car's headlamps are low
    // and level (render/vehiclelights.ts), and with the glass left out they shone
    // straight through the cars ahead and drew them on the road with see-through
    // windows. A car's shadow is its silhouette, windows included.
    const lens = lenses.has(child.name) || materials.every((material) => lenses.has(material.name));
    child.castShadow = !lens;
    child.receiveShadow = !bodywork;
    // Wheels are closed solids, so their lit face is culled from the depth map and
    // the depth stored under them is metres away: they can receive safely, and a
    // wheel darkening under its own arch is worth having.
    for (const material of materials) material.shadowSide = THREE.BackSide;
  });
}

/**
 * Lenses no control ever switches: the SAAS pack's red rear fog lamp and its front
 * auxiliary lamps. They are lenses all the same, so they cast no shadow either.
 */
const UNSWITCHED_LENS_NODES: readonly string[] = ['rear_passive', 'front_auxiliary'];

/** Every node or material name that is a lamp lens on `def`: bound ones and unswitched. */
function lensNames(def: CarModelDef): Set<string> {
  const names = lampNames(def);
  for (const name of UNSWITCHED_LENS_NODES) names.add(name);
  return names;
}

/**
 * One material per distinct wheel finish, shared by every wheel of every model.
 *
 * A pack exports a material per wheel NODE, so four identical copies came with each
 * set, and the Soviet sets all paint their wheels from the one palette. Nothing about
 * a wheel's material is ever written per car — no dirt, no paint, no lamp — so the
 * copies bought nothing and cost a material switch on every wheel draw.
 */
const sharedWheelMaterials = new Map<string, THREE.Material>();

/**
 * What makes two materials draw identically: every own property except identity,
 * with textures compared by object. Null when the material carries its own shader
 * hooks, which no signature can compare.
 */
function materialSignature(material: THREE.Material): string | null {
  const parts: string[] = [material.type];
  for (const key of Object.keys(material).sort()) {
    if (key === 'uuid' || key === 'id' || key === 'name' || key === 'version' || key.startsWith('_')) continue;
    const value: unknown = (material as unknown as Record<string, unknown>)[key];
    if (typeof value === 'function') return null;
    let text: string;
    if (value instanceof THREE.Texture) text = `tex:${value.uuid}`;
    else if (value instanceof THREE.Color) text = `#${value.getHexString()}`;
    else if (value !== null && typeof value === 'object') text = JSON.stringify(value);
    else text = String(value);
    parts.push(`${key}=${text}`);
  }
  return parts.join(';');
}

function shareWheelMaterials(root: THREE.Object3D): void {
  const share = (material: THREE.Material): THREE.Material => {
    const signature = materialSignature(material);
    if (signature === null) return material;
    const shared = sharedWheelMaterials.get(signature);
    if (shared) return shared;
    sharedWheelMaterials.set(signature, material);
    return material;
  };
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.material = Array.isArray(child.material) ? child.material.map(share) : share(child.material);
  });
}

/**
 * Every node or material name the vehicle controller binds a lamp by (see
 * `Vehicle.bindLampMaterials`, which matches a mesh name first and a material name
 * second).
 */
function lampNames(def: CarModelDef): Set<string> {
  const names = new Set<string>();
  const lights = def.lights;
  if (!lights) return names;
  for (const selectors of [
    lights.headlights,
    lights.taillights,
    lights.brakeLights,
    lights.reverseLights,
    lights.leftBlinkers,
    lights.rightBlinkers,
  ]) {
    for (const name of selectors ?? []) names.add(name);
  }
  return names;
}

/** The only non-lamp material merged: every GTA-SA pack's bodywork trim. */
const MERGED_TRIM_MATERIAL = 'car_trim';

/** The six lamp role selectors on `def`, in the bit order `mergeStaticBodyMeshes` uses. */
function lampRoleSelectors(def: CarModelDef): readonly (readonly string[])[] {
  const lights = def.lights;
  if (!lights) return [];
  return [
    lights.headlights,
    lights.taillights,
    lights.brakeLights,
    lights.reverseLights,
    lights.leftBlinkers,
    lights.rightBlinkers,
  ].map((selectors) => selectors ?? []);
}

/**
 * Draw-call merge for the static body. Lamp lenses sharing a parent, material and lamp
 * role become one mesh, and so do `car_trim` meshes sharing a parent. The merged mesh
 * keeps the first member's name and transform is baked into its geometry, so bounds,
 * selectors and role bindings resolve to the same lenses as before. Paint, glass,
 * wheels, the steering wheel, unswitched lenses and anything carrying userData stay
 * separate. Runs after the chassis stamp, which only writes paint and glass.
 */
function mergeStaticBodyMeshes(scene: THREE.Group, def: CarModelDef): void {
  const roles = lampRoleSelectors(def);
  const lenses = lensNames(def);
  const groups = new Map<string, THREE.Mesh[]>();
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || !object.parent) return;
    // glTF copies a node's name into userData; anything beyond it is a runtime tag.
    if (object.children.length > 0 || Object.keys(object.userData).some((key) => key !== 'name')) return;
    if (Array.isArray(object.material) || object.name === STEERING_WHEEL_NODE) return;
    const material = object.material;
    if (isPaintSlot(material, def) && isRandomPaintMesh(object, def)) return;
    let role = 0;
    roles.forEach((selectors, bit) => {
      if (selectors.includes(object.name) || selectors.includes(material.name)) {
        role |= 1 << bit;
      }
    });
    if (role === 0) {
      if (material.name !== MERGED_TRIM_MATERIAL || isPaintSlot(material, def)) return;
      if (lenses.has(object.name)) return;
    }
    const attributes = Object.keys(object.geometry.attributes).sort().join(',');
    const key = [
      object.parent.uuid,
      // By what the material draws, not by identity: a pack exports one per node.
      `${material.name}#${materialSignature(material) ?? material.uuid}`,
      role,
      object.castShadow,
      object.receiveShadow,
      object.geometry.index ? 'indexed' : 'flat',
      attributes,
    ].join('|');
    const members = groups.get(key);
    if (members) members.push(object);
    else groups.set(key, [object]);
  });
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const geometries = members.map((mesh) => {
      mesh.updateMatrix();
      return mesh.geometry.clone().applyMatrix4(mesh.matrix);
    });
    const merged = mergeGeometries(geometries, false);
    if (!merged) continue;
    merged.computeBoundingBox();
    merged.computeBoundingSphere();
    const [first, ...rest] = members;
    if (!first) continue;
    first.geometry = merged;
    first.position.set(0, 0, 0);
    first.quaternion.identity();
    first.scale.set(1, 1, 1);
    for (const mesh of rest) mesh.removeFromParent();
  }
  scene.updateMatrixWorld(true);
}

/**
 * DEV-only `?carstyle=unified`: one material set for every car model.
 *
 * The packs arrive with incompatible materials. The Soviet FBXs are all Phong and
 * draw paint, bumpers, glass, tyres and everything between out of ONE shared swatch
 * atlas, while the GTA conversions are texture-free Standard materials whose
 * `car_trim`, `Tyres` and `wheel_rim` each carry their own authored finish. This
 * pass converts every authored Phong material to Standard and hands each non-paint
 * surface the palette's version of itself, so paint — already per-car and already
 * Standard on both packs — is the one thing a pack can still be told apart by.
 *
 * Runs once per model, from `loadModel` and BEFORE `buildTemplate`: the wheel
 * wrappers `takeOwnWheels` builds and the shadow sides `prepareMaterials` writes are
 * both created later, so that this pass's materials are the ones every instance then
 * clones. It also means a mesh is still named by its pack here, which is how the
 * lamps and the wheels are recognised.
 *
 * Two kinds of material are deliberately left alone: anything the light rig binds (a
 * lamp is a lens the vehicle drives, not a palette surface), and everything that is
 * already Standard, which is the whole GTA pack plus the shared glass `isolateGlass`
 * is about to install.
 *
 * Flag off, this returns before it reads a single mesh.
 */
function unifyCarMaterials(scene: THREE.Group, def: CarModelDef): void {
  if (!CAR_STYLE_UNIFIED) return;
  const lamps = lampNames(def);
  // A wheel's grey steel swatch is its own rim, not a bumper: see CAR_ATLAS_FINISH.
  // Packs that mark wheels only by shape are renamed too late for this pass, and no
  // shipped pack with an atlas does that (the Soviet pack names all four nodes).
  const wheelNodes = new Set<string>();
  for (const wheelId of WHEEL_IDS) {
    for (const name of def.wheelNodes?.[wheelId] ?? []) wheelNodes.add(name);
  }

  scene.traverse((mesh) => {
    if (!(mesh instanceof THREE.Mesh)) return;
    const lampMesh = lamps.has(mesh.name);
    const wheel = wheelNodes.has(mesh.name);
    const unify = (source: THREE.Material): THREE.Material => {
      if (lampMesh || lamps.has(source.name)) return source;
      const shared = NAMED_SURFACE_FINISH[source.name];
      if (shared) return makeUnifiedSurfaceMaterial(source, { finish: shared });
      if (!(source instanceof THREE.MeshPhongMaterial)) return source;
      // An atlas material: its surfaces are told apart by UV cell, not by slot.
      return source.map === null
        ? makeUnifiedSurfaceMaterial(source, { finish: CAR_SURFACE_FINISH.trim, keepColor: true })
        : makeUnifiedAtlasMaterial(source, wheel);
    };
    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map(unify)
      : unify(mesh.material);
  });
}

/**
 * The one window glass in the game, shared by every car of both packs.
 *
 * Shared rather than per-pack on purpose: glass is glass, and one material means
 * one program, one draw state and one place to tune the tint.
 */
let glassMaterial: THREE.MeshStandardMaterial | null = null;

/**
 * Gives one car instance its own copy of the shared glass, so its windows can gather
 * dust of their own (`makeCarGrimeMaterial`). One copy per car, not per pane: every
 * window of a car is as dirty as the rest. Returns the copies (none if no glass).
 */
function cloneCarGlass(root: THREE.Object3D, paint: readonly THREE.Material[]): THREE.Material[] {
  const shared = carGlassMaterial();
  // The panes lay the paint's dust in the paint's chassis frame (materials.ts
  // GLASS_GRIME_BODY); a car with no condition paint gets the lens's even film.
  const frame = paint.length > 0 ? carPaintGrimeFrame(paint[0]!) : null;
  let own: THREE.MeshStandardMaterial | null = null;
  const swap = (material: THREE.Material): THREE.Material => {
    if (material !== shared) return material;
    own ??= makeCarGrimeMaterial(shared.clone(), frame);
    return own;
  };
  root.traverse((mesh) => {
    if (!(mesh instanceof THREE.Mesh)) return;
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
  });
  return own ? [own] : [];
}

function carGlassMaterial(): THREE.MeshStandardMaterial {
  glassMaterial ??= new THREE.MeshStandardMaterial({
    name: 'car-glass',
    // Opaque sky mirror; the tint is shared with house windows (see TINTED_GLASS).
    ...TINTED_GLASS,
    transparent: false,
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

/** Cell size of the tail's painted silhouette, metres. */
const TAIL_CELL_M = 0.06;
/** A face counts as facing the tail once its normal is this aligned with the tail axis. */
const TAIL_FACING_DOT = 0.5;
/** How far behind a cell's outermost surface a plate may sit and still close that cell. */
const TAIL_PLATE_DEPTH_M = 0.05;

/**
 * Hands the glass material the rear screen of a body whose pack drew it as a trim plate.
 *
 * GTA SA models often fake a rear screen: the tailgate's opening is left empty and the
 * piece behind it is authored on the trim material, so the car reads as having a window
 * while no glass exists there. `sa_oka` is one (`CarModelDef.rearScreenMaterial`), and it
 * costs the game a real thing: the plate is a window to the player, but placement refuses
 * it — a sticker may only go on paint or glass — and the glass shader never renders there.
 *
 * Finding the plate needs no guesswork. Rasterize the tail's silhouette — every paint
 * triangle onto the car's own (x, y) — and the cells the paint leaves open INSIDE it are
 * its openings; the cells it leaves open at the border of the picture are just the edge
 * of the silhouette, which is where a bumper's own skin is. A rear-facing triangle of the
 * declared material in the rear half, in an opening cell, at that cell's outermost depth,
 * is the plate that closes that opening.
 *
 * `rearSign` is which way the tail points along Z (chassis metres: nose at +Z for the
 * packs that ship here, -Z for the Soviet ones). Runs once per model, at load, before the
 * wear chassis stamp reads the geometry.
 */
function glassOverTailOpening(scene: THREE.Group, def: CarModelDef, rearSign: number): void {
  const material = def.rearScreenMaterial;
  if (!material) return;
  scene.updateMatrixWorld(true);
  const box = boundsOf(scene);
  const nx = Math.max(1, Math.ceil((box.max.x - box.min.x) / TAIL_CELL_M));
  const ny = Math.max(1, Math.ceil((box.max.y - box.min.y) / TAIL_CELL_M));
  const painted = new Uint8Array(nx * ny);
  const outermost = new Float32Array(nx * ny).fill(-Infinity);
  const corners = new Float64Array(9);

  const cellX = (x: number): number => {
    const index = Math.floor((x - box.min.x) / TAIL_CELL_M);
    return index < 0 ? 0 : index >= nx ? nx - 1 : index;
  };
  const cellY = (y: number): number => {
    const index = Math.floor((y - box.min.y) / TAIL_CELL_M);
    return index < 0 ? 0 : index >= ny ? ny - 1 : index;
  };
  /** Reads one triangle of a mesh into `corners`, in chassis metres. */
  const readTriangle = (mesh: THREE.Mesh, tri: number): void => {
    const geometry = mesh.geometry;
    const index = geometry.index;
    const position = geometry.attributes.position as THREE.BufferAttribute;
    for (let c = 0; c < 3; c++) {
      const vertex = index ? index.getX(tri * 3 + c) : tri * 3 + c;
      _sample.fromBufferAttribute(position, vertex).applyMatrix4(mesh.matrixWorld);
      corners[c * 3] = _sample.x;
      corners[c * 3 + 1] = _sample.y;
      corners[c * 3 + 2] = _sample.z;
    }
  };
  /** How far back the triangle's rearward-most corner sits, or null if it faces elsewhere. */
  const tailFacing = (): number | null => {
    const e1x = corners[3]! - corners[0]!;
    const e1y = corners[4]! - corners[1]!;
    const e1z = corners[5]! - corners[2]!;
    const e2x = corners[6]! - corners[0]!;
    const e2y = corners[7]! - corners[1]!;
    const e2z = corners[8]! - corners[2]!;
    const nz = e1x * e2y - e1y * e2x;
    const length = Math.hypot(e1y * e2z - e1z * e2y, e1z * e2x - e1x * e2z, nz);
    if (length < 1e-12 || (nz / length) * rearSign <= TAIL_FACING_DOT) return null;
    return Math.max(corners[2]!, corners[5]!, corners[8]!) * rearSign;
  };
  /** Whether a point, in the triangle's own (x, y), lies inside it. */
  const coversCell = (x: number, y: number): boolean => {
    const d1 = (corners[3]! - corners[0]!) * (y - corners[1]!) - (corners[4]! - corners[1]!) * (x - corners[0]!);
    const d2 = (corners[6]! - corners[3]!) * (y - corners[4]!) - (corners[7]! - corners[4]!) * (x - corners[3]!);
    const d3 = (corners[0]! - corners[6]!) * (y - corners[7]!) - (corners[1]! - corners[7]!) * (x - corners[6]!);
    return (d1 >= 0 && d2 >= 0 && d3 >= 0) || (d1 <= 0 && d2 <= 0 && d3 <= 0);
  };

  // The tail's silhouette: what the paint covers, and the outermost surface over each
  // cell of it.
  scene.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    const materials = materialsOf(node);
    const paint = isRandomPaintMesh(node, def) && materials.some((m) => isPaintSlot(m, def));
    const count = node.geometry.index
      ? node.geometry.index.count / 3
      : node.geometry.attributes.position.count / 3;
    for (let tri = 0; tri < count; tri++) {
      readTriangle(node, tri);
      const depth = paint ? 0 : tailFacing();
      if (depth === null) continue;
      const x0 = cellX(Math.min(corners[0]!, corners[3]!, corners[6]!));
      const x1 = cellX(Math.max(corners[0]!, corners[3]!, corners[6]!));
      const y0 = cellY(Math.min(corners[1]!, corners[4]!, corners[7]!));
      const y1 = cellY(Math.max(corners[1]!, corners[4]!, corners[7]!));
      for (let iy = y0; iy <= y1; iy++) {
        const y = box.min.y + (iy + 0.5) * TAIL_CELL_M;
        for (let ix = x0; ix <= x1; ix++) {
          const x = box.min.x + (ix + 0.5) * TAIL_CELL_M;
          if (!coversCell(x, y)) continue;
          const cell = ix + iy * nx;
          if (paint) painted[cell] = 1;
          else if (depth > outermost[cell]!) outermost[cell] = depth;
        }
      }
    }
  });

  // An opening is a cell no paint covers and the picture's edge cannot reach: the paint
  // closes round it, the way the tailgate closes round a window.
  const outside = new Uint8Array(nx * ny);
  const queue: number[] = [];
  const reach = (ix: number, iy: number): void => {
    if (ix < 0 || iy < 0 || ix >= nx || iy >= ny) return;
    const cell = ix + iy * nx;
    if (outside[cell] === 1 || painted[cell] === 1) return;
    outside[cell] = 1;
    queue.push(cell);
  };
  for (let ix = 0; ix < nx; ix++) {
    reach(ix, 0);
    reach(ix, ny - 1);
  }
  for (let iy = 0; iy < ny; iy++) {
    reach(0, iy);
    reach(nx - 1, iy);
  }
  while (queue.length > 0) {
    const cell = queue.pop()!;
    const ix = cell % nx;
    const iy = (cell - ix) / nx;
    reach(ix - 1, iy);
    reach(ix + 1, iy);
    reach(ix, iy - 1);
    reach(ix, iy + 1);
  }

  // The plate: rear-facing, on the declared material, in an opening of the tail's rear
  // half, at that cell's own outermost depth.
  const hosts: THREE.Mesh[] = [];
  scene.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    const materials = materialsOf(node);
    if (materials.length === 1 && materials[0]!.name === material) hosts.push(node);
  });
  for (const host of hosts) {
    const count = host.geometry.index
      ? host.geometry.index.count / 3
      : host.geometry.attributes.position.count / 3;
    const plate = new Uint8Array(count);
    let found = 0;
    for (let tri = 0; tri < count; tri++) {
      readTriangle(host, tri);
      const depth = tailFacing();
      if (depth === null) continue;
      if ((corners[2]! + corners[5]! + corners[8]!) / 3 * rearSign <= 0) continue;
      const cell =
        cellX((corners[0]! + corners[3]! + corners[6]!) / 3)
        + cellY((corners[1]! + corners[4]! + corners[7]!) / 3) * nx;
      if (painted[cell] === 1 || outside[cell] === 1) continue;
      if (depth < outermost[cell]! - TAIL_PLATE_DEPTH_M) continue;
      plate[tri] = 1;
      found++;
    }
    if (found === 0) continue;
    const cut = triangleRuns(host.geometry, (tri) => plate[tri] === 1);
    const pane = new THREE.Mesh(subGeometry(host.geometry, cut.matched), carGlassMaterial());
    pane.name = 'glass-rear';
    pane.position.copy(host.position);
    pane.quaternion.copy(host.quaternion);
    pane.scale.copy(host.scale);
    host.parent?.add(pane);
    const remainder = subGeometry(host.geometry, cut.rest);
    host.geometry.dispose();
    host.geometry = remainder;
    return;
  }
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
  const worldPosition = new THREE.Vector3();
  const worldQuaternion = new THREE.Quaternion();
  const worldScale = new THREE.Vector3();

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
    // this independent of the modeller's axis convention. A catalogue radius
    // corrects source art whose wheelbase is accurate but tyres are not.
    const extents = [box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z];
    const sourceRadius = Math.max(...extents) / 2;
    const radius = def.factory.wheelRadius;
    const wheelScale = radius / (sourceRadius * s);
    radii.set(id, radius);
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
      // Bounds are world-space. Preserve each node's complete world transform when
      // detaching it; subtracting a world-space centre from node.position (which is
      // parent-local) shifts wheels whenever the exporter adds a transformed parent.
      node.matrixWorld.decompose(worldPosition, worldQuaternion, worldScale);
      worldPosition.sub(centre);
      node.removeFromParent();
      node.position.copy(worldPosition);
      node.quaternion.copy(worldQuaternion);
      node.scale.copy(worldScale);
      node.updateMatrix();
      align.add(node);
    }

    const wrapper = new THREE.Group();
    wrapper.name = id;
    // Resize only the rolling plane. Shrinking the axle axis pulled the rim face
    // inward on the 2131 until the black tyre sidewall occluded it; tyre width and
    // rim-face depth are independent of the corrected outside diameter.
    wrapper.scale.set(s, s * wheelScale, s * wheelScale);
    wrapper.add(align);
    prepareMaterials(wrapper, false, new Set());
    shareWheelMaterials(wrapper);
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
 * How far the hood camera stands above the measured bonnet skin, metres. Enough to
 * clear the panel it is mounted on without floating off it.
 */
const HOOD_CAMERA_CLEARANCE_M = 0.1;
/** Scratch for the bonnet sweep; measuring a body must not allocate per vertex. */
const _sample = new THREE.Vector3();
const _ridePoint = new THREE.Vector3();
const _rideInverse = new THREE.Matrix4();

function rideFalloff(distance: number, full: number, zero: number): number {
  if (distance <= full) return 1;
  if (distance >= zero) return 0;
  const t = (distance - full) / (zero - full);
  return 1 - t * t * (3 - 2 * t);
}

/**
 * Settles the sprung visual body without translating either axle assembly.
 *
 * Every affected mesh stays connected. Around each axle the displacement is zero;
 * along springs, dampers and prop shafts it fades continuously to the full body
 * drop. This is a visual full-load stance, not a second suspension simulation.
 */
function applyLoadedRideDrop(
  scene: THREE.Group,
  wheels: readonly WheelMeasure[],
  drop: number,
): void {
  if (!(drop > 0)) return;
  const frontY = (wheels[0]!.pos[1] + wheels[1]!.pos[1]) * 0.5;
  const frontZ = (wheels[0]!.pos[2] + wheels[1]!.pos[2]) * 0.5;
  const rearY = (wheels[2]!.pos[1] + wheels[3]!.pos[1]) * 0.5;
  const rearZ = (wheels[2]!.pos[2] + wheels[3]!.pos[2]) * 0.5;
  scene.updateMatrixWorld(true);
  scene.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    node.geometry = node.geometry.clone();
    const position = node.geometry.getAttribute('position');
    if (!(position instanceof THREE.BufferAttribute)) return;
    _rideInverse.copy(node.matrixWorld).invert();
    const fixedAxles = node.name === 'trim';
    for (let i = 0; i < position.count; i++) {
      _ridePoint.fromBufferAttribute(position, i).applyMatrix4(node.matrixWorld);
      let sprung = 1;
      if (fixedAxles) {
        const frontLock =
          rideFalloff(Math.abs(_ridePoint.z - frontZ), 0.30, 1.05) *
          rideFalloff(Math.abs(_ridePoint.y - frontY), 0.19, 0.55);
        const rearLock =
          rideFalloff(Math.abs(_ridePoint.z - rearZ), 0.30, 1.05) *
          rideFalloff(Math.abs(_ridePoint.y - rearY), 0.19, 0.55);
        sprung -= Math.max(frontLock, rearLock);
      }
      _ridePoint.y -= drop * sprung;
      _ridePoint.applyMatrix4(_rideInverse);
      position.setXYZ(i, _ridePoint.x, _ridePoint.y, _ridePoint.z);
    }
    position.needsUpdate = true;
    node.geometry.computeBoundingBox();
    node.geometry.computeBoundingSphere();
  });
}

/** The node every pack names for the animated steering wheel. */
export const STEERING_WHEEL_NODE = 'steering_wheel';
/**
 * The node a normalized body names its exterior mirrors. A mirror is not part of
 * the published body width, and one mounted low enough — the Oka's, at 54% of body
 * height — would otherwise widen the measured shell and squeeze the whole body.
 */
const MIRRORS_NODE = 'mirrors';


/**
 * DEV-only `?carstyle=unified`: one normal convention for every car body.
 *
 * The packs disagree at the source. The Soviet FBXs ship faceted normals — every
 * panel carries its own — while the GTA bodies were welded within 32 to 40 degrees
 * when they were imported, so a curved wing reads as a chain of flat facets beside a
 * smooth one, and the eye can read a car's origin off its shading alone. Recomputing
 * every body's normals through ONE crease angle removes that: faces within 35 degrees
 * of each other share a smooth normal and a genuine panel edge stays hard.
 *
 * Bodywork only. By the time this runs `takeOwnWheels` has already detached the
 * wheels, so the discs keep the normals their own art was authored with.
 *
 * `stampCarBodyPositions` reads the geometry this replaces — it writes the paint's
 * chassis attribute onto each mesh geometry, and creasing rebuilds them de-indexed —
 * which is why this is called from exactly one place, immediately before the stamp.
 */
function creaseCarBodyNormals(scene: THREE.Group): void {
  if (!CAR_STYLE_UNIFIED) return;
  // Two meshes can share one geometry (a mirrored pair, or a body applied twice).
  // Creasing is a pure function of the geometry in its own local frame, so the
  // second mesh takes the first mesh's creased copy rather than paying for its own.
  const creased = new Map<THREE.BufferGeometry, THREE.BufferGeometry>();
  scene.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    const shared = creased.get(node.geometry);
    if (shared) {
      node.geometry = shared;
      return;
    }
    const geometry = toCreasedNormals(node.geometry, CAR_CREASE_ANGLE);
    creased.set(node.geometry, geometry);
    node.geometry = geometry;
  });
}

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
  // Published width excludes mirrors, but the affected source meshes include them
  // in their full Box3. Fitting that box made the actual shell 8-14% too narrow, so
  // a correct factory track visibly sat outside the arches. Measure the lower 55%
  // of the detached body: sills, wings and bumpers, but not mirrors — the height
  // cut keeps an unnamed mirror out, and a body whose mirror hangs below it names
  // the node `mirrors`. Height and length still use the complete body.
  const sourceBodyBox = boundsOf(scene);
  const sourceBodyCentre = sourceBodyBox.getCenter(new THREE.Vector3());
  const sourceBodySize = sourceBodyBox.getSize(new THREE.Vector3());
  const shellTopY = sourceBodyBox.min.y + sourceBodySize.y * 0.55;
  let shellMinX = Infinity;
  let shellMaxX = -Infinity;
  scene.traverse((node) => {
    if (!(node instanceof THREE.Mesh) || node.name === MIRRORS_NODE) return;
    const positions = node.geometry.getAttribute('position');
    if (!positions) return;
    for (let i = 0; i < positions.count; i++) {
      _sample.fromBufferAttribute(positions, i).applyMatrix4(node.matrixWorld);
      if (_sample.y > shellTopY) continue;
      shellMinX = Math.min(shellMinX, _sample.x);
      shellMaxX = Math.max(shellMaxX, _sample.x);
    }
  });
  const sourceShellWidth = shellMaxX - shellMinX;
  if (!(sourceShellWidth > 0)) {
    throw new Error(`Car model "${def.id}" has no measurable lower body shell`);
  }
  const sourceShellCentreX = (shellMinX + shellMaxX) * 0.5;
  const targetBodyHeight = def.factory.height - def.factory.clearance;
  const bodyScaleX = def.factory.width / (sourceShellWidth * s);
  const bodyScaleY = targetBodyHeight / (sourceBodySize.y * s);
  const bodyScaleZ = def.factory.length / (sourceBodySize.z * s);
  scene.scale.set(s * bodyScaleX, s * bodyScaleY, s * bodyScaleZ);
  scene.updateMatrixWorld(true);
  const scaledBodyBox = boundsOf(scene);
  const scaledBodyCentre = scaledBodyBox.getCenter(new THREE.Vector3());
  scene.position.set(
    -sourceShellCentreX * s * bodyScaleX,
    -scaledBodyCentre.y,
    -scaledBodyCentre.z,
  );
  scene.updateMatrixWorld(true);

  // Collider width is the published shell width, not the visible mirror span.
  const bodyBox = boundsOf(scene);
  const centre = bodyBox.getCenter(new THREE.Vector3());
  centre.x = 0;
  const half = bodyBox.getSize(new THREE.Vector3()).multiplyScalar(0.5);
  half.x = def.factory.width * 0.5;


  const sourceOriginX = sourceShellCentreX * s;
  const frontAxleX =
    ((parts.positions.get('wheel_fl')!.x +
      parts.positions.get('wheel_fr')!.x) *
      0.5 -
      sourceOriginX) *
    bodyScaleX;
  const rearAxleX =
    ((parts.positions.get('wheel_rl')!.x +
      parts.positions.get('wheel_rr')!.x) *
      0.5 -
      sourceOriginX) *
    bodyScaleX;
  const sourceOriginZ = sourceBodyCentre.z * s;
  const frontSourceZ =
    (parts.positions.get('wheel_fl')!.z +
      parts.positions.get('wheel_fr')!.z) *
      0.5 -
    sourceOriginZ;
  const rearSourceZ =
    (parts.positions.get('wheel_rl')!.z +
      parts.positions.get('wheel_rr')!.z) *
      0.5 -
    sourceOriginZ;
  // Axle midpoint normally follows the source art. Factory drawings override it
  // where the source has the right wheelbase but distributes the overhangs wrongly.
  const frontDirection = Math.sign(frontSourceZ - rearSourceZ) || 1;
  const axleMidZ = def.factory.frontOverhang === undefined
    ? ((frontSourceZ + rearSourceZ) * 0.5) * bodyScaleZ
    : frontDirection * (
      half.z - def.factory.frontOverhang - def.factory.wheelbase * 0.5
    );
  const wheels: WheelMeasure[] = [];
  for (const id of WHEEL_IDS) {
    const p: [number, number, number] = [0, 0, 0];
    const radius = parts.radii.get(id)!;
    const isFront = id === 'wheel_fl' || id === 'wheel_fr';
    const isLeft = id === 'wheel_fl' || id === 'wheel_rl';
    const track = isFront ? def.factory.frontTrack : def.factory.rearTrack;
    p[1] = -half.y - def.factory.clearance + radius;
    const axleX = isFront ? frontAxleX : rearAxleX;
    p[0] = axleX + (isLeft ? 0.5 : -0.5) * track;
    p[2] =
      axleMidZ +
      frontDirection * (isFront ? 0.5 : -0.5) * def.factory.wheelbase;
    wheels.push({
      id,
      pos: [p[0], p[1], p[2]],
      radius,
      isFront,
    });
  }
  applyLoadedRideDrop(scene, wheels, def.loadedRideDrop ?? 0);

  // The one window a pack drew as trim rather than glass becomes glass here, while the
  // car is fitted but before the wear's chassis stamp reads the geometry.
  const rearAxleZ = (wheels[2]!.pos[2] + wheels[3]!.pos[2]) * 0.5;
  const frontAxleZ = (wheels[0]!.pos[2] + wheels[1]!.pos[2]) * 0.5;
  glassOverTailOpening(scene, def, Math.sign(rearAxleZ - frontAxleZ) || 1);

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
  //
  // SAMPLES ARE ALREADY CHASSIS-LOCAL METRES: `matrixWorld` carries the pack's own
  // scale and the body fit applied above. Multiplying them by `def.scale` a second
  // time emptied the window on every centimetre-scale body — the whole Soviet pack —
  // so `hoodY` never left its initial value and the mount sat at the floor of the
  // box, inside the car.
  const hoodFrontZ = half.z * 0.86;
  const hoodRearZ = half.z * 0.34;
  const hoodHalfWidth = half.x * 0.35;
  let skinY = -half.y;
  scene.updateMatrixWorld(true);
  scene.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    const position = node.geometry.getAttribute('position');
    if (!position) return;
    for (let i = 0; i < position.count; i++) {
      _sample.fromBufferAttribute(position, i).applyMatrix4(node.matrixWorld);
      const z = _sample.z - centre.z;
      if (z < hoodRearZ || z > hoodFrontZ) continue;
      if (Math.abs(_sample.x - centre.x) > hoodHalfWidth) continue;
      skinY = Math.max(skinY, _sample.y - centre.y);
    }
  });
  // A camera exactly on the sheet metal z-fights with it and shows nothing of the
  // car, so it sits a hand's width proud of the measured skin — but never above the
  // roof. On a cab-forward body (the UAZ truck, and any van bodied the same way)
  // the front third holds nothing but cab roof, so the measured skin IS the roof
  // and clearing it would float the mount above the vehicle. There it tops out level
  // with the roof, at the windscreen line, which is where a cab-over's driver sits.
  const hoodPoint: [number, number, number] = [
    0,
    Math.min(skinY + HOOD_CAMERA_CLEARANCE_M, half.y),
    (hoodFrontZ + hoodRearZ) * 0.5,
  ];

  // The unified style's normals, before the chassis stamp below reads the buffers
  // this replaces.
  creaseCarBodyNormals(scene);

  prepareMaterials(scene, true, lensNames(def));
  stampCarBodyPositions(scene, def);
  mergeStaticBodyMeshes(scene, def);

  // Geometry is now expressed directly in chassis-local metres; keeping the source
  // origin offset in the fit manifest remains useful for asset diagnostics.
  const measure: CarModelMeasure = {
    halfExtents: [half.x, half.y, half.z],
    wheels,
    hoodPoint,
    visualOffset: [-centre.x, -centre.y, -centre.z],
  };
  const [fl, fr, rl, rr] = wheels;
  const frame: CarBodyFrame = {
    halfExtents: measure.halfExtents,
    frontAxleZ: (fl!.pos[2] + fr!.pos[2]) * 0.5,
    rearAxleZ: (rl!.pos[2] + rr!.pos[2]) * 0.5,
    wheelCentreY: wheels.reduce((sum, wheel) => sum + wheel.pos[1], 0) / wheels.length,
    wheelRadius: wheels.reduce((sum, wheel) => sum + wheel.radius, 0) / wheels.length,
  };
  return { def, measure, body: scene, wheels: parts.objects, frame };
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

/**
 * Resolves after the next presented frame, so the work on either side of it lands in
 * different frames — or after `FRAME_WAIT_CEILING_MS` if no frame comes. A page whose
 * frames have stopped (an occluded window, a bench with no document) must still finish
 * loading its cars: waiting on the frame alone hung the loading screen for good in a
 * browser tab that was not being painted.
 */
function nextFrame(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  if (typeof requestAnimationFrame !== 'function') {
    setTimeout(resolve, 0);
    return promise;
  }
  requestAnimationFrame(() => resolve());
  setTimeout(resolve, FRAME_WAIT_CEILING_MS);
  return promise;
}
const FRAME_WAIT_CEILING_MS = 50;

/** Tail of the per-frame queue `onOwnFrame` appends to. */
let frameSlots: Promise<void> = Promise.resolve();

/**
 * Runs `work` on a frame of its own, after every earlier call's work has had its own.
 *
 * One model request can bring several with it (a wheel-set pool, a pack loaded at
 * once), and their loads resolve together: a bare `nextFrame()` per step only moved
 * all of them onto the same next frame, measured as one 40 ms task building four
 * templates back to back.
 */
function onOwnFrame<T>(work: () => T): Promise<T> {
  const run = frameSlots.then(nextFrame).then(work);
  frameSlots = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function loadModel(def: CarModelDef): Promise<void> {
  if (templates.has(def.id)) return Promise.resolve();
  const pending = modelLoads.get(def.id);
  if (pending) return pending;

  // A traffic model is loaded mid-drive the first time the stream draws it. Parsing
  // the file, preparing its materials and measuring its body are each several
  // milliseconds of main thread and used to run as one task — a single dropped frame
  // of 25-40 ms per new model — so each step after the parse takes a frame of its own.
  const load = (async () => {
    if (def.textureFile) await loadPalette(def.textureFile);
    const scene = await loadScene(def.file);
    await onOwnFrame(() => {
      if (def.textureFile) {
        applyTexture(scene, paletteTextures.get(def.textureFile)!);
      }
      tuneMaps(scene);
      unifyCarMaterials(scene, def);
    });
    templates.set(def.id, await onOwnFrame(() => buildTemplate(def, scene)));
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
  const idsToLoad = new Set(defs.map((def) => def.id));
  for (const def of defs) {
    for (const sourceId of def.wheelSetPool ?? []) idsToLoad.add(sourceId);
  }
  await Promise.all([...idsToLoad].map((id) => loadModel(carModel(id))));
}

/**
 * Lazy-loading entry point used by runtime consumers that need one model. Resolves
 * once the model is resident AND its program anchor is compiled, so its first instance
 * draws without linking a program.
 */
export function loadCarModel(id: string): Promise<void> {
  let ready = modelReadiness.get(id);
  if (!ready) {
    ready = (async () => {
      await preloadCarModels([id]);
      const anchor = await buildProgramAnchor(id);
      programAnchors.add(anchor);
      if (programCompiler) await programCompiler(anchor);
      readyModels.add(id);
    })().catch((error: unknown) => {
      modelReadiness.delete(id);
      throw error;
    });
    modelReadiness.set(id, ready);
  }
  return ready;
}

/** True once `loadCarModel` has resolved: an instance can be cloned and drawn synchronously. */
export function isCarModelLoaded(id: string): boolean {
  return readyModels.has(id);
}

/**
 * Registers the compiler every model's programs go through from now on, and compiles
 * the anchors of the models loaded before it. The game registers the live scene pass
 * once the scene is in its drawing state (lights, fog, baked environment) — anchors
 * built earlier were not compiled against any of it.
 */
export function compileCarProgramsWith(compile: CarProgramCompiler): Promise<unknown> {
  programCompiler = compile;
  return compile(programAnchors);
}

function measureFromFit(fit: CarModelFit): CarModelMeasure {
  return fit;
}

function template(id: string): Template {
  const t = templates.get(id);
  if (!t) throw new Error(`Car model "${id}" has not finished loading`);
  return t;
}

function selectedWheelTemplate(t: Template, appearanceKey: string): Template {
  const pool = t.def.wheelSetPool;
  if (!pool || pool.length === 0) return t;
  const sourceId = pool[appearanceHash('vaz-wheel-set', appearanceKey) % pool.length]!;
  return templates.get(sourceId) ?? t;
}

/**
 * Clones a wheel style from the selected Soviet set while keeping this body's
 * measured factory rolling radius. The source set contributes mesh, rim and
 * tyre appearance; chassis geometry remains the target model's responsibility.
 */
function cloneWheels(t: Template, appearanceKey: string): Map<string, THREE.Object3D> {
  const source = selectedWheelTemplate(t, appearanceKey);
  const wheels = new Map<string, THREE.Object3D>();
  for (const targetWheel of t.measure.wheels) {
    const mesh = source.wheels.get(targetWheel.id)!.clone(true);
    mesh.updateMatrixWorld(true);
    const box = boundsOf(mesh);
    const visualWidth = box.max.x - box.min.x;
    const visualRadius = Math.max(box.max.y - box.min.y, box.max.z - box.min.z) * 0.5;
    if (!(visualRadius > 0) || !(visualWidth > 0)) {
      throw new Error(`Car model "${t.def.id}" has a wheel with invalid dimensions`);
    }
    // A shared wheel contributes its rim style, not the donor car's tyre section.
    // Keep the target model's factory tyre width as well as its rolling radius.
    mesh.scale.x *= t.def.factory.tyreWidth / visualWidth;
    const rollingScale = targetWheel.radius / visualRadius;
    mesh.scale.y *= rollingScale;
    mesh.scale.z *= rollingScale;
    wheels.set(targetWheel.id, mesh);
  }
  return wheels;
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
  /** This car's paint condition; see render/carsurface.ts. */
  readonly surface: CarBodySurface;
}

/** A static shell and the paint materials it was instanced with. */
interface StaticCarInstance {
  readonly model: THREE.Object3D;
  readonly paint: readonly THREE.Material[];
  readonly glass: readonly THREE.Material[];
}

function cloneDrivingModel(t: Template, appearanceKey = t.def.id): CarModelInstance {
  const wheels = cloneWheels(t, appearanceKey);
  const body = t.body.clone(true);
  const paint = cloneCarBodyPaintMaterials(body, t, appearanceKey);
  const glass = cloneCarGlass(body, paint);
  prepareSovietShellFaces(body, t.def);
  applyRandomPaint(body, t.def, appearanceKey);
  markStickerSurfaces(body, t.def, glass);
  body.name = 'body';
  const decals = new CarStickerDecals(
    body,
    stickerDecalSurfaces(body, t.def),
    paint.length > 0 ? carPaintGrimeFrame(paint[0]!) : null,
  );
  const surface = new CarBodySurface(paint, glass, decals);
  return { body, wheels, surface };
}

/**
 * The triangles of a fitted body a sticker may be printed on: each mesh's sticker slots
 * (`markStickerSurfaces`), narrowed on a palette atlas body to the paint cell.
 *
 * The decal path reads this once per car, lazily, the first time the car has a sticker —
 * a traffic car with none never pays for it.
 */
function stickerDecalSurfaces(root: THREE.Object3D, def: CarModelDef): StickerDecalSurface[] {
  const surfaces: StickerDecalSurface[] = [];
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const indices = child.userData.stickerMaterialIndices as number[] | undefined;
    if (!indices || indices.length === 0) return;
    const geometry = child.geometry;
    const cell = child.userData.stickerPaintCell as readonly [number, number] | undefined;
    surfaces.push({
      mesh: child,
      accepts: (slot, triangle) =>
        indices.includes(slot) && (cell === undefined || uvCellOf(geometry, triangle, cell)),
    });
  });
  return surfaces;
}

/** A fresh instance of a loaded model, sharing geometry but owning its paint state. */
export function createCarModel(id: string, appearanceKey = id): CarModelInstance {
  return cloneDrivingModel(template(id), appearanceKey);
}

/**
 * A static, non-driven copy of a whole vehicle, with its wheels placed at the same
 * factory track, wheelbase and clearance used by the driven chassis.
 */
function cloneStaticModel(t: Template, appearanceKey = t.def.id): StaticCarInstance {
  const group = new THREE.Group();
  group.name = t.def.id;
  const body = t.body.clone(true);
  const paint = cloneCarBodyPaintMaterials(body, t, appearanceKey);
  const glass = cloneCarGlass(body, paint);
  applyRandomPaint(body, t.def, appearanceKey);
  group.add(body);
  const wheels = cloneWheels(t, appearanceKey);
  for (const wheel of t.measure.wheels) {
    const mesh = wheels.get(wheel.id)!;
    mesh.position.set(wheel.pos[0], wheel.pos[1], wheel.pos[2]);
    group.add(mesh);
  }
  return { model: group, paint, glass };
}

/**
 * One model's program anchor (see `programAnchors`): every material its instances draw
 * with, over the geometry they draw it on. Two frames, because two whole-car clones are
 * already several milliseconds.
 */
async function buildProgramAnchor(id: string): Promise<THREE.Group> {
  const anchor = await onOwnFrame(() => {
    const t = template(id);
    const group = new THREE.Group();
    group.name = id;
    const driving = cloneDrivingModel(t);
    group.add(driving.body, ...driving.wheels.values(), ...lampLensAnchors(t.def, driving.body));
    // Every set the wheel pool can give this body, not only the one its own key picks.
    for (const sourceId of t.def.wheelSetPool ?? []) {
      const source = templates.get(sourceId);
      if (source) for (const wheel of source.wheels.values()) group.add(wheel.clone(true));
    }
    return group;
  });
  await onOwnFrame(() => {
    const t = template(id);
    const courier = cloneStaticModel(t);
    applyCourierAppearance(courier.paint);
    anchor.add(cloneStaticModel(t).model, courier.model);
  });
  return anchor;
}

/**
 * A static, non-driven copy of a whole vehicle — wheels included, bolted where the
 * model puts them. This is what wrecks and scenery cars use, and it arrives already
 * weathered (`derelictDust`).
 */
export function createStaticCarModel(id: string, appearanceKey = id): THREE.Object3D {
  const instance = cloneStaticModel(template(id), appearanceKey);
  const dust = derelictDust(id, appearanceKey);
  weatherStaticCarPaint(instance.paint, dust);
  setCarGrime(instance.glass, dust * GLASS_DIRT_SHARE);
  return instance.model;
}

/**
 * Static, solid courier with the same deterministic body and a unique shader finish.
 * It is the one static car kept showroom-clean, so its paint skips the condition
 * noise entirely.
 */
export function createCourierCarModel(id: string, appearanceKey: string): THREE.Object3D {
  const instance = cloneStaticModel(template(id), appearanceKey);
  setCarBodyCondition(instance.paint, 0, 0);
  setCarGrime(instance.glass, 0);
  applyCourierAppearance(instance.paint);
  return instance.model;
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
  // The anchors first: they own the only references to their cloned paint, glass and
  // lens materials, and disposing those releases the programs they were holding.
  dispose(programAnchors);
  programAnchors.clear();
  modelReadiness.clear();
  readyModels.clear();
  programCompiler = null;
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
  sharedWheelMaterials.clear();
}
