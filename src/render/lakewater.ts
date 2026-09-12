import * as THREE from 'three';

import { hashUnit3 } from '../core/rng';
import {
  sampleGroundHeight,
  type DesertTileGenerationContext,
  type GroundHeightSample,
} from '../world/deserttiledata';
import { desertPaletteAt } from '../world/gradient';
import type { WorldOrigin } from '../world/origin';
import type { WorldWorkScheduler } from '../world/workqueue';
import {
  cardMaterial,
  crossedCardGeometry,
  displayColour,
  palmGeometry,
  treeGeometry,
  PALM_TINT,
  TREE_TINT,
} from './mirage-tableau';
import { createWaterMaterial, WAVE_TILE_METRES, type WaterMaterial } from './watermaterial';

/**
 * Rare desert lakes: water standing in a hollow the desert already had.
 *
 * NOTHING HERE TOUCHES THE WORLD, and that is the whole design. An earlier version dug
 * the basin — a deterministic term in `Terrain.relief` — and every consequence cascaded,
 * because that relief is collided ground shared with the tile worker and it lives beside
 * the road's maintained corridor. The dig needed a corridor fade, then a rim-gradient
 * budget against the dune band, then an absolute floor because the landscape tilts
 * across 300 m, then a plateau to carry the tilt, then a 600 m band to spread it, which
 * pushed the site so far out that the road could curve back into its own footprint. Six
 * constraints, each created by the last.
 *
 * This module reads the terrain and writes nothing. `Terrain` is byte-for-byte the
 * road-only world, physics is untouched, the tile worker is untouched, and the only
 * thing that can go wrong is a picture.
 *
 * HOW A LAKE IS FOUND. Every 200-300 km the schedule picks a window of desert beside the
 * road. The window is sampled, the lowest point in it is taken, and the water RISES from
 * there: repeatedly absorb the lowest cell on the frontier, raising the level to meet it,
 * until the flood reaches the window's edge — at which point the basin has spilled and
 * the last level before that is its lip. This is the standard priority flood, and it is
 * the honest definition of "how full can this hollow get": a closed basin fills to its
 * lowest lip, an open slope fills to nothing. Where the desert offers no hollow, there is
 * no lake, and the drive is a little longer to the next one.
 *
 * WHY THE SHORELINE IS WORTH THE TROUBLE. It is BAKED: every vertex carries the water's
 * depth over the ground as an RGBA vertex colour, so the soft edge, the foam strip and
 * the depth tint arrive as vertex data rather than as a shader, a depth read or a second
 * pass. A level plane pushed into sand meets it along a hard line, and that line — not
 * the reflection, not the ripples — is what makes cheap water look cheap. Knowing the
 * boundary exactly is also what lets the grass ring the water instead of the site.
 *
 * WHY IT VANISHES BY APPROACH. The tableaus in mirage-tableau.ts fade when you leave the
 * road, because they straddle it and there is nowhere to go and look. A lake is half a
 * kilometre out: driving to it IS the encounter. So the fade is the approach — full water
 * until the last few dozen metres, gone inside `VANISH_GONE_M` of the waterline, and back
 * when you pull away. No latch: the opacity is a function of where you stand, so it is
 * reversible by construction, and nobody has to write hydrolock, buoyancy or a walk home.
 */

/** Arclength between attempts at a lake. A genuine curiosity, not a landmark. */
const MIN_GAP_M = 200_000;
const GAP_RANGE_M = 100_000;
/**
 * Lateral band the search window is centred on.
 *
 * The near edge of the window must clear `RELIEF_FULL` (200 m, terrain.ts) — the lateral
 * distance at which the dune band is at full strength — for two reasons at once. It keeps
 * the window out of the road's graded corridor, and it makes the whole window "far from
 * the road" in the tile sampler's sense, so the ground can be read without asking
 * `RoadDistance` anything. That second one is not a micro-optimisation: sampling through
 * the road-aware path measured 16 ms on the slice that first touched a region, against a
 * 3 ms budget.
 */
const LATERAL_MIN_M = 520;
const LATERAL_RANGE_M = 420;

/** Half-width of the searched window, and its lattice. */
const SITE_REACH_M = 300;
const SITE_STEP_M = 8;
const SITE_CELLS = Math.round((SITE_REACH_M * 2) / SITE_STEP_M);
const SITE_VERTS = SITE_CELLS + 1;
const SITE_POINTS = SITE_VERTS * SITE_VERTS;
/** Lattice rows sampled per scheduler slice. */
const ROWS_PER_SLICE = 1;

/** Arclength either side of a site at which its water is built and kept. */
const BUILD_LEAD_M = 6_000;

/**
 * What makes a hollow worth filling. Below either of these the site stays dry and the
 * next one is 200 km away, which is the correct outcome: the desert did not offer a lake
 * here and inventing one is how the dug version started.
 */
const MIN_LAKE_AREA_M2 = 12_000;
const MIN_LAKE_DEPTH_M = 1.6;
/**
 * Deepest the water may stand above the hollow's lowest point. A wide interdune basin can
 * accept twenty metres before it spills, and filling it would give a sea that runs off
 * the window rather than a lake you can see the far side of.
 */
const MAX_FILL_M = 7;

/**
 * How far the eye must stand above the water before the sheet is fully drawn. A surface
 * seen from level with itself is a line; seen from under it, it is a coloured filter over
 * the whole screen.
 */
const EYE_ABOVE_WATER_M = 2.5;
/**
 * The approach fade, in metres from the waterline. Abrupt on purpose: the water is there
 * while you drive at it and gone by the time you could put a wheel in it. A long fade
 * would read as a rendering fault rather than as the desert keeping its joke.
 */
const VANISH_GONE_M = 10;
const VANISH_FULL_M = 26;

/**
 * The depth ramp, and it is tuned for the lakes the desert actually makes.
 *
 * A dug basin was 5 m deep and these are 2. On the old numbers — a shore fade of 0.9 m
 * and full colour only at 2.6 — a real lake never left the pale end of the ramp and read
 * as a wash of cyan over sand rather than as water. Everything here is roughly halved so
 * that two metres is deep water, and the shallow end is more transparent so the sand
 * under it shows through instead of being painted over.
 */
const SHORE_FADE_M = 0.45;
const DEEP_FULL_M = 1.3;
/** Width of the foam strip, in metres of depth. */
const FOAM_BAND_M = 0.25;
const FOAM_STRENGTH = 0.8;
const ALPHA_SHALLOW = 0.3;
const ALPHA_DEEP_GAIN = 0.55;
const FOAM_ALPHA = 0.32;

/**
 * The water's colour has to answer to the sand's, because the sand's is not a constant:
 * `desertPaletteAt` walks its hue right around the wheel over the length of the road
 * (gradient.ts), so a fixed teal sinks into the ground at one mileage.
 *
 * WATER IS BLUE FIRST AND DISTINCT SECOND. The complement of the local sand was tried
 * and it is the wrong answer for the same reason it is the obvious one: over the pale
 * green sand at 148 km it produced a violet lake, which is maximally distinct and reads
 * as anything but water. The hue is therefore pinned near `WATER_HUE`, and only when the
 * sand comes within `MIN_HUE_GAP` of it does the water slide away — to the nearer side,
 * by exactly the gap. The sand is blue for about a sixth of the cycle, so this is a fixed
 * blue almost everywhere and a nudged one where it has to be.
 */
const WATER_HUE = 0.54;
const MIN_HUE_GAP = 0.14;
const DEEP_SATURATION = 0.46;
// Dark enough to clear the sand by value as well as by hue, everywhere on the cycle: the
// warm sand at the start of the road is the darkest ground there is, at about 0.37.
const DEEP_LIGHTNESS = 0.16;
const SHALLOW_SATURATION = 0.34;
const SHALLOW_LIGHTNESS = 0.44;
/** Foam is the sand's own hue, nearly white: spray off a shore, not a second water. */
const FOAM_SATURATION = 0.16;
const FOAM_LIGHTNESS = 0.9;

export interface WaterPalette {
  readonly deep: THREE.Color;
  readonly shallow: THREE.Color;
  readonly foam: THREE.Color;
}

/** Signed shortest way round the hue circle from `from` to `to`, in turns. */
function hueDelta(from: number, to: number): number {
  const raw = (to - from + 1) % 1;
  return raw > 0.5 ? raw - 1 : raw;
}

/**
 * The three water colours at a mileage. See `WATER_HUE` for the rule.
 *
 * Allocates, and that is deliberate: this runs once per lake — one per several hundred
 * kilometres — and `desertPaletteAt` carries the same note for the same reason. A shared
 * buffer here would buy nothing and cost an aliasing bug.
 */
export function waterPaletteAt(s: number): WaterPalette {
  const hsl = { h: 0, s: 0, l: 0 };
  const sandHue = new THREE.Color(desertPaletteAt(s).sand).getHSL(hsl).h;
  const toWater = hueDelta(sandHue, WATER_HUE);
  const waterHue =
    Math.abs(toWater) >= MIN_HUE_GAP
      ? WATER_HUE
      : (sandHue + Math.sign(toWater || 1) * MIN_HUE_GAP + 1) % 1;
  return {
    deep: new THREE.Color().setHSL(waterHue, DEEP_SATURATION, DEEP_LIGHTNESS),
    shallow: new THREE.Color().setHSL(waterHue, SHALLOW_SATURATION, SHALLOW_LIGHTNESS),
    foam: new THREE.Color().setHSL(sandHue, FOAM_SATURATION, FOAM_LIGHTNESS),
  };
}

/**
 * The fringe. Grass is the dense part and the reason the shoreline is worth computing
 * exactly; the palms and a few broadleaves are the silhouette that says oasis from a
 * distance. No cacti: they grow all over this desert already, so reading them as a lake
 * fringe made the whole thing look like a texture pack.
 */
const MAX_GRASS = 1_400;
const MAX_PALMS = 120;
const MAX_TREES = 60;
/** Instances per shoreline cell, per form. The ceiling above is only a ceiling. */
const GRASS_PER_CELL = 5;
const PALMS_PER_CELL = 0.5;
const TREES_PER_CELL = 0.24;
/** Metres an instance may wander off its shoreline cell. */
const GRASS_JITTER_M = 2.6;
const PLANT_JITTER_M = 4;
/** Height bands, metres. */
const GRASS_HEIGHT = [0.35, 0.8] as const;
const PALM_HEIGHT = [7, 16] as const;
const TREE_HEIGHT = [6, 13] as const;
/** Dark and unsaturated: reeds at a desert waterhole, not a lawn. */
const GRASS_TINT = displayColour(0x7d9a63);

const SALT_GAP = 0x21b5;
const SALT_SIDE = 0x32c7;
const SALT_LATERAL = 0x43d9;
const SALT_PLANT = 0x54eb;
const SALT_SHAPE = 0x65fd;
const SALT_COLOUR = 0x770f;

/** A scheduled attempt at a lake. Whether one exists there is the terrain's business. */
export interface LakeSite {
  readonly index: number;
  readonly s: number;
  /** Signed lateral offset in `Road.offsetPoint`'s basis; positive is LEFT of travel. */
  readonly lateral: number;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = (value - edge0) / (edge1 - edge0);
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

/**
 * A tuft of coarse grass, authored one unit tall like every other card so an instance's
 * height scales the whole plant. Blades lean out from a common base and lighten toward
 * the tip, which is what stops a dense stand reading as a flat green smear.
 */
function grassTuftGeometry(): THREE.BufferGeometry {
  return crossedCardGeometry((triangle) => {
    const base = displayColour(0x3f5a36);
    const tip = displayColour(0x8fae60);
    const blades: readonly (readonly [number, number, number])[] = [
      [-0.34, 0.74, 0.055],
      [-0.14, 1.0, 0.05],
      [0.05, 0.92, 0.05],
      [0.26, 1.04, 0.045],
      [0.42, 0.7, 0.05],
      [0.14, 0.55, 0.06],
    ];
    for (const [endX, endY, halfWidth] of blades) {
      triangle(-halfWidth, 0, halfWidth, 0, endX, endY, base);
      triangle(
        endX * 0.55 - halfWidth * 0.5,
        endY * 0.55,
        endX * 0.55 + halfWidth * 0.5,
        endY * 0.55,
        endX,
        endY,
        tip,
        -0.002,
      );
    }
  });
}

type Phase =
  | 'idle'
  | 'sampling'
  | 'filling'
  | 'pooling'
  | 'measuring'
  | 'measuring2'
  | 'baking'
  | 'planting'
  | 'ready'
  | 'dry';

export class LakeWater {
  private readonly root = new THREE.Group();
  private readonly geometry = new THREE.BufferGeometry();
  private readonly water: WaterMaterial = createWaterMaterial();
  private readonly grass: THREE.InstancedMesh;
  private readonly palms: THREE.InstancedMesh;
  private readonly trees: THREE.InstancedMesh;
  private readonly fringeMaterials: readonly THREE.MeshBasicMaterial[];
  private readonly siteList: readonly LakeSite[];

  /** One lattice, rewritten per site. A live drive allocates none of this. */
  private readonly heights = new Float32Array(SITE_POINTS);
  private readonly positions = new Float32Array(SITE_POINTS * 3);
  private readonly uvs = new Float32Array(SITE_POINTS * 2);
  private readonly colours = new Float32Array(SITE_POINTS * 4);
  private readonly normals = new Float32Array(SITE_POINTS * 3);
  private readonly indices = new Uint32Array(SITE_CELLS * SITE_CELLS * 6);
  /** 1 where the filled sheet stands. */
  private readonly wet = new Uint8Array(SITE_POINTS);
  /** Metres from each lattice point to the nearest water. See `buildEdgeDistance`. */
  private readonly edgeDistance = new Float32Array(SITE_POINTS);
  /** Priority-flood scratch: the frontier heap and the cells it has absorbed. */
  private readonly heapCell = new Int32Array(SITE_POINTS);
  private readonly heapKey = new Float32Array(SITE_POINTS);
  private readonly absorbed = new Int32Array(SITE_POINTS);
  private readonly seen = new Uint8Array(SITE_POINTS);
  /** Height the water would stand at in each cell if the window drained to its edge. */
  private readonly drainLevel = new Float32Array(SITE_POINTS);
  private readonly shore = new Int32Array(SITE_POINTS);
  private shoreCount = 0;

  private phase: Phase = 'idle';
  private siteIndex = -1;
  private readyIndex = -1;
  private buildRow = 0;
  private centreX = 0;
  private centreZ = 0;
  private waterY = 0;
  private floorY = 0;
  private triangles = 0;
  private wetCells = 0;
  private wetRadius = 0;
  private opacity = 0;
  private readonly ground: GroundHeightSample = { height: 0, detail: 0 };

  private readonly matrix = new THREE.Matrix4();
  private readonly quaternion = new THREE.Quaternion();
  private readonly euler = new THREE.Euler();
  private readonly scratchScale = new THREE.Vector3();
  private readonly scratchPosition = new THREE.Vector3();
  private readonly colour = new THREE.Color();
  private readonly sandColour = new THREE.Color();
  private readonly deepColour = new THREE.Color();
  private readonly shallowColour = new THREE.Color();
  private readonly foamColour = new THREE.Color();
  private readonly hsl = { h: 0, s: 0, l: 0 };

  constructor(
    scene: THREE.Scene,
    private readonly context: DesertTileGenerationContext,
    private readonly origin: WorldOrigin,
  ) {
    const surface = new THREE.Mesh(this.geometry, this.water.material);
    surface.castShadow = false;
    surface.receiveShadow = false;
    surface.frustumCulled = false;
    this.root.add(surface);

    const grassMaterial = cardMaterial();
    const palmMaterial = cardMaterial();
    const treeMaterial = cardMaterial();
    this.fringeMaterials = [grassMaterial, palmMaterial, treeMaterial];
    this.grass = new THREE.InstancedMesh(grassTuftGeometry(), grassMaterial, MAX_GRASS);
    this.palms = new THREE.InstancedMesh(palmGeometry(), palmMaterial, MAX_PALMS);
    this.trees = new THREE.InstancedMesh(treeGeometry(), treeMaterial, MAX_TREES);
    for (const mesh of [this.grass, this.palms, this.trees]) {
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      this.root.add(mesh);
    }

    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('uv', new THREE.BufferAttribute(this.uvs, 2));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colours, 4));
    this.geometry.setAttribute('normal', new THREE.BufferAttribute(this.normals, 3));
    this.geometry.setIndex(new THREE.BufferAttribute(this.indices, 1));
    this.geometry.setDrawRange(0, 0);
    // A flat sheet: one normal for every vertex and the wave map does the rest.
    for (let i = 0; i < SITE_POINTS; i++) this.normals[i * 3 + 1] = 1;

    this.root.visible = false;
    scene.add(this.root);
    this.siteList = this.buildSchedule();
  }

  /** Where a lake is attempted. Deterministic from the seed, like every other encounter. */
  private buildSchedule(): readonly LakeSite[] {
    const seed = this.context.seed;
    const sites: LakeSite[] = [];
    let s = MIN_GAP_M * 0.5 + hashUnit3(seed, -1, SALT_GAP) * GAP_RANGE_M;
    let index = 0;
    while (s < this.context.road.length) {
      const side = hashUnit3(seed, index, SALT_SIDE) < 0.5 ? -1 : 1;
      sites.push({
        index,
        s,
        lateral: side * (LATERAL_MIN_M + hashUnit3(seed, index, SALT_LATERAL) * LATERAL_RANGE_M),
      });
      s += MIN_GAP_M + hashUnit3(seed, index, SALT_GAP) * GAP_RANGE_M;
      index++;
    }
    return sites;
  }

  get sites(): readonly LakeSite[] {
    return this.siteList;
  }

  /** The scheduled site nearest an arclength, or null on an empty road. */
  siteNearest(s: number): LakeSite | null {
    let lo = 0;
    let hi = this.siteList.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.siteList[mid]!.s <= s) lo = mid + 1;
      else hi = mid;
    }
    const before = this.siteList[lo - 1] ?? null;
    const after = this.siteList[lo] ?? null;
    if (before === null) return after;
    if (after === null) return before;
    return s - before.s <= after.s - s ? before : after;
  }

  /**
   * Per rendered frame. `playerX`/`playerY`/`playerZ` are ABSOLUTE world metres;
   * `scheduler` and `frameId` are the shared streaming budget, so the search is sliced
   * exactly like a terrain tile and a lake arriving mid-drive costs no more per frame
   * than the ground under the car does.
   */
  update(
    playerX: number,
    playerY: number,
    playerZ: number,
    playerS: number,
    frameId: number,
    scheduler: WorldWorkScheduler,
    dt: number,
  ): void {
    const site = this.siteNearest(playerS);
    if (site === null || Math.abs(site.s - playerS) > BUILD_LEAD_M) {
      this.root.visible = false;
      this.phase = 'idle';
      this.siteIndex = -1;
      this.readyIndex = -1;
      this.opacity = 0;
      return;
    }

    if (site.index !== this.siteIndex) this.beginSearch(site);
    if (this.phase !== 'idle' && this.phase !== 'ready' && this.phase !== 'dry') {
      scheduler.tryRun(frameId, 'lake-water', () => this.advance());
    }
    if (this.phase !== 'ready' || this.readyIndex !== site.index) {
      this.root.visible = false;
      this.opacity = 0;
      return;
    }

    // TWO fades, and the second one is not decoration. The hollow the lake sits in does
    // not stop at the shoreline: ground outside the pool can lie below the water's level,
    // and standing there puts the eye UNDER a transparent sheet that then fills the
    // screen with turquoise. Measured in the real game on the first drive to one. The
    // surface is only ever drawn to someone standing above it.
    this.opacity =
      smoothstep(VANISH_GONE_M, VANISH_FULL_M, this.waterlineDistance(playerX, playerZ)) *
      smoothstep(this.waterY - 0.2, this.waterY + EYE_ABOVE_WATER_M, playerY);
    this.root.visible = this.opacity > 0.002;
    if (!this.root.visible) return;

    this.water.material.opacity = this.opacity;
    for (const material of this.fringeMaterials) material.opacity = this.opacity;
    this.root.position.set(this.centreX - this.origin.x, 0, this.centreZ - this.origin.z);
    this.water.advance(dt);
  }

  /**
   * Metres from a world position to the nearest water, by lookup into the baked distance
   * field.
   *
   * Outside the window the point is clamped onto the window's edge and the two distances
   * are added, which is a true lower bound and accurate to the lattice. The obvious
   * alternative — radius from the centre minus the furthest water — is neither: a lake
   * lying off to one side of the window makes it read 20 m when the real answer is 400,
   * and the bench caught exactly that as water still fading in from a quarter of a
   * kilometre away.
   */
  waterlineDistance(x: number, z: number): number {
    if (this.phase !== 'ready') return Number.POSITIVE_INFINITY;
    const localX = x - this.centreX;
    const localZ = z - this.centreZ;
    const clampedX = Math.min(SITE_REACH_M, Math.max(-SITE_REACH_M, localX));
    const clampedZ = Math.min(SITE_REACH_M, Math.max(-SITE_REACH_M, localZ));
    const outside = Math.hypot(localX - clampedX, localZ - clampedZ);
    const ix = Math.round((clampedX + SITE_REACH_M) / SITE_STEP_M);
    const iz = Math.round((clampedZ + SITE_REACH_M) / SITE_STEP_M);
    return outside + this.edgeDistance[ix * SITE_VERTS + iz]!;
  }

  private beginSearch(site: LakeSite): void {
    const centre = this.context.road.offsetPoint(site.s, site.lateral);
    this.siteIndex = site.index;
    this.centreX = centre.x;
    this.centreZ = centre.z;
    this.buildRow = 0;
    this.readyIndex = -1;
    this.phase = 'sampling';
    this.root.visible = false;
  }

  /**
   * One slice of the search, sized to the streaming budget. Every stage is its own slice
   * because running them together measured 3.5 ms in a single call against a 3 ms budget
   * — a hitch arriving exactly as the lake does.
   */
  private advance(): void {
    switch (this.phase) {
      case 'sampling':
        this.sampleRows();
        return;
      case 'filling':
        this.fillDepressions();
        this.phase = 'pooling';
        return;
      case 'pooling':
        this.phase = this.keepLargestPool(this.drainLevel) ? 'measuring' : 'dry';
        return;
      case 'measuring':
        this.buildEdgeDistanceForward();
        this.phase = 'measuring2';
        return;
      case 'measuring2':
        this.buildEdgeDistanceBackward();
        this.phase = 'baking';
        return;
      case 'baking':
        this.bakeSurface();
        this.phase = 'planting';
        return;
      case 'planting':
        this.plantFringe();
        this.phase = 'ready';
        this.readyIndex = this.siteIndex;
        return;
      default:
        return;
    }
  }

  private sampleRows(): void {
    const end = Math.min(SITE_VERTS, this.buildRow + ROWS_PER_SLICE);
    const startX = this.centreX - SITE_REACH_M;
    const startZ = this.centreZ - SITE_REACH_M;
    for (let ix = this.buildRow; ix < end; ix++) {
      const worldX = startX + ix * SITE_STEP_M;
      for (let iz = 0; iz < SITE_VERTS; iz++) {
        // The exact drawn ground, through the tiles' own sampler. A second opinion here
        // would put the shoreline a few centimetres off the sand it is cut from.
        //
        // `farFromRoad` is TRUE and that is exact, not an approximation: the whole window
        // sits past `RELIEF_FULL`, where the tile lattice itself stops asking about the
        // road and evaluates the dune band at full strength. See `LATERAL_MIN_M`.
        sampleGroundHeight(this.context, worldX, startZ + iz * SITE_STEP_M, true, this.ground);
        this.heights[ix * SITE_VERTS + iz] = this.ground.height;
      }
    }
    this.buildRow = end;
    if (this.buildRow >= SITE_VERTS) this.phase = 'filling';
  }

  /**
   * Finds every depression in the window, fills them all to their own lips, and keeps the
   * biggest. Reports whether that is a lake worth drawing.
   *
   * PRIORITY FLOOD FROM THE BOUNDARY, which is the textbook depression fill and the one
   * thing here that had to be got right. The first attempt started at the window's lowest
   * cell and rose until it reached an edge — and found NOTHING on fourteen sites in a row,
   * because over sloping desert the lowest cell of a 520 m window is almost always ON the
   * edge, so the flood spilled before it began.
   *
   * Run the other way it is both correct and complete. Seed the queue with every boundary
   * cell at its own height. Pop the lowest; for each unvisited neighbour, the level it
   * would drain at is `max(level of the cell we came from, its own height)` — water cannot
   * escape over ground higher than itself. Where that level stands above a cell's ground,
   * that cell is under water, and the depth is the difference. One pass finds every hollow
   * in the window at once, with the window's edge as the sea the country drains to.
   */
  private fillDepressions(): void {
    this.seen.fill(0);
    let heapSize = 0;

    const push = (cell: number, level: number): void => {
      this.seen[cell] = 1;
      let i = heapSize++;
      while (i > 0) {
        const parent = (i - 1) >> 1;
        if (this.heapKey[parent]! <= level) break;
        this.heapKey[i] = this.heapKey[parent]!;
        this.heapCell[i] = this.heapCell[parent]!;
        i = parent;
      }
      this.heapKey[i] = level;
      this.heapCell[i] = cell;
    };
    let poppedLevel = 0;
    const pop = (): number => {
      const top = this.heapCell[0]!;
      poppedLevel = this.heapKey[0]!;
      heapSize--;
      if (heapSize > 0) {
        const key = this.heapKey[heapSize]!;
        const cell = this.heapCell[heapSize]!;
        let i = 0;
        for (;;) {
          const left = i * 2 + 1;
          if (left >= heapSize) break;
          const right = left + 1;
          const child =
            right < heapSize && this.heapKey[right]! < this.heapKey[left]! ? right : left;
          if (this.heapKey[child]! >= key) break;
          this.heapKey[i] = this.heapKey[child]!;
          this.heapCell[i] = this.heapCell[child]!;
          i = child;
        }
        this.heapKey[i] = key;
        this.heapCell[i] = cell;
      }
      return top;
    };

    for (let i = 0; i < SITE_VERTS; i++) {
      for (const cell of [
        i,
        i + SITE_CELLS * SITE_VERTS,
        i * SITE_VERTS,
        i * SITE_VERTS + SITE_CELLS,
      ]) {
        if (this.seen[cell] === 0) push(cell, this.heights[cell]!);
      }
    }
    // `absorbed` doubles as the drain level of every cell: the height the water would
    // stand at there if the window drained to its own edge.
    const drain = this.drainLevel;
    while (heapSize > 0) {
      const cell = pop();
      const level = poppedLevel;
      drain[cell] = level;
      const ix = (cell / SITE_VERTS) | 0;
      const iz = cell - ix * SITE_VERTS;
      for (let n = 0; n < 4; n++) {
        const nx = ix + (n === 0 ? -1 : n === 1 ? 1 : 0);
        const nz = iz + (n === 2 ? -1 : n === 3 ? 1 : 0);
        if (nx < 0 || nz < 0 || nx > SITE_CELLS || nz > SITE_CELLS) continue;
        const next = nx * SITE_VERTS + nz;
        if (this.seen[next] !== 0) continue;
        push(next, Math.max(level, this.heights[next]!));
      }
    }

  }

  /**
   * Picks the biggest connected pool out of the filled depressions and makes it the lake.
   *
   * Biggest by AREA, not by depth: a deep narrow slot reads as a puddle from the road
   * whatever its bottom is doing, and the window usually holds several hollows at once.
   */
  private keepLargestPool(drain: Float32Array): boolean {
    this.seen.fill(0);
    let bestCount = 0;
    let bestLevel = 0;
    let bestFloor = 0;

    for (let start = 0; start < SITE_POINTS; start++) {
      if (this.seen[start] !== 0 || drain[start]! <= this.heights[start]!) continue;
      // One pool: every connected cell standing under the same drain level.
      let head = 0;
      let tail = 0;
      this.seen[start] = 1;
      this.absorbed[tail++] = start;
      let floor = this.heights[start]!;
      let lip = drain[start]!;
      while (head < tail) {
        const cell = this.absorbed[head++]!;
        if (this.heights[cell]! < floor) floor = this.heights[cell]!;
        if (drain[cell]! > lip) lip = drain[cell]!;
        const ix = (cell / SITE_VERTS) | 0;
        const iz = cell - ix * SITE_VERTS;
        for (let n = 0; n < 4; n++) {
          const nx = ix + (n === 0 ? -1 : n === 1 ? 1 : 0);
          const nz = iz + (n === 2 ? -1 : n === 3 ? 1 : 0);
          if (nx < 0 || nz < 0 || nx > SITE_CELLS || nz > SITE_CELLS) continue;
          const next = nx * SITE_VERTS + nz;
          if (this.seen[next] !== 0 || drain[next]! <= this.heights[next]!) continue;
          this.seen[next] = 1;
          this.absorbed[tail++] = next;
        }
      }
      if (tail > bestCount) {
        bestCount = tail;
        bestLevel = lip;
        bestFloor = floor;
      }
    }
    if (bestCount === 0) return false;

    // Capped, because a broad shallow depression can accept far more than a lake's worth
    // before it spills and would flood the whole window.
    this.floorY = bestFloor;
    this.waterY = Math.min(bestLevel, bestFloor + MAX_FILL_M);

    this.wet.fill(0);
    this.wetCells = 0;
    this.wetRadius = 0;
    for (let vi = 0; vi < SITE_POINTS; vi++) {
      if (drain[vi]! <= this.heights[vi]! || this.heights[vi]! >= this.waterY) continue;
      this.wet[vi] = 1;
      this.wetCells++;
      const ix = (vi / SITE_VERTS) | 0;
      const iz = vi - ix * SITE_VERTS;
      const r = Math.hypot(ix * SITE_STEP_M - SITE_REACH_M, iz * SITE_STEP_M - SITE_REACH_M);
      if (r > this.wetRadius) this.wetRadius = r;
    }

    const area = this.wetCells * SITE_STEP_M * SITE_STEP_M;
    return area >= MIN_LAKE_AREA_M2 && this.waterY - this.floorY >= MIN_LAKE_DEPTH_M;
  }

  /**
   * Distance from every lattice point to the nearest water, in metres, by a two-pass
   * chamfer transform.
   *
   * This is what lets the approach fade key off the WATERLINE rather than off the site
   * centre. A shoreline cut against real dunes is not a circle — it has bays and spits
   * tens of metres deep — and a radial test would make the water vanish while the player
   * was still a hundred metres from it on one bearing and let them drive into it on
   * another.
   */
  private buildEdgeDistanceForward(): void {
    const far = SITE_REACH_M * 4;
    const orth = SITE_STEP_M;
    const diag = SITE_STEP_M * Math.SQRT2;
    for (let vi = 0; vi < SITE_POINTS; vi++) {
      this.edgeDistance[vi] = this.wet[vi] !== 0 ? 0 : far;
    }
    for (let ix = 0; ix < SITE_VERTS; ix++) {
      for (let iz = 0; iz < SITE_VERTS; iz++) {
        const vi = ix * SITE_VERTS + iz;
        let best = this.edgeDistance[vi]!;
        if (ix > 0) best = Math.min(best, this.edgeDistance[vi - SITE_VERTS]! + orth);
        if (iz > 0) best = Math.min(best, this.edgeDistance[vi - 1]! + orth);
        if (ix > 0 && iz > 0) best = Math.min(best, this.edgeDistance[vi - SITE_VERTS - 1]! + diag);
        if (ix > 0 && iz < SITE_CELLS) {
          best = Math.min(best, this.edgeDistance[vi - SITE_VERTS + 1]! + diag);
        }
        this.edgeDistance[vi] = best;
      }
    }
  }

  /** The backward half. Its own slice: the pair together measured 2.88 ms of a 3 ms budget. */
  private buildEdgeDistanceBackward(): void {
    const orth = SITE_STEP_M;
    const diag = SITE_STEP_M * Math.SQRT2;
    for (let ix = SITE_VERTS - 1; ix >= 0; ix--) {
      for (let iz = SITE_VERTS - 1; iz >= 0; iz--) {
        const vi = ix * SITE_VERTS + iz;
        let best = this.edgeDistance[vi]!;
        if (ix < SITE_CELLS) best = Math.min(best, this.edgeDistance[vi + SITE_VERTS]! + orth);
        if (iz < SITE_CELLS) best = Math.min(best, this.edgeDistance[vi + 1]! + orth);
        if (ix < SITE_CELLS && iz < SITE_CELLS) {
          best = Math.min(best, this.edgeDistance[vi + SITE_VERTS + 1]! + diag);
        }
        if (ix < SITE_CELLS && iz > 0) {
          best = Math.min(best, this.edgeDistance[vi + SITE_VERTS - 1]! + diag);
        }
        this.edgeDistance[vi] = best;
      }
    }
  }


  /** Positions, wave UVs and the baked RGBA shoreline for the filled sheet. */
  private bakeSurface(): void {
    const { deep, shallow, foam } = waterPaletteAt(this.siteList[this.siteIndex]!.s);
    const startX = this.centreX - SITE_REACH_M;
    const startZ = this.centreZ - SITE_REACH_M;

    for (let ix = 0; ix < SITE_VERTS; ix++) {
      const localX = -SITE_REACH_M + ix * SITE_STEP_M;
      for (let iz = 0; iz < SITE_VERTS; iz++) {
        const vi = ix * SITE_VERTS + iz;
        const localZ = -SITE_REACH_M + iz * SITE_STEP_M;
        this.positions[vi * 3] = localX;
        this.positions[vi * 3 + 1] = this.waterY;
        this.positions[vi * 3 + 2] = localZ;
        // UVs from ABSOLUTE world position, so the wave field does not slide when the
        // floating origin moves (world/origin.ts).
        this.uvs[vi * 2] = (startX + ix * SITE_STEP_M) / WAVE_TILE_METRES;
        this.uvs[vi * 2 + 1] = (startZ + iz * SITE_STEP_M) / WAVE_TILE_METRES;

        const depth = this.wet[vi] !== 0 ? this.waterY - this.heights[vi]! : 0;
        const shore = smoothstep(0, SHORE_FADE_M, depth);
        const deepness = smoothstep(0, DEEP_FULL_M, depth);
        const surf = (1 - smoothstep(0, FOAM_BAND_M, depth)) * shore;
        const tint = FOAM_STRENGTH * surf;
        const o = vi * 4;
        this.colours[o] =
          (shallow.r + (deep.r - shallow.r) * deepness) * (1 - tint) + foam.r * tint;
        this.colours[o + 1] =
          (shallow.g + (deep.g - shallow.g) * deepness) * (1 - tint) + foam.g * tint;
        this.colours[o + 2] =
          (shallow.b + (deep.b - shallow.b) * deepness) * (1 - tint) + foam.b * tint;
        this.colours[o + 3] = Math.min(
          1,
          shore * (ALPHA_SHALLOW + ALPHA_DEEP_GAIN * deepness) + surf * FOAM_ALPHA,
        );
      }
    }

    // Only quads with a wet corner are drawn: the dry part of the window never reaches
    // the index buffer, so the draw is the lake and not the box it was cut from.
    let io = 0;
    for (let ix = 0; ix < SITE_CELLS; ix++) {
      for (let iz = 0; iz < SITE_CELLS; iz++) {
        const a = ix * SITE_VERTS + iz;
        const b = (ix + 1) * SITE_VERTS + iz;
        const c = a + 1;
        const d = b + 1;
        if (this.wet[a] === 0 && this.wet[b] === 0 && this.wet[c] === 0 && this.wet[d] === 0) {
          continue;
        }
        this.indices[io++] = a;
        this.indices[io++] = c;
        this.indices[io++] = b;
        this.indices[io++] = b;
        this.indices[io++] = c;
        this.indices[io++] = d;
      }
    }
    this.triangles = io / 3;
    this.geometry.setDrawRange(0, io);
    this.geometry.getAttribute('position').needsUpdate = true;
    this.geometry.getAttribute('uv').needsUpdate = true;
    this.geometry.getAttribute('color').needsUpdate = true;
    this.geometry.index!.needsUpdate = true;
    this.geometry.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(0, this.waterY, 0),
      SITE_REACH_M * Math.SQRT2,
    );
  }

  /**
   * The fringe, planted on the waterline.
   *
   * The shoreline is not computed geometrically — it is READ OFF the fill: a lattice cell
   * that is dry with a wet neighbour IS the shore, whatever shape the dunes gave it. The
   * grass then follows every bay and spit, which is the whole reason the boundary was
   * worth knowing exactly.
   */
  private plantFringe(): void {
    this.shoreCount = 0;
    for (let ix = 0; ix < SITE_VERTS; ix++) {
      for (let iz = 0; iz < SITE_VERTS; iz++) {
        const vi = ix * SITE_VERTS + iz;
        if (this.wet[vi] !== 0) continue;
        const wetNeighbour =
          (ix > 0 && this.wet[vi - SITE_VERTS] !== 0) ||
          (ix < SITE_CELLS && this.wet[vi + SITE_VERTS] !== 0) ||
          (iz > 0 && this.wet[vi - 1] !== 0) ||
          (iz < SITE_CELLS && this.wet[vi + 1] !== 0);
        if (wetNeighbour) this.shore[this.shoreCount++] = vi;
      }
    }

    this.fill(this.grass, MAX_GRASS, GRASS_PER_CELL, 0, GRASS_HEIGHT, GRASS_JITTER_M, GRASS_TINT);
    this.fill(this.palms, MAX_PALMS, PALMS_PER_CELL, 1, PALM_HEIGHT, PLANT_JITTER_M, PALM_TINT);
    this.fill(this.trees, MAX_TREES, TREES_PER_CELL, 2, TREE_HEIGHT, PLANT_JITTER_M, TREE_TINT);
  }

  private fill(
    mesh: THREE.InstancedMesh,
    ceiling: number,
    perCell: number,
    form: number,
    heightBand: readonly [number, number],
    jitter: number,
    tint: THREE.Color,
  ): void {
    if (this.shoreCount === 0) {
      mesh.count = 0;
      return;
    }
    // Scaled to the shore there actually is, so a small lake gets a small fringe rather
    // than the same quota standing several deep in one cell.
    const quota = Math.round(Math.min(ceiling, Math.max(1, this.shoreCount * perCell)));
    const seed = this.context.seed;
    for (let i = 0; i < quota; i++) {
      const key = this.siteIndex * 8192 + form * 2048 + i;
      const pick = Math.floor(hashUnit3(seed, key, SALT_PLANT) * this.shoreCount);
      const cell = this.shore[Math.min(this.shoreCount - 1, pick)]!;
      const ix = (cell / SITE_VERTS) | 0;
      const iz = cell - ix * SITE_VERTS;
      const localX =
        -SITE_REACH_M + ix * SITE_STEP_M + (hashUnit3(seed, key, SALT_PLANT + 1) - 0.5) * 2 * jitter;
      const localZ =
        -SITE_REACH_M + iz * SITE_STEP_M + (hashUnit3(seed, key, SALT_PLANT + 2) - 0.5) * 2 * jitter;
      // Its own cell's ground, not a fresh terrain sample: the fringe has to stand on the
      // same surface the shoreline was cut against or it floats above the water.
      const ground = Math.max(this.heights[cell]!, this.waterY);
      const height =
        heightBand[0] + hashUnit3(seed, key, SALT_SHAPE) * (heightBand[1] - heightBand[0]);
      const width = height * (0.82 + hashUnit3(seed, key, SALT_SHAPE + 1) * 0.36);
      const yaw = hashUnit3(seed, key, SALT_SHAPE + 2) * Math.PI;

      this.euler.set(0, yaw, 0);
      this.quaternion.setFromEuler(this.euler);
      this.scratchPosition.set(localX, ground, localZ);
      this.scratchScale.set(width, height, width);
      this.matrix.compose(this.scratchPosition, this.quaternion, this.scratchScale);
      mesh.setMatrixAt(i, this.matrix);
      // The instance colour MULTIPLIES the card palette, so it is a tint near white
      // rather than a second base colour (see mirage-tableau.ts).
      this.colour.copy(tint).multiplyScalar(0.9 + hashUnit3(seed, key, SALT_COLOUR) * 0.2);
      mesh.setColorAt(i, this.colour);
    }
    mesh.count = quota;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  /** Diagnostics for `tools/water.ts` and the dev handle. */
  get ready(): boolean {
    return this.phase === 'ready';
  }
  get phaseName(): string {
    return this.phase;
  }
  get triangleCount(): number {
    return this.triangles;
  }
  get waterLevel(): number {
    return this.waterY;
  }
  /** Lowest ground in the searched window: the bottom of the hollow being filled. */
  get floorLevel(): number {
    return this.floorY;
  }
  get wetCellCount(): number {
    return this.wetCells;
  }
  /** Radius of the furthest water from the window centre, metres. */
  get wetRadiusM(): number {
    return this.wetRadius;
  }
  get shorelineCells(): number {
    return this.shoreCount;
  }
  get fringeCount(): number {
    return this.grass.count + this.palms.count + this.trees.count;
  }
  get currentOpacity(): number {
    return this.opacity;
  }
  get centre(): { readonly x: number; readonly z: number } {
    return { x: this.centreX, z: this.centreZ };
  }
  /**
   * A place to stand and look at the lake: on the road side of the water, back from the
   * shore, on ground that is above the surface.
   *
   * The lake sits wherever the hollow was, which is rarely the middle of the window, and
   * the hollow keeps going past the shoreline — so neither the window's centre nor a
   * fixed radius finds solid ground with a view. This walks out from the water's centre
   * toward the road and stops at the first lattice point that stands clear of the surface
   * and clear of the approach fade. Only the dev jump in main.ts uses it.
   */
  viewpoint(): { readonly x: number; readonly y: number; readonly z: number; readonly yaw: number } | null {
    if (this.phase !== 'ready') return null;
    let wet = 0;
    let sumX = 0;
    let sumZ = 0;
    for (let vi = 0; vi < SITE_POINTS; vi++) {
      if (this.wet[vi] === 0) continue;
      wet++;
      sumX += -SITE_REACH_M + (((vi / SITE_VERTS) | 0) * SITE_STEP_M);
      sumZ += -SITE_REACH_M + ((vi % SITE_VERTS) * SITE_STEP_M);
    }
    if (wet === 0) return null;
    const waterX = this.centreX + sumX / wet;
    const waterZ = this.centreZ + sumZ / wet;
    const road = this.context.road.sampleAt(this.siteList[this.siteIndex]!.s);
    const dirX = road.x - waterX;
    const dirZ = road.z - waterZ;
    const span = Math.hypot(dirX, dirZ) || 1;

    for (let out = VANISH_FULL_M; out <= SITE_REACH_M * 2; out += SITE_STEP_M) {
      const x = waterX + (dirX / span) * out;
      const z = waterZ + (dirZ / span) * out;
      const localX = x - this.centreX;
      const localZ = z - this.centreZ;
      if (Math.abs(localX) > SITE_REACH_M || Math.abs(localZ) > SITE_REACH_M) break;
      const ix = Math.round((localX + SITE_REACH_M) / SITE_STEP_M);
      const iz = Math.round((localZ + SITE_REACH_M) / SITE_STEP_M);
      const groundY = this.heights[ix * SITE_VERTS + iz]!;
      if (groundY < this.waterY + EYE_ABOVE_WATER_M) continue;
      if (this.edgeDistance[ix * SITE_VERTS + iz]! <= VANISH_FULL_M) continue;
      return { x, y: groundY, z, yaw: Math.atan2(waterX - x, waterZ - z) };
    }
    return null;
  }
  get wetMask(): Uint8Array {
    return this.wet;
  }
  get siteHeights(): Float32Array {
    return this.heights;
  }
  static get lattice(): {
    readonly reach: number;
    readonly step: number;
    readonly verts: number;
    readonly cells: number;
    readonly vanishGone: number;
    readonly vanishFull: number;
    readonly minArea: number;
    readonly minDepth: number;
  } {
    return {
      reach: SITE_REACH_M,
      step: SITE_STEP_M,
      verts: SITE_VERTS,
      cells: SITE_CELLS,
      vanishGone: VANISH_GONE_M,
      vanishFull: VANISH_FULL_M,
      minArea: MIN_LAKE_AREA_M2,
      minDepth: MIN_LAKE_DEPTH_M,
    };
  }

  /** Starts a site's search without a scheduler. Only `tools/water.ts` uses this. */
  beginSiteForTest(site: LakeSite): void {
    this.beginSearch(site);
  }
  /** Runs exactly one slice and reports whether the site has settled. */
  advanceForTest(): boolean {
    if (this.phase !== 'ready' && this.phase !== 'dry') this.advance();
    return this.phase === 'ready' || this.phase === 'dry';
  }

  dispose(): void {
    this.geometry.dispose();
    this.water.dispose();
    for (const mesh of [this.grass, this.palms, this.trees]) mesh.geometry.dispose();
    for (const material of this.fringeMaterials) material.dispose();
    this.root.removeFromParent();
  }
}
