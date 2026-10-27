/**
 * tools/kit-fingerprint.ts — the frozen look of every kit car
 *
 * A generator change must not move a car it was not meant for (owner, 2026-10-27: "the
 * generator is a tool to make a body; fixing one car must not touch all of them or all the
 * similar ones"). New behaviour goes behind a new spec field whose absence keeps every
 * other car as it was (src/carkit/README.md, "Adding to the generator"); this check holds
 * the line. Every car's built geometry is hashed and compared with the hash recorded in
 * src/carkit/fingerprints.json when the owner last saw the car:
 *
 *   nice -n 15 bun tools/kit-fingerprint.ts [id ...]           compare (default: every car)
 *   nice -n 15 bun tools/kit-fingerprint.ts --write id [id ...] record these cars as they are
 *
 * A hash covers every triangle in the kit frame (vertices rounded to 0.01 mm, sorted, so
 * emission order does not matter) with its slot and its colour (rounded to 1/1000), so a
 * part turned from body colour to black moves it as surely as a vertex does. It is kept
 * per zone (exterior, cabin, bay, boot, under, wheel), so a report says where a car moved.
 * `--write` takes named cars only: re-recording is a decision about those cars (the owner
 * asked for the change, or accepted it), never a way to make a run pass. Exits 1 when a
 * recorded car moved; a car with no record is listed as not frozen.
 *
 * Nothing here is part of the game bundle.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { installAssetShim } from './assetshim';
import { buildCar, kitIds, soupOf, type Soup } from './kitlib';

installAssetShim();

const PATH = new URL('../src/carkit/fingerprints.json', import.meta.url).pathname;

interface Print {
  readonly triangles: number;
  readonly zones: Readonly<Record<string, string>>;
}

const args = process.argv.slice(2);
const write = args.includes('--write');
const named = args.filter((a) => !a.startsWith('--'));
if (write && named.length === 0) {
  console.error('--write records named cars only: kit-fingerprint.ts --write <id> [id ...]');
  process.exit(2);
}
const ids = kitIds(args);
const recorded: Record<string, Print> = JSON.parse(readFileSync(PATH, 'utf8')) as Record<string, Print>;

/** One triangle's key: its sorted vertices at 0.01 mm, its slot and its colour. */
function triangleKey(s: Soup, t: number): string {
  const o = t * 9;
  const verts: string[] = [];
  for (let j = 0; j < 3; j++) {
    verts.push(`${Math.round(s.v[o + j * 3]! * 1e5)},${Math.round(s.v[o + j * 3 + 1]! * 1e5)},${Math.round(s.v[o + j * 3 + 2]! * 1e5)}`);
  }
  verts.sort();
  const c = t * 3;
  const rgb = `${Math.round(s.rgb[c]! * 1000)},${Math.round(s.rgb[c + 1]! * 1000)},${Math.round(s.rgb[c + 2]! * 1000)}`;
  return `${verts.join(';')}|${s.meshes[s.mesh[t]!]!.slot}|${rgb}`;
}

function fingerprint(id: string): Print {
  const s = soupOf(buildCar(id).root);
  const byZone = new Map<string, string[]>();
  for (let t = 0; t < s.n; t++) {
    const zone = s.meshes[s.mesh[t]!]!.zone.replace(/^kit_/, '');
    (byZone.get(zone) ?? byZone.set(zone, []).get(zone)!).push(triangleKey(s, t));
  }
  const zones: Record<string, string> = {};
  for (const zone of [...byZone.keys()].sort()) {
    const keys = byZone.get(zone)!.sort();
    zones[zone] = Bun.hash(keys.join('\n')).toString(16);
  }
  return { triangles: s.n, zones };
}

let moved = 0;
for (const id of ids) {
  const now = fingerprint(id);
  if (write) {
    recorded[id] = now;
    console.log(`${id.padEnd(10)} recorded  ${now.triangles} triangles`);
    continue;
  }
  const was = recorded[id];
  if (!was) {
    console.log(`${id.padEnd(10)} not frozen (no record; --write ${id} once the owner has seen it)`);
    continue;
  }
  const zones = [...new Set([...Object.keys(was.zones), ...Object.keys(now.zones)])].sort();
  const changed = zones.filter((z) => was.zones[z] !== now.zones[z]);
  if (changed.length === 0) {
    console.log(`${id.padEnd(10)} identical`);
    continue;
  }
  moved++;
  console.log(`${id.padEnd(10)} MOVED in ${changed.join(', ')} (triangles ${was.triangles} → ${now.triangles})`);
}

if (write) {
  const sorted: Record<string, Print> = {};
  for (const id of Object.keys(recorded).sort()) sorted[id] = recorded[id]!;
  writeFileSync(PATH, `${JSON.stringify(sorted, null, 2)}\n`);
} else if (moved > 0) {
  console.log(`\nFAIL: ${moved} frozen car(s) moved. A change meant for one car belongs behind its own spec field;`);
  console.log('if the owner asked for or accepted the change on these cars, record them: --write <id ...>');
  process.exit(1);
}
