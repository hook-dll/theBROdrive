/**
 * Roadside props, the monuments at every 20 km: a distance sign, or one of the
 * artefacts in `artifacts.ts`.
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

import { addStatic, yawRotation } from './scatter';
import { matSignPost } from './poles';
import { ARTIFACT_EXTRA_SETBACK_M, artifactProgramAnchor, buildArtifact } from './artifacts';

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

/**
 * Hidden meshes holding the programs of everything at the 20 km marks, for the scene
 * at boot: the artefacts (`artifactProgramAnchor`) and the distance sign. The sign's
 * material is made per sign, for its own text, and disposed with the chunk, so on its
 * own its program was linked as each sign came into view and released when it left.
 * The anchor's material has the same shape — a map, the same finish, no shadows — on a
 * one-pixel texture, so the program is linked once under the loading cover and kept.
 */
export function monumentProgramAnchor(): THREE.Object3D {
  const group = new THREE.Group();
  group.name = 'monument-anchor';
  group.visible = false;
  const texture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshStandardMaterial({ map: texture, roughness: 0.6, metalness: 0.1 }),
  );
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.09, 1, 0.09), matSignPost);
  group.add(sign, post, artifactProgramAnchor());
  return group;
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
      const artifact = m.kind !== 'distance_sign';
      const lateral =
        m.side * (ctx.road.halfWidthAt(m.s) + m.setback + (artifact ? ARTIFACT_EXTRA_SETBACK_M : 0));
      const p = ctx.road.offsetPoint(m.s, lateral);
      const groundY = ctx.terrain.heightAt(p.x, p.z, m.s);
      const heading = ctx.road.sampleAt(m.s).heading;
      const b: MonumentBuild = { ctx, group, bodies, colliders, disposables, m, x: p.x, y: groundY, z: p.z, heading };

      if (m.kind === 'distance_sign') buildDistanceSign(b);
      else {
        buildArtifact(m.kind, {
          ctx, group, bodies, colliders, seed: m.variantSeed, x: p.x, y: groundY, z: p.z, heading,
        });
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
