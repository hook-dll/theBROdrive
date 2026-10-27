/**
 * Interior trims: the muted colour sets a car's cabin leaves the works in, picked per car
 * as its paint is (render/carmodel.ts `applyKitTrim`, from the car's appearance key).
 *
 * A model is built once, in its own `KitLook.upholstery` and `KitLook.dash`; every ink
 * derived from either is logged in its trim family (builder.ts `TrimFamily`) and marked in
 * the vertices (materials.ts `finishKitSurfaces`). A car then multiplies each family by
 * its trim's colour over the model's own (`kitTrimTint`), in its one material's uniforms
 * (render/materials.ts `setCarKitTrim`): seats, inserts, bench, door cards and armrests
 * follow the upholstery; dash, console, parcel shelf, cappings and knobs the dash. Carpet
 * and headliner are the layout's and stay. No geometry, colour bytes or program change.
 *
 * Each trim is a coordinated set: the upholstery, and a darker dash in its family. A
 * model whose dash was one plastic whatever the seats (the VAZ and the Opel/Daewoo
 * black and dark grey dashes, the UAZ's painted one) keeps its own dash (`dash: 'own'`).
 */

import * as THREE from 'three';
import { KIT_SPECS } from './specs';

export type TrimId = 'grey' | 'sand' | 'blue' | 'brown' | 'black' | 'burgundy' | 'olive';

export interface InteriorTrim {
  readonly id: TrimId;
  readonly label: string;
  /** Seat and door-card cloth or vinyl (sRGB hex). */
  readonly upholstery: number;
  /** The dash in the same family, darker (sRGB hex). */
  readonly dash: number;
}

/** The palette: muted, period colours; every model's own trim is an option besides. */
export const INTERIOR_TRIMS: readonly InteriorTrim[] = [
  { id: 'grey', label: 'серый', upholstery: 0x5b5d61, dash: 0x2c2e31 },
  { id: 'sand', label: 'бежевый', upholstery: 0x8a7c64, dash: 0x4f463a },
  { id: 'blue', label: 'синий', upholstery: 0x44506a, dash: 0x2a3140 },
  { id: 'brown', label: 'коричневый', upholstery: 0x5c4434, dash: 0x2f251e },
  { id: 'black', label: 'чёрный', upholstery: 0x2e2e30, dash: 0x1c1c1d },
  { id: 'burgundy', label: 'бордовый', upholstery: 0x5c2d2c, dash: 0x2f1d1d },
  { id: 'olive', label: 'оливковый', upholstery: 0x585a48, dash: 0x30322a },
];

/** Which palette trims a model may have, and whether its dash follows them. */
interface KitTrims {
  readonly trims: readonly TrimId[];
  readonly dash: 'own' | 'trim';
}

const CLASSIC: KitTrims = { trims: ['burgundy', 'brown', 'sand', 'grey', 'blue'], dash: 'own' };
const SAMARA: KitTrims = { trims: ['grey', 'black', 'blue', 'brown', 'sand'], dash: 'own' };
const NIVA: KitTrims = { trims: ['brown', 'grey', 'black', 'sand'], dash: 'own' };
const UAZ: KitTrims = { trims: ['brown', 'black', 'olive', 'grey'], dash: 'own' };
const FOREIGN: KitTrims = { trims: ['grey', 'sand', 'blue', 'black'], dash: 'own' };

/** Per kit car. A model left out has only its own trim. */
const KIT_TRIMS: Readonly<Record<string, KitTrims>> = {
  vaz2101: CLASSIC,
  vaz2102: CLASSIC,
  vaz2103: CLASSIC,
  vaz2104: CLASSIC,
  vaz2105: CLASSIC,
  vaz2106: CLASSIC,
  vaz2107: CLASSIC,
  gaz24: CLASSIC,
  gaz31029: { trims: ['grey', 'brown', 'black', 'blue', 'sand'], dash: 'own' },
  vaz2108: SAMARA,
  vaz2109: SAMARA,
  vaz21099: SAMARA,
  vaz2115: SAMARA,
  vaz2110: SAMARA,
  vaz2112: SAMARA,
  vaz2111: SAMARA,
  vaz1111: { trims: ['grey', 'black', 'blue', 'burgundy'], dash: 'own' },
  vaz2121: NIVA,
  vaz2131: NIVA,
  azlk2141: { trims: ['grey', 'black', 'blue', 'brown'], dash: 'own' },
  uaz469: UAZ,
  uaz2206: UAZ,
  nexia: FOREIGN,
  espero: FOREIGN,
  astraf: FOREIGN,
  vectraa: FOREIGN,
  // Dashes coloured to the cabin, as the photos the two cabins were measured on show.
  w124: { trims: ['grey', 'sand', 'black', 'brown', 'burgundy'], dash: 'trim' },
  e34: { trims: ['grey', 'sand', 'black', 'burgundy'], dash: 'trim' },
};

/** One trim a model can have: the colours its upholstery and dash families take. */
export interface KitTrimOption {
  /** A palette trim, or null for the model's own. */
  readonly id: TrimId | null;
  readonly upholstery: number;
  readonly dash: number;
}

function lookOf(kitId: string): { readonly upholstery: number; readonly dash: number } {
  const spec = KIT_SPECS[kitId];
  if (!spec) throw new Error(`Unknown kit car "${kitId}"`);
  return spec.look;
}

/** `trim` on this model: its upholstery, and its dash unless the model keeps its own. */
export function kitTrimOption(kitId: string, trim: InteriorTrim): KitTrimOption {
  const look = lookOf(kitId);
  const own = (KIT_TRIMS[kitId]?.dash ?? 'own') === 'own';
  return { id: trim.id, upholstery: trim.upholstery, dash: own ? look.dash : trim.dash };
}

const optionCache = new Map<string, readonly KitTrimOption[]>();

/** The trims a car of this model leaves the works in: its own first, then the palette's it allows. */
export function kitTrimOptions(kitId: string): readonly KitTrimOption[] {
  let options = optionCache.get(kitId);
  if (!options) {
    const look = lookOf(kitId);
    const allowed = KIT_TRIMS[kitId]?.trims ?? [];
    options = [
      { id: null, upholstery: look.upholstery, dash: look.dash },
      ...allowed.map((id) => kitTrimOption(kitId, INTERIOR_TRIMS.find((trim) => trim.id === id)!)),
    ];
    optionCache.set(kitId, options);
  }
  return options;
}

const _target = new THREE.Color();
const _base = new THREE.Color();

/** `out` = `target` / `base` per channel in the working (linear) space: what turns one into the other. */
function ratio(target: number, base: number, out: THREE.Color): THREE.Color {
  _target.setHex(target);
  _base.setHex(base);
  return out.setRGB(_target.r / Math.max(_base.r, 1e-4), _target.g / Math.max(_base.g, 1e-4), _target.b / Math.max(_base.b, 1e-4));
}

/**
 * The factors a car of this model in `option` multiplies its upholstery's and its dash's
 * vertex colours by (render/materials.ts `setCarKitTrim`): white for the model's own. A
 * shade of the model's colour (an insert, an armrest, a knob) becomes about the same shade
 * of the trim's.
 */
export function kitTrimTint(kitId: string, option: KitTrimOption, upholstery: THREE.Color, dash: THREE.Color): void {
  const look = lookOf(kitId);
  ratio(option.upholstery, look.upholstery, upholstery);
  ratio(option.dash, look.dash, dash);
}
