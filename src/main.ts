import * as THREE from 'three';
import { watchLateLinks } from './render/programbudget';
import { FrameProfiler } from './core/frameprofiler';
import { PerfOverlay } from './ui/perfoverlay';
import { activeBuildProfile, buildProfileFor, installBuildProfile } from './render/retro';
import { BINDABLE_ACTIONS, formatKey, InputReader, emptyInput, type InputFrame } from './core/input';
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
  PHONE_FIRST_LAUNCH,
  TIME_OF_DAY_PRESETS,
  loadStoredSettings,
  presentationFpsFor,
  shadowModeFor,
  starMagnitudeFor,
  storeSettings,
  vehicleLightSlotsFor,
  viewDistanceFor,
  withRemeasure,
} from './game/settings';
import { warmPoiStructures } from './world/poistructures';
import {
  Inventory,
  type CameraItem,
  type ContractCargoItem,
} from './items/items';
import { RideMeter } from './trip/ride';
import { trackPassengerRide } from './contracts/kinds/teddyPassengers';
import { settleBenchTeddies } from './world/shelter';
import { WeaponController } from './items/weapons';
import { LoosePartField } from './parts/loose';
import { oilCapacity } from './parts/registry';
import { TouchControls } from './core/touch';
import { carModelMeasure, loadCarModel } from './render/carmodel';
import { CAR_LAMP_KNEE } from './render/materials';
import { preloadTrailerModel } from './render/trailermodel';
import { itemProgramAnchor } from './render/partmesh';
import { MarketField, marketProgramAnchor } from './world/market';
import { FixtureField } from './world/fixturefield';
import { FarCarField, nearDrawEstimate } from './render/farcars';
import { CarMirrors, mirrorProgramAnchor } from './render/carmirrors';
import { FarRoad } from './render/farroad';
import { DEFAULT_CAR_MODEL_ID, carModel } from './vehicle/carmodels';
import { Interaction } from './player/interaction';
import { MachineFocus } from './player/machinefocus';
import { offerDestinationIndex } from './contracts/offers';
import { ContractRuntime } from './contracts/runtime';
import { isContractClosed } from './contracts/registry';
import { isContractCarId, type ContractWorldDeps } from './contracts/world';
import { HaulBays } from './contracts/haulbays';
import { BayMark } from './render/baymark';
import { urgentRemainingS, type ContractPlace } from './contracts/types';
import { CarTowField } from './vehicle/cartow';
import { IMMOVABLE, Player } from './player/player';
import { PlayerVitals } from './player/vitals';
import { BirdFlock } from './agents/birds';
import { TumbleweedField } from './agents/tumbleweed';
import { CameraRig, DEATH_RISE_SECONDS, DEATH_TOTAL_SECONDS, type CameraTarget } from './render/cameras';
import { seatEye, seatYaw } from './vehicle/cabincamera';
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
/** The beam pool's group for the courtesy lamp, after the lamp groups (`BEAM_GROUPS`). */
const DOME_BEAM_GROUP = BEAM_GROUPS.length;
/** The beam pool's owner for the hand torch (render/vehiclelights.ts `addTorchBeam`). */
const TORCH_BEAM_OWNER = {};
/**
 * Headlamp slot ranking (render/lamppools.ts `LampView`). A beam holding a slot is
 * ranked this much above its score, so two beams of nearly equal worth do not trade the
 * slot back and forth; and a beam scoring under the floor asks for no slot at all, since
 * its pool shows everything of it the player could see.
 */
const HELD_SLOT_SCORE_BONUS = 1.5;
const MIN_SLOT_VIEW_SCORE = 0.02;
/**
 * Traffic headlamps within 80 m of the eye (squared here, m2) whose light reaches any ground in
 * view or the player's own car (a view score above zero, however small), ask for a slot
 * before every farther beam. A pool lights the ground only, so a near car's beam on a
 * post, a wall or a parked car is there only with a slot; past this the ranking by score
 * alone decides.
 */
const NEAR_SLOT_RANGE_SQ = 80 * 80;
/** The player's car as a lit target for that ranking: a sphere round the cabin, metres. */
const PLAYER_CAR_LIT_RADIUS_M = 2.4;
/** Cars past this from the eye (squared, m2) take no pooled lamp light on their bodies. */
const POOL_LIT_CAR_RANGE_SQ = 200 * 200;
import { LampPoolField, LampView } from './render/lamppools';
import { LampOccluders } from './render/lampoccluders';
import { ContactPatchField } from './render/contactpatches';
import { ChunkStreamer } from './world/chunks';
import { DesertTileStreamer } from './world/deserttiles';
import { MesaColliders } from './world/mesacolliders';
import {
  STATE_GROUND_PROBE_DOWN_M,
  STATE_GROUND_PROBE_UP_M,
  STATE_LOAD_RADIUS_M,
  STATE_UNLOAD_RADIUS_M,
} from './world/ranges';
import { AirfieldProvider, BoardableField } from './story/sitebuild';
import { AIRFIELD, airfieldAt } from './story/airfield';
import { createStartingCar, spawnStartingItems, START_SHELLS, storySite } from './story/site';
import { credit, payDriving } from './economy/economy';
import { TakeoffCutscene } from './story/takeoff';
import { StoryOverlay } from './story/overlay';
import { playEnding } from './story/ending';
import { TerminusPadProvider } from './world/terminuspad';
import { LaybyMeshProvider } from './world/laybymesh';
import { PoiProvider, poiReceivesShadows, setPoiReceiveShadows } from './world/poi';
import { cycleDevLook, devLook } from './world/devlook';
import { DebrisField, type Impactor } from './world/debris';
import { GroundCoverField } from './world/props/groundcover';
import { hasEscapedWorld } from './world/landscape';
import { DelineatorProvider } from './world/props/delineators';
import { MonumentProvider, monumentProgramAnchor } from './world/props/monuments';
import { PoleProvider, poleProgramAnchor } from './world/props/poles';
import { delineatorProgramAnchor } from './world/props/delineators';
import { ScatterProvider } from './world/props/scatter';
import { SidetrackProvider, sidetrackProgramAnchor } from './world/sidetrack';
import { RaceTrackProvider, RaceTrackSiteProvider, raceTrackProgramAnchor } from './world/racetrack/mesh';
import { updateWeather, weather, weatherBeginS } from './world/weather';
import { Road, ROAD_LENGTH } from './world/road';
import { WorldOrigin } from './world/origin';
import { PLAYER_FIELD_ID, RoadTraffic } from './world/traffic';
import { Autopilot } from './vehicle/autopilot';
import { RaceDirector } from './race/director';
import { advanceCloudShadows } from './render/cloudshadow';
import { advanceDesertGlitter, setDesertGroundArclength } from './world/terrainmesh';
import { WeatherParticles } from './render/weatherparticles';
import { setDesertDustArclength } from './render/desertdust';
import { setGroundFadeWindow } from './render/groundfade';
import { nextPostIndex, postStop, postStopsBetween } from './world/poststops';
import { laybyNear } from './world/layby';
import { placeNameAt } from './world/placenames';
import { postSlot } from './world/poislots';
import { roadsideStop } from './world/settlement';
import { loadSpine } from './world/spinecache';
import { RoadMeshProvider } from './world/roadmesh';
import { RoadDistance } from './world/roaddistance';
import { Terrain } from './world/terrain';
import { WorldWorkScheduler } from './world/workqueue';
import { Hud, newMapView } from './ui/hud';
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
import { bonnetWaterCapacity } from './vehicle/bonnet';
import {
  TrailerField,
  TRAILER_MODEL_FIT,
} from './vehicle/trailer';
import { Vehicle } from './vehicle/vehicle';
import type { TrunkViewState } from './vehicle/trunk';
import { GameAudio, type AmbienceFrame, type CarPose, type RadioSpatialState } from './audio/gameaudio';
import { cabinOpenness, type CabinOpenness } from './audio/cabinopenness';
import { STREAM_FRAME_BUDGET_MS, STREAM_JOBS_PER_FRAME, warmUpBoot } from './app/bootwarmup';
import { installDevTools } from './app/devtools';
import { createPlayerImpacts } from './app/playerimpacts';
import { createWheelEffects } from './app/wheeleffects';
import { SignpostProvider } from './world/signposts';

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
/**
 * Inside mirror channel units (radians) per radian of mouse look while E is held on it:
 * half, since a mirror turned by θ swings its view by 2θ. Signs make the image follow
 * the hand: mouse right shows more of the right, mouse up more of the sky.
 */
const MIRROR_HAND_YAW = 0.5;
const MIRROR_HAND_PITCH = 0.5;

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

/** How far past the death sequence's own length the watchdog waits before ending it. */
const DEATH_WATCHDOG_SLACK_S = 3;
/** How long a death's reload may take to land before the title gets a button of its own. */
const DEATH_RELOAD_PATIENCE_MS = 10000;

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
 * The strong motor is COLLISIONS ONLY. The pad once carried the whole road on it —
 * bumps, texture, slide, side slip, the steering going light — and the player asked for
 * the one event worth feeling in the hands: hitting something.
 */
const RUMBLE_IMPACT_FULL_MPS = 4;
/**
 * THE ROAD on the weak motor (`VehicleAudioState.roadFeelMps`, the suspension's speed
 * above the body's own motion): nothing under `RUMBLE_ROAD_FLOOR_MPS`, which a smooth
 * road and a car swaying on its springs stay under, rising to `RUMBLE_ROAD_MAX` of the
 * motor at `RUMBLE_ROAD_FULL_MPS`, a seam taken at speed. The weak motor is the light
 * high-frequency one, so the road reads as a texture in the hands, not a shake [E].
 */
const RUMBLE_ROAD_FLOOR_MPS = 0.05;
const RUMBLE_ROAD_FULL_MPS = 0.6;
const RUMBLE_ROAD_MAX = 0.6;

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
  const resumedState = resumeSlot === null ? null : await saves.load(resumeSlot).catch(() => null);
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
  const choice = resumedState !== null
    ? { kind: 'load' as const, state: resumedState }
    : await menu.show(saves);
  // The one saved world: Continue loads the last drive, New game starts a fresh world
  // on the Oka (`createStartingCar`).
  const chosenState = choice.kind === 'load' ? choice.state : null;
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
    const stored = loadStoredSettings(mobilePresentation);
    if (stored) {
      world.apply({ t: 'settings', settings: stored });
    }
    if (!stored && mobilePresentation) {
      world.apply({ t: 'settings', settings: { ...world.state.settings, ...PHONE_FIRST_LAUNCH } });
    }
    tierUndetected =
      world.state.settings.graphicsQualitySource === 'default' && !mobilePresentation;
  }
  // Before anything is built: the build profile (render/retro.ts), from the rung and the
  // grass setting, decides the ground cover, the plants, the open desert and, on Very
  // Low, the finishing pass, and all of them are baked for the page's lifetime.
  installBuildProfile(world.state.settings.graphicsQuality, world.state.settings.groundCover);
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
    world.state.settings.fxaa,
    DEFAULT_INK_STRENGTH,
    mobilePresentation,
    world.state.settings.frameScale,
    world.state.settings.shadows,
  );
  renderer.setRetroLines(world.state.settings.retroLines);
  renderer.setMsaa(world.state.settings.msaa);
  renderer.setTaa(world.state.settings.taa);
  renderer.setUpscaling(world.state.settings.upscaling, world.state.settings.sharpness);
  // The mirror world's road: one low-poly ribbon, no near chunks, no shadow.
  const farRoad = new FarRoad(road, renderer.scene);
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
   * Letterboxes by changing the canvas viewport itself. Renderer.setCinema then
   * updates both the drawing buffer and camera aspect, so nothing is cropped or
   * squeezed behind the bars, and puts the Panini lens on the film with them.
   */
  const toggleCinema = (): void => {
    renderer.setCinema(document.body.classList.toggle('is-cinematic'));
  };

  const vehicleLights = new VehicleLightRig(
    renderer.scene,
    world.state.settings.graphicsQuality,
    mobilePresentation,
  );
  // Who holds the rig's spotlights frame to frame: a slot is handed over by fading,
  // never reassigned in one frame (render/slotpool.ts).
  const beamPool = new FadingSlotPool(vehicleLights.lightCount, LAMP_HANDOVER_S);
  // Every lit lamp without a slot lays its light on the ground as a pool instead, in one
  // draw (render/lamppools.ts); `lampView` ranks the headlamps for the slots. The cars
  // nearest the eye stand in the light of both tiers as boxes (render/lampoccluders.ts).
  const lampOccluders = new LampOccluders();
  const lampPools = new LampPoolField(
    renderer.scene,
    origin,
    {
      frame: (x, z, hintS, out) => {
        const at = road.project(x, z, Number.isFinite(hintS) ? hintS : undefined);
        out.s = at.s;
        out.lateral = at.lateral;
        out.heading = road.headingAt(at.s);
        out.halfWidth = road.halfWidthAt(at.s);
        return out;
      },
      heightAt: (x, z, s) => terrain.heightAt(x, z, s),
    },
    vehicleLights.headlightDistanceScale,
    lampOccluders,
  );
  const lampView = new LampView();
  // The car whose body skips the spot slots that cannot reach it (`syncSpotReach`).
  let spotReachCar: Vehicle | null = null;
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
  // The pad's preferences are device-facing like the mouse's, so they are pushed at
  // the same place and by the same code in `applySettings` below.
  const pads = gamepads();
  pads.setDeadzone(world.state.settings.controllerDeadzone);
  pads.setSteeringSensitivity(world.state.settings.controllerSteerSensitivity);
  // The navigator's road and posts, named, each with its lay-by's side (the map's +1 is
  // right of the way up the road; `offsetPoint`'s +lateral is left), asked for as the car moves on.
  const hud = new Hud(uiRoot, {
    postsBetween: (fromS, toS) =>
      postStopsBetween(world.seed, fromS, toS).map((stop) => {
        const layout = roadsideStop(world.seed, postSlot(stop.index))?.layout;
        return { index: stop.index, s: stop.s, name: placeNameAt(world.seed, stop.s), side: layout ? (layout.side === 1 ? -1 : 1) : 0 };
      }),
    roadPoint: (s, out) => {
      const sample = road.sampleAt(s);
      out.x = sample.x;
      out.z = sample.z;
    },
  });
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
  sky.setShadowMode(world.state.settings.shadows);
  // The clouds' shadow map is drawn before the scene; installed before the boot warm-up
  // so `waitForFrameShaders` links its programs.
  renderer.setCloudShadowPass(sky.clouds);
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
  /** The lot cars' price signs in the physics band (world/market.ts). */
  const market = new MarketField();
  /** The streamed mechanical fixtures: post machines, pumps, key boxes (world/fixturefield.ts). */
  const fixtures = new FixtureField();
  /** The parked plane's colliders, so the eye ray can tell the plane from scenery. */
  const boardable = new BoardableField();
  const birds = new BirdFlock(renderer.scene, road, terrain, world.seed, origin);
  const weapons = new WeaponController();
  const heldView = new HeldItemView(renderer.camera, renderer.scene);
  // The kit car's live mirrors, for the car the player sits in and the cabin view only.
  // Every other car is drawn in them as its far mesh: traffic and the player's own alike.
  const carMirrors = new CarMirrors(
    renderer,
    world.state.settings.graphicsQuality,
    world.state.settings.mirrorFrameRate,
    (visit) => {
      traffic.forEachVehicle(visit);
      for (const [id, vehicle] of vehicles) visit(id, vehicle);
    },
  );
  carMirrors.setEnabled(world.state.settings.cabinMirrors);
  carMirrors.setFarRoad(farRoad);
  const trunkView = new TrunkView(renderer.scene);
  // The opening of the card machine the player stands at (world/cardmachine.ts), drawn
  // as a boot's grid; its own instance, so an open boot on the lay-by stays drawn beside it.
  const machineGridView = new TrunkView(renderer.scene, 'machine-grid');
  /** The car currently showing a sticker being tried on, so it can be cleared. */
  let stickerPreviewCarId: string | null = null;
  // Sand/gravel spray lives for the session like the other view systems; its
  // pool ages every frame and only the driven car flings into it.
  const wheelSpray = new WheelSpray(renderer.scene, origin);
  // Ground marks use the same wheel telemetry as spray, but retain a bounded history
  // in one pooled mesh instead of creating scene objects along the route.
  const tyreTracks = new SandTyreTracks(renderer.scene, origin);
  // Tumbleweeds share the spray ring so a hit can become dust without a second particle
  // budget. Their own cap is four fixed instances.
  const tumbleweeds = new TumbleweedField(renderer.scene, road, terrain, world.seed, origin, wheelSpray);
  // Tufts, shrubs and rosettes burst into the same spray ring; no Rapier colliders.
  const groundCover = new GroundCoverField(wheelSpray, origin);
  // The 20 km marks, the sidetracks, the race tracks, the loose items, the market's
  // machines and lot signs and the post machines, pumps and key boxes (POI kit boxes and
  // sign boards) are built only where they stand; their hidden program anchors are in the
  // scene from boot so the first one in view links nothing. Telegraph poles are drawn per
  // chunk as InstancedMeshes: their program is linked here too.
  renderer.scene.add(
    monumentProgramAnchor(),
    sidetrackProgramAnchor(),
    raceTrackProgramAnchor(),
    poleProgramAnchor(),
    delineatorProgramAnchor(),
    itemProgramAnchor(),
    mirrorProgramAnchor(),
    marketProgramAnchor(),
  );
  // Far traffic draws as instances in the scene's far-car batches, one draw per batch and
  // pass for every model; built now so the far batch links its program behind the loading
  // cover (render/farcars.ts).
  const farCars = new FarCarField(renderer.scene);
  // Mid traffic's shared parts (trim, glass, lenses, wheels): the same batches; each car's
  // paint draws in its own root (render/farcars.ts, MID TRAFFIC).
  const midCars = new FarCarField(renderer.scene);
  // Near traffic's shadows: every near traffic car casts as its far mesh or hull here,
  // instances the batches draw in shadow passes alone.
  const shadowCars = new FarCarField(renderer.scene, true);

  // Shared exact nearest-road field: the tile streamer uses it to grade the open
  // lattice into the road corridor without searching the full spine per vertex.
  const roadDistance = new RoadDistance(road);
  // Owns every piece of scenery that can be knocked apart, and the resulting debris.
  // Built before the streamer because `ScatterProvider` hands it every breakable prop
  // it makes, and asks it which ones are already down.
  const debris = new DebrisField(physics, world, renderer.scene, origin);
  const vista = new VistaMesh(renderer.scene, terrain, road, origin);
  // One deck for both mirage systems, so vessels and tableaus take turns on the road.
  const mirageSchedule = new MirageSchedule(world.seed, road.length);
  const mirage = new DistantMirage(renderer.scene, road, terrain, world.seed, origin, mirageSchedule);
  const mirageTableau = new MirageTableau(renderer.scene, road, terrain, world.seed, origin, mirageSchedule);
  // Rain, flying dust and blown sand: three instanced draws, each off in fair weather.
  const weatherParticles = new WeatherParticles(renderer.scene, world.seed);
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
  // The mesas near the player are solid (world/mesacolliders.ts).
  const mesaColliders = new MesaColliders(physics, road, terrain, origin);

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
  // First: places the race tracks this chunk's ground reads, a step at a time, before
  // any provider below samples it (world/racetrack/mesh.ts).
  streamer.register(new RaceTrackSiteProvider());
  streamer.register(new RoadMeshProvider(world.seed, roadDistance));
  // The paved lay-bys in front of the roadside stops (world/layby.ts), hung off the
  // ribbon's edge rows, so they build right after it.
  streamer.register(new LaybyMeshProvider());
  // Every lay-by's signpost: the stop's name and the stops either way (world/signposts.ts).
  streamer.register(new SignpostProvider());
  // The airfield and its plane, where one is placed (story/airfield.ts: none is today).
  const airfield = AIRFIELD ? airfieldAt(world.seed, road, terrain, AIRFIELD) : null;
  const airfieldSite = airfield ? new AirfieldProvider(airfield, boardable) : null;
  if (airfieldSite) streamer.register(airfieldSite);
  streamer.register(new TerminusPadProvider());
  streamer.register(new ScatterProvider(debris, groundCover));
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
  // The race tracks beside some posts (world/racetrack/): ribbon, paddock, lane, paint and
  // props in the chunk of their post, colliders once it is physical. The shared lattice
  // again, for the lane's drape on the drawn ground.
  streamer.register(new RaceTrackProvider(roadDistance));
  streamer.register(new MonumentProvider());
  streamer.register(
    new PoiProvider(
      roadDistance,
      market,
      fixtures,
    ),
  );

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
    (carId) => vehicles.get(carId) ?? null,
    () => hud.setToast('the tow bar snapped'),
    // A haul's car is only ever towed: its A-frame is bolted to its front bumper.
    isContractCarId,
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
        scheduledHz: () => loop.presentation.scheduledHz,
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
  // Dev: a program linked mid-drive is reported with its materials (render/programbudget.ts).
  let booted = false;
  const lateLinks = import.meta.env.DEV
    ? watchLateLinks(renderer.renderer, renderer.scene, () => booted, () => world.state.settings)
    : null;

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
        // immediately after any resolution change, because the renderer throws its
        // average away, so a machine that measures its GPU perfectly well would have been
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
        // What the loop actually schedules, not the setting: a 144 cap on a 60 Hz panel
        // presents at 60, and the report must not claim otherwise (core/loop.ts).
        const pacing = loop.presentation;
        const hz = (value: number | null): string => (value === null ? '?' : value.toFixed(1));
        const framesPerSecond =
          pacing.capFps === null
            ? `uncapped @ ${hz(pacing.callbackHz)} Hz`
            : pacing.mode === 'divisor'
              ? `cap ${pacing.capFps} -> every ${pacing.divisor} of ${hz(pacing.callbackHz)} Hz = ${hz(pacing.scheduledHz)} FPS`
              : `cap ${pacing.capFps} -> ${pacing.mode} @ ${hz(pacing.scheduledHz)} FPS (display ${hz(pacing.callbackHz)} Hz)`;
        const frame = renderer.frameSize;
        const shown = renderer.presentedSize;
        const chosen = s.graphicsQuality === 'retro' ? `${s.retroLines} lines` : `screen x${s.frameScale}`;
        const header = [
          `tier ${s.graphicsQuality}, ${mobilePresentation ? 'phone' : 'desktop'} presentation`,
          `resolution ${frame.width}x${frame.height} (${chosen}), `
            + `${((frame.width * frame.height) / 1_000_000).toFixed(2)} Mpx, `
            + `${shown.fit} onto ${shown.displayWidth}x${shown.displayHeight}, `
            + `dpr ${window.devicePixelRatio.toFixed(2)}`,
          `presenting ${framesPerSecond}, shadows `
            + `${shadowModeFor(s.shadows, s.graphicsQuality, mobilePresentation)}, `
            + `grass ${s.groundCover}, fxaa ${s.fxaa ? 'on' : 'off'}, msaa ${s.msaa ? `${s.msaa}x` : 'off'}, `
            + `taa ${s.taa ? 'on' : 'off'}, upscaling ${s.upscaling}`
            + (s.upscaling === 'fsr' || s.taa ? ` (sharpness ${Math.round(s.sharpness * 100)}%)` : ''),
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
        // the only way to attribute its `waiting` is to change something and watch. The
        // frame height is the change that is both a single variable and applied without a
        // reload: it scales every pass's pixel work and the number of draws not at all. If
        // halving the pixels does not move the waiting, pixels are not what the frame waits for.
        if (!measuresGpu) {
          header.push(
            'Attribution without a timer: set Resolution to 540p under Quality > Advanced and re-read.',
            'Waiting that shrinks with it is pixel work; waiting that does not is elsewhere.',
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
      else {
        vehicles.set(car.id, vehicle);
        // A haul's car stands with its hazards on, wherever it is (contracts/world.ts).
        if (isContractCarId(car.id)) vehicle.setIndicator('hazard');
      }
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
  const mapView = newMapView();
  /** How far past a receiving post's arclength it stays the delivery target, m. */
  const DELIVERY_PAST_POST_M = 40;
  /** The shell jar is out on foot this near a lay-by: along it past its slips, and out across it past its pad (the post's furniture, the houses' fronts). */
  const JAR_ALONG_M = 10;
  const JAR_ACROSS_M = 25;
  /** Fixed ground somewhere under an ABSOLUTE point; see STATE_LOAD_RADIUS_M in world/ranges.ts. */
  const groundUnder = (x: number, y: number, z: number): boolean =>
    physics.hasFixedGroundBelow(
      x - origin.x,
      y + STATE_GROUND_PROBE_UP_M,
      z - origin.z,
      STATE_GROUND_PROBE_UP_M + STATE_GROUND_PROBE_DOWN_M,
    );
  /**
   * "Out of view": out of the camera's frustum as last rendered. Things that appear or go
   * by themselves (a haul's load, a race's rival) wait for a look away.
   */
  const cameraFrustum = new THREE.Frustum();
  const cameraViewMatrix = new THREE.Matrix4();
  const cameraSphere = new THREE.Sphere();
  const inCameraView = (x: number, y: number, z: number, radius: number): boolean => {
    const cam = renderer.camera;
    cameraViewMatrix.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    cameraFrustum.setFromProjectionMatrix(cameraViewMatrix, cam.coordinateSystem, cam.reversedDepth);
    cameraSphere.center.set(x - origin.x, y, z - origin.z);
    cameraSphere.radius = radius;
    return cameraFrustum.intersectsSphere(cameraSphere);
  };
  /**
   * THE RACES AT THE TRACKS (race/director.ts): the rival at a track's grid, the offer, the
   * lights, the laps and the stake. Built before the first reconcile, which asks it which
   * cars it keeps live, and before the boot warm-up, which links its lights' and board's
   * programs.
   */
  const race = new RaceDirector(world, physics, renderer.scene, origin, terrain, {
    vehicle: (id) => vehicles.get(id) ?? null,
    inView: inCameraView,
    groundUnder,
    toast: (text) => hud.setToast(text),
    keyLabel: (id) => {
      const keys = world.state.settings.keyBindings[id] ?? BINDABLE_ACTIONS.find((action) => action.id === id)?.defaultKeys ?? [];
      return keys.length > 0 ? formatKey(keys[0]!) : '?';
    },
  });
  /** A traffic car or the racing rival, offered for a voice; one visitor for every frame. */
  const hearCar = (id: string, vehicle: Vehicle): void => {
    audio.updateTrafficVehicle(id, vehicle.audio, vehicle.kit, vehicle.root.position.x, vehicle.root.position.y, vehicle.root.position.z);
  };
  /**
   * A COUPLED RIG LIVES AND SLEEPS WHOLE. The cars on one tow bar, and a car with a
   * trailer on its ball, are a rig keyed by its front car (`rigRoot`, rebuilt each
   * reconcile from the couplings in state). A rig is held live while the player drives
   * any car of it or any of its cars is in range on fixed ground; then every car of it
   * is materialised, so the bar always has both bodies. Otherwise every car of it goes
   * back into state together, coupling and all: `carTowField.syncFromState` and
   * `TrailerField.updateActive` put the joints back when the rig is live again.
   *
   * Holding a coupled car live whatever its distance, which this replaced, kept a rig
   * the player had walked or driven away from on bodies whose ground streamed out from
   * under it: measured in game, a UAZ-469 and its towed GAZ-24 resumed from a save 1.5
   * km from the player were falling through y = -2480 m five seconds later.
   */
  const rigRoot = new Map<string, string>();
  const heldRigs = new Set<string>();
  const rigPosition = { x: 0, y: 0, z: 0 };
  const markCoupledRigs = (): void => {
    const cars = world.state.cars;
    const trailers = world.state.trailers;
    rigRoot.clear();
    // The front of a rig: up the bars, guarded against a malformed loop.
    const rootOf = (id: string): string => {
      let at = id;
      for (let hop = 0; hop < 8; hop++) {
        const up = cars[at]?.towedBy ?? null;
        if (up === null || !cars[up]) break;
        at = up;
      }
      return at;
    };
    for (const id in trailers) {
      const carId = trailers[id]!.hitchedTo;
      if (carId !== null && cars[carId]) rigRoot.set(carId, rootOf(carId));
    }
    for (const id in cars) {
      const towerId = cars[id]!.towedBy ?? null;
      if (towerId === null || !cars[towerId]) continue;
      const root = rootOf(id);
      rigRoot.set(id, root);
      rigRoot.set(towerId, root);
    }
  };
  /** A live car still belongs in the active set: within the unload radius, on fixed ground. */
  const liveCarInRange = (vehicle: Vehicle, anchorX: number, anchorZ: number): boolean => {
    const position = vehicle.absoluteTranslation(rigPosition);
    return (
      withinRadius(position.x, position.z, anchorX, anchorZ, ACTIVE_UNLOAD_RADIUS_SQUARED) &&
      groundUnder(position.x, position.y, position.z)
    );
  };
  /** A dormant car may join the active set: within the load radius, on fixed ground. */
  const savedCarInRange = (car: CarState, anchorX: number, anchorZ: number): boolean =>
    withinRadius(car.x, car.z, anchorX, anchorZ, ACTIVE_LOAD_RADIUS_SQUARED) && groundUnder(car.x, car.y, car.z);
  /**
   * A car out of the active set: back into state where it stands. Its couplings go
   * first, unrecorded — a joint that names a removed body traps the wasm (see the
   * `car_remove` listener), and the coupling itself stays in state for the wake.
   */
  const sleepCar = (id: string, vehicle: Vehicle): void => {
    trailerField.sleepWith(id);
    carTowField.remove(id);
    vehicle.pushState();
    vehicle.dispose();
    vehicles.delete(id);
  };
  const reconcileActiveWorld = (anchorX: number, anchorZ: number): void => {
    const drivingId = world.state.player.drivingCarId;
    const cars = world.state.cars;
    markCoupledRigs();
    heldRigs.clear();
    for (const [id, root] of rigRoot) {
      if (heldRigs.has(root)) continue;
      const vehicle = vehicles.get(id);
      if (
        id === drivingId ||
        (vehicle ? liveCarInRange(vehicle, anchorX, anchorZ) : savedCarInRange(cars[id]!, anchorX, anchorZ))
      ) {
        heldRigs.add(root);
      }
    }
    for (const id in cars) {
      const car = cars[id]!;
      const vehicle = vehicles.get(id);
      const root = rigRoot.get(id);
      const held = root !== undefined && heldRigs.has(root);
      if (vehicle) {
        // A race's rival is held live round the whole lap (race/director.ts `keepsLive`).
        if (id === drivingId || held || race.keepsLive(id)) continue;
        // Out of range, or the ground under it has been taken away (a desert tile
        // demoted behind the player): back into state where it stands, rather than
        // falling out of the world with nobody watching. A rig that is not held goes
        // whole, whatever this one car's own distance.
        if (root !== undefined || !liveCarInRange(vehicle, anchorX, anchorZ)) sleepCar(id, vehicle);
      } else if (id === drivingId || held || (root === undefined && savedCarInRange(car, anchorX, anchorZ))) {
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
   * What answers the player's lean on a struck rigid body: a football kicks, a live
   * vehicle's chassis is `IMMOVABLE` (the player never pushes cars).
   *
   * A linear scan over the live vehicles, which is a handful: the streamer only keeps
   * cars near the camera, and this runs only while the capsule is actually pressed
   * into something dynamic. A handle map would have to be maintained through every
   * spawn, despawn and rebuild for no measurable gain.
   *
   * Bodies with no owner here — loose parts, jerry cans — get the player's direct
   * impulse instead.
   */
  player.setShoveLookup((bodyHandle) => {
    const football = loose.shoveableForBody(bodyHandle);
    if (football) return football;
    for (const vehicle of vehicles.values()) {
      if (vehicle.chassis.handle === bodyHandle) return IMMOVABLE;
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
  // the local solid desert square and synchronously settle the current road chunk
  // before the loading cover leaves, so starter bodies have solid support.
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
    // The player starts with a few shells.
    credit(world, START_SHELLS);
  }
  // A full jar's lost shells, for the jar to pop over its rim, and a fine's, to leap out
  // of it with its sorry tune, before it takes the new count.
  world.onDelta((delta) => {
    if (delta.t !== 'shells') return;
    if (delta.spilled) hud.spillShells(delta.spilled);
    if (delta.fined) {
      hud.fineShells(delta.fined);
      audio.foley('fine');
    }
  });

  // POI working cars enter state when their chunk reaches the physics band. A new
  // runtime exists immediately only if the car belongs in the current active set.
  world.onDelta((delta) => {
    // A delivered contract car or trailer leaves state and must leave the scene and
    // the collider maps with it: the streaming reconcile walks the cars and trailers
    // that ARE in state, so a removed one would otherwise stand there for the session.
    // A car put into the toy box (world/toybox.ts) leaves the world the same way.
    if (delta.t === 'car_remove' || (delta.t === 'car_box' && !world.state.cars[delta.carId])) {
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
    // A car made, or taken out of the toy box into its bay on a post's lay-by.
    const car = delta.t === 'car_add' ? delta.car : delta.t === 'car_unbox' ? world.state.cars[delta.carId] : undefined;
    if (!car) return;
    const anchor = activeWorldAnchor();
    if (
      car.id === world.state.player.drivingCarId ||
      withinRadius(
        car.x,
        car.z,
        anchor.x,
        anchor.z,
        ACTIVE_LOAD_RADIUS_SQUARED,
      )
    ) {
      void materializeVehicle(car).catch((error: unknown) => {
        console.error(`failed to load car model "${car.modelId}"`, error);
        hud.setToast(`could not load ${carModel(car.modelId).label}`);
      });
    }
  });
  const initialActiveAnchor = activeWorldAnchor();
  const initialDrivingId = world.state.player.drivingCarId;
  // The same rule as `reconcileActiveWorld`, read from state: a rig comes in whole when
  // it is driven or any car of it is in range, and not at all otherwise.
  markCoupledRigs();
  heldRigs.clear();
  for (const [id, root] of rigRoot) {
    if (id === initialDrivingId || savedCarInRange(world.state.cars[id]!, initialActiveAnchor.x, initialActiveAnchor.z)) {
      heldRigs.add(root);
    }
  }
  const initialCars = Object.values(world.state.cars).filter((car) => {
    const root = rigRoot.get(car.id);
    return (
      car.id === initialDrivingId ||
      (root !== undefined
        ? heldRigs.has(root)
        : savedCarInRange(car, initialActiveAnchor.x, initialActiveAnchor.z))
    );
  });
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
    // The chunk under the rescue point may have been built visual-only while the body
    // was out in the desert. The streamer's queue would promote it over several frames;
    // the next physics step needs it solid, so settle it now (ChunkStreamer.prime).
    streamer.prime(projection.s, 0);
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
    fixtures,
    {
      toast: (text) => hud.setToast(text),
      focus: (fixtureId) => machineFocus.enter(fixtureId),
      // A machine whose work is out in the world (a car boxed) lets go, so the player sees it.
      stepBack: () => machineFocus.leave(true),
    },
  );
  interaction.attachPlayer(player);
  /** The machine the player works up close with the cursor (player/machinefocus.ts). */
  const machineFocus = new MachineFocus(
    canvas,
    input,
    renderer.camera,
    fixtures,
    origin,
    () => interaction.fixtureCtx,
    (fixtureId) => interaction.setFocusedFixture(fixtureId),
  );

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
    if (delta.t === 'sticker_place') {
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
  camera.setShake(world.state.settings.cameraShake);
  camera.setStyle(world.state.settings.cameraStyle);
  camera.setYaw(initialYaw);

  // Synthesises ordinary InputFrame commands, so every fuel, gearbox, tyre and
  // steering rule the human drives under applies to it unchanged.
  const autopilot = new Autopilot(road, physics);
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
    steering: 0,
    surfaceRoughness: 0,
    wheelContact: 0,
    cabinOffset: [0, 0, 0],
    cabinYaw: 0,
    eyeDrop: 0,
    velocityX: 0,
    velocityZ: 0,
    velocityY: 0,
    autopilot: false,
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
  /** The controls an autopilot drives with while the player sits in another seat. */
  const passengerDrive: InputFrame = emptyInput();
  const blankDrive: Readonly<InputFrame> = emptyInput();
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
  /** The crosshair is on something a car works that no prompt names; see `InteractionResult.actionable`. */
  let actionable = false;
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
  /** The fade to silence has begun (with the fade to black); see `render`. */
  let deathAudioFading = false;
  /** Rendered frames since the death began, for the watchdog's report. */
  let deathFrames = 0;
  let deathWatchdog = 0;
  /**
   * THE END OF A DEATH: back to the title, whoever gets here first — the death camera
   * finishing in `render`, or the wall-clock watchdog `armDeathWatchdog` set. The title
   * is a reload, so the slot's resume marker goes first: clearing it is what stops the
   * reload from resuming straight back into the corpse. The sound, the radio included,
   * is already fading with the screen; the radio streams are stopped outright with the
   * black frame, so nothing plays on while the next page loads.
   */
  const finishDeath = (): void => {
    if (deathReloadScheduled) return;
    deathReloadScheduled = true;
    window.clearTimeout(deathWatchdog);
    clearResumeSlot();
    hud.setHealthEffects(vitals.damageEffect, true, 1);
    audio.fadeOut(0.25);
    // Hold one fully black painted frame before navigation replaces the scene.
    window.setTimeout(() => {
      audio.setPaused(true);
      window.location.reload();
      // A reload is a navigation, and the old page stays up, black and silent, until
      // the new one arrives. One that never arrives (a stalled server or network) must
      // still leave the player a way to the title.
      window.setTimeout(() => {
        console.error(`death: the reload to the title has not landed in ${DEATH_RELOAD_PATIENCE_MS / 1000} s`);
        showDeathNotice();
      }, DEATH_RELOAD_PATIENCE_MS);
    }, 250);
  };
  const showDeathNotice = (): void => {
    const notice = document.createElement('div');
    notice.className = 'death-reload';
    notice.style.cssText =
      'position:fixed;inset:0;z-index:1000;display:flex;flex-direction:column;align-items:center;'
      + 'justify-content:center;gap:16px;background:#000;color:#eee;font:16px sans-serif;text-align:center';
    const button = document.createElement('button');
    button.textContent = 'Title screen';
    button.addEventListener('click', () => window.location.reload());
    notice.append(button);
    document.body.appendChild(notice);
  };
  /**
   * The death camera runs in `render`, so a render loop that stops or throws partway
   * through would leave the player on a black screen with the world still playing. A
   * wall-clock timer a little past the sequence's length ends the death regardless, and
   * says why it had to.
   */
  const armDeathWatchdog = (): void => {
    window.clearTimeout(deathWatchdog);
    deathFrames = 0;
    deathWatchdog = window.setTimeout(() => {
      if (deathReloadScheduled) return;
      console.error(
        `death: the death camera did not finish within ${DEATH_TOTAL_SECONDS + DEATH_WATCHDOG_SLACK_S} s `
          + `(${deathFrames} frames rendered since, camera complete ${camera.deathComplete}, `
          + `paused ${paused}, page ${document.visibilityState}); going to the title anyway`,
      );
      finishDeath();
    }, (DEATH_TOTAL_SECONDS + DEATH_WATCHDOG_SLACK_S) * 1000);
  };
  if (dying) armDeathWatchdog();
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
    armDeathWatchdog();
    if (document.pointerLockElement !== null) document.exitPointerLock();
    Object.assign(lastInput, deathInput);
    lookYawAccum = 0;
    lookPitchAccum = 0;
    zoomAccum = 0;
    recenterAccum = false;
    prompt = null;
    actionable = false;
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
        fixtures,
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
        beamPool,
        lampPools,
        lampView,
        worldWork,
        streamer,
        desert,
        lakeWater,
        tumbleweeds,
        traffic,
        vitals,
        autopilot,
        race,
        hud,
        beginDeathSequence,
      })
    : null;
  /** Held devices are edge-toggled by F (with nothing aimed) and reset when their item leaves the hand. */
  let binocularsActive = false;
  /** Sticker-in-hand hint: how long it has been showing, and whether it was last frame. */
  let stickerHintClock = 0;
  let stickerHintActive = false;
  let torchlightActive = false;
  let cameraActive = false;
  /** A shutter press is fulfilled from the completed rendered frame, not a fixed step. */
  let pendingPhotoCamera: CameraItem | null = null;
  /** 0..1 while an F-key watch action accelerates four in-game hours; 1 is idle. */
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
  /** `headlampViewScore` of each of `litVehicles` with its range fade, 0 for no slot. */
  const litScores: number[] = [];
  /** Indices into `litVehicles` whose headlamps ask for a slot, best score first: the
   *  near beams (`NEAR_SLOT_RANGE_SQ`) in `nearSlotCandidates`, the rest here. */
  const slotCandidates: number[] = [];
  const nearSlotCandidates: number[] = [];

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
  /** How open the occupied kit car's cabin is to each ear; filled per frame in the cabin view. */
  const cabinEars: CabinOpenness = { left: 0, right: 0 };
  const ambienceFrame: AmbienceFrame = {
    windMps: 0,
    rain: 0,
    drift: 0,
    dust: 0,
    heat: 0,
    dayFactor: 1,
    cabinOpen: null,
    boltSeed: 0,
    boltAge: 99,
    boltDistance: 5000,
    boltAzimuth: 0,
    roadS: 0,
  };
  const playerImpacts = createPlayerImpacts({ physics, player, vitals, vehicles, traffic });

  /** The ride of the car he drives (trip/ride.ts), and the velocity it is fed, reused. */
  const ride = new RideMeter();
  // Contract walk: keeps the delivery target in step with where each contract is, and
  // wears each thing by the knocks, drops and the ride it takes — a thing broken by it
  // closes its job undelivered, fined and told.
  const contracts = new ContractRuntime(
    world,
    ride,
    (carId) => vehicles.get(carId)?.impactTotal ?? null,
    (text) => hud.setToast(text),
  );
  let rideCarId: string | null = null;
  const rideVelocity = { x: 0, y: 0, z: 0 };

  /**
   * The haul bays at work (contracts/haulbays.ts): a post's haul load stood in its pick-up
   * slot until it is taken, accepted when all of it stands inside another, judged when
   * left behind. "Out of view" is out of the camera's frustum as last rendered. The slot
   * a taken haul is bound for is marked on the ground (render/baymark.ts).
   */
  const contractWorldDeps: ContractWorldDeps = { world, road, terrain };
  const haulBays = new HaulBays(contractWorldDeps, {
    livePose: (id, out) => {
      const body = vehicles.get(id)?.chassis ?? trailerField.get(id)?.rigidBody;
      if (!body) return false;
      const t = body.translation();
      const q = body.rotation();
      const v = body.linvel();
      out.x = t.x + origin.x;
      out.y = t.y;
      out.z = t.z + origin.z;
      out.yaw = Math.atan2(2 * (q.x * q.z + q.w * q.y), 1 - 2 * (q.x * q.x + q.y * q.y));
      out.vx = v.x;
      out.vz = v.z;
      return true;
    },
    postLive: (index) => fixtures.get(`post:${index}`) !== null,
    uncouple: (id) => {
      // Recorded drops, the live joint first where there is one.
      const trailer = trailerField.get(id);
      if (trailer) trailer.unhitch();
      else if (world.state.trailers[id]?.hitchedTo) world.apply({ t: 'trailer_hitch', trailerId: id, carId: null });
      trailerField.hitchedTo(id)?.unhitch();
      if (world.state.cars[id]?.towedBy) carTowField.unhitch(id);
      for (const car of Object.values(world.state.cars)) {
        if (car.towedBy === id) carTowField.unhitch(car.id);
      }
    },
    inView: inCameraView,
    toast: (text) => hud.setToast(text),
  });
  const bayMark = new BayMark(renderer.scene, terrain);

  /**
   * The lowest post index any contract the player has on them (in hand, in the car being
   * driven, or a haul taken) may be handed in at, gathered during one contracts tick and
   * read by the next one's HUD line; Infinity with nothing aboard.
   */
  let deliveryMinIndexNext = Infinity;
  let deliveryMinIndex = Infinity;
  /**
   * Seconds left on the most pressing urgent contract aboard (in hand, in the car being
   * driven, or a haul), gathered like `deliveryMinIndex`; null with none aboard. Shown on
   * the bead line's label.
   */
  let urgentLeftNext: number | null = null;
  let urgentLeft: number | null = null;
  const onContractItem = (item: ContractCargoItem, place: ContractPlace, carId: string | null): void => {
    if (isContractClosed(item, world.state.completedContractIds)) return;
    if (place === 'hand' || place === 'haul' || (place === 'car' && carId !== null && carId === world.state.player.drivingCarId)) {
      deliveryMinIndexNext = Math.min(deliveryMinIndexNext, offerDestinationIndex(item));
      const left = urgentRemainingS(item);
      if (left !== null) urgentLeftNext = urgentLeftNext === null ? left : Math.min(urgentLeftNext, left);
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
    // A machine worked up close: the player stands, a click is F, a drag turns its wheel.
    const focusSound = machineFocus.tick(f, world.state.player.drivingCarId !== null);
    if (focusSound) audio.foley(focusSound);
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
    // Only the driver's seat drives. From any other the car stands held like a parked
    // one (`settle` below) and the keys that work it do nothing, unless the autopilot
    // drives it (`stepped`); looking round, the camera, the fittings in reach and the
    // doors stay the occupant's.
    const controlled = driving !== null && s.player.seat === 'driver' ? driving : null;
    touch.setDriving(controlled !== null);
    input.setDriving(controlled !== null);

    // MASS IS RE-DERIVED HERE EVERY STEP rather than wired to the deltas that can
    // change it. Fuel burns, a can pours, the boot takes a parcel, the driver picks
    // something up — four sources today and more later, each of which would have to
    // remember to call in. `computeStats` is a couple of dozen reads, `refreshLoad`
    // returns immediately when the total has not moved, and a live set is a handful
    // of cars, so one unconditional call is both cheaper and impossible to forget.
    // The car the player drives with their own hands gets the driver aids (ABS,
    // traction control); every other car, and this one under the autopilot, drives
    // without them.
    const playerDriven = autopilot.engaged ? null : controlled;
    for (const vehicle of vehicles.values()) {
      vehicle.setPlayerDriven(vehicle === playerDriven);
      vehicle.refreshLoad();
      // Stop-start (`Vehicle.stepAutoStop`): an idling car that stands 20 s stops its
      // engine, and the driver's throttle starts it again. Off while the autopilot drives
      // it (the autopilot starts a stopped engine itself) and during a race (a car held
      // on the grid must leave on the green, not crank first).
      // Forward or back starts it: the backward key held at rest is reverse.
      const step = vehicle.stepAutoStop(
        dt,
        vehicle === controlled ? Math.max(f.throttle, f.reverse ? 1 : 0) : 0,
        !(autopilot.engaged && vehicle === driving) && !race.active,
      );
      if (step === 'stopped' && vehicle === controlled) hud.setToast('engine off: standing 20 s — drive to start');
    }
    syncPackMass(driving);

    // Mouse driving is a preference, so M edits settings rather than a local flag: the
    // pause menu and the key always agree, and it outlasts leaving the car. The reader
    // drives with the mouse only while the player's own hands are on this car's wheel
    // (not on foot, not under the autopilot), taking the wheel where it stands.
    if (f.toggleMouseDriving) {
      const on = !s.settings.mouseDriving;
      world.apply({ t: 'settings', settings: { ...s.settings, mouseDriving: on } });
      hud.setToast(on ? 'Mouse driving: on' : 'Mouse driving: off');
    }
    input.setMouseDriving(
      !dying && s.settings.mouseDriving && playerDriven !== null,
      playerDriven !== null ? -playerDriven.steeringFraction : 0,
    );
    input.setBrakeKnee(playerDriven?.thresholdBrakePedal ?? null);
    // In a race the keys are plain pedals: a tap's cruise notch only got in the way.
    input.setPlainPedals(race.active);

    // The races (race/director.ts): the offer and its F, before anything else reads the
    // key, and the racing rival's own controls, before the step.
    {
      const anchor = activeWorldAnchor();
      race.beforeStep(dt, f, anchor.x, anchor.z, activeS);
    }
    // Refresh the stream's road-frame snapshot before the player's autopilot reads it.
    // Every controller still writes its intent before the shared physics step.
    if (driving === null) {
      const pedestrian = player.absolutePosition;
      traffic.setPedestrianObstacle(pedestrian.x, pedestrian.z);
    } else {
      traffic.clearPedestrianObstacle();
    }
    playerFieldSeat.forwardS = activeS;
    traffic.setPlayerVehicle(driving);
    frameProfiler?.begin('traffic');
    traffic.fixedUpdate(dt, activeS, activeLateral, origin.x, origin.z);
    // THE NAVIGATOR ORB (ui/hudmap.ts): where the player is to the road, and where the
    // route goes — the nearest post ahead that will sign the cargo (it stays the target
    // until the car is past its stand, so stopping alongside does not flip it to the next
    // one), or with nothing aboard the next post.
    {
      mapView.s = activeS;
      mapView.lateral = activeLateral;
      mapView.x = projectedX;
      mapView.z = projectedZ;
      mapView.facing = driving !== null ? driving.heading : camera.yaw;
      const delivering = deliveryMinIndex !== Infinity;
      const target = nextPostIndex(world.seed, activeS - DELIVERY_PAST_POST_M, delivering ? deliveryMinIndex : 0);
      mapView.kind = delivering ? 'delivery' : 'idle';
      mapView.targetIndex = target;
      mapView.targetS = postStop(world.seed, target).s;
      mapView.urgentS = delivering ? urgentLeft : null;
      hud.setMap(mapView);
      // THE SHELL JAR (ui/hudjar.ts): out on foot on a lay-by, where shells are made and
      // spent; elsewhere it only shows a moment whenever shells come or go.
      const layby = driving === null ? laybyNear(world.seed, activeS) : null;
      hud.setShellsShown(
        layby !== null &&
          activeS > layby.sEntry - JAR_ALONG_M &&
          activeS < layby.sExit + JAR_ALONG_M &&
          Math.abs(activeLateral) < layby.padOuter + JAR_ACROSS_M,
      );
    }
    frameProfiler?.end('traffic');

    if (driving && !controlled) {
      player.setEnabled(false);
      if (f.cycleCamera) camera.cycleDriving();
      if (f.toggleAutopilot || f.toggleLights || f.toggleLeftIndicator || f.toggleRightIndicator || f.toggleEngine) {
        hud.setToast('only the driver can do that');
      }
      // Moving to another seat leaves an engaged autopilot driving: it is the car's
      // driver now, and the occupant's own keys reach nothing on the controls. It drives
      // from a blank frame, so a passenger's throttle or steering is never the car's.
      // Only stepping out of the car drops it (the on-foot branch below).
      if (autopilot.engaged) {
        Object.assign(passengerDrive, blankDrive);
        autopilot.setOncomingGap(traffic.nearestOncomingDistance(activeS, 1));
        autopilot.drive(dt, driving, passengerDrive, origin.x, origin.z);
        race.holdPlayer(passengerDrive);
        driving.fixedUpdate(dt, passengerDrive);
      }
    } else if (driving) {
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
          input.releaseHandbrake();
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
      // The engine's switch is the driver's. Stopping it is taking the car back: an engaged
      // autopilot goes off, exactly as P switches it off. Starting it engages nothing.
      if (f.toggleEngine) {
        const stopping = !driving.engineStopped || driving.engineCranking;
        driving.toggleEngine();
        if (stopping && autopilot.engaged) {
          autopilot.setEngaged(false);
          hud.setToast('autopilot off');
        }
      }
      autopilot.setOncomingGap(traffic.nearestOncomingDistance(activeS, 1));
      if (autopilot.engaged) {
        autopilot.drive(dt, driving, f, origin.x, origin.z);
      }
      // Held on the grid until the green (race/director.ts), whatever drove the pedals.
      race.holdPlayer(f);
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
    // The car the player sits in is stepped above whenever someone drives it: the
    // player from the driver's seat, or the autopilot from any seat. Settling it as
    // well pinned it to the spot under an autopilot that kept pressing the throttle.
    const stepped = controlled ?? (driving !== null && autopilot.engaged ? driving : null);
    for (const [id, vehicle] of vehicles) {
      if (vehicle === stepped || carTowField.stepping(id) || race.drives(id)) continue;
      vehicle.settle(dt);
    }

    // The towed car of a live bar: no engine, no gear, brakes on the tower's pedal.
    carTowField.fixedUpdate(dt, (carId) => vehicles.get(carId)?.brakeCommand ?? 0);

    // Trailers get the same treatment for the same reason: their springs only exist
    // inside `updateVehicle`, towed or standing.
    trailerField.fixedUpdate(dt);

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
        // Every position moved a kilometre at once: TAA's reprojection has nothing to hold.
        renderer.resetTemporalHistory();
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
    // A teddy dropped onto a shelter's bench and come to rest gets off there, or goes
    // back on its own bench; one left lying far behind is fined and gone (world/shelter.ts).
    {
      const anchor = activeWorldAnchor();
      const teddyNews = settleBenchTeddies(fixtures, loose, world, anchor.x, anchor.z, dt);
      if (teddyNews) {
        hud.setToast(teddyNews.text);
        if (teddyNews.coin) audio.foley('coin');
      }
    }

    // Contracts walk after every controller and the physics step. `s` is the live
    // state; its clock was advanced at the top of this step.
    frameProfiler?.begin('contracts');
    deliveryMinIndexNext = Infinity;
    urgentLeftNext = null;
    // The urgent clocks run on the step's own seconds, but not while the watch winds the
    // day forward (a paused game runs no step at all).
    contracts.tick(onContractItem, watchFastForwardProgress < 1 ? 0 : dt);
    deliveryMinIndex = deliveryMinIndexNext;
    urgentLeft = urgentLeftNext;
    frameProfiler?.end('contracts');
    {
      const anchor = activeWorldAnchor();
      haulBays.tick(dt, anchor.x, anchor.z, activeS);
      race.afterStep(dt);
      // A race thins the road's traffic while it runs (race/director.ts, WHAT A RACE COSTS A FRAME).
      traffic.raceCeiling = race.trafficCeiling;
    }

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
    // Working a machine, the cursor's ray picks; otherwise the eyes'.
    const dir = machineFocus.ray() ?? camera.eyeDirection;
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
      camera.mode === 'cabin',
    );
    // F with nothing aimed is the held item's (`InteractionResult.useHeld`): this tick's
    // aim, so a press that picked something up or opened a door never also toggles it.
    const useHeld = interacted.useHeld;
    const heldAfterSelection = inventory.held;
    if (driving !== null || heldAfterSelection?.type !== 'binoculars') binocularsActive = false;
    if (driving !== null || heldAfterSelection?.type !== 'torchlight') torchlightActive = false;
    if (driving !== null || heldAfterSelection?.type !== 'camera') cameraActive = false;
    if (driving === null && !dying && !medicineActive && useHeld && heldAfterSelection !== null) {
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
      } else if (heldAfterSelection.type === 'sun_shades') {
        const previous = s.player.wornSunShades;
        const next = inventory.remove(heldAfterSelection.id);
        if (next?.type === 'sun_shades') {
          if (previous !== null) inventory.add(previous);
          world.apply({ t: 'wearable', shades: next });
          hud.setToast(`${next.tint} sun shades on — G to remove`);
        }
      }
    }
    // Getting in from foot sits down facing the windscreen, in the cabin view; C still
    // goes back to the chase.
    if (interacted.boarded) camera.setMode('cabin');
    // Working a machine up close nothing is written on the screen: the machine is the text.
    // Stopped beside a race's rival, the offer is the prompt (race/director.ts).
    prompt = machineFocus.working ? null : (race.prompt ?? interacted.prompt);
    actionable = !machineFocus.working && interacted.actionable;
    boot = interacted.boot;
    machineFocus.updateCursor();
    if (interacted.board && airfield && airfieldSite && story === null && !dying) {
      // Boarding is an ending: a reload from here on must land on the title screen, not
      // resume beside a plane that has already gone.
      clearResumeSlot();
      story = new TakeoffCutscene({
        scene: renderer.scene,
        site: airfield,
        terrain,
        origin,
        audio,
        overlay: storyOverlay,
      });
      airfieldSite.setParkedPlaneVisible(false);
      autopilot.setEngaged(false);
      binocularsActive = false;
      torchlightActive = false;
      cameraActive = false;
      gumActive = false;
      prompt = null;
      actionable = false;
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
        renderer.setCinema(true);
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

    // Radio: a car fitting, so the key and the dash's knob only do anything from a seat.
    // The knob and the key step the same radio (off → station 1 → station 2 → off), and
    // the knob on the dash shows where it stands (its needle on the preset's frequency).
    const cabinPress = interaction.takeCabinPress();
    if (driving) {
      if (f.radioCycle || cabinPress === 'radio') hud.setToast(audio.cycleRadio(drivingId!));
      driving.kit?.set('radio', audio.radioDial(drivingId!));
      // The hazard button: from the driver's seat it steps the hazards with the autopilot,
      // sleeper → hurried → frantic → off, the hazards on while it drives and out with it.
      // Anything that drops the autopilot (P to off, stepping out of the car) drops its
      // hazards too (`Autopilot.setEngaged`). From another seat the autopilot keeps
      // driving but is not the occupant's to change: the button only switches the
      // hazards, and tells a driving autopilot so, or it would put its own lamps back.
      if (cabinPress === 'hazard') {
        if (controlled) {
          if (!autopilot.engaged) {
            autopilot.setMode('sleeper');
            autopilot.setEngaged(true);
            input.releaseHandbrake();
          } else if (autopilot.mode === 'sleeper') {
            autopilot.setMode('hurried');
          } else if (autopilot.mode === 'hurried') {
            autopilot.setMode('frantic');
          } else {
            autopilot.setEngaged(false);
          }
          autopilot.setHazards(autopilot.engaged);
          driving.setIndicator(autopilot.engaged ? 'hazard' : 'off');
          hud.setToast(autopilot.engaged ? `hazards · autopilot: ${autopilot.mode}` : 'hazards off · autopilot off');
        } else {
          const on = driving.indicator !== 'hazard';
          if (autopilot.engaged) autopilot.setHazards(on);
          driving.setIndicator(on ? 'hazard' : 'off');
        }
      }
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
    // The ride of the car he drives (trip/ride.ts): measured, never acted on — what
    // lies on its seats stays where it was laid.
    if (driving && s.player.seat === 'driver') {
      if (rideCarId !== drivingId) {
        ride.idle();
        rideCarId = drivingId;
      }
      driving.chassis.linvel(rideVelocity);
      ride.step(dt, rideVelocity.x, rideVelocity.z, driving.heading);
      const passengersCar = s.cars[drivingId!];
      if (passengersCar) trackPassengerRide(ride, passengersCar);
    } else if (rideCarId !== null) {
      ride.idle();
      rideCarId = null;
    }
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
    mesaColliders.update(desertX, desertZ);
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
      if (s.weatherFromS === null && s.recordS >= weatherBeginS(world.seed)) {
        world.apply({ t: 'weather_begin', playedSeconds: s.playedSeconds });
      }
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
   * Holds the renderer's GPU average off the frames that are not worth counting. Every
   * measurement taken before `measureLaunchFrame` (app/bootwarmup.ts) has finished
   * belongs to the launch transient — freshly compiled shader variants, first texture
   * uploads, the boot GC — not to the cost of the drive, and counting those would read a
   * healthy machine as one that cannot hold its rung.
   */
  let gpuTimingFrozen = true;

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
    rumbleFrame.weak =
      clamp01((driving.audio.roadFeelMps - RUMBLE_ROAD_FLOOR_MPS) / (RUMBLE_ROAD_FULL_MPS - RUMBLE_ROAD_FLOOR_MPS)) *
      RUMBLE_ROAD_MAX *
      gain;
    rumbleFrame.leftTrigger = 0;
    rumbleFrame.rightTrigger = 0;
    pads.vibrate(rumbleFrame, performance.now());
  };

  const render = (alpha: number, frameDt: number): void => {
    frameId++;
    // The dev switch off: what streamed in since the last pass is caught here.
    if (import.meta.env.DEV && !poiReceivesShadows() && frameId % 60 === 0) setPoiReceiveShadows(renderer.scene, false);
    const s = world.state;
    frameProfiler?.beginFrame();
    const drivingId = s.player.drivingCarId;
    const driving = drivingId ? (vehicles.get(drivingId) ?? null) : null;
    updatePad(driving);

    frameProfiler?.begin('vehicles');
    Vehicle.viewFrom(renderer.camera.position, frameDt, driving);
    // The far, mid and shadow fields are begun and ended here, not by the traffic: the
    // race's rivals are drawn into them too (race/director.ts `drawsAsTraffic`).
    farCars.begin();
    midCars.begin();
    shadowCars.begin();
    for (const [id, vehicle] of vehicles) {
      if (race.drawsAsTraffic(id, vehicle)) vehicle.syncVisuals(alpha, farCars, midCars, shadowCars);
      else vehicle.syncVisuals(alpha);
    }
    traffic.syncVisuals(alpha, farCars, midCars, shadowCars);
    farCars.end();
    midCars.end();
    shadowCars.end();
    // Trailer physics advances and snapshots in the fixed step exactly like cars,
    // but its scene root must also consume those snapshots every rendered frame.
    // Without this call the rigid body and hitch moved while the GLB stayed forever
    // at its constructor pose, leaving an invisible trailer attached to the car.
    trailerField.syncVisuals(alpha);
    race.syncVisuals();
    // The bar is drawn from the two chassis' corrected poses, not from a snapshot of
    // its own, so it needs no interpolation and is placed after the cars moved.
    carTowField.syncVisuals();
    debris.syncVisuals();
    // The post machines' wheels, levers, doors and flaps, the pumps' nozzles and hoses and
    // the key boxes ease on the rendered frame.
    fixtures.update(frameDt);
    // The camera has moved for this frame: the ground cover's pages take their range.
    streamer.syncLod(renderer.camera.position.x, renderer.camera.position.z);
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
      target.steering = driving.steeringFraction;
      target.surfaceRoughness = driving.audio.surfaceRoughness;
      target.wheelContact = driving.audio.wheelContactFraction;
      const drivenModel = s.cars[drivingId!]?.modelId;
      if (drivenModel) {
        const measure = carModelMeasure(drivenModel);
        target.cabinOffset = seatEye(measure, s.player.seat);
        target.cabinYaw = seatYaw(measure, s.player.seat);
      }
      target.eyeDrop = 0;
      // The dynamic camera's raw material: where the car is really going, not where it
      // points. Body-frame speed and slip come from the same solver step.
      const velocity = driving.chassis.linvel();
      target.velocityX = velocity.x;
      target.velocityZ = velocity.z;
      target.velocityY = velocity.y;
      target.autopilot = autopilot.engaged;
    } else {
      const p = player.interpolatedPosition(alpha);
      // CameraRig's foot mode adds its own eye height, so hand it the FEET
      // position; `player.position` is the capsule centre and would double up. A
      // crouch is the eye coming down from there, not the feet.
      target.x = p.x;
      target.y = p.y - Player.FEET_OFFSET;
      target.z = p.z;
      target.eyeDrop = player.interpolatedEyeDrop(alpha);
      target.qx = 0;
      target.qy = 0;
      target.qz = 0;
      target.qw = 1;
      target.speedKmh = 0;
      target.steering = 0;
      target.surfaceRoughness = 0;
      target.wheelContact = 0;
      target.velocityX = 0;
      target.velocityZ = 0;
      target.velocityY = 0;
      target.autopilot = false;
    }

    Object.assign(cameraInput, lastInput);
    // F held on the inside mirror: the mouse turns the mirror, the head stays still. A
    // mirror turned by θ swings the view in it by 2θ, so half the look delta moves the
    // image with the hand.
    const aimingKit = interaction.aimingKit;
    // The crosshair shows while the view is being turned and fades once it is left alone.
    hud.noteLook(lookYawAccum !== 0 || lookPitchAccum !== 0);
    if (aimingKit) {
      aimingKit.rig.aim(aimingKit.control, lookYawAccum * MIRROR_HAND_YAW, lookPitchAccum * MIRROR_HAND_PITCH);
      lookYawAccum = 0;
      lookPitchAccum = 0;
    }
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
    camera.setCabinLookHeld(aimingKit !== null);
    let deathFade = 0;
    if (dying) {
      deathFade = camera.updateDeath(frameDt, target);
      deathFrames++;
      // The sound goes with the picture: from the first frame of the fade to black,
      // everything, the radio included, falls silent over the same rise.
      if (deathFade > 0 && !deathAudioFading) {
        deathAudioFading = true;
        audio.fadeOut(DEATH_RISE_SECONDS);
      }
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
      // Stepping up to a machine, or back from it: the view eases between the two.
      machineFocus.updateCamera(frameDt, camera);
    }
    if (dying && camera.deathComplete) finishDeath();
    // Whatever ended the death, the screen stays black from here to the reload.
    if (deathReloadScheduled) deathFade = 1;
    touch.setZoomAvailable(!dying && camera.mode === 'chase');
    touch.setStickerTools(!dying && stickerPreviewCarId !== null);

    const cam = renderer.camera.position;
    frameProfiler?.begin('sky');
    // Weather first: the sky, the fog, the lights and the ground all read it this
    // frame (world/weather.ts). A function of played time from the moment the schedule
    // began, clear before it. The camera is where the wind's gusts are heard; each car
    // samples its own.
    updateWeather(world.seed, s.playedSeconds, frameDt, cam.x + origin.x, cam.z + origin.z, s.weatherFromS);
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

    // Every lit lamp in the active world casts its light, not just the driven car's.
    //
    // This runs AFTER the environment factor above, because that factor is a
    // multiplier on the beam intensities the rig is about to read; projecting first
    // spent a frame on yesterday's twilight.
    //
    // Two tiers. The rig's spotlights are few, so they go through `beamPool`, which
    // hands a slot from one beam to another by fading rather than in one frame; every
    // lit lamp without one (or fading out of one) lays its light on the ground as a
    // pool instead (render/lamppools.ts), in one draw.
    //  - The driven car's lamps and courtesy lamp are pinned at full strength, the tail
    //    glow included, since the chase camera looks straight at it.
    //  - Everyone else's headlamps within 80 m of the eye whose light reaches anything
    //    in view (`NEAR_SLOT_RANGE_SQ`) ask first: a pool lights the ground only, so a
    //    near car's beam on a post, a wall or another car shows only with a slot. Then
    //    the rest, in order of how much of their light the player sees
    //    (`headlampViewScore`): on the road in view, and on his own car and inside its
    //    cabin, which a car close behind lights more than anyone. They used to ask
    //    nearest first, which spent the slots on cars driving away and left the car
    //    behind dark. Each group asks best score first. A far beam the player cannot
    //    see asks for nothing; its pool is all of it there is to see.
    //  - Tail, stop and reversing lamps of every other car are pools only: their light
    //    is a few metres of ground, and a slot each was a slot an oncoming car's beam
    //    did not get.
    // Everyone but the driven car is faded by range (`ambientBeamGain`).
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
    // Ranked before the pool's frame begins, while `share` still reads last frame's
    // holders for the held bonus.
    lampView.update(renderer.camera, driving?.root ?? null, PLAYER_CAR_LIT_RADIUS_M);
    litScores.length = litVehicles.length;
    slotCandidates.length = 0;
    nearSlotCandidates.length = 0;
    for (let i = 0; i < litVehicles.length; i++) {
      const vehicle = litVehicles[i];
      litScores[i] = 0;
      if (vehicle === driving || !(litGains[i] > 0)) continue;
      let score = litGains[i] * vehicle.headlampViewScore(lampView, vehicleLights.headlightDistanceScale);
      if (!(score > 0)) continue;
      if (beamPool.share(vehicle, 0) > 0) score *= HELD_SLOT_SCORE_BONUS;
      litScores[i] = score;
      if (vehicle.root.position.distanceToSquared(cam) < NEAR_SLOT_RANGE_SQ) nearSlotCandidates.push(i);
      else if (score > MIN_SLOT_VIEW_SCORE) slotCandidates.push(i);
      else litScores[i] = 0;
    }
    nearSlotCandidates.sort((a, b) => litScores[b] - litScores[a]);
    slotCandidates.sort((a, b) => litScores[b] - litScores[a]);
    // No lamp pair is merged into one beam any more, traffic included: a car with two
    // lit headlamps laying ONE pool of light on the road read wrongly up close, and the
    // ground light (render/groundlight.ts) made each slot cheap enough to spend two per
    // car. The pool's handover fade still decides who gets light when slots run out.
    // Where the tier draws shadows, the driven car's driver's side lamp takes the rig's
    // one shadow-casting beam (render/vehiclelights.ts; a second shadowed spot measured
    // ten times dearer) and the other lamp a pinned slot.
    const shadowedHeadlamps = vehicleLights.hasShadowBeam;
    beamPool.begin();
    // The hand torch takes a pool slot of its own while lit, pinned ahead of everything:
    // the player is on foot and it is the light he walks by. A slot rather than a light
    // of its own, so lighting it never changes the program.
    if (usingTorchlight) beamPool.request(TORCH_BEAM_OWNER, 0, 1, true);
    // The courtesy lamp of the car the player sits in lights its cabin with one slot,
    // pinned after the headlamps and before the tail and reversing lamps: from the seat
    // it is the light that is seen. On a four-slot tier at night the tail lamps' pair is
    // what gives way to it, and lays a pool instead.
    if (driving) {
      for (let g = 0; g < BEAM_GROUPS.length; g++) {
        if (driving.hasLitLamps) {
          const slots = driving.beamCount(BEAM_GROUPS[g], g === 0 && shadowedHeadlamps);
          beamPool.request(driving, g, slots, true);
        }
        if (g === 0) beamPool.request(driving, DOME_BEAM_GROUP, driving.domeBeamCount, true);
      }
    }
    for (const i of nearSlotCandidates) {
      beamPool.request(litVehicles[i], 0, litVehicles[i].beamCount('front'), false);
    }
    for (const i of slotCandidates) {
      beamPool.request(litVehicles[i], 0, litVehicles[i].beamCount('front'), false);
    }
    beamPool.resolve(frameDt);
    vehicleLights.beginFrame();
    if (beamPool.share(TORCH_BEAM_OWNER, 0) > 0) vehicleLights.addTorchBeam(renderer.camera);
    if (driving && driving.hasLitLamps && shadowedHeadlamps) {
      driving.syncProjectedLights(vehicleLights, 'front', 1, true);
    }
    if (driving) {
      const share = beamPool.share(driving, DOME_BEAM_GROUP);
      if (share > 0) driving.syncDomeLight(vehicleLights, share);
    }
    // The cars nearest the eye, as the boxes both tiers' light is cut by.
    lampOccluders.begin(cam);
    for (const vehicle of vehicles.values()) vehicle.offerLampOccluder(lampOccluders);
    traffic.forEachVehicle((_, vehicle) => vehicle.offerLampOccluder(lampOccluders));
    lampOccluders.end();
    lampPools.beginFrame(activeS);
    // The walk starts at a different car each frame, so the pools' terrain samples
    // (render/lamppools.ts `takeSamples`) go round every car instead of the first few.
    const lit = litVehicles.length;
    const litStart = lit > 0 ? lampPools.frameId % lit : 0;
    for (let k = 0; k < lit; k++) {
      const i = (litStart + k) % lit;
      const vehicle = litVehicles[i];
      for (let g = 0; g < BEAM_GROUPS.length; g++) {
        const share = beamPool.share(vehicle, g);
        if (g === 0 && vehicle === driving) {
          // The driven car's headlamps are slots only; shadowed, they were projected above.
          if (!shadowedHeadlamps && share > 0) {
            vehicle.syncProjectedLights(vehicleLights, 'front', share, false);
          }
          // The cars in their light cast its shadows (render/lamppools.ts, shade pools);
          // the shadowed beam's own map casts its lamp's.
          if (share > 0) vehicle.syncLampShade(lampPools, share, shadowedHeadlamps);
          continue;
        }
        if (share > 0) {
          vehicle.syncProjectedLights(vehicleLights, BEAM_GROUPS[g], litGains[i] * share, false);
          // A slot casts no shadow of its own: its headlamps' shade pool cuts the cars in
          // its beam out of the ground it lights.
          if (g === 0) vehicle.syncLampShade(lampPools, litGains[i] * share, false);
        }
        if (share < 1) vehicle.syncLampPool(lampPools, BEAM_GROUPS[g], litGains[i] * (1 - share));
      }
    }
    lampPools.endFrame();
    vehicleLights.endFrame();
    // Every car near enough to see takes the pooled light that reaches it on its body
    // (render/lamppools.ts `lightOn`): a slot lights a car, so must a pool.
    for (const vehicle of vehicles.values()) {
      vehicle.syncPoolLight(vehicle.root.position.distanceToSquared(cam) < POOL_LIT_CAR_RANGE_SQ ? lampPools : null);
    }
    traffic.forEachVehicle((_, vehicle) => {
      vehicle.syncPoolLight(vehicle.root.position.distanceToSquared(cam) < POOL_LIT_CAR_RANGE_SQ ? lampPools : null);
    });
    // The car the player sits in fills the screen from the cabin, and every spot slot
    // that lights nothing of it is a whole light per pixel of it (render/lightshader.ts
    // `SPOT_REACH`): its body skips the beams that cannot reach it. A car left
    // behind takes every slot again, since only this one is tested each frame.
    if (spotReachCar !== driving) {
      spotReachCar?.syncSpotReach(null);
      spotReachCar = driving;
    }
    driving?.syncSpotReach(vehicleLights);

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
    vista.update(cam.x, cam.z, activeS);
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
    });

    // Render-only illusions: neither one owns physics, terrain, streamed props, or
    // permanent world state. Tableaus dissolve as soon as the player leaves the road.
    mirage.update(activeS, sky.dayFactor);
    mirageTableau.update(activeS, activeLateral, sky.dayFactor);
    // The drifting clouds and the shade every ground material reads from them. Driven by
    // the RENDER frame's own dt, so a paused game's clouds stop with it, and given the
    // f64 origin because the clouds are anchored to the world rather than to the player —
    // see `render/cloudshadow.ts`. Then the cloud layer places this frame's clouds round
    // the camera and aims its shadow map (`render/clouds.ts`).
    advanceCloudShadows(world.seed, frameDt, sky.dayFactor, origin.x, origin.z);
    sky.clouds.update(world.seed, renderer.camera);
    advanceDesertGlitter(frameDt, sky.dayFactor);
    // The ground under the camera, for the blown sand and the dust wall's footing.
    const groundUnderCam = terrain.heightAt(cam.x + origin.x, cam.z + origin.z, activeS);
    renderer.setEyeAboveGround(cam.y - groundUnderCam);
    const frameLines = renderer.frameHeight;
    weatherParticles.update(
      frameDt,
      renderer.camera,
      origin.x,
      origin.z,
      groundUnderCam,
      frameLines,
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
      hud.setDriving({
        fuelLitres: car?.fuelLitres ?? 0,
        tankCapacity: stats.tankCapacity,
        temperature: driving.engineTemperature,
        // No radiator fitted means no capacity, and the display treats that as dry —
        // which it is: there is nowhere for water to be.
        waterFraction: waterCap > 0 ? (car?.waterLitres ?? 0) / waterCap : 0,
        oilFraction: oilCap > 0 ? (car?.oilLitres ?? 0) / oilCap : 1,
        engineRunning: driving.engineRunning,
        engineDestroyed: driving.engineDestroyed,
        // How to start it, for the driver of a stopped engine (the starter not already turning).
        engineStartKey:
          s.player.seat === 'driver' && driving.engineStopped && !driving.engineCranking ? input.keyLabel('engine') : null,
        // Null while the player steers, which keeps the panel's frame plain: it reports
        // WHO is driving, not whether an autopilot exists.
        autopilotMode: autopilot.engaged ? autopilot.mode : null,
        pedals: {
          throttle: driving.throttleCommand,
          brake: driving.brakeCommand,
          knee: driving.thresholdBrakePedal,
          notch: autopilot.engaged ? null : input.pedalLever?.notch ?? null,
        },
        autoStopped: driving.engineAutoStopped,
        parked: driving.handbrakeOn,
      });
    } else {
      hud.setDriving(null);
    }
    // A shell for every whole kilometre ridden, then the jar as it stands.
    payDriving(world);
    hud.setShells(s.player.shells);
    // The G-force widget: the ride of the car he drives from the driver's seat (trip/ride.ts).
    hud.setRide(driving && s.player.seat === 'driver' ? ride : null);
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
      driving === null && inventory.held?.type === 'sticker_figurine' && stickerPreviewCarId === null;
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
    const cabinView = driving !== null && camera.mode === 'cabin';
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
    // The cabin round the listener and its openings, by ear. The car's right is its local
    // -X; the listener's right ear axis is the camera's +X.
    let cabinAudio: CabinOpenness | null = null;
    if (cabinView && driving?.kit) {
      const q = driving.root.quaternion;
      const c = renderer.camera.quaternion;
      const carRightX = -(1 - 2 * (q.y * q.y + q.z * q.z));
      const carRightY = -(2 * (q.x * q.y + q.w * q.z));
      const carRightZ = -(2 * (q.x * q.z - q.w * q.y));
      const earX = 1 - 2 * (c.y * c.y + c.z * c.z);
      const earY = 2 * (c.x * c.y + c.w * c.z);
      const earZ = 2 * (c.x * c.z - c.w * c.y);
      cabinOpenness(driving.kit, s.player.seat, carRightX * earX + carRightY * earY + carRightZ * earZ, cabinEars);
      cabinAudio = cabinEars;
    }
    audio.updateDriving(
      driving ? driving.audio : null,
      radioSpatial,
      driving ? drivingId! : null,
      driving ? carAudioPose : null,
      cabinAudio,
      frameDt,
    );
    ambienceFrame.windMps = weather.windMps;
    ambienceFrame.rain = weather.rain;
    ambienceFrame.drift = weather.drift;
    ambienceFrame.dust = weather.dust;
    ambienceFrame.heat = weather.heat;
    ambienceFrame.dayFactor = sky.dayFactor;
    ambienceFrame.cabinOpen = cabinView ? (cabinAudio ? (cabinAudio.left + cabinAudio.right) / 2 : 0) : null;
    ambienceFrame.boltSeed = weather.boltSeed;
    ambienceFrame.boltAge = weather.boltAge;
    ambienceFrame.boltDistance = weather.boltDistance;
    ambienceFrame.boltAzimuth = weather.boltAzimuth;
    ambienceFrame.roadS = activeS;
    audio.updateAmbience(ambienceFrame, frameDt);
    audio.beginTrafficFrame();
    traffic.forEachVehicle(hearCar);
    race.forEachDriven(hearCar);
    audio.endTrafficFrame(frameDt);
    hud.setRadio(audio.radioReadout);

    hud.setPrompt(prompt, actionable);
    hud.setRace(race.readout);
    trunkView.update(
      boot,
      boot ? (vehicles.get(boot.id) ?? null) : null,
      alpha,
      s.timeOfDay,
      sky.dayFactor,
      renderer.camera.position,
    );
    bayMark.update(haulBays.markedSlots(), origin.x, origin.z);
    machineGridView.updateFixed(
      interaction.engagedGrid(),
      origin.x,
      origin.z,
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
    // Both hands are on a machine worked up close: what they held is out of the frame.
    heldView.update(story !== null || machineFocus.active ? null : held, camera.mode, frameDt, {
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
    // the whole day-night transition, count towards the GPU average.
    renderer.setGpuTimingEligible(!gpuTimingFrozen && !sky.didBakeEnvironmentThisFrame);
    rebasedThisFrame = false;
    renderer.setItemViewEffects(
      s.player.wornSunShades?.tint ?? null,
      usingBinoculars,
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
    farRoad.update(activeS, origin.x, origin.z);
    carMirrors.update(driving?.kit ?? null, camera.mode === 'cabin');
    frameProfiler?.begin('draw');
    renderer.render();
    frameProfiler?.end('draw');
    lateLinks?.();
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
  // A lost WebGL context (a driver reset — Windows TDR, DXGI_ERROR_DEVICE_HUNG — or the
  // browser reclaiming the GPU) leaves the canvas white while the simulation, the
  // autopilot and the sound would carry on blind. Nothing GPU-side is rebuilt in place:
  // the drive is stopped, saved and marked for resume, and a reload brings the player
  // back to the car with a fresh context.
  canvas.addEventListener('webglcontextlost', () => {
    paused = true;
    loop.stop();
    audio.setPaused(true);
    pads.stopRumble();
    if (document.pointerLockElement !== null) document.exitPointerLock();
    const saved = dying || story !== null || endingStarted
      ? Promise.resolve()
      : (async () => {
          const state = stateForSave();
          const slot = `slot-${state.seed}`;
          await saves.save(slot, saveName(state), state);
          markResumeTarget(slot);
        })().catch((error: unknown) => console.error('save after the lost graphics context failed', error));
    const notice = document.createElement('div');
    notice.className = 'context-lost';
    notice.style.cssText =
      'position:fixed;inset:0;z-index:1000;display:flex;flex-direction:column;align-items:center;'
      + 'justify-content:center;gap:16px;background:#111;color:#eee;font:16px sans-serif;text-align:center';
    const text = document.createElement('div');
    text.textContent = 'The graphics driver was reset. The drive is saved.';
    const button = document.createElement('button');
    button.textContent = 'Reload';
    button.disabled = true;
    button.addEventListener('click', () => window.location.reload());
    notice.append(text, button);
    document.body.appendChild(notice);
    void saved.finally(() => { button.disabled = false; });
  });
  // Dev: `__bro.loop.stop()` freezes the simulation where it stands, so a bench can
  // draw the very same frame again and again (`renderer.render()`); `start()` resumes.
  // `mirageSchedule` and `postAt(index)` say where the mirages and the post stops stand,
  // for a bench that wants one in view (tools/look/gpucost.mjs).
  if (import.meta.env.DEV) {
    Object.assign((window as unknown as { __bro: Record<string, unknown> }).__bro, {
      loop,
      mirageSchedule,
      postAt: (index: number) => postStop(world.seed, index),
      // The lot signs in the physics band (world/market.ts), and the machine being
      // worked up close (player/machinefocus.ts).
      market,
      machineFocus,
      // `mirrors.stats.renders` counts mirror passes; `mirrors.enabled = false` is the A/B.
      mirrors: carMirrors,
      // `farCars.enabled = false` draws every traffic car in full, for the A/B; `stats`
      // counts this frame's far cars, the models they drew as, the batches they are in, and
      // the draws they save.
      farCars: {
        get enabled(): boolean {
          return farCars.enabled;
        },
        set enabled(on: boolean) {
          farCars.enabled = on;
        },
        get stats(): { cars: number; models: number; batches: number; drawsSaved: number } {
          let full = 0;
          traffic.forEachVehicle((_, vehicle) => {
            if (!vehicle.root.visible) full += nearDrawEstimate(vehicle.nearParts);
          });
          // Each batch is one draw in the scene pass and one in the sun's, shared with the
          // mid cars' parts.
          return { ...farCars.stats, drawsSaved: full - farCars.stats.batches * 2 };
        },
      },
      // `midCars.enabled = false` draws every traffic car inside the far line in full, for
      // the A/B. `stats`: this frame's mid cars, the far batches their shared parts are in
      // (one draw each and one in the sun's, shared with the far cars), every draw they
      // cost (their own paint too, also casting), and the draws they save.
      midCars: {
        get enabled(): boolean {
          return midCars.enabled;
        },
        set enabled(on: boolean) {
          midCars.enabled = on;
        },
        get stats(): { cars: number; batches: number; draws: number; drawsSaved: number } {
          let cars = 0;
          let own = 0;
          let full = 0;
          traffic.forEachVehicle((_, vehicle) => {
            if (!vehicle.root.visible || !vehicle.drawnMid) return;
            cars++;
            own += vehicle.midOwnDraws;
            full += nearDrawEstimate(vehicle.nearParts);
          });
          const draws = (own + midCars.stats.batches) * 2;
          return { cars, batches: midCars.stats.batches, draws, drawsSaved: full - draws };
        },
      },
    });
  }

  /**
   * The pause overlay's window on the game. Settings live in world state (so a save
   * carries them), which is why every mutation routes through `world.apply` here
   * rather than being held in the menu: the menu is a view, not an owner.
   */
  const pauseHooks: PauseHooks = {
    settings: () => world.state.settings,
    frameReport,
    perfOverlay: perfOverlay ?? undefined,
    traffic: import.meta.env.DEV
      ? {
          get cap() {
            return traffic.cap;
          },
          get target() {
            return traffic.status.target;
          },
          get count() {
            return traffic.status.count;
          },
          setCap: (value: number | null) => {
            traffic.cap = value;
          },
          get driverMix() {
            return traffic.driverMix;
          },
          get driverMixOverridden() {
            return traffic.driverMixOverridden;
          },
          get liveMix() {
            const status = traffic.status;
            return [status.sleeper, status.hurried, status.frantic] as const;
          },
          setDriverMix: (value: readonly [number, number, number] | null) => {
            traffic.driverMix = value;
          },
          get sameShare() {
            return traffic.sameShare;
          },
          setSameShare: (value: number | null) => {
            traffic.sameShare = value;
          },
          get oncomingPlatoons() {
            return traffic.oncomingPlatoons;
          },
          setOncomingPlatoons: (value: number | null) => {
            traffic.oncomingPlatoons = value;
          },
          get playerPace() {
            return traffic.playerPace;
          },
          setPlayerPace: (value: number | null) => {
            traffic.playerPace = value;
          },
        }
      : undefined,
    ink: import.meta.env.DEV
      ? {
          get enabled() {
            return renderer.ink;
          },
          setEnabled: (on: boolean) => {
            renderer.ink = on;
          },
        }
      : undefined,
    poiShadows: import.meta.env.DEV
      ? {
          get enabled() {
            return poiReceivesShadows();
          },
          setEnabled: (on: boolean) => setPoiReceiveShadows(renderer.scene, on),
        }
      : undefined,
    eagle: import.meta.env.DEV
      ? {
          get enabled() {
            return camera.eagleFlight;
          },
          setEnabled: (on: boolean) => camera.setEagle(on),
        }
      : undefined,
    devLook: import.meta.env.DEV
      ? {
          stand: devLook.stand,
          cycle: () => {
            cycleDevLook('stand');
            // Saved and marked for resume first, as a profile reload is: back where he stood.
            const state = stateForSave();
            const slot = `slot-${state.seed}`;
            void saves.save(slot, saveName(state), state)
              .then(() => markResumeTarget(slot))
              .catch((error: unknown) => console.error('save before the dev look reload failed', error))
              .finally(() => window.location.reload());
          },
        }
      : undefined,
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
      const settings = withRemeasure(world.state.settings, mobilePresentation);
      world.apply({ t: 'settings', settings });
      storeSettings(settings);
      window.location.reload();
    },
    applySettings: (next) => {
      world.apply({ t: 'settings', settings: next });
      // A rung or grass setting on another build profile is a reload: the profile is
      // built into the world's ground cover, plants and open desert, and on Very Low the
      // finishing pass (render/retro.ts). So Very Low <-> anything and grass on <-> off
      // reload; rungs that keep the profile apply in place. The drive is saved and marked
      // for resume first, so the player lands back in the car rather than on the title.
      if (
        buildProfileFor(world.state.settings.graphicsQuality, world.state.settings.groundCover)
          !== activeBuildProfile()
      ) {
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
      pads.setDeadzone(world.state.settings.controllerDeadzone);
      pads.setSteeringSensitivity(world.state.settings.controllerSteerSensitivity);
      audio.applySettings(world.state.settings);
      renderer.setFxaa(world.state.settings.fxaa);
      renderer.setMsaa(world.state.settings.msaa);
      renderer.setTaa(world.state.settings.taa);
      renderer.setShadowMode(world.state.settings.shadows);
      sky.setShadowMode(world.state.settings.shadows);
      renderer.setFrameScale(world.state.settings.frameScale);
      renderer.setRetroLines(world.state.settings.retroLines);
      renderer.setUpscaling(world.state.settings.upscaling, world.state.settings.sharpness);
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
      carMirrors.setQuality(tier);
      carMirrors.setRate(world.state.settings.mirrorFrameRate);
      carMirrors.setEnabled(world.state.settings.cabinMirrors);
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
    giveShells: devTools?.giveShells,
    jumpToKm: devTools?.jumpTo,
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
    setGpuTimingFrozen: (frozen) => {
      gpuTimingFrozen = frozen;
    },
    takeTierUndetected: () => {
      const undetected = tierUndetected;
      tierUndetected = false;
      return undetected;
    },
  });
  booted = true;
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
