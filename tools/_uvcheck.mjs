#!/usr/bin/env node
// Throwaway UV-convention check for the PSX wheel. NO deps (Node built-ins only).
// Decodes wheel.png with zlib, parses Wheel.obj, and samples the texture at each
// face's centroid UV under BOTH conventions (v and 1-v) to see which one lands on
// plausible colours (black tyre vs bright rim).
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

// ---- PNG decode (8-bit RGBA, non-interlaced) --------------------------------
function decodePng(path) {
  const b = readFileSync(path);
  let off = 8, width = 0, height = 0;
  const idat = [];
  while (off < b.length) {
    const len = b.readUInt32BE(off);
    const type = b.subarray(off + 4, off + 8).toString('ascii');
    const data = b.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); }
    else if (type === 'IDAT') idat.push(data);
    off += 8 + len + 4;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const bpp = 4, stride = width * bpp;
  const out = Buffer.alloc(height * stride);
  let prev = Buffer.alloc(stride), pos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    const line = raw.subarray(pos, pos + stride); pos += stride;
    const cur = Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0, c = prev[x], d = x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      switch (filter) {
        case 0: break;
        case 1: v = (v + a) & 0xff; break;
        case 2: v = (v + c) & 0xff; break;
        case 3: v = (v + ((a + c) >> 1)) & 0xff; break;
        case 4: {
          const p = a + c - d, pa = Math.abs(p - a), pb = Math.abs(p - c), pc = Math.abs(p - d);
          const pr = (pa <= pb && pa <= pc) ? a : (pb <= pc ? c : d);
          v = (v + pr) & 0xff; break;
        }
      }
      cur[x] = v;
    }
    cur.copy(out, y * stride); prev = cur;
  }
  return { width, height, data: out };
}

// ---- OBJ parse (positions, uvs, faces) -------------------------------------
function parseObj(text) {
  const positions = [], uvs = [], faces = [];
  for (const raw of text.split(/\r?\n/)) {
    const parts = raw.trim().split(/\s+/);
    if (parts[0] === 'v') positions.push([+parts[1], +parts[2], +parts[3]]);
    else if (parts[0] === 'vt') uvs.push([+parts[1], +parts[2]]);
    else if (parts[0] === 'f') {
      const idx = parts.slice(1).map((s) => {
        const [p, t] = s.split('/');
        return { p: +p - 1, t: t ? +t - 1 : -1 };
      });
      faces.push(idx);
    }
  }
  return { positions, uvs, faces };
}

const tex = decodePng('PSX_Style_Cars_by_GGBot_(August2023)/Wheel/wheel.png');
const { positions, uvs, faces } = parseObj(
  readFileSync('PSX_Style_Cars_by_GGBot_(August2023)/Wheel/Wheel.obj', 'utf8'),
);

function sample(u, v) {
  const x = Math.min(tex.width - 1, Math.max(0, Math.round(u * (tex.width - 1))));
  const y = Math.min(tex.height - 1, Math.max(0, Math.round(v * (tex.height - 1))));
  const o = (y * tex.width + x) * 4;
  return [tex.data[o], tex.data[o + 1], tex.data[o + 2]];
}

console.log(`texture ${tex.width}x${tex.height}\n`);
console.log('face  uv-centroid(u,v)         pos-centroid(x,y,z)        as-is RGB  1-v RGB');

faces.forEach((f, i) => {
  // centroid UV (average of face's uv coords)
  let cu = 0, cv = 0, n = 0;
  for (const c of f) { if (c.t >= 0) { cu += uvs[c.t][0]; cv += uvs[c.t][1]; n++; } }
  cu /= n; cv /= n;
  // centroid position
  let cx = 0, cy = 0, cz = 0;
  for (const c of f) { cx += positions[c.p][0]; cy += positions[c.p][1]; cz += positions[c.p][2]; }
  cx /= f.length; cy /= f.length; cz /= f.length;

  const asIs = sample(cu, cv);
  const flipped = sample(cu, 1 - cv);
  const rad = Math.hypot(cy, cz); // distance from disc axis in YZ plane
  const kind = cv < 0.16 ? 'TREAD' : (rad < 0.35 ? 'sidewall-inner' : 'sidewall-outer');
  console.log(
    `${String(i + 1).padStart(4)} (${cu.toFixed(3)},${cv.toFixed(3)})  (${cx.toFixed(2)},${cy.toFixed(2)},${cz.toFixed(2)})  ` +
    `[${asIs.join(',')}]  [${flipped.join(',')}]  ${kind} rad=${rad.toFixed(2)}`,
  );
});

// Also sample the disc centre (YZ = 0,0) by finding its UV via the sidewall faces.
console.log('\n--- disc centre (YZ=0,0) UV interpolation ---');
function uvAtCenter() {
  // Find a sidewall face (normal along X) containing (0,0) in YZ, barycentric interpolate.
  for (const f of faces) {
    const pts = f.map((c) => [positions[c.p][1], positions[c.p][2]]);
    // triangle fan: use first 3 verts
    if (pts.length < 3) continue;
    const [A, B, C] = [pts[0], pts[1], pts[2]];
    const P = [0, 0];
    const d = (B[1] - C[1]) * (A[0] - C[0]) + (C[0] - B[0]) * (A[1] - C[1]);
    if (Math.abs(d) < 1e-9) continue;
    const wA = ((B[1] - C[1]) * (P[0] - C[0]) + (C[0] - B[0]) * (P[1] - C[1])) / d;
    const wB = ((C[1] - A[1]) * (P[0] - C[0]) + (A[0] - C[0]) * (P[1] - C[1])) / d;
    const wC = 1 - wA - wB;
    if (wA >= -1e-6 && wB >= -1e-6 && wC >= -1e-6) {
      const u = wA * uvs[f[0].t][0] + wB * uvs[f[1].t][0] + wC * uvs[f[2].t][0];
      const v = wA * uvs[f[0].t][1] + wB * uvs[f[1].t][1] + wC * uvs[f[2].t][1];
      return { u, v, face: f };
    }
  }
  return null;
}
const c = uvAtCenter();
if (c) {
  console.log(`centre UV = (${c.u.toFixed(3)}, ${c.v.toFixed(3)})`);
  console.log(`centre as-is RGB = [${sample(c.u, c.v).join(',')}]`);
  console.log(`centre 1-v  RGB = [${sample(c.u, 1 - c.v).join(',')}]`);
} else {
  console.log('centre not inside a single tri — approximating by averaging sidewall UVs');
}
