/**
 * Roadside props, the monuments: the distance signs, shrines, cairns and wreck
 * markers that stand beside the road.
 *
 * Every prop is a pure function of the integer seed via stateless hashing, so a
 * chunk builds identically whether it is generated in order or revisited later.
 * Nothing here owns game state; chunk content is a derived view of the seed.
 *
 * Monuments are a handful per chunk, so they use ordinary meshes rather than the
 * scatter's instancing.
 */

import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { maxAnisotropy } from '../../render/texturequality';
import { hash01 } from '../../core/rng';
import { SurfaceType } from '../../core/surfaces';
import { monumentsBetween, type Monument } from '../gradient';
import type { ChunkContext, ChunkContent, ChunkProvider } from '../chunks';

import { matRock } from './forms';
import { addStatic, yawRotation } from './scatter';
import { matChrome, matRust, matSignPost, matTimber } from './poles';

// Signs.
const SIGN_WIDTH = 2.4;
const SIGN_HEIGHT = 0.9;
const SIGN_CENTRE_Y = 1.9; // sign centre height above the ground

// ===========================================================================
// Monuments
// ===========================================================================

/** Renders text to an offscreen canvas; no font files, no external assets. */
function makeSignTexture(
  text: string,
  width: number,
  height: number,
  bg: string,
  fg: string,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);
    const border = Math.max(3, Math.round(width * 0.012));
    ctx.strokeStyle = fg;
    ctx.lineWidth = border;
    ctx.strokeRect(border, border, width - border * 2, height - border * 2);
    ctx.fillStyle = fg;
    ctx.font = `bold ${Math.round(height * 0.42)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, width * 0.5, height * 0.5);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy();
  return tex;
}

type Disposable = { dispose(): void };

// Shared monument geometries (never disposed).
const unitIcosaGeo = new THREE.IcosahedronGeometry(1, 1);
const shrinePostGeo = new THREE.CylinderGeometry(0.12, 0.16, 1.5, 8, 1).translate(0, 0.75, 0);
const wreckPostGeo = new THREE.CylinderGeometry(0.08, 0.1, 1.6, 6, 1).translate(0, 0.8, 0);
const ornamentGeos: readonly THREE.BufferGeometry[] = [
  new THREE.SphereGeometry(0.09, 10, 8),
  new THREE.TorusGeometry(0.08, 0.03, 8, 14),
  new THREE.ConeGeometry(0.07, 0.18, 6),
  new THREE.BoxGeometry(0.14, 0.05, 0.1),
];

interface MonumentBuild {
  ctx: ChunkContext;
  group: THREE.Group;
  bodies: RAPIER.RigidBody[];
  colliders: RAPIER.Collider[];
  disposables: Disposable[];
  m: Monument;
  x: number;
  y: number;
  z: number;
  heading: number;
}

function buildDistanceSign(b: MonumentBuild): void {
  const ox = b.ctx.originX;
  const oz = b.ctx.originZ;
  const g = new THREE.Group();
  g.position.set(b.x - ox, b.y, b.z - oz);
  g.rotation.y = b.heading + Math.PI; // face oncoming traffic

  const tex = makeSignTexture(b.m.text, 1024, 384, '#0b5c30', '#ffffff');
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, metalness: 0.1 });
  b.disposables.push(tex, mat);

  const signGeo = new THREE.PlaneGeometry(SIGN_WIDTH, SIGN_HEIGHT);
  b.disposables.push(signGeo);
  const sign = new THREE.Mesh(signGeo, mat);
  sign.position.y = SIGN_CENTRE_Y;
  g.add(sign);

  const postH = SIGN_CENTRE_Y - SIGN_HEIGHT * 0.5;
  const postGeo = new THREE.BoxGeometry(0.09, postH, 0.09);
  b.disposables.push(postGeo);
  for (const sx of [-SIGN_WIDTH * 0.45, SIGN_WIDTH * 0.45]) {
    const post = new THREE.Mesh(postGeo, matSignPost);
    post.position.set(sx, postH * 0.5, 0);
    g.add(post);
  }
  b.group.add(g);

  if (b.ctx.hasPhysics) {
    addStatic(
      b.ctx, b.bodies, b.colliders, b.x, b.y + SIGN_CENTRE_Y, b.z,
      RAPIER.ColliderDesc.cuboid(SIGN_WIDTH * 0.5, SIGN_HEIGHT * 0.5, 0.08),
      SurfaceType.Concrete,
      yawRotation(b.heading + Math.PI),
    );
  }
}

function buildShrine(b: MonumentBuild): void {
  const ox = b.ctx.originX;
  const oz = b.ctx.originZ;
  const g = new THREE.Group();
  g.position.set(b.x - ox, b.y, b.z - oz);
  g.rotation.y = hash01(b.m.variantSeed, 0) * Math.PI * 2;

  g.add(new THREE.Mesh(shrinePostGeo, matTimber));

  // Hood ornaments and badges others left behind: small chrome shapes.
  const count = 3 + Math.floor(hash01(b.m.variantSeed, 1) * 3);
  for (let i = 0; i < count; i++) {
    const orn = new THREE.Mesh(
      ornamentGeos[Math.floor(hash01(b.m.variantSeed, i + 2) * ornamentGeos.length)],
      matChrome,
    );
    const ang = (i / count) * Math.PI * 2 + hash01(b.m.variantSeed, i + 10) * 0.7;
    const rad = 0.16 + hash01(b.m.variantSeed, i + 20) * 0.22;
    orn.position.set(Math.cos(ang) * rad, 1.42 + hash01(b.m.variantSeed, i + 30) * 0.2, Math.sin(ang) * rad);
    orn.rotation.set(
      hash01(b.m.variantSeed, i + 40) * Math.PI,
      hash01(b.m.variantSeed, i + 50) * Math.PI * 2,
      hash01(b.m.variantSeed, i + 60) * Math.PI,
    );
    orn.scale.setScalar(0.7 + hash01(b.m.variantSeed, i + 70) * 0.9);
    g.add(orn);
  }
  b.group.add(g);

  if (b.ctx.hasPhysics) {
    addStatic(b.ctx, b.bodies, b.colliders, b.x, b.y + 0.72, b.z, RAPIER.ColliderDesc.capsule(0.72, 0.16), SurfaceType.Concrete);
  }
}

function buildCairn(b: MonumentBuild): void {
  const ox = b.ctx.originX;
  const oz = b.ctx.originZ;
  const g = new THREE.Group();
  g.position.set(b.x - ox, b.y, b.z - oz);
  g.rotation.y = hash01(b.m.variantSeed, 0) * Math.PI * 2;

  // A deliberate stack of balanced stones: regular, flattened, decreasing.
  const count = 4 + Math.floor(hash01(b.m.variantSeed, 1) * 2);
  let top = 0;
  for (let i = 0; i < count; i++) {
    const t = i / Math.max(1, count - 1);
    const r = (0.52 - t * 0.3) * (0.85 + hash01(b.m.variantSeed, i + 2) * 0.3);
    const stone = new THREE.Mesh(unitIcosaGeo, matRock);
    stone.scale.set(r, r * 0.52, r);
    stone.rotation.set(
      hash01(b.m.variantSeed, i + 10) * 0.5,
      hash01(b.m.variantSeed, i + 20) * Math.PI * 2,
      hash01(b.m.variantSeed, i + 30) * 0.5,
    );
    stone.position.set(
      (hash01(b.m.variantSeed, i + 40) - 0.5) * r * 0.5,
      top + r * 0.52,
      (hash01(b.m.variantSeed, i + 50) - 0.5) * r * 0.5,
    );
    top += r * 0.52 * 2 * 0.8;
    g.add(stone);
  }
  b.group.add(g);

  if (b.ctx.hasPhysics) {
    const halfH = top * 0.5 + 0.2;
    addStatic(b.ctx, b.bodies, b.colliders, b.x, b.y + halfH, b.z, RAPIER.ColliderDesc.cuboid(0.55, halfH, 0.55), SurfaceType.Rock);
  }
}

function buildWrecked(b: MonumentBuild): void {
  const ox = b.ctx.originX;
  const oz = b.ctx.originZ;
  const g = new THREE.Group();
  g.position.set(b.x - ox, b.y, b.z - oz);
  g.rotation.y = b.heading + Math.PI + (hash01(b.m.variantSeed, 0) - 0.5) * 0.6;

  // Snapped lower stub, still planted.
  const stub = new THREE.Mesh(wreckPostGeo, matSignPost);
  stub.position.set(0, 0.45, 0);
  stub.rotation.z = 0.12 + hash01(b.m.variantSeed, 1) * 0.25;
  stub.rotation.x = (hash01(b.m.variantSeed, 2) - 0.5) * 0.2;
  g.add(stub);

  // Upper section snapped clean off and lying in the sand.
  const upper = new THREE.Mesh(wreckPostGeo, matSignPost);
  upper.position.set(0.5 + hash01(b.m.variantSeed, 3) * 0.5, 0.1, 0.2 + hash01(b.m.variantSeed, 4) * 0.4);
  upper.rotation.set(0, hash01(b.m.variantSeed, 5) * Math.PI, Math.PI * 0.5 - 0.15);
  g.add(upper);

  // Bent sign panel — no text survives a wreck.
  const panelGeo = new THREE.PlaneGeometry(SIGN_WIDTH * 0.9, SIGN_HEIGHT * 0.9);
  b.disposables.push(panelGeo);
  const panel = new THREE.Mesh(panelGeo, matRust);
  panel.position.set(-0.3, 0.7, 0.1);
  panel.rotation.set(0.6, 0.3, -1.2);
  g.add(panel);

  // Debris.
  for (let i = 0; i < 3; i++) {
    const d = new THREE.Mesh(unitIcosaGeo, matRock);
    const r = 0.12 + hash01(b.m.variantSeed, i + 20) * 0.14;
    d.scale.setScalar(r);
    d.position.set((hash01(b.m.variantSeed, i + 30) - 0.5) * 1.6, r * 0.4, (hash01(b.m.variantSeed, i + 40) - 0.5) * 1.6);
    d.rotation.set(
      hash01(b.m.variantSeed, i + 50) * Math.PI,
      hash01(b.m.variantSeed, i + 60) * Math.PI * 2,
      hash01(b.m.variantSeed, i + 70) * Math.PI,
    );
    g.add(d);
  }
  b.group.add(g);

  if (b.ctx.hasPhysics) {
    addStatic(b.ctx, b.bodies, b.colliders, b.x, b.y + 0.5, b.z, RAPIER.ColliderDesc.cuboid(0.6, 0.5, 0.6), SurfaceType.Concrete);
  }
}

export class MonumentProvider implements ChunkProvider {
  readonly id = 'monuments';

  build(ctx: ChunkContext): ChunkContent {
    const group = new THREE.Group();
    const bodies: RAPIER.RigidBody[] = [];
    const colliders: RAPIER.Collider[] = [];
    const disposables: Disposable[] = [];

    // Personal-record markers were a tall white obelisk with an inset plaque. They
    // cluttered a resumed save exactly where the player stopped, so the builder and
    // the monument kind are both gone: distance reached is recorded on the car, in
    // stickers earned by hauling.
    const monuments = monumentsBetween(ctx.world.seed, ctx.sStart, ctx.sEnd);

    for (const m of monuments) {
      // Round monuments sit exactly on 20 km boundaries, which are also chunk
      // boundaries (100 chunks), so `monumentsBetween`'s inclusive upper bound
      // would build them twice; half-open dedupe fixes that.
      if (m.s < ctx.sStart || m.s >= ctx.sEnd) continue;
      // From the edge out, so a monument keeps its distance from the road however
      // wide the road is there.
      const lateral = m.side * (ctx.road.halfWidthAt(m.s) + m.setback);
      const p = ctx.road.offsetPoint(m.s, lateral);
      const groundY = ctx.terrain.heightAt(p.x, p.z, m.s);
      const heading = ctx.road.sampleAt(m.s).heading;
      const b: MonumentBuild = { ctx, group, bodies, colliders, disposables, m, x: p.x, y: groundY, z: p.z, heading };

      switch (m.kind) {
        case 'distance_sign':
          buildDistanceSign(b);
          break;
        case 'ornament_shrine':
          buildShrine(b);
          break;
        case 'cairn':
          buildCairn(b);
          break;
        case 'wrecked_marker':
          buildWrecked(b);
          break;
      }
    }

    return {
      group,
      bodies,
      colliders,
      dispose: () => {
        for (const d of disposables) d.dispose();
      },
    };
  }
}
