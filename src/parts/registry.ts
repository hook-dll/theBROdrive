/**
 * Physical service parts and drivetrain specification tables.
 *
 * Parts are *data*, never prefabs: a `PartInstance` is an id, a variant reference
 * and three condition scalars. Meshes, colliders and physics tuning are all derived
 * from that data, which is what lets the same part lie in the sand, be carried in
 * the player's hands, or be fitted into a service cell on a complete car model's
 * anchor point without changing representation.
 *
 * The authored model remains the car body, but engine, turbocharger, radiator, fuel
 * tank and air filter instances occupy typed bonnet cells and carry service capability.
 * Everything mounted on free-form body anchors remains cosmetic.
 *
 * NETPLAY: every instance carries a stable string id, and nothing here references a
 * renderer object. Both are prerequisites for replication.
 */

export type PartKind =
  | 'engine'
  | 'gearbox'
  | 'radiator'
  | 'fuel_tank'
  | 'turbine'
  | 'air_filter';

export type BodyClass = 'car' | 'truck' | 'bus';

/**
 * An engine, authored in the FACTORY's own numbers: the two points of the published
 * external speed characteristic, measured net at the crank on a brake, and the speed
 * the fuel is cut at. `engineTorqueNm` (vehicle/drivetrain.ts) builds the whole
 * full-throttle curve through exactly those two points, so a catalogue figure is
 * copied here as printed and never adjusted for the model.
 */
export interface EngineSpec {
  /** Factory net power at `powerPeakRpm`, kW. The curve's power point. */
  readonly peakPowerKw: number;
  /** Crank speed of the rated power. Must be above `torquePeakRpm`. */
  readonly powerPeakRpm: number;
  /** Factory net torque at `torquePeakRpm`, Nm. The curve's torque point. */
  readonly peakTorqueNm: number;
  /** Crank speed at peak torque. */
  readonly torquePeakRpm: number;
  /**
   * The fuel cut: torque fades to zero over the last 150 rpm before it. At or
   * above `powerPeakRpm` — the limiter or tachometer red zone where the factory states
   * one, otherwise the rated speed plus the modest margin each entry justifies.
   */
  readonly redlineRpm: number;
  readonly idleRpm: number;
  /** Brake-specific fuel consumption, litres per kWh. */
  readonly bsfc: number;
  /**
   * Friction drag per rad/s of crank speed, Nm·s. The factory figures are already
   * net of it, so it does NOT shape the full-throttle curve: it is what closed-throttle
   * engine braking is built from, and what the part-throttle blend charges the pedal
   * for (see `Drivetrain.update`).
   */
  readonly brakingCoeff: number;
  readonly cylinders: number;
  /**
   * The full-throttle curve as published, when a maker's or a dyno's curve exists:
   * `[rpm, Nm]` points in rising rpm, net, and passing through the torque and power
   * points above. Between them the curve is a monotone cubic through the points, so
   * an engine's dips and plateaus are its own rather than the two-point shape's.
   * Absent, `engineTorqueNm` builds the curve from the two rated points alone.
   */
  readonly torqueCurve?: readonly (readonly [number, number])[];
  /**
   * Cooling profile overrides. Anything omitted is derived by `engineHeat`, so an
   * engine only states what makes it unusual (a lazy Volga four that runs cool, a
   * rally engine that warns early).
   */
  readonly heat?: Partial<EngineHeatSpec>;
}


/**
 * How hard an engine has to be cooled, and the temperatures it lives between.
 *
 * Authored as an OPTIONAL override on `EngineSpec`: `engineHeat` below derives a
 * balanced profile from the numbers an engine already declares (peak power,
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
}

/**
 * The radiator. One core fits every engine and is rated against the engine it cools
 * (see `radiatorKwPerK` in vehicle/cooling.ts), so the only thing about it the player
 * manages is the water in it.
 */
export interface RadiatorSpec {
  /** Water the core and header tank hold together, litres. */
  readonly capacity: number;
}
export interface GearboxSpec {
  /** Forward gear ratios, first to top. */
  readonly ratios: readonly number[];
  readonly reverse: number;
  readonly finalDrive: number;
  /** Seconds of torque interruption on a shift. */
  readonly shiftTime: number;
  readonly automatic: boolean;
  /**
   * Share of crank torque that reaches the hubs while driving: gearbox, propshaft,
   * transfer case and final drive together. Applied to drive torque only; engine
   * braking is left alone (see `Drivetrain.update`). The catalogue uses four bands,
   * from the period efficiencies of each part — a manual box 0.96-0.97, a propshaft
   * joint pair 0.99, a hypoid axle 0.95-0.96, a helical transaxle final drive 0.97-0.98:
   *
   *   rear drive through a live hypoid axle   0.90
   *   front-drive transaxle, no propshaft     0.92
   *   4x4 through a transfer case and two axles 0.85
   *   three-speed automatic (torque converter) 0.85
   */
  readonly efficiency: number;
}

export interface PartVariant {
  readonly id: string;
  readonly kind: PartKind;
  readonly label: string;
  /** Mass in kg. Feeds directly into chassis mass and centre of gravity. */
  readonly mass: number;
  readonly engine?: EngineSpec;
  readonly gearbox?: GearboxSpec;
  /** Water capacity, on the radiator only. */
  readonly radiator?: RadiatorSpec;
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
  /**
   * Each axle's ROLL CENTRE: the height above the road, at ride height, through which
   * the links hand the tyres' side force to the body. It is set by the linkage, not the
   * springs: a MacPherson strut or parallel wishbones put it 0.03-0.12 m off the road, a
   * twist beam 0.10-0.25 m, a live axle on a Panhard rod or on leaf springs at the rod
   * or the spring seat, 0.25-0.50 m.
   *
   * It splits the axle's lateral load transfer in two. `side force · height / track` goes
   * straight through the links to the tyres and never rolls the body (the geometric
   * part); the rest of the moment, the side force times the centre of mass' height ABOVE
   * the roll axis, rolls the body until the springs and bars hold it (the elastic part).
   * A high roll centre therefore means less lean AND more transfer on that axle.
   */
  readonly frontRollCentreM: number;
  readonly rearRollCentreM: number;
  /**
   * Anti-roll bar on each axle, as a fraction of that axle's own wheel rate: a bar adds
   * `fraction · rate` to each wheel's rate in roll and nothing in heave. 0 is no bar. A
   * twist beam is its own bar (the beam twists), so its rear figure is the beam's. A
   * beam axle on leaf springs set inboard of the wheels resists roll by only
   * `(spring spacing / track)²` of its ride rate, which is written as a negative figure:
   * `(spacing / track)² − 1`.
   *
   * With the roll centres, the bars are the balance lever: the axle with more roll
   * stiffness takes more of the elastic transfer, loads its outer tyre harder and,
   * through load sensitivity, runs out of grip first.
   */
  readonly frontBar: number;
  readonly rearBar: number;
  /**
   * STEERING GEOMETRY. The share of true Ackermann the steering trapezoid gives, 0..1:
   * 0 is parallel steer (both front wheels at the rack angle), 1 points both wheels at
   * the one centre on the rear axle's line, the inner wheel steered more. Production
   * cars run 0.5-0.8; the arms are bent to package the rack, not to the ideal.
   */
  readonly ackermann: number;
  /**
   * Static camber per wheel, degrees; positive is the top of the tyre leaning OUT of the
   * car. The factory alignment figure (a Zhiguli +0°30′, a Samara or Volga 0°).
   */
  readonly frontCamberDeg: number;
  readonly rearCamberDeg: number;
  /**
   * How much of the body's roll the wheel takes with it as camber against the ROAD: 1 is
   * a wheel that stays parallel to the body (trailing arm, equal wishbones), 0 one that
   * stays square to the road whatever the body does (any beam axle). A MacPherson strut
   * is ~0.8, unequal wishbones ~0.6: their camber gain claws back the rest.
   */
  readonly frontRollCamber: number;
  readonly rearRollCamber: number;
  /**
   * Static toe per wheel, degrees; positive is toe-IN (the front of the tyre toward the
   * car's centreline). A factory total-toe figure in mm is `2 · d · tan(toe)` across the
   * diameter `d` it is measured at.
   */
  readonly frontToeDeg: number;
  readonly rearToeDeg: number;
  /**
   * ROLL STEER, degrees of steer per degree of body roll, positive for roll UNDERSTEER:
   * the front wheels steering out of the turn as the body leans, the rear axle steering
   * into it. It is the anti-symmetric half of the bump-steer curve (each wheel's toe
   * against its own travel) for an independent axle, and the whole axle yawing on its
   * links or leaves for a beam. Typical: 0.02-0.1 front, 0.05-0.15 for a live axle.
   */
  readonly frontRollSteer: number;
  readonly rearRollSteer: number;
  /**
   * CASTER, degrees: the steering axis leaning back at the top. It puts the contact
   * patch `wheelRadius · tan(caster)` behind where the axis meets the road — the
   * MECHANICAL TRAIL — and that lever, with the tyre's own pneumatic trail, is what the
   * side force turns the steering back with. Factory figures: a Zhiguli or Niva
   * +3°30′, a UAZ +3°, the front-driven Samara family +1°30′, a Volga's kingpins
   * +0°30′. Steering only; the body's yaw never sees it (see `PNEUMATIC_TRAIL_M`).
   */
  readonly frontCasterDeg: number;
}

/*
 * ---- the loose-part engines ----
 *
 * Each of these is one real period engine, named in its entry, authored from its
 * maker's published figures. The Soviet pack's own units follow further down; these
 * are the ones no catalogue body ships with — the Moskvich and IZh units, the UAZ
 * four, and the imports a player finds on a pallet at a scrapyard and swaps in.
 *
 * `redlineRpm` is the fuel cut. Where the maker states no limiter or red zone it is
 * the rated speed plus about 7%, the margin the VAZ family's own tachometer red zone
 * sits above its rated speed (5600 -> 6000).
 *
 * `brakingCoeff` is sized to about 10% of peak torque at the fuel cut (the Soviet
 * driveline note below explains the scale).
 */
export const ENGINE_VARIANTS: readonly PartVariant[] = [
  {
    // VAZ-2106-70, the 1.6 AZLK fitted to the Moskvich-2141-01 before its own UZAM
    // units were ready: 1.57 litre, 56.3 kW (76.4 hp) at 5400 and 121 Nm at 3000
    // (autoopt.ru, AZLK-2141 1998 catalogue). The VAZ family's 6000 rpm red zone.
    id: 'engine_i4_1600',
    kind: 'engine',
    label: '1.6 VAZ-2106-70 inline-four',
    mass: 118,
    fits: ['car'],
    engine: {
      peakPowerKw: 56.3,
      powerPeakRpm: 5400,
      peakTorqueNm: 121,
      torquePeakRpm: 3000,
      redlineRpm: 6000,
      idleRpm: 820,
      bsfc: 0.31,
      brakingCoeff: 0.0199,
      cylinders: 4,
    },
  },
  {
    // IZH-2715-01 catalogue option 412DE: 1.478 litre, 49.0 kW at 5800 rpm and
    // 102 Nm across 3000-3800 on A-76 (autoopt.ru, Moskvich-412 catalogue); the
    // torque point is the middle of that plateau. No red zone is published.
    id: 'engine_uzam_412de',
    kind: 'engine',
    label: '1.5 UZAM-412DE inline-four',
    // Factory aggregate: engine with equipment and gearbox 166 kg, gearbox 22 kg.
    mass: 144,
    fits: ['truck'],
    engine: {
      peakPowerKw: 49,
      powerPeakRpm: 5800,
      peakTorqueNm: 102,
      torquePeakRpm: 3400,
      redlineRpm: 6200,
      idleRpm: 850,
      bsfc: 0.32,
      brakingCoeff: 0.019,
      cylinders: 4,
    },
  },
  {
    // UMZ-4213.10-10 from the long-wheelbase UAZ-330364: 2.89 litres, 99 hp
    // (72.8 kW) at 4000 rpm and 201 Nm at 3000 (truck-and-bus.ru's 330364 sheet;
    // UMZ's own table rates the plain 4213.10 at 84.5 kW GROSS, GOST 14846-81).
    id: 'engine_umz_4213',
    kind: 'engine',
    label: '2.9 UMZ inline-four',
    mass: 170,
    fits: ['car', 'truck'],
    engine: {
      peakPowerKw: 72.8,
      powerPeakRpm: 4000,
      peakTorqueNm: 201,
      torquePeakRpm: 3000,
      redlineRpm: 4300,
      idleRpm: 750,
      bsfc: 0.30,
      brakingCoeff: 0.044,
      cylinders: 4,
    },
  },
  {
    // UMZ-4178, the UAZ-31512's standard engine from about 1989: 2.445 litres, the
    // Volga block at a compression of 7.0 for A-76, 55.9 kW (76 hp) at 4000 and
    // 159.8 Nm (16.3 kgf·m) at 2200-2500, NET to GOST 14846, idle 700-750 (UAZ manual
    // RE 05808600.072-2000, pp. 11-12; the 1993 catalogue's 90 hp and 171.6 Nm are the
    // gross rating). Mass with clutch 165 kg (1993 catalogue). No red zone is published:
    // cut at the rated speed plus 7%. Friction is the Volga 2.4's, the same block.
    id: 'engine_umz_4178',
    kind: 'engine',
    label: '2.4 UMZ-4178 inline-four',
    mass: 165,
    fits: ['car', 'truck'],
    engine: {
      peakPowerKw: 55.9,
      powerPeakRpm: 4000,
      peakTorqueNm: 159.8,
      torquePeakRpm: 2400,
      redlineRpm: 4300,
      idleRpm: 725,
      bsfc: 0.34,
      brakingCoeff: 0.037,
      cylinders: 4,
    },
  },
  {
    // Nissan L28E, the fuel-injected 2.8 of the 1979-80 Datsun 280ZX: 2.753 litres,
    // 135 hp (100.7 kW) SAE net at 5200 and 144 lb-ft (195 Nm) at 4400, per the
    // Nissan factory service manual figures quoted by xenonzcar.com.
    id: 'engine_i6_2800',
    kind: 'engine',
    label: '2.8 Nissan L28E inline-six',
    mass: 186,
    fits: ['car', 'truck'],
    engine: {
      peakPowerKw: 100.7,
      powerPeakRpm: 5200,
      peakTorqueNm: 195,
      torquePeakRpm: 4400,
      redlineRpm: 5600,
      idleRpm: 760,
      bsfc: 0.33,
      brakingCoeff: 0.033,
      cylinders: 6,
    },
  },
  {
    // BMW M30B30, the carburettor 3.0 of the E3 3.0 S and the E9 3.0 CS (1971-):
    // 2.985 litres, 180 PS DIN (132 kW) at 6000 and 255 Nm at 3700 (BMW Group
    // Classic, E9 technical data). Cut at the rated speed plus 7%.
    id: 'engine_bmw_m30',
    kind: 'engine',
    label: '3.0 BMW M30 inline-six',
    mass: 195,
    fits: ['car'],
    engine: {
      peakPowerKw: 132,
      powerPeakRpm: 6000,
      peakTorqueNm: 255,
      torquePeakRpm: 3700,
      redlineRpm: 6400,
      idleRpm: 850,
      bsfc: 0.33,
      brakingCoeff: 0.038,
      cylinders: 6,
    },
  },
  {
    // Ford Cologne 2.8i, the injected V6 of the Capri 2.8 Injection and the Granada
    // 2.8i (1981): 2.792 litres, 160 PS (118 kW) at 5700 and 221 Nm at 4300 (Ford of
    // Europe press data, 1981). Cut at 6000.
    id: 'engine_ford_cologne_v6',
    kind: 'engine',
    label: '2.8 Ford Cologne V6',
    mass: 172,
    fits: ['car'],
    engine: {
      peakPowerKw: 118,
      powerPeakRpm: 5700,
      peakTorqueNm: 221,
      torquePeakRpm: 4300,
      redlineRpm: 6000,
      idleRpm: 800,
      bsfc: 0.34,
      brakingCoeff: 0.035,
      cylinders: 6,
    },
  },
  {
    // Rover V8 3.5 in the SD1 3500 (1976): 3.528 litres, all-aluminium, 155 bhp
    // (115.6 kW) at 5250 and 198 lb-ft (268 Nm) at 2500 (Rover SD1 brochure, 1976).
    // Light for its size: the block is the ex-Buick 215 alloy casting.
    id: 'engine_rover_v8',
    kind: 'engine',
    label: '3.5 Rover V8',
    mass: 150,
    fits: ['car', 'truck'],
    engine: {
      peakPowerKw: 115.6,
      powerPeakRpm: 5250,
      peakTorqueNm: 268,
      torquePeakRpm: 2500,
      redlineRpm: 5700,
      idleRpm: 700,
      bsfc: 0.36,
      brakingCoeff: 0.045,
      cylinders: 8,
    },
  },
  {
    // Chevrolet 350 small-block, L48 four-barrel of 1972, the first year of SAE net
    // ratings: 5.733 litres, 200 hp (149 kW) at 4400 and 300 lb-ft (407 Nm) at 2800
    // (Chevrolet 1972 passenger car specifications). A cast-iron lump, and it weighs
    // like one.
    id: 'engine_chevy_350',
    kind: 'engine',
    label: '5.7 Chevrolet 350 V8',
    mass: 265,
    fits: ['car', 'truck'],
    engine: {
      peakPowerKw: 149,
      powerPeakRpm: 4400,
      peakTorqueNm: 407,
      torquePeakRpm: 2800,
      redlineRpm: 5000,
      idleRpm: 650,
      bsfc: 0.37,
      brakingCoeff: 0.078,
      cylinders: 8,
    },
  },
  {
    // BMW M10 in the 2002 tii (1971): 1.990 litres with Kugelfischer injection,
    // 130 PS DIN (96 kW) at 5800 and 181 Nm at 4500 (BMW Group Classic, 2002 tii
    // technical data). Cut at 6400.
    id: 'engine_bmw_m10_tii',
    kind: 'engine',
    label: '2.0 BMW M10 tii inline-four',
    mass: 140,
    fits: ['car'],
    engine: {
      peakPowerKw: 96,
      powerPeakRpm: 5800,
      peakTorqueNm: 181,
      torquePeakRpm: 4500,
      redlineRpm: 6400,
      idleRpm: 900,
      bsfc: 0.32,
      brakingCoeff: 0.027,
      cylinders: 4,
    },
  },
  {
    // Cosworth BDA, the belt-driven twin-cam sixteen-valve 1.6 of the 1970 Escort
    // RS1600: 1.601 litres, 120 PS (88 kW) at 6500 and 152 Nm at 4000 (Ford Motor
    // Company RS1600 homologation data). Nothing below 3500 and everything above it.
    id: 'engine_cosworth_bda',
    kind: 'engine',
    label: '1.6 Cosworth BDA twin-cam four',
    mass: 112,
    fits: ['car'],
    engine: {
      peakPowerKw: 88,
      powerPeakRpm: 6500,
      peakTorqueNm: 152,
      torquePeakRpm: 4000,
      redlineRpm: 7300,
      idleRpm: 1000,
      bsfc: 0.35,
      brakingCoeff: 0.02,
      cylinders: 4,
    },
  },
];

/** Imported engines: never factory-fitted to a catalogue body, found at scrapyards. */
export const IMPORT_ENGINE_IDS: readonly string[] = [
  'engine_i6_2800',
  'engine_bmw_m30',
  'engine_ford_cologne_v6',
  'engine_rover_v8',
  'engine_chevy_350',
  'engine_bmw_m10_tii',
  'engine_cosworth_bda',
];

export const GEARBOX_VARIANTS: readonly PartVariant[] = [
  {
    // UAZ four-speed with the 33036-series axle ratio; high-range transfer is 1:1
    // (autoopt.ru, UAZ-2206 catalogue: 3.78 / 2.60 / 1.55 / 1.00, R 4.12, 4.625).
    // Part-time 4x4 through a transfer case and two axles: 0.85.
    id: 'gearbox_uaz_4',
    kind: 'gearbox',
    label: 'UAZ 4-speed manual',
    mass: 46,
    fits: ['car', 'truck'],
    gearbox: {
      ratios: [3.78, 2.60, 1.55, 1.0],
      reverse: 4.12,
      finalDrive: 4.625,
      shiftTime: 0.40,
      automatic: false,
      efficiency: 0.85,
    },
  },
  {
    // AZLK-2141 five-speed transaxle: 3.308 / 2.05 / 1.367 / 0.946 / 0.732, R 3.357,
    // on the 3.9 final drive the 2141-01 got with the VAZ 1.6 (autoopt.ru, AZLK-2141
    // 1998 catalogue). Front drive, final drive in the casing: 0.92.
    id: 'gearbox_manual5',
    kind: 'gearbox',
    label: 'AZLK-2141 five-speed',
    mass: 52,
    fits: ['car', 'truck'],
    gearbox: {
      ratios: [3.308, 2.05, 1.367, 0.946, 0.732],
      reverse: 3.357,
      finalDrive: 3.9,
      shiftTime: 0.3,
      automatic: false,
      efficiency: 0.92,
    },
  },
  {
    // Period three-speed torque-converter automatic: the converter at lock-up
    // speed ratio plus the pump drive take far more than a manual's gears, 0.85.
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
      efficiency: 0.85,
    },
  },
  {
    // Truck crashbox behind a heavy rear axle: box 0.96, propshaft 0.99, a double-
    // reduction axle 0.93, so 0.88.
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
      efficiency: 0.88,
    },
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

/**
 * The turbocharger: the optional service part in bonnet cell 1. Fitted, it boosts
 * whatever engine it sits on (see `TURBO_TORQUE_GAIN` in vehicle/drivetrain.ts):
 * nothing below the spool speed, then up to a third more torque with a short lag.
 *
 * Everything else that used to live beside it — doors, bonnets, bumpers, seats,
 * mirrors, lamps, batteries, exhausts, dashboards and loose wheels — was cosmetic
 * trim for the anchor-mounting mechanic, which is gone. A part the player can pick up
 * and put nowhere is not content; it is scrap with a mass.
 */
const TURBINE_VARIANTS: readonly PartVariant[] = [
  {
    id: 'turbine_standard',
    kind: 'turbine',
    label: 'turbocharger',
    mass: 12,
    fits: ['car', 'truck', 'bus'],
  },
];

/**
 * The air filter: a paper element in bonnet cell 4. It clogs with distance, faster
 * in a dust storm, and a clogged one starves the engine of air (vehicle/airfilter.ts).
 * No engine runs without one.
 */
const AIR_FILTER_VARIANTS: readonly PartVariant[] = [
  {
    id: 'air_filter',
    kind: 'air_filter',
    label: 'air filter',
    mass: 0.8,
    fits: ['car', 'truck', 'bus'],
  },
];

/**
 * The 2101's engine and gearbox and the Zhiguli tank, which the catalogue resolves
 * for the first saloons and the estates.
 */
const LADA_VARIANTS: readonly PartVariant[] = [
  {
    // VAZ-2101: 1.198 litre, 64 hp (47 kW) at 5600 and 8.9 kgf·m (87.3 Nm) at 3400,
    // per the 1982 AvtoVAZ catalogue (autoopt.ru, VAZ-2101). The later GOST 14846-81
    // net rating of the same unit is 43.2 kW; the car's own catalogue is what its
    // top speed and 0-100 were quoted against. Fuel cut 6000: the red zone of the
    // TX-193 tachometer the family's later cars carry (1987 VAZ album).
    id: 'engine_lada_1200',
    kind: 'engine',
    label: '1.2 inline-four',
    mass: 114,
    fits: ['car'],
    engine: {
      peakPowerKw: 47,
      powerPeakRpm: 5600,
      peakTorqueNm: 87.3,
      torquePeakRpm: 3400,
      redlineRpm: 6000,
      idleRpm: 850,
      bsfc: 0.33,
      brakingCoeff: 0.0144,
      cylinders: 4,
    },
  },
  {
    // VAZ-2101: 3.753 / 2.303 / 1.49 / 1.00, reverse 3.867, on the 4.30 hypoid axle
    // (autoopt.ru VAZ-2103 page for the box, ru.wikipedia VAZ-2101 for the axle).
    // Rear drive through a live hypoid axle: 0.90.
    id: 'gearbox_lada_4',
    kind: 'gearbox',
    label: '2101 four-speed',
    mass: 33,
    fits: ['car'],
    gearbox: {
      ratios: [3.75, 2.3, 1.49, 1.0],
      reverse: 3.87,
      finalDrive: 4.3,
      shiftTime: 0.34,
      automatic: false,
      efficiency: 0.9,
    },
  },
  { id: 'tank_lada_39', kind: 'fuel_tank', label: '39 L tank', mass: 13, capacity: 39, fits: ['car'] },
];

/*
 * ---- the Soviet pack's own driveline ----
 *
 * Fifteen bodies used to share three engines and two gearboxes, two of which were
 * the generic ones. That is what made the pack feel like one
 * car in fifteen shells: a Volga pulled like a Zhiguli, a Samara was a rear-drive
 * saloon's box bolted to a front-drive shell, and a Niva had no transfer gearing at
 * all. Every engine and every gearbox a Soviet body can be fitted with is here, with
 * the real unit's figures.
 *
 * ---- the numbers are the factory's, as printed ----
 *
 * Each engine states its catalogue power point and torque point, net at the crank,
 * and `engineTorqueNm` (vehicle/drivetrain.ts) passes through both exactly. Nothing
 * here is adjusted to make a car hit a time: where a car misses its target, the
 * mass, gearing, efficiency or drag area is what gets looked at (tools/reality.ts).
 * Where two period sources disagree, the one printed beside the car's own top speed
 * and 0-100 wins, because that is the engine those figures were measured with.
 *
 * The fuel cut is the tachometer red zone where one is published — VAZ's TX-193
 * reads red from 6000 rpm on the classics and the Samaras alike — and otherwise the
 * rated speed plus about 7%, the same margin that red zone keeps over 5600.
 *
 * ---- brakingCoeff is mechanical friction ----
 *
 * A factory figure is already net of the engine's friction, so the coefficient no
 * longer touches the full-throttle curve. It is what closed-throttle engine braking
 * is built from (×2.5, CLOSED_THROTTLE_BRAKE_FACTOR in drivetrain.ts) and what the
 * part-throttle blend charges the pedal for. The Soviet entries are sized as a
 * period petrol four's real friction — about 13% of peak torque at the redline,
 * which is 1.2 bar FMEP for these displacements — so the overrun drag lands on
 * believable figures (18 Nm at 3000 rpm for the 1.2, 43 Nm for the Volga 2.4).
 */
const SOVIET_ENGINE_VARIANTS: readonly PartVariant[] = [
  {
    // ZMZ-21A, GAZ-21 Volga: 2.445 litre, 70 hp (51.5 kW) at 4000 and 17 kgf·m
    // (166.7 Nm), per the GAZ-21 manual (garage-m21.narod.ru); the torque speed, 2200,
    // is ru.wikipedia's. No red zone is published, and the rated speed plus the usual
    // 7% is not enough: the car's own 130 km/h in direct top on the 4.55 axle and
    // 6.70-15 tyres turns the crank at 4300, so the engine demonstrably ran there.
    // The cut is 4500, a 200 rpm margin over that.
    id: 'engine_zmz_21',
    kind: 'engine',
    label: '2.4 Volga four',
    mass: 165,
    fits: ['car'],
    engine: {
      peakPowerKw: 51.5,
      powerPeakRpm: 4000,
      peakTorqueNm: 166.7,
      torquePeakRpm: 2200,
      redlineRpm: 4500,
      idleRpm: 500,
      bsfc: 0.35,
      brakingCoeff: 0.037,
      cylinders: 4,
      heat: { operatingC: 82 },
    },
  },
  {
    // ZMZ-24D, GAZ-24: the same block with a new head, 95 hp (69.9 kW) at 4500 and
    // 19.0 kgf·m (186.3 Nm) at 2200-2400, idle 600 (GAZ-24 manual, long-vehicle.narod.ru;
    // gaz24.info gives the torque at 2400). Cut at the rated speed plus 7%.
    id: 'engine_zmz_24',
    kind: 'engine',
    label: '2.4 Volga four (24)',
    mass: 170,
    fits: ['car'],
    engine: {
      peakPowerKw: 69.9,
      powerPeakRpm: 4500,
      peakTorqueNm: 186.3,
      torquePeakRpm: 2400,
      redlineRpm: 4800,
      idleRpm: 600,
      bsfc: 0.34,
      brakingCoeff: 0.0376,
      cylinders: 4,
      heat: { operatingC: 85 },
    },
  },
  {
    // VAZ-2105: 1.29 litre, the belt-driven cam version of the 2101 unit, 47.0 kW at
    // 5600 and 92 Nm (9.4 kgf·m) at 3400 (autoopt.ru, VAZ-2105 catalogue).
    id: 'engine_lada_1300',
    kind: 'engine',
    label: '1.3 inline-four',
    mass: 116,
    fits: ['car'],
    engine: {
      peakPowerKw: 47,
      powerPeakRpm: 5600,
      peakTorqueNm: 92,
      torquePeakRpm: 3400,
      redlineRpm: 6000,
      idleRpm: 850,
      bsfc: 0.32,
      brakingCoeff: 0.0156,
      cylinders: 4,
    },
  },
  {
    // VAZ-2103: 1.45 litre, 53.3 kW (72.5 hp) at 5600 and 104 Nm at 3400 under GOST
    // 14846-81 (autoopt.ru, VAZ-2103 and VAZ-2107 catalogues). The TX-193 tachometer
    // fitted with it reads red from 6000.
    id: 'engine_lada_1500',
    kind: 'engine',
    label: '1.5 inline-four',
    mass: 118,
    fits: ['car'],
    engine: {
      peakPowerKw: 53.3,
      powerPeakRpm: 5600,
      peakTorqueNm: 104,
      torquePeakRpm: 3400,
      redlineRpm: 6000,
      idleRpm: 850,
      bsfc: 0.32,
      brakingCoeff: 0.0172,
      cylinders: 4,
    },
  },
  {
    // VAZ-2106: 1.57 litre, 55.5 kW (75.5 hp) at 5400 and 116 Nm (11.8 kgf·m) at 3000
    // (autoopt.ru, VAZ-2106 catalogue). Red zone 6000 on its TX-193 tachometer.
    id: 'engine_lada_1600',
    kind: 'engine',
    label: '1.6 inline-four (VAZ)',
    mass: 121,
    fits: ['car'],
    engine: {
      peakPowerKw: 55.5,
      powerPeakRpm: 5400,
      peakTorqueNm: 116,
      torquePeakRpm: 3000,
      redlineRpm: 6000,
      idleRpm: 850,
      bsfc: 0.32,
      brakingCoeff: 0.0199,
      cylinders: 4,
    },
  },
  {
    // VAZ-2108: 1.29 litre transverse four, 47.0 kW at 5600 and 94 Nm at 3400
    // (autoopt.ru, VAZ-2109 1991 catalogue; the 2108 page prints 94 Nm at 3500). The
    // Samara tachometer reads red above 6000 (2108 manual).
    id: 'engine_samara_1300',
    kind: 'engine',
    label: '1.3 Samara four',
    mass: 116,
    fits: ['car'],
    engine: {
      peakPowerKw: 47,
      powerPeakRpm: 5600,
      peakTorqueNm: 94,
      torquePeakRpm: 3400,
      redlineRpm: 6000,
      idleRpm: 850,
      bsfc: 0.3,
      brakingCoeff: 0.0152,
      cylinders: 4,
    },
  },
  {
    // VAZ-21083: 1.5 litre, 51.5 kW (70 hp) at 5600 and 106.4 Nm at 3400 (autoopt.ru,
    // VAZ-2109 catalogue; the 21099 manual rates it GOST 14846-81 net).
    id: 'engine_samara_1500',
    kind: 'engine',
    label: '1.5 Samara four',
    mass: 118,
    fits: ['car'],
    engine: {
      peakPowerKw: 51.5,
      powerPeakRpm: 5600,
      peakTorqueNm: 106.4,
      torquePeakRpm: 3400,
      redlineRpm: 6000,
      idleRpm: 850,
      bsfc: 0.3,
      brakingCoeff: 0.0176,
      cylinders: 4,
    },
  },
  {
    // VAZ-1111: the 2108 engine cut in half — two cylinders, 76 x 71 mm, 0.649 litre.
    // AvtoVAZ's 1998 catalogue gives 21.5 kW (29.3 hp) at 5600 and 44.1 Nm at 3400
    // (autoopt.ru, VAZ-1111; the manual's later GOST 14846-88 rating is 20.7 kW at
    // 5000 and 44.0 Nm at 3000). Cut at the Samara family's 6000. Mass is the
    // catalogue's bare engine without clutch or gearbox.
    id: 'engine_vaz_1111',
    kind: 'engine',
    label: '0.65 VAZ-1111 twin',
    mass: 66.5,
    fits: ['car'],
    engine: {
      peakPowerKw: 21.5,
      powerPeakRpm: 5600,
      peakTorqueNm: 44.1,
      torquePeakRpm: 3400,
      redlineRpm: 6000,
      idleRpm: 850,
      bsfc: 0.33,
      brakingCoeff: 0.0073,
      cylinders: 2,
    },
  },
  {
    // VAZ-2121: the 2106 block with the Niva's own head and manifolds, 53.7 kW (73 hp)
    // at 5400 and 114 Nm (11.6 kgf·m) at 3400 (autoopt.ru, VAZ-2121 catalogue — the
    // same page as the car's 132 km/h and 23 s). The 2106 block's 6000 red zone. The
    // transfer case's loss is the gearbox's efficiency, not a deduction from this engine.
    id: 'engine_niva_1600',
    kind: 'engine',
    label: '1.6 Niva four',
    mass: 125,
    fits: ['car'],
    engine: {
      peakPowerKw: 53.7,
      powerPeakRpm: 5400,
      peakTorqueNm: 114,
      torquePeakRpm: 3400,
      redlineRpm: 6000,
      idleRpm: 850,
      bsfc: 0.33,
      brakingCoeff: 0.0208,
      cylinders: 4,
    },
  },
  {
    // VAZ-21213: 1.69 litre, 58.0 kW (78.9 hp) at 5200 and 127 Nm at 3000, GOST
    // 14846-81 net (21213 manual, lada-niva.ru). The long-stroke Niva engine, which is
    // the whole reason a 2131 will crawl. Cut at the rated speed plus 7%.
    id: 'engine_niva_1700',
    kind: 'engine',
    label: '1.7 Niva four',
    mass: 128,
    fits: ['car'],
    engine: {
      peakPowerKw: 58,
      powerPeakRpm: 5200,
      peakTorqueNm: 127,
      torquePeakRpm: 3000,
      redlineRpm: 5600,
      idleRpm: 800,
      bsfc: 0.33,
      brakingCoeff: 0.0227,
      cylinders: 4,
    },
  },
  {
    // The rally 2105's 1.6: twin Webers, a rally cam, a lightened flywheel and a 6800
    // rpm limit. Not a catalogue engine — it is the pack's own build — so its figures
    // are the build's: 100 hp (73.5 kW) at 6400 and 132 Nm at 4200, with nothing below
    // it, which is exactly what makes the car a handful.
    id: 'engine_lada_rally',
    kind: 'engine',
    label: '1.6 rally four',
    mass: 118,
    fits: ['car'],
    engine: {
      peakPowerKw: 73.5,
      powerPeakRpm: 6400,
      peakTorqueNm: 132,
      torquePeakRpm: 4200,
      redlineRpm: 6800,
      idleRpm: 1100,
      bsfc: 0.36,
      brakingCoeff: 0.018,
      cylinders: 4,
      heat: { warningC: 108 },
    },
  },
];

/*
 * The pack's gearboxes. Ratios and final drives are the factory's, and they are
 * the reason these cars pull the way they do: the classics run a 4.30 or 4.10 axle
 * behind a direct top gear, so top speed arrives near the rated speed; the Samaras
 * are a five-speed transaxle with a 0.784 overdrive, so theirs arrives below it.
 *
 * The Niva has no transfer-case field to put its reduction in, so its HIGH range
 * (1.20:1) is folded into the final drive. Low range is not modelled. What IS
 * modelled of the transfer case now is its loss: a second gearset, two propshafts
 * and a third differential take the 4x4 boxes down to 0.85 efficiency.
 *
 * Efficiency bands (see `GearboxSpec.efficiency`): rear drive through a live hypoid
 * axle 0.90, a front-drive transaxle 0.92, a 4x4 through its transfer case 0.85.
 */
const SOVIET_GEARBOX_VARIANTS: readonly PartVariant[] = [
  {
    // GAZ-21: three speeds on the column, 3.115 / 1.772 / 1.000, reverse 3.738, on a
    // 4.55 axle (autoopt.ru GAZ-21; 41:9 in the manual). No synchro on first, and a
    // change that takes the best part of a second if you are honest about it.
    id: 'gearbox_gaz_3',
    kind: 'gearbox',
    label: '3-speed column shift',
    mass: 43,
    fits: ['car'],
    gearbox: {
      ratios: [3.115, 1.772, 1.0],
      reverse: 3.738,
      finalDrive: 4.55,
      shiftTime: 0.6,
      automatic: false,
      efficiency: 0.9,
    },
  },
  {
    // IZH/Moskvich four-speed: 3.49, 2.04, 1.33, 1.00; reverse 3.39 (autoopt.ru,
    // Moskvich-412); the working-vehicle final drive is the 4.22 pair (IZH-2715).
    id: 'gearbox_izh_4',
    kind: 'gearbox',
    label: 'IZH/Moskvich four-speed',
    mass: 22,
    fits: ['truck'],
    gearbox: {
      ratios: [3.49, 2.04, 1.33, 1.0],
      reverse: 3.39,
      finalDrive: 4.22,
      shiftTime: 0.4,
      automatic: false,
      efficiency: 0.9,
    },
  },
  {
    // GAZ-24: 3.5 / 2.26 / 1.45 / 1.0, reverse 3.54, on a 4.1 hypoid axle (GAZ-24
    // manual, long-vehicle.narod.ru).
    id: 'gearbox_gaz_4',
    kind: 'gearbox',
    label: '4-speed Volga',
    mass: 46,
    fits: ['car'],
    gearbox: {
      ratios: [3.5, 2.26, 1.45, 1.0],
      reverse: 3.54,
      finalDrive: 4.1,
      shiftTime: 0.45,
      automatic: false,
      efficiency: 0.9,
    },
  },
  {
    // VAZ-2102: the 2101's box on a shorter axle for the estate's load, "from 3.9 to
    // 4.4" in the catalogue's words (autoopt.ru, VAZ-2102): the 40:9 pair, 4.44.
    id: 'gearbox_lada_4_2102',
    kind: 'gearbox',
    label: '2102 four-speed',
    mass: 33,
    fits: ['car'],
    gearbox: {
      ratios: [3.75, 2.3, 1.49, 1.0],
      reverse: 3.87,
      finalDrive: 4.44,
      shiftTime: 0.34,
      automatic: false,
      efficiency: 0.9,
    },
  },
  {
    // VAZ-2105 / 2104: the later close-ratio box, 3.67 / 2.10 / 1.36 / 1.00, reverse
    // 3.53, on the 4.3 axle the 1.3 was sold with (autoopt.ru, VAZ-2105 and VAZ-2104).
    id: 'gearbox_lada_4_2105',
    kind: 'gearbox',
    label: '2105 four-speed',
    mass: 33,
    fits: ['car'],
    gearbox: {
      ratios: [3.67, 2.1, 1.36, 1.0],
      reverse: 3.53,
      finalDrive: 4.3,
      shiftTime: 0.34,
      automatic: false,
      efficiency: 0.9,
    },
  },
  {
    // VAZ-2103: 3.75 / 2.3 / 1.49 / 1.0, reverse 3.87, on the 4.1 axle (autoopt.ru,
    // VAZ-2103 catalogue).
    id: 'gearbox_lada_4_tall',
    kind: 'gearbox',
    label: '2103 four-speed',
    mass: 33,
    fits: ['car'],
    gearbox: {
      ratios: [3.75, 2.3, 1.49, 1.0],
      reverse: 3.87,
      finalDrive: 4.1,
      shiftTime: 0.34,
      automatic: false,
      efficiency: 0.9,
    },
  },
  {
    // VAZ-2106: the 2106-10 box, 3.67 / 2.10 / 1.36 / 1.00, reverse 3.53, on the 3.9
    // axle it was paired with (autoopt.ru, VAZ-2106).
    id: 'gearbox_lada_4_1600',
    kind: 'gearbox',
    label: '2106 four-speed',
    mass: 33,
    fits: ['car'],
    gearbox: {
      ratios: [3.67, 2.1, 1.36, 1.0],
      reverse: 3.53,
      finalDrive: 3.9,
      shiftTime: 0.34,
      automatic: false,
      efficiency: 0.9,
    },
  },
  {
    // The classics' five-speed: 3.67 / 2.10 / 1.36 / 1.00 and an 0.82 overdrive, on the
    // 3.9 axle (autoopt.ru, VAZ-2107).
    id: 'gearbox_lada_5',
    kind: 'gearbox',
    label: '2107 five-speed',
    mass: 40,
    fits: ['car'],
    gearbox: {
      ratios: [3.67, 2.1, 1.36, 1.0, 0.82],
      reverse: 3.53,
      finalDrive: 3.9,
      shiftTime: 0.32,
      automatic: false,
      efficiency: 0.9,
    },
  },
  {
    // Samara transaxle, 3.636 / 1.95 / 1.357 / 0.941 / 0.784, reverse 3.53, 1.3 axle
    // 3.94 (autoopt.ru, VAZ-2109). Box and final drive are one casting, so its mass
    // carries the differential the rear-drive cars keep in the axle.
    id: 'gearbox_samara_5',
    kind: 'gearbox',
    label: '2108 five-speed',
    mass: 45,
    fits: ['car'],
    gearbox: {
      ratios: [3.636, 1.95, 1.357, 0.941, 0.784],
      reverse: 3.53,
      finalDrive: 3.94,
      shiftTime: 0.36,
      automatic: false,
      efficiency: 0.92,
    },
  },
  {
    // The same transaxle on the 1.5's taller 3.7 axle (21099 manual, vaz-sputnik.ru):
    // the fastest Samara.
    id: 'gearbox_samara_5_tall',
    kind: 'gearbox',
    label: '21083 five-speed',
    mass: 45,
    fits: ['car'],
    gearbox: {
      ratios: [3.636, 1.95, 1.357, 0.941, 0.784],
      reverse: 3.53,
      finalDrive: 3.706,
      shiftTime: 0.36,
      automatic: false,
      efficiency: 0.92,
    },
  },
  {
    // VAZ-1111 transaxle: four synchronised speeds, 3.70 / 2.06 / 1.27 / 0.90, reverse
    // 3.67, and the 1111's 4.54 final drive in the same casing (the 11113 got 4.10).
    // Catalogue mass with the differential (1111 manual, autoprospect.ru).
    id: 'gearbox_oka_4',
    kind: 'gearbox',
    label: '1111 four-speed',
    mass: 24.5,
    fits: ['car'],
    gearbox: {
      ratios: [3.7, 2.06, 1.27, 0.9],
      reverse: 3.67,
      finalDrive: 4.54,
      shiftTime: 0.36,
      automatic: false,
      efficiency: 0.92,
    },
  },
  {
    // VAZ-2121: 3.667 / 2.100 / 1.361 / 1.000, reverse 3.526, a 1.2 high range and a
    // 4.1 axle (autoopt.ru, VAZ-2121): 4.1 x 1.2 = 4.92 folded into the final drive.
    id: 'gearbox_niva_4',
    kind: 'gearbox',
    label: 'Niva four-speed',
    mass: 62,
    fits: ['car'],
    gearbox: {
      ratios: [3.67, 2.1, 1.36, 1.0],
      reverse: 3.53,
      finalDrive: 4.92,
      shiftTime: 0.38,
      automatic: false,
      efficiency: 0.85,
    },
  },
  {
    // VAZ-21213/2131: the five-speed, 3.67 / 2.1 / 1.36 / 1 / 0.82, reverse 3.53, the
    // 1.2 high range and the 3.9 axle (21213 manual, lada-niva.ru): 3.9 x 1.2 = 4.68.
    id: 'gearbox_niva_5',
    kind: 'gearbox',
    label: 'Niva five-speed',
    mass: 68,
    fits: ['car'],
    gearbox: {
      ratios: [3.67, 2.1, 1.36, 1.0, 0.82],
      reverse: 3.53,
      finalDrive: 4.68,
      shiftTime: 0.38,
      automatic: false,
      efficiency: 0.85,
    },
  },
];

/**
 * The radiator. One core for every engine: what decides how well an engine is cooled
 * is how much water is in it (`waterCoolingEffect` in vehicle/cooling.ts), not which
 * core is bolted in.
 */
const RADIATOR_VARIANTS: readonly PartVariant[] = [
  {
    id: 'radiator',
    kind: 'radiator',
    label: 'radiator',
    mass: 9,
    fits: ['car', 'truck', 'bus'],
    radiator: { capacity: 9 },
  },
];

export const ALL_VARIANTS: readonly PartVariant[] = [
  ...ENGINE_VARIANTS,
  ...GEARBOX_VARIANTS,
  ...TANK_VARIANTS,
  ...RADIATOR_VARIANTS,
  ...TURBINE_VARIANTS,
  ...AIR_FILTER_VARIANTS,
  ...LADA_VARIANTS,
  ...SOVIET_ENGINE_VARIANTS,
  ...SOVIET_GEARBOX_VARIANTS,
];

const VARIANTS_BY_ID = new Map(ALL_VARIANTS.map((v) => [v.id, v]));

export function variant(id: string): PartVariant {
  const found = VARIANTS_BY_ID.get(id);
  if (!found) throw new Error(`unknown part variant: ${id}`);
  return found;
}

export function hasVariant(id: string): boolean {
  return VARIANTS_BY_ID.has(id);
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
 * state: only engines acquire it, and no cleaning tool clears it. `clog` is the air
 * filter's own wear, which no cleaning tool clears either: a clogged element is
 * replaced.
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
  /** Air filters only: how clogged the element is, 0 new .. 1 worn out (may run past 1). */
  clog?: number;
}

/** Rust low enough to count as bare metal. */
export const RUST_CLEAN_EPSILON = 0.02;

/** Sponge rates per second, applied while it is held against the part. */
const SPONGE_RUST_RATE = 0.28;
const SPONGE_DIRT_RATE = 0.7;

/**
 * Scrubs a part with a sponge: rust and dirt come off together. `budget` is what the
 * sponge has left to give (a sum of fractions, see `ToolItem.capacity`); the stroke is
 * cut short to fit it. Returns how much it took off, 0 when nothing changed.
 */
export function applySponge(part: PartInstance, dt: number, budget: number): number {
  const rustStep = Math.min(part.rust, SPONGE_RUST_RATE * dt);
  const dirtStep = Math.min(part.dirt, SPONGE_DIRT_RATE * dt);
  const total = rustStep + dirtStep;
  if (total <= 0 || budget <= 0) return 0;
  const k = Math.min(1, budget / total);
  part.rust = Math.max(0, part.rust - rustStep * k);
  part.dirt = Math.max(0, part.dirt - dirtStep * k);
  return total * k;
}

/**
 * Oil capacity for an engine, litres.
 *
 * Derived from cylinder count rather than authored per engine: a bigger engine
 * holds more, and the relationship is close enough to linear that a table would
 * only be six numbers restating this. Water is NOT here — it belongs to the fitted
 * radiator (`RadiatorSpec.capacity`).
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
 *  - The radiator is rated against this heat, so every engine is cooled with the same
 *    margin when the core is full (see vehicle/cooling.ts).
 *
 * Cached per spec object: the profile is pure, and the fixed step asks for it every
 * tick for every live car.
 */
const heatCache = new WeakMap<EngineSpec, EngineHeatSpec>();

export function engineHeat(engine: EngineSpec): EngineHeatSpec {
  const cached = heatCache.get(engine);
  if (cached) return cached;

  const loadHeatKw = engine.peakPowerKw * 0.85;
  const idleHeatKw = engine.peakPowerKw * 0.05;
  const rpmHeatKw = engine.peakPowerKw * 0.1;
  const derived: EngineHeatSpec = {
    operatingC: 90,
    optimalMinC: 75,
    optimalMaxC: 105,
    warningC: 110,
    criticalC: 125,
    maxC: 140,
    idleHeatKw,
    loadHeatKw,
    rpmHeatKw,
    thermalMassKjPerK: 12 + engine.cylinders * 4.5 + engine.peakPowerKw * 0.06,
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
 * `WATER_BOIL_LPH_PER_K` in vehicle/cooling.ts), which is what makes a low radiator
 * cost water faster the lower it gets.
 */
export const OIL_LOSS_LPH = 2.1;

/**
 * What the physics and HUD need from a car. Every field is a property of the
 * complete model (vehicle/carmodels.ts): there is no "missing part" state left,
 * so a car is always drivable and this carries no flag saying so.
 */
export interface CarStats {
  /** Total vehicle mass, kg: the model's kerb mass plus everything since loaded. */
  readonly mass: number;
  readonly engine: EngineSpec;
  readonly gearbox: GearboxSpec;
  readonly tankCapacity: number;
  readonly wheelCount: number;
  /** Tyre grip multiplier on the surface's friction. */
  readonly wheelGrip: number;
  readonly hasHeadlights: boolean;
}

