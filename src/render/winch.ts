import * as THREE from 'three';
import { HAND_WINCH_ANCHOR_HEIGHT, type HandWinchItem } from '../items/items';
import type { Vehicle } from '../vehicle/vehicle';
import type { WorldOrigin } from '../world/origin';

/**
 * Derived view of one carried winch installation. Physics remains on the chassis;
 * this class only draws the chosen hook, cable and ground stake.
 */
export class WinchRigView {
  private readonly root = new THREE.Group();
  private readonly cable: THREE.Mesh;
  private readonly hook: THREE.Mesh;
  private readonly stake = new THREE.Group();
  private readonly hookPoint = new THREE.Vector3();
  private readonly endPoint = new THREE.Vector3();
  private readonly cableDirection = new THREE.Vector3();
  private readonly cableMidpoint = new THREE.Vector3();

  constructor(
    scene: THREE.Scene,
    private readonly origin: WorldOrigin,
  ) {
    this.cable = new THREE.Mesh(
      new THREE.CylinderGeometry(0.018, 0.018, 1, 10),
      new THREE.MeshStandardMaterial({ color: 0x34383a, metalness: 0.65, roughness: 0.55 }),
    );
    this.hook = new THREE.Mesh(
      new THREE.TorusGeometry(0.075, 0.012, 6, 12, Math.PI * 1.55),
      new THREE.MeshStandardMaterial({ color: 0x72787a, metalness: 0.75, roughness: 0.38 }),
    );
    this.hook.rotation.x = Math.PI / 2;

    const steel = new THREE.MeshStandardMaterial({
      color: 0x6a5d4a,
      metalness: 0.65,
      roughness: 0.55,
    });
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.1, HAND_WINCH_ANCHOR_HEIGHT, 10),
      steel,
    );
    shaft.position.y = HAND_WINCH_ANCHOR_HEIGHT * 0.5;
    shaft.rotation.z = 0.06;
    const eye = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.032, 8, 16), steel);
    eye.rotation.x = Math.PI / 2;
    eye.position.y = HAND_WINCH_ANCHOR_HEIGHT;
    this.stake.add(shaft, eye);

    this.root.add(this.cable, this.hook, this.stake);
    this.root.visible = false;
    scene.add(this.root);
  }

  update(
    item: HandWinchItem | null,
    vehicle: Vehicle | null,
    heldPoint: THREE.Vector3,
  ): void {
    const setup = item?.setup;
    if (!setup || !vehicle) {
      this.root.visible = false;
      return;
    }

    vehicle.winchPoint(setup.x, setup.y, setup.z, this.hookPoint);
    if (setup.stage === 'anchored') {
      this.endPoint.set(
        setup.anchorX - this.origin.x,
        setup.anchorY,
        setup.anchorZ - this.origin.z,
      );
      this.stake.visible = true;
      this.stake.position.copy(this.endPoint);
    } else {
      this.endPoint.copy(heldPoint);
      this.endPoint.y -= 0.2;
      this.stake.visible = false;
    }

    this.hook.position.copy(this.hookPoint);
    this.cableDirection.subVectors(this.endPoint, this.hookPoint);
    const cableLength = this.cableDirection.length();
    this.cableMidpoint.addVectors(this.hookPoint, this.endPoint).multiplyScalar(0.5);
    this.cable.position.copy(this.cableMidpoint);
    this.cable.quaternion.setFromUnitVectors(
      THREE.Object3D.DEFAULT_UP,
      this.cableDirection.multiplyScalar(1 / Math.max(cableLength, 1e-6)),
    );
    this.cable.scale.set(1, cableLength, 1);
    this.root.visible = true;
  }
}
