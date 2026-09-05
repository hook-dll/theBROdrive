#!/usr/bin/env bun
/**
 * Converts the Stylized Vehicles Pack's detailed FBX bodies into the small,
 * game-native scene graph consumed at runtime.
 *
 * Source contract:
 *   Stylized Vehicles Pack/Models/Detailed/<Name>/<Name>.fbx
 *
 * Output contract:
 *   chassis          fixed opaque shell, doors, trim and cabin geometry, one mesh
 *   glass            every window, one mesh
 *   steering_wheel   authored pivot retained for animation
 *   wheel_fl/fr/rl/rr authored pivots retained for suspension animation
 *   Headlights, BrakeLights, TurnLight_L, TurnLight_R
 *                    one mesh per independently controlled lamp channel
 *
 * Rebuilding finishes with glTF Transform's deterministic Meshopt compression.
 *
 * Run without arguments to rebuild all Stylized cars, or pass source names:
 *   bun tools/normalize-stylized.ts Sedan1 Car1
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { mergeVertices, toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import sharp from 'sharp';
import { CAR_MODELS, type CarModelDef, type PalettePaintRamp } from '../src/vehicle/carmodels';

globalThis.document ??= {
  createElementNS: () => ({
    style: {},
    setAttribute() {},
    addEventListener() {},
    removeEventListener() {},
  }),
} as unknown as Document;

// GLTFExporter reads its generated Blob through FileReader. Bun supplies Blob but
// not FileReader, and this is the only FileReader operation the exporter needs.
(globalThis as typeof globalThis & { FileReader?: typeof FileReader }).FileReader ??= class {
  onloadend: (() => void) | null = null;
  result: ArrayBuffer | null = null;

  readAsArrayBuffer(blob: Blob): void {
    void blob.arrayBuffer().then((buffer) => {
      this.result = buffer;
      this.onloadend?.();
    });
  }
} as unknown as typeof FileReader;

const SOURCE_ROOT = 'Stylized Vehicles Pack/Models/Detailed';
const OUTPUT_ROOT = 'public/models/stylized';
const STEERING_NAMES = new Set(['steering_wheel', 'rudder']);
const WHEEL_OUTPUTS = ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr'] as const;
const LAMP_MATERIALS = new Set(['Headlights', 'BrakeLights', 'TurnLight_L', 'TurnLight_R']);
/**
 * Palette luminance (0-255) below which a cell is the pack's INK rather than a
 * material.
 *
 * The source models draw every panel gap — bonnet, doors, boot — as a thin strip of
 * geometry mapped to the near-black end of the palette's neutral ramp. That reads as
 * a pen outline on an otherwise flat-shaded car, which is not the look this game
 * has: the Soviet pack draws no such lines, so the two packs disagreed on the same
 * road. 50 covers #101010 through #2c2c2c — every shade the seams are drawn in —
 * and stops short of #333333, which is the grille shadow, the wiper cowl and the
 * tyre: parts that are meant to be dark.
 */
const INK_MAX_LUMA = 50;
const PALETTE_FILE = 'public/models/stylized/PixelColors.png';
const PALETTE_CELLS = 32;


type Bucket = { position: number[]; normal: number[]; uv: number[]; triangles: number };
type OutputName =
  | 'chassis'
  | 'glass'
  | 'steering_wheel'
  | (typeof WHEEL_OUTPUTS)[number]
  | 'Headlights'
  | 'BrakeLights'
  | 'TurnLight_L'
  | 'TurnLight_R';

const makeBucket = (): Bucket => ({ position: [], normal: [], uv: [], triangles: 0 });

function sourceWheelNames(name: string): Record<(typeof WHEEL_OUTPUTS)[number], string> {
  return {
    wheel_fl: 'FL',
    wheel_fr: 'FR',
    wheel_rl: name === 'Truck1' ? 'BL2' : 'BL',
    wheel_rr: name === 'Truck1' ? 'BR2' : 'BR',
  };
}

function materialAt(mesh: THREE.Mesh, element: number): THREE.Material {
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  if (mesh.geometry.groups.length === 0) return materials[0]!;
  const group = mesh.geometry.groups.find((candidate) => {
    const end = candidate.start + candidate.count;
    return element >= candidate.start && element < end;
  });
  return materials[group?.materialIndex ?? 0]!;
}

function appendTriangle(
  bucket: Bucket,
  mesh: THREE.Mesh,
  element: number,
  positionMatrix: THREE.Matrix4,
  normalMatrix: THREE.Matrix3,
): void {
  const geometry = mesh.geometry;
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const uv = geometry.getAttribute('uv');
  const index = geometry.index;
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();

  for (let corner = 0; corner < 3; corner++) {
    const item = element + corner;
    const vertex = index ? index.getX(item) : item;
    p.fromBufferAttribute(position, vertex).applyMatrix4(positionMatrix);
    bucket.position.push(p.x, p.y, p.z);
    if (normal) {
      n.fromBufferAttribute(normal, vertex).applyNormalMatrix(normalMatrix);
      bucket.normal.push(n.x, n.y, n.z);
    } else {
      bucket.normal.push(0, 1, 0);
    }
    bucket.uv.push(uv?.getX(vertex) ?? 0, uv?.getY(vertex) ?? 0);
  }
  bucket.triangles++;
}

/**
 * Rebuilds one normalized mesh. The source pack stores flat face normals even on
 * shallowly curved coachwork, exposing every triangulation edge as a dark wedge.
 * Average only chassis faces meeting below 35 degrees: broad doors, wings, bonnet
 * and roof become continuous while deliberate creases, panel breaks and lamp
 * pockets retain their authored hard edges.
 */
function geometryOf(bucket: Bucket, smoothChassis: boolean): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(bucket.position, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(bucket.normal, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(bucket.uv, 2));
  const withNormals = smoothChassis ? toCreasedNormals(geometry, THREE.MathUtils.degToRad(35)) : geometry;
  const indexed = mergeVertices(withNormals, 1e-4);
  indexed.computeBoundingBox();
  indexed.computeBoundingSphere();
  return indexed;
}

/**
 * The palette's own pixels, so ink is identified by what a cell LOOKS like rather
 * than by a hardcoded row: the ramps move around the sheet from car to car.
 */
async function paletteLuma(): Promise<Float32Array> {
  const { data, info } = await sharp(PALETTE_FILE).raw().toBuffer({ resolveWithObject: true });
  const luma = new Float32Array(PALETTE_CELLS * PALETTE_CELLS);
  for (let row = 0; row < PALETTE_CELLS; row++) {
    for (let column = 0; column < PALETTE_CELLS; column++) {
      const i = (row * info.width + column) * info.channels;
      luma[row * PALETTE_CELLS + column] =
        0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!;
    }
  }
  return luma;
}

/**
 * Repoints every dark panel-gap triangle at the body's own paint cell.
 *
 * Done to UVs on the raw triangle soup, before `mergeVertices`, so a seam's shared
 * vertices cannot drag a neighbouring panel into the paint cell after indexing.
 */
function flattenSeamInk(bucket: Bucket, ramp: PalettePaintRamp, luma: Float32Array): number {
  const paintU = (ramp.column + 0.5) / PALETTE_CELLS;
  const paintV = (PALETTE_CELLS - 1 - ramp.keyRow + 0.5) / PALETTE_CELLS;
  let flattened = 0;
  for (let triangle = 0; triangle < bucket.triangles; triangle++) {
    const base = triangle * 6;
    const column = Math.floor(bucket.uv[base]! * PALETTE_CELLS);
    const row = PALETTE_CELLS - 1 - Math.floor(bucket.uv[base + 1]! * PALETTE_CELLS);
    if (column < 0 || column >= PALETTE_CELLS || row < 0 || row >= PALETTE_CELLS) continue;
    if (luma[row * PALETTE_CELLS + column]! >= INK_MAX_LUMA) continue;
    for (let corner = 0; corner < 3; corner++) {
      bucket.uv[base + corner * 2] = paintU;
      bucket.uv[base + corner * 2 + 1] = paintV;
    }
    flattened++;
  }
  return flattened;
}

function paletteMaterial(name = 'PixelColors'): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ name, color: 0xffffff, roughness: 0.72, metalness: 0.05 });
}

function meshOf(name: OutputName, bucket: Bucket, material: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(geometryOf(bucket, name === 'chassis'), material);
  mesh.name = name;
  return mesh;
}


/** One decode for the whole run: every body shares this palette. */
const luma = await paletteLuma();

async function exportModel(def: CarModelDef): Promise<Record<string, number>> {
  const name = basename(def.file).replace(/\.(?:fbx|glb)$/i, '');
  const source = join(SOURCE_ROOT, name, `${name}.fbx`);
  const data = readFileSync(source);
  const scene = new FBXLoader().parse(
    data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
    `${dirname(source)}/`,
  );
  scene.name = name;
  scene.updateMatrixWorld(true);

  const meshes: THREE.Mesh[] = [];
  scene.traverse((node) => {
    if (node instanceof THREE.Mesh) meshes.push(node);
  });
  const wheelNames = sourceWheelNames(name);
  const sourceToOutput = new Map(Object.entries(wheelNames).map(([output, input]) => [input, output as OutputName]));

  const buckets = new Map<OutputName, Bucket>();
  const bucket = (output: OutputName): Bucket => {
    let found = buckets.get(output);
    if (!found) {
      found = makeBucket();
      buckets.set(output, found);
    }
    return found;
  };
  const transforms = new Map<OutputName, THREE.Matrix4>();

  for (const mesh of meshes) {
    const wheelOutput = sourceToOutput.get(mesh.name);
    // Truck1's unused middle bogie is deliberately omitted.
    if (name === 'Truck1' && (mesh.name === 'BL' || mesh.name === 'BR')) continue;

    const isSteering = STEERING_NAMES.has(mesh.name);
    const retainedOutput = wheelOutput ?? (isSteering ? 'steering_wheel' : undefined);
    const positionMatrix = retainedOutput ? new THREE.Matrix4() : mesh.matrixWorld;
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(positionMatrix);
    if (retainedOutput) transforms.set(retainedOutput, mesh.matrixWorld.clone());

    const geometry = mesh.geometry;
    const position = geometry.getAttribute('position');
    const uv = geometry.getAttribute('uv');
    const index = geometry.index;
    const count = index?.count ?? position.count;
    const vertexAt = (element: number): number => (index ? index.getX(element) : element);

    for (let element = 0; element + 2 < count; element += 3) {
      const material = materialAt(mesh, element);
      let output: OutputName;
      if (retainedOutput) {
        output = retainedOutput;
      } else if (mesh.name.startsWith('Window') || material.name === 'Glass') {
        output = 'glass';
      } else if (LAMP_MATERIALS.has(material.name)) {
        output = material.name as OutputName;
      } else {
        output = 'chassis';
      }
      appendTriangle(bucket(output), mesh, element, positionMatrix, normalMatrix);
    }
  }
  const inked = 0;

  const output = new THREE.Group();
  output.name = name;
  const sharedPalette = paletteMaterial();
  const materials = new Map<string, THREE.Material>([
    ['chassis', sharedPalette],
    ['steering_wheel', sharedPalette],
    ['wheel_fl', sharedPalette],
    ['wheel_fr', sharedPalette],
    ['wheel_rl', sharedPalette],
    ['wheel_rr', sharedPalette],
    ['glass', paletteMaterial('Glass')],
    ['Headlights', paletteMaterial('Headlights')],
    ['BrakeLights', paletteMaterial('BrakeLights')],
    ['TurnLight_L', paletteMaterial('TurnLight_L')],
    ['TurnLight_R', paletteMaterial('TurnLight_R')],
  ]);

  for (const [outputName, outputBucket] of buckets) {
    if (outputBucket.triangles === 0) continue;
    const mesh = meshOf(outputName, outputBucket, materials.get(outputName)!);
    const transform = transforms.get(outputName);
    if (transform) transform.decompose(mesh.position, mesh.quaternion, mesh.scale);
    output.add(mesh);
  }
  for (const required of ['chassis', 'glass', 'steering_wheel', ...WHEEL_OUTPUTS] as const) {
    if (!output.getObjectByName(required)) throw new Error(`${name} produced no ${required}`);
  }

  const glb = await new Promise<ArrayBuffer>((resolve, reject) => {
    new GLTFExporter().parse(output, (result) => resolve(result as ArrayBuffer), reject, {
      binary: true,
      onlyVisible: false,
      truncateDrawRange: true,
    });
  });
  mkdirSync(OUTPUT_ROOT, { recursive: true });
  writeFileSync(join(OUTPUT_ROOT, `${name}.glb`), Buffer.from(glb));

  return Object.fromEntries([
    ['bytes', glb.byteLength],
    ['seamInk', inked],
    ...[...buckets].map(([outputName, outputBucket]) => [outputName, outputBucket.triangles] as const),
  ]);
}

const requested = new Set(process.argv.slice(2));
const defs = CAR_MODELS.filter((def) => {
  if (def.paintStyle !== 'stylized-palette') return false;
  const name = basename(def.file).replace(/\.(?:fbx|glb)$/i, '');
  return requested.size === 0 || requested.has(name);
});
if (requested.size > 0 && defs.length !== requested.size) {
  const found = new Set(defs.map((def) => basename(def.file).replace(/\.(?:fbx|glb)$/i, '')));
  throw new Error(`unknown Stylized model(s): ${[...requested].filter((name) => !found.has(name)).join(', ')}`);
}

const outputFiles: string[] = [];
for (const def of defs) {
  const name = basename(def.file).replace(/\.(?:fbx|glb)$/i, '');
  const stats = await exportModel(def);
  outputFiles.push(join(OUTPUT_ROOT, `${name}.glb`));
  console.log(`${name}: ${JSON.stringify(stats)}`);
}

const optimizer = 'node_modules/@gltf-transform/cli/bin/cli.js';
for (const file of outputFiles) {
  const optimizedFile = file.replace(/\.glb$/i, '.optimized.glb');
  const optimized = spawnSync(
    process.execPath,
    [
      optimizer,
      'meshopt',
      file,
      optimizedFile,
      '--level',
      'high',
      '--quantize-position',
      '14',
      '--quantize-normal',
      '10',
      '--quantize-texcoord',
      '12',
    ],
    { stdio: 'inherit' },
  );
  if (optimized.status !== 0) {
    throw new Error(`Meshopt compression failed for ${file} with status ${optimized.status}`);
  }
  renameSync(optimizedFile, file);
}
const totalBytes = outputFiles.reduce((sum, file) => sum + statSync(file).size, 0);
console.log(`normalized ${defs.length} models, ${(totalBytes / 1024 / 1024).toFixed(2)} MiB compressed`);
