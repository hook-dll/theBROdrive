/**
 * Collision-dent viewer.
 *
 * Renders real preloaded car bodies side by side at a row of damage levels, which
 * is the only way to judge the dent field: it is a shader effect keyed to
 * `CarState.scratches`, and reaching a given level by crashing takes minutes.
 *
 * Serve the dev server and open `/tools/dentlab/`. Query parameters:
 *   model=st_big_saloon,sv_vaz2106   one row per model
 *   scratches=0,0.12,0.3,1           one column per damage level
 *   z=15                             camera distance, metres
 *
 * Damage 0.12 is roughly one moderate shunt and 0.3 is the cap for a single
 * high-speed crash (`SCRATCH_PER_IMPACT_CAP`, vehicle/vehicle.ts), so those two
 * columns are what the game actually shows a player who has hit something.
 */
import * as THREE from 'three';
import { preloadCarModels, createCarModel } from '../../src/render/carmodel';
import { setCarBodyCondition } from '../../src/render/materials';
import { CAR_MODELS } from '../../src/vehicle/carmodels';

const params = new URLSearchParams(location.search);
const requested = (params.get('model') ?? 'st_big_saloon,sv_vaz2106').split(',');
const levels = (params.get('scratches') ?? '0,0.12,0.3,1').split(',').map(Number);
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

const rows: string[] = [];
models.forEach((id, row) => {
  for (const [col, damage] of levels.entries()) {
    // A distinct appearance key per cell, so the random paint does not repeat and
    // hide a dent behind an identical highlight.
    const { body } = createCarModel(id, `${id}:${damage}`);
    body.position.set((col - (levels.length - 1) / 2) * 5.6, row * -2.4, 0);
    body.rotation.y = Math.PI * 0.78;
    setCarBodyCondition(body, 0, damage);
    scene.add(body);
  }
  rows.push(`${id}: ${levels.join('  ')}`);
});

const label = document.createElement('pre');
label.textContent = `scratches left-to-right\n${rows.join('\n')}`;
document.body.appendChild(label);

camera.position.set(0, 1.4 - (models.length - 1) * 1.2, distance);
camera.lookAt(0, -(models.length - 1) * 1.2, 0);
renderer.render(scene, camera);
