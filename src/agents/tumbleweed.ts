import * as THREE from 'three';
import { hash01 } from '../core/rng';
import type { Impactor } from '../world/debris';
import { WorldOrigin, type RebaseShift } from '../world/origin';
import type { Road } from '../world/road';
import type { Terrain } from '../world/terrain';
import type { WheelSpray } from '../render/wheelspray';

/**
 * Windborne tumbleweeds: a deliberately tiny field of cheap, breakable motion.
 *
 * This uses an analytic rolling/ballistic integrator instead of a Rapier body per weed.
 * Ten dynamic bodies were tried in the traffic prototype; their broad-phase pairs and
 * solver work were disproportionate to props that must neither block nor interest the
 * autopilot. The field therefore pays ten terrain samples, ten matrix writes, and at
 * most one OBB hit test per fixed step. The cap is ten: enough to make crossings feel
 * common over a 520 m road band, while its worst case is fixed before a frame begins.
 */

/** Ten instances are visible enough at highway speed; more made the roadside read busy. */
export const TUMBLEWEED_CAP = 10;
/** Slots are sparse enough that the cap survives a run of favourable hashes. */
const SLOT_SPACING = 58;
/**
 * How far ahead the band reaches, metres, and why it is not further.
 *
 * A weed crosses the carriageway in two or three seconds. At 360 m the car needed
 * twenty seconds to arrive, so every weed had finished crossing and rolled a hundred
 * metres into the desert before the player got there — measured in play: the nearest
 * weed sat 90-180 m ahead for a whole minute and none was ever met. 220 m keeps weeds
 * visible in the middle distance while the STAGING below is what actually puts one on
 * the asphalt as the car arrives.
 */
const AHEAD_METRES = 220;
/** Keeping a short rear margin prevents pop-out at the chase camera edge. */
const BEHIND_METRES = 160;
/** A slot gets a weed two times in three; the cap is still the hard population bound. */
const SLOT_CHANCE = 0.66;
/**
 * STAGING: how far out on the verge a weed starts, so that its crossing and the car's
 * arrival coincide.
 *
 * A weed is placed at `wind speed * time for the car to reach the slot`, which puts it
 * ON the road about when the car is. The window is then deliberately smeared by
 * `STAGE_JITTER` so some weeds cross early, some late, and only some are actually met
 * — a road where every weed is a guaranteed hit is a corridor of skittles.
 *
 * Bounded at both ends: closer than `STAGE_MIN` and a weed appears already on the
 * asphalt in front of the bumper, further than `STAGE_MAX` and it is a dot nobody
 * connects with the road.
 */
const STAGE_JITTER = 0.55;
const STAGE_MIN = 6;
const STAGE_MAX = 70;
/** Fallback closing speed while on foot, m/s: about the speed a car actually travels. */
const STAGE_DEFAULT_SPEED = 22;
/**
 * A weed retires once it has rolled this far from where it started, whatever its slot
 * says. Without it a weed that has crossed and gone keeps its pool slot for the whole
 * width of the band, and the field thins to four or five live instead of the ten it is
 * budgeted for.
 */
const TRAVEL_RETIRE_M = 110;
/** Cactus sections are 0.85 m tall by 0.40–0.45 m across; this is their visual peer. */
const RADIUS = 0.42;
/**
 * WIND, and why it is a target velocity rather than a force.
 *
 * The first cut accelerated a weed with a small per-weed gust and then applied linear
 * drag. Both terms are bounded, so the equilibrium was the gust over the drag — under
 * one metre a second — and a weed spawned at walking pace crawled to a halt within two
 * seconds and sat in the sand. A tumbleweed does not do that: it is a light cage the
 * wind carries at very nearly the wind's own speed.
 *
 * So each weed relaxes towards ITS OWN wind vector, aimed across the road at spawn (see
 * `spawn`) at 3.5-6 m/s — a stiff desert breeze, and fast enough that a crossing takes
 * a few seconds and can be met at speed. `WIND_RELAX` is per second: 1.6 means a weed
 * knocked off course by a bounce is back on the wind inside a second, which is what
 * makes a hop read as a hop rather than as a change of plan.
 */
const WIND_SPEED_MIN = 3.5;
const WIND_SPEED_RANGE = 2.5;
const WIND_RELAX = 1.6;
/** Restitution is intentionally modest: dry brush hops rather than becoming a tennis ball. */
const GROUND_BOUNCE = 0.34;
/** Gravity is real g because this is fixed-step ballistic motion, not a visual offset. */
const GRAVITY = 9.81;
/** Squared bumper skin catches a 0.84 m ball without pretending it is a cactus trunk. */
const HIT_SKIN = 0.55;
const HIT_SKIN_SQ = HIT_SKIN * HIT_SKIN;

interface Weed {
  slot: number;
  sHint: number;
  x: number;
  y: number;
  z: number;
  /** Where it started, origin-relative: the travel-based retirement measures from it. */
  originX: number;
  originZ: number;
  vx: number;
  vy: number;
  vz: number;
  /** This weed's own wind, m/s: the velocity it relaxes towards while grounded. */
  wx: number;
  wz: number;
  /** Accumulated roll angle, radians, about the axis across its travel. */
  roll: number;
}

/** Reused output: main applies a tiny body nudge and a quiet existing foley clunk. */
export interface TumbleweedHit {
  readonly count: number;
  readonly x: number;
  readonly z: number;
}

/**
 * Fixed pool and one instanced twig ball. All stored X/Z values are origin-relative;
 * terrain samples add the origin back first, preserving the absolute noise field after
 * a floating-origin rebase.
 */
export class TumbleweedField {
  private readonly mesh: THREE.InstancedMesh;
  private readonly weeds: Weed[] = new Array(TUMBLEWEED_CAP);
  private activeCount = 0;
  private readonly matrix = new THREE.Matrix4();
  private readonly quaternion = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3(1, 1, 1);
  private readonly hit = { count: 0, x: 0, z: 0 };
  /** Entity objects are created once in the constructor; spawning only overwrites them. */
  private readonly pooledAllocationCount = TUMBLEWEED_CAP;
  private spawnedCount = 0;

  constructor(
    scene: THREE.Scene,
    private readonly road: Road,
    private readonly terrain: Terrain,
    private readonly seed: number,
    private readonly origin: WorldOrigin,
    private readonly spray: WheelSpray,
  ) {
    for (let i = 0; i < TUMBLEWEED_CAP; i++) this.weeds[i] = emptyWeed();
    this.mesh = new THREE.InstancedMesh(buildTumbleweedGeometry(), new THREE.MeshStandardMaterial({
      color: 0x765234,
      roughness: 1,
      metalness: 0,
      flatShading: true,
      side: THREE.DoubleSide,
    }), TUMBLEWEED_CAP);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    scene.add(this.mesh);
    origin.register(this);
  }

  rebase(shift: RebaseShift): void {
    for (let i = 0; i < this.activeCount; i++) {
      const weed = this.weeds[i]!;
      weed.x -= shift.dx;
      weed.z -= shift.dz;
    }
  }

  /** Advances only the fixed pool and returns the hits consumed during this step. */
  update(dt: number, playerS: number, impactor: Impactor | null): TumbleweedHit {
    this.hit.count = 0;
    const closing = impactor
      ? Math.max(6, Math.hypot(impactor.vx, impactor.vz))
      : STAGE_DEFAULT_SPEED;
    this.spawnAndRetire(playerS, closing);
    for (let i = 0; i < this.activeCount; i++) {
      const weed = this.weeds[i]!;
      this.integrate(weed, dt);
      if (impactor && this.hitsCar(weed, impactor)) {
        this.spray.emitBurst(weed.x, weed.y, weed.z, impactor.fx, impactor.fz, Math.hypot(impactor.vx, impactor.vz));
        this.hit.count++;
        this.hit.x = impactor.fx;
        this.hit.z = impactor.fz;
        this.retire(i--);
      }
    }
    this.syncMesh();
    return this.hit;
  }

  /** Bench-visible accounting: active slots are the entire steady-state allocation surface. */
  get liveCount(): number { return this.activeCount; }
  /** Pool construction count remains invariant across spawn/retire churn. */
  get allocationCount(): number { return this.pooledAllocationCount; }

  /** Bench-only count of slot activations; it distinguishes churn from object creation. */
  get spawnCount(): number { return this.spawnedCount; }


  private spawnAndRetire(playerS: number, closingSpeed: number): void {
    const minSlot = Math.floor((playerS - BEHIND_METRES) / SLOT_SPACING);
    const maxSlot = Math.floor((playerS + AHEAD_METRES) / SLOT_SPACING);
    for (let i = this.activeCount - 1; i >= 0; i--) {
      const weed = this.weeds[i]!;
      const travelled = Math.hypot(weed.x - weed.originX, weed.z - weed.originZ);
      if (weed.slot < minSlot || weed.slot > maxSlot || travelled > TRAVEL_RETIRE_M) {
        this.retire(i);
      }
    }
    for (let slot = minSlot; slot <= maxSlot && this.activeCount < TUMBLEWEED_CAP; slot++) {
      if (hash01(this.seed, slot, 0x7a11) > SLOT_CHANCE || this.hasSlot(slot)) continue;
      this.spawn(slot, playerS, closingSpeed);
    }
  }

  private hasSlot(slot: number): boolean {
    for (let i = 0; i < this.activeCount; i++) if (this.weeds[i]!.slot === slot) return true;
    return false;
  }

  private spawn(slot: number, playerS: number, closingSpeed: number): void {
    const weed = this.weeds[this.activeCount++]!;
    const s = (slot + 0.5 + (hash01(this.seed, slot, 0x7a12) - 0.5) * 0.7) * SLOT_SPACING;
    const road = this.road.sampleAt(s);
    const side = hash01(this.seed, slot, 0x7a13) < 0.5 ? -1 : 1;
    const speed = WIND_SPEED_MIN + hash01(this.seed, slot, 0x7a15) * WIND_SPEED_RANGE;
    // STAGING (see the constants): start the weed as far out as its own wind will
    // carry it in the time the player needs to reach this slot, smeared so the
    // meeting is a coincidence rather than an appointment.
    const reach = Math.max(0, s - playerS) / closingSpeed;
    const jitter = 1 + (hash01(this.seed, slot, 0x7a19) * 2 - 1) * STAGE_JITTER;
    const stand = Math.min(STAGE_MAX, Math.max(STAGE_MIN, speed * reach * jitter));
    const lateral = side * stand;
    // Positive lateral is left; this vector points from the verge across the asphalt.
    const crossX = -side * Math.cos(road.heading);
    const crossZ = side * Math.sin(road.heading);
    weed.slot = slot;
    weed.sHint = s;
    this.spawnedCount++;
    weed.x = road.x + Math.cos(road.heading) * lateral - this.origin.x;
    weed.z = road.z - Math.sin(road.heading) * lateral - this.origin.z;
    weed.y = this.terrain.heightAt(weed.x + this.origin.x, weed.z + this.origin.z, s) + RADIUS;
    weed.originX = weed.x;
    weed.originZ = weed.z;
    // The wind is aimed across the road and stays that way for this weed's whole life,
    // so a weed crosses the carriageway instead of drifting along it. The road turns
    // and every weed has its own slot, so the crossings are not a parade.
    weed.wx = crossX * speed;
    weed.wz = crossZ * speed;
    weed.vx = weed.wx;
    weed.vy = 0.6 + hash01(this.seed, slot, 0x7a16) * 0.5;
    weed.vz = weed.wz;
    weed.roll = hash01(this.seed, slot, 0x7a17) * Math.PI * 2;
  }

  private retire(index: number): void {
    const last = --this.activeCount;
    if (index !== last) {
      const swap = this.weeds[index]!;
      this.weeds[index] = this.weeds[last]!;
      this.weeds[last] = swap;
    }
  }

  private integrate(weed: Weed, dt: number): void {
    // Relax towards this weed's wind rather than accelerate-and-drag: see WIND_RELAX.
    const relax = Math.min(1, WIND_RELAX * dt);
    weed.vx += (weed.wx - weed.vx) * relax;
    weed.vz += (weed.wz - weed.vz) * relax;
    weed.vy -= GRAVITY * dt;
    weed.x += weed.vx * dt;
    weed.y += weed.vy * dt;
    weed.z += weed.vz * dt;
    const ground = this.terrain.heightAt(weed.x + this.origin.x, weed.z + this.origin.z, weed.sHint) + RADIUS;
    if (weed.y < ground) {
      weed.y = ground;
      weed.vy = -weed.vy * GROUND_BOUNCE;
      if (weed.vy < 0.35) weed.vy = 0;
    }
    // Rolling without slipping: the contact travels `speed * dt`, so the ball turns
    // that far divided by its radius. The AXIS is horizontal and across the travel
    // direction (set in `syncMesh`), which is the difference between a ball rolling
    // and a ball spinning on the spot — the first cut turned it about world up and
    // read as a twig ball pirouetting down the verge.
    weed.roll += (Math.hypot(weed.vx, weed.vz) / RADIUS) * dt;
  }

  private hitsCar(weed: Weed, car: Impactor): boolean {
    const dx = weed.x + this.origin.x - car.x;
    const dz = weed.z + this.origin.z - car.z;
    if (dx * dx + dz * dz > (car.halfLength + HIT_SKIN) ** 2 + (car.halfWidth + HIT_SKIN) ** 2) return false;
    const localX = dx * car.fz - dz * car.fx;
    const localZ = dx * car.fx + dz * car.fz;
    const edgeX = Math.max(0, Math.abs(localX) - car.halfWidth);
    const edgeZ = Math.max(0, Math.abs(localZ) - car.halfLength);
    return edgeX * edgeX + edgeZ * edgeZ <= HIT_SKIN_SQ;
  }

  private syncMesh(): void {
    for (let i = 0; i < this.activeCount; i++) {
      const weed = this.weeds[i]!;
      const speed = Math.hypot(weed.vx, weed.vz);
      if (speed > 1e-3) _axis.set(-weed.vz / speed, 0, weed.vx / speed);
      else _axis.set(1, 0, 0);
      this.quaternion.setFromAxisAngle(_axis, weed.roll);
      this.matrix.compose(_position.set(weed.x, weed.y, weed.z), this.quaternion, this.scale);
      this.mesh.setMatrixAt(i, this.matrix);
    }
    this.mesh.count = this.activeCount;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

const _position = new THREE.Vector3();
/** Roll axis: horizontal, across the direction of travel. See `integrate`. */
const _axis = new THREE.Vector3(1, 0, 0);

/** Straight tapered twigs in three crossed directions; local diameter is 0.84 m. */
function buildTumbleweedGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const positions: number[] = [];
  const indices: number[] = [];
  const twigCount = 12;
  for (let i = 0; i < twigCount; i++) {
    const a = (i / twigCount) * Math.PI * 2;
    const b = a + 1.9;
    const r = RADIUS * (0.7 + (i % 3) * 0.14);
    const base = positions.length / 3;
    positions.push(Math.cos(a) * r, Math.sin(i * 2.1) * RADIUS * 0.7, Math.sin(a) * r);
    positions.push(Math.cos(b) * r, Math.cos(i * 1.7) * RADIUS * 0.7, Math.sin(b) * r);
    positions.push(Math.cos(a + 0.18) * r, Math.sin(i * 2.1 + 0.2) * RADIUS * 0.7, Math.sin(a + 0.18) * r);
    indices.push(base, base + 1, base + 2);
  }
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function emptyWeed(): Weed {
  return {
    slot: 0, sHint: 0,
    x: 0, y: 0, z: 0,
    originX: 0, originZ: 0,
    vx: 0, vy: 0, vz: 0,
    wx: 0, wz: 0,
    roll: 0,
  };
}
