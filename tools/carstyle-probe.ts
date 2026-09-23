/**
 * tools/carstyle-probe.ts
 *
 * Headless checks for the DEV-only unified car style (`?carstyle=unified`, see
 * `unifyCarMaterials` and `creaseCarBodyNormals` in render/carmodel.ts, and the
 * palette in render/materials.ts).
 *
 * The style is a visual experiment, so its evidence is screenshots — but three of its
 * promises cannot be seen in one:
 *
 *  - FLAG OFF CHANGES NOTHING. The style is read once and every pass that touches a
 *    material or a geometry returns on it, so with the flag off a Soviet template must
 *    still be the Phong, atlas-mapped, FBX-authored thing the loader built.
 *  - THE PALETTE IS THE CANON. Four finishes — trim, rubber, rim, chrome — and the
 *    numbers behind them are what makes a Soviet bumper and a GTA trim strip the same
 *    surface; a typo in either the table or the shader's cells silently un-unifies the
 *    whole catalogue.
 *  - CREASING IS POSITION-PRESERVING. The unified style recomputes car-body normals at
 *    a 35 degree crease angle. The paint places its dirt by
 *    chassis position, so creasing may move no vertex and must keep one normal per
 *    vertex; the crease angle itself is pinned with two synthetic folds, one just
 *    under it and one well over.
 *
 * Usage: `bun tools/carstyle-probe.ts` (bun, like the other headless tools; it loads
 * the real models through tools/assetshim.ts).
 */

import * as THREE from 'three';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { installAssetShim } from './assetshim';
import {
  CAR_STYLE_UNIFIED,
  createCarModel,
  preloadCarModels,
} from '../src/render/carmodel';
import {
  CAR_SURFACE_FINISH,
  makeCarBodyConditionMaterial,
  makeUnifiedAtlasMaterial,
  makeUnifiedSurfaceMaterial,
  type CarBodyFrame,
} from '../src/render/materials';

installAssetShim();

const VERT = `#include <common>
void main() {
  #include <begin_vertex>
  #include <worldpos_vertex>
}`;
const FRAG = `#include <common>
#include <map_pars_fragment>
varying vec3 vViewPosition;
void main() {
  #include <map_fragment>
  #include <roughnessmap_fragment>
  #include <metalnessmap_fragment>
  #include <normal_fragment_begin>
  #include <normal_fragment_maps>
}`;

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label.padEnd(58)} ${detail}`);
}

const fragmentOf = (material: THREE.Material): string => {
  const shader = { uniforms: {} as Record<string, unknown>, vertexShader: VERT, fragmentShader: FRAG };
  (material as THREE.MeshStandardMaterial).onBeforeCompile(
    shader as unknown as Parameters<THREE.Material['onBeforeCompile']>[0],
    null as unknown as THREE.WebGLRenderer,
  );
  return shader.fragmentShader;
};

const FRAME: CarBodyFrame = {
  halfExtents: [0.8, 0.7, 2.0],
  frontAxleZ: 1.2,
  rearAxleZ: -1.2,
  wheelCentreY: 0.3,
  wheelRadius: 0.3,
};

await preloadCarModels(['sv_vaz2101', 'gt_vaz2110']);

// --- flag off: the loader's own materials survive untouched -----------------------
const soviet = createCarModel('sv_vaz2101');
const lampMaterials: THREE.Material[] = [];
const bodyMaterials: THREE.Material[] = [];
soviet.body.traverse((node) => {
  if (!(node instanceof THREE.Mesh)) return;
  for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
    if (node.name === '01body') bodyMaterials.push(material);
    else if (node.name !== 'glass') lampMaterials.push(material);
  }
});
const wheelMaterials: THREE.Material[] = [];
for (const wheel of soviet.wheels.values()) {
  wheel.traverse((node: THREE.Object3D) => {
    if (node instanceof THREE.Mesh) {
      wheelMaterials.push(...(Array.isArray(node.material) ? node.material : [node.material]));
    }
  });
}
check('flag off: the flag really is off', CAR_STYLE_UNIFIED === false);
check('flag off: paint is the one converted slot, as before', bodyMaterials.length === 1 && bodyMaterials[0] instanceof THREE.MeshStandardMaterial);
check(
  'flag off: every lamp is still authored Phong',
  lampMaterials.length > 0 && lampMaterials.every((m) => m instanceof THREE.MeshPhongMaterial),
  `${lampMaterials.length} lamp materials`,
);
check(
  'flag off: wheels are still the pack Phong materials',
  wheelMaterials.length > 0 && wheelMaterials.every((m) => m instanceof THREE.MeshPhongMaterial),
  `${wheelMaterials.length} wheel materials`,
);
check(
  'flag off: nothing carried the atlas table into a material',
  [...bodyMaterials, ...wheelMaterials].every((m) => !(m as THREE.MeshStandardMaterial).customProgramCacheKey().includes('atlas')),
);

// --- the atlas table exists only under the flag ----------------------------------
const bodyMesh = (() => {
  let found: THREE.Mesh | null = null;
  soviet.body.traverse((node) => {
    if (!found && node instanceof THREE.Mesh && node.name === '01body') found = node;
  });
  return found!;
})();
const sourceMaterial = (Array.isArray(bodyMesh.material) ? bodyMesh.material[0] : bodyMesh.material)!;

const offShader = fragmentOf(makeCarBodyConditionMaterial(sourceMaterial, FRAME, 7, false));
const onShader = fragmentOf(makeCarBodyConditionMaterial(sourceMaterial, FRAME, 7, true));
check('paint shader, flag off: no atlas table', !offShader.includes('carAtlasFinish'));
check('paint shader, flag off: wear block present', offShader.includes('uDirt + uScratch') && offShader.includes('#include <normal_fragment_maps>'));
check('paint shader, flag on: atlas table present', onShader.includes('carAtlasFinish'));
check('paint shader, flag on: body reading of the grey cell', onShader.includes('false, carAtlasColor'));
check('paint shader, flag on: wear block still present', onShader.includes('uDirt + uScratch'));

// --- the palette is the canonical finish list ------------------------------------
const expected = {
  trim: { color: 0x1b1d1f, roughness: 0.6, metalness: 0 },
  rubber: { color: 0x131415, roughness: 0.9, metalness: 0 },
  rim: { color: 0x8e9296, roughness: 0.45, metalness: 0.3 },
  chrome: { color: 0xb8bec3, roughness: 0.25, metalness: 0.8 },
};
check(
  'palette holds the canonical four finishes',
  JSON.stringify(CAR_SURFACE_FINISH) === JSON.stringify(expected),
  JSON.stringify(CAR_SURFACE_FINISH),
);

// --- the two unified factories ----------------------------------------------------
const atlas = makeUnifiedAtlasMaterial(sourceMaterial, true) as THREE.MeshStandardMaterial;
check('atlas material becomes Standard', atlas instanceof THREE.MeshStandardMaterial);
check('atlas material keeps the pack map', atlas.map === (sourceMaterial as THREE.MeshPhongMaterial).map && atlas.map !== null);
check('atlas material carries the wheel reading', fragmentOf(atlas).includes('true, carAtlasColor'));
const atlasProgram = atlas.customProgramCacheKey();
const atlasBody = makeUnifiedAtlasMaterial(sourceMaterial, false) as THREE.MeshStandardMaterial;
check('wheel and body readings are separate programs', atlasProgram !== atlasBody.customProgramCacheKey(), `${atlasProgram} / ${atlasBody.customProgramCacheKey()}`);

const gta = createCarModel('gt_vaz2110');
const trimSheet = (() => {
  let found: THREE.Material | null = null;
  gta.body.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      if (material.name === 'car_trim') found = material;
    }
  });
  return found! as THREE.MeshStandardMaterial;
})();
check('GTA pack still ships an authored car_trim', trimSheet !== null);
const unifiedTrim = makeUnifiedSurfaceMaterial(trimSheet, { finish: CAR_SURFACE_FINISH.trim }) as THREE.MeshStandardMaterial;
check(
  'forced car_trim takes the palette finish',
  unifiedTrim.roughness === 0.6 && unifiedTrim.metalness === 0 && unifiedTrim.color.getHex() === 0x1b1d1f,
  `${unifiedTrim.roughness}/${unifiedTrim.metalness}/${unifiedTrim.color.getHexString()}`,
);
check('forced car_trim is a clone, source untouched', trimSheet.roughness !== unifiedTrim.roughness);

// --- creasing: positions survive, and the angle reads as intended ------------------
const box = new THREE.Box3().setFromBufferAttribute(bodyMesh.geometry.getAttribute('position') as THREE.BufferAttribute);
const before = Float32Array.from((bodyMesh.geometry.getAttribute('position') as THREE.BufferAttribute).array);
const creased = toCreasedNormals(bodyMesh.geometry, (35 * Math.PI) / 180);
const boxAfter = new THREE.Box3().setFromBufferAttribute(creased.getAttribute('position') as THREE.BufferAttribute);
const after = Float32Array.from((creased.getAttribute('position') as THREE.BufferAttribute).array);
const multiset = (values: Float32Array): string => {
  const sorted = Array.from(values).sort((a, b) => a - b);
  return `${sorted.length}:${sorted.slice(0, 8).join(',')}:${sorted.slice(-8).join(',')}`;
};
check('creasing keeps the body bounds', box.equals(boxAfter), `${box.min.toArray()} / ${boxAfter.min.toArray()}`);
check('creasing keeps every position (multiset)', multiset(before) === multiset(after), `${before.length} -> ${after.length} floats`);
check('creasing writes one normal per vertex', creased.getAttribute('normal').count === creased.getAttribute('position').count);
check('creasing never changes the vertex count', creased.getAttribute('position').count === bodyMesh.geometry.getAttribute('position').count);

/** One fold of `angle` degrees along a shared edge; are the two edge normals averaged? */
function sharedEdgeAveraged(angle: number): boolean {
  const geometry = new THREE.BufferGeometry();
  const rise = Math.tan((angle * Math.PI) / 180);
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([
      // Face 1: edge -X..+X, folded down the -Z side.
      -0.5, 0, 0, 0.5, 0, 0, 0.5, 0, -1,
      // Face 2: the same edge with the same outward side, tilted up by `angle`.
      -0.5, 0, 0, 0.5, 0, 0, -0.5, rise, -1,
    ], 3),
  );
  const result = toCreasedNormals(geometry, (35 * Math.PI) / 180);
  const normal = result.getAttribute('normal');
  // Indices 0 and 3 are the shared-edge vertex, one per face.
  const first = new THREE.Vector3().fromBufferAttribute(normal, 0);
  const second = new THREE.Vector3().fromBufferAttribute(normal, 3);
  return first.angleTo(second) < 0.01;
}
check('a 10 degree fold is smoothed (under the crease angle)', sharedEdgeAveraged(10));
check('a 60 degree fold stays hard (over the crease angle)', !sharedEdgeAveraged(60));

console.log(failures === 0 ? 'carstyle-probe: all checks passed' : `carstyle-probe: ${failures} FAILED`);
if (failures > 0) process.exit(1);
