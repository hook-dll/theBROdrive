/**
 * tools/haze-probe.ts
 *
 * Measures the heat-haze pass instead of describing it.
 *
 * The effect makes claims that are all geometric, and every one of them is checkable
 * without a human looking at anything:
 *
 *   1. WHERE IT IS. Displacement follows the length of each pixel's view ray inside
 *      the hot layer over the sand. So it must be near zero well above the horizon
 *      (the ray leaves the layer at once), near zero pointing steeply down (the ray
 *      hits the ground in metres), and at its maximum along the horizon.
 *   2. IT IS NOT A SCREEN BAND. Roll the camera 40 degrees and the shimmer must roll
 *      with the world, i.e. the profile against the RAY'S elevation angle must not
 *      move at all, while the profile against the screen ROW must.
 *   3. IT IS ANGULAR. Quarter the field of view and the same piece of world must show
 *      the same displacement in milliradians, i.e. four times as many pixels.
 *   4. IT IS ANCHORED TO A DIRECTION, so panning finds the same air and only time
 *      moves the field.
 *   5. IT RESPECTS SCENE DEPTH. A nearby rendered surface must remain rigid even
 *      when its pixel lies on the horizon ray where distant scenery boils hardest,
 *      and the path is cut at the surface: a plane 150 m out boils less than the far
 *      desert on the same rays.
 *   6. NOTHING LEAKS ACROSS A SILHOUETTE. Far pixels beside a near object may never
 *      take their colour from it.
 *   7. IT BELONGS TO THE GROUND. Over a real ground plane, the band reaches no
 *      further into the open sky than into the ground, give or take the eye height.
 *   8. THE MIRAGE MIRRORS. Over hot flat ground just below the horizon, pixels take
 *      part of their colour from the same angle ABOVE the horizon, and nowhere else.
 *
 * The measurement is exact rather than statistical: the pass is fed a floating-point
 * texture whose red and green channels ARE the u and v of each texel, so whatever the
 * shader samples, it writes back the source coordinate it sampled from. Subtracting
 * the destination coordinate gives the displacement field in UV, to full float
 * precision, for every pixel at once. The pass is compiled with
 * `HAZE_MEASURE_SOURCE`, which skips its colour finish (grade, grain, lenses) and
 * nothing else — those would otherwise add tens of milliradians of false motion.
 *
 * It needs a GPU, so like tools/handling-bench.ts it is loaded from the dev server:
 *
 *   import { runHazeProbe } from '/tools/haze-probe.ts';
 *   await runHazeProbe();
 *
 * Nothing here is part of the game bundle.
 */

import * as THREE from 'three';
import {
  advanceHazePhase,
  createHeatMirageUniforms,
  DEFAULT_HEAT_MIRAGE,
  HAZE_FRAGMENT,
  HAZE_VERTEX,
} from '../src/core/renderer';

const WIDTH = 480;
const HEIGHT = 270;
/** Field of view the reference runs at, degrees. */
const BASE_FOV = 70;
/** Eye height above the sand, metres: a standing player. */
const EYE_ABOVE = 1.6;
/** A chase camera's eye height over the road, metres. */
const CHASE_EYE_ABOVE = 3;
const PROBE_NEAR = 0.1;
const PROBE_FAR = 4000;

export interface ElevationBin {
  /** Ray elevation above the horizontal, degrees, at the bin's centre. */
  readonly elevationDeg: number;
  /** Mean absolute angular displacement in that bin, milliradians. */
  readonly milliradians: number;
}

export interface HazeProbeResult {
  readonly byElevation: readonly ElevationBin[];
  readonly byScreenRow: readonly ElevationBin[];
  readonly failures: number;
}

/**
 * Positive camera-forward depth of the surface a pixel shows, metres. Receives the
 * pixel's view-space and world-space unit rays.
 */
type DepthScene = (x: number, y: number, view: THREE.Vector3, world: THREE.Vector3) => number;

interface RenderConfig {
  pitchDeg: number;
  rollDeg: number;
  yawDeg: number;
  fovDeg: number;
  time: number;
  /** Scene depth; the far plane everywhere by default (open sky in every direction). */
  depth?: DepthScene;
  /** Shimmer strength; one by default, zero models night/Acceptable. */
  strength?: number;
  /** Mirage strength; zero by default so the shimmer is measured alone. */
  mirage?: number;
  eyeAbove?: number;
}

interface Probe {
  render(config: RenderConfig): Float32Array;
  /** Wall-clock cost of the fullscreen pass at 1080p, with and without the field. */
  cost(): { warpOnMs: number; warpOffMs: number };
  dispose(): void;
}

/** A ground plane `eyeAbove` metres below the eye, open sky above the horizon. */
function groundPlane(eyeAbove: number): DepthScene {
  return (_x, _y, view, world) =>
    world.y < -1e-5 ? Math.min(PROBE_FAR, eyeAbove / -world.y) * -view.z : PROBE_FAR;
}

/** One opaque plane perpendicular to the view axis. */
function planeAt(viewDepthM: number): DepthScene {
  return () => viewDepthM;
}

/**
 * A near object — a car ten metres out — covering the middle of the frame from the
 * bottom edge to `topDeg` above the horizon, in front of open far desert.
 */
const BOX_X0 = 0.42;
const BOX_X1 = 0.58;
function nearBox(topDeg: number): DepthScene {
  return (x, _y, view, world) => {
    const u = (x + 0.5) / WIDTH;
    const inside =
      u >= BOX_X0 && u <= BOX_X1 && Math.asin(world.y) <= THREE.MathUtils.degToRad(topDeg);
    return inside ? 10 : PROBE_FAR * 0.999 * -view.z;
  };
}

/**
 * A pass identical to the game's, wired to report where it sampled from.
 *
 * `tDiffuse` is a float texture holding (u, v) at every texel, so the output at a
 * pixel is the SOURCE coordinate the shader chose for it. Linear filtering is what
 * makes it sub-texel exact: an interpolated (u, v) is still the exact coordinate
 * halfway between two texels.
 */
function makeProbe(): Probe {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  renderer.setSize(WIDTH, HEIGHT, false);

  const data = new Float32Array(WIDTH * HEIGHT * 4);
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const i = (y * WIDTH + x) * 4;
      data[i] = (x + 0.5) / WIDTH;
      data[i + 1] = (y + 0.5) / HEIGHT;
      // A reference channel keeps the coordinate measurement independent of any
      // colour scaling the pass might still apply.
      data[i + 2] = 1;
    }
  }
  const source = new THREE.DataTexture(data, WIDTH, HEIGHT, THREE.RGBAFormat, THREE.FloatType);
  source.minFilter = THREE.LinearFilter;
  source.magFilter = THREE.LinearFilter;
  source.needsUpdate = true;

  // Synthetic scene depth, rebuilt for every render from the scene function and the
  // camera attitude, so a ground plane stays a ground plane when the camera rolls.
  const depthData = new Float32Array(WIDTH * HEIGHT * 4);
  depthData.fill(1);
  const depthSource = new THREE.DataTexture(
    depthData,
    WIDTH,
    HEIGHT,
    THREE.RGBAFormat,
    THREE.FloatType,
  );
  depthSource.minFilter = THREE.NearestFilter;
  depthSource.magFilter = THREE.NearestFilter;
  depthSource.needsUpdate = true;

  const target = new THREE.WebGLRenderTarget(WIDTH, HEIGHT, {
    type: THREE.FloatType,
    depthBuffer: false,
    stencilBuffer: false,
  });

  const material = new THREE.ShaderMaterial({
    vertexShader: HAZE_VERTEX,
    fragmentShader: `#define HAZE_MEASURE_SOURCE\n${HAZE_FRAGMENT}`,
    toneMapped: false,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      tDiffuse: { value: source },
      tDepth: { value: depthSource },
      uResolution: { value: new THREE.Vector2(WIDTH, HEIGHT) },
      uTime: { value: 0 },
      uStrength: { value: 1 },
      uMirage: { value: 0 },
      uHazePhase: { value: new THREE.Vector2() },
      ...createHeatMirageUniforms(),
      uDaylight: { value: 1 },
      uEyeAbove: { value: EYE_ABOVE },
      uGroundSlope: { value: 0 },
      uHorizon: { value: 0.5 },
      uCameraRotation: { value: new THREE.Matrix3() },
      uTanHalfFov: { value: Math.tan(THREE.MathUtils.degToRad(BASE_FOV) / 2) },
      uCameraNear: { value: PROBE_NEAR },
      uCameraFar: { value: PROBE_FAR },
      uInkStrength: { value: 0 },
      uInkThreshold: { value: 1 },
      uViewTint: { value: new THREE.Color(1, 1, 1) },
      uViewTintStrength: { value: 0 },
      uBinoculars: { value: 0 },
      uCameraViewfinder: { value: 0 },
    },
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([-1, 3, 0, -1, -1, 0, 3, -1, 0], 3),
  );
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 2, 0, 0, 2, 0], 2));
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(geometry, material));
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const euler = new THREE.Euler();
  const matrix = new THREE.Matrix4();
  const rotation = new THREE.Matrix3();
  const pixels = new Float32Array(WIDTH * HEIGHT * 4);
  const view = new THREE.Vector3();
  const world = new THREE.Vector3();

  const setPhase = (time: number): void => {
    (material.uniforms.uHazePhase.value as THREE.Vector2).set(
      advanceHazePhase(0, time, DEFAULT_HEAT_MIRAGE.broadRiseHz),
      advanceHazePhase(0, time, DEFAULT_HEAT_MIRAGE.fineRiseHz),
    );
  };

  const fillDepth = (depth: DepthScene, fovDeg: number): void => {
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2);
    const aspect = WIDTH / HEIGHT;
    for (let y = 0; y < HEIGHT; y++) {
      for (let x = 0; x < WIDTH; x++) {
        const ndcX = ((x + 0.5) / WIDTH) * 2 - 1;
        const ndcY = ((y + 0.5) / HEIGHT) * 2 - 1;
        view.set(ndcX * aspect * tanHalf, ndcY * tanHalf, -1).normalize();
        world.copy(view).applyMatrix3(rotation);
        const viewDepth = Math.min(PROBE_FAR, Math.max(PROBE_NEAR, depth(x, y, view, world)));
        const viewZ = -viewDepth;
        depthData[(y * WIDTH + x) * 4] =
          ((PROBE_NEAR + viewZ) * PROBE_FAR) / ((PROBE_FAR - PROBE_NEAR) * viewZ);
      }
    }
    depthSource.needsUpdate = true;
  };

  return {
    render({
      pitchDeg,
      rollDeg,
      yawDeg,
      fovDeg,
      time,
      depth = planeAt(PROBE_FAR),
      strength = 1,
      mirage = 0,
      eyeAbove = EYE_ABOVE,
    }) {
      euler.set(
        THREE.MathUtils.degToRad(pitchDeg),
        THREE.MathUtils.degToRad(yawDeg),
        THREE.MathUtils.degToRad(rollDeg),
        'YXZ',
      );
      matrix.makeRotationFromEuler(euler);
      rotation.setFromMatrix4(matrix);
      (material.uniforms.uCameraRotation.value as THREE.Matrix3).copy(rotation);
      material.uniforms.uTanHalfFov.value = Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2);
      setPhase(time);
      material.uniforms.uStrength.value = strength;
      material.uniforms.uMirage.value = mirage;
      material.uniforms.uEyeAbove.value = eyeAbove;
      fillDepth(depth, fovDeg);
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      renderer.readRenderTargetPixels(target, 0, 0, WIDTH, HEIGHT, pixels);
      renderer.setRenderTarget(null);
      // A COPY. The scratch buffer is reused, and every check here compares one render
      // against another: handing out the live buffer made every comparison compare the
      // last render with itself, and pass or fail for no reason.
      return pixels.slice();
    },
    cost() {
      // The SHIPPED pass, colour finish and all, not the measuring build: the cost that
      // matters is the one the game pays. Same uniforms, so the same depth and phase.
      const shipped = new THREE.ShaderMaterial({
        vertexShader: HAZE_VERTEX,
        fragmentShader: HAZE_FRAGMENT,
        toneMapped: false,
        depthTest: false,
        depthWrite: false,
        uniforms: material.uniforms,
      });
      const shippedScene = new THREE.Scene();
      shippedScene.add(new THREE.Mesh(geometry, shipped));
      // A one-pixel read after each batch, purely to make the GPU finish the work
      // before the clock is read: without it the timings are queue-submission times.
      // Measured on whatever depth the last render left: the probe's last render is
      // the open far plane, which is the worst case — every pixel near the horizon
      // is a candidate for the field. Best of three batches, because a laptop GPU
      // changes clock between them.
      const big = new THREE.WebGLRenderTarget(1920, 1080, {
        type: THREE.UnsignedByteType,
        depthBuffer: false,
        stencilBuffer: false,
      });
      const drain = new Uint8Array(4);
      const time = (strength: number): number => {
        material.uniforms.uStrength.value = strength;
        material.uniforms.uResolution.value.set(1920, 1080);
        renderer.setRenderTarget(big);
        for (let i = 0; i < 20; i++) renderer.render(shippedScene, camera);
        renderer.readRenderTargetPixels(big, 0, 0, 1, 1, drain);
        let best = Infinity;
        for (let batch = 0; batch < 3; batch++) {
          const started = performance.now();
          for (let i = 0; i < 60; i++) {
            setPhase(i * 0.01);
            renderer.render(shippedScene, camera);
          }
          renderer.readRenderTargetPixels(big, 0, 0, 1, 1, drain);
          best = Math.min(best, (performance.now() - started) / 60);
        }
        renderer.setRenderTarget(null);
        return best;
      };
      const warpOnMs = time(1);
      const warpOffMs = time(0);
      big.dispose();
      shipped.dispose();
      material.uniforms.uStrength.value = 1;
      material.uniforms.uResolution.value.set(WIDTH, HEIGHT);
      return { warpOnMs, warpOffMs };
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      source.dispose();
      target.dispose();
      depthSource.dispose();
      renderer.dispose();
    },
  };
}

/** The world-space ray for a pixel, matching the shader's own reconstruction. */
function rayElevationDeg(x: number, y: number, fovDeg: number, rotation: THREE.Matrix3): number {
  const tanHalf = Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2);
  const aspect = WIDTH / HEIGHT;
  const ndcX = ((x + 0.5) / WIDTH) * 2 - 1;
  const ndcY = ((y + 0.5) / HEIGHT) * 2 - 1;
  const v = new THREE.Vector3(ndcX * aspect * tanHalf, ndcY * tanHalf, -1).normalize();
  v.applyMatrix3(rotation);
  return THREE.MathUtils.radToDeg(Math.asin(Math.max(-1, Math.min(1, v.y))));
}

/**
 * Angular displacement per pixel, milliradians.
 *
 * The inverse of the shader's own angle-to-UV conversion: a UV offset spans
 * `2·tan(halfFov)` radians over the frame height and the same times the aspect over
 * its width.
 */
function displacementMrad(
  pixels: Float32Array,
  index: number,
  x: number,
  y: number,
  fovDeg: number,
): number {
  const tanHalf = Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2);
  const aspect = WIDTH / HEIGHT;
  // R/B and G/B, never R and G: see the reference channel in `makeProbe`.
  const gain = pixels[index + 2] || 1;
  const du = pixels[index] / gain - (x + 0.5) / WIDTH;
  const dv = pixels[index + 1] / gain - (y + 0.5) / HEIGHT;
  const angleX = du * 2 * tanHalf * aspect;
  const angleY = dv * 2 * tanHalf;
  return Math.hypot(angleX, angleY) * 1000;
}

function binned(
  pixels: Float32Array,
  fovDeg: number,
  rotation: THREE.Matrix3,
  byRow: boolean,
): ElevationBin[] {
  const sums = new Map<number, { total: number; count: number }>();
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x += 3) {
      const index = (y * WIDTH + x) * 4;
      // Fine bins near the horizon, coarse away from it: everything interesting happens
      // in the first few degrees, and 3-degree bins there average the effect away.
      const elevation = byRow ? 0 : rayElevationDeg(x, y, fovDeg, rotation);
      const key = byRow
        ? Math.round(((y / HEIGHT) * 2 - 1) * 10) / 10
        : Math.abs(elevation) <= 6
          ? Math.round(elevation * 2) / 2
          : Math.round(elevation / 3) * 3;
      const bin = sums.get(key) ?? { total: 0, count: 0 };
      bin.total += displacementMrad(pixels, index, x, y, fovDeg);
      bin.count++;
      sums.set(key, bin);
    }
  }
  return [...sums.entries()]
    .map(([elevationDeg, bin]) => ({ elevationDeg, milliradians: bin.total / bin.count }))
    .sort((a, b) => a.elevationDeg - b.elevationDeg);
}

function rotationOf(pitchDeg: number, rollDeg: number, yawDeg = 0): THREE.Matrix3 {
  const euler = new THREE.Euler(
    THREE.MathUtils.degToRad(pitchDeg),
    THREE.MathUtils.degToRad(yawDeg),
    THREE.MathUtils.degToRad(rollDeg),
    'YXZ',
  );
  return new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationFromEuler(euler));
}

function peakOf(bins: readonly ElevationBin[]): ElevationBin {
  return bins.reduce((best, bin) => (bin.milliradians > best.milliradians ? bin : best));
}

function meanWhere(
  bins: readonly ElevationBin[],
  predicate: (bin: ElevationBin) => boolean,
): number {
  const kept = bins.filter(predicate);
  if (kept.length === 0) return 0;
  return kept.reduce((sum, bin) => sum + bin.milliradians, 0) / kept.length;
}

/**
 * How far the band reaches on each side of the horizon: the outermost bins, above
 * and below, still carrying half the peak.
 */
function halfExtent(bins: readonly ElevationBin[]): { upDeg: number; downDeg: number } {
  const half = peakOf(bins).milliradians * 0.5;
  let upDeg = 0;
  let downDeg = 0;
  for (const bin of bins) {
    if (bin.milliradians < half) continue;
    upDeg = Math.max(upDeg, bin.elevationDeg);
    downDeg = Math.max(downDeg, -bin.elevationDeg);
  }
  return { upDeg, downDeg };
}

/**
 * Share of the displacement within six degrees of the horizon that lies above it,
 * the horizon bin split evenly. Bins are 0.5 degrees wide there, so a plain sum is
 * an integral.
 */
function skyShare(bins: readonly ElevationBin[]): number {
  let sky = 0;
  let total = 0;
  for (const bin of bins) {
    if (Math.abs(bin.elevationDeg) > 6) continue;
    total += bin.milliradians;
    if (bin.elevationDeg > 0) sky += bin.milliradians;
    else if (bin.elevationDeg === 0) sky += bin.milliradians * 0.5;
  }
  return total > 0 ? sky / total : 0;
}

function printProfile(title: string, bins: readonly ElevationBin[]): void {
  console.log(title);
  for (const bin of bins) {
    if (Math.abs(bin.elevationDeg) > 6) continue;
    const bar = '#'.repeat(Math.round(bin.milliradians * 40));
    console.log(
      `  ${String(bin.elevationDeg).padStart(4)} deg  ${bin.milliradians.toFixed(3)} mrad  ${bar}`,
    );
  }
}

let failures = 0;

function check(label: string, ok: boolean, detail: string): void {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(54)} ${detail}`);
}

export async function runHazeProbe(): Promise<HazeProbeResult> {
  const probe = makeProbe();
  failures = 0;
  try {
    // --- 1. Where the shimmer is, against the ray's own elevation --------------
    const level = probe.render({ pitchDeg: 0, rollDeg: 0, yawDeg: 0, fovDeg: BASE_FOV, time: 3 });
    const byElevation = binned(level, BASE_FOV, rotationOf(0, 0), false);
    printProfile('heat haze, level camera, open far plane: displacement against ray elevation', byElevation);

    const peak = peakOf(byElevation);
    const highSky = meanWhere(byElevation, (b) => b.elevationDeg >= 12);
    const steepDown = meanWhere(byElevation, (b) => b.elevationDeg <= -18);
    const horizon = meanWhere(byElevation, (b) => Math.abs(b.elevationDeg) <= 3);

    console.log('\nchecks');
    check(
      'peak sits on the horizon',
      Math.abs(peak.elevationDeg) <= 6,
      `peak ${peak.milliradians.toFixed(2)} mrad at ${peak.elevationDeg} deg`,
    );
    check(
      'sky well above the horizon is still',
      highSky < horizon * 0.2,
      `${highSky.toFixed(3)} mrad above 12 deg against ${horizon.toFixed(3)} at the horizon`,
    );
    check(
      'ground under the eye is still',
      steepDown < horizon * 0.25,
      `${steepDown.toFixed(3)} mrad below -18 deg against ${horizon.toFixed(3)} at the horizon`,
    );

    // --- 2. Rolled camera: the world keeps the shimmer, the screen does not ----
    //
    // Rolled with the camera LEVEL, the horizon turns about the centre of the frame and
    // stays through it, so a row-by-row average barely notices — the test would pass on
    // a screen-space band too. Pitched down first, the band sits well above the bottom
    // of the frame, and rolling then sweeps it diagonally across rows it never touched.
    // That is the difference between an effect in the world and a stripe on the glass.
    const tiltPitch = 14;
    const tilted = probe.render({ pitchDeg: tiltPitch, rollDeg: 0, yawDeg: 0, fovDeg: BASE_FOV, time: 3 });
    const rolled = probe.render({ pitchDeg: tiltPitch, rollDeg: 40, yawDeg: 0, fovDeg: BASE_FOV, time: 3 });
    const tiltedByElevation = binned(tilted, BASE_FOV, rotationOf(tiltPitch, 0), false);
    const rolledByElevation = binned(rolled, BASE_FOV, rotationOf(tiltPitch, 40), false);
    const tiltedRows = binned(tilted, BASE_FOV, rotationOf(tiltPitch, 0), true);
    const rolledRows = binned(rolled, BASE_FOV, rotationOf(tiltPitch, 40), true);
    const elevationShift = compare(tiltedByElevation, rolledByElevation);
    const rowShift = compare(tiltedRows, rolledRows);
    check(
      'roll does not move the profile in the WORLD',
      elevationShift < 0.2,
      `mean change ${(elevationShift * 100).toFixed(1)}% against ray elevation`,
    );
    check(
      'roll does move the profile on the SCREEN',
      rowShift > elevationShift * 5,
      `${(rowShift * 100).toFixed(1)}% against screen row, ${(elevationShift * 100).toFixed(1)}% against the world`,
    );

    // --- 3. Pitch: same world, camera aimed elsewhere --------------------------
    const pitched = probe.render({ pitchDeg: 18, rollDeg: 0, yawDeg: 0, fovDeg: BASE_FOV, time: 3 });
    const pitchedByElevation = binned(pitched, BASE_FOV, rotationOf(18, 0), false);
    check(
      'pitch does not move the profile in the WORLD',
      compare(byElevation, pitchedByElevation) < 0.2,
      `mean change ${(compare(byElevation, pitchedByElevation) * 100).toFixed(1)}%`,
    );

    // --- 4. Zoom magnifies the boil -------------------------------------------
    const zoomed = probe.render({ pitchDeg: 0, rollDeg: 0, yawDeg: 0, fovDeg: BASE_FOV / 4, time: 3 });
    const zoomedHorizon = meanWhere(
      binned(zoomed, BASE_FOV / 4, rotationOf(0, 0), false),
      (b) => Math.abs(b.elevationDeg) <= 3,
    );
    // Angles are a property of the air, not of the lens: the same patch of sky must
    // wobble by the same number of MILLIRADIANS at any zoom, which is four times as
    // many pixels at a quarter of the field.
    check(
      'zoom keeps the angle and so magnifies the pixels',
      Math.abs(zoomedHorizon - horizon) / Math.max(1e-6, horizon) < 0.35,
      `${zoomedHorizon.toFixed(3)} mrad at ${(BASE_FOV / 4).toFixed(0)} deg fov against ${horizon.toFixed(3)} at ${BASE_FOV}`,
    );

    // --- 5. Yaw: the field belongs to the world, and time is the only motion ---
    const yawed = probe.render({ pitchDeg: 0, rollDeg: 0, yawDeg: 37, fovDeg: BASE_FOV, time: 3 });
    const yawedHorizon = meanWhere(
      binned(yawed, BASE_FOV, rotationOf(0, 0, 37), false),
      (b) => Math.abs(b.elevationDeg) <= 3,
    );
    check(
      'panning finds the same air, not the same picture',
      Math.abs(yawedHorizon - horizon) / Math.max(1e-6, horizon) < 0.35,
      `${yawedHorizon.toFixed(3)} mrad at 37 deg of yaw against ${horizon.toFixed(3)} ahead`,
    );

    const later = probe.render({ pitchDeg: 0, rollDeg: 0, yawDeg: 0, fovDeg: BASE_FOV, time: 3.5 });
    const laterByElevation = binned(later, BASE_FOV, rotationOf(0, 0), false);
    check(
      'the field boils: half a second changes it',
      fieldChange(level, later) > 0.2,
      `mean displacement change ${(fieldChange(level, later) * 100).toFixed(0)}% over 0.5 s`,
    );
    check(
      'boiling does not change WHERE it is',
      compare(byElevation, laterByElevation) < 0.25,
      `profile change ${(compare(byElevation, laterByElevation) * 100).toFixed(1)}%`,
    );
    // The phase is wrapped on the CPU so the shader never sees a large number. The
    // wrap must be invisible: one full lattice period later is the same field.
    const period = 256 / Math.min(DEFAULT_HEAT_MIRAGE.broadRiseHz, DEFAULT_HEAT_MIRAGE.fineRiseHz);
    const wrapped = probe.render({ pitchDeg: 0, rollDeg: 0, yawDeg: 0, fovDeg: BASE_FOV, time: 3 + period * 3 });
    check(
      'the phase wrap is seamless',
      fieldChange(level, wrapped) < 0.02,
      `field change ${(fieldChange(level, wrapped) * 100).toFixed(2)}% after ${(period * 3).toFixed(0)} s`,
    );

    // --- 6. Real scene depth keeps nearby geometry rigid -----------------------
    const nearSurface = probe.render({
      pitchDeg: 0,
      rollDeg: 0,
      yawDeg: 0,
      fovDeg: BASE_FOV,
      time: 3,
      depth: planeAt(10),
    });
    const nearHorizon = meanWhere(
      binned(nearSurface, BASE_FOV, rotationOf(0, 0), false),
      (b) => Math.abs(b.elevationDeg) <= 3,
    );
    check(
      'real depth keeps a ten-metre surface rigid',
      nearHorizon < 0.001,
      `${nearHorizon.toFixed(4)} mrad at 10 m against ${horizon.toFixed(3)} at the far plane`,
    );

    // The path is cut at the surface. Level rays to a wall 150 m out cross 150 m of
    // hot air; the same rays to the far desert cross kilometres.
    const horizonOnly = (b: ElevationBin): boolean => Math.abs(b.elevationDeg) <= 0.5;
    const farLevel = meanWhere(byElevation, horizonOnly);
    const at150 = meanWhere(
      binned(
        probe.render({ pitchDeg: 0, rollDeg: 0, yawDeg: 0, fovDeg: BASE_FOV, time: 3, depth: planeAt(150) }),
        BASE_FOV,
        rotationOf(0, 0),
        false,
      ),
      horizonOnly,
    );
    const at600 = meanWhere(
      binned(
        probe.render({ pitchDeg: 0, rollDeg: 0, yawDeg: 0, fovDeg: BASE_FOV, time: 3, depth: planeAt(600) }),
        BASE_FOV,
        rotationOf(0, 0),
        false,
      ),
      horizonOnly,
    );
    check(
      'a surface 150 m out boils less than the far desert',
      at150 < farLevel * 0.5 && at150 < at600 && at600 <= farLevel * 1.05,
      `${at150.toFixed(3)} mrad at 150 m, ${at600.toFixed(3)} at 600 m, ${farLevel.toFixed(3)} at the far plane`,
    );

    // --- 7. Silhouettes: a far pixel never takes a near object's colour --------
    //
    // A car ten metres out, standing a degree above the horizon, in front of the far
    // desert. Every pixel outside it is far and on the boiling band; a displaced
    // sample that lands inside the car's rectangle is exactly the fringe.
    const boxTopDeg = 1;
    const box = probe.render({
      pitchDeg: 0,
      rollDeg: 0,
      yawDeg: 0,
      fovDeg: BASE_FOV,
      time: 3,
      depth: nearBox(boxTopDeg),
    });
    const levelRotation = rotationOf(0, 0);
    let leaks = 0;
    let edgeShimmer = 0;
    let edgeCount = 0;
    const halfTexelU = 0.5 / WIDTH;
    for (let y = 0; y < HEIGHT; y++) {
      for (let x = 0; x < WIDTH; x++) {
        const u = (x + 0.5) / WIDTH;
        const elevation = rayElevationDeg(x, y, BASE_FOV, levelRotation);
        const insideBox = u >= BOX_X0 && u <= BOX_X1 && elevation <= boxTopDeg;
        if (insideBox) continue;
        const i = (y * WIDTH + x) * 4;
        const gain = box[i + 2] || 1;
        const su = box[i] / gain;
        const sv = box[i + 1] / gain;
        const sx = Math.floor(su * WIDTH);
        const sy = Math.floor(sv * HEIGHT);
        const sourceElevation = rayElevationDeg(sx, sy, BASE_FOV, levelRotation);
        const sourceInBox =
          su >= BOX_X0 + halfTexelU &&
          su <= BOX_X1 - halfTexelU &&
          sourceElevation <= boxTopDeg - 0.2;
        if (sourceInBox) leaks++;
        // Within ten pixels of the car's side, on the horizon band.
        const nearSide = Math.min(Math.abs(u - BOX_X0), Math.abs(u - BOX_X1)) * WIDTH < 10;
        if (nearSide && Math.abs(elevation) <= 0.5) {
          edgeShimmer += displacementMrad(box, i, x, y, BASE_FOV);
          edgeCount++;
        }
      }
    }
    const edgeMean = edgeCount > 0 ? edgeShimmer / edgeCount : 0;
    check(
      'no far pixel takes its colour from a near car',
      leaks === 0,
      `${leaks} leaking pixels`,
    );
    check(
      'the far desert beside the car still boils',
      edgeMean > farLevel * 0.5,
      `${edgeMean.toFixed(3)} mrad within 10 px of the car against ${farLevel.toFixed(3)} in the open`,
    );

    // --- 8. Over a real ground plane: the band belongs to the ground ----------
    const standing = binned(
      probe.render({
        pitchDeg: 0,
        rollDeg: 0,
        yawDeg: 0,
        fovDeg: BASE_FOV,
        time: 3,
        depth: groundPlane(EYE_ABOVE),
      }),
      BASE_FOV,
      levelRotation,
      false,
    );
    const chase = binned(
      probe.render({
        pitchDeg: 0,
        rollDeg: 0,
        yawDeg: 0,
        fovDeg: BASE_FOV,
        time: 3,
        depth: groundPlane(CHASE_EYE_ABOVE),
        eyeAbove: CHASE_EYE_ABOVE,
      }),
      BASE_FOV,
      levelRotation,
      false,
    );
    printProfile(`\nground plane, eye ${EYE_ABOVE} m`, standing);
    printProfile(`\nground plane, eye ${CHASE_EYE_ABOVE} m`, chase);
    const standingExtent = halfExtent(standing);
    const chaseExtent = halfExtent(chase);
    const standingSky = skyShare(standing);
    const chaseSky = skyShare(chase);
    check(
      'standing: the band reaches under 1.5 deg into the sky',
      standingExtent.upDeg <= 1.5,
      `half-strength up to +${standingExtent.upDeg} deg, down to -${standingExtent.downDeg} deg`,
    );
    check(
      'standing: open sky above 3 deg is still',
      meanWhere(standing, (b) => b.elevationDeg >= 3) < peakOf(standing).milliradians * 0.1,
      `${meanWhere(standing, (b) => b.elevationDeg >= 3).toFixed(3)} mrad above 3 deg against a ${peakOf(standing).milliradians.toFixed(3)} peak`,
    );
    // The eye stands INSIDE the hot layer, so from head height the air above it is
    // genuinely about as much as the air below; what must not happen is the old
    // five-degrees-up, under-one-down. From a car's chase camera, higher in the layer,
    // the ground must win outright.
    check(
      'standing: the sky holds at most two thirds of the band',
      standingSky <= 2 / 3,
      `${(standingSky * 100).toFixed(0)}% of the displacement within 6 deg lies above the horizon`,
    );
    check(
      'chase camera: the ground carries more than the sky',
      chaseSky < 0.5 && chaseExtent.upDeg <= chaseExtent.downDeg,
      `${(chaseSky * 100).toFixed(0)}% above the horizon; half-strength +${chaseExtent.upDeg}/-${chaseExtent.downDeg} deg`,
    );

    // --- 9. The inferior mirage mirrors the sky, and only in its band ---------
    const critical = DEFAULT_HEAT_MIRAGE.mirageCriticalMrad / 1000;
    const mirrored = probe.render({
      pitchDeg: 0,
      rollDeg: 0,
      yawDeg: 0,
      fovDeg: BASE_FOV,
      time: 3,
      depth: groundPlane(EYE_ABOVE),
      strength: 0,
      mirage: 1,
    });
    let inBand = 0;
    let pulledUp = 0;
    let outside = 0;
    let strayed = 0;
    for (let y = 0; y < HEIGHT; y++) {
      for (let x = 0; x < WIDTH; x += 3) {
        const i = (y * WIDTH + x) * 4;
        const gain = mirrored[i + 2] || 1;
        const dv = mirrored[i + 1] / gain - (y + 0.5) / HEIGHT;
        const graze = -THREE.MathUtils.degToRad(rayElevationDeg(x, y, BASE_FOV, levelRotation));
        if (graze > critical * 0.15 && graze < critical * 0.5) {
          inBand++;
          if (dv > 0) pulledUp++;
        } else if (graze > critical * 1.02 || graze < 0) {
          outside++;
          if (displacementMrad(mirrored, i, x, y, BASE_FOV) > 1e-3) strayed++;
        }
      }
    }
    check(
      'mirage band takes colour from above the horizon',
      inBand > 0 && pulledUp / inBand > 0.95,
      `${pulledUp} of ${inBand} band pixels pulled upward`,
    );
    check(
      'no mirage outside the critical band',
      strayed === 0,
      `${strayed} of ${outside} pixels outside the band moved`,
    );

    const disabled = probe.render({
      pitchDeg: 0,
      rollDeg: 0,
      yawDeg: 0,
      fovDeg: BASE_FOV,
      time: 3,
      depth: groundPlane(EYE_ABOVE),
      strength: 0,
      mirage: 0,
    });
    const disabledHorizon = meanWhere(
      binned(disabled, BASE_FOV, levelRotation, false),
      (b) => Math.abs(b.elevationDeg) <= 3,
    );
    check(
      'zero strength leaves the frame rigid',
      disabledHorizon < 0.001,
      `${disabledHorizon.toFixed(4)} mrad`,
    );

    // --- 10. What the field costs ---------------------------------------------
    //
    // The whole effect is one fullscreen pass, so its cost is one number: how much
    // longer the pass takes with the field switched on. Measured at 1080p, which is
    // what the graphics tiers that run it are drawing at, over the open far plane.
    probe.render({ pitchDeg: 0, rollDeg: 0, yawDeg: 0, fovDeg: BASE_FOV, time: 3 });
    const cost = probe.cost();
    console.log(
      `\nfullscreen pass at 1920x1080: ${cost.warpOffMs.toFixed(3)} ms without the field, ` +
        `${cost.warpOnMs.toFixed(3)} ms with it (${(cost.warpOnMs - cost.warpOffMs).toFixed(3)} ms)`,
    );

    console.log(failures === 0 ? '\nall checks passed' : `\n${failures} FAILED`);
    return { byElevation, byScreenRow: tiltedRows, failures };
  } finally {
    probe.dispose();
  }
}

/** Mean relative difference between two profiles over their shared bins. */
function compare(a: readonly ElevationBin[], b: readonly ElevationBin[]): number {
  const other = new Map(b.map((bin) => [bin.elevationDeg, bin.milliradians]));
  let total = 0;
  let count = 0;
  let scale = 0;
  for (const bin of a) scale = Math.max(scale, bin.milliradians);
  if (scale <= 0) return 0;
  for (const bin of a) {
    const match = other.get(bin.elevationDeg);
    if (match === undefined) continue;
    total += Math.abs(match - bin.milliradians) / scale;
    count++;
  }
  return count > 0 ? total / count : 0;
}

/**
 * Mean change in the DISPLACEMENT field between two renders, relative to its own size.
 *
 * The raw channels hold absolute coordinates around 0.5 while the displacement is a
 * few thousandths, so comparing them directly divided a real change by a hundred times
 * its own magnitude and reported every render as identical.
 */
function fieldChange(a: Float32Array, b: Float32Array): number {
  let change = 0;
  let magnitude = 0;
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const i = (y * WIDTH + x) * 4;
      const u = (x + 0.5) / WIDTH;
      const v = (y + 0.5) / HEIGHT;
      const ga = a[i + 2] || 1;
      const gb = b[i + 2] || 1;
      const dua = a[i] / ga - u;
      const dva = a[i + 1] / ga - v;
      const dub = b[i] / gb - u;
      const dvb = b[i + 1] / gb - v;
      change += Math.abs(dua - dub) + Math.abs(dva - dvb);
      magnitude += Math.abs(dua) + Math.abs(dva);
    }
  }
  return magnitude > 0 ? change / magnitude : 0;
}
