import * as THREE from 'three';
import type { StickerState } from '../game/state';

/**
 * Stickers drawn on a car's bodywork.
 *
 * The whole progression system is these quads. A delivery earns one, the player
 * aims and sticks it somewhere on the shell, and it never comes off — so the car
 * accumulates a visible history that is always in frame and cannot be edited. No
 * menu, no counter, no HUD: you look at the bonnet.
 *
 * Implementation is deliberately the cheapest thing that works: a small plane
 * parented to the car's render group, offset a millimetre along the surface normal
 * and given `polygonOffset` so it wins the depth fight with the panel underneath.
 * A projected decal geometry would conform to curvature, but at this scale (12 cm
 * on a car-sized shell) a flat quad is indistinguishable and costs one draw call
 * per sticker instead of a mesh rebuild.
 */

/** Sticker size in metres. Big enough to read from the driver's seat. */
const SIZE = 0.12;
/**
 * Lift along the normal. Large enough to beat depth precision on a shell metres
 * from the camera, small enough that it never reads as floating.
 */
const LIFT = 0.004;
const TEXTURE_SIZE = 128;

/** Star, drawn once and shared by every sticker in the session. */
let _starTexture: THREE.CanvasTexture | null = null;
function starTexture(): THREE.CanvasTexture {
  if (_starTexture) return _starTexture;
  const canvas = document.createElement('canvas');
  canvas.width = TEXTURE_SIZE;
  canvas.height = TEXTURE_SIZE;
  const g = canvas.getContext('2d');
  if (!g) throw new Error('2D canvas unavailable for stickers');

  g.clearRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
  const cx = TEXTURE_SIZE / 2;
  const cy = TEXTURE_SIZE / 2;
  const outer = TEXTURE_SIZE * 0.42;
  const inner = outer * 0.42;

  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : inner;
    // Start at -90 degrees so the star points up.
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.closePath();
  g.fillStyle = '#e8dcc4';
  g.fill();
  g.lineWidth = 5;
  g.strokeStyle = '#3a2e24';
  g.stroke();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  _starTexture = tex;
  return tex;
}

let _sharedGeometry: THREE.PlaneGeometry | null = null;
function stickerGeometry(): THREE.PlaneGeometry {
  if (!_sharedGeometry) _sharedGeometry = new THREE.PlaneGeometry(SIZE, SIZE);
  return _sharedGeometry;
}

let _sharedMaterial: THREE.MeshStandardMaterial | null = null;
function stickerMaterial(): THREE.MeshStandardMaterial {
  if (_sharedMaterial) return _sharedMaterial;
  _sharedMaterial = new THREE.MeshStandardMaterial({
    map: starTexture(),
    transparent: true,
    roughness: 0.7,
    metalness: 0,
    // The quad sits a few millimetres off a panel that is metres from the camera;
    // without a depth bias it z-fights along the silhouette.
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    depthWrite: false,
  });
  return _sharedMaterial;
}

/**
 * Builds one sticker mesh, positioned and oriented in the car's local space.
 *
 * The caller parents it to the car's render group, which is why everything here is
 * local: the sticker then rides the chassis for free, including through the render
 * interpolation the car already does.
 */
export function createStickerMesh(sticker: StickerState): THREE.Mesh {
  const mesh = new THREE.Mesh(stickerGeometry(), stickerMaterial());
  mesh.position.set(sticker.x, sticker.y, sticker.z);

  const normal = new THREE.Vector3(sticker.nx, sticker.ny, sticker.nz);
  if (normal.lengthSq() < 1e-6) normal.set(0, 1, 0);
  normal.normalize();

  // A plane's own facing is +Z, so aim that at the surface normal, then spin about
  // it by the recorded roll.
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
  mesh.rotateZ(sticker.roll);
  mesh.position.addScaledVector(normal, LIFT);

  mesh.renderOrder = 2;
  mesh.name = 'sticker';
  return mesh;
}
