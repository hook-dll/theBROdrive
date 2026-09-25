import * as THREE from 'three';
import { GameLoop } from './core/loop';
import { prefersMobilePresentation, Renderer } from './core/renderer';
import { DEFAULT_INK_STRENGTH, viewDistanceFor, type GraphicsQuality } from './game/settings';
import { SURFACES, SurfaceType } from './core/surfaces';
import { parseCalendarEpoch } from './game/calendar';
import { DAY_LENGTH, newWorldState } from './game/state';
import { ROAD_TILE_METRES, roadTextures } from './render/roadtexture';
import { Sky } from './render/sky';
import { loadStarField } from './render/starcatalog';
import { CHUNK_LENGTH, type ChunkContent, type ChunkContext } from './world/chunks';
import { MAX_WEAR, roadConditionAt } from './world/gradient';
import { Road, ROAD_LENGTH } from './world/road';
import { RoadMeshProvider, roadAsphaltMaterial } from './world/roadmesh';
import { RoadDistance } from './world/roaddistance';
import { roadSurfaceY, SurfaceField } from './world/roadsurface';
import { Terrain } from './world/terrain';
import { TerrainMeshProvider } from './world/terrainmesh';

/**
 * ROAD LOOK LABORATORY.
 *
 * The road is the one surface in the game you cannot simply go and look at. Its detail
 * lives at the 1-30 cm scale, the tile repeats every 24 m, and the stretch worth
 * judging is usually minutes of driving away — so every question about how the asphalt
 * reads ("is that pixel art or aggregate", "does the repeat show", "is that blotch the
 * map or the vertex colour") was being answered from memory of a drive.
 *
 * So this builds the REAL providers — `RoadMeshProvider` and `TerrainMeshProvider`,
 * the same two the chunk streamer drives — around any arclength you pick, under the
 * REAL `Renderer` and `Sky`. The presets are the ones that answered questions during
 * the surface rewrite: a hood view for what the driver sees, a straight-down view with
 * no grazing angle (which is what tells a tile apart from what anisotropic filtering
 * did to it), and a kerb and a side view for the mat's edge and the shoulder.
 *
 * THE SWITCHES EXIST BECAUSE A SURFACE HAS THREE INDEPENDENT INPUTS and an artefact can
 * belong to any of them: the tiled map, the tangent-space normals baked from it, and the
 * per-vertex weathering the mesh paints on top. Dropping the vertex colour (leaving the
 * flat lane albedo, brightness-corrected exactly the way the mesh corrects it) or
 * dropping the normal map says which one is on screen. The 24 m grid shows where the
 * repeat actually falls in world space, which no still frame can tell you.
 *
 * Dev-only, reached by query string: `/?road-lab`, and scriptable so a headless capture
 * can name the state it photographed — `/?road-lab&s=22800`, `&pick=worst|sand|paint|
 * gravel|concrete`, `&view=top`, `&vc=0`, `&nm=0`, `&grid=1`, `&time=17.5`.
 * `window.__roadLab` exposes the same knobs, plus `render(): dataURL`.
 */

/** Seed. Fixed rather than random: two visits must show the same road. */
const SEED = 1337;
const CALENDAR = newWorldState(SEED).calendarEpoch;
/** Chunks either side of the centre one, so the visible window is 1 km of road. */
const WINDOW_RADIUS = 2;
/** Candidate arclength step for the "find a stretch like this" scans, metres. */
const SCAN_STEP = 50;
/** Sub-sample step along the grid overlay's longitudinal lines, metres. */
const GRID_STEP = 4;

const VIEWS = ['hood', 'chase', 'near', 'kerb', 'top', 'side'] as const;
type View = (typeof VIEWS)[number];

const VIEW_LABELS: Record<View, string> = {
  hood: 'Капот',
  chase: 'Погоня',
  near: 'Близко (7 м)',
  kerb: 'Обочина',
  top: 'Сверху (тайл)',
  side: 'Сбоку (пейзаж)',
};

/**
 * Where to stand, in the road frame at the chosen arclength. Every preset is an eye and
 * a target ON the mat, so a preset stays on the road across a crest or a pothole.
 * `offEdge` is metres out past the asphalt edge; zero means the centreline.
 */
const VIEW_PLACEMENT: Record<
  View,
  {
    readonly eyeBack: number;
    readonly eyeOffEdge: number;
    readonly eyeLift: number;
    readonly toAhead: number;
    readonly toLift: number;
  }
> = {
  hood: { eyeBack: 0, eyeOffEdge: 0, eyeLift: 1.35, toAhead: 60, toLift: 0.2 },
  chase: { eyeBack: 7.5, eyeOffEdge: 0, eyeLift: 2.4, toAhead: 25, toLift: 0.4 },
  near: { eyeBack: 0, eyeOffEdge: 0, eyeLift: 1.55, toAhead: 7, toLift: 0 },
  kerb: { eyeBack: 3, eyeOffEdge: 2.2, eyeLift: 1.1, toAhead: 9, toLift: 0 },
  // Straight down from 5 m: the eye sits directly over the target, so there is no
  // grazing angle and the tile is judged as a texture rather than as what anisotropic
  // filtering made of it toward the horizon.
  top: { eyeBack: 0, eyeOffEdge: 0, eyeLift: 5, toAhead: 0, toLift: 0 },
  side: { eyeBack: 120, eyeOffEdge: 40, eyeLift: 12, toAhead: 0, toLift: 0 },
};

interface Scan {
  /** ASCII key for the `pick` query parameter. */
  readonly key: string;
  readonly label: string;
  /** Higher wins. */
  readonly score: (s: number) => number;
}

const SCANS: readonly Scan[] = [
  {
    key: 'worst',
    label: 'Худший асфальт',
    // Sealed is worth a nudge over the same decay on gravel: a ruined asphalt mat is
    // where aggregate, patches and paint are all supposed to be legible. The sand term
    // only breaks ties, and there are many of those: with wear capped at MAX_WEAR a
    // third of the road sits at exactly the ceiling, so without it the scan would
    // always answer with the first plateau rather than the emptiest one.
    score: (s) => {
      const c = roadConditionAt(s);
      const sealed = c.surface === SurfaceType.Asphalt || c.surface === SurfaceType.CrackedAsphalt;
      return c.decay + (sealed ? 0.25 : 0) + c.sandCover * 0.05;
    },
  },
  { key: 'sand', label: 'Максимум песка', score: (s) => roadConditionAt(s).sandCover },
  { key: 'paint', label: 'Живая разметка', score: (s) => roadConditionAt(s).markings },
  {
    key: 'gravel',
    label: 'Гравий',
    score: (s) => (roadConditionAt(s).surface === SurfaceType.Gravel ? roadConditionAt(s).decay : -1),
  },
  {
    key: 'concrete',
    label: 'Бетон',
    score: (s) => (roadConditionAt(s).surface === SurfaceType.Concrete ? roadConditionAt(s).decay : -1),
  },
];

/** The best arclength for a scan, over the whole road. */
function bestFor(scan: Scan): number {
  let best = -Infinity;
  let at = 0;
  for (let s = 0; s <= ROAD_LENGTH; s += SCAN_STEP) {
    const score = scan.score(s);
    if (score > best) {
      best = score;
      at = s;
    }
  }
  return at;
}

interface LabState {
  /** Arclength of the point under the camera. */
  s: number;
  view: View;
  timeHours: number;
  quality: GraphicsQuality;
  /** Draw the mat with the flat lane albedo only: no per-vertex weathering. */
  textureOnly: boolean;
  /** Drop the normal map, to tell a map artefact from a shading one. */
  noNormals: boolean;
  /** Overlay the 24 m tile grid, to see where the repeat falls. */
  tileGrid: boolean;
}

const UP = new THREE.Vector3(0, 1, 0);

class RoadLookLab {
  private readonly state: LabState;
  private readonly road: Road;
  private readonly terrain: Terrain;
  private readonly field: SurfaceField;
  private readonly roadProvider: RoadMeshProvider;
  private readonly terrainProvider: TerrainMeshProvider;
  private readonly renderer: Renderer;
  private readonly sky: Sky;
  private readonly root = new THREE.Group();
  /** The frame every built chunk is expressed in, frozen when the window is built. */
  private originX = 0;
  private originZ = 0;
  private windowCentre = Number.NaN;
  private built: ChunkContent[] = [];
  private grid: THREE.LineSegments | null = null;
  /** Camera orbit from the drag handler, radians, applied on top of the preset. */
  private readonly look = { yaw: 0, pitch: 0 };
  private readonly scratchTarget = new THREE.Vector3();
  private readonly scratchOffset = new THREE.Vector3();
  private onReadout: (text: string) => void = () => undefined;

  constructor(renderer: Renderer, sky: Sky, state: LabState) {
    this.renderer = renderer;
    this.sky = sky;
    this.state = state;
    this.road = new Road(SEED);
    this.terrain = new Terrain(SEED, this.road);
    this.field = new SurfaceField(SEED);
    this.roadProvider = new RoadMeshProvider(SEED);
    this.terrainProvider = new TerrainMeshProvider(new RoadDistance(this.road));
    renderer.scene.add(this.root);
  }

  setReadout(sink: (text: string) => void): void {
    this.onReadout = sink;
  }

  /** Adds a drag to the camera orbit. */
  orbit(dyaw: number, dpitch: number): void {
    this.look.yaw -= dyaw;
    this.look.pitch = Math.max(-1.45, Math.min(1.45, this.look.pitch - dpitch));
  }

  /** Absolute mat height at (s, lateral). */
  private matY(s: number, lateral: number, x: number, z: number): number {
    return roadSurfaceY(this.road, this.field, s, lateral, x, z);
  }

  /** Chunk context for one index, in the current origin frame. */
  private context(chunkIndex: number): ChunkContext {
    return {
      chunkIndex,
      sStart: Math.max(0, chunkIndex * CHUNK_LENGTH),
      sEnd: Math.min(ROAD_LENGTH, (chunkIndex + 1) * CHUNK_LENGTH),
      road: this.road,
      terrain: this.terrain,
      physics: null as never,
      world: null as never,
      hasPhysics: false,
      originX: this.originX,
      originZ: this.originZ,
    };
  }

  /** Rebuilds the visible window of road and desert around `s`, if it changed. */
  private ensureWindow(): void {
    const centre = Math.round(this.state.s / CHUNK_LENGTH);
    if (centre === this.windowCentre) return;
    this.windowCentre = centre;

    for (const content of this.built) {
      content.group.removeFromParent();
      content.group.clear();
      content.dispose?.();
    }
    this.built = [];

    // The origin is frozen at the window's midpoint, so a chunk at either end is still
    // within a few hundred metres of zero — the same f32 argument the game's streamer
    // makes, and the reason this lab can be scripted to any arclength.
    const centreS = Math.min((centre + 0.5) * CHUNK_LENGTH, ROAD_LENGTH);
    const at = this.road.offsetPoint(centreS, 0);
    this.originX = at.x;
    this.originZ = at.z;

    for (let i = centre - WINDOW_RADIUS; i <= centre + WINDOW_RADIUS; i++) {
      const terrain = this.terrainProvider.build(this.context(i));
      if (terrain) {
        this.built.push(terrain);
        this.root.add(terrain.group);
      }
      const road = this.roadProvider.build(this.context(i));
      if (road) {
        this.built.push(road);
        this.root.add(road.group);
      }
    }
    this.rebuildGrid();
  }

  /**
   * The 24 m tile grid, drawn on the mat.
   *
   * Both axes: the mesh writes U as `lateral / 24 m` and V with arclength, so a tile
   * boundary is an arclength multiple AND a lateral multiple. This is the one overlay
   * that answers "is that pattern the texture repeating" directly — nobody can count
   * 24 m of road off a still frame, and a repeat is the artefact most easily mistaken
   * for wear.
   */
  private rebuildGrid(): void {
    if (this.grid) {
      this.grid.geometry.dispose();
      this.grid.removeFromParent();
      this.grid = null;
    }
    if (!this.state.tileGrid) return;

    const sFrom = Math.max(0, (this.windowCentre - WINDOW_RADIUS) * CHUNK_LENGTH);
    const sTo = Math.min(ROAD_LENGTH, (this.windowCentre + WINDOW_RADIUS + 1) * CHUNK_LENGTH);
    const points: number[] = [];
    const point = { x: 0, y: 0, z: 0 };
    const edge = (s: number): number => Math.max(this.road.halfWidthAt(s) + 0.6, 3.6);
    const put = (s: number, lateral: number): void => {
      this.road.offsetPoint(s, lateral, point);
      points.push(
        point.x - this.originX,
        this.matY(s, lateral, point.x, point.z) + 0.012,
        point.z - this.originZ,
      );
    };

    for (let s = Math.ceil(sFrom / ROAD_TILE_METRES) * ROAD_TILE_METRES; s <= sTo; s += ROAD_TILE_METRES) {
      put(s, -edge(s));
      put(s, edge(s));
    }
    const reach = Math.ceil(edge(this.state.s) / ROAD_TILE_METRES) * ROAD_TILE_METRES;
    for (let lateral = -reach; lateral <= reach; lateral += ROAD_TILE_METRES) {
      for (let s = sFrom; s < sTo; s += GRID_STEP) {
        put(s, lateral);
        put(Math.min(sTo, s + GRID_STEP), lateral);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    this.grid = new THREE.LineSegments(
      geometry,
      new THREE.LineBasicMaterial({ color: 0xff3b1f, transparent: true, opacity: 0.5 }),
    );
    this.grid.renderOrder = 5;
    this.root.add(this.grid);
  }

  /** Points the camera for the current view and arclength. */
  private place(): void {
    const { s, view } = this.state;
    const place = VIEW_PLACEMENT[view];
    const edgeAt = (at: number): number =>
      place.eyeOffEdge === 0 ? 0 : this.road.halfWidthAt(at) + place.eyeOffEdge;

    const eyeS = Math.max(0, Math.min(ROAD_LENGTH - 1e-3, s - place.eyeBack));
    const toS = Math.max(0, Math.min(ROAD_LENGTH - 1e-3, s + place.toAhead));
    const eyeLateral = edgeAt(eyeS);
    const eye = this.road.offsetPoint(eyeS, eyeLateral);
    const to = this.road.offsetPoint(toS, 0);
    const eyeY = this.matY(eyeS, eyeLateral, eye.x, eye.z) + place.eyeLift;
    const toY = this.matY(toS, 0, to.x, to.z) + place.toLift;

    this.scratchTarget.set(to.x - this.originX, toY, to.z - this.originZ);
    this.scratchOffset.set(eye.x - to.x, eyeY - toY, eye.z - to.z);
    if (this.look.yaw !== 0 || this.look.pitch !== 0) {
      this.scratchOffset.applyAxisAngle(UP, this.look.yaw);
      const axis = this.scratchOffset.clone().cross(UP);
      if (axis.lengthSq() > 1e-9) {
        this.scratchOffset.applyAxisAngle(axis.normalize(), this.look.pitch);
      }
    }
    this.renderer.camera.position.copy(this.scratchTarget).add(this.scratchOffset);
    // `lookAt` with the default up is degenerate on the straight-down preset, so a
    // horizontal world axis stands in for "up" there.
    const straightDown = Math.abs(this.scratchOffset.y) > this.scratchOffset.length() * 0.98;
    this.renderer.camera.up.set(0, straightDown ? 0 : 1, straightDown ? -1 : 0);
    this.renderer.camera.lookAt(this.scratchTarget);
    this.renderer.camera.up.set(0, 1, 0);
  }

  /** Applies the material switches and the renderer settings. */
  apply(): void {
    const textures = roadTextures();
    const material = roadAsphaltMaterial();
    if (this.state.textureOnly) {
      material.vertexColors = false;
      // The mesh divides its vertex colours by the map's mean so the surface keeps its
      // old brightness; the flat albedo has to carry the same correction, or the switch
      // would also be a brightness change and the comparison would be worthless.
      material.color
        .setHex(SURFACES[SurfaceType.Asphalt].color)
        .multiplyScalar(1 / Math.max(0.2, textures.mean));
    } else {
      material.vertexColors = true;
      material.color.setHex(0xffffff);
    }
    material.normalMap = this.state.noNormals ? null : textures.normal;
    material.normalScale.set(0.5, 0.5);
    material.needsUpdate = true;

    const mobile = prefersMobilePresentation();
    this.renderer.setQuality(this.state.quality);
    this.renderer.setViewDistance(viewDistanceFor(this.state.quality, mobile));
    this.rebuildGrid();
  }

  /** One frame: rebuild the window if needed, place the camera, update the sky, draw. */
  frame(): void {
    this.ensureWindow();
    this.place();
    const { s } = this.state;
    const daySeconds = (this.state.timeHours / 24) * DAY_LENGTH;
    // The camera position AS THE SCENE HOLDS IT, never its absolute world position.
    // The sky re-centres its 3 km dome on this point every frame with `side: BackSide`,
    // so handing it an absolute coordinate puts the eye 18 km outside its own sky at
    // the arclengths this lab is pointed at, and the dome renders as nothing at all.
    const eye = this.renderer.camera.position;
    this.sky.update(CALENDAR, daySeconds, 0, s, eye.x, eye.y, eye.z);
    this.sky.updateClouds(eye.x + this.originX, eye.z + this.originZ);
    this.renderer.render();

    const condition = roadConditionAt(s);
    this.onReadout(
      `${(s / 1000).toFixed(3)} км · ${SURFACES[condition.surface].label}`
      + ` · износ ${condition.decay.toFixed(2)} (потолок ${MAX_WEAR.toFixed(2)})`
      + ` · песок ${condition.sandCover.toFixed(2)} · разметка ${condition.markings.toFixed(2)}`
      + ` · полоса ±${this.road.halfWidthAt(s).toFixed(2)} м · тайл ${ROAD_TILE_METRES} м`,
    );
  }
}

function createInterface(
  state: LabState,
  actions: { apply: () => void; jump: (s: number) => void },
): { root: HTMLElement; readout: (text: string) => void } {
  const root = document.createElement('div');
  root.className = 'road-lab';
  root.innerHTML = `
    <style>
      .road-lab{position:fixed;z-index:50;left:14px;top:14px;width:min(362px,calc(100vw - 28px));max-height:calc(100vh - 28px);overflow:auto;padding:14px;color:#eadfca;background:rgba(19,17,13,.91);border:1px solid #82735b;font:12px/1.35 Consolas,monospace;box-shadow:0 8px 35px #0008}
      .road-lab h1{font:700 19px/1.1 "Segoe UI",sans-serif;margin:0 0 6px}
      .road-lab p{color:#bfb39e;margin:0 0 11px}
      .road-lab fieldset{border:1px solid #554a39;margin:0 0 10px;padding:9px}
      .road-lab legend{color:#d7bd89;padding:0 5px}
      .road-lab label{display:grid;grid-template-columns:1fr 128px 58px;gap:7px;align-items:center;margin:6px 0}
      .road-lab label.check{grid-template-columns:1fr 20px;justify-items:start}
      .road-lab input[type=range]{width:100%}
      .road-lab output{text-align:right;color:#f2d59b}
      .road-lab select,.road-lab button{color:#eadfca;background:#2b251b;border:1px solid #6b5c44;padding:6px;font:12px Consolas,monospace}
      .road-lab select{width:100%}
      .road-lab .buttons{display:flex;gap:6px;flex-wrap:wrap}
      .road-lab .buttons button{flex:1 1 auto}
      .road-lab button:hover{background:#5c4930}
      .road-lab .readout{color:#f2d59b;background:#141109;border:1px solid #554a39;padding:7px;margin-top:9px;font-variant-numeric:tabular-nums}
      .road-lab .footer{color:#8f8471;margin-top:9px}
    </style>
    <h1>ЛАБОРАТОРИЯ ДОРОГИ</h1>
    <p>Перетаскивание мышью — взгляд · 1-6 — ракурс. Настоящие провайдеры дороги и пустыни, настоящий рендерер и небо.</p>
    <fieldset><legend>Участок</legend>
      <label><span>Километр</span><input data-control="s" type="range" min="0" max="${ROAD_LENGTH}" step="10"><output></output></label>
      <div class="buttons"><button type="button" data-action="start">Начало</button><button type="button" data-action="prev">-100 м</button><button type="button" data-action="next">+100 м</button></div>
      <div class="buttons">${SCANS.map((scan, index) => `<button type="button" data-scan="${index}">${scan.label}</button>`).join('')}</div>
    </fieldset>
    <fieldset><legend>Ракурс</legend>
      <select data-control="view">${VIEWS.map((view) => `<option value="${view}">${VIEW_LABELS[view]}</option>`).join('')}</select>
    </fieldset>
    <fieldset><legend>Свет и качество</legend>
      <label><span>Время суток</span><input data-control="timeHours" type="range" min="0" max="24" step="0.05"><output></output></label>
      <div class="buttons"><button type="button" data-time="7">Утро</button><button type="button" data-time="12">Полдень</button><button type="button" data-time="17.5">Закат</button></div>
      <label><span>Качество</span><select data-control="quality"><option value="acceptable">acceptable</option><option value="standard">standard</option><option value="blessing">blessing</option></select><output></output></label>
    </fieldset>
    <fieldset><legend>Изоляция слоёв</legend>
      <label class="check"><span>Только текстура (без вершинного цвета)</span><input data-control="textureOnly" type="checkbox"></label>
      <label class="check"><span>Без карты нормалей</span><input data-control="noNormals" type="checkbox"></label>
      <label class="check"><span>Сетка тайла 24 м</span><input data-control="tileGrid" type="checkbox"></label>
    </fieldset>
    <div class="buttons"><button type="button" data-action="game">Вернуться в игру</button></div>
    <div class="readout" data-readout>—</div>
    <div class="footer">Слои: тайл → нормали → вершинный цвет. Если артефакт исчез при «только текстура», он в меше, а не в карте.</div>`;

  const sync = (): void => {
    root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-control]').forEach((input) => {
      const key = input.dataset.control as keyof LabState;
      const value = state[key];
      if (input instanceof HTMLInputElement && input.type === 'checkbox') input.checked = Boolean(value);
      else input.value = String(value);
      const output = input.parentElement?.querySelector('output');
      if (output) output.textContent = typeof value === 'number' ? String(Number(value.toFixed(2))) : '';
    });
  };

  root.addEventListener('input', (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement || input instanceof HTMLSelectElement)) return;
    const key = input.dataset.control as keyof LabState | undefined;
    if (!key) return;
    const value = input instanceof HTMLInputElement && input.type === 'checkbox'
      ? input.checked
      : key === 'view' || key === 'quality'
        ? input.value
        : Number(input.value);
    (state as unknown as Record<string, unknown>)[key] = value;
    sync();
    actions.apply();
  });
  root.querySelector('[data-action="start"]')?.addEventListener('click', () => {
    actions.jump(0);
    sync();
  });
  root.querySelector('[data-action="prev"]')?.addEventListener('click', () => {
    actions.jump(state.s - 100);
    sync();
  });
  root.querySelector('[data-action="next"]')?.addEventListener('click', () => {
    actions.jump(state.s + 100);
    sync();
  });
  root.querySelectorAll<HTMLButtonElement>('[data-scan]').forEach((button) => {
    button.addEventListener('click', () => {
      const scan = SCANS[Number(button.dataset.scan)];
      if (scan) actions.jump(bestFor(scan));
      sync();
    });
  });
  root.querySelectorAll<HTMLButtonElement>('[data-time]').forEach((button) => {
    button.addEventListener('click', () => {
      state.timeHours = Number(button.dataset.time);
      sync();
      actions.apply();
    });
  });
  root.querySelector('[data-action="game"]')?.addEventListener('click', () => {
    window.location.href = window.location.pathname;
  });

  const readout = root.querySelector<HTMLElement>('[data-readout]');
  document.body.appendChild(root);
  sync();
  return {
    root,
    readout: (text) => {
      if (readout) readout.textContent = text;
    },
  };
}

export async function bootRoadLab(): Promise<void> {
  const canvas = document.getElementById('game');
  const loading = document.getElementById('launch-loading');
  const rotateHint = document.getElementById('rotate-hint');
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error('index.html is missing #game');
  if (rotateHint instanceof HTMLElement) rotateHint.style.display = 'none';
  document.title = 'Road laboratory · the BRO drive';

  const query = new URLSearchParams(window.location.search);
  const pick = SCANS.find((scan) => scan.key === query.get('pick'));
  const view = query.get('view');
  const state: LabState = {
    s: query.get('s') !== null
      ? Number(query.get('s'))
      : pick
        ? bestFor(pick)
        : 22_800,
    view: view !== null && (VIEWS as readonly string[]).includes(view) ? (view as View) : 'hood',
    timeHours: query.get('time') !== null ? Number(query.get('time')) : 12,
    quality: 'standard',
    textureOnly: query.get('vc') === '0',
    noNormals: query.get('nm') === '0',
    tileGrid: query.get('grid') === '1',
  };

  const mobile = prefersMobilePresentation();
  const renderer = new Renderer(canvas, state.quality, true, DEFAULT_INK_STRENGTH, mobile);
  const starField = await loadStarField(
    new Date(parseCalendarEpoch(CALENDAR)),
    state.quality,
    mobile,
  );
  const sky = new Sky(renderer.scene, renderer.fog, renderer.renderer, starField);
  await sky.waitForAssets();

  const lab = new RoadLookLab(renderer, sky, state);
  const ui = createInterface(state, {
    apply: () => lab.apply(),
    jump: (s) => {
      state.s = Math.max(0, Math.min(ROAD_LENGTH, s));
    },
  });
  lab.setReadout(ui.readout);
  lab.apply();

  // Drag to orbit. Looking around is the only way to read the relief on the mat: a
  // fixed camera at a fixed sun says less than the same surface from two angles.
  let dragging: { x: number; y: number } | null = null;
  canvas.addEventListener('pointerdown', (event) => {
    dragging = { x: event.clientX, y: event.clientY };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    lab.orbit((event.clientX - dragging.x) * 0.0035, (event.clientY - dragging.y) * 0.0035);
    dragging = { x: event.clientX, y: event.clientY };
  });
  const release = (event: PointerEvent): void => {
    dragging = null;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  window.addEventListener('keydown', (event) => {
    const index = Number(event.key);
    if (!Number.isInteger(index) || index < 1 || index > VIEWS.length) return;
    state.view = VIEWS[index - 1]!;
    const select = ui.root.querySelector<HTMLSelectElement>('[data-control="view"]');
    if (select) select.value = state.view;
  });

  const labWindow = window as unknown as {
    __roadLab?: {
      state: LabState;
      set: (patch: Partial<LabState>) => void;
      render: () => string;
      readout: () => string;
    };
  };
  labWindow.__roadLab = {
    state,
    set: (patch) => {
      Object.assign(state, patch);
      lab.apply();
    },
    render: () => {
      lab.frame();
      return canvas.toDataURL('image/png');
    },
    readout: () => ui.root.querySelector('[data-readout]')?.textContent ?? '',
  };

  // The first window is a real build of five terrain chunks and five road chunks, so the
  // cover comes off only once there is something to look at — the way the game does it.
  lab.frame();
  if (loading instanceof HTMLElement) loading.classList.add('is-hidden');

  const loop = new GameLoop({
    fixedUpdate: () => undefined,
    render: () => lab.frame(),
  });
  loop.start();
}
