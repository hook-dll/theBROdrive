import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { hash, hash01, pick } from '../core/rng';
import { DEFAULT_POI_SPACING_METRES } from '../game/settings';
import { SurfaceType } from '../core/surfaces';
import { ROAD_LENGTH, type Road } from './road';
import type { CarState, GameWorld } from '../game/state';
import { oilCapacity, variant, type FuelType } from '../parts/registry';
import type { FluidCanItem, FluidKind, ToolItem, ToolKind } from '../items/items';
import { makeFlatMaterial } from '../render/materials';
import {
  carModelMeasure,
  carSpawnYAboveGround,
  createCourierCarModel,
  createStaticCarModel,
  isCarModelLoaded,
  loadCarModel,
} from '../render/carmodel';
import { CAR_MODELS, type CarModelDef } from '../vehicle/carmodels';
import type { ChunkContext, ChunkContent, ChunkProvider } from './chunks';
import { villagesBetween, type Village } from './village';
import { box, C } from './poi/kit';
import type { LoosePartField } from '../parts/loose';
import { bonnetWaterCapacity, createBonnetStorage } from '../vehicle/bonnet';
import { COLD_SOAK_C } from '../vehicle/cooling';
import type { TrailerField } from '../vehicle/trailer';
import type { WreckTrunkField } from './wrecktrunks';
import type { PoiSwitchField } from './poiswitches';
import {
  courierDefaultStorage,
  courierId,
  courierParkingLateral,
  couriersBetween,
  isCourierPoiSlot,
  type CourierField,
  type CourierStop,
} from './couriers';
import { fitGround, type GroundPlane } from './footprint';
import { halfWidthAt } from './roadprofile';
import {
  createVariantInstance,
  registerPlacedSwitches,
  variantCount,
  variantDef,
  type PoiCategory,
  type VariantInstance,
} from './poivariantbuild';

const COURIER_MODELS = CAR_MODELS.filter((def) => def.paintStyle !== undefined);

/**
 * Points of interest: the roadside stops that give the drive a reason to continue.
 *
 * POIs are pure functions of the integer seed. A POI at km 300 is computed from its
 * slot index alone — never by walking the 249 slots before it — so chunk streaming
 * can materialise any stretch of road in any order and a save always restores the
 * exact same stop.
 *
 * Loot is materialised exactly once, keyed by the POI's slot index. `poi_looted`
 * is the idempotency guard: on any later rebuild the generation below is skipped
 * entirely, survivors live in `world.state.looseParts` / `looseItems`, and anything
 * the player already took is simply absent.
 */

/** Default metres of arclength between POI slots. */
export const POI_SPACING = DEFAULT_POI_SPACING_METRES;
/** Fraction of slots that contain a POI; the rest read as empty desert. */
const POI_OCCUPANCY = 0.55;
/** Domain tag for the POI hash stream, distinct from every other subsystem. */
const POI_DOMAIN = 0x504f4931; // 'POI1'

/**
 * Clear verge between the ASPHALT EDGE and a building's nearest wall, metres.
 *
 * Measured from the edge rather than from the centreline because the road widens: one
 * fixed offset from the crown is 12 m of clearance on a two-lane stretch and 6 m on a
 * four-lane one, which is how a kiosk ends up at the paint. `halfWidthAt` is usable
 * here because it is a pure function of the seed and the arclength — no road sampling —
 * so the placement below stays as pure and as cheap as it was.
 */
const VARIANT_SETBACK_MIN_M = 10;
const VARIANT_SETBACK_SPAN_M = 12;

export interface Poi {
  /** Slot index; equals the POI's identity in `WorldState.lootedPois`. Stable forever. */
  readonly index: number;
  /** Arclength of the stop, metres from the house. */
  readonly s: number;
  /** Signed lateral offset from the centreline; negative is left of travel. */
  readonly lateral: number;
  /** Index into `POI_VARIANTS`: the building that stands here. */
  readonly variant: number;
  /** Deterministic per-POI variation seed for shape and loot. */
  readonly variantSeed: number;
}

/**
 * How far out a slot sits: what this PARTICULAR building needs.
 *
 * A kiosk belongs at the verge and a parts warehouse does not, and one offset for both
 * puts either a building in the road or a shed in the middle of nowhere. So the offset
 * is the asphalt half width at this arclength, plus a verge, plus the building's own
 * half-extent. The AUTHORED footprint is used rather than a measured one because this
 * function is pure and cheap by contract — `poisBetween` resolves a stretch of road
 * without building a single triangle — and a measured extent would be wrong here for
 * the same reason: measuring means building.
 */
function variantLateral(seed: number, index: number, s: number, variant: number): number {
  const def = variantDef(variant);
  const halfBuilding = Math.max(def.footprint[0], def.footprint[1]) / 2;
  const side = hash01(seed, POI_DOMAIN, index, 2) < 0.5 ? -1 : 1;
  const verge =
    VARIANT_SETBACK_MIN_M + hash01(seed, POI_DOMAIN, index, 3) * VARIANT_SETBACK_SPAN_M;
  return side * (halfWidthAt(seed, s) + verge + halfBuilding);
}

/**
 * POIs whose slot falls in [fromS, toS). `index` is the slot index itself, so it is
 * stable across sessions and directly usable as a `lootedPois` entry. Pure and
 * order-independent: no road or terrain sampling happens here.
 */
export function poisBetween(
  seed: number,
  fromS: number,
  toS: number,
  spacing = POI_SPACING,
): Poi[] {
  const result: Poi[] = [];
  const firstIndex = Math.max(1, Math.ceil(fromS / spacing));
  // `toS - 1e-6` keeps a POI exactly on the upper boundary in the next chunk.
  const lastIndex = Math.floor((toS - 1e-6) / spacing);

  for (let i = firstIndex; i <= lastIndex; i++) {
    const s = i * spacing;
    if (s <= 0 || s > ROAD_LENGTH) continue;

    if (
      hash01(seed, POI_DOMAIN, i) >= POI_OCCUPANCY
      && !isCourierPoiSlot(seed, i, spacing)
    ) continue;

    // WHICH BUILDING STANDS HERE, and there is deliberately no progression to learn:
    // the variant is one hash of the slot, so having seen a petrol station tells a
    // player nothing about the next one. That is the whole feel this is after — the
    // drive becomes a sequence of surprises rather than a route whose landmarks are
    // known in advance.
    const variant = Math.min(
      variantCount() - 1,
      Math.floor(hash01(seed, POI_DOMAIN, i, 1) * variantCount()),
    );
    const lateral = variantLateral(seed, i, s, variant);

    result.push({
      index: i,
      s,
      lateral,
      variant,
      variantSeed: hash(seed, POI_DOMAIN, i, 4),
    });
  }
  return result;
}

/**
 * The POI at a given slot, or null when that slot is empty desert. Same rolls as
 * `poisBetween`, factored out so one slot can be resolved without sampling a whole
 * stretch of road — `tools/wreck-spacing.ts` reads a field that way.
 */
export function poiAt(seed: number, index: number, spacing = POI_SPACING): Poi | null {
  if (index < 1) return null;
  const s = index * spacing;
  if (s <= 0 || s > ROAD_LENGTH) return null;
  if (hash01(seed, POI_DOMAIN, index) >= POI_OCCUPANCY) return null;

  // Must stay roll-for-roll identical to `poisBetween`, or a bench reading one slot
  // measures a POI the world will never build.
  const variant = Math.min(
    variantCount() - 1,
    Math.floor(hash01(seed, POI_DOMAIN, index, 1) * variantCount()),
  );
  const lateral = variantLateral(seed, index, s, variant);

  return {
    index,
    s,
    lateral,
    variant,
    variantSeed: hash(seed, POI_DOMAIN, index, 4),
  };
}


/** Running sub-index so every generated part/item in a POI gets a distinct id. */
interface LootCounter {
  sub: number;
}

/** Anchor in XZ plus the road heading, before any terrain sampling. */
interface Anchor {
  x: number;
  z: number;
  heading: number;
}

/** Ground position in XZ at a POI's arclength, before terrain sampling. */
function anchorXZ(ctx: ChunkContext, poi: Poi): Anchor {
  const sample = ctx.road.sampleAt(poi.s);
  const p = ctx.road.offsetPoint(poi.s, poi.lateral);
  return { x: p.x, z: p.z, heading: sample.heading };
}

/** Rotate a local (right, forward) offset into a world XZ offset at `yaw`. */
function rotateXZ(lx: number, lz: number, yaw: number): { x: number; z: number } {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return { x: c * lx + s * lz, z: -s * lx + c * lz };
}

/**
 * A structure's site: the anchor its local (right, forward) offsets are measured
 * from, the yaw they are rotated by, and ONE plane fitted to the ground under the
 * whole footprint.
 *
 * One plane per site rather than one sample per part is the entire fix for
 * buildings half-buried in a dune: a canopy's four posts used to take four
 * independent centre samples and carry a level roof between them, so on the 9-10%
 * ground this world is made of, two of them stood on air. Now the site knows its
 * slope, `lift` raises anything standing on a laid apron, and a part either follows
 * the plane (`sitePoint`) or tilts onto it
 * (`plane.roll`/`plane.pitch`).
 */
interface Site {
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
  readonly plane: GroundPlane;
  /** Top of the apron above the fitted plane, or zero on bare ground. */
  readonly lift: number;
}

function siteAt(
  ctx: ChunkContext,
  poi: Poi,
  anchor: Anchor,
  yaw: number,
  halfRight: number,
  halfForward: number,
  lift = 0,
): Site {
  return {
    x: anchor.x,
    z: anchor.z,
    yaw,
    lift,
    plane: fitGround(ctx.terrain, anchor.x, anchor.z, yaw, halfRight, halfForward, poi.s),
  };
}

/** World position of a local offset, on the site's ground (or on its apron). */
function sitePoint(site: Site, lx: number, lz: number): { x: number; y: number; z: number } {
  const o = rotateXZ(lx, lz, site.yaw);
  return { x: site.x + o.x, y: site.plane.yAt(lx, lz) + site.lift, z: site.z + o.z };
}


/** Terrain-grounded position offset along the road instead of in local space. */
function groundPoint(
  ctx: ChunkContext,
  poi: Poi,
  sDelta: number,
  latDelta: number,
): { x: number; y: number; z: number } {
  const s = poi.s + sDelta;
  const p = ctx.road.offsetPoint(s, poi.lateral + latDelta);
  return { x: p.x, y: ctx.terrain.heightAt(p.x, p.z, s), z: p.z };
}

/**
 * Matrix from an upright-ish pose. `yaw` about Y, then `roll`/`pitch` tilts.
 *
 * `x`/`z` are ABSOLUTE: the translation is written relative to `ox`/`oz`, so the
 * matrix is already in the chunk's floating-origin frame when both the visual
 * (`setFromMatrix`) and the collider (`geometryToTrimesh`) read it. The rebase
 * happens here, once, never in either consumer.
 */
export function poseMatrix(
  x: number,
  y: number,
  z: number,
  yaw: number,
  roll: number,
  pitch: number,
  ox: number,
  oz: number,
): THREE.Matrix4 {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, roll, 'YXZ'));
  return new THREE.Matrix4().compose(new THREE.Vector3(x - ox, y, z - oz), q, new THREE.Vector3(1, 1, 1));
}

/** Apply a matrix's transform to an Object3D without mutating its geometry. */
function setFromMatrix(obj: THREE.Object3D, matrix: THREE.Matrix4): void {
  obj.position.setFromMatrixPosition(matrix);
  obj.quaternion.setFromRotationMatrix(matrix);
  obj.scale.setFromMatrixScale(matrix);
}

/** Bake a BufferGeometry's triangles through `matrix` into Rapier trimesh data. */
export function geometryToTrimesh(
  geometry: THREE.BufferGeometry,
  matrix: THREE.Matrix4,
): { vertices: Float32Array; indices: Uint32Array } {
  const pos = geometry.getAttribute('position');
  const vertCount = pos.count;
  const vertices = new Float32Array(vertCount * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < vertCount; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(matrix);
    vertices[i * 3] = v.x;
    vertices[i * 3 + 1] = v.y;
    vertices[i * 3 + 2] = v.z;
  }
  const index = geometry.getIndex();
  let indices: Uint32Array;
  if (index) {
    indices = new Uint32Array(index.count);
    for (let i = 0; i < index.count; i++) indices[i] = index.getX(i);
  } else {
    indices = new Uint32Array(vertCount);
    for (let i = 0; i < vertCount; i++) indices[i] = i;
  }
  return { vertices, indices };
}

/**
 * Static collider for a primitive. The streamer owns cleanup: it walks the returned
 * `bodies` array and calls `physics.removeBody`, which forgets the surface and
 * removes the fixed body plus its collider.
 *
 * Returns the collider so a caller that needs to identify it later (a revivable
 * wreck, which must be recognised when the aim ray hits it) can register the
 * handle. Null when the chunk carries no physics.
 */
function addStaticCollider(
  ctx: ChunkContext,
  geometry: THREE.BufferGeometry,
  matrix: THREE.Matrix4,
  surface: SurfaceType,
  bodies: RAPIER.RigidBody[],
  colliders: RAPIER.Collider[],
): RAPIER.Collider | null {
  if (!ctx.hasPhysics) return null;
  const t = geometryToTrimesh(geometry, matrix);
  const collider = ctx.physics.addStaticTrimesh(t.vertices, t.indices, surface);
  colliders.push(collider);
  const parent = collider.parent();
  if (parent) bodies.push(parent);
  return collider;
}

/** Visual mesh + matching static collider, sharing one (unmutated) geometry. */
function addStaticMesh(
  ctx: ChunkContext,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  matrix: THREE.Matrix4,
  surface: SurfaceType,
  group: THREE.Group,
  bodies: RAPIER.RigidBody[],
  colliders: RAPIER.Collider[],
): void {
  const mesh = new THREE.Mesh(geometry, material);
  setFromMatrix(mesh, matrix);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  addStaticCollider(ctx, geometry, matrix, surface, bodies, colliders);
}


function makeFluidCan(
  world: GameWorld,
  poi: Poi,
  fluid: FluidKind,
  litres: number,
  capacity: number,
  counter: LootCounter,
): FluidCanItem {
  const sub = counter.sub++;
  return {
    type: 'fluid_can',
    id: world.generatedPartId('poi_item', poi.index, sub),
    fluid,
    capacity,
    litres,
  };
}

/**
 * What a gas stop stocks, by weight.
 *
 * Fuel dominates because fuel is the pressure the player feels every minute;
 * water and oil are the ones they only think about every 150 km or so, so they
 * turn up often enough to be findable and rarely enough to be worth a detour. Small
 * cans for the engine fluids, because that is how they are sold.
 *
 * The petrol/diesel split is no longer matched to the CATALOGUE: since the pack that
 * ran on diesel was dropped, no catalogue body ships with it. The two diesel engines
 * in `parts/registry.ts` are parts a player can fit, so a diesel can is for a car
 * somebody has already converted — which is why it stays a rarity here rather than a
 * share of the fleet.
 *
 * The first cut had diesel at 0.26 against petrol's 0.40, which oversupplied it
 * about two to one: a quarter of every can in the desert would have been unusable
 * to five players out of six. The split below keeps diesel rare but findable, so a
 * diesel driver is not starved by bad luck, without littering the road with cans
 * nobody can pour.
 */
const FLUID_STOCK: readonly { fluid: FluidKind; weight: number; capacity: number }[] = [
  { fluid: 'petrol', weight: 0.5, capacity: 20 },
  { fluid: 'diesel', weight: 0.15, capacity: 20 },
  { fluid: 'water', weight: 0.19, capacity: 5 },
  { fluid: 'oil', weight: 0.16, capacity: 5 },
];

function pickFluid(roll: number): { fluid: FluidKind; capacity: number } {
  let acc = 0;
  for (const entry of FLUID_STOCK) {
    acc += entry.weight;
    if (roll < acc) return entry;
  }
  return FLUID_STOCK[0];
}

function makeTool(
  world: GameWorld,
  poi: Poi,
  tool: ToolKind,
  counter: LootCounter,
): ToolItem {
  const sub = counter.sub++;
  return {
    type: 'tool',
    id: world.generatedPartId('poi_item', poi.index, sub),
    tool,
    integrity: 0.8 + hash01(poi.variantSeed, sub, 41) * 0.2,
  };
}


const TOOL_KINDS: readonly ToolKind[] = ['brush', 'sponge', 'wrench'];

// ---------------------------------------------------------------------------
// Kind builders. Each builds its scenery unconditionally and its loot only when
// `shouldLoot` is set, so an emptied POI keeps its structure but never restocks.
//
// POIs no longer shed loose vehicle parts. Scattering wheels, engines, bumpers
// and seats down the whole road littered the world with scrap that had to be
// picked up one by one, so loot is now tools and fuel cans only. Wrecks remain
// static scenery and nothing falls off them — do not re-add part spawns here.
// ---------------------------------------------------------------------------

/**
 * Fuel cans on a forecourt or in a shop, part-used rather than factory-sealed.
 *
 * The same stock the old gas stop carried, so a player who knew where fuel came from
 * still finds it where they expect: this is a redistribution of the world's rewards
 * across the new buildings, not a change to what the world pays out.
 */
function stockFluidCans(
  ctx: ChunkContext,
  poi: Poi,
  site: Site,
  loose: LoosePartField,
  counter: LootCounter,
  count: number,
): void {
  for (let i = 0; i < count; i++) {
    const stock = pickFluid(hash01(poi.variantSeed, 31, i));
    // A 20 L fuel can holds 12-20 L; a 5 L fluid can holds 3-5.
    const litres =
      Math.round(stock.capacity * (0.6 + hash01(poi.variantSeed, 32, i) * 0.4) * 10) / 10;
    const can = makeFluidCan(ctx.world, poi, stock.fluid, litres, stock.capacity, counter);
    const c = sitePoint(
      site,
      (hash01(poi.variantSeed, 33, i) - 0.5) * 4,
      (hash01(poi.variantSeed, 34, i) - 0.5) * 3 - 0.4,
    );
    loose.spawnItem(can, c.x, c.y + 0.2, c.z);
  }
}

/**
 * One sealed five-piece gum pack. The roadside-only rescue resource: it was one per
 * gas stop, and there is still one per stop that stocks anything, so the supply of
 * the thing that gets a car unstuck is unchanged by the new buildings.
 */
function stockGum(
  ctx: ChunkContext,
  poi: Poi,
  site: Site,
  loose: LoosePartField,
  counter: LootCounter,
): void {
  const spot = sitePoint(site, 2.6, -0.7);
  const sub = counter.sub++;
  loose.spawnItem(
    {
      type: 'bubble_gum',
      id: ctx.world.generatedPartId('poi_item', poi.index, sub),
      charges: 5,
    },
    spot.x,
    spot.y + 0.18,
    spot.z,
  );
}

/**
 * A trailer left on the forecourt. Take one, leave one: they are never owned, so this
 * records a world object rather than giving the player a possession, and `shouldLoot`
 * is what stops a stop growing a new one every reload.
 */
function stockTrailer(
  ctx: ChunkContext,
  poi: Poi,
  site: Site,
  trailers: TrailerField,
  yaw: number,
): void {
  if (hash01(poi.variantSeed, TRAILER_DOMAIN, 0) >= TRAILER_STOP_CHANCE) return;
  const spot = sitePoint(site, 6.4, -1.2);
  const half = yaw / 2;
  trailers.spawn({
    id: `trailer:${poi.index}`,
    hitchedTo: null,
    cargoKg: 0,
    x: spot.x,
    // Clear of the ground so it drops onto its own suspension rather than starting
    // inside the terrain trimesh.
    y: spot.y + 0.9,
    z: spot.z,
    qx: 0,
    qy: Math.sin(half),
    qz: 0,
    qw: Math.cos(half),
  });
}

/** Tools, scattered around a site's middle. */
function stockTools(
  ctx: ChunkContext,
  poi: Poi,
  site: Site,
  loose: LoosePartField,
  counter: LootCounter,
  count: number,
): void {
  for (let i = 0; i < count; i++) {
    const tool = pick(TOOL_KINDS, poi.variantSeed, 98 + i);
    const item = makeTool(ctx.world, poi, tool, counter);
    const tp = sitePoint(
      site,
      (hash01(poi.variantSeed, 99, i) - 0.5) * 3,
      (hash01(poi.variantSeed, 100, i) - 0.5) * 3,
    );
    loose.spawnItem(item, tp.x, tp.y + 0.25, tp.z);
  }
}

/** A medicine pack, for the buildings that read as somebody's home. */
function stockMedicine(
  ctx: ChunkContext,
  poi: Poi,
  site: Site,
  loose: LoosePartField,
  counter: LootCounter,
): void {
  const spot = sitePoint(site, -1.8, 1.4);
  const sub = counter.sub++;
  loose.spawnItem(
    { type: 'medicine', id: ctx.world.generatedPartId('poi_item', poi.index, sub) },
    spot.x,
    spot.y + 0.2,
    spot.z,
  );
}

/**
 * What a building pays out, by its CATEGORY.
 *
 * The old world tied rewards to four hand-built kinds, so "what is this place" and
 * "what does it give me" were the same question. They are not any more: there are
 * twenty-six buildings and six things they are for, and the category is what carries
 * the meaning. The mapping is chosen so the supply of each resource stays close to what
 * it was — fuel still comes from forecourts, tools still come from anywhere with a
 * workbench in it — and the salvageable car field that used to BE the wreck stop now
 * lives with the containers, which is where a scrapyard's worth of cars belongs.
 */
function grantCategoryLoot(
  category: PoiCategory,
  ctx: ChunkContext,
  poi: Poi,
  site: Site,
  loose: LoosePartField,
  trailers: TrailerField,
  counter: LootCounter,
  yaw: number,
): void {
  switch (category) {
    case 'gas':
      // Fuel is the whole point of a petrol station, and a forecourt carries the engine
      // fluids too: the stop that gets you moving is where you top up. 3-6 cans, the
      // gum pack, and a trailer better than half the time.
      stockFluidCans(
        ctx,
        poi,
        site,
        loose,
        counter,
        3 + Math.floor(hash01(poi.variantSeed, 30) * 4),
      );
      stockGum(ctx, poi, site, loose, counter);
      stockTrailer(ctx, poi, site, trailers, yaw);
      break;
    case 'shop':
      // A shop is where the tools are, and every shop keeps the gum behind the counter.
      stockTools(ctx, poi, site, loose, counter, 1 + Math.floor(hash01(poi.variantSeed, 96) * 3));
      stockGum(ctx, poi, site, loose, counter);
      // A bigger store also has fluids out the back.
      if (hash01(poi.variantSeed, 97) < 0.5) {
        stockFluidCans(
          ctx,
          poi,
          site,
          loose,
          counter,
          1 + Math.floor(hash01(poi.variantSeed, 95) * 2),
        );
      }
      break;
    case 'house':
      // Somebody lived here: a medicine pack, a tool they left out, sometimes a can.
      stockMedicine(ctx, poi, site, loose, counter);
      if (hash01(poi.variantSeed, 94) < 0.6) stockTools(ctx, poi, site, loose, counter, 1);
      if (hash01(poi.variantSeed, 93) < 0.35) stockFluidCans(ctx, poi, site, loose, counter, 1);
      break;
    case 'container':
      // The salvage stop. Cars are broken down here and their trunks are worth opening.
      stockTools(ctx, poi, site, loose, counter, 1 + Math.floor(hash01(poi.variantSeed, 92) * 2));
      if (hash01(poi.variantSeed, 91) < 0.4) stockFluidCans(ctx, poi, site, loose, counter, 1);
      break;
    case 'tower':
      // A maintenance site: tools, and the fuel for whatever got you up there.
      stockTools(ctx, poi, site, loose, counter, 1);
      if (hash01(poi.variantSeed, 90) < 0.5) stockFluidCans(ctx, poi, site, loose, counter, 1);
      break;
    case 'wreck':
      // A wrecked vessel or aircraft pays out in what can be salvaged from it.
      stockTools(ctx, poi, site, loose, counter, 1 + Math.floor(hash01(poi.variantSeed, 89) * 2));
      break;
  }
}

/**
 * Which way a building faces: toward the road it stands beside.
 *
 * "Toward the road" is not the road's heading. A building sits off to one side, so the
 * direction it should face is the one that turns its front — authored as -Z — toward the
 * centreline, which is its own lateral offset reversed. The sign convention matches
 * `house.ts`'s garage, which faces the same way for the same reason. A small hash wobble
 * keeps a row of them from looking stamped out.
 *
 * Exported because a bench that measures a building's footprint against the world has to
 * place it the way the game does; `tools/wreck-spacing.ts` is that bench.
 */
export function faceRoadYaw(heading: number, lateral: number, variantSeed: number): number {
  const outward = heading + (lateral >= 0 ? -Math.PI / 2 : Math.PI / 2);
  return outward + Math.PI + (hash01(variantSeed, 7) - 0.5) * 0.16;
}

/** Intensity of a building's authored lamps, as handed to the light budget. */
const VARIANT_LAMP_INTENSITY = 0.55;

/**
 * How far below the fitted plane a building is pushed, on top of the plane's own residual.
 *
 * The residual already guarantees no float; this is a hand's width of margin so that a
 * single stray face of terrain, below the resolution the plane was fitted at, cannot show
 * a hairline of daylight under a wall.
 */
const SEAT_BURY_MARGIN = 0.08;

/**
 * One stop: a gallery building on a fitted apron, its collider, and its rewards.
 *
 * The apron is what makes the catalogue usable in a real world. Its slab top IS the
 * fitted ground plane, so a building placed on it stands on ONE plane instead of taking
 * a terrain sample per part — the same fix the old gas forecourt used, applied to every
 * building at once. Without it a 30 m storefront on the 9-10% ground this world is made
 * of stands on air at one corner and buries its front door at the other.
 */
function buildVariantPoi(
  ctx: ChunkContext,
  poi: Poi,
  group: THREE.Group,
  bodies: RAPIER.RigidBody[],
  colliders: RAPIER.Collider[],
  loose: LoosePartField,
  trailers: TrailerField,
  wreckTrunks: WreckTrunkField,
  switches: PoiSwitchField,
  registeredWrecks: string[],
  registeredSwitches: string[],
  deferredVisuals: Array<() => void>,
  counter: LootCounter,
  shouldLoot: boolean,
): void {
  const instance = createVariantInstance(poi.variant);
  const a = anchorXZ(ctx, poi);
  const yaw = faceRoadYaw(a.heading, poi.lateral, poi.variantSeed);

  // NO APRON. A building stands on the sand, pushed in far enough that the sand meets
  // its walls wherever the ground rises.
  //
  // The apron was a slab whose top IS the fitted plane, and it was the wrong trade: on
  // ground that varies, a level slab either floats at its low corner or shows its own
  // thickness as a grey box around the building. Measured, the homestead's came out 0.82 m
  // deep, which is a plinth, and a plinth is worse than the gap it replaced.
  //
  // What is left is what a building on uneven ground actually is. The site is one plane
  // fitted to the ground under the whole footprint, the building is TILTED onto that plane
  // so its base follows the slope, and it is then SUNK by the plane's own `residual` —
  // measured at 0.22-0.44 m across the catalogue — which is by definition the most any
  // point of ground under it can rise above the plane. So no wall can ever stand on air,
  // and none of it stands on anything man-made.
  const halfX = instance.halfExtentX;
  const halfZ = instance.halfExtentZ;
  const site = siteAt(ctx, poi, a, yaw, halfX, halfZ);
  const seatY = site.plane.centreY - site.plane.residual - SEAT_BURY_MARGIN;

  const at = sitePoint(site, 0, 0);
  at.y = seatY;
  instance.group.position.set(at.x - ctx.originX, at.y, at.z - ctx.originZ);
  instance.group.rotation.set(site.plane.pitch, yaw, site.plane.roll, 'YXZ');
  instance.group.updateMatrixWorld(true);
  group.add(instance.group);

  for (const source of instance.lightSources) {
    // Lit, and the budget decides whether any of it is drawn: it takes the nearest few
    // sources at night and leaves every pool dark by day. An intensity of zero would
    // make the source ineligible, and the building would never light at all.
    source.intensity = VARIANT_LAMP_INTENSITY;
    source.userData.lightBudgetSource = true;
  }

  // The switches, placed into the world. Their boxes are ORIENTED: the switch is built
  // upright and yawed about Y inside the variant, and the variant is then yawed and tilted
  // onto the ground here, so the plate's final orientation is the two composed — which is
  // why the orientation is stored rather than approximated by an axis-aligned box.
  registerPlacedSwitches(
    switches,
    instance,
    `poi-switch:${poi.index}`,
    registeredSwitches,
    ctx.originX,
    ctx.originZ,
  );

  if (ctx.hasPhysics) {
    const matrix = poseMatrix(
      at.x,
      at.y,
      at.z,
      yaw,
      site.plane.roll,
      site.plane.pitch,
      ctx.originX,
      ctx.originZ,
    );
    const trimesh = geometryToTrimesh(instance.solid, matrix);
    if (trimesh.indices.length > 0) {
      const collider = ctx.physics.addStaticTrimesh(
        trimesh.vertices,
        trimesh.indices,
        SurfaceType.Concrete,
      );
      colliders.push(collider);
      const parent = collider.parent();
      if (parent) bodies.push(parent);
    }
  }

  // The salvageable car field stayed with the containers. `buildWrecks` places its cars
  // around the POI's own anchor, which is exactly where this building stands, so it is
  // handed the footprint to lay out around.
  if (instance.category === 'container') {
    buildWrecks(ctx, poi, group, bodies, colliders, wreckTrunks, registeredWrecks, deferredVisuals, {
      x: a.x,
      z: a.z,
      yaw,
      halfX,
      halfZ,
    });
  }

  if (shouldLoot) {
    grantCategoryLoot(instance.category, ctx, poi, site, loose, trailers, counter, yaw);
  }
}

/**
 * Loot indices for village houses live in their own space, above every ordinary POI
 * index: a POI's index is its arclength slot along a forty-thousand-kilometre road, which
 * tops out around thirty-three thousand, and a village house has no slot of its own.
 */
const VILLAGE_LOOT_BASE = 2_000_000;

/** Post spacing of a garden fence's rails, metres, and its own size. */
const FENCE_PLANK_M = 0.07;
const FENCE_HEIGHT_M = 0.95;
/** How far behind a house its garden starts and ends, metres. */
const GARDEN_FROM_M = 9;
const GARDEN_TO_M = 24;
const GARDEN_HALF_WIDTH_M = 7;
/** The drop: poles between the road's own line and the village's street. */
const DROP_POLE_HEIGHT_M = 7.4;
const DROP_POLE_GAP_M = 9;
const DROP_POLE_COUNT = 3;

/**
 * ONE VILLAGE, built from the same catalogue the lone houses come from.
 *
 * The houses go through `buildVariantPoi`, so they are fitted to the ground, tilted onto
 * their own site plane, sunk by its residual, given their lamps and their door clearances
 * and collided exactly as a lone house is; a village is a rhythm, and the rhythm is the
 * only new thing in it. The pond is already dug by the time this runs — it is a basin in
 * `world/lakes.ts`, scheduled at this village's own arclength — so the houses simply stand
 * beside water.
 *
 * The furniture is what makes it read as inhabited rather than as six houses in a field:
 * a plank fence behind each house (the kitchen garden), and a short run of poles carrying
 * the line down from the road to the street.
 */
function buildVillage(
  ctx: ChunkContext,
  village: Village,
  group: THREE.Group,
  bodies: RAPIER.RigidBody[],
  colliders: RAPIER.Collider[],
  loose: LoosePartField,
  trailers: TrailerField,
  wreckTrunks: WreckTrunkField,
  switches: PoiSwitchField,
  registeredWrecks: string[],
  registeredSwitches: string[],
  deferredVisuals: Array<() => void>,
): void {
  const counter: LootCounter = { sub: 0 };
  for (const house of village.houses) {
    // ONE CHUNK BUILDS A HOUSE, and it is the chunk whose own span covers it. A street runs
    // 136-668 m and a chunk is 200 m, so a village used to be built in EVERY chunk its span
    // touched: measured over the first 2000 km of seed 1337, 204 villages with 2493 houses
    // produced 7339 house builds, 2.94 each. The copies landed at identical world positions
    // — duplicate meshes and draw calls, duplicate trimesh colliders, coplanar geometry —
    // and `PoiSwitchField` is keyed by switch id, so the copies overwrote each other's
    // switch state, and the loot roll was made once per copy.
    if (house.s < ctx.sStart || house.s >= ctx.sEnd) continue;
    const poi: Poi = {
      index: VILLAGE_LOOT_BASE + village.index * 64 + house.number,
      s: house.s,
      lateral: house.lateral,
      variant: house.variant,
      variantSeed: house.variantSeed,
    };
    const shouldLoot = ctx.hasPhysics && !ctx.world.state.lootedPois.includes(poi.index);
    buildVariantPoi(
      ctx,
      poi,
      group,
      bodies,
      colliders,
      loose,
      trailers,
      wreckTrunks,
      switches,
      registeredWrecks,
      registeredSwitches,
      deferredVisuals,
      counter,
      shouldLoot,
    );
    if (shouldLoot) ctx.world.apply({ t: 'poi_looted', poiIndex: poi.index });
    buildGardenFence(ctx, village, house.s, house.lateral, group);
  }
  // The drop is ONE structure rather than one per house, so it belongs to the chunk the
  // village's own middle falls in.
  if (village.s >= ctx.sStart && village.s < ctx.sEnd) buildPowerDrop(ctx, village, group);
}

/** The kitchen garden behind one house: three sides of a plank fence, no collider. */
function buildGardenFence(
  ctx: ChunkContext,
  village: Village,
  s: number,
  lateral: number,
  group: THREE.Group,
): void {
  const road = ctx.road;
  const outward = lateral < 0 ? -1 : 1;
  const near = Math.abs(lateral) + GARDEN_FROM_M;
  const far = Math.abs(lateral) + GARDEN_TO_M;
  const mid = (near + far) / 2;
  const heading = road.sampleAt(s).heading;
  const centre = road.offsetPoint(s, outward * mid);
  const y = ctx.terrain.heightAt(centre.x, centre.z, s);
  const back = road.offsetPoint(s, outward * far);
  const backY = ctx.terrain.heightAt(back.x, back.z, s);
  const paint = (x: number, z: number, size: readonly [number, number, number], yaw: number, baseY: number): void => {
    box(
      group,
      [size[0], size[1], size[2]],
      [x - ctx.originX, baseY + size[1] / 2, z - ctx.originZ],
      C.darkTimber,
      [0, yaw, 0],
    );
  };
  const length = far - near;
  // The two side walls run out from the house, the back one closes them.
  for (const side of [-1, 1]) {
    const p = road.offsetPoint(s + side * GARDEN_HALF_WIDTH_M, outward * mid);
    paint(p.x, p.z, [FENCE_PLANK_M, FENCE_HEIGHT_M, length], heading, y);
  }
  paint(back.x, back.z, [GARDEN_HALF_WIDTH_M * 2, FENCE_HEIGHT_M, FENCE_PLANK_M], heading, backY);
}

/** Three poles and their wire, from the road's verge to the village's houses. */
function buildPowerDrop(ctx: ChunkContext, village: Village, group: THREE.Group): void {
  const road = ctx.road;
  const s0 = village.s - (DROP_POLE_COUNT * DROP_POLE_GAP_M) / 2;
  let previous: { x: number; y: number; z: number } | null = null;
  for (let i = 0; i < DROP_POLE_COUNT; i++) {
    const s = s0 + i * DROP_POLE_GAP_M;
    const lateral = village.side * (9 + i * 7);
    const p = road.offsetPoint(s, lateral);
    const inward = road.offsetPoint(s, lateral - village.side * 7);
    // The pole stands on whichever side of the verge is lower, so its foot is never in
    // the air on a cross-slope.
    const baseY = Math.min(
      ctx.terrain.heightAt(p.x, p.z, s),
      ctx.terrain.heightAt(inward.x, inward.z, s),
    );
    box(
      group,
      [0.18, DROP_POLE_HEIGHT_M, 0.18],
      [p.x - ctx.originX, baseY + DROP_POLE_HEIGHT_M / 2, p.z - ctx.originZ],
      C.timber,
    );
    const top = baseY + DROP_POLE_HEIGHT_M - 0.5;
    if (previous) {
      const dx = p.x - previous.x;
      const dz = p.z - previous.z;
      const span = Math.hypot(dx, dz);
      box(
        group,
        [0.05, 0.05, span],
        [(p.x + previous.x) / 2 - ctx.originX, (top + previous.y) / 2, (p.z + previous.z) / 2 - ctx.originZ],
        C.darkMetal,
        [0, Math.atan2(dx, dz), 0],
      );
    }
    previous = { x: p.x, y: top, z: p.z };
  }
}

function buildPoi(
  ctx: ChunkContext,
  poi: Poi,
  group: THREE.Group,
  bodies: RAPIER.RigidBody[],
  colliders: RAPIER.Collider[],
  deferredVisuals: Array<() => void>,
  loose: LoosePartField,
  trailers: TrailerField,
  wreckTrunks: WreckTrunkField,
  switches: PoiSwitchField,
  registeredWrecks: string[],
  registeredSwitches: string[],
): void {
  const counter: LootCounter = { sub: 0 };
  const shouldLoot = ctx.hasPhysics && !ctx.world.state.lootedPois.includes(poi.index);

  buildVariantPoi(
    ctx,
    poi,
    group,
    bodies,
    colliders,
    loose,
    trailers,
    wreckTrunks,
    switches,
    registeredWrecks,
    registeredSwitches,
    deferredVisuals,
    counter,
    shouldLoot,
  );

  // Record that this POI's loot is now materialised. The flag alone is the whole
  // idempotency guard across chunk promotion / unload / reload.
  if (shouldLoot) ctx.world.apply({ t: 'poi_looted', poiIndex: poi.index });
}


// Couriers are their own sparse POIs. The sequence is random-access and every
// adjacent pair is 5–12 km apart, independent of ordinary POI density.
function buildCourier(
  ctx: ChunkContext,
  stop: CourierStop,
  group: THREE.Group,
  bodies: RAPIER.RigidBody[],
  colliders: RAPIER.Collider[],
  courierField: CourierField,
  registeredCouriers: string[],
  deferredVisuals: Array<() => void>,
): void {
  const def = pick(COURIER_MODELS, stop.appearanceSeed);
  const measure = carModelMeasure(def.id);
  const half = measure.halfExtents;
  const road = ctx.road.sampleAt(stop.s);
  const point = ctx.road.offsetPoint(stop.s, stop.lateral);
  const yaw = road.heading + (hash01(stop.appearanceSeed, 1) - 0.5) * 0.16;
  // A parked car sits ALONG the slope it is parked on. One centre sample used to
  // leave half a metre of air under the downhill wheels on this ground.
  const plane = fitGround(ctx.terrain, point.x, point.z, yaw, half[0], half[2], stop.s);
  point.y = plane.centreY;
  const originY = point.y + half[1] - 0.02;
  const id = courierId(stop.index);
  const matrix = poseMatrix(
    point.x,
    originY,
    point.z,
    yaw,
    plane.roll,
    plane.pitch,
    ctx.originX,
    ctx.originZ,
  );
  const addModel = (): void => {
    const model = createCourierCarModel(def.id, id);
    setFromMatrix(model, matrix);
    group.add(model);
  };
  if (isCarModelLoaded(def.id)) {
    addModel();
  } else {
    let cancelled = false;
    deferredVisuals.push(() => {
      cancelled = true;
    });
    void loadCarModel(def.id).then(
      () => {
        if (!cancelled) addModel();
      },
      (error: unknown) => {
        console.error(`failed to load courier car model "${def.id}"`, error);
      },
    );
  }

  const collider = addStaticCollider(
    ctx,
    new THREE.BoxGeometry(half[0] * 2, half[1] * 2, half[2] * 2),
    matrix,
    SurfaceType.Rock,
    bodies,
    colliders,
  );
  if (!collider) return;
  const rotation = new THREE.Quaternion().setFromRotationMatrix(matrix);
  courierField.register({
    id,
    index: stop.index,
    modelId: def.id,
    x: point.x,
    y: originY,
    z: point.z,
    qx: rotation.x,
    qy: rotation.y,
    qz: rotation.z,
    qw: rotation.w,
    halfExtents: half,
    defaultStorage: courierDefaultStorage(ctx.world.seed, stop.index),
  });
  registeredCouriers.push(id);
}
/**
 * Fraction of roadside wreck fields containing one working car. The roll is per
 * field, not per shell: most stops are wrecks only, while roughly one in three has
 * exactly one roadworthy car parked among them.
 */
const WORKING_CAR_CHANCE = 0.34;
/** Domain tag for the working-car roll, distinct from the placement stream. */
const WORKING_CAR_DOMAIN = 0x52554e31; // 'RUN1'

function makeWorkingCar(
  ctx: ChunkContext,
  poi: Poi,
  slot: number,
  def: CarModelDef,
  x: number,
  y: number,
  z: number,
  yaw: number,
): CarState {
  const engine = variant(def.engineId).engine;
  const halfYaw = yaw / 2;
  const carId = ctx.world.generatedPartId('poi-car', poi.index, slot);
  // One roadside find in four has had its radiator replaced with the cheapest core
  // that would bolt on. It drives away fine and then will not hold temperature on a
  // climb, which is exactly the diagnosis this system exists to make possible — and
  // it is why radiators are worth looking for in wrecks.
  const bodged = hash01(poi.variantSeed, WORKING_CAR_DOMAIN, 9) < 0.25;
  const bonnet = createBonnetStorage(
    carId,
    def.engineId,
    def.bodyClass,
    def.tankLitres,
    bodged ? 'radiator_small' : undefined,
  );
  return {
    id: carId,
    modelId: def.id,
    headlightMode: 'off',
    taillightsOn: false,
    reverseLightsOn: false,
    stickers: [],
    // A roadside find, weathered by however long it stood there. Scratched enough to
    // say somebody else drove it badly, not enough to look like salvage.
    dirt: 0.7 + hash01(poi.variantSeed, WORKING_CAR_DOMAIN, 7) * 0.25,
    scratches: 0.25 + hash01(poi.variantSeed, WORKING_CAR_DOMAIN, 8) * 0.3,
    // Enough fuel to make the find immediately useful, but not a free full tank.
    fuelLitres: def.tankLitres * (0.15 + hash01(poi.variantSeed, WORKING_CAR_DOMAIN, 3) * 0.2),
    fuelKind: engine?.fuel ?? null,
    // Part-topped, like the fuel: enough water to set off, little enough that a hot
    // afternoon makes the level worth a look before a long leg.
    waterLitres:
      bonnetWaterCapacity(bonnet) * (0.45 + hash01(poi.variantSeed, WORKING_CAR_DOMAIN, 10) * 0.4),
    oilLitres: engine ? oilCapacity(engine) : 0,
    // Stood by the road for months: at air temperature, not at operating heat.
    engineTempC: COLD_SOAK_C,
    storage: new Array(def.storageCells).fill(null),
    bonnet,
    odometer: Math.floor(hash01(poi.variantSeed, WORKING_CAR_DOMAIN, 4) * 240_000),
    x,
    y,
    z,
    qx: 0,
    qy: Math.sin(halfYaw),
    qz: 0,
    qw: Math.cos(halfYaw),
  };
}

/**
 * Layout of one roadside wreck field.
 *
 * The old placement drew each body's offsets independently — ±8 m of arclength and
 * ±6 m of lateral — which says nothing about where the previous body went, so two
 * 4.6 m cars landing 1 m apart was a routine roll rather than bad luck. Three of
 * them in a 16x12 m window collide most of the time, and a static shell is a solid
 * box collider, so the result was a car standing inside another car.
 *
 * So a slot is now REJECTION-SAMPLED: candidates come off the same deterministic hash
 * stream with the attempt index mixed in, and the first one that clears everything by
 * WRECK_CLEARANCE_M is taken.
 *
 * AND IT CLEARS THE BUILDING. The building at a stop stands on the POI's OWN anchor
 * (`siteAt` is given the POI's `s` and `lateral`), so a field laid out blind runs
 * through its walls — measured by `tools/wreck-spacing.ts` over 219 container stops,
 * 62.1% put a body inside the building's measured footprint, the deepest 2.53 m in, and
 * at a stop that rolls the roadworthy find the body inside the wall is the car itself.
 * So the caller hands the layout the building (`WreckKeepOut`) and it is one more term in
 * the same margin.
 *
 * WHEN NOTHING CLEARS, A LATTICE FINISHES THE JOB. Accepting the roomiest draw however
 * deep it sat was survivable in an empty field and is not one with a 12 m building on
 * its anchor. So a slot that the stream cannot place takes the first position on a
 * WRECK_LATTICE_STEP_M lattice over the same field that clears everything. If even that
 * finds none — three lorries asked to share one field — the roomiest lattice position is
 * taken, so a field still always lays out, never loops, and an impossible one is as far
 * from every neighbour as the ground allows.
 *
 * Separation uses each body's CIRCUMSCRIBED footprint radius, so the test holds at
 * whatever yaw, roll and sink the slot draws afterwards. Body-to-body distance is
 * measured in (arclength, lateral) road coordinates; over a 25 m field the road's
 * curvature moves that by centimetres. The building is NOT approximated that way: it is
 * a real object in the world, so the keep-out test places each candidate on the road and
 * measures it against the building where it actually stands. Doing it in the field's flat
 * frame left a body 0.28 m inside a wall on a curve, which is what the bench caught.
 *
 * The whole field is laid out before anything is built, so a slot's position cannot
 * depend on whether an earlier working car has already been driven away.
 */
const WRECK_CLEARANCE_M = 1.4;
/** Metres of road the field is strung along, and its lateral spread. */
const WRECK_S_SPREAD = 26;
const WRECK_LAT_SPREAD = 12;
/** Candidate draws per slot before the lattice takes over. */
const WRECK_PLACEMENT_ATTEMPTS = 48;
/** Lattice spacing the fallback searches the field at, metres. */
const WRECK_LATTICE_STEP_M = 1;

export interface WreckSlot {
  readonly def: CarModelDef;
  /** Footprint radius, metres: yaw-independent, so the gap holds at any pose. */
  readonly radius: number;
  readonly sDelta: number;
  readonly latDelta: number;
}

/**
 * The building a field must lay out around: where it stands, which way it faces, and its
 * measured half extents in its own frame, in world XZ.
 *
 * A rectangle is the only shape that fits — the circumscribed disc of a 12 x 10 m
 * building is 7.8 m in radius and covers the field's whole 12 m lateral spread, so no
 * field would lay out at all. The half extents are the measured ones the site fit and the
 * collider already use, and they CONTAIN the merged solid the collider is cut from
 * (roofs widen the bounds and are excluded from the trimesh), so clearing them clears the
 * wall the player hits.
 */
export interface WreckKeepOut {
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
  readonly halfX: number;
  readonly halfZ: number;
}

export function layOutWreckField(poi: Poi, road: Road, keepOut?: WreckKeepOut): WreckSlot[] {
  const count = 1 + Math.floor(hash01(poi.variantSeed, 10) * 3); // 1..3 bodies
  const slots: WreckSlot[] = [];

  for (let w = 0; w < count; w++) {
    const def: CarModelDef = pick(CAR_MODELS, poi.variantSeed, w, 10);
    const half = carModelMeasure(def.id).halfExtents;
    const radius = Math.hypot(half[0], half[2]);

    // A candidate's margin is the smaller of its gap off the building and its gap to
    // every body already placed.
    const marginAt = (sDelta: number, latDelta: number): number => {
      let margin = Infinity;
      if (keepOut) {
        // Distance to the building's oriented rectangle: negative inside it. The
        // rotation is the inverse of `rotateXZ`, the convention the whole placement
        // shares — local (x, z) maps to world (c·x + s·z, -s·x + c·z).
        const point = road.offsetPoint(poi.s + sDelta, poi.lateral + latDelta);
        const c = Math.cos(keepOut.yaw);
        const s = Math.sin(keepOut.yaw);
        const dx = point.x - keepOut.x;
        const dz = point.z - keepOut.z;
        const lx = c * dx - s * dz;
        const lz = s * dx + c * dz;
        margin =
          Math.hypot(
            Math.max(Math.abs(lx) - keepOut.halfX, 0),
            Math.max(Math.abs(lz) - keepOut.halfZ, 0),
          ) - radius;
      }
      for (const other of slots) {
        const gap =
          Math.hypot(sDelta - other.sDelta, latDelta - other.latDelta) - radius - other.radius;
        if (gap < margin) margin = gap;
      }
      return margin;
    };

    let chosen = { sDelta: 0, latDelta: 0, margin: -Infinity };
    for (let attempt = 0; attempt < WRECK_PLACEMENT_ATTEMPTS; attempt++) {
      const sDelta = (hash01(poi.variantSeed, w, 11, attempt) - 0.5) * WRECK_S_SPREAD;
      const latDelta = (hash01(poi.variantSeed, w, 12, attempt) - 0.5) * WRECK_LAT_SPREAD;
      const margin = marginAt(sDelta, latDelta);
      if (margin > chosen.margin) chosen = { sDelta, latDelta, margin };
      if (margin >= WRECK_CLEARANCE_M) break;
    }

    // Nothing in the stream cleared: walk a lattice over the same field and take the first
    // position that does, or the roomiest one if even that finds none.
    if (chosen.margin < WRECK_CLEARANCE_M) {
      let settled = false;
      for (
        let sDelta = -WRECK_S_SPREAD / 2;
        sDelta <= WRECK_S_SPREAD / 2 && !settled;
        sDelta += WRECK_LATTICE_STEP_M
      ) {
        for (
          let latDelta = -WRECK_LAT_SPREAD / 2;
          latDelta <= WRECK_LAT_SPREAD / 2;
          latDelta += WRECK_LATTICE_STEP_M
        ) {
          const margin = marginAt(sDelta, latDelta);
          if (margin > chosen.margin) chosen = { sDelta, latDelta, margin };
          if (margin >= WRECK_CLEARANCE_M) {
            settled = true;
            break;
          }
        }
      }
    }

    slots.push({ def, radius, sDelta: chosen.sDelta, latDelta: chosen.latDelta });
  }
  return slots;
}

/**
 * One to three complete models scattered through a roadside wreck field, and rarely
 * one upright slot that is a working car instead of a shell. Both draw from the
 * whole catalogue: a wreck is a state a body is found in, not a class of body, so
 * the same car you can drive is the one you find sunk in the sand beside it.
 */
function buildWrecks(
  ctx: ChunkContext,
  poi: Poi,
  group: THREE.Group,
  bodies: RAPIER.RigidBody[],
  colliders: RAPIER.Collider[],
  wreckTrunks: WreckTrunkField,
  registeredWrecks: string[],
  deferredVisuals: Array<() => void>,
  keepOut: WreckKeepOut,
): void {
  const anchor = anchorXZ(ctx, poi);
  const ox = ctx.originX;
  const oz = ctx.originZ;
  const slots = layOutWreckField(poi, ctx.road, keepOut);
  const count = slots.length;

  const hasWorkingCar =
    hash01(poi.variantSeed, WORKING_CAR_DOMAIN, 0) < WORKING_CAR_CHANCE;
  const workingSlot = hasWorkingCar
    ? Math.floor(hash01(poi.variantSeed, WORKING_CAR_DOMAIN, 1) * count)
    : -1;

  for (let w = 0; w < count; w++) {
    const isWorkingCar = w === workingSlot;
    const def = slots[w]!.def;
    const measure = carModelMeasure(def.id);
    const half = measure.halfExtents;
    const carId = ctx.world.generatedPartId('poi-car', poi.index, w);

    // A generated working car stays in world state after it is driven away. Never
    // rebuild a shell or a second car at its original POI.
    if (isWorkingCar && ctx.world.state.cars[carId]) continue;

    const { sDelta, latDelta } = slots[w]!;
    const p = groundPoint(ctx, poi, sDelta, latDelta);

    const yawRoll = hash01(poi.variantSeed, w, 13);
    let yaw = anchor.heading + (hash01(poi.variantSeed, w, 14) - 0.5) * 0.6;
    if (!isWorkingCar) {
      if (yawRoll < 0.32) yaw += Math.PI;
      else if (yawRoll > 0.82) {
        yaw += (hash01(poi.variantSeed, w, 15) < 0.5 ? 1 : -1) * Math.PI * 0.5;
      }
    }

    // The shell lies ALONG the ground and then adds its own derelict lean; the
    // fitted plane is what stops a body bridging a dune face on two wheels.
    const plane = fitGround(ctx.terrain, p.x, p.z, yaw, half[0], half[2], poi.s);
    const sink = isWorkingCar ? 0.02 : 0.25 + hash01(poi.variantSeed, w, 16) * half[1] * 0.5;
    const roll = plane.roll + (isWorkingCar ? 0 : (hash01(poi.variantSeed, w, 17) - 0.5) * 0.3);
    const pitch = plane.pitch + (isWorkingCar ? 0 : (hash01(poi.variantSeed, w, 18) - 0.5) * 0.22);
    const originY = plane.centreY + half[1] - sink;

    // Distant scenery shows the future working car as an upright static model.
    // Promotion into the physics band replaces it with a real Vehicle.
    if (isWorkingCar && ctx.hasPhysics) {
      // The distant static preview stands on the terrain; promotion creates the
      // physical car in clear air so gravity and suspension determine its ride height.
      const spawnY = carSpawnYAboveGround(measure, p.y);
      ctx.world.apply({
        t: 'car_add',
        car: makeWorkingCar(ctx, poi, w, def, p.x, spawnY, p.z, yaw),
      });
      continue;
    }
    const matrix = poseMatrix(p.x, originY, p.z, yaw, roll, pitch, ox, oz);
    const addShell = (): void => {
      const shell = createStaticCarModel(def.id, carId);
      setFromMatrix(shell, matrix);
      group.add(shell);
    };
    if (isCarModelLoaded(def.id)) {
      addShell();
    } else {
      let cancelled = false;
      deferredVisuals.push(() => {
        cancelled = true;
      });
      void loadCarModel(def.id).then(
        () => {
          if (!cancelled) addShell();
        },
        (error: unknown) => {
          console.error(`failed to load static car model "${def.id}"`, error);
        },
      );
    }

    // A box approximates a static shell well enough for a solid obstacle.
    const collider = addStaticCollider(
      ctx,
      new THREE.BoxGeometry(half[0] * 2, half[1] * 2, half[2] * 2),
      matrix,
      SurfaceType.Rock,
      bodies,
      colliders,
    );
    const rotation = new THREE.Quaternion().setFromRotationMatrix(matrix);
    if (!isWorkingCar && collider) {
      wreckTrunks.register({
        id: carId,
        modelId: def.id,
        x: p.x,
        y: originY,
        z: p.z,
        qx: rotation.x,
        qy: rotation.y,
        qz: rotation.z,
        qw: rotation.w,
        halfExtents: half,
      });
      registeredWrecks.push(carId);
    }
  }
}

/** Fraction of gas stops with a trailer standing on the forecourt. */
const TRAILER_STOP_CHANCE = 0.45;
/** Domain tag for the trailer roll. */
const TRAILER_DOMAIN = 0x54524c31; // 'TRL1'

/**
 * Builds ordinary stops plus the sparse courier network. Static trunk registries
 * exist only for the live physics band; their edited contents remain in WorldState.
 */
export class PoiProvider implements ChunkProvider {
  readonly id = 'poi';

  constructor(
    private readonly loose: LoosePartField,
    private readonly trailers: TrailerField,
    private readonly wreckTrunks: WreckTrunkField,
    private readonly switches: PoiSwitchField,
    private readonly couriers: CourierField,
  ) {}

  build(ctx: ChunkContext): ChunkContent | null {
    const villages = villagesBetween(ctx.world.seed, ctx.sStart, ctx.sEnd);
    const pois = poisBetween(
      ctx.world.seed,
      ctx.sStart,
      ctx.sEnd,
      ctx.world.state.settings.poiSpacingMetres,
    ).filter((poi) => !villages.some((village) => poi.s >= village.from && poi.s <= village.to));

    const group = new THREE.Group();
    group.name = 'poi';
    const bodies: RAPIER.RigidBody[] = [];
    const colliders: RAPIER.Collider[] = [];
    const deferredVisuals: Array<() => void> = [];
    const registeredWrecks: string[] = [];
    const registeredSwitches: string[] = [];
    const registeredCouriers: string[] = [];

    for (const poi of pois) {
      buildPoi(
        ctx,
        poi,
        group,
        bodies,
        colliders,
        deferredVisuals,
        this.loose,
        this.trailers,
        this.wreckTrunks,
        this.switches,
        registeredWrecks,
        registeredSwitches,
      );
    }
    for (const village of villages) {
      buildVillage(
        ctx,
        village,
        group,
        bodies,
        colliders,
        this.loose,
        this.trailers,
        this.wreckTrunks,
        this.switches,
        registeredWrecks,
        registeredSwitches,
        deferredVisuals,
      );
    }
    for (const stop of couriersBetween(
      ctx.world.seed,
      ctx.sStart,
      ctx.sEnd,
      ctx.world.state.settings.poiSpacingMetres,
    )) {
      const courierPoi = pois.find((poi) => poi.s === stop.s);
      if (!courierPoi) continue;
      buildCourier(
        ctx,
        {
          ...stop,
          lateral: courierParkingLateral(courierPoi.lateral),
        },
        group,
        bodies,
        colliders,
        this.couriers,
        registeredCouriers,
        deferredVisuals,
      );
    }

    return {
      group,
      bodies,
      colliders,
      dispose: () => {
        this.wreckTrunks.forget(registeredWrecks);
        this.switches.forget(registeredSwitches);
        this.couriers.forget(registeredCouriers);
        for (const cancel of deferredVisuals) cancel();
      },
    };
  }
}
