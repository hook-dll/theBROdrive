// ambientCG source access. Everything ambientCG publishes is CC0 1.0; the API
// reports it per asset under `license`. Downloads are zips of 1K JPG maps, cached
// in tools/look/.cache so a rebuild after a fresh clone re-fetches them once.

import path from 'node:path';
import { CACHE, obtain, firstExisting, listFiles } from './util.mjs';

const API = 'https://ambientcg.com/api/v2/full_json';

/** Search the catalogue: returns [{ id, displayName, license, maps, tags }]. */
export async function search(query, { limit = 30, type = 'Material' } = {}) {
  const url = `${API}?q=${encodeURIComponent(query)}&type=${type}&limit=${limit}&include=displayData`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ambientCG search ${res.status}`);
  const json = await res.json();
  return (json.foundAssets ?? []).map((a) => ({
    id: a.assetId,
    displayName: a.displayName,
    license: a.license ?? 'CC0',
    maps: a.maps ?? [],
    tags: a.tags ?? [],
    preview: (a.previewImage ?? {})['512-PNG'],
    url: a.shortLink
  }));
}

/**
 * Download + unpack an asset's 1K JPG archive.
 * Returns { dir, maps } where maps maps a suffix ('Color', 'Displacement', …)
 * to a file path, plus `page` (the asset page) for the licence record.
 */
export async function asset(id, { res = '1K', quiet = false } = {}) {
  const zip = `${id}_${res}-JPG.zip`;
  await obtain({
    url: `https://ambientcg.com/get?file=${zip}`,
    cache: zip,
    unpack: `acg-${id}`,
    quiet
  });
  const dir = path.join(CACHE, `acg-${id}`);
  const files = await listFiles(dir, /\.(jpe?g|png)$/i);
  const maps = {};
  for (const f of files) {
    const m = path.basename(f).match(/_(\d+K-JPG_)?([A-Za-z]+GH)?[A-Za-z]*_?([A-Za-z]+)\.(jpe?g|png)$/i);
    const key = path.basename(f).replace(/^[^_]+_/, '').replace(/^\d+K-JPG_/, '').replace(/\.(jpe?g|png)$/i, '');
    maps[key] = f;
    if (m) maps[m[3]] = maps[m[3]] ?? f;
  }
  return { dir, maps, page: `https://ambientcg.com/a/${id}` };
}

/** Convenience: one map by suffix, with a clear error listing what was there. */
export function map(assetInfo, ...suffixes) {
  for (const s of suffixes) if (assetInfo.maps[s]) return assetInfo.maps[s];
  throw new Error(`no map ${suffixes.join('/')} in ${assetInfo.page}: got ${Object.keys(assetInfo.maps).join(', ')}`);
}

export { firstExisting };
