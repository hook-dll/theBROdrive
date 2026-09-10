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
const MAX_SHIPS = 240;

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

function blockMaterial(colour: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: colour,
    vertexColors: true,
    transparent: true,
    opacity: 0,
    depthWrite: true,
    fog: true,
    toneMapped: true,
  });
}

/**
 * Rare render-only tableaus around the road.
 *
 * Every encounter is deterministic, starts 3–8 km after the previous one, and draws
 * from a shuffled set of five forms so each group of five contains every form once.
 * Only the active encounter owns instance matrices. Nothing enters physics, streaming,
 * saves, terrain, or shadow passes; every tableau is a single draw. Instance
 * coordinates are local to the encounter anchor, preserving precision even at the far
 * end of the forty-thousand-kilometre road.
 */
export class MirageTableau {
  private readonly root = new THREE.Group();
  private readonly palms: THREE.InstancedMesh;
  private readonly trees: THREE.InstancedMesh;
  private readonly cacti: THREE.InstancedMesh;
  private readonly blocks: THREE.InstancedMesh;
  private readonly ships: THREE.InstancedMesh;
  private readonly materials: readonly THREE.MeshBasicMaterial[];
  private readonly encounters: readonly Encounter[];

  private readonly matrix = new THREE.Matrix4();
  private readonly quaternion = new THREE.Quaternion();
  private readonly euler = new THREE.Euler();
  private readonly position = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly colour = new THREE.Color();

  private activeEncounter = -1;
  private anchorX = 0;
  private anchorY = 0;
  private anchorZ = 0;
  private densityScale = 1;
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
    const shipMaterial = cardMaterial();
    this.materials = [palmMaterial, treeMaterial, cactusMaterial, stoneMaterial, shipMaterial];

    this.palms = new THREE.InstancedMesh(palmGeometry(), palmMaterial, MAX_PLANTS);
    this.trees = new THREE.InstancedMesh(treeGeometry(), treeMaterial, MAX_PLANTS);
    this.cacti = new THREE.InstancedMesh(cactusGeometry(), cactusMaterial, MAX_PLANTS);
    const box = new THREE.BoxGeometry(1, 1, 1);
    this.blocks = new THREE.InstancedMesh(box, stoneMaterial, MAX_BLOCKS);
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

    for (let i = 0; i < this.materials.length - 1; i++) this.materials[i]!.opacity = opacity;
    this.materials[this.materials.length - 1]!.opacity = opacity * 0.74;
    this.root.position.set(
      this.anchorX - this.origin.x,
      this.anchorY,
      this.anchorZ - this.origin.z,
    );
  }

  /** Direct presentation path for comparing every authored tableau in the lab. */
  showPreview(
    kind: MirageKind,
    startS: number,
    length: number,
    lateralOffset: number,
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
    this.activateEncounter(encounter, density);
    const anchor = this.road.offsetPoint(startS, lateralOffset);
    this.root.position.set(
      anchor.x - this.origin.x,
      this.anchorY,
      anchor.z - this.origin.z,
    );
    this.root.scale.setScalar(Math.max(0.05, scale));
    this.previewOpacity = Math.min(1, Math.max(0, opacity));
    this.setPreviewDayFactor(1);
  }

  setPreviewDayFactor(dayFactor: number): void {
    const alpha = this.previewOpacity * smoothstep(0.12, 0.42, dayFactor);
    for (const material of this.materials) material.opacity = alpha;
    this.root.visible = this.previewActive && alpha > 0.002;
  }

  hide(): void {
    this.previewActive = false;
    this.root.visible = false;
  }

  private get meshes(): readonly THREE.InstancedMesh[] {
    return [this.palms, this.trees, this.cacti, this.blocks, this.ships];
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
    this.activateEncounter(this.encounters[index]!, 1);
  }

  private activateEncounter(encounter: Encounter, density: number): void {
    this.densityScale = Math.min(1, Math.max(0.02, density));
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
      const lateral = side * (lateralMin + depth * depth * (lateralMax - lateralMin));
      const point = this.road.offsetPoint(s, lateral);
      const ground = this.terrain.heightAt(point.x, point.z, s);
      const height = heightMin + hashUnit3(this.seed, encounter.index * MAX_PLANTS + i, SALT_SHAPE) * (heightMax - heightMin);
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

  private buildCity(encounter: Encounter): void {
    let count = 0;
    const buildings = Math.max(1, Math.round(156 * this.densityScale));
    for (let i = 0; i < buildings; i++) {
      const key = encounter.index * buildings + i;
      const along = hashUnit3(this.seed, key, SALT_PLACEMENT);
      const s = encounter.startS + 10 + along * along * (encounter.length - 20);
      const side = hashUnit3(this.seed, key, SALT_PLACEMENT + 1) < 0.5 ? -1 : 1;
      const depth = hashUnit3(this.seed, key, SALT_PLACEMENT + 2);
      const lateral = side * (18 + depth * depth * 127);
      const point = this.road.offsetPoint(s, lateral);
      const ground = this.terrain.heightAt(point.x, point.z, s);
      const width = 5 + hashUnit3(this.seed, key, SALT_SHAPE) * 9;
      const buildingDepth = 5 + hashUnit3(this.seed, key, SALT_SHAPE + 1) * 9;
      const tower = hashUnit3(this.seed, key, SALT_SHAPE + 6) > 0.92;
      const height = tower
        ? 24 + hashUnit3(this.seed, key, SALT_SHAPE + 2) * 24
        : 4 + hashUnit3(this.seed, key, SALT_SHAPE + 2) * 14;
      const heading = this.road.sampleAt(s).heading;
      this.cityColour(key, depth, 0);
      count = this.addBox(count, point.x - this.anchorX, ground - this.anchorY, point.z - this.anchorZ, width, height, buildingDepth, heading, this.colour);

      let totalHeight = height;
      if (hashUnit3(this.seed, key, SALT_SHAPE + 3) > 0.48) {
        const upperHeight = height * (0.18 + hashUnit3(this.seed, key, SALT_SHAPE + 4) * 0.25);
        this.cityColour(key, depth, 1);
        count = this.addBox(count, point.x - this.anchorX, ground - this.anchorY + totalHeight, point.z - this.anchorZ, width * 0.58, upperHeight, buildingDepth * 0.62, heading, this.colour);
        totalHeight += upperHeight;
      }
      if (hashUnit3(this.seed, key, SALT_SHAPE + 5) > 0.72) {
        this.colour.setHSL(0.09, 0.2, 0.66 + depth * 0.1);
        count = this.addBox(count, point.x - this.anchorX, ground - this.anchorY + totalHeight, point.z - this.anchorZ, width * 1.08, 0.7, buildingDepth * 1.08, heading, this.colour);
      }
    }
    this.blocks.count = count;
    this.blocks.visible = true;
    this.blocks.instanceMatrix.needsUpdate = true;
    if (this.blocks.instanceColor) this.blocks.instanceColor.needsUpdate = true;
  }

  /**
   * Sunlit render, not albedo: these lightnesses are what the screen receives.
   * See `displayColour`.
   */
  private cityColour(key: number, depth: number, tier: number): void {
    this.colour.setHSL(
      0.075 + hashUnit3(this.seed, key, SALT_COLOUR + tier) * 0.035,
      0.2 + hashUnit3(this.seed, key, SALT_COLOUR + tier + 2) * 0.18,
      0.6 + depth * 0.14,
    );
  }

  /**
   * A drowned fleet the sea left behind: hulks packed close enough to overlap from
   * the road, each one grounded at its own angle. Placement is the plants' — biased
   * toward the near verge and thinning outward — because a wreck field wants the
   * same "walk into it" depth a grove does, not the fountains' two tidy rows.
   */
  private buildShips(encounter: Encounter): void {
    const instanceCount = Math.max(1, Math.round(170 * this.densityScale));
    for (let i = 0; i < instanceCount; i++) {
      const key = encounter.index * MAX_SHIPS + i;
      const along = hashUnit3(this.seed, key, SALT_PLACEMENT);
      const s = encounter.startS + 10 + along * along * (encounter.length - 20);
      const side = hashUnit3(this.seed, key, SALT_PLACEMENT + 1) < 0.5 ? -1 : 1;
      const depth = hashUnit3(this.seed, key, SALT_PLACEMENT + 2);
      const lateral = side * (26 + depth * depth * 210);
      const point = this.road.offsetPoint(s, lateral);
      const ground = this.terrain.heightAt(point.x, point.z, s);
      // A freighter is long, so the card is scaled well past its height; the list
      // ranges from a coaster to something that took a dock to build.
      const height = 7 + hashUnit3(this.seed, key, SALT_SHAPE) * 21;
      const length = height * (2.1 + hashUnit3(this.seed, key, SALT_SHAPE + 1) * 1.5);
      const yaw = hashUnit3(this.seed, key, SALT_SHAPE + 2) * Math.PI * 2;
      // Grounded hulls lie over; the lean also settles the keel into the sand.
      const roll = (hashUnit3(this.seed, key, SALT_SHAPE + 3) - 0.5) * 0.5;
      this.setTransform(
        this.ships,
        i,
        point.x - this.anchorX,
        ground - this.anchorY,
        point.z - this.anchorZ,
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
      this.ships.setColorAt(i, this.colour);
    }
    this.ships.count = instanceCount;
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
  ): number {
    this.setTransform(this.blocks, index, x, groundY + height * 0.5, z, width, height, depth, yaw);
    this.blocks.setColorAt(index, colour);
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
