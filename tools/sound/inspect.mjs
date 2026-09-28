/**
 * tools/sound/inspect.mjs — what is in a Freesound candidate, without ears.
 *
 *   node tools/sound/inspect.mjs <id> [<id> ...]
 *
 * Downloads (cached) and prints: title, user, licence, description, duration,
 * loudness, and a timeline — level in dB per half second with the share of energy
 * below 250 Hz / 250–2k / above 2k, so a clap, a rumble, a rain bed or a voice in the
 * background can be told apart.
 */
import { fetchPreview, meta, readWav, mono, loudness, biquad } from './lib.mjs';

const brief = process.argv.includes('--brief');
const hopArg = process.argv.find((a) => a.startsWith('--hop='));
const HOP_S = hopArg ? +hopArg.slice(6) : 0.5;
const ids = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const bar = (db) => '█'.repeat(Math.max(0, Math.round((db + 60) / 3)));
for (const id of ids) {
  const file = await fetchPreview(id);
  const m = meta(id);
  const { sr, channels } = readWav(file);
  const x = mono(channels);
  const L = loudness(x, sr);
  console.log(`\n=== ${id} ${m.licence} "${m.title}" by ${m.user} — ${(x.length / sr).toFixed(1)} s, ${channels.length} ch, ${sr} Hz`);
  console.log(`    ${m.description.slice(0, 300)}`);
  console.log(`    integrated ${L.integrated.toFixed(1)} LUFS, momentary max ${L.momentaryMax.toFixed(1)}, peak ${L.peak.toFixed(1)} dBFS`);
  const low = biquad(x.slice(), sr, 'lowpass', 250);
  const high = biquad(x.slice(), sr, 'highpass', 2000);
  const hop = Math.floor(sr * HOP_S);
  if (brief) {
    const lv = [];
    let el = 0, eh = 0, e = 0;
    for (let s = 0; s + hop <= x.length; s += hop) {
      let h = 0;
      for (let i = s; i < s + hop; i++) { h += x[i] ** 2; el += low[i] ** 2; eh += high[i] ** 2; }
      e += h;
      lv.push(10 * Math.log10(h / hop + 1e-20));
    }
    if (!lv.length) lv.push(-120);
    lv.sort((a, b) => a - b);
    const q = (p) => lv[Math.floor(p * (lv.length - 1))].toFixed(0);
    console.log(`    level p10 ${q(0.1)} p50 ${q(0.5)} p90 ${q(0.9)} max ${q(1)} dB · lo ${Math.round((100 * el) / e)}% hi ${Math.round((100 * eh) / e)}%`);
    continue;
  }
  const step = Math.max(1, Math.ceil(x.length / hop / 90));
  for (let s = 0, n = 0; s + hop <= x.length; s += hop, n++) {
    if (n % step) continue;
    let e = 0, el = 0, eh = 0;
    for (let i = s; i < s + hop; i++) { e += x[i] ** 2; el += low[i] ** 2; eh += high[i] ** 2; }
    const db = 10 * Math.log10(e / hop + 1e-20);
    const pl = Math.round((100 * el) / (e + 1e-20));
    const ph = Math.round((100 * eh) / (e + 1e-20));
    console.log(`    ${(s / sr).toFixed(1).padStart(6)}s ${db.toFixed(0).padStart(4)} dB  lo${String(pl).padStart(3)}% hi${String(ph).padStart(3)}%  ${bar(db)}`);
  }
}
