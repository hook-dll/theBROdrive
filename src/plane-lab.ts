/**
 * Plane laboratory (`?plane-lab`, development builds only): the story's light plane on
 * sand under the game's own Renderer and Sky, for judging the model up close.
 *
 * Automation: `window.__planeLab.view(azimuth, elevation, distance, targetY?)` frames
 * the plane and renders; `spin(fraction)` turns the propeller; `time(hours)`.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { prefersMobilePresentation, Renderer } from './core/renderer';
import { parseCalendarEpoch } from './game/calendar';
import { DEFAULT_INK_STRENGTH } from './game/settings';
import { DAY_LENGTH, newWorldState } from './game/state';
import { makeFlatMaterial } from './render/materials';
import { Sky } from './render/sky';
import { loadStarField } from './render/starcatalog';
import { createLightPlane } from './story/plane';

const CALENDAR = newWorldState(1337).calendarEpoch;

export async function bootPlaneLab(): Promise<void> {
  const canvas = document.getElementById('game');
  const loading = document.getElementById('launch-loading');
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error('index.html is missing #game');
  if (loading instanceof HTMLElement) loading.style.display = 'none';
  document.title = 'Plane lab · Voyage Mirage';

  const renderer = new Renderer(canvas, 'blessing', true, DEFAULT_INK_STRENGTH);
  const starField = await loadStarField(new Date(parseCalendarEpoch(CALENDAR)), 'blessing', prefersMobilePresentation());
  const sky = new Sky(renderer.scene, renderer.fog, renderer.renderer, starField);
  await sky.waitForAssets();
  renderer.setViewDistance(600);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), makeFlatMaterial(0xc9a26b, 0.95));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  renderer.scene.add(ground);
  const runway = new THREE.Mesh(new THREE.PlaneGeometry(14, 60), makeFlatMaterial(0x3b3d42, 0.9));
  runway.rotation.x = -Math.PI / 2;
  runway.position.y = 0.005;
  runway.receiveShadow = true;
  renderer.scene.add(runway);

  const plane = createLightPlane();
  renderer.scene.add(plane.group);

  const controls = new OrbitControls(renderer.camera, canvas);
  controls.target.set(0, 1.4, 0);
  renderer.camera.position.set(8, 3, 8);
  controls.update();
  let hours = 11;
  let spin = 0;
  let last = performance.now();

  const view = new THREE.Vector3();
  const renderFrame = (): void => {
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    plane.spin(dt, spin);
    controls.update();
    const cam = renderer.camera.position;
    renderer.camera.getWorldDirection(view);
    sky.update(CALENDAR, (hours / 24) * DAY_LENGTH, 0, 0, cam.x, cam.y, cam.z, view.x, view.z);
    renderer.setDaylight(sky.dayFactor);
    renderer.render();
  };
  const loop = (): void => {
    renderFrame();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  (window as unknown as Record<string, unknown>)['__planeLab'] = {
    view(azimuth: number, elevation: number, distance: number, targetY = 1.4, targetZ = 0): void {
      controls.target.set(0, targetY, targetZ);
      renderer.camera.position.set(
        Math.sin(azimuth) * Math.cos(elevation) * distance,
        targetY + Math.sin(elevation) * distance,
        targetZ + Math.cos(azimuth) * Math.cos(elevation) * distance,
      );
      controls.update();
      renderFrame();
    },
    spin(fraction: number): void {
      spin = fraction;
    },
    time(h: number): void {
      hours = h;
    },
    /** The scene, for a script that adds something else to look at beside the plane. */
    scene: renderer.scene,
    ready: true,
  };
}
