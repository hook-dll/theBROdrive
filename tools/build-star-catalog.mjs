import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const destination = process.argv[2] ?? 'public/data/tycho2-mag8.bin';
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
    path: 'tycho2-mag8-source.tsv',
    sha256: '6b17e54cb1ab57a5a8fd7059c293227d8c5b445a163b654f2fa35580f755b038',
    url: queryUrl('SELECT RAmdeg,DEmdeg,pmRA,pmDE,BTmag,VTmag FROM \"I/259/tyc2\" WHERE VTmag < 8.8'),
  },
  {
    path: 'tycho2-mag8-supplement.tsv',
    sha256: '6ecb32a8fd4890ad1282a633366858744328d9323202b8d6aae0bb55f1bdf34f',
    url: queryUrl('SELECT \"RA(ICRS)\",\"DE(ICRS)\",pmRA,pmDE,BTmag,VTmag FROM \"I/259/suppl_1\" WHERE VTmag < 8.8'),
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
    const color = hasColor ? btRaw - vtRaw : 0;
    const magnitude = hasColor ? vtRaw - 0.09 * color : vtRaw;
    if (magnitude > 8) continue;
    const bv = hasColor ? Math.max(-0.4, Math.min(2.0, 0.85 * color)) : 0;
    stars.push([raDeg * Math.PI / 180, decDeg * Math.PI / 180, pmRa, pmDec, magnitude, bv]);
    histogram[Math.max(0, Math.min(9, Math.floor(magnitude + 2)))]++;
  }
}
stars.sort((a, b) => a[4] - b[4] || a[0] - b[0] || a[1] - b[1]);
if (stars.length !== 45_620) throw new Error(`Unexpected magnitude-8 star count: ${stars.length}`);
if (stars[0][4] > -1 || stars.at(-1)[4] !== 8) {
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
  brightestMagnitude: stars[0]?.[4],
  faintestMagnitude: stars.at(-1)?.[4],
  histogram: [...histogram],
}, null, 2));
