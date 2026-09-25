import * as THREE from 'three';

import type { WeatherState } from '../world/weather';

/**
 * RAIN AND SNOW round the camera: one instanced draw of quads in a box that travels
 * with the camera, each particle's position worked out in the vertex shader from its
 * index and the time, so nothing is updated per particle on the CPU.
 *
 * The box is anchored to the world, not the camera: a particle's place in it is its
 * world position modulo the box, so driving through the rain passes the drops rather
 * than carrying them along. Rain is a thin streak, stretched along its fall; snow a
 * soft flake that drifts and sways. The count follows the weather's `precip`, and
 * rain turns to snow by its `snowing` (the season's snow).
 */

const MAX_DROPS = 9000;
/** The box: half its width round the camera, and its height, metres. */
const HALF_BOX_M = 22;
const BOX_HEIGHT_M = 18;

const VERTEX = /* glsl */ `
attribute vec2 aCorner;
uniform vec3 uCam;
uniform float uTime;
uniform float uSnow;
uniform float uCount;
varying vec2 vCorner;
varying float vFade;
float h1( float n ) { return fract( sin( n * 12.9898 ) * 43758.5453 ); }
void main() {
  float id = float( gl_InstanceID );
  vFade = step( id, uCount );
  vec3 seed = vec3( h1( id ), h1( id + 0.37 ), h1( id + 0.71 ) );
  float B = ${(HALF_BOX_M * 2).toFixed(1)};
  float H = ${BOX_HEIGHT_M.toFixed(1)};
  // Rain falls at 7-9 m/s, snow at about 1 with a sway.
  float speed = mix( 7.0 + 2.0 * seed.z, 0.9 + 0.5 * seed.z, uSnow );
  float y = mod( seed.y * H - uTime * speed, H );
  vec2 sway = uSnow * vec2( sin( uTime * 0.9 + id ), cos( uTime * 0.7 + id * 1.3 ) ) * 0.6;
  vec2 xz = seed.xz * B + sway;
  vec2 rel = mod( xz - uCam.xz + B * 0.5, B ) - B * 0.5;
  vec3 at = vec3( uCam.x + rel.x, uCam.y - H * 0.35 + y, uCam.z + rel.y );
  vec3 toCam = normalize( uCam - at );
  vec3 right = normalize( cross( vec3( 0.0, 1.0, 0.0 ), toCam ) );
  // A streak for rain, taller than wide; a round flake for snow.
  vec2 size = mix( vec2( 0.012, 0.55 ), vec2( 0.05, 0.05 ), uSnow );
  vec3 up = mix( vec3( 0.0, 1.0, 0.0 ), cross( toCam, right ), uSnow );
  vec3 p = at + right * aCorner.x * size.x + up * aCorner.y * size.y;
  vCorner = aCorner;
  // Nearest drops fade out: a streak across the lens reads as a scratch.
  vFade *= smoothstep( 0.8, 2.5, length( uCam - at ) ) * ( 1.0 - smoothstep( B * 0.35, B * 0.5, length( rel ) ) );
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
  // Rain: soft across, a tail fading up. Snow: a soft round flake.
  float rain = ( 1.0 - abs( vCorner.x ) ) * smoothstep( -1.0, 0.4, -vCorner.y );
  float snow = 1.0 - smoothstep( 0.4, 1.0, length( vCorner ) );
  float a = mix( rain, snow, uSnow ) * uAlpha * vFade;
  if ( a < 0.01 ) discard;
  gl_FragColor = vec4( uColor, a );
}
`;

export class Precipitation {
  private readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;
  private readonly geometry: THREE.InstancedBufferGeometry;
  private time = 0;

  constructor(scene: THREE.Scene) {
    this.geometry = new THREE.InstancedBufferGeometry();
    this.geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 3));
    this.geometry.setAttribute('aCorner', new THREE.Float32BufferAttribute([-1, -1, 1, -1, 1, 1, -1, 1], 2));
    this.geometry.setIndex([0, 1, 2, 0, 2, 3]);
    this.geometry.instanceCount = 0;
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        uCam: { value: new THREE.Vector3() },
        uTime: { value: 0 },
        uSnow: { value: 0 },
        uCount: { value: 0 },
        uColor: { value: new THREE.Color() },
        uAlpha: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      // Not fogged by three: the drops are all within a few tens of metres.
      fog: false,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    // After the grass and the sky: the drops lie over everything behind them.
    this.mesh.renderOrder = 20;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  /** `camera` in scene (origin-relative) coordinates; `daylight` 0..1 dims the drops at night. */
  update(dt: number, camera: THREE.Vector3, weather: WeatherState, daylight: number): void {
    this.time = (this.time + dt) % 3600;
    const count = Math.round(MAX_DROPS * weather.precip * (1 - 0.35 * weather.snowing));
    this.mesh.visible = count > 0;
    if (!this.mesh.visible) return;
    this.geometry.instanceCount = count;
    const u = this.material.uniforms;
    (u.uCam!.value as THREE.Vector3).copy(camera);
    u.uTime!.value = this.time;
    u.uCount!.value = count;
    u.uSnow!.value = weather.snowing;
    const light = 0.35 + 0.65 * daylight;
    (u.uColor!.value as THREE.Color).setRGB(0.8 * light, 0.84 * light, 0.9 * light).lerp(new THREE.Color(light, light, light), weather.snowing);
    u.uAlpha!.value = (0.28 + 0.6 * weather.snowing) * Math.min(1, weather.precip * 1.5);
  }
}
