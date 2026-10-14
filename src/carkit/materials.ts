/**
 * The kit's materials: one per slot, shared by every kit car's template.
 *
 * Names are the contract with render/carmodel.ts. `paint` is the only name its
 * paint-slot rule accepts (every other name carries glass, lamp, chrome, trim, tyre or
 * wheel), so only the painted shell takes the per-car colour, dirt, scratches and
 * stickers. `glass` is the def's `glassMaterial`. Lamp slots are matched by the mesh
 * names in the def's `lights`.
 *
 * Every slot is double sided: an open door shows the inside of the skin, and a
 * one-sided shell would show the sky through it. Vertex colours carry the many
 * colours of trim and interior in one program and one draw per part.
 *
 * `lamp_glow` is the one unlit slot: the lit face of a cluster's warning lamp and of
 * the courtesy lamp, in its vertex colour at any hour. It is never switched; the rig
 * slides the face out from behind its dark lens (interior.ts), so lighting one is a
 * pose and links no program. Its name carries `lamp`, so the paint rule passes it by.
 */

import * as THREE from 'three';
import { CAR_SURFACE_FINISH } from '../render/materials';
import type { KitSlot } from './builder';

type KitMaterial = THREE.MeshStandardMaterial | THREE.MeshBasicMaterial;

const cache = new Map<KitSlot, KitMaterial>();

function make(slot: KitSlot): KitMaterial {
  const common = { side: THREE.DoubleSide } as const;
  switch (slot) {
    case 'paint':
      return new THREE.MeshStandardMaterial({ ...common, name: 'paint', color: 0xffffff, roughness: 0.45, metalness: 0.1 });
    case 'glass':
      return new THREE.MeshStandardMaterial({ ...common, name: 'glass', color: 0x203746 });
    case 'trim':
      return new THREE.MeshStandardMaterial({ ...common, name: 'trim', vertexColors: true, roughness: 0.75, metalness: 0 });
    case 'chrome':
      return new THREE.MeshStandardMaterial({ ...common, name: 'chrome', ...CAR_SURFACE_FINISH.chrome });
    case 'tyre':
      return new THREE.MeshStandardMaterial({ ...common, name: 'tyre', ...CAR_SURFACE_FINISH.rubber });
    case 'rim':
      return new THREE.MeshStandardMaterial({ ...common, name: 'wheel_rim', ...CAR_SURFACE_FINISH.rim });
    case 'lamp_head':
      return new THREE.MeshStandardMaterial({ ...common, name: 'lamp_head', color: 0xe8eef2, roughness: 0.15, metalness: 0.2 });
    case 'lamp_tail':
    case 'lamp_brake':
      return new THREE.MeshStandardMaterial({ ...common, name: slot, color: 0x8a1410, roughness: 0.25, metalness: 0 });
    case 'lamp_reverse':
      return new THREE.MeshStandardMaterial({ ...common, name: 'lamp_reverse', color: 0xd9dcdc, roughness: 0.2, metalness: 0 });
    case 'lamp_blinker_l':
    case 'lamp_blinker_r':
      return new THREE.MeshStandardMaterial({ ...common, name: slot, color: 0xc8700c, roughness: 0.25, metalness: 0 });
    case 'lamp_inert':
      return new THREE.MeshStandardMaterial({ ...common, name: 'lamp_inert', color: 0x9a2a1c, roughness: 0.3, metalness: 0 });
    case 'lamp_glow':
      return new THREE.MeshBasicMaterial({ ...common, name: 'lamp_glow', vertexColors: true });
  }
}

export function kitMaterial(slot: KitSlot): KitMaterial {
  let material = cache.get(slot);
  if (!material) cache.set(slot, (material = make(slot)));
  return material;
}
