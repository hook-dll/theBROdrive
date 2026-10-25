import { formatClock } from '../contracts/types';

/**
 * THE NAVIGATOR ORB: the HUD's map, a round glass screen in the top left corner (the
 * health orb of Diablo II, hung from the top), drawn as a car navigator of about 2000.
 * The road as it really bends, heading-up: the nose points to the top of the glass and
 * the car stands below its centre, so most of the circle is the road ahead — about the
 * next one or two settlements. The posts are dots with their names, the one the route
 * goes to (the post that signs the cargo, a race's finish, or with nothing aboard the
 * next post) lit, and the road from the car to it lit as the route. A goal beyond the
 * glass is a notch on the rim pointing to it; a road left far behind is an arrow on
 * the rim, and the plate under the orb says how far.
 *
 * Painted on a canvas, again only when the picture has moved by a fraction of a pixel
 * or a degree.
 */

/** A post on the map: its stop index, arclength and place name. */
export interface MapPost {
  readonly index: number;
  readonly s: number;
  readonly name: string;
}

/** Where the map finds the road: asked for again only as the car moves on. */
export interface MapSource {
  /** The posts whose arclength lies in [fromS, toS), in order. */
  postsBetween(fromS: number, toS: number): readonly MapPost[];
  /** The centreline point at arclength `s`, world XZ, written into `out`. */
  roadPoint(s: number, out: { x: number; z: number }): void;
}

/** One frame's map, written into by the game loop (`newMapView`) and read by `MapOrb.update`. */
export interface MapView {
  /** `race`: to a race's finish. `delivery`: to the post that signs the cargo. `idle`: the next post. */
  kind: 'race' | 'delivery' | 'idle';
  /** Whom the map follows: world XZ, and the way the car (or the walker's view) faces, radians (0 = +Z). */
  x: number;
  z: number;
  facing: number;
  /** Arclength of the road point closest to them, and their lateral offset off it (+ left). */
  s: number;
  lateral: number;
  /** The post the route goes to (-1 for a race) and its arclength, place name and the urgent clock aboard. */
  targetIndex: number;
  targetS: number;
  place: string;
  urgentS: number | null;
  /** A race's rivals' arclengths, the first `rivalCount` valid, and the player's place among the field. */
  readonly rivals: number[];
  rivalCount: number;
  rank: number;
}

export function newMapView(): MapView {
  return {
    kind: 'idle', x: 0, z: 0, facing: 0, s: 0, lateral: 0,
    targetIndex: -1, targetS: 0, place: '', urgentS: null,
    rivals: [], rivalCount: 0, rank: 1,
  };
}

/** The colours the orb paints in: the backlight's (hud.css `.hud-orb`), read when it changes. */
interface Palette {
  on: string;
  hot: string;
  mid: string;
  dim: string;
  glass: string;
  alarm: string;
  font: string;
}

/** Metres from the glass's centre to its rim. */
const RADIUS_M = 4000;
/** The car stands this share of the radius below the centre: most of the glass is ahead. */
const CAR_DROP = 0.45;
/** The road is sampled this finely, over this much either side of where it was last sampled. */
const SAMPLE_STEP_M = 50;
const SAMPLE_BEHIND_M = 5000;
const SAMPLE_AHEAD_M = 9000;
/** Resampled once the car is this far from where it was last sampled. */
const RESAMPLE_M = 800;
/** Further off the road than this, the plate gives the way back to it instead of the route. */
const FAR_M = 40;
/** A range ring, metres. */
const RING_M = 1000;

function el(tag: string, cls: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = cls;
  return node;
}

function distanceText(m: number): string {
  return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`;
}

export class MapOrb {
  readonly el: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D | null;
  private readonly placeEl: HTMLElement;
  private readonly distEl: HTMLElement;
  private readonly observer: ResizeObserver | null = null;
  /** Canvas size, device pixels, and the pixel ratio. */
  private px = 0;
  private dpr = 1;
  private palette: Palette | null = null;
  /** The road sampled around `sampledS`: XZ pairs from `sampleFrom` every `SAMPLE_STEP_M`. */
  private sampledS = Number.NaN;
  private sampleFrom = 0;
  private samples = new Float64Array(0);
  private posts: readonly MapPost[] = [];
  private readonly postXZ: number[] = [];
  private readonly point = { x: 0, z: 0 };
  private drawnKey = '';
  private placeShown = '';
  private distShown = '';
  private idle: boolean | null = null;

  constructor(private readonly source: MapSource) {
    this.el = el('div', 'hud-orb hud-orb--map');
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'hud-orb-screen';
    this.g = this.canvas.getContext('2d');
    const plate = el('div', 'hud-orb-plate');
    this.placeEl = el('div', 'hud-orb-place');
    this.distEl = el('div', 'hud-orb-dist');
    plate.append(this.placeEl, this.distEl);
    this.el.append(this.canvas, el('div', 'hud-orb-glass'), plate);
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver((entries) => {
        const size = entries[entries.length - 1]!.contentRect.width;
        this.dpr = Math.min(2, window.devicePixelRatio || 1);
        this.px = Math.round(size * this.dpr);
        this.canvas.width = this.canvas.height = this.px;
        this.drawnKey = '';
      });
      this.observer.observe(this.canvas);
    }
  }

  /** The backlight changed (hud.ts `setBacklight`): read its colours off the orb. */
  refreshPalette(): void {
    const style = getComputedStyle(this.el);
    const read = (name: string): string => style.getPropertyValue(name).trim();
    this.palette = {
      on: read('--lcd-on'), hot: read('--lcd-hot'), mid: read('--lcd-mid'),
      dim: read('--lcd-dim'), glass: read('--lcd-glass'), alarm: read('--lcd-alarm'),
      font: style.fontFamily,
    };
    this.drawnKey = '';
  }

  update(v: MapView): void {
    this.updatePlate(v);
    const g = this.g;
    if (g === null || this.px <= 0) return;
    if (this.palette === null) this.refreshPalette();
    if (!(Math.abs(v.s - this.sampledS) < RESAMPLE_M)) this.resample(v.s);

    const px = this.px;
    const r = px / 2;
    const scale = r / RADIUS_M;
    // Redrawn only when the picture has moved: a quarter pixel, a fifth of a degree.
    let rivalsKey = '';
    for (let i = 0; i < v.rivalCount; i++) rivalsKey += `${Math.round(v.rivals[i]! * scale)},`;
    const key = `${Math.round(v.x * scale * 4)}:${Math.round(v.z * scale * 4)}:${Math.round(v.facing * 286)}:` +
      `${v.kind}:${v.targetIndex}:${Math.round(v.targetS)}:${Math.abs(v.lateral) > FAR_M}:${rivalsKey}:${px}:${this.sampledS}`;
    if (key === this.drawnKey) return;
    this.drawnKey = key;
    const pal = this.palette!;

    // Heading-up: the facing direction is the glass's up, the car `CAR_DROP` below centre.
    // Right of the facing direction is (-cos, sin) in world XZ (player/player.ts).
    const sin = Math.sin(v.facing);
    const cos = Math.cos(v.facing);
    const carX = r;
    const carY = r + r * CAR_DROP;
    const toX = (x: number, z: number): number => carX + (-(x - v.x) * cos + (z - v.z) * sin) * scale;
    const toY = (x: number, z: number): number => carY - ((x - v.x) * sin + (z - v.z) * cos) * scale;
    const unit = this.dpr;

    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, px, px);
    g.save();
    g.beginPath();
    g.arc(r, r, r, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = pal.glass;
    g.fillRect(0, 0, px, px);

    // The range ring round the car, a kilometre out.
    g.strokeStyle = pal.mid;
    g.lineWidth = unit;
    g.setLineDash([3 * unit, 5 * unit]);
    g.beginPath();
    g.arc(carX, carY, RING_M * scale, 0, Math.PI * 2);
    g.stroke();
    g.setLineDash([]);

    // The road, then the route on it.
    const samples = this.samples;
    const count = samples.length / 2;
    const path = (fromS: number, toS: number): void => {
      const a = Math.max(0, Math.floor((fromS - this.sampleFrom) / SAMPLE_STEP_M));
      const b = Math.min(count - 1, Math.ceil((toS - this.sampleFrom) / SAMPLE_STEP_M));
      g.beginPath();
      for (let i = a; i <= b; i++) {
        const x = toX(samples[i * 2]!, samples[i * 2 + 1]!);
        const y = toY(samples[i * 2]!, samples[i * 2 + 1]!);
        if (i === a) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
    };
    g.lineCap = 'round';
    g.lineJoin = 'round';
    path(-Infinity, Infinity);
    g.strokeStyle = pal.mid;
    g.lineWidth = 3 * unit;
    g.stroke();
    if (v.targetS > v.s) {
      path(v.s, v.targetS);
      g.strokeStyle = v.kind === 'idle' ? pal.on : pal.hot;
      g.lineWidth = (v.kind === 'idle' ? 3 : 4.5) * unit;
      g.stroke();
    }

    // The posts: dots, the goal lit, then their names.
    g.font = `700 ${Math.round(12 * unit)}px ${pal.font}`;
    g.textBaseline = 'middle';
    const shown: number[] = [];
    for (let i = 0; i < this.posts.length; i++) {
      const x = toX(this.postXZ[i * 2]!, this.postXZ[i * 2 + 1]!);
      const y = toY(this.postXZ[i * 2]!, this.postXZ[i * 2 + 1]!);
      if (Math.hypot(x - r, y - r) > r + 20 * unit) continue;
      const goal = this.posts[i]!.index === v.targetIndex;
      g.beginPath();
      g.arc(x, y, (goal ? 5.5 : 4) * unit, 0, Math.PI * 2);
      g.fillStyle = goal ? pal.hot : pal.glass;
      g.fill();
      g.strokeStyle = goal ? pal.hot : pal.on;
      g.lineWidth = 2 * unit;
      g.stroke();
      // The goal's name is placed first and always; the nearer names after it.
      if (goal) shown.unshift(i);
      else shown.push(i);
    }
    // Each name beside its dot, on a side where it stays inside the clear glass and off
    // the car and the names already placed; a name with no such side is left out — the
    // goal's too, which the plate under the orb names anyway.
    const placed: number[] = [carX - 9 * unit, carY - 11 * unit, carX + 9 * unit, carY + 9 * unit];
    const lineH = 8 * unit;
    // The glass darkens toward its rim (hud.css `.hud-orb-glass`): a name fits inside that.
    const clear = r * 0.88;
    for (const i of shown) {
      const post = this.posts[i]!;
      const goal = post.index === v.targetIndex;
      const x = toX(this.postXZ[i * 2]!, this.postXZ[i * 2 + 1]!);
      const y = toY(this.postXZ[i * 2]!, this.postXZ[i * 2 + 1]!);
      const name = post.name.toUpperCase();
      const width = g.measureText(name).width;
      const half = Math.sqrt(Math.max(0, clear * clear - (y - r) * (y - r)));
      let side = 0;
      for (const left of x > r ? [true, false] : [false, true]) {
        const x0 = left ? x - 10 * unit - width : x + 10 * unit;
        const x1 = x0 + width;
        if (x0 < r - half || x1 > r + half) continue;
        let free = true;
        for (let k = 0; k < placed.length && free; k += 4) {
          free = x1 < placed[k]! || x0 > placed[k + 2]! || y + lineH < placed[k + 1]! || y - lineH > placed[k + 3]!;
        }
        if (!free) continue;
        side = left ? -1 : 1;
        placed.push(x0, y - lineH, x1, y + lineH);
        break;
      }
      if (side === 0) continue;
      g.textAlign = side < 0 ? 'right' : 'left';
      const tx = x + side * 10 * unit;
      g.lineWidth = 4 * unit;
      g.strokeStyle = pal.glass;
      g.strokeText(name, tx, y);
      g.fillStyle = goal ? pal.hot : pal.on;
      g.fillText(name, tx, y);
    }

    // A race: the rivals as rings on the road, the finish chequered.
    if (v.kind === 'race') {
      for (let i = 0; i < v.rivalCount; i++) {
        this.source.roadPoint(v.rivals[i]!, this.point);
        g.beginPath();
        g.arc(toX(this.point.x, this.point.z), toY(this.point.x, this.point.z), 4.5 * unit, 0, Math.PI * 2);
        g.fillStyle = pal.glass;
        g.fill();
        g.strokeStyle = pal.hot;
        g.lineWidth = 2 * unit;
        g.stroke();
      }
      this.source.roadPoint(v.targetS, this.point);
      const fx = toX(this.point.x, this.point.z);
      const fy = toY(this.point.x, this.point.z);
      const cell = 3.5 * unit;
      for (let a = 0; a < 3; a++) {
        for (let b = 0; b < 3; b++) {
          g.fillStyle = (a + b) % 2 === 0 ? pal.hot : pal.glass;
          g.fillRect(fx - 1.5 * cell + a * cell, fy - 1.5 * cell + b * cell, cell, cell);
        }
      }
    }

    // The rim: a notch toward a goal beyond the glass; an arrow toward a road left far behind.
    this.source.roadPoint(v.targetS, this.point);
    const gx = toX(this.point.x, this.point.z);
    const gy = toY(this.point.x, this.point.z);
    if (Math.hypot(gx - r, gy - r) > r - 6 * unit) this.rimMark(r, Math.atan2(gy - r, gx - r), 8 * unit, pal.hot);
    if (Math.abs(v.lateral) > FAR_M) {
      this.source.roadPoint(v.s, this.point);
      const rx = toX(this.point.x, this.point.z);
      const ry = toY(this.point.x, this.point.z);
      if (Math.hypot(rx - r, ry - r) > r - 12 * unit) this.rimMark(r, Math.atan2(ry - r, rx - r), 12 * unit, pal.alarm);
    }

    // The car, an arrowhead up the glass.
    g.translate(carX, carY);
    g.scale(unit, unit);
    g.beginPath();
    g.moveTo(0, -10);
    g.lineTo(7, 8);
    g.lineTo(0, 4);
    g.lineTo(-7, 8);
    g.closePath();
    g.lineWidth = 3;
    g.strokeStyle = '#000';
    g.stroke();
    g.fillStyle = pal.hot;
    g.fill();
    g.restore();
  }

  /** A triangle on the rim at `angle` (screen radians), pointing out. */
  private rimMark(r: number, angle: number, size: number, colour: string): void {
    const g = this.g!;
    const tip = r - 2 * this.dpr;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    g.beginPath();
    g.moveTo(r + cos * tip, r + sin * tip);
    g.lineTo(r + cos * (tip - size) - sin * size * 0.7, r + sin * (tip - size) + cos * size * 0.7);
    g.lineTo(r + cos * (tip - size) + sin * size * 0.7, r + sin * (tip - size) - cos * size * 0.7);
    g.closePath();
    g.fillStyle = colour;
    g.fill();
  }

  /** The road and its posts around `s`, in world XZ. */
  private resample(s: number): void {
    this.sampledS = s;
    this.sampleFrom = Math.max(0, s - SAMPLE_BEHIND_M);
    const count = Math.floor((s + SAMPLE_AHEAD_M - this.sampleFrom) / SAMPLE_STEP_M) + 1;
    if (this.samples.length !== count * 2) this.samples = new Float64Array(count * 2);
    for (let i = 0; i < count; i++) {
      this.source.roadPoint(this.sampleFrom + i * SAMPLE_STEP_M, this.point);
      this.samples[i * 2] = this.point.x;
      this.samples[i * 2 + 1] = this.point.z;
    }
    this.posts = this.source.postsBetween(this.sampleFrom, this.sampleFrom + (count - 1) * SAMPLE_STEP_M);
    this.postXZ.length = 0;
    for (const post of this.posts) {
      this.source.roadPoint(post.s, this.point);
      this.postXZ.push(this.point.x, this.point.z);
    }
  }

  /** The plate under the orb: where the route goes and how far, or the way back to the road. */
  private updatePlate(v: MapView): void {
    const place = v.kind === 'race' ? `race · ${v.place}` : v.place;
    if (place !== this.placeShown) {
      this.placeShown = place;
      this.placeEl.textContent = place;
    }
    const lost = Math.abs(v.lateral) > FAR_M;
    let dist: string;
    if (lost) {
      dist = `road ${distanceText(Math.abs(v.lateral))}`;
    } else {
      dist = distanceText(Math.max(0, v.targetS - v.s));
      if (v.kind === 'race') dist += ` · ${v.rank}/${v.rivalCount + 1}`;
      if (v.urgentS !== null) dist += ` · ${formatClock(v.urgentS)}`;
    }
    if (dist !== this.distShown) {
      this.distShown = dist;
      this.distEl.textContent = dist;
      this.distEl.classList.toggle('is-late', !lost && v.urgentS !== null && v.urgentS < 0);
      this.distEl.classList.toggle('is-lost', lost);
    }
    const idle = v.kind === 'idle';
    if (idle !== this.idle) {
      this.idle = idle;
      this.el.classList.toggle('is-idle', idle);
    }
  }

  dispose(): void {
    this.observer?.disconnect();
  }
}
