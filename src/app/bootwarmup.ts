/**
 * The launch phase between a built world and a playable one: finish the streamed world,
 * then settle the drawing-buffer scale and the graphics rung against real GPU timings,
 * all under the loading cover.
 *
 * Built by the composition root with an explicit context, so the module holds no
 * reference to the boot closure it was lifted out of: the two flags it moves
 * (`setAdaptationFrozen`, `takeTierUndetected`) stay owned by the caller.
 */

import type { GameLoop } from '../core/loop';
import type { Renderer } from '../core/renderer';
import {
  GRAPHICS_TIERS,
  presentationFpsFor,
  storeSettings,
  viewDistanceFor,
  type GraphicsQuality,
} from '../game/settings';
import type { GameWorld } from '../game/state';
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
   * Holds the adaptive-resolution controller off the frames that are not worth
   * judging. This phase owns the flag while it runs; the game reads it per frame.
   */
  setAdaptationFrozen(frozen: boolean): void;
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
   * first frames are rendered but not judged (`setAdaptationFrozen`), which is what
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
    if (!ctx.renderer.measuresGpuTime) {
      ctx.setAdaptationFrozen(false);
      return;
    }
    const label = ctx.loading.querySelector<HTMLElement>('.launch-loading-text');
    if (label) label.textContent = 'settling the picture';
    const deadline = performance.now() + SETTLE_MAX_MS;
    for (let frame = 0; performance.now() < deadline; frame++) {
      const discard = frame < SETTLE_DISCARD_FRAMES;
      ctx.setAdaptationFrozen(discard);
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          resolve();
        });
      });
      render(0, 0);
      if (discard) continue;
      if (ctx.renderer.resolutionSettled) break;
    }
    ctx.setAdaptationFrozen(false);
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
    if (!ctx.renderer.measuresGpuTime) return;
    // The launch settle has already run by the time this is called, so if the controller
    // never reached a verdict, this machine cannot measure itself and the scale it is
    // sitting on says nothing about it. Bailing here is not a nicety: without a verdict
    // the controller can never move, so every rung this walked would burn its own settle
    // DEADLINE — a machine that cannot measure would pay twenty extra seconds of loading
    // screen to learn nothing. Observed happening, which is why the guard exists.
    if (!ctx.renderer.resolutionSettled) return;
    const ladder: GraphicsQuality[] = ['blessing', 'standard', 'acceptable'];
    const adopt = async (index: number): Promise<void> => {
      const tier = ladder[index]!;
      const settings = {
        ...ctx.world.state.settings,
        graphicsQuality: tier,
        msaa: GRAPHICS_TIERS[tier].msaa,
      };
      ctx.world.apply({ t: 'settings', settings });
      ctx.renderer.setMsaa(settings.msaa);
      ctx.renderer.setQuality(tier);
      ctx.sky.setQuality(tier, ctx.mobilePresentation);
      const horizon = viewDistanceFor(tier, ctx.mobilePresentation);
      ctx.renderer.setViewDistance(horizon);
      ctx.vista.setViewDistance(horizon);
      ctx.loop.setRenderFps(presentationFpsFor(ctx.world.state.settings.frameRateLimit));
      await settleLaunchResolution();
    };

    let index = Math.max(0, ladder.indexOf(ctx.world.state.settings.graphicsQuality));
    while (index < ladder.length - 1 && ctx.renderer.resolutionScale < AUTO_TIER_BACKOFF) {
      index += 1;
      await adopt(index);
    }
    while (index > 0 && ctx.renderer.resolutionScale > AUTO_TIER_COMFORT) {
      const previous = index;
      index -= 1;
      await adopt(index);
      if (ctx.renderer.resolutionScale < AUTO_TIER_BACKOFF) {
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
  // not a different direct-to-canvas scene variant. The second draw uploads every
  // remaining texture, shadow and PMREM result; its GPU fence is the final barrier.
  render(0, 0);
  await ctx.renderer.waitForFrameShaders();
  render(0, 0);
  await ctx.renderer.waitForSubmittedFrame();
  await settleLaunchResolution();
  if (ctx.takeTierUndetected()) await detectGraphicsTier();
  ctx.loading.classList.add('is-hidden');
}
