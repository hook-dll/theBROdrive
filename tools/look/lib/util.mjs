// Shared plumbing for the look-asset builders: paths, cached downloads, CLI flags.
//
// The cache under tools/look/.cache is gitignored and holds every source download
// plus the raw Blender renders, so a rebuild after `git clone` re-downloads and
// regenerates everything through one command (see tools/look/README.md).

import { mkdir, writeFile, rename, stat, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const LOOK = path.join(ROOT, 'tools', 'look');
export const CACHE = path.join(LOOK, '.cache');
export const OUTDIR = path.join(ROOT, 'public', 'look');

/** CLI flags, e.g. `node tools/look/build.mjs --only ground --force`. */
export const flags = new Set(process.argv.slice(2).filter((a) => a.startsWith('--')));
export const hasFlag = (name) => flags.has('--' + name);

export async function ensureDirs() {
  await mkdir(CACHE, { recursive: true });
  await mkdir(OUTDIR, { recursive: true });
}

/** True when the file exists and is non-empty. */
export async function exists(file) {
  try {
    const s = await stat(file);
    return s.size > 0;
  } catch {
    return false;
  }
}

const KIB = (n) => (n / 1024).toFixed(0) + ' KiB';

/** Download `url` into the cache under `name`, once. Returns the cached path. */
export async function fetchTo(url, name, { quiet = false } = {}) {
  await mkdir(CACHE, { recursive: true });
  const dest = path.join(CACHE, name);
  if (await exists(dest)) return dest;
  await mkdir(path.dirname(dest), { recursive: true });
  // Unique temp name: two agents may rebuild the same group at once, and a shared
  // .part would interleave their bytes. Rename is atomic, so the loser just
  // overwrites the winner with identical content.
  const part = `${dest}.${process.pid}.part`;
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { redirect: 'follow' });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 64) throw new Error(`suspiciously small (${buf.length} B)`);
      await writeFile(part, buf);
      await rename(part, dest);
      if (!quiet) console.log(`  downloaded ${name} (${KIB(buf.length)})`);
      return dest;
    } catch (err) {
      lastErr = err;
      await rm(part, { force: true });
    }
  }
  throw new Error(`download failed: ${url}: ${lastErr.message}`);
}

/** Unpack a zip into the cache next to it (once) and return the directory. */
export async function unzipInto(zip, dirName) {
  const dir = path.join(CACHE, dirName);
  if (await exists(dir)) return dir;
  await mkdir(dir, { recursive: true });
  await run('unzip', ['-o', '-q', zip, '-d', dir]);
  return dir;
}

/**
 * Download + unpack one source manifest entry.
 * Entry: { id, url, cache, unpack? } — `cache` is the file name inside .cache,
 * `unpack` is the directory name to expand it into.
 * Returns { dir, file } — `dir` for archives, `file` for plain downloads.
 */
export async function obtain(entry) {
  const file = await fetchTo(entry.url, entry.cache, { quiet: entry.quiet });
  if (!entry.unpack) return { file, dir: path.dirname(file) };
  const dir = await unzipInto(file, entry.unpack);
  return { file, dir };
}

/** First existing path among candidates, for tolerating archive layout drift. */
export async function firstExisting(paths) {
  for (const p of paths) if (await exists(p)) return p;
  throw new Error(`none of these exist:\n  ${paths.join('\n  ')}`);
}

/** Recursively list files under dir whose name matches `re`. */
export async function listFiles(dir, re) {
  const { readdir } = await import('node:fs/promises');
  const out = [];
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...(await listFiles(p, re)));
    else if (!re || re.test(ent.name)) out.push(p);
  }
  return out;
}

export const human = KIB;
export { existsSync };
