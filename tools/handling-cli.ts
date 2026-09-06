/**
 * tools/handling-cli.ts
 *
 * `handling-bench.ts` from a terminal, and its regression checks with it.
 *
 * The bench itself only ever RETURNED numbers, and its header said it had to be
 * imported from the dev server in a browser because "Rapier is WASM and Three wants a
 * document". Neither is true of the bench's own code: Rapier's compat build runs under
 * Node, and the only thing three needs is the handful of loader globals `assetshim.ts`
 * provides. So the bench is now runnable where a change is made, which is the whole
 * difference between a bench that gets run and one that does not.
 *
 *   npx tsx tools/handling-cli.ts [modelId ...]
 *
 * The three checks at the end are pass/fail: a parked car must not creep down a 20
 * degree slope, and an automatic must recover from rolling backwards.
 *
 * Nothing here is part of the game bundle.
 */

import { installAssetShim } from './assetshim';
import {
  runAutomaticNeutralReverseCheck,
  runAutomaticRollbackCheck,
  runBench,
  runParkingSlopeCheck,
  type BenchResult,
} from './handling-bench';

installAssetShim();

const ids = process.argv.slice(2);
const DEFAULT_IDS = ['sv_vaz2101', 'sa_vaz2110', 'sv_vaz2105r', 'sa_uaz330364', 'sa_gaz2217'];

function pad(value: string | number, width: number): string {
  return String(value).padStart(width);
}

function accelBrakeRow(r: BenchResult): string {
  return (
    `${r.id.padEnd(14)} ${pad(r.to100s ?? 'never', 7)} ${pad(r.speedAfter20s, 7)} ` +
    `${pad(r.brakeFromKmh, 7)} ${pad(r.brakeDistM, 8)} ${pad(r.brakePeakG, 7)} ` +
    `${pad(r.brakeMeanG, 7)} ${pad(r.frontLock, 6)} ${pad(r.rearLock, 6)} ${pad(r.brakeYawDeg, 7)}`
  );
}

function rideRow(r: BenchResult): string {
  return (
    `${r.id.padEnd(14)} ${pad(r.rideHeightM, 8)} ${pad(r.bounceMm, 8)} ${pad(r.bounceHz, 8)} ` +
    `${pad(r.settleS, 8)} ${pad(r.skidpadG, 8)} ${pad(r.skidpadSlipDeg, 7)} ` +
    `${pad(r.skidpadRollDeg, 7)} ${pad(r.maxLeanDeg, 7)} ${pad(r.trailYawGain, 7)}`
  );
}

function roadLimitRow(r: BenchResult): string {
  return (
    `${r.id.padEnd(14)} ${pad(r.topSpeedKmh, 11)} ${pad(r.topSpeedSpikeKmh, 8)} ` +
    `${pad(r.turnRadiusM, 10)} ${pad(r.limitLateralG, 9)}`
  );
}

async function main(): Promise<void> {
  const results = await runBench(ids.length > 0 ? ids : DEFAULT_IDS);

  console.log('--- acceleration and braking ---');
  console.log(
    'model            0-100    20s     from    dist     peak    mean   front   rear     yaw',
  );
  for (const r of results) console.log(accelBrakeRow(r));

  console.log('');
  console.log('--- ride and cornering ---');
  console.log(
    'model             height  bounce      Hz  settle  skidpad    slip    roll    lean    yaw+',
  );
  for (const r of results) console.log(rideRow(r));

  console.log('');
  console.log('--- ride and cornering (flat-out and full-lock) ---');
  console.log(
    `${'model'.padEnd(14)} ${pad('top km/h', 11)} ${pad('spike', 8)} ` +
      `${pad('radius m', 10)} ${pad('limit g', 9)}`,
  );
  for (const r of results) console.log(roadLimitRow(r));

  console.log('');
  console.log('--- regression checks ---');
  let failures = 0;
  const check = async (label: string, run: () => Promise<unknown>): Promise<void> => {
    try {
      const value = await run();
      console.log(`  ok    ${label}: ${JSON.stringify(value)}`);
    } catch (error) {
      failures++;
      console.log(`  FAIL  ${label}: ${(error as Error).message}`);
    }
  };
  await check('parked on a 20 degree slope (drift m)', async () => runParkingSlopeCheck());
  await check('automatic recovers from rollback', async () => runAutomaticRollbackCheck());
  await check('automatic takes reverse while rolling back', async () =>
    runAutomaticNeutralReverseCheck(),
  );
  if (failures > 0) process.exitCode = 1;
}

await main();
