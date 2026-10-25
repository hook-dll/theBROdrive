import { formatClock } from '../contracts/types';

/**
 * THE MAP RIBBON: the HUD strip's navigator, a car navigator of about 2000 drawn on
 * the strip's backlit glass. The road is straightened into one line across the ribbon,
 * running on to the right; the posts stand on it as ticks with their names over them,
 * and the car is an arrowhead a fifth of the way in, turned as it is turned to the road.
 * Off the road it leaves the line — up for the left of the road, down for the right,
 * on a log scale so ten metres and three kilometres both read and neither leaves the
 * ribbon — and the info pane at the ribbon's end turns to say where the road is.
 *
 * The ribbon is drawn at a fixed `M_PER_EM` (the strip's own unit), so a wider screen
 * sees further and nothing zooms when the money beside it grows; the car stands a
 * fifth of the way in. What the car is going to (the post that signs
 * the cargo, a race's finish, or with nothing to deliver the next post) is drawn as the
 * route: the line from the car to it lit, the post marked; past the window, a chevron
 * at the ribbon's end points on to it.
 */

/** A post on the ribbon: its stop index, arclength and place name. */
export interface MapPost {
  readonly index: number;
  readonly s: number;
  readonly name: string;
}

/** Where the ribbon finds the posts: called only when the window has moved on a bucket. */
export interface MapSource {
  postsBetween(fromS: number, toS: number): readonly MapPost[];
}

/** One frame's map, written into by the game loop (`newMapView`) and read by `MapRibbon.update`. */
export interface MapView {
  /** `race`: to a race's finish. `delivery`: to the post that signs the cargo. `idle`: the next post. */
  kind: 'race' | 'delivery' | 'idle';
  /** Arclength of the road point closest to whom the map follows, and the lateral offset off it (+ left). */
  s: number;
  lateral: number;
  /** Heading of the car (or the walker's view) less the road's there, radians, + turned left. */
  relHeading: number;
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
    kind: 'idle', s: 0, lateral: 0, relHeading: 0,
    targetIndex: -1, targetS: 0, place: '', urgentS: null,
    rivals: [], rivalCount: 0, rank: 1,
  };
}

/** Metres of road to one em of the strip (a tenth of its height at 4.2 em), and the share of the ribbon behind the car. */
const M_PER_EM = 110;
const BEHIND = 0.2;
/** The ribbon's height in em (hud.css `.hud-map`). */
const RIBBON_EM = 3.6;
/** The post set is asked for again each time the car moves on this far. */
const BUCKET_M = 500;
/** Within this of the centreline the car is on the road and sits on the line. */
const ON_ROAD_M = 5;
/** Further off than this, the info pane gives the way back to the road instead of the route. */
const FAR_M = 40;
/** The lateral offset at which the car reaches the ribbon's edge. */
const LATERAL_FULL_M = 3000;
/** The ribbon is too narrow for the post names under this width, px. */
const NAMES_MIN_PX = 320;
/** The road line's height in the ribbon, as a share of it from the top. */
const ROAD_Y = 0.62;

function el(tag: string, cls: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = cls;
  return node;
}

function distanceText(m: number): string {
  return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`;
}

interface PostMark {
  readonly el: HTMLElement;
  readonly s: number;
  x: number;
}

export class MapRibbon {
  readonly el: HTMLElement;
  private readonly ribbon: HTMLElement;
  private readonly route: HTMLElement;
  private readonly ahead: HTMLElement;
  private readonly finish: HTMLElement;
  private readonly car: HTMLElement;
  private readonly placeEl: HTMLElement;
  private readonly distEl: HTMLElement;
  private readonly distText: HTMLElement;
  private readonly arrow: HTMLElement;
  private readonly rivals: HTMLElement[] = [];
  private readonly rivalX: number[] = [];
  private readonly posts = new Map<number, PostMark>();
  private readonly observer: ResizeObserver | null = null;
  private width = 0;
  private height = 0;
  private bucket = Number.NaN;
  private kind: MapView['kind'] | null = null;
  private targetIndex = -2;
  private carKey = '';
  private routeKey = '';
  private finishX = Number.NaN;
  private placeShown = '';
  private distShown = '';
  private arrowDeg = Number.NaN;

  constructor(private readonly source: MapSource) {
    this.el = el('div', 'hud-map is-idle');
    this.ribbon = el('div', 'hud-map-ribbon');
    this.route = el('div', 'hud-map-route');
    this.ahead = el('div', 'hud-map-ahead is-hidden');
    this.finish = el('div', 'hud-map-finish is-hidden');
    // Hidden until the ribbon has a size to place it in.
    this.car = el('div', 'hud-map-car is-hidden');
    this.ribbon.append(el('div', 'hud-map-road'), this.route, this.finish, this.ahead, this.car);
    const info = el('div', 'hud-map-info');
    this.placeEl = el('div', 'hud-map-place');
    this.distEl = el('div', 'hud-map-dist');
    this.arrow = el('span', 'hud-map-arrow is-hidden');
    this.distText = el('span', 'hud-map-dist-text');
    this.distEl.append(this.arrow, this.distText);
    info.append(this.placeEl, this.distEl);
    this.el.append(this.ribbon, info);
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver((entries) => {
        const box = entries[entries.length - 1]!.contentRect;
        this.width = box.width;
        this.height = box.height;
        this.el.classList.toggle('is-narrow', box.width < NAMES_MIN_PX);
        // Everything is placed in pixels of the old size: place it all again.
        this.bucket = Number.NaN;
        this.carKey = '';
        this.routeKey = '';
        this.finishX = Number.NaN;
        for (const mark of this.posts.values()) mark.x = Number.NaN;
        this.rivalX.fill(Number.NaN);
      });
      this.observer.observe(this.ribbon);
    }
  }

  update(v: MapView): void {
    if (v.kind !== this.kind) {
      this.kind = v.kind;
      this.el.classList.toggle('is-race', v.kind === 'race');
      this.el.classList.toggle('is-delivery', v.kind === 'delivery');
      this.el.classList.toggle('is-idle', v.kind === 'idle');
      this.targetIndex = -2;
    }
    this.updateInfo(v);
    const width = this.width;
    if (width <= 0 || this.height <= 0) return;
    const pxPerM = this.height / RIBBON_EM / M_PER_EM;
    const span = width / pxPerM;
    const carX = Math.round(width * BEHIND);
    const roadY = Math.round(this.height * ROAD_Y);
    const xOf = (s: number): number => Math.round((carX + (s - v.s) * pxPerM) * 2) / 2;

    // The posts in the window, asked for again only when the car has moved a bucket on.
    const bucket = Math.floor(v.s / BUCKET_M);
    if (bucket !== this.bucket) {
      this.bucket = bucket;
      const from = v.s - carX / pxPerM - BUCKET_M;
      const wanted = this.source.postsBetween(from, from + span + 2 * BUCKET_M);
      const keep = new Set<number>();
      for (const post of wanted) {
        keep.add(post.index);
        if (this.posts.has(post.index)) continue;
        const mark = el('div', 'hud-map-post');
        const name = el('span', 'hud-map-name');
        name.textContent = post.name;
        mark.append(name);
        this.ribbon.insertBefore(mark, this.car);
        this.posts.set(post.index, { el: mark, s: post.s, x: Number.NaN });
      }
      for (const [index, mark] of this.posts) {
        if (keep.has(index)) continue;
        mark.el.remove();
        this.posts.delete(index);
      }
      this.targetIndex = -2;
    }
    if (v.targetIndex !== this.targetIndex) {
      this.targetIndex = v.targetIndex;
      for (const [index, mark] of this.posts) mark.el.classList.toggle('is-target', index === v.targetIndex);
    }
    for (const mark of this.posts.values()) {
      const x = xOf(mark.s);
      if (x === mark.x) continue;
      mark.x = x;
      mark.el.style.transform = `translate(${x}px, ${roadY}px)`;
    }

    // The route: lit from the car to where it goes, a chevron at the end past the window.
    const goalX = xOf(v.targetS);
    const routeEnd = Math.min(width, Math.max(carX, goalX));
    const routeKey = `${carX}:${routeEnd}:${roadY}`;
    if (routeKey !== this.routeKey) {
      this.routeKey = routeKey;
      this.route.style.transform = `translate(${carX}px, ${roadY}px) scaleX(${routeEnd - carX})`;
      this.ahead.classList.toggle('is-hidden', goalX <= width);
      this.ahead.style.transform = `translate(${width}px, ${roadY}px)`;
    }
    const finishX = v.kind === 'race' ? goalX : Number.NaN;
    if (!Object.is(finishX, this.finishX)) {
      this.finishX = finishX;
      const shown = v.kind === 'race' && finishX <= width;
      this.finish.classList.toggle('is-hidden', !shown);
      if (shown) this.finish.style.transform = `translate(${finishX}px, ${roadY}px)`;
    }

    // The rivals, dots on the line.
    const count = v.kind === 'race' ? v.rivalCount : 0;
    while (this.rivals.length < count) {
      const dot = el('div', 'hud-map-rival');
      this.ribbon.insertBefore(dot, this.car);
      this.rivals.push(dot);
      this.rivalX.push(Number.NaN);
    }
    for (let i = 0; i < this.rivals.length; i++) {
      const dot = this.rivals[i]!;
      if (i >= count) {
        if (!dot.classList.contains('is-hidden')) dot.classList.add('is-hidden');
        this.rivalX[i] = Number.NaN;
        continue;
      }
      dot.classList.remove('is-hidden');
      const x = Math.min(width, xOf(v.rivals[i]!));
      if (x === this.rivalX[i]) continue;
      this.rivalX[i] = x;
      dot.style.transform = `translate(${x}px, ${roadY}px)`;
    }

    // The car: off the line by its lateral offset, turned by its heading to the road.
    const off = Math.abs(v.lateral) - ON_ROAD_M;
    const reach = this.height * 0.36;
    const lift = off <= 0 ? 0 : Math.min(1, Math.log1p(off / 8) / Math.log1p(LATERAL_FULL_M / 8)) * reach;
    const y = Math.round(roadY - Math.sign(v.lateral) * lift);
    const deg = Math.round(-v.relHeading * (180 / Math.PI) / 3) * 3;
    const carKey = `${carX}:${y}:${deg}`;
    if (carKey !== this.carKey) {
      this.carKey = carKey;
      this.car.style.transform = `translate(${carX}px, ${y}px) rotate(${deg}deg)`;
      this.car.classList.remove('is-hidden');
    }
  }

  /** The info pane: where the route goes and how far, or the way back to a road left far behind. */
  private updateInfo(v: MapView): void {
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
      this.distText.textContent = dist;
      this.distEl.classList.toggle('is-late', !lost && v.urgentS !== null && v.urgentS < 0);
      this.distEl.classList.toggle('is-lost', lost);
    }
    // Which way the road lies from the nose: square off the road towards it, less the heading.
    const deg = lost
      ? Math.round(((v.lateral > 0 ? 90 : -90) + v.relHeading * (180 / Math.PI)) / 5) * 5
      : Number.NaN;
    if (!Object.is(deg, this.arrowDeg)) {
      this.arrowDeg = deg;
      this.arrow.classList.toggle('is-hidden', !lost);
      if (lost) this.arrow.style.transform = `rotate(${deg}deg)`;
    }
  }

  dispose(): void {
    this.observer?.disconnect();
  }
}
