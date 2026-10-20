import * as THREE from 'three';
import { formatMoney, PURSE_COIN_MM, PURSE_DENOMINATIONS, purseCoins, RUB, denominationLabel } from '../economy/economy';
import type { PurseSeat } from '../world/fixturefield';
import { paintSign, SIGN_PLANE } from '../world/market';
import { box, cylinder } from '../world/poi/kit';

/**
 * THE PURSE (монетница) as it sits in a money machine's slot: the Vyborg pocket coin
 * holder, a flat aluminium case with a row of tubes, each sized to its coin and showing
 * the coins of that denomination the balance comes to (`purseCoins`), with a blue pusher
 * riding on the stack; an empty tube shows the bare pusher at its foot. Six tubes: 1, 5,
 * 10 kopecks, 1, 2, 5 rubles, their names painted on the band under them, and the total
 * on a paper tag beside the case. Toy-sized against a real one, as everything the hand
 * works is, so it reads from the machine's framing.
 *
 * There is one purse, built once and kept in the scene from boot: it is hidden until a
 * machine takes it (`seat`), and being in the scene at boot is what links its programs
 * before the first frame — kit boxes and cylinders and two sign planes, the shapes
 * `marketProgramAnchor` holds too. Nothing of it is ever disposed.
 *
 * Local metres: the case and its tag centred on the origin, the face toward +Z, the long
 * side along X, the tubes' open ends (where the coins come out) at the bottom.
 */

/** The case, metres. */
const CASE_W = 0.15;
const CASE_H = 0.085;
const CASE_D = 0.026;
/** The tag beside it, and the gap between them. */
const TAG_W = 0.07;
const TAG_H = 0.05;
const TAG_GAP = 0.008;
/** The whole piece a slot holds: case and tag. */
export const PURSE_SEAT_W = CASE_W + TAG_GAP + TAG_W;
export const PURSE_SEAT_H = CASE_H;
export const PURSE_SEAT_D = CASE_D;
const CASE_X = -PURSE_SEAT_W / 2 + CASE_W / 2;
const TAG_X = PURSE_SEAT_W / 2 - TAG_W / 2;

/** Walls between the tubes, and the band their names are painted on. */
const WALL = 0.003;
const BAND_H = 0.016;
/** A coin's thickness as the stack shows it, and the pitch it stacks at. */
const COIN_T = 0.0042;
const COIN_PITCH = 0.005;
/** The coins one tube shows at most; a fuller tube is just full. */
export const PURSE_TUBE_CAP = 10;
const PUSHER_H = 0.01;

/** Metres per millimetre of real coin: the six fill the case between the walls. */
const COIN_SCALE = (CASE_W - WALL * (PURSE_COIN_MM.length + 1)) / PURSE_COIN_MM.reduce((sum, mm) => sum + mm, 0);

const COLOUR = {
  case: 0xa3aaac,
  tube: 0x2c3032,
  kopeck: 0xc29a45,
  ruble: 0xcfcfc6,
  pusher: 0x2f5fa6,
} as const;
const TAG_PAPER = '#efe6cf';
const TAG_INK = '#2a2620';
const BAND_PAPER = '#c9cfd0';

/** One tube of the case: its coins, bottom first, and its pusher. */
interface Tube {
  readonly coins: THREE.Object3D[];
  readonly pusher: THREE.Object3D;
}

/** Where tube `i` stands across the case: its centre, case-local, and its coin's diameter. */
function tubeLayout(): { x: number; d: number }[] {
  let x = -CASE_W / 2 + WALL;
  return PURSE_COIN_MM.map((mm) => {
    const d = mm * COIN_SCALE;
    const centre = x + d / 2;
    x += d + WALL;
    return { x: centre, d };
  });
}

export class PurseModel {
  readonly root = new THREE.Group();
  private readonly tubes: Tube[] = [];
  private readonly band: THREE.MeshStandardMaterial;
  private readonly tag: THREE.MeshStandardMaterial;
  private seated: PurseSeat | null = null;
  /** The balance last shown, kopecks; -1 before the first. */
  private shown = -1;

  constructor() {
    this.root.name = 'purse';
    this.root.visible = false;
    const caseGroup = new THREE.Group();
    caseGroup.position.x = CASE_X;
    this.root.add(caseGroup);
    box(caseGroup, [CASE_W, CASE_H, CASE_D], [0, 0, 0], COLOUR.case);

    const channelBottom = -CASE_H / 2 + BAND_H + WALL;
    const channelLength = CASE_H / 2 - WALL - channelBottom;
    tubeLayout().forEach(({ x, d }, i) => {
      box(caseGroup, [d, channelLength, 0.002], [x, channelBottom + channelLength / 2, CASE_D / 2 + 0.001], COLOUR.tube);
      // A coin on edge, half sunk in its tube: its rim stands out of the face.
      const z = CASE_D / 2 - d * 0.28;
      const colour = PURSE_DENOMINATIONS[i]! >= RUB ? COLOUR.ruble : COLOUR.kopeck;
      const coins: THREE.Object3D[] = [];
      for (let k = 0; k < PURSE_TUBE_CAP; k++) {
        const coin = cylinder(caseGroup, d / 2, d / 2, COIN_T, 14, [x, channelBottom + COIN_PITCH * (k + 0.5), z], colour);
        coin.visible = false;
        coins.push(coin);
      }
      const pusher = box(caseGroup, [d * 0.86, PUSHER_H, d * 0.7], [x, channelBottom + PUSHER_H / 2, CASE_D / 2 - d * 0.2], COLOUR.pusher);
      this.tubes.push({ coins, pusher });
    });

    // The band under the tubes, their names painted on it.
    this.band = paintSign([''], BAND_PAPER, TAG_INK, 512, 56);
    const band = new THREE.Mesh(SIGN_PLANE, this.band);
    band.scale.set(CASE_W - 0.004, BAND_H - 0.003, 1);
    band.position.set(0, -CASE_H / 2 + BAND_H / 2 + 0.001, CASE_D / 2 + 0.0015);
    caseGroup.add(band);
    this.paintBand();

    // The tag with the total, on a little backing plate.
    box(this.root, [TAG_W, TAG_H, 0.004], [TAG_X, 0, -0.002], COLOUR.tube);
    this.tag = paintSign([''], TAG_PAPER, TAG_INK, 256, 184);
    const tag = new THREE.Mesh(SIGN_PLANE, this.tag);
    tag.scale.set(TAG_W - 0.004, TAG_H - 0.004, 1);
    tag.position.set(TAG_X, 0, 0.0005);
    this.root.add(tag);
  }

  /** Seats the purse in a machine's slot, or takes it out of the world (null). */
  seat(seat: PurseSeat | null): void {
    this.seated = seat;
    this.root.visible = seat !== null;
    if (seat) {
      this.root.rotation.set(0, seat.yaw, 0);
      this.root.scale.setScalar(seat.scale);
    }
  }

  /** Per frame: the balance it shows, and where the floating origin is now. */
  update(kopecks: number, originX: number, originZ: number): void {
    if (!this.seated) return;
    this.root.position.set(this.seated.x - originX, this.seated.y, this.seated.z - originZ);
    if (kopecks === this.shown) return;
    this.shown = kopecks;
    const counts = purseCoins(kopecks);
    const channelBottom = -CASE_H / 2 + BAND_H + WALL;
    this.tubes.forEach((tube, i) => {
      const n = Math.min(PURSE_TUBE_CAP, counts[i]!);
      tube.coins.forEach((coin, k) => {
        coin.visible = k < n;
      });
      tube.pusher.position.y = channelBottom + COIN_PITCH * n + PUSHER_H / 2;
    });
    this.paintTag(kopecks);
  }

  private paintBand(): void {
    repaint(this.band, (g, w, h) => {
      g.fillStyle = BAND_PAPER;
      g.fillRect(0, 0, w, h);
      g.fillStyle = TAG_INK;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = `bold ${Math.round(h * 0.62)}px sans-serif`;
      tubeLayout().forEach(({ x, d }, i) => {
        const u = (x + CASE_W / 2) / CASE_W;
        g.fillText(denominationLabel(PURSE_DENOMINATIONS[i]!), u * w, h * 0.54, (d / CASE_W) * w * 1.15);
      });
    });
  }

  private paintTag(kopecks: number): void {
    repaint(this.tag, (g, w, h) => {
      g.fillStyle = TAG_PAPER;
      g.fillRect(0, 0, w, h);
      g.strokeStyle = TAG_INK;
      g.lineWidth = 6;
      g.strokeRect(3, 3, w - 6, h - 6);
      g.fillStyle = TAG_INK;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      const rub = Math.floor(kopecks / RUB);
      const kop = kopecks % RUB;
      // Two lines when both parts are there, so each is big enough to read.
      if (rub > 0 && kop > 0) {
        g.font = `bold ${Math.round(h * 0.36)}px sans-serif`;
        g.fillText(`${rub}р`, w / 2, h * 0.32, w * 0.9);
        g.fillText(`${kop}коп`, w / 2, h * 0.7, w * 0.9);
      } else {
        g.font = `bold ${Math.round(h * 0.42)}px sans-serif`;
        g.fillText(formatMoney(kopecks), w / 2, h / 2, w * 0.9);
      }
    });
  }
}

/** Repaints a sign material's canvas in place; a no-op in the headless tools. */
function repaint(material: THREE.MeshStandardMaterial, paint: (g: CanvasRenderingContext2D, w: number, h: number) => void): void {
  const map = material.map;
  const canvas: unknown = map?.image;
  if (!map || typeof HTMLCanvasElement === 'undefined' || !(canvas instanceof HTMLCanvasElement)) return;
  const g = canvas.getContext('2d');
  if (!g) return;
  g.save();
  paint(g, canvas.width, canvas.height);
  g.restore();
  map.needsUpdate = true;
}
