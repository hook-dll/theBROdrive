/**
 * Regression check for the distant terrain overlap.
 *
 * The vista must start outside the streamed near terrain (a collapsed centre ring
 * produces camera-relative cones), while its road-near vertices stay below the road
 * ribbon so the coarse desert cannot erase distant road patches.
 */

import * as THREE from 'three';
import { VistaMesh } from '../src/render/vista';
import { WorldOrigin } from '../src/world/origin';
import { Road } from '../src/world/road';
import { Terrain } from '../src/world/terrain';

const SEED = 3094605770;
const S = 24_000;
const INNER_RADIUS = 400;
const ROAD_CORE = 40;
const ROAD_REACH = 1_600;
const SNAP = 250;

function invariant(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const road = new Road(SEED);
const terrain = new Terrain(SEED, road);
const origin = new WorldOrigin();
const scene = new THREE.Scene();
const vista = new VistaMesh(scene, terrain, road, origin);
const camera = road.sampleAt(S);
vista.setViewDistance(25_000);
vista.update(camera.x, camera.z, S);

const mesh = scene.children.find((child): child is THREE.Mesh => child instanceof THREE.Mesh);
invariant(mesh !== undefined, 'vista mesh was not attached to the scene');
const attribute = mesh.geometry.getAttribute('position');
invariant(attribute instanceof THREE.BufferAttribute, 'vista has no position buffer');
const positions = attribute.array as Float32Array;
const centreX = Math.round(camera.x / SNAP) * SNAP;
const centreZ = Math.round(camera.z / SNAP) * SNAP;
const roadSamples = [];
for (let s = S - ROAD_REACH; s <= S + ROAD_REACH; s += 40) {
  const point = road.sampleAt(s);
  roadSamples.push({
    x: point.x,
    z: point.z,
    y: terrain.explorationHeightFromFrame(point.x, point.z, 0, point.s),
  });
}

let minimumRadius = Infinity;
let coreVertices = 0;
let worstRoadOverdraw = -Infinity;
for (let i = 0; i < positions.length; i += 3) {
  const x = positions[i]!;
  const y = positions[i + 1]!;
  const z = positions[i + 2]!;
  invariant(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z), `non-finite vertex ${i / 3}`);

  const radius = Math.hypot(x - centreX, z - centreZ);
  minimumRadius = Math.min(minimumRadius, radius);
  if (radius > ROAD_REACH) continue;

  const absoluteX = x + origin.x;
  const absoluteZ = z + origin.z;
  let closestDistanceSq = Infinity;
  let closestRoadY = 0;
  for (let j = 0; j < roadSamples.length - 1; j++) {
    const a = roadSamples[j]!;
    const b = roadSamples[j + 1]!;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const lengthSq = dx * dx + dz * dz;
    const t = Math.max(
      0,
      Math.min(1, ((absoluteX - a.x) * dx + (absoluteZ - a.z) * dz) / lengthSq),
    );
    const distanceSq =
      (absoluteX - (a.x + dx * t)) ** 2 + (absoluteZ - (a.z + dz * t)) ** 2;
    if (distanceSq >= closestDistanceSq) continue;
    closestDistanceSq = distanceSq;
    closestRoadY = a.y + (b.y - a.y) * t;
  }
  if (closestDistanceSq > ROAD_CORE * ROAD_CORE) continue;
  coreVertices++;
  worstRoadOverdraw = Math.max(worstRoadOverdraw, y - closestRoadY);
}

invariant(
  minimumRadius >= INNER_RADIUS - 0.1,
  `vista intrudes into near terrain: minimum radius ${minimumRadius.toFixed(2)} m`,
);
invariant(coreVertices > 0, 'vista generated no vertices over the road underlay core');
invariant(
  worstRoadOverdraw <= 0,
  `vista rises ${worstRoadOverdraw.toFixed(2)} m above the road`,
);

const rebuilds = 8;
const started = performance.now();
for (let i = 1; i <= rebuilds; i++) {
  vista.update(camera.x + i * SNAP, camera.z, S);
}
const meanRebuildMs = (performance.now() - started) / rebuilds;

console.log(
  `vista: ${attribute.count} vertices, inner radius ${minimumRadius.toFixed(1)} m, ` +
    `${coreVertices} road-core vertices, worst overdraw ${worstRoadOverdraw.toFixed(2)} m, ` +
    `${meanRebuildMs.toFixed(2)} ms/rebuild`,
);
vista.dispose();
