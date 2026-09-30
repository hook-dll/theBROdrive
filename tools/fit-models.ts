/**
 * tools/fit-models.ts
 *
 * Measures catalogue bodies the way the game does and writes the result into
 * src/vehicle/model-fits.json, so physics and POI layout see the same body before the
 * visual has streamed in as after.
 *
 * A new entry needs a provisional fit before the catalogue will even load (any
 * bounds and wheel mounts of the right shape); this replaces it with the measured
 * one. Existing entries are rewritten only when named.
 *
 *   bun tools/fit-models.ts <modelId ...>
 *
 * Nothing here is part of the game bundle.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { installAssetShim } from './assetshim';
import { carModelMeasure, preloadCarModels } from '../src/render/carmodel';
import { hasCarModel } from '../src/vehicle/carmodels';

installAssetShim();

const FITS_PATH = new URL('../src/vehicle/model-fits.json', import.meta.url);

const ids = process.argv.slice(2);
if (ids.length === 0) {
  console.error('usage: bun tools/fit-models.ts <modelId ...>');
  process.exit(2);
}
for (const id of ids) {
  if (!hasCarModel(id)) {
    console.error(`unknown model "${id}"`);
    process.exit(2);
  }
}

await preloadCarModels(ids);
const fits = JSON.parse(readFileSync(FITS_PATH, 'utf8')) as Record<string, unknown>;
for (const id of ids) {
  const m = carModelMeasure(id);
  fits[id] = {
    halfExtents: m.halfExtents,
    wheels: m.wheels.map((w) => ({ id: w.id, pos: w.pos, radius: w.radius, isFront: w.isFront })),
    hoodPoint: m.hoodPoint,
    visualOffset: m.visualOffset,
  };
  const [x, y, z] = m.halfExtents;
  console.log(`${id}: box ${(2 * x).toFixed(3)} x ${(2 * y).toFixed(3)} x ${(2 * z).toFixed(3)} m`);
}
writeFileSync(FITS_PATH, `${JSON.stringify(fits, null, 2)}\n`);
