import * as THREE from 'three';

import { SURFACES, SurfaceType } from '../core/surfaces';
import type { RoadDistance } from '../world/roaddistance';
import type { Terrain } from '../world/terrain';
import { NEAR_TERRAIN_REACH, TERRAIN_MATERIAL } from '../world/terrainmesh';

/**
 * The distant desert: everything from the edge of the chunked terrain out to the horizon.
 *
 * The chunked mesh cannot do this. It is parameterised on the ROAD — an arclength row and a
 * lateral column per vertex — and that parameterisation dies long before the horizon: on a
 * road with 170 m corners, offset lines at even a couple of kilometres have folded, which is
 * what the fold guard in terrainmesh.ts spends its time discarding. Past about 1.5 km the
 * only sane frame is the world's own.
 *
 * So this is a POLAR grid centred on the camera: concentric rings of `SECTORS` vertices,
 * radii growing geometrically until the spacing hits a cap. Polar is the right topology for
 * exactly one reason — resolution falls off with distance for free, so a ring 25 km out costs
 * the same as one 2 km out while covering forty times the ground. The whole thing is about
 * 4000 vertices for a fifty-kilometre disc, which is less than one chunk of near terrain.
 *
 * It samples `Terrain.openHeight`, the same function the chunked mesh samples, through the
 * same `RoadDistance`. That is what makes the two agree where they meet rather than merely
 * look similar: at any shared point they compute the identical height, and the only
 * difference left is tessellation — a 1.2 km triangle chording a dune field whose longest
 * wavelength is 240 m, which is under ten metres of error at a kilometre and a half away.
 *
 * What makes it worth drawing at all is `Landscape.mountainAt`, gated by lateral distance in
 * terrain.ts. Without mountains the far field is the drivable landscape, whose 140 m of
 * half-range subtends a fifth of a degree at 20 km: a straight horizon, however far you can
 * see. With them there are ranges over a kilometre tall out there, and a draw distance is
 * suddenly worth having.
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
 * Lattice the road distance is interpolated on out here, metres.
 *
 * Coarse on purpose. The only thing distance feeds at this range is the mountains' 7 km
 * ramp, whose gradient is about 30%, so 300 m of interpolation error is 90 m of height —
 * under a degree at the four-to-nine kilometres where the ramp is steepest, and smooth,
 * because bilinear error is a gentle field rather than a seam. The near mesh's 50 m
 * lattice would be a million nodes over this disc, each one a global search over the road.
 */
const DIST_LATTICE = 600;

/**
 * How far the disc is sunk while the chunked mesh is still over it, metres, fading to
 * nothing by `BIAS_FADE`.
 *
 * In the overlap the chunked mesh must win. Both sample the same height function, so they
 * differ only by how their triangles chord it — but that difference has a sign at any
 * given pixel, and where the vista's coarser triangle chords ABOVE the near mesh's fine
 * one it pokes through as a ragged brown patch. Sinking the disc is the cheap fix, and 14 m
 * covers the chord error of a 900 m triangle across a dune field whose tallest band is
 * 10.5 m. The fade ends past 1500 m, where the near mesh has stopped and there is nothing
 * left to lose to.
 */
const INNER_BIAS = 14;
const BIAS_FADE = 2600;

/**
 * Altitude, in metres above the ring's own base, over which distant ground reads as rock
 * rather than sand.
 *
 * Mountains are not made of dune sand and painting them as though they were makes a
 * kilometre-tall range look like a heap of it. The tint is by height alone: cheap, and at
 * this distance nobody can tell it from a real material boundary.
 */
const ROCK_ALTITUDE = 260;

const SAND_LINEAR = new THREE.Color(SURFACES[SurfaceType.Sand].color);
const ROCK_LINEAR = new THREE.Color(SURFACES[SurfaceType.Rock].color);

function smoothstep01(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

export class VistaMesh {
  private readonly mesh: THREE.Mesh;
  private geometry: THREE.BufferGeometry | null = null;

  /** Radius of the disc, metres. Set by the view-distance setting. */
  private outerRadius = 0;
  /** Centre of the disc as last built; NaN until the first build. */
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
    private readonly roadDistance: RoadDistance,
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
    const outer = metres <= NEAR_TERRAIN_REACH ? 0 : metres;
    if (outer === this.outerRadius) return;
    this.outerRadius = outer;
    this.mesh.visible = outer > 0;
    if (outer > 0) this.radii = ringRadii(outer);
    // Force the next update to rebuild whatever the camera has done since.
    this.centreX = Number.NaN;
  }

  /** Rebuilds the disc if the camera has left the patch it was built for. */
  update(cameraX: number, cameraZ: number): void {
    if (this.outerRadius <= 0) return;
    const snapX = Math.round(cameraX / REBUILD_STEP) * REBUILD_STEP;
    const snapZ = Math.round(cameraZ / REBUILD_STEP) * REBUILD_STEP;
    if (snapX === this.centreX && snapZ === this.centreZ) return;
    this.centreX = snapX;
    this.centreZ = snapZ;
    this.build(snapX, snapZ);
  }

  private build(cx: number, cz: number): void {
    const radii = this.radii;
    const rings = radii.length;
    const vertexCount = rings * SECTORS;

    const positions = new Float32Array(vertexCount * 3);
    const colors = new Float32Array(vertexCount * 3);

    for (let r = 0; r < rings; r++) {
      const radius = radii[r]!;
      // Per ring, not per vertex: both only depend on how far out the ring is.
      const bias =
        INNER_BIAS * (1 - smoothstep01((radius - INNER_RADIUS) / (BIAS_FADE - INNER_RADIUS)));
      const withRelief = radius <= RELIEF_RADIUS;
      for (let a = 0; a < SECTORS; a++) {
        const x = cx + this.dirX[a]! * radius;
        const z = cz + this.dirZ[a]! * radius;
        // The disc is centred on the CAMERA and the mountains are gated on distance from
        // the ROAD, so a vertex's ring radius is not its lateral offset and cannot be
        // substituted for it: driving 500 m off-road would otherwise walk the whole
        // mountain range 500 m inward.
        const dist = this.roadDistance.distAt(x, z, DIST_LATTICE);
        const y =
          (withRelief
            ? this.terrain.openHeight(x, z, dist)
            : this.terrain.baseHeight(x, z, dist)) - bias;

        const vi = (r * SECTORS + a) * 3;
        positions[vi] = x;
        positions[vi + 1] = y;
        positions[vi + 2] = z;

        const rock = smoothstep01(y / ROCK_ALTITUDE);
        colors[vi] = SAND_LINEAR.r + (ROCK_LINEAR.r - SAND_LINEAR.r) * rock;
        colors[vi + 1] = SAND_LINEAR.g + (ROCK_LINEAR.g - SAND_LINEAR.g) * rock;
        colors[vi + 2] = SAND_LINEAR.b + (ROCK_LINEAR.b - SAND_LINEAR.b) * rock;
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
    geometry.computeVertexNormals();

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
