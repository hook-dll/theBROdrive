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
 * BOUNDED. A display may never talk a rung into more pixels than that rung's budget, on
 * any display, at any device-pixel-ratio. The old policy resolved the resolution as a
 * DISPLAY PERCENTAGE, so on any screen with a ratio of 1 — every 4K television, every
 * monitor at 100% scaling — every rung resolved to exactly 1.0 and the tier decided
 * nothing at all: a mini-PC and a workstation on the same television were both asked to
 * shade 8.29 megapixels, with a 5.8x cliff down to the only rung that had a real budget.
 */

import {
  DEFAULT_MOBILE_FRAME_RATE,
  GRAPHICS_TIERS,
  MOBILE_FRAME_RATES,
  presentationFpsFor,
  starMagnitudeFor,
  streetLightSlotsFor,
  vehicleLightSlotsFor,
  type GraphicsQuality,
} from '../src/game/settings';
import { minimumScaleFor, renderScaleFor } from '../src/core/renderer';
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
// purchase. A WILLINGNESS key is a threshold the rung is allowed to cross — how far past
// the display it will supersample, how far it throws a headlamp — and those may repeat,
// because the rungs differ in what they can afford long before they differ in what they
// will attempt.
const COST_KEYS = [
  'maxPixels',
  'mobileMaxPixels',
  'minPixels',
  'mobileMinPixels',
  'starMagnitude',
  'mobileStarMagnitude',
  'horizonM',
  'vehicleLightSlots',
  'mobileVehicleLightSlots',
  'streetLightSlots',
  'mobileStreetLightSlots',
] as const;
const WILLINGNESS_KEYS = ['supersample', 'headlightDistanceScale'] as const;

console.log('rung         Mpx ceiling   Mpx floor   horizon   stars   car lamps   street lamps');
let previous: GraphicsQuality | null = null;
for (const quality of LADDER) {
  const tier = GRAPHICS_TIERS[quality];
  console.log(
    `${quality.padEnd(12)} ${(tier.maxPixels / 1e6).toFixed(2).padStart(11)} ` +
      `${(tier.minPixels / 1e6).toFixed(2).padStart(11)} ` +
      `${String(tier.horizonM).padStart(9)} ${tier.starMagnitude.toFixed(1).padStart(7)} ` +
      `${String(tier.vehicleLightSlots).padStart(11)} ${String(tier.streetLightSlots).padStart(14)}`,
  );

  if (tier.minPixels >= tier.maxPixels) {
    failures.push(`${quality}: the adaptive floor is at or above its own ceiling`);
  }
  if (tier.mobileMinPixels >= tier.mobileMaxPixels) {
    failures.push(`${quality}: the mobile floor is at or above its own ceiling`);
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
for (const quality of LADDER) {
  const tier = GRAPHICS_TIERS[quality];
  if (!tier.shadows && tier.msaa === false && tier.shadows !== false) {
    failures.push(`${quality}: nonsensical shadow/MSAA combination`);
  }
}

// --- 1b. a phone's rung buys sharpness, not heat ------------------------------
//
// A phone is two machines at once: the one that draws the picture and the one that gets
// hot. The rung owns the first. The second belongs to the player, because a browser
// exposes no thermal state for the game to read — and it must not be welded to the rung,
// or the only way off a blurry picture on a 1440p screen would be to accept 60 FPS of
// heat along with it.
{
  const measuredCellLoadMs: Record<string, number> = { acceptable: 13.0, standard: 17.3, blessing: 31.9 };
  for (const quality of LADDER) {
    const tier = GRAPHICS_TIERS[quality];
    if (tier.mobileShadows) {
      failures.push(
        `${quality}: a phone presentation still claims a shadow pass, which is a second ` +
          `render of the world and the largest sustained GPU cost a phone can be given`,
      );
    }
    const vista = GRAPHICS_TIERS[tier.mobileVista];
    if (vista.horizonM > GRAPHICS_TIERS.blessing.horizonM) {
      failures.push(`${quality}: a phone inherits a vista beyond the strongest rung's own`);
    }
    if (vista.horizonM > GRAPHICS_TIERS.standard.horizonM) {
      failures.push(
        `${quality}: a phone inherits the ${vista.horizonM} m vista ` +
          `(${measuredCellLoadMs[tier.mobileVista] ?? '?'} ms per cell rebuild measured on a ` +
          `5950X, and a phone core is slower) — no phone is handed that map`,
      );
    }
    // The vista a phone gets must still be a real, authored pair: an unknown name would
    // silently fall through to `undefined` metres and draw nothing.
    if (!Number.isFinite(vista.horizonM) || vista.horizonM <= 0) {
      failures.push(`${quality}: mobileVista "${tier.mobileVista}" is not a rung`);
    }
  }
}

// --- 1d. a phone is never asked for a desktop's per-pixel light loop ---------
//
// THE LARGEST PER-PIXEL COST IN THE GAME, and the one that hid best. Three compiles the
// light count into every lit material as an unrolled loop bound, so every lit fragment
// evaluates every slot — dark ones included, which is why unused lamps are held at an
// intensity of 1e-8 rather than switched off. The bill is PIXELS x SLOTS on every frame,
// and the top rung's desktop budget is 18 spotlights plus 8 point lights, which on a phone
// presenting 1.44 megapixels at 50 FPS came to 37 million light evaluations per frame and
// 1.9 BILLION per second. That was, measurably, where the heat was.
{
  // A phone's ceiling. Six spots and six points keeps three cars' beams drawn and the lit
  // road receding, which is all a phone screen resolves; more than the desktop standard
  // budget is a desktop's fill rate being spent on a phone's pixels.
  const PHONE_LIGHT_CEILING = 12;
  for (const quality of LADDER) {
    const spots = vehicleLightSlotsFor(quality, true);
    const points = streetLightSlotsFor(quality, true);
    const total = spots + points;
    if (total > PHONE_LIGHT_CEILING) {
      failures.push(
        `${quality}: a phone is asked to shade ${spots} spotlights + ${points} point lights ` +
          `= ${total} per lit fragment, above the ${PHONE_LIGHT_CEILING} ceiling`,
      );
    }
    if (spots % 2 !== 0 || points % 2 !== 0) {
      failures.push(`${quality}: a phone's light budget is not even, so it cannot split by direction`);
    }
    // The phone budget must exist and be a real budget, never zero or missing: a rung that
    // shades no lights at all is a different picture, not a cheaper one.
    if (spots < 2 || points < 2) {
      failures.push(`${quality}: a phone gets ${spots} spots and ${points} points — too few to light a night`);
    }
    // And it must not simply echo the desktop column, or the cap is doing nothing.
    const desktop = GRAPHICS_TIERS[quality].vehicleLightSlots + GRAPHICS_TIERS[quality].streetLightSlots;
    if (quality !== 'acceptable' && total >= desktop) {
      failures.push(
        `${quality}: a phone gets ${total} lights against a desktop's ${desktop} — the cap does nothing here`,
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
  console.log(String.fromCharCode(10) + 'phone light cost at the pixel ceiling each rung gives a phone');
  console.log('rung         pixels      slots   evaluations/frame   at 60 FPS');
  for (const quality of LADDER) {
    const tier = GRAPHICS_TIERS[quality];
    // The phone column throughout: the pixel ceiling a phone gets is `mobileMaxPixels`,
    // and the slot count is the phone's own.
    const pixels = tier.mobileMaxPixels;
    const slots = vehicleLightSlotsFor(quality, true) + streetLightSlotsFor(quality, true);
    const perFrame = pixels * slots;
    console.log(
      `${quality.padEnd(12)} ${(pixels / 1e6).toFixed(2).padStart(6)} Mpx ${String(slots).padStart(7)} ` +
        `${(perFrame / 1e6).toFixed(1).padStart(15)} M ${(perFrame * 60 / 1e9).toFixed(2).padStart(9)} G/s`,
    );
  }
}

// --- 1c. the frame-rate cap is offered, never derived -------------------------
{
  for (const rate of MOBILE_FRAME_RATES) {
    if (!Number.isFinite(rate) || rate <= 0) failures.push(`offered frame rate ${rate} is not a rate`);
  }
  if (!MOBILE_FRAME_RATES.includes(DEFAULT_MOBILE_FRAME_RATE)) {
    failures.push('the default frame rate is not one of the offered rates');
  }
  // A desktop presents uncapped: there is no battery to protect and the adaptive
  // controller already holds the GPU at its target by moving resolution.
  if (presentationFpsFor(false, DEFAULT_MOBILE_FRAME_RATE) !== null) {
    failures.push('a desktop presentation was given a frame-rate cap');
  }
  for (const rate of MOBILE_FRAME_RATES) {
    if (presentationFpsFor(true, rate) !== rate) {
      failures.push(`a phone asked for ${rate} FPS and did not get it`);
    }
  }
}

// --- 2. no display can exceed a rung's budget ---------------------------------
console.log('\ndisplay                       rung         scale   Mpx rendered   Mpx ceiling');
for (const display of DISPLAYS) {
  const cssPixels = display.css[0] * display.css[1];
  for (const quality of LADDER) {
    const tier = GRAPHICS_TIERS[quality];
    const ceiling = (display.mobile ? tier.mobileMaxPixels : tier.maxPixels) / 1e6;
    const scale = renderScaleFor(quality, cssPixels, display.dpr, display.mobile);
    const rendered = (cssPixels * scale * scale) / 1e6;
    console.log(
      `${display.name.padEnd(29)} ${quality.padEnd(12)} ${scale.toFixed(2).padStart(5)} ` +
        `${rendered.toFixed(2).padStart(14)} ${ceiling.toFixed(2).padStart(14)}`,
    );

    // A tenth of a per cent covers the ceiling being expressed as whole pixels.
    if (rendered > ceiling * 1.001) {
      failures.push(
        `${display.name} on ${quality} renders ${rendered.toFixed(2)} Mpx against a ` +
          `${ceiling.toFixed(2)} Mpx ceiling`,
      );
    }
    const floor = minimumScaleFor(quality, cssPixels, display.dpr, display.mobile);
    if (floor > 1) {
      failures.push(`${display.name} on ${quality} floors above full resolution`);
    }
    if (floor <= 0) {
      failures.push(`${display.name} on ${quality} has no resolution floor at all`);
    }
  }
}

// AND THE REGRESSION THIS EXISTS FOR. A display whose ratio is 1 must still be told
// apart by the rung: if the weakest and the strongest rung cost the same on a 4K
// television, the tier has stopped being a control.
{
  const cssPixels = 3840 * 2160;
  const lowest = renderScaleFor('acceptable', cssPixels, 1, false);
  const middle = renderScaleFor('standard', cssPixels, 1, false);
  const highest = renderScaleFor('blessing', cssPixels, 1, false);
  if (!(lowest < middle * 0.95)) {
    failures.push(
      `on a 4K television the weakest rung renders ${(lowest * lowest * cssPixels / 1e6).toFixed(2)} Mpx ` +
        `against the middle rung's ${(middle * middle * cssPixels / 1e6).toFixed(2)} — no headroom to give away`,
    );
  }
  if (!(highest >= middle)) {
    failures.push('the strongest rung is not at least the middle one on a 4K television');
  }
}

// AND NO CLIFF. The failure this whole bench was written for was not that two rungs were
// equal — it was that the middle rung was 5.8x the weakest on a 4K television, with
// nothing in between, so a machine that could not afford the middle rung had to fall all
// the way to the bottom.
//
// The bound is 4x rather than tighter because the TOP rung is allowed to be extravagant:
// it supersamples, it is chosen deliberately, and nothing is ever forced onto it. What
// must not happen is a gap in the range a weak machine has to choose from, and a gap of
// 5.8x in that range is exactly what this reports.
{
  const cssPixels = 3840 * 2160;
  const loadOf = (quality: GraphicsQuality): number => {
    const scale = renderScaleFor(quality, cssPixels, 1, false);
    return cssPixels * scale * scale;
  };
  for (let i = 1; i < LADDER.length; i++) {
    const below = loadOf(LADDER[i - 1]!);
    const above = loadOf(LADDER[i]!);
    const ratio = above / below;
    if (ratio > 4) {
      failures.push(
        `on a 4K television ${LADDER[i]} costs ${ratio.toFixed(1)}x ${LADDER[i - 1]} ` +
          `(${(above / 1e6).toFixed(2)} Mpx against ${(below / 1e6).toFixed(2)}) — a rung ` +
          `is missing between them`,
      );
    }
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.log(`  FAIL  ${failure}`);
  throw new Error(`${failures.length} graphics-tier checks failed`);
}
console.log(
  '\nthe ladder climbs at every rung, and no display can talk a rung past its budget',
);
