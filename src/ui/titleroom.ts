import * as THREE from 'three';
import { buildRoomScene, type RoomScene } from './roomscene';

/**
 * THE TITLE ROOM: the boy's bedroom at night as the title screen, after the first
 * Mafia's (2002): a small, detailed 3D room behind a plain list; highlighting an item
 * sweeps the camera, low, across the room to the thing that item is about, and choosing
 * it acts (game-design2.md §3). The room explains nothing in words; its things do.
 *
 *   Continue      — the window, the desert road under the moon: the latest drive
 *   New game      — the play mat on the floor, the toy car on its painted road
 *   Drives        — the car keys on their hook by the door: the saved drives
 *   Carcyclopedia — the wall case of 1:43 models, one of every car; a model chosen in
 *                   the panel brings the camera to it (`showModel`)
 *   Settings      — the toolbox
 *
 * Its own canvas and WebGL context, made for the title and released (`dispose`, the
 * context lost on purpose) before the drive builds its renderer, so nothing of the room
 * stays on the GPU or in the drive's program cache. The list is plain DOM rows: the
 * menu's keyboard and pad navigation walks it as any other.
 *
 * CHEAP TO SIT IN FRONT OF. A title screen is looked at for minutes with nothing
 * happening, so the room is drawn only as often as it changes: at full rate while the
 * camera sweeps or leans, at `IDLE_FRAME_MS` while only the dust and the lamp live, and
 * not at all behind a dimmed panel. The lights and the furniture never move, so the two
 * shadow maps are drawn once and again only when a model joins the case. The canvas
 * has an absolute pixel budget (`MAX_PIXELS`), so a 4K television does not ask for 8
 * megapixels of it. Every program is linked off the main thread before the first frame
 * (`ready`), and the die-cast models are built in a worker (ui/roomscene.ts).
 */

export type RoomSpot = 'window' | 'mat' | 'keys' | 'shelf' | 'toolbox';

export interface RoomItem {
  readonly label: string;
  readonly detail: string;
  readonly disabled: boolean;
  /** Not in the list at all: Continue with nothing saved. */
  readonly hidden?: boolean;
}

/** The list, top to bottom, and the thing in the room each item looks at. */
const ITEMS: readonly RoomSpot[] = ['window', 'mat', 'keys', 'shelf', 'toolbox'];

/** Where the camera stands and what it looks at, for each item and before any. */
const POSES: Readonly<Record<RoomSpot | 'wide', { readonly at: THREE.Vector3; readonly look: THREE.Vector3; readonly fov: number }>> = {
  wide: { at: new THREE.Vector3(1.35, 1.55, 1.55), look: new THREE.Vector3(-0.7, 0.85, -1.0), fov: 52 },
  // Down onto the play mat from beside it, the toy car (ui/roomscene.ts `toyAt`, on the
  // loop's left side) near, right of the list, and the painted desert behind it.
  mat: { at: new THREE.Vector3(0.2, 0.58, 1.0), look: new THREE.Vector3(-0.5, 0.0, 0.18), fov: 38 },
  shelf: { at: new THREE.Vector3(1.05, 1.62, -0.05), look: new THREE.Vector3(1.51, 1.66, -1.7), fov: 44 },
  keys: { at: new THREE.Vector3(1.5, 1.45, 0.6), look: new THREE.Vector3(2.08, 1.36, 0.3), fov: 30 },
  window: { at: new THREE.Vector3(-0.1, 1.3, 0.85), look: new THREE.Vector3(-0.2, 1.45, -3.5), fov: 50 },
  toolbox: { at: new THREE.Vector3(0.65, 0.85, 1.35), look: new THREE.Vector3(1.35, 0.2, 0.55), fov: 40 },
};

/** How long the camera takes from one thing to the next, seconds. */
const MOVE_S = 1.5;
/** How low the camera dips mid-move, metres: it sweeps across the room, not over it. */
const MOVE_DIP = 0.18;
/**
 * A model on the case seen close: the camera this far in front of it and above, metres,
 * looking `right` past it so it stands left of the Carcyclopedia's panel.
 */
const MODEL_VIEW = { back: 0.5, up: 0.08, right: 0.09, fov: 30 };
/**
 * The exposure the room is seen at, and at a model on the case: the case hangs in the
 * back wall's shadow, out of the lamp's cone, and the eye opens up to it rather than the
 * room gaining a light.
 */
const EXPOSURE = 1.15;
const EXPOSURE_MODEL = 2.6;
/**
 * The most pixels the canvas is drawn at, whatever the screen: about 1920 × 1080, and
 * 1280 × 720 at low detail. A dark room of soft light loses nothing to a gentle upscale;
 * at a device pixel ratio of 1 a 4K television otherwise asks for 8.3 megapixels.
 */
const MAX_PIXELS = 1920 * 1080;
const MAX_PIXELS_LOW = 1280 * 720;
/**
 * The frame interval while the camera is still, ms: the dust, the lamp and the camera's
 * breath are slow enough that 30 frames a second shows them as well as 60 or 144.
 */
const IDLE_FRAME_MS = 1000 / 30;
/** How quickly the camera's lean catches up with the pointer, per second. */
const LEAN_RATE = 6;

export class TitleRoom {
  readonly element: HTMLElement;
  /**
   * Resolves once every program of the room is linked and its first frame drawn: until
   * then the canvas is blank, and the launch cover should stay up.
   */
  readonly ready: Promise<void>;
  private readonly list: HTMLElement;
  private readonly rows = new Map<RoomSpot, HTMLButtonElement>();
  private readonly details = new Map<RoomSpot, HTMLElement>();
  private readonly renderer: THREE.WebGLRenderer | null;
  /** Far enough for the sky and the mesas outside the window. */
  private readonly camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.03, 400);
  private readonly room: RoomScene | null;
  /** The pending animation frame, 0 when the loop is stopped. */
  private frame = 0;
  /** When the last frame was drawn, ms (the rAF clock). */
  private lastMs = 0;
  /** The room's own time, s: advances only as frames are drawn, so a rest is not a jump. */
  private clock = 0;
  private started = false;
  private disposed = false;
  /** A panel is open and the room dimmed behind it: nothing is drawn while it is still. */
  private resting = false;
  /** One frame is owed whatever the pace: something new in the room, a resize. */
  private dirty = false;
  /** The move in progress: from, to, when it began (`clock`, s). */
  private readonly from = { at: new THREE.Vector3(), look: new THREE.Vector3(), fov: 50 };
  private readonly to = { at: new THREE.Vector3(), look: new THREE.Vector3(), fov: 50 };
  private moveStart = -Infinity;
  /** The exposure the camera is opening or closing towards. */
  private exposure = EXPOSURE;
  private readonly look = new THREE.Vector3();
  private readonly pointer = new THREE.Vector2();
  /** The lean the camera has, easing after `pointer`. */
  private readonly lean = new THREE.Vector2();
  private readonly onResize = (): void => this.resize();
  private readonly onPointer = (ev: PointerEvent): void => {
    this.pointer.set((ev.clientX / window.innerWidth) * 2 - 1, (ev.clientY / window.innerHeight) * 2 - 1);
    this.wake();
  };

  constructor(
    items: Readonly<Record<RoomSpot, RoomItem>>,
    private readonly act: (spot: RoomSpot) => void,
    private readonly lowDetail: boolean,
  ) {
    this.element = document.createElement('div');
    this.element.className = 'menu-room3d';
    const canvas = document.createElement('canvas');
    canvas.className = 'menu-room3d-canvas';
    let renderer: THREE.WebGLRenderer | null = null;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: !lowDetail, powerPreference: 'high-performance' });
    } catch (error) {
      // No WebGL: the list alone still works, over a plain dark room.
      console.error('title room: no WebGL', error);
    }
    this.renderer = renderer;
    if (renderer) {
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = EXPOSURE;
      renderer.shadowMap.enabled = true;
      // PCF, not PCFSoft: three r185 draws PCFSoft as PCF and switches the type on the
      // first shadow pass, so every program compiled ahead under PCFSoft went unused.
      renderer.shadowMap.type = THREE.PCFShadowMap;
      // Drawn on the first frame and whenever something new stands in the room.
      renderer.shadowMap.autoUpdate = false;
      renderer.shadowMap.needsUpdate = true;
      this.element.appendChild(canvas);
    }
    this.room = renderer ? buildRoomScene(lowDetail) : null;

    const vignette = document.createElement('div');
    vignette.className = 'menu-room3d-vignette';
    this.list = document.createElement('nav');
    this.list.className = 'menu-room3d-list';
    for (const spot of ITEMS) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'menu-room3d-item';
      row.dataset.nav = '';
      row.dataset.key = spot;
      const label = document.createElement('span');
      label.className = 'menu-room3d-label';
      const detail = document.createElement('span');
      detail.className = 'menu-room3d-detail';
      row.append(label, detail);
      row.addEventListener('click', () => this.act(spot));
      row.addEventListener('focus', () => this.aim(spot));
      row.addEventListener('pointerenter', () => {
        if (!row.disabled) row.focus();
      });
      this.rows.set(spot, row);
      this.details.set(spot, detail);
      this.list.appendChild(row);
    }
    this.setItems(items);
    this.element.append(vignette, this.list);

    const wide = POSES.wide;
    this.camera.position.copy(wide.at);
    this.look.copy(wide.look);
    this.camera.fov = wide.fov;
    this.from.at.copy(wide.at);
    this.from.look.copy(wide.look);
    this.to.at.copy(wide.at);
    this.to.look.copy(wide.look);
    this.to.fov = wide.fov;
    window.addEventListener('resize', this.onResize);
    window.addEventListener('pointermove', this.onPointer);
    this.resize();
    this.ready = renderer && this.room ? this.prepare(renderer, this.room) : Promise.resolve();
    // Dev only: the look tools pose the camera through this.
    if (import.meta.env.DEV) Object.assign(window, { __titleRoom: this });
  }

  /** What each item says and whether it can be chosen. */
  setItems(items: Readonly<Record<RoomSpot, RoomItem>>): void {
    for (const spot of ITEMS) {
      const row = this.rows.get(spot)!;
      const item = items[spot];
      row.querySelector('.menu-room3d-label')!.textContent = item.label;
      this.details.get(spot)!.textContent = item.detail;
      row.disabled = item.disabled;
      row.hidden = item.hidden === true;
      row.setAttribute('aria-label', `${item.label}: ${item.detail}`);
    }
  }

  /**
   * A panel is open over the room: the list rests and the camera stays where it is.
   * `dim` false keeps the room at full light: the panel is about what is in the room.
   * Dimmed, the room stops being drawn once the camera has settled.
   */
  setAway(away: boolean, dim = true): void {
    this.element.classList.toggle('is-away', away);
    this.element.classList.toggle('is-dim', away && dim);
    this.resting = away && dim;
    this.wake();
  }

  focus(spot: RoomSpot): void {
    this.rows.get(spot)?.focus();
  }

  /** Bring the camera to the model of `modelId` on the case, and have it built next if it is not yet. */
  showModel(modelId: string): void {
    const at = this.room?.models.get(modelId);
    if (!at) return;
    this.room!.buildModel(modelId);
    this.moveTo(new THREE.Vector3(at.x - 0.04, at.y + MODEL_VIEW.up, at.z + MODEL_VIEW.back), new THREE.Vector3(at.x + MODEL_VIEW.right, at.y + 0.02, at.z), MODEL_VIEW.fov);
    this.exposure = EXPOSURE_MODEL;
  }

  /** Back to the whole case. */
  showShelf(): void {
    this.aim('shelf');
  }

  focusFirst(): void {
    for (const spot of ITEMS) {
      const row = this.rows.get(spot)!;
      if (!row.disabled && !row.hidden) {
        row.focus();
        return;
      }
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('pointermove', this.onPointer);
    this.room?.dispose();
    if (this.renderer) {
      this.renderer.dispose();
      // The drive makes its own context next: this one is let go now, not when the
      // browser gets round to it.
      this.renderer.forceContextLoss();
    }
    this.element.remove();
  }

  /**
   * Link every program off the main thread (`compileAsync`; on ANGLE one lit program is
   * hundreds of milliseconds when linked on first draw), then draw the first frame —
   * shadow maps and their depth programs with it — and start the slow work.
   */
  private async prepare(renderer: THREE.WebGLRenderer, room: RoomScene): Promise<void> {
    try {
      await renderer.compileAsync(room.scene, this.camera);
    } catch (error) {
      console.error('title room: compiling the room failed', error);
    }
    if (this.disposed) return;
    this.started = true;
    this.lastMs = performance.now();
    this.draw(0);
    room.startWork(renderer, () => {
      renderer.shadowMap.needsUpdate = true;
      this.dirty = true;
      this.wake();
    });
    this.wake();
  }

  /** Sweep the camera to `spot`'s thing. */
  private aim(spot: RoomSpot): void {
    const pose = POSES[spot];
    this.exposure = EXPOSURE;
    this.moveTo(pose.at, pose.look, pose.fov);
  }

  private moveTo(at: THREE.Vector3, look: THREE.Vector3, fov: number): void {
    this.from.at.copy(this.camera.position);
    this.from.look.copy(this.look);
    this.from.fov = this.camera.fov;
    this.to.at.copy(at);
    this.to.look.copy(look);
    this.to.fov = fov;
    this.wake();
    this.moveStart = this.clock;
  }

  private resize(): void {
    if (!this.renderer) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const budget = Math.sqrt((this.lowDetail ? MAX_PIXELS_LOW : MAX_PIXELS) / Math.max(1, w * h));
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.lowDetail ? 1 : 1.5, budget));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
    // A resized canvas is a cleared one.
    this.dirty = true;
    this.wake();
  }

  /** Start the loop if it has stopped. */
  private wake(): void {
    if (this.frame !== 0 || !this.started || this.disposed) return;
    // Stopped for a while: the next frame steps as one frame, not as the whole rest.
    this.lastMs = Math.max(this.lastMs, performance.now() - IDLE_FRAME_MS);
    this.frame = requestAnimationFrame(this.loop);
  }

  private readonly loop = (ms: number): void => {
    this.frame = 0;
    if (this.disposed) return;
    // The camera still on its way somewhere: a sweep, the lean, the exposure.
    const moving =
      this.clock - this.moveStart < MOVE_S ||
      Math.abs(this.pointer.x - this.lean.x) > 0.002 ||
      Math.abs(this.pointer.y - this.lean.y) > 0.002 ||
      (this.renderer !== null && Math.abs(this.exposure - this.renderer.toneMappingExposure) > 0.003);
    // Dimmed behind a panel with nothing on its way: stop until something wakes it.
    if (this.resting && !moving && !this.dirty) return;
    if (moving || this.dirty || ms - this.lastMs >= IDLE_FRAME_MS - 4) {
      const dt = Math.min(0.1, Math.max(0, ms - this.lastMs) / 1000);
      this.lastMs = ms;
      this.clock += dt;
      this.dirty = false;
      this.draw(dt);
    }
    this.frame = requestAnimationFrame(this.loop);
  };

  private draw(dt: number): void {
    if (!this.renderer || !this.room) return;
    const t = this.clock;
    // The move: smootherstep along the way, a dip in the middle.
    const k = Math.min(1, Math.max(0, (t - this.moveStart) / MOVE_S));
    const e = k * k * k * (k * (k * 6 - 15) + 10);
    this.camera.position.lerpVectors(this.from.at, this.to.at, e);
    this.camera.position.y -= Math.sin(Math.PI * e) * MOVE_DIP * this.dipScale();
    this.look.lerpVectors(this.from.look, this.to.look, e);
    this.camera.fov = this.from.fov + (this.to.fov - this.from.fov) * e;
    // Held still, the camera breathes, and leans a touch after the pointer: less when it
    // is close to something small.
    this.lean.lerp(this.pointer, Math.min(1, dt * LEAN_RATE));
    const lean = Math.min(1, this.to.at.distanceTo(this.to.look) / 1.2);
    this.camera.position.x += (Math.sin(t * 0.23) * 0.02 + this.lean.x * 0.04) * lean;
    this.camera.position.y += (Math.sin(t * 0.31) * 0.012 - this.lean.y * 0.025) * lean;
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(this.look);
    this.renderer.toneMappingExposure += (this.exposure - this.renderer.toneMappingExposure) * Math.min(1, dt * 2.5);

    this.room.tick(t, dt);
    this.renderer.render(this.room.scene, this.camera);
  }

  /** No dip between two neighbours on the case: the camera slides along it instead. */
  private dipScale(): number {
    return Math.min(1, this.from.at.distanceTo(this.to.at) / 1.5);
  }
}
