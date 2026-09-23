/**
 * Roadside props, the delineator runs: the reflector posts the director schedules as
 * 400-1200 m runs rather than as objects.
 *
 * Every prop is a pure function of the integer seed via stateless hashing, so a
 * chunk builds identically whether it is generated in order or revisited later.
 * Nothing here owns game state; chunk content is a derived view of the seed.
 */

import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { hash01 } from '../../core/rng';
import { SurfaceType } from '../../core/surfaces';
import { varietyEventsBetween, type VarietyEvent } from '../director';
import { drawnGroundY } from '../terrainmesh';
import type { RoadDistance } from '../roaddistance';
import type { ChunkContext, ChunkContent, ChunkProvider } from '../chunks';

import { propPieces, type BreakableSink } from './forms';
import { addStatic, yawRotation } from './scatter';

// ---------------------------------------------------------------------------
// Scratch objects reused across the per-chunk build loops (never per-frame).
// ---------------------------------------------------------------------------
const _dummy = new THREE.Object3D();

// Delineators: the reflector-post runs the variety director schedules (kind
// 'delineators' in `world/director.ts`). A run is 400-1200 m of road, so the posts
// are the one thing on this list that arrives as a RUN rather than as an object.
const TAG_DELINEATOR = 0xde11a7;
/**
 * MEASURED FROM THE ASPHALT EDGE, like every other setback in this file.
 *
 * 1.2 m is where a delineator belongs: far enough out that a wheel tracking the
 * paint cannot clip one, close enough in that the run reads as edge marking rather
 * than as a fence line retreating into the desert. It also lands the whole run
 * inside the 3.5 m loose verge and nowhere near the 3.1 m pole line, so a post and
 * a mast never fight for the same ground. Perched birds use 0.7-2.4 m of the same
 * shoulder (`agents/birds.ts`); a post is 12 cm wide and carries no collider, so the
 * two share the band the way a bird and a fence post share a fence post.
 */
export const DELINEATOR_SETBACK_M = 1.2;
/**
 * Station spacing, metres. Every consecutive gap lands in this exact range: the
 * gaps are drawn per station rather than fixed, because a perfectly even run reads
 * as a texture and an uneven one reads as something somebody installed.
 */
export const DELINEATOR_GAP_MIN = 40;
export const DELINEATOR_GAP_MAX = 60;
/** Post height, metres: knee-high plus a little, the height of the real article. */
export const DELINEATOR_HEIGHT = 1.05;
/** Width of the face that carries the reflector. */
export const DELINEATOR_FACE_W = 0.12;
/** Planted this deep, so no post shows daylight under it on a rippled verge. */
export const DELINEATOR_EMBED = 0.03;
/**
 * Reflector centre height. A saloon's headlamps sit near 0.7 m and the beam rises
 * as it goes, so a reflector at 0.82 m is inside the hot part of the beam at the
 * distance the run matters — a hundred metres ahead, where it draws the curve.
 */
export const DELINEATOR_REFLECTOR_Y = 0.82;
/**
 * What `event.draw` buys. Below the first figure the run is posted on BOTH sides
 * (the avenue), below the second it alternates sides (the cheap installation), above
 * it stays on the event's own side. Three layouts, because one layout over 1.2 km is
 * a fence and the player learns to stop seeing it.
 */
const DELINEATOR_BOTH_SIDES = 0.34;
const DELINEATOR_ALTERNATING = 0.67;
/**
 * Radians the post's face is canted in toward the carriageway. A reflector square to
 * the road returns light to a driver who is already past it; the cant turns it back
 * up the road toward the headlights that are still coming.
 */
const DELINEATOR_CANT = 0.26;
/** Yaw jitter, radians: these are hammered in from the back of a truck, not surveyed. */
const DELINEATOR_YAW_JITTER = 0.1;
/**
 * Base of the delineator id band, and why it is a band of its own.
 *
 * A breakable's id is its identity in `state.flattenedProps`, which is a number array
 * in every save: two props sharing one id means knocking down a post also erases some
 * cactus three deserts away. The scatter's road obstacles use small negatives
 * (`-1 - candidate * 2 - kind`) and the desert uses packed positive cells, so the
 * delineators take a reserved negative band far above both — 2^24 is 16.7 million, an
 * exact integer in a double and about six times the widest the road-obstacle stream
 * can ever count to.
 */
const DELINEATOR_ID_BASE = 1 << 24;
/** Slots reserved per run, so the band cannot collide with itself. A run is under 30. */
const DELINEATOR_ID_SLOTS = 256;

/** Stable identity of one post: the run's window, its station, and which side it is on. */
function delineatorId(window: number, ordinal: number, side: -1 | 1): number {
  return -(DELINEATOR_ID_BASE + window * DELINEATOR_ID_SLOTS + ordinal * 2 + (side > 0 ? 1 : 0));
}
/**
 * Emissive intensity of a reflector at full night. It is NOT a light: the light
 * budget is six real PointLights for the whole world (see `LightBudget` in main.ts)
 * and a kilometre of posts would eat it twice over. An emissive chip that comes up
 * over the same dusk ramp as the lamps is what makes the run read as an avenue.
 */
const REFLECTOR_EMISSIVE = 2.6;

// ---------------------------------------------------------------------------
// Shared materials (never disposed; they live for the whole session)
// ---------------------------------------------------------------------------

/**
 * Delineator post and reflector.
 *
 * The post is bleached white-grey plastic, not white: a pure white post in this
 * palette reads as a painted kerb stone. The reflector's own albedo is a dull amber
 * so it is legible in daylight as a chip of glass rather than a hole in the post,
 * and its EMISSIVE — not a light — is what makes it a bright dot after dark.
 */
export const matDelineator = new THREE.MeshStandardMaterial({ color: 0xd6d1c3, roughness: 0.78, metalness: 0.05 });
export const matReflector = new THREE.MeshStandardMaterial({
  color: 0xb9a179,
  emissive: 0xffdca8,
  emissiveIntensity: 0,
  roughness: 0.22,
  metalness: 0.2,
});

let reflectorEmissiveIntensity = -1;

/** Shared with every run in the world, so this is one material write per frame. */
function setReflectorEmission(on: number): void {
  const value = on * REFLECTOR_EMISSIVE;
  if (value === reflectorEmissiveIntensity) return;
  reflectorEmissiveIntensity = value;
  matReflector.emissiveIntensity = value;
}

// ===========================================================================
// Delineators: runs of reflector posts
// ===========================================================================

let _delineatorPost: THREE.BufferGeometry | null = null;
/**
 * The post: a flat blade, not a round picket, with its reflector merged in.
 *
 * The wide face is what carries the reflector and what a headlight beam meets
 * square-on, and 4 cm of thickness is what makes it read as a sheet of plastic at
 * fifty metres rather than as a fence post. Twelve triangles per box, and it is
 * instanced, so a 1.2 km run of thirty posts is one draw call either way.
 *
 * ONE geometry with two material GROUPS rather than two instanced meshes sharing a
 * matrix, and the reason is the break. A post is a solid obstacle now, and a solid
 * obstacle that cannot be knocked down is a car-wrecker; so a post is registered with
 * the debris field as a breakable, and `BreakableProp` blanks ONE mesh instance when
 * it goes. Two meshes meant either a second field in that interface or a reflector
 * chip left hanging in the air at knee height after its blade had gone — glowing, at
 * night, which is exactly when the run matters. Merging makes the two inseparable
 * instead of merely kept in step.
 */
function delineatorPost(): THREE.BufferGeometry {
  if (!_delineatorPost) {
    // The reflector is carried in the post's own frame: it sits proud of the +Z face,
    // which is the face the post's yaw turns back up the road toward oncoming lights.
    const blade = new THREE.BoxGeometry(DELINEATOR_FACE_W, DELINEATOR_HEIGHT, 0.04).translate(
      0,
      DELINEATOR_HEIGHT * 0.5 - DELINEATOR_EMBED,
      0,
    );
    const reflector = new THREE.BoxGeometry(0.075, 0.13, 0.014).translate(
      0,
      DELINEATOR_REFLECTOR_Y - DELINEATOR_EMBED,
      0.027,
    );
    _delineatorPost = mergeGeometries([blade, reflector], true);
  }
  return _delineatorPost;
}

/** Material order for `delineatorPost`'s two groups. */
const DELINEATOR_MATERIALS: THREE.Material[] = [matDelineator, matReflector];


/**
 * Every post station of one run that falls in `[fromS, toS)`.
 *
 * The run is walked FROM ITS OWN START every time, because the gaps are a hash
 * CHAIN: station n is the sum of n drawn gaps, and a chain entered halfway is a
 * different chain. A run is at most 1200 m of 40-60 m gaps, so the walk is at most
 * thirty iterations of one hash — cheaper than the road query each surviving station
 * then costs, and it is what makes the chunk holding the middle of a run agree with
 * the chunk that held its beginning.
 */
function forEachDelineator(
  seed: number,
  event: VarietyEvent,
  fromS: number,
  toS: number,
  cb: (s: number, side: -1 | 1, ordinal: number) => void,
): void {
  const end = event.s + event.halfLength;
  const both = event.draw < DELINEATOR_BOTH_SIDES;
  const alternating = !both && event.draw < DELINEATOR_ALTERNATING;
  let s = event.s - event.halfLength;
  for (let ordinal = 0; s < end; ordinal++) {
    if (s >= fromS && s < toS) {
      if (both) {
        cb(s, -1, ordinal);
        cb(s, 1, ordinal);
      } else if (alternating) {
        cb(s, ((ordinal & 1) === 0 ? event.side : -event.side) as -1 | 1, ordinal);
      } else {
        cb(s, event.side, ordinal);
      }
    }
    s +=
      DELINEATOR_GAP_MIN +
      hash01(seed, TAG_DELINEATOR, event.index, ordinal) * (DELINEATOR_GAP_MAX - DELINEATOR_GAP_MIN);
  }
}

/**
 * Runs of roadside reflector posts, on the director's 'delineators' schedule.
 *
 * This is the cheapest thing in the world that changes the view: a run says the road
 * is being maintained, it draws the curve ahead in daylight, and after dark the
 * reflectors are the only thing in the desert that answers the headlights.
 *
 * THEY ARE SOLID, AND THEY COME APART. A post with no collider is a lie the first
 * time a car drives through one; a post with a collider and nothing else is a worse
 * lie, because 12 cm of plastic would stop two tonnes dead. So a post inside the
 * physics window carries a collider AND is registered with the debris field as
 * breakable, which is the same road the scatter's cacti and boulders take: the car
 * clips it, the post bursts into its parts, and the parts are the debris. That is
 * what the real article does, and it is why the run can be an obstacle without being
 * a wall.
 *
 * The cost is bounded by the streaming radii and nothing else. Colliders are built
 * only where `ctx.hasPhysics` is true — the player's chunk and its two neighbours,
 * a kilometre of road — so a 40-60 m spacing puts eight to twenty-four of them in
 * the world at once, against the hundreds the scatter field carries over the same
 * kilometre. A run outside that window is instanced scenery and nothing more.
 */
export class DelineatorProvider implements ChunkProvider {
  readonly id = 'delineators';

  /**
   * The SHARED road-distance index, for the same reason `TerrainMeshProvider` takes
   * it: a post has to stand on the surface that is DRAWN, and `drawnGroundY` can only
   * reproduce the mesh if it asks the same lattice the mesh asked. Sampling the height
   * field instead left feet up to 4.6 cm off the drawn ground — measured, in
   * `tools/verge-furniture.ts` — which on sand in a low sun is a visible gap.
   *
   * `breakables` is optional for the same reason it is on the scatter: a viewer with
   * no debris field should still get the posts.
   */
  constructor(
    private readonly roadDistance: RoadDistance,
    private readonly breakables?: BreakableSink,
  ) {}

  build(ctx: ChunkContext): ChunkContent | null {
    const seed = ctx.world.seed;
    const ox = ctx.originX;
    const oz = ctx.originZ;

    // One allocation per chunk, which is what `varietyEventsBetween` is for. A run is
    // 400-1200 m against a 200 m chunk, so most chunks inside a run see exactly one
    // event and most chunks outside one see none.
    const posts: { x: number; y: number; z: number; yaw: number; id: number }[] = [];
    for (const event of varietyEventsBetween(seed, ctx.sStart, ctx.sEnd)) {
      if (event.kind !== 'delineators') continue;
      forEachDelineator(seed, event, ctx.sStart, ctx.sEnd, (s, side, ordinal) => {
        // A post already knocked down is not rebuilt, which is the same test the
        // scatter makes: the piece is absent rather than re-created and blanked, so a
        // saved flat post stays flat and costs nothing.
        const id = delineatorId(event.index, ordinal, side);
        if (this.breakables?.isBroken(id)) return;
        // Outward from the LOCAL asphalt edge: the carriageway widens and narrows
        // (`roadprofile.ts`), and a run authored at a fixed lateral would walk onto
        // the paint of every widened stretch it crossed.
        const lateral = side * (ctx.road.halfWidthAt(s) + DELINEATOR_SETBACK_M);
        const p = ctx.road.offsetPoint(s, lateral);
        const sample = ctx.road.sampleAt(s);
        // `heading + PI` turns the face back DOWN the road at traffic that has not
        // arrived yet; `+ side * cant` turns it in over the carriageway rather than
        // out at the desert. The jitter is per post and per side, so a both-sides run
        // does not read as a pair of rails.
        const yaw =
          sample.heading +
          Math.PI +
          side * DELINEATOR_CANT +
          (hash01(seed, TAG_DELINEATOR, event.index, ordinal, side) - 0.5) * DELINEATOR_YAW_JITTER;
        posts.push({
          x: p.x,
          y: drawnGroundY(ctx.road, ctx.terrain, this.roadDistance, s, lateral),
          z: p.z,
          yaw,
          id,
        });
      });
    }
    if (posts.length === 0) return null;

    const group = new THREE.Group();
    const shafts = new THREE.InstancedMesh(delineatorPost(), DELINEATOR_MATERIALS, posts.length);

    const bodies: RAPIER.RigidBody[] = [];
    const colliders: RAPIER.Collider[] = [];
    const registered: number[] = [];
    // Half the blade's STANDING height — what is above ground once the planted depth
    // is taken off. The collider's centre goes a half-blade above the foot the
    // instance sits at, so the solid post occupies exactly the drawn post.
    const halfHeight = (DELINEATOR_HEIGHT - DELINEATOR_EMBED) * 0.5;
    for (let i = 0; i < posts.length; i++) {
      const post = posts[i]!;
      _dummy.position.set(post.x - ox, post.y, post.z - oz);
      _dummy.rotation.set(0, post.yaw, 0);
      _dummy.scale.setScalar(1);
      _dummy.updateMatrix();
      shafts.setMatrixAt(i, _dummy.matrix);

      if (!ctx.hasPhysics) continue;
      // A cuboid, not a capsule: the blade is 12 cm of face and 4 cm of thickness, and
      // a capsule would give the car a round fence post to hit. It is solid for the
      // whole height of the standing blade, so a wheel arch clips what a wheel misses.
      const collider = addStatic(
        ctx,
        bodies,
        colliders,
        post.x,
        post.y + halfHeight,
        post.z,
        RAPIER.ColliderDesc.cuboid(DELINEATOR_FACE_W * 0.5, halfHeight, 0.02),
        // The post is plastic and breaks on the first touch; what a wheel is on when
        // it clips one is the verge the post is planted in.
        SurfaceType.LooseShoulder,
        yawRotation(post.yaw),
      );
      if (this.breakables) {
        registered.push(post.id);
        this.breakables.register({
          id: post.id,
          pieces: propPieces('delineator')!,
          x: post.x,
          y: post.y,
          z: post.z,
          yaw: post.yaw,
          scale: 1,
          radius: DELINEATOR_FACE_W * 0.5,
          height: DELINEATOR_HEIGHT - DELINEATOR_EMBED,
          mesh: shafts,
          instance: i,
          collider,
        });
      }
    }
    shafts.instanceMatrix.needsUpdate = true;
    // Culled on its instances' own bounds, for the scatter's reasons (see `buildSteps`):
    // computed once over the standing run; a broken post is only ever blanked smaller.
    shafts.computeBoundingSphere();
    group.add(shafts);

    return {
      group,
      bodies,
      colliders,
      dispose: () => {
        shafts.dispose();
        if (registered.length > 0) this.breakables?.forget(registered);
      },
      /**
       * The reflector material is shared by every run in the world, so this is one
       * comparison and at most one write per frame however many runs are loaded. It
       * takes the same dusk ramp the lamps do (see `setLampEmission`), which is why
       * the run comes up over the twilight instead of switching on in a frame.
       */
      setLamps(on: number): void {
        setReflectorEmission(on);
      },
    };
  }
}
