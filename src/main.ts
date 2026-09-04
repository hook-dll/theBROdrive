import * as THREE from 'three';
import { InputReader, emptyInput, type InputFrame } from './core/input';
import { GameLoop } from './core/loop';
import { PhysicsWorld } from './core/physics';
import { SURFACES, SurfaceType } from './core/surfaces';
import { Renderer } from './core/renderer';
import { DAY_LENGTH, GameWorld, newWorldState, type CarState } from './game/state';
import { parseCalendarEpoch } from './game/calendar';
import {
  TIME_OF_DAY_PRESETS,
  VIEW_DISTANCE_FOG_SCALE,
  VIEW_DISTANCE_METRES,
  loadStoredSettings,
  storeSettings,
} from './game/settings';
import { spawnCarState, type SpawnRequest } from './game/spawn';
import { Inventory, itemLabel, type Item } from './items/items';
import { WeaponController } from './items/weapons';
import { LoosePartField } from './parts/loose';
import { oilCapacity } from './parts/registry';
import { TouchControls } from './core/touch';
import {
  carModelMeasure,
  carSpawnYAboveGround,
  preloadCarModels,
  warmCarModelInstances,
} from './render/carmodel';
import { preloadTrailerModel } from './render/trailermodel';
import { DEFAULT_CAR_MODEL_ID, carModel } from './vehicle/carmodels';
import { Interaction } from './player/interaction';
import { Player } from './player/player';
import { BirdFlock } from './agents/birds';
import { TumbleweedField } from './agents/tumbleweed';
import { CameraRig, type CameraTarget } from './render/cameras';
import { HeldItemView } from './render/held';
import { TrunkView } from './render/trunkview';
import { LightBudget } from './render/lights';
import { Sky } from './render/sky';
import { loadStarField } from './render/starcatalog';
import { AnchorGhosts } from './render/slotghosts';
import { VistaMesh } from './render/vista';
import { DistantMirage } from './render/mirage';
import { roadTextures } from './render/roadtexture';
import { WheelSpray } from './render/wheelspray';
import { SandTyreTracks } from './render/tyretracks';
import { VehicleLightRig } from './render/vehiclelights';
import { createStickerMesh } from './render/stickers';
import { ChunkStreamer } from './world/chunks';
import { DesertTileStreamer } from './world/deserttiles';
import {
  HomesteadProvider,
  createStartingCar,
  homesteadSpawn,
  spawnStartingFuelCan,
} from './world/house';
import { PoiProvider } from './world/poi';
import { FreightField } from './world/freight';
import { DebrisField, type Impactor } from './world/debris';
import { MonumentProvider, PoleProvider, ScatterProvider } from './world/props';
import { Road, ROAD_LENGTH } from './world/road';
import { WorldOrigin } from './world/origin';
import { HazardIndex } from './world/hazards';
import { Autopilot } from './vehicle/autopilot';
import { setCarBodyCondition } from './render/materials';
import { WreckTrunkField } from './world/wrecktrunks';
import { loadSpine } from './world/spinecache';
import { RoadMeshProvider } from './world/roadmesh';
import { RoadDistance } from './world/roaddistance';
import { Terrain } from './world/terrain';
import { WorldWorkScheduler } from './world/workqueue';
import { TERRAIN_COLLIDER_SURFACE } from './world/terrainmesh';
import { Hud } from './ui/hud';
import { MainMenu, type DevSpawnItemRequest, type PauseHooks } from './ui/menu';
import { IndexedDbSaves, installVehicleAutosave } from './save/save';
import { bonnetWaterCapacity, hasServiceSlot } from './vehicle/bonnet';
import {
  TrailerField,
  TRAILER_HALF_LENGTH,
  TRAILER_MODEL_FIT,
  TRAILER_SPAWN_HEIGHT,
} from './vehicle/trailer';
import { Vehicle, type WheelSprayState } from './vehicle/vehicle';
import type { TrunkViewState } from './vehicle/trunk';
import { GameAudio, type RadioSpatialState } from './audio/gameaudio';

/**
 * Composition root. The only file allowed to know about every subsystem.
 *
 * Ordering here is load-bearing in three places, each marked below: physics before
 * anything that builds colliders, chunk 0 before the starting fuel can is placed
 * (it needs the garage floor to rest on), and active-set reconciliation after the
 * carried inventory has been restored.
 */

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
 * Objects enter the active physics/render world at the smaller radius and leave at
 * the larger one. The gap prevents lifetime churn at the streaming boundary.
 */
const ACTIVE_LOAD_RADIUS = 800;
const ACTIVE_UNLOAD_RADIUS = 1000;
const ACTIVE_LOAD_RADIUS_SQUARED = ACTIVE_LOAD_RADIUS * ACTIVE_LOAD_RADIUS;
const ACTIVE_UNLOAD_RADIUS_SQUARED = ACTIVE_UNLOAD_RADIUS * ACTIVE_UNLOAD_RADIUS;

/** How often the record marker and player position are pushed into state. */
const RECORD_INTERVAL = 2;
/**
 * Slip-speed floor for spray strength, m/s. Mirrors the tyre model's
 * SLIP_REFERENCE_MPS: a slip ratio is (ωr − v)/ref, so a wheel's surface speed
 * ωr ≈ v + slip·ref. Without the floor a held burnout (wheels spinning, chassis
 * still) reads zero speed and throws no tail.
 */
const SPRAY_REF_SPEED = 1.5;
/**
 * Slip below which a wheel throws nothing.
 *
 * A tyre rolling honestly still reports a small non-zero slip ratio — that is how
 * the tyre model makes force at all — so without a floor every wheel would trickle
 * motes down every straight. 0.06 is above that noise and well below the slip a
 * locked or spinning wheel reaches.
 */
const SPRAY_MIN_SLIP = 0.06;
/**
 * How much visible material a smoking tyre yields against a digging one.
 *
 * `SurfaceProps.dust` and `.smoke` say WHICH of the two a surface produces; this says
 * how much less there is of the second. A wheel scrubbing on asphalt makes a thin
 * wisp, a wheel spinning in sand makes a rooster tail, and the difference is close to
 * an order of magnitude once the emitter's own lower smoke rate is applied on top.
 */
const SPRAY_SMOKE_YIELD = 0.4;
/** Bubble gum is intentionally a cheap, readable rescue gag rather than a tool UI. */
const GUM_CHEW_SECONDS = 3;
const GUM_GROW_SECONDS = 5;
const GUM_USE_SECONDS = GUM_CHEW_SECONDS + GUM_GROW_SECONDS;
const GUM_FLIP_RADIUS = 0.5;
/**
 * Reach of the dev pause-menu flip, metres, measured from the player to a body
 * centre. Wide enough to right a car from wherever you got out of it, and short
 * enough that it cannot reach past one wreck to another at a gas stop.
 */
const DEV_FLIP_RADIUS = 12;

/**
 * The terrain's complete drivable height range is bounded far above this line. A
 * body below it has escaped the world rather than merely driving through a deep dune.
 */
const UNDERWORLD_Y = -400;
/** Hand-to-mouth pack motion at the start of the longer chew-and-blow action. */
const GUM_PACK_ANIM_SECONDS = 1;

async function boot(): Promise<void> {
  const canvas = document.getElementById('game');
  const uiRoot = document.getElementById('ui');
  const loading = document.getElementById('launch-loading');
  if (
    !(canvas instanceof HTMLCanvasElement) ||
    !(uiRoot instanceof HTMLElement) ||
    !(loading instanceof HTMLElement)
  ) {
    throw new Error('index.html is missing #game, #ui or #launch-loading');
  }

  const saves = new IndexedDbSaves();
  const menu = new MainMenu(uiRoot, loading);
  const chosen = await menu.show(saves);

  const loadedFromSave = chosen.state !== null;
  const world = new GameWorld(chosen.state ?? newWorldState(chosen.seed));

  // Machine preferences outrank whatever the save carried. Graphics quality and view
  // distance describe the GPU in front of the player, not the drive, so a save made on
  // another computer (or before the player last changed them) must not put them back.
  // Applied HERE because the renderer and the light budget both read them below, and
  // they only take a tier at construction. See game/settings.ts.
  {
    const stored = loadStoredSettings();
    if (stored) world.apply({ t: 'settings', settings: stored });
  }

  // The spine (checkpoints + coarse index) is what makes a long road affordable: it
  // is awaited here so the ten-million-step centreline walk never lands on the main
  // thread, and it is cached per seed so only the first session on a seed pays for it
  // at all. See world/spinecache.ts.
  const road = new Road(world.seed, await loadSpine(world.seed, ROAD_LENGTH));
  const terrain = new Terrain(world.seed, road);
  // The floating origin, before anything that could hold a position relative to it.
  // A saved driver may be far from the capsule position last recorded when they got
  // in, so start at the driven car when there is one. The first frame is then already
  // local around the active player/driven-car anchor.
  const savedDrivenCarId = world.state.player.drivingCarId;
  const savedDrivenCar = savedDrivenCarId ? (world.state.cars[savedDrivenCarId] ?? null) : null;
  const origin = new WorldOrigin();
  origin.reset(
    savedDrivenCar?.x ?? world.state.player.x,
    savedDrivenCar?.z ?? world.state.player.z,
  );
  /**
   * Scratch for absolute-position reads off a rigid body. One object for the session:
   * the rebase anchor, the streaming anchor and the rescue check all read a chassis
   * position every fixed step, and none of them keeps it.
   */
  const originAnchor = { x: 0, y: 0, z: 0 };
  // Physics must exist before any provider or field that creates a collider.
  const physics = await PhysicsWorld.create();
  // Every car's collider, suspension geometry and wheel radii are measured off its
  // GLB, so the whole catalogue is loaded before anything builds a vehicle, a wreck
  // or the starting car. ~5 MB from the same origin; there is no later moment where
  // a half-loaded catalogue would be useful.
  await preloadCarModels();
  // The trailer's GLB is fitted to the trailer's fixed physics before the first
  // trailer can materialise (a POI or a loaded save), exactly like the cars.
  await preloadTrailerModel(TRAILER_MODEL_FIT);
  const renderer = new Renderer(
    canvas,
    world.state.settings.graphicsQuality,
    world.state.settings.msaa,
    world.state.settings.inkStrength,
  );
  const vehicleLights = new VehicleLightRig(renderer.scene);
  // Road texture canvases are one-time CPU work; create them under the loading cover
  // rather than letting RoadMeshProvider charge the first streamed road chunk.
  roadTextures();
  /**
   * Rendered-frame counter. The chunk streamer is driven from the fixed step,
   * which can run several times per frame, so it needs to know which calls belong
   * to the same frame to cap its build work per frame rather than per call.
   * Incremented in `render`, which the loop calls exactly once a frame.
   */
  let frameId = 0;
  const input = new InputReader(canvas);
  input.setKeyBindings(world.state.settings.keyBindings);
  input.setMouseSensitivity(world.state.settings.mouseSensitivity);
  const hud = new Hud(uiRoot);
  // Audio is created before anything can make a noise and lives for the session:
  // its context starts suspended and the first click/keypress resumes it, so no
  // caller ever has to ask whether sound is available yet.
  const audio = new GameAudio();
  audio.applySettings(world.state.settings);
  const starField = await loadStarField(
    new Date(parseCalendarEpoch(world.state.calendarEpoch)),
    world.state.settings.graphicsQuality,
  );
  const sky = new Sky(renderer.scene, renderer.fog, renderer.renderer, starField);
  // Scene lights now exist, so warm both CPU instances and their exact live shader
  // permutations before the loading cover leaves. POI streaming never pays first use.
  await warmCarModelInstances(renderer.renderer, renderer.scene, renderer.camera);
  const inventory = new Inventory();
  // The pack mirrors itself into state on every structural change, so a save taken
  // at any moment carries what the player is holding. Registered before anything can
  // put an item in it (the starting scatter and POI loot both run below).
  inventory.setListener(() => {
    // `selectedIndex` is -1 on an empty pack, a HUD convention; state stores a
    // plain slot index, so it is floored here rather than at every reader.
    world.apply({
      t: 'inventory',
      items: inventory.all,
      selected: Math.max(0, inventory.selectedIndex),
    });
  });
  const loose = new LoosePartField(physics, world, renderer.scene, origin);
  // Trailers are world objects like cars, not chunk scenery: they move, so they
  // must outlive the chunk they were found standing in.
  const trailerField = new TrailerField(physics, world, renderer.scene, origin);
  // Freight: a sign at every stop, pallets where the seed says there is a load.
  const freight = new FreightField();
  const wreckTrunks = new WreckTrunkField();
  const birds = new BirdFlock(renderer.scene, road, terrain, world.seed, origin);
  const weapons = new WeaponController();
  const heldView = new HeldItemView(renderer.camera, renderer.scene);
  const trunkView = new TrunkView(renderer.scene);
  const anchorGhosts = new AnchorGhosts(renderer.scene);
  // Sand/gravel spray lives for the session like the other view systems; its
  // pool ages every frame and only the driven car flings into it.
  const wheelSpray = new WheelSpray(renderer.scene, origin);
  // Ground marks use the same wheel telemetry as spray, but retain a bounded history
  // in one pooled mesh instead of creating scene objects along the route.
  const tyreTracks = new SandTyreTracks(renderer.scene, origin);
  // Tumbleweeds share the spray ring so a hit can become dust without a second particle
  // budget. Their own cap is ten fixed instances; they never enter road hazards.
  const tumbleweeds = new TumbleweedField(renderer.scene, road, terrain, world.seed, origin, wheelSpray);

  // Shared exact nearest-road field: the tile streamer uses it to grade the open
  // lattice into the road corridor without searching the full spine per vertex.
  const roadDistance = new RoadDistance(road);
  // Owns every piece of scenery that can be knocked apart, and the resulting debris.
  // Built before the streamer because `ScatterProvider` hands it every breakable prop
  // it makes, and asks it which ones are already down.
  const debris = new DebrisField(physics, world, renderer.scene, origin);
  const hazards = new HazardIndex();
  const vista = new VistaMesh(renderer.scene, terrain, road, origin);
  const mirage = new DistantMirage(renderer.scene, road, terrain, world.seed, origin);
  // A save carries the tier it was played at, so apply it before the first frame
  // rather than waiting for someone to open the pause menu.
  {
    const metres = VIEW_DISTANCE_METRES[world.state.settings.viewDistance];
    renderer.setViewDistance(metres);
    vista.setViewDistance(metres);
  }
  // One streaming unit per rendered frame prevents road and desert attachment from
  // stacking into the periodic 3-4 ms main-thread spikes visible on fast displays.
  const worldWork = new WorldWorkScheduler(3, 1);
  const desert = new DesertTileStreamer(
    world.seed,
    road,
    terrain,
    roadDistance,
    physics,
    renderer.scene,
    origin,
    debris,
    worldWork,
  );

  // Scratches for the impact test in the fixed step: never allocated per tick.
  const impactForward = new THREE.Vector3();
  const impactQuat = new THREE.Quaternion();
  const impactor: Impactor = { x: 0, y: 0, z: 0, fx: 0, fz: 1, halfWidth: 1, halfLength: 2, vx: 0, vy: 0, vz: 0 };

  const streamer = new ChunkStreamer(
    road,
    terrain,
    physics,
    world,
    renderer.scene,
    origin,
    worldWork,
  );
  streamer.register(new RoadMeshProvider(world.seed));
  streamer.register(new HomesteadProvider());
  // Hazards are indexed in the ROAD FRAME as the scatter provider builds them, which
  // is what lets the autopilot know a dirt pile from a rock without a physics query:
  // the generator already knew, and this is the only place that knowledge survives.
  streamer.register(new ScatterProvider(debris, hazards));
  streamer.register(new PoleProvider());
  streamer.register(new MonumentProvider());
  streamer.register(new PoiProvider(loose, trailerField, freight, wreckTrunks));

  // Point lights are budgeted per frame (see LightBudget); constructed before the
  // first chunk build so the budget's first scan sees chunk 0's lamps.
  const lightBudget = new LightBudget(renderer.scene, world.state.settings.graphicsQuality);

  let initialYaw = 0;
  const player = new Player(physics, world, origin);
  player.setRoad(road);

  const vehicles = new Map<string, Vehicle>();
  const materializeVehicle = (car: CarState): Vehicle => {
    const existing = vehicles.get(car.id);
    if (existing) return existing;
    const vehicle = new Vehicle(physics, world, car, renderer.scene, origin);
    vehicles.set(car.id, vehicle);
    for (const sticker of car.stickers) vehicle.root.add(createStickerMesh(sticker));
    return vehicle;
  };

  const trailerVehicleFor = (carId: string): Vehicle | null => vehicles.get(carId) ?? null;
  const activeWorldAnchor = (): { x: number; y: number; z: number } => {
    const drivingId = world.state.player.drivingCarId;
    if (drivingId) {
      const driving = vehicles.get(drivingId);
      if (driving) return driving.absoluteTranslation(originAnchor);
      const saved = world.state.cars[drivingId];
      if (saved) return saved;
    }
    return player.absolutePosition;
  };
  const withinRadius = (
    x: number,
    z: number,
    anchorX: number,
    anchorZ: number,
    radiusSquared: number,
  ): boolean => {
    const dx = x - anchorX;
    const dz = z - anchorZ;
    return dx * dx + dz * dz <= radiusSquared;
  };
  const reconcileActiveWorld = (anchorX: number, anchorZ: number): void => {
    const drivingId = world.state.player.drivingCarId;
    const cars = world.state.cars;
    // Couplings are authoritative state, not derived runtime links. Materialise every
    // towing body before TrailerField runs so no hitch can outlive its car.
    const towingCarIds = new Set<string>();
    for (const trailer of Object.values(world.state.trailers)) {
      if (trailer.hitchedTo !== null) towingCarIds.add(trailer.hitchedTo);
    }
    for (const id in cars) {
      const car = cars[id];
      const vehicle = vehicles.get(id);
      const isTowingCar = towingCarIds.has(id);
      if (vehicle) {
        if (id === drivingId || isTowingCar) continue;
        const position = vehicle.absoluteTranslation(originAnchor);
        if (!withinRadius(
          position.x,
          position.z,
          anchorX,
          anchorZ,
          ACTIVE_UNLOAD_RADIUS_SQUARED,
        )) {
          vehicle.pushState();
          vehicle.dispose();
          vehicles.delete(id);
        }
      } else if (
        id === drivingId ||
        isTowingCar ||
        withinRadius(car.x, car.z, anchorX, anchorZ, ACTIVE_LOAD_RADIUS_SQUARED)
      ) {
        materializeVehicle(car);
      }
    }
    trailerField.updateActive(
      anchorX,
      anchorZ,
      trailerVehicleFor,
      ACTIVE_LOAD_RADIUS,
      ACTIVE_UNLOAD_RADIUS,
    );
    loose.updateActive(anchorX, anchorZ, ACTIVE_LOAD_RADIUS, ACTIVE_UNLOAD_RADIUS);
  };

  /**
   * Which vehicle a struck rigid body belongs to, for the player's shove.
   *
   * A linear scan over the live vehicles, which is a handful: the streamer only keeps
   * cars near the camera, and this runs at most once per fixed step and only while the
   * capsule is actually pressed into something dynamic. A handle map would have to be
   * maintained through every spawn, despawn and rebuild for no measurable gain.
   *
   * Bodies with no owner here — loose parts, jerry cans, wreck shells — get the player's
   * direct impulse instead, which is the right answer for them: nothing pins them, so
   * nothing has to lift a pin.
   */
  player.setShoveLookup((bodyHandle) => {
    for (const vehicle of vehicles.values()) {
      if (vehicle.chassis.handle === bodyHandle) return vehicle;
    }
    return null;
  });

  player.setNearbyShove((x, y, z, radius, moveX, moveZ, seconds) => {
    for (const vehicle of vehicles.values()) {
      if (vehicle.tryShoveFromSphere(x, y, z, radius, moveX, moveZ, seconds)) {
        return vehicle.chassis.handle;
      }
    }
    return null;
  });

  if (!loadedFromSave) {
    const car = createStartingCar(world);
    world.apply({ t: 'car_add', car });
    // The world does not exist behind s = 0, so a new game must start at the
    // homestead rather than at the default state position.
    const spawn = homesteadSpawn(road, terrain);
    player.teleport(spawn.x, spawn.y, spawn.z);
    initialYaw = spawn.yaw;
  }

  // A save may leave the player capsule behind the car they were driving. Establish
  // the local nine-tile desert physics patch and synchronously build the current road
  // chunk before the loading cover leaves, so starter bodies have solid support.
  const initialGround = savedDrivenCar ?? player.absolutePosition;
  const initialProjection = road.project(initialGround.x, initialGround.z, world.state.player.s);
  worldWork.beginFrame(frameId);
  desert.prime(initialGround.x, initialGround.z, initialProjection.lateral);
  streamer.prime(initialProjection.s, initialProjection.lateral);

  if (loadedFromSave) {
    // Restore the carried item before active-set reconciliation materialises nearby
    // loose state: carried items are absent from the loose maps, so the two cannot
    // collide.
    inventory.restore(world.state.player.carried, world.state.player.carriedSelected);
  } else {
    spawnStartingFuelCan(world, loose);
  }

  // POI working cars enter state when their chunk reaches the physics band. A new
  // runtime exists immediately only if the car belongs in the current active set.
  world.onDelta((delta) => {
    if (delta.t !== 'car_add') return;
    const anchor = activeWorldAnchor();
    if (
      delta.car.id === world.state.player.drivingCarId ||
      withinRadius(
        delta.car.x,
        delta.car.z,
        anchor.x,
        anchor.z,
        ACTIVE_LOAD_RADIUS_SQUARED,
      )
    ) {
      materializeVehicle(delta.car);
    }
  });

  // The driven car is selected unconditionally by reconciliation; trailers run
  // afterwards so their saved hitches can resolve, then loose state follows.
  const initialActiveAnchor = activeWorldAnchor();
  reconcileActiveWorld(initialActiveAnchor.x, initialActiveAnchor.z);

  /**
   * Nearest car to the player, or the one being driven. Returns the id alongside the
   * vehicle because callers (slot ghosts, HUD) need the `CarState` behind it, and
   * `Vehicle` deliberately does not expose its own id.
   */
  const activeCar = (): { id: string; vehicle: Vehicle } | null => {
    const drivingId = world.state.player.drivingCarId;
    if (drivingId) {
      const v = vehicles.get(drivingId);
      return v ? { id: drivingId, vehicle: v } : null;
    }
    const p = player.position;
    let best: { id: string; vehicle: Vehicle } | null = null;
    let bestDist = Infinity;
    for (const [id, vehicle] of vehicles) {
      const t = vehicle.chassis.translation();
      const d = (t.x - p.x) ** 2 + (t.y - p.y) ** 2 + (t.z - p.z) ** 2;
      if (d < bestDist) {
        bestDist = d;
        best = { id, vehicle };
      }
    }
    return best;
  };

  /**
   * A failed terrain/collider edge case must not strand a session below the playable
   * world. Use the fallen driven car as the anchor when present, put it back on the
   * nearest road centreline, and place the player at the same road point.
   */
  const recoverUnderworld = (): void => {
    const drivingId = world.state.player.drivingCarId;
    const driving = drivingId ? (vehicles.get(drivingId) ?? null) : null;
    const playerPosition = player.absolutePosition;
    const playerFallen = !Number.isFinite(playerPosition.y) || playerPosition.y < UNDERWORLD_Y;
    let carPosition: { x: number; y: number; z: number } | null = null;
    const carFallen = driving
      ? (() => {
          carPosition = driving.absoluteTranslation(originAnchor);
          return !Number.isFinite(carPosition.y) || carPosition.y < UNDERWORLD_Y;
        })()
      : false;
    if (!playerFallen && !carFallen) return;

    const anchor = carFallen && carPosition ? carPosition : playerPosition;
    const anchorX = Number.isFinite(anchor.x) ? anchor.x : world.state.player.x;
    const anchorZ = Number.isFinite(anchor.z) ? anchor.z : world.state.player.z;
    const projection = road.project(anchorX, anchorZ);
    const roadPoint = road.sampleAt(projection.s);
    if (carFallen && driving) {
      driving.rescueTo(
        roadPoint.x,
        roadPoint.y - driving.contactPlaneLocalY,
        roadPoint.z,
        roadPoint.heading,
      );
      driving.pushTransform();
    }
    if (playerFallen || carFallen) {
      player.teleport(roadPoint.x, roadPoint.y, roadPoint.z, projection.s);
      player.pushState();
    }
  };

  const interaction = new Interaction(
    physics,
    world,
    inventory,
    loose,
    trailerField,
    freight,
    wreckTrunks,
    () => {
      const active = activeCar();
      return active ? { carId: active.id, vehicle: active.vehicle } : null;
    },
    (carId, sticker) => {
      const vehicle = vehicles.get(carId);
      if (vehicle) vehicle.root.add(createStickerMesh(sticker));
    },
    origin,
  );
  interaction.attachPlayer(player);

  const saveName = (state: typeof world.state): string => {
    const label = carModel(Object.values(state.cars)[0]?.modelId ?? DEFAULT_CAR_MODEL_ID).label;
    return `${label} @ ${(state.player.s / 1000).toFixed(1)} km`;
  };
  /**
   * Physics bodies and throttled vehicle counters are runtime-authoritative between
   * their normal state deltas. Flush them immediately before every manual save,
   * export, or autosave; trunk cells already mutate `WorldState` synchronously.
   */
  const stateForSave = (): typeof world.state => {
    for (const vehicle of vehicles.values()) vehicle.pushState();
    trailerField.pushTransforms();
    return world.state;
  };
  installVehicleAutosave(saves, world, stateForSave, saveName, (error) => {
    console.error('autosave failed', error);
    hud.setToast('autosave failed');
  });

  // Freight has no HUD of its own — the job lives on a signpost and the payment on
  // the bodywork — so the only feedback it needs is the moment each thing happens.
  // Riding the delta stream keeps that out of the interaction code entirely.
  world.onDelta((delta) => {
    if (delta.t === 'job_accept') {
      hud.setToast(`${delta.job.cargoKg} kg aboard — look for the lit sign`);
    } else if (delta.t === 'job_complete') {
      hud.setToast('delivered — one sticker earned');
    } else if (delta.t === 'sticker_place') {
      const left = world.state.stickersUnplaced;
      hud.setToast(left > 0 ? `stuck on — ${left} left to place` : 'stuck on');
    } else if (delta.t === 'settings') {
      // Every path that changes preferences goes through this delta — the pause menu,
      // the precise-control hotkey, anything added later — so mirroring here is the
      // one place it cannot be forgotten at a new call site.
      storeSettings(delta.settings);
    }
  });

  const camera = new CameraRig(renderer.camera, physics, origin);
  camera.setMode('foot');
  camera.setYaw(initialYaw);
  camera.setInteriorCameraOffset(world.state.settings.interiorCameraOffset);

  // Synthesises ordinary InputFrame commands, so every fuel, gearbox, tyre, TCS and
  // steering rule the human drives under applies to it unchanged.
  const autopilot = new Autopilot(road, hazards, physics);

  // Dev-only inspection hook. Lets a browser session read simulation state without
  // exporting it into the game's own API surface.
  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>)['__bro'] = {
      world,
      renderer,
      vista,
      physics,
      interaction,
      input,
      loose,
      debris,
      freight,
      sky,
      trailers: trailerField,
      road,
      terrain,
      player,
      camera,
      inventory,
      vehicles,
      audio,
      origin,
      vehicleLights,
      worldWork,
      streamer,
      desert,
      tumbleweeds,
      state: () => world.state,
      view: () => ({
        eye: camera.eyePosition,
        dir: camera.eyeDirection,
        yaw: camera.yaw,
        mode: camera.mode,
      }),
    };
  }

  // Reused every frame: the camera target is written in place, never allocated.
  const target: CameraTarget = {
    x: 0,
    y: 0,
    z: 0,
    qx: 0,
    qy: 0,
    qz: 0,
    qw: 1,
    speedKmh: 0,
    eyeOffset: [0, 0, 0],
  };

  let lastInput: InputFrame = input.sample(0);
  /**
   * The camera is a render-rate system, but every fixed step drains the reader's
   * look/zoom deltas. With more than one step per frame (any time the frame rate
   * dips below the fixed rate) the last step's frame carries almost none of the
   * mouse motion, and with zero steps it carries a stale one — so the deltas are
   * summed across the frame's steps here and handed to the camera, then cleared,
   * exactly once per rendered frame.
   */
  const cameraInput: InputFrame = emptyInput();
  let lookYawAccum = 0;
  let lookPitchAccum = 0;
  let zoomAccum = 0;
  // Re-centre is a tap, so it must survive the same multi-step frame problem as the
  // look deltas above: a press seen by a non-final fixed step would otherwise be
  // overwritten by the last step's frame before the camera ever sees it.
  let recenterAccum = false;
  let recordTimer = 0;
  let paused = false;
  let prompt: string | null = null;
  /** Trunk grid under the crosshair, or null. Set by the interaction tick. */
  let boot: TrunkViewState | null = null;
  /** Arclength of whatever the camera is following; drives streaming and the sky. */
  let activeS = initialProjection.s;
  let gumActive = false;
  let gumTimer = 0;
  let gumPackCharges = 0;
  let gumUseHeld = false;
  /** Held devices are edge-toggled by F and reset when their item leaves the hand. */
  let binocularsActive = false;
  let torchlightActive = false;
  /** Any fixed-step origin rebase keeps the following rendered frame ineligible. */
  let rebasedThisFrame = false;
  /**
   * Reused per-frame scratch: the live vehicles with a lamp on, in the order the
   * light rig is offered them. A field, not a local, so the render loop allocates
   * nothing for the common case of one lit car.
   */
  const litVehicles: Vehicle[] = [];

  // Reused radio pose. The radio keeps the last non-null source coordinates after
  // exit, while the listener follows the camera every rendered frame.
  const radioSpatial: RadioSpatialState = {
    sourceX: null,
    sourceY: null,
    sourceZ: null,
    listenerX: 0,
    listenerY: 0,
    listenerZ: 0,
    listenerQx: 0,
    listenerQy: 0,
    listenerQz: 0,
    listenerQw: 1,
  };

  const fixedUpdate = (dt: number): void => {
    worldWork.beginFrame(frameId);
    const f = input.sample(dt);
    lastInput = f;
    lookYawAccum += f.lookYaw;
    lookPitchAccum += f.lookPitch;
    zoomAccum += f.zoomDelta;
    recenterAccum ||= f.recenterCamera;

    const s = world.state;
    world.apply({
      t: 'time',
      // The day length is a setting, so the clock rate is derived from it rather
      // than a constant: DAY_LENGTH in-game seconds must elapse over the player's
      // chosen number of real minutes.
      timeOfDay: s.timeOfDay + (dt * DAY_LENGTH) / (s.settings.dayCycleMinutes * 60),
      playedSeconds: s.playedSeconds + dt,
    });

    const drivingId = s.player.drivingCarId;
    const driving = drivingId ? (vehicles.get(drivingId) ?? null) : null;

    // Precise control is a preference, so M edits settings rather than a local flag:
    // the pause menu and hotkey always agree, and the held wheel survives save/load.
    // The reader is enabled only while driving, leaving normal mouse look on foot.
    if (f.togglePreciseSteer) {
      const on = !s.settings.preciseSteering;
      world.apply({ t: 'settings', settings: { ...s.settings, preciseSteering: on } });
      hud.setToast(
        on
          ? 'precise control on — mouse or A/D holds the wheel'
          : 'precise control off — steering self-centres',
      );
    }
    input.setPreciseSteering(s.settings.preciseSteering && driving !== null);

    if (driving) {
      // setEnabled early-returns when unchanged, so calling it every tick is free.
      player.setEnabled(false);
      // Camera calibration owns the driving keys while enabled: the car must stay
      // still while W/S/A/D/Z/X move the interior eye.
      if (f.cycleCamera) camera.cycleDriving();
      if (f.toggleSeatAdjust) {
        const wasAdjusting = camera.isSeatAdjusting;
        camera.toggleSeatAdjusting();
        if (wasAdjusting && !camera.isSeatAdjusting) {
          const coordinates = camera.interiorCoordinates;
          const interiorCameraOffset = [coordinates.x, coordinates.y, coordinates.z] as const;
          camera.setInteriorCameraOffset(interiorCameraOffset);
          world.apply({
            t: 'settings',
            settings: { ...s.settings, interiorCameraOffset },
          });
          hud.setToast(
            `interior camera saved · ${coordinates.x.toFixed(3)}, ` +
            `${coordinates.y.toFixed(3)}, ${coordinates.z.toFixed(3)}`,
          );
        }
      }
      if (f.toggleInteriorHeadMovement && camera.mode === 'interior') {
        camera.toggleInteriorHeadMovement();
        hud.setToast(
          camera.isHeadMovementEnabled
            ? 'interior head movement on'
            : 'interior head movement off — fixed to seat point',
        );
      }
      const calibratingSeat = camera.isSeatAdjusting;
      // One key cycles the complete driving state: sleeper -> frantic -> off.
      // Keeping the transition here means the HUD, input handover and controller
      // always observe the same state on the same fixed step.
      if (f.toggleAutopilot) {
        if (!autopilot.engaged) {
          autopilot.setMode('sleeper');
          autopilot.setEngaged(true);
        } else if (autopilot.mode === 'sleeper') {
          autopilot.setMode('frantic');
        } else {
          autopilot.setEngaged(false);
        }
        hud.setToast(
          autopilot.engaged ? `autopilot: ${autopilot.mode}` : 'autopilot off',
        );
      }
      if (autopilot.engaged && !calibratingSeat) {
        autopilot.drive(dt, driving, f, origin.x, origin.z);
      }
      if (calibratingSeat) {
        f.throttle = 0;
        f.brake = 0;
        f.reverse = false;
        f.steer = 0;
        f.shift = 0;
      }
      driving.fixedUpdate(dt, f);
      if (f.toggleLights) driving.cycleHeadlights();
      if (f.toggleLeftIndicator) driving.toggleIndicator('left');
      if (f.toggleRightIndicator) driving.toggleIndicator('right');
      if (f.cycleTyres) {
        driving.cycleTyreCompound();
        hud.setToast(`tyres: ${driving.tyreCompoundLabel}`);
      }
    } else {
      player.setEnabled(true);
      // Stepping out drops it. Re-entering a car and finding it drive itself is a
      // surprise nobody asked for.
      autopilot.setEngaged(false);
      // The pack's weight is a movement input like any other, so it is pushed every
      // tick rather than on inventory change: `add`/`remove` are not the only things
      // that move the number (a fuel can drains as it pours, ammo stacks shrink as
      // they are fired), and there is no cheaper honest place to notice that.
      player.setCarriedRatio(inventory.carriedMass / inventory.massLimit);
      player.fixedUpdate(dt, f, camera.yaw);
      if (f.cycleCamera) camera.setMode('foot');
    }

    // Every other car still needs its suspension solved, or it has no springs at
    // all: Rapier recomputes suspension force inside updateVehicle, so a vehicle
    // that is never stepped sinks onto its own chassis collider and its wheels end
    // up under the road. `settle` does the suspension and a holding brake only.
    for (const [id, vehicle] of vehicles) {
      if (id !== drivingId) vehicle.settle(dt);
    }

    // Trailers get the same treatment for the same reason: their springs only exist
    // inside `updateVehicle`, towed or standing.
    trailerField.fixedUpdate(dt, (carId) => vehicles.get(carId)?.brakeCommand ?? 0);

    // Advance the simulation only after every controller has written its intent for
    // this tick (wheel forces, kinematic character motion). Interaction raycasts
    // below then query the post-step world, so prompts match what is on screen.
    physics.step();

    // Recover only after Rapier has produced the escaped pose, before origin
    // rebasing and interpolation latches can preserve that pose for another frame.
    recoverUnderworld();

    // FLOATING ORIGIN. Here and nowhere else: after the solver has run, before the
    // post-step latches read a single transform. Everything downstream this frame —
    // the interpolation snapshots, the camera, the HUD, the save deltas — then observes
    // one origin, and no `translation()` read is ever separated from its matching
    // `setTranslation` write by a kilometre. The trailer's hitch enforcement is the
    // reason that matters: it has a 1.5 m drift guard, and a rebase landing inside its
    // read/write pair would read as the trailer having teleported.
    //
    // The anchor is whatever the player is: the driven chassis, or the character on
    // foot. Bodies hold RELATIVE positions, so the origin is added back to get the
    // absolute position `advance` wants.
    {
      const anchor = activeWorldAnchor();
      const shift = origin.advance(anchor.x, anchor.z);
      if (shift) {
        physics.rebase(shift.dx, shift.dz);
        streamer.rebase();
        desert.rebase();
        rebasedThisFrame = true;
      }

      // Lifetime changes follow the solve and any origin shift, never interrupting
      // controller/hitch writes. Cars resolve first, then their trailers, then loose
      // objects so a live coupling is available to the trailer field.
      reconcileActiveWorld(anchor.x, anchor.z);
    }

    // Latch the post-step transforms so the renderer can interpolate between the
    // last two steps instead of snapping to the newest one.
    for (const vehicle of vehicles.values()) vehicle.postStep();
    trailerField.postStep();
    player.postStep();

    // Item selection: the number row wins over the cycle keys when both arrive in
    // the same tick, since a direct pick is the more specific intent.
    if (f.selectSlot > 0) inventory.selectIndex(f.selectSlot - 1);
    else if (f.cycleItem !== 0) inventory.cycle(f.cycleItem);

    // E owns held-item toggles/equipping. F remains the physical world action,
    // including vehicle entry, so using an item can never also touch the aimed car.
    const heldAfterSelection = inventory.held;
    if (driving !== null || heldAfterSelection?.type !== 'binoculars') binocularsActive = false;
    if (driving !== null || heldAfterSelection?.type !== 'torchlight') torchlightActive = false;
    if (driving === null && f.useHeld && heldAfterSelection?.type === 'binoculars') {
      binocularsActive = !binocularsActive;
    } else if (driving === null && f.useHeld && heldAfterSelection?.type === 'torchlight') {
      torchlightActive = !torchlightActive;
    }
    if (f.useHeld && heldAfterSelection?.type === 'sun_shades') {
      const previous = s.player.wornSunShades;
      const next = inventory.remove(heldAfterSelection.id);
      if (next?.type === 'sun_shades') {
        if (previous !== null) inventory.add(previous);
        world.apply({ t: 'wearable', shades: next });
        hud.setToast(`${next.tint} sun shades on — G to remove`);
      }
    }
    if (f.removeWearable && s.player.wornSunShades !== null) {
      const worn = s.player.wornSunShades;
      world.apply({ t: 'wearable', shades: null });
      if (inventory.add(worn)) {
        hud.setToast(`${worn.tint} sun shades removed`);
      } else {
        const p = player.position;
        loose.spawnItem(worn, p.x + origin.x, p.y, p.z + origin.z);
        hud.setToast(`${worn.tint} sun shades removed — pack full, dropped`);
      }
    }

    // One charge is consumed immediately. Three seconds of chewing come first;
    // only then does the screen-space bubble grow for five seconds before popping.
    const gum = inventory.held;
    const gumPressed = f.usePrimary && !gumUseHeld;
    gumUseHeld = f.usePrimary;
    if (!driving && !gumActive && gum?.type === 'bubble_gum' && gumPressed) {
      gum.charges -= 1;
      gumPackCharges = Math.max(0, gum.charges);
      if (gum.charges <= 0) inventory.remove(gum.id);
      gumActive = true;
      gumTimer = 0;
    }
    if (gumActive) {
      gumTimer += dt;
      if (gumTimer >= GUM_USE_SECONDS) {
        const p = player.position;
        let nearest: { flipOver(): void } | null = null;
        let nearestKind: 'car' | 'trailer' | null = null;
        let nearestDistSq = Infinity;
        for (const vehicle of vehicles.values()) {
          if (!vehicle.touchesSphere(p.x, p.y, p.z, GUM_FLIP_RADIUS)) continue;
          const t = vehicle.chassis.translation();
          const distSq = (t.x - p.x) ** 2 + (t.y - p.y) ** 2 + (t.z - p.z) ** 2;
          if (distSq < nearestDistSq) {
            nearest = vehicle;
            nearestKind = 'car';
            nearestDistSq = distSq;
          }
        }
        trailerField.forEach((trailer) => {
          if (!trailer.touchesSphere(p.x, p.y, p.z, GUM_FLIP_RADIUS)) return;
          const t = trailer.rigidBody.translation();
          const distSq = (t.x - p.x) ** 2 + (t.y - p.y) ** 2 + (t.z - p.z) ** 2;
          if (distSq < nearestDistSq) {
            nearest = trailer;
            nearestKind = 'trailer';
            nearestDistSq = distSq;
          }
        });
        nearest?.flipOver();
        audio.bubbleGumPop();
        hud.setToast(
          nearestKind === null
            ? 'POP — no car or trailer close enough'
            : `POP — ${nearestKind} flipped`,
        );
        gumActive = false;
        gumTimer = 0;
      }
    }

    const eye = camera.eyePosition;
    const dir = camera.eyeDirection;
    const interacted = interaction.fixedUpdate(
      dt,
      f,
      eye.x,
      eye.y,
      eye.z,
      dir.x,
      dir.y,
      dir.z,
      activeS,
    );
    prompt = interacted.prompt;
    boot = interacted.boot;
    if (interacted.sound) audio.foley(interacted.sound);
    audio.setContinuous(interacted.continuous);
    audio.updateBubbleGum(
      dt,
      gumActive ? (gumTimer < GUM_CHEW_SECONDS ? 'chew' : 'blow') : 'idle',
    );
    // Footsteps come off the character controller's achieved speed and supporting
    // collider, so they stop at a wall and change timbre at the road/desert seam.
    // Seated, there is no capsule moving and the voice is silent by construction.
    audio.updateFoot(dt, driving ? 0 : player.groundSpeed, player.grounded, player.groundSurface);

    // Radio: a car fitting, so the keys only do anything from the seat.
    if (driving) {
      if (f.radioToggle) hud.setToast(audio.toggleRadio(drivingId!));
      if (f.radioNext) hud.setToast(audio.nextStation(drivingId!));
    }

    // Shooting: the held item decides. A kill only enters the inventory if it fits,
    // so a full pack means the bird is lost rather than silently teleported in.
    const held = inventory.held;
    if (held && held.type === 'weapon' && f.usePrimary) {
      const shot = weapons.tryFire(held, f.useSecondary, eye, dir, birds, inventory, dt);
      if (shot.result === 'fired') {
        audio.gunshot();
        if (shot.hit) {
          const added = inventory.add({
            type: 'quarry',
            id: world.runtimePartId(),
            species: shot.hit.species,
            mass: shot.hit.mass,
          });
          hud.setToast(added ? `bagged a ${shot.hit.species}` : 'too heavy to carry');
        }
      } else if (shot.result === 'empty') {
        audio.dryFire();
        weapons.reload(held, inventory);
        audio.reload();
      }
    }

    // The spine's heading stays within ±90 degrees now, so its +Z projection is
    // strictly monotone and no distant branch can sit beside this one. A local hinted
    // projection is therefore the complete answer during continuous driving; the
    // expensive unhinted sweep this used to fall back to existed only to arbitrate
    // self-overlapping passes.
    let desertX: number;
    let desertZ: number;
    let desertLateral: number;
    if (driving) {
      // Absolute: the road and desert tile keys both live in world space while the
      // chassis is relative to the floating origin.
      const t = driving.absoluteTranslation(originAnchor);
      const projection = road.project(t.x, t.z, activeS);
      activeS = projection.s;
      desertX = t.x;
      desertZ = t.z;
      desertLateral = projection.lateral;
    } else {
      const p = player.absolutePosition;
      const projection = road.project(p.x, p.z, player.s);
      activeS = projection.s;
      desertX = p.x;
      desertZ = p.z;
      desertLateral = projection.lateral;
    }
    // Fairly alternate first access to the one-job frame budget. Road remains first
    // on one frame and desert on the next; an idle subsystem consumes nothing, so
    // the other still proceeds without delay.
    if ((frameId & 1) === 0) {
      streamer.update(activeS, frameId, desertLateral);
      desert.update(desertX, desertZ, desertLateral, frameId);
    } else {
      desert.update(desertX, desertZ, desertLateral, frameId);
      streamer.update(activeS, frameId, desertLateral);
    }
    birds.update(dt, activeS, eye.x, eye.y, eye.z);

    // Props that come apart. The car is the only thing heavy enough to do it, so the
    // impactor is the driven chassis: absolute centre, its own forward,
    // the half extents measured off its model, and its world velocity. Filled in the
    // FIXED step rather than per frame, because breaking is a physics event and must
    // not happen twice for one step's worth of motion.
    if (driving) {
      const t = driving.absoluteTranslation(originAnchor);
      const q = driving.chassis.rotation();
      // Chassis-local +z is forward (render/carmodel.ts measures half-length on z).
      impactForward.set(0, 0, 1).applyQuaternion(impactQuat.set(q.x, q.y, q.z, q.w));
      const flat = Math.hypot(impactForward.x, impactForward.z) || 1;
      const v = driving.chassis.linvel();
      const half = driving.modelMeasure.halfExtents;
      impactor.x = t.x;
      impactor.y = t.y;
      impactor.z = t.z;
      impactor.fx = impactForward.x / flat;
      impactor.fz = impactForward.z / flat;
      impactor.halfWidth = half[0];
      impactor.halfLength = half[2];
      impactor.vx = v.x;
      impactor.vy = v.y;
      impactor.vz = v.z;
      debris.update(impactor, dt, desertX, desertZ);
      const tumbleweedHit = tumbleweeds.update(dt, activeS, impactor);
      if (tumbleweedHit.count > 0) {
        // 45 N·s on a roughly 1.5 t chassis is a 0.03 m/s brush: comparable to a
        // cactus slice's lightest debris contact, below the collision damage floor.
        driving.chassis.applyImpulse({ x: impactor.fx * 45, y: 0, z: impactor.fz * 45 }, true);
        audio.foley('drop');
      }
    } else {
      // Do not sweep from the last driven car position across a period spent on foot
      // (or across switching vehicles); that path was never travelled by one chassis.
      debris.update(null, dt, desertX, desertZ);
      tumbleweeds.update(dt, activeS, null);
    }

    recordTimer += dt;
    if (recordTimer >= RECORD_INTERVAL) {
      recordTimer = 0;
      if (activeS > s.recordS) world.apply({ t: 'record', s: activeS });
      // Trailers have no delta of their own for motion — a towed one moves every
      // tick — so their poses ride the same cadence as the record marker.
      trailerField.pushTransforms();
    }
  };

  // Reused for the interpolated chassis pose handed to the camera each frame.
  const targetPos = new THREE.Vector3();
  const targetQuat = new THREE.Quaternion();

  /**
   * Resolves the exact surface beneath a terrain-collider contact. Tiles use one
   * collider registration while their field still contains sand, gravel and rock.
   */
  const wheelSurface = (ws: WheelSprayState): SurfaceType => {
    if (ws.surface !== TERRAIN_COLLIDER_SURFACE) return ws.surface;
    const p = road.project(ws.absoluteContactX, ws.absoluteContactZ, activeS);
    return terrain.surfaceFromFrame(ws.absoluteContactX, ws.absoluteContactZ, p.lateral);
  };

  /**
   * Leaves a pooled ground mark and throws spray from one wheel contact. Both effects
   * share the resolved surface so terrain projection is paid once per wheel.
   *
   * Tracks accept honest rolling contact on sand; slip only widens and darkens them.
   * Spray retains its slip floor, because a rolling tyre leaves a track without
   * necessarily throwing material into the air.
   */
  const emitWheelEffects = (ws: WheelSprayState, frameDt: number): void => {
    if (!ws.inContact) {
      tyreTracks.sample(ws, false);
      return;
    }
    const terrainContact = ws.surface === TERRAIN_COLLIDER_SURFACE;
    const surface = wheelSurface(ws);
    // The visible verge is the same loose ground mesh and should mark immediately at
    // the asphalt edge; its finer gravel/sand classification remains relevant to spray.
    tyreTracks.sample(ws, terrainContact);
    const slip = Math.max(Math.abs(ws.slipRatio), ws.slideT);
    if (slip <= SPRAY_MIN_SLIP) return;

    const props = SURFACES[surface];

    // A tyre flings at its surface speed, not the chassis'. Chassis speed reads
    // zero during a held burnout (wheels spinning, car stationary), so floor it at
    // the slip speed: slip ratio is (ωr − v)/ref, so ωr ≈ v + slip·ref.
    const speed = Math.max(Math.abs(ws.forwardSpeed), slip * SPRAY_REF_SPEED);
    const raise = props.dust + props.smoke * SPRAY_SMOKE_YIELD;
    const strength = raise * slip * speed;
    if (strength <= 0) return;
    wheelSpray.emit(
      ws.contactX,
      ws.contactY,
      ws.contactZ,
      ws.forwardX,
      ws.forwardZ,
      strength,
      (props.smoke * SPRAY_SMOKE_YIELD) / raise,
      frameDt,
    );
  };

  const render = (alpha: number, frameDt: number): void => {
    frameId++;
    const s = world.state;
    const drivingId = s.player.drivingCarId;
    const driving = drivingId ? (vehicles.get(drivingId) ?? null) : null;

    for (const vehicle of vehicles.values()) {
      vehicle.syncVisuals(alpha);
      // Dirt and impact records are read from the Vehicle's live accumulators, not
      // the batched save state: a collision or brush stroke must land this frame.
      setCarBodyCondition(
        vehicle.root,
        vehicle.bodyDirt,
        vehicle.bodyScratches,
        vehicle.bodyDamage,
      );
    }
    // Trailer physics advances and snapshots in the fixed step exactly like cars,
    // but its scene root must also consume those snapshots every rendered frame.
    // Without this call the rigid body and hitch moved while the GLB stayed forever
    // at its constructor pose, leaving an invisible trailer attached to the car.
    trailerField.syncVisuals(alpha);
    loose.syncVisuals();
    debris.syncVisuals();

    // Ground effects share one wheel report. Spray ages every frame; tracks retain the
    // bounded recent route. Nothing is emitted on a surface whose profile rejects it.
    //
    // Fed by the driven car AND every trailer: an unpowered or locked trailer tyre can
    // disturb sand exactly like a car tyre, and the shared state keeps both paths identical.
    wheelSpray.update(frameDt, activeS);
    if (driving) {
      for (const ws of driving.wheelSpray) emitWheelEffects(ws, frameDt);
    }
    trailerField.forEachSpray((ws) => emitWheelEffects(ws, frameDt));

    if (driving) {
      driving.interpolatedTransform(alpha, targetPos, targetQuat);
      const eyePoint = driving.eyePoint;
      target.x = targetPos.x;
      target.y = targetPos.y;
      target.z = targetPos.z;
      target.qx = targetQuat.x;
      target.qy = targetQuat.y;
      target.qz = targetQuat.z;
      target.qw = targetQuat.w;
      target.speedKmh = driving.speedKmh;
      target.eyeOffset = eyePoint;
    } else {
      const p = player.interpolatedPosition(alpha);
      target.x = p.x;
      // CameraRig's foot mode adds its own eye height, so hand it the FEET
      // position; `player.position` is the capsule centre and would double up.
      target.y = p.y - Player.FEET_OFFSET;
      target.z = p.z;
      target.qx = 0;
      target.qy = 0;
      target.qz = 0;
      target.qw = 1;
      target.speedKmh = 0;
      target.eyeOffset = [0, 0, 0];
    }

    Object.assign(cameraInput, lastInput);
    cameraInput.lookYaw = lookYawAccum;
    cameraInput.lookPitch = lookPitchAccum;
    cameraInput.zoomDelta = zoomAccum;
    cameraInput.recenterCamera = recenterAccum;
    lookYawAccum = 0;
    lookPitchAccum = 0;
    zoomAccum = 0;
    recenterAccum = false;
    const usingBinoculars =
      driving === null && inventory.held?.type === 'binoculars' && binocularsActive;
    const usingTorchlight =
      driving === null && inventory.held?.type === 'torchlight' && torchlightActive;
    camera.setBinoculars(usingBinoculars);
    camera.update(frameDt, cameraInput, target, driving === null);
    hud.setSeatCalibration(
      camera.isSeatAdjusting,
      driving ? carModel(s.cars[drivingId!]?.modelId ?? DEFAULT_CAR_MODEL_ID).label : '',
      camera.interiorCoordinates,
    );

    const cam = renderer.camera.position;
    sky.update(
      s.calendarEpoch,
      s.timeOfDay,
      s.dayIndex,
      activeS,
      cam.x,
      cam.y,
      cam.z,
    );
    const headlightVisibility = sky.artificialLightFactor;
    for (const vehicle of vehicles.values()) {
      vehicle.setHeadlightEnvironmentFactor(headlightVisibility);
    }

    // Every lit lamp in the active world casts its beam, not just the driven car's.
    //
    // This runs AFTER the environment factor above, because that factor is a
    // multiplier on the beam intensities the rig is about to read; projecting first
    // spent a frame on yesterday's twilight. The offer order is the priority order
    // the rig allocates in — driven car first, then nearest to the camera — so the
    // only beams a full pool can refuse are the farthest ones.
    litVehicles.length = 0;
    for (const vehicle of vehicles.values()) {
      if (vehicle.hasLitLamps) litVehicles.push(vehicle);
    }
    if (litVehicles.length > 1) {
      litVehicles.sort(
        (a, b) =>
          (a === driving ? -1 : a.root.position.distanceToSquared(cam)) -
          (b === driving ? -1 : b.root.position.distanceToSquared(cam)),
      );
    }
    vehicleLights.beginFrame();
    for (const vehicle of litVehicles) vehicle.syncProjectedLights(vehicleLights);
    vehicleLights.endFrame();

    // Eye height for heat haze. The exact local road frame is still useful near the
    // corridor; farther out the same terrain method is the player-centred fine field.
    const camProjection = road.project(cam.x + origin.x, cam.z + origin.z, activeS);
    renderer.setHazeEyeHeight(
      cam.y -
        terrain.explorationHeightFromFrame(
          cam.x + origin.x,
          cam.z + origin.z,
          camProjection.lateral,
          camProjection.s,
        ),
    );
    // Then thin the whole thing for the chosen draw distance. The exponential fog is
    // tuned so the world dissolves around 1.5 km, which is exactly right when 1.5 km
    // is all there is and hides the vista completely when there is more: at the 'vast'
    // scale factor a 25 km range still fades, it just fades over 25 km.
    renderer.fog.density *= VIEW_DISTANCE_FOG_SCALE[s.settings.viewDistance];

    // The disc only rebuilds when the camera has left the patch it was built for, so
    // this is a pair of comparisons on most frames.
    vista.update(cam.x, cam.z, activeS);
    // A daylight-only middle-distance illusion. It never modifies Sky or Audio; the
    // sky's computed daylight is only a visibility gate protecting the night view.
    mirage.update(activeS, sky.dayFactor);

    // Night lamps expose exactly three lit pools ahead and three behind the view.
    // The renderer keeps six persistent slots, so crossing a lamp boundary does not
    // change its light-shader permutation or hitch the frame.
    //
    // The factor is a RAMP across the twilight band, not `isNight`. Both consumers
    // scale intensity by it — `setLamps` for emissive and point output, and the
    // budget by copying each chosen source's own intensity — so the lamps now come
    // up over the dusk instead of every one in view switching within a frame. The
    // slot count is unchanged at either end, so the shader permutation still never
    // moves.
    const night = sky.lampFactor;
    // `setLamps` takes an ABSOLUTE camera position: the lamps it compares against were
    // stored relative to the origin their chunk was BUILT under, which after a rebase
    // is not the current one, so the chunk's own build origin is the bridge and only
    // an absolute camera makes the two sides comparable. See props.ts setLamps.
    streamer.setLamps(night, cam.x + origin.x, cam.z + origin.z);
    const lampDirection = camera.eyeDirection;
    lightBudget.update(
      cam.x,
      cam.y,
      cam.z,
      lampDirection.x,
      lampDirection.z,
      night,
      streamer.lampRevision,
    );

    if (driving) {
      const stats = driving.stats;
      const car = s.cars[drivingId!];
      const waterCap = bonnetWaterCapacity(car?.bonnet ?? []);
      const oilCap = oilCapacity(stats.engine);
      hud.setDriving({
        speedKmh: driving.speedKmh,
        rpm: driving.rpm,
        redlineRpm: stats.engine.redlineRpm,
        gearLabel: driving.gearLabel,
        fuelLitres: car?.fuelLitres ?? 0,
        tankCapacity: stats.tankCapacity,
        temperature: driving.engineTemperature,
        // No radiator fitted means no capacity, and the lamp treats that as dry —
        // which it is: there is nowhere for water to be.
        waterFraction: waterCap > 0 ? (car?.waterLitres ?? 0) / waterCap : 0,
        oilFraction: oilCap > 0 ? (car?.oilLitres ?? 0) / oilCap : 1,
        engineRunning: driving.engineRunning,
        engineDestroyed: driving.engineDestroyed,
        handbrake: lastInput.handbrake,
        tcsActive: driving.tcsActive,
      });
    } else {
      hud.setDriving(null);
    }

    // Car audio follows the camera, not the simulation: whether the shell is
    // between the listener and the noise is what decides how the engine, wind and
    // tyres are filtered, and that is a view question. The radio additionally keeps
    // its last car as a spatial source after the player steps out.
    radioSpatial.sourceX = driving?.root.position.x ?? null;
    radioSpatial.sourceY = driving?.root.position.y ?? null;
    radioSpatial.sourceZ = driving?.root.position.z ?? null;
    radioSpatial.listenerX = cam.x;
    radioSpatial.listenerY = cam.y;
    radioSpatial.listenerZ = cam.z;
    radioSpatial.listenerQx = renderer.camera.quaternion.x;
    radioSpatial.listenerQy = renderer.camera.quaternion.y;
    radioSpatial.listenerQz = renderer.camera.quaternion.z;
    radioSpatial.listenerQw = renderer.camera.quaternion.w;
    audio.updateDriving(
      driving ? driving.audio : null,
      camera.mode === 'interior',
      radioSpatial,
      driving ? drivingId! : null,
    );
    hud.setRadio(audio.radioReadout);

    hud.setPrompt(prompt);
    trunkView.update(
      boot,
      boot?.owner === 'car' ? (vehicles.get(boot.id) ?? null) : null,
      boot?.owner === 'wreck' ? wreckTrunks.get(boot.id) : null,
      alpha,
      origin,
    );
    hud.setInventory(
      inventory.all,
      inventory.selectedIndex,
      inventory.carriedMass,
      inventory.massLimit,
    );
    const gumBlowing = gumActive && gumTimer >= GUM_CHEW_SECONDS;
    hud.setBubbleGum(gumBlowing, (gumTimer - GUM_CHEW_SECONDS) / GUM_GROW_SECONDS);
    hud.setTravel(activeS / 1000, s.timeOfDay);

    // Viewmodel and slot previews are pure views of existing state, so they update
    // here rather than in the fixed step: they should track the smoothed camera.
    const held = inventory.held;
    const gumUseProgress =
      gumActive && gumTimer < GUM_PACK_ANIM_SECONDS
        ? gumTimer / GUM_PACK_ANIM_SECONDS
        : -1;
    const heldUse =
      held?.type === 'binoculars'
        ? usingBinoculars
        : held?.type === 'torchlight'
          ? usingTorchlight
          : lastInput.usePrimary;
    heldView.update(held, camera.mode, frameDt, {
      usePrimary: heldUse,
      moveMag: Math.min(1, Math.hypot(lastInput.moveX, lastInput.moveZ)),
      speedKmh: target.speedKmh,
      gumUseProgress,
      gumCharges: gumPackCharges,
    });

    // Ghosts are an on-foot mounting aid; while driving there is nothing to fit, and
    // `interaction.lastAnchorTarget` is stale because anchor resolution is skipped.
    const ghost = driving ? null : activeCar();
    const ghostCar = ghost ? s.cars[ghost.id] : undefined;
    anchorGhosts.update(
      ghostCar && ghost ? ghost.vehicle : null,
      ghost ? ghost.vehicle.modelMeasure.anchors : [],
      ghostCar ? ghostCar.gizmos : {},
      // Same rule the interaction resolve uses (`hasServiceSlot`): an engine, turbine,
      // radiator or fuel tank cannot be mounted on a cosmetic anchor, so it must
      // not be previewed on one either. Its home is a bonnet slot.
      held && held.type === 'part' && !hasServiceSlot(held.part.variantId)
        ? held.part.variantId
        : null,
      interaction.lastAnchorTarget,
      frameDt,
    );

    // GPU timer queries measure only render submission. The one startup PMREM bake
    // is excluded because it is a different GPU workload; ordinary frames, including
    // the whole day-night transition, remain eligible for adaptive resolution.
    const adaptationEligible = !sky.didBakeEnvironmentThisFrame;
    renderer.adaptResolution(adaptationEligible, driving === null);
    rebasedThisFrame = false;
    renderer.setHazeStrength(sky.dayFactor);
    renderer.setItemViewEffects(
      s.player.wornSunShades?.tint ?? null,
      usingBinoculars,
      usingTorchlight,
    );
    renderer.render();
  };

  const loop = new GameLoop({ fixedUpdate, render });
  loading.classList.add('is-hidden');
  loop.start();

  /**
   * The dev spawn tool behind `PauseHooks.spawnVehicle`. Defined unconditionally so
   * it typechecks in both builds; referenced only under `import.meta.env.DEV`, which
   * is how the bundler drops it from a production build.
   */
  const devSpawnVehicle = (request: SpawnRequest): void => {
    // Put the car on the ground ahead of the view, not at the player's feet: a
    // chassis spawned inside the player (or inside the car being driven) would be
    // resolved by the solver as an explosion.
    const eye = camera.eyePosition;
    const dir = camera.eyeDirection;
    const flat = Math.hypot(dir.x, dir.z) || 1;
    const measure = carModelMeasure(request.modelId);
    // Spawned nose-in ahead of the player, so the drop point is a gap plus the
    // body's own half-length: the semi is 12 m long and its middle has to be 6 m
    // further out than a hatchback's.
    const ahead = SPAWN_AHEAD_GAP + measure.halfExtents[2];
    const dropX = eye.x + (dir.x / flat) * ahead;
    const dropZ = eye.z + (dir.z / flat) * ahead;
    const ground = physics.raycast(
      { x: dropX, y: eye.y + SPAWN_PROBE_HEIGHT, z: dropZ },
      { x: 0, y: -1, z: 0 },
      SPAWN_PROBE_HEIGHT + 12,
      player.rigidBody,
    );
    const groundY = ground ? ground.point.y : eye.y;

    // Keep the complete model clear of the surface. Gravity and the ray-cast
    // suspension establish its real resting height after materialisation.
    const y = carSpawnYAboveGround(measure, groundY);
    const heading = Math.atan2(dir.x / flat, dir.z / flat);
    // `dropX`/`dropZ` are relative — they came off the camera and fed a Rapier ray.
    // `spawnCarState` writes a saved `CarState`, which is absolute.
    spawnCarState(world, request, dropX + origin.x, y, dropZ + origin.z, heading);
    hud.setToast(`spawned ${carModel(request.modelId).label}`);
  };

  /**
   * The dev spawn tool behind `PauseHooks.spawnTrailer`. Mirrors `devSpawnVehicle`:
   * dropped ahead of the view on a ground raycast, clear of the player and any car
   * so the solver cannot resolve a trailer spawned inside a chassis as an explosion.
   */
  const devSpawnTrailer = (): void => {
    const eye = camera.eyePosition;
    const dir = camera.eyeDirection;
    const flat = Math.hypot(dir.x, dir.z) || 1;
    const ahead = SPAWN_AHEAD_GAP + TRAILER_HALF_LENGTH;
    const dropX = eye.x + (dir.x / flat) * ahead;
    const dropZ = eye.z + (dir.z / flat) * ahead;
    const ground = physics.raycast(
      { x: dropX, y: eye.y + SPAWN_PROBE_HEIGHT, z: dropZ },
      { x: 0, y: -1, z: 0 },
      SPAWN_PROBE_HEIGHT + 12,
      player.rigidBody,
    );
    const groundY = ground ? ground.point.y : eye.y;
    const y = groundY + TRAILER_SPAWN_HEIGHT + TRAILER_DROP_CLEARANCE;
    const heading = Math.atan2(dir.x / flat, dir.z / flat);
    const half = heading / 2;
    trailerField.spawn({
      id: world.runtimePartId(),
      hitchedTo: null,
      cargoKg: 0,
      x: dropX + origin.x,
      y,
      z: dropZ + origin.z,
      qx: 0,
      qy: Math.sin(half),
      qz: 0,
      qw: Math.cos(half),
    });
    hud.setToast('spawned trailer');
  };

  /**
   * The dev item dispenser behind `PauseHooks.spawnItem`.
   *
   * Dropped just in front of the player rather than out on the ground raycast the
   * vehicle spawns use: these are pickups, and the useful thing is to have one in
   * reach immediately. They go through `loose.spawnItem` like found stock, so the
   * dev picker exercises the real pickup, storage and use paths.
   */
  const devSpawnItem = (request: DevSpawnItemRequest): void => {
    const eye = camera.eyePosition;
    const dir = camera.eyeDirection;
    const flat = Math.hypot(dir.x, dir.z) || 1;
    const dropX = eye.x + (dir.x / flat) * 1.2;
    const dropZ = eye.z + (dir.z / flat) * 1.2;
    const ground = physics.raycast(
      { x: dropX, y: eye.y + SPAWN_PROBE_HEIGHT, z: dropZ },
      { x: 0, y: -1, z: 0 },
      SPAWN_PROBE_HEIGHT + 12,
      player.rigidBody,
    );
    const groundY = ground ? ground.point.y : eye.y;
    let item: Item;
    switch (request.type) {
      case 'fluid_can':
        item = {
          type: 'fluid_can',
          id: world.runtimePartId(),
          fluid: request.fluid,
          capacity: request.capacity,
          litres: request.capacity,
        };
        break;
      case 'bubble_gum':
        item = { type: 'bubble_gum', id: world.runtimePartId(), charges: 5 };
        break;
      case 'binoculars':
        item = { type: 'binoculars', id: world.runtimePartId() };
        break;
      case 'torchlight':
        item = { type: 'torchlight', id: world.runtimePartId() };
        break;
      case 'sun_shades':
        item = { type: 'sun_shades', id: world.runtimePartId(), tint: request.tint };
        break;
    }
    loose.spawnItem(item, dropX + origin.x, groundY + 0.3, dropZ + origin.z);
    hud.setToast(`spawned ${itemLabel(item)}`);
  };

  /**
   * The dev righting tool behind `PauseHooks.flipVehicle`.
   *
   * Seated, it targets the car being driven — no proximity test can be wrong about
   * that one. On foot it takes the nearest car or trailer within `DEV_FLIP_RADIUS`,
   * which is deliberately looser than the gum's `GUM_FLIP_RADIUS` contact test: the
   * gum is a consumable the player has to walk up to and chew, this is a button.
   * Both end in the same `flipOver`, so a dev flip and a popped bubble leave the
   * vehicle in exactly the same state.
   */
  const devFlipVehicle = (): void => {
    // `world.state.player.drivingCarId`, NOT `activeCar()`: that helper falls back to
    // the nearest car with no distance limit, so on foot it would right a car a
    // kilometre away and never consider a trailer.
    const drivingId = world.state.player.drivingCarId;
    const driven = drivingId ? vehicles.get(drivingId) : undefined;
    if (driven) {
      driven.flipOver();
      hud.setToast('flipped the car you are driving');
      return;
    }
    const p = player.position;
    let nearest: { flipOver(): void } | null = null;
    let nearestKind: 'car' | 'trailer' | null = null;
    let nearestDistSq = DEV_FLIP_RADIUS * DEV_FLIP_RADIUS;
    for (const vehicle of vehicles.values()) {
      const t = vehicle.chassis.translation();
      const distSq = (t.x - p.x) ** 2 + (t.y - p.y) ** 2 + (t.z - p.z) ** 2;
      if (distSq < nearestDistSq) {
        nearest = vehicle;
        nearestKind = 'car';
        nearestDistSq = distSq;
      }
    }
    trailerField.forEach((trailer) => {
      const t = trailer.rigidBody.translation();
      const distSq = (t.x - p.x) ** 2 + (t.y - p.y) ** 2 + (t.z - p.z) ** 2;
      if (distSq < nearestDistSq) {
        nearest = trailer;
        nearestKind = 'trailer';
        nearestDistSq = distSq;
      }
    });
    nearest?.flipOver();
    hud.setToast(
      nearestKind === null
        ? `no car or trailer within ${DEV_FLIP_RADIUS} m`
        : `flipped the nearest ${nearestKind}`,
    );
  };

  /**
   * The pause overlay's window on the game. Settings live in world state (so a save
   * carries them), which is why every mutation routes through `world.apply` here
   * rather than being held in the menu: the menu is a view, not an owner.
   */
  const pauseHooks: PauseHooks = {
    settings: () => world.state.settings,
    applySettings: (next) => {
      const poiSpacing = world.state.settings.poiSpacingMetres;
      world.apply({ t: 'settings', settings: next });
      // POI chunks rebuild one at a time after Resume. That keeps a slider drag and
      // a dense 500 m stop layout from turning the pause-menu interaction into a
      // multi-second main-thread task.
      if (world.state.settings.poiSpacingMetres !== poiSpacing) streamer.refreshProvider('poi');
      // Input and audio cache device-facing preferences; push them immediately.
      input.setKeyBindings(world.state.settings.keyBindings);
      input.setMouseSensitivity(world.state.settings.mouseSensitivity);
      audio.applySettings(world.state.settings);
      renderer.setMsaa(world.state.settings.msaa);
      renderer.setInkStrength(world.state.settings.inkStrength);
      // Resolution, shadows, MSAA and the sky (probe resolution and star depth)
      // update in place. The lamp-slot count cannot: changing visible-light count
      // would recompile every lit material, so graphics quality changes that
      // budget only on the next load.
      renderer.setQuality(world.state.settings.graphicsQuality);
      sky.setQuality(world.state.settings.graphicsQuality);
    },
    applyTimePreset: (preset) => {
      world.apply({ t: 'time_of_day', timeOfDay: TIME_OF_DAY_PRESETS[preset] * DAY_LENGTH });
    },
    // The draw distance moves three things at once: the far plane (and, at the top
    // tier, the near plane with it), the fog thinning applied every frame in `render`,
    // and how far the vista disc reaches. Applied here rather than read per frame
    // because two of the three are one-off state on objects that already exist.
    applyViewDistance: (tier) => {
      const metres = VIEW_DISTANCE_METRES[tier];
      renderer.setViewDistance(metres);
      vista.setViewDistance(metres);
    },
    exportState: stateForSave,
    // Dev only. Cars are meant to be found in the world and kept — sticker rewards
    // are permanent and do not transfer between vehicles, which is worth nothing if
    // a fully fuelled replacement is two clicks away. `import.meta.env.DEV` is a
    // compile-time constant, so a production build drops the closure and the pause
    // screen that calls it together.
    spawnVehicle: import.meta.env.DEV ? devSpawnVehicle : undefined,
    // Same fold as the car spawn; the trailer button and its closure both vanish
    // from a production build.
    spawnTrailer: import.meta.env.DEV ? devSpawnTrailer : undefined,
    // Same fold again: found consumables are the whole supply economy, so the
    // item dispenser exists only while developing.
    spawnItem: import.meta.env.DEV ? devSpawnItem : undefined,
    // Same fold once more: righting a rolled car is what a gum charge is FOR, so the
    // free instant version is a development tool and nothing else.
    flipVehicle: import.meta.env.DEV ? devFlipVehicle : undefined,
  };

  /**
   * Opens the pause overlay. Called by the Escape key and by the touch MENU button.
   * It stays outside InputReader so it works without pointer lock and while the
   * fixed-step loop is stopped.
   */
  const openPause = (): void => {
    if (paused) return;
    paused = true;
    loop.stop();
    // Silence everything behind the overlay, radio included: the loop is stopped,
    // so nothing would update the voices and they would hold their last value.
    audio.setPaused(true);
    void (async () => {
      const s = world.state;
      const action = await menu.showPause({ seed: s.seed, km: s.player.s / 1000 }, pauseHooks);
      if (action === 'save') {
        const state = stateForSave();
        await saves.save(`slot-${state.seed}`, saveName(state), state);
        hud.setToast('saved');
      }
      menu.hidePause();
      paused = false;
      audio.setPaused(false);
      if (action !== 'quit') loop.start();
      else window.location.reload();
    })();
  };

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape') openPause();
  });

  // Touch: the overlay builds itself on the first canvas touch, so desktop pays
  // only for the dormant listeners.
  const touch = new TouchControls(uiRoot, canvas, { pause: openPause });
  input.attachTouch(touch);
}


void boot().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  document.body.innerHTML = `<pre style="color:#e8dcc4;background:#1a1712;padding:2rem;font:14px monospace">failed to start\n\n${message}</pre>`;
  throw error;
});

// A full reload is the only safe HMR story here: hot-swapping this module would
// leave an orphaned Rapier world and WebGL context behind every edit.
if (import.meta.hot) import.meta.hot.accept(() => window.location.reload());
