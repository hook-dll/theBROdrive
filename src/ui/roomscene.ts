import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { buildKitCar } from '../carkit/kit';
import { CAR_SURFACE_ATTRIBUTE } from '../render/materials';
import { factoryPaintHex } from '../vehicle/carpaint';
import { DREAM_CAR_ID, DREAMS, type DreamDef } from '../dreams/dream';
import type { DreamProgress } from '../dreams/progress';

/**
 * THE BOY'S ROOM, IN 3D: the title screen's set (ui/titleroom.ts points the camera).
 *
 * A small room at night, every thing in it a thing the menu is about, built from
 * primitives and painted canvases so it costs no download: the bed under a Soviet wall
 * carpet, a play-mat road on the floor with the next dream's car on it, the desk with
 * the dreams' map under a lamp, a shelf of die-cast toys — one for every dream dreamt,
 * each the car that dream lends, in its colour — the keys on their hook by the door,
 * the window onto the moonlit desert road, a toolbox, a ticking clock.
 *
 * Lit by the moon through the window, whose frame throws its shadow across the floor and
 * the bed, and by the desk lamp; dust drifts in the moonbeam.
 *
 * Metres, +y up; the back wall (the window's) is at z = -ROOM_D/2, the bed along the
 * left wall, the desk and the door on the right.
 */

export const ROOM_W = 4.2;
export const ROOM_D = 3.6;
export const ROOM_H = 2.7;
const X0 = -ROOM_W / 2;
const X1 = ROOM_W / 2;
const Z0 = -ROOM_D / 2;
const Z1 = ROOM_D / 2;

/** The window in the back wall: left, right, sill, top. */
const WIN = { x0: -0.85, x1: 0.45, y0: 0.88, y1: 2.12 };

/** The desk lamp's bulb, candela. */
const DESK_LAMP_CD = 14;

/** A soft round speck for the dust. */
function dustSprite(): THREE.CanvasTexture {
  return canvas(32, 32, (g) => {
    const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 32, 32);
  });
}
/** What each menu thing focuses on, for the camera (titleroom.ts). */
export interface RoomAnchors {
  /** The next dream's toy car on the play mat. */
  readonly toy: THREE.Vector3;
  readonly map: THREE.Vector3;
  readonly shelf: THREE.Vector3;
  readonly keys: THREE.Vector3;
  readonly window: THREE.Vector3;
  readonly toolbox: THREE.Vector3;
}

export interface RoomScene {
  readonly scene: THREE.Scene;
  readonly anchors: RoomAnchors;
  /** Animate the clock, the lamp, the dust and the curtains; `t` seconds. */
  tick(t: number, dt: number): void;
  /**
   * Build the next die-cast toy, if any is left: one kit car per call, so the work is
   * spread over idle moments. False when every toy is on its place.
   */
  buildNextToy(): boolean;
  dispose(): void;
}

/* ------------------------------------------------------------------ *
 *  Canvas paint                                                      *
 * ------------------------------------------------------------------ */

function canvas(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Deterministic noise for the painted textures. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Soviet wallpaper: faded stripes and a small repeating flower. */
function wallpaper(): THREE.CanvasTexture {
  const tex = canvas(512, 512, (g) => {
    g.fillStyle = '#8c8270';
    g.fillRect(0, 0, 512, 512);
    for (let x = 0; x < 512; x += 64) {
      g.fillStyle = 'rgba(120,108,88,0.55)';
      g.fillRect(x + 26, 0, 12, 512);
      g.fillStyle = 'rgba(160,150,128,0.35)';
      g.fillRect(x + 4, 0, 3, 512);
    }
    for (let y = 0; y < 512; y += 64) {
      for (let x = 0; x < 512; x += 64) {
        const cx = x + 32 + ((y / 64) % 2) * 0;
        const cy = y + 32;
        g.fillStyle = 'rgba(122,74,62,0.55)';
        for (let k = 0; k < 4; k++) {
          const a = (k / 4) * Math.PI * 2;
          g.beginPath();
          g.ellipse(cx + Math.cos(a) * 6, cy + Math.sin(a) * 6, 5, 3, a, 0, Math.PI * 2);
          g.fill();
        }
        g.fillStyle = 'rgba(90,110,72,0.6)';
        g.beginPath();
        g.arc(cx, cy, 2.5, 0, Math.PI * 2);
        g.fill();
      }
    }
    const r = rng(7);
    for (let i = 0; i < 4000; i++) {
      g.fillStyle = `rgba(40,30,20,${r() * 0.05})`;
      g.fillRect(r() * 512, r() * 512, 2, 2);
    }
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(ROOM_W / 0.9, ROOM_H / 0.9);
  return tex;
}

/** Painted floorboards, warm and worn. */
function floorboards(): THREE.CanvasTexture {
  const tex = canvas(1024, 1024, (g) => {
    const r = rng(11);
    const plank = 1024 / 8;
    for (let i = 0; i < 8; i++) {
      const base = 52 + r() * 14;
      g.fillStyle = `hsl(18, 42%, ${base * 0.42}%)`;
      g.fillRect(i * plank, 0, plank, 1024);
      for (let k = 0; k < 60; k++) {
        g.strokeStyle = `rgba(30,16,8,${0.05 + r() * 0.1})`;
        g.lineWidth = 1 + r() * 2;
        const x = i * plank + r() * plank;
        g.beginPath();
        g.moveTo(x, 0);
        g.bezierCurveTo(x + r() * 10 - 5, 300, x + r() * 10 - 5, 700, x + r() * 6 - 3, 1024);
        g.stroke();
      }
      g.fillStyle = 'rgba(15,8,4,0.85)';
      g.fillRect(i * plank, 0, 3, 1024);
      const joint = r() * 1024;
      g.fillRect(i * plank, joint, plank, 3);
    }
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(ROOM_W / 1.6, ROOM_D / 1.6);
  return tex;
}

/** The wall carpet over the bed: red ground, a medallion, a patterned border. */
function wallCarpet(): THREE.CanvasTexture {
  return canvas(1024, 704, (g) => {
    const W = 1024;
    const H = 704;
    g.fillStyle = '#7a1c1a';
    g.fillRect(0, 0, W, H);
    // Border bands.
    const band = (inset: number, width: number, color: string): void => {
      g.strokeStyle = color;
      g.lineWidth = width;
      g.strokeRect(inset, inset, W - inset * 2, H - inset * 2);
    };
    band(14, 18, '#2c1c3a');
    band(40, 22, '#c9a35a');
    band(66, 10, '#2c1c3a');
    for (let x = 60; x < W - 60; x += 34) {
      g.fillStyle = '#7a1c1a';
      g.beginPath();
      g.moveTo(x, 40);
      g.lineTo(x + 10, 30);
      g.lineTo(x + 20, 40);
      g.lineTo(x + 10, 50);
      g.fill();
      g.beginPath();
      g.moveTo(x, H - 40);
      g.lineTo(x + 10, H - 30);
      g.lineTo(x + 20, H - 40);
      g.lineTo(x + 10, H - 50);
      g.fill();
    }
    // The field's small repeating motif.
    for (let y = 110; y < H - 100; y += 56) {
      for (let x = 110; x < W - 100; x += 56) {
        g.fillStyle = (x + y) % 112 === 0 ? '#c9a35a' : '#1d2a4a';
        g.beginPath();
        g.moveTo(x, y - 9);
        g.lineTo(x + 9, y);
        g.lineTo(x, y + 9);
        g.lineTo(x - 9, y);
        g.fill();
      }
    }
    // The medallion.
    const cx = W / 2;
    const cy = H / 2;
    const rings: [number, string][] = [
      [210, '#2c1c3a'], [190, '#c9a35a'], [170, '#8f2a22'], [140, '#1d2a4a'], [110, '#e2c88a'], [80, '#7a1c1a'], [46, '#c9a35a'], [22, '#2c1c3a'],
    ];
    for (const [r, color] of rings) {
      g.fillStyle = color;
      g.beginPath();
      g.moveTo(cx, cy - r);
      g.lineTo(cx + r * 1.4, cy);
      g.lineTo(cx, cy + r);
      g.lineTo(cx - r * 1.4, cy);
      g.closePath();
      g.fill();
    }
    // Pile: a soft noise.
    const r = rng(23);
    for (let i = 0; i < 26000; i++) {
      g.fillStyle = `rgba(0,0,0,${r() * 0.12})`;
      g.fillRect(r() * W, r() * H, 1.5, 1.5);
    }
  });
}

/** The play mat: grass, a road loop with a crossing, little houses. */
function playMat(): THREE.CanvasTexture {
  return canvas(1024, 704, (g) => {
    g.fillStyle = '#4f6a3a';
    g.fillRect(0, 0, 1024, 704);
    const r = rng(31);
    for (let i = 0; i < 9000; i++) {
      g.fillStyle = `rgba(${r() < 0.5 ? '30,50,20' : '120,150,80'},${r() * 0.18})`;
      g.fillRect(r() * 1024, r() * 704, 2, 2);
    }
    const road = (draw: () => void): void => {
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.strokeStyle = '#3b3b3e';
      g.lineWidth = 78;
      g.beginPath();
      draw();
      g.stroke();
      g.strokeStyle = '#e8e2c8';
      g.lineWidth = 5;
      g.setLineDash([26, 22]);
      g.beginPath();
      draw();
      g.stroke();
      g.setLineDash([]);
    };
    road(() => g.roundRect(120, 110, 784, 484, 150));
    road(() => {
      g.moveTo(512, 110);
      g.lineTo(512, 594);
    });
    // Little houses and trees.
    const house = (x: number, y: number, color: string): void => {
      g.fillStyle = color;
      g.fillRect(x, y, 70, 52);
      g.fillStyle = '#7a2a22';
      g.beginPath();
      g.moveTo(x - 8, y);
      g.lineTo(x + 35, y - 34);
      g.lineTo(x + 78, y);
      g.fill();
      g.fillStyle = '#e8d38a';
      g.fillRect(x + 12, y + 14, 16, 16);
      g.fillRect(x + 42, y + 14, 16, 16);
    };
    house(250, 290, '#d8cba4');
    house(650, 300, '#a9c0d8');
    for (const [x, y] of [[180, 40], [360, 640], [880, 650], [940, 50], [330, 380], [740, 420]] as const) {
      g.fillStyle = '#2f4a24';
      g.beginPath();
      g.arc(x, y, 26, 0, Math.PI * 2);
      g.fill();
    }
  });
}

/** The dreams' map: the road from stop to stop, a stop per dream, done ones in green. */
function dreamMap(progress: DreamProgress): THREE.CanvasTexture {
  return canvas(1024, 720, (g) => {
    g.fillStyle = '#e4d5ae';
    g.fillRect(0, 0, 1024, 720);
    const r = rng(41);
    for (let i = 0; i < 6000; i++) {
      g.fillStyle = `rgba(110,80,40,${r() * 0.06})`;
      g.fillRect(r() * 1024, r() * 720, 3, 3);
    }
    // Folds.
    g.strokeStyle = 'rgba(120,90,50,0.35)';
    g.lineWidth = 3;
    for (const x of [341, 683]) {
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, 720);
      g.stroke();
    }
    g.beginPath();
    g.moveTo(0, 360);
    g.lineTo(1024, 360);
    g.stroke();
    // Contours of the desert.
    g.strokeStyle = 'rgba(160,110,60,0.35)';
    g.lineWidth = 2;
    for (let k = 0; k < 7; k++) {
      g.beginPath();
      g.ellipse(250 + k * 90, 560 - k * 40, 120 + k * 10, 50 + k * 4, 0.3, 0, Math.PI * 2);
      g.stroke();
    }
    const count = DREAMS.length;
    const at = (i: number): [number, number] => {
      const t = (i + 0.5) / count;
      return [90 + t * 844, 380 + Math.sin(t * Math.PI * 2.2) * 170];
    };
    g.strokeStyle = '#a7462a';
    g.lineWidth = 12;
    g.lineCap = 'round';
    g.beginPath();
    for (let k = 0; k <= 120; k++) {
      const t = k / 120;
      const x = 40 + t * 944;
      const y = 380 + Math.sin(((x - 90) / 844) * Math.PI * 2.2) * 170;
      if (k === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
    g.font = '600 26px "Barlow Condensed", "Arial Narrow", sans-serif';
    g.textAlign = 'center';
    DREAMS.forEach((dream, i) => {
      const [x, y] = at(i);
      const done = progress[dream.id] !== undefined;
      g.fillStyle = done ? '#3f8f4f' : '#f2e8d0';
      g.strokeStyle = done ? '#1f3a22' : '#6a4a30';
      g.lineWidth = 5;
      g.beginPath();
      g.arc(x, y, done ? 20 : 15, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.fillStyle = '#3a2a1a';
      g.fillText(dream.title, x, y + (i % 2 === 0 ? -34 : 52));
    });
    g.font = '800 italic 44px "Barlow Condensed", "Arial Narrow", sans-serif';
    g.textAlign = 'left';
    g.fillStyle = 'rgba(80,50,30,0.8)';
    g.fillText('DREAMS', 40, 70);
  });
}

/** The poster above the shelf: a Zhiguli on a red ground. */
function poster(): THREE.CanvasTexture {
  return canvas(512, 720, (g) => {
    g.fillStyle = '#c7362a';
    g.fillRect(0, 0, 512, 720);
    g.fillStyle = '#f0e2c4';
    g.fillRect(24, 24, 464, 672);
    g.fillStyle = '#c7362a';
    g.fillRect(40, 40, 432, 470);
    // The road and the car's side.
    g.fillStyle = '#2a2a2e';
    g.fillRect(40, 400, 432, 110);
    g.fillStyle = '#f0e2c4';
    for (let x = 60; x < 460; x += 70) g.fillRect(x, 452, 40, 6);
    g.fillStyle = '#f2f2ea';
    g.beginPath();
    g.moveTo(80, 400);
    g.lineTo(110, 350);
    g.lineTo(170, 350);
    g.lineTo(210, 300);
    g.lineTo(330, 300);
    g.lineTo(380, 350);
    g.lineTo(440, 360);
    g.lineTo(440, 400);
    g.closePath();
    g.fill();
    g.fillStyle = '#7fa6c2';
    g.fillRect(222, 312, 50, 36);
    g.fillRect(282, 312, 50, 36);
    g.fillStyle = '#1a1a1a';
    for (const x of [150, 370]) {
      g.beginPath();
      g.arc(x, 402, 28, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = '#c7362a';
    g.font = '800 italic 96px "Barlow Condensed", "Arial Narrow", sans-serif';
    g.textAlign = 'center';
    g.fillText('ЖИГУЛИ', 256, 610);
    g.font = '600 30px "Barlow Condensed", "Arial Narrow", sans-serif';
    g.fillStyle = '#3a2a1a';
    g.fillText('ВАЗ · ТОЛЬЯТТИ', 256, 660);
  });
}

/** The quilt: faded patchwork squares. */
function quilt(): THREE.CanvasTexture {
  const tex = canvas(512, 512, (g) => {
    const colors = ['#7c3a35', '#a8714a', '#4b5f7a', '#8a7a52', '#6a3f5a', '#9a4a3a'];
    const r = rng(53);
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        g.fillStyle = colors[Math.floor(r() * colors.length)]!;
        g.fillRect(x * 64, y * 64, 64, 64);
        g.strokeStyle = 'rgba(240,220,180,0.35)';
        g.setLineDash([6, 5]);
        g.lineWidth = 2;
        g.strokeRect(x * 64 + 4, y * 64 + 4, 56, 56);
      }
    }
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1.5, 2.5);
  return tex;
}

/** Outside the window: the night desert, the moon and the road going away. */
function nightDesert(): THREE.CanvasTexture {
  return canvas(2048, 1024, (g) => {
    const sky = g.createLinearGradient(0, 0, 0, 640);
    sky.addColorStop(0, '#08102a');
    sky.addColorStop(0.65, '#24375e');
    sky.addColorStop(1, '#58506c');
    g.fillStyle = sky;
    g.fillRect(0, 0, 2048, 1024);
    const r = rng(61);
    for (let i = 0; i < 900; i++) {
      const s = r() < 0.06 ? 2.4 : 1.2;
      g.fillStyle = `rgba(242,232,208,${0.3 + r() * 0.7})`;
      g.fillRect(r() * 2048, r() * 560, s, s);
    }
    // The moon and its halo, high in the window's right pane.
    const [mx, my] = [1110, 330];
    const halo = g.createRadialGradient(mx, my, 20, mx, my, 240);
    halo.addColorStop(0, 'rgba(230,226,210,0.45)');
    halo.addColorStop(1, 'rgba(230,226,210,0)');
    g.fillStyle = halo;
    g.fillRect(mx - 300, my - 300, 600, 600);
    g.fillStyle = '#f2ecd8';
    g.beginPath();
    g.arc(mx, my, 40, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(160,160,150,0.35)';
    for (const [x, y, s] of [[mx - 11, my - 11, 8], [mx + 13, my + 12, 6], [mx + 6, my - 17, 5]] as const) {
      g.beginPath();
      g.arc(x, y, s, 0, Math.PI * 2);
      g.fill();
    }
    // Mesas.
    g.fillStyle = '#2a2232';
    g.beginPath();
    g.moveTo(0, 640);
    g.lineTo(160, 600);
    g.lineTo(220, 520);
    g.lineTo(420, 515);
    g.lineTo(470, 600);
    g.lineTo(900, 620);
    g.lineTo(1500, 610);
    g.lineTo(1580, 540);
    g.lineTo(1760, 535);
    g.lineTo(1820, 610);
    g.lineTo(2048, 620);
    g.lineTo(2048, 1024);
    g.lineTo(0, 1024);
    g.fill();
    // The desert floor in moonlight.
    const ground = g.createLinearGradient(0, 610, 0, 1024);
    ground.addColorStop(0, '#5a4c58');
    ground.addColorStop(1, '#8a6c50');
    g.fillStyle = ground;
    g.fillRect(0, 630, 2048, 400);
    // The road to the horizon.
    g.fillStyle = '#1e1c22';
    g.beginPath();
    g.moveTo(1010, 630);
    g.lineTo(1038, 630);
    g.lineTo(1500, 1024);
    g.lineTo(560, 1024);
    g.closePath();
    g.fill();
    g.fillStyle = 'rgba(232,226,200,0.75)';
    for (let k = 0; k < 9; k++) {
      const t = k / 9;
      const t2 = t + 0.045;
      const y0 = 630 + Math.pow(t, 2.2) * 394;
      const y1 = 630 + Math.pow(t2, 2.2) * 394;
      const w0 = 1 + t * 10;
      g.fillRect(1024 - w0 / 2, y0, w0, Math.max(1, y1 - y0));
    }
    // Poles along the road.
    g.strokeStyle = '#141218';
    g.lineWidth = 3;
    for (let k = 1; k < 7; k++) {
      const t = k / 7;
      const x = 1046 + Math.pow(t, 2) * 700;
      const y = 630 + Math.pow(t, 2.2) * 394;
      const h = 20 + t * 220;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x, y - h);
      g.stroke();
    }
  });
}

/** The alarm clock's and the wall clock's face. */
function clockFace(): THREE.CanvasTexture {
  return canvas(256, 256, (g) => {
    g.fillStyle = '#efe6cf';
    g.beginPath();
    g.arc(128, 128, 126, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#2a2018';
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * Math.PI * 2;
      const long = i % 5 === 0;
      g.lineWidth = long ? 6 : 2;
      g.beginPath();
      g.moveTo(128 + Math.sin(a) * (long ? 92 : 104), 128 - Math.cos(a) * (long ? 92 : 104));
      g.lineTo(128 + Math.sin(a) * 114, 128 - Math.cos(a) * 114);
      g.stroke();
    }
    g.font = '700 30px "Barlow Condensed", sans-serif';
    g.fillStyle = '#2a2018';
    g.textAlign = 'center';
    g.fillText('МАЯК', 128, 90);
  });
}

/* ------------------------------------------------------------------ *
 *  Building                                                          *
 * ------------------------------------------------------------------ */

const disposables: { dispose(): void }[] = [];

function mat(params: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial(params);
  disposables.push(m);
  return m;
}

function mesh(geometry: THREE.BufferGeometry, material: THREE.Material, x = 0, y = 0, z = 0, cast = true): THREE.Mesh {
  disposables.push(geometry);
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z);
  m.castShadow = cast;
  m.receiveShadow = true;
  return m;
}

function box(w: number, h: number, d: number, material: THREE.Material, x: number, y: number, z: number, radius = 0): THREE.Mesh {
  const geometry = radius > 0 ? new RoundedBoxGeometry(w, h, d, 3, radius) : new THREE.BoxGeometry(w, h, d);
  return mesh(geometry, material, x, y, z);
}

/** A die-cast toy of a kit car: the built car merged into one draw, its paint in `color`, at `scale`. */
function dieCast(modelId: string, color: number, scale: number): THREE.Mesh {
  const root = buildKitCar(modelId.replace(/^kit_/, ''));
  root.updateMatrixWorld(true);
  const paint = new THREE.Color(color);
  const parts: THREE.BufferGeometry[] = [];
  root.traverse((node) => {
    const m = node as THREE.Mesh;
    if (!m.isMesh) return;
    let g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
    g.applyMatrix4(m.matrixWorld);
    const count = g.getAttribute('position').count;
    const colors = new Float32Array(count * 3);
    const built = g.getAttribute('color');
    const surface = g.getAttribute(CAR_SURFACE_ATTRIBUTE);
    for (let i = 0; i < count; i++) {
      let c: [number, number, number];
      if (!built) c = [0.06, 0.08, 0.1]; // the glass: dark and glossy
      else if (surface && surface.getX(i) > 0.5) c = [paint.r, paint.g, paint.b];
      else c = [built.getX(i), built.getY(i), built.getZ(i)];
      colors.set(c, i * 3);
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', g.getAttribute('position'));
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    out.setAttribute('normal', g.getAttribute('normal'));
    out.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    parts.push(out);
    g = out;
  });
  const merged = mergeGeometries(parts, false)!;
  for (const part of parts) part.dispose();
  merged.scale(scale, scale, scale);
  const toy = mesh(merged, toyMaterial());
  return toy;
}

let toyMat: THREE.MeshStandardMaterial | null = null;
function toyMaterial(): THREE.MeshStandardMaterial {
  toyMat ??= mat({ vertexColors: true, roughness: 0.28, metalness: 0.25, side: THREE.DoubleSide });
  return toyMat;
}

/** The dream a toy stands for, its car and colour. */
function toyOf(dream: DreamDef): { modelId: string; color: number } {
  return { modelId: dream.modelId, color: factoryPaintHex(dream.modelId, DREAM_CAR_ID) };
}

export function buildRoomScene(progress: DreamProgress, nextDream: DreamDef | null, lowDetail: boolean): RoomScene {
  disposables.length = 0;
  toyMat = null;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x050608);

  const wallMat = mat({ map: wallpaper(), roughness: 0.92 });
  const floorMat = mat({ map: floorboards(), roughness: 0.62 });
  const ceilMat = mat({ color: 0xb9b0a0, roughness: 0.95 });
  const woodDark = mat({ color: 0x4a2f1e, roughness: 0.55 });
  const woodMid = mat({ color: 0x7a5236, roughness: 0.5 });
  const woodPale = mat({ color: 0xa47a52, roughness: 0.55 });
  const paintWhite = mat({ color: 0xd8d2c2, roughness: 0.5 });
  const metalDark = mat({ color: 0x2a2a2c, roughness: 0.4, metalness: 0.7 });
  const brass = mat({ color: 0xb08a45, roughness: 0.35, metalness: 0.85 });
  const red = mat({ color: 0xa8302a, roughness: 0.38, metalness: 0.3 });

  // The room's shell. The back wall is built round the window's opening.
  const floor = mesh(new THREE.PlaneGeometry(ROOM_W, ROOM_D), floorMat, 0, 0, 0, false);
  floor.rotation.x = -Math.PI / 2;
  const ceiling = mesh(new THREE.PlaneGeometry(ROOM_W, ROOM_D), ceilMat, 0, ROOM_H, 0, false);
  ceiling.rotation.x = Math.PI / 2;
  scene.add(floor, ceiling);
  const wall = (w: number, h: number, x: number, y: number, z: number, ry: number): THREE.Mesh => {
    const geometry = new THREE.PlaneGeometry(w, h);
    // The wallpaper's repeat follows the wall piece's own size.
    const uv = geometry.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * w) / ROOM_W, (uv.getY(i) * h) / ROOM_H);
    const m = mesh(geometry, wallMat, x, y, z);
    m.rotation.y = ry;
    return m;
  };
  scene.add(
    wall(WIN.x0 - X0, ROOM_H, (X0 + WIN.x0) / 2, ROOM_H / 2, Z0, 0),
    wall(X1 - WIN.x1, ROOM_H, (WIN.x1 + X1) / 2, ROOM_H / 2, Z0, 0),
    wall(WIN.x1 - WIN.x0, WIN.y0, (WIN.x0 + WIN.x1) / 2, WIN.y0 / 2, Z0, 0),
    wall(WIN.x1 - WIN.x0, ROOM_H - WIN.y1, (WIN.x0 + WIN.x1) / 2, (WIN.y1 + ROOM_H) / 2, Z0, 0),
    wall(ROOM_D, ROOM_H, X0, ROOM_H / 2, 0, Math.PI / 2),
    wall(ROOM_D, ROOM_H, X1, ROOM_H / 2, 0, -Math.PI / 2),
    wall(ROOM_W, ROOM_H, 0, ROOM_H / 2, Z1, Math.PI),
  );
  // The back wall is a thin slab for the moon's shadow: a plane casts from one side only.
  for (const [w, h, x, y] of [
    [WIN.x0 - X0, ROOM_H, (X0 + WIN.x0) / 2, ROOM_H / 2],
    [X1 - WIN.x1, ROOM_H, (WIN.x1 + X1) / 2, ROOM_H / 2],
    [WIN.x1 - WIN.x0, WIN.y0, (WIN.x0 + WIN.x1) / 2, WIN.y0 / 2],
    [WIN.x1 - WIN.x0, ROOM_H - WIN.y1, (WIN.x0 + WIN.x1) / 2, (WIN.y1 + ROOM_H) / 2],
  ] as const) {
    const slab = box(w, h, 0.12, woodDark, x, y, Z0 - 0.065);
    slab.receiveShadow = false;
    scene.add(slab);
  }
  // Skirting boards.
  for (const [w, x, z, ry] of [
    [ROOM_W, 0, Z0 + 0.01, 0],
    [ROOM_W, 0, Z1 - 0.01, 0],
    [ROOM_D, X0 + 0.01, 0, Math.PI / 2],
    [ROOM_D, X1 - 0.01, 0, Math.PI / 2],
  ] as const) {
    const b = box(w, 0.09, 0.02, woodDark, x, 0.045, z);
    b.rotation.y = ry;
    scene.add(b);
  }

  // The window: frame, cross bars, sill, the night outside and a faint pane.
  const frameMat = mat({ color: 0xcfc6b2, roughness: 0.55 });
  const wx = (WIN.x0 + WIN.x1) / 2;
  const wy = (WIN.y0 + WIN.y1) / 2;
  const ww = WIN.x1 - WIN.x0;
  const wh = WIN.y1 - WIN.y0;
  scene.add(
    box(ww + 0.12, 0.07, 0.16, frameMat, wx, WIN.y1 + 0.035, Z0 - 0.02),
    box(ww + 0.12, 0.06, 0.16, frameMat, wx, WIN.y0 - 0.03, Z0 - 0.02),
    box(0.07, wh, 0.16, frameMat, WIN.x0 - 0.035, wy, Z0 - 0.02),
    box(0.07, wh, 0.16, frameMat, WIN.x1 + 0.035, wy, Z0 - 0.02),
    box(0.04, wh, 0.06, frameMat, wx, wy, Z0 - 0.06),
    box(ww, 0.04, 0.06, frameMat, wx, WIN.y0 + wh * 0.68, Z0 - 0.06),
    box(ww + 0.3, 0.04, 0.26, paintWhite, wx, WIN.y0 - 0.02, Z0 + 0.08, 0.01),
  );
  const pane = mesh(new THREE.PlaneGeometry(ww, wh), new THREE.MeshPhysicalMaterial({ color: 0x8aa0c0, transparent: true, opacity: 0.08, roughness: 0.05 }), wx, wy, Z0 - 0.07, false);
  pane.receiveShadow = false;
  disposables.push(pane.material as THREE.Material);
  scene.add(pane);
  const outside = new THREE.Mesh(new THREE.PlaneGeometry(14, 7), new THREE.MeshBasicMaterial({ map: nightDesert(), toneMapped: false }));
  disposables.push(outside.geometry, outside.material as THREE.Material);
  // Its horizon at the eye of someone standing at the window.
  outside.position.set(wx + 0.3, 1.95, Z0 - 5);
  scene.add(outside);
  // A radiator under the sill.
  for (let k = 0; k < 9; k++) scene.add(box(0.06, 0.5, 0.08, paintWhite, WIN.x0 + 0.12 + k * 0.13, 0.42, Z0 + 0.09, 0.02));

  // Curtains: hanging cloth with folds, on a rod.
  const curtainMat = mat({ color: 0x5e2a2a, roughness: 0.9, side: THREE.DoubleSide });
  const curtains: THREE.Mesh[] = [];
  for (const [x, flip] of [[WIN.x0 - 0.22, 1], [WIN.x1 + 0.22, -1]] as const) {
    const geometry = new THREE.PlaneGeometry(0.5, 2.2, 24, 12);
    const p = geometry.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const u = p.getX(i) / 0.5 + 0.5;
      p.setZ(i, Math.sin(u * Math.PI * 6) * 0.035 * (0.6 + 0.4 * u));
    }
    geometry.computeVertexNormals();
    const c = mesh(geometry, curtainMat, x, 2.25 - 1.1, Z0 + 0.14);
    c.scale.x = flip;
    curtains.push(c);
    scene.add(c);
  }
  scene.add(box(ww + 1.1, 0.025, 0.025, brass, wx, 2.3, Z0 + 0.14));

  // The wall carpet over the bed, on the left wall.
  const carpet = mesh(new THREE.PlaneGeometry(1.75, 1.2), mat({ map: wallCarpet(), roughness: 1 }), X0 + 0.012, 1.45, -0.55, false);
  carpet.rotation.y = Math.PI / 2;
  scene.add(carpet);

  // The bed along the left wall, its head to the back.
  const bed = new THREE.Group();
  const bx = X0 + 0.5;
  bed.add(
    box(0.98, 0.3, 2.02, woodMid, bx, 0.25, -0.55, 0.02),
    box(0.06, 0.25, 0.06, woodDark, bx - 0.44, 0.12, 0.42),
    box(0.06, 0.25, 0.06, woodDark, bx + 0.44, 0.12, 0.42),
    box(1.04, 0.95, 0.07, woodMid, bx, 0.6, -1.58, 0.02),
    box(1.04, 0.55, 0.06, woodMid, bx, 0.42, 0.46, 0.02),
    box(0.92, 0.18, 1.94, mat({ color: 0xd9d0bc, roughness: 0.9 }), bx, 0.48, -0.55, 0.06),
  );
  // The quilt, rumpled: a slab with its top pushed about and its edges falling.
  {
    const geometry = new THREE.BoxGeometry(1.0, 0.08, 1.45, 30, 2, 40);
    const p = geometry.getAttribute('position');
    const r = rng(77);
    const bumps = Array.from({ length: 8 }, () => [r() - 0.5, (r() - 0.5) * 1.4, 0.03 + r() * 0.05] as const);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const z = p.getZ(i);
      let y = p.getY(i);
      for (const [bx2, bz, h] of bumps) y += h * Math.exp(-((x - bx2) ** 2 + (z - bz) ** 2) / 0.04);
      // Over the mattress's sides the quilt hangs down.
      const over = Math.max(0, Math.abs(x) - 0.44);
      y -= over * 2.2;
      p.setY(i, y);
    }
    geometry.computeVertexNormals();
    bed.add(mesh(geometry, mat({ map: quilt(), roughness: 0.95 }), bx, 0.6, -0.25));
  }
  // The pillow.
  {
    const geometry = new RoundedBoxGeometry(0.62, 0.14, 0.4, 4, 0.06);
    const p = geometry.getAttribute('position');
    for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) * (1 - (p.getX(i) / 0.34) ** 2 * 0.5));
    geometry.computeVertexNormals();
    const pillow = mesh(geometry, mat({ color: 0xece4d2, roughness: 0.95 }), bx, 0.64, -1.3);
    pillow.rotation.x = -0.25;
    bed.add(pillow);
  }
  scene.add(bed);

  // The bedside table with the alarm clock.
  const faceTex = clockFace();
  const faceMat = mat({ map: faceTex, roughness: 0.6 });
  scene.add(box(0.42, 0.55, 0.38, woodPale, X0 + 1.25, 0.275, -1.5, 0.02));
  const alarm = new THREE.Group();
  alarm.add(mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.05, 28), red), mesh(new THREE.CircleGeometry(0.066, 28), faceMat, 0, 0, 0.026, false));
  alarm.children[0]!.rotation.x = Math.PI / 2;
  for (const sx of [-1, 1]) alarm.add(mesh(new THREE.SphereGeometry(0.028, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), brass, sx * 0.045, 0.075, 0));
  alarm.position.set(X0 + 1.2, 0.64, -1.42);
  alarm.rotation.y = 0.5;
  scene.add(alarm);

  // The play mat on the floor, and on it the next dream's car.
  const matMesh = mesh(new THREE.PlaneGeometry(1.6, 1.1), mat({ map: playMat(), roughness: 1 }), 0.15, 0.004, 0.15, false);
  matMesh.rotation.x = -Math.PI / 2;
  scene.add(matMesh);

  // The desk against the right wall, its drawers, the lamp and the map.
  const dx = X1 - 0.38;
  const dz = -1.0;
  scene.add(
    box(0.72, 0.04, 1.3, woodPale, dx, 0.75, dz, 0.01),
    box(0.68, 0.7, 0.42, woodMid, dx, 0.37, dz - 0.42, 0.01),
    box(0.04, 0.72, 0.04, woodDark, dx - 0.32, 0.36, dz + 0.6),
    box(0.04, 0.72, 0.04, woodDark, dx + 0.32, 0.36, dz + 0.6),
  );
  for (let k = 0; k < 3; k++) {
    scene.add(box(0.02, 0.18, 0.36, woodPale, dx - 0.35, 0.58 - k * 0.22, dz - 0.42, 0.005));
    scene.add(box(0.03, 0.02, 0.08, brass, dx - 0.37, 0.58 - k * 0.22, dz - 0.42));
  }
  const mapMesh = mesh(new THREE.PlaneGeometry(0.62, 0.44), mat({ map: dreamMap(progress), roughness: 0.85 }), dx - 0.03, 0.773, dz + 0.12, false);
  mapMesh.rotation.x = -Math.PI / 2;
  mapMesh.rotation.z = -Math.PI / 2 + 0.08;
  scene.add(mapMesh);
  // A pencil and a mug.
  const pencil = mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.17, 6), mat({ color: 0xd8a830, roughness: 0.5 }), dx - 0.2, 0.778, dz + 0.42);
  pencil.rotation.z = Math.PI / 2;
  pencil.rotation.y = 0.6;
  scene.add(pencil);
  scene.add(mesh(new THREE.CylinderGeometry(0.04, 0.036, 0.09, 20), mat({ color: 0xe8e0cc, roughness: 0.3 }), dx + 0.2, 0.815, dz + 0.45));
  // The desk lamp: foot, two arms, a cone shade, its bulb lit.
  const lamp = new THREE.Group();
  const lampMat = mat({ color: 0x2f4a3a, roughness: 0.35, metalness: 0.5 });
  lamp.add(mesh(new THREE.CylinderGeometry(0.08, 0.09, 0.025, 24), lampMat, 0, 0.012, 0));
  const arm1 = mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.36, 8), metalDark, 0.04, 0.18, 0);
  arm1.rotation.z = -0.25;
  const arm2 = mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.3, 8), metalDark, -0.02, 0.43, 0);
  arm2.rotation.z = 1.0;
  const shade = mesh(new THREE.ConeGeometry(0.1, 0.14, 24, 1, true), mat({ color: 0x2f4a3a, roughness: 0.35, metalness: 0.5, side: THREE.DoubleSide }), -0.16, 0.5, 0);
  shade.rotation.z = 0.6;
  const bulb = mesh(new THREE.SphereGeometry(0.03, 12, 8), new THREE.MeshBasicMaterial({ color: 0xfff1c8 }), -0.17, 0.47, 0, false);
  disposables.push(bulb.material as THREE.Material);
  lamp.add(arm1, arm2, shade, bulb);
  lamp.position.set(dx + 0.12, 0.77, dz - 0.4);
  lamp.rotation.y = Math.PI / 2 + 0.3;
  scene.add(lamp);
  // An old radio at the desk's back.
  const radio = new THREE.Group();
  radio.add(
    box(0.34, 0.2, 0.16, mat({ color: 0x5a3a22, roughness: 0.4 }), 0, 0.1, 0, 0.015),
    mesh(new THREE.PlaneGeometry(0.2, 0.08), mat({ color: 0xd9c89a, roughness: 0.7, emissive: 0x5a4020, emissiveIntensity: 0.4 }), -0.04, 0.14, 0.081, false),
    mesh(new THREE.PlaneGeometry(0.1, 0.12), mat({ color: 0x2a2018, roughness: 0.9 }), 0.1, 0.1, 0.081, false),
  );
  radio.position.set(dx + 0.15, 0.77, dz + 0.45);
  radio.rotation.y = -Math.PI / 2;
  scene.add(radio);

  // The shelf on the back wall right of the window, its toys, the poster over it.
  const sx0 = 0.78;
  const sx1 = X1 - 0.12;
  const sy = 1.52;
  scene.add(box(sx1 - sx0, 0.03, 0.2, woodPale, (sx0 + sx1) / 2, sy, Z0 + 0.1, 0.005));
  for (const x of [sx0 + 0.1, sx1 - 0.1]) scene.add(box(0.025, 0.12, 0.16, metalDark, x, sy - 0.075, Z0 + 0.08));
  const posterMesh = mesh(new THREE.PlaneGeometry(0.42, 0.59), mat({ map: poster(), roughness: 0.8 }), (sx0 + sx1) / 2 - 0.12, 2.0, Z0 + 0.012, false);
  scene.add(posterMesh);

  // The wall clock over the desk.
  const wallClock = new THREE.Group();
  wallClock.add(mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.04, 36), woodDark));
  wallClock.children[0]!.rotation.x = Math.PI / 2;
  const face = mesh(new THREE.CircleGeometry(0.135, 36), faceMat, 0, 0, 0.021, false);
  const hand = (len: number, width: number): THREE.Mesh => {
    const g = new THREE.PlaneGeometry(width, len);
    g.translate(0, len / 2 - 0.01, 0);
    return mesh(g, mat({ color: 0x1a1410 }), 0, 0, 0.024, false);
  };
  const hourHand = hand(0.075, 0.012);
  const minuteHand = hand(0.11, 0.008);
  const secondHand = hand(0.12, 0.003);
  (secondHand.material as THREE.MeshStandardMaterial).color.set(0xa8302a);
  wallClock.add(face, hourHand, minuteHand, secondHand);
  wallClock.position.set(X1 - 0.02, 1.95, dz);
  wallClock.rotation.y = -Math.PI / 2;
  scene.add(wallClock);

  // The door on the right wall in its frame, and the key board beside it.
  const doorWood = mat({ color: 0x6a4428, roughness: 0.45 });
  const door = new THREE.Group();
  door.add(
    box(0.9, 2.04, 0.045, doorWood, 0, 1.02, 0, 0.008),
    box(0.66, 0.74, 0.012, mat({ color: 0x5a3820, roughness: 0.4 }), 0, 1.5, 0.026, 0.006),
    box(0.66, 0.74, 0.012, mat({ color: 0x5a3820, roughness: 0.4 }), 0, 0.58, 0.026, 0.006),
    box(0.035, 0.17, 0.05, brass, 0.36, 1.0, 0.05, 0.012),
    box(0.02, 0.05, 0.02, brass, 0.36, 0.9, 0.05, 0.006),
    // The architrave round it.
    box(0.08, 2.12, 0.03, paintWhite, -0.49, 1.06, 0.0, 0.006),
    box(0.08, 2.12, 0.03, paintWhite, 0.49, 1.06, 0.0, 0.006),
    box(1.06, 0.08, 0.03, paintWhite, 0, 2.1, 0.0, 0.006),
  );
  door.position.set(X1 - 0.03, 0, 1.05);
  door.rotation.y = -Math.PI / 2;
  scene.add(door);
  // The key board: a varnished plank with three brass hooks; on one the car's keys
  // (a black-headed ignition key and a door key on a ring, a red leather fob with a
  // brass number tag), on another the flat's key on a string.
  const keyBoard = new THREE.Group();
  keyBoard.add(box(0.36, 0.15, 0.022, woodMid, 0, 0, 0, 0.01));
  for (const x of [-0.11, 0, 0.11]) {
    keyBoard.add(box(0.012, 0.012, 0.045, brass, x, -0.035, 0.03, 0.004));
    keyBoard.add(box(0.012, 0.025, 0.012, brass, x, -0.025, 0.05, 0.004));
  }
  const steel = mat({ color: 0xcfcac0, roughness: 0.25, metalness: 0.95 });
  const blackPlastic = mat({ color: 0x141414, roughness: 0.35 });
  const carKeys = new THREE.Group();
  carKeys.add(mesh(new THREE.TorusGeometry(0.022, 0.0035, 8, 28), steel, 0, -0.02, 0));
  const key = (rot: number, head: THREE.Material): THREE.Group => {
    const k = new THREE.Group();
    k.add(box(0.026, 0.032, 0.009, head, 0, -0.016, 0, 0.004), box(0.01, 0.055, 0.003, steel, 0, -0.058, 0));
    for (let n = 0; n < 4; n++) k.add(box(0.004, 0.006, 0.003, steel, 0.006, -0.045 - n * 0.01, 0));
    k.position.set(0, -0.04, 0.004);
    k.rotation.z = rot;
    return k;
  };
  const fob = new THREE.Group();
  fob.add(box(0.032, 0.075, 0.006, mat({ color: 0x8a1e1a, roughness: 0.6 }), 0, -0.04, 0, 0.004), mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.003, 20), brass, 0, -0.065, 0.005));
  (fob.children[1] as THREE.Mesh).rotation.x = Math.PI / 2;
  fob.position.set(0, -0.04, -0.004);
  fob.rotation.z = -0.12;
  carKeys.add(key(0.32, blackPlastic), key(-0.18, steel), fob);
  carKeys.position.set(-0.11, -0.035, 0.05);
  const flatKey = new THREE.Group();
  flatKey.add(mesh(new THREE.CylinderGeometry(0.0015, 0.0015, 0.08, 4), mat({ color: 0xd8cfa8, roughness: 0.9 }), 0, -0.04, 0), key(0.05, brass));
  flatKey.children[1]!.position.y = -0.08;
  flatKey.position.set(0.11, -0.035, 0.05);
  keyBoard.add(carKeys, flatKey);
  keyBoard.position.set(X1 - 0.013, 1.45, 0.3);
  keyBoard.rotation.y = -Math.PI / 2;
  scene.add(keyBoard);

  // The toolbox on the floor by the desk.
  const toolbox = new THREE.Group();
  toolbox.add(
    box(0.5, 0.22, 0.24, red, 0, 0.11, 0, 0.012),
    box(0.52, 0.04, 0.26, mat({ color: 0xc4473d, roughness: 0.35, metalness: 0.3 }), 0, 0.235, 0, 0.01),
    box(0.22, 0.02, 0.02, metalDark, 0, 0.3, 0),
    box(0.02, 0.06, 0.02, metalDark, -0.1, 0.27, 0),
    box(0.02, 0.06, 0.02, metalDark, 0.1, 0.27, 0),
    box(0.05, 0.03, 0.01, brass, 0, 0.17, 0.125),
  );
  // A spanner left on the lid.
  const spanner = box(0.2, 0.008, 0.024, mat({ color: 0xb8b8b0, roughness: 0.25, metalness: 0.95 }), 0.04, 0.26, 0.02);
  spanner.rotation.y = 0.4;
  toolbox.add(spanner);
  toolbox.position.set(X1 - 0.95, 0, -0.1);
  toolbox.rotation.y = -0.35;
  scene.add(toolbox);

  // A night-light in the socket by the bed: a small amber mushroom, and the glow the
  // play mat is seen by.
  const nightLight = new THREE.Group();
  nightLight.add(
    box(0.07, 0.1, 0.03, paintWhite, 0, 0, 0, 0.01),
    mesh(new THREE.SphereGeometry(0.035, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xffb060, emissive: 0xff9a3a, emissiveIntensity: 2.5 }), 0, 0.02, 0.03, false),
  );
  disposables.push((nightLight.children[1] as THREE.Mesh).material as THREE.Material);
  nightLight.position.set(X0 + 0.02, 0.32, 0.75);
  nightLight.rotation.y = Math.PI / 2;
  scene.add(nightLight);
  // Its light falls on the mat from where the glow would reach: a little out from the wall.
  const nightGlow = new THREE.PointLight(0xffa050, 3.5, 3, 2);
  nightGlow.position.set(X0 + 0.75, 0.45, 0.85);
  scene.add(nightGlow);

  // A ceiling lamp, off.
  scene.add(mesh(new THREE.CylinderGeometry(0.22, 0.16, 0.12, 24), mat({ color: 0xe8e2d0, roughness: 0.4, emissive: 0x302a20 }), 0, ROOM_H - 0.12, 0, false));

  // LIGHT. The moon through the window, the desk lamp, a little sky in the corners.
  const hemi = new THREE.HemisphereLight(0x42506e, 0x22170f, 1.4);
  scene.add(hemi);
  const moon = new THREE.DirectionalLight(0xa9bcff, 5);
  moon.position.set(wx - 1.2, 4.2, Z0 - 4.5);
  moon.target.position.set(wx + 0.6, 0, 0.9);
  moon.castShadow = true;
  moon.shadow.mapSize.set(lowDetail ? 1024 : 2048, lowDetail ? 1024 : 2048);
  moon.shadow.camera.left = -3.2;
  moon.shadow.camera.right = 3.2;
  moon.shadow.camera.top = 3.2;
  moon.shadow.camera.bottom = -3.2;
  moon.shadow.camera.near = 1;
  moon.shadow.camera.far = 14;
  moon.shadow.bias = -0.0004;
  moon.shadow.normalBias = 0.02;
  scene.add(moon, moon.target);
  const lampAt = new THREE.Vector3();
  bulb.getWorldPosition(lampAt);
  scene.updateMatrixWorld(true);
  bulb.getWorldPosition(lampAt);
  const deskLight = new THREE.SpotLight(0xffc27a, DESK_LAMP_CD, 5, 0.95, 0.6, 2);
  deskLight.position.copy(lampAt);
  deskLight.target.position.set(dx - 0.05, 0.75, dz + 0.1);
  deskLight.castShadow = true;
  deskLight.shadow.mapSize.set(lowDetail ? 512 : 1024, lowDetail ? 512 : 1024);
  deskLight.shadow.bias = -0.0006;
  deskLight.shadow.camera.near = 0.05;
  scene.add(deskLight, deskLight.target);
  const lampGlow = new THREE.PointLight(0xffb066, 4, 7, 2);
  lampGlow.position.copy(lampAt).add(new THREE.Vector3(-0.15, 0.1, 0));
  scene.add(lampGlow);

  // Dust in the moonbeam.
  const DUST = lowDetail ? 120 : 360;
  const dustGeo = new THREE.BufferGeometry();
  const dustPos = new Float32Array(DUST * 3);
  const dustSeed = new Float32Array(DUST);
  const r = rng(91);
  for (let i = 0; i < DUST; i++) {
    dustPos[i * 3] = wx - 0.6 + r() * 1.8;
    dustPos[i * 3 + 1] = 0.2 + r() * 2.0;
    dustPos[i * 3 + 2] = Z0 + 0.2 + r() * 2.4;
    dustSeed[i] = r() * 100;
  }
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  const dustMat = new THREE.PointsMaterial({ color: 0xcfd8ff, size: 0.006, map: dustSprite(), transparent: true, opacity: 0.5, depthWrite: false });
  disposables.push(dustGeo, dustMat);
  const dust = new THREE.Points(dustGeo, dustMat);
  scene.add(dust);

  // TOYS. One die-cast per dream on the shelf (built one at a time, `buildNextToy`),
  // and the next dream's car, larger, on the play mat. A dream not dreamt yet leaves
  // its place on the shelf empty but for a small price card.
  const toyQueue: (() => void)[] = [];
  const slot = (sx1 - sx0 - 0.2) / Math.max(1, DREAMS.length);
  DREAMS.forEach((dream, i) => {
    const x = sx0 + 0.1 + slot * (i + 0.5);
    if (progress[dream.id] === undefined) {
      const card = box(0.05, 0.035, 0.004, mat({ color: 0xe6dcc0, roughness: 0.8 }), x, sy + 0.035, Z0 + 0.14);
      card.rotation.x = -0.3;
      scene.add(card);
      return;
    }
    toyQueue.push(() => {
      const { modelId, color } = toyOf(dream);
      const toy = dieCast(modelId, color, 1 / 43);
      toy.position.set(x, sy + 0.016, Z0 + 0.11);
      toy.rotation.y = Math.PI / 2 - 0.35;
      scene.add(toy);
    });
  });
  if (nextDream) {
    toyQueue.unshift(() => {
      const { modelId, color } = toyOf(nextDream);
      const toy = dieCast(modelId, color, 1 / 24);
      // On the mat's road, its left side, driving away towards the window and its road.
      toy.position.set(0.15 - 0.8 + (120 / 1024) * 1.6, 0.006, 0.15 + 0.12);
      toy.rotation.y = 0.12;
      scene.add(toy);
    });
  }

  const anchors: RoomAnchors = {
    toy: new THREE.Vector3(0.15 - 0.62, 0.05, 0.15 + 0.18),
    map: new THREE.Vector3(dx - 0.03, 0.77, dz + 0.12),
    shelf: new THREE.Vector3((sx0 + sx1) / 2, sy + 0.05, Z0 + 0.1),
    keys: new THREE.Vector3(X1 - 0.02, 1.4, 0.38),
    window: new THREE.Vector3(wx, wy, Z0),
    toolbox: new THREE.Vector3(X1 - 0.95, 0.2, -0.1),
  };

  const now = new Date();
  return {
    scene,
    anchors,
    tick(t: number, dt: number): void {
      // The clocks keep the real time; the second hand steps.
      const seconds = now.getSeconds() + Math.floor(t);
      const minutes = now.getMinutes() + seconds / 60;
      const hours = (now.getHours() % 12) + minutes / 60;
      secondHand.rotation.z = -(Math.floor(seconds) / 60) * Math.PI * 2;
      minuteHand.rotation.z = -(minutes / 60) * Math.PI * 2;
      hourHand.rotation.z = -(hours / 12) * Math.PI * 2;
      // The lamp breathes a little, as a filament on a tired line does.
      deskLight.intensity = DESK_LAMP_CD * (1 + Math.sin(t * 2.3) * 0.015 + Math.sin(t * 13.7) * 0.01);
      // The curtains stir in a draught from the frame.
      curtains.forEach((c, i) => (c.rotation.x = Math.sin(t * 0.6 + i * 1.7) * 0.012));
      // Dust drifts and turns in the beam.
      const p = dustGeo.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < DUST; i++) {
        const s = dustSeed[i]!;
        let y = p.getY(i) + dt * (0.012 + Math.sin(t * 0.3 + s) * 0.01);
        if (y > 2.3) y = 0.2;
        p.setXYZ(i, p.getX(i) + Math.sin(t * 0.4 + s) * dt * 0.01, y, p.getZ(i) + Math.cos(t * 0.35 + s) * dt * 0.01);
      }
      p.needsUpdate = true;
    },
    buildNextToy(): boolean {
      const next = toyQueue.shift();
      if (!next) return false;
      next();
      return toyQueue.length > 0;
    },
    dispose(): void {
      scene.traverse((node) => {
        const m = node as THREE.Mesh;
        const material = m.material as THREE.MeshStandardMaterial | undefined;
        if (material?.map) material.map.dispose();
      });
      for (const d of disposables) d.dispose();
      disposables.length = 0;
    },
  };
}
