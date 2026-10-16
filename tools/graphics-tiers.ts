/**
 * Graphics tiers: is the ladder coherent, and does a rung mean one thing?
 *
 *   npx tsx tools/graphics-tiers.ts
 *
 * Two properties, and both were false before this bench existed.
 *
 * MONOTONIC. Each rung must be strictly more expensive than the one below it, in every
 * budget it owns. A ladder with a rung that costs nothing more than the rung beneath it
 * is a control that does nothing, which is what the star depth was: limiting magnitude 8
 * on both of the lower rungs.
 *
 * EXACT. A rung's resolution is a frame height in lines, and the frame drawn is that
 * height on every display — not a percentage of the display. The old policy resolved the
 * resolution as a DISPLAY PERCENTAGE, so on any screen with a ratio of 1 — every 4K
 * television, every monitor at 100% scaling — every rung resolved to exactly 1.0 and the
 * tier decided nothing at all: a mini-PC and a workstation on the same television were
 * both asked to shade 8.29 megapixels, with a 5.8x cliff down to the only rung that had
 * a real budget.
 */

import {
  DEFAULT_SETTINGS,
  FRAME_RATE_LIMITS,
  frameRateLimitFrom,
  GRAPHICS_TIERS,
  presentationFpsFor,
  qualityPresetOf,
  RENDER_HEIGHTS,
  renderHeightDefault,
  sanitizeSettings,
  starMagnitudeFor,
  vehicleLightSlotsFor,
  viewDistanceFor,
  withQualityPreset,
  type GraphicsQuality,
  type Settings,
} from '../src/game/settings';
import { FIXED_DT } from '../src/core/physics';
import { MAX_STEPS_PER_FRAME } from '../src/core/loop';
import { renderPixelRatio } from '../src/core/renderer';
import { installAssetShim } from './assetshim';

installAssetShim();

const LADDER: readonly GraphicsQuality[] = ['acceptable', 'standard', 'blessing'];
const failures: string[] = [];

/** The screens this game is actually played on. */
const DISPLAYS: readonly { name: string; css: [number, number]; dpr: number; mobile: boolean }[] = [
  { name: 'mini-PC on a 4K television', css: [3840, 2160], dpr: 1, mobile: false },
  { name: 'mini-PC on a 1080p panel', css: [1920, 1080], dpr: 1, mobile: false },
  { name: 'retina laptop', css: [1512, 982], dpr: 2, mobile: false },
  { name: 'workstation on 4K', css: [3840, 2160], dpr: 1, mobile: false },
  { name: '1080p at 200% scaling', css: [1920, 1080], dpr: 2, mobile: false },
  { name: 'a phone', css: [904, 412], dpr: 3.5, mobile: true },
];

// --- 1. the ladder climbs -----------------------------------------------------
//
// TWO KINDS OF KEY, and the difference is the point of naming them. A COST key is what
// the rung spends, and it must climb strictly at every step or the rung above is not a
// purchase. A WILLINGNESS key is a threshold the rung is allowed to cross — how many
// lines it hands a phone, how far it throws a headlamp — and those may repeat,
// because the rungs differ in what they can afford long before they differ in what they
// will attempt.
const COST_KEYS = [
  'renderHeight',
  'starMagnitude',
  'mobileStarMagnitude',
  'vehicleLightSlots',
  'mobileVehicleLightSlots',
] as const;
const WILLINGNESS_KEYS = ['mobileRenderHeight', 'headlightDistanceScale', 'mirrorScale'] as const;

console.log('rung         lines   phone lines   stars   car lamps');
let previous: GraphicsQuality | null = null;
for (const quality of LADDER) {
  const tier = GRAPHICS_TIERS[quality];
  console.log(
    `${quality.padEnd(12)} ${String(tier.renderHeight).padStart(5)} ` +
      `${String(tier.mobileRenderHeight).padStart(13)} ` +
      `${tier.starMagnitude.toFixed(1).padStart(7)} ` +
      `${String(tier.vehicleLightSlots).padStart(11)}`,
  );

  if (tier.mobileRenderHeight > tier.renderHeight) {
    failures.push(`${quality}: a phone is handed more lines than a desktop`);
  }
  if (previous !== null) {
    const below = GRAPHICS_TIERS[previous];
    for (const key of COST_KEYS) {
      if (tier[key] <= below[key]) {
        failures.push(
          `${quality}.${key} is ${tier[key]}, not above ${previous}'s ${below[key]} — ` +
            `this rung costs nothing more than the one below it`,
        );
      }
    }
    for (const key of WILLINGNESS_KEYS) {
      if (tier[key] < below[key]) {
        failures.push(
          `${quality}.${key} is ${tier[key]}, below ${previous}'s ${below[key]} — a ` +
            `weaker rung must not be more generous`,
        );
      }
    }
  }
  previous = quality;
}

if (GRAPHICS_TIERS.acceptable.shadows) {
  failures.push('the weakest rung claims it can afford a shadow pass');
}

// --- 1b. a phone's rung buys sharpness, not heat ------------------------------
//
// A phone is two machines at once: the one that draws the picture and the one that gets
// hot. The rung owns the first. The second belongs to the player, because a browser
// exposes no thermal state for the game to read — and it must not be welded to the rung,
// or the only way off a blurry picture on a 1440p screen would be to accept 60 FPS of
// heat along with it.
{
  for (const quality of LADDER) {
    if (GRAPHICS_TIERS[quality].mobileShadows) {
      failures.push(
        `${quality}: a phone presentation still claims a shadow pass, which is a second ` +
          `render of the world and the largest sustained GPU cost a phone can be given`,
      );
    }
  }
  // The horizon is the CPU level's now (`viewDistanceFor`), and the phone cap moved
  // with it: 31.9 ms per cell rebuild at 25 km on a 5950X, and a phone core is slower.
  for (const load of ['low', 'medium', 'high'] as const) {
    const phone = viewDistanceFor(load, true);
    if (phone > viewDistanceFor('medium', false)) {
      failures.push(`CPU ${load}: a phone is handed the ${phone} m vista`);
    }
  }
}

// --- 1d. a phone is never asked for a desktop's per-pixel light loop ---------
//
// THE LARGEST PER-PIXEL COST IN THE GAME, and the one that hid best. Three compiles the
// light count into every lit material as an unrolled loop bound, so every lit fragment
// evaluates every slot — dark ones included, which is why unused lamps are held at an
// intensity of 1e-8 rather than switched off. The bill is PIXELS x SLOTS on every frame,
// and the only slots left are the car lamps; the point-light path went with the room
// lights. This is the check that a phone's share of them stays a phone's share.
{
  // A phone's ceiling. Six spots keeps three cars' beams drawn and the lit road receding,
  // which is all a phone screen resolves; more than the desktop standard budget is a
  // desktop's fill rate being spent on a phone's pixels.
  const PHONE_SPOT_CEILING = 12;
  for (const quality of LADDER) {
    const spots = vehicleLightSlotsFor(quality, true);
    if (spots > PHONE_SPOT_CEILING) {
      failures.push(
        `${quality}: a phone is asked to shade ${spots} spotlights per lit fragment, ` +
          `above the ${PHONE_SPOT_CEILING} ceiling`,
      );
    }
    // The phone budget must exist and be a real budget, never zero or missing: a rung that
    // shades no lights at all is a different picture, not a cheaper one.
    if (spots < 2) {
      failures.push(`${quality}: a phone gets ${spots} spots — too few to light a night`);
    }
    // And it must not simply echo the desktop column, or the cap is doing nothing.
    const desktop = GRAPHICS_TIERS[quality].vehicleLightSlots;
    if (quality !== 'acceptable' && spots >= desktop) {
      failures.push(
        `${quality}: a phone gets ${spots} lights against a desktop's ${desktop} — the cap does nothing here`,
      );
    }
  }
}

// --- 1e. the per-pixel bill, in numbers --------------------------------------
//
// Printed rather than asserted beyond the ceiling above, because it is the figure that
// makes the ceiling's reason legible: light evaluations per frame is pixels x slots, and
// nothing else in the game scales that way.
{
  const phone = DISPLAYS.find((display) => display.mobile)!;
  console.log(String.fromCharCode(10) + `phone light cost at each rung's own frame height, on ${phone.name}`);
  console.log('rung         pixels      slots   evaluations/frame   at 60 FPS');
  for (const quality of LADDER) {
    // The phone column throughout: the height a phone's preset gets is
    // `mobileRenderHeight`, and the slot count is the phone's own.
    const lines = GRAPHICS_TIERS[quality].mobileRenderHeight;
    const pixels = Math.floor((lines * phone.css[0]) / phone.css[1]) * lines;
    const slots = vehicleLightSlotsFor(quality, true);
    const perFrame = pixels * slots;
    console.log(
      `${quality.padEnd(12)} ${(pixels / 1e6).toFixed(2).padStart(6)} Mpx ${String(slots).padStart(7)} ` +
        `${(perFrame / 1e6).toFixed(1).padStart(15)} M ${(perFrame * 60 / 1e9).toFixed(2).padStart(9)} G/s`,
    );
  }
}

// --- 1c. the frame-rate cap is the player's, on every device ------------------
{
  for (const rate of FRAME_RATE_LIMITS) {
    if (!Number.isFinite(rate) || rate <= 0) failures.push(`offered frame rate ${rate} is not a rate`);
  }
  // The cap is the ONLY input, on every device: it is not derived from the tier, not
  // different by presentation, and `null` means uncapped. That is the whole point of it
  // being a setting — a phone's heat and a desktop's noise are the same knob.
  for (const rate of FRAME_RATE_LIMITS) {
    if (presentationFpsFor(rate) !== rate) {
      failures.push(`a cap of ${rate} FPS was not honoured`);
    }
  }
  if (presentationFpsFor(null) !== null) {
    failures.push('an uncapped request was capped');
  }

  // HOW LOW A CAP MAY GO, which is not a matter of taste. The loop simulates whole fixed
  // steps, up to MAX_STEPS_PER_FRAME of them in one frame, and cannot catch up more than
  // that: present slower than `simulationHz / MAX_STEPS_PER_FRAME` and the simulation falls
  // behind the clock instead of merely running slow. So no offered rate may be below it.
  const simulationHz = Math.round(1 / FIXED_DT);
  const lowestRate = simulationHz / MAX_STEPS_PER_FRAME;
  for (const rate of FRAME_RATE_LIMITS) {
    if (rate < lowestRate) {
      failures.push(
        `a cap of ${rate} FPS needs ${(simulationHz / rate).toFixed(1)} simulation steps per ` +
          `frame, above the ${MAX_STEPS_PER_FRAME} the loop can take — the simulation would ` +
          `fall behind the clock. The floor is ${lowestRate} FPS.`,
      );
    }
  }

  // And a hand-edited save cannot invent a rate the menu has no button for.
  checkRates();
}

function checkRates(): void {
  for (const rate of FRAME_RATE_LIMITS) {
    if (frameRateLimitFrom(rate) !== rate) failures.push(`a saved cap of ${rate} was not kept`);
  }
  for (const garbage of [31, 144.5, -1, 0, '60', Number.NaN, undefined, null]) {
    if (frameRateLimitFrom(garbage) !== null) {
      failures.push(`a saved cap of ${String(garbage)} became something other than uncapped`);
    }
  }
}

// --- 2. the frame is the height the player chose ---------------------------------
//
// Three things must hold, and each of them is a way the control could quietly stop
// being one:
//
//  - IT IS EXACT. A height drawn on a canvas tall enough for it is that many lines, on
//    every display at every device-pixel-ratio: three floors `cssHeight x ratio`, so a
//    ratio one ulp short draws 1079 lines and the menu says 1080.
//  - IT IS BOUNDED. Past a ratio of 2 more lines are not sharpness, so a short canvas
//    draws twice its CSS height, and the menu quotes that rather than the label.
//  - THE ROW MOVES. A taller choice never draws fewer lines than a shorter one.
console.log('\ndisplay                       height   ratio   drawn');
for (const display of DISPLAYS) {
  const [cssWidth, cssHeight] = display.css;
  let previousLines = 0;
  for (const height of RENDER_HEIGHTS) {
    const ratio = renderPixelRatio(height, cssHeight);
    const lines = Math.floor(cssHeight * ratio);
    console.log(
      `${display.name.padEnd(29)} ${`${height}p`.padStart(6)} ${ratio.toFixed(2).padStart(7)} `
        + `${`${Math.floor(cssWidth * ratio)}x${lines}`.padStart(11)}`,
    );
    const expected = Math.min(height, Math.floor(cssHeight * 2));
    if (lines !== expected) {
      failures.push(`${display.name} at ${height}p draws ${lines} lines, not ${expected}`);
    }
    if (lines < previousLines) {
      failures.push(`${display.name} at ${height}p draws fewer lines than the choice below it`);
    }
    previousLines = lines;
  }
}
// Every height a canvas could be, not just the listed displays: the ulp is per height.
for (let cssHeight = 300; cssHeight <= 2400; cssHeight++) {
  for (const height of RENDER_HEIGHTS) {
    const lines = Math.floor(cssHeight * renderPixelRatio(height, cssHeight));
    if (lines !== Math.min(height, Math.floor(cssHeight * 2))) {
      failures.push(`a ${cssHeight}-pixel canvas at ${height}p draws ${lines} lines`);
    }
  }
}

// AND NO CLIFF. The failure this whole bench was written for was a middle rung 5.8x the
// weakest on a 4K television, with nothing in between, so a machine that could not
// afford it had to fall all the way to the bottom. The rungs' own heights must keep every
// step within 4x in pixels, on a desktop and on a phone.
for (const mobile of [false, true]) {
  for (let i = 1; i < LADDER.length; i++) {
    const below = renderHeightDefault(LADDER[i - 1]!, mobile);
    const above = renderHeightDefault(LADDER[i]!, mobile);
    const ratio = (above * above) / (below * below);
    if (ratio > 4) {
      failures.push(
        `${mobile ? 'on a phone' : 'on a desktop'} ${LADDER[i]} draws ${ratio.toFixed(1)}x the `
          + `pixels of ${LADDER[i - 1]} (${above} lines against ${below}) — a rung is missing between them`,
      );
    }
  }
}

// --- 3. the quality preset ------------------------------------------------------
//
// The preset is not stored: it is read back off the values it sets. So every preset must
// read back as itself, the shipped defaults must be one (Medium), any one Advanced value
// moved off it must read as Custom, and an old stored preference must keep its values.
{
  for (const mobile of [false, true]) {
    for (const preset of ['very_low', 'low', 'medium', 'high'] as const) {
      const on = withQualityPreset(DEFAULT_SETTINGS, preset, 'chosen', mobile);
      if (qualityPresetOf(on, mobile) !== preset) failures.push(`the ${preset} preset does not read back as itself`);
      const offs: Partial<Settings>[] = [
        { viewDistance: preset === 'high' ? 'low' : 'high' },
        { trafficDensity: preset === 'high' ? 'low' : 'high' },
        { fxaa: !on.fxaa },
        { frameRateLimit: 60 },
        on.graphicsQuality === 'retro'
          ? { retroLines: 540 }
          : { renderHeight: RENDER_HEIGHTS.find((height) => height !== on.renderHeight)! },
      ];
      for (const off of offs) {
        if (qualityPresetOf({ ...on, ...off }, mobile) !== null) {
          failures.push(`${preset} with ${JSON.stringify(off)} still reads as the preset, not Custom`);
        }
      }
    }
  }
  if (qualityPresetOf(DEFAULT_SETTINGS, false) !== 'medium') failures.push('the shipped defaults are not the Medium preset');
  const old = sanitizeSettings(
    { graphicsQuality: 'blessing', viewDistance: 'low', trafficDensity: 'high', fxaa: false },
    false,
  );
  if (old.graphicsQuality !== 'blessing' || old.viewDistance !== 'low' || old.trafficDensity !== 'high' || old.fxaa) {
    failures.push('a stored mix of quality values was not kept as it was');
  }
  if (qualityPresetOf(old, false) !== null) failures.push('a stored mix of quality values reads as a preset');

  // A stored height the menu offers is kept; anything else — an old `renderScale`, a
  // hand-edited 1000 — lands on the rung's own height for the presentation, never on a
  // resolution the menu has no button for.
  for (const height of RENDER_HEIGHTS) {
    if (sanitizeSettings({ renderHeight: height }, false).renderHeight !== height) {
      failures.push(`a saved height of ${height} was not kept`);
    }
  }
  for (const mobile of [false, true]) {
    for (const stale of [{ renderScale: 1.5 }, { renderScale: null }, { renderHeight: 1000 }, {}]) {
      const migrated = sanitizeSettings({ graphicsQuality: 'blessing', ...stale }, mobile);
      if (migrated.renderHeight !== renderHeightDefault('blessing', mobile)) {
        failures.push(
          `${JSON.stringify(stale)} became ${migrated.renderHeight}p, not the rung's own `
            + `${renderHeightDefault('blessing', mobile)}p (${mobile ? 'phone' : 'desktop'})`,
        );
      }
    }
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.log(`  FAIL  ${failure}`);
  throw new Error(`${failures.length} graphics-tier checks failed`);
}
console.log(
  '\nthe ladder climbs at every rung, every frame is the height chosen for it, and '
    + 'every quality preset reads back',
);
