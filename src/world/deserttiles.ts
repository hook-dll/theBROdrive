import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';

import type { PhysicsWorld } from '../core/physics';
import { SurfaceType } from '../core/surfaces';
import { hash01 } from '../core/rng';
import { desertPaletteAt } from './gradient';
import type { WorldOrigin } from './origin';
import {
  desertPropForms,
  propPieces,
  type BreakableSink,
  type DesertPropForm,
} from './props';
import type { Road } from './road';
import type { RoadDistance } from './roaddistance';
import { CORRIDOR_OUTER, type Terrain } from './terrain';
import { TERRAIN_COLLIDER_SURFACE, TERRAIN_MATERIAL } from './terrainmesh';

/**
 * Player-centred open desert.
 *
 * Unlike road chunks, tiles are keyed only by absolute X/Z. Their geometry is therefore
 * a pure function of (seed, tileX, tileZ), may be discarded at any time, and rebuilds
 * identically when the player returns. The theoretical size of the desert never enters
 * the memory or draw budget: five by five visual tiles and three by three physical tiles
 * are the complete live set.
 *
 * Invariants:
 *  - neighbouring tiles sample the same absolute edge coordinates, so render and
 *    heightfield seams are bit-identical;
 *  - every rendered/physical coordinate is relative to WorldOrigin before it reaches f32;
 *  - the current tile is always physical, even after a teleport; ordinary prefetch work
 *    is capped at one tile operation per rendered frame;
 *  - all close terrain is one uniform fine lattice. There is no coarse driveable ring;
 *    the camera-centred vista owns everything beyond the fine visual square.
 */

export const DESERT_TILE_SIZE = 240;
export const DESERT_TILE_CELLS = 80;
const TILE_VERTS = DESERT_TILE_CELLS + 1;
const TILE_STEP = DESERT_TILE_SIZE / DESERT_TILE_CELLS;
const VISUAL_RADIUS = 2;
const PHYSICS_RADIUS = 1;
const DIST_LATTICE = 20;
const EXACT_DISTANCE_GATE = CORRIDOR_OUTER + DIST_LATTICE * 2;
const FULL_RELIEF_DISTANCE = 200;
/** Past this player-to-road distance no live tile can intersect the corridor. */
const ROAD_QUERY_CUTOFF = 900;
const PROP_TAG = 0x44535254;
const MAX_TILE_PROPS = 5;
const TILE_PROP_ID_BASE = 1_000_000;
const ROCK_COLLIDER_MIN = 0.55;
const instanceScratch = new THREE.Object3D();
let hullPoints = new Float32Array(0);

interface DesertPropPlacement {
  readonly form: DesertPropForm;
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly rx: number;
  readonly ry: number;
  readonly rz: number;
  readonly scale: number;
  readonly radius: number;
  mesh: THREE.InstancedMesh | null;
  instance: number;
}

interface DesertTile {
  readonly tx: number;
  readonly tz: number;
  readonly key: string;
  readonly centreX: number;
  readonly centreZ: number;
  readonly group: THREE.Group;
  readonly geometry: THREE.BufferGeometry;
  readonly meshes: readonly THREE.InstancedMesh[];
  readonly heights: Float32Array;
  readonly props: readonly DesertPropPlacement[];
  readonly registered: number[];
  bodies: RAPIER.RigidBody[];
  hasPhysics: boolean;
}

function tileKey(tx: number, tz: number): string {
  return `${tx},${tz}`;
}

function smoothstep01(value: number): number {
  const t = value < 0 ? 0 : value > 1 ? 1 : value;
  return t * t * (3 - 2 * t);
}

/** Bilinear height on the tile's exact regular lattice. */
function heightFromTile(heights: Float32Array, localX: number, localZ: number): number {
  const fx = Math.min(DESERT_TILE_CELLS, Math.max(0, localX / TILE_STEP));
  const fz = Math.min(DESERT_TILE_CELLS, Math.max(0, localZ / TILE_STEP));
  const ix = Math.min(DESERT_TILE_CELLS - 1, Math.floor(fx));
  const iz = Math.min(DESERT_TILE_CELLS - 1, Math.floor(fz));
  const tx = fx - ix;
  const tz = fz - iz;
  const a = heights[ix * TILE_VERTS + iz]!;
  const b = heights[(ix + 1) * TILE_VERTS + iz]!;
  const c = heights[ix * TILE_VERTS + iz + 1]!;
  const d = heights[(ix + 1) * TILE_VERTS + iz + 1]!;
  return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
}
/**
 * Unique persisted id for practical world coordinates. At 240 m per tile this remains
 * an exact integer for billions of kilometres in either direction.
 */
function tilePropId(tx: number, tz: number, index: number): number {
  const x = tx >= 0 ? tx * 2 : -tx * 2 - 1;
  const z = tz >= 0 ? tz * 2 : -tz * 2 - 1;
  const pair = x >= z ? x * x + x + z : z * z + x;
  return -TILE_PROP_ID_BASE - pair * MAX_TILE_PROPS - index;
}


export class DesertTileStreamer {
  private readonly tiles = new Map<string, DesertTile>();
  private buildFrame = -1;
  private lastX = Number.NaN;
  private lastZ = Number.NaN;
  private farFromRoad = false;

  constructor(
    private readonly seed: number,
    private readonly road: Road,
    private readonly terrain: Terrain,
    private readonly roadDistance: RoadDistance,
    private readonly physics: PhysicsWorld,
    private readonly scene: THREE.Scene,
    private readonly origin: WorldOrigin,
    private readonly breakables?: BreakableSink,
  ) {}

  /**
   * Establishes solid ground before the loading cover leaves. Nine tiles are the only
   * synchronous batch in normal play; later crossings are prefetched one operation per
   * frame. A save may start anywhere in the desert, so road collision cannot substitute
   * for this initial patch.
   */
  prime(x: number, z: number, roadLateral: number): void {
    this.farFromRoad = Math.abs(roadLateral) >= ROAD_QUERY_CUTOFF;
    const centreTx = Math.floor(x / DESERT_TILE_SIZE);
    const centreTz = Math.floor(z / DESERT_TILE_SIZE);
    for (let dz = -PHYSICS_RADIUS; dz <= PHYSICS_RADIUS; dz++) {
      for (let dx = -PHYSICS_RADIUS; dx <= PHYSICS_RADIUS; dx++) {
        this.build(centreTx + dx, centreTz + dz, true);
      }
    }
    this.lastX = x;
    this.lastZ = z;
  }

  /** One bounded streaming operation per rendered frame, except emergency current-tile fill. */
  update(x: number, z: number, roadLateral: number, frameId: number): void {
    this.farFromRoad = Math.abs(roadLateral) >= ROAD_QUERY_CUTOFF;
    const centreTx = Math.floor(x / DESERT_TILE_SIZE);
    const centreTz = Math.floor(z / DESERT_TILE_SIZE);
    const currentKey = tileKey(centreTx, centreTz);

    // Teleports and extreme stalls may outrun prefetch. Ground under the player is an
    // invariant, so this one operation is allowed to bypass the ordinary frame budget.
    const current = this.tiles.get(currentKey);
    if (!current) this.build(centreTx, centreTz, true);
    else if (!current.hasPhysics) this.promote(current);

    for (const [key, tile] of this.tiles) {
      const dx = Math.abs(tile.tx - centreTx);
      const dz = Math.abs(tile.tz - centreTz);
      if (dx > VISUAL_RADIUS || dz > VISUAL_RADIUS) {
        this.teardown(tile);
        this.tiles.delete(key);
      } else if (tile.hasPhysics && (dx > PHYSICS_RADIUS || dz > PHYSICS_RADIUS)) {
        this.demote(tile);
      }
    }

    if (frameId === this.buildFrame) {
      this.lastX = x;
      this.lastZ = z;
      return;
    }
    this.buildFrame = frameId;

    const moveX = Number.isFinite(this.lastX) ? x - this.lastX : 0;
    const moveZ = Number.isFinite(this.lastZ) ? z - this.lastZ : 0;
    const moveLength = Math.hypot(moveX, moveZ);
    const dirX = moveLength > 1e-6 ? moveX / moveLength : 0;
    const dirZ = moveLength > 1e-6 ? moveZ / moveLength : 0;

    const work: { tx: number; tz: number; physics: boolean; score: number; tile?: DesertTile }[] = [];
    for (let dz = -VISUAL_RADIUS; dz <= VISUAL_RADIUS; dz++) {
      for (let dx = -VISUAL_RADIUS; dx <= VISUAL_RADIUS; dx++) {
        const tx = centreTx + dx;
        const tz = centreTz + dz;
        const key = tileKey(tx, tz);
        const tile = this.tiles.get(key);
        const needsPhysics = Math.abs(dx) <= PHYSICS_RADIUS && Math.abs(dz) <= PHYSICS_RADIUS;
        if (tile && (!needsPhysics || tile.hasPhysics)) continue;
        // Physics first, then nearest, with movement direction breaking equal-distance
        // ties so the row in front of a fast vehicle becomes solid before the rear row.
        const ahead = dx * dirX + dz * dirZ;
        const score = (needsPhysics ? -100 : 0) + dx * dx + dz * dz - ahead * 0.1;
        work.push({ tx, tz, physics: needsPhysics, score, tile });
      }
    }
    work.sort((a, b) => a.score - b.score);
    const next = work[0];
    if (next?.tile) this.promote(next.tile);
    else if (next) this.build(next.tx, next.tz, next.physics);

    this.lastX = x;
    this.lastZ = z;
  }

  /** Re-express visual groups after PhysicsWorld has shifted every rigid body. */
  rebase(): void {
    for (const tile of this.tiles.values()) {
      tile.group.position.x = tile.centreX - this.origin.x;
      tile.group.position.z = tile.centreZ - this.origin.z;
    }
  }

  get visualTileCount(): number {
    return this.tiles.size;
  }

  get physicsTileCount(): number {
    let count = 0;
    for (const tile of this.tiles.values()) if (tile.hasPhysics) count++;
    return count;
  }

  /** Drawn/collided lattice height for diagnostics and ground-aware streamed content. */
  heightAt(x: number, z: number): number | null {
    const tx = Math.floor(x / DESERT_TILE_SIZE);
    const tz = Math.floor(z / DESERT_TILE_SIZE);
    const tile = this.tiles.get(tileKey(tx, tz));
    if (!tile) return null;
    return heightFromTile(
      tile.heights,
      x - tx * DESERT_TILE_SIZE,
      z - tz * DESERT_TILE_SIZE,
    );
  }

  hasPhysicsAt(x: number, z: number): boolean {
    return this.tiles.get(tileKey(Math.floor(x / DESERT_TILE_SIZE), Math.floor(z / DESERT_TILE_SIZE)))?.hasPhysics ?? false;
  }

  private build(tx: number, tz: number, withPhysics: boolean): void {
    const key = tileKey(tx, tz);
    const existing = this.tiles.get(key);
    if (existing) {
      if (withPhysics && !existing.hasPhysics) this.promote(existing);
      return;
    }

    const centreX = (tx + 0.5) * DESERT_TILE_SIZE;
    const centreZ = (tz + 0.5) * DESERT_TILE_SIZE;
    const startX = tx * DESERT_TILE_SIZE;
    const startZ = tz * DESERT_TILE_SIZE;
    const vertexCount = TILE_VERTS * TILE_VERTS;
    const heights = new Float32Array(vertexCount);
    const positions = new Float32Array(vertexCount * 3);
    const normals = new Float32Array(vertexCount * 3);
    const colors = new Float32Array(vertexCount * 3);
    const paletteDistance = this.farFromRoad
      ? Math.abs(centreZ)
      : this.roadDistance.ownerAt(centreX, centreZ, DIST_LATTICE);
    const palette = new THREE.Color(desertPaletteAt(paletteDistance).sand);

    for (let ix = 0; ix < TILE_VERTS; ix++) {
      const worldX = startX + ix * TILE_STEP;
      for (let iz = 0; iz < TILE_VERTS; iz++) {
        const worldZ = startZ + iz * TILE_STEP;
        const vi = ix * TILE_VERTS + iz;
        const y = this.groundHeight(worldX, worldZ);
        heights[vi] = y;
        positions[vi * 3] = worldX - centreX;
        positions[vi * 3 + 1] = y;
        positions[vi * 3 + 2] = worldZ - centreZ;
        colors[vi * 3] = palette.r;
        colors[vi * 3 + 1] = palette.g;
        colors[vi * 3 + 2] = palette.b;
      }
    }

    for (let ix = 0; ix < TILE_VERTS; ix++) {
      const x0 = Math.max(0, ix - 1);
      const x1 = Math.min(DESERT_TILE_CELLS, ix + 1);
      for (let iz = 0; iz < TILE_VERTS; iz++) {
        const z0 = Math.max(0, iz - 1);
        const z1 = Math.min(DESERT_TILE_CELLS, iz + 1);
        const dhx =
          (heights[x1 * TILE_VERTS + iz]! - heights[x0 * TILE_VERTS + iz]!) /
          ((x1 - x0) * TILE_STEP);
        const dhz =
          (heights[ix * TILE_VERTS + z1]! - heights[ix * TILE_VERTS + z0]!) /
          ((z1 - z0) * TILE_STEP);
        const length = Math.hypot(dhx, 1, dhz);
        const ni = (ix * TILE_VERTS + iz) * 3;
        normals[ni] = -dhx / length;
        normals[ni + 1] = 1 / length;
        normals[ni + 2] = -dhz / length;
      }
    }

    const indices = new Uint32Array(DESERT_TILE_CELLS * DESERT_TILE_CELLS * 6);
    let io = 0;
    for (let ix = 0; ix < DESERT_TILE_CELLS; ix++) {
      for (let iz = 0; iz < DESERT_TILE_CELLS; iz++) {
        const a = ix * TILE_VERTS + iz;
        const b = (ix + 1) * TILE_VERTS + iz;
        const c = a + 1;
        const d = b + 1;
        indices[io++] = a;
        indices[io++] = c;
        indices[io++] = b;
        indices[io++] = b;
        indices[io++] = c;
        indices[io++] = d;
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));

    const group = new THREE.Group();
    group.position.set(centreX - this.origin.x, 0, centreZ - this.origin.z);
    const mesh = new THREE.Mesh(geometry, TERRAIN_MATERIAL);
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    group.add(mesh);

    const { props, meshes } = this.buildProps(tx, tz, startX, startZ, heights, group);
    this.scene.add(group);

    const tile: DesertTile = {
      tx,
      tz,
      key,
      centreX,
      centreZ,
      group,
      geometry,
      meshes,
      heights,
      props,
      registered: [],
      bodies: [],
      hasPhysics: false,
    };
    this.tiles.set(key, tile);
    if (withPhysics) this.promote(tile);
  }

  /**
   * Precise only in the road transition, cheap everywhere else. Once the player is
   * farther than the complete live square can reach, tiles use the fully developed
   * open field without touching the whole-road spatial index. Lateral travel therefore
   * stays constant-time no matter how intentionally lost the player becomes.
   */
  private groundHeight(x: number, z: number): number {
    if (this.farFromRoad) return this.terrain.explorationHeight(x, z, FULL_RELIEF_DISTANCE);
    const approximate = this.roadDistance.distAt(x, z, DIST_LATTICE);
    if (approximate >= EXACT_DISTANCE_GATE) return this.terrain.explorationHeight(x, z, approximate);

    const hint = this.roadDistance.ownerAt(x, z, DIST_LATTICE);
    const projection = this.road.project(x, z, hint);
    const dist = Math.abs(projection.lateral);
    const y = this.terrain.explorationHeightFromFrame(x, z, projection.lateral, projection.s);
    // The road ribbon owns the visible/contact surface in the corridor. Keeping desert
    // ten centimetres underneath prevents z-fighting and gives Rapier one first hit,
    // while the smooth fade leaves no ledge at the edge of the graded verge.
    const underRoad = 0.1 * (1 - smoothstep01(dist / CORRIDOR_OUTER));
    return y - underRoad;
  }

  private buildProps(
    tx: number,
    tz: number,
    startX: number,
    startZ: number,
    heights: Float32Array,
    group: THREE.Group,
  ): { props: readonly DesertPropPlacement[]; meshes: readonly THREE.InstancedMesh[] } {
    const requested = 2 + Math.floor(hash01(this.seed, PROP_TAG, tx, tz) * 4);
    const props: DesertPropPlacement[] = [];
    for (let i = 0; i < requested; i++) {
      const localX = (0.08 + hash01(this.seed, PROP_TAG, tx, tz, i, 1) * 0.84) * DESERT_TILE_SIZE;
      const localZ = (0.08 + hash01(this.seed, PROP_TAG, tx, tz, i, 2) * 0.84) * DESERT_TILE_SIZE;
      const worldX = startX + localX;
      const worldZ = startZ + localZ;
      // Roadside scatter already owns the corridor. Once the complete live square is
      // known to be far away, skip the global distance query entirely.
      if (!this.farFromRoad && this.roadDistance.distAt(worldX, worldZ, DIST_LATTICE) < 65) continue;

      const forms = desertPropForms(this.terrain.openSurfaceAt(worldX, worldZ));
      const form = forms[Math.floor(hash01(this.seed, PROP_TAG, tx, tz, i, 3) * forms.length)]!;
      const id = tilePropId(tx, tz, i);
      if (propPieces(form.id) && this.breakables?.isBroken(id)) continue;

      const scale =
        form.minScale +
        hash01(this.seed, PROP_TAG, tx, tz, i, 4) * (form.maxScale - form.minScale);
      const radius = form.baseRadius * scale;
      const ground = heightFromTile(heights, localX, localZ);
      props.push({
        form,
        id,
        x: localX - DESERT_TILE_SIZE * 0.5,
        y: ground - radius * form.sink,
        z: localZ - DESERT_TILE_SIZE * 0.5,
        rx: form.rotate3d ? hash01(this.seed, PROP_TAG, tx, tz, i, 5) * Math.PI * 2 : 0,
        ry: hash01(this.seed, PROP_TAG, tx, tz, i, 6) * Math.PI * 2,
        rz: form.rotate3d ? hash01(this.seed, PROP_TAG, tx, tz, i, 7) * Math.PI * 2 : 0,
        scale,
        radius,
        mesh: null,
        instance: 0,
      });
    }

    const meshes: THREE.InstancedMesh[] = [];
    const byForm = new Map<DesertPropForm, DesertPropPlacement[]>();
    for (const prop of props) {
      const list = byForm.get(prop.form);
      if (list) list.push(prop);
      else byForm.set(prop.form, [prop]);
    }
    for (const [form, placements] of byForm) {
      const instances = new THREE.InstancedMesh(form.geometry, form.material, placements.length);
      instances.castShadow = true;
      instances.receiveShadow = true;
      for (let i = 0; i < placements.length; i++) {
        const prop = placements[i]!;
        instanceScratch.position.set(prop.x, prop.y, prop.z);
        instanceScratch.rotation.set(prop.rx, prop.ry, prop.rz);
        instanceScratch.scale.setScalar(prop.scale);
        instanceScratch.updateMatrix();
        instances.setMatrixAt(i, instanceScratch.matrix);
        prop.mesh = instances;
        prop.instance = i;
      }
      instances.instanceMatrix.needsUpdate = true;
      group.add(instances);
      meshes.push(instances);
    }
    return { props, meshes };
  }

  private promote(tile: DesertTile): void {
    if (tile.hasPhysics) return;
    const terrainCollider = this.physics.addHeightfield(
      DESERT_TILE_CELLS,
      DESERT_TILE_CELLS,
      tile.heights,
      { x: DESERT_TILE_SIZE, y: 1, z: DESERT_TILE_SIZE },
      { x: tile.centreX - this.origin.x, y: 0, z: tile.centreZ - this.origin.z },
      TERRAIN_COLLIDER_SURFACE,
    );
    const terrainBody = terrainCollider.parent();
    if (terrainBody) tile.bodies.push(terrainBody);

    for (const prop of tile.props) {
      const pieces = propPieces(prop.form.id);
      if (pieces && this.breakables?.isBroken(prop.id)) continue;
      const collider = this.addPropCollider(tile, prop);
      if (!collider || !pieces || !this.breakables || !prop.mesh) continue;
      tile.registered.push(prop.id);
      this.breakables.register({
        id: prop.id,
        pieces,
        x: tile.centreX + prop.x,
        y: prop.y,
        z: tile.centreZ + prop.z,
        yaw: prop.ry,
        scale: prop.scale,
        radius: prop.form.baseRadius * prop.scale * 0.8,
        height: prop.form.height * prop.scale,
        mesh: prop.mesh,
        instance: prop.instance,
        collider,
      });
    }
    tile.hasPhysics = true;
  }

  private addPropCollider(
    tile: DesertTile,
    prop: DesertPropPlacement,
  ): RAPIER.Collider | null {
    const form = prop.form;
    if (form.collider === 'none') return null;

    const rapier = this.physics.rapier;
    let desc: RAPIER.ColliderDesc;
    let y = prop.y;
    if (form.collider === 'hull') {
      if (prop.radius < ROCK_COLLIDER_MIN) return null;
      const position = form.geometry.getAttribute('position');
      const length = position.count * 3;
      if (hullPoints.length !== length) hullPoints = new Float32Array(length);
      for (let i = 0; i < position.count; i++) {
        const j = i * 3;
        hullPoints[j] = position.getX(i) * prop.scale;
        hullPoints[j + 1] = position.getY(i) * prop.scale;
        hullPoints[j + 2] = position.getZ(i) * prop.scale;
      }
      const hull = rapier.ColliderDesc.convexHull(hullPoints);
      if (!hull) throw new Error(`Desert prop ${form.id} did not produce a convex hull`);
      desc = hull;
      instanceScratch.rotation.set(prop.rx, prop.ry, prop.rz);
      desc.setRotation(instanceScratch.quaternion);
    } else if (form.collider === 'box') {
      if (!form.colliderHalf) throw new Error(`Box collider extents missing for ${form.id}`);
      const [hx, hy, hz] = form.colliderHalf;
      desc = rapier.ColliderDesc.cuboid(hx * prop.scale, hy * prop.scale, hz * prop.scale);
      y += hy * prop.scale;
      desc.setRotation({
        x: 0,
        y: Math.sin(prop.ry * 0.5),
        z: 0,
        w: Math.cos(prop.ry * 0.5),
      });
    } else {
      const halfHeight = form.height * prop.scale * 0.42;
      const radius = form.baseRadius * prop.scale * 0.8;
      desc = rapier.ColliderDesc.capsule(halfHeight, radius);
      y += halfHeight;
    }

    const body = this.physics.world.createRigidBody(
      rapier.RigidBodyDesc.fixed().setTranslation(
        tile.centreX + prop.x - this.origin.x,
        y,
        tile.centreZ + prop.z - this.origin.z,
      ),
    );
    const collider = this.physics.world.createCollider(desc, body);
    this.physics.surfaces.register(collider.handle, SurfaceType.Rock);
    tile.bodies.push(body);
    return collider;
  }

  private demote(tile: DesertTile): void {
    if (tile.registered.length > 0) {
      this.breakables?.forget(tile.registered);
      tile.registered.length = 0;
    }
    for (const body of tile.bodies) this.physics.removeBody(body);
    tile.bodies.length = 0;
    tile.hasPhysics = false;
  }

  private teardown(tile: DesertTile): void {
    if (tile.hasPhysics) this.demote(tile);
    this.scene.remove(tile.group);
    tile.geometry.dispose();
    for (const mesh of tile.meshes) mesh.dispose();

  }
}
