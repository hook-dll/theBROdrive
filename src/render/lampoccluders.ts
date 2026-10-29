import * as THREE from 'three';

/**
 * WHAT STANDS IN A LAMP'S LIGHT: the cars near the eye as oriented boxes, for the lamp
 * light that has no shadow map.
 *
 * One spotlight in the game casts a shadow (the driven car's driver's side headlamp,
 * render/vehiclelights.ts): a second shadowed spot measured ten times dearer. Every other
 * lamp lit the ground straight through the cars standing in its beam, whether it held a
 * spot slot or laid a pool (render/lamppools.ts), so a car stopped in another's beam had
 * no shadow ahead of it and the road beyond it was as bright as the road before it.
 *
 * Here the few cars nearest the eye are boxes (their measured chassis box,
 * render/carmodel.ts, which is centred on the car's root), and a lamp's light on a point
 * is cut by every box the segment from the point to the lamp passes through. One slab
 * test per box: it gives where the segment enters and leaves the box, and from those and
 * the rates at which they move as the box grows, how far the segment passes outside the
 * box (or inside it), in metres. The shadow's edge is that distance against the lamp's
 * own size seen from the point (`LAMP_SOURCE_M` times the share of the way to the lamp
 * the box stands at): sharp near the car, soft far behind it, as a real lamp's.
 *
 * Which boxes a lamp tests is a bit mask the CPU works out per lamp group (`mask`): the
 * boxes whose bounding sphere its cone reaches, never the lamp's own car. The ground pools
 * carry it per vertex (render/lamppools.ts): a pool's own light is cut, and a lamp whose
 * slot lights the ground lays a SHADE pool that takes the slot's light away where a box
 * stops it. The test sat in the ground's own spot loop first, per slot: inlined ten
 * times into the heaviest program in the frame it cost 0.75 ms with no box in any beam
 * and 3.5 ms with ten slots' worth (blessing, 2560x1440, M2 Pro), where the shade pools
 * pay only where their cones lie. Positions are scene coordinates, rebuilt every frame.
 */

/** Boxes in the field: the cars nearest the eye. */
export const LAMP_OCCLUDER_COUNT = 8;
/**
 * `vec4`s per box in `lampOccluderUniform`: the three rows of its world-to-box transform
 * (rotation, translation in w), its half-size, and its bounding sphere (centre, radius).
 */
const OCCLUDER_VEC4S = 5;
/** Bounding-sphere slack for the cone test, metres. */
const MASK_MARGIN_M = 0.3;
/** Cars past this from the eye cast no lamp shadow anybody could tell from the night. */
const OCCLUDER_RANGE_M = 160;
/**
 * A lamp's radius the shadow's edge is softened by, metres (`lampOccluderLight`'s
 * `source` for one lamp), and the softness every edge keeps however near: a box is a
 * car's outline only roughly, and a crisp box edge would say so.
 */
export const LAMP_SOURCE_M = 0.3;
const PENUMBRA_MIN_M = 0.05;
/**
 * The box's width and height as a share of the measured body's: the body box takes in
 * the mirrors and the wheel arches' widest point, and the roof is narrower than the sills.
 */
const BOX_WIDTH_SHARE = 0.92;
const BOX_HEIGHT_SHARE = 0.94;
/**
 * Light (linear radiance off the ground) below which a lamp's light is not tested for
 * boxes: a hundredth of moonlit sand's own and a few per cent of asphalt's, so no shadow
 * in it could be told from the night (2026-10-30 calibration scenes: sand 0.003, asphalt
 * 0.0007).
 */
export const LAMP_SHADOW_FLOOR = 2e-5;

/** One box's test in `lampOccluderLight`, for box `k`: constant indices, no loop. */
function occluderBoxGlsl(k: number): string {
  const at = k * OCCLUDER_VEC4S;
  return /* glsl */ `
	if ( ( mask & ${1 << k} ) != 0 ) {
		// The segment's nearest approach to the box's centre, against its bounding sphere
		// grown by the widest penumbra.
		vec4 sphere = uLampOccluders[ ${at + 4} ];
		vec3 toCentre = sphere.xyz - point;
		vec3 nearest = toCentre - ray * clamp( dot( toCentre, ray ) * rayInv, 0.0, 1.0 );
		float reach = sphere.w + ${PENUMBRA_MIN_M.toFixed(3)} + source;
		if ( dot( nearest, nearest ) <= reach * reach ) {
			vec4 r0 = uLampOccluders[ ${at} ];
			vec4 r1 = uLampOccluders[ ${at + 1} ];
			vec4 r2 = uLampOccluders[ ${at + 2} ];
			vec3 halfSize = uLampOccluders[ ${at + 3} ].xyz;
			vec3 o = vec3( dot( r0.xyz, point ) + r0.w, dot( r1.xyz, point ) + r1.w, dot( r2.xyz, point ) + r2.w );
			vec3 d = vec3( dot( r0.xyz, ray ), dot( r1.xyz, ray ), dot( r2.xyz, ray ) );
			vec3 inv = 1.0 / mix( -max( -d, vec3( 1e-5 ) ), max( d, vec3( 1e-5 ) ), step( 0.0, d ) );
			vec3 tA = ( -halfSize - o ) * inv;
			vec3 tB = ( halfSize - o ) * inv;
			vec3 tNear = min( tA, tB );
			vec3 tFar = max( tA, tB );
			float enter = max( max( tNear.x, tNear.y ), tNear.z );
			float leave = min( min( tFar.x, tFar.y ), tFar.z );
			// Growing the box by m moves the entry back and the exit on by m times these.
			vec3 rate = abs( inv );
			float grow = dot( rate, step( vec3( enter ), tNear ) ) + dot( rate, step( tFar, vec3( leave ) ) );
			float a = max( enter, 0.0 );
			float b = min( leave, 1.0 );
			// Metres the segment passes outside the box; negative through it.
			float gap = ( a - b ) / max( grow, 1e-4 );
			float edge = ${PENUMBRA_MIN_M.toFixed(3)} + source * clamp( 0.5 * ( a + b ), 0.0, 1.0 );
			light *= smoothstep( -edge, edge, gap );
		}
	}`;
}

/**
 * GLSL: `float lampOccluderLight( vec3 point, vec3 lamp, float source, int mask )`, the
 * share of the light of a lamp `source` metres in radius on `point` that no box in `mask`
 * stops, both in scene coordinates. Declares the `uLampOccluders` uniform it reads.
 *
 * Each box is a slab test of the segment from the point to the lamp, after a test of the
 * segment against the box's bounding sphere that rejects it for a dozen operations: in a
 * headlamp's wide cone most ground is nowhere near any car's shadow. Written out box by
 * box with constant indices: as a loop over the mask, with `continue` and the uniforms
 * indexed by the loop's counter, the same work measured half again as dear on the M2 Pro.
 */
export const LAMP_OCCLUDER_GLSL = /* glsl */ `
uniform vec4 uLampOccluders[ ${LAMP_OCCLUDER_COUNT * OCCLUDER_VEC4S} ];
float lampOccluderLight( vec3 point, vec3 lamp, float source, int mask ) {
	float light = 1.0;
	vec3 ray = lamp - point;
	float rayInv = 1.0 / max( dot( ray, ray ), 1e-6 );
${Array.from({ length: LAMP_OCCLUDER_COUNT }, (_, k) => occluderBoxGlsl(k)).join('')}
	return light;
}
`;

/** The boxes (`OCCLUDER_VEC4S` each), shared by every program reading `LAMP_OCCLUDER_GLSL`. */
export const lampOccluderUniform: THREE.IUniform<Float32Array> = {
  value: new Float32Array(LAMP_OCCLUDER_COUNT * OCCLUDER_VEC4S * 4),
};

const _rotation = new THREE.Matrix4();
const _toCentre = new THREE.Vector3();

export class LampOccluders {
  /** The boxes as the shaders read them (`lampOccluderUniform`). */
  readonly uniform = lampOccluderUniform;
  private readonly owners: (object | null)[] = new Array<object | null>(LAMP_OCCLUDER_COUNT).fill(null);
  private readonly centres = Array.from({ length: LAMP_OCCLUDER_COUNT }, () => new THREE.Vector3());
  private readonly radii = new Float32Array(LAMP_OCCLUDER_COUNT);
  private readonly distancesSq = new Float64Array(LAMP_OCCLUDER_COUNT);
  private readonly eye = new THREE.Vector3();
  private count = 0;
  /** Scratch of the boxes `offer` keeps, written to the uniform in `end`. */
  private readonly quaternions = Array.from({ length: LAMP_OCCLUDER_COUNT }, () => new THREE.Quaternion());
  private readonly halves = new Float32Array(LAMP_OCCLUDER_COUNT * 3);

  /** Boxes this frame. */
  get size(): number {
    return this.count;
  }

  /** Starts a frame's collection round the eye. */
  begin(eye: THREE.Vector3): void {
    this.eye.copy(eye);
    this.count = 0;
  }

  /**
   * Offers one car: `owner` is what its lamps are told apart by (the same object its
   * pools and slots name), `position`/`quaternion` its root's, `half` its chassis box.
   * The nearest `LAMP_OCCLUDER_COUNT` to the eye are kept.
   */
  offer(owner: object, position: THREE.Vector3, quaternion: THREE.Quaternion, half: readonly number[]): void {
    const distanceSq = position.distanceToSquared(this.eye);
    if (distanceSq > OCCLUDER_RANGE_M * OCCLUDER_RANGE_M) return;
    let at = this.count;
    if (at === LAMP_OCCLUDER_COUNT) {
      // Full: replace the farthest if this one is nearer.
      let far = 0;
      for (let k = 1; k < at; k++) if (this.distancesSq[k] > this.distancesSq[far]) far = k;
      if (this.distancesSq[far] <= distanceSq) return;
      at = far;
    } else {
      this.count++;
    }
    this.owners[at] = owner;
    this.centres[at].copy(position);
    this.quaternions[at].copy(quaternion);
    const hx = half[0] * BOX_WIDTH_SHARE;
    const hy = half[1] * BOX_HEIGHT_SHARE;
    const hz = half[2];
    this.halves[at * 3] = hx;
    this.halves[at * 3 + 1] = hy;
    this.halves[at * 3 + 2] = hz;
    this.radii[at] = Math.hypot(hx, hy, hz);
    this.distancesSq[at] = distanceSq;
  }

  /** Publishes the frame's boxes to the uniform; unused boxes are never in a mask. */
  end(): void {
    const data = this.uniform.value;
    for (let k = 0; k < this.count; k++) {
      const e = _rotation.makeRotationFromQuaternion(this.quaternions[k]).elements;
      const c = this.centres[k];
      const o = k * OCCLUDER_VEC4S * 4;
      // Row i of the inverse rotation is column i of the rotation (column-major `e`).
      for (let i = 0; i < 3; i++) {
        const x = e[i * 4];
        const y = e[i * 4 + 1];
        const z = e[i * 4 + 2];
        data[o + i * 4] = x;
        data[o + i * 4 + 1] = y;
        data[o + i * 4 + 2] = z;
        data[o + i * 4 + 3] = -(x * c.x + y * c.y + z * c.z);
      }
      data[o + 12] = this.halves[k * 3];
      data[o + 13] = this.halves[k * 3 + 1];
      data[o + 14] = this.halves[k * 3 + 2];
      data[o + 15] = 0;
      data[o + 16] = c.x;
      data[o + 17] = c.y;
      data[o + 18] = c.z;
      data[o + 19] = this.radii[k];
    }
  }

  /**
   * The boxes a lamp at `lamp`, aimed along unit `axis` with outer cone cosine `coneCos`,
   * can throw a shadow from within `range` metres: every box but `owner`'s whose bounding
   * sphere its cone reaches. Conservative, like render/vehiclelights.ts `spotReaches`.
   */
  mask(owner: object | null, lamp: THREE.Vector3, axis: THREE.Vector3, coneCos: number, range: number): number {
    let mask = 0;
    const sin = Math.sqrt(Math.max(0, 1 - coneCos * coneCos));
    for (let k = 0; k < this.count; k++) {
      if (this.owners[k] === owner) continue;
      const radius = this.radii[k] + MASK_MARGIN_M;
      const toCentre = _toCentre.subVectors(this.centres[k], lamp);
      const distanceSq = toCentre.lengthSq();
      const reach = range + radius;
      if (distanceSq > reach * reach) continue;
      const along = toCentre.dot(axis);
      if (along < -radius) continue;
      const across = Math.sqrt(Math.max(0, distanceSq - along * along));
      if (coneCos * across - sin * along > radius) continue;
      mask |= 1 << k;
    }
    return mask;
  }

  /**
   * The wedge the boxes in `mask` shade, seen from a lamp pair at `lamp` (their middle,
   * `halfSpacing` either side of it along `across`): into `out`, the least and greatest
   * slope (distance along `across` over distance along `forward`, both unit vectors) its
   * shadows can lie at, each box's bounding sphere grown by its widest penumbra.
   * @returns false when a box stands over the lamps or beside them, so the shadows can
   * lie anywhere in the cone.
   */
  sector(
    mask: number,
    lamp: THREE.Vector3,
    forward: THREE.Vector3,
    across: THREE.Vector3,
    halfSpacing: number,
    out: { min: number; max: number },
  ): boolean {
    let low = Infinity;
    let high = -Infinity;
    for (let k = 0; k < this.count; k++) {
      if ((mask & (1 << k)) === 0) continue;
      const toCentre = _toCentre.subVectors(this.centres[k], lamp);
      const ahead = toCentre.dot(forward);
      const aside = toCentre.dot(across);
      const distance = Math.hypot(ahead, aside);
      const radius = this.radii[k] + PENUMBRA_MIN_M + LAMP_SOURCE_M + halfSpacing;
      if (!(ahead > 0) || distance <= radius * 1.05) return false;
      const angle = Math.atan2(aside, ahead);
      const spread = Math.asin(radius / distance);
      if (angle - spread <= -Math.PI / 2 || angle + spread >= Math.PI / 2) return false;
      low = Math.min(low, Math.tan(angle - spread));
      high = Math.max(high, Math.tan(angle + spread));
    }
    if (!(high >= low)) return false;
    out.min = low;
    out.max = high;
    return true;
  }
}
