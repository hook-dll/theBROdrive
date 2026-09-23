/**
 * One car's visible body condition: the paint's dirt and scratches, and the dents
 * pushed into its shell.
 *
 * Created once per instanced car by render/carmodel.ts, which is the only place that
 * knows which materials are this car's paint and which meshes are its body. Holding
 * those handles is the point: a car driving through dust updates its paint every
 * frame, and walking a 20-node scene graph to find two materials each time is work
 * that buys nothing.
 *
 * DENTS ARE REAL GEOMETRY. A dented car's affected body meshes — paint, trim, glass,
 * lamps, mirrors, underbody; never the wheels, which are separate objects — are
 * given their own copy of the template geometry and displaced on the CPU. The shader
 * could have displaced vertices instead, but only the paint has a per-car material:
 * glass is one material shared by every car in the game, and lamps and trim share
 * theirs within a model, so a vertex-shader dent would leave the windscreen and the
 * headlamp floating in front of a crumpled wing. Deforming geometry costs a few
 * milliseconds per dent EVENT and nothing per frame, and only dented cars pay the
 * memory.
 *
 * Every pass starts from the pristine template, so the result is a pure function of
 * the dent list: the same save replays the same shell on every load and spawn.
 */

import * as THREE from 'three';
import type { BodyDent } from '../game/state';
import { setCarBodyCondition, setCarBodyDentMarks, type CarDentMark } from './materials';

/** A wheel as the dent clamp sees it, chassis-local metres. */
export interface CarBodyWheel {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly radius: number;
  /** Half the tyre's section width. */
  readonly halfWidth: number;
}

/**
 * A mesh's own displaced geometry. Position and normal are float buffers this car
 * owns, rewritten in place on every later dent pass: replacing a geometry's
 * attribute object would strand the old GPU buffer until the geometry is disposed.
 */
interface DentedGeometry {
  readonly geometry: THREE.BufferGeometry;
  readonly position: THREE.BufferAttribute;
  readonly positions: Float32Array;
  readonly normal: THREE.BufferAttribute | null;
  readonly normals: Float32Array | null;
}

/**
 * One template geometry decoded once for every car of its model: plain-float
 * mesh-local positions and normals (the GLB packs store them quantised and
 * interleaved, and reading those through the attribute accessors dominated a dent
 * pass), the positions already in the chassis frame, and their chassis-space bounds.
 * Every car of a model clones the same template, so the same geometry sits under
 * the same transform in all of them; `toChassis` is kept to prove it.
 */
interface DecodedGeometry {
  readonly toChassis: THREE.Matrix4;
  readonly local: Float32Array;
  readonly normals: Float32Array | null;
  readonly chassis: Float32Array;
  readonly bounds: THREE.Box3;
}

const decodedGeometries = new WeakMap<THREE.BufferGeometry, DecodedGeometry>();

interface DeformableMesh {
  readonly mesh: THREE.Mesh;
  /** The template's geometry, shared with every other car: never written. */
  readonly pristine: THREE.BufferGeometry;
  /** Mesh-local to chassis-local at rest, and its linear parts for vectors. */
  readonly toChassis: THREE.Matrix4;
  readonly linearToLocal: THREE.Matrix3;
  readonly normalToChassis: THREE.Matrix3;
  readonly normalToLocal: THREE.Matrix3;
  /** This car's own displaced copy, or null while the mesh is untouched. */
  dented: DentedGeometry | null;
  /** Filled on the first dent pass that needs it; see `decode`. */
  decoded: DecodedGeometry | null;
}

/**
 * The deepest a dent may push relative to its radius. It is what keeps the panel a
 * panel: the displacement field's slope stays under ~0.5 across the dent, so no two
 * neighbouring vertices can cross and the skin never folds through itself, however
 * the blow was aimed at a curved corner.
 */
const DENT_DEPTH_PER_RADIUS = 0.3;
/**
 * How far behind the struck skin a dent still pushes, as a fraction of its radius,
 * with a floor. Inner panels, bumper reinforcements, the edge of the glass follow the
 * skin in; the other side of the car, a metre and more away, does not move at all.
 */
const DENT_BAND_PER_RADIUS = 0.9;
const DENT_BAND_MIN_M = 0.22;
/** How far inside the struck box face the skin search looks before giving up. */
const DENT_SKIN_REACH_M = 1.5;
/**
 * Clear air the dent clamp keeps between a pushed panel and the tyre, and the width
 * of the fade from there back to a full dent. A crumpled wing that swallows its own
 * front wheel is the one dent a player would call a bug.
 */
const WHEEL_CLEARANCE_M = 0.03;
const WHEEL_GUARD_FADE_M = 0.27;
const WHEEL_GUARD_SIDE_M = 0.05;
const WHEEL_GUARD_SIDE_FADE_M = 0.2;
/** Finite-difference step for the displacement gradient, metres. */
const GRADIENT_STEP_M = 0.004;

/** One dent, resolved against this car's actual skin. */
interface ResolvedDent {
  readonly px: number;
  readonly py: number;
  readonly pz: number;
  readonly nx: number;
  readonly ny: number;
  readonly nz: number;
  readonly radius: number;
  readonly depth: number;
  readonly band: number;
  /** Distance along the push direction from the struck point to the skin. */
  readonly skin: number;
}

/** What the last dent pass did; read by tools/car-dirt.ts. */
export interface CarDentStats {
  /** Vertices moved by more than a tenth of a millimetre. */
  readonly movedVertices: number;
  /** Largest displacement of any vertex, metres. */
  readonly maxDisplacementM: number;
  /**
   * Smallest Jacobian determinant of the displacement map over moved vertices. At or
   * below zero the map turns the skin inside out there; the clamps keep it well above.
   */
  readonly minJacobian: number;
  /** Deepest penetration of any moved vertex into a wheel's cylinder, metres (0 if none). */
  readonly wheelPenetrationM: number;
  /** Meshes carrying their own dented geometry. */
  readonly dentedMeshes: number;
}

const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
const _u = new THREE.Vector3();

export class CarBodySurface {
  private readonly meshes: DeformableMesh[] = [];
  private appliedDirt = -1;
  private appliedScratches = -1;
  private appliedDents: readonly BodyDent[] = [];
  private stats: CarDentStats = {
    movedVertices: 0,
    maxDisplacementM: 0,
    minJacobian: 1,
    wheelPenetrationM: 0,
    dentedMeshes: 0,
  };

  /**
   * `body` must be at rest (no bounce squash) when this runs: the chassis frame of
   * every mesh is captured here, once. `rigidNode` names a subtree that must not
   * deform because it animates about its own pivot — the steering wheel.
   */
  constructor(
    /** This car's own paint materials, captured when it was instanced. */
    readonly paint: readonly THREE.Material[],
    body: THREE.Object3D,
    private readonly wheels: readonly CarBodyWheel[],
    rigidNode: string,
  ) {
    body.updateMatrix();
    const visit = (node: THREE.Object3D, parent: THREE.Matrix4): void => {
      if (node.name === rigidNode) return;
      node.updateMatrix();
      const toChassis = node === body ? node.matrix.clone() : parent.clone().multiply(node.matrix);
      if (node instanceof THREE.Mesh && node.geometry.getAttribute('position')) {
        const linear = new THREE.Matrix3().setFromMatrix4(toChassis);
        const normalToChassis = new THREE.Matrix3().getNormalMatrix(toChassis);
        this.meshes.push({
          mesh: node,
          pristine: node.geometry,
          toChassis,
          linearToLocal: linear.clone().invert(),
          normalToChassis,
          normalToLocal: normalToChassis.clone().invert(),
          dented: null,
          decoded: null,
        });
      }
      for (const child of node.children) visit(child, toChassis);
    };
    visit(body, new THREE.Matrix4());
  }

  /** Writes dirt and scratches into this car's paint; free when neither changed. */
  setCondition(dirt: number, scratches: number): void {
    if (dirt === this.appliedDirt && scratches === this.appliedScratches) return;
    this.appliedDirt = dirt;
    this.appliedScratches = scratches;
    setCarBodyCondition(this.paint, dirt, scratches);
  }

  /**
   * Shapes the shell to exactly `dents`. Compared by record identity, which the state
   * guarantees changes whenever a dent is added, deepened or forgotten (see
   * `addBodyDent`), so calling this every frame costs a few pointer comparisons.
   */
  setDents(dents: readonly BodyDent[]): void {
    if (sameDents(dents, this.appliedDents)) return;
    this.appliedDents = dents.slice();
    const resolved = this.resolve(dents);
    this.deform(resolved);
    const marks: CarDentMark[] = resolved.map((dent) => ({
      x: dent.px + dent.nx * dent.skin,
      y: dent.py + dent.ny * dent.skin,
      z: dent.pz + dent.nz * dent.skin,
      radius: dent.radius,
    }));
    setCarBodyDentMarks(this.paint, marks);
  }

  /** Result of the most recent dent pass. */
  get dentStats(): CarDentStats {
    return this.stats;
  }

  /** Puts the template geometry back and frees everything this car owned. */
  dispose(): void {
    for (const entry of this.meshes) {
      if (!entry.dented) continue;
      entry.mesh.geometry = entry.pristine;
      entry.dented.geometry.dispose();
      entry.dented = null;
    }
    for (const material of this.paint) material.dispose();
  }

  /**
   * Finds where each dent meets THIS body. The record holds the point where the
   * chassis box was struck; the skin is the first vertex met travelling inward along
   * the push direction within half the dent's radius of its axis. A dent with no skin
   * in reach (a blow on the box where this model has only air) is dropped.
   */
  private resolve(dents: readonly BodyDent[]): ResolvedDent[] {
    const skins = dents.map(() => Infinity);
    for (const entry of this.meshes) {
      for (let k = 0; k < dents.length; k++) {
        const dent = dents[k]!;
        const decoded = decode(entry);
        _p.set(dent.x, dent.y, dent.z);
        if (decoded.bounds.distanceToPoint(_p) > DENT_SKIN_REACH_M + dent.radius) continue;
        const chassis = decoded.chassis;
        const axis2 = dent.radius * dent.radius * 0.25;
        for (let i = 0; i < chassis.length; i += 3) {
          const vx = chassis[i]! - dent.x;
          const vy = chassis[i + 1]! - dent.y;
          const vz = chassis[i + 2]! - dent.z;
          const along = vx * dent.nx + vy * dent.ny + vz * dent.nz;
          if (along < -0.05 || along > DENT_SKIN_REACH_M || along >= skins[k]!) continue;
          if (vx * vx + vy * vy + vz * vz - along * along < axis2) skins[k] = along;
        }
      }
    }
    const resolved: ResolvedDent[] = [];
    for (let k = 0; k < dents.length; k++) {
      const skin = skins[k]!;
      if (!Number.isFinite(skin)) continue;
      const dent = dents[k]!;
      resolved.push({
        px: dent.x,
        py: dent.y,
        pz: dent.z,
        nx: dent.nx,
        ny: dent.ny,
        nz: dent.nz,
        radius: dent.radius,
        depth: Math.min(dent.depth, dent.radius * DENT_DEPTH_PER_RADIUS),
        band: Math.max(DENT_BAND_MIN_M, dent.radius * DENT_BAND_PER_RADIUS),
        skin,
      });
    }
    return resolved;
  }

  /**
   * Push magnitude of one dent at a chassis-local point: a smooth bowl across the
   * panel, full depth at and in front of the skin fading to nothing a band behind it,
   * and faded out again near a tyre.
   */
  private push(dent: ResolvedDent, x: number, y: number, z: number): number {
    const vx = x - dent.px;
    const vy = y - dent.py;
    const vz = z - dent.pz;
    const along = vx * dent.nx + vy * dent.ny + vz * dent.nz;
    const q2 = (vx * vx + vy * vy + vz * vz - along * along) / (dent.radius * dent.radius);
    if (q2 >= 1) return 0;
    const t = (along - dent.skin) / dent.band;
    if (t >= 1) return 0;
    const bowl = (1 - q2) * (1 - q2);
    const depthWindow = t <= 0 ? 1 : 1 - t * t * (3 - 2 * t);
    return dent.depth * bowl * depthWindow * this.wheelGuard(x, y, z);
  }

  private wheelGuard(x: number, y: number, z: number): number {
    let guard = 1;
    for (const wheel of this.wheels) {
      const side = Math.abs(x - wheel.x);
      const inside = 1 - smoothstep(
        wheel.halfWidth + WHEEL_GUARD_SIDE_M,
        wheel.halfWidth + WHEEL_GUARD_SIDE_M + WHEEL_GUARD_SIDE_FADE_M,
        side,
      );
      if (inside <= 0) continue;
      const radial = Math.hypot(y - wheel.y, z - wheel.z);
      const clear = smoothstep(
        wheel.radius + WHEEL_CLEARANCE_M,
        wheel.radius + WHEEL_CLEARANCE_M + WHEEL_GUARD_FADE_M,
        radial,
      );
      guard *= 1 - inside * (1 - clear);
    }
    return guard;
  }

  private wheelPenetration(x: number, y: number, z: number): number {
    let worst = 0;
    for (const wheel of this.wheels) {
      if (Math.abs(x - wheel.x) > wheel.halfWidth) continue;
      worst = Math.max(worst, wheel.radius - Math.hypot(y - wheel.y, z - wheel.z));
    }
    return worst;
  }

  private deform(dents: readonly ResolvedDent[]): void {
    let movedVertices = 0;
    let maxDisplacementM = 0;
    let minJacobian = 1;
    let wheelPenetrationM = 0;
    let dentedMeshes = 0;
    const h = GRADIENT_STEP_M;
    // Outside this sphere around the struck point a dent cannot move anything, so
    // the four field evaluations per vertex are only paid near a dent.
    const reach2 = dents.map((dent) => {
      const reach = Math.hypot(dent.radius, Math.abs(dent.skin) + dent.band) + h;
      return reach * reach;
    });

    for (const entry of this.meshes) {
      let output: DentedGeometry | null = null;
      const decoded = decode(entry);
      let reached = false;
      for (let k = 0; k < dents.length && !reached; k++) {
        const dent = dents[k]!;
        _p.set(dent.px, dent.py, dent.pz);
        reached = decoded.bounds.distanceToPoint(_p) ** 2 <= reach2[k]!;
      }
      const chassis = decoded.chassis;
      const count = reached ? chassis.length / 3 : 0;

      for (let i = 0; i < count; i++) {
        const x = chassis[i * 3]!;
        const y = chassis[i * 3 + 1]!;
        const z = chassis[i * 3 + 2]!;
        let ux = 0;
        let uy = 0;
        let uz = 0;
        // Jacobian of the displacement map, I + sum of n (grad s)^T, row-major.
        let j00 = 1, j01 = 0, j02 = 0;
        let j10 = 0, j11 = 1, j12 = 0;
        let j20 = 0, j21 = 0, j22 = 1;
        for (let k = 0; k < dents.length; k++) {
          const dent = dents[k]!;
          const dx = x - dent.px;
          const dy = y - dent.py;
          const dz = z - dent.pz;
          if (dx * dx + dy * dy + dz * dz > reach2[k]!) continue;
          const s = this.push(dent, x, y, z);
          const gx = (this.push(dent, x + h, y, z) - s) / h;
          const gy = (this.push(dent, x, y + h, z) - s) / h;
          const gz = (this.push(dent, x, y, z + h) - s) / h;
          ux += dent.nx * s;
          uy += dent.ny * s;
          uz += dent.nz * s;
          j00 += dent.nx * gx; j01 += dent.nx * gy; j02 += dent.nx * gz;
          j10 += dent.ny * gx; j11 += dent.ny * gy; j12 += dent.ny * gz;
          j20 += dent.nz * gx; j21 += dent.nz * gy; j22 += dent.nz * gz;
        }
        const moved = Math.hypot(ux, uy, uz);
        if (moved < 1e-4) continue;

        output ??= beginDentedOutput(entry, decoded);
        movedVertices++;
        maxDisplacementM = Math.max(maxDisplacementM, moved);
        wheelPenetrationM = Math.max(wheelPenetrationM, this.wheelPenetration(x + ux, y + uy, z + uz));

        // Cofactor matrix of J: the deformed normal is J^-T n, and J^-T is the
        // cofactor matrix over a positive determinant, which normalising discards.
        const c00 = j11 * j22 - j12 * j21;
        const c01 = j12 * j20 - j10 * j22;
        const c02 = j10 * j21 - j11 * j20;
        const c10 = j02 * j21 - j01 * j22;
        const c11 = j00 * j22 - j02 * j20;
        const c12 = j01 * j20 - j00 * j21;
        const c20 = j01 * j12 - j02 * j11;
        const c21 = j02 * j10 - j00 * j12;
        const c22 = j00 * j11 - j01 * j10;
        minJacobian = Math.min(minJacobian, j00 * c00 + j01 * c01 + j02 * c02);

        const positions = output.positions;
        _u.set(ux, uy, uz).applyMatrix3(entry.linearToLocal);
        positions[i * 3] = positions[i * 3]! + _u.x;
        positions[i * 3 + 1] = positions[i * 3 + 1]! + _u.y;
        positions[i * 3 + 2] = positions[i * 3 + 2]! + _u.z;

        const normals = output.normals;
        const sourceNormals = decoded.normals;
        if (normals && sourceNormals) {
          _n.fromArray(sourceNormals, i * 3).applyMatrix3(entry.normalToChassis);
          const nx = c00 * _n.x + c01 * _n.y + c02 * _n.z;
          const ny = c10 * _n.x + c11 * _n.y + c12 * _n.z;
          const nz = c20 * _n.x + c21 * _n.y + c22 * _n.z;
          _n.set(nx, ny, nz).applyMatrix3(entry.normalToLocal).normalize();
          normals[i * 3] = _n.x;
          normals[i * 3 + 1] = _n.y;
          normals[i * 3 + 2] = _n.z;
        }
      }

      if (!output) {
        // No dent reaches this mesh any more (its dent aged out of the ring).
        if (entry.dented) {
          entry.mesh.geometry = entry.pristine;
          entry.dented.geometry.dispose();
          entry.dented = null;
        }
        continue;
      }
      dentedMeshes++;
      output.position.needsUpdate = true;
      if (output.normal) output.normal.needsUpdate = true;
      output.geometry.computeBoundingBox();
      output.geometry.computeBoundingSphere();
    }
    this.stats = { movedVertices, maxDisplacementM, minJacobian, wheelPenetrationM, dentedMeshes };
  }
}

/**
 * The buffers one mesh's dent pass writes into, reset to the pristine shape: reused
 * when this car already owns a dented copy of the mesh, created (and swapped onto
 * the mesh) the first time a dent reaches it.
 */
function beginDentedOutput(entry: DeformableMesh, decoded: DecodedGeometry): DentedGeometry {
  const dented = entry.dented ?? createDentedGeometry(entry.pristine, decoded.normals !== null);
  dented.positions.set(decoded.local);
  if (dented.normals && decoded.normals) dented.normals.set(decoded.normals);
  if (!entry.dented) {
    entry.dented = dented;
    entry.mesh.geometry = dented.geometry;
  }
  return dented;
}

/**
 * The decoded form of a mesh's template geometry, shared through `decodedGeometries`
 * with every car of the model and built by the first one to need it. A mesh whose
 * geometry some other car uses under a different transform keeps a private decode.
 */
function decode(entry: DeformableMesh): DecodedGeometry {
  if (entry.decoded) return entry.decoded;
  const shared = decodedGeometries.get(entry.pristine);
  if (shared && shared.toChassis.equals(entry.toChassis)) {
    entry.decoded = shared;
    return shared;
  }
  const position = entry.pristine.getAttribute('position');
  const normal = entry.pristine.getAttribute('normal');
  const local = new Float32Array(position.count * 3);
  const chassis = new Float32Array(position.count * 3);
  const bounds = new THREE.Box3();
  for (let v = 0; v < position.count; v++) {
    _p.fromBufferAttribute(position, v);
    _p.toArray(local, v * 3);
    _p.applyMatrix4(entry.toChassis);
    _p.toArray(chassis, v * 3);
    bounds.expandByPoint(_p);
  }
  let normals: Float32Array | null = null;
  if (normal) {
    normals = new Float32Array(normal.count * 3);
    for (let v = 0; v < normal.count; v++) _n.fromBufferAttribute(normal, v).toArray(normals, v * 3);
  }
  const decoded: DecodedGeometry = { toChassis: entry.toChassis, local, normals, chassis, bounds };
  if (!shared) decodedGeometries.set(entry.pristine, decoded);
  entry.decoded = decoded;
  return decoded;
}

function sameDents(a: readonly BodyDent[], b: readonly BodyDent[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * A geometry this car owns outright. Every attribute and the index are COPIED, not
 * shared with the template: disposing a geometry frees the GPU buffers of every
 * attribute it references, so a shared index would be deleted out from under every
 * other car of the model the day this one is despawned. Interleaved (meshopt) data
 * is flattened on the way. Position and normal become plain floats whatever the
 * source quantised them to, since displaced vertices no longer sit on that grid.
 */
function createDentedGeometry(source: THREE.BufferGeometry, withNormals: boolean): DentedGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.name = source.name;
  if (source.index) geometry.setIndex(source.index.clone());
  for (const [name, attribute] of Object.entries(source.attributes)) {
    if (name === 'position' || name === 'normal') continue;
    geometry.setAttribute(name, flatAttribute(attribute));
  }
  for (const group of source.groups) geometry.addGroup(group.start, group.count, group.materialIndex);
  geometry.setDrawRange(source.drawRange.start, source.drawRange.count);
  const count = source.getAttribute('position').count;
  const positions = new Float32Array(count * 3);
  const position = new THREE.BufferAttribute(positions, 3);
  geometry.setAttribute('position', position);
  const normals = withNormals ? new Float32Array(count * 3) : null;
  const normal = normals ? new THREE.BufferAttribute(normals, 3) : null;
  if (normal) geometry.setAttribute('normal', normal);
  return { geometry, position, positions, normal, normals };
}

function flatAttribute(
  attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
): THREE.BufferAttribute {
  if (attribute instanceof THREE.BufferAttribute) return attribute.clone();
  const values = new Float32Array(attribute.count * attribute.itemSize);
  for (let i = 0; i < attribute.count; i++) {
    for (let c = 0; c < attribute.itemSize; c++) {
      values[i * attribute.itemSize + c] = attribute.getComponent(i, c);
    }
  }
  return new THREE.BufferAttribute(values, attribute.itemSize);
}
