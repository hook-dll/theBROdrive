/**
 * Roadside props, the scatter half: sparse desert scatter (cacti + rocks). Nothing is
 * ever placed on the driving surface.
 *
 * Every prop is a pure function of the integer seed via stateless hashing, so a
 * chunk builds identically whether it is generated in order or revisited later.
 * Nothing here owns game state; chunk content is a derived view of the seed.
 *
 * Instancing is load-bearing for the scatter: the visible radius needs hundreds of
 * cacti and rocks, and one draw call per mesh is the only way that stays at frame
 * rate.
 */

import { groundCoverActive, lightGeometryActive } from '../../render/retro';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { hash01 } from '../../core/rng';
import { SurfaceType } from '../../core/surfaces';
import { ROAD_HALF_WIDTH } from '../road';
import { laybyKeepsClear } from '../layby';
import { mesaFieldOf } from '../mesas';
import type { ChunkContext, ChunkContent, ChunkProvider } from '../chunks';

import {
  groundCoverForms,
  pickDesertForm,
  propPieces,
  rockForms,
  sandForms,
  type BreakableSink,
  type PropForm,
} from './forms';
import { allocateContactShadows, type ContactShadowSpot } from './contactshadow';
import type { BatchSlot } from './instancebatch';
import {
  groundCoverDensity,
  type GroundCoverField,
  type GroundCoverHandle,
  type GroundCoverSpot,
} from './groundcover';

// ---------------------------------------------------------------------------
// Scratch objects reused across the per-chunk build loops (never per-frame).
// ---------------------------------------------------------------------------
const _dummy = new THREE.Object3D();
const _q1 = new THREE.Quaternion();
const _axis = new THREE.Vector3();
const _euler = new THREE.Euler();
let _hullPoints = new Float32Array(0);

// ---------------------------------------------------------------------------
// Tuning constants
// ---------------------------------------------------------------------------

// Scatter. Cell grid is in the road's local (arclength, lateral) frame, so it
// follows the road rather than a world-aligned lattice and the road never cuts
// through a cell.
const TAG_SCATTER = 0x5ca17e2;
const CELL_S = 6; // metres between candidate cells along the road
const CELL_L = 6; // metres between candidate cells laterally
/**
 * Nearest a scattered prop stands to the ASPHALT EDGE, metres: clear of the 3.5 m
 * gravel verge with room to spare. Authored as a setback for the same reason the
 * pole line is — a fixed 9 m from the crown is 9 m of clearance on a narrow road and
 * 3.2 m on a widened one, which puts cacti on the verge and boulders at the paint.
 */
const SCATTER_SETBACK_M = 6.1;
/** Cheap pre-filter: the setback at the NARROWEST the road ever is. */
const MIN_LAT = ROAD_HALF_WIDTH + SCATTER_SETBACK_M;
/**
 * Lateral reach of the scatter, and where it starts thinning out.
 *
 * This was 42 m — "close enough to the road to actually be seen" — and the result was
 * a hedge. Six hundred metres of driveable desert either side, and everything standing
 * in it stood in the first seven percent of it, so leaving the road meant leaving the
 * furniture behind and driving across a bare plain.
 *
 * Two things had to be fixed before the band could be widened, and neither was the
 * band. Props were placed at `Terrain.heightAt`, which is the height FIELD; past the
 * tight rings near the road the drawn mesh chords that field by metres, so a boulder
 * at 200 m would have hovered or buried itself. They now stand on `drawnGroundY`, the
 * mesh's own surface. And every candidate cell paid two road projections (12 us) before
 * its occupancy roll was even looked at, which is what made 578 cells cost 6.5 ms; the
 * roll is a hash, so it goes first and 90% of cells now cost nothing but that hash.
 *
 * `MAX_LAT` stops just inside `PHYSICS_LATERAL`: past that edge there is no collider,
 * and a rock you can drive through is worse than no rock. The taper from `FULL_LAT`
 * exists so the far edge is not a second hedge — a line of props running the length of
 * the world at a fixed distance reads as a fence.
 */
const FULL_LAT = 300;
const MAX_LAT = 560;
/**
 * Roadside scatter is deliberately denser than the open tile field, but no longer
 * saturates the whole 1.1 km strip. Four times fewer candidates preserves occasional
 * rock fields and cacti while the player-centred tiles carry sparse landmarks forever.
 */
const ROCK_DENSITY = 0.045;
const CACTUS_DENSITY = 0.009;
/**
 * Clear ground between a scattered prop or plant and a mesa's footprint, metres: the
 * largest boulder's radius with room, so nothing stands half inside the rock wall.
 */
const MESA_SCATTER_CLEARANCE_M = 6;
const ROCK_COLLIDER_MIN = 0.55; // pebbles under this radius (m) get no collider
/**
 * Ground cover (dry tufts, shrubs, rosettes), a decoration stream of its own:
 * its own tag, so no existing cell's roll moves. Two populations:
 *
 *  - THE OPEN DESERT: one candidate per `GROUND_COVER_CELL` square out to
 *    `GROUND_COVER_LAT`, kept at `GROUND_COVER_OPEN`, an even sparse spread.
 *  - THE VERGE: the band `VERGE_NEAR_M`-`VERGE_FAR_M` from the asphalt, where runoff
 *    off the road waters the ground, 4-6 times as dense on average and CLUMPED: a
 *    clump of two to six plants every few dozen metres with bare sand between, more of
 *    them where the ground beside the road lies lower than the asphalt and on the side
 *    the road's camber sheds its water to (`vergeRunoff`). A smooth density bump here
 *    read as a hedge along the verge twice (the cube falloff over 160 m, then this
 *    profile's 2x near the road): a uniform verge is a planted one, a clumped one grew.
 *
 * Only built inside the physics radius: a tuft is a few pixels by then, and a chunk
 * rebuilds when it crosses it. That is what a stretch at full density looks like —
 * `groundCoverDensity` (`groundcover.ts`) thins both populations over kilometres of road
 * and clears them on bare stretches, keyed on the arclength each candidate is placed at.
 */
const TAG_GROUND_COVER = 0x7f6c0e;
const GROUND_COVER_CELL = 3;
/** Chance of a plant per open cell: one per 450 m². */
const GROUND_COVER_OPEN = 0.02;
const GROUND_COVER_LAT = 320;
/**
 * Very Low and Low stop the cover here instead (`lightGeometryActive`). At 360 lines a
 * tuft past it is a single pixel that pops between two colours as the car moves, which
 * is noise, not ground; at Low's 900 it is a few pixels, and the cover was most of the
 * frame's triangles (render/retro.ts).
 */
const RETRO_GROUND_COVER_LAT = 140;
/** Nearest a tuft grows to the asphalt edge, metres: on the shoulder's sandy fringe. */
const GROUND_COVER_SETBACK_M = 2.5;
/** The verge band, metres from the asphalt edge. */
const VERGE_NEAR_M = GROUND_COVER_SETBACK_M;
const VERGE_FAR_M = 12;
/** Hash domain of the verge clumps, and their cell along the road per side, metres. */
const TAG_VERGE_COVER = 0x5645_5247; // 'VERG'
const VERGE_CELL_M = 6;
/**
 * Chance a cell holds a clump, on dry ground and at full runoff. With four plants a
 * clump on average that is 5-6 times the open density across the band, measured as an
 * average over the runoff a road actually has (about 0.4).
 */
const VERGE_CLUMP_DRY = 0.08;
const VERGE_CLUMP_WET = 0.25;
/** Plants in one clump, and its radius range, metres. */
const VERGE_CLUMP_MIN = 2;
const VERGE_CLUMP_MAX = 6;
const VERGE_CLUMP_RADIUS: readonly [number, number] = [1.1, 2.6];
/** Clear sand kept round a lay-by's asphalt by rocks and tufts alike, metres. */
const LAYBY_CLEAR_M = 2;

/**
 * How much of the road's water reaches a verge point, 0..1: the more the ground there
 * lies below the asphalt's edge, and the more this side's edge lies below the other's
 * (the camber sheds the whole road to it), the more. A cutting's verge, standing above
 * the road, gets none of it.
 */
function vergeRunoff(ctx: ChunkContext, s: number, side: number, lateral: number): number {
  const edge = ctx.terrain.roadEdgeHeight(s, side);
  const p = ctx.road.offsetPoint(s, lateral);
  const below = edge - ctx.terrain.explorationHeightFromFrame(p.x, p.z, lateral, s);
  const shed = ctx.terrain.roadEdgeHeight(s, -side) - edge;
  const fall = Math.min(1, Math.max(0, (below - 0.25) / 0.95));
  const camber = Math.min(1, Math.max(0, (shed - 0.02) / 0.13));
  return Math.min(1, 0.75 * fall * fall * (3 - 2 * fall) + 0.4 * camber);
}
/**
 * Hit radius as a share of the form's placed radius: a tuft's blades splay past the
 * part a bumper would actually flatten.
 */
const GROUND_COVER_HIT_SHARE = 0.7;

/**
 * Identity of a scatter cell, packed into one integer so it can live in a save's
 * number array exactly like `lootedPois` does.
 *
 * `cl` spans a couple of hundred either side of nothing, so it is biased into the low
 * byte and `cs` — which reaches seven million over a forty-thousand-kilometre road —
 * takes the rest. The product stays far inside the exact-integer range of a double.
 */
export function propCellId(cs: number, cl: number): number {
  return cs * 512 + (cl + 256);
}

interface ScatterPlacement {
  form: PropForm;
  /** Stable prop identity; only meaningful for a form that can break. */
  id: number;
  x: number;
  y: number;
  z: number;
  rx: number;
  ry: number;
  rz: number;
  scale: number;
  radius: number;
  /** Filled in by the instancing pass, so a break can blank the right instance. */
  mesh: THREE.InstancedMesh | null;
  instance: number;
  /** The ground under the prop (its origin is sunk below it). */
  groundY: number;
}

type Rot = { x: number; y: number; z: number; w: number };

export function yawRotation(yaw: number): Rot {
  return { x: 0, y: Math.sin(yaw * 0.5), z: 0, w: Math.cos(yaw * 0.5) };
}

export function leanRotation(angle: number, az: number): Rot {
  _q1.setFromAxisAngle(_axis.set(Math.cos(az), 0, -Math.sin(az)), angle);
  return { x: _q1.x, y: _q1.y, z: _q1.z, w: _q1.w };
}

function eulerRotation(rx: number, ry: number, rz: number): Rot {
  _q1.setFromEuler(_euler.set(rx, ry, rz));
  return { x: _q1.x, y: _q1.y, z: _q1.z, w: _q1.w };
}

/**
 * Builds a convex collider from the same local-space vertices as the visible rock.
 * The scratch buffer is safe to reuse because `addStatic` creates the Rapier shape
 * synchronously before the next placement is visited.
 */
function scaledHull(geometry: THREE.BufferGeometry, scale: number): RAPIER.ColliderDesc {
  const position = geometry.getAttribute('position');
  const length = position.count * 3;
  if (_hullPoints.length !== length) _hullPoints = new Float32Array(length);
  for (let i = 0; i < position.count; i++) {
    const j = i * 3;
    _hullPoints[j] = position.getX(i) * scale;
    _hullPoints[j + 1] = position.getY(i) * scale;
    _hullPoints[j + 2] = position.getZ(i) * scale;
  }
  const desc = RAPIER.ColliderDesc.convexHull(_hullPoints);
  if (!desc) throw new Error('Rock geometry did not produce a convex hull collider');
  return desc;
}

/**
 * Creates a static collider (own fixed body) and registers its surface.
 *
 * The one choke point for every scatter, pole and monument collider. Every caller
 * passes an ABSOLUTE position (the road/terrain sample it was placed from); the
 * origin subtraction happens here, once, so no caller can forget it and Rapier
 * never holds an f32 quantised by an absolute coordinate.
 *
 * Returns a DISABLED collider: `ChunkStreamer.attachContent` switches on everything
 * in `ChunkContent.colliders` when the contribution lands. Poles and monuments were
 * silently non-solid for exactly as long as that was each provider's own job.
 */
export function addStatic(
  ctx: ChunkContext,
  bodies: RAPIER.RigidBody[],
  colliders: RAPIER.Collider[],
  x: number,
  y: number,
  z: number,
  desc: RAPIER.ColliderDesc,
  surface: SurfaceType,
  rot?: Rot,
): RAPIER.Collider {
  const body = ctx.physics.world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(x - ctx.originX, y, z - ctx.originZ),
  );
  if (rot) desc.setRotation(rot);
  const collider = ctx.physics.world.createCollider(desc, body);
  collider.setEnabled(false);
  ctx.physics.surfaces.register(collider.handle, surface);
  bodies.push(body);
  colliders.push(collider);
  return collider;
}

export class ScatterProvider implements ChunkProvider {
  readonly id = 'scatter';

  /**
   * Whoever owns knocking props down, or nothing. Optional because deterministic
   * scatter remains a complete visual field without mutable breakage state.
   */
  constructor(
    private readonly breakables?: BreakableSink,
    private readonly groundCover?: GroundCoverField,
  ) {
    const forms = [...sandForms(), ...rockForms()];
    for (const form of forms) propPieces(form.id);
  }

  build(ctx: ChunkContext): ChunkContent {
    const iterator = this.buildSteps(ctx);
    let result = iterator.next();
    while (!result.done) result = iterator.next();
    return result.value;
  }

  *buildSteps(ctx: ChunkContext): Iterator<void, ChunkContent> {
    let completed = false;
    const group = new THREE.Group();
    const bodies: RAPIER.RigidBody[] = [];
    const colliders: RAPIER.Collider[] = [];
    const slots: BatchSlot[] = [];
    const placements: ScatterPlacement[] = [];
    const registered: number[] = [];
    let coverHandle: GroundCoverHandle | null = null;

    try {
    const seed = ctx.world.seed;
    const ox = ctx.originX;
    const oz = ctx.originZ;
    const cellSStart = Math.floor(ctx.sStart / CELL_S);
    const cellSEnd = Math.floor(ctx.sEnd / CELL_S);
    const cellLMax = Math.ceil(MAX_LAT / CELL_L) + 1;
    let occupancyCells = 0;
    const mesas = mesaFieldOf(ctx.road, ctx.terrain);

    for (let cs = cellSStart; cs <= cellSEnd; cs++) {
      const centreS = (cs + 0.5) * CELL_S;
      if (centreS < ctx.sStart || centreS >= ctx.sEnd) continue;
      for (let cl = -cellLMax; cl <= cellLMax; cl++) {
        cell: {
          // CHEAPEST TEST FIRST, and that ordering is the whole reason this can afford
          // to sweep 600 m either side. The occupancy roll is one hash; the terrain
          // samples below are hundreds of times more expensive. Rolling first throws
          // away nine cells in ten before either is touched.
          const roll = hash01(seed, TAG_SCATTER, cs, cl);
          if (roll >= ROCK_DENSITY) break cell;

          const centreL = (cl + 0.5) * CELL_L;
          if (Math.abs(centreL) < MIN_LAT) break cell;

          // Jitter within the cell, then re-check the corridor/max bounds.
          const s = centreS + (hash01(seed, TAG_SCATTER, cs, cl, 1) - 0.5) * CELL_S;
          const lateral = centreL + (hash01(seed, TAG_SCATTER, cs, cl, 2) - 0.5) * CELL_L;
          const absLateral = Math.abs(lateral);
          if (absLateral < MIN_LAT || absLateral > MAX_LAT) break cell;
          // The exact near edge, now that `s` is known. `MIN_LAT` above is the cheap
          // narrow-road filter; this is the one that keeps a prop off a widened verge,
          // and it costs three hashes rather than a road projection.
          if (absLateral < ctx.road.halfWidthAt(s) + SCATTER_SETBACK_M) break cell;
          // Nor on a lay-by's pad or its slips (world/layby.ts).
          if (laybyKeepsClear(seed, s, lateral, ctx.road.halfWidthAt(s), LAYBY_CLEAR_M)) break cell;

          // Thin out towards the far edge so the scatter ends in a fringe rather than a
          // fence line. Still only arithmetic: no sampling yet.
          const t = Math.min(1, Math.max(0, (absLateral - FULL_LAT) / (MAX_LAT - FULL_LAT)));
          const fade = 1 - t * t * (3 - 2 * t);
          if (roll >= ROCK_DENSITY * fade) break cell;

          const p = ctx.road.offsetPoint(s, lateral);
          // Not inside a mesa's footprint (world/mesas.ts): that ground is rock wall.
          if (mesas.blocks(p.x, p.z, MESA_SCATTER_CLEARANCE_M)) break cell;
          // From the FRAME, not by projection: this cell was generated from (s, lateral),
          // so `surfaceAt`'s road search would spend 5 us rediscovering what the loop
          // counter already knows.
          const surface = ctx.terrain.surfaceFromFrame(p.x, p.z, lateral, s);

          // Correlation: cacti and scrub on sand, rocks concentrated on rock outcrops.
          let forms: PropForm[];
          let density: number;
          if (surface === SurfaceType.Rock) {
            forms = rockForms();
            density = ROCK_DENSITY;
          } else if (surface === SurfaceType.Sand) {
            forms = sandForms();
            density = CACTUS_DENSITY;
          } else {
            break cell;
          }
          if (roll >= density * fade) break cell;

          const form = pickDesertForm(forms, hash01(seed, TAG_SCATTER, cs, cl, 3));

          // A prop already knocked down stays down. Same guard `lootedPois` is for a
          // looted stop: the chunk is rebuilt every time it crosses the physics radius,
          // and without this every rebuild would stand the cactus back up.
          const id = propCellId(cs, cl);
          if (propPieces(form.id) && this.breakables?.isBroken(id)) break cell;

          const scale = form.minScale + hash01(seed, TAG_SCATTER, cs, cl, 4) * (form.maxScale - form.minScale);
          const radius = form.baseRadius * scale;

          const ry = hash01(seed, TAG_SCATTER, cs, cl, 5) * Math.PI * 2;
          const rx = form.rotate3d ? hash01(seed, TAG_SCATTER, cs, cl, 6) * Math.PI * 2 : 0;
          const rz = form.rotate3d ? hash01(seed, TAG_SCATTER, cs, cl, 7) * Math.PI * 2 : 0;

          // The player-centred fine lattice samples this exact world-space field. The
          // road frame is already known here, so no nearest-road search is needed.
          const groundY = ctx.terrain.explorationHeightFromFrame(p.x, p.z, lateral, s);
          placements.push({
            form,
            id,
            x: p.x,
            y: groundY - radius * form.sink,
            z: p.z,
            rx,
            ry,
            rz,
            scale,
            radius,
            mesh: null,
            instance: 0,
            groundY,
          });
        }
        if (++occupancyCells >= 8) {
          occupancyCells = 0;
          yield;
        }
      }
      if (occupancyCells > 0) {
        occupancyCells = 0;
        yield;
      }
    }

    // Ground cover: never in `placements` (no collider, no debris pieces),
    // so the physics pass below never walks it. The car bursts it through
    // `GroundCoverField` instead.
    const cover: ScatterPlacement[] = [];
    if (ctx.hasPhysics && groundCoverActive()) {
      const covers = groundCoverForms();
      // One plant, from its own rolls: the same keep-clears as the scatter (no tufts
      // through a lay-by), and none on rock.
      const place = (s: number, lateral: number, id: number, formRoll: number, scaleRoll: number, yaw: number): void => {
        if (laybyKeepsClear(seed, s, lateral, ctx.road.halfWidthAt(s), LAYBY_CLEAR_M)) return;
        const p = ctx.road.offsetPoint(s, lateral);
        if (mesas.blocks(p.x, p.z, MESA_SCATTER_CLEARANCE_M)) return;
        if (ctx.terrain.surfaceFromFrame(p.x, p.z, lateral, s) === SurfaceType.Rock) return;
        const form = pickDesertForm(covers, formRoll);
        const scale = form.minScale + scaleRoll * (form.maxScale - form.minScale);
        const radius = form.baseRadius * scale;
        const groundY = ctx.terrain.explorationHeightFromFrame(p.x, p.z, lateral, s);
        cover.push({
          form,
          id,
          x: p.x,
          y: groundY - radius * form.sink,
          z: p.z,
          rx: 0,
          ry: yaw,
          rz: 0,
          scale,
          radius,
          mesh: null,
          instance: 0,
          groundY,
        });
      };
      const coverSStart = Math.floor(ctx.sStart / GROUND_COVER_CELL);
      const coverSEnd = Math.ceil(ctx.sEnd / GROUND_COVER_CELL);
      const coverLMax = Math.ceil(
        (lightGeometryActive() ? RETRO_GROUND_COVER_LAT : GROUND_COVER_LAT) / GROUND_COVER_CELL,
      );
      for (let cs = coverSStart; cs < coverSEnd; cs++) {
        for (let cl = -coverLMax; cl < coverLMax; cl++) {
          const roll = hash01(seed, TAG_GROUND_COVER, cs, cl);
          if (roll >= GROUND_COVER_OPEN) continue;
          const id = propCellId(cs, cl);
          if (this.groundCover?.isBroken(id)) continue;
          const s = (cs + hash01(seed, TAG_GROUND_COVER, cs, cl, 1)) * GROUND_COVER_CELL;
          if (s < ctx.sStart || s >= ctx.sEnd) continue;
          const lateral = (cl + hash01(seed, TAG_GROUND_COVER, cs, cl, 2)) * GROUND_COVER_CELL;
          if (Math.abs(lateral) - ctx.road.halfWidthAt(s) < GROUND_COVER_SETBACK_M) continue;
          // Cover comes and goes in long stretches along the road: `groundCoverDensity`
          // is 1 where today's field stands, 0 on bare ground and a share between. The
          // SAME roll is tested again against the thinned density, so a prop that
          // survives a sparse stretch is one of the props that was already there, in the
          // place it was — the thinning only takes candidates away, it never moves one.
          if (roll >= GROUND_COVER_OPEN * groundCoverDensity(s, seed)) continue;
          place(
            s,
            lateral,
            id,
            hash01(seed, TAG_GROUND_COVER, cs, cl, 3),
            hash01(seed, TAG_GROUND_COVER, cs, cl, 4),
            hash01(seed, TAG_GROUND_COVER, cs, cl, 5) * Math.PI * 2,
          );
        }
        if ((cs & 3) === 3) yield;
      }

      // The verge's clumps, one candidate per cell and side. A clump belongs to the
      // chunk its centre is in; its plants may stand a couple of metres past that chunk's
      // end, which is harmless — they are placed in absolute coordinates. Ids are
      // negative, clear of every `propCellId`, and a pure function of (cell, side, plant).
      const vergeStart = Math.floor(ctx.sStart / VERGE_CELL_M);
      const vergeEnd = Math.ceil(ctx.sEnd / VERGE_CELL_M);
      for (let side = -1; side <= 1; side += 2) {
        const sideIndex = side < 0 ? 0 : 1;
        for (let vc = vergeStart; vc < vergeEnd; vc++) {
          const roll = hash01(seed, TAG_VERGE_COVER, vc, sideIndex);
          if (roll >= VERGE_CLUMP_WET) continue;
          const s = (vc + hash01(seed, TAG_VERGE_COVER, vc, sideIndex, 1)) * VERGE_CELL_M;
          if (s < ctx.sStart || s >= ctx.sEnd) continue;
          const radius =
            VERGE_CLUMP_RADIUS[0] + (VERGE_CLUMP_RADIUS[1] - VERGE_CLUMP_RADIUS[0]) * hash01(seed, TAG_VERGE_COVER, vc, sideIndex, 3);
          const out = VERGE_NEAR_M + (VERGE_FAR_M - VERGE_NEAR_M) * hash01(seed, TAG_VERGE_COVER, vc, sideIndex, 2);
          const centre = side * (ctx.road.halfWidthAt(s) + out);
          const chance = VERGE_CLUMP_DRY + (VERGE_CLUMP_WET - VERGE_CLUMP_DRY) * vergeRunoff(ctx, s, side, centre);
          // The same roll against the thinned chance, as the open cover above.
          if (roll >= chance * groundCoverDensity(s, seed)) continue;
          const count =
            VERGE_CLUMP_MIN +
            Math.floor(hash01(seed, TAG_VERGE_COVER, vc, sideIndex, 4) * (VERGE_CLUMP_MAX - VERGE_CLUMP_MIN + 1));
          for (let k = 0; k < count; k++) {
            const id = -1 - ((vc * 2 + sideIndex) * VERGE_CLUMP_MAX + k);
            if (this.groundCover?.isBroken(id)) continue;
            const angle = hash01(seed, TAG_VERGE_COVER, vc, sideIndex, 10 + k) * Math.PI * 2;
            const reach = radius * Math.sqrt(hash01(seed, TAG_VERGE_COVER, vc, sideIndex, 20 + k));
            const ps = s + Math.cos(angle) * reach;
            const lateral = centre + Math.sin(angle) * reach;
            const past = side * lateral - ctx.road.halfWidthAt(ps);
            if (past < VERGE_NEAR_M || past > VERGE_FAR_M + VERGE_CLUMP_RADIUS[1]) continue;
            place(
              ps,
              lateral,
              id,
              hash01(seed, TAG_VERGE_COVER, vc, sideIndex, 30 + k),
              hash01(seed, TAG_VERGE_COVER, vc, sideIndex, 40 + k),
              hash01(seed, TAG_VERGE_COVER, vc, sideIndex, 50 + k) * Math.PI * 2,
            );
          }
          if ((vc & 7) === 7) yield;
        }
      }
    }

    // One InstancedMesh per form per chunk. The form geometry/material is shared
    // across chunks; only the instance buffers are per-chunk.
    const byForm = new Map<PropForm, ScatterPlacement[]>();
    for (const pl of placements.concat(cover)) {
      let list = byForm.get(pl.form);
      if (!list) {
        list = [];
        byForm.set(pl.form, list);
      }
      list.push(pl);
    }
    for (const [form, list] of byForm) {
      const kind = { geometry: form.geometry, material: form.material, lod: form.lod };
      for (let i = 0; i < list.length; i++) {
        const pl = list[i]!;
        _dummy.position.set(pl.x - ox, pl.y, pl.z - oz);
        _dummy.rotation.set(pl.rx, pl.ry, pl.rz);
        _dummy.scale.setScalar(pl.scale);
        _dummy.updateMatrix();
        // Shared with other chunks of the band; culling is by slot, see instancebatch.ts.
        const slot = ctx.batches.allocate(ctx, kind, _dummy.matrix);
        pl.mesh = slot.mesh;
        pl.instance = slot.instance;
        slots.push(slot);
      }
      yield;
    }

    // A contact shadow under everything standing in the desert.
    const spots: ContactShadowSpot[] = [];
    for (const pl of placements) {
      spots.push({ x: pl.x - ox, groundY: pl.groundY, z: pl.z - oz, radius: pl.radius, height: pl.form.height * pl.scale });
    }
    // Shrubs too; a grass tuft or a rosette is too thin to shade the sand under it.
    // Each cover prop remembers its shadow so a burst blanks both.
    const coverShadow = new Int32Array(cover.length).fill(-1);
    for (let i = 0; i < cover.length; i++) {
      const pl = cover[i]!;
      if (pl.form.id !== 'bush') continue;
      coverShadow[i] = spots.length;
      spots.push({ x: pl.x - ox, groundY: pl.groundY, z: pl.z - oz, radius: pl.radius * 0.6, height: pl.form.height * pl.scale });
    }
    // Slots of the contact shadows, in `spots` order: a cover prop's shadow is its index.
    const shadowSlots = allocateContactShadows(spots, ctx.batches, ctx);
    slots.push(...shadowSlots);

    if (this.groundCover && cover.length > 0) {
      const coverSpots: GroundCoverSpot[] = [];
      for (let i = 0; i < cover.length; i++) {
        const pl = cover[i]!;
        if (!pl.mesh) continue;
        const shadowIndex = coverShadow[i];
        coverSpots.push({
          id: pl.id,
          x: pl.x,
          groundY: pl.groundY,
          z: pl.z,
          radius: pl.radius * GROUND_COVER_HIT_SHARE,
          mesh: pl.mesh,
          instance: pl.instance,
          shadow: shadowIndex >= 0 ? shadowSlots[shadowIndex]!.mesh : null,
          shadowInstance: shadowIndex >= 0 ? shadowSlots[shadowIndex]!.instance : -1,
        });
      }
      coverHandle = this.groundCover.add(coverSpots);
    }

    if (ctx.hasPhysics) {
      for (const pl of placements) {
        const form = pl.form;
        if (form.collider !== 'none' && !(form.collider === 'hull' && pl.radius < ROCK_COLLIDER_MIN)) {
          if (form.collider === 'hull') {
            addStatic(
              ctx,
              bodies,
              colliders,
              pl.x,
              pl.y,
              pl.z,
              scaledHull(form.geometry, pl.scale),
              SurfaceType.Rock,
              eulerRotation(pl.rx, pl.ry, pl.rz),
            );
          } else if (form.collider === 'box') {
            if (!form.colliderHalf) throw new Error(`Box collider extents missing for ${form.id}`);
            const [hx, hy, hz] = form.colliderHalf;
            addStatic(
              ctx,
              bodies,
              colliders,
              pl.x,
              pl.y + hy * pl.scale,
              pl.z,
              RAPIER.ColliderDesc.cuboid(hx * pl.scale, hy * pl.scale, hz * pl.scale),
              SurfaceType.Rock,
              yawRotation(pl.ry),
            );
          } else {
            const halfHeight = form.height * pl.scale * 0.42;
            const rad = form.baseRadius * pl.scale * 0.8;
            const collider = addStatic(
              ctx,
              bodies,
              colliders,
              pl.x,
              pl.y + halfHeight,
              pl.z,
              RAPIER.ColliderDesc.capsule(halfHeight, rad),
              SurfaceType.Rock,
            );
            const pieces = propPieces(form.id);
            if (pieces && this.breakables && pl.mesh) {
              registered.push(pl.id);
              this.breakables.register({
                id: pl.id,
                pieces,
                x: pl.x,
                y: pl.y,
                z: pl.z,
                yaw: pl.ry,
                scale: pl.scale,
                radius: rad,
                height: form.height * pl.scale,
                mesh: pl.mesh,
                instance: pl.instance,
                collider,
              });
            }
          }
        }
        yield;
      }
    }

    // Colliders are created disabled and switched on by ChunkStreamer once this
    // contribution is attached, after every mesh and breakable registration exists
    // (see ChunkContent.colliders).
    completed = true;
    return {
      group,
      bodies,
      colliders,
      dispose: () => {
        if (registered.length > 0) this.breakables?.forget(registered);
        this.groundCover?.forget(coverHandle);
        for (const slot of slots) ctx.batches.release(slot);
      },
    };
  } finally {
    if (!completed) {
      for (const body of bodies) ctx.physics.removeBody(body);
      if (registered.length > 0) this.breakables?.forget(registered);
      this.groundCover?.forget(coverHandle);
      for (const slot of slots) ctx.batches.release(slot);
      group.clear();
    }
  }

}
}
