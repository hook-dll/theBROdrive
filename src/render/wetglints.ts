import * as THREE from 'three';

/**
 * WET-ROAD REFLECTIONS OF LAMPS: the long streaks a wet road at night draws under
 * every headlight and tail lamp, from as far off as the lamp itself can be seen.
 *
 * WHY THIS EXISTS (the owner, driving on wet asphalt: the glints appear too close to
 * the player, which breaks immersion). Until now every reflection of a lamp on the wet
 * road was ordinary lighting from the fixed pool of dynamic spotlights
 * (render/vehiclelights.ts): a glossy road shows a spotlight's specular highlight, and
 * that is all it could show. But a spotlight is an ILLUMINANCE model, and the pool is
 * rationed by distance — another car's beam fades in between 130 and 60 m
 * (`ambientBeamGain`) — so an oncoming car's reflection did not exist until it was
 * close, then grew in under it. On a real wet road the reflection of a lamp is its
 * mirror image in a rough water film, and a mirror image is as bright as the lamp
 * itself however far away it is (radiance is conserved along the ray): the streaks of
 * oncoming headlights are the first thing you see of a car at night in the rain, long
 * before its light reaches you.
 *
 * WHAT IT DRAWS. For each lit lamp, one additive quad lying ON the road along the line
 * from the lamp's foot toward the eye, centred on the mirror point — where the eye sees
 * the lamp's reflection — and stretched along that line. At the grazing angles a road
 * is seen at, a strip lying on the ground and pointing at the eye projects as a tall
 * vertical streak: the familiar elongated reflection, which comes from the water film
 * and the rain ripples spreading the mirror lobe far more along the view than across
 * it. Its brightness is the lamp's own radiance toward the mirror point (a headlight
 * is bright ahead and dark behind, so one's own headlights leave no streak for a
 * camera behind them, as in life), times the water film's Fresnel reflectance at that
 * angle, times how wet the road is, dimmed by the fog on the way. It lies on the road
 * and is depth-tested, so a car in between hides it.
 *
 * COST. One instanced draw of a few dozen quads, independent of the light pool: no
 * per-pixel light loop, no shader permutation, no pop-in by distance. The lamps go to
 * the GPU as a small float texture, not as instance buffers: on ANGLE over Metal a
 * per-frame `bufferSubData` into a buffer the GPU may still read waits for it (see
 * docs/research-2026-09-26.md, «Дёрганье»), and a texture upload does not.
 */
/** Lamps offered per frame at most: two headlights, two tails, two reversing per car. */
const CAPACITY = 192;
/**
 * How far the streak spreads along the view, as a ratio either side of the mirror
 * point: from xr / SPREAD to xr * SPREAD metres from the eye. The water film on
 * rain-rippled asphalt; a still puddle would be nearly 1.
 */
const SPREAD = 2.4;
/** Streak half-width: about a lens, plus a little lateral spread with distance. */
const HALF_WIDTH_M = 0.09;
const HALF_WIDTH_PER_M = 0.003;
/** Scene-light units to the streak's HDR colour. Tuned by eye against the lenses. */
const GAIN = 0.2;

const VERTEX = /* glsl */ `
attribute vec2 aCorner; // x across, y along (-1 near the eye .. 1 toward the lamp)
// One column per lamp: row 0 position (scene space) and ground height under it,
// row 1 beam direction (unit) and lobe sharpness (0 = bare bulb), row 2 colour ×
// brightness.
uniform sampler2D uLamps;
uniform float uFogDensity;
uniform float uEyeGround;
varying vec2 vCorner;
varying vec3 vColor;
varying float vAlong;
void main() {
  int id = gl_InstanceID;
  vec4 aLamp = texelFetch( uLamps, ivec2( id, 0 ), 0 );
  vec4 aBeam = texelFetch( uLamps, ivec2( id, 1 ), 0 );
  vec3 aColor = texelFetch( uLamps, ivec2( id, 2 ), 0 ).rgb;
  vec3 P = aLamp.xyz;
  float ground = aLamp.w;
  // Heights over the road where each stands: the road between is taken as the plane
  // through the two ground points, so a climb or a dip ahead keeps the geometry.
  float h = P.y - ground;
  float e = cameraPosition.y - uEyeGround;
  vec2 D = P.xz - cameraPosition.xz;
  float d = length( D );
  vCorner = aCorner;
  vColor = vec3( 0.0 );
  vAlong = 0.0;
  if ( h < 0.05 || e < 0.05 || d < 1.0 ) { gl_Position = vec4( 0.0, 0.0, -2.0, 1.0 ); return; }
  vec2 u = D / d;
  vec2 v = vec2( -u.y, u.x );
  // The mirror point: where the ray from the eye to the lamp's image below the road
  // crosses the road.
  float xr = d * e / ( e + h );
  // Spread either side of it, geometric so the halves are alike in angle.
  float x = clamp( xr * pow( ${SPREAD.toFixed(2)}, aCorner.y ), 0.5, d );
  float halfW = ${HALF_WIDTH_M.toFixed(2)} + ${HALF_WIDTH_PER_M.toFixed(4)} * xr;
  vec2 xz = cameraPosition.xz + u * x + v * aCorner.x * halfW;
  // Just over the road, and over its painted markings, which the wet film covers too.
  vec3 p = vec3( xz.x, mix( uEyeGround, ground, x / d ) + 0.07, xz.y );
  vAlong = dot( xz, u );
  // Radiance of the lamp toward the mirror point: a lens beam is bright along its
  // axis and dark behind; a lobe of 0 is a bare bulb.
  vec3 R = vec3( cameraPosition.x + u.x * xr, mix( uEyeGround, ground, xr / d ), cameraPosition.z + u.y * xr );
  vec3 toR = normalize( R - P );
  float lobe = aBeam.w > 0.0 ? pow( max( dot( aBeam.xyz, toR ), 0.0 ), aBeam.w ) : 1.0;
  // The water film's Fresnel reflectance at the angle the eye meets it (Schlick, F0 of
  // water), which is what makes a wet road a mirror only at a glance.
  vec3 toEye = cameraPosition - R;
  float dist = length( toEye );
  float cosV = clamp( e / dist, 0.0, 1.0 );
  float fresnel = 0.02 + 0.98 * pow( 1.0 - cosV, 5.0 );
  float fog = exp( -pow( uFogDensity * dist, 2.0 ) );
  vColor = aColor * lobe * fresnel * fog;
  gl_Position = projectionMatrix * viewMatrix * vec4( p, 1.0 );
}
`;

const FRAGMENT = /* glsl */ `
uniform float uWet;
uniform float uTime;
varying vec2 vCorner;
varying vec3 vColor;
varying float vAlong;
float glintHash( float n ) { return fract( sin( n * 91.3458 ) * 47453.5453 ); }
void main() {
  // Brightest at the mirror point, falling off along the streak and across it.
  float along = exp( -3.0 * vCorner.y * vCorner.y );
  float across = 1.0 - smoothstep( 0.0, 1.0, abs( vCorner.x ) );
  // Rain ripples break the streak into bright and dim bands a few decimetres long,
  // fixed to the road and flickering as drops land — a smooth pillar reads as paint.
  float cell = vAlong * 3.0;
  float k = floor( cell );
  float f = smoothstep( 0.0, 1.0, fract( cell ) );
  float beat = floor( uTime * 7.0 );
  float ripple = mix( glintHash( k + beat * 17.0 ), glintHash( k + 1.0 + beat * 17.0 ), f );
  vec3 col = vColor * along * across * across * uWet * ( 0.45 + 0.8 * ripple );
  if ( max( col.r, max( col.g, col.b ) ) < 0.002 ) discard;
  gl_FragColor = vec4( col, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const scratchColor = new THREE.Color();

export class WetGlints {
  private readonly mesh: THREE.Mesh;
  private readonly geometry: THREE.InstancedBufferGeometry;
  private readonly material: THREE.ShaderMaterial;
  /** CAPACITY × 3 RGBA floats: see the vertex shader for the rows. */
  private readonly data = new Float32Array(CAPACITY * 3 * 4);
  private readonly texture: THREE.DataTexture;
  private count = 0;

  constructor(scene: THREE.Scene) {
    this.geometry = new THREE.InstancedBufferGeometry();
    this.geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(12), 3));
    this.geometry.setAttribute('aCorner', new THREE.Float32BufferAttribute([-1, -1, 1, -1, 1, 1, -1, 1], 2));
    this.geometry.setIndex([0, 1, 2, 0, 2, 3]);
    this.geometry.instanceCount = 0;
    this.texture = new THREE.DataTexture(this.data, CAPACITY, 3, THREE.RGBAFormat, THREE.FloatType);
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.generateMipmaps = false;
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        uLamps: { value: this.texture },
        uWet: { value: 0 },
        uFogDensity: { value: 0 },
        uEyeGround: { value: 0 },
        uTime: { value: 0 },
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      fog: false,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    // Over the road and its markings, under the rain.
    this.mesh.renderOrder = 15;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  beginFrame(): void {
    this.count = 0;
  }

  /**
   * One lit lamp. `position` in scene space, `ground` the road height under it,
   * `beam` the lens axis (unit) with `lobe` its sharpness (0 for a bare bulb),
   * `brightness` in the scene-light units its spotlight would carry.
   */
  addLamp(position: THREE.Vector3, ground: number, beam: THREE.Vector3, lobe: number, color: THREE.ColorRepresentation, brightness: number): void {
    if (!(brightness > 0) || this.count >= CAPACITY) return;
    const i = this.count++;
    const d = this.data;
    const a = i * 4;
    const b = CAPACITY * 4 + a;
    const c = CAPACITY * 8 + a;
    d[a] = position.x;
    d[a + 1] = position.y;
    d[a + 2] = position.z;
    d[a + 3] = ground;
    d[b] = beam.x;
    d[b + 1] = beam.y;
    d[b + 2] = beam.z;
    d[b + 3] = lobe;
    scratchColor.set(color);
    const k = brightness * GAIN;
    d[c] = scratchColor.r * k;
    d[c + 1] = scratchColor.g * k;
    d[c + 2] = scratchColor.b * k;
  }

  /**
   * `wet` 0..1 how wet the road is; `fogDensity` the scene's exponential-squared fog;
   * `eyeGround` the road height under the camera; `dt` seconds, for the ripples.
   */
  endFrame(wet: number, fogDensity: number, eyeGround: number, dt: number): void {
    const u = this.material.uniforms;
    u.uTime!.value = (u.uTime!.value + dt) % 600;
    this.mesh.visible = this.count > 0 && wet > 0.01;
    if (!this.mesh.visible) return;
    this.geometry.instanceCount = this.count;
    this.texture.needsUpdate = true;
    u.uWet!.value = wet;
    u.uFogDensity!.value = fogDensity;
    u.uEyeGround!.value = eyeGround;
  }
}
