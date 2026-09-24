import * as THREE from 'three';

import { hash01 } from '../core/rng';
import { applyComicShading } from '../render/comic';
import { CoverKind, Crop, newCoverSample } from './landcover';
import type { WorldOrigin } from './origin';
import type { Road } from './road';
import type { RoadDistance } from './roaddistance';
import type { Terrain } from './terrain';

/**
 * GRASS: the ground under the wheels, within a few tens of metres of the camera.
 *
 * The meadow's colour and the comic shading carry the ground from afar; close to,
 * the eye wants the stuff itself. So a camera-centred ring of `PATCH_M` patches is
 * filled with instanced tufts — short grass, tall grass, meadow flowers, wheat —
 * chosen by the land cover under each one, and planted on the drawn tile surface.
 *
 * Every tuft is a pure function of its cell: a patch that leaves and comes back is
 * the same patch. At the ring's edge a tuft dissolves by dither, never by shrinking.
 *
 * Normals point straight up, so a tuft is lit exactly as the ground it grows from and
 * the grass reads as the meadow's own surface with depth, not as cut-outs on it.
 */

const PATCH_M = 10;
const CELL_M = 1.0;
const CELLS = Math.round(PATCH_M / CELL_M);
const RADIUS_M = 58;
const DISSOLVE_FROM_M = 42;
const TAG = 0x47524153;

export const enum GrassKind {
  Short = 0,
  Tall = 1,
  Flowers = 2,
  Wheat = 3,
}

const KINDS = 4;

/** Blade texture: one cell per kind in a 4x1 atlas, drawn once on a canvas. */
function grassAtlas(): THREE.CanvasTexture {
  const W = 128;
  const H = 128;
  const canvas = document.createElement('canvas');
  canvas.width = W * KINDS;
  canvas.height = H;
  const g = canvas.getContext('2d')!;
  let seed = 7;
  const rnd = (): number => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const blade = (ox: number, x: number, h: number, lean: number, width: number, colour: string): void => {
    g.strokeStyle = colour;
    g.lineWidth = width;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(ox + x, H);
    g.quadraticCurveTo(ox + x + lean * 0.3, H - h * 0.55, ox + x + lean, H - h);
    g.stroke();
  };
  // The meadow's own olive, not a lawn's: the blades must read as the ground's texture.
  const greens = (): string => `hsl(${70 + rnd() * 22}, ${16 + rnd() * 14}%, ${24 + rnd() * 16}%)`;
  // Short: dense low blades.
  for (let i = 0; i < 70; i++) blade(0, 8 + rnd() * 112, 30 + rnd() * 50, (rnd() - 0.5) * 30, 2 + rnd() * 2, greens());
  // Tall: longer, some seed heads.
  for (let i = 0; i < 45; i++) {
    const x = 10 + rnd() * 108;
    const h = 70 + rnd() * 55;
    const lean = (rnd() - 0.5) * 44;
    blade(W, x, h, lean, 2 + rnd() * 1.5, greens());
    if (rnd() < 0.3) {
      g.fillStyle = `hsl(45, 30%, ${55 + rnd() * 15}%)`;
      g.beginPath();
      g.ellipse(W + x + lean, H - h, 2.2, 6, lean * 0.02, 0, Math.PI * 2);
      g.fill();
    }
  }
  // Flowers: blades with heads — chamomile white, buttercup yellow, fireweed pink.
  for (let i = 0; i < 40; i++) blade(W * 2, 8 + rnd() * 112, 28 + rnd() * 55, (rnd() - 0.5) * 30, 2, greens());
  for (let i = 0; i < 14; i++) {
    const x = W * 2 + 14 + rnd() * 100;
    const h = 45 + rnd() * 65;
    const kind = rnd();
    g.strokeStyle = greens();
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(x, H);
    g.lineTo(x + (rnd() - 0.5) * 10, H - h);
    g.stroke();
    if (kind < 0.4) {
      g.fillStyle = '#f2efe4';
      g.beginPath();
      g.arc(x, H - h, 5, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#e7c23a';
      g.beginPath();
      g.arc(x, H - h, 2, 0, Math.PI * 2);
      g.fill();
    } else if (kind < 0.75) {
      g.fillStyle = '#e8c52e';
      g.beginPath();
      g.arc(x, H - h, 3.5, 0, Math.PI * 2);
      g.fill();
    } else {
      g.fillStyle = '#c0508a';
      g.beginPath();
      g.ellipse(x, H - h + 10, 3, 12, 0, 0, Math.PI * 2);
      g.fill();
    }
  }
  // Wheat: straight golden stalks with ears.
  for (let i = 0; i < 60; i++) {
    const x = W * 3 + 6 + rnd() * 116;
    const h = 80 + rnd() * 40;
    const lean = (rnd() - 0.5) * 14;
    g.strokeStyle = `hsl(44, ${45 + rnd() * 15}%, ${48 + rnd() * 14}%)`;
    g.lineWidth = 1.6;
    g.beginPath();
    g.moveTo(x, H);
    g.lineTo(x + lean, H - h);
    g.stroke();
    g.fillStyle = `hsl(42, ${50 + rnd() * 15}%, ${52 + rnd() * 12}%)`;
    g.beginPath();
    g.ellipse(x + lean, H - h - 6, 2.4, 8, lean * 0.03, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Height and width of a tuft of each kind at scale 1, metres. */
const SIZE: readonly [number, number][] = [
  [0.35, 0.9],
  [0.8, 1.0],
  [0.6, 0.95],
  [0.95, 1.1],
];

/** Three crossed quads per kind, the uv mapped to the kind's atlas cell. */
function tuftGeometry(kind: number): THREE.BufferGeometry {
  const [h, w] = SIZE[kind]!;
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 3; i++) {
    const q = new THREE.PlaneGeometry(w, h).translate(0, h / 2, 0).rotateY((i * Math.PI) / 3);
    const uv = q.getAttribute('uv');
    for (let k = 0; k < uv.count; k++) uv.setX(k, (kind + uv.getX(k)) / KINDS);
    const n = q.getAttribute('normal');
    for (let k = 0; k < n.count; k++) n.setXYZ(k, 0, 1, 0);
    parts.push(q);
  }
  const merged = new THREE.BufferGeometry();
  const pos: number[] = [];
  const nor: number[] = [];
  const uvs: number[] = [];
  const idx: number[] = [];
  let base = 0;
  for (const p of parts) {
    const P = p.getAttribute('position');
    const N = p.getAttribute('normal');
    const U = p.getAttribute('uv');
    for (let k = 0; k < P.count; k++) {
      pos.push(P.getX(k), P.getY(k), P.getZ(k));
      nor.push(N.getX(k), N.getY(k), N.getZ(k));
      uvs.push(U.getX(k), U.getY(k));
    }
    const I = p.index!;
    for (let k = 0; k < I.count; k++) idx.push(I.getX(k) + base);
    base += P.count;
  }
  merged.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  merged.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  merged.setIndex(idx);
  return merged;
}

interface Patch {
  readonly key: string;
  /** Per kind: the instance slots this patch owns. */
  readonly slots: number[][];
}

const matrix = new THREE.Matrix4();
const quat = new THREE.Quaternion();
const pos = new THREE.Vector3();
const scl = new THREE.Vector3();
const col = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

export class GrassField {
  private readonly meshes: THREE.InstancedMesh[] = [];
  private readonly free: number[][] = [];
  private readonly highWater: number[] = [];
  private readonly patches = new Map<string, Patch>();
  private readonly cover = newCoverSample();
  private readonly uniforms = { uGrassTime: { value: 0 }, uGrassCamera: { value: new THREE.Vector2() } };
  private lastPx = Number.NaN;
  private lastPz = Number.NaN;
  private lastOriginX = Number.NaN;
  private lastOriginZ = Number.NaN;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly origin: WorldOrigin,
    private readonly terrain: Terrain,
    private readonly road: Road,
    private readonly roadDistance: RoadDistance,
    private readonly groundHeightAt: (x: number, z: number) => number | null,
  ) {
    const material = this.createMaterial();
    const capacity = Math.ceil((Math.PI * (RADIUS_M + PATCH_M) ** 2) / (CELL_M * CELL_M));
    for (let kind = 0; kind < KINDS; kind++) {
      const mesh = new THREE.InstancedMesh(tuftGeometry(kind), material, capacity);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.setColorAt(0, col.setScalar(1));
      scene.add(mesh);
      this.meshes.push(mesh);
      this.free.push([]);
      this.highWater.push(0);
    }
  }

  private createMaterial(): THREE.MeshStandardMaterial {
    const material = applyComicShading(
      new THREE.MeshStandardMaterial({
        map: grassAtlas(),
        alphaTest: 0.5,
        side: THREE.DoubleSide,
        roughness: 1,
        metalness: 0,
      }),
      { contourStrength: 0, stippleStrength: 0, shadowWarmth: 0.3 },
    );
    const compileComic = material.onBeforeCompile;
    const u = this.uniforms;
    material.onBeforeCompile = (shader, renderer) => {
      compileComic.call(material, shader, renderer);
      Object.assign(shader.uniforms, u);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uGrassTime;\nuniform vec2 uGrassCamera;\nvarying float vGrassFade;\nvarying float vGrassHash;')
        .replace(
          '#include <begin_vertex>',
          `vec3 transformed = vec3( position );
#ifdef USE_INSTANCING
{
  vec4 foot = modelMatrix * instanceMatrix * vec4( 0.0, 0.0, 0.0, 1.0 );
  // Wind: tips sway, roots do not; a slow wave rolls across the meadow.
  float phase = uGrassTime * 1.7 + foot.x * 0.21 + foot.z * 0.17;
  float sway = ( sin( phase ) * 0.6 + sin( phase * 2.3 + 1.7 ) * 0.25 ) * position.y * position.y * 0.35;
  transformed.x += sway;
  transformed.z += sway * 0.4;
  vGrassFade = smoothstep( ${DISSOLVE_FROM_M.toFixed(1)}, ${RADIUS_M.toFixed(1)}, length( foot.xz - uGrassCamera ) );
  vGrassHash = fract( sin( dot( foot.xz, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
}
#endif`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vGrassFade;\nvarying float vGrassHash;')
        .replace('#include <map_fragment>', 'if ( vGrassHash < vGrassFade ) discard;\n#include <map_fragment>');
    };
    const key = material.customProgramCacheKey;
    material.customProgramCacheKey = () => `${key.call(material)}:grass-v1`;
    return material;
  }

  /** `x`/`z`: the camera's ABSOLUTE position; `dt`: seconds, for the wind. */
  update(x: number, z: number, dt: number): void {
    this.uniforms.uGrassTime.value = (this.uniforms.uGrassTime.value + dt) % 3600;
    this.uniforms.uGrassCamera.value.set(x - this.origin.x, z - this.origin.z);
    const px = Math.floor(x / PATCH_M);
    const pz = Math.floor(z / PATCH_M);
    if (this.origin.x !== this.lastOriginX || this.origin.z !== this.lastOriginZ) {
      // Instances are origin-relative: a rebase moves every one of them.
      for (const key of [...this.patches.keys()]) this.drop(key);
      this.lastOriginX = this.origin.x;
      this.lastOriginZ = this.origin.z;
      this.lastPx = Number.NaN;
    }
    if (px === this.lastPx && pz === this.lastPz) return;
    this.lastPx = px;
    this.lastPz = pz;
    const R = Math.ceil(RADIUS_M / PATCH_M);
    const wanted = new Set<string>();
    for (let dx = -R; dx <= R; dx++) {
      for (let dz = -R; dz <= R; dz++) {
        const cx = (px + dx + 0.5) * PATCH_M;
        const cz = (pz + dz + 0.5) * PATCH_M;
        if (Math.hypot(cx - x, cz - z) > RADIUS_M + PATCH_M * 0.75) continue;
        wanted.add(`${px + dx},${pz + dz}`);
      }
    }
    for (const key of [...this.patches.keys()]) if (!wanted.has(key)) this.drop(key);
    let built = 0;
    for (const key of wanted) {
      if (this.patches.has(key)) continue;
      // A tile not loaded yet leaves its patch for a later frame.
      if (this.build(key)) built++;
      else this.lastPx = Number.NaN;
      if (built >= 12) {
        this.lastPx = Number.NaN;
        break;
      }
    }
    for (let kind = 0; kind < KINDS; kind++) {
      const mesh = this.meshes[kind]!;
      mesh.count = this.highWater[kind]!;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  private drop(key: string): void {
    const patch = this.patches.get(key);
    if (!patch) return;
    this.patches.delete(key);
    for (let kind = 0; kind < KINDS; kind++) {
      const mesh = this.meshes[kind]!;
      for (const slot of patch.slots[kind]!) {
        mesh.setMatrixAt(slot, ZERO);
        this.free[kind]!.push(slot);
      }
    }
  }

  private slot(kind: number): number | null {
    const free = this.free[kind]!;
    if (free.length > 0) return free.pop()!;
    const mesh = this.meshes[kind]!;
    if (this.highWater[kind]! >= mesh.instanceMatrix.count) return null;
    return this.highWater[kind]!++;
  }

  private build(key: string): boolean {
    const [px, pz] = key.split(',').map(Number) as [number, number];
    const x0 = px * PATCH_M;
    const z0 = pz * PATCH_M;
    if (this.groundHeightAt(x0 + PATCH_M / 2, z0 + PATCH_M / 2) === null) return false;
    const patch: Patch = { key, slots: [[], [], [], []] };
    // One road frame per patch: the lateral of each cell is its offset along the
    // centre's normal, which is exact enough across ten metres of road.
    const approx = this.roadDistance.distAt(x0 + PATCH_M / 2, z0 + PATCH_M / 2, 20);
    let frame: { s: number; lateral: number; nx: number; nz: number; half: number } | null = null;
    if (approx < 40) {
      const p = this.road.project(x0 + PATCH_M / 2, z0 + PATCH_M / 2);
      const c = this.road.sampleAt(p.s);
      frame = { s: p.s, lateral: p.lateral, nx: Math.cos(c.heading), nz: -Math.sin(c.heading), half: this.road.halfWidthAt(p.s) };
    }
    for (let i = 0; i < CELLS; i++) {
      for (let j = 0; j < CELLS; j++) {
        const gx = px * CELLS + i;
        const gz = pz * CELLS + j;
        const x = x0 + (i + hash01(TAG, gx, gz, 1)) * CELL_M;
        const z = z0 + (j + hash01(TAG, gx, gz, 2)) * CELL_M;
        let roadDist = approx;
        let toEdge = 99;
        if (frame) {
          const lat = frame.lateral + (x - x0 - PATCH_M / 2) * frame.nx + (z - z0 - PATCH_M / 2) * frame.nz;
          roadDist = Math.abs(lat);
          toEdge = roadDist - frame.half;
          // Nothing on the asphalt; a bare gravel verge; then the grass.
          if (toEdge < 1.2) continue;
        }
        const r = hash01(TAG, gx, gz, 3);
        const r2 = hash01(TAG, gx, gz, 4);
        this.terrain.cover.sample(x, z, roadDist, this.cover);
        let kind: GrassKind;
        let keep: number;
        let tint = 0.85 + 0.3 * r2;
        if (this.cover.kind === CoverKind.Field) {
          const crop = this.cover.crop;
          if (crop === Crop.Wheat || crop === Crop.Rye) {
            kind = GrassKind.Wheat;
            keep = 0.95;
          } else if (crop === Crop.GreenCrop) {
            kind = GrassKind.Tall;
            keep = 0.8;
            tint *= 1.1;
          } else if (crop === Crop.Fallow || crop === Crop.Hay) {
            kind = r2 < 0.2 ? GrassKind.Flowers : GrassKind.Short;
            keep = 0.55;
          } else {
            continue; // ploughed, stubble
          }
        } else if (this.cover.kind === CoverKind.Forest) {
          kind = GrassKind.Short;
          keep = 0.2;
          tint *= 0.8;
        } else {
          const wet = this.terrain.wetnessAt(x, z);
          if (wet > 0.55) continue; // mud
          // Tall in the ditch and the uncut margins, flowers in lush meadow.
          const ditch = toEdge > 4 && toEdge < 9;
          kind = ditch || r2 > 0.9 ? GrassKind.Tall : r2 < 0.14 + 0.12 * this.cover.lush ? GrassKind.Flowers : GrassKind.Short;
          keep = 0.7 + 0.25 * this.cover.lush;
          if (toEdge < 3) {
            kind = GrassKind.Short;
            keep *= 0.5;
          }
        }
        if (r > keep) continue;
        const y = this.groundHeightAt(x, z);
        if (y === null) continue;
        const slot = this.slot(kind);
        if (slot === null) continue;
        const s = 0.75 + 0.6 * hash01(TAG, gx, gz, 5);
        pos.set(x - this.origin.x, y - 0.03, z - this.origin.z);
        quat.setFromAxisAngle(UP, hash01(TAG, gx, gz, 6) * Math.PI);
        scl.set(s, s * (0.8 + 0.45 * r2), s);
        matrix.compose(pos, quat, scl);
        const mesh = this.meshes[kind]!;
        mesh.setMatrixAt(slot, matrix);
        mesh.setColorAt(slot, col.setScalar(tint));
        patch.slots[kind]!.push(slot);
      }
    }
    this.patches.set(key, patch);
    return true;
  }
}
