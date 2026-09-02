/**
 * tools/haze-probe.ts
 *
 * Measures the heat-haze pass instead of describing it.
 *
 * The effect makes four claims that are all geometric, and every one of them is
 * checkable without a human looking at anything:
 *
 *   1. WHERE IT IS. Displacement follows the length of each pixel's view ray inside
 *      the hot layer over the sand. So it must be near zero well above the horizon
 *      (the ray leaves the layer at once), near zero pointing steeply down (the ray
 *      hits the ground in metres), and at its maximum along the horizon.
 *   2. IT IS NOT A SCREEN BAND. Roll the camera 40 degrees and the shimmer must roll
 *      with the world, i.e. the profile against the RAY'S elevation angle must not
 *      move at all, while the profile against the screen ROW must.
 *   3. IT IS ANGULAR. Halve the field of view and the same piece of world must show
 *      twice the displacement in pixels, because that is what magnification means.
 *   4. IT IS ANCHORED TO A DIRECTION at a fixed range around the player, so moving
 *      the eye must change nothing and only time may.
 *
 * The measurement is exact rather than statistical: the pass is fed a floating-point
 * texture whose red and green channels ARE the u and v of each texel, so whatever the
 * shader samples, it writes back the source coordinate it sampled from. Subtracting
 * the destination coordinate gives the displacement field in UV, to full float
 * precision, for every pixel at once.
 *
 * It needs a GPU, so like tools/handling-bench.ts it is loaded from the dev server:
 *
 *   import { runHazeProbe } from '/tools/haze-probe.ts';
 *   await runHazeProbe();
 *
 * Nothing here is part of the game bundle.
 */

import * as THREE from 'three';
import { HAZE_FRAGMENT, HAZE_VERTEX } from '../src/core/renderer';

const WIDTH = 480;
const HEIGHT = 270;
/** Field of view the reference runs at, degrees. */
const BASE_FOV = 70;
/** Eye height above the sand, metres: a standing player. */
const EYE_ABOVE = 1.6;

export interface ElevationBin {
  /** Ray elevation above the horizontal, degrees, at the bin's centre. */
  readonly elevationDeg: number;
  /** Mean absolute angular displacement in that bin, milliradians. */
  readonly milliradians: number;
}

export interface HazeProbeResult {
  readonly byElevation: readonly ElevationBin[];
  readonly byScreenRow: readonly ElevationBin[];
}

interface Probe {
  render(config: {
    pitchDeg: number;
    rollDeg: number;
    yawDeg: number;
    fovDeg: number;
    time: number;
  }): Float32Array;
  /** Wall-clock cost of the fullscreen pass at 1080p, with and without the field. */
  cost(): { warpOnMs: number; warpOffMs: number };
  dispose(): void;
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
      // A REFERENCE CHANNEL, and the measurement does not work without it. The pass
      // ends by scaling colour: a faint density term from the field, and on top of it
      // the shades and binocular masks. Every one of those is a MULTIPLY, so reading
      // the coordinate as R/B and G/B cancels all of them exactly, while reading R and
      // G raw reports a 4% brightness change as a displacement — which, at a
      // coordinate near 0.5, is three times the displacement being measured.
      data[i + 2] = 1;
    }
  }
  const source = new THREE.DataTexture(data, WIDTH, HEIGHT, THREE.RGBAFormat, THREE.FloatType);
  source.minFilter = THREE.LinearFilter;
  source.magFilter = THREE.LinearFilter;
  source.needsUpdate = true;

  const target = new THREE.WebGLRenderTarget(WIDTH, HEIGHT, {
    type: THREE.FloatType,
    depthBuffer: false,
    stencilBuffer: false,
  });

  const material = new THREE.ShaderMaterial({
    vertexShader: HAZE_VERTEX,
    fragmentShader: HAZE_FRAGMENT,
    toneMapped: false,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      tDiffuse: { value: source },
      uResolution: { value: new THREE.Vector2(WIDTH, HEIGHT) },
      uTime: { value: 0 },
      uStrength: { value: 1 },
      uEyeAbove: { value: EYE_ABOVE },
      uHorizon: { value: 0.5 },
      uCameraRotation: { value: new THREE.Matrix3() },
      uTanHalfFov: { value: Math.tan(THREE.MathUtils.degToRad(BASE_FOV) / 2) },
      // The ink and lens passes multiply colour. Here colour IS the measurement, so
      // both are switched off; they are unrelated to what this tool checks.
      uInkStrength: { value: 0 },
      uInkThreshold: { value: 1 },
      uViewTint: { value: new THREE.Color(1, 1, 1) },
      uViewTintStrength: { value: 0 },
      uBinoculars: { value: 0 },
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
  const pixels = new Float32Array(WIDTH * HEIGHT * 4);

  return {
    render({ pitchDeg, rollDeg, yawDeg, fovDeg, time }) {
      euler.set(
        THREE.MathUtils.degToRad(pitchDeg),
        THREE.MathUtils.degToRad(yawDeg),
        THREE.MathUtils.degToRad(rollDeg),
        'YXZ',
      );
      matrix.makeRotationFromEuler(euler);
      (material.uniforms.uCameraRotation.value as THREE.Matrix3).setFromMatrix4(matrix);
      material.uniforms.uTanHalfFov.value = Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2);
      material.uniforms.uTime.value = time;
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
      // A one-pixel read after each batch, purely to make the GPU finish the work
      // before the clock is read: without it the timings are queue-submission times.
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
        for (let i = 0; i < 20; i++) renderer.render(scene, camera);
        renderer.readRenderTargetPixels(big, 0, 0, 1, 1, drain);
        const started = performance.now();
        for (let i = 0; i < 60; i++) {
          material.uniforms.uTime.value = i * 0.01;
          renderer.render(scene, camera);
        }
        renderer.readRenderTargetPixels(big, 0, 0, 1, 1, drain);
        const elapsed = (performance.now() - started) / 60;
        renderer.setRenderTarget(null);
        return elapsed;
      };
      const warpOnMs = time(1);
      const warpOffMs = time(0);
      big.dispose();
      material.uniforms.uStrength.value = 1;
      material.uniforms.uResolution.value.set(WIDTH, HEIGHT);
      return { warpOnMs, warpOffMs };
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      source.dispose();
      target.dispose();
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

let failures = 0;

function check(label: string, ok: boolean, detail: string): void {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(52)} ${detail}`);
}

export async function runHazeProbe(): Promise<HazeProbeResult> {
  const probe = makeProbe();
  failures = 0;
  try {
    // --- 1. Where the shimmer is, against the ray's own elevation --------------
    const level = probe.render({ pitchDeg: 0, rollDeg: 0, yawDeg: 0, fovDeg: BASE_FOV, time: 3 });
    const byElevation = binned(level, BASE_FOV, rotationOf(0, 0), false);
    console.log('heat haze, level camera: displacement against ray elevation');
    for (const bin of byElevation) {
      const bar = '#'.repeat(Math.round(bin.milliradians * 6));
      console.log(
        `  ${String(bin.elevationDeg).padStart(4)} deg  ${bin.milliradians.toFixed(3)} mrad  ${bar}`,
      );
    }

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

    // --- 6. What the field costs ----------------------------------------------
    //
    // The whole effect is one fullscreen pass, so its cost is one number: how much
    // longer the pass takes with the field switched on. Measured at 1080p, which is
    // what the graphics tiers that run it are drawing at.
    const cost = probe.cost();
    console.log(
      `\nfullscreen pass at 1920x1080: ${cost.warpOffMs.toFixed(3)} ms without the field, ` +
        `${cost.warpOnMs.toFixed(3)} ms with it (${(cost.warpOnMs - cost.warpOffMs).toFixed(3)} ms)`,
    );

    console.log(failures === 0 ? '\nall checks passed' : `\n${failures} FAILED`);
    return { byElevation, byScreenRow: tiltedRows };
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
