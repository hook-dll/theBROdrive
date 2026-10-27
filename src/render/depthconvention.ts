import * as THREE from 'three';

/**
 * REVERSED-Z DEPTH, AND WHAT THREE r185 LEAVES TO THE GAME.
 *
 * The scene pass draws with a reversed depth buffer wherever the context has
 * EXT_clip_control (core/renderer.ts asks for `reversedDepthBuffer`; three falls back to
 * the ordinary buffer without it, and none of this is installed then). Near is 1 and far
 * is 0, and the scene target's depth is 32-bit float, so a step of depth is about
 * distance x 2^-23 at any range: a tenth of a millimetre at 2 km and under a millimetre
 * at 18 km, where the old 24-bit buffer stepped by metres (2-19 m at 2-5 km, 30-96 m at
 * 10-18 km on the far tiers). Coplanar-ish surfaces far away (a mesa's foot in the
 * vista's ground) stopped fighting.
 *
 * Three handles the projection, the clear value, the shadow cameras and its own depth
 * chunks. Five things it does not, at r185:
 *
 *  - DEPTH FUNCTIONS THAT HAVE NO DIRECTION. Three swaps every depth function for
 *    reversed depth, the symmetric ones included: `AlwaysDepth` becomes `NeverDepth`
 *    and `EqualDepth` becomes `NotEqualDepth` (utils.js `ReversedDepthFuncs`). The
 *    clouds' depth reset (render/clouds.ts, `AlwaysDepth`) then wrote nothing, the
 *    clouds' own nearer depth stayed in the buffer, and the land behind them failed its
 *    test: clouds over the desert and in front of houses (owner, 2026-10-28). Those four
 *    are handed to three pre-swapped here, so its swap gives them back unchanged.
 *  - RENDER ORDER. With reversed depth three sorts every list as usual and then
 *    reverses it whole, `renderOrder` included (mrdoob/three.js#33944): the sky dome
 *    (-10), drawn without depth, would land last and cover the frame. The game's own
 *    sorts keep three's order and only turn the distance term round.
 *  - POLYGON OFFSET UNITS. Three negates `polygonOffsetFactor` for reversed depth but
 *    not the units (fixed upstream after r185, #34606), so every decal's units term
 *    pushed it AWAY from the camera. The material's units are negated here, after
 *    three has set its state, so every authored offset keeps its meaning.
 *  - CAMERAS. Three moves a camera onto the reversed projection when the camera is
 *    first DRAWN, after the frame was culled and sorted with its old matrix, and with an
 *    `updateProjectionMatrix` that would overwrite a mirror's off-axis projection. Every
 *    camera handed to `render` is moved before (`adoptReversedDepth`); a camera that sets
 *    its own matrix (render/mirrorview.ts) is adopted before it is aimed.
 *  - SHADER CHUNKS the game writes or three missed: the PCF shadow bias's sign and the
 *    sun's slope offset (render/lightshader.ts), the haze pass's depth read
 *    (render/hazeshader.ts), the clouds' own depth row and far-plane reset
 *    (render/clouds.ts), the stars and planets at the far plane. Each reads
 *    `USE_REVERSED_DEPTH_BUFFER`, which three defines in every program while the buffer
 *    is reversed: page-lifetime, so no program variant ever appears mid-drive.
 */

/**
 * Puts `camera` on the reversed (or ordinary) depth convention now, rather than at its
 * first draw. Three r185 has only a getter (`Camera.reversedDepth`); the field behind it
 * is what its own renderer and shadow map set.
 */
export function adoptReversedDepth(camera: THREE.Camera, reversed: boolean): void {
  if (camera.reversedDepth === reversed) return;
  // Three r185 keeps the flag in a private field behind its getter.
  const flagged = camera as unknown as { _reversedDepth: boolean };
  flagged._reversedDepth = reversed;
  if (camera instanceof THREE.PerspectiveCamera || camera instanceof THREE.OrthographicCamera) {
    camera.updateProjectionMatrix();
  }
}

/**
 * The fields of a three render item the sorts read. `material.id` is three's own
 * material counter, set on every material at run time, which @types/three omits.
 */
interface SortItem {
  readonly id: number;
  readonly groupOrder: number;
  readonly renderOrder: number;
  readonly material: { readonly id: number };
  readonly materialVariant: number;
  readonly z: number;
}

/**
 * Three's opaque order (`painterSortStable`: group, renderOrder, material, variant, then
 * near to far) for reversed depth, where a larger clip z is the nearer surface.
 */
function opaqueOrder(a: SortItem, b: SortItem): number {
  return a.groupOrder - b.groupOrder
    || a.renderOrder - b.renderOrder
    || a.material.id - b.material.id
    || a.materialVariant - b.materialVariant
    || b.z - a.z
    || a.id - b.id;
}

/** Three's transparent order (`reversePainterSortStable`: far to near) for reversed depth. */
function transparentOrder(a: SortItem, b: SortItem): number {
  return a.groupOrder - b.groupOrder
    || a.renderOrder - b.renderOrder
    || a.z - b.z
    || a.id - b.id;
}

/**
 * The depth functions with no direction, each mapped to the one three r185 swaps it from
 * (`installReversedDepth`).
 */
const SYMMETRIC_PRESWAP = new Map<THREE.DepthModes, THREE.DepthModes>([
  [THREE.AlwaysDepth, THREE.NeverDepth],
  [THREE.NeverDepth, THREE.AlwaysDepth],
  [THREE.EqualDepth, THREE.NotEqualDepth],
  [THREE.NotEqualDepth, THREE.EqualDepth],
]);

/**
 * Installs the game's side of reversed depth on `renderer`; see the file comment. Call
 * once, right after construction, and only when `renderer.capabilities.reversedDepthBuffer`.
 */
export function installReversedDepth(renderer: THREE.WebGLRenderer): void {
  const render = renderer.render.bind(renderer);
  renderer.render = (scene, camera) => {
    adoptReversedDepth(camera, true);
    render(scene, camera);
  };
  // Three reverses each list after sorting it (camera.reversedDepth, which every camera
  // now has): sorted backwards here, the reversal hands back the order wanted.
  renderer.setOpaqueSort((a: SortItem, b: SortItem) => opaqueOrder(b, a));
  renderer.setTransparentSort((a: SortItem, b: SortItem) => transparentOrder(b, a));
  const state = renderer.state;
  const gl = renderer.getContext();
  // Always, Never, Equal and NotEqual mean the same in either direction; three r185 swaps
  // them anyway (Always <-> Never, Equal <-> NotEqual), so they reach it pre-swapped.
  const depth = state.buffers.depth;
  const setFunc = depth.setFunc.bind(depth);
  depth.setFunc = (func) => setFunc(SYMMETRIC_PRESWAP.get(func) ?? func);
  const setMaterial = state.setMaterial.bind(state);
  state.setMaterial = (material, frontFaceCW, hardwareClippingPlanes) => {
    setMaterial(material, frontFaceCW, hardwareClippingPlanes);
    // Three has just set (-factor, units), or left it set from an earlier material
    // with the same values; both terms flip.
    if (material.polygonOffset) gl.polygonOffset(-material.polygonOffsetFactor, -material.polygonOffsetUnits);
  };
}
