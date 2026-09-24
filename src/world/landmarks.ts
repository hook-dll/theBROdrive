import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import { hashUnit3 } from '../core/rng';
import { applyComicShading } from '../render/comic';
import type { WorldOrigin } from './origin';
import type { RoadDistance } from './roaddistance';
import type { Terrain } from './terrain';

/**
 * LANDMARKS: what the desert's mesas were — things big enough, and far enough off, that
 * the eye measures the land by them.
 *
 * A plain has no mesas; it has what people built on it. A bell tower on a rise, a
 * Rozhnovsky water tower, a grain elevator standing over its fields, a radio mast, and
 * above all the high-voltage line: lattice towers marching across the fields to the
 * horizon, each smaller than the last, which is perspective drawn for you. They stand
 * in the world, at fixed places, and stay there as you drive toward and past them.
 *
 * Everything is a handful of instanced, vertex-coloured, faceted meshes under the
 * comic shading; the post pass inks their silhouettes like anything else.
 */

const CELL_M = 2600;
const VIEW_M = 9000;
const REFRESH_M = 400;
/** Nothing is built closer than this to the road; the corridor is the road's. */
const ROAD_KEEP_M = 260;
const TAG = 0x4c414e44;

/** Power lines: one straight line per band, bands this far apart, towers this far apart. */
const LINE_BAND_M = 5200;
const LINE_SPAN_M = 300;
const LINE_ROAD_KEEP_M = 45;
const PYLON_HEIGHT = 24;

type Rgb = readonly [number, number, number];
function rgb(hex: number): Rgb {
  const c = new THREE.Color().setHex(hex);
  return [c.r, c.g, c.b];
}

function paint(g: THREE.BufferGeometry, colour: Rgb): THREE.BufferGeometry {
  const geo = g.index ? g.toNonIndexed() : g;
  const n = geo.getAttribute('position').count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.set(colour, i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  if (geo.getAttribute('uv')) geo.deleteAttribute('uv');
  geo.computeVertexNormals();
  return geo;
}

function onion(radius: number, height: number): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    // A bulb that swells above its drum and draws to a point.
    const r = radius * Math.sin(Math.PI * Math.min(1, t * 1.25)) * (1 - t * 0.35) + (t > 0.85 ? 0 : 0);
    pts.push(new THREE.Vector2(Math.max(0.02, r), t * height));
  }
  return new THREE.LatheGeometry(pts, 10);
}

const WHITE = rgb(0xe9e4d8);
const GREEN_ROOF = rgb(0x4f7d68);
const GOLD = rgb(0xc9a23c);
const BRICK = rgb(0x9a5a44);
const STEEL = rgb(0x6b6f73);
const CONCRETE = rgb(0xb3ada2);
const RED = rgb(0xb8412f);

function church(): THREE.BufferGeometry {
  const parts = [
    paint(new THREE.BoxGeometry(12, 9, 16).translate(0, 4.5, 0), WHITE),
    paint(new THREE.CylinderGeometry(0.1, 8.6, 3.5, 4).rotateY(Math.PI / 4).scale(1, 1, 1.3).translate(0, 10.7, 0), GREEN_ROOF),
    paint(new THREE.CylinderGeometry(3, 3, 5, 10).translate(0, 11, 0), WHITE),
    paint(onion(3.4, 6).translate(0, 13.5, 0), GOLD),
    paint(new THREE.CylinderGeometry(0.08, 0.08, 3, 4).translate(0, 20.8, 0), GOLD),
    // Bell tower at the west end.
    paint(new THREE.BoxGeometry(6.5, 28, 6.5).translate(0, 14, -12), WHITE),
    paint(new THREE.BoxGeometry(5.4, 7, 5.4).translate(0, 31.5, -12), WHITE),
    paint(new THREE.ConeGeometry(4, 10, 8).translate(0, 40, -12), GREEN_ROOF),
    paint(onion(1.5, 3).translate(0, 44.6, -12), GOLD),
  ];
  return mergeGeometries(parts);
}

function waterTower(): THREE.BufferGeometry {
  return mergeGeometries([
    paint(new THREE.CylinderGeometry(2.6, 3.1, 24, 12).translate(0, 12, 0), BRICK),
    paint(new THREE.CylinderGeometry(4.6, 3.6, 6.5, 14).translate(0, 27, 0), STEEL),
    paint(new THREE.ConeGeometry(4.9, 2.6, 14).translate(0, 31.5, 0), STEEL),
  ]);
}

function elevator(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 2; j++) {
      parts.push(paint(new THREE.CylinderGeometry(3, 3, 34, 12).translate(i * 6.2 - 9.3, 17, j * 6.2 - 3.1), CONCRETE));
    }
  }
  parts.push(paint(new THREE.BoxGeometry(8, 48, 9).translate(16, 24, 0), CONCRETE));
  parts.push(paint(new THREE.BoxGeometry(26, 3, 12).translate(0, 35.5, 0), CONCRETE));
  return mergeGeometries(parts);
}

function lattice(height: number, baseHalf: number, topHalf: number, levels: number, radius: number, colour: (level: number) => Rgb): THREE.BufferGeometry[] {
  const parts: THREE.BufferGeometry[] = [];
  const corners: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  const at = (t: number, sx: number, sz: number): THREE.Vector3 => {
    const h = baseHalf + (topHalf - baseHalf) * t;
    return new THREE.Vector3(sx * h, t * height, sz * h);
  };
  const strut = (a: THREE.Vector3, b: THREE.Vector3, r: number, col: Rgb): void => {
    const dir = new THREE.Vector3().subVectors(b, a);
    const geo = new THREE.CylinderGeometry(r, r, dir.length(), 4, 1, true);
    geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()));
    const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
    geo.translate(mid.x, mid.y, mid.z);
    parts.push(paint(geo, col));
  };
  for (let l = 0; l < levels; l++) {
    const t0 = l / levels;
    const t1 = (l + 1) / levels;
    const col = colour(l);
    for (let k = 0; k < 4; k++) {
      const [ax, az] = corners[k]!;
      const [bx, bz] = corners[(k + 1) % 4]!;
      strut(at(t0, ax, az), at(t1, ax, az), radius, col);
      strut(at(t0, ax, az), at(t1, bx, bz), radius * 0.6, col);
    }
  }
  return parts;
}

function mast(): THREE.BufferGeometry {
  return mergeGeometries(lattice(92, 2.2, 0.6, 14, 0.18, (l) => (l % 2 === 0 ? RED : WHITE)));
}

/**
 * A power-line mast in the countryside's language: one slim tapered post and a
 * crossarm — a stroke on the sky, not a lattice. Arms along X.
 */
function pylon(): THREE.BufferGeometry {
  return mergeGeometries([
    paint(new THREE.CylinderGeometry(0.22, 0.5, PYLON_HEIGHT, 4).rotateY(Math.PI / 4).translate(0, PYLON_HEIGHT / 2, 0), STEEL),
    paint(new THREE.BoxGeometry(11, 0.35, 0.35).translate(0, PYLON_HEIGHT * 0.86, 0), STEEL),
    paint(new THREE.BoxGeometry(6, 0.3, 0.3).translate(0, PYLON_HEIGHT * 0.97, 0), STEEL),
  ]);
}

/** Where the conductors hang, in a pylon's own frame (arms along X). */
const CONDUCTORS: readonly [number, number][] = [
  [-5.2, PYLON_HEIGHT * 0.86 - 0.4],
  [5.2, PYLON_HEIGHT * 0.86 - 0.4],
  [0, PYLON_HEIGHT * 0.97 - 0.4],
];

const KINDS = ['church', 'waterTower', 'elevator', 'mast'] as const;
type Kind = (typeof KINDS)[number];
/** Cumulative chance per cell of each kind; the rest of the cells hold nothing. */
const CHANCES: Record<Kind, number> = { church: 0.06, waterTower: 0.22, elevator: 0.3, mast: 0.4 };

interface Placed {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
}

/**
 * AERIAL PERSPECTIVE FOR ANCHORS. The world's fog is tuned to dissolve the ground by a
 * kilometre or two; a landmark is the one thing meant to be read from six. It fades
 * into the same haze colour on a much thinner air, so a distant bell tower turns pale
 * blue-grey and stays a bell tower — which is exactly how the eye knows it is far.
 */
const LANDMARK_FOG_SCALE = 0.4;

function thinFog(material: THREE.MeshStandardMaterial): void {
  const compile = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    compile.call(material, shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <fog_fragment>',
      `#ifdef USE_FOG
#ifdef FOG_EXP2
  float landmarkFog = 1.0 - exp( - fogDensity * fogDensity * ${(LANDMARK_FOG_SCALE * LANDMARK_FOG_SCALE).toFixed(4)} * vFogDepth * vFogDepth );
#else
  float landmarkFog = smoothstep( fogNear, fogFar / ${LANDMARK_FOG_SCALE.toFixed(2)}, vFogDepth );
#endif
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, landmarkFog );
#endif`,
    );
  };
  const key = material.customProgramCacheKey;
  material.customProgramCacheKey = () => `${key.call(material)}:landmark-fog-v1`;
}

export class Landmarks {
  private readonly meshes = new Map<Kind | 'pylon', THREE.InstancedMesh>();
  private readonly wires: THREE.LineSegments;
  private lastX = Number.NaN;
  private lastZ = Number.NaN;
  private lastOriginX = Number.NaN;
  private lastOriginZ = Number.NaN;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly origin: WorldOrigin,
    private readonly terrain: Terrain,
    private readonly roadDistance: RoadDistance,
    private readonly seed: number,
  ) {
    const material = applyComicShading(
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 }),
      { contourStrength: 0, stippleStrength: 0 },
    );
    thinFog(material);
    const make = (key: Kind | 'pylon', geometry: THREE.BufferGeometry, capacity: number): void => {
      const mesh = new THREE.InstancedMesh(geometry, material, capacity);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      this.meshes.set(key, mesh);
    };
    make('church', church(), 32);
    make('waterTower', waterTower(), 32);
    make('elevator', elevator(), 32);
    make('mast', mast(), 32);
    make('pylon', pylon(), 512);
    this.wires = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0x3a3848, transparent: true, opacity: 0.35, fog: true }),
    );
    this.wires.frustumCulled = false;
    scene.add(this.wires);
  }

  /** `x`/`z`: camera ABSOLUTE position. */
  update(x: number, z: number): void {
    if (
      Math.hypot(x - this.lastX, z - this.lastZ) < REFRESH_M &&
      this.origin.x === this.lastOriginX &&
      this.origin.z === this.lastOriginZ
    ) {
      return;
    }
    this.lastX = x;
    this.lastZ = z;
    this.lastOriginX = this.origin.x;
    this.lastOriginZ = this.origin.z;
    this.rebuild(x, z);
  }

  private ground(x: number, z: number): number {
    const s = this.roadDistance.ownerAt(x, z, 200);
    return this.terrain.openBase(x, z, 1000, s);
  }

  private rebuild(camX: number, camZ: number): void {
    const counts = new Map<string, number>();
    const matrix = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const one = new THREE.Vector3(1, 1, 1);
    const put = (key: Kind | 'pylon', p: Placed): void => {
      const mesh = this.meshes.get(key)!;
      const n = counts.get(key) ?? 0;
      if (n >= mesh.instanceMatrix.count) return;
      q.setFromAxisAngle(up, p.yaw);
      matrix.compose(new THREE.Vector3(p.x - this.origin.x, p.y - 0.4, p.z - this.origin.z), q, one);
      mesh.setMatrixAt(n, matrix);
      counts.set(key, n + 1);
    };

    // Point landmarks, one chance per cell.
    const r = Math.ceil(VIEW_M / CELL_M);
    const cx0 = Math.floor(camX / CELL_M);
    const cz0 = Math.floor(camZ / CELL_M);
    for (let i = -r; i <= r; i++) {
      for (let j = -r; j <= r; j++) {
        const cx = cx0 + i;
        const cz = cz0 + j;
        const roll = hashUnit3(this.seed ^ TAG, cx, cz);
        const kind = KINDS.find((k) => roll < CHANCES[k]);
        if (!kind) continue;
        const x = (cx + 0.15 + 0.7 * hashUnit3(this.seed ^ TAG, cx, cz * 7 + 1)) * CELL_M;
        const z = (cz + 0.15 + 0.7 * hashUnit3(this.seed ^ TAG, cx * 7 + 3, cz)) * CELL_M;
        if (Math.hypot(x - camX, z - camZ) > VIEW_M) continue;
        if (this.roadDistance.distAt(x, z, 200) < ROAD_KEEP_M) continue;
        // A church stands on the highest ground near its spot, as churches do.
        let px = x;
        let pz = z;
        let py = this.ground(x, z);
        if (kind === 'church') {
          for (let k = 0; k < 8; k++) {
            const a = (k / 8) * Math.PI * 2;
            const tx = x + Math.cos(a) * 180;
            const tz = z + Math.sin(a) * 180;
            const ty = this.ground(tx, tz);
            if (ty > py && this.roadDistance.distAt(tx, tz, 200) >= ROAD_KEEP_M) {
              px = tx;
              pz = tz;
              py = ty;
            }
          }
        }
        put(kind, { x: px, y: py, z: pz, yaw: hashUnit3(this.seed ^ TAG, cx, cz + 11) * Math.PI * 2 });
      }
    }

    // Power lines: per band, a straight line at its own angle through the band.
    const wire: number[] = [];
    const bands = Math.ceil(VIEW_M / LINE_BAND_M) + 1;
    const b0 = Math.floor(camZ / LINE_BAND_M);
    for (let b = b0 - bands; b <= b0 + bands; b++) {
      if (hashUnit3(this.seed ^ TAG ^ 0x51, b, 0) < 0.65) continue;
      const angle = (hashUnit3(this.seed ^ TAG ^ 0x52, b, 0) - 0.5) * 1.2;
      const dx = Math.cos(angle);
      const dz = Math.sin(angle);
      const ax = hashUnit3(this.seed ^ TAG ^ 0x53, b, 0) * 10_000;
      const az = (b + 0.5) * LINE_BAND_M;
      // Parameter of the camera's foot on the line, snapped to the tower lattice.
      const t0 = Math.round(((camX - ax) * dx + (camZ - az) * dz) / LINE_SPAN_M);
      const reach = Math.ceil(VIEW_M / LINE_SPAN_M);
      let prev: THREE.Vector3[] | null = null;
      for (let k = t0 - reach; k <= t0 + reach; k++) {
        const x = ax + dx * k * LINE_SPAN_M;
        const z = az + dz * k * LINE_SPAN_M;
        if (Math.hypot(x - camX, z - camZ) > VIEW_M) {
          prev = null;
          continue;
        }
        // Where the line crosses the road the tower steps back; the span flies over.
        if (this.roadDistance.distAt(x, z, 200) < LINE_ROAD_KEEP_M + 200 && this.roadDistance.distAt(x, z, 20) < LINE_ROAD_KEEP_M) {
          continue;
        }
        const y = this.ground(x, z);
        // Arms (local X) across the line: X maps to (cos yaw, -sin yaw) = (-dz, dx).
        const yaw = -angle - Math.PI / 2;
        put('pylon', { x, y, z, yaw });
        const cos = Math.cos(yaw);
        const sin = Math.sin(yaw);
        const tops = CONDUCTORS.map(([lx, ly]) => new THREE.Vector3(
          x - this.origin.x + lx * cos,
          y + ly,
          z - this.origin.z - lx * sin,
        ));
        if (prev) {
          for (let c = 0; c < tops.length; c++) {
            const a = prev[c]!;
            const e = tops[c]!;
            const span = a.distanceTo(e);
            const sag = span * 0.035;
            let last = a;
            for (let s = 1; s <= 8; s++) {
              const t = s / 8;
              const p = a.clone().lerp(e, t);
              p.y -= sag * 4 * t * (1 - t);
              wire.push(last.x, last.y, last.z, p.x, p.y, p.z);
              last = p;
            }
          }
        }
        prev = tops;
      }
    }
    this.wires.geometry.dispose();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(wire, 3));
    this.wires.geometry = g;

    for (const [key, mesh] of this.meshes) {
      mesh.count = counts.get(key) ?? 0;
      mesh.instanceMatrix.needsUpdate = true;
    }
  }
}
