import * as THREE from 'three';
import type { CarModelMeasure } from './carmodel';

const HIT_CAPACITY = 8;
const ZONE_COUNT = 9;
const COLLAPSE_THRESHOLD = 0.72;
export interface SandImpact {
  readonly severityMps: number;
  readonly localX: number;
  readonly localY: number;
  readonly localZ: number;
}

const IMPACT_THRESHOLD_MPS = 0.8;

interface SandUniforms {
  readonly bodyFromMesh: { value: THREE.Matrix4 };
  readonly halfExtents: { value: THREE.Vector3 };
  readonly hits: { value: THREE.Vector4[] };
  readonly zones: { value: Float32Array };
}

interface SandBinding {
  readonly material: THREE.MeshStandardMaterial;
  readonly uniforms: SandUniforms;
}

const SAND_VERTEX_PARS = `
uniform mat4 uSandBodyFromMesh;
varying vec3 vSandBodyPosition;
`;

const SAND_VERTEX_POSITION = `
#include <begin_vertex>
vSandBodyPosition = ( uSandBodyFromMesh * vec4( transformed, 1.0 ) ).xyz;
`;
const SAND_FRAGMENT_PARS = `
varying vec3 vSandBodyPosition;
uniform vec3 uSandHalfExtents;
uniform vec4 uSandHits[${HIT_CAPACITY}];
uniform float uSandZones[${ZONE_COUNT}];

float sandHash( vec3 p ) {
  p = fract( p * 0.1031 );
  p += dot( p, p.yzx + 33.33 );
  return fract( ( p.x + p.y ) * p.z );
}

float sandGrain( vec3 p ) {
  float coarse = sandHash( floor( p * 18.0 ) );
  float fine = sandHash( floor( p * 53.0 ) + 17.0 );
  return coarse * 0.72 + fine * 0.28;
}

int sandZone( vec3 p ) {
  int column = p.x < -uSandHalfExtents.x / 3.0 ? 0
    : ( p.x > uSandHalfExtents.x / 3.0 ? 2 : 1 );
  int row = p.z > uSandHalfExtents.z / 3.0 ? 0
    : ( p.z < -uSandHalfExtents.z / 3.0 ? 2 : 1 );
  return row * 3 + column;
}
`;

const SAND_FRAGMENT_EROSION = `
{
  float erosion = 0.0;
  for ( int i = 0; i < ${HIT_CAPACITY}; i ++ ) {
    float radius = uSandHits[ i ].w;
    if ( radius <= 0.0 ) continue;
    float d = distance( vSandBodyPosition, uSandHits[ i ].xyz );
    erosion = max( erosion, 1.0 - smoothstep( radius * 0.18, radius, d ) );
  }

  int zoneIndex = sandZone( vSandBodyPosition );
  float zoneDamage = uSandZones[ zoneIndex ];
  float collapse = smoothstep( ${COLLAPSE_THRESHOLD.toFixed(2)}, 1.0, zoneDamage );
  float threshold = max( erosion * 0.92, collapse * 0.94 );
  float grain = sandGrain( vSandBodyPosition + vec3( zoneDamage * 7.0 ) );
  if ( grain < threshold ) discard;

  float grit = sandGrain( vSandBodyPosition * 1.9 + 4.0 );
  diffuseColor.rgb *= mix( vec3( 0.62, 0.34, 0.12 ), vec3( 0.92, 0.62, 0.28 ), grit );
  roughnessFactor = max( roughnessFactor, 0.96 );
  metalnessFactor = 0.0;
}
#include <opaque_fragment>
`;

function isSandShellMesh(mesh: THREE.Mesh): boolean {
  const name = mesh.name.toLowerCase();
  return !(
    name.includes('light') ||
    name.includes('blinker') ||
    name.includes('wheel') ||
    name.includes('marker')
  );
}

/**
 * Per-car visual erosion. It changes only cloned render materials; collision geometry
 * and mechanical state remain owned by Vehicle and never follow disappearing pixels.
 */
export class SandCarDamage {
  private readonly bindings: SandBinding[] = [];
  private readonly hits = Array.from({ length: HIT_CAPACITY }, () => new THREE.Vector4());
  private readonly zones = new Float32Array(ZONE_COUNT);
  private readonly surfacePoint = new THREE.Vector3();
  private nextHit = 0;

  constructor(
    private readonly body: THREE.Object3D,
    private readonly measure: CarModelMeasure,
  ) {
    body.updateMatrixWorld(true);
    const worldToBody = body.matrixWorld.clone().invert();
    body.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || !isSandShellMesh(object)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      const replacements = materials.map((source) => {
        if (!(source instanceof THREE.MeshStandardMaterial)) return source;
        const material = source.clone();
        material.name = `${source.name || object.name}-sand`;
        material.metalness = 0;
        material.roughness = Math.max(material.roughness, 0.96);
        const previousCompile = source.onBeforeCompile;
        const previousKey = source.customProgramCacheKey;
        const uniforms: SandUniforms = {
          bodyFromMesh: { value: worldToBody.clone().multiply(object.matrixWorld) },
          halfExtents: { value: new THREE.Vector3(...measure.halfExtents) },
          hits: { value: this.hits },
          zones: { value: this.zones },
        };
        material.onBeforeCompile = (shader, renderer) => {
          previousCompile.call(material, shader, renderer);
          shader.uniforms.uSandBodyFromMesh = uniforms.bodyFromMesh;
          shader.uniforms.uSandHalfExtents = uniforms.halfExtents;
          shader.uniforms.uSandHits = uniforms.hits;
          shader.uniforms.uSandZones = uniforms.zones;
          shader.vertexShader = shader.vertexShader
            .replace('#include <common>', `#include <common>\n${SAND_VERTEX_PARS}`)
            .replace('#include <begin_vertex>', SAND_VERTEX_POSITION);
          shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', `#include <common>\n${SAND_FRAGMENT_PARS}`)
            .replace('#include <opaque_fragment>', SAND_FRAGMENT_EROSION);
        };
        material.customProgramCacheKey = () => `${previousKey.call(source)}|sand-car-damage-v2`;
        material.needsUpdate = true;
        this.bindings.push({ material, uniforms });
        return material;
      });
      object.material = Array.isArray(object.material) ? replacements : replacements[0]!;
    });
  }

  applyImpact(impact: SandImpact): void {

    if (impact.severityMps <= IMPACT_THRESHOLD_MPS) return;
    const half = this.measure.halfExtents;
    const ax = Math.abs(impact.localX);
    const az = Math.abs(impact.localZ);
    const toSide = ax > 1e-4 ? half[0] / ax : Infinity;
    const toEnd = az > 1e-4 ? half[2] / az : Infinity;
    const reach = Math.min(toSide, toEnd);
    if (!Number.isFinite(reach)) return;

    this.surfacePoint.set(
      impact.localX * reach,
      -half[1] * 0.05,
      impact.localZ * reach,
    );
    const radius = Math.min(1.05, 0.28 + impact.severityMps * 0.055);
    this.hits[this.nextHit]!.set(
      this.surfacePoint.x,
      this.surfacePoint.y,
      this.surfacePoint.z,
      radius,
    );
    this.nextHit = (this.nextHit + 1) % HIT_CAPACITY;

    const column = this.surfacePoint.x < -half[0] / 3 ? 0 : this.surfacePoint.x > half[0] / 3 ? 2 : 1;
    const row = this.surfacePoint.z > half[2] / 3 ? 0 : this.surfacePoint.z < -half[2] / 3 ? 2 : 1;
    const zone = row * 3 + column;
    const gain = Math.min(0.5, Math.max(0.1, (impact.severityMps - IMPACT_THRESHOLD_MPS) * 0.11));
    this.zones[zone] = Math.min(1, this.zones[zone]! + gain);
  }

  dispose(): void {
    for (const binding of this.bindings) binding.material.dispose();
    this.bindings.length = 0;
  }
}
