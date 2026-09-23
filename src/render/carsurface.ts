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
 * given their own position and normal buffers and displaced on the CPU. The shader
 * could have displaced vertices instead, but only the paint has a per-car material:
 * glass is one material shared by every car in the game, and lamps and trim share
 * theirs within a model, so a vertex-shader dent would leave the windscreen and the
 * headlamp floating in front of a crumpled wing.
 *
 * WHAT A DENT COSTS. Nothing per frame: an unchanged dent list is a few pointer
 * comparisons, and a dented mesh draws exactly as its template does. A dent EVENT is
 * incremental — only the vertices within reach of the dents that changed are
 * recomputed, only the meshes whose bounds that reach touches are decoded, and only
 * the recomputed span is re-uploaded — and it is TIME-SLICED: the pass runs in steps
 * inside a per-frame budget shared by every car (`beginDentFrame`), so a pile-up that
 * dents a dozen high-detail cars at once crumples them over a few frames instead of
 * stopping one. A dented mesh owns just its two displaced buffers; the index, UVs and
 * the rest stay the template's.
 *
 * The result is a pure function of the dent list: a vertex's displacement is the sum
 * of every current dent's push at its pristine position, and a dent pushes nothing
 * outside its reach, so recomputing only what a change can reach gives the same shell
 * as a pass from scratch. The same save replays the same shell on every load.
 */

import * as THREE from 'three';
import { MAX_BODY_DENT_DEPTH_M, type BodyDent } from '../game/state';
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
 * A mesh's own displaced buffers, rewritten in place on every later dent pass:
 * replacing a geometry's attribute object would strand the old GPU buffer until the
 * geometry is disposed.
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
 * pass) and the positions already in the chassis frame. Every car of a model clones
 * the same template, so the same geometry sits under the same transform in all of
 * them; `toChassis` is kept to prove it.
 */
interface DecodedGeometry {
  readonly toChassis: THREE.Matrix4;
  readonly local: Float32Array;
  readonly normals: Float32Array | null;
  readonly chassis: Float32Array;
}

/** A decode in progress: vertices below `next` are filled. */
interface PartialDecode {
  readonly decoded: DecodedGeometry;
  next: number;
}

const decodedGeometries = new WeakMap<THREE.BufferGeometry, DecodedGeometry>();
/** Shared decodes still being filled, so two cars of a model never decode it twice. */
const partialDecodes = new WeakMap<THREE.BufferGeometry, PartialDecode>();

interface DeformableMesh {
  readonly mesh: THREE.Mesh;
  /** The template's geometry, shared with every other car: never written. */
  readonly pristine: THREE.BufferGeometry;
  /** Mesh-local to chassis-local at rest, and its linear parts for vectors. */
  readonly toChassis: THREE.Matrix4;
  readonly linearToLocal: THREE.Matrix3;
  readonly normalToChassis: THREE.Matrix3;
  readonly normalToLocal: THREE.Matrix3;
  /**
   * Chassis-frame box of the template, from its own bounding box: conservative, and
   * known without decoding a vertex, so a dent on the far side of the car never
   * pays to decode this mesh.
   */
  readonly bounds: THREE.Box3;
  /** Mesh-local units per chassis metre, for the culling slack of a dented copy. */
  readonly localPerMetre: number;
  /** This car's own displaced buffers, or null while the mesh is untouched. */
  dented: DentedGeometry | null;
  /** Filled on the first dent pass that needs it; see `decode`. */
  decoded: DecodedGeometry | null;
  /** A private decode in progress, for a mesh that cannot share the template's. */
  partialDecode: PartialDecode | null;
}

/**
 * The deepest a dent may push relative to its radius. With the band below it keeps
 * the panel a panel: the displacement's slope along the push stays under the band's,
 * so no two neighbouring vertices cross and the skin never folds through itself,
 * however the blow was aimed at a curved corner.
 */
const DENT_DEPTH_PER_RADIUS = 0.4;
/**
 * How far behind the struck skin a dent still pushes, as a fraction of its radius,
 * with a floor. Inner panels, bumper reinforcements, the edge of the glass follow the
 * skin in; the other side of the car does not move at all. Wide enough for the depth
 * above: a crumple thirty centimetres deep carries the metre behind it with it.
 */
const DENT_BAND_PER_RADIUS = 1.3;
const DENT_BAND_MIN_M = 0.22;
/** How far inside the struck box face the skin search looks before giving up. */
const DENT_SKIN_REACH_M = 1.5;
/**
 * Clear air the dent clamp keeps between a pushed panel and the tyre, and the width
 * of the fade from there back to a full dent. A crumpled wing that swallows its own
 * front wheel is the one dent a player would call a bug. The fade is long because the
 * dents are deep: a push that dies over a short distance toward the tyre moves the
 * far vertices past the near ones and folds the panel, so the guard must taper over
 * about twice the deepest push (tools/car-dirt.ts holds the fold and the tyre to it).
 */
const WHEEL_CLEARANCE_M = 0.03;
const WHEEL_GUARD_FADE_M = 0.7;
const WHEEL_GUARD_SIDE_M = 0.05;
const WHEEL_GUARD_SIDE_FADE_M = 0.2;
/**
 * Culling slack of a dented copy, chassis metres. Dents push inward, so the template's
 * bounds already hold the dented shell; the slack covers overlapping dents on a curved
 * corner, and saves recomputing bounds over every vertex on each blow.
 */
const DENTED_BOUNDS_SLACK_M = 2 * MAX_BODY_DENT_DEPTH_M;
/**
 * Vertices a pass handles between looks at the clock: small enough that one step is
 * well under the frame budget on a 100k-vertex body, large enough that the clock and
 * the generator's bookkeeping cost nothing beside the work.
 */
const DENT_STEP_VERTICES = 2048;

/**
 * Milliseconds of dent work the current frame may still spend, across every car.
 *
 * Unbounded until something sets a budget: a bench, the car lab and a save replay
 * get each pass finished inside the call that asked for it, and only the game loop,
 * which calls `beginDentFrame` every frame, spreads the work.
 */
let dentBudgetMs = Number.POSITIVE_INFINITY;

/**
 * Opens a frame's dent budget. Called once per rendered frame by the game loop,
 * before any car syncs its visuals; every pass in progress then advances in turn
 * until the frame's share is spent, and resumes on the next.
 */
export function beginDentFrame(budgetMs: number): void {
  dentBudgetMs = budgetMs;
}

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
  /** Squared radius round the struck point outside which this dent moves nothing. */
  readonly reach2: number;
}

/** What the last completed dent pass did; read by tools/car-dirt.ts. */
export interface CarDentStats {
  /** Vertices the pass recomputed that moved by more than a tenth of a millimetre. */
  readonly movedVertices: number;
  /** Largest displacement of any recomputed vertex, metres. */
  readonly maxDisplacementM: number;
  /**
   * Smallest Jacobian determinant of the displacement map over moved vertices. At or
   * below zero the map turns the skin inside out there; the clamps keep it well above.
   */
  readonly minJacobian: number;
  /** Deepest penetration of any moved vertex into a wheel's cylinder, metres (0 if none). */
  readonly wheelPenetrationM: number;
  /** Meshes carrying their own dented buffers after the pass. */
  readonly dentedMeshes: number;
}

/**
 * Module scratch. A pass yields between steps and other cars' passes run in the gaps,
 * so none of these may hold a value across a `yield` — each is set and consumed
 * within one step.
 */
const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
const _u = new THREE.Vector3();
const _struck = new THREE.Vector3();
const _guardGradient = new THREE.Vector3();

type Pass<T = void> = Generator<void, T, void>;

export class CarBodySurface {
  private readonly meshes: DeformableMesh[] = [];
  private appliedDirt = -1;
  private appliedScratches = -1;
  /** The dent list the shell is being brought to: the last one asked for. */
  private targetDents: readonly BodyDent[] = [];
  /** Dents asked for that no pass has resolved against the skin yet. */
  private readonly unresolved: BodyDent[] = [];
  /** Each resolved dent in the target, or null where it met no skin. */
  private readonly resolved = new Map<BodyDent, ResolvedDent | null>();
  /** Resolved dents, added or forgotten, whose reach no pass has recomputed yet. */
  private readonly pendingChanged: ResolvedDent[] = [];
  /** The pass in progress, advanced within the frame's dent budget. */
  private pass: Pass | null = null;
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
        const geometry: THREE.BufferGeometry = node.geometry;
        if (!geometry.boundingBox) geometry.computeBoundingBox();
        const linear = new THREE.Matrix3().setFromMatrix4(toChassis);
        const normalToChassis = new THREE.Matrix3().getNormalMatrix(toChassis);
        this.meshes.push({
          mesh: node,
          pristine: geometry,
          toChassis,
          linearToLocal: linear.clone().invert(),
          normalToChassis,
          normalToLocal: normalToChassis.clone().invert(),
          bounds: geometry.boundingBox!.clone().applyMatrix4(toChassis),
          localPerMetre: toChassis.clone().invert().getMaxScaleOnAxis(),
          dented: null,
          decoded: null,
          partialDecode: null,
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
   * Brings the shell toward exactly `dents`, within the frame's dent budget. Call it
   * every frame: an unchanged list costs a few pointer comparisons — records are
   * compared by identity, which the state guarantees changes whenever a dent is
   * added, deepened or forgotten (see `addBodyDent`) — and a pass in progress resumes.
   */
  setDents(dents: readonly BodyDent[]): void {
    if (!sameDents(dents, this.targetDents)) {
      const current = new Set(dents);
      const previous = new Set(this.targetDents);
      for (const dent of this.targetDents) {
        if (current.has(dent)) continue;
        const gone = this.resolved.get(dent);
        if (gone) this.pendingChanged.push(gone);
        this.resolved.delete(dent);
      }
      for (const dent of dents) if (!previous.has(dent)) this.unresolved.push(dent);
      this.targetDents = dents.slice();
      // Whatever a pass in progress had not finished is still pending, so a fresh
      // pass over the new list covers it; the vertices it had already written are
      // written again, to the same values.
      this.pass = this.runPass();
    }
    if (!this.pass || dentBudgetMs <= 0) return;
    const started = performance.now();
    for (;;) {
      if (this.pass.next().done) {
        this.pass = null;
        break;
      }
      if (performance.now() - started >= dentBudgetMs) break;
    }
    dentBudgetMs -= performance.now() - started;
  }

  /** Result of the most recent completed dent pass. */
  get dentStats(): CarDentStats {
    return this.stats;
  }

  /** Puts the template geometry back and frees everything this car owned. */
  dispose(): void {
    this.pass = null;
    for (const entry of this.meshes) restorePristine(entry);
    for (const material of this.paint) material.dispose();
  }

  private *runPass(): Pass {
    const target = new Set(this.targetDents);
    // Resolve before popping: a pass abandoned mid-resolve leaves the dent queued.
    while (this.unresolved.length > 0) {
      const dent = this.unresolved[this.unresolved.length - 1]!;
      if (target.has(dent) && !this.resolved.has(dent)) {
        const resolved = yield* this.resolveDent(dent);
        this.resolved.set(dent, resolved);
        if (resolved) this.pendingChanged.push(resolved);
      }
      this.unresolved.pop();
    }
    const live: ResolvedDent[] = [];
    for (const dent of this.targetDents) {
      const resolved = this.resolved.get(dent);
      if (resolved) live.push(resolved);
    }
    if (this.pendingChanged.length > 0) {
      yield* this.deform(live, this.pendingChanged.slice());
      this.pendingChanged.length = 0;
    }
    const marks: CarDentMark[] = live.map((dent) => ({
      x: dent.px + dent.nx * dent.skin,
      y: dent.py + dent.ny * dent.skin,
      z: dent.pz + dent.nz * dent.skin,
      radius: dent.radius,
    }));
    setCarBodyDentMarks(this.paint, marks);
  }

  /**
   * Finds where a dent meets THIS body. The record holds the point where the chassis
   * box was struck; the skin is the first vertex met travelling inward along the push
   * direction within half the dent's radius of its axis. A dent with no skin in reach
   * (a blow on the box where this model has only air) resolves to null.
   */
  private *resolveDent(dent: BodyDent): Pass<ResolvedDent | null> {
    let skin = Infinity;
    const axis2 = dent.radius * dent.radius * 0.25;
    for (const entry of this.meshes) {
      _struck.set(dent.x, dent.y, dent.z);
      if (entry.bounds.distanceToPoint(_struck) > DENT_SKIN_REACH_M + dent.radius) continue;
      const chassis = (yield* decode(entry)).chassis;
      const count = chassis.length / 3;
      for (let start = 0; start < count; start += DENT_STEP_VERTICES) {
        const end = Math.min(count, start + DENT_STEP_VERTICES);
        for (let i = start * 3; i < end * 3; i += 3) {
          const vx = chassis[i]! - dent.x;
          const vy = chassis[i + 1]! - dent.y;
          const vz = chassis[i + 2]! - dent.z;
          const along = vx * dent.nx + vy * dent.ny + vz * dent.nz;
          if (along < -0.05 || along > DENT_SKIN_REACH_M || along >= skin) continue;
          if (vx * vx + vy * vy + vz * vz - along * along < axis2) skin = along;
        }
        yield;
      }
    }
    if (!Number.isFinite(skin)) return null;
    const band = Math.max(DENT_BAND_MIN_M, dent.radius * DENT_BAND_PER_RADIUS);
    // Outside this sphere round the struck point the dent cannot move anything, so the
    // field is only evaluated near a dent.
    const reachAlong = Math.abs(skin) + band;
    return {
      px: dent.x,
      py: dent.y,
      pz: dent.z,
      nx: dent.nx,
      ny: dent.ny,
      nz: dent.nz,
      radius: dent.radius,
      depth: Math.min(dent.depth, dent.radius * DENT_DEPTH_PER_RADIUS),
      band,
      skin,
      reach2: dent.radius * dent.radius + reachAlong * reachAlong,
    };
  }

  /**
   * The wheel guard at a chassis-local point, with its gradient written to `gradient`:
   * 1 in clear air, fading to 0 against a tyre. Every dent's push is scaled by it, and
   * it does not depend on the dent, so a vertex evaluates it once for all of them.
   */
  private wheelGuard(x: number, y: number, z: number, gradient: THREE.Vector3): number {
    let guard = 1;
    gradient.set(0, 0, 0);
    for (const wheel of this.wheels) {
      const across = x - wheel.x;
      const sideStart = wheel.halfWidth + WHEEL_GUARD_SIDE_M;
      const sideEnd = sideStart + WHEEL_GUARD_SIDE_FADE_M;
      const side = Math.abs(across);
      if (side >= sideEnd) continue;
      const dy = y - wheel.y;
      const dz = z - wheel.z;
      const clearStart = wheel.radius + WHEEL_CLEARANCE_M;
      const clearEnd = clearStart + WHEEL_GUARD_FADE_M;
      const radial2 = dy * dy + dz * dz;
      if (radial2 >= clearEnd * clearEnd) continue;
      const radial = Math.sqrt(radial2);
      const inside = 1 - smoothstep(sideStart, sideEnd, side);
      const clear = smoothstep(clearStart, clearEnd, radial);
      // factor = 1 - inside·(1 - clear): inside falls off across the tyre's width,
      // clear rises with distance from its axle.
      const factor = 1 - inside * (1 - clear);
      const insideSlopeX = -smoothstepSlope(sideStart, sideEnd, side) * Math.sign(across);
      const clearSlope = radial > 1e-9 ? smoothstepSlope(clearStart, clearEnd, radial) / radial : 0;
      const fx = -insideSlopeX * (1 - clear);
      const fy = inside * clearSlope * dy;
      const fz = inside * clearSlope * dz;
      gradient.set(
        gradient.x * factor + guard * fx,
        gradient.y * factor + guard * fy,
        gradient.z * factor + guard * fz,
      );
      guard *= factor;
    }
    return guard;
  }

  private wheelPenetration(x: number, y: number, z: number): number {
    let worst = 0;
    for (const wheel of this.wheels) {
      if (Math.abs(x - wheel.x) > wheel.halfWidth) continue;
      const dy = y - wheel.y;
      const dz = z - wheel.z;
      worst = Math.max(worst, wheel.radius - Math.sqrt(dy * dy + dz * dz));
    }
    return worst;
  }

  /**
   * Recomputes every vertex within reach of a `changed` dent from all the `dents` now
   * on the car. Everything else already holds its exact displacement: no changed dent
   * pushes it, before or after.
   */
  private *deform(dents: readonly ResolvedDent[], changed: readonly ResolvedDent[]): Pass {
    let movedVertices = 0;
    let maxDisplacementM = 0;
    let minJacobian = 1;
    let wheelPenetrationM = 0;

    for (const entry of this.meshes) {
      if (!changed.some((dent) => reachesBounds(entry.bounds, dent))) continue;
      const reaching = dents.filter((dent) => reachesBounds(entry.bounds, dent));
      if (reaching.length === 0) {
        // No dent reaches this mesh any more (its dent aged out of the ring).
        restorePristine(entry);
        continue;
      }
      const decoded = yield* decode(entry);
      const chassis = decoded.chassis;
      const local = decoded.local;
      const sourceNormals = decoded.normals;
      const count = chassis.length / 3;
      let output = entry.dented;

      for (let start = 0; start < count; start += DENT_STEP_VERTICES) {
        const end = Math.min(count, start + DENT_STEP_VERTICES);
        let first = end;
        let last = -1;
        for (let i = start; i < end; i++) {
          const x = chassis[i * 3]!;
          const y = chassis[i * 3 + 1]!;
          const z = chassis[i * 3 + 2]!;
          let touched = false;
          for (const dent of changed) {
            const dx = x - dent.px;
            const dy = y - dent.py;
            const dz = z - dent.pz;
            if (dx * dx + dy * dy + dz * dz <= dent.reach2) {
              touched = true;
              break;
            }
          }
          if (!touched) continue;

          let ux = 0;
          let uy = 0;
          let uz = 0;
          // Jacobian of the displacement map, I + sum of n (grad s)^T, row-major.
          let j00 = 1, j01 = 0, j02 = 0;
          let j10 = 0, j11 = 1, j12 = 0;
          let j20 = 0, j21 = 0, j22 = 1;
          const guard = this.wheelGuard(x, y, z, _guardGradient);
          for (const dent of reaching) {
            const dx = x - dent.px;
            const dy = y - dent.py;
            const dz = z - dent.pz;
            const distance2 = dx * dx + dy * dy + dz * dz;
            if (distance2 > dent.reach2) continue;
            // The push: a smooth bowl across the panel, full depth at and in front of
            // the skin fading to nothing a band behind it, scaled by the wheel guard.
            const along = dx * dent.nx + dy * dent.ny + dz * dent.nz;
            const radius2 = dent.radius * dent.radius;
            const q2 = (distance2 - along * along) / radius2;
            if (q2 >= 1) continue;
            const t = (along - dent.skin) / dent.band;
            if (t >= 1) continue;
            const rim = 1 - q2;
            const bowl = rim * rim;
            const window = t <= 0 ? 1 : 1 - t * t * (3 - 2 * t);
            const unguarded = dent.depth * bowl * window;
            const s = unguarded * guard;
            // Its gradient, analytically: the bowl varies across the push direction,
            // the window along it, the guard wherever a tyre is near.
            const acrossSlope = (dent.depth * window * -4 * rim) / radius2;
            const alongSlope = t <= 0 ? 0 : (dent.depth * bowl * -6 * t * (1 - t)) / dent.band;
            const gx = (acrossSlope * (dx - along * dent.nx) + alongSlope * dent.nx) * guard
              + unguarded * _guardGradient.x;
            const gy = (acrossSlope * (dy - along * dent.ny) + alongSlope * dent.ny) * guard
              + unguarded * _guardGradient.y;
            const gz = (acrossSlope * (dz - along * dent.nz) + alongSlope * dent.nz) * guard
              + unguarded * _guardGradient.z;
            ux += dent.nx * s;
            uy += dent.ny * s;
            uz += dent.nz * s;
            j00 += dent.nx * gx; j01 += dent.nx * gy; j02 += dent.nx * gz;
            j10 += dent.ny * gx; j11 += dent.ny * gy; j12 += dent.ny * gz;
            j20 += dent.nz * gx; j21 += dent.nz * gy; j22 += dent.nz * gz;
          }
          const moved = Math.sqrt(ux * ux + uy * uy + uz * uz);
          const k = i * 3;
          if (moved < 1e-4) {
            // Pushed before, by a dent that is gone: back to the template's shape.
            if (output) {
              output.positions[k] = local[k]!;
              output.positions[k + 1] = local[k + 1]!;
              output.positions[k + 2] = local[k + 2]!;
              if (output.normals && sourceNormals) {
                output.normals[k] = sourceNormals[k]!;
                output.normals[k + 1] = sourceNormals[k + 1]!;
                output.normals[k + 2] = sourceNormals[k + 2]!;
              }
              first = Math.min(first, i);
              last = i;
            }
            continue;
          }

          output ??= createDentedGeometry(entry, decoded);
          movedVertices++;
          maxDisplacementM = Math.max(maxDisplacementM, moved);
          wheelPenetrationM = Math.max(wheelPenetrationM, this.wheelPenetration(x + ux, y + uy, z + uz));
          first = Math.min(first, i);
          last = i;

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
          positions[k] = local[k]! + _u.x;
          positions[k + 1] = local[k + 1]! + _u.y;
          positions[k + 2] = local[k + 2]! + _u.z;

          const normals = output.normals;
          if (normals && sourceNormals) {
            _n.fromArray(sourceNormals, k).applyMatrix3(entry.normalToChassis);
            const nx = c00 * _n.x + c01 * _n.y + c02 * _n.z;
            const ny = c10 * _n.x + c11 * _n.y + c12 * _n.z;
            const nz = c20 * _n.x + c21 * _n.y + c22 * _n.z;
            _n.set(nx, ny, nz).applyMatrix3(entry.normalToLocal).normalize();
            normals[k] = _n.x;
            normals[k + 1] = _n.y;
            normals[k + 2] = _n.z;
          }
        }
        // Each step's span goes to the GPU as it is written, so the crumple appears
        // as it is computed. A copy made in this pass has never been uploaded, and
        // its first upload sends the whole buffer anyway.
        if (output && last >= first) {
          output.position.addUpdateRange(first * 3, (last - first + 1) * 3);
          output.position.needsUpdate = true;
          if (output.normal) {
            output.normal.addUpdateRange(first * 3, (last - first + 1) * 3);
            output.normal.needsUpdate = true;
          }
        }
        yield;
      }
    }
    let dentedMeshes = 0;
    for (const entry of this.meshes) if (entry.dented) dentedMeshes++;
    this.stats = { movedVertices, maxDisplacementM, minJacobian, wheelPenetrationM, dentedMeshes };
  }
}

/** Whether a dent's reach sphere touches a mesh's chassis-frame box. */
function reachesBounds(bounds: THREE.Box3, dent: ResolvedDent): boolean {
  _struck.set(dent.px, dent.py, dent.pz);
  return bounds.distanceToPoint(_struck) ** 2 <= dent.reach2;
}

/** Swaps the template geometry back onto a mesh and frees this car's buffers for it. */
function restorePristine(entry: DeformableMesh): void {
  if (!entry.dented) return;
  entry.mesh.geometry = entry.pristine;
  const geometry = entry.dented.geometry;
  // Disposing a geometry frees the GPU buffer of every attribute it still holds, and
  // all but the two displaced ones are the template's, drawn by every other car of the
  // model. Detach those first.
  geometry.setIndex(null);
  for (const name of Object.keys(geometry.attributes)) {
    if (name !== 'position' && name !== 'normal') geometry.deleteAttribute(name);
  }
  geometry.dispose();
  entry.dented = null;
}

/**
 * The decoded form of a mesh's template geometry, filled in steps. Shared through
 * `decodedGeometries` with every car of the model — and, while it is still being
 * filled, through `partialDecodes`, so a second car picks up where the first left
 * off. A mesh whose geometry another car uses under a different transform keeps a
 * private decode.
 */
function* decode(entry: DeformableMesh): Pass<DecodedGeometry> {
  if (entry.decoded) return entry.decoded;
  const complete = decodedGeometries.get(entry.pristine);
  if (complete && complete.toChassis.equals(entry.toChassis)) {
    entry.decoded = complete;
    return complete;
  }
  const position = entry.pristine.getAttribute('position');
  const normal = entry.pristine.getAttribute('normal');
  const count = position.count;
  const sharedPartial = complete ? undefined : partialDecodes.get(entry.pristine);
  let work =
    sharedPartial && sharedPartial.decoded.toChassis.equals(entry.toChassis)
      ? sharedPartial
      : entry.partialDecode;
  if (!work) {
    work = {
      decoded: {
        toChassis: entry.toChassis,
        local: new Float32Array(count * 3),
        normals: normal ? new Float32Array(count * 3) : null,
        chassis: new Float32Array(count * 3),
      },
      next: 0,
    };
    if (!complete && !sharedPartial) partialDecodes.set(entry.pristine, work);
    else entry.partialDecode = work;
  }
  const { local, normals, chassis } = work.decoded;
  while (work.next < count) {
    const start = work.next;
    const end = Math.min(count, start + DENT_STEP_VERTICES);
    for (let v = start; v < end; v++) {
      _p.fromBufferAttribute(position, v);
      _p.toArray(local, v * 3);
      _p.applyMatrix4(entry.toChassis);
      _p.toArray(chassis, v * 3);
      if (normal && normals) _n.fromBufferAttribute(normal, v).toArray(normals, v * 3);
    }
    work.next = end;
    if (end < count) yield;
  }
  if (partialDecodes.get(entry.pristine) === work) {
    partialDecodes.delete(entry.pristine);
    if (!decodedGeometries.has(entry.pristine)) decodedGeometries.set(entry.pristine, work.decoded);
  }
  entry.partialDecode = null;
  entry.decoded = work.decoded;
  return work.decoded;
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

/** Derivative of `smoothstep` with respect to `x`. */
function smoothstepSlope(edge0: number, edge1: number, x: number): number {
  const t = (x - edge0) / (edge1 - edge0);
  if (t <= 0 || t >= 1) return 0;
  return (6 * t * (1 - t)) / (edge1 - edge0);
}

/**
 * This car's own copy of a mesh, swapped onto it the first time a dent moves one of
 * its vertices. Only position and normal are new, plain-float buffers, since displaced
 * vertices no longer sit on the quantisation grid; the index and every other attribute
 * are the template's own objects (see `restorePristine` for why that is safe to free).
 * Bounds are the template's plus a fixed slack rather than recomputed per blow.
 */
function createDentedGeometry(entry: DeformableMesh, decoded: DecodedGeometry): DentedGeometry {
  const source = entry.pristine;
  const geometry = new THREE.BufferGeometry();
  geometry.name = source.name;
  geometry.setIndex(source.index);
  for (const [name, attribute] of Object.entries(source.attributes)) {
    if (name !== 'position' && name !== 'normal') geometry.setAttribute(name, attribute);
  }
  for (const group of source.groups) geometry.addGroup(group.start, group.count, group.materialIndex);
  geometry.setDrawRange(source.drawRange.start, source.drawRange.count);
  const positions = decoded.local.slice();
  const position = new THREE.BufferAttribute(positions, 3);
  geometry.setAttribute('position', position);
  const normals = decoded.normals ? decoded.normals.slice() : null;
  const normal = normals ? new THREE.BufferAttribute(normals, 3) : null;
  if (normal) geometry.setAttribute('normal', normal);

  if (!source.boundingSphere) source.computeBoundingSphere();
  const slack = DENTED_BOUNDS_SLACK_M * entry.localPerMetre;
  geometry.boundingBox = source.boundingBox!.clone().expandByScalar(slack);
  geometry.boundingSphere = source.boundingSphere!.clone();
  geometry.boundingSphere.radius += slack;

  entry.dented = { geometry, position, positions, normal, normals };
  entry.mesh.geometry = geometry;
  return entry.dented;
}
