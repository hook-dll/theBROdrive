import * as THREE from 'three';
import { DREAMS } from '../dreams/dream';
import type { DreamProgress } from '../dreams/progress';

/**
 * The title room's painted surfaces (ui/roomscene.ts): everything a canvas draws — the
 * wallpaper, the floorboards, the wall carpet, the play mat, the adventures' map, the
 * quilt, the clock faces, the calendar's page, the night sky and the sand outside. No
 * downloads: the room is built in the browser in a few milliseconds.
 */

export function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
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
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const COND = '"Barlow Condensed", "Arial Narrow", sans-serif';

/** Soviet wallpaper: faded stripes and a small repeating flower. */
export function wallpaper(repeatX: number, repeatY: number): THREE.CanvasTexture {
  const tex = canvasTexture(512, 512, (g) => {
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
        const cx = x + 32;
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
  tex.repeat.set(repeatX, repeatY);
  return tex;
}

/** Painted floorboards, warm and worn. */
export function floorboards(repeatX: number, repeatY: number): THREE.CanvasTexture {
  const tex = canvasTexture(1024, 1024, (g) => {
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
      g.fillRect(i * plank, r() * 1024, plank, 3);
    }
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  return tex;
}

/** The wall carpet over the bed: red ground, a medallion, a patterned border. */
export function wallCarpet(): THREE.CanvasTexture {
  return canvasTexture(1024, 704, (g) => {
    const W = 1024;
    const H = 704;
    g.fillStyle = '#7a1c1a';
    g.fillRect(0, 0, W, H);
    const band = (inset: number, width: number, color: string): void => {
      g.strokeStyle = color;
      g.lineWidth = width;
      g.strokeRect(inset, inset, W - inset * 2, H - inset * 2);
    };
    band(14, 18, '#2c1c3a');
    band(40, 22, '#c9a35a');
    band(66, 10, '#2c1c3a');
    for (let x = 60; x < W - 60; x += 34) {
      for (const y of [40, H - 40]) {
        g.fillStyle = '#7a1c1a';
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + 10, y - 10);
        g.lineTo(x + 20, y);
        g.lineTo(x + 10, y + 10);
        g.fill();
      }
    }
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
    const r = rng(23);
    for (let i = 0; i < 26000; i++) {
      g.fillStyle = `rgba(0,0,0,${r() * 0.12})`;
      g.fillRect(r() * W, r() * H, 1.5, 1.5);
    }
  });
}

/** Where the play mat's road runs, in its canvas (1024 × 704): a loop and a crossing road. */
export const MAT_LOOP = { x: 120, y: 110, w: 784, h: 484, r: 150 } as const;
const MAT_W = 1024;
const MAT_H = 704;

/**
 * The play mat: the desert the drive opens on — the opening sand (world/gradient.ts,
 * `#d29459`) running into its crests and the next erg's gold in soft drifts — with the
 * road looping round it, telegraph poles along the road and cacti, all painted flat on
 * the cloth. Only the toy car stands on it.
 */
export function playMat(): THREE.CanvasTexture {
  return canvasTexture(MAT_W, MAT_H, (g) => {
    const sand = g.createLinearGradient(0, 0, MAT_W, MAT_H);
    sand.addColorStop(0, '#c98a50');
    sand.addColorStop(0.35, '#d29459');
    sand.addColorStop(0.7, '#dfaa70');
    sand.addColorStop(1, '#d9ad6b');
    g.fillStyle = sand;
    g.fillRect(0, 0, MAT_W, MAT_H);
    // Drifts: broad soft blooms of the crest colour and the trough colour.
    const r = rng(31);
    for (let i = 0; i < 26; i++) {
      const x = r() * MAT_W;
      const y = r() * MAT_H;
      const rad = 60 + r() * 160;
      const bloom = g.createRadialGradient(x, y, 0, x, y, rad);
      const crest = r() < 0.5;
      bloom.addColorStop(0, crest ? 'rgba(232,186,128,0.55)' : 'rgba(176,112,64,0.45)');
      bloom.addColorStop(1, crest ? 'rgba(232,186,128,0)' : 'rgba(176,112,64,0)');
      g.fillStyle = bloom;
      g.beginPath();
      g.ellipse(x, y, rad * 1.6, rad, r() * Math.PI, 0, Math.PI * 2);
      g.fill();
    }
    // Ripples, as wind leaves them.
    g.strokeStyle = 'rgba(150,96,52,0.18)';
    g.lineWidth = 2;
    for (let i = 0; i < 70; i++) {
      const x = r() * MAT_W;
      const y = r() * MAT_H;
      g.beginPath();
      g.moveTo(x, y);
      g.quadraticCurveTo(x + 20, y - 6, x + 44, y);
      g.stroke();
    }
    // Grain.
    for (let i = 0; i < 9000; i++) {
      g.fillStyle = `rgba(${r() < 0.5 ? '120,70,30' : '250,220,170'},${r() * 0.12})`;
      g.fillRect(r() * MAT_W, r() * MAT_H, 2, 2);
    }
    // A cloth border, stitched.
    g.strokeStyle = '#7a4a2a';
    g.lineWidth = 16;
    g.strokeRect(8, 8, MAT_W - 16, MAT_H - 16);
    g.strokeStyle = 'rgba(240,220,180,0.6)';
    g.lineWidth = 2;
    g.setLineDash([10, 8]);
    g.strokeRect(22, 22, MAT_W - 44, MAT_H - 44);
    g.setLineDash([]);
    // The road: asphalt with pale edges and a dashed middle line.
    const road = (draw: () => void): void => {
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.strokeStyle = '#c9b48c';
      g.lineWidth = 88;
      g.beginPath();
      draw();
      g.stroke();
      g.strokeStyle = '#46423f';
      g.lineWidth = 78;
      g.beginPath();
      draw();
      g.stroke();
      g.strokeStyle = '#ece4cc';
      g.lineWidth = 5;
      g.setLineDash([26, 22]);
      g.beginPath();
      draw();
      g.stroke();
      g.setLineDash([]);
    };
    road(() => g.roundRect(MAT_LOOP.x, MAT_LOOP.y, MAT_LOOP.w, MAT_LOOP.h, MAT_LOOP.r));
    road(() => {
      g.moveTo(512, MAT_LOOP.y);
      g.lineTo(512, MAT_LOOP.y + MAT_LOOP.h);
    });
    // Telegraph poles along the outside of the loop, their shadows to the lower right.
    const pole = (x: number, y: number): void => {
      g.strokeStyle = 'rgba(80,50,30,0.35)';
      g.lineWidth = 5;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + 26, y + 18);
      g.stroke();
      g.fillStyle = '#4a3324';
      g.beginPath();
      g.arc(x, y, 6, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#4a3324';
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(x - 12, y);
      g.lineTo(x + 12, y);
      g.stroke();
    };
    for (let k = 0; k < 7; k++) pole(150 + k * 120, 58);
    for (let k = 0; k < 7; k++) pole(150 + k * 120, MAT_H - 50);
    // The wires between them.
    g.strokeStyle = 'rgba(40,28,20,0.5)';
    g.lineWidth = 1.5;
    for (const y of [56, MAT_H - 52]) {
      g.beginPath();
      g.moveTo(150, y);
      for (let k = 1; k < 7; k++) g.quadraticCurveTo(150 + k * 120 - 60, y + 6, 150 + k * 120, y);
      g.stroke();
    }
    // Saguaros, seen from above-and-side as a child's mat draws them.
    const cactus = (x: number, y: number, s: number): void => {
      g.fillStyle = 'rgba(90,60,30,0.3)';
      g.beginPath();
      g.ellipse(x + 14 * s, y + 10 * s, 18 * s, 6 * s, 0.3, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#4f7a3a';
      g.strokeStyle = '#2f4a22';
      g.lineWidth = 2;
      const arm = (ax: number, ay: number, w: number, h: number): void => {
        g.beginPath();
        g.roundRect(x + ax * s, y + ay * s, w * s, h * s, (w * s) / 2);
        g.fill();
        g.stroke();
      };
      arm(-6, -44, 12, 50);
      arm(-22, -30, 10, 22);
      arm(-22, -16, 18, 8);
      arm(12, -36, 10, 20);
      arm(4, -22, 18, 8);
    };
    for (const [x, y, s] of [[300, 300, 1.2], [700, 330, 1], [640, 470, 0.8], [360, 480, 0.9], [960, 380, 1], [64, 400, 0.9]] as const) cactus(x, y, s);
    // A mesa, painted in the corner.
    g.fillStyle = '#b8683e';
    g.beginPath();
    g.moveTo(780, 250);
    g.lineTo(800, 196);
    g.lineTo(880, 192);
    g.lineTo(896, 250);
    g.closePath();
    g.fill();
    g.fillStyle = 'rgba(80,40,20,0.35)';
    g.fillRect(780, 238, 116, 12);
  });
}

/** The adventures' map: the road from stop to stop, a stop per adventure, done ones in green. */
export function adventuresMap(progress: DreamProgress): THREE.CanvasTexture {
  return canvasTexture(1024, 720, (g) => {
    g.fillStyle = '#e4d5ae';
    g.fillRect(0, 0, 1024, 720);
    const r = rng(41);
    for (let i = 0; i < 6000; i++) {
      g.fillStyle = `rgba(110,80,40,${r() * 0.06})`;
      g.fillRect(r() * 1024, r() * 720, 3, 3);
    }
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
      const x = 40 + (k / 120) * 944;
      const y = 380 + Math.sin(((x - 90) / 844) * Math.PI * 2.2) * 170;
      if (k === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
    g.font = `600 26px ${COND}`;
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
    g.font = `800 italic 44px ${COND}`;
    g.textAlign = 'left';
    g.fillStyle = 'rgba(80,50,30,0.8)';
    g.fillText('ADVENTURES', 40, 70);
  });
}

/** The quilt: faded patchwork squares. */
export function quilt(): THREE.CanvasTexture {
  const tex = canvasTexture(512, 512, (g) => {
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

/** A clock's face: minute ticks, hour bars, a name. */
export function clockFace(name: string, numerals: boolean): THREE.CanvasTexture {
  return canvasTexture(256, 256, (g) => {
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
    g.fillStyle = '#2a2018';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    if (numerals) {
      g.font = `700 26px ${COND}`;
      for (let h = 1; h <= 12; h++) {
        const a = (h / 12) * Math.PI * 2;
        g.fillText(String(h), 128 + Math.sin(a) * 74, 128 - Math.cos(a) * 74);
      }
    }
    g.font = `700 22px ${COND}`;
    g.fillText(name, 128, 168);
  });
}

/** The night sky round the house: deep blue to a pale horizon band, stars. */
export function nightSky(): THREE.CanvasTexture {
  return canvasTexture(2048, 1024, (g) => {
    const sky = g.createLinearGradient(0, 0, 0, 1024);
    sky.addColorStop(0, '#0a1230');
    sky.addColorStop(0.42, '#1f3360');
    sky.addColorStop(0.5, '#5a5878');
    sky.addColorStop(0.53, '#3a3046');
    sky.addColorStop(1, '#1a1418');
    g.fillStyle = sky;
    g.fillRect(0, 0, 2048, 1024);
    const r = rng(61);
    for (let i = 0; i < 2200; i++) {
      const y = Math.pow(r(), 1.6) * 500;
      const s = r() < 0.05 ? 2.6 : r() < 0.3 ? 1.6 : 1;
      g.fillStyle = `rgba(242,232,208,${0.25 + r() * 0.75})`;
      g.fillRect(r() * 2048, y, s, s);
    }
  });
}

/** The moon: a disc with seas, and the glow round it. */
export function moonDisc(): THREE.CanvasTexture {
  return canvasTexture(256, 256, (g) => {
    const halo = g.createRadialGradient(128, 128, 30, 128, 128, 128);
    halo.addColorStop(0, 'rgba(230,226,210,0.5)');
    halo.addColorStop(1, 'rgba(230,226,210,0)');
    g.fillStyle = halo;
    g.fillRect(0, 0, 256, 256);
    g.fillStyle = '#f4eedc';
    g.beginPath();
    g.arc(128, 128, 34, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(150,150,140,0.35)';
    for (const [x, y, s] of [[118, 118, 8], [140, 138, 6], [134, 110, 5], [112, 140, 4]] as const) {
      g.beginPath();
      g.arc(x, y, s, 0, Math.PI * 2);
      g.fill();
    }
  });
}

/** Moonlit sand outside: the opening ochre, grained and rippled, tiled. */
export function sandGround(): THREE.CanvasTexture {
  const tex = canvasTexture(512, 512, (g) => {
    g.fillStyle = '#d29459';
    g.fillRect(0, 0, 512, 512);
    const r = rng(71);
    for (let i = 0; i < 14; i++) {
      const x = r() * 512;
      const y = r() * 512;
      const rad = 40 + r() * 90;
      const bloom = g.createRadialGradient(x, y, 0, x, y, rad);
      bloom.addColorStop(0, r() < 0.5 ? 'rgba(223,170,112,0.6)' : 'rgba(180,120,70,0.5)');
      bloom.addColorStop(1, 'rgba(210,148,89,0)');
      g.fillStyle = bloom;
      g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    for (let i = 0; i < 12000; i++) {
      g.fillStyle = `rgba(${r() < 0.5 ? '120,70,30' : '250,220,170'},${r() * 0.1})`;
      g.fillRect(r() * 512, r() * 512, 2, 2);
    }
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(30, 30);
  return tex;
}

/** The asphalt across the long axis, its edges worn pale, a dashed middle line; tiles along. */
export function roadSurface(): THREE.CanvasTexture {
  const tex = canvasTexture(256, 512, (g) => {
    g.fillStyle = '#3a3734';
    g.fillRect(0, 0, 256, 512);
    const r = rng(81);
    for (let i = 0; i < 6000; i++) {
      g.fillStyle = `rgba(${r() < 0.5 ? '20,20,20' : '120,115,105'},${r() * 0.25})`;
      g.fillRect(r() * 256, r() * 512, 2, 2);
    }
    g.fillStyle = 'rgba(200,170,120,0.5)';
    g.fillRect(0, 0, 10, 512);
    g.fillRect(246, 0, 10, 512);
    g.fillStyle = '#e6dfc6';
    g.fillRect(124, 0, 8, 260);
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** The calendar's page under the photo: «LADA 1600», Avtoexport, and the year's months. */
export function calendarPage(year: number): THREE.CanvasTexture {
  return canvasTexture(512, 768, (g) => {
    g.fillStyle = '#f2ead8';
    g.fillRect(0, 0, 512, 768);
    // The photo's place (the photo is its own plane over it) and its frame.
    g.fillStyle = '#d8ccb0';
    g.fillRect(24, 24, 464, 330);
    g.fillStyle = '#b8302a';
    g.fillRect(24, 362, 464, 64);
    g.fillStyle = '#f2ead8';
    g.font = `800 italic 52px ${COND}`;
    g.textAlign = 'left';
    g.fillText('LADA 1600', 40, 414);
    g.font = `600 15px ${COND}`;
    g.textAlign = 'right';
    g.fillText('АВТОЭКСПОРТ · СССР', 476, 384);
    g.fillText('МОСКВА', 476, 404);
    // The months, three by four.
    const months = ['ЯНВАРЬ', 'ФЕВРАЛЬ', 'МАРТ', 'АПРЕЛЬ', 'МАЙ', 'ИЮНЬ', 'ИЮЛЬ', 'АВГУСТ', 'СЕНТЯБРЬ', 'ОКТЯБРЬ', 'НОЯБРЬ', 'ДЕКАБРЬ'];
    g.textAlign = 'left';
    for (let m = 0; m < 12; m++) {
      const col = m % 4;
      const row = Math.floor(m / 4);
      const x0 = 30 + col * 116;
      const y0 = 452 + row * 102;
      g.fillStyle = '#b8302a';
      g.font = `700 13px ${COND}`;
      g.fillText(months[m]!, x0, y0);
      const first = (new Date(year, m, 1).getDay() + 6) % 7;
      const days = new Date(year, m + 1, 0).getDate();
      g.font = `500 10px ${COND}`;
      for (let d = 1; d <= days; d++) {
        const cell = first + d - 1;
        const cx = x0 + (cell % 7) * 14;
        const cy = y0 + 14 + Math.floor(cell / 7) * 13;
        g.fillStyle = cell % 7 === 6 ? '#b8302a' : '#3a2a1a';
        g.fillText(String(d), cx, cy);
      }
    }
    g.fillStyle = '#3a2a1a';
    g.font = `800 28px ${COND}`;
    g.textAlign = 'center';
    g.fillText(String(year), 256, 754);
  });
}

/** The dust's soft round speck. */
export function dustSprite(): THREE.CanvasTexture {
  return canvasTexture(32, 32, (g) => {
    const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 32, 32);
  });
}
