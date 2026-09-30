/**
 * Artefact gallery (`?artifact-gallery`): the four things at the 20 km marks side by
 * side, each in a few seed variants, under the game's own Renderer and Sky so the glow
 * reads as it does on the road. A list on the right says which kind stands at which
 * mark for the seed in `?seed=` (1337 by default).
 *
 * Automation: `window.__artifactGallery.view(index)` frames one specimen (-1 for the
 * overview) and renders; `time(hours)` sets the time of day.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { prefersMobilePresentation, Renderer } from './core/renderer';
import { parseCalendarEpoch } from './game/calendar';
import { DEFAULT_INK_STRENGTH } from './game/settings';
import { DAY_LENGTH, newWorldState } from './game/state';
import { makeFlatMaterial } from './render/materials';
import { Sky } from './render/sky';
import { loadStarField } from './render/starcatalog';
import type { ChunkContext } from './world/chunks';
import { monumentsBetween, type MonumentKind } from './world/gradient';
import { buildArtifact, type ArtifactKind } from './world/props/artifacts';

const KINDS: readonly { kind: ArtifactKind; name: string }[] = [
  { kind: 'monolith', name: 'Монолит' },
  { kind: 'orbit', name: 'Орбита' },
  { kind: 'bloom', name: 'Друза' },
  { kind: 'gate', name: 'Врата' },
];
const KIND_NAMES: Record<MonumentKind, string> = {
  distance_sign: 'знак',
  monolith: 'Монолит',
  orbit: 'Орбита',
  bloom: 'Друза',
  gate: 'Врата',
};
/** Rows of seed variants per kind. */
const VARIANTS = 3;
const CELL_X = 16;
const CELL_Z = 16;
/** How far along the road the mark list runs, metres. */
const LIST_TO_S = 1_000_000;

interface Specimen {
  readonly name: string;
  readonly x: number;
  readonly z: number;
}

export async function bootArtifactGallery(): Promise<void> {
  const canvas = document.getElementById('game');
  const loading = document.getElementById('launch-loading');
  const rotateHint = document.getElementById('rotate-hint');
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error('index.html is missing #game');
  if (loading instanceof HTMLElement) loading.style.display = 'none';
  if (rotateHint instanceof HTMLElement) rotateHint.style.display = 'none';
  document.title = 'Artefact gallery · Voyage Mirage';

  const query = new URLSearchParams(window.location.search);
  const seed = Number.parseInt(query.get('seed') ?? '', 10) || 1337;
  const calendar = newWorldState(seed).calendarEpoch;

  const renderer = new Renderer(canvas, 'blessing', true, DEFAULT_INK_STRENGTH);
  const starField = await loadStarField(new Date(parseCalendarEpoch(calendar)), 'blessing', prefersMobilePresentation());
  const sky = new Sky(renderer.scene, renderer.fog, renderer.renderer, starField);
  await sky.waitForAssets();
  renderer.setViewDistance(600);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), makeFlatMaterial(0xd29459, 0.95));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  renderer.scene.add(ground);

  // The builders only read the floating origin and whether to make colliders.
  const ctx = { originX: 0, originZ: 0, hasPhysics: false } as unknown as ChunkContext;
  const specimens: Specimen[] = [];
  KINDS.forEach(({ kind, name }, column) => {
    for (let row = 0; row < VARIANTS; row++) {
      const x = (column - (KINDS.length - 1) / 2) * CELL_X;
      const z = (row - (VARIANTS - 1) / 2) * CELL_Z;
      const variantSeed = (seed ^ ((row + 1) * 0x9e3779b9)) >>> 0;
      // Heading 0 stands the gate's hole facing the overview camera.
      buildArtifact(kind, {
        ctx, group: renderer.scene as unknown as THREE.Group, bodies: [], colliders: [],
        seed: variantSeed, x, y: 0, z, heading: 0,
      });
      specimens.push({ name: `${name} · вариант ${row + 1}`, x, z });
    }
  });

  const controls = new OrbitControls(renderer.camera, canvas);
  controls.maxPolarAngle = Math.PI * 0.495;
  let hours = 11;

  const overview = (): void => {
    // Aimed right of centre so the last column clears the list panel.
    controls.target.set(7, 2, 0);
    renderer.camera.position.set(7, 26, 52);
    controls.update();
  };
  const focus = (index: number): void => {
    const s = specimens[index];
    if (!s) return overview();
    controls.target.set(s.x, 2.3, s.z);
    renderer.camera.position.set(s.x + 3, 3.2, s.z + 10);
    controls.update();
  };
  overview();

  const renderFrame = (): void => {
    controls.update();
    const cam = renderer.camera.position;
    sky.update(calendar, (hours / 24) * DAY_LENGTH, 0, 0, cam.x, cam.y, cam.z);
    renderer.setDaylight(sky.dayFactor);
    renderer.render();
  };
  const loop = (): void => {
    renderFrame();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  const showHours = buildInterface(seed, specimens, focus, overview, (h) => { hours = h; }, hours);

  (window as unknown as Record<string, unknown>)['__artifactGallery'] = {
    view(index: number): void {
      focus(index);
      renderFrame();
    },
    time(h: number): void {
      hours = h;
      showHours(h);
      renderFrame();
    },
    count: specimens.length,
    ready: true,
  };
}

function buildInterface(
  seed: number,
  specimens: readonly Specimen[],
  focus: (index: number) => void,
  overview: () => void,
  setHours: (h: number) => void,
  hours: number,
): (h: number) => void {
  const marks = monumentsBetween(seed, 0, LIST_TO_S).filter((m) => m.kind !== 'distance_sign');
  const root = document.createElement('div');
  root.className = 'artifact-gallery-ui';
  root.innerHTML = `
    <style>
      .artifact-gallery-ui { position:fixed; inset:0; z-index:40; pointer-events:none; color:#eadfca; font:13px/1.35 "Segoe UI",sans-serif; }
      .artifact-gallery-ui section, .artifact-gallery-ui nav { position:absolute; pointer-events:auto; padding:11px 13px; background:rgba(24,20,14,.86); border:1px solid rgba(234,223,202,.3); }
      .artifact-gallery-head { left:16px; top:16px; max-width:380px; }
      .artifact-gallery-title { font:bold 18px/1.1 "Segoe UI",sans-serif; letter-spacing:.04em; margin-bottom:6px; }
      .artifact-gallery-help { color:#c8bda8; }
      .artifact-gallery-list { right:14px; top:14px; bottom:14px; width:250px; overflow:auto; display:flex; flex-direction:column; gap:4px; }
      .artifact-gallery-list h3 { margin:8px 0 2px; font-size:12px; letter-spacing:.06em; color:#d7bd89; }
      .artifact-gallery-list button { border:1px solid rgba(234,223,202,.22); background:#2b251b; color:#eadfca; padding:6px 9px; text-align:left; cursor:pointer; font:12px "Segoe UI",sans-serif; }
      .artifact-gallery-list button:hover, .artifact-gallery-list button.is-active { background:#5c4930; border-color:#d7bd89; }
      .artifact-gallery-marks { font-variant-numeric:tabular-nums; color:#c8bda8; font-size:12px; white-space:nowrap; }
      .artifact-gallery-time { left:16px; bottom:16px; width:min(320px,calc(100vw - 32px)); }
      .artifact-gallery-time input { width:100%; }
      @media (max-width:760px) { .artifact-gallery-list { top:auto; height:40vh; width:calc(100vw - 28px); } .artifact-gallery-time { bottom:calc(40vh + 24px); } }
    </style>
    <section class="artifact-gallery-head">
      <div class="artifact-gallery-title">АРТЕФАКТЫ · ${specimens.length} ОБРАЗЦОВ</div>
      <div class="artifact-gallery-help">Мышь — вращать · колесо — приблизить · ПКМ — сдвиг. Колонки — виды, ряды — варианты по seed.</div>
    </section>
    <nav class="artifact-gallery-list" aria-label="Артефакты"></nav>
    <section class="artifact-gallery-time"><label>Время суток: <b class="artifact-gallery-hours"></b></label><input type="range" min="0" max="24" step="0.25" value="${hours}"></section>
  `;
  const list = root.querySelector('.artifact-gallery-list') as HTMLElement;
  const add = (label: string, onClick: () => void): void => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', () => {
      onClick();
      list.querySelectorAll('button').forEach((peer) => peer.classList.toggle('is-active', peer === button));
    });
    list.appendChild(button);
  };
  add('Общий вид', overview);
  specimens.forEach((s, i) => add(s.name, () => focus(i)));
  const heading = document.createElement('h3');
  heading.textContent = `НА ДОРОГЕ · SEED ${seed}`;
  list.appendChild(heading);
  const table = document.createElement('div');
  table.className = 'artifact-gallery-marks';
  table.innerHTML = marks.map((m) => `${Math.round(m.s / 1000)} км — ${KIND_NAMES[m.kind]}`).join('<br>');
  list.appendChild(table);

  const slider = root.querySelector('.artifact-gallery-time input') as HTMLInputElement;
  const readout = root.querySelector('.artifact-gallery-hours') as HTMLElement;
  const showHours = (): void => {
    const h = Number(slider.value);
    readout.textContent = `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;
    setHours(h);
  };
  slider.addEventListener('input', showHours);
  showHours();
  document.body.appendChild(root);
  return (h) => {
    slider.value = String(h);
    showHours();
  };
}
