import * as THREE from 'three';

import { desertPaletteAt } from '../world/gradient';
import type { WorldOrigin } from '../world/origin';
import type { Terrain } from '../world/terrain';
import { TERRAIN_MATERIAL } from '../world/terrainmesh';

/**
 * The fine, player-centred desert tiles own the ground around the camera. This polar
 * mesh begins inside their outer edge and carries only the distant view: concentric
 * rings whose spacing grows with distance, about four thousand vertices for a
 * twenty-five-kilometre disc.
 *
 * Mountains are deliberately camera-relative horizon scenery. `Terrain.horizonHeight`
 * gates them on ring radius, not distance from the road, so leaving the road never turns
 * a visual range into physical terrain: the vista advances and the ranges remain remote.
 * Inside that gate it samples the same landscape and dune relief as the fine tiles; the
 * overlap differs only by tessellation and the downward bias described below.
 */

/**
 * Inner radius, metres — deliberately far inside the chunked mesh rather than just inside
 * it.
 *
 * The obvious value is a little under the chunked mesh's own 1500 m reach, and it is not
 * enough. That mesh is not a solid sheet out there: its fold guard drops every cell whose
 * road-normal parameterisation has turned over, and on a 170 m corner at a kilometre and a
 * half of lateral offset that is a lot of cells. At the default view distance the fog eats
 * the gaps; thin the fog for a long view and they are windows onto the sky. Starting the
 * disc at 400 m puts it behind all of them, and behind the camera being far off-road when
 * the disc was last rebuilt, so the worst case is ground fourteen metres low.
 *
 * The rings this adds are the cheap ones — under two thousand vertices, all of them hidden
 * under the near mesh wherever it is intact.
 */
const INNER_RADIUS = 400;
/**
 * Radial spacing growth, and the cap it grows into.
 *
 * Geometric alone puts a 3.2 km gap at the outer edge of a 25 km disc, and the mountain
 * field's shorter band is 6.5 km, so a range arrives as two facets and reads as a folded
 * sheet — the same failure the near mesh's ring caps exist to prevent, at fifty times the
 * scale. The cap was 1200 m first and a 1400 m range at 12 km still drew as a slab with a
 * flat top; 900 puts a dozen rings across a range instead of eight.
 */
const RADIAL_RATIO = 1.13;
const MAX_RING_SPACING = 900;
/**
 * Vertices per ring. At 25 km this is a 980 m arc, which matches the radial cap, so the
 * triangles stay roughly isotropic where the detail is. Close in it is finer than it needs
 * to be and that costs nothing worth measuring.
 */
const SECTORS = 160;
/**
 * Ring radius past which the dune relief is dropped (see `Terrain.baseHeight`).
 *
 * Comfortably outside the overlap with the chunked mesh, which ends at 1500 m: inside that
 * band the two MUST sample the identical function or the seam shows. Outside it, relief is
 * four fractal fields buying 9 m dunes at four kilometres, which is a third of a pixel.
 */
const RELIEF_RADIUS = 3500;

/**
 * How far the camera moves before the disc is rebuilt, metres.
 *
 * Small enough that the inner hole never leaves the near terrain, large enough that a
 * rebuild is a few times a minute at road speed. Rebuilding is cheap in vertices; what it
 * costs is nearest-road-distance nodes, and those are cached absolutely, so every rebuild
 * after the first only pays for the fringe it has newly uncovered.
 */
const REBUILD_STEP = 250;


/**
 * The fine square is guaranteed to reach 480 m from the camera. Sink the polar mesh
 * just enough to prevent coarse triangles poking through in that overlap, then recover
 * the exact shared field before the fine square can end.
 */
const INNER_BIAS = 2;
const BIAS_FADE = 480;

/**
 * Altitude, in metres above the ring's own base, over which distant ground reads as rock
 * rather than sand.
 *
 * Mountains are not made of dune sand and painting them as though they were makes a
 * kilometre-tall range look like a heap of it. The tint is by height alone: cheap, and at
 * this distance nobody can tell it from a real material boundary.
 */
const ROCK_ALTITUDE = 260;

/** Palette scratch colours, set once per disc rebuild from `desertPaletteAt`. */
const sandLinear = new THREE.Color();

function smoothstep01(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

export class VistaMesh {
  private readonly mesh: THREE.Mesh;
  private geometry: THREE.BufferGeometry | null = null;

  /** Radius of the disc, metres. Set by the view-distance setting. */
  private outerRadius = 0;
  /**
   * Centre of the disc as last built, in the RELATIVE frame; NaN until the first
   * build. Kept relative on purpose: `update` receives the relative camera, and a
   * rebase shifts that relative camera by a whole `REBASE_STEP` (at least 1000 m),
   * which is always more than `REBUILD_STEP`, so the rebuild gate below trips on
   * its own and the disc is rebuilt for the new origin with no explicit rebase
   * handling and no `Rebasable` bookkeeping.
   */
  private centreX = Number.NaN;
  private centreZ = Number.NaN;

  /** Ring radii for the current outer radius, rebuilt only when that changes. */
  private radii: number[] = [];
  /** Unit direction per sector, so a rebuild does no trigonometry. */
  private readonly dirX = new Float32Array(SECTORS);
  private readonly dirZ = new Float32Array(SECTORS);

  constructor(
    private readonly scene: THREE.Scene,
    private readonly terrain: Terrain,
    private readonly origin: WorldOrigin,
  ) {
    for (let a = 0; a < SECTORS; a++) {
      const theta = (a / SECTORS) * Math.PI * 2;
      this.dirX[a] = Math.sin(theta);
      this.dirZ[a] = Math.cos(theta);
    }
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), TERRAIN_MATERIAL);
    // The disc is centred on the camera and spans the whole view; a bounding-sphere
    // test can only ever say yes, so skip it.
    this.mesh.frustumCulled = false;
    // Nothing this far away casts or receives a shadow the shadow map can resolve, and
    // including it would stretch the cascade over fifty kilometres.
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  /**
   * Sets the draw distance. `metres` at or below the chunked mesh's own reach turns the
   * disc off entirely rather than drawing a degenerate ring of it, which is what the
   * lowest view-distance tier wants: that tier is the world as it was before this existed.
   */
  setViewDistance(metres: number): void {
    const outer = metres <= INNER_RADIUS ? 0 : metres;
    if (outer === this.outerRadius) return;
    this.outerRadius = outer;
    this.mesh.visible = outer > 0;
    if (outer > 0) this.radii = ringRadii(outer);
    // Force the next update to rebuild whatever the camera has done since.
    this.centreX = Number.NaN;
  }

  /** Rebuilds the disc if the camera has left the patch it was built for. */
  update(cameraX: number, cameraZ: number, s: number): void {
    if (this.outerRadius <= 0) return;
    const snapX = Math.round(cameraX / REBUILD_STEP) * REBUILD_STEP;
    const snapZ = Math.round(cameraZ / REBUILD_STEP) * REBUILD_STEP;
    if (snapX === this.centreX && snapZ === this.centreZ) return;
    this.centreX = snapX;
    this.centreZ = snapZ;
    this.build(snapX, snapZ, s);
  }

  private build(cx: number, cz: number, s: number): void {
    const radii = this.radii;
    const rings = radii.length;
    const vertexCount = rings * SECTORS;
    // Vertices are stored relative to the floating origin, while every terrain field
    // remains a function of absolute world coordinates.
    const ox = this.origin.x;
    const oz = this.origin.z;

    const positions = new Float32Array(vertexCount * 3);
    const colors = new Float32Array(vertexCount * 3);
    // The whole disc shares one palette sample, taken at the camera's arclength:
    // the palette cycles over 4 000 km, so a single s across the disc is exact to
    // the eye and matches the near desert at the horizon line.
    const palette = desertPaletteAt(s);
    sandLinear.setHex(palette.sand);

    for (let r = 0; r < rings; r++) {
      const radius = radii[r]!;
      // Per ring, not per vertex: both only depend on how far out the ring is.
      const bias =
        INNER_BIAS * (1 - smoothstep01((radius - INNER_RADIUS) / (BIAS_FADE - INNER_RADIUS)));
      const withRelief = radius <= RELIEF_RADIUS;
      for (let a = 0; a < SECTORS; a++) {
        const x = cx + this.dirX[a]! * radius;
        const z = cz + this.dirZ[a]! * radius;
        const y = this.terrain.horizonHeight(x + ox, z + oz, radius, withRelief) - bias;

        const vi = (r * SECTORS + a) * 3;
        positions[vi] = x;
        positions[vi + 1] = y;
        positions[vi + 2] = z;

        colors[vi] = sandLinear.r;
        colors[vi + 1] = sandLinear.g;
        colors[vi + 2] = sandLinear.b;
      }
    }

    // Quads between consecutive rings, wrapping in the angular direction. Wrapping rather
    // than duplicating the seam column keeps the two sides of it numerically identical,
    // which is the difference between a seamless disc and a hairline crack from the camera
    // to the horizon.
    const index = new Uint32Array((rings - 1) * SECTORS * 6);
    let o = 0;
    for (let r = 0; r < rings - 1; r++) {
      const inner = r * SECTORS;
      const outer = inner + SECTORS;
      for (let a = 0; a < SECTORS; a++) {
        const b = (a + 1) % SECTORS;
        index[o] = inner + a;
        index[o + 1] = outer + a;
        index[o + 2] = inner + b;
        index[o + 3] = outer + a;
        index[o + 4] = outer + b;
        index[o + 5] = inner + b;
        o += 6;
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
    const normals = new Float32Array(positions.length);
    for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));

    this.geometry?.dispose();
    this.geometry = geometry;
    this.mesh.geometry = geometry;
  }

  /** Vertices in the current disc, for the perf bench. */
  get vertexCount(): number {
    return this.radii.length * SECTORS;
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.geometry?.dispose();
    this.geometry = null;
  }
}

/**
 * Ring radii from the inner edge to `outer`: geometric growth until the spacing reaches
 * the cap, then constant. The last ring is forced onto `outer` exactly, so the disc's
 * silhouette is a circle rather than a polygon whose radius depends on where the
 * progression happened to land.
 */
function ringRadii(outer: number): number[] {
  const radii = [INNER_RADIUS];
  let r = INNER_RADIUS;
  while (r < outer) {
    r += Math.min(r * (RADIAL_RATIO - 1), MAX_RING_SPACING);
    if (r >= outer) break;
    radii.push(r);
  }
  radii.push(outer);
  return radii;
}
