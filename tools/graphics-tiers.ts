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
  DEFAULT_PHONE_FRAME_RATE,
  FRAME_RATE_LIMITS,
  frameRateLimitFrom,
  GRAPHICS_TIERS,
  presentationFpsFor,
  RENDER_SCALES,
  renderScaleFrom,
  starMagnitudeFor,
  streetLightSlotsFor,
  vehicleLightSlotsFor,
  type GraphicsQuality,
} from '../src/game/settings';
import { FIXED_DT } from '../src/core/physics';
import { MAX_STEPS_PER_FRAME } from '../src/core/loop';
import { manualRenderScale, minimumScaleFor, offeredRenderScales, renderScaleFor } from '../src/core/renderer';
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
  'mobileVehicleLightSlots',
  'mobileStreetLightSlots',
] as const;
const WILLINGNESS_KEYS = ['supersample', 'headlightDistanceScale'] as const;
/**
 * THE DESKTOP LIGHTS ARE ONE BUDGET, AND IT HAS A CLIFF. Spots and points are evaluated by
 * the same lit-fragment loop, which costs almost nothing per light up to about fourteen
 * slots and a great deal per light past them (settings.ts, the `blessing` rung: 11 slots
 * 6.5 ms, 13 slots 7.5, 15 slots 10.0, 19 slots 17.9 on an M2 Pro at 2 Mpx). So a rung
 * must spend MORE lights than the one below it in total — not necessarily more of each
 * kind, which is how the top rung reached eighteen spots and ran at a quarter of the
 * speed — and no rung may cross the cliff.
 */
const DESKTOP_LIGHT_CLIFF = 14;

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
  if (tier.vehicleLightSlots + tier.streetLightSlots > DESKTOP_LIGHT_CLIFF) {
    failures.push(
      `${quality}: ${tier.vehicleLightSlots + tier.streetLightSlots} desktop light slots, past the ` +
        `${DESKTOP_LIGHT_CLIFF}-slot cliff`,
    );
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
    const lights = tier.vehicleLightSlots + tier.streetLightSlots;
    const lightsBelow = below.vehicleLightSlots + below.streetLightSlots;
    if (lights <= lightsBelow) {
      failures.push(
        `${quality}: ${lights} desktop light slots, not above ${previous}'s ${lightsBelow} — ` +
          `this rung lights nothing more than the one below it`,
      );
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

// --- 1c. the frame-rate cap is the player's, on every device ------------------
{
  for (const rate of FRAME_RATE_LIMITS) {
    if (!Number.isFinite(rate) || rate <= 0) failures.push(`offered frame rate ${rate} is not a rate`);
  }
  if (!FRAME_RATE_LIMITS.includes(DEFAULT_PHONE_FRAME_RATE)) {
    failures.push('the phone default is not one of the offered rates');
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

// --- 3. the manual render scale ------------------------------------------------
//
// The rung is three points and a machine is not three machines, so a player may name a
// fraction of his own display instead. Three things must hold, and each of them is a way
// the control could quietly stop being one:
//
//  - THE ROW THE MENU SHOWS MOVES. Every fraction the menu OFFERS must give strictly
//    more pixels than the one before it on that display. The absolute bound below
//    flattens the top of the list on a large screen — on a 4K television 125% and 150%
//    both land on the ceiling — so the offered row is derived from the display, and this
//    is the check that the derivation is doing its job rather than the list being
//    quietly presented as if it were.
//  - IT IS BOUNDED. Not by the rung, but by the top rung's ceiling, which is the most
//    this game ever draws on purpose. Without that bound 150% on a retina laptop asks
//    for 20 megapixels and the menu that would undo it is unreachable.
//  - 100% MEANS THE DISPLAY. One drawing-buffer pixel per device pixel, under the same
//    ratio cap the automatic policy uses, so the readout in the menu is a resolution
//    rather than a percentage of something unstated.
console.log('\ndisplay                       offered   scale     Mpx       ratio');
{
  const top = GRAPHICS_TIERS.blessing;
  for (const display of DISPLAYS) {
    const cssPixels = display.css[0] * display.css[1];
    const bound = (display.mobile ? top.mobileMaxPixels : top.maxPixels) / 1e6;
    const offered = offeredRenderScales(cssPixels, display.dpr, display.mobile);
    let previous = 0;
    for (const fraction of RENDER_SCALES) {
      const shown = offered.includes(fraction);
      const ratio = manualRenderScale(cssPixels, display.dpr, display.mobile, fraction);
      const rendered = (cssPixels * ratio * ratio) / 1e6;
      console.log(
        `${display.name.padEnd(29)} ${(shown ? 'yes' : 'no').padStart(7)} `
          + `${`${Math.round(fraction * 100)}%`.padStart(5)} `
          + `${rendered.toFixed(2).padStart(7)} ${ratio.toFixed(2).padStart(11)}`,
      );
      if (rendered > bound * 1.001) {
        failures.push(
          `${display.name} at ${Math.round(fraction * 100)}% renders ${rendered.toFixed(2)} Mpx, `
            + `past the ${bound.toFixed(2)} Mpx the top rung would ever draw`,
        );
      }
      if (!shown) continue;
      // Equal is the failure: a clamped pair offered as two buttons has one outcome.
      if (rendered <= previous) {
        failures.push(
          `${display.name} offers ${Math.round(fraction * 100)}% at ${rendered.toFixed(2)} Mpx, `
            + `no more than the previous offered choice's ${previous.toFixed(2)} — two buttons, `
            + 'one result',
        );
      }
      previous = rendered;
    }
    if (offered.length === 0) {
      failures.push(`${display.name} is offered no manual render scale at all`);
    }
  }

  // A stored choice the display would clamp is still shown, or the player cannot see
  // which button he is on after carrying his preferences to a bigger screen.
  {
    const cssPixels = 3840 * 2160;
    const offered = offeredRenderScales(cssPixels, 1, false);
    const withCurrent = offeredRenderScales(cssPixels, 1, false, 1.5);
    if (offered.includes(1.5)) {
      failures.push('a 4K television offers both 125% and 150%, which resolve to the same pixels');
    }
    if (!withCurrent.includes(1.5)) {
      failures.push('a stored 150% is not shown on a display that clamps it — nothing is selected');
    }
  }

  // 100% is the display's own pixels, capped the way the automatic policy caps them.
  for (const display of DISPLAYS) {
    const cssPixels = display.css[0] * display.css[1];
    const ratio = manualRenderScale(cssPixels, display.dpr, display.mobile, 1);
    const expected = Math.min(
      display.dpr,
      2,
      Math.sqrt((display.mobile ? top.mobileMaxPixels : top.maxPixels) / cssPixels),
    );
    if (Math.abs(ratio - expected) > 1e-9) {
      failures.push(
        `${display.name} at 100% resolves ${ratio.toFixed(3)} rather than the display's own `
          + `${expected.toFixed(3)}`,
      );
    }
  }

  // And a hand-edited preferences file cannot invent a fraction the menu has no button
  // for: an unreachable resolution is one the player cannot get back from.
  for (const fraction of RENDER_SCALES) {
    if (renderScaleFrom(fraction) !== fraction) {
      failures.push(`a saved render scale of ${fraction} was not kept`);
    }
  }
  for (const garbage of [0.33, 2, 0, -1, '1', Number.NaN, undefined, null]) {
    if (renderScaleFrom(garbage) !== null) {
      failures.push(`a saved render scale of ${String(garbage)} became something other than Auto`);
    }
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.log(`  FAIL  ${failure}`);
  throw new Error(`${failures.length} graphics-tier checks failed`);
}
console.log(
  '\nthe ladder climbs at every rung, no display can talk a rung past its budget, and '
    + 'every render scale the menu offers is a different picture',
);
