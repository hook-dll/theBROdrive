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
 * IMPORT IT FIRST. One module still resolves a painted texture while it is being
 * evaluated rather than on first use (`world/props/trees.ts` builds the leaf atlas;
 * `world/roadmesh.ts` the shoulder's gravel map, `world/trackmesh.ts` the track's and
 * `render/stickers.ts` the star are all resolved on first use now), and an import list
 * is evaluated in source order. A tool whose `src/` imports come before this one
 * therefore dies at module scope with `document is not defined` before its own first
 * statement runs — which is what `roadside-solid.ts` and `long-drive-soak.ts` did. The
 * shim installs itself on import so the only rule left is the order.
 *
 * Nothing here is part of the game bundle.
 */

interface ShimImageData {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
}

interface ShimCanvasContext {
  filter: string;
  fillStyle: string;
  font: string;
  lineCap: CanvasLineCap;
  lineJoin: CanvasLineJoin;
  lineWidth: number;
  strokeStyle: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  createImageData(width: number, height: number): ShimImageData;
  putImageData(imageData: ShimImageData, x: number, y: number): void;
  getImageData(x: number, y: number, width: number, height: number): ShimImageData;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  stroke(): void;
  strokeRect(x: number, y: number, width: number, height: number): void;
  fillText(text: string, x: number, y: number, maxWidth?: number): void;
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  fillRect(x: number, y: number, width: number, height: number): void;
}

class ShimCanvas {
  width = 300;
  height = 150;
  #pixels = new Uint8ClampedArray();

  readonly context: ShimCanvasContext = {
    filter: 'none',
    fillStyle: '',
    font: '',
    lineCap: 'butt',
    lineJoin: 'miter',
    lineWidth: 1,
    strokeStyle: '',
    textAlign: 'start',
    textBaseline: 'alphabetic',
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
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    stroke: () => {},
    strokeRect: () => {},
    fillText: () => {},
    save: () => {},
    restore: () => {},
    translate: () => {},
    fillRect: () => {},
  };

  getContext(contextId: string): ShimCanvasContext | null {
    if (contextId !== '2d') return null;
    return this.context;
  }
}

/** Undo of the installation in place, or null when the shim is not installed. */
let uninstall: (() => void) | null = null;

/**
 * Installs the shim if it is not already in place, and returns the undo so a tool leaves
 * the global as it found it.
 *
 * Called once at module scope below, because the four modules the header names paint while
 * they are being evaluated and the import list is evaluated in source order: a tool that
 * imports this after them is already dead. A tool that calls it a second time gets the
 * FIRST undo, so what it restores is the global it actually found.
 */
export function installDocumentShim(): () => void {
  if (uninstall) return uninstall;
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
  const undo = (): void => {
    uninstall = null;
    if (previousDocument) {
      Object.defineProperty(globalThis, 'document', previousDocument);
    } else {
      Reflect.deleteProperty(globalThis, 'document');
    }
  };
  uninstall = undo;
  return undo;
}

installDocumentShim();
