import * as THREE from 'three';

/**
 * A multi-draw batch's draw list is sent to the GPU only when it changed.
 *
 * Three's `BatchedMesh` culls its instances for every camera that draws it (the frame,
 * each live mirror, each shadow map) and writes the list of instances to draw into its
 * indirect texture, which it then marks for upload: one `texSubImage2D` and its texture
 * parameters per batch per pass, ~100 a frame in the cabin with the mirrors on, whether
 * the list moved or not. Between two frames of the same pass it seldom does: the camera
 * moves a few centimetres and the same instances stay in view. So the list is compared
 * with the one last left to upload and, when it is the same, the texture's version is put
 * back, so the renderer sees nothing to send and draws with what the GPU already holds.
 *
 * Correctness rests on one rule: the version is only ever put back to the version whose
 * contents are the list kept here (`sent`), and a list that differs keeps its new version
 * and becomes the kept one. Whatever the GPU holds at the restored version, the renderer
 * either already uploaded exactly that list or uploads the current one, which is equal.
 * A batch that grows gets a new texture (`setInstanceCount`); the kept list is the old
 * texture's and is not compared against.
 */

/** The private fields of three's `BatchedMesh` this reads (r187), absent from @types/three. */
interface BatchInternals {
  _updateDrawParameters(camera: THREE.Camera, geometry: THREE.BufferGeometry, material: THREE.Material, drawFormat?: string): void;
  readonly _indirectTexture: THREE.DataTexture & { readonly image: { readonly data: Uint32Array } };
  readonly _multiDrawCount: number;
}

/** The list each batch's texture last kept a version for: its length and its instance ids. */
const sent = new WeakMap<object, { texture: THREE.DataTexture; count: number; ids: Uint32Array }>();

function installIndirectUploadSkip(): void {
  // Three's own private method, wrapped in place: its typings do not declare it.
  const proto = THREE.BatchedMesh.prototype as unknown as BatchInternals & { __indirectSkip?: true };
  if (proto.__indirectSkip) return;
  proto.__indirectSkip = true;
  const update = proto._updateDrawParameters;
  proto._updateDrawParameters = function (this: BatchInternals, camera, geometry, material, drawFormat) {
    const texture = this._indirectTexture;
    const version = texture.version;
    const sourceVersion = texture.source.version;
    update.call(this, camera, geometry, material, drawFormat);
    if (texture.version === version) return;
    const count = this._multiDrawCount;
    const data = texture.image.data;
    const last = sent.get(this);
    if (last !== undefined && last.texture === texture && last.count === count) {
      let same = true;
      for (let i = 0; i < count; i++) {
        if (last.ids[i] !== data[i]) {
          same = false;
          break;
        }
      }
      if (same) {
        texture.version = version;
        texture.source.version = sourceVersion;
        return;
      }
    }
    if (last === undefined || last.texture !== texture || last.ids.length < data.length) {
      sent.set(this, { texture, count, ids: data.slice() });
    } else {
      last.count = count;
      last.ids.set(data.subarray(0, count));
    }
  };
}

installIndirectUploadSkip();
