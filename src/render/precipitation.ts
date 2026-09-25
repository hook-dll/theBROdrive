import * as THREE from 'three';

import type { WeatherState } from '../world/weather';

/**
 * RAIN AND SNOW round the camera: instanced quads in boxes that travel with the
 * camera, each particle's position worked out in the vertex shader from its index and
 * the time, so nothing is updated per particle on the CPU.
 *
 * The boxes are anchored to the world, not the camera: a particle's place in one is
 * its world position modulo the box, so driving through the rain passes the drops
 * rather than carrying them along. The count follows the weather's `precip`, and rain
 * turns to snow by its `snowing` (the season's snow).
 *
 * WHY RAIN READ AS SLOW MOTION (the owner: "stand, look at the sky, and it is slow
 * motion"). The fall speed was never the fault — 7..9 m/s is a big drop's terminal
 * velocity (Gunn & Kinzer). What the eye takes speed from is ANGULAR speed and the
 * blur it leaves, and the old rain gave it neither:
 *  - every drop within 2.5 m was faded out, and those are the ones that cross the
 *    view in a blink; what was left was drops 5..12 m off, crawling;
 *  - every drop was drawn equally bright whatever its distance: a fixed 12 mm quad
 *    rasterises to a one-pixel line far off, so the slow far drops dominated;
 *  - the streak was a fixed 0.55 m, upright in the world whatever the drop was doing
 *    relative to the eye — looking up it was seen end-on as a drifting dot, and in a
 *    moving car it stayed upright instead of slanting at the windscreen.
 * What the eye (or a camera shutter — Garg & Nayar, Tatarchuk's ToyShop rain) sees of
 * a drop is its path during the exposure. So now:
 *  - a streak is the drop's path over `EXPOSURE_S` RELATIVE TO THE EYE: fall, wind and
 *    the camera's own velocity, so it slants in a moving car and shortens to a dot
 *    only when the drop really is coming straight at you;
 *  - a streak is as wide as the drop (~2 mm) and never drawn thinner than ~1.3 px:
 *    when the drop is thinner than that, its alpha is scaled down by the ratio (the
 *    thin-wire trick), so far drops fade and the fast near ones carry the rain;
 *  - a second, dense box of drops close round the eye (`NEAR`), faded only inside
 *    0.35 m, so there are always drops streaking past at arm's length;
 *  - drizzle falls slower than a downpour: small drops, low terminal speed.
 */

/** A shutter the eye stands in for: long enough to read as a streak, not a smear. */
const EXPOSURE_S = 0.04;
/** Terminal speed of drizzle's small drops and of a downpour's big ones, m/s. */
const FALL_DRIZZLE_MPS = 4.5;
const FALL_DOWNPOUR_MPS = 9;
/** Drop width in metres: what a streak is as wide as, before the pixel floor. */
const DROP_WIDTH_M = 0.002;
/** Narrowest a streak is drawn, pixels; thinner drops are dimmed instead. */
const MIN_WIDTH_PX = 1.3;
/** Wind at drop level in the rain, m/s, full at a downpour. */
const RAIN_WIND_MPS = 1.6;

interface Layer {
  /** Half the box's width round the camera, and its height, metres. */
  readonly half: number;
  readonly height: number;
  /** Drops at full precipitation. */
  readonly max: number;
  /** Nearest drops fade out inside this distance: a streak across the lens is a scratch. */
  readonly nearFade: number;
}

/** The wide box: rain to the middle distance. */
const FAR: Layer = { half: 22, height: 18, max: 7000, nearFade: 2.5 };
/** The dense box round the eye: the drops that make rain fast. */
const NEAR: Layer = { half: 4.5, height: 7, max: 5000, nearFade: 0.35 };

const VERTEX = /* glsl */ `
attribute vec2 aCorner; // x: across the streak, y: -1 at the tail .. 1 at the head
uniform vec3 uCam;
uniform vec3 uCamVel;
uniform vec2 uWind;
uniform float uTime;
uniform float uSnow;
uniform float uCount;
uniform float uFall;
uniform float uViewH;
uniform vec3 uBox; // half width, height, near fade
uniform float uSeed;
varying vec2 vCorner;
varying float vFade;
float h1( float n ) { return fract( sin( n * 12.9898 ) * 43758.5453 ); }
void main() {
  float id = float( gl_InstanceID );
  vFade = step( id, uCount );
  float sid = id + uSeed;
  vec3 seed = vec3( h1( sid ), h1( sid + 0.37 ), h1( sid + 0.71 ) );
  float B = uBox.x * 2.0;
  float H = uBox.y;
  // Rain at its terminal speed (spread by drop size), snow at about 1 with a sway.
  float speed = mix( uFall * ( 0.85 + 0.3 * seed.z ), 0.9 + 0.5 * seed.z, uSnow );
  vec2 drift = uWind * ( 1.0 - uSnow );
  float y = mod( seed.y * H - uTime * speed, H );
  vec2 sway = uSnow * vec2( sin( uTime * 0.9 + id ), cos( uTime * 0.7 + id * 1.3 ) ) * 0.6;
  vec2 xz = seed.xz * B + sway + drift * uTime;
  vec2 rel = mod( xz - uCam.xz + B * 0.5, B ) - B * 0.5;
  vec3 at = vec3( uCam.x + rel.x, uCam.y - H * 0.35 + y, uCam.z + rel.y );
  vec3 toCam = uCam - at;
  float dist = length( toCam );
  toCam /= max( dist, 1e-4 );

  // Rain: the drop's path during the exposure, as the eye sees it move.
  vec3 motion = vec3( drift.x, -speed, drift.y ) - uCamVel;
  vec3 path = motion * ${EXPOSURE_S.toFixed(3)};
  vec3 axis = normalize( path + vec3( 0.0, -1e-4, 0.0 ) );
  vec3 side = cross( axis, toCam );
  // End-on (a drop coming straight at the eye) the path has no screen direction.
  side = length( side ) > 1e-3 ? normalize( side ) : normalize( cross( vec3( 1.0, 0.0, 0.0 ), toCam ) );
  float px = 2.0 * dist / ( projectionMatrix[ 1 ][ 1 ] * uViewH );
  float w = max( ${DROP_WIDTH_M.toFixed(4)}, ${MIN_WIDTH_PX.toFixed(2)} * px );
  float thin = ${DROP_WIDTH_M.toFixed(4)} / w;
  vec3 rainP = at - path * ( 0.5 - 0.5 * aCorner.y ) + side * aCorner.x * w * 0.5 + axis * aCorner.y * w * 0.5;

  // Snow: a soft round flake facing the camera.
  vec3 right = normalize( cross( vec3( 0.0, 1.0, 0.0 ), toCam ) );
  vec3 up = cross( toCam, right );
  vec3 snowP = at + ( right * aCorner.x + up * aCorner.y ) * 0.05;

  vec3 p = mix( rainP, snowP, uSnow );
  vCorner = aCorner;
  vFade *= mix( thin, 1.0, uSnow );
  vFade *= smoothstep( uBox.z, uBox.z * 2.5, dist ) * ( 1.0 - smoothstep( B * 0.35, B * 0.5, length( rel ) ) );
  gl_Position = projectionMatrix * viewMatrix * vec4( p, 1.0 );
}
`;

const FRAGMENT = /* glsl */ `
uniform float uSnow;
uniform vec3 uColor;
uniform float uAlpha;
varying vec2 vCorner;
varying float vFade;
void main() {
  if ( vFade <= 0.0 ) discard;
  // Rain: soft across, brightest at the head and fading along the tail. Snow: a soft
  // round flake.
  float rain = ( 1.0 - abs( vCorner.x ) ) * smoothstep( -1.0, 0.6, vCorner.y );
  float snow = 1.0 - smoothstep( 0.4, 1.0, length( vCorner ) );
  float a = mix( rain, snow, uSnow ) * uAlpha * vFade;
  if ( a < 0.004 ) discard;
  gl_FragColor = vec4( uColor, a );
}
`;

const scratchColor = new THREE.Color();

export class Precipitation {
  private readonly layers: { layer: Layer; mesh: THREE.Mesh; geometry: THREE.InstancedBufferGeometry; material: THREE.ShaderMaterial }[] = [];
  private time = 0;
  private readonly camVel = new THREE.Vector3();
  private readonly lastAbs = new THREE.Vector3(Number.NaN, 0, 0);

  constructor(scene: THREE.Scene) {
    const shared = {
      uCam: { value: new THREE.Vector3() },
      uCamVel: { value: this.camVel },
      uWind: { value: new THREE.Vector2() },
      uTime: { value: 0 },
      uSnow: { value: 0 },
      uFall: { value: FALL_DOWNPOUR_MPS },
      uViewH: { value: 1080 },
      uColor: { value: new THREE.Color() },
      uAlpha: { value: 0 },
    };
    [FAR, NEAR].forEach((layer, k) => {
      const geometry = new THREE.InstancedBufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 3));
      geometry.setAttribute('aCorner', new THREE.Float32BufferAttribute([-1, -1, 1, -1, 1, 1, -1, 1], 2));
      geometry.setIndex([0, 1, 2, 0, 2, 3]);
      geometry.instanceCount = 0;
      const material = new THREE.ShaderMaterial({
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        uniforms: {
          ...shared,
          uCount: { value: 0 },
          uBox: { value: new THREE.Vector3(layer.half, layer.height, layer.nearFade) },
          uSeed: { value: k * 7919 },
        },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        // Not fogged by three: the drops are all within a few tens of metres.
        fog: false,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.frustumCulled = false;
      // After the grass and the sky: the drops lie over everything behind them.
      mesh.renderOrder = 20;
      mesh.visible = false;
      scene.add(mesh);
      this.layers.push({ layer, mesh, geometry, material });
    });
  }

  /**
   * `camera` in scene (origin-relative) coordinates, `absX`/`absZ` its absolute world
   * position (for its velocity, which a rebase must not jolt), `viewHeightPx` the
   * drawing buffer's height; `daylight` 0..1 dims the drops at night.
   */
  update(dt: number, camera: THREE.Vector3, absX: number, absZ: number, weather: WeatherState, daylight: number, viewHeightPx: number): void {
    this.time = (this.time + dt) % 3600;
    // The eye's velocity, smoothed over a few frames: it is what slants the streaks.
    if (dt > 0 && Number.isFinite(this.lastAbs.x)) {
      const vx = (absX - this.lastAbs.x) / dt;
      const vy = (camera.y - this.lastAbs.y) / dt;
      const vz = (absZ - this.lastAbs.z) / dt;
      // A teleport or a respawn is not a velocity.
      if (vx * vx + vy * vy + vz * vz < 90 * 90) {
        const k = 1 - Math.exp(-dt * 12);
        this.camVel.x += (vx - this.camVel.x) * k;
        this.camVel.y += (vy - this.camVel.y) * k;
        this.camVel.z += (vz - this.camVel.z) * k;
      }
    }
    this.lastAbs.set(absX, camera.y, absZ);

    const share = weather.precip * (1 - 0.35 * weather.snowing);
    const light = 0.35 + 0.65 * daylight;
    const snow = weather.snowing;
    scratchColor.setRGB(light * (0.8 + 0.2 * snow), light * (0.84 + 0.16 * snow), light * (0.9 + 0.1 * snow));
    for (const { layer, mesh, geometry, material } of this.layers) {
      const count = Math.round(layer.max * share);
      mesh.visible = count > 0;
      if (!mesh.visible) continue;
      geometry.instanceCount = count;
      const u = material.uniforms;
      u.uCount!.value = count;
    }
    const u = this.layers[0]!.material.uniforms;
    (u.uCam!.value as THREE.Vector3).copy(camera);
    u.uTime!.value = this.time;
    u.uSnow!.value = weather.snowing;
    u.uFall!.value = FALL_DRIZZLE_MPS + (FALL_DOWNPOUR_MPS - FALL_DRIZZLE_MPS) * Math.min(1, weather.precip);
    (u.uWind!.value as THREE.Vector2).set(RAIN_WIND_MPS * weather.precip, RAIN_WIND_MPS * 0.4 * weather.precip);
    u.uViewH!.value = viewHeightPx;
    (u.uColor!.value as THREE.Color).copy(scratchColor);
    // Rain's alpha is for a streak at full width; the thin-wire scaling dims far drops.
    u.uAlpha!.value = (0.45 + 0.43 * weather.snowing) * Math.min(1, weather.precip * 1.5);
  }
}
