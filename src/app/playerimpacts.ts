/**
 * The player's collisions, turned into injuries.
 *
 * Reads pre-solver velocities for the player, every vehicle and every traffic car, and
 * converts the post-solver manifolds into debounced damage. Any other dynamic body — a
 * trailer, a loose can — is read post-solver, so its strike is judged on the velocity
 * the contact has already reduced.
 * Built by the composition root with an explicit context, so the module holds no
 * reference to the boot closure it was lifted out of.
 */

import * as THREE from 'three';
import type { PhysicsWorld } from '../core/physics';
import type { PlayerVitals } from '../player/vitals';
import type { Player } from '../player/player';
import type { Vehicle } from '../vehicle/vehicle';
import type { RoadTraffic } from '../world/traffic';

/** Everything the impact pass reads; held, never captured. */
export interface PlayerImpactsContext {
  readonly physics: PhysicsWorld;
  readonly player: Player;
  readonly vitals: PlayerVitals;
  /** The active cars; their chassis velocities are sampled before the solver runs. */
  readonly vehicles: Map<string, Vehicle>;
  /** Ambient traffic shares those vehicles' collision behaviour. */
  readonly traffic: RoadTraffic;
}

/** The two halves of one collision pass: sample before the step, resolve after it. */
export interface PlayerImpacts {
  capture(): void;
  resolve(driving: Vehicle | null): number;
}

export function createPlayerImpacts(ctx: PlayerImpactsContext): PlayerImpacts {
  // Collision severity reads pre-solver velocity. Rapier resolves most of that
  // velocity away on the same step that creates the contact, so sampling afterwards
  // would make the hardest crash look like the slowest. The weak pool keeps one
  // scratch vector per live Vehicle without retaining despawned traffic.
  const impactVelocityPool = new WeakMap<Vehicle, THREE.Vector3>();
  const impactVelocityByBody = new Map<number, THREE.Vector3>();
  const impactPlayerVelocity = new THREE.Vector3();
  const impactOtherVelocity = new THREE.Vector3();
  const impactRelativeVelocity = new THREE.Vector3();
  const impactNormal = new THREE.Vector3();
  const captureImpactVelocities = (): void => {
    impactVelocityByBody.clear();
    const capture = (vehicle: Vehicle): void => {
      let velocity = impactVelocityPool.get(vehicle);
      if (velocity === undefined) {
        velocity = new THREE.Vector3();
        impactVelocityPool.set(vehicle, velocity);
      }
      vehicle.chassis.linvel(velocity);
      impactVelocityByBody.set(vehicle.chassis.handle, velocity);
    };
    for (const vehicle of ctx.vehicles.values()) capture(vehicle);
    ctx.traffic.forEachVehicle((_id, vehicle) => capture(vehicle));
    ctx.player.rigidBody.linvel(impactPlayerVelocity);
  };

  /**
   * Converts post-solver contact manifolds into debounced injuries. Only the velocity
   * closing along the contact normal contributes: a tyre or chassis sliding quickly
   * along the road is not a high-speed collision with the road.
   */
  const resolvePlayerImpacts = (driving: Vehicle | null): number => {
    const collider = driving?.collisionCollider ?? ctx.player.collisionCollider;
    const targetBody = collider.parent();
    if (targetBody === null) return 0;
    const targetVelocity =
      (driving ? impactVelocityByBody.get(targetBody.handle) : impactPlayerVelocity)
      ?? impactPlayerVelocity;
    ctx.vitals.beginCollisionFrame(driving ? 'car' : 'foot');

    ctx.physics.world.contactPairsWith(collider, (otherCollider) => {
      const otherBody = otherCollider.parent();
      if (otherBody === null) return;
      const otherVehicleVelocity = impactVelocityByBody.get(otherBody.handle);
      if (driving === null) {
        // On foot, terrain and buildings cannot reach the harmful walking threshold;
        // only a moving vehicle is a hard body capable of striking the capsule.
        if (otherVehicleVelocity === undefined) return;
      } else if (
        !otherBody.isFixed()
        && otherVehicleVelocity === undefined
        && otherBody.mass() < 100
      ) {
        // Loose cans, tools and footballs are contacts, not hard-object crashes.
        return;
      }

      if (otherBody.isFixed()) {
        impactOtherVelocity.set(0, 0, 0);
      } else if (otherVehicleVelocity !== undefined) {
        impactOtherVelocity.copy(otherVehicleVelocity);
      } else {
        otherBody.linvel(impactOtherVelocity);
      }
      impactRelativeVelocity.subVectors(targetVelocity, impactOtherVelocity);

      let strongestClosingMps = 0;
      ctx.physics.world.contactPair(collider, otherCollider, (manifold) => {
        if (manifold.numSolverContacts() === 0) return;
        let impulse = 0;
        for (let i = 0; i < manifold.numContacts(); i++) {
          impulse = Math.max(impulse, manifold.contactImpulse(i));
        }
        // Speculative manifolds appear just before contact. They must not consume
        // the debounce key before the first solver impulse actually lands.
        if (impulse <= 0) return;
        manifold.normal(impactNormal);
        strongestClosingMps = Math.max(
          strongestClosingMps,
          Math.abs(impactRelativeVelocity.dot(impactNormal)),
        );
      });
      if (strongestClosingMps > 0) {
        ctx.vitals.recordContact(otherCollider.handle, strongestClosingMps * 3.6);
      }
    });

    return ctx.vitals.endCollisionFrame();
  };

  return { capture: captureImpactVelocities, resolve: resolvePlayerImpacts };
}