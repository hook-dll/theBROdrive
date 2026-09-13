import * as THREE from 'three';
import { FrameProfiler } from './core/frameprofiler';
import { InputReader, emptyInput, type InputFrame } from './core/input';
import { GameLoop } from './core/loop';
import { installScreenWakeLock } from './core/wakelock';
import { PhysicsWorld } from './core/physics';
import { SURFACES, SurfaceType } from './core/surfaces';
import { prefersMobilePresentation, Renderer } from './core/renderer';
import { FIXED_DT } from './core/physics';
import { DAY_LENGTH, GameWorld, newWorldState, type CarState } from './game/state';
import { parseCalendarEpoch } from './game/calendar';
import {
  GRAPHICS_TIERS,
  TIME_OF_DAY_PRESETS,
  loadStoredSettings,
  presentationFpsFor,
  shadowsFor,
  storeSettings,
  viewDistanceFogScaleFor,
  viewDistanceFor,
  type GraphicsQuality,
} from './game/settings';
import { spawnCarState, type SpawnRequest } from './game/spawn';
import {
  CAMERA_FRAME_LIMIT,
  Inventory,
  itemLabel,
  type CameraItem,
  type Item,
} from './items/items';
import { WeaponController } from './items/weapons';
import { LoosePartField } from './parts/loose';
import { oilCapacity, variant, type PartInstance } from './parts/registry';
import { TouchControls } from './core/touch';
import {
  carModelMeasure,
  carSpawnYAboveGround,
  loadCarModel,
  warmCarModelInstances,
} from './render/carmodel';
import { preloadTrailerModel } from './render/trailermodel';
import { DEFAULT_CAR_MODEL_ID, carModel } from './vehicle/carmodels';
import { Interaction } from './player/interaction';
import { Player } from './player/player';
import { PlayerVitals } from './player/vitals';
import { BirdFlock } from './agents/birds';
import { TumbleweedField } from './agents/tumbleweed';
import { CameraRig, type CameraTarget } from './render/cameras';
import { HeldItemView } from './render/held';
import { TrunkView } from './render/trunkview';
import { LightBudget } from './render/lights';
import { Sky } from './render/sky';
import { loadStarField } from './render/starcatalog';
import { VistaMesh } from './render/vista';
import { DistantMirage } from './render/mirage';
import { MirageTableau } from './render/mirage-tableau';
import { LakeWater } from './render/lakewater';
import { roadTextures } from './render/roadtexture';
import { WheelSpray } from './render/wheelspray';
import { SandTyreTracks } from './render/tyretracks';
import { ambientBeamGain, VehicleLightRig } from './render/vehiclelights';
import { ContactPatchField } from './render/contactpatches';
import {
  createStickerMesh,
  createStickerPreviewMesh,
  updateStickerPreview,
} from './render/stickers';
import { ChunkStreamer } from './world/chunks';
import { DesertTileStreamer } from './world/deserttiles';
import {
  HomesteadProvider,
  createStartingCar,
  homesteadSpawn,
  spawnStartingItems,
} from './world/house';
import { TerminusPadProvider } from './world/terminuspad';
import { PoiProvider } from './world/poi';
import { DebrisField, type Impactor } from './world/debris';
import { hasEscapedWorld } from './world/landscape';
import { MonumentProvider, PoleProvider, ScatterProvider } from './world/props';
import { Road, ROAD_LENGTH } from './world/road';
import { WorldOrigin } from './world/origin';
import { HazardIndex } from './world/hazards';
import { RoadTraffic } from './world/traffic';
import { Autopilot } from './vehicle/autopilot';
import { setCarBodyCondition } from './render/materials';
import { WreckTrunkField } from './world/wrecktrunks';
import { CourierField } from './world/couriers';
import { loadSpine } from './world/spinecache';
import { RoadMeshProvider } from './world/roadmesh';
import { RoadDistance } from './world/roaddistance';
import { Terrain } from './world/terrain';
import { WorldWorkScheduler } from './world/workqueue';
import { TERRAIN_COLLIDER_SURFACE } from './world/terrainmesh';
import { Hud } from './ui/hud';
import { MainMenu, type DevSpawnItemRequest, type PauseHooks } from './ui/menu';
import { IndexedDbSaves, installVehicleAutosave } from './save/save';
import { bonnetPart, bonnetWaterCapacity } from './vehicle/bonnet';
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

/**
 * Range, metres, over which an ambient car's contact patches are drawn.
 *
 * Contact shadows are read at the scale of a tyre, so they stop carrying information
 * long before a car stops being visible — but they are also cheap enough to keep well
 * past where they stop mattering, and the fade is what stops a patch appearing as a
 * step when a car crosses the boundary. The pool is the hard limit; this is only the
 * offer.
 */
const CONTACT_PATCH_RANGE_M = 90;
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
/** How close the player must be to the body for the gum pop to right it. */
const GUM_FLIP_RADIUS = 0.5;
/** Four dial hours in the game's 24-minute clock. */
const WATCH_FAST_FORWARD_SECONDS = DAY_LENGTH / 6;
const WATCH_FAST_FORWARD_REAL_SECONDS = 2;
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

/** Hand-to-mouth pack motion at the start of the longer chew-and-blow action. */
const GUM_PACK_ANIM_SECONDS = 1;
/** Short first-person uncork/drink/release cycle for a selected medicine bottle. */
const MEDICINE_USE_SECONDS = 2;
/** The lid leaves the held mesh here and continues as a world rigid body. */
const MEDICINE_CAP_RELEASE_PROGRESS = 0.23;

/**
 * Streaming budget while playing: one small job per rendered frame, which is what
 * keeps road and desert attachment out of the frame time.
 */
const STREAM_FRAME_BUDGET_MS = 3;
const STREAM_JOBS_PER_FRAME = 1;
/**
 * Streaming budget while the loading cover still owns the screen. Nothing is being
 * displayed and nothing is being simulated, so the only reason to stay small would
 * be to hand the player an unfinished world — which is the bug this exists to fix.
 */
const BOOT_STREAM_BUDGET_MS = 12;
const BOOT_STREAM_JOBS_PER_FRAME = 64;
/** Streamer calls per warm-up pass; each one admits at most a single job. */
const BOOT_STREAM_CALLS_PER_PASS = 8;
/**
 * Ceiling on the boot warm-up. A worker that never answers, or a machine slow enough
 * that the whole window cannot be built, must still reach the road: the world then
 * finishes arriving during play exactly as it used to.
 */
const BOOT_WARMUP_LIMIT_MS = 25_000;

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
  installScreenWakeLock();

  const mobilePresentation = prefersMobilePresentation();

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
  /**
   * Whether this machine has never said what it can afford.
   *
   * A stored preference is the player's own answer and outranks anything measured; the
   * absence of one means nobody has answered yet, and the default rung is a guess that
   * a slow machine will be sitting on. Only a desktop can be in that position: a phone
   * with no stored settings is already put on the weakest rung below, which is the
   * floor, so there is nothing left to detect.
   */
  let tierUndetected = false;
  {
    const stored = loadStoredSettings();
    if (stored) {
      world.apply({ t: 'settings', settings: stored });
    } else {
      tierUndetected = !mobilePresentation;
    }
    if (!stored && mobilePresentation) {
      // A phone's first launch must not inherit desktop DPR, MSAA and refresh costs.
      // Once the player changes a display setting, the stored machine preference wins.
      world.apply({
        t: 'settings',
        settings: {
          ...world.state.settings,
          graphicsQuality: 'acceptable',
          msaa: false,
        },
      });
    }
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
  // Vehicle geometry is loaded per model when the active set or a streamed POI needs
  // it. The fit manifest keeps physics/layout deterministic without resident meshes.
  // The trailer's GLB is fitted to the trailer's fixed physics before the first
  // trailer can materialise (a POI or a loaded save), exactly like the cars.
  await preloadTrailerModel(TRAILER_MODEL_FIT);
  const renderer = new Renderer(
    canvas,
    world.state.settings.graphicsQuality,
    world.state.settings.msaa,
    world.state.settings.inkStrength,
    mobilePresentation,
  );
  /** Fullscreen API mode shared by the plus key and the touch fullscreen button. */
  const toggleFullscreen = (): void => {
    const transition = document.fullscreenElement
      ? document.exitFullscreen()
      : document.fullscreenEnabled
        ? document.documentElement.requestFullscreen()
        : null;
    if (transition) void transition.catch(() => undefined);
  };
  /**
   * Letterboxes by changing the canvas viewport itself. Renderer.resizeViewport
   * then updates both the drawing buffer and camera aspect, so nothing is cropped
   * or squeezed behind the bars.
   */
  const toggleCinema = (): void => {
    document.body.classList.toggle('is-cinematic');
    renderer.resizeViewport();
  };

  const vehicleLights = new VehicleLightRig(
    renderer.scene,
    world.state.settings.graphicsQuality,
  );
  // Contact shadows are not a night effect and are not gated on the light rig: they are
  // the only thing on screen that reports what each tyre is carrying, they are the one
  // shadow source that survives the cheapest graphics tier, and they cost one draw call.
  const contactPatches = new ContactPatchField(renderer.scene, origin);
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
  const vitals = new PlayerVitals(world.state.player.health, (health) => {
    world.apply({ t: 'player_health', health });
  });
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
  await sky.waitForAssets();
  // Warm only models already requested by the active set. Later models parse and
  // compile on demand, before their first Vehicle instance is attached.
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
  // Static trunk registries follow streamed physics chunks; edited contents live in state.
  const wreckTrunks = new WreckTrunkField();
  const couriers = new CourierField();
  const birds = new BirdFlock(renderer.scene, road, terrain, world.seed, origin);
  const weapons = new WeaponController();
  const heldView = new HeldItemView(renderer.camera, renderer.scene);
  const trunkView = new TrunkView(renderer.scene);
  const stickerPreview = createStickerPreviewMesh();
  renderer.scene.add(stickerPreview);
  // Sand/gravel spray lives for the session like the other view systems; its
  // pool ages every frame and only the driven car flings into it.
  const wheelSpray = new WheelSpray(renderer.scene, origin);
  // Ground marks use the same wheel telemetry as spray, but retain a bounded history
  // in one pooled mesh instead of creating scene objects along the route.
  const tyreTracks = new SandTyreTracks(renderer.scene, origin);
  // Tumbleweeds share the spray ring so a hit can become dust without a second particle
  // budget. Their own cap is four fixed instances; they never enter road hazards.
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
  const mirageTableau = new MirageTableau(renderer.scene, road, terrain, world.seed, origin);
  // The water standing in the rare dug basins (world/lakes.ts). Render-only, and it
  // dissolves as the player reaches the shore.
  const lakeWater = new LakeWater(
    renderer.scene,
    { seed: world.seed, road, terrain, roadDistance },
    origin,
  );
  // A save carries the tier it was played at, so apply it before the first frame
  // rather than waiting for someone to open the pause menu.
  {
    const metres = viewDistanceFor(world.state.settings.graphicsQuality, mobilePresentation);
    renderer.setViewDistance(metres);
    vista.setViewDistance(metres);
  }
  // One streaming unit per rendered frame prevents road and desert attachment from
  // stacking into the periodic 3-4 ms main-thread spikes visible on fast displays.
  // Boot widens this deliberately; see `warmStreamedWorld`.
  const worldWork = new WorldWorkScheduler(STREAM_FRAME_BUDGET_MS, STREAM_JOBS_PER_FRAME);
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
  streamer.register(new TerminusPadProvider());
  // Hazards are indexed in the ROAD FRAME as the scatter provider builds them, which
  // is what lets the autopilot know a dirt pile from a rock without a physics query:
  // the generator already knew, and this is the only place that knowledge survives.
  streamer.register(new ScatterProvider(debris, hazards));
  streamer.register(new PoleProvider());
  streamer.register(new MonumentProvider());
  streamer.register(new PoiProvider(loose, trailerField, wreckTrunks, couriers));

  // Point lights are budgeted per frame (see LightBudget); constructed before the
  // first chunk build so the budget's first scan sees chunk 0's lamps.
  const lightBudget = new LightBudget(renderer.scene, world.state.settings.graphicsQuality);

  let initialYaw = 0;
  const player = new Player(physics, world, origin);
  player.setRoad(road);

  const vehicles = new Map<string, Vehicle>();
  const pendingVehicleLoads = new Map<string, Promise<Vehicle>>();
  const loadingModels = new Set<string>();
  // Body dirt is the only dynamic shell material input. Cache its last value so
  // rendering does not traverse every mesh when the condition is unchanged.
  const appliedBodyDirt = new WeakMap<Vehicle, number>();
  const frameProfiler = import.meta.env.DEV ? new FrameProfiler() : null;

  /**
   * The frame cost readout, as text, for the pause menu's development screen.
   *
   * WHY IT EXISTS. The game runs on four machines, and one of them is a phone that gets
   * warm. Whether that warmth is the GPU or the CPU cannot be decided from a desktop, and
   * cannot be guessed at either: a phone presenting a third of a megapixel at 30 FPS is
   * asking almost nothing of its GPU, so if the same phone still heats, the cost is
   * somewhere else and only a reading taken on the phone can say where. So the reading is
   * put on the screen that the phone actually has.
   *
   * The first line is the verdict and the rest is the evidence. `GPU` beside a frame time
   * near the presented interval means the GPU is the constraint; a busy-per-second figure
   * that dwarfs it means the CPU is, and the ranked sections say which part.
   */
  const frameReport = import.meta.env.DEV
    ? (): string => {
        const s = world.state.settings;
        const gpuMs = renderer.gpuFrameMs;
        // Both figures come from the one constant the loop steps at, so a change to the
        // simulation rate can never leave the report describing a rate the game is not
        // running. The header and the per-second split have to agree about it.
        const simulationHz = Math.round(1 / FIXED_DT);
        const framesPerSecond =
          mobilePresentation ? `${s.mobileFrameRate} FPS (capped)` : 'uncapped';
        const header = [
          `tier ${s.graphicsQuality}, ${mobilePresentation ? 'phone' : 'desktop'} presentation`,
          `pixels ${(renderer.resolutionScale * 100).toFixed(0)}% of ceiling, ` +
            `dpr ${window.devicePixelRatio.toFixed(2)}`,
          `presenting ${framesPerSecond}, shadows ` +
            `${shadowsFor(s.graphicsQuality, mobilePresentation) ? 'on' : 'off'}, ` +
            `msaa ${s.msaa ? 'on' : 'off'}`,
          `GPU ${gpuMs === null ? 'not measurable on this device' : `${gpuMs.toFixed(2)} ms per frame`}`,
          `simulation ${simulationHz} Hz, sim ticks per frame ` +
            `${(simulationHz / (mobilePresentation ? s.mobileFrameRate : simulationHz)).toFixed(1)}`,
        ].join('\n');
        return `${header}\n\n${frameProfiler?.report(simulationHz) ?? 'profiler unavailable'}`;
      }
    : undefined;
  const modelWarmups = new Map<string, Promise<void>>();
  const materializeVehicle = (car: CarState): Promise<Vehicle> => {
    const existing = vehicles.get(car.id);
    if (existing) return Promise.resolve(existing);
    const pending = pendingVehicleLoads.get(car.id);
    if (pending) return pending;

    const promise = (async () => {
      const def = carModel(car.modelId);
      if (!loadingModels.has(def.id)) {
        loadingModels.add(def.id);
        hud.setToast(`loading ${def.label}`);
      }
      await loadCarModel(def.id);
      let warmup = modelWarmups.get(def.id);
      if (!warmup) {
        warmup = warmCarModelInstances(renderer.renderer, renderer.scene, renderer.camera);
        modelWarmups.set(def.id, warmup);
      }
      await warmup;
      const vehicle = new Vehicle(physics, world, car, renderer.scene, origin);
      vehicles.set(car.id, vehicle);
      for (const sticker of car.stickers) vehicle.root.add(createStickerMesh(sticker));
      return vehicle;
    })().then(
      (vehicle) => {
        pendingVehicleLoads.delete(car.id);
        return vehicle;
      },
      (error) => {
        pendingVehicleLoads.delete(car.id);
        loadingModels.delete(car.modelId);
        throw error;
      },
    );
    pendingVehicleLoads.set(car.id, promise);
    return promise;
  };

  const trailerVehicleFor = (carId: string): Vehicle | null => vehicles.get(carId) ?? null;

  /**
   * Which car is carrying the driver's pack.
   *
   * The three hand slots ride with the person, so they weigh on whatever he is
   * sitting in and on nothing else. That makes it a single moving attachment rather
   * than a per-car property: when he changes cars, or steps out, the last holder has
   * to be told it no longer has them, or every car he has ever driven keeps the load.
   */
  let packHolder: Vehicle | null = null;
  const syncPackMass = (target: Vehicle | null): void => {
    if (packHolder !== target && packHolder !== null) packHolder.setCarriedMass(0);
    packHolder = target;
    if (target) target.setCarriedMass(inventory.carriedMass);
  };

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
  const trafficPosition = { x: 0, y: 0, z: 0 };
  const traffic = new RoadTraffic(
    physics,
    world,
    renderer.scene,
    origin,
    road,
    hazards,
    async (modelId) => {
      await loadCarModel(modelId);
      let warmup = modelWarmups.get(modelId);
      if (!warmup) {
        warmup = warmCarModelInstances(renderer.renderer, renderer.scene, renderer.camera);
        modelWarmups.set(modelId, warmup);
      }
      await warmup;
    },
    (x, z, radius) => {
      const radiusSquared = radius * radius;
      const anchor = activeWorldAnchor();
      if (withinRadius(x, z, anchor.x, anchor.z, radiusSquared)) return false;
      for (const vehicle of vehicles.values()) {
        const position = vehicle.absoluteTranslation(trafficPosition);
        if (withinRadius(x, z, position.x, position.z, radiusSquared)) return false;
      }
      // Also cover a saved car whose model is still loading and therefore has no
      // runtime Vehicle yet. Its last transform is exact enough for a 30 m exclusion.
      for (const id in world.state.cars) {
        const car = world.state.cars[id]!;
        if (withinRadius(x, z, car.x, car.z, radiusSquared)) return false;
      }
      return true;
    },
  );
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
        void materializeVehicle(car).catch((error: unknown) => {
          console.error(`failed to load car model "${car.modelId}"`, error);
          hud.setToast(`could not load ${carModel(car.modelId).label}`);
        });
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
    const football = loose.shoveableForBody(bodyHandle);
    if (football) return football;
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
    // Old saves may predate the three-slot pack. Keep their first three carried
    // items and drop every excess item around the player instead of deleting it.
    const overflow = inventory.restore(world.state.player.carried, world.state.player.carriedSelected);
    if (overflow.length > 0) {
      const p = player.absolutePosition;
      for (let index = 0; index < overflow.length; index++) {
        const item = overflow[index]!;
        const angle = (index * Math.PI * 2) / overflow.length;
        const x = p.x + Math.cos(angle) * 0.8;
        const z = p.z + Math.sin(angle) * 0.8;
        if (item.type === 'part') loose.spawn(item.part, x, p.y + 0.5, z);
        else loose.spawnItem(item, x, p.y + 0.5, z);
      }
      world.apply({
        t: 'inventory',
        items: inventory.all,
        selected: Math.max(0, inventory.selectedIndex),
      });
    }
  } else {
    spawnStartingItems(world, loose);
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
      void materializeVehicle(delta.car).catch((error: unknown) => {
        console.error(`failed to load car model "${delta.car.modelId}"`, error);
        hud.setToast(`could not load ${carModel(delta.car.modelId).label}`);
      });
    }
  });
  const initialActiveAnchor = activeWorldAnchor();
  const initialDrivingId = world.state.player.drivingCarId;
  const initialTowingIds = new Set(
    Object.values(world.state.trailers)
      .filter((trailer) => trailer.hitchedTo !== null)
      .map((trailer) => trailer.hitchedTo as string),
  );
  const initialCars = Object.values(world.state.cars).filter(
    (car) =>
      car.id === initialDrivingId ||
      initialTowingIds.has(car.id) ||
      withinRadius(
        car.x,
        car.z,
        initialActiveAnchor.x,
        initialActiveAnchor.z,
        ACTIVE_LOAD_RADIUS_SQUARED,
      ),
  );
  await Promise.all(initialCars.map(materializeVehicle));
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
   *
   * The boundary is `hasEscapedWorld`: how far below the GROUND a body is, never an
   * absolute altitude. See its comment in world/landscape.ts for what an altitude
   * costs — a basin floor satisfies it, the rescue puts the car back on that same
   * floor, and the two chase each other every fixed step.
   */
  const escaped = (position: { x: number; y: number; z: number }): boolean =>
    hasEscapedWorld(road.landscape, position.x, position.y, position.z);

  const recoverUnderworld = (): void => {
    const drivingId = world.state.player.drivingCarId;
    const driving = drivingId ? (vehicles.get(drivingId) ?? null) : null;
    const playerPosition = player.absolutePosition;
    const playerFallen = escaped(playerPosition);
    let carPosition: { x: number; y: number; z: number } | null = null;
    const carFallen = driving
      ? (() => {
          carPosition = driving.absoluteTranslation(originAnchor);
          return escaped(carPosition);
        })()
      : false;
    if (!playerFallen && !carFallen) return;

    const anchor = carFallen && carPosition ? carPosition : playerPosition;
    const anchorX = Number.isFinite(anchor.x) ? anchor.x : world.state.player.x;
    const anchorZ = Number.isFinite(anchor.z) ? anchor.z : world.state.player.z;
    const projection = road.project(anchorX, anchorZ);
    const roadPoint = road.sampleAt(projection.s);
    if (carFallen && driving) {
      // ALONG THE ROAD, NOT LEVEL. The centreline's own elevation with a level body
      // is a car buried to its rear axle on anything but a flat stretch: the grade
      // here reaches 22%, which over a 4 m wheelbase is half a metre of nose-up.
      driving.rescueTo(
        roadPoint.x,
        roadPoint.y - driving.contactPlaneLocalY,
        roadPoint.z,
        roadPoint.heading,
        roadPoint.grade,
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
    wreckTrunks,
    couriers,
    () => {
      const active = activeCar();
      return active ? { carId: active.id, vehicle: active.vehicle } : null;
    },
    (carId, sticker) => {
      const vehicle = vehicles.get(carId);
      if (vehicle) vehicle.root.add(createStickerMesh(sticker));
    },
    (carId, sticker, valid) => {
      if (!carId || !sticker) {
        stickerPreview.visible = false;
        return;
      }
      const vehicle = vehicles.get(carId);
      if (!vehicle) {
        stickerPreview.visible = false;
        return;
      }
      if (stickerPreview.parent !== vehicle.root) vehicle.root.add(stickerPreview);
      updateStickerPreview(stickerPreview, sticker, valid);
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
    loose.flushToState();
    vitals.flush();
    return world.state;
  };
  installVehicleAutosave(saves, world, stateForSave, saveName, (error) => {
    console.error('autosave failed', error);
    hud.setToast('autosave failed');
  });

  world.onDelta((delta) => {
    if (delta.t === 'courier_storage' && delta.completedContractId) {
      hud.setToast('delivered — signed sticker envelope received');
    } else if (delta.t === 'sticker_place') {
      hud.setToast('stuck on');
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

  // Synthesises ordinary InputFrame commands, so every fuel, gearbox, tyre and
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
      couriers,
      sky,
      trailers: trailerField,
      road,
      terrain,
      player,
      birds,
      camera,
      inventory,
      vehicles,
      audio,
      origin,
      vehicleLights,
      worldWork,
      streamer,
      desert,
      lakeWater,
      // Same shortcut as the pause-menu button, for a console or a scripted session.
      jumpToLake: (index = 0) => devJumpToLake(index),
      tumbleweeds,
      traffic,
      vitals,
      autopilot,
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
    hoodOffset: [0, 0, 0],
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
  const deathInput: InputFrame = emptyInput();
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
  /** Lateral offset of the active player from the road centre, maintained with activeS. */
  let activeLateral = initialProjection.lateral;
  let gumActive = false;
  let gumTimer = 0;
  let gumPackCharges = 0;
  let primaryUseHeld = false;
  let medicineActive = false;
  let medicineTimer = 0;
  let medicineCapReleased = false;
  let dying = vitals.dead;
  let deathReloadScheduled = false;
  const beginDeathSequence = (): void => {
    if (dying) return;
    dying = true;
    autopilot.setEngaged(false);
    camera.beginDeath();
    if (document.pointerLockElement !== null) document.exitPointerLock();
    Object.assign(lastInput, deathInput);
    lookYawAccum = 0;
    lookPitchAccum = 0;
    zoomAccum = 0;
    recenterAccum = false;
    prompt = null;
    boot = null;
  };
  if (import.meta.env.DEV) {
    const dev = (window as unknown as Record<string, Record<string, unknown>>)['__bro'];
    dev['killPlayer'] = (): void => {
      if (!vitals.dead) {
        vitals.beginCollisionFrame('foot');
        vitals.recordContact(-1, 70);
        vitals.endCollisionFrame();
      }
      beginDeathSequence();
    };
  }
  /** Held devices are edge-toggled by E and reset when their item leaves the hand. */
  let binocularsActive = false;
  let torchlightActive = false;
  let cameraActive = false;
  /** A shutter press is fulfilled from the completed rendered frame, not a fixed step. */
  let pendingPhotoCamera: CameraItem | null = null;
  /** 0..1 while an E-key watch action accelerates four in-game hours; 1 is idle. */
  let watchFastForwardProgress = 1;
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

  // Collision severity reads pre-solver velocity. Rapier resolves most of that
  // velocity away on the same step that creates the contact, so sampling afterwards
  // would make the hardest crash look like the slowest. The weak pool keeps one
  // scratch vector per live Vehicle without retaining despawned traffic.
  const impactVelocityPool = new WeakMap<Vehicle, THREE.Vector3>();
  const impactVelocityByBody = new Map<number, THREE.Vector3>();
  const impactPlayerVelocity = new THREE.Vector3();
  const impactOtherVelocity = new THREE.Vector3();
  const impactRelativeVelocity = new THREE.Vector3();
  const impactNormal = new THREE.Vector3();
  const captureImpactVelocities = (): void => {
    impactVelocityByBody.clear();
    const capture = (vehicle: Vehicle): void => {
      let velocity = impactVelocityPool.get(vehicle);
      if (velocity === undefined) {
        velocity = new THREE.Vector3();
        impactVelocityPool.set(vehicle, velocity);
      }
      vehicle.chassis.linvel(velocity);
      impactVelocityByBody.set(vehicle.chassis.handle, velocity);
    };
    for (const vehicle of vehicles.values()) capture(vehicle);
    traffic.forEachVehicle((_id, vehicle) => capture(vehicle));
    player.rigidBody.linvel(impactPlayerVelocity);
  };

  /**
   * Converts post-solver contact manifolds into debounced injuries. Only the velocity
   * closing along the contact normal contributes: a tyre or chassis sliding quickly
   * along the road is not a high-speed collision with the road.
   */
  const resolvePlayerImpacts = (driving: Vehicle | null): number => {
    const collider = driving?.collisionCollider ?? player.collisionCollider;
    const targetBody = collider.parent();
    if (targetBody === null) return 0;
    const targetVelocity =
      (driving ? impactVelocityByBody.get(targetBody.handle) : impactPlayerVelocity)
      ?? impactPlayerVelocity;
    vitals.beginCollisionFrame(driving ? 'car' : 'foot');

    physics.world.contactPairsWith(collider, (otherCollider) => {
      const otherBody = otherCollider.parent();
      if (otherBody === null) return;
      const otherVehicleVelocity = impactVelocityByBody.get(otherBody.handle);
      if (driving === null) {
        // On foot, terrain and buildings cannot reach the harmful walking threshold;
        // only a moving vehicle is a hard body capable of striking the capsule.
        if (otherVehicleVelocity === undefined) return;
      } else if (
        !otherBody.isFixed()
        && otherVehicleVelocity === undefined
        && otherBody.mass() < 100
      ) {
        // Loose cans, tools and footballs are contacts, not hard-object crashes.
        return;
      }

      if (otherBody.isFixed()) {
        impactOtherVelocity.set(0, 0, 0);
      } else if (otherVehicleVelocity !== undefined) {
        impactOtherVelocity.copy(otherVehicleVelocity);
      } else {
        otherBody.linvel(impactOtherVelocity);
      }
      impactRelativeVelocity.subVectors(targetVelocity, impactOtherVelocity);

      let strongestClosingMps = 0;
      physics.world.contactPair(collider, otherCollider, (manifold) => {
        if (manifold.numSolverContacts() === 0) return;
        let impulse = 0;
        for (let i = 0; i < manifold.numContacts(); i++) {
          impulse = Math.max(impulse, manifold.contactImpulse(i));
        }
        // Speculative manifolds appear just before contact. They must not consume
        // the debounce key before the first solver impulse actually lands.
        if (impulse <= 0) return;
        manifold.normal(impactNormal);
        strongestClosingMps = Math.max(
          strongestClosingMps,
          Math.abs(impactRelativeVelocity.dot(impactNormal)),
        );
      });
      if (strongestClosingMps > 0) {
        vitals.recordContact(otherCollider.handle, strongestClosingMps * 3.6);
      }
    });

    return vitals.endCollisionFrame();
  };

  const fixedUpdate = (dt: number): void => {
    worldWork.beginFrame(frameId);
    const f = input.sample(dt);
    if (dying) {
      // Camera look, inventory use and interaction all read this frame object below.
      // Continuing traffic/vehicle physics during the shot keeps a fatal wreck moving
      // naturally without leaving any player control alive.
      Object.assign(f, deathInput);
    }
    lastInput = f;
    lookYawAccum += f.lookYaw;
    lookPitchAccum += f.lookPitch;
    zoomAccum += f.zoomDelta;
    recenterAccum ||= f.recenterCamera;

    const s = world.state;
    let watchTimeAdvance = 0;
    if (watchFastForwardProgress < 1) {
      const nextProgress = Math.min(
        1,
        watchFastForwardProgress + dt / WATCH_FAST_FORWARD_REAL_SECONDS,
      );
      watchTimeAdvance =
        (nextProgress - watchFastForwardProgress) * WATCH_FAST_FORWARD_SECONDS;
      watchFastForwardProgress = nextProgress;
    }
    world.apply({
      t: 'time',
      // The ordinary clock rate and the watch's four-hour acceleration share this
      // delta so midnight advances dayIndex and every sky system observes one time.
      timeOfDay:
        s.timeOfDay +
        (dt * DAY_LENGTH) / (s.settings.dayCycleMinutes * 60) +
        watchTimeAdvance,
      playedSeconds: s.playedSeconds + dt,
    });
    vitals.update(dt);

    const drivingId = s.player.drivingCarId;
    const driving = drivingId ? (vehicles.get(drivingId) ?? null) : null;
    touch.setDriving(driving !== null);

    // MASS IS RE-DERIVED HERE EVERY STEP rather than wired to the deltas that can
    // change it. Fuel burns, a can pours, the boot takes a parcel, the driver picks
    // something up — four sources today and more later, each of which would have to
    // remember to call in. `computeStats` is a couple of dozen reads, `refreshLoad`
    // returns immediately when the total has not moved, and a live set is a handful
    // of cars, so one unconditional call is both cheaper and impossible to forget.
    for (const vehicle of vehicles.values()) vehicle.refreshLoad();
    syncPackMass(driving);

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
    input.setPreciseSteering(!dying && s.settings.preciseSteering && driving !== null);

    if (driving) {
      // setEnabled early-returns when unchanged, so calling it every tick is free.
      player.setEnabled(false);
      if (f.cycleCamera) camera.cycleDriving();
      // One key cycles the complete driving state: sleeper -> hurried -> frantic ->
      // off. Keeping the transition here means the HUD, input handover and
      // controller always observe the same state on the same fixed step.
      if (f.toggleAutopilot) {
        if (!autopilot.engaged) {
          autopilot.setMode('sleeper');
          autopilot.setEngaged(true);
        } else if (autopilot.mode === 'sleeper') {
          autopilot.setMode('hurried');
        } else if (autopilot.mode === 'hurried') {
          autopilot.setMode('frantic');
        } else {
          autopilot.setEngaged(false);
        }
        hud.setToast(
          autopilot.engaged ? `autopilot: ${autopilot.mode}` : 'autopilot off',
        );
      }
      autopilot.setLightingConditions(
        sky.dayFactor,
        traffic.nearestOncomingDistance(activeS, 1),
      );
      if (autopilot.engaged) {
        autopilot.drive(dt, driving, f, origin.x, origin.z);
      }
      driving.fixedUpdate(dt, f);
      if (f.toggleLights) {
        driving.cycleHeadlights();
        // The switch is the driver's from here: an engaged autopilot's automatic
        // lamps otherwise rewrote this on the next fixed step, so L did nothing.
        autopilot.releaseAutomaticHeadlights();
        hud.setToast(
          driving.headlights === 'off'
            ? 'headlights off'
            : driving.headlights === 'low'
              ? 'headlights: dipped beam'
              : 'headlights: main beam',
        );
      }
      // Only an engaged autopilot dips for oncoming traffic. Left running while the
      // player drives, it kept writing its own idea of the beam state onto the car
      // every fixed step and fought the driver for the switch.
      if (autopilot.engaged) autopilot.syncPlayerHighBeam(driving);
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

    // Session traffic owns separate Vehicles, so it writes its mixed autonomous
    // drivers here and never enters the persistent `vehicles` map or save state.
    if (driving === null) {
      const pedestrian = player.absolutePosition;
      traffic.setPedestrianObstacle(pedestrian.x, pedestrian.z);
    } else {
      traffic.clearPedestrianObstacle();
    }
    traffic.setDaylightFactor(sky.dayFactor);
    traffic.fixedUpdate(dt, activeS, origin.x, origin.z);

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


    captureImpactVelocities();
    // Advance the simulation only after every controller has written its intent for
    // this tick (wheel forces, kinematic character motion). Interaction raycasts
    // below then query the post-step world, so prompts match what is on screen.
    frameProfiler?.begin('physics');
    physics.step();
    frameProfiler?.end('physics');
    const injury = resolvePlayerImpacts(driving);
    if (injury > 0 && vitals.dead) beginDeathSequence();
    loose.fixedUpdate(dt);

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
    traffic.postStep();
    trailerField.postStep();
    player.postStep();

    // A consumption animation owns the hand until it releases the empty bottle;
    // switching slots under it would replace the retained viewmodel mid-action.
    if (!medicineActive) {
      if (f.selectSlot > 0) inventory.selectIndex(f.selectSlot - 1);
      else if (f.cycleItem !== 0) inventory.cycle(f.cycleItem);
    }

    // E owns held-item toggles/equipping. F remains the physical world action,
    // including vehicle entry, so using an item can never also touch the aimed car.
    const heldAfterSelection = inventory.held;
    if (driving !== null || heldAfterSelection?.type !== 'binoculars') binocularsActive = false;
    if (driving !== null || heldAfterSelection?.type !== 'torchlight') torchlightActive = false;
    if (driving !== null || heldAfterSelection?.type !== 'camera') cameraActive = false;
    if (driving === null && !dying && !medicineActive && f.useHeld && heldAfterSelection !== null) {
      if (heldAfterSelection.type === 'medicine') {
        // Health and inventory change in one turn before the autosave microtask.
        // The removed item's viewmodel remains owned by the timed animation below.
        vitals.restoreFully();
        inventory.remove(heldAfterSelection.id);
        medicineActive = true;
        medicineTimer = 0;
        medicineCapReleased = false;
        hud.setToast('medicine taken');
      } else if (heldAfterSelection.type === 'binoculars') {
        binocularsActive = !binocularsActive;
      } else if (heldAfterSelection.type === 'torchlight') {
        torchlightActive = !torchlightActive;
      } else if (heldAfterSelection.type === 'camera') {
        if (!cameraActive) {
          cameraActive = true;
        } else if (heldAfterSelection.framesRemaining > 0) {
          pendingPhotoCamera = heldAfterSelection;
        } else {
          hud.setToast('camera roll is spent');
        }
      } else if (
        heldAfterSelection.type === 'pocket_watch' &&
        watchFastForwardProgress >= 1
      ) {
        watchFastForwardProgress = 0;
        hud.setToast('watch shaken — winding four hours forward');
      }
    }
    if (!medicineActive && f.useHeld && heldAfterSelection?.type === 'sun_shades') {
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

    const primaryPressed = f.usePrimary && !primaryUseHeld;
    primaryUseHeld = f.usePrimary;

    if (medicineActive) {
      medicineTimer = Math.min(MEDICINE_USE_SECONDS, medicineTimer + dt);
      const progress = medicineTimer / MEDICINE_USE_SECONDS;
      const eye = camera.eyePosition;
      const direction = camera.eyeDirection;
      const flatLength = Math.hypot(direction.x, direction.z) || 1;
      const forwardX = direction.x / flatLength;
      const forwardZ = direction.z / flatLength;
      const rightX = -forwardZ;
      const rightZ = forwardX;

      if (!medicineCapReleased && progress >= MEDICINE_CAP_RELEASE_PROGRESS) {
        debris.spawnMedicineRemnant(
          'cap',
          {
            x: eye.x + origin.x + forwardX * 0.48 + rightX * 0.2,
            y: eye.y - 0.16,
            z: eye.z + origin.z + forwardZ * 0.48 + rightZ * 0.2,
          },
          {
            x: forwardX * 0.25 + rightX * 1.15,
            y: 1.3,
            z: forwardZ * 0.25 + rightZ * 1.15,
          },
          { x: 6, y: 4, z: -5 },
        );
        medicineCapReleased = true;
      }

      if (medicineTimer >= MEDICINE_USE_SECONDS) {
        debris.spawnMedicineRemnant(
          'bottle',
          {
            x: eye.x + origin.x + forwardX * 0.62 + rightX * 0.12,
            y: eye.y - 0.32,
            z: eye.z + origin.z + forwardZ * 0.62 + rightZ * 0.12,
          },
          {
            x: forwardX * 0.22 + rightX * 0.08,
            y: -0.3,
            z: forwardZ * 0.22 + rightZ * 0.08,
          },
          { x: 2.6, y: 1.4, z: 2.1 },
        );
        medicineActive = false;
        medicineTimer = 0;
      }
    }

    // One gum charge is consumed immediately. Three seconds of chewing come first;
    // only then does the screen-space bubble grow for five seconds before popping.
    const gum = inventory.held;
    if (!driving && !medicineActive && !gumActive && gum?.type === 'bubble_gum' && primaryPressed) {
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
        let nearest: Vehicle | null = null;
        let nearestDistSq = Number.POSITIVE_INFINITY;
        for (const vehicle of vehicles.values()) {
          if (!vehicle.touchesSphere(p.x, p.y, p.z, GUM_FLIP_RADIUS)) continue;
          const t = vehicle.chassis.translation();
          const distSq = (t.x - p.x) ** 2 + (t.y - p.y) ** 2 + (t.z - p.z) ** 2;
          if (distSq < nearestDistSq) {
            nearest = vehicle;
            nearestDistSq = distSq;
          }
        }
        nearest?.flipOver();
        audio.bubbleGumPop();
        hud.setToast(nearest ? 'POP — car flipped' : 'POP — no car close enough');
        gumActive = false;
        gumTimer = 0;
      }
    }

    const eye = camera.eyePosition;
    const dir = camera.eyeDirection;
    const interacted = interaction.fixedUpdate(
      dt,
      medicineActive ? deathInput : f,
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
    if (!medicineActive && held && held.type === 'weapon' && f.usePrimary) {
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
    activeLateral = desertLateral;
    // Fairly alternate first access to the one-job frame budget. Road remains first
    // on one frame and desert on the next; an idle subsystem consumes nothing, so
    // the other still proceeds without delay.
    frameProfiler?.begin('streaming');
    if ((frameId & 1) === 0) {
      streamer.update(activeS, frameId, desertLateral);
      desert.update(desertX, desertZ, desertLateral, frameId);
    } else {
      desert.update(desertX, desertZ, desertLateral, frameId);
      streamer.update(activeS, frameId, desertLateral);
    }
    frameProfiler?.end('streaming');
    frameProfiler?.begin('agents');
    birds.update(dt, activeS, eye.x, eye.y, eye.z);
    frameProfiler?.end('agents');

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
    return terrain.surfaceFromFrame(ws.absoluteContactX, ws.absoluteContactZ, p.lateral, p.s);
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

  /**
   * Holds the adaptive-resolution controller off the frames that are not worth
   * judging. Every measurement taken before `settleLaunchResolution` has finished
   * belongs to the launch transient — freshly compiled shader variants, first
   * texture uploads, the boot GC — not to the cost of the drive, and letting it
   * judge those walked a healthy machine straight down to its resolution floor.
   */
  let adaptationFrozen = true;

  const render = (alpha: number, frameDt: number): void => {
    frameId++;
    const s = world.state;
    frameProfiler?.beginFrame();
    const drivingId = s.player.drivingCarId;
    const driving = drivingId ? (vehicles.get(drivingId) ?? null) : null;

    frameProfiler?.begin('vehicles');
    for (const vehicle of vehicles.values()) {
      vehicle.syncVisuals(alpha);
      // Dirt is read from the Vehicle's live accumulator rather than batched save
      // state, so fresh road dust lands on the shell this frame.
      const dirt = vehicle.bodyDirt;
      if (appliedBodyDirt.get(vehicle) !== dirt) {
        setCarBodyCondition(vehicle.root, dirt);
        appliedBodyDirt.set(vehicle, dirt);
      }
    }
    traffic.syncVisuals(alpha);
    // Trailer physics advances and snapshots in the fixed step exactly like cars,
    // but its scene root must also consume those snapshots every rendered frame.
    // Without this call the rigid body and hitch moved while the GLB stayed forever
    // at its constructor pose, leaving an invisible trailer attached to the car.
    trailerField.syncVisuals(alpha);
    debris.syncVisuals();
    frameProfiler?.end('vehicles');

    // Ground effects share one wheel report. Spray ages every frame; tracks retain the
    // bounded recent route. Nothing is emitted on a surface whose profile rejects it.
    //
    // Fed by the driven car AND every trailer: an unpowered or locked trailer tyre can
    // disturb sand exactly like a car tyre, and the shared state keeps both paths identical.
    frameProfiler?.begin('effects');
    wheelSpray.update(frameDt, activeS);
    if (driving) {
      for (const ws of driving.wheelSpray) emitWheelEffects(ws, frameDt);
    }
    trailerField.forEachSpray((ws) => emitWheelEffects(ws, frameDt));

    if (driving) {
      driving.interpolatedTransform(alpha, targetPos, targetQuat);
      target.x = targetPos.x;
      target.y = targetPos.y;
      target.z = targetPos.z;
      target.qx = targetQuat.x;
      target.qy = targetQuat.y;
      target.qz = targetQuat.z;
      target.qw = targetQuat.w;
      target.speedKmh = driving.speedKmh;
      target.hoodOffset = driving.modelMeasure.hoodPoint;
    } else {
      const p = player.interpolatedPosition(alpha);
      // CameraRig's foot mode adds its own eye height, so hand it the FEET
      // position; `player.position` is the capsule centre and would double up.
      target.x = p.x;
      target.y = p.y - Player.FEET_OFFSET;
      target.z = p.z;
      target.qx = 0;
      target.qy = 0;
      target.qz = 0;
      target.qw = 1;
      target.speedKmh = 0;
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
      !dying && driving === null && inventory.held?.type === 'binoculars' && binocularsActive;
    const usingTorchlight =
      !dying && driving === null && inventory.held?.type === 'torchlight' && torchlightActive;
    const usingCamera =
      !dying && driving === null && inventory.held?.type === 'camera' && cameraActive;
    camera.setBinoculars(usingBinoculars);
    let deathFade = 0;
    if (dying) {
      deathFade = camera.updateDeath(frameDt, target);
    } else {
      camera.update(frameDt, cameraInput, target, driving === null);
    }
    if (dying && camera.deathComplete && !deathReloadScheduled) {
      deathReloadScheduled = true;
      // Hold one fully black painted frame before navigation replaces the scene.
      window.setTimeout(() => window.location.reload(), 250);
    }
    touch.setZoomAvailable(!dying && camera.mode === 'chase');

    const cam = renderer.camera.position;
    frameProfiler?.begin('sky');
    sky.update(
      s.calendarEpoch,
      s.timeOfDay,
      s.dayIndex,
      activeS,
      cam.x,
      cam.y,
      cam.z,
    );
    frameProfiler?.end('sky');
    loose.syncVisuals(s.timeOfDay, sky.dayFactor);
    const headlightVisibility = sky.artificialLightFactor;
    for (const vehicle of vehicles.values()) {
      vehicle.setHeadlightEnvironmentFactor(headlightVisibility);
    }

    // Every lit lamp in the active world casts its beam, not just the driven car's.
    //
    // This runs AFTER the environment factor above, because that factor is a
    // multiplier on the beam intensities the rig is about to read; projecting first
    // spent a frame on yesterday's twilight. The offer order is the priority order
    // only beams a full pool can refuse are the farthest ones.
    //
    // The driven car projects its beams as authored; everyone else's are faded by
    // range (see `ambientBeamGain`). Full-strength ambient pools made a night with
    // traffic read as glare, and arrived as a step: a car spawns 140 m ahead, or the
    // pool stops refusing its lamp, and a bright ellipse existed where there had
    // been none. Faded, the farthest offers are worth nothing anyway, so a refusal
    // and a spawn are both invisible.
    litVehicles.length = 0;
    for (const vehicle of vehicles.values()) {
      if (vehicle.hasLitLamps) litVehicles.push(vehicle);
    }
    traffic.collectLitVehicles(litVehicles, headlightVisibility);
    if (litVehicles.length > 1) {
      litVehicles.sort(
        (a, b) =>
          (a === driving ? -1 : a.root.position.distanceToSquared(cam)) -
          (b === driving ? -1 : b.root.position.distanceToSquared(cam)),
      );
    }
    vehicleLights.beginFrame();
    for (const vehicle of litVehicles) {
      vehicle.syncProjectedLights(
        vehicleLights,
        vehicle === driving ? 1 : ambientBeamGain(vehicle.root.position.distanceTo(cam)),
      );
    }
    vehicleLights.endFrame();

    // Tyres are offered to the patch pool in the same order and for the same reason:
    // the driven car first, then the traffic by range, so a full pool refuses the
    // patches nobody can see rather than the ones under the player's own car.
    const patchGain = (position: THREE.Vector3): number =>
      position.distanceTo(cam) < CONTACT_PATCH_RANGE_M
        ? 1 - position.distanceTo(cam) / CONTACT_PATCH_RANGE_M
        : 0;
    contactPatches.beginFrame();
    if (driving) {
      driving.syncContactPatches(contactPatches, 1);
    }
    for (const vehicle of vehicles.values()) {
      if (vehicle === driving) continue;
      vehicle.syncContactPatches(contactPatches, patchGain(vehicle.root.position));
    }
    traffic.forEachVehicle((_, vehicle) => {
      vehicle.syncContactPatches(contactPatches, patchGain(vehicle.root.position));
    });
    contactPatches.endFrame();
    frameProfiler?.end('effects');
    frameProfiler?.begin('vista');
    vista.update(cam.x, cam.z, activeS, frameDt);
    frameProfiler?.end('vista');
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
    renderer.fog.density *= viewDistanceFogScaleFor(s.settings.graphicsQuality, mobilePresentation);

    // Render-only illusions: neither one owns physics, terrain, streamed props, or
    // permanent world state. Tableaus dissolve as soon as the player leaves the road.
    mirage.update(activeS, sky.dayFactor);
    mirageTableau.update(activeS, activeLateral, sky.dayFactor);
    // Water in a basin. Fades by APPROACH, not by leaving the road, so it needs the
    // absolute player position; the bake is sliced through the streaming budget the
    // terrain tiles use.
    lakeWater.update(
      cam.x + origin.x,
      cam.y,
      cam.z + origin.z,
      activeS,
      frameId,
      worldWork,
      frameDt,
    );
    // A site is only an attempt, and about two in three windows hold no hollow worth
    // filling. Rather than make a tester press the button until one does, the dev jump
    // leaves a marker and this walks it forward until a site comes up wet — then sets
    // them down somewhere the water is actually in front of them.
    if (import.meta.env.DEV && devLakeSeek >= 0) {
      if (lakeWater.ready) {
        devLakeSeek = -1;
        const view = lakeWater.viewpoint();
        if (view) {
          player.teleport(view.x, view.y + 1.2, view.z, activeS);
          player.pushState();
          camera.setYaw(view.yaw);
        }
      } else if (lakeWater.phaseName === 'dry') {
        devLakeSeek++;
        if (devLakeSeek < lakeWater.sites.length) devJumpToLake(devLakeSeek);
        else {
          devLakeSeek = -1;
          hud.setToast('no lake left on this seed');
        }
      }
    }

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
    frameProfiler?.begin('lights');
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
    frameProfiler?.end('lights');

    if (driving) {
      const stats = driving.stats;
      const car = s.cars[drivingId!];
      const waterCap = bonnetWaterCapacity(car?.bonnet ?? []);
      const oilCap = oilCapacity(stats.engine);
      const enginePart = bonnetPart(car?.bonnet ?? [], 0);
      const requiredFuel = enginePart === null
        ? null
        : (variant(enginePart.variantId).engine?.fuel ?? null);
      const wrongFuel = requiredFuel !== null
        && (car?.fuelLitres ?? 0) > 0
        && car?.fuelKind !== requiredFuel;
      const checkEngine = requiredFuel === null || wrongFuel || (car?.oilLitres ?? 0) <= 0;
      hud.setDriving({
        speedKmh: driving.speedKmh,
        rpm: driving.rpm,
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
        checkEngine,
        handbrake: lastInput.handbrake,
        steering: driving.steeringFraction,
      });
    } else {
      hud.setDriving(null);
    }

    // Vehicle audio follows the driven car while its radio remains a spatial source
    // after the player steps out.
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
      radioSpatial,
      driving ? drivingId! : null,
    );
    audio.beginTrafficFrame();
    traffic.forEachVehicle((id, vehicle) => {
      audio.updateTrafficVehicle(
        id,
        vehicle.audio,
        vehicle.root.position.x,
        vehicle.root.position.y,
        vehicle.root.position.z,
      );
    });
    audio.endTrafficFrame();
    hud.setRadio(audio.radioReadout);

    hud.setPrompt(prompt);
    trunkView.update(
      boot,
      boot?.owner === 'car' ? (vehicles.get(boot.id) ?? null) : null,
      boot?.owner === 'wreck'
        ? wreckTrunks.get(boot.id)
        : boot?.owner === 'courier'
          ? couriers.get(boot.id)
          : null,
      alpha,
      origin,
      s.timeOfDay,
      sky.dayFactor,
    );
    hud.setInventory(
      inventory.all,
      inventory.selectedIndex,
      inventory.carriedMass,
      inventory.massLimit,
    );
    const gumBlowing = gumActive && gumTimer >= GUM_CHEW_SECONDS;
    hud.setBubbleGum(gumBlowing, (gumTimer - GUM_CHEW_SECONDS) / GUM_GROW_SECONDS);

    hud.setHealthEffects(vitals.damageEffect, dying, deathFade);
    // Viewmodel and slot previews are pure views of existing state, so they update
    // here rather than in the fixed step: they should track the smoothed camera.
    const held = inventory.held;
    const gumUseProgress =
      gumActive && gumTimer < GUM_PACK_ANIM_SECONDS
        ? gumTimer / GUM_PACK_ANIM_SECONDS
        : -1;
    const medicineUseProgress =
      medicineActive ? medicineTimer / MEDICINE_USE_SECONDS : -1;
    const heldUse =
      held?.type === 'binoculars'
        ? usingBinoculars
        : held?.type === 'torchlight'
          ? usingTorchlight
          : held?.type === 'camera'
            ? usingCamera
            : held?.type === 'pocket_watch'
              ? true
              : lastInput.usePrimary;
    heldView.update(held, camera.mode, frameDt, {
      usePrimary: heldUse,
      moveMag: Math.min(1, Math.hypot(lastInput.moveX, lastInput.moveZ)),
      speedKmh: target.speedKmh,
      gumUseProgress,
      gumCharges: gumPackCharges,
      medicineUseProgress,
      timeOfDay: s.timeOfDay,
      dayFactor: sky.dayFactor,
      watchActionProgress:
        watchFastForwardProgress < 1 ? watchFastForwardProgress : -1,
    });

    // GPU timer queries measure only render submission. The one startup PMREM bake
    // is excluded because it is a different GPU workload; ordinary frames, including
    // the whole day-night transition, remain eligible for adaptive resolution.
    const adaptationEligible = !adaptationFrozen && !sky.didBakeEnvironmentThisFrame;
    renderer.adaptResolution(adaptationEligible, true);
    rebasedThisFrame = false;
    renderer.setHazeStrength(sky.dayFactor);
    renderer.setItemViewEffects(
      s.player.wornSunShades?.tint ?? null,
      usingBinoculars,
      usingTorchlight,
      usingCamera,
    );
    if (pendingPhotoCamera !== null) {
      const cameraItem = pendingPhotoCamera;
      pendingPhotoCamera = null;
      const imageDataUrl = renderer.capturePhoto(sky.dayFactor, activeS / 1000);
      if (imageDataUrl === null) {
        hud.setToast('camera could not expose the frame');
      } else {
        const direction = camera.eyeDirection;
        loose.spawnItem(
          {
            type: 'photograph',
            id: world.runtimePartId(),
            imageDataUrl,
          },
          cam.x + origin.x + direction.x * 0.65,
          cam.y - 0.2,
          cam.z + origin.z + direction.z * 0.65,
        );
        cameraItem.framesRemaining = Math.max(0, cameraItem.framesRemaining - 1);
        audio.cameraShutter();
        hud.setToast(`photograph taken — ${cameraItem.framesRemaining} frames left`);
      }
    }
    frameProfiler?.begin('draw');
    renderer.render();
    frameProfiler?.end('draw');
    frameProfiler?.endFrame();
  };

  // The simulation is wrapped rather than instrumented from the inside: a tick is one
  // unit of work, several of them run per presented frame, and the profiler accumulates
  // repeats — so the timing pair belongs at the boundary where the repetition happens.
  const loop = new GameLoop({
    fixedUpdate: (dt: number): void => {
      frameProfiler?.begin('sim');
      fixedUpdate(dt);
      frameProfiler?.end('sim');
    },
    render,
  });
  loop.setRenderFps(
    presentationFpsFor(mobilePresentation, world.state.settings.mobileFrameRate),
  );

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
      case 'medicine':
        item = { type: 'medicine', id: world.runtimePartId() };
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
      case 'camera':
        item = {
          type: 'camera',
          id: world.runtimePartId(),
          framesRemaining: CAMERA_FRAME_LIMIT,
        };
        break;
      case 'football':
        item = { type: 'football', id: world.runtimePartId() };
        break;
      case 'pocket_watch':
        item = { type: 'pocket_watch', id: world.runtimePartId() };
        break;
    }
    loose.spawnItem(item, dropX + origin.x, groundY + 0.3, dropZ + origin.z);
    hud.setToast(`spawned ${itemLabel(item)}`);
  };

  /**
   * The dev part dispenser behind `PauseHooks.spawnPart`.
   *
   * Same drop as `devSpawnItem` — a step in front of the player, on the ground the
   * raycast finds — because a part is picked up, carried and mounted by hand. It is
   * recorded through `loose.spawn`, so the picker exercises the real loose-part
   * lifecycle rather than a menu-only shortcut, and the part arrives factory-fresh:
   * no dirt, no rust, nothing to clean off before it can be fitted.
   */
  const devSpawnPart = (variantId: string): void => {
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
    const part: PartInstance = { id: world.runtimePartId(), variantId, dirt: 0, rust: 0 };
    loose.spawn(part, dropX + origin.x, groundY + 0.3, dropZ + origin.z);
    hud.setToast(`spawned ${variant(variantId).label}`);
  };

  /**
   * The dev righting tool behind `PauseHooks.flipVehicle`.
   *
   * Seated, it targets the car being driven — no proximity test can be wrong about
   * that one. On foot it takes the nearest car or trailer within `DEV_FLIP_RADIUS`.
   * This explicit developer action is the only instant righting shortcut.
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
    const sites = lakeWater.sites;
    if (sites.length === 0) {
      hud.setToast('no lake sites on this seed');
      return;
    }
    const clamped = Math.min(sites.length - 1, Math.max(0, Math.floor(index)));
    devLakeSeek = clamped;
    const site = sites[clamped]!;
    const centre = road.offsetPoint(site.s, site.lateral);
    const roadPoint = road.sampleAt(site.s);
    // Outward from the window's centre toward the centreline, then back off past its edge.
    const toRoadX = roadPoint.x - centre.x;
    const toRoadZ = roadPoint.z - centre.z;
    const span = Math.hypot(toRoadX, toRoadZ) || 1;
    const standOff = LakeWater.lattice.reach + DEV_LAKE_WINDOW_MARGIN_M;
    const standX = centre.x + (toRoadX / span) * standOff;
    const standZ = centre.z + (toRoadZ / span) * standOff;
    const standY = terrain.heightAt(standX, standZ, site.s);
    // Facing the window: the road frame's forward is (sin h, cos h), and so is the
    // player's yaw, so one `atan2` serves both.
    const yaw = Math.atan2(centre.x - standX, centre.z - standZ);

    const drivingId = world.state.player.drivingCarId;
    const driven = drivingId ? vehicles.get(drivingId) : undefined;
    if (driven) {
      driven.rescueTo(standX, standY - driven.contactPlaneLocalY, standZ, yaw, 0);
      driven.pushTransform();
    }
    player.teleport(standX, standY + 1.2, standZ, site.s);
    player.pushState();
    // The camera's yaw only: the player's own is private and follows the look anyway.
    camera.setYaw(yaw);
    hud.setToast(
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
    if (world.state.player.drivingCarId) {
      hud.setToast('already driving');
      return;
    }
    const p = player.position;
    let nearestId: string | null = null;
    let nearestDistSq = DEV_FLIP_RADIUS * DEV_FLIP_RADIUS;
    for (const [id, vehicle] of vehicles) {
      const t = vehicle.chassis.translation();
      const distSq = (t.x - p.x) ** 2 + (t.y - p.y) ** 2 + (t.z - p.z) ** 2;
      if (distSq < nearestDistSq) {
        nearestId = id;
        nearestDistSq = distSq;
      }
    }
    if (nearestId === null) {
      hud.setToast(`no car within ${DEV_FLIP_RADIUS} m`);
      return;
    }
    world.apply({ t: 'enter_car', carId: nearestId });
    hud.setToast('seated in the nearest car');
  };

  /**
   * The pause overlay's window on the game. Settings live in world state (so a save
   * carries them), which is why every mutation routes through `world.apply` here
   * rather than being held in the menu: the menu is a view, not an owner.
   */
  const pauseHooks: PauseHooks = {
    settings: () => world.state.settings,
    frameReport,
    applySettings: (next) => {
      const poiSpacing = world.state.settings.poiSpacingMetres;
      world.apply({ t: 'settings', settings: next });
      traffic.setTargetCount(world.state.settings.trafficCount);
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
      // The tier owns six things and five of them apply in place: the pixel ceiling,
      // the shadow pass, the sky's star depth, the horizon (far plane, fog and vista
      // disc), and the presentation cap. The sixth — the visible-light count — cannot,
      // because it is compiled into every lit material as an array size, so changing it
      // would recompile the world's shaders mid-session. That one waits for the next
      // load, and the menu says so.
      const tier = world.state.settings.graphicsQuality;
      renderer.setQuality(tier);
      sky.setQuality(tier);
      const horizon = viewDistanceFor(tier, mobilePresentation);
      renderer.setViewDistance(horizon);
      vista.setViewDistance(horizon);
      loop.setRenderFps(
        presentationFpsFor(mobilePresentation, world.state.settings.mobileFrameRate),
      );
    },
    applyTimePreset: (preset) => {
      world.apply({ t: 'time_of_day', timeOfDay: TIME_OF_DAY_PRESETS[preset] * DAY_LENGTH });
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
    // And once more for the parts picker: scavenging parts off wrecks is the loop a
    // free engine on demand would retire.
    spawnPart: import.meta.env.DEV ? devSpawnPart : undefined,
    // Same fold once more: righting a rolled car is what a gum charge is FOR, so the
    // free instant version is a development tool and nothing else.
    flipVehicle: import.meta.env.DEV ? devFlipVehicle : undefined,
    // Development only, and for one reason: a scripted session cannot aim a look
    // ray at a door, so without this the real game is unobservable to automation.
    seatInNearestCar: import.meta.env.DEV ? devSeatInNearestCar : undefined,
    // A lake is one per 200-300 km, so reaching one by driving is a couple of hours.
    // Development only, and for the same reason the seat shortcut exists: without it
    // the feature cannot be looked at.
    jumpToLake: import.meta.env.DEV ? devJumpToLake : undefined,
  };

  /**
   * Opens the pause overlay. Escape, Backquote and touch all arrive here, outside
   * InputReader, so pause still works while the fixed-step loop is stopped.
   *
   * Pointer Lock cannot expose a native cursor over DOM controls. Backquote
   * therefore releases it only while the menu is open and asks for it back on
   * Resume; Escape keeps the browser's normal unlocked-after-Escape behaviour.
   */
  const openPause = (restorePointerLock = false): void => {
    if (paused || dying) return;
    const shouldRestorePointerLock = restorePointerLock && input.pointerLocked;
    if (document.pointerLockElement !== null) document.exitPointerLock();
    paused = true;
    loop.stop();
    // Silence everything behind the overlay, radio included: the loop is stopped,
    // so nothing would update the voices and they would hold their last value.
    audio.setPaused(true);
    void (async () => {
      const s = world.state;
      const action = await menu.showPause({ seed: s.seed, km: s.player.s / 1000 }, pauseHooks);
      menu.hidePause();
      // Do this in the menu gesture's microtask, before an IndexedDB save can
      // consume transient user activation required by requestPointerLock.
      if (action !== 'quit' && shouldRestorePointerLock) {
        void canvas.requestPointerLock().catch(() => undefined);
      }
      if (action === 'save') {
        const state = stateForSave();
        await saves.save(`slot-${state.seed}`, saveName(state), state);
        hud.setToast('saved');
      }
      paused = false;
      audio.setPaused(false);
      if (action !== 'quit') loop.start();
      else window.location.reload();
    })();
  };

  window.addEventListener('keydown', (e) => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || paused) return;
    if (e.code === 'Escape') {
      if (interaction.cancelStickerPlacement()) e.preventDefault();
      else openPause();
    } else if (e.code === 'Backquote') {
      e.preventDefault();
      openPause(true);
    } else if (e.code === 'Equal' || e.code === 'NumpadAdd') {
      e.preventDefault();
      toggleFullscreen();
    } else if (e.key === '-') {
      e.preventDefault();
      toggleCinema();
    }
  });

  // Touch: the overlay builds itself on the first canvas touch, so desktop pays
  // only for the dormant listeners.
  const touch = new TouchControls(uiRoot, canvas, {
    pause: openPause,
    fullscreen: toggleFullscreen,
    cinema: toggleCinema,
  });
  input.attachTouch(touch);
  /**
   * WHY THE WORLD IS FINISHED BEFORE THE LOOP STARTS.
   *
   * Streaming is amortized: one bounded job per rendered frame, which is correct
   * while driving and wrong at boot. `prime` guarantees only the tile the player
   * stands on plus the nine-tile desert patch, so the loop used to start over a
   * world that was still arriving — road chunks ahead unbuilt, their colliders
   * absent — and a resumed save that was already rolling drove straight off the
   * built ground and under the terrain. Waiting here costs launch seconds nobody
   * is looking at and removes the failure entirely.
   *
   * The anchor is the boot projection, so this builds exactly the window the first
   * fixed step will ask for. `setTimeout` rather than a frame callback: the desert
   * and vista workers answer on macrotasks, and the render loop is not running yet.
   */
  const warmStreamedWorld = async (): Promise<void> => {
    const label = loading.querySelector<HTMLElement>('.launch-loading-text');
    worldWork.setFrameBudget(BOOT_STREAM_BUDGET_MS, BOOT_STREAM_JOBS_PER_FRAME);
    const deadline = performance.now() + BOOT_WARMUP_LIMIT_MS;
    try {
      for (;;) {
        frameId++;
        worldWork.beginFrame(frameId);
        for (let call = 0; call < BOOT_STREAM_CALLS_PER_PASS; call++) {
          streamer.update(initialProjection.s, frameId, initialProjection.lateral);
        }
        desert.update(
          initialGround.x,
          initialGround.z,
          initialProjection.lateral,
          frameId,
        );
        const roadWindow = streamer.readiness;
        const sandWindow = desert.readiness;
        const built = roadWindow.ready + sandWindow.ready;
        const total = Math.max(1, roadWindow.wanted + sandWindow.wanted);
        const complete =
          !worldWork.hasPending &&
          roadWindow.ready >= roadWindow.wanted &&
          sandWindow.ready >= sandWindow.wanted;
        if (label) {
          label.textContent = complete
            ? 'the road is ready'
            : `building the world — ${Math.min(99, Math.floor((built / total) * 100))}%`;
        }
        if (complete || performance.now() >= deadline) return;
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 0);
        });
      }
    } finally {
      worldWork.setFrameBudget(STREAM_FRAME_BUDGET_MS, STREAM_JOBS_PER_FRAME);
    }
  };
  await warmStreamedWorld();

  /**
   * WHY THE LAUNCH WAITS FOR THE PICTURE TO STOP CHANGING.
   *
   * The barrier above guarantees that everything is BUILT: the world is streamed,
   * both live shader variants are linked, and a GPU fence has retired the first
   * real frame. It does not guarantee that the frame the player is about to see is
   * the frame he will keep. Resolution is measured, and the frames straddling the
   * reveal are the most expensive of the session — the remaining shader variants,
   * the first uploads, the boot GC — so the adaptive controller used to read that
   * transient as a machine that could not cope and walk the drawing buffer down,
   * step after step, to its floor. At 55% the film grain is filtered away by the
   * upscale, the ink outlines smear into a general darkening, and the road loses
   * its aggregate: the drive looked unfinished, and a second launch — with a warm
   * cache and therefore fewer slow frames — looked right.
   *
   * So the same real frame path runs here, under the cover, at display pace. The
   * first frames are rendered but not judged (`adaptationFrozen`), which is what
   * throws the transient away; the rest are judged exactly as they will be in the
   * drive. The cover leaves when the controller has actually MEASURED the scale it
   * is holding, so the first frame the player sees is the finished one.
   */
  const SETTLE_DISCARD_FRAMES = 30;
  /**
   * Wall-clock ceiling, not a frame count: the frames being settled are the slowest
   * of the session, so counting them measures the machine rather than the wait. A
   * descent is bounded — each step needs its discarded resize frames, its half
   * second of evidence and a 1.5 s cooldown, and the floor is four steps below full
   * resolution — so twenty seconds covers the worst honest case. A machine with
   * headroom reaches its verdict in about a second and a half and leaves then.
   *
   * Leaving early would be worse than waiting: the remaining steps would then be
   * taken with the player watching, which is the resolution walking down under him
   * — precisely the thing this phase exists to prevent.
   */
  const SETTLE_MAX_MS = 20_000;
  const settleLaunchResolution = async (): Promise<void> => {
    // Without GPU timing nothing can move the scale, so there is nothing to settle.
    if (!renderer.measuresGpuTime) {
      adaptationFrozen = false;
      return;
    }
    const label = loading.querySelector<HTMLElement>('.launch-loading-text');
    if (label) label.textContent = 'settling the picture';
    const deadline = performance.now() + SETTLE_MAX_MS;
    for (let frame = 0; performance.now() < deadline; frame++) {
      adaptationFrozen = frame < SETTLE_DISCARD_FRAMES;
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          resolve();
        });
      });
      render(0, 0);
      if (adaptationFrozen) continue;
      if (renderer.resolutionSettled) break;
    }
    adaptationFrozen = false;
  };

  /**
   * WHAT RUNG IS THIS MACHINE, asked once, on the one launch where nobody has answered.
   *
   * Nothing auto-detected the GPU before this, and the comment defending that said
   * guessing wrong either robs a capable machine or leaves a weak one stuttering. That
   * is true of guessing. It is not true of MEASURING, and the measurement already
   * exists: the launch settles the drawing-buffer scale under the loading cover against
   * real GPU timer queries, so by the time the cover lifts the controller has said, in
   * numbers, whether this machine holds the rung it was given.
   *
   * So the rung is WALKED, in both directions, against the settled scale — and the two
   * directions are not symmetrical, because being wrong is not.
   *
   * Down is a rescue: a machine giving away more than a fifth of the resolution it was
   * promised is stuttering, and nothing else will tell the player why.
   *
   * Up is a bonus that has to be paid for fairly. The default rung is deliberately
   * modest, so a fast machine left on it renders less than its display can show — but a
   * rung that does not fit must be PUT BACK, with its own settle to prove it, or a
   * player who never opened the menu is pushed into stutter by the courtesy.
   */
  const AUTO_TIER_BACKOFF = 0.8;
  const AUTO_TIER_COMFORT = 0.95;
  const detectGraphicsTier = async (): Promise<void> => {
    if (!renderer.measuresGpuTime) return;
    // The launch settle has already run by the time this is called, so if the controller
    // never reached a verdict, this machine cannot measure itself and the scale it is
    // sitting on says nothing about it. Bailing here is not a nicety: without a verdict
    // the controller can never move, so every rung this walked would burn its own settle
    // DEADLINE — a machine that cannot measure would pay twenty extra seconds of loading
    // screen to learn nothing. Observed happening, which is why the guard exists.
    if (!renderer.resolutionSettled) return;
    const ladder: GraphicsQuality[] = ['blessing', 'standard', 'acceptable'];
    const adopt = async (index: number): Promise<void> => {
      const tier = ladder[index]!;
      const settings = {
        ...world.state.settings,
        graphicsQuality: tier,
        msaa: GRAPHICS_TIERS[tier].msaa,
      };
      world.apply({ t: 'settings', settings });
      renderer.setMsaa(settings.msaa);
      renderer.setQuality(tier);
      sky.setQuality(tier);
      const horizon = viewDistanceFor(tier, mobilePresentation);
      renderer.setViewDistance(horizon);
      vista.setViewDistance(horizon);
      loop.setRenderFps(presentationFpsFor(mobilePresentation, world.state.settings.mobileFrameRate));
      await settleLaunchResolution();
    };

    let index = Math.max(0, ladder.indexOf(world.state.settings.graphicsQuality));
    while (index < ladder.length - 1 && renderer.resolutionScale < AUTO_TIER_BACKOFF) {
      index += 1;
      await adopt(index);
    }
    while (index > 0 && renderer.resolutionScale > AUTO_TIER_COMFORT) {
      const previous = index;
      index -= 1;
      await adopt(index);
      if (renderer.resolutionScale < AUTO_TIER_BACKOFF) {
        index = previous;
        await adopt(index);
        break;
      }
    }
    // Written once, so the next launch respects the player rather than measuring again.
    storeSettings(world.state.settings);
  };

  // Prime the exact live render path while the loading cover still owns the screen.
  // The first pass establishes sky/fog/post uniforms and bakes the environment.
  // compileAsync then waits for the exact offscreen scene and canvas post variants,
  // not a different direct-to-canvas scene variant. The second draw uploads every
  // remaining texture, shadow and PMREM result; its GPU fence is the final barrier.
  render(0, 0);
  await renderer.waitForFrameShaders();
  render(0, 0);
  await renderer.waitForSubmittedFrame();
  await settleLaunchResolution();
  if (tierUndetected) {
    tierUndetected = false;
    await detectGraphicsTier();
  }
  loading.classList.add('is-hidden');
  // Start only after every frame callback dependency exists. Starting above the
  // TouchControls declaration lets a fast first RAF hit its temporal dead zone.
  loop.start();
}


// Dev scenes are separate entry points reached by query string, so their code is a
// dynamic import the production bundle drops rather than something the game carries.
const query = new URLSearchParams(window.location.search);
const launch = query.has('poi-gallery')
  ? import('./poi-gallery').then(({ bootPoiGallery }) => bootPoiGallery())
  : query.has('prop-gallery')
    ? import('./prop-gallery').then(({ bootPropGallery }) => bootPropGallery())
    : query.has('playground')
      ? import('./playground').then(({ bootPlayground }) => bootPlayground())
      : query.has('mirage-lab')
        ? import('./mirage-lab').then(({ bootMirageLab }) => bootMirageLab())
        : boot();

void launch.catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  document.body.innerHTML = `<pre style="color:#e8dcc4;background:#1a1712;padding:2rem;font:14px monospace">failed to start\n\n${message}</pre>`;
  throw error;
});

// A full reload is the only safe HMR story here: hot-swapping this module would
// leave an orphaned Rapier world and WebGL context behind every edit.
if (import.meta.hot) import.meta.hot.accept(() => window.location.reload());
