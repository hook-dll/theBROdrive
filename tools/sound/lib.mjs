/**
 * tools/sound/lib.mjs — the small audio toolkit behind the sound pipeline.
 *
 * Decoding and encoding go through macOS `afconvert` (it reads Vorbis/MP3 and writes
 * Ogg/Opus), everything in between is plain Float32Arrays: read a WAV, cut, fade,
 * filter, measure loudness, write a WAV.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
export const CACHE = path.join(ROOT, 'tools/sound/.cache');
fs.mkdirSync(CACHE, { recursive: true });

/** Freesound preview of a sound: cached Vorbis, decoded to a float WAV. Returns its path. */
export async function fetchPreview(id) {
  const wav = path.join(CACHE, `${id}.wav`);
  if (fs.existsSync(wav)) return wav;
  // curl for the page too: node's fetch intermittently cannot connect to freesound.org
  // at all (connect timeout) where curl answers in under a second.
  const out = execFileSync('curl', ['-sL', '--retry', '4', '--retry-all-errors', '--max-time', '60', '-w', '\n%{url_effective}', `https://freesound.org/s/${id}/`]).toString();
  const cut = out.lastIndexOf('\n');
  const page = out.slice(0, cut);
  const res = { url: out.slice(cut + 1) };
  const ogg = page.match(/data-ogg="([^"]+)"/)?.[1]?.replace('-lq.ogg', '-hq.ogg');
  if (!ogg) throw new Error(`no preview for ${id}`);
  const meta = {
    id,
    user: decodeURIComponent(res.url.match(/\/people\/([^/]+)\//)?.[1] ?? ''),
    title: page.match(/data-title="([^"]+)"/)?.[1] ?? '',
    url: `https://freesound.org/s/${id}/`,
    licence: /creativecommons\.org\/publicdomain\/zero/.test(page) ? 'CC0' : 'CHECK',
    description: (page.match(/<div id="soundDescriptionSection"[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? '')
      .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 600),
  };
  fs.writeFileSync(path.join(CACHE, `${id}.json`), JSON.stringify(meta, null, 1));
  // curl, not fetch: the CDN stalls now and then, and a stalled HTTP/2 stream kills
  // node's fetch outright after five minutes instead of retrying.
  const src = path.join(CACHE, `${id}.ogg`);
  execFileSync('curl', ['-sL', '--retry', '4', '--retry-all-errors', '--max-time', '240', '-o', src, ogg]);
  execFileSync('afconvert', ['-f', 'WAVE', '-d', 'LEF32', src, wav]);
  return wav;
}

export function meta(id) {
  return JSON.parse(fs.readFileSync(path.join(CACHE, `${id}.json`), 'utf8'));
}

/** Reads a float32 or int16 WAV. Returns { sr, channels: Float32Array[] }. */
export function readWav(file) {
  const b = fs.readFileSync(file);
  let off = 12;
  let fmt = null;
  let data = null;
  while (off + 8 <= b.length) {
    const id = b.toString('ascii', off, off + 4);
    const size = b.readUInt32LE(off + 4);
    if (id === 'fmt ') {
      fmt = { format: b.readUInt16LE(off + 8), ch: b.readUInt16LE(off + 10), sr: b.readUInt32LE(off + 12), bits: b.readUInt16LE(off + 22) };
    } else if (id === 'data') {
      data = b.subarray(off + 8, off + 8 + size);
    }
    off += 8 + size + (size & 1);
  }
  if (!fmt || !data) throw new Error(`bad wav ${file}`);
  const bytes = fmt.bits / 8;
  const frames = Math.floor(data.length / (bytes * fmt.ch));
  const channels = Array.from({ length: fmt.ch }, () => new Float32Array(frames));
  const aligned = new Uint8Array(data).buffer;
  const view = fmt.bits === 32 ? new Float32Array(aligned, 0, frames * fmt.ch) : new Int16Array(aligned, 0, frames * fmt.ch);
  const scale = fmt.bits === 32 ? 1 : 1 / 32768;
  for (let c = 0; c < fmt.ch; c++) {
    const out = channels[c];
    for (let i = 0, j = c; i < frames; i++, j += fmt.ch) out[i] = view[j] * scale;
  }
  return { sr: fmt.sr, channels };
}

export function writeWav(file, sr, channels) {
  const frames = channels[0].length;
  const ch = channels.length;
  const b = Buffer.alloc(44 + frames * ch * 4);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + frames * ch * 4, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(3, 20);
  b.writeUInt16LE(ch, 22);
  b.writeUInt32LE(sr, 24);
  b.writeUInt32LE(sr * ch * 4, 28);
  b.writeUInt16LE(ch * 4, 32);
  b.writeUInt16LE(32, 34);
  b.write('data', 36);
  b.writeUInt32LE(frames * ch * 4, 40);
  const f = new Float32Array(b.buffer, b.byteOffset + 44, frames * ch);
  for (let c = 0; c < ch; c++) for (let i = 0, j = c; i < frames; i++, j += ch) f[j] = channels[c][i];
  fs.writeFileSync(file, b);
}

export function mono(channels) {
  if (channels.length === 1) return channels[0].slice();
  const out = new Float32Array(channels[0].length);
  for (const c of channels) for (let i = 0; i < out.length; i++) out[i] += c[i] / channels.length;
  return out;
}

/** RBJ biquad over a buffer, in place. type: 'lowpass' | 'highpass'. */
export function biquad(x, sr, type, freq, q = 0.707) {
  const w = (2 * Math.PI * freq) / sr;
  const alpha = Math.sin(w) / (2 * q);
  const cos = Math.cos(w);
  let b0, b1, b2;
  if (type === 'lowpass') { b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = b0; }
  else { b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = b0; }
  const a0 = 1 + alpha;
  const a1 = -2 * cos;
  const a2 = 1 - alpha;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const y = (b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = y;
    x[i] = y;
  }
  return x;
}

/** ITU-R BS.1770 K-weighting (48 kHz-derived, fine at 44.1) — returns a filtered copy. */
function kWeight(x, sr) {
  const y = x.slice();
  // Stage 1: high shelf +4 dB at ~1.5 kHz.
  const f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196;
  const K = Math.tan((Math.PI * f0) / sr);
  const Vh = 10 ** (G / 20), Vb = Vh ** 0.4996667741545416;
  const a0 = 1 + K / Q + K * K;
  const s = [(Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0];
  // Stage 2: high-pass at ~38 Hz.
  const f1 = 38.13547087602444, Q1 = 0.5003270373238773;
  const K1 = Math.tan((Math.PI * f1) / sr);
  const d = 1 + K1 / Q1 + K1 * K1;
  const h = [1, -2, 1, (2 * (K1 * K1 - 1)) / d, (1 - K1 / Q1 + K1 * K1) / d];
  for (const [b0, b1, b2, a1, a2] of [s, h]) {
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < y.length; i++) {
      const v = b0 * y[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = y[i]; y2 = y1; y1 = v;
      y[i] = v;
    }
  }
  return y;
}

/**
 * Loudness, LUFS-ish (mono, ungated unless `gate`): integrated over the whole buffer,
 * plus the loudest 400 ms momentary value. `peak` is sample peak, dBFS.
 */
export function loudness(x, sr) {
  const k = kWeight(x, sr);
  const block = Math.floor(sr * 0.4);
  const hop = Math.floor(sr * 0.1);
  const blocks = [];
  for (let s = 0; s + block <= k.length; s += hop) {
    let e = 0;
    for (let i = s; i < s + block; i++) e += k[i] * k[i];
    blocks.push(e / block);
  }
  if (!blocks.length) {
    let e = 0;
    for (const v of k) e += v * v;
    blocks.push(e / Math.max(1, k.length));
  }
  const lufs = (ms) => -0.691 + 10 * Math.log10(ms + 1e-20);
  // BS.1770 gating: absolute -70, then relative -10.
  let gated = blocks.filter((b) => lufs(b) > -70);
  const mean = (a) => a.reduce((p, v) => p + v, 0) / Math.max(1, a.length);
  const rel = lufs(mean(gated)) - 10;
  gated = gated.filter((b) => lufs(b) > rel);
  let peak = 0;
  for (const v of x) peak = Math.max(peak, Math.abs(v));
  return { integrated: lufs(mean(gated)), momentaryMax: lufs(Math.max(...blocks)), peak: 20 * Math.log10(peak + 1e-12) };
}

/** Envelope in dB, one value per `hopS` seconds (RMS over the hop). */
export function envelope(x, sr, hopS = 0.1) {
  const hop = Math.floor(sr * hopS);
  const out = [];
  for (let s = 0; s + hop <= x.length; s += hop) {
    let e = 0;
    for (let i = s; i < s + hop; i++) e += x[i] * x[i];
    out.push(10 * Math.log10(e / hop + 1e-20));
  }
  return out;
}

/**
 * Encodes a mono/stereo float buffer to Ogg Opus at `kbps`.
 *
 * macOS's encoder writes Opus only into CAF (its Ogg writer fails with 'pck?'), so the
 * packets are lifted out of the CAF and wrapped in Ogg pages here (RFC 7845): an
 * OpusHead carrying the encoder's priming as pre-skip, an empty OpusTags, then the
 * audio, with the last page's granule trimmed to the true length. Browsers honour both,
 * which is what keeps a loop gapless.
 */
export function encodeOpus(file, sr, channels, kbps) {
  const tmp = path.join(CACHE, `enc-${process.pid}.wav`);
  const caf = path.join(CACHE, `enc-${process.pid}.caf`);
  writeWav(tmp, sr, channels);
  execFileSync('afconvert', ['-f', 'caff', '-d', 'opus@48000', '-b', String(kbps * 1000), tmp, caf]);
  const packets = readCafPackets(fs.readFileSync(caf));
  fs.unlinkSync(tmp);
  fs.unlinkSync(caf);
  fs.writeFileSync(file, oggOpus(packets, channels.length, sr));
}

function readCafPackets(b) {
  let off = 8;
  let desc = null;
  let pakt = null;
  let data = null;
  while (off + 12 <= b.length) {
    const type = b.toString('ascii', off, off + 4);
    const size = Number(b.readBigInt64BE(off + 4));
    const body = b.subarray(off + 12, off + 12 + size);
    if (type === 'desc') desc = { framesPerPacket: body.readUInt32BE(20), channels: body.readUInt32BE(24) };
    else if (type === 'pakt') pakt = body;
    else if (type === 'data') data = body.subarray(4);
    off += 12 + size;
  }
  if (!desc || !pakt || !data) throw new Error('unexpected CAF from afconvert');
  const count = Number(pakt.readBigInt64BE(0));
  const validFrames = Number(pakt.readBigInt64BE(8));
  const priming = pakt.readInt32BE(16);
  let p = 24;
  const sizes = [];
  for (let i = 0; i < count; i++) {
    let v = 0;
    let byte;
    do {
      byte = pakt[p++];
      v = (v << 7) | (byte & 0x7f);
    } while (byte & 0x80);
    // Constant-frame Opus: only byte sizes are listed.
    sizes.push(v);
  }
  const list = [];
  let q = 0;
  for (const size of sizes) {
    list.push(data.subarray(q, q + size));
    q += size;
  }
  return { list, framesPerPacket: desc.framesPerPacket, validFrames, priming };
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let r = i << 24;
    for (let k = 0; k < 8; k++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1;
    t[i] = r >>> 0;
  }
  return t;
})();

function oggCrc(buf) {
  let crc = 0;
  for (const byte of buf) crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) ^ byte) & 0xff]) >>> 0;
  return crc >>> 0;
}

function oggPage(packets, granule, serial, seq, flags) {
  const lacing = [];
  for (const packet of packets) {
    let n = packet.length;
    while (n >= 255) {
      lacing.push(255);
      n -= 255;
    }
    lacing.push(n);
  }
  const header = Buffer.alloc(27 + lacing.length);
  header.write('OggS', 0);
  header[4] = 0;
  header[5] = flags;
  header.writeBigInt64LE(BigInt(granule), 6);
  header.writeUInt32LE(serial, 14);
  header.writeUInt32LE(seq, 18);
  header[26] = lacing.length;
  Buffer.from(lacing).copy(header, 27);
  const page = Buffer.concat([header, ...packets]);
  page.writeUInt32LE(oggCrc(page), 22);
  return page;
}

function oggOpus({ list, framesPerPacket, validFrames, priming }, channelCount, inputRate) {
  const serial = 0x6272_6f21;
  const head = Buffer.alloc(19);
  head.write('OpusHead', 0);
  head[8] = 1;
  head[9] = channelCount;
  head.writeUInt16LE(priming, 10);
  head.writeUInt32LE(inputRate, 12);
  head.writeInt16LE(0, 16);
  head[18] = 0;
  const vendor = Buffer.from('theBROdrive');
  const tags = Buffer.alloc(8 + 4 + vendor.length + 4);
  tags.write('OpusTags', 0);
  tags.writeUInt32LE(vendor.length, 8);
  vendor.copy(tags, 12);
  tags.writeUInt32LE(0, 12 + vendor.length);
  const pages = [oggPage([head], 0, serial, 0, 0x02), oggPage([tags], 0, serial, 1, 0)];
  // CAF frames are at the stream rate (48 kHz for Opus), as Ogg granules are.
  const end = priming + validFrames;
  let seq = 2;
  let granule = 0;
  const perPage = 50;
  for (let i = 0; i < list.length; i += perPage) {
    const chunk = list.slice(i, i + perPage);
    granule += chunk.length * framesPerPacket;
    const last = i + perPage >= list.length;
    pages.push(oggPage(chunk, last ? end : Math.min(granule, end), serial, seq++, last ? 0x04 : 0));
  }
  return Buffer.concat(pages);
}
