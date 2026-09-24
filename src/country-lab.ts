import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { applyComicShading } from './render/comic';

/**
 * COUNTRY LAB: one stretch of Russian countryside, drawn three ways, so the setting's
 * visual style can be chosen by looking rather than by argument.
 *
 * Nothing here is the game world. The land is a local closed-form field (hills, a
 * road on an embankment with ditches both sides, fields, birch-and-spruce woods,
 * a 10 kV line on timber poles with concrete stubs), built once per style on load:
 *
 *   1  real    photo textures (CC0, public/textures/country), physical sky, leaf-card
 *              foliage lit as a volume, grass cards near the camera
 *   2  paint   the same shapes in flat painterly colour, soft blobs for crowns
 *   3  comic   the game's current ground shading (render/comic.ts) plus ink hulls
 *
 * Cheapness is the point being demonstrated as much as the look: the woods beyond
 * ~400 m are not trees but the terrain itself raised into a canopy blanket, and
 * everything that repeats is one instanced draw.
 */

type Style = 'real' | 'paint' | 'comic';
// 'real' was the photo-texture style; it lost the comparison (comic won) and its CC0
// textures were not kept, so it is no longer offered. Its branches remain as a record.
const STYLES: readonly Style[] = ['comic', 'paint'];
const STYLE_LABEL: Record<Style, string> = {
  real: '1 · реализм',
  paint: '2 · мягкая стилизация',
  comic: '3 · комикс (как сейчас)',
};

// ---------------------------------------------------------------------------
// The land
// ---------------------------------------------------------------------------

const ROAD_HALF = 3.4;
const SHOULDER_HALF = 4.6;
/** Instanced trees stand within this radius of the camera; beyond it, the blanket. */
const TREE_RADIUS = 430;
const BLANKET_FROM = 390;
const TERRAIN_HALF = 2600;
const TERRAIN_CELL = 6;

function hash2(x: number, y: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function valueNoise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);
  return (a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy) * 2 - 1;
}

function fbm(x: number, y: number, octaves = 4): number {
  let sum = 0;
  let amp = 0.5;
  let f = 1;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(x * f + i * 17.3, y * f - i * 9.1) * amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return sum;
}

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const roadX = (z: number): number => 26 * Math.sin(z / 330) + 8 * Math.sin(z / 131 + 1.3) - 8 * Math.sin(1.3);
const roadY = (z: number): number => 7 * Math.sin(z / 460 - 0.4) + 2.4 * Math.sin(z / 170 + 0.7);
const hills = (x: number, z: number): number =>
  26 * fbm(x / 900, z / 900, 3) + 7 * fbm(x / 210 + 4, z / 210, 3);

/** Signed lateral offset from the centreline; positive to the left of travel (+x). */
const lateral = (x: number, z: number): number => x - roadX(z);

function groundY(x: number, z: number): number {
  const d = Math.abs(lateral(x, z));
  const base = roadY(z);
  const open = base + (hills(x, z) - hills(roadX(z), z)) * smooth(14, 110, d);
  // The road stands on a low embankment; a ditch runs either side of it.
  const embankment = 0.35 * (1 - smooth(SHOULDER_HALF, SHOULDER_HALF + 1.8, d));
  const ditch = 0.85 * Math.max(0, 1 - Math.abs(d - 8.4) / 2.6) ** 1.4;
  return open + embankment - ditch;
}

/** 0..1: how much this point is woodland. Right of the road is mostly farmland. */
function forestness(x: number, z: number): number {
  const d = lateral(x, z);
  const n = fbm(x / 380 + 11, z / 380 - 3, 4) + 0.12 * fbm(x / 45, z / 45, 2);
  const threshold = d > 0 ? 0.02 : 0.3;
  const near = smooth(Math.abs(d) < 60 && d > 0 ? 14 : 30, Math.abs(d) < 60 && d > 0 ? 22 : 44, Math.abs(d));
  return smooth(threshold, threshold + 0.05, n) * near;
}

/** 0..1: birch versus spruce inside a wood. */
const birchness = (x: number, z: number): number => smooth(-0.15, 0.2, fbm(x / 170 - 7, z / 170 + 2, 3));

type Rgb = [number, number, number];
const FIELDS: readonly Rgb[] = [
  [0.74, 0.62, 0.3], // ripe wheat
  [0.64, 0.58, 0.38], // stubble
  [0.3, 0.42, 0.14], // green crop
  [0.32, 0.24, 0.16], // ploughed
  [0.46, 0.5, 0.22], // fallow meadow
  [0.6, 0.6, 0.3], // hay meadow, cut
];

function fieldColour(x: number, z: number, out: Rgb): boolean {
  if (lateral(x, z) > -26) return false;
  // Fields are rotated rectangles, a few hundred metres on a side.
  const a = 0.35;
  const u = x * Math.cos(a) - z * Math.sin(a);
  const v = x * Math.sin(a) + z * Math.cos(a);
  const iu = Math.floor(u / 260);
  const iv = Math.floor(v / 150);
  const pick = FIELDS[Math.floor(hash2(iu, iv) * FIELDS.length)];
  // Furrow stripes along u, faint.
  const stripe = 0.94 + 0.06 * Math.sin(v * 1.9);
  // Field margins: a grassy strip between plots.
  const mu = Math.min(u / 260 - iu, 1 - (u / 260 - iu)) * 260;
  const mv = Math.min(v / 150 - iv, 1 - (v / 150 - iv)) * 150;
  const margin = 1 - smooth(1.5, 4, Math.min(mu, mv));
  out[0] = (pick[0] * stripe) * (1 - margin) + 0.36 * margin;
  out[1] = (pick[1] * stripe) * (1 - margin) + 0.44 * margin;
  out[2] = (pick[2] * stripe) * (1 - margin) + 0.18 * margin;
  return true;
}

function meadowColour(x: number, z: number, out: Rgb): void {
  const n = fbm(x / 60, z / 60, 3);
  const dry = smooth(-0.3, 0.5, fbm(x / 23 + 5, z / 23, 2));
  out[0] = 0.3 + 0.1 * dry + 0.04 * n;
  out[1] = 0.42 + 0.05 * n + 0.04 * dry;
  out[2] = 0.14 + 0.05 * dry;
}

// ---------------------------------------------------------------------------
// Canvas textures: foliage, needles, birch bark, grass blades
// ---------------------------------------------------------------------------

function canvasTexture(size: number, draw: (g: CanvasRenderingContext2D, rnd: () => number) => void, seed: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d');
  if (!g) throw new Error('2d canvas unavailable');
  draw(g, mulberry(seed));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const leafTexture = (): THREE.CanvasTexture =>
  canvasTexture(256, (g, r) => {
    for (let i = 0; i < 420; i++) {
      const x = 20 + r() * 216;
      const y = 20 + r() * 216;
      const dx = x - 128;
      const dy = y - 128;
      if (dx * dx + dy * dy > 118 * 118) continue;
      const l = 30 + r() * 22;
      g.fillStyle = `hsl(${78 + r() * 22}, ${45 + r() * 20}%, ${l}%)`;
      g.save();
      g.translate(x, y);
      g.rotate(r() * Math.PI * 2);
      g.beginPath();
      g.ellipse(0, 0, 7 + r() * 3, 4 + r() * 2, 0, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
  }, 3);

const branchTexture = (): THREE.CanvasTexture =>
  canvasTexture(256, (g, r) => {
    // A drooping spruce branch seen from above: a spine and needle sprays off it.
    g.strokeStyle = '#2b2116';
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(10, 128);
    g.lineTo(246, 128);
    g.stroke();
    for (let i = 0; i < 900; i++) {
      const t = r();
      const x = 12 + t * 234;
      const spread = 70 * (1 - t * 0.75);
      const y = 128 + (r() * 2 - 1) * spread;
      g.strokeStyle = `hsl(${120 + r() * 25}, ${30 + r() * 15}%, ${12 + r() * 13}%)`;
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(x, 128 + (y - 128) * 0.3);
      g.lineTo(x + 8 + r() * 6, y);
      g.stroke();
    }
  }, 5);

const barkTexture = (): THREE.CanvasTexture => {
  const t = canvasTexture(128, (g, r) => {
    g.fillStyle = '#e6e2d8';
    g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 40; i++) {
      g.fillStyle = r() < 0.7 ? '#1c1a17' : '#6d6a62';
      const y = r() * 128;
      g.fillRect(r() * 128, y, 8 + r() * 30, 1.5 + r() * 3.5);
    }
  }, 7);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
};

const bladeTexture = (): THREE.CanvasTexture =>
  canvasTexture(128, (g, r) => {
    for (let i = 0; i < 60; i++) {
      const x = 10 + r() * 108;
      const h = 60 + r() * 66;
      const lean = (r() * 2 - 1) * 26;
      g.strokeStyle = `hsl(${70 + r() * 30}, ${35 + r() * 25}%, ${24 + r() * 26}%)`;
      g.lineWidth = 2 + r() * 2;
      g.beginPath();
      g.moveTo(x, 128);
      g.quadraticCurveTo(x + lean * 0.3, 128 - h * 0.6, x + lean, 128 - h);
      g.stroke();
    }
  }, 9);

// ---------------------------------------------------------------------------
// Geometry builders
// ---------------------------------------------------------------------------

/**
 * Leaf cards scattered through an ellipsoid crown, their normals pointing OUT of the
 * crown rather than along each card, so the whole crown lights as one soft volume:
 * the single most important trick for cheap card foliage.
 */
function cardCrown(
  count: number,
  centre: THREE.Vector3,
  radius: THREE.Vector3,
  cardSize: number,
  rnd: () => number,
): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const m = new THREE.Matrix4();
  for (let i = 0; i < count; i++) {
    let x = 0;
    let y = 0;
    let z = 0;
    do {
      x = rnd() * 2 - 1;
      y = rnd() * 2 - 1;
      z = rnd() * 2 - 1;
    } while (x * x + y * y + z * z > 1);
    const p = new THREE.Vector3(x * radius.x, y * radius.y, z * radius.z).add(centre);
    const plane = new THREE.PlaneGeometry(cardSize, cardSize);
    e.set(rnd() * Math.PI, rnd() * Math.PI, rnd() * Math.PI);
    q.setFromEuler(e);
    m.compose(p, q, new THREE.Vector3(1, 1, 1));
    plane.applyMatrix4(m);
    const n = plane.getAttribute('normal');
    const pos = plane.getAttribute('position');
    const v = new THREE.Vector3();
    for (let k = 0; k < n.count; k++) {
      v.set(pos.getX(k), pos.getY(k), pos.getZ(k)).sub(centre);
      v.set(v.x / radius.x, v.y / radius.y + 0.35, v.z / radius.z).normalize();
      n.setXYZ(k, v.x, v.y, v.z);
    }
    parts.push(plane);
  }
  return mergeGeometries(parts);
}

function blobCrown(centres: readonly [number, number, number, number][]): THREE.BufferGeometry {
  return mergeGeometries(
    centres.map(([x, y, z, r]) => {
      const g = new THREE.IcosahedronGeometry(r, 1);
      const p = g.getAttribute('position');
      for (let i = 0; i < p.count; i++) {
        const s = 1 + 0.12 * Math.sin(p.getX(i) * 3.1 + p.getY(i) * 2.3);
        p.setXYZ(i, p.getX(i) * s, p.getY(i) * s, p.getZ(i) * s);
      }
      g.computeVertexNormals();
      return g.translate(x, y, z);
    }),
  );
}

function trunk(height: number, r0: number, r1: number, barkRepeat: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r1, r0, height, 7, 1, true).translate(0, height / 2, 0);
  const uv = g.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * barkRepeat);
  return g;
}

interface Species {
  readonly parts: { geometry: THREE.BufferGeometry; material: THREE.Material; outline: boolean }[];
}

function birch(style: Style): Species {
  const rnd = mulberry(21);
  const bark = barkTexture();
  const trunkMat =
    style === 'real'
      ? new THREE.MeshStandardMaterial({ map: bark, roughness: 0.85 })
      : new THREE.MeshStandardMaterial({ color: style === 'paint' ? 0xe8e2d2 : 0xf0ebe0, roughness: 1 });
  const parts: Species['parts'] = [{ geometry: trunk(15, 0.2, 0.07, 8), material: trunkMat, outline: true }];
  if (style === 'real') {
    parts.push({
      geometry: cardCrown(150, new THREE.Vector3(0, 11, 0), new THREE.Vector3(3, 4.8, 3), 1.6, rnd),
      material: new THREE.MeshStandardMaterial({
        map: leafTexture(),
        alphaTest: 0.45,
        side: THREE.DoubleSide,
        roughness: 0.8,
        color: 0xc8d8a0,
      }),
      outline: false,
    });
  } else {
    parts.push({
      geometry: blobCrown([
        [0, 9.8, 0, 2.6],
        [1.3, 12, 0.5, 2.1],
        [-1.1, 12.8, -0.4, 1.9],
        [0.2, 14.4, 0.2, 1.5],
        [-0.8, 10.6, 1.2, 1.8],
      ]),
      material:
        style === 'paint'
          ? new THREE.MeshStandardMaterial({ color: 0x7f9a3e, roughness: 1 })
          : new THREE.MeshToonMaterial({ color: 0x8aa344 }),
      outline: true,
    });
  }
  return { parts };
}

function spruce(style: Style): Species {
  const rnd = mulberry(33);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x3d2f22, roughness: 1 });
  const parts: Species['parts'] = [{ geometry: trunk(18, 0.28, 0.05, 1), material: trunkMat, outline: false }];
  const H = 19;
  if (style === 'real') {
    // A dark inner cone to fill the gaps, then drooping branch cards in tiers.
    parts.push({
      geometry: new THREE.ConeGeometry(2.4, H - 2, 9, 1, true).translate(0, 2 + (H - 2) / 2, 0),
      material: new THREE.MeshStandardMaterial({ color: 0x14200f, roughness: 1 }),
      outline: false,
    });
    const cards: THREE.BufferGeometry[] = [];
    const tiers = 16;
    for (let t = 0; t < tiers; t++) {
      const y = 2.2 + (t / tiers) * (H - 2.6);
      const len = 3.3 * (1 - t / tiers) + 0.5;
      const around = Math.max(5, Math.round(10 * (1 - t / tiers)) + 4);
      for (let k = 0; k < around; k++) {
        const a = (k / around) * Math.PI * 2 + rnd() * 0.5 + t * 0.7;
        const plane = new THREE.PlaneGeometry(len, len * 0.62).translate(len / 2, 0, 0);
        plane.rotateX(-Math.PI / 2);
        plane.rotateZ(-0.35 - rnd() * 0.2); // droop
        plane.rotateY(a);
        plane.translate(0, y, 0);
        const n = plane.getAttribute('normal');
        for (let i = 0; i < n.count; i++) n.setXYZ(i, Math.cos(a) * 0.6, 0.75, -Math.sin(a) * 0.6);
        cards.push(plane);
      }
    }
    parts.push({
      geometry: mergeGeometries(cards),
      material: new THREE.MeshStandardMaterial({
        map: branchTexture(),
        alphaTest: 0.4,
        side: THREE.DoubleSide,
        roughness: 0.9,
      }),
      outline: false,
    });
  } else {
    const cones: THREE.BufferGeometry[] = [];
    for (let t = 0; t < 5; t++) {
      const r = 3.1 - t * 0.55;
      const h = 5.2 - t * 0.5;
      cones.push(new THREE.ConeGeometry(r, h, 10).translate(0, 3 + t * 3.1 + h / 2, 0));
    }
    parts.push({
      geometry: mergeGeometries(cones),
      material:
        style === 'paint'
          ? new THREE.MeshStandardMaterial({ color: 0x2f4a2a, roughness: 1 })
          : new THREE.MeshToonMaterial({ color: 0x35532e }),
      outline: true,
    });
  }
  return { parts };
}

function bush(style: Style): Species {
  const rnd = mulberry(44);
  if (style === 'real') {
    return {
      parts: [
        {
          geometry: cardCrown(55, new THREE.Vector3(0, 1.3, 0), new THREE.Vector3(1.9, 1.3, 1.9), 1.1, rnd),
          material: new THREE.MeshStandardMaterial({
            map: leafTexture(),
            alphaTest: 0.45,
            side: THREE.DoubleSide,
            color: 0xa9bf85,
            roughness: 0.85,
          }),
          outline: false,
        },
      ],
    };
  }
  return {
    parts: [
      {
        geometry: blobCrown([
          [0, 1.1, 0, 1.3],
          [1.1, 0.9, 0.4, 1],
          [-0.9, 1, -0.3, 1.1],
        ]),
        material:
          style === 'paint'
            ? new THREE.MeshStandardMaterial({ color: 0x5f7a30, roughness: 1 })
            : new THREE.MeshToonMaterial({ color: 0x6b8a36 }),
        outline: true,
      },
    ],
  };
}

/** Inverted-hull ink: the back faces, pushed out along the normal, drawn black. */
function inkMaterial(width: number): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({ color: 0x15110c, side: THREE.BackSide });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `vec3 transformed = position + normalize(normal) * ${width.toFixed(3)};`,
    );
  };
  return m;
}

function instance(
  scene: THREE.Scene,
  species: Species,
  matrices: THREE.Matrix4[],
  colours: THREE.Color[] | null,
  style: Style,
): void {
  if (matrices.length === 0) return;
  for (const part of species.parts) {
    const mesh = new THREE.InstancedMesh(part.geometry, part.material, matrices.length);
    matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
    if (colours) colours.forEach((c, i) => mesh.setColorAt(i, c));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    if (style === 'comic' && part.outline) {
      const ink = new THREE.InstancedMesh(part.geometry, inkMaterial(0.09), matrices.length);
      matrices.forEach((m, i) => ink.setMatrixAt(i, m));
      scene.add(ink);
    }
  }
}

// ---------------------------------------------------------------------------
// Ground, road, line
// ---------------------------------------------------------------------------

async function loadTexture(path: string, repeat: boolean, srgb: boolean): Promise<THREE.Texture> {
  const t = await new THREE.TextureLoader().loadAsync(path);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Mean colour of a texture in linear space, so a vertex tint can be normalised by it. */
function meanColour(t: THREE.Texture): THREE.Vector3 {
  const img = t.image as HTMLImageElement;
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const g = c.getContext('2d');
  if (!g) return new THREE.Vector3(0.4, 0.4, 0.4);
  g.drawImage(img, 0, 0, 16, 16);
  const d = g.getImageData(0, 0, 16, 16).data;
  const s = new THREE.Vector3();
  const col = new THREE.Color();
  for (let i = 0; i < d.length; i += 4) {
    col.setRGB(d[i] / 255, d[i + 1] / 255, d[i + 2] / 255, THREE.SRGBColorSpace);
    s.x += col.r;
    s.y += col.g;
    s.z += col.b;
  }
  return s.multiplyScalar(1 / 256);
}

/**
 * Photo texture as DETAIL over a painted tint: the vertex colour carries the land
 * (field, meadow, forest floor), the photo is divided by its own mean so it only adds
 * grain, and it is sampled at two scales so neither one's repeat is readable.
 */
function detailMaterial(map: THREE.Texture, normal: THREE.Texture | null, mean: THREE.Vector3): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ map, normalMap: normal ?? undefined, vertexColors: true, roughness: 0.95 });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uMeanInv = { value: new THREE.Vector3(1 / mean.x, 1 / mean.y, 1 / mean.z) };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uMeanInv;')
      .replace(
        '#include <map_fragment>',
        `vec3 tA = texture2D( map, vMapUv ).rgb;
         vec3 tB = texture2D( map, vMapUv * 0.231 + 0.37 ).rgb;
         diffuseColor.rgb *= mix( tA, tB, 0.45 ) * uMeanInv;`,
      );
  };
  return m;
}

function buildTerrain(camera: THREE.Vector3, blanket: boolean): THREE.BufferGeometry {
  const n = Math.round((TERRAIN_HALF * 2) / TERRAIN_CELL);
  const g = new THREE.PlaneGeometry(TERRAIN_HALF * 2, TERRAIN_HALF * 2, n, n).rotateX(-Math.PI / 2);
  g.translate(camera.x, 0, camera.z + TERRAIN_HALF * 0.55);
  const p = g.getAttribute('position');
  const uv = g.getAttribute('uv');
  const colours = new Float32Array(p.count * 3);
  const c: Rgb = [0, 0, 0];
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const z = p.getZ(i);
    let y = groundY(x, z);
    const f = forestness(x, z);
    if (!fieldColour(x, z, c)) meadowColour(x, z, c);
    const dist = Math.hypot(x - camera.x, z - camera.z);
    const b = birchness(x, z);
    if (f > 0) {
      // Forest floor under the instanced trees; canopy colour where the blanket rises.
      const floor: Rgb = [0.2, 0.22, 0.1];
      const far = blanket ? smooth(BLANKET_FROM, BLANKET_FROM + 30, dist) : 0;
      const canopy: Rgb = [0.13 + 0.14 * b, 0.2 + 0.12 * b, 0.08 + 0.03 * b];
      const lum = 0.85 + 0.3 * valueNoise(x / 9, z / 9);
      for (let k = 0; k < 3; k++) {
        const target = floor[k] * (1 - far) + canopy[k] * lum * far;
        c[k] = c[k] * (1 - f) + target * f;
      }
      y += far * f * (15 + 3 * b + 3.5 * valueNoise(x / 11, z / 11) + 2 * valueNoise(x / 4, z / 4));
    }
    p.setY(i, y);
    uv.setXY(i, x / 3.2, z / 3.2);
    colours.set(c, i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  g.computeVertexNormals();
  return g;
}

/** A strip following the road: z from z0 to z1, lateral samples given in metres. */
function roadStrip(z0: number, z1: number, dz: number, laterals: readonly number[], lift: (l: number) => number): THREE.BufferGeometry {
  const rows = Math.ceil((z1 - z0) / dz) + 1;
  const cols = laterals.length;
  const pos = new Float32Array(rows * cols * 3);
  const uv = new Float32Array(rows * cols * 2);
  const idx: number[] = [];
  let run = 0;
  for (let r = 0; r < rows; r++) {
    const z = z0 + r * dz;
    const tx = (roadX(z + 0.5) - roadX(z - 0.5));
    const len = Math.hypot(tx, 1);
    const nx = 1 / len;
    const nz = -tx / len;
    if (r > 0) run += Math.hypot(roadX(z) - roadX(z - dz), dz);
    for (let k = 0; k < cols; k++) {
      const l = laterals[k];
      const x = roadX(z) + nx * l;
      const zz = z + nz * l;
      const i = r * cols + k;
      pos[i * 3] = x;
      pos[i * 3 + 1] = roadY(z) + lift(l);
      pos[i * 3 + 2] = zz;
      uv[i * 2] = (l - laterals[0]) / 3.4;
      uv[i * 2 + 1] = run / 3.4;
    }
  }
  for (let r = 0; r < rows - 1; r++) {
    for (let k = 0; k < cols - 1; k++) {
      const a = r * cols + k;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Near corridor at 1 m across so the ditches read, on top of the coarse terrain. */
function corridor(z0: number, z1: number): THREE.BufferGeometry {
  const laterals: number[] = [];
  for (let l = -30; l <= 30; l += 0.8) laterals.push(l);
  const g = roadStrip(z0, z1, 2, laterals, () => 0);
  const p = g.getAttribute('position');
  const colours = new Float32Array(p.count * 3);
  const c: Rgb = [0, 0, 0];
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const z = p.getZ(i);
    p.setY(i, groundY(x, z) + 0.03);
    meadowColour(x, z, c);
    const d = Math.abs(lateral(x, z));
    // Wetter, lusher ditch bottoms; the shoulder's edge is bare, trodden earth.
    const wet = Math.max(0, 1 - Math.abs(d - 8.4) / 1.6);
    c[0] -= 0.07 * wet;
    c[1] += 0.02 * wet;
    const bare = 1 - smooth(SHOULDER_HALF + 0.2, SHOULDER_HALF + 1.4, d);
    c[0] = c[0] * (1 - bare) + 0.36 * bare;
    c[1] = c[1] * (1 - bare) + 0.32 * bare;
    c[2] = c[2] * (1 - bare) + 0.22 * bare;
    colours.set(c, i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  const uv = g.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, p.getX(i) / 3.2, p.getZ(i) / 3.2);
  g.computeVertexNormals();
  return g;
}

/** One span of sagging wire as a polyline between two insulator points. */
function catenary(a: THREE.Vector3, b: THREE.Vector3, sag: number, out: number[]): void {
  const steps = 12;
  let prev = a.clone();
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const p = a.clone().lerp(b, t);
    p.y -= sag * 4 * t * (1 - t);
    out.push(prev.x, prev.y, prev.z, p.x, p.y, p.z);
    prev = p;
  }
}

function buildPowerLine(scene: THREE.Scene, style: Style, z0: number, z1: number): void {
  const wood = new THREE.MeshStandardMaterial({ color: style === 'real' ? 0x55483a : 0x5c4a36, roughness: 1 });
  const concrete = new THREE.MeshStandardMaterial({ color: 0x9a978f, roughness: 0.95 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x7fa39a, roughness: 0.25, metalness: 0.1 });
  const pole = mergeGeometries([new THREE.CylinderGeometry(0.11, 0.15, 9.5, 8).translate(0.22, 4.75 + 0.9, 0)]);
  const stub = new THREE.BoxGeometry(0.2, 3.2, 0.24).translate(0, 1.2, 0);
  const cross = new THREE.BoxGeometry(0.1, 0.1, 1.9).translate(0.22, 9.9, 0);
  const ins = mergeGeometries([
    new THREE.CylinderGeometry(0.07, 0.09, 0.2, 8).translate(0.22, 10.05, -0.8),
    new THREE.CylinderGeometry(0.07, 0.09, 0.2, 8).translate(0.22, 10.05, 0.8),
    new THREE.CylinderGeometry(0.07, 0.09, 0.2, 8).translate(0.22, 10.35, 0),
  ]);
  const spacing = 55;
  const mats: THREE.Matrix4[] = [];
  const wires: number[] = [];
  let prevTops: THREE.Vector3[] | null = null;
  const rnd = mulberry(77);
  for (let z = z0; z < z1; z += spacing) {
    const l = -12.5;
    const x = roadX(z) + l;
    const y = groundY(x, z);
    const tilt = (rnd() - 0.5) * 0.06;
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y - 0.4, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt, Math.atan2(roadX(z + 1) - roadX(z - 1), 2), tilt * 0.5)),
      new THREE.Vector3(1, 1, 1),
    );
    mats.push(m);
    const tops = [
      new THREE.Vector3(0.22, 10.15, -0.8),
      new THREE.Vector3(0.22, 10.15, 0.8),
      new THREE.Vector3(0.22, 10.45, 0),
    ].map((v) => v.applyMatrix4(m));
    // The cross-arm runs across the road so its three wires run along it.
    if (prevTops) prevTops.forEach((p, i) => catenary(p, tops[i], 0.9, wires));
    prevTops = tops;
  }
  // Cross-arms face across the line: rotate the geometries a quarter turn.
  cross.rotateY(Math.PI / 2);
  ins.rotateY(Math.PI / 2);
  const species: Species = {
    parts: [
      { geometry: pole, material: wood, outline: true },
      { geometry: stub, material: concrete, outline: true },
      { geometry: cross, material: wood, outline: true },
      { geometry: ins, material: glass, outline: false },
    ],
  };
  instance(scene, species, mats, null, style);
  const wg = new THREE.BufferGeometry();
  wg.setAttribute('position', new THREE.Float32BufferAttribute(wires, 3));
  scene.add(new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: 0x2a2a2a })));
}

/** Striped white roadside posts on the outside of the bends (signal posts, GOST). */
function buildSignalPosts(scene: THREE.Scene, style: Style, z0: number, z1: number): void {
  const post = new THREE.BoxGeometry(0.12, 1.1, 0.12).translate(0, 0.55, 0);
  const band = new THREE.BoxGeometry(0.125, 0.25, 0.125).translate(0, 0.85, 0);
  const mats: THREE.Matrix4[] = [];
  for (let z = z0; z < z1; z += 22) {
    const curvature = roadX(z + 20) - 2 * roadX(z) + roadX(z - 20);
    if (Math.abs(curvature) < 0.35) continue;
    for (const side of [-1, 1]) {
      const x = roadX(z) + side * (SHOULDER_HALF + 0.3);
      mats.push(new THREE.Matrix4().makeTranslation(x, groundY(x, z) - 0.05, z));
    }
  }
  instance(
    scene,
    {
      parts: [
        { geometry: post, material: new THREE.MeshStandardMaterial({ color: 0xe8e8e2, roughness: 0.6 }), outline: true },
        { geometry: band, material: new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.6 }), outline: false },
      ],
    },
    mats,
    null,
    style,
  );
}

// ---------------------------------------------------------------------------
// Scatter
// ---------------------------------------------------------------------------

function scatterTrees(scene: THREE.Scene, style: Style, camera: THREE.Vector3): number {
  const birches: THREE.Matrix4[] = [];
  const spruces: THREE.Matrix4[] = [];
  const bushes: THREE.Matrix4[] = [];
  const birchTint: THREE.Color[] = [];
  const spruceTint: THREE.Color[] = [];
  const bushTint: THREE.Color[] = [];
  const cell = 5.2;
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  for (let gx = -TREE_RADIUS; gx < TREE_RADIUS; gx += cell) {
    for (let gz = -TREE_RADIUS * 0.4; gz < TREE_RADIUS * 1.2; gz += cell) {
      const ix = Math.round(gx / cell);
      const iz = Math.round(gz / cell);
      const x = camera.x + gx + (hash2(ix, iz) - 0.5) * cell;
      const z = camera.z + gz + (hash2(iz, ix + 91) - 0.5) * cell;
      if (Math.hypot(x - camera.x, z - camera.z) > TREE_RADIUS) continue;
      const d = Math.abs(lateral(x, z));
      if (d < 11) continue;
      const f = forestness(x, z);
      const r = hash2(ix + 7, iz - 3);
      const s = 0.65 + hash2(ix - 5, iz + 11) * 0.6;
      q.setFromAxisAngle(up, hash2(ix, iz + 5) * Math.PI * 2);
      const lean = new THREE.Quaternion().setFromEuler(new THREE.Euler((r - 0.5) * 0.06, 0, (hash2(iz, ix) - 0.5) * 0.06));
      const m = new THREE.Matrix4().compose(new THREE.Vector3(x, groundY(x, z) - 0.2, z), lean.multiply(q), new THREE.Vector3(s, s * (0.9 + r * 0.25), s));
      const tint = new THREE.Color().setHSL(0, 0, 0.82 + hash2(ix + 3, iz + 3) * 0.3);
      if (f > 0.5 && r < 0.88) {
        if (hash2(ix + 1, iz + 2) < birchness(x, z) * 0.85 + 0.08) {
          birches.push(m);
          birchTint.push(tint);
        } else {
          spruces.push(m);
          spruceTint.push(tint);
        }
      } else if ((f > 0.05 && r < 0.6) || (d > 9.5 && d < 16 && r < 0.1) || r < 0.012) {
        // Undergrowth at wood edges, willow scrub in the ditches, the odd lone bush.
        const b = new THREE.Matrix4().compose(
          new THREE.Vector3(x, groundY(x, z) - 0.1, z),
          q,
          new THREE.Vector3(s * 1.1, s * (0.8 + r), s * 1.1),
        );
        bushes.push(b);
        bushTint.push(tint);
      } else if (r > 0.9985 && d > 20) {
        birches.push(m); // a lone birch in the open
        birchTint.push(tint);
      }
    }
  }
  instance(scene, birch(style), birches, birchTint, style);
  instance(scene, spruce(style), spruces, spruceTint, style);
  instance(scene, bush(style), bushes, bushTint, style);
  return birches.length + spruces.length + bushes.length;
}

function scatterGrass(scene: THREE.Scene, style: Style, camera: THREE.Vector3): number {
  if (style === 'comic') return 0;
  const plane = new THREE.PlaneGeometry(0.9, 0.55).translate(0, 0.25, 0);
  const tuft = mergeGeometries([plane.clone(), plane.clone().rotateY(Math.PI / 3), plane.clone().rotateY((2 * Math.PI) / 3)]);
  const n = tuft.getAttribute('normal');
  for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0); // lit like the ground it stands on
  const mat =
    style === 'real'
      ? new THREE.MeshStandardMaterial({ map: bladeTexture(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 1 })
      : new THREE.MeshStandardMaterial({ map: bladeTexture(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 1, color: 0x9ab860 });
  const mats: THREE.Matrix4[] = [];
  const cols: THREE.Color[] = [];
  const rnd = mulberry(123);
  const R = 70;
  for (let i = 0; i < 60000 && mats.length < 26000; i++) {
    const x = camera.x + (rnd() * 2 - 1) * R;
    const z = camera.z + (rnd() * 1.6 - 0.35) * R;
    const d = Math.abs(lateral(x, z));
    if (d < SHOULDER_HALF + 0.9 || forestness(x, z) > 0.5) continue;
    if (Math.hypot(x - camera.x, z - camera.z) > R) continue;
    const s = 0.6 + rnd() * 0.9 * (d > 7 && d < 10 ? 1.5 : 1);
    mats.push(
      new THREE.Matrix4().compose(
        new THREE.Vector3(x, groundY(x, z), z),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 6.3),
        new THREE.Vector3(s, s * (0.7 + rnd() * 0.8), s),
      ),
    );
    cols.push(new THREE.Color().setHSL(0.2 + rnd() * 0.05, 0.3, 0.55 + rnd() * 0.3));
  }
  const mesh = new THREE.InstancedMesh(tuft, mat, mats.length);
  mats.forEach((m, i) => mesh.setMatrixAt(i, m));
  cols.forEach((c, i) => mesh.setColorAt(i, c));
  mesh.receiveShadow = true;
  scene.add(mesh);
  return mats.length;
}

// ---------------------------------------------------------------------------
// Sky and light
// ---------------------------------------------------------------------------

function gradientSky(horizon: THREE.Color, zenith: THREE.Color, sunDir: THREE.Vector3): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { uH: { value: horizon }, uZ: { value: zenith }, uSun: { value: sunDir } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); gl_Position.z = gl_Position.w; }`,
    fragmentShader: `uniform vec3 uH; uniform vec3 uZ; uniform vec3 uSun; varying vec3 vDir;
      void main(){ float t = pow(clamp(vDir.y,0.,1.), 0.45);
        vec3 c = mix(uH, uZ, t);
        float s = max(dot(normalize(vDir), normalize(uSun)), 0.);
        c += vec3(1.,.85,.6) * (pow(s, 12.) * .25 + pow(s, 900.) * 2.);
        gl_FragColor = vec4(c, 1.);
        #include <colorspace_fragment>
      }`,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(8000, 32, 16), mat);
  m.frustumCulled = false;
  return m;
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

export async function bootCountryLab(): Promise<void> {
  const query = new URLSearchParams(window.location.search);
  const style = (STYLES.find((s) => s === query.get('style')) ?? 'comic') as Style;
  const view = query.get('view') ?? 'road';
  document.title = `Country lab · ${style}`;
  document.getElementById('launch-loading')?.remove();
  const canvas = document.getElementById('game');
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error('index.html is missing #game');

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = style === 'real' ? THREE.ACESFilmicToneMapping : THREE.NeutralToneMapping;
  renderer.toneMappingExposure = style === 'real' ? 0.62 : 1.0;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.3, 9000);

  // Viewpoints: from the right lane at driver height, or from the field back across.
  const camZ = 0;
  const eye =
    view === 'field'
      ? new THREE.Vector3(roadX(260) - 70, 0, 260)
      : new THREE.Vector3(roadX(camZ) - 1.8, 0, camZ);
  eye.y = groundY(eye.x, eye.z) + (view === 'field' ? 1.7 : 1.35);
  camera.position.copy(eye);
  if (view === 'field') camera.lookAt(roadX(200) + 40, eye.y + 4, 150);
  else camera.lookAt(roadX(camZ + 120) - 1.8, roadY(camZ + 120) + 1.6, camZ + 120);

  // Late afternoon, sun ahead and to the left: long shadows across the road.
  const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - 24), THREE.MathUtils.degToRad(35));
  const sun = new THREE.DirectionalLight(0xfff0d8, style === 'real' ? 3.2 : 2.2);
  sun.position.copy(eye).addScaledVector(sunDir, 300);
  sun.target.position.copy(eye).add(new THREE.Vector3(0, 0, 70));
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  const sc = sun.shadow.camera;
  sc.left = -160;
  sc.right = 160;
  sc.top = 160;
  sc.bottom = -160;
  sc.near = 10;
  sc.far = 700;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.6;
  scene.add(sun, sun.target);

  let horizon = new THREE.Color(0xb9c9d6);
  if (style === 'real') {
    const sky = new Sky();
    sky.scale.setScalar(8000);
    const u = sky.material.uniforms;
    u.turbidity.value = 4;
    u.rayleigh.value = 1.4;
    u.mieCoefficient.value = 0.004;
    u.mieDirectionalG.value = 0.8;
    u.sunPosition.value.copy(sunDir);
    scene.add(sky);
    // Image-based ambient from the same sky, so shade is blue and lit is warm.
    const pmrem = new THREE.PMREMGenerator(renderer);
    const skyScene = new THREE.Scene();
    const sky2 = new Sky();
    sky2.scale.setScalar(1000);
    Object.assign(sky2.material.uniforms, THREE.UniformsUtils.clone(u));
    sky2.material.uniforms.sunPosition.value.copy(sunDir);
    skyScene.add(sky2);
    scene.environment = pmrem.fromScene(skyScene).texture;
    scene.environmentIntensity = 0.55;
    horizon = new THREE.Color(0.62, 0.7, 0.8);
  } else {
    horizon = style === 'paint' ? new THREE.Color(0xd6dccd) : new THREE.Color(0xe2dcc6);
    const zenith = style === 'paint' ? new THREE.Color(0x6f9bc4) : new THREE.Color(0x7aa6cc);
    scene.add(gradientSky(horizon, zenith, sunDir));
    scene.add(new THREE.HemisphereLight(0xcfe0f0, 0x4a5230, style === 'paint' ? 1.1 : 1.3));
  }
  scene.fog = new THREE.FogExp2(horizon, style === 'real' ? 0.00055 : 0.0007);

  // Ground.
  let groundMat: THREE.Material;
  let roadMat: THREE.Material;
  let shoulderMat: THREE.Material;
  if (style === 'real') {
    const [grass, grassN, asphalt, asphaltN, gravel, gravelN] = await Promise.all([
      loadTexture('/textures/country/leafy_grass_diff_1k.jpg', true, true),
      loadTexture('/textures/country/leafy_grass_nor_gl_1k.jpg', true, false),
      loadTexture('/textures/country/asphalt_02_diff_1k.jpg', true, true),
      loadTexture('/textures/country/asphalt_02_nor_gl_1k.jpg', true, false),
      loadTexture('/textures/country/gravel_road_diff_1k.jpg', true, true),
      loadTexture('/textures/country/gravel_road_nor_gl_1k.jpg', true, false),
    ]);
    groundMat = detailMaterial(grass, grassN, meanColour(grass));
    roadMat = new THREE.MeshStandardMaterial({ map: asphalt, normalMap: asphaltN, roughness: 0.92 });
    shoulderMat = new THREE.MeshStandardMaterial({ map: gravel, normalMap: gravelN, roughness: 1, color: 0xb0a898 });
  } else if (style === 'paint') {
    groundMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 });
    roadMat = new THREE.MeshStandardMaterial({ color: 0x5d5b58, roughness: 0.95 });
    shoulderMat = new THREE.MeshStandardMaterial({ color: 0x8a7d66, roughness: 1 });
  } else {
    groundMat = applyComicShading(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }), {
      contourSpacing: 4,
      stippleCell: 0.6,
    });
    roadMat = applyComicShading(new THREE.MeshStandardMaterial({ color: 0x5f5d5a, roughness: 1 }), {
      contourStrength: 0,
    });
    shoulderMat = applyComicShading(new THREE.MeshStandardMaterial({ color: 0x8f8068, roughness: 1 }), {
      contourStrength: 0,
    });
  }

  const terrain = new THREE.Mesh(buildTerrain(eye, true), groundMat);
  terrain.receiveShadow = true;
  scene.add(terrain);
  const zFrom = camZ - 300;
  const zTo = camZ + 2400;
  const near = new THREE.Mesh(corridor(zFrom, camZ + 700), groundMat);
  near.receiveShadow = true;
  scene.add(near);
  // Crowned carriageway; gravel shoulders either side.
  const crown = (l: number): number => 0.42 - 0.02 * Math.abs(l);
  const road = new THREE.Mesh(roadStrip(zFrom, zTo, 2, [-ROAD_HALF, -1.7, 0, 1.7, ROAD_HALF], crown), roadMat);
  road.receiveShadow = true;
  scene.add(road);
  const shoulderLift = (l: number): number => {
    const d = Math.abs(l);
    return d <= ROAD_HALF ? crown(l) - 0.01 : 0.36 - 0.12 * (d - ROAD_HALF);
  };
  for (const side of [-1, 1]) {
    const lat = side < 0 ? [-SHOULDER_HALF - 0.4, -SHOULDER_HALF, -ROAD_HALF] : [ROAD_HALF, SHOULDER_HALF, SHOULDER_HALF + 0.4];
    const sh = new THREE.Mesh(roadStrip(zFrom, zTo, 2, lat, shoulderLift), shoulderMat);
    sh.receiveShadow = true;
    scene.add(sh);
  }
  // A worn centre dash: 3 m on, 9 m off, as a rural road carries it.
  {
    const dashes: THREE.BufferGeometry[] = [];
    for (let z = zFrom; z < zTo; z += 12) {
      const g = roadStrip(z, z + 3, 1, [-0.06, 0.06], (l) => crown(l) + 0.012);
      dashes.push(g);
    }
    const lineMat = new THREE.MeshStandardMaterial({ color: 0xd8d4c8, roughness: 0.8, transparent: true, opacity: 0.7 });
    scene.add(new THREE.Mesh(mergeGeometries(dashes), lineMat));
  }

  buildPowerLine(scene, style, zFrom, camZ + 1800);
  buildSignalPosts(scene, style, zFrom, camZ + 900);
  const trees = scatterTrees(scene, style, eye);
  const tufts = scatterGrass(scene, style, eye);

  // Overlay.
  const hud = document.createElement('div');
  hud.style.cssText =
    'position:fixed;left:12px;top:12px;padding:8px 12px;background:rgba(20,18,14,.72);color:#eee;font:13px/1.5 system-ui;border-radius:6px;z-index:10';
  hud.innerHTML = `<b>${STYLE_LABEL[style]}</b> · вид: ${view}<br>
    1/2 — стиль · V — вид · деревьев ${trees}, пучков травы ${tufts}<br><span id="cl-stats"></span>`;
  document.body.append(hud);
  window.addEventListener('keydown', (e) => {
    const next = new URLSearchParams(window.location.search);
    if (e.key >= '1' && e.key <= '2') next.set('style', STYLES[Number(e.key) - 1]);
    else if (e.key === 'v' || e.key === 'V') next.set('view', view === 'road' ? 'field' : 'road');
    else return;
    window.location.search = next.toString();
  });
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // Mouse look, gently, so the scene can be inspected without driving.
  const base = camera.quaternion.clone();
  let yaw = 0;
  let pitch = 0;
  canvas.addEventListener('pointermove', (e) => {
    if (e.buttons !== 1) return;
    yaw -= e.movementX * 0.003;
    pitch = Math.max(-0.6, Math.min(0.6, pitch - e.movementY * 0.003));
    camera.quaternion.copy(base).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ')));
  });

  const stats = document.getElementById('cl-stats');
  let frames = 0;
  let t0 = performance.now();
  renderer.setAnimationLoop(() => {
    renderer.render(scene, camera);
    frames++;
    const now = performance.now();
    if (now - t0 > 1000 && stats) {
      stats.textContent = `${Math.round((frames * 1000) / (now - t0))} fps · draw calls ${renderer.info.render.calls} · треугольников ${(renderer.info.render.triangles / 1e6).toFixed(2)} M`;
      frames = 0;
      t0 = now;
    }
    (window as unknown as { __countryReady?: boolean }).__countryReady = true;
  });
}
