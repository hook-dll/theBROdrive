import * as THREE from 'three';

import { impostorUniforms, setImpostorReach, treeImpostorMaterial } from '../render/look/treeimpostor';

/**
 * THE IMPOSTOR BUFFER: every far tree in view, drawn as one instanced quad each.
 *
 * WHAT THIS MODULE IS, AND WHAT IT IS NOT. The drawing itself — the billboard, the sixteen
 * views, the light, the hand-over from the models — is `render/look/treeimpostor.ts`. This
 * is the part that has to exist because there are hundreds of thousands of them: where an
 * instance's data lives, which of them are drawn this frame, and how a tile arriving in the
 * middle of a drive does not stall the frame it arrives in.
 *
 * THE STORE IS A TEXTURE. Six kilometres of a wood is up to a million trees, and their
 * per-instance data (position, size, species, turn, tint) is 32 MB of attributes that would
 * be rewritten every time a tile arrives. It lives in two FLOAT textures instead, one texel
 * a tree, and the vertex shader fetches its own row by instance index. A tile owns
 * contiguous rows of that store, first-fit, and a freed range is reused.
 *
 * WHAT IS DRAWN, AND WHEN IT IS NOT. The store holds every far tree out to six kilometres
 * all round; drawn whole, the GPU would place all of them every frame to discard the two
 * thirds behind and beside the camera, which is most of the impostors' cost. The draw buffer
 * is the store's tiles that stand in a cone round the view, copied together and rebuilt only
 * when the view has turned or travelled far enough that the cone's margin could be used up.
 *
 * NEVER IN ONE FRAME. The cone holds up to a million impostors, 34 MB; packed and uploaded
 * in one frame that was a 40-110 ms hitch every 40 m of road, which the owner saw as a
 * stutter at 144 Hz. So there are two draw buffers: the front one is drawn while the back
 * one is packed and uploaded a slice at a time, and they swap when it is whole. A tile that
 * arrives meanwhile is appended to the front buffer as it is.
 *
 * The buffers are the module's own GL buffers rather than three's, because three uploads a
 * mesh's attributes only while it draws it: a chunk being filled had to be drawn (with no
 * instances) and a buffer bound to a draw is one the GPU is using, so every write into it
 * waited for the GPU — 8-14 ms, measured. A chunk being filled is now hidden, written only
 * after it has been out of the draw for a few frames, and uploaded here when we choose.
 */

/** Floats per impostor in each of the two instance attributes. */
const A = 4;
/** Impostors packed and uploaded per frame while a repack is under way: 1 MB a frame. */
const PACK_SLICE = 32768;
/**
 * Impostors per draw chunk: 1 MB an attribute. A draw buffer is cut into chunks this size,
 * each its own GPU buffer and draw, because ANGLE on Metal copies a whole buffer the GPU may
 * still be reading before it lets a write into it: a slice written into a 16 MB buffer cost
 * the copy of all 16 MB, 8 ms, every frame of a repack.
 */
const CHUNK = 65536;
/** Texels a row of the store textures. */
const STORE_WIDTH = 1024;
/** Frames a draw buffer stays out of the draw before it is written again. */
const IDLE_FRAMES = 4;

interface DrawChunk {
  readonly geometry: THREE.InstancedBufferGeometry;
  readonly mesh: THREE.Mesh;
  /** Store indices of the impostors it draws. */
  readonly index: Float32Array;
  /** Our own GPU buffer (see `addChunk`), and what of it awaits upload. */
  readonly buf: WebGLBuffer;
  dirtyFrom: number;
  dirtyTo: number;
  count: number;
}

interface DrawSlot {
  readonly chunks: DrawChunk[];
  /** Impostors written, over all its chunks. */
  count: number;
}

interface Range {
  start: number;
  count: number;
  /** The tile's centre, anchor-relative metres, and the radius its trees stand in. */
  x: number;
  z: number;
  r: number;
}

/** A tile this near is drawn whichever way the camera looks. */
const CULL_NEAR_M = 400;
/** Degrees the view may turn, and metres the camera may travel, before a re-cull. */
const RECULL_TURN = (10 * Math.PI) / 180;
const RECULL_MOVE_M = 120;

export class ImpostorField {
  /** Holds both draw buffers' meshes: position it, the pair follows. */
  readonly mesh: THREE.Group;
  private readonly slots: [DrawSlot, DrawSlot];
  private front = 0;
  private frame = 0;
  private swapFrame = -1000;
  private job: { ranges: Range[]; index: number; written: number } | null = null;
  private readonly material: THREE.MeshStandardMaterial;
  private a0: Float32Array;
  private a1: Float32Array;
  private capacity: number;
  private cullDirty = true;
  private cullX = Number.NaN;
  private cullZ = Number.NaN;
  private cullYaw = Number.NaN;
  private highWater = 0;
  private readonly free: Range[] = [];
  private readonly owned = new Map<string, Range>();
  private readonly quad: THREE.BufferGeometry;

  /**
   * `from`, `blend`: the centre and width of the band in which a model hands over to its
   * impostor (render/look/treeglsl.ts). `to`: where a tree of a wood dissolves into the
   * wood's keepers and the haze. `openTo`: where a tree outside a wood does (its tint is
   * stored negative, see world/forest.ts). `keepTo`: how far a wood's own keepers go.
   */
  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    from: number,
    blend: number,
    to: number,
    openTo: number,
    keepTo: number,
  ) {
    this.capacity = 65536;
    this.a0 = new Float32Array(this.capacity * A);
    this.a1 = new Float32Array(this.capacity * A);
    this.data0 = this.storeTexture(this.a0);
    this.data1 = this.storeTexture(this.a1);
    impostorUniforms.uImpData0.value = this.data0;
    impostorUniforms.uImpData1.value = this.data1;
    this.material = treeImpostorMaterial();
    setImpostorReach(from, to, openTo, keepTo);
    this.quad = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
    this.slots = [{ chunks: [], count: 0 }, { chunks: [], count: 0 }];
    this.mesh = new THREE.Group();
    this.mesh.matrixAutoUpdate = false;
    this.mesh.userData.tree = true;
  }

  /**
   * A new chunk for `slot`: its own geometry, mesh and GPU buffers.
   *
   * THE BUFFERS ARE OURS, not three's (`GLBufferAttribute`), for one reason: three uploads a
   * mesh's attributes only while it draws it, so a chunk being filled had to be drawn (with
   * no instances), and a buffer bound to a draw is one the GPU is using: every write into it
   * waited for the GPU, 8-14 ms, measured. Now a chunk being filled is hidden, written only
   * after it has been out of the draw for `IDLE_FRAMES`, and uploaded here (`flush`) when we
   * choose.
   */
  private addChunk(slot: DrawSlot): DrawChunk {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = this.quad.index;
    geometry.setAttribute('position', this.quad.getAttribute('position'));
    geometry.setAttribute('normal', this.quad.getAttribute('normal'));
    geometry.setAttribute('uv', this.quad.getAttribute('uv'));
    const index = new Float32Array(CHUNK);
    const buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, CHUNK * 4, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    const attribute = new THREE.GLBufferAttribute(buf, gl.FLOAT, 1, 4, CHUNK);
    // Read as per-instance by three's binding (it checks the flag, not the class).
    Object.assign(attribute, { isInstancedBufferAttribute: true, meshPerAttribute: 1 });
    geometry.setAttribute('aImpIndex', attribute as unknown as THREE.BufferAttribute);
    geometry.instanceCount = 0;
    // three.js caps an instanced draw at `_maxInstanceCount`, worked out once from the
    // attributes bound at the first draw. Unchecked cast: a real field the typings omit.
    (geometry as THREE.InstancedBufferGeometry & { _maxInstanceCount?: number })._maxInstanceCount = CHUNK;
    const mesh = new THREE.Mesh(geometry, this.material);
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.visible = false;
    this.mesh.add(mesh);
    const chunk = { geometry, mesh, index, buf, dirtyFrom: CHUNK, dirtyTo: 0, count: 0 };
    slot.chunks.push(chunk);
    return chunk;
  }

  /** Uploads what has been written into `slot`'s chunks since the last flush. */
  private flush(slot: DrawSlot): void {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    for (const c of slot.chunks) {
      if (c.dirtyTo <= c.dirtyFrom) continue;
      gl.bindBuffer(gl.ARRAY_BUFFER, c.buf);
      gl.bufferSubData(gl.ARRAY_BUFFER, c.dirtyFrom * 4, c.index, c.dirtyFrom, c.dirtyTo - c.dirtyFrom);
      c.dirtyFrom = CHUNK;
      c.dirtyTo = 0;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  /**
   * Copies `count` impostors of store range `range` from `from` into `slot` at its end,
   * chunk by chunk, marking just what was written for upload. `live`: the slot is being
   * drawn, so its chunks draw what they hold at once.
   */
  private appendTo(slot: DrawSlot, range: Range, from = 0, count = range.count - from, live = false): void {
    let src = range.start + from;
    let left = count;
    while (left > 0) {
      const index = Math.floor(slot.count / CHUNK);
      const chunk = slot.chunks[index] ?? this.addChunk(slot);
      const at = slot.count - index * CHUNK;
      const take = Math.min(left, CHUNK - at);
      for (let k = 0; k < take; k++) chunk.index[at + k] = src + k;
      chunk.dirtyFrom = Math.min(chunk.dirtyFrom, at);
      chunk.dirtyTo = Math.max(chunk.dirtyTo, at + take);
      chunk.count = at + take;
      if (live) {
        chunk.geometry.instanceCount = chunk.count;
        chunk.mesh.visible = true;
      }
      slot.count += take;
      src += take;
      left -= take;
    }
  }

  /** Empties a slot: its chunks draw nothing and are written over from the start. */
  private clearSlot(slot: DrawSlot): void {
    for (const c of slot.chunks) {
      c.count = 0;
      c.geometry.instanceCount = 0;
      c.mesh.visible = false;
    }
    slot.count = 0;
  }

  /** Whether a tile's range stands in the cone the last cull was made for. */
  private inCone(range: Range, camX: number, camZ: number, ux: number, uz: number, cosCone: number): boolean {
    const dx = range.x - camX;
    const dz = range.z - camZ;
    const d = Math.hypot(dx, dz);
    if (d <= CULL_NEAR_M + range.r + RECULL_MOVE_M) return true;
    const cosAt = (dx * ux + dz * uz) / d;
    const spread = Math.asin(Math.min(1, (range.r + RECULL_MOVE_M) / d));
    return Math.acos(Math.max(-1, Math.min(1, cosAt))) - spread <= Math.acos(cosCone);
  }

  private coneUx = 0;
  private coneUz = 1;
  private coneCos = -1;

  /** Packs the next slice of the back buffer; swaps it to the front when whole. */
  private pump(): void {
    const job = this.job;
    if (!job) return;
    const back = this.slots[1 - this.front]!;
    let budget = PACK_SLICE;
    while (budget > 0 && job.index < job.ranges.length) {
      const range = job.ranges[job.index]!;
      const take = Math.min(budget, range.count - job.written);
      this.appendTo(back, range, job.written, take);
      budget -= take;
      job.written += take;
      if (job.written >= range.count) {
        job.index++;
        job.written = 0;
      }
    }
    this.flush(back);
    if (job.index < job.ranges.length) return;
    const front = this.slots[this.front]!;
    for (const c of back.chunks) {
      c.geometry.instanceCount = c.count;
      c.mesh.visible = c.count > 0;
    }
    this.clearSlot(front);
    this.front = 1 - this.front;
    this.swapFrame = this.frame;
    this.job = null;
  }

  has(key: string): boolean {
    return this.owned.has(key);
  }

  /**
   * Writes a tile's impostors. `fill(i, a0, a1, at)` writes impostor `i` of `count` into the
   * two arrays at float offset `at`. `x`/`z` is the tile's centre in the same anchor-relative
   * metres as the impostors, `r` the radius its trees stand in.
   */
  add(
    key: string,
    count: number,
    fill: (i: number, a0: Float32Array, a1: Float32Array, at: number) => void,
    x: number,
    z: number,
    r: number,
  ): void {
    this.remove(key);
    if (count === 0) {
      this.owned.set(key, { start: 0, count: 0, x, z, r });
      return;
    }
    const range = this.allocate(count, x, z, r);
    for (let i = 0; i < count; i++) fill(i, this.a0, this.a1, (range.start + i) * A);
    this.owned.set(key, range);
    // THE RUNS THEMSELVES, NOT THEIR SPAN. A tile is one contiguous run of rows
    // (`allocate` hands back one), so recording the run is enough to upload exactly what
    // changed. Recording `min(start)` and `max(start + count)` instead uploads everything
    // between them, which is a different thing entirely once rows are RECYCLED: a tile
    // placed in a freed low row while another sits at the high-water mark made the span
    // cover every row in between — measured on the bench, 193 rows = 6.05 MB per flush of
    // mostly unchanged data, 3.1-6.5 GB per 20 s of driving, 97% of every byte the frame
    // uploaded, and 52-292 ms frames on ANGLE over Metal.
    this.storeRuns.push([Math.floor(range.start / STORE_WIDTH), Math.floor((range.start + count - 1) / STORE_WIDTH) + 1]);
    // Not into the buffer being drawn: a write into a buffer the GPU may still be reading
    // waits for the GPU (8 ms a write, measured). Into the repack under way, or the next
    // one, which a new tile asks for.
    if (this.job) this.job.ranges.push(range);
    else this.cullDirty = true;
  }

  remove(key: string): void {
    const range = this.owned.get(key);
    if (!range) return;
    this.owned.delete(key);
    if (range.count === 0) return;
    this.free.push({ start: range.start, count: range.count, x: 0, z: 0, r: 0 });
    // Not repacked for: the draw buffers hold copies, and a removed tile is one that has
    // fallen out of the window, far behind; the next repack drops it.
  }

  /**
   * Packs the tiles in view into the draw buffers, when the view has moved enough to need
   * it. Camera position in the impostors' anchor-relative metres; `fx`/`fz` its look
   * direction on the ground; `halfFov` half its horizontal field of view.
   */
  cull(camX: number, camZ: number, fx: number, fz: number, halfFov: number): void {
    this.frame++;
    this.flushStore();
    this.pump();
    const yaw = Math.atan2(fx, fz);
    let turn = Math.abs(yaw - this.cullYaw);
    if (turn > Math.PI) turn = 2 * Math.PI - turn;
    const moved = Math.hypot(camX - this.cullX, camZ - this.cullZ);
    // One repack at a time: a new one starts once the last has swapped in, and not until the
    // buffer it will write into has been out of the draw for a few frames — until the GPU is
    // surely done reading it.
    if (this.job || this.frame - this.swapFrame < IDLE_FRAMES) return;
    if (!this.cullDirty && !(turn > RECULL_TURN) && !(moved > RECULL_MOVE_M)) return;
    this.cullDirty = false;
    this.cullX = camX;
    this.cullZ = camZ;
    this.cullYaw = yaw;
    const flat = Math.hypot(fx, fz) || 1;
    this.coneUx = fx / flat;
    this.coneUz = fz / flat;
    // The cone must still cover the view after the largest turn allowed between culls, and
    // the frames the repack takes.
    this.coneCos = Math.cos(Math.min(Math.PI, halfFov + RECULL_TURN + 0.15));
    const ranges: Range[] = [];
    for (const range of this.owned.values()) {
      if (range.count > 0 && this.inCone(range, camX, camZ, this.coneUx, this.coneUz, this.coneCos)) ranges.push(range);
    }
    this.clearSlot(this.slots[1 - this.front]!);
    this.job = { ranges, index: 0, written: 0 };
    // The first frame: the very first cull has nothing in front to show meanwhile.
    this.pump();
  }

  keys(): IterableIterator<string> {
    return this.owned.keys();
  }

  private allocate(count: number, x: number, z: number, r: number): Range {
    this.free.sort((a, b) => a.start - b.start);
    // Coalesce neighbours so freed rows become one range again.
    for (let i = 0; i < this.free.length - 1; ) {
      const a = this.free[i]!;
      const b = this.free[i + 1]!;
      if (a.start + a.count === b.start) {
        a.count += b.count;
        this.free.splice(i + 1, 1);
      } else {
        i++;
      }
    }
    for (let i = 0; i < this.free.length; i++) {
      const f = this.free[i]!;
      if (f.count < count) continue;
      const range = { start: f.start, count, x, z, r };
      f.start += count;
      f.count -= count;
      if (f.count === 0) this.free.splice(i, 1);
      return range;
    }
    if (this.highWater + count > this.capacity) this.grow(this.highWater + count);
    const range = { start: this.highWater, count, x, z, r };
    this.highWater += count;
    return range;
  }

  private grow(needed: number): void {
    // The store is CPU-side only: the draw chunks never grow.
    let capacity = this.capacity;
    while (capacity < needed) capacity *= 2;
    const a0 = new Float32Array(capacity * A);
    const a1 = new Float32Array(capacity * A);
    a0.set(this.a0);
    a1.set(this.a1);
    this.a0 = a0;
    this.a1 = a1;
    this.capacity = capacity;
    // New textures, uploaded whole by three: rare, the store only grows early on.
    this.data0.dispose();
    this.data1.dispose();
    this.data0 = this.storeTexture(a0);
    this.data1 = this.storeTexture(a1);
    // The material reads the store through the shared uniforms: hand it the new textures.
    impostorUniforms.uImpData0.value = this.data0;
    impostorUniforms.uImpData1.value = this.data1;
    // The new textures are uploaded whole by three, so the runs recorded against the old
    // ones describe nothing.
    this.storeRuns.length = 0;
  }

  private data0: THREE.DataTexture;
  private data1: THREE.DataTexture;
  /**
   * Row runs written since the last upload, as `[y0, y1)` pairs. Cleared by `flushStore`,
   * dropped wholesale when `grow` replaces the textures (which are then uploaded whole).
   */
  private readonly storeRuns: [number, number][] = [];

  private storeTexture(data: Float32Array): THREE.DataTexture {
    const t = new THREE.DataTexture(data, STORE_WIDTH, data.length / A / STORE_WIDTH, THREE.RGBAFormat, THREE.FloatType);
    t.minFilter = THREE.NearestFilter;
    t.magFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.needsUpdate = true;
    // The impostors' own store, not a photograph: read as raw numbers.
    t.colorSpace = THREE.NoColorSpace;
    t.userData.impostorStore = true;
    return t;
  }

  /**
   * Loads the store's rows written since the last call, ONE RECTANGLE PER RUN.
   *
   * A tile is a contiguous run of rows, so a tile costs its own rows (2 rows, 64 KiB, for a
   * five-hundred-tree tile) rather than everything between the lowest and the highest row
   * written this frame. Overlapping and adjacent runs are merged first, and the runs are
   * sorted once per flush: the list holds one entry per tile added, which is a handful per
   * second, not per frame.
   *
   * Once three has made the textures (their first draw), the upload is done by hand, as the
   * grass cache does, so only those rows go up.
   */
  private flushStore(): void {
    if (this.storeRuns.length === 0) return;
    const props = this.renderer.properties;
    const t0 = (props.get(this.data0) as { __webglTexture?: WebGLTexture }).__webglTexture;
    const t1 = (props.get(this.data1) as { __webglTexture?: WebGLTexture }).__webglTexture;
    if (!t0 || !t1) {
      this.data0.needsUpdate = true;
      this.data1.needsUpdate = true;
      this.storeRuns.length = 0;
      return;
    }
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    const state = this.renderer.state;
    state.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    state.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    state.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    state.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
    this.storeRuns.sort((a, b) => a[0] - b[0]);
    let runStart = this.storeRuns[0]![0];
    let runEnd = this.storeRuns[0]![1];
    for (let i = 1; i <= this.storeRuns.length; i++) {
      const next = this.storeRuns[i];
      if (next && next[0] <= runEnd) {
        if (next[1] > runEnd) runEnd = next[1];
        continue;
      }
      for (const [tex, data] of [[t0, this.a0], [t1, this.a1]] as const) {
        state.bindTexture(gl.TEXTURE_2D, tex);
        gl.texSubImage2D(
          gl.TEXTURE_2D,
          0,
          0,
          runStart,
          STORE_WIDTH,
          runEnd - runStart,
          gl.RGBA,
          gl.FLOAT,
          data,
          runStart * STORE_WIDTH * A,
        );
      }
      runStart = next ? next[0] : 0;
      runEnd = next ? next[1] : 0;
    }
    this.storeRuns.length = 0;
  }
}
