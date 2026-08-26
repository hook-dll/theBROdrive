/**
 * Loads, measures and merges the trailer GLB (public/models/trailer/trailer.glb).
 *
 * The role is the reverse of render/carmodel.ts. A car's physics is measured OFF
 * its GLB and the vehicle is built to match; the trailer's physics is a fixed set
 * of constants in vehicle/trailer.ts (bed half-extents, wheel radius, axle offset),
 * and this module fits the ART to those constants. What it returns is therefore not
 * a set of measurements but a body mesh and two wheel meshes already posed in
 * trailer-local space — metres, +X left, +Y up, +Z the hitch direction — ready to be
 * parented under the trailer's rigid-body group.
 *
 * The Sketchfab Collada export arrives two ways it should not. Its two root nodes
 * (Sketchfab_model -> Collada visual scene group) are the usual Z-up-to-Y-up pair
 * and cancel to identity; every part then carries the same scale(100) * rotX(-90),
 * so after loading the trailer sits Y-up with X = length (hitch at -X, tail at +X),
 * Z = width, and 1 scene unit = 1 cm.
 *
 * The wheels are the reference for the whole fit. Their radius sets the uniform
 * scale — the model's 25.1 cm tyres become the physics 0.32 m — and because the
 * model's track is proportional to its wheel radius, the 1.5 m track lands on
 * TRACK_HALF to within a centimetre a side. The axle line is then translated onto
 * the physics axle (axleZ, axleY); the bed rides along, its deck a hand's width
 * under the collider's top face, which is the honest fit for an asset whose bed is
 * 1.9 m long against the physics 2.8 m.
 *
 * The GLB's own A-frame drawbar and hitch coupler are DROPPED. They are a fixed
 * length, and the physics drawbar stretches per coupling (vehicle/trailer.ts scales
 * a unit bar to the towing car's rear overhang), so the authored tongue would leave
 * a visible gap on long-tailed cars. The procedural drawbar stays, and everything
 * forward of the bed's leading face is removed here. The merged wheel pair is also
 * split into two wheels so each rides its own suspension like the procedural pair
 * did; the unsprung axle beam is dropped for the same reason.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const TRAILER_URL = '/models/trailer/trailer.glb';

/** The physics dimensions the art is fitted to (all defined in vehicle/trailer.ts). */
export interface TrailerFit {
  /** Rolling radius of the physics wheel, metres — the model scales to match. */
  readonly wheelRadius: number;
  /** Axle offset from the bed centre along +Z (forward), metres. */
  readonly axleZ: number;
  /** Settled wheel-centre height in trailer-local space, metres. */
  readonly axleY: number;
}

/** A fresh trailer visual: one merged body plus the two wheels, ready to pose. */
export interface TrailerModelInstance {
  readonly body: THREE.Mesh;
  /** The wheel that sits at +X (left), axle along X, centred on its own origin. */
  readonly leftWheel: THREE.Mesh;
  /** The wheel that sits at -X (right); already mirrored about X. */
  readonly rightWheel: THREE.Mesh;
  /** Forward edge of the authored body, where the procedural drawbar begins. */
  readonly drawbarMountZ: number;
}

interface Template {
  readonly body: THREE.BufferGeometry;
  /** One centred wheel geometry (axle along X, radius = fit.wheelRadius). */
  readonly wheel: THREE.BufferGeometry;
  readonly material: THREE.Material;
  /** Forward edge of the fitted body in trailer-local +Z. */
  readonly drawbarMountZ: number;
}

let gltf: GLTFLoader | null = null;
let template: Template | null = null;

/**
 * The authored drawbar and hitch coupler are the only parts forward of the bed's
 * leading face. In the loaded scene that face sits at -1.88 m on X (X is length,
 * hitch at -X, and the scene is in centimetres); every drawbar part has its centre
 * further forward than -1.9 m, every bed part further back than -1.87 m.
 */
const DRAWBAR_FRONT_CM = -190;

/** Diameter of a mesh's round cross-section in the loaded scene (cm). */
function discDiameter(mesh: THREE.Mesh, box: THREE.Box3): number {
  box.setFromObject(mesh);
  return Math.max(box.max.x - box.min.x, box.max.y - box.min.y);
}

/** Translates a geometry so its bounding-box centre sits at the origin. */
function centreOnSelf(geometry: THREE.BufferGeometry): void {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (!box) return;
  geometry.translate(
    -(box.min.x + box.max.x) / 2,
    -(box.min.y + box.max.y) / 2,
    -(box.min.z + box.max.z) / 2,
  );
  geometry.computeBoundingBox();
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
  // about Y so the hitch (-X) faces +Z; scale by the wheel-radius ratio; translate
  // so the model's axle line lands on the physics axle.
  const s = fit.wheelRadius / wheelRadiusScene;
  const fitMatrix = new THREE.Matrix4()
    .makeTranslation(0, fit.axleY - axleScene.y * s, fit.axleZ + axleScene.x * s)
    .multiply(new THREE.Matrix4().makeScale(s, s, s))
    .multiply(new THREE.Matrix4().makeRotationY(Math.PI / 2));

  // --- Wheels ---------------------------------------------------------------
  // Split the merged pair, keep the left half as the shared wheel geometry and
  // mirror it for the right at draw time. `local Y < 0` lands on game +X (left).
  const { left, right } = splitTyrePair(tyreMesh.geometry);
  left.applyMatrix4(tyreMesh.matrixWorld);
  left.applyMatrix4(fitMatrix);
  centreOnSelf(left);
  right.dispose();

  // --- Body ---------------------------------------------------------------
  // Everything except the wheel assembly and the authored drawbar, baked to scene
  // space and merged into one geometry (all 57 meshes share the single material).
  const bodyGeometries: THREE.BufferGeometry[] = [];
  scene.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    if (child === tyreMesh || child === axleMesh) return;
    if (new THREE.Box3().setFromObject(child).getCenter(new THREE.Vector3()).x < DRAWBAR_FRONT_CM) return;
    child.geometry.applyMatrix4(child.matrixWorld);
    bodyGeometries.push(child.geometry);
  });
  const body = mergeGeometries(bodyGeometries);
  if (!body) throw new Error('Trailer model: body merge failed (incompatible attributes)');
  body.applyMatrix4(fitMatrix);
  body.computeBoundingBox();
  const drawbarMountZ = body.boundingBox?.max.z;
  if (drawbarMountZ === undefined || !Number.isFinite(drawbarMountZ)) {
    throw new Error('Trailer model: fitted body has no forward bound');
  }

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

  template = { body, wheel: left, material, drawbarMountZ };
}

/** A fresh trailer visual, sharing geometry and material with every other trailer. */
export function createTrailerModel(): TrailerModelInstance {
  const t = template;
  if (!t) throw new Error('Trailer model was not preloaded');

  const body = new THREE.Mesh(t.body, t.material);
  body.castShadow = true;
  body.receiveShadow = true;

  const leftWheel = new THREE.Mesh(t.wheel, t.material);
  leftWheel.castShadow = true;
  const rightWheel = new THREE.Mesh(t.wheel, t.material);
  rightWheel.castShadow = true;
  rightWheel.scale.x = -1; // the authored half is the left wheel

  return { body, leftWheel, rightWheel, drawbarMountZ: t.drawbarMountZ };
}
