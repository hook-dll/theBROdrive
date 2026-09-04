/**
 * Physical service parts, cosmetic gizmos and drivetrain specification tables.
 *
 * Parts are *data*, never prefabs: a `PartInstance` is an id, a variant reference
 * and three condition scalars. Meshes, colliders and physics tuning are all derived
 * from that data, which is what lets the same part lie in the sand, be carried in
 * the player's hands, or be mounted as a cosmetic gizmo on a complete car model's
 * anchor point without changing representation.
 *
 * The authored model remains the car body, but engine, turbine, radiator and fuel
 * tank instances occupy typed bonnet cells and carry service capability.
 * Everything mounted on free-form body anchors remains cosmetic.
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
  | 'turbine'
  | 'seat'
  | 'mirror'
  | 'bumper'
  | 'headlight'
  | 'exhaust'
  // Cosmetic-only, but it is the part you stare at from the driver's seat, so a
  // mismatched one is the most visible cross-fit in the game.
  | 'dashboard';

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
  /**
   * Cooling profile overrides. Anything omitted is derived by `engineHeat`, so an
   * engine only states what makes it unusual (a lazy Volga four that runs cool, a
   * truck diesel with a big water jacket).
   */
  readonly heat?: Partial<EngineHeatSpec>;
}


/**
 * How hard an engine has to be cooled, and the temperatures it lives between.
 *
 * Authored as an OPTIONAL override on `EngineSpec`: `engineHeat` below derives a
 * balanced profile from the numbers an engine already declares (peak power, fuel,
 * cylinders), so adding an engine to the catalogue gets a working cooling profile
 * for free and a tuner can override exactly the field they disagree with.
 *
 * Every temperature is degrees Celsius; every heat flow is kW.
 */
export interface EngineHeatSpec {
  /** Where the thermostat wants to sit once warm. */
  readonly operatingC: number;
  /** The band where the engine makes full power. */
  readonly optimalMinC: number;
  readonly optimalMaxC: number;
  /** Lamp lights, power starts to fall away. */
  readonly warningC: number;
  /** The engine stalls here and cannot restart until it has cooled. */
  readonly criticalC: number;
  /** Reached only by ignoring the lamp: the engine is destroyed. */
  readonly maxC: number;
  /** Heat into the coolant while idling. */
  readonly idleHeatKw: number;
  /** Additional heat at full throttle. */
  readonly loadHeatKw: number;
  /** Additional heat at the redline, independent of load. */
  readonly rpmHeatKw: number;
  /**
   * Thermal mass of block, head and coolant together, kJ per kelvin. This alone
   * decides how long warm-up and cool-down take.
   */
  readonly thermalMassKjPerK: number;
  /**
   * Radiator capability this engine needs, kW per kelvin of coolant-to-air
   * difference. A radiator below it will not hold the temperature under load —
   * that is the whole fitment mechanic (`radiatorFit` in vehicle/cooling.ts).
   */
  readonly coolingRequirementKwPerK: number;
}

/** Radiator size classes, smallest first. Also the three built meshes. */
export const RADIATOR_CLASSES = ['small', 'standard', 'large'] as const;
export type RadiatorClass = (typeof RADIATOR_CLASSES)[number];

export interface RadiatorSpec {
  readonly klass: RadiatorClass;
  /** Water the core and header tank hold together, litres. */
  readonly capacity: number;
  /**
   * Heat rejection at full airflow with a full core, kW per kelvin of
   * coolant-to-air difference. Compare against `coolingRequirementKwPerK`.
   */
  readonly coolingKwPerK: number;
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
  /** Cooling capability, on radiator variants only. */
  readonly radiator?: RadiatorSpec;
  readonly wheel?: WheelSpec;
  /** Fuel tank capacity, litres. */
  readonly capacity?: number;
  /** Which body classes this variant physically fits. */
  readonly fits: readonly BodyClass[];
}

/**
 * A suspension setup in the units it is designed in, not the units Rapier wants.
 * `Vehicle.rebuild` converts (see `wheelSpringRate` in vehicle/carmodels.ts); the
 * conversion needs each axle's share of the weight, which is why nothing here is a
 * spring rate.
 */
export interface SuspensionTuning {
  /** Front-axle heave frequency, Hz. A 1970s saloon is 1.0-1.4. */
  readonly frontHz: number;
  /** Rear-axle heave frequency, Hz. Normally 10-20% above the front (flat ride). */
  readonly rearHz: number;
  /** Damping while compressing, as a fraction of critical. Real cars: 0.2-0.3. */
  readonly compressionRatio: number;
  /** Damping while extending. Rebound-biased, 0.35-0.5, or a soft spring pogos. */
  readonly reboundRatio: number;
  /** Compression available past static sag before the bump stop shuts, metres. */
  readonly bumpTravel: number;
  /** Clear air under the body, metres. Saloon 0.13-0.18, working vehicle 0.20-0.24. */
  readonly rideHeight: number;
}

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
    // The GAZ-21/24's own engine: a lazy, low-revving 2.4 litre four making
    // 70-95 hp depending on the year — what a Volga actually had, not the 2.8 six
    // it was borrowing. Peak torque arrives at 2200 rpm and the redline is only
    // 4500, because a period Volga pulled from idle and ran out of breath early.
    id: 'engine_i4_2445',
    kind: 'engine',
    label: '2.4 inline-four',
    mass: 165,
    fits: ['car'],
    engine: {
      fuel: 'petrol',
      peakPowerKw: 52,
      peakTorqueNm: 167,
      torquePeakRpm: 2200,
      redlineRpm: 4500,
      idleRpm: 700,
      bsfc: 0.34,
      brakingCoeff: 0.068,
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
  {
    id: 'turbine_standard',
    kind: 'turbine',
    label: 'turbocharger',
    mass: 12,
    fits: ['car', 'truck', 'bus'],
  },
];

/**
 * Dashboards. Pure mass and looks, but they sit directly in the interior camera's
 * view, so a mismatched one is the most visible cross-fit in the game.
 *
 * `dash_std` is listed first so a generic spawn picker gives ordinary cars the
 * ordinary dash.
 */
const DASH_VARIANTS: readonly PartVariant[] = [
  { id: 'dash_std', kind: 'dashboard', label: 'dashboard', mass: 14, fits: ['car'] },
  { id: 'dash_truck', kind: 'dashboard', label: 'truck dashboard', mass: 22, fits: ['truck', 'bus'] },
  { id: 'dash_lada', kind: 'dashboard', label: '2102 dashboard', mass: 11, fits: ['car'] },
  { id: 'dash_rally', kind: 'dashboard', label: 'stripped dash', mass: 6, fits: ['car'] },
];

/**
 * The 2102's own running gear and trim, kept as distinct loose-part variants.
 *
 * The engine and gearbox entries here are not referenced by the car catalogue
 * (which resolves its own ids), but every entry stays a valid part a world can
 * scatter as a cosmetic gizmo.
 *
 * Figures are the real car's: 1.2 litre, 43 kW, 87 Nm, four-speed, 39 litre tank,
 * 13-inch wheels on 155-section tyres.
 */
const LADA_VARIANTS: readonly PartVariant[] = [
  {
    id: 'engine_lada_1200',
    kind: 'engine',
    label: '1.2 inline-four',
    mass: 114,
    fits: ['car'],
    engine: {
      fuel: 'petrol',
      peakPowerKw: 43,
      peakTorqueNm: 87,
      torquePeakRpm: 3400,
      redlineRpm: 5600,
      idleRpm: 850,
      bsfc: 0.33,
      brakingCoeff: 0.052,
      cylinders: 4,
    },
  },
  {
    id: 'gearbox_lada_4',
    kind: 'gearbox',
    label: '2102 four-speed',
    mass: 33,
    fits: ['car'],
    gearbox: {
      ratios: [3.75, 2.3, 1.49, 1.0],
      reverse: 3.87,
      finalDrive: 4.3,
      shiftTime: 0.34,
      automatic: false,
    },
  },
  {
    id: 'wheel_lada_13',
    kind: 'wheel',
    label: '13" 2102 wheel',
    mass: 16,
    fits: ['car'],
    wheel: { radius: 0.3, width: 0.165, grip: 0.92 },
  },
  { id: 'tank_lada_39', kind: 'fuel_tank', label: '39 L tank', mass: 13, capacity: 39, fits: ['car'] },
  { id: 'battery_lada', kind: 'battery', label: '2102 battery', mass: 15, fits: ['car'] },
  { id: 'seat_lada', kind: 'seat', label: '2102 seat', mass: 13, fits: ['car'] },
  { id: 'hood_lada', kind: 'hood', label: '2102 bonnet', mass: 18, fits: ['car'] },
  { id: 'trunk_lada', kind: 'trunk', label: '2102 tailgate', mass: 24, fits: ['car'] },
  { id: 'bumper_lada', kind: 'bumper', label: '2102 bumper', mass: 11, fits: ['car'] },
  { id: 'mirror_lada', kind: 'mirror', label: '2102 mirror', mass: 2, fits: ['car'] },
  { id: 'headlight_lada', kind: 'headlight', label: '2102 headlamp', mass: 3, fits: ['car'] },
  { id: 'exhaust_lada', kind: 'exhaust', label: '2102 exhaust', mass: 8, fits: ['car'] },
];

/**
 * Radiators. The one service part whose variants come from three corners of this
 * catalogue: a radiator IS the car's water container, so all three sit in a bonnet
 * slot rather than two of them being cosmetic look-alikes wearing the same name.
 *
 * The three size classes are the whole fitment mechanic. `coolingKwPerK` is heat
 * rejection per kelvin of coolant-to-air difference at full airflow, and an engine
 * states how much of it it needs (`coolingRequirementKwPerK`), so:
 *
 *   small     1.10 kW/K   holds a four-cylinder (needs ~0.7-0.9)
 *   standard  1.65 kW/K   holds a six (needs ~1.5)
 *   large     2.45 kW/K   holds the V8 and the 6.6 truck diesel (needs ~1.9-2.3)
 *
 * Undersizing does not forbid the fit: the engine simply cannot hold temperature
 * under load, which is the failure the player is meant to diagnose. The mass
 * differences are real too, and they already feed chassis mass.
 */
const RADIATOR_VARIANTS: readonly PartVariant[] = [
  {
    id: 'radiator_small',
    kind: 'radiator',
    label: 'small radiator',
    mass: 7,
    fits: ['car'],
    radiator: { klass: 'small', capacity: 5.5, coolingKwPerK: 1.1 },
  },
  {
    id: 'radiator_lada',
    kind: 'radiator',
    label: '2102 radiator',
    mass: 8,
    fits: ['car'],
    radiator: { klass: 'small', capacity: 6.5, coolingKwPerK: 1.1 },
  },
  {
    id: 'radiator_standard',
    kind: 'radiator',
    label: 'radiator',
    mass: 9,
    fits: ['car', 'truck', 'bus'],
    radiator: { klass: 'standard', capacity: 9, coolingKwPerK: 1.65 },
  },
  {
    id: 'radiator_copper',
    kind: 'radiator',
    label: 'copper radiator',
    mass: 13,
    fits: ['car', 'truck', 'bus'],
    radiator: { klass: 'large', capacity: 13, coolingKwPerK: 2.45 },
  },
];

export const ALL_VARIANTS: readonly PartVariant[] = [
  ...ENGINE_VARIANTS,
  ...GEARBOX_VARIANTS,
  ...WHEEL_VARIANTS,
  ...TANK_VARIANTS,
  ...RADIATOR_VARIANTS,
  ...TRIM_VARIANTS,
  ...DASH_VARIANTS,
  ...LADA_VARIANTS,
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

/**
 * A physical part in the world.
 *
 * `dirt` and `rust` are cosmetic. `destroyed` is the single irreversible service
 * state: only engines acquire it, and no cleaning tool clears it.
 *
 * `litres` is what a DETACHED container is carrying. While a container is fitted,
 * the car owns the level (`CarState.waterLitres`, `oilLitres`, `fuelLitres`) because
 * that is what the running engine drains and what the HUD reads; the `car_bonnet`
 * delta pours it into the part on removal and back out on installation (see
 * game/state.ts). So a radiator you pull out and carry to the trunk still holds its
 * water, and putting it back gives the car exactly that water — nothing evaporates
 * because the player picked it up.
 */
export interface PartInstance {
  readonly id: string;
  readonly variantId: string;
  dirt: number;
  rust: number;
  /** Irreversible catastrophic engine damage. Replacement is the only repair. */
  destroyed?: boolean;
  /** Litres inside this container while it is detached. Absent means dry/not a container. */
  litres?: number;
  /** Which fuel a detached tank holds. Mixed is the mis-fuelled tank the engine refuses. */
  fuelKind?: FuelType | 'mixed' | null;
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

/**
 * Oil capacity for an engine, litres.
 *
 * Derived from cylinder count rather than authored per engine: a bigger engine
 * holds more, and the relationship is close enough to linear that a table would
 * only be six numbers restating this. Water is NOT here — it belongs to the fitted
 * radiator (`RadiatorSpec.capacity`), because which radiator is bolted in is what
 * decides how much water the car can hold.
 */
export function oilCapacity(engine: EngineSpec): number {
  return 1.4 + engine.cylinders * 0.65;
}

/**
 * The cooling profile for an engine: authored overrides over derived defaults.
 *
 * Everything here follows from numbers the engine already declares, so a new
 * catalogue entry is cooled sensibly without authoring a second table:
 *
 *  - Heat into the coolant at full load is about the engine's own peak output. A
 *    petrol engine of this era puts roughly a third of the fuel's energy out of the
 *    crank and a third into the water, so 0.85x peak power is the right order.
 *  - Thermal mass is the iron and the water together, and it alone sets how long
 *    warm-up takes: 30 kJ/K on a four gives about a minute and a half of cruising
 *    from a cold desert morning to 90 C.
 *  - The cooling requirement is full-load heat divided by the ~62 K rise a radiator
 *    is expected to hold at cruise, which is what maps the six engines onto the
 *    three radiator classes.
 *  - Diesels run hotter and tolerate more before they let go, exactly as the
 *    thresholds below say.
 *
 * Cached per spec object: the profile is pure, and the fixed step asks for it every
 * tick for every live car.
 */
const heatCache = new WeakMap<EngineSpec, EngineHeatSpec>();

export function engineHeat(engine: EngineSpec): EngineHeatSpec {
  const cached = heatCache.get(engine);
  if (cached) return cached;

  const diesel = engine.fuel === 'diesel';
  const loadHeatKw = engine.peakPowerKw * (diesel ? 0.78 : 0.85);
  const idleHeatKw = engine.peakPowerKw * 0.05;
  const rpmHeatKw = engine.peakPowerKw * 0.1;
  const derived: EngineHeatSpec = {
    operatingC: diesel ? 95 : 90,
    optimalMinC: diesel ? 80 : 75,
    optimalMaxC: diesel ? 110 : 105,
    warningC: diesel ? 115 : 110,
    criticalC: diesel ? 135 : 125,
    maxC: diesel ? 155 : 140,
    idleHeatKw,
    loadHeatKw,
    rpmHeatKw,
    thermalMassKjPerK: 12 + engine.cylinders * 4.5 + engine.peakPowerKw * 0.06,
    coolingRequirementKwPerK: (idleHeatKw + loadHeatKw + rpmHeatKw) / 62,
    ...engine.heat,
  };
  heatCache.set(engine, derived);
  return derived;
}

/**
 * Litres per hour of oil that a running engine seeps away.
 *
 * NOT realistic — a sound engine loses none. It is tuned so a full sump lasts
 * roughly 170 km of cruising, which at 90 km/h is a couple of hours of driving.
 * Deliberately an ABSOLUTE distance rather than a fraction of ROAD_LENGTH: a longer
 * road should mean MORE stops, not rarer ones, and 150-200 km is a number a player
 * can hold in their head while POIs sit every 1.2 km.
 *
 * Water has no flat rate any more. It boils off as a function of temperature (see
 * `WATER_BOIL_LPH_PER_K` in vehicle/cooling.ts), which is what makes a mismatched
 * radiator cost water as well as power.
 */
export const OIL_LOSS_LPH = 2.1;

/**
 * What the physics and HUD need from a car. Every field is a property of the
 * complete model (vehicle/carmodels.ts): there is no "missing part" state left,
 * so a car is always drivable and this carries no flag saying so.
 */
export interface CarStats {
  /** Total vehicle mass, kg: the model's kerb mass plus its gizmos. */
  readonly mass: number;
  readonly engine: EngineSpec;
  readonly gearbox: GearboxSpec;
  readonly fuel: FuelType;
  readonly tankCapacity: number;
  readonly wheelCount: number;
  /** Tyre grip multiplier on the surface's friction. */
  readonly wheelGrip: number;
  readonly hasHeadlights: boolean;
}

