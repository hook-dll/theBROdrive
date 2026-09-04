/**
 * tools/soviet-reality.ts
 *
 * The Soviet pack against the cars it is about.
 *
 * Every column has a factory or period road-test figure beside it, because "handles
 * like the real one" is only a claim you can check if the real one's numbers are in
 * the same table. It runs the real bench (`benchOne`, i.e. the real
 * `Vehicle.fixedUpdate`) and prints measured-vs-real with the deviation:
 *
 *   geometry   wheelbase and rolling radius, against the factory's
 *   top        sustained flat-out speed on level asphalt
 *   0-100      through the gears, where the real car managed it at all
 *   turn       full-lock radius, converted to the outer-front-wheel figure a
 *              factory turning circle actually quotes (centreline + half a track)
 *   grip       steady-state lateral acceleration, against what period tyres pull
 *   ride       front heave frequency, against the suspension's design figure
 *   brake      100-0 distance, against period tests
 *
 *   npx tsx tools/soviet-reality.ts [modelId ...]
 *
 * Nothing here is part of the game bundle.
 */

import { installAssetShim } from './assetshim';
import { CAR_MODELS, carModel } from '../src/vehicle/carmodels';
import { preloadCarModels, carModelMeasure } from '../src/render/carmodel';
import { benchOne } from './handling-bench';
import { createPartMesh } from '../src/render/partmesh';

installAssetShim();

interface Real {
  /** Wheelbase m, track m, rolling radius m. */
  wb: number;
  track: number;
  radius: number;
  /** Top speed km/h, 0-100 km/h s (null where no period figure is credible). */
  top: number;
  to100: number | null;
  /** Turning radius m, by the outer front wheel, as the factory quotes it. */
  turn: number;
  /** Steady-state lateral acceleration, g, and 100-0 km/h braking distance, m. */
  lat: number;
  brake: number;
  /** Design front heave frequency, Hz. */
  hz: number;
}

/**
 * Factory and period-road-test reference data for the fifteen cars.
 *
 * Two of these columns need saying out loud, because using the modern equivalent
 * makes the pack look badly tuned when it is not:
 *
 * BRAKING. Period Soviet figures are quoted from 80 km/h and are not modern: the
 * 2101's is 43 m, i.e. about 0.58 g, on drum rears and 155-section cross-plies. The
 * distances here are the 100-0 equivalents of what these cars actually achieved —
 * 0.5 g for the drum-braked GAZ-21 through to 0.66 g for a Samara — converted from the
 * period 80 km/h figures (GAZ-21 50 m, 2101 43 m, Samara 38 m, Niva 43 m), not the
 * 45-50 m a modern hatchback stops in.
 *
 * ACCELERATION. Published Soviet 0-100 figures vary substantially with source and
 * test method. A null target means there was no figure credible enough to tune
 * against; the bench still prints its result rather than silently substituting one.
 */
const REAL: Readonly<Record<string, Real>> = {
  sv_gaz21: { wb: 2.7, track: 1.41, radius: 0.365, top: 130, to100: null, turn: 6.3, lat: 0.6, brake: 87, hz: 0.95 },
  sv_gaz24: { wb: 2.8, track: 1.47, radius: 0.354, top: 145, to100: 21, turn: 5.65, lat: 0.64, brake: 78, hz: 1.0 },
  sv_vaz2101: { wb: 2.424, track: 1.349, radius: 0.289, top: 140, to100: 22, turn: 5.6, lat: 0.7, brake: 75, hz: 1.1 },
  sv_vaz2102: { wb: 2.424, track: 1.349, radius: 0.289, top: 135, to100: 25, turn: 5.6, lat: 0.68, brake: 76, hz: 1.1 },
  sv_vaz2103: { wb: 2.424, track: 1.365, radius: 0.289, top: 152, to100: 17, turn: 5.6, lat: 0.71, brake: 74, hz: 1.1 },
  sv_vaz2104: { wb: 2.424, track: 1.365, radius: 0.289, top: 143, to100: 19, turn: 5.6, lat: 0.69, brake: 76, hz: 1.1 },
  sv_vaz2105: { wb: 2.424, track: 1.365, radius: 0.289, top: 145, to100: 19, turn: 5.6, lat: 0.71, brake: 74, hz: 1.1 },
  sv_vaz2105r: { wb: 2.424, track: 1.365, radius: 0.3, top: 170, to100: 11, turn: 5.6, lat: 0.85, brake: 51, hz: 1.55 },
  sv_vaz2106: { wb: 2.424, track: 1.365, radius: 0.289, top: 152, to100: 16, turn: 5.6, lat: 0.72, brake: 74, hz: 1.1 },
  sv_vaz2107: { wb: 2.424, track: 1.365, radius: 0.289, top: 150, to100: 16, turn: 5.6, lat: 0.72, brake: 74, hz: 1.1 },
  sv_vaz2108: { wb: 2.46, track: 1.4, radius: 0.281, top: 148, to100: 16, turn: 5.2, lat: 0.78, brake: 66, hz: 1.3 },
  sv_vaz2109: { wb: 2.46, track: 1.4, radius: 0.281, top: 148, to100: 16.5, turn: 5.2, lat: 0.78, brake: 66, hz: 1.3 },
  sv_vaz21099: { wb: 2.46, track: 1.4, radius: 0.281, top: 156, to100: 14, turn: 5.2, lat: 0.78, brake: 66, hz: 1.3 },
  sv_niva: { wb: 2.2, track: 1.43, radius: 0.343, top: 132, to100: 21, turn: 5.5, lat: 0.66, brake: 75, hz: 1.15 },
  sv_niva_long: { wb: 2.7, track: 1.44, radius: 0.343, top: 137, to100: 24, turn: 6.2, lat: 0.64, brake: 78, hz: 1.15 },
};

/** `value` against `real`, as a signed percentage, or a dash when there is no target. */
function dev(value: number, real: number | null): string {
  if (real === null || real === 0) return '     -';
  return `${(((value - real) / real) * 100).toFixed(0).padStart(4)}%`;
}

function pad(value: string | number, width: number): string {
  return String(value).padStart(width);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const ids =
    argv.length > 0 ? argv : CAR_MODELS.filter((m) => m.id.startsWith('sv_')).map((m) => m.id);

  // Every new driveline id must also have a render blueprint. `partmesh.ts` throws
  // on an unhandled id, so building one of each here proves a loose Soviet engine
  // or gearbox can actually spawn instead of finding that hole hours into a save.
  const drivelineIds = new Set<string>();
  for (const id of ids) {
    const def = carModel(id);
    drivelineIds.add(def.engineId);
    drivelineIds.add(def.gearboxId);
  }
  for (const id of drivelineIds) createPartMesh(id);
  console.log(`--- driveline meshes: ${drivelineIds.size} built ---`);

  await preloadCarModels(ids);

  console.log('--- geometry: what the model measures against the real car ---');
  console.log('model             wb    real   dev    radius   real   dev   scale');
  for (const id of ids) {
    const def = carModel(id);
    const m = carModelMeasure(id);
    const front = m.wheels.filter((w) => w.isFront);
    const rear = m.wheels.filter((w) => !w.isFront);
    const wb = Math.abs(front[0].pos[2] - rear[0].pos[2]);
    const real = REAL[id];
    console.log(
      `${id.padEnd(14)} ${wb.toFixed(3)}  ${real.wb.toFixed(3)} ${dev(wb, real.wb)}   ` +
        `${m.wheels[0].radius.toFixed(3)}  ${real.radius.toFixed(3)} ${dev(
          m.wheels[0].radius,
          real.radius,
        )}  ${def.scale.toFixed(6)}`,
    );
  }

  console.log('');
  console.log('--- behaviour: measured against the factory ---');
  console.log(
    'model            top  real   dev  spike   0-100  real    turn  real   dev    lat  real   dev   ' +
      'ride  real   brake  real   dev',
  );
  for (const id of ids) {
    const r = await benchOne(id);
    const real = REAL[id];
    // A factory turning radius is swept by the OUTER FRONT WHEEL, and the bench
    // measures the path of the centre of mass, so the two differ by half a track.
    // The conversion uses the REAL track, not the model's: the pack's track widths
    // are wrong (see the catalogue note) and converting through a wrong one would
    // hide a steering-lock error inside a geometry error.
    const realCentre = real.turn - real.track / 2;
    console.log(
      `${id.padEnd(14)} ${pad(r.topSpeedKmh.toFixed(0), 4)} ${pad(real.top, 5)} ${dev(
        r.topSpeedKmh,
        real.top,
      )} ${pad(r.topSpeedSpikeKmh.toFixed(0), 5)}  ${pad(r.to100s ?? 'never', 6)} ${pad(
        real.to100 ?? '-',
        5,
      )}   ${pad(r.turnRadiusM.toFixed(2), 5)} ${pad(realCentre.toFixed(2), 5)} ${dev(
        r.turnRadiusM,
        realCentre,
      )}   ${pad(
        r.skidpadG.toFixed(2),
        4,
      )} ${pad(real.lat.toFixed(2), 5)} ${dev(r.skidpadG, real.lat)}  ${pad(
        r.bounceHz.toFixed(2),
        5,
      )} ${pad(real.hz.toFixed(2), 5)}  ${pad(r.brakeDistM.toFixed(1), 6)} ${pad(
        real.brake,
        5,
      )} ${dev(r.brakeDistM, real.brake)}`,
    );
  }
}

await main();
