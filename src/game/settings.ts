/**
 * Player preferences, carried in the authoritative state so they survive saves
 * and can be changed from the pause menu without touching device code.
 *
 * Settings are preferences, not simulation: nothing here may reference
 * Three.js, Rapier or the input devices. The wiring that turns them into
 * behaviour lives at the edges — InputReader.setKeyBindings() for keys,
 * Vehicle/Drivetrain for the gearbox mode, the loop's TIME_SCALE for the day
 * length.
 */

import { GAMEPLAY_CONFIG } from '../config';
import { BINDABLE_ACTIONS } from '../core/input';
import { DEFAULT_DEADZONE } from '../core/gamepad';
export type GearboxMode = 'manual' | 'automatic';
/**
 * How the driving camera behaves.
 *
 * `steady` is the camera this game has always had: a world-space heading the player
 * aims, an arm that lags the car by a speed term, and a level horizon. `dynamic`
 * reads the car's own motion — its slip angle, its measured lateral acceleration and
 * its body roll — and lets the view show them, so a slide is visible in the framing
 * rather than only in the wheel. Steady is the default because it is the authored
 * composition; see `CameraRig`.
 */
export type CameraStyle = 'steady' | 'dynamic';
export type TimeOfDayPreset = 'morning' | 'noon' | 'evening' | 'midnight';
/**
 * Rendering tier: the ONE ladder, and everything it owns.
 *
 * There used to be two controls — quality and view distance — and they were not two
 * axes at all. The horizon setting never changed what the world STREAMS: the desert
 * tiles (±2 of 240 m) and road chunks (±6 of 200 m) are the same at every tier. What it
 * changed was the far plane, the vista's ring tessellation, how many mesas are built,
 * and the fog. Measured on the vista, a cell load costs 13.0 ms at 1.5 km and 32.8 ms
 * at 25 km, and the mesa vertex count goes from 897 to 16 419. That is a "how much can
 * this machine afford" decision, which is exactly what the quality tier already is —
 * so as a free control it only offered a player the chance to pick 25 km on a machine
 * that cannot rebuild a cell inside a frame and hitch on every cell crossing.
 *
 * It is still not a free control, but it is not the GRAPHICS card's either: the cost is
 * processor time, so it moved to the CPU level (`viewDistanceFor`), next to the traffic.
 * Everything left here is what the graphics card pays for.
 *
 * THE RESOLUTION IS A NUMBER OF LINES, and that is the second half of the fix. The
 * tiers used to resolve their resolution as `min(DPR x multiplier, DPR cap)` — a display
 * PERCENTAGE — for everything except `acceptable`, which was the only tier with an
 * absolute budget. On a display whose device-pixel-ratio is 1, which is every 4K
 * television and every monitor at 100% scaling, the percentage resolves to exactly 1.0
 * at every tier: a mini-PC on a 4K TV and a 4090 on a 4K TV were both asked for
 * 8.29 megapixels. Measured across the four devices this game is played on, `standard`
 * on an Intel N100 at 4K and `standard` on a 4090 at 4K were the same load, and the
 * only way down was `acceptable` at 1.44 Mpx — a 5.8x cliff, with no rung in between.
 *
 * A ceiling in lines makes a rung mean the same thing on a phone, a mini-PC and a
 * workstation: the frame's base is the screen's own pixels up to the rung's
 * `screenLines`, so Low on a 4K television is 720 lines however big the panel is, and on
 * a 1080-line monitor every rung but Low draws the screen's own pixels.
 */
export type GraphicsQuality = 'retro' | 'acceptable' | 'standard' | 'blessing';

/**
 * One rung. Every number here is a consequence of the same question — what can this
 * machine afford — which is what makes it a tier rather than a collection of switches.
 */
export interface GraphicsTier {
  /**
   * The most lines the frame's BASE is drawn at on a desktop presentation: the base is
   * the screen's own device pixels (`Settings.frameScale` multiplies it), held to this
   * height on a screen taller than it. On a 1080-line monitor it never bites below
   * High's 1440; on a 4K television it is what keeps a mini-PC's Low at a ninth of the
   * panel instead of all of it (see "THE RESOLUTION IS A NUMBER OF LINES" above).
   */
  readonly screenLines: ScreenLines;
  /** The same under phone presentation, where a DPR of 3 invites millions. */
  readonly mobileScreenLines: ScreenLines;
  /** Sun shadow map. The one per-frame pass a weak machine cannot afford at any size. */
  readonly shadows: boolean;
  /**
   * Side of the sun's shadow map, texels. The box grows with it at a fixed 7 cm texel
   * (`GRAPHICS_CONFIG`, render/sky.ts `applyShadowBox`), so a bigger map is REACH, not
   * sharpness: 2048 throws shadows at least 128 m ahead of the camera, 4096 at least
   * 272 m, and further when the sun stands ahead or behind (the box's ground print
   * stretches along the sun).
   * The extra cost is the casters inside the larger box, drawn once more each frame,
   * and 64 MB of depth instead of 16. Ignored where `shadows` is off.
   */
  readonly sunShadowMapSize: number;
  /** Default for `Settings.fxaa`; a player may still choose otherwise. */
  readonly fxaa: boolean;
  /**
   * Whether a phone presentation gets the sun shadow pass at this rung.
   *
   * Not a taste a rung may offer a phone. The shadow pass renders the world a SECOND
   * time from the light, and on a phone that is the largest single GPU cost in a frame
   * and a sustained one — the whole reason a phone gets warm rather than slow. A phone's
   * rung buys sharpness, so this is off on every rung and only the desktop column keeps
   * the choice.
   */
  readonly mobileShadows: boolean;
  /** Catalogue star depth, as a limiting visual magnitude. */
  readonly starMagnitude: number;
  /**
   * The same under phone presentation.
   *
   * Stars are additive points, so this is a blend-rate cost, not a vertex cost, and on a
   * phone it is one of the few places where the top rung asks for more than the screen can
   * show. 8.5 is the whole catalogue — 77,667 points — against 45,617 at 8 and 15,447 at
   * 7, and past roughly 8 a phone screen cannot resolve the extra ones anyway.
   */
  readonly mobileStarMagnitude: number;
  /**
   * Permanent spotlights compiled into every lit material, for car headlamps.
   *
   * A rung rather than a taste: the count is an ARRAY SIZE in the shader, so every lit
   * fragment pays for it whether or not a lamp is claiming the slot, and it can only
   * change by recompiling the world's materials. That is why the menu says so.
   */
  readonly vehicleLightSlots: number;
  /**
   * The same under phone presentation, and the single largest per-PIXEL cost in the game.
   *
   * A slot is not a cheap thing. Three compiles the count into every lit material as a
   * loop bound and UNROLLS it, so a fragment evaluates every slot whether or not a lamp
   * claims it — which is why the rig keeps its unused lamps at an intensity of 1e-8
   * instead of switching them off: toggling one would recompile the world. The bill is
   * therefore pixels x slots, every frame, and it does not care that most of them are
   * dark. Measured: the top rung's desktop budget was 26 lights, and a phone presenting
   * 1.44 megapixels at 50 FPS was evaluating all 26 on every lit fragment — 37 million
   * light evaluations per frame, 1.9 billion per second. That is the heat.
   */
  readonly mobileVehicleLightSlots: number;
  /** Reach multiplier for a projected headlamp beam; the top rung throws light further. */
  readonly headlightDistanceScale: number;
  /**
   * Live mirrors in the kit car the player sits in, cabin view only (render/carmirrors.ts):
   * their render targets' size as a share of full, 0 for the static glass. A mirror is a
   * small extra scene pass every frame, which the weakest rung leaves out.
   */
  readonly mirrorScale: number;
}

/**
 * The rungs, weakest first. Read them as machines, not presets:
 *
 *  - `retro` — a mini-PC or an old laptop that cannot hold `acceptable`. A fixed
 *    low-resolution frame in whole pixels (360 or 540 lines, `retroLines`) and the light
 *    geometry; switching to or from it reloads the drive, because it changes what the
 *    world is built from (render/retro.ts).
 *  - `acceptable` — a phone, or a mini-PC on a television. No shadow pass, because it is
 *    the one cost that cannot be paid in pixels, and the light geometry — the ground
 *    cover, plants and open desert of `retro` — because the cover alone was most of the
 *    frame's triangles. Switching to or from it reloads the drive too.
 *  - `standard` — an ordinary desktop with a discrete GPU or a good integrated one.
 *    1080 lines, shadows on.
 *  - `blessing` — a machine with headroom to spare. 1440 lines, which a 1080p display
 *    shows supersampled, and a sky deep enough to be crowded rather than plotted.
 *
 * A rung is a statement about the MACHINE, and a phone is two machines at once: the one
 * that draws the picture and the one that gets hot. Its frame height is
 * the first; its shadow pass and its frame rate are the second — and the second is the
 * player's, because no browser will tell the game how warm the phone is.
 */
export const GRAPHICS_TIERS: Record<GraphicsQuality, GraphicsTier> = {
  // A DIFFERENT PICTURE, NOT A SMALLER ONE. `acceptable` on an Intel N100 measured
  // 36.5 ms of GPU at 0.92 Mpx — 20 FPS — and the only way further down that ladder
  // was a bilinear stretch of fewer pixels, which reads as a broken image. This rung
  // draws a fixed low-resolution frame upscaled by whole pixels (render/retro.ts), so
  // the pixels are a style rather than a blur. Its frame height is `retroLines`, never
  // the screen's: the line count IS the look.
  retro: {
    // Not drawn on this rung. What a Very Low preset leaves behind for a player who
    // leaves the rung by the Detail row alone: the lightest base the other rungs have.
    screenLines: 540,
    mobileScreenLines: 540,
    shadows: false,
    sunShadowMapSize: 2048,
    fxaa: false,
    mobileShadows: false,
    starMagnitude: 6,
    mobileStarMagnitude: 6,
    // Four: the driven car's own two headlamps and two tail lamps, which are never
    // merged. Fewer, and lit headlamps leave its brake lights dark.
    vehicleLightSlots: 4,
    mobileVehicleLightSlots: 4,
    headlightDistanceScale: 1,
    mirrorScale: 0,
  },
  acceptable: {
    // 720 lines on a desktop: the old 1280x720 floor of this rung, a mini-PC on a 4K
    // television shading a ninth of the panel. A phone gets 540.
    screenLines: 720,
    mobileScreenLines: 540,
    shadows: false,
    sunShadowMapSize: 2048,
    fxaa: false,
    mobileShadows: false,
    starMagnitude: 7,
    mobileStarMagnitude: 7,
    // Four, as on retro: the driven car's own lamps, all of them.
    vehicleLightSlots: 4,
    mobileVehicleLightSlots: 4,
    headlightDistanceScale: 1,
    // Half-size targets: on a phone or a mini-PC the passes cost a quarter of the pixels.
    mirrorScale: 0.5,
  },
  standard: {
    screenLines: 1080,
    mobileScreenLines: 720,
    shadows: true,
    sunShadowMapSize: 2048,
    fxaa: true,
    mobileShadows: false,
    starMagnitude: 8,
    mobileStarMagnitude: 7.5,
    // The six freed point slots (four on a phone), at about half a spot's cost each,
    // became three more spots (two on a phone). The driven car holds four — two
    // headlamps, two tail lamps, which are never merged — and every other car's
    // headlamp pair is one merged beam, so the desktop nine keeps five more cars'
    // headlamps projected and the phone's six two more.
    vehicleLightSlots: 9,
    mobileVehicleLightSlots: 6,
    headlightDistanceScale: 1,
    mirrorScale: 1,
  },
  blessing: {
    // 1440 on a desktop: native on a 1440p panel, supersampled on 1080p, 1.5x upscaled
    // on 4K. A phone's screen cannot resolve more than 720 lines at arm's length, and
    // the heat a phone pays for pixels is the player's to buy, not the preset's.
    screenLines: 1440,
    mobileScreenLines: 720,
    shadows: true,
    sunShadowMapSize: 4096,
    fxaa: true,
    mobileShadows: false,
    starMagnitude: 8.5,
    mobileStarMagnitude: 8,
    // EIGHTEEN WAS A CLIFF, MEASURED. The lit-fragment shader costs almost nothing per
    // light up to about thirteen slots and then a great deal per light after them — same
    // scene, same pixels, on an M2 Pro at 2 Mpx: 11 slots 6.5 ms, 13 slots 7.5, 15 slots
    // 10.0, 19 slots 17.9, and 25-26 slots 53-78. This rung once asked for 18 spots + 8
    // points and so sat on the wrong side of that edge, which is why a machine that ran
    // the standard rung at 120 frames a second ran this one at 22-26. Spots are also the
    // dearer half — twelve spots alone cost 13.2 ms where twelve points cost 6.0 — so the
    // cut was taken out of the spots. The tier keeps everything else it was chosen for:
    // the resolution, the sky.
    //
    // THE POINT SLOTS ARE GONE. Their only sources were the switchable room lights in
    // the mast huts, and the whole point-light path went with them. What is left is 11
    // spots — still on the cheap side of the cliff — so traffic beams and unmerged tail
    // lamps both fit.
    vehicleLightSlots: 11,
    // Two thirds of a desktop again; the phone's spots are cut the same way, 8 where the
    // desktop spends 11.
    mobileVehicleLightSlots: 8,
    headlightDistanceScale: 3,
    mirrorScale: 1,
  },
};

/**
 * How far the desert is drawn before the fog dissolves it, metres: the far plane, the
 * fog and the vista disc together, which must agree or the edge of the world shows.
 *
 * A CPU figure, not a graphics one. The vista costs terrain sampling, set by RADIUS
 * rather than by pixels: measured on a 5950X, a cell rebuild costs 13.0 ms at 1.5 km,
 * 17.3 ms at 8 km and 31.9 ms at 25 km, and the mesa vertex count goes from 897 to
 * 16 419 — a hitch on every cell crossing for a processor that cannot keep up. 32 km
 * is past the last measured point: for a processor with room to spare.
 */
const HORIZON_M: Record<ComputeLevel, number> = { very_low: 2000, low: 8000, medium: 16000, high: 32000 };

/**
 * The horizon this presentation draws. A phone never gets past 8 km: a phone core is
 * slower than the 5950X above, so a wider radius is a multi-frame hitch per cell.
 */
export function viewDistanceFor(level: ComputeLevel, mobilePresentation: boolean): number {
  return mobilePresentation ? Math.min(HORIZON_M[level], HORIZON_M.low) : HORIZON_M[level];
}

/** Spotlight budget for vehicle lamps, as this presentation will compile it. */
export function vehicleLightSlotsFor(
  quality: GraphicsQuality,
  mobilePresentation: boolean,
): number {
  const tier = GRAPHICS_TIERS[quality];
  return mobilePresentation ? tier.mobileVehicleLightSlots : tier.vehicleLightSlots;
}

/** Catalogue star depth, as this presentation will draw it. */
export function starMagnitudeFor(
  quality: GraphicsQuality,
  mobilePresentation: boolean,
): number {
  const tier = GRAPHICS_TIERS[quality];
  return mobilePresentation ? tier.mobileStarMagnitude : tier.starMagnitude;
}

/**
 * Sun shadows as the player chose them: none, only the near cascade around the camera
 * (about 30 m, so the car and its neighbours stand on the ground), or near plus the
 * wide map out to the horizon.
 */
export type ShadowMode = 'off' | 'near' | 'full';

/** Default for `Settings.shadows` at a rung. */
export function shadowModeDefault(quality: GraphicsQuality): ShadowMode {
  return GRAPHICS_TIERS[quality].shadows ? 'full' : 'off';
}

/**
 * How much ground cover a load is built with (render/retro.ts build profile): Full (the
 * full cover, plants and fine open desert), Light (the light cover, plants and coarse
 * open desert Low always had), Off (Light without any ground cover).
 */
export type GrassMode = 'full' | 'light' | 'off';

export const GRASS_MODES: readonly GrassMode[] = ['full', 'light', 'off'];

/**
 * The picture's art direction (render/cleanstyle.ts). Standard is the game as tuned;
 * Clean is calm and temporally stable: a flat road, no specks of
 * scatter, faceted surfaces in a few steps of light and crisp near shadows. A taste,
 * not a cost, so every rung defaults to Standard and a preset puts it back there.
 */
export type VisualStyle = 'standard' | 'clean';

/**
 * The shadow mode this presentation pays for. A phone stays without the pass on a rung
 * whose tier says so, whatever the setting: that rule is about the device, not taste.
 */
export function shadowModeFor(
  mode: ShadowMode,
  quality: GraphicsQuality,
  mobilePresentation: boolean,
): ShadowMode {
  return mobilePresentation && !GRAPHICS_TIERS[quality].mobileShadows ? 'off' : mode;
}

/**
 * Presentation cap in FPS.
 *
 * The player's own setting on every device, because it is the one lever that works
 * everywhere for opposite reasons. On a phone it is a THERMAL control, and it has to be
 * the player's: a browser exposes no thermal state, no battery temperature and no clock
 * speed, so the machine cannot say whether it is hot, only the person holding it can. On a
 * desktop it is a NOISE and POWER control, and a frame rate below the panel's own is a
 * thing people want for reasons the game cannot see either.
 *
 * It is the largest lever there is: half the frames is half the render work and half the
 * presenting, while the simulation keeps its fixed rate so the car handles identically.
 * The floor is that simulation — no cap can go below it.
 */
export function presentationFpsFor(frameRateLimit: number | null): number | null {
  return frameRateLimit;
}

/**
 * The Compute settings: two processor budgets, separate from the graphics rung because
 * they are a different chip, and separate from each other because they cost different
 * things. The view distance is terrain sampling for the far desert (`viewDistanceFor`);
 * the traffic is how many ambient cars are live, each a full physical vehicle with its
 * own autopilot and pairwise coordination that grows with the square of the count
 * (`TRAFFIC_CAPS`). Both apply live: surplus cars drain behind the player, the horizon
 * moves in place.
 */
export type ComputeLevel = 'very_low' | 'low' | 'medium' | 'high';

/**
 * Traffic replenishment ceiling per level: the same on a two-lane road as on a four-lane
 * one (owner, 2026-10-15).
 *
 * The ceiling counts every car alive along the 800 m of solid road either side of the
 * player (world/ranges.ts `TRAFFIC_REACH_M`). With the kit cars down to a few draws each
 * (render/kitdraw.ts) and the drivers deciding 12 times a second (world/traffic.ts
 * `TRAFFIC_CONTROL_HZ`), a stream can be big: 40 on High, 20 on Medium (owner, 2026-10-18).
 */
export const TRAFFIC_CAPS: Record<ComputeLevel, number> = {
  very_low: 6,
  low: 12,
  medium: 20,
  high: 40,
};

function computeLevel(value: unknown): ComputeLevel | null {
  return value === 'very_low' || value === 'low' || value === 'medium' || value === 'high' ? value : null;
}

/**
 * The frame rates the player may choose, and `null` for no cap.
 *
 * 30 and 60 are the useful thermal steps. 75, 120 and 144 exist because panels have them
 * and a cap that does not match the panel wastes the thing being paid for. `null` is
 * offered because a desktop whose GPU is already the constraint gains nothing from a cap —
 * measured on a 4090 at 144 Hz, the GPU set the frame time at 6.94 ms against a 6.81 ms
 * interval, so a cap there would only add stutter.
 */
export const FRAME_RATE_LIMITS = [30, 60, 75, 120, 144] as const;
export type FrameRateLimit = (typeof FRAME_RATE_LIMITS)[number] | null;

/**
 * How many times a second each live mirror is redrawn, or `null` for every frame. Set
 * apart from the frame rate: each mirror is a second render of the scene, so its cost
 * is chosen on its own. Default every frame (owner, 2026-10-15): with every other car
 * drawn in a mirror as its far mesh and the kit cars a few draws each, a mirror render
 * is cheap. It shipped at 20, one mirror a frame at 60 FPS.
 */
export const MIRROR_FRAME_RATES = [10, 15, 20, 30, 60] as const;
export type MirrorFrameRate = (typeof MIRROR_FRAME_RATES)[number] | null;
const DEFAULT_MIRROR_FRAME_RATE: MirrorFrameRate = null;

/** An offered mirror rate, null (every frame) as stored, else the default. */
export function mirrorFrameRateFrom(raw: unknown): MirrorFrameRate {
  if (raw === null) return null;
  return typeof raw === 'number' && MIRROR_FRAME_RATES.some((rate) => rate === raw)
    ? (raw as MirrorFrameRate)
    : DEFAULT_MIRROR_FRAME_RATE;
}

/** Most lines a rung's frame base is ever held to; see `GraphicsTier.screenLines`. */
export type ScreenLines = 540 | 720 | 1080 | 1440;

/**
 * The Resolution row: the frame as a multiple of its BASE, which is the canvas's own
 * device pixels held to the rung's `screenLines`. 1 is the screen one for one (where the
 * rung's ceiling does not bite), below it the frame is drawn smaller and stretched by
 * the compositor, above it the frame is drawn bigger and averaged down to the screen by
 * the game (render/presentshader.ts): supersampling, which is the only antialiasing
 * here that smooths what is thinner than a pixel. Bounded at 2x the canvas's CSS size.
 *
 * WHY A MULTIPLE AND NOT LINES ANY MORE. The row used to be 540/720/1080/1440 lines, and
 * a browser window is almost never one of those: a maximised window on a 1080-line
 * monitor has about 990 lines under its tabs, so every choice was resampled, 1440p by
 * 1.45x. A base the player can see (the row quotes its pixels) answers the objection a
 * bare percentage met — "150%" of a 4K display was 4953x2616 — and the rung's ceiling
 * keeps what the lines were for: a weak machine's cost does not grow with the panel.
 *
 * Not `renderScale`: that key once held a DPR multiplier, and a save that still carries
 * it must not come back as a supersample.
 */
export const FRAME_SCALES = [0.5, 0.75, 1, 1.5, 2] as const;
export type FrameScale = (typeof FRAME_SCALES)[number];

/** The ceiling on a rung's frame base, for this presentation. */
export function screenLinesFor(quality: GraphicsQuality, mobilePresentation: boolean): ScreenLines {
  const tier = GRAPHICS_TIERS[quality];
  return mobilePresentation ? tier.mobileScreenLines : tier.screenLines;
}

/**
 * Lines the Very Low rung's frame is drawn at, before it is blown up by a whole factor
 * (render/retro.ts). 360 is the rung's own look and its budget; 540 is two display
 * pixels per frame pixel on a 1080-line screen instead of three — visibly finer, and
 * measured on an M2 Pro at the heaviest scenes as +0.7-0.9 ms of GPU on 2.4-3.6 (the
 * rung's frame is mostly geometry, not fill). Offered in the Resolution row; never moved
 * by the game, because the pixels are the look.
 */
export const RETRO_LINE_CHOICES = [360, 540] as const;
export type RetroLines = (typeof RETRO_LINE_CHOICES)[number];

/** An offered line count; anything else is the rung's own 360. */
export function retroLinesFrom(raw: unknown): RetroLines {
  return RETRO_LINE_CHOICES.find((lines) => lines === raw) ?? 360;
}

/**
 * WHO chose the graphics rung, which is the difference between a verdict and a taste.
 *
 *  - `default`  — nobody has answered. The one state that lets a launch measure.
 *  - `device`   — the authored default for this presentation; a phone's first launch.
 *  - `measured` — the launch measured this machine and walked the ladder to fit.
 *  - `chosen`   — the player picked it, and nothing may overrule that.
 *
 * Stored because the alternative was the mere PRESENCE of the stored preferences,
 * which conflated all four: one unlucky measurement — a cold shader cache, a busy
 * machine, a throttling battery — was then permanent, with no way back but clearing
 * browser storage. `Measure again` writes `default` and reloads into the launch.
 */
export type GraphicsQualitySource = 'default' | 'device' | 'measured' | 'chosen';

export interface Settings {
  gearboxMode: GearboxMode;
  /** Real minutes for one full day+night cycle. Clamped to [8, 128]. */
  dayCycleMinutes: number;
  /**
   * Mouse-look radians per CSS pixel. Stored as a preference so pointer lock has
   * the same feel across sessions.
   */
  mouseSensitivity: number;
  /**
   * How the driving camera behaves. `steady` is the camera this game always had;
   * `dynamic` adds the motion that makes a slide legible — see `CameraRig`.
   */
  cameraStyle: CameraStyle;
  /** Controller rumble strength, 0..1. Zero silences the pad entirely. */
  controllerVibration: number;
  /** Left-stick dead-zone, as a fraction of travel; see core/gamepad.ts. */
  controllerDeadzone: number;
  /**
   * Steering sensitivity for an analog stick: the stick's travel is multiplied by
   * this before the response curve, so it is the whole range that moves rather than
   * only its top.
   */
  controllerSteerSensitivity: number;
  /**
   * Steering assist for an ANALOG position — the pad's stick. On, the edge of the stick
   * is the angle that puts the front tyres at their peak slip, at every speed, and the
   * stick is proportional inside it; off, it is the whole lock. See `SteerMode` in
   * core/input.ts.
   */
  controllerSteerAssist: boolean;
  /**
   * Master volume, 0..1: everything, the radio included (audio/mixer.ts). Car, World
   * and Radio are each a share of it.
   */
  masterVolume: number;
  /** Share of the game sound given to the in-car radio, 0..1. */
  radioVolume: number;
  /**
   * Share of the game sound given to the car being driven (engine, tyres, wind over
   * the body, its knocks and clunks), 0..1. Scaled by `masterVolume`.
   */
  carVolume: number;
  /**
   * Share of the game sound given to the world (air, weather, thunder, animals,
   * other traffic), 0..1. Scaled by `masterVolume`.
   */
  worldVolume: number;
  /** Stream URL for the first in-car radio preset. */
  radioStation1Url: string;
  /** Stream URL for the second in-car radio preset. */
  radioStation2Url: string;
  /** Action id -> key codes, overriding the defaults. Absent = default. */
  keyBindings: Record<string, readonly string[]>;
  /**
   * Rendering tier. A device preference rather than a taste one, but it lives
   * here with the rest so it survives a reload like every other choice.
   */
  graphicsQuality: GraphicsQuality;
  /**
   * Where `graphicsQuality` came from. Only `default` permits a launch measurement,
   * so a player's explicit rung is never re-measured behind his back.
   */
  graphicsQualitySource: GraphicsQualitySource;
  /**
   * The frame as a multiple of the screen; see `FRAME_SCALES`. Ignored on Very Low,
   * which draws `retroLines`.
   *
   * The rung answers "what can this machine afford" in three steps, including the most
   * lines the screen is taken at (`GraphicsTier.screenLines`); this answers "how many
   * pixels do I want", and the game never moves it: a preset sets it to 1, and only the
   * player changes it after that.
   */
  frameScale: FrameScale;
  /** Very Low's frame height, lines; see `RETRO_LINE_CHOICES`. Ignored on every other rung. */
  retroLines: RetroLines;
  /**
   * Resting vertical field of view, degrees.
   *
   * A real setting rather than a constant because the projection is Hor+: the vertical
   * angle is fixed and the aspect decides the horizontal one, so a 21:9 window shows
   * MORE world than a 16:9 one and a portrait phone shows almost nothing sideways.
   * The acceleration widening and the ten-power binoculars are both derived from this, so
   * changing it moves the resting composition and nothing else.
   */
  fieldOfView: number;
  /** FXAA: edge antialiasing in the post pass, on the shaded picture (render/hazeshader.ts). */
  fxaa: boolean;
  /** Sun shadows (`ShadowMode`); the rung's default until the player chooses. */
  shadows: ShadowMode;
  /**
   * Ground cover, plants and open desert built into the world (`GrassMode`, render/
   * retro.ts build profile). Fixed for a load, so changing it reloads the drive.
   *
   * THE PLAYER'S ALONE: Off until he picks otherwise in the Grass row, on every rung, and
   * no preset, launch measurement or phone default writes it (owner, 2026-10-16). Stored
   * as `groundCover`, not the `grass` it was called while the presets owned it: every
   * stored `grass` was the presets' choice as often as the player's, and dropping it is
   * how they all start Off.
   */
  groundCover: GrassMode;
  /** Art direction (`VisualStyle`); uniforms only, so it applies in place mid-drive. */
  style: VisualStyle;
  /**
   * Frames per second the presentation may present, or null for no cap.
   *
   * The one lever that works on every device, and it is the player's to make because
   * nothing else can make it — see `presentationFpsFor`. Deliberately NOT on the rendering
   * rung, which is where it used to live, because that coupled a phone's sharpness to its
   * heat: the only way off a blurry 960x540 picture on a 1440p screen was to accept 60 FPS
   * with it. How sharp the picture is and how warm the device gets are different questions
   * and now have different answers.
   */
  frameRateLimit: FrameRateLimit;
  /** Redraws a second of each live car mirror, or null for every frame; see `MIRROR_FRAME_RATES`. */
  mirrorFrameRate: MirrorFrameRate;
  /**
   * MOUSE DRIVING (M while driving): pointer-locked horizontal mouse motion turns the
   * steering wheel and it stays exactly where the mouse put it; the left button is the
   * throttle, the right the brake, and holding the middle button or the look key (Shift)
   * turns the view instead. Off by default: the keyboard's hands on the wheel are the
   * familiar control. See `InputReader.setMouseDriving`.
   */
  mouseDriving: boolean;
  /**
   * A light vibration of the driving view at speed, growing from 60 km/h and stronger
   * on rough ground; see `CameraRig`. On by default: it is the cue that says the car is
   * still going fast once the acceleration that announced it has settled.
   */
  cameraShake: boolean;
  /**
   * Purely cosmetic joke toggle: every car — the one driven and every traffic
   * car — hops in place like the viral "bouncing Yaris" clip. Applied only to
   * the visual root in Vehicle.syncVisuals; the chassis body, its collider and
   * the wheel suspension never move, so handling and physics are identical
   * whether this is on or off. Off by default; nobody should be surprised by it.
   */
  bouncyCars: boolean;
  /**
   * Driver aids on the player's own car, all off by default: these cars had none, and
   * the drive is meant to be driven (vehicle/vehicletuning.ts, DRIVER AIDS).
   * `abs` eases the brake while a wheel locks; `tractionControl` eases the throttle
   * while the driven wheels spin.
   */
  abs: boolean;
  tractionControl: boolean;
  /**
   * Size of the driving dashboard, 1 = the default (what was 140% of the authored
   * cluster before 0.20). Applied on top of the presentation's own scale (desktop and
   * phone differ), so the same number means "a bit bigger" on both.
   */
  dashboardSize: number;
  /** How far the desert is drawn; see `viewDistanceFor`. */
  viewDistance: ComputeLevel;
  /** How many ambient cars the stream holds; see `TRAFFIC_CAPS`. */
  trafficDensity: ComputeLevel;
}

export const DAY_CYCLE_MIN_MINUTES = GAMEPLAY_CONFIG.dayCycleMinutesMin;
export const DAY_CYCLE_MAX_MINUTES = GAMEPLAY_CONFIG.dayCycleMinutesMax;

export const DEFAULT_MASTER_VOLUME = GAMEPLAY_CONFIG.defaultMasterVolume;
export const DEFAULT_RADIO_VOLUME = GAMEPLAY_CONFIG.defaultRadioVolume;
/** The mix is balanced at full share; the two sliders only ever take away. */
export const DEFAULT_CAR_VOLUME = 1;
export const DEFAULT_WORLD_VOLUME = 1;
export const DEFAULT_INK_STRENGTH = GAMEPLAY_CONFIG.defaultInkStrength;
export const DEFAULT_MOUSE_SENSITIVITY = GAMEPLAY_CONFIG.defaultMouseSensitivity;
export const MOUSE_SENSITIVITY_MIN = GAMEPLAY_CONFIG.mouseSensitivityMin;
export const MOUSE_SENSITIVITY_MAX = GAMEPLAY_CONFIG.mouseSensitivityMax;
/**
 * Controller defaults and bounds. Vibration at 70% is the authored feel rather than
 * full: the motors are strongest at their bottom end, and a game that starts at 100
 * leaves a player who finds it buzzing with nowhere down to go but off.
 */
export const DEFAULT_CONTROLLER_VIBRATION = 0.7;
export const CONTROLLER_VIBRATION_STEP = 0.05;
export const CONTROLLER_DEADZONE_MIN = 0;
/** At 30% of travel the first third of steering becomes unusable, which is the point. */
export const CONTROLLER_DEADZONE_MAX = 0.3;
export const CONTROLLER_DEADZONE_STEP = 0.01;
export const CONTROLLER_STEER_MIN = 0.5;
export const CONTROLLER_STEER_MAX = 2;
export const CONTROLLER_STEER_STEP = 0.05;
/**
 * Resting vertical field of view, and how far a player may move it.
 *
 * FOV matters more than it sounds: it sets the apparent scale of the whole world, so a
 * couple of degrees changes how big the car feels and how fast the road appears to
 * move. Every camera mode rests here, and the acceleration widening and the ten-power
 * binoculars are both measured from it.
 *
 * The bounds are the rectilinear projection's, not a taste: it stretches the picture
 * along the frame's radius by `1 / cos²(angle)`, so at 16:9 the frame edge runs 1.69x
 * at the minimum 50 (79 degrees horizontal) and 3.65x at the maximum 85 (117 degrees).
 * Past that the outer frame is a fisheye and the horizon bows; below the minimum the
 * view is a telephoto that makes 100 km/h look like 40.
 */
export const DEFAULT_FIELD_OF_VIEW = GAMEPLAY_CONFIG.fieldOfViewDegrees;
export const FIELD_OF_VIEW_MIN = GAMEPLAY_CONFIG.fieldOfViewMinDegrees;
export const FIELD_OF_VIEW_MAX = GAMEPLAY_CONFIG.fieldOfViewMaxDegrees;
/** Dashboard size range: a good deal smaller, a little bigger, never covering the road. */
export const DASHBOARD_SIZE_MIN = 0.55;
export const DASHBOARD_SIZE_MAX = 1.2;
/** The old `dashboardScale` measured against the authored cluster; 1.4 of it is now 1. */
const LEGACY_DASHBOARD_SCALE_PER_SIZE = 1.4;
export const DASHBOARD_SIZE_STEP = 0.05;

/** Default day length in real minutes. */
const DEFAULT_DAY_CYCLE_MINUTES = GAMEPLAY_CONFIG.dayCycleMinutes;


export const DEFAULT_SETTINGS: Settings = {
  // Automatic by default: the gearbox is driver assist, not the game. Shifting by
  // hand stays one wheel notch away for anyone who wants it.
  gearboxMode: 'automatic',
  dayCycleMinutes: DEFAULT_DAY_CYCLE_MINUTES,
  mouseSensitivity: DEFAULT_MOUSE_SENSITIVITY,
  // Steady by default: it is the authored composition, and a player who wants the
  // motion opts into it.
  cameraStyle: 'steady',
  controllerVibration: DEFAULT_CONTROLLER_VIBRATION,
  // The pad module's own default, so the hub and the settings cannot disagree about
  // what "as shipped" means before the first settings push.
  controllerDeadzone: DEFAULT_DEADZONE,
  controllerSteerSensitivity: 1,
  controllerSteerAssist: true,
  masterVolume: DEFAULT_MASTER_VOLUME,
  carVolume: DEFAULT_CAR_VOLUME,
  worldVolume: DEFAULT_WORLD_VOLUME,
  radioVolume: DEFAULT_RADIO_VOLUME,
  radioStation1Url: 'https://streams.radiomast.io/nts1',
  radioStation2Url: 'https://streams.radiomast.io/nts2',
  // Absent entries mean "use the default binding", so the empty record is the
  // correct default: it can never diverge from BINDABLE_ACTIONS. Shared by
  // design — Settings objects are replaced wholesale through world.apply
  // deltas, never mutated in place.
  keyBindings: {},
  // The modest rung, and `default` is the point of it: nobody has answered yet, so the
  // launch is allowed to MEASURE this machine and walk the ladder to fit. Guessing
  // wrong either robs a capable machine or leaves a weak one stuttering — true of
  // guessing, and not true of measuring, which is what the launch settle already does.
  graphicsQuality: 'standard',
  graphicsQualitySource: 'default',
  // The screen itself, under the rung's ceiling.
  frameScale: 1,
  retroLines: 360,
  fxaa: true,
  shadows: 'full',
  groundCover: 'off',
  style: 'standard',
  // Uncapped by default on every device, phones included: a cap is the player's choice
  // to make (heat, noise), not a default to discover.
  frameRateLimit: null,
  mirrorFrameRate: DEFAULT_MIRROR_FRAME_RATE,
  fieldOfView: DEFAULT_FIELD_OF_VIEW,
  // Off by default; M switches it while driving, and the pause menu remembers which.
  mouseDriving: false,
  cameraShake: true,
  // Off by default; a joke should be opted into, not discovered mid-drive.
  bouncyCars: false,
  abs: false,
  tractionControl: false,
  dashboardSize: 1,
  // 16 km of desert and a 24-car stream; High is for a processor with room beyond them.
  viewDistance: 'medium',
  trafficDensity: 'medium',
};

/**
 * THE QUALITY PRESET: one choice (Very Low / Low / Medium / High) for the three ladders
 * that each answer part of "what can this machine afford" — the graphics rung, the view
 * distance and the traffic — set at once, rung for rung. Not stored: it is read back off
 * the values it sets (`qualityPresetOf`), so a save keeps exactly the values it had and
 * a player who moves one of them in Advanced sees `Custom`.
 *
 * A preset also brings what picking a rung always brought: the rung's own
 * antialiasing, its own frame height (Very Low: its own 360 lines) and no frame cap.
 */
export type QualityPreset = ComputeLevel;

/** The graphics rung each preset puts the picture on. */
export const QUALITY_PRESET_DETAIL: Record<QualityPreset, GraphicsQuality> = {
  very_low: 'retro',
  low: 'acceptable',
  medium: 'standard',
  high: 'blessing',
};

/** The preset whose rung this is, rung for rung. */
export function qualityPresetForDetail(quality: GraphicsQuality): QualityPreset {
  return quality === 'retro' ? 'very_low'
    : quality === 'acceptable' ? 'low'
    : quality === 'standard' ? 'medium'
    : 'high';
}

/** `settings` with every value the preset owns set from it; the source is the caller's. */
export function withQualityPreset(
  settings: Settings,
  preset: QualityPreset,
  source: GraphicsQualitySource,
  mobilePresentation: boolean,
): Settings {
  const quality = QUALITY_PRESET_DETAIL[preset];
  return {
    ...settings,
    graphicsQuality: quality,
    graphicsQualitySource: source,
    viewDistance: preset,
    trafficDensity: preset,
    frameScale: 1,
    retroLines: 360,
    fxaa: GRAPHICS_TIERS[quality].fxaa,
    shadows: shadowModeDefault(quality),
    style: 'standard',
    frameRateLimit: null,
  };
}

/**
 * The preset these settings are exactly on, or null for `Custom`. The frame is compared
 * off Very Low as the screen (multiple 1) and on it as its own line count.
 */
export function qualityPresetOf(settings: Settings, mobilePresentation: boolean): QualityPreset | null {
  const preset = qualityPresetForDetail(settings.graphicsQuality);
  const onPreset =
    settings.viewDistance === preset
    && settings.trafficDensity === preset
    && settings.fxaa === GRAPHICS_TIERS[settings.graphicsQuality].fxaa
    && settings.shadows === shadowModeDefault(settings.graphicsQuality)
    && settings.style === 'standard'
    && settings.frameRateLimit === null
    && (settings.graphicsQuality === 'retro'
      ? settings.retroLines === 360
      : settings.frameScale === 1);
  return onPreset ? preset : null;
}

/**
 * `settings` handed back to the launch measurement (source `default`). The measurement
 * walks the ordinary ladder only — the retro rung is a choice, and a load built for it
 * cannot step to another rung in place — so Very Low starts it from Low: the Low preset
 * when the settings were on a preset, the Low rung alone when they were not.
 */
export function withRemeasure(settings: Settings, mobilePresentation: boolean): Settings {
  if (settings.graphicsQuality !== 'retro') return { ...settings, graphicsQualitySource: 'default' };
  return qualityPresetOf(settings, mobilePresentation) !== null
    ? withQualityPreset(settings, 'low', 'default', mobilePresentation)
    : { ...settings, graphicsQuality: 'acceptable', graphicsQualitySource: 'default' };
}

/**
 * A phone's first launch: it must not inherit desktop DPR, antialiasing and refresh costs. The
 * rung is authored for the presentation, not measured and not chosen (`device`), and a
 * phone core is the slowest processor this game runs on, so it gets the lightest stream
 * and the 2 km horizon. Once the player stores preferences, they win.
 */
export const PHONE_FIRST_LAUNCH = {
  graphicsQuality: 'acceptable',
  graphicsQualitySource: 'device',
  fxaa: false,
  shadows: 'off',
  frameScale: 1,
  viewDistance: 'very_low',
  trafficDensity: 'very_low',
} as const satisfies Partial<Settings>;

/**
 * Fractions of the local mean-solar game clock. Astronomy is date-dependent, so
 * these are camera-friendly clock presets rather than fixed celestial elevations:
 * seasons and lunar phase remain untouched.
 */
export const TIME_OF_DAY_PRESETS: Record<TimeOfDayPreset, number> = {
  morning: 0.34,
  noon: 0.5,
  evening: 0.72,
  midnight: 0.0,
};

/** Known action ids, for dropping unknown keys out of hand-edited bindings. */
const BINDABLE_IDS: Record<string, true> = {};
for (const action of BINDABLE_ACTIONS) BINDABLE_IDS[action.id] = true;

/**
 * Rebuilds a valid Settings from anything: fresh defaults, an old save with no
 * settings field, or hand-edited JSON. Unknown action ids and malformed binding
 * values are dropped (the action keeps its default keys); the day length is
 * clamped into [8, 128]. Returns a fresh object, never aliasing the input, so
 * the caller can store it in state without sharing mutable memory.
 */
/** An offered rate, or null for no cap. Anything else is the default. */
export function frameRateLimitFrom(raw: unknown): FrameRateLimit {
  return typeof raw === 'number' && FRAME_RATE_LIMITS.some((rate) => rate === raw)
    ? (raw as FrameRateLimit)
    : null;
}

/**
 * Any stored value as a valid `Settings`. `mobilePresentation` picks which column of the
 * rung a missing or unoffered frame height falls back to.
 */
export function sanitizeSettings(raw: unknown, mobilePresentation: boolean): Settings {
  const obj =
    typeof raw === 'object' && raw !== null && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};

  const dayCycleRaw =
    typeof obj.dayCycleMinutes === 'number' && Number.isFinite(obj.dayCycleMinutes)
      ? obj.dayCycleMinutes
      : DEFAULT_DAY_CYCLE_MINUTES;
  const sensitivityRaw =
    typeof obj.mouseSensitivity === 'number' && Number.isFinite(obj.mouseSensitivity)
      ? obj.mouseSensitivity
      : DEFAULT_MOUSE_SENSITIVITY;
  // Anything unrecognised is standard, so an old save (which has no such field)
  // keeps the look it was made with.
  const graphicsQuality: GraphicsQuality =
    obj.graphicsQuality === 'retro'
      || obj.graphicsQuality === 'acceptable'
      || obj.graphicsQuality === 'blessing'
      ? obj.graphicsQuality
      : 'standard';

  // Missing unit-interval settings mean an old save: use the authored default.
  const unitInterval = (value: unknown, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value)
      ? Math.min(1, Math.max(0, value))
      : fallback;

  const radioUrl = (value: unknown, fallback: string): string => {
    if (typeof value !== 'string') return fallback;
    const url = value.trim();
    return /^https?:\/\//i.test(url) && url.length <= 2048 ? url : fallback;
  };

  const settings: Settings = {
    // Anything that is not exactly the automatic string is manual: the
    // historical mode, and the safe fallback for garbage input.
    gearboxMode: obj.gearboxMode === 'automatic' ? 'automatic' : 'manual',
    dayCycleMinutes: Math.min(DAY_CYCLE_MAX_MINUTES, Math.max(DAY_CYCLE_MIN_MINUTES, dayCycleRaw)),
    mouseSensitivity: Math.min(MOUSE_SENSITIVITY_MAX, Math.max(MOUSE_SENSITIVITY_MIN, sensitivityRaw)),
    // Missing means an older save, and every older save was played with the steady
    // camera: anything that is not exactly the new word is the camera that came first.
    cameraStyle: obj.cameraStyle === 'dynamic' ? 'dynamic' : 'steady',
    controllerVibration: unitInterval(obj.controllerVibration, DEFAULT_CONTROLLER_VIBRATION),
    controllerDeadzone: Math.min(
      CONTROLLER_DEADZONE_MAX,
      Math.max(
        CONTROLLER_DEADZONE_MIN,
        typeof obj.controllerDeadzone === 'number' && Number.isFinite(obj.controllerDeadzone)
          ? obj.controllerDeadzone
          : DEFAULT_DEADZONE,
      ),
    ),
    controllerSteerSensitivity: Math.min(
      CONTROLLER_STEER_MAX,
      Math.max(
        CONTROLLER_STEER_MIN,
        typeof obj.controllerSteerSensitivity === 'number'
          && Number.isFinite(obj.controllerSteerSensitivity)
          ? obj.controllerSteerSensitivity
          : 1,
      ),
    ),
    // Missing means a save from before the option: on, like a new one.
    controllerSteerAssist: obj.controllerSteerAssist !== false,
    masterVolume: unitInterval(obj.masterVolume, DEFAULT_MASTER_VOLUME),
    carVolume: unitInterval(obj.carVolume, DEFAULT_CAR_VOLUME),
    worldVolume: unitInterval(obj.worldVolume, DEFAULT_WORLD_VOLUME),
    radioVolume: unitInterval(obj.radioVolume, DEFAULT_RADIO_VOLUME),
    radioStation1Url: radioUrl(obj.radioStation1Url, 'https://streams.radiomast.io/nts1'),
    radioStation2Url: radioUrl(obj.radioStation2Url, 'https://streams.radiomast.io/nts2'),
    keyBindings: {},
    graphicsQuality,
    // A MISSING source means preferences written before this field existed, and the
    // honest reading of those is that the question has been answered — by whoever wrote
    // them. Reading it as `default` instead would re-measure every existing player once
    // and overrule rungs they had picked by hand.
    graphicsQualitySource:
      obj.graphicsQualitySource === 'default'
        || obj.graphicsQualitySource === 'device'
        || obj.graphicsQualitySource === 'measured'
        ? obj.graphicsQualitySource
        : 'chosen',
    // Snapped to an offered multiple rather than clamped, so a hand-edited 1.3 cannot
    // become a resolution the menu has no button for. Preferences from before the
    // multiples carry a `renderHeight` (lines) or an older `renderScale` (a DPR
    // percentage); neither is this, so they land on the screen, as a preset would.
    frameScale: FRAME_SCALES.find((scale) => scale === obj.frameScale) ?? 1,
    retroLines: retroLinesFrom(obj.retroLines),
    // Not a player setting any more (no slider): a save's old value is dropped so
    // every player gets the authored view.
    fieldOfView: DEFAULT_FIELD_OF_VIEW,
    // A save's `viewDistance` is DELIBERATELY DROPPED rather than migrated. The horizon
    // is a property of the CPU level now, and the two ladders do not line up: an old
    // save asking for `vast` on `acceptable` was a combination that should never have
    // been offerable, and there is no honest way to guess which half the player meant.
    // The tier they chose is the answer, and it is right there in the same object.
    // `eyeAdaptation` lived here once and is deliberately not migrated: exposure is
    // analytic now, so a stored preference has nothing left to select.
    // The rung's own default until the player chooses. A stored `msaa` is deliberately
    // not migrated: multisampling is gone, and FXAA is a different trade to choose.
    fxaa:
      typeof obj.fxaa === 'boolean'
        ? obj.fxaa
        : obj.graphicsQuality !== 'acceptable' && obj.graphicsQuality !== 'retro',
    // Missing or unrecognised means a save from before the option: the stored rung's
    // own default, which is what that save was drawing.
    shadows:
      obj.shadows === 'off' || obj.shadows === 'near' || obj.shadows === 'full'
        ? obj.shadows
        : shadowModeDefault(graphicsQuality),
    // Only the key the player's own choice is stored under; see `Settings.groundCover`.
    groundCover: (GRASS_MODES as readonly unknown[]).includes(obj.groundCover)
      ? (obj.groundCover as GrassMode)
      : 'off',
    // Missing means a save from before the option, which drew Standard.
    style: obj.style === 'clean' ? 'clean' : 'standard',
    // Snap to an offered rate rather than clamping, so a hand-edited 31 or 999 cannot
    // become a frame rate the menu has no button for. `mobileFrameRate` is the phone-only
    // name this setting had first; reading it is how a save made before this change keeps
    // the cap its player chose instead of silently becoming uncapped and hot.
    frameRateLimit: frameRateLimitFrom(obj.frameRateLimit ?? obj.mobileFrameRate),
    mirrorFrameRate: mirrorFrameRateFrom(obj.mirrorFrameRate),
    // Older saves stored the mouse-held wheel as `preciseSteering`, and before that as
    // `mouseSteering`; either switched on means mouse driving on. Only the new field
    // is written back.
    mouseDriving:
      typeof obj.mouseDriving === 'boolean'
        ? obj.mouseDriving
        : obj.preciseSteering === true || obj.mouseSteering === true,
    // Missing means an older save: on, like every new drive.
    cameraShake: obj.cameraShake !== false,
    bouncyCars: obj.bouncyCars === true,
    abs: obj.abs === true,
    tractionControl: obj.tractionControl === true,
    // Snapped to the slider's step, clamped to its range; missing means the default. A
    // save from before 0.20 has `dashboardScale` against the authored cluster instead.
    dashboardSize: (() => {
      const raw =
        typeof obj.dashboardSize === 'number' && Number.isFinite(obj.dashboardSize)
          ? obj.dashboardSize
          : typeof obj.dashboardScale === 'number' && Number.isFinite(obj.dashboardScale)
            ? obj.dashboardScale / LEGACY_DASHBOARD_SCALE_PER_SIZE
            : 1;
      return (
        Math.round(Math.min(DASHBOARD_SIZE_MAX, Math.max(DASHBOARD_SIZE_MIN, raw)) / DASHBOARD_SIZE_STEP) *
        DASHBOARD_SIZE_STEP
      );
    })(),
    // A save from before the split had one `cpuLoad` for both; it seeds each.
    viewDistance: computeLevel(obj.viewDistance) ?? computeLevel(obj.cpuLoad) ?? 'medium',
    trafficDensity: computeLevel(obj.trafficDensity) ?? computeLevel(obj.cpuLoad) ?? 'medium',
  };

  const rawBindings = obj.keyBindings;
  if (typeof rawBindings === 'object' && rawBindings !== null && !Array.isArray(rawBindings)) {
    for (const [storedId, value] of Object.entries(rawBindings as Record<string, unknown>)) {
      // The M toggle's action was `mouseSteer` before it became mouse driving.
      const id = storedId === 'mouseSteer' ? 'mouseDriving' : storedId;
      if (!(id in BINDABLE_IDS)) continue;
      if (!Array.isArray(value)) continue;
      const codes: string[] = [];
      for (const code of value) if (typeof code === 'string') codes.push(code);
      // An empty binding is treated as absent: falling back to the default keys
      // is always safer than silently unbinding an action.
      if (codes.length > 0) settings.keyBindings[id] = codes;
    }
  }
  return settings;
}

/**
 * Where preferences live BETWEEN drives, and why that is not the save file.
 *
 * `Settings` is stored inside `WorldState`, so it travels in the save — which is
 * right for the ones that describe a playthrough (gearbox mode, day length) and
 * wrong for every one that describes the MACHINE. Graphics quality and view
 * distance are properties of the GPU in front of the player, not of a drive, and
 * putting them in the save meant starting a new drive silently reset them to
 * `standard`/`near`: set them once, start a fresh drive, and they were gone.
 *
 * So they are mirrored here as well, keyed per browser rather than per save. On
 * load this copy wins over whatever the save carried, because the machine has not
 * changed since the last session and the save may be years old or from another
 * computer entirely.
 *
 * Everything goes through `sanitizeSettings` on the way out, which already accepts
 * arbitrary JSON — so a corrupted or hand-edited entry degrades to defaults instead
 * of breaking the boot. Nothing here throws: a browser with storage disabled or a
 * full quota simply gets the old per-save behaviour back.
 */
const SETTINGS_KEY = 'brodrive-settings-v1';

/** The stored preferences, or null if there are none or they cannot be read. */
export function loadStoredSettings(mobilePresentation: boolean): Settings | null {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw === null) return null;
    return sanitizeSettings(JSON.parse(raw), mobilePresentation);
  } catch {
    return null;
  }
}

/** Mirrors preferences to browser storage. Called on every settings change. */
export function storeSettings(settings: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Storage disabled or full. Preferences still apply for this session; they
    // just will not outlive it, which is exactly the old behaviour.
  }
}
