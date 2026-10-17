import * as THREE from 'three';
import { primeMaxAnisotropy } from './render/texturequality';
import { makeFlatMaterial } from './render/materials';
import { createPoiVariant, mergePoiStatics, poiVariantIndex } from './world/poi-variants';
import { createStructureInstance, POI_STRUCTURES } from './world/poistructures';
import { createVariantInstance } from './world/poivariantbuild';
import { dwellingGlassMaterial } from './world/dwellings/builder';
import { TOILET_VARIANTS } from './world/toilets/catalog';
import { ToiletMirror } from './world/toilets/mirror';
import { ToiletRig, type ToiletLampMode } from './world/toilets/rig';
import {
  completeToilet,
  decodeToiletProgress,
  encodeToiletProgress,
  newToiletProgress,
  withToiletState,
  type ToiletCompletion,
  type ToiletProgress,
  type ToiletSaveRecord,
} from './world/toilets/state';
import {
  TOILET_STATES,
  type ToiletEmotion,
  type ToiletFixtureKind,
  type ToiletState,
  type ToiletVariant,
  type ToiletVerb,
} from './world/toilets/types';

/**
 * What the gallery shows: exactly the buildings the world scatters, in the order the
 * world numbers them (world/poistructures.ts), then the Japanese toilets
 * (world/toilets), which the world does not place yet. Masts are built from the kit;
 * dwellings are the very instances the world places; toilets are the cached instances
 * of their merged shells (world/poivariantbuild.ts) with a `ToiletRig` over each.
 *
 * `?type=world` lists only the world's buildings, `?type=toilet` only the toilets.
 *
 * Automation: `window.__poiGallery` (see `PoiGalleryApi`) focuses entries, sets the time
 * of day, and inspects, poses, resets, completes, snapshots and restores the toilets.
 */
type GalleryType = 'world' | 'toilet';

interface GallerySource {
  readonly id: string;
  readonly type: GalleryType;
  readonly name: string;
  /** Second line in the list: who built this, where and when. */
  readonly note: string;
  readonly build: () => THREE.Group;
  readonly toilet: ToiletVariant | null;
}

const SOURCES: readonly GallerySource[] = [
  ...POI_STRUCTURES.map((structure, index): GallerySource => ({
    id: structure.id,
    type: 'world',
    name: structure.name,
    note: structure.note,
    build:
      structure.kind === 'mast'
        ? () => {
            const root = createPoiVariant(poiVariantIndex(structure.id));
            mergePoiStatics(root);
            return root;
          }
        : () => createStructureInstance(index).group,
    toilet: null,
  })),
  ...TOILET_VARIANTS.map((variant): GallerySource => ({
    id: variant.id,
    type: 'toilet',
    name: variant.name,
    note: variant.note,
    build: () => createVariantInstance(poiVariantIndex(variant.id)).group,
    toilet: variant,
  })),
];

const GRID_COLUMNS = 8;
const CELL_X = 38;
const CELL_Z = 32;
const WALK_SPEED = 8;
const FAST_SPEED = 24;
const EYE_HEIGHT = 1.75;
/**
 * Frame height, lines: the game's Low rung on a desktop (game/settings.ts), width from
 * the window. Interiors are fill-rate bound (48 ms a frame at 1600x900, 17 at half of
 * it), and 720 lines holds the 30 Hz a prototype walkthrough wants.
 */
const RENDER_HEIGHT = 720;
/** The toilet mirror goes live for the cabin whose centre is nearest, within this, metres. */
const MIRROR_RANGE = 6;
/** A toilet's face follows the viewer within this, metres. */
const FACE_RANGE = 14;
const DAY_HOURS = 11;
const NIGHT_HOURS = 22;
const DAY_SKY = new THREE.Color(0x9eb3bd);
const NIGHT_SKY = new THREE.Color(0x101624);
const DAY_FOG = new THREE.Color(0xb8ad93);
const NIGHT_FOG = new THREE.Color(0x141820);

const STATE_LABELS: Readonly<Record<ToiletState, string>> = {
  arrived: 'Прибытие',
  inspected: 'Осмотр',
  repairing: 'Ремонт',
  cleaning: 'Уборка',
  testing: 'Проверка',
  healthy: 'Исправен',
};

/** A toilet in the gallery: its rig over the merged shell, and its progress. */
interface ToiletLab {
  readonly variant: ToiletVariant;
  rig: ToiletRig;
  progress: ToiletProgress;
}

interface GalleryEntry {
  readonly id: string;
  readonly name: string;
  readonly note: string;
  readonly root: THREE.Group;
  /** How far in front of it the focus view stands, from its measured bounds. */
  readonly viewDistance: number;
  readonly x: number;
  readonly z: number;
  readonly toilet: ToiletLab | null;
}

type ToiletEntry = GalleryEntry & { readonly toilet: ToiletLab };

/** One toilet as `PoiGalleryApi.inspect` reports it. */
export interface ToiletInspection {
  readonly id: string;
  readonly name: string;
  readonly scenario: string;
  readonly state: ToiletState;
  readonly completion: ToiletCompletion | null;
  /** Fixture channels, 0..1: what 1 means is in world/toilets/fixtures.ts. */
  readonly fixtures: Readonly<Record<string, number>>;
  readonly lamp: ToiletLampMode;
  readonly lampIntensity: number;
  readonly emotion: ToiletEmotion | null;
  /** Whether this cabin's mirror is the live one. */
  readonly mirrorLive: boolean;
}

/** What `window.__poiGallery` exposes. */
export interface PoiGalleryApi {
  /** Every listed entry's id, in grid order. */
  readonly ids: readonly string[];
  /** The listed toilets' ids. */
  readonly toilets: readonly string[];
  focus(id: string): void;
  overview(): void;
  roofs(visible: boolean): void;
  /** Time of day, hours: the sun and sky fade out at night, the toilet lamps do not. */
  setTime(hours: number): void;
  inspect(id: string): ToiletInspection;
  /** Poses a toilet for a progress state, landing every fixture at once. */
  state(id: string, state: ToiletState): void;
  /** Back to how the player first finds it, completion forgotten. */
  reset(id: string): void;
  /** Healthy and counted, as finishing its scenario will do. */
  complete(id: string): void;
  /** One verb on one fixture (its toggle with none); false if it does not apply. Eases. */
  activate(id: string, fixture: ToiletFixtureKind, verb?: ToiletVerb): boolean;
  /** Overrides the face's emotion until the next state change; throws for a faceless toilet. */
  emotion(id: string, emotion: ToiletEmotion): void;
  /** Every listed toilet's progress as save records. */
  snapshot(): ToiletSaveRecord[];
  /**
   * Rebuilds each recorded toilet's rig from the catalogue and applies the record, as a
   * placed POI will be after streaming in.
   */
  restore(records: readonly unknown[]): void;
  /** Mirror renders and linked programs so far, for the bounded-mirror and no-compile checks. */
  stats(): { readonly mirrorRenders: number; readonly programs: number };
  /** Lands every animation, renders a frame now and returns the canvas as a PNG data URL. */
  capture(): string;
}

/**
 * A sky-gradient environment. Window glass is the car tint, an opaque sky mirror
 * that the game's sky probe feeds; without an environment here it would render as
 * flat dark paint and the gallery would misrepresent every window.
 */
function skyEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const scene = new THREE.Scene();
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    vertexShader: /* glsl */ `
      varying vec3 vDirection;
      void main() {
        vDirection = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vDirection;
      void main() {
        float h = vDirection.y;
        vec3 zenith = vec3(0.2, 0.38, 0.7);
        vec3 horizon = vec3(0.82, 0.8, 0.74);
        vec3 ground = vec3(0.42, 0.33, 0.22);
        vec3 colour = h > 0.0 ? mix(horizon, zenith, pow(h, 0.55)) : mix(horizon, ground, pow(-h, 0.4));
        gl_FragColor = vec4(colour, 1.0);
      }`,
  });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), material));
  const pmrem = new THREE.PMREMGenerator(renderer);
  const texture = pmrem.fromScene(scene, 0).texture;
  pmrem.dispose();
  material.dispose();
  return texture;
}

function makeLabel(index: number, name: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 192;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D is required for POI labels');
  context.fillStyle = 'rgba(24, 20, 14, 0.9)';
  context.strokeStyle = '#d8c69e';
  context.lineWidth = 7;
  context.beginPath();
  context.roundRect(8, 8, 496, 176, 18);
  context.fill();
  context.stroke();
  context.fillStyle = '#f0dfb8';
  context.font = 'bold 72px Segoe UI, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(String(index + 1).padStart(2, '0'), 72, 96);
  context.font = 'bold 29px Segoe UI, sans-serif';
  context.textAlign = 'left';
  const shortened = name.length > 25 ? `${name.slice(0, 24)}…` : name;
  context.fillText(shortened, 132, 96);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  // Depth-tested: at eye level among low houses, every far label drawn on top of
  // the house in front of you hid the facade being inspected.
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true }));
  sprite.scale.set(10.7, 4.0, 1);
  sprite.renderOrder = 20;
  return sprite;
}

function createInterface(
  entries: readonly GalleryEntry[],
  focus: (index: number) => void,
  overview: () => void,
  toggleRoofs: () => boolean,
  toggleNight: () => boolean,
): HTMLElement {
  const root = document.createElement('div');
  root.className = 'poi-gallery-ui';
  root.innerHTML = `
    <style>
      .poi-gallery-ui { position:fixed; inset:0; z-index:40; pointer-events:none; color:#eadfca; font:13px/1.35 "Segoe UI",sans-serif; }
      .poi-gallery-head { position:absolute; left:18px; top:18px; max-width:440px; padding:13px 15px; background:rgba(24,20,14,.88); border:1px solid rgba(234,223,202,.34); box-shadow:0 6px 22px rgba(0,0,0,.32); }
      .poi-gallery-title { font:bold 19px/1.1 "Segoe UI",sans-serif; letter-spacing:.04em; margin-bottom:7px; }
      .poi-gallery-help { color:#c8bda8; }
      .poi-gallery-list { position:absolute; right:14px; top:14px; bottom:14px; width:270px; display:flex; flex-direction:column; gap:5px; overflow:auto; padding:10px; pointer-events:auto; background:rgba(20,17,12,.86); border:1px solid rgba(234,223,202,.28); }
      .poi-gallery-list button, .poi-gallery-actions button, .poi-toilet-panel button { min-height:31px; border:1px solid rgba(234,223,202,.24); background:#2b251b; color:#eadfca; padding:6px 9px; text-align:left; cursor:pointer; font:12px "Segoe UI",sans-serif; }
      .poi-gallery-list button:hover, .poi-gallery-list button.is-active, .poi-gallery-actions button:hover, .poi-toilet-panel button:hover, .poi-toilet-panel button.is-active { background:#5c4930; border-color:#d7bd89; }
      .poi-gallery-list b { display:inline-block; width:25px; color:#d7bd89; }
      .poi-gallery-list small { display:block; margin-left:25px; color:#a99d86; font-size:11px; }
      .poi-gallery-actions { position:absolute; left:18px; bottom:18px; display:flex; gap:7px; pointer-events:auto; }
      .poi-gallery-actions button { text-align:center; padding:8px 13px; }
      .poi-gallery-status { position:absolute; left:50%; bottom:18px; transform:translateX(-50%); padding:8px 12px; background:rgba(20,17,12,.8); color:#d7bd89; }
      .poi-gallery-crosshair { position:absolute; left:50%; top:50%; width:12px; height:12px; transform:translate(-50%,-50%); opacity:.72; }
      .poi-gallery-crosshair::before, .poi-gallery-crosshair::after { content:\"\"; position:absolute; background:#f0dfb8; box-shadow:0 0 3px #1b160f; }
      .poi-gallery-crosshair::before { left:5px; top:0; width:2px; height:12px; }
      .poi-gallery-crosshair::after { left:0; top:5px; width:12px; height:2px; }
      .poi-toilet-panel { position:absolute; left:18px; top:150px; width:320px; padding:11px 13px; pointer-events:auto; background:rgba(24,20,14,.88); border:1px solid rgba(234,223,202,.34); }
      .poi-toilet-panel[hidden] { display:none; }
      .poi-toilet-title { font:bold 15px "Segoe UI",sans-serif; margin-bottom:4px; }
      .poi-toilet-info { color:#c8bda8; margin-bottom:8px; }
      .poi-toilet-row { display:flex; flex-wrap:wrap; gap:5px; margin-bottom:7px; }
      .poi-toilet-row button { text-align:center; min-height:27px; padding:4px 8px; }
      @media (max-width:900px) { .poi-gallery-list { width:220px; } .poi-gallery-head { max-width:360px; } }
    </style>
    <section class="poi-gallery-head">
      <div class="poi-gallery-title">ГАЛЕРЕЯ POI · ${entries.length} ВАРИАНТОВ</div>
      <div class="poi-gallery-help">Клик по сцене — захват мыши · ЛКМ по выключателю — свет · WASD — движение · Q/E или Ctrl/Space — вниз/вверх · Shift — ускорение · H — снять крыши · N — день/ночь · R — общий вид · Esc — отпустить мышь</div>
    </section>
    <nav class="poi-gallery-list" aria-label="Варианты POI"></nav>
    <div class="poi-gallery-actions">
      <button type="button" data-action="overview">Общий вид (R)</button>
      <button type="button" data-action="roofs">Снять крыши (H)</button>
      <button type="button" data-action="night">Ночь (N)</button>
      <button type="button" data-action="game">Вернуться в игру</button>
    </div>
    <div class="poi-gallery-status">Общий вид · крыши включены</div>
    <div class="poi-gallery-crosshair" aria-hidden="true"></div>
  `;
  const list = root.querySelector('.poi-gallery-list');
  const status = root.querySelector('.poi-gallery-status');
  const roofButton = root.querySelector<HTMLButtonElement>('[data-action="roofs"]');
  const nightButton = root.querySelector<HTMLButtonElement>('[data-action="night"]');
  if (!(list instanceof HTMLElement) || !(status instanceof HTMLElement) || !roofButton || !nightButton) throw new Error('POI gallery UI failed to build');

  entries.forEach((entry, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.index = String(index);
    button.innerHTML = `<b>${String(index + 1).padStart(2, '0')}</b>${entry.name}<small>${entry.note}</small>`;
    button.addEventListener('click', () => {
      focus(index);
      list.querySelectorAll('button').forEach((peer) => peer.classList.toggle('is-active', peer === button));
      status.textContent = `${String(index + 1).padStart(2, '0')} · ${entry.name} · ${entry.note}`;
    });
    list.appendChild(button);
  });

  root.querySelector('[data-action="overview"]')?.addEventListener('click', () => {
    overview();
    list.querySelectorAll('button').forEach((peer) => peer.classList.remove('is-active'));
    status.textContent = 'Общий вид';
  });
  roofButton.addEventListener('click', () => {
    const visible = toggleRoofs();
    roofButton.textContent = visible ? 'Снять крыши (H)' : 'Вернуть крыши (H)';
    status.textContent = visible ? 'Крыши включены' : 'Крыши сняты — видны комнаты и мебель';
  });
  nightButton.addEventListener('click', () => {
    const night = toggleNight();
    nightButton.textContent = night ? 'День (N)' : 'Ночь (N)';
  });
  root.querySelector('[data-action="game"]')?.addEventListener('click', () => {
    window.location.href = window.location.pathname;
  });
  document.body.appendChild(root);
  return root;
}

/**
 * The focused toilet's controls: its progress states, reset and complete, and one
 * button per fixture. Shown only while a toilet is focused.
 */
function createToiletPanel(parent: HTMLElement, api: PoiGalleryApi): { show(entry: GalleryEntry | null): void; refresh(): void } {
  const panel = document.createElement('section');
  panel.className = 'poi-toilet-panel';
  panel.hidden = true;
  panel.innerHTML = `
    <div class="poi-toilet-title"></div>
    <div class="poi-toilet-info"></div>
    <div class="poi-toilet-row" data-row="states"></div>
    <div class="poi-toilet-row" data-row="fixtures"></div>
    <div class="poi-toilet-row">
      <button type="button" data-toilet="reset">Сбросить</button>
      <button type="button" data-toilet="complete">Завершить</button>
    </div>
  `;
  parent.appendChild(panel);
  const title = panel.querySelector('.poi-toilet-title');
  const info = panel.querySelector('.poi-toilet-info');
  const states = panel.querySelector('[data-row="states"]');
  const fixtures = panel.querySelector('[data-row="fixtures"]');
  if (!(title instanceof HTMLElement) || !(info instanceof HTMLElement) || !(states instanceof HTMLElement) || !(fixtures instanceof HTMLElement)) {
    throw new Error('Toilet panel failed to build');
  }
  let shown: GalleryEntry | null = null;

  const refresh = (): void => {
    if (!shown?.toilet) return;
    const inspection = api.inspect(shown.id);
    const done = inspection.completion ? ` · завершён ×${inspection.completion.count}` : '';
    info.textContent = `${STATE_LABELS[inspection.state]}${done} · лампа: ${inspection.lamp}${inspection.emotion ? ` · лицо: ${inspection.emotion}` : ''}`;
    states.querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
      button.classList.toggle('is-active', button.dataset.state === inspection.state);
    });
  };

  panel.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest('button');
    if (!button || !shown?.toilet) return;
    const { state, fixture, toilet } = button.dataset;
    if (state) api.state(shown.id, state as ToiletState);
    else if (fixture) api.activate(shown.id, fixture as ToiletFixtureKind);
    else if (toilet === 'reset') api.reset(shown.id);
    else if (toilet === 'complete') api.complete(shown.id);
    refresh();
  });

  return {
    show(entry) {
      shown = entry?.toilet ? entry : null;
      panel.hidden = shown === null;
      const lab = shown?.toilet;
      if (!shown || !lab) return;
      title.textContent = `${shown.name} · ${lab.variant.note}`;
      states.innerHTML = TOILET_STATES.map((state) => `<button type="button" data-state="${state}">${STATE_LABELS[state]}</button>`).join('');
      fixtures.innerHTML = lab.rig.variant.fixtures
        .map((kind) => `<button type="button" data-fixture="${kind}">${lab.rig.fixture(kind)?.control.label ?? kind}</button>`)
        .join('');
      refresh();
    },
    refresh,
  };
}

export function bootPoiGallery(): void {
  const canvas = document.getElementById('game');
  const loading = document.getElementById('launch-loading');
  const rotateHint = document.getElementById('rotate-hint');
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error('index.html is missing #game');
  if (loading instanceof HTMLElement) loading.style.display = 'none';
  if (rotateHint instanceof HTMLElement) rotateHint.style.display = 'none';
  document.title = 'POI gallery · Voyage Mirage';

  const type = new URLSearchParams(window.location.search).get('type');
  if (type !== null && type !== 'world' && type !== 'toilet') throw new Error(`Unknown POI gallery type "${type}": world or toilet`);
  const sources = type === null ? SOURCES : SOURCES.filter((source) => source.type === type);
  const gridRows = Math.ceil(sources.length / GRID_COLUMNS);
  const overviewY = Math.max(72, gridRows * 18);
  const overviewZ = Math.max(120, gridRows * 27);

  // Same framebuffer policy as the game's 'acceptable' tier: no multisampled
  // backbuffer (an N100 iGPU pays MSAA bandwidth on every one of these pixels) and
  // a hard pixel budget, because this viewer is fill-rate bound, not geometry bound.
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  primeMaxAnisotropy(renderer);
  renderer.setPixelRatio(RENDER_HEIGHT / window.innerHeight);
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  // The grid, the sun and the prototypes never move, and the room spots do not
  // cast, so the shadow map is rendered once instead of re-rasterising all 3.9k
  // casters every frame (measured 3871 extra draw calls, ~16 ms on an N100 iGPU).
  // Only the roof toggle, the time of day and a toilet fixture in motion change it;
  // they re-arm needsUpdate.
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;

  const scene = new THREE.Scene();
  const sky = DAY_SKY.clone();
  scene.background = sky;
  // Thin enough that the far rows of a 53-cell grid still read from the overview.
  const fog = new THREE.FogExp2(DAY_FOG.getHex(), 0.0024);
  scene.fog = fog;
  // On the glass only: the rest of the gallery is balanced for its two lights, and
  // a scene-wide probe on top of them washed every wall out.
  dwellingGlassMaterial().envMap = skyEnvironment(renderer);

  const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.08, 700);
  camera.rotation.order = 'YXZ';
  camera.position.set(0, overviewY, overviewZ);
  camera.lookAt(0, 4, 0);

  const hemisphere = new THREE.HemisphereLight(0xe4eff5, 0x6b5133, 2.45);
  scene.add(hemisphere);
  const sun = new THREE.DirectionalLight(0xffe0b1, 2.8);
  sun.position.set(-55, 85, -38);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.camera.left = -180;
  sun.shadow.camera.right = 180;
  sun.shadow.camera.top = 180;
  sun.shadow.camera.bottom = -180;
  sun.shadow.camera.near = 5;
  sun.shadow.camera.far = 300;
  sun.shadow.bias = -0.00008;
  sun.shadow.normalBias = 0.035;
  sun.shadow.radius = 4;
  scene.add(sun);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(GRID_COLUMNS * CELL_X + 22, gridRows * CELL_Z + 20), makeFlatMaterial(0xb99866, 1));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.02;
  ground.receiveShadow = true;
  scene.add(ground);

  const entries: GalleryEntry[] = [];
  sources.forEach((source, index) => {
    const column = index % GRID_COLUMNS;
    const row = Math.floor(index / GRID_COLUMNS);
    const x = (column - (GRID_COLUMNS - 1) / 2) * CELL_X;
    const z = (row - (gridRows - 1) / 2) * CELL_Z;
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(34, 27), makeFlatMaterial((row + column) % 2 === 0 ? 0xaa895b : 0xb28f60, 1));
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(x, 0.005, z);
    pad.receiveShadow = true;
    scene.add(pad);

    const root = source.build();
    root.position.set(x, 0.02, z);
    scene.add(root);
    let toilet: ToiletLab | null = null;
    if (source.toilet) {
      const rig = new ToiletRig(source.toilet);
      root.add(rig.root);
      const progress = newToiletProgress(source.toilet);
      rig.pose(progress);
      rig.update(0, true);
      toilet = { variant: source.toilet, rig, progress };
    }
    const bounds = new THREE.Box3().setFromObject(root);
    const label = makeLabel(index, source.name);
    label.position.set(x, Math.max(4.8, bounds.max.y + 2.4), z);
    scene.add(label);
    const size = bounds.getSize(new THREE.Vector3());
    const viewDistance = size.z / 2 + Math.max(6, size.x * 0.8, size.y * 1.5);
    entries.push({ id: source.id, name: source.name, note: source.note, root, viewDistance, x, z, toilet });
  });
  const toiletEntries = entries.filter((entry): entry is ToiletEntry => entry.toilet !== null);

  for (let column = 0; column <= GRID_COLUMNS; column++) {
    const x = (column - GRID_COLUMNS / 2) * CELL_X;
    const divider = new THREE.Mesh(new THREE.PlaneGeometry(0.12, gridRows * CELL_Z), makeFlatMaterial(0x876b48, 1));
    divider.rotation.x = -Math.PI / 2;
    divider.position.set(x, 0.025, 0);
    scene.add(divider);
  }
  for (let row = 0; row <= gridRows; row++) {
    const z = (row - gridRows / 2) * CELL_Z;
    const divider = new THREE.Mesh(new THREE.PlaneGeometry(GRID_COLUMNS * CELL_X, 0.12), makeFlatMaterial(0x876b48, 1));
    divider.rotation.x = -Math.PI / 2;
    divider.position.set(0, 0.025, z);
    scene.add(divider);
  }

  let yaw = camera.rotation.y;
  let pitch = camera.rotation.x;
  let roofsVisible = true;
  let timeHours = DAY_HOURS;
  const keys = new Set<string>();
  const mirror = new ToiletMirror();

  const applyLook = (): void => {
    camera.rotation.set(pitch, yaw, 0);
  };
  const overview = (): void => {
    camera.position.set(0, overviewY, overviewZ);
    camera.lookAt(0, 4, 0);
    yaw = camera.rotation.y;
    pitch = camera.rotation.x;
  };
  const focus = (index: number): void => {
    const entry = entries[index];
    if (!entry) return;
    camera.position.set(entry.x, EYE_HEIGHT, entry.z - entry.viewDistance);
    yaw = Math.PI;
    pitch = 0.06;
    applyLook();
  };
  const setRoofs = (visible: boolean): void => {
    roofsVisible = visible;
    scene.traverse((object) => {
      if (object.userData.poiRoof === true) object.visible = roofsVisible;
    });
    renderer.shadowMap.needsUpdate = true;
  };
  /** Sun and sky by the hour: full day from mid-morning, dark from an hour after dusk. */
  const setTime = (hours: number): void => {
    timeHours = ((hours % 24) + 24) % 24;
    const elevation = Math.sin(((timeHours - 6) / 12) * Math.PI);
    const day = THREE.MathUtils.smoothstep(elevation, -0.12, 0.25);
    sun.intensity = 2.8 * day;
    hemisphere.intensity = 2.45 * (0.06 + 0.94 * day);
    sky.lerpColors(NIGHT_SKY, DAY_SKY, day);
    fog.color.lerpColors(NIGHT_FOG, DAY_FOG, day);
    renderer.shadowMap.needsUpdate = true;
  };

  const toiletEntry = (id: string): ToiletEntry => {
    const entry = toiletEntries.find((candidate) => candidate.id === id);
    if (!entry) throw new Error(`No toilet "${id}" in this gallery`);
    return entry;
  };
  /** Poses a toilet for its progress and lands it there, with fresh shadows. */
  const settle = (lab: ToiletLab): void => {
    lab.rig.pose(lab.progress);
    lab.rig.update(0, true);
    renderer.shadowMap.needsUpdate = true;
  };

  const api: PoiGalleryApi = {
    ids: entries.map((entry) => entry.id),
    toilets: toiletEntries.map((entry) => entry.id),
    focus(id) {
      const index = entries.findIndex((entry) => entry.id === id);
      if (index < 0) throw new Error(`No entry "${id}" in this gallery`);
      focusEntry(index);
    },
    overview() {
      overview();
      panel.show(null);
    },
    roofs(visible) {
      setRoofs(visible);
    },
    setTime,
    inspect(id) {
      const { toilet, name } = toiletEntry(id);
      return {
        id,
        name,
        scenario: toilet.progress.scenarioId,
        state: toilet.progress.state,
        completion: toilet.progress.completion,
        fixtures: toilet.rig.fixtureValues(),
        lamp: toilet.rig.lamp,
        lampIntensity: toilet.rig.light.intensity,
        emotion: toilet.rig.face?.current ?? null,
        mirrorLive: mirror.face === toilet.rig.mirrorFace,
      };
    },
    state(id, state) {
      if (!TOILET_STATES.includes(state)) throw new Error(`Unknown toilet state "${state}"`);
      const { toilet } = toiletEntry(id);
      toilet.progress = withToiletState(toilet.progress, state);
      settle(toilet);
    },
    reset(id) {
      const { toilet } = toiletEntry(id);
      toilet.progress = newToiletProgress(toilet.variant);
      settle(toilet);
    },
    complete(id) {
      const { toilet } = toiletEntry(id);
      toilet.progress = completeToilet(toilet.progress, null);
      settle(toilet);
    },
    activate(id, fixture, verb) {
      return toiletEntry(id).toilet.rig.activate(fixture, verb);
    },
    emotion(id, emotion) {
      const { toilet } = toiletEntry(id);
      if (!toilet.rig.face) throw new Error(`Toilet "${id}" has no face`);
      toilet.rig.face.setEmotion(emotion);
      toilet.rig.face.update(0, true);
    },
    snapshot() {
      return toiletEntries.map((entry) => encodeToiletProgress(entry.toilet.progress));
    },
    restore(records) {
      for (const raw of records) {
        const progress = decodeToiletProgress(raw);
        const entry = toiletEntry(progress.variantId);
        const lab = entry.toilet;
        if (mirror.face === lab.rig.mirrorFace) mirror.show(null);
        lab.rig.dispose();
        lab.rig = new ToiletRig(lab.variant);
        entry.root.add(lab.rig.root);
        lab.progress = progress;
        settle(lab);
      }
      panel.refresh();
    },
    stats() {
      return { mirrorRenders: mirror.stats.renders, programs: renderer.info.programs?.length ?? 0 };
    },
    capture() {
      for (const entry of toiletEntries) entry.toilet.rig.update(0, true);
      renderer.shadowMap.needsUpdate = true;
      drawFrame();
      return canvas.toDataURL('image/png');
    },
  };

  const toggleNight = (): boolean => {
    setTime(timeHours === NIGHT_HOURS ? DAY_HOURS : NIGHT_HOURS);
    return timeHours === NIGHT_HOURS;
  };
  const interfaceRoot = createInterface(entries, (index) => focusEntry(index), () => api.overview(), () => {
    setRoofs(!roofsVisible);
    return roofsVisible;
  }, toggleNight);
  const panel = createToiletPanel(interfaceRoot, api);
  function focusEntry(index: number): void {
    focus(index);
    panel.show(entries[index] ?? null);
  }
  Object.assign(window, { __poiGallery: api });

  canvas.addEventListener('click', () => {
    if (document.pointerLockElement !== canvas) void canvas.requestPointerLock();
  });
  window.addEventListener('mousemove', (event) => {
    if (document.pointerLockElement !== canvas) return;
    yaw -= event.movementX * 0.0022;
    pitch = Math.max(-Math.PI * 0.48, Math.min(Math.PI * 0.48, pitch - event.movementY * 0.0022));
    applyLook();
  });
  window.addEventListener('keydown', (event) => {
    keys.add(event.code);
    if (event.repeat) return;
    if (event.code === 'KeyR') api.overview();
    if (event.code === 'KeyH') {
      setRoofs(!roofsVisible);
      const roofButton = interfaceRoot.querySelector<HTMLButtonElement>('[data-action="roofs"]');
      if (roofButton) roofButton.textContent = roofsVisible ? 'Снять крыши (H)' : 'Вернуть крыши (H)';
    }
    if (event.code === 'KeyN') {
      const night = toggleNight();
      const nightButton = interfaceRoot.querySelector<HTMLButtonElement>('[data-action="night"]');
      if (nightButton) nightButton.textContent = night ? 'День (N)' : 'Ночь (N)';
    }
  });
  window.addEventListener('keyup', (event) => keys.delete(event.code));
  window.addEventListener('blur', () => keys.clear());
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(RENDER_HEIGHT / window.innerHeight);
    renderer.setSize(window.innerWidth, window.innerHeight, false);
  });

  /** The live mirror for the nearest cabin, then the frame. */
  const drawFrame = (): void => {
    let nearest: ToiletLab | null = null;
    let best = MIRROR_RANGE * MIRROR_RANGE;
    for (const entry of toiletEntries) {
      const distance = (camera.position.x - entry.x) ** 2 + (camera.position.z - entry.z) ** 2;
      if (distance < best) {
        best = distance;
        nearest = entry.toilet;
      }
      entry.toilet.rig.face?.lookAt(distance < FACE_RANGE * FACE_RANGE ? camera.position : null);
    }
    mirror.show(nearest?.rig.mirrorFace ?? null);
    camera.updateMatrixWorld();
    mirror.draw(renderer, scene, camera);
    renderer.render(scene, camera);
  };

  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  const movement = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  let previous = performance.now();
  const render = (now: number): void => {
    const delta = Math.min(0.05, (now - previous) / 1000);
    previous = now;
    camera.getWorldDirection(forward);
    forward.y = 0;
    if (forward.lengthSq() > 0.001) forward.normalize();
    right.crossVectors(forward, up).normalize();
    movement.set(0, 0, 0);
    if (keys.has('KeyW')) movement.add(forward);
    if (keys.has('KeyS')) movement.sub(forward);
    if (keys.has('KeyD')) movement.add(right);
    if (keys.has('KeyA')) movement.sub(right);
    if (keys.has('KeyE') || keys.has('Space')) movement.y += 1;
    if (keys.has('KeyQ') || keys.has('ControlLeft') || keys.has('ControlRight')) movement.y -= 1;
    if (movement.lengthSq() > 0) {
      const speed = keys.has('ShiftLeft') || keys.has('ShiftRight') ? FAST_SPEED : WALK_SPEED;
      camera.position.addScaledVector(movement.normalize(), speed * delta);
      camera.position.y = Math.max(0.3, Math.min(95, camera.position.y));
    }
    let moving = false;
    for (const entry of toiletEntries) moving = entry.toilet.rig.update(delta) || moving;
    if (moving) renderer.shadowMap.needsUpdate = true;
    drawFrame();
    requestAnimationFrame(render);
  };
  requestAnimationFrame(render);
}
