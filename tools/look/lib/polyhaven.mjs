// Poly Haven source access. Everything on Poly Haven is CC0 1.0. Files come from
// api.polyhaven.com/files/<id>; each asset lists its files under
// <format>.<resolution>.<kind> with an `include` map of every referenced texture,
// so we can pull a .gltf plus exactly the maps it needs, once, into the cache.

import path from 'node:path';
import { mkdir, readFile } from 'node:fs/promises';
import { CACHE, fetchTo } from './util.mjs';

const API = 'https://api.polyhaven.com';

export async function list(type) {
  const res = await fetch(`${API}/assets?t=${type}`);
  if (!res.ok) throw new Error(`polyhaven list ${res.status}`);
  return res.json();
}

export async function meta(id) {
  const res = await fetch(`${API}/info/${id}`);
  if (!res.ok) throw new Error(`polyhaven info ${id}: ${res.status}`);
  return res.json();
}

export async function files(id) {
  const res = await fetch(`${API}/files/${id}`);
  if (!res.ok) throw new Error(`polyhaven files ${id}: ${res.status}`);
  return res.json();
}

/**
 * Download a Poly Haven asset bundle into .cache/ph/<id>/.
 * kind: 'gltf' | 'blend' | 'fbx'   res: '1k' | '2k' | '4k'
 * Returns { dir, main, page, includes } — paths are relative to `dir`, which
 * mirrors the bundle layout so a .gltf's own relative texture paths resolve.
 */
export async function asset(id, { kind = 'gltf', res = '1k' } = {}) {
  const all = await files(id);
  const bundle = all[kind]?.[res]?.[kind] ?? all[kind]?.[res];
  if (!bundle?.url) throw new Error(`polyhaven ${id}: no ${kind}.${res}`);
  const rel = path.join('ph-files', id);
  const dir = path.join(CACHE, rel);
  await mkdir(dir, { recursive: true });
  const local = (url, name) => fetchTo(url, path.join(rel, name), { quiet: true });
  const main = await local(bundle.url, path.basename(bundle.url));
  if (Object.keys(bundle.include ?? {}).length) {
    for (const [name, f] of Object.entries(bundle.include ?? {})) await local(f.url, name);
  } else {
    // Some assets come back with an empty include list. The .gltf itself names
    // every buffer and image it needs, so resolve them against the published
    // layout: buffers sit beside the .gltf, textures under the same asset folder
    // in a per-format directory (Models/jpg/1k/<id>/... for a .jpg and so on).
    const gltf = JSON.parse(await readFile(main, 'utf8'));
    const base = bundle.url.replace(/[^/]+$/, '');
    for (const buf of gltf.buffers ?? []) if (buf.uri) await local(base + buf.uri, buf.uri);
    for (const img of gltf.images ?? []) {
      if (!img.uri) continue;
      const ext = img.uri.split('.').pop().toLowerCase();
      const dir = ext === 'exr' ? 'exr' : ext === 'png' ? 'png' : 'jpg';
      await local(base.replace('/gltf/', `/${dir}/`) + img.uri, img.uri);
    }
  }
  return { dir, main, page: `https://polyhaven.com/a/${id}`, includes: bundle.include ?? {} };
}

/**
 * Download one published texture of an asset to a predictable path.
 * id: asset, key: 'Diffuse' | 'Alpha' | 'dry_diff' | 'nor_gl', ext preference
 * given by `prefer` (e.g. ['png', 'jpg']). Returns the local path or null.
 */
export async function extraTexture(id, key, { res = '1k', prefer = ['png', 'jpg', 'exr'] } = {}) {
  const all = await files(id);
  const entry = all[key]?.[res];
  if (!entry) return null;
  for (const e of prefer) {
    const f = entry[e];
    if (!f?.url) continue;
    const name = path.join('ph-files', id, `${key}.${e}`);
    return fetchTo(f.url, name, { quiet: true });
  }
  return null;
}

/** Thumbnail URL for source picking contact sheets. */
export async function thumbnails(ids) {
  const t = await list('textures');
  const m = await list('models');
  return ids.map((id) => {
    const a = m[id] ?? t[id] ?? {};
    return { id, name: a.name, cats: a.categories ?? [], thumb: a.thumbnail_url };
  });
}

export { CACHE };
