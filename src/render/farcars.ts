/**
 * FAR TRAFFIC: every traffic car beyond `FAR_CAR_ENTER_M` of the eye is drawn as one
 * instance of its model's far mesh instead of as its own scene graph.
 *
 * Measured on the M2 Pro (High): 27 traffic kit cars cost about 1230 of 1650 draw calls a
 * frame, some 28 in the scene pass and 14 in the sun's shadow pass each, and hiding the
 * traffic cut render CPU from 6.1 to 2.3 ms. Most of that traffic stands 90-670 m away,
 * where a car is a few dozen pixels. Here each MODEL is one draw in the scene pass and one
 * per shadow pass, however many of its cars are far.
 *
 * The far mesh (`bakeFarCarGeometry`, built once per model as it loads: render/carmodel.ts)
 * is the kit body in the pose a near car already takes past `KIT_DETAIL_M` (carkit/rig.ts):
 * shut, no cabin, bay, boot or underbody, the glass a tinted mirror, here opaque. Every
 * part keeps its own colour and finish per vertex; the paint takes the instance colour;
 * the lamp lenses glow by the car's own lamps, per instance, so far traffic still shows
 * its head and tail lamps at night. The beams are unchanged: they are the light pool's,
 * per car, and do not depend on what draws the body.
 *
 * Programs (.omp/rules/shader-variants.md): one material for every model, its instance
 * colour made with the mesh, and a hidden anchor in the scene from boot, so
 * `waitForFrameShaders` links its scene-pass and shadow-depth programs behind the loading
 * cover. Every model's mesh is made by the same `makeFarMesh`, so none links anything.
 */

import * as THREE from 'three';
import { KIT_DETAIL_GROUPS } from '../carkit/rig';
import { LENS_ROLE_EMISSIVE, type VehicleLamps } from '../vehicle/vehiclelamps';

/** A traffic car goes far beyond this distance from the eye, metres... */
export const FAR_CAR_ENTER_M = 110;
/**
 * ...and comes back near inside this one. The gap keeps a car driving along the line from
 * swapping every frame. At 50-60 m the swap was in plain sight (reported from play); at
 * 90-110 m a car is a quarter of the size, and in the traffic measured on the M2 Pro four
 * of every five far cars stand further still, so most of the saving is kept.
 */
export const FAR_CAR_EXIT_M = 90;

/**
 * Far cars of one model the mesh holds: the densest traffic setting's wide-road cap (48,
 * game/settings.ts `TRAFFIC_CAPS`) plus the race rivals, with room to spare. A car past
 * it stays drawn in full.
 */
const FAR_CAR_CAPACITY = 64;

/** Per vertex: paint share, roughness, metalness, lamp role (`FarCarSurface`), as bytes. */
const SURFACE_ATTRIBUTE = 'farCarSurface';
/** Per instance: emission of the head, tail and stop lenses. */
const LAMPS_A_ATTRIBUTE = 'farCarLampsA';
/** Per instance: emission of the reverse lenses and the left and right blinkers. */
const LAMPS_B_ATTRIBUTE = 'farCarLampsB';
const PROGRAM_KEY = 'far-car-v1';

/** What one material slot of a model looks like from afar. */
export interface FarCarSurface {
  /** Its colour; ignored for paint, which is the instance's. */
  readonly color: THREE.Color;
  /** Multiplies `color` by the mesh's own vertex colours (kit trim). */
  readonly vertexColors: boolean;
  /** The car's paint: takes the instance colour. */
  readonly paint: boolean;
  readonly roughness: number;
  readonly metalness: number;
  /** 0 for none, else 1 + the lens role's index in `LENS_ROLE_EMISSIVE`. */
  readonly lamp: number;
  /**
   * Its colour map, sampled at each vertex's UV into the vertex colour: the Soviet wheel
   * sets take their rim and tyre colours from a palette texture, and the far mesh has no map.
   */
  readonly map?: THREE.Texture | null;
}

const _local = new THREE.Matrix4();
const _normalMatrix = new THREE.Matrix3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _n = new THREE.Vector3();
const _ab = new THREE.Vector3();
const _ac = new THREE.Vector3();
const _base = new THREE.Color();
const _color = new THREE.Color();
const _texel = new THREE.Color();

/** A map's pixels, read once per texture; null when its image cannot be read. */
const mapPixels = new WeakMap<THREE.Texture, { data: Uint8ClampedArray; width: number; height: number } | null>();

function pixelsOf(map: THREE.Texture): { data: Uint8ClampedArray; width: number; height: number } | null {
  if (mapPixels.has(map)) return mapPixels.get(map)!;
  const image = map.image as (CanvasImageSource & { width: number; height: number }) | undefined;
  let pixels: { data: Uint8ClampedArray; width: number; height: number } | null = null;
  if (image && image.width > 0 && image.height > 0 && typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(image.width, image.height);
    const context = canvas.getContext('2d');
    if (context) {
      context.drawImage(image, 0, 0);
      pixels = { data: context.getImageData(0, 0, image.width, image.height).data, width: image.width, height: image.height };
    }
  }
  mapPixels.set(map, pixels);
  return pixels;
}

interface Piece {
  readonly geometry: THREE.BufferGeometry;
  readonly matrix: THREE.Matrix4;
  readonly start: number;
  readonly count: number;
  readonly surface: FarCarSurface;
}

function toByte(value: number): number {
  return Math.round(Math.min(Math.max(value, 0), 1) * 255);
}

/**
 * One model's far mesh: every visible mesh under `roots` (chassis-local, each root's own
 * transform included) that `describe` gives a surface, merged into one buffer, minus the
 * kit groups a car past `KIT_DETAIL_M` stops drawing. Reads the template without changing it.
 *
 * Non-indexed, as the kit body already is. Colour and surface are bytes and normals
 * signed bytes: a far car is a few dozen pixels, and every model's mesh lives for the
 * session.
 */
export function bakeFarCarGeometry(
  roots: readonly THREE.Object3D[],
  describe: (mesh: THREE.Mesh, material: THREE.Material) => FarCarSurface | null,
): THREE.BufferGeometry {
  const pieces: Piece[] = [];
  const walk = (node: THREE.Object3D, parent: THREE.Matrix4): void => {
    if (!node.visible || KIT_DETAIL_GROUPS.has(node.name)) return;
    const local = node.matrixAutoUpdate ? _local.compose(node.position, node.quaternion, node.scale) : node.matrix;
    const matrix = new THREE.Matrix4().multiplyMatrices(parent, local);
    if (node instanceof THREE.Mesh) {
      const geometry = node.geometry as THREE.BufferGeometry;
      const total = geometry.index ? geometry.index.count : geometry.getAttribute('position').count;
      // Three draws a single-material mesh whole, groups or not.
      const slots = Array.isArray(node.material)
        ? geometry.groups.map((group) => ({ start: group.start, count: group.count, material: (node.material as THREE.Material[])[group.materialIndex ?? 0] }))
        : [{ start: 0, count: total, material: node.material as THREE.Material }];
      for (const slot of slots) {
        if (!slot.material) continue;
        const surface = describe(node, slot.material);
        if (!surface) continue;
        const count = Math.min(slot.count, total - slot.start);
        pieces.push({ geometry, matrix, start: slot.start, count: count - (count % 3), surface });
      }
    }
    for (const child of node.children) walk(child, matrix);
  };
  const identity = new THREE.Matrix4();
  for (const root of roots) walk(root, identity);

  let vertices = 0;
  for (const piece of pieces) vertices += piece.count;
  const positions = new Float32Array(vertices * 3);
  const normals = new Int8Array(vertices * 3);
  const colors = new Uint8Array(vertices * 3);
  const surfaces = new Uint8Array(vertices * 4);
  let v = 0;
  const corner = [_a, _b, _c] as const;
  for (const { geometry, matrix, start, count, surface } of pieces) {
    const index = geometry.index;
    const position = geometry.getAttribute('position');
    const normal = geometry.getAttribute('normal') as THREE.BufferAttribute | undefined;
    const vertexColor = surface.vertexColors ? (geometry.getAttribute('color') as THREE.BufferAttribute | undefined) : undefined;
    const pixels = surface.map ? pixelsOf(surface.map) : null;
    const uv = pixels ? (geometry.getAttribute('uv') as THREE.BufferAttribute | undefined) : undefined;
    _normalMatrix.getNormalMatrix(matrix);
    const paint = surface.paint ? 255 : 0;
    _base.set(surface.paint ? 0xffffff : surface.color);
    const roughness = toByte(surface.roughness);
    const metalness = toByte(surface.metalness);
    for (let k = start; k < start + count; k += 3) {
      for (let j = 0; j < 3; j++) corner[j]!.fromBufferAttribute(position, index ? index.getX(k + j) : k + j).applyMatrix4(matrix);
      // A part without normals is lit by its face's.
      if (!normal) _n.crossVectors(_ab.subVectors(_b, _a), _ac.subVectors(_c, _a)).normalize();
      for (let j = 0; j < 3; j++) {
        const source = index ? index.getX(k + j) : k + j;
        const p = corner[j]!;
        positions[v * 3] = p.x;
        positions[v * 3 + 1] = p.y;
        positions[v * 3 + 2] = p.z;
        if (normal) _n.fromBufferAttribute(normal, source).applyMatrix3(_normalMatrix).normalize();
        normals[v * 3] = Math.round(_n.x * 127);
        normals[v * 3 + 1] = Math.round(_n.y * 127);
        normals[v * 3 + 2] = Math.round(_n.z * 127);
        _color.copy(_base);
        if (vertexColor) {
          _color.r *= vertexColor.getX(source);
          _color.g *= vertexColor.getY(source);
          _color.b *= vertexColor.getZ(source);
        }
        if (pixels && uv) {
          // The texel under the vertex, in the map's sRGB, brought to working colour as the
          // material's own sampling would.
          const repeat = surface.map!.flipY ? 1 - uv.getY(source) : uv.getY(source);
          const x = Math.min(pixels.width - 1, Math.max(0, Math.floor((uv.getX(source) - Math.floor(uv.getX(source))) * pixels.width)));
          const y = Math.min(pixels.height - 1, Math.max(0, Math.floor((repeat - Math.floor(repeat)) * pixels.height)));
          const at = (y * pixels.width + x) * 4;
          _texel.setRGB(pixels.data[at]! / 255, pixels.data[at + 1]! / 255, pixels.data[at + 2]! / 255, THREE.SRGBColorSpace);
          _color.multiply(_texel);
        }
        colors[v * 3] = toByte(_color.r);
        colors[v * 3 + 1] = toByte(_color.g);
        colors[v * 3 + 2] = toByte(_color.b);
        surfaces[v * 4] = paint;
        surfaces[v * 4 + 1] = roughness;
        surfaces[v * 4 + 2] = metalness;
        surfaces[v * 4 + 3] = surface.lamp;
        v++;
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3, true));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3, true));
  geometry.setAttribute(SURFACE_ATTRIBUTE, new THREE.BufferAttribute(surfaces, 4, true));
  return geometry;
}

const VERTEX_PARS = /* glsl */ `#include <common>
attribute vec4 ${SURFACE_ATTRIBUTE};
attribute vec3 ${LAMPS_A_ATTRIBUTE};
attribute vec3 ${LAMPS_B_ATTRIBUTE};
uniform vec3 farCarLampTint[ ${LENS_ROLE_EMISSIVE.length} ];
varying vec2 vFarCarFinish;
varying vec3 vFarCarGlow;`;

/**
 * Three multiplies EVERY vertex by the instance colour; only the paint may take it. The
 * lens role is a byte (`FarCarSurface.lamp`), and its emission this instance's level of
 * that role in that role's colour, exactly as a near lens's `emissive * emissiveIntensity`.
 * The role picks by masks rather than by indexing with it, which some drivers compile
 * badly in a vertex shader.
 */
const VERTEX_COLOR = /* glsl */ `vColor = vec4( color * mix( vec3( 1.0 ), instanceColor.rgb, ${SURFACE_ATTRIBUTE}.x ), 1.0 );
vFarCarFinish = ${SURFACE_ATTRIBUTE}.yz;
float farCarLamp = ${SURFACE_ATTRIBUTE}.w * 255.0;
vec3 farCarRoleA = 1.0 - step( 0.5, abs( vec3( farCarLamp ) - vec3( 1.0, 2.0, 3.0 ) ) );
vec3 farCarRoleB = 1.0 - step( 0.5, abs( vec3( farCarLamp ) - vec3( 4.0, 5.0, 6.0 ) ) );
vFarCarGlow = ( dot( farCarRoleA, ${LAMPS_A_ATTRIBUTE} ) + dot( farCarRoleB, ${LAMPS_B_ATTRIBUTE} ) ) * (
  farCarLampTint[ 0 ] * farCarRoleA.x + farCarLampTint[ 1 ] * farCarRoleA.y + farCarLampTint[ 2 ] * farCarRoleA.z +
  farCarLampTint[ 3 ] * farCarRoleB.x + farCarLampTint[ 4 ] * farCarRoleB.y + farCarLampTint[ 5 ] * farCarRoleB.z
);`;

const FRAGMENT_PARS = /* glsl */ `#include <common>
varying vec2 vFarCarFinish;
varying vec3 vFarCarGlow;`;

let sharedMaterial: THREE.MeshStandardMaterial | null = null;

/**
 * The one far-car material. Double sided and shadowing from its back faces, as every
 * kit slot is (carkit/materials.ts, render/carmodel.ts `prepareMaterials`): the far mesh
 * is the near body's own panels, so it shades and casts as they do.
 */
function farCarMaterial(): THREE.MeshStandardMaterial {
  if (sharedMaterial) return sharedMaterial;
  const material = new THREE.MeshStandardMaterial({ name: 'far-car', vertexColors: true, side: THREE.DoubleSide });
  material.shadowSide = THREE.BackSide;
  const tint = { value: LENS_ROLE_EMISSIVE.map((hex) => new THREE.Color(hex)) };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.farCarLampTint = tint;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', VERTEX_PARS)
      .replace('#include <color_vertex>', VERTEX_COLOR);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', FRAGMENT_PARS)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vFarCarFinish.x;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vFarCarFinish.y;')
      .replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance += vFarCarGlow;');
  };
  material.customProgramCacheKey = () => PROGRAM_KEY;
  return (sharedMaterial = material);
}

/**
 * The one way a far mesh is made, for the boot anchor and every model alike, so all of
 * them are one program: instanced, its instance colour made here (never by a first
 * `setColorAt`), casting like the bodywork it stands for and, like it, receiving nothing.
 */
function makeFarMesh(geometry: THREE.BufferGeometry): THREE.InstancedMesh {
  geometry.setAttribute(LAMPS_A_ATTRIBUTE, new THREE.InstancedBufferAttribute(new Float32Array(FAR_CAR_CAPACITY * 3), 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute(LAMPS_B_ATTRIBUTE, new THREE.InstancedBufferAttribute(new Float32Array(FAR_CAR_CAPACITY * 3), 3).setUsage(THREE.DynamicDrawUsage));
  const mesh = new THREE.InstancedMesh(geometry, farCarMaterial(), FAR_CAR_CAPACITY);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(FAR_CAR_CAPACITY * 3), 3).setUsage(THREE.DynamicDrawUsage);
  mesh.count = 0;
  mesh.castShadow = true;
  mesh.receiveShadow = false;
  // The cars of one model are strewn along kilometres of road: one sphere round all of
  // them would be in view anyway, and keeping it current is work every frame.
  mesh.frustumCulled = false;
  return mesh;
}

/** A hidden far mesh over one triangle carrying every attribute a baked model has. */
function programAnchor(): THREE.InstancedMesh {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(new Int8Array([0, 127, 0, 0, 127, 0, 0, 127, 0]), 3, true));
  geometry.setAttribute('color', new THREE.BufferAttribute(new Uint8Array(9), 3, true));
  geometry.setAttribute(SURFACE_ATTRIBUTE, new THREE.BufferAttribute(new Uint8Array(12), 4, true));
  const mesh = makeFarMesh(geometry);
  mesh.name = 'far-car-program-anchor';
  mesh.visible = false;
  return mesh;
}

interface FarModel {
  readonly mesh: THREE.InstancedMesh;
  readonly lampsA: THREE.InstancedBufferAttribute;
  readonly lampsB: THREE.InstancedBufferAttribute;
  count: number;
}

const _matrix = new THREE.Matrix4();
const ONE = new THREE.Vector3(1, 1, 1);

/**
 * The far meshes, one per model met so far, refilled every frame: `begin`, then `add` per
 * far car, then `end`. A car that went near, despawned or crashed simply is not added, so
 * nothing ever has to be freed, and the frame allocates nothing.
 */
export class FarCarField {
  /** DEV A/B (`__bro.farCars.enabled`): off, every traffic car draws in full. */
  enabled = true;
  /** DEV: this frame's far cars, and the models they were drawn as (one draw each). */
  readonly stats = { cars: 0, models: 0 };
  private readonly group = new THREE.Group();
  private readonly models = new Map<THREE.BufferGeometry, FarModel>();

  constructor(scene: THREE.Scene) {
    this.group.name = 'far-cars';
    this.group.add(programAnchor());
    scene.add(this.group);
  }

  begin(): void {
    for (const model of this.models.values()) model.count = 0;
  }

  /**
   * Draws one car as an instance of `geometry` (its model's `carModelFarGeometry`), at its
   * render pose, in `paint`, its lenses lit as `lamps` lights them. False when it cannot:
   * the field is switched off or the model's mesh is full. That car is then drawn in full.
   */
  add(
    geometry: THREE.BufferGeometry,
    position: THREE.Vector3,
    quaternion: THREE.Quaternion,
    paint: THREE.Color,
    lamps: VehicleLamps,
  ): boolean {
    if (!this.enabled) return false;
    let model = this.models.get(geometry);
    if (!model) {
      const mesh = makeFarMesh(geometry);
      mesh.name = 'far-car';
      this.group.add(mesh);
      model = {
        mesh,
        lampsA: geometry.getAttribute(LAMPS_A_ATTRIBUTE) as THREE.InstancedBufferAttribute,
        lampsB: geometry.getAttribute(LAMPS_B_ATTRIBUTE) as THREE.InstancedBufferAttribute,
        count: 0,
      };
      this.models.set(geometry, model);
    }
    if (model.count >= FAR_CAR_CAPACITY) return false;
    const i = model.count++;
    model.mesh.setMatrixAt(i, _matrix.compose(position, quaternion, ONE));
    model.mesh.setColorAt(i, paint);
    const a = model.lampsA.array as Float32Array;
    const b = model.lampsB.array as Float32Array;
    for (let role = 0; role < 3; role++) {
      a[i * 3 + role] = lamps.lensLevel(role);
      b[i * 3 + role] = lamps.lensLevel(role + 3);
    }
    return true;
  }

  end(): void {
    let cars = 0;
    let models = 0;
    for (const { mesh, lampsA, lampsB, count } of this.models.values()) {
      mesh.count = count;
      mesh.visible = count > 0;
      if (count === 0) continue;
      cars += count;
      models++;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor!.needsUpdate = true;
      lampsA.needsUpdate = true;
      lampsB.needsUpdate = true;
    }
    this.stats.cars = cars;
    this.stats.models = models;
  }
}

/**
 * DEV (`__bro.farCars.stats`): the draws a far car's own graph would cost if shown at
 * that range, one per visible material slot in the scene pass and one per caster in the
 * sun's, without the kit groups that stop drawing past `KIT_DETAIL_M`. An estimate for the
 * A/B; `renderer.info.render.calls` with the field off and on is the measurement.
 */
export function nearDrawEstimate(root: THREE.Object3D): number {
  let draws = 0;
  const walk = (node: THREE.Object3D): void => {
    if (!node.visible || KIT_DETAIL_GROUPS.has(node.name)) return;
    if (node instanceof THREE.Mesh) {
      const slots = Array.isArray(node.material) ? (node.geometry as THREE.BufferGeometry).groups.length : 1;
      draws += slots * (node.castShadow ? 2 : 1);
    }
    for (const child of node.children) walk(child);
  };
  for (const child of root.children) walk(child);
  return draws;
}
