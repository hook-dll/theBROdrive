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
export type GearboxMode = 'manual' | 'automatic';
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
 * THE PIXEL NUMBERS ARE ABSOLUTE CEILINGS, and that is the second half of the fix. The
 * tiers used to resolve their resolution as `min(DPR x multiplier, DPR cap)` — a display
 * PERCENTAGE — for everything except `acceptable`, which was the only tier with an
 * absolute budget. On a display whose device-pixel-ratio is 1, which is every 4K
 * television and every monitor at 100% scaling, the percentage resolves to exactly 1.0
 * at every tier: a mini-PC on a 4K TV and a 4090 on a 4K TV were both asked for
 * 8.29 megapixels. Measured across the four devices this game is played on, `standard`
 * on an Intel N100 at 4K and `standard` on a 4090 at 4K were the same load, and the
 * only way down was `acceptable` at 1.44 Mpx — a 5.8x cliff, with no rung in between.
 *
 * An absolute ceiling makes a rung mean the same thing on a phone, a mini-PC and a
 * workstation. Below the ceiling the display's own sharpness still decides, and above
 * it a supersampling multiplier lets the top rung spend headroom it is told it has.
 */
export type GraphicsQuality = 'retro' | 'acceptable' | 'standard' | 'blessing';

/**
 * One rung. Every number here is a consequence of the same question — what can this
 * machine afford — which is what makes it a tier rather than a collection of switches.
 */
export interface GraphicsTier {
  /**
   * Absolute ceiling on rendered scene pixels, on a desktop presentation. The render
   * scale is `min(DPR x supersample, sqrt(ceiling / cssPixels))`, so a large display
   * cannot exceed this and a small one is never downscaled below its own sharpness.
   */
  readonly maxPixels: number;
  /** The same ceiling under phone presentation, where a DPR of 3 invites millions. */
  readonly mobileMaxPixels: number;
  /**
   * Absolute FLOOR on rendered scene pixels: where dynamic resolution stops. Absolute
   * rather than a fraction of the ceiling, because a fraction says nothing about what
   * the image looks like — 0.55 of a phone's budget and 0.55 of a 4K workstation's are
   * different pictures, and the whole point of a floor is the picture it guarantees.
   */
  readonly minPixels: number;
  readonly mobileMinPixels: number;
  /** Supersampling headroom above the display, for a rung told it has some. */
  readonly supersample: number;
  /** Sun shadow map. The one per-frame pass a weak machine cannot afford at any size. */
  readonly shadows: boolean;
  /** Default for `Settings.msaa`; a player may still choose otherwise. */
  readonly msaa: boolean;
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
}

/**
 * The rungs, weakest first. Read them as machines, not presets:
 *
 *  - `retro` — a mini-PC or an old laptop that cannot hold `acceptable`. A fixed
 *    low-resolution frame in whole pixels and cheaper ground cover; switching to or
 *    from it reloads the drive, because it changes what the world is built from.
 *  - `acceptable` — a phone, or a mini-PC on a television. No shadow pass, because it is
 *    the one cost that cannot be paid in pixels.
 *  - `standard` — an ordinary desktop with a discrete GPU or a good integrated one.
 *    Native on a 1440p display, shadows on.
 *  - `blessing` — a machine with headroom to spare. Supersamples,
 *    and a sky deep enough to be crowded rather than plotted.
 *
 * A rung is a statement about the MACHINE, and a phone is two machines at once: the one
 * that draws the picture and the one that gets hot. Its pixel ceiling is
 * the first; its shadow pass and its frame rate are the second — and the second is the
 * player's, because no browser will tell the game how warm the phone is.
 */
export const GRAPHICS_TIERS: Record<GraphicsQuality, GraphicsTier> = {
  // A DIFFERENT PICTURE, NOT A SMALLER ONE. `acceptable` on an Intel N100 measured
  // 36.5 ms of GPU at 0.92 Mpx — 20 FPS — and the only way further down that ladder
  // was a bilinear stretch of fewer pixels, which reads as a broken image. This rung
  // draws a fixed low-resolution frame upscaled by whole pixels (render/retro.ts), so
  // the pixels are a style rather than a blur. Its pixel numbers are what the menu
  // quotes; the renderer derives the real buffer from the display's height.
  retro: {
    maxPixels: 640 * 360,
    mobileMaxPixels: 640 * 360,
    minPixels: 640 * 360,
    mobileMinPixels: 640 * 360,
    supersample: 1,
    shadows: false,
    msaa: false,
    mobileShadows: false,
    starMagnitude: 6,
    mobileStarMagnitude: 6,
    // Four: the driven car's own two headlamps and two tail lamps, which are never
    // merged. Fewer, and lit headlamps leave its brake lights dark.
    vehicleLightSlots: 4,
    mobileVehicleLightSlots: 4,
    headlightDistanceScale: 1,
  },
  acceptable: {
    maxPixels: 1600 * 900,
    mobileMaxPixels: 960 * 540,
    minPixels: 1280 * 720,
    mobileMinPixels: 640 * 360,
    supersample: 1,
    shadows: false,
    msaa: false,
    mobileShadows: false,
    starMagnitude: 7,
    mobileStarMagnitude: 7,
    // Four, as on retro: the driven car's own lamps, all of them.
    vehicleLightSlots: 4,
    mobileVehicleLightSlots: 4,
    headlightDistanceScale: 1,
  },
  standard: {
    maxPixels: 2560 * 1440,
    mobileMaxPixels: 1280 * 720,
    minPixels: 1600 * 900,
    mobileMinPixels: 960 * 540,
    supersample: 1,
    shadows: true,
    msaa: true,
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
  },
  blessing: {
    // 4800x2700, which is 4K with the 1.25x supersampling this rung always had.
    maxPixels: 4800 * 2700,
    mobileMaxPixels: 1600 * 900,
    minPixels: 1920 * 1080,
    mobileMinPixels: 1280 * 720,
    supersample: 1.25,
    shadows: true,
    msaa: true,
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
    // the supersampling, the sky.
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
  },
};

/**
 * How far the desert is drawn before the fog dissolves it, metres: the far plane, the
 * fog and the vista disc together, which must agree or the edge of the world shows.
 *
 * A CPU figure, not a graphics one. The vista costs terrain sampling, set by RADIUS
 * rather than by pixels: measured on a 5950X, a cell rebuild costs 13.0 ms at 1.5 km,
 * 17.3 ms at 8 km and 31.9 ms at 25 km, and the mesa vertex count goes from 897 to
 * 16 419 — a hitch on every cell crossing for a processor that cannot keep up.
 */
const HORIZON_M: Record<CpuLoad, number> = { low: 1500, medium: 8000, high: 25000 };

/**
 * The horizon this presentation draws. A phone never gets the 25 km map: a phone core
 * is slower than the 5950X above, so that radius is a multi-frame hitch per cell.
 */
export function viewDistanceFor(cpuLoad: CpuLoad, mobilePresentation: boolean): number {
  return mobilePresentation ? Math.min(HORIZON_M[cpuLoad], HORIZON_M.medium) : HORIZON_M[cpuLoad];
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

/** Whether this presentation pays for a sun shadow pass. */
export function shadowsFor(quality: GraphicsQuality, mobilePresentation: boolean): boolean {
  return mobilePresentation ? GRAPHICS_TIERS[quality].mobileShadows : GRAPHICS_TIERS[quality].shadows;
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
 * Processor budget, separate from the graphics rung because it is a different chip.
 * The graphics rung is pixels and shader cost; this is work the processor pays for
 * whatever the screen is: how many ambient traffic cars are live, each a full physical
 * vehicle with its own autopilot and pairwise coordination that grows with the square
 * of the count, and how far the desert is drawn (`viewDistanceFor`). Both apply live:
 * surplus cars drain behind the player, the horizon moves in place.
 */
export type CpuLoad = 'low' | 'medium' | 'high';

/**
 * Traffic replenishment ceilings per CPU level: two-lane and four-lane road.
 *
 * High is the 12/24 the stream had when it lived in 400 m either side of the player.
 * Doubling it with the 800 m reach was meant to hold the density per metre, but the
 * cars do not spread over the window: receding cars behind are recycled and the budget
 * lives on the road ahead, so the doubled count read as twice the traffic.
 */
export const TRAFFIC_CAPS: Record<CpuLoad, { readonly narrow: number; readonly wide: number }> = {
  low: { narrow: 4, wide: 8 },
  medium: { narrow: 8, wide: 16 },
  high: { narrow: 12, wide: 24 },
};

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
 * Offered manual render scales, as a fraction of the DISPLAY's own pixels.
 *
 * Not a fraction of the rung: the rung's ceiling is what `Auto` decides to spend, and
 * a player overriding it is answering a different question — how many pixels do I want
 * for this window — which only has a meaning against the window. 100% is one
 * drawing-buffer pixel per device pixel; below that is the in-between a three-rung
 * ladder cannot offer; above it is supersampling, which used to be reachable only by
 * also buying eighteen headlamps.
 *
 * It exists because `Auto` cannot work everywhere: the measurement behind it is a GPU
 * timer query, and a browser without `EXT_disjoint_timer_query_webgl2` — Safari, most
 * Android WebViews — can never move the scale at all. There, three rungs was the whole
 * of the choice.
 */
export const RENDER_SCALES = [0.5, 0.7, 0.85, 1, 1.25, 1.5] as const;
/** One offered fraction. Named because the menu row and the bench both iterate them. */
export type RenderScaleFraction = (typeof RENDER_SCALES)[number];
/** A chosen fraction of the display, or null to let the rung and the GPU decide. */
export type RenderScale = RenderScaleFraction | null;

/** An offered fraction, or null. Anything else — hand-edited, stale — is automatic. */
export function renderScaleFrom(raw: unknown): RenderScale {
  return typeof raw === 'number' && RENDER_SCALES.some((scale) => scale === raw)
    ? (raw as RenderScale)
    : null;
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
   * Manual drawing-buffer scale as a fraction of the display, or null for automatic.
   *
   * The rung answers "what can this machine afford" in three steps; this answers "how
   * many pixels do I want" continuously, in both directions, and turns the adaptive
   * controller off while it is set — `Auto` IS the adaptive mode, and a fixed number
   * that still drifts is not a fixed number.
   */
  renderScale: RenderScale;
  /**
   * Resting vertical field of view, degrees.
   *
   * A real setting rather than a constant because the projection is Hor+: the vertical
   * angle is fixed and the aspect decides the horizontal one, so a 21:9 window shows
   * MORE world than a 16:9 one and a portrait phone shows almost nothing sideways.
   * The speed widening and the ten-power binoculars are both derived from this, so
   * changing it moves the resting composition and nothing else.
   */
  fieldOfView: number;
  /** Four-sample geometry-edge antialiasing on the scene render target. */
  msaa: boolean;
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
  /**
   * Persistent precise control: mouse travel and A/D move one linear virtual wheel
   * that stays where the player leaves it. Off by default because standard steering
   * is the familiar self-centering keyboard behavior.
   */
  preciseSteering: boolean;
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
   * Size of the driving dashboard against its authored size, 1 = as designed. Applied
   * on top of the presentation's own scale (desktop and phone differ), so the same
   * number means "a bit bigger" on both.
   */
  dashboardScale: number;
  /** Processor budget; see `CpuLoad`. */
  cpuLoad: CpuLoad;
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
 * Resting vertical field of view, and how far a player may move it.
 *
 * FOV matters more than it sounds: it sets the apparent scale of the whole world, so a
 * couple of degrees changes how big the car feels and how fast the road appears to
 * move. Every camera mode rests here, and the speed widening and the ten-power
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
/** Dashboard size range: a little smaller, somewhat bigger, never covering the road. */
export const DASHBOARD_SCALE_MIN = 0.75;
export const DASHBOARD_SCALE_MAX = 1.4;
export const DASHBOARD_SCALE_STEP = 0.05;

/** Default day length in real minutes. */
const DEFAULT_DAY_CYCLE_MINUTES = GAMEPLAY_CONFIG.dayCycleMinutes;


export const DEFAULT_SETTINGS: Settings = {
  // Automatic by default: the gearbox is driver assist, not the game. Shifting by
  // hand stays one wheel notch away for anyone who wants it.
  gearboxMode: 'automatic',
  dayCycleMinutes: DEFAULT_DAY_CYCLE_MINUTES,
  mouseSensitivity: DEFAULT_MOUSE_SENSITIVITY,
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
  // Automatic: the rung's own ceiling, walked down by GPU measurement if the machine
  // cannot hold it. A player who would rather name the number picks one in the menu.
  renderScale: null,
  msaa: true,
  // Uncapped by default on every device, phones included: a cap is the player's choice
  // to make (heat, noise), not a default to discover.
  frameRateLimit: null,
  fieldOfView: DEFAULT_FIELD_OF_VIEW,
  // Off by default; M switches it on, and the pause menu remembers which.
  preciseSteering: false,
  cameraShake: true,
  // Off by default; a joke should be opted into, not discovered mid-drive.
  bouncyCars: false,
  dashboardScale: 1,
  // The full stream. A machine that cannot carry it is told so by the menu's CPU row.
  cpuLoad: 'high',
};

/**
 * A level picked on the title screen, with the defaults that come with it: the level's
 * own multisampling, automatic resolution and no frame cap. The title offers the level
 * and nothing else, so everything else it implies is reset here rather than inherited
 * from whatever the pause menu was last set to.
 */
export function withTierDefaults(settings: Settings, quality: GraphicsQuality): Settings {
  return {
    ...settings,
    graphicsQuality: quality,
    graphicsQualitySource: 'chosen',
    renderScale: null,
    msaa: GRAPHICS_TIERS[quality].msaa,
    frameRateLimit: null,
  };
}

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

export function sanitizeSettings(raw: unknown): Settings {
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
  const fieldOfViewRaw =
    typeof obj.fieldOfView === 'number' && Number.isFinite(obj.fieldOfView)
      ? obj.fieldOfView
      : DEFAULT_FIELD_OF_VIEW;

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
    masterVolume: unitInterval(obj.masterVolume, DEFAULT_MASTER_VOLUME),
    carVolume: unitInterval(obj.carVolume, DEFAULT_CAR_VOLUME),
    worldVolume: unitInterval(obj.worldVolume, DEFAULT_WORLD_VOLUME),
    radioVolume: unitInterval(obj.radioVolume, DEFAULT_RADIO_VOLUME),
    radioStation1Url: radioUrl(obj.radioStation1Url, 'https://streams.radiomast.io/nts1'),
    radioStation2Url: radioUrl(obj.radioStation2Url, 'https://streams.radiomast.io/nts2'),
    keyBindings: {},
    // Anything unrecognised is standard, so an old save (which has no such field)
    // keeps the look it was made with.
    graphicsQuality:
      obj.graphicsQuality === 'retro'
        || obj.graphicsQuality === 'acceptable'
        || obj.graphicsQuality === 'blessing'
        ? obj.graphicsQuality
        : 'standard',
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
    // Snapped to an offered fraction rather than clamped, so a hand-edited 0.33 cannot
    // become a resolution the menu has no button for and the player cannot get back to.
    renderScale: renderScaleFrom(obj.renderScale),
    // Whole degrees: the slider steps in ones, and a stored 64.7 would paint as 65 and
    // then render as something else.
    fieldOfView: Math.round(
      Math.min(FIELD_OF_VIEW_MAX, Math.max(FIELD_OF_VIEW_MIN, fieldOfViewRaw)),
    ),
    // A save's `viewDistance` is DELIBERATELY DROPPED rather than migrated. The horizon
    // is a property of the CPU level now, and the two ladders do not line up: an old
    // save asking for `vast` on `acceptable` was a combination that should never have
    // been offerable, and there is no honest way to guess which half the player meant.
    // The tier they chose is the answer, and it is right there in the same object.
    // `eyeAdaptation` lived here once and is deliberately not migrated: exposure is
    // analytic now, so a stored preference has nothing left to select.
    // Preserve the old tier behavior once, then this becomes an independent choice.
    msaa:
      typeof obj.msaa === 'boolean'
        ? obj.msaa
        : obj.graphicsQuality !== 'acceptable' && obj.graphicsQuality !== 'retro',
    // Snap to an offered rate rather than clamping, so a hand-edited 31 or 999 cannot
    // become a frame rate the menu has no button for. `mobileFrameRate` is the phone-only
    // name this setting had first; reading it is how a save made before this change keeps
    // the cap its player chose instead of silently becoming uncapped and hot.
    frameRateLimit: frameRateLimitFrom(obj.frameRateLimit ?? obj.mobileFrameRate),
    // `mouseSteering` is the pre-precise-control name in existing saves. Read it once;
    // every newly sanitized Settings object writes only the truthful new field.
    preciseSteering: obj.preciseSteering === true || obj.mouseSteering === true,
    // Missing means an older save: on, like every new drive.
    cameraShake: obj.cameraShake !== false,
    bouncyCars: obj.bouncyCars === true,
    // Snapped to the slider's step, clamped to its range; missing means the authored size.
    dashboardScale:
      typeof obj.dashboardScale === 'number' && Number.isFinite(obj.dashboardScale)
        ? Math.round(
            Math.min(DASHBOARD_SCALE_MAX, Math.max(DASHBOARD_SCALE_MIN, obj.dashboardScale)) /
              DASHBOARD_SCALE_STEP,
          ) * DASHBOARD_SCALE_STEP
        : 1,
    cpuLoad: obj.cpuLoad === 'low' || obj.cpuLoad === 'medium' ? obj.cpuLoad : 'high',
  };

  const rawBindings = obj.keyBindings;
  if (typeof rawBindings === 'object' && rawBindings !== null && !Array.isArray(rawBindings)) {
    for (const [id, value] of Object.entries(rawBindings as Record<string, unknown>)) {
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
export function loadStoredSettings(): Settings | null {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw === null) return null;
    return sanitizeSettings(JSON.parse(raw));
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
