import RAPIER from '@dimforge/rapier3d-compat';
import { SurfaceRegistry, SurfaceType } from './surfaces';

/**
 * Thin ownership layer over the Rapier world.
 *
 * Deliberately not an abstraction: gameplay code uses Rapier types directly. This
 * class exists to own three things that must have exactly one owner — the world
 * instance, the collider-to-surface map, and the fixed timestep — plus the handful
 * of collider constructions that are easy to get subtly wrong.
 */

/** Physics runs at a fixed 60 Hz regardless of frame rate. */
export const FIXED_DT = 1 / 60;

export type Vec3 = { x: number; y: number; z: number };

export interface RaycastHit {
  readonly colliderHandle: number;
  readonly point: Vec3;
  readonly normal: Vec3;
  /** Distance along the ray. */
  readonly toi: number;
}

export class PhysicsWorld {
  readonly world: RAPIER.World;
  readonly surfaces = new SurfaceRegistry();

  /** Scratch ray reused every query, so per-frame raycasts do not allocate. */
  private readonly scratchRay: RAPIER.Ray;

  private constructor() {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = FIXED_DT;
    this.scratchRay = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
  }

  /** Loads the Rapier WASM module, then constructs the world. Must be awaited once. */
  static async create(): Promise<PhysicsWorld> {
    await RAPIER.init();
    return new PhysicsWorld();
  }

  /** The Rapier namespace, for callers building their own shapes and joints. */
  get rapier(): typeof RAPIER {
    return RAPIER;
  }

  step(): void {
    this.world.step();
  }

  /**
   * Static triangle mesh, used for the road ribbon and buildings.
   *
   * `vertices` is a flat xyz array and `indices` a flat triangle list. Registering
   * the surface here rather than at the call site is what guarantees every drivable
   * collider has a friction profile.
   */
  addStaticTrimesh(
    vertices: Float32Array,
    indices: Uint32Array,
    surface: SurfaceType,
  ): RAPIER.Collider {
    const bodyDesc = RAPIER.RigidBodyDesc.fixed();
    const bodyRef = this.world.createRigidBody(bodyDesc);
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.trimesh(vertices, indices),
      bodyRef,
    );
    this.surfaces.register(collider.handle, surface);
    return collider;
  }

  /**
   * Static heightfield for open terrain.
   *
   * Rapier expects heights in column-major order over an (nrows+1) x (ncols+1) grid,
   * scaled to `scale`. Getting that ordering wrong produces terrain that looks right
   * and collides transposed, so it is centralised here.
   */
  addHeightfield(
    nrows: number,
    ncols: number,
    heights: Float32Array,
    scale: Vec3,
    position: Vec3,
    surface: SurfaceType,
  ): RAPIER.Collider {
    const bodyRef = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(position.x, position.y, position.z),
    );
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.heightfield(nrows, ncols, heights, scale),
      bodyRef,
    );
    this.surfaces.register(collider.handle, surface);
    return collider;
  }

  /** Dynamic box, used for loose parts and debris. */
  addDynamicBox(
    halfExtents: Vec3,
    position: Vec3,
    mass: number,
  ): { body: RAPIER.RigidBody; collider: RAPIER.Collider } {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(position.x, position.y, position.z)
        // Loose parts settle rather than skitter; they are junk, not billiard balls.
        .setLinearDamping(0.15)
        .setAngularDamping(0.35),
    );
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(halfExtents.x, halfExtents.y, halfExtents.z)
        .setMass(mass)
        .setFriction(0.8)
        .setRestitution(0.05),
      body,
    );
    return { body, collider };
  }

  /** Removes a body and every collider attached to it, and forgets its surfaces. */
  removeBody(body: RAPIER.RigidBody): void {
    for (let i = 0; i < body.numColliders(); i++) {
      this.surfaces.forget(body.collider(i).handle);
    }
    this.world.removeRigidBody(body);
  }

  /**
   * Closest hit along a ray, or null. Used for interaction, camera occlusion, ground
   * probes and bullets. Does not allocate on the hot path beyond the returned hit.
   */
  raycast(
    origin: Vec3,
    direction: Vec3,
    maxToi: number,
    exclude?: RAPIER.RigidBody,
  ): RaycastHit | null {
    this.scratchRay.origin = origin;
    this.scratchRay.dir = direction;
    const hit = this.world.castRayAndGetNormal(
      this.scratchRay,
      maxToi,
      true,
      undefined,
      undefined,
      undefined,
      exclude,
    );
    if (!hit) return null;
    return {
      colliderHandle: hit.collider.handle,
      point: {
        x: origin.x + direction.x * hit.timeOfImpact,
        y: origin.y + direction.y * hit.timeOfImpact,
        z: origin.z + direction.z * hit.timeOfImpact,
      },
      normal: hit.normal,
      toi: hit.timeOfImpact,
    };
  }
}
