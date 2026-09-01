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
import { makeCarBodyConditionMaterial } from './materials';
import { isProceduralCarPaintMaterial, proceduralCarScene } from './proceduralcars';
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
/**
 * Parsed scenes for multi-vehicle pack files, keyed by URL. Several catalogue
 * entries share one GLB (the low-poly pack holds 21 bodies in one file), so the
 * file is parsed once and each entry extracts its own subtree from the cached
 * scene rather than re-parsing the buffer per vehicle.
 */
const packScenes = new Map<string, THREE.Group>();
let gltf: GLTFLoader | null = null;
let fbx: FBXLoader | null = null;
let textures: THREE.TextureLoader | null = null;

/** Models built in code rather than loaded (see render/proceduralcars.ts). */
const PROCEDURAL_SCHEME = 'procedural://';

/**
 * Produces one model's scene graph, picking the source from its URL.
 *
 * Asset-file cameras and lights are authoring aids, never vehicle parts. Keeping
 * them makes every spawned copy add another renderer light; the updated Soviet
 * FBXs contain Blender scene lights, which overwhelmed the sun around each car.
 */
async function loadScene(file: string): Promise<THREE.Group> {
  if (file.startsWith(PROCEDURAL_SCHEME)) {
    return proceduralCarScene(file.slice(PROCEDURAL_SCHEME.length));
  }

  let scene: THREE.Group;
  if (file.toLowerCase().endsWith('.fbx')) {
    fbx ??= new FBXLoader();
    scene = await fbx.loadAsync(file);
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

/**
 * Gives each driving car independent condition uniforms while preserving the exact
 * livery slot rule: textured packs paint every already-mapped slot; untextured
 * procedural shells name their paint finish explicitly. One clone per shared source
 * material keeps DeJunes' multi-group body slots sharing state and draw calls.
 */
function cloneCarBodyPaintMaterials(root: THREE.Object3D): void {
  const meshes: THREE.Mesh[] = [];
  let hasLiverySlots = false;
  let hasExplicitPaintSlots = false;
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    meshes.push(child);
    for (const material of materialsOf(child)) {
      if ((material as THREE.MeshStandardMaterial).map) hasLiverySlots = true;
      if (isProceduralCarPaintMaterial(material)) hasExplicitPaintSlots = true;
    }
  });

  const clones = new Map<THREE.Material, THREE.Material>();
  const paint = (source: THREE.Material): THREE.Material => {
    const existing = clones.get(source);
    if (existing) return existing;
    const standard = source as THREE.MeshStandardMaterial;
    const isPaint = hasLiverySlots
      ? Boolean(standard.map)
      : hasExplicitPaintSlots
        ? isProceduralCarPaintMaterial(source)
        // This is the livery path's established fallback for a one-material export.
        : true;
    if (!isPaint) {
      clones.set(source, source);
      return source;
    }
    const material = makeCarBodyConditionMaterial(source);
    clones.set(source, material);
    return material;
  };

  for (const mesh of meshes) {
    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map(paint)
      : paint(mesh.material);
  }
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
    // A pack that authored `doubleSided: true` would otherwise store its LIT face in
    // the sun's depth map (three flips FrontSide to BackSide for the depth pass but
    // leaves DoubleSide alone) and every panel would test against its own depth. The
    // bias that used to hide that was wide enough to eat the car's contact shadow;
    // it is 2 cm now, so the invariant is stated here instead — see render/sky.ts.
    for (const material of materialsOf(child)) material.shadowSide = THREE.BackSide;
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

/**
 * Pulls one vehicle out of a shared pack scene into a fresh group at the origin.
 *
 * A pack ships several bodies in ONE scene, laid out in a showroom row, so each
 * body and its wheels are siblings whose own transforms encode both their size and
 * their place in that row. The fresh group must therefore re-root each node at its
 * WORLD transform, not its local one: copying `matrixWorld` into `matrix` (with
 * auto-update off) makes every node land where it really is, relative to the
 * others, while the group itself stays at the origin for `buildTemplate` to
 * centre and scale.
 *
 * Geometry and materials stay SHARED across the pack's entries because extraction
 * uses `clone(true)`, which deep-copies Object3D transforms but leaves every
 * BufferGeometry and Material as the same object the pack scene holds — one parse,
 * one buffer, one material set, no GPU resources duplicated per vehicle.
 */
function extractPackVehicle(pack: THREE.Group, def: CarModelDef): THREE.Group {
  const group = new THREE.Group();
  group.name = def.id;
  pack.updateMatrixWorld(true);

  const bodyName = def.packNode;
  if (!bodyName) throw new Error(`Car model "${def.id}" has no packNode`);
  const prefix = def.packWheelPrefix ?? bodyName;

  // The four nodes the vehicle controller drives, pack suffix -> kit node name
  // (the `wheel-{front,back}-{left,right}` names WHEEL_NODES reads below).
  const DRIVEN: readonly (readonly [string, string])[] = [
    ['front left', 'wheel-front-left'],
    ['front right', 'wheel-front-right'],
    ['rear left', 'wheel-back-left'],
    ['rear right', 'wheel-back-right'],
  ];

  // Re-rooting DECOMPOSES the world matrix into the clone's own position,
  // quaternion and scale rather than copying it into `matrix` with
  // `matrixAutoUpdate` off. Copying the matrix leaves a node whose `matrix` says
  // one thing and whose `position`/`scale` still say what they said inside the
  // pack's row — and `takeOwnWheels` below mixes the two: it measures a wheel's
  // centre in this group's space and then writes `node.position` + `updateMatrix()`
  // to re-centre the mesh, which recomposes the matrix from the STALE local
  // rotation and scale. On this pack that meant every wheel drawn at 100x size a
  // kilometre off, because its pack-local scale is 100 against a 0.01 root.
  // Decomposing keeps local TRS and world transform the same thing, so every
  // consumer downstream (measurement, re-centring, `applyModelYaw`) is reading the
  // frame it thinks it is. glTF nodes are pure TRS, so there is no skew to lose.
  const move = (source: THREE.Object3D): THREE.Object3D => {
    const clone = source.clone(true);
    source.matrixWorld.decompose(clone.position, clone.quaternion, clone.scale);
    clone.updateMatrix();
    group.add(clone);
    return clone;
  };

  const body = findPackNode(pack, bodyName);
  if (!body) throw new Error(`Pack "${def.file}" has no body node "${bodyName}"`);
  move(body);

  const drivenNames = new Set<string>();
  for (const [suffix, target] of DRIVEN) {
    const name = `${prefix} wheel ${suffix}`;
    drivenNames.add(packName(name));
    const wheel = findPackNode(pack, name);
    if (!wheel) throw new Error(`Pack "${def.file}" body "${bodyName}" is missing wheel "${name}"`);
    move(wheel).name = target;
  }

  // Extra axles ride as body geometry. `Truck` has a tandem rear pair and
  // `Truck with trailer` carries TWELVE wheels — the truck's two rear axles plus
  // the trailer's three bogies — while the vehicle controller owns exactly four.
  // Rather than drop the rest (a half-wheeled trailer) or fake them as driven
  // (the controller cannot), every other `<prefix> wheel …` SIBLING is moved into
  // the group unchanged: it renders, measures and moves with the body, it is just
  // never steered or spun. Siblings are scanned, not the whole tree, so a wheel
  // node's own `…_tires` / `…_wheels` mesh children are not picked up twice.
  const wheelPrefix = packName(`${prefix} wheel `);
  const siblings = body.parent?.children ?? [];
  for (const sibling of siblings) {
    if (sibling.name.startsWith(wheelPrefix) && !drivenNames.has(sibling.name)) {
      move(sibling);
    }
  }

  return group;
}

/**
 * The name three.js will actually give a glTF node.
 *
 * `GLTFLoader` runs every node name through `PropertyBinding.sanitizeNodeName`,
 * which turns whitespace into underscores and strips `[ ] . : /` — so the pack's
 * `Monster Truck wheel front right` arrives in the scene graph as
 * `Monster_Truck_wheel_front_right`, and a lookup by the name printed in the file
 * finds nothing at all. That is exactly how this failed the first time.
 *
 * The catalogue deliberately still spells `packNode` the way the ASSET spells it,
 * because that is what a person reads when they open the GLB; the translation
 * belongs here, once, rather than as pre-mangled strings in 21 entries.
 */
function packName(name: string): string {
  return name.replace(/\s/g, '_').replace(/[[\].:/]/g, '');
}

function findPackNode(pack: THREE.Group, name: string): THREE.Object3D | undefined {
  // Try the sanitised form first (what three.js produces), then the raw name, so
  // this keeps working if a future three release stops mangling names.
  return pack.getObjectByName(packName(name)) ?? pack.getObjectByName(name);
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
  // silently broke every pack-extracted body: a pack lays its vehicles out in a
  // showroom row, so such a body's box is centred metres away from the model origin,
  // and `frac * half` measured from that origin came out one row-offset wrong. The
  // low-poly saloon's hood camera landed 6.8 m BEHIND its own boot (inside the car,
  // looking at the back of the rear seats), the bus's 15 m ahead of its nose, and
  // every gizmo anchor on all 21 bodies went with them. Quaternius and the
  // procedural cars are authored about their own origin, which is why they were the
  // only ones that looked right.
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

  scene.scale.setScalar(s);
  scene.position.set(-centre.x, -centre.y, -centre.z);
  prepareMaterials(scene);

  // The model's origin is on the ground between the wheels, so the distance from
  // the chassis centre down to that origin is exactly the spawn clearance needed
  // for the body to settle onto its wheels rather than through them.
  const measure: CarModelMeasure = {
    halfExtents: [half.x, half.y, half.z],
    wheels,
    eyePoint: resolveFrac(def.viewFrac),
    anchors,
    visualOffset: [-centre.x, -centre.y, -centre.z],
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


  // Shared pack files, same idea as the shared wheels above: 21 entries can point
  // at ONE GLB, so it is parsed once and each entry extracts its own subtree from
  // the cached scene (extractPackVehicle) instead of re-parsing the buffer per
  // vehicle. The pack ships no texture maps — 21 flat baseColorFactor materials —
  // so there is no livery to apply or map to tune; materials stay the shared
  // originals across every entry.
  const packFiles = new Set<string>();
  for (const def of defs) {
    if (def.packNode && !packScenes.has(def.file)) packFiles.add(def.file);
  }
  await Promise.all(
    [...packFiles].map(async (file) => {
      packScenes.set(file, await loadScene(file));
    }),
  );
  await Promise.all(
    defs.map(async (def) => {
      if (templates.has(def.id)) return;
      let scene: THREE.Group;
      if (def.packNode) {
        const pack = packScenes.get(def.file);
        if (!pack) throw new Error(`Pack "${def.file}" was not preloaded`);
        scene = extractPackVehicle(pack, def);
      } else {
        scene = await loadScene(def.file);
        if (def.textureFile) {
          textures ??= new THREE.TextureLoader();
          const map = await textures.loadAsync(def.textureFile);
          map.colorSpace = THREE.SRGBColorSpace;
          // These are PSX-era paint maps: a few dozen pixels per panel. Smoothing
          // them turns the liveries to mush, so they are sampled nearest, like the
          // era.
          map.magFilter = THREE.NearestFilter;
          // V origin follows the FORMAT, not the pack. glTF UVs are top-down, so a
          // glTF livery needs no flip; FBX (and the OBJ the FBX models were
          // authored beside) counts V from the bottom, which is what
          // TextureLoader's default flip already produces. Flipping those anyway
          // sampled the map upside down — roof paint on the sills, plate stripe
          // through the bumper.
          map.flipY = def.file.toLowerCase().endsWith('.fbx');
          applyTexture(scene, map);
        }
        tuneMaps(scene);
      }
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

function cloneDrivingModel(t: Template): CarModelInstance {
  const wheels = new Map<string, THREE.Object3D>();
  for (const [wheelId, object] of t.wheels) wheels.set(wheelId, object.clone(true));
  const body = t.body.clone(true);
  cloneCarBodyPaintMaterials(body);
  body.name = 'body';
  return { body, wheels };
}

/** A fresh instance of a preloaded model, sharing geometry and materials. */
export function createCarModel(id: string): CarModelInstance {
  const warmed = warmDrivingInstances.get(id);
  if (warmed) {
    warmDrivingInstances.delete(id);
    return warmed;
  }
  return cloneDrivingModel(template(id));
}

/**
 * A static, non-driven copy of a whole vehicle — wheels included, bolted where the
 * model puts them. This is what wrecks and scenery cars use.
 */
function cloneStaticModel(id: string): THREE.Object3D {
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
export function createStaticCarModel(id: string): THREE.Object3D {
  const warmed = warmStaticInstances.get(id);
  if (warmed) {
    warmStaticInstances.delete(id);
    return warmed;
  }
  return cloneStaticModel(id);
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
        const map = (material as THREE.MeshStandardMaterial).map;
        map?.dispose();
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
  // The cached pack scenes share geometry and materials with the templates just
  // disposed, so they go through the SAME dedup sets — a buffer freed by the
  // templates would otherwise be freed a second time here.
  for (const pack of packScenes.values()) dispose(pack);
  packScenes.clear();
}
