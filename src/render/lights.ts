import * as THREE from 'three';

/**
 * GPU light budget.
 *
 * Forward rendering evaluates every visible light for every fragment, and the
 * compiled shader program is specialised on the number of lights present — so
 * the 28 point lights the streamer keeps alive (two per pole chunk plus the
 * homestead pair) cost 28 per-fragment evaluations even when most of them are
 * intensity 0 or hundreds of metres away. Setting `light.visible = false`
 * removes a light from three.js's render traversal entirely: it drops out of
 * both the per-fragment loop and the compiled program, which is the whole point
 * of this class.
 *
 * The scene graph is re-scanned at most a few times per second (point lights
 * only ever come from streamed chunks, and every light is born invisible — see
 * the chunk providers — so an unscanned light is simply not lit); the per-frame
 * work is distance compares over that cached array.
 */

/** Point lights kept on at night. Four covers the homestead pair plus the two
 * nearest lamp pools in one frame; beyond ~5 the per-fragment cost buys nothing
 * the eye can resolve, and every extra light also inflates the compiled program. */
const MAX_POINT_LIGHTS = 4;
/** Lights beyond this are never enabled — their decay spheres (34 m lamps, 16 m
 * house lights) cannot reach the camera's view from further away. */
const CUTOFF_DISTANCE = 45;
const CUTOFF_DISTANCE_SQ = CUTOFF_DISTANCE * CUTOFF_DISTANCE;
/** Seconds between scene re-scans. The chunk streamer is the only point-light
 * source, so this is a safety net rather than a hot path. */
const RE_SCAN_INTERVAL = 0.5;

export class LightBudget {
  private readonly scene: THREE.Scene;
  /** Cached point lights, refreshed by `rescan`. Never rebuilt per frame. */
  private readonly points: THREE.PointLight[] = [];
  /** Squared camera distance per cached light, this frame. Reused, no GC. */
  private readonly distSq: number[] = [];
  /** Selection marks for this frame (1 = enabled). Reused. */
  private chosen = new Uint8Array(0);
  /** 0 forces a re-scan on the first update, so lights built before the render
   * loop starts are picked up immediately. */
  private scanTimer = 0;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /** Re-collect the point-light list. Called by the periodic timer (and by the
   * caller on chunk changes), never per frame. */
  rescan(): void {
    this.points.length = 0;
    this.scene.traverse((obj) => {
      if ((obj as THREE.PointLight).isPointLight) this.points.push(obj as THREE.PointLight);
    });
  }

  /**
   * Per-frame budget. `nightFactor` is the existing day/night signal
   * (Sky.isNight, 0 or 1): while the sun is up no point light is visible at all,
   * leaving only the sun and the hemisphere in the fragment loop. At night only
   * the `MAX_POINT_LIGHTS` nearest lit lights within the cutoff stay enabled — a
   * light with intensity 0 (a lamp with no working fixture nearby) would cost
   * the loop and show nothing, so it is never chosen.
   */
  update(x: number, y: number, z: number, nightFactor: number, dt: number): void {
    this.scanTimer -= dt;
    if (this.scanTimer <= 0) {
      this.scanTimer = RE_SCAN_INTERVAL;
      this.rescan();
    }

    const count = this.points.length;
    if (count === 0) return;
    if (this.chosen.length < count) this.chosen = new Uint8Array(count);

    // Distance pass over the cached array — the only per-frame scene work.
    if (this.distSq.length < count) this.distSq.length = count;
    for (let i = 0; i < count; i++) {
      const p = this.points[i].position;
      const dx = p.x - x;
      const dy = p.y - y;
      const dz = p.z - z;
      this.distSq[i] = dx * dx + dy * dy + dz * dz;
    }

    if (nightFactor > 0) {
      // Greedy nearest-first selection: N×count compares on ≤30 lights is nothing.
      for (let k = 0; k < MAX_POINT_LIGHTS; k++) {
        let best = -1;
        let bestD = CUTOFF_DISTANCE_SQ;
        for (let i = 0; i < count; i++) {
          if (this.chosen[i] !== 0 || this.points[i].intensity <= 0) continue;
          const d = this.distSq[i];
          if (d <= bestD) {
            bestD = d;
            best = i;
          }
        }
        if (best < 0) break;
        this.chosen[best] = 1;
      }
    }

    // Apply visibility, writing only what changed.
    for (let i = 0; i < count; i++) {
      const want = nightFactor > 0 && this.chosen[i] === 1;
      const light = this.points[i];
      if (light.visible !== want) light.visible = want;
      if (this.chosen[i] !== 0) this.chosen[i] = 0;
    }
  }
}
