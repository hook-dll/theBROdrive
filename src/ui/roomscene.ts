import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { CAR_MODELS, DEFAULT_CAR_MODEL_ID } from '../vehicle/carmodels';
import { factoryPaintHex } from '../vehicle/carpaint';
import { dieCastArrays, type DieCastArrays, type DieCastRequest, type DieCastResponse } from './diecast';
import {
  calendarPage,
  clockFace,
  crayonDrawing,
  dustSprite,
  exerciseSpread,
  floorboards,
  MAT_LOOP,
  moonDisc,
  nightSky,
  playMat,
  printedSpread,
  quilt,
  rng,
  roadSurface,
  rulerFace,
  sandGround,
  textbookCover,
  wallCarpet,
  wallpaper,
} from './roomart';

/**
 * THE BOY'S ROOM, IN 3D: the title screen's set (ui/titleroom.ts points the camera).
 *
 * A small room at night, built from primitives and painted canvases (ui/roomart.ts),
 * that says nothing in words about the boy who lives in it: the play mat painted as the
 * desert the drive opens on, a toy car on its road; the desk under the lamp, its
 * textbooks and an exercise book open on cars drawn over the lesson, pencils, pens,
 * erasers and a ruler; crayon drawings of cars and roads pinned to the walls; a glass-less
 * wall case of 1:43 die-cast models, one of every car in the game in its factory colour
 * (the Carcyclopedia); a Lada 1600 calendar whose photograph is the kit's own 2106; the
 * keys on their board by the door; a deep double-glazed window onto the desert at night,
 * the road passing the house; the bed under a wall carpet, the bedside table and its
 * alarm clock; a toolbox; a clock.
 *
 * NO SURFACE LIES IN ANOTHER: pieces that meet only touch along their edges, decals sit
 * clear of what they are laid on and draw with a polygon offset, so nothing z-fights.
 *
 * Metres, +y up; the back wall (the window's) is at z = -ROOM_D/2, the bed along the
 * left wall, the desk and the door on the right.
 */

export const ROOM_W = 4.2;
export const ROOM_D = 3.6;
export const ROOM_H = 2.7;
const X0 = -ROOM_W / 2;
const X1 = ROOM_W / 2;
const Z0 = -ROOM_D / 2;
const Z1 = ROOM_D / 2;
/** The back wall's thickness: a Soviet block wall, the window deep in it. */
const WALL_T = 0.38;

/** The window's opening in the back wall: left, right, sill, top. */
const WIN = { x0: -0.85, x1: 0.45, y0: 0.88, y1: 2.12 };
/** The ground outside, under the floor: the flat is a step up from the desert. */
const GROUND_Y = -0.55;

/** The desk lamp's bulb, candela. */
const DESK_LAMP_CD = 7;

/** The calendar's year: the 2106's own heyday. */
const CALENDAR_YEAR = 1986;

/** The key the room's cars take their factory colour under (`factoryPaintHex`). */
const ROOM_CAR_KEY = 'car:room';

export interface RoomScene {
  readonly scene: THREE.Scene;
  /** Where each model of the Carcyclopedia stands on the wall case, by model id. */
  readonly models: ReadonlyMap<string, THREE.Vector3>;
  /** Animate the clock, the lamp, the dust and the curtains; `t` seconds. */
  tick(t: number, dt: number): void;
  /**
   * Start the slow work — the toy on the mat, the calendar's photograph, the die-cast
   * models on the case — built in a worker one at a time (`DieCastShop`). `changed` is
   * called each time something new stands in the room, for the caller to draw it.
   */
  startWork(renderer: THREE.WebGLRenderer, changed: () => void): void;
  /** Have the model of `modelId` built next if it is not there yet: it is being looked at. */
  buildModel(modelId: string): void;
  dispose(): void;
}

/* ------------------------------------------------------------------ *
 *  Building blocks                                                   *
 * ------------------------------------------------------------------ */

class Kit {
  readonly disposables: { dispose(): void }[] = [];

  mat(params: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial(params);
    this.disposables.push(m);
    if (params.map) this.disposables.push(params.map);
    return m;
  }

  /** A material for a flat thing laid on a surface: drawn pulled towards the eye. */
  decal(params: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial {
    const m = this.mat(params);
    m.polygonOffset = true;
    m.polygonOffsetFactor = -2;
    m.polygonOffsetUnits = -2;
    return m;
  }

  mesh(geometry: THREE.BufferGeometry, material: THREE.Material, x = 0, y = 0, z = 0, cast = true): THREE.Mesh {
    this.disposables.push(geometry);
    const m = new THREE.Mesh(geometry, material);
    m.position.set(x, y, z);
    m.castShadow = cast;
    m.receiveShadow = true;
    return m;
  }

  box(w: number, h: number, d: number, material: THREE.Material, x: number, y: number, z: number, radius = 0): THREE.Mesh {
    const geometry = radius > 0 ? new RoundedBoxGeometry(w, h, d, 3, Math.min(radius, w / 2, h / 2, d / 2)) : new THREE.BoxGeometry(w, h, d);
    return this.mesh(geometry, material, x, y, z);
  }

  /** A box between two corners: (x0, y0, z0) to (x1, y1, z1). */
  span(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, material: THREE.Material, radius = 0): THREE.Mesh {
    return this.box(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0), material, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, radius);
  }

  /** A rod from `a` to `b`. */
  rod(a: THREE.Vector3, b: THREE.Vector3, radius: number, material: THREE.Material, sides = 10): THREE.Mesh {
    const length = a.distanceTo(b);
    const m = this.mesh(new THREE.CylinderGeometry(radius, radius, length, sides), material);
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    return m;
  }

  /** A plane of `w` × `h` with its texture's repeat following its own size. */
  wallPlane(w: number, h: number, unit: number): THREE.PlaneGeometry {
    const geometry = new THREE.PlaneGeometry(w, h);
    const uv = geometry.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * w) / unit, (uv.getY(i) * h) / unit);
    return geometry;
  }
}

/**
 * A window sash: its members laid edge to edge so none lies in another — stiles full
 * height, rails between them, a mullion between the rails, a transom in two halves
 * between stile and mullion — and a pane of glass in each opening.
 */
function sash(k: Kit, x0: number, x1: number, y0: number, y1: number, z: number, depth: number, member: number, frameMat: THREE.Material, glassMat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const cx = (x0 + x1) / 2;
  const bottom = member * 1.3;
  const yt = y0 + (y1 - y0) * 0.68;
  const z0 = z - depth / 2;
  const z1 = z + depth / 2;
  g.add(
    k.span(x0, y0, z0, x0 + member, y1, z1, frameMat),
    k.span(x1 - member, y0, z0, x1, y1, z1, frameMat),
    k.span(x0 + member, y1 - member, z0, x1 - member, y1, z1, frameMat),
    k.span(x0 + member, y0, z0, x1 - member, y0 + bottom, z1, frameMat),
    k.span(cx - member / 2, y0 + bottom, z0, cx + member / 2, y1 - member, z1, frameMat),
    k.span(x0 + member, yt - member / 2, z0, cx - member / 2, yt + member / 2, z1, frameMat),
    k.span(cx + member / 2, yt - member / 2, z0, x1 - member, yt + member / 2, z1, frameMat),
  );
  const pane = (px0: number, px1: number, py0: number, py1: number): void => {
    const p = k.mesh(new THREE.PlaneGeometry(px1 - px0, py1 - py0), glassMat, (px0 + px1) / 2, (py0 + py1) / 2, z, false);
    p.receiveShadow = false;
    g.add(p);
  };
  pane(x0 + member, cx - member / 2, y0 + bottom, yt - member / 2);
  pane(cx + member / 2, x1 - member, y0 + bottom, yt - member / 2);
  pane(x0 + member, cx - member / 2, yt + member / 2, y1 - member);
  pane(cx + member / 2, x1 - member, yt + member / 2, y1 - member);
  return g;
}

/**
 * A key's outline as one closed run, so it extrudes as one solid: up the blade's toothed
 * edge, round the bow, down its plain edge; a hole through the bow.
 */
function keyShape(bow: number, blade: number, width: number): THREE.Shape {
  const w = width / 2;
  const neck = -Math.sqrt(bow * bow - w * w);
  const tip = neck - blade;
  const s = new THREE.Shape();
  s.moveTo(-w, tip + w);
  s.lineTo(w * 0.2, tip);
  s.lineTo(w, tip + w);
  for (let i = 0; i < 4; i++) {
    const y = tip + w + ((i + 1) * (blade - w)) / 5;
    s.lineTo(w * 1.7, y - (blade - w) / 10);
    s.lineTo(w, y);
  }
  s.lineTo(w, neck);
  s.absarc(0, 0, bow, Math.atan2(neck, w), Math.atan2(neck, -w) + Math.PI * 2, false);
  s.lineTo(-w, tip + w);
  const hole = new THREE.Path();
  hole.absarc(0, bow * 0.45, bow * 0.28, 0, Math.PI * 2, true);
  s.holes.push(hole);
  return s;
}

function extrudeKey(k: Kit, shape: THREE.Shape, thickness: number, material: THREE.Material): THREE.Mesh {
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, curveSegments: 16 });
  geometry.translate(0, 0, -thickness / 2);
  return k.mesh(geometry, material);
}

/** One kit car to be built, and what becomes of it. */
interface DieCastOrder extends DieCastRequest {
  readonly done: (arrays: DieCastArrays) => void;
}

/**
 * The die-cast models' workshop: each kit car is built, flattened and painted in a
 * worker (ui/diecastworker.ts), one at a time and in the order asked, and handed back
 * as arrays. A kit car is 100-300 ms of building, 28 of them in the room, and on the
 * main thread every one was a frozen frame of the title screen.
 *
 * A worker that cannot start or load leaves the rest of the orders to the main thread,
 * one per pause between frames: the case still fills, only less smoothly.
 */
class DieCastShop {
  private worker: Worker | null = null;
  private readonly queue: DieCastOrder[] = [];
  private current: DieCastOrder | null = null;
  private timer = 0;
  private closed = false;

  constructor() {
    try {
      const worker = new Worker(new URL('./diecastworker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (event: MessageEvent<DieCastResponse>) => this.receive(event.data);
      worker.onerror = (event) => {
        event.preventDefault();
        console.error('title room: die-cast worker failed, building on the main thread', event.message);
        this.dropWorker();
      };
      this.worker = worker;
    } catch (error) {
      console.error('title room: no die-cast worker, building on the main thread', error);
    }
  }

  order(order: DieCastOrder): void {
    this.queue.push(order);
    this.pump();
  }

  /** Move the order for `modelId` to the front of the queue, if it is still waiting. */
  hurry(modelId: string): void {
    const i = this.queue.findIndex((order) => order.modelId === modelId);
    if (i > 0) this.queue.unshift(...this.queue.splice(i, 1));
  }

  close(): void {
    this.closed = true;
    this.queue.length = 0;
    this.current = null;
    window.clearTimeout(this.timer);
    this.worker?.terminate();
    this.worker = null;
  }

  private pump(): void {
    if (this.closed || this.current || this.queue.length === 0) return;
    const order = this.queue.shift()!;
    this.current = order;
    if (this.worker) {
      const request: DieCastRequest = { modelId: order.modelId, color: order.color, scale: order.scale };
      this.worker.postMessage(request);
      return;
    }
    this.timer = window.setTimeout(() => {
      if (this.closed) return;
      this.current = null;
      try {
        order.done(dieCastArrays(order));
      } catch (error) {
        console.error(`title room: die-cast ${order.modelId} failed`, error);
      }
      this.pump();
    }, 60);
  }

  private receive(response: DieCastResponse): void {
    const order = this.current;
    if (this.closed || !order) return;
    this.current = null;
    if ('error' in response) console.error(`title room: die-cast ${order.modelId} failed`, response.error);
    else order.done({ position: new Float32Array(response.position), normal: new Float32Array(response.normal), color: new Float32Array(response.color) });
    this.pump();
  }

  private dropWorker(): void {
    this.worker?.terminate();
    this.worker = null;
    if (this.current) this.queue.unshift(this.current);
    this.current = null;
    this.pump();
  }
}

function dieCastGeometry(arrays: DieCastArrays): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(arrays.position, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(arrays.normal, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(arrays.color, 3));
  geometry.computeBoundingSphere();
  return geometry;
}

/* ------------------------------------------------------------------ *
 *  The room                                                          *
 * ------------------------------------------------------------------ */

export function buildRoomScene(lowDetail: boolean): RoomScene {
  const k = new Kit();
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x050608);
  // Haze outside only: inside the room nothing is far enough to feel it.
  scene.fog = new THREE.Fog(0x2a2840, 40, 260);

  const wallMat = k.mat({ map: wallpaper(1, 1), roughness: 0.92 });
  const floorMat = k.mat({ map: floorboards(ROOM_W / 1.6, ROOM_D / 1.6), roughness: 0.62 });
  const plaster = k.mat({ color: 0xd6cfbf, roughness: 0.9 });
  const ceilMat = k.mat({ color: 0xb9b0a0, roughness: 0.95 });
  const woodDark = k.mat({ color: 0x4a2f1e, roughness: 0.55 });
  const woodMid = k.mat({ color: 0x7a5236, roughness: 0.5 });
  const woodPale = k.mat({ color: 0xa47a52, roughness: 0.55 });
  const paintWhite = k.mat({ color: 0xd8d2c2, roughness: 0.5 });
  const metalDark = k.mat({ color: 0x2a2a2c, roughness: 0.4, metalness: 0.7 });
  const brass = k.mat({ color: 0xb08a45, roughness: 0.35, metalness: 0.85 });
  const steel = k.mat({ color: 0xcfcac0, roughness: 0.25, metalness: 0.95 });
  const red = k.mat({ color: 0xa8302a, roughness: 0.38, metalness: 0.3 });
  // Standard, as everything else in the room: a physical material with none of its
  // extras set draws the same and was a program of its own.
  const glass = k.mat({ color: 0x9fb4d0, transparent: true, opacity: 0.1, roughness: 0.05, metalness: 0, depthWrite: false });
  const toyMat = k.mat({ vertexColors: true, roughness: 0.28, metalness: 0.25, side: THREE.DoubleSide });

  /* --- The shell ---------------------------------------------------- */

  const floor = k.mesh(new THREE.PlaneGeometry(ROOM_W, ROOM_D), floorMat, 0, 0, 0, false);
  floor.rotation.x = -Math.PI / 2;
  // The ceiling casts: without it the moon, high behind the house, lights the walls' tops.
  const ceiling = k.mesh(new THREE.PlaneGeometry(ROOM_W, ROOM_D), ceilMat, 0, ROOM_H, 0, true);
  ceiling.rotation.x = Math.PI / 2;
  scene.add(floor, ceiling);
  const wall = (w: number, h: number, x: number, y: number, z: number, ry: number): THREE.Mesh => {
    const m = k.mesh(k.wallPlane(w, h, 0.9), wallMat, x, y, z);
    m.rotation.y = ry;
    return m;
  };
  scene.add(
    wall(WIN.x0 - X0, ROOM_H, (X0 + WIN.x0) / 2, ROOM_H / 2, Z0, 0),
    wall(X1 - WIN.x1, ROOM_H, (WIN.x1 + X1) / 2, ROOM_H / 2, Z0, 0),
    wall(WIN.x1 - WIN.x0, WIN.y0, (WIN.x0 + WIN.x1) / 2, WIN.y0 / 2, Z0, 0),
    wall(WIN.x1 - WIN.x0, ROOM_H - WIN.y1, (WIN.x0 + WIN.x1) / 2, (WIN.y1 + ROOM_H) / 2, Z0, 0),
    wall(ROOM_D, ROOM_H, X0, ROOM_H / 2, 0, Math.PI / 2),
    wall(ROOM_D, ROOM_H, X1, ROOM_H / 2, 0, -Math.PI / 2),
    wall(ROOM_W, ROOM_H, 0, ROOM_H / 2, Z1, Math.PI),
  );
  // The back wall's body, behind the paper: the moon's shadow is cast by it, and the
  // window's reveal is cut through it.
  const backZ0 = Z0 - 0.004;
  const backZ1 = Z0 - WALL_T;
  scene.add(
    k.span(X0, 0, backZ1, WIN.x0, ROOM_H, backZ0, plaster),
    k.span(WIN.x1, 0, backZ1, X1, ROOM_H, backZ0, plaster),
    k.span(WIN.x0, 0, backZ1, WIN.x1, WIN.y0 - 0.03, backZ0, plaster),
    k.span(WIN.x0, WIN.y1, backZ1, WIN.x1, ROOM_H, backZ0, plaster),
  );
  // Skirting boards, each stopping short of the next at the corners, and on the right
  // wall broken for the door's architrave rather than running behind it.
  const doorZ0 = 1.05 - 0.535;
  const doorZ1 = 1.05 + 0.535;
  for (const [w, x, z, ry] of [
    [ROOM_W - 0.04, 0, Z0 + 0.011, 0],
    [ROOM_W - 0.04, 0, Z1 - 0.011, 0],
    [ROOM_D - 0.04, X0 + 0.011, 0, Math.PI / 2],
    [doorZ0 - (Z0 + 0.02), X1 - 0.011, (Z0 + 0.02 + doorZ0) / 2, Math.PI / 2],
    [Z1 - 0.02 - doorZ1, X1 - 0.011, (doorZ1 + Z1 - 0.02) / 2, Math.PI / 2],
  ] as const) {
    const b = k.box(w, 0.09, 0.018, woodDark, x, 0.045, z);
    b.rotation.y = ry;
    scene.add(b);
  }

  /* --- The window: deep in the wall, double-glazed -------------------- */

  const wx = (WIN.x0 + WIN.x1) / 2;
  const frameMat = k.mat({ color: 0xd9d2c0, roughness: 0.5 });
  // The interior sill board: a deep painted board, out over the radiator.
  const sillTop = WIN.y0;
  scene.add(k.span(WIN.x0 - 0.12, sillTop - 0.035, Z0 - 0.14, WIN.x1 + 0.12, sillTop, Z0 + 0.16, paintWhite, 0.008));
  // The two sashes: the inner just behind the wall's face, the outer near its back.
  scene.add(
    sash(k, WIN.x0 + 0.005, WIN.x1 - 0.005, sillTop, WIN.y1 - 0.005, Z0 - 0.08, 0.05, 0.055, frameMat, glass),
    sash(k, WIN.x0 + 0.005, WIN.x1 - 0.005, sillTop - 0.03, WIN.y1 - 0.005, Z0 - WALL_T + 0.07, 0.05, 0.055, frameMat, glass),
  );
  // A latch on the inner sash, a brass handle on its mullion.
  scene.add(k.box(0.018, 0.07, 0.02, brass, wx, WIN.y0 + (WIN.y1 - WIN.y0) * 0.45, Z0 - 0.045, 0.005));
  // The outside tin sill under the outer sash, sloping off.
  const tin = k.span(WIN.x0 - 0.05, -0.012, -0.12, WIN.x1 + 0.05, 0, 0.0, k.mat({ color: 0x8a8a86, roughness: 0.4, metalness: 0.6 }));
  tin.position.set(wx, sillTop - 0.05, Z0 - WALL_T - 0.05);
  tin.rotation.x = 0.18;
  scene.add(tin);
  // Curtains: hanging cloth with folds, on a rod, clear of the shelf.
  const curtainMat = k.mat({ color: 0x5e2a2a, roughness: 0.9, side: THREE.DoubleSide });
  const curtains: THREE.Mesh[] = [];
  for (const [x, flip] of [[WIN.x0 - 0.2, 1], [WIN.x1 + 0.2, -1]] as const) {
    const geometry = new THREE.PlaneGeometry(0.46, 2.2, 24, 12);
    const p = geometry.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const u = p.getX(i) / 0.46 + 0.5;
      p.setZ(i, Math.sin(u * Math.PI * 6) * 0.035 * (0.6 + 0.4 * u));
    }
    geometry.computeVertexNormals();
    const c = k.mesh(geometry, curtainMat, x, 2.25 - 1.1, Z0 + 0.16);
    c.scale.x = flip;
    curtains.push(c);
    scene.add(c);
  }
  scene.add(k.rod(new THREE.Vector3(WIN.x0 - 0.5, 2.3, Z0 + 0.16), new THREE.Vector3(WIN.x1 + 0.5, 2.3, Z0 + 0.16), 0.012, brass));
  for (const x of [WIN.x0 - 0.47, WIN.x1 + 0.47]) scene.add(k.rod(new THREE.Vector3(x, 2.3, Z0), new THREE.Vector3(x, 2.3, Z0 + 0.16), 0.008, brass));
  // A radiator under the sill: fins on two pipes.
  for (let i = 0; i < 9; i++) scene.add(k.box(0.06, 0.5, 0.08, paintWhite, WIN.x0 + 0.12 + i * 0.13, 0.42, Z0 + 0.09, 0.02));
  for (const y of [0.24, 0.6]) scene.add(k.rod(new THREE.Vector3(WIN.x0 + 0.06, y, Z0 + 0.09), new THREE.Vector3(WIN.x0 + 0.12 + 8 * 0.13 + 0.06, y, Z0 + 0.09), 0.015, paintWhite));

  /* --- Outside: the desert at night, the road passing the house ------ */

  const sky = new THREE.Mesh(new THREE.SphereGeometry(190, 48, 24), new THREE.MeshBasicMaterial({ map: nightSky(), side: THREE.BackSide, fog: false, toneMapped: false }));
  k.disposables.push(sky.geometry, sky.material as THREE.Material, (sky.material as THREE.MeshBasicMaterial).map!);
  sky.position.y = GROUND_Y;
  scene.add(sky);
  // The moon low in the window's upper right, where the light through it comes from.
  const moonDir = new THREE.Vector3(0.14, 0.2, -1).normalize();
  const moonSprite = new THREE.Mesh(new THREE.PlaneGeometry(26, 26), new THREE.MeshBasicMaterial({ map: moonDisc(), transparent: true, fog: false, toneMapped: false, depthWrite: false }));
  k.disposables.push(moonSprite.geometry, moonSprite.material as THREE.Material, (moonSprite.material as THREE.MeshBasicMaterial).map!);
  moonSprite.position.copy(moonDir).multiplyScalar(170).add(new THREE.Vector3(0, 1.3, 0));
  moonSprite.lookAt(0, 1.3, 0);
  scene.add(moonSprite);
  // Outside lies under the moon at a grazing angle: fully rough so the sand and the road
  // do not catch its sheen, and darker than daylight's, seen from a lit room. (They were
  // Lambert, two programs of their own; the room is otherwise all Standard.)
  const groundMat = k.mat({ map: sandGround(), color: 0x8a7480, roughness: 1, metalness: 0 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), groundMat);
  k.disposables.push(ground.geometry);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = GROUND_Y;
  scene.add(ground);
  // The road: from the left, close in front of the house, away to the right and the
  // horizon — the house stands beside it, not across it.
  const roadPath = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-70, GROUND_Y + 0.02, -15),
    new THREE.Vector3(-18, GROUND_Y + 0.02, -18),
    new THREE.Vector3(6, GROUND_Y + 0.02, -26),
    new THREE.Vector3(24, GROUND_Y + 0.02, -50),
    new THREE.Vector3(36, GROUND_Y + 0.02, -100),
    new THREE.Vector3(42, GROUND_Y + 0.02, -175),
  ]);
  {
    const segments = 160;
    const half = 3.2;
    const positions: number[] = [];
    const uvs: number[] = [];
    const index: number[] = [];
    const length = roadPath.getLength();
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const p = roadPath.getPointAt(t);
      const tangent = roadPath.getTangentAt(t);
      const side = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
      positions.push(p.x + side.x * half, p.y, p.z + side.z * half, p.x - side.x * half, p.y, p.z - side.z * half);
      const v = (t * length) / 9;
      uvs.push(0, v, 1, v);
      if (i < segments) index.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(index);
    geometry.computeVertexNormals();
    const roadMat = k.mat({ map: roadSurface(), color: 0x8a8690, roughness: 1, metalness: 0, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const road = new THREE.Mesh(geometry, roadMat);
    k.disposables.push(geometry);
    scene.add(road);
    // Telegraph poles along its far side, wires between them.
    const poleMat = k.mat({ color: 0x2c2420, roughness: 0.9 });
    const tops: THREE.Vector3[] = [];
    for (let i = 1; i < 14; i++) {
      const t = i / 14;
      const p = roadPath.getPointAt(t);
      const tangent = roadPath.getTangentAt(t);
      const side = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
      const at = p.clone().addScaledVector(side, -6);
      const top = at.clone().setY(GROUND_Y + 7);
      const pole = k.rod(at.clone().setY(GROUND_Y), top, 0.11, poleMat, 6);
      pole.castShadow = false;
      const bar = k.rod(top.clone().addScaledVector(tangent.clone().cross(new THREE.Vector3(0, 1, 0)), 0.9).setY(GROUND_Y + 6.6), top.clone().addScaledVector(tangent.clone().cross(new THREE.Vector3(0, 1, 0)), -0.9).setY(GROUND_Y + 6.6), 0.06, poleMat, 5);
      bar.castShadow = false;
      scene.add(pole, bar);
      tops.push(top.setY(GROUND_Y + 6.6));
    }
    const wirePoints: THREE.Vector3[] = [];
    for (let i = 0; i + 1 < tops.length; i++) {
      for (let s = 0; s < 12; s++) {
        const u = s / 12;
        const p = tops[i]!.clone().lerp(tops[i + 1]!, u);
        p.y -= Math.sin(Math.PI * u) * 0.6;
        wirePoints.push(p);
      }
    }
    const wire = new THREE.Line(new THREE.BufferGeometry().setFromPoints(wirePoints), new THREE.LineBasicMaterial({ color: 0x14121a }));
    k.disposables.push(wire.geometry, wire.material as THREE.Material);
    scene.add(wire);
  }
  // Saguaros about the desert, dark against the sand.
  {
    const cactusMat = k.mat({ color: 0x2f4a2a, roughness: 0.8 });
    const r = rng(17);
    for (const [x, z, s] of [[-9, -34, 1.3], [3, -40, 1], [-26, -30, 0.9], [-22, -55, 1.5], [30, -78, 1.6], [-4, -70, 1.2], [14, -110, 1.8]] as const) {
      const base = new THREE.Vector3(x, GROUND_Y, z);
      const h = 3.2 * s;
      const trunk = k.mesh(new THREE.CapsuleGeometry(0.28 * s, h, 4, 8), cactusMat, x, GROUND_Y + h / 2, z, false);
      scene.add(trunk);
      for (const side of [-1, 1]) {
        if (r() < 0.25) continue;
        const ay = GROUND_Y + h * (0.35 + r() * 0.25);
        const out = base.clone().set(x + side * 0.75 * s, ay, z);
        const up = out.clone().setY(ay + h * 0.35);
        scene.add(k.rod(new THREE.Vector3(x, ay, z), out, 0.18 * s, cactusMat, 8), k.rod(out, up, 0.18 * s, cactusMat, 8));
      }
    }
  }
  // Mesas on the horizon: flat-topped, steep-sided, in the haze.
  {
    const mesaMat = k.mat({ color: 0x6a4248, roughness: 1 });
    for (const [x, z, w, h] of [[-60, -110, 40, 16], [-14, -125, 22, 11], [52, -115, 34, 19], [95, -90, 26, 12]] as const) {
      const shape = new THREE.Shape();
      shape.moveTo(-w / 2, 0);
      shape.lineTo(-w / 2 + w * 0.12, h * 0.85);
      shape.lineTo(-w / 2 + w * 0.2, h);
      shape.lineTo(w / 2 - w * 0.22, h);
      shape.lineTo(w / 2 - w * 0.1, h * 0.8);
      shape.lineTo(w / 2, 0);
      shape.closePath();
      const mesa = k.mesh(new THREE.ExtrudeGeometry(shape, { depth: w * 0.5, bevelEnabled: false }), mesaMat, x, GROUND_Y, z, false);
      mesa.lookAt(0, GROUND_Y, 0);
      scene.add(mesa);
    }
  }

  /* --- The bed, the wall carpet, the bedside table -------------------- */

  const carpet = k.mesh(new THREE.PlaneGeometry(1.75, 1.2), k.decal({ map: wallCarpet(), roughness: 1 }), X0 + 0.006, 1.45, -0.55, false);
  carpet.rotation.y = Math.PI / 2;
  scene.add(carpet);

  const bx = X0 + 0.5;
  scene.add(
    k.box(0.98, 0.3, 2.0, woodMid, bx, 0.25, -0.55, 0.02),
    k.box(0.06, 0.1, 0.06, woodDark, bx - 0.44, 0.05, 0.4),
    k.box(0.06, 0.1, 0.06, woodDark, bx + 0.44, 0.05, 0.4),
    k.box(1.04, 0.95, 0.07, woodMid, bx, 0.6, -1.6, 0.02),
    k.box(1.04, 0.55, 0.06, woodMid, bx, 0.42, 0.48, 0.02),
    k.box(0.92, 0.18, 1.94, k.mat({ color: 0xd9d0bc, roughness: 0.9 }), bx, 0.48, -0.55, 0.06),
  );
  {
    const geometry = new THREE.BoxGeometry(1.0, 0.08, 1.45, 30, 2, 40);
    const p = geometry.getAttribute('position');
    const r = rng(77);
    const bumps = Array.from({ length: 8 }, () => [r() - 0.5, (r() - 0.5) * 1.4, 0.03 + r() * 0.05] as const);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const z = p.getZ(i);
      let y = p.getY(i);
      for (const [bx2, bz, h] of bumps) y += h * Math.exp(-((x - bx2) ** 2 + (z - bz) ** 2) / 0.04);
      y -= Math.max(0, Math.abs(x) - 0.44) * 2.2;
      p.setY(i, y);
    }
    geometry.computeVertexNormals();
    scene.add(k.mesh(geometry, k.mat({ map: quilt(), roughness: 0.95 }), bx, 0.6, -0.25));
  }
  {
    const geometry = new RoundedBoxGeometry(0.62, 0.14, 0.4, 4, 0.06);
    const p = geometry.getAttribute('position');
    for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) * (1 - (p.getX(i) / 0.34) ** 2 * 0.5));
    geometry.computeVertexNormals();
    const pillow = k.mesh(geometry, k.mat({ color: 0xece4d2, roughness: 0.95 }), bx, 0.64, -1.3);
    pillow.rotation.x = -0.25;
    scene.add(pillow);
  }
  // The bedside table: a top over a carcass of panels, a drawer with a brass knob, an
  // open shelf of books below, on four tapered legs.
  {
    const t = new THREE.Group();
    const W = 0.42;
    const D = 0.36;
    const y0 = 0.12;
    const y1 = 0.56;
    const veneer = k.mat({ color: 0x8a5a36, roughness: 0.42 });
    t.add(
      k.span(-W / 2, y0, -D / 2, -W / 2 + 0.018, y1, D / 2, veneer),
      k.span(W / 2 - 0.018, y0, -D / 2, W / 2, y1, D / 2, veneer),
      k.span(-W / 2 + 0.018, y0, -D / 2, W / 2 - 0.018, y0 + 0.018, D / 2, veneer),
      k.span(-W / 2 + 0.018, 0.36, -D / 2 + 0.01, W / 2 - 0.018, 0.378, D / 2, veneer),
      k.span(-W / 2 + 0.019, y0 + 0.018, -D / 2, W / 2 - 0.019, y1, -D / 2 + 0.01, woodDark),
      k.box(W + 0.04, 0.026, D + 0.03, veneer, 0, y1 + 0.013, 0.005, 0.008),
      // The drawer front fills the carcass's upper opening, a hair inside its edges.
      k.span(-W / 2 + 0.02, 0.38, D / 2 - 0.018, W / 2 - 0.02, y1 - 0.002, D / 2 + 0.002, k.mat({ color: 0x7a4c2c, roughness: 0.4 }), 0.004),
      k.mesh(new THREE.SphereGeometry(0.014, 12, 8), brass, 0, 0.47, D / 2 + 0.014),
    );
    // Books in the open shelf, upright and one lying.
    const r = rng(29);
    let bxk = -W / 2 + 0.03;
    for (let i = 0; i < 6; i++) {
      const w = 0.025 + r() * 0.02;
      const h = 0.14 + r() * 0.06;
      t.add(k.span(bxk, y0 + 0.018, -D / 2 + 0.02, bxk + w, y0 + 0.018 + h, D / 2 - 0.04, k.mat({ color: new THREE.Color().setHSL(r(), 0.4, 0.3).getHex(), roughness: 0.7 })));
      bxk += w + 0.002;
    }
    for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
      const leg = k.mesh(new THREE.CylinderGeometry(0.016, 0.01, y0, 10), woodDark, lx * (W / 2 - 0.03), y0 / 2, lz * (D / 2 - 0.03));
      t.add(leg);
    }
    t.position.set(X0 + 1.25, 0, -1.48);
    scene.add(t);
  }
  // The alarm clock «Маяк» on it, stopped at ten past ten, its alarm hand on seven.
  {
    const alarm = new THREE.Group();
    const bodyMat = k.mat({ color: 0xb8302a, roughness: 0.3, metalness: 0.4 });
    const body = k.mesh(new THREE.CylinderGeometry(0.068, 0.068, 0.05, 32), bodyMat);
    body.rotation.x = Math.PI / 2;
    const rim = k.mesh(new THREE.TorusGeometry(0.066, 0.006, 8, 32), steel, 0, 0, 0.026);
    const face = k.mesh(new THREE.CircleGeometry(0.06, 32), k.decal({ map: clockFace('МАЯК', true), roughness: 0.6 }), 0, 0, 0.0263, false);
    const hand = (len: number, width: number, z: number, angle: number, color: number): THREE.Mesh => {
      const g = new THREE.BoxGeometry(width, len, 0.0012);
      g.translate(0, len / 2 - 0.006, 0);
      const m = k.mesh(g, k.mat({ color, roughness: 0.4, metalness: 0.3 }), 0, 0, z, false);
      m.rotation.z = -angle;
      return m;
    };
    const hourAngle = ((10 + 8 / 60) / 12) * Math.PI * 2;
    const minuteAngle = (8 / 60) * Math.PI * 2;
    alarm.add(
      body,
      rim,
      face,
      hand(0.03, 0.005, 0.0275, (7 / 12) * Math.PI * 2, 0xb8302a),
      hand(0.034, 0.006, 0.029, hourAngle, 0x161210),
      hand(0.05, 0.004, 0.0305, minuteAngle, 0x161210),
      k.mesh(new THREE.SphereGeometry(0.004, 8, 6), brass, 0, 0, 0.032),
    );
    for (const sx of [-1, 1]) {
      const bell = k.mesh(new THREE.SphereGeometry(0.028, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), steel, sx * 0.042, 0.072, 0);
      bell.rotation.z = -sx * 0.4;
      alarm.add(bell);
      alarm.add(k.rod(new THREE.Vector3(sx * 0.04, -0.06, 0), new THREE.Vector3(sx * 0.05, -0.078, 0.01), 0.004, steel, 6));
    }
    alarm.add(k.rod(new THREE.Vector3(0, 0.068, 0), new THREE.Vector3(0, 0.1, 0), 0.003, steel, 6), k.mesh(new THREE.SphereGeometry(0.009, 10, 8), steel, 0, 0.104, 0));
    alarm.position.set(X0 + 1.2, 0.61 + 0.078, -1.42);
    alarm.rotation.y = 0.55;
    scene.add(alarm);
  }

  /* --- The play mat and the toy car on it ------------------------------ */

  const MAT = { x: 0.15, z: 0.15, w: 1.6, d: 1.1 };
  const matMesh = k.mesh(new THREE.PlaneGeometry(MAT.w, MAT.d), k.decal({ map: playMat(), roughness: 1 }), MAT.x, 0.003, MAT.z, false);
  matMesh.rotation.x = -Math.PI / 2;
  scene.add(matMesh);
  /** A point on the mat's canvas (1024 × 704) in the room. */
  const onMat = (u: number, v: number): THREE.Vector3 => new THREE.Vector3(MAT.x - MAT.w / 2 + (u / 1024) * MAT.w, 0.003, MAT.z - MAT.d / 2 + (v / 704) * MAT.d);
  const toyAt = onMat(MAT_LOOP.x, 420);

  /* --- The desk, its lamp, the map, the chair -------------------------- */

  const dx = X1 - 0.38;
  const dz = -1.0;
  const deskTop = 0.77;
  scene.add(
    k.box(0.72, 0.04, 1.3, woodPale, dx, deskTop - 0.02, dz, 0.01),
    k.box(0.68, 0.7, 0.42, woodMid, dx, 0.37, dz - 0.42, 0.01),
    k.box(0.04, 0.73, 0.04, woodDark, dx - 0.32, 0.365, dz + 0.6),
    k.box(0.04, 0.73, 0.04, woodDark, dx + 0.32, 0.365, dz + 0.6),
  );
  for (let i = 0; i < 3; i++) {
    const y = 0.58 - i * 0.22;
    scene.add(k.span(dx - 0.346, y - 0.09, dz - 0.6, dx - 0.341, y + 0.09, dz - 0.24, woodPale, 0.002));
    scene.add(k.box(0.025, 0.018, 0.08, brass, dx - 0.36, y, dz - 0.42, 0.005));
  }
  // Homework left as it was: things on the desk read towards the chair (+x is the top of
  // a page), so each lies in a group turned a quarter round from the room's axes.
  const paper = k.mat({ color: 0xece4d0, roughness: 0.85 });
  /** A group on the desk at (x, z), page-up towards the wall, turned `turn` more. */
  const onDesk = (x: number, z: number, turn: number): THREE.Group => {
    const g = new THREE.Group();
    g.position.set(x, deskTop, z);
    g.rotation.y = -Math.PI / 2 + turn;
    scene.add(g);
    return g;
  };
  /**
   * A book lying open, `w` across the spread, `d` top to bottom: a cover board a little
   * wider than the pages, the block of pages on it, the spread printed on its top, its
   * paper toned by `shade` (the one under the lamp's hot spot darker, or it burns white).
   */
  const openBook = (g: THREE.Group, w: number, d: number, cover: number, spread: THREE.Texture, shade: number): void => {
    const board = 0.003;
    const block = 0.006;
    g.add(
      k.box(w + 0.012, board, d + 0.012, k.mat({ color: cover, roughness: 0.7 }), 0, board / 2, 0),
      k.box(w, block, d, paper, 0, board + block / 2, 0),
    );
    const page = k.mesh(new THREE.PlaneGeometry(w, d), k.decal({ map: spread, color: shade, roughness: 0.85 }), 0, board + block + 0.0004, 0, false);
    page.rotation.x = -Math.PI / 2;
    g.add(page);
  };
  /**
   * A closed book `w` wide, `d` tall, `h` thick: two boards, the spine, and the pages
   * between them, each piece touching the next; its cover drawn on the top board.
   */
  const closedBook = (g: THREE.Group, y: number, w: number, d: number, h: number, cloth: number, cover: THREE.Texture | null): void => {
    const board = 0.002;
    const clothMat = k.mat({ color: cloth, roughness: 0.75 });
    g.add(
      k.span(-w / 2, y, -d / 2, w / 2, y + board, d / 2, clothMat),
      k.span(-w / 2, y + h - board, -d / 2, w / 2, y + h, d / 2, clothMat),
      k.span(-w / 2, y + board, -d / 2, -w / 2 + board, y + h - board, d / 2, clothMat),
      k.span(-w / 2 + board, y + board, -d / 2 + 0.003, w / 2 - 0.003, y + h - board, d / 2 - 0.003, paper),
    );
    if (cover) {
      const face = k.mesh(new THREE.PlaneGeometry(w, d), k.decal({ map: cover, roughness: 0.7 }), 0, y + h + 0.0004, 0, false);
      face.rotation.x = -Math.PI / 2;
      g.add(face);
    }
  };
  /** A pencil lying from `a` to `b` on the desk: a hexagonal painted body, the sharpened wood and the lead. */
  const pencil = (ax: number, az: number, bx2: number, bz: number, paint: number): void => {
    const r = 0.0035;
    const a = new THREE.Vector3(ax, deskTop + r, az);
    const b = new THREE.Vector3(bx2, deskTop + r, bz);
    const dir = b.clone().sub(a).normalize();
    const woodEnd = b.clone().addScaledVector(dir, -0.016);
    scene.add(k.rod(a, woodEnd, r, k.mat({ color: paint, roughness: 0.45 }), 6));
    // The sharpened wood a frustum, the lead the cone that finishes it: they meet at one
    // circle rather than one cone lying in the other.
    const cone = k.mesh(new THREE.CylinderGeometry(r * 0.35, r, 0.0104, 6), k.mat({ color: 0xd9b48a, roughness: 0.8 }));
    cone.position.copy(woodEnd).addScaledVector(dir, 0.0052);
    cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    scene.add(cone);
    const lead = k.mesh(new THREE.ConeGeometry(r * 0.35, 0.0056, 6), k.mat({ color: 0x2a2a2c, roughness: 0.5 }));
    lead.position.copy(b).addScaledVector(dir, -0.0028);
    lead.quaternion.copy(cone.quaternion);
    scene.add(lead);
  };
  /** A ballpoint pen lying from `a` to `b`: a clear-ish body, its cap and the cap's clip. */
  const pen = (ax: number, az: number, bx2: number, bz: number, ink: number): void => {
    const r = 0.0042;
    const a = new THREE.Vector3(ax, deskTop + r, az);
    const b = new THREE.Vector3(bx2, deskTop + r, bz);
    const cut = a.clone().lerp(b, 0.36);
    scene.add(
      k.rod(cut, b, r, k.mat({ color: 0xd8d6cc, roughness: 0.25 }), 10),
      k.rod(a, cut, r * 1.08, k.mat({ color: ink, roughness: 0.3 }), 10),
    );
  };
  /** An eraser on the desk: a pink end and, on the two-tone kind, a blue one, touching. */
  const eraser = (x: number, z: number, turn: number, twoTone: boolean): void => {
    const g = onDesk(x, z, turn);
    const h = 0.011;
    g.add(k.span(-0.022, 0, -0.012, twoTone ? 0.004 : 0.022, h, 0.012, k.mat({ color: 0xe89a9a, roughness: 0.9 }), 0.002));
    if (twoTone) g.add(k.span(0.004, 0, -0.012, 0.022, h, 0.012, k.mat({ color: 0x4f6fb8, roughness: 0.9 }), 0.002));
  };

  // The exercise book under the lamp, open on cars drawn over the lesson.
  const bookAt = new THREE.Vector3(dx - 0.1, deskTop, dz + 0.02);
  openBook(onDesk(bookAt.x, bookAt.z, 0.12), 0.3, 0.205, 0x3f6a8a, exerciseSpread(), 0x8c8882);
  // A textbook open beside it, towards the back.
  openBook(onDesk(dx - 0.16, dz - 0.42, -0.3), 0.26, 0.17, 0x7a3a2a, printedSpread(), 0xffffff);
  // Three closed textbooks stacked by the wall, each a little askew on the one below.
  {
    const stack = onDesk(dx + 0.23, dz + 0.12, 0.06);
    const books: [number, number, number, number, THREE.Texture | null][] = [
      [0.17, 0.24, 0.014, 0x2f5a3a, null],
      [0.165, 0.235, 0.012, 0x6a2a3a, null],
      [0.17, 0.24, 0.016, 0x2a4a7a, textbookCover('ГЕОМЕТРИЯ', '#2a4a7a', 'triangle')],
    ];
    let y = 0;
    books.forEach(([w, d, h, cloth, cover], i) => {
      const g = new THREE.Group();
      g.rotation.y = [0, 0.09, -0.05][i]!;
      closedBook(g, y, w, d, h, cloth, cover);
      stack.add(g);
      y += h;
    });
  }
  // The ruler along the desk's front edge.
  {
    const g = onDesk(dx - 0.29, dz - 0.05, 0.05);
    g.add(k.box(0.3, 0.0025, 0.03, k.mat({ color: 0xc9a868, roughness: 0.6 }), 0, 0.00125, 0));
    const face = k.mesh(new THREE.PlaneGeometry(0.3, 0.03), k.decal({ map: rulerFace(), roughness: 0.6 }), 0, 0.0029, 0, false);
    face.rotation.x = -Math.PI / 2;
    g.add(face);
  }
  pencil(dx - 0.25, dz + 0.25, dx - 0.14, dz + 0.34, 0xd8a830);
  pencil(dx + 0.03, dz - 0.22, dx + 0.06, dz - 0.37, 0x3a6a3a);
  pen(dx - 0.3, dz + 0.2, dx - 0.24, dz + 0.34, 0x2a3a9a);
  eraser(dx + 0.06, dz + 0.16, 0.4, true);
  eraser(dx + 0.0, dz - 0.36, -0.2, false);
  // The pencil cup by the lamp, pencils and a pen standing in it.
  {
    const cupAt = new THREE.Vector3(dx + 0.24, deskTop, dz - 0.15);
    scene.add(k.mesh(new THREE.CylinderGeometry(0.04, 0.036, 0.09, 20), k.mat({ color: 0xe8e0cc, roughness: 0.3 }), cupAt.x, deskTop + 0.045, cupAt.z));
    for (const [ox, oz, h, color] of [[-0.012, 0.01, 0.17, 0xd8a830], [0.014, -0.006, 0.16, 0xa8302a], [0.002, 0.016, 0.15, 0x2a3a9a], [-0.006, -0.016, 0.175, 0x3a6a3a]] as const) {
      const foot = cupAt.clone().add(new THREE.Vector3(ox * 0.5, 0.03, oz * 0.5));
      const top = cupAt.clone().add(new THREE.Vector3(ox * 3, h, oz * 3));
      scene.add(k.rod(foot, top, 0.0035, k.mat({ color, roughness: 0.45 }), 6));
    }
  }
  // The desk lamp, a Soviet articulated one: foot at the back corner, an arm up and an
  // arm out, the shade over the exercise book and pointing at it. None of it casts a shadow: its
  // own light is inside it.
  const lampMat = k.mat({ color: 0x2f4a3a, roughness: 0.35, metalness: 0.5 });
  const footAt = new THREE.Vector3(dx + 0.2, deskTop, dz - 0.5);
  const elbow = new THREE.Vector3(dx + 0.17, deskTop + 0.42, dz - 0.32);
  const shadeAt = new THREE.Vector3(dx + 0.02, deskTop + 0.36, dz - 0.02);
  const aimAt = bookAt.clone();
  const lampParts: THREE.Mesh[] = [
    k.mesh(new THREE.CylinderGeometry(0.075, 0.085, 0.025, 28), lampMat, footAt.x, footAt.y + 0.0125, footAt.z),
    k.rod(footAt.clone().setY(deskTop + 0.02), elbow, 0.009, metalDark),
    k.rod(elbow, shadeAt, 0.009, metalDark),
    k.mesh(new THREE.SphereGeometry(0.016, 12, 8), metalDark, elbow.x, elbow.y, elbow.z),
  ];
  const aim = aimAt.clone().sub(shadeAt).normalize();
  const shade = k.mesh(new THREE.ConeGeometry(0.1, 0.15, 28, 1, true), lampMat, 0, 0, 0);
  const shadeInside = k.mesh(new THREE.ConeGeometry(0.098, 0.148, 28, 1, true), k.mat({ color: 0xf2e6c8, emissive: 0xffc27a, emissiveIntensity: 0.35, side: THREE.BackSide }), 0, 0, 0);
  for (const m of [shade, shadeInside]) {
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), aim);
    m.position.copy(shadeAt).addScaledVector(aim, 0.05);
  }
  (shade.material as THREE.MeshStandardMaterial).side = THREE.FrontSide;
  const bulbAt = shadeAt.clone().addScaledVector(aim, 0.03);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.026, 12, 8), new THREE.MeshBasicMaterial({ color: 0xfff1c8 }));
  k.disposables.push(bulb.geometry, bulb.material as THREE.Material);
  bulb.position.copy(bulbAt);
  for (const m of [...lampParts, shade, shadeInside]) {
    m.castShadow = false;
    scene.add(m);
  }
  scene.add(bulb);
  // An old valve radio at the desk's front corner, its dial to the room.
  {
    const radio = new THREE.Group();
    radio.add(
      k.box(0.34, 0.2, 0.16, k.mat({ color: 0x5a3a22, roughness: 0.4 }), 0, 0.1, 0, 0.015),
      k.mesh(new THREE.PlaneGeometry(0.2, 0.07), k.decal({ color: 0xd9c89a, roughness: 0.7, emissive: 0x5a4020, emissiveIntensity: 0.5 }), -0.045, 0.14, 0.0815, false),
      k.mesh(new THREE.PlaneGeometry(0.09, 0.12), k.decal({ color: 0x2a2018, roughness: 0.9 }), 0.105, 0.1, 0.0815, false),
    );
    for (const x of [-0.11, -0.03]) {
      const knob = k.mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.018, 16), k.mat({ color: 0x1a1410, roughness: 0.4 }), x, 0.055, 0.088);
      knob.rotation.x = Math.PI / 2;
      radio.add(knob);
    }
    radio.position.set(dx + 0.12, deskTop, dz + 0.44);
    radio.rotation.y = -Math.PI / 2;
    scene.add(radio);
  }
  // The chair at the desk, turned a little out.
  {
    const chair = new THREE.Group();
    const seatY = 0.45;
    chair.add(k.box(0.42, 0.03, 0.4, woodMid, 0, seatY, 0, 0.01));
    for (const [cx2, cz] of [[-0.18, -0.17], [0.18, -0.17], [-0.18, 0.17], [0.18, 0.17]] as const) {
      chair.add(k.box(0.032, seatY - 0.015, 0.032, woodDark, cx2, (seatY - 0.015) / 2, cz));
    }
    for (const cx2 of [-0.18, 0.18]) chair.add(k.box(0.032, 0.48, 0.032, woodDark, cx2, seatY + 0.255, 0.17));
    chair.add(k.box(0.36, 0.16, 0.02, woodMid, 0, seatY + 0.36, 0.17, 0.008), k.box(0.36, 0.04, 0.02, woodMid, 0, seatY + 0.16, 0.17, 0.006));
    // Pulled out into the room and turned to it, as left after homework.
    chair.position.set(dx - 0.62, 0, dz + 0.78);
    chair.rotation.y = Math.PI / 2 + 0.9;
    scene.add(chair);
  }

  /* --- The wall case of die-cast models, the calendar ------------------- */

  // An open case on the wall over the desk, tiers of shelves between two sides, a back
  // panel against the wallpaper: every piece touches the next, none lies in another.
  const CASE = { x0: 1.02, x1: 2.0, side: 0.02, depth: 0.19, board: 0.022 } as const;
  /** The tiers' tops, top first: the models stand on these. */
  const TIERS = [1.92, 1.72, 1.52, 1.32] as const;
  const caseTop = TIERS[0] + 0.18;
  const caseBottom = TIERS[TIERS.length - 1] - CASE.board;
  const caseBack = Z0 + 0.006;
  const caseFront = Z0 + CASE.depth;
  scene.add(
    k.span(CASE.x0, caseBottom, Z0, CASE.x0 + CASE.side, caseTop, caseFront, woodMid),
    k.span(CASE.x1 - CASE.side, caseBottom, Z0, CASE.x1, caseTop, caseFront, woodMid),
    k.span(CASE.x0, caseTop, Z0, CASE.x1, caseTop + CASE.board, caseFront + 0.01, woodMid),
    k.span(CASE.x0 + CASE.side, caseBottom, Z0, CASE.x1 - CASE.side, caseTop, caseBack, woodDark),
  );
  for (const top of TIERS) scene.add(k.span(CASE.x0 + CASE.side, top - CASE.board, caseBack, CASE.x1 - CASE.side, top, caseFront, woodPale));
  /** Each model's place on the case, in the catalogue's order, left to right and down. */
  const models = new Map<string, THREE.Vector3>();
  {
    const perTier = Math.ceil(CAR_MODELS.length / TIERS.length);
    const slot = (CASE.x1 - CASE.x0 - 2 * CASE.side) / perTier;
    CAR_MODELS.forEach((model, i) => {
      const tier = Math.floor(i / perTier);
      const inTier = Math.min(perTier, CAR_MODELS.length - tier * perTier);
      const x = (CASE.x0 + CASE.x1) / 2 + (i - tier * perTier - (inTier - 1) / 2) * slot;
      models.set(model.id, new THREE.Vector3(x, TIERS[tier]! + 0.0002, (caseBack + caseFront) / 2 + 0.01));
    });
  }
  // The calendar: a paper page, the photograph laid on it, a red binding strip, on a nail;
  // over the bed's head, left of the window.
  const calW = 0.36;
  const calH = 0.54;
  const calAt = new THREE.Vector3(-1.7, 1.78, Z0 + 0.006);
  const calPage = k.mesh(new THREE.PlaneGeometry(calW, calH), k.decal({ map: calendarPage(CALENDAR_YEAR), roughness: 0.8 }), calAt.x, calAt.y, calAt.z, false);
  scene.add(calPage);
  scene.add(k.box(calW + 0.01, 0.022, 0.008, k.mat({ color: 0x8a1e1a, roughness: 0.5 }), calAt.x, calAt.y + calH / 2 + 0.011, calAt.z + 0.004, 0.003));
  scene.add(k.mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.03, 6), steel, calAt.x, calAt.y + calH / 2 + 0.04, calAt.z + 0.008));
  const photoW = calW * (464 / 512);
  const photoH = calH * (330 / 768);
  const photoAt = new THREE.Vector3(calAt.x, calAt.y + calH / 2 - calH * (24 / 768) - photoH / 2, calAt.z + 0.0015);
  // Blank until the photograph is taken (the slow work), but already carrying a map: the
  // photograph then only swaps the texture, and the program the room was compiled with
  // still draws it. Gaining a map would link a new one on the frame it arrived.
  const photoBlank = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  photoBlank.needsUpdate = true;
  k.disposables.push(photoBlank);
  const photoMat = new THREE.MeshBasicMaterial({ color: 0x9a9080, map: photoBlank });
  photoMat.polygonOffset = true;
  photoMat.polygonOffsetFactor = -4;
  photoMat.polygonOffsetUnits = -4;
  k.disposables.push(photoMat);
  const photo = k.mesh(new THREE.PlaneGeometry(photoW, photoH), photoMat, photoAt.x, photoAt.y, photoAt.z, false);
  scene.add(photo);

  /* --- The wall clock over the desk -------------------------------------- */

  const wallClock = new THREE.Group();
  {
    const rimMesh = k.mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.04, 36), woodDark);
    rimMesh.rotation.x = Math.PI / 2;
    wallClock.add(rimMesh, k.mesh(new THREE.CircleGeometry(0.135, 36), k.decal({ map: clockFace('', true), roughness: 0.6 }), 0, 0, 0.0213, false));
  }
  const clockHand = (len: number, width: number, z: number, color: number): THREE.Mesh => {
    const g = new THREE.BoxGeometry(width, len, 0.0015);
    g.translate(0, len / 2 - 0.012, 0);
    return k.mesh(g, k.mat({ color, roughness: 0.4 }), 0, 0, z, false);
  };
  const hourHand = clockHand(0.075, 0.01, 0.023, 0x1a1410);
  const minuteHand = clockHand(0.11, 0.007, 0.0255, 0x1a1410);
  const secondHand = clockHand(0.12, 0.003, 0.028, 0xa8302a);
  wallClock.add(hourHand, minuteHand, secondHand);
  wallClock.position.set(X1 - 0.021, 1.98, dz);
  wallClock.rotation.y = -Math.PI / 2;
  scene.add(wallClock);

  /* --- Crayon drawings pinned to the walls ---------------------------------- */

  {
    const pinMat = k.mat({ color: 0xc8302a, roughness: 0.35, metalness: 0.2 });
    /** A sheet `w` wide (4:3) on the wall at (x, y, z), facing `ry`, hung askew by `tilt`, a pin at its top. */
    const drawing = (which: number, x: number, y: number, z: number, ry: number, w: number, tilt: number): void => {
      const h = w * 0.75;
      const sheet = new THREE.Group();
      sheet.position.set(x, y, z);
      sheet.rotation.set(0, ry, 0);
      const page = k.mesh(new THREE.PlaneGeometry(w, h), k.decal({ map: crayonDrawing(which), roughness: 0.95 }), 0, 0, 0.004, false);
      page.rotation.z = tilt;
      const pin = k.mesh(new THREE.SphereGeometry(0.007, 10, 8), pinMat, -Math.sin(tilt) * h * 0.42, Math.cos(tilt) * h * 0.42, 0.011, false);
      sheet.add(page, pin);
      scene.add(sheet);
    };
    // Over the desk, beside the keys.
    drawing(0, X1, 1.42, -0.55, -Math.PI / 2, 0.32, 0.05);
    drawing(3, X1, 1.3, -0.08, -Math.PI / 2, 0.28, -0.06);
    // By the night-light, low, at a child's height.
    drawing(1, X0, 1.25, 0.5, Math.PI / 2, 0.3, -0.04);
    drawing(2, X0, 1.5, 1.02, Math.PI / 2, 0.26, 0.07);
  }

  /* --- The door, its architrave, the key board ----------------------------- */

  {
    const door = new THREE.Group();
    const doorWood = k.mat({ color: 0x6a4428, roughness: 0.45 });
    const panelWood = k.mat({ color: 0x5a3820, roughness: 0.4 });
    door.add(
      k.box(0.88, 2.03, 0.04, doorWood, 0, 1.015, 0.02, 0.006),
      k.box(0.64, 0.72, 0.01, panelWood, 0, 1.5, 0.044, 0.004),
      k.box(0.64, 0.72, 0.01, panelWood, 0, 0.6, 0.044, 0.004),
      k.box(0.03, 0.17, 0.03, brass, 0.36, 1.0, 0.058, 0.01),
      k.box(0.018, 0.045, 0.012, brass, 0.36, 0.9, 0.046, 0.004),
      // The architrave, outside the door's edges: the head over the two sides, none overlapping.
      k.span(-0.53, 0, 0, -0.45, 2.04, 0.025, paintWhite, 0.004),
      k.span(0.45, 0, 0, 0.53, 2.04, 0.025, paintWhite, 0.004),
      k.span(-0.53, 2.04, 0, 0.53, 2.12, 0.025, paintWhite, 0.004),
    );
    door.position.set(X1, 0, 1.05);
    door.rotation.y = -Math.PI / 2;
    scene.add(door);
  }
  const keysAt = new THREE.Vector3(X1, 1.45, 0.3);
  {
    // Wall-local frame: +x along the wall towards the back, +z out of the wall.
    const board = new THREE.Group();
    board.add(k.box(0.36, 0.15, 0.022, woodMid, 0, 0, 0.011, 0.008));
    // Three brass hooks, each one bent outline.
    const hookShape = new THREE.Shape();
    hookShape.moveTo(-0.006, 0);
    hookShape.lineTo(0.006, 0);
    hookShape.lineTo(0.006, 0.034);
    hookShape.lineTo(0.02, 0.034);
    hookShape.lineTo(0.02, 0.046);
    hookShape.lineTo(-0.006, 0.046);
    hookShape.closePath();
    const hookGeo = new THREE.ExtrudeGeometry(hookShape, { depth: 0.008, bevelEnabled: false });
    hookGeo.translate(0, 0, -0.004);
    k.disposables.push(hookGeo);
    for (const x of [-0.11, 0, 0.11]) {
      const hook = new THREE.Mesh(hookGeo, brass);
      hook.castShadow = true;
      hook.receiveShadow = true;
      // Laid on its side: the outline's x out of the board, its y up the wall.
      hook.rotation.y = -Math.PI / 2;
      hook.position.set(x, -0.06, 0.022);
      board.add(hook);
    }
    const blackPlastic = k.mat({ color: 0x141414, roughness: 0.35 });
    // The car's keys on a ring on the left hook, a red leather fob with a brass tag.
    const carKeys = new THREE.Group();
    const ring = k.mesh(new THREE.TorusGeometry(0.02, 0.0028, 8, 28), steel, 0, -0.02, 0);
    ring.rotation.y = 0.5;
    const ignition = extrudeKey(k, keyShape(0.013, 0.05, 0.01), 0.0028, steel);
    const ignitionHead = k.box(0.03, 0.026, 0.008, blackPlastic, 0, 0, 0, 0.005);
    const ignitionKey = new THREE.Group();
    ignitionKey.add(ignition, ignitionHead);
    ignitionKey.position.set(-0.004, -0.052, 0.004);
    ignitionKey.rotation.z = 0.28;
    const doorKey = extrudeKey(k, keyShape(0.011, 0.04, 0.009), 0.0024, steel);
    doorKey.position.set(0.006, -0.05, -0.003);
    doorKey.rotation.z = -0.18;
    const fob = new THREE.Group();
    fob.add(
      k.box(0.03, 0.07, 0.006, k.mat({ color: 0x8a1e1a, roughness: 0.6 }), 0, -0.035, 0, 0.004),
      k.mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.002, 20), brass, 0, -0.058, 0.0045),
    );
    (fob.children[1] as THREE.Mesh).rotation.x = Math.PI / 2;
    fob.position.set(0.002, -0.04, -0.012);
    fob.rotation.z = -0.08;
    carKeys.add(ring, ignitionKey, doorKey, fob);
    carKeys.position.set(-0.11 + 0.012, -0.03, 0.046);
    // The flat's key on a string on the right hook.
    const flatKey = new THREE.Group();
    flatKey.add(k.rod(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -0.07, 0), 0.0012, k.mat({ color: 0xd8cfa8, roughness: 0.9 }), 4));
    const flat = extrudeKey(k, keyShape(0.012, 0.045, 0.01), 0.0026, brass);
    flat.position.set(0, -0.082, 0);
    flatKey.add(flat);
    flatKey.position.set(0.11 + 0.012, -0.03, 0.046);
    board.add(carKeys, flatKey);
    board.position.copy(keysAt);
    board.rotation.y = -Math.PI / 2;
    scene.add(board);
  }

  /* --- The toolbox, the night-light, the ceiling lamp ----------------------- */

  const toolboxAt = new THREE.Vector3(X1 - 0.75, 0, 0.55);
  {
    const toolbox = new THREE.Group();
    toolbox.add(
      k.box(0.5, 0.22, 0.24, red, 0, 0.11, 0, 0.012),
      k.box(0.52, 0.04, 0.26, k.mat({ color: 0xc4473d, roughness: 0.35, metalness: 0.3 }), 0, 0.24, 0, 0.01),
      k.span(-0.09, 0.29, -0.01, 0.09, 0.305, 0.01, metalDark),
      k.span(-0.11, 0.26, -0.01, -0.09, 0.305, 0.01, metalDark),
      k.span(0.09, 0.26, -0.01, 0.11, 0.305, 0.01, metalDark),
      k.box(0.05, 0.03, 0.01, brass, 0, 0.17, 0.125, 0.004),
    );
    const spanner = k.box(0.2, 0.008, 0.024, k.mat({ color: 0xb8b8b0, roughness: 0.25, metalness: 0.95 }), 0.06, 0.264, 0.06);
    spanner.rotation.y = 0.4;
    toolbox.add(spanner);
    toolbox.position.copy(toolboxAt);
    toolbox.rotation.y = -0.35;
    scene.add(toolbox);
  }
  {
    const nightLight = new THREE.Group();
    const glow = new THREE.MeshStandardMaterial({ color: 0xffb060, emissive: 0xff9a3a, emissiveIntensity: 2.5 });
    k.disposables.push(glow);
    nightLight.add(
      k.box(0.07, 0.1, 0.03, paintWhite, 0, 0, 0.015, 0.01),
      k.mesh(new THREE.SphereGeometry(0.035, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), glow, 0, 0.02, 0.045, false),
    );
    nightLight.position.set(X0, 0.32, 0.75);
    nightLight.rotation.y = Math.PI / 2;
    scene.add(nightLight);
  }
  scene.add(k.mesh(new THREE.CylinderGeometry(0.22, 0.16, 0.12, 24), k.mat({ color: 0xe8e2d0, roughness: 0.4, emissive: 0x302a20 }), 0, ROOM_H - 0.06, 0, false));

  /* --- Light ------------------------------------------------------------- */

  scene.add(new THREE.HemisphereLight(0x42506e, 0x22170f, 1.4));
  const moon = new THREE.DirectionalLight(0xa9bcff, 5);
  moon.target.position.set(wx + 0.2, 0.2, 0.4);
  // Steeper than the disc in the window, so the light lands on the floor and the bed
  // rather than raking the far wall: the eye forgives the difference, not a lit ceiling.
  moon.position.copy(moon.target.position).addScaledVector(new THREE.Vector3(0.15, 0.6, -1).normalize(), 12);
  moon.castShadow = true;
  moon.shadow.mapSize.set(lowDetail ? 1024 : 2048, lowDetail ? 1024 : 2048);
  // The whole room inside the shadow's box: outside it the moon would light the walls
  // and ceiling straight through the back wall.
  moon.shadow.camera.left = -4.6;
  moon.shadow.camera.right = 4.6;
  moon.shadow.camera.top = 4.6;
  moon.shadow.camera.bottom = -4.6;
  moon.shadow.camera.near = 1;
  moon.shadow.camera.far = 30;
  moon.shadow.bias = -0.0004;
  moon.shadow.normalBias = 0.02;
  scene.add(moon, moon.target);
  const deskLight = new THREE.SpotLight(0xffc27a, DESK_LAMP_CD, 5, 0.72, 0.55, 2);
  deskLight.position.copy(bulbAt);
  deskLight.target.position.copy(aimAt);
  deskLight.castShadow = true;
  deskLight.shadow.mapSize.set(lowDetail ? 512 : 1024, lowDetail ? 512 : 1024);
  deskLight.shadow.bias = -0.0006;
  deskLight.shadow.camera.near = 0.05;
  scene.add(deskLight, deskLight.target);
  const lampGlow = new THREE.PointLight(0xffb066, 3, 6, 2);
  lampGlow.position.copy(shadeAt).add(new THREE.Vector3(-0.2, -0.05, 0.1));
  scene.add(lampGlow);
  // The night-light's glow on the mat, from a little out from the wall.
  const nightGlow = new THREE.PointLight(0xffa050, 3.5, 3, 2);
  nightGlow.position.set(X0 + 0.75, 0.45, 0.85);
  scene.add(nightGlow);

  // Dust in the moonbeam.
  const DUST = lowDetail ? 120 : 360;
  const dustGeo = new THREE.BufferGeometry();
  const dustPos = new Float32Array(DUST * 3);
  const dustSeed = new Float32Array(DUST);
  {
    const r = rng(91);
    for (let i = 0; i < DUST; i++) {
      dustPos[i * 3] = wx - 0.6 + r() * 1.8;
      dustPos[i * 3 + 1] = 0.2 + r() * 2.0;
      dustPos[i * 3 + 2] = Z0 + 0.2 + r() * 2.4;
      dustSeed[i] = r() * 100;
    }
  }
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  const dustMat = new THREE.PointsMaterial({ color: 0xcfd8ff, size: 0.006, map: dustSprite(), transparent: true, opacity: 0.5, depthWrite: false });
  k.disposables.push(dustGeo, dustMat, dustMat.map!);
  scene.add(new THREE.Points(dustGeo, dustMat));

  /* --- The slow work: toys and the calendar's photograph ------------------ */

  // The die-cast models' program, linked with the rest of the room before its first frame
  // (ui/titleroom.ts compiles the scene): a model arriving later draws with it at once
  // instead of linking its own mid-title, and the first shadow pass links its depth
  // program. One triangle of no area, so it draws nothing; never culled, so every pass
  // meets it.
  {
    const anchor = new THREE.BufferGeometry();
    anchor.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
    anchor.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]), 3));
    anchor.setAttribute('color', new THREE.BufferAttribute(new Float32Array(9), 3));
    const mesh = k.mesh(anchor, toyMat);
    mesh.frustumCulled = false;
    scene.add(mesh);
  }
  const shop = new DieCastShop();
  let photoTarget: THREE.WebGLRenderTarget | null = null;
  let disposed = false;

  /**
   * The calendar's photograph: the kit's own 2106 in the sun, photographed once into a
   * texture, as a Soviet export calendar showed it. The studio's programs are linked off
   * the main thread first (`compileAsync`, into the photograph's target, as it is drawn).
   */
  const takePhoto = (renderer: THREE.WebGLRenderer, arrays: DieCastArrays, changed: () => void): void => {
    const studio = new THREE.Scene();
    studio.background = new THREE.Color(0x8fb4d6);
    studio.add(new THREE.HemisphereLight(0xcfe2f5, 0x6a7a4a, 2.2));
    const sun = new THREE.DirectionalLight(0xfff2dc, 4);
    sun.position.set(-6, 8, 6);
    studio.add(sun);
    const field = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: 0x9aa25a, roughness: 1 }));
    field.rotation.x = -Math.PI / 2;
    const tarmac = new THREE.Mesh(new THREE.PlaneGeometry(200, 7), new THREE.MeshStandardMaterial({ color: 0x55524e, roughness: 0.9 }));
    tarmac.rotation.x = -Math.PI / 2;
    tarmac.position.y = 0.01;
    const birch = new THREE.MeshStandardMaterial({ color: 0x5a8a44, roughness: 1 });
    studio.add(field, tarmac);
    for (let i = 0; i < 9; i++) {
      const tree = new THREE.Mesh(new THREE.SphereGeometry(3 + (i % 3), 12, 8), birch);
      tree.position.set(-30 + i * 7, 4.5, -26 - (i % 2) * 7);
      tree.scale.y = 1.6;
      studio.add(tree);
    }
    const car = new THREE.Mesh(dieCastGeometry(arrays), toyMat);
    car.rotation.y = -0.6;
    studio.add(car);
    const cam = new THREE.PerspectiveCamera(24, photoW / photoH, 0.1, 400);
    cam.position.set(4.6, 1.1, 5.6);
    cam.lookAt(0, 0.7, 0);
    const target = new THREE.WebGLRenderTarget(640, Math.round((640 * photoH) / photoW), { samples: 4 });
    target.texture.colorSpace = THREE.LinearSRGBColorSpace;
    photoTarget = target;
    const clearStudio = (): void => {
      studio.traverse((node) => {
        const m = node as THREE.Mesh;
        if (!m.isMesh) return;
        m.geometry.dispose();
        if (m !== car) (m.material as THREE.Material).dispose();
      });
    };
    const before = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    const linked = renderer.compileAsync(studio, cam);
    renderer.setRenderTarget(before);
    void linked.then(() => {
      if (disposed) {
        clearStudio();
        return;
      }
      const current = renderer.getRenderTarget();
      renderer.setRenderTarget(target);
      renderer.render(studio, cam);
      renderer.setRenderTarget(current);
      clearStudio();
      photoMat.map = target.texture;
      photoMat.color.set(0xffffff);
      changed();
    });
  };

  const now = new Date();
  return {
    scene,
    models,
    tick(t: number, dt: number): void {
      // The wall clock keeps the real time; its second hand steps.
      const seconds = now.getSeconds() + Math.floor(t);
      const minutes = now.getMinutes() + seconds / 60;
      const hours = (now.getHours() % 12) + minutes / 60;
      secondHand.rotation.z = -(Math.floor(seconds) / 60) * Math.PI * 2;
      minuteHand.rotation.z = -(minutes / 60) * Math.PI * 2;
      hourHand.rotation.z = -(hours / 12) * Math.PI * 2;
      // The lamp breathes a little, as a filament on a tired line does.
      deskLight.intensity = DESK_LAMP_CD * (1 + Math.sin(t * 2.3) * 0.015 + Math.sin(t * 13.7) * 0.01);
      curtains.forEach((c, i) => (c.rotation.x = Math.sin(t * 0.6 + i * 1.7) * 0.012));
      const p = dustGeo.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < DUST; i++) {
        const s = dustSeed[i]!;
        let y = p.getY(i) + dt * (0.012 + Math.sin(t * 0.3 + s) * 0.01);
        if (y > 2.3) y = 0.2;
        p.setXYZ(i, p.getX(i) + Math.sin(t * 0.4 + s) * dt * 0.01, y, p.getZ(i) + Math.cos(t * 0.35 + s) * dt * 0.01);
      }
      p.needsUpdate = true;
    },
    startWork(renderer: THREE.WebGLRenderer, changed: () => void): void {
      const place = (mesh: THREE.Mesh): void => {
        scene.add(mesh);
        changed();
      };
      // The toy on the mat's road, its left side, driving away towards the window.
      shop.order({
        modelId: DEFAULT_CAR_MODEL_ID,
        color: factoryPaintHex(DEFAULT_CAR_MODEL_ID, ROOM_CAR_KEY),
        scale: 1 / 24,
        done: (arrays) => {
          const toy = k.mesh(dieCastGeometry(arrays), toyMat);
          toy.position.copy(toyAt);
          toy.rotation.y = 0.04;
          place(toy);
        },
      });
      shop.order({ modelId: 'kit_vaz2106', color: 0xc0392b, scale: 1, done: (arrays) => takePhoto(renderer, arrays, changed) });
      // The case: a 1:43 model of every car in the game, in its factory colour, turned a
      // little to the room.
      for (const [modelId, at] of models) {
        shop.order({
          modelId,
          color: factoryPaintHex(modelId, ROOM_CAR_KEY),
          scale: 1 / 43,
          done: (arrays) => {
            const model = k.mesh(dieCastGeometry(arrays), toyMat);
            model.position.copy(at);
            model.rotation.y = Math.PI / 2 - 0.35;
            place(model);
          },
        });
      }
    },
    buildModel(modelId: string): void {
      shop.hurry(modelId);
    },
    dispose(): void {
      disposed = true;
      shop.close();
      for (const d of k.disposables) d.dispose();
      k.disposables.length = 0;
      photoTarget?.dispose();
    },
  };
}
