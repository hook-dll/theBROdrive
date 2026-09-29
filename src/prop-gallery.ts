import * as THREE from 'three';
import { primeMaxAnisotropy } from './render/texturequality';
import { SurfaceType } from './core/surfaces';
import { applyComicShading } from './render/comic';
import { PALETTE_CYCLE_M, desertPaletteAt } from './world/gradient';
import { desertPropForms } from './world/props/forms';
import { POLE_DESIGN_COUNT, poleDesign } from './world/props/poledesigns';
import { createPoleDisplay } from './world/props/poles';

const GRID_COLUMNS = 5;
const CELL_X = 24;
const CELL_Z = 25;
/**
 * The hundred pole designs get a grid of their own behind the desert forms: ten to a
 * row, close enough that a row reads as a catalogue page and far enough apart that
 * the widest arms (2.4 m either side) never touch.
 */
const POLE_COLUMNS = 10;
const POLE_CELL_X = 8;
const POLE_CELL_Z = 14;
const POLE_GRID_GAP = 16;
const WALK_SPEED = 8;
const FAST_SPEED = 24;
const EYE_HEIGHT = 1.75;
const MAX_RENDER_PIXELS = 1600 * 900;

interface GalleryEntry {
  readonly name: string;
  readonly root: THREE.Group;
  readonly x: number;
  readonly z: number;
  /** Where `focus` stands to look at it: metres back, and eye height. */
  readonly back: number;
  readonly eye: number;
}

function pixelRatio(): number {
  const cssPixels = Math.max(1, window.innerWidth * window.innerHeight);
  return Math.min(window.devicePixelRatio, Math.sqrt(MAX_RENDER_PIXELS / cssPixels));
}

function makeLabel(index: number, name: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 192;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D is required for prop labels');
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
  context.fillText(name, 132, 96, 364);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
  // Small on purpose: the POI gallery's boards are read from an overview twenty metres
  // up, and at this scene's focus distance of ten metres that size filled the screen
  // and hid the specimen it was labelling.
  sprite.scale.set(4.4, 1.65, 1);
  sprite.renderOrder = 20;
  return sprite;
}

function createInterface(entries: readonly GalleryEntry[], focus: (index: number) => void, overview: () => void): HTMLElement {
  const root = document.createElement('div');
  root.className = 'prop-gallery-ui';
  root.innerHTML = `
    <style>
      .prop-gallery-ui { position:fixed; inset:0; z-index:40; pointer-events:none; color:#eadfca; font:13px/1.35 "Segoe UI",sans-serif; }
      .prop-gallery-head, .prop-gallery-palette { position:absolute; left:18px; padding:13px 15px; background:rgba(24,20,14,.88); border:1px solid rgba(234,223,202,.34); box-shadow:0 6px 22px rgba(0,0,0,.32); }
      .prop-gallery-head { top:18px; max-width:440px; } .prop-gallery-palette { bottom:18px; width:min(390px,calc(100vw - 36px)); pointer-events:auto; }
      .prop-gallery-title { font:bold 19px/1.1 "Segoe UI",sans-serif; letter-spacing:.04em; margin-bottom:7px; } .prop-gallery-help { color:#c8bda8; }
      .prop-gallery-palette label { display:block; font-weight:bold; letter-spacing:.04em; } .prop-gallery-palette input { width:100%; margin:8px 0 4px; }
      .prop-gallery-readout { color:#d7bd89; font-variant-numeric:tabular-nums; }
      .prop-gallery-list { position:absolute; right:14px; top:14px; bottom:14px; width:270px; display:flex; flex-direction:column; gap:5px; overflow:auto; padding:10px; pointer-events:auto; background:rgba(20,17,12,.86); border:1px solid rgba(234,223,202,.28); }
      .prop-gallery-list button, .prop-gallery-actions button { min-height:31px; border:1px solid rgba(234,223,202,.24); background:#2b251b; color:#eadfca; padding:6px 9px; text-align:left; cursor:pointer; font:12px "Segoe UI",sans-serif; }
      .prop-gallery-list button:hover, .prop-gallery-list button.is-active, .prop-gallery-actions button:hover { background:#5c4930; border-color:#d7bd89; } .prop-gallery-list b { display:inline-block; width:25px; color:#d7bd89; }
      .prop-gallery-actions { position:absolute; left:18px; bottom:126px; display:flex; gap:7px; pointer-events:auto; } .prop-gallery-actions button { text-align:center; padding:8px 13px; }
      .prop-gallery-status { position:absolute; left:50%; bottom:18px; transform:translateX(-50%); padding:8px 12px; background:rgba(20,17,12,.8); color:#d7bd89; }
      .prop-gallery-crosshair { position:absolute; left:50%; top:50%; width:12px; height:12px; transform:translate(-50%,-50%); opacity:.72; } .prop-gallery-crosshair::before, .prop-gallery-crosshair::after { content:""; position:absolute; background:#f0dfb8; box-shadow:0 0 3px #1b160f; } .prop-gallery-crosshair::before { left:5px; top:0; width:2px; height:12px; } .prop-gallery-crosshair::after { left:0; top:5px; width:12px; height:2px; }
      @media (max-width:900px) { .prop-gallery-list { width:210px; } .prop-gallery-head { max-width:330px; } }
    </style>
    <section class="prop-gallery-head"><div class="prop-gallery-title">ГАЛЕРЕЯ ПРОПОВ · ${entries.length} ОБРАЗЦОВ</div><div class="prop-gallery-help">Клик по сцене — захват мыши · WASD — движение · Q/E или Ctrl/Space — вниз/вверх · Shift — ускорение · R — общий вид · Esc — отпустить мышь</div></section>
    <nav class="prop-gallery-list" aria-label="Пропы пустыни"></nav>
    <div class="prop-gallery-actions"><button type="button" data-action="overview">Общий вид (R)</button><button type="button" data-action="game">Вернуться в игру</button></div>
    <section class="prop-gallery-palette"><label for="prop-gallery-palette">ЦВЕТ ПУСТЫНИ</label><input id="prop-gallery-palette" type="range" min="0" max="${PALETTE_CYCLE_M}" step="1000" value="0"><div class="prop-gallery-readout"></div></section>
    <div class="prop-gallery-status">Общий вид</div><div class="prop-gallery-crosshair" aria-hidden="true"></div>`;
  const list = root.querySelector('.prop-gallery-list');
  const status = root.querySelector('.prop-gallery-status');
  if (!(list instanceof HTMLElement) || !(status instanceof HTMLElement)) throw new Error('Prop gallery UI failed to build');
  entries.forEach((entry, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.innerHTML = `<b>${String(index + 1).padStart(2, '0')}</b>${entry.name}`;
    button.addEventListener('click', () => {
      focus(index);
      list.querySelectorAll('button').forEach((peer) => peer.classList.toggle('is-active', peer === button));
      status.textContent = `${String(index + 1).padStart(2, '0')} · ${entry.name}`;
    });
    list.appendChild(button);
  });
  root.querySelector('[data-action="overview"]')?.addEventListener('click', () => { overview(); list.querySelectorAll('button').forEach((peer) => peer.classList.remove('is-active')); status.textContent = 'Общий вид'; });
  root.querySelector('[data-action="game"]')?.addEventListener('click', () => { window.location.href = window.location.pathname; });
  document.body.appendChild(root);
  return root;
}

export function bootPropGallery(): void {
  const canvas = document.getElementById('game');
  const loading = document.getElementById('launch-loading');
  const rotateHint = document.getElementById('rotate-hint');
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error('index.html is missing #game');
  if (loading instanceof HTMLElement) loading.style.display = 'none';
  if (rotateHint instanceof HTMLElement) rotateHint.style.display = 'none';
  document.title = 'Prop gallery · Voyage Mirage';

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  primeMaxAnisotropy(renderer);
  renderer.setPixelRatio(pixelRatio()); renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.12;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x9eb3bd); scene.fog = new THREE.FogExp2(0xb8ad93, 0.0042);
  const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.08, 700); camera.rotation.order = 'YXZ';
  scene.add(new THREE.HemisphereLight(0xe4eff5, 0x6b5133, 2.45));
  const sun = new THREE.DirectionalLight(0xffe0b1, 2.8); sun.position.set(-55, 85, -38); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.camera.left = -100; sun.shadow.camera.right = 100; sun.shadow.camera.top = 100; sun.shadow.camera.bottom = -100; sun.shadow.camera.near = 5; sun.shadow.camera.far = 250; sun.shadow.normalBias = 0.035; scene.add(sun);

  const forms = [...desertPropForms(SurfaceType.Rock), ...desertPropForms(SurfaceType.Sand)];
  const gridRows = Math.ceil(forms.length / GRID_COLUMNS);
  const poleRows = Math.ceil(POLE_DESIGN_COUNT / POLE_COLUMNS);
  const formsDepth = gridRows * CELL_Z;
  const polesDepth = poleRows * POLE_CELL_Z;
  const totalDepth = formsDepth + POLE_GRID_GAP + polesDepth;
  const formsTop = -totalDepth / 2;
  const polesTop = formsTop + formsDepth + POLE_GRID_GAP;
  const width = Math.max(GRID_COLUMNS * CELL_X, POLE_COLUMNS * POLE_CELL_X);
  const groundMaterial = applyComicShading(new THREE.MeshStandardMaterial({ color: 0xd29459, roughness: 0.96 }), { reliefShadeStrength: 0 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(width + 18, totalDepth + 18), groundMaterial);
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.03; ground.receiveShadow = true; scene.add(ground);
  const entries: GalleryEntry[] = [];
  const rockPads: THREE.MeshStandardMaterial[] = [];
  const sharedMaterials = new Set<THREE.MeshStandardMaterial>();
  // `tinted` entries take the palette slider's gravel colour, as the scatter does in the
  // game. Poles do not: they carry their own paint in vertex colour, which a material
  // colour would multiply.
  const addEntry = (name: string, root: THREE.Group, x: number, z: number, pad: { radius: number; rock: boolean }, tinted: boolean, view: { back: number; eye: number }): void => {
    const index = entries.length;
    const padMaterial = new THREE.MeshStandardMaterial({ color: pad.rock ? 0x815f42 : 0xc38b50, roughness: 1 });
    const disc = new THREE.Mesh(new THREE.CircleGeometry(pad.radius, 32), padMaterial); disc.rotation.x = -Math.PI / 2; disc.position.set(x, 0, z); disc.receiveShadow = true; scene.add(disc);
    if (pad.rock) rockPads.push(padMaterial);
    root.position.set(x, root.position.y, z);
    root.traverse((object) => { if (object instanceof THREE.Mesh) { object.castShadow = true; object.receiveShadow = true; const material = object.material; if (tinted && material instanceof THREE.MeshStandardMaterial) { applyComicShading(material, { contourStrength: 0, stippleStrength: 0, reliefShadeStrength: 0 }); sharedMaterials.add(material); } } });
    scene.add(root);
    const bounds = new THREE.Box3().setFromObject(root); const label = makeLabel(index, name); label.position.set(x, Math.max(2.6, bounds.max.y + 1.1), z); scene.add(label);
    entries.push({ name, root, x, z, ...view });
  };
  forms.forEach((form, i) => {
    const x = ((i % GRID_COLUMNS) - (GRID_COLUMNS - 1) / 2) * CELL_X;
    const z = formsTop + (Math.floor(i / GRID_COLUMNS) + 0.5) * CELL_Z;
    const specimen = new THREE.Group(); const mesh = new THREE.Mesh(form.geometry, form.material); const scale = (form.minScale + form.maxScale) * 0.5;
    mesh.scale.setScalar(scale); mesh.position.y = -form.sink * form.baseRadius * scale; specimen.add(mesh);
    addEntry(form.id, specimen, x, z, { radius: 8.5, rock: desertPropForms(SurfaceType.Rock).includes(form) }, true, { back: 10, eye: EYE_HEIGHT });
  });
  // Every design stands as the world builds it at the start of its section: upright,
  // fully fitted, unworn. A worn pole differs only in lean and in whether it still
  // has its arms, which is a pose rather than a design.
  for (let id = 0; id < POLE_DESIGN_COUNT; id++) {
    const design = poleDesign(id);
    const x = ((id % POLE_COLUMNS) - (POLE_COLUMNS - 1) / 2) * POLE_CELL_X;
    const z = polesTop + (Math.floor(id / POLE_COLUMNS) + 0.5) * POLE_CELL_Z;
    const pole = createPoleDisplay(design, { era: design.era, dilapidation: 0, wireChance: 1 }, 0xdecade, id);
    addEntry(design.name, pole, x, z, { radius: 3.2, rock: false }, false, { back: design.height * 1.05 + 2, eye: design.height * 0.55 });
  }

  let yaw = 0; let pitch = -0.5; const keys = new Set<string>();
  const applyLook = (): void => { camera.rotation.set(pitch, yaw, 0); };
  const overview = (): void => { camera.position.set(0, Math.max(48, totalDepth * 0.7), totalDepth * 0.5 + 60); camera.lookAt(0, 3, 0); yaw = camera.rotation.y; pitch = camera.rotation.x; };
  const focus = (index: number): void => { const entry = entries[index]; if (!entry) return; camera.position.set(entry.x, entry.eye, entry.z + entry.back); yaw = 0; pitch = -0.05; applyLook(); };
  overview(); createInterface(entries, focus, overview);
  // These singleton materials are intentionally recoloured in this dev-only scene;
  // returning to the game reloads the page, so no gameplay renderer inherits the swatch.
  const paletteInput = document.getElementById('prop-gallery-palette');
  const readout = document.querySelector('.prop-gallery-readout');
  if (!(paletteInput instanceof HTMLInputElement) || !(readout instanceof HTMLElement)) throw new Error('Prop gallery palette UI failed to build');
  const setPalette = (): void => {
    const distance = Number(paletteInput.value); const palette = desertPaletteAt(distance);
    groundMaterial.color.setHex(palette.sand); for (const material of rockPads) material.color.setHex(palette.rock);
    for (const material of sharedMaterials) material.color.setHex(palette.gravel);
    for (const form of desertPropForms(SurfaceType.Rock)) form.material.color.setHex(palette.rock);
    readout.textContent = `${(distance / 1000).toLocaleString('ru-RU', { maximumFractionDigits: 0 })} км · песок #${palette.sand.toString(16).padStart(6, '0').toUpperCase()}`;
  };
  paletteInput.addEventListener('input', setPalette); setPalette();
  canvas.addEventListener('click', () => { if (document.pointerLockElement !== canvas) void canvas.requestPointerLock(); });
  window.addEventListener('mousemove', (event) => { if (document.pointerLockElement !== canvas) return; yaw -= event.movementX * 0.0022; pitch = Math.max(-Math.PI * 0.48, Math.min(Math.PI * 0.48, pitch - event.movementY * 0.0022)); applyLook(); });
  window.addEventListener('keydown', (event) => { keys.add(event.code); if (!event.repeat && event.code === 'KeyR') overview(); }); window.addEventListener('keyup', (event) => keys.delete(event.code)); window.addEventListener('blur', () => keys.clear());
  window.addEventListener('resize', () => { camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); renderer.setPixelRatio(pixelRatio()); renderer.setSize(window.innerWidth, window.innerHeight, false); });
  const forward = new THREE.Vector3(); const right = new THREE.Vector3(); const movement = new THREE.Vector3(); const up = new THREE.Vector3(0, 1, 0); let previous = performance.now();
  const render = (now: number): void => { const delta = Math.min(0.05, (now - previous) / 1000); previous = now; camera.getWorldDirection(forward); forward.y = 0; if (forward.lengthSq() > 0.001) forward.normalize(); right.crossVectors(forward, up).normalize(); movement.set(0, 0, 0); if (keys.has('KeyW')) movement.add(forward); if (keys.has('KeyS')) movement.sub(forward); if (keys.has('KeyD')) movement.add(right); if (keys.has('KeyA')) movement.sub(right); if (keys.has('KeyE') || keys.has('Space')) movement.y += 1; if (keys.has('KeyQ') || keys.has('ControlLeft') || keys.has('ControlRight')) movement.y -= 1; if (movement.lengthSq() > 0) { const speed = keys.has('ShiftLeft') || keys.has('ShiftRight') ? FAST_SPEED : WALK_SPEED; camera.position.addScaledVector(movement.normalize(), speed * delta); camera.position.y = Math.max(0.3, Math.min(95, camera.position.y)); } renderer.render(scene, camera); requestAnimationFrame(render); };
  requestAnimationFrame(render);
}
