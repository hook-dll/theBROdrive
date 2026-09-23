/**
 * Car condition laboratory (`?car-lab`, development builds only).
 *
 * Every car in the catalogue, parked in rows by source pack, lit by the game's own
 * Renderer and Sky — the same probe, tone map, ink and daylight grade the road has —
 * so what the paint does here is what it does on the road. Sliders set every car's
 * dirt and scratches at once.
 *
 * VARIANTS. Each car is built through a `LabCarFactory`. There is one today, the
 * game's own `createCarModel`. A visual-style experiment adds a second entry to
 * `CAR_FACTORIES`; the lab then shows a style selector and rebuilds the grid from the
 * chosen factory, keeping every car's condition, so A/B is one click on
 * identical wear. Nothing else in the lab needs to know.
 *
 * The unified car-style A/B (`?carstyle=unified`) is a reload rather than a factory:
 * that style is decided ONCE, in render/carmodel.ts, when a model's template is
 * measured, creased and given its materials, and every car in the world is a clone of
 * that template afterwards. The toggle therefore flips the flag and reloads, keeping
 * every other query parameter, so the two screenshots are the same cars under two
 * material sets.
 *
 * Automation: `window.__carLab` (see `CarLabApi`) sets state and focuses cars without
 * the UI, which is how report screenshots are taken reproducibly. Query parameters
 * `dirt`, `scratches`, `time` and `focus` seed the same state from the URL.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { prefersMobilePresentation, Renderer } from './core/renderer';
import { parseCalendarEpoch } from './game/calendar';
import { DEFAULT_INK_STRENGTH, type GraphicsQuality } from './game/settings';
import { DAY_LENGTH, newWorldState } from './game/state';
import {
  CAR_STYLE_UNIFIED,
  carModelMeasure,
  carSpawnYAboveGround,
  createCarModel,
  preloadCarModels,
  type CarModelInstance,
} from './render/carmodel';
import { makeFlatMaterial } from './render/materials';
import { Sky } from './render/sky';
import { loadStarField } from './render/starcatalog';
import { CAR_MODELS, type CarModelDef } from './vehicle/carmodels';

const CALENDAR = newWorldState(1337).calendarEpoch;
const CELL_X = 6.5;
const CELL_Z = 9;
const COLUMNS = 6;
const GROUND_COLOUR = 0xc9a26b;
/** Cars stand three-quarter on to the overview camera, the angle cars are judged from. */
const CAR_YAW = -0.62;

/** One way of building a lab car. A second entry turns on the style selector. */
export interface LabCarFactory {
  readonly label: string;
  readonly create: (modelId: string, appearanceKey: string) => CarModelInstance;
}

const CAR_FACTORIES: readonly LabCarFactory[] = [
  { label: 'game', create: createCarModel },
];

interface LabState {
  dirt: number;
  scratches: number;
  timeHours: number;
  quality: GraphicsQuality;
  factory: number;
}

interface LabCar {
  readonly def: CarModelDef;
  readonly pack: string;
  readonly anchor: THREE.Group;
  readonly label: THREE.Sprite;
  instance: CarModelInstance | null;
}

/** What `window.__carLab` exposes. */
export interface CarLabApi {
  set(values: Partial<Pick<LabState, 'dirt' | 'scratches' | 'timeHours' | 'factory'>>): void;
  /** Frames one car from `azimuth` radians around it, or the whole grid with no id. */
  focus(modelId?: string, azimuth?: number): void;
  /** Renders a frame now and returns the canvas as a PNG data URL. */
  capture(): string;
  readonly models: readonly string[];
}

function packOf(def: CarModelDef): string {
  if (def.id.startsWith('sv_')) return 'Soviet FBX';
  if (def.id.startsWith('sa_')) return 'GTA SA';
  if (def.id.startsWith('gt_')) return 'GTA V';
  return 'other';
}

function makeLabel(text: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 96;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D is required for car labels');
  context.fillStyle = 'rgba(24, 20, 14, 0.85)';
  context.beginPath();
  context.roundRect(4, 4, 504, 88, 14);
  context.fill();
  context.fillStyle = '#f0dfb8';
  context.font = 'bold 34px Segoe UI, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(text, 256, 50);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false }));
  sprite.scale.set(3.2, 0.6, 1);
  sprite.renderOrder = 20;
  return sprite;
}

function queryNumber(query: URLSearchParams, key: string, fallback: number): number {
  const value = Number(query.get(key));
  return query.has(key) && Number.isFinite(value) ? value : fallback;
}

function createInterface(
  state: LabState,
  cars: readonly LabCar[],
  apply: () => void,
  api: CarLabApi,
): HTMLElement {
  const root = document.createElement('aside');
  root.className = 'car-lab';
  const styleRow = CAR_FACTORIES.length > 1
    ? `<label><span>Стиль</span><select data-control="factory">${CAR_FACTORIES.map((f, i) => `<option value="${i}">${f.label}</option>`).join('')}</select><output></output></label>`
    : '';
  // The unified car style is a compile-time flag in carmodel.ts, so its control
  // reloads the lab rather than rebuilding the grid (see the module note).
  const unifiedRow = '<label class="toggle"><span>Единый стиль</span><input data-toggle="carstyle" type="checkbox"><output></output></label>';
  root.innerHTML = `
    <style>
      .car-lab{position:fixed;z-index:50;left:14px;top:14px;width:min(360px,calc(100vw - 28px));padding:14px;color:#eadfca;background:rgba(19,17,13,.9);border:1px solid #82735b;font:12px/1.3 Consolas,monospace;box-shadow:0 8px 35px #0008}
      .car-lab h1{font:700 18px/1.1 "Segoe UI",sans-serif;margin:0 0 8px}.car-lab p{color:#bfb39e;margin:0 0 10px}
      .car-lab label{display:grid;grid-template-columns:1fr 150px 44px;gap:7px;align-items:center;margin:6px 0}.car-lab input[type=range]{width:100%}.car-lab output{text-align:right;color:#f2d59b}
      .car-lab select,.car-lab button{color:#eadfca;background:#2b251b;border:1px solid #6b5c44;padding:6px;font:12px Consolas,monospace}.car-lab select{width:100%}
      .car-lab .buttons{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0}.car-lab button:hover{background:#5c4930}
      .car-lab label.toggle{display:flex;justify-content:space-between;align-items:center}
      .car-lab label.toggle input{width:16px;height:16px;margin:0;accent-color:#f2d59b}
    </style>
    <h1>ЛАБОРАТОРИЯ СОСТОЯНИЯ КУЗОВА</h1>
    <p>${cars.length} машин · мышь — орбита, колесо — дистанция</p>
    <label><span>Пыль</span><input data-control="dirt" type="range" min="0" max="1" step="0.01"><output></output></label>
    <label><span>Царапины</span><input data-control="scratches" type="range" min="0" max="1" step="0.01"><output></output></label>
    <label><span>Время суток</span><input data-control="timeHours" type="range" min="0" max="24" step="0.05"><output></output></label>
    <label><span>Качество</span><select data-control="quality"><option value="acceptable">Acceptable</option><option value="standard">Standard</option><option value="blessing">Blessing</option></select><output></output></label>
    ${unifiedRow}
    ${styleRow}
    <select data-control="focus"><option value="">Общий вид</option>${cars.map((car) => `<option value="${car.def.id}">${car.pack} · ${car.def.label}</option>`).join('')}</select>
    <div class="buttons"><button data-action="game">Вернуться в игру</button></div>`;
  document.body.appendChild(root);

  const sync = (): void => {
    root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-control]').forEach((input) => {
      const key = input.dataset.control;
      if (key === 'dirt' || key === 'scratches' || key === 'timeHours' || key === 'factory') {
        input.value = String(state[key]);
        const output = input.parentElement?.querySelector('output');
        if (output) output.textContent = String(Number(state[key].toFixed(2)));
      } else if (key === 'quality') {
        input.value = state.quality;
      }
    });
    // Reads the flag carmodel.ts parsed, not the URL again: the checkbox then shows
    // what the cars on screen were actually built with.
    const toggle = root.querySelector<HTMLInputElement>('[data-toggle="carstyle"]');
    if (toggle) {
      toggle.checked = CAR_STYLE_UNIFIED;
      const output = toggle.parentElement?.querySelector('output');
      if (output) output.textContent = CAR_STYLE_UNIFIED ? 'unified' : 'source';
    }
  };
  root.addEventListener('input', (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement || input instanceof HTMLSelectElement)) return;
    // Only the controls this handler owns: the style toggle fires an input event of
    // its own, and running sync() for it would write the loaded flag back over the
    // box the player just clicked, before its change event is even delivered.
    const key = input.dataset.control;
    if (key === undefined) return;
    if (key === 'dirt' || key === 'scratches' || key === 'timeHours' || key === 'factory') {
      state[key] = Number(input.value);
    } else if (key === 'quality' && input instanceof HTMLSelectElement) {
      const quality = input.selectedOptions[0]?.value;
      if (quality === 'acceptable' || quality === 'standard' || quality === 'blessing') {
        state.quality = quality;
      }
    } else if (key === 'focus') {
      api.focus(input.value || undefined);
      return;
    }
    sync();
    apply();
  });
  root.querySelector('[data-toggle="carstyle"]')?.addEventListener('change', (event) => {
    const unified = event.target instanceof HTMLInputElement && event.target.checked;
    // Every other lab flag is kept, so the same cars, wear and camera come back and
    // the only difference between the two screenshots is the style.
    const query = new URLSearchParams(window.location.search);
    if (unified) query.set('carstyle', 'unified');
    else query.delete('carstyle');
    window.location.search = query.toString();
  });
  root.querySelector('[data-action="game"]')?.addEventListener('click', () => {
    window.location.href = window.location.pathname;
  });
  sync();
  return root;
}

export async function bootCarLab(): Promise<void> {
  const canvas = document.getElementById('game');
  const loading = document.getElementById('launch-loading');
  const rotateHint = document.getElementById('rotate-hint');
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error('index.html is missing #game');
  if (loading instanceof HTMLElement) loading.style.display = 'none';
  if (rotateHint instanceof HTMLElement) rotateHint.style.display = 'none';
  document.title = 'Car condition lab · the BRO drive';

  const query = new URLSearchParams(window.location.search);
  const state: LabState = {
    dirt: queryNumber(query, 'dirt', 0),
    scratches: queryNumber(query, 'scratches', 0),
    timeHours: queryNumber(query, 'time', 11),
    quality: 'standard',
    factory: 0,
  };
  const renderer = new Renderer(canvas, state.quality, true, DEFAULT_INK_STRENGTH);
  const [starField] = await Promise.all([
    loadStarField(new Date(parseCalendarEpoch(CALENDAR)), state.quality, prefersMobilePresentation()),
    preloadCarModels(),
  ]);
  const sky = new Sky(renderer.scene, renderer.fog, renderer.renderer, starField);
  await sky.waitForAssets();
  renderer.setViewDistance(600);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(4_000, 4_000), makeFlatMaterial(GROUND_COLOUR, 0.95));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  renderer.scene.add(ground);

  // Rows by pack, so one screenshot row compares like with like.
  const cars: LabCar[] = [];
  const packs = [...new Set(CAR_MODELS.map(packOf))];
  let row = 0;
  for (const pack of packs) {
    const defs = CAR_MODELS.filter((def) => packOf(def) === pack);
    defs.forEach((def, index) => {
      const anchor = new THREE.Group();
      anchor.position.set(
        (index % COLUMNS - (COLUMNS - 1) / 2) * CELL_X,
        0,
        (row + Math.floor(index / COLUMNS)) * CELL_Z,
      );
      anchor.rotation.y = CAR_YAW;
      const label = makeLabel(`${pack} · ${def.label}`);
      label.position.set(0, 2.7, 0);
      anchor.add(label);
      renderer.scene.add(anchor);
      cars.push({ def, pack, anchor, label, instance: null });
    });
    row += Math.ceil(defs.length / COLUMNS);
  }
  const gridCentre = new THREE.Vector3(0, 0, ((row - 1) * CELL_Z) / 2);

  const buildCar = (car: LabCar): void => {
    if (car.instance) {
      car.instance.surface.dispose();
      car.anchor.remove(car.instance.body);
      for (const wheel of car.instance.wheels.values()) car.anchor.remove(wheel);
    }
    const instance = CAR_FACTORIES[state.factory]!.create(car.def.id, `${car.def.id}:car-lab`);
    const measure = carModelMeasure(car.def.id);
    const rideY = carSpawnYAboveGround(measure, 0, 0);
    instance.body.position.y += rideY;
    car.anchor.add(instance.body);
    for (const wheel of measure.wheels) {
      const mesh = instance.wheels.get(wheel.id);
      if (!mesh) continue;
      mesh.position.set(wheel.pos[0], wheel.pos[1] + rideY, wheel.pos[2]);
      car.anchor.add(mesh);
    }
    instance.surface.setCondition(state.dirt, state.scratches);
    car.instance = instance;
  };
  let builtFactory = state.factory;
  for (const car of cars) buildCar(car);

  const controls = new OrbitControls(renderer.camera, canvas);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.49;
  const frame = (target: THREE.Vector3, distance: number, azimuth: number, elevation: number): void => {
    controls.target.copy(target);
    renderer.camera.position.set(
      target.x + Math.sin(azimuth) * Math.cos(elevation) * distance,
      target.y + Math.sin(elevation) * distance,
      target.z + Math.cos(azimuth) * Math.cos(elevation) * distance,
    );
    controls.update();
  };

  const apply = (): void => {
    renderer.setQuality(state.quality);
    starField.setQuality(state.quality, prefersMobilePresentation());
    if (state.factory !== builtFactory) {
      builtFactory = state.factory;
      for (const car of cars) buildCar(car);
    }
    for (const car of cars) car.instance?.surface.setCondition(state.dirt, state.scratches);
  };

  const renderFrame = (): void => {
    controls.update();
    const cam = renderer.camera.position;
    sky.update(CALENDAR, (state.timeHours / 24) * DAY_LENGTH, 0, 0, cam.x, cam.y, cam.z);
    renderer.setDaylight(sky.dayFactor);
    renderer.render();
  };

  const api: CarLabApi = {
    set(values) {
      Object.assign(state, values);
      apply();
      interfaceRoot.querySelectorAll<HTMLInputElement>('input[data-control]').forEach((input) => {
        const key = input.dataset.control;
        if (key === 'dirt' || key === 'scratches' || key === 'timeHours') input.value = String(state[key]);
      });
    },
    focus(modelId, azimuth = 0.9) {
      const car = cars.find((candidate) => candidate.def.id === modelId);
      // Name boards help find a car in the grid and only get in the way of a close-up.
      for (const other of cars) other.label.visible = !car;
      if (!car) {
        frame(gridCentre, 44, 0.35, 0.5);
        return;
      }
      const half = carModelMeasure(car.def.id).halfExtents;
      const target = car.anchor.position.clone();
      target.y = half[1] * 0.9;
      frame(target, Math.max(half[2], half[0]) * 2.6, CAR_YAW + azimuth, 0.18);
    },
    capture() {
      renderFrame();
      return canvas.toDataURL('image/png');
    },
    models: cars.map((car) => car.def.id),
  };
  const interfaceRoot = createInterface(state, cars, apply, api);
  Object.assign(window, { __carLab: api });

  api.focus(query.get('focus') ?? undefined);
  apply();

  const loop = (): void => {
    renderFrame();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
