import * as THREE from 'three';

/**
 * WHAT KEEPS RAIN OFF THE INSIDE OF A ROOF: a depth map of the sheltering geometry,
 * drawn top-down round the eye.
 *
 * The drops are worked out in the vertex shader with no CPU particle state (see
 * precipitation.ts), so the only place a drop can learn that a roof is over it is a
 * texture. This is the standard answer: an orthographic camera looks straight down at
 * the buildings round the eye, and the depth it writes is the height of the highest
 * sheltering surface at each patch of ground. A drop standing below that height is
 * inside, and vanishes. Nothing else in the world is drawn into it — the rain would
 * not fall through a rock or a tree either, but a map holding every mesh the player
 * can see has to be redrawn for all of them, and the roofs are what the player is
 * actually standing under.
 *
 * The map is centred on the eye but anchored to the world, and redrawn only when the
 * eye has moved a few metres or half a second has passed. Between redraws a drop
 * samples it at its own world position, so the holes stay where the buildings are
 * rather than travelling with the camera.
 *
 * COST. While it is dry, `advance` writes one uniform and returns: no pass, no
 * traversal, no texture fetch worth compiler time in the shader (`uShelterOn` gates
 * it) — measured, nought passes in three seconds of rainless frames. While it rains,
 * one 256x256 pass over the sheltering meshes within 26 m of the eye: 0.58 ms and
 * 16.5k triangles in 46 draw calls at the homestead, twice a second while standing
 * still and once per 3 m travelled.
 */

/**
 * Which layer the sheltering geometry is put on.
 *
 * A layer rather than a second scene or an invisible toggle: three tests every object
 * against the camera's layers during its scene walk, so the map camera sees the roofs
 * and nothing else without touching what the main camera draws. Objects keep their
 * default layer too — `enable`, never `set` — because the main camera, the shadow
 * cameras and every raycast go on finding them.
 */
const SHELTER_LAYER = 12;

/** Texels a side. 256 over the 52 m below: 20 cm of ground per texel, about the size of a drop's own drift. */
const MAP_SIZE = 256;
/**
 * Half the square the map covers, metres. The FAR drop box is +-22 m around the eye,
 * and the extra 4 m is the slack the eye may travel between redraws: a drop keeps
 * sampling its own world position, so the map has to reach further than the box or the
 * rain would come back through the roofs just outside it.
 */
const MAP_HALF_M = 26;
/**
 * How far above the eye the map's near plane sits. Above every drop the boxes hold —
 * the FAR box tops out at 65% of its own height over the eye — and above any roof the
 * eye can be under, so that a roof is never clipped away by the near plane.
 */
const MAP_CEIL_M = 16;
/** How far below that ceiling the map reaches, metres. Past the ground underfoot anywhere the eye can be. */
const MAP_REACH_M = 72;
/** The packing's own near end, just inside the ceiling. */
const MAP_NEAR_M = 0.5;
/** Metres the eye may move, counted over all three axes, before the map is redrawn. */
const REFRESH_MOVE_M = 3;
/**
 * Longest the map may go stale, seconds. It also carries the streaming case: a building
 * that arrives 15 m away while the player stands still has to appear in the map without
 * the player having to move for it.
 */
const REFRESH_INTERVAL_S = 0.5;

/**
 * The map, as the drop shader reads it: the depth of the highest sheltering surface
 * above each patch of ground, and the plan it was drawn over.
 *
 * `unpackRGBAToDepth` comes from three's own `packing` chunk — the same function
 * `MeshDepthMaterial` with `RGBADepthPacking` packs against, so the bit layout cannot
 * drift apart from the pass that wrote it.
 *
 * The map camera looks straight down with its up along -Z, so the texture's u runs with
 * +X and its v against +Z; `uShelterPlan` is ( centre x, centre z, ceiling y, half
 * span ). The depth a texel holds is the distance DOWN from the ceiling, normalized over
 * the map's own near..far.
 */
export const SHELTER_MAP_VERTEX_PARS = /* glsl */ `
uniform sampler2D uShelterMap;
uniform vec4 uShelterPlan;
uniform float uShelterOn;
#include <packing>
/** 0 where a sheltering surface stands over this point and above it, 1 out in the open. */
float shelterFade( vec3 at ) {
  if ( uShelterOn < 0.5 ) return 1.0;
  vec2 uv = vec2( at.x - uShelterPlan.x, uShelterPlan.y - at.z ) / uShelterPlan.w * 0.5 + 0.5;
  // Beyond the map there is no shelter to know about, and the wrap-around texel would lie.
  if ( uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 ) return 1.0;
  float depth = unpackRGBAToDepth( texture2D( uShelterMap, uv ) );
  float occluderY = uShelterPlan.z - ( ${MAP_NEAR_M.toFixed(2)} + depth * ${(MAP_REACH_M - MAP_NEAR_M).toFixed(2)} );
  return step( occluderY, at.y );
}
`;

/**
 * Puts `roots` on the shelter layer, so the map is drawn from them and nothing else.
 *
 * Called where a roof is built rather than assembled by walking the scene: the map has
 * to know what shelters without a rule that guesses from names, and an explicit call at
 * the one place each kind of building is created is what keeps it true.
 */
export function markShelter(...roots: readonly THREE.Object3D[]): void {
  for (const root of roots) {
    root.layers.enable(SHELTER_LAYER);
    root.traverse((object) => object.layers.enable(SHELTER_LAYER));
  }
}

/** Scratch for the clear colour three hands back on loan. */
const clearScratch = new THREE.Color();

export class ShelterMap {
  /** Bound by the precipitation material, and the whole of its interface to it. */
  readonly uniforms: {
    readonly uShelterMap: { value: THREE.Texture };
    readonly uShelterPlan: { value: THREE.Vector4 };
    readonly uShelterOn: { value: number };
  };

  private readonly target: THREE.WebGLRenderTarget;
  private readonly camera: THREE.OrthographicCamera;
  private readonly depthMaterial: THREE.MeshDepthMaterial;
  /** Where the eye stood when the map was last drawn, and the world origin it was drawn under. */
  private readonly drawnAt = new THREE.Vector3(Number.NaN, 0, Number.NaN);
  private readonly drawnOrigin = new THREE.Vector2(Number.NaN, Number.NaN);
  /** Whether the scene's lights have been put on this layer; see `draw`. */
  private lightsMarked = false;
  private age = 0;
  private drawn = false;

  constructor(private readonly scene: THREE.Scene) {
    this.target = new THREE.WebGLRenderTarget(MAP_SIZE, MAP_SIZE, {
      type: THREE.UnsignedByteType,
      // A depth packed into colour has to be read exactly: a filtered texel would be the
      // average of two occluder heights, which is a surface that is not there.
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      generateMipmaps: false,
    });
    this.depthMaterial = new THREE.MeshDepthMaterial({
      depthPacking: THREE.RGBADepthPacking,
      // The underside of a roof is a roof: a panel whose winding faces away from the
      // camera still stands between the drop and the sky.
      side: THREE.DoubleSide,
    });
    this.camera = new THREE.OrthographicCamera(
      -MAP_HALF_M,
      MAP_HALF_M,
      MAP_HALF_M,
      -MAP_HALF_M,
      MAP_NEAR_M,
      MAP_NEAR_M + MAP_REACH_M,
    );
    // Straight down, with the up axis along -Z so that the texture runs as the shader
    // above reads it (u with +X, v against +Z). Looked at once: only the position moves.
    this.camera.up.set(0, 0, -1);
    this.camera.position.set(0, 1, 0);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateMatrixWorld(true);
    this.camera.layers.set(SHELTER_LAYER);
    this.uniforms = {
      uShelterMap: { value: this.target.texture },
      uShelterPlan: { value: new THREE.Vector4(0, 0, 0, MAP_HALF_M) },
      uShelterOn: { value: 0 },
    };
  }

  /**
   * Redraws the map when it is due and does nothing else the rest of the time.
   *
   * `eye` is the camera in scene coordinates; `originX`/`originZ` are the floating
   * origin that scene shares with the absolute world — a rebase moves every mesh in the
   * scene at once and strands the last map rather than merely ageing it.
   *
   * THE ORIGIN IS PASSED, NOT RECONSTRUCTED. It used to arrive as the absolute camera
   * position (`cam + origin`) and be rebuilt here as `absX - eye.x`, then compared for
   * EXACT equality with the origin the last draw was under. `(c + O) - c` is not always
   * `O` in f64: measured with the camera moving 0.3 m a frame across ±1500 m, the rebuilt
   * value changed from one frame to the next on a quarter of all frames (27.4% at
   * O=1000, 21.7% at O=16000; 0% at 5000 and 100000). Each flip drew the map again, with
   * the lights-state churn a redraw drags behind it — about 36 redraws a second in the
   * rain, where the rule is one per 3 m or per half second.
   */
  advance(
    renderer: THREE.WebGLRenderer,
    eye: THREE.Vector3,
    originX: number,
    originZ: number,
    dt: number,
    raining: boolean,
  ): void {
    if (!raining) {
      // Not a redraw that is skipped but a pass that does not exist: with the uniform at
      // zero the drop shader costs one comparison, and there is no draw at all.
      this.uniforms.uShelterOn.value = 0;
      this.drawn = false;
      return;
    }
    this.age += dt;
    const moved = Math.abs(eye.x - this.drawnAt.x) + Math.abs(eye.y - this.drawnAt.y) + Math.abs(eye.z - this.drawnAt.z);
    if (
      this.drawn &&
      originX === this.drawnOrigin.x &&
      originZ === this.drawnOrigin.y &&
      moved < REFRESH_MOVE_M &&
      this.age < REFRESH_INTERVAL_S
    ) {
      return;
    }
    this.draw(renderer, eye);
    this.uniforms.uShelterPlan.value.set(eye.x, eye.z, eye.y + MAP_CEIL_M, MAP_HALF_M);
    this.uniforms.uShelterOn.value = 1;
    this.drawnAt.copy(eye);
    this.drawnOrigin.set(originX, originZ);
    this.age = 0;
    this.drawn = true;
  }

  /**
   * One pass over the sheltering geometry. Everything it borrows from the frame's own
   * rendering — the target, the clear colour, `autoClear`, the scene's override material
   * and background, the shadow maps — is put back before it returns: this runs in the
   * middle of a frame, between the camera update and the main render.
   */
  private draw(renderer: THREE.WebGLRenderer, eye: THREE.Vector3): void {
    // THE PASS MUST SEE THE SAME LIGHTS THE MAIN RENDER DOES, even though it draws none
    // of them. It renders the scene through a camera on `SHELTER_LAYER` alone, and three
    // collects only the lights that camera's layers accept: with none on the layer the
    // pass saw N lights become 0, and the main render that followed turned 0 back into n.
    // `WebGLLights.setup` bumps `lights.state.version` whenever that count changes, so
    // every redraw bumped it twice, and every lit material then failed
    // `lightsStateVersion === lights.state.version` in the main render and had its
    // parameters and program cache key rebuilt (`setProgram`). Nothing recompiled and
    // nothing changed on screen; it was pure per-material bookkeeping on every redraw
    // while it rains. Marking the lights is free — the layer is added, so they stay on
    // layer 0 and the main render is untouched — and it makes the two passes agree.
    if (!this.lightsMarked) {
      this.lightsMarked = true;
      this.scene.traverse((object) => {
        if ((object as THREE.Light).isLight) object.layers.enable(SHELTER_LAYER);
      });
    }
    this.camera.position.set(eye.x, eye.y + MAP_CEIL_M, eye.z);
    this.camera.updateMatrixWorld(true);

    const previousTarget = renderer.getRenderTarget();
    const previousOverride = this.scene.overrideMaterial;
    const previousBackground = this.scene.background;
    const previousAutoClear = renderer.autoClear;
    const previousShadowAutoUpdate = renderer.shadowMap.autoUpdate;
    const previousClear = renderer.getClearColor(clearScratch);
    const previousClearAlpha = renderer.getClearAlpha();

    renderer.autoClear = false;
    // The map has no shadows of its own, and a second shadow pass per frame is exactly
    // the kind of cost that would make this not worth having. The main render later in
    // the frame still sees the flag it left and rebuilds them as usual.
    renderer.shadowMap.autoUpdate = false;
    // The sky is not part of the map, and a colour background would repaint the target
    // after the clear below.
    this.scene.background = null;
    this.scene.overrideMaterial = this.depthMaterial;
    renderer.setRenderTarget(this.target);
    // White is where the packing puts the far end of the map — "nothing over this
    // ground, all the way down" — which is what an empty texel has to mean. Its r is the
    // most significant byte of the packed depth, so it is the r that has to be 1: a clear
    // to black is a clear to the near end, i.e. to a roof at the ceiling, and hides every
    // drop in the world. Measured by reading the target back and decoding it.
    renderer.setClearColor(0xffffff, 1);
    renderer.clear(true, true, true);
    renderer.render(this.scene, this.camera);

    renderer.setRenderTarget(previousTarget);
    renderer.setClearColor(previousClear, previousClearAlpha);
    renderer.autoClear = previousAutoClear;
    renderer.shadowMap.autoUpdate = previousShadowAutoUpdate;
    this.scene.background = previousBackground;
    this.scene.overrideMaterial = previousOverride;
  }
}
