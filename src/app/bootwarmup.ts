/**
 * The launch phase between a built world and a playable one: finish the streamed world,
 * then measure the frame's GPU cost and settle the graphics rung against it, all under
 * the loading cover.
 *
 * Built by the composition root with an explicit context, so the module holds no
 * reference to the boot closure it was lifted out of: the two flags it moves
 * (`setGpuTimingFrozen`, `takeTierUndetected`) stay owned by the caller.
 */

import type { GameLoop } from '../core/loop';
import type { Renderer } from '../core/renderer';
import {
  GRAPHICS_TIERS,
  shadowModeDefault,
  presentationFpsFor,
  qualityPresetForDetail,
  qualityPresetOf,
  storeSettings,
  viewDistanceFor,
  withQualityPreset,
} from '../game/settings';
import type { GameWorld } from '../game/state';
import { compileCarProgramsWith, loadCarModel } from '../render/carmodel';
import { CAR_MODELS } from '../vehicle/carmodels';
import type { Sky } from '../render/sky';
import type { VistaMesh } from '../render/vista';
import type { ChunkStreamer } from '../world/chunks';
import type { DesertTileStreamer } from '../world/deserttiles';
import type { WorldWorkScheduler } from '../world/workqueue';

/**
 * Streaming budget while playing: one small job per rendered frame, which is what
 * keeps road and desert attachment out of the frame time.
 */
export const STREAM_FRAME_BUDGET_MS = 3;
export const STREAM_JOBS_PER_FRAME = 1;
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
/** Everything the launch phase touches; held, never captured. */
export interface BootWarmupContext {
  /** `#launch-loading`: the cover this whole phase runs underneath. */
  readonly loading: HTMLElement;
  readonly worldWork: WorldWorkScheduler;
  readonly streamer: ChunkStreamer;
  readonly desert: DesertTileStreamer;
  readonly renderer: Renderer;
  readonly sky: Sky;
  readonly vista: VistaMesh;
  readonly loop: GameLoop;
  readonly world: GameWorld;
  readonly mobilePresentation: boolean;
  /** The boot road projection the streamed window is built around. */
  readonly bootProjection: { readonly s: number; readonly lateral: number };
  /** The boot ground position the streamed window is built around. */
  readonly bootGround: { readonly x: number; readonly z: number };
  /** The live render pass, run here under the cover. */
  readonly render: (alpha: number, frameDt: number) => void;
  /** Advances the frame counter the render pass shares and returns the new value. */
  nextFrameId(): number;
  /**
   * Holds the renderer's GPU average off the frames that are not worth counting. This
   * phase owns the flag while it runs; the game reads it per frame.
   */
  setGpuTimingFrozen(frozen: boolean): void;
  /** Reads and clears the launch's pending question of what rung this machine is. */
  takeTierUndetected(): boolean;
}

export async function warmUpBoot(ctx: BootWarmupContext): Promise<void> {
  // The lifted block reads these by name: bindings of the context's own values, plus a
  // frame counter mirroring the one the render pass runs on.
  const render = ctx.render;
  const initialProjection = ctx.bootProjection;
  const initialGround = ctx.bootGround;
  let frameId = 0;

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
    const label = ctx.loading.querySelector<HTMLElement>('.launch-loading-text');
    ctx.worldWork.setFrameBudget(BOOT_STREAM_BUDGET_MS, BOOT_STREAM_JOBS_PER_FRAME);
    const deadline = performance.now() + BOOT_WARMUP_LIMIT_MS;
    try {
      for (;;) {
        frameId = ctx.nextFrameId();
        ctx.worldWork.beginFrame(frameId);
        for (let call = 0; call < BOOT_STREAM_CALLS_PER_PASS; call++) {
          ctx.streamer.update(initialProjection.s, frameId, initialProjection.lateral);
        }
        ctx.desert.update(
          initialGround.x,
          initialGround.z,
          initialProjection.lateral,
          frameId,
        );
        const roadWindow = ctx.streamer.readiness;
        const sandWindow = ctx.desert.readiness;
        const built = roadWindow.ready + sandWindow.ready;
        const total = Math.max(1, roadWindow.wanted + sandWindow.wanted);
        const complete =
          !ctx.worldWork.hasPending &&
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
      ctx.worldWork.setFrameBudget(STREAM_FRAME_BUDGET_MS, STREAM_JOBS_PER_FRAME);
    }
  };
  await warmStreamedWorld();

  /**
   * WHY THE LAUNCH MEASURES THE FRAME BEFORE THE COVER LIFTS.
   *
   * The barrier above guarantees that everything is BUILT: the world is streamed,
   * both live shader variants are linked, and a GPU fence has retired the first
   * real frame. It does not say what the frame COSTS, and the rung verdict below needs
   * exactly that: a GPU average taken on the real frame path at the resolution the
   * player will drive at. The frames straddling the reveal are the most expensive of
   * the session — the remaining shader variants, the first uploads, the boot GC — and
   * averaging them in would read a healthy machine as one that cannot cope.
   *
   * So the same real frame path runs here, under the cover, at display pace. The first
   * frames are rendered but not counted (`setGpuTimingFrozen`), which is what throws
   * the transient away and keeps it off the player's screen; the rest are counted
   * exactly as they will be in the drive. The cover leaves when the average has settled
   * (`Renderer.gpuTimeSettled`).
   */
  const SETTLE_DISCARD_FRAMES = 30;
  /**
   * Wall-clock ceiling, not a frame count: the frames being measured are the slowest of
   * the session, so counting them measures the machine rather than the wait. A machine
   * with headroom settles in about a second; twenty seconds is a machine drawing three
   * or four frames a second, which has nothing to gain from a longer cover.
   */
  const SETTLE_MAX_MS = 20_000;
  const measureLaunchFrame = async (): Promise<void> => {
    // Without GPU timing there is nothing to measure.
    if (!ctx.renderer.measuresGpuTime) {
      ctx.setGpuTimingFrozen(false);
      return;
    }
    const label = ctx.loading.querySelector<HTMLElement>('.launch-loading-text');
    if (label) label.textContent = 'settling the picture';
    const deadline = performance.now() + SETTLE_MAX_MS;
    for (let frame = 0; performance.now() < deadline; frame++) {
      const discard = frame < SETTLE_DISCARD_FRAMES;
      ctx.setGpuTimingFrozen(discard);
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          resolve();
        });
      });
      render(0, 0);
      if (discard) continue;
      if (ctx.renderer.gpuTimeSettled) break;
    }
    ctx.setGpuTimingFrozen(false);
  };

  /**
   * Measured GPU per frame each rung must hold, ms. `acceptable` deliberately targets a
   * stable 30 Hz presentation: its extra budget buys picture on small integrated GPUs,
   * while the simulation stays at its fixed rate.
   */
  const RUNG_GPU_BUDGET_MS = { acceptable: 26, standard: 11, blessing: 11 } as const;
  /**
   * How far past its budget a rung may run before the launch takes it away. The rescue
   * threshold the dynamic resolution used to give: a rung was judged wrong once it had to
   * give up two resolution steps of 0.88 (1 / 0.88² ≈ 1.29 of the budget, if all fill).
   */
  const RUNG_OVERRUN = 1.3;
  /**
   * WHAT RUNG IS THIS MACHINE, asked once, on the one launch where nobody has answered.
   *
   * Nothing auto-detected the GPU before this, and the comment defending that said
   * guessing wrong either robs a capable machine or leaves a weak one stuttering. That
   * is true of guessing. It is not true of MEASURING, and the measurement already
   * exists: the launch times the real frame under the loading cover with GPU timer
   * queries, so by the time the cover lifts it has said, in milliseconds, whether this
   * machine holds the rung it was given at that rung's resolution.
   *
   * So the rung is WALKED, in both directions, against its budget — and the two
   * directions are not symmetrical, because being wrong is not.
   *
   * Down is a rescue: a machine running well past the rung's budget is stuttering, and
   * nothing else will tell the player why.
   *
   * Up is a bonus that has to be paid for fairly. The default rung is deliberately
   * modest, so a fast machine left on it renders less than its display can show — but a
   * rung that does not fit must be PUT BACK, with its own measurement to prove it, or a
   * player who never opened the menu is pushed into stutter by the courtesy.
   */
  const detectGraphicsTier = async (): Promise<void> => {
    if (!ctx.renderer.measuresGpuTime) return;
    // The launch measurement has already run by the time this is called, so if it never
    // settled, this machine cannot measure itself and every rung this walked would burn
    // its own measurement DEADLINE — twenty extra seconds of loading screen to learn
    // nothing. Observed happening, which is why the guard exists.
    if (!ctx.renderer.gpuTimeSettled) return;
    const ladder = ['blessing', 'standard', 'acceptable'] as const;
    // Each step moves the whole QUALITY PRESET when the settings are on one (a first
    // launch is: the defaults are Medium), so the verdict lands on Low, Medium or High
    // with the frame height, view distance and traffic that go with the rung. Settings
    // already off a preset were set by hand, and only the rung moves under them.
    const adopt = async (index: number): Promise<void> => {
      const tier = ladder[index]!;
      const current = ctx.world.state.settings;
      const settings = qualityPresetOf(current, ctx.mobilePresentation) !== null
        ? withQualityPreset(
          current,
          qualityPresetForDetail(tier),
          current.graphicsQualitySource,
          ctx.mobilePresentation,
        )
        : {
          ...current,
          graphicsQuality: tier,
          fxaa: GRAPHICS_TIERS[tier].fxaa,
          shadows: shadowModeDefault(tier),
        };
      ctx.world.apply({ t: 'settings', settings });
      ctx.renderer.setFxaa(settings.fxaa);
      ctx.renderer.setShadowMode(settings.shadows);
      ctx.sky.setShadowMode(settings.shadows);
      ctx.renderer.setRenderHeight(settings.renderHeight);
      ctx.renderer.setQuality(tier);
      ctx.sky.setQuality(tier, ctx.mobilePresentation);
      const horizon = viewDistanceFor(settings.viewDistance, ctx.mobilePresentation);
      ctx.renderer.setViewDistance(horizon);
      ctx.vista.setViewDistance(horizon);
      ctx.loop.setRenderFps(presentationFpsFor(ctx.world.state.settings.frameRateLimit));
      await measureLaunchFrame();
    };

    let index = Math.max(0, ladder.findIndex((tier) => tier === ctx.world.state.settings.graphicsQuality));
    /** The rung's measured cost as a share of its budget, or null if it never settled. */
    const load = (): number | null => {
      const gpuMs = ctx.renderer.gpuFrameMs;
      return ctx.renderer.gpuTimeSettled && gpuMs !== null ? gpuMs / RUNG_GPU_BUDGET_MS[ladder[index]!] : null;
    };
    for (let cost = load(); cost !== null && cost > RUNG_OVERRUN && index < ladder.length - 1; cost = load()) {
      index += 1;
      await adopt(index);
    }
    for (let cost = load(); cost !== null && cost <= 1 && index > 0; cost = load()) {
      const previous = index;
      index -= 1;
      await adopt(index);
      const climbed = load();
      if (climbed === null || climbed > RUNG_OVERRUN) {
        index = previous;
        await adopt(index);
        break;
      }
    }
    // The verdict is the answer to the question this function asked, whether or not it
    // moved the rung: recording it is what stops the next launch from asking again, and
    // recording it as MEASURED is what lets the menu offer to ask once more.
    const settings = { ...ctx.world.state.settings, graphicsQualitySource: 'measured' as const };
    ctx.world.apply({ t: 'settings', settings });
    storeSettings(settings);
  };

  // Prime the exact live render path while the loading cover still owns the screen.
  // The first pass establishes sky/fog/post uniforms and bakes the environment.
  // compileAsync then waits for the exact offscreen scene and canvas post variants,
  // not a different direct-to-canvas scene variant — and, from here on, for every car
  // model as it loads (render/carmodel.ts, program anchors), the ones already loaded
  // first. The second draw uploads every remaining texture, shadow and PMREM result;
  // its GPU fence is the final barrier.
  render(0, 0);
  await Promise.all([
    ctx.renderer.waitForFrameShaders(),
    compileCarProgramsWith((object) => ctx.renderer.compileForScenePass(object)),
  ]);
  // Every car model the world can put on the road, built now with its programs linked
  // and its far mesh baked. Built on demand instead, each new traffic model was a 40-70
  // ms body build plus its template and anchor in the first minute of the drive: a
  // dozen hitches, and on ANGLE a program link each. The cover waits for them.
  await Promise.all(CAR_MODELS.map((def) => loadCarModel(def.id)));
  render(0, 0);
  await ctx.renderer.waitForSubmittedFrame();
  await measureLaunchFrame();
  if (ctx.takeTierUndetected()) await detectGraphicsTier();
  ctx.loading.classList.add('is-hidden');
}
