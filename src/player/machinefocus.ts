import * as THREE from 'three';
import type { FoleyEvent } from '../audio/foley';
import type { InputFrame, InputReader } from '../core/input';
import type { CameraRig } from '../render/cameras';
import type { FixtureContext, FixtureField, FixtureFocus, WorldFixture } from '../world/fixturefield';
import type { WorldOrigin } from '../world/origin';

/** Seconds the camera takes to step up to a machine, and back. */
const BLEND_S = 0.45;
/** Wheel travel, in the reader's normalised units, that turns one card. */
const WHEEL_NOTCH = 1;

/**
 * WORKING A MACHINE UP CLOSE (world/cardmachine.ts): F on a fixture with a `focus` hands
 * it here. The camera eases from the player's eyes to the machine's own framing, the
 * pointer lock is let go so the cursor is the hand, and the player stands still:
 *  - the cursor's ray is the eye ray the interaction picks with (`ray`), so what is under
 *    the cursor is what the prompt names and a click works it, as F would;
 *  - a press on a part that takes the hand (`WorldFixture.grab`, the crank) drags it
 *    instead, until the button is let go; the wheel turns it a click at a time;
 *  - Escape, the right button or a step away (a movement key) let go of it, and the
 *    camera eases back to the eyes; so does the machine itself once it has dropped
 *    something into its tray (`FixtureContext.stepBack`).
 *
 * A money machine (`WorldFixture.purseSeat`) takes the purse into its slot for as long as
 * it is framed (`onFramed`; main.ts seats render/purse.ts), and gives it back on leaving.
 *
 * Nothing pauses: the world runs on while the player works the machine.
 */
export class MachineFocus {
  private fixtureId: string | null = null;
  private fixture: WorldFixture | null = null;
  private leaving = false;
  /** 0 at the eyes, 1 at the machine. */
  private weight = 0;
  private pose: FixtureFocus | null = null;
  /** The cursor in normalised device coordinates. */
  private readonly ndc = new THREE.Vector2();
  private readonly raycaster = new THREE.Raycaster();
  private downPending = false;
  private upPending = false;
  private mouseHeld = false;
  private grabbing = false;
  private wheel = 0;
  /** While a part is held: the cursor's angle round its axle on screen, last tick. */
  private gripAngle: number | null = null;
  private readonly pivotNdc = new THREE.Vector3();
  /** This tick's cursor ray, relative frame. */
  private readonly rayDir = new THREE.Vector3(0, 0, 1);
  private readonly eye = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private readonly footEye = new THREE.Vector3();
  private readonly footLook = new THREE.Vector3();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly input: InputReader,
    private readonly view: THREE.PerspectiveCamera,
    private readonly fixtures: FixtureField,
    private readonly origin: WorldOrigin,
    /** The interaction's fixture context, and where it is told which machine is framed. */
    private readonly context: () => FixtureContext,
    private readonly onFramed: (fixtureId: string | null) => void,
  ) {
    canvas.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('wheel', this.onWheel, { passive: true });
    // Capture, so Escape is ours before the pause menu's listener sees it.
    window.addEventListener('keydown', this.onKeyDown, true);
  }

  /** A machine is framed or the camera is still on its way back from one. */
  get active(): boolean {
    return this.fixtureId !== null;
  }

  /** A machine is framed and worked: the cursor is the hand. */
  get working(): boolean {
    return this.fixtureId !== null && !this.leaving;
  }

  enter(fixtureId: string): void {
    const fixture = this.fixtures.get(fixtureId);
    if (!fixture?.focus || this.working) return;
    this.fixtureId = fixtureId;
    this.fixture = fixture;
    this.pose = fixture.focus();
    this.leaving = false;
    this.downPending = this.upPending = this.mouseHeld = this.grabbing = false;
    this.wheel = 0;
    // The cursor starts on the middle of the screen, where the crosshair was.
    this.ndc.set(0, 0);
    this.input.setCursorFree(true);
    if (document.pointerLockElement !== null) document.exitPointerLock();
    document.body.classList.add('is-machine-focus');
    // Framed first, so the purse is in its slot when the machine is told; last, because
    // what the machine gives on being framed may let go of it again at once.
    this.onFramed(fixtureId);
    fixture.setFocused?.(true, this.context());
  }

  /** Lets go of the machine; `relock` asks for the pointer back (only from a user gesture). */
  leave(relock: boolean): void {
    if (!this.working) return;
    this.leaving = true;
    if (this.grabbing) this.fixture?.release?.();
    this.grabbing = false;
    this.fixture?.setFocused?.(false, this.context());
    this.onFramed(null);
    this.input.setCursorFree(false);
    this.canvas.style.cursor = '';
    document.body.classList.remove('is-machine-focus');
    if (relock) void this.canvas.requestPointerLock().catch(() => undefined);
  }

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (!this.working) return;
    if (e.button === 2) {
      this.leave(true);
      return;
    }
    if (e.button !== 0) return;
    this.track(e);
    this.downPending = true;
    this.mouseHeld = true;
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    if (e.button !== 0 || !this.mouseHeld) return;
    this.mouseHeld = false;
    this.upPending = true;
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    if (this.working) this.track(e);
  };

  private readonly onWheel = (e: WheelEvent): void => {
    if (!this.working) return;
    const scale = e.deltaMode === 1 ? 1 / 3 : e.deltaMode === 2 ? 10 : 1 / 100;
    this.wheel += e.deltaY * scale;
  };

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (!this.working || e.repeat) return;
    if (e.code === 'Escape' || e.code === 'Backquote') {
      // Escape steps back from the machine; it does not open the pause menu.
      e.preventDefault();
      e.stopImmediatePropagation();
      this.leave(true);
      return;
    }
    // A step away lets go of it, and the step is taken.
    if (this.input.isMoveKey(e.code)) this.leave(true);
  };

  private track(e: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    this.ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
  }

  /**
   * The cursor's angle round the held part's axle on screen, clockwise from the right,
   * in pixels so the aspect does not skew it; null with the cursor on the axle itself.
   */
  private screenAngle(fixture: WorldFixture): number | null {
    const pivot = fixture.pivot?.();
    if (!pivot) return null;
    this.pivotNdc.set(pivot.x - this.origin.x, pivot.y, pivot.z - this.origin.z).project(this.view);
    const rect = this.canvas.getBoundingClientRect();
    const px = (this.ndc.x - this.pivotNdc.x) * rect.width;
    const py = -(this.ndc.y - this.pivotNdc.y) * rect.height;
    if (px * px + py * py < 16) return null;
    return Math.atan2(py, px);
  }

  /**
   * The fixed tick, before the interaction reads `f`: the cursor's ray, the drag, and the
   * click as this tick's F. Returns the sound a drag or the wheel made, or null.
   */
  tick(f: InputFrame, driving: boolean): FoleyEvent | null {
    if (!this.working) return null;
    const fixture = this.fixtureId ? this.fixtures.get(this.fixtureId) : null;
    // Its chunk streamed out, or the player is no longer standing at it.
    if (!fixture || fixture !== this.fixture || driving) {
      this.leave(false);
      return null;
    }
    this.raycaster.setFromCamera(this.ndc, this.view);
    this.rayDir.copy(this.raycaster.ray.direction);
    const o = this.raycaster.ray.origin;
    const d = this.rayDir;
    let sound: FoleyEvent | null = null;
    // The player stands still while his hands are on it; F still works what the cursor
    // is on, and a click is F.
    f.moveX = 0;
    f.moveZ = 0;
    f.jump = false;
    if (this.downPending) {
      this.downPending = false;
      this.grabbing = fixture.grab?.(this.origin.x, this.origin.z, o.x, o.y, o.z, d.x, d.y, d.z) ?? false;
      // Not a part that takes the hand: the click is F on whatever is under the cursor.
      if (!this.grabbing) f.mount = true;
      else this.gripAngle = this.screenAngle(fixture);
    }
    if (this.grabbing) {
      // The hand goes round the axle as the screen shows it: what it turned since the
      // last tick turns the part.
      const angle = this.screenAngle(fixture);
      if (angle !== null && this.gripAngle !== null) {
        const turn = angle - this.gripAngle;
        sound = fixture.drag?.(turn - 2 * Math.PI * Math.round(turn / (2 * Math.PI))) ?? sound;
      }
      this.gripAngle = angle;
      if (this.upPending) {
        sound = fixture.release?.() ?? sound;
        this.grabbing = false;
      }
    } else {
      f.mountDown ||= this.mouseHeld;
    }
    this.upPending = false;
    if (Math.abs(this.wheel) >= WHEEL_NOTCH) {
      const notches = Math.trunc(this.wheel / WHEEL_NOTCH);
      this.wheel -= notches * WHEEL_NOTCH;
      sound = fixture.scroll?.(notches) ?? sound;
    }
    return sound;
  }

  /** This tick's pick direction: the cursor's ray while working, else null (the eye's own). */
  ray(): THREE.Vector3 | null {
    return this.working ? this.rayDir : null;
  }

  /** After the interaction tick: the cursor the part under it asks for. */
  updateCursor(): void {
    if (!this.working) return;
    this.canvas.style.cursor = this.fixture?.cursor?.() ?? 'default';
  }

  /**
   * The render frame, after the camera's own update: blends the eyes' view toward the
   * machine's framing by the focus weight. False once there is nothing to blend.
   */
  updateCamera(dt: number, camera: CameraRig): boolean {
    if (this.fixtureId === null || !this.pose) return false;
    const target = this.leaving ? 0 : 1;
    this.weight = target > this.weight ? Math.min(1, this.weight + dt / BLEND_S) : Math.max(0, this.weight - dt / BLEND_S);
    if (this.leaving && this.weight === 0) {
      this.fixtureId = null;
      this.fixture = null;
      this.pose = null;
      this.leaving = false;
      return false;
    }
    const s = this.weight * this.weight * (3 - 2 * this.weight);
    const footEye = camera.eyePosition;
    const footDir = camera.eyeDirection;
    this.footEye.set(footEye.x, footEye.y, footEye.z);
    this.footLook.set(footEye.x + footDir.x * 3, footEye.y + footDir.y * 3, footEye.z + footDir.z * 3);
    const p = this.pose;
    this.eye.set(p.eyeX - this.origin.x, p.eyeY, p.eyeZ - this.origin.z).sub(this.footEye).multiplyScalar(s).add(this.footEye);
    this.look.set(p.lookX - this.origin.x, p.lookY, p.lookZ - this.origin.z).sub(this.footLook).multiplyScalar(s).add(this.footLook);
    // The rig's own field of view, as its update left it, toward the machine's.
    const fov = this.view.fov + (p.fov - this.view.fov) * s;
    camera.updateScripted(dt, this.eye, this.look, fov);
    // Exactly that, not eased: the rig's next update starts from its own value again.
    this.view.fov = fov;
    this.view.updateProjectionMatrix();
    return true;
  }
}
