/**
 * Cooling viewer: the four radiator meshes and the temperature gauge's five zones.
 *
 * Both are things only an eye can check. The radiators must be separable at a glance
 * in the inventory strip and in a bonnet slot, and the gauge's zone colours have to
 * be readable at dashboard size against the road behind them — neither is something
 * `tools/cooling.ts` can assert.
 *
 * Serve the dev server and open `/tools/coollab/`. Click to advance the gauge
 * through cold, normal, warm, hot and critical.
 */
import * as THREE from 'three';
import { createPartMesh } from '../../src/render/partmesh';
import { variant } from '../../src/parts/registry';
import { Hud } from '../../src/ui/hud';
import type { CoolingZone } from '../../src/vehicle/cooling';

const RADIATORS = ['radiator_small', 'radiator_lada', 'radiator_standard', 'radiator_copper'];

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.domElement.style.cssText = 'position:fixed;inset:0';
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8a939c);
const key = new THREE.DirectionalLight(0xfff3e0, 2.4);
key.position.set(3, 5, 6);
scene.add(key, new THREE.HemisphereLight(0xcfe0f0, 0x6b6154, 1));

RADIATORS.forEach((id, i) => {
  const mesh = createPartMesh(id);
  mesh.position.set((i - (RADIATORS.length - 1) / 2) * 1.3, 0.4, 0);
  mesh.rotation.y = Math.PI * 0.22;
  scene.add(mesh);
});

const camera = new THREE.PerspectiveCamera(35, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 1, 3.4);
camera.lookAt(0, 0.35, 0);
renderer.render(scene, camera);

const hint = document.getElementById('hint')!;
hint.textContent = RADIATORS.map((id) => {
  const spec = variant(id).radiator!;
  return `${variant(id).label}: ${spec.klass}, ${spec.capacity} L, ${spec.coolingKwPerK} kW/K`;
}).join('\n');
hint.style.whiteSpace = 'pre';

/** One representative temperature per zone for a petrol engine's thresholds. */
const SAMPLES: readonly { zone: CoolingZone; celsius: number }[] = [
  { zone: 'cold', celsius: 35 },
  { zone: 'normal', celsius: 92 },
  { zone: 'warm', celsius: 108 },
  { zone: 'hot', celsius: 118 },
  { zone: 'critical', celsius: 132 },
];

const hud = new Hud(document.getElementById('ui')!);
let index = 0;

function paint(): void {
  const sample = SAMPLES[index];
  hud.setDriving({
    speedKmh: 74,
    rpm: 3100,
    redlineRpm: 5200,
    gearLabel: '3',
    fuelLitres: 42,
    tankCapacity: 65,
    temperature: {
      celsius: sample.celsius,
      zone: sample.zone,
      // The real fraction comes from the engine's own thresholds; 35-140 C is the
      // equivalent span for the petrol profile these samples use.
      fraction: (sample.celsius - 35) / 105,
      warning:
        sample.zone === 'hot'
          ? 'ENGINE OVERHEATING'
          : sample.zone === 'critical'
            ? 'ENGINE CRITICAL — STOP'
            : null,
    },
    waterFraction: index >= 3 ? 0.15 : 0.9,
    oilFraction: 0.8,
    engineRunning: sample.zone !== 'critical',
    engineDestroyed: false,
    handbrake: false,
    tcsActive: false,
  });
  hud.setTravel(12.4, 3600 * 15);
  document.title = `coollab ${sample.zone}`;
}

paint();
document.body.addEventListener('click', () => {
  index = (index + 1) % SAMPLES.length;
  paint();
});
