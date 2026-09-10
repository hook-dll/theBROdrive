import * as THREE from 'three';
import { InputReader, emptyInput, type InputFrame } from './core/input';
import { GameLoop } from './core/loop';
import { PhysicsWorld } from './core/physics';
import { SurfaceType } from './core/surfaces';
import {
  DEFAULT_HEAT_MIRAGE,
  Renderer,
  type HeatMirageParameters,
} from './core/renderer';
import { parseCalendarEpoch } from './game/calendar';
import { DEFAULT_INK_STRENGTH, type GraphicsQuality } from './game/settings';
import { DAY_LENGTH, GameWorld, newWorldState } from './game/state';
import { spawnCarState } from './game/spawn';
import { applyComicShading } from './render/comic';
import {
  carModelMeasure,
  carSpawnYAboveGround,
  loadCarModel,
  warmCarModelInstances,
} from './render/carmodel';
import { CameraRig, type CameraTarget } from './render/cameras';
import {
  DISTANT_MIRAGE_FAMILIES,
  DistantMirage,
  type DistantMirageFamily,
} from './render/mirage';
import {
  MIRAGE_TABLEAU_KINDS,
  MirageTableau,
  type MirageKind,
} from './render/mirage-tableau';
import { Sky } from './render/sky';
import { loadStarField } from './render/starcatalog';
import { desertPaletteAt } from './world/gradient';
import { WorldOrigin } from './world/origin';
import { ROAD_HALF_WIDTH, Road } from './world/road';
import { roadSurfaceY, SurfaceField } from './world/roadsurface';
import { Terrain } from './world/terrain';
import { DEFAULT_CAR_MODEL_ID } from './vehicle/carmodels';
import { Vehicle } from './vehicle/vehicle';

const SEED = 1337;
const CAMERA_S = 1_000;
const GROUND_LENGTH = 1_800;
const GROUND_HALF_WIDTH = 420;
const GROUND_ROWS = 90;
const GROUND_COLUMNS = 48;
const CALENDAR = newWorldState(SEED).calendarEpoch;

type MirageSelection =
  | { readonly system: 'heat'; readonly label: string }
  | { readonly system: 'distant'; readonly family: DistantMirageFamily; readonly label: string }
  | { readonly system: 'tableau'; readonly kind: MirageKind; readonly label: string };

const SELECTIONS: readonly MirageSelection[] = [
  { system: 'heat', label: 'Жаркое марево · рефракция' },
  ...DISTANT_MIRAGE_FAMILIES.map((family) => ({
    system: 'distant' as const,
    family,
    label: `Дальний силуэт · ${family}`,
  })),
  ...MIRAGE_TABLEAU_KINDS.map((kind) => ({
    system: 'tableau' as const,
    kind,
    label: `Табло · ${kind}`,
  })),
];

interface LabState {
  selection: number;
  timeHours: number;
  quality: GraphicsQuality;
  msaa: boolean;
  ink: number;
  heatStrength: number;
  heat: HeatMirageParameters;
  opacity: number;
  distance: number;
  lateral: number;
  setback: number;
  scale: number;
  variation: number;
  length: number;
  density: number;
}

interface RangeSpec {
  readonly key: keyof HeatMirageParameters;
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly unit: string;
}

const HEAT_RANGES: readonly RangeSpec[] = [
  { key: 'scaleHeightM', label: 'Высота горячего слоя', min: 0.5, max: 30, step: 0.1, unit: 'м' },
  { key: 'referencePathM', label: 'Путь полного эффекта', min: 40, max: 1_000, step: 5, unit: 'м' },
  { key: 'nearClearM', label: 'Чистая ближняя зона', min: 0, max: 180, step: 1, unit: 'м' },
  { key: 'nearFullM', label: 'Полный эффект объектов', min: 20, max: 420, step: 1, unit: 'м' },
  { key: 'groundClearM', label: 'Чистая зона земли', min: 0, max: 250, step: 1, unit: 'м' },
  { key: 'groundFullM', label: 'Полный эффект земли', min: 20, max: 600, step: 1, unit: 'м' },
  { key: 'angleMrad', label: 'Амплитуда преломления', min: 0, max: 14, step: 0.05, unit: 'мрад' },
  { key: 'liftMrad', label: 'Вертикальный подъём', min: -3, max: 5, step: 0.05, unit: 'мрад' },
  { key: 'sampleRangeM', label: 'Радиус поля конвекции', min: 2, max: 80, step: 0.5, unit: 'м' },
  { key: 'broadCellM', label: 'Размер крупных ячеек', min: 0.1, max: 5, step: 0.05, unit: 'м' },
  { key: 'fineCellM', label: 'Размер мелких ячеек', min: 0.05, max: 2.5, step: 0.05, unit: 'м' },
  { key: 'broadRiseMps', label: 'Скорость крупных потоков', min: -4, max: 6, step: 0.05, unit: 'м/с' },
  { key: 'fineRiseMps', label: 'Скорость мелких потоков', min: -6, max: 10, step: 0.05, unit: 'м/с' },
  { key: 'plumeStretch', label: 'Вытяжение потоков', min: 0.2, max: 6, step: 0.05, unit: '×' },
  { key: 'lateralShare', label: 'Доля бокового сдвига', min: 0, max: 1, step: 0.01, unit: '' },
  { key: 'minimumEyeHeightM', label: 'Минимальная высота глаза', min: 0, max: 5, step: 0.05, unit: 'м' },
];

function makeLandscape(road: Road, terrain: Terrain): THREE.Mesh {
  const positions = new Float32Array(GROUND_ROWS * GROUND_COLUMNS * 6 * 3);
  const colours = new Float32Array(positions.length);
  const palette = desertPaletteAt(CAMERA_S);
  const sand = new THREE.Color(palette.sand);
  const rock = new THREE.Color(palette.rock);
  let cursor = 0;
  const vertex = (s: number, lateral: number): void => {
    const point = road.offsetPoint(s, lateral);
    const y = terrain.heightAt(point.x, point.z, s);
    positions[cursor] = point.x;
    colours[cursor++] = sand.r + (rock.r - sand.r) * Math.min(0.28, Math.abs(lateral) / 1_500);
    positions[cursor] = y;
    colours[cursor++] = sand.g + (rock.g - sand.g) * Math.min(0.28, Math.abs(lateral) / 1_500);
    positions[cursor] = point.z;
    colours[cursor++] = sand.b + (rock.b - sand.b) * Math.min(0.28, Math.abs(lateral) / 1_500);
  };
  for (let row = 0; row < GROUND_ROWS; row++) {
    const s0 = CAMERA_S - 120 + (row / GROUND_ROWS) * GROUND_LENGTH;
    const s1 = CAMERA_S - 120 + ((row + 1) / GROUND_ROWS) * GROUND_LENGTH;
    for (let column = 0; column < GROUND_COLUMNS; column++) {
      const l0 = -GROUND_HALF_WIDTH + (column / GROUND_COLUMNS) * GROUND_HALF_WIDTH * 2;
      const l1 = -GROUND_HALF_WIDTH + ((column + 1) / GROUND_COLUMNS) * GROUND_HALF_WIDTH * 2;
      vertex(s0, l0); vertex(s1, l0); vertex(s1, l1);
      vertex(s0, l0); vertex(s1, l1); vertex(s0, l1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  geometry.computeVertexNormals();
  const material = applyComicShading(new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.96,
    metalness: 0,
  }), { contourStrength: 0.08, stippleStrength: 0.08 });
  material.side = THREE.DoubleSide;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  return mesh;
}

function makeRoad(road: Road): THREE.Mesh {
  const field = new SurfaceField(SEED);
  const segments = 360;
  const positions = new Float32Array(segments * 6 * 3);
  let cursor = 0;
  const vertex = (s: number, lateral: number): void => {
    const point = road.offsetPoint(s, lateral);
    positions[cursor++] = point.x;
    positions[cursor++] = roadSurfaceY(road, field, s, lateral, point.x, point.z) + 0.025;
    positions[cursor++] = point.z;
  };
  for (let i = 0; i < segments; i++) {
    const s0 = CAMERA_S - 120 + (i / segments) * GROUND_LENGTH;
    const s1 = CAMERA_S - 120 + ((i + 1) / segments) * GROUND_LENGTH;
    vertex(s0, -ROAD_HALF_WIDTH); vertex(s1, -ROAD_HALF_WIDTH); vertex(s1, ROAD_HALF_WIDTH);
    vertex(s0, -ROAD_HALF_WIDTH); vertex(s1, ROAD_HALF_WIDTH); vertex(s0, ROAD_HALF_WIDTH);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  const material = applyComicShading(new THREE.MeshStandardMaterial({
    color: 0x625d54,
    roughness: 0.9,
    metalness: 0,
  }), { contourStrength: 0.18, stippleStrength: 0.08 });
  material.side = THREE.DoubleSide;
  material.polygonOffset = true;
  material.polygonOffsetFactor = -2;
  material.polygonOffsetUnits = -2;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  mesh.renderOrder = 2;
  return mesh;
}

/**
 * The lab's compact terrain is already triangle soup. Rapier needs an index for
 * that same soup; copying positions also folds in the mesh translation so the road
 * seen by the camera and the road seen by the tyres cannot diverge.
 */
function addStaticMeshCollider(
  physics: PhysicsWorld,
  mesh: THREE.Mesh,
  surface: SurfaceType,
): void {
  const position = mesh.geometry.getAttribute('position');
  if (!(position instanceof THREE.BufferAttribute) || !(position.array instanceof Float32Array)) {
    throw new Error('Mirage Lab ground mesh must use Float32 positions');
  }
  const vertices = new Float32Array(position.array.length);
  for (let i = 0; i < position.count; i++) {
    const offset = i * 3;
    vertices[offset] = position.array[offset]! + mesh.position.x;
    vertices[offset + 1] = position.array[offset + 1]! + mesh.position.y;
    vertices[offset + 2] = position.array[offset + 2]! + mesh.position.z;
  }
  const indices = new Uint32Array(position.count);
  for (let i = 0; i < indices.length; i++) indices[i] = i;
  physics.addStaticTrimesh(vertices, indices, surface);
}

function createInterface(state: LabState, apply: () => void): HTMLElement {
  const root = document.createElement('aside');
  root.className = 'mirage-lab';
  root.innerHTML = `
    <style>
      .mirage-lab{position:fixed;z-index:50;left:14px;top:14px;bottom:14px;width:min(390px,calc(100vw - 28px));overflow:auto;padding:15px;color:#eadfca;background:rgba(19,17,13,.91);border:1px solid #82735b;font:12px/1.3 Consolas,monospace;box-shadow:0 8px 35px #0008}
      .mirage-lab h1{font:700 20px/1.1 "Segoe UI",sans-serif;margin:0 0 5px}.mirage-lab p{color:#bfb39e;margin:0 0 12px}.mirage-lab fieldset{border:1px solid #554a39;margin:0 0 10px;padding:9px}.mirage-lab legend{color:#d7bd89;padding:0 5px}.mirage-lab label{display:grid;grid-template-columns:1fr 142px 57px;gap:7px;align-items:center;margin:6px 0}.mirage-lab input[type=range]{width:100%}.mirage-lab output{text-align:right;color:#f2d59b}.mirage-lab select,.mirage-lab button{color:#eadfca;background:#2b251b;border:1px solid #6b5c44;padding:6px;font:12px Consolas,monospace}.mirage-lab select{width:100%;margin-bottom:9px}.mirage-lab .buttons{display:flex;gap:6px;flex-wrap:wrap}.mirage-lab button:hover{background:#5c4930}.mirage-lab .presentation[hidden],.mirage-lab label[hidden]{display:none}.mirage-lab .footer{color:#988c78;margin-top:8px}
    </style>
    <h1>ЛАБОРАТОРИЯ МИРАЖЕЙ</h1>
    <p>Клик по дороге — мышь. WASD/стрелки — езда, X/Z — передачи, C — капот/погоня, V — камера назад, колесо — дистанция.</p>
    <select data-control="selection" aria-label="Тип миража">${SELECTIONS.map((item, index) => `<option value="${index}">${String(index + 1).padStart(2, '0')} · ${item.label}</option>`).join('')}</select>
    <fieldset><legend>Время и графика</legend>
      <div class="buttons"><button data-time="6">Рассвет</button><button data-time="12">День</button><button data-time="18">Закат</button><button data-time="0">Ночь</button></div>
      <label><span>Время суток</span><input data-control="timeHours" type="range" min="0" max="24" step="0.05"><output></output></label>
      <label><span>Качество</span><select data-control="quality"><option value="acceptable">Acceptable</option><option value="standard">Standard</option><option value="blessing">Blessing</option></select><output></output></label>
      <label><span>MSAA</span><input data-control="msaa" type="checkbox"><output></output></label>
      <label><span>Контур</span><input data-control="ink" type="range" min="0" max="1" step="0.01"><output></output></label>
    </fieldset>
    <fieldset><legend>Жаркое марево · все параметры</legend>
      <label><span>Сила</span><input data-control="heatStrength" type="range" min="0" max="1" step="0.01"><output></output></label>
      ${HEAT_RANGES.map((spec) => `<label><span>${spec.label}</span><input data-heat="${spec.key}" type="range" min="${spec.min}" max="${spec.max}" step="${spec.step}"><output data-unit="${spec.unit}"></output></label>`).join('')}
    </fieldset>
    <fieldset class="presentation"><legend>Визуальный мираж</legend>
      <label><span>Непрозрачность</span><input data-control="opacity" type="range" min="0" max="1" step="0.01"><output></output></label>
      <label><span>Дистанция</span><input data-control="distance" type="range" min="180" max="1300" step="5"><output data-unit="м"></output></label>
      <label data-system="distant"><span>Смещение</span><input data-control="lateral" type="range" min="-500" max="500" step="5"><output data-unit="м"></output></label>
      <label data-system="tableau"><span>Отступ от дороги</span><input data-control="setback" type="range" min="0" max="320" step="5"><output data-unit="м"></output></label>
      <label><span>Масштаб</span><input data-control="scale" type="range" min="0.25" max="3" step="0.05"><output data-unit="×"></output></label>
      <label><span>Вариант seed</span><input data-control="variation" type="range" min="0" max="99" step="1"><output></output></label>
      <label data-system="tableau"><span>Длина табло</span><input data-control="length" type="range" min="100" max="1200" step="10"><output data-unit="м"></output></label>
      <label data-system="tableau"><span>Плотность табло</span><input data-control="density" type="range" min="0.05" max="1" step="0.05"><output></output></label>
    </fieldset>
    <div class="buttons"><button data-action="reset">Сбросить параметры</button><button data-action="game">Вернуться в игру</button></div>
    <div class="footer" data-drive-status>0 км/ч · камера: погоня</div>
    <div class="footer">Heat haze остаётся доступным поверх каждого визуального миража для совместной настройки.</div>`;
  document.body.appendChild(root);

  const sync = (): void => {
    root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-control]').forEach((input) => {
      const key = input.dataset.control as keyof LabState;
      const value = state[key];
      if (input instanceof HTMLInputElement && input.type === 'checkbox') input.checked = Boolean(value);
      else input.value = String(value);
      const output = input.parentElement?.querySelector('output');
      if (output) output.textContent = `${typeof value === 'number' ? Number(value.toFixed(2)) : ''}${output.dataset.unit ?? ''}`;
    });
    root.querySelectorAll<HTMLInputElement>('[data-heat]').forEach((input) => {
      const key = input.dataset.heat as keyof HeatMirageParameters;
      input.value = String(state.heat[key]);
      const output = input.parentElement?.querySelector('output');
      if (output) output.textContent = `${Number(state.heat[key].toFixed(2))}${output.dataset.unit ?? ''}`;
    });
    const system = SELECTIONS[state.selection]?.system;
    const panel = root.querySelector<HTMLElement>('.presentation');
    if (panel) panel.hidden = system === 'heat';
    // A tableau lines both verges and a distant silhouette stands alone off to one
    // side, so the two systems do not share a placement control.
    root.querySelectorAll<HTMLElement>('[data-system]').forEach((row) => {
      row.hidden = row.dataset.system !== system;
    });
  };

  root.addEventListener('input', (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement || input instanceof HTMLSelectElement)) return;
    if (input.dataset.heat) {
      const key = input.dataset.heat as keyof HeatMirageParameters;
      state.heat = { ...state.heat, [key]: Number(input.value) };
    } else if (input.dataset.control) {
      const key = input.dataset.control as keyof LabState;
      const value = input instanceof HTMLInputElement && input.type === 'checkbox'
        ? input.checked
        : key === 'quality' ? input.value : Number(input.value);
      (state as unknown as Record<string, unknown>)[key] = value;
    }
    sync();
    apply();
  });
  root.querySelectorAll<HTMLButtonElement>('[data-time]').forEach((button) => {
    button.addEventListener('click', () => {
      state.timeHours = Number(button.dataset.time);
      sync();
      apply();
    });
  });
  root.querySelector('[data-action="reset"]')?.addEventListener('click', () => {
    state.heat = { ...DEFAULT_HEAT_MIRAGE };
    state.heatStrength = 1;
    state.opacity = 0.82;
    state.distance = 560;
    state.lateral = 95;
    state.setback = 0;
    state.scale = 1;
    state.variation = 7;
    state.length = 760;
    state.density = 1;
    sync();
    apply();
  });
  root.querySelector('[data-action="game"]')?.addEventListener('click', () => {
    window.location.href = window.location.pathname;
  });
  sync();
  return root;
}

export async function bootMirageLab(): Promise<void> {
  const canvas = document.getElementById('game');
  const loading = document.getElementById('launch-loading');
  const rotateHint = document.getElementById('rotate-hint');
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error('index.html is missing #game');
  if (loading instanceof HTMLElement) loading.style.display = 'none';
  if (rotateHint instanceof HTMLElement) rotateHint.style.display = 'none';
  document.title = 'Mirage laboratory · the BRO drive';

  const state: LabState = {
    selection: 0,
    timeHours: 12,
    quality: 'standard',
    msaa: true,
    ink: DEFAULT_INK_STRENGTH,
    heatStrength: 1,
    heat: { ...DEFAULT_HEAT_MIRAGE },
    opacity: 0.82,
    distance: 560,
    lateral: 95,
    setback: 0,
    scale: 1,
    variation: 7,
    length: 760,
    density: 1,
  };
  const world = new GameWorld(newWorldState(SEED));
  const renderer = new Renderer(canvas, state.quality, state.msaa, state.ink);
  const road = new Road(SEED);
  const terrain = new Terrain(SEED, road);
  const origin = new WorldOrigin();
  const cameraPoint = road.sampleAt(CAMERA_S);
  const [physics, starField] = await Promise.all([
    PhysicsWorld.create(),
    loadStarField(new Date(parseCalendarEpoch(CALENDAR)), state.quality),
    loadCarModel(DEFAULT_CAR_MODEL_ID),
  ]);
  const sky = new Sky(renderer.scene, renderer.fog, renderer.renderer, starField);
  const distant = new DistantMirage(renderer.scene, road, terrain, SEED, origin);
  const tableau = new MirageTableau(renderer.scene, road, terrain, SEED, origin);
  const landscape = makeLandscape(road, terrain);
  const roadMesh = makeRoad(road);
  landscape.position.set(-origin.x, 0, -origin.z);
  roadMesh.position.set(-origin.x, 0.2, -origin.z);
  renderer.scene.add(landscape, roadMesh);
  addStaticMeshCollider(physics, landscape, SurfaceType.Sand);
  addStaticMeshCollider(physics, roadMesh, SurfaceType.Asphalt);
  renderer.setViewDistance(2_500);

  await warmCarModelInstances(renderer.renderer, renderer.scene, renderer.camera);
  const surfaceField = new SurfaceField(SEED);
  const roadY = roadSurfaceY(
    road,
    surfaceField,
    CAMERA_S,
    0,
    cameraPoint.x,
    cameraPoint.z,
  ) + roadMesh.position.y;
  const carState = spawnCarState(
    world,
    { modelId: DEFAULT_CAR_MODEL_ID },
    cameraPoint.x,
    carSpawnYAboveGround(carModelMeasure(DEFAULT_CAR_MODEL_ID), roadY),
    cameraPoint.z,
    cameraPoint.heading,
  );
  const vehicle = new Vehicle(physics, world, carState, renderer.scene, origin);
  vehicle.postStep();
  vehicle.syncVisuals(1);

  const input = new InputReader(canvas);
  input.setKeyBindings(world.state.settings.keyBindings);
  input.setMouseSensitivity(world.state.settings.mouseSensitivity);
  const camera = new CameraRig(renderer.camera, physics, origin);
  camera.setMode('chase');

  const apply = (): void => {
    renderer.setQuality(state.quality);
    starField.setQuality(state.quality);
    renderer.setMsaa(state.msaa);
    renderer.setInkStrength(state.ink);
    renderer.setHeatMirageParameters(state.heat);
    const selection = SELECTIONS[state.selection] ?? SELECTIONS[0]!;
    if (selection.system === 'distant') {
      tableau.hide();
      distant.showPreview(
        selection.family,
        CAMERA_S + state.distance,
        state.lateral,
        state.opacity,
        state.scale,
        state.variation,
      );
    } else if (selection.system === 'tableau') {
      distant.hide();
      tableau.showPreview(
        selection.kind,
        CAMERA_S + state.distance,
        state.length,
        state.setback,
        state.opacity,
        state.scale,
        state.variation,
        state.density,
      );
    } else {
      distant.hide();
      tableau.hide();
    }
  };
  const interfaceRoot = createInterface(state, apply);
  const driveStatus = interfaceRoot.querySelector<HTMLElement>('[data-drive-status]');
  apply();

  const target: CameraTarget = {
    x: cameraPoint.x,
    y: carState.y,
    z: cameraPoint.z,
    qx: carState.qx,
    qy: carState.qy,
    qz: carState.qz,
    qw: carState.qw,
    speedKmh: 0,
    hoodOffset: vehicle.modelMeasure.hoodPoint,
  };
  const targetPosition = new THREE.Vector3();
  const targetRotation = new THREE.Quaternion();
  const cameraInput = emptyInput();
  let lastInput: InputFrame = emptyInput();
  let lookYaw = 0;
  let lookPitch = 0;
  let zoom = 0;
  let recenter = false;
  let activeS = CAMERA_S;

  const fixedUpdate = (dt: number): void => {
    const frameInput = input.sample(dt);
    lastInput = frameInput;
    lookYaw += frameInput.lookYaw;
    lookPitch += frameInput.lookPitch;
    zoom += frameInput.zoomDelta;
    recenter ||= frameInput.recenterCamera;
    if (frameInput.cycleCamera) camera.cycleDriving();
    if (frameInput.toggleLights) vehicle.cycleHeadlights();
    if (frameInput.toggleLeftIndicator) vehicle.toggleIndicator('left');
    if (frameInput.toggleRightIndicator) vehicle.toggleIndicator('right');
    vehicle.fixedUpdate(dt, frameInput);
    physics.step();
    vehicle.postStep();
  };

  const renderFrame = (alpha: number, frameDt: number): void => {
    vehicle.syncVisuals(alpha);
    vehicle.interpolatedTransform(alpha, targetPosition, targetRotation);
    target.x = targetPosition.x;
    target.y = targetPosition.y;
    target.z = targetPosition.z;
    target.qx = targetRotation.x;
    target.qy = targetRotation.y;
    target.qz = targetRotation.z;
    target.qw = targetRotation.w;
    target.speedKmh = vehicle.speedKmh;

    Object.assign(cameraInput, lastInput);
    cameraInput.lookYaw = lookYaw;
    cameraInput.lookPitch = lookPitch;
    cameraInput.zoomDelta = zoom;
    cameraInput.recenterCamera = recenter;
    lookYaw = 0;
    lookPitch = 0;
    zoom = 0;
    recenter = false;
    camera.update(frameDt, cameraInput, target, false);

    const projection = road.project(target.x + origin.x, target.z + origin.z, activeS);
    activeS = projection.s;
    const cam = renderer.camera.position;
    const daySeconds = (state.timeHours / 24) * DAY_LENGTH;
    sky.update(
      CALENDAR,
      daySeconds,
      0,
      activeS,
      cam.x,
      cam.y,
      cam.z,
    );
    vehicle.setHeadlightEnvironmentFactor(sky.artificialLightFactor);
    distant.setPreviewDayFactor(sky.dayFactor);
    tableau.setPreviewDayFactor(sky.dayFactor, projection.lateral);
    renderer.setHazeStrength(state.heatStrength * sky.dayFactor);
    const camProjection = road.project(cam.x + origin.x, cam.z + origin.z, activeS);
    renderer.setHazeEyeHeight(
      cam.y - terrain.explorationHeightFromFrame(
        cam.x + origin.x,
        cam.z + origin.z,
        camProjection.lateral,
        camProjection.s,
      ),
    );
    if (driveStatus) {
      const cameraLabel = camera.mode === 'hood' ? 'капот' : 'погоня';
      driveStatus.textContent = `${Math.round(vehicle.speedKmh)} км/ч · камера: ${cameraLabel}`;
    }
    renderer.render();
  };

  const labWindow = window as unknown as { __renderMirageLab?: () => string };
  labWindow.__renderMirageLab = () => {
    renderFrame(1, 0);
    return canvas.toDataURL('image/png');
  };
  const loop = new GameLoop({ fixedUpdate, render: renderFrame });
  loop.start();
}
