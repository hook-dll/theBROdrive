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
 * So one ladder owns all of it, and each rung is a coherent statement about a machine
 * rather than a knob.
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
export type GraphicsQuality = 'acceptable' | 'standard' | 'blessing';

/**
 * HOW FAR THE WORLD REACHES, as a second axis beside the rung.
 *
 * The rung answers "what can this machine afford" in one verdict — pixels, the shadow
 * pass, the lamp budget, the horizon and the sky all move together. This axis answers the
 * one question that verdict cannot: how much of the world the player wants to see, given
 * what he has. A cell rebuild costs 13.0 ms at 1.5 km and 32.8 ms at 25 km, so the reach
 * is the expensive half of the picture and the half that a machine can be told to spend
 * differently — a workstation on battery, a laptop on a desk, a monitor that is suddenly
 * 4K. It SCALES the rung's authored horizon rather than replacing it, so every step is
 * still a distance the vista, the fog and the far plane were tuned at together.
 */
export type ViewDistanceAxis = 'near' | 'auto' | 'far';
export const VIEW_DISTANCE_AXES = ['near', 'auto', 'far'] as const;
/** `auto` is the rung's own authored pair; the other two are steps around it. */
const VIEW_DISTANCE_SCALES: Record<ViewDistanceAxis, number> = { near: 0.6, auto: 1, far: 1.5 };
/** Hard bounds on the scaled horizon, metres: below is a hallway, above is a rebuild storm. */
const HORIZON_MIN_M = 900;
const HORIZON_MAX_M = 32_000;

/**
 * HOW MUCH OF THE WORLD IS IN IT, as a third axis: the grass band and the reach of the
 * tree models.
 *
 * One step either side of the rung, clamped at the ends. Nothing here invents a number:
 * the vegetation tiers are authored per rung (`GRASS_TIERS`, the forest's own), and this
 * axis says which of them to use, so a machine that can afford its rung's pixels but not
 * its grass can have one without the other. The shadow pass stays with the rung, because
 * it is a whole second render of the world and a machine either affords it or does not.
 */
export type DetailAxis = 'low' | 'auto' | 'high';
export const DETAIL_AXES = ['low', 'auto', 'high'] as const;

/** The rung whose vegetation the detail axis asks for: one step either side, clamped. */
export function detailRungFor(quality: GraphicsQuality, detail: DetailAxis): GraphicsQuality {
  if (detail === 'auto') return quality;
  const ladder: readonly GraphicsQuality[] = ['acceptable', 'standard', 'blessing'];
  const step = detail === 'low' ? -1 : 1;
  const index = Math.min(ladder.length - 1, Math.max(0, ladder.indexOf(quality) + step));
  return ladder[index]!;
}

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
  /**
   * The desktop rung whose horizon and fog a phone presentation inherits.
   *
   * A phone's pixel cap does nothing for the vista, because the vista costs CPU terrain
   * sampling and that is set by RADIUS, not by how many pixels the screen has. Measured
   * on the vista with a 5950X: a cell rebuild costs 13.0 ms at 4 km, 17.3 ms at 8 km and
   * 32.8 ms at 25 km, and a phone core is slower than that — so the 25 km map is a
   * multi-frame hitch on every cell crossing. Naming an AUTHORED pair rather than
   * inventing a horizon keeps the fog the tuned one.
   */
  readonly mobileVista: GraphicsQuality;
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
   * How far the world is drawn before the fog dissolves it, metres.
   *
   * This is also the fog's whole scale: the air's far plane IS this distance
   * (render/look/fog.ts), so the horizon always dissolves exactly where the last hill
   * ends rather than at a second, separately tuned range.
   */
  readonly horizonM: number;
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
   * dark. Measured: the top rung's desktop budget is 18 spots plus 8 points, and a phone
   * presenting 1.44 megapixels at 50 FPS was evaluating 26 lights on every lit fragment —
   * 37 million light evaluations per frame, 1.9 billion per second. That is the heat.
   */
  readonly mobileVehicleLightSlots: number;
  /** The same, for the street-lamp pool. */
  readonly streetLightSlots: number;
  readonly mobileStreetLightSlots: number;
  /** Reach multiplier for a projected headlamp beam; the top rung throws light further. */
  readonly headlightDistanceScale: number;
}

/**
 * The rungs, weakest first. Read them as three machines, not three presets:
 *
 *  - `acceptable` — a phone, or a mini-PC on a television. No shadow pass, because it is
 *    the one cost that cannot be paid in pixels. The authored horizon.
 *  - `standard` — an ordinary desktop with a discrete GPU or a good integrated one.
 *    Native on a 1440p display, shadows on, 8 km of horizon.
 *  - `blessing` — a machine with headroom to spare. Supersamples, 25 km of horizon,
 *    and a sky deep enough to be crowded rather than plotted.
 *
 * A rung is a statement about the MACHINE, and a phone is two machines at once: the one
 * that draws the picture and the one that gets hot. Its pixel ceiling and its vista are
 * the first; its shadow pass and its frame rate are the second — and the second is the
 * player's, because no browser will tell the game how warm the phone is.
 */
export const GRAPHICS_TIERS: Record<GraphicsQuality, GraphicsTier> = {
  acceptable: {
    maxPixels: 1600 * 900,
    mobileMaxPixels: 960 * 540,
    minPixels: 1280 * 720,
    mobileMinPixels: 640 * 360,
    supersample: 1,
    shadows: false,
    msaa: false,
    mobileShadows: false,
    mobileVista: 'acceptable',
    starMagnitude: 7,
    mobileStarMagnitude: 7,
    horizonM: 1500,
    vehicleLightSlots: 2,
    mobileVehicleLightSlots: 2,
    streetLightSlots: 2,
    mobileStreetLightSlots: 2,
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
    mobileVista: 'standard',
    starMagnitude: 8,
    mobileStarMagnitude: 7.5,
    horizonM: 8000,
    vehicleLightSlots: 6,
    // A phone gets two thirds of the desktop budget here, not half: the desktop six keeps
    // three cars' lamps projected, which is the difference between traffic that reads as
    // traffic and traffic that is only a lens flare.
    mobileVehicleLightSlots: 4,
    streetLightSlots: 6,
    mobileStreetLightSlots: 4,
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
    mobileVista: 'standard',
    starMagnitude: 8.5,
    mobileStarMagnitude: 8,
    horizonM: 25000,
    // EIGHTEEN WAS A CLIFF, MEASURED. The lit-fragment shader costs almost nothing per
    // light up to about thirteen slots and then a great deal per light after them — same
    // scene, same pixels, on an M2 Pro at 2 Mpx: 11 slots 6.5 ms, 13 slots 7.5, 15 slots
    // 10.0, 19 slots 17.9, and 25-26 slots 53-78. This rung asked for 18 spots + 8 points
    // and so sat on the wrong side of that edge, which is why a machine that ran the
    // standard rung at 120 frames a second ran this one at 22-26. Spots are also the
    // dearer half — twelve spots alone cost 13.2 ms where twelve points cost 6.0 — so the
    // cut is taken out of the spots: eight keeps four cars' beams projected, and the lamp
    // pools stay at the standard rung's six, which with the eight spots is fourteen slots,
    // the most the loop takes before the cliff (tools/graphics-tiers.ts holds the rung to
    // it). The tier keeps everything else it was chosen for: the supersampling, the 25 km
    // horizon, the sky.
    vehicleLightSlots: 8,
    // Capped at the desktop STANDARD budget. A phone at 1.44 megapixels is not a desktop;
    // six spots and six points keep the lit road receding and three cars' beams drawn,
    // which is everything a phone screen can show anyway.
    mobileVehicleLightSlots: 6,
    streetLightSlots: 6,
    mobileStreetLightSlots: 6,
    headlightDistanceScale: 3,
  },
};

/**
 * The rung whose vista a presentation actually gets, which is not always its own: a
 * phone inherits the authored pair its rung names. See `GraphicsTier.mobileVista`.
 */
function vistaRungFor(quality: GraphicsQuality, mobilePresentation: boolean): GraphicsQuality {
  return mobilePresentation ? GRAPHICS_TIERS[quality].mobileVista : quality;
}

/** Convenience readers, so callers ask the question they mean. */
export function viewDistanceFor(quality: GraphicsQuality, mobilePresentation: boolean): number {
  return GRAPHICS_TIERS[vistaRungFor(quality, mobilePresentation)].horizonM;
}

/**
 * The horizon the PLAYER asked for: the rung's authored pair, scaled by the distance axis.
 *
 * Every caller that turns a horizon into metres — the renderer's far plane, the vista's
 * reach, the sky's fog scale and the launch's own quality walk — goes through here, so the
 * four can never disagree about where the world ends. `viewDistanceFor` remains the
 * authored number, which is what a rung MEANS.
 */
export function horizonMetresFor(
  quality: GraphicsQuality,
  mobilePresentation: boolean,
  axis: ViewDistanceAxis,
): number {
  const scaled = viewDistanceFor(quality, mobilePresentation) * VIEW_DISTANCE_SCALES[axis];
  return Math.round(Math.min(HORIZON_MAX_M, Math.max(HORIZON_MIN_M, scaled)));
}

/** Spotlight budget for vehicle lamps, as this presentation will compile it. */
export function vehicleLightSlotsFor(
  quality: GraphicsQuality,
  mobilePresentation: boolean,
): number {
  const tier = GRAPHICS_TIERS[quality];
  return mobilePresentation ? tier.mobileVehicleLightSlots : tier.vehicleLightSlots;
}

/** Street-lamp budget, as this presentation will compile it. */
export function streetLightSlotsFor(
  quality: GraphicsQuality,
  mobilePresentation: boolean,
): number {
  const tier = GRAPHICS_TIERS[quality];
  return mobilePresentation ? tier.mobileStreetLightSlots : tier.streetLightSlots;
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
/** A phone starts cool; a desktop starts uncapped, where its GPU is the constraint. */
export const DEFAULT_PHONE_FRAME_RATE = 30;

/**
 * Offered manual render scales, as a fraction of the DISPLAY's own pixels.
 *
 * Not a fraction of the rung: the rung's ceiling is what `Auto` decides to spend, and
 * a player overriding it is answering a different question — how many pixels do I want
 * for this window — which only has a meaning against the window. 100% is one
 * drawing-buffer pixel per device pixel; below that is the in-between a three-rung
 * ladder cannot offer; above it is supersampling, which used to be reachable only by
 * also buying a 25 km vista and eighteen headlamps.
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

/**
 * The languages the interface is written in.
 *
 * Russian because the road is Russian — the region, the signposts, the cars — and English
 * because that is how everyone else reads a driving game. Nothing else is offered: a third
 * language would be a third set of strings nobody in this project can proofread, and a
 * half-checked translation is worse than an honest menu in two tongues.
 */
export type Language = 'ru' | 'en';
export const LANGUAGES = ['ru', 'en'] as const;

/**
 * Units for every distance and speed the player reads.
 *
 * The simulation is always metres and km/h — this is a readout preference, and the only
 * place it lives is the formatting at the edge: the HUD's odometer and speed, the pause
 * screen's travelled distance, the save list. `mi` also takes the odometer to miles, which
 * is why it is a pair of factors rather than a label.
 */
export type Units = 'km' | 'mi';
export const UNITS = ['km', 'mi'] as const;
export const KILOMETRES_PER_MILE = 1.609344;
/** Distance readout factor: metres → the chosen unit. */
export const DISTANCE_UNITS_PER_METRE: Record<Units, number> = {
  km: 1 / 1000,
  mi: 1 / (1000 * KILOMETRES_PER_MILE),
};
/** Speed readout factor: km/h → the chosen unit. */
export const SPEED_UNITS_PER_KMH: Record<Units, number> = {
  km: 1,
  mi: 1 / KILOMETRES_PER_MILE,
};

/**
 * A weather to hold the sky at instead of the road's own spells, or `auto`.
 *
 * `auto` is the world's weather: spells of 6-22 km that the season decides (see
 * world/weather.ts), and the reason a drive across a hundred kilometres has weather in it
 * at all. The three fixed answers exist because "start me in the rain" is a thing a player
 * wants once and cannot get from a spell he has not driven into yet. They are the same
 * heights the world's own spell kinds use, so a forced sky is a sky the palette was
 * authored for. Snow is deliberately NOT offered: whether what falls is rain or snow is
 * the season's (`WeatherState.snowing`), and forcing snow in July would be a lie the rest
 * of the picture tells the truth about.
 */
export type WeatherForce = 'auto' | 'clear' | 'overcast' | 'rain';
export const WEATHER_FORCES = ['auto', 'clear', 'overcast', 'rain'] as const;

/** The channels a forced weather writes: `world/weather.ts`'s own spell heights. */
export const WEATHER_FORCE_CHANNELS: Record<
  Exclude<WeatherForce, 'auto'>,
  { overcast: number; precip: number; fog: number; wet: number }
> = {
  clear: { overcast: 0, precip: 0, fog: 0, wet: 0 },
  overcast: { overcast: 0.9, precip: 0, fog: 0.15, wet: 0 },
  rain: { overcast: 1, precip: 0.85, fog: 0.25, wet: 0.9 },
};

export interface Settings {
  gearboxMode: GearboxMode;
  /** Real minutes for one full day+night cycle. Clamped to [8, 128]. */
  dayCycleMinutes: number;
  /** Metres between POI slots. Clamped to 500..5000 in 100 m increments. */
  poiSpacingMetres: number;
  /**
   * Mouse-look radians per CSS pixel. Stored as a preference so pointer lock has
   * the same feel across sessions.
   */
  mouseSensitivity: number;
  /**
   * Volume of the synthesised game audio (engine, wind, tyres, foley), 0..1. The
   * radio has its own, because it is broadcast material at whatever level the
   * station mastered it and balancing it against the car is a taste decision.
   */
  masterVolume: number;
  /** Car-radio volume, 0..1. */
  radioVolume: number;
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
   * Purely cosmetic joke toggle: every car — the one driven and every traffic
   * car — hops in place like the viral "bouncing Yaris" clip. Applied only to
   * the visual root in Vehicle.syncVisuals; the chassis body, its collider and
   * the wheel suspension never move, so handling and physics are identical
   * whether this is on or off. Off by default; nobody should be surprised by it.
   */
  bouncyCars: boolean;
  /** Language of the menus, the settings and the HUD text the interface owns. */
  language: Language;
  /** Units for every distance and speed the player reads. */
  units: Units;
  /**
   * Volume of the interface sound bank, 0..1.
   *
   * Its own bus, because the menus exist before the car does: a click is the first sound
   * of a session, and somebody who has muted the engine has not necessarily asked for the
   * menus to go quiet — and the other way round.
   */
  uiVolume: number;
  /** A weather to hold the sky at, or `auto` for the road's own spells. */
  weather: WeatherForce;
  /** The rung's authored horizon, scaled. See `horizonMetresFor`. */
  viewDistance: ViewDistanceAxis;
  /** Grass band and tree-model reach, one step either side of the rung. */
  detail: DetailAxis;
}

export const DAY_CYCLE_MIN_MINUTES = GAMEPLAY_CONFIG.dayCycleMinutesMin;
export const DAY_CYCLE_MAX_MINUTES = GAMEPLAY_CONFIG.dayCycleMinutesMax;
export const POI_SPACING_MIN_METRES = GAMEPLAY_CONFIG.poiSpacingMetresMin;
export const POI_SPACING_MAX_METRES = GAMEPLAY_CONFIG.poiSpacingMetresMax;
export const POI_SPACING_STEP_METRES = GAMEPLAY_CONFIG.poiSpacingMetresStep;
export const DEFAULT_POI_SPACING_METRES = GAMEPLAY_CONFIG.poiSpacingMetres;

export const DEFAULT_MASTER_VOLUME = GAMEPLAY_CONFIG.defaultMasterVolume;
export const DEFAULT_RADIO_VOLUME = GAMEPLAY_CONFIG.defaultRadioVolume;
/**
 * Interface sounds start quieter than the game's own mix.
 *
 * A click is closer to the ear than an engine is, it happens while nothing else is
 * sounding, and it happens dozens of times in a row while somebody walks a settings page —
 * so the same number that suits a car would make the menu shout.
 */
export const DEFAULT_UI_VOLUME = 0.55;
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

/** Default day length in real minutes. */
const DEFAULT_DAY_CYCLE_MINUTES = GAMEPLAY_CONFIG.dayCycleMinutes;


export const DEFAULT_SETTINGS: Settings = {
  // Automatic by default: the gearbox is driver assist, not the game. Shifting by
  // hand stays one wheel notch away for anyone who wants it.
  gearboxMode: 'automatic',
  dayCycleMinutes: DEFAULT_DAY_CYCLE_MINUTES,
  poiSpacingMetres: DEFAULT_POI_SPACING_METRES,
  mouseSensitivity: DEFAULT_MOUSE_SENSITIVITY,
  masterVolume: DEFAULT_MASTER_VOLUME,
  radioVolume: DEFAULT_RADIO_VOLUME,
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
  // Uncapped by default: on a desktop the GPU is already the constraint, so a cap would
  // only cost smoothness. A phone's FIRST launch is set to 30 by main, which is the only
  // place that knows the presentation — see `DEFAULT_PHONE_FRAME_RATE`.
  frameRateLimit: null,
  fieldOfView: DEFAULT_FIELD_OF_VIEW,
  // Off by default; M switches it on, and the pause menu remembers which.
  preciseSteering: false,
  // Off by default; a joke should be opted into, not discovered mid-drive.
  bouncyCars: false,
  // Russian, because the road is: the region, the villages, the cars and the signs are all
  // Russian, and a menu in the language of the place is the most honest default this game
  // has. English is one pill away on the first-run card and in the settings.
  language: 'ru',
  units: 'km',
  uiVolume: DEFAULT_UI_VOLUME,
  // The road's own weather. See `WeatherForce`.
  weather: 'auto',
  // The rung's authored horizon. The axis exists for the machine that can afford a rung's
  // pixels but not its reach, and only its owner can say so.
  viewDistance: 'auto',
  detail: 'auto',
};

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
  const poiSpacingRaw =
    typeof obj.poiSpacingMetres === 'number' && Number.isFinite(obj.poiSpacingMetres)
      ? obj.poiSpacingMetres
      : DEFAULT_POI_SPACING_METRES;
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

  /** An offered value of a closed list, or the fallback. */
  const oneOf = <T extends string>(value: unknown, offered: readonly T[], fallback: T): T =>
    offered.find((option) => option === value) ?? fallback;

  const settings: Settings = {
    // Anything that is not exactly the automatic string is manual: the
    // historical mode, and the safe fallback for garbage input.
    gearboxMode: obj.gearboxMode === 'automatic' ? 'automatic' : 'manual',
    dayCycleMinutes: Math.min(DAY_CYCLE_MAX_MINUTES, Math.max(DAY_CYCLE_MIN_MINUTES, dayCycleRaw)),
    poiSpacingMetres:
      Math.round(
        Math.min(POI_SPACING_MAX_METRES, Math.max(POI_SPACING_MIN_METRES, poiSpacingRaw)) /
          POI_SPACING_STEP_METRES,
      ) * POI_SPACING_STEP_METRES,
    mouseSensitivity: Math.min(MOUSE_SENSITIVITY_MAX, Math.max(MOUSE_SENSITIVITY_MIN, sensitivityRaw)),
    masterVolume: unitInterval(obj.masterVolume, DEFAULT_MASTER_VOLUME),
    radioVolume: unitInterval(obj.radioVolume, DEFAULT_RADIO_VOLUME),
    keyBindings: {},
    // Anything unrecognised is standard, so an old save (which has no such field)
    // keeps the look it was made with.
    graphicsQuality:
      obj.graphicsQuality === 'acceptable' || obj.graphicsQuality === 'blessing'
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
    // is a property of the rendering rung now, and the two ladders do not line up: an old
    // save asking for `vast` on `acceptable` was a combination that should never have
    // been offerable, and there is no honest way to guess which half the player meant.
    // The tier they chose is the answer, and it is right there in the same object.
    // `eyeAdaptation` lived here once and is deliberately not migrated: exposure is
    // analytic now, so a stored preference has nothing left to select.
    // Preserve the old tier behavior once, then this becomes an independent choice.
    msaa:
      typeof obj.msaa === 'boolean'
        ? obj.msaa
        : obj.graphicsQuality !== 'acceptable',
    // Snap to an offered rate rather than clamping, so a hand-edited 31 or 999 cannot
    // become a frame rate the menu has no button for. `mobileFrameRate` is the phone-only
    // name this setting had first; reading it is how a save made before this change keeps
    // the cap its player chose instead of silently becoming uncapped and hot.
    frameRateLimit: frameRateLimitFrom(obj.frameRateLimit ?? obj.mobileFrameRate),
    // `mouseSteering` is the pre-precise-control name in existing saves. Read it once;
    // every newly sanitized Settings object writes only the truthful new field.
    preciseSteering: obj.preciseSteering === true || obj.mouseSteering === true,
    bouncyCars: obj.bouncyCars === true,
    // Every one of these is a closed list, so an unreadable value degrades to the authored
    // default rather than to whatever the string happened to be. `oneOf` rather than a
    // condition per field: an added option is then one entry in the list and nothing here.
    language: oneOf(obj.language, LANGUAGES, DEFAULT_SETTINGS.language),
    units: oneOf(obj.units, UNITS, DEFAULT_SETTINGS.units),
    uiVolume: unitInterval(obj.uiVolume, DEFAULT_UI_VOLUME),
    weather: oneOf(obj.weather, WEATHER_FORCES, DEFAULT_SETTINGS.weather),
    viewDistance: oneOf(obj.viewDistance, VIEW_DISTANCE_AXES, DEFAULT_SETTINGS.viewDistance),
    detail: oneOf(obj.detail, DETAIL_AXES, DEFAULT_SETTINGS.detail),
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
 * ONE KEY PER CATEGORY, and the categories are the settings pages. A single blob
 * meant a page could not be written, reset or discarded on its own: the crash guard
 * below has to drop the graphics choices and leave the rest alone, and a player who
 * resets one section must not lose his key bindings to the same write. Each category
 * is merged over `DEFAULT_SETTINGS` on the way in, so a field added to the schema
 * simply is not there in an existing store and the authored default applies — which is
 * what makes this format survive its own growth.
 *
 * Everything goes through `sanitizeSettings` on the way out, which already accepts
 * arbitrary JSON — so a corrupted or hand-edited entry degrades to defaults instead
 * of breaking the boot. Nothing here throws: a browser with storage disabled or a
 * full quota simply gets the old per-save behaviour back.
 */
export type SettingsCategory =
  | 'graphics'
  | 'display'
  | 'gameplay'
  | 'audio'
  | 'controls'
  | 'system';

export const SETTINGS_CATEGORIES: readonly SettingsCategory[] = [
  'gameplay',
  'graphics',
  'display',
  'audio',
  'controls',
  'system',
];

/**
 * Which fields each category owns, and therefore stores, merges and resets.
 *
 * Every field of `Settings` appears exactly once — the type assertion below refuses to
 * compile if one does not — because a field owned by no page would be invisible: it would
 * never be written, so it would come back as its default on the next launch, and the bug
 * would look like a setting that "does not stick".
 */
export const SETTINGS_CATEGORY_KEYS: Record<SettingsCategory, readonly (keyof Settings)[]> = {
  graphics: [
    'graphicsQuality',
    'graphicsQualitySource',
    'viewDistance',
    'detail',
    'renderScale',
    'msaa',
    'frameRateLimit',
  ],
  display: ['fieldOfView', 'mouseSensitivity', 'preciseSteering'],
  gameplay: ['gearboxMode', 'dayCycleMinutes', 'poiSpacingMetres', 'weather', 'bouncyCars'],
  audio: ['masterVolume', 'radioVolume', 'uiVolume'],
  controls: ['keyBindings'],
  system: ['language', 'units'],
};

/** A settings field that no category stores, which must not exist. */
type AssertNever<T extends never> = T;
export type EverySettingIsStored = AssertNever<
  Exclude<keyof Settings, (typeof SETTINGS_CATEGORY_KEYS)[SettingsCategory][number]>
>;

const SETTINGS_KEY_PREFIX = 'brodrive-settings-v2:';
/** The one-blob format this replaces. Read once, rewritten per category, then dropped. */
const LEGACY_SETTINGS_KEY = 'brodrive-settings-v1';
/**
 * Set when a drive starts booting, cleared when it reaches the road.
 *
 * The guard against a launch that never finishes. A settings value cannot usually break a
 * boot — but a horizon can: `far` on a machine that cannot rebuild a cell inside a frame
 * turns every cell crossing into a hitch, and the boot's own warm-up window is built at the
 * same scale, so a launch can spend its whole budget and never arrive. If this mark is
 * still standing when the next launch reads its preferences, the machine never got there,
 * and the one category that can cause that is dropped back to its defaults.
 */
const LOAD_MARK_KEY = 'brodrive-loading-v1';
/**
 * How long a load mark may stand before it is believed.
 *
 * The mark carries the moment the boot began, because a mark with no age cannot tell a
 * machine that never arrived from an ordinary reload: in development every file save
 * reloads the page mid-boot, and in play a player pressing F5 during the loading screen
 * looked exactly like a hang. Forty-five seconds is longer than any honest launch on the
 * slowest machine this game runs on and shorter than somebody sitting at a frozen screen,
 * so a young mark is simply cleared and an old one is acted on.
 */
const LOAD_MARK_GRACE_MS = 45_000;
/** Raised when the guard above fires, so the menu can say so once instead of silently. */
const GRAPHICS_RESET_KEY = 'brodrive-graphics-reset-v1';

/**
 * Marks a boot as begun. Called once the player has committed to a drive, never at the
 * title screen: sitting in a menu is not a launch, and it must not be read as a failed one.
 */
export function markLoadStarted(): void {
  try {
    localStorage.setItem(LOAD_MARK_KEY, String(Date.now()));
  } catch {
    // No storage: no guard, and no way to have stored a setting that needed one either.
  }
}

/** Marks the boot as arrived: the road is under the car and the cover has lifted. */
export function markLoadFinished(): void {
  try {
    localStorage.removeItem(LOAD_MARK_KEY);
  } catch {
    // See above.
  }
}

/** Whether the guard fired on this launch, reported once. */
export function takeGraphicsResetNotice(): boolean {
  try {
    const raised = localStorage.getItem(GRAPHICS_RESET_KEY) !== null;
    if (raised) localStorage.removeItem(GRAPHICS_RESET_KEY);
    return raised;
  } catch {
    return false;
  }
}

/** One category's stored fields, or null when that category has never been written. */
function readCategory(category: SettingsCategory): Record<string, unknown> | null {
  let json: string | null;
  try {
    json = localStorage.getItem(SETTINGS_KEY_PREFIX + category);
  } catch {
    return null;
  }
  if (json === null) return null;
  try {
    const parsed: unknown = JSON.parse(json);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    // A corrupted category costs that category its choices and nothing else. The keys are
    // dropped rather than left to fail again on every launch.
    try {
      localStorage.removeItem(SETTINGS_KEY_PREFIX + category);
    } catch {
      // Nothing to do; the read below is already the fallback.
    }
    return null;
  }
}

/** The stored preferences, or null if there are none or they cannot be read. */
export function loadStoredSettings(): Settings | null {
  const stored: Partial<Record<SettingsCategory, Record<string, unknown>>> = {};
  let storedCount = 0;
  for (const category of SETTINGS_CATEGORIES) {
    const fields = readCategory(category);
    if (fields === null) continue;
    stored[category] = fields;
    storedCount += 1;
  }

  let legacy: Record<string, unknown> | null = null;
  try {
    const json = localStorage.getItem(LEGACY_SETTINGS_KEY);
    if (json !== null) legacy = JSON.parse(json) as Record<string, unknown>;
  } catch {
    legacy = null;
  }

  // A legacy blob is read only into categories this browser has never written: once one
  // per-category key exists, that format is the truth and the old blob is stale.
  if (legacy !== null) {
    for (const category of SETTINGS_CATEGORIES) {
      if (stored[category] !== undefined) continue;
      const fields: Record<string, unknown> = {};
      for (const key of SETTINGS_CATEGORY_KEYS[category]) {
        if (key in legacy) fields[key] = legacy[key];
      }
      if (Object.keys(fields).length > 0) {
        stored[category] = fields;
        storedCount += 1;
      }
    }
  }

  let markAgeMs: number | null = null;
  try {
    const mark = localStorage.getItem(LOAD_MARK_KEY);
    if (mark !== null) {
      const startedAt = Number(mark);
      // A mark from a build that wrote a bare `1` has no age and is treated as old: it is
      // the one case where the guard cannot tell, and the failure it exists for is worse
      // than one spurious reset.
      markAgeMs = Number.isFinite(startedAt) ? Date.now() - startedAt : Number.POSITIVE_INFINITY;
    }
  } catch {
    markAgeMs = null;
  }
  const abandoned = markAgeMs !== null && markAgeMs > LOAD_MARK_GRACE_MS;
  if (storedCount === 0 && !abandoned) {
    // A young mark is a reload, not a failure: it is cleared so the next launch is judged on
    // its own, and nothing is repaired.
    if (markAgeMs !== null) {
      try {
        localStorage.removeItem(LOAD_MARK_KEY);
      } catch {
        // No storage, no guard, nothing to clear.
      }
    }
    return null;
  }

  if (abandoned) {
    // The previous launch never reached the road. The two choices that can cause that are the
    // rung and the reach — a rung this machine cannot afford, or a horizon it cannot rebuild a
    // cell inside — so those two go back to their defaults, which also re-arms the launch's own
    // measurement. Sharpness, smooth edges and the frame cap STAY: they cannot hang a boot,
    // they may have taken a player a while to get right, and a rescue that costs more than the
    // failure is not a rescue. The mark goes, so the next boot is judged on its own.
    const graphics = stored.graphics ?? {};
    graphics.graphicsQuality = DEFAULT_SETTINGS.graphicsQuality;
    // Explicitly `default` rather than absent: a missing source is read as `chosen` (that is
    // what an existing player's stored preferences mean), which would leave the launch with
    // no permission to measure this machine again — the one thing that can find a rung that
    // fits after the rung that did not.
    graphics.graphicsQualitySource = 'default';
    delete graphics.viewDistance;
    stored.graphics = graphics;
    try {
      localStorage.setItem(SETTINGS_KEY_PREFIX + 'graphics', JSON.stringify(graphics));
      localStorage.removeItem(LOAD_MARK_KEY);
      localStorage.setItem(GRAPHICS_RESET_KEY, '1');
    } catch {
      // No storage: the launched-for-this-session defaults still apply below.
    }
  }

  const raw: Record<string, unknown> = {};
  for (const category of SETTINGS_CATEGORIES) {
    const fields = stored[category];
    if (fields !== undefined) Object.assign(raw, fields);
  }
  const settings = sanitizeSettings(raw);

  // One write of the new format, then the old key goes: the migration happens once, and
  // the two copies cannot drift apart afterwards.
  if (legacy !== null) {
    storeSettings(settings);
    try {
      localStorage.removeItem(LEGACY_SETTINGS_KEY);
    } catch {
      // Left in place, it is simply ignored from now on: the per-category keys exist.
    }
  }
  return settings;
}

/** Mirrors preferences to browser storage. Called on every settings change. */
export function storeSettings(settings: Settings): void {
  for (const category of SETTINGS_CATEGORIES) {
    const fields: Record<string, unknown> = {};
    for (const key of SETTINGS_CATEGORY_KEYS[category]) fields[key] = settings[key];
    try {
      localStorage.setItem(SETTINGS_KEY_PREFIX + category, JSON.stringify(fields));
    } catch {
      // Storage disabled or full. Preferences still apply for this session; they
      // just will not outlive it, which is exactly the old behaviour.
    }
  }
}

/**
 * One category back to its authored defaults.
 *
 * The keys and the LANGUAGE stay: a player resetting the graphics page has not asked to be
 * spoken to in another tongue, and losing every binding with the volumes would make the
 * button one nobody dares press twice.
 */
export function resetSettingsCategory(
  settings: Settings,
  category: SettingsCategory,
): Settings {
  const next: Settings = { ...settings, keyBindings: { ...settings.keyBindings } };
  for (const key of SETTINGS_CATEGORY_KEYS[category]) {
    if (key === 'language' || key === 'keyBindings') continue;
    (next as unknown as Record<string, unknown>)[key] = DEFAULT_SETTINGS[key];
  }
  return next;
}
