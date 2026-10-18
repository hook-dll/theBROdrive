import type RAPIER from '@dimforge/rapier3d-compat';
import type { PhysicsWorld } from '../core/physics';
import { SurfaceType } from '../core/surfaces';
import {
  MESA_RINGS,
  MESA_TOP_HEIGHT,
  footprintDistance,
  mesaFieldOf,
  mesaFootingY,
  type MesaField,
  type MesaSite,
} from './mesas';
import type { WorldOrigin } from './origin';
import type { Road } from './road';
import type { Terrain } from './terrain';

/**
 * A mesa is SOLID near the player: a car driven off the road into one stops at its
 * wall instead of driving into the rock.
 *
 * Each mesa whose footprint is within `MESA_COLLIDER_ATTACH_M` of the player gets one fixed trimesh collider:
 * the same rings and plateau the vista draws (`world/mesas.ts`), stood on the exact
 * ground (`mesaFootingY`), so the face a wheel meets is the face on screen. A trimesh
 * rather than a convex hull because the outline is not convex: each segment's
 * irregularity pushes it in or out by up to a fifth of the radius, and a hull would
 * fill every notch with an invisible wall a hundred metres out from the rock.
 * Fewer than 100 triangles, so the native BVH build is a fraction of a millisecond.
 *
 * Built through `PhysicsWorld.addStaticTrimesh` and removed through `removeBody`,
 * like the road ribbon's slabs and the desert tiles' props, and positioned relative
 * to the floating origin when built: `PhysicsWorld.rebase` moves the body with every
 * other one. Released past `DETACH_M`, a wider radius than the attach so a car
 * circling at the boundary does not rebuild one every frame.
 */
export const MESA_COLLIDER_ATTACH_M = 1500;
const DETACH_M = 1800;
/** Distance the player moves before the resident set is looked at again, metres. */
const RECHECK_M = 40;

export class MesaColliders {
  private readonly field: MesaField;
  private readonly bodies = new Map<number, RAPIER.RigidBody>();
  private readonly near: MesaSite[] = [];
  private lastX = Number.NaN;
  private lastZ = Number.NaN;

  constructor(
    private readonly physics: PhysicsWorld,
    road: Road,
    terrain: Terrain,
    private readonly origin: WorldOrigin,
  ) {
    this.field = mesaFieldOf(road, terrain);
  }

  /** `x`, `z`: the player's ABSOLUTE position. */
  update(x: number, z: number): void {
    if (Math.hypot(x - this.lastX, z - this.lastZ) < RECHECK_M) return;
    this.lastX = x;
    this.lastZ = z;
    const keep = this.field.sitesNear(x, z, DETACH_M, this.near);
    for (const [key, body] of this.bodies) {
      if (keep.some((site) => site.key === key)) continue;
      this.physics.removeBody(body);
      this.bodies.delete(key);
    }
    for (const site of keep) {
      if (this.bodies.has(site.key)) continue;
      if (footprintDistance(site, x, z) > MESA_COLLIDER_ATTACH_M) continue;
      this.bodies.set(site.key, this.build(site));
    }
  }

  /** How many mesas are solid right now; read by `tools/mesa-clearance.ts`. */
  get count(): number {
    return this.bodies.size;
  }

  private build(site: MesaSite): RAPIER.RigidBody {
    const footing = this.field.footing(site);
    const segments = site.segments;
    const rings = MESA_RINGS.length;
    const vertices = new Float32Array((rings * segments + 1) * 3);
    const ox = this.origin.x;
    const oz = this.origin.z;
    for (let ring = 0; ring < rings; ring++) {
      const radius = MESA_RINGS[ring]!.radius;
      for (let segment = 0; segment < segments; segment++) {
        const v = (ring * segments + segment) * 3;
        vertices[v] = site.x + site.outlineX[segment]! * radius - ox;
        vertices[v + 1] = mesaFootingY(site, footing, ring, segment);
        vertices[v + 2] = site.z + site.outlineZ[segment]! * radius - oz;
      }
    }
    const centre = rings * segments;
    vertices[centre * 3] = site.x - ox;
    vertices[centre * 3 + 1] = footing.centreGroundY + site.height * MESA_TOP_HEIGHT;
    vertices[centre * 3 + 2] = site.z - oz;

    const indices = new Uint32Array(((rings - 1) * segments * 2 + segments) * 3);
    let i = 0;
    for (let ring = 0; ring < rings - 1; ring++) {
      const current = ring * segments;
      const next = current + segments;
      for (let segment = 0; segment < segments; segment++) {
        const b = (segment + 1) % segments;
        indices[i++] = current + segment;
        indices[i++] = next + segment;
        indices[i++] = current + b;
        indices[i++] = current + b;
        indices[i++] = next + segment;
        indices[i++] = next + b;
      }
    }
    const top = (rings - 1) * segments;
    for (let segment = 0; segment < segments; segment++) {
      indices[i++] = centre;
      indices[i++] = top + ((segment + 1) % segments);
      indices[i++] = top + segment;
    }
    const collider = this.physics.addStaticTrimesh(vertices, indices, SurfaceType.Rock);
    return collider.parent()!;
  }
}
