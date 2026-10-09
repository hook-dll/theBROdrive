import { TYRE_MODEL } from './vehicle/vehicletuning';
import * as THREE from 'three';
import { FrameProfiler } from './core/frameprofiler';
import { PerfOverlay } from './ui/perfoverlay';
import { activeBuildProfile, buildProfileFor, installBuildProfile } from './render/retro';
import { InputReader, emptyInput, type InputFrame } from './core/input';
import { gamepads, PAD, type RumbleFrame } from './core/gamepad';
import { GameLoop } from './core/loop';
import { installScreenWakeLock } from './core/wakelock';
import { PhysicsWorld } from './core/physics';
import { prefersMobilePresentation, Renderer } from './core/renderer';
import { FIXED_DT } from './core/physics';
import { DAY_LENGTH, GameWorld, newWorldState, type CarState } from './game/state';
import { parseCalendarEpoch } from './game/calendar';
import {
  DEFAULT_INK_STRENGTH,
  TIME_OF_DAY_PRESETS,
  loadStoredSettings,
  presentationFpsFor,
  shadowsFor,
  starMagnitudeFor,
  storeSettings,
  vehicleLightSlotsFor,
  viewDistanceFor,
} from './game/settings';
import { warmPoiStructures } from './world/poistructures';
import {
  Inventory,
  type CameraItem,
  type ContractCargoItem,
} from './items/items';
import { WeaponController } from './items/weapons';
import { LoosePartField } from './parts/loose';
import { oilCapacity } from './parts/registry';
import { TouchControls } from './core/touch';
import { loadCarModel } from './render/carmodel';
import { CAR_LAMP_KNEE } from './render/materials';
import { preloadTrailerModel } from './render/trailermodel';
import { DEFAULT_CAR_MODEL_ID, carModel } from './vehicle/carmodels';
import { Interaction } from './player/interaction';
import { ContractRuntime } from './contracts/runtime';
import { ensureContractWorldObjects, type ContractWorldDeps } from './contracts/world';
import type { ContractCarSnapshot, ContractCarTelemetry, ContractPlace } from './contracts/types';
import { CarTowField } from './vehicle/cartow';
import { Player } from './player/player';
import { PlayerVitals } from './player/vitals';
import { BirdFlock } from './agents/birds';
import { TumbleweedField } from './agents/tumbleweed';
import { CameraRig, type CameraTarget } from './render/cameras';
import { HeldItemView } from './render/held';
import { TrunkView } from './render/trunkview';
import { Sky } from './render/sky';
import { loadStarField } from './render/starcatalog';
import { VistaMesh } from './render/vista';
import { DistantMirage } from './render/mirage';
import { MirageTableau } from './render/mirage-tableau';
import { MirageSchedule } from './render/mirage-schedule';
import { LakeWater } from './render/lakewater';
import { roadTextures } from './render/roadtexture';
import { WheelSpray } from './render/wheelspray';
import { SandTyreTracks } from './render/tyretracks';
import { ambientBeamGain, VehicleLightRig } from './render/vehiclelights';
import { FadingSlotPool } from './render/slotpool';
import { BEAM_GROUPS } from './vehicle/vehiclelamps';
/**
 * Seconds a lamp takes to fade into or out of a shared light pool when its slot is
 * handed to another car. Long enough that a handover reads as a car's light growing
 * or dimming, not as a switch; short enough that a nearer car's pool is not kept
 * waiting behind a far one for more than a second and a half.
 */
const LAMP_HANDOVER_S = 0.75;
import { ContactPatchField } from './render/contactpatches';
import { ChunkStreamer } from './world/chunks';
import { DesertTileStreamer } from './world/deserttiles';
import {
  STATE_GROUND_PROBE_DOWN_M,
  STATE_GROUND_PROBE_UP_M,
  STATE_LOAD_RADIUS_M,
  STATE_UNLOAD_RADIUS_M,
} from './world/ranges';
import { BoardableField, StartSiteProvider } from './story/sitebuild';
import { createStartingCar, spawnStartingItems, storySite } from './story/site';
import { TakeoffCutscene } from './story/takeoff';
import { StoryOverlay } from './story/overlay';
import { playEnding } from './story/ending';
import { TerminusPadProvider } from './world/terminuspad';
import { PoiProvider } from './world/poi';
import { DebrisField, type Impactor } from './world/debris';
import { GroundCoverField } from './world/props/groundcover';
import { hasEscapedWorld } from './world/landscape';
import { DelineatorProvider } from './world/props/delineators';
import { MonumentProvider, monumentProgramAnchor } from './world/props/monuments';
import { PoleProvider, poleProgramAnchor } from './world/props/poles';
import { ScatterProvider } from './world/props/scatter';
import { SidetrackProvider, sidetrackProgramAnchor } from './world/sidetrack';
import { updateWeather, weather, windAt } from './world/weather';
import { Road, ROAD_LENGTH } from './world/road';
import { WorldOrigin } from './world/origin';
import { HazardIndex } from './world/hazards';
import { PLAYER_FIELD_ID, RoadTraffic } from './world/traffic';
import { Autopilot } from './vehicle/autopilot';
import { advanceCloudShadows, beginWetGlare, WET_GLARE_MAX } from './render/cloudshadow';
import { advanceDesertGlitter, setDesertGroundArclength } from './world/terrainmesh';
import { HeatHaze } from './render/heathaze';
import { WeatherParticles } from './render/weatherparticles';
import { setDesertDustArclength } from './render/desertdust';
import { setGroundFadeWindow } from './render/groundfade';
import { WreckTrunkField } from './world/wrecktrunks';
import { CourierField, courierStop, nextCourierIndex } from './world/couriers';
import { DancerField, type DancerHeard } from './world/props/airdancer';
import { loadSpine } from './world/spinecache';
import { RoadMeshProvider } from './world/roadmesh';
import { RoadDistance } from './world/roaddistance';
import { Terrain } from './world/terrain';
import { WorldWorkScheduler } from './world/workqueue';
import { Hud } from './ui/hud';
import { MainMenu, type PauseHooks } from './ui/menu';
import {
  autosaveNow,
  IndexedDbSaves,
  installVehicleAutosave,
  parseSeed,
  summarizeDrive,
} from './save/save';
import {
  claimResumeSlot,
  clearResumeSlot,
  confirmResumeHealthy,
  markResumeTarget,
  RESUME_HEALTHY_SECONDS,
} from './save/resume';
import { bonnetAirFilter, bonnetPart, bonnetWaterCapacity } from './vehicle/bonnet';
import { AIR_FILTER_DUE_CLOG } from './vehicle/airfilter';
import {
  TrailerField,
  TRAILER_MODEL_FIT,
} from './vehicle/trailer';
import { Vehicle } from './vehicle/vehicle';
import type { TrunkViewState } from './vehicle/trunk';
import { GameAudio, type AmbienceFrame, type CarPose, type RadioSpatialState } from './audio/gameaudio';
import { STREAM_FRAME_BUDGET_MS, STREAM_JOBS_PER_FRAME, warmUpBoot } from './app/bootwarmup';
import { installDevTools } from './app/devtools';
import { RivalRace, newRaceProgress } from './contracts/race';
import { createPlayerImpacts } from './app/playerimpacts';
import { createWheelEffects } from './app/wheeleffects';

/**
 * Composition root. The only file allowed to know about every subsystem.
 *
 * Ordering here is load-bearing in three places, each marked below: physics before
 * anything that builds colliders, chunk 0 before the starting fuel can is placed
 * (it needs the garage floor to rest on), and active-set reconciliation after the
 * carried inventory has been restored.
 */

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
/** Cars within this of the player glow and wink while a sticker is held, metres. */
const STICKER_HINT_RANGE_M = 40;
/** One key-fob wink every this many seconds while the hint shows. */
const STICKER_WINK_PERIOD_S = 3.5;
/**
 * A frame-to-frame displacement past which the road projection is redone from scratch
 * rather than descended from last frame's arclength. A car at 300 km/h through a
 * one-second hitch covers 83 m; nothing but a teleport covers this.
 */
const JUMP_REPROJECT_M = 250;
/** See STATE_LOAD_RADIUS_M in world/ranges.ts. */
const ACTIVE_LOAD_RADIUS_SQUARED = STATE_LOAD_RADIUS_M * STATE_LOAD_RADIUS_M;
const ACTIVE_UNLOAD_RADIUS_SQUARED = STATE_UNLOAD_RADIUS_M * STATE_UNLOAD_RADIUS_M;

/** How often the record marker and player position are pushed into state. */
const RECORD_INTERVAL = 2;
/** Bubble gum is intentionally a cheap, readable rescue gag rather than a tool UI. */
const GUM_CHEW_SECONDS = 3;
const GUM_GROW_SECONDS = 5;
const GUM_USE_SECONDS = GUM_CHEW_SECONDS + GUM_GROW_SECONDS;
/** How close the player must be to the body for the gum pop to right it. */
const GUM_FLIP_RADIUS = 0.5;
/** Four dial hours in the game's 24-minute clock. */
const WATCH_FAST_FORWARD_SECONDS = DAY_LENGTH / 6;
const WATCH_FAST_FORWARD_REAL_SECONDS = 2;

/** Hand-to-mouth pack motion at the start of the longer chew-and-blow action. */
const GUM_PACK_ANIM_SECONDS = 1;
/** Short first-person uncork/drink/release cycle for a selected medicine bottle. */
const MEDICINE_USE_SECONDS = 2;
/** The lid leaves the held mesh here and continues as a world rigid body. */
const MEDICINE_CAP_RELEASE_PROGRESS = 0.23;

/* ---- controller rumble ---- */

/**
 * A collision is full strong motor at this impact speed, m/s.
 *
 * COLLISIONS ONLY. The pad used to carry the whole road: suspension bumps, the surface's
 * texture under the tyres, slide, side slip and the steering going light. On these
 * roads that is a motor running for the whole drive, and the player asked for the
 * one event worth feeling in the hands — hitting something.
 */
const RUMBLE_IMPACT_FULL_MPS = 4;

/** A rumble channel is a fraction of a motor's strength, so everything is clamped to 0..1. */
function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

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

  /**
   * Resume the drive that was in progress, or ask.
   *
   * A reload is not always a decision: a phone that slept, a discarded tab that came
   * back, a crash. `saves/resume.ts` holds the one bit that tells those apart from a
   * deliberate quit, and this is the only place that acts on it. A slot that no longer
   * loads — or whose attempt budget is spent — falls through to the title screen, so the
   * player is never left with a black screen and no way forward.
   */
  const resumeSlot = claimResumeSlot();
  const resumedState = resumeSlot === null
    ? null
    : await saves.load(resumeSlot).catch(() => null);
  // A slot that no longer loads leaves nothing to resume, so the marker goes with it
  // rather than being retried into the attempt budget on every later reload.
  if (resumeSlot !== null && resumedState === null) clearResumeSlot();
  const resumed = resumedState !== null;
  // The title screen keeps the launch cover up until a drive is chosen; when a resume
  // lands instead there is nothing to show, so the cover simply stays until boot ends.
  //
  // A new drive gets a random world. `?seed=` pins it — the look tools reproduce the same
  // road run after run with it, against the dev server and the preview build alike — and
  // it is in the URL rather than on the title screen because a player has no use for it.
  const chosenState = resumedState ?? (await menu.show(saves));
  const loadedFromSave = chosenState !== null;
  const pinnedSeed = new URLSearchParams(location.search).get('seed');
  const world = new GameWorld(chosenState ?? newWorldState(parseSeed(pinnedSeed ?? '')));

  // Machine preferences outrank whatever the save carried. Graphics quality and view
  // distance describe the GPU in front of the player, not the drive, so a save made on
  // another computer (or before the player last changed them) must not put them back.
  // Applied HERE because the renderer and the light budget both read them below, and
  // they only take a tier at construction. See game/settings.ts.
  /**
   * Whether this machine has never said what it can afford.
   *
   * `default` is the ONLY source a launch may measure over. A stored `chosen` is the
   * player's own answer, a stored `measured` is a verdict this machine already reached,
   * and re-measuring either would overrule an answer that exists — which is what the
   * old test (the mere absence of stored preferences) could not tell apart. A phone is
   * excluded because it is put on the weakest rung below, which is the floor: there is
   * nothing left to detect, and walking it UP is exactly the heat its rung refuses.
   */
  let tierUndetected = false;
  {
    const stored = loadStoredSettings();
    if (stored) {
      world.apply({ t: 'settings', settings: stored });
    }
    if (!stored && mobilePresentation) {
      // A phone's first launch must not inherit desktop DPR, MSAA and refresh costs.
      // Once the player changes a display setting, the stored machine preference wins.
      world.apply({
        t: 'settings',
        settings: {
          ...world.state.settings,
          graphicsQuality: 'acceptable',
          // Authored for the presentation, not measured and not chosen — so the menu can
          // say which of those it is, and a `Measure again` can still be offered.
          graphicsQualitySource: 'device',
          msaa: false,
          // A phone core is the slowest processor this game runs on: the lightest stream
          // and the 2 km horizon, as the phone's graphics default always gave it.
          viewDistance: 'very_low',
          trafficDensity: 'very_low',
        },
      });
    }
    tierUndetected =
      world.state.settings.graphicsQualitySource === 'default' && !mobilePresentation;
  }
  // Before anything is built: the rung's build profile (render/retro.ts) decides the
  // ground cover, the plants, the open desert and, on Very Low, the finishing pass, and
  // all of them are baked for the page's lifetime.
  installBuildProfile(world.state.settings.graphicsQuality);
  /** A switch across build profiles has started its save-and-reload. */
  let profileReloading = false;

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
    DEFAULT_INK_STRENGTH,
    mobilePresentation,
    world.state.settings.renderScale,
    world.state.settings.fieldOfView,
  );
  renderer.setRetroLines(world.state.settings.retroLines);
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
    mobilePresentation,
  );
  // Who holds the rig's spotlights, and the road's headlamp streaks, frame to frame:
  // a slot is handed over by fading, never reassigned in one frame (render/slotpool.ts).
  const beamPool = new FadingSlotPool(vehicleLights.lightCount, LAMP_HANDOVER_S);
  const glarePool = new FadingSlotPool(WET_GLARE_MAX, LAMP_HANDOVER_S);
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
  input.setAnalogSteeringAssist(world.state.settings.controllerSteerAssist);
  input.setKeyboardSteeringAssist(world.state.settings.keyboardSteerAssist);
  input.setKeyboardSteerRelease(world.state.settings.keyboardSteerRelease);
  // The pad's preferences are device-facing like the mouse's, so they are pushed at
  // the same place and by the same code in `applySettings` below.
  const pads = gamepads();
  pads.setDeadzone(world.state.settings.controllerDeadzone);
  pads.setSteeringSensitivity(world.state.settings.controllerSteerSensitivity);
  const hud = new Hud(uiRoot);
  hud.setDashboardScale(world.state.settings.dashboardSize);
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
    mobilePresentation,
  );
  const sky = new Sky(renderer.scene, renderer.fog, renderer.renderer, starField);
  // The sun's shadow map is sized by the tier (`GraphicsTier.sunShadowMapSize`).
  sky.setQuality(world.state.settings.graphicsQuality, mobilePresentation);
  await sky.waitForAssets();
  // Warm every POI building: building one costs 3.7 ms on a 5950X — more than the
  // whole 3 ms streaming budget — and a first use happens while the player is driving
  // past. Paid here, once, behind the loading cover, later placements are Object3D
  // wrapping. See world/poistructures.ts.
  warmPoiStructures();
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
  /** The parked plane's colliders, so the eye ray can tell the plane from scenery. */
  const boardable = new BoardableField();
  const birds = new BirdFlock(renderer.scene, road, terrain, world.seed, origin);
  const weapons = new WeaponController();
  const heldView = new HeldItemView(renderer.camera, renderer.scene);
  const trunkView = new TrunkView(renderer.scene);
  /** The car currently showing a sticker being tried on, so it can be cleared. */
  let stickerPreviewCarId: string | null = null;
  // Sand/gravel spray lives for the session like the other view systems; its
  // pool ages every frame and only the driven car flings into it.
  const wheelSpray = new WheelSpray(renderer.scene, origin);
  // Ground marks use the same wheel telemetry as spray, but retain a bounded history
  // in one pooled mesh instead of creating scene objects along the route.
  const tyreTracks = new SandTyreTracks(renderer.scene, origin);
  // Tumbleweeds share the spray ring so a hit can become dust without a second particle
  // budget. Their own cap is four fixed instances; they never enter road hazards.
  const tumbleweeds = new TumbleweedField(renderer.scene, road, terrain, world.seed, origin, wheelSpray);
  // Tufts, shrubs and rosettes burst into the same spray ring; no Rapier colliders.
  const groundCover = new GroundCoverField(wheelSpray, origin);
  // Cactus air dancers beside every courier. Built here, before the boot warm-up, so
  // the hidden anchor dancer it adds to the scene compiles their program under the
  // loading cover. See world/props/airdancer.ts.
  const dancers = new DancerField(renderer.scene);
  // The 20 km marks and the sidetracks are built only where they stand; their hidden
  // program anchors are in the scene from boot for the same reason as the dancer's.
  // Telegraph poles are drawn per chunk as InstancedMeshes: their program is linked here too.
  renderer.scene.add(monumentProgramAnchor(), sidetrackProgramAnchor(), poleProgramAnchor());
  /** Reused receiver for the nearest dancer's sound; see `DancerField.heard`. */
  const dancerSound: DancerHeard = { x: 0, y: 0, z: 0, flapMps: 0, airRate: 0 };
  /**
   * Every live car near a dancer shoves its tube; one visitor, made once. Heading and
   * velocity are read only for a car that is actually near one.
   */
  const knockPosition = { x: 0, y: 0, z: 0 };
  const knockDancers = (_id: string, vehicle: Vehicle): void => {
    const p = vehicle.absoluteTranslation(knockPosition);
    if (!dancers.near(p.x, p.z)) return;
    const q = vehicle.chassis.rotation();
    // The chassis' +Z on the ground plane.
    const fx = 2 * (q.x * q.z + q.w * q.y);
    const fz = 1 - 2 * (q.x * q.x + q.y * q.y);
    const f = Math.hypot(fx, fz) || 1;
    const v = vehicle.chassis.linvel();
    dancers.knock(p.x, p.z, fx / f, fz / f, v.x, v.z);
  };

  // Shared exact nearest-road field: the tile streamer uses it to grade the open
  // lattice into the road corridor without searching the full spine per vertex.
  const roadDistance = new RoadDistance(road);
  // Owns every piece of scenery that can be knocked apart, and the resulting debris.
  // Built before the streamer because `ScatterProvider` hands it every breakable prop
  // it makes, and asks it which ones are already down.
  const debris = new DebrisField(physics, world, renderer.scene, origin);
  const hazards = new HazardIndex();
  const vista = new VistaMesh(renderer.scene, terrain, road, origin);
  // One deck for both mirage systems, so vessels and tableaus take turns on the road.
  const mirageSchedule = new MirageSchedule(world.seed, road.length);
  const mirage = new DistantMirage(renderer.scene, road, terrain, world.seed, origin, mirageSchedule);
  const mirageTableau = new MirageTableau(renderer.scene, road, terrain, world.seed, origin, mirageSchedule);
  // Heat-haze inputs: surface heat and the ground the view is grazing.
  const heatHaze = new HeatHaze(terrain, road);
  // Rain, flying dust and blown sand: three instanced draws, each off in fair weather.
  const weatherParticles = new WeatherParticles(renderer.scene, world.seed);
  const drawSize = new THREE.Vector2();
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
    const metres = viewDistanceFor(world.state.settings.viewDistance, mobilePresentation);
    renderer.setViewDistance(metres);
    vista.setViewDistance(metres);
  }
  // One streaming unit per rendered frame prevents road and desert attachment from
  // stacking into the periodic 3-4 ms main-thread spikes visible on fast displays.
  // Boot widens this deliberately; see `warmStreamedWorld` in app/bootwarmup.ts.
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
  const impactPosition = { x: 0, y: 0, z: 0 };
  /** The chassis as the debris field sees it: see `Impactor`. */
  const fillImpactor = (vehicle: Vehicle): void => {
    const t = vehicle.absoluteTranslation(impactPosition);
    const q = vehicle.chassis.rotation();
    // Chassis-local +z is forward (render/carmodel.ts measures half-length on z).
    impactForward.set(0, 0, 1).applyQuaternion(impactQuat.set(q.x, q.y, q.z, q.w));
    const flat = Math.hypot(impactForward.x, impactForward.z) || 1;
    const v = vehicle.chassis.linvel();
    const half = vehicle.modelMeasure.halfExtents;
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
  };
  const strikeWithTraffic = (id: string, vehicle: Vehicle): void => {
    fillImpactor(vehicle);
    debris.strike(id, impactor);
  };

  const streamer = new ChunkStreamer(
    road,
    terrain,
    physics,
    world,
    renderer.scene,
    origin,
    worldWork,
  );
  streamer.register(new RoadMeshProvider(world.seed, roadDistance));
  const startSite = new StartSiteProvider(boardable);
  streamer.register(startSite);
  streamer.register(new TerminusPadProvider());
  // Hazards are indexed in the ROAD FRAME as the scatter provider builds them, which
  // is what lets the autopilot know a dirt pile from a rock without a physics query:
  // the generator already knew, and this is the only place that knowledge survives.
  streamer.register(new ScatterProvider(debris, hazards, groundCover));
  streamer.register(new PoleProvider(roadDistance));
  // The verge furniture the director schedules: reflector posts, and the graded
  // tracks that leave the road for the desert. Both sit outside the asphalt edge at
  // the width the road has there, so they follow the poles — and both take the
  // SHARED road-distance lattice, because a post's foot and a track's ramp have to
  // reproduce the drawn ground they stand on, which means asking the index the
  // terrain mesh asked rather than a second one of their own.
  // A post is a solid obstacle inside the physics window and comes apart when a car
  // clips it, so the provider needs the same debris field the scatter registers with:
  // one breakable registry for the whole world, not one per provider.
  streamer.register(new DelineatorProvider(roadDistance, debris));
  streamer.register(new SidetrackProvider(roadDistance));
  streamer.register(new MonumentProvider());
  streamer.register(new PoiProvider(loose, trailerField, wreckTrunks, couriers, roadDistance, dancers));

  let initialYaw = 0;
  const player = new Player(physics, world, origin);
  player.setRoad(road);

  const vehicles = new Map<string, Vehicle>();
  const pendingVehicleLoads = new Map<string, Promise<Vehicle>>();
  /**
   * The car-to-car tow bar of kind 17. Built here because it reads the live
   * `Vehicle` by id: a bar needs both ends materialised, and `reconcileActiveWorld`
   * keeps both ends in the active set before this field reconciles from state.
   */
  const carTowField = new CarTowField(
    physics,
    world,
    renderer.scene,
    origin,
    (carId) => vehicles.get(carId) ?? null,
    () => hud.setToast('the tow bar snapped'),
  );
  const frameProfiler = import.meta.env.DEV ? new FrameProfiler() : null;
  if (frameProfiler) (window as unknown as { __broSpikes: unknown }).__broSpikes = frameProfiler.spikes;
  // The live graph (pause menu > Performance overlay); see ui/perfoverlay.ts.
  const perfOverlay = frameProfiler
    ? new PerfOverlay(uiRoot, {
        profiler: frameProfiler,
        gpuMs: () => renderer.latestGpuMs,
        measuresGpu: () => renderer.measuresGpuTime,
        frameCap: () => world.state.settings.frameRateLimit,
        drawCalls: () => renderer.drawCalls,
        triangles: () => renderer.drawnTriangles,
        programs: () => renderer.renderer.info.programs?.length ?? 0,
        textures: () => renderer.renderer.info.memory.textures,
        geometries: () => renderer.renderer.info.memory.geometries,
        bodies: () => physics.world.bodies.len(),
        pixels: () => renderer.renderedPixels,
      })
    : null;
  let knownPrograms = 0;

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
        const measuresGpu = renderer.measuresGpuTime;
        // THREE STATES, NOT TWO. "Not measurable" and "not measured yet" are different
        // answers and only one of them is about the device: `gpuFrameMs` is also null
        // immediately after any resolution change, because the controller throws its
        // evidence away, so a machine that measures its GPU perfectly well would have been
        // told its GPU could not be measured. Reporting the wrong one of these sends
        // somebody hunting a browser limitation they do not have.
        const gpuLine = !measuresGpu
          ? 'GPU time NOT MEASURABLE: this browser exposes no timer query'
          : gpuMs === null
            ? 'GPU time available, no sample yet (a resolution change clears the average)'
            : `GPU ${gpuMs.toFixed(2)} ms per frame`;
        // Both figures come from the one constant the loop steps at, so a change to the
        // simulation rate can never leave the report describing a rate the game is not
        // running. The header and the per-second split have to agree about it.
        const simulationHz = Math.round(1 / FIXED_DT);
        // The spot budget belongs in the header because it is the largest per-PIXEL cost
        // the game has, and it is invisible anywhere else: the lamps are dormant in
        // daylight and there is nothing on screen to suggest that every lit fragment is
        // still paying for all of them. Pixels x slots is the number that explains a warm
        // phone, so it is printed rather than left to be inferred.
        const spotSlots = vehicleLightSlotsFor(s.graphicsQuality, mobilePresentation);
        const stars = starMagnitudeFor(s.graphicsQuality, mobilePresentation);
        const framesPerSecond =
          s.frameRateLimit === null ? 'uncapped' : `${s.frameRateLimit} FPS (capped)`;
        const header = [
          `tier ${s.graphicsQuality}, ${mobilePresentation ? 'phone' : 'desktop'} presentation`,
          `pixels ${(renderer.renderedPixels / 1_000_000).toFixed(2)} Mpx `
            + `(${
              s.renderScale === null
                ? `auto, ${(renderer.resolutionScale * 100).toFixed(0)}% of the rung's ceiling`
                : `${Math.round(s.renderScale * 100)}% of the display, fixed`
            }), dpr ${window.devicePixelRatio.toFixed(2)}`,
          `presenting ${framesPerSecond}, shadows ` +
            `${shadowsFor(s.graphicsQuality, mobilePresentation) ? 'on' : 'off'}, ` +
            `msaa ${s.msaa ? 'on' : 'off'}`,
          gpuLine,
          `simulation fixed at ${simulationHz} Hz`,
          `light slots ${spotSlots} spot per lit fragment, stars to magnitude ${stars}`,
          // The decisive pair. A frame whose `draw` is large because of FILL has a big
          // triangle count or a big pixel count; one that is large because of ISSUING has
          // a big call count. The two want opposite fixes, and this is the only place the
          // difference is visible on a device with no GPU timer.
          `draw calls ${renderer.drawCalls}, triangles ` +
            `${(renderer.drawnTriangles / 1000).toFixed(0)}k`,
        ];
        // WHEN THERE IS NO GPU TIMER — every Android browser, which is the device whose
        // heat started this — the frame budget below is the whole of what can be known, and
        // the only way to attribute its `waiting` is to change something and watch. MSAA is
        // the one such change that is both a single variable and applied without a reload:
        // it multiplies the scene pass's sample work and touches nothing else. If turning it
        // off does not move the waiting, the scene pass is not what the frame is waiting for.
        if (!measuresGpu) {
          header.push(
            'Attribution without a timer: toggle MSAA on the Display tab and re-read.',
            'Waiting that shrinks with it is the scene pass; waiting that does not is elsewhere.',
          );
        }
        return (
          `${header.join('\n')}\n\n` +
          (frameProfiler?.report({
            simulationHz,
            gpuMs: measuresGpu ? gpuMs : null,
            presentationCapped: s.frameRateLimit !== null,
          }) ?? 'profiler unavailable')
        );
      }
    : undefined;
  const materializeVehicle = (car: CarState): Promise<Vehicle> => {
    const existing = vehicles.get(car.id);
    if (existing) return Promise.resolve(existing);
    const pending = pendingVehicleLoads.get(car.id);
    if (pending) return pending;

    const promise = (async () => {
      const def = carModel(car.modelId);
      await loadCarModel(def.id);
      const vehicle = new Vehicle(physics, world, car, renderer.scene, origin);
      // The car can leave state while its model is loading — a delivered contract car
      // (`car_remove`). A Vehicle nothing owns must not be inserted, and must not be
      // left standing in the scene either. The boot path awaits these and its cars
      // cannot vanish mid-load, so the disposed return is unreachable there.
      if (world.state.cars[car.id] === undefined) vehicle.dispose();
      else vehicles.set(car.id, vehicle);
      return vehicle;
    })().then(
      (vehicle) => {
        pendingVehicleLoads.delete(car.id);
        return vehicle;
      },
      (error) => {
        pendingVehicleLoads.delete(car.id);
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
  /** Reused receiver for interaction's car lookups; see `CarLookup`. */
  const interactionCarPosition = { x: 0, y: 0, z: 0 };
  const traffic = new RoadTraffic(
    physics,
    world,
    renderer.scene,
    origin,
    road,
    hazards,
    loadCarModel,
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
  /** Three hurried rivals carrying the player's cargo to the next courier; see contracts/race.ts. */
  const race = new RivalRace(world.seed, road, traffic, loadCarModel, (text) => hud.setToast(text));
  /** Reused receiver for the HUD bead line; see `RivalRace.progress`. */
  const raceProgress = newRaceProgress();
  const NO_RIVALS: readonly number[] = [];
  /** How far past a receiving courier's arclength it stays the delivery target, m. */
  const DELIVERY_PAST_COURIER_M = 40;
  /** Fixed ground somewhere under an ABSOLUTE point; see STATE_LOAD_RADIUS_M in world/ranges.ts. */
  const groundUnder = (x: number, y: number, z: number): boolean =>
    physics.hasFixedGroundBelow(
      x - origin.x,
      y + STATE_GROUND_PROBE_UP_M,
      z - origin.z,
      STATE_GROUND_PROBE_UP_M + STATE_GROUND_PROBE_DOWN_M,
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
    // A tow bar holds BOTH cars: the towed one must be materialised to be dragged,
    // and its tower must stay so the bar has something to pull from.
    for (const id in cars) {
      const towerId = cars[id]!.towedBy ?? null;
      if (towerId === null) continue;
      towingCarIds.add(id);
      towingCarIds.add(towerId);
    }
    for (const id in cars) {
      const car = cars[id];
      const vehicle = vehicles.get(id);
      const isTowingCar = towingCarIds.has(id);
      if (vehicle) {
        if (id === drivingId || isTowingCar) continue;
        const position = vehicle.absoluteTranslation(originAnchor);
        // Out of range, or the ground under it has been taken away (a desert tile
        // demoted behind the player): back into state where it stands, rather than
        // falling out of the world with nobody watching.
        if (
          !withinRadius(position.x, position.z, anchorX, anchorZ, ACTIVE_UNLOAD_RADIUS_SQUARED) ||
          !groundUnder(position.x, position.y, position.z)
        ) {
          vehicle.pushState();
          vehicle.dispose();
          vehicles.delete(id);
        }
      } else if (
        id === drivingId ||
        isTowingCar ||
        (withinRadius(car.x, car.z, anchorX, anchorZ, ACTIVE_LOAD_RADIUS_SQUARED) && groundUnder(car.x, car.y, car.z))
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
      STATE_LOAD_RADIUS_M,
      STATE_UNLOAD_RADIUS_M,
      groundUnder,
    );
    // After the cars: a bar whose state says two cars are coupled gets its joint
    // back only when both have live bodies, so this must follow the loop above.
    carTowField.syncFromState();
    loose.updateActive(anchorX, anchorZ, STATE_LOAD_RADIUS_M, STATE_UNLOAD_RADIUS_M, groundUnder);
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
    const car = createStartingCar(world, road, terrain);
    world.apply({ t: 'car_add', car });
    // The world does not exist behind s = 0, so a new game must start at the
    // house rather than at the default state position.
    const spawn = storySite(world.seed, road, terrain).spawn;
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
    spawnStartingItems(world, loose, road, terrain);
    // The postcard from home is the only thing the player starts holding.
    inventory.add({ type: 'postcard', id: world.generatedPartId('story_item', 0, 0) });
  }

  // POI working cars enter state when their chunk reaches the physics band. A new
  // runtime exists immediately only if the car belongs in the current active set.
  world.onDelta((delta) => {
    // A delivered contract car or trailer leaves state and must leave the scene and
    // the collider maps with it: the streaming reconcile walks the cars and trailers
    // that ARE in state, so a removed one would otherwise stand there for the session.
    if (delta.t === 'car_remove') {
      // ORDER MATTERS. A trailer still coupled to the car holds that body in a rapier
      // impulse joint, and `enforceHitch` reads the car's body every step: removing the
      // body first traps the wasm on the next step ("Unreachable code should not be
      // executed" in rawrigidbodyset_rbTranslation, measured). Unhitch first; the
      // trailer is left standing where it is, and `unhitch` records that in state.
      const coupled = trailerField.hitchedTo(delta.carId);
      if (coupled) coupled.unhitch();
      // The same order for a tow bar: its joint references the body, so the bar
      // goes before the body does. `remove` handles the car as either end.
      carTowField.remove(delta.carId);
      const vehicle = vehicles.get(delta.carId);
      if (vehicle) {
        vehicle.dispose();
        vehicles.delete(delta.carId);
      }
      return;
    }
    if (delta.t === 'trailer_remove') {
      trailerField.remove(delta.trailerId);
      return;
    }
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
  for (const car of Object.values(world.state.cars)) {
    const towerId = car.towedBy ?? null;
    if (towerId === null) continue;
    initialTowingIds.add(car.id);
    initialTowingIds.add(towerId);
  }
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
    {
      // The live Vehicle by id, for the bar's geometry.
      vehicle: (carId) => vehicles.get(carId) ?? null,
      // Absolute X/Z: the body when materialised (a moving car's saved pose is up to
      // a transform-emit interval stale), the saved pose otherwise.
      position: (carId) => {
        const vehicle = vehicles.get(carId);
        if (vehicle) return vehicle.absoluteTranslation(interactionCarPosition);
        const car = world.state.cars[carId];
        return car ? { x: car.x, z: car.z } : null;
      },
      // Rapier's own frame: the caller passes the player's relative position and the
      // cars answer from their chassis, so no origin conversion is needed.
      nearest: (x, z, out) => {
        let count = 0;
        let firstId: string | null = null;
        let secondId: string | null = null;
        let firstSq = Infinity;
        let secondSq = Infinity;
        for (const [id, vehicle] of vehicles) {
          const t = vehicle.chassis.translation(interactionCarPosition);
          const distanceSq = (t.x - x) * (t.x - x) + (t.z - z) * (t.z - z);
          if (distanceSq < firstSq) {
            secondSq = firstSq;
            secondId = firstId;
            firstSq = distanceSq;
            firstId = id;
          } else if (distanceSq < secondSq) {
            secondSq = distanceSq;
            secondId = id;
          }
          count++;
        }
        out[0] = firstId;
        out[1] = secondId;
        return Math.min(2, count);
      },
    },
    carTowField,
    (carId) => {
      // The sticker is in CarState already; the paint re-reads the list.
      vehicles.get(carId)?.refreshStickers();
    },
    (carId, sticker) => {
      // The preview is a decal projected and trimmed exactly as the placed sticker
      // will be (render/stickerdecals.ts).
      if (stickerPreviewCarId && stickerPreviewCarId !== carId) {
        vehicles.get(stickerPreviewCarId)?.previewSticker(null);
      }
      stickerPreviewCarId = carId && sticker ? carId : null;
      if (carId && sticker) vehicles.get(carId)?.previewSticker(sticker);
    },
    origin,
    boardable,
    (itemId) => race.winCoins(itemId),
  );
  interaction.attachPlayer(player);

  const saveName = (state: typeof world.state): string => {
    const label = carModel(Object.values(state.cars)[0]?.modelId ?? DEFAULT_CAR_MODEL_ID).label;
    return `${label} @ ${(state.player.s / 1000).toFixed(1)} km`;
  };
  /**
   * Physics bodies and throttled vehicle counters are runtime-authoritative between
   * their normal state deltas. Flush them immediately before every manual save,
   * autosave, or pause summary; trunk cells already mutate `WorldState` synchronously.
   */
  const stateForSave = (): typeof world.state => {
    for (const vehicle of vehicles.values()) vehicle.pushState();
    trailerField.pushTransforms();
    loose.flushToState();
    vitals.flush();
    return world.state;
  };
  installVehicleAutosave(
    saves,
    world,
    stateForSave,
    saveName,
    (error) => {
      console.error('autosave failed', error);
      hud.setToast('autosave failed');
    },
    // Every autosave also marks this drive as resumable, so a reload that was not the
    // player's decision — a slept phone, a discarded tab, a crash — comes back to the
    // car instead of the title screen. See save/resume.ts.
    markResumeTarget,
  );
  world.onDelta((delta) => {
    if (delta.t === 'courier_storage' && delta.completedContractId) {
      hud.setToast('delivered — signed sticker envelope received');
      race.playerDelivered(delta.completedContractId);
    } else if (delta.t === 'sticker_place') {
      hud.setToast('stuck on');
    } else if (delta.t === 'settings') {
      // Every path that changes preferences goes through this delta — the pause menu,
      // the precise-control hotkey, anything added later — so mirroring here is the
      // one place it cannot be forgotten at a new call site.
      storeSettings(delta.settings);
    }
  });

  const camera = new CameraRig(
    renderer.camera,
    physics,
    origin,
    world.state.settings.fieldOfView,
  );
  camera.setMode('foot');
  camera.setShake(world.state.settings.cameraShake);
  camera.setStyle(world.state.settings.cameraStyle);
  camera.setYaw(initialYaw);

  // Synthesises ordinary InputFrame commands, so every fuel, gearbox, tyre and
  // steering rule the human drives under applies to it unchanged.
  const autopilot = new Autopilot(road, hazards, physics);
  /**
   * WHERE THE PLAYER IS, FOR THE RULES THAT ARBITRATE AROUND HIM.
   *
   * The stream's coordinator reasoned about its own cars and nothing else, so the one
   * vehicle on the road that a driver most needs to know about was the one it could
   * only find with a ray. This record is the player's seat in that field — updated
   * with `activeS` every step, read live by `RoadTraffic.fieldFor` — and it works
   * whether he is steering himself or letting his own autopilot do it. The direction
   * is the road's forward sense, which is the frame the player's own `Autopilot` and
   * `activeS` are already expressed in.
   */
  const playerFieldSeat = { forwardS: 0, direction: 1 as const };
  autopilot.setTrafficField(traffic.fieldFor(playerFieldSeat, PLAYER_FIELD_ID));

  /**
   * WHY THE CAR DID THAT, ON SCREEN. Dev builds only, and only when the URL asks for
   * it with `?apdebug`.
   *
   * Verifying a change to the driver by hand needs the numbers that all arrive as one
   * speedometer reading: what the speed plan asked for, what a pending lateral move
   * allows, and what is in the lane the car came from. "It slowed down" is not an
   * observation a fix can be built on; "it slowed to the manoeuvre limit for a rock in
   * the lane it had already left" is.
   */
  const autopilotDebug =
    import.meta.env.DEV && new URLSearchParams(location.search).has('apdebug')
      ? uiRoot.appendChild(document.createElement('pre'))
      : null;
  if (autopilotDebug !== null) {
    autopilotDebug.style.cssText =
      'position:absolute;left:8px;bottom:8px;margin:0;padding:6px 8px;' +
      'font:11px/1.35 ui-monospace,monospace;color:#cfe;background:rgba(0,0,0,0.55);' +
      'white-space:pre;pointer-events:none;z-index:40';
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
    surfaceRoughness: 0,
    wheelContact: 0,
    hoodOffset: [0, 0, 0],
    velocityX: 0,
    velocityZ: 0,
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
  /** Where `activeS` was last projected from, absolute XZ; see JUMP_REPROJECT_M. */
  let projectedX = Number.NaN;
  let projectedZ = Number.NaN;
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
  /**
   * The plane ride: the takeoff shot while it runs, then the ending scene, which owns the
   * canvas until it reloads to the title. Both take every control away, like a death.
   */
  let story: TakeoffCutscene | null = null;
  let endingStarted = false;
  const storyOverlay = new StoryOverlay();
  // Dust, fuel and the player's pose change every tick and are only written through
  // when something saves. Leaving the page — another tab, a closed window, a phone put
  // to sleep — is the last moment the game is sure to run, so it saves then too, but
  // only on foot. Behind the wheel the slot keeps the drive as it was at entry: a hide
  // is also what a Quit or an F5 does, and saving there would write a wrecked car over
  // the drive the player is reloading to get back. It does not mark the drive
  // resumable: a quit or a death clears that on purpose right before the reload that
  // hides this page, and the autosave that ran during the drive has already marked it
  // otherwise. A death is never written: the slot keeps the drive from before it.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'hidden' || dying || story !== null || endingStarted) return;
    if (world.state.player.drivingCarId) return;
    autosaveNow(saves, stateForSave, saveName, (error) => {
      console.error('autosave failed', error);
    });
  });
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
  // Dev-only, behind one compile-time fold. `import.meta.env.DEV` is constant, so a
  // production build folds this branch away and drops `app/devtools` with it — the
  // console handle, the spawn / flip / lake / seat tools, and the pause screen's
  // buttons for them.
  const devTools = import.meta.env.DEV
    ? installDevTools({
        world,
        renderer,
        vista,
        physics,
        interaction,
        input,
        loose,
        debris,
        couriers,
        dancers,
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
        tumbleweeds,
        traffic,
        race,
        vitals,
        autopilot,
        hud,
        beginDeathSequence,
      })
    : null;
  /** Held devices are edge-toggled by E and reset when their item leaves the hand. */
  let binocularsActive = false;
  /** Sticker-in-hand hint: how long it has been showing, and whether it was last frame. */
  let stickerHintClock = 0;
  let stickerHintActive = false;
  let torchlightActive = false;
  let cameraActive = false;
  /**
   * The postcard is read by E: raised to the eyes with its message side toward the
   * player, turned over by E again to the photograph, and put away by a third.
   */
  let postcardView: 'down' | 'text' | 'photo' = 'down';
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
  /** `ambientBeamGain` of each of `litVehicles`, 1 for the driven car. */
  const litGains: number[] = [];

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
  // Per-frame audio inputs, written in place.
  const carAudioPose: CarPose = { x: 0, y: 0, z: 0, forwardX: 0, forwardZ: 1, airMps: 0, wet: 0 };
  /** The wind at the driven car, for the dash's wind gauge; written in place. */
  const dashWind = { x: 0, z: 0 };
  const ambienceFrame: AmbienceFrame = {
    windMps: 0,
    rain: 0,
    drift: 0,
    dust: 0,
    heat: 0,
    dayFactor: 1,
    cabin: false,
    boltSeed: 0,
    boltAge: 99,
    boltDistance: 5000,
    boltAzimuth: 0,
    roadS: 0,
  };
  const playerImpacts = createPlayerImpacts({ physics, player, vitals, vehicles, traffic });

  // Contract runtime. It reads the physics-only numbers (impacts, rollover) from the
  // live Vehicle through this provider; one scratch object is reused per call.
  const contracts = new ContractRuntime(world);
  type MutableCarTelemetry = { -readonly [K in keyof ContractCarTelemetry]: ContractCarTelemetry[K] };
  const contractCarTelemetry: MutableCarTelemetry = {
    impactMps: 0,
    landingMps: 0,
    upsideDown: false,
    trailerId: null,
    trailerImpactMps: 0,
    trailerUpsideDown: false,
  };
  const carTelemetryForContract = (carId: string): ContractCarTelemetry | null => {
    const car = world.state.cars[carId];
    if (!car) return null;
    const vehicle = vehicles.get(carId) ?? null;
    const impact = vehicle?.lastImpact ?? null;
    const q = vehicle?.chassis.rotation();
    // The trailer coupled to THIS car: a coupled trailer is always materialised, so
    // a live one is the only one that can be towing, and it is where the towed
    // load's own impacts live.
    const trailer = trailerField.hitchedTo(carId);
    const trailerRotation = trailer?.rigidBody.rotation();
    contractCarTelemetry.impactMps = impact?.severityMps ?? 0;
    contractCarTelemetry.landingMps = vehicle?.audio.landingImpactMps ?? 0;
    // Y component of the chassis up-axis (0,1,0) for quaternion q.
    contractCarTelemetry.upsideDown = q !== undefined && 1 - 2 * (q.x * q.x + q.z * q.z) < 0.15;
    contractCarTelemetry.trailerId = trailer?.id ?? null;
    contractCarTelemetry.trailerImpactMps = trailer?.lastImpact?.severityMps ?? 0;
    contractCarTelemetry.trailerUpsideDown = trailerRotation !== undefined
      && 1 - 2 * (trailerRotation.x * trailerRotation.x + trailerRotation.z * trailerRotation.z) < 0.15;
    return contractCarTelemetry;
  };

  /**
   * A kind's look at a SECOND car it owns by id (a towed car), as opposed to the
   * telemetry above, which is only ever the carrying car. Reused object: a kind reads
   * it inside its own `step` and must not retain it.
   */
  const contractCarSnapshot = {
    upsideDown: false,
    towedBy: null as string | null,
  };
  const carForContract = (carId: string): ContractCarSnapshot | null => {
    const car = world.state.cars[carId];
    if (!car) return null;
    const vehicle = vehicles.get(carId) ?? null;
    const q = vehicle?.chassis.rotation();
    contractCarSnapshot.upsideDown = q !== undefined && 1 - 2 * (q.x * q.x + q.z * q.z) < 0.15;
    contractCarSnapshot.towedBy = car.towedBy ?? null;
    return contractCarSnapshot;
  };

  /**
   * The world objects the live contracts are about — a loaded trailer spawned at its
   * source courier, or the car of a transfer or a tow. Idempotent, and called from the
   * tick for every cargo item, so a save that predates a kind heals on the next tick.
   */
  const contractWorldDeps: ContractWorldDeps = { world, road, terrain, couriers };

  /**
   * The lowest courier index any cargo the player has on them (in hand or in the car
   * being driven) may be handed in at, gathered during one contracts tick and read by
   * the next one's HUD line; Infinity with nothing aboard.
   */
  let deliveryMinIndexNext = Infinity;
  let deliveryMinIndex = Infinity;
  const onContractItem = (item: ContractCargoItem, place: ContractPlace, carId: string | null): void => {
    race.observe(item, place, activeS);
    ensureContractWorldObjects(contractWorldDeps, item, place);
    if (place === 'hand' || (place === 'car' && carId !== null && carId === world.state.player.drivingCarId)) {
      deliveryMinIndexNext = Math.min(deliveryMinIndexNext, item.sourceCourierIndex + (item.raceLegs ?? 1));
    }
  };

  const fixedUpdate = (dt: number): void => {
    worldWork.beginFrame(frameId);
    const f = input.sample(dt);
    if (dying || story !== null) {
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
    input.setDriving(driving !== null);

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

    // Refresh the stream's road-frame snapshot before the player's autopilot reads it.
    // Every controller still writes its intent before the shared physics step.
    if (driving === null) {
      const pedestrian = player.absolutePosition;
      traffic.setPedestrianObstacle(pedestrian.x, pedestrian.z);
    } else {
      traffic.clearPedestrianObstacle();
    }
    playerFieldSeat.forwardS = activeS;
    frameProfiler?.begin('traffic');
    traffic.fixedUpdate(dt, activeS, activeLateral, origin.x, origin.z);
    race.fixedUpdate(dt, activeS);
    if (race.progress(activeS, raceProgress)) {
      hud.setRouteProgress('race', raceProgress.player, raceProgress.rivals, 0);
    } else if (deliveryMinIndex !== Infinity) {
      // No race: the bead line runs from the last courier behind to the nearest one
      // ahead that will sign for the cargo. It stays the target until the car is
      // past its stand, so stopping alongside does not flip it to the next one.
      const target = nextCourierIndex(world.seed, activeS - DELIVERY_PAST_COURIER_M, deliveryMinIndex);
      const targetS = courierStop(world.seed, target).s;
      const fromS = target > 0 ? Math.min(activeS, courierStop(world.seed, target - 1).s) : 0;
      const player = Math.min(1, Math.max(0, (activeS - fromS) / Math.max(1, targetS - fromS)));
      hud.setRouteProgress('delivery', player, NO_RIVALS, Math.max(0, targetS - activeS));
    } else {
      hud.setRouteProgress(null, 0, NO_RIVALS, 0);
    }
    frameProfiler?.end('traffic');

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
      autopilot.setOncomingGap(traffic.nearestOncomingDistance(activeS, 1));
      if (autopilot.engaged) {
        autopilot.drive(dt, driving, f, origin.x, origin.z);
      }
      driving.fixedUpdate(dt, f);
      if (f.toggleLights) {
        driving.cycleHeadlights();
        // The switch is the driver's from here: an engaged autopilot's automatic
        // lamps otherwise rewrote this on the next fixed step, so L did nothing.
        autopilot.releaseAutomaticHeadlights();
      }
      if (f.toggleLeftIndicator) driving.toggleIndicator('left');
      if (f.toggleRightIndicator) driving.toggleIndicator('right');
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
    //
    // A towed car is the exception: `settle` PINS a car to the spot it is standing
    // on, and a towed car has to roll, so it is stepped by the tow controller below
    // and left out of this loop.
    for (const [id, vehicle] of vehicles) {
      if (id === drivingId || carTowField.stepping(id)) continue;
      vehicle.settle(dt);
    }

    // The towed car of a live bar: no engine, no gear, brakes on the tower's pedal.
    carTowField.fixedUpdate(dt, (carId) => vehicles.get(carId)?.brakeCommand ?? 0);

    // Trailers get the same treatment for the same reason: their springs only exist
    // inside `updateVehicle`, towed or standing.
    trailerField.fixedUpdate(dt, (carId) => vehicles.get(carId)?.brakeCommand ?? 0);

    // FLOATING ORIGIN. Here and nowhere else: after every controller has written this
    // tick's intent, immediately before the solver. The order is load-bearing twice.
    //
    // Rapier refreshes its scene-query tree only inside `world.step`; moving bodies and
    // propagating them to their colliders does not touch it. Every query issued between
    // a shift and the next step therefore searches the tree in the old origin and finds
    // nothing under the cars: each vehicle's suspension rays missed for one whole tick,
    // all four wheels dropped to full droop on screen and the springs pushed nothing,
    // once per kilometre. Shifting here hands the tree straight to the step, so the
    // post-step interaction rays and the next tick's suspension see the moved world.
    //
    // And no `translation()` read is ever separated from its matching `setTranslation`
    // write by a kilometre: the controllers above have finished theirs, and the trailer's
    // hitch enforcement, whose 1.5 m drift guard would read the step as a teleport, runs
    // in the post-step latches below. Those latches, the camera, the HUD and the save
    // deltas all observe the one origin the solver ran in.
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
    }

    playerImpacts.capture();
    // Advance the simulation only after every controller has written its intent for
    // this tick (wheel forces, kinematic character motion). Interaction raycasts
    // below then query the post-step world, so prompts match what is on screen.
    frameProfiler?.begin('physics');
    physics.step();
    frameProfiler?.end('physics');
    const injury = playerImpacts.resolve(driving);
    if (injury > 0 && vitals.dead) beginDeathSequence();
    loose.fixedUpdate(dt);

    // Contracts advance after every controller and the physics step, so the impacts
    // and landings the kinds read are this tick's. `s` is the live state; its clock
    // was advanced at the top of this step.
    frameProfiler?.begin('contracts');
    deliveryMinIndexNext = Infinity;
    contracts.tick({
      dt,
      carTelemetry: carTelemetryForContract,
      carById: carForContract,
      onContractItem,
      onNotice: (text) => hud.setToast(text),
    });
    deliveryMinIndex = deliveryMinIndexNext;
    frameProfiler?.end('contracts');

    // Recover only after Rapier has produced the escaped pose, before the
    // interpolation latches can preserve that pose for another frame.
    recoverUnderworld();

    // Lifetime changes follow the solve, never interrupting controller/hitch writes.
    // Cars resolve first, then their trailers, then loose objects so a live coupling is
    // available to the trailer field.
    {
      const anchor = activeWorldAnchor();
      reconcileActiveWorld(anchor.x, anchor.z);
    }

    // Latch the post-step transforms so the renderer can interpolate between the
    // last two steps instead of snapping to the newest one.
    //
    // The tow bar's stretch correction runs FIRST: it moves the towed chassis and
    // cancels its drift velocity, and the towed car's own `postStep` below is what
    // classifies its impacts from the velocity it ends the step with. Left to run
    // after, the correction itself would read as an unexplained speed change and
    // scratch the car every step.
    carTowField.postStep(dt);
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
    if (driving !== null || dying || heldAfterSelection?.type !== 'postcard') postcardView = 'down';
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
      } else if (heldAfterSelection.type === 'postcard') {
        // One key, three faces of the same card: read it, turn it over, put it away.
        postcardView = postcardView === 'down' ? 'text' : postcardView === 'text' ? 'photo' : 'down';
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
    if (interacted.board && story === null && !dying) {
      // Boarding is an ending: a reload from here on must land on the title screen, not
      // resume beside a plane that has already gone.
      clearResumeSlot();
      story = new TakeoffCutscene({
        scene: renderer.scene,
        site: storySite(world.seed, road, terrain),
        terrain,
        origin,
        audio,
        overlay: storyOverlay,
      });
      startSite.setParkedPlaneVisible(false);
      autopilot.setEngaged(false);
      binocularsActive = false;
      torchlightActive = false;
      cameraActive = false;
      postcardView = 'down';
      gumActive = false;
      prompt = null;
      boot = null;
      Object.assign(lastInput, deathInput);
      lookYawAccum = 0;
      lookPitchAccum = 0;
      zoomAccum = 0;
      recenterAccum = false;
      player.setEnabled(false);
      if (document.pointerLockElement !== null) document.exitPointerLock();
      // Letterboxed, and nothing of the HUD: this is a film now.
      uiRoot.style.visibility = 'hidden';
      if (!document.body.classList.contains('is-cinematic')) {
        document.body.classList.add('is-cinematic');
        renderer.resizeViewport();
      }
    }
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
      if (f.radioCycle) hud.setToast(audio.cycleRadio(drivingId!));
    }

    // Shooting: the held item decides. A kill only enters the inventory if it fits,
    // so a full pack means the bird is lost rather than silently teleported in.
    const held = inventory.held;
    if (!medicineActive && held && held.type === 'weapon' && f.usePrimary) {
      const shot = weapons.tryFire(held, f.useSecondary, eye, dir, birds, inventory, dt);
      if (shot.result === 'fired') {
        audio.gunshot(held.weapon);
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
    //
    // Except after a jump. A teleport (a dev jump, a rescue) lands hundreds of
    // kilometres from the hint, and the local descent from the old `activeS` never
    // gets there: the vista, the palette and everything else keyed on `activeS` stayed
    // at the old kilometre while the tiles (which find their own owner) moved on. Any
    // displacement no car covers in one frame asks the hintless coarse table instead.
    let desertX: number;
    let desertZ: number;
    let desertLateral: number;
    if (driving) {
      // Absolute: the road and desert tile keys both live in world space while the
      // chassis is relative to the floating origin.
      const t = driving.absoluteTranslation(originAnchor);
      desertX = t.x;
      desertZ = t.z;
    } else {
      const p = player.absolutePosition;
      desertX = p.x;
      desertZ = p.z;
    }
    {
      const jumped = !(Math.hypot(desertX - projectedX, desertZ - projectedZ) < JUMP_REPROJECT_M);
      const projection = road.project(desertX, desertZ, jumped ? undefined : driving ? activeS : player.s);
      activeS = projection.s;
      desertLateral = projection.lateral;
      projectedX = desertX;
      projectedZ = desertZ;
    }
    activeLateral = desertLateral;
    // Fairly alternate first access to the one-job frame budget. Road remains first
    // on one frame and desert on the next; an idle subsystem consumes nothing, so
    // the other still proceeds without delay.
    frameProfiler?.begin('streaming');
    // Props dissolve at the edge of the fine tile window, past which the only ground
    // is the coarser vista (render/groundfade.ts).
    setGroundFadeWindow(desertX, desertZ, origin.x, origin.z);
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
    for (const t of birds.takeoffs) audio.flockTakeoff(t.x, t.y, t.z, t.count, t.large);
    for (const c of birds.calls) audio.birdCall(c.species, c.x, c.y, c.z);
    frameProfiler?.end('agents');

    // Props that come apart. Any car is heavy enough to do it, so every chassis is an
    // impactor — the driven car and each traffic car: absolute centre, its own forward,
    // the half extents measured off its model, and its world velocity. Filled in the
    // FIXED step rather than per frame, because breaking is a physics event and must
    // not happen twice for one step's worth of motion.
    debris.update(dt, desertX, desertZ);
    traffic.forEachVehicle(strikeWithTraffic);
    if (driving) {
      fillImpactor(driving);
      debris.strike(drivingId!, impactor);
      const tumbleweedHit = tumbleweeds.update(dt, activeS, impactor);
      const coverHits = groundCover.update(impactor);
      if (tumbleweedHit.count > 0 || coverHits > 0) {
        // Against the direction of travel. 45 N·s on a roughly 1.5 t chassis is a
        // 0.03 m/s brush: comparable to a cactus slice's lightest debris contact, below
        // the collision damage floor. A tuft or a shrub is a quarter of that.
        const speed = Math.hypot(impactor.vx, impactor.vz);
        if (speed > 0.1) {
          const impulse = (tumbleweedHit.count * 45 + coverHits * 12) / speed;
          driving.chassis.applyImpulse({ x: -impactor.vx * impulse, y: 0, z: -impactor.vz * impulse }, true);
        }
        if (tumbleweedHit.count > 0) audio.foley('drop');
      }
    } else {
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
  /** The camera's facing, for the sun shadow box to lean along (render/sky.ts). */
  const cameraView = new THREE.Vector3();

  const wheelEffects = createWheelEffects({
    spray: wheelSpray,
    tracks: tyreTracks,
    road,
    terrain,
    trailers: trailerField,
  });
  /**
   * Holds the adaptive-resolution controller off the frames that are not worth
   * judging. Every measurement taken before `settleLaunchResolution` (app/bootwarmup.ts) has finished
   * belongs to the launch transient — freshly compiled shader variants, first
   * texture uploads, the boot GC — not to the cost of the drive, and letting it
   * judge those walked a healthy machine straight down to its resolution floor.
   */
  let adaptationFrozen = true;

  /**
   * The pad buttons the RENDER frame owns, and the rumble it drives.
   *
   * Pause is a device event like Escape and arrives outside the fixed step in exactly
   * the same way (see `openPause`), so Start has to be read here: while an overlay is
   * up the loop is stopped, and a fixed-step reader would never see the button that
   * closes it. The connect toast rides the same read.
   */
  const rumbleFrame: RumbleFrame = { strong: 0, weak: 0, leftTrigger: 0, rightTrigger: 0 };
  let padStartHeld = false;
  /**
   * Whether this window has the player's attention.
   *
   * A pad is in the hand, not on the screen: a car left rumbling under an alt-tabbed
   * window is a controller vibrating on a desk with nobody driving it, and the browser
   * keeps running the frame loop for a blurred window. Rumble is therefore suppressed
   * while unfocused, not merely stopped once on the event.
   */
  let padFocused = true;
  window.addEventListener('blur', () => {
    padFocused = false;
    pads.stopRumble();
  });
  window.addEventListener('focus', () => {
    padFocused = true;
  });
  const updatePad = (driving: Vehicle | null): void => {
    const pad = pads.read();
    const start = pad.buttons[PAD.Start] === true;
    if (start && !padStartHeld && !dying && story === null && !endingStarted) openPause();
    padStartHeld = start;
    const notice = pads.takeConnectionNotice();
    if (notice !== null) hud.setToast(`${notice} connected`);

    const gain = world.state.settings.controllerVibration;
    if (driving === null || gain <= 0 || !padFocused || paused) {
      // Out of the car, the player asked for silence, nobody is looking, or Start has
      // just opened the pause overlay in this very frame (the loop stops after it): STOP
      // rather than fade, because an effect already running cannot be talked down by
      // declining to issue the next one.
      pads.stopRumble();
      return;
    }

    // Read BEFORE the audio layer consumes it: `impactMps` is an event accumulator that
    // whoever voices it zeroes on read, so this is the last place it can be seen.
    rumbleFrame.strong = clamp01(driving.audio.impactMps / RUMBLE_IMPACT_FULL_MPS) * gain;
    rumbleFrame.weak = 0;
    rumbleFrame.leftTrigger = 0;
    rumbleFrame.rightTrigger = 0;
    pads.vibrate(rumbleFrame, performance.now());
  };

  const render = (alpha: number, frameDt: number): void => {
    frameId++;
    const s = world.state;
    frameProfiler?.beginFrame();
    const drivingId = s.player.drivingCarId;
    const driving = drivingId ? (vehicles.get(drivingId) ?? null) : null;
    updatePad(driving);

    frameProfiler?.begin('vehicles');
    for (const vehicle of vehicles.values()) vehicle.syncVisuals(alpha);
    traffic.syncVisuals(alpha);
    // Trailer physics advances and snapshots in the fixed step exactly like cars,
    // but its scene root must also consume those snapshots every rendered frame.
    // Without this call the rigid body and hitch moved while the GLB stayed forever
    // at its constructor pose, leaving an invisible trailer attached to the car.
    trailerField.syncVisuals(alpha);
    // The bar is drawn from the two chassis' corrected poses, not from a snapshot of
    // its own, so it needs no interpolation and is placed after the cars moved.
    carTowField.syncVisuals();
    debris.syncVisuals();
    frameProfiler?.end('vehicles');

    frameProfiler?.begin('effects');
    wheelEffects.frame(driving, frameDt, activeS);

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
      target.surfaceRoughness = driving.audio.surfaceRoughness;
      target.wheelContact = driving.audio.wheelContactFraction;
      target.hoodOffset = driving.modelMeasure.hoodPoint;
      // The dynamic camera's raw material: where the car is really going, not where it
      // points. Body-frame speed and slip come from the same solver step.
      const velocity = driving.chassis.linvel();
      target.velocityX = velocity.x;
      target.velocityZ = velocity.z;
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
      target.surfaceRoughness = 0;
      target.wheelContact = 0;
      target.velocityX = 0;
      target.velocityZ = 0;
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
    } else if (story !== null) {
      const shot = story.update(frameDt);
      camera.updateScripted(frameDt, shot.eye, shot.lookAt, shot.fov);
      if (shot.done && !endingStarted) {
        // The beach is another scene entirely: the world's loop stops here for good and
        // the ending draws through the same renderer until it hands back to the title.
        endingStarted = true;
        story.dispose();
        story = null;
        loop.stop();
        void playEnding({ renderer, audio, overlay: storyOverlay }).then(() => {
          clearResumeSlot();
          window.location.reload();
        });
        return;
      }
    } else {
      camera.update(frameDt, cameraInput, target, driving === null);
    }
    if (dying && camera.deathComplete && !deathReloadScheduled) {
      deathReloadScheduled = true;
      // Death is an ending, not an interruption: clearing the marker is what stops the
      // reload below from resuming straight back into the corpse.
      clearResumeSlot();
      // Hold one fully black painted frame before navigation replaces the scene.
      window.setTimeout(() => window.location.reload(), 250);
    }
    touch.setZoomAvailable(!dying && camera.mode === 'chase');
    touch.setStickerTools(!dying && stickerPreviewCarId !== null);

    const cam = renderer.camera.position;
    frameProfiler?.begin('sky');
    // Weather first: the sky, the fog, the lights and the ground all read it this
    // frame (world/weather.ts). A function of played time, so it needs no saving. The
    // camera is where the wind's gusts are heard; each car samples its own.
    updateWeather(world.seed, s.playedSeconds, frameDt, cam.x + origin.x, cam.z + origin.z);
    // Every dust colour follows the sand the road has reached (render/desertdust.ts),
    // and so do the ground's broad patches (world/terrainmesh.ts).
    setDesertDustArclength(activeS);
    setDesertGroundArclength(activeS);
    renderer.camera.getWorldDirection(cameraView);
    sky.update(
      s.calendarEpoch,
      s.timeOfDay,
      s.dayIndex,
      activeS,
      cam.x,
      cam.y,
      cam.z,
      cameraView.x,
      cameraView.z,
    );
    frameProfiler?.end('sky');
    loose.syncVisuals(s.timeOfDay, sky.dayFactor);
    const headlightVisibility = sky.artificialLightFactor;
    CAR_LAMP_KNEE.value = headlightVisibility;
    for (const vehicle of vehicles.values()) {
      vehicle.setHeadlightEnvironmentFactor(headlightVisibility);
    }

    // Every lit lamp in the active world casts its beam, not just the driven car's.
    //
    // This runs AFTER the environment factor above, because that factor is a
    // multiplier on the beam intensities the rig is about to read; projecting first
    // spent a frame on yesterday's twilight.
    //
    // The rig's spotlights are few, so they go through `beamPool`, which hands a slot
    // from one car to another by fading rather than in one frame. The driven car's
    // lamps are pinned at full strength, the tail glow included, since the chase
    // camera looks straight at it. Everyone else's are faded by range
    // (`ambientBeamGain`) and ask in order of range, all headlamps before any tail or
    // reversing glow: a tail lamp's six-metre pool is never worth an oncoming car's
    // light on the road.
    //
    // This order used to fill the rig directly, nearest first, headlamps before ANY
    // rear lamp. With two other cars lit within 170 m the driven car's own tail glow
    // never got a slot, and every change of order between two cars switched one pool
    // off and another on at full strength, at 20-120 m.
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
    litGains.length = litVehicles.length;
    for (let i = 0; i < litVehicles.length; i++) {
      const vehicle = litVehicles[i];
      litGains[i] = vehicle === driving ? 1 : ambientBeamGain(vehicle.root.position.distanceTo(cam));
    }
    // Merged (`g === 0 && vehicle !== driving`): one beam per headlamp pair, for traffic
    // only — far down the road two cones read as one. Tail and reversing lamps are never
    // merged: one pool on the centreline read wrongly in play on every car, its own
    // included. The driven car's headlamps, where the tier draws shadows, take the rig's
    // one shadow-casting beam (render/vehiclelights.ts) as one beam from between the
    // lamps — a second shadowed spot measured ten times dearer — and ask the pool for
    // nothing; elsewhere they stay two pool beams.
    const shadowedHeadlamps = vehicleLights.hasShadowBeam;
    beamPool.begin();
    if (driving && driving.hasLitLamps) {
      for (let g = 0; g < BEAM_GROUPS.length; g++) {
        const slots = g === 0 && shadowedHeadlamps ? 0 : driving.beamCount(BEAM_GROUPS[g], false);
        beamPool.request(driving, g, slots, true);
      }
    }
    for (let g = 0; g < BEAM_GROUPS.length; g++) {
      for (let i = 0; i < litVehicles.length; i++) {
        const vehicle = litVehicles[i];
        // A gain of zero asks for nothing: past the range fade the pool belongs to
        // the beams near enough to be seen.
        if (vehicle === driving || !(litGains[i] > 0)) continue;
        beamPool.request(vehicle, g, vehicle.beamCount(BEAM_GROUPS[g], g === 0), false);
      }
    }
    beamPool.resolve(frameDt);
    vehicleLights.beginFrame();
    if (driving && driving.hasLitLamps && shadowedHeadlamps) {
      driving.syncProjectedLights(vehicleLights, 'front', 1, true, true);
    }
    for (let i = 0; i < litVehicles.length; i++) {
      const vehicle = litVehicles[i];
      for (let g = 0; g < BEAM_GROUPS.length; g++) {
        const share = beamPool.share(vehicle, g);
        if (share > 0) {
          vehicle.syncProjectedLights(vehicleLights, BEAM_GROUPS[g], litGains[i] * share, g === 0 && vehicle !== driving, false);
        }
      }
    }
    vehicleLights.endFrame();

    // Their headlamps in the road, nearest first, through the same kind of handover.
    // Not the driven car's own: from behind it, its lamps' mirror image lies under its
    // own bonnet. Nor any lamp pointing away from the eye, which draws no streak.
    glarePool.begin();
    for (const vehicle of litVehicles) {
      if (vehicle !== driving) glarePool.request(vehicle, 0, vehicle.wetGlareLamps(cam), false);
    }
    glarePool.resolve(frameDt);
    beginWetGlare();
    for (const vehicle of litVehicles) {
      const share = glarePool.share(vehicle, 0);
      if (share > 0) vehicle.offerWetGlare(share);
    }

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
    // The courier air dancers stand in the chunk frame; the field only needs the
    // camera in absolute metres to know which of them are near enough to simulate.
    // Any car that reaches one knocks it over first (its blower is not solid).
    if (dancers.count > 0) {
      for (const [id, vehicle] of vehicles) knockDancers(id, vehicle);
      traffic.forEachVehicle(knockDancers);
    }
    dancers.update(frameDt, cam.x + origin.x, cam.z + origin.z, headlightVisibility);
    const dancerHeard = dancers.heard(cam.x + origin.x, cam.z + origin.z, dancerSound);
    audio.updateDancer(dancerHeard, dancerSound.x, dancerSound.y, dancerSound.z, dancerSound.flapMps, dancerSound.airRate);
    frameProfiler?.end('effects');
    frameProfiler?.begin('vista');
    vista.update(cam.x, cam.z, activeS, frameDt);
    frameProfiler?.end('vista');
    // The scene fog is the dust storm's alone: the wall's own law. Inside the storm the
    // short sight is the finishing pass's (`dustInside`), which also hides the sky and
    // the far ridges no scene fog reaches. The clear air, the lighter weathers' veil and
    // the fade at the edge of the draw distance are render/airfog.ts's.
    renderer.fog.density = sky.dustFogDensity;
    renderer.setWeather({
      wallM: weather.frontM,
      windX: weather.windX,
      windZ: weather.windZ,
      wallAlongM: (cam.x + origin.x) * -weather.windZ + (cam.z + origin.z) * weather.windX,
      timeS: s.playedSeconds,
      sunDirection: sky.sunDirection,
      sunColor: sky.sunColor,
      air: sky.horizonColor,
      saturation:
        (1 + 0.1 * weather.clarity) *
        (1 - 0.2 * weather.haze) *
        (1 - 0.12 * weather.dust) *
        (1 - 0.18 * weather.cloud),
      veil: Math.min(0.6, 0.45 * weather.haze + 0.3 * weather.rain + 0.12 * weather.cloud) * (1 - weather.dust),
      weatherFog: sky.dustFogDensity,
      dustInside: sky.dustSightFogDensity,
      airThick: Math.min(1, weather.dust + weather.haze * 0.6 + weather.front * weather.front * 0.7),
    });

    // Render-only illusions: neither one owns physics, terrain, streamed props, or
    // permanent world state. Tableaus dissolve as soon as the player leaves the road.
    mirage.update(activeS, sky.dayFactor);
    mirageTableau.update(activeS, activeLateral, sky.dayFactor);
    // The drifting cloud shade every ground material samples. Driven by the RENDER
    // frame's own dt, so a paused game's clouds stop with it, and given the f64
    // origin because the field is anchored to the world rather than to the player —
    // see `render/cloudshadow.ts`.
    advanceCloudShadows(
      world.seed,
      frameDt,
      sky.dayFactor,
      origin.x,
      origin.z,
      s.settings.graphicsQuality,
      mobilePresentation,
    );
    advanceDesertGlitter(frameDt, sky.dayFactor);
    // Heat haze, after the cloud field has advanced: the shade over the ground ahead
    // is one of its inputs (render/heathaze.ts).
    renderer.setHeatHaze(
      heatHaze.update(frameDt, {
        camera: renderer.camera,
        originX: origin.x,
        originZ: origin.z,
        hintS: activeS,
        sunHeight: sky.sunDirection.y,
        timeOfDay: s.timeOfDay,
        dayLength: DAY_LENGTH,
        seed: world.seed,
      }),
    );
    renderer.renderer.getDrawingBufferSize(drawSize);
    weatherParticles.update(
      frameDt,
      renderer.camera,
      origin.x,
      origin.z,
      terrain.heightAt(cam.x + origin.x, cam.z + origin.z, activeS),
      drawSize.y,
      renderer.fog,
      sky.dayFactor,
      sky.horizonColor,
    );
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
    devTools?.updateLakeSeek(activeS);

    // The night factor is a RAMP across the twilight band, not `isNight`, so the
    // reflector posts' emissive chips come up over the dusk instead of every one in
    // view switching within a frame.
    const night = sky.lampFactor;
    frameProfiler?.begin('lights');
    streamer.setLamps(night);
    frameProfiler?.end('lights');

    if (driving) {
      const stats = driving.stats;
      const car = s.cars[drivingId!];
      const waterCap = bonnetWaterCapacity(car?.bonnet ?? []);
      const oilCap = oilCapacity(stats.engine);
      // The lamp is the engine management telling the driver something is wrong under
      // the bonnet: no engine, no oil, no air filter, or a filter due for replacement.
      const filter = bonnetAirFilter(car?.bonnet ?? []);
      const checkEngine = bonnetPart(car?.bonnet ?? [], 0) === null
        || (car?.oilLitres ?? 0) <= 0
        || filter === null
        || (filter.clog ?? 0) >= AIR_FILTER_DUE_CLOG;
      // The dash's wind gauge reads the wind at the car itself, gusts included, in the
      // car's frame: forward (sin h, cos h), right (-cos h, sin h).
      const at = driving.root.position;
      windAt(at.x + origin.x, at.z + origin.z, dashWind);
      const heading = driving.heading;
      const sinH = Math.sin(heading);
      const cosH = Math.cos(heading);
      const indicator = driving.indicator;
      const blinkerLit = driving.indicatorLit;
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
        blinkerLeft: blinkerLit && (indicator === 'left' || indicator === 'hazard'),
        blinkerRight: blinkerLit && (indicator === 'right' || indicator === 'hazard'),
        headlights: driving.headlights,
        grade: driving.groundGrade,
        windRightMps: -dashWind.x * cosH + dashWind.z * sinH,
        windForwardMps: dashWind.x * sinH + dashWind.z * cosH,
        steering: driving.steeringFraction,
        tyres: driving.wheelRide,
        // Null while the player steers, which is what keeps the faces black: the dash
        // reports WHO is driving, not whether an autopilot exists.
        autopilotMode: autopilot.engaged ? autopilot.mode : null,
      });
    } else {
      hud.setDriving(null);
    }
    if (autopilotDebug !== null) {
      const laneGap = autopilot.laneBlockDistance;
      autopilotDebug.textContent = autopilot.engaged
        ? `autopilot ${autopilot.mode} — ${autopilot.activity} / ${autopilot.manoeuvre}\n` +
          `lane      home ${autopilot.homeLane}, line ${autopilot.commandedLine.toFixed(2)} m, ` +
            `committed ${autopilot.lateralCommitment ?? 'none'}\n` +
          `speed     want ${(autopilot.targetSpeed * 3.6).toFixed(0)}, ` +
            `manoeuvre limit ${(autopilot.manoeuvreSpeed * 3.6).toFixed(0)} km/h\n` +
          `held by   speed ${autopilot.bindingSpeedLimit}, pedal ${autopilot.bindingThrottleLimit}\n` +
          `own lane  ${
            laneGap < Infinity
              ? `${laneGap.toFixed(0)} m at ${(autopilot.laneBlockSpeed * 3.6).toFixed(0)} km/h`
              : 'clear'
          }\n` +
          `ahead     ${
            autopilot.obstacleGap < Infinity
              ? `${autopilot.obstacleGap.toFixed(0)} m at ${(autopilot.obstacleSpeed * 3.6).toFixed(0)} km/h`
              : 'clear'
          }\n` +
          `pass      urge ${autopilot.passUrge ? 'yes' : 'no'}, ` +
            `kickdown ${autopilot.passAttempt ? 'yes' : 'no'}`
        : 'autopilot off';
    }

    // A sticker in hand: the cars it could go on glow softly and wink their blinkers now
    // and then, like a car answering its key fob, until the crosshair finds one — then
    // the sticker itself, printed on the paint, is the feedback.
    const stickerHint =
      driving === null && inventory.held?.type === 'sticker_envelope' && stickerPreviewCarId === null;
    if (stickerHint && !stickerHintActive) stickerHintClock = 0;
    stickerHintActive = stickerHint;
    const hintPhase = stickerHintClock % STICKER_WINK_PERIOD_S;
    const winkNow = stickerHint && hintPhase < frameDt;
    stickerHintClock += frameDt;
    // Warm glow swelling with each wink, a faint one between.
    const glow = 0.12 + 0.4 * Math.max(0, Math.sin(Math.min(1, hintPhase / 0.8) * Math.PI));
    for (const vehicle of vehicles.values()) {
      const at = vehicle.chassis.translation();
      const near = stickerHint
        && (at.x - player.position.x) ** 2 + (at.z - player.position.z) ** 2 < STICKER_HINT_RANGE_M ** 2;
      vehicle.setStickerHighlight(near ? glow : 0);
      if (near && winkNow) vehicle.wink();
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
    const cabinView = driving !== null && camera.mode === 'hood';
    if (driving) {
      // Chassis local +Z is forward.
      const q = driving.root.quaternion;
      let fx = 2 * (q.x * q.z + q.w * q.y);
      let fz = 1 - 2 * (q.x * q.x + q.y * q.y);
      const fl = Math.hypot(fx, fz) || 1;
      fx /= fl;
      fz /= fl;
      const roadMps = driving.audio.forwardMps;
      carAudioPose.x = driving.root.position.x;
      carAudioPose.y = driving.root.position.y;
      carAudioPose.z = driving.root.position.z;
      carAudioPose.forwardX = fx;
      carAudioPose.forwardZ = fz;
      carAudioPose.airMps = Math.hypot(
        weather.windX * weather.windMps - fx * roadMps,
        weather.windZ * weather.windMps - fz * roadMps,
      );
      carAudioPose.wet = weather.wet;
    }
    audio.updateDriving(
      driving ? driving.audio : null,
      radioSpatial,
      driving ? drivingId! : null,
      driving ? carAudioPose : null,
      cabinView,
      frameDt,
    );
    ambienceFrame.windMps = weather.windMps;
    ambienceFrame.rain = weather.rain;
    ambienceFrame.drift = weather.drift;
    ambienceFrame.dust = weather.dust;
    ambienceFrame.heat = weather.heat;
    ambienceFrame.dayFactor = sky.dayFactor;
    ambienceFrame.cabin = cabinView;
    ambienceFrame.boltSeed = weather.boltSeed;
    ambienceFrame.boltAge = weather.boltAge;
    ambienceFrame.boltDistance = weather.boltDistance;
    ambienceFrame.boltAzimuth = weather.boltAzimuth;
    ambienceFrame.roadS = activeS;
    audio.updateAmbience(ambienceFrame, frameDt);
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
    audio.endTrafficFrame(frameDt);
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
      renderer.camera.position,
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
    heldView.update(story !== null ? null : held, camera.mode, frameDt, {
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
      postcardView: held?.type === 'postcard' ? postcardView : 'down',
    });

    // GPU timer queries measure only render submission. The one startup PMREM bake
    // is excluded because it is a different GPU workload; ordinary frames, including
    // the whole day-night transition, remain eligible for adaptive resolution.
    const adaptationEligible = !adaptationFrozen && !sky.didBakeEnvironmentThisFrame;
    renderer.adaptResolution(adaptationEligible, true);
    rebasedThisFrame = false;
    renderer.setDaylight(sky.dayFactor);
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
    if (frameProfiler) {
      // Programs linked this frame: the usual cause of a hitch inside `draw`.
      const programs = renderer.renderer.info.programs ?? [];
      const fresh = programs.slice(knownPrograms).map((p) => p.name || String(p.id));
      knownPrograms = programs.length;
      frameProfiler.spikeNote = () => (fresh.length ? `new programs: ${fresh.join(', ')}` : undefined);
    }
    frameProfiler?.endFrame();
    perfOverlay?.frame();
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
    presentationFpsFor(world.state.settings.frameRateLimit),
  );
  // Dev: `__bro.loop.stop()` freezes the simulation where it stands, so a bench can
  // draw the very same frame again and again (`renderer.render()`); `start()` resumes.
  // `mirageSchedule` and `courierAt(index)` say where the mirages and the couriers stand,
  // for a bench that wants one in view (tools/look/gpucost.mjs).
  if (import.meta.env.DEV) {
    Object.assign((window as unknown as { __bro: Record<string, unknown> }).__bro, {
      loop,
      mirageSchedule,
      courierAt: (index: number) => courierStop(world.seed, index),
    });
  }

  // DEV: the Panini lens A/B (render/hazeshader.ts `paniniSource`), kept across reloads.
  const PANINI_STEPS = [0, 0.3, 0.5, 0.7, 1];
  const PANINI_KEY = 'bro.panini';
  const devPanini = {
    get strength(): number {
      return renderer.panini;
    },
    cycle(): void {
      const at = PANINI_STEPS.indexOf(renderer.panini);
      const next = PANINI_STEPS[(at + 1) % PANINI_STEPS.length] ?? 0;
      renderer.setPanini(next);
      localStorage.setItem(PANINI_KEY, String(next));
    },
  };
  if (import.meta.env.DEV) renderer.setPanini(Number(localStorage.getItem(PANINI_KEY)) || 0);

  /**
   * The pause overlay's window on the game. Settings live in world state (so a save
   * carries them), which is why every mutation routes through `world.apply` here
   * rather than being held in the menu: the menu is a view, not an owner.
   */
  const pauseHooks: PauseHooks = {
    settings: () => world.state.settings,
    frameReport,
    perfOverlay: perfOverlay ?? undefined,
    panini: import.meta.env.DEV ? devPanini : undefined,
    viewport: () => renderer.viewport(),
    /**
     * Throw away the recorded verdict and measure this machine again.
     *
     * A RELOAD rather than a live walk, because the measurement is a launch phase by
     * construction: it needs the loading cover to hide thirty discarded frames and up
     * to twenty seconds of settling, and it needs to step the rung with nobody driving.
     * Running it from a pause menu would walk the resolution under a player who is
     * parked in the middle of the road. The source is written first, so the launch this
     * reload lands in is the one that asks the question.
     */
    remeasureGraphics: () => {
      // The measurement walks the ordinary ladder only; the retro rung is a choice, and
      // a load built for it cannot step to another rung in place.
      const settings = {
        ...world.state.settings,
        graphicsQuality: world.state.settings.graphicsQuality === 'retro'
          ? 'acceptable' as const
          : world.state.settings.graphicsQuality,
        graphicsQualitySource: 'default' as const,
      };
      world.apply({ t: 'settings', settings });
      storeSettings(settings);
      window.location.reload();
    },
    applySettings: (next) => {
      world.apply({ t: 'settings', settings: next });
      // A rung on another build profile is a reload: the profile is built into the
      // world's ground cover, plants and open desert, and on Very Low the finishing pass
      // (render/retro.ts). So Very Low <-> anything and Low <-> Medium/High reload; Medium
      // <-> High applies in place. The drive is saved and marked for resume first, so
      // the player lands back in the car rather than on the title.
      if (buildProfileFor(world.state.settings.graphicsQuality) !== activeBuildProfile()) {
        if (!profileReloading) {
          profileReloading = true;
          const state = stateForSave();
          const slot = `slot-${state.seed}`;
          void saves.save(slot, saveName(state), state)
            .then(() => markResumeTarget(slot))
            .catch((error: unknown) => console.error('save before the graphics reload failed', error))
            .finally(() => window.location.reload());
        }
        return;
      }
      // Input and audio cache device-facing preferences; push them immediately.
      input.setKeyBindings(world.state.settings.keyBindings);
      input.setMouseSensitivity(world.state.settings.mouseSensitivity);
      input.setAnalogSteeringAssist(world.state.settings.controllerSteerAssist);
      input.setKeyboardSteeringAssist(world.state.settings.keyboardSteerAssist);
      input.setKeyboardSteerRelease(world.state.settings.keyboardSteerRelease);
      pads.setDeadzone(world.state.settings.controllerDeadzone);
      pads.setSteeringSensitivity(world.state.settings.controllerSteerSensitivity);
      audio.applySettings(world.state.settings);
      renderer.setMsaa(world.state.settings.msaa);
      renderer.setRenderScale(world.state.settings.renderScale);
      renderer.setRetroLines(world.state.settings.retroLines);
      camera.setFieldOfView(world.state.settings.fieldOfView);
      camera.setShake(world.state.settings.cameraShake);
      camera.setStyle(world.state.settings.cameraStyle);
      hud.setDashboardScale(world.state.settings.dashboardSize);
      // The tier owns four things that apply in place: the pixel ceiling, the shadow
      // pass, the sky's star depth and the presentation cap. The fifth — the visible-
      // light count — cannot, because it is compiled into every lit material as an
      // array size, so changing it would recompile the world's shaders mid-session.
      // That one waits for the next load, and the menu says so. The horizon (far
      // plane, fog and vista disc) belongs to the CPU level and also applies in place.
      const tier = world.state.settings.graphicsQuality;
      renderer.setQuality(tier);
      sky.setQuality(tier, mobilePresentation);
      const horizon = viewDistanceFor(world.state.settings.viewDistance, mobilePresentation);
      renderer.setViewDistance(horizon);
      vista.setViewDistance(horizon);
      loop.setRenderFps(
        presentationFpsFor(world.state.settings.frameRateLimit),
      );
    },
    applyTimePreset: (preset) => {
      world.apply({ t: 'time_of_day', timeOfDay: TIME_OF_DAY_PRESETS[preset] * DAY_LENGTH });
    },
    saveDrive: async () => {
      const state = stateForSave();
      await saves.save(`slot-${state.seed}`, saveName(state), state);
    },
    // Dev only, all seven of them, and behind one fold: `devTools` is `null` unless
    // `import.meta.env.DEV`, which is a compile-time constant, so a production build
    // drops the module, these hooks, and the pause screen's buttons for them together.
    // Each exists because the real thing it stands for cannot be reached from a test
    // session — a car or trailer to inspect, a consumable to exercise the supply
    // economy, a part to fit without scavenging a wreck, a rolled car to right without
    // a gum charge, a seat to take without aiming a look ray at a door, and the one
    // lake per 200-300 km that is hours of driving away.
    spawnVehicle: devTools?.spawnVehicle,
    spawnTrailer: devTools?.spawnTrailer,
    spawnItem: devTools?.spawnItem,
    spawnPart: devTools?.spawnPart,
    flipVehicle: devTools?.flipVehicle,
    seatInNearestCar: devTools?.seatInNearestCar,
    jumpToLake: devTools?.jumpToLake,
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
    if (paused || dying || story !== null || endingStarted) return;
    const shouldRestorePointerLock = restorePointerLock && input.pointerLocked;
    if (document.pointerLockElement !== null) document.exitPointerLock();
    paused = true;
    postcardView = 'down';
    loop.stop();
    // Silence everything behind the overlay, radio included: the loop is stopped,
    // so nothing would update the voices and they would hold their last value. The pad
    // is the same: nothing re-issues its effect either, but one already running has to
    // be stopped, and the menu owns the buttons from here.
    audio.setPaused(true);
    pads.stopRumble();
    void (async () => {
      const state = stateForSave();
      const action = await menu.showPause({ drive: summarizeDrive(state), seed: state.seed }, pauseHooks);
      menu.hidePause();
      // The overlay read the same buttons while the loop was stopped: whatever is still
      // under the player's thumb must not read as a fresh press on the first frame back.
      input.resyncPad();
      padStartHeld = pads.read().buttons[PAD.Start] === true;
      // Do this in the menu gesture's microtask: requestPointerLock needs the
      // transient user activation the Resume press carries.
      if (action !== 'quit' && shouldRestorePointerLock) {
        void canvas.requestPointerLock().catch(() => undefined);
      }
      paused = false;
      audio.setPaused(false);
      if (action !== 'quit') loop.start();
      else {
        // Quit is the player's own decision, so the reload it performs must land on the
        // title screen rather than resuming the drive they just walked away from.
        clearResumeSlot();
        window.location.reload();
      }
    })();
  };

  window.addEventListener('keydown', (e) => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || paused) return;
    if (e.code === 'Escape') {
      openPause();
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
  await warmUpBoot({
    loading,
    worldWork,
    streamer,
    desert,
    renderer,
    sky,
    vista,
    loop,
    world,
    mobilePresentation,
    bootProjection: initialProjection,
    bootGround: initialGround,
    render,
    nextFrameId: () => ++frameId,
    setAdaptationFrozen: (frozen) => {
      adaptationFrozen = frozen;
    },
    takeTierUndetected: () => {
      const undetected = tierUndetected;
      tierUndetected = false;
      return undetected;
    },
  });
  // Start only after every frame callback dependency exists. Starting above the
  // TouchControls declaration lets a fast first RAF hit its temporal dead zone.
  loop.start();

  /**
   * A resumed session that is still running this long after boot has proved it works, so
   * it earns its attempt budget back — otherwise a phone picked up twice would be handed
   * the title screen on the second time. Armed only when this boot WAS a resume: a
   * session the player started by hand has already reset the budget by starting.
   */
  if (resumed) {
    window.setTimeout(() => confirmResumeHealthy(), RESUME_HEALTHY_SECONDS * 1000);
  }
}


// Dev scenes are separate entry points reached by query string, so their code is a
// dynamic import the production bundle drops rather than something the game carries.
const query = new URLSearchParams(window.location.search);
// `?tyre=curve`: the old side-force curve instead of the brush tyre (A/B).
if (query.get('tyre') === 'curve') TYRE_MODEL.brush = false;
const launch = query.has('poi-gallery')
  ? import('./poi-gallery').then(({ bootPoiGallery }) => bootPoiGallery())
  : query.has('artifact-gallery')
    ? import('./artifact-gallery').then(({ bootArtifactGallery }) => bootArtifactGallery())
  : query.has('prop-gallery')
    ? import('./prop-gallery').then(({ bootPropGallery }) => bootPropGallery())
    : query.has('playground')
      ? import('./playground').then(({ bootPlayground }) => bootPlayground())
      : query.has('mirage-lab')
        ? import('./mirage-lab').then(({ bootMirageLab }) => bootMirageLab())
        : query.has('road-lab')
          ? import('./road-lab').then(({ bootRoadLab }) => bootRoadLab())
          : import.meta.env.DEV && query.has('car-lab')
            ? import('./car-lab').then(({ bootCarLab }) => bootCarLab())
            : import.meta.env.DEV && query.has('plane-lab')
              ? import('./plane-lab').then(({ bootPlaneLab }) => bootPlaneLab())
              : boot();

void launch.catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  document.body.innerHTML = `<pre style="color:#e8dcc4;background:#1a1712;padding:2rem;font:14px monospace">failed to start\n\n${message}</pre>`;
  throw error;
});

// A full reload is the only safe HMR story here: hot-swapping this module would
// leave an orphaned Rapier world and WebGL context behind every edit.
if (import.meta.hot) import.meta.hot.accept(() => window.location.reload());
