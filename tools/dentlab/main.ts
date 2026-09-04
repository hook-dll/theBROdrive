/**
 * Collision-dent viewer.
 *
 * Renders real preloaded car bodies side by side with cumulative localized impacts.
 * It exercises the same bounded records and body shader as live collisions, without
 * spending minutes repeatedly driving into a wall.
 *
 * Serve the dev server and open `/tools/dentlab/`. Query parameters:
 *   model=st_big_saloon,sv_vaz2106   one row per model
 *   damage=0,0.12,0.3,1              one column per aggregate damage level
 *   z=15                             camera distance, metres
 *
 * Damage 0.12 is roughly one moderate shunt and 0.3 is the cap for a single
 * high-speed crash (`SCRATCH_PER_IMPACT_CAP`, vehicle/vehicle.ts).
 */
import * as THREE from 'three';
import { CAR_MODELS } from '../../src/vehicle/carmodels';
import { preloadCarModels, createCarModel, carModelMeasure } from '../../src/render/carmodel';
import { setCarBodyCondition } from '../../src/render/materials';
import type { BodyDamageImpact, BodyDamageType } from '../../src/game/state';

const params = new URLSearchParams(location.search);
const requested = (params.get('model') ?? 'st_big_saloon,sv_vaz2106').split(',');
const levels = (params.get('damage') ?? '0,0.12,0.3,1').split(',').map(Number);
const distance = Number(params.get('z') ?? 15);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(1);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fb4c7);
const key = new THREE.DirectionalLight(0xfff3e0, 2.6);
key.position.set(4, 6, 5);
scene.add(key);
scene.add(new THREE.HemisphereLight(0xbcd6ef, 0x6b6154, 0.9));

const camera = new THREE.PerspectiveCamera(32, window.innerWidth / window.innerHeight, 0.1, 200);

const models = requested.filter((id) => CAR_MODELS.some((def) => def.id === id));
await preloadCarModels(models);

const PREVIEW_TYPES: readonly BodyDamageType[] = ['scratch', 'chip', 'dent', 'heavy'];

function previewImpacts(id: string, damage: number): BodyDamageImpact[] {
  if (!(damage > 0)) return [];
  const half = carModelMeasure(id).halfExtents;
  const count = Math.max(1, Math.min(4, Math.ceil(damage * 4)));
  const strength = Math.min(1, Math.max(0.18, damage / 0.3));
  const impacts: BodyDamageImpact[] = [];
  for (let i = 0; i < count; i++) {
    const side = i % 2 === 0;
    const offset = (i - (count - 1) / 2) * 0.28;
    impacts.push({
      x: side ? half[0] : offset,
      y: 0.04 + offset * 0.25,
      z: side ? offset : half[2],
      nx: side ? 1 : 0,
      ny: 0,
      nz: side ? 0 : 1,
      radius: 0.24 + strength * 0.32,
      strength,
      type: PREVIEW_TYPES[Math.min(PREVIEW_TYPES.length - 1, i + count - 1)]!,
      seed: (0.17 + i * 0.271 + damage * 0.113) % 1,
    });
  }
  return impacts;
}

const rows: string[] = [];
models.forEach((id, row) => {
  for (const [col, damage] of levels.entries()) {
    // Keep the paint identical across a row; the only changing variable is damage.
    const { body } = createCarModel(id, `${id}:dentlab`);
    body.position.set((col - (levels.length - 1) / 2) * 5.6, row * -2.4, 0);
    // Show the +X/+Z surfaces used by previewImpacts; the previous three-quarter
    // angle presented their undamaged opposite faces.
    body.rotation.y = -Math.PI * 0.22;
    setCarBodyCondition(body, 0, damage, previewImpacts(id, damage));
    scene.add(body);
  }
  rows.push(`${id}: ${levels.join('  ')}`);
});

const label = document.createElement('pre');
label.textContent = `damage left-to-right\n${rows.join('\n')}`;
document.body.appendChild(label);

camera.position.set(0, 1.4 - (models.length - 1) * 1.2, distance);
camera.lookAt(0, -(models.length - 1) * 1.2, 0);
renderer.render(scene, camera);
