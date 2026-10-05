/**
 * The gate posts the sand route and the slalom are driven at (kinds 12/13).
 *
 * The LAYOUT lives in `contracts/gates.ts` and is a pure function of the offer seed
 * and the road; this class only turns one such sequence into posts and flags, and
 * shows exactly the sequences the contract runtime says are live. Gates are not
 * colliders: passing one is measured geometrically from the car's path, so a post
 * that could be knocked over would only punish the driver for touching the thing the
 * game asked him to aim at.
 *
 * SHADER RULE. Every post shares one geometry and one material, and every flag shares
 * another pair, so a whole sequence is two programs. Both are compiled at boot by two
 * hidden anchors added to the scene here (`waitForFrameShaders` walks the scene with
 * `traverse`, so an invisible mesh is compiled), which is why the first contract to
 * open its gates does not link them on the main thread mid-drive.
 *
 * Meshes live in the RELATIVE frame and the whole group follows the floating origin;
 * the gate coordinates are absolute, as `contracts/gates.ts` produces them.
 */

import * as THREE from 'three';
import type { ContractGate } from '../contracts/gates';
import type { Terrain } from './terrain';

const POST_GEOMETRY = new THREE.BoxGeometry(0.14, 2.2, 0.14);
const FLAG_GEOMETRY = new THREE.PlaneGeometry(0.85, 0.5);
const POST_MATERIAL = new THREE.MeshStandardMaterial({ color: 0x6d5237, roughness: 1 });
const FLAG_MATERIAL = new THREE.MeshStandardMaterial({ color: 0xc8452b, roughness: 1, side: THREE.DoubleSide });

/** Post centre above its own ground; the post is 2.2 m tall. */
const POST_CENTRE_Y_M = 1.1;
/** Flag centre above the ground, hung near the post top. */
const FLAG_CENTRE_Y_M = 1.72;
/** How far the flag hangs outward from its post, along the post line. */
const FLAG_OFFSET_M = 0.45;

export class GateField {
  private readonly root = new THREE.Group();
  /** One group per live gate contract, keyed by cargo item id. */
  private readonly sets = new Map<string, THREE.Group>();
  private readonly warmup = new THREE.Group();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly terrain: Terrain,
  ) {
    this.scene.add(this.root);
    this.warmUpPrograms();
  }

  /**
   * Compiles the post and flag programs at boot. The anchors share the geometries and
   * materials above, so the runtime meshes reuse exactly these programs.
   */
  private warmUpPrograms(): void {
    const post = new THREE.Mesh(POST_GEOMETRY, POST_MATERIAL);
    post.visible = false;
    this.warmup.add(post);
    const flag = new THREE.Mesh(FLAG_GEOMETRY, FLAG_MATERIAL);
    flag.visible = false;
    this.warmup.add(flag);
    this.scene.add(this.warmup);
  }

  /**
   * Makes the visible sequences exactly the live gate contracts. A sequence is built
   * once, when it first appears, and removed when its cargo is delivered, dropped back
   * into its source courier or otherwise leaves the world.
   */
  setActive(active: ReadonlyMap<string, readonly ContractGate[]>): void {
    for (const [id, group] of this.sets) {
      if (active.has(id)) continue;
      this.root.remove(group);
      this.sets.delete(id);
    }
    for (const [id, gates] of active) {
      if (this.sets.has(id)) continue;
      const group = this.build(gates);
      this.sets.set(id, group);
      this.root.add(group);
    }
  }

  /** Follows the floating origin. The gates themselves never move. */
  update(originX: number, originZ: number): void {
    this.root.position.set(-originX, 0, -originZ);
  }

  dispose(): void {
    this.sets.clear();
    this.root.clear();
    this.warmup.clear();
    this.scene.remove(this.root);
    this.scene.remove(this.warmup);
  }

  private build(gates: readonly ContractGate[]): THREE.Group {
    const group = new THREE.Group();
    for (const gate of gates) {
      // The post line runs along lateral, (cos h, -sin h); the gate faces travel.
      const cos = Math.cos(gate.heading);
      const sin = Math.sin(gate.heading);
      for (const side of [-1, 1]) {
        const px = gate.x + cos * gate.halfWidth * side;
        const pz = gate.z - sin * gate.halfWidth * side;
        const groundY = this.terrain.heightAt(px, pz, gate.s);
        const post = new THREE.Mesh(POST_GEOMETRY, POST_MATERIAL);
        post.position.set(px, groundY + POST_CENTRE_Y_M, pz);
        group.add(post);
        const flag = new THREE.Mesh(FLAG_GEOMETRY, FLAG_MATERIAL);
        flag.position.set(
          px + cos * FLAG_OFFSET_M * side,
          groundY + FLAG_CENTRE_Y_M,
          pz - sin * FLAG_OFFSET_M * side,
        );
        // Local +z faces the travel direction, so the flag reads head-on from the road.
        flag.rotation.y = -gate.heading;
        group.add(flag);
      }
    }
    return group;
  }
}
