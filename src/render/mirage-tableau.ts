import * as THREE from 'three';
import { hashUnit3 } from '../core/rng';
import type { WorldOrigin } from '../world/origin';
import type { Road } from '../world/road';
import type { Terrain } from '../world/terrain';

const MIN_GAP_M = 3_000;
const GAP_RANGE_M = 5_000;
const APPROACH_M = 900;
const RETREAT_M = 260;
const FADE_FROM_ROAD_M = 1;
const GONE_FROM_ROAD_M = 11;

const MAX_PLANTS = 420;
const MAX_BLOCKS = 512;
const MAX_CITY_WINDOWS = 1_536;
const MAX_CITY_ACCENTS = 512;
const MAX_CITY_ROOFS = 192;
const MAX_CITY_STREETS = 192;
const MAX_SHIPS = 240;

/** Nearest a wreck may ground itself to the asphalt, and how far the field reaches out. */
const SHIP_NEAR_M = 34;
const SHIP_SPREAD_M = 210;
/** Placement attempts per wreck before the slot is left empty. */
const SHIP_ATTEMPTS = 6;

const SALT_GAP = 0x31a7;
const SALT_LENGTH = 0x42b9;
const SALT_VARIANT = 0x53cb;
const SALT_PLACEMENT = 0x64dd;
const SALT_SHAPE = 0x75ef;
const SALT_COLOUR = 0x8711;

export const MIRAGE_TABLEAU_KINDS = ['palms', 'trees', 'cacti', 'city', 'ships'] as const;
export type MirageKind = (typeof MIRAGE_TABLEAU_KINDS)[number];

interface Encounter {
  readonly index: number;
  readonly startS: number;
  readonly length: number;
  readonly kind: MirageKind;
}

type CardTriangle = (
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  colour: THREE.Color,
  z?: number,
) => void;

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
/**
 * A mirage colour authored in DISPLAY space.
 *
 * Pass 2 in core/renderer.ts copies the linear scene target to the canvas
 * untouched, so an unlit material's colour reaches the screen at its own numeric
 * value. Converting an authored hex from sRGB darkens it by a whole gamma, and a
 * tableau multiplies its card palette by an instance colour, so that darkening
 * landed twice: palm fronds measured one or two code values on screen — a black
 * paper cut-out of a palm rather than a green one.
 */
function displayColour(hex: number): THREE.Color {
  return new THREE.Color().setHex(hex, THREE.LinearSRGBColorSpace);
}

/**
 * Per-kind haze tint applied to every instance of a grove. Near white on purpose:
 * it multiplies the card palette, so it varies the light on a plant instead of
 * replacing its colour.
 */
const PALM_TINT = displayColour(0xfff1dc);
const TREE_TINT = displayColour(0xf9f2e2);
const CACTUS_TINT = displayColour(0xf3f8e6);
const SHIP_TINT = displayColour(0xffe9d2);


/** Two perpendicular copies of every triangle: a readable flat from any road angle. */
function crossedCardGeometry(draw: (triangle: CardTriangle) => void): THREE.BufferGeometry {
  const positions: number[] = [];
  const colours: number[] = [];
  const triangle: CardTriangle = (ax, ay, bx, by, cx, cy, colour, z = 0) => {
    positions.push(
      ax, ay, z, bx, by, z, cx, cy, z,
      z, ay, -ax, z, by, -bx, z, cy, -cx,
    );
    for (let i = 0; i < 6; i++) colours.push(colour.r, colour.g, colour.b);
  };
  draw(triangle);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  return geometry;
}

function palmGeometry(): THREE.BufferGeometry {
  return crossedCardGeometry((triangle) => {
    const trunk = displayColour(0xcb9a67);
    const leaf = displayColour(0x86c96d);
    triangle(-0.055, 0, 0.055, 0, 0.035, 0.72, trunk);
    triangle(-0.055, 0, 0.035, 0.72, -0.015, 0.72, trunk);
    const crownX = 0.01;
    const crownY = 0.73;
    const ends: readonly (readonly [number, number, number])[] = [
      [-0.62, 0.58, 0.075], [-0.5, 0.76, 0.07], [-0.28, 0.94, 0.06],
      [-0.06, 1.03, 0.05], [0.18, 1.01, 0.05], [0.42, 0.9, 0.065],
      [0.58, 0.7, 0.075], [0.55, 0.5, 0.07],
    ];
    for (const [endX, endY, halfWidth] of ends) {
      const dx = endX - crownX;
      const dy = endY - crownY;
      const length = Math.hypot(dx, dy);
      const px = (-dy / length) * halfWidth;
      const py = (dx / length) * halfWidth;
      triangle(crownX + px, crownY + py, endX, endY, crownX - px, crownY - py, leaf, -0.002);
    }
    triangle(-0.12, 0.68, 0.13, 0.69, 0.01, 0.84, leaf, -0.003);
  });
}

function treeGeometry(): THREE.BufferGeometry {
  return crossedCardGeometry((triangle) => {
    const trunk = displayColour(0xbe9066);
    const leaf = displayColour(0x9ad081);
    triangle(-0.07, 0, 0.075, 0, 0.045, 0.62, trunk);
    triangle(-0.07, 0, 0.045, 0.62, -0.03, 0.62, trunk);
    const crown = (x: number, y: number, rx: number, ry: number, z: number): void => {
      triangle(x, y, x - rx, y, x, y + ry, leaf, z);
      triangle(x, y, x, y + ry, x + rx, y, leaf, z);
      triangle(x, y, x + rx, y, x, y - ry, leaf, z);
      triangle(x, y, x, y - ry, x - rx, y, leaf, z);
    };
    crown(-0.22, 0.7, 0.34, 0.27, -0.002);
    crown(0.2, 0.72, 0.38, 0.3, -0.003);
    crown(0, 0.91, 0.38, 0.3, -0.004);
  });
}

function cactusGeometry(): THREE.BufferGeometry {
  return crossedCardGeometry((triangle) => {
    const cactus = displayColour(0x8ecb8b);
    const bloom = displayColour(0xff9f72);
    const quad = (x0: number, y0: number, x1: number, y1: number, z = 0): void => {
      triangle(x0, y0, x1, y0, x1, y1, cactus, z);
      triangle(x0, y0, x1, y1, x0, y1, cactus, z);
    };
    quad(-0.105, 0, 0.105, 1);
    quad(-0.43, 0.42, -0.08, 0.56, -0.002);
    quad(-0.43, 0.42, -0.28, 0.75, -0.002);
    quad(0.08, 0.58, 0.39, 0.71, -0.003);
    quad(0.25, 0.58, 0.39, 0.86, -0.003);
    triangle(-0.15, 1, 0.15, 1, 0, 1.08, cactus, -0.004);
    triangle(0.25, 0.86, 0.41, 0.86, 0.34, 0.94, bloom, -0.005);
  });
}
/**
 * A beached freighter with its plating gone: bow, broken stern, a leaning
 * deckhouse and the frames still standing where the hull opened up.
 *
 * Authored one unit tall like every other card, so an instance's height scales the
 * whole wreck. Rust reads as a palette rather than a texture: three warm tones plus
 * a salt-bleached deck are enough to tell hull from superstructure at a kilometre.
 */
function shipGeometry(): THREE.BufferGeometry {
  return crossedCardGeometry((triangle) => {
    const hull = displayColour(0xc06844);
    const shadedHull = displayColour(0x944b2f);
    const rust = displayColour(0xe08a4c);
    const deck = displayColour(0xd6bb95);
    const quad = (
      x0: number,
      y0: number,
      x1: number,
      y1: number,
      colour: THREE.Color,
      z = 0,
    ): void => {
      triangle(x0, y0, x1, y0, x1, y1, colour, z);
      triangle(x0, y0, x1, y1, x0, y1, colour, z);
    };
    // Hull, raked bow to the right, torn stern to the left.
    quad(-0.52, 0, 0.5, 0.33, hull);
    triangle(0.5, 0, 0.78, 0.4, 0.5, 0.4, hull);
    triangle(-0.52, 0, -0.52, 0.33, -0.72, 0.28, shadedHull);
    // Waterline stripe: the one horizontal that makes the shape read as a ship.
    quad(-0.52, 0.1, 0.5, 0.15, rust, -0.001);
    quad(-0.52, 0.33, 0.5, 0.38, deck, -0.002);
    // Ribs standing where the plating has gone.
    for (const x of [-0.36, -0.18, 0.02, 0.22]) {
      quad(x, 0.38, x + 0.022, 0.52, shadedHull, -0.003);
    }
    // Deckhouse, bridge windows and funnel, all set aft of midships.
    quad(-0.34, 0.38, 0.02, 0.63, shadedHull, -0.003);
    quad(-0.3, 0.5, -0.02, 0.56, rust, -0.004);
    quad(-0.2, 0.63, -0.07, 0.8, rust, -0.004);
    // Mast, still upright, with a broken yard.
    quad(0.26, 0.38, 0.29, 0.95, shadedHull, -0.003);
    triangle(0.12, 0.82, 0.29, 0.86, 0.29, 0.78, shadedHull, -0.004);
  });
}


function cardMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0,
    depthWrite: true,
    fog: true,
    toneMapped: true,
  });
}

/**
 * Blocks are box instances: the geometry carries no colour attribute, so the
 * material MUST NOT ask for vertex colours. `vertexColors: true` here made the
 * shader read a disabled attribute — a constant black — and multiplied every
 * building by zero, which is why the sandstone city rendered as a silhouette.
 * Per-instance colour arrives through `instanceColor` alone.
 */
function blockMaterial(colour: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: colour,
    transparent: true,
    opacity: 0,
    depthWrite: true,
    fog: true,
    toneMapped: true,
  });
}

/**
 * Wall paint per building.
 *
 * A desert town is mostly sandstone and whitewash, so those two families carry most
 * of the weight; terracotta, faded teal, dusty blue, pale rose and olive are the
 * minority of painted blocks that let a skyline read as a town rather than as one
 * quarry. Authored in the same DISPLAY space as `displayColour`: pale, because the
 * frame is tone mapped on the way out and a mid-lightness wall reads as shadow.
 */
interface CityPaint {
  readonly hue: number;
  readonly saturation: number;
  readonly lightness: number;
  /** Relative share of the buildings that receive this family. */
  readonly weight: number;
}

const CITY_WALL_PAINTS: readonly CityPaint[] = [
  { hue: 0.085, saturation: 0.3, lightness: 0.7, weight: 3 },
  { hue: 0.11, saturation: 0.15, lightness: 0.79, weight: 2.2 },
  { hue: 0.045, saturation: 0.33, lightness: 0.67, weight: 1.4 },
  { hue: 0.47, saturation: 0.18, lightness: 0.73, weight: 1 },
  { hue: 0.58, saturation: 0.17, lightness: 0.72, weight: 1 },
  { hue: 0.96, saturation: 0.16, lightness: 0.75, weight: 0.8 },
  { hue: 0.2, saturation: 0.17, lightness: 0.71, weight: 0.8 },
];

/**
 * Roofs are the one part of a block nobody whitewashes: fired tile, painted tin,
 * patinated copper or slate. They are therefore darker and more saturated than the
 * wall below, which is what gives the skyline its punctuation.
 */
const CITY_ROOF_PAINTS: readonly CityPaint[] = [
  { hue: 0.03, saturation: 0.44, lightness: 0.57, weight: 3 },
  { hue: 0.08, saturation: 0.19, lightness: 0.61, weight: 2 },
  { hue: 0.44, saturation: 0.2, lightness: 0.56, weight: 1.2 },
  { hue: 0.6, saturation: 0.17, lightness: 0.59, weight: 1 },
];

/** Weighted pick from a paint list for a unit hash. */
function pickPaint(paints: readonly CityPaint[], unit: number): CityPaint {
  let total = 0;
  for (const paint of paints) total += paint.weight;
  let cursor = unit * total;
  for (const paint of paints) {
    cursor -= paint.weight;
    if (cursor <= 0) return paint;
  }
  return paints[0]!;
}

/**
 * Rare render-only tableaus around the road.
 *
 * Every encounter is deterministic, starts 3–8 km after the previous one, and draws
 * from a shuffled set of five forms so each group of five contains every form once.
 * Only the active encounter owns instance matrices. Nothing enters physics, streaming,
 * saves, terrain, or shadow passes. Each tableau uses a handful of instanced draws,
 * preserving local coordinates around the encounter anchor at any road distance.
 */
export class MirageTableau {
  private readonly root = new THREE.Group();
  private readonly palms: THREE.InstancedMesh;
  private readonly trees: THREE.InstancedMesh;
  private readonly cacti: THREE.InstancedMesh;
  private readonly blocks: THREE.InstancedMesh;
  private readonly cityWindows: THREE.InstancedMesh;
  private readonly cityAccents: THREE.InstancedMesh;
  private readonly cityRoofs: THREE.InstancedMesh;
  private readonly cityStreets: THREE.InstancedMesh;
  private readonly ships: THREE.InstancedMesh;
  private readonly materials: readonly THREE.MeshBasicMaterial[];
  private readonly encounters: readonly Encounter[];

  private readonly matrix = new THREE.Matrix4();
  private readonly quaternion = new THREE.Quaternion();
  private readonly euler = new THREE.Euler();
  private readonly position = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly colour = new THREE.Color();
  /** Accepted wreck centres and their footprint radii, so a new hulk can dodge them. */
  private readonly shipX = new Float32Array(MAX_SHIPS);
  private readonly shipZ = new Float32Array(MAX_SHIPS);
  private readonly shipRadius = new Float32Array(MAX_SHIPS);

  private activeEncounter = -1;
  private anchorX = 0;
  private anchorY = 0;
  private anchorZ = 0;
  private densityScale = 1;
  private sizeScale = 1;
  private setbackM = 0;
  private previewActive = false;
  private previewOpacity = 0;

  constructor(
    scene: THREE.Scene,
    private readonly road: Road,
    private readonly terrain: Terrain,
    private readonly seed: number,
    private readonly origin: WorldOrigin,
  ) {
    const palmMaterial = cardMaterial();
    const treeMaterial = cardMaterial();
    const cactusMaterial = cardMaterial();
    const stoneMaterial = blockMaterial(0xffffff);
    const windowMaterial = blockMaterial(0xffffff);
    const accentMaterial = blockMaterial(0xffffff);
    const roofMaterial = blockMaterial(0xffffff);
    const streetMaterial = blockMaterial(0xffffff);
    const shipMaterial = cardMaterial();
    this.materials = [
      palmMaterial,
      treeMaterial,
      cactusMaterial,
      stoneMaterial,
      shipMaterial,
      windowMaterial,
      accentMaterial,
      roofMaterial,
      streetMaterial,
    ];

    this.palms = new THREE.InstancedMesh(palmGeometry(), palmMaterial, MAX_PLANTS);
    this.trees = new THREE.InstancedMesh(treeGeometry(), treeMaterial, MAX_PLANTS);
    this.cacti = new THREE.InstancedMesh(cactusGeometry(), cactusMaterial, MAX_PLANTS);
    const box = new THREE.BoxGeometry(1, 1, 1);
    this.blocks = new THREE.InstancedMesh(box, stoneMaterial, MAX_BLOCKS);
    this.cityWindows = new THREE.InstancedMesh(box, windowMaterial, MAX_CITY_WINDOWS);
    this.cityAccents = new THREE.InstancedMesh(box, accentMaterial, MAX_CITY_ACCENTS);
    this.cityRoofs = new THREE.InstancedMesh(
      new THREE.ConeGeometry(0.5, 1, 6),
      roofMaterial,
      MAX_CITY_ROOFS,
    );
    this.cityStreets = new THREE.InstancedMesh(box, streetMaterial, MAX_CITY_STREETS);
    this.ships = new THREE.InstancedMesh(shipGeometry(), shipMaterial, MAX_SHIPS);

    for (const mesh of this.meshes) {
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      this.root.add(mesh);
    }
    this.root.visible = false;
    scene.add(this.root);
    this.encounters = this.buildSchedule();
  }

  update(playerS: number, playerLateral: number, dayFactor: number): void {
    const encounterIndex = this.findEncounter(playerS);
    if (encounterIndex < 0 || dayFactor <= 0.12) {
      this.root.visible = false;
      return;
    }
    if (encounterIndex !== this.activeEncounter) this.activate(encounterIndex);

    const encounter = this.encounters[encounterIndex]!;
    const roadFade = 1 - smoothstep(FADE_FROM_ROAD_M, GONE_FROM_ROAD_M, Math.abs(playerLateral));
    const approachFade = smoothstep(encounter.startS - APPROACH_M, encounter.startS - 420, playerS);
    const retreatFade = 1 - smoothstep(
      encounter.startS + encounter.length,
      encounter.startS + encounter.length + RETREAT_M,
      playerS,
    );
    const daylightFade = smoothstep(0.12, 0.42, dayFactor);
    const opacity = roadFade * approachFade * retreatFade * daylightFade;
    this.root.visible = opacity > 0.002;
    if (!this.root.visible) return;

    this.setMaterialOpacity(opacity);
    this.root.position.set(
      this.anchorX - this.origin.x,
      this.anchorY,
      this.anchorZ - this.origin.z,
    );
  }

  /**
   * Direct presentation path for comparing every authored tableau in the lab.
   *
   * The tableau always straddles the road exactly as it does in game: the anchor is
   * the centreline, `setback` pushes both verges outward, and `scale` resizes the
   * forms only. Moving or scaling the group as a whole would drag the far verge
   * across the asphalt, which is the one thing a roadside tableau must never do.
   */
  showPreview(
    kind: MirageKind,
    startS: number,
    length: number,
    setback: number,
    opacity: number,
    scale: number,
    variation: number,
    density: number,
  ): void {
    this.previewActive = true;
    const encounter = {
      index: Math.round(variation),
      startS,
      length: Math.max(80, length),
      kind,
    };
    this.activateEncounter(encounter, density, scale, setback);
    this.root.scale.setScalar(1);
    this.root.position.set(
      this.anchorX - this.origin.x,
      this.anchorY,
      this.anchorZ - this.origin.z,
    );
    this.previewOpacity = Math.min(1, Math.max(0, opacity));
    this.setPreviewDayFactor(1, 0);
  }

  /**
   * The lab is driveable, so the preview owes the player the same vanishing act the
   * game gives: leave the asphalt and the apparition goes with it.
   */
  setPreviewDayFactor(dayFactor: number, playerLateral: number): void {
    const roadFade = 1 - smoothstep(FADE_FROM_ROAD_M, GONE_FROM_ROAD_M, Math.abs(playerLateral));
    const alpha = this.previewOpacity * smoothstep(0.12, 0.42, dayFactor) * roadFade;
    this.setMaterialOpacity(alpha);
    this.root.visible = this.previewActive && alpha > 0.002;
  }

  hide(): void {
    this.previewActive = false;
    this.root.visible = false;
  }

  private get meshes(): readonly THREE.InstancedMesh[] {
    return [
      this.palms,
      this.trees,
      this.cacti,
      this.blocks,
      this.cityWindows,
      this.cityAccents,
      this.cityRoofs,
      this.cityStreets,
      this.ships,
    ];
  }

  private setMaterialOpacity(opacity: number): void {
    for (const material of this.materials) material.opacity = opacity;
    // Ships are broader and warmer; a little less alpha keeps them in the same
    // atmospheric distance as the plants without becoming a flat orange wall.
    this.materials[4]!.opacity = opacity * 0.74;
    this.materials[5]!.opacity = opacity * 0.9;
    this.materials[6]!.opacity = opacity * 0.82;
    this.materials[7]!.opacity = opacity * 0.86;
    this.materials[8]!.opacity = opacity * 0.58;
  }

  private buildSchedule(): readonly Encounter[] {
    const encounters: Encounter[] = [];
    let startS = MIN_GAP_M + hashUnit3(this.seed, -1, SALT_GAP) * GAP_RANGE_M;
    let index = 0;
    let permutation: MirageKind[] = [];
    while (startS < this.road.length) {
      if (index % 5 === 0) {
        permutation = ['palms', 'trees', 'cacti', 'city', 'ships'];
        const block = Math.floor(index / 5);
        for (let i = permutation.length - 1; i > 0; i--) {
          const j = Math.floor(hashUnit3(this.seed, block * 8 + i, SALT_VARIANT) * (i + 1));
          const swap = permutation[i]!;
          permutation[i] = permutation[j]!;
          permutation[j] = swap;
        }
      }
      encounters.push({
        index,
        startS,
        length: 680 + hashUnit3(this.seed, index, SALT_LENGTH) * 520,
        kind: permutation[index % 5]!,
      });
      startS += MIN_GAP_M + hashUnit3(this.seed, index, SALT_GAP) * GAP_RANGE_M;
      index++;
    }
    return encounters;
  }

  private findEncounter(playerS: number): number {
    const target = playerS + APPROACH_M;
    let lo = 0;
    let hi = this.encounters.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.encounters[mid]!.startS <= target) lo = mid + 1;
      else hi = mid;
    }
    const candidate = lo - 1;
    if (candidate < 0) return -1;
    const encounter = this.encounters[candidate]!;
    return playerS <= encounter.startS + encounter.length + RETREAT_M ? candidate : -1;
  }

  private activate(index: number): void {
    this.activeEncounter = index;
    this.activateEncounter(this.encounters[index]!, 1, 1, 0);
  }

  /**
   * `size` scales the forms only and `setback` pushes both verges away from the
   * asphalt; neither may move the tableau sideways, so the road always runs through
   * the middle of it.
   */
  private activateEncounter(
    encounter: Encounter,
    density: number,
    size: number,
    setback: number,
  ): void {
    this.densityScale = Math.min(1, Math.max(0.02, density));
    this.sizeScale = Math.min(8, Math.max(0.05, size));
    this.setbackM = Math.max(0, setback);
    for (const mesh of this.meshes) {
      mesh.count = 0;
      mesh.visible = false;
    }
    const anchor = this.road.sampleAt(encounter.startS);
    this.anchorX = anchor.x;
    this.anchorY = anchor.y;
    this.anchorZ = anchor.z;
    switch (encounter.kind) {
      case 'palms':
        this.buildPlants(this.palms, encounter, 360, 9, 185, 8, 18, PALM_TINT);
        break;
      case 'trees':
        this.buildPlants(this.trees, encounter, 390, 9, 150, 7, 16, TREE_TINT);
        break;
      case 'cacti':
        this.buildPlants(this.cacti, encounter, 420, 8, 220, 3.5, 11, CACTUS_TINT);
        break;
      case 'city':
        this.buildCity(encounter);
        break;
      case 'ships':
        this.buildShips(encounter);
        break;
    }
  }

  private buildPlants(
    mesh: THREE.InstancedMesh,
    encounter: Encounter,
    count: number,
    lateralMin: number,
    lateralMax: number,
    heightMin: number,
    heightMax: number,
    tint: THREE.Color,
  ): void {
    const instanceCount = Math.max(1, Math.round(count * this.densityScale));
    for (let i = 0; i < instanceCount; i++) {
      const along = hashUnit3(this.seed, encounter.index * MAX_PLANTS + i, SALT_PLACEMENT);
      const s = encounter.startS + 8 + along * along * (encounter.length - 16);
      const side = hashUnit3(this.seed, encounter.index * MAX_PLANTS + i, SALT_PLACEMENT + 1) < 0.5 ? -1 : 1;
      const depth = hashUnit3(this.seed, encounter.index * MAX_PLANTS + i, SALT_PLACEMENT + 2);
      const lateral = side * (this.setbackM + lateralMin + depth * depth * (lateralMax - lateralMin));
      const point = this.road.offsetPoint(s, lateral);
      const ground = this.terrain.heightAt(point.x, point.z, s);
      const height = (heightMin + hashUnit3(this.seed, encounter.index * MAX_PLANTS + i, SALT_SHAPE) * (heightMax - heightMin)) * this.sizeScale;
      const widthScale = 0.82 + hashUnit3(this.seed, encounter.index * MAX_PLANTS + i, SALT_SHAPE + 1) * 0.36;
      const yaw = hashUnit3(this.seed, encounter.index * MAX_PLANTS + i, SALT_SHAPE + 2) * Math.PI;

      this.setTransform(mesh, i, point.x - this.anchorX, ground - this.anchorY, point.z - this.anchorZ, height * widthScale, height, height * widthScale, yaw);
      // The instance colour MULTIPLIES the card palette, so it is a haze tint near
      // white rather than a second base colour. Two dark factors multiplied is what
      // made a grove black; here the far rows are lifted toward the shimmering air
      // and the near ones keep their own green.
      const lift =
        (0.9 + depth * 0.3) *
        (0.94 +
          hashUnit3(this.seed, encounter.index * MAX_PLANTS + i, SALT_COLOUR) * 0.14);
      this.colour.copy(tint).multiplyScalar(lift);
      mesh.setColorAt(i, this.colour);
    }
    mesh.count = instanceCount;
    mesh.visible = true;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  /**
   * A compact skyline rather than a pile of anonymous boxes:
   * warm masonry blocks, cool window rhythm, balconies, roof caps and the dark
   * strips of streets between them. Everything remains instanced and render-only.
   */
  private buildCity(encounter: Encounter): void {
    let count = 0;
    let windowCount = 0;
    let accentCount = 0;
    let roofCount = 0;
    let streetCount = 0;
    const buildings = Math.max(1, Math.round(156 * this.densityScale));
    const groundRelative = (ground: number): number => ground - this.anchorY;
    const localPoint = (
      point: { readonly x: number; readonly z: number },
      localX: number,
      localZ: number,
      heading: number,
    ): { x: number; z: number } => ({
      x: point.x + Math.cos(heading) * localX + Math.sin(heading) * localZ - this.anchorX,
      z: point.z - Math.sin(heading) * localX + Math.cos(heading) * localZ - this.anchorZ,
    });

    for (let i = 0; i < buildings; i++) {
      const key = encounter.index * MAX_BLOCKS + i;
      const along = hashUnit3(this.seed, key, SALT_PLACEMENT);
      const s = encounter.startS + 10 + along * along * (encounter.length - 20);
      const side = hashUnit3(this.seed, key, SALT_PLACEMENT + 1) < 0.5 ? -1 : 1;
      const depth = hashUnit3(this.seed, key, SALT_PLACEMENT + 2);
      const lateral = side * (this.setbackM + 18 + depth * depth * 127);
      const point = this.road.offsetPoint(s, lateral);
      const ground = this.terrain.heightAt(point.x, point.z, s);
      const width = (5 + hashUnit3(this.seed, key, SALT_SHAPE) * 9) * this.sizeScale;
      const buildingDepth =
        (5 + hashUnit3(this.seed, key, SALT_SHAPE + 1) * 9) * this.sizeScale;
      const tower = hashUnit3(this.seed, key, SALT_SHAPE + 6) > 0.92;
      const height = (
        tower
          ? 24 + hashUnit3(this.seed, key, SALT_SHAPE + 2) * 24
          : 4 + hashUnit3(this.seed, key, SALT_SHAPE + 2) * 14
      ) * this.sizeScale;
      const heading = this.road.sampleAt(s).heading;
      const y = groundRelative(ground);
      this.cityColour(key, depth, 0);
      count = this.addBox(
        count,
        point.x - this.anchorX,
        y,
        point.z - this.anchorZ,
        width,
        height,
        buildingDepth,
        heading,
        this.colour,
      );

      let totalHeight = height;
      if (hashUnit3(this.seed, key, SALT_SHAPE + 3) > 0.48) {
        const upperHeight = height * (0.18 + hashUnit3(this.seed, key, SALT_SHAPE + 4) * 0.25);
        this.cityColour(key, depth, 1);
        count = this.addBox(
          count,
          point.x - this.anchorX,
          y + totalHeight,
          point.z - this.anchorZ,
          width * 0.58,
          upperHeight,
          buildingDepth * 0.62,
          heading,
          this.colour,
        );
        totalHeight += upperHeight;
      }
      if (hashUnit3(this.seed, key, SALT_SHAPE + 5) > 0.72) {
        this.colour.setHSL(0.09, 0.24, 0.76 + depth * 0.08);
        count = this.addBox(
          count,
          point.x - this.anchorX,
          y + totalHeight,
          point.z - this.anchorZ,
          width * 1.08,
          0.7,
          buildingDepth * 1.08,
          heading,
          this.colour,
        );
      }

      // A little road-shadow at each block prevents the city reading as weightless
      // cubes and costs only one additional instanced box at most.
      if (streetCount < MAX_CITY_STREETS && hashUnit3(this.seed, key, SALT_COLOUR + 4) > 0.28) {
        this.colour.setHSL(0.08, 0.2, 0.29 + depth * 0.08);
        streetCount = this.addBox(
          streetCount,
          point.x - this.anchorX,
          y,
          point.z - this.anchorZ,
          width * 1.45,
          0.06,
          buildingDepth * 0.28,
          heading,
          this.colour,
          this.cityStreets,
        );
      }

      const rows = Math.max(1, Math.min(4, Math.floor(height / 3.4)));
      const columns = width > 9 ? 2 : 1;
      const windowHeight = Math.max(0.35, Math.min(1.05, height / (rows * 3.6)));
      const windowWidth = Math.max(0.28, Math.min(1.7, width / (columns * 4.4)));
      const fronts = hashUnit3(this.seed, key, SALT_PLACEMENT + 5) > 0.34 ? 2 : 1;
      for (let face = 0; face < fronts; face++) {
        const localZ = (face === 0 ? 1 : -1) * (buildingDepth * 0.5 + 0.045);
        for (let row = 0; row < rows; row++) {
          const floorY = 1.1 + row * (height / (rows + 0.45));
          for (let column = 0; column < columns; column++) {
            if (windowCount >= MAX_CITY_WINDOWS) break;
            const localX = (column - (columns - 1) * 0.5) * width * 0.34;
            const windowPoint = localPoint(point, localX, localZ, heading);
            this.cityWindowColour(key, depth, row + column + face);
            windowCount = this.addBox(
              windowCount,
              windowPoint.x,
              y + floorY,
              windowPoint.z,
              windowWidth,
              windowHeight,
              0.07,
              heading,
              this.colour,
              this.cityWindows,
            );
          }
        }
      }

      // Balconies make the mid-rise blocks read as inhabited buildings, not crates.
      if (rows > 1) {
        for (let row = 0; row < rows; row++) {
          if (accentCount >= MAX_CITY_ACCENTS) break;
          if (hashUnit3(this.seed, key, SALT_SHAPE + 11 + row) < 0.48) continue;
          const localZ = buildingDepth * 0.5 + 0.1;
          const balconyPoint = localPoint(point, 0, localZ, heading);
          this.cityAccentColour(key, depth);
          accentCount = this.addBox(
            accentCount,
            balconyPoint.x,
            y + 0.92 + row * (height / (rows + 0.45)),
            balconyPoint.z,
            width * 0.82,
            0.1,
            0.22,
            heading,
            this.colour,
            this.cityAccents,
          );
        }
      }

      if (roofCount < MAX_CITY_ROOFS && (tower || hashUnit3(this.seed, key, SALT_SHAPE + 12) > 0.63)) {
        const roofHeight = Math.max(1.2, Math.min(5, width * 0.24));
        this.cityRoofColour(key, depth);
        this.cityRoofs.setColorAt(roofCount, this.colour);
        this.setTransform(
          this.cityRoofs,
          roofCount++,
          point.x - this.anchorX,
          y + totalHeight + roofHeight * 0.5,
          point.z - this.anchorZ,
          width * 0.86,
          roofHeight,
          buildingDepth * 0.86,
          heading,
        );
        if (tower && accentCount < MAX_CITY_ACCENTS) {
          this.colour.setHSL(0.08, 0.25, 0.63 + depth * 0.12);
          accentCount = this.addBox(
            accentCount,
            point.x - this.anchorX,
            y + totalHeight + roofHeight,
            point.z - this.anchorZ,
            0.18 * this.sizeScale,
            roofHeight * 1.8,
            0.18 * this.sizeScale,
            heading,
            this.colour,
            this.cityAccents,
          );
        }
      }
    }
    this.blocks.count = count;
    this.cityWindows.count = windowCount;
    this.cityAccents.count = accentCount;
    this.cityRoofs.count = roofCount;
    this.cityStreets.count = streetCount;
    for (const mesh of [this.blocks, this.cityWindows, this.cityAccents, this.cityRoofs, this.cityStreets]) {
      mesh.visible = true;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  /**
   * Sandstone under a desert noon, not albedo: these lightnesses are what the screen
   * receives (see `displayColour`), and the frame is tone mapped on the way out, so a
   * wall has to be authored near white to read as pale stone rather than as shadow.
   */
  private cityColour(key: number, depth: number, tier: number): void {
    const paint = pickPaint(CITY_WALL_PAINTS, hashUnit3(this.seed, key, SALT_COLOUR));
    const hue = paint.hue + (hashUnit3(this.seed, key, SALT_COLOUR + 1) - 0.5) * 0.018;
    const saturation =
      paint.saturation * (0.8 + hashUnit3(this.seed, key, SALT_COLOUR + 2) * 0.45);
    // `depth` lifts the far rows toward the haze, and a set-back upper storey is a
    // shade paler than the mass it stands on: sunlight on a setback, not a new colour.
    const lightness =
      paint.lightness +
      depth * 0.1 +
      tier * 0.035 +
      (hashUnit3(this.seed, key, SALT_COLOUR + 3) - 0.5) * 0.055;
    this.colour.setHSL(hue, Math.min(0.62, saturation), Math.min(0.93, lightness));
  }

  private cityRoofColour(key: number, depth: number): void {
    const paint = pickPaint(CITY_ROOF_PAINTS, hashUnit3(this.seed, key, SALT_COLOUR + 50));
    this.colour.setHSL(
      paint.hue + (hashUnit3(this.seed, key, SALT_COLOUR + 51) - 0.5) * 0.02,
      paint.saturation * (0.85 + hashUnit3(this.seed, key, SALT_COLOUR + 52) * 0.3),
      Math.min(0.9, paint.lightness + depth * 0.12),
    );
  }
  private cityWindowColour(key: number, depth: number, variant: number): void {
    const cool = hashUnit3(this.seed, key, SALT_COLOUR + 20 + variant) > 0.64;
    this.colour.setHSL(
      cool ? 0.56 : 0.11,
      cool ? 0.22 : 0.3,
      0.68 + depth * 0.16 + hashUnit3(this.seed, key, SALT_COLOUR + 30 + variant) * 0.12,
    );
  }

  private cityAccentColour(key: number, depth: number): void {
    this.colour.setHSL(
      0.07 + hashUnit3(this.seed, key, SALT_COLOUR + 40) * 0.04,
      0.2 + depth * 0.08,
      0.54 + depth * 0.14,
    );
  }

  /**
   * A drowned fleet the sea left behind, each hulk grounded at its own angle.
   *
   * A wreck is a card up to seventy metres long, so placing them by hash alone piled
   * them into each other: the field read as a scrapyard of intersecting planes. Each
   * candidate now has to clear the hulls already down by the sum of their footprint
   * radii, and a slot that cannot find room after `SHIP_ATTEMPTS` tries is simply left
   * empty — the fleet thins out instead of overlapping.
   */
  private buildShips(encounter: Encounter): void {
    const slots = Math.max(1, Math.round(110 * this.densityScale));
    let placed = 0;
    for (let i = 0; i < slots; i++) {
      const key = encounter.index * MAX_SHIPS + i;
      // A freighter is long, so the card is scaled well past its height; the list
      // ranges from a coaster to something that took a dock to build.
      const height = (6 + hashUnit3(this.seed, key, SALT_SHAPE) * 15) * this.sizeScale;
      const length = height * (2.2 + hashUnit3(this.seed, key, SALT_SHAPE + 1) * 1.3);
      // The card runs from -0.72 to 0.78 along its length, so the footprint that has
      // to stay clear of the neighbours is wider than a half-length.
      const radius = length * 0.7;
      let x = 0;
      let z = 0;
      let ground = 0;
      let depth = 0;
      let room = false;
      for (let attempt = 0; attempt < SHIP_ATTEMPTS && !room; attempt++) {
        const salt = SALT_PLACEMENT + attempt * 3;
        const along = hashUnit3(this.seed, key, salt);
        const s = encounter.startS + 20 + along * (encounter.length - 40);
        const side = hashUnit3(this.seed, key, salt + 1) < 0.5 ? -1 : 1;
        const candidateDepth = hashUnit3(this.seed, key, salt + 2);
        const lateral =
          side * (this.setbackM + SHIP_NEAR_M + candidateDepth * candidateDepth * SHIP_SPREAD_M);
        const point = this.road.offsetPoint(s, lateral);
        room = true;
        for (let other = 0; other < placed; other++) {
          const dx = point.x - this.shipX[other]!;
          const dz = point.z - this.shipZ[other]!;
          const clearance = radius + this.shipRadius[other]!;
          if (dx * dx + dz * dz < clearance * clearance) {
            room = false;
            break;
          }
        }
        if (!room) continue;
        x = point.x;
        z = point.z;
        ground = this.terrain.heightAt(point.x, point.z, s);
        depth = candidateDepth;
      }
      if (!room) continue;
      const yaw = hashUnit3(this.seed, key, SALT_SHAPE + 2) * Math.PI * 2;
      // Grounded hulls lie over; the lean also settles the keel into the sand.
      const roll = (hashUnit3(this.seed, key, SALT_SHAPE + 3) - 0.5) * 0.5;
      this.setTransform(
        this.ships,
        placed,
        x - this.anchorX,
        ground - this.anchorY,
        z - this.anchorZ,
        length,
        height,
        length,
        yaw,
        roll,
      );
      const lift =
        (0.86 + depth * 0.32) *
        (0.9 + hashUnit3(this.seed, key, SALT_COLOUR) * 0.2);
      this.colour.copy(SHIP_TINT).multiplyScalar(lift);
      this.ships.setColorAt(placed, this.colour);
      this.shipX[placed] = x;
      this.shipZ[placed] = z;
      this.shipRadius[placed] = radius;
      placed++;
      if (placed >= MAX_SHIPS) break;
    }
    this.ships.count = placed;
    this.ships.visible = true;
    this.ships.instanceMatrix.needsUpdate = true;
    if (this.ships.instanceColor) this.ships.instanceColor.needsUpdate = true;
  }

  private addBox(
    index: number,
    x: number,
    groundY: number,
    z: number,
    width: number,
    height: number,
    depth: number,
    yaw: number,
    colour: THREE.Color,
    mesh: THREE.InstancedMesh = this.blocks,
  ): number {
    this.setTransform(mesh, index, x, groundY + height * 0.5, z, width, height, depth, yaw);
    mesh.setColorAt(index, colour);
    return index + 1;
  }

  private setTransform(
    mesh: THREE.InstancedMesh,
    index: number,
    x: number,
    y: number,
    z: number,
    width: number,
    height: number,
    depth: number,
    yaw: number,
    roll = 0,
  ): void {
    this.position.set(x, y, z);
    this.euler.set(0, yaw, roll);
    this.quaternion.setFromEuler(this.euler);
    this.scale.set(width, height, depth);
    this.matrix.compose(this.position, this.quaternion, this.scale);
    mesh.setMatrixAt(index, this.matrix);
  }
}
