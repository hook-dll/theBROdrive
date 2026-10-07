/**
 * tools/domshim.ts
 *
 * A `document.createElement('canvas')` good enough for the procedural texture and
 * sign painters, so headless tools can drive the REAL providers.
 *
 * `RoadMeshProvider` builds its asphalt maps from a 2D canvas, and the monument signs
 * render their text the same way. Neither is optional: skipping them would mean a tool
 * verifies a provider the game does not ship. Nothing here draws — the painters' output
 * is never inspected by these tools, only their side effects on physics and geometry —
 * so every path op is a no-op and the pixel buffer is whatever was last written.
 *
 * Shared rather than copied: `long-drive-soak.ts` and `roadside-solid.ts` both need it,
 * and a second hand-written stub would drift the moment a painter calls one more
 * context method.
 *
 * `render/stickerart.ts` is the other painter, and it reaches for far more of the 2D
 * API — arcs, ellipses, beziers, clipping, gradients, `drawImage`. It runs while a
 * `Vehicle` is being built (the boot's sticker decals), so any bench that constructs
 * one needs the whole surface present, even though every op stays a no-op.
 *
 * Nothing here is part of the game bundle.
 */

interface ShimImageData {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
}

interface ShimGradient {
  addColorStop(offset: number, color: string): void;
}

/** Gradients are never sampled here, so the stops are accepted and dropped. */
class ShimGradientStub implements ShimGradient {
  addColorStop(): void {}
}

interface ShimCanvasContext {
  filter: string;
  fillStyle: string | ShimGradient;
  font: string;
  globalAlpha: number;
  imageSmoothingEnabled: boolean;
  lineCap: CanvasLineCap;
  lineJoin: CanvasLineJoin;
  lineWidth: number;
  shadowBlur: number;
  shadowColor: string;
  strokeStyle: string | ShimGradient;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  createImageData(width: number, height: number): ShimImageData;
  putImageData(imageData: ShimImageData, x: number, y: number): void;
  getImageData(x: number, y: number, width: number, height: number): ShimImageData;
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): ShimGradient;
  createRadialGradient(
    x0: number,
    y0: number,
    r0: number,
    x1: number,
    y1: number,
    r1: number,
  ): ShimGradient;
  arc(x: number, y: number, r: number, start: number, end: number, ccw?: boolean): void;
  arcTo(x1: number, y1: number, x2: number, y2: number, r: number): void;
  beginPath(): void;
  bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void;
  clip(): void;
  closePath(): void;
  drawImage(image: unknown, x: number, y: number): void;
  ellipse(
    x: number,
    y: number,
    rx: number,
    ry: number,
    rotation: number,
    start: number,
    end: number,
    ccw?: boolean,
  ): void;
  fill(): void;
  fillRect(x: number, y: number, width: number, height: number): void;
  fillText(text: string, x: number, y: number, maxWidth?: number): void;
  lineTo(x: number, y: number): void;
  measureText(text: string): { width: number };
  moveTo(x: number, y: number): void;
  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void;
  rect(x: number, y: number, width: number, height: number): void;
  restore(): void;
  rotate(angle: number): void;
  save(): void;
  scale(x: number, y: number): void;
  setLineDash(segments: readonly number[]): void;
  stroke(): void;
  strokeRect(x: number, y: number, width: number, height: number): void;
  strokeText(text: string, x: number, y: number, maxWidth?: number): void;
  translate(x: number, y: number): void;
}

class ShimCanvas {
  width = 300;
  height = 150;
  #pixels = new Uint8ClampedArray();

  readonly context: ShimCanvasContext = {
    filter: 'none',
    fillStyle: '',
    font: '',
    globalAlpha: 1,
    imageSmoothingEnabled: true,
    lineCap: 'butt',
    lineJoin: 'miter',
    lineWidth: 1,
    shadowBlur: 0,
    shadowColor: '',
    strokeStyle: '',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    createLinearGradient: () => new ShimGradientStub(),
    createRadialGradient: () => new ShimGradientStub(),
    createImageData: (width, height) => ({
      data: new Uint8ClampedArray(width * height * 4),
      width,
      height,
    }),
    putImageData: (imageData, x, y) => {
      if (x !== 0 || y !== 0 || imageData.width !== this.width || imageData.height !== this.height) {
        throw new Error('shim canvas only supports full-canvas image data');
      }
      this.#pixels = imageData.data;
    },
    getImageData: (x, y, width, height) => {
      if (x !== 0 || y !== 0 || width !== this.width || height !== this.height) {
        throw new Error('shim canvas only supports full-canvas image data');
      }
      return { data: this.#pixels, width, height };
    },
    arc: () => {},
    arcTo: () => {},
    beginPath: () => {},
    bezierCurveTo: () => {},
    clip: () => {},
    closePath: () => {},
    drawImage: () => {},
    ellipse: () => {},
    fill: () => {},
    fillRect: () => {},
    fillText: () => {},
    lineTo: () => {},
    measureText: (text) => ({ width: text.length * 8 }),
    moveTo: () => {},
    quadraticCurveTo: () => {},
    rect: () => {},
    restore: () => {},
    rotate: () => {},
    save: () => {},
    scale: () => {},
    setLineDash: () => {},
    stroke: () => {},
    strokeRect: () => {},
    strokeText: () => {},
    translate: () => {},
  };

  getContext(contextId: string): ShimCanvasContext | null {
    if (contextId !== '2d') return null;
    return this.context;
  }
}

/** Installs the shim and returns the undo, so a tool leaves the global as it found it. */
export function installDocumentShim(): () => void {
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const documentShim: Pick<Document, 'createElement'> = {
    createElement: ((tagName: string): HTMLCanvasElement => {
      if (tagName !== 'canvas') throw new Error(`shim document cannot create <${tagName}>`);
      return new ShimCanvas() as unknown as HTMLCanvasElement;
    }) as Document['createElement'],
  };
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: documentShim,
    writable: true,
  });
  return () => {
    if (previousDocument) {
      Object.defineProperty(globalThis, 'document', previousDocument);
    } else {
      Reflect.deleteProperty(globalThis, 'document');
    }
  };
}
