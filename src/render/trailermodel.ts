/**
 * Loads, measures and merges the trailer GLB (public/models/trailer/trailer.glb).
 *
 * The role is the reverse of render/carmodel.ts. A car's physics is measured OFF
 * its GLB and the vehicle is built to match; the trailer's physics is a fixed set
 * of constants in vehicle/trailer.ts (box, wheel radius, axle, ball), and this module
 * fits the ART to those constants. What it returns is therefore not a set of
 * measurements but a body mesh and two wheel meshes already posed in trailer-local
 * space — metres, +X left, +Y up, +Z the hitch direction — ready to be parented under
 * the trailer's rigid-body group.
 *
 * The Sketchfab Collada export arrives two ways it should not. Its two root nodes
 * (Sketchfab_model -> Collada visual scene group) are the usual Z-up-to-Y-up pair
 * and cancel to identity; every part then carries the same scale(100) * rotX(-90),
 * so after loading the trailer sits Y-up with X = length (hitch at -X, tail at +X),
 * Z = width, and 1 scene unit = 1 cm.
 *
 * In those centimetres the model IS a KMZ-8284 at true size: 3.10 m from the tailboard
 * to the coupler against the passport's 3085 mm, a 1.905 x 1.262 m box with 0.336 m
 * sides against 1850 x 1204 x 335 inside, 1.69 m over the mudguards against 1720
 * (vehicle/trailer.ts has the sources). So the BODY is taken at exactly 1 cm = 1 cm,
 * drawbar and coupler included: the ball is a fixed point, where the passport puts
 * it, so the authored A-frame reaches it. Only the WHEELS are not to scale: the
 * model's 50 cm tyres stand in for the 13-inch VAZ wheel (578 mm), so they alone are
 * scaled to the physics radius, round the axle and not across it.
 *
 * It used to be scaled up 1.275 times round 0.32 m wheels to fill a 2.8 m physics
 * bed, with its own drawbar cut off and a procedural bar stretched to the ball.
 *
 * The axle line is translated onto the physics axle (axleZ, axleY), which puts the
 * box where the physics box is. The merged wheel pair is split into two wheels so
 * each rides its own suspension; the unsprung axle beam is dropped for the same
 * reason.
 *
 * THE WHEEL NUTS GO ROUND WITH THE WHEEL. The export draws each wheel's four lug bolts
 * (`Bolt.004.L`, on a 98 mm circle) and the ring under them (`rama.008.L`) as frame
 * parts, so merged into the body they stood still while the tyre spun and stayed at
 * the settled height while the wheel rode its spring: "the bolts don't turn with the
 * wheel" (owner, 2026-10-25). They are split by side like the tyre pair and baked into
 * the wheel geometry, round the tyre's own centre.
 *
 * THE TAILBOARD IS ITS OWN PART. A load longer than the box goes in against the
 * headboard and out over the back with the tailboard off (vehicle/trailer.ts,
 * `TRAILER_TAILBOARD_PARTS`): "shift the load so only the back board has to go, keep
 * the front and the sides" (owner, 2026-10-25). The board's sheet, its frame and the
 * two bolts on it are left out of a second body, `bodyOpen`; the hinges and the latch
 * hooks stay on the box, as they do on a KMZ whose board has been lifted off.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const TRAILER_URL = '/models/trailer/trailer.glb';

/** The physics dimensions the art is fitted to (all defined in vehicle/trailer.ts). */
export interface TrailerFit {
  /** Rolling radius of the physics wheel, metres — the model scales to match. */
  readonly wheelRadius: number;
  /** Axle offset from the box's middle along +Z (forward), metres. */
  readonly axleZ: number;
  /** Settled wheel-centre height in trailer-local space, metres. */
  readonly axleY: number;
}

/** A fresh trailer visual: one merged body plus the two wheels, ready to pose. */
export interface TrailerModelInstance {
  /** The box, drawbar and running gear: with its tailboard, or without it for a long load. */
  readonly body: THREE.Mesh;
  /** The wheel that sits at +X (left), axle along X, centred on its own origin; lug bolts included. */
  readonly leftWheel: THREE.Mesh;
  /** The wheel that sits at -X (right); already mirrored about X. */
  readonly rightWheel: THREE.Mesh;
}

interface Template {
  readonly body: THREE.BufferGeometry;
  /** The body with the tailboard's parts left out. */
  readonly bodyOpen: THREE.BufferGeometry;
  /** One centred wheel geometry (axle along X, radius = fit.wheelRadius), its lug bolts on it. */
  readonly wheel: THREE.BufferGeometry;
  readonly material: THREE.Material;
}

/**
 * The wheel's own parts the export files with the frame: the lug bolts and the ring
 * under them. Matched on the mesh's parent node (see the wheel assembly below), whose
 * name the loader has stripped of its dots (`Bolt.004.L` arrives as `Bolt004L`).
 */
const WHEEL_PARTS = /^(bolt\.?004|rama\.?008)\.?l$/i;
/** The tailboard's parts: its sheet, its frame and the two bolts on its face. */
const TAILBOARD_PARTS = /^(sheet\.?002|rama\.?007|bolt\.?013|bolt\.?014)\.?l$/i;

let gltf: GLTFLoader | null = null;
let template: Template | null = null;

/** Scene units to metres: the model is drawn in centimetres at true size. */
const MODEL_SCALE = 0.01;

/** Diameter of a mesh's round cross-section in the loaded scene (cm). */
function discDiameter(mesh: THREE.Mesh, box: THREE.Box3): number {
  box.setFromObject(mesh);
  return Math.max(box.max.x - box.min.x, box.max.y - box.min.y);
}

/**
 * Splits the merged wheel pair into a left and right wheel. The GLB exports both
 * tyres in ONE mesh (its two "Koleso" meshes are the tyre pair and the axle beam),
 * with the tyres' axle along the source model's width axis (local Y) and a clean
 * gap at Y = 0. Triangles straddling the plane are dropped — there are none, because
 * the two tyres do not touch.
 */
function splitTyrePair(geometry: THREE.BufferGeometry): { left: THREE.BufferGeometry; right: THREE.BufferGeometry } {
  const src = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  const position = src.getAttribute('position') as THREE.BufferAttribute;
  const normal = src.getAttribute('normal') as THREE.BufferAttribute | undefined;
  const uv = src.getAttribute('uv') as THREE.BufferAttribute | undefined;
  const tangent = src.getAttribute('tangent') as THREE.BufferAttribute | undefined;

  const halves = {
    left: { pos: [] as number[], nrm: [] as number[], uv: [] as number[], tng: [] as number[] },
    right: { pos: [] as number[], nrm: [] as number[], uv: [] as number[], tng: [] as number[] },
  };
  for (let i = 0; i < position.count; i += 3) {
    const y0 = position.getY(i);
    const y1 = position.getY(i + 1);
    const y2 = position.getY(i + 2);
    const side = y0 < 0 && y1 < 0 && y2 < 0 ? 'left' : y0 > 0 && y1 > 0 && y2 > 0 ? 'right' : null;
    if (!side) continue;
    const bucket = halves[side];
    for (let j = 0; j < 3; j++) {
      const v = i + j;
      bucket.pos.push(position.getX(v), position.getY(v), position.getZ(v));
      if (normal) bucket.nrm.push(normal.getX(v), normal.getY(v), normal.getZ(v));
      if (uv) bucket.uv.push(uv.getX(v), uv.getY(v));
      if (tangent) bucket.tng.push(tangent.getX(v), tangent.getY(v), tangent.getZ(v), tangent.getW(v));
    }
  }

  const build = (b: (typeof halves)['left']): THREE.BufferGeometry => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
    if (normal) g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nrm, 3));
    if (uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
    if (tangent) g.setAttribute('tangent', new THREE.Float32BufferAttribute(b.tng, 4));
    return g;
  };
  return { left: build(halves.left), right: build(halves.right) };
}

/**
 * Loads the trailer GLB once, fits it to the physics and stores a merged template.
 * Must finish before the first `Trailer` is constructed, exactly like
 * `preloadCarModels` — a trailer without its model has no meaningful visual state.
 */
export async function preloadTrailerModel(fit: TrailerFit): Promise<void> {
  if (template) return;
  gltf ??= new GLTFLoader();
  const scene = (await gltf.loadAsync(TRAILER_URL)).scene;
  scene.updateMatrixWorld(true);

  // --- Wheel assembly -------------------------------------------------------
  // The wheels are named on their NODES, not on their meshes. This export gives
  // every mesh the material's name (`defaultMaterial`, 57 times over) and puts the
  // meaningful name one level up, so a node called `Koleso.001L` owns a mesh called
  // `defaultMaterial`. Matching `Mesh.name` therefore finds nothing at all, which is
  // exactly how this failed the first time: search the whole graph for the named
  // ancestor, then take the meshes underneath it.
  //
  // The names also carry a suffix (`Koleso.001L`, `Koleso.002L`), so the test has to
  // be a prefix match rather than equality.
  const wheelAssembly: THREE.Mesh[] = [];
  scene.traverse((node) => {
    if (!/^koleso/i.test(node.name)) return;
    node.traverse((child) => {
      if (child instanceof THREE.Mesh) wheelAssembly.push(child);
    });
  });
  if (wheelAssembly.length !== 2) {
    throw new Error(
      `Trailer model: expected two meshes under the "Koleso*" nodes (tyre pair + axle), ` +
        `found ${wheelAssembly.length}`,
    );
  }
  const box = new THREE.Box3();
  wheelAssembly.sort((a, b) => discDiameter(b, box) - discDiameter(a, box));
  const tyreMesh = wheelAssembly[0];
  const axleMesh = wheelAssembly[1];

  const tyreBox = new THREE.Box3().setFromObject(tyreMesh);
  const wheelRadiusScene = (tyreBox.max.x - tyreBox.min.x) / 2; // cm
  const axleScene = tyreBox.getCenter(new THREE.Vector3());

  // Fit: scene (cm, Y-up, X = length) -> game (m, Y-up, Z = forward). Rotate +90°
  // about Y so the hitch (-X) faces +Z; centimetres to metres; translate so the
  // model's axle line lands on the physics axle.
  const turn = new THREE.Matrix4().makeRotationY(Math.PI / 2);
  const fitMatrix = new THREE.Matrix4()
    .makeTranslation(0, fit.axleY - axleScene.y * MODEL_SCALE, fit.axleZ + axleScene.x * MODEL_SCALE)
    .multiply(new THREE.Matrix4().makeScale(MODEL_SCALE, MODEL_SCALE, MODEL_SCALE))
    .multiply(turn);

  // --- Wheels ---------------------------------------------------------------
  // Split the merged pair, keep the left half as the shared wheel geometry and
  // mirror it for the right at draw time. `local Y < 0` lands on game +X (left).
  // Turned, the axle is game X: the tread keeps the drawn width, the radius is the
  // physics wheel's. The lug bolts and their ring are split the same way and go
  // through the same scale round the same centre, the tyre's, so they sit on the
  // wheel's face and turn with it.
  const wheelScale = fit.wheelRadius / wheelRadiusScene;
  const wheelMatrix = new THREE.Matrix4().makeScale(MODEL_SCALE, wheelScale, wheelScale).multiply(turn);
  const wheelParts: THREE.Mesh[] = [];
  const tailboardParts: THREE.Mesh[] = [];
  scene.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const part = child.parent?.name ?? '';
    if (WHEEL_PARTS.test(part)) wheelParts.push(child);
    else if (TAILBOARD_PARTS.test(part)) tailboardParts.push(child);
  });
  if (wheelParts.length !== 2 || tailboardParts.length !== 4) {
    throw new Error(
      `Trailer model: expected the 2 wheel-nut parts and the 4 tailboard parts, ` +
        `found ${wheelParts.length} and ${tailboardParts.length}`,
    );
  }
  const wheelHalves: THREE.BufferGeometry[] = [];
  for (const mesh of [tyreMesh, ...wheelParts]) {
    const { left, right } = splitTyrePair(mesh.geometry);
    right.dispose();
    left.applyMatrix4(mesh.matrixWorld);
    left.applyMatrix4(wheelMatrix);
    wheelHalves.push(left);
  }
  const tyreCentre = new THREE.Vector3();
  wheelHalves[0].computeBoundingBox();
  wheelHalves[0].boundingBox!.getCenter(tyreCentre);
  for (const half of wheelHalves) half.translate(-tyreCentre.x, -tyreCentre.y, -tyreCentre.z);
  const wheel = mergeGeometries(wheelHalves);
  if (!wheel) throw new Error('Trailer model: wheel merge failed (incompatible attributes)');
  for (const half of wheelHalves) half.dispose();
  wheel.computeBoundingBox();

  // --- Body ---------------------------------------------------------------
  // Everything except the wheel assembly and the wheel's nuts, drawbar and coupler
  // included, baked to scene space and merged into one geometry (every mesh shares the
  // one material): once with the tailboard and once without it.
  const closedGeometries: THREE.BufferGeometry[] = [];
  const openGeometries: THREE.BufferGeometry[] = [];
  scene.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    if (child === tyreMesh || child === axleMesh || wheelParts.includes(child)) return;
    child.geometry.applyMatrix4(child.matrixWorld);
    closedGeometries.push(child.geometry);
    if (!tailboardParts.includes(child)) openGeometries.push(child.geometry);
  });
  const body = mergeGeometries(closedGeometries);
  const bodyOpen = mergeGeometries(openGeometries);
  if (!body || !bodyOpen) throw new Error('Trailer model: body merge failed (incompatible attributes)');
  body.applyMatrix4(fitMatrix);
  bodyOpen.applyMatrix4(fitMatrix);

  // The GLB ships three PBR maps (base colour, normal, occlusion+metal-roughness),
  // but this renderer flat-shades with base colour only — comic banding and an ink
  // outline pass do the work the PBR maps would. The maps beyond base colour are
  // dropped, their GPU textures released, and metalness/roughness become the same
  // flat, painted-metal finish the old procedural trailer used. A stripped asset
  // that arrives without those two PNGs is already handled: a missing map is just a
  // null field on the source material.
  const source = tyreMesh.material as THREE.MeshStandardMaterial;
  const baseColorMap = source.map ?? null;
  for (const dropped of new Set<THREE.Texture>(
    [source.normalMap, source.roughnessMap, source.metalnessMap, source.aoMap].filter(
      (t): t is THREE.Texture => t !== null,
    ),
  )) {
    dropped.dispose();
  }
  const material = new THREE.MeshStandardMaterial({
    color: baseColorMap ? 0xffffff : 0x8a6f4f,
    metalness: 0.05,
    roughness: 0.9,
    side: THREE.DoubleSide,
    // Same reason as the car bodies (render/carmodel.ts): DoubleSide
    // is the only side value three does NOT flip for the depth pass, which would put
    // this body's lit face in the shadow map and make it test against itself. The
    // sun's bias is 2 cm (render/sky.ts) and does not cover that.
    shadowSide: THREE.BackSide,
  });
  if (baseColorMap) {
    material.map = baseColorMap;
    material.needsUpdate = true;
  }
  source.dispose();

  // The source graph has served its purpose: everything needed is baked into the
  // template. Dispose its geometries; the new material (above) is the one that stays.
  const seen = new Set<THREE.BufferGeometry>();
  scene.traverse((child) => {
    if (!(child instanceof THREE.Mesh) || seen.has(child.geometry)) return;
    seen.add(child.geometry);
    child.geometry.dispose();
  });

  template = { body, bodyOpen, wheel, material };
}

/**
 * A fresh trailer visual, sharing geometry and material with every other trailer:
 * with its tailboard, or with it off for a load that overhangs the back.
 */
export function createTrailerModel(tailboard: boolean): TrailerModelInstance {
  const t = template;
  if (!t) throw new Error('Trailer model was not preloaded');

  const body = new THREE.Mesh(tailboard ? t.body : t.bodyOpen, t.material);
  body.castShadow = true;
  body.receiveShadow = true;

  const leftWheel = new THREE.Mesh(t.wheel, t.material);
  leftWheel.castShadow = true;
  const rightWheel = new THREE.Mesh(t.wheel, t.material);
  rightWheel.castShadow = true;
  rightWheel.scale.x = -1; // the authored half is the left wheel

  return { body, leftWheel, rightWheel };
}
