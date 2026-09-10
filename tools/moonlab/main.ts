// Throwaway verification harness for the lunar disc in src/render/sky.ts.
// Renders the real Sky dome through the game's exact display transform (ACES into
// a linear render target, then a raw copy to the canvas, matching core/renderer.ts)
// for a grid of real Sun/Moon geometries, so the crescent can be inspected without
// waiting for the in-game clock. Not part of the build; delete when done.

import * as THREE from 'three';
import { Sky } from '../../src/render/sky';
import { AstronomySystem } from '../../src/render/astronomy';
import { loadStarField } from '../../src/render/starcatalog';

const EPOCH = '2026-09-01';

interface Case {
  readonly label: string;
  readonly dayIndex: number;
  readonly timeOfDay: number;
  readonly fov: number;
}

const CASES: readonly Case[] = [
  { label: 'day 10% crescent, sun 25deg (binoculars 6.5)', dayIndex: 7, timeOfDay: 460, fov: 6.5 },
  { label: 'day 26% crescent, sun 67deg (binoculars 6.5)', dayIndex: 5, timeOfDay: 680, fov: 6.5 },
  { label: 'day 30% crescent, sun 35deg (naked eye 65)', dayIndex: 15, timeOfDay: 920, fov: 65 },
  { label: 'day 49% quarter, sun 59deg (binoculars 6.5)', dayIndex: 3, timeOfDay: 620, fov: 6.5 },
  { label: 'night 11% crescent, sun -18deg (binoculars 6.5)', dayIndex: 7, timeOfDay: 260, fov: 6.5 },
  { label: 'night full moon, sun -49deg (binoculars 6.5)', dayIndex: 25, timeOfDay: 120, fov: 6.5 },
];

// ?only=N renders one case across the whole canvas; ?fov= overrides its field.
const params = new URLSearchParams(location.search);
const only = params.get('only');
const fovOverride = params.get('fov');
const SELECTED = only === null ? CASES : [CASES[Number(only)]];
const COLUMNS = only === null ? 3 : 1;
const CELL_W = only === null ? 400 : 1200;
const CELL_H = only === null ? 450 : 900;

const canvas = document.getElementById('c') as HTMLCanvasElement;
const wrap = document.getElementById('wrap') as HTMLDivElement;

// preserveDrawingBuffer so toDataURL still sees the frame after a compositor pass.
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(canvas.width, canvas.height, false);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.autoClear = false;

const target = new THREE.WebGLRenderTarget(CELL_W, CELL_H, {
  samples: 4,
  type: THREE.HalfFloatType,
});

const copyMaterial = new THREE.ShaderMaterial({
  uniforms: { tDiffuse: { value: target.texture } },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }
  `,
  // No colorspace include, exactly like HAZE_FRAGMENT: the frame reaches the
  // display linear-encoded, which is what the sky palette is authored against.
  fragmentShader: `
    uniform sampler2D tDiffuse;
    varying vec2 vUv;
    void main() { gl_FragColor = texture2D(tDiffuse, vUv); }
  `,
  depthTest: false,
  depthWrite: false,
});
const copyScene = new THREE.Scene();
copyScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), copyMaterial));
const copyCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

const scene = new THREE.Scene();
const fog = new THREE.FogExp2(0x000000, 0.00035);
scene.fog = fog;
const starField = await loadStarField(new Date(Date.parse(`${EPOCH}T00:00:00Z`)));
const sky = new Sky(scene, fog, renderer, starField);
const astronomy = new AstronomySystem();
// Sky loads /data/moon.jpg asynchronously and does not expose it. Warm the HTTP
// cache, then wait: rendering before the map lands samples a black texture, and
// lunar albedo is now the disc's only colour source. Timers rather than
// requestAnimationFrame, which a background tab never fires.
await new THREE.TextureLoader().loadAsync('/data/moon.jpg');
const warm = Promise.withResolvers<void>();
setTimeout(() => warm.resolve(), 1500);
await warm.promise;
const camera = new THREE.PerspectiveCamera(65, CELL_W / CELL_H, 0.1, 20_000);

for (const [index, item] of SELECTED.entries()) {
  const frame = astronomy.update(EPOCH, item.dayIndex, item.timeOfDay);
  const moon = frame.moon.direction.clone();
  camera.fov = fovOverride === null ? item.fov : Number(fovOverride);
  camera.position.set(0, 0, 0);
  camera.up.set(0, 1, 0);
  // allowEnvironmentRefresh: true so the first case bakes the PMREM probe, which is
  // the only path that compiles SKY_FRAGMENT_LINEAR.
  sky.update(EPOCH, item.timeOfDay, item.dayIndex, 0, 0, 0, 0, true);
  camera.lookAt(moon.x * 100, moon.y * 100, moon.z * 100);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();

  renderer.setRenderTarget(target);
  renderer.clear();
  renderer.render(scene, camera);
  renderer.setRenderTarget(null);

  const column = index % COLUMNS;
  const row = Math.floor(index / COLUMNS);
  const x = column * CELL_W;
  const y = canvas.height - (row + 1) * CELL_H;
  renderer.setViewport(x, y, CELL_W, CELL_H);
  renderer.setScissor(x, y, CELL_W, CELL_H);
  renderer.setScissorTest(true);
  renderer.render(copyScene, copyCamera);
  renderer.setScissorTest(false);

  const litFraction = 0.5 - 0.5 * frame.sun.direction.dot(frame.moon.direction);
  const label = document.createElement('div');
  label.className = 'label';
  label.style.left = `${x + 3}px`;
  label.style.top = `${row * CELL_H + 3}px`;
  label.textContent =
    `${item.label} | sun ${frame.sun.altitudeDeg.toFixed(0)}deg ` +
    `moon ${frame.moon.altitudeDeg.toFixed(0)}deg lit ${(litFraction * 100).toFixed(0)}%`;
  wrap.appendChild(label);
}

(window as unknown as { moonlabReady: boolean }).moonlabReady = true;
