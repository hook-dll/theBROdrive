import * as THREE from 'three';
import { FIXED_DT, PhysicsWorld } from './core/physics';
import { emptyInput, type InputFrame } from './core/input';
import { GameWorld, newWorldState, DAY_LENGTH } from './game/state';
import { makeFlatMaterial } from './render/materials';
import { preloadCarModels } from './render/carmodel';
import { Autopilot, AUTOPILOT_MODES, type AutopilotMode } from './vehicle/autopilot';
import { Vehicle } from './vehicle/vehicle';
import { HazardIndex } from './world/hazards';
import { WorldOrigin } from './world/origin';
import {
  CIRCUIT_HALF_WIDTH,
  PLAYGROUND_ORIGIN_X,
  PLAYGROUND_ORIGIN_Z,
  type CircuitSector,
} from './playground/circuit';
import { laneOffsetFor } from './world/roadprofile';
import { createServiceableCarState } from './game/spawn';
import { PlaygroundRoad } from './playground/playgroundroad';
import {
  addCircuitCollider,
  buildCircuitRibbon,
  CIRCUIT_STRIPS,
  RIBBON_HALF_WIDTH,
} from './playground/ribbon';
import { PlaygroundTraffic, type TrafficState } from './playground/traffic';

/**
 * The driving playground: a closed 2.7 km circuit you can watch a car drive.
 *
 * `tools/playground-lap.ts` measures the same lap headlessly and is where a change
 * is judged. This is where it is UNDERSTOOD: sector telemetry says the car crawled
 * through the esses, and only a camera says whether it braked too early, aimed at
 * the wrong line, or ran out of lock. Both use the same circuit and the same ribbon
 * (`playground/ribbon.ts`), so what you watch is what was measured.
 *
 * Dev only, reached with `?playground`, and — like the POI gallery — it is a
 * separate entry point that the production bundle drops.
 *
 * Controls are printed on screen. The autopilot drives; the keyboard is for moving
 * the car to the corner you want to look at, choosing the camera, and deciding
 * whether the lap has traffic on it.
 */

const SEED = 1337;
const MODEL_ID = 'sv_vaz2105r';
/**
 * The body the traffic uses. It is the rally car for a measured reason: this lap
 * holds 28% gradients, worse than anything the real road does, and the ordinary
 * catalogue saloons cannot climb them. Filling the circuit with GAZ-24s and 2101s
 * for variety was tried, and produced a scene of cars stranded on hillsides at full
 * throttle: 18-24 off-road events per 90 s of traffic, against the rally car's
 * clean lap.
 */
const TRAFFIC_MODEL_ID = 'sv_vaz2105r';
const TRAFFIC_STATES: readonly TrafficState[] = ['rolling', 'parked', 'stowed'];
/** Mirrors the game's 'acceptable' tier budget: 1600x900 rendered pixels. */
const MAX_RENDER_PIXELS = 1600 * 900;
const CHASE_BACK = 9;
const CHASE_HEIGHT = 3.6;
const SIDE_OUT = 14;
const TOP_HEIGHT = 55;
type CameraMode = 'chase' | 'side' | 'top';
const CAMERA_MODES: readonly CameraMode[] = ['chase', 'side', 'top'];

function pixelRatio(): number {
  const cssPixels = Math.max(1, window.innerWidth * window.innerHeight);
  return Math.min(window.devicePixelRatio, Math.sqrt(MAX_RENDER_PIXELS / cssPixels));
}

/**
 * The lap drawn from the same strips the colliders are built from: sand shelves,
 * the verge, and the asphalt itself lifted a couple of centimetres so the edge
 * reads without z-fighting.
 */
function circuitMesh(road: PlaygroundRoad): THREE.Group {
  const group = new THREE.Group();
  const strips: readonly (readonly [number, number, number, number])[] = [
    ...CIRCUIT_STRIPS.map(
      (strip) => [strip.inner, strip.outer, 0xb99866, 0] as const,
    ),
    [-RIBBON_HALF_WIDTH, RIBBON_HALF_WIDTH, 0x8a7f6d, 0.01],
    [-CIRCUIT_HALF_WIDTH, CIRCUIT_HALF_WIDTH, 0x4a4741, 0.02],
  ];
  for (const [inner, outer, colour, lift] of strips) {
    const ribbon = buildCircuitRibbon(road, road.circuit, inner, outer);
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(ribbon.vertices);
    if (lift !== 0) {
      for (let i = 1; i < positions.length; i += 3) positions[i] += lift;
    }
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setIndex(new THREE.BufferAttribute(ribbon.indices, 1));
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, makeFlatMaterial(colour, 1));
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}

/** Start-line and sector markers, so a corner can be named from the cockpit. */
function sectorMarkers(road: PlaygroundRoad): THREE.Group {
  const group = new THREE.Group();
  const point = { x: 0, y: 0, z: 0 };
  for (const sector of road.circuit.sectors) {
    for (const side of [-1, 1]) {
      road.offsetPoint(sector.startS, side * (CIRCUIT_HALF_WIDTH + 0.6), point);
      const post = new THREE.Mesh(
        new THREE.BoxGeometry(0.35, 1.4, 0.35),
        makeFlatMaterial(sector.startS === 0 ? 0xd8c69e : 0xb03a2e, 1),
      );
      post.position.set(point.x, road.circuit.surfaceY(sector.startS, 0) + 0.7, point.z);
      group.add(post);
    }
  }
  return group;
}

export async function bootPlayground(): Promise<void> {
  const canvas = document.getElementById('game') as HTMLCanvasElement | null;
  if (!canvas) throw new Error('playground needs the game canvas');
  // The launch cover and the portrait hint belong to the game shell; a dev scene
  // takes over the canvas, so it dismisses both itself (same as the POI gallery).
  const cover = document.getElementById('launch-loading');
  if (cover instanceof HTMLElement) cover.style.display = 'none';
  const rotateHint = document.getElementById('rotate-hint');
  if (rotateHint instanceof HTMLElement) rotateHint.style.display = 'none';

  await preloadCarModels([MODEL_ID, TRAFFIC_MODEL_ID]);
  const road = new PlaygroundRoad(SEED, PLAYGROUND_ORIGIN_X, PLAYGROUND_ORIGIN_Z);
  const circuit = road.circuit;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(pixelRatio());
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9fb4c8);
  scene.fog = new THREE.Fog(0x9fb4c8, 400, 2_600);
  const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.2, 6_000);

  scene.add(new THREE.HemisphereLight(0xbfd4e8, 0x6b5a3f, 1.5));
  const sun = new THREE.DirectionalLight(0xfff2d8, 2.6);
  sun.position.set(220, 320, 140);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 900;
  sun.shadow.camera.left = -120;
  sun.shadow.camera.right = 120;
  sun.shadow.camera.top = 120;
  sun.shadow.camera.bottom = -120;
  scene.add(sun, sun.target);

  // The sand shelves either side of the lap are the ground the car can reach, so the
  // only thing left to draw is a backdrop under everything. It sits well below the
  // lowest point of the lap: the circuit climbs and falls about 200 m, and a plane
  // anywhere near the road cuts straight through the hillsides.
  const start = circuit.sampleAt(0);
  let lapFloor = Infinity;
  for (let s = 0; s < circuit.length; s += 4) lapFloor = Math.min(lapFloor, circuit.sampleAt(s).y);
  const backdrop = new THREE.Mesh(
    new THREE.PlaneGeometry(12_000, 12_000),
    makeFlatMaterial(0xa88d5e, 1),
  );
  backdrop.rotation.x = -Math.PI / 2;
  backdrop.position.set(start.x, lapFloor - 60, start.z);
  scene.add(backdrop);
  scene.add(circuitMesh(road), sectorMarkers(road));

  const physics = await PhysicsWorld.create();
  addCircuitCollider(physics, road, circuit);
  const world = new GameWorld(newWorldState(SEED));
  world.state.timeOfDay = DAY_LENGTH * 0.4;
  // The ego car starts ON THE LANE it is going to hold, not on the centreline: a
  // 1.45 m lateral step at the green light is not what is being tested.
  const startLateral = -laneOffsetFor(CIRCUIT_HALF_WIDTH, 0);
  const state = createServiceableCarState(
    'playground',
    MODEL_ID,
    start.x + Math.cos(start.heading) * startLateral,
    circuit.surfaceY(0, startLateral) + 1.2,
    start.z - Math.sin(start.heading) * startLateral,
    start.heading,
  );
  world.state.cars[state.id] = state;
  const origin = new WorldOrigin();
  const vehicle = new Vehicle(physics, world, state, scene, origin);
  const autopilot = new Autopilot(road, new HazardIndex(), physics);
  const input: InputFrame = emptyInput();
  autopilot.setEngaged(true);
  const traffic = new PlaygroundTraffic(
    physics,
    world,
    scene,
    origin,
    road,
    circuit,
    [TRAFFIC_MODEL_ID],
  );

  let mode: AutopilotMode = 'frantic';
  autopilot.setMode(mode);
  let cameraMode: CameraMode = 'chase';
  let timeScale = 1;
  let paused = false;
  let hintS = 0;
  let lapStart = performance.now();
  let lastLapSeconds = 0;
  let travelled = 0;
  let previousS = 0;

  /** Drops the car on its own lane at an arclength, stationary and pointing along it. */
  const placeAt = (s: number): void => {
    const at = circuit.sampleAt(s);
    const lateral = -laneOffsetFor(CIRCUIT_HALF_WIDTH, 0);
    vehicle.rescueTo(
      at.x + Math.cos(at.heading) * lateral,
      circuit.surfaceY(s, lateral) + 1.2,
      at.z - Math.sin(at.heading) * lateral,
      at.heading,
    );
    hintS = s;
    previousS = s;
    travelled = 0;
    lapStart = performance.now();
  };

  const ui = document.createElement('div');
  ui.className = 'playground-ui';
  ui.innerHTML = `
    <style>
      .playground-ui { position:fixed; inset:0; z-index:40; pointer-events:none; color:#eadfca;
        font:13px/1.4 "Consolas","Segoe UI",monospace; }
      .playground-head, .playground-telemetry { position:absolute; padding:12px 14px;
        background:rgba(22,19,13,.86); border:1px solid rgba(234,223,202,.3); white-space:pre; }
      .playground-head { left:16px; top:16px; }
      .playground-telemetry { right:16px; top:16px; min-width:250px; }
      .playground-sectors { position:absolute; left:16px; bottom:16px; max-width:60vw;
        padding:10px 12px; background:rgba(22,19,13,.82); border:1px solid rgba(234,223,202,.24); }
    </style>
    <section class="playground-head"></section>
    <section class="playground-telemetry"></section>
    <section class="playground-sectors"></section>
  `;
  document.body.appendChild(ui);
  const head = ui.querySelector('.playground-head') as HTMLElement;
  const telemetry = ui.querySelector('.playground-telemetry') as HTMLElement;
  const sectorList = ui.querySelector('.playground-sectors') as HTMLElement;
  head.textContent =
    `PLAYGROUND — ${(circuit.length / 1000).toFixed(2)} km closed lap, seed ${SEED}\n` +
    'C camera · M autopilot mode · A engage/disengage · Space pause · T time x1/x4\n' +
    'X traffic rolling/parked/stowed · Z reset the traffic to its grid\n' +
    'R restart on the line · [ ] previous/next corner · 1-9 jump to a sector · Esc back to the game';
  sectorList.textContent = circuit.sectors
    .map((sector, index) => `${index + 1} ${sector.name}`)
    .join('   ');

  let sectorIndex = 0;
  const jumpToSector = (index: number): void => {
    sectorIndex = ((index % circuit.sectors.length) + circuit.sectors.length) % circuit.sectors.length;
    placeAt(circuit.sectors[sectorIndex]!.startS + 2);
  };

  window.addEventListener('keydown', (event) => {
    const digit = Number(event.key);
    if (Number.isInteger(digit) && digit >= 1 && digit <= Math.min(9, circuit.sectors.length)) {
      jumpToSector(digit - 1);
      return;
    }
    if (event.key === '[') {
      jumpToSector(sectorIndex - 1);
      return;
    }
    if (event.key === ']') {
      jumpToSector(sectorIndex + 1);
      return;
    }
    switch (event.key.toLowerCase()) {
      case 'c':
        cameraMode = CAMERA_MODES[(CAMERA_MODES.indexOf(cameraMode) + 1) % CAMERA_MODES.length]!;
        break;
      case 'm':
        mode = mode === 'frantic' ? 'sleeper' : 'frantic';
        autopilot.setMode(mode);
        break;
      case 'a':
        autopilot.setEngaged(!autopilot.engaged);
        break;
      case 'r':
        placeAt(0);
        break;
      case 'x':
        traffic.setState(
          TRAFFIC_STATES[(TRAFFIC_STATES.indexOf(traffic.state) + 1) % TRAFFIC_STATES.length]!,
        );
        break;
      case 'z':
        traffic.reset();
        break;
      case 't':
        timeScale = timeScale === 1 ? 4 : 1;
        break;
      case ' ':
        paused = !paused;
        break;
      case 'escape':
        window.location.search = '';
        break;
      default:
        break;
    }
  });
  window.addEventListener('resize', () => {
    renderer.setPixelRatio(pixelRatio());
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  });

  const position = { x: 0, y: 0, z: 0 };
  const lookAt = new THREE.Vector3();
  const sectorOf = (s: number): CircuitSector => circuit.sectorAt(s);


  let accumulator = 0;
  let previousFrame = performance.now();
  const frame = (now: number): void => {
    requestAnimationFrame(frame);
    const frameDt = Math.min(0.1, (now - previousFrame) / 1000);
    previousFrame = now;
    if (!paused) accumulator += frameDt * timeScale;

    while (accumulator >= FIXED_DT) {
      accumulator -= FIXED_DT;
      autopilot.drive(FIXED_DT, vehicle, input, origin.x, origin.z);
      vehicle.fixedUpdate(FIXED_DT, input);
      traffic.fixedUpdate(FIXED_DT, origin.x, origin.z);
      physics.step();
      vehicle.postStep();
      traffic.postStep();

      vehicle.absoluteTranslation(position);
      const projection = circuit.project(position.x, position.z, hintS);
      hintS = projection.s;
      let delta = projection.s - previousS;
      if (delta < -circuit.length / 2) delta += circuit.length;
      if (delta > circuit.length / 2) delta -= circuit.length;
      travelled += delta;
      previousS = projection.s;
      if (travelled >= circuit.length) {
        travelled -= circuit.length;
        lastLapSeconds = (performance.now() - lapStart) / 1000;
        lapStart = performance.now();
      }
    }

    vehicle.syncVisuals(1);
    traffic.syncVisuals(1);
    vehicle.absoluteTranslation(position);
    const projection = circuit.project(position.x, position.z, hintS);
    const sector = sectorOf(projection.s);
    const velocity = vehicle.chassis.linvel();
    const speed = Math.hypot(velocity.x, velocity.z);
    const curvature = Math.abs(circuit.sampleAt(projection.s).curvature);
    // The cornering limit the autopilot's own speed target is built from, so a
    // sector where the car is far below it is a sector worth looking at.
    const lateralAccel = AUTOPILOT_MODES[mode].lateralAccel;
    const limit = Math.sqrt(lateralAccel / Math.max(curvature, 1e-4));

    const root = vehicle.root;
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(root.quaternion);
    lookAt.copy(root.position).add(new THREE.Vector3(0, 1.1, 0));
    if (cameraMode === 'chase') {
      camera.position
        .copy(root.position)
        .sub(forward.clone().multiplyScalar(CHASE_BACK))
        .add(new THREE.Vector3(0, CHASE_HEIGHT, 0));
    } else if (cameraMode === 'side') {
      const right = new THREE.Vector3(forward.z, 0, -forward.x).normalize();
      camera.position
        .copy(root.position)
        .add(right.multiplyScalar(SIDE_OUT))
        .add(new THREE.Vector3(0, 4.5, 0));
    } else {
      camera.position.copy(root.position).add(new THREE.Vector3(0, TOP_HEIGHT, 0.01));
    }
    camera.lookAt(lookAt);
    sun.position.copy(root.position).add(new THREE.Vector3(180, 300, 120));
    sun.target.position.copy(root.position);
    sun.target.updateMatrixWorld();

    telemetry.textContent =
      `sector      ${sector.name}\n` +
      `radius      ${Number.isFinite(sector.radius) ? `${Math.abs(sector.radius).toFixed(0)} m` : 'straight'}\n` +
      `speed       ${(speed * 3.6).toFixed(1)} km/h\n` +
      `corner cap  ${(limit * 3.6).toFixed(1)} km/h\n` +
      `throttle    ${input.throttle.toFixed(2)}\n` +
      `brake       ${input.brake.toFixed(2)}\n` +
      `steer       ${input.steer.toFixed(3)}\n` +
      `lane        ${projection.lateral.toFixed(2)} m, want ${autopilot.commandedLine.toFixed(2)}, edge ${CIRCUIT_HALF_WIDTH.toFixed(1)}\n` +
      `doing       ${autopilot.activity}\n` +
      `ahead       ${
        autopilot.obstacleGap < Infinity
          ? `${autopilot.obstacleGap.toFixed(0)} m at ${(autopilot.obstacleSpeed * 3.6).toFixed(0)} km/h`
          : 'clear'
      }\n` +
      `traffic     ${traffic.state}\n` +
      `grade       ${(circuit.sampleAt(projection.s).grade * 100).toFixed(1)}%\n` +
      `s           ${projection.s.toFixed(0)} / ${circuit.length.toFixed(0)} m\n` +
      `last lap    ${lastLapSeconds > 0 ? `${lastLapSeconds.toFixed(1)} s` : '—'}\n` +
      `mode        ${mode}${autopilot.engaged ? '' : ' (disengaged)'}\n` +
      `time        x${timeScale}${paused ? ' PAUSED' : ''}\n` +
      `camera      ${cameraMode}`;

    renderer.render(scene, camera);
  };
  requestAnimationFrame(frame);
}
