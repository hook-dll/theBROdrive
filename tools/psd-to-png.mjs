#!/usr/bin/env node
/**
 * tools/psd-to-png.mjs
 *
 * Converts a flattened 8-bit RGB/RGBA Photoshop document into a PNG, so a Unity
 * asset pack's authored texture can be served to a browser unchanged. Only the
 * composite image is read: layers, masks and colour profiles are ignored, which is
 * exactly what Unity's own importer would have baked.
 *
 * Both PSD composite encodings are handled: raw planar channels and PackBits RLE.
 *
 * Usage: node tools/psd-to-png.mjs <in.psd> <out.png>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

/** Reads the PSD header and returns the offset of the composite image data. */
function openPsd(buf) {
  if (buf.toString('latin1', 0, 4) !== '8BPS') throw new Error('not a PSD');
  const version = buf.readUInt16BE(4);
  if (version !== 1) throw new Error(`unsupported PSD version ${version}`);
  const channels = buf.readUInt16BE(12);
  const height = buf.readUInt32BE(14);
  const width = buf.readUInt32BE(18);
  const depth = buf.readUInt16BE(22);
  const mode = buf.readUInt16BE(24);
  if (depth !== 8) throw new Error(`unsupported bit depth ${depth}`);
  if (mode !== 3) throw new Error(`unsupported colour mode ${mode} (expected RGB)`);

  let off = 26;
  off += 4 + buf.readUInt32BE(off); // colour mode data
  off += 4 + buf.readUInt32BE(off); // image resources
  off += 4 + buf.readUInt32BE(off); // layer and mask information
  return { width, height, channels, offset: off };
}

/** Decodes the planar composite into one interleaved RGBA buffer. */
function decodeComposite(buf, psd) {
  const { width, height, channels, offset } = psd;
  const compression = buf.readUInt16BE(offset);
  let off = offset + 2;
  const planes = [];

  if (compression === 0) {
    for (let c = 0; c < channels; c++) {
      planes.push(buf.subarray(off, off + width * height));
      off += width * height;
    }
  } else if (compression === 1) {
    // PackBits: every scanline of every channel is length-prefixed up front.
    const lineLengths = new Array(channels * height);
    for (let i = 0; i < lineLengths.length; i++) {
      lineLengths[i] = buf.readUInt16BE(off);
      off += 2;
    }
    for (let c = 0; c < channels; c++) {
      const plane = Buffer.alloc(width * height);
      for (let y = 0; y < height; y++) {
        const length = lineLengths[c * height + y];
        unpackBits(buf.subarray(off, off + length), plane, y * width, width);
        off += length;
      }
      planes.push(plane);
    }
  } else {
    throw new Error(`unsupported composite compression ${compression}`);
  }

  const rgba = Buffer.alloc(width * height * 4, 0xff);
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = planes[0][i];
    rgba[i * 4 + 1] = planes[1] ? planes[1][i] : planes[0][i];
    rgba[i * 4 + 2] = planes[2] ? planes[2][i] : planes[0][i];
    if (channels >= 4) rgba[i * 4 + 3] = planes[3][i];
  }
  return rgba;
}

function unpackBits(src, dest, destOffset, limit) {
  let s = 0;
  let d = destOffset;
  const end = destOffset + limit;
  while (s < src.length && d < end) {
    const n = src.readInt8(s++);
    if (n >= 0) {
      const count = n + 1;
      src.copy(dest, d, s, s + count);
      s += count;
      d += count;
    } else {
      const count = 1 - n;
      dest.fill(src[s++], d, Math.min(d + count, end));
      d += count;
    }
  }
}

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error('usage: node tools/psd-to-png.mjs <in.psd> <out.png>');
  process.exit(1);
}
const buf = readFileSync(input);
const psd = openPsd(buf);
const rgba = decodeComposite(buf, psd);
writeFileSync(output, encodePng(psd.width, psd.height, rgba));
console.log(`${input} -> ${output}  ${psd.width}x${psd.height} ${psd.channels}ch`);
