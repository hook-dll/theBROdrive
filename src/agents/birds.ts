import * as THREE from 'three';
import { hash01 } from '../core/rng';
import type { Road } from '../world/road';
import type { Terrain } from '../world/terrain';

/**
 * Desert birds: the only sign of life out on the road.
 *
 * Birds are kinematic agents — there is not a single Rapier collider here. They
 * live in a single `InstancedMesh`, animated with a shader-side wing flap driven by
 * a per-instance phase attribute, so the per-frame cost is a handful of matrix
 * writes, never a geometry update.
 *
 * Placement is deterministic by arclength, exactly like POIs: a bird group lives in
 * a hash-derived road slot, so the same seed always puts the same birds in the same
 * place — including after driving away and coming back.
 */

// ---------------------------------------------------------------------------
// Tuning constants
// ---------------------------------------------------------------------------

/** How far ahead/behind the player (road metres) bird groups are kept alive. */
const ACTIVE_RADIUS = 400;
/** Hysteresis: a group despawns only once the player is this far past it. */
const DESPAWN_RADIUS = ACTIVE_RADIUS + 90;

/** Birds within this distance of the player simulate every frame. */
const LOD_NEAR = 120;
const LOD_NEAR_SQ = LOD_NEAR * LOD_NEAR;
/** Far birds simulate in ~0.2 s steps (≈ 5 Hz). */
const LOD_FAR_STEP = 0.2;

/** Candidate group slot width along the road, metres. */
const GROUP_SPACING = 320;
/** Probability a given slot actually hosts a group. */
const GROUP_CHANCE = 0.62;

/** Instance / pool caps. */
const MAX_BIRDS = 256;
const MAX_GROUPS = 32;
const MAX_FALLING = 8;

/** Minimum clearance kept above the terrain while flying. */
const MIN_CLEARANCE = 1.4;
/** Birds are kept within this horizontal distance of their perch, so the road
 *  projection hint (the group's arclength) never goes stale. */
const HOME_RADIUS = 60;
const HOME_RADIUS_SQ = HOME_RADIUS * HOME_RADIUS;

/** Alert radius grows with player speed: on foot you can creep close, but a car
 *  startles birds from well outside. Base is metres, `ALERT_PER_MS` is metres per m/s. */
const ALERT_BASE = 14;
const ALERT_PER_MS = 1.5;
const ALERT_MAX = 70;

/** A gunshot startles perched birds within this radius of the muzzle. */
const STARTLE_RADIUS = 45;
const STARTLE_RADIUS_SQ = STARTLE_RADIUS * STARTLE_RADIUS;

/** Wing flap amplitude in radians at full extension (baked into the shader). */
const FLAP_MAX = 0.85;

// Hash salts. Kept distinct from every other system's hashes and from each other,
// so changing one placement knob cannot shift another.
const SALT_CHANCE = 0xbead;
const SALT_S = 0x51de;
const SALT_SIDE = 0x71ab;
const SALT_SPECIES = 0x92ef;
const SALT_OFFSET = 0xad03;
const SALT_COUNT = 0xc417;
const SALT_LOD = 0xd53a;
const SALT_JITTER = 0xe6f1;
const SALT_AIR = 0xf7a2;
const SALT_YAW = 0x1803;
const SALT_BUDGET = 0x2944;

// Perch geometry — *approximations* of the pole line and cacti, never reads of
// another task's chunk content. Birds only need a plausible resting spot.
const POLE_LATERAL = 6.5;
const POLE_HEIGHT = 6.4;
const CACTUS_MIN_LATERAL = 34;
const CACTUS_SPREAD = 60;
const CACTUS_HEIGHT = 2.3;

// ---------------------------------------------------------------------------
// Species
// ---------------------------------------------------------------------------

type BirdState = 'perched' | 'alerted' | 'takeoff' | 'flying' | 'landing';

interface SpeciesDef {
  readonly name: string;
  readonly mass: number;
  readonly scale: number;
  readonly color: number;
  readonly cruiseSpeed: number;
  readonly cruiseAlt: number;
  readonly flapRate: number;
  readonly behavior: 'wander' | 'circle';
  readonly perch: 'pole' | 'cactus' | 'mixed';
  readonly minCount: number;
  readonly maxCount: number;
  readonly flightBudget: number;
  readonly turnRate: number;
  readonly bankGain: number;
  readonly climbRate: number;
  readonly airborneBias: number;
}

const SPECIES: readonly SpeciesDef[] = [
  {
    name: 'crow', mass: 0.45, scale: 0.9, color: 0x2f2a24,
    cruiseSpeed: 9, cruiseAlt: 16, flapRate: 10, behavior: 'wander', perch: 'pole',
    minCount: 2, maxCount: 5, flightBudget: 24, turnRate: 2.2, bankGain: 0.35,
    climbRate: 5, airborneBias: 0.35,
  },
  {
    name: 'vulture', mass: 9.2, scale: 2.6, color: 0x262019,
    cruiseSpeed: 7, cruiseAlt: 55, flapRate: 2.6, behavior: 'circle', perch: 'mixed',
    minCount: 1, maxCount: 3, flightBudget: 120, turnRate: 0.7, bankGain: 0.6,
    climbRate: 2.5, airborneBias: 0.85,
  },
  {
    name: 'sparrow', mass: 0.03, scale: 0.38, color: 0x7a6542,
    cruiseSpeed: 11, cruiseAlt: 10, flapRate: 16, behavior: 'wander', perch: 'cactus',
    minCount: 3, maxCount: 6, flightBudget: 16, turnRate: 3.4, bankGain: 0.28,
    climbRate: 6, airborneBias: 0.3,
  },
];

export interface BirdHit {
  readonly species: string;
  readonly mass: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Runtime state for one bird. Pooled: `update` never allocates these. */
interface Bird {
  group: number;
  groupS: number;
  sHint: number;
  species: SpeciesDef;
  state: BirdState;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  roll: number;
  pitch: number;
  phase: number;
  flapScale: number;
  scale: number;
  lod: number;
  perchX: number;
  perchY: number;
  perchZ: number;
  stateTimer: number;
  flightBudget: number;
  targetYaw: number;
  wanderTimer: number;
  wanderCount: number;
  wanderSalt: number;
  circleX: number;
  circleZ: number;
  circleRadius: number;
  circleAngle: number;
  circleDir: number;
  landX: number;
  landY: number;
  landZ: number;
}

interface FallingBird {
  mesh: THREE.Mesh;
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  rx: number;
  ry: number;
  rz: number;
  spinX: number;
  spinY: number;
  spinZ: number;
  life: number;
  scale: number;
  sHint: number;
}

/** Shortest signed angular difference a-b, folded to [-π, π]. */
function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export class BirdFlock {
  private readonly scene: THREE.Scene;
  private readonly road: Road;
  private readonly terrain: Terrain;
  private readonly seed: number;

  private readonly mesh: THREE.InstancedMesh;
  private readonly phaseAttr: THREE.InstancedBufferAttribute;
  private readonly flapAttr: THREE.InstancedBufferAttribute;
  private readonly fallGeometry: THREE.BufferGeometry;
  private readonly fallMaterial: THREE.MeshStandardMaterial;
  private readonly falling: FallingBird[] = [];

  // Pooled bird objects; active birds occupy [0, activeCount).
  private readonly birds: Bird[];
  private activeCount = 0;

  // Currently-spawned group slots, pooled and contiguous.
  private readonly groupRefs: number[] = new Array(MAX_GROUPS);
  private groupCount = 0;

  // Scratch objects so the per-frame path allocates nothing.
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly pv = new THREE.Vector3();
  private readonly sv = new THREE.Vector3();
  private readonly col = new THREE.Color();
  private readonly scratchPerch = { x: 0, y: 0, z: 0 };

  private lastPx = 0;
  private lastPy = 0;
  private lastPz = 0;
  private hasLastPlayer = false;
  private playerSpeed = 0;

  constructor(scene: THREE.Scene, road: Road, terrain: Terrain, seed: number) {
    this.scene = scene;
    this.road = road;
    this.terrain = terrain;
    this.seed = seed >>> 0;

    const instGeometry = buildBirdGeometry();
    this.phaseAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAX_BIRDS), 1);
    this.flapAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAX_BIRDS), 1);
    this.phaseAttr.setUsage(THREE.DynamicDrawUsage);
    this.flapAttr.setUsage(THREE.DynamicDrawUsage);
    instGeometry.setAttribute('aPhase', this.phaseAttr);
    instGeometry.setAttribute('aFlapScale', this.flapAttr);

    // White base colour: per-species tint arrives via instanceColor.
    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.92,
      metalness: 0,
      side: THREE.DoubleSide,
      flatShading: true,
    });
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          '#include <common>\n' +
            'attribute float aPhase;\n' +
            'attribute float aFlapScale;\n' +
            'attribute float aWing;\n',
        )
        .replace(
          '#include <begin_vertex>',
          // Rotate wing vertices around the local Z (forward) axis, before the
          // instance matrix is applied in project_vertex. Body vertices carry
          // aWing == 0 and are untouched.
          'vec3 transformed = vec3( position );\n' +
            '{\n' +
            `  float wingAngle = sin( aPhase ) * aFlapScale * ${FLAP_MAX};\n` +
            '  float w = aWing * wingAngle;\n' +
            '  if ( abs( w ) > 1e-4 ) {\n' +
            '    float c = cos( w );\n' +
            '    float s = sin( w );\n' +
            '    transformed = vec3( transformed.x * c - transformed.y * s, transformed.x * s + transformed.y * c, transformed.z );\n' +
            '  }\n' +
            '}\n',
        );
    };

    this.mesh = new THREE.InstancedMesh(instGeometry, material, MAX_BIRDS);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    // Instances span hundreds of metres; the mesh's own bounding sphere is wrong.
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    // Pre-create instanceColor so the material compiles with USE_INSTANCING_COLOR.
    for (let i = 0; i < MAX_BIRDS; i++) this.mesh.setColorAt(i, this.col.setHex(0xffffff));
    scene.add(this.mesh);

    this.birds = new Array<Bird>(MAX_BIRDS);
    for (let i = 0; i < MAX_BIRDS; i++) this.birds[i] = makeEmptyBird();

    // Pool of hidden tumbling corpses for killed birds.
    this.fallGeometry = buildBirdGeometry();
    this.fallMaterial = new THREE.MeshStandardMaterial({
      color: 0x2a241e,
      roughness: 0.95,
      metalness: 0,
      side: THREE.DoubleSide,
      flatShading: true,
    });
    for (let i = 0; i < MAX_FALLING; i++) {
      const mesh = new THREE.Mesh(this.fallGeometry, this.fallMaterial);
      mesh.visible = false;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      scene.add(mesh);
      this.falling.push({
        mesh, active: false,
        x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
        rx: 0, ry: 0, rz: 0, spinX: 0, spinY: 0, spinZ: 0,
        life: 0, scale: 1, sHint: 0,
      });
    }
  }

  update(dt: number, playerS: number, px: number, py: number, pz: number): void {
    // Player speed estimate drives the alert radius (foot vs car).
    if (this.hasLastPlayer && dt > 0) {
      const dx = px - this.lastPx;
      const dy = py - this.lastPy;
      const dz = pz - this.lastPz;
      const instant = Math.hypot(dx, dy, dz) / dt;
      const a = Math.min(1, dt * 6);
      this.playerSpeed += (instant - this.playerSpeed) * a;
    } else {
      this.playerSpeed = 0;
    }
    this.lastPx = px;
    this.lastPy = py;
    this.lastPz = pz;
    this.hasLastPlayer = true;

    const alertRadius = Math.min(ALERT_MAX, ALERT_BASE + this.playerSpeed * ALERT_PER_MS);
    const alertRadiusSq = alertRadius * alertRadius;

    this.syncGroups(playerS);

    for (let i = 0; i < this.activeCount; i++) {
      const b = this.birds[i]!;
      const dx = b.x - px;
      const dy = b.y - py;
      const dz = b.z - pz;
      if (dx * dx + dy * dy + dz * dz < LOD_NEAR_SQ) {
        this.tickBird(b, dt, px, py, pz, alertRadiusSq);
        b.lod = 0;
      } else {
        b.lod += dt;
        if (b.lod >= LOD_FAR_STEP) {
          this.tickBird(b, b.lod, px, py, pz, alertRadiusSq);
          b.lod = 0;
        }
      }
    }

    this.syncMeshes();
    this.tickFalling(dt);
  }

  tryHit(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxRange: number): BirdHit | null {
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-6) return null;
    const ndx = dx / len;
    const ndy = dy / len;
    const ndz = dz / len;

    let bestIdx = -1;
    let bestT = Infinity;

    for (let i = 0; i < this.activeCount; i++) {
      const b = this.birds[i]!;
      const radius = 0.28 * b.scale;
      const lx = b.x - ox;
      const ly = b.y - oy;
      const lz = b.z - oz;
      const tca = lx * ndx + ly * ndy + lz * ndz;
      if (tca < 0) continue;
      const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
      const r2 = radius * radius;
      if (d2 > r2) continue;
      const thc = Math.sqrt(r2 - d2);
      const t0 = tca - thc;
      if (t0 < 0 || t0 > maxRange) continue;
      if (t0 < bestT) {
        bestT = t0;
        bestIdx = i;
      }
    }

    // A gunshot is loud whether or not it connects: startle nearby perched birds.
    this.startleNear(ox, oy, oz);

    if (bestIdx < 0) return null;
    const b = this.birds[bestIdx]!;
    const result: BirdHit = { species: b.species.name, mass: b.species.mass, x: b.x, y: b.y, z: b.z };
    this.spawnFalling(b);
    this.removeBird(bestIdx);
    return result;
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    for (const f of this.falling) this.scene.remove(f.mesh);
    this.fallGeometry.dispose();
    this.fallMaterial.dispose();
  }

  // -- group lifecycle -----------------------------------------------------

  private syncGroups(playerS: number): void {
    for (let k = this.groupCount - 1; k >= 0; k--) {
      const g = this.groupRefs[k]!;
      if (Math.abs(this.groupSFor(g) - playerS) > DESPAWN_RADIUS) this.despawnGroup(k);
    }

    const gMin = Math.floor((playerS - ACTIVE_RADIUS) / GROUP_SPACING);
    const gMax = Math.floor((playerS + ACTIVE_RADIUS) / GROUP_SPACING);
    for (let g = gMin; g <= gMax; g++) {
      if (this.hasGroup(g)) continue;
      // A slot's actual arclength can straddle the window edge; only spawn groups
      // whose real position is inside it, or they would spawn and despawn at once.
      const gs = this.groupSFor(g);
      if (gs < playerS - ACTIVE_RADIUS || gs > playerS + ACTIVE_RADIUS) continue;
      if (hash01(this.seed, g, SALT_CHANCE) >= GROUP_CHANCE) continue;
      if (this.groupCount >= MAX_GROUPS) break;
      this.spawnGroup(g);
    }
  }

  private groupSFor(g: number): number {
    return g * GROUP_SPACING + hash01(this.seed, g, SALT_S) * GROUP_SPACING;
  }

  private hasGroup(g: number): boolean {
    for (let k = 0; k < this.groupCount; k++) if (this.groupRefs[k] === g) return true;
    return false;
  }

  private despawnGroup(groupIdx: number): void {
    const g = this.groupRefs[groupIdx]!;
    this.groupCount--;
    if (groupIdx !== this.groupCount) this.groupRefs[groupIdx] = this.groupRefs[this.groupCount]!;

    for (let i = this.activeCount - 1; i >= 0; i--) {
      if (this.birds[i]!.group === g) this.removeBird(i);
    }
  }

  private spawnGroup(g: number): void {
    this.groupRefs[this.groupCount++] = g;

    const seed = this.seed;
    const s = this.groupSFor(g);
    const side = hash01(seed, g, SALT_SIDE) < 0.5 ? -1 : 1;
    const species = this.pickSpecies(g);
    const count =
      species.minCount +
      Math.floor(hash01(seed, g, SALT_COUNT) * (species.maxCount - species.minCount + 1));
    const perchKind =
      species.perch === 'pole'
        ? 'pole'
        : species.perch === 'cactus'
          ? 'cactus'
          : hash01(seed, g, SALT_OFFSET) < 0.5
            ? 'pole'
            : 'cactus';
    const lateral =
      perchKind === 'pole'
        ? side * (POLE_LATERAL + hash01(seed, g, SALT_OFFSET) * 1.5)
        : side * (CACTUS_MIN_LATERAL + hash01(seed, g, SALT_OFFSET) * CACTUS_SPREAD);
    const perchHeight = perchKind === 'pole' ? POLE_HEIGHT : CACTUS_HEIGHT;

    this.road.offsetPoint(s, lateral, this.scratchPerch);
    const groundY = this.terrain.heightAt(this.scratchPerch.x, this.scratchPerch.z, s);
    const perchY = groundY + perchHeight;

    for (let k = 0; k < count; k++) {
      if (this.activeCount >= MAX_BIRDS) break;
      const jx = (hash01(seed, g, k, SALT_JITTER) - 0.5) * 0.9;
      const jz = (hash01(seed, g, k, SALT_JITTER + 1) - 0.5) * 0.9;
      const b = this.birds[this.activeCount]!;
      this.activeCount++;
      this.initBird(b, g, s, species, this.scratchPerch.x + jx, this.scratchPerch.z + jz, groundY, perchY, k);
    }
  }

  private pickSpecies(g: number): SpeciesDef {
    const r = hash01(this.seed, g, SALT_SPECIES);
    if (r < 0.16) return SPECIES[1]!; // vulture — rare, high, circling
    if (r < 0.62) return SPECIES[0]!; // crow — common roadside
    return SPECIES[2]!; // sparrow — small desert flocks
  }

  private initBird(
    b: Bird,
    g: number,
    s: number,
    sp: SpeciesDef,
    px: number,
    pz: number,
    groundY: number,
    perchY: number,
    k: number,
  ): void {
    const seed = this.seed;
    b.group = g;
    b.groupS = s;
    b.sHint = s;
    b.species = sp;
    b.x = px;
    b.z = pz;
    b.vx = 0;
    b.vy = 0;
    b.vz = 0;
    b.roll = 0;
    b.pitch = 0;
    b.phase = hash01(seed, g, k, SALT_YAW) * Math.PI * 2;
    b.scale = sp.scale * (0.9 + hash01(seed, g, k, SALT_JITTER + 2) * 0.2);
    b.lod = hash01(seed, g, k, SALT_LOD) * LOD_FAR_STEP;
    b.perchX = px;
    b.perchY = perchY;
    b.perchZ = pz;
    b.stateTimer = 0;
    b.targetYaw = hash01(seed, g, k, SALT_YAW) * Math.PI * 2;
    b.wanderTimer = 0;
    b.wanderCount = 0;
    b.wanderSalt = k;
    b.circleX = px;
    b.circleZ = pz;
    b.circleRadius = 18 + hash01(seed, g, k, SALT_YAW + 1) * 40;
    b.circleAngle = hash01(seed, g, k, SALT_YAW + 2) * Math.PI * 2;
    b.circleDir = hash01(seed, g, k, SALT_YAW + 3) < 0.5 ? 1 : -1;
    b.landX = px;
    b.landY = perchY;
    b.landZ = pz;

    const airborne = hash01(seed, g, k, SALT_AIR) < sp.airborneBias;
    if (airborne) {
      b.state = 'flying';
      b.y = groundY + sp.cruiseAlt;
      b.yaw = b.targetYaw;
      b.flapScale = 1;
      b.flightBudget = sp.flightBudget * (0.3 + hash01(seed, g, k, SALT_BUDGET) * 0.7);
      b.wanderTimer = 2;
    } else {
      b.state = 'perched';
      b.y = perchY;
      b.yaw = b.targetYaw;
      b.flapScale = 0.12;
      b.flightBudget = sp.flightBudget * (0.7 + hash01(seed, g, k, SALT_BUDGET) * 0.6);
    }
  }

  private removeBird(i: number): void {
    const removed = this.birds[i]!;
    this.activeCount--;
    if (i !== this.activeCount) this.birds[i] = this.birds[this.activeCount]!;
    this.birds[this.activeCount] = removed; // recycle into the free slot
  }

  // -- per-bird simulation ---------------------------------------------------

  private tickBird(b: Bird, dt: number, px: number, py: number, pz: number, alertRadiusSq: number): void {
    const sp = b.species;
    let flapActivity = 1.0;
    let flapTarget = 1.0;

    switch (b.state) {
      case 'perched': {
        flapActivity = 0.25;
        flapTarget = 0.12;
        const dx = b.x - px;
        const dy = b.y - py;
        const dz = b.z - pz;
        if (dx * dx + dy * dy + dz * dz < alertRadiusSq) {
          b.state = 'alerted';
          b.stateTimer = 0.3;
        }
        break;
      }
      case 'alerted':
        flapActivity = 1.6;
        flapTarget = 0.5;
        b.stateTimer -= dt;
        if (b.stateTimer <= 0) {
          this.beginTakeoff(b, px, pz);
          b.state = 'takeoff';
          b.stateTimer = 0.9;
        }
        break;
      case 'takeoff':
        flapActivity = 1.8;
        flapTarget = 1.0;
        b.stateTimer -= dt;
        this.fly(b, dt);
        if (b.stateTimer <= 0) b.state = 'flying';
        break;
      case 'flying':
        flapActivity = 1.0;
        flapTarget = 1.0;
        b.flightBudget -= dt;
        this.fly(b, dt);
        if (b.flightBudget <= 0) {
          b.state = 'landing';
          b.landX = b.perchX;
          b.landY = b.perchY;
          b.landZ = b.perchZ;
        }
        break;
      case 'landing':
        flapActivity = 1.3;
        flapTarget = 0.8;
        this.land(b, dt);
        break;
    }

    b.phase += sp.flapRate * flapActivity * dt;
    const blend = Math.min(1, dt * 6);
    b.flapScale += (flapTarget - b.flapScale) * blend;
  }

  private beginTakeoff(b: Bird, px: number, pz: number): void {
    let ax = b.x - px;
    let az = b.z - pz;
    const len = Math.hypot(ax, az);
    if (len < 1e-3) {
      ax = 0;
      az = -1;
    } else {
      ax /= len;
      az /= len;
    }
    b.yaw = Math.atan2(ax, az);
    b.targetYaw = b.yaw;
    b.vx = ax * b.species.cruiseSpeed;
    b.vz = az * b.species.cruiseSpeed;
    b.vy = b.species.climbRate;
    b.wanderTimer = 1.5;
  }

  private steer(b: Bird, dt: number): void {
    if (b.species.behavior === 'circle') {
      b.circleAngle += b.circleDir * (b.species.cruiseSpeed / b.circleRadius) * dt;
      const tx = b.circleX + Math.cos(b.circleAngle) * b.circleRadius;
      const tz = b.circleZ + Math.sin(b.circleAngle) * b.circleRadius;
      b.targetYaw = Math.atan2(tx - b.x, tz - b.z);
    } else {
      const hdx = b.perchX - b.x;
      const hdz = b.perchZ - b.z;
      if (hdx * hdx + hdz * hdz > HOME_RADIUS_SQ) {
        // Too far from home: head back so the projection hint stays valid.
        b.targetYaw = Math.atan2(hdx, hdz);
        b.wanderTimer = 1.0;
      } else {
        b.wanderTimer -= dt;
        if (b.wanderTimer <= 0) {
          b.wanderCount++;
          b.targetYaw = hash01(this.seed, b.group, b.wanderCount, b.wanderSalt) * Math.PI * 2;
          b.wanderTimer = 3.5 + hash01(this.seed, b.group, b.wanderCount, 0x0a) * 4;
        }
      }
    }
  }

  private fly(b: Bird, dt: number): void {
    const sp = b.species;
    this.steer(b, dt);

    const dyaw = angleDiff(b.targetYaw, b.yaw);
    const maxTurn = sp.turnRate * dt;
    const turn = clamp(dyaw, -maxTurn, maxTurn);
    b.yaw += turn;
    // Bank into the turn (negative roll dips the right wing for a right turn).
    const bankTarget = clamp((-turn / Math.max(dt, 1e-4)) * sp.bankGain, -1, 1);
    b.roll += (bankTarget - b.roll) * Math.min(1, dt * 4);

    b.vx = Math.sin(b.yaw) * sp.cruiseSpeed;
    b.vz = Math.cos(b.yaw) * sp.cruiseSpeed;

    const ground = this.terrain.heightAt(b.x, b.z, b.sHint);
    const targetY = ground + sp.cruiseAlt;
    b.vy = clamp((targetY - b.y) * 1.5, -sp.cruiseSpeed * 0.6, sp.cruiseSpeed * 0.6);

    const pitchTarget = clamp(b.vy * 0.12, -0.5, 0.5);
    b.pitch += (pitchTarget - b.pitch) * Math.min(1, dt * 3);

    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.z += b.vz * dt;

    // Hard guarantee: never below the terrain (uses the pre-step ground, since a
    // single tick moves a bird well under a metre).
    if (b.y < ground + MIN_CLEARANCE) {
      b.y = ground + MIN_CLEARANCE;
      if (b.vy < 0) b.vy = 0;
    }
  }

  private land(b: Bird, dt: number): void {
    const sp = b.species;
    const dx = b.landX - b.x;
    const dy = b.landY - b.y;
    const dz = b.landZ - b.z;
    const dist = Math.hypot(dx, dy, dz);

    if (dist < 0.6) {
      b.x = b.landX;
      b.y = b.landY;
      b.z = b.landZ;
      b.vx = 0;
      b.vy = 0;
      b.vz = 0;
      b.roll = 0;
      b.pitch = 0;
      b.state = 'perched';
      b.flapScale = 0.12;
      return;
    }

    const speed = Math.min(sp.cruiseSpeed, dist * 1.2 + 1.5);
    const yawTarget = Math.atan2(dx, dz);
    const dyaw = angleDiff(yawTarget, b.yaw);
    const maxTurn = sp.turnRate * dt;
    const turn = clamp(dyaw, -maxTurn, maxTurn);
    b.yaw += turn;
    const bankTarget = clamp((-turn / Math.max(dt, 1e-4)) * sp.bankGain, -1, 1);
    b.roll += (bankTarget - b.roll) * Math.min(1, dt * 4);

    b.vx = Math.sin(b.yaw) * speed;
    b.vz = Math.cos(b.yaw) * speed;
    b.vy = (dy / Math.max(dist, 1e-3)) * speed;

    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.z += b.vz * dt;

    const ground = this.terrain.heightAt(b.x, b.z, b.sHint);
    if (b.y < ground + MIN_CLEARANCE) b.y = ground + MIN_CLEARANCE;
  }

  private startleNear(ox: number, oy: number, oz: number): void {
    for (let i = 0; i < this.activeCount; i++) {
      const b = this.birds[i]!;
      if (b.state !== 'perched' && b.state !== 'alerted') continue;
      const dx = b.x - ox;
      const dy = b.y - oy;
      const dz = b.z - oz;
      if (dx * dx + dy * dy + dz * dz < STARTLE_RADIUS_SQ && b.state === 'perched') {
        b.state = 'alerted';
        b.stateTimer = 0.3;
      }
    }
  }

  // -- rendering --------------------------------------------------------------

  private syncMeshes(): void {
    for (let i = 0; i < this.activeCount; i++) {
      const b = this.birds[i]!;
      this.e.set(b.pitch, b.yaw, b.roll, 'YXZ');
      this.q.setFromEuler(this.e);
      this.pv.set(b.x, b.y, b.z);
      this.sv.setScalar(b.scale);
      this.m.compose(this.pv, this.q, this.sv);
      this.mesh.setMatrixAt(i, this.m);

      this.col.setHex(b.species.color);
      this.mesh.setColorAt(i, this.col);

      (this.phaseAttr.array as Float32Array)[i] = b.phase;
      (this.flapAttr.array as Float32Array)[i] = b.flapScale;
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.phaseAttr.needsUpdate = true;
    this.flapAttr.needsUpdate = true;
    this.mesh.count = this.activeCount;
  }

  private spawnFalling(b: Bird): void {
    for (let i = 0; i < this.falling.length; i++) {
      const f = this.falling[i]!;
      if (f.active) continue;
      f.active = true;
      f.mesh.visible = true;
      f.x = b.x;
      f.y = b.y;
      f.z = b.z;
      f.vx = b.vx * 0.2;
      f.vy = 0;
      f.vz = b.vz * 0.2;
      f.rx = 0;
      f.ry = b.yaw;
      f.rz = b.roll;
      f.spinX = 3 + (hash01(this.seed, b.group, 0x0b) - 0.5) * 4;
      f.spinY = 2 + (hash01(this.seed, b.group, 0x0c) - 0.5) * 4;
      f.spinZ = 3 + (hash01(this.seed, b.group, 0x0d) - 0.5) * 4;
      f.life = 2.5;
      f.scale = b.scale;
      f.sHint = b.sHint;
      f.mesh.scale.setScalar(b.scale);
      f.mesh.position.set(b.x, b.y, b.z);
      return;
    }
  }

  private tickFalling(dt: number): void {
    for (let i = 0; i < this.falling.length; i++) {
      const f = this.falling[i]!;
      if (!f.active) continue;
      f.life -= dt;
      f.vy -= 9.8 * dt;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.z += f.vz * dt;
      f.rx += f.spinX * dt;
      f.ry += f.spinY * dt;
      f.rz += f.spinZ * dt;

      const ground = this.terrain.heightAt(f.x, f.z, f.sHint);
      if (f.y <= ground + 0.1 || f.life <= 0) {
        f.active = false;
        f.mesh.visible = false;
        continue;
      }
      f.mesh.position.set(f.x, f.y, f.z);
      f.mesh.rotation.set(f.rx, f.ry, f.rz);
    }
  }
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/**
 * Low-poly bird, local axes +X right / +Y up / +Z forward. A vertical rhombus
 * fuselage plus two swept wing triangles; each vertex carries `aWing` (0 = body,
 * +1 = right wing, -1 = left wing) so the shader can flap only the wings by
 * rotating them around the forward axis.
 */
function buildBirdGeometry(): THREE.BufferGeometry {
  const positions = new Float32Array([
    // body
    0.0, 0.02, 0.3, // 0 nose
    0.0, 0.1, 0.02, // 1 crown
    0.0, 0.05, -0.28, // 2 tail
    0.0, -0.02, 0.0, // 3 belly
    // right wing
    0.0, 0.0, 0.06, // 4 root front
    0.0, 0.0, -0.2, // 5 root back
    0.42, 0.02, -0.06, // 6 tip
    // left wing
    0.0, 0.0, 0.06, // 7 root front
    0.0, 0.0, -0.2, // 8 root back
    -0.42, 0.02, -0.06, // 9 tip
  ]);
  const wing = new Float32Array([0, 0, 0, 0, 1, 1, 1, -1, -1, -1]);
  const index = new Uint16Array([0, 1, 2, 0, 2, 3, 4, 5, 6, 7, 9, 8]);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aWing', new THREE.BufferAttribute(wing, 1));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  geometry.computeVertexNormals();
  return geometry;
}

function makeEmptyBird(): Bird {
  return {
    group: 0,
    groupS: 0,
    sHint: 0,
    species: SPECIES[0]!,
    state: 'perched',
    x: 0, y: 0, z: 0,
    vx: 0, vy: 0, vz: 0,
    yaw: 0, roll: 0, pitch: 0,
    phase: 0, flapScale: 0, scale: 1,
    lod: 0,
    perchX: 0, perchY: 0, perchZ: 0,
    stateTimer: 0, flightBudget: 0,
    targetYaw: 0, wanderTimer: 0, wanderCount: 0, wanderSalt: 0,
    circleX: 0, circleZ: 0, circleRadius: 0, circleAngle: 0, circleDir: 1,
    landX: 0, landY: 0, landZ: 0,
  };
}
