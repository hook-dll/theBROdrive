/**
 * tools/sound/build.mjs — turns the CC0 takes in manifest.json into the game's sounds.
 *
 *   node tools/sound/build.mjs [name ...]     (all when none given)
 *
 * For each entry: the Freesound preview (cached), mixed to mono, cut to [start, end],
 * band-limited, then shaped by `kind`:
 *   loop    the cut becomes a seamless loop: its tail is crossfaded (equal power) into
 *           its head, so the wrap has neither a click nor a dip. Levelled to `lufs`
 *           integrated.
 *   once    a one-shot with short fades. Levelled so its loudest 400 ms is `lufs`.
 *   hits    several separate hits (footsteps, caws) found by onset in the cut, each
 *           trimmed to `hitLength`, levelled to the same peak and laid out with
 *           silence between, for SampleBank.hits() to find again. `count` of them.
 * Every file is kept at or under -1 dBFS peak whatever its loudness target, encoded
 * to mono Ogg Opus at `kbps`, and written to public/audio/<name>.ogg. CREDITS.md is
 * regenerated from what was built.
 *
 * Levels here are only the files' own normalisation; how loud each one plays is the
 * voice's gain in src/audio, measured against the mixer's targets.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, fetchPreview, meta, readWav, mono, biquad, loudness, encodeOpus } from './lib.mjs';

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/sound/manifest.json'), 'utf8'));
const only = process.argv.slice(2);
const OUT = path.join(ROOT, 'public/audio');
fs.mkdirSync(OUT, { recursive: true });

const PEAK_CEILING = 10 ** (-1 / 20);

function cut(x, sr, start = 0, end = x.length / sr) {
  return x.slice(Math.floor(start * sr), Math.min(x.length, Math.floor(end * sr)));
}

function fade(x, sr, inS, outS) {
  const a = Math.floor(inS * sr);
  const b = Math.floor(outS * sr);
  for (let i = 0; i < a && i < x.length; i++) x[i] *= Math.sin((0.5 * Math.PI * i) / a);
  for (let i = 0; i < b && i < x.length; i++) x[x.length - 1 - i] *= Math.sin((0.5 * Math.PI * i) / b);
  return x;
}

/** The last `xf` seconds folded into the first: plays seamlessly as a loop. */
function makeLoop(x, sr, xfS) {
  const xf = Math.floor(xfS * sr);
  const n = x.length - xf;
  const out = x.slice(0, n);
  for (let i = 0; i < xf; i++) {
    const t = i / xf;
    out[i] = x[i] * Math.sin(0.5 * Math.PI * t) + x[n + i] * Math.cos(0.5 * Math.PI * t);
  }
  return out;
}

function scale(x, g) {
  for (let i = 0; i < x.length; i++) x[i] *= g;
  return x;
}

function peakOf(x) {
  let p = 0;
  for (const v of x) p = Math.max(p, Math.abs(v));
  return p;
}

/** Onsets by a rising threshold on a 5 ms peak envelope, at least `gapS` apart. */
function onsets(x, sr, gapS) {
  const hop = Math.floor(sr * 0.005);
  const env = [];
  for (let s = 0; s + hop <= x.length; s += hop) {
    let e = 0;
    for (let i = s; i < s + hop; i++) e = Math.max(e, Math.abs(x[i]));
    env.push(e);
  }
  const sorted = [...env].sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * 0.3)];
  const top = sorted[Math.floor(sorted.length * 0.995)];
  const on = floor + (top - floor) * 0.3;
  const found = [];
  let last = -Infinity;
  for (let i = 1; i < env.length; i++) {
    if (env[i] > on && env[i - 1] <= on && (i * hop) / sr - last > gapS) {
      last = (i * hop) / sr;
      found.push({ at: Math.max(0, last - 0.015), level: Math.max(...env.slice(i, i + 20)) });
    }
  }
  return found;
}

const built = [];
for (const entry of manifest) {
  if (only.length && !only.includes(entry.name)) continue;
  const file = await fetchPreview(entry.id);
  const { sr, channels } = readWav(file);
  let x = cut(mono(channels), sr, entry.start, entry.end);
  if (entry.highpass) biquad(x, sr, 'highpass', entry.highpass);
  if (entry.lowpass) biquad(x, sr, 'lowpass', entry.lowpass);

  if (entry.kind === 'loop') {
    x = makeLoop(x, sr, entry.crossfade ?? 1.5);
    const L = loudness(x, sr);
    scale(x, 10 ** ((entry.lufs - L.integrated) / 20));
  } else if (entry.kind === 'once') {
    fade(x, sr, entry.fadeIn ?? 0.003, entry.fadeOut ?? 0.3);
    const L = loudness(x, sr);
    scale(x, 10 ** ((entry.lufs - L.momentaryMax) / 20));
  } else if (entry.kind === 'hits') {
    const found = onsets(x, sr, entry.minGap ?? 0.3)
      .sort((a, b) => b.level - a.level)
      .slice(0, entry.count ?? 6)
      .sort((a, b) => a.at - b.at);
    const len = Math.floor((entry.hitLength ?? 0.35) * sr);
    const gap = Math.floor(0.25 * sr);
    const out = new Float32Array(found.length * (len + gap));
    found.forEach((h, k) => {
      const hit = fade(x.slice(Math.floor(h.at * sr), Math.floor(h.at * sr) + len), sr, 0.002, (entry.hitLength ?? 0.35) * 0.4);
      scale(hit, 0.7 / (peakOf(hit) || 1));
      out.set(hit, k * (len + gap));
    });
    x = out;
    const L = loudness(x, sr);
    scale(x, 10 ** ((entry.lufs - L.momentaryMax) / 20));
    console.log(`  ${entry.name}: ${found.length} hits at ${found.map((h) => h.at.toFixed(2)).join(' ')}`);
  }
  const p = peakOf(x);
  if (p > PEAK_CEILING) scale(x, PEAK_CEILING / p);
  const target = path.join(OUT, `${entry.name}.ogg`);
  encodeOpus(target, sr, [x], entry.kbps ?? 40);
  const L = loudness(x, sr);
  const kb = fs.statSync(target).size / 1024;
  console.log(
    `${entry.name.padEnd(16)} ${(x.length / sr).toFixed(1).padStart(5)} s  ${L.integrated.toFixed(1)} LUFS int, ${L.momentaryMax.toFixed(1)} max, pk ${L.peak.toFixed(1)}  ${kb.toFixed(0)} KB`,
  );
  built.push(entry.name);
}

// Credits for everything in the manifest, built this run or before.
const lines = [
  '# Sound credits',
  '',
  'Every recording here is CC0 (public domain dedication) from Freesound, cut, filtered,',
  'levelled and re-encoded by `tools/sound/build.mjs` from `tools/sound/manifest.json`.',
  'CC0 asks for nothing; the authors are credited because the game sounds as it does',
  'thanks to them.',
  '',
  '| File | Recording | Author |',
  '| --- | --- | --- |',
];
for (const entry of manifest) {
  let m;
  try {
    m = meta(entry.id);
  } catch {
    continue;
  }
  if (m.licence !== 'CC0') console.warn(`!! ${entry.name}: licence ${m.licence} — check ${m.url}`);
  lines.push(`| ${entry.name}.ogg | [${m.title.replace(/\|/g, '/')}](${m.url}) | ${m.user} |`);
}
fs.writeFileSync(path.join(OUT, 'CREDITS.md'), lines.join('\n') + '\n');
let total = 0;
for (const f of fs.readdirSync(OUT)) if (f.endsWith('.ogg')) total += fs.statSync(path.join(OUT, f)).size;
console.log(`\n${built.length} built; public/audio holds ${(total / 1024).toFixed(0)} KB of sound.`);
