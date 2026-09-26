import * as THREE from 'three';

import { hashUnit3 } from '../core/rng';
import {
  sampleGroundHeight,
  type DesertTileGenerationContext,
  type GroundHeightSample,
} from '../world/deserttiledata';
import { desertPaletteAt } from '../world/gradient';
import type { LakeSite } from '../world/lakes';
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
 * Desert lakes: the water that stands in a basin, drawn by reading the ground.
 *
 * THE HOLLOW IS NOT THIS MODULE'S. `world/lakes.ts` digs it — a deterministic term in
 * the terrain, in the collided mesh and in the tile worker — and this module finds it,
 * fills it and draws the surface. That division is why the water can be a reader: it
 * samples the tiles' own ground function, so the shoreline is cut from exactly the sand
 * that is drawn, and nothing here can move the world.
 *
 * It was tried the other way, with no dig at all: search for a closed depression the
 * dune field happened to leave. It found one every third attempt, and what it found was
 * broad and two metres deep — filled, that is not a lake, it is painted sand. The dune
 * band is built from kilometre-long ridges; it does not make bowls.
 *
 * HOW A LAKE IS FILLED. Every 200-300 km (and once at the house) the schedule names a
 * window of desert beside the road. The window is sampled, then a priority flood runs
 * from its EDGE inward: pop the lowest frontier cell, and the level a neighbour would
 * drain at is `max(level we came from, its own height)` — water cannot escape over
 * ground higher than itself. One pass finds every hollow at once with the window's edge
 * as the sea the country drains to, and the dug basin is the deepest of them. It is also
 * still honest about ground it did not dig: where there is no hollow there is no water.
 *
 * WHY THE SHORELINE IS WORTH THE TROUBLE. It is BAKED: every vertex carries the water's
 * depth over the ground as an RGBA vertex colour, so the soft edge, the foam strip and
 * the depth tint arrive as vertex data rather than as a shader, a depth read or a second
 * pass. A level plane pushed into sand meets it along a hard line, and that line — not
 * the reflection, not the ripples — is what makes cheap water look cheap. Knowing the
 * boundary exactly is also what lets the grass ring the water instead of the site.
 *
 * IT DOES NOT VANISH. In the desert this water was a mirage by design: it evaporated in
 * the last ten metres of the approach, on the mirage tableaus' own fade band. On the
 * Russian plain a pond is a pond — the owner drove up to one and watched it disappear,
 * which read as a bug, not as a desert trick. The surface is drawn whenever the eye is
 * above it; the only fade left is the eye-height guard below.
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
 * The band the eye height fades the sheet over, around the water's own level.
 *
 * Its only job: ground outside the pool can lie below the water's level, and an eye
 * UNDER the transparent sheet sees the screen fill with turquoise. So the sheet goes
 * only once the eye is actually at or below the surface. It used to start 1.2 m above
 * it, which on the plain's shallow ponds — whose rims sit at the water's own height —
 * took the pond away from a driver standing on the bank: a mirage again, by another road.
 */
const EYE_ABOVE_WATER_M = 0.1;
const EYE_BELOW_WATER_M = 0.3;
/**
 * Where the dev jump in app/devtools.ts parks to look at a lake. Nothing to do with the fade any
 * more: the water is fully drawn from a couple of metres out, so the standoff is only
 * about seeing the whole sheet and its fringe at once.
 */
const VIEWPOINT_STANDOFF_M = 90;

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
// Countryside: a pond on the plain has reeds and willow round it, never palms. The
// forest's own planting stands the trees; the palm fringe is the desert oasis's.
const PALMS_PER_CELL = 0;
// Nor the desert tableau's card trees: they are the mirage's own silhouettes and read as
// such beside a real pond. The forest planting and the stream banks' willows stand here.
const TREES_PER_CELL = 0;
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
  | 'baking3'
  | 'planting'
  | 'planting2'
  | 'planting3'
  | 'ready'
  | 'dry';

/**
 * The fringe's card geometries: one set for every sheet, because every pool in this
 * country is planted with the same reeds.
 */
const GRASS_CARD = grassTuftGeometry();
const PALM_CARD = palmGeometry();
const TREE_CARD = treeGeometry();

/**
 * One basin's finished sheet: its water, its fringe, and the field the fade is read off.
 *
 * WHY A SHEET OUTLIVES ITS SEARCH. The search is one machine with one set of scratch
 * lattices and it runs for one basin at a time — but a village pond and a lake can stand a
 * kilometre apart on the same road (the home lake and the first village are 1.6 km apart),
 * so two basins sit inside `BUILD_LEAD_M` for kilometres of driving. While only the basin
 * the machine was serving could be drawn, the second basin's search hid the first basin's
 * water: the sheet vanished the moment the player's arclength passed the midpoint between
 * them and did not come back. A settled basin is data, so it is kept — its own geometry,
 * its own fringe and its own field — until its basin leaves the reach.
 */
class BasinSheet {
  readonly group = new THREE.Group();
  readonly geometry = new THREE.BufferGeometry();
  readonly water: WaterMaterial = createWaterMaterial();
  readonly grass: THREE.InstancedMesh;
  readonly palms: THREE.InstancedMesh;
  readonly trees: THREE.InstancedMesh;
  private readonly fringeMaterials: readonly THREE.MeshBasicMaterial[];

  /** The lattice this basin settled with, at full size: the fade and the dev view read it. */
  readonly heights = new Float32Array(SITE_POINTS);
  readonly wet = new Uint8Array(SITE_POINTS);
  readonly edgeDistance = new Float32Array(SITE_POINTS);
  readonly positions = new Float32Array(SITE_POINTS * 3);
  readonly uvs = new Float32Array(SITE_POINTS * 2);
  readonly colours = new Float32Array(SITE_POINTS * 4);
  indices = new Uint32Array(0);

  centreX = 0;
  centreZ = 0;
  waterY = 0;
  floorY = 0;
  triangles = 0;
  wetCells = 0;
  wetRadius = 0;
  shoreCount = 0;
  opacity = 0;

  constructor(readonly site: LakeSite) {
    const surface = new THREE.Mesh(this.geometry, this.water.material);
    surface.castShadow = false;
    surface.receiveShadow = false;
    surface.frustumCulled = false;
    this.group.add(surface);

    const grassMaterial = cardMaterial();
    const palmMaterial = cardMaterial();
    const treeMaterial = cardMaterial();
    this.fringeMaterials = [grassMaterial, palmMaterial, treeMaterial];
    this.grass = new THREE.InstancedMesh(GRASS_CARD, grassMaterial, MAX_GRASS);
    this.palms = new THREE.InstancedMesh(PALM_CARD, palmMaterial, MAX_PALMS);
    this.trees = new THREE.InstancedMesh(TREE_CARD, treeMaterial, MAX_TREES);
    for (const mesh of [this.grass, this.palms, this.trees]) {
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      this.group.add(mesh);
    }

    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('uv', new THREE.BufferAttribute(this.uvs, 2));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colours, 4));
    // A flat sheet: one normal for every vertex and the wave map does the rest.
    const normals = new Float32Array(SITE_POINTS * 3);
    for (let i = 0; i < SITE_POINTS; i++) normals[i * 3 + 1] = 1;
    this.geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    this.geometry.setDrawRange(0, 0);
    this.group.visible = false;
  }

  /** Back where the floating origin now is: the group holds the sheet's own centre. */
  place(originX: number, originZ: number): void {
    this.group.position.set(this.centreX - originX, 0, this.centreZ - originZ);
  }

  setOpacity(opacity: number): void {
    this.opacity = opacity;
    this.water.material.opacity = opacity;
    for (const material of this.fringeMaterials) material.opacity = opacity;
    this.group.visible = opacity > 0.002;
  }

  dispose(): void {
    this.geometry.dispose();
    this.water.dispose();
    for (const mesh of [this.grass, this.palms, this.trees]) mesh.dispose();
    for (const material of this.fringeMaterials) material.dispose();
    this.group.removeFromParent();
  }
}

/**
 * The search's slices are sized by TIME, not by a chosen number of rows.
 *
 * The search is admitted by the shared streaming scheduler, whose contract is a
 * millisecond budget for the rendered frame — and one 76-point row of the lattice is not a
 * millisecond-sized unit: `sampleGroundHeight` costs 36 µs away from the road, so a row is
 * 1.3-3.6 ms on its own, and the worst slice measured 10.80 ms in `tools/water.ts` against
 * a 3 ms budget. A fixed rows-per-slice also sizes the slice for whichever machine
 * happened to be measuring. So every stage below runs until a deadline and leaves its
 * cursor where it stopped: a fast machine does more per frame and the lake arrives sooner,
 * a slow one does less and the frame stays whole.
 */
const SLICE_BUDGET_MS = 2.5;

export class LakeWater {
  /**
   * Everything the lake draws, under one node: each basin's sheet is a child group, so a
   * rebase or a teardown walks one subtree rather than a list of them.
   */
  private readonly root = new THREE.Group();
  private readonly siteList: readonly LakeSite[];
  /** Basins in reach this frame, nearest first. Reused: a drive allocates none of this. */
  private readonly reachable: LakeSite[] = [];
  /** Settled basins by schedule index, until their basin leaves the reach. */
  private readonly sheets = new Map<number, BasinSheet>();
  /** Sites that were searched and held no lake. A basin is attempted once, not per frame. */
  private readonly drySites = new Set<number>();
  /** The basin the search machine is working on. */
  private searchSite: LakeSite | null = null;
  /** The site the machine last looked at and refused: what the dev seek advances past. */
  private lastDry: LakeSite | null = null;
  /** The sheet the search is building, between the pool being chosen and the fringe. */
  private sheet: BasinSheet | null = null;
  /** The player's arclength, for the accessors that describe the basin being served. */
  private lastPlayerS = Number.NaN;

  /** One lattice, rewritten per site. A live drive allocates none of this. */
  private readonly heights = new Float32Array(SITE_POINTS);
  private readonly positions = new Float32Array(SITE_POINTS * 3);
  private readonly uvs = new Float32Array(SITE_POINTS * 2);
  private readonly colours = new Float32Array(SITE_POINTS * 4);
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
  /** Cursors: where each stage stopped when its slice ran out. */
  private sampleRow = 0;
  private sampleCol = 0;
  private seedCursor = 0;
  private heapSize = 0;
  private poppedLevel = 0;
  private poolReset = false;
  private poolScan = 0;
  private poolHead = 0;
  private poolTail = 0;
  private poolFloor = 0;
  private poolLip = 0;
  private bestCount = 0;
  private bestLevel = 0;
  private bestFloor = 0;
  private wetCursor = 0;
  private scanCursor = 0;
  private bakeCursor = 0;
  private quadRow = 0;
  private quadCol = 0;
  private indexCount = 0;
  private plantCursor = 0;
  private shoreCursor = 0;

  /** Arclength of the site being searched: the hint the far ground sampler needs. */
  private siteS = 0;
  private centreX = 0;
  private centreZ = 0;
  private waterY = 0;
  private floorY = 0;
  private triangles = 0;
  private wetCells = 0;
  private wetRadius = 0;
  private readonly ground: GroundHeightSample = { height: 0, detail: 0, water: 0 };

  private readonly matrix = new THREE.Matrix4();
  private readonly quaternion = new THREE.Quaternion();
  private readonly euler = new THREE.Euler();
  private readonly scratchScale = new THREE.Vector3();
  private readonly scratchPosition = new THREE.Vector3();
  private readonly colour = new THREE.Color();

  constructor(
    scene: THREE.Scene,
    private readonly context: DesertTileGenerationContext,
    private readonly origin: WorldOrigin,
  ) {
    this.siteList = context.terrain.basins.schedule;
    this.root.visible = false;
    scene.add(this.root);
  }

  /**
   * THE SCHEDULE IS THE TERRAIN'S, not this module's.
   *
   * The basin is dug (`world/lakes.ts`), so the ground and the water have to be
   * talking about the same site: one list, owned by the thing that shapes the ground,
   * read by the thing that fills it.
   */

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
   *
   * EVERY basin in `BUILD_LEAD_M` is drawn, not only the nearest: a basin that has settled
   * keeps its sheet whether or not the machine has moved on to another one.
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
    this.lastPlayerS = playerS;

    // The basins in reach, nearest first. `BUILD_LEAD_M` and the schedule's own spacing
    // bound this at a handful; the sort is over that handful, not over the schedule.
    this.reachable.length = 0;
    let lo = 0;
    let hi = this.siteList.length;
    const from = playerS - BUILD_LEAD_M;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.siteList[mid]!.s < from) lo = mid + 1;
      else hi = mid;
    }
    for (let i = lo; i < this.siteList.length; i++) {
      const site = this.siteList[i]!;
      if (site.s > playerS + BUILD_LEAD_M) break;
      this.reachable.push(site);
    }
    if (this.reachable.length > 1) {
      this.reachable.sort((a, b) => Math.abs(a.s - playerS) - Math.abs(b.s - playerS));
    }

    // A basin that has left the reach gives up its sheet: holding every lake ever passed
    // would be a leak, and none of them can be seen from `BUILD_LEAD_M` away.
    if (this.sheets.size > 0) {
      for (const [index, sheet] of this.sheets) {
        if (Math.abs(sheet.site.s - playerS) <= BUILD_LEAD_M) continue;
        this.sheets.delete(index);
        sheet.dispose();
      }
    }

    // A search whose basin has left the reach dies with it. Its cursors are abandoned, not
    // finished: the verdict would be for a basin nobody can see, and completing it would
    // clobber the scratch the next basin needs.
    if (this.searchSite !== null && Math.abs(this.searchSite.s - playerS) > BUILD_LEAD_M) {
      this.searchSite = null;
      this.sheet = null;
      this.phase = 'idle';
    }
    // A settled or refused site frees the machine for the next basin in reach.
    if (this.searchSite !== null && (this.sheets.has(this.searchSite.index) || this.phase === 'dry')) {
      this.searchSite = null;
    }
    if (this.searchSite === null) {
      const next = this.reachable.find(
        (site) => !this.sheets.has(site.index) && !this.drySites.has(site.index),
      );
      if (next) this.beginSearch(next);
    }
    if (this.searchSite !== null) {
      scheduler.tryRun(frameId, 'lake-water', (deadlineMs) => this.advance(deadlineMs));
    }

    // Draw every settled basin in reach. The fade is per sheet, because the basins stand at
    // different levels: ground outside one pool's shoreline can lie below its surface while
    // the other's is metres away, and a shared opacity would hide one of them outright.
    for (const sheet of this.sheets.values()) {
      const opacity = smoothstep(
        sheet.waterY - EYE_BELOW_WATER_M,
        sheet.waterY + EYE_ABOVE_WATER_M,
        playerY,
      );
      sheet.place(this.origin.x, this.origin.z);
      sheet.setOpacity(opacity);
      if (sheet.group.visible) sheet.water.advance(dt);
    }
  }

  /**
   * The basin the dev and test accessors describe: the one the machine is serving, or —
   * with no search in flight — the last one it settled.
   */
  private primarySheet(): BasinSheet | null {
    if (this.searchSite !== null) {
      const sheet = this.sheets.get(this.searchSite.index);
      if (sheet) return sheet;
    }
    let last: BasinSheet | null = null;
    for (const sheet of this.sheets.values()) last = sheet;
    return last;
  }

  /**
   * Metres from a world position to the nearest water, by lookup into the baked distance
   * field of the nearest sheet.
   *
   * Outside the window the point is clamped onto the window's edge and the two distances
   * are added, which is a true lower bound and accurate to the lattice. The obvious
   * alternative — radius from the centre minus the furthest water — is neither: a lake
   * lying off to one side of the window makes it read 20 m when the real answer is 400,
   * and the bench caught exactly that as water still fading in from a quarter of a
   * kilometre away.
   */
  waterlineDistance(x: number, z: number): number {
    let best = Number.POSITIVE_INFINITY;
    for (const sheet of this.sheets.values()) {
      const localX = x - sheet.centreX;
      const localZ = z - sheet.centreZ;
      const clampedX = Math.min(SITE_REACH_M, Math.max(-SITE_REACH_M, localX));
      const clampedZ = Math.min(SITE_REACH_M, Math.max(-SITE_REACH_M, localZ));
      // BILINEAR, not nearest. The lattice is 8 m and the whole approach fade is 10, so a
      // nearest-sample lookup handed the fade a staircase with two treads in it - which is
      // exactly the two-step vanish this fade exists to avoid. Interpolating a distance
      // field is safe for the same reason it is in world/roaddistance.ts: the field is
      // 1-Lipschitz, so the interpolant can never overshoot the true distance by more than
      // the cell it was read from.
      const outside = Math.hypot(localX - clampedX, localZ - clampedZ);
      const fx = (clampedX + SITE_REACH_M) / SITE_STEP_M;
      const fz = (clampedZ + SITE_REACH_M) / SITE_STEP_M;
      const ix = Math.min(SITE_CELLS - 1, Math.max(0, Math.floor(fx)));
      const iz = Math.min(SITE_CELLS - 1, Math.max(0, Math.floor(fz)));
      const tx = fx - ix;
      const tz = fz - iz;
      const d = sheet.edgeDistance;
      const d00 = d[ix * SITE_VERTS + iz]!;
      const d10 = d[(ix + 1) * SITE_VERTS + iz]!;
      const d01 = d[ix * SITE_VERTS + iz + 1]!;
      const d11 = d[(ix + 1) * SITE_VERTS + iz + 1]!;
      const near = d00 + (d10 - d00) * tx;
      const far = d01 + (d11 - d01) * tx;
      const distance = outside + near + (far - near) * tz;
      if (distance < best) best = distance;
    }
    return best;
  }

  private beginSearch(site: LakeSite): void {
    const centre = this.context.road.offsetPoint(site.s, site.lateral);
    this.searchSite = site;
    this.lastDry = null;
    this.siteS = site.s;
    this.centreX = centre.x;
    this.centreZ = centre.z;
    this.sheet = null;
    this.shoreCount = 0;
    this.resetCursors();
    this.phase = 'sampling';
  }

  /** Every stage's cursor back to its start, for a new basin. */
  private resetCursors(): void {
    this.sampleRow = 0;
    this.sampleCol = 0;
    this.seedCursor = 0;
    this.heapSize = 0;
    this.poolReset = false;
    this.poolScan = 0;
    this.poolHead = 0;
    this.poolTail = 0;
    this.bestCount = 0;
    this.bestLevel = 0;
    this.bestFloor = 0;
    this.wetCursor = 0;
    this.scanCursor = 0;
    this.bakeCursor = 0;
    this.quadRow = 0;
    this.quadCol = 0;
    this.indexCount = 0;
    this.plantCursor = 0;
    this.shoreCursor = 0;
  }

  /**
   * One slice of the search, running until the scheduler's deadline.
   *
   * Every stage leaves its cursor where it stopped, so a slice is exactly as long as the
   * budget allows and no longer. Running the stages together measured 3.5 ms in a single
   * call against a 3 ms budget, and a fixed rows-per-slice put the worst at 10.80 ms.
   */
  private advance(deadlineMs: number): void {
    switch (this.phase) {
      case 'sampling':
        this.sampleRows(deadlineMs);
        return;
      case 'filling':
        this.fillDepressions(deadlineMs);
        return;
      case 'pooling': {
        if (!this.keepLargestPool(deadlineMs)) return;
        const enough =
          this.bestCount > 0 &&
          this.wetCells * SITE_STEP_M * SITE_STEP_M >= MIN_LAKE_AREA_M2 &&
          this.waterY - this.floorY >= MIN_LAKE_DEPTH_M;
        if (enough) {
          this.phase = 'measuring';
          return;
        }
        // Remembered, not merely reported: a basin with no hollow is a verdict about the
        // world, so it must not be re-searched every time the player comes round again.
        this.drySites.add(this.searchSite!.index);
        this.lastDry = this.searchSite;
        this.phase = 'dry';
        return;
      }
      case 'measuring':
        this.buildEdgeDistanceForward(deadlineMs);
        return;
      case 'measuring2':
        this.buildEdgeDistanceBackward(deadlineMs);
        return;
      case 'baking':
        if (this.bakeVertices(deadlineMs)) this.phase = 'baking3';
        return;
      case 'baking3':
        if (this.bakeQuads(deadlineMs)) this.phase = 'planting';
        return;
      case 'planting':
        this.findShore(deadlineMs);
        return;
      case 'planting2':
        if (this.plantGrass(deadlineMs)) this.phase = 'planting3';
        return;
      case 'planting3':
        if (this.plantWoody(deadlineMs)) {
          this.finishSheet();
          this.phase = 'ready';
        }
        return;
      default:
        return;
    }
  }

  /**
   * Ground for the whole window, through the tiles' own sampler.
   *
   * A second opinion here would put the shoreline a few centimetres off the sand it is cut
   * from.
   *
   * `farFromRoad` is TRUE and that is exact, not an approximation: the whole window sits
   * past `RELIEF_FULL`, where the tile lattice itself stops asking about the road and
   * evaluates the dune band at full strength. See `LATERAL_MIN_M`.
   */
  private sampleRows(deadlineMs: number): void {
    const startX = this.centreX - SITE_REACH_M;
    const startZ = this.centreZ - SITE_REACH_M;
    while (this.sampleRow < SITE_VERTS) {
      const worldX = startX + this.sampleRow * SITE_STEP_M;
      while (this.sampleCol < SITE_VERTS) {
        sampleGroundHeight(
          this.context,
          worldX,
          startZ + this.sampleCol * SITE_STEP_M,
          true,
          this.ground,
          this.siteS,
        );
        this.heights[this.sampleRow * SITE_VERTS + this.sampleCol] = this.ground.height;
        this.sampleCol++;
        // Checked per SAMPLE, not per row: one row is 1.3-3.6 ms on this machine, which is
        // more than the whole frame budget the scheduler gave this slice.
        if (performance.now() >= deadlineMs) return;
      }
      this.sampleCol = 0;
      this.sampleRow++;
    }
    this.phase = 'filling';
  }

  /**
   * Finds every depression in the window, fills them all to their own lips, and lets
   * `keepLargestPool` pick one.
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
  private fillDepressions(deadlineMs: number): void {
    if (this.seedCursor === 0) {
      this.seen.fill(0);
      this.heapSize = 0;
    }
    // The boundary ring's four sides, seeded across as many slices as it takes.
    while (this.seedCursor < SITE_VERTS) {
      const i = this.seedCursor;
      for (const cell of [
        i,
        i + SITE_CELLS * SITE_VERTS,
        i * SITE_VERTS,
        i * SITE_VERTS + SITE_CELLS,
      ]) {
        if (this.seen[cell] === 0) this.heapPush(cell, this.heights[cell]!);
      }
      this.seedCursor++;
      if (performance.now() >= deadlineMs) return;
    }
    // `drainLevel` is the height the water would stand at in each cell if the window
    // drained to its own edge.
    const drain = this.drainLevel;
    while (this.heapSize > 0) {
      const cell = this.heapPop();
      const level = this.poppedLevel;
      drain[cell] = level;
      const ix = (cell / SITE_VERTS) | 0;
      const iz = cell - ix * SITE_VERTS;
      for (let n = 0; n < 4; n++) {
        const nx = ix + (n === 0 ? -1 : n === 1 ? 1 : 0);
        const nz = iz + (n === 2 ? -1 : n === 3 ? 1 : 0);
        if (nx < 0 || nz < 0 || nx > SITE_CELLS || nz > SITE_CELLS) continue;
        const next = nx * SITE_VERTS + nz;
        if (this.seen[next] !== 0) continue;
        this.heapPush(next, Math.max(level, this.heights[next]!));
      }
      if (performance.now() >= deadlineMs) return;
    }
    this.phase = 'pooling';
  }

  private heapPush(cell: number, level: number): void {
    this.seen[cell] = 1;
    let i = this.heapSize++;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.heapKey[parent]! <= level) break;
      this.heapKey[i] = this.heapKey[parent]!;
      this.heapCell[i] = this.heapCell[parent]!;
      i = parent;
    }
    this.heapKey[i] = level;
    this.heapCell[i] = cell;
  }

  /** Pops the lowest cell, leaving its own level in `poppedLevel`. */
  private heapPop(): number {
    const top = this.heapCell[0]!;
    this.poppedLevel = this.heapKey[0]!;
    this.heapSize--;
    if (this.heapSize > 0) {
      const key = this.heapKey[this.heapSize]!;
      const cell = this.heapCell[this.heapSize]!;
      let i = 0;
      for (;;) {
        const left = i * 2 + 1;
        if (left >= this.heapSize) break;
        const right = left + 1;
        const child =
          right < this.heapSize && this.heapKey[right]! < this.heapKey[left]! ? right : left;
        if (this.heapKey[child]! >= key) break;
        this.heapKey[i] = this.heapKey[child]!;
        this.heapCell[i] = this.heapCell[child]!;
        i = child;
      }
      this.heapKey[i] = key;
      this.heapCell[i] = cell;
    }
    return top;
  }

  /**
   * Picks the biggest connected pool out of the filled depressions and makes it the lake,
   * and reports whether every pool has been weighed.
   *
   * Biggest by AREA, not by depth: a deep narrow slot reads as a puddle from the road
   * whatever its bottom is doing, and the window usually holds several hollows at once.
   * The scan, the flood and the wet marking each keep their cursor, so a slice can end in
   * the middle of any of them.
   */
  private keepLargestPool(deadlineMs: number): boolean {
    const drain = this.drainLevel;
    if (!this.poolReset) {
      this.seen.fill(0);
      this.poolReset = true;
    }
    while (true) {
      if (this.poolHead < this.poolTail) {
        while (this.poolHead < this.poolTail) {
          const cell = this.absorbed[this.poolHead++]!;
          if (this.heights[cell]! < this.poolFloor) this.poolFloor = this.heights[cell]!;
          if (drain[cell]! > this.poolLip) this.poolLip = drain[cell]!;
          const ix = (cell / SITE_VERTS) | 0;
          const iz = cell - ix * SITE_VERTS;
          for (let n = 0; n < 4; n++) {
            const nx = ix + (n === 0 ? -1 : n === 1 ? 1 : 0);
            const nz = iz + (n === 2 ? -1 : n === 3 ? 1 : 0);
            if (nx < 0 || nz < 0 || nx > SITE_CELLS || nz > SITE_CELLS) continue;
            const next = nx * SITE_VERTS + nz;
            if (this.seen[next] !== 0 || drain[next]! <= this.heights[next]!) continue;
            this.seen[next] = 1;
            this.absorbed[this.poolTail++] = next;
          }
          if (performance.now() >= deadlineMs) return false;
        }
        if (this.poolTail > this.bestCount) {
          this.bestCount = this.poolTail;
          this.bestLevel = this.poolLip;
          this.bestFloor = this.poolFloor;
        }
        this.poolHead = 0;
        this.poolTail = 0;
        continue;
      }
      if (this.poolScan >= SITE_POINTS) break;
      const start = this.poolScan++;
      if (this.seen[start] !== 0 || drain[start]! <= this.heights[start]!) {
        if (performance.now() >= deadlineMs) return false;
        continue;
      }
      // One pool: every connected cell standing under the same drain level.
      this.seen[start] = 1;
      this.absorbed[0] = start;
      this.poolHead = 0;
      this.poolTail = 1;
      this.poolFloor = this.heights[start]!;
      this.poolLip = drain[start]!;
    }
    if (this.bestCount === 0) return true;

    if (this.wetCursor === 0) {
      // Capped, because a broad shallow depression can accept far more than a lake's worth
      // before it spills and would flood the whole window.
      this.floorY = this.bestFloor;
      this.waterY = Math.min(this.bestLevel, this.bestFloor + MAX_FILL_M);
      this.wet.fill(0);
      this.wetCells = 0;
      this.wetRadius = 0;
    }
    while (this.wetCursor < SITE_POINTS) {
      const vi = this.wetCursor++;
      if (drain[vi]! <= this.heights[vi]! || this.heights[vi]! >= this.waterY) continue;
      this.wet[vi] = 1;
      this.wetCells++;
      const ix = (vi / SITE_VERTS) | 0;
      const iz = vi - ix * SITE_VERTS;
      const r = Math.hypot(ix * SITE_STEP_M - SITE_REACH_M, iz * SITE_STEP_M - SITE_REACH_M);
      if (r > this.wetRadius) this.wetRadius = r;
      if (performance.now() >= deadlineMs) return false;
    }
    return true;
  }

  /**
   * Distance from every lattice point to the nearest water, in metres, by a two-pass
   * chamfer transform.
   *
   * This is what lets the approach fade key off the WATERLINE rather than off the site
   * centre. A shoreline cut against real dunes is not a circle — it has bays and spits tens
   * of metres deep — and a radial test would make the water vanish while the player was
   * still a hundred metres from it on one bearing and let them drive into it on another.
   */
  private buildEdgeDistanceForward(deadlineMs: number): void {
    const far = SITE_REACH_M * 4;
    const orth = SITE_STEP_M;
    const diag = SITE_STEP_M * Math.SQRT2;
    if (this.scanCursor === 0) {
      for (let vi = 0; vi < SITE_POINTS; vi++) {
        this.edgeDistance[vi] = this.wet[vi] !== 0 ? 0 : far;
      }
    }
    while (this.scanCursor < SITE_POINTS) {
      const vi = this.scanCursor++;
      const ix = (vi / SITE_VERTS) | 0;
      const iz = vi - ix * SITE_VERTS;
      let best = this.edgeDistance[vi]!;
      if (ix > 0) best = Math.min(best, this.edgeDistance[vi - SITE_VERTS]! + orth);
      if (iz > 0) best = Math.min(best, this.edgeDistance[vi - 1]! + orth);
      if (ix > 0 && iz > 0) best = Math.min(best, this.edgeDistance[vi - SITE_VERTS - 1]! + diag);
      if (ix > 0 && iz < SITE_CELLS) {
        best = Math.min(best, this.edgeDistance[vi - SITE_VERTS + 1]! + diag);
      }
      this.edgeDistance[vi] = best;
      if (performance.now() >= deadlineMs) return;
    }
    this.phase = 'measuring2';
  }

  /** The backward half. */
  private buildEdgeDistanceBackward(deadlineMs: number): void {
    const orth = SITE_STEP_M;
    const diag = SITE_STEP_M * Math.SQRT2;
    if (this.scanCursor === 0) this.scanCursor = SITE_POINTS;
    while (this.scanCursor > 0) {
      const vi = --this.scanCursor;
      const ix = (vi / SITE_VERTS) | 0;
      const iz = vi - ix * SITE_VERTS;
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
      if (performance.now() >= deadlineMs) return;
    }
    this.scanCursor = 0;
    this.phase = 'baking';
  }

  /** Positions, wave UVs and the baked RGBA shoreline for the filled sheet. */
  private bakeVertices(deadlineMs: number): boolean {
    const { deep, shallow, foam } = waterPaletteAt(this.searchSite!.s);
    const startX = this.centreX - SITE_REACH_M;
    const startZ = this.centreZ - SITE_REACH_M;
    while (this.bakeCursor < SITE_POINTS) {
      const vi = this.bakeCursor++;
      const ix = (vi / SITE_VERTS) | 0;
      const iz = vi - ix * SITE_VERTS;
      this.positions[vi * 3] = -SITE_REACH_M + ix * SITE_STEP_M;
      this.positions[vi * 3 + 1] = this.waterY;
      this.positions[vi * 3 + 2] = -SITE_REACH_M + iz * SITE_STEP_M;
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
      if (performance.now() >= deadlineMs) return false;
    }
    return true;
  }

  /** The indices: only quads with a wet corner, so the draw is the lake, not its box. */
  private bakeQuads(deadlineMs: number): boolean {
    while (this.quadRow < SITE_CELLS) {
      const ix = this.quadRow;
      while (this.quadCol < SITE_CELLS) {
        // Checked before the quad is taken, so a stopped slice resumes on the same quad.
        if (performance.now() >= deadlineMs) return false;
        const iz = this.quadCol++;
        const a = ix * SITE_VERTS + iz;
        const b = (ix + 1) * SITE_VERTS + iz;
        const c = a + 1;
        const d = b + 1;
        if (this.wet[a] !== 0 || this.wet[b] !== 0 || this.wet[c] !== 0 || this.wet[d] !== 0) {
          this.indices[this.indexCount++] = a;
          this.indices[this.indexCount++] = c;
          this.indices[this.indexCount++] = b;
          this.indices[this.indexCount++] = b;
          this.indices[this.indexCount++] = c;
          this.indices[this.indexCount++] = d;
        }
      }
      this.quadCol = 0;
      this.quadRow++;
    }
    this.triangles = this.indexCount / 3;
    return true;
  }

  /**
   * The fringe, planted on the waterline.
   *
   * The shoreline is not computed geometrically — it is READ OFF the fill: a lattice cell
   * that is dry with a wet neighbour IS the shore, whatever shape the dunes gave it. The
   * grass then follows every bay and spit, which is the whole reason the boundary was
   * worth knowing exactly.
   */
  private findShore(deadlineMs: number): void {
    while (this.shoreCursor < SITE_POINTS) {
      const vi = this.shoreCursor++;
      const ix = (vi / SITE_VERTS) | 0;
      const iz = vi - ix * SITE_VERTS;
      if (this.wet[vi] === 0) {
        const wetNeighbour =
          (ix > 0 && this.wet[vi - SITE_VERTS] !== 0) ||
          (ix < SITE_CELLS && this.wet[vi + SITE_VERTS] !== 0) ||
          (iz > 0 && this.wet[vi - 1] !== 0) ||
          (iz < SITE_CELLS && this.wet[vi + 1] !== 0);
        if (wetNeighbour) this.shore[this.shoreCount++] = vi;
      }
      if (performance.now() >= deadlineMs) return;
    }
    this.shoreCursor = 0;
    this.phase = 'planting2';
  }

  private plantGrass(deadlineMs: number): boolean {
    if (!this.sheet) this.sheet = new BasinSheet(this.searchSite!);
    const done = this.fill(
      this.sheet.grass,
      MAX_GRASS,
      GRASS_PER_CELL,
      0,
      GRASS_HEIGHT,
      GRASS_JITTER_M,
      GRASS_TINT,
      deadlineMs,
    );
    if (done) this.plantCursor = 0;
    return done;
  }

  private plantWoody(deadlineMs: number): boolean {
    const sheet = this.sheet;
    if (!sheet) return true;
    const palmQuota = this.quotaFor(MAX_PALMS, PALMS_PER_CELL);
    const treeQuota = this.quotaFor(MAX_TREES, TREES_PER_CELL);
    while (this.plantCursor < palmQuota + treeQuota) {
      const i = this.plantCursor;
      if (i < palmQuota) {
        this.plantOne(sheet.palms, i, 1, PALM_HEIGHT, PLANT_JITTER_M, PALM_TINT);
      } else {
        this.plantOne(sheet.trees, i - palmQuota, 2, TREE_HEIGHT, PLANT_JITTER_M, TREE_TINT);
      }
      this.plantCursor++;
      if (performance.now() >= deadlineMs) return false;
    }
    if (palmQuota > 0) {
      sheet.palms.count = palmQuota;
      sheet.palms.instanceMatrix.needsUpdate = true;
      if (sheet.palms.instanceColor) sheet.palms.instanceColor.needsUpdate = true;
    } else {
      sheet.palms.count = 0;
    }
    if (treeQuota > 0) {
      sheet.trees.count = treeQuota;
      sheet.trees.instanceMatrix.needsUpdate = true;
      if (sheet.trees.instanceColor) sheet.trees.instanceColor.needsUpdate = true;
    } else {
      sheet.trees.count = 0;
    }
    sheet.shoreCount = this.shoreCount;
    return true;
  }

  /** Scaled to the shore there is, so a small lake gets a small fringe rather than a pile. */
  private quotaFor(ceiling: number, perCell: number): number {
    if (this.shoreCount === 0) return 0;
    return Math.round(Math.min(ceiling, Math.max(1, this.shoreCount * perCell)));
  }

  private fill(
    mesh: THREE.InstancedMesh,
    ceiling: number,
    perCell: number,
    form: number,
    heightBand: readonly [number, number],
    jitter: number,
    tint: THREE.Color,
    deadlineMs: number,
  ): boolean {
    const quota = this.quotaFor(ceiling, perCell);
    if (quota === 0) {
      mesh.count = 0;
      return true;
    }
    while (this.plantCursor < quota) {
      this.plantOne(mesh, this.plantCursor, form, heightBand, jitter, tint);
      this.plantCursor++;
      if (performance.now() >= deadlineMs) return false;
    }
    mesh.count = quota;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    return true;
  }

  private plantOne(
    mesh: THREE.InstancedMesh,
    i: number,
    form: number,
    heightBand: readonly [number, number],
    jitter: number,
    tint: THREE.Color,
  ): void {
    const seed = this.context.seed;
    const key = this.searchSite!.index * 8192 + form * 2048 + i;
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

  /**
   * The search is over: the scratch lattices become a sheet of their own.
   *
   * A COPY, and the copy is the point. The search's buffers are reused for the next basin,
   * so a settled basin has to own what it draws. Done here rather than at `beginSearch`
   * because two of every three sites hold no hollow worth filling, and a basin with no
   * water must cost nothing but the sampling.
   */
  private finishSheet(): void {
    const site = this.searchSite!;
    const sheet = this.sheet ?? new BasinSheet(site);
    this.sheet = null;
    sheet.positions.set(this.positions);
    sheet.uvs.set(this.uvs);
    sheet.colours.set(this.colours);
    sheet.heights.set(this.heights);
    sheet.wet.set(this.wet);
    sheet.edgeDistance.set(this.edgeDistance);
    sheet.indices = this.indices.slice(0, this.indexCount);
    sheet.centreX = this.centreX;
    sheet.centreZ = this.centreZ;
    sheet.waterY = this.waterY;
    sheet.floorY = this.floorY;
    sheet.triangles = this.triangles;
    sheet.wetCells = this.wetCells;
    sheet.wetRadius = this.wetRadius;
    sheet.geometry.setIndex(new THREE.BufferAttribute(sheet.indices, 1));
    sheet.geometry.setDrawRange(0, this.indexCount);
    sheet.geometry.getAttribute('position').needsUpdate = true;
    sheet.geometry.getAttribute('uv').needsUpdate = true;
    sheet.geometry.getAttribute('color').needsUpdate = true;
    sheet.geometry.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(0, this.waterY, 0),
      SITE_REACH_M * Math.SQRT2,
    );
    sheet.place(this.origin.x, this.origin.z);
    this.sheets.get(site.index)?.dispose();
    this.sheets.set(site.index, sheet);
    this.root.visible = true;
    this.root.add(sheet.group);
  }

  /** Diagnostics for `tools/water.ts` and the dev handle. */
  get ready(): boolean {
    if (this.searchSite !== null) return this.sheets.has(this.searchSite.index);
    const site = this.siteNearest(this.lastPlayerS);
    return site !== null && this.sheets.has(site.index);
  }
  get phaseName(): string {
    if (this.searchSite !== null) {
      return this.sheets.has(this.searchSite.index) ? 'ready' : this.phase;
    }
    const site = this.siteNearest(this.lastPlayerS);
    if (site !== null && this.sheets.has(site.index)) return 'ready';
    if (this.lastDry !== null && (site === null || site.index === this.lastDry.index)) return 'dry';
    return this.sheets.size > 0 ? 'ready' : 'idle';
  }
  get triangleCount(): number {
    return this.primarySheet()?.triangles ?? this.triangles;
  }
  get waterLevel(): number {
    return this.primarySheet()?.waterY ?? this.waterY;
  }
  /** Lowest ground in the searched window: the bottom of the hollow being filled. */
  get floorLevel(): number {
    return this.primarySheet()?.floorY ?? this.floorY;
  }
  get wetCellCount(): number {
    return this.primarySheet()?.wetCells ?? this.wetCells;
  }
  /** Radius of the furthest water from the window centre, metres. */
  get wetRadiusM(): number {
    return this.primarySheet()?.wetRadius ?? this.wetRadius;
  }
  get shorelineCells(): number {
    return this.primarySheet()?.shoreCount ?? this.shoreCount;
  }
  get fringeCount(): number {
    const sheet = this.primarySheet();
    if (!sheet) return 0;
    return sheet.grass.count + sheet.palms.count + sheet.trees.count;
  }
  get currentOpacity(): number {
    let best = 0;
    for (const sheet of this.sheets.values()) {
      if (sheet.opacity > best) best = sheet.opacity;
    }
    return best;
  }
  get centre(): { readonly x: number; readonly z: number } {
    const sheet = this.primarySheet();
    return sheet ? { x: sheet.centreX, z: sheet.centreZ } : { x: this.centreX, z: this.centreZ };
  }
  /** Basins holding water at once: two is a lake beside a village pond. */
  get liveSheetCount(): number {
    return this.sheets.size;
  }
  /**
   * A place to stand and look at the lake: on the road side of the water, back from the
   * shore, on ground that is above the surface.
   *
   * The lake sits wherever the hollow was, which is rarely the middle of the window, and
   * the hollow keeps going past the shoreline — so neither the window's centre nor a fixed
   * radius finds solid ground with a view. This walks out from the water's centre toward
   * the road and stops at the first lattice point that stands clear of the surface and
   * clear of the approach fade. Only the dev jump in app/devtools.ts uses it.
   */
  viewpoint(): { readonly x: number; readonly y: number; readonly z: number; readonly yaw: number } | null {
    const sheet = this.primarySheet();
    if (!sheet) return null;
    let wet = 0;
    let sumX = 0;
    let sumZ = 0;
    for (let vi = 0; vi < SITE_POINTS; vi++) {
      if (sheet.wet[vi] === 0) continue;
      wet++;
      sumX += -SITE_REACH_M + (((vi / SITE_VERTS) | 0) * SITE_STEP_M);
      sumZ += -SITE_REACH_M + ((vi % SITE_VERTS) * SITE_STEP_M);
    }
    if (wet === 0) return null;
    const waterX = sheet.centreX + sumX / wet;
    const waterZ = sheet.centreZ + sumZ / wet;
    const road = this.context.road.sampleAt(sheet.site.s);
    const dirX = road.x - waterX;
    const dirZ = road.z - waterZ;
    const span = Math.hypot(dirX, dirZ) || 1;

    for (let out = VIEWPOINT_STANDOFF_M; out <= SITE_REACH_M * 2; out += SITE_STEP_M) {
      const x = waterX + (dirX / span) * out;
      const z = waterZ + (dirZ / span) * out;
      const localX = x - sheet.centreX;
      const localZ = z - sheet.centreZ;
      if (Math.abs(localX) > SITE_REACH_M || Math.abs(localZ) > SITE_REACH_M) break;
      const ix = Math.round((localX + SITE_REACH_M) / SITE_STEP_M);
      const iz = Math.round((localZ + SITE_REACH_M) / SITE_STEP_M);
      const groundY = sheet.heights[ix * SITE_VERTS + iz]!;
      if (groundY < sheet.waterY + EYE_ABOVE_WATER_M) continue;
      if (sheet.edgeDistance[ix * SITE_VERTS + iz]! <= VIEWPOINT_STANDOFF_M * 0.5) continue;
      return { x, y: groundY, z, yaw: Math.atan2(waterX - x, waterZ - z) };
    }
    return null;
  }
  get wetMask(): Uint8Array {
    return this.primarySheet()?.wet ?? this.wet;
  }
  get siteHeights(): Float32Array {
    return this.primarySheet()?.heights ?? this.heights;
  }
  static get lattice(): {
    readonly reach: number;
    readonly step: number;
    readonly verts: number;
    readonly cells: number;
    readonly minArea: number;
    readonly minDepth: number;
  } {
    return {
      reach: SITE_REACH_M,
      step: SITE_STEP_M,
      verts: SITE_VERTS,
      cells: SITE_CELLS,
      minArea: MIN_LAKE_AREA_M2,
      minDepth: MIN_LAKE_DEPTH_M,
    };
  }

  /** Starts a site's search without a scheduler. Only `tools/water.ts` uses this. */
  beginSiteForTest(site: LakeSite): void {
    this.beginSearch(site);
  }
  /**
   * Runs exactly one slice and reports whether the site has settled.
   *
   * The deadline is the caller's: `tools/water.ts` passes the scheduler's own budget, so
   * the slice it measures is the slice the game runs.
   */
  advanceForTest(deadlineMs = performance.now() + SLICE_BUDGET_MS): boolean {
    if (this.phase !== 'ready' && this.phase !== 'dry') this.advance(deadlineMs);
    return this.phase === 'ready' || this.phase === 'dry';
  }

  dispose(): void {
    for (const sheet of this.sheets.values()) sheet.dispose();
    this.sheets.clear();
    this.root.removeFromParent();
  }
}
