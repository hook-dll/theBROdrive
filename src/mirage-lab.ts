import * as THREE from 'three';
import {
  DEFAULT_HEAT_MIRAGE,
  Renderer,
  type HeatMirageParameters,
} from './core/renderer';
import { parseCalendarEpoch } from './game/calendar';
import { DEFAULT_INK_STRENGTH, type GraphicsQuality } from './game/settings';
import { DAY_LENGTH, newWorldState } from './game/state';
import { applyComicShading } from './render/comic';
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

function createInterface(state: LabState, apply: () => void): HTMLElement {
  const root = document.createElement('aside');
  root.className = 'mirage-lab';
  root.innerHTML = `
    <style>
      .mirage-lab{position:fixed;z-index:50;left:14px;top:14px;bottom:14px;width:min(390px,calc(100vw - 28px));overflow:auto;padding:15px;color:#eadfca;background:rgba(19,17,13,.91);border:1px solid #82735b;font:12px/1.3 Consolas,monospace;box-shadow:0 8px 35px #0008}
      .mirage-lab h1{font:700 20px/1.1 "Segoe UI",sans-serif;margin:0 0 5px}.mirage-lab p{color:#bfb39e;margin:0 0 12px}.mirage-lab fieldset{border:1px solid #554a39;margin:0 0 10px;padding:9px}.mirage-lab legend{color:#d7bd89;padding:0 5px}.mirage-lab label{display:grid;grid-template-columns:1fr 142px 57px;gap:7px;align-items:center;margin:6px 0}.mirage-lab input[type=range]{width:100%}.mirage-lab output{text-align:right;color:#f2d59b}.mirage-lab select,.mirage-lab button{color:#eadfca;background:#2b251b;border:1px solid #6b5c44;padding:6px;font:12px Consolas,monospace}.mirage-lab select{width:100%;margin-bottom:9px}.mirage-lab .buttons{display:flex;gap:6px;flex-wrap:wrap}.mirage-lab button:hover{background:#5c4930}.mirage-lab .presentation[hidden]{display:none}.mirage-lab .footer{color:#988c78;margin-top:8px}
    </style>
    <h1>ЛАБОРАТОРИЯ МИРАЖЕЙ</h1>
    <p>Production Renderer, Sky, comic shading и физический рельеф. Перетаскивание — обзор, колесо — FOV.</p>
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
      <label><span>Смещение</span><input data-control="lateral" type="range" min="-500" max="500" step="5"><output data-unit="м"></output></label>
      <label><span>Масштаб</span><input data-control="scale" type="range" min="0.25" max="3" step="0.05"><output data-unit="×"></output></label>
      <label><span>Вариант seed</span><input data-control="variation" type="range" min="0" max="99" step="1"><output></output></label>
      <label><span>Длина табло</span><input data-control="length" type="range" min="100" max="1200" step="10"><output data-unit="м"></output></label>
      <label><span>Плотность табло</span><input data-control="density" type="range" min="0.05" max="1" step="0.05"><output></output></label>
    </fieldset>
    <div class="buttons"><button data-action="reset">Сбросить параметры</button><button data-action="game">Вернуться в игру</button></div>
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
    const panel = root.querySelector<HTMLElement>('.presentation');
    if (panel) panel.hidden = SELECTIONS[state.selection]?.system === 'heat';
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
    scale: 1,
    variation: 7,
    length: 760,
    density: 1,
  };
  const renderer = new Renderer(canvas, state.quality, state.msaa, state.ink);
  const road = new Road(SEED);
  const terrain = new Terrain(SEED, road);
  const origin = new WorldOrigin();
  const cameraPoint = road.sampleAt(CAMERA_S);
  const starField = await loadStarField(new Date(parseCalendarEpoch(CALENDAR)), state.quality);
  const sky = new Sky(renderer.scene, renderer.fog, renderer.renderer, starField);
  const distant = new DistantMirage(renderer.scene, road, terrain, SEED, origin);
  const tableau = new MirageTableau(renderer.scene, road, terrain, SEED, origin);
  const landscape = makeLandscape(road, terrain);
  const roadMesh = makeRoad(road);
  landscape.position.set(-origin.x, 0, -origin.z);
  roadMesh.position.set(-origin.x, 0.2, -origin.z);
  renderer.scene.add(landscape, roadMesh);
  renderer.camera.position.set(
    cameraPoint.x - origin.x,
    cameraPoint.y + 2.1,
    cameraPoint.z - origin.z,
  );
  renderer.camera.rotation.order = 'YXZ';
  renderer.camera.rotation.y = cameraPoint.heading;
  renderer.camera.rotation.x = -0.2;
  renderer.setViewDistance(2_500);
  renderer.setHazeEyeHeight(2.1);

  let yaw = cameraPoint.heading + Math.PI;
  let pitch = -0.2;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  canvas.addEventListener('pointerdown', (event) => {
    dragging = true;
    lastX = event.clientX;
    lastY = event.clientY;
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    yaw -= (event.clientX - lastX) * 0.003;
    pitch = THREE.MathUtils.clamp(pitch - (event.clientY - lastY) * 0.003, -1.2, 0.6);
    lastX = event.clientX;
    lastY = event.clientY;
  });
  canvas.addEventListener('pointerup', () => { dragging = false; });
  canvas.addEventListener('wheel', (event) => {
    renderer.camera.fov = THREE.MathUtils.clamp(renderer.camera.fov + event.deltaY * 0.025, 25, 90);
    renderer.camera.updateProjectionMatrix();
  }, { passive: true });

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
        state.lateral,
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
  createInterface(state, apply);
  apply();

  const labWindow = window as unknown as { __renderMirageLab?: () => string };
  const renderFrame = (): string => {
    renderer.camera.rotation.set(pitch, yaw, 0);
    const daySeconds = (state.timeHours / 24) * DAY_LENGTH;
    sky.update(
      CALENDAR,
      daySeconds,
      0,
      CAMERA_S,
      renderer.camera.position.x,
      renderer.camera.position.y,
      renderer.camera.position.z,
    );
    distant.setPreviewDayFactor(sky.dayFactor);
    tableau.setPreviewDayFactor(sky.dayFactor);
    renderer.setHazeStrength(state.heatStrength * sky.dayFactor);
    renderer.render();
    return canvas.toDataURL('image/png');
  };
  labWindow.__renderMirageLab = renderFrame;
  const frame = (): void => {
    renderFrame();
    window.setTimeout(() => requestAnimationFrame(frame), 1000 / 30);
  };
  window.setTimeout(() => requestAnimationFrame(frame), 1000 / 30);
}
