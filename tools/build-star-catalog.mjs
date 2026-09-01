import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const destination = process.argv[2] ?? 'public/data/tycho2.bin';

/**
 * The VTmag both ADQL queries below select on. Everything the completeness limit
 * is argued from starts here.
 */
const QUERY_VT_LIMIT = 8.8;
/**
 * Tycho VT is turned into a Johnson-ish V by subtracting 0.09 of the star's
 * colour, so a red star's stored magnitude is BRIGHTER than the VT the query
 * filtered on. Selecting on VT therefore cuts a colour-biased edge into the
 * sample: right at the limit, blue stars survive and red ones of the same true
 * magnitude are already gone.
 *
 * The correction is bounded because the colour is clamped (same clamp as the one
 * that drives the rendered star colour below — junk photometry at the faint end
 * of Tycho-2 reaches BT-VT of -8.8 and +6.6, which is neither a real star colour
 * nor a real magnitude shift). Subtracting that bound from the query's limit is
 * the faintest magnitude this data can honestly claim to be complete to.
 */
const COLOR_CLAMP = [-0.4, 2.0];
const MAX_COLOR_CORRECTION = 0.09 * (COLOR_CLAMP[1] / 0.85);
/**
 * Where the catalogue is cut. The renderer draws a PREFIX of this file (it is
 * sorted by magnitude), so this is the deep end — the tier that draws all of it —
 * and STANDARD_MAGNITUDE_LIMIT below is what every other tier stops at.
 */
const MAGNITUDE_LIMIT = 8.5;
/** The cut the game shipped before the faint half was unlocked for `blessing`. */
const STANDARD_MAGNITUDE_LIMIT = 8;
if (MAGNITUDE_LIMIT > QUERY_VT_LIMIT - MAX_COLOR_CORRECTION) {
  throw new Error(
    `A cut at ${MAGNITUDE_LIMIT} is past this query's completeness limit ` +
      `(${(QUERY_VT_LIMIT - MAX_COLOR_CORRECTION).toFixed(3)}); widen the query first`,
  );
}
const queryUrl = (query) => {
  const url = new URL('https://tapvizier.cds.unistra.fr/TAPVizieR/tap/sync');
  url.search = new URLSearchParams({
    request: 'doQuery',
    lang: 'ADQL',
    format: 'tsv',
    maxrec: '200000',
    query,
  });
  return url;
};
const sourceDefinitions = [
  {
    path: 'tycho2-vt88-source.tsv',
    sha256: '6b17e54cb1ab57a5a8fd7059c293227d8c5b445a163b654f2fa35580f755b038',
    url: queryUrl(
      'SELECT RAmdeg,DEmdeg,pmRA,pmDE,BTmag,VTmag FROM "I/259/tyc2" ' +
        `WHERE VTmag < ${QUERY_VT_LIMIT}`,
    ),
  },
  {
    path: 'tycho2-vt88-supplement.tsv',
    sha256: '6ecb32a8fd4890ad1282a633366858744328d9323202b8d6aae0bb55f1bdf34f',
    url: queryUrl(
      'SELECT "RA(ICRS)","DE(ICRS)",pmRA,pmDE,BTmag,VTmag FROM "I/259/suppl_1" ' +
        `WHERE VTmag < ${QUERY_VT_LIMIT}`,
    ),
  },
];
const sources = sourceDefinitions.map(({ path }) => path);
const sourceTexts = await Promise.all(sourceDefinitions.map(async ({ path, url, sha256 }) => {
  let text;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Catalogue download failed: HTTP ${response.status}`);
    text = await response.text();
    await writeFile(path, text);
  }
  const actual = createHash('sha256').update(text).digest('hex');
  if (actual !== sha256) throw new Error(`${path} checksum changed: ${actual}`);
  return text;
}));

const stars = [];
const histogram = new Uint32Array(10);
for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex++) {
  const source = sources[sourceIndex];
  const text = sourceTexts[sourceIndex];
  const lines = text.trimEnd().split(/\r?\n/);
  if (!lines[0].endsWith('\tpmRA\tpmDE\tBTmag\tVTmag')) {
    throw new Error(`Unexpected Tycho-2 header in ${source}: ${lines[0]}`);
  }
  for (let line = 1; line < lines.length; line++) {
    const fields = lines[line].split('\t');
    if (fields.length !== 6) throw new Error(`Malformed ${source} row ${line + 1}`);
    const [raDeg, decDeg, pmRaRaw, pmDecRaw, btRaw, vtRaw] = fields.map(Number);
    if (![raDeg, decDeg, vtRaw].every(Number.isFinite)) continue;
    const pmRa = Number.isFinite(pmRaRaw) ? pmRaRaw : 0;
    const pmDec = Number.isFinite(pmDecRaw) ? pmDecRaw : 0;
    const hasColor = Number.isFinite(btRaw);
    // One clamped colour drives BOTH the magnitude correction and the rendered
    // star colour, so the worst-case correction is a constant the completeness
    // check above can be written against.
    const bv = hasColor
      ? Math.max(COLOR_CLAMP[0], Math.min(COLOR_CLAMP[1], 0.85 * (btRaw - vtRaw)))
      : 0;
    const magnitude = vtRaw - 0.09 * (bv / 0.85);
    if (magnitude > MAGNITUDE_LIMIT) continue;
    stars.push([raDeg * Math.PI / 180, decDeg * Math.PI / 180, pmRa, pmDec, magnitude, bv]);
    histogram[Math.max(0, Math.min(9, Math.floor(magnitude + 2)))]++;
  }
}
// Magnitude order is not cosmetic: the renderer draws a PREFIX of this file, and
// that is the whole mechanism by which a tier picks its depth. A file sorted any
// other way would give `acceptable` a random half of the sky.
stars.sort((a, b) => a[4] - b[4] || a[0] - b[0] || a[1] - b[1]);
const standardCount = stars.filter((star) => star[4] <= STANDARD_MAGNITUDE_LIMIT).length;
if (stars[standardCount - 1][4] > STANDARD_MAGNITUDE_LIMIT
  || stars[standardCount][4] <= STANDARD_MAGNITUDE_LIMIT) {
  throw new Error('The standard-tier cut is not a prefix of the sorted catalogue');
}
if (stars[0][4] > -1 || stars.at(-1)[4] > MAGNITUDE_LIMIT) {
  throw new Error('Catalogue magnitude bounds are not credible');
}
const recordBytes = 6 * 4;
const output = Buffer.allocUnsafe(8 + stars.length * recordBytes);
output.write('TBR1', 0, 4, 'ascii');
output.writeUInt32LE(stars.length, 4);
let offset = 8;
for (const star of stars) {
  for (const value of star) {
    output.writeFloatLE(value, offset);
    offset += 4;
  }
}
await writeFile(destination, output);
console.log(JSON.stringify({
  destination,
  outputSha256: createHash('sha256').update(output).digest('hex'),
  sources: sources.map((source, i) => ({
    path: source,
    sha256: createHash('sha256').update(sourceTexts[i]).digest('hex'),
  })),
  count: stars.length,
  standardCount,
  completeTo: Number((QUERY_VT_LIMIT - MAX_COLOR_CORRECTION).toFixed(3)),
  brightestMagnitude: stars[0]?.[4],
  faintestMagnitude: stars.at(-1)?.[4],
  histogram: [...histogram],
}, null, 2));
