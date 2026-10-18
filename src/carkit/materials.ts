/**
 * The kit's materials: a whole car is ONE opaque material and its glass.
 *
 * A part is still built in slots (builder.ts `KitSlot`: paint, trim, chrome, tyre, rim,
 * each lamp role, the lit faces, glass), one mesh per slot, but every slot but the glass
 * draws with the same material: what makes a slot what it is goes into its vertices
 * (`finishKitSurfaces`), so the loader can merge a car into one mesh per material
 * (render/kitdraw.ts) and draw it in one call. The far traffic mesh reads the same bytes
 * (render/farcars.ts, `CAR_SURFACE_ATTRIBUTE`).
 *
 * Per vertex:
 *  - `color`: the slot's colour, or, on a slot that takes vertex colours (trim, the lit
 *    faces, livery paint), the colour it was built in;
 *  - `CAR_SURFACE_ATTRIBUTE`: paint share (only paint and livery paint take the car's
 *    dirt, scratches and stickers, and only paint its colour), roughness, metalness and
 *    lamp role (a lens lit by its role, `CAR_LAMP_INERT` for one nothing switches,
 *    `CAR_LAMP_UNLIT` for a lit face drawn in its own colour at any hour: a cluster's
 *    warning lamp is lit by sliding it out from behind its dark lens, interior.ts, so
 *    lighting one is a pose and links no program; `CAR_LAMP_LIVERY` for livery paint).
 *
 * Names are the contract with render/carmodel.ts. `kit-body` passes its paint-slot rule,
 * so every car gets its own copy of the one material (its paint, `kit` variant of
 * `makeCarBodyConditionMaterial`). `glass` is the def's `glassMaterial`. Lamps are found by
 * the mesh names in the def's `lights` (names.ts `KIT_LAMP_NODES`).
 *
 * Both are double sided: an open door shows the inside of the skin, and a one-sided shell
 * would show the sky through it.
 */

import * as THREE from 'three';
import { MATERIALS_CONFIG } from '../config';
import { CAR_LAMP_INERT, CAR_LAMP_LIVERY, CAR_LAMP_UNLIT, CAR_SURFACE_ATTRIBUTE, CAR_SURFACE_FINISH } from '../render/materials';
import type { KitSlot } from './builder';

/** What one slot is: its colour and finish, and what kind of surface. */
export interface KitSlotFinish {
  readonly color: number;
  readonly roughness: number;
  readonly metalness: number;
  /** Takes the colour each vertex was built in, not `color`. */
  readonly vertexColors: boolean;
  /** 0, or the lamp role (`CAR_SURFACE_ATTRIBUTE`). */
  readonly lamp: number;
}

const finish = (color: number, roughness: number, metalness: number, lamp = 0, vertexColors = false): KitSlotFinish => ({
  color,
  roughness,
  metalness,
  vertexColors,
  lamp,
});

/**
 * Every slot but the glass. The paint's colour is the car's and its finish the one every
 * car's paint gets (render/materials.ts `makeCarPaintFinishMaterial`); the far mesh reads
 * the finish from these bytes.
 */
export const KIT_SLOT_FINISH: Readonly<Record<Exclude<KitSlot, 'glass'>, KitSlotFinish>> = {
  paint: finish(0xffffff, MATERIALS_CONFIG.paintRoughness, MATERIALS_CONFIG.paintMetalness),
  // The paint in the colour each vertex was built in (a police car's white doors and their
  // lettering, police.ts): the paint's finish and wear, never the car's colour.
  livery: finish(0xffffff, MATERIALS_CONFIG.paintRoughness, MATERIALS_CONFIG.paintMetalness, CAR_LAMP_LIVERY, true),
  trim: finish(0xffffff, 0.75, 0, 0, true),
  chrome: finish(CAR_SURFACE_FINISH.chrome.color, CAR_SURFACE_FINISH.chrome.roughness, CAR_SURFACE_FINISH.chrome.metalness),
  tyre: finish(CAR_SURFACE_FINISH.rubber.color, CAR_SURFACE_FINISH.rubber.roughness, CAR_SURFACE_FINISH.rubber.metalness),
  rim: finish(CAR_SURFACE_FINISH.rim.color, CAR_SURFACE_FINISH.rim.roughness, CAR_SURFACE_FINISH.rim.metalness),
  lamp_head: finish(0xe8eef2, 0.15, 0.2, 1),
  lamp_tail: finish(0x8a1410, 0.25, 0, 2),
  lamp_brake: finish(0x8a1410, 0.25, 0, 3),
  lamp_reverse: finish(0xd9dcdc, 0.2, 0, 4),
  lamp_blinker_l: finish(0xc8700c, 0.25, 0, 5),
  lamp_blinker_r: finish(0xc8700c, 0.25, 0, 6),
  lamp_inert: finish(0x9a2a1c, 0.3, 0, CAR_LAMP_INERT),
  lamp_glow: finish(0xffffff, 1, 0, CAR_LAMP_UNLIT, true),
};

let bodyMaterial: THREE.MeshStandardMaterial | null = null;
let glassMaterial: THREE.MeshStandardMaterial | null = null;

/** The one material of every kit slot but the glass. */
export function kitBodyMaterial(): THREE.MeshStandardMaterial {
  bodyMaterial ??= new THREE.MeshStandardMaterial({
    name: 'kit-body',
    color: 0xffffff,
    vertexColors: true,
    roughness: MATERIALS_CONFIG.paintRoughness,
    metalness: MATERIALS_CONFIG.paintMetalness,
    side: THREE.DoubleSide,
  });
  return bodyMaterial;
}

/** The panes' material; the loader puts its own clear glass in its place. */
export function kitGlassMaterial(): THREE.MeshStandardMaterial {
  glassMaterial ??= new THREE.MeshStandardMaterial({ name: 'glass', color: 0x203746, side: THREE.DoubleSide });
  return glassMaterial;
}

const _color = new THREE.Color();

/**
 * Writes every built mesh's slot into its vertices (see the file comment) and gives it
 * the one material, or the glass. Runs once the car's geometry is final: the passes before
 * it (holes, leans, flat runs) rewrite positions and the build colours.
 */
export function finishKitSurfaces(root: THREE.Object3D): void {
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    const slot = mesh.userData.kitSlot as KitSlot | undefined;
    if (!mesh.isMesh || !slot) return;
    const geometry = mesh.geometry;
    if (slot === 'glass') {
      geometry.deleteAttribute('color');
      mesh.material = kitGlassMaterial();
      return;
    }
    const look = KIT_SLOT_FINISH[slot];
    const count = geometry.getAttribute('position').count;
    const built = geometry.getAttribute('color');
    const colors = new Float32Array(count * 3);
    _color.setHex(look.color);
    for (let i = 0; i < count; i++) {
      colors[i * 3] = look.vertexColors ? built.getX(i) : _color.r;
      colors[i * 3 + 1] = look.vertexColors ? built.getY(i) : _color.g;
      colors[i * 3 + 2] = look.vertexColors ? built.getZ(i) : _color.b;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const surface = new Uint8Array(count * 4);
    const bytes = [slot === 'paint' || slot === 'livery' ? 255 : 0, Math.round(look.roughness * 255), Math.round(look.metalness * 255), look.lamp];
    for (let i = 0; i < count; i++) surface.set(bytes, i * 4);
    geometry.setAttribute(CAR_SURFACE_ATTRIBUTE, new THREE.BufferAttribute(surface, 4, true));
    mesh.material = kitBodyMaterial();
  });
}
