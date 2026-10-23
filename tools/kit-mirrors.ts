/**
 * tools/kit-mirrors.ts
 *
 * Can the driver see his door mirrors? For every kit car, from the eye the in-game cabin
 * camera uses (the `kit_driver_eye` node, interior.ts `driverEyeAt`: render/carmodel.ts
 * reads it as `cabinEye`, vehicle/cabincamera.ts makes it the driver's view), rays go to
 * a grid of points on each door mirror's glass (its live face, `userData.kitMirror`
 * `left`/`right`). A point counts as seen if the line reaches it past every opaque
 * triangle of the built car:
 * A pillar and its trim, the sail, the dash, the door's frame and card, the visors (stowed,
 * as built). Window glass is no obstacle; a line that reaches the mirror through no glass
 * at all is noted.
 *
 *   nice -n 15 bun tools/kit-mirrors.ts [--json out.json] [--no-images] [id ...]   (default: every kit car)
 *
 * Gates, per mirror:
 *   seen     at least 60 % of the glass's points (`MIN_SEEN`);
 *   angle    the glass's centre off the car's axis at most 55° on the driver's side (inside
 *            the straight-ahead cabin view: the default 85° vertical FOV at 16:9 shows 58.5°
 *            each side) and 70° on the far side (a glance, the eyes turned: the far mirror
 *            of a real car stands about 60–65° off), and between 30° under and 10° over the
 *            eye's level.
 *
 * Prints per car each mirror's seen share, its angles, and what hides the rest (the mesh
 * the blocked lines meet first). Images in build/kitcheck/<car>/: `mirror-left.png`,
 * `mirror-right.png` (the eye looking at each mirror, 40° view, the glass magenta) and
 * `mirrors-ahead.png` (the straight-ahead cabin view, 85° at 16:9). Exits 1 on any FAIL.
 *
 * Nothing here is part of the game bundle.
 */

import { installAssetShim } from './assetshim';
import { buildCar, centroid, cross, dot3, kitIds, lookAt, nodeAt, norm, outDir, perspective, RayGrid, savePng, soupOf, sub, trace, type Finding, type Soup, type V3 } from './kitlib';

installAssetShim();

const MIN_SEEN = 0.6;
/** Degrees off the car's axis: the mirror on the driver's (+x, left) side, and the far one. */
const MAX_AZIMUTH = { left: 55, right: 70 } as const;
const MIN_ELEVATION = -30;
const MAX_ELEVATION = 10;
/** Grid of sample points laid over each glass (the ones inside it are kept). */
const GRID_U = 16;
const GRID_V = 10;
const MAGENTA = [1, 0.1, 0.9];

export interface MirrorResult {
  side: 'left' | 'right';
  points: number;
  seen: number;
  /** Lines that reached the glass without crossing any glass on the way. */
  noGlass: number;
  azimuth: number;
  elevation: number;
  /** Blocked lines per first opaque mesh met. */
  blockers: Record<string, number>;
  centre: V3;
}

/** Points over a mirror face's triangles, from a grid in the face's plane (those strictly inside a triangle). */
function facePoints(s: Soup, tris: number[]): V3[] {
  let n: V3 = [0, 0, 0];
  for (const t of tris) for (let k = 0; k < 3; k++) n[k] += s.nrm[t * 3 + k]! * s.area[t]!;
  n = norm(n);
  const u = norm(cross([0, 1, 0], n));
  const w = cross(n, u);
  const flat = tris.map((t) => [0, 1, 2].map((j): [number, number] => {
    const p: V3 = [s.v[t * 9 + j * 3]!, s.v[t * 9 + j * 3 + 1]!, s.v[t * 9 + j * 3 + 2]!];
    return [dot3(p, u), dot3(p, w)];
  }));
  const all = flat.flat();
  const u0 = Math.min(...all.map((p) => p[0])), u1 = Math.max(...all.map((p) => p[0]));
  const w0 = Math.min(...all.map((p) => p[1])), w1 = Math.max(...all.map((p) => p[1]));
  const origin = centroid(s, tris[0]!);
  const d0 = dot3(origin, n);
  const out: V3[] = [];
  for (let i = 0; i < GRID_U; i++) for (let j = 0; j < GRID_V; j++) {
    const pu = u0 + ((i + 0.5) / GRID_U) * (u1 - u0);
    const pw = w0 + ((j + 0.5) / GRID_V) * (w1 - w0);
    const inside = flat.some(([a, b, c]) => {
      const area = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
      if (Math.abs(area) < 1e-12) return false;
      const l1 = ((b[0] - pu) * (c[1] - pw) - (c[0] - pu) * (b[1] - pw)) / area;
      const l2 = ((c[0] - pu) * (a[1] - pw) - (a[0] - pu) * (c[1] - pw)) / area;
      return Math.min(l1, l2, 1 - l1 - l2) > 0.001;
    });
    if (!inside) continue;
    out.push([u[0] * pu + w[0] * pw + n[0] * d0, u[1] * pu + w[1] * pw + n[1] * d0, u[2] * pu + w[2] * pw + n[2] * d0]);
  }
  return out;
}

type Box = readonly [number, number, number, number, number, number];

function triBox(s: Soup, t: number): Box {
  const p = t * 9;
  const x = [s.v[p]!, s.v[p + 3]!, s.v[p + 6]!];
  const y = [s.v[p + 1]!, s.v[p + 4]!, s.v[p + 7]!];
  const z = [s.v[p + 2]!, s.v[p + 5]!, s.v[p + 8]!];
  return [Math.min(...x), Math.min(...y), Math.min(...z), Math.max(...x), Math.max(...y), Math.max(...z)];
}

export async function checkMirrors(id: string, images: boolean): Promise<{ eye: V3; mirrors: MirrorResult[]; findings: Finding[] }> {
  const car = buildCar(id);
  const s = soupOf(car.root);
  const eye = nodeAt(car.root, 'kit_driver_eye');
  if (!eye) throw new Error(`${id}: no kit_driver_eye`);
  const opaque = (t: number): boolean => {
    const m = s.meshes[s.mesh[t]!]!;
    return !m.glass && !m.hidden;
  };
  const occluders = new RayGrid(s, opaque);
  const panes = new RayGrid(s, (t) => {
    const m = s.meshes[s.mesh[t]!]!;
    return m.glass && !m.hidden;
  });
  const findings: Finding[] = [];
  const mirrors: MirrorResult[] = [];
  const faces = new Map<string, number[]>();
  for (let t = 0; t < s.n; t++) {
    const side = s.meshes[s.mesh[t]!]!.mirror;
    if (side !== 'left' && side !== 'right') continue;
    let list = faces.get(side);
    if (!list) faces.set(side, (list = []));
    list.push(t);
  }
  // The spec says which door mirrors the car has (`KitLook.mirrors`: the base Oka's driver's only).
  const expected = car.spec.look.mirrors === 'left' ? (['left'] as const) : (['left', 'right'] as const);
  const shellBoxes: Box[] = [];
  const housingBoxes: Record<'left' | 'right', Box[]> = { left: [], right: [] };
  for (let t = 0; t < s.n; t++) {
    const m = s.meshes[s.mesh[t]!]!;
    const box = triBox(s, t);
    if (m.zone === 'exterior' && !m.hidden && !m.glass && !m.path.includes('_mirror/')) shellBoxes.push(box);
    for (const side of ['left', 'right'] as const) {
      const owner = side === 'left' ? 'door_fl' : 'door_fr';
      if (m.path.startsWith(`${owner}/${owner}_mirror/`) && !m.mirror) housingBoxes[side]!.push(box);
    }
  }
  // A support that merely floats near the panel can still leave every mirror visible. Require
  // at least one housing triangle's bounds to enter the shell, which catches that separate
  // failure without confusing the mirror-view occlusion test.
  const touchesBody = (side: 'left' | 'right'): boolean =>
    housingBoxes[side]!.some((h) => shellBoxes.some((b) =>
      h[0] <= b[3] && h[3] >= b[0] && h[1] <= b[4] && h[4] >= b[1] && h[2] <= b[5] && h[5] >= b[2]));
  for (const side of expected) {
    const tris = faces.get(side);
    if (!tris) {
      findings.push({ car: id, level: 'fail', what: `${side} door mirror: no live mirror face (userData.kitMirror) found` });
      continue;
    }
    if (!touchesBody(side)) findings.push({ car: id, level: 'fail', what: `${side} door mirror: housing/support does not enter the body shell` });
    const pts = facePoints(s, tris);
    const own = new Set(tris);
    let seen = 0;
    let noGlass = 0;
    const blockers: Record<string, number> = {};
    for (const p of pts) {
      const d = sub(p, eye);
      const len = Math.hypot(...d);
      const dir = norm(d);
      const hit = occluders.nearest(eye, dir, len - 5e-4, (t) => own.has(t));
      if (hit) {
        const m = s.meshes[s.mesh[hit.tri]!]!;
        const key = m.path.replace(/\/mirrors$/, '/mirror housing');
        blockers[key] = (blockers[key] ?? 0) + 1;
        continue;
      }
      seen++;
      if (!panes.nearest(eye, dir, len - 5e-4)) noGlass++;
    }
    const centre = pts.reduce<V3>((a, p) => [a[0] + p[0] / pts.length, a[1] + p[1] / pts.length, a[2] + p[2] / pts.length], [0, 0, 0]);
    const c = sub(centre, eye);
    const azimuth = (Math.atan2(c[0], c[2]) * 180) / Math.PI;
    const elevation = (Math.atan2(c[1], Math.hypot(c[0], c[2])) * 180) / Math.PI;
    const r: MirrorResult = { side, points: pts.length, seen, noGlass, azimuth, elevation, blockers, centre };
    mirrors.push(r);
    const share = pts.length > 0 ? seen / pts.length : 0;
    if (pts.length === 0) findings.push({ car: id, level: 'fail', what: `${side} mirror: no sample points on its glass` });
    else if (share < MIN_SEEN) {
      const top = Object.entries(blockers).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} ${v}`).join(', ');
      findings.push({ car: id, level: 'fail', what: `${side} mirror ${(share * 100).toFixed(0)} % seen from the driver's eye (< ${MIN_SEEN * 100} %); hidden by ${top}` });
    }
    if (Math.abs(azimuth) > MAX_AZIMUTH[side]) findings.push({ car: id, level: 'fail', what: `${side} mirror ${Math.abs(azimuth).toFixed(1)}° off the car's axis (> ${MAX_AZIMUTH[side]}°)` });
    if (elevation < MIN_ELEVATION || elevation > MAX_ELEVATION) findings.push({ car: id, level: 'fail', what: `${side} mirror ${elevation.toFixed(1)}° from the eye's level (outside ${MIN_ELEVATION}..+${MAX_ELEVATION}°)` });
    if (seen > 0 && noGlass > 0) findings.push({ car: id, level: 'warn', what: `${side} mirror: ${noGlass} of ${seen} lines reach it through no glass` });
  }
  if (images) {
    const dir = await outDir(id);
    const view = new RayGrid(s, (t) => opaque(t) || !!s.meshes[s.mesh[t]!]!.mirror?.match(/left|right/) || (s.meshes[s.mesh[t]!]!.glass && !s.meshes[s.mesh[t]!]!.hidden));
    const tint = (t: number) => (s.meshes[s.mesh[t]!]!.mirror ? MAGENTA : undefined);
    for (const m of mirrors) {
      await savePng(trace(s, view, 320, 240, lookAt(eye, m.centre, 40, 320, 240).ray, tint, [235, 240, 245, 255]).img, `${dir}mirror-${m.side}.png`);
    }
    await savePng(trace(s, view, 640, 360, perspective(eye, 0, 0, 85, 640, 360).ray, tint, [235, 240, 245, 255]).img, `${dir}mirrors-ahead.png`);
  }
  return { eye, mirrors, findings };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const jsonAt = args.indexOf('--json');
  const jsonPath = jsonAt >= 0 ? args[jsonAt + 1] : undefined;
  const ids = kitIds(args.filter((_, i) => jsonAt < 0 || i !== jsonAt + 1));
  const images = !args.includes('--no-images');
  const results: { id: string; eye: V3; mirrors: MirrorResult[]; findings: Finding[] }[] = [];
  console.log('car             mirror  seen          az°    el°   hidden by');
  for (const id of ids) {
    const r = await checkMirrors(id, images);
    results.push({ id, ...r });
    for (const m of r.mirrors) {
      const top = Object.entries(m.blockers).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k, v]) => `${k} ${v}`).join(', ');
      const share = m.points > 0 ? (m.seen / m.points) * 100 : 0;
      console.log(`${id.padEnd(15)} ${m.side.padEnd(6)} ${share.toFixed(0).padStart(4)} % ${`${m.seen}/${m.points}`.padStart(7)} ${m.azimuth.toFixed(1).padStart(6)} ${m.elevation.toFixed(1).padStart(6)}   ${top || '-'}`);
    }
  }
  const findings = results.flatMap((r) => r.findings);
  for (const f of findings.filter((x) => x.level === 'warn')) console.log(`  warn ${f.car}: ${f.what}`);
  if (jsonPath) await Bun.write(jsonPath, JSON.stringify(results, null, 1));
  const fails = findings.filter((f) => f.level === 'fail');
  if (fails.length > 0) {
    console.log(`\nFAIL: ${fails.length} mirror finding(s)`);
    for (const f of fails) console.log(`  ${f.car}: ${f.what}`);
    process.exit(1);
  }
  console.log(`\nPASS: every door mirror ≥ ${MIN_SEEN * 100} % seen and within the view`);
}
