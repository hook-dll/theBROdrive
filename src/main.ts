import * as THREE from 'three';
import { InputReader, type InputFrame } from './core/input';
import { GameLoop } from './core/loop';
import { PhysicsWorld } from './core/physics';
import { Renderer } from './core/renderer';
import { DAY_LENGTH, GameWorld, newWorldState, type CarState } from './game/state';
import { Inventory } from './items/items';
import { WeaponController } from './items/weapons';
import { LoosePartField } from './parts/loose';
import { body } from './parts/registry';
import { Interaction } from './player/interaction';
import { Player } from './player/player';
import { BirdFlock } from './agents/birds';
import { CameraRig, type CameraTarget } from './render/cameras';
import { HeldItemView } from './render/held';
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
import { MainMenu } from './ui/menu';
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

/** In-game seconds per real second. 1 gives a full day every DAY_LENGTH seconds. */
const TIME_SCALE = 1;
/**
 * A followed position further than this from the current arclength forces a full
 * unhinted road projection. Wider than any per-tick movement, narrower than the
 * hinted search window's reach.
 */
const ACTIVE_S_REHOME_DISTANCE = 150;
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
  let recordTimer = 0;
  let paused = false;
  let lightsOn = false;
  let prompt: string | null = null;
  /** Arclength of whatever the camera is following; drives streaming and the sky. */
  let activeS = world.state.player.s;

  const fixedUpdate = (dt: number): void => {
    const f = input.sample(dt);
    lastInput = f;

    const s = world.state;
    world.apply({
      t: 'time',
      timeOfDay: s.timeOfDay + dt * TIME_SCALE,
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

    // Normally the car moves a few metres per tick, so the previous arclength is a
    // perfect hint and the projection is a couple of samples. But a hinted search is
    // local, so any discontinuity (a debug reposition, or a restored save placing the
    // car far from the last hint) would silently strand the streamer at the old
    // arclength and drop the car through unbuilt ground. Detect the jump and pay for
    // one full sweep.
    if (driving) {
      const t = driving.chassis.translation();
      const near = road.sampleAt(activeS);
      const jumped =
        (near.x - t.x) ** 2 + (near.z - t.z) ** 2 > ACTIVE_S_REHOME_DISTANCE ** 2;
      activeS = jumped ? road.project(t.x, t.z).s : road.project(t.x, t.z, activeS).s;
    } else {
      activeS = player.s;
    }
    streamer.update(activeS);
    birds.update(dt, activeS, eye.x, eye.y, eye.z);

    recordTimer += dt;
    if (recordTimer >= RECORD_INTERVAL) {
      recordTimer = 0;
      if (activeS > s.recordS) world.apply({ t: 'record', s: activeS });
    }
  };

  const render = (_alpha: number, frameDt: number): void => {
    const s = world.state;
    const drivingId = s.player.drivingCarId;
    const driving = drivingId ? (vehicles.get(drivingId) ?? null) : null;

    for (const vehicle of vehicles.values()) vehicle.syncVisuals();
    loose.syncVisuals();

    if (driving) {
      const t = driving.chassis.translation();
      const r = driving.chassis.rotation();
      const eyePoint = body(s.cars[drivingId!]!.bodyId).eyePoint;
      target.x = t.x;
      target.y = t.y;
      target.z = t.z;
      target.qx = r.x;
      target.qy = r.y;
      target.qz = r.z;
      target.qw = r.w;
      target.speedKmh = driving.speedKmh;
      target.eyeOffset = eyePoint;
    } else {
      const p = player.position;
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

    camera.update(frameDt, lastInput, target, driving === null);

    const cam = renderer.camera.position;
    sky.update(s.timeOfDay, activeS, cam.x, cam.y, cam.z);

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

    renderer.render();
  };

  const loop = new GameLoop({ fixedUpdate, render });
  loop.start();

  // Pause is deliberately outside InputReader: it must work without pointer lock.
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Escape' || paused) return;
    paused = true;
    loop.stop();
    void (async () => {
      const s = world.state;
      const action = await menu.showPause({ seed: s.seed, km: s.player.s / 1000 });
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
