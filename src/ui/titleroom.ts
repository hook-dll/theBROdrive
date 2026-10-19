import * as THREE from 'three';
import type { DreamDef } from '../dreams/dream';
import type { DreamProgress } from '../dreams/progress';
import { buildRoomScene, type RoomScene } from './roomscene';

/**
 * THE TITLE ROOM: the boy's bedroom at night as the title screen, after the first
 * Mafia's (2002): a small, detailed 3D room behind a plain list; highlighting an item
 * sweeps the camera, low, across the room to the thing that item is about, and choosing
 * it acts (GAME_DESIGN.md §14.1).
 *
 *   Daydream   — the play mat on the floor and the next adventure's toy car on its
 *                road: the boy does not go to bed for it, he plays and drifts off
 *   Adventures — the map of the adventures on the desk
 *   Shelf      — the die-cast toys, one for every adventure had
 *   Drives     — the car keys on their hook by the door: the saved drives
 *   Free drive — the window, the desert road under the moon
 *   Settings   — the toolbox
 *
 * Its own canvas and WebGL context, made for the title and released (`dispose`, the
 * context lost on purpose) before the drive builds its renderer, so nothing of the room
 * stays on the GPU or in the drive's program cache. The list is plain DOM rows: the
 * menu's keyboard and pad navigation walks it as any other.
 */

export type RoomSpot = 'toy' | 'map' | 'shelf' | 'keys' | 'window' | 'toolbox';

export interface RoomItem {
  readonly label: string;
  readonly detail: string;
  readonly disabled: boolean;
}

/** The list, top to bottom, and the thing in the room each item looks at. */
const ITEMS: readonly RoomSpot[] = ['toy', 'map', 'shelf', 'keys', 'window', 'toolbox'];

/** Where the camera stands and what it looks at, for each item and before any. */
const POSES: Readonly<Record<RoomSpot | 'wide', { readonly at: THREE.Vector3; readonly look: THREE.Vector3; readonly fov: number }>> = {
  wide: { at: new THREE.Vector3(1.35, 1.55, 1.55), look: new THREE.Vector3(-0.7, 0.85, -1.0), fov: 52 },
  toy: { at: new THREE.Vector3(-0.2, 0.26, 0.85), look: new THREE.Vector3(-0.47, 0.05, 0.22), fov: 38 },
  map: { at: new THREE.Vector3(1.3, 1.5, -0.45), look: new THREE.Vector3(1.68, 0.77, -0.9), fov: 42 },
  shelf: { at: new THREE.Vector3(1.1, 1.72, -0.3), look: new THREE.Vector3(1.5, 1.82, -1.75), fov: 42 },
  keys: { at: new THREE.Vector3(1.5, 1.45, 0.6), look: new THREE.Vector3(2.08, 1.36, 0.3), fov: 30 },
  window: { at: new THREE.Vector3(-0.1, 1.3, 0.85), look: new THREE.Vector3(-0.2, 1.45, -3.5), fov: 50 },
  toolbox: { at: new THREE.Vector3(0.65, 0.85, 1.35), look: new THREE.Vector3(1.35, 0.2, 0.55), fov: 40 },
};

/** How long the camera takes from one thing to the next, seconds. */
const MOVE_S = 1.5;
/** How low the camera dips mid-move, metres: it sweeps across the room, not over it. */
const MOVE_DIP = 0.18;
/**
 * Daydreaming: the camera goes down to the toy car on the mat, to its level, close
 * enough that the mat is a road, while the room goes dark; then the adventure loads.
 */
const DIVE = { at: new THREE.Vector3(-0.43, 0.045, 0.52), look: new THREE.Vector3(-0.47, 0.035, 0.18), fov: 36 };
const DIVE_S = 1.3;

export class TitleRoom {
  readonly element: HTMLElement;
  private readonly list: HTMLElement;
  private readonly rows = new Map<RoomSpot, HTMLButtonElement>();
  private readonly details = new Map<RoomSpot, HTMLElement>();
  private readonly renderer: THREE.WebGLRenderer | null;
  /** Far enough for the sky and the mesas outside the window. */
  private readonly camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.03, 400);
  private readonly room: RoomScene | null;
  private diving = false;
  private frame = 0;
  private lastMs = 0;
  private startMs = 0;
  private toyTimer = 0;
  private disposed = false;
  /** The move in progress: from, to, when it began (s). */
  private readonly from = { at: new THREE.Vector3(), look: new THREE.Vector3(), fov: 50 };
  private readonly to = { at: new THREE.Vector3(), look: new THREE.Vector3(), fov: 50 };
  private moveStart = -Infinity;
  private readonly look = new THREE.Vector3();
  private readonly pointer = new THREE.Vector2();
  private readonly onResize = (): void => this.resize();
  private readonly onPointer = (ev: PointerEvent): void => {
    this.pointer.set((ev.clientX / window.innerWidth) * 2 - 1, (ev.clientY / window.innerHeight) * 2 - 1);
  };

  constructor(
    progress: DreamProgress,
    nextDream: DreamDef | null,
    items: Readonly<Record<RoomSpot, RoomItem>>,
    private readonly act: (spot: RoomSpot) => void,
    lowDetail: boolean,
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
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, lowDetail ? 1 : 1.5));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.15;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      this.element.appendChild(canvas);
    }
    this.room = renderer ? buildRoomScene(progress, nextDream, lowDetail) : null;

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
      row.addEventListener('click', () => (spot === 'toy' ? this.dive(() => this.act(spot)) : this.act(spot)));
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
    this.startMs = performance.now();
    this.lastMs = this.startMs;
    this.resize();
    this.loop(this.startMs);
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
      row.setAttribute('aria-label', `${item.label}: ${item.detail}`);
    }
  }

  /** A panel is open over the room: the list rests and the camera stays where it is. */
  setAway(away: boolean): void {
    this.element.classList.toggle('is-away', away);
  }

  focus(spot: RoomSpot): void {
    this.rows.get(spot)?.focus();
  }

  focusFirst(): void {
    for (const spot of ITEMS) {
      const row = this.rows.get(spot)!;
      if (!row.disabled) {
        row.focus();
        return;
      }
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    window.clearTimeout(this.toyTimer);
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

  /** Down to the toy car, the room fading out, then `then`. */
  private dive(then: () => void): void {
    if (this.diving) return;
    this.diving = true;
    this.from.at.copy(this.camera.position);
    this.from.look.copy(this.look);
    this.from.fov = this.camera.fov;
    this.to.at.copy(DIVE.at);
    this.to.look.copy(DIVE.look);
    this.to.fov = DIVE.fov;
    this.moveStart = (performance.now() - this.startMs) / 1000;
    this.element.classList.add('is-diving');
    window.setTimeout(then, DIVE_S * 1000);
  }

  /** Sweep the camera to `spot`'s thing. */
  private aim(spot: RoomSpot): void {
    const pose = POSES[spot];
    this.from.at.copy(this.camera.position);
    this.from.look.copy(this.look);
    this.from.fov = this.camera.fov;
    this.to.at.copy(pose.at);
    this.to.look.copy(pose.look);
    this.to.fov = pose.fov;
    this.moveStart = (performance.now() - this.startMs) / 1000;
  }

  private resize(): void {
    if (!this.renderer) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  private readonly loop = (ms: number): void => {
    if (this.disposed) return;
    this.frame = requestAnimationFrame(this.loop);
    const dt = Math.min(0.1, (ms - this.lastMs) / 1000);
    this.lastMs = ms;
    const t = (ms - this.startMs) / 1000;
    if (!this.renderer || !this.room) return;

    // The move: smootherstep along the way, a dip in the middle.
    const k = Math.min(1, Math.max(0, (t - this.moveStart) / (this.diving ? DIVE_S : MOVE_S)));
    const e = k * k * k * (k * (k * 6 - 15) + 10);
    this.camera.position.lerpVectors(this.from.at, this.to.at, e);
    if (!this.diving) this.camera.position.y -= Math.sin(Math.PI * e) * MOVE_DIP;
    this.look.lerpVectors(this.from.look, this.to.look, e);
    this.camera.fov = this.from.fov + (this.to.fov - this.from.fov) * e;
    // Held still, the camera breathes, and leans a touch after the pointer.
    const lean = this.diving ? 0.1 : 1;
    this.camera.position.x += (Math.sin(t * 0.23) * 0.02 + this.pointer.x * 0.04) * lean;
    this.camera.position.y += (Math.sin(t * 0.31) * 0.012 - this.pointer.y * 0.025) * lean;
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(this.look);

    this.room.tick(t, dt);
    this.renderer.render(this.room.scene, this.camera);

    // The slow work (toys, the calendar's photograph) after the room is on screen, one
    // piece at a time between frames.
    if (this.toyTimer === 0 && t > 0.3) this.scheduleWork();
  };

  private scheduleWork(): void {
    this.toyTimer = window.setTimeout(() => {
      if (this.disposed || !this.room || !this.renderer) return;
      const more = this.room.buildNext(this.renderer);
      if (more) this.scheduleWork();
      else this.toyTimer = -1;
    }, 60);
  }
}
