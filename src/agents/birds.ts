import * as THREE from 'three';
import { hash01 } from '../core/rng';
import { WorldOrigin, type RebaseShift } from '../world/origin';
import { ROAD_HALF_WIDTH, type Road } from '../world/road';
import type { Terrain } from '../world/terrain';

/**
 * Desert birds: the only sign of life out on the road.
 *
 * Birds are kinematic agents — there is not a single Rapier collider here. They
 * live in one `InstancedMesh`; lightweight per-instance attributes vary silhouette,
 * wing pose and animation while the shader bends the wings. Per-frame work remains
 * matrix and attribute writes, never geometry rebuilds.
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
/** Distance from the perch (m) inside which a landing bird may drop below that
 *  clearance to actually reach it. Short enough that the ground it descends over is
 *  the perch's own patch of road. */
const LAND_FLARE = 4;
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
const SALT_JITTER = 0xe6f1;
const SALT_AIR = 0xf7a2;
const SALT_YAW = 0x1803;
const SALT_BUDGET = 0x2944;

// Perches. Birds rest ON THE ROAD, and the reason is exactness rather than romance.
//
// They used to rest on *approximations* of the pole line and the cacti — a height and
// a lateral offset that a pole or a cactus would plausibly have, deliberately never
// reading another provider's chunk content. The trouble is that a plausible perch is
// not a perch: the pole line runs down ONE side at a fixed 6 m and only every few
// dozen metres, and the cactus scatter puts a plant roughly once per thousand square
// metres, so a bird placed at "cactus height, 34 to 94 m out" was almost never on a
// cactus. It was sitting on nothing, six or two metres up, which is exactly what it
// looked like.
//
// The road is the one surface in the world whose height is known EXACTLY at an
// arbitrary point — `heightFromFrame` inside the corridor returns `roadSurfaceY`, the
// same function the ribbon's own vertices come from, camber, bumps and potholes
// included. A bird standing on it cannot hover, and a flock scattering off the asphalt
// as a car comes is worth more than one perched on scenery that is not there.
/** Widest lateral offset a bird stands at: on the asphalt, clear of the shoulder. */
const PERCH_LATERAL = ROAD_HALF_WIDTH - 0.5;
/** Metres of road a flock is strung along, so it is a scatter and not a line. */
const PERCH_S_SPREAD = 7;
/** Belly clearance above the surface. The geometry's belly sits 0.02 below its own
 *  origin, so this is the difference between standing on the road and standing in it. */
const PERCH_STAND = 0.04;

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
  readonly flapDepth: number;
  readonly wingPose: number;
  readonly flightStyle: 'steady' | 'burst' | 'soar';
  readonly animationPeriod: number;
  readonly behavior: 'wander' | 'circle';
  readonly minCount: number;
  readonly maxCount: number;
  readonly flightBudget: number;
  readonly turnRate: number;
  readonly bankGain: number;
  readonly climbRate: number;
  readonly airborneBias: number;
  /** Shader-side proportions: length, span, rearward wing sweep and body depth. */
  readonly bodyLength: number;
  readonly wingSpan: number;
  readonly wingSweep: number;
  readonly bodyDepth: number;
}

const SPECIES: readonly SpeciesDef[] = [
  {
    name: 'crow', mass: 0.45, scale: 0.9, color: 0x302b27,
    cruiseSpeed: 9, cruiseAlt: 16, flapRate: 9.5, flapDepth: 0.88, wingPose: 0.03,
    flightStyle: 'steady', animationPeriod: 1, behavior: 'wander',
    minCount: 2, maxCount: 5, flightBudget: 24, turnRate: 2.2, bankGain: 0.35,
    climbRate: 5, airborneBias: 0.35,
    bodyLength: 1, wingSpan: 0.96, wingSweep: 0.03, bodyDepth: 1,
  },
  {
    name: 'vulture', mass: 9.2, scale: 2.6, color: 0x29231d,
    cruiseSpeed: 7, cruiseAlt: 55, flapRate: 3.2, flapDepth: 0.7, wingPose: 0.12,
    flightStyle: 'soar', animationPeriod: 7.2, behavior: 'circle',
    minCount: 1, maxCount: 3, flightBudget: 120, turnRate: 0.7, bankGain: 0.6,
    climbRate: 2.5, airborneBias: 0.85,
    bodyLength: 1.16, wingSpan: 1.3, wingSweep: 0.08, bodyDepth: 1.05,
  },
  {
    name: 'sparrow', mass: 0.03, scale: 0.38, color: 0x806a45,
    cruiseSpeed: 11, cruiseAlt: 10, flapRate: 17, flapDepth: 0.96, wingPose: -0.02,
    flightStyle: 'burst', animationPeriod: 1.45, behavior: 'wander',
    minCount: 3, maxCount: 7, flightBudget: 16, turnRate: 3.4, bankGain: 0.28,
    climbRate: 6, airborneBias: 0.3,
    bodyLength: 0.78, wingSpan: 0.76, wingSweep: 0.04, bodyDepth: 0.88,
  },
  {
    name: 'hawk', mass: 1.05, scale: 1.3, color: 0x6a4e32,
    cruiseSpeed: 12, cruiseAlt: 36, flapRate: 5.8, flapDepth: 0.78, wingPose: 0.08,
    flightStyle: 'soar', animationPeriod: 5.4, behavior: 'circle',
    minCount: 1, maxCount: 2, flightBudget: 72, turnRate: 1.35, bankGain: 0.52,
    climbRate: 4.2, airborneBias: 0.72,
    bodyLength: 1.02, wingSpan: 1.14, wingSweep: 0.15, bodyDepth: 0.94,
  },
  {
    name: 'swallow', mass: 0.02, scale: 0.34, color: 0x263b43,
    cruiseSpeed: 16, cruiseAlt: 20, flapRate: 20, flapDepth: 0.82, wingPose: -0.04,
    flightStyle: 'burst', animationPeriod: 1.05, behavior: 'wander',
    minCount: 4, maxCount: 8, flightBudget: 27, turnRate: 4.4, bankGain: 0.34,
    climbRate: 7, airborneBias: 0.62,
    bodyLength: 0.72, wingSpan: 1.08, wingSweep: 0.22, bodyDepth: 0.76,
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
  motionTime: number;
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
  private readonly shapeAttr: THREE.InstancedBufferAttribute;
  private readonly wingPoseAttr: THREE.InstancedBufferAttribute;
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

  constructor(
    scene: THREE.Scene,
    road: Road,
    terrain: Terrain,
    seed: number,
    private readonly origin: WorldOrigin,
  ) {
    this.scene = scene;
    this.road = road;
    this.terrain = terrain;
    this.seed = seed >>> 0;
    // Bird positions are RELATIVE (instance matrices and falling meshes are f32),
    // so a rebase must shift every one of them — and the cached player position used
    // for the speed estimate — by the frame step. Register here; the flock lives for
    // the whole session, which is the register() contract.
    origin.register(this);

    const instGeometry = buildBirdGeometry();
    this.phaseAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAX_BIRDS), 1);
    this.flapAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAX_BIRDS), 1);
    this.shapeAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAX_BIRDS * 4), 4);
    this.wingPoseAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAX_BIRDS), 1);
    this.phaseAttr.setUsage(THREE.DynamicDrawUsage);
    this.flapAttr.setUsage(THREE.DynamicDrawUsage);
    this.shapeAttr.setUsage(THREE.DynamicDrawUsage);
    this.wingPoseAttr.setUsage(THREE.DynamicDrawUsage);
    instGeometry.setAttribute('aPhase', this.phaseAttr);
    instGeometry.setAttribute('aFlapScale', this.flapAttr);
    instGeometry.setAttribute('aShape', this.shapeAttr);
    instGeometry.setAttribute('aWingPose', this.wingPoseAttr);

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
            'attribute float aWing;\n' +
            'attribute float aWingPose;\n' +
            'attribute vec4 aShape;\n',
        )
        .replace(
          '#include <begin_vertex>',
          // Shape each species and bend the wings progressively from root to tip.
          // Roots have aWing near zero, so they stay attached to the body.
          'vec3 transformed = vec3( position );\n' +
            'transformed.z *= aShape.x;\n' +
            'transformed.y *= aShape.w;\n' +
            '{\n' +
            '  float wingWeight = abs( aWing );\n' +
            '  if ( wingWeight > 1e-4 ) {\n' +
            '    transformed.x *= mix( 1.0, aShape.y, wingWeight );\n' +
            '    transformed.z -= wingWeight * aShape.z;\n' +
            `    float wingAngle = aWingPose + sin( aPhase ) * aFlapScale * ${FLAP_MAX};\n` +
            '    float w = sign( aWing ) * wingWeight * wingAngle;\n' +
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

  /**
   * Rebasable: every cached position here is RELATIVE and must shift with the frame
   * step. Heights (`y`, `perchY`, `landY`, `lastPy`) are vertical and never touch the
   * origin, so they stay. Falling corpses shift their own mesh positions too rather
   * than waiting for the next `tickFalling`, so a rebase never renders one out of
   * step. The instance matrices are rebuilt every frame in `syncMeshes` from these
   * shifted positions and need nothing here. The speed-estimate cache (`lastPx`/`lastPz`)
   * is a cached relative position, so it shifts as well.
   */
  rebase(shift: RebaseShift): void {
    for (let i = 0; i < this.activeCount; i++) {
      const b = this.birds[i]!;
      b.x -= shift.dx;
      b.z -= shift.dz;
      b.perchX -= shift.dx;
      b.perchZ -= shift.dz;
      b.circleX -= shift.dx;
      b.circleZ -= shift.dz;
      b.landX -= shift.dx;
      b.landZ -= shift.dz;
    }
    for (const f of this.falling) {
      if (!f.active) continue;
      f.x -= shift.dx;
      f.z -= shift.dz;
      f.mesh.position.x -= shift.dx;
      f.mesh.position.z -= shift.dz;
    }
    this.lastPx -= shift.dx;
    this.lastPz -= shift.dz;
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

    // Even the distant/high birds advance every frame. The old 5 Hz far-LOD updated
    // both flight position and wing phase in visible jumps; active flocks are small
    // enough that continuous kinematic simulation is cheaper than hiding that stutter.
    for (let i = 0; i < this.activeCount; i++) {
      this.tickBird(this.birds[i]!, dt, px, py, pz, alertRadiusSq);
    }

    this.syncMeshes();
    this.tickFalling(dt);
  }

  /**
   * Hit test against a ray from the camera. Both sides are RELATIVE: the ray origin
   * comes from `camera.eyePosition` (relative) and the birds hold relative positions,
   * so `b.x - ox` below never mixes frames and needs no origin conversion.
   */
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
    // `road.offsetPoint` is ABSOLUTE (the road is the absolute f64 frame), but a
    // bird's stored position is RELATIVE (its instance matrix is f32). Subtract the
    // origin once here so every bird in the group is born relative; the heights are
    // heights and never touch the origin.
    const ox = this.origin.x;
    const oz = this.origin.z;

    for (let k = 0; k < count; k++) {
      if (this.activeCount >= MAX_BIRDS) break;
      // Each bird gets its OWN road frame point rather than a jittered copy of the
      // group's. The road is cambered and has bumps and potholes in it, so a bird two
      // metres away is standing at a different height; one shared height would leave
      // half a flock hovering and the other half sunk, which is the bug this replaces
      // in miniature.
      const bs = s + (hash01(seed, g, k, SALT_JITTER) - 0.5) * PERCH_S_SPREAD;
      const lateral = side * PERCH_LATERAL * hash01(seed, g, k, SALT_OFFSET);
      this.road.offsetPoint(bs, lateral, this.scratchPerch);
      const surfaceY = this.terrain.heightFromFrame(
        this.scratchPerch.x,
        this.scratchPerch.z,
        lateral,
        bs,
      );
      const b = this.birds[this.activeCount]!;
      this.activeCount++;
      this.initBird(
        b,
        g,
        s,
        species,
        this.scratchPerch.x - ox,
        this.scratchPerch.z - oz,
        surfaceY,
        surfaceY + PERCH_STAND,
        k,
      );
    }
  }

  private pickSpecies(g: number): SpeciesDef {
    const r = hash01(this.seed, g, SALT_SPECIES);
    if (r < 0.1) return SPECIES[1]!; // vulture — rare, high, circling
    if (r < 0.22) return SPECIES[3]!; // hawk — solitary, agile soaring
    if (r < 0.55) return SPECIES[0]!; // crow — common roadside
    if (r < 0.75) return SPECIES[4]!; // swallow — fast, darting flocks
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
    b.motionTime = hash01(seed, g, k, SALT_BUDGET + 1) * sp.animationPeriod;
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
      b.flapScale = sp.flightStyle === 'soar' ? 0.08 : sp.flapDepth;
      b.flightBudget = sp.flightBudget * (0.3 + hash01(seed, g, k, SALT_BUDGET) * 0.7);
      b.wanderTimer = 2;
    } else {
      b.state = 'perched';
      b.y = perchY;
      b.yaw = b.targetYaw;
      b.flapScale = 0.06;
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
    b.motionTime += dt;
    let flapActivity = 1.0;
    let flapTarget = sp.flapDepth;

    switch (b.state) {
      case 'perched': {
        flapActivity = 0.18;
        flapTarget = 0.06;
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
        flapActivity = 1.5;
        flapTarget = sp.flapDepth * 0.55;
        b.stateTimer -= dt;
        if (b.stateTimer <= 0) {
          this.beginTakeoff(b, px, pz);
          b.state = 'takeoff';
          b.stateTimer = 0.9;
        }
        break;
      case 'takeoff':
        flapActivity = 1.8;
        flapTarget = sp.flapDepth;
        b.stateTimer -= dt;
        this.fly(b, dt);
        if (b.stateTimer <= 0) b.state = 'flying';
        break;
      case 'flying': {
        const cycle = b.motionTime % sp.animationPeriod;
        if (sp.flightStyle === 'soar') {
          const powered = cycle < 1.15;
          flapActivity = powered ? 1.15 : 0.07;
          flapTarget = powered ? sp.flapDepth : 0.035;
        } else if (sp.flightStyle === 'burst') {
          const powered = cycle < sp.animationPeriod * 0.62;
          flapActivity = powered ? 1.1 : 0.12;
          flapTarget = powered ? sp.flapDepth : 0.06;
        }
        b.flightBudget -= dt;
        this.fly(b, dt);
        if (b.flightBudget <= 0) {
          b.state = 'landing';
          b.landX = b.perchX;
          b.landY = b.perchY;
          b.landZ = b.perchZ;
        }
        break;
      }
      case 'landing':
        flapActivity = 1.25;
        flapTarget = sp.flapDepth * 0.78;
        this.land(b, dt);
        break;
    }

    b.phase += sp.flapRate * flapActivity * dt;
    if (b.phase > Math.PI * 2) b.phase %= Math.PI * 2;
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

    // `terrain.heightAt` is ABSOLUTE but `b` holds RELATIVE positions, so add the
    // origin here; every other use of `b.x/b.z` (steering, integration) is
    // relative-to-relative and stays frame-consistent.
    const ground = this.terrain.heightAt(b.x + this.origin.x, b.z + this.origin.z, b.sHint);
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
      b.flapScale = 0.06;
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

    // ABSOLUTE field, RELATIVE bird — add the origin (see `fly`).
    //
    // The flying floor CANNOT apply all the way in. It is there to stop a bird flying
    // into a dune, but a landing bird is trying to reach the ground, and clamping it to
    // `MIN_CLEARANCE` above the terrain the whole way meant it could never close the
    // last 1.4 m to a perch lower than that: it hovered at the clamp, still in
    // `landing`, forever. The old cactus and pole perches were 2.3 m and 6.4 m up and
    // so cleared it by accident. Inside the flare the floor is the perch itself, which
    // is on the road and therefore cannot be inside anything.
    const ground = this.terrain.heightAt(b.x + this.origin.x, b.z + this.origin.z, b.sHint);
    const floor = dist < LAND_FLARE ? b.landY : Math.max(b.landY, ground + MIN_CLEARANCE);
    if (b.y < floor) b.y = floor;
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
    const phases = this.phaseAttr.array as Float32Array;
    const flaps = this.flapAttr.array as Float32Array;
    const shapes = this.shapeAttr.array as Float32Array;
    const wingPoses = this.wingPoseAttr.array as Float32Array;
    for (let i = 0; i < this.activeCount; i++) {
      const b = this.birds[i]!;
      const sp = b.species;
      this.e.set(b.pitch, b.yaw, b.roll, 'YXZ');
      this.q.setFromEuler(this.e);
      this.pv.set(b.x, b.y, b.z);
      this.sv.setScalar(b.scale);
      this.m.compose(this.pv, this.q, this.sv);
      this.mesh.setMatrixAt(i, this.m);

      this.col.setHex(sp.color);
      this.mesh.setColorAt(i, this.col);

      phases[i] = b.phase;
      flaps[i] = b.flapScale;
      wingPoses[i] = sp.wingPose;
      const shapeOffset = i * 4;
      shapes[shapeOffset] = sp.bodyLength;
      shapes[shapeOffset + 1] = sp.wingSpan;
      shapes[shapeOffset + 2] = sp.wingSweep;
      shapes[shapeOffset + 3] = sp.bodyDepth;
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.phaseAttr.needsUpdate = true;
    this.flapAttr.needsUpdate = true;
    this.shapeAttr.needsUpdate = true;
    this.wingPoseAttr.needsUpdate = true;
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

      // ABSOLUTE field, RELATIVE corpse — add the origin (see `fly`).
      const ground = this.terrain.heightAt(f.x + this.origin.x, f.z + this.origin.z, f.sHint);
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
 * Low-poly bird, local axes +X right / +Y up / +Z forward. The closed faceted
 * fuselage, separate head, forked tail and two-segment wings keep a readable
 * silhouette up close without adding a draw call. `aWing` is signed and weighted
 * from root to tip so the shader bends each wing without opening a gap at its root.
 */
function buildBirdGeometry(): THREE.BufferGeometry {
  const positions = new Float32Array([
    // Faceted fuselage: front, rear, top, belly, right and left.
    0, 0.03, 0.23, 0, 0.035, -0.27, 0, 0.13, 0.01,
    0, -0.075, 0.015, 0.095, 0.025, 0.01, -0.095, 0.025, 0.01,
    // Angular head / beak.
    0, 0.04, 0.4, 0, 0.15, 0.2, 0.08, 0.06, 0.23, -0.08, 0.06, 0.23,
    // Forked tail fan.
    -0.05, 0.035, -0.22, 0.05, 0.035, -0.22, -0.16, 0.03, -0.44,
    0, 0.015, -0.35, 0.16, 0.03, -0.44,
    // Right wing: two triangles, with a softly hinged mid-span.
    0.055, 0.055, 0.12, 0.06, 0.045, -0.17, 0.3, 0.035, -0.015, 0.54, 0.025, -0.14,
    // Left wing.
    -0.055, 0.055, 0.12, -0.06, 0.045, -0.17, -0.3, 0.035, -0.015, -0.54, 0.025, -0.14,
  ]);
  const wing = new Float32Array([
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0.06, 0.06, 0.58, 1,
    -0.06, -0.06, -0.58, -1,
  ]);
  const index = new Uint16Array([
    // Fuselage.
    0, 2, 4, 0, 4, 3, 0, 3, 5, 0, 5, 2,
    1, 4, 2, 1, 3, 4, 1, 5, 3, 1, 2, 5,
    // Head.
    6, 7, 8, 6, 8, 9, 6, 9, 7, 7, 9, 8,
    // Tail.
    10, 13, 12, 10, 11, 13, 11, 14, 13,
    // Wings.
    15, 17, 18, 15, 18, 16, 19, 22, 21, 19, 20, 22,
  ]);

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
    motionTime: 0,
    perchX: 0, perchY: 0, perchZ: 0,
    stateTimer: 0, flightBudget: 0,
    targetYaw: 0, wanderTimer: 0, wanderCount: 0, wanderSalt: 0,
    circleX: 0, circleZ: 0, circleRadius: 0, circleAngle: 0, circleDir: 1,
    landX: 0, landY: 0, landZ: 0,
  };
}
