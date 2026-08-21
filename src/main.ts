import * as THREE from 'three';
import { InputReader, emptyInput, type InputFrame } from './core/input';
import { GameLoop } from './core/loop';
import { PhysicsWorld } from './core/physics';
import { Renderer } from './core/renderer';
import { DAY_LENGTH, GameWorld, newWorldState, type CarState } from './game/state';
import { TIME_OF_DAY_PRESETS } from './game/settings';
import { spawnAssembledCar } from './game/spawn';
import { Inventory } from './items/items';
import { WeaponController } from './items/weapons';
import { LoosePartField } from './parts/loose';
import { body } from './parts/registry';
import { Interaction } from './player/interaction';
import { Player } from './player/player';
import { BirdFlock } from './agents/birds';
import { CameraRig, type CameraTarget } from './render/cameras';
import { HeldItemView } from './render/held';
import { LightBudget } from './render/lights';
import { Sky } from './render/sky';
import { SlotGhosts } from './render/slotghosts';
import { ChunkStreamer } from './world/chunks';
import {
  HomesteadProvider,
  createStartingCar,
  homesteadSpawn,
  scatterStartingParts,
} from './world/house';
import { PoiProvider } from './world/poi';
import { MonumentProvider, PoleProvider, ScatterProvider } from './world/props';
import { Road } from './world/road';
import { RoadMeshProvider } from './world/roadmesh';
import { Terrain } from './world/terrain';
import { TerrainMeshProvider } from './world/terrainmesh';
import { Hud } from './ui/hud';
import { MainMenu, type PauseHooks } from './ui/menu';
import { IndexedDbSaves } from './save/save';
import { Vehicle } from './vehicle/vehicle';

/**
 * Composition root. The only file allowed to know about every subsystem.
 *
 * Ordering here is load-bearing in three places, each marked below: physics before
 * anything that builds colliders, chunk 0 before the starting parts are scattered
 * (they need the garage floor to rest on), and `restoreFromState` only on a loaded
 * save (a new game materialises its loot as it generates it).
 */

/**
 * Lateral distance from the road beyond which a followed position is treated as
 * teleported and re-homed with a full unhinted projection. Comfortably outside the
 * drawn world (vista 1500 m), so ordinary off-road driving never pays for it.
 */
const ACTIVE_S_REHOME_LATERAL = 2000;
/** How far ahead of the view a spawned car is placed, metres. */
const SPAWN_AHEAD_DISTANCE = 6;
/** Height above the eye the spawn ground probe starts from. */
const SPAWN_PROBE_HEIGHT = 3;
/** Extra clearance under a spawned chassis so it settles onto its suspension. */
const SPAWN_WHEEL_CLEARANCE = 0.35;

/**
 * Off-road haze ramp, metres of lateral distance from the road centreline. Starts
 * where the coarse ground band begins and saturates where it ends, so the far
 * desert reads as haze closing in rather than as a terrain edge.
 */
const FOG_RAMP_START = 150;
const FOG_RAMP_END = 600;
/** Fog density multiplier at full ramp. */
const FOG_RAMP_MAX_SCALE = 3.2;
/**
 * How far below the terrain a body must be before it counts as fallen out of the
 * world. Deeper than any legitimate dip (the corridor sinks 0.16 m and a pothole
 * 0.07 m) and than a chassis half-height, so normal driving can never trigger it.
 */
const RESCUE_FALL_DEPTH = 6;
/**
 * Height above the road a rescued car is dropped from. Must clear the chassis
 * half-height plus its suspension travel: dropped flush, the chassis starts
 * intersecting the road's thin trimesh and the solver pushes it straight through.
 */
const RESCUE_LIFT = 1.6;
/** How often the record marker and player position are pushed into state. */
const RECORD_INTERVAL = 2;

async function boot(): Promise<void> {
  const canvas = document.getElementById('game');
  const uiRoot = document.getElementById('ui');
  if (!(canvas instanceof HTMLCanvasElement) || !(uiRoot instanceof HTMLElement)) {
    throw new Error('index.html is missing #game or #ui');
  }

  const saves = new IndexedDbSaves();
  const menu = new MainMenu(uiRoot);
  const chosen = await menu.show(saves);

  const loadedFromSave = chosen.state !== null;
  const world = new GameWorld(chosen.state ?? newWorldState(chosen.seed));

  const road = new Road(world.seed);
  const terrain = new Terrain(world.seed, road);
  // Physics must exist before any provider or field that creates a collider.
  const physics = await PhysicsWorld.create();
  const renderer = new Renderer(canvas);
  const input = new InputReader(canvas);
  const hud = new Hud(uiRoot);
  const sky = new Sky(renderer.scene, renderer.fog);
  const inventory = new Inventory();
  const loose = new LoosePartField(physics, world, renderer.scene);
  const birds = new BirdFlock(renderer.scene, road, terrain, world.seed);
  const weapons = new WeaponController();
  const heldView = new HeldItemView(renderer.camera, renderer.scene);
  const slotGhosts = new SlotGhosts(renderer.scene);

  const streamer = new ChunkStreamer(road, terrain, physics, world, renderer.scene);
  streamer.register(new RoadMeshProvider(world.seed));
  streamer.register(new TerrainMeshProvider());
  streamer.register(new HomesteadProvider());
  streamer.register(new ScatterProvider());
  streamer.register(new PoleProvider());
  streamer.register(new MonumentProvider());
  streamer.register(new PoiProvider(loose));

  // Point lights are budgeted per frame (see LightBudget); constructed before the
  // first chunk build so the budget's first scan sees chunk 0's lamps.
  const lightBudget = new LightBudget(renderer.scene);

  let initialYaw = 0;
  const player = new Player(physics, world);
  player.setRoad(road);

  const vehicles = new Map<string, Vehicle>();
  const spawnVehicle = (car: CarState): Vehicle => {
    const vehicle = new Vehicle(physics, world, car, renderer.scene);
    vehicle.rebuildFromSlots();
    vehicles.set(car.id, vehicle);
    return vehicle;
  };

  if (!loadedFromSave) {
    const car = createStartingCar(world);
    world.apply({ t: 'car_add', car });
    // The world does not exist behind s = 0, so a new game must start at the
    // homestead rather than at the default state position.
    const spawn = homesteadSpawn(road, terrain);
    player.teleport(spawn.x, spawn.y, spawn.z);
    initialYaw = spawn.yaw;
  }

  // Build chunk 0 before scattering: the parts need the garage floor beneath them.
  streamer.update(world.state.player.s);

  if (loadedFromSave) {
    loose.restoreFromState();
  } else {
    const car = Object.values(world.state.cars)[0];
    if (car) scatterStartingParts(world, loose, car.bodyId);
  }

  for (const car of Object.values(world.state.cars)) spawnVehicle(car);

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

  const activeVehicle = (): Vehicle | null => activeCar()?.vehicle ?? null;

  const interaction = new Interaction(physics, world, inventory, loose, activeVehicle);
  interaction.attachPlayer(player);

  const camera = new CameraRig(renderer.camera, physics);
  camera.setMode('foot');
  camera.setYaw(initialYaw);

  // Dev-only inspection hook. Lets a browser session read simulation state without
  // exporting it into the game's own API surface.
  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>)['__bro'] = {
      world,
      renderer,
      physics,
      interaction,
      loose,
      road,
      terrain,
      player,
      camera,
      inventory,
      vehicles,
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
  let lightsOn = false;
  let prompt: string | null = null;
  /** Arclength of whatever the camera is following; drives streaming and the sky. */
  let activeS = world.state.player.s;

  const fixedUpdate = (dt: number): void => {
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

    if (driving) {
      // setEnabled early-returns when unchanged, so calling it every tick is free.
      player.setEnabled(false);
      driving.fixedUpdate(dt, f);
      if (f.toggleLights) {
        lightsOn = !lightsOn;
        driving.setLights(lightsOn);
      }
      if (f.cycleCamera) camera.cycleDriving();
    } else {
      player.setEnabled(true);
      player.fixedUpdate(dt, f, camera.yaw);
      if (f.cycleCamera) camera.setMode('foot');
    }

    // Advance the simulation only after every controller has written its intent for
    // this tick (wheel forces, kinematic character motion). Interaction raycasts
    // below then query the post-step world, so prompts match what is on screen.
    physics.step();

    // Latch the post-step transforms so the renderer can interpolate between the
    // last two steps instead of snapping to the newest one.
    for (const vehicle of vehicles.values()) vehicle.postStep();
    player.postStep();

    // Item selection: the number row wins over the cycle keys when both arrive in
    // the same tick, since a direct pick is the more specific intent.
    if (f.selectSlot > 0) inventory.selectIndex(f.selectSlot - 1);
    else if (f.cycleItem !== 0) inventory.cycle(f.cycleItem);

    const eye = camera.eyePosition;
    const dir = camera.eyeDirection;
    prompt = interaction.fixedUpdate(dt, f, eye.x, eye.y, eye.z, dir.x, dir.y, dir.z).prompt;

    // Shooting: the held item decides. A kill only enters the inventory if it fits,
    // so a full pack means the bird is lost rather than silently teleported in.
    const held = inventory.held;
    if (held && held.type === 'weapon' && f.usePrimary) {
      const shot = weapons.tryFire(held, f.useSecondary, eye, dir, birds, inventory, dt);
      if (shot.result === 'fired' && shot.hit) {
        const added = inventory.add({
          type: 'quarry',
          id: world.runtimePartId(),
          species: shot.hit.species,
          mass: shot.hit.mass,
        });
        hud.setToast(added ? `bagged a ${shot.hit.species}` : 'too heavy to carry');
      } else if (shot.result === 'empty') {
        weapons.reload(held, inventory);
      }
    }

    // A hinted projection stays correct for as long as the car moves continuously,
    // and the hint is only ever stranded by a discontinuity: a restored save, a
    // debug reposition, a rescue. Judging that by raw distance from the last
    // centreline sample used to be safe when the world was 60 m wide, but the desert
    // is now driveable to 600 m either side, so a legitimate excursion looked like a
    // jump and bought an unhinted sweep — which, on a road that wanders back through
    // its own neighbourhood over 400 km, can latch onto a segment kilometres away and
    // stream the wrong chunks out from under the car. The hinted result's own lateral
    // distance is the honest test: no legal position is further out than the vista.
    if (driving) {
      const t = driving.chassis.translation();
      const p = road.project(t.x, t.z, activeS);
      activeS = Math.abs(p.lateral) > ACTIVE_S_REHOME_LATERAL ? road.project(t.x, t.z).s : p.s;
    } else {
      activeS = player.s;
    }
    streamer.update(activeS);
    birds.update(dt, activeS, eye.x, eye.y, eye.z);

    // Rescue. Ground only exists out to the coarse physics band, and a determined
    // player can still leave it (or clip through a seam) and fall forever. Rather
    // than an invisible wall, catch anything that has dropped well below the
    // terrain it should be standing on and put it back on the road: the desert
    // gets harder to cross the further out you go, and if you beat it anyway the
    // world hands you back instead of deleting you.
    if (driving) {
      const t = driving.chassis.translation();
      if (t.y < terrain.heightAt(t.x, t.z, activeS) - RESCUE_FALL_DEPTH) {
        const home = road.sampleAt(activeS);
        driving.rescueTo(home.x, home.y + RESCUE_LIFT, home.z, home.heading);
        hud.setToast('towed back to the road');
      }
    } else {
      const p = player.position;
      if (p.y < terrain.heightAt(p.x, p.z, activeS) - RESCUE_FALL_DEPTH) {
        const home = road.sampleAt(activeS);
        player.teleport(home.x, home.y, home.z);
        hud.setToast('walked back to the road');
      }
    }

    recordTimer += dt;
    if (recordTimer >= RECORD_INTERVAL) {
      recordTimer = 0;
      if (activeS > s.recordS) world.apply({ t: 'record', s: activeS });
    }
  };

  // Reused for the interpolated chassis pose handed to the camera each frame.
  const targetPos = new THREE.Vector3();
  const targetQuat = new THREE.Quaternion();

  const render = (alpha: number, frameDt: number): void => {
    const s = world.state;
    const drivingId = s.player.drivingCarId;
    const driving = drivingId ? (vehicles.get(drivingId) ?? null) : null;

    for (const vehicle of vehicles.values()) vehicle.syncVisuals(alpha);
    loose.syncVisuals();

    if (driving) {
      driving.interpolatedTransform(alpha, targetPos, targetQuat);
      const eyePoint = body(s.cars[drivingId!]!.bodyId).eyePoint;
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
    camera.update(frameDt, cameraInput, target, driving === null);

    const cam = renderer.camera.position;
    sky.update(s.timeOfDay, activeS, cam.x, cam.y, cam.z);

    // Off-road haze. `sky.update` sets the fog density for the time of day; this
    // multiplies it by how far the view has strayed from the road, so the desert
    // closes in as you leave and the far bands dissolve into haze instead of
    // ending at a visible edge. Ramp starts where the coarse ground begins and
    // saturates where it runs out, and it is a view effect only: nothing about
    // the simulation changes.
    const offRoad = Math.abs(road.project(cam.x, cam.z, activeS).lateral);
    const hazeT = Math.min(1, Math.max(0, (offRoad - FOG_RAMP_START) / (FOG_RAMP_END - FOG_RAMP_START)));
    renderer.fog.density *= 1 + hazeT * hazeT * (FOG_RAMP_MAX_SCALE - 1);

    // Night signal: reuse the sky's existing threshold (the same one the lamps
    // and headlights key off) rather than re-deriving dusk from timeOfDay. Lamps
    // follow the camera so the lit pools track what is on screen; the budget then
    // caps how many point lights actually render.
    const night = sky.isNight ? 1 : 0;
    streamer.setLamps(night, cam.x, cam.z);
    lightBudget.update(cam.x, cam.y, cam.z, night, frameDt);

    if (driving) {
      const stats = driving.stats;
      const warnings = stats.drivable ? [] : stats.missing.map((slot) => `missing ${slot}`);
      hud.setDriving({
        speedKmh: driving.speedKmh,
        rpm: driving.rpm,
        redlineRpm: stats.engine?.redlineRpm ?? 6000,
        gearLabel: driving.gearLabel,
        fuelLitres: s.cars[drivingId!]?.fuelLitres ?? 0,
        tankCapacity: stats.tankCapacity,
        engineRunning: driving.engineRunning,
        warnings,
      });
    } else {
      hud.setDriving(null);
    }

    hud.setPrompt(prompt);
    hud.setInventory(
      inventory.all,
      inventory.selectedIndex,
      inventory.carriedMass,
      inventory.massLimit,
    );
    hud.setTravel(activeS / 1000, s.recordS / 1000, s.timeOfDay);

    // Viewmodel and slot previews are pure views of existing state, so they update
    // here rather than in the fixed step: they should track the smoothed camera.
    const held = inventory.held;
    heldView.update(held, camera.mode, frameDt, {
      usePrimary: lastInput.usePrimary,
      moveMag: Math.min(1, Math.hypot(lastInput.moveX, lastInput.moveZ)),
      speedKmh: target.speedKmh,
    });

    // Ghosts are an on-foot assembly aid; while driving there is nothing to fit, and
    // `interaction.lastSlotTarget` is stale because slot resolution is skipped.
    const ghost = driving ? null : activeCar();
    const ghostCar = ghost ? s.cars[ghost.id] : undefined;
    slotGhosts.update(
      ghostCar && ghost ? ghost.vehicle : null,
      body(ghostCar ? ghostCar.bodyId : 'body_sedan'),
      ghostCar ? ghostCar.slots : {},
      held && held.type === 'part' ? held.part.variantId : null,
      interaction.lastSlotTarget,
      frameDt,
    );

    // Resolution is a render-time concern: measure the frame that just ended and
    // adjust the buffer before drawing so this frame pays the new cost.
    renderer.adaptResolution(frameDt);
    renderer.render();
  };

  const loop = new GameLoop({ fixedUpdate, render });
  loop.start();

  /**
   * The pause overlay's window on the game. Settings live in world state (so a save
   * carries them), which is why every mutation routes through `world.apply` here
   * rather than being held in the menu: the menu is a view, not an owner.
   */
  const pauseHooks: PauseHooks = {
    settings: () => world.state.settings,
    applySettings: (next) => {
      world.apply({ t: 'settings', settings: next });
      // The reader caches an effective key table, so a rebind must be pushed to it;
      // nothing else re-reads the bindings. The gearbox mode and day length are read
      // from state every tick and need no push.
      input.setKeyBindings(world.state.settings.keyBindings);
    },
    applyTimePreset: (preset) => {
      world.apply({ t: 'time_of_day', timeOfDay: TIME_OF_DAY_PRESETS[preset] * DAY_LENGTH });
    },
    spawnVehicle: (request) => {
      // Put the car on the ground ahead of the view, not at the player's feet: a
      // chassis spawned inside the player (or inside the car being driven) would be
      // resolved by the solver as an explosion.
      const eye = camera.eyePosition;
      const dir = camera.eyeDirection;
      const flat = Math.hypot(dir.x, dir.z) || 1;
      const dropX = eye.x + (dir.x / flat) * SPAWN_AHEAD_DISTANCE;
      const dropZ = eye.z + (dir.z / flat) * SPAWN_AHEAD_DISTANCE;
      const ground = physics.raycast(
        { x: dropX, y: eye.y + SPAWN_PROBE_HEIGHT, z: dropZ },
        { x: 0, y: -1, z: 0 },
        SPAWN_PROBE_HEIGHT + 12,
        player.rigidBody,
      );
      const groundY = ground ? ground.point.y : eye.y;
      const def = body(request.bodyId);
      // Half the chassis height plus the suspension's rest travel, so it settles
      // onto its wheels instead of dropping through them.
      const y = groundY + def.halfExtents[1] + SPAWN_WHEEL_CLEARANCE;
      const heading = Math.atan2(dir.x / flat, dir.z / flat);
      const car = spawnAssembledCar(world, request, dropX, y, dropZ, heading);
      spawnVehicle(car);
      hud.setToast(`spawned ${def.label}`);
    },
  };

  // Pause is deliberately outside InputReader: it must work without pointer lock.
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Escape' || paused) return;
    paused = true;
    loop.stop();
    void (async () => {
      const s = world.state;
      const action = await menu.showPause({ seed: s.seed, km: s.player.s / 1000 }, pauseHooks);
      if (action === 'save') {
        await saves.save(`slot-${s.seed}`, `${body(Object.values(s.cars)[0]?.bodyId ?? 'body_sedan').label} @ ${(s.player.s / 1000).toFixed(1)} km`, s);
        hud.setToast('saved');
      }
      menu.hidePause();
      paused = false;
      if (action !== 'quit') loop.start();
      else window.location.reload();
    })();
  });
}


void boot().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  document.body.innerHTML = `<pre style="color:#e8dcc4;background:#1a1712;padding:2rem;font:14px monospace">failed to start\n\n${message}</pre>`;
  throw error;
});

// A full reload is the only safe HMR story here: hot-swapping this module would
// leave an orphaned Rapier world and WebGL context behind every edit.
if (import.meta.hot) import.meta.hot.accept(() => window.location.reload());
