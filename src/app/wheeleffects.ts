/**
 * The ground effects one wheel contact leaves behind: a pooled tyre mark and, past the
 * slip floor, a spray of the surface's own dust or smoke.
 *
 * Built by the composition root with an explicit context, so the module holds no
 * reference to the boot closure it was lifted out of.
 */

import { SURFACES, type SurfaceType } from '../core/surfaces';
import type { WheelSpray } from '../render/wheelspray';
import { weather } from '../world/weather';
import type { SandTyreTracks } from '../render/tyretracks';
import type { Vehicle, WheelSprayState } from '../vehicle/vehicle';
import type { TrailerField } from '../vehicle/trailer';
import { TERRAIN_COLLIDER_SURFACE } from '../world/terrainmesh';
import type { Road } from '../world/road';
import type { Terrain } from '../world/terrain';

/**
 * Slip-speed floor for spray strength, m/s. Mirrors the tyre model's
 * SLIP_REFERENCE_MPS: a slip ratio is (ωr − v)/ref, so a wheel's surface speed
 * ωr ≈ v + slip·ref. Without the floor a held burnout (wheels spinning, chassis
 * still) reads zero speed and throws no tail.
 */
const SPRAY_REF_SPEED = 1.5;
/**
 * How much visible material a smoking tyre yields against a digging one.
 *
 * `SurfaceProps.dust` and `.smoke` say WHICH of the two a surface produces; this says
 * how much less there is of the second. A wheel scrubbing on asphalt makes a thin
 * wisp, a wheel spinning in sand makes a rooster tail, and the difference is close to
 * an order of magnitude once the emitter's own lower smoke rate is applied on top.
 */
const SPRAY_SMOKE_YIELD = 0.4;

/** Everything the per-wheel effects touch; held, never captured. */
export interface WheelEffectsContext {
  /** The sand/gravel particle pool every wheel flings into. */
  readonly spray: WheelSpray;
  /** The pooled mesh that retains the bounded recent route of marks. */
  readonly tracks: SandTyreTracks;
  /** Projects a terrain contact back onto the road frame to resolve its surface. */
  readonly road: Road;
  readonly terrain: Terrain;
  /** A trailer tyre disturbs sand through the same path as a car tyre. */
  readonly trailers: TrailerField;
}

/** The per-frame ground effects, bound to one world. */
export interface WheelEffects {
  /** Ages the spray pool and emits every wheel's mark and spray for one frame. */
  frame(driving: Vehicle | null, frameDt: number, activeS: number): void;
}

export function createWheelEffects(ctx: WheelEffectsContext): WheelEffects {
  /**
   * Resolves the exact surface beneath a terrain-collider contact. Tiles use one
   * collider registration while their field still contains sand, gravel and rock.
   */
  const wheelSurface = (ws: WheelSprayState, activeS: number): SurfaceType => {
    if (ws.surface !== TERRAIN_COLLIDER_SURFACE) return ws.surface;
    const p = ctx.road.project(ws.absoluteContactX, ws.absoluteContactZ, activeS);
    return ctx.terrain.surfaceFromFrame(ws.absoluteContactX, ws.absoluteContactZ, p.lateral, p.s);
  };

  /**
   * Leaves a pooled ground mark and throws spray from one wheel contact. Both effects
   * share the resolved surface so terrain projection is paid once per wheel.
   *
   * Tracks accept honest rolling contact on sand; slip only widens and darkens them.
   * Spray needs the tyre to be SLIDING, past the peak of its force curve (see
   * `WheelSprayState.slideSlip`): a tyre working at its best is not a wheelspin, and
   * throwing smoke there made every hard launch look like one.
   */
  const emit = (ws: WheelSprayState, frameDt: number, activeS: number): void => {
    if (!ws.inContact) {
      ctx.tracks.sample(ws, false);
      return;
    }
    const terrainContact = ws.surface === TERRAIN_COLLIDER_SURFACE;
    const surface = wheelSurface(ws, activeS);
    // The visible verge is the same loose ground mesh and should mark immediately at
    // the asphalt edge; its finer gravel/sand classification remains relevant to spray.
    ctx.tracks.sample(ws, terrainContact);
    const slip = ws.slideSlip;
    if (slip <= 0) return;

    const props = SURFACES[surface];

    // A tyre flings at its surface speed, not the chassis'. Chassis speed reads
    // zero during a held burnout (wheels spinning, car stationary), so floor it at
    // the slip speed: slip ratio is (ωr − v)/ref, so ωr ≈ v + slip·ref.
    const speed = Math.max(Math.abs(ws.forwardSpeed), slip * SPRAY_REF_SPEED);
    // A wet road does not smoke a tyre and wet sand does not fly (world/weather.ts).
    const dry = 1 - weather.wet;
    const smoke = props.smoke * dry;
    const raise = props.dust * (1 - 0.8 * weather.wet) + smoke * SPRAY_SMOKE_YIELD;
    const strength = raise * slip * speed;
    if (strength <= 0) return;
    ctx.spray.emit(
      ws.contactX,
      ws.contactY,
      ws.contactZ,
      ws.forwardX,
      ws.forwardZ,
      strength,
      (smoke * SPRAY_SMOKE_YIELD) / raise,
      frameDt,
    );
  };

  // Ground effects share one wheel report. Spray ages every frame; tracks retain the
  // bounded recent route. Nothing is emitted on a surface whose profile rejects it.
  //
  // Fed by the driven car AND every trailer: an unpowered or locked trailer tyre can
  // disturb sand exactly like a car tyre, and the shared state keeps both paths identical.
  const frame = (driving: Vehicle | null, frameDt: number, activeS: number): void => {
    ctx.spray.update(frameDt, activeS);
    if (driving) {
      for (const ws of driving.wheelSpray) emit(ws, frameDt, activeS);
    }
    ctx.trailers.forEachSpray((ws) => emit(ws, frameDt, activeS));
  };

  return { frame };
}
