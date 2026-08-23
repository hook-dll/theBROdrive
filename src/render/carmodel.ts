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
import { proceduralCarScene } from './proceduralcars';
import { CAR_MODELS, carModel, type CarModelDef, type GizmoAnchorDef } from '../vehicle/carmodels';

/** Wheel node names in the kit, mapped to the ids the vehicle and saves use. */
const WHEEL_NODES: readonly (readonly [string, string])[] = [
  ['wheel-front-left', 'wheel_fl'],
  ['wheel-front-right', 'wheel_fr'],
  ['wheel-back-left', 'wheel_rl'],
  ['wheel-back-right', 'wheel_rr'],
];

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
 * Returns false when the model does not yield exactly four, so the caller can fall
 * back to a shared wheel model instead of half-wheeling the car.
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
  /** Ground clearance below the chassis centre: how high to spawn the body. */
  readonly spawnHeight: number;
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
let gltf: GLTFLoader | null = null;
let fbx: FBXLoader | null = null;
let textures: THREE.TextureLoader | null = null;

/** Models built in code rather than loaded (see render/proceduralcars.ts). */
const PROCEDURAL_SCHEME = 'procedural://';

/**
 * Produces one model's scene graph, picking the source from its URL.
 *
 * Three sources, one contract: a `procedural://` id is built in code, `.fbx` goes
 * through FBXLoader (two vendored packs ship only FBX), anything else is glTF.
 * Downstream — measurement, wheels, anchors, the hood camera — cannot tell which,
 * which is what lets a generated car sit in the catalogue next to a bought one.
 */
async function loadScene(file: string): Promise<THREE.Group> {
  if (file.startsWith(PROCEDURAL_SCHEME)) {
    return proceduralCarScene(file.slice(PROCEDURAL_SCHEME.length));
  }
  if (file.toLowerCase().endsWith('.fbx')) {
    fbx ??= new FBXLoader();
    return await fbx.loadAsync(file);
  }
  gltf ??= new GLTFLoader();
  return (await gltf.loadAsync(file)).scene;
}

/**
 * Repaints a subtree's PAINT material with one base-colour texture.
 *
 * Packs that ship several liveries for the same body (the PSX cars, DeJunes'
 * paintjobs) become several catalogue entries over one geometry file, so the
 * material is cloned per entry and only its map differs — the geometry is still
 * shared between them.
 *
 * Which material is "the paint" is not a guess: these models are authored with one
 * textured slot for the painted panels and flat-coloured slots for everything else
 * (`Windows`, `Grill`, `Tyre`, `Light Red`, ...), so a material that ALREADY has a
 * map is a livery slot and a material without one is a part colour. Overriding
 * every material instead — which is what this used to do, by cloning `material[0]`
 * onto each mesh — is what wrecked the DeJunes cars: their bodies are single meshes
 * with up to 56 material groups, so glass, chrome, lights and tyres all collapsed
 * into one slot and the body paintjob was stretched over their UVs.
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

  // A body with no textured slot at all (an untextured export) has nothing to
  // identify as paint, so the livery goes on everything — which is right for the
  // single-material bodies that case describes.
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

/**
 * Sampling for the pack-supplied maps (the DeJunes FBX models carry their own
 * body and number-plate textures, one per material, which the loader resolves from
 * the model's own directory).
 *
 * Same treatment as the catalogue's own liveries below: these are paint maps with a
 * few dozen pixels per panel, and smoothing them turns the liveries to mush.
 */
function tuneMaps(root: THREE.Object3D): void {
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    for (const material of materialsOf(child)) {
      const map = (material as THREE.MeshStandardMaterial).map;
      if (!map) continue;
      map.colorSpace = THREE.SRGBColorSpace;
      map.magFilter = THREE.NearestFilter;
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
    child.castShadow = true;
    child.receiveShadow = true;
  });
}

/** A wheel model shared by every car that has no wheels of its own, plus its size. */
interface WheelAsset {
  readonly object: THREE.Object3D;
  /** Radius in the wheel file's own units, before the car's scale. */
  readonly rawRadius: number;
}

const wheelAssets = new Map<string, WheelAsset>();

/**
 * Detaches the four wheel nodes of a model that carries its own wheels.
 *
 * They must be detached because the vehicle drives them itself: Rapier's ray-cast
 * suspension reports each wheel's position and spin every step, so a wheel parented
 * to the body would be dragged along by the body instead.
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
  const objects = new Map<string, THREE.Object3D>();
  const positions = new Map<string, THREE.Vector3>();
  const radii = new Map<string, number>();

  for (const [nodeName, id] of WHEEL_NODES) {
    const node = scene.getObjectByName(nodeName);
    if (!node) continue;
    const box = boundsOf(node);
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

    // With the mount moved to the centre, the mesh has to move the other way, or it
    // would be drawn a tyre-width outboard of the wheel the physics simulates.
    //
    // The node's own ROTATION is kept. The vehicle spins the wrapper about X and
    // steers it about Y; zeroing the authored rotation (as this used to) laid the
    // DeJunes wheels flat, because their discs are modelled about a different axis
    // and only their own transform stands them up.
    const offset = centre.sub(node.position);
    node.removeFromParent();
    node.position.set(-offset.x, -offset.y, -offset.z);
    node.updateMatrix();

    // The vehicle spins a wheel about X and steers it about Y, so the wheel's axle
    // has to BE X. Packs disagree on the authored axis; zeroing that transform laid
    // the DeJunes wheels flat like dinner plates. The authored transform is kept and
    // an alignment group turns whichever axis is the axle onto X — mesh and its
    // centring offset rotate together, so the wheel stays centred on its mount.
    const align = new THREE.Group();
    align.add(node);
    const axle = extents.indexOf(Math.min(...extents));
    if (axle === 1) align.rotation.z = Math.PI / 2; // axle along Y
    else if (axle === 2) align.rotation.y = Math.PI / 2; // axle along Z

    const wrapper = new THREE.Group();
    wrapper.name = id;
    wrapper.scale.setScalar(s);
    wrapper.add(align);
    prepareMaterials(wrapper);
    objects.set(id, wrapper);
  }

  if (objects.size !== WHEEL_NODES.length) {
    throw new Error(
      `Car model "${def.id}" has ${objects.size} of ${WHEEL_NODES.length} wheel nodes`,
    );
  }
  return { objects, positions, radii };
}

/**
 * Builds the four wheels for a body-only model from a shared wheel file.
 *
 * Packs that ship one wheel and several bodies (the PSX cars, DeJunes) leave the
 * mounts unmeasurable — nothing in the body file says where an axle is. So they are
 * placed as fractions of the measured body box (`separateWheels`), with the wheel
 * centre exactly one radius above the body's lowest point, which is where the
 * ground is on any model drawn sitting on its wheels. The right-hand pair is
 * mirrored in X so a wheel modelled with a face and a back reads correctly on both
 * sides.
 */
function buildSeparateWheels(
  def: CarModelDef,
  bodyBox: THREE.Box3,
): {
  objects: Map<string, THREE.Object3D>;
  positions: Map<string, THREE.Vector3>;
  radii: Map<string, number>;
} {
  const spec = def.separateWheels;
  if (!spec) throw new Error(`Car model "${def.id}" has no separateWheels spec`);
  const asset = wheelAssets.get(spec.file);
  if (!asset) throw new Error(`Wheel model "${spec.file}" was not preloaded`);

  const wheelScale = def.scale * (spec.radiusScale ?? 1);
  const radius = asset.rawRadius * wheelScale;
  // Fractions are measured from the body box's own CENTRE, not the model origin: a
  // body drawn a little off-origin (most of these are) would otherwise get a
  // lopsided track — 0.67 m on one side and 0.77 m on the other, measured on the
  // PSX saloon before this.
  const mid = bodyBox.getCenter(new THREE.Vector3());
  const halfX = (bodyBox.max.x - bodyBox.min.x) / 2;
  const halfZ = (bodyBox.max.z - bodyBox.min.z) / 2;
  const y = bodyBox.min.y + radius;

  const objects = new Map<string, THREE.Object3D>();
  const positions = new Map<string, THREE.Vector3>();
  const radii = new Map<string, number>();

  for (const [id, sideX, zFrac] of [
    ['wheel_fl', 1, spec.frontZFrac],
    ['wheel_fr', -1, spec.frontZFrac],
    ['wheel_rl', 1, spec.rearZFrac],
    ['wheel_rr', -1, spec.rearZFrac],
  ] as const) {
    positions.set(
      id,
      new THREE.Vector3(mid.x + sideX * spec.trackFrac * halfX, y, mid.z + zFrac * halfZ),
    );
    radii.set(id, radius);

    const wrapper = new THREE.Group();
    wrapper.name = id;
    wrapper.scale.set(sideX * wheelScale, wheelScale, wheelScale);
    wrapper.add(asset.object.clone(true));
    prepareMaterials(wrapper);
    objects.set(id, wrapper);
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

/** Measures a loaded scene and splits it into a body template plus wheel templates. */
function buildTemplate(def: CarModelDef, scene: THREE.Group): Template {
  if (def.yaw) applyModelYaw(scene, def.yaw);
  scene.updateMatrixWorld(true);
  const s = def.scale;

  // A model's own wheels come out first, which is what leaves `body` behind as
  // everything else. A body-only model keeps its whole scene and gets its wheels
  // after the body box is known, because that box is what places them.
  //
  // `detectWheels` is for packs that carry wheels under their own naming (the FBX
  // models): the four discs are found by shape and renamed to the convention before
  // the usual path runs, so nothing downstream needs to know the difference.
  if (def.detectWheels && !renameDetectedWheels(scene)) {
    throw new Error(`Car model "${def.id}": could not identify four wheels by shape`);
  }
  const own = def.separateWheels ? null : takeOwnWheels(def, scene);

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

  const parts = own ?? buildSeparateWheels(def, bodyBox);
  const wheels: WheelMeasure[] = [];
  for (const [, id] of WHEEL_NODES) {
    wheels.push({
      id,
      pos: toLocal(parts.positions.get(id)!),
      radius: parts.radii.get(id)!,
      isFront: id === 'wheel_fl' || id === 'wheel_fr',
    });
  }

  // Fractional anchor/eye resolution: x of half-width, y through the body's height
  // (0 = floor, 1 = roof), z of half-length — all in the model's own space first,
  // then moved into chassis-local space by the same offset as everything else.
  const resolveFrac = (frac: readonly [number, number, number]): THREE.Vector3 =>
    new THREE.Vector3(
      frac[0] * half.x,
      bodyBox.min.y + frac[1] * (bodyBox.max.y - bodyBox.min.y),
      frac[2] * half.z,
    );

  const anchors: GizmoAnchor[] = def.gizmoAnchors.map((a: GizmoAnchorDef) => ({
    id: a.id,
    label: a.label,
    pos: toLocal(resolveFrac(a.frac)),
    yaw: a.yaw ?? 0,
  }));

  scene.scale.setScalar(s);
  scene.position.set(-centre.x, -centre.y, -centre.z);
  prepareMaterials(scene);

  // The model's origin is on the ground between the wheels, so the distance from
  // the chassis centre down to that origin is exactly the spawn clearance needed
  // for the body to settle onto its wheels rather than through them.
  const measure: CarModelMeasure = {
    halfExtents: [half.x, half.y, half.z],
    wheels,
    eyePoint: toLocal(resolveFrac(def.viewFrac)),
    anchors,
    visualOffset: [-centre.x, -centre.y, -centre.z],
    spawnHeight: centre.y,
  };

  return { def, measure, body: scene, wheels: parts.objects };
}

/**
 * Loads every model in `ids` (default: the whole catalogue) and measures it.
 *
 * Must finish before the first `Vehicle` is constructed: a vehicle's collider,
 * suspension and mass all come out of the measurement, so there is no meaningful
 * "not loaded yet" state for it to run in. The kit is ~5 MB of GLB in total and
 * loads from the same origin, which is why loading all of it up front is cheaper
 * than a streaming path nobody would otherwise need.
 */
export async function preloadCarModels(ids?: readonly string[]): Promise<void> {
  const defs = ids ? ids.map(carModel) : CAR_MODELS;

  // Shared wheel files first: a body-only model cannot be measured until the wheel
  // it borrows is known, because the wheel's radius is what puts its axle line at
  // ground level.
  const wheelFiles = new Set<string>();
  for (const def of defs) {
    if (def.separateWheels && !wheelAssets.has(def.separateWheels.file)) {
      wheelFiles.add(def.separateWheels.file);
    }
  }
  await Promise.all(
    [...wheelFiles].map(async (file) => {
      const scene = await loadScene(file);
      const box = boundsOf(scene);
      wheelAssets.set(file, { object: scene, rawRadius: (box.max.y - box.min.y) / 2 });
    }),
  );

  await Promise.all(
    defs.map(async (def) => {
      if (templates.has(def.id)) return;
      const scene = await loadScene(def.file);
      if (def.textureFile) {
        textures ??= new THREE.TextureLoader();
        const map = await textures.loadAsync(def.textureFile);
        map.colorSpace = THREE.SRGBColorSpace;
        // These are PSX-era paint maps: a few dozen pixels per panel. Smoothing them
        // turns the liveries to mush, so they are sampled nearest, like the era.
        map.magFilter = THREE.NearestFilter;
        // V origin follows the FORMAT, not the pack. glTF UVs are top-down, so a
        // glTF livery needs no flip; FBX (and the OBJ the FBX models were authored
        // beside) counts V from the bottom, which is what TextureLoader's default
        // flip already produces. Flipping those anyway sampled the map upside down —
        // roof paint on the sills, plate stripe through the bumper.
        map.flipY = def.file.toLowerCase().endsWith('.fbx');
        applyTexture(scene, map);
      }
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

export interface CarModelInstance {
  /** Body and fixed trim, positioned for a chassis-centred parent. */
  readonly body: THREE.Object3D;
  /** Wheel id -> its own object, to be parented and driven by the vehicle. */
  readonly wheels: ReadonlyMap<string, THREE.Object3D>;
}

/** A fresh instance of a preloaded model, sharing geometry and materials. */
export function createCarModel(id: string): CarModelInstance {
  const t = template(id);
  const wheels = new Map<string, THREE.Object3D>();
  for (const [wheelId, object] of t.wheels) wheels.set(wheelId, object.clone(true));
  const body = t.body.clone(true);
  body.name = 'body';
  return { body, wheels };
}

/**
 * A static, non-driven copy of a whole vehicle — wheels included, bolted where the
 * model puts them. This is what wrecks and scenery cars use.
 */
export function createStaticCarModel(id: string): THREE.Object3D {
  const t = template(id);
  const group = new THREE.Group();
  group.name = id;
  const body = t.body.clone(true);
  group.add(body);
  for (const wheel of t.measure.wheels) {
    const mesh = t.wheels.get(wheel.id)!.clone(true);
    mesh.position.set(wheel.pos[0], wheel.pos[1], wheel.pos[2]);
    group.add(mesh);
  }
  return group;
}

/** Releases every loaded template. Call on teardown. */
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
        const map = (material as THREE.MeshStandardMaterial).map;
        map?.dispose();
        material.dispose();
      }
    });
  };
  for (const t of templates.values()) {
    dispose(t.body);
    for (const wheel of t.wheels.values()) dispose(wheel);
  }
  templates.clear();
}
