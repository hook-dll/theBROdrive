/**
 * The cutscene's own screen: a black fade and a credits roll, above everything the
 * game draws.
 *
 * WHY DOM AND NOT THE HUD. The HUD owns gameplay readouts and is hidden wholesale
 * during the death sequence (`#ui.is-death-sequence`), which is exactly the state a
 * cutscene puts the player in — so a fade drawn by the HUD would vanish with it. This
 * layer lives on `document.body` at z-index 40, above the HUD and above the main menu
 * (30) and the launch cover (35), and it is the last thing on screen before a reload.
 *
 * Nothing here reads game state: the caller says how dark the screen should be and
 * how long to take, and what lines to roll. Styles are set inline so the overlay owns
 * no stylesheet of its own and cannot collide with ui/hud.css.
 */

/** Above the HUD, the main menu (30) and the launch cover (35). */
const Z_INDEX = 40;
/** How long a freshly revealed credits roll takes to appear, seconds. */
const CREDITS_FADE_S = 0.9;

function smoothstep(t: number): number {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return x * x * (3 - 2 * x);
}

export class StoryOverlay {
  private readonly root: HTMLDivElement;
  private readonly fadeEl: HTMLDivElement;
  private readonly creditsEl: HTMLDivElement;
  private readonly timers = new Set<number>();
  private creditsFrame = 0;
  private disposed = false;

  constructor(parent: HTMLElement = document.body) {
    this.root = document.createElement('div');
    this.root.className = 'story-overlay';
    this.root.style.cssText = [
      'position:fixed',
      'inset:0',
      'z-index:' + Z_INDEX,
      'pointer-events:none',
      'overflow:hidden',
    ].join(';');

    this.fadeEl = document.createElement('div');
    this.fadeEl.className = 'story-overlay-fade';
    this.fadeEl.style.cssText = [
      'position:absolute',
      'inset:0',
      'background:#000',
      'opacity:0',
    ].join(';');

    this.creditsEl = document.createElement('div');
    this.creditsEl.className = 'story-overlay-credits';
    this.creditsEl.style.cssText = [
      'position:absolute',
      'left:0',
      'right:0',
      'top:0',
      'display:flex',
      'flex-direction:column',
      'align-items:center',
      'gap:1.15em',
      'font:500 clamp(17px,2.5vw,32px)/1.45 system-ui,sans-serif',
      'color:#f3f0e7',
      'text-align:center',
      'text-shadow:0 2px 14px rgba(0,0,0,0.85)',
      'opacity:0',
      'will-change:transform,opacity',
    ].join(';');

    this.root.append(this.fadeEl, this.creditsEl);
    parent.appendChild(this.root);
  }

  /** Fades the black layer to `opacity` (0..1) over `seconds`. */
  fadeTo(opacity: number, seconds: number): Promise<void> {
    if (this.disposed) return Promise.resolve();
    const target = opacity < 0 ? 0 : opacity > 1 ? 1 : opacity;
    const duration = Math.max(0, seconds);
    this.fadeEl.style.transition = `opacity ${duration}s linear`;
    // A zero-length transition must not be coalesced with the previous value by the
    // style engine, so the reflow is forced before the new opacity is written.
    void this.fadeEl.offsetHeight;
    this.fadeEl.style.opacity = String(target);
    if (duration <= 0) return Promise.resolve();
    return this.delay(duration * 1000 + 40);
  }

  /**
   * Rolls one column of lines up the screen over `seconds`, fading in as it starts.
   * The roll is driven by rAF so it stays smooth while the cutscene keeps rendering.
   */
  showCredits(lines: readonly string[], seconds: number): Promise<void> {
    if (this.disposed) return Promise.resolve();
    this.creditsEl.replaceChildren();
    lines.forEach((line, index) => {
      const row = document.createElement('div');
      row.textContent = line;
      row.style.cssText = index === 0
        ? 'font-size:1.6em;letter-spacing:0.12em;text-transform:uppercase'
        : 'opacity:0.92';
      this.creditsEl.appendChild(row);
    });
    const span = Math.max(1, seconds) * 1000;
    const height = this.root.clientHeight || window.innerHeight || 720;
    const start = performance.now() + CREDITS_FADE_S * 1000 / 2;
    cancelAnimationFrame(this.creditsFrame);
    return new Promise<void>((resolve) => {
      const step = (): void => {
        if (this.disposed) {
          resolve();
          return;
        }
        const now = performance.now();
        const t = Math.max(0, (now - start) / span);
        // From a full screen below the fold to a full screen above it, so the first
        // line rises into view and the last one leaves it.
        const bottom = height;
        const travel = -(height + this.creditsEl.offsetHeight);
        this.creditsEl.style.transform = `translate3d(0, ${bottom + smoothstep(t) * travel}px, 0)`;
        this.creditsEl.style.opacity = String(smoothstep((now - start) / (CREDITS_FADE_S * 1000)));
        if (t >= 1) {
          resolve();
          return;
        }
        this.creditsFrame = requestAnimationFrame(step);
      };
      this.creditsFrame = requestAnimationFrame(step);
    });
  }

  /** Removes the layer and cancels anything still running. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.creditsFrame);
    for (const timer of this.timers) window.clearTimeout(timer);
    this.timers.clear();
    this.root.remove();
  }

  private delay(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const timer = window.setTimeout(() => {
        this.timers.delete(timer);
        resolve();
      }, ms);
      this.timers.add(timer);
    });
  }
}
