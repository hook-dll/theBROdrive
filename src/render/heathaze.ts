import * as THREE from 'three';
import type { HeatHazeFrame } from '../core/renderer';
import { ambientAirC } from '../vehicle/cooling';
import type { Terrain } from '../world/terrain';
import { CLOUD_DARKEN_MAX, cloudShadowFrame, cloudShadowShadeAt } from './cloudshadow';

/**
 * HEAT HAZE INPUTS: how hot the ground is, and which ground the view is grazing.
 *
 * The post pass (core/renderer.ts) does the optics. What it cannot know is the
 * world, and two things about the world decide almost everything it draws.
 *
 * HOW HOT. Shimmer is convection off ground that is hotter than the air over it, so
 * it follows the SURFACE's heating, not the sun's height. It used to follow the sun:
 * full strength from about seventeen degrees of elevation, which is nine in the
 * morning, identical at three in the afternoon, and still a fifth at the moment of
 * sunset. Ground heats from what falls on it — the sine of the sun's elevation on a
 * level surface — and the heat builds on the morning's, which is why the real thing
 * is weak until mid-morning, peaks in the early afternoon and is gone while the sun
 * is still up: the low sun no longer outpaces the ground's own radiation. The thermal
 * lag comes from the air temperature the cooling model already keeps
 * (`ambientAirC`, peaking at three in the afternoon), so one clock drives both the
 * radiator and the shimmer and they cannot disagree about which hour is the hot one.
 * A cloud's shade over the ground ahead takes the direct sun off it, which in
 * minutes takes most of the shimmer and all of the mirage with it.
 *
 * WHICH GROUND. The pass integrates the hot layer over a straight line fitted to the
 * terrain ahead along the view, given as the eye's height over it and its slope. The
 * ground directly under the camera is the wrong reference: parked on a crest thirty
 * metres above a plain, the eye was taken to be a metre and a half into the hot air
 * and the whole horizon over the valley boiled. Hundreds of metres out along the
 * look direction is where a grazing ray actually spends its path.
 */

/** Distances along the view the grazed-ground line is fitted through, metres. */
const SAMPLE_DISTANCES_M = [30, 70, 130, 210, 320, 480, 700] as const;
/**
 * Air temperature at which the ground's heating starts to count, and the span above
 * it to full, degrees Celsius. With `ambientAirC`'s 14–46 C day this is nothing
 * before about eight in the morning and everything from one in the afternoon.
 */
const AIR_COOL_C = 20;
const AIR_SPAN_C = 26;
/**
 * Scales insolation × warmth, whose product peaks near 0.78 at one o'clock, so that
 * the peak saturates. Measured by a sweep of the game clock through this function:
 * 0.03 at 07:00, 0.55 at 10:00, 1 from 12:00 to 14:00, 0.54 at 16:00, 0.1 at 17:30.
 */
const HEAT_GAIN = 1.3;
/**
 * How much of the shimmer survives in the core of a cloud's shade. Not none: the
 * ground stays warm for a while and the far horizon the view grazes is mostly not in
 * the same shadow. The mirage, which needs the ground itself superheated, goes.
 */
const SHADED_SHIMMER = 0.4;
/** Where the shade is read: the middle of the grazed ground, metres ahead. */
const SHADE_PROBE_M = 220;
/**
 * The ground-line fit's RMS residual, metres, over which the mirage fades out. A
 * wet-road reflection needs a surface flat to well under its critical angle across
 * hundreds of metres; a dune field is not one.
 */
const FLAT_RMS_M = 0.6;
const ROUGH_RMS_M = 2.5;
/** A steeper fitted line is a hillside, not a layer; clamp it. */
const MAX_SLOPE = 0.08;
/** Time constant of the line's smoothing, seconds, so a glance aside does not pop it. */
const SMOOTHING_S = 0.3;

export interface HeatHazeInput {
  /** The render camera; its position is origin-relative. */
  readonly camera: THREE.Camera;
  readonly originX: number;
  readonly originZ: number;
  /** Arclength hint for the terrain's road projection. */
  readonly hintS: number;
  /** `sky.sunDirection.y`: sine of the sun's elevation. */
  readonly sunHeight: number;
  readonly timeOfDay: number;
  readonly dayLength: number;
  /** World seed, for the cloud-shade field. */
  readonly seed: number;
}

/** Heat on level ground, 0..1, from the sun on it and the air over it. */
export function surfaceHeat(sunHeight: number, timeOfDay: number, dayLength: number): number {
  const warmth = Math.min(
    1,
    Math.max(0, (ambientAirC(timeOfDay, dayLength) - AIR_COOL_C) / AIR_SPAN_C),
  );
  return Math.min(1, Math.max(0, sunHeight) * warmth * HEAT_GAIN);
}

interface MutableHeatHazeFrame {
  shimmer: number;
  mirage: number;
  eyeAboveM: number;
  groundSlope: number;
}

export class HeatHaze {
  private readonly frame: MutableHeatHazeFrame = {
    shimmer: 0,
    mirage: 0,
    eyeAboveM: 1.6,
    groundSlope: 0,
  };
  private readonly forward = new THREE.Vector3();
  private forwardX = 0;
  private forwardZ = 1;
  private primed = false;
  private readonly heights = new Float64Array(SAMPLE_DISTANCES_M.length);

  constructor(private readonly terrain: Terrain) {}

  /** The frame's heat, written into one reused object the renderer reads at once. */
  update(dt: number, input: HeatHazeInput): HeatHazeFrame {
    const eye = input.camera.position;
    const eyeX = eye.x + input.originX;
    const eyeZ = eye.z + input.originZ;
    input.camera.getWorldDirection(this.forward);
    const horizontal = Math.hypot(this.forward.x, this.forward.z);
    // Looking straight down there is no "ahead"; keep the last one.
    if (horizontal > 0.05) {
      this.forwardX = this.forward.x / horizontal;
      this.forwardZ = this.forward.z / horizontal;
    }

    // Least-squares line through the terrain ahead: height = intercept + slope·d.
    let sumD = 0;
    let sumH = 0;
    let sumDD = 0;
    let sumDH = 0;
    for (let i = 0; i < SAMPLE_DISTANCES_M.length; i++) {
      const d = SAMPLE_DISTANCES_M[i];
      const h = this.terrain.heightAt(eyeX + this.forwardX * d, eyeZ + this.forwardZ * d, input.hintS);
      this.heights[i] = h;
      sumD += d;
      sumH += h;
      sumDD += d * d;
      sumDH += d * h;
    }
    const n = SAMPLE_DISTANCES_M.length;
    const slope = (n * sumDH - sumD * sumH) / (n * sumDD - sumD * sumD);
    const intercept = (sumH - slope * sumD) / n;
    // Residual from the unclamped fit: how far the ground departs from any line.
    let residual = 0;
    for (let i = 0; i < SAMPLE_DISTANCES_M.length; i++) {
      const off = this.heights[i] - (intercept + slope * SAMPLE_DISTANCES_M[i]);
      residual += off * off;
    }
    const rms = Math.sqrt(residual / n);
    const eyeAbove = eye.y - intercept;
    const groundSlope = Math.min(MAX_SLOPE, Math.max(-MAX_SLOPE, slope));

    const k = this.primed ? 1 - Math.exp(-Math.max(0, dt) / SMOOTHING_S) : 1;
    this.primed = true;
    this.frame.eyeAboveM += (eyeAbove - this.frame.eyeAboveM) * k;
    this.frame.groundSlope += (groundSlope - this.frame.groundSlope) * k;

    const heat = surfaceHeat(input.sunHeight, input.timeOfDay, input.dayLength);
    // The cloud field's own strength is zero at night and wherever it is not being
    // advanced (the labs), so shade is only ever counted where the ground shows it.
    const clouds = cloudShadowFrame();
    const shade =
      clouds.strength > 0
        ? cloudShadowShadeAt(
            input.seed,
            eyeX + this.forwardX * SHADE_PROBE_M,
            eyeZ + this.forwardZ * SHADE_PROBE_M,
            clouds.elapsed,
            clouds.detail,
          ) * (clouds.strength / CLOUD_DARKEN_MAX)
        : 0;
    const flat = 1 - smoothstep(FLAT_RMS_M, ROUGH_RMS_M, rms);
    this.frame.shimmer = heat * (1 - (1 - SHADED_SHIMMER) * shade);
    this.frame.mirage = heat * (1 - shade) * flat;
    return this.frame;
  }
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
