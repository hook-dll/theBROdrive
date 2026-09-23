/**
 * The development surface: the `window.__bro` console handle and the spawn / flip /
 * lake / seat tools the pause menu offers.
 *
 * Imported and called under a single `import.meta.env.DEV` fold in the composition
 * root. The constant is compile-time, so a production build drops the call, `devTools`
 * stays `null`, and this module — which has no top-level side effects — is tree-shaken
 * out of the bundle with it. Gathering the whole surface here is what lets one fold be
 * enough, and is why nothing in here has to test `import.meta.env.DEV` itself.
 */

import type { BirdFlock } from '../agents/birds';
import type { TumbleweedField } from '../agents/tumbleweed';
import type { GameAudio } from '../audio/gameaudio';
import type { InputReader } from '../core/input';
import type { PhysicsWorld } from '../core/physics';
import type { Renderer } from '../core/renderer';
import { spawnCarState, type SpawnRequest } from '../game/spawn';
import type { GameWorld } from '../game/state';
import { CAMERA_FRAME_LIMIT, Inventory, itemLabel, type Item } from '../items/items';
import type { LoosePartField } from '../parts/loose';
import { variant, type PartInstance } from '../parts/registry';
import type { Interaction } from '../player/interaction';
import type { Player } from '../player/player';
import type { PlayerVitals } from '../player/vitals';
import { carModelMeasure, carSpawnYAboveGround } from '../render/carmodel';
import type { CameraRig } from '../render/cameras';
import { LakeWater } from '../render/lakewater';
import type { Sky } from '../render/sky';
import type { VehicleLightRig } from '../render/vehiclelights';
import type { VistaMesh } from '../render/vista';
import { carModel } from '../vehicle/carmodels';
import {
  TRAILER_HALF_LENGTH,
  TRAILER_SPAWN_HEIGHT,
  type TrailerField,
} from '../vehicle/trailer';
import type { Vehicle } from '../vehicle/vehicle';
import type { Hud } from '../ui/hud';
import type { DevSpawnItemRequest } from '../ui/menu';
import type { Autopilot } from '../vehicle/autopilot';
import type { ChunkStreamer } from '../world/chunks';
import type { CourierField } from '../world/couriers';
import type { DebrisField } from '../world/debris';
import type { DesertTileStreamer } from '../world/deserttiles';
import type { WorldOrigin } from '../world/origin';
import type { Road } from '../world/road';
import type { RoadTraffic } from '../world/traffic';
import type { Terrain } from '../world/terrain';
import type { WorldWorkScheduler } from '../world/workqueue';

/**
 * Gap between the player and the NEAR END of a spawned vehicle, metres.
 *
 * A gap, not a centre distance: the drop point is this plus the model's own
 * half-length, because a fixed 6 m centre distance is measured from the middle of a
 * body that may be 16 m long, which spawned the low-poly semi straight through the
 * player and left them stuck inside its box while the solver tried to push them out.
 */
const SPAWN_AHEAD_GAP = 6;
/** Height above the eye the spawn ground probe starts from. */
const SPAWN_PROBE_HEIGHT = 3;
/** Trailer-only drop clearance; cars use model-aware `carSpawnYAboveGround`. */
const TRAILER_DROP_CLEARANCE = 0.35;
/**
 * Reach of the dev pause-menu flip, metres, measured from the player to a body
 * centre. Wide enough to right a car from wherever you got out of it, and short
 * enough that it cannot reach past one wreck to another at a gas stop.
 */
const DEV_FLIP_RADIUS = 12;
/**
 * How far past the searched window `devJumpToLake` sets the player down. Outside it, so
 * whatever hollow the desert offered is in front of the camera rather than under it, and
 * well outside the approach fade, so the water is at full opacity.
 */
const DEV_LAKE_WINDOW_MARGIN_M = 40;

/** Everything the dev surface reaches into; held, never captured. */
export interface DevToolsContext {
  readonly world: GameWorld;
  readonly renderer: Renderer;
  readonly vista: VistaMesh;
  readonly physics: PhysicsWorld;
  readonly interaction: Interaction;
  readonly input: InputReader;
  readonly loose: LoosePartField;
  readonly debris: DebrisField;
  readonly couriers: CourierField;
  readonly sky: Sky;
  readonly trailers: TrailerField;
  readonly road: Road;
  readonly terrain: Terrain;
  readonly player: Player;
  readonly birds: BirdFlock;
  readonly camera: CameraRig;
  readonly inventory: Inventory;
  readonly vehicles: Map<string, Vehicle>;
  readonly audio: GameAudio;
  readonly origin: WorldOrigin;
  readonly vehicleLights: VehicleLightRig;
  readonly worldWork: WorldWorkScheduler;
  readonly streamer: ChunkStreamer;
  readonly desert: DesertTileStreamer;
  readonly lakeWater: LakeWater;
  readonly tumbleweeds: TumbleweedField;
  readonly traffic: RoadTraffic;
  readonly vitals: PlayerVitals;
  readonly autopilot: Autopilot;
  readonly hud: Hud;
  /** The console kill shortcut drives the real death sequence through this. */
  beginDeathSequence(): void;
}

/** The tools the pause menu's dev entries and `window.__bro` are wired to. */
export interface DevTools {
  /** Drops a car on the ground ahead of the view. */
  spawnVehicle(request: SpawnRequest): void;
  /** Drops a trailer the same way. */
  spawnTrailer(): void;
  /** Drops a consumable at the player's feet. */
  spawnItem(request: DevSpawnItemRequest): void;
  /** Drops a factory-fresh part at the player's feet. */
  spawnPart(variantId: string): void;
  /** Rights the driven car, or the nearest one within the reach limit. */
  flipVehicle(): void;
  /** Puts the player in the nearest car, for sessions that cannot aim a look ray. */
  seatInNearestCar(): void;
  /** Puts the player on the road side of one lake site. */
  jumpToLake(index: number): void;
  /** Walks a `jumpToLake` marker forward until a site comes up wet. */
  updateLakeSeek(activeS: number): void;
}

/**
 * Builds the dev surface and installs the `window.__bro` console handle.
 */
export function installDevTools(ctx: DevToolsContext): DevTools {
  /** The dev spawn tool behind `PauseHooks.spawnVehicle`. */
  const devSpawnVehicle = (request: SpawnRequest): void => {
    // Put the car on the ground ahead of the view, not at the player's feet: a
    // chassis spawned inside the player (or inside the car being driven) would be
    // resolved by the solver as an explosion.
    const eye = ctx.camera.eyePosition;
    const dir = ctx.camera.eyeDirection;
    const flat = Math.hypot(dir.x, dir.z) || 1;
    const measure = carModelMeasure(request.modelId);
    // Spawned nose-in ahead of the player, so the drop point is a gap plus the
    // body's own half-length: the semi is 12 m long and its middle has to be 6 m
    // further out than a hatchback's.
    const ahead = SPAWN_AHEAD_GAP + measure.halfExtents[2];
    const dropX = eye.x + (dir.x / flat) * ahead;
    const dropZ = eye.z + (dir.z / flat) * ahead;
    const ground = ctx.physics.raycast(
      { x: dropX, y: eye.y + SPAWN_PROBE_HEIGHT, z: dropZ },
      { x: 0, y: -1, z: 0 },
      SPAWN_PROBE_HEIGHT + 12,
      ctx.player.rigidBody,
    );
    const groundY = ground ? ground.point.y : eye.y;

    // Keep the complete model clear of the surface. Gravity and the ray-cast
    // suspension establish its real resting height after materialisation.
    const y = carSpawnYAboveGround(measure, groundY);
    const heading = Math.atan2(dir.x / flat, dir.z / flat);
    // `dropX`/`dropZ` are relative — they came off the camera and fed a Rapier ray.
    // `spawnCarState` writes a saved `CarState`, which is absolute.
    spawnCarState(ctx.world, request, dropX + ctx.origin.x, y, dropZ + ctx.origin.z, heading);
    ctx.hud.setToast(`spawned ${carModel(request.modelId).label}`);
  };

  /**
   * The dev spawn tool behind `PauseHooks.spawnTrailer`. Mirrors `devSpawnVehicle`:
   * dropped ahead of the view on a ground raycast, clear of the player and any car
   * so the solver cannot resolve a trailer spawned inside a chassis as an explosion.
   */
  const devSpawnTrailer = (): void => {
    const eye = ctx.camera.eyePosition;
    const dir = ctx.camera.eyeDirection;
    const flat = Math.hypot(dir.x, dir.z) || 1;
    const ahead = SPAWN_AHEAD_GAP + TRAILER_HALF_LENGTH;
    const dropX = eye.x + (dir.x / flat) * ahead;
    const dropZ = eye.z + (dir.z / flat) * ahead;
    const ground = ctx.physics.raycast(
      { x: dropX, y: eye.y + SPAWN_PROBE_HEIGHT, z: dropZ },
      { x: 0, y: -1, z: 0 },
      SPAWN_PROBE_HEIGHT + 12,
      ctx.player.rigidBody,
    );
    const groundY = ground ? ground.point.y : eye.y;
    const y = groundY + TRAILER_SPAWN_HEIGHT + TRAILER_DROP_CLEARANCE;
    const heading = Math.atan2(dir.x / flat, dir.z / flat);
    const half = heading / 2;
    ctx.trailers.spawn({
      id: ctx.world.runtimePartId(),
      hitchedTo: null,
      cargoKg: 0,
      x: dropX + ctx.origin.x,
      y,
      z: dropZ + ctx.origin.z,
      qx: 0,
      qy: Math.sin(half),
      qz: 0,
      qw: Math.cos(half),
    });
    ctx.hud.setToast('spawned trailer');
  };

  /**
   * The dev item dispenser behind `PauseHooks.spawnItem`.
   *
   * Dropped just in front of the player rather than out on the ground raycast the
   * vehicle spawns use: these are pickups, and the useful thing is to have one in
   * reach immediately. They go through `ctx.loose.spawnItem` like found stock, so the
   * dev picker exercises the real pickup, storage and use paths.
   */
  const devSpawnItem = (request: DevSpawnItemRequest): void => {
    const eye = ctx.camera.eyePosition;
    const dir = ctx.camera.eyeDirection;
    const flat = Math.hypot(dir.x, dir.z) || 1;
    const dropX = eye.x + (dir.x / flat) * 1.2;
    const dropZ = eye.z + (dir.z / flat) * 1.2;
    const ground = ctx.physics.raycast(
      { x: dropX, y: eye.y + SPAWN_PROBE_HEIGHT, z: dropZ },
      { x: 0, y: -1, z: 0 },
      SPAWN_PROBE_HEIGHT + 12,
      ctx.player.rigidBody,
    );
    const groundY = ground ? ground.point.y : eye.y;
    let item: Item;
    switch (request.type) {
      case 'fluid_can':
        item = {
          type: 'fluid_can',
          id: ctx.world.runtimePartId(),
          fluid: request.fluid,
          capacity: request.capacity,
          litres: request.capacity,
        };
        break;
      case 'bubble_gum':
        item = { type: 'bubble_gum', id: ctx.world.runtimePartId(), charges: 5 };
        break;
      case 'medicine':
        item = { type: 'medicine', id: ctx.world.runtimePartId() };
        break;
      case 'binoculars':
        item = { type: 'binoculars', id: ctx.world.runtimePartId() };
        break;
      case 'torchlight':
        item = { type: 'torchlight', id: ctx.world.runtimePartId() };
        break;
      case 'sun_shades':
        item = { type: 'sun_shades', id: ctx.world.runtimePartId(), tint: request.tint };
        break;
      case 'camera':
        item = {
          type: 'camera',
          id: ctx.world.runtimePartId(),
          framesRemaining: CAMERA_FRAME_LIMIT,
        };
        break;
      case 'football':
        item = { type: 'football', id: ctx.world.runtimePartId() };
        break;
      case 'pocket_watch':
        item = { type: 'pocket_watch', id: ctx.world.runtimePartId() };
        break;
    }
    ctx.loose.spawnItem(item, dropX + ctx.origin.x, groundY + 0.3, dropZ + ctx.origin.z);
    ctx.hud.setToast(`spawned ${itemLabel(item)}`);
  };

  /**
   * The dev part dispenser behind `PauseHooks.spawnPart`.
   *
   * Same drop as `devSpawnItem` — a step in front of the player, on the ground the
   * raycast finds — because a part is picked up, carried and mounted by hand. It is
   * recorded through `ctx.loose.spawn`, so the picker exercises the real loose-part
   * lifecycle rather than a menu-only shortcut, and the part arrives factory-fresh:
   * no dirt, no rust, nothing to clean off before it can be fitted.
   */
  const devSpawnPart = (variantId: string): void => {
    const eye = ctx.camera.eyePosition;
    const dir = ctx.camera.eyeDirection;
    const flat = Math.hypot(dir.x, dir.z) || 1;
    const dropX = eye.x + (dir.x / flat) * 1.2;
    const dropZ = eye.z + (dir.z / flat) * 1.2;
    const ground = ctx.physics.raycast(
      { x: dropX, y: eye.y + SPAWN_PROBE_HEIGHT, z: dropZ },
      { x: 0, y: -1, z: 0 },
      SPAWN_PROBE_HEIGHT + 12,
      ctx.player.rigidBody,
    );
    const groundY = ground ? ground.point.y : eye.y;
    const part: PartInstance = { id: ctx.world.runtimePartId(), variantId, dirt: 0, rust: 0 };
    ctx.loose.spawn(part, dropX + ctx.origin.x, groundY + 0.3, dropZ + ctx.origin.z);
    ctx.hud.setToast(`spawned ${variant(variantId).label}`);
  };

  /**
   * The dev righting tool behind `PauseHooks.flipVehicle`.
   *
   * Seated, it targets the car being driven — no proximity test can be wrong about
   * that one. On foot it takes the nearest car or trailer within `DEV_FLIP_RADIUS`.
   * This explicit developer action is the only instant righting shortcut.
   */
  const devFlipVehicle = (): void => {
    // `ctx.world.state.player.drivingCarId`, NOT `activeCar()`: that helper falls back to
    // the nearest car with no distance limit, so on foot it would right a car a
    // kilometre away and never consider a trailer.
    const drivingId = ctx.world.state.player.drivingCarId;
    const driven = drivingId ? ctx.vehicles.get(drivingId) : undefined;
    if (driven) {
      driven.flipOver();
      ctx.hud.setToast('flipped the car you are driving');
      return;
    }
    const p = ctx.player.position;
    let nearest: { flipOver(): void } | null = null;
    let nearestKind: 'car' | 'trailer' | null = null;
    let nearestDistSq = DEV_FLIP_RADIUS * DEV_FLIP_RADIUS;
    for (const vehicle of ctx.vehicles.values()) {
      const t = vehicle.chassis.translation();
      const distSq = (t.x - p.x) ** 2 + (t.y - p.y) ** 2 + (t.z - p.z) ** 2;
      if (distSq < nearestDistSq) {
        nearest = vehicle;
        nearestKind = 'car';
        nearestDistSq = distSq;
      }
    }
    ctx.trailers.forEach((trailer) => {
      const t = trailer.rigidBody.translation();
      const distSq = (t.x - p.x) ** 2 + (t.y - p.y) ** 2 + (t.z - p.z) ** 2;
      if (distSq < nearestDistSq) {
        nearest = trailer;
        nearestKind = 'trailer';
        nearestDistSq = distSq;
      }
    });
    nearest?.flipOver();
    ctx.hud.setToast(
      nearestKind === null
        ? `no car or trailer within ${DEV_FLIP_RADIUS} m`
        : `flipped the nearest ${nearestKind}`,
    );
  };

  /**
   * The dev shortcut behind `PauseHooks.jumpToLake`.
   *
   * A lake is attempted once per 200-300 km, so reaching one by driving is hours. This
   * puts the player on the road side of the searched window, far enough out that the
   * water is at full opacity (the approach fade is metres, not hundreds —
   * render/lakewater.ts), facing into it. The driven car comes along through the same
   * `rescueTo` the underworld recovery uses, so the two never end up in different
   * counties.
   *
   * A site is only an ATTEMPT: about two in three windows hold no hollow worth filling.
   * The index is left in `devLakeSeek`, and the render loop walks it forward until a
   * site comes up wet, so one press lands on water.
   */
  let devLakeSeek = -1;
  const devJumpToLake = (index: number): void => {
    const sites = ctx.lakeWater.sites;
    if (sites.length === 0) {
      ctx.hud.setToast('no lake sites on this seed');
      return;
    }
    const clamped = Math.min(sites.length - 1, Math.max(0, Math.floor(index)));
    devLakeSeek = clamped;
    const site = sites[clamped]!;
    const centre = ctx.road.offsetPoint(site.s, site.lateral);
    const roadPoint = ctx.road.sampleAt(site.s);
    // Outward from the window's centre toward the centreline, then back off past its edge.
    const toRoadX = roadPoint.x - centre.x;
    const toRoadZ = roadPoint.z - centre.z;
    const span = Math.hypot(toRoadX, toRoadZ) || 1;
    const standOff = LakeWater.lattice.reach + DEV_LAKE_WINDOW_MARGIN_M;
    const standX = centre.x + (toRoadX / span) * standOff;
    const standZ = centre.z + (toRoadZ / span) * standOff;
    const standY = ctx.terrain.heightAt(standX, standZ, site.s);
    // Facing the window: the road frame's forward is (sin h, cos h), and so is the
    // player's yaw, so one `atan2` serves both.
    const yaw = Math.atan2(centre.x - standX, centre.z - standZ);

    const drivingId = ctx.world.state.player.drivingCarId;
    const driven = drivingId ? ctx.vehicles.get(drivingId) : undefined;
    if (driven) {
      driven.rescueTo(standX, standY - driven.contactPlaneLocalY, standZ, yaw, 0);
      driven.pushTransform();
    }
    ctx.player.teleport(standX, standY + 1.2, standZ, site.s);
    ctx.player.pushState();
    // The camera's yaw only: the player's own is private and follows the look anyway.
    ctx.camera.setYaw(yaw);
    ctx.hud.setToast(
      `lake site ${site.index + 1} of ${sites.length}, ${(site.s / 1000).toFixed(0)} km, ` +
        `${Math.abs(site.lateral).toFixed(0)} m off the road`,
    );
  };
  /**
   * The dev shortcut behind `PauseHooks.seatInNearestCar`.
   *
   * Getting into a car needs a look ray at a door, which a human does without
   * thinking and an automated test session cannot do at all — so every attempt to
   * observe the autopilot in the REAL game, rather than in a bench, stalled on
   * walking round a bonnet. This puts the player in the nearest car within
   * `DEV_FLIP_RADIUS`, and exists only while developing.
   */
  const devSeatInNearestCar = (): void => {
    if (ctx.world.state.player.drivingCarId) {
      ctx.hud.setToast('already driving');
      return;
    }
    const p = ctx.player.position;
    let nearestId: string | null = null;
    let nearestDistSq = DEV_FLIP_RADIUS * DEV_FLIP_RADIUS;
    for (const [id, vehicle] of ctx.vehicles) {
      const t = vehicle.chassis.translation();
      const distSq = (t.x - p.x) ** 2 + (t.y - p.y) ** 2 + (t.z - p.z) ** 2;
      if (distSq < nearestDistSq) {
        nearestId = id;
        nearestDistSq = distSq;
      }
    }
    if (nearestId === null) {
      ctx.hud.setToast(`no car within ${DEV_FLIP_RADIUS} m`);
      return;
    }
    ctx.world.apply({ t: 'enter_car', carId: nearestId });
    ctx.hud.setToast('seated in the nearest car');
  };

  const updateLakeSeek = (activeS: number): void => {
    // A site is only an attempt, and about two in three windows hold no hollow worth
    // filling. Rather than make a tester press the button until one does, the dev jump
    // leaves a marker and this walks it forward until a site comes up wet — then sets
    // them down somewhere the water is actually in front of them.
    if (devLakeSeek >= 0) {
      if (ctx.lakeWater.ready) {
        devLakeSeek = -1;
        const view = ctx.lakeWater.viewpoint();
        if (view) {
          ctx.player.teleport(view.x, view.y + 1.2, view.z, activeS);
          ctx.player.pushState();
          ctx.camera.setYaw(view.yaw);
        }
      } else if (ctx.lakeWater.phaseName === 'dry') {
        devLakeSeek++;
        if (devLakeSeek < ctx.lakeWater.sites.length) devJumpToLake(devLakeSeek);
        else {
          devLakeSeek = -1;
          ctx.hud.setToast('no lake left on this seed');
        }
      }
    }
  };

  // Dev-only inspection hook. Lets a browser session read simulation state without
  // exporting it into the game's own API surface.
  (window as unknown as Record<string, unknown>)['__bro'] = {
    world: ctx.world,
    renderer: ctx.renderer,
    vista: ctx.vista,
    physics: ctx.physics,
    interaction: ctx.interaction,
    input: ctx.input,
    loose: ctx.loose,
    debris: ctx.debris,
    couriers: ctx.couriers,
    sky: ctx.sky,
    trailers: ctx.trailers,
    road: ctx.road,
    terrain: ctx.terrain,
    player: ctx.player,
    birds: ctx.birds,
    camera: ctx.camera,
    inventory: ctx.inventory,
    vehicles: ctx.vehicles,
    audio: ctx.audio,
    origin: ctx.origin,
    vehicleLights: ctx.vehicleLights,
    worldWork: ctx.worldWork,
    streamer: ctx.streamer,
    desert: ctx.desert,
    lakeWater: ctx.lakeWater,
    // Same shortcut as the pause-menu button, for a console or a scripted session.
    jumpToLake: (index = 0) => devJumpToLake(index),
    tumbleweeds: ctx.tumbleweeds,
    traffic: ctx.traffic,
    vitals: ctx.vitals,
    autopilot: ctx.autopilot,
    state: () => ctx.world.state,
    view: () => ({
      eye: ctx.camera.eyePosition,
      dir: ctx.camera.eyeDirection,
      yaw: ctx.camera.yaw,
      mode: ctx.camera.mode,
    }),
  };

  const dev = (window as unknown as Record<string, Record<string, unknown>>)['__bro'];
  dev['killPlayer'] = (): void => {
    if (!ctx.vitals.dead) {
      ctx.vitals.beginCollisionFrame('foot');
      ctx.vitals.recordContact(-1, 70);
      ctx.vitals.endCollisionFrame();
    }
    ctx.beginDeathSequence();
  };

  return {
    spawnVehicle: devSpawnVehicle,
    spawnTrailer: devSpawnTrailer,
    spawnItem: devSpawnItem,
    spawnPart: devSpawnPart,
    flipVehicle: devFlipVehicle,
    seatInNearestCar: devSeatInNearestCar,
    jumpToLake: devJumpToLake,
    updateLakeSeek,
  };
}
