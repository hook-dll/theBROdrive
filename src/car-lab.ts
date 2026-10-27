/**
 * Car condition laboratory (`?car-lab`, development builds only).
 *
 * Every car the game drives (`CAR_MODELS`, the kit bodies), parked in a grid, lit by the game's own
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
 * `dirt`, `scratches`, `time` and `focus` seed the same state from the URL; `trim` (an
 * interior trim id, carkit/trims.ts) puts every kit car in that trim, as the «Салон»
 * selector does; the «Экземпляр» slider shows each car's own draw of trim and paint.
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
  loadCarModel,
  setKitTrimOverride,
  setWheelSetOverride,
  type CarModelInstance,
} from './render/carmodel';
import { FarCarField } from './render/farcars';
import { KIT_PICK_LAYER } from './render/kitdraw';
import { makeFlatMaterial } from './render/materials';
import { Sky } from './render/sky';
import { loadStarField } from './render/starcatalog';
import { KitRig, type KitControl, type KitPicked } from './carkit/rig';
import { INTERIOR_TRIMS } from './carkit/trims';
import type { VehicleLamps } from './vehicle/vehiclelamps';
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
  /**
   * Which instance of each model: its appearance key, so paint and (kit) wheel style
   * change together, as two cars of one model met on the road would.
   */
  variant: number;
}

interface LabCar {
  readonly def: CarModelDef;
  readonly anchor: THREE.Group;
  readonly label: THREE.Sprite;
  instance: CarModelInstance | null;
  /** Kit cars only: their doors, lamps and controls. */
  rig: KitRig | null;
  /** Drawn as mid traffic (`CarLabApi.mid`). */
  mid: boolean;
}

/** What `window.__carLab` exposes. */
export interface CarLabApi {
  set(values: Partial<Pick<LabState, 'dirt' | 'scratches' | 'timeHours' | 'factory' | 'variant'>>): void;
  /** Frames one car from `azimuth` radians around it, or the whole grid with no id. */
  focus(modelId?: string, azimuth?: number, elevation?: number, distance?: number): void;
  /**
   * Puts the camera at `position` looking at `target`, both relative to a car's anchor;
   * `fov` (degrees) narrows the lens for a far car without moving the eye, so the LOD
   * distance stays the real one.
   */
  look(modelId: string, position: readonly [number, number, number], target: readonly [number, number, number], fov?: number): void;
  /** Draws a car as traffic past `MID_CAR_ENTER_M` does (its mid paint and parts), or in full. */
  mid(modelId: string, on: boolean): void;
  /** Shows only this car (null: all of them), so a far view down the grid meets no other. */
  only(modelId: string | null): void;
  /** Rebuilds every car on one wheel set from the pools (a pack id or a `gw_*` design), or on its own draw again with null. */
  wheels(setId: string | null): void;
  /** Rebuilds every kit car in one interior trim (carkit/trims.ts `INTERIOR_TRIMS` id), or in its own draw again with null. */
  trim(trimId: string | null): void;
  /** A kit car's rig: set a channel, click a control by id, list the controls. */
  kit(modelId: string): {
    set(channel: string, value: number): void;
    activate(controlId: string): void;
    controls(): string[];
  } | null;
  /** Renders a frame now and returns the canvas as a PNG data URL. */
  capture(): string;
  readonly models: readonly string[];
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
  // `?trim` is carmodel.ts's override from the start: the selector shows it.
  const initialTrim = new URLSearchParams(window.location.search).get('trim') ?? '';
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
    <label><span>Экземпляр</span><input data-control="variant" type="range" min="0" max="19" step="1"><output></output></label>
    <label><span>Салон</span><select data-control="trim"><option value="">по экземпляру</option>${INTERIOR_TRIMS.map((trim) => `<option value="${trim.id}"${trim.id === initialTrim ? ' selected' : ''}>${trim.label}</option>`).join('')}</select><output></output></label>
    <label><span>Качество</span><select data-control="quality"><option value="acceptable">Acceptable</option><option value="standard">Standard</option><option value="blessing">Blessing</option></select><output></output></label>
    ${unifiedRow}
    ${styleRow}
    <select data-control="focus"><option value="">Общий вид</option>${cars.map((car) => `<option value="${car.def.id}">${car.def.label}</option>`).join('')}</select>
    <div class="buttons"><button data-action="game">Вернуться в игру</button></div>`;
  document.body.appendChild(root);

  const sync = (): void => {
    root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-control]').forEach((input) => {
      const key = input.dataset.control;
      if (key === 'dirt' || key === 'scratches' || key === 'timeHours' || key === 'factory' || key === 'variant') {
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
    if (key === 'dirt' || key === 'scratches' || key === 'timeHours' || key === 'factory' || key === 'variant') {
      state[key] = Number(input.value);
    } else if (key === 'quality' && input instanceof HTMLSelectElement) {
      const quality = input.selectedOptions[0]?.value;
      if (quality === 'acceptable' || quality === 'standard' || quality === 'blessing') {
        state.quality = quality;
      }
    } else if (key === 'focus') {
      api.focus(input.value || undefined);
      return;
    } else if (key === 'trim') {
      api.trim(input.value || null);
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

/** Driving inputs the kit panel offers as sliders: channel, label, range, step. */
const KIT_DRIVE_SLIDERS: readonly [string, string, number, number, number][] = [
  ['steer', 'Руль', -1, 1, 0.01],
  ['throttle', 'Газ', 0, 1, 0.01],
  ['brake', 'Тормоз', 0, 1, 0.01],
  ['clutch', 'Сцепление', 0, 1, 0.01],
  ['handbrake', 'Ручник', 0, 1, 0.01],
  ['gear', 'Передача', -1, 5, 1],
  ['speed', 'Скорость', 0, 180, 1],
  ['rpm', 'Обороты', 0, 7000, 50],
  ['fuel', 'Топливо', 0, 1, 0.01],
  ['temp', 'Температура', 0, 1, 0.01],
];

/**
 * The focused kit car's panel: a button per clickable part (the same thing a click on
 * the car does) and sliders for the driving inputs the cabin shows.
 */
function fillKitPanel(panel: HTMLElement, rig: KitRig, body: THREE.Object3D): void {
  const controls: KitControl[] = [];
  const seen = new Set<string>();
  body.traverse((node) => {
    const found = KitRig.controlOf(node);
    if (!found || found.node !== node || seen.has(found.control.id)) return;
    seen.add(found.control.id);
    controls.push(found.control);
  });
  panel.innerHTML = `
    <h1>КАБИНА</h1>
    ${KIT_DRIVE_SLIDERS.map(([channel, label, min, max, step]) =>
      `<label><span>${label}</span><input data-kit-channel="${channel}" type="range" min="${min}" max="${max}" step="${step}" value="${rig.get(channel)}"><output>${rig.get(channel)}</output></label>`).join('')}
    <div class="buttons">${controls.map((control, i) => `<button data-kit-control="${i}">${control.label}</button>`).join('')}</div>`;
  panel.oninput = (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || !input.dataset.kitChannel) return;
    rig.set(input.dataset.kitChannel, Number(input.value));
    const output = input.parentElement?.querySelector('output');
    if (output) output.textContent = input.value;
  };
  panel.onclick = (event) => {
    const button = event.target;
    if (!(button instanceof HTMLButtonElement) || button.dataset.kitControl === undefined) return;
    const control = controls[Number(button.dataset.kitControl)];
    if (control?.action?.type === 'press') {
      rig.activate(control);
      setTimeout(() => rig.release(control), 400);
    } else if (control) {
      rig.activate(control);
    }
  };
}

export async function bootCarLab(): Promise<void> {
  const canvas = document.getElementById('game');
  const loading = document.getElementById('launch-loading');
  const rotateHint = document.getElementById('rotate-hint');
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error('index.html is missing #game');
  if (loading instanceof HTMLElement) loading.style.display = 'none';
  if (rotateHint instanceof HTMLElement) rotateHint.style.display = 'none';
  document.title = 'Car condition lab · Voyage Mirage';

  const query = new URLSearchParams(window.location.search);
  // The game's cars only: the kit bodies. The pack bodies they replaced are not drawn here.
  const labModels = CAR_MODELS;
  const state: LabState = {
    dirt: queryNumber(query, 'dirt', 0),
    scratches: queryNumber(query, 'scratches', 0),
    timeHours: queryNumber(query, 'time', 11),
    quality: 'standard',
    factory: 0,
    variant: queryNumber(query, 'variant', 0),
  };
  const renderer = new Renderer(canvas, state.quality, true, DEFAULT_INK_STRENGTH);
  const [starField] = await Promise.all([
    loadStarField(new Date(parseCalendarEpoch(CALENDAR)), state.quality, prefersMobilePresentation()),
    // `loadCarModel`, not a bare preload: it also builds the mid meshes `mid` draws.
    Promise.all(labModels.map((def) => loadCarModel(def.id))),
  ]);
  const sky = new Sky(renderer.scene, renderer.fog, renderer.renderer, starField);
  await sky.waitForAssets();
  renderer.setViewDistance(600);

  // Segmented: fog depth is a vertex quantity (render/airfog.ts), and on a two-triangle
  // 4 km plane every pixel took the corners' ~2.8 km and was hazed sky-blue up close.
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(4_000, 4_000, 100, 100), makeFlatMaterial(GROUND_COLOUR, 0.95));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  renderer.scene.add(ground);

  const cars: LabCar[] = [];
  labModels.forEach((def, index) => {
    const anchor = new THREE.Group();
    anchor.position.set(
      (index % COLUMNS - (COLUMNS - 1) / 2) * CELL_X,
      0,
      Math.floor(index / COLUMNS) * CELL_Z,
    );
    anchor.rotation.y = CAR_YAW;
    const label = makeLabel(def.label);
    label.position.set(0, 2.7, 0);
    anchor.add(label);
    renderer.scene.add(anchor);
    cars.push({ def, anchor, label, instance: null, rig: null, mid: false });
  });
  const rows = Math.ceil(labModels.length / COLUMNS);
  const gridCentre = new THREE.Vector3(0, 0, ((rows - 1) * CELL_Z) / 2);

  const buildCar = (car: LabCar): void => {
    if (car.instance) {
      car.instance.surface.dispose();
      car.anchor.remove(car.instance.body);
      for (const wheel of car.instance.wheels.values()) car.anchor.remove(wheel);
      for (const part of [car.instance.wheelDraw, car.instance.mid?.paint, car.instance.mid?.glass]) if (part) car.anchor.remove(part);
    }
    // Instance 0 keeps the key the lab always used, so its screenshots stay comparable.
    const key = state.variant === 0 ? `${car.def.id}:car-lab` : `${car.def.id}:car-lab:${state.variant}`;
    const instance = CAR_FACTORIES[state.factory]!.create(car.def.id, key);
    car.rig = car.def.kit ? new KitRig(instance.body) : null;
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
    // A kit car's wheels draw as one mesh beside them (render/kitdraw.ts).
    if (instance.wheelDraw) car.anchor.add(instance.wheelDraw);
    instance.surface.setCondition(state.dirt, state.scratches);
    // The mid paint and glass are chassis-local, the body's own transform baked in: they
    // stand at the chassis origin the wheels are placed from. Hidden until `mid` shows them.
    for (const part of [instance.mid?.paint, instance.mid?.glass]) {
      if (!part) continue;
      part.position.set(0, rideY, 0);
      car.anchor.add(part);
    }
    car.instance = instance;
    showMid(car);
  };
  /** Mid in place of the body and wheels, as `Vehicle.showMid` swaps them. */
  const showMid = (car: LabCar): void => {
    const instance = car.instance;
    if (!instance) return;
    const mid = car.mid && instance.mid !== null;
    instance.body.visible = !mid;
    for (const wheel of instance.wheels.values()) wheel.visible = !mid;
    if (instance.wheelDraw) instance.wheelDraw.visible = !mid;
    if (instance.mid) instance.mid.paint.visible = mid;
    if (instance.mid?.glass) instance.mid.glass.visible = mid;
  };
  let builtFactory = state.factory;
  let builtVariant = state.variant;
  /** The car `focus` framed, if any: the kit panel drives its rig. */
  let focused: LabCar | null = null;
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
    if (state.factory !== builtFactory || state.variant !== builtVariant) {
      builtFactory = state.factory;
      builtVariant = state.variant;
      for (const car of cars) buildCar(car);
      // The focused car is a new instance with a new rig: its panel must drive that one.
      if (focused?.rig && focused.instance) fillKitPanel(kitPanel, focused.rig, focused.instance.body);
    }
    for (const car of cars) car.instance?.surface.setCondition(state.dirt, state.scratches);
  };

  // Kit cars: hover names a part, a click works it (a door, a switch, a window crank).
  const tooltip = document.createElement('div');
  tooltip.style.cssText =
    'position:fixed;z-index:60;pointer-events:none;padding:3px 7px;font:12px Consolas,monospace;color:#f2d59b;background:rgba(19,17,13,.85);border:1px solid #82735b;display:none';
  document.body.appendChild(tooltip);
  const raycaster = new THREE.Raycaster();
  raycaster.layers.enable(KIT_PICK_LAYER);
  const pointer = new THREE.Vector2();
  const pick = (event: PointerEvent): { car: LabCar; control: KitPicked | null } | null => {
    const rect = canvas.getBoundingClientRect();
    pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, renderer.camera);
    const kitCars = cars.filter((car) => car.rig && car.instance);
    const hits = raycaster.intersectObjects(kitCars.map((car) => car.instance!.body), true);
    // Panes are see-through: a click lands on what is behind them unless they open.
    for (const hit of hits) {
      const control = KitRig.controlOf(hit.object);
      const glass = (hit.object as THREE.Mesh).material instanceof THREE.Material && /glass/.test(((hit.object as THREE.Mesh).material as THREE.Material).name);
      if (glass && !control) continue;
      const car = kitCars.find((c) => {
        let node: THREE.Object3D | null = hit.object;
        while (node && node !== c.instance!.body) node = node.parent;
        return node !== null;
      });
      return car ? { car, control } : null;
    }
    return null;
  };
  let downAt: { x: number; y: number } | null = null;
  let pressed: { car: LabCar; control: KitPicked } | null = null;
  canvas.addEventListener('pointermove', (event) => {
    const hit = pick(event);
    const label = hit?.control?.control.label;
    tooltip.style.display = label ? 'block' : 'none';
    canvas.style.cursor = label ? 'pointer' : '';
    if (label) {
      tooltip.textContent = label;
      tooltip.style.left = `${event.clientX + 14}px`;
      tooltip.style.top = `${event.clientY + 10}px`;
    }
  });
  canvas.addEventListener('pointerdown', (event) => {
    downAt = { x: event.clientX, y: event.clientY };
    const hit = pick(event);
    if (hit?.control?.control.action?.type === 'press') {
      pressed = { car: hit.car, control: hit.control };
      hit.car.rig!.activate(hit.control.control);
    }
  });
  canvas.addEventListener('pointerup', (event) => {
    if (pressed) {
      pressed.car.rig!.release(pressed.control.control);
      pressed = null;
      return;
    }
    // A drag is the orbit, not a click.
    if (!downAt || Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y) > 4) return;
    const hit = pick(event);
    if (hit?.control) hit.car.rig!.activate(hit.control.control);
  });

  const view = new THREE.Vector3();
  // Mid traffic's shared parts (trim, glass, lenses, wheels), drawn unlit as parked cars' are.
  const midField = new FarCarField(renderer.scene, 'lab-mid-cars');
  const midAt = new THREE.Vector3();
  const darkLamps = { lensLevel: () => 0 } as unknown as VehicleLamps;
  const labFov = renderer.camera.fov;
  let lastFrame = performance.now();
  const renderFrame = (): void => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - lastFrame) / 1000);
    lastFrame = now;
    const eye = renderer.camera.position;
    for (const car of cars) {
      if (!car.rig) continue;
      // A mid car is posed far whatever the eye's distance, as `Vehicle.showMid` poses it.
      car.rig.setDetail(car.mid ? Infinity : car.anchor.position.distanceTo(eye));
      car.rig.update(dt);
    }
    midField.begin();
    for (const car of cars) {
      const mid = car.mid ? car.instance?.mid : null;
      if (!mid || !car.anchor.visible) continue;
      midAt.copy(mid.paint.position).applyQuaternion(car.anchor.quaternion).add(car.anchor.position);
      midField.addMid(mid.rest, mid.wheels, midAt, car.anchor.quaternion, darkLamps);
    }
    midField.end();
    controls.update();
    const cam = renderer.camera.position;
    renderer.camera.getWorldDirection(view);
    sky.update(CALENDAR, (state.timeHours / 24) * DAY_LENGTH, 0, 0, cam.x, cam.y, cam.z, view.x, view.z);
    renderer.render();
  };

  const api: CarLabApi = {
    set(values) {
      Object.assign(state, values);
      apply();
      interfaceRoot.querySelectorAll<HTMLInputElement>('input[data-control]').forEach((input) => {
        const key = input.dataset.control;
        if (key === 'dirt' || key === 'scratches' || key === 'timeHours' || key === 'variant') input.value = String(state[key]);
      });
    },
    focus(modelId, azimuth = 0.9, elevation = 0.18, distance) {
      const car = cars.find((candidate) => candidate.def.id === modelId);
      focused = car ?? null;
      // Name boards help find a car in the grid and only get in the way of a close-up.
      for (const other of cars) other.label.visible = !car;
      kitPanel.style.display = car?.rig && car.instance ? 'block' : 'none';
      if (car?.rig && car.instance) fillKitPanel(kitPanel, car.rig, car.instance.body);
      if (!car) {
        frame(gridCentre, 44, 0.35, 0.5);
        return;
      }
      const half = carModelMeasure(car.def.id).halfExtents;
      const target = car.anchor.position.clone();
      target.y = half[1] * 0.9;
      frame(target, distance ?? Math.max(half[2], half[0]) * 2.6, CAR_YAW + azimuth, elevation);
    },
    look(modelId, position, target, fov = labFov) {
      const car = cars.find((candidate) => candidate.def.id === modelId);
      if (!car) return;
      for (const other of cars) other.label.visible = false;
      car.anchor.updateMatrixWorld(true);
      controls.target.copy(car.anchor.localToWorld(new THREE.Vector3(...target)));
      renderer.camera.position.copy(car.anchor.localToWorld(new THREE.Vector3(...position)));
      renderer.camera.fov = fov;
      renderer.camera.updateProjectionMatrix();
      controls.update();
    },
    mid(modelId, on) {
      const car = cars.find((candidate) => candidate.def.id === modelId);
      if (!car) return;
      car.mid = on;
      showMid(car);
    },
    only(modelId) {
      for (const car of cars) car.anchor.visible = modelId === null || car.def.id === modelId;
    },
    wheels(setId) {
      setWheelSetOverride(setId);
      for (const car of cars) buildCar(car);
    },
    trim(trimId) {
      setKitTrimOverride(trimId);
      for (const car of cars) buildCar(car);
    },
    kit(modelId) {
      const car = cars.find((candidate) => candidate.def.id === modelId);
      const rig = car?.rig;
      const body = car?.instance?.body;
      if (!rig || !body) return null;
      const all = (): KitControl[] => {
        const out: KitControl[] = [];
        body.traverse((node) => {
          const found = KitRig.controlOf(node);
          if (found && found.node === node) out.push(found.control);
        });
        return out;
      };
      return {
        set: (channel, value) => rig.set(channel, value),
        activate: (controlId) => {
          const found = all().find((control) => control.id === controlId);
          if (found) rig.activate(found);
        },
        controls: () => all().map((control) => control.id),
      };
    },
    capture() {
      renderFrame();
      return canvas.toDataURL('image/png');
    },
    models: cars.map((car) => car.def.id),
  };
  const interfaceRoot = createInterface(state, cars, apply, api);
  const kitPanel = document.createElement('aside');
  kitPanel.className = 'car-lab';
  kitPanel.style.cssText = 'left:auto;right:14px;display:none;max-height:calc(100vh - 28px);overflow:auto';
  document.body.appendChild(kitPanel);
  Object.assign(window, { __carLab: api });

  api.focus(query.get('focus') ?? undefined);
  apply();

  const loop = (): void => {
    renderFrame();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
