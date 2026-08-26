import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { PhysicsWorld } from '../core/physics';
import { SurfaceType } from '../core/surfaces';
import type { GameWorld } from '../game/state';
import type { WorldOrigin } from './origin';
import type { BreakableProp, PropPiece } from './props';

/**
 * Props that come apart, and the pieces of the ones that have.
 *
 * Two jobs that have to live together. It is the registry of everything standing that
 * can be knocked down — the chunk hands them over as it builds them and takes them back
 * when it unloads — and it is the owner of the dynamic pieces those become. One class,
 * because a break is a single transaction across both: the instant that blanks the
 * instance and switches off the static collider is the instant the pieces have to enter
 * the world carrying the momentum that did it.
 *
 * Pieces are NOT chunk content, and that is deliberate. A cactus flattened at the edge
 * of the physics band is still in the air when its chunk unloads, and a chunk that owned
 * its debris would delete it mid-flight. The field owns them against its own budget
 * instead, and `WorldState.flattenedProps` is what makes the flattening outlive both.
 */

/**
 * Live pieces allowed at once.
 *
 * A saguaro is five, so this is nine cacti of wreckage lying about before the oldest
 * goes. There is no timer: a piece that has come to rest is scenery, and scenery that
 * evaporates while you look at it is worse than scenery that eventually gets recycled.
 * Settled bodies sleep, so the standing cost is a body in the broad phase.
 */
const MAX_PIECES = 48;
/**
 * Speed (m/s) below which a hit breaks nothing.
 *
 * Below it the static collider still holds, so leaning on a cactus at a crawl pushes
 * against it exactly as before. Deliberate: parking against a plant should not demolish
 * it, and a car rolling to a stop should not scythe a line through the desert.
 */
const BREAK_SPEED_MPS = 2.6;
/**
 * Fraction of the impactor's velocity a piece leaves with, plus the sideways and upward
 * kick that turns a shunt into a burst.
 *
 * Under one, because a tonne of car meeting a few tens of kilos of plant does not hand
 * over all of its speed — but far more than a real momentum transfer, since the pieces
 * are already lighter than life (see `PropPiece`). The lift is what reads as breaking
 * rather than as being pushed over.
 */
const PIECE_VELOCITY_SHARE = 0.75;
const PIECE_BURST_MPS = 2.4;
const PIECE_LIFT_MPS = 2.2;
/** Largest angular velocity (rad/s) a piece leaves with, per axis. */
const PIECE_SPIN = 7;

/**
 * What is doing the hitting: an oriented box with a velocity, in ABSOLUTE coordinates.
 *
 * Structural, so this file knows nothing about vehicles. `main.ts` fills one from the
 * driven car each step. A box and not a sphere because a car is four metres long and
 * under two wide, and a sphere fat enough to reach its bumper would scythe down
 * everything it drove past.
 */
export interface Impactor {
  x: number;
  y: number;
  z: number;
  /** Unit forward direction in world XZ. */
  fx: number;
  fz: number;
  /** Half extents across and along that forward direction, metres. */
  halfWidth: number;
  halfLength: number;
  /** World velocity, m/s. */
  vx: number;
  vy: number;
  vz: number;
}

interface Piece {
  readonly body: RAPIER.RigidBody;
  readonly mesh: THREE.Mesh;
}

/** Zero-scale matrix: what a blanked instance gets. Written once, reused forever. */
const BLANK_MATRIX = new THREE.Matrix4().makeScale(0, 0, 0);

const _up = new THREE.Vector3(0, 1, 0);
const _yaw = new THREE.Quaternion();
const _offset = new THREE.Vector3();
const _t = { x: 0, y: 0, z: 0 };
const _r = { x: 0, y: 0, z: 0, w: 1 };

export class DebrisField {
  private readonly standing = new Map<number, BreakableProp>();
  private readonly pieces: Piece[] = [];
  /** Mirror of `state.flattenedProps`, so a chunk build tests it in O(1). */
  private readonly broken = new Set<number>();

  constructor(
    private readonly physics: PhysicsWorld,
    private readonly world: GameWorld,
    private readonly scene: THREE.Scene,
    private readonly origin: WorldOrigin,
  ) {
    for (const id of world.state.flattenedProps) this.broken.add(id);
  }

  isBroken(id: number): boolean {
    return this.broken.has(id);
  }

  register(prop: BreakableProp): void {
    this.standing.set(prop.id, prop);
  }

  forget(ids: readonly number[]): void {
    for (const id of ids) this.standing.delete(id);
  }

  /**
   * Tests every standing prop against the impactor and breaks whatever it has reached.
   *
   * Linear over the props in the physics band — a couple of hundred, each costing two
   * subtractions, two dots and two comparisons — which beats asking Rapier for contact
   * events and needs no event queue threaded through the world step.
   *
   * Proximity, not contact, and deliberately a shade generous: the collider must go off
   * just BEFORE the car reaches it, so the car walks through the plant rather than
   * bouncing off a capsule that then vanishes.
   */
  update(impactor: Impactor | null): void {
    if (!impactor) return;
    const speed = Math.hypot(impactor.vx, impactor.vz);
    if (speed < BREAK_SPEED_MPS) return;

    // Right of forward, so a world offset resolves into the car's own frame.
    const rx = impactor.fz;
    const rz = -impactor.fx;
    for (const prop of this.standing.values()) {
      const dx = prop.x - impactor.x;
      const dz = prop.z - impactor.z;
      const along = dx * impactor.fx + dz * impactor.fz;
      if (Math.abs(along) > impactor.halfLength + prop.radius) continue;
      const across = dx * rx + dz * rz;
      if (Math.abs(across) > impactor.halfWidth + prop.radius) continue;
      // Vertically the box has to reach the plant at all: one standing on a dune shelf
      // above the roofline is not being hit by anything.
      if (prop.y > impactor.y + prop.height) continue;
      if (prop.y + prop.height < impactor.y - 1.5) continue;
      this.breakProp(prop, impactor);
    }
  }

  /**
   * Copies piece transforms into their meshes, once per render frame.
   *
   * EVERY piece, sleeping ones included, unlike `LoosePartField`'s equivalent. A
   * floating-origin rebase moves every body in the world without waking it, so a
   * sleeping body that is skipped here leaves its mesh a kilometre behind. Forty-eight
   * transform copies a frame is not worth being clever about.
   */
  syncVisuals(): void {
    for (const piece of this.pieces) {
      const t = piece.body.translation(_t);
      const r = piece.body.rotation(_r);
      piece.mesh.position.set(t.x, t.y, t.z);
      piece.mesh.quaternion.set(r.x, r.y, r.z, r.w);
    }
  }

  dispose(): void {
    for (const piece of this.pieces) this.removePiece(piece);
    this.pieces.length = 0;
    this.standing.clear();
  }

  private removePiece(piece: Piece): void {
    this.scene.remove(piece.mesh);
    // removeBody forgets the surface and every collider attached to the body.
    this.physics.removeBody(piece.body);
  }

  private breakProp(prop: BreakableProp, impactor: Impactor): void {
    this.standing.delete(prop.id);
    this.broken.add(prop.id);
    this.world.apply({ t: 'prop_flatten', propId: prop.id });

    // The standing prop goes in one step: instance blanked, collider switched off.
    // DISABLED rather than removed, because the chunk that created the collider still
    // owns its body and will tear it down on unload — removing it here would leave the
    // streamer holding a dead handle.
    prop.mesh.setMatrixAt(prop.instance, BLANK_MATRIX);
    prop.mesh.instanceMatrix.needsUpdate = true;
    prop.collider.setEnabled(false);

    _yaw.setFromAxisAngle(_up, prop.yaw);
    for (const def of prop.pieces) this.spawnPiece(prop, def, impactor);
  }

  private spawnPiece(prop: BreakableProp, def: PropPiece, impactor: Impactor): void {
    if (this.pieces.length >= MAX_PIECES) {
      const oldest = this.pieces.shift();
      if (oldest) this.removePiece(oldest);
    }

    // The piece's place in the whole, taken through the prop's own yaw and scale, so a
    // cactus that stood turned comes apart turned. `_yaw` was set by `breakProp`.
    _offset.set(def.offset[0], def.offset[1], def.offset[2]).multiplyScalar(prop.scale);
    _offset.applyQuaternion(_yaw);
    // Bodies and meshes live in the RELATIVE frame; the prop's position is absolute.
    const px = prop.x + _offset.x - this.origin.x;
    const py = prop.y + _offset.y;
    const pz = prop.z + _offset.z - this.origin.z;

    const body = this.physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(px, py, pz)
        .setRotation({ x: _yaw.x, y: _yaw.y, z: _yaw.z, w: _yaw.w }),
    );
    const collider = this.physics.world.createCollider(
      RAPIER.ColliderDesc.capsule(def.capsule[0] * prop.scale, def.capsule[1] * prop.scale).setMass(
        def.mass * prop.scale,
      ),
      body,
    );
    // A wheel that runs over a piece is on the piece, not on the sand under it.
    this.physics.surfaces.register(collider.handle, SurfaceType.Rock);

    // Momentum out of the impact, plus a burst away from the plant's own axis and a
    // lift. Radial in XZ, so the far side of the plant leaves the far way.
    const bx = _offset.x - impactor.fx * 0.2;
    const bz = _offset.z - impactor.fz * 0.2;
    const burst = Math.hypot(bx, bz) || 1;
    body.setLinvel(
      {
        x: impactor.vx * PIECE_VELOCITY_SHARE + (bx / burst) * PIECE_BURST_MPS,
        y: impactor.vy * 0.3 + PIECE_LIFT_MPS,
        z: impactor.vz * PIECE_VELOCITY_SHARE + (bz / burst) * PIECE_BURST_MPS,
      },
      true,
    );
    body.setAngvel(
      {
        x: (Math.random() - 0.5) * PIECE_SPIN,
        y: (Math.random() - 0.5) * PIECE_SPIN,
        z: (Math.random() - 0.5) * PIECE_SPIN,
      },
      true,
    );

    const mesh = new THREE.Mesh(def.geometry, def.material);
    mesh.scale.setScalar(prop.scale);
    mesh.position.set(px, py, pz);
    mesh.quaternion.copy(_yaw);
    mesh.receiveShadow = true;
    this.scene.add(mesh);

    this.pieces.push({ body, mesh });
  }
}
