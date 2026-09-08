import * as THREE from 'three';
import { AdaptiveResolutionController } from './core/adaptivequality';
import { makeFlatMaterial } from './render/materials';
import { createPoiVariant, mergePoiStatics, POI_VARIANTS } from './world/poi-variants';

const GRID_COLUMNS = 5;
const CELL_X = 38;
const CELL_Z = 32;
const GRID_ROWS = Math.ceil(POI_VARIANTS.length / GRID_COLUMNS);
const OVERVIEW_Y = Math.max(72, GRID_ROWS * 18);
const OVERVIEW_Z = Math.max(120, GRID_ROWS * 27);
const WALK_SPEED = 8;
const FAST_SPEED = 24;
const EYE_HEIGHT = 1.75;
/** Mirrors the game's 'acceptable' tier budget: 1600x900 rendered pixels. */
const MAX_RENDER_PIXELS = 1600 * 900;

function pixelRatio(): number {
  const cssPixels = Math.max(1, window.innerWidth * window.innerHeight);
  return Math.min(window.devicePixelRatio, Math.sqrt(MAX_RENDER_PIXELS / cssPixels));
}

interface GalleryEntry {
  readonly definition: (typeof POI_VARIANTS)[number];
  readonly root: THREE.Group;
  readonly x: number;
  readonly z: number;
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
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
  sprite.scale.set(10.7, 4.0, 1);
  sprite.renderOrder = 20;
  return sprite;
}

function createInterface(entries: readonly GalleryEntry[], focus: (index: number) => void, overview: () => void, toggleRoofs: () => boolean): HTMLElement {
  const root = document.createElement('div');
  root.className = 'poi-gallery-ui';
  root.innerHTML = `
    <style>
      .poi-gallery-ui { position:fixed; inset:0; z-index:40; pointer-events:none; color:#eadfca; font:13px/1.35 "Segoe UI",sans-serif; }
      .poi-gallery-head { position:absolute; left:18px; top:18px; max-width:440px; padding:13px 15px; background:rgba(24,20,14,.88); border:1px solid rgba(234,223,202,.34); box-shadow:0 6px 22px rgba(0,0,0,.32); }
      .poi-gallery-title { font:bold 19px/1.1 "Segoe UI",sans-serif; letter-spacing:.04em; margin-bottom:7px; }
      .poi-gallery-help { color:#c8bda8; }
      .poi-gallery-list { position:absolute; right:14px; top:14px; bottom:14px; width:270px; display:flex; flex-direction:column; gap:5px; overflow:auto; padding:10px; pointer-events:auto; background:rgba(20,17,12,.86); border:1px solid rgba(234,223,202,.28); }
      .poi-gallery-list button, .poi-gallery-actions button { min-height:31px; border:1px solid rgba(234,223,202,.24); background:#2b251b; color:#eadfca; padding:6px 9px; text-align:left; cursor:pointer; font:12px "Segoe UI",sans-serif; }
      .poi-gallery-list button:hover, .poi-gallery-list button.is-active, .poi-gallery-actions button:hover { background:#5c4930; border-color:#d7bd89; }
      .poi-gallery-list b { display:inline-block; width:25px; color:#d7bd89; }
      .poi-gallery-actions { position:absolute; left:18px; bottom:18px; display:flex; gap:7px; pointer-events:auto; }
      .poi-gallery-actions button { text-align:center; padding:8px 13px; }
      .poi-gallery-status { position:absolute; left:50%; bottom:18px; transform:translateX(-50%); padding:8px 12px; background:rgba(20,17,12,.8); color:#d7bd89; }
      .poi-gallery-crosshair { position:absolute; left:50%; top:50%; width:12px; height:12px; transform:translate(-50%,-50%); opacity:.72; }
      .poi-gallery-crosshair::before, .poi-gallery-crosshair::after { content:\"\"; position:absolute; background:#f0dfb8; box-shadow:0 0 3px #1b160f; }
      .poi-gallery-crosshair::before { left:5px; top:0; width:2px; height:12px; }
      .poi-gallery-crosshair::after { left:0; top:5px; width:12px; height:2px; }
      @media (max-width:900px) { .poi-gallery-list { width:220px; } .poi-gallery-head { max-width:360px; } }
    </style>
    <section class="poi-gallery-head">
      <div class="poi-gallery-title">ГАЛЕРЕЯ POI · ${entries.length} ВАРИАНТОВ</div>
      <div class="poi-gallery-help">Клик по сцене — захват мыши · ЛКМ по выключателю — свет · WASD — движение · Q/E или Ctrl/Space — вниз/вверх · Shift — ускорение · H — снять крыши · R — общий вид · Esc — отпустить мышь</div>
    </section>
    <nav class="poi-gallery-list" aria-label="Варианты POI"></nav>
    <div class="poi-gallery-actions">
      <button type="button" data-action="overview">Общий вид (R)</button>
      <button type="button" data-action="roofs">Снять крыши (H)</button>
      <button type="button" data-action="game">Вернуться в игру</button>
    </div>
    <div class="poi-gallery-status">Общий вид · крыши включены</div>
    <div class="poi-gallery-crosshair" aria-hidden="true"></div>
  `;
  const list = root.querySelector('.poi-gallery-list');
  const status = root.querySelector('.poi-gallery-status');
  const roofButton = root.querySelector<HTMLButtonElement>('[data-action="roofs"]');
  if (!(list instanceof HTMLElement) || !(status instanceof HTMLElement) || !roofButton) throw new Error('POI gallery UI failed to build');

  entries.forEach((entry, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.index = String(index);
    button.innerHTML = `<b>${String(index + 1).padStart(2, '0')}</b>${entry.definition.name}`;
    button.addEventListener('click', () => {
      focus(index);
      list.querySelectorAll('button').forEach((peer) => peer.classList.toggle('is-active', peer === button));
      status.textContent = `${String(index + 1).padStart(2, '0')} · ${entry.definition.name}`;
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
  root.querySelector('[data-action="game"]')?.addEventListener('click', () => {
    window.location.href = window.location.pathname;
  });
  document.body.appendChild(root);
  return root;
}

export function bootPoiGallery(): void {
  const canvas = document.getElementById('game');
  const loading = document.getElementById('launch-loading');
  const rotateHint = document.getElementById('rotate-hint');
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error('index.html is missing #game');
  if (loading instanceof HTMLElement) loading.style.display = 'none';
  if (rotateHint instanceof HTMLElement) rotateHint.style.display = 'none';
  document.title = 'POI gallery · the BRO drive';

  // Same framebuffer policy as the game's 'acceptable' tier: no multisampled
  // backbuffer (an N100 iGPU pays MSAA bandwidth on every one of these pixels) and
  // a hard pixel budget, because this viewer is fill-rate bound, not geometry bound.
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(pixelRatio());
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  // The grid, the sun and the prototypes never move, and the room spots do not
  // cast, so the shadow map is rendered once instead of re-rasterising all 3.9k
  // casters every frame (measured 3871 extra draw calls, ~16 ms on an N100 iGPU).
  // Only the roof toggle changes the caster set; it re-arms needsUpdate.
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9eb3bd);
  scene.fog = new THREE.FogExp2(0xb8ad93, 0.0042);

  const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.08, 700);
  camera.rotation.order = 'YXZ';
  camera.position.set(0, OVERVIEW_Y, OVERVIEW_Z);
  camera.lookAt(0, 4, 0);

  scene.add(new THREE.HemisphereLight(0xe4eff5, 0x6b5133, 2.45));
  const sun = new THREE.DirectionalLight(0xffe0b1, 2.8);
  sun.position.set(-55, 85, -38);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -150;
  sun.shadow.camera.right = 150;
  sun.shadow.camera.top = 150;
  sun.shadow.camera.bottom = -150;
  sun.shadow.camera.near = 5;
  sun.shadow.camera.far = 300;
  sun.shadow.bias = -0.00008;
  sun.shadow.normalBias = 0.035;
  sun.shadow.radius = 4;
  scene.add(sun);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(GRID_COLUMNS * CELL_X + 22, GRID_ROWS * CELL_Z + 20), makeFlatMaterial(0xb99866, 1));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.02;
  ground.receiveShadow = true;
  scene.add(ground);

  const entries: GalleryEntry[] = [];
  POI_VARIANTS.forEach((definition, index) => {
    const column = index % GRID_COLUMNS;
    const row = Math.floor(index / GRID_COLUMNS);
    const x = (column - (GRID_COLUMNS - 1) / 2) * CELL_X;
    const z = (row - (GRID_ROWS - 1) / 2) * CELL_Z;
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(34, 27), makeFlatMaterial((row + column) % 2 === 0 ? 0xaa895b : 0xb28f60, 1));
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(x, 0.005, z);
    pad.receiveShadow = true;
    scene.add(pad);

    const root = createPoiVariant(index);
    mergePoiStatics(root);
    root.position.set(x, 0.02, z);
    scene.add(root);
    const bounds = new THREE.Box3().setFromObject(root);
    const label = makeLabel(index, definition.name);
    label.position.set(x, Math.max(4.8, bounds.max.y + 2.4), z);
    scene.add(label);
    entries.push({ definition, root, x, z });
  });

  for (let column = 0; column <= GRID_COLUMNS; column++) {
    const x = (column - GRID_COLUMNS / 2) * CELL_X;
    const divider = new THREE.Mesh(new THREE.PlaneGeometry(0.12, GRID_ROWS * CELL_Z), makeFlatMaterial(0x876b48, 1));
    divider.rotation.x = -Math.PI / 2;
    divider.position.set(x, 0.025, 0);
    scene.add(divider);
  }
  for (let row = 0; row <= GRID_ROWS; row++) {
    const z = (row - GRID_ROWS / 2) * CELL_Z;
    const divider = new THREE.Mesh(new THREE.PlaneGeometry(GRID_COLUMNS * CELL_X, 0.12), makeFlatMaterial(0x876b48, 1));
    divider.rotation.x = -Math.PI / 2;
    divider.position.set(0, 0.025, z);
    scene.add(divider);
  }

  /**
   * Room-light budget.
   *
   * Three.js forward-shades: every lit fragment evaluates every *visible* light in
   * the scene. The 26 prototypes ship 45 room spots and 20 canopy lamps; on an
   * Intel N100 iGPU all 65 of them measured 69 ms of a 116 ms frame with the grid
   * on screen, and a light standing in its own cone — an interior — costs ~3.7 ms
   * of the 1.44 Mpixel frame all by itself.
   *
   * So the fixtures' own lights become invisible source markers and a fixed pool of
   * slots mirrors the nearest few, exactly as `LightBudget` does for streetlights.
   * Four spots reach the room you stand in plus the one through the doorway, which
   * is what these prototypes are inspected for; two point slots cover a forecourt's
   * canopy lamps. The counts are constant for the session on purpose: the shader
   * permutation is keyed on the visible light count, so a varying count would
   * recompile every lit material as you walk between prototypes.
   */
  const SPOT_SLOT_COUNT = 4;
  const POINT_SLOT_COUNT = 2;
  const LIGHT_RANGE_SQ = 46 * 46;
  const spotSources: THREE.SpotLight[] = [];
  const pointSources: THREE.PointLight[] = [];
  for (const entry of entries) {
    entry.root.traverse((object) => {
      if (object instanceof THREE.SpotLight) {
        object.visible = false;
        spotSources.push(object);
      } else if (object instanceof THREE.PointLight) {
        object.visible = false;
        pointSources.push(object);
      }
    });
  }
  const spotSlots: THREE.SpotLight[] = [];
  for (let slot = 0; slot < SPOT_SLOT_COUNT; slot++) {
    const light = new THREE.SpotLight(0xffffff, 0, 4, 0.7, 0.9, 2);
    light.castShadow = false;
    scene.add(light, light.target);
    spotSlots.push(light);
  }
  const pointSlots: THREE.PointLight[] = [];
  for (let slot = 0; slot < POINT_SLOT_COUNT; slot++) {
    const light = new THREE.PointLight(0xffffff, 0, 4, 2);
    scene.add(light);
    pointSlots.push(light);
  }

  const sourceWorld = new THREE.Vector3();
  const targetWorld = new THREE.Vector3();
  const spotChoice: number[] = [];
  const spotChoiceDistance: number[] = [];
  const pointChoice: number[] = [];
  const pointChoiceDistance: number[] = [];
  /** Insertion-sorts the lit sources in range into `choice`, nearest first. */
  const pickNearest = (
    sources: readonly THREE.Light[],
    limit: number,
    eye: THREE.Vector3,
    choice: number[],
    choiceDistance: number[],
  ): void => {
    choice.length = 0;
    choiceDistance.length = 0;
    for (let index = 0; index < sources.length; index++) {
      const source = sources[index];
      if (!source || source.intensity <= 0) continue;
      const distanceSq = source.getWorldPosition(sourceWorld).distanceToSquared(eye);
      if (distanceSq > LIGHT_RANGE_SQ) continue;
      let at = choiceDistance.length;
      while (at > 0 && (choiceDistance[at - 1] ?? 0) > distanceSq) at--;
      if (at >= limit) continue;
      choice.splice(at, 0, index);
      choiceDistance.splice(at, 0, distanceSq);
      if (choice.length > limit) {
        choice.pop();
        choiceDistance.pop();
      }
    }
  };
  const updateLightSlots = (): void => {
    pickNearest(spotSources, SPOT_SLOT_COUNT, camera.position, spotChoice, spotChoiceDistance);
    for (let slot = 0; slot < spotSlots.length; slot++) {
      const light = spotSlots[slot];
      if (!light) continue;
      const sourceIndex = spotChoice[slot];
      const source = sourceIndex === undefined ? undefined : spotSources[sourceIndex];
      if (!source) {
        light.intensity = 0;
        continue;
      }
      light.position.copy(source.getWorldPosition(sourceWorld));
      light.target.position.copy(source.target.getWorldPosition(targetWorld));
      light.color.copy(source.color);
      light.intensity = source.intensity;
      light.distance = source.distance;
      light.angle = source.angle;
      light.penumbra = source.penumbra;
      light.decay = source.decay;
    }
    pickNearest(pointSources, POINT_SLOT_COUNT, camera.position, pointChoice, pointChoiceDistance);
    for (let slot = 0; slot < pointSlots.length; slot++) {
      const light = pointSlots[slot];
      if (!light) continue;
      const sourceIndex = pointChoice[slot];
      const source = sourceIndex === undefined ? undefined : pointSources[sourceIndex];
      if (!source) {
        light.intensity = 0;
        continue;
      }
      light.position.copy(source.getWorldPosition(sourceWorld));
      light.color.copy(source.color);
      light.intensity = source.intensity;
      light.distance = source.distance;
      light.decay = source.decay;
    }
  };

  let yaw = camera.rotation.y;
  let pitch = camera.rotation.x;
  let roofsVisible = true;
  const keys = new Set<string>();

  const applyLook = (): void => {
    camera.rotation.set(pitch, yaw, 0);
  };
  const overview = (): void => {
    camera.position.set(0, OVERVIEW_Y, OVERVIEW_Z);
    camera.lookAt(0, 4, 0);
    yaw = camera.rotation.y;
    pitch = camera.rotation.x;
  };
  const focus = (index: number): void => {
    const entry = entries[index];
    if (!entry) return;
    camera.position.set(entry.x, EYE_HEIGHT, entry.z - Math.max(8, entry.definition.footprint[1] / 2 + 5));
    yaw = Math.PI;
    pitch = -0.04;
    applyLook();
  };
  const toggleRoofs = (): boolean => {
    roofsVisible = !roofsVisible;
    scene.traverse((object) => {
      if (object.userData.poiRoof === true) object.visible = roofsVisible;
    });
    renderer.shadowMap.needsUpdate = true;
    return roofsVisible;
  };

  const interfaceRoot = createInterface(entries, focus, overview, toggleRoofs);
  const galleryStatus = interfaceRoot.querySelector('.poi-gallery-status');
  const switchRaycaster = new THREE.Raycaster();
  const switchAim = new THREE.Vector2();
  const lightSwitchTargets: THREE.Mesh[] = [];
  for (const entry of entries) {
    entry.root.traverse((object) => {
      if (object instanceof THREE.Mesh && typeof object.userData.poiLightToggle === 'function') lightSwitchTargets.push(object);
    });
  }
  const toggleAimedLight = (): boolean => {
    switchRaycaster.setFromCamera(switchAim, camera);
    for (const hit of switchRaycaster.intersectObjects(lightSwitchTargets, false)) {
      if (hit.distance > 4) break;
      const toggle = hit.object.userData.poiLightToggle as unknown;
      if (typeof toggle !== 'function') continue;
      const switchedOn = Boolean(toggle());
      if (galleryStatus instanceof HTMLElement) {
        galleryStatus.textContent = switchedOn ? 'Свет включён' : 'Свет выключен';
      }
      return true;
    }
    return false;
  };
  canvas.addEventListener('click', () => {
    if (document.pointerLockElement === canvas) {
      toggleAimedLight();
    } else {
      void canvas.requestPointerLock();
    }
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
    if (event.code === 'KeyR') overview();
    if (event.code === 'KeyH') {
      const visible = toggleRoofs();
      const roofButton = interfaceRoot.querySelector<HTMLButtonElement>('[data-action="roofs"]');
      if (roofButton) roofButton.textContent = visible ? 'Снять крыши (H)' : 'Вернуть крыши (H)';
    }
  });
  window.addEventListener('keyup', (event) => keys.delete(event.code));
  window.addEventListener('blur', () => keys.clear());
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(pixelRatio() * adaptiveScale);
    renderer.setSize(window.innerWidth, window.innerHeight, false);
  });

  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  const movement = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  /**
   * Interiors are fill-rate bound: the same frame costs 48 ms at the full pixel
   * budget and 17 ms at half of it. The game's controller is reused rather than
   * reinvented, fed the frame period instead of a GPU timer query — this viewer is
   * GPU-bound by construction, so the two agree, and 'acceptable' already targets
   * the 30 Hz presentation a prototype walkthrough wants. Its 0.8 floor bottoms out
   * at exactly 1280x720 of the 1600x900 budget.
   */
  const adaptive = new AdaptiveResolutionController('acceptable');
  let adaptiveScale = 1;
  const sampleFrameCost = (frameMs: number): void => {
    if (adaptive.sample(frameMs, true, true, performance.now()) === null) return;
    if (adaptive.scale === adaptiveScale) return;
    adaptiveScale = adaptive.scale;
    renderer.setPixelRatio(pixelRatio() * adaptiveScale);
    renderer.setSize(window.innerWidth, window.innerHeight, false);
  };
  let previous = performance.now();
  const render = (now: number): void => {
    const frameMs = now - previous;
    const delta = Math.min(0.05, frameMs / 1000);
    previous = now;
    sampleFrameCost(frameMs);
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
    updateLightSlots();
    renderer.render(scene, camera);
    requestAnimationFrame(render);
  };
  requestAnimationFrame(render);
}
