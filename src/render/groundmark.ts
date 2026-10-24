import * as THREE from 'three';

/**
 * The one program behind every soft dark mark laid on the ground: the tyre tracks
 * (render/tyretracks.ts) and the contact patches under the wheels (render/contactpatches.ts).
 *
 * A mark is a quad whose corners carry `quad` in -1..1 and an `alpha`; it darkens the
 * ground by `alpha` inside the unit circle of `quad`, fading out from `uShoulder` to its
 * rim. A track is a strip with `quad.y` at 0, so it fades across its width only; a patch
 * is an ellipse. Each owner has its own material (its own shoulder), the shader text is
 * one, so the two link one program.
 */

const VERTEX = /* glsl */ `
attribute vec2 quad;
attribute float alpha;
varying vec2 vQuad;
varying float vAlpha;
#include <fog_pars_vertex>

void main() {
  vQuad = quad;
  vAlpha = alpha;
  vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const FRAGMENT = /* glsl */ `
uniform float uShoulder;
varying vec2 vQuad;
varying float vAlpha;
#include <fog_pars_fragment>

void main() {
  // A soft shoulder rather than a hard edge: where a tyre stops touching, or a track's
  // rut flattens out, is a gradient, not a line.
  float edge = 1.0 - smoothstep( uShoulder, 1.0, length( vQuad ) );
  float visibility = 1.0;
  #ifdef USE_FOG
    #ifdef FOG_EXP2
      visibility = exp( -fogDensity * fogDensity * vFogDepth * vFogDepth );
    #else
      visibility = 1.0 - smoothstep( fogNear, fogFar, vFogDepth );
    #endif
  #endif
  // Zero source colour with a OneMinusSrcAlpha destination factor MULTIPLIES the light
  // the ground already received, so a mark can only ever darken. It cannot glow at
  // midnight, and it cannot brighten a bright surface into a highlight.
  gl_FragColor = vec4( 0.0, 0.0, 0.0, vAlpha * edge * visibility );
}`;

/** A ground mark's material: darkening only, fogged, drawn over the ground it lies on. */
export function groundMarkMaterial(shoulder: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: { ...THREE.UniformsLib.fog, uShoulder: { value: shoulder } },
    fog: true,
    transparent: true,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.ZeroFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
    side: THREE.DoubleSide,
  });
}
