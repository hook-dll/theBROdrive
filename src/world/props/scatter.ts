/**
 * Roadside props, the scatter half: sparse desert scatter (cacti + rocks) and the
 * occasional hazards on the driving surface.
 *
 * Every prop is a pure function of the integer seed via stateless hashing, so a
 * chunk builds identically whether it is generated in order or revisited later.
 * Nothing here owns game state; chunk content is a derived view of the seed.
 *
 * Instancing is load-bearing for the scatter: the visible radius needs hundreds of
 * cacti and rocks, and one draw call per mesh is the only way that stays at frame
 * rate.
 */

import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { hash01 } from '../../core/rng';
import { SurfaceType } from '../../core/surfaces';
import { HazardIndex } from '../hazards';
import { ROAD_HALF_WIDTH } from '../road';
import type { ChunkContext, ChunkContent, ChunkProvider } from '../chunks';

import {
  pickDesertForm,
  propPieces,
  rockForms,
  sandForms,
  scrubForm,
  type BreakableSink,
  type PropForm,
} from './forms';

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
const TAG_ROAD_PILE = 0x6a5a41;
const TAG_ROAD_ROCK = 0x6a5a52;
/** Each independent stream varies every consecutive gap inside this exact range. */
const ROAD_HAZARD_KINDS = 0;
const ROAD_HAZARD_GAP_MIN = 1800;
const ROAD_HAZARD_GAP_MAX = 4200;
/**
 * Two complementary gaps fill one cycle. If the first is `d`, the second is
 * `min + max - d`, so both stay in range while any chunk can locate them directly.
 */
const ROAD_HAZARD_CYCLE = ROAD_HAZARD_GAP_MIN + ROAD_HAZARD_GAP_MAX;
/** Keep the homestead and the player's first few bends clear. */
const ROAD_HAZARD_START = 600;
const ROAD_HAZARD_EDGE_CLEARANCE = 0.15;
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
const ROCK_COLLIDER_MIN = 0.55; // pebbles under this radius (m) get no collider

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
  /** Road-frame coordinates for an asphalt obstacle; zero for ordinary scatter. */
  roadS: number;
  roadLateral: number;
  /** True only for the deterministic obstacle streams placed on asphalt. */
  roadHazard: boolean;
  radius: number;
  /** Filled in by the instancing pass, so a break can blank the right instance. */
  mesh: THREE.InstancedMesh | null;
  instance: number;
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
    private readonly hazards?: HazardIndex,
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
    const meshes: THREE.InstancedMesh[] = [];
    const hazardChunkKey = `scatter:${ctx.chunkIndex}`;
    const placements: ScatterPlacement[] = [];
    const registered: number[] = [];

    try {
    const seed = ctx.world.seed;
    const ox = ctx.originX;
    const oz = ctx.originZ;
    const cellSStart = Math.floor(ctx.sStart / CELL_S);
    const cellSEnd = Math.floor(ctx.sEnd / CELL_S);
    const cellLMax = Math.ceil(MAX_LAT / CELL_L) + 1;
    let occupancyCells = 0;

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

          // Thin out towards the far edge so the scatter ends in a fringe rather than a
          // fence line. Still only arithmetic: no sampling yet.
          const t = Math.min(1, Math.max(0, (absLateral - FULL_LAT) / (MAX_LAT - FULL_LAT)));
          const fade = 1 - t * t * (3 - 2 * t);
          if (roll >= ROCK_DENSITY * fade) break cell;

          const p = ctx.road.offsetPoint(s, lateral);
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
            roadS: 0,
            roadLateral: 0,
            radius,
            mesh: null,
            roadHazard: false,
            instance: 0,
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

    // Dirt piles, fallen trunks and solid rocks have independent deterministic
    // streams. Complementary gaps keep hazards irregular without walking every
    // previous placement to locate an arbitrary streamed chunk.
    // Countryside: none. Dirt piles and rocks lying on the asphalt were the desert's;
    // `ROAD_HAZARD_KINDS` = 2 brings both streams back.
    for (let kind = 0; kind < ROAD_HAZARD_KINDS; kind++) {
      const tag = kind === 0 ? TAG_ROAD_PILE : TAG_ROAD_ROCK;
      const streamStart =
        ROAD_HAZARD_START + hash01(seed, tag, 0x51a47) * ROAD_HAZARD_GAP_MAX;
      const cycleStart = Math.max(0, Math.floor((ctx.sStart - streamStart) / ROAD_HAZARD_CYCLE) - 1);
      const cycleEnd = Math.floor((ctx.sEnd - streamStart) / ROAD_HAZARD_CYCLE) + 1;

      for (let cycle = cycleStart; cycle <= cycleEnd; cycle++) {
        const firstGap =
          ROAD_HAZARD_GAP_MIN +
          hash01(seed, tag, cycle, 0) * (ROAD_HAZARD_GAP_MAX - ROAD_HAZARD_GAP_MIN);
        for (let ordinal = 0; ordinal < 2; ordinal++) {
          const s = streamStart + cycle * ROAD_HAZARD_CYCLE + (ordinal === 0 ? 0 : firstGap);
          if (s < ctx.sStart || s >= ctx.sEnd) continue;
          const candidate = cycle * 2 + ordinal;
          let form: PropForm;

          if (kind === 0) {
            // Road piles are low scrub and nothing else. A fallen trunk is desert
            // scenery now — it is still in `sandForms()` — and never spawns on the
            // carriageway: a log across a lane is the one piece of litter a driver
            // cannot read in time at speed.
            form = scrubForm();
          } else {
            const rocks = rockForms();
            form = rocks[Math.floor(hash01(seed, tag, candidate, 1) * rocks.length)]!;
          }

          const scaleRoll = hash01(seed, tag, candidate, 2);
          const scale = kind === 0 ? 0.9 + scaleRoll * 0.6 : 0.65 + scaleRoll * 0.7;
          const radius = form.baseRadius * scale;
          // Across whatever asphalt there is here: a widened stretch gets its holes
          // and rubble over both lanes, not only over the inner one.
          const asphaltHalf = ctx.road.halfWidthAt(s);
          const lateralReach = Math.max(0, asphaltHalf - radius - ROAD_HAZARD_EDGE_CLEARANCE);
          const lateral = (hash01(seed, tag, candidate, 3) * 2 - 1) * lateralReach;
          const p = ctx.road.offsetPoint(s, lateral);
          const ry = hash01(seed, tag, candidate, 4) * Math.PI * 2;
          const rx = form.rotate3d ? hash01(seed, tag, candidate, 5) * Math.PI * 2 : 0;
          const rz = form.rotate3d ? hash01(seed, tag, candidate, 6) * Math.PI * 2 : 0;
          // Even/odd negative ids keep the two streams disjoint from each other and
          // from every positive desert-cell id.
          const id = -1 - candidate * 2 - kind;
          if (propPieces(form.id) && this.breakables?.isBroken(id)) continue;
          const groundY = ctx.terrain.heightFromFrame(p.x, p.z, lateral, s);
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
            roadS: s,
            roadLateral: lateral,
            radius,
            roadHazard: true,
            mesh: null,
            instance: 0,
          });
        }
      }
      yield;
    }

    // One InstancedMesh per form per chunk. The form geometry/material is shared
    // across chunks; only the instance buffers are per-chunk.
    const byForm = new Map<PropForm, ScatterPlacement[]>();
    for (const pl of placements) {
      let list = byForm.get(pl.form);
      if (!list) {
        list = [];
        byForm.set(pl.form, list);
      }
      list.push(pl);
    }
    for (const [form, list] of byForm) {
      const mesh = new THREE.InstancedMesh(form.geometry, form.material, list.length);
      for (let i = 0; i < list.length; i++) {
        const pl = list[i]!;
        _dummy.position.set(pl.x - ox, pl.y, pl.z - oz);
        _dummy.rotation.set(pl.rx, pl.ry, pl.rz);
        _dummy.scale.setScalar(pl.scale);
        _dummy.updateMatrix();
        mesh.setMatrixAt(i, _dummy.matrix);
        pl.mesh = mesh;
        pl.instance = i;
      }
      mesh.instanceMatrix.needsUpdate = true;
      // Culled on the bounds of its INSTANCES, which three computes over every instance
      // matrix — not on the form's own geometry sphere, which sits at the mesh origin
      // and would pop a whole chunk's scatter out while half of it was still on screen.
      // Computed here, once, at full scale: the only later writes are a break's zero-
      // scale blank, which only ever shrinks what the sphere has to hold. A rebase moves
      // the chunk GROUP, and the sphere is local to it, so it never needs redoing.
      mesh.computeBoundingSphere();
      group.add(mesh);
      meshes.push(mesh);
      yield;
    }

    if (ctx.hasPhysics) {
      for (const pl of placements) {
        const form = pl.form;
        let hazardRadius = 0;
        let breakable = false;
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
            // The hull is constructed from these vertices, so its scaled bounding sphere
            // is a conservative radius of the collision shape, not a placement guess.
            form.geometry.computeBoundingSphere();
            hazardRadius = (form.geometry.boundingSphere?.radius ?? 0) * pl.scale;
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
            hazardRadius = Math.hypot(hx, hz) * pl.scale;
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
            hazardRadius = rad;
            const pieces = propPieces(form.id);
            breakable = pieces !== null;
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
        if (pl.roadHazard && hazardRadius > 0) {
          this.hazards?.add(hazardChunkKey, {
            s: pl.roadS,
            lateral: pl.roadLateral,
            radius: hazardRadius,
            breakable,
          });
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
        for (const m of meshes) m.dispose();
        if (registered.length > 0) this.breakables?.forget(registered);
        this.hazards?.forget(hazardChunkKey);
      },
    };
  } finally {
    if (!completed) {
      for (const body of bodies) ctx.physics.removeBody(body);
      for (const m of meshes) m.dispose();
      if (registered.length > 0) this.breakables?.forget(registered);
      this.hazards?.forget(hazardChunkKey);
      group.clear();
    }
  }

}
}
