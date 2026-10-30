/**
 * FAR TRAFFIC: every traffic car beyond `FAR_CAR_ENTER_M` of the eye is drawn as one
 * instance of its model's far mesh instead of as its own scene graph.
 *
 * Measured on the M2 Pro (High): 27 traffic kit cars cost about 1230 of 1650 draw calls a
 * frame, some 28 in the scene pass and 14 in the sun's shadow pass each, and hiding the
 * traffic cut render CPU from 6.1 to 2.3 ms. Most of that traffic stands 90-670 m away,
 * where a car is a few dozen pixels.
 *
 * ONE DRAW PER PASS FOR ALL OF THEM. Every far, mid, stand-in and shadow instance of every
 * model is one instance of a `BatchedMesh` (`FarBatch`: one per vertex layout, so the far
 * meshes, the mid parts and the wheels share one and the shadow hulls have their own),
 * drawn with one multi-draw however many models are about. As one InstancedMesh per
 * model and field, 30 traffic cars of 18 models cost ~90 scene draws and ~45 in each live
 * mirror (2026-10-30, cabin view): the fields' draws grew with the number of models met,
 * not cars. Each batch culls and sorts its instances per camera, and an instance a field
 * adds for the shadows alone (`SHADOW_ONLY_LAYER`) is drawn only in shadow passes.
 *
 * The far mesh (`bakeFarCarGeometry`, built once per model as it loads: render/carmodel.ts)
 * is the kit body in the pose a near car already takes past `KIT_DETAIL_M` (carkit/rig.ts):
 * shut, no cabin, bay, boot or underbody (the exhaust is not a detail part: it stays), the
 * glass the opaque tinted mirror. Every
 * part keeps its own colour and finish per vertex; the paint takes the instance colour;
 * the lamp lenses glow by the car's own lamps, per instance (`FarBatch` lamp texture), so
 * far traffic still shows its head and tail lamps at night. The beams are unchanged: they
 * are the light pool's, per car, and do not depend on what draws the body.
 *
 * Programs (.omp/rules/shader-variants.md): every batch's material is made by
 * `farCarMaterial` with one program key, and every batch makes its instance colour
 * texture as it is built (it is in the key: `batchingColor`), so all of them are one
 * program and one depth program. The far layout's batch is in the scene from boot (each
 * scene's `FarBatchPool`), so `waitForFrameShaders` links both behind the loading cover;
 * a batch made later (the shadow hulls') links nothing.
 */

import * as THREE from 'three';
import { KIT_DETAIL_GROUPS, KIT_DETAIL_M } from '../carkit/rig';
import { SHADOW_ONLY_LAYER } from '../core/renderer';
import { LENS_ROLE_EMISSIVE, type VehicleLamps } from '../vehicle/vehiclelamps';
import { CAR_SURFACE_ATTRIBUTE } from './materials';

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
 * MID TRAFFIC: between the kit's detail line and the far line a traffic car draws its
 * paint as one merged mesh in its own paint material (`bakeCarPaintGeometry`), its panes
 * the same way in its own glass (their dust and the rig's opacity are the near panes'),
 * and every other part of it as instances in a second field of this kind: the body's trim
 * and lenses as one per model, its wheels as one per wheel of its set. Past `KIT_DETAIL_M`
 * a near kit car already stands shut without its cabin, bay, boot or underbody, yet still
 * costs some 28 draws (body, doors, lids, wheels, glass, lenses each their own); drawn mid
 * it costs its paint and its glass, a draw each and one each in the sun's pass, plus a
 * share of the shared ones.
 *
 * It goes mid this far past the detail line, so a car crossing it does not swap every
 * frame, and comes back near at the line itself, where the near car's own pose is the
 * same shut, cabinless one the mid meshes were baked in.
 */
export const MID_CAR_ENTER_M = KIT_DETAIL_M + 5;
export const MID_CAR_EXIT_M = KIT_DETAIL_M;

/**
 * Instances a batch starts with; doubled when outgrown (a busier road). Its buffers start
 * with room for `BATCH_FIRST_ROOM` of its first mesh and double as models are met.
 */
const BATCH_INSTANCES = 64;
/**
 * Instances one batch takes at most: far beyond the densest traffic (40 cars,
 * game/settings.ts `TRAFFIC_CAPS`, five or six mid parts each). A car past it stays drawn
 * in full.
 */
const BATCH_INSTANCE_LIMIT = 4096;
/**
 * Texels per row of a batch's lamp texture: two per instance, the head, tail and stop
 * lenses' emission, then the reverse lenses' and the left and right blinkers'.
 */
const LAMP_TEXELS_PER_ROW = 256;
const PROGRAM_KEY = 'far-car-batch-v1';

/**
 * What one material slot of a model looks like from afar. Per vertex it becomes `color`
 * and `CAR_SURFACE_ATTRIBUTE` (render/materials.ts: paint share, roughness, metalness, lamp
 * role), the convention a kit car's own vertices already carry (`perVertex`).
 */
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
  /**
   * A kit part (carkit/materials.ts): its colour and surface are its own vertices', and
   * every field above but `color` (multiplied in) is ignored.
   */
  readonly perVertex?: boolean;
}

const _local = new THREE.Matrix4();
const _normalMatrix = new THREE.Matrix3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _n = new THREE.Vector3();
const _ab = new THREE.Vector3();
const _ac = new THREE.Vector3();
const _t = new THREE.Vector3();
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

interface Piece<S> {
  readonly mesh: THREE.Mesh;
  readonly geometry: THREE.BufferGeometry;
  readonly matrix: THREE.Matrix4;
  readonly start: number;
  readonly count: number;
  readonly surface: S;
}

function toByte(value: number): number {
  return Math.round(Math.min(Math.max(value, 0), 1) * 255);
}

/**
 * Every visible material slot under `roots` that `describe` keeps, with its mesh's
 * chassis-local matrix (each root's own transform included), minus the kit groups a car
 * past `KIT_DETAIL_M` stops drawing unless `whole`. Reads the template without changing it.
 */
export function collectPieces<S>(
  roots: readonly THREE.Object3D[],
  describe: (mesh: THREE.Mesh, material: THREE.Material) => S | null,
  whole = false,
): Piece<S>[] {
  const pieces: Piece<S>[] = [];
  const walk = (node: THREE.Object3D, parent: THREE.Matrix4): void => {
    if (!node.visible || (!whole && KIT_DETAIL_GROUPS.has(node.name))) return;
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
        if (surface === null) continue;
        const count = Math.min(slot.count, total - slot.start);
        pieces.push({ mesh: node, geometry, matrix, start: slot.start, count: count - (count % 3), surface });
      }
    }
    for (const child of node.children) walk(child, matrix);
  };
  const identity = new THREE.Matrix4();
  for (const root of roots) walk(root, identity);
  return pieces;
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
  const pieces = collectPieces(roots, describe);

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
    const own = surface.perVertex ? (geometry.getAttribute(CAR_SURFACE_ATTRIBUTE) as THREE.BufferAttribute | undefined) : undefined;
    const vertexColor = surface.vertexColors || own ? (geometry.getAttribute('color') as THREE.BufferAttribute | undefined) : undefined;
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
        if (own) {
          for (let c = 0; c < 4; c++) surfaces[v * 4 + c] = toByte(own.getComponent(source, c));
        } else {
          surfaces[v * 4] = paint;
          surfaces[v * 4 + 1] = roughness;
          surfaces[v * 4 + 2] = metalness;
          surfaces[v * 4 + 3] = surface.lamp;
        }
        v++;
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3, true));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3, true));
  geometry.setAttribute(CAR_SURFACE_ATTRIBUTE, new THREE.BufferAttribute(surfaces, 4, true));
  return geometry;
}

/**
 * One model's mid paint: every visible paint slot under `roots` (`slotOf` gives its index
 * into the model's paint materials, or -1 for anything else), merged chassis-local into
 * one buffer with one group per paint material, minus the kit groups past `KIT_DETAIL_M`.
 * Null when the model has no paint there.
 *
 * It is drawn in the car's OWN paint material, so it keeps the attributes that material's
 * program reads: every attribute all the pieces share, in float. Position, normal and
 * tangent are carried into the chassis frame; everything else, the chassis stamp
 * (`CAR_BODY_POSITION_ATTRIBUTE`, already chassis-local) included, is copied as it is.
 * A mirrored piece has its corners swapped so its faces keep their winding, which the
 * shadow side reads.
 *
 * `bones` makes it a rigid skin (render/kitdraw.ts): every part, the kit's detail groups
 * included, each vertex weighted 1 to its mesh's bone.
 */
export function bakeCarPaintGeometry(
  roots: readonly THREE.Object3D[],
  slotOf: (mesh: THREE.Mesh, material: THREE.Material) => number,
  bones?: (mesh: THREE.Mesh) => number,
): THREE.BufferGeometry | null {
  const pieces = collectPieces(
    roots,
    (mesh, material) => {
      const slot = slotOf(mesh, material);
      return slot >= 0 ? slot : null;
    },
    bones !== undefined,
  );
  if (pieces.length === 0) return null;
  pieces.sort((a, b) => a.surface - b.surface);

  // The attributes every piece has, each at the size the first piece gives it.
  const sizes = new Map<string, number>();
  for (const [name, attribute] of Object.entries(pieces[0]!.geometry.attributes)) sizes.set(name, attribute.itemSize);
  for (const { geometry } of pieces) {
    for (const [name, size] of sizes) {
      if (geometry.getAttribute(name)?.itemSize !== size) sizes.delete(name);
    }
  }
  sizes.set('normal', 3);

  let vertices = 0;
  for (const piece of pieces) vertices += piece.count;
  const out = new Map<string, Float32Array>();
  for (const [name, size] of sizes) out.set(name, new Float32Array(vertices * size));
  const geometry = new THREE.BufferGeometry();
  const boneOf = bones ? pieces.map((piece) => bones(piece.mesh)) : null;
  const skinIndex = boneOf ? (Math.max(...boneOf) < 256 ? new Uint8Array(vertices * 4) : new Uint16Array(vertices * 4)) : null;
  let v = 0;
  let groupStart = 0;
  const corner = [_a, _b, _c] as const;
  for (let p = 0; p < pieces.length; p++) {
    const { geometry: source, matrix, start, count, surface } = pieces[p]!;
    if (skinIndex) for (let i = v; i < v + count; i++) skinIndex[i * 4] = boneOf![p]!;
    const index = source.index;
    const position = source.getAttribute('position');
    const normal = source.getAttribute('normal') as THREE.BufferAttribute | undefined;
    _normalMatrix.getNormalMatrix(matrix);
    const order = matrix.determinant() < 0 ? ([0, 2, 1] as const) : ([0, 1, 2] as const);
    for (let k = start; k < start + count; k += 3) {
      for (let j = 0; j < 3; j++) corner[j]!.fromBufferAttribute(position, index ? index.getX(k + order[j]!) : k + order[j]!).applyMatrix4(matrix);
      if (!normal) _n.crossVectors(_ab.subVectors(_b, _a), _ac.subVectors(_c, _a)).normalize();
      for (let j = 0; j < 3; j++) {
        const vertex = index ? index.getX(k + order[j]!) : k + order[j]!;
        for (const [name, size] of sizes) {
          const data = out.get(name)!;
          const at = v * size;
          if (name === 'position') {
            corner[j]!.toArray(data, at);
          } else if (name === 'normal') {
            if (normal) _n.fromBufferAttribute(normal, vertex).applyMatrix3(_normalMatrix).normalize();
            _n.toArray(data, at);
          } else {
            const attribute = source.getAttribute(name);
            // `getComponent` denormalizes a quantized attribute.
            for (let c = 0; c < size; c++) data[at + c] = attribute.getComponent(vertex, c);
            if (name === 'tangent') {
              _t.set(data[at]!, data[at + 1]!, data[at + 2]!).transformDirection(matrix).toArray(data, at);
            }
          }
        }
        v++;
      }
    }
    const next = pieces[p + 1];
    if (!next || next.surface !== surface) {
      geometry.addGroup(groupStart, v - groupStart, surface);
      groupStart = v;
    }
  }
  for (const [name, size] of sizes) geometry.setAttribute(name, new THREE.BufferAttribute(out.get(name)!, size));
  if (skinIndex) {
    const weight = new Uint8Array(vertices * 4);
    for (let i = 0; i < vertices; i++) weight[i * 4] = 255;
    geometry.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndex, 4));
    geometry.setAttribute('skinWeight', new THREE.BufferAttribute(weight, 4, true));
  }
  geometry.computeBoundingSphere();
  return geometry;
}

const VERTEX_PARS = /* glsl */ `#include <common>
attribute vec4 ${CAR_SURFACE_ATTRIBUTE};
uniform vec3 farCarLampTint[ ${LENS_ROLE_EMISSIVE.length} ];
uniform highp sampler2D farCarLamps;
varying vec2 vFarCarFinish;
varying vec3 vFarCarGlow;`;

/**
 * Three multiplies EVERY vertex by the batch's instance colour; only the paint may take
 * it. The lens role is a byte (`FarCarSurface.lamp`), and its emission this instance's
 * level of that role in that role's colour, exactly as a near lens's `emissive *
 * emissiveIntensity`; the levels are the instance's two texels of the batch's lamp
 * texture (`FarBatch.put`), found by the instance the multi-draw is drawing (three's
 * batching chunk, `getIndirectIndex`). The role picks by masks rather than by indexing
 * with it, which some drivers compile badly in a vertex shader.
 */
const VERTEX_COLOR = /* glsl */ `float farCarInstance = getIndirectIndex( gl_DrawID );
vColor = vec4( color * mix( vec3( 1.0 ), getBatchingColor( farCarInstance ).rgb, ${CAR_SURFACE_ATTRIBUTE}.x ), 1.0 );
vFarCarFinish = ${CAR_SURFACE_ATTRIBUTE}.yz;
float farCarLamp = ${CAR_SURFACE_ATTRIBUTE}.w * 255.0;
int farCarLampTexel = int( farCarInstance ) * 2;
int farCarLampRow = textureSize( farCarLamps, 0 ).x;
ivec2 farCarLampAt = ivec2( farCarLampTexel % farCarLampRow, farCarLampTexel / farCarLampRow );
vec3 farCarLampsA = texelFetch( farCarLamps, farCarLampAt, 0 ).rgb;
vec3 farCarLampsB = texelFetch( farCarLamps, farCarLampAt + ivec2( 1, 0 ), 0 ).rgb;
vec3 farCarRoleA = 1.0 - step( 0.5, abs( vec3( farCarLamp ) - vec3( 1.0, 2.0, 3.0 ) ) );
vec3 farCarRoleB = 1.0 - step( 0.5, abs( vec3( farCarLamp ) - vec3( 4.0, 5.0, 6.0 ) ) );
vFarCarGlow = ( dot( farCarRoleA, farCarLampsA ) + dot( farCarRoleB, farCarLampsB ) ) * (
  farCarLampTint[ 0 ] * farCarRoleA.x + farCarLampTint[ 1 ] * farCarRoleA.y + farCarLampTint[ 2 ] * farCarRoleA.z +
  farCarLampTint[ 3 ] * farCarRoleB.x + farCarLampTint[ 4 ] * farCarRoleB.y + farCarLampTint[ 5 ] * farCarRoleB.z
);`;

const FRAGMENT_PARS = /* glsl */ `#include <common>
varying vec2 vFarCarFinish;
varying vec3 vFarCarGlow;`;

const LAMP_TINT = { value: LENS_ROLE_EMISSIVE.map((hex) => new THREE.Color(hex)) };

/**
 * A batch's far-car material, over its own lamp texture: every batch's is made here with
 * one program key, so all of them share one program. Double sided and shadowing from its
 * back faces, as every kit slot is (carkit/materials.ts, render/carmodel.ts
 * `prepareMaterials`): the far mesh is the near body's own panels, so it shades and casts
 * as they do.
 */
function farCarMaterial(lamps: { value: THREE.DataTexture }): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ name: 'far-car', vertexColors: true, side: THREE.DoubleSide });
  material.shadowSide = THREE.BackSide;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.farCarLampTint = LAMP_TINT;
    shader.uniforms.farCarLamps = lamps;
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
  return material;
}

/** A lamp texture for `instances` instances (`LAMP_TEXELS_PER_ROW`). */
function lampTexture(instances: number): THREE.DataTexture {
  const rows = Math.ceil((instances * 2) / LAMP_TEXELS_PER_ROW);
  const texture = new THREE.DataTexture(new Float32Array(LAMP_TEXELS_PER_ROW * rows * 4), LAMP_TEXELS_PER_ROW, rows, THREE.RGBAFormat, THREE.FloatType);
  texture.needsUpdate = true;
  return texture;
}

/** Room a new batch makes: this many of its first geometry, at least 4096 vertices. */
const BATCH_FIRST_ROOM = 8;

const WHITE = new THREE.Color(1, 1, 1);

/**
 * Every geometry of one vertex layout, each instance of it any field shows, in one draw
 * per pass. Fields hold their instances for good and reuse them frame after frame
 * (`FarCarField`); this keeps which are wanted this frame and which only cast, and hides
 * the casters from every picture pass (`onBeforeRender`) while the shadow passes draw them.
 */
class FarBatch extends THREE.BatchedMesh {
  /** Per instance: shown by its field now, and drawn in shadow passes alone. */
  private readonly wanted: boolean[] = [];
  private readonly casterOnly: boolean[] = [];
  /** Instances no field holds yet (the one made with the colour texture). */
  private readonly spare: number[] = [];
  private readonly geometryIds = new Map<THREE.BufferGeometry, number>();
  private readonly lamps: { value: THREE.DataTexture };
  private lampData: Float32Array;
  private vertexCapacity: number;
  private indexCapacity: number;

  constructor(first: THREE.BufferGeometry) {
    const vertexCapacity = Math.max(4096, first.getAttribute('position').count * BATCH_FIRST_ROOM);
    const indexCapacity = first.index ? first.index.count * BATCH_FIRST_ROOM : vertexCapacity;
    const lamps = { value: lampTexture(BATCH_INSTANCES) };
    super(BATCH_INSTANCES, vertexCapacity, indexCapacity, farCarMaterial(lamps));
    this.lamps = lamps;
    this.lampData = lamps.value.image.data as Float32Array;
    this.vertexCapacity = vertexCapacity;
    this.indexCapacity = indexCapacity;
    this.name = 'far-car-batch';
    // Casting like the bodywork it stands for and, like it, receiving nothing.
    this.castShadow = true;
    this.receiveShadow = false;
    // The cars are strewn along kilometres of road: each instance is culled on its own.
    this.frustumCulled = false;
    this.visible = false;
    // The colour texture is in the program key (`batchingColor`): made now, so no first
    // `setColorAt` mid-drive links a program.
    const id = this.addInstance(this.geometryId(first));
    this.setColorAt(id, WHITE);
    this.wanted[id] = false;
    this.casterOnly[id] = false;
    this.spare.push(id);
  }

  /** `geometry`'s id in this batch, added (and the buffers grown) the first time. */
  geometryId(geometry: THREE.BufferGeometry): number {
    let id = this.geometryIds.get(geometry);
    if (id !== undefined) return id;
    const vertices = geometry.getAttribute('position').count;
    const indices = geometry.index?.count ?? 0;
    if (vertices > this.unusedVertexCount || indices > this.unusedIndexCount) {
      const usedVertices = this.vertexCapacity - this.unusedVertexCount;
      const usedIndices = this.indexCapacity - this.unusedIndexCount;
      while (usedVertices + vertices > this.vertexCapacity) this.vertexCapacity *= 2;
      while (usedIndices + indices > this.indexCapacity) this.indexCapacity *= 2;
      this.setGeometrySize(this.vertexCapacity, this.indexCapacity);
    }
    id = this.addGeometry(geometry);
    this.geometryIds.set(geometry, id);
    return id;
  }

  /** Whether `count` more instances fit. */
  room(count: number): boolean {
    return count <= this.spare.length + BATCH_INSTANCE_LIMIT - this.instanceCount;
  }

  /** A new instance of geometry `geometryId` for a field to hold; `room` first. */
  allocate(geometryId: number): number {
    const spare = this.spare.pop();
    if (spare !== undefined) return spare;
    if (this.instanceCount >= this.maxInstanceCount) {
      const count = this.maxInstanceCount * 2;
      this.setInstanceCount(count);
      const old = this.lamps.value;
      this.lamps.value = lampTexture(count);
      this.lampData = this.lamps.value.image.data as Float32Array;
      this.lampData.set(old.image.data as Float32Array);
      old.dispose();
    }
    const id = this.addInstance(geometryId);
    this.wanted[id] = false;
    this.casterOnly[id] = false;
    return id;
  }

  /**
   * Instance `id` as geometry `geometryId` at `matrix`, in `paint`, its lenses lit as
   * `lamps` lights them (null: a part without lenses, or a caster); `casterOnly` draws it
   * in shadow passes alone.
   */
  put(id: number, geometryId: number, matrix: THREE.Matrix4, paint: THREE.Color, lamps: VehicleLamps | null, casterOnly: boolean): void {
    if (this.getGeometryIdAt(id) !== geometryId) this.setGeometryIdAt(id, geometryId);
    this.setMatrixAt(id, matrix);
    this.setColorAt(id, paint);
    const data = this.lampData;
    const at = id * 8;
    for (let role = 0; role < 3; role++) {
      data[at + role] = lamps ? lamps.lensLevel(role) : 0;
      data[at + 4 + role] = lamps ? lamps.lensLevel(role + 3) : 0;
    }
    this.lamps.value.needsUpdate = true;
    this.casterOnly[id] = casterOnly;
  }

  want(id: number, wanted: boolean): void {
    this.wanted[id] = wanted;
  }

  /**
   * After a field changed what it wants: hidden with nothing wanted, and on the
   * shadow-only layer (core/renderer.ts `SHADOW_ONLY_LAYER`) while it holds casters
   * alone, so no picture pass sets it up to draw nothing. Between passes the instances
   * stand as a picture shows them, so a ray cast meets no caster and no stand-in the
   * mirrors have let go.
   */
  refresh(): void {
    let pictures = false;
    let casters = false;
    for (let i = 0; i < this.wanted.length; i++) {
      const wanted = this.wanted[i]!;
      this.setVisibleAt(i, wanted && !this.casterOnly[i]);
      if (!wanted) continue;
      if (this.casterOnly[i]) casters = true;
      else pictures = true;
    }
    this.visible = pictures || casters;
    this.layers.set(pictures ? 0 : SHADOW_ONLY_LAYER);
  }

  /**
   * A shadow pass: the wanted instances, casters included. Three r187 builds a shadow
   * camera's draw list here directly; r185 went through `onBeforeRender`, where this
   * used to be decided, so after the upgrade no stand-in or hull cast: a traffic car
   * between the self-shadow line and the wide map's reach had no shadow at all.
   */
  override onBeforeShadow(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    shadowCamera: THREE.Camera,
    geometry: THREE.BufferGeometry,
    depthMaterial: THREE.Material,
    group: THREE.Group,
  ): void {
    for (let i = 0; i < this.wanted.length; i++) this.setVisibleAt(i, this.wanted[i]!);
    super.onBeforeShadow(renderer, scene, camera, shadowCamera, geometry, depthMaterial, group);
  }

  /** A picture pass (the frame, a mirror): the wanted instances, without the casters. */
  override onBeforeRender(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    group: THREE.Group,
  ): void {
    for (let i = 0; i < this.wanted.length; i++) this.setVisibleAt(i, this.wanted[i]! && !this.casterOnly[i]);
    super.onBeforeRender(renderer, scene, camera, geometry, material, group);
  }
}

/** A vertex layout: what a batch's buffers are made of (three's `BatchedMesh` takes one). */
function layoutOf(geometry: THREE.BufferGeometry): string {
  let key = geometry.index ? 'indexed' : 'flat';
  for (const name of Object.keys(geometry.attributes).sort()) {
    const attribute = geometry.getAttribute(name) as THREE.BufferAttribute;
    key += `|${name}:${attribute.itemSize}${attribute.normalized ? 'n' : ''}:${attribute.array.constructor.name}`;
  }
  return key;
}

/** One triangle carrying every attribute a baked far mesh has, as `bakeFarCarGeometry` makes them. */
function farLayoutSample(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(new Int8Array([0, 127, 0, 0, 127, 0, 0, 127, 0]), 3, true));
  geometry.setAttribute('color', new THREE.BufferAttribute(new Uint8Array(9), 3, true));
  geometry.setAttribute(CAR_SURFACE_ATTRIBUTE, new THREE.BufferAttribute(new Uint8Array(12), 4, true));
  return geometry;
}

/** One scene's batches, one per vertex layout, each made as its first geometry comes. */
class FarBatchPool {
  private readonly group = new THREE.Group();
  private readonly byLayout = new Map<string, FarBatch>();
  private readonly byGeometry = new WeakMap<THREE.BufferGeometry, FarBatch>();

  constructor(scene: THREE.Scene) {
    this.group.name = 'far-car-batches';
    scene.add(this.group);
    // The far meshes' batch from the start, so it is in the scene at boot and
    // `waitForFrameShaders` links its programs (the hulls' batch shares them).
    this.batchFor(farLayoutSample());
  }

  batchFor(geometry: THREE.BufferGeometry): FarBatch {
    let batch = this.byGeometry.get(geometry);
    if (batch) return batch;
    const layout = layoutOf(geometry);
    batch = this.byLayout.get(layout);
    if (!batch) {
      batch = new FarBatch(geometry);
      this.byLayout.set(layout, batch);
      this.group.add(batch);
    }
    this.byGeometry.set(geometry, batch);
    return batch;
  }
}

const pools = new WeakMap<THREE.Scene, FarBatchPool>();

const _matrix = new THREE.Matrix4();
const _part = new THREE.Matrix4();
const ONE = new THREE.Vector3(1, 1, 1);

/** One wheel of a mid car (render/carmodel.ts `CarMidModel`): its set's mesh, chassis-local. */
export interface MidCarWheel {
  readonly geometry: THREE.BufferGeometry;
  readonly matrix: THREE.Matrix4;
}

/** A field's instances in one batch: all it ever needed, the first `used` shown this frame. */
interface FieldSlots {
  readonly ids: number[];
  used: number;
}

/**
 * One use of the scene's far batches, refilled every frame: `begin`, then `add` per far
 * car, then `end`. A car that went near, despawned or crashed simply is not added, so
 * nothing ever has to be freed, and the frame allocates nothing once the field has held
 * its busiest frame's instances.
 *
 * The far cars, the mid cars' shared parts (`addMid`), the live mirrors' stand-ins
 * (render/carmirrors.ts) and near traffic's shadow casters are each a field over the same
 * batches: all of them together are one draw per batch and pass.
 */
export class FarCarField {
  /** DEV A/B (`__bro.farCars.enabled`, `__bro.midCars.enabled`): off, every traffic car draws in full. */
  enabled = true;
  /** DEV: this frame's instances, the models (meshes) they were, and the batches they are in. */
  readonly stats = { cars: 0, models: 0, batches: 0 };
  private readonly pool: FarBatchPool;
  private readonly slots = new Map<FarBatch, FieldSlots>();
  private shown = true;
  private frame = 0;
  /** The frame each mesh was last added in, for `stats.models`. */
  private readonly seen = new Map<THREE.BufferGeometry, number>();
  private cars = 0;
  private models = 0;

  /**
   * `castersOnly`: a field that casts the sun's and the lamps' shadows and is drawn in no
   * picture (near traffic's shadows, which its far mesh and hull cast for it).
   */
  constructor(scene: THREE.Scene, private readonly castersOnly = false) {
    let pool = pools.get(scene);
    if (!pool) {
      pool = new FarBatchPool(scene);
      pools.set(scene, pool);
    }
    this.pool = pool;
  }

  /** Shows or hides everything the field holds, whatever `end` decided. */
  setVisible(visible: boolean): void {
    this.shown = visible;
    for (const [batch, slots] of this.slots) {
      for (let i = 0; i < slots.used; i++) batch.want(slots.ids[i]!, visible);
      batch.refresh();
    }
  }

  begin(): void {
    this.frame++;
    this.cars = 0;
    this.models = 0;
    for (const slots of this.slots.values()) slots.used = 0;
  }

  /**
   * Draws one car as an instance of `geometry` (its model's `carModelFarGeometry`), at its
   * render pose, in `paint`, its lenses lit as `lamps` lights them. False when it cannot:
   * the field is switched off or its batch is full. That car is then drawn in full.
   */
  add(
    geometry: THREE.BufferGeometry,
    position: THREE.Vector3,
    quaternion: THREE.Quaternion,
    paint: THREE.Color,
    lamps: VehicleLamps,
  ): boolean {
    if (!this.enabled) return false;
    const batch = this.pool.batchFor(geometry);
    if (!this.room(batch, 1)) return false;
    this.place(batch, geometry, _matrix.compose(position, quaternion, ONE), paint, lamps);
    return true;
  }

  /**
   * One instance of a mesh that only casts, at a car's render pose: the shadow hull
   * (render/carshadowhull.ts) in the shadow-only field. False when the field is off or full.
   */
  addCaster(geometry: THREE.BufferGeometry, position: THREE.Vector3, quaternion: THREE.Quaternion): boolean {
    if (!this.enabled) return false;
    const batch = this.pool.batchFor(geometry);
    if (!this.room(batch, 1)) return false;
    this.place(batch, geometry, _matrix.compose(position, quaternion, ONE), WHITE, null);
    return true;
  }

  /**
   * Draws a mid car's shared parts at its render pose: `rest` (its model's trim, glass and
   * lenses, lit as `lamps` lights them; null for a kit car, whose own mid mesh is the
   * whole body) and each of `wheels`. All or none: false, and nothing added, when the
   * field is off or their batch is full.
   */
  addMid(
    rest: THREE.BufferGeometry | null,
    wheels: readonly MidCarWheel[],
    position: THREE.Vector3,
    quaternion: THREE.Quaternion,
    lamps: VehicleLamps,
  ): boolean {
    if (!this.enabled) return false;
    // As if every part were in each part's batch: they all share one in practice.
    const parts = (rest ? 1 : 0) + wheels.length;
    if (rest && !this.room(this.pool.batchFor(rest), parts)) return false;
    for (const wheel of wheels) if (!this.room(this.pool.batchFor(wheel.geometry), parts)) return false;
    _matrix.compose(position, quaternion, ONE);
    // The rest carries no paint: its instance colour multiplies nothing.
    if (rest) this.place(this.pool.batchFor(rest), rest, _matrix, WHITE, lamps);
    for (const wheel of wheels) {
      this.place(this.pool.batchFor(wheel.geometry), wheel.geometry, _part.multiplyMatrices(_matrix, wheel.matrix), WHITE, null);
    }
    return true;
  }

  /** Whether `count` more instances fit in `batch`, counting the field's idle ones there. */
  private room(batch: FarBatch, count: number): boolean {
    const slots = this.slots.get(batch);
    const idle = slots ? slots.ids.length - slots.used : 0;
    return count <= idle || batch.room(count - idle);
  }

  /** One instance at `matrix`; `lamps` null for a part without lenses (a wheel). */
  private place(batch: FarBatch, geometry: THREE.BufferGeometry, matrix: THREE.Matrix4, paint: THREE.Color, lamps: VehicleLamps | null): void {
    let slots = this.slots.get(batch);
    if (!slots) {
      slots = { ids: [], used: 0 };
      this.slots.set(batch, slots);
    }
    const geometryId = batch.geometryId(geometry);
    if (slots.used === slots.ids.length) slots.ids.push(batch.allocate(geometryId));
    batch.put(slots.ids[slots.used++]!, geometryId, matrix, paint, lamps, this.castersOnly);
    this.cars++;
    if (this.seen.get(geometry) !== this.frame) {
      this.seen.set(geometry, this.frame);
      this.models++;
    }
  }

  end(): void {
    let batches = 0;
    for (const [batch, slots] of this.slots) {
      for (let i = 0; i < slots.ids.length; i++) batch.want(slots.ids[i]!, this.shown && i < slots.used);
      batch.refresh();
      if (slots.used > 0) batches++;
    }
    this.stats.cars = this.cars;
    this.stats.models = this.models;
    this.stats.batches = batches;
  }
}

/**
 * DEV (`__bro.farCars.stats`, `__bro.midCars.stats`): the draws a car's near parts (its
 * body and wheels: `Vehicle.nearParts`, shown or hidden) would cost if drawn past
 * `KIT_DETAIL_M`, one per visible material slot in the scene pass and one per caster in
 * the sun's, without the kit groups that stop drawing there and the pick proxies no
 * picture draws (render/kitdraw.ts `KIT_PICK_LAYER`). An estimate for the A/B;
 * `renderer.info.render.calls` with the field off and on is the measurement.
 */
export function nearDrawEstimate(parts: readonly THREE.Object3D[]): number {
  let draws = 0;
  const walk = (node: THREE.Object3D, part: boolean): void => {
    if ((!part && !node.visible) || KIT_DETAIL_GROUPS.has(node.name)) return;
    if (node instanceof THREE.Mesh && node.layers.isEnabled(0)) {
      const slots = Array.isArray(node.material) ? (node.geometry as THREE.BufferGeometry).groups.length : 1;
      draws += slots * (node.castShadow ? 2 : 1);
    }
    for (const child of node.children) walk(child, false);
  };
  for (const part of parts) walk(part, true);
  return draws;
}
