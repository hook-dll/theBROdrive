import * as THREE from 'three';
import { desertPaletteAt } from '../world/gradient';

/**
 * THE DESERT'S OWN DUST, wherever the road has got to.
 *
 * The sand changes from desert to desert over the palette cycle (`desertPaletteAt`):
 * ochre at the start, then pink, rust, black lava, lunar grey and pastel ones far out.
 * Everything made OF that sand — the dust a haboob carries, the haze of a mgla, the
 * grains streaming across the road, the crust on a car's sills — has to walk with it,
 * or a black desert gets an orange storm and a green one leaves ochre on the paint.
 *
 * So every dust colour is authored ONCE, against the sand the drive starts on, and
 * carried to wherever the road is by the same move the sand made: its hue turned by
 * the sand's hue shift, its saturation scaled by the sand's, its lightness offset by
 * the sand's. At the start that move is the identity and every colour is exactly as
 * authored; out on the cycle a dust colour keeps its relation to the ground — paler
 * than it, or darker, or duller — which is what makes it read as that ground's dust.
 *
 * The palette drifts over thousands of kilometres, so this is recomputed once a
 * frame for the player's arclength and nothing tracks per-object position: the
 * difference between here and a kilometre away is not a colour anyone can see.
 */

const hsl = { h: 0, s: 0, l: 0 };
const start = { h: 0, s: 0, l: 0 };
const here = { h: 0, s: 0, l: 0 };
const scratch = new THREE.Color();

new THREE.Color(desertPaletteAt(0).sand).getHSL(start, THREE.SRGBColorSpace);
here.h = start.h;
here.s = start.s;
here.l = start.l;
let hereS = 0;

/** Every live `SandColor`, refreshed when the reference sand moves. */
const bindings = new Set<{ refresh(): void }>();

/** Moves the reference to the sand at arclength `s`. Called once a frame. */
export function setDesertDustArclength(s: number): void {
  // The palette moves over thousands of kilometres: 25 m is far below a visible step.
  if (Math.abs(s - hereS) < 25) return;
  hereS = s;
  scratch.setHex(desertPaletteAt(s).sand).getHSL(here, THREE.SRGBColorSpace);
  for (const binding of bindings) binding.refresh();
}

/**
 * `authored`, a colour chosen against the starting sand, carried to the current sand.
 * Written into `out`; both in the working (linear) colour space, like any THREE.Color.
 */
export function followSand(authored: THREE.Color, out: THREE.Color): THREE.Color {
  authored.getHSL(hsl, THREE.SRGBColorSpace);
  const h = hsl.h + (here.h - start.h);
  const s = Math.min(1, Math.max(0, hsl.s * (here.s / Math.max(1e-3, start.s))));
  const l = Math.min(1, Math.max(0, hsl.l + (here.l - start.l)));
  return out.setHSL(h - Math.floor(h), s, l, THREE.SRGBColorSpace);
}

/**
 * A live colour that always holds `authored` carried to the current sand: bind it to
 * a uniform once and it is kept current, for a shader that must not care.
 */
export class SandColor {
  readonly value = new THREE.Color();
  constructor(private readonly authored: THREE.Color) {
    bindings.add(this);
    this.refresh();
  }
  refresh(): void {
    followSand(this.authored, this.value);
  }
}

