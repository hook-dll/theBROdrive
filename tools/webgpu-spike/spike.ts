/**
 * Throwaway measurement: the same wood drawn by WebGLRenderer and by WebGPURenderer,
 * GPU time from timer queries, CPU submit time from performance.now.
 *
 * ?r=webgl|webgpu  &csm=1 (WebGPU cascaded shadows)  &traa=1 (WebGPU TRAA)
 * Results land on window.__spike once `frames` frames are measured.
 */
import * as THREE from 'three';
import * as GPU from 'three/webgpu';
import { mrt, output, pass, velocity } from 'three/tsl';
import { traa } from 'three/addons/tsl/display/TRAANode.js';
import { CSMShadowNode } from 'three/addons/csm/CSMShadowNode.js';

import { loadTreeVariants } from '../../src/world/props/trees';

const q = new URLSearchParams(location.search);
const mode = q.get('r') === 'webgpu' ? 'webgpu' : 'webgl';
const useCsm = q.get('csm') === '1';
const useTraa = q.get('traa') === '1';
const FRAMES = Number(q.get('frames') ?? 240);

const NEAR_M = 60;
const SHADOW_M = 110;
const FAR_M = 420;
const CELL = 6.5;

function hash(x: number, z: number, k: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263) ^ Math.imul(k, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

async function main(): Promise<void> {
  const canvas = document.createElement('canvas');
  document.body.appendChild(canvas);
  const w = innerWidth;
  const h = innerHeight;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x8fb4e0);
  const camera = new THREE.PerspectiveCamera(60, w / h, 0.2, 5000);
  camera.position.set(0, 1.6, 0);

  const sun = new THREE.DirectionalLight(0xfff1d8, 2.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const half = 72;
  Object.assign(sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half, near: 1, far: 800 });
  sun.position.set(120, 200, 60);
  scene.add(sun, sun.target);
  scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x8f89b5, 1.2));

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(4000, 4000, 200, 200).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x93aa5e, roughness: 0.93 }),
  );
  ground.receiveShadow = true;
  scene.add(ground);

  // The wood: every CELL a tree, kinds in patches, levels by distance from the camera.
  const variants = await loadTreeVariants();
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
  type Key = string;
  const buckets = new Map<Key, { geometry: THREE.BufferGeometry; matrices: THREE.Matrix4[]; shadow: boolean; foliage: boolean }>();
  const m = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const R = Math.ceil(FAR_M / CELL);
  let trees = 0;
  for (let i = -R; i <= R; i++) {
    for (let j = -R; j <= R; j++) {
      const x = (i + 0.1 + 0.8 * hash(i, j, 1)) * CELL;
      const z = (j + 0.1 + 0.8 * hash(i, j, 2)) * CELL;
      const d = Math.hypot(x, z);
      if (d > FAR_M || Math.abs(x) < 7) continue; // a road down the middle
      if (hash(i, j, 3) > 0.93) continue;
      const patch = Math.floor(x / 90) * 7 + Math.floor(z / 90) * 13;
      const kind = Math.floor(hash(patch, 0, 4) * variants.length + hash(i, j, 5) * 2) % variants.length;
      const kv = variants[kind]!;
      const v = Math.floor(hash(i, j, 6) * kv.length);
      const level = d < NEAR_M ? 0 : d < SHADOW_M ? 1 : 2;
      const parts = level === 0 ? kv[v]!.near : kv[v]!.far;
      quat.setFromAxisAngle(up, hash(i, j, 7) * 6.28);
      const s = 0.8 + 0.4 * hash(i, j, 8);
      m.compose(new THREE.Vector3(x, -0.15, z), quat, new THREE.Vector3(s, s, s));
      parts.forEach((part, p) => {
        const key = `${kind}:${v}:${level}:${p}`;
        let b = buckets.get(key);
        if (!b) buckets.set(key, (b = { geometry: part.geometry, matrices: [], shadow: level < 2, foliage: part.foliage }));
        b.matrices.push(m.clone());
      });
      trees++;
    }
  }
  let tris = 0;
  for (const b of buckets.values()) {
    const mesh = new THREE.InstancedMesh(b.geometry, material, b.matrices.length);
    b.matrices.forEach((mm, k) => mesh.setMatrixAt(k, mm));
    mesh.castShadow = b.shadow;
    mesh.receiveShadow = !b.foliage;
    mesh.frustumCulled = false;
    scene.add(mesh);
    tris += (b.geometry.getAttribute('position').count / 3) * b.matrices.length;
  }

  let render: () => void;
  let gpuMs: () => Promise<number | null>;
  if (mode === 'webgl') {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(1.5);
    renderer.setSize(w, h, false);
    renderer.shadowMap.enabled = true;
    const gl = renderer.getContext() as WebGL2RenderingContext;
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    const pending: WebGLQuery[] = [];
    let last: number | null = null;
    render = () => {
      let query: WebGLQuery | null = null;
      if (ext) {
        query = gl.createQuery();
        gl.beginQuery(ext.TIME_ELAPSED_EXT, query!);
      }
      renderer.render(scene, camera);
      if (ext && query) {
        gl.endQuery(ext.TIME_ELAPSED_EXT);
        pending.push(query);
      }
    };
    gpuMs = async () => {
      while (pending.length && gl.getQueryParameter(pending[0]!, gl.QUERY_RESULT_AVAILABLE)) {
        const qq = pending.shift()!;
        last = gl.getQueryParameter(qq, gl.QUERY_RESULT) / 1e6;
        gl.deleteQuery(qq);
      }
      return last;
    };
  } else {
    const renderer = new GPU.WebGPURenderer({ canvas, antialias: !useTraa, trackTimestamp: true });
    renderer.setPixelRatio(1.5);
    renderer.setSize(w, h, false);
    renderer.shadowMap.enabled = true;
    await renderer.init();
    if (useCsm) {
      const csm = new CSMShadowNode(sun, { cascades: 4, maxFar: 400, mode: 'practical', lightMargin: 100 });
      csm.fade = true;
      sun.shadow.shadowNode = csm;
    }
    let pipeline: GPU.PostProcessing | null = null;
    if (useTraa) {
      pipeline = new GPU.PostProcessing(renderer);
      const scenePass = pass(scene, camera);
      scenePass.setMRT(mrt({ output, velocity }));
      pipeline.outputNode = traa(scenePass.getTextureNode('output'), scenePass.getTextureNode('depth'), scenePass.getTextureNode('velocity'), camera);
    }
    render = () => (pipeline ? pipeline.render() : renderer.render(scene, camera));
    gpuMs = async () => {
      await renderer.resolveTimestampsAsync('render');
      const t = renderer.info.render.timestamp;
      return t > 0 ? t : null;
    };
  }

  const cpu: number[] = [];
  const gpu: number[] = [];
  let frame = 0;
  const loop = async (): Promise<void> => {
    // Drive slowly along the road and turn a little: shadows and TRAA see motion.
    camera.position.set(Math.sin(frame * 0.01) * 2, 1.6, frame * 0.15);
    camera.rotation.set(0, Math.sin(frame * 0.013) * 0.6, 0);
    sun.target.position.copy(camera.position);
    sun.position.copy(camera.position).add(new THREE.Vector3(120, 200, 60));
    const t0 = performance.now();
    render();
    cpu.push(performance.now() - t0);
    const g = await gpuMs();
    if (g !== null && frame > 30) gpu.push(g);
    frame++;
    if (frame < FRAMES) requestAnimationFrame(() => void loop());
    else {
      const med = (a: number[]): number => [...a].sort((x, y) => x - y)[a.length >> 1] ?? NaN;
      const p95 = (a: number[]): number => [...a].sort((x, y) => x - y)[Math.floor(a.length * 0.95)] ?? NaN;
      (window as unknown as Record<string, unknown>)['__spike'] = {
        mode, useCsm, useTraa, trees, tris: Math.round(tris), draws: buckets.size,
        cpuMedian: med(cpu.slice(30)), cpuP95: p95(cpu.slice(30)), gpuMedian: med(gpu), gpuP95: p95(gpu), gpuSamples: gpu.length,
      };
    }
  };
  requestAnimationFrame(() => void loop());
}

void main().catch((e: unknown) => {
  (window as unknown as Record<string, unknown>)['__spike'] = { error: String(e) };
});
