/**
 * Part and body definitions.
 *
 * Parts are *data*, never prefabs: a `PartInstance` is an id, a variant reference
 * and three condition scalars. Meshes, colliders and physics tuning are all derived
 * from that data, which is what lets the same part lie in the sand, be carried in
 * the player's hands, or be bolted to a car without changing representation.
 *
 * NETPLAY: every instance carries a stable string id, and nothing here references a
 * renderer object. Both are prerequisites for replication.
 */

export type FuelType = 'petrol' | 'diesel';

export type PartKind =
  | 'wheel'
  | 'door'
  | 'hood'
  | 'trunk'
  | 'engine'
  | 'gearbox'
  | 'battery'
  | 'radiator'
  | 'fuel_tank'
  | 'seat'
  | 'mirror'
  | 'bumper'
  | 'headlight'
  | 'exhaust';

/** Mount points on a body shell. Ids are stable and appear in save files. */
export type SlotId =
  | 'wheel_fl'
  | 'wheel_fr'
  | 'wheel_rl'
  | 'wheel_rr'
  | 'door_l'
  | 'door_r'
  | 'hood'
  | 'trunk'
  | 'engine'
  | 'gearbox'
  | 'battery'
  | 'radiator'
  | 'fuel_tank'
  | 'seat_driver'
  | 'seat_passenger'
  | 'mirror_l'
  | 'mirror_r'
  | 'bumper_f'
  | 'bumper_r'
  | 'headlight_l'
  | 'headlight_r'
  | 'exhaust';

export type BodyClass = 'car' | 'truck' | 'bus';

export interface EngineSpec {
  readonly fuel: FuelType;
  /** Peak crank power, kW. */
  readonly peakPowerKw: number;
  /** Peak torque, Nm. */
  readonly peakTorqueNm: number;
  /** Crank speed at peak torque. Diesels peak low, which is what makes them torquey. */
  readonly torquePeakRpm: number;
  readonly redlineRpm: number;
  readonly idleRpm: number;
  /** Brake-specific fuel consumption, litres per kWh. Diesel is more efficient. */
  readonly bsfc: number;
  /** Drag torque per rad/s of crank speed. This is what engine braking is made of. */
  readonly brakingCoeff: number;
  readonly cylinders: number;
}

export interface GearboxSpec {
  /** Forward gear ratios, first to top. */
  readonly ratios: readonly number[];
  readonly reverse: number;
  readonly finalDrive: number;
  /** Seconds of torque interruption on a shift. */
  readonly shiftTime: number;
  readonly automatic: boolean;
}

export interface WheelSpec {
  readonly radius: number;
  readonly width: number;
  /** Multiplies the surface's friction. Worn tyres are below 1. */
  readonly grip: number;
}

export interface PartVariant {
  readonly id: string;
  readonly kind: PartKind;
  readonly label: string;
  /** Mass in kg. Feeds directly into chassis mass and centre of gravity. */
  readonly mass: number;
  readonly engine?: EngineSpec;
  readonly gearbox?: GearboxSpec;
  readonly wheel?: WheelSpec;
  /** Fuel tank capacity, litres. */
  readonly capacity?: number;
  /** Which body classes this variant physically fits. */
  readonly fits: readonly BodyClass[];
}

export interface SuspensionTuning {
  /** Rest length of the spring, metres. */
  readonly restLength: number;
  /** Travel either side of rest before it bottoms out. */
  readonly maxTravel: number;
  /** Spring rate. Tuned against body mass, not absolute. */
  readonly stiffness: number;
  /** Damping while compressing. */
  readonly compression: number;
  /** Damping while extending. Higher stops float and wallow. */
  readonly relaxation: number;
  /** Force ceiling, so a hard landing cannot launch the car. */
  readonly maxForce: number;
}

export interface SlotDef {
  readonly id: SlotId;
  readonly kind: PartKind;
  /** Local mount position, metres. +X right, +Y up, +Z forward. */
  readonly pos: readonly [number, number, number];
  /** Mount yaw, radians. Mirrors and doors need it. */
  readonly yaw?: number;
  /** Car cannot be driven at all without this slot filled. */
  readonly essential?: boolean;
}

export interface BodyDef {
  readonly id: string;
  readonly label: string;
  readonly bodyClass: BodyClass;
  /** Mass of the bare shell with every part stripped, kg. */
  readonly shellMass: number;
  /** Half-extents of the chassis box collider, metres. */
  readonly halfExtents: readonly [number, number, number];
  /** Centre-of-mass offset from the body origin. Lower and rearward is more stable. */
  readonly comOffset: readonly [number, number, number];
  readonly suspension: SuspensionTuning;
  /** Steering lock at the front axle, radians. */
  readonly steerLock: number;
  /** Fraction of drive torque to the rear axle. 1 = RWD, 0 = FWD. */
  readonly rearDriveBias: number;
  /** Driver eye point in body-local space, for the interior camera. */
  readonly eyePoint: readonly [number, number, number];
  readonly slots: readonly SlotDef[];
}

/** Minimum wheels needed to move. Three is enough, and drives horribly, deliberately. */
export const MIN_WHEELS = 3;

export const ENGINE_VARIANTS: readonly PartVariant[] = [
  {
    id: 'engine_i4_1600',
    kind: 'engine',
    label: '1.6 inline-four',
    mass: 118,
    fits: ['car'],
    engine: {
      fuel: 'petrol',
      peakPowerKw: 54,
      peakTorqueNm: 125,
      torquePeakRpm: 3200,
      redlineRpm: 5600,
      idleRpm: 820,
      bsfc: 0.31,
      brakingCoeff: 0.055,
      cylinders: 4,
    },
  },
  {
    id: 'engine_i6_2800',
    kind: 'engine',
    label: '2.8 inline-six',
    mass: 186,
    fits: ['car', 'truck'],
    engine: {
      fuel: 'petrol',
      peakPowerKw: 96,
      peakTorqueNm: 225,
      torquePeakRpm: 3000,
      redlineRpm: 5400,
      idleRpm: 760,
      bsfc: 0.33,
      brakingCoeff: 0.072,
      cylinders: 6,
    },
  },
  {
    id: 'engine_v8_5000',
    kind: 'engine',
    label: '5.0 V8',
    mass: 245,
    fits: ['car', 'truck'],
    engine: {
      fuel: 'petrol',
      peakPowerKw: 143,
      peakTorqueNm: 390,
      torquePeakRpm: 2800,
      redlineRpm: 5200,
      idleRpm: 700,
      bsfc: 0.36,
      brakingCoeff: 0.095,
      cylinders: 8,
    },
  },
  {
    id: 'engine_d4_2000',
    kind: 'engine',
    label: '2.0 diesel four',
    mass: 152,
    fits: ['car', 'truck'],
    engine: {
      fuel: 'diesel',
      peakPowerKw: 44,
      peakTorqueNm: 168,
      torquePeakRpm: 1900,
      redlineRpm: 4200,
      idleRpm: 680,
      bsfc: 0.24,
      brakingCoeff: 0.11,
      cylinders: 4,
    },
  },
  {
    id: 'engine_d6_6600',
    kind: 'engine',
    label: '6.6 diesel six',
    mass: 402,
    fits: ['truck', 'bus'],
    engine: {
      fuel: 'diesel',
      peakPowerKw: 118,
      peakTorqueNm: 620,
      torquePeakRpm: 1500,
      redlineRpm: 3000,
      idleRpm: 560,
      bsfc: 0.22,
      brakingCoeff: 0.19,
      cylinders: 6,
    },
  },
];

export const GEARBOX_VARIANTS: readonly PartVariant[] = [
  {
    id: 'gearbox_manual4',
    kind: 'gearbox',
    label: '4-speed manual',
    mass: 46,
    fits: ['car'],
    gearbox: {
      ratios: [3.65, 2.05, 1.35, 1.0],
      reverse: 3.4,
      finalDrive: 3.9,
      shiftTime: 0.35,
      automatic: false,
    },
  },
  {
    id: 'gearbox_manual5',
    kind: 'gearbox',
    label: '5-speed manual',
    mass: 52,
    fits: ['car', 'truck'],
    gearbox: {
      ratios: [3.8, 2.16, 1.42, 1.0, 0.82],
      reverse: 3.6,
      finalDrive: 3.7,
      shiftTime: 0.3,
      automatic: false,
    },
  },
  {
    id: 'gearbox_auto3',
    kind: 'gearbox',
    label: '3-speed automatic',
    mass: 68,
    fits: ['car', 'bus'],
    gearbox: {
      ratios: [2.72, 1.5, 1.0],
      reverse: 2.1,
      finalDrive: 3.55,
      shiftTime: 0.55,
      automatic: true,
    },
  },
  {
    id: 'gearbox_truck6',
    kind: 'gearbox',
    label: '6-speed crashbox',
    mass: 132,
    fits: ['truck', 'bus'],
    gearbox: {
      ratios: [7.2, 4.1, 2.5, 1.6, 1.0, 0.78],
      reverse: 6.8,
      finalDrive: 4.9,
      shiftTime: 0.7,
      automatic: false,
    },
  },
];

export const WHEEL_VARIANTS: readonly PartVariant[] = [
  {
    id: 'wheel_steel_13',
    kind: 'wheel',
    label: '13" steel wheel',
    mass: 17,
    fits: ['car'],
    wheel: { radius: 0.31, width: 0.17, grip: 0.95 },
  },
  {
    id: 'wheel_steel_15',
    kind: 'wheel',
    label: '15" steel wheel',
    mass: 22,
    fits: ['car', 'truck'],
    wheel: { radius: 0.35, width: 0.2, grip: 1.0 },
  },
  {
    id: 'wheel_offroad_15',
    kind: 'wheel',
    label: '15" knobbly',
    mass: 28,
    fits: ['car', 'truck'],
    wheel: { radius: 0.38, width: 0.26, grip: 1.12 },
  },
  {
    id: 'wheel_bald_14',
    kind: 'wheel',
    label: '14" bald tyre',
    mass: 19,
    fits: ['car'],
    wheel: { radius: 0.33, width: 0.18, grip: 0.68 },
  },
  {
    id: 'wheel_truck_19',
    kind: 'wheel',
    label: '19" truck wheel',
    mass: 61,
    fits: ['truck', 'bus'],
    wheel: { radius: 0.48, width: 0.29, grip: 1.05 },
  },
];

export const TANK_VARIANTS: readonly PartVariant[] = [
  { id: 'tank_40', kind: 'fuel_tank', label: '40 L tank', mass: 14, capacity: 40, fits: ['car'] },
  {
    id: 'tank_65',
    kind: 'fuel_tank',
    label: '65 L tank',
    mass: 19,
    capacity: 65,
    fits: ['car', 'truck'],
  },
  {
    id: 'tank_140',
    kind: 'fuel_tank',
    label: '140 L saddle tank',
    mass: 38,
    capacity: 140,
    fits: ['truck', 'bus'],
  },
];

/** Parts with no behaviour beyond mass, condition and looking right. */
const TRIM_VARIANTS: readonly PartVariant[] = [
  { id: 'door_std', kind: 'door', label: 'door', mass: 31, fits: ['car'] },
  { id: 'door_truck', kind: 'door', label: 'truck door', mass: 44, fits: ['truck', 'bus'] },
  { id: 'hood_std', kind: 'hood', label: 'hood', mass: 21, fits: ['car'] },
  { id: 'hood_truck', kind: 'hood', label: 'truck hood', mass: 34, fits: ['truck'] },
  { id: 'trunk_std', kind: 'trunk', label: 'trunk lid', mass: 18, fits: ['car'] },
  { id: 'seat_bucket', kind: 'seat', label: 'bucket seat', mass: 16, fits: ['car', 'truck'] },
  { id: 'seat_bench', kind: 'seat', label: 'bench seat', mass: 24, fits: ['car', 'bus'] },
  { id: 'mirror_round', kind: 'mirror', label: 'round mirror', mass: 2, fits: ['car', 'truck'] },
  { id: 'bumper_chrome', kind: 'bumper', label: 'chrome bumper', mass: 13, fits: ['car'] },
  { id: 'bumper_steel', kind: 'bumper', label: 'steel bumper', mass: 27, fits: ['truck', 'bus'] },
  { id: 'battery_lead', kind: 'battery', label: 'lead-acid battery', mass: 17, fits: ['car'] },
  { id: 'battery_heavy', kind: 'battery', label: 'heavy battery', mass: 29, fits: ['truck', 'bus'] },
  {
    id: 'radiator_copper',
    kind: 'radiator',
    label: 'copper radiator',
    mass: 11,
    fits: ['car', 'truck', 'bus'],
  },
  {
    id: 'headlight_round',
    kind: 'headlight',
    label: 'round headlight',
    mass: 3,
    fits: ['car', 'truck', 'bus'],
  },
  {
    id: 'exhaust_single',
    kind: 'exhaust',
    label: 'exhaust',
    mass: 9,
    fits: ['car', 'truck', 'bus'],
  },
];

export const ALL_VARIANTS: readonly PartVariant[] = [
  ...ENGINE_VARIANTS,
  ...GEARBOX_VARIANTS,
  ...WHEEL_VARIANTS,
  ...TANK_VARIANTS,
  ...TRIM_VARIANTS,
];

const VARIANTS_BY_ID = new Map(ALL_VARIANTS.map((v) => [v.id, v]));

export function variant(id: string): PartVariant {
  const found = VARIANTS_BY_ID.get(id);
  if (!found) throw new Error(`unknown part variant: ${id}`);
  return found;
}

export function variantsOfKind(kind: PartKind, bodyClass?: BodyClass): PartVariant[] {
  return ALL_VARIANTS.filter(
    (v) => v.kind === kind && (bodyClass === undefined || v.fits.includes(bodyClass)),
  );
}

/** Standard slot layout for a four-wheeled road vehicle, scaled to the body's box. */
function slotsFor(
  halfWidth: number,
  halfLength: number,
  floor: number,
  roof: number,
  hoodDeckTop: number,
  trunkDeckTop: number,
): readonly SlotDef[] {
  const wx = halfWidth - 0.08;
  const wz = halfLength - 0.62;
  return [
    { id: 'wheel_fl', kind: 'wheel', pos: [-wx, floor, wz] },
    { id: 'wheel_fr', kind: 'wheel', pos: [wx, floor, wz] },
    { id: 'wheel_rl', kind: 'wheel', pos: [-wx, floor, -wz] },
    { id: 'wheel_rr', kind: 'wheel', pos: [wx, floor, -wz] },
    { id: 'engine', kind: 'engine', pos: [0, floor + 0.05, halfLength - 0.55], essential: true },
    { id: 'gearbox', kind: 'gearbox', pos: [0, floor + 0.2, halfLength - 1.35], essential: true },
    { id: 'radiator', kind: 'radiator', pos: [0, floor + 0.4, halfLength - 0.1], essential: true },
    {
      id: 'battery',
      kind: 'battery',
      // Engine-bay tray, beside the engine and just under the bonnet deck so it
      // reads plainly whenever the hood is off. The outboard X keeps it clear of
      // every engine block/manifold (which sit low and centred), and well inside
      // the body so it never pokes through a wing.
      pos: [-halfWidth + 0.30, hoodDeckTop - 0.10, halfLength - 0.95],
      essential: true,
    },
    {
      id: 'fuel_tank',
      kind: 'fuel_tank',
      pos: [0, floor + 0.15, -halfLength + 0.5],
      essential: true,
    },
    { id: 'seat_driver', kind: 'seat', pos: [-0.38, floor + 0.35, -0.15], essential: true },
    { id: 'seat_passenger', kind: 'seat', pos: [0.38, floor + 0.35, -0.15] },
    { id: 'door_l', kind: 'door', pos: [-halfWidth, floor + 0.55, 0.1], yaw: Math.PI * 0.5 },
    { id: 'door_r', kind: 'door', pos: [halfWidth, floor + 0.55, 0.1], yaw: -Math.PI * 0.5 },
    { id: 'hood', kind: 'hood', pos: [0, hoodDeckTop + 0.025, halfLength - 0.85] },
    { id: 'trunk', kind: 'trunk', pos: [0, trunkDeckTop + 0.025, -halfLength + 0.6] },
    {
      id: 'mirror_l',
      kind: 'mirror',
      pos: [-halfWidth - 0.06, roof - 0.28, halfLength - 1.5],
      yaw: 0.3,
    },
    {
      id: 'mirror_r',
      kind: 'mirror',
      pos: [halfWidth + 0.06, roof - 0.28, halfLength - 1.5],
      yaw: -0.3,
    },
    { id: 'bumper_f', kind: 'bumper', pos: [0, floor + 0.25, halfLength + 0.1] },
    { id: 'bumper_r', kind: 'bumper', pos: [0, floor + 0.25, -halfLength - 0.1] },
    {
      id: 'headlight_l',
      kind: 'headlight',
      pos: [-halfWidth + 0.42, floor + 0.40, halfLength + 0.04],
    },
    {
      id: 'headlight_r',
      kind: 'headlight',
      pos: [halfWidth - 0.42, floor + 0.40, halfLength + 0.04],
    },
    { id: 'exhaust', kind: 'exhaust', pos: [0.3, floor - 0.05, -halfLength + 0.2] },
  ];
}

export const BODIES: readonly BodyDef[] = [
  {
    id: 'body_sedan',
    label: 'old sedan',
    bodyClass: 'car',
    shellMass: 610,
    halfExtents: [0.85, 0.62, 2.25],
    comOffset: [0, -0.32, -0.1],
    steerLock: 0.52,
    rearDriveBias: 1,
    eyePoint: [-0.38, 0.28, 0.15],
    suspension: {
      restLength: 0.34,
      maxTravel: 0.17,
      stiffness: 26,
      compression: 0.72,
      relaxation: 0.9,
      maxForce: 12000,
    },
    slots: slotsFor(0.85, 2.25, -0.42, 0.62, 0.09, 0.16),
  },
  {
    id: 'body_wagon',
    label: 'estate wagon',
    bodyClass: 'car',
    shellMass: 690,
    halfExtents: [0.88, 0.68, 2.4],
    comOffset: [0, -0.3, -0.16],
    steerLock: 0.5,
    rearDriveBias: 1,
    eyePoint: [-0.38, 0.32, 0.2],
    suspension: {
      restLength: 0.36,
      maxTravel: 0.19,
      stiffness: 24,
      compression: 0.7,
      relaxation: 0.88,
      maxForce: 13000,
    },
    slots: slotsFor(0.88, 2.4, -0.44, 0.68, 0.09, 0.09),
  },
  {
    id: 'body_hatch',
    label: 'small hatchback',
    bodyClass: 'car',
    shellMass: 480,
    halfExtents: [0.78, 0.6, 1.85],
    comOffset: [0, -0.28, 0.12],
    steerLock: 0.58,
    rearDriveBias: 0,
    eyePoint: [-0.36, 0.3, 0.05],
    suspension: {
      restLength: 0.3,
      maxTravel: 0.15,
      stiffness: 30,
      compression: 0.75,
      relaxation: 0.95,
      maxForce: 9000,
    },
    slots: slotsFor(0.78, 1.85, -0.4, 0.6, 0.09, 0.09),
  },
  {
    id: 'body_pickup',
    label: 'flatbed truck',
    bodyClass: 'truck',
    shellMass: 1450,
    halfExtents: [1.1, 0.95, 3.1],
    comOffset: [0, -0.42, -0.2],
    steerLock: 0.42,
    rearDriveBias: 1,
    eyePoint: [-0.45, 0.5, 1.1],
    suspension: {
      restLength: 0.45,
      maxTravel: 0.24,
      stiffness: 21,
      compression: 0.66,
      relaxation: 0.84,
      maxForce: 34000,
    },
    slots: slotsFor(1.1, 3.1, -0.6, 0.95, 0.21, 0.21),
  },
  {
    id: 'body_bus',
    label: 'service bus',
    bodyClass: 'bus',
    shellMass: 3200,
    halfExtents: [1.25, 1.55, 5.2],
    comOffset: [0, -0.75, -0.3],
    steerLock: 0.36,
    rearDriveBias: 1,
    eyePoint: [-0.55, 0.6, 3.6],
    suspension: {
      restLength: 0.5,
      maxTravel: 0.26,
      stiffness: 18,
      compression: 0.6,
      relaxation: 0.8,
      maxForce: 62000,
    },
    slots: slotsFor(1.25, 5.2, -0.95, 1.55, 0.35, 0.35),
  },
];

const BODIES_BY_ID = new Map(BODIES.map((b) => [b.id, b]));

export function body(id: string): BodyDef {
  const found = BODIES_BY_ID.get(id);
  if (!found) throw new Error(`unknown body: ${id}`);
  return found;
}

/**
 * A physical part in the world.
 *
 * `dirt`, `rust` and `wear` are all 0..1. Dirt and rust are cosmetic-plus-penalty
 * and can be cleaned; wear is permanent and only fixed by finding a better part.
 */
export interface PartInstance {
  readonly id: string;
  readonly variantId: string;
  dirt: number;
  rust: number;
  wear: number;
}

/** Coarse dirt a brush can shift; below this only a sponge helps. */
export const BRUSH_DIRT_FLOOR = 0.22;
/** Rust low enough to count as bare metal, so a sponge can finish the job. */
export const RUST_CLEAN_EPSILON = 0.02;

/** Brush rates per second, applied while the tool is held against the part. */
const BRUSH_RUST_RATE = 0.28;
const BRUSH_DIRT_RATE = 0.55;
/** Sponge rate per second. */
const SPONGE_DIRT_RATE = 0.7;

/**
 * Scrubs with a brush: shifts rust and the coarse layer of dirt, but leaves a film
 * behind. Returns true if anything changed, for tool feedback and delta recording.
 */
export function applyBrush(part: PartInstance, dt: number): boolean {
  const rust = Math.max(0, part.rust - BRUSH_RUST_RATE * dt);
  // The floor is a limit on how far a brush can clean, never a level it imposes:
  // clamping straight to BRUSH_DIRT_FLOOR would make brushing an already-clean part
  // dirtier. So the target floor is whichever is lower, the floor or current dirt.
  const floor = Math.min(part.dirt, BRUSH_DIRT_FLOOR);
  const dirt = Math.max(floor, part.dirt - BRUSH_DIRT_RATE * dt);
  const changed = rust !== part.rust || dirt !== part.dirt;
  part.rust = rust;
  part.dirt = dirt;
  return changed;
}

/**
 * Polishes with a sponge: takes an already de-rusted part to perfect. Refuses to do
 * anything while rust remains, which is what forces brush-then-sponge order.
 */
export function applySponge(part: PartInstance, dt: number): boolean {
  if (part.rust > RUST_CLEAN_EPSILON) return false;
  const dirt = Math.max(0, part.dirt - SPONGE_DIRT_RATE * dt);
  const changed = dirt !== part.dirt || part.rust !== 0;
  part.dirt = dirt;
  part.rust = 0;
  return changed;
}

/** 0 = ruined, 1 = factory fresh. Drives both shading and performance penalties. */
export function conditionScore(part: PartInstance): number {
  return Math.max(0, 1 - (part.dirt * 0.25 + part.rust * 0.5 + part.wear * 0.35));
}

export interface CarStats {
  /** Total mass including shell and every fitted part, kg. */
  readonly mass: number;
  readonly engine: EngineSpec | null;
  readonly gearbox: GearboxSpec | null;
  /** Engine output multiplier from the engine part's condition. */
  readonly engineEfficiency: number;
  readonly fuel: FuelType | null;
  readonly tankCapacity: number;
  readonly wheelCount: number;
  /** Grip multiplier averaged over fitted wheels, including their condition. */
  readonly wheelGrip: number;
  readonly hasHeadlights: boolean;
  /** Essential slots still empty. An empty array means the car will start. */
  readonly missing: readonly SlotId[];
  readonly drivable: boolean;
}

/**
 * Derives everything the physics and HUD need from a slot map.
 *
 * Called when a part is attached or removed, not per frame — it allocates.
 */
export function computeCarStats(
  def: BodyDef,
  slots: ReadonlyMap<SlotId, PartInstance | null>,
): CarStats {
  let mass = def.shellMass;
  let engine: EngineSpec | null = null;
  let engineEfficiency = 1;
  let gearbox: GearboxSpec | null = null;
  let tankCapacity = 0;
  let wheelCount = 0;
  let gripSum = 0;
  let headlights = 0;
  const missing: SlotId[] = [];

  for (const slot of def.slots) {
    const part = slots.get(slot.id) ?? null;
    if (!part) {
      if (slot.essential) missing.push(slot.id);
      continue;
    }
    const v = variant(part.variantId);
    mass += v.mass;

    if (v.engine) {
      engine = v.engine;
      // Rust and wear cost power; dirt does not. A filthy but sound engine runs fine.
      engineEfficiency = Math.max(0.35, 1 - part.rust * 0.4 - part.wear * 0.3);
    }
    if (v.gearbox) gearbox = v.gearbox;
    if (v.capacity) tankCapacity += v.capacity;
    if (v.wheel) {
      wheelCount++;
      gripSum += v.wheel.grip * Math.max(0.5, 1 - part.rust * 0.2 - part.wear * 0.35);
    }
    if (v.kind === 'headlight') headlights++;
  }

  if (wheelCount < MIN_WHEELS) missing.push('wheel_fl');

  return {
    mass,
    engine,
    gearbox,
    engineEfficiency,
    fuel: engine?.fuel ?? null,
    tankCapacity,
    wheelCount,
    wheelGrip: wheelCount > 0 ? gripSum / wheelCount : 0,
    hasHeadlights: headlights > 0,
    missing,
    drivable: missing.length === 0,
  };
}
